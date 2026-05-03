import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "../MessageList";
import { ArtifactPanel } from "../ArtifactPanel";
import { AppStateProvider, useAppState } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";

function HistoryRestoreProbe() {
  const { dispatch } = useAppState();
  return (
    <button
      type="button"
      onClick={() => dispatch({
        type: "backend_event",
        event: {
          type: "history_snapshot",
          value: "session-old",
          message: "이전 대화",
          history_events: [
            { type: "user", text: "이전 질문" },
            { type: "assistant", text: "이전 답변" },
          ],
        },
      })}
    >
      restore
    </button>
  );
}

function WorkflowProgressProbe() {
  const { dispatch } = useAppState();
  return (
    <button
      type="button"
      onClick={() => dispatch({
        type: "backend_event",
        event: {
          type: "tool_started",
          tool_name: "shell_command",
          tool_input: { command: "npm test" },
        },
      })}
    >
      add workflow
    </button>
  );
}

function StreamingDeltaProbe() {
  const { dispatch } = useAppState();
  const sendDelta = (message: string) => dispatch({
    type: "backend_event",
    event: { type: "assistant_delta", message },
  });
  return (
    <>
      <button type="button" onClick={() => sendDelta("스트")}>delta one</button>
      <button type="button" onClick={() => sendDelta("리밍 답변입니다.")}>delta two</button>
    </>
  );
}

