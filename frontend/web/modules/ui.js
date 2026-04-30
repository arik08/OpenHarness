const scrollStorageKey = "myharness:scrollPositions";
let fallbackScrollPositions = {};
let scrollRestoreTimer = 0;
let scrollSaveTimer = 0;
let scrollAnimationFrame = 0;
let tailFollowAnimationActive = false;
let userScrollIntentUntil = 0;
let busyVisualTimer = 0;
let pendingBusyLabel = "";
let composerMetricsObserver = null;
const BUSY_VISUAL_DELAY_MS = 280;
const NEAR_BOTTOM_PX = 96;

export function createUI(ctx) {
  const { state, els, STATUS_LABELS } = ctx;
  function markActiveHistory(...args) { return ctx.markActiveHistory(...args); }
  function showImagePreview(...args) { return ctx.showImagePreview?.(...args); }
  function appendMessage(...args) { return ctx.appendMessage?.(...args); }

function updateComposerMetrics() {
  const composerRect = els.composer?.getBoundingClientRect();
  const inputStackRect = els.composerBox?.getBoundingClientRect() || els.input?.getBoundingClientRect();
  const checklistRect = els.todoChecklistDock?.classList.contains("hidden")
    ? null
    : els.todoChecklistDock?.getBoundingClientRect();
  const checklistSoftReserve = checklistRect
    ? Math.min(160, Math.max(0, checklistRect.height * 0.7))
    : 0;
  const reserveTop = (inputStackRect?.top ?? composerRect?.top) - checklistSoftReserve;
  const height = composerRect && Number.isFinite(reserveTop)
    ? Math.ceil(Math.max(0, composerRect.bottom - reserveTop))
    : Math.ceil(els.composer?.getBoundingClientRect().height || 0);
  if (height > 0) {
    document.documentElement.style.setProperty("--composer-stack-height", `${height}px`);
  }
  const chatPanel = els.composer?.closest(".chat-panel") || document.querySelector(".chat-panel");
  const rect = chatPanel?.getBoundingClientRect();
  if (rect) {
    document.documentElement.style.setProperty("--chat-panel-left", `${Math.round(rect.left)}px`);
    document.documentElement.style.setProperty("--chat-panel-width", `${Math.round(rect.width)}px`);
  }
}

function readScrollPositions() {
  try {
    return JSON.parse(sessionStorage.getItem(scrollStorageKey) || "{}");
  } catch {
    return fallbackScrollPositions;
  }
}

function saveScrollPosition(sessionId = state.activeHistoryId) {
  if (!sessionId || state.ignoreScrollSave || state.restoringHistory) {
    return;
  }
  const positions = readScrollPositions();
  positions[sessionId] = els.messages.scrollTop;
  fallbackScrollPositions = positions;
  try {
    sessionStorage.setItem(scrollStorageKey, JSON.stringify(positions));
  } catch {
    // Embedded or private browsing contexts can block sessionStorage.
  }
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
  fallbackScrollPositions = positions;
  try {
    sessionStorage.setItem(scrollStorageKey, JSON.stringify(positions));
  } catch {
    // Embedded or private browsing contexts can block sessionStorage.
  }
}

function isNearMessageBottom(container = els.messages) {
  const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
  return remaining <= NEAR_BOTTOM_PX;
}

function stopMessagesAutoFollow(container = els.messages) {
  window.cancelAnimationFrame(scrollAnimationFrame);
  scrollAnimationFrame = 0;
  tailFollowAnimationActive = false;
  state.autoFollowMessages = false;
  state.autoScrollUntil = 0;
  container?.classList.remove("streaming-follow");
  if (container !== els.messages) {
    els.messages?.classList.remove("streaming-follow");
  }
}

function markMessagesUserScrollIntent() {
  userScrollIntentUntil = Date.now() + 900;
}

function updateAutoFollowFromScroll(container = els.messages) {
  if (state.restoringHistory || state.ignoreScrollSave) {
    return;
  }
  const currentTop = container.scrollTop;
  const previousTop = Number(container.dataset.lastScrollTop);
  const movedUp = Number.isFinite(previousTop) && currentTop < previousTop - 2;
  const userScrolling = Date.now() <= userScrollIntentUntil;
  const nearBottom = isNearMessageBottom(container);
  if (userScrolling && !nearBottom) {
    stopMessagesAutoFollow(container);
  } else if (movedUp) {
    if (userScrolling || Date.now() >= state.autoScrollUntil) {
      stopMessagesAutoFollow(container);
    }
  } else if (Date.now() < state.autoScrollUntil) {
    state.autoFollowMessages = true;
  } else {
    state.autoFollowMessages = nearBottom;
  }
  container.dataset.lastScrollTop = String(currentTop);
}

function attachMessageAutoFollow(container = els.messages) {
  if (!container || container.dataset.slotScrollAttached === "true") {
    return;
  }
  container.dataset.slotScrollAttached = "true";
  container.addEventListener("scroll", () => {
    updateAutoFollowFromScroll(container);
    scheduleScrollPositionSave();
  });
  container.addEventListener("wheel", (event) => {
    markMessagesUserScrollIntent();
    if (event.deltaY < 0) {
      stopMessagesAutoFollow(container);
    }
  }, { passive: true });
  container.addEventListener("pointerdown", markMessagesUserScrollIntent);
  container.addEventListener("touchstart", markMessagesUserScrollIntent, { passive: true });
}

function scrollMessagesToBottom(options = {}) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const tail = els.messages.lastElementChild;
  const block = ["start", "center", "end", "nearest"].includes(options.block) ? options.block : null;
  const inline = ["start", "center", "end", "nearest"].includes(options.inline) ? options.inline : null;
  const canUseNativeAlignment = tail && (block || inline);
  if (canUseNativeAlignment) {
    window.cancelAnimationFrame(scrollAnimationFrame);
    scrollAnimationFrame = 0;
    tailFollowAnimationActive = false;
    const containerRect = els.messages.getBoundingClientRect();
    const tailRect = tail.getBoundingClientRect();
    const tailTop = tailRect.top - containerRect.top + els.messages.scrollTop;
    const tailLeft = tailRect.left - containerRect.left + els.messages.scrollLeft;
    const maxTop = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
    const maxLeft = Math.max(0, els.messages.scrollWidth - els.messages.clientWidth);
    const nearest = (start, size, current, viewportSize, max) => {
      if (start >= current && start + size <= current + viewportSize) {
        return current;
      }
      if (start < current) {
        return start;
      }
      return Math.min(max, start + size - viewportSize);
    };
    const targetFor = (alignment, start, size, current, viewportSize, max) => {
      if (alignment === "start") {
        return start;
      }
      if (alignment === "center") {
        return start - ((viewportSize - size) / 2);
      }
      if (alignment === "nearest") {
        return nearest(start, size, current, viewportSize, max);
      }
      return start + size - viewportSize;
    };
    const targetTop = Math.max(0, Math.min(maxTop, targetFor(block || "end", tailTop, tailRect.height, els.messages.scrollTop, els.messages.clientHeight, maxTop)));
    const targetLeft = Math.max(0, Math.min(maxLeft, targetFor(inline || "nearest", tailLeft, tailRect.width, els.messages.scrollLeft, els.messages.clientWidth, maxLeft)));
    const duration = Number(options.duration || 760);
    if (options.smooth && !reduceMotion) {
      const startTop = els.messages.scrollTop;
      const startLeft = els.messages.scrollLeft;
      const leftDistance = targetLeft - startLeft;
      const startedAt = performance.now();
      state.autoScrollUntil = Date.now() + duration + 260;

      const step = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const liveTargetTop = options.followTail
          ? Math.max(0, els.messages.scrollHeight - els.messages.clientHeight)
          : targetTop;
        els.messages.scrollTop = startTop + (liveTargetTop - startTop) * eased;
        els.messages.scrollLeft = startLeft + leftDistance * eased;
        if (progress < 1 && state.autoFollowMessages) {
          scrollAnimationFrame = window.requestAnimationFrame(step);
        } else {
          scrollAnimationFrame = 0;
          els.messages.dataset.lastScrollTop = String(els.messages.scrollTop);
        }
      };
      scrollAnimationFrame = window.requestAnimationFrame(step);
      return;
    }
    state.autoScrollUntil = Date.now() + 120;
    els.messages.scrollTop = targetTop;
    els.messages.scrollLeft = targetLeft;
    els.messages.dataset.lastScrollTop = String(els.messages.scrollTop);
    return;
  }
  if (options.smooth && !reduceMotion) {
    const continuousFollow = Boolean(options.followTail && options.continuous);
    const duration = Number(options.duration || 760);
    if (continuousFollow && tailFollowAnimationActive && scrollAnimationFrame) {
      state.autoScrollUntil = Date.now() + duration + 260;
      return;
    }
    window.cancelAnimationFrame(scrollAnimationFrame);
    tailFollowAnimationActive = continuousFollow;
    const start = els.messages.scrollTop;
    const startedAt = performance.now();
    let previousFrameAt = startedAt;
    let dampedTarget = start;
    state.autoScrollUntil = Date.now() + duration + 260;

    const step = (now) => {
      const target = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
      if (continuousFollow) {
        const elapsed = Math.min(64, Math.max(0, now - previousFrameAt));
        previousFrameAt = now;
        const dampingMs = Math.max(180, Math.min(520, duration * 0.22));
        const targetBlend = elapsed > 0 ? 1 - Math.exp(-elapsed / dampingMs) : 0;
        dampedTarget += (target - dampedTarget) * targetBlend;

        const distance = dampedTarget - els.messages.scrollTop;
        const followMs = Math.max(120, Math.min(360, duration * 0.16));
        const followBlend = elapsed > 0 ? 1 - Math.exp(-elapsed / followMs) : 0;
        els.messages.scrollTop = Math.abs(target - els.messages.scrollTop) < 0.75
          ? target
          : els.messages.scrollTop + (distance * followBlend);
        els.messages.dataset.lastScrollTop = String(els.messages.scrollTop);
        if (state.autoFollowMessages && tailFollowAnimationActive) {
          scrollAnimationFrame = window.requestAnimationFrame(step);
        } else {
          tailFollowAnimationActive = false;
          scrollAnimationFrame = 0;
        }
        return;
      }

      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      els.messages.scrollTop = start + (target - start) * eased;
      if (progress < 1 && state.autoFollowMessages) {
        scrollAnimationFrame = window.requestAnimationFrame(step);
      } else {
        tailFollowAnimationActive = false;
        scrollAnimationFrame = 0;
        els.messages.dataset.lastScrollTop = String(els.messages.scrollTop);
      }
    };
    scrollAnimationFrame = window.requestAnimationFrame(step);
    return;
  }
  window.cancelAnimationFrame(scrollAnimationFrame);
  scrollAnimationFrame = 0;
  tailFollowAnimationActive = false;
  state.autoScrollUntil = Date.now() + 120;
  els.messages.scrollTop = els.messages.scrollHeight;
  els.messages.dataset.lastScrollTop = String(els.messages.scrollTop);
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
  if (state.restoreTimeoutId) {
    window.clearTimeout(state.restoreTimeoutId);
    state.restoreTimeoutId = 0;
  }
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

