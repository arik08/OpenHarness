import { useMemo, useState } from "react";
import { sendBackendRequest, sendMessage } from "../api/messages";
import { useAppState } from "../state/app-state";
import type { SkillItem } from "../types/backend";
import { MarkdownMessage } from "./MarkdownMessage";

type CommandEntry = {
  name: string;
  description: string;
};

type ToggleEntry = {
  name: string;
  enabled: boolean;
  description: string;
  source: string;
};

export function isCommandCatalog(text: string) {
  const source = String(text || "");
  return source.includes("Available commands:") || source.includes("사용 가능한 명령어:");
}

function splitCommandCatalog(text: string) {
  const source = String(text || "");
  const marker = source.includes("사용 가능한 명령어:")
    ? "사용 가능한 명령어:"
    : "Available commands:";
  const skillMarker = source.includes("사용 가능한 스킬:")
    ? "사용 가능한 스킬:"
    : "Available skills:";
  const index = source.indexOf(marker);
  if (index < 0) {
    return { intro: "", catalog: source, skills: "" };
  }
  const skillIndex = source.indexOf(skillMarker, index + marker.length);
  return {
    intro: source.slice(0, index).trim(),
    catalog: source.slice(index, skillIndex < 0 ? undefined : skillIndex).trim(),
    skills: skillIndex < 0 ? "" : source.slice(skillIndex).trim(),
  };
}

function parseCommandCatalog(text: string): CommandEntry[] {
  const { catalog } = splitCommandCatalog(text);
  const source = String(catalog || "").replace(/^(Available commands:|사용 가능한 명령어:)\s*/i, "").trim();
  const matches = [...source.matchAll(/\/[a-z][a-z0-9-]*/g)];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = next?.index ?? source.length;
    return {
      name: match[0],
      description: source.slice(start, end).trim(),
    };
  });
}

function splitNamedCatalog(text: string, marker: string) {
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

function hasNamedCatalog(text: string, ...markers: string[]) {
  return markers.some((marker) => Boolean(splitNamedCatalog(text, marker)));
}

function parseSkillCatalog(text: string): ToggleEntry[] {
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
      if (!match) return null;
      return {
        name: match[1].trim(),
        source: (match[2] || "skill").trim(),
        enabled: ["enabled", "활성"].includes(match[3].toLowerCase()),
        description: (match[4] || "").trim(),
      };
    })
    .filter((item): item is ToggleEntry => Boolean(item));
}

function parseMcpCatalog(text: string): ToggleEntry[] {
  const marker = String(text || "").includes("MCP 서버:") ? "MCP 서버:" : "MCP servers:";
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
      if (!match) return null;
      return {
        name: match[1].trim(),
        enabled: ["enabled", "활성"].includes(match[2].toLowerCase()),
        description: match[3].trim() || "MCP server",
        source: "mcp",
      };
    })
    .filter((item): item is ToggleEntry => Boolean(item));
}

function parsePluginCatalog(text: string): ToggleEntry[] {
  const marker = String(text || "").includes("플러그인:") ? "플러그인:" : "Plugins:";
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
      if (!match) return null;
      return {
        name: match[1].trim(),
        enabled: ["enabled", "활성"].includes(match[2].toLowerCase()),
        description: (match[3] || "Plugin").trim(),
        source: "plugin",
      };
    })
    .filter((item): item is ToggleEntry => Boolean(item));
}

function formatHelpIntro(text: string) {
  return String(text || "")
    .replace(/^입력 단축키:\s*$/gm, "**입력 단축키**")
    .replace(/^자주 쓰는 기능:\s*$/gm, "**자주 쓰는 기능**");
}

function optimisticSkillSnapshot(skills: SkillItem[], items: ToggleEntry[], name: string, enabled: boolean): SkillItem[] {
  const source = skills.length
    ? skills
    : items.map((item) => ({
      name: item.name,
      description: item.description,
      source: item.source,
      enabled: item.enabled,
    }));
  return source.map((skill) => (
    skill.name.toLowerCase() === name.toLowerCase()
      ? { ...skill, enabled }
      : skill
  ));
}

function pluginNameFromSkillSource(source: string) {
  const match = String(source || "").trim().match(/^plugin:(.+)$/i);
  return match?.[1]?.trim().toLowerCase() || "";
}

function mergeSkillState(
  items: ToggleEntry[],
  skills: SkillItem[],
  pluginEnabledByName: Map<string, boolean>,
) {
  const byName = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill]));
  return items.map((item) => {
    const snapshot = byName.get(item.name.toLowerCase());
    const source = snapshot?.source || item.source;
    const pluginName = pluginNameFromSkillSource(source);
    const pluginEnabled = pluginName ? pluginEnabledByName.get(pluginName) : undefined;
    if (!snapshot) {
      return pluginEnabled === false ? { ...item, enabled: false } : item;
    }
    return {
      ...item,
      enabled: pluginEnabled === false ? false : snapshot.enabled !== false,
      description: snapshot.description || item.description,
      source,
    };
  });
}

function catalogTooltip(item: ToggleEntry, fallback: string) {
  return [
    item.name,
    item.description || item.source || fallback,
  ].filter(Boolean).join("\n");
}

