import assert from "node:assert/strict";
import test from "node:test";

function installBrowserGlobals() {
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: () => undefined,
      },
    },
    querySelector: () => null,
  };
  globalThis.sessionStorage = {
    getItem: () => "",
    setItem: () => undefined,
  };
  globalThis.window = {
    addEventListener: () => undefined,
    requestAnimationFrame: (callback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
    clearTimeout: () => undefined,
    matchMedia: () => ({ matches: true }),
  };
  globalThis.performance = {
    now: () => 0,
  };
}

function createClassList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    contains: (item) => values.has(item),
    toggle: (item, force) => {
      if (force === false) {
        values.delete(item);
        return false;
      }
      values.add(item);
      return true;
    },
  };
}

function createMessagesContainer({ scrollHeight, clientHeight, scrollTop, lastScrollTop }) {
  return {
    scrollHeight,
    clientHeight,
    scrollTop,
    dataset: {
      lastScrollTop: String(lastScrollTop),
    },
    classList: createClassList(),
    addEventListener: () => undefined,
  };
}

function createUiWithMessages(createUI, messages) {
  const state = {
    autoFollowMessages: false,
    autoScrollUntil: 0,
    restoringHistory: false,
    ignoreScrollSave: false,
  };
  const ctx = {
    state,
    els: {
      messages,
    },
    STATUS_LABELS: {},
    markActiveHistory: () => undefined,
  };
  return { state, ui: createUI(ctx) };
}

test("re-enables message auto-follow when the user returns near the bottom", async () => {
  installBrowserGlobals();
  const { createUI } = await import("../modules/ui.js");
  const messages = createMessagesContainer({
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 405,
    lastScrollTop: 420,
  });
  const { state, ui } = createUiWithMessages(createUI, messages);

  ui.markMessagesUserScrollIntent();
  ui.updateAutoFollowFromScroll(messages);

  assert.equal(state.autoFollowMessages, true);
});

test("keeps message auto-follow paused while the user is away from the bottom", async () => {
  installBrowserGlobals();
  const { createUI } = await import("../modules/ui.js");
  const messages = createMessagesContainer({
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 200,
    lastScrollTop: 420,
  });
  const { state, ui } = createUiWithMessages(createUI, messages);

  ui.markMessagesUserScrollIntent();
  ui.updateAutoFollowFromScroll(messages);

  assert.equal(state.autoFollowMessages, false);
});

test("immediately resumes tail follow when streaming and the user returns to bottom", async () => {
  installBrowserGlobals();
  const { createUI } = await import("../modules/ui.js");
  const messages = createMessagesContainer({
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 500,
    lastScrollTop: 200,
  });
  const { state, ui } = createUiWithMessages(createUI, messages);
  state.assistantNode = {};

  ui.updateAutoFollowFromScroll(messages);

  assert.equal(state.autoFollowMessages, true);
  assert.equal(messages.scrollTop, 1000);
  assert.equal(messages.classList.contains("streaming-follow"), true);
});

test("resumes tail follow near the bottom while streaming", async () => {
  installBrowserGlobals();
  const { createUI } = await import("../modules/ui.js");
  const messages = createMessagesContainer({
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 260,
    lastScrollTop: 200,
  });
  const { state, ui } = createUiWithMessages(createUI, messages);
  state.assistantNode = {};

  ui.updateAutoFollowFromScroll(messages);

  assert.equal(state.autoFollowMessages, true);
  assert.equal(messages.classList.contains("streaming-follow"), true);
});

test("smooth vertical auto-scroll accelerates before slowing down", async () => {
  const animationFrames = [];
  installBrowserGlobals();
  globalThis.window.matchMedia = () => ({ matches: false });
  globalThis.window.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  globalThis.performance.now = () => 0;
  const { createUI } = await import("../modules/ui.js");
  const messages = createMessagesContainer({
    scrollHeight: 800,
    clientHeight: 200,
    scrollTop: 0,
    lastScrollTop: 0,
  });
  const { state, ui } = createUiWithMessages(createUI, messages);
  state.autoFollowMessages = true;

  ui.scrollMessagesToBottom({ smooth: true, duration: 1000 });

  const samples = [];
  for (const now of [0, 120, 240, 760, 880, 1000]) {
    const frame = animationFrames.shift();
    assert.equal(typeof frame, "function");
    frame(now);
    samples.push(messages.scrollTop);
  }

  const deltas = samples.slice(1).map((value, index) => value - samples[index]);
  assert.ok(deltas[1] > deltas[0], `expected acceleration, got deltas ${deltas.join(", ")}`);
  assert.ok(deltas[4] < deltas[3], `expected deceleration near the target, got deltas ${deltas.join(", ")}`);
});
