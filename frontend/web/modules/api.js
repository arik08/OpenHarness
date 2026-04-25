export function createApi(ctx) {
  const { state, els, STATUS_LABELS } = ctx;
  function handleEvent(...args) { return ctx.handleEvent(...args); }
  function setStatus(...args) { return ctx.setStatus(...args); }
  function resetWorkflowPanel(...args) { return ctx.resetWorkflowPanel(...args); }
  function ensureWorkflowPanel(...args) { return ctx.ensureWorkflowPanel(...args); }
  function setChatTitle(...args) { return ctx.setChatTitle(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }
  function scrollMessagesToBottom(...args) { return ctx.scrollMessagesToBottom(...args); }
  function autoSizeInput(...args) { return ctx.autoSizeInput(...args); }
  function setBusy(...args) { return ctx.setBusy(...args); }
  function saveScrollPosition(...args) { return ctx.saveScrollPosition(...args); }
  function renderWelcome(...args) { return ctx.renderWelcome(...args); }
  function markActiveHistory(...args) { return ctx.markActiveHistory(...args); }
  function updateSendState(...args) { return ctx.updateSendState(...args); }
  function forgetScrollPosition(...args) { return ctx.forgetScrollPosition(...args); }
  function clearAttachments(...args) { return ctx.clearAttachments(...args); }
  function clearPastedTexts(...args) { return ctx.clearPastedTexts(...args); }
  function clearComposerToken(...args) { return ctx.clearComposerToken(...args); }
  function updateWorkspaceDisplay(...args) { return ctx.updateWorkspaceDisplay(...args); }
  function resetArtifacts(...args) { return ctx.resetArtifacts?.(...args); }
  function setPlanModeIndicatorActive(...args) { return ctx.setPlanModeIndicatorActive?.(...args); }
  let activeShell = null;

function isPlanModeActive() {
  const mode = String(state.permissionMode || "").trim().toLowerCase().replace(/\s+/g, "_");
  return mode === "plan" || mode === "plan_mode" || mode === "permissionmode.plan";
}

function previewPlanModeCommand(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!/^\/plan(?:\s|$)/.test(normalized)) {
    return;
  }
  const [, arg = ""] = normalized.split(/\s+/, 2);
  if (arg === "off" || arg === "exit") {
    setPlanModeIndicatorActive(false);
    return;
  }
  if (arg === "on" || arg === "enter") {
    setPlanModeIndicatorActive(true);
    return;
  }
  setPlanModeIndicatorActive(!isPlanModeActive());
}

function escapeFence(text) {
  return String(text || "").replace(/```/g, "``\u200b`");
}

function formatShellResult(result) {
  const lines = [`$ ${result.command || ""}`];
  const stdout = String(result.stdout || "").trimEnd();
  const stderr = String(result.stderr || "").trimEnd();
  if (stdout) {
    lines.push(stdout);
  }
  if (stderr) {
    if (stdout) {
      lines.push("");
    }
    lines.push(stderr);
  }
  if (result.timedOut) {
    lines.push("", `[timed out after 60s]`);
  } else if (Number(result.exitCode || 0) !== 0) {
    lines.push("", `[exit code ${result.exitCode}]`);
  }
  if (result.truncated) {
    lines.push("", "[truncated]");
  }
  return `\`\`\`text\n${escapeFence(lines.join("\n").trimEnd() || `$ ${result.command || ""}`)}\n\`\`\``;
}

function formatShellStream(command, output, state = {}) {
  const lines = [`$ ${command || ""}`];
  const body = String(output || "").trimEnd();
  if (body) {
    lines.push(body);
  }
  if (state.cancelled) {
    lines.push("", "[cancelled]");
  } else if (state.timedOut) {
    lines.push("", "[timed out after 60s]");
  } else if (state.exitCode !== undefined && state.exitCode !== null && Number(state.exitCode) !== 0) {
    lines.push("", `[exit code ${state.exitCode}]`);
  }
  if (state.truncated) {
    lines.push("", "[truncated]");
  }
  return `\`\`\`text\n${escapeFence(lines.join("\n").trimEnd() || `$ ${command || ""}`)}\n\`\`\``;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }
  return response.json();
}

async function deleteJson(url, payload) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }
  return response.json();
}

function setActiveWorkspace(workspace) {
  if (!workspace) {
    return;
  }
  state.workspaceName = workspace.name || "";
  state.workspacePath = workspace.path || "";
  if (state.workspaceName) {
    localStorage.setItem("openharness:workspaceName", state.workspaceName);
  }
  updateWorkspaceDisplay();
}

async function loadWorkspaces() {
  const data = await getJson("/api/workspaces");
  state.workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  return state.workspaces;
}

