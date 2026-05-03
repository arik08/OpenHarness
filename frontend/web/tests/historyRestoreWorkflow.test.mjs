import assert from "node:assert/strict";
import test from "node:test";

function createContext() {
  const workflowTurns = [];
  const assistantActions = [];
  const messages = [];
  const state = {
    activeFrontendId: "slot-1",
    activeHistoryId: "",
    assistantNode: null,
    autoFollowMessages: false,
    batchingHistoryRestore: false,
    busy: false,
    chatSlots: new Map([
      ["slot-1", {
        frontendId: "slot-1",
        busy: false,
        container: { querySelector: () => null },
        showInHistory: false,
      }],
    ]),
    ignoreScrollSave: false,
    pendingScrollRestoreId: "",
    restoreTimeoutId: 0,
    restoringHistory: false,
    suppressNextLineCompleteScroll: false,
    workflowNode: null,
  };
  let lastUserText = "";

  return {
    state,
    workflowTurns,
    els: {
      messages: {
        textContent: "",
        classList: {
          remove: () => undefined,
          toggle: () => undefined,
        },
      },
    },
    STATUS_LABELS: {
      ready: "준비됨",
      restoring: "복원 중",
    },
    appendMessage: (role, text) => {
      messages.push({ role, text });
      if (role === "user") {
        lastUserText = text;
      }
      return { role, text, isConnected: true };
    },
    appendWorkflowEvent: (event) => {
      if (!state.workflowNode) {
        state.workflowNode = { userText: lastUserText };
        workflowTurns.push(state.workflowNode);
      }
      state.workflowNode.events = state.workflowNode.events || [];
      state.workflowNode.events.push(event.tool_name);
    },
    archiveTodoChecklist: () => undefined,
    attachAssistantActions: (node, text) => {
      assistantActions.push({ node, text });
    },
    cachedHistoryForWorkspace: () => [],
    clearWorkflowFinalAnswerStep: () => undefined,
    closeInlineQuestion: () => undefined,
    collapseWorkflowPanel: () => undefined,
    commandDescription: (_name, description) => description,
    extractAndRenderArtifacts: () => undefined,
    failWorkflowPanel: () => undefined,
    finishScrollRestore: () => undefined,
    finalizeWorkflowSummary: () => undefined,
    markActiveHistory: () => undefined,
    markWorkflowFinalAnswerDone: () => undefined,
    renderHistory: () => undefined,
    renderTodoChecklist: () => undefined,
    renderWelcome: () => undefined,
    requestHistory: () => Promise.resolve(),
    resetArtifacts: () => undefined,
    resetTodoChecklist: () => undefined,
    resetWorkflowPanel: () => {
      state.workflowNode = null;
    },
    scrollMessagesToBottom: () => undefined,
    setBusy: () => undefined,
    setChatTitle: () => undefined,
    setMarkdown: () => undefined,
    setPlanModeIndicatorActive: () => undefined,
    setStatus: () => undefined,
    showModal: () => undefined,
    showSelect: () => undefined,
    startWorkflowFinalAnswer: () => undefined,
    streamingStateSnapshot: null,
    updateSendState: () => undefined,
    updateSlashMenu: () => undefined,
    updateState: () => undefined,
    updateTasks: () => undefined,
    assistantActions,
    messages,
  };
}

test("restored workflow events are grouped under each user turn", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.window = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  const ctx = createContext();
  const { createEvents } = await import("../modules/events.js");
  const events = createEvents(ctx);

  events.handleEvent({
    type: "history_snapshot",
    value: "saved-1",
    message: "저장된 대화",
    history_events: [
      { type: "user", text: "첫 질문" },
      { type: "tool_started", tool_name: "Read", tool_input: {} },
      { type: "tool_completed", tool_name: "Read", output: "ok" },
      { type: "assistant", text: "첫 답변" },
      { type: "user", text: "추가 질문" },
      { type: "tool_started", tool_name: "Bash", tool_input: {} },
      { type: "tool_completed", tool_name: "Bash", output: "ok" },
      { type: "assistant", text: "추가 답변" },
    ],
  });

  assert.deepEqual(
    ctx.workflowTurns.map((turn) => ({ userText: turn.userText, events: turn.events })),
    [
      { userText: "첫 질문", events: ["Read", "Read"] },
      { userText: "추가 질문", events: ["Bash", "Bash"] },
    ],
  );
});

