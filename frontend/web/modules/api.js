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

function createFrontendId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function attachMessageScroll(container) {
  if (!container || container.dataset.slotScrollAttached === "true") {
    return;
  }
  container.dataset.slotScrollAttached = "true";
  container.addEventListener("scroll", () => {
    if (!state.restoringHistory && !state.ignoreScrollSave) {
      if (Date.now() < state.autoScrollUntil) {
        state.autoFollowMessages = true;
      } else {
        state.autoFollowMessages = ctx.isNearMessageBottom();
      }
    }
    ctx.scheduleScrollPositionSave();
  });
}

function snapshotActiveSlot() {
  const slot = state.chatSlots.get(state.activeFrontendId);
  if (!slot) {
    return;
  }
  Object.assign(slot, {
    backendSessionId: state.sessionId,
    savedSessionId: state.activeHistoryId || slot.savedSessionId || "",
    title: slot.showInHistory && !slot.hasConversation ? "New Chat" : state.chatTitle,
    ready: state.ready,
    busy: state.busy,
    busyVisual: state.busyVisual,
    assistantNode: state.assistantNode,
    workflowNode: state.workflowNode,
    workflowList: state.workflowList,
    workflowSummary: state.workflowSummary,
    workflowSteps: state.workflowSteps,
    workflowTimer: 0,
    workflowRestoredElapsedMs: state.workflowRestoredElapsedMs,
    restoringHistory: state.restoringHistory,
    batchingHistoryRestore: state.batchingHistoryRestore,
    pendingScrollRestoreId: state.pendingScrollRestoreId,
    ignoreScrollSave: state.ignoreScrollSave,
    projectFiles: state.projectFiles,
    projectFilesLoadedForSession: state.projectFilesLoadedForSession,
  });
}

function restoreSlot(slot) {
  state.activeFrontendId = slot.frontendId;
  state.sessionId = slot.backendSessionId;
  state.ready = Boolean(slot.ready);
  state.busy = Boolean(slot.busy);
  state.busyVisual = Boolean(slot.busyVisual);
  state.assistantNode = slot.assistantNode || null;
  state.activeHistoryId = slot.savedSessionId || null;
  state.pendingScrollRestoreId = slot.pendingScrollRestoreId || null;
  state.restoringHistory = Boolean(slot.restoringHistory);
  state.batchingHistoryRestore = Boolean(slot.batchingHistoryRestore);
  state.ignoreScrollSave = Boolean(slot.ignoreScrollSave);
  state.workflowNode = slot.workflowNode || null;
  state.workflowList = slot.workflowList || null;
  state.workflowSummary = slot.workflowSummary || null;
  state.workflowSteps = slot.workflowSteps || [];
  state.workflowTimer = slot.workflowTimer || 0;
  state.workflowRestoredElapsedMs = slot.workflowRestoredElapsedMs || 0;
  state.projectFiles = slot.projectFiles || [];
  state.projectFilesLoadedForSession = slot.projectFilesLoadedForSession || "";
  if (els.sessionId) {
    els.sessionId.textContent = state.sessionId || "";
  }
  els.messages = slot.container;
  document.querySelectorAll(".chat-slot-messages").forEach((node) => {
    node.classList.toggle("hidden", node !== slot.container);
  });
  setChatTitle(slot.title || "MyHarness");
  setStatus(
    state.busyVisual ? STATUS_LABELS.processing : state.ready ? STATUS_LABELS.ready : STATUS_LABELS.connecting,
    state.busyVisual ? "busy" : state.ready ? "ready" : "",
  );
  updateSendState();
  markActiveHistory();
}

