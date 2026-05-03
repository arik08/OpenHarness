import { describe, expect, it, vi } from "vitest";
import { appReducer, initialAppState } from "../reducer";

vi.stubGlobal("crypto", { randomUUID: () => "message-1" });

describe("appReducer", () => {
  it("applies ready snapshots", () => {
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "ready",
        state: {
          provider: "codex",
          provider_label: "Codex",
          model: "gpt-5",
          effort: "medium",
          permission_mode: "full_auto",
          workspace: {
            name: "Default",
            path: "C:/demo",
            scope: { mode: "shared", name: "shared", root: "C:/root" },
          },
        },
      },
    });

    expect(next.ready).toBe(true);
    expect(next.statusText).toBe("준비됨");
    expect(next.workspaceName).toBe("Default");
  });

  it("appends assistant deltas to the active assistant message", () => {
    const first = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "assistant_delta", message: "안녕" },
    });
    const second = appReducer(first, {
      type: "backend_event",
      event: { type: "assistant_delta", message: "하세요" },
    });

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].text).toBe("안녕하세요");
  });

  it("shows answer drafting progress while assistant text streams", () => {
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "assistant_delta", message: "HTML 작성 중" },
    });

    const answerEvent = next.workflowEvents.find((event) => event.role === "final");
    expect(next.busy).toBe(true);
    expect(answerEvent?.title).toBe("응답 작성");
    expect(answerEvent?.status).toBe("running");
    expect(answerEvent?.detail).toContain("수신 중");
  });

  it("accepts legacy assistant delta value payloads", () => {
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "assistant_delta", value: "fallback" },
    });

    expect(next.messages[0].text).toBe("fallback");
  });

  it("uses assistant completion text as the final answer", () => {
    const streaming = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "assistant_delta", message: "임시" },
    });
    const completed = appReducer(streaming, {
      type: "backend_event",
      event: { type: "assistant_complete", message: "최종 답변" },
    });

    expect(completed.messages).toHaveLength(1);
    expect(completed.messages[0].text).toBe("최종 답변");
    expect(completed.messages[0].isComplete).toBe(true);
    expect(completed.busy).toBe(false);
  });

  it("does not mark tool-use assistant completions as final answers", () => {
    const completed = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "assistant_complete", message: "도구 호출 준비", has_tool_uses: true },
    });

    expect(completed.messages[0].text).toBe("도구 호출 준비");
    expect(completed.messages[0].isComplete).toBe(false);
    expect(completed.busy).toBe(true);
  });

  it("ignores duplicate regular backend user transcript because the composer already rendered it", () => {
    const withOptimisticUser = appReducer(initialAppState, {
      type: "append_message",
      message: { role: "user", text: "안녕?" },
    });
    const optimistic = appReducer(withOptimisticUser, {
      type: "backend_event",
      event: { type: "transcript_item", item: { role: "user", text: "안녕?" } },
    });

    expect(optimistic.messages).toHaveLength(1);
    expect(optimistic.messages[0].text).toBe("안녕?");
  });

  it("restores regular backend user transcript when reconnecting to a live answer", () => {
    const reconnected = appReducer(
      { ...initialAppState, sessionId: "session-live", busy: true },
      {
        type: "backend_event",
        event: { type: "transcript_item", item: { role: "user", text: "진행 중 재접속 질문" } },
      },
    );

    expect(reconnected.messages).toHaveLength(1);
    expect(reconnected.messages[0]).toMatchObject({
      role: "user",
      text: "진행 중 재접속 질문",
    });
  });

  it("renders local composer user messages", () => {
    const next = appReducer({ ...initialAppState, sessionId: "session-live" }, {
      type: "append_message",
      message: { role: "user", text: "안녕?" },
    });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("user");
    expect(next.messages[0].text).toBe("안녕?");
  });

  it("shows a new live chat in history as soon as the user sends a message", () => {
    const next = appReducer({ ...initialAppState, sessionId: "session-live", chatTitle: "MyHarness" }, {
      type: "append_message",
      message: { role: "user", text: "왼쪽 history 갱신 테스트" },
    });

    expect(next.history[0]).toMatchObject({
      value: "session-live",
      label: "진행 중인 채팅",
      description: "왼쪽 history 갱신 테스트",
    });
  });

  it("removes stale live history rows for the backend session that becomes active", () => {
    const next = appReducer(
      {
        ...initialAppState,
        sessionId: "old-session",
        history: [
          {
            value: "web-current",
            label: "진행 중인 채팅",
            description: "열려 있는 세션",
            live: true,
            liveSessionId: "web-current",
            busy: false,
          },
          {
            value: "saved-old",
            label: "5/3 10:00 2 msg",
            description: "저장된 대화",
          },
        ],
      },
      {
        type: "session_started",
        sessionId: "web-current",
        clientId: "client-1",
      },
    );

    expect(next.history.map((item) => item.value)).toEqual(["saved-old"]);
  });

  it("keeps queued and steering user transcript items visible", () => {
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "transcript_item", item: { role: "user", text: "추가 지시", kind: "steering" } },
    });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].text).toBe("추가 지시");
    expect(next.messages[0].kind).toBe("steering");
  });

  it("hides plan mode steering transcript items", () => {
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "transcript_item", item: { role: "user", text: "/plan", kind: "steering" } },
    });

    expect(next.messages).toHaveLength(0);
  });

  it("hides plan mode status transcript items", () => {
    const enabled = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "transcript_item", item: { role: "system", text: "Plan mode enabled." } },
    });
    const disabled = appReducer(enabled, {
      type: "backend_event",
      event: { type: "transcript_item", item: { role: "system", text: "Plan mode disabled." } },
    });

    expect(disabled.messages).toHaveLength(0);
  });

  it("marks the ui idle on line completion", () => {
    const busy = appReducer(initialAppState, { type: "set_busy", value: true });
    const next = appReducer(busy, { type: "backend_event", event: { type: "line_complete" } });

    expect(next.busy).toBe(false);
    expect(next.artifactRefreshKey).toBe(busy.artifactRefreshKey + 1);
    expect(next.historyRefreshKey).toBe(busy.historyRefreshKey + 1);
  });

  it("keeps backend errors visible after line completion", () => {
    const withUserMessage = appReducer(initialAppState, {
      type: "append_message",
      message: { role: "user", text: "하이????" },
    });
    const errored = appReducer(withUserMessage, {
      type: "backend_event",
      event: { type: "error", message: "Network error: Connection error." },
    });
    const completed = appReducer(errored, {
      type: "backend_event",
      event: { type: "line_complete" },
    });

    expect(completed.busy).toBe(false);
    expect(completed.status).toBe("error");
    expect(completed.messages).toHaveLength(2);
    expect(completed.messages[1].role).toBe("system");
    expect(completed.messages[1].isError).toBe(true);
    expect(completed.messages[1].text).toContain("Network error");
  });

  it("drops a dead backend session so the UI can reconnect instead of reusing it", () => {
    const started = appReducer(initialAppState, {
      type: "session_started",
      sessionId: "dead-session",
      clientId: "client-1",
    });
    const busy = appReducer(started, { type: "set_busy", value: true });
    const next = appReducer(busy, {
      type: "backend_event",
      event: { type: "shutdown", message: "Backend exited with code 1" },
    });

    expect(next.sessionId).toBeNull();
    expect(next.busy).toBe(false);
    expect(next.ready).toBe(false);
    expect(next.status).toBe("connecting");
    expect(next.statusText).toBe("세션이 종료되어 새 세션에 다시 연결 중입니다.");
    expect(next.messages.at(-1)?.text).toContain("진행 중이던 세션이 종료되었습니다.");
  });

  it("ignores shutdown events from a stale backend session", () => {
    const current = {
      ...initialAppState,
      sessionId: "current-session",
      clientId: "client-1",
      ready: true,
      status: "ready" as const,
      statusText: "준비됨",
    };
    const next = appReducer(current, {
      type: "backend_event",
      sessionId: "old-session",
      event: { type: "shutdown", message: "Backend exited with code 0" },
    });

    expect(next.sessionId).toBe("current-session");
    expect(next.ready).toBe(true);
    expect(next.status).toBe("ready");
  });

  it("renders stale session errors as actionable Korean text", () => {
    const errored = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "error", message: "Unknown session" },
    });

    expect(errored.messages[0].text).toBe("세션 연결이 끊겼습니다. 페이지를 새로고침하거나 새 세션을 시작한 뒤 다시 시도해주세요.");
    expect(errored.statusText).toBe("세션 연결이 끊겼습니다. 페이지를 새로고침하거나 새 세션을 시작한 뒤 다시 시도해주세요.");
  });

  it("localizes the known brainstorming browser prompt before display", () => {
    const prompt = "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)";
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "assistant_complete", message: prompt },
    });

    expect(next.messages[0].text).toBe("브라우저로 간단한 목업, 다이어그램, 비교 화면 같은 시각 자료를 함께 보여드리면 더 설명하기 쉬울 수 있습니다. 이 기능은 아직 새 기능이라 토큰을 조금 더 쓸 수 있습니다. 사용해볼까요? (로컬 URL을 여는 과정이 필요합니다)");
  });

  it("tracks tool completion without rendering raw tool output as a chat message", () => {
    const started = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "tool_started", tool_name: "skill", tool_input: { name: "using-superpowers" } },
    });
    const next = appReducer(started, {
      type: "backend_event",
      event: { type: "tool_completed", tool_name: "skill", output: "Skill: using-superpowers" },
    });

    expect(next.messages).toHaveLength(0);
    expect(next.workflowEvents.map((event) => event.title)).toEqual([
      "요청 이해",
      "작업 계획 수립",
      "작업 실행",
      "skill",
      "다음 판단 중",
    ]);
    expect(next.workflowEvents.find((event) => event.toolName === "skill")?.status).toBe("done");
  });

  it("stores todo markdown from backend updates", () => {
    const next = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "todo_update", todo_markdown: "- [ ] 조사\n- [x] 정리" },
    });

    expect(next.todoMarkdown).toContain("조사");
  });

  it("preserves and resets todo collapsed state like the legacy checklist", () => {
    const shown = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "todo_update", todo_markdown: "- [ ] 조사" },
    });
    const collapsed = appReducer(shown, { type: "toggle_todo_collapsed" });
    const updated = appReducer(collapsed, {
      type: "backend_event",
      event: { type: "todo_update", todo_markdown: "- [x] 조사\n- [ ] 반영" },
    });
    const dismissed = appReducer(updated, { type: "dismiss_todo" });

    expect(collapsed.todoCollapsed).toBe(true);
    expect(updated.todoCollapsed).toBe(true);
    expect(dismissed.todoCollapsed).toBe(false);
  });

  it("applies generated session titles to the active chat and history", () => {
    const base = {
      ...initialAppState,
      sessionId: "session-1",
      history: [
        { value: "session-1", label: "오늘", description: "MyHarness" },
        { value: "session-2", label: "어제", description: "다른 제목" },
      ],
    };

    const next = appReducer(base, {
      type: "backend_event",
      event: { type: "session_title", message: "React 제목 생성 수정" },
    });

    expect(next.chatTitle).toBe("React 제목 생성 수정");
    expect(next.history[0].description).toBe("React 제목 생성 수정");
    expect(next.history[1].description).toBe("다른 제목");
  });

  it("tracks the backend saved session id as the active history item", () => {
    const next = appReducer(
      {
        ...initialAppState,
        restoringHistory: true,
      },
      {
        type: "backend_event",
        event: { type: "active_session", value: "saved-session-1" },
      },
    );

    expect(next.activeHistoryId).toBe("saved-session-1");
    expect(next.restoringHistory).toBe(false);
  });

  it("rebuilds visible chat from restored history snapshots", () => {
    const busy = appReducer(
      {
        ...initialAppState,
        busy: true,
        messages: [{ id: "old", role: "system", text: "히스토리 복원 중" }],
      },
      {
        type: "backend_event",
        event: {
          type: "history_snapshot",
          history_events: [
            { type: "user", text: "첫 질문" },
            { type: "assistant", text: "첫 답변" },
            { type: "tool_started", tool_name: "shell_command", tool_input: { command: "pytest" } },
            { type: "tool_completed", tool_name: "shell_command", output: "passed", is_error: false },
            { type: "user", text: "후속 질문" },
          ],
        },
      },
    );

    expect(busy.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "첫 질문"],
      ["assistant", "첫 답변"],
      ["user", "후속 질문"],
    ]);
    expect(busy.messages[1].isComplete).toBe(false);
    const restoredWorkflowEvents = Object.values(busy.workflowEventsByMessageId).flat();
    const shellEvent = restoredWorkflowEvents.find((event) => event.toolName === "shell_command");
    expect(shellEvent?.status).toBe("done");
    expect(shellEvent?.output).toBe("passed");
  });

  it("marks final assistant turns complete when restoring history", () => {
    const restored = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "history_snapshot",
        history_events: [
          { type: "user", text: "질문" },
          { type: "assistant", text: "최종 답변" },
        ],
      },
    });

    expect(restored.messages[1].isComplete).toBe(true);
  });

  it("tracks tool workflow lifecycle", () => {
    const started = appReducer(initialAppState, {
      type: "backend_event",
      event: { type: "tool_started", tool_name: "shell_command", tool_input: { command: "npm test" } },
    });
    const progressed = appReducer(started, {
      type: "backend_event",
      event: { type: "tool_progress", tool_name: "shell_command", message: "테스트 실행 중" },
    });
    const completed = appReducer(progressed, {
      type: "backend_event",
      event: { type: "tool_completed", tool_name: "shell_command", output: "pass" },
    });

    const shellEvent = completed.workflowEvents.find((event) => event.toolName === "shell_command");
    expect(started.busy).toBe(true);
    expect(progressed.busy).toBe(true);
    expect(completed.busy).toBe(true);
    expect(completed.workflowEvents.map((event) => event.title)).toContain("작업 실행");
    expect(shellEvent?.status).toBe("done");
    expect(shellEvent?.detail).toContain("pass");
    expect(completed.artifactRefreshKey).toBe(progressed.artifactRefreshKey + 1);
  });

  it("keeps parallel same-named tool steps matched to their backend call ids", () => {
    const firstStarted = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "tool_started",
        tool_name: "web_search",
        tool_call_id: "call-first",
        tool_call_index: 0,
        tool_input: { query: "first query" },
      } as any,
    });
    const secondStarted = appReducer(firstStarted, {
      type: "backend_event",
      event: {
        type: "tool_started",
        tool_name: "web_search",
        tool_call_id: "call-second",
        tool_call_index: 1,
        tool_input: { query: "second query" },
      } as any,
    });
    const startedSearchEvents = secondStarted.workflowEvents.filter((event) => event.toolName === "web_search");
    expect(startedSearchEvents).toHaveLength(2);
    expect(startedSearchEvents.map((event) => event.status)).toEqual(["running", "running"]);

    const firstCompleted = appReducer(secondStarted, {
      type: "backend_event",
      event: {
        type: "tool_completed",
        tool_name: "web_search",
        tool_call_id: "call-first",
        output: "Search results for: first query",
      } as any,
    });
    const completed = appReducer(firstCompleted, {
      type: "backend_event",
      event: {
        type: "tool_completed",
        tool_name: "web_search",
        tool_call_id: "call-second",
        output: "Search results for: second query",
      } as any,
    });

    const searchEvents = completed.workflowEvents.filter((event) => event.toolName === "web_search");
    expect(searchEvents).toHaveLength(2);
    expect(searchEvents.map((event) => event.status)).toEqual(["done", "done"]);
    expect(searchEvents.map((event) => event.detail)).toEqual([
      "Search results for: first query",
      "Search results for: second query",
    ]);
  });

  it("keeps the header status compact for web tools and answer streaming", () => {
    const started = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "tool_started",
        tool_name: "web_fetch",
        tool_input: { url: "https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/superagency-in-the-workplace-empowering" },
      },
    });
    const progressed = appReducer(started, {
      type: "backend_event",
      event: {
        type: "tool_progress",
        tool_name: "web_fetch",
        message: "web_fetch 실행 중... 6초 경과 · https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/superagency-in-the-workplace-empowering",
      },
    });
    const completed = appReducer(progressed, {
      type: "backend_event",
      event: {
        type: "tool_completed",
        tool_name: "web_fetch",
        output: "URL: https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/superagency-in-the-workplace-empowering\nTitle: Superagency",
      },
    });
    const streaming = appReducer(completed, {
      type: "backend_event",
      event: { type: "assistant_delta", message: "정리하면" },
    });

    expect(started.statusText).toBe("웹 페이지 확인 중");
    expect(progressed.statusText).toBe("웹 페이지 확인 중");
    expect(completed.statusText).toBe("도구 결과 검토 중");
    expect(streaming.statusText).toBe("응답 작성 중");
    expect(progressed.workflowEvents.find((event) => event.toolName === "web_fetch")?.detail).toContain("mckinsey.com");
  });

  it("streams write_file argument deltas into the workflow preview before tool start", () => {
    const first = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "tool_input_delta",
        tool_name: "write_file",
        tool_call_index: 0,
        arguments_delta: "{\"path\":\"immortal-ai-worm.html\",\"content\":\"<html><body>",
      },
    });
    const second = appReducer(first, {
      type: "backend_event",
      event: {
        type: "tool_input_delta",
        tool_name: "write_file",
        tool_call_index: 0,
        arguments_delta: "<h1>Live</h1>",
      },
    });

    const writeEvent = second.workflowEvents.find((event) => event.toolName === "write_file");
    expect(writeEvent?.status).toBe("running");
    expect(writeEvent?.toolInput?.path).toBe("immortal-ai-worm.html");
    expect(writeEvent?.toolInput?.content).toBe("<html><body><h1>Live</h1>");
  });

  it("keeps the streamed write_file preview row when the tool starts and completes", () => {
    const streamed = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "tool_input_delta",
        tool_name: "write_file",
        arguments_delta: "{\"path\":\"chart.html\",\"content\":\"hello",
      },
    });
    const started = appReducer(streamed, {
      type: "backend_event",
      event: { type: "tool_started", tool_name: "write_file", tool_input: { path: "chart.html", content: "hello" } },
    });
    const completed = appReducer(started, {
      type: "backend_event",
      event: { type: "tool_completed", tool_name: "write_file", output: "Wrote chart.html", is_error: false },
    });

    const writeEvents = completed.workflowEvents.filter((event) => event.toolName === "write_file");
    expect(writeEvents).toHaveLength(1);
    expect(writeEvents[0].status).toBe("done");
    expect(writeEvents[0].toolInput?.content).toBe("hello");
  });

  it("merges streamed write previews when backend call ids arrive later", () => {
    const streamed = appReducer(initialAppState, {
      type: "backend_event",
      event: {
        type: "tool_input_delta",
        tool_name: "write_file",
        arguments_delta: "{\"path\":\"agent-harness-trend-report.html\",\"content\":\"<!doctype html>",
      },
    });
    const started = appReducer(streamed, {
      type: "backend_event",
      event: {
        type: "tool_started",
        tool_name: "write_file",
        tool_call_id: "call-write",
        tool_call_index: 0,
        tool_input: {
          path: "agent-harness-trend-report.html",
          content: "<!doctype html>",
        },
      } as any,
    });
    const completed = appReducer(started, {
      type: "backend_event",
      event: {
        type: "tool_completed",
        tool_name: "write_file",
        tool_call_id: "call-write",
        tool_call_index: 0,
        output: "Wrote agent-harness-trend-report.html",
        is_error: false,
      } as any,
    });

    const writeEvents = completed.workflowEvents.filter((event) => event.toolName === "write_file");
    expect(writeEvents).toHaveLength(1);
    expect(writeEvents[0]).toMatchObject({
      status: "done",
      toolCallId: "call-write",
      toolCallIndex: 0,
    });
    expect(writeEvents[0].toolInput?.path).toBe("agent-harness-trend-report.html");
  });

  it("merges shell shortcut output into the optimistic terminal message", () => {
    const withTerminal = appReducer(initialAppState, {
      type: "append_message",
      message: {
        role: "log",
        text: "!node --version",
        toolName: "shell-shortcut",
        terminal: { command: "node --version", status: "running" },
      },
    });
    const started = appReducer(withTerminal, {
      type: "backend_event",
      event: { type: "tool_started", tool_name: "cmd", tool_input: { command: "node --version" } },
    });
    const completed = appReducer(started, {
      type: "backend_event",
      event: { type: "tool_completed", tool_name: "cmd", output: "v22.15.0\n", is_error: false },
    });

    expect(completed.messages).toHaveLength(1);
    expect(completed.messages[0].terminal).toEqual({
      command: "node --version",
      output: "v22.15.0\n",
      status: "done",
    });
    expect(completed.messages[0].text).toBe("v22.15.0\n");
  });

  it("stores shell ui preferences in state", () => {
    const themed = appReducer(initialAppState, { type: "set_theme", themeId: "dark" });
    const collapsed = appReducer(themed, { type: "set_sidebar_collapsed", value: true });

    expect(collapsed.themeId).toBe("dark");
    expect(collapsed.sidebarCollapsed).toBe(true);
  });

  it("keeps artifact list and preview widths independent", () => {
    const base = {
      ...initialAppState,
      artifactPanelListWidth: 360,
      artifactPanelPreviewWidth: 720,
      artifactPanelWidth: 360,
    };

    const listOpen = appReducer(base, { type: "open_artifact_list" });
    expect(listOpen.artifactPanelWidth).toBe(360);

    const resizedList = appReducer(listOpen, { type: "set_artifact_panel_width", value: 400 });
    expect(resizedList.artifactPanelListWidth).toBe(400);
    expect(resizedList.artifactPanelPreviewWidth).toBe(720);

    const previewOpen = appReducer(resizedList, {
      type: "open_artifact",
      artifact: { path: "outputs/report.html", name: "report.html", kind: "html" },
    });
    expect(previewOpen.artifactPanelWidth).toBe(720);

    const resizedPreview = appReducer(previewOpen, { type: "set_artifact_panel_width", value: 760 });
    expect(resizedPreview.artifactPanelListWidth).toBe(400);
    expect(resizedPreview.artifactPanelPreviewWidth).toBe(760);

    const listAgain = appReducer(resizedPreview, { type: "open_artifact_list" });
    expect(listAgain.artifactPanelWidth).toBe(400);
  });
});