function activeSavedSessionId() {
  const activeSlot = state.chatSlots.get(state.activeFrontendId);
  return String(state.activeHistoryId || activeSlot?.savedSessionId || "").trim();
}

async function persistChatTitle(title, previousTitle) {
  const activeSlot = state.chatSlots.get(state.activeFrontendId);
  if (activeSlot) {
    activeSlot.title = title;
  }
  const savedSessionId = activeSavedSessionId();
  const updateBackend = state.sessionId && ctx.sendBackendRequest
    ? ctx.sendBackendRequest({ type: "update_session_title", value: title })
    : Promise.resolve();
  const updateHistoryFile = savedSessionId && ctx.postJson
    ? ctx.postJson("/api/history/title", {
      sessionId: savedSessionId,
      title,
      workspacePath: state.workspacePath,
      workspaceName: state.workspaceName,
    })
    : Promise.resolve();

  try {
    await updateHistoryFile;
    await updateBackend;
    await ctx.requestHistory?.();
  } catch (error) {
    if (activeSlot) {
      activeSlot.title = previousTitle;
    }
    setChatTitle(previousTitle);
    appendMessage("system", `채팅 제목 저장 실패: ${error.message}`);
  }
}

function finishTitleEdit(input, commit) {
  if (!state.editingTitle) {
    return;
  }
  const previousTitle = state.chatTitle;
  const nextTitle = input.value.trim();
  input.remove();
  els.chatTitleButton.classList.remove("editing");
  state.editingTitle = false;
  const label = document.createElement("span");
  els.chatTitleButton.textContent = "";
  els.chatTitleButton.append(label);
  els.chatTitle = label;
  if (!commit || !nextTitle) {
    setChatTitle(previousTitle);
    return;
  }
  setChatTitle(nextTitle);
  persistChatTitle(nextTitle, previousTitle);
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
  localStorage.setItem("myharness:sidebarCollapsed", collapsed ? "1" : "0");
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
  const canSteer = Boolean(state.busy && hasText && !shellCommand);
  const showStop = Boolean(state.busy && state.busyVisual && !canSteer);
  els.input.disabled = Boolean(state.switchingWorkspace);
  els.send.disabled =
    state.switchingWorkspace
    || (state.busy && !showStop && !canSteer)
    || (!shellCommand && state.sessionId && !state.ready)
    || (!state.busy && !hasText && state.attachments.length === 0);
  els.send.classList.toggle("is-stop", showStop);
  els.send.classList.toggle("is-steer", canSteer);
  els.send.setAttribute("aria-label", showStop ? "작업 중단" : canSteer ? "스티어링 보내기" : "메시지 보내기");
  els.send.innerHTML = showStop
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"></circle><path d="M15.5 8.5 8.5 15.5"></path><path d="m8.5 8.5 7 7"></path></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>';
}

