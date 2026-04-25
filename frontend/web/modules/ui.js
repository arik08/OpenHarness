const scrollStorageKey = "openharness:scrollPositions";
let scrollRestoreTimer = 0;
let scrollSaveTimer = 0;
let scrollAnimationFrame = 0;

export function createUI(ctx) {
  const { state, els, STATUS_LABELS } = ctx;
  function markActiveHistory(...args) { return ctx.markActiveHistory(...args); }

function readScrollPositions() {
  try {
    return JSON.parse(localStorage.getItem(scrollStorageKey) || "{}");
  } catch {
    return {};
  }
}

function saveScrollPosition(sessionId = state.activeHistoryId) {
  if (!sessionId || state.ignoreScrollSave || state.restoringHistory) {
    return;
  }
  const positions = readScrollPositions();
  positions[sessionId] = els.messages.scrollTop;
  localStorage.setItem(scrollStorageKey, JSON.stringify(positions));
}

function scheduleScrollPositionSave() {
  window.clearTimeout(scrollSaveTimer);
  scrollSaveTimer = window.setTimeout(() => saveScrollPosition(), 120);
}

function restoreScrollPosition(sessionId = state.pendingScrollRestoreId || state.activeHistoryId) {
  if (!sessionId) {
    return false;
  }
  const position = readScrollPositions()[sessionId];
  if (typeof position !== "number") {
    return false;
  }
  els.messages.scrollTop = position;
  return true;
}

function forgetScrollPosition(sessionId) {
  if (!sessionId) {
    return;
  }
  const positions = readScrollPositions();
  delete positions[sessionId];
  localStorage.setItem(scrollStorageKey, JSON.stringify(positions));
}

function isNearMessageBottom() {
  const remaining = els.messages.scrollHeight - els.messages.clientHeight - els.messages.scrollTop;
  return remaining <= 36;
}

function scrollMessagesToBottom(options = {}) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (options.smooth && !reduceMotion) {
    window.cancelAnimationFrame(scrollAnimationFrame);
    const start = els.messages.scrollTop;
    const target = els.messages.scrollHeight - els.messages.clientHeight;
    const distance = target - start;
    const duration = Number(options.duration || 760);
    const startedAt = performance.now();
    state.autoScrollUntil = Date.now() + duration + 260;

    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      els.messages.scrollTop = start + distance * eased;
      if (progress < 1 && state.autoFollowMessages) {
        scrollAnimationFrame = window.requestAnimationFrame(step);
      }
    };
    scrollAnimationFrame = window.requestAnimationFrame(step);
    return;
  }
  window.cancelAnimationFrame(scrollAnimationFrame);
  state.autoScrollUntil = Date.now() + 120;
  els.messages.scrollTop = els.messages.scrollHeight;
}

function finishScrollRestore() {
  window.clearTimeout(scrollRestoreTimer);
  const hasSavedPosition = restoreScrollPosition();
  if (!hasSavedPosition) {
    if (state.restoringHistory) {
      els.messages.scrollTop = 0;
    } else {
      scrollMessagesToBottom();
    }
  }
  state.pendingScrollRestoreId = null;
  state.restoringHistory = false;
  state.batchingHistoryRestore = false;
  requestAnimationFrame(() => {
    state.ignoreScrollSave = false;
  });
}

function scheduleScrollRestore() {
  if (!state.pendingScrollRestoreId) {
    return;
  }
  window.clearTimeout(scrollRestoreTimer);
  scrollRestoreTimer = window.setTimeout(finishScrollRestore, 120);
}

function setChatTitle(value) {
  const title = String(value || "").trim() || "MyHarness";
  state.chatTitle = title;
  if (els.chatTitle) {
    els.chatTitle.textContent = title.length > 58 ? `${title.slice(0, 55)}...` : title;
  }
  if (state.activeHistoryId) {
    const activeTitle = els.historyList.querySelector(
      `.history-item[data-session-id="${CSS.escape(state.activeHistoryId)}"] .history-open span`,
    );
    if (activeTitle) {
      activeTitle.textContent = title.length > 28 ? `${title.slice(0, 25)}...` : title;
    }
  }
}

