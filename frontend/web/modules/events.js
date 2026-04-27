import { compactToolProgressStatus } from "./state.js";

export function createEvents(ctx) {
  const { state, els, STATUS_LABELS, commandDescription, updateState } = ctx;
  let restoringWorkflowEvents = [];
  let restoringWorkflowInputDeltas = [];
  function setStatus(...args) { return ctx.setStatus(...args); }
  function setBusy(...args) { return ctx.setBusy(...args); }
  function updateTasks(...args) { return ctx.updateTasks(...args); }
  function updateSendState(...args) { return ctx.updateSendState(...args); }
  function requestHistory(...args) { return ctx.requestHistory(...args); }
  function cachedHistoryForWorkspace(...args) { return ctx.cachedHistoryForWorkspace?.(...args) || []; }
  function renderHistory(...args) { return ctx.renderHistory(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
  function setChatTitle(...args) { return ctx.setChatTitle(...args); }
  function renderWelcome(...args) { return ctx.renderWelcome(...args); }
  function resetWorkflowPanel(...args) { return ctx.resetWorkflowPanel(...args); }
  function collapseWorkflowPanel(...args) { return ctx.collapseWorkflowPanel(...args); }
  function finalizeWorkflowSummary(...args) { return ctx.finalizeWorkflowSummary(...args); }
  function failWorkflowPanel(...args) { return ctx.failWorkflowPanel?.(...args); }
  function startWorkflowFinalAnswer(...args) { return ctx.startWorkflowFinalAnswer?.(...args); }
  function clearWorkflowFinalAnswerStep(...args) { return ctx.clearWorkflowFinalAnswerStep?.(...args); }
  function markWorkflowFinalAnswerDone(...args) { return ctx.markWorkflowFinalAnswerDone?.(...args); }
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }
  function scrollMessagesToBottom(...args) { return ctx.scrollMessagesToBottom(...args); }
  function finishScrollRestore(...args) { return ctx.finishScrollRestore(...args); }
  function appendWorkflowEvent(...args) { return ctx.appendWorkflowEvent(...args); }
  function appendWorkflowProgress(...args) { return ctx.appendWorkflowProgress?.(...args); }
  function appendWorkflowInputDelta(...args) { return ctx.appendWorkflowInputDelta?.(...args); }
  function markActiveHistory(...args) { return ctx.markActiveHistory?.(...args); }
  function showModal(...args) { return ctx.showModal(...args); }
  function showSelect(...args) { return ctx.showSelect(...args); }
  function updateSlashMenu(...args) { return ctx.updateSlashMenu(...args); }
  function extractAndRenderArtifacts(...args) { return ctx.extractAndRenderArtifacts?.(...args); }
  function resetArtifacts(...args) { return ctx.resetArtifacts?.(...args); }
  function setPlanModeIndicatorActive(...args) { return ctx.setPlanModeIndicatorActive?.(...args); }
  function attachAssistantActions(...args) { return ctx.attachAssistantActions?.(...args); }

let streamingRenderTimer = 0;
let streamingFlushTimer = 0;
let streamingScrollTimer = 0;
let streamingTextBuffer = "";
let streamingLiveNode = null;
let streamingRenderedTextLength = 0;
let streamingDisplayStarted = false;
const STREAMING_FLUSH_INTERVAL_MS = 36;
const STREAMING_START_BUFFER_MS = 180;
const STREAMING_MIN_CHARS_PER_FLUSH = 3;
const STREAMING_MAX_CHARS_PER_FLUSH = 12;

function streamingStartBufferMs() {
  const configured = Number(state.appSettings?.streamStartBufferMs);
  return Math.max(0, Math.min(2000, Number.isFinite(configured) ? configured : STREAMING_START_BUFFER_MS));
}

function streamingScrollOptions(duration = state.appSettings?.streamScrollDurationMs ?? 2000) {
  return {
    smooth: true,
    duration,
    followTail: true,
  };
}

function syncStreamingStyleOptions() {
  const followLead = Number(state.appSettings?.streamFollowLeadPx);
  const revealDuration = Number(state.appSettings?.streamRevealDurationMs);
  const revealWipe = Number(state.appSettings?.streamRevealWipePercent);
  els.messages.style.setProperty("--stream-follow-lead", `${Math.max(0, Math.min(220, Number.isFinite(followLead) ? followLead : 60))}px`);
  els.messages.style.setProperty("--stream-reveal-duration", `${Math.max(0, Math.min(2000, Number.isFinite(revealDuration) ? revealDuration : 420))}ms`);
  els.messages.style.setProperty("--stream-reveal-wipe", `${Math.max(100, Math.min(400, Number.isFinite(revealWipe) ? revealWipe : 180))}%`);
}

function normalizeSkills(skills) {
  return Array.isArray(skills)
    ? skills
        .map((skill) => ({
          name: String(skill.name || "").trim(),
          description: String(skill.description || "").trim(),
          source: String(skill.source || "").trim(),
          enabled: skill.enabled !== false,
        }))
        .filter((skill) => skill.name)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
}

function normalizeMcpServers(servers) {
  return Array.isArray(servers)
    ? servers
        .map((server) => ({
          name: String(server.name || "").trim(),
          description: String(server.detail || "").trim(),
          state: String(server.state || "").trim(),
          transport: String(server.transport || "").trim(),
          toolCount: Number(server.tool_count || 0),
          resourceCount: Number(server.resource_count || 0),
        }))
        .filter((server) => server.name)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
}

function normalizePlugins(plugins) {
  return Array.isArray(plugins)
    ? plugins
        .map((plugin) => ({
          name: String(plugin.name || "").trim(),
          description: String(plugin.description || "").trim(),
          enabled: plugin.enabled !== false,
          skillCount: Number(plugin.skill_count || 0),
          commandCount: Number(plugin.command_count || 0),
          mcpServerCount: Number(plugin.mcp_server_count || 0),
        }))
        .filter((plugin) => plugin.name)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
}

function isStreamingTextNode(node) {
  const parent = node.parentElement;
  return Boolean(parent && !parent.closest(".code-copy"));
}

function countRenderedStreamingText(root) {
  if (!root) {
    return 0;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isStreamingTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let length = 0;
  while (walker.nextNode()) {
    length += Array.from(walker.currentNode.nodeValue || "").length;
  }
  return length;
}

function revealRenderedStreamingContent(startIndex, endIndex) {
  if (!state.assistantNode || endIndex <= startIndex) {
    return 0;
  }
  const walker = document.createTreeWalker(state.assistantNode, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isStreamingTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const replacements = [];
  let cursor = 0;

  while (walker.nextNode() && cursor < endIndex) {
    const node = walker.currentNode;
    const chars = Array.from(node.nodeValue || "");
    const nextCursor = cursor + chars.length;
    if (nextCursor <= startIndex) {
      cursor = nextCursor;
      continue;
    }

    const localStart = Math.max(0, startIndex - cursor);
    const localEnd = Math.min(chars.length, endIndex - cursor);
    if (localEnd > localStart) {
      replacements.push({ node, chars, localStart, localEnd });
    }
    cursor = nextCursor;
  }

  for (const replacement of replacements) {
    const fragment = document.createDocumentFragment();
    const before = replacement.chars.slice(0, replacement.localStart).join("");
    const after = replacement.chars.slice(replacement.localEnd).join("");
    if (before) {
      fragment.append(document.createTextNode(before));
    }
    const revealText = replacement.chars.slice(replacement.localStart, replacement.localEnd).join("");
    if (revealText) {
      const span = document.createElement("span");
      span.className = "stream-reveal-sentence";
      span.style.setProperty("--stream-reveal-duration", els.messages.style.getPropertyValue("--stream-reveal-duration"));
      span.style.setProperty("--stream-reveal-wipe", els.messages.style.getPropertyValue("--stream-reveal-wipe"));
      span.textContent = revealText;
      fragment.append(span);
    }
    if (after) {
      fragment.append(document.createTextNode(after));
    }
    replacement.node.replaceWith(fragment);
  }
  return replacements.length;
}

function streamingRevealCount(pendingChars, flushAll = false) {
  if (flushAll) {
    return pendingChars.length;
  }
  const text = pendingChars.join("");
  const sentenceMatch = text.match(/^.{18,}?[.!?。！？…]\s*/u);
  if (sentenceMatch && sentenceMatch[0].length <= STREAMING_MAX_CHARS_PER_FLUSH) {
    return sentenceMatch[0].length;
  }
  const lineBreakIndex = text.slice(STREAMING_MIN_CHARS_PER_FLUSH).search(/\n/);
  if (lineBreakIndex >= 0) {
    return Math.min(STREAMING_MAX_CHARS_PER_FLUSH, STREAMING_MIN_CHARS_PER_FLUSH + lineBreakIndex + 1);
  }
  return Math.min(
    pendingChars.length,
    Math.max(STREAMING_MIN_CHARS_PER_FLUSH, Math.min(STREAMING_MAX_CHARS_PER_FLUSH, Math.ceil(pendingChars.length / 2))),
  );
}

function isMarkdownTableDivider(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .length >= 2
    && String(line || "")
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableLine(line) {
  return String(line || "").includes("|") && String(line || "").trim().length > 0;
}

function escapeMarkdownTablePipes(line) {
  return String(line || "").replace(/\|/g, "\\|");
}

function stabilizeStreamingTableRows(markdown) {
  const source = String(markdown || "");
  const lines = source.split("\n");
  if (lines.length < 2) {
    return source;
  }

  let tableStart = -1;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (isMarkdownTableLine(lines[index]) && isMarkdownTableDivider(lines[index + 1])) {
      tableStart = index;
    }
  }
  if (tableStart < 0) {
    return source;
  }

  let tableEnd = tableStart + 2;
  while (tableEnd < lines.length && isMarkdownTableLine(lines[tableEnd])) {
    tableEnd += 1;
  }

  const hasContentAfterTable = lines
    .slice(tableEnd)
    .some((line) => String(line || "").trim());
  if (hasContentAfterTable) {
    return source;
  }

  return lines
    .map((line, index) =>
      index >= tableStart && index < tableEnd
        ? escapeMarkdownTablePipes(line)
        : line,
    )
    .join("\n");
}

function keepStreamingTailVisible() {
  if (state.restoringHistory || !state.autoFollowMessages) {
    els.messages.classList.remove("streaming-follow");
    return;
  }
  syncStreamingStyleOptions();
  els.messages.classList.add("streaming-follow");
  if (streamingScrollTimer) {
    return;
  }
  streamingScrollTimer = window.setTimeout(() => {
    streamingScrollTimer = 0;
    if (!state.restoringHistory && state.autoFollowMessages) {
      scrollMessagesToBottom(streamingScrollOptions());
    }
  }, 60);
}

function settleStreamingTailVisible() {
  if (state.restoringHistory || !state.autoFollowMessages) {
    els.messages.classList.remove("streaming-follow");
    return;
  }
  window.clearTimeout(streamingScrollTimer);
  requestAnimationFrame(() => {
    els.messages.classList.remove("streaming-follow");
    scrollMessagesToBottom(streamingScrollOptions(760));
  });
}

function renderStreamingAssistant(revealStart = null) {
  if (!state.assistantNode) {
    return;
  }
  window.clearTimeout(streamingRenderTimer);
  streamingRenderTimer = 0;
  if (!state.assistantNode) {
    return;
  }
  const displayText = state.assistantNode.dataset.displayText || "";
  const renderText = stabilizeStreamingTableRows(displayText);
  const previousLength = Number.isFinite(revealStart) ? revealStart : streamingRenderedTextLength;
  const rawText = state.assistantNode.dataset.rawText || "";
  setMarkdown(state.assistantNode, renderText);
  state.assistantNode.dataset.rawText = rawText;
  state.assistantNode.dataset.displayText = displayText;
  streamingLiveNode = null;
  streamingRenderedTextLength = countRenderedStreamingText(state.assistantNode);
  syncStreamingStyleOptions();
  revealRenderedStreamingContent(previousLength, streamingRenderedTextLength);
  if (!state.restoringHistory && state.autoFollowMessages) {
    keepStreamingTailVisible();
  }
}

function flushStreamingText(options = {}) {
  const flushAll = Boolean(options.flushAll);
  window.clearTimeout(streamingFlushTimer);
  streamingFlushTimer = 0;
  if (!state.assistantNode || !streamingTextBuffer) {
    return;
  }
  streamingDisplayStarted = true;
  const pendingChars = Array.from(streamingTextBuffer);
  const revealCount = streamingRevealCount(pendingChars, flushAll);
  const nextText = pendingChars.slice(0, revealCount).join("");
  const previousLength = streamingRenderedTextLength;
  state.assistantNode.dataset.displayText = `${state.assistantNode.dataset.displayText || ""}${nextText}`;
  streamingTextBuffer = pendingChars.slice(revealCount).join("");
  renderStreamingAssistant(previousLength);
  if (!state.restoringHistory && state.autoFollowMessages) {
    keepStreamingTailVisible();
  }
  if (streamingTextBuffer) {
    scheduleStreamingFlush();
  }
}

function scheduleStreamingFlush() {
  if (streamingFlushTimer) {
    return;
  }
  const delay = streamingDisplayStarted ? STREAMING_FLUSH_INTERVAL_MS : streamingStartBufferMs();
  streamingFlushTimer = window.setTimeout(flushStreamingText, delay);
}

function resetStreamingState() {
  window.clearTimeout(streamingFlushTimer);
  window.clearTimeout(streamingRenderTimer);
  window.clearTimeout(streamingScrollTimer);
  streamingFlushTimer = 0;
  streamingRenderTimer = 0;
  streamingScrollTimer = 0;
  streamingTextBuffer = "";
  streamingLiveNode = null;
  streamingRenderedTextLength = 0;
  streamingDisplayStarted = false;
  els.messages.classList.remove("streaming-follow");
}

function handleEvent(event) {
  if (event.type === "web_session") {
    setStatus(STATUS_LABELS.startingBackend);
    return;
  }

  if (event.type === "ready") {
    state.switchingWorkspace = false;
    state.ready = true;
    state.commands = Array.isArray(event.commands)
      ? event.commands
          .map((command) =>
            typeof command === "string"
              ? { name: command, description: commandDescription(command) }
              : {
                  name: command.name || "",
                  description: commandDescription(command.name || "", command.description || ""),
                },
          )
          .filter((command) => command.name.startsWith("/"))
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];
    state.skills = normalizeSkills(event.skills);
    state.mcpServers = normalizeMcpServers(event.mcp_servers);
    state.plugins = normalizePlugins(event.plugins);
    setBusy(false, STATUS_LABELS.ready);
    updateState(event.state);
    ctx.updateModelSettingsRows?.();
    updateTasks(event.tasks || []);
    updateSendState();
    if (state.skipNextReadyHistoryRefresh) {
      state.skipNextReadyHistoryRefresh = false;
      if (state.clearHistoryOnNextReady) {
        renderHistory(cachedHistoryForWorkspace());
      }
      state.clearHistoryOnNextReady = false;
      return;
    }
    requestHistory().catch(() => {
      renderHistory(cachedHistoryForWorkspace());
    });
    return;
  }

  if (event.type === "state_snapshot") {
    if (Array.isArray(event.mcp_servers)) {
      state.mcpServers = normalizeMcpServers(event.mcp_servers);
    }
    if (Array.isArray(event.plugins)) {
      state.plugins = normalizePlugins(event.plugins);
    }
    updateState(event.state);
    ctx.updateModelSettingsRows?.();
    updateSlashMenu();
    return;
  }

  if (event.type === "tasks_snapshot") {
    updateTasks(event.tasks || []);
    return;
  }

  if (event.type === "status") {
    setBusy(true, event.message || STATUS_LABELS.processing);
    return;
  }

  if (event.type === "skills_snapshot") {
    state.skills = normalizeSkills(event.skills);
    ctx.refreshSkillCatalogs?.();
    updateSlashMenu();
    return;
  }

  if (event.type === "transcript_item" && event.item) {
    if (event.item.role === "user") {
      if (!String(event.item.text || "").trim()) {
        return;
      }
      return;
    }
    if (event.item.role === "system" && event.item.text === "Conversation cleared.") {
      return;
    }
    if (
      event.item.role === "system"
      && ["Plan mode enabled.", "Plan mode disabled."].includes(String(event.item.text || "").trim())
    ) {
      setPlanModeIndicatorActive(String(event.item.text || "").trim() === "Plan mode enabled.");
      return;
    }
    if (event.item.role === "system" && String(event.item.text || "").startsWith("Session restored")) {
      return;
    }
    if (event.item.role === "assistant") {
      if (!String(event.item.text || "").trim()) {
        return;
      }
      const node = appendMessage("assistant", event.item.text || "");
      extractAndRenderArtifacts(event.item.text || "", node);
      return;
    }
    if (event.item.role === "system" && String(event.item.text || "").startsWith("> ")) {
      const userText = String(event.item.text || "").slice(2);
      if (!userText.trim()) {
        return;
      }
      appendMessage("user", userText);
      return;
    }
    if (!String(event.item.text || "").trim()) {
      return;
    }
    appendMessage(event.item.role === "log" ? "log" : "system", event.item.text || "");
    return;
  }

  if (event.type === "clear_transcript") {
    resetStreamingState();
    restoringWorkflowEvents = [];
    restoringWorkflowInputDeltas = [];
    state.suppressNextLineCompleteScroll = false;
    renderWelcome();
    state.assistantNode = null;
    const activeSlot = state.chatSlots.get(state.activeFrontendId);
    if (activeSlot) {
      activeSlot.hasConversation = false;
      activeSlot.showInHistory = !activeSlot.suppressNewChatHistory;
      activeSlot.title = activeSlot.suppressNewChatHistory ? "MyHarness" : "새 채팅";
      activeSlot.assistantNode = null;
      activeSlot.workflowNode = null;
      activeSlot.workflowList = null;
      activeSlot.workflowSummary = null;
      activeSlot.workflowSteps = [];
    }
    resetWorkflowPanel();
    resetArtifacts();
    return;
  }

  if (event.type === "session_title") {
    const title = String(event.message || "").trim();
    if (title) {
      setChatTitle(title);
    }
    return;
  }

  if (event.type === "active_session") {
    state.activeHistoryId = String(event.value || "").trim() || null;
    state.pendingScrollRestoreId = null;
    if (state.restoreTimeoutId) {
      window.clearTimeout(state.restoreTimeoutId);
      state.restoreTimeoutId = 0;
    }
    state.restoringHistory = false;
    state.batchingHistoryRestore = false;
    state.suppressNextLineCompleteScroll = false;
    markActiveHistory();
    return;
  }

  if (event.type === "history_snapshot") {
    const activeSlot = state.chatSlots.get(state.activeFrontendId);
    if (activeSlot?.showInHistory && !activeSlot.busy && !activeSlot.container?.querySelector(".message")) {
      activeSlot.showInHistory = false;
      activeSlot.hasConversation = false;
      activeSlot.suppressNewChatHistory = true;
    }
    resetStreamingState();
    restoringWorkflowEvents = [];
    restoringWorkflowInputDeltas = [];
    state.activeHistoryId = String(event.value || "").trim() || null;
    state.pendingScrollRestoreId = state.activeHistoryId;
    if (state.restoreTimeoutId) {
      window.clearTimeout(state.restoreTimeoutId);
      state.restoreTimeoutId = 0;
    }
    state.restoringHistory = true;
    state.batchingHistoryRestore = false;
    state.suppressNextLineCompleteScroll = true;
    state.ignoreScrollSave = true;
    if (event.message) {
      setChatTitle(event.message);
    }
    resetWorkflowPanel();
    resetArtifacts();
    const restoredSeconds = Number(event.compact_metadata?.workflow_duration_seconds || 0);
    state.workflowRestoredElapsedMs = Number.isFinite(restoredSeconds) && restoredSeconds > 0
      ? restoredSeconds * 1000
      : 0;
    els.messages.textContent = "";
    for (const item of event.history_events || []) {
      if (item.type === "user") {
        appendMessage("user", item.text || "");
      } else if (item.type === "assistant") {
        const node = appendMessage("assistant", item.text || "");
        extractAndRenderArtifacts(item.text || "", node);
      } else if (item.type === "tool_started" || item.type === "tool_completed") {
        appendWorkflowEvent({
          type: item.type,
          tool_name: item.tool_name,
          tool_input: item.tool_input || {},
          output: item.output || "",
          is_error: Boolean(item.is_error),
        });
      }
    }
    finalizeWorkflowSummary();
    collapseWorkflowPanel();
    markActiveHistory();
    requestAnimationFrame(finishScrollRestore);
    setBusy(false, STATUS_LABELS.ready);
    return;
  }

  if (event.type === "assistant_delta") {
    if (!state.assistantNode) {
      state.assistantNode = appendMessage("assistant", "");
      state.assistantNode.classList.add("streaming-text");
      state.assistantNode.textContent = "";
      state.assistantNode.dataset.rawText = "";
      state.assistantNode.dataset.displayText = "";
      streamingRenderedTextLength = 0;
      if (!state.restoringHistory) {
        startWorkflowFinalAnswer();
      }
    }
    const message = event.message || "";
    const nextText = (state.assistantNode.dataset.rawText || "") + message;
    state.assistantNode.dataset.rawText = nextText;
    if (state.restoringHistory) {
      state.assistantNode.classList.remove("streaming-text");
      setMarkdown(state.assistantNode, nextText);
      state.assistantNode.dataset.displayText = nextText;
      return;
    }
    streamingTextBuffer += message;
    scheduleStreamingFlush();
    return;
  }

  if (event.type === "tool_input_delta") {
    if (state.batchingHistoryRestore) {
      restoringWorkflowInputDeltas.push(event);
      return;
    }
    appendWorkflowInputDelta(event);
    return;
  }

  if (event.type === "assistant_complete") {
    const isFinalAssistantAnswer = !event.has_tool_uses;
    if (state.assistantNode) {
      flushStreamingText({ flushAll: true });
      resetStreamingState();
      state.assistantNode.classList.remove("streaming-text");
      const finalText = event.message || state.assistantNode.dataset.rawText || "";
      setMarkdown(state.assistantNode, finalText);
      if (isFinalAssistantAnswer) {
        extractAndRenderArtifacts(finalText, state.assistantNode);
        attachAssistantActions(state.assistantNode, finalText);
        markWorkflowFinalAnswerDone();
      } else {
        clearWorkflowFinalAnswerStep();
      }
      state.assistantNode = null;
    } else if (event.message) {
      const node = appendMessage("assistant", event.message);
      if (isFinalAssistantAnswer) {
        extractAndRenderArtifacts(event.message, node);
        attachAssistantActions(node, event.message);
        markWorkflowFinalAnswerDone();
      } else {
        clearWorkflowFinalAnswerStep();
      }
    }
    return;
  }

  if (event.type === "line_complete") {
    if (state.restoreTimeoutId && state.restoringHistory) {
      window.clearTimeout(state.restoreTimeoutId);
      state.restoreTimeoutId = 0;
    }
    resetStreamingState();
    state.assistantNode = null;
    state.projectFilesLoadedForSession = "";
    if (state.batchingHistoryRestore && (restoringWorkflowEvents.length || restoringWorkflowInputDeltas.length)) {
      for (const workflowEvent of restoringWorkflowEvents) {
        appendWorkflowEvent(workflowEvent);
      }
      for (const deltaEvent of restoringWorkflowInputDeltas) {
        appendWorkflowInputDelta(deltaEvent);
      }
      restoringWorkflowEvents = [];
      restoringWorkflowInputDeltas = [];
      state.batchingHistoryRestore = false;
    }
    if (!event.quiet) {
      finalizeWorkflowSummary();
      collapseWorkflowPanel();
      if (state.restoringHistory) {
        requestAnimationFrame(finishScrollRestore);
      } else if (state.suppressNextLineCompleteScroll) {
        state.suppressNextLineCompleteScroll = false;
      } else {
        settleStreamingTailVisible();
      }
    }
    setBusy(false, STATUS_LABELS.ready);
    if (!event.quiet) {
      requestHistory().catch(() => {});
    }
    return;
  }

  if (event.type === "tool_progress") {
    setBusy(true, compactToolProgressStatus(event, STATUS_LABELS.processing));
    if (state.batchingHistoryRestore) {
      return;
    }
    appendWorkflowProgress(event);
    return;
  }

  if (event.type === "tool_started" || event.type === "tool_completed") {
    setBusy(true, STATUS_LABELS.processing);
    if (state.batchingHistoryRestore) {
      restoringWorkflowEvents.push(event);
      return;
    }
    appendWorkflowEvent(event);
    return;
  }

  if (event.type === "modal_request") {
    showModal(event.modal || {});
    return;
  }

  if (event.type === "select_request") {
    if ((event.modal || {}).command === "resume") {
      renderHistory(event.select_options || []);
      return;
    }
    showSelect(event);
    return;
  }

  if (event.type === "error") {
    state.switchingWorkspace = false;
    state.batchingHistoryRestore = false;
    state.restoringHistory = false;
    state.ignoreScrollSave = false;
    if (state.restoreTimeoutId) {
      window.clearTimeout(state.restoreTimeoutId);
      state.restoreTimeoutId = 0;
    }
    state.suppressNextLineCompleteScroll = false;
    restoringWorkflowEvents = [];
    restoringWorkflowInputDeltas = [];
    resetStreamingState();
    state.assistantNode = null;
    failWorkflowPanel(event.message || "");
    appendMessage("system", `오류: ${event.message || "알 수 없는 오류"}`);
    setBusy(false, STATUS_LABELS.error);
    return;
  }

  if (event.type === "shutdown") {
    state.switchingWorkspace = false;
    state.batchingHistoryRestore = false;
    state.restoringHistory = false;
    state.ignoreScrollSave = false;
    if (state.restoreTimeoutId) {
      window.clearTimeout(state.restoreTimeoutId);
      state.restoreTimeoutId = 0;
    }
    state.suppressNextLineCompleteScroll = false;
    restoringWorkflowEvents = [];
    restoringWorkflowInputDeltas = [];
    state.ready = false;
    setStatus(STATUS_LABELS.stopped);
    updateSendState();
  }
}

  return {
    handleEvent,
  };
}
