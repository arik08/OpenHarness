import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocalBrowserHostname } from "../ModalHost";
import { ModalHost } from "../ModalHost";
import { AppStateProvider } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { restartSession } from "../../api/session";
import { deleteWorkspace } from "../../api/workspaces";

vi.mock("../../api/session", () => ({
  restartSession: vi.fn(),
}));

vi.mock("../../api/workspaces", () => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

describe("ModalHost remote access helpers", () => {
  it("treats loopback browser hosts as server-local", () => {
    expect(isLocalBrowserHostname("localhost")).toBe(true);
    expect(isLocalBrowserHostname("127.0.0.1")).toBe(true);
    expect(isLocalBrowserHostname("::1")).toBe(true);
  });

  it("treats LAN browser hosts as remote clients", () => {
    expect(isLocalBrowserHostname("192.168.0.12")).toBe(false);
    expect(isLocalBrowserHostname("10.20.30.40")).toBe(false);
    expect(isLocalBrowserHostname("myharness-demo.local")).toBe(false);
  });
});

describe("ModalHost workspace deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(restartSession).mockResolvedValue({
      sessionId: "session-default",
      workspace: { name: "Default", path: "C:/Users/user/Desktop/Documents/Python/MyHarness" },
    });
    vi.mocked(deleteWorkspace).mockResolvedValue({
      deleted: { name: "TEST1", path: "C:/Users/user/Desktop/Documents/Python/MyHarness/TEST1" },
      workspaces: [{ name: "Default", path: "C:/Users/user/Desktop/Documents/Python/MyHarness" }],
    });
  });

  function renderWorkspaceModal() {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-test1",
          clientId: "client-1",
          workspaceName: "TEST1",
          workspacePath: "C:/Users/user/Desktop/Documents/Python/MyHarness/TEST1",
          modal: { kind: "workspace" },
          workspaces: [
            { name: "Default", path: "C:/Users/user/Desktop/Documents/Python/MyHarness" },
            { name: "TEST1", path: "C:/Users/user/Desktop/Documents/Python/MyHarness/TEST1" },
          ],
        }}
      >
        <ModalHost />
      </AppStateProvider>,
    );
  }

  it("arms project deletion on the first click without deleting", async () => {
    renderWorkspaceModal();

    const deleteButton = screen.getByRole("button", { name: "TEST1 삭제" });
    await userEvent.click(deleteButton);

    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "TEST1 삭제 확인" })).toBeTruthy();
    expect(deleteButton.closest(".workspace-row")?.classList.contains("delete-ready")).toBe(true);
  });

  it("deletes the active project on the second click after switching to another project", async () => {
    renderWorkspaceModal();

    await userEvent.click(screen.getByRole("button", { name: "TEST1 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "TEST1 삭제 확인" }));

    await waitFor(() => expect(restartSession).toHaveBeenCalledWith({
      sessionId: "session-test1",
      clientId: "client-1",
      cwd: "C:/Users/user/Desktop/Documents/Python/MyHarness",
    }));
    expect(deleteWorkspace).toHaveBeenCalledWith("TEST1");
    expect(screen.queryByText("TEST1")).toBeNull();
  });
});
