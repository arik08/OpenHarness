import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readArtifact, resolveArtifact, saveArtifact } from "../api/artifacts";
import { useAppState } from "../state/app-state";
import type { ArtifactSummary } from "../types/backend";
import type { AppSettings, AppState, ChatMessage, WorkflowEvent } from "../types/ui";
import { CommandHelpMessage, isCommandCatalog } from "./CommandHelpMessage";
import { MarkdownMessage } from "./MarkdownMessage";
import { WebInvestigationSources, webInvestigationSummary, WorkflowPanel } from "./WorkflowPanel";

const artifactPathExtensionPattern = "html?|md|markdown|txt|json|csv|xml|ya?ml|toml|ini|log|py|m?js|cjs|tsx?|jsx|css|sql|sh|ps1|bat|cmd|png|gif|jpe?g|webp|svg|pdf|docx?|xlsx?|pptx?|zip";
const artifactExtensions = new Set([
  "html",
  "htm",
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "sql",
  "sh",
  "ps1",
  "bat",
  "cmd",
  "png",
  "gif",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
]);
const imageExtensions = new Set(["png", "gif", "jpg", "jpeg", "webp", "svg"]);
const textExtensions = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "sql",
  "sh",
  "ps1",
  "bat",
  "cmd",
]);
const documentExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip"]);

