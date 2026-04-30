export function createMessages(ctx) {
  const { state, els, STATUS_LABELS, commandDescription } = ctx;
  let workflowEventQueue = [];
  let workflowEventQueueTimer = 0;
  let workflowWaitingTimer = 0;
  let workflowWaitingIndex = 0;
  let workflowIntent = "default";
  let workflowPurposeGroupSerial = 0;
  let todoListSerial = 0;
  let workflowPreviewList = null;
  const workflowPreviews = new Map();
  const workflowToolArgBuffers = new Map();
  const workflowMutationWaitingTimers = new Map();
  const WORKFLOW_EVENT_STAGGER_MS = 90;
  const WORKFLOW_WAITING_FIRST_MS = 4500;
  const WORKFLOW_WAITING_NEXT_MS = 12000;
  const WORKFLOW_PURPOSE_DETAILS = {
    info: {
      title: "정보 수집",
      running: "필요한 자료와 맥락을 확인하고 있습니다.",
      done: "필요한 정보를 확인했습니다.",
      warning: "일부 정보는 제한되어 다른 경로로 진행했습니다.",
      error: "정보 수집 중 문제가 발생했습니다.",
    },
    action: {
      title: "작업 실행",
      running: "필요한 변경이나 명령을 실행하고 있습니다.",
      done: "작업 실행을 마쳤습니다.",
      warning: "일부 작업은 제한되어 다른 방식으로 진행했습니다.",
      error: "작업 실행 중 문제가 발생했습니다.",
    },
    verification: {
      title: "결과 검증",
      running: "결과를 확인하고 있습니다.",
      done: "결과를 확인했습니다.",
      warning: "일부 검증에서 주의할 점이 확인되었습니다.",
      error: "검증 중 문제가 발생했습니다.",
    },
  };
  function removeWelcome(...args) { return ctx.removeWelcome(...args); }
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }
  function scrollMessagesToBottom(...args) { return ctx.scrollMessagesToBottom(...args); }
  function scheduleScrollRestore(...args) { return ctx.scheduleScrollRestore(...args); }
  function sendLine(...args) { return ctx.sendLine(...args); }
  function setBusy(...args) { return ctx.setBusy(...args); }
  function sendBackendRequest(...args) { return ctx.sendBackendRequest?.(...args); }
  function copyTextToClipboard(...args) { return ctx.copyTextToClipboard(...args); }
  function showImagePreview(...args) { return ctx.showImagePreview?.(...args); }

function estimateTextTokens(text) {
  const value = String(text || "");
  if (!value) {
    return 0;
  }
  let total = 0;
  for (const segment of value.matchAll(/[\uAC00-\uD7A3]+|[A-Za-z0-9]+|\s+|./gu)) {
    const part = segment[0] || "";
    if (/^[\uAC00-\uD7A3]+$/u.test(part)) {
      total += part.length;
    } else if (/^[A-Za-z0-9]+$/u.test(part)) {
      total += Math.ceil(part.length / 4);
    } else if (/^\s+$/u.test(part)) {
      total += part.includes("\n") ? 1 : 0;
    } else {
      total += 1;
    }
  }
  return Math.max(1, total);
}

function workflowPreviewFileName(path) {
  const normalized = String(path || "").trim().replace(/[\\/]+$/g, "");
  const name = normalized.split(/[\\/]+/).pop();
  return name || normalized;
}

function formatWorkflowTokenCount(tokens) {
  const count = Math.max(0, Math.round(Number(tokens) || 0)).toLocaleString();
  return `${count} 토큰`;
}

function workflowInputValue(input, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key) && input[key] !== null && input[key] !== undefined) {
      return { found: true, value: String(input[key]) };
    }
  }
  return { found: false, value: "" };
}

function splitWorkflowPreviewLines(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  return normalized ? normalized.split("\n") : [""];
}

function formatWorkflowEditBlock(oldValue, newValue, index = 1, total = 1) {
  const lines = [];
  if (total > 1) {
    lines.push(`@@ 변경 ${index} @@`);
  }
  for (const line of splitWorkflowPreviewLines(oldValue)) {
    lines.push(`-- ${line}`);
  }
  for (const line of splitWorkflowPreviewLines(newValue)) {
    lines.push(`++ ${line}`);
  }
  return lines.join("\n");
}

function formatWorkflowEditPreview(input = {}) {
  const entries = Array.isArray(input?.edits) && input.edits.length ? input.edits : [input];
  const blocks = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const oldValue = workflowInputValue(entry, ["old_str", "old_string", "old_text", "oldText"]);
    const newValue = workflowInputValue(entry, ["new_str", "new_string", "new_text", "newText"]);
    if (!oldValue.found && !newValue.found) {
      continue;
    }
    blocks.push({ oldValue: oldValue.value, newValue: newValue.value });
  }
  return blocks
    .map((block, index) => formatWorkflowEditBlock(block.oldValue, block.newValue, index + 1, blocks.length))
    .join("\n");
}

function workflowPreviewSource(toolName, input = {}) {
  const lower = String(toolName || "").toLowerCase();
  if (lower.includes("edit")) {
    const diff = formatWorkflowEditPreview(input);
    if (diff) {
      return { kind: "diff", content: diff, found: true };
    }
  }
  const content = workflowInputValue(input, ["content", "new_string", "new_source"]);
  if (content.found) {
    return { kind: "content", content: content.value, found: true };
  }
  return { kind: "content", content: "", found: false };
}

function ensureWorkflowPreviewTitleParts(previewNode) {
  const title = previewNode?.querySelector(".workflow-output-title");
  if (!title) {
    return null;
  }
  let label = title.querySelector(".workflow-output-label");
  let count = title.querySelector(".workflow-output-line-count");
  if (!label || !count) {
    const current = title.textContent || "작성 중인 결과물";
    title.textContent = "";
    label = document.createElement("span");
    label.className = "workflow-output-label";
    label.textContent = current;
    count = document.createElement("span");
    count.className = "workflow-output-line-count";
    title.append(label, count);
  }
  return { label, count };
}

function updateWorkflowPreviewTitle(preview, path = "") {
  const parts = ensureWorkflowPreviewTitleParts(preview?.node);
  if (!parts) {
    return;
  }
  preview.path = path || preview.path || "";
  const isDiff = preview.kind === "diff";
  const prefix = isDiff
    ? (preview.done ? "수정 완료" : "수정 미리보기")
    : (preview.done ? "작성 완료" : "작성 중인 결과물");
  const displayName = workflowPreviewFileName(preview.path);
  parts.label.textContent = displayName ? `${prefix} - ${displayName}` : prefix;
}

async function refreshWorkflowPreviewTokenCount(preview, options = {}) {
  const allowDone = Boolean(options.allowDone);
  preview.tokenTimer = 0;
  if (preview.kind === "diff") {
    return;
  }
  const text = String(preview.tokenText || "");
  if (!text || (!allowDone && preview.done) || !preview.node?.isConnected) {
    return;
  }
  const requestId = (preview.tokenRequestId || 0) + 1;
  preview.tokenRequestId = requestId;
  try {
    const response = await fetch("/api/token-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if ((!allowDone && preview.done) || preview.tokenRequestId !== requestId || String(preview.tokenText || "") !== text) {
      return;
    }
    preview.tokenExactText = text;
    preview.tokenExactCount = Number(payload.tokens) || 0;
    const parts = ensureWorkflowPreviewTitleParts(preview.node);
    if (parts) {
      parts.count.textContent = formatWorkflowTokenCount(preview.tokenExactCount);
    }
  } catch {
    // Keep the local estimate visible if the tokenizer request is interrupted.
  }
}

function updateWorkflowPreviewLineCount(preview, text = preview?.body?.textContent || "") {
  const parts = ensureWorkflowPreviewTitleParts(preview?.node);
  if (!parts) {
    return;
  }
  const value = String(text || "");
  preview.tokenText = value;
  if (!value) {
    window.clearTimeout(preview.tokenTimer);
    preview.tokenTimer = 0;
    parts.count.textContent = "0 토큰";
    return;
  }
  if (preview.kind === "diff") {
    const changedLines = value
      .split(/\r?\n/)
      .filter((line) => line.startsWith("++ ") || line.startsWith("-- "))
      .length;
    parts.count.textContent = `${changedLines.toLocaleString()}줄 변경`;
    return;
  }
  if (preview.tokenExactText === value) {
    parts.count.textContent = formatWorkflowTokenCount(preview.tokenExactCount);
    return;
  }
  parts.count.textContent = formatWorkflowTokenCount(estimateTextTokens(value));
}

function scrollWorkflowPreviewToBottom(preview) {
  const body = preview?.body;
  if (!body) {
    return;
  }
  body.scrollTop = body.scrollHeight;
  window.requestAnimationFrame(() => {
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  });
}

function workflowPreviewDisplayText(content) {
  return String(content || "");
}

function renderWorkflowPreviewBody(preview, text) {
  if (!preview?.body) {
    return;
  }
  preview.body.classList.toggle("diff", preview.kind === "diff");
  preview.body.textContent = "";
  if (preview.kind !== "diff") {
    preview.body.textContent = text;
    return;
  }
  for (const line of String(text || "").split(/\r?\n/)) {
    const row = document.createElement("span");
    row.className = "workflow-diff-line";
    if (line.startsWith("++ ")) {
      row.classList.add("added");
    } else if (line.startsWith("-- ")) {
      row.classList.add("removed");
    } else if (line.startsWith("@@")) {
      row.classList.add("hunk");
    }
    row.textContent = line || " ";
    preview.body.append(row);
  }
}

