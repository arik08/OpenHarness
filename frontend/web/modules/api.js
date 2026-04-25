export function createApi(ctx) {
  const { state, els, STATUS_LABELS } = ctx;
  function handleEvent(...args) { return ctx.handleEvent(...args); }
  function setStatus(...args) { return ctx.setStatus(...args); }
  function resetWorkflowPanel(...args) { return ctx.resetWorkflowPanel(...args); }
  function ensureWorkflowPanel(...args) { return ctx.ensureWorkflowPanel(...args); }
  function setChatTitle(...args) { return ctx.setChatTitle(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
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

async function sendLine(line) {
  const text = line.trim();
  const attachments = state.attachments.map((attachment) => ({
    media_type: attachment.media_type || attachment.mediaType,
    data: attachment.data,
    name: attachment.name,
  })).filter((attachment) => attachment.media_type && attachment.data);
  if ((!text && attachments.length === 0) || !state.sessionId) {
    return;
  }
  resetWorkflowPanel();
  resetArtifacts();
  if (state.chatTitle === "MyHarness" && !text.startsWith("/")) {
    setChatTitle(text || "이미지 첨부");
  }
  appendMessage("user", text, attachments);
  if (!text.startsWith("/")) {
    ensureWorkflowPanel();
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
    sendBackendRequest,
    setSystemPrompt,
    requestSelectCommand,
    refreshSkills,
    clearChat,
    requestHistory,
    deleteHistorySession,
  };
}
