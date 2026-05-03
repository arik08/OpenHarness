import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openBackendEvents } from "../../api/events";
import { listLiveSessions, startSession } from "../../api/session";
import { AppStateProvider, useAppState } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { useBackendSession } from "../useBackendSession";

vi.mock("../../api/events", () => ({
  openBackendEvents: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock("../../api/session", () => ({
  listLiveSessions: vi.fn(),
  startSession: vi.fn(),
}));

function Probe() {
  useBackendSession();
  const { state } = useAppState();
  return (
    <>
      <output data-testid="session">{state.sessionId || ""}</output>
      <output data-testid="busy">{String(state.busy)}</output>
      <output data-testid="workspace">{state.workspacePath}</output>
    </>
  );
}

describe("useBackendSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(listLiveSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(startSession).mockResolvedValue({ sessionId: "new-session" });
  });

  it("reconnects to the previous live backend session before starting a new one", async () => {
    sessionStorage.setItem("myharness:activeBackendSessionId", "live-previous");
    vi.mocked(listLiveSessions).mockResolvedValue({
      sessions: [
        {
          sessionId: "live-older",
          savedSessionId: "",
          busy: false,
          createdAt: 1,
        },
        {
          sessionId: "live-previous",
          savedSessionId: "saved-1",
          workspace: { name: "Default", path: "C:/demo" },
          busy: true,
          createdAt: 2,
        },
      ],
    });

    render(
      <AppStateProvider initialState={{ ...initialAppState, clientId: "client-1" }}>
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("live-previous"));
    expect(screen.getByTestId("busy").textContent).toBe("true");
    expect(screen.getByTestId("workspace").textContent).toBe("C:/demo");
    expect(startSession).not.toHaveBeenCalled();
    expect(openBackendEvents).toHaveBeenCalled();
  });

  it("starts a new backend session when no live session is available", async () => {
    render(
      <AppStateProvider initialState={{ ...initialAppState, clientId: "client-1" }}>
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("new-session"));
    expect(listLiveSessions).toHaveBeenCalledWith({ clientId: "client-1" });
    expect(startSession).toHaveBeenCalledWith({ clientId: "client-1" });
  });
});