async function initializeWorkspace() {
  const workspaces = await loadWorkspaces();
  const savedName = localStorage.getItem("openharness:workspaceName") || "";
  const selected =
    workspaces.find((workspace) => workspace.name === savedName)
    || workspaces.find((workspace) => workspace.name === "Default")
    || workspaces[0];
  setActiveWorkspace(selected);
  return selected;
}

async function startSession() {
  setStatus(STATUS_LABELS.connecting);
  const payload = { permissionMode: "full_auto" };
  if (state.workspacePath) {
    payload.cwd = state.workspacePath;
  }
  const systemPrompt = String(state.systemPrompt || "").trim();
  if (systemPrompt) {
    payload.systemPrompt = systemPrompt;
  }
  const session = await postJson("/api/session", payload);
  const { sessionId } = session;
  setActiveWorkspace(session.workspace);
  state.sessionId = sessionId;
  state.projectFiles = [];
  state.projectFilesLoadedForSession = "";
  if (els.sessionId) {
    els.sessionId.textContent = sessionId;
  }

  state.source = new EventSource(`/api/events?session=${encodeURIComponent(sessionId)}`);
  state.source.onmessage = (event) => handleEvent(JSON.parse(event.data));
  state.source.onerror = () => {
    if (!state.ready) {
      setStatus(STATUS_LABELS.connectionError);
    }
  };
}

async function runStreamingShellCommand(command) {
  const controller = new AbortController();
  const shellState = {
    command,
    output: "",
    exitCode: undefined,
    timedOut: false,
    truncated: false,
    cancelled: false,
    renderTimer: 0,
    content: appendMessage("log", formatShellStream(command, "")),
    controller,
  };
  activeShell = shellState;

  const render = () => {
    if (shellState.renderTimer) {
      window.clearTimeout(shellState.renderTimer);
      shellState.renderTimer = 0;
    }
    setMarkdown(shellState.content, formatShellStream(command, shellState.output, shellState));
    if (state.autoFollowMessages) {
      scrollMessagesToBottom();
    }
  };

  const scheduleRender = () => {
    if (shellState.renderTimer) {
      return;
    }
    shellState.renderTimer = window.setTimeout(render, 50);
  };

  try {
    const response = await fetch("/api/shell/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        cwd: state.workspacePath,
        command,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("Streaming response is not available");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split(/\n/);
      pending = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const event = JSON.parse(line);
        if (event.type === "stdout" || event.type === "stderr") {
          shellState.output += String(event.text || "");
          scheduleRender();
        } else if (event.type === "truncated") {
          shellState.truncated = true;
          scheduleRender();
        } else if (event.type === "exit") {
          shellState.exitCode = event.exitCode;
          shellState.timedOut = Boolean(event.timedOut);
          shellState.truncated = shellState.truncated || Boolean(event.truncated);
          render();
        }
      }
      if (done) {
        break;
      }
    }
    render();
    setBusy(false, STATUS_LABELS.ready);
  } catch (error) {
    if (error.name === "AbortError" || shellState.cancelled) {
      shellState.cancelled = true;
      render();
      setBusy(false, STATUS_LABELS.stopped);
      return;
    }
    appendMessage("system", `명령어 실행 실패: ${error.message}`);
    setBusy(false, STATUS_LABELS.error);
  } finally {
    if (activeShell === shellState) {
      activeShell = null;
    }
  }
}

async function sendLine(line) {
  const text = line.trim();
  const planModeCommand = /^\/plan(?:\s|$)/i.test(text);
  const shellCommand = /^!(?!\s*$)/.test(text);
  const attachments = state.attachments.map((attachment) => ({
    media_type: attachment.media_type || attachment.mediaType,
    data: attachment.data,
    name: attachment.name,
  })).filter((attachment) => attachment.media_type && attachment.data);
  if ((!text && attachments.length === 0) || !state.sessionId) {
    if (!shellCommand) {
      return;
    }
  }
  resetWorkflowPanel();
  resetArtifacts();
  if (planModeCommand) {
    previewPlanModeCommand(text);
  }
  if (state.chatTitle === "MyHarness" && !text.startsWith("/")) {
    setChatTitle(text || "이미지 첨부");
  }
  if (shellCommand) {
    const command = text.slice(1).trim();
    appendMessage("user", text);
    els.input.value = "";
    clearComposerToken();
    clearPastedTexts();
    clearAttachments();
    autoSizeInput();
    setBusy(true, "명령어 실행 중");
    state.autoFollowMessages = true;
    await runStreamingShellCommand(command);
    return;
  }
  if (!planModeCommand) {
    appendMessage("user", text, attachments);
  }
  if (!text.startsWith("/") && !planModeCommand) {
    ensureWorkflowPanel(text);
  }
  els.input.value = "";
  clearComposerToken();
  clearPastedTexts();
  clearAttachments();
  autoSizeInput();
  setBusy(true, STATUS_LABELS.sending);
  state.autoFollowMessages = true;
  await postJson("/api/message", { sessionId: state.sessionId, line: text, attachments });
}