function setWorkflowPreviewTarget(preview, content, options = {}) {
  if (!preview) {
    return;
  }
  if (preview.done) {
    return;
  }
  preview.kind = options.kind || preview.kind || "content";
  const nextText = workflowPreviewDisplayText(content);
  window.clearTimeout(preview.timer);
  preview.timer = 0;
  preview.text = nextText;
  preview.hasOutputPreview = true;
  preview.offset = nextText.length;
  renderWorkflowPreviewBody(preview, nextText);
  updateWorkflowPreviewLineCount(preview, nextText);
  scrollWorkflowPreviewToBottom(preview);
}

function workflowPreviewKey(toolName, input = {}, fallbackKey = "") {
  const path = String(input?.file_path || input?.path || "").trim();
  if (path) {
    return `path:${path}`;
  }
  return fallbackKey || `tool:${String(toolName || "tool").toLowerCase()}`;
}

function isWorkflowOutputTool(toolName) {
  const lower = String(toolName || "").toLowerCase();
  if (lower === "todo_write" || lower === "todowrite") {
    return false;
  }
  return lower.includes("write") || lower.includes("edit");
}

function createWorkflowPreviewNode(path = "") {
  const node = document.createElement("div");
  node.className = "workflow-output-preview";
  const title = document.createElement("div");
  title.className = "workflow-output-title";
  const label = document.createElement("span");
  label.className = "workflow-output-label";
  const displayName = workflowPreviewFileName(path);
  label.textContent = displayName ? `작성 중인 결과물 - ${displayName}` : "작성 중인 결과물";
  const count = document.createElement("span");
  count.className = "workflow-output-line-count";
  count.textContent = "";
  title.append(label, count);
  const body = document.createElement("pre");
  body.className = "workflow-output-body";
  node.append(title, body);
  return { node, body };
}

function ensureWorkflowPreview(key, path = "") {
  ensureWorkflowPanel();
  if (!workflowPreviewList) {
    return null;
  }
  const cleanKey = String(key || path || `preview:${workflowPreviews.size + 1}`);
  let preview = workflowPreviews.get(cleanKey);
  if (!preview) {
    const elements = createWorkflowPreviewNode(path);
    preview = {
      key: cleanKey,
      node: elements.node,
      body: elements.body,
      timer: 0,
      tokenTimer: 0,
      tokenRequestId: 0,
      tokenText: "",
      tokenExactText: "",
      tokenExactCount: 0,
      tokenFinalRequested: false,
      text: "",
      offset: 0,
      path,
      kind: "content",
    };
    workflowPreviews.set(cleanKey, preview);
    workflowPreviewList.append(elements.node);
  } else if (path) {
    updateWorkflowPreviewTitle(preview, path);
  }
  return preview;
}

function isCommandCatalog(text) {
  const source = String(text || "");
  return source.includes("Available commands:") || source.includes("사용 가능한 명령어:");
}

function splitCommandCatalog(text) {
  const source = String(text || "");
  const marker = source.includes("사용 가능한 명령어:")
    ? "사용 가능한 명령어:"
    : "Available commands:";
  const skillMarker = source.includes("사용 가능한 스킬:")
    ? "사용 가능한 스킬:"
    : "Available skills:";
  const index = source.indexOf(marker);
  if (index < 0) {
    return { intro: "", catalog: source };
  }
  const skillIndex = source.indexOf(skillMarker, index + marker.length);
  return {
    intro: source.slice(0, index).trim(),
    catalog: source.slice(index, skillIndex < 0 ? undefined : skillIndex).trim(),
    skills: skillIndex < 0 ? "" : source.slice(skillIndex).trim(),
  };
}

function parseCommandCatalog(text) {
  const { catalog } = splitCommandCatalog(text);
  const source = String(catalog || "").replace(/^(Available commands:|사용 가능한 명령어:)\s*/i, "").trim();
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

function splitNamedCatalog(text, marker) {
  const source = String(text || "");
  const index = source.indexOf(marker);
  if (index < 0) {
    return "";
  }
  const headings = [
    "Available skills:",
    "사용 가능한 스킬:",
    "MCP servers:",
    "MCP 서버:",
    "Plugins:",
    "플러그인:",
    "Toggle usage:",
    "전환 사용법:",
    "Available commands:",
    "사용 가능한 명령어:",
  ];
  const end = headings
    .filter((heading) => heading !== marker)
    .map((heading) => source.indexOf(heading, index + marker.length))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right)[0];
  return source.slice(index, end === undefined ? undefined : end).trim();
}

function parseSkillCatalog(text) {
  const marker = String(text || "").includes("사용 가능한 스킬:")
    ? "사용 가능한 스킬:"
    : "Available skills:";
  const source = splitNamedCatalog(text, marker)
    .replace(/^(Available skills:|사용 가능한 스킬:)\s*/i, "")
    .trim();
  if (!source || source === "(no custom skills available)" || source === "(사용자 스킬이 없습니다)") {
    return [];
  }
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = line.match(/^-\s+(.+?)(?:\s+\[([^\]]+)\])?\s+\[(enabled|disabled|활성|비활성)\]\s*:\s*(.*)$/i);
      if (!match) {
        return null;
      }
      return {
        name: match[1].trim(),
        source: (match[2] || "skill").trim(),
        enabled: ["enabled", "활성"].includes(match[3].toLowerCase()),
        description: (match[4] || "").trim(),
      };
    })
    .filter(Boolean);
}

function parseMcpCatalog(text) {
  const marker = String(text || "").includes("MCP 서버:")
    ? "MCP 서버:"
    : "MCP servers:";
  const source = splitNamedCatalog(text, marker)
    .replace(/^(MCP servers:|MCP 서버:)\s*/i, "")
    .trim();
  if (!source || source === "(no MCP servers configured)" || source === "(설정된 MCP 서버가 없습니다)") {
    return [];
  }
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = line.match(/^-\s+(.+?)\s+\[(enabled|disabled|활성|비활성)\]\s+\(([^)]*)\)/i);
      if (!match) {
        return null;
      }
      return {
        name: match[1].trim(),
        enabled: ["enabled", "활성"].includes(match[2].toLowerCase()),
        description: match[3].trim() || "MCP server",
      };
    })
    .filter(Boolean);
}

function parsePluginCatalog(text) {
  const marker = String(text || "").includes("플러그인:")
    ? "플러그인:"
    : "Plugins:";
  const source = splitNamedCatalog(text, marker)
    .replace(/^(Plugins:|플러그인:)\s*/i, "")
    .trim();
  if (!source || source === "(no plugins discovered)" || source === "(발견된 플러그인이 없습니다)") {
    return [];
  }
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = line.match(/^-\s+(.+?)\s+\[(enabled|disabled|활성|비활성)\](?::\s*(.*))?$/i);
      if (!match) {
        return null;
      }
      return {
        name: match[1].trim(),
        enabled: ["enabled", "활성"].includes(match[2].toLowerCase()),
        description: (match[3] || "Plugin").trim(),
      };
    })
    .filter(Boolean);
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

function currentSkillState(name, fallback) {
  const skill = state.skills.find((item) => item.name.toLowerCase() === String(name || "").toLowerCase());
  return skill ? skill.enabled !== false : fallback !== false;
}

function updateSkillToggleButton(button) {
  const enabled = currentSkillState(button.dataset.skillName, button.dataset.skillEnabled !== "false");
  button.dataset.skillEnabled = enabled ? "true" : "false";
  button.classList.toggle("disabled", !enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  const status = button.querySelector("[data-skill-status]");
  if (status) {
    status.textContent = enabled ? "Active" : "Inactive";
  }
}

function refreshSkillCatalogs() {
  document.querySelectorAll(".skill-toggle-pill").forEach((button) => {
    updateSkillToggleButton(button);
  });
}

function createSkillCatalog(text) {
  const skills = parseSkillCatalog(text);
  if (!skills.length && !splitNamedCatalog(text, "Available skills:")) {
    return null;
  }
  const details = document.createElement("details");
  details.className = "command-card skill-card";
  details.open = true;

  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = "Skills";
  const count = document.createElement("span");
  count.className = "command-count";
  count.textContent = `${skills.length}개`;
  summary.append(label, count);
  details.append(summary);

  const grid = document.createElement("div");
  grid.className = "command-grid skill-grid";
  if (!skills.length) {
    const empty = document.createElement("span");
    empty.className = "skill-pill-description";
    empty.textContent = "No custom skills available";
    grid.append(empty);
    details.append(grid);
    return details;
  }
  for (const skill of skills) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "command-pill skill-toggle-pill";
    item.dataset.skillName = skill.name;
    item.dataset.skillEnabled = skill.enabled ? "true" : "false";
    item.addEventListener("click", async () => {
      const nextEnabled = item.dataset.skillEnabled === "false";
      const existing = state.skills.find((entry) => entry.name.toLowerCase() === skill.name.toLowerCase());
      if (existing) {
        existing.enabled = nextEnabled;
      }
      item.dataset.skillEnabled = nextEnabled ? "true" : "false";
      updateSkillToggleButton(item);
      try {
        if (ctx.sendBackendRequest) {
          await sendBackendRequest({ type: "set_skill_enabled", value: skill.name, enabled: nextEnabled });
        } else {
          await sendLine(`/skills ${nextEnabled ? "enable" : "disable"} ${skill.name}`);
        }
      } catch (error) {
        if (existing) {
          existing.enabled = !nextEnabled;
        }
        item.dataset.skillEnabled = nextEnabled ? "false" : "true";
        updateSkillToggleButton(item);
        appendMessage("system", `Skill toggle failed: ${error.message}`);
      }
    });
    const header = document.createElement("span");
    header.className = "skill-pill-header";
    const name = document.createElement("strong");
    name.textContent = skill.name;
    const status = document.createElement("small");
    status.dataset.skillStatus = "true";
    const description = document.createElement("span");
    description.className = "skill-pill-description";
    description.textContent = skill.description || "Skill";
    header.append(name, status);
    item.append(header, description);
    grid.append(item);
    updateSkillToggleButton(item);
  }
  details.append(grid);
  return details;
}

