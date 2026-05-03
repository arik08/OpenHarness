import { useEffect } from "react";
import { listProjectFiles } from "../api/artifacts";
import { listHistory } from "../api/history";
import { listLiveSessions } from "../api/session";
import { listWorkspaces } from "../api/workspaces";
import { useAppState } from "../state/app-state";
import type { HistoryItem, LiveSessionItem } from "../types/backend";

function mergeLiveSessions(history: HistoryItem[], sessions: LiveSessionItem[], currentSessionId: string | null): HistoryItem[] {
  const historyByValue = new Map<string, HistoryItem>();
  for (const item of history) {
    if (item.value) {
      historyByValue.set(item.value, item);
    }
  }
  const mergedHistory = history.map((item) => ({ ...item }));
  const seen = new Set(historyByValue.keys());
  const liveItems: HistoryItem[] = [];
  for (const session of sessions) {
    if (session.sessionId === currentSessionId) {
      continue;
    }
    const value = session.savedSessionId || session.sessionId;
    if (!value) {
      continue;
    }
    const savedItemIndex = session.savedSessionId
      ? mergedHistory.findIndex((item) => item.value === session.savedSessionId)
      : -1;
    if (savedItemIndex >= 0) {
      mergedHistory[savedItemIndex] = {
        ...mergedHistory[savedItemIndex],
        workspace: mergedHistory[savedItemIndex].workspace || session.workspace || null,
        live: true,
        liveSessionId: session.sessionId,
        busy: session.busy,
      };
      seen.add(value);
      continue;
    }
    if (!session.busy && !String(session.title || "").trim()) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    liveItems.push({
      value,
      label: "진행 중인 채팅",
      description: session.title || (session.busy ? "진행 중인 응답" : "열려 있는 세션"),
      workspace: session.workspace || null,
      live: true,
      liveSessionId: session.sessionId,
      busy: session.busy,
    });
  }
  return [...liveItems, ...mergedHistory];
}

export function useWorkspaceData() {
  const { state, dispatch } = useAppState();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await listWorkspaces();
      if (cancelled) return;
      dispatch({ type: "set_workspaces", workspaces: data.workspaces, scope: data.scope });
      if (!state.workspaceName) {
        const selected = data.workspaces.find((workspace) => workspace.name === "Default") || data.workspaces[0];
        if (selected) {
          dispatch({ type: "set_workspace", workspace: selected });
        }
      }
    }

    void load().catch((error) => {
      dispatch({ type: "open_modal", modal: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch, state.workspaceName]);

  useEffect(() => {
    let cancelled = false;
    if (!state.workspaceName && !state.workspacePath) {
      return () => {
        cancelled = true;
      };
    }

    dispatch({ type: "set_history_loading", value: true });
    void Promise.all([
      listHistory({ workspacePath: state.workspacePath, workspaceName: state.workspaceName }),
      state.clientId
        ? listLiveSessions({
          clientId: state.clientId,
          workspacePath: state.workspacePath || undefined,
        })
        : Promise.resolve({ sessions: [] }),
    ])
      .then(([data, liveData]) => {
        if (!cancelled) {
          const history = Array.isArray(data.options) ? data.options : [];
          const liveSessions = Array.isArray(liveData.sessions) ? liveData.sessions : [];
          dispatch({ type: "set_history", history: mergeLiveSessions(history, liveSessions, state.sessionId) });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          dispatch({ type: "set_history", history: [] });
          dispatch({ type: "open_modal", modal: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, state.clientId, state.historyRefreshKey, state.sessionId, state.workspaceName, state.workspacePath]);

  useEffect(() => {
    let cancelled = false;
    if (!state.clientId || (!state.sessionId && !state.workspacePath && !state.workspaceName)) {
      return () => {
        cancelled = true;
      };
    }

    const request = listProjectFiles({
      sessionId: state.sessionId || undefined,
      clientId: state.clientId,
      workspacePath: state.workspacePath,
      workspaceName: state.workspaceName,
    });

    void request
      .then((data) => {
        if (!cancelled) {
          dispatch({ type: "set_artifacts", artifacts: Array.isArray(data.files) ? data.files : [] });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "set_artifacts", artifacts: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, state.artifactRefreshKey, state.clientId, state.sessionId, state.workspaceName, state.workspacePath]);
}
