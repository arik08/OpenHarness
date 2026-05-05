import { Fragment, useMemo } from "react";
import { useMessageAutoFollow } from "../hooks/useMessageAutoFollow";
import { useAppState } from "../state/app-state";
import type { AppState, ChatMessage, WorkflowEvent } from "../types/ui";
import { AssistantActions } from "./AssistantActions";
import { AssistantArtifactContent } from "./AssistantArtifactCards";
import { CommandHelpMessage, isCommandCatalog } from "./CommandHelpMessage";
import { UserMessageText } from "./UserMessageText";
import { WebInvestigationSources, webInvestigationSummary, WorkflowPanel } from "./WorkflowPanel";

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

function isQuietCommandTurn(message: ChatMessage) {
  return message.role === "user" && /^\/help\b/i.test(message.text.trim());
}

export function MessageList() {
  const { state, dispatch } = useAppState();
  const lastMessage = state.messages.at(-1);
  const activeWorkflowFollowSignature = useMemo(
    () => state.workflowEvents.map((event) => [
      event.id,
      event.status,
      event.detail,
    ].join(":")).join("|"),
    [state.workflowEvents],
  );
  const {
    messagesRef,
    isLastAssistantStreaming,
    shouldFollowGrowingTail,
    handleScroll,
    handleWheel,
    handlePointerIntent,
    handleVisibleTextChange,
    handleVisibleWorkflowProgressChange,
  } = useMessageAutoFollow({
    state,
    dispatch,
    lastMessage,
    activeWorkflowFollowSignature,
  });

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

  if (!state.messages.length) {
    return (
      <section className="messages" aria-live="polite" ref={messagesRef}>
        <div className="welcome">
          <span className="welcome-mark">MH</span>
          <h2>무엇을 도와드릴까요?</h2>
          <p>업무에 필요한 조사, 정리, 코드 작업을 도와드릴 준비가 되어 있습니다.</p>
        </div>
        <WorkflowPanel onVisibleProgressChange={handleVisibleWorkflowProgressChange} />
      </section>
    );
  }

  return (
    <section
      className={`messages${shouldFollowGrowingTail ? " streaming-follow" : ""}`}
      aria-live="polite"
      ref={messagesRef}
      onScroll={(event) => {
        handleScroll(event.currentTarget);
      }}
      onWheel={(event) => {
        handleWheel(event.currentTarget, event.deltaY);
      }}
      onPointerDown={handlePointerIntent}
      onTouchStart={handlePointerIntent}
    >
      {state.messages.map((message, messageIndex) => {
        const commandCatalog = isCommandCatalog(message.text);
        const kindBadge = message.role === "user" ? messageKindBadge(message.kind) : null;
        const workflowEvents = workflowEventsForMessageId(state, message.id);
        const showWorkflowHere = workflowEvents.length > 0 && !isQuietCommandTurn(message);
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
                    <AssistantArtifactContent
                      message={message}
                      settings={state.appSettings}
                      active={isLastAssistantStreaming && message.id === lastMessage?.id}
                      onVisibleTextChange={handleVisibleTextChange}
                    />
                    <AssistantActions message={message}>
                      <WebInvestigationSources sources={answerWebSources.sources} queries={answerWebSources.queries} />
                    </AssistantActions>
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
                onVisibleProgressChange={handleVisibleWorkflowProgressChange}
              />
            ) : null}
          </Fragment>
        );
      })}
    </section>
  );
}