function finishTitleEdit(input, commit) {
  const nextTitle = input.value.trim();
  input.remove();
  els.chatTitleButton.classList.remove("editing");
  state.editingTitle = false;
  const label = document.createElement("span");
  els.chatTitleButton.textContent = "";
  els.chatTitleButton.append(label);
  els.chatTitle = label;
  setChatTitle(commit && nextTitle ? nextTitle : state.chatTitle);
}

function startTitleEdit() {
  if (state.editingTitle || !els.chatTitleButton) {
    return;
  }
  state.editingTitle = true;
  const currentTitle = state.chatTitle;
  const input = document.createElement("input");
  input.className = "chat-title-input";
  input.type = "text";
  input.value = currentTitle;
  input.setAttribute("aria-label", "채팅 제목 수정");
  els.chatTitleButton.classList.add("editing");
  els.chatTitleButton.textContent = "";
  els.chatTitleButton.append(input);
  input.focus();
  input.select();
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishTitleEdit(input, true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finishTitleEdit(input, false);
    }
  });
  input.addEventListener("blur", () => finishTitleEdit(input, true), { once: true });
}

function setSidebarCollapsed(collapsed) {
  els.appShell?.classList.toggle("sidebar-collapsed", collapsed);
  const toggle = document.querySelector("[data-action='toggle-sidebar']");
  if (toggle) {
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const label = collapsed ? "사이드바 열기" : "사이드바 닫기";
    toggle.setAttribute("aria-label", label);
    toggle.dataset.tooltip = label;
  }
  localStorage.setItem("openharness:sidebarCollapsed", collapsed ? "1" : "0");
}

function setStatus(label, mode = "") {
  els.readyPill.textContent = label;
  els.readyPill.className = `status-pill ${mode}`.trim();
  if (els.sessionStatus) {
    els.sessionStatus.textContent = label;
  }
}

function updateWorkspaceDisplay() {
  if (!els.workspaceNames?.length) {
    return;
  }
  const name = state.workspaceName || "Default";
  els.workspaceNames.forEach((node) => {
    node.textContent = name;
  });
  document.querySelectorAll("[data-action='open-workspace']").forEach((button) => {
    button.removeAttribute("title");
    button.dataset.tooltip = `현재 프로젝트: ${name}`;
  });
}

function renderWelcome() {
  els.messages.textContent = "";
  setChatTitle("MyHarness");
  const welcome = document.createElement("div");
  welcome.className = "welcome";

  const mark = document.createElement("span");
  mark.className = "welcome-mark";
  mark.textContent = "MH";

  const title = document.createElement("h2");
  title.textContent = "무엇을 도와드릴까요?";

  const copy = document.createElement("p");
  copy.textContent =
    "업무에 필요한 조사, 정리, 코드 작업을 도와드릴 준비가 되어 있습니다.";

  welcome.append(mark, title, copy);
  els.messages.append(welcome);
}

function removeWelcome() {
  const welcome = els.messages.querySelector(".welcome");
  if (welcome) {
    welcome.remove();
  }
}

function updateSendState() {
  const composerText = buildComposerLine().trim();
  const hasText = composerText.length > 0;
  const shellCommand = /^!(?!\s*$)/.test(composerText);
  els.input.disabled = Boolean(state.switchingWorkspace);
  els.send.disabled =
    state.switchingWorkspace
    || (!shellCommand && !state.ready)
    || (!state.busy && !hasText && state.attachments.length === 0);
  els.send.classList.toggle("is-stop", state.busy);
  els.send.setAttribute("aria-label", state.busy ? "작업 중단" : "메시지 보내기");
  els.send.innerHTML = state.busy
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"></rect></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>';
}

function setBusy(value, label = value ? STATUS_LABELS.thinking : STATUS_LABELS.ready) {
  state.busy = value;
  setStatus(label, value ? "busy" : state.ready ? "ready" : "");
  updateSendState();
  markActiveHistory();
}

function autoSizeInput() {
  const style = window.getComputedStyle(els.input);
  const maxHeight = Number.parseFloat(style.getPropertyValue("--composer-input-max-height")) || 96;
  const minHeight = Number.parseFloat(style.minHeight) || 20;
  els.input.style.height = "auto";
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, els.input.scrollHeight));
  els.input.style.height = `${nextHeight}px`;
  els.input.style.overflowY = els.input.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
  els.composerBox?.classList.toggle("multiline", nextHeight > minHeight + 12);
}

function prettifyComposerToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (token.startsWith("/")) {
    return token.slice(1);
  }
  if (!token.startsWith("$")) {
    return token;
  }
  const normalized = token
    .slice(1)
    .replace(/^["']|["']$/g, "")
    .trim();
  const normalizedLower = normalized.toLowerCase();
  const displayName =
    (normalizedLower.startsWith("mcp:") || normalizedLower.startsWith("plugin:"))
      ? normalized.slice(normalized.indexOf(":") + 1)
      : normalized.includes(":")
        ? normalized.split(":")[0]
        : normalized;
  const name = displayName
    .replace(/[-_]+/g, " ")
    .trim();
  return name ? name.replace(/\b\w/g, (char) => char.toUpperCase()) : token;
}

function normalizeSkillTokenName(rawToken) {
  return String(rawToken || "")
    .trim()
    .slice(1)
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
}

function knownCommand(rawToken) {
  const token = String(rawToken || "").trim().toLowerCase();
  if (state.commands.some((command) => String(command.name || "").toLowerCase() === token)) {
    return true;
  }
  return typeof ctx.commandDescription === "function"
    && ctx.commandDescription(token, "__unknown__") !== "__unknown__";
}

function knownSkill(rawToken) {
  const name = normalizeSkillTokenName(rawToken);
  return state.skills.some((skill) => String(skill.name || "").toLowerCase() === name)
    || state.mcpServers.some((server) => `mcp:${String(server.name || "").toLowerCase()}` === name)
    || state.plugins.some((plugin) => `plugin:${String(plugin.name || "").toLowerCase()}` === name)
    || /^\$[^:\s]+:[^:\s]+$/i.test(String(rawToken || "").trim());
}

function parseComposerToken(value) {
  const text = String(value || "");
  const match = text.match(/^(\$"[^"]+"|\$'[^']+'|\$[^\s]+|\/[a-z][a-z0-9-]*)([\s\S]*)$/i);
  if (!match) {
    return null;
  }
  const raw = match[1];
  const remainder = match[2] || "";
  const hasBoundary = remainder.length > 0 && /^\s/.test(remainder);
  const exactKnown = raw.startsWith("/") ? knownCommand(raw) : knownSkill(raw);
  if (!hasBoundary && !exactKnown) {
    return null;
  }
  return {
    raw,
    rest: remainder.replace(/^\s+/, ""),
    kind: raw.startsWith("$") ? "skill" : "command",
    label: prettifyComposerToken(raw),
  };
}

function renderComposerToken() {
  if (!els.composerToken) {
    return;
  }
  els.composerToken.textContent = "";
  if (!state.composerToken) {
    els.composerToken.className = "composer-token-slot hidden";
    els.composerToken.setAttribute("aria-hidden", "true");
    return;
  }
  els.composerToken.className = `composer-token-slot ${state.composerToken.kind}`;
  els.composerToken.setAttribute("aria-hidden", "false");
  els.composerToken.title = state.composerToken.raw;

  const chip = document.createElement("span");
  chip.className = `prompt-token ${state.composerToken.kind}`;
  chip.textContent = state.composerToken.label;
  els.composerToken.append(chip);
}

function setComposerToken(token) {
  state.composerToken = token;
  renderComposerToken();
  updateSendState();
}

function clearComposerToken() {
  state.composerToken = null;
  renderComposerToken();
  updateSendState();
}

function setComposerTokenFromSelection(item) {
  if (!item) {
    return false;
  }
  if (["skill", "mcp", "plugin"].includes(item.kind)) {
    const raw = `$${item.name.slice(1)}`;
    els.input.value = "";
    setComposerToken({ raw, kind: item.kind, label: prettifyComposerToken(raw) });
  } else {
    els.input.value = "";
    setComposerToken({ raw: item.name, kind: "command", label: prettifyComposerToken(item.name) });
  }
  autoSizeInput();
  els.input.focus();
  return true;
}

function updateComposerTokenFromInput() {
  if (state.composerToken) {
    return false;
  }
  if ((els.input.selectionStart || 0) !== els.input.value.length) {
    return false;
  }
  const parsed = parseComposerToken(els.input.value);
  if (!parsed) {
    return false;
  }
  els.input.value = parsed.rest;
  els.input.setSelectionRange(els.input.value.length, els.input.value.length);
  setComposerToken({ raw: parsed.raw, kind: parsed.kind, label: parsed.label });
  if (ctx.closeSlashMenu) {
    ctx.closeSlashMenu();
  }
  autoSizeInput();
  return true;
}

function buildComposerLine(value = els.input.value) {
  const rest = String(value || "").trim();
  const pasted = state.pastedTexts.map((item) => item.text).filter(Boolean);
  const body = [rest, ...pasted].filter(Boolean).join("\n\n");
  if (!state.composerToken) {
    return body;
  }
  return [state.composerToken.raw, body].filter(Boolean).join(" ");
}

function pastedTextId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function countTextLines(value) {
  return String(value || "").replace(/\r\n/g, "\n").split("\n").length;
}

function renderPastedTexts() {
  if (!els.pastedTextTray) {
    return;
  }
  els.pastedTextTray.textContent = "";
  els.pastedTextTray.classList.toggle("hidden", state.pastedTexts.length === 0);
  state.pastedTexts.forEach((item, index) => {
    const chip = document.createElement("div");
    chip.className = "pasted-text-chip";
    chip.title = item.text.slice(0, 500);

    const label = document.createElement("span");
    const lineCount = item.lineCount || countTextLines(item.text);
    label.textContent = `[Pasted text #${index + 1} +${lineCount} lines]`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pasted-text-remove";
    remove.dataset.id = item.id;
    remove.setAttribute("aria-label", "Remove pasted text");
    remove.textContent = "x";

    chip.append(label, remove);
    els.pastedTextTray.append(chip);
  });
}

function addPastedText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return false;
  }
  state.pastedTexts.push({
    id: pastedTextId(),
    text: normalized,
    lineCount: countTextLines(normalized),
  });
  renderPastedTexts();
  updateSendState();
  return true;
}