function setBusy(value, label = value ? STATUS_LABELS.thinking : STATUS_LABELS.ready) {
  state.busy = value;
  window.clearTimeout(busyVisualTimer);
  busyVisualTimer = 0;
  pendingBusyLabel = label;
  if (value) {
    busyVisualTimer = window.setTimeout(() => {
      busyVisualTimer = 0;
      if (!state.busy) {
        return;
      }
      state.busyVisual = true;
      const activeSlot = state.chatSlots.get(state.activeFrontendId);
      if (activeSlot) {
        activeSlot.busyVisual = true;
      }
      setStatus(pendingBusyLabel || label, "busy");
      updateSendState();
      markActiveHistory();
    }, BUSY_VISUAL_DELAY_MS);
  } else {
    state.busyVisual = false;
    const activeSlot = state.chatSlots.get(state.activeFrontendId);
    if (activeSlot) {
      activeSlot.busyVisual = false;
    }
    setStatus(label, state.ready ? "ready" : "");
  }
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
  updateComposerMetrics();
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
  return false;
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
  updateComposerMetrics();
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
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.title = "크게 보기";
    image.addEventListener("click", () => {
      showImagePreview({
        src: image.src,
        name: attachment.name || "이미지",
        alt: image.alt,
      });
    });
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showImagePreview({
          src: image.src,
          name: attachment.name || "이미지",
          alt: image.alt,
        });
      }
    });

    const label = document.createElement("span");
    label.textContent = attachment.name || "이미지";
    label.title = attachment.name || "이미지";
    label.addEventListener("click", () => {
      showImagePreview({
        src: image.src,
        name: attachment.name || "이미지",
        alt: image.alt,
      });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", "첨부 이미지 삭제");
    remove.dataset.id = attachment.id;
    remove.textContent = "x";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.attachments = state.attachments.filter((item) => item.id !== attachment.id);
      renderAttachments();
      updateSendState();
    });

    item.append(image, label, remove);
    els.attachmentTray.append(item);
  }
  updateComposerMetrics();
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

if (els.composer && "ResizeObserver" in window) {
  composerMetricsObserver = new ResizeObserver(updateComposerMetrics);
  composerMetricsObserver.observe(els.composer);
  const chatPanel = els.composer.closest(".chat-panel");
  if (chatPanel) {
    composerMetricsObserver.observe(chatPanel);
  }
}
window.addEventListener("resize", updateComposerMetrics);
window.requestAnimationFrame(updateComposerMetrics);

  return {
    saveScrollPosition,
    scheduleScrollPositionSave,
    restoreScrollPosition,
    forgetScrollPosition,
    isNearMessageBottom,
    markMessagesUserScrollIntent,
    stopMessagesAutoFollow,
    updateAutoFollowFromScroll,
    attachMessageAutoFollow,
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