export function CommandHelpMessage({ text }: { text: string }) {
  const { state, dispatch } = useAppState();
  const [toggleOverrides, setToggleOverrides] = useState<Record<string, boolean>>({});
  const parsed = useMemo(() => {
    const commands = parseCommandCatalog(text);
    return {
      intro: splitCommandCatalog(text).intro,
      commands,
      skills: parseSkillCatalog(text),
      mcps: parseMcpCatalog(text),
      plugins: parsePluginCatalog(text),
      hasSkills: hasNamedCatalog(text, "Available skills:", "사용 가능한 스킬:"),
      hasMcps: hasNamedCatalog(text, "MCP servers:", "MCP 서버:"),
      hasPlugins: hasNamedCatalog(text, "Plugins:", "플러그인:"),
    };
  }, [text]);
  const pluginItems = useMemo(
    () => parsed.plugins.map((item) => ({
      ...item,
      enabled: toggleOverrides[`plugin:${item.name.toLowerCase()}`] ?? item.enabled,
    })),
    [parsed.plugins, toggleOverrides],
  );
  const pluginEnabledByName = useMemo(
    () => new Map(pluginItems.map((item) => [item.name.toLowerCase(), item.enabled])),
    [pluginItems],
  );
  const skillItems = useMemo(
    () => mergeSkillState(parsed.skills, state.skills, pluginEnabledByName).map((item) => ({
      ...item,
      enabled: toggleOverrides[`skill:${item.name.toLowerCase()}`] ?? item.enabled,
    })),
    [parsed.skills, pluginEnabledByName, state.skills, toggleOverrides],
  );

  const describeCommand = (name: string, fallback: string) =>
    state.commands.find((command) => command.name === name)?.description || fallback || "명령어를 실행합니다";

  const runCommand = async (command: string) => {
    if (!state.sessionId) return;
    dispatch({ type: "set_busy", value: true });
    try {
      await sendMessage({ sessionId: state.sessionId, clientId: state.clientId, line: command, attachments: [] });
    } catch (error) {
      dispatch({ type: "set_busy", value: false });
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  const toggleItem = async (requestType: string, name: string, enabled: boolean) => {
    if (!state.sessionId) return;
    const overrideKey = requestType === "set_plugin_enabled"
      ? `plugin:${name.toLowerCase()}`
      : requestType === "set_skill_enabled"
        ? `skill:${name.toLowerCase()}`
        : "";
    if (overrideKey) {
      setToggleOverrides((current) => ({ ...current, [overrideKey]: !enabled }));
    }
    try {
      await sendBackendRequest(state.sessionId, state.clientId, { type: requestType, value: name, enabled: !enabled });
      if (requestType === "set_skill_enabled") {
        dispatch({
          type: "backend_event",
          event: {
            type: "skills_snapshot",
            skills: optimisticSkillSnapshot(state.skills, skillItems, name, !enabled),
          },
        });
      }
    } catch (error) {
      if (overrideKey) {
        setToggleOverrides((current) => ({ ...current, [overrideKey]: enabled }));
      }
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  return (
    <div className="command-help-stack">
      {parsed.intro ? (
        <div className="command-help-intro">
          <MarkdownMessage text={formatHelpIntro(parsed.intro)} />
        </div>
      ) : null}
      {parsed.hasSkills ? (
        <ToggleCatalog
          label="Skills"
          items={skillItems}
          emptyText="No custom skills available"
          onToggle={(item) => void toggleItem("set_skill_enabled", item.name, item.enabled)}
        />
      ) : null}
      {parsed.hasMcps ? (
        <ToggleCatalog
          label="MCP"
          items={parsed.mcps}
          emptyText="No MCP servers configured"
          onToggle={(item) => void toggleItem("set_mcp_enabled", item.name, item.enabled)}
        />
      ) : null}
      {parsed.hasPlugins ? (
        <ToggleCatalog
          label="Plugins"
          items={pluginItems}
          emptyText="No plugins discovered"
          onToggle={(item) => void toggleItem("set_plugin_enabled", item.name, item.enabled)}
        />
      ) : null}
      <details className="command-card" open>
        <summary>
          <span>사용 가능한 명령어</span>
          <span className="command-count">{parsed.commands.length ? `${parsed.commands.length}개` : "열기"}</span>
        </summary>
        <div className="command-grid">
          {parsed.commands.length ? parsed.commands.map((command) => (
            <button className="command-pill" type="button" key={command.name} onClick={() => void runCommand(command.name)}>
              <strong>{command.name}</strong>
              <span>{describeCommand(command.name, command.description)}</span>
            </button>
          )) : (
            <MarkdownMessage text={text} />
          )}
        </div>
      </details>
    </div>
  );
}

function ToggleCatalog({
  label,
  items,
  emptyText,
  onToggle,
}: {
  label: string;
  items: ToggleEntry[];
  emptyText: string;
  onToggle: (item: ToggleEntry) => void;
}) {
  return (
    <details className="command-card skill-card" open>
      <summary>
        <span>{label}</span>
        <span className="command-count">{items.length ? `${items.length}개` : "0개"}</span>
      </summary>
      <div className="command-grid skill-grid">
        {items.length ? items.map((item) => (
          <button
            className={`command-pill skill-toggle-pill${item.enabled ? "" : " disabled"}`}
            type="button"
            aria-pressed={item.enabled}
            data-tooltip={catalogTooltip(item, label)}
            key={`${label}:${item.name}`}
            onClick={() => onToggle(item)}
          >
            <span className="skill-pill-header">
              <strong>{item.name}</strong>
              <small>{item.enabled ? "Active" : "Inactive"}</small>
            </span>
            <span className="skill-pill-description">{item.description || item.source || label}</span>
          </button>
        )) : (
          <span className="skill-pill-description">{emptyText}</span>
        )}
      </div>
    </details>
  );
}