function normalizeArtifactPath(value: string) {
  return String(value || "")
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^["'`]+|["'`.,;:)]+$/g, "")
    .replace(/\\/g, "/");
}

function artifactName(path: string) {
  const normalized = normalizeArtifactPath(path);
  return normalized.split("/").filter(Boolean).pop() || normalized || "artifact";
}

function artifactExtension(path: string) {
  const name = artifactName(path);
  const match = name.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function artifactKind(path: string) {
  const ext = artifactExtension(path);
  if (ext === "html" || ext === "htm") return "html";
  if (imageExtensions.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (textExtensions.has(ext)) return "text";
  return "file";
}

function artifactLabel(kind: string) {
  if (kind === "html") return "HTML";
  if (kind === "image") return "이미지";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "텍스트";
  return "파일";
}

function artifactLabelForPath(path: string, kind = artifactKind(path)) {
  if (kind === "file") {
    const ext = artifactExtension(path);
    if (documentExtensions.has(ext)) {
      return ext.toUpperCase();
    }
  }
  return artifactLabel(kind);
}

function labelForArtifact(artifact: ArtifactSummary) {
  return artifact.label || artifactLabelForPath(artifact.path, artifact.kind);
}

function artifactIcon(kind: string) {
  if (kind === "html") return "</>";
  if (kind === "image") return "IMG";
  if (kind === "pdf") return "PDF";
  if (kind === "text" || kind === "markdown" || kind === "json") return "TXT";
  return "FILE";
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function collectArtifactCandidates(text: string) {
  const value = String(text || "");
  const candidates: string[] = [];
  const push = (candidate: string) => {
    const normalized = normalizeArtifactPath(candidate);
    const ext = artifactExtension(normalized);
    if (!normalized || !artifactExtensions.has(ext) || /^https?:\/\//i.test(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  for (const match of value.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    push(match[1]);
  }
  const backtickPattern = new RegExp(`\`([^\`\\n]+\\.(?:${artifactPathExtensionPattern}))\``, "gi");
  const pathPattern = new RegExp(`(?:^|[\\s(["'])((?:[A-Za-z]:)?[^\\s<>"'()]*\\.(?:${artifactPathExtensionPattern}))`, "gim");

  for (const match of value.matchAll(backtickPattern)) {
    push(match[1]);
  }
  for (const match of value.matchAll(pathPattern)) {
    push(match[1]);
  }

  const seen = new Set<string>();
  return candidates
    .filter((path) => {
      const key = path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((path) => {
      const kind = artifactKind(path);
      return {
        path,
        name: artifactName(path),
        kind,
        label: artifactLabelForPath(path, kind),
      } satisfies ArtifactSummary;
    });
}

function dedupeArtifactsByResolvedPath(artifacts: ArtifactSummary[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = normalizeArtifactPath(artifact.path).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function answerFileName(title: string, text: string) {
  const source = title.trim() && title.trim() !== "MyHarness"
    ? title.trim()
    : String(text || "").split(/\r?\n/).find((line) => line.trim()) || "answer";
  const clean = source
    .replace(/[#*_`~[\](){}<>]/g, "")
    .replace(/[\\/:*?"|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `outputs/${clean || "answer"}.md`;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-1000px";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) {
    throw new Error("Copy failed");
  }
}

function AssistantActions({ message }: { message: ChatMessage }) {
  const { state, dispatch } = useAppState();
  const [status, setStatus] = useState("");
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const text = message.text.trim();

  if (!message.isComplete || !text) {
    return null;
  }

  async function copyAnswer() {
    setCopying(true);
    try {
      await copyTextToClipboard(text);
      setStatus("복사했습니다.");
    } catch (error) {
      setStatus(`복사 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.setTimeout(() => {
        setCopying(false);
        setStatus("");
      }, 1400);
    }
  }

  async function saveAnswer() {
    if (!state.sessionId) {
      setStatus("저장할 세션이 없습니다.");
      return;
    }
    setSaving(true);
    setStatus("저장 중...");
    try {
      const payload = await saveArtifact(answerFileName(state.chatTitle, text), text, state.sessionId, state.clientId);
      dispatch({ type: "refresh_artifacts" });
      setStatus(payload.artifact?.path ? `${payload.artifact.path} 저장됨` : "저장했습니다.");
    } catch (error) {
      setStatus(`저장 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.setTimeout(() => {
        setSaving(false);
        setStatus((current) => current.includes("실패") ? current : "");
      }, 1800);
    }
  }

  return (
    <div className="assistant-actions">
      <span className="assistant-done">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span>답변 완료</span>
      </span>
      <button
        className="assistant-action-button"
        type="button"
        data-tooltip="원문 복사"
        aria-label="원문 복사"
        disabled={copying}
        onClick={() => void copyAnswer()}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button
        className="assistant-action-button"
        type="button"
        data-tooltip="본문 저장"
        aria-label="본문 저장"
        disabled={saving}
        onClick={() => void saveAnswer()}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8" />
          <path d="M7 3v5h8" />
        </svg>
      </button>
      <span className="assistant-action-status">{status}</span>
    </div>
  );
}

function AssistantArtifactCards({ message }: { message: ChatMessage }) {
  const { state, dispatch } = useAppState();
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [loadingPath, setLoadingPath] = useState("");

  useEffect(() => {
    let canceled = false;
    const candidates = collectArtifactCandidates(message.isComplete ? message.text : "");
    if (!candidates.length || (!state.sessionId && !state.workspacePath && !state.workspaceName)) {
      setArtifacts([]);
      return () => {
        canceled = true;
      };
    }

    async function resolveCandidates() {
      const resolved = await Promise.all(
        candidates.map(async (artifact) => {
          try {
            const payload = await resolveArtifact({
              sessionId: state.sessionId || undefined,
              clientId: state.clientId,
              workspacePath: state.workspacePath,
              workspaceName: state.workspaceName,
              path: artifact.path,
            });
            return {
              ...artifact,
              ...payload,
              path: payload.path || artifact.path,
              name: payload.name || artifact.name,
              kind: payload.kind || artifact.kind,
              label: payload.label || artifactLabelForPath(payload.path || artifact.path, payload.kind || artifact.kind),
            };
          } catch {
            return null;
          }
        }),
      );
      if (canceled) {
        return;
      }
      const nextArtifacts = dedupeArtifactsByResolvedPath(resolved.filter(Boolean) as ArtifactSummary[]);
      setArtifacts(nextArtifacts);
      if (nextArtifacts.length) {
        dispatch({ type: "set_artifacts", artifacts: nextArtifacts });
      }
    }

    void resolveCandidates();
    return () => {
      canceled = true;
    };
  }, [dispatch, message.isComplete, message.text, state.clientId, state.sessionId, state.workspaceName, state.workspacePath]);

  async function openArtifact(artifact: ArtifactSummary) {
    dispatch({ type: "open_artifact", artifact });
    setLoadingPath(artifact.path);
    try {
      const payload = await readArtifact({
        sessionId: state.sessionId || undefined,
        clientId: state.clientId,
        workspacePath: state.workspacePath,
        workspaceName: state.workspaceName,
        path: artifact.path,
      });
      dispatch({ type: "set_artifact_payload", payload });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setLoadingPath("");
    }
  }

  if (!message.isComplete || !artifacts.length) {
    return null;
  }

  return (
    <div className="artifact-cards" aria-label="답변 산출물">
      {artifacts.map((artifact) => (
        <button
          className="artifact-card"
          type="button"
          key={artifact.path}
          aria-label={`${artifact.name || artifact.path} 미리보기 열기`}
          data-artifact-path={artifact.path}
          onClick={() => void openArtifact(artifact)}
        >
          <span className="artifact-card-icon" aria-hidden="true">{artifactIcon(artifact.kind)}</span>
          <span className="artifact-card-copy">
            <strong>{artifact.name || artifact.path}</strong>
            <small>{loadingPath === artifact.path ? "불러오는 중" : [labelForArtifact(artifact), formatBytes(artifact.size)].filter(Boolean).join(" · ")}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

const nearBottomPx = 96;
const streamingRejoinBottomPx = 260;
const scrollStorageKey = "myharness:scrollPositions";

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function readScrollPositions() {
  try {
    return JSON.parse(sessionStorage.getItem(scrollStorageKey) || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveScrollPosition(sessionId: string | null | undefined, scrollTop: number) {
  if (!sessionId) {
    return;
  }
  const positions = readScrollPositions();
  positions[sessionId] = scrollTop;
  try {
    sessionStorage.setItem(scrollStorageKey, JSON.stringify(positions));
  } catch {
    // Embedded or private browsing contexts can block sessionStorage.
  }
}

function restoredScrollPosition(sessionId: string | null | undefined) {
  if (!sessionId) {
    return null;
  }
  const value = readScrollPositions()[sessionId];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function useStreamingText(
  targetText: string,
  visuallyStreaming: boolean,
) {
  const [visibleText, setVisibleText] = useState(targetText);
  const revealFromRef = useRef<number | null>(null);
  const visibleTextRef = useRef(visibleText);

  useEffect(() => {
    visibleTextRef.current = visibleText;
  }, [visibleText]);

  useEffect(() => {
    if (!visuallyStreaming) {
      revealFromRef.current = null;
      visibleTextRef.current = targetText;
      setVisibleText(targetText);
      return;
    }

    const current = visibleTextRef.current;
    revealFromRef.current = targetText.startsWith(current) ? Array.from(current).length : 0;
    visibleTextRef.current = targetText;
    setVisibleText(targetText);
  }, [targetText, visuallyStreaming]);

  return { visibleText, revealFrom: revealFromRef.current, visualComplete: visibleText === targetText };
}

function StreamingAssistantMessage({
  message,
  settings,
  active,
  onVisibleTextChange,
}: {
  message: ChatMessage;
  settings: AppSettings;
  active: boolean;
  onVisibleTextChange?: () => void;
}) {
  const visuallyStreaming = active && !message.isComplete;
  const { visibleText, revealFrom, visualComplete } = useStreamingText(
    message.text,
    visuallyStreaming,
  );
  const style = useMemo(() => ({
    "--stream-reveal-duration": `${Math.max(0, Math.min(2000, settings.streamRevealDurationMs))}ms`,
    "--stream-reveal-wipe": `${Math.max(100, Math.min(400, settings.streamRevealWipePercent))}%`,
  }) as React.CSSProperties, [settings.streamRevealDurationMs, settings.streamRevealWipePercent]);

  useEffect(() => {
    if (visuallyStreaming && visibleText) {
      onVisibleTextChange?.();
    }
  }, [visuallyStreaming, onVisibleTextChange, visibleText]);

  return (
    <div className={visuallyStreaming && !visualComplete ? "react-streaming-text streaming-text" : undefined} style={style}>
      <MarkdownMessage text={visuallyStreaming ? visibleText : message.text} revealFrom={visuallyStreaming ? revealFrom : null} />
    </div>
  );
}

function TerminalCommandMessage({ message }: { message: ChatMessage }) {
  const terminal = message.terminal;
  if (!terminal) {
    return <p className="react-message-text">{message.text}</p>;
  }
  const output = terminal.output || "";
  const body = `> ${terminal.command}${output ? `\n${output}` : ""}`;
  return (
    <div className={`terminal-message${terminal.status === "running" ? " running" : ""}${terminal.status === "error" ? " error" : ""}`}>
      <pre>{body}</pre>
    </div>
  );
}

function promptTokenKind(rawToken: string) {
  if (rawToken.startsWith("@")) return "file";
  const lower = rawToken.toLowerCase();
  if (lower.startsWith("$mcp:")) return "mcp";
  if (lower.startsWith("$plugin:")) return "plugin";
  return "skill";
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

function UserMessageText({ text }: { text: string }) {
  const value = String(text || "");
  const tokenPattern = /(^|\s)(\$"[^"]+"|\$'[^']+'|\$[^\s]+|@[^\s]+)/gi;
  const parts: React.ReactNode[] = [];
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
    parts.push(
      <span className={`prompt-token ${promptTokenKind(rawToken)}`} aria-label={rawToken} key={`token-${tokenStart}-${rawToken}`}>
        {promptTokenLabel(rawToken)}
      </span>,
    );
    cursor = tokenStart + rawToken.length;
  }
  pushText(value.slice(cursor), `text-${cursor}`);

  return <p className="react-message-text prompt-line">{parts.length ? parts : value}</p>;
}

function messageKindBadge(kind: ChatMessage["kind"]) {
  if (kind === "steering") {
    return { className: "steering", label: "스티어링" };
  }
  if (kind === "queued") {
    return { className: "queued", label: "대기열" };
  }
  return null;
}

function workflowEventsForMessageId(state: AppState, messageId: string) {
  return messageId === state.workflowAnchorMessageId
    ? state.workflowEvents
    : state.workflowEventsByMessageId[messageId] || [];
}

function workflowDurationForMessageId(state: AppState, messageId: string) {
  return messageId === state.workflowAnchorMessageId
    ? state.workflowDurationSeconds
    : state.workflowDurationSecondsByMessageId[messageId] ?? null;
}

export function MessageList() {
  const { state, dispatch } = useAppState();
  const messagesRef = useRef<HTMLElement | null>(null);
  const autoFollowRef = useRef(true);
  const animationFrameRef = useRef(0);
  const tailFollowActiveRef = useRef(false);
  const autoScrollUntilRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  const scrollSaveTimerRef = useRef(0);
  const lastMessage = state.messages.at(-1);
  const isLastAssistantStreaming = state.busy && lastMessage?.role === "assistant" && !lastMessage.isComplete;
  const isActiveWorkflowGrowing = state.busy && Boolean(state.workflowAnchorMessageId && state.workflowEvents.length);
  const shouldFollowGrowingTail = isLastAssistantStreaming || isActiveWorkflowGrowing;
  const activeWorkflowFollowSignature = useMemo(
    () => state.workflowEvents.map((event) => [
      event.id,
      event.status,
      event.detail,
      event.output?.length ?? 0,
      typeof event.toolInput?.content === "string" ? event.toolInput.content.length : 0,
    ].join(":")).join("|"),
    [state.workflowEvents],
  );
  const scrollSessionId = state.activeHistoryId || state.sessionId;

  function webSourceEventsForAssistant(messageIndex: number): WorkflowEvent[] {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message.role !== "user") {
        continue;
      }
      const events = workflowEventsForMessageId(state, message.id);
      if (events.length) {
        return events;
      }
      break;
    }
    return [];
  }

  function stopAutoFollow(container = messagesRef.current) {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
    tailFollowActiveRef.current = false;
    autoFollowRef.current = false;
    autoScrollUntilRef.current = 0;
    container?.classList.remove("streaming-follow");
  }

  function saveCurrentScrollPosition() {
    if (!state.restoringHistory) {
      saveScrollPosition(scrollSessionId, messagesRef.current?.scrollTop ?? 0);
    }
  }

  function scheduleScrollPositionSave() {
    window.clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = window.setTimeout(saveCurrentScrollPosition, 120);
  }

  function scrollMessagesToBottom(options: { smooth?: boolean; duration?: number; continuous?: boolean } = {}) {
    const container = messagesRef.current;
    if (!container) {
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const smooth = options.smooth && !reduceMotion;
    const continuous = Boolean(options.continuous);
    const duration = Math.max(0, Number(options.duration ?? state.appSettings.streamScrollDurationMs));

    if (!smooth || duration <= 0) {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = 0;
      }
      tailFollowActiveRef.current = false;
      container.scrollTop = container.scrollHeight;
      container.dataset.lastScrollTop = String(container.scrollTop);
      return;
    }

    if (continuous && tailFollowActiveRef.current && animationFrameRef.current) {
      autoScrollUntilRef.current = Date.now() + duration + 260;
      return;
    }

    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    tailFollowActiveRef.current = continuous;
    const start = container.scrollTop;
    const startedAt = performance.now();
    let previousFrameAt = startedAt;
    let bufferedTarget = start;
    autoScrollUntilRef.current = Date.now() + duration + 260;

    const step = (now: number) => {
      if (!messagesRef.current) {
        animationFrameRef.current = 0;
        return;
      }
      const liveContainer = messagesRef.current;
      if (continuous) {
        const rawTarget = Math.max(0, liveContainer.scrollHeight - liveContainer.clientHeight);
        const elapsed = Math.min(64, Math.max(0, now - previousFrameAt));
        previousFrameAt = now;
        const targetMs = Math.max(320, Math.min(820, duration * 0.28));
        const targetBlend = elapsed > 0 ? 1 - Math.exp(-elapsed / targetMs) : 0;
        bufferedTarget += (Math.max(rawTarget, bufferedTarget, liveContainer.scrollTop) - bufferedTarget) * targetBlend;
        const followMs = Math.max(160, Math.min(380, duration * 0.14));
        const followBlend = elapsed > 0 ? 1 - Math.exp(-elapsed / followMs) : 0;
        const distance = bufferedTarget - liveContainer.scrollTop;
        liveContainer.scrollTop += distance * followBlend;
        liveContainer.dataset.lastScrollTop = String(liveContainer.scrollTop);
        if (autoFollowRef.current && tailFollowActiveRef.current) {
          animationFrameRef.current = window.requestAnimationFrame(step);
        } else {
          tailFollowActiveRef.current = false;
          animationFrameRef.current = 0;
        }
        return;
      }

      const target = Math.max(0, liveContainer.scrollHeight - liveContainer.clientHeight);
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeInOutCubic(progress);
      liveContainer.scrollTop = start + (target - start) * eased;
      if (progress < 1 && autoFollowRef.current) {
        animationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        tailFollowActiveRef.current = false;
        animationFrameRef.current = 0;
        liveContainer.dataset.lastScrollTop = String(liveContainer.scrollTop);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(step);
  }

  function resumeAutoFollow(container = messagesRef.current) {
    autoFollowRef.current = true;
    if (!container || !shouldFollowGrowingTail) {
      return;
    }
    container.classList.add("streaming-follow");
    scrollMessagesToBottom({ smooth: true, duration: state.appSettings.streamScrollDurationMs, continuous: true });
  }

  function updateAutoFollowFromScroll(container = messagesRef.current) {
    if (!container) {
      return;
    }
    const currentTop = container.scrollTop;
    const previousTop = Number(container.dataset.lastScrollTop);
    const movedUp = Number.isFinite(previousTop) && currentTop < previousTop - 2;
    const userScrolling = Date.now() <= userScrollIntentUntilRef.current;
    const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
    const threshold = shouldFollowGrowingTail ? Math.max(nearBottomPx, streamingRejoinBottomPx) : nearBottomPx;
    if (remaining <= threshold) {
      resumeAutoFollow(container);
    } else if (userScrolling || movedUp) {
      if (userScrolling || Date.now() >= autoScrollUntilRef.current) {
        stopAutoFollow(container);
      }
    } else if (Date.now() < autoScrollUntilRef.current) {
      autoFollowRef.current = true;
    } else {
      autoFollowRef.current = false;
    }
    container.dataset.lastScrollTop = String(currentTop);
  }

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !autoFollowRef.current || state.restoringHistory) {
      return;
    }
    container.style.setProperty("--stream-follow-lead", `${Math.max(0, Math.min(220, state.appSettings.streamFollowLeadPx))}px`);
    container.classList.toggle("streaming-follow", Boolean(shouldFollowGrowingTail));
    scrollMessagesToBottom({
      smooth: true,
      duration: state.appSettings.streamScrollDurationMs,
      continuous: Boolean(shouldFollowGrowingTail),
    });
  }, [state.messages.length, lastMessage?.text, lastMessage?.isComplete, activeWorkflowFollowSignature, state.appSettings.streamScrollDurationMs, state.appSettings.streamFollowLeadPx, shouldFollowGrowingTail, state.restoringHistory]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container || !state.restoringHistory || !state.activeHistoryId) {
      return;
    }
    stopAutoFollow(container);
    const savedPosition = restoredScrollPosition(state.activeHistoryId);
    container.scrollTop = savedPosition ?? 0;
    container.dataset.lastScrollTop = String(container.scrollTop);
    requestAnimationFrame(() => {
      dispatch({ type: "finish_history_restore" });
    });
  }, [dispatch, state.activeHistoryId, state.messages.length, state.restoringHistory]);

  useEffect(() => {
    function handleSaveMessageScroll() {
      saveCurrentScrollPosition();
    }
    window.addEventListener("myharness:saveMessageScroll", handleSaveMessageScroll);
    return () => window.removeEventListener("myharness:saveMessageScroll", handleSaveMessageScroll);
  });

  useEffect(() => () => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    window.clearTimeout(scrollSaveTimerRef.current);
  }, []);

  if (!state.messages.length) {
    return (
      <section className="messages" aria-live="polite" ref={messagesRef}>
        <div className="welcome">
          <span className="welcome-mark">MH</span>
          <h2>무엇을 도와드릴까요?</h2>
          <p>업무에 필요한 조사, 정리, 코드 작업을 도와드릴 준비가 되어 있습니다.</p>
        </div>
        <WorkflowPanel />
      </section>
    );
  }

  return (
    <section
      className={`messages${shouldFollowGrowingTail ? " streaming-follow" : ""}`}
      aria-live="polite"
      ref={messagesRef}
      onScroll={(event) => {
        updateAutoFollowFromScroll(event.currentTarget);
        scheduleScrollPositionSave();
      }}
      onWheel={(event) => {
        userScrollIntentUntilRef.current = Date.now() + 900;
        if (event.deltaY < 0) {
          stopAutoFollow(event.currentTarget);
        }
      }}
      onPointerDown={() => {
        userScrollIntentUntilRef.current = Date.now() + 900;
      }}
      onTouchStart={() => {
        userScrollIntentUntilRef.current = Date.now() + 900;
      }}
    >
      {state.messages.map((message, messageIndex) => {
        const commandCatalog = isCommandCatalog(message.text);
        const kindBadge = message.role === "user" ? messageKindBadge(message.kind) : null;
        const workflowEvents = workflowEventsForMessageId(state, message.id);
        const showWorkflowHere = workflowEvents.length > 0;
        const answerWebSources = message.role === "assistant" && message.isComplete
          ? webInvestigationSummary(webSourceEventsForAssistant(messageIndex))
          : { sources: [], queries: [] };
        return (
          <Fragment key={message.id}>
            <article
              className={`message ${message.role}${commandCatalog ? " command-output" : ""}${message.isError ? " error" : ""}${kindBadge ? ` message-kind-${kindBadge.className}` : ""}`}
            >
              {kindBadge ? <div className="message-kind-label">{kindBadge.label}</div> : null}
              <div className="bubble">
                {commandCatalog ? (
                  <CommandHelpMessage text={message.text} />
                ) : message.role === "assistant" ? (
                  <>
                    <StreamingAssistantMessage
                      message={message}
                      settings={state.appSettings}
                      active={isLastAssistantStreaming && message.id === lastMessage?.id}
                      onVisibleTextChange={() => {
                        if (!autoFollowRef.current || state.restoringHistory) {
                          return;
                        }
                        scrollMessagesToBottom({
                          smooth: true,
                          duration: state.appSettings.streamScrollDurationMs,
                          continuous: true,
                        });
                      }}
                    />
                    <AssistantActions message={message} />
                    <AssistantArtifactCards message={message} />
                    <WebInvestigationSources sources={answerWebSources.sources} queries={answerWebSources.queries} />
                  </>
                ) : message.terminal ? (
                  <TerminalCommandMessage message={message} />
                ) : (
                  <UserMessageText text={message.text} />
                )}
              </div>
            </article>
            {showWorkflowHere ? (
              <WorkflowPanel
                events={workflowEvents}
                durationSeconds={workflowDurationForMessageId(state, message.id)}
              />
            ) : null}
          </Fragment>
        );
      })}
    </section>
  );
}
