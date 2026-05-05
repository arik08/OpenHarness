import type { ReactNode } from "react";

function promptTokenKind(rawToken: string) {
  if (rawToken.startsWith("@")) return "file";
  const lower = rawToken.toLowerCase();
  if (lower.startsWith("$mcp:")) return "mcp";
  if (lower.startsWith("$plugin:")) return "plugin";
  return "skill";
}

function splitPromptToken(rawToken: string) {
  const token = String(rawToken || "");
  const match = token.match(/^(.+?)([.,;:)\]]+)$/);
  return match ? { token: match[1], trailing: match[2] } : { token, trailing: "" };
}

function titleCaseToken(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function promptTokenLabel(rawToken: string) {
  const token = rawToken.trim();
  if (token.startsWith("@")) {
    const name = token.slice(1).split(/[\\/]/).filter(Boolean).pop() || token.slice(1);
    return name || token;
  }
  const normalized = token.slice(1).replace(/^["']|["']$/g, "").trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith("mcp:") || lower.startsWith("plugin:")) {
    return titleCaseToken(normalized.slice(normalized.indexOf(":") + 1)) || normalized;
  }
  return normalized || token;
}

export function UserMessageText({ text }: { text: string }) {
  const value = String(text || "");
  const tokenPattern = /(^|\s)(\$"[^"]+"|\$'[^']+'|\$[^\s]+|@[A-Za-z0-9_][A-Za-z0-9_.\\/-]*)/gi;
  const parts: ReactNode[] = [];
  let cursor = 0;

  function pushText(part: string, keyPrefix: string) {
    const lines = part.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) {
        parts.push(<br key={`${keyPrefix}-br-${index}-${parts.length}`} />);
      }
      if (line) {
        parts.push(line);
      }
    });
  }

  for (const match of value.matchAll(tokenPattern)) {
    const leading = match[1] || "";
    const rawToken = match[2] || "";
    const tokenStart = (match.index || 0) + leading.length;
    pushText(value.slice(cursor, tokenStart), `text-${cursor}`);
    const { token, trailing } = splitPromptToken(rawToken);
    parts.push(
      <span className={`prompt-token ${promptTokenKind(token)}`} aria-label={token} key={`token-${tokenStart}-${rawToken}`}>
        {promptTokenLabel(token)}
      </span>,
    );
    if (trailing) {
      parts.push(trailing);
    }
    cursor = tokenStart + rawToken.length;
  }
  pushText(value.slice(cursor), `text-${cursor}`);

  return <p className="react-message-text prompt-line">{parts.length ? parts : value}</p>;
}
