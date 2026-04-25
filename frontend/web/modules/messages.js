export function createMessages(ctx) {
  const { state, els, STATUS_LABELS, commandDescription } = ctx;
  let workflowEventQueue = [];
  let workflowEventQueueTimer = 0;
  let workflowWaitingTimer = 0;
  let workflowWaitingIndex = 0;
  let workflowIntent = "default";
  let workflowPreviewNode = null;
  let workflowPreviewBody = null;
  let workflowPreviewTimer = 0;
  let workflowPreviewText = "";
  let workflowPreviewOffset = 0;
  const workflowToolArgBuffers = new Map();
  const WORKFLOW_EVENT_STAGGER_MS = 90;
  const WORKFLOW_WAITING_FIRST_MS = 4500;
  const WORKFLOW_WAITING_NEXT_MS = 12000;
  const WORKFLOW_PREVIEW_CHARS_PER_TICK = 180;
  const WORKFLOW_PREVIEW_TICK_MS = 45;
  function removeWelcome(...args) { return ctx.removeWelcome(...args); }
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }
  function scrollMessagesToBottom(...args) { return ctx.scrollMessagesToBottom(...args); }
  function scheduleScrollRestore(...args) { return ctx.scheduleScrollRestore(...args); }
  function sendLine(...args) { return ctx.sendLine(...args); }
  function setBusy(...args) { return ctx.setBusy(...args); }

function isCommandCatalog(text) {
  return String(text || "").includes("Available commands:");
}

function splitCommandCatalog(text) {
  const source = String(text || "");
  const marker = "Available commands:";
  const index = source.indexOf(marker);
  if (index < 0) {
    return { intro: "", catalog: source };
  }
  return {
    intro: source.slice(0, index).trim(),
    catalog: source.slice(index).trim(),
  };
}

function parseCommandCatalog(text) {
  const { catalog } = splitCommandCatalog(text);
  const source = String(catalog || "").replace(/^Available commands:\s*/i, "").trim();
  const matches = [...source.matchAll(/\/[a-z][a-z0-9-]*/g)];
  if (!matches.length) {
    return [];
  }
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const start = match.index + match[0].length;
    const end = next ? next.index : source.length;
    return {
      name: match[0],
      description: source.slice(start, end).trim(),
    };
  });
}

function createCommandCatalog(text) {
  const commands = parseCommandCatalog(text);
  const details = document.createElement("details");
  details.className = "command-card";
  details.open = true;

  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = "사용 가능한 명령어";
  const count = document.createElement("span");
  count.className = "command-count";
  count.textContent = commands.length ? `${commands.length}개` : "열기";
  summary.append(label, count);
  details.append(summary);

  const grid = document.createElement("div");
  grid.className = "command-grid";
  if (!commands.length) {
    const fallback = document.createElement("div");
    fallback.className = "markdown-body";
    setMarkdown(fallback, text);
    grid.append(fallback);
  } else {
    for (const command of commands) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "command-pill";
      item.addEventListener("click", () => {
        sendLine(command.name).catch((error) => {
          appendMessage("system", `명령어 실행 실패: ${error.message}`);
          setBusy(false, STATUS_LABELS.error);
        });
      });
      const name = document.createElement("strong");
      name.textContent = command.name;
      const description = document.createElement("span");
      description.textContent = commandDescription(command.name, command.description);
      item.append(name, description);
      grid.append(item);
    }
  }
  details.append(grid);
  return details;
}

function createCommandCatalogContent(text) {
  const { intro } = splitCommandCatalog(text);
  const wrap = document.createElement("div");
  wrap.className = "command-help-stack";
  if (intro) {
    const introNode = document.createElement("div");
    introNode.className = "markdown-body command-help-intro";
    setMarkdown(introNode, intro);
    wrap.append(introNode);
  }
  wrap.append(createCommandCatalog(text));
  return wrap;
}

function createAttachmentPreview(attachments = []) {
  if (!attachments.length) {
    return null;
  }
  const wrap = document.createElement("div");
  wrap.className = "message-attachments";
  for (const attachment of attachments) {
    const image = document.createElement("img");
    image.src = `data:${attachment.media_type || attachment.mediaType};base64,${attachment.data}`;
    image.alt = attachment.name || "첨부 이미지";
    image.title = attachment.name || "첨부 이미지";
    wrap.append(image);
  }
  return wrap;
}