function updateExtensionToggleButton(button) {
  const enabled = button.dataset.itemEnabled !== "false";
  button.classList.toggle("disabled", !enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  const status = button.querySelector("[data-extension-status]");
  if (status) {
    status.textContent = enabled ? "Active" : "Inactive";
  }
}

function createExtensionCatalog({ label, items, emptyText, requestType }) {
  const details = document.createElement("details");
  details.className = "command-card skill-card";
  details.open = true;

  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = label;
  const count = document.createElement("span");
  count.className = "command-count";
  count.textContent = items.length ? `${items.length}개` : "0개";
  summary.append(title, count);
  details.append(summary);

  const grid = document.createElement("div");
  grid.className = "command-grid skill-grid";
  if (!items.length) {
    const empty = document.createElement("span");
    empty.className = "skill-pill-description";
    empty.textContent = emptyText;
    grid.append(empty);
    details.append(grid);
    return details;
  }

  for (const entry of items) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "command-pill skill-toggle-pill";
    item.dataset.itemName = entry.name;
    item.dataset.itemEnabled = entry.enabled ? "true" : "false";
    item.addEventListener("click", async () => {
      const nextEnabled = item.dataset.itemEnabled === "false";
      item.dataset.itemEnabled = nextEnabled ? "true" : "false";
      updateExtensionToggleButton(item);
      try {
        if (ctx.sendBackendRequest) {
          await sendBackendRequest({ type: requestType, value: entry.name, enabled: nextEnabled });
        }
      } catch (error) {
        item.dataset.itemEnabled = nextEnabled ? "false" : "true";
        updateExtensionToggleButton(item);
        appendMessage("system", `${label} toggle failed: ${error.message}`);
      }
    });
    const header = document.createElement("span");
    header.className = "skill-pill-header";
    const name = document.createElement("strong");
    name.textContent = entry.name;
    const status = document.createElement("small");
    status.dataset.extensionStatus = "true";
    const description = document.createElement("span");
    description.className = "skill-pill-description";
    description.textContent = entry.description || label;
    header.append(name, status);
    item.append(header, description);
    grid.append(item);
    updateExtensionToggleButton(item);
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
    setMarkdown(introNode, formatHelpIntro(intro));
    wrap.append(introNode);
  }
  const skillCatalog = createSkillCatalog(text);
  if (skillCatalog) {
    wrap.append(skillCatalog);
  }
  if (splitNamedCatalog(text, "MCP servers:")) {
    wrap.append(createExtensionCatalog({
      label: "MCP",
      items: parseMcpCatalog(text),
      emptyText: "No MCP servers configured",
      requestType: "set_mcp_enabled",
    }));
  }
  if (splitNamedCatalog(text, "Plugins:")) {
    wrap.append(createExtensionCatalog({
      label: "Plugins",
      items: parsePluginCatalog(text),
      emptyText: "No plugins discovered",
      requestType: "set_plugin_enabled",
    }));
  }
  wrap.append(createCommandCatalog(text));
  return wrap;
}

function formatHelpIntro(text) {
  return String(text || "")
    .replace(/^입력 단축키:\s*$/gm, "**입력 단축키**")
    .replace(/^자주 쓰는 기능:\s*$/gm, "**자주 쓰는 기능**");
}

function createAttachmentPreview(attachments = []) {
  if (!attachments.length) {
    return null;
  }
  const wrap = document.createElement("div");
  wrap.className = "message-attachments";
  for (const attachment of attachments) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-attachment-preview";
    button.setAttribute("aria-label", `${attachment.name || "첨부 이미지"} 크게 보기`);
    const image = document.createElement("img");
    image.src = `data:${attachment.media_type || attachment.mediaType};base64,${attachment.data}`;
    image.alt = attachment.name || "첨부 이미지";
    image.title = attachment.name || "첨부 이미지";
    button.addEventListener("click", () => {
      showImagePreview({
        src: image.src,
        name: attachment.name || "이미지",
        alt: image.alt,
      });
    });
    button.append(image);
    wrap.append(button);
  }
  return wrap;
}

function prettifyPromptToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (token.startsWith("/")) {
    return token.slice(1);
  }
  if (token.startsWith("@")) {
    const name = token.slice(1).split(/[\\/]/).filter(Boolean).pop() || token.slice(1);
    return name || token;
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

function appendTextWithLineBreaks(parent, text) {
  const parts = String(text || "").split("\n");
  parts.forEach((part, index) => {
    if (index > 0) {
      parent.append(document.createElement("br"));
    }
    if (part) {
      parent.append(document.createTextNode(part));
    }
  });
}

function promptTokenKind(rawToken) {
  if (rawToken.startsWith("/")) {
    return "command";
  }
  if (rawToken.startsWith("@")) {
    return "file";
  }
  const lower = rawToken.toLowerCase();
  if (lower.startsWith("$mcp:")) {
    return "mcp";
  }
  if (lower.startsWith("$plugin:")) {
    return "plugin";
  }
  return "skill";
}

function createPromptToken(rawToken) {
  const chip = document.createElement("span");
  chip.className = `prompt-token ${promptTokenKind(rawToken)}`;
  chip.textContent = prettifyPromptToken(rawToken);
  chip.title = rawToken;
  return chip;
}

function createPromptTokenContent(text) {
  const value = String(text || "");
  const tokenPattern = /(^|\s)(\$"[^"]+"|\$'[^']+'|\$[^\s]+|@[^\s]+|\/[a-z][a-z0-9-]*)/gi;
  const matches = [...value.matchAll(tokenPattern)];
  if (!matches.length) {
    return null;
  }
  const wrap = document.createElement("div");
  wrap.className = "prompt-line";
  let cursor = 0;
  for (const match of matches) {
    const leading = match[1] || "";
    const rawToken = match[2] || "";
    const tokenStart = match.index + leading.length;
    appendTextWithLineBreaks(wrap, value.slice(cursor, tokenStart));
    wrap.append(createPromptToken(rawToken));
    cursor = tokenStart + rawToken.length;
  }
  appendTextWithLineBreaks(wrap, value.slice(cursor));
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
    const promptContent = createPromptTokenContent(value);
    if (promptContent) {
      content.append(promptContent);
    } else {
      setMarkdown(content, value);
    }
    content.classList.add("user-expanded-message");
    content.classList.remove("user-collapsed-message");
    content.append(toggle);
    return;
  }

  const preview = document.createElement("span");
  preview.className = "user-message-preview";
  const previewText = value.replace(/\s+/g, " ").trim();
  const promptContent = createPromptTokenContent(previewText);
  if (promptContent) {
    preview.append(...promptContent.childNodes);
  } else {
    preview.textContent = previewText;
  }
  content.append(preview, toggle);
}