function removePastedText(id) {
  state.pastedTexts = state.pastedTexts.filter((item) => item.id !== id);
  renderPastedTexts();
  updateSendState();
}

function clearPastedTexts() {
  state.pastedTexts = [];
  renderPastedTexts();
  updateSendState();
}

function renderAttachments() {
  if (!els.attachmentTray) {
    return;
  }
  els.attachmentTray.textContent = "";
  els.attachmentTray.classList.toggle("hidden", state.attachments.length === 0);
  for (const attachment of state.attachments) {
    const item = document.createElement("div");
    item.className = "attachment-chip";

    const image = document.createElement("img");
    image.src = `data:${attachment.mediaType};base64,${attachment.data}`;
    image.alt = attachment.name || "첨부 이미지";

    const label = document.createElement("span");
    label.textContent = attachment.name || "이미지";
    label.title = attachment.name || "이미지";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", "첨부 이미지 삭제");
    remove.dataset.id = attachment.id;
    remove.textContent = "x";

    item.append(image, label, remove);
    els.attachmentTray.append(item);
  }
}

function clearAttachments() {
  state.attachments = [];
  renderAttachments();
  updateSendState();
}

els.composerToken?.addEventListener("click", () => {
  clearComposerToken();
  els.input.focus();
});

  return {
    saveScrollPosition,
    scheduleScrollPositionSave,
    restoreScrollPosition,
    forgetScrollPosition,
    isNearMessageBottom,
    scrollMessagesToBottom,
    finishScrollRestore,
    scheduleScrollRestore,
    setChatTitle,
    startTitleEdit,
    setSidebarCollapsed,
    setStatus,
    updateWorkspaceDisplay,
    renderWelcome,
    removeWelcome,
    updateSendState,
    setBusy,
    autoSizeInput,
    clearComposerToken,
    setComposerTokenFromSelection,
    updateComposerTokenFromInput,
    buildComposerLine,
    addPastedText,
    removePastedText,
    renderPastedTexts,
    clearPastedTexts,
    renderAttachments,
    clearAttachments,
  };
}
