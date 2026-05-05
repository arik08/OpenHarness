import { useState, type MouseEvent } from "react";
import { sendBackendRequest } from "../api/messages";
import { restartSession } from "../api/session";
import { createWorkspace, deleteWorkspace } from "../api/workspaces";
import { useAppState } from "../state/app-state";
import type { Workspace } from "../types/backend";
import { SettingsModal } from "./SettingsModal";

export { isLocalBrowserHostname } from "../utils/settingsLabels";

function taskOutputForDisplay(value: unknown) {
  const raw = value == null ? "" : String(value);
  const trimmed = raw
    .replace(/\r\n/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "");
  return trimmed || "(출력 없음)";
}

export function ModalHost() {
  const { state, dispatch } = useAppState();
  const [answer, setAnswer] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [deletingWorkspace, setDeletingWorkspace] = useState("");
  const [pendingDeleteWorkspace, setPendingDeleteWorkspace] = useState("");

  if (!state.modal) {
    return null;
  }

  const close = () => dispatch({ type: "close_modal" });

  async function switchWorkspace(workspace: Workspace) {
    const session = await restartSession({
      sessionId: state.sessionId,
      clientId: state.clientId,
      cwd: workspace.path,
    });
    localStorage.setItem("myharness:workspaceName", workspace.name);
    dispatch({ type: "set_workspace", workspace: session.workspace || workspace });
    dispatch({ type: "session_replaced", sessionId: session.sessionId, workspace: session.workspace || workspace });
  }

  if (state.modal.kind === "settings") {
    return <SettingsModal onClose={close} />;
  }

  if (state.modal.kind === "modelSettings") {
    async function requestRuntimeChoice(command: "provider" | "model" | "effort") {
      if (!state.sessionId) return;
      await sendBackendRequest(state.sessionId, state.clientId, { type: "select_command", command });
    }

    return (
      <div className="modal-backdrop" data-modal-kind="model-settings" onClick={(event) => handleBackdropClick(event, close)}>
        <div className="modal-card model-settings-card" role="dialog" aria-modal="true">
          <button className="modal-close" type="button" aria-label="닫기" onClick={close}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
          <h2>모델 설정</h2>
          <p className="settings-helper">Provider, 모델, 추론 강도 선택은 기존 backend 선택 흐름을 사용합니다.</p>
          <div className="settings-grid">
            <button className="settings-row" type="button" onClick={() => void requestRuntimeChoice("provider")}>
              <strong>Provider</strong>
              <small>{state.provider}</small>
            </button>
            <button className="settings-row" type="button" onClick={() => void requestRuntimeChoice("model")}>
              <strong>모델</strong>
              <small>{state.model}</small>
            </button>
            <button className="settings-row" type="button" onClick={() => void requestRuntimeChoice("effort")}>
              <strong>추론 노력</strong>
              <small>{state.effort}</small>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.modal.kind === "workspace") {
    async function createAndSwitch() {
      const name = workspaceName.trim();
      if (!name) return;
      setWorkspaceError("");
      try {
        const data = await createWorkspace(name);
        dispatch({ type: "set_workspaces", workspaces: data.workspaces });
        await switchWorkspace(data.workspace);
        setWorkspaceName("");
        close();
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    }

    async function removeWorkspace(workspace: Workspace) {
      setWorkspaceError("");
      if (pendingDeleteWorkspace !== workspace.name) {
        setPendingDeleteWorkspace(workspace.name);
        return;
      }
      setDeletingWorkspace(workspace.name);
      try {
        const active = workspace.path === state.workspacePath;
        if (active) {
          const nextWorkspace =
            state.workspaces.find((item) => item.name === "Default" && item.path !== workspace.path)
            || state.workspaces.find((item) => item.path !== workspace.path);
          if (!nextWorkspace) {
            throw new Error("마지막 프로젝트는 삭제할 수 없습니다.");
          }
          await switchWorkspace(nextWorkspace);
        }
        const data = await deleteWorkspace(workspace.name);
        dispatch({ type: "set_workspaces", workspaces: data.workspaces });
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      } finally {
        setDeletingWorkspace("");
        setPendingDeleteWorkspace("");
      }
    }

    return (
      <div className="modal-backdrop" data-modal-kind="workspace" onClick={(event) => handleBackdropClick(event, close)}>
        <div className="modal-card workspace-card" role="dialog" aria-modal="true">
          <button className="modal-close" type="button" aria-label="닫기" onClick={close}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
          <h2>프로젝트</h2>
          <p>{state.workspaceScope.mode === "ip" ? "현재 접속 범위의 작업공간입니다." : "공유 작업공간입니다."}</p>
          <div className="workspace-list">
            {state.workspaces.map((workspace) => {
              const active = workspace.path === state.workspacePath;
              const deleting = deletingWorkspace === workspace.name;
              const deleteReady = pendingDeleteWorkspace === workspace.name;
              return (
                <div className={`workspace-row${active ? " active" : ""}${deleteReady ? " delete-ready" : ""}${deleting ? " deleting" : ""}`} key={workspace.path}>
                  <button className="workspace-option" type="button" onClick={() => void switchWorkspace(workspace).then(close)}>
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>{workspace.path}</small>
                    </span>
                  </button>
                  <button
                    className="workspace-delete"
                    type="button"
                    aria-label={deleteReady ? `${workspace.name} 삭제 확인` : `${workspace.name} 삭제`}
                    data-tooltip={deleteReady ? "한 번 더 누르면 삭제됩니다" : "프로젝트 삭제"}
                    disabled={deleting}
                    onClick={() => void removeWorkspace(workspace)}
                  >
                    {deleteReady ? (
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M12 3l9 16H3L12 3z" />
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                      </svg>
                    ) : (
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M6 6l1 15h10l1-15" />
                      </svg>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          <form
            className="workspace-create"
            onSubmit={(event) => {
              event.preventDefault();
              void createAndSwitch();
            }}
          >
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.currentTarget.value)}
              placeholder="새 프로젝트 이름"
              aria-label="새 프로젝트 이름"
            />
            <button type="submit" className="primary" disabled={!workspaceName.trim()}>
              만들기
            </button>
          </form>
          <p className="workspace-error">{workspaceError}</p>
        </div>
      </div>
    );
  }

  if (state.modal.kind === "imagePreview") {
    const label = state.modal.name || state.modal.alt || "첨부 이미지 미리보기";
    return (
      <div className="modal-backdrop" data-modal-kind="image-preview" onClick={(event) => handleBackdropClick(event, close)}>
        <div className="image-preview-card" role="dialog" aria-modal="true" aria-label={label}>
          <figure className="image-preview-figure">
            <button className="modal-close" type="button" aria-label="닫기" onClick={close}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
            <img src={state.modal.src} alt={state.modal.alt || state.modal.name || "첨부 이미지"} />
          </figure>
        </div>
      </div>
    );
  }

  if (state.modal.kind === "backend") {
    const payload = state.modal.payload || {};
    const kind = String(payload.kind || "");
    if (kind === "question" || kind === "permission") {
      return null;
    }
    if (kind === "task_output") {
      const title = String(payload.title || (payload.task_id ? `작업 결과 ${payload.task_id}` : "작업 결과"));
      const output = taskOutputForDisplay(payload.output);
      return (
        <div className="modal-backdrop" data-modal-kind="task-output" onClick={(event) => handleBackdropClick(event, close)}>
          <div className="modal-card task-output-card" role="dialog" aria-modal="true" aria-label={title}>
            <button className="modal-close" type="button" aria-label="닫기" onClick={close}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
            <h2>{title}</h2>
            <pre className="task-output-log">{output}</pre>
          </div>
        </div>
      );
    }
    const requestId = String(payload.request_id || "");
    const question = String(payload.question || payload.reason || payload.message || "");
    const choices = Array.isArray(payload.choices)
      ? payload.choices as Array<Record<string, unknown>>
      : Array.isArray(payload.select_options)
        ? payload.select_options as Array<Record<string, unknown>>
        : [];

    async function respond(responsePayload: Record<string, unknown>) {
      if (!state.sessionId) return;
      await sendBackendRequest(state.sessionId, state.clientId, responsePayload);
      dispatch({ type: "close_modal" });
      setAnswer("");
    }

    return (
      <div className="modal-backdrop" onClick={(event) => handleBackdropClick(event, close)}>
        <div className="modal-card" role="dialog" aria-modal="true">
          <button className="modal-close" type="button" aria-label="닫기" onClick={close}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
          <h2>{kind === "permission" ? "권한 요청" : kind === "question" ? "질문" : "선택"}</h2>
          <p>{question || "에이전트가 응답을 기다리고 있습니다."}</p>
          {kind === "permission" ? (
            <div className="modal-actions">
              <button type="button" onClick={() => void respond({ type: "permission_response", request_id: requestId, allowed: false })}>
                거부
              </button>
              <button type="button" className="primary" onClick={() => void respond({ type: "permission_response", request_id: requestId, allowed: true })}>
                허용
              </button>
            </div>
          ) : choices.length ? (
            <div className="settings-grid">
              {choices.map((choice, index) => {
                const value = String(choice.value || choice.label || "");
                const label = String(choice.label || choice.value || `선택 ${index + 1}`);
                return (
                  <button
                    className="settings-row"
                    type="button"
                    key={`${value}-${index}`}
                    onClick={() => void respond(kind === "question"
                      ? { type: "question_response", request_id: requestId, answer: value || label }
                      : { type: "apply_select_command", command: payload.command, value })}
                  >
                    <strong>{label}</strong>
                    {choice.description ? <small>{String(choice.description)}</small> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <form
              className="settings-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void respond({ type: "question_response", request_id: requestId, answer });
              }}
            >
              <textarea className="system-prompt-input" value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} autoFocus />
              <div className="modal-actions">
                <button type="submit" className="primary" disabled={!answer.trim()}>
                  보내기
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  const message = state.modal.kind === "error"
    ? state.modal.message
    : "확인이 필요합니다.";

  return (
    <div className="modal-backdrop" onClick={(event) => handleBackdropClick(event, close)}>
      <div className="modal-card" role="dialog" aria-modal="true">
        <button className="modal-close" type="button" aria-label="닫기" onClick={close}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
        <h2>{state.modal.kind === "error" ? "오류" : "확인 필요"}</h2>
        <p>{message}</p>
      </div>
    </div>
);
}

function handleBackdropClick(event: MouseEvent<HTMLDivElement>, onDismiss: () => void) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}
