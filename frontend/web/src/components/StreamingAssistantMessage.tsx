import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AppSettings, ChatMessage } from "../types/ui";
import { MarkdownMessage } from "./MarkdownMessage";

function useStreamingText(
  targetText: string,
  visuallyStreaming: boolean,
  startBufferMs: number,
  revealDurationMs: number,
) {
  const [visibleText, setVisibleText] = useState(targetText);
  const [revealFrom, setRevealFrom] = useState<number | null>(null);
  const visibleTextRef = useRef(visibleText);
  const pendingTextRef = useRef("");
  const flushTimerRef = useRef<number | null>(null);
  const displayStartedRef = useRef(false);

  useEffect(() => {
    visibleTextRef.current = visibleText;
  }, [visibleText]);

  function clearFlushTimer() {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }

  function streamingRevealCount(pendingChars: string[], flushAll = false) {
    if (flushAll) {
      return pendingChars.length;
    }
    if (pendingChars.length <= 4) {
      return pendingChars.length;
    }
    const text = pendingChars.join("");
    const sentenceMatch = text.match(/^.{18,}?[.!?。！？…]\s*/u);
    if (sentenceMatch && sentenceMatch[0].length <= 12) {
      return sentenceMatch[0].length;
    }
    const lineBreakIndex = text.slice(3).search(/\n/);
    if (lineBreakIndex >= 0) {
      return Math.min(12, 3 + lineBreakIndex + 1);
    }
    return Math.min(
      pendingChars.length,
      Math.max(3, Math.min(12, Math.ceil(pendingChars.length / 2))),
    );
  }

  function scheduleFlush() {
    if (flushTimerRef.current !== null) {
      return;
    }
    const revealDelay = Math.max(44, Math.min(96, Math.max(0, revealDurationMs) * 0.16));
    const delay = displayStartedRef.current ? revealDelay : Math.max(0, Math.min(2000, startBufferMs));
    flushTimerRef.current = window.setTimeout(flushStreamingText, delay);
  }

  function flushStreamingText() {
    flushTimerRef.current = null;
    const pendingChars = Array.from(pendingTextRef.current);
    if (!pendingChars.length) {
      return;
    }
    displayStartedRef.current = true;
    const revealCount = streamingRevealCount(pendingChars);
    const nextText = pendingChars.slice(0, revealCount).join("");
    pendingTextRef.current = pendingChars.slice(revealCount).join("");
    setRevealFrom(visibleTextRef.current.length);
    visibleTextRef.current = `${visibleTextRef.current}${nextText}`;
    setVisibleText(visibleTextRef.current);
    if (pendingTextRef.current) {
      scheduleFlush();
    }
  }

  useEffect(() => () => {
    clearFlushTimer();
  }, []);

  useEffect(() => {
    if (!visuallyStreaming) {
      clearFlushTimer();
      pendingTextRef.current = "";
      displayStartedRef.current = false;
      visibleTextRef.current = targetText;
      setRevealFrom(null);
      setVisibleText(targetText);
      return;
    }

    const visibleText = visibleTextRef.current;
    const queuedText = `${visibleText}${pendingTextRef.current}`;
    if (queuedText === targetText) {
      return;
    }

    if (targetText.startsWith(queuedText)) {
      pendingTextRef.current = targetText.slice(queuedText.length);
      scheduleFlush();
      return;
    }

    if (targetText.startsWith(visibleText)) {
      pendingTextRef.current = targetText.slice(visibleText.length);
      scheduleFlush();
      return;
    }

    clearFlushTimer();
    pendingTextRef.current = "";
    displayStartedRef.current = false;
    visibleTextRef.current = targetText;
    setRevealFrom(null);
    setVisibleText(targetText);
  }, [targetText, visuallyStreaming, startBufferMs, revealDurationMs]);

  return {
    visibleText,
    revealFrom,
  };
}

