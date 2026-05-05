import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listHistory } from "../../api/history";
import { listProjectFiles } from "../../api/artifacts";
import { listLiveSessions } from "../../api/session";
import { listWorkspaces } from "../../api/workspaces";
import { AppStateProvider, useAppState } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { useWorkspaceData } from "../useWorkspaceData";

vi.mock("../../api/artifacts", () => ({
  listProjectFiles: vi.fn(),
}));

vi.mock("../../api/history", () => ({
  listHistory: vi.fn(),
}));

vi.mock("../../api/session", () => ({
  listLiveSessions: vi.fn(),
}));

vi.mock("../../api/workspaces", () => ({
  listWorkspaces: vi.fn(),
}));

function Probe() {
  useWorkspaceData();
  const { state } = useAppState();
  return <output data-testid="history">{JSON.stringify(state.history)}</output>;
}

describe("useWorkspaceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWorkspaces).mockResolvedValue({
      root: "C:/demo",
      workspaces: [{ name: "Default", path: "C:/demo" }],
      scope: { mode: "shared", name: "shared", root: "C:/demo" },
    });
    vi.mocked(listHistory).mockResolvedValue({ options: [] });
    vi.mocked(listProjectFiles).mockResolvedValue({ files: [], scope: "default" });
    vi.mocked(listLiveSessions).mockResolvedValue({ sessions: [] });
  });

  it("merges live backend sessions into the history list", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      options: [{ value: "saved-old", label: "5/3 10:00 2 msg", description: "저장된 대화" }],
    });
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "web-live-1",
        savedSessionId: "saved-live-1",
        workspace: { name: "Default", path: "C:/demo" },
        busy: true,
        createdAt: 1,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-current",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/demo",
        }}
      >
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => {
      const history = JSON.parse(screen.getByTestId("history").textContent || "[]");
      expect(history[0]).toMatchObject({
        value: "saved-live-1",
        live: true,
        liveSessionId: "web-live-1",
        busy: true,
      });
      expect(history[1]).toMatchObject({ value: "saved-old" });
    });
  });

  it("keeps the saved title when a history item is also an open backend session", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      options: [{ value: "saved-live-1", label: "5/3 10:00 2 msg", description: "AI 최신 트렌드 웹보고서" }],
    });
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "web-live-1",
        savedSessionId: "saved-live-1",
        title: "열려 있는 세션",
        workspace: { name: "Default", path: "C:/demo" },
        busy: false,
        createdAt: 1,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-current",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/demo",
        }}
      >
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => {
      const history = JSON.parse(screen.getByTestId("history").textContent || "[]");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        value: "saved-live-1",
        description: "AI 최신 트렌드 웹보고서",
        live: true,
        liveSessionId: "web-live-1",
        busy: false,
      });
    });
  });

  it("does not add the current backend session as a deletable history row", async () => {
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "web-current",
        savedSessionId: "",
        workspace: { name: "Default", path: "C:/demo" },
        busy: false,
        createdAt: 1,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-current",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/demo",
        }}
      >
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => {
      const history = JSON.parse(screen.getByTestId("history").textContent || "[]");
      expect(history).toEqual([]);
    });
  });

  it("does not surface idle untitled placeholder sessions after switching history", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      options: [{ value: "saved-current", label: "5/4 10:00 4 msg", description: "나무위키 역사 PPTX" }],
    });
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "web-placeholder",
        savedSessionId: "placeholder-saved-id",
        title: "",
        workspace: { name: "Default", path: "C:/demo" },
        busy: false,
        createdAt: 1,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-current",
          activeHistoryId: "saved-current",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/demo",
        }}
      >
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => {
      const history = JSON.parse(screen.getByTestId("history").textContent || "[]");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ value: "saved-current", description: "나무위키 역사 PPTX" });
    });
  });

  it("keeps the visible history order stable while a saved chat is restoring", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      options: [
        { value: "session-second", label: "5/4 09:59 2 msg", description: "두 번째 대화" },
        { value: "session-top", label: "5/4 10:00 2 msg", description: "최상단 대화" },
      ],
    });
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "web-previous",
        savedSessionId: "",
        title: "이전 진행 중인 대화",
        workspace: { name: "Default", path: "C:/demo" },
        busy: true,
        createdAt: 3,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-restoring",
          activeHistoryId: "session-second",
          clientId: "client-1",
          busy: true,
          workspaceName: "Default",
          workspacePath: "C:/demo",
          history: [
            { value: "session-top", label: "5/4 10:00 2 msg", description: "최상단 대화" },
            { value: "session-second", label: "5/4 09:59 2 msg", description: "두 번째 대화" },
          ],
        }}
      >
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const history = JSON.parse(screen.getByTestId("history").textContent || "[]");
    expect(listHistory).not.toHaveBeenCalled();
    expect(listLiveSessions).not.toHaveBeenCalled();
    expect(history.map((item: { value: string }) => item.value)).toEqual(["session-top", "session-second"]);
  });
});
