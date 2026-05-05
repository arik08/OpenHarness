import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";
import { AppStateProvider, useAppState } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { deleteHistory, toggleHistoryPin } from "../../api/history";
import { listLiveSessions, restartSession, shutdownSession, startSession } from "../../api/session";
import { sendBackendRequest } from "../../api/messages";
import type { Workspace } from "../../types/backend";

vi.mock("../../api/session", () => ({
  restartSession: vi.fn(),
  shutdownSession: vi.fn(),
  startSession: vi.fn(),
  listLiveSessions: vi.fn(),
}));

vi.mock("../../api/history", () => ({
  deleteHistory: vi.fn(),
  toggleHistoryPin: vi.fn(),
  updateHistoryTitle: vi.fn(),
}));

vi.mock("../../api/messages", () => ({
  sendBackendRequest: vi.fn(),
  sendMessage: vi.fn(),
}));

function WorkspaceProbe() {
  const { state } = useAppState();
  return <output data-testid="workspace">{state.workspaceName}</output>;
}

function ChatStateProbe() {
  const { state } = useAppState();
  return (
    <>
      <output data-testid="message-count">{state.messages.length}</output>
      <output data-testid="pending-fresh-chat">{state.pendingFreshChat ? "yes" : "no"}</output>
    </>
  );
}