function createChatSlot({ sessionId, workspace, container = null, makeActive = true }) {
  const frontendId = createFrontendId();
  const node = container || document.createElement("section");
  node.classList.add("messages", "chat-slot-messages");
  if (!container) {
    node.setAttribute("aria-live", "polite");
    const current = document.querySelector(".chat-panel .composer");
    current?.before(node);
  }
  attachMessageScroll(node);
  const slot = {
    frontendId,
    backendSessionId: sessionId,
    savedSessionId: "",
    workspace,
    container: node,
    title: "MyHarness",
    ready: false,
    busy: false,
    busyVisual: false,
    hasConversation: false,
    showInHistory: false,
    suppressNewChatHistory: false,
    assistantNode: null,
    workflowNode: null,
    workflowList: null,
    workflowSummary: null,
    workflowSteps: [],
    workflowTimer: 0,
    workflowRestoredElapsedMs: 0,
    restoringHistory: false,
    batchingHistoryRestore: false,
    pendingScrollRestoreId: null,
    ignoreScrollSave: false,
    projectFiles: [],
    projectFilesLoadedForSession: "",
    source: null,
    pendingEvents: [],
  };
  state.chatSlots.set(frontendId, slot);
  if (makeActive) {
    snapshotActiveSlot();
    resetWorkflowPanel();
    restoreSlot(slot);
  } else {
    node.classList.add("hidden");
  }
  return slot;
}

function attachSlotSource(slot) {
  if (!slot || slot.source) {
    return;
  }
  const sessionId = slot.backendSessionId;
  slot.source = new EventSource(`/api/events?session=${encodeURIComponent(sessionId)}`);
  slot.source.onmessage = (event) => handleSessionEvent(sessionId, JSON.parse(event.data));
  slot.source.onerror = () => {
    if (slot.frontendId === state.activeFrontendId && !slot.ready) {
      setStatus(STATUS_LABELS.connectionError);
    }
  };
}

function activeRunningSlotCount() {
  let count = 0;
  for (const slot of state.chatSlots.values()) {
    if (slot.busy) {
      count += 1;
    }
  }
  return count;
}

function slotForBackendSession(sessionId) {
  for (const slot of state.chatSlots.values()) {
    if (slot.backendSessionId === sessionId) {
      return slot;
    }
  }
  return null;
}

function isEmptyNewChatSlot(slot) {
  return Boolean(
    slot
      && slot.showInHistory
      && !slot.busy
      && !slot.container?.querySelector(".message")
      && (slot.title === "New Chat" || !slot.savedSessionId)
  );
}

function isNonConversationTranscriptItem(item) {
  const role = item?.role || "";
  const text = String(item?.text || "").trim();
  if (!text) {
    return true;
  }
  if (role === "system" && text === "Conversation cleared.") {
    return true;
  }
  if (role === "system" && ["Plan mode enabled.", "Plan mode disabled."].includes(text)) {
    return true;
  }
  if (role === "system" && text.startsWith("Session restored")) {
    return true;
  }
  return false;
}

function updateSlotFromEvent(slot, event) {
  if (!slot || !event) {
    return;
  }
  if (event.type === "ready") {
    slot.ready = true;
  }
  if (event.type === "clear_transcript") {
    slot.hasConversation = false;
    slot.showInHistory = !slot.suppressNewChatHistory;
    slot.title = slot.suppressNewChatHistory ? "MyHarness" : "New Chat";
    slot.assistantNode = null;
    slot.workflowNode = null;
    slot.workflowList = null;
    slot.workflowSummary = null;
    slot.workflowSteps = [];
  }
  if (event.type === "transcript_item" && !isNonConversationTranscriptItem(event.item)) {
    slot.hasConversation = true;
  }
  if (event.type === "assistant_delta" || event.type === "assistant_complete") {
    slot.hasConversation = true;
  }
  if (event.type === "active_session") {
    slot.savedSessionId = String(event.value || "").trim() || slot.savedSessionId;
  }
  if (event.type === "session_title" && event.message) {
    slot.title = String(event.message || "").trim() || slot.title;
  }
  if (event.type === "line_complete" || event.type === "error" || event.type === "shutdown") {
    slot.busy = false;
    slot.busyVisual = false;
  }
}

function processPendingSlotEvents(slot) {
  if (!slot || !slot.pendingEvents.length) {
    return;
  }
  const pending = slot.pendingEvents.splice(0);
  for (const event of pending) {
    handleEvent(event);
  }
  snapshotActiveSlot();
}

