import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandHelpMessage } from "../CommandHelpMessage";
import { Composer } from "../Composer";
import { AppStateProvider, useAppState } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { sendBackendRequest } from "../../api/messages";

vi.mock("../../api/messages", () => ({
  cancelMessage: vi.fn().mockResolvedValue({ ok: true }),
  sendBackendRequest: vi.fn().mockResolvedValue({ ok: true }),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../api/session", () => ({
  startSession: vi.fn().mockResolvedValue({ sessionId: "session-new" }),
}));

function SkillsSnapshotButton() {
  const { dispatch } = useAppState();
  return (
    <button
      type="button"
      onClick={() => dispatch({
        type: "backend_event",
        event: {
          type: "skills_snapshot",
          skills: [
            { name: "ship", description: "Shipping checklist", source: "project", enabled: false },
            { name: "review", description: "Review checklist", source: "project", enabled: true },
          ],
        },
      })}
    >
      snapshot
    </button>
  );
}

describe("CommandHelpMessage", () => {
  beforeEach(() => {
    vi.mocked(sendBackendRequest).mockClear();
  });

  it("updates the visible skill state when the backend snapshot changes", async () => {
    const user = userEvent.setup();
    const helpText = [
      "사용 가능한 스킬:",
      "- ship [project] [활성]: Shipping checklist",
      "- review [project] [활성]: Review checklist",
      "",
      "사용 가능한 명령어:",
      "- /help 도움말",
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          skills: [
            { name: "ship", description: "Shipping checklist", source: "project", enabled: true },
            { name: "review", description: "Review checklist", source: "project", enabled: true },
          ],
        }}
      >
        <CommandHelpMessage text={helpText} />
        <SkillsSnapshotButton />
        <Composer />
      </AppStateProvider>,
    );

    const shipCard = screen.getByRole("button", { name: /ship/ });
    await user.click(shipCard);
    expect(sendBackendRequest).toHaveBeenCalledWith(
      "session-1",
      expect.any(String),
      { type: "set_skill_enabled", value: "ship", enabled: false },
    );

    await user.click(screen.getByRole("button", { name: "snapshot" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /ship/ }).textContent).toContain("Inactive"));

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "$");
    expect(screen.queryByRole("option", { name: /\$ship/ })).toBeNull();
    expect(screen.getByRole("option", { name: /\$review/ })).toBeTruthy();
  });

  it("adds full skill descriptions to the shared tooltip layer", () => {
    const helpText = [
      "사용 가능한 스킬:",
      "- dispatching-parallel-agents [project] [활성]: 공유 상태나 순차 의존성이 없는 2개 이상의 독립 작업을 병렬로 처리합니다.",
      "",
      "사용 가능한 명령어:",
      "- /help 도움말",
    ].join("\n");

    render(
      <AppStateProvider initialState={{ ...initialAppState, sessionId: "session-1" }}>
        <CommandHelpMessage text={helpText} />
      </AppStateProvider>,
    );

    expect(screen.getByRole("button", { name: /dispatching-parallel-agents/ }).getAttribute("data-tooltip")).toBe(
      "dispatching-parallel-agents\n공유 상태나 순차 의존성이 없는 2개 이상의 독립 작업을 병렬로 처리합니다.",
    );
  });

  it("disables plugin-owned skills in the help view when their plugin is toggled off", async () => {
    const user = userEvent.setup();
    const helpText = [
      "사용 가능한 스킬:",
      "- using-superpowers [plugin] [활성]: 스킬을 찾고 사용하는 방식을 정합니다.",
      "",
      "플러그인:",
      "- superpowers [활성]: Superpowers skills",
      "",
      "사용 가능한 명령어:",
      "- /help 도움말",
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          skills: [
            {
              name: "using-superpowers",
              description: "스킬을 찾고 사용하는 방식을 정합니다.",
              source: "plugin:superpowers",
              enabled: true,
            },
          ],
        }}
      >
        <CommandHelpMessage text={helpText} />
      </AppStateProvider>,
    );

    await user.click(screen.getByRole("button", { name: /^superpowers/ }));

    expect(sendBackendRequest).toHaveBeenCalledWith(
      "session-1",
      expect.any(String),
      { type: "set_plugin_enabled", value: "superpowers", enabled: false },
    );
    expect(screen.getByRole("button", { name: /using-superpowers/ }).textContent).toContain("Inactive");
  });
});