function DispatchProbe({ onReady }: { onReady: (dispatch: ReturnType<typeof useAppState>["dispatch"]) => void }) {
  const { dispatch } = useAppState();
  useEffect(() => {
    onReady(dispatch);
  }, [dispatch, onReady]);
  return null;
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listLiveSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(startSession).mockResolvedValue({ sessionId: "session-restored" });
    vi.mocked(shutdownSession).mockResolvedValue({ ok: true });
    vi.mocked(toggleHistoryPin).mockResolvedValue({ ok: true, pinned: true, sessionId: "session-old" });
    vi.mocked(sendBackendRequest).mockResolvedValue({ ok: true });
  });

  it("uses one right-side action slot that expands from more to delete and pin", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          history: [{ value: "session-old", label: "5/3 10:00 2 msg", description: "이전 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    const moreButton = screen.getByRole("button", { name: "이전 대화 작업 더보기" });

    expect(moreButton.getAttribute("data-tooltip")).toBe("작업 더보기");
    expect(screen.queryByRole("button", { name: "이전 대화 삭제" })).toBeNull();
    expect(screen.queryByRole("button", { name: "이전 대화 상단 고정" })).toBeNull();

    await userEvent.click(moreButton);

    const deleteButton = screen.getByRole("button", { name: "이전 대화 삭제" });
    const pinButton = screen.getByRole("button", { name: "이전 대화 상단 고정" });
    const paths = Array.from(deleteButton.querySelectorAll("path")).map((path) => path.getAttribute("d"));

    expect(deleteButton.getAttribute("data-tooltip")).toBe("기록 삭제");
    expect(pinButton.getAttribute("data-tooltip")).toBe("상단 고정");
    expect(paths).toContain("M4 7h16");
    expect(paths).not.toContain("M6 6l12 12");
  });

  it("asks the shared tooltip layer to show sidebar row tooltips on the right", () => {
    render(
      <AppStateProvider initialState={initialAppState}>
        <Sidebar />
      </AppStateProvider>,
    );

    expect(screen.getByRole("button", { name: "프로젝트 선택" }).getAttribute("data-tooltip-placement")).toBe("right");
    expect(screen.getByRole("button", { name: "New Chat" }).getAttribute("data-tooltip-placement")).toBe("right");
    expect(screen.getByRole("button", { name: "런타임 설정 열기" }).getAttribute("data-tooltip-placement")).toBe("right");
  });

  it("shows the busy spinner in the delete slot while the active answer is running", () => {
    const { container } = render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          busy: true,
          history: [{ value: "session-active", label: "5/3 10:00 2 msg", description: "진행 중인 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    const item = container.querySelector(".history-item");
    const spinner = container.querySelector(".history-busy-spinner");
    const actionButton = screen.queryByRole("button", { name: "진행 중인 대화 작업 더보기" });

    expect(item?.classList.contains("busy")).toBe(true);
    expect(spinner).not.toBeNull();
    expect(actionButton).toBeNull();
  });

  it("adds a busy live history row when the active saved session is not in the loaded history yet", () => {
    const { container } = render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-session-active",
          activeHistoryId: "saved-session-active",
          chatTitle: "첫 요청 처리",
          busy: true,
          history: [{ value: "session-old", label: "5/3 10:00 2 msg", description: "이전 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    const busyItem = container.querySelector(".history-item.busy");
    const actionButton = screen.queryByRole("button", { name: "첫 요청 처리 작업 더보기" });

    expect(busyItem?.textContent).toContain("첫 요청 처리");
    expect(actionButton).toBeNull();
  });

  it("shows compact chat history titles that fit the sidebar", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          history: [
            {
              value: "session-long",
              label: "5/4 10:00 24 msg chat history 대화 제목을 짧게 나오게 해줘. 가급적 좌측 사이드바 안에 맞는 수준의 폭으로",
              description: "",
            },
          ],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    const visibleTitle = screen.getByText(/chat history/);

    expect(visibleTitle.textContent).toBe("chat history 대화 제목을 짧게 나오게...");
    expect(visibleTitle.textContent?.length).toBeLessThanOrEqual(29);
  });

  it("keeps existing history rows visible while refreshing history", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          historyLoading: true,
          history: [{ value: "session-old", label: "5/3 10:00 2 msg", description: "이전 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    expect(screen.getByText("이전 대화")).toBeTruthy();
    expect(screen.queryByText("대화 내역을 불러오는 중...")).toBeNull();
    expect(document.querySelector(".history-list")?.getAttribute("aria-busy")).toBe("true");
  });

  it("renders pinned history items before recent items", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          history: [
            { value: "session-new", label: "5/4 10:00 2 msg", description: "최신 대화" },
            { value: "session-pin", label: "5/3 10:00 2 msg", description: "고정 대화", pinned: true },
          ],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    const titles = Array.from(document.querySelectorAll(".history-title")).map((node) => node.textContent);

    expect(titles).toEqual(["고정 대화", "최신 대화"]);
  });

  it("pins a history item from the expanded right-side action", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          workspaceName: "Default",
          workspacePath: "C:/demo",
          history: [{ value: "session-old", label: "5/3 10:00 2 msg", description: "이전 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "이전 대화 작업 더보기" }));
    await userEvent.click(screen.getByRole("button", { name: "이전 대화 상단 고정" }));

    await waitFor(() => expect(toggleHistoryPin).toHaveBeenCalledWith("session-old", true, "C:/demo", "Default"));
    expect(screen.getByText("★")).toBeTruthy();
    expect(sendBackendRequest).not.toHaveBeenCalled();
  });

  it("deletes a saved history item from its own workspace", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/current",
          history: [{
            value: "session-old",
            label: "5/3 10:00 2 msg",
            description: "이전 대화",
            workspace: { name: "Other", path: "C:/other" },
          }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "이전 대화 작업 더보기" }));
    await userEvent.click(screen.getByRole("button", { name: "이전 대화 삭제" }));

    await waitFor(() => expect(deleteHistory).toHaveBeenCalledWith("session-old", "C:/other", "Other"));
    expect(screen.queryByText("이전 대화")).toBeNull();
  });

  it("does not resurrect a deleted history item from a stale refresh", async () => {
    let dispatch!: ReturnType<typeof useAppState>["dispatch"];
    const deletedItem = {
      value: "session-deleted",
      label: "5/3 10:00 2 msg",
      description: "삭제된 대화",
      workspace: { name: "Default", path: "C:/demo" },
    };
    const keptItem = {
      value: "session-kept",
      label: "5/3 11:00 2 msg",
      description: "남은 대화",
      workspace: { name: "Default", path: "C:/demo" },
    };

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/demo",
          history: [deletedItem, keptItem],
        }}
      >
        <Sidebar />
        <DispatchProbe onReady={(value) => { dispatch = value; }} />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "삭제된 대화 작업 더보기" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제된 대화 삭제" }));

    await waitFor(() => expect(deleteHistory).toHaveBeenCalledWith("session-deleted", "C:/demo", "Default"));
    expect(screen.queryByText("삭제된 대화")).toBeNull();

    act(() => {
      dispatch({ type: "set_history", history: [deletedItem, keptItem] });
    });

    expect(screen.queryByText("삭제된 대화")).toBeNull();
    expect(screen.getByText("남은 대화")).toBeTruthy();
  });

  it("closes an idle live history row instead of deleting a missing snapshot file", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          history: [{
            value: "web-live-idle",
            label: "열려 있는 채팅",
            description: "열려 있는 세션",
            live: true,
            liveSessionId: "web-live-idle",
            busy: false,
          }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "열려 있는 세션 작업 더보기" }));
    await userEvent.click(screen.getByRole("button", { name: "열려 있는 세션 삭제" }));

    await waitFor(() => expect(shutdownSession).toHaveBeenCalledWith("web-live-idle", "client-1"));
    expect(deleteHistory).not.toHaveBeenCalled();
    expect(screen.queryByText("열려 있는 세션")).toBeNull();
  });

  it("does not show the current backend session as another open session", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-current",
          clientId: "client-1",
          history: [{
            value: "web-current",
            label: "열려 있는 채팅",
            description: "열려 있는 세션",
            live: true,
            liveSessionId: "web-current",
            busy: false,
          }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    expect(screen.queryByRole("button", { name: /열려 있는 세션/ })).toBeNull();
    expect(screen.queryByText("열려 있는 세션")).toBeNull();
  });

  it("keeps the saved history row visible when its live backend session is current", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "web-current",
          activeHistoryId: "saved-current",
          clientId: "client-1",
          history: [{
            value: "saved-current",
            label: "5/3 10:00 2 msg",
            description: "저장된 live 대화",
            live: true,
            liveSessionId: "web-current",
            busy: false,
          }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    expect(screen.getByText("저장된 live 대화")).toBeTruthy();
    expect(document.querySelector(".history-item.active")).not.toBeNull();
  });

  it("opens a saved history item in a separate backend while the current answer is running", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          busy: true,
          workspaceName: "Default",
          workspacePath: "C:/demo",
          history: [{ value: "session-old", label: "5/3 10:00 2 msg", description: "이전 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getAllByRole("button", { name: /이전 대화/ })[0]);

    await waitFor(() => expect(startSession).toHaveBeenCalledWith({
      clientId: "client-1",
      cwd: "C:/demo",
    }));
    expect(sendBackendRequest).toHaveBeenCalledWith("session-restored", "client-1", {
      type: "apply_select_command",
      command: "resume",
      value: "session-old",
    });
  });

  it("restores a live saved session snapshot when the current session is idle", async () => {
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "live-session-old",
        savedSessionId: "session-old",
        workspace: { name: "Default", path: "C:/demo" },
        busy: false,
        createdAt: 1,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          busy: false,
          workspaceName: "Default",
          workspacePath: "C:/demo",
          history: [{ value: "session-old", label: "5/3 10:00 2 msg", description: "이전 대화" }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getAllByRole("button", { name: /이전 대화/ })[0]);

    await waitFor(() => expect(listLiveSessions).toHaveBeenCalledWith({
      clientId: "client-1",
      workspacePath: "C:/demo",
    }));
    expect(sendBackendRequest).toHaveBeenCalledWith("live-session-old", "client-1", {
      type: "apply_select_command",
      command: "resume",
      value: "session-old",
    });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("reattaches to an unsaved live backend session by web session id", async () => {
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [{
        sessionId: "web-live-unsaved",
        savedSessionId: "",
        workspace: { name: "Default", path: "C:/demo" },
        busy: true,
        createdAt: 1,
      }],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          busy: false,
          workspaceName: "Default",
          workspacePath: "C:/demo",
          history: [{
            value: "web-live-unsaved",
            label: "진행 중인 채팅",
            description: "진행 중인 응답",
            live: true,
            liveSessionId: "web-live-unsaved",
            busy: true,
          }],
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    expect(document.querySelector(".history-item.busy")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "진행 중인 응답 작업 더보기" })).toBeNull();

    await userEvent.click(screen.getAllByRole("button", { name: /진행 중인 응답/ })[0]);

    await waitFor(() => expect(listLiveSessions).toHaveBeenCalled());
    expect(sendBackendRequest).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("starts a separate backend session for a new chat while the current answer is running", async () => {
    vi.mocked(startSession).mockResolvedValue({
      sessionId: "session-new",
      workspace: { name: "Default", path: "C:/demo" },
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          busy: true,
          workspaceName: "Default",
          workspacePath: "C:/demo",
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New Chat" }));

    await waitFor(() => expect(startSession).toHaveBeenCalledWith({
      clientId: "client-1",
      cwd: "C:/demo",
    }));
    expect(restartSession).not.toHaveBeenCalled();
  });

  it("switches an idle new chat immediately without restarting the backend", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          busy: false,
          messages: [{ id: "message-1", role: "user", text: "이전 질문" }],
        }}
      >
        <Sidebar />
        <ChatStateProbe />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New Chat" }));

    expect(screen.getByTestId("message-count").textContent).toBe("0");
    expect(screen.getByTestId("pending-fresh-chat").textContent).toBe("yes");
    expect(startSession).not.toHaveBeenCalled();
    expect(restartSession).not.toHaveBeenCalled();
  });

  it("keeps the Restart action as an explicit backend restart", async () => {
    vi.mocked(restartSession).mockResolvedValue({ sessionId: "session-new" });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-active",
          clientId: "client-1",
          workspaceName: "Default",
          workspacePath: "C:/demo",
        }}
      >
        <Sidebar />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Restart" }));

    await waitFor(() => expect(restartSession).toHaveBeenCalledWith({
      sessionId: "session-active",
      clientId: "client-1",
      cwd: "C:/demo",
    }));
  });

  it("keeps the selected workspace after restarting the session", async () => {
    const defaultWorkspace: Workspace = { name: "Default", path: "C:/MyHarness/Playground/Default" };
    const testWorkspace: Workspace = { name: "TEST1", path: "C:/MyHarness/Playground/TEST1" };
    vi.mocked(restartSession).mockResolvedValue({ sessionId: "session-test1" });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-default",
          clientId: "client-1",
          workspaceName: defaultWorkspace.name,
          workspacePath: defaultWorkspace.path,
          workspaces: [defaultWorkspace, testWorkspace],
        }}
      >
        <Sidebar />
        <WorkspaceProbe />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "프로젝트 선택" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "TEST1" }));

    expect(restartSession).toHaveBeenCalledWith({
      sessionId: "session-default",
      clientId: "client-1",
      cwd: testWorkspace.path,
    });
    await waitFor(() => expect(screen.getByTestId("workspace").textContent).toBe("TEST1"));
  });
});
