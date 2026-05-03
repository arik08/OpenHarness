import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useAppState } from "../state/app-state";
import { deleteHistory, updateHistoryTitle } from "../api/history";
import { listLiveSessions, restartSession, shutdownSession, startSession } from "../api/session";
import { sendBackendRequest, sendMessage } from "../api/messages";
import type { HistoryItem, Workspace } from "../types/backend";
import type { RuntimePickerOption } from "../types/ui";
import type { ThemeId } from "../types/ui";

const themeOptions: Array<{ id: ThemeId; label: string }> = [
  { id: "light", label: "Claude" },
  { id: "posco", label: "POSCO" },
  { id: "dark", label: "Dark-Blue" },
  { id: "mono", label: "MonoChrome-Green" },
  { id: "mono-orange", label: "MonoChrome-Orange" },
];

const historyTitleMaxLength = 26;

export function Sidebar() {
  const { state, dispatch } = useAppState();
  const runtimePickerRef = useRef<HTMLDivElement | null>(null);
  const runtimeFooterRef = useRef<HTMLButtonElement | null>(null);
  const runtimePickerLockedTopRef = useRef<number | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [editingHistoryId, setEditingHistoryId] = useState("");
  const [editingHistoryTitle, setEditingHistoryTitle] = useState("");
  const [deletingHistoryId, setDeletingHistoryId] = useState("");
  const [runtimePickerGeometry, setRuntimePickerGeometry] = useState<RuntimePickerGeometry>({
    left: null,
    top: null,
    panelMaxHeight: null,
  });

  async function startFreshChat(workspace?: Workspace) {
    const nextWorkspace = workspace || (state.workspacePath ? { name: state.workspaceName, path: state.workspacePath } : undefined);
    try {
      if (state.busy || !state.sessionId) {
        const session = await startSession({
          clientId: state.clientId,
          cwd: nextWorkspace?.path || undefined,
        });
        dispatch({ type: "session_replaced", sessionId: session.sessionId, workspace: session.workspace || nextWorkspace });
        return;
      }
      const session = await restartSession({
        sessionId: state.sessionId,
        clientId: state.clientId,
        cwd: nextWorkspace?.path || undefined,
      });
      dispatch({ type: "session_replaced", sessionId: session.sessionId, workspace: session.workspace || nextWorkspace });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function switchWorkspace(path: string) {
    const workspace = state.workspaces.find((item) => item.path === path);
    if (!workspace) return;
    dispatch({ type: "set_workspace", workspace });
    localStorage.setItem("myharness:workspaceName", workspace.name);
    setWorkspaceDropdownOpen(false);
    await startFreshChat(workspace);
  }

  async function openHistory(sessionId: string, label: string) {
    if (!state.sessionId) {
      return;
    }
    window.dispatchEvent(new Event("myharness:saveMessageScroll"));
    dispatch({ type: "begin_history_restore", sessionId });
    dispatch({ type: "clear_messages" });
    dispatch({ type: "set_busy", value: true });
    dispatch({
      type: "backend_event",
      event: { type: "transcript_item", item: { role: "system", text: `히스토리 복원 중: ${label}` } },
    });
    try {
      let targetSessionId = state.sessionId;
      const liveSessions = await listLiveSessions({
        clientId: state.clientId,
        workspacePath: state.workspacePath || undefined,
      });
      const liveSession = liveSessions.sessions.find((item) => (
        item.savedSessionId === sessionId || item.sessionId === sessionId
      ));
      if (liveSession) {
        dispatch({
          type: "session_started",
          sessionId: liveSession.sessionId,
          clientId: state.clientId,
        });
        dispatch({ type: "clear_messages" });
        if (liveSession.workspace) {
          dispatch({ type: "set_workspace", workspace: liveSession.workspace });
        }
        dispatch({ type: "set_busy", value: liveSession.busy });
        dispatch({ type: "finish_history_restore" });
        return;
      }
      if (state.busy) {
        const session = await startSession({
          clientId: state.clientId,
          cwd: state.workspacePath || undefined,
        });
        targetSessionId = session.sessionId;
        dispatch({
          type: "session_started",
          sessionId: session.sessionId,
          clientId: state.clientId,
        });
        if (session.workspace) {
          dispatch({ type: "set_workspace", workspace: session.workspace });
        }
      }
      await sendBackendRequest(targetSessionId, state.clientId, {
        type: "apply_select_command",
        command: "resume",
        value: sessionId,
      });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
      dispatch({ type: "set_busy", value: false });
      dispatch({ type: "finish_history_restore" });
    }
  }

  async function removeHistory(item: HistoryItem) {
    const sessionId = item.value;
    if (!sessionId) return;
    setDeletingHistoryId(sessionId);
    try {
      if (item.live && item.liveSessionId) {
        await shutdownSession(item.liveSessionId, state.clientId);
      } else {
        const workspace = item.workspace || null;
        await deleteHistory(
          sessionId,
          workspace?.path || state.workspacePath,
          workspace?.name || state.workspaceName,
        );
      }
      dispatch({ type: "set_history", history: state.history.filter((item) => item.value !== sessionId) });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setDeletingHistoryId("");
    }
  }

  async function renameHistory(sessionId: string) {
    const title = editingHistoryTitle.trim();
    if (!sessionId || !title) {
      setEditingHistoryId("");
      setEditingHistoryTitle("");
      return;
    }
    try {
      const data = await updateHistoryTitle(sessionId, title, state.workspacePath, state.workspaceName);
      dispatch({
        type: "set_history",
        history: state.history.map((item) =>
          item.value === sessionId ? { ...item, description: data.title || title } : item,
        ),
      });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setEditingHistoryId("");
      setEditingHistoryTitle("");
    }
  }

  function startHistoryRename(sessionId: string, title: string) {
    setEditingHistoryId(sessionId);
    setEditingHistoryTitle(title);
  }

  function cycleTheme() {
    const currentIndex = Math.max(0, themeOptions.findIndex((item) => item.id === state.themeId));
    const next = themeOptions[(currentIndex + 1) % themeOptions.length];
    dispatch({ type: "set_theme", themeId: next.id });
  }

  async function runCommand(command: string) {
    if (!state.sessionId) return;
    dispatch({ type: "set_busy", value: true });
    try {
      await sendMessage({ sessionId: state.sessionId, clientId: state.clientId, line: command, attachments: [] });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
      dispatch({ type: "set_busy", value: false });
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function toggleRuntimePicker() {
    if (state.runtimePicker.open) {
      dispatch({ type: "close_runtime_picker" });
      return;
    }
    dispatch({ type: "open_runtime_picker" });
    if (!state.sessionId) {
      dispatch({ type: "set_runtime_picker_error", message: "세션이 준비되면 선택할 수 있습니다." });
      return;
    }
    if (state.busy) {
      dispatch({ type: "set_runtime_picker_error", message: "응답이 끝난 뒤 선택할 수 있습니다." });
      return;
    }
    try {
      await sendBackendRequest(state.sessionId, state.clientId, { type: "select_command", command: "runtime-picker" });
    } catch (error) {
      dispatch({
        type: "set_runtime_picker_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function applyRuntimeChoice(command: "provider" | "model" | "effort", option: RuntimePickerOption) {
    if (!state.sessionId || state.busy) return;
    if (command === "provider") {
      dispatch({ type: "select_runtime_provider", value: option.value });
    } else if (command === "model") {
      dispatch({ type: "select_runtime_model", value: option.value });
    } else {
      dispatch({ type: "select_runtime_effort", value: option.value });
    }
    try {
      await sendBackendRequest(state.sessionId, state.clientId, {
        type: "apply_select_command",
        command,
        value: option.value,
      });
    } catch (error) {
      dispatch({
        type: "set_runtime_picker_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    if (!state.runtimePicker.open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && (runtimePickerRef.current?.contains(target) || runtimeFooterRef.current?.contains(target))) {
        return;
      }
      dispatch({ type: "close_runtime_picker" });
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dispatch({ type: "close_runtime_picker" });
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dispatch, state.runtimePicker.open]);

  useLayoutEffect(() => {
    if (!state.runtimePicker.open) {
      runtimePickerLockedTopRef.current = null;
      setRuntimePickerGeometry({ left: null, top: null, panelMaxHeight: null });
      return;
    }

    function runtimePickerNaturalPanelHeight(panel: Element | null) {
      if (!(panel instanceof HTMLElement)) {
        return 0;
      }
      const header = panel.querySelector(".runtime-picker-header");
      const list = panel.querySelector(".runtime-picker-list");
      const styles = getComputedStyle(panel);
      const borderY = parseFloat(styles.borderTopWidth || "0") + parseFloat(styles.borderBottomWidth || "0");
      return (
        (header instanceof HTMLElement ? header.offsetHeight : 0)
        + (list instanceof HTMLElement ? list.scrollHeight : 0)
        + borderY
      );
    }

    function positionRuntimePicker() {
      const root = runtimePickerRef.current;
      const anchor = runtimeFooterRef.current;
      if (!root || !anchor) return;

      const rect = anchor.getBoundingClientRect();
      const gap = 8;
      const viewportPad = 8;
      const bottomLimit = Math.max(viewportPad, rect.top - gap);
      const providerPanel = root.querySelector(".runtime-picker-provider-panel");

      if (runtimePickerLockedTopRef.current === null) {
        const providerHeight = Math.min(
          Math.max(96, bottomLimit - viewportPad),
          Math.max(
            96,
            pickerHasProviderContent(state.runtimePicker)
              ? runtimePickerNaturalPanelHeight(providerPanel)
              : providerPanel instanceof HTMLElement
                ? providerPanel.scrollHeight || providerPanel.offsetHeight || root.offsetHeight
                : root.offsetHeight,
          ),
        );
        const candidateTop = Math.max(viewportPad, bottomLimit - providerHeight);
        if (pickerHasProviderContent(state.runtimePicker)) {
          runtimePickerLockedTopRef.current = candidateTop;
        }
      }

      const top = Math.max(
        viewportPad,
        runtimePickerLockedTopRef.current ?? Math.max(viewportPad, bottomLimit - Math.max(96, root.offsetHeight)),
      );
      const panelMaxHeight = Math.max(96, Math.min(360, bottomLimit - top));
      const left = Math.max(8, rect.left + 4);

      setRuntimePickerGeometry((current) => {
        if (current.left === left && current.top === top && current.panelMaxHeight === panelMaxHeight) {
          return current;
        }
        return { left, top, panelMaxHeight };
      });
    }

    positionRuntimePicker();
    const frame = window.requestAnimationFrame(positionRuntimePicker);
    window.addEventListener("resize", positionRuntimePicker);
    window.addEventListener("scroll", positionRuntimePicker, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionRuntimePicker);
      window.removeEventListener("scroll", positionRuntimePicker, true);
    };
  }, [
    state.runtimePicker.error,
    state.runtimePicker.loading,
    state.runtimePicker.open,
    state.runtimePicker.modelOpen,
    state.runtimePicker.effortOpen,
    state.runtimePicker.providers,
    state.runtimePicker.models,
    state.runtimePicker.efforts,
  ]);

  useEffect(() => {
    if (!workspaceDropdownOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && projectMenuRef.current?.contains(target)) {
        return;
      }
      setWorkspaceDropdownOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setWorkspaceDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [workspaceDropdownOpen]);

  const currentTheme = themeOptions.find((item) => item.id === state.themeId) || themeOptions[0];
  const sidebarLabel = state.sidebarCollapsed ? "사이드바 열기" : "사이드바 닫기";
  const activeHistoryValue = state.activeHistoryId || state.sessionId || "";
  const visibleHistory = state.history.filter((item) => !isCurrentLiveHistoryItem(item, state.sessionId));
  const hasActiveHistoryItem = Boolean(activeHistoryValue && visibleHistory.some((item) => isActiveHistoryItem(item, activeHistoryValue, state.sessionId)));
  const renderedHistory = state.busy && activeHistoryValue && !hasActiveHistoryItem
    ? [
        {
          value: activeHistoryValue,
          label: "진행 중",
          description: state.chatTitle && state.chatTitle !== "MyHarness" ? state.chatTitle : "진행 중인 대화",
          workspace: state.workspacePath || state.workspaceName
            ? { name: state.workspaceName, path: state.workspacePath }
            : null,
        },
        ...visibleHistory,
      ]
    : visibleHistory;

  return (
    <aside
      className="sidebar"
      aria-label="채팅 탐색"
      onClick={() => {
        if (state.sidebarCollapsed) {
          dispatch({ type: "set_sidebar_collapsed", value: false });
        }
      }}
    >
      <div className="brand-row">
        <a className="brand" href="#" aria-label="MyHarness 채팅 홈">
          <span className="brand-name">MyHarness</span>
        </a>
        <button className="fullscreen-command" type="button" aria-label="브라우저 전체화면" data-tooltip="브라우저 전체화면" onClick={() => void toggleFullscreen()}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 8h18" />
            <path d="M8 13H6v-2" />
            <path d="M16 13h2v-2" />
            <path d="M8 15H6v2" />
            <path d="M16 15h2v2" />
          </svg>
        </button>
        <button className="settings-command" type="button" aria-label="설정" data-tooltip="설정" onClick={() => dispatch({ type: "open_modal", modal: { kind: "settings" } })}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.15 2.15 0 0 1-3.04 3.04l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21.4a2.15 2.15 0 0 1-4.3 0v-.06a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.04.04a2.15 2.15 0 1 1-3.04-3.04l.04-.04A1.8 1.8 0 0 0 3.6 15a1.8 1.8 0 0 0-1.66-1.1H1.9a2.15 2.15 0 0 1 0-4.3h.06A1.8 1.8 0 0 0 3.6 8a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.15 2.15 0 1 1 3.04-3.04l.04.04A1.8 1.8 0 0 0 8.26 3.34 1.8 1.8 0 0 0 9.36 1.68V1.6a2.15 2.15 0 0 1 4.3 0v.06a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.15 2.15 0 1 1 3.04 3.04l-.04.04A1.8 1.8 0 0 0 19.4 8a1.8 1.8 0 0 0 1.66 1.1h.06a2.15 2.15 0 0 1 0 4.3h-.06A1.8 1.8 0 0 0 19.4 15Z" />
          </svg>
        </button>
        <button
          className="theme-command"
          type="button"
          aria-label={`테마 전환: ${currentTheme.label}`}
          data-tooltip={`테마: ${currentTheme.label}`}
          onClick={cycleTheme}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 3v2.2" />
            <path d="M12 18.8V21" />
            <path d="M4.2 4.2l1.55 1.55" />
            <path d="M18.25 18.25l1.55 1.55" />
            <path d="M3 12h2.2" />
            <path d="M18.8 12H21" />
            <path d="M4.2 19.8l1.55-1.55" />
            <path d="M18.25 5.75l1.55-1.55" />
            <circle cx="12" cy="12" r="4.25" />
          </svg>
        </button>
        <button className="brand-command" type="button" aria-label="명령어" data-tooltip="명령어" onClick={() => void runCommand("/help")}>
          <span className="command-key" aria-hidden="true">/</span>
        </button>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarLabel}
          aria-expanded={!state.sidebarCollapsed}
          data-tooltip={sidebarLabel}
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "set_sidebar_collapsed", value: !state.sidebarCollapsed });
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      </div>

      <div className="sidebar-project-menu" ref={projectMenuRef}>
        <button
          className="sidebar-project"
          type="button"
          aria-label="프로젝트 선택"
          aria-expanded={workspaceDropdownOpen}
          data-tooltip="프로젝트 폴더 선택"
          onClick={() => setWorkspaceDropdownOpen((value) => !value)}
        >
          <span className="sidebar-project-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" />
            </svg>
          </span>
          <strong>{state.workspaceName || "Default"}</strong>
          <svg className="sidebar-project-chevron" aria-hidden="true" viewBox="0 0 24 24">
            <path d="m7 10 5 5 5-5" />
          </svg>
        </button>
        <div
          className={`sidebar-project-dropdown${workspaceDropdownOpen ? "" : " hidden"}`}
          role="menu"
          aria-label="Project list"
        >
          {state.workspaces.length ? state.workspaces.map((workspace) => (
            <button
              className={`sidebar-project-option${workspace.path === state.workspacePath ? " active" : ""}`}
              type="button"
              role="menuitem"
              key={workspace.path}
              onClick={() => void switchWorkspace(workspace.path)}
            >
              {workspace.name}
            </button>
          )) : <p className="sidebar-project-empty">프로젝트 폴더가 없습니다.</p>}
          <button
            className="sidebar-project-manage"
            type="button"
            role="menuitem"
            onClick={() => {
              setWorkspaceDropdownOpen(false);
              dispatch({ type: "open_modal", modal: { kind: "workspace" } });
            }}
          >
            프로젝트 추가/관리
          </button>
        </div>
      </div>

      <button className="new-chat" type="button" aria-label="새 채팅" data-tooltip="새 채팅" onClick={() => void startFreshChat()}>
        <span aria-hidden="true" />
        새 채팅
      </button>

      <section className="history-panel" aria-label="Chat History">
        <div className="history-heading">
          <span className="section-label">Chat History</span>
          <button className="history-refresh" type="button" onClick={() => void startFreshChat()}>
            Restart
          </button>
        </div>
        <div className="history-list" aria-busy={state.historyLoading ? "true" : "false"}>
          {state.historyLoading && !renderedHistory.length ? (
            <p className="empty">대화 내역을 불러오는 중...</p>
          ) : renderedHistory.length ? (
            renderedHistory.slice(0, 20).map((item) => {
              const label = item.description || item.label;
              const displayLabel = formatHistoryTitle(label);
              const detailLabel = item.description ? compactHistoryTitle(item.label) : "";
              const editing = editingHistoryId === item.value;
              const isActive = isActiveHistoryItem(item, activeHistoryValue, state.sessionId);
              const isBusy = (isActive && state.busy) || (item.live === true && item.busy === true);
              const isDeleting = deletingHistoryId === item.value;
              return (
                <div
                  className={`history-item${isActive ? " active" : ""}${isBusy ? " busy" : ""}${isDeleting ? " deleting" : ""}`}
                  key={item.value}
                >
                  {editing ? (
                    <form
                      className="history-title-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameHistory(item.value);
                      }}
                    >
                      <input
                        value={editingHistoryTitle}
                        aria-label="대화 제목"
                        autoFocus
                        onChange={(event) => setEditingHistoryTitle(event.currentTarget.value)}
                        onBlur={() => void renameHistory(item.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setEditingHistoryId("");
                            setEditingHistoryTitle("");
                          }
                        }}
                      />
                    </form>
                  ) : (
                    <button
                      className="history-open"
                      type="button"
                      onClick={() => void openHistory(item.value, label)}
                      onDoubleClick={() => startHistoryRename(item.value, label)}
                    >
                      <span className="history-title">{displayLabel}</span>
                      {detailLabel ? <small>{detailLabel}</small> : null}
                    </button>
                  )}
                  <span className="history-busy-spinner" aria-hidden="true" />
                  <button
                    className="history-delete"
                    type="button"
                    aria-label={`${label} 삭제`}
                    data-tooltip="기록 삭제"
                    disabled={isBusy || isDeleting}
                    onClick={() => void removeHistory(item)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M4 7h16" />
                      <path d="M6 7l1 14h10l1-14" />
                      <path d="M9 7V4h6v3" />
                    </svg>
                  </button>
                </div>
              );
            })
          ) : (
            <p className="empty">저장된 세션이 아직 없습니다.</p>
          )}
        </div>
      </section>

      {state.runtimePicker.open ? (
        <RuntimePicker
          refNode={runtimePickerRef}
          picker={state.runtimePicker}
          providerLabel={state.providerLabel || state.provider}
          model={state.model}
          effort={state.effort}
          busy={state.busy}
          geometry={runtimePickerGeometry}
          onApply={applyRuntimeChoice}
        />
      ) : null}

      <button
        ref={runtimeFooterRef}
        className="sidebar-footer"
        type="button"
        aria-label="런타임 설정 열기"
        aria-expanded={state.runtimePicker.open}
        data-tooltip="Provider, 모델, 추론 강도"
        onClick={() => void toggleRuntimePicker()}
      >
        <span className="profile-mark" aria-hidden="true">
          MH
        </span>
        <div className="runtime-copy">
          <strong>Provider: {state.providerLabel || state.provider}</strong>
          <small>Model: {state.model} · Effort: {state.effort || "none"}</small>
        </div>
      </button>
    </aside>
  );
}

function formatHistoryTitle(label: string) {
  const withoutPrefix = String(label || "")
    .replace(/^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+\d+\s*msg\s*/i, "")
    .replace(/^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s*/i, "")
    .trim();
  return compactHistoryTitle(withoutPrefix || "저장된 대화");
}

function compactHistoryTitle(title: string) {
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= historyTitleMaxLength) {
    return normalized;
  }
  return `${normalized.slice(0, historyTitleMaxLength).trimEnd()}...`;
}

function RuntimePicker({
  refNode,
  picker,
  providerLabel,
  model,
  effort,
  busy,
  geometry,
  onApply,
}: {
  refNode: RefObject<HTMLDivElement | null>;
  picker: ReturnType<typeof useAppState>["state"]["runtimePicker"];
  providerLabel: string;
  model: string;
  effort: string;
  busy: boolean;
  geometry: RuntimePickerGeometry;
  onApply: (command: "provider" | "model" | "effort", option: RuntimePickerOption) => Promise<void>;
}) {
  const style: RuntimePickerStyle = {};
  if (geometry.left !== null) {
    style.left = geometry.left;
  }
  if (geometry.top !== null) {
    style.top = geometry.top;
    style.bottom = "auto";
  }
  if (geometry.panelMaxHeight !== null) {
    style["--runtime-picker-panel-max-height"] = `${geometry.panelMaxHeight}px`;
  }

  return (
    <div className="runtime-picker-layer react-runtime-picker" data-runtime-picker="true" ref={refNode} style={style}>
      <RuntimePanel title="Provider" value={providerLabel} className="runtime-picker-provider-panel">
        {picker.error ? <p className="runtime-picker-empty">{picker.error}</p> : null}
        {!picker.error && picker.loading ? <p className="runtime-picker-empty">불러오는 중...</p> : null}
        {!picker.error && !picker.loading && picker.providers.map((option) => (
          <RuntimeOption
            key={option.value}
            command="provider"
            option={option}
            suffix="›"
            disabled={busy}
            onClick={() => onApply("provider", option)}
          />
        ))}
      </RuntimePanel>
      {picker.modelOpen ? (
        <RuntimePanel title="모델" value={model} className="runtime-picker-model-panel">
          {picker.models.length ? picker.models.map((option) => (
            <RuntimeOption
              key={option.value}
              command="model"
              option={option}
              suffix="›"
              disabled={busy}
              onClick={() => onApply("model", option)}
            />
          )) : <p className="runtime-picker-empty">선택 가능한 모델이 없습니다.</p>}
        </RuntimePanel>
      ) : null}
      {picker.effortOpen ? (
        <RuntimePanel title="추론 노력" value={effort || "-"} className="runtime-picker-effort-panel">
          {picker.efforts.length ? picker.efforts.map((option) => (
            <RuntimeOption
              key={option.value || option.label}
              command="effort"
              option={option}
              disabled={busy}
              onClick={() => onApply("effort", option)}
            />
          )) : <p className="runtime-picker-empty">선택 가능한 값이 없습니다.</p>}
        </RuntimePanel>
      ) : null}
    </div>
  );
}

type RuntimePickerGeometry = {
  left: number | null;
  top: number | null;
  panelMaxHeight: number | null;
};

type RuntimePickerStyle = CSSProperties & {
  "--runtime-picker-panel-max-height"?: string;
};

function pickerHasProviderContent(picker: ReturnType<typeof useAppState>["state"]["runtimePicker"]) {
  return Boolean(picker.error || (!picker.loading && picker.providers.length));
}

function isActiveHistoryItem(item: HistoryItem, activeHistoryValue: string, sessionId: string | null) {
  if (!item.value) {
    return false;
  }
  return item.value === activeHistoryValue || (!!sessionId && item.value === sessionId);
}

function isCurrentLiveHistoryItem(item: HistoryItem, sessionId: string | null) {
  if (!sessionId || item.live !== true) {
    return false;
  }
  return item.liveSessionId === sessionId || item.value === sessionId;
}

function RuntimePanel({ title, value, className = "", children }: { title: string; value: string; className?: string; children: ReactNode }) {
  return (
    <section className={`runtime-picker-panel ${className}`.trim()} aria-label={`${title} 선택`}>
      <div className="runtime-picker-header">
        <strong>{title}</strong>
        <small>{value || "-"}</small>
      </div>
      <div className="runtime-picker-list">{children}</div>
    </section>
  );
}

function RuntimeOption({
  command,
  option,
  suffix = "",
  disabled,
  onClick,
}: {
  command: "provider" | "model" | "effort";
  option: RuntimePickerOption;
  suffix?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`runtime-picker-option runtime-picker-option-${command}${option.active ? " active" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span>
        <strong>{option.label || option.value}</strong>
        {option.description ? <small>{option.description}</small> : null}
      </span>
      <span className="select-check" aria-hidden="true">{option.active ? "✓" : suffix}</span>
    </button>
  );
}
