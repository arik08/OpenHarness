export function createMessages(ctx) {
  const { state, els, STATUS_LABELS, commandDescription } = ctx;
  let workflowEventQueue = [];
  let workflowEventQueueTimer = 0;
  let workflowWaitingTimer = 0;
  let workflowWaitingIndex = 0;
  let workflowIntent = "default";
  let workflowPreviewList = null;
  const workflowPreviews = new Map();
  const workflowToolArgBuffers = new Map();
  const workflowMutationWaitingTimers = new Map();
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
  function sendBackendRequest(...args) { return ctx.sendBackendRequest?.(...args); }
  function copyTextToClipboard(...args) { return ctx.copyTextToClipboard(...args); }
  function showImagePreview(...args) { return ctx.showImagePreview?.(...args); }

function countTextCharacters(text) {
  return Array.from(String(text || "")).length;
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
  parts.label.textContent = path ? `작성 중인 결과물 - ${path}` : "작성 중인 결과물";
}

function updateWorkflowPreviewLineCount(preview, text = preview?.body?.textContent || "") {
  const parts = ensureWorkflowPreviewTitleParts(preview?.node);
  if (!parts) {
    return;
  }
  const characters = countTextCharacters(text);
  parts.count.textContent = characters > 0 ? `${characters.toLocaleString()}글자 작성 중` : "0글자";
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

function workflowPreviewKey(toolName, input = {}, fallbackKey = "") {
  const path = String(input?.file_path || input?.path || "").trim();
  if (path) {
    return `path:${path}`;
  }
  return fallbackKey || `tool:${String(toolName || "tool").toLowerCase()}`;
}

function createWorkflowPreviewNode(path = "") {
  const node = document.createElement("div");
  node.className = "workflow-output-preview";
  const title = document.createElement("div");
  title.className = "workflow-output-title";
  const label = document.createElement("span");
  label.className = "workflow-output-label";
  label.textContent = path ? `작성 중인 결과물 - ${path}` : "작성 중인 결과물";
  const count = document.createElement("span");
  count.className = "workflow-output-line-count";
  count.textContent = "생성 대기 중";
  title.append(label, count);
  const body = document.createElement("pre");
  body.className = "workflow-output-body";
  node.append(title, body);
  return { node, body };
}

function outputExtension(path = "") {
  const match = String(path || "").toLowerCase().match(/(\.[a-z0-9]{1,8})(?:$|[?#])/);
  return match?.[1] || "";
}

function ensureWorkflowPreview(key, path = "") {
  ensureWorkflowPanel();
  if (!workflowPreviewList) {
    return null;
  }
  const cleanKey = String(key || path || `preview:${workflowPreviews.size + 1}`);
  let preview = workflowPreviews.get(cleanKey);
  if (!preview && path) {
    const expectedKey = `expected:${outputExtension(path)}`;
    const expected = workflowPreviews.get(expectedKey);
    if (expected) {
      workflowPreviews.delete(expectedKey);
      expected.key = cleanKey;
      workflowPreviews.set(cleanKey, expected);
      preview = expected;
    }
  }
  if (!preview) {
    const elements = createWorkflowPreviewNode(path);
    preview = {
      key: cleanKey,
      node: elements.node,
      body: elements.body,
      timer: 0,
      text: "",
      offset: 0,
      path,
    };
    workflowPreviews.set(cleanKey, preview);
    workflowPreviewList.append(elements.node);
  } else if (path) {
    updateWorkflowPreviewTitle(preview, path);
  }
  return preview;
}

function expectedWorkflowOutputs(promptText = "") {
  const text = String(promptText || "").toLowerCase();
  const outputs = [];
  const add = (ext, label) => {
    if (!outputs.some((item) => item.ext === ext)) {
      outputs.push({ ext, label });
    }
  };
  if (/\bmd\b|markdown|마크다운/.test(text)) add(".md", "Markdown 산출물");
  if (/\bhtml?\b|웹\s*보고서|html\s*보고서/.test(text)) add(".html", "HTML 산출물");
  if (/\bpptx?\b|powerpoint|파워포인트|슬라이드/.test(text)) add(".pptx", "PPTX 산출물");
  if (/\bxlsx?\b|excel|엑셀/.test(text)) add(".xlsx", "Excel 산출물");
  if (/\bcsv\b/.test(text)) add(".csv", "CSV 산출물");
  if (/\bpdf\b/.test(text)) add(".pdf", "PDF 산출물");
  return outputs;
}

function seedWorkflowExpectedPreviews(promptText = "") {
  for (const output of expectedWorkflowOutputs(promptText)) {
    ensureWorkflowPreview(`expected:${output.ext}`, output.label);
  }
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
  return `${clean || "answer"}.md`;
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

function resetWorkflowPanel() {
  workflowEventQueue = [];
  window.clearTimeout(workflowEventQueueTimer);
  window.clearTimeout(workflowWaitingTimer);
  for (const preview of workflowPreviews.values()) {
    window.clearTimeout(preview.timer);
  }
  workflowEventQueueTimer = 0;
  workflowWaitingTimer = 0;
  workflowWaitingIndex = 0;
  workflowIntent = "default";
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
  if (state.restoringHistory || state.batchingHistoryRestore) {
    state.workflowNode.open = false;
    return;
  }
  animateWorkflowDetails(state.workflowNode, false);
}

function finalizeWorkflowSummary() {
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
  markWorkflowExecutionStepDone();
  markWorkflowFinalAnswerDone("done", "응답을 마무리했습니다.");
  updateWorkflowSummary();
  flushWorkflowOutputPreview();
  stopWorkflowTimer();
}

function failWorkflowPanel(message = "") {
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
  markWorkflowExecutionStepDone("error", message || "작업이 실패했습니다.");
  markWorkflowFinalAnswerDone("error", message || "응답을 마무리하지 못했습니다.");
  state.workflowList?.querySelectorAll(".workflow-step.running").forEach((row) => {
    row.classList.remove("running");
    row.classList.add("error");
    const detail = row.querySelector("small");
    if (detail) {
      detail.textContent = message || "작업이 실패했습니다.";
    }
  });
  updateWorkflowSummary();
  collapseWorkflowPanel();
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
  workflowPreviewList = previewList;
  state.workflowSteps = [];
  state.workflowStartedAt = performance.now();
  startWorkflowTimer();
  seedWorkflowExpectedPreviews(promptText);
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
    if (!preview.text) {
      continue;
    }
    window.clearTimeout(preview.timer);
    preview.timer = 0;
    preview.body.textContent = preview.text;
    preview.offset = preview.text.length;
    updateWorkflowPreviewLineCount(preview, preview.text);
    scrollWorkflowPreviewToBottom(preview);
  }
}

function revealWorkflowOutputPreview(preview) {
  if (!preview?.body || !preview.text) {
    return;
  }
  preview.timer = 0;
  preview.offset = Math.min(
    preview.text.length,
    preview.offset + WORKFLOW_PREVIEW_CHARS_PER_TICK,
  );
  preview.body.textContent = preview.text.slice(0, preview.offset);
  updateWorkflowPreviewLineCount(preview, preview.body.textContent);
  scrollWorkflowPreviewToBottom(preview);
  if (!state.restoringHistory && state.autoFollowMessages) {
    scrollMessagesToBottom({ smooth: true, duration: 900 });
  }
  if (preview.offset < preview.text.length) {
    preview.timer = window.setTimeout(() => revealWorkflowOutputPreview(preview), WORKFLOW_PREVIEW_TICK_MS);
  }
}

function startWorkflowOutputPreview(toolName, input = {}) {
  const lower = String(toolName || "").toLowerCase();
  const content = String(input?.content || input?.new_string || "");
  if (!content || !(lower.includes("write") || lower.includes("edit"))) {
    return;
  }
  ensureWorkflowPanel();
  const path = String(input?.file_path || input?.path || "").trim();
  const preview = ensureWorkflowPreview(workflowPreviewKey(toolName, input), path);
  if (!preview) {
    return;
  }
  updateWorkflowPreviewTitle(preview, path);
  if (preview.text && content.startsWith(preview.text.replace(/\n\n\.\.\.$/, ""))) {
    window.clearTimeout(preview.timer);
    preview.timer = 0;
    preview.text = content.length > 12000 ? `${content.slice(0, 12000)}\n\n...` : content;
    preview.offset = preview.text.length;
    preview.body.textContent = preview.text;
    updateWorkflowPreviewLineCount(preview, content);
    scrollWorkflowPreviewToBottom(preview);
    return;
  }
  window.clearTimeout(preview.timer);
  preview.timer = 0;
  preview.text = content.length > 12000 ? `${content.slice(0, 12000)}\n\n...` : content;
  if (state.restoringHistory) {
    preview.offset = preview.text.length;
    preview.body.textContent = preview.text;
    updateWorkflowPreviewLineCount(preview, content);
    scrollWorkflowPreviewToBottom(preview);
    return;
  }
  preview.offset = 0;
  preview.body.textContent = "";
  updateWorkflowPreviewLineCount(preview, "");
  scrollWorkflowPreviewToBottom(preview);
  revealWorkflowOutputPreview(preview);
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
  const key = workflowToolBufferKey(event);
  let current = workflowToolArgBuffers.get(key) || "";
  if (current && /^\s*\{/.test(delta) && /\}\s*$/.test(current)) {
    current = "";
  }
  const next = current + delta;
  workflowToolArgBuffers.set(key, next);
  const content = extractPartialJsonStringValue(next, "content") || extractPartialJsonStringValue(next, "new_string");
  if (!content) {
    return;
  }
  const path = extractPartialJsonStringValue(next, "file_path") || extractPartialJsonStringValue(next, "path");
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
  updateWorkflowPreviewTitle(preview, path);
  window.clearTimeout(preview.timer);
  preview.timer = 0;
  preview.text = content.length > 12000 ? `${content.slice(0, 12000)}\n\n...` : content;
  preview.offset = preview.text.length;
  preview.body.textContent = preview.text;
  updateWorkflowPreviewLineCount(preview, content);
  scrollWorkflowPreviewToBottom(preview);
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
  ensureWorkflowExecutionStep();
  const isStart = event.type === "tool_started";
  const toolName = event.tool_name || "도구";
  if (isStart) {
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
      updateWorkflowSummary();
      if (!state.restoringHistory && state.autoFollowMessages) {
        scrollMessagesToBottom();
      }
      return;
    }
  }
  const status = workflowEventStatus(event);
  const row = appendWorkflowStep(workflowTitle(event), workflowDetail(event), status, toolName);
  updateWorkflowSummary();
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
  ensureWorkflowExecutionStep();
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
  } else {
    appendWorkflowStep(`${displayName} 실행 중`, message, "running", toolName);
  }
  updateWorkflowSummary();
  if (!state.restoringHistory && state.autoFollowMessages) {
    scrollMessagesToBottom();
  }
}

function isMutationTool(toolName) {
  const lower = String(toolName || "").toLowerCase();
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
      ensureWorkflowExecutionStep();
      const lower = String(toolName || "").toLowerCase();
      const isCommand = lower.includes("bash") || lower.includes("cmd") || lower.includes("shell");
      const title = isCommand ? "명령 실행 중" : "파일 변경 진행 중";
      const detail = isCommand
        ? "출력이 없어도 작업은 계속 진행 중입니다."
        : "파일 변경이 끝날 때까지 기다리고 있습니다.";
      appendWorkflowStep(title, detail, "running", "mutation_lock");
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
      item.classList.remove("running");
      item.classList.add("done");
      const detail = item.querySelector("small");
      if (detail) {
        detail.textContent = "파일 변경을 계속 진행합니다.";
      }
    });
}

function markPlanningStepDone() {
  const planning = state.workflowSteps.find((row) => row.querySelector("strong")?.textContent === "작업 계획");
  if (planning && planning.classList.contains("running")) {
    planning.classList.remove("running");
    planning.classList.add("done");
    planning.querySelector("small").textContent = "실행할 단계를 정했습니다.";
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

function ensureWorkflowExecutionStep() {
  const existing = state.workflowSteps.find((row) => row.dataset.workflowRole === "execution");
  if (existing) {
    return existing;
  }
  return appendWorkflowStep(
    "도구 실행",
    "도구 실행 결과를 순서대로 기록합니다.",
    "running",
    "",
    { role: "execution", level: "child" },
  );
}

function markWorkflowExecutionStepDone(status = "done", message = "") {
  const execution = state.workflowSteps.find((row) => row.dataset.workflowRole === "execution");
  if (!execution) {
    return;
  }
  execution.classList.remove("running", "done", "warning", "error");
  const hasToolIssue = state.workflowSteps.some((row) =>
    row.dataset.workflowLevel === "child"
    && (row.classList.contains("error") || row.classList.contains("warning"))
  );
  const nextStatus = status === "error" ? "error" : hasToolIssue ? "warning" : "done";
  execution.classList.add(nextStatus);
  const detail = execution.querySelector("small");
  if (detail) {
    detail.textContent = message || (nextStatus === "error"
      ? "도구 실행 중 문제가 발생했습니다."
      : nextStatus === "warning"
        ? "일부 도구는 결과가 없거나 사용할 수 없어 다른 경로로 진행했습니다."
      : "도구 실행이 완료되었습니다.");
  }
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
  markWorkflowExecutionStepDone("done");
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
  markWorkflowExecutionStepDone(status === "error" ? "error" : "done");
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
  const output = String(event.output || "").trim();
  const friendlyError = friendlyToolErrorDetail(event);
  return friendlyError || (output ? truncateText(output.replace(/\s+/g, " "), 140) : "완료되었습니다.");
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