function prettifyPromptToken(rawToken) {
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
  const name = (normalized.includes(":") ? normalized.split(":")[0] : normalized)
    .replace(/[-_]+/g, " ")
    .trim();
  return name
    ? name.replace(/\b\w/g, (char) => char.toUpperCase())
    : token;
}

function createPromptTokenContent(text) {
  const value = String(text || "");
  const match = value.match(/^(\$"[^"]+"|\$'[^']+'|\$[^\s]+|\/[a-z][a-z0-9-]*)(\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  const rawToken = match[1];
  const rest = match[3] || "";
  const wrap = document.createElement("div");
  wrap.className = "prompt-line";
  const chip = document.createElement("span");
  chip.className = `prompt-token ${rawToken.startsWith("$") ? "skill" : "command"}`;
  chip.textContent = prettifyPromptToken(rawToken);
  chip.title = rawToken;
  wrap.append(chip);
  if (rest) {
    const copy = document.createElement("span");
    copy.className = "prompt-rest";
    copy.textContent = rest;
    wrap.append(copy);
  }
  return wrap;
}

function shouldCollapseUserMessage(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }
  return value.length > 180 || value.split(/\r?\n/).length > 2;
}

function renderCollapsedUserMessage(content, text, expanded = false) {
  const value = String(text || "");
  content.dataset.rawText = value;
  content.classList.toggle("user-collapsed-message", !expanded);
  content.classList.toggle("user-expanded-message", expanded);
  content.textContent = "";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "user-message-toggle";
  toggle.textContent = expanded ? "접기" : "더 보기";
  toggle.addEventListener("click", () => renderCollapsedUserMessage(content, value, !expanded));

  if (expanded) {
    setMarkdown(content, value);
    content.classList.add("user-expanded-message");
    content.classList.remove("user-collapsed-message");
    content.append(toggle);
    return;
  }

  const preview = document.createElement("span");
  preview.className = "user-message-preview";
  preview.textContent = value.replace(/\s+/g, " ").trim();
  content.append(preview, toggle);
}