function handleSessionEvent(sessionId, event) {
  const slot = slotForBackendSession(sessionId);
  if (!slot) {
    return;
  }
  updateSlotFromEvent(slot, event);
  if (slot.frontendId !== state.activeFrontendId) {
    slot.pendingEvents.push(event);
    if (event.type === "line_complete" || event.type === "error" || event.type === "shutdown" || event.type === "session_title") {
      markActiveHistory();
      ctx.requestHistory?.().catch(() => {});
    }
    return;
  }
  handleEvent(event);
  if (slot.busy && !["line_complete", "error", "shutdown"].includes(event.type)) {
    setBusy(true, STATUS_LABELS.processing);
  }
  snapshotActiveSlot();
}

function switchChatSlot(frontendId) {
  const slot = state.chatSlots.get(frontendId);
  if (!slot) {
    return;
  }
  snapshotActiveSlot();
  resetWorkflowPanel();
  restoreSlot(slot);
  processPendingSlotEvents(slot);
}

async function startBackendSlot({ makeActive = true } = {}) {
  const payload = { permissionMode: "full_auto", clientId: state.clientId };
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
  const container = state.chatSlots.size === 0 ? els.messages : null;
  const slot = createChatSlot({ sessionId, workspace: session.workspace, container, makeActive });
  attachSlotSource(slot);
  return slot;
}

