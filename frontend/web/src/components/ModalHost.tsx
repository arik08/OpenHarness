import { useEffect, useState, type MouseEvent } from "react";
import { sendBackendRequest } from "../api/messages";
import { restartSession } from "../api/session";
import {
  changeLearnedSkillsMode,
  changeShellPreference,
  changeWorkspaceScope,
  changeYoloMode,
  openFolderDialog,
  readLearnedSkillsSettings,
  readPgptSettings,
  readShellSettings,
  readUserStats,
  readWorkspaceScopeSettings,
  readYoloModeSettings,
  savePgptSettings,
  type PgptSettings,
  type UserStats,
} from "../api/settings";
import { createWorkspace, deleteWorkspace } from "../api/workspaces";
import { useAppState } from "../state/app-state";
import type { Workspace } from "../types/backend";
import type { AppSettings } from "../types/ui";

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

type SettingsView = "home" | "prompt" | "behavior" | "download" | "shell" | "yolo" | "stats" | "restart" | "workspace" | "learned-skills" | "pgpt";

export function isLocalBrowserHostname(hostname: string) {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isLocalBrowserHost() {
  return isLocalBrowserHostname(window.location.hostname);
}

function shellPreferenceLabel(value: AppSettings["shell"]) {
  return {
    auto: "자동: PowerShell 우선",
    powershell: "PowerShell",
    "git-bash": "Git Bash",
    cmd: "cmd",
  }[value] || "자동: PowerShell 우선";
}

function downloadModeLabel(settings: AppSettings) {
  if (!isLocalBrowserHost()) return "브라우저 다운로드";
  if (settings.downloadMode === "folder") {
    return settings.downloadFolderPath ? `지정 폴더: ${settings.downloadFolderPath}` : "지정 폴더 필요";
  }
  return "매번 저장 위치 선택";
}

function streamingSettingsLabel(settings: AppSettings) {
  return `따라가기 ${settings.streamScrollDurationMs} ms / 버퍼 ${settings.streamStartBufferMs} ms / 앞섬 ${settings.streamFollowLeadPx}px`;
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<SettingsView>("home");
  const dismiss = view === "home" ? onClose : () => setView("home");

  return (
    <div className="modal-backdrop" onClick={(event) => handleBackdropClick(event, dismiss)}>
      <div className="modal-card system-settings-card" role="dialog" aria-modal="true">
        <button className="modal-close" type="button" aria-label="닫기" onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
        {view === "home" ? (
          <SettingsHome onSelect={setView} />
        ) : (
          <SettingsDetail view={view} onBack={() => setView("home")} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function SettingsHome({ onSelect }: { onSelect: (view: SettingsView) => void }) {
  const { state } = useAppState();
  const localBrowserHost = isLocalBrowserHost();
  const serverOnlyLabel = "서버 PC에서만 변경";
  return (
    <>
      <h2>설정</h2>
      <p className="settings-helper">자주 바꾸는 동작과 연결 정보를 한 곳에서 관리합니다.</p>
      <div className="settings-grid">
        <button type="button" className="settings-row" onClick={() => onSelect("prompt")}>
          <strong>프롬프트</strong>
          <small>{state.systemPrompt ? "사용자 프롬프트 적용 중" : "기본값"}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("behavior")}>
          <strong>스트리밍 스크롤</strong>
          <small>{streamingSettingsLabel(state.appSettings)}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("download")}>
          <strong>파일 저장경로</strong>
          <small>{downloadModeLabel(state.appSettings)}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("shell")} disabled={!localBrowserHost}>
          <strong>명령어 셀 (CLI)</strong>
          <small>{localBrowserHost ? shellPreferenceLabel(state.appSettings.shell) : serverOnlyLabel}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("yolo")} disabled={!localBrowserHost}>
          <strong>Yolo 모드</strong>
          <small>{localBrowserHost ? "명령 실행과 파일 작업 권한 자동 승인 여부를 정합니다." : serverOnlyLabel}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("stats")}>
          <strong>IP별 사용 통계</strong>
          <small>DAU / 접속횟수 / IP별 집계</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("restart")}>
          <strong>터미널 세션 재시작</strong>
          <small>{state.sessionId ? "현재 세션 강제 재연결" : "새 세션 시작"}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("workspace")} disabled={!localBrowserHost}>
          <strong>작업공간 범위</strong>
          <small>{localBrowserHost ? (state.workspaceScope.mode === "ip" ? "IP별 프로젝트 분리" : "공용 shared 프로젝트") : serverOnlyLabel}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("learned-skills")} disabled={!localBrowserHost}>
          <strong>자동학습 스킬 표시</strong>
          <small>{localBrowserHost ? "학습된 스킬을 표시하거나 숨깁니다." : serverOnlyLabel}</small>
        </button>
        <button type="button" className="settings-row" onClick={() => onSelect("pgpt")} disabled={!localBrowserHost}>
          <strong>P-GPT API KEY</strong>
          <small>{localBrowserHost ? "API Key, 직원번호, 회사번호를 저장합니다." : serverOnlyLabel}</small>
        </button>
      </div>
    </>
  );
}