async function cancelCurrent() {
  if (activeShell?.controller) {
    activeShell.cancelled = true;
    activeShell.controller.abort();
    activeShell = null;
    setBusy(false, STATUS_LABELS.stopped);
    return;
  }
  if (!state.sessionId || !state.busy) {
    return;
  }
  await postJson("/api/cancel", { sessionId: state.sessionId });
}

async function sendBackendRequest(payload) {
  if (!state.sessionId) {
    return;
  }
  await postJson("/api/respond", { sessionId: state.sessionId, payload });
}

async function shutdownSession(sessionId = state.sessionId) {
  if (!sessionId) {
    return;
  }
  await postJson("/api/shutdown", { sessionId });
}

async function restartSessionForWorkspace(workspace) {
  state.switchingWorkspace = true;
  state.ready = false;
  setBusy(true, "프로젝트 전환 중");
  const previousSessionId = state.sessionId;
  state.sessionId = null;
  if (state.source) {
    state.source.close();
    state.source = null;
  }
  if (previousSessionId) {
    await shutdownSession(previousSessionId).catch(() => {});
  }
  setActiveWorkspace(workspace);
  state.assistantNode = null;
  state.activeHistoryId = null;
  state.pendingScrollRestoreId = null;
  state.restoringHistory = false;
  state.batchingHistoryRestore = false;
  state.ignoreScrollSave = false;
  renderWelcome();
  markActiveHistory();
  resetWorkflowPanel();
  resetArtifacts();
  clearComposerToken();
  clearPastedTexts();
  clearAttachments();
  try {
    await startSession();
  } catch (error) {
    state.switchingWorkspace = false;
    setBusy(false, STATUS_LABELS.error);
    updateSendState();
    throw error;
  }
}

async function createWorkspace(name) {
  const data = await postJson("/api/workspaces", { name });
  state.workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  return data.workspace;
}

async function deleteWorkspace(name) {
  const data = await deleteJson("/api/workspaces", { name });
  state.workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  if (state.workspaceName === name) {
    localStorage.removeItem("openharness:workspaceName");
  }
  return data;
}

async function setSystemPrompt(value) {
  state.systemPrompt = String(value || "");
  localStorage.setItem("openharness:systemPrompt", state.systemPrompt);
  if (!state.sessionId) {
    return;
  }
  await sendBackendRequest({ type: "set_system_prompt", value: state.systemPrompt });
}

async function requestSelectCommand(command) {
  if (!command || !state.sessionId || state.busy) {
    return;
  }
  await sendBackendRequest({ type: "select_command", command });
}

async function refreshSkills() {
  if (!state.sessionId) {
    return;
  }
  await sendBackendRequest({ type: "refresh_skills" });
}

async function clearChat() {
  saveScrollPosition();
  els.input.value = "";
  clearComposerToken();
  clearPastedTexts();
  clearAttachments();
  autoSizeInput();
  state.assistantNode = null;
  state.activeHistoryId = null;
  state.pendingScrollRestoreId = null;
  state.restoringHistory = false;
  state.batchingHistoryRestore = false;
  state.ignoreScrollSave = false;
  renderWelcome();
  resetArtifacts();
  markActiveHistory();
  updateSendState();
  if (state.sessionId) {
    await postJson("/api/message", { sessionId: state.sessionId, line: "/clear" });
    refreshSkills().catch(() => {});
  }
}

async function requestHistory() {
  if (els.historyList.querySelector(".empty")) {
    els.historyList.querySelector(".empty").textContent = "대화 내역을 불러오는 중...";
  }
  await sendBackendRequest({ type: "list_sessions" });
}

async function deleteHistorySession(sessionId, item) {
  if (!sessionId || !state.sessionId) {
    return;
  }
  item?.classList.add("deleting");
  forgetScrollPosition(sessionId);
  if (state.activeHistoryId === sessionId) {
    state.activeHistoryId = null;
    state.pendingScrollRestoreId = null;
    state.restoringHistory = false;
    state.batchingHistoryRestore = false;
    renderWelcome();
  }
  await sendBackendRequest({ type: "delete_session", value: sessionId });
}

  return {
    postJson,
    getJson,
    loadWorkspaces,
    initializeWorkspace,
    startSession,
    shutdownSession,
    restartSessionForWorkspace,
    createWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
    sendLine,
    cancelCurrent,
    sendBackendRequest,
    setSystemPrompt,
    requestSelectCommand,
    refreshSkills,
    clearChat,
    requestHistory,
    deleteHistorySession,
  };
}