describe("MessageList", () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    vi.restoreAllMocks();
  });

  it("renders chat messages without visible role labels to match the legacy web UI", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: "안녕?" },
            { id: "assistant-1", role: "assistant", text: "안녕하세요! 무엇을 도와드릴까요?" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.getByText("안녕?")).toBeTruthy();
    expect(screen.getByText("안녕하세요! 무엇을 도와드릴까요?")).toBeTruthy();
    expect(screen.queryByText("사용자")).toBeNull();
    expect(screen.queryByText("MyHarness")).toBeNull();
  });

  it("renders legacy badges for steering and queued user messages", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "steer-1", role: "user", text: "이 조건 바로 반영", kind: "steering" },
            { id: "queue-1", role: "user", text: "끝나면 이것도 처리", kind: "queued" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.getByText("스티어링")).toBeTruthy();
    expect(screen.getByText("대기열")).toBeTruthy();
    expect(document.querySelector(".message-kind-steering")).toBeTruthy();
    expect(document.querySelector(".message-kind-queued")).toBeTruthy();
  });

  it("renders workflow directly under the active user turn before the answer", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "테스트해줘" },
            { id: "assistant-1", role: "assistant", text: "테스트 결과입니다." },
          ],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "작업 계획 수립", detail: "필요한 맥락과 진행 방향을 정리합니다.", status: "done", level: "parent" },
            { id: "workflow-3", toolName: "shell_command", title: "명령 실행", detail: "npm test", status: "done", level: "child" },
            { id: "workflow-4", toolName: "", title: "최종 답변", detail: "최종 답변을 작성했습니다.", status: "done", level: "parent" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const articles = [...document.querySelectorAll("article.message")].map((node) => node.textContent || "");
    expect(articles[0]).toContain("테스트해줘");
    expect(articles[1]).toContain("작업 진행");
    expect(articles[1]).toContain("요청 이해");
    expect(articles[1]).toContain("작업 계획 수립");
    expect(articles[1]).toContain("명령 실행");
    expect(articles[1]).toContain("최종 답변");
    expect(articles[1]).not.toContain("지우기");
    expect(articles[2]).toContain("테스트 결과입니다.");
  });

  it("renders workflow purpose groups as explicit parent and child structure", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [{ id: "user-1", role: "user", text: "조사해줘" }],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "정보 수집", detail: "필요한 정보를 확인했습니다.", status: "running", level: "parent", role: "purpose", purpose: "info", groupId: "group-info" },
            { id: "workflow-3", toolName: "web_search", title: "web_search", detail: "first query", status: "done", level: "child", groupId: "group-info" },
            { id: "workflow-4", toolName: "web_fetch", title: "web_fetch", detail: "example.com", status: "running", level: "child", groupId: "group-info" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const group = document.querySelector('[data-workflow-group-id="group-info"]');
    expect(group).toBeTruthy();
    expect(group?.querySelector('[data-workflow-role="purpose"]')?.textContent).toContain("정보 수집");
    const childTitles = [...(group?.querySelectorAll(".workflow-children .workflow-step.child strong") || [])]
      .map((node) => node.textContent);
    expect(childTitles).toEqual(["web_search", "web_fetch"]);
    expect(document.querySelector(".workflow-count")?.textContent).toBe("1개 실행 중");
  });

  it("stagger-reveals active workflow rows instead of showing a web tool batch at once", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [{ id: "user-1", role: "user", text: "자료 조사해줘" }],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "정보 수집", detail: "필요한 정보를 확인했습니다.", status: "running", level: "parent", role: "purpose", purpose: "info", groupId: "group-info" },
            { id: "workflow-3", toolName: "web_search", title: "web_search", detail: "first query", status: "done", level: "child", groupId: "group-info" },
            { id: "workflow-4", toolName: "web_search", title: "web_search", detail: "second query", status: "done", level: "child", groupId: "group-info" },
            { id: "workflow-5", toolName: "web_fetch", title: "web_fetch", detail: "example.com", status: "running", level: "child", groupId: "group-info" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelectorAll(".workflow-step")).toHaveLength(1);
    expect(screen.queryByText("정보 수집")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(90);
    });
    expect(document.querySelectorAll(".workflow-step")).toHaveLength(2);
    expect(screen.getByText("정보 수집")).toBeTruthy();
    expect(document.body.textContent || "").not.toContain("first query");

    act(() => {
      vi.advanceTimersByTime(270);
    });
    expect(document.querySelectorAll(".workflow-step")).toHaveLength(5);
    expect(document.body.textContent || "").toContain("first query");
    expect(document.body.textContent || "").toContain("second query");
    expect(document.body.textContent || "").toContain("example.com");
  });

  it("renders active answer drafting workflow before the streaming assistant answer", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "조사해줘" },
            { id: "assistant-1", role: "assistant", text: "정리하면" },
          ],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "응답 작성", detail: "답변 본문을 작성하고 있습니다. 4자 수신 중입니다.", status: "running", level: "parent", role: "final" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const articles = [...document.querySelectorAll("article.message")];
    expect(articles).toHaveLength(3);
    expect(articles[0].textContent || "").toContain("조사해줘");
    expect(articles[1].classList.contains("workflow-message")).toBe(true);
    expect(articles[1].textContent || "").toContain("응답 작성");
    expect(articles[1].textContent || "").toContain("진행 중");
    expect(articles[2].classList.contains("workflow-message")).toBe(false);
    expect(articles[2].classList.contains("assistant")).toBe(true);
  });

  it("renders the total workflow duration beside the record count", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: "테스트해줘" },
            { id: "assistant-1", role: "assistant", text: "테스트 결과입니다.", isComplete: true },
          ],
          workflowEventsByMessageId: {
            "user-1": [
              { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
              { id: "workflow-2", toolName: "", title: "작업 계획 수립", detail: "진행 방향을 정했습니다.", status: "done", level: "parent" },
              { id: "workflow-3", toolName: "shell_command", title: "명령 실행", detail: "npm test", status: "done", level: "child" },
              { id: "workflow-4", toolName: "", title: "다음 판단 중", detail: "도구 결과를 보고 다음 단계를 정합니다.", status: "done", level: "parent" },
              { id: "workflow-5", toolName: "", title: "최종 답변", detail: "최종 답변을 작성했습니다.", status: "done", level: "parent" },
            ],
          },
          workflowDurationSecondsByMessageId: {
            "user-1": 42,
          },
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const workflowArticle = [...document.querySelectorAll("article.message")]
      .map((node) => node.textContent || "")
      .find((text) => text.includes("작업 진행")) || "";

    expect(workflowArticle).toContain("5개 기록 (42초)");
  });

  it("renders restored workflow records under each user turn", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: "첫 질문" },
            { id: "assistant-1", role: "assistant", text: "첫 답변", isComplete: true },
            { id: "user-2", role: "user", text: "후속 질문" },
            { id: "assistant-2", role: "assistant", text: "후속 답변", isComplete: true },
          ],
          workflowAnchorMessageId: "user-2",
          workflowEventsByMessageId: {
            "user-1": [
              { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
              { id: "workflow-2", toolName: "", title: "최종 답변", detail: "최종 답변을 작성했습니다.", status: "done", level: "parent" },
            ],
          },
          workflowEvents: [
            { id: "workflow-3", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-4", toolName: "shell_command", title: "명령 실행", detail: "npm test", status: "done", level: "child" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const articles = [...document.querySelectorAll("article.message")].map((node) => node.textContent || "");
    expect(articles[0]).toContain("첫 질문");
    expect(articles[1]).toContain("작업 진행");
    expect(articles[2]).toContain("첫 답변");
    expect(articles[3]).toContain("후속 질문");
    expect(articles[4]).toContain("작업 진행");
    expect(articles[4]).toContain("명령 실행");
    expect(articles[5]).toContain("후속 답변");
  });

  it("renders assistant html code blocks as chat previews", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/api/html-preview/test-preview" }),
    } as Response);

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "```html\n<div id=\"chart\"></div><script>document.body.textContent='chart'</script>\n```",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const frame = await screen.findByTitle("HTML preview") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.src).toContain("/api/html-preview/test-preview");
    expect(document.querySelector(".html-render-preview")).toBeTruthy();
    expect(document.querySelector("pre code.language-html")).toBeNull();
  });

  it("keeps streaming html blocks as a stable preview placeholder instead of flashing code", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "```html\n<div id=\"chart\"><script>",
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(initialAppState.appSettings.streamStartBufferMs + 600);
    });

    expect(screen.getByText("차트 미리보기 준비 중")).toBeTruthy();
    expect(document.querySelector(".html-stream-preview")).toBeTruthy();
    expect(document.querySelector("pre code.language-html")).toBeNull();
    expect(document.body.textContent || "").not.toContain("<div id=\"chart\">");
  });

  it("restores code block highlighting and copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "```ts\nconst answer = 42;\nconsole.log(answer);\n```",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const code = document.querySelector("pre code.language-ts");
    const copyButton = screen.getByRole("button", { name: "Copy code" });

    expect(code?.classList.contains("hljs")).toBe(true);
    expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(copyButton.getAttribute("data-tooltip")).toBe("코드 복사");
    expect(copyButton.textContent).toContain("Copy");

    await userEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith("const answer = 42;\nconsole.log(answer);\n");
    expect(copyButton.textContent).toContain("Copied");
  });

  it("keeps copy actions and highlighting for language-less Python code blocks", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "```\na = 10\nb = 3\n\nprint(a + b)  # 더하기\nprint(a - b)  # 빼기\n```",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const code = document.querySelector("pre code");

    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
    expect(code?.classList.contains("hljs")).toBe(true);
    expect(code?.classList.contains("language-python")).toBe(true);
    expect(code?.querySelector(".hljs-built_in")?.textContent).toBe("print");
    expect(code?.querySelector(".hljs-comment")?.textContent).toContain("더하기");
  });

  it("does not add whitespace text after code when injecting the copy action", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "assistant-1", role: "assistant", text: "```\nprint(\"안녕하세요!\")\n```", isComplete: true },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const pre = document.querySelector("pre");
    const trailingTextNodes = [...(pre?.childNodes || [])]
      .slice(1)
      .filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim() === "");

    expect(pre?.querySelector(".code-copy")).toBeTruthy();
    expect(trailingTextNodes).toHaveLength(0);
  });

  it("renders write tool content in the workflow output preview", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "차트 파일 만들어줘" },
          ],
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "write_file",
              title: "write_file",
              detail: "outputs/chart.html",
              status: "done",
              level: "child",
              toolInput: {
                path: "outputs/chart.html",
                content: "<html><body><canvas id=\"chart\"></canvas></body></html>",
              },
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.getByText("작성 완료 - chart.html")).toBeTruthy();
    expect(screen.getByText(/\d+ 토큰 \(1줄\)/)).toBeTruthy();
    expect(document.querySelector(".workflow-output-preview")?.textContent || "").toContain("<canvas id=\"chart\">");
    expect(document.querySelector(".workflow-list + .workflow-output-list .workflow-output-preview")).toBeTruthy();
    expect(document.querySelector(".workflow-step .workflow-output-preview")).toBeFalsy();
    expect(document.querySelector(".workflow-card")?.hasAttribute("open")).toBe(true);
  });

  it("renders edit previews as colored diff rows", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "속도 바꿔줘" },
          ],
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "file_edit",
              title: "file_edit",
              detail: "super-ai-worm-game.html",
              status: "done",
              level: "child",
              toolInput: {
                path: "super-ai-worm-game.html",
                old_str: "<div>5x</div>\n<span>slow</span>\n<p>before</p>",
                new_str: "<div>3x</div>\n<span>fast</span>\n<p>after</p>",
              },
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.getByText("수정 완료 - super-ai-worm-game.html")).toBeTruthy();
    expect(screen.getByText(/\d+ 토큰 \(6줄\)/)).toBeTruthy();
    expect(screen.queryByText("6줄 변경")).toBeNull();
    expect(screen.getByText("-- <div>5x</div>").className).toContain("removed");
    expect(screen.getByText("++ <div>3x</div>").className).toContain("added");
    expect(document.querySelectorAll(".workflow-diff-line")).toHaveLength(6);
  });

  it("keeps running write previews scrolled inside the code pane", () => {
    const scrollTopValues = new WeakMap<Element, number>();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 640;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return scrollTopValues.get(this) ?? originalScrollTop?.get?.call(this) ?? 0;
      },
      set(value: number) {
        scrollTopValues.set(this, value);
      },
    });

    try {
      render(
        <AppStateProvider
          initialState={{
            ...initialAppState,
            workflowAnchorMessageId: "user-1",
            messages: [
              { id: "user-1", role: "user", text: "HTML 파일 만들어줘" },
            ],
            workflowEvents: [
              {
                id: "workflow-1",
                toolName: "write_file",
                title: "write_file",
                detail: "outputs/page.html",
                status: "running",
                level: "child",
                toolInput: {
                  path: "outputs/page.html",
                  content: Array.from({ length: 60 }, (_, index) => `<p>${index}</p>`).join("\n"),
                },
              },
            ],
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      expect((document.querySelector(".workflow-output-body") as HTMLElement).scrollTop).toBe(640);
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });

  it("renders web investigation sources after the completed assistant answer", async () => {
    const user = userEvent.setup();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "웹사이트 조사해줘" },
            { id: "assistant-1", role: "assistant", text: "조사 결과입니다.", isComplete: true },
          ],
          workflowEvents: [
            {
              id: "workflow-search",
              toolName: "web_search",
              title: "web_search",
              detail: "myharness docs",
              status: "done",
              level: "child",
              toolInput: { query: "myharness docs" },
              output: [
                "Search results for: myharness docs",
                "1. MyHarness Docs",
                "   URL: https://example.com/docs",
                "2. MyHarness Repo",
                "   URL: https://github.com/example/myharness",
              ].join("\n"),
            },
            {
              id: "workflow-fetch",
              toolName: "web_fetch",
              title: "web_fetch",
              detail: "https://example.com/docs",
              status: "done",
              level: "child",
              toolInput: { url: "https://example.com/docs" },
              output: "URL: https://example.com/docs\nStatus: 200\n\n본문",
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const articles = [...document.querySelectorAll("article.message")].map((node) => node.textContent || "");
    expect(articles[1]).toContain("작업 진행");
    expect(articles[1]).not.toContain("출처");
    expect(articles[2]).toContain("조사 결과입니다.");
    expect(articles[2]).toContain("출처");

    expect(screen.getByText("출처")).toBeTruthy();
    expect(screen.getByText(/2개 사이트/)).toBeTruthy();
    await user.click(screen.getByText("출처"));
    expect(screen.getByRole("link", { name: /example\.com.*\/docs/ }).getAttribute("href")).toBe("https://example.com/docs");
    expect(screen.getByRole("link", { name: /github\.com.*\/example\/myharness/ }).getAttribute("href")).toBe("https://github.com/example/myharness");
    expect(screen.getByText("myharness docs")).toBeTruthy();
    expect(screen.getAllByText("web_search")).toHaveLength(1);
  });

  it("renders assistant completion actions after a final answer", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "assistant-1", role: "assistant", text: "완료된 답변입니다.", isComplete: true },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.getByText("답변 완료")).toBeTruthy();
    expect(screen.getByLabelText("원문 복사")).toBeTruthy();
    expect(screen.getByLabelText("본문 저장")).toBeTruthy();
  });

  it("renders resolved artifact cards below completed assistant answers and opens the preview panel", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/artifact/resolve?")) {
        return {
          ok: true,
          json: async () => ({
            path: "outputs/super-ai-worm-game.html",
            name: "super-ai-worm-game.html",
            kind: "html",
            size: 128,
          }),
        } as Response;
      }
      if (url.startsWith("/api/artifact?")) {
        return {
          ok: true,
          json: async () => ({
            path: "outputs/super-ai-worm-game.html",
            name: "super-ai-worm-game.html",
            kind: "html",
            content: "<!doctype html><html><body>AI Worm</body></html>",
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-a",
          clientId: "client-a",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "완료했습니다.\n\n파일: outputs/super-ai-worm-game.html",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
        <ArtifactPanel />
      </AppStateProvider>,
    );

    const card = await screen.findByRole("button", { name: "super-ai-worm-game.html 미리보기 열기" });
    expect(card.closest(".artifact-cards")).toBeTruthy();

    await userEvent.click(card);

    const frame = await screen.findByTitle("super-ai-worm-game.html") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.srcdoc).toContain("AI Worm");
  });

  it("renders shell shortcut input and output as one terminal block", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            {
              id: "terminal-1",
              role: "log",
              text: "v22.15.0\n",
              toolName: "shell-shortcut",
              terminal: {
                command: "node --version",
                output: "v22.15.0\n",
                status: "done",
              },
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const terminal = document.querySelector(".terminal-message");
    expect(terminal?.textContent).toBe("> node --version\nv22.15.0\n");
    expect(document.querySelectorAll("article.message")).toHaveLength(1);
  });

  it("restores a clicked history session to its saved scroll position without bottom scrolling", async () => {
    sessionStorage.setItem("myharness:scrollPositions", JSON.stringify({ "session-old": 240 }));

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          sessionId: "session-live",
          activeHistoryId: "session-old",
        }}
      >
        <HistoryRestoreProbe />
        <MessageList />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "restore" }));

    const messages = document.querySelector(".messages") as HTMLElement;
    await waitFor(() => expect(messages.scrollTop).toBe(240));
    expect(messages.dataset.lastScrollTop).toBe("240");
  });

  it("does not render assistant completion actions while an answer is still streaming", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "assistant-1", role: "assistant", text: "작성 중인 답변입니다." },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.queryByText("답변 완료")).toBeNull();
    expect(screen.queryByLabelText("원문 복사")).toBeNull();
    expect(screen.queryByLabelText("본문 저장")).toBeNull();
  });

  it("buffers and reveals only the active streaming assistant answer", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          messages: [
            { id: "assistant-1", role: "assistant", text: "스트리밍 답변입니다." },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.body.textContent || "").not.toContain("스트리밍");

    act(() => {
      vi.advanceTimersByTime(initialAppState.appSettings.streamStartBufferMs + 40);
    });

    expect(document.body.textContent || "").toContain("스트");
    expect(document.querySelector(".stream-reveal-sentence")).toBeTruthy();
  });

  it("does not keep postponing the first streaming reveal while new deltas arrive", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider initialState={{ ...initialAppState, busy: true }}>
        <StreamingDeltaProbe />
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      screen.getByText("delta one").click();
    });
    act(() => {
      vi.advanceTimersByTime(initialAppState.appSettings.streamStartBufferMs - 20);
      screen.getByText("delta two").click();
      vi.advanceTimersByTime(25);
    });

    expect(document.body.textContent || "").toContain("스트");
    expect(document.querySelector(".stream-reveal-sentence")).toBeTruthy();
  });

  it("keeps following the bottom as buffered streaming text becomes visible", () => {
    vi.useFakeTimers();
    const scrollHeights = new WeakMap<Element, number>();
    const clientHeights = new WeakMap<Element, number>();
    const scrollTopValues = new WeakMap<Element, number>();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeights.get(this) ?? originalScrollHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return clientHeights.get(this) ?? originalClientHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return scrollTopValues.get(this) ?? originalScrollTop?.get?.call(this) ?? 0;
      },
      set(value: number) {
        scrollTopValues.set(this, value);
      },
    });

    try {
      render(
        <AppStateProvider
          initialState={{
            ...initialAppState,
            busy: true,
            messages: [
              {
                id: "assistant-1",
                role: "assistant",
                text: "길게 이어지는 스트리밍 답변입니다. 화면에 드러나는 텍스트가 늘어나도 맨 아래를 따라가야 합니다.",
              },
            ],
            appSettings: {
              ...initialAppState.appSettings,
              streamStartBufferMs: 0,
              streamScrollDurationMs: 0,
            },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      clientHeights.set(messages, 80);
      scrollHeights.set(messages, 100);

      act(() => {
        vi.advanceTimersByTime(40);
      });
      scrollHeights.set(messages, 340);

      act(() => {
        vi.advanceTimersByTime(40);
      });

      expect(messages.scrollTop).toBe(340);
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });

  it("smooth vertical auto-scroll accelerates before slowing down", () => {
    const animationFrames: FrameRequestCallback[] = [];
    const scrollTopValues = new WeakMap<Element, number>();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const originalMatchMedia = window.matchMedia;
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
    vi.spyOn(performance, "now").mockReturnValue(0);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.classList?.contains("messages") ? 800 : originalScrollHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.classList?.contains("messages") ? 200 : originalClientHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return scrollTopValues.get(this) ?? originalScrollTop?.get?.call(this) ?? 0;
      },
      set(value: number) {
        scrollTopValues.set(this, value);
      },
    });

    try {
      render(
        <AppStateProvider
          initialState={{
            ...initialAppState,
            messages: [
              { id: "assistant-1", role: "assistant", text: "자동 스크롤 테스트", isComplete: true },
            ],
            appSettings: {
              ...initialAppState.appSettings,
              streamScrollDurationMs: 1000,
            },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      const samples: number[] = [];
      for (const now of [0, 120, 240, 760, 880, 1000]) {
        const frame = animationFrames.shift();
        expect(frame).toBeTruthy();
        act(() => frame?.(now));
        samples.push(messages.scrollTop);
      }

      const deltas = samples.slice(1).map((value, index) => value - samples[index]);
      expect(deltas[1]).toBeGreaterThan(deltas[0]);
      expect(deltas[4]).toBeLessThan(deltas[3]);
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      window.matchMedia = originalMatchMedia;
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });

  it("keeps following the bottom as active workflow progress grows below the user turn", async () => {
    const scrollHeights = new WeakMap<Element, number>();
    const clientHeights = new WeakMap<Element, number>();
    const scrollTopValues = new WeakMap<Element, number>();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeights.get(this) ?? originalScrollHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return clientHeights.get(this) ?? originalClientHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return scrollTopValues.get(this) ?? originalScrollTop?.get?.call(this) ?? 0;
      },
      set(value: number) {
        scrollTopValues.set(this, value);
      },
    });

    try {
      render(
        <AppStateProvider
          initialState={{
            ...initialAppState,
            busy: true,
            messages: [
              { id: "user-1", role: "user", text: "테스트 실행해줘" },
            ],
            workflowAnchorMessageId: "user-1",
            workflowEvents: [
              { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            ],
            appSettings: {
              ...initialAppState.appSettings,
              streamScrollDurationMs: 0,
            },
          }}
        >
          <WorkflowProgressProbe />
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      clientHeights.set(messages, 80);
      scrollHeights.set(messages, 420);

      await userEvent.click(screen.getByRole("button", { name: "add workflow" }));

      await waitFor(() => expect(messages.scrollTop).toBe(420));
      expect(messages.classList.contains("streaming-follow")).toBe(true);
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });
});
