export function createEvents(ctx) {
  const { state, STATUS_LABELS, commandDescription, updateState } = ctx;
  function setStatus(...args) { return ctx.setStatus(...args); }
  function setBusy(...args) { return ctx.setBusy(...args); }
  function updateTasks(...args) { return ctx.updateTasks(...args); }
  function updateSendState(...args) { return ctx.updateSendState(...args); }
  function requestHistory(...args) { return ctx.requestHistory(...args); }
  function renderHistory(...args) { return ctx.renderHistory(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
  function setChatTitle(...args) { return ctx.setChatTitle(...args); }
  function renderWelcome(...args) { return ctx.renderWelcome(...args); }
  function resetWorkflowPanel(...args) { return ctx.resetWorkflowPanel(...args); }
  function collapseWorkflowPanel(...args) { return ctx.collapseWorkflowPanel(...args); }
  function finalizeWorkflowSummary(...args) { return ctx.finalizeWorkflowSummary(...args); }
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }
  function scrollMessagesToBottom(...args) { return ctx.scrollMessagesToBottom(...args); }
  function finishScrollRestore(...args) { return ctx.finishScrollRestore(...args); }
  function appendWorkflowEvent(...args) { return ctx.appendWorkflowEvent(...args); }
  function showModal(...args) { return ctx.showModal(...args); }
  function showSelect(...args) { return ctx.showSelect(...args); }
  function updateSlashMenu(...args) { return ctx.updateSlashMenu(...args); }
  function extractAndRenderArtifacts(...args) { return ctx.extractAndRenderArtifacts?.(...args); }
  function resetArtifacts(...args) { return ctx.resetArtifacts?.(...args); }

let streamingRenderTimer = 0;
let streamingFlushTimer = 0;
let streamingScrollTimer = 0;
let streamingTextBuffer = "";
let streamingLiveNode = null;
let streamingRenderedTextLength = 0;
let streamingDisplayStarted = false;
const STREAMING_FLUSH_INTERVAL_MS = 120;
const STREAMING_START_BUFFER_MS = 300;
const STREAMING_MIN_CHARS_PER_FLUSH = 18;
const STREAMING_MAX_CHARS_PER_FLUSH = 72;

function normalizeSkills(skills) {
  return Array.isArray(skills)
    ? skills
        .map((skill) => ({
          name: String(skill.name || "").trim(),
          description: String(skill.description || "").trim(),
          source: String(skill.source || "").trim(),
        }))
        .filter((skill) => skill.name)
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

  if (!source.endsWith("\n")) {
    const lastIndex = lines.length - 1;
    if (lastIndex === tableStart || lastIndex === tableStart + 1) {
      return lines
        .map((line, index) => (index >= tableStart ? escapeMarkdownTablePipes(line) : line))
        .join("\n");
    }
    if (lastIndex > tableStart + 1 && isMarkdownTableLine(lines[lastIndex])) {
      return lines
        .map((line, index) => (index === lastIndex ? escapeMarkdownTablePipes(line) : line))
        .join("\n");
    }
  }

  return source;
}

function keepStreamingTailVisible() {
  if (state.restoringHistory || !state.autoFollowMessages) {
    return;
  }
  if (streamingScrollTimer) {
    return;
  }
  streamingScrollTimer = window.setTimeout(() => {
    streamingScrollTimer = 0;
    if (!state.restoringHistory && state.autoFollowMessages) {
      scrollMessagesToBottom({ smooth: true, duration: 900 });
    }
  }, 160);
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
  const delay = streamingDisplayStarted ? STREAMING_FLUSH_INTERVAL_MS : STREAMING_START_BUFFER_MS;
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
    setBusy(false, STATUS_LABELS.ready);
    updateState(event.state);
    updateTasks(event.tasks || []);
    updateSendState();
    requestHistory().catch(() => {
      renderHistory([]);
    });
    return;
  }

  if (event.type === "state_snapshot") {
    updateState(event.state);
    return;
  }

  if (event.type === "tasks_snapshot") {
    updateTasks(event.tasks || []);
    return;
  }

  if (event.type === "skills_snapshot") {
    state.skills = normalizeSkills(event.skills);
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
      if (state.chatTitle === "MyHarness" && !userText.startsWith("/")) {
        setChatTitle(userText);
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
    renderWelcome();
    state.assistantNode = null;
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

  if (event.type === "assistant_delta") {
    if (!state.assistantNode) {
      state.assistantNode = appendMessage("assistant", "");
      state.assistantNode.classList.add("streaming-text");
      state.assistantNode.textContent = "";
      state.assistantNode.dataset.rawText = "";
      state.assistantNode.dataset.displayText = "";
      streamingRenderedTextLength = 0;
    }
    const message = event.message || "";
    const nextText = (state.assistantNode.dataset.rawText || "") + message;
    state.assistantNode.dataset.rawText = nextText;
    streamingTextBuffer += message;
    scheduleStreamingFlush();
    return;
  }

  if (event.type === "assistant_complete") {
    if (state.assistantNode) {
      flushStreamingText({ flushAll: true });
      resetStreamingState();
      state.assistantNode.classList.remove("streaming-text");
      const finalText = event.message || state.assistantNode.dataset.rawText || "";
      setMarkdown(state.assistantNode, finalText);
      extractAndRenderArtifacts(finalText, state.assistantNode);
      state.assistantNode = null;
    } else if (event.message) {
      const node = appendMessage("assistant", event.message);
      extractAndRenderArtifacts(event.message, node);
    }
    return;
  }

  if (event.type === "line_complete") {
    resetStreamingState();
    state.assistantNode = null;
    state.projectFilesLoadedForSession = "";
    finalizeWorkflowSummary();
    collapseWorkflowPanel();
    if (state.restoringHistory) {
      requestAnimationFrame(finishScrollRestore);
    }
    setBusy(false, STATUS_LABELS.ready);
    requestHistory().catch(() => {});
    return;
  }

  if (event.type === "tool_started" || event.type === "tool_completed") {
    setBusy(true, STATUS_LABELS.processing);
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
    appendMessage("system", `오류: ${event.message || "알 수 없는 오류"}`);
    setBusy(false, STATUS_LABELS.error);
    return;
  }

  if (event.type === "shutdown") {
    state.switchingWorkspace = false;
    state.ready = false;
    setStatus(STATUS_LABELS.stopped);
    updateSendState();
  }
}

  return {
    handleEvent,
  };
}