function appendMessage(role, text, attachments = []) {
  removeWelcome();
  const article = document.createElement("article");
  const commandCatalog = role !== "user" && isCommandCatalog(text);
  article.className = `message ${commandCatalog ? "system command-output" : role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  let content;
  if (commandCatalog) {
    content = createCommandCatalogContent(text);
    bubble.append(content);
  } else {
    content = document.createElement("div");
    content.className = "markdown-body";
    if (role !== "user") {
      content.dataset.restoreEscapedInlineMarkdown = "true";
    }
    const promptContent = role === "user" ? createPromptTokenContent(text) : null;
    if (promptContent) {
      content.append(promptContent);
    } else if (role === "user" && shouldCollapseUserMessage(text)) {
      renderCollapsedUserMessage(content, text, false);
    } else {
      setMarkdown(content, text);
    }
    const preview = role === "user" ? createAttachmentPreview(attachments) : null;
    if (preview) {
      bubble.append(preview);
    }
    bubble.append(content);
  }
  article.append(bubble);
  els.messages.append(article);
  if (state.restoringHistory) {
    scheduleScrollRestore();
  } else {
    scrollMessagesToBottom();
  }
  return content;
}

function resetWorkflowPanel() {
  workflowEventQueue = [];
  window.clearTimeout(workflowEventQueueTimer);
  window.clearTimeout(workflowWaitingTimer);
  window.clearTimeout(workflowPreviewTimer);
  workflowEventQueueTimer = 0;
  workflowWaitingTimer = 0;
  workflowWaitingIndex = 0;
  workflowIntent = "default";
  workflowPreviewNode = null;
  workflowPreviewBody = null;
  workflowPreviewTimer = 0;
  workflowPreviewText = "";
  workflowPreviewOffset = 0;
  workflowToolArgBuffers.clear();
  stopWorkflowTimer();
  state.workflowNode = null;
  state.workflowList = null;
  state.workflowSummary = null;
  state.workflowSteps = [];
  state.workflowStartedAt = 0;
  state.workflowRestoredElapsedMs = 0;
}

function collapseWorkflowPanel() {
  if (!state.workflowNode) {
    return;
  }
  state.workflowNode.open = false;
}

function finalizeWorkflowSummary() {
  updateWorkflowSummary();
  stopWorkflowWaitingTimer();
  flushWorkflowOutputPreview();
  stopWorkflowTimer();
}

function detectWorkflowIntent(promptText = "") {
  const value = String(promptText || "").toLowerCase();
  if (
    value.includes(".md")
    || value.includes("markdown")
    || value.includes("md 파일")
    || value.includes("문서")
    || value.includes("파일")
  ) {
    return "file";
  }
  return "default";
}

function ensureWorkflowPanel(promptText = "") {
  if (state.workflowNode && state.workflowList && state.workflowSummary) {
    return;
  }
  workflowIntent = detectWorkflowIntent(promptText);
  removeWelcome();
  const article = document.createElement("article");
  article.className = "message assistant workflow-message";

  const details = document.createElement("details");
  details.className = "workflow-card";
  details.open = true;

  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "workflow-title";
  title.textContent = "에이전트 동작";
  const count = document.createElement("span");
  count.className = "workflow-count";
  count.textContent = "(0초) 0 단계";
  summary.append(title, count);

  const list = document.createElement("div");
  list.className = "workflow-list";

  const preview = document.createElement("div");
  preview.className = "workflow-output-preview hidden";
  const previewTitle = document.createElement("div");
  previewTitle.className = "workflow-output-title";
  previewTitle.textContent = "작성 중인 결과물";
  const previewBody = document.createElement("pre");
  previewBody.className = "workflow-output-body";
  preview.append(previewTitle, previewBody);

  details.append(summary, list, preview);
  article.append(details);
  if (state.restoringHistory) {
    const firstUserMessage = els.messages.querySelector(".message.user");
    if (firstUserMessage?.parentElement === els.messages) {
      firstUserMessage.after(article);
    } else {
      els.messages.prepend(article);
    }
  } else {
    els.messages.append(article);
  }

  state.workflowNode = details;
  state.workflowList = list;
  state.workflowSummary = count;
  workflowPreviewNode = preview;
  workflowPreviewBody = previewBody;
  state.workflowSteps = [];
  state.workflowStartedAt = performance.now();
  startWorkflowTimer();
  appendWorkflowStep("요청 이해", "사용자 요청을 확인했습니다.", "done");
  appendWorkflowStep(
    "작업 계획",
    workflowIntent === "file" ? "파일 생성 방법과 저장 위치를 정하는 중입니다." : "필요한 정보와 도구를 판단합니다.",
    "running",
  );
  if (!state.restoringHistory) {
    startWorkflowWaitingTimer();
    scrollMessagesToBottom();
  }
}

function startWorkflowTimer() {
  stopWorkflowTimer();
  state.workflowTimer = window.setInterval(updateWorkflowSummary, 1000);
}

function stopWorkflowTimer() {
  if (!state.workflowTimer) {
    return;
  }
  window.clearInterval(state.workflowTimer);
  state.workflowTimer = 0;
}

function stopWorkflowWaitingTimer() {
  if (!workflowWaitingTimer) {
    return;
  }
  window.clearTimeout(workflowWaitingTimer);
  workflowWaitingTimer = 0;
}

function flushWorkflowOutputPreview() {
  if (!workflowPreviewBody || !workflowPreviewText) {
    return;
  }
  window.clearTimeout(workflowPreviewTimer);
  workflowPreviewTimer = 0;
  workflowPreviewBody.textContent = workflowPreviewText;
  workflowPreviewOffset = workflowPreviewText.length;
}

function revealWorkflowOutputPreview() {
  workflowPreviewTimer = 0;
  if (!workflowPreviewBody || !workflowPreviewText) {
    return;
  }
  workflowPreviewOffset = Math.min(
    workflowPreviewText.length,
    workflowPreviewOffset + WORKFLOW_PREVIEW_CHARS_PER_TICK,
  );
  workflowPreviewBody.textContent = workflowPreviewText.slice(0, workflowPreviewOffset);
  if (!state.restoringHistory && state.autoFollowMessages) {
    workflowPreviewBody.scrollTop = workflowPreviewBody.scrollHeight;
    scrollMessagesToBottom({ smooth: true, duration: 900 });
  }
  if (workflowPreviewOffset < workflowPreviewText.length) {
    workflowPreviewTimer = window.setTimeout(revealWorkflowOutputPreview, WORKFLOW_PREVIEW_TICK_MS);
  }
}

function startWorkflowOutputPreview(toolName, input = {}) {
  const lower = String(toolName || "").toLowerCase();
  const content = String(input?.content || input?.new_string || "");
  if (!content || !(lower.includes("write") || lower.includes("edit"))) {
    return;
  }
  ensureWorkflowPanel();
  if (!workflowPreviewNode || !workflowPreviewBody) {
    return;
  }
  const path = String(input?.file_path || input?.path || "").trim();
  workflowPreviewNode.classList.remove("hidden");
  const title = workflowPreviewNode.querySelector(".workflow-output-title");
  if (title) {
    title.textContent = path ? `작성 중인 결과물 - ${path}` : "작성 중인 결과물";
  }
  if (workflowPreviewText && content.startsWith(workflowPreviewText.replace(/\n\n\.\.\.$/, ""))) {
    window.clearTimeout(workflowPreviewTimer);
    workflowPreviewTimer = 0;
    workflowPreviewText = content.length > 12000 ? `${content.slice(0, 12000)}\n\n...` : content;
    workflowPreviewOffset = workflowPreviewText.length;
    workflowPreviewBody.textContent = workflowPreviewText;
    return;
  }
  window.clearTimeout(workflowPreviewTimer);
  workflowPreviewTimer = 0;
  workflowPreviewText = content.length > 12000 ? `${content.slice(0, 12000)}\n\n...` : content;
  if (state.restoringHistory) {
    workflowPreviewOffset = workflowPreviewText.length;
    workflowPreviewBody.textContent = workflowPreviewText;
    return;
  }
  workflowPreviewOffset = 0;
  workflowPreviewBody.textContent = "";
  revealWorkflowOutputPreview();
}

function decodeJsonStringFragment(value) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      result += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      break;
    }
    index += 1;
    if (next === "n") result += "\n";
    else if (next === "r") result += "\r";
    else if (next === "t") result += "\t";
    else if (next === "b") result += "\b";
    else if (next === "f") result += "\f";
    else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 1, index + 5))) {
      result += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 5), 16));
      index += 4;
    } else {
      result += next;
    }
  }
  return result;
}

function extractPartialJsonStringValue(source, key) {
  const marker = `"${key}"`;
  const keyIndex = source.indexOf(marker);
  if (keyIndex < 0) {
    return "";
  }
  const colonIndex = source.indexOf(":", keyIndex + marker.length);
  if (colonIndex < 0) {
    return "";
  }
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < source.length && /\s/.test(source[quoteIndex])) {
    quoteIndex += 1;
  }
  if (source[quoteIndex] !== "\"") {
    return "";
  }
  let cursor = quoteIndex + 1;
  let escaped = false;
  let raw = "";
  while (cursor < source.length) {
    const char = source[cursor];
    if (!escaped && char === "\"") {
      break;
    }
    raw += char;
    escaped = !escaped && char === "\\";
    if (char !== "\\") {
      escaped = false;
    }
    cursor += 1;
  }
  return decodeJsonStringFragment(raw);
}

function appendWorkflowInputDelta(event) {
  const delta = String(event.arguments_delta || "");
  if (!delta) {
    return;
  }
  ensureWorkflowPanel();
  const key = Number.isFinite(event.tool_call_index) ? event.tool_call_index : 0;
  const current = workflowToolArgBuffers.get(key) || "";
  const next = current + delta;
  workflowToolArgBuffers.set(key, next);
  const content = extractPartialJsonStringValue(next, "content") || extractPartialJsonStringValue(next, "new_string");
  if (!content) {
    return;
  }
  if (!workflowPreviewNode || !workflowPreviewBody) {
    return;
  }
  workflowPreviewNode.classList.remove("hidden");
  const title = workflowPreviewNode.querySelector(".workflow-output-title");
  if (title) {
    title.textContent = "작성 중인 결과물";
  }
  window.clearTimeout(workflowPreviewTimer);
  workflowPreviewTimer = 0;
  workflowPreviewText = content.length > 12000 ? `${content.slice(0, 12000)}\n\n...` : content;
  workflowPreviewOffset = workflowPreviewText.length;
  workflowPreviewBody.textContent = workflowPreviewText;
  if (!state.restoringHistory && state.autoFollowMessages) {
    workflowPreviewBody.scrollTop = workflowPreviewBody.scrollHeight;
    scrollMessagesToBottom({ smooth: true, duration: 900 });
  }
}

function startWorkflowWaitingTimer() {
  stopWorkflowWaitingTimer();
  workflowWaitingIndex = 0;
  workflowWaitingTimer = window.setTimeout(appendWorkflowWaitingStep, WORKFLOW_WAITING_FIRST_MS);
}

function appendWorkflowWaitingStep() {
  workflowWaitingTimer = 0;
  if (!state.workflowNode || !state.workflowList || state.restoringHistory) {
    return;
  }
  const fileSteps = [
    ["초안 구성 중", "문서에 들어갈 내용과 구조를 정리하고 있습니다."],
    ["파일 작성 준비 중", "Markdown 파일로 저장할 내용을 준비하고 있습니다."],
    ["저장 대기 중", "파일 쓰기 도구가 실행되면 경로와 결과를 표시합니다."],
  ];
  const defaultSteps = [
    ["응답 준비 중", "필요한 맥락을 정리하고 있습니다."],
    ["실행 대기 중", "다음 도구 실행이나 답변 생성을 기다리고 있습니다."],
    ["처리 계속 중", "작업이 아직 진행 중입니다."],
  ];
  const steps = workflowIntent === "file" ? fileSteps : defaultSteps;
  const [title, detail] = steps[Math.min(workflowWaitingIndex, steps.length - 1)];
  const hasSameRunning = state.workflowSteps.some((row) =>
    row.classList.contains("running") && row.querySelector("strong")?.textContent === title
  );
  if (!hasSameRunning) {
    appendWorkflowStep(title, detail, "running");
  }
  workflowWaitingIndex += 1;
  workflowWaitingTimer = window.setTimeout(appendWorkflowWaitingStep, WORKFLOW_WAITING_NEXT_MS);
}

function appendWorkflowStep(titleText, detailText, status = "done", toolName = "") {
  const row = document.createElement("div");
  row.className = `workflow-step ${status}${state.restoringHistory ? "" : " entering"}`;
  if (toolName) {
    row.dataset.toolName = toolName;
  }
  const dot = document.createElement("span");
  dot.className = "workflow-dot";
  const copy = document.createElement("span");
  copy.className = "workflow-copy";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("small");
  detail.textContent = detailText;
  copy.append(title, detail);
  row.append(dot, copy);
  state.workflowList.append(row);
  if (!state.restoringHistory) {
    window.requestAnimationFrame(() => {
      row.classList.remove("entering");
    });
  }
  state.workflowSteps.push(row);
  updateWorkflowSummary();
  return row;
}

function appendWorkflowEvent(event) {
  if (state.restoringHistory) {
    appendWorkflowEventNow(event);
    return;
  }
  workflowEventQueue.push(event);
  scheduleWorkflowEventQueue();
}

function scheduleWorkflowEventQueue() {
  if (workflowEventQueueTimer) {
    return;
  }
  workflowEventQueueTimer = window.setTimeout(processNextWorkflowEvent, WORKFLOW_EVENT_STAGGER_MS);
}

function processNextWorkflowEvent() {
  workflowEventQueueTimer = 0;
  const event = workflowEventQueue.shift();
  if (!event) {
    return;
  }
  appendWorkflowEventNow(event);
  if (workflowEventQueue.length) {
    scheduleWorkflowEventQueue();
  }
}

function appendWorkflowEventNow(event) {
  ensureWorkflowPanel();
  stopWorkflowWaitingTimer();
  markPlanningStepDone();
  const isStart = event.type === "tool_started";
  const toolName = event.tool_name || "도구";
  if (isStart) {
    startWorkflowOutputPreview(toolName, event.tool_input || {});
  }
  if (!isStart) {
    [...state.workflowList.querySelectorAll(".workflow-step.running")]
      .filter((item) => item.dataset.toolName === toolName)
      .forEach((item) => {
        item.classList.remove("running");
        item.classList.add(event.is_error ? "error" : "done");
      });
  }
  const status = isStart ? "running" : event.is_error ? "error" : "done";
  const row = appendWorkflowStep(workflowTitle(event), workflowDetail(event), status, toolName);
  updateWorkflowSummary();
  if (!state.restoringHistory && state.autoFollowMessages) {
    scrollMessagesToBottom();
  }
}

function markPlanningStepDone() {
  const planning = state.workflowSteps.find((row) => row.querySelector("strong")?.textContent === "작업 계획");
  if (planning && planning.classList.contains("running")) {
    planning.classList.remove("running");
    planning.classList.add("done");
    planning.querySelector("small").textContent = "실행할 단계를 정했습니다.";
  }
}

function workflowTitle(event) {
  const name = event.tool_name || "도구";
  if (event.type === "tool_started") {
    return `${name} 실행 중`;
  }
  return event.is_error ? `${name} 실패` : `${name} 완료`;
}

function workflowDetail(event) {
  if (event.type === "tool_started") {
    return summarizeToolInput(event.tool_name, event.tool_input);
  }
  const output = String(event.output || "").trim();
  return output ? truncateText(output.replace(/\s+/g, " "), 140) : "완료되었습니다.";
}

function summarizeToolInput(toolName, input = {}) {
  const lower = String(toolName || "").toLowerCase();
  const valueFor = (...keys) => {
    for (const key of keys) {
      const value = input?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  };
  if (lower.includes("web_fetch")) return valueFor("url") || "웹 페이지를 가져오는 중";
  if (lower.includes("web_search")) return valueFor("query") || "웹 검색 중";
  if (lower.includes("bash") || lower.includes("shell")) return valueFor("command") || "명령 실행 중";
  if (lower.includes("grep")) return valueFor("pattern") || "텍스트 검색 중";
  if (lower.includes("glob")) return valueFor("pattern") || "파일 목록 검색 중";
  if (lower.includes("read")) return valueFor("file_path", "path") || "파일 읽는 중";
  if (lower.includes("write") || lower.includes("edit")) return valueFor("file_path", "path") || "파일 수정 중";
  const entries = Object.entries(input || {});
  if (!entries.length) return "도구를 실행하는 중";
  return truncateText(entries.map(([key, value]) => `${key}: ${String(value)}`).join(", "), 140);
}

function updateWorkflowSummary() {
  if (!state.workflowSummary) {
    return;
  }
  const total = state.workflowSteps.length;
  const elapsedMs = state.workflowRestoredElapsedMs || (state.workflowStartedAt ? performance.now() - state.workflowStartedAt : 0);
  const elapsed = elapsedMs ? `(${formatDuration(elapsedMs)})` : "";
  state.workflowSummary.textContent = elapsed ? `${elapsed} ${total} 단계` : `${total} 단계`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(1, Math.round(Number(milliseconds || 0) / 1000));
  return `${seconds}초`;
}

function truncateText(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function appendToolEvent(event) {
  if (els.toolList.querySelector(".empty")) {
    els.toolList.textContent = "";
  }
  const card = document.createElement("div");
  card.className = "event-card";

  const title = document.createElement("strong");
  title.textContent = event.tool_name || "도구";
  const phase = document.createElement("small");
  phase.textContent = event.type === "tool_started" ? "실행 시작" : "실행 완료";
  const detail = document.createElement("small");
  const raw =
    event.type === "tool_started"
      ? JSON.stringify(event.tool_input || {}, null, 2)
      : event.output || "완료됨";
  detail.textContent = raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;

  card.append(title, phase, detail);
  els.toolList.prepend(card);
}

function updateTasks(tasks) {
  els.taskList.textContent = "";
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "진행 중인 작업이 없습니다.";
    els.taskList.append(empty);
    return;
  }
  for (const task of tasks) {
    const card = document.createElement("div");
    card.className = "event-card";
    const title = document.createElement("strong");
    title.textContent = task.status || "task";
    const detail = document.createElement("small");
    detail.textContent = task.description || task.id || "";
    card.append(title, detail);
    els.taskList.append(card);
  }
}

  return {
    isCommandCatalog,
    parseCommandCatalog,
    createCommandCatalog,
    createAttachmentPreview,
    appendMessage,
    resetWorkflowPanel,
    collapseWorkflowPanel,
    finalizeWorkflowSummary,
    startWorkflowTimer,
    stopWorkflowTimer,
    ensureWorkflowPanel,
    appendWorkflowEvent,
    appendWorkflowInputDelta,
    markPlanningStepDone,
    truncateText,
    appendToolEvent,
    updateTasks,
  };
}