function answerFileName(text) {
  const title = String(state.chatTitle || "").trim();
  const source = title && title !== "MyHarness"
    ? title
    : String(text || "").split(/\r?\n/).find((line) => line.trim()) || "answer";
  const clean = source
    .replace(/[#*_`~[\](){}<>]/g, "")
    .replace(/[\\/:*?"|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `outputs/${clean || "answer"}.md`;
}

function attachAssistantActions(content, rawText) {
  const text = String(rawText || "").trim();
  if (!content || !text || content.dataset.answerActionsAttached === "true") {
    return;
  }
  const bubble = content.closest(".bubble");
  if (!bubble) {
    return;
  }
  if (bubble.querySelector(".assistant-actions")) {
    content.dataset.answerActionsAttached = "true";
    return;
  }
  const actions = document.createElement("div");
  actions.className = "assistant-actions";

  const done = document.createElement("span");
  done.className = "assistant-done";
  done.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 6 9 17l-5-5"></path>
    </svg>
    <span>답변 완료</span>
  `;

  const status = document.createElement("span");
  status.className = "assistant-action-status";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "assistant-action-button";
  copyButton.dataset.tooltip = "원문 복사";
  copyButton.setAttribute("aria-label", "원문 복사");
  copyButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
  copyButton.addEventListener("click", async () => {
    copyButton.disabled = true;
    try {
      await copyTextToClipboard(text);
      status.textContent = "복사했습니다.";
    } catch (error) {
      status.textContent = `복사 실패: ${error.message}`;
    } finally {
      window.setTimeout(() => {
        copyButton.disabled = false;
        status.textContent = "";
      }, 1400);
    }
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "assistant-action-button";
  saveButton.dataset.tooltip = "파일로 저장";
  saveButton.setAttribute("aria-label", "파일로 저장");
  saveButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path>
      <path d="M17 21v-8H7v8"></path>
      <path d="M7 3v5h8"></path>
    </svg>
  `;
  saveButton.addEventListener("click", async () => {
    if (!state.sessionId) {
      status.textContent = "저장할 세션이 없습니다.";
      return;
    }
    saveButton.disabled = true;
    status.textContent = "저장 중...";
    try {
      const response = await fetch("/api/artifact/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          session: state.sessionId,
          clientId: state.clientId,
          path: answerFileName(text),
          content: text,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      state.projectFilesLoadedForSession = "";
      if (payload.artifact) {
        const existing = new Set((state.projectFiles || []).map((file) => file.path));
        if (!existing.has(payload.artifact.path)) {
          state.projectFiles = [payload.artifact, ...(state.projectFiles || [])];
        }
        status.textContent = `${payload.artifact.path} 저장됨`;
      } else {
        status.textContent = "저장했습니다.";
      }
    } catch (error) {
      status.textContent = `저장 실패: ${error.message}`;
    } finally {
      window.setTimeout(() => {
        saveButton.disabled = false;
        if (!status.textContent.includes("실패")) {
          status.textContent = "";
        }
      }, 1800);
    }
  });

  actions.append(done, copyButton, saveButton, status);
  content.dataset.answerActionsAttached = "true";
  bubble.append(actions);
}

function messageKindBadge(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (normalized === "steering" || normalized === "steer") {
    return { className: "steering", label: "스티어링" };
  }
  if (normalized === "queued" || normalized === "queue") {
    return { className: "queued", label: "대기열" };
  }
  return null;
}

function appendMessage(role, text, attachments = [], options = {}) {
  if (!Array.isArray(attachments)) {
    options = attachments || {};
    attachments = [];
  }
  removeWelcome();
  const article = document.createElement("article");
  const commandCatalog = role !== "user" && isCommandCatalog(text);
  const kindBadge = role === "user" ? messageKindBadge(options.kind || options.messageKind) : null;
  article.className = `message ${commandCatalog ? "system command-output" : role}`;
  if (kindBadge) {
    article.classList.add(`message-kind-${kindBadge.className}`);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (kindBadge) {
    const badge = document.createElement("div");
    badge.className = "message-kind-label";
    badge.textContent = kindBadge.label;
    article.append(badge);
  }
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
    if (promptContent && !shouldCollapseUserMessage(text)) {
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

function parseTodoItems(markdown = "") {
  return String(markdown || "")
    .split("\n")
    .map((line) => line.match(/^\s*-\s+\[([ xX])\]\s+(.+)/))
    .filter(Boolean)
    .map((match) => ({
      checked: String(match[1]).toLowerCase() === "x",
      text: String(match[2] || "").trim(),
    }))
    .filter((item) => item.text);
}

function createTodoChecklistCard(items, {
  archived = false,
  collapsed = false,
  runningIndex = -1,
  markdown = "",
} = {}) {
  const card = document.createElement("section");
  card.className = archived
    ? "todo-card composer-todo-card check-list-card workflow-todo-card"
    : "todo-card composer-todo-card check-list-card";
  card.classList.toggle("collapsed", collapsed);

  const done = items.filter((item) => item.checked).length;
  const listId = `todoChecklistItems-${++todoListSerial}`;
  const header = document.createElement("div");
  header.className = "todo-card-header";
  const title = document.createElement("strong");
  title.textContent = "Check List ";
  const count = document.createElement("span");
  count.className = "todo-card-count";
  count.textContent = `(${done}/${items.length})`;
  title.append(count);
  const actions = document.createElement("div");
  actions.className = "todo-card-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "todo-collapse-toggle";
  toggle.setAttribute("aria-controls", listId);
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.setAttribute("aria-label", collapsed ? "Check List 펼치기" : "Check List 접기");
  const toggleChecklist = () => {
    if (archived) {
      const nextCollapsed = !card.classList.contains("collapsed");
      card.classList.toggle("collapsed", nextCollapsed);
      list.hidden = nextCollapsed;
      toggle.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
      toggle.setAttribute("aria-label", nextCollapsed ? "Check List 펼치기" : "Check List 접기");
      return;
    }
    state.todoCollapsed = !state.todoCollapsed;
    renderTodoChecklist(markdown || state.todoMarkdown);
  };
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleChecklist();
  });
  card.addEventListener("click", (event) => {
    let node = event.target;
    while (node && node !== card) {
      if (node.classList?.contains("todo-dismiss-button")) {
        return;
      }
      node = node.parentElement;
    }
    toggleChecklist();
  });
  if (!archived) {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "todo-dismiss-button";
    dismiss.setAttribute("aria-label", "Check List 삭제");
    dismiss.addEventListener("click", (event) => {
      event.stopPropagation();
      resetTodoChecklist();
    });
    actions.append(toggle, dismiss);
  } else {
    actions.append(toggle);
  }
  header.append(title, actions);

  const appendRows = (target, { includeRunning = true } = {}) => {
    for (const item of items) {
      const row = document.createElement("li");
      row.className = item.checked ? "done" : "";
      const itemIndex = target.children.length;
      if (includeRunning && itemIndex === runningIndex) {
        row.classList.add("running");
      }
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.checked;
      checkbox.disabled = true;
      const spinner = document.createElement("span");
      spinner.className = "todo-spinner";
      spinner.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "todo-label";
      label.textContent = item.checked ? `(완료) ${item.text}` : item.text;
      row.append(checkbox, spinner, label);
      target.append(row);
    }
  };

  const list = document.createElement("ul");
  list.id = listId;
  list.className = "todo-card-list";
  list.hidden = collapsed;
  appendRows(list);

  if (collapsed) {
    const sizer = document.createElement("ul");
    sizer.className = "todo-card-list todo-card-sizer";
    sizer.setAttribute("aria-hidden", "true");
    appendRows(sizer, { includeRunning: false });
    card.append(header, list, sizer);
    return card;
  }

  card.append(header, list);
  return card;
}

function renderTodoChecklist(markdown = "") {
  const items = parseTodoItems(markdown);
  if (!items.length) {
    resetTodoChecklist();
    return;
  }
  removeWelcome();
  state.todoMarkdown = markdown;

  let card = state.todoNode;
  if (!card || !card.isConnected) {
    card = createTodoChecklistCard(items, {
      collapsed: Boolean(state.todoCollapsed),
      markdown,
      runningIndex: state.busy && !state.restoringHistory
        ? items.findIndex((item) => !item.checked)
        : -1,
    });
    state.todoNode = card;
  }
  const dock = els.todoChecklistDock;
  if (dock && card.parentElement !== dock) {
    dock.textContent = "";
    dock.append(card);
  }
  dock?.classList.remove("hidden");
  const nextCard = createTodoChecklistCard(items, {
    collapsed: Boolean(state.todoCollapsed),
    markdown,
    runningIndex: state.busy && !state.restoringHistory
      ? items.findIndex((item) => !item.checked)
      : -1,
  });
  card.replaceWith(nextCard);
  state.todoNode = nextCard;
  if (state.restoringHistory) {
    scheduleScrollRestore();
  } else {
    scrollMessagesToBottom();
  }
}

function archiveTodoChecklist() {
  const markdown = state.todoMarkdown;
  const items = parseTodoItems(markdown);
  if (!items.length) {
    resetTodoChecklist();
    return false;
  }
  if (!state.workflowNode) {
    resetTodoChecklist();
    return false;
  }
  const body = state.workflowNode.querySelector(".workflow-body");
  const list = state.workflowList;
  if (!body || !list) {
    resetTodoChecklist();
    return false;
  }
  let slot = body.querySelector(".workflow-todo-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "workflow-todo-slot";
    body.insertBefore(slot, list);
  }
  slot.textContent = "";
  slot.append(createTodoChecklistCard(items, {
    archived: true,
    collapsed: true,
    markdown,
  }));
  resetTodoChecklist();
  state.workflowNode.open = true;
  return true;
}

function resetTodoChecklist() {
  state.todoMarkdown = "";
  state.todoCollapsed = false;
  state.todoNode?.remove();
  state.todoNode = null;
  els.todoChecklistDock?.classList.add("hidden");
  if (els.todoChecklistDock) {
    els.todoChecklistDock.textContent = "";
  }
}

function clearTodoProgressState() {
  state.todoNode?.querySelectorAll(".todo-card-list li.running").forEach((row) => {
    row.classList.remove("running");
  });
}

function resetWorkflowPanel() {
  clearTodoProgressState();
  workflowEventQueue = [];
  window.clearTimeout(workflowEventQueueTimer);
  window.clearTimeout(workflowWaitingTimer);
  for (const preview of workflowPreviews.values()) {
    window.clearTimeout(preview.timer);
    window.clearTimeout(preview.tokenTimer);
  }
  workflowEventQueueTimer = 0;
  workflowWaitingTimer = 0;
  workflowWaitingIndex = 0;
  workflowIntent = "default";
  workflowPurposeGroupSerial = 0;
  workflowPreviewList = null;
  workflowPreviews.clear();
  workflowToolArgBuffers.clear();
  for (const timer of workflowMutationWaitingTimers.values()) {
    window.clearTimeout(timer);
  }
  workflowMutationWaitingTimers.clear();
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
  if (
    state.workflowNode.querySelector(".workflow-todo-card")
    || state.workflowNode.querySelector(".workflow-output-preview")
  ) {
    state.workflowNode.open = true;
    return;
  }
  if (state.restoringHistory || state.batchingHistoryRestore) {
    state.workflowNode.open = false;
    return;
  }
  animateWorkflowDetails(state.workflowNode, false);
}

function finalizeWorkflowSummary() {
  drainWorkflowEventQueue();
  stopWorkflowWaitingTimer();
  for (const timer of workflowMutationWaitingTimers.values()) {
    window.clearTimeout(timer);
  }
  workflowMutationWaitingTimers.clear();
  workflowEventQueue = [];
  window.clearTimeout(workflowEventQueueTimer);
  workflowEventQueueTimer = 0;
  markPlanningStepDone();
  state.workflowList?.querySelectorAll(".workflow-step.running").forEach((row) => {
    row.classList.remove("running");
    row.classList.add("done");
    const detail = row.querySelector("small");
    if (detail) {
      detail.textContent = "완료되었습니다.";
    }
  });
  refreshWorkflowPurposeSteps();
  markWorkflowFinalAnswerDone("done", "응답을 마무리했습니다.");
  updateWorkflowSummary();
  flushWorkflowOutputPreview();
  stopWorkflowTimer();
  clearTodoProgressState();
}

function failWorkflowPanel(message = "") {
  drainWorkflowEventQueue();
  stopWorkflowWaitingTimer();
  for (const timer of workflowMutationWaitingTimers.values()) {
    window.clearTimeout(timer);
  }
  workflowMutationWaitingTimers.clear();
  workflowEventQueue = [];
  window.clearTimeout(workflowEventQueueTimer);
  workflowEventQueueTimer = 0;
  flushWorkflowOutputPreview();
  stopWorkflowTimer();

  const hasToolStep = state.workflowSteps.some((row) => row.dataset.toolName);
  if (!hasToolStep) {
    const article = state.workflowNode?.closest(".workflow-message");
    article?.remove();
    resetWorkflowPanel();
    return;
  }

  markPlanningStepDone();
  markWorkflowFinalAnswerDone("error", message || "응답을 마무리하지 못했습니다.");
  state.workflowList?.querySelectorAll(".workflow-step.running").forEach((row) => {
    row.classList.remove("running");
    row.classList.add("error");
    const detail = row.querySelector("small");
    if (detail) {
      detail.textContent = message || "작업이 실패했습니다.";
    }
  });
  refreshWorkflowPurposeSteps();
  updateWorkflowSummary();
  collapseWorkflowPanel();
  clearTodoProgressState();
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
  list.setAttribute("role", "list");

  const previewList = document.createElement("div");
  previewList.className = "workflow-output-list";

  const body = document.createElement("div");
  body.className = "workflow-body";
  body.append(list, previewList);
  details.append(summary, body);
  setupWorkflowToggle(details);
  article.append(details);
  if (state.restoringHistory) {
    const userMessages = [...(els.messages.querySelectorAll?.(".message.user") || [])];
    const latestUserMessage = userMessages[userMessages.length - 1];
    if (latestUserMessage?.parentElement === els.messages) {
      latestUserMessage.after(article);
    } else {
      els.messages.prepend(article);
    }
  } else {
    els.messages.append(article);
  }

  state.workflowNode = details;
  state.workflowList = list;
  state.workflowSummary = count;
  workflowPreviewList = previewList;
  state.workflowSteps = [];
  state.workflowStartedAt = performance.now();
  startWorkflowTimer();
  appendWorkflowStep("요청 이해", "사용자 요청을 확인했습니다.", "done");
  appendWorkflowStep(
    "작업 계획 수립",
    workflowIntent === "file" ? "파일 작성 방향과 저장 방식을 정리합니다." : "필요한 맥락과 진행 방향을 정리합니다.",
    "running",
    "",
    { role: "planning" },
  );
  if (!state.restoringHistory) {
    startWorkflowWaitingTimer();
    scrollMessagesToBottom();
  }
}

function setupWorkflowToggle(details) {
  const summary = details.querySelector("summary");
  if (!summary) {
    return;
  }
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    animateWorkflowDetails(details, !details.open);
  });
}

function animateWorkflowDetails(details, open) {
  const body = details.querySelector(".workflow-body");
  if (!body) {
    details.open = open;
    return;
  }
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion) {
    details.open = open;
    body.style.maxHeight = "";
    body.style.opacity = "";
    body.style.transform = "";
    details.classList.remove("is-collapsing", "is-expanding");
    return;
  }
  if (details.dataset.workflowAnimating === "1") {
    return;
  }
  if (open && details.open) {
    return;
  }
  if (!open && !details.open) {
    return;
  }

  details.dataset.workflowAnimating = "1";
  body.style.overflow = "hidden";

  if (open) {
    details.open = true;
    details.classList.add("is-expanding");
    body.style.maxHeight = "0px";
    body.style.opacity = "0";
    body.style.transform = "translateY(-6px)";
    window.requestAnimationFrame(() => {
      body.style.maxHeight = `${body.scrollHeight}px`;
      body.style.opacity = "1";
      body.style.transform = "translateY(0)";
    });
  } else {
    details.classList.add("is-collapsing");
    body.style.maxHeight = `${body.scrollHeight}px`;
    body.style.opacity = "1";
    body.style.transform = "translateY(0)";
    window.requestAnimationFrame(() => {
      body.style.maxHeight = "0px";
      body.style.opacity = "0";
      body.style.transform = "translateY(-6px)";
    });
  }

  const finish = (event) => {
    if (event.target !== body || event.propertyName !== "max-height") {
      return;
    }
    body.removeEventListener("transitionend", finish);
    if (!open) {
      details.open = false;
    }
    details.classList.remove("is-collapsing", "is-expanding");
    delete details.dataset.workflowAnimating;
    body.style.maxHeight = "";
    body.style.opacity = "";
    body.style.transform = "";
    body.style.overflow = "";
  };
  body.addEventListener("transitionend", finish);
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
  for (const preview of workflowPreviews.values()) {
    if (!preview.hasOutputPreview) {
      continue;
    }
    window.clearTimeout(preview.timer);
    window.clearTimeout(preview.tokenTimer);
    preview.timer = 0;
    preview.tokenTimer = 0;
    preview.tokenRequestId = (preview.tokenRequestId || 0) + 1;
    preview.done = true;
    renderWorkflowPreviewBody(preview, preview.text);
    preview.offset = preview.text.length;
    updateWorkflowPreviewTitle(preview);
    updateWorkflowPreviewLineCount(preview, preview.text);
    if (preview.kind !== "diff" && !preview.tokenFinalRequested) {
      preview.tokenFinalRequested = true;
      refreshWorkflowPreviewTokenCount(preview, { allowDone: true });
    }
    scrollWorkflowPreviewToBottom(preview);
  }
}

function startWorkflowOutputPreview(toolName, input = {}) {
  const source = workflowPreviewSource(toolName, input);
  if (!source.found || !isWorkflowOutputTool(toolName)) {
    return;
  }
  ensureWorkflowPanel();
  const path = String(input?.file_path || input?.path || "").trim();
  const preview = ensureWorkflowPreview(workflowPreviewKey(toolName, input), path);
  if (!preview) {
    return;
  }
  preview.kind = source.kind;
  updateWorkflowPreviewTitle(preview, path);
  setWorkflowPreviewTarget(preview, source.content, { kind: source.kind });
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

function extractPartialJsonStringField(source, key) {
  const marker = `"${key}"`;
  const keyIndex = source.indexOf(marker);
  if (keyIndex < 0) {
    return { found: false, value: "" };
  }
  const colonIndex = source.indexOf(":", keyIndex + marker.length);
  if (colonIndex < 0) {
    return { found: false, value: "" };
  }
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < source.length && /\s/.test(source[quoteIndex])) {
    quoteIndex += 1;
  }
  if (source[quoteIndex] !== "\"") {
    return { found: false, value: "" };
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
  return { found: true, value: decodeJsonStringFragment(raw) };
}

function extractPartialJsonStringValue(source, key) {
  return extractPartialJsonStringField(source, key).value;
}

function firstPartialJsonStringField(source, keys) {
  for (const key of keys) {
    const field = extractPartialJsonStringField(source, key);
    if (field.found) {
      return field;
    }
  }
  return { found: false, value: "" };
}

function appendWorkflowInputDelta(event) {
  const delta = String(event.arguments_delta || "");
  if (!delta) {
    return;
  }
  ensureWorkflowPanel();
  const key = workflowToolBufferKey(event);
  let current = workflowToolArgBuffers.get(key) || "";
  if (current && /^\s*\{/.test(delta) && /\}\s*$/.test(current)) {
    current = "";
  }
  const next = current + delta;
  workflowToolArgBuffers.set(key, next);
  const oldField = firstPartialJsonStringField(next, ["old_str", "old_string"]);
  const newField = firstPartialJsonStringField(next, ["new_str", "new_string"]);
  const oldString = oldField.value;
  const newString = newField.value;
  const lower = String(event.tool_name || "").toLowerCase();
  const diff = lower.includes("edit") && (oldField.found || newField.found)
    ? formatWorkflowEditBlock(oldString, newString)
    : "";
  const contentField = firstPartialJsonStringField(next, ["content", "new_string", "new_source"]);
  const content = diff || contentField.value;
  const kind = diff ? "diff" : "content";
  const path = extractPartialJsonStringValue(next, "file_path") || extractPartialJsonStringValue(next, "path");
  if (!isWorkflowOutputTool(event.tool_name) || (!diff && !contentField.found)) {
    return;
  }
  const fallbackKey = `delta:${key}`;
  const previewKey = workflowPreviewKey(event.tool_name, { file_path: path }, fallbackKey);
  let preview = workflowPreviews.get(previewKey);
  if (!preview && path) {
    preview = workflowPreviews.get(fallbackKey);
    if (preview) {
      workflowPreviews.delete(fallbackKey);
      preview.key = previewKey;
      workflowPreviews.set(previewKey, preview);
    }
  }
  if (!preview) {
    preview = ensureWorkflowPreview(previewKey, path);
  }
  if (!preview) {
    return;
  }
  preview.kind = kind;
  updateWorkflowPreviewTitle(preview, path);
  setWorkflowPreviewTarget(preview, content, { kind });
  if (!state.restoringHistory && state.autoFollowMessages) {
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
  if (!state.workflowNode || !state.workflowList || state.restoringHistory || !state.busy) {
    return;
  }
  const fileSteps = [
    ["초안 구성 중", "문서에 들어갈 내용과 구조를 정리하고 있습니다."],
    ["파일 작성 준비 중", "Markdown 파일로 저장할 내용을 준비하고 있습니다."],
    ["저장 대기 중", "파일 작업이 시작되면 경로와 결과를 표시합니다."],
  ];
  const defaultSteps = [
    ["응답 준비 중", "필요한 맥락을 정리하고 있습니다."],
    ["실행 대기 중", "다음 활동이나 답변 생성을 기다리고 있습니다."],
    ["처리 계속 중", "작업이 아직 진행 중입니다."],
  ];
  const steps = workflowIntent === "file" ? fileSteps : defaultSteps;
  const [title, detail] = steps[Math.min(workflowWaitingIndex, steps.length - 1)];
  const hasSameRunning = state.workflowSteps.some((row) =>
    row.classList.contains("running") && row.querySelector("strong")?.textContent === title
  );
  if (!hasSameRunning) {
    appendWorkflowStep(title, detail, "running", "", { role: "waiting" });
  }
  workflowWaitingIndex += 1;
  workflowWaitingTimer = window.setTimeout(appendWorkflowWaitingStep, WORKFLOW_WAITING_NEXT_MS);
}

function appendWorkflowStep(titleText, detailText, status = "done", toolName = "", options = {}) {
  const level = options.level || (toolName ? "child" : "parent");
  const row = document.createElement("div");
  row.className = `workflow-step ${level} ${status}${state.restoringHistory ? "" : " entering"}`;
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-level", level === "child" ? "2" : "1");
  row.dataset.workflowLevel = level;
  if (options.role) {
    row.dataset.workflowRole = options.role;
  }
  if (options.purpose) {
    row.dataset.workflowPurpose = options.purpose;
  }
  if (options.groupId) {
    row.dataset.workflowGroupId = options.groupId;
  }
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

function workflowPurposeDetails(purpose) {
  return WORKFLOW_PURPOSE_DETAILS[purpose] || WORKFLOW_PURPOSE_DETAILS.action;
}

function workflowCommandInput(input = {}) {
  return String(input?.command || input?.cmd || input?.script || "").trim();
}

function isVerificationCommand(command = "") {
  const lower = command.toLowerCase();
  return /\b(pytest|unittest|vitest|jest|playwright|tsc|eslint|ruff|mypy)\b/.test(lower)
    || /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|typecheck)\b/.test(lower)
    || /\b(?:cargo\s+test|go\s+test|dotnet\s+test)\b/.test(lower);
}

function isReadOnlyCommand(command = "") {
  const lower = command.toLowerCase();
  if (!lower) {
    return false;
  }
  if (/[>]{1,2}/.test(lower) || /\b(remove-item|rm|del|erase|move-item|mv|copy-item|cp|set-content|add-content|out-file|new-item|mkdir)\b/.test(lower)) {
    return false;
  }
  if (/\bgit\s+(?:add|commit|checkout|switch|reset|merge|rebase|push|pull|clean|restore)\b/.test(lower)) {
    return false;
  }
  const readOnlyStart = /^\s*(?:\$[\w-]+\s*=\s*[^;]+;\s*)?(?:rg|grep|findstr|select-string|get-content|get-childitem|ls|dir|pwd|type|cat|wc)\b/;
  return readOnlyStart.test(lower)
    || /\bgit\s+(?:status|diff|show|log|branch|rev-parse)\b/.test(lower);
}

function workflowPurposeForTool(toolName = "", input = {}) {
  const lower = String(toolName || "").toLowerCase();
  const command = workflowCommandInput(input);
  if (lower.includes("bash") || lower.includes("cmd") || lower.includes("shell")) {
    if (isVerificationCommand(command)) {
      return "verification";
    }
    if (isReadOnlyCommand(command)) {
      return "info";
    }
    return "action";
  }
  if (
    lower.includes("test")
    || lower.includes("build")
    || lower.includes("lint")
    || lower.includes("pytest")
    || lower.includes("tsc")
    || lower.includes("playwright")
  ) {
    return "verification";
  }
  if (
    lower.includes("write")
    || lower.includes("edit")
    || lower.includes("delete")
    || lower.includes("notebook")
  ) {
    return "action";
  }
  if (
    lower.includes("web_search")
    || lower.includes("web_fetch")
    || lower.includes("grep")
    || lower.includes("glob")
    || lower.includes("read")
    || lower.includes("list")
    || lower.includes("search")
    || lower.includes("fetch")
  ) {
    return "info";
  }
  return "action";
}

function latestWorkflowPurposeStep() {
  for (let index = state.workflowSteps.length - 1; index >= 0; index -= 1) {
    const row = state.workflowSteps[index];
    if (row.dataset.workflowRole === "purpose") {
      return row;
    }
  }
  return null;
}

function setWorkflowStepStatus(row, status) {
  row.classList.remove("running", "done", "warning", "error");
  row.classList.add(status);
}

function ensureWorkflowPurposeStep(toolName = "", input = {}) {
  const purpose = workflowPurposeForTool(toolName, input);
  const latestPurpose = latestWorkflowPurposeStep();
  if (latestPurpose?.dataset.workflowPurpose === purpose) {
    setWorkflowStepStatus(latestPurpose, "running");
    const detail = latestPurpose.querySelector("small");
    if (detail) {
      detail.textContent = workflowPurposeDetails(purpose).running;
    }
    return latestPurpose;
  }
  const groupId = `purpose-${++workflowPurposeGroupSerial}`;
  const details = workflowPurposeDetails(purpose);
  return appendWorkflowStep(
    details.title,
    details.running,
    "running",
    "",
    { role: "purpose", purpose, groupId },
  );
}

function workflowChildrenForGroup(groupId) {
  if (!groupId) {
    return [];
  }
  return state.workflowSteps.filter((row) =>
    row.dataset.workflowGroupId === groupId && row.dataset.workflowRole !== "purpose"
  );
}

function updateWorkflowPurposeStepStatus(groupId) {
  if (!groupId) {
    return;
  }
  const purposeStep = state.workflowSteps.find((row) =>
    row.dataset.workflowRole === "purpose" && row.dataset.workflowGroupId === groupId
  );
  if (!purposeStep) {
    return;
  }
  const children = workflowChildrenForGroup(groupId);
  if (!children.length) {
    return;
  }
  const purpose = purposeStep.dataset.workflowPurpose || "action";
  const details = workflowPurposeDetails(purpose);
  const nextStatus = children.some((row) => row.classList.contains("running"))
    ? "running"
    : children.some((row) => row.classList.contains("error"))
      ? "error"
      : children.some((row) => row.classList.contains("warning"))
        ? "warning"
        : "done";
  setWorkflowStepStatus(purposeStep, nextStatus);
  const detail = purposeStep.querySelector("small");
  if (detail) {
    detail.textContent = details[nextStatus] || details.done;
  }
}

function refreshWorkflowPurposeSteps() {
  const groupIds = new Set(
    state.workflowSteps
      .filter((row) => row.dataset.workflowRole === "purpose")
      .map((row) => row.dataset.workflowGroupId)
      .filter(Boolean),
  );
  for (const groupId of groupIds) {
    updateWorkflowPurposeStepStatus(groupId);
  }
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

function drainWorkflowEventQueue() {
  if (workflowEventQueueTimer) {
    window.clearTimeout(workflowEventQueueTimer);
    workflowEventQueueTimer = 0;
  }
  while (workflowEventQueue.length) {
    appendWorkflowEventNow(workflowEventQueue.shift());
  }
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
  markWorkflowWaitingStepsDone("실제 작업 단계로 넘어갔습니다.");
  const isStart = event.type === "tool_started";
  const toolName = event.tool_name || "도구";
  if (isStart) {
    clearWorkflowActivityStep();
    startWorkflowOutputPreview(toolName, event.tool_input || {});
    clearWorkflowToolArgBuffers(toolName);
    scheduleMutationWaitingStep(toolName);
  }
  if (!isStart) {
    clearWorkflowToolArgBuffers(toolName);
    clearMutationWaitingStep(toolName);
    const matchingRunningStep = [...state.workflowList.querySelectorAll(".workflow-step.running")]
      .find((item) => item.dataset.toolName === toolName);
    if (matchingRunningStep) {
      const item = matchingRunningStep;
      item.classList.remove("running", "done", "warning", "error");
      item.classList.add(workflowEventStatus(event));
      item.querySelector("strong").textContent = workflowTitle(event);
      const detail = item.querySelector("small");
      if (detail) {
        detail.textContent = workflowDetail(event);
      }
      updateWorkflowPurposeStepStatus(item.dataset.workflowGroupId);
      updateWorkflowSummary();
      startWorkflowReviewStep();
      if (!state.restoringHistory && state.autoFollowMessages) {
        scrollMessagesToBottom();
      }
      return;
    }
  }
  const status = workflowEventStatus(event);
  const purposeStep = ensureWorkflowPurposeStep(toolName, event.tool_input || {});
  const row = appendWorkflowStep(
    workflowTitle(event),
    workflowDetail(event),
    status,
    toolName,
    { level: "child", groupId: purposeStep.dataset.workflowGroupId },
  );
  updateWorkflowPurposeStepStatus(row.dataset.workflowGroupId);
  updateWorkflowSummary();
  if (!isStart) {
    startWorkflowReviewStep();
  }
  if (!state.restoringHistory && state.autoFollowMessages) {
    scrollMessagesToBottom();
  }
}

function workflowToolBufferKey(event) {
  const index = Number.isFinite(event.tool_call_index) ? event.tool_call_index : 0;
  return `${event.tool_name || "tool"}:${index}`;
}

function clearWorkflowToolArgBuffers(toolName) {
  const prefix = `${toolName || "tool"}:`;
  for (const key of workflowToolArgBuffers.keys()) {
    if (key.startsWith(prefix)) {
      workflowToolArgBuffers.delete(key);
    }
  }
}

function appendWorkflowProgress(event) {
  ensureWorkflowPanel();
  stopWorkflowWaitingTimer();
  markPlanningStepDone();
  markWorkflowWaitingStepsDone("실제 작업 단계로 넘어갔습니다.");
  clearWorkflowActivityStep();
  const toolName = event.tool_name || "도구";
  const displayName = displayToolName(toolName);
  const message = String(event.message || "").trim() || `${displayName} 실행 중입니다.`;
  const matchingRunningStep = [...state.workflowList.querySelectorAll(".workflow-step.running")]
    .find((item) => item.dataset.toolName === toolName);
  if (matchingRunningStep) {
    const detail = matchingRunningStep.querySelector("small");
    if (detail) {
      detail.textContent = message;
    }
    updateWorkflowPurposeStepStatus(matchingRunningStep.dataset.workflowGroupId);
  } else {
    const purposeStep = ensureWorkflowPurposeStep(toolName, event.tool_input || {});
    const row = appendWorkflowStep(
      `${displayName} 실행 중`,
      message,
      "running",
      toolName,
      { level: "child", groupId: purposeStep.dataset.workflowGroupId },
    );
    updateWorkflowPurposeStepStatus(row.dataset.workflowGroupId);
  }
  updateWorkflowSummary();
  if (!state.restoringHistory && state.autoFollowMessages) {
    scrollMessagesToBottom();
  }
}

function isMutationTool(toolName) {
  const lower = String(toolName || "").toLowerCase();
  if (lower === "todo_write" || lower === "todowrite") {
    return false;
  }
  return (
    lower.includes("bash")
    || lower.includes("cmd")
    || lower.includes("shell")
    || lower.includes("write")
    || lower.includes("edit")
    || lower.includes("delete")
    || lower.includes("notebook")
  );
}

function scheduleMutationWaitingStep(toolName) {
  if (!isMutationTool(toolName) || workflowMutationWaitingTimers.has(toolName)) {
    return;
  }
  const timer = window.setTimeout(() => {
    workflowMutationWaitingTimers.delete(toolName);
    if (!state.workflowNode || state.restoringHistory) {
      return;
    }
    const stillRunning = [...state.workflowList.querySelectorAll(".workflow-step.running")]
      .some((item) => item.dataset.toolName === toolName);
    if (stillRunning) {
      const runningItem = [...state.workflowList.querySelectorAll(".workflow-step.running")]
        .find((item) => item.dataset.toolName === toolName);
      const purposeStep = runningItem?.dataset.workflowGroupId
        ? null
        : ensureWorkflowPurposeStep(toolName);
      const groupId = runningItem?.dataset.workflowGroupId || purposeStep?.dataset.workflowGroupId || "";
      const lower = String(toolName || "").toLowerCase();
      const isCommand = lower.includes("bash") || lower.includes("cmd") || lower.includes("shell");
      const title = isCommand ? "명령 실행 중" : "파일 변경 진행 중";
      const detail = isCommand
        ? "출력이 없어도 작업은 계속 진행 중입니다."
        : "파일 변경이 끝날 때까지 기다리고 있습니다.";
      const row = appendWorkflowStep(title, detail, "running", "mutation_lock", { level: "child", groupId });
      updateWorkflowPurposeStepStatus(row.dataset.workflowGroupId);
    }
  }, 1400);
  workflowMutationWaitingTimers.set(toolName, timer);
}

function clearMutationWaitingStep(toolName) {
  const timer = workflowMutationWaitingTimers.get(toolName);
  if (timer) {
    window.clearTimeout(timer);
    workflowMutationWaitingTimers.delete(toolName);
  }
  [...state.workflowList.querySelectorAll('.workflow-step.running[data-tool-name="mutation_lock"]')]
    .forEach((item) => {
      const groupId = item.dataset.workflowGroupId;
      item.classList.remove("running");
      item.classList.add("done");
      const detail = item.querySelector("small");
      if (detail) {
        detail.textContent = "파일 변경을 계속 진행합니다.";
      }
      updateWorkflowPurposeStepStatus(groupId);
    });
}

function markPlanningStepDone() {
  const planning = state.workflowSteps.find((row) =>
    row.dataset.workflowRole === "planning"
    || ["작업 계획", "작업 계획 수립"].includes(row.querySelector("strong")?.textContent || "")
  );
  if (planning && planning.classList.contains("running")) {
    planning.classList.remove("running");
    planning.classList.add("done");
    planning.querySelector("small").textContent = "진행 방향을 정했습니다.";
  }
}

function markWorkflowWaitingStepsDone(message = "다음 단계로 넘어갔습니다.") {
  state.workflowSteps
    .filter((row) => row.dataset.workflowRole === "waiting" && row.classList.contains("running"))
    .forEach((row) => {
      row.classList.remove("running", "warning", "error");
      row.classList.add("done");
      const detail = row.querySelector("small");
      if (detail) {
        detail.textContent = message;
      }
    });
}

function runningWorkflowActivityStep() {
  return state.workflowSteps.find((row) =>
    row.dataset.workflowRole === "agent_activity" && row.classList.contains("running")
  );
}

function hasRunningToolStep() {
  return state.workflowSteps.some((row) =>
    row.dataset.toolName
    && row.dataset.toolName !== "mutation_lock"
    && row.classList.contains("running")
  );
}

function startWorkflowActivityStep(title, detail) {
  if (!state.workflowNode || !state.workflowList || state.restoringHistory) {
    return null;
  }
  markWorkflowWaitingStepsDone("상위 판단 단계로 넘어갔습니다.");
  const existing = runningWorkflowActivityStep();
  if (existing) {
    existing.querySelector("strong").textContent = title;
    const description = existing.querySelector("small");
    if (description) {
      description.textContent = detail;
    }
    updateWorkflowSummary();
    return existing;
  }
  const row = appendWorkflowStep(title, detail, "running", "", { role: "agent_activity" });
  if (!state.restoringHistory && state.autoFollowMessages) {
    scrollMessagesToBottom();
  }
  return row;
}

function startWorkflowReviewStep() {
  if (hasRunningToolStep()) {
    return;
  }
  startWorkflowActivityStep(
    "다음 판단 중",
    "도구 결과를 읽고 다음 작업이나 최종 답변을 결정하고 있습니다.",
  );
}

function clearWorkflowActivityStep() {
  const activitySteps = state.workflowSteps.filter((row) => row.dataset.workflowRole === "agent_activity");
  if (!activitySteps.length) {
    return;
  }
  activitySteps.forEach((row) => row.remove());
  state.workflowSteps = state.workflowSteps.filter((row) => row.dataset.workflowRole !== "agent_activity");
  updateWorkflowSummary();
}

function ensureWorkflowFinalAnswerStep() {
  const existing = state.workflowSteps.find((row) => row.dataset.workflowRole === "final_answer");
  if (existing) {
    return existing;
  }
  return appendWorkflowStep(
    "최종 답변",
    "작업 결과를 정리하는 중입니다.",
    "running",
    "",
    { role: "final_answer" },
  );
}

function startWorkflowFinalAnswer() {
  if (!state.workflowNode || !state.workflowList) {
    ensureWorkflowPanel();
  }
  markPlanningStepDone();
  markWorkflowWaitingStepsDone("응답 생성 단계로 넘어갔습니다.");
  clearWorkflowActivityStep();
  refreshWorkflowPurposeSteps();
  const finalAnswer = ensureWorkflowFinalAnswerStep();
  finalAnswer.classList.remove("done", "warning", "error");
  finalAnswer.classList.add("running");
  const detail = finalAnswer.querySelector("small");
  if (detail) {
    detail.textContent = "최종 답변 생성 중...";
  }
  updateWorkflowSummary();
}

function clearWorkflowFinalAnswerStep() {
  const finalAnswer = state.workflowSteps.find((row) => row.dataset.workflowRole === "final_answer");
  if (!finalAnswer) {
    return;
  }
  finalAnswer.remove();
  state.workflowSteps = state.workflowSteps.filter((row) => row !== finalAnswer);
  updateWorkflowSummary();
}

function markWorkflowFinalAnswerDone(status = "done", message = "") {
  if (!state.workflowNode || !state.workflowList) {
    return;
  }
  markPlanningStepDone();
  clearWorkflowActivityStep();
  refreshWorkflowPurposeSteps();
  const finalAnswer = ensureWorkflowFinalAnswerStep();
  finalAnswer.classList.remove("running", "done", "warning", "error");
  const nextStatus = status === "error" ? "error" : "done";
  finalAnswer.classList.add(nextStatus);
  const detail = finalAnswer.querySelector("small");
  if (detail) {
    detail.textContent = message || (nextStatus === "error"
      ? "최종 답변을 완료하지 못했습니다."
      : "최종 답변을 작성했습니다.");
  }
  updateWorkflowSummary();
}

function workflowTitle(event) {
  const name = displayToolName(event.tool_name || "도구");
  if (event.type === "tool_started") {
    return `${name} 실행 중`;
  }
  const warningInfo = workflowWarningInfo(event);
  if (warningInfo) {
    return `${name} ${warningInfo.title}`;
  }
  return event.is_error ? `${name} 실패` : `${name} 완료`;
}

function displayToolName(toolName) {
  const raw = String(toolName || "").trim();
  const lower = raw.toLowerCase();
  if (lower === "bash" || lower === "cmd" || lower.includes("shell")) {
    return "명령";
  }
  return raw || "도구";
}

function workflowDetail(event) {
  if (event.type === "tool_started") {
    return summarizeToolInput(event.tool_name, event.tool_input);
  }
  const warningInfo = workflowWarningInfo(event);
  if (warningInfo) {
    return warningInfo.detail;
  }
  const skillInfo = skillWorkflowDetail(event);
  if (skillInfo) {
    return skillInfo;
  }
  const output = String(event.output || "").trim();
  const friendlyError = friendlyToolErrorDetail(event);
  return friendlyError || (output ? truncateText(output.replace(/\s+/g, " "), 140) : "완료되었습니다.");
}

function skillWorkflowDetail(event) {
  const toolName = String(event.tool_name || "").toLowerCase();
  if (toolName !== "skill") {
    return "";
  }
  const requestedName = String(event.tool_input?.name || "").trim();
  const skill = state.skills.find((item) => item.name.toLowerCase() === requestedName.toLowerCase());
  if (skill) {
    return `${skill.name}: ${skill.description || "Skill"}`;
  }
  const output = String(event.output || "");
  const name = output.match(/^Skill:\s*(.+)$/m)?.[1]?.trim() || requestedName;
  const description = output.match(/^Description:\s*(.+)$/m)?.[1]?.trim();
  if (name && description) {
    return `${name}: ${description}`;
  }
  return name || "";
}

function workflowEventStatus(event) {
  if (event.type === "tool_started") {
    return "running";
  }
  if (!event.is_error) {
    return "done";
  }
  if (workflowWarningInfo(event)) {
    return "warning";
  }
  return "error";
}

function workflowWarningInfo(event) {
  if (!event.is_error) {
    return null;
  }
  const toolName = String(event.tool_name || "").toLowerCase();
  const output = String(event.output || "");
  const lower = output.toLowerCase();
  if (lower.includes("no search results found")) {
    return {
      title: "결과 없음",
      detail: "검색 결과가 없어 다른 검색어 또는 출처로 진행합니다.",
    };
  }
  if (toolName.includes("web_fetch") || lower.includes("web_fetch failed")) {
    return webFetchWarningInfo(output);
  }
  return null;
}

function webFetchWarningInfo(output) {
  const lower = String(output || "").toLowerCase();
  const statusMatch = lower.match(/\b(401|403|404|408|410|429|500|502|503|504)\b/);
  const status = statusMatch?.[1] || "";
  if (status === "401" || status === "403") {
    return {
      title: "접근 제한",
      detail: `${status} 응답입니다. 사이트가 자동 접근을 거부했거나 권한이 필요해 다른 출처로 진행합니다.`,
    };
  }
  if (status === "404" || status === "410") {
    return {
      title: "페이지 없음",
      detail: `${status} 응답입니다. 페이지가 없거나 이동되어 다른 출처로 진행합니다.`,
    };
  }
  if (status === "429") {
    return {
      title: "요청 제한",
      detail: "사이트의 요청 제한에 걸렸습니다. 잠시 뒤 다시 시도하거나 다른 출처로 진행합니다.",
    };
  }
  if (["500", "502", "503", "504"].includes(status)) {
    return {
      title: "서버 오류",
      detail: `${status} 응답입니다. 사이트 쪽 오류라 다른 출처로 진행합니다.`,
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      title: "시간 초과",
      detail: "사이트 응답이 늦어 가져오지 못했습니다. 다른 출처로 진행합니다.",
    };
  }
  if (lower.includes("connection") || lower.includes("dns") || lower.includes("name resolution")) {
    return {
      title: "연결 실패",
      detail: "사이트에 연결하지 못했습니다. 주소나 네트워크 상태를 확인하고 다른 출처로 진행합니다.",
    };
  }
  return {
    title: "가져오기 제한",
    detail: "웹 페이지를 가져오지 못했습니다. 원문 사이트 제한일 수 있어 다른 출처로 진행합니다.",
  };
}

function friendlyToolErrorDetail(event) {
  if (!event.is_error) {
    return "";
  }
  const output = String(event.output || "");
  const lower = output.toLowerCase();
  if (lower.includes("client error") || lower.includes("server error") || lower.includes("http")) {
    const statusMatch = output.match(/\b([1-5]\d{2})\b/);
    return statusMatch
      ? `${statusMatch[1]} HTTP 오류가 발생했습니다. 원문 메시지는 세부 로그에 남아 있습니다.`
      : "HTTP 오류가 발생했습니다. 원문 메시지는 세부 로그에 남아 있습니다.";
  }
  return "";
}

function summarizeToolInput(toolName, input = {}) {
  const lower = String(toolName || "").toLowerCase();
  const requestedSkillName = String(input?.name || "").trim();
  if (lower === "skill" && requestedSkillName) {
    return requestedSkillName;
  }
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
  if (lower.includes("bash") || lower.includes("cmd") || lower.includes("shell")) return valueFor("command") || "명령 실행 중";
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
  const childCount = state.workflowSteps.filter((row) => row.dataset.workflowLevel === "child").length;
  const parentCount = Math.max(0, total - childCount);
  const elapsedMs = state.workflowRestoredElapsedMs || (state.workflowStartedAt ? performance.now() - state.workflowStartedAt : 0);
  const elapsed = elapsedMs ? `(${formatDuration(elapsedMs)})` : "";
  const countText = childCount
    ? `${parentCount} 단계 · 하위 작업 ${childCount}개`
    : `${parentCount} 단계`;
  state.workflowSummary.textContent = elapsed ? `${elapsed} ${countText}` : countText;
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
  title.textContent = displayToolName(event.tool_name || "도구");
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
    createSkillCatalog,
    refreshSkillCatalogs,
    createAttachmentPreview,
    appendMessage,
    renderTodoChecklist,
    archiveTodoChecklist,
    resetTodoChecklist,
    attachAssistantActions,
    resetWorkflowPanel,
    collapseWorkflowPanel,
    finalizeWorkflowSummary,
    failWorkflowPanel,
    startWorkflowFinalAnswer,
    clearWorkflowFinalAnswerStep,
    markWorkflowFinalAnswerDone,
    startWorkflowTimer,
    stopWorkflowTimer,
    ensureWorkflowPanel,
    appendWorkflowEvent,
    appendWorkflowProgress,
    appendWorkflowInputDelta,
    markPlanningStepDone,
    truncateText,
    appendToolEvent,
    updateTasks,
  };
}
