import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { cancelMessage, sendMessage } from "../api/messages";
import { useAppState } from "../state/app-state";
import type { ArtifactSummary, Attachment, CommandItem, SkillItem } from "../types/backend";
import { InlineQuestion } from "./InlineQuestion";
import { TodoDock } from "./TodoDock";

const longPastedTextLineThreshold = 10;
const maxImageBytes = 10 * 1024 * 1024;

type Suggestion =
  | { kind: "command"; value: string; label: string; description: string }
  | { kind: "skill"; value: string; label: string; description: string }
  | { kind: "file"; value: string; label: string; description: string };

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name || "이미지"}를 읽지 못했습니다.`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, data = ""] = result.split(",", 2);
      resolve({
        media_type: file.type || "image/png",
        data,
        name: file.name || "pasted-image.png",
      });
    };
    reader.readAsDataURL(file);
  });
}

function commandSuggestions(commands: CommandItem[], query: string): Suggestion[] {
  const normalized = query.replace(/^\//, "").toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((command) => ({
      kind: "command",
      value: command.name.startsWith("/") ? command.name : `/${command.name}`,
      label: command.name.startsWith("/") ? command.name : `/${command.name}`,
      description: command.description || "명령 실행",
    }));
}

function skillSuggestions(skills: SkillItem[], query: string): Suggestion[] {
  const normalized = query.replace(/^\$/, "").toLowerCase();
  return skills
    .filter((skill) => skill.enabled !== false && skill.name.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((skill) => ({
      kind: "skill",
      value: `$${skill.name}`,
      label: `$${skill.name}`,
      description: skill.description || skill.source || "스킬",
    }));
}

function fileSuggestions(artifacts: ArtifactSummary[], query: string): Suggestion[] {
  const normalized = query.replace(/^@/, "").toLowerCase();
  return artifacts
    .filter((artifact) => artifact.path.toLowerCase().includes(normalized) || artifact.name.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((artifact) => ({
      kind: "file",
      value: `@${artifact.path}`,
      label: `@${artifact.name}`,
      description: artifact.path,
    }));
}

export function Composer() {
  const { state, dispatch } = useAppState();
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isMultiline, setIsMultiline] = useState(false);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSuggestionRef = useRef<HTMLButtonElement | null>(null);
  const submittingRef = useRef(false);
  const draft = state.composer.draft;
  const hasPayload = Boolean(draft.trim() || state.composer.attachments.length || state.composer.pastedTexts.length);
  const canSend = Boolean(state.sessionId && hasPayload && !state.busy);
  const canSteer = Boolean(state.sessionId && state.busy && fullLine().trim() && state.composer.attachments.length === 0);
  const showStop = Boolean(state.busy && !canSteer);
  const suggestions = useMemo(() => {
    const trimmed = draft.trimStart();
    if (!trimmed || /\s/.test(trimmed)) return [];
    if (trimmed.startsWith("/")) return commandSuggestions(state.commands, trimmed);
    if (trimmed.startsWith("$")) return skillSuggestions(state.skills, trimmed);
    if (trimmed.startsWith("@")) return fileSuggestions(state.artifacts, trimmed);
    return [];
  }, [draft, state.artifacts, state.commands, state.skills]);
  const activeSuggestionIndex = suggestions.length ? Math.min(selectedSuggestionIndex, suggestions.length - 1) : 0;

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [draft]);

  useEffect(() => {
    if (!state.busy) {
      submittingRef.current = false;
    }
  }, [state.busy]);

  useEffect(() => {
    activeSuggestionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeSuggestionIndex, suggestions.length]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const style = window.getComputedStyle(input);
    const maxHeight = Number.parseFloat(style.getPropertyValue("--composer-input-max-height")) || 96;
    const minHeight = Number.parseFloat(style.minHeight) || 20;

    input.style.height = "auto";
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
    setIsMultiline(nextHeight > minHeight + 12);
  }, [draft, state.composer.attachments.length, state.composer.pastedTexts.length]);

  useLayoutEffect(() => {
    function updateComposerMetrics() {
      const composerRect = composerRef.current?.getBoundingClientRect();
      const height = composerRect && Number.isFinite(composerRect.top)
        ? Math.ceil(Math.max(0, composerRect.bottom - composerRect.top))
        : Math.ceil(composerRef.current?.getBoundingClientRect().height || 0);
      if (height > 0) {
        document.documentElement.style.setProperty("--composer-stack-height", `${height}px`);
      }

      const chatPanel = composerRef.current?.closest(".chat-panel");
      const rect = chatPanel?.getBoundingClientRect();
      if (rect) {
        document.documentElement.style.setProperty("--chat-panel-left", `${Math.round(rect.left)}px`);
        document.documentElement.style.setProperty("--chat-panel-width", `${Math.round(rect.width)}px`);
      }
    }

    updateComposerMetrics();
    if (!window.ResizeObserver) return;

    const observer = new ResizeObserver(updateComposerMetrics);
    if (composerRef.current) observer.observe(composerRef.current);
    if (composerBoxRef.current) observer.observe(composerBoxRef.current);
    const chatPanel = composerRef.current?.closest(".chat-panel");
    if (chatPanel) observer.observe(chatPanel);
    return () => observer.disconnect();
  }, [isMultiline, state.composer.attachments.length, state.composer.pastedTexts.length]);

  function fullLine() {
    const pasted = state.composer.pastedTexts.map((text, index) => `[붙여넣은 텍스트 ${index + 1}]\n${text}`).join("\n\n");
    return [draft.trim(), pasted].filter(Boolean).join("\n\n");
  }

  async function addImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      dispatch({ type: "open_modal", modal: { kind: "error", message: "이미지 파일만 첨부할 수 있습니다." } });
      return;
    }
    if (file.size > maxImageBytes) {
      dispatch({ type: "open_modal", modal: { kind: "error", message: "이미지는 10MB 이하만 첨부할 수 있습니다." } });
      return;
    }
    try {
      dispatch({ type: "add_attachment", attachment: await fileToAttachment(file) });
    } catch (error) {
      dispatch({ type: "open_modal", modal: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
    }
  }

  function attachmentSrc(attachment: Attachment) {
    return `data:${attachment.media_type || "image/png"};base64,${attachment.data}`;
  }

  function showAttachmentPreview(attachment: Attachment) {
    dispatch({
      type: "open_modal",
      modal: {
        kind: "imagePreview",
        src: attachmentSrc(attachment),
        name: attachment.name || "이미지",
        alt: attachment.name || "첨부 이미지",
      },
    });
  }

  function applySuggestion(suggestion: Suggestion) {
    dispatch({ type: "set_draft", value: suggestion.value });
  }

  async function cancelCurrent() {
    if (!state.sessionId) return;
    try {
      await cancelMessage(state.sessionId, state.clientId);
      dispatch({ type: "set_busy", value: false });
    } catch (error) {
      dispatch({ type: "open_modal", modal: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
    }
  }

  async function togglePlanMode() {
    if (!state.sessionId) return;
    const currentDraft = state.composer.draft;
    try {
      await sendMessage({
        sessionId: state.sessionId,
        clientId: state.clientId,
        line: "/plan",
        attachments: [],
      });
      dispatch({ type: "set_draft", value: currentDraft });
    } catch (error) {
      dispatch({
        type: "backend_event",
        event: { type: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.busy) {
      if (canSteer) {
        await sendBusyLine("steer");
        return;
      }
      if (!hasPayload) {
        await cancelCurrent();
      }
      return;
    }
    if (submittingRef.current) {
      return;
    }
    const line = fullLine();
    if (!state.sessionId || !line && state.composer.attachments.length === 0) {
      return;
    }

    submittingRef.current = true;
    dispatch({ type: "set_busy", value: true });
    const shellShortcut = line.trim().startsWith("!") && state.composer.attachments.length === 0;
    dispatch({
      type: "append_message",
      message: shellShortcut
        ? {
            role: "log",
            text: line,
            toolName: "shell-shortcut",
            terminal: { command: line.trim().slice(1).trim(), status: "running" },
          }
        : { role: "user", text: line || "(이미지 첨부)" },
    });
    dispatch({ type: "clear_composer" });

    try {
      await sendMessage({
        sessionId: state.sessionId,
        clientId: state.clientId,
        line,
        attachments: state.composer.attachments,
        suppressUserTranscript: shellShortcut || state.composer.attachments.length > 0,
        systemPrompt: state.systemPrompt.trim() || undefined,
      });
    } catch (error) {
      dispatch({
        type: "backend_event",
        event: { type: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function sendBusyLine(mode: "queue" | "steer") {
    if (!state.sessionId) return;
    const line = fullLine();
    if (!line && state.composer.attachments.length === 0) {
      await cancelCurrent();
      return;
    }
    if (state.composer.attachments.length > 0) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: "진행 중인 답변에는 텍스트만 보낼 수 있습니다. 이미지는 답변이 끝난 뒤 보내주세요." },
      });
      return;
    }
    dispatch({ type: "clear_composer" });
    try {
      await sendMessage({
        sessionId: state.sessionId,
        clientId: state.clientId,
        line,
        attachments: [],
        mode,
      });
    } catch (error) {
      dispatch({
        type: "backend_event",
        event: { type: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!state.busy) {
        void togglePlanMode();
      }
      return;
    }
    if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab" || event.key === "Escape")) {
      event.preventDefault();
      if (event.key === "Escape") {
        setSelectedSuggestionIndex(0);
        return;
      }
      if (event.key === "ArrowDown") {
        setSelectedSuggestionIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        setSelectedSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      applySuggestion(suggestions[activeSuggestionIndex]);
      return;
    }
    if (event.key === "Enter" && event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      if (state.busy) {
        void sendBusyLine("queue");
        return;
      }
      event.currentTarget.form?.requestSubmit();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (suggestions[activeSuggestionIndex]) {
        applySuggestion(suggestions[activeSuggestionIndex]);
        return;
      }
      if (state.busy) {
        void sendBusyLine("steer");
        return;
      }
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = [...event.clipboardData.items];
    const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        void addImageFile(file);
        return;
      }
    }
    const text = event.clipboardData.getData("text/plain");
    if (text && text.split(/\r?\n/).length >= longPastedTextLineThreshold) {
      event.preventDefault();
      dispatch({ type: "add_pasted_text", text });
    }
  }

  return (
    <form className="composer" id="composer" ref={composerRef} onSubmit={handleSubmit}>
      <TodoDock variant="dock" />
      <div className={`pasted-text-tray${state.composer.pastedTexts.length ? "" : " hidden"}`} id="pastedTextTray" aria-label="Pasted text">
        {state.composer.pastedTexts.map((text, index) => (
          <div className="pasted-text-chip" key={`${text.length}-${index}`}>
            <span>[Pasted text #{index + 1} +{text.replace(/\r\n/g, "\n").split("\n").length} lines]</span>
            <button className="pasted-text-remove" type="button" aria-label="Remove pasted text" onClick={() => dispatch({ type: "remove_pasted_text", index })}>
              x
            </button>
          </div>
        ))}
      </div>
      <InlineQuestion />
      <div className={`composer-box${isMultiline ? " multiline" : ""}`} ref={composerBoxRef}>
        <div className={`attachment-tray${state.composer.attachments.length ? "" : " hidden"}`} id="attachmentTray" aria-label="첨부한 이미지">
          {state.composer.attachments.map((attachment, index) => (
            <div className="attachment-chip" key={`${attachment.name}-${index}`}>
              <img
                src={attachmentSrc(attachment)}
                alt={attachment.name || "첨부 이미지"}
                role="button"
                tabIndex={0}
                onClick={() => showAttachmentPreview(attachment)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    showAttachmentPreview(attachment);
                  }
                }}
              />
              <span onClick={() => showAttachmentPreview(attachment)}>{attachment.name || "이미지"}</span>
              <button className="attachment-remove" type="button" aria-label="첨부 이미지 삭제" onClick={() => dispatch({ type: "remove_attachment", index })}>
                x
              </button>
            </div>
          ))}
        </div>
        <textarea
          id="promptInput"
          ref={inputRef}
          rows={1}
          placeholder="메세지를 입력하세요..."
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => dispatch({ type: "set_draft", value: event.currentTarget.value })}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <button
          className={`plan-mode-indicator${isPlanMode(state.permissionMode) ? "" : " hidden"}`}
          type="button"
          aria-label="계획모드 전환"
          aria-pressed={isPlanMode(state.permissionMode)}
          onClick={() => void togglePlanMode()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M9 6h11" />
            <path d="M9 12h11" />
            <path d="M9 18h11" />
            <path d="M4 6h.01" />
            <path d="M4 12h.01" />
            <path d="M4 18h.01" />
          </svg>
          <span>계획모드</span>
        </button>
        <TodoDock variant="composerButton" />
        <button
          id="sendButton"
          className={showStop ? "is-stop" : canSteer ? "is-steer" : ""}
          type="submit"
          disabled={state.busy ? !showStop && !canSteer : !canSend}
          aria-label={showStop ? "작업 중단" : canSteer ? "스티어링 보내기" : "메시지 보내기"}
        >
          {showStop ? (
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M15.5 8.5 8.5 15.5" />
              <path d="m8.5 8.5 7 7" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          )}
        </button>
      </div>
      <div className={`slash-menu${suggestions.length ? "" : " hidden"}`} id="slashMenu" role="listbox" aria-label="명령어와 스킬">
        {suggestions.map((suggestion, index) => (
          <button
            className={`slash-menu-item${index === activeSuggestionIndex ? " active" : ""}`}
            type="button"
            role="option"
            aria-selected={index === activeSuggestionIndex}
            key={`${suggestion.kind}-${suggestion.value}`}
            ref={index === activeSuggestionIndex ? activeSuggestionRef : null}
            onClick={() => applySuggestion(suggestion)}
          >
            <span className="slash-command-name">{suggestion.label}</span>
            <span className="slash-command-description">{suggestion.description}</span>
          </button>
        ))}
      </div>
    </form>
  );
}

function isPlanMode(value: string) {
  const mode = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return mode === "plan" || mode === "plan_mode" || mode === "permissionmode.plan";
}