function SettingsDetail({ view, onBack, onClose }: { view: SettingsView; onBack: () => void; onClose: () => void }) {
  if (!isLocalBrowserHost() && isServerHostSettingsView(view)) return <ServerHostOnlySettings onBack={onBack} />;
  if (view === "prompt") return <PromptSettings onBack={onBack} />;
  if (view === "behavior") return <BehaviorSettings onBack={onBack} />;
  if (view === "download") return <DownloadSettings onBack={onBack} />;
  if (view === "shell") return <ShellSettings onBack={onBack} />;
  if (view === "yolo") return <YoloSettings onBack={onBack} />;
  if (view === "stats") return <UserStatsSettings onBack={onBack} />;
  if (view === "restart") return <RestartSessionSettings onBack={onBack} onClose={onClose} />;
  if (view === "workspace") return <WorkspaceScopeSettings onBack={onBack} onClose={onClose} />;
  if (view === "learned-skills") return <LearnedSkillsSettings onBack={onBack} />;
  return <PgptSettingsForm onBack={onBack} />;
}

function isServerHostSettingsView(view: SettingsView) {
  return view === "shell" || view === "yolo" || view === "workspace" || view === "learned-skills" || view === "pgpt";
}

function ServerHostOnlySettings({ onBack }: { onBack: () => void }) {
  return (
    <>
      <SettingsHeader title="서버 PC 전용">이 설정은 MyHarness를 실행 중인 PC에서만 변경할 수 있습니다.</SettingsHeader>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
      </div>
    </>
  );
}

function SettingsHeader({ title, children }: { title: string; children: string }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="settings-helper">{children}</p>
    </>
  );
}

