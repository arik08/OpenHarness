import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../Composer";
import { MessageList } from "../MessageList";
import { ModalHost } from "../ModalHost";
import { AppStateProvider } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { cancelMessage, sendBackendRequest, sendMessage } from "../../api/messages";
import { startSession } from "../../api/session";

vi.mock("../../api/messages", () => ({
  cancelMessage: vi.fn().mockResolvedValue({ ok: true }),
  sendBackendRequest: vi.fn().mockResolvedValue({ ok: true }),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../api/session", () => ({
  startSession: vi.fn().mockResolvedValue({ sessionId: "session-new" }),
}));

describe("Composer", () => {
  beforeEach(() => {
    vi.mocked(cancelMessage).mockClear();
    vi.mocked(sendMessage).mockClear();
    vi.mocked(sendBackendRequest).mockClear();
    vi.mocked(startSession).mockClear();
    vi.mocked(startSession).mockResolvedValue({ sessionId: "session-new" });
    document.documentElement.style.removeProperty("--composer-stack-height");
  });

  it("keeps send disabled until a backend session exists", async () => {
    render(
      <AppStateProvider>
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    const send = screen.getByRole<HTMLButtonElement>("button", { name: "메시지 보내기" });

    expect(send.disabled).toBe(true);
    await userEvent.type(input, "hello");
    expect(send.disabled).toBe(true);
  });

  it("uses a subdued neutral send button color in the default theme", () => {
    const stylesheet = readFileSync(resolve(__dirname, "../../../styles.css"), "utf8");

    expect(stylesheet).toContain("--send-button-bg: #cdb6aa;");
    expect(stylesheet).toContain("--send-button-ink: #ffffff;");
  });

  it("does not expose an image file attachment button", () => {
    render(
      <AppStateProvider>
        <Composer />
      </AppStateProvider>,
    );

    expect(screen.queryByRole("button", { name: "이미지 첨부" })).toBeNull();
  });

  it("renders long pasted text with the legacy tray chip", () => {
    render(
      <AppStateProvider>
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    fireEvent.paste(input, {
      clipboardData: {
        items: [],
        getData: (type: string) => type === "text/plain"
          ? Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n")
          : "",
      },
    });

    const chip = document.querySelector(".pasted-text-chip");
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("[Pasted text #1 +10 lines]");
    expect(document.querySelector(".react-pasted-chip")).toBeNull();
  });

  it("renders pasted images with the legacy thumbnail chip and preview modal", async () => {
    const file = new File(["image"], "pasted-image.png", { type: "image/png" });
    const item = { kind: "file", type: "image/png", getAsFile: () => file };
    const readerSpy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function readAsDataURLMock(this: FileReader) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: "data:image/png;base64,aW1hZ2U=",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    render(
      <AppStateProvider>
        <Composer />
        <ModalHost />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    fireEvent.paste(input, {
      clipboardData: {
        items: [item],
        getData: () => "",
      },
    });

    const image = await screen.findByRole("button", { name: "pasted-image.png" });
    expect(document.querySelector(".attachment-chip")).toBeTruthy();
    expect(document.querySelector(".react-attachment-chip")).toBeNull();

    await userEvent.click(image);
    expect(await screen.findByRole("dialog", { name: "pasted-image.png" })).toBeTruthy();
    readerSpy.mockRestore();
  });

  it("moves the active command suggestion with arrow keys and applies it", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          commands: [
            { name: "help", description: "도움말" },
            { name: "plan", description: "계획 모드" },
            { name: "review", description: "리뷰" },
          ],
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "/");

    expect(screen.getByRole("option", { selected: true }).textContent).toContain("/help");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("/plan");

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("/help");

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("/review");

    await user.keyboard("{Enter}");
    expect(input).toHaveProperty("value", "/review");
  });

  it("shows every enabled skill suggestion when the draft starts with dollar", async () => {
    const user = userEvent.setup();
    const skills = Array.from({ length: 10 }, (_, index) => ({
      name: `skill-${index + 1}`,
      description: `Skill ${index + 1}`,
      enabled: true,
    }));

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          skills,
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "$");

    expect(screen.getAllByRole("option")).toHaveLength(skills.length);
    expect(screen.getByRole("option", { name: /\$skill-10/ })).toBeTruthy();
  });

  it("shows skill suggestions when dollar is typed in the middle of the draft", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          skills: [
            { name: "design-review", description: "디자인 점검", enabled: true },
            { name: "document-release", description: "릴리즈 문서", enabled: true },
          ],
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "본문 중간 $des");

    expect(screen.getByRole("option", { name: /\$design-review/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /\$document-release/ })).toBeNull();
  });

  it("replaces only the active file token when applying a middle-of-draft suggestion", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          composer: { ...initialAppState.composer, draft: "이 파일 참고 @rep 해줘" },
          artifacts: [
            { path: "outputs/report.md", name: "report.md", kind: "file" },
            { path: "outputs/notes.md", name: "notes.md", kind: "file" },
          ],
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...") as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange("이 파일 참고 @rep".length, "이 파일 참고 @rep".length);
    fireEvent.select(input);
    await user.click(screen.getByRole("option", { name: /@report\.md/ }));

    expect(input).toHaveProperty("value", "이 파일 참고 @outputs/report.md 해줘");
  });

  it("grows the input and composer frame for multiline drafts", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider>
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...") as HTMLTextAreaElement;
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => (input.value.includes("\n") ? 44 : 20),
    });

    await user.type(input, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");

    expect(input.style.height).toBe("44px");
    expect(input.closest(".composer-box")?.classList.contains("multiline")).toBe(true);
  });

  it("queues the draft with Ctrl+Enter while a response is running", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          busy: true,
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "다음 질문");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      line: "다음 질문",
      mode: "queue",
    }));
  });

  it("sends the draft as steering with Enter while a response is running", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          busy: true,
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "방금 조건 반영");
    await user.keyboard("{Enter}");

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      line: "방금 조건 반영",
      mode: "steer",
    }));
  });

  it("clicks the send button as steering while a response is running and the draft has text", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          busy: true,
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "지금 이 조건 반영");
    await user.click(screen.getByRole("button", { name: "스티어링 보내기" }));

    expect(cancelMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      line: "지금 이 조건 반영",
      mode: "steer",
    }));
  });

  it("ignores duplicate form submits while the first send is being accepted", async () => {
    const user = userEvent.setup();
    vi.mocked(sendMessage).mockReturnValueOnce(new Promise(() => {}));
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "2");
    const form = input.closest("form");
    expect(form).toBeTruthy();

    await act(async () => {
      fireEvent.submit(form!);
      fireEvent.submit(form!);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      line: "2",
      suppressUserTranscript: false,
    }));
  });

  it("starts a fresh backend only when sending after an idle new chat", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-old",
          clientId: "client-1",
          pendingFreshChat: true,
          workspacePath: "C:/demo",
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    await user.type(screen.getByPlaceholderText("메세지를 입력하세요..."), "새 질문");
    await user.click(screen.getByRole("button", { name: "메시지 보내기" }));

    await waitFor(() => expect(startSession).toHaveBeenCalledWith({
      clientId: "client-1",
      cwd: "C:/demo",
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-new",
      line: "새 질문",
    }));
  });

  it("does not flash the send button into stop state when toggling plan mode", async () => {
    const user = userEvent.setup();
    let resolvePlan!: (value: Record<string, unknown>) => void;
    vi.mocked(sendMessage).mockReturnValueOnce(new Promise((resolve) => {
      resolvePlan = resolve;
    }));
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const input = screen.getByPlaceholderText("메세지를 입력하세요...");
    await user.type(input, "작성 중");
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "메시지 보내기" }).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "작업 중단" })).toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ line: "/plan" }));

    await act(async () => {
      resolvePlan({ ok: true });
    });
  });

  it("renders the legacy stop button while a response is running without draft text", async () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          busy: true,
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const stop = screen.getByRole<HTMLButtonElement>("button", { name: "작업 중단" });
    expect(stop.classList.contains("is-stop")).toBe(true);
    expect(stop.querySelector("circle")?.getAttribute("r")).toBe("8.5");
    expect(stop.querySelectorAll("path")).toHaveLength(2);

    await userEvent.click(stop);

    expect(cancelMessage).toHaveBeenCalledWith("session-1", "client-1");
  });

  it("shows a compact todo icon inside the composer when the checklist is collapsed", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          todoMarkdown: "- [x] 조사\n- [ ] 구현",
          todoCollapsed: true,
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    const todoButton = screen.getByRole("button", { name: "작업 목록 펼치기 1/2" });
    expect(todoButton.closest(".composer-box")).toBeTruthy();
    expect(document.querySelector(".todo-checklist-dock")).toBeNull();

    await user.click(todoButton);

    expect(document.querySelector(".todo-checklist-dock")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "작업 목록 펼치기 1/2" })).toBeNull();
  });

  it("does not show a dismiss button on the expanded todo checklist", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          todoMarkdown: "- [x] 조사\n- [ ] 구현",
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    expect(screen.getByLabelText("작업 체크리스트")).toBeTruthy();
    expect(screen.getByRole("button", { name: "작업 목록 접기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "작업 목록 닫기" })).toBeNull();
  });

  it("renders backend questions inline directly above the composer input", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          modal: {
            kind: "backend",
            payload: {
              kind: "question",
              request_id: "question-1",
              question: "어떤 색으로 진행할까요?",
              choices: [
                { label: "파랑", value: "blue", description: "차분한 느낌" },
                { label: "초록", value: "green" },
              ],
            },
          },
        }}
      >
        <Composer />
        <ModalHost />
      </AppStateProvider>,
    );

    const card = document.querySelector(".inline-question-card");
    const composerBox = document.querySelector(".composer-box");
    expect(card).toBeTruthy();
    expect(card?.nextElementSibling).toBe(composerBox);
    expect(screen.queryByRole("dialog", { name: "질문" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /파랑/ }));

    expect(sendBackendRequest).toHaveBeenCalledWith("session-1", "client-1", {
      type: "question_response",
      request_id: "question-1",
      answer: "blue",
    });
  });

  it("does not attach generic quick replies to open-ended backend questions", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          modal: {
            kind: "backend",
            payload: {
              kind: "question",
              request_id: "question-1",
              question: "웹보고서 제작에 앞서 방향만 짧게 확인하겠습니다. 인터넷 문화의 변천사를 어떤 관점으로 보고서화할까요?",
            },
          },
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    expect(document.querySelector(".inline-question-card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /네, 진행해주세요/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /아니요/ })).toBeNull();
    expect(screen.getByPlaceholderText("직접 답변 입력...")).toBeTruthy();
  });

  it("reserves bottom scroll space for inline questions above the composer input", () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function mockRect(this: HTMLElement) {
      if (this.classList.contains("composer")) {
        return {
          x: 0,
          y: 500,
          top: 500,
          right: 800,
          bottom: 700,
          left: 0,
          width: 800,
          height: 200,
          toJSON: () => ({}),
        };
      }
      if (this.classList.contains("composer-box")) {
        return {
          x: 0,
          y: 640,
          top: 640,
          right: 800,
          bottom: 700,
          left: 0,
          width: 800,
          height: 60,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      render(
        <AppStateProvider
          initialState={{
            ...initialAppState,
            sessionId: "session-1",
            clientId: "client-1",
            modal: {
              kind: "backend",
              payload: {
                kind: "question",
                request_id: "question-1",
                question: "이 방향으로 바로 수정해도 될까요?",
              },
            },
          }}
        >
          <Composer />
        </AppStateProvider>,
      );

      expect(document.querySelector(".inline-question-card")).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue("--composer-stack-height")).toBe("200px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("turns completed assistant confirmation questions into inline quick replies without repeating the question", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "3번 혼합형을 추천드립니다.\n\n이 방향으로 바로 진행해도 될까요?",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
        <Composer />
      </AppStateProvider>,
    );

    const card = document.querySelector(".inline-question-card");
    const composerBox = document.querySelector(".composer-box");
    expect(card).toBeTruthy();
    expect(card?.nextElementSibling).toBe(composerBox);
    expect(screen.getByText("답변 선택")).toBeTruthy();
    expect(screen.getByText("이 방향으로 바로 진행해도 될까요?")).toBeTruthy();
    expect(screen.queryByText("질문: 이 방향으로 바로 진행해도 될까요?")).toBeNull();

    await user.click(screen.getByRole("button", { name: /네, 진행해주세요/ }));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      line: "네, 진행해주세요",
      suppressUserTranscript: false,
    }));
  });

  it("turns completed assistant open-ended clarification questions into inline replies", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "진행 전에 한 가지만 확인하겠습니다.\n\n보고서의 대상 독자는 누구인가요?",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
        <Composer />
      </AppStateProvider>,
    );

    const card = document.querySelector(".inline-question-card");
    expect(card).toBeTruthy();
    expect(screen.getByText("답변 선택")).toBeTruthy();
    expect(screen.getByText("보고서의 대상 독자는 누구인가요?")).toBeTruthy();
    expect(screen.queryByText("질문: 보고서의 대상 독자는 누구인가요?")).toBeNull();
    expect(screen.getByPlaceholderText("직접 답변 입력...")).toBeTruthy();
  });

  it("shows progress for batched assistant clarification questions", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: [
                "(1/3) 보고서의 대상 독자는 누구인가요?",
                "(2/3) 원하는 톤은 어떻게 할까요?",
                "(3/3) 분량은 어느 정도가 좋을까요?",
              ].join("\n"),
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
        <Composer />
      </AppStateProvider>,
    );

    expect(screen.getByText("답변 선택 (1/3)")).toBeTruthy();
    expect(document.body.textContent || "").toContain("(1/3) 보고서의 대상 독자는 누구인가요?");
    expect(screen.getByPlaceholderText("직접 답변 입력...")).toBeTruthy();
  });

  it("shows progress for batched backend clarification questions", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          modal: {
            kind: "backend",
            payload: {
              kind: "question",
              request_id: "question-1",
              question: [
                "보고서의 대상 독자는 누구인가요?",
                "원하는 톤은 어떻게 할까요?",
                "분량은 어느 정도가 좋을까요?",
              ].join("\n"),
            },
          },
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    expect(screen.getByText(/질문 \(1\/3\):/)).toBeTruthy();
  });

  it("does not turn markdown answer headings into inline follow-up questions", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: [
                "맞습니다. 구조적으로 보면 이렇습니다.",
                "",
                "## 왜 AI가 PPT를 기본 상태에서 잘 못 만들까?",
                "",
                "PPT는 텍스트보다 레이아웃 검수가 중요한 문서입니다.",
                "",
                "## PPTX가 왜 프리뷰 안 되나?",
                "",
                "PPTX는 브라우저가 직접 렌더링하기 어려운 Office 패키지입니다.",
              ].join("\n"),
              isComplete: true,
            },
          ],
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    expect(document.querySelector(".inline-question-card")).toBeNull();
    expect(screen.queryByText(/질문:/)).toBeNull();
  });

  it("does not attach generic quick replies to assistant alternative questions", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-1",
          clientId: "client-1",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "“DCInside 트이전글”을 기준으로 보면 될까요, 아니면 구글/웹 검색에 노출되는 외부 요약까지 포함한 넓은 웹 담론으로 볼까요?",
              isComplete: true,
            },
          ],
        }}
      >
        <Composer />
      </AppStateProvider>,
    );

    expect(document.querySelector(".inline-question-card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /네, 진행해주세요/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /아니요/ })).toBeNull();
    expect(screen.getByPlaceholderText("직접 답변 입력...")).toBeTruthy();
  });
});