test("restored history attaches actions only to final assistant answers", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.window = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  const ctx = createContext();
  const { createEvents } = await import("../modules/events.js");
  const events = createEvents(ctx);

  events.handleEvent({
    type: "history_snapshot",
    value: "saved-1",
    message: "저장된 대화",
    history_events: [
      { type: "user", text: "확인해줘" },
      { type: "tool_started", tool_name: "Read", tool_input: {} },
      { type: "assistant", text: "파일을 먼저 확인하겠습니다." },
      { type: "tool_completed", tool_name: "Read", output: "ok" },
      { type: "assistant", text: "최종 답변입니다." },
      { type: "assistant", text: "   " },
      { type: "user", text: "다음 질문" },
      { type: "assistant", text: "다음 최종 답변입니다." },
    ],
  });

  assert.deepEqual(
    ctx.assistantActions.map((action) => action.text),
    ["최종 답변입니다.", "다음 최종 답변입니다."],
  );
});

test("assistant transcript items receive answer actions on line completion", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.window = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  const ctx = createContext();
  const { createEvents } = await import("../modules/events.js");
  const events = createEvents(ctx);

  events.handleEvent({
    type: "transcript_item",
    item: { role: "assistant", text: "재연결로 받은 최종 답변입니다." },
  });
  assert.deepEqual(ctx.assistantActions, []);

  events.handleEvent({ type: "line_complete" });

  assert.deepEqual(
    ctx.assistantActions.map((action) => action.text),
    ["재연결로 받은 최종 답변입니다."],
  );
});

test("plan mode steering transcript items stay out of the chat body", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.window = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  const ctx = createContext();
  const { createEvents } = await import("../modules/events.js");
  const events = createEvents(ctx);

  events.handleEvent({
    type: "transcript_item",
    item: { role: "user", text: "/plan", kind: "steering" },
  });
  events.handleEvent({
    type: "transcript_item",
    item: { role: "user", text: "추가 지시", kind: "steering" },
  });

  assert.deepEqual(ctx.messages, [{ role: "user", text: "추가 지시" }]);
});

test("pending assistant actions survive slot state snapshots", async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.window = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  const ctx = createContext();
  const { createEvents } = await import("../modules/events.js");
  const events = createEvents(ctx);

  events.handleEvent({ type: "assistant_complete", message: "전환 직전 최종 답변입니다.", has_tool_uses: false });
  const snapshot = events.streamingStateSnapshot();
  events.handleEvent({ type: "clear_transcript" });
  events.restoreStreamingState(snapshot);
  events.handleEvent({ type: "line_complete" });

  assert.deepEqual(
    ctx.assistantActions.map((action) => action.text),
    ["전환 직전 최종 답변입니다."],
  );
});

test("appending restored-session updates does not force-scroll while auto-follow is paused", async () => {
  globalThis.document = {
    createElement: (tagName) => ({
      tagName,
      className: "",
      dataset: {},
      children: [],
      textContent: "",
      append(...nodes) {
        this.children.push(...nodes);
      },
      closest: () => null,
      querySelector: () => null,
      classList: {
        add: () => undefined,
        remove: () => undefined,
        toggle: () => undefined,
      },
    }),
  };

  let scrollCalls = 0;
  const ctx = createContext();
  ctx.state.autoFollowMessages = false;
  ctx.els.messages = {
    append: () => undefined,
    querySelector: () => null,
  };
  ctx.removeWelcome = () => undefined;
  ctx.scrollMessagesToBottom = () => {
    scrollCalls += 1;
  };
  ctx.setMarkdown = (node, text) => {
    node.textContent = text;
  };

  const { createMessages } = await import("../modules/messages.js");
  const messages = createMessages(ctx);

  messages.appendMessage("system", "늦게 들어온 완료 상태");

  assert.equal(scrollCalls, 0);
});
