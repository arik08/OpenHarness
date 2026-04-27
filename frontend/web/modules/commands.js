export function createCommands(ctx) {
  const { state, els, commandDescription } = ctx;
  function autoSizeInput(...args) { return ctx.autoSizeInput(...args); }
  function updateSendState(...args) { return ctx.updateSendState(...args); }
  function getJson(...args) { return ctx.getJson(...args); }

const hiddenProjectFilePrefixes = [
  "autopilot-dashboard/",
  "docs/autopilot/",
];

function isVisibleProjectFile(file) {
  const key = String(file?.path || file?.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return !hiddenProjectFilePrefixes.some((prefix) => key === prefix.slice(0, -1) || key.startsWith(prefix));
}

function getSlashQuery() {
  const value = els.input.value;
  const beforeCursor = value.slice(0, els.input.selectionStart || 0);
  const shellMatch = beforeCursor.match(/^![^\r\n]*$/);
  if (shellMatch) {
    return {
      trigger: "!",
      value: beforeCursor.slice(1),
      start: 0,
      end: beforeCursor.length,
    };
  }
  const tokenMatch = beforeCursor.match(/(?:^|\s)([\/@$][^\s]*)$/);
  if (tokenMatch) {
    const token = tokenMatch[1] || "";
    return {
      trigger: token[0],
      value: token.slice(1).toLowerCase(),
      start: beforeCursor.length - token.length,
      end: beforeCursor.length,
    };
  }
  return null;
}

function fileKindLabel(file) {
  const kind = String(file.kind || "file");
  if (kind === "html") return "HTML";
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "Text";
  return "File";
}

async function refreshProjectFiles(force = false) {
  if (!state.sessionId || !getJson) {
    return [];
  }
  if (!force && state.projectFilesLoadedForSession === state.sessionId) {
    return state.projectFiles;
  }
  const query = new URLSearchParams({ session: state.sessionId });
  const payload = await getJson(`/api/project-files?${query.toString()}`);
  state.projectFiles = Array.isArray(payload.files) ? payload.files.filter(isVisibleProjectFile) : [];
  state.projectFilesLoadedForSession = state.sessionId;
  return state.projectFiles;
}

function extensionItems() {
  const skillItems = state.skills.filter((skill) => skill.enabled !== false).map((skill) => ({
    name: `$${skill.name}`,
    description: skill.description || "Skill",
    source: skill.source || "skill",
    kind: "skill",
  }));
  const mcpItems = state.mcpServers.filter((server) => server.state !== "disabled").map((server) => {
    const counts = [
      server.toolCount ? `${server.toolCount} tools` : "",
      server.resourceCount ? `${server.resourceCount} resources` : "",
    ].filter(Boolean).join(", ");
    const status = [server.state || "configured", server.transport || "", counts].filter(Boolean).join(" / ");
    return {
      name: `$mcp:${server.name}`,
      description: server.description || status || "MCP server",
      source: "mcp",
      kind: "mcp",
    };
  });
  const pluginItems = state.plugins.filter((plugin) => plugin.enabled !== false).map((plugin) => {
    const counts = [
      plugin.skillCount ? `${plugin.skillCount} skills` : "",
      plugin.commandCount ? `${plugin.commandCount} commands` : "",
      plugin.mcpServerCount ? `${plugin.mcpServerCount} MCP` : "",
    ].filter(Boolean).join(", ");
    return {
      name: `$plugin:${plugin.name}`,
      description: plugin.description || counts || (plugin.enabled ? "Plugin" : "Plugin disabled"),
      source: "plugin",
      kind: "plugin",
    };
  });
  return [...skillItems, ...mcpItems, ...pluginItems];
}

function filteredSlashCommands() {
  const query = getSlashQuery();
  if (query === null) {
    return [];
  }
  if (query.trigger === "$") {
    return extensionItems()
      .filter((item) => {
        const haystack = `${item.name} ${item.description} ${item.source || ""} ${item.kind || ""}`.toLowerCase();
        return haystack.includes(query.value);
      })
      .sort((left, right) => {
        const sourceRank = (item) => {
          if (item.kind === "skill") return 0;
          if (item.kind === "mcp") return 1;
          if (item.kind === "plugin") return 2;
          const source = String(item.source || "").toLowerCase();
          if (source === "project" || source === "program") return 0;
          if (source === "user") return 1;
          return 2;
        };
        return sourceRank(left) - sourceRank(right) || left.name.localeCompare(right.name);
      })
      .slice(0, 12);
  }
  if (query.trigger === "@") {
    return state.projectFiles
      .filter(isVisibleProjectFile)
      .filter((file) => {
        const haystack = `${file.path || ""} ${file.name || ""}`.toLowerCase();
        return haystack.includes(query.value);
      })
      .map((file) => ({
        ...file,
        name: `@${String(file.path || file.name || "").replace(/\\/g, "/")}`,
        description: `${fileKindLabel(file)} · ${file.path || file.name || ""}`,
        kind: "file",
      }))
      .slice(0, 14);
  }
  if (query.trigger === "!") {
    return [{
      name: "!",
      description: "CLI에 명령어를 입력합니다.",
      kind: "cli",
    }];
  }
  return state.commands
    .filter((command) => command.name.slice(1).toLowerCase().includes(query.value))
    .map((command) => ({ ...command, kind: "command" }))
    .slice(0, 12);
}

function closeSlashMenu() {
  state.slashMenuOpen = false;
  state.slashMenuIndex = 0;
  state.slashMenuMode = "command";
  els.slashMenu.classList.add("hidden");
  els.slashMenu.classList.remove("cli-hint");
  els.slashMenu.textContent = "";
}

function formatForcedSkillName(name) {
  return /\s/.test(name) ? `"${name.replaceAll('"', '\\"')}"` : name;
}

function selectSlashCommand(item) {
  const query = getSlashQuery();
  if (item.kind === "file" && query?.trigger === "@") {
    const value = els.input.value;
    const before = value.slice(0, query.start);
    const after = value.slice(els.input.selectionStart || query.end);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const inserted = `${needsLeadingSpace ? " " : ""}${item.name} `;
    els.input.value = `${before}${inserted}${after.replace(/^\s*/, "")}`;
    const nextCursor = before.length + inserted.length;
    els.input.setSelectionRange(nextCursor, nextCursor);
    autoSizeInput();
    updateSendState();
    closeSlashMenu();
    els.input.focus();
    return;
  }
  const selected = ["skill", "mcp", "plugin"].includes(item.kind)
    ? { ...item, name: `$${formatForcedSkillName(item.name.slice(1))}` }
    : item;
  const value = els.input.value;
  const before = query ? value.slice(0, query.start) : "";
  const after = query ? value.slice(els.input.selectionStart || query.end) : "";
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const inserted = `${needsLeadingSpace ? " " : ""}${selected.name} `;
  els.input.value = query
    ? `${before}${inserted}${after.replace(/^\s*/, "")}`
    : inserted;
  const nextCursor = before.length + inserted.length;
  els.input.setSelectionRange(nextCursor, nextCursor);
  autoSizeInput();
  updateSendState();
  closeSlashMenu();
  els.input.focus();
}

function renderSlashMenu() {
  const commands = filteredSlashCommands();
  if (!commands.length) {
    closeSlashMenu();
    return;
  }
  state.slashMenuOpen = true;
  state.slashMenuIndex = Math.min(state.slashMenuIndex, commands.length - 1);
  els.slashMenu.textContent = "";
  els.slashMenu.classList.toggle("cli-hint", state.slashMenuMode === "cli");
  for (const [index, command] of commands.entries()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `slash-menu-item${index === state.slashMenuIndex ? " active" : ""}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === state.slashMenuIndex ? "true" : "false");
    const name = document.createElement("strong");
    name.textContent = command.name;
    const badge = document.createElement("small");
    badge.textContent = command.kind === "mcp" ? "MCP" : command.kind === "plugin" ? "Plugin" : command.kind === "skill" ? "Skill" : command.kind === "cli" ? "CLI" : "";
    const description = document.createElement("span");
    description.textContent =
      ["skill", "mcp", "plugin"].includes(command.kind)
        ? command.description
        : command.kind === "file"
          ? command.description
        : commandDescription(command.name, command.description);
    if (badge.textContent) {
      item.append(name, badge, description);
    } else {
      item.classList.add("no-badge");
      item.append(name, description);
    }
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (command.kind === "cli") {
        els.input.focus();
        return;
      }
      selectSlashCommand(command);
    });
    els.slashMenu.append(item);
  }
  els.slashMenu.classList.remove("hidden");
  els.slashMenu.querySelector(".slash-menu-item.active")?.scrollIntoView({ block: "nearest" });
}

function updateSlashMenu() {
  const query = getSlashQuery();
  if (query === null) {
    closeSlashMenu();
    return;
  }
  if (query.trigger === "!") {
    state.slashMenuMode = "cli";
    renderSlashMenu();
    return;
  }
  if (query.trigger === "@" && state.projectFilesLoadedForSession !== state.sessionId) {
    refreshProjectFiles()
      .then(() => {
        if (getSlashQuery()?.trigger === "@") {
          renderSlashMenu();
        }
      })
      .catch(() => {
        state.projectFiles = [];
        state.projectFilesLoadedForSession = state.sessionId || "";
        closeSlashMenu();
      });
  }
  const hasItems =
    query.trigger === "$"
      ? extensionItems().length > 0
      : query.trigger === "@"
        ? state.projectFiles.length > 0
        : state.commands.length > 0;
  if (!hasItems) {
    closeSlashMenu();
    return;
  }
  state.slashMenuMode = query.trigger === "$" ? "skill" : query.trigger === "@" ? "file" : "command";
  renderSlashMenu();
}

  return {
    getSlashQuery,
    filteredSlashCommands,
    closeSlashMenu,
    refreshProjectFiles,
    selectSlashCommand,
    renderSlashMenu,
    updateSlashMenu,
  };
}