function splitStreamingMarkdown(text: string) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  let stableBoundary = 0;
  let position = 0;
  let inFence = false;
  let fenceMarker = "";

  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    const rawLine = match[0];
    if (!rawLine) {
      break;
    }
    const lineEnd = position + rawLine.length;
    const lineText = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    const fence = lineText.match(/^ {0,3}(`{3,}|~{3,})/);

    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
        inFence = false;
        stableBoundary = lineEnd;
      }
    } else if (!inFence && lineText.trim() === "") {
      stableBoundary = lineEnd;
    }

    position = lineEnd;
  }

  return {
    prefix: source.slice(0, stableBoundary).trimEnd(),
    liveTail: source.slice(stableBoundary),
  };
}

function markdownTableCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return [];
  }
  return trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableRow(line: string) {
  const cells = markdownTableCells(line);
  return cells.length >= 2 && cells.some(Boolean);
}

function isMarkdownTableDivider(line: string) {
  const cells = markdownTableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isStructuredLiveMarkdown(text: string) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const trimmed = source.trimStart();
  if (/^(`{3,}|~{3,})\s*(html?|[A-Za-z0-9_-]+)?/i.test(trimmed)) {
    return true;
  }
  const lines = source.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    if (isMarkdownTableRow(lines[index - 1]) && isMarkdownTableDivider(lines[index])) {
      return true;
    }
  }
  return false;
}

function StreamingPlainText({ text, revealFrom }: { text: string; revealFrom: number | null }) {
  if (revealFrom === null || revealFrom < 0 || revealFrom >= text.length) {
    return <p>{text}</p>;
  }
  return (
    <p>
      {text.slice(0, revealFrom)}
      <span className="stream-reveal-sentence">{text.slice(revealFrom)}</span>
    </p>
  );
}

function StreamingMarkdownMessage({
  text,
  revealFrom,
}: {
  text: string;
  revealFrom: number | null;
}) {
  const { prefix, liveTail } = useMemo(() => splitStreamingMarkdown(text), [text]);
  const renderLiveTailAsMarkdown = isStructuredLiveMarkdown(liveTail);
  const prefixRevealFrom = revealFrom !== null && revealFrom < prefix.length ? revealFrom : null;
  const liveTailRevealFrom = revealFrom !== null ? Math.max(0, revealFrom - prefix.length) : null;

  return (
    <>
      {prefix ? (
        <MarkdownMessage text={prefix} revealFrom={prefixRevealFrom} deferIncompleteTables />
      ) : null}
      {liveTail && renderLiveTailAsMarkdown ? (
        <div className="stream-live-text">
          <MarkdownMessage text={liveTail} revealFrom={liveTailRevealFrom} deferIncompleteTables />
        </div>
      ) : liveTail ? (
        <div className="markdown-body react-markdown stream-live-text">
          <StreamingPlainText text={liveTail} revealFrom={liveTailRevealFrom} />
        </div>
      ) : null}
    </>
  );
}

export function StreamingAssistantMessage({
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
  const { visibleText, revealFrom } = useStreamingText(
    message.text,
    visuallyStreaming,
    settings.streamStartBufferMs,
    settings.streamRevealDurationMs,
  );
  const style = useMemo(() => ({
    "--stream-reveal-duration": `${Math.max(0, Math.min(2000, settings.streamRevealDurationMs))}ms`,
    "--stream-reveal-wipe": `${Math.max(100, Math.min(400, settings.streamRevealWipePercent))}%`,
  }) as CSSProperties, [settings.streamRevealDurationMs, settings.streamRevealWipePercent]);

  useEffect(() => {
    if (visuallyStreaming && visibleText) {
      onVisibleTextChange?.();
    }
  }, [visuallyStreaming, onVisibleTextChange, visibleText]);

  return (
    <div className={visuallyStreaming ? "react-streaming-text streaming-text" : undefined} style={style}>
      {visuallyStreaming ? (
        <StreamingMarkdownMessage text={visibleText} revealFrom={revealFrom} />
      ) : (
        <MarkdownMessage text={message.text} />
      )}
    </div>
  );
}
