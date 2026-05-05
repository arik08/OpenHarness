import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "../MessageList";
import { ArtifactPanel } from "../ArtifactPanel";
import { MarkdownMessage } from "../MarkdownMessage";
import { StreamingAssistantMessage } from "../StreamingAssistantMessage";
import { messageBottomFollowEvent } from "../../hooks/useMessageAutoFollow";
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

function WorkflowWriteDeltaProbe() {
  const { dispatch } = useAppState();
  const sendDelta = (content: string) => dispatch({
    type: "backend_event",
    event: {
      type: "tool_input_delta",
      tool_name: "write_file",
      tool_call_index: 0,
      arguments_delta: JSON.stringify({
        path: "outputs/internet-ai-future-report.html",
        content,
      }),
    },
  });
  return (
    <>
      <button type="button" onClick={() => sendDelta("<!doctype html>\n<section>1</section>")}>write first</button>
      <button type="button" onClick={() => sendDelta("<!doctype html>\n<section>1</section>\n<section>2</section>")}>write more</button>
    </>
  );
}

function WorkflowWriteCompleteProbe() {
  const { dispatch } = useAppState();
  return (
    <button
      type="button"
      onClick={() => {
        dispatch({
          type: "backend_event",
          event: {
            type: "tool_input_delta",
            tool_name: "write_file",
            tool_call_index: 0,
            arguments_delta: JSON.stringify({
              path: "outputs/internet-ai-future-report.html",
              content: "<!doctype html>\n<section>완성 중</section>",
            }),
          },
        });
        dispatch({
          type: "backend_event",
          event: {
            type: "tool_completed",
            tool_name: "file_write",
            tool_call_index: 0,
            output: "outputs/internet-ai-future-report.html",
          },
        });
      }}
    >
      complete write
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

function StreamingCompleteProbe({ answer }: { answer: string }) {
  const { dispatch } = useAppState();
  return (
    <button
      type="button"
      onClick={() => {
        dispatch({
          type: "backend_event",
          event: { type: "assistant_delta", message: answer },
        });
        dispatch({
          type: "backend_event",
          event: { type: "assistant_complete", message: answer },
        });
      }}
    >
      complete stream
    </button>
  );
}

describe("MessageList", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
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

  it("renders prompt mentions as inline pills in user messages", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: "안녕하세요 $gstack-autoplan 당신은 누구입니까 $plugin:vercel 나는 @outputs/report.md" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const skill = screen.getByText("gstack-autoplan");
    const plugin = screen.getByText("Vercel");
    const file = screen.getByText("report.md");
    expect(skill.className).toContain("prompt-token skill");
    expect(plugin.className).toContain("prompt-token plugin");
    expect(file.className).toContain("prompt-token file");
    expect(document.querySelector(".react-message-text")?.textContent).toContain("당신은 누구입니까");
  });

  it("renders workflow code fences as readable stage diagrams", () => {
    render(
      <MarkdownMessage
        text={[
          "워크플로우는 다음과 같습니다.",
          "",
          "```workflow",
          "[요건 파악] 범위와 성공 기준 확인",
          "[데이터 수집] 원천 파일 수집 -> [정규화] 스키마 맞춤",
          "[API 점검] 엔드포인트 확인 -> [통합 테스트] 시나리오 실행",
          "[정규화] -> [통합 테스트] -> [릴리스 판단] go/no-go 정리",
          "```",
        ].join("\n")}
      />,
    );

    expect(document.querySelector(".assistant-workflow-diagram")).toBeTruthy();
    expect(document.querySelector(".markdown-body pre")).toBeNull();
    expect(screen.getByText("1단계")).toBeTruthy();
    expect(screen.getByText("2단계")).toBeTruthy();
    expect(screen.getByText("3단계")).toBeTruthy();
    expect(screen.getByText("4단계")).toBeTruthy();
    expect(screen.getByText("요건 파악")).toBeTruthy();
    expect(screen.getByText("데이터 수집")).toBeTruthy();
    expect(screen.getByText("API 점검")).toBeTruthy();
    expect(screen.getByText("정규화")).toBeTruthy();
    expect(screen.getByText("통합 테스트")).toBeTruthy();
    expect(screen.getByText("릴리스 판단")).toBeTruthy();
    expect(screen.getByText("go/no-go 정리")).toBeTruthy();
    expect(screen.queryByText("병렬 조사")).toBeNull();
  });

  it("renders repeated labels and arrow-list workflow fences as generic DAG layers", () => {
    render(
      <MarkdownMessage
        text={[
          "```",
          "[요건 범위화] 2025~2026 데이터센터 산업 + 오라클 포함",
          "  -> [1차 병렬 증거 수집] 글로벌 수요·용량",
          "  -> [1차 병렬 증거 수집] Oracle/OCI·CAPEX",
          "  -> [1차 병렬 증거 수집] 전력·냉각·정책 병목",
          "  -> [1차 병렬 증거 수집] 한국·APAC 현황",
          "  -> [결과 병합] 중복 제거·수치 기준연도 정렬",
          "  -> [정리] 핵심 현황/시사점 구조화",
          "  -> [검토] 출처 신뢰도·수치·연도 확인",
          "  -> [최종 보고] 요약 + 표 + 주요 근거",
          "```",
        ].join("\n")}
      />,
    );

    expect(document.querySelector(".assistant-workflow-diagram")).toBeTruthy();
    expect(document.querySelector(".assistant-workflow-diagram.many-stages")).toBeTruthy();
    expect(document.querySelector(".markdown-body pre")).toBeNull();
    expect(document.querySelectorAll(".assistant-workflow-stage")).toHaveLength(6);
    expect(document.querySelectorAll(".assistant-workflow-node")).toHaveLength(9);
    expect(screen.getAllByText("1차 병렬 증거 수집")).toHaveLength(4);
    expect(screen.getByText("Oracle/OCI·CAPEX")).toBeTruthy();
    expect(screen.getByText("요약 + 표 + 주요 근거")).toBeTruthy();
  });

  it("keeps an incomplete streaming workflow fence as plain live text instead of a flashing code block", () => {
    render(
      <StreamingAssistantMessage
        active
        settings={{ ...initialAppState.appSettings, streamStartBufferMs: 0, streamRevealDurationMs: 0 }}
        message={{
          id: "assistant-1",
          role: "assistant",
          text: [
            "```",
            "[요건 범위화] 2025~2026 데이터센터 산업 + 오라클 포함",
            "  -> [1차 병렬 증거 수집] 글로벌 수요·용량",
          ].join("\n")}
        }
      />,
    );

    expect(document.querySelector(".stream-live-text pre")).toBeNull();
    expect(document.querySelector(".assistant-workflow-diagram")).toBeNull();
    expect(screen.getByText(/요건 범위화/)).toBeTruthy();
  });

  it("keeps a one-node streaming workflow fence as plain live text", () => {
    render(
      <StreamingAssistantMessage
        active
        settings={{ ...initialAppState.appSettings, streamStartBufferMs: 0, streamRevealDurationMs: 0 }}
        message={{
          id: "assistant-1",
          role: "assistant",
          text: [
            "```",
            "[범위 설정] 2025~2026 데이터센터 산업 현황·오라클 포함",
          ].join("\n")}
        }
      />,
    );

    expect(document.querySelector(".stream-live-text pre")).toBeNull();
    expect(document.querySelector(".assistant-workflow-diagram")).toBeNull();
    expect(screen.getByText(/범위 설정/)).toBeTruthy();
  });

  it("collapses long user messages and lets them expand again", async () => {
    const user = userEvent.setup();
    const longText = [
      "첫 문단입니다. ".repeat(30),
      "둘째 문단입니다. ".repeat(30),
      "셋째 문단입니다. ".repeat(30),
    ].join("\n\n");
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: longText },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".user-collapsed-message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "더 보기" })).toBeTruthy();
    expect(document.querySelector(".user-message-preview")?.textContent).not.toContain("\n");

    await user.click(screen.getByRole("button", { name: "더 보기" }));

    expect(document.querySelector(".user-expanded-message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "접기" })).toBeTruthy();
    expect(document.querySelector(".user-expanded-message")?.textContent).toContain("셋째 문단입니다.");
  });

  it("keeps moderately sized multiline user messages expanded", () => {
    const reportPrompt = [
      "포스코 경영기획본부 임원에게 보고할거야.",
      "LLM 이후 대화형 챗봇과 RAG 기반 응답, Harness 기반 AI Agent의 발전을 설명하고,",
      "skill과 MCP의 중요성을 짧은 웹보고서로 정리해줘.",
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: reportPrompt },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".user-collapsed-message")).toBeNull();
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
    expect(document.body.textContent || "").toContain("Harness 기반 AI Agent");
  });

  it("does not render a bare @ shortcut marker as a file mention", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "user-1", role: "user", text: "@: 현재 프로젝트 파일을 선택합니다." },
            { id: "assistant-1", role: "assistant", text: "입력 단축키\n\n- @: 현재 프로젝트 파일을 선택합니다.\n- @outputs/report.md: 파일 참조" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect([...document.querySelectorAll(".prompt-token.file")].map((node) => node.textContent)).toEqual(["report.md"]);
    expect(document.body.textContent).toContain("@: 현재 프로젝트 파일을 선택합니다.");
  });

  it("renders skill tokens as inline pills in assistant markdown", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [
            { id: "assistant-1", role: "assistant", text: "`$dispatching-parallel-agents` 는 병렬 작업용 스킬입니다." },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const skill = screen.getByText("dispatching-parallel-agents");
    expect(skill.className).toContain("prompt-token skill");
    expect(document.querySelector(".markdown-body code")).toBeNull();
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

  it("does not render workflow chrome for the help command turn", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "/help" },
            { id: "assistant-1", role: "assistant", text: "사용 가능한 명령어:\n- /help 도움말" },
          ],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "작업 계획 수립", detail: "필요한 맥락과 진행 방향을 정리합니다.", status: "done", level: "parent" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".workflow-message")).toBeNull();
    expect(screen.getByText("사용 가능한 명령어")).toBeTruthy();
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
    expect(group?.querySelector('[data-workflow-role="purpose"]')?.textContent || "").toContain("판단 근거를 모으고 있습니다");
    expect(group?.querySelector('[data-workflow-role="purpose"]')?.textContent).toContain("정보 수집");
    const childTitles = [...(group?.querySelectorAll(".workflow-children .workflow-step.child strong") || [])]
      .map((node) => node.textContent);
    expect(childTitles).toEqual(["web_search", "web_fetch"]);
    expect(document.querySelector(".workflow-count")?.textContent).toBe("4개 기록 · 1개 실행 중");
  });

  it("renders a natural workflow narration for active verification work", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [{ id: "user-1", role: "user", text: "화면 점검해줘" }],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "결과 검증", detail: "결과를 확인하고 있습니다.", status: "running", level: "parent", role: "purpose", purpose: "verification", groupId: "group-verify" },
            { id: "workflow-3", toolName: "shell_command", title: "명령 실행", detail: "npm test", status: "done", level: "child", groupId: "group-verify" },
            { id: "workflow-4", toolName: "playwright", title: "브라우저 확인", detail: "localhost", status: "running", level: "child", groupId: "group-verify" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(90);
    });

    const narration = document.querySelector('[data-workflow-role="purpose"]')?.textContent || "";
    expect(narration).toContain("결과 검증");
    expect(narration).not.toContain("방금");
    expect(narration).toContain("오류나 깨진 화면이 없는지 검증");
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
      vi.advanceTimersByTime(630);
    });
    expect(document.querySelectorAll(".workflow-step")).toHaveLength(5);
    expect(document.body.textContent || "").toContain("web_searchfirst query");
    expect(document.body.textContent || "").toContain("web_searchsecond query");
    expect(document.body.textContent || "").toContain("example.com");
  });

  it("reveals the initial planning step shortly after request understanding", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [{ id: "user-1", role: "user", text: "작업해줘" }],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "작업 계획 수립", detail: "필요한 맥락과 진행 방향을 정리합니다.", status: "running", level: "parent", role: "planning" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(screen.getByText("요청 이해")).toBeTruthy();
    expect(screen.queryByText("작업 계획 수립")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(90);
    });

    expect(screen.queryByText("작업 계획 수립")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(130);
    });

    expect(screen.getByText("작업 계획 수립")).toBeTruthy();
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
    expect(articles[1].textContent || "").toContain("응답 작성이제 작업 결과를 정리");
    expect(articles[1].querySelector(".workflow-narration")).toBeNull();
    expect(articles[1].textContent || "").toContain("응답 작성이제 작업 결과를 정리");
    expect(articles[2].classList.contains("workflow-message")).toBe(false);
    expect(articles[2].classList.contains("assistant")).toBe(true);
  });

  it("keeps every workflow narration in the process instead of only the latest one", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [{ id: "user-1", role: "user", text: "구현해줘" }],
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "작업 계획 수립", detail: "진행 방향을 정했습니다.", status: "done", level: "parent", role: "planning" },
            { id: "workflow-3", toolName: "", title: "정보 수집", detail: "필요한 정보를 확인했습니다.", status: "done", level: "parent", role: "purpose", purpose: "info", groupId: "group-info" },
            { id: "workflow-4", toolName: "read_file", title: "파일 확인", detail: "index.html", status: "done", level: "child", groupId: "group-info" },
            { id: "workflow-5", toolName: "", title: "작업 실행", detail: "작업 실행을 마쳤습니다.", status: "done", level: "parent", role: "purpose", purpose: "action", groupId: "group-action" },
            { id: "workflow-6", toolName: "write_file", title: "파일 수정", detail: "preview.html", status: "done", level: "child", groupId: "group-action" },
            { id: "workflow-7", toolName: "", title: "응답 작성", detail: "답변 본문을 작성하고 있습니다.", status: "running", level: "parent", role: "final" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(490);
    });

    const workflowText = document.querySelector(".workflow-message")?.textContent || "";
    expect(workflowText).toContain("작업 계획 수립요청을 기준으로");
    expect(workflowText).toContain("정보 수집필요한 파일과 실행 결과를 훑으면서");
    expect(workflowText).toContain("작업 실행확인한 맥락을 바탕으로 실제 작업을 진행");
    expect(workflowText).not.toContain("방금");
    expect(workflowText).toContain("응답 작성이제 작업 결과를 정리");
    expect(document.querySelector(".workflow-narration")).toBeNull();
    expect(document.body.textContent || "").not.toContain("진행 방향을 정했습니다");
    expect(document.body.textContent || "").not.toContain("작업 실행을 마쳤습니다");
    expect(document.body.textContent || "").toContain("파일 확인index.html");
  });

  it("shows generated workflow narration for each repeated parent category", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [{ id: "user-1", role: "user", text: "계속 작업해줘" }],
          workflowAnchorMessageId: "user-1",
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "정보 수집", detail: "필요한 정보를 확인했습니다.", status: "done", level: "parent", role: "purpose", purpose: "info", groupId: "group-info-1" },
            { id: "workflow-2", toolName: "web_search", title: "web_search", detail: "first query", status: "done", level: "child", groupId: "group-info-1" },
            { id: "workflow-3", toolName: "", title: "정보 수집", detail: "필요한 정보를 확인했습니다.", status: "done", level: "parent", role: "purpose", purpose: "info", groupId: "group-info-2" },
            { id: "workflow-4", toolName: "web_search", title: "web_search", detail: "second query", status: "done", level: "child", groupId: "group-info-2" },
            { id: "workflow-5", toolName: "", title: "작업 실행", detail: "작업 실행을 마쳤습니다.", status: "done", level: "parent", role: "purpose", purpose: "action", groupId: "group-action-1" },
            { id: "workflow-6", toolName: "todo_write", title: "todo_write", detail: "- [x] 기존 구조 확인", status: "done", level: "child", groupId: "group-action-1" },
            { id: "workflow-7", toolName: "", title: "작업 실행", detail: "작업 실행을 마쳤습니다.", status: "done", level: "parent", role: "purpose", purpose: "action", groupId: "group-action-2" },
            { id: "workflow-8", toolName: "cmd", title: "cmd", detail: "npm test", status: "done", level: "child", groupId: "group-action-2" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const workflowText = document.querySelector(".workflow-message")?.textContent || "";
    expect(workflowText.match(/정보 수집:/g) || []).toHaveLength(0);
    expect(workflowText.match(/작업 실행:/g) || []).toHaveLength(0);
    expect(workflowText.match(/정보 수집/g) || []).toHaveLength(2);
    expect(workflowText.match(/작업 실행/g) || []).toHaveLength(2);
    expect(workflowText.match(/필요한 파일과 실행 결과를 훑으면서/g) || []).toHaveLength(2);
    expect(workflowText.match(/확인한 맥락을 바탕으로 실제 작업을 진행/g) || []).toHaveLength(2);
  });

  it("keeps completed parent explanations visible on every workflow record", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [{ id: "user-1", role: "user", text: "정리해줘" }],
          workflowAnchorMessageId: "user-1",
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "작업 계획 수립", detail: "진행 방향을 정했습니다.", status: "done", level: "parent", role: "planning" },
            { id: "workflow-3", toolName: "", title: "최종 답변", detail: "최종 답변을 작성했습니다.", status: "done", level: "parent", role: "final" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const workflowText = document.querySelector(".workflow-message")?.textContent || "";
    expect(workflowText).toContain("요청 이해");
    expect(workflowText).toContain("작업 계획 수립");
    expect(workflowText).toContain("사용자 요청을 확인했습니다");
    expect(workflowText).toContain("요청을 기준으로 필요한 맥락과 검증 기준을 정리");
    expect(workflowText).toContain("완료 · 최종 답변을 작성했습니다");
  });

  it("flattens multiline completed tool details into one compact line", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [{ id: "user-1", role: "user", text: "작업해줘" }],
          workflowAnchorMessageId: "user-1",
          workflowEvents: [
            { id: "workflow-1", toolName: "todo_write", title: "todo_write", detail: "- [ ] 기존 HTML 구조 확인\n- [ ] 화면 점검", status: "done", level: "child" },
            { id: "workflow-2", toolName: "cmd", title: "cmd", detail: "{\n  \"command\": \"npm test\"\n}", status: "done", level: "child" },
            { id: "workflow-3", toolName: "", title: "최종 답변", detail: "최종 답변을 작성했습니다.", status: "done", level: "parent", role: "final" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const workflowText = document.querySelector(".workflow-message")?.textContent || "";
    expect(workflowText).toContain("작업 목록 정리할 일을 정리했습니다.");
    expect(workflowText).not.toContain("todo_write");
    expect(workflowText).toContain("cmd{");
    expect(workflowText).toContain("\"command\"");
  });

  it("shows todo_write as a short user-facing checklist step", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [{ id: "user-1", role: "user", text: "보고서 작성해줘" }],
          workflowAnchorMessageId: "user-1",
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "todo_write",
              title: "todo_write",
              detail: "TODO.md",
              status: "running",
              level: "child",
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const workflowText = document.querySelector(".workflow-message")?.textContent || "";
    expect(workflowText).toContain("작업 목록 정리");
    expect(workflowText).not.toContain("todo_write");
    expect(workflowText).not.toContain("TODO.md");
  });

  it("does not describe failed todo_write steps as completed", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          messages: [{ id: "user-1", role: "user", text: "보고서 작성해줘" }],
          workflowAnchorMessageId: "user-1",
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "todo_write",
              title: "작업 목록 정리",
              detail: "Invalid input for todo_write: Either item or todos must be provided",
              status: "error",
              level: "child",
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const workflowText = document.querySelector(".workflow-message")?.textContent || "";
    expect(workflowText).toContain("작업 목록 정리");
    expect(workflowText).toContain("오류");
    expect(workflowText).toContain("할 일 정리에 실패했습니다.");
    expect(workflowText).toContain("입력 형식 오류");
    expect(workflowText).not.toContain("todo_write");
    expect(workflowText).not.toContain("할 일을 정리했습니다.");
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

  it("updates the active workflow total duration every second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T00:00:00Z"));

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          messages: [
            { id: "user-1", role: "user", text: "테스트해줘" },
            { id: "assistant-1", role: "assistant", text: "작성 중입니다." },
          ],
          workflowAnchorMessageId: "user-1",
          workflowStartedAtMs: Date.now(),
          workflowEvents: [
            { id: "workflow-1", toolName: "", title: "요청 이해", detail: "사용자 요청을 확인했습니다.", status: "done", level: "parent" },
            { id: "workflow-2", toolName: "", title: "응답 작성", detail: "답변 본문을 작성하고 있습니다.", status: "running", level: "parent", role: "final" },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const workflowArticle = [...document.querySelectorAll("article.message")]
      .map((node) => node.textContent || "")
      .find((text) => text.includes("작업 진행")) || "";

    expect(workflowArticle).toContain("2개 기록 (1초)");
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

  it("does not collapse long completed write tool content in the workflow output preview body", () => {
    const longContent = [
      "첫 줄입니다.",
      ...Array.from({ length: 24 }, (_, index) => `긴 본문 ${index + 1}번째 줄입니다.`),
      "</html>",
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "긴 HTML 파일 만들어줘" },
          ],
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "write_file",
              title: "write_file",
              detail: "outputs/long-report.html",
              status: "done",
              level: "child",
              toolInput: {
                path: "outputs/long-report.html",
                content: longContent,
              },
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const body = document.querySelector(".workflow-output-body") as HTMLElement;
    expect(body.textContent).toBe(longContent);
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
    expect(screen.getByText(/\d+ 토큰 \(26줄\)/)).toBeTruthy();
  });

  it("does not collapse long write tool content while it is still streaming", () => {
    const longContent = [
      "<!doctype html>",
      ...Array.from({ length: 24 }, (_, index) => `<section>작성 중 ${index + 1}</section>`),
      "</html>",
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "긴 HTML 파일 만들어줘" },
          ],
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "write_file",
              title: "write_file",
              detail: "outputs/internet-ai-future-report.html",
              status: "running",
              level: "child",
              toolInput: {
                path: "outputs/internet-ai-future-report.html",
                content: longContent,
              },
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const body = document.querySelector(".workflow-output-body") as HTMLElement;
    expect(screen.getByText("작성 중인 결과물 - internet-ai-future-report.html")).toBeTruthy();
    expect(body.textContent).toBe(longContent);
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
  });

  it("renders one running write preview for duplicate same-path workflow events", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "HTML 파일 만들어줘" },
          ],
          workflowEvents: [
            {
              id: "workflow-1",
              toolName: "write_file",
              title: "write_file",
              detail: "outputs/tailwind_design_system_필요성_보고서.html",
              status: "running",
              level: "child",
              toolInput: {
                path: "outputs/tailwind_design_system_필요성_보고서.html",
                content: "<!doctype html>",
              },
            },
            {
              id: "workflow-2",
              toolName: "write_file",
              title: "write_file",
              detail: "파일 작업 중... 21초 경과 · outputs/tailwind_design_system_필요성_보고서.html",
              status: "running",
              level: "child",
              toolInput: {
                path: "outputs/tailwind_design_system_필요성_보고서.html",
              },
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelectorAll(".workflow-step.child")).toHaveLength(1);
    expect(document.querySelectorAll(".workflow-output-preview")).toHaveLength(1);
    expect(screen.getByText("작성 중인 결과물 - tailwind_design_system_필요성_보고서.html")).toBeTruthy();
    expect(document.querySelector(".workflow-output-body")?.textContent).toBe("<!doctype html>");
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

  it("does not move the message list scroll when streamed write content grows", async () => {
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
            workflowAnchorMessageId: "user-1",
            messages: [
              { id: "user-1", role: "user", text: "인터넷 AI 미래 보고서 작성해줘" },
            ],
            appSettings: {
              ...initialAppState.appSettings,
              streamScrollDurationMs: 0,
            },
          }}
        >
          <WorkflowWriteDeltaProbe />
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      clientHeights.set(messages, 80);
      scrollHeights.set(messages, 420);

      await userEvent.click(screen.getByRole("button", { name: "write first" }));
      await waitFor(() => expect(messages.scrollTop).toBe(420));

      await waitFor(() => expect(document.querySelector(".workflow-output-body")).toBeTruthy());
      const body = document.querySelector(".workflow-output-body") as HTMLElement;
      scrollHeights.set(body, 640);
      messages.scrollTop = 111;
      messages.dataset.lastScrollTop = "111";
      await userEvent.click(screen.getByRole("button", { name: "write more" }));

      expect(messages.scrollTop).toBe(111);
      expect(body.scrollTop).toBe(640);
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });

  it("replaces a streamed write preview when the completed tool name differs", async () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          workflowAnchorMessageId: "user-1",
          messages: [
            { id: "user-1", role: "user", text: "HTML 파일 만들어줘" },
          ],
        }}
      >
        <WorkflowWriteCompleteProbe />
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "complete write" }).click();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByText("작성 중인 결과물 - internet-ai-future-report.html")).toBeNull();
    expect(screen.getByText("작성 완료 - internet-ai-future-report.html")).toBeTruthy();
    expect(document.querySelectorAll(".workflow-output-preview")).toHaveLength(1);
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
    expect(document.querySelector(".assistant-actions .answer-web-sources")).toBeTruthy();
    await user.click(screen.getByText("출처"));
    expect((document.querySelector(".answer-web-sources") as HTMLDetailsElement | null)?.open).toBe(true);
    expect(screen.getByRole("link", { name: /example\.com.*\/docs/ }).getAttribute("href")).toBe("https://example.com/docs");
    expect(screen.getByRole("link", { name: /github\.com.*\/example\/myharness/ }).getAttribute("href")).toBe("https://github.com/example/myharness");
    expect(screen.getAllByText("myharness docs")).toHaveLength(2);
    expect(screen.getByText("web_search")).toBeTruthy();
    await user.click(screen.getByText("조사 결과입니다."));
    expect((document.querySelector(".answer-web-sources") as HTMLDetailsElement | null)?.open).toBe(false);
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

  it("renders resolved artifact cards at the file reference and opens the preview panel", async () => {
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
              text: "완료했습니다.\n\n- 보고서 파일: `outputs/super-ai-worm-game.html`\n\n포함 내용입니다.",
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
    expect(card.closest(".assistant-artifact-inline")).toBeTruthy();
    expect(document.body.textContent || "").not.toContain("파일: outputs/super-ai-worm-game.html");
    expect(document.body.textContent || "").not.toContain("파일: `");
    expect(document.body.textContent || "").not.toContain("보고서 파일:");
    const assistantContent = document.querySelector(".assistant-artifact-content")?.textContent || "";
    expect(assistantContent.indexOf("완료했습니다.")).toBeLessThan(assistantContent.indexOf("super-ai-worm-game.html"));
    expect(assistantContent.indexOf("super-ai-worm-game.html")).toBeLessThan(assistantContent.indexOf("포함 내용입니다."));

    await userEvent.click(card);

    const frame = await screen.findByTitle("super-ai-worm-game.html") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.srcdoc).toContain("AI Worm");
  });

  it("replaces artifact labels and multiline wrappers with only the artifact card", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/artifact/resolve?")) {
        return {
          ok: true,
          json: async () => ({
            path: "outputs/financial-office-ai-report.html",
            name: "financial-office-ai-report.html",
            kind: "html",
            size: 18_022,
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
              text: "작성 완료했습니다.\n\n- 산출물:`\noutputs/financial-office-ai-report.html\n`\n",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const card = await screen.findByRole("button", { name: "financial-office-ai-report.html 미리보기 열기" });
    expect(card.closest(".assistant-artifact-inline")).toBeTruthy();
    const assistantContent = document.querySelector(".assistant-artifact-content")?.textContent || "";
    expect(assistantContent).toContain("작성 완료했습니다.");
    expect(assistantContent).toContain("financial-office-ai-report.html");
    expect(assistantContent).not.toContain("산출물:");
    expect(assistantContent).not.toContain("`");
  });

  it("collapses a separate file location wrapper to only the artifact card", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/artifact/resolve?")) {
        return {
          ok: true,
          json: async () => ({
            path: "데이터센터_산업_웹보고서.html",
            name: "데이터센터_산업_웹보고서.html",
            kind: "html",
            size: 16_589,
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
              text: "다시 작성했습니다.\n\n파일 위치:\n`\n데이터센터_산업_웹보고서.html\n`\n\n변경 방향은 다음과 같습니다.",
              isComplete: true,
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const card = await screen.findByRole("button", { name: "데이터센터_산업_웹보고서.html 미리보기 열기" });
    expect(card.closest(".assistant-artifact-inline")).toBeTruthy();
    const assistantContent = document.querySelector(".assistant-artifact-content")?.textContent || "";
    expect(assistantContent).toContain("다시 작성했습니다.");
    expect(assistantContent).toContain("데이터센터_산업_웹보고서.html");
    expect(assistantContent).toContain("변경 방향은 다음과 같습니다.");
    expect(assistantContent).not.toContain("파일 위치");
    expect(assistantContent).not.toContain("`");
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
    localStorage.setItem("myharness:scrollPositions", JSON.stringify({ "session-old": 240 }));

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

  it("keeps completed history reading fixed when bottom-follow is requested", async () => {
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
      localStorage.setItem("myharness:scrollPositions", JSON.stringify({ "session-old": 240 }));
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
      scrollHeights.set(messages, 900);
      clientHeights.set(messages, 300);
      await waitFor(() => expect(messages.scrollTop).toBe(240));

      await act(async () => {
        window.dispatchEvent(new Event(messageBottomFollowEvent));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(messages.scrollTop).toBe(240);
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
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

  it("renders the active streaming assistant answer as soon as text arrives", () => {
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

    expect(document.body.textContent || "").toContain("스트리밍 답변입니다.");
  });

  it("renders stable streaming markdown while updating the live tail in place", () => {
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
    expect(document.body.textContent || "").toContain("스트");

    act(() => {
      screen.getByText("delta two").click();
    });

    expect(document.body.textContent || "").not.toContain("스트리밍 답변입니다.");

    act(() => {
      vi.advanceTimersByTime(initialAppState.appSettings.streamStartBufferMs);
    });

    const firstParagraph = document.querySelector(".stream-live-text p");
    expect(firstParagraph?.textContent).toBe("스트리밍 답변");
    expect(document.querySelector(".stream-reveal-sentence")?.textContent).toBe("리밍 답변");

    act(() => {
      vi.advanceTimersByTime(80);
    });

    expect(document.body.textContent || "").toContain("스트리밍 답변입니다.");
    expect(document.querySelector(".stream-reveal-sentence")?.textContent).toBe("입니다.");
  });

  it("uses the reveal duration setting to pace horizontal streaming updates", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          appSettings: {
            ...initialAppState.appSettings,
            streamRevealDurationMs: 600,
          },
        }}
      >
        <StreamingDeltaProbe />
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      screen.getByText("delta one").click();
    });
    act(() => {
      screen.getByText("delta two").click();
    });
    act(() => {
      vi.advanceTimersByTime(initialAppState.appSettings.streamStartBufferMs);
    });
    expect(document.querySelector(".stream-live-text p")?.textContent).toBe("스트리밍 답변");

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(document.querySelector(".stream-live-text p")?.textContent).toBe("스트리밍 답변");

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(document.querySelector(".stream-live-text p")?.textContent).toBe("스트리밍 답변입니다.");
  });

  it("applies the follow lead setting while streaming", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          appSettings: {
            ...initialAppState.appSettings,
            streamFollowLeadPx: 120,
          },
          messages: [
            { id: "assistant-1", role: "assistant", text: "스트리밍 중", isComplete: false },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    const messages = document.querySelector(".messages") as HTMLElement;
    expect(messages.classList.contains("streaming-follow")).toBe(true);
    expect(messages.style.getPropertyValue("--stream-follow-lead")).toBe("120px");
  });

  it("keeps completed streaming blocks rendered as markdown before the answer completes", () => {
    vi.useFakeTimers();
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          appSettings: {
            ...initialAppState.appSettings,
            streamStartBufferMs: 0,
          },
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "**완료된 요약**\n\n현재 문장을 쓰는 중",
            },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".react-streaming-text strong")?.textContent).toBe("완료된 요약");
    const liveTail = document.querySelector(".stream-live-text p")?.firstChild;
    expect(liveTail?.textContent).toBe("현재 문장을 쓰는 중");
  });

  it("keeps a trailing streaming markdown table as raw text until the answer completes", () => {
    const tableMarkdown = [
      "| 항목 | 값 |",
      "| --- | --- |",
      "| A | 1 |",
    ].join("\n");

    const { rerender } = render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          messages: [
            { id: "assistant-1", role: "assistant", text: tableMarkdown },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".markdown-pending-table")).toBeTruthy();
    expect(document.querySelector(".markdown-body table")).toBeNull();
    expect(document.body.textContent || "").toContain("| 항목 | 값 |");

    rerender(
      <AppStateProvider
        key="complete"
        initialState={{
          ...initialAppState,
          messages: [
            { id: "assistant-1", role: "assistant", text: tableMarkdown, isComplete: true },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".markdown-pending-table")).toBeNull();
    expect(document.querySelector(".markdown-body table")).toBeTruthy();
    expect(screen.getByText("항목")).toBeTruthy();
  });

  it.each(["|", "| A |"])("does not render a streaming markdown table when the next row is only partially received: %s", (partialRow) => {
    const tableMarkdown = [
      "| 항목 | 값 |",
      "| --- | --- |",
      partialRow,
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          messages: [
            { id: "assistant-1", role: "assistant", text: tableMarkdown },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".markdown-pending-table")).toBeTruthy();
    expect(document.querySelector(".markdown-body table")).toBeNull();
    expect(document.body.textContent || "").toContain(partialRow);
  });

  it("keeps a trailing streaming markdown table with a final newline as raw text", () => {
    const tableMarkdown = [
      "| 항목 | 값 |",
      "| --- | --- |",
      "| A | 1 |",
      "",
    ].join("\n");

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          busy: true,
          messages: [
            { id: "assistant-1", role: "assistant", text: tableMarkdown },
          ],
        }}
      >
        <MessageList />
      </AppStateProvider>,
    );

    expect(document.querySelector(".markdown-pending-table")).toBeTruthy();
    expect(document.querySelector(".markdown-body table")).toBeNull();
    expect(document.body.textContent || "").toContain("| 항목 | 값 |");
  });

  it("renders a completed answer immediately even when it finished before the buffer flushed", () => {
    vi.useFakeTimers();
    const answer = [
      "시작: 스트리밍이 보이는 첫 문장입니다.",
      ...Array.from({ length: 40 }, (_, index) => `중간 문장 ${index}번입니다.`),
      "끝부분: 완료 이벤트가 오면 답변이 바로 보여야 합니다.",
    ].join(" ");

    render(
      <AppStateProvider initialState={{ ...initialAppState, busy: true }}>
        <StreamingCompleteProbe answer={answer} />
        <MessageList />
      </AppStateProvider>,
    );

    act(() => {
      screen.getByText("complete stream").click();
    });

    expect(document.body.textContent || "").toContain("시작");
    expect(document.body.textContent || "").toContain("끝부분");
    expect(document.querySelector(".react-streaming-text")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(document.body.textContent || "").toContain("끝부분");
  });

  it("keeps following the bottom as streaming text becomes visible", () => {
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
            appSettings: {
              ...initialAppState.appSettings,
              streamScrollDurationMs: 0,
            },
          }}
        >
          <StreamingDeltaProbe />
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      clientHeights.set(messages, 80);
      scrollHeights.set(messages, 340);

      act(() => {
        screen.getByText("delta one").click();
      });

      expect(messages.scrollTop).toBe(340);
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });

  it("stops following when the user scrolls upward near the streaming tail", () => {
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
              { id: "assistant-1", role: "assistant", text: "스트리밍 중", isComplete: false },
            ],
            appSettings: {
              ...initialAppState.appSettings,
              streamScrollDurationMs: 0,
            },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      clientHeights.set(messages, 200);
      scrollHeights.set(messages, 1000);
      messages.scrollTop = 720;
      messages.dataset.lastScrollTop = "880";

      fireEvent.scroll(messages);

      expect(messages.scrollTop).toBe(720);
      expect(messages.classList.contains("streaming-follow")).toBe(false);
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

  it("eases continuous streaming follow into sudden target growth", () => {
    const animationFrames: FrameRequestCallback[] = [];
    const scrollHeights = new WeakMap<Element, number>();
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
        return this.classList?.contains("messages") ? scrollHeights.get(this) ?? 800 : originalScrollHeight?.get?.call(this) ?? 0;
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
            busy: true,
            messages: [
              { id: "assistant-1", role: "assistant", text: "스트리밍 중", isComplete: false },
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
      scrollHeights.set(messages, 800);
      const samples: number[] = [];
      for (const now of [0, 16]) {
        const frame = animationFrames.shift();
        expect(frame).toBeTruthy();
        act(() => frame?.(now));
        samples.push(messages.scrollTop);
      }
      scrollHeights.set(messages, 1400);
      for (const now of [32, 48, 64]) {
        const frame = animationFrames.shift();
        expect(frame).toBeTruthy();
        act(() => frame?.(now));
        samples.push(messages.scrollTop);
      }

      const deltas = samples.slice(1).map((value, index) => value - samples[index]);
      const accelerations = deltas.slice(1).map((value, index) => value - deltas[index]);
      expect(Math.max(...accelerations)).toBeLessThan(5);
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

  it("keeps following the bottom as staggered workflow rows become visible", async () => {
    vi.useFakeTimers();
    const scrollTopValues = new WeakMap<Element, number>();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if (this.classList?.contains("messages")) {
          const visibleStepCount = document.querySelectorAll(".workflow-step").length;
          return 220 + visibleStepCount * 120;
        }
        return originalScrollHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.classList?.contains("messages") ? 80 : originalClientHeight?.get?.call(this) ?? 0;
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
              { id: "user-1", role: "user", text: "진행 상황 보여줘" },
            ],
            workflowAnchorMessageId: "user-1",
            workflowEvents: [
              { id: "workflow-1", toolName: "", title: "작업 실행", detail: "작업 중입니다.", status: "running", level: "parent", role: "purpose", purpose: "action", groupId: "group-action" },
              { id: "workflow-2", toolName: "read_file", title: "파일 확인", detail: "a.ts", status: "done", level: "child", groupId: "group-action" },
              { id: "workflow-3", toolName: "file_edit", title: "파일 수정", detail: "b.ts", status: "running", level: "child", groupId: "group-action" },
            ],
            appSettings: {
              ...initialAppState.appSettings,
              streamScrollDurationMs: 0,
            },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      const messages = document.querySelector(".messages") as HTMLElement;
      expect(document.querySelectorAll(".workflow-step")).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(90);
      });

      expect(document.querySelectorAll(".workflow-step")).toHaveLength(2);
      expect(messages.scrollTop).toBe(460);

      act(() => {
        vi.advanceTimersByTime(90);
      });

      expect(document.querySelectorAll(".workflow-step")).toHaveLength(3);
      expect(messages.scrollTop).toBe(580);
    } finally {
      vi.useRealTimers();
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
    }
  });
});