async function restoreLiveSlots() {
  const data = await getJson(`/api/live-sessions?clientId=${encodeURIComponent(state.clientId)}`);
  const liveSessions = Array.isArray(data.sessions) ? data.sessions : [];
  const sameWorkspace = liveSessions.filter((session) =>
    !state.workspacePath || !session.workspace?.path || session.workspace.path === state.workspacePath
  );
  if (!sameWorkspace.length) {
    return 0;
  }
  for (const session of sameWorkspace.slice(0, 3)) {
    const container = state.chatSlots.size === 0 ? els.messages : null;
    const slot = createChatSlot({
      sessionId: session.sessionId,
      workspace: session.workspace,
      container,
      makeActive: state.chatSlots.size === 0,
    });
    slot.busy = Boolean(session.busy);
    slot.savedSessionId = session.savedSessionId || "";
    if (slot.frontendId === state.activeFrontendId) {
      restoreSlot(slot);
    }
    attachSlotSource(slot);
  }
  return sameWorkspace.length;
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
  const restored = await restoreLiveSlots().catch(() => 0);
  if (restored > 0) {
    return;
  }
  const slot = await startBackendSlot({ makeActive: true });
  state.sessionId = slot.backendSessionId;
  if (els.sessionId) {
    els.sessionId.textContent = state.sessionId;
  }
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
  if (!shellCommand && state.busy) {
    if (activeRunningSlotCount() >= 3) {
      appendMessage("system", "동시 작업은 최대 3개입니다. 진행 중인 답변이 끝난 뒤 다시 보내주세요.");
      return;
    }
    const slot = await startBackendSlot({ makeActive: true });
    state.sessionId = slot.backendSessionId;
    renderWelcome();
  }
  if (!shellCommand && !state.busy && activeRunningSlotCount() >= 3) {
    appendMessage("system", "동시 작업은 최대 3개입니다. 진행 중인 답변이 끝난 뒤 다시 보내주세요.");
    return;
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
    const activeSlot = state.chatSlots.get(state.activeFrontendId);
    if (activeSlot) {
      activeSlot.hasConversation = true;
      activeSlot.showInHistory = false;
      activeSlot.suppressNewChatHistory = false;
      activeSlot.title = state.chatTitle;
    }
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
  const activeSlot = state.chatSlots.get(state.activeFrontendId);
  if (activeSlot) {
    activeSlot.busy = true;
    activeSlot.hasConversation = true;
    activeSlot.showInHistory = false;
    activeSlot.suppressNewChatHistory = false;
    activeSlot.title = state.chatTitle;
  }
  state.autoFollowMessages = true;
  await postJson("/api/message", { sessionId: state.sessionId, line: text, attachments });
  snapshotActiveSlot();
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
  const previousSlots = [...state.chatSlots.values()];
  state.sessionId = null;
  for (const slot of previousSlots) {
    slot.source?.close();
    if (slot.backendSessionId) {
      await shutdownSession(slot.backendSessionId).catch(() => {});
    }
    if (slot.container !== els.messages) {
      slot.container.remove();
    }
  }
  state.chatSlots.clear();
  state.activeFrontendId = "";
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
    state.switchingWorkspace = false;
    updateSendState();
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

async function openHistorySession(sessionId, title) {
  if (!sessionId) {
    return;
  }
  let activeSlot = state.chatSlots.get(state.activeFrontendId);
  const activeSlotHasMessages = Boolean(activeSlot?.container?.querySelector(".message"));
  if (isEmptyNewChatSlot(activeSlot) || (activeSlot?.showInHistory && !activeSlot.busy && !activeSlotHasMessages)) {
    activeSlot.hasConversation = false;
    activeSlot.showInHistory = true;
    activeSlot.suppressNewChatHistory = false;
    activeSlot.title = "New Chat";
    activeSlot = await startBackendSlot({ makeActive: true });
  }
  if (activeSlot) {
    activeSlot.showInHistory = false;
    activeSlot.suppressNewChatHistory = true;
    activeSlot.title = title || "저장된 대화";
  }
  saveScrollPosition();
  els.messages.textContent = "";
  state.activeHistoryId = sessionId;
  state.pendingScrollRestoreId = state.activeHistoryId;
  state.restoringHistory = true;
  state.batchingHistoryRestore = true;
  state.ignoreScrollSave = true;
  setChatTitle(title || "저장된 대화");
  markActiveHistory();
  setBusy(true, STATUS_LABELS.restoring);
  await sendBackendRequest({ type: "apply_select_command", command: "resume", value: sessionId });
}

async function clearChat() {
  const activeSlot = state.chatSlots.get(state.activeFrontendId);
  const activeSlotHasMessages = Boolean(activeSlot?.container?.querySelector(".message"));
  if (activeSlot && (isEmptyNewChatSlot(activeSlot) || (!activeSlot.hasConversation && !activeSlotHasMessages))) {
    els.input.value = "";
    clearComposerToken();
    clearPastedTexts();
    clearAttachments();
    autoSizeInput();
    renderWelcome();
    resetArtifacts();
    activeSlot.showInHistory = true;
    activeSlot.suppressNewChatHistory = false;
    activeSlot.title = "New Chat";
    markActiveHistory();
    updateSendState();
    ctx.requestHistory?.().catch(() => {});
    return;
  }
  const existingDraft = [...state.chatSlots.values()].find((slot) =>
    slot.frontendId !== state.activeFrontendId && isEmptyNewChatSlot(slot)
  );
  if (existingDraft) {
    els.input.value = "";
    clearComposerToken();
    clearPastedTexts();
    clearAttachments();
    autoSizeInput();
    switchChatSlot(existingDraft.frontendId);
    return;
  }
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
  const clearedSlot = state.chatSlots.get(state.activeFrontendId);
  if (clearedSlot) {
    clearedSlot.hasConversation = false;
    clearedSlot.showInHistory = true;
    clearedSlot.suppressNewChatHistory = false;
    clearedSlot.title = "New Chat";
    clearedSlot.assistantNode = null;
    clearedSlot.workflowNode = null;
    clearedSlot.workflowList = null;
    clearedSlot.workflowSummary = null;
    clearedSlot.workflowSteps = [];
  }
  markActiveHistory();
  updateSendState();
  ctx.requestHistory?.().catch(() => {});
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
  item?.remove();
  forgetScrollPosition(sessionId);
  if (state.activeHistoryId === sessionId) {
    state.activeHistoryId = null;
    state.pendingScrollRestoreId = null;
    state.restoringHistory = false;
    state.batchingHistoryRestore = false;
    renderWelcome();
  }
  for (const slot of state.chatSlots.values()) {
    if (slot.savedSessionId === sessionId) {
      slot.savedSessionId = "";
      slot.showInHistory = false;
    }
  }
  if (!els.historyList.querySelector(".history-item")) {
    ctx.renderHistory?.([]);
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
    switchChatSlot,
    activeRunningSlotCount,
    setActiveWorkspace,
    sendLine,
    cancelCurrent,
    sendBackendRequest,
    setSystemPrompt,
    requestSelectCommand,
    refreshSkills,
    openHistorySession,
    clearChat,
    requestHistory,
    deleteHistorySession,
  };
}