function PromptSettings({ onBack }: { onBack: () => void }) {
  const { state, dispatch } = useAppState();
  const [value, setValue] = useState(state.systemPrompt);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    try {
      dispatch({ type: "set_system_prompt", value });
      if (state.sessionId) {
        await sendBackendRequest(state.sessionId, state.clientId, { type: "set_system_prompt", value });
      }
      onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <SettingsHeader title="프롬프트">에이전트에 항상 붙일 기본 지시문을 저장합니다.</SettingsHeader>
      <textarea className="system-prompt-input" rows={7} value={value} placeholder="예: 항상 한국어 존댓말로 답하고, 변경 전후를 짧게 정리해줘." onChange={(event) => setValue(event.currentTarget.value)} autoFocus />
      <p className="settings-helper">비워두면 기본 프롬프트를 사용합니다. 저장한 내용은 다음 메시지부터 적용됩니다.</p>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
        <button type="button" onClick={() => setValue("")}>초기화</button>
        <button type="button" className="primary" onClick={() => void save()}>저장</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function NumericSetting({ label, helper, min, max, step, value, onChange }: { label: string; helper: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="setting-field">
      <span className="setting-field-label">{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
      <small>{helper}</small>
    </label>
  );
}

function BehaviorSettings({ onBack }: { onBack: () => void }) {
  const { state, dispatch } = useAppState();
  const [settings, setSettings] = useState(state.appSettings);

  function update(value: Partial<AppSettings>) {
    setSettings((current) => ({ ...current, ...value }));
  }

  function save() {
    dispatch({ type: "set_app_settings", value: settings });
    onBack();
  }

  return (
    <>
      <SettingsHeader title="스트리밍 스크롤">답변이 스트리밍될 때 표시와 스크롤 흐름을 조절합니다.</SettingsHeader>
      <section className="setting-section">
        <div className="setting-section-header"><h3>가로 스트리밍 표시</h3><p>텍스트가 좌에서 우로 표시되는 흐름을 조절합니다.</p></div>
        <NumericSetting label="버퍼 시간" helper="첫 표시 전 텍스트를 잠깐 모으는 시간입니다." min={0} max={2000} step={10} value={settings.streamStartBufferMs} onChange={(value) => update({ streamStartBufferMs: value })} />
        <NumericSetting label="닦아내기 시간" helper="새 텍스트가 드러나는 애니메이션 시간입니다." min={0} max={2000} step={20} value={settings.streamRevealDurationMs} onChange={(value) => update({ streamRevealDurationMs: value })} />
        <NumericSetting label="닦아내기 폭" helper="좌에서 우로 움직이는 마스크 폭입니다." min={100} max={400} step={10} value={settings.streamRevealWipePercent} onChange={(value) => update({ streamRevealWipePercent: value })} />
      </section>
      <section className="setting-section">
        <div className="setting-section-header"><h3>세로 스크롤 따라가기</h3><p>답변이 길어질 때 아래쪽으로 따라가는 흐름을 조절합니다.</p></div>
        <NumericSetting label="따라가기 시간" helper="아래로 따라가는 애니메이션 시간입니다." min={0} max={5000} step={100} value={settings.streamScrollDurationMs} onChange={(value) => update({ streamScrollDurationMs: value })} />
        <NumericSetting label="따라가기 앞섬" helper="답변 꼬리 아래 여백을 얼마나 미리 확보할지 조절합니다." min={0} max={220} step={5} value={settings.streamFollowLeadPx} onChange={(value) => update({ streamFollowLeadPx: value })} />
      </section>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
        <button type="button" className="primary" onClick={save}>저장</button>
      </div>
    </>
  );
}

function DownloadSettings({ onBack }: { onBack: () => void }) {
  const { state, dispatch } = useAppState();
  const localBrowserHost = isLocalBrowserHost();
  const [mode, setMode] = useState<AppSettings["downloadMode"]>(localBrowserHost ? state.appSettings.downloadMode : "ask");
  const [folderPath, setFolderPath] = useState(localBrowserHost ? state.appSettings.downloadFolderPath : "");
  const [error, setError] = useState("");

  async function browse() {
    if (!localBrowserHost) return;
    setError("");
    try {
      const selected = await openFolderDialog(folderPath);
      if (!selected.canceled && selected.folderPath) {
        setFolderPath(selected.folderPath);
        setMode("folder");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function save() {
    dispatch({ type: "set_app_settings", value: { downloadMode: localBrowserHost ? mode : "ask", downloadFolderPath: localBrowserHost ? folderPath : "" } });
    onBack();
  }

  return (
    <>
      <SettingsHeader title="파일 저장경로">{localBrowserHost ? "다운로드할 때마다 위치를 물어볼지, 지정 폴더에 바로 저장할지 선택합니다." : "원격 접속에서는 브라우저 다운로드를 사용합니다."}</SettingsHeader>
      <label className="setting-field">
        <span className="setting-field-label">저장 방식</span>
        <select value={mode} onChange={(event) => setMode(event.currentTarget.value === "folder" ? "folder" : "ask")}>
          <option value="ask">매번 저장 위치 선택</option>
          <option value="folder" disabled={!localBrowserHost}>지정 폴더에 자동 저장</option>
        </select>
        <small>{localBrowserHost ? "지정 폴더 저장은 앱 서버가 해당 경로로 파일을 복사합니다." : "클라이언트 PC의 실제 저장 위치는 브라우저 다운로드 설정을 따릅니다."}</small>
      </label>
      <label className="setting-field">
        <span className="setting-field-label">지정 폴더</span>
        <div className="folder-picker">
          <input type="text" value={folderPath} readOnly placeholder={localBrowserHost ? "선택된 폴더가 없습니다" : "브라우저 다운로드 사용"} />
          <button type="button" disabled={!localBrowserHost} onClick={() => void browse()}>찾아보기</button>
        </div>
        <small>{localBrowserHost ? "찾아보기를 눌러 저장할 폴더를 선택하세요." : "원격 접속에서는 Host 폴더 선택을 사용할 수 없습니다."}</small>
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
        <button type="button" className="primary" onClick={save}>저장</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function ShellSettings({ onBack }: { onBack: () => void }) {
  const { dispatch } = useAppState();
  const [selected, setSelected] = useState("auto");
  const [options, setOptions] = useState<Array<{ value: string; label: string; description?: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void readShellSettings()
      .then((data) => {
        setSelected(data.shell || "auto");
        setOptions(Array.isArray((data as { options?: typeof options }).options) ? (data as { options?: typeof options }).options || [] : []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  async function save(shell: string) {
    setError("");
    try {
      const data = await changeShellPreference(shell);
      setSelected(data.shell || shell);
      dispatch({ type: "set_app_settings", value: { shell: (data.shell || shell) as AppSettings["shell"] } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const rows = options.length ? options : [
    { value: "auto", label: "자동", description: "PowerShell을 우선 사용합니다." },
    { value: "powershell", label: "PowerShell", description: "pwsh 또는 Windows PowerShell을 사용합니다." },
    { value: "git-bash", label: "Git Bash", description: "Git for Windows의 bash.exe를 사용합니다." },
    { value: "cmd", label: "cmd", description: "cmd.exe를 사용합니다." },
  ];

  return (
    <>
      <SettingsHeader title="명령어 셀">터미널 명령을 실행할 셸을 선택합니다.</SettingsHeader>
      <div className="scope-segmented-control shell-mode-list" role="radiogroup" aria-label="명령어 셀">
        {rows.map((option) => (
          <button className={`scope-mode-option${selected === option.value ? " active" : ""}`} type="button" role="radio" aria-checked={selected === option.value} key={option.value} onClick={() => void save(option.value)}>
            <span className="scope-mode-marker" />
            <span className="scope-mode-copy">
              <strong>{option.label}</strong>
              <small>{option.description || option.value}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function formatStatsDate(value: unknown) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "-";
  const date = new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1));
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function StatsMetric({ label, value, helper = "" }: { label: string; value: string; helper?: string }) {
  return (
    <div className="user-stats-metric">
      <strong>{value}</strong>
      <span>{label}</span>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

function UserStatsSettings({ onBack }: { onBack: () => void }) {
  const { state } = useAppState();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void readUserStats({ clientId: state.clientId, workspaceName: state.workspaceName, workspacePath: state.workspacePath })
      .then(setStats)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [state.clientId, state.workspaceName, state.workspacePath]);

  return (
    <>
      <SettingsHeader title="IP별 사용 통계">웹 접속 기록을 IP별로 집계합니다. IP가 바뀌면 각각 별도 항목으로 표시됩니다.</SettingsHeader>
      {!stats && !error ? <p className="settings-helper">통계를 불러오는 중입니다...</p> : null}
      {stats ? (
        <>
          <div className="user-stats-grid">
            <StatsMetric label="오늘 DAU" value={formatNumber(stats.dailyActiveIpCount)} helper="오늘 접속한 고유 IP" />
            <StatsMetric label="오늘 접속횟수" value={formatNumber(stats.todayVisitCount)} helper="새로고침 포함 페이지 진입" />
            <StatsMetric label="누적 접속횟수" value={formatNumber(stats.totalVisitCount)} helper="서버에 기록된 전체 진입" />
            <StatsMetric label="내 현재 IP" value={stats.viewerIp || "-"} helper={`${formatNumber(stats.currentIpTodayVisitCount)} visits today`} />
            <StatsMetric label="저장된 대화" value={formatNumber(stats.conversationCount)} helper="전체 프로젝트 기준" />
            <StatsMetric label="활성 세션" value={formatNumber(stats.activeSessionCount)} helper={`현재 IP: ${formatNumber(stats.activeIpSessionCount)}`} />
          </div>
          <div className="user-stats-current">
            <StatsMetric label="현재 프로젝트 대화" value={formatNumber(stats.currentWorkspaceConversationCount)} helper={stats.currentWorkspaceName || state.workspaceName || "현재 프로젝트"} />
          </div>
          <div className="user-stats-breakdown">
            <h3>IP별 접속</h3>
            <div className="user-stats-workspace-list">
              {(stats.ipBreakdown || []).slice(0, 12).map((item) => (
                <div className="user-stats-workspace-row" key={`${item.ip}-${item.lastSeenAt}`}>
                  <strong>{item.ip || "-"}</strong>
                  <small>{`${formatNumber(item.visitCount)} visits / today ${formatNumber(item.todayVisitCount)} / active sessions ${formatNumber(item.activeSessionCount)}`}</small>
                  <span>{formatStatsDate(item.lastSeenAt)}</span>
                </div>
              ))}
              {!(stats.ipBreakdown || []).length ? <p className="settings-helper">아직 기록된 접속이 없습니다.</p> : null}
            </div>
          </div>
          <div className="user-stats-breakdown">
            <h3>일자별 DAU</h3>
            <div className="user-stats-workspace-list">
              {(stats.dailyBreakdown || []).slice(0, 14).map((item) => (
                <div className="user-stats-workspace-row" key={item.date || "date"}>
                  <strong>{item.date || "-"}</strong>
                  <small>{`${formatNumber(item.activeIpCount)} active IPs`}</small>
                  <span>{`${formatNumber(item.visitCount)} visits`}</span>
                </div>
              ))}
              {!(stats.dailyBreakdown || []).length ? <p className="settings-helper">아직 일자별 기록이 없습니다.</p> : null}
            </div>
          </div>
        </>
      ) : null}
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function RestartSessionSettings({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { state, dispatch } = useAppState();
  const [error, setError] = useState("");
  const [restarting, setRestarting] = useState(false);

  async function restart() {
    setError("");
    setRestarting(true);
    try {
      const session = await restartSession({
        sessionId: state.sessionId,
        clientId: state.clientId,
        cwd: state.workspacePath,
        systemPrompt: state.systemPrompt.trim() || undefined,
      });
      dispatch({ type: "session_replaced", sessionId: session.sessionId, workspace: session.workspace });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRestarting(false);
    }
  }

  return (
    <>
      <SettingsHeader title="터미널 세션 재시작">현재 터미널 세션을 강제로 종료하고 같은 작업공간에서 새 세션을 시작합니다.</SettingsHeader>
      <p className="settings-helper">{state.sessionId ? `현재 세션: ${state.sessionId}` : "현재 연결된 세션이 없어 새 세션을 시작합니다."}</p>
      <div className="modal-actions">
        <button type="button" onClick={onBack} disabled={restarting}>취소</button>
        <button type="button" className="primary" onClick={() => void restart()} disabled={restarting}>{restarting ? "재시작 중..." : "재시작"}</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function YoloSettings({ onBack }: { onBack: () => void }) {
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void readYoloModeSettings()
      .then((data) => setEnabled(data.enabled !== false))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  async function save(value: boolean) {
    setError("");
    try {
      const data = await changeYoloMode(value);
      setEnabled(data.enabled !== false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <SettingsHeader title="Yolo 모드">권한 확인 질문을 줄이고 자동 실행을 허용할지 선택합니다.</SettingsHeader>
      <div className="scope-segmented-control yolo-mode-list" role="radiogroup" aria-label="Yolo 모드">
        <button className={`scope-mode-option${enabled ? " active" : ""}`} type="button" role="radio" aria-checked={enabled} onClick={() => void save(true)}>
          <span className="scope-mode-marker" />
          <span className="scope-mode-copy"><strong>켜짐</strong><small>새 세션을 full_auto 권한 모드로 시작합니다.</small></span>
        </button>
        <button className={`scope-mode-option${!enabled ? " active" : ""}`} type="button" role="radio" aria-checked={!enabled} onClick={() => void save(false)}>
          <span className="scope-mode-marker" />
          <span className="scope-mode-copy"><strong>꺼짐</strong><small>기본 권한 확인 흐름을 사용합니다.</small></span>
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function WorkspaceScopeSettings({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<"shared" | "ip">("shared");
  const [error, setError] = useState("");

  useEffect(() => {
    void readWorkspaceScopeSettings()
      .then((data) => setMode(data.mode === "ip" ? "ip" : "shared"))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  async function save(value: "shared" | "ip") {
    setError("");
    try {
      const data = await changeWorkspaceScope(value);
      setMode(data.mode === "ip" ? "ip" : "shared");
      onClose();
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <SettingsHeader title="작업공간 범위">프로젝트와 대화 기록을 공유할지 접속 IP별로 나눌지 정합니다.</SettingsHeader>
      <div className="scope-segmented-control workspace-scope-mode-list" role="radiogroup" aria-label="작업공간 범위">
        <button className={`scope-mode-option${mode === "shared" ? " active" : ""}`} type="button" role="radio" aria-checked={mode === "shared"} onClick={() => void save("shared")}>
          <span className="scope-mode-marker" />
          <span className="scope-mode-copy"><strong>Shared</strong><small>모든 접속자가 같은 프로젝트와 기록을 봅니다.</small></span>
        </button>
        <button className={`scope-mode-option${mode === "ip" ? " active" : ""}`} type="button" role="radio" aria-checked={mode === "ip"} onClick={() => void save("ip")}>
          <span className="scope-mode-marker" />
          <span className="scope-mode-copy"><strong>IP별</strong><small>접속 IP마다 별도 프로젝트와 기록을 봅니다.</small></span>
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function LearnedSkillsSettings({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"use" | "hide" | "off">("hide");
  const [error, setError] = useState("");

  useEffect(() => {
    void readLearnedSkillsSettings()
      .then((data) => setMode(data.mode === "use" || data.mode === "off" ? data.mode : "hide"))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  async function save(value: "use" | "hide" | "off") {
    setError("");
    try {
      const data = await changeLearnedSkillsMode(value);
      setMode(data.mode === "use" || data.mode === "off" ? data.mode : "hide");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <SettingsHeader title="자동학습 스킬 표시">학습된 스킬을 프롬프트 추천에 어떻게 반영할지 선택합니다.</SettingsHeader>
      <div className="scope-segmented-control learned-skill-mode-list" role="radiogroup" aria-label="자동학습 스킬 표시">
        {[
          ["use", "표시", "추천 목록에 표시하고 사용할 수 있게 둡니다."],
          ["hide", "숨김", "기본 추천 목록에서는 숨깁니다."],
          ["off", "끄기", "자동학습 스킬 사용을 끕니다."],
        ].map(([value, label, description]) => (
          <button className={`scope-mode-option${mode === value ? " active" : ""}`} type="button" role="radio" aria-checked={mode === value} key={value} onClick={() => void save(value as "use" | "hide" | "off")}>
            <span className="scope-mode-marker" />
            <span className="scope-mode-copy"><strong>{label}</strong><small>{description}</small></span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}

function PgptSettingsForm({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<PgptSettings>({});
  const [apiKey, setApiKey] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [companyCode, setCompanyCode] = useState("30");
  const [error, setError] = useState("");

  useEffect(() => {
    void readPgptSettings()
      .then((data) => {
        setSettings(data);
        setEmployeeNo(data.employeeNo || "");
        setCompanyCode(data.companyCode || "30");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  async function save() {
    setError("");
    try {
      const data = await savePgptSettings({ apiKey, employeeNo, companyCode });
      setSettings(data);
      setApiKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <SettingsHeader title="P-GPT API KEY">P-GPT OpenAI-compatible 연결에 필요한 값을 저장합니다.</SettingsHeader>
      <div className="setting-field">
        <label className="setting-field-label" htmlFor="pgptApiKey">API Key</label>
        <input id="pgptApiKey" type="password" value={apiKey} placeholder={settings.apiKeyConfigured ? settings.apiKeyMasked || "저장됨" : "00000000-0000-0000-0000-000000000000"} autoComplete="off" onChange={(event) => setApiKey(event.currentTarget.value)} />
        <small>비워두고 저장하면 기존 API Key는 유지됩니다.</small>
      </div>
      <div className="setting-field">
        <label className="setting-field-label" htmlFor="pgptEmployeeNo">직원번호</label>
        <input id="pgptEmployeeNo" type="text" value={employeeNo} placeholder="600000" onChange={(event) => setEmployeeNo(event.currentTarget.value)} />
      </div>
      <div className="setting-field">
        <label className="setting-field-label" htmlFor="pgptCompanyCode">회사번호</label>
        <input id="pgptCompanyCode" type="text" value={companyCode} placeholder="30" onChange={(event) => setCompanyCode(event.currentTarget.value)} />
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onBack}>뒤로</button>
        <button type="button" className="primary" onClick={() => void save()}>저장</button>
      </div>
      <p className="workspace-error">{error}</p>
    </>
  );
}
