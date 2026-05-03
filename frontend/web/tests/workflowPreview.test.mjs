import assert from "node:assert/strict";
import test from "node:test";

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }

  add(...names) {
    for (const name of names) this.classes.add(name);
    this.sync();
  }

  remove(...names) {
    for (const name of names) this.classes.delete(name);
    this.sync();
  }

  contains(name) {
    return this.classes.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
    if (enabled) {
      this.classes.add(name);
    } else {
      this.classes.delete(name);
    }
    this.sync();
    return enabled;
  }

  setFromString(value) {
    this.classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  sync() {
    this.element._className = [...this.classes].join(" ");
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this._className = "";
    this._textContent = "";
    this.isConnected = false;
    this.open = false;
  }

  set className(value) {
    this._className = String(value || "");
    this.classList.setFromString(this._className);
  }

  get className() {
    return this._className;
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      node.isConnected = this.isConnected;
      markConnected(node, node.isConnected);
      this.children.push(node);
    }
  }

  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      node.parentElement = this;
      node.isConnected = this.isConnected;
      markConnected(node, node.isConnected);
      this.children.unshift(node);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  remove() {
    if (!this.parentElement) {
      this.isConnected = false;
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
    this.isConnected = false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return this.walk().filter((node) => matchesSelector(node, selector));
  }

  walk() {
    return [this, ...this.children.flatMap((child) => child.walk())];
  }
}

function markConnected(node, connected) {
  node.isConnected = connected;
  for (const child of node.children || []) {
    markConnected(child, connected);
  }
}

function matchesSelector(node, selector) {
  if (selector.startsWith(".")) {
    const classes = selector.slice(1).split(".").filter(Boolean);
    return classes.every((className) => node.classList.contains(className));
  }
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function createContext() {
  const messages = new FakeElement("div");
  messages.isConnected = true;
  const state = {
    autoFollowMessages: false,
    restoringHistory: false,
    skills: [],
    workflowNode: null,
    workflowSteps: [],
  };
  return {
    state,
    els: { messages },
    STATUS_LABELS: { ready: "준비됨" },
    commandDescription: (_name, description) => description,
    copyTextToClipboard: () => undefined,
    removeWelcome: () => undefined,
    scheduleScrollRestore: () => undefined,
    scrollMessagesToBottom: () => undefined,
    sendLine: () => Promise.resolve(),
    setBusy: () => undefined,
    setMarkdown: () => undefined,
  };
}

function installBrowserGlobals() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
  };
  globalThis.performance = { now: () => 0 };
  globalThis.window = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    setInterval: () => 1,
    setTimeout: () => 1,
  };
}

test("finalizing drains queued tool events before flushing workflow previews", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "write_file",
    tool_input: {
      path: "myharness-source-analysis.md",
      content: "# 분석\n\n내용입니다.",
    },
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  assert.ok(previewTitle);
  assert.match(previewTitle.textContent, /작성 완료 - myharness-source-analysis\.md/);
  assert.match(previewTitle.textContent, /\d+ 토큰 \(3줄\)/);
});

test("finalizing drains queued start and completion events in order", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "write_file",
    tool_input: {
      path: "queued-report.md",
      content: "queued content",
    },
  });
  messages.appendWorkflowEvent({
    type: "tool_completed",
    tool_name: "write_file",
    tool_input: {
      path: "queued-report.md",
      content: "queued content",
    },
    output: "Wrote queued-report.md",
    is_error: false,
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  const runningSteps = ctx.els.messages.querySelectorAll(".workflow-step.running");
  assert.ok(previewTitle);
  assert.match(previewTitle.textContent, /작성 완료 - queued-report\.md/);
  assert.equal(runningSteps.length, 0);
});

test("completed skill workflow events use usage label", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "skill",
    tool_input: { name: "diagnose" },
  });
  messages.appendWorkflowEvent({
    type: "tool_completed",
    tool_name: "skill",
    tool_input: { name: "diagnose" },
    output: "Skill: diagnose\nDescription: Diagnose why an agent run failed.",
    is_error: false,
  });
  messages.finalizeWorkflowSummary();

  const titles = [...ctx.els.messages.querySelectorAll(".workflow-step")]
    .map((item) => item.querySelector("strong")?.textContent || "");
  assert.ok(titles.includes("skill 사용"));
  assert.ok(!titles.includes("skill 완료"));
});

test("failure path also drains queued file preview events", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "write_file",
    tool_input: {
      path: "failed-report.md",
      content: "content visible before failure",
    },
  });
  messages.failWorkflowPanel("failed after tool start");

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  assert.ok(previewTitle);
  assert.match(previewTitle.textContent, /작성 완료 - failed-report\.md/);
});

test("notebook edits use new_source content for workflow previews", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "notebook_edit",
    tool_input: {
      path: "analysis.ipynb",
      cell_index: 0,
      new_source: "print('hello')",
    },
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  const previewBody = ctx.els.messages.querySelector(".workflow-output-body");
  assert.ok(previewTitle);
  assert.ok(previewBody);
  assert.match(previewTitle.textContent, /작성 완료 - analysis\.ipynb/);
  assert.equal(previewBody.textContent, "print('hello')");
});

test("streamed write_file arguments create workflow previews before tool start", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 0,
    tool_name: "write_file",
    arguments_delta: '{"path":"streamed-report.md","content":"hello',
  });
  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 0,
    tool_name: "write_file",
    arguments_delta: ' world"}',
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  const previewBody = ctx.els.messages.querySelector(".workflow-output-body");
  assert.ok(previewTitle);
  assert.ok(previewBody);
  assert.match(previewTitle.textContent, /작성 완료 - streamed-report\.md/);
  assert.equal(previewBody.textContent, "hello world");
});

test("write_file workflow previews keep full long content", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);
  const longContent = `${"a".repeat(12050)}\n</html>`;

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "write_file",
    tool_input: {
      path: "long-report.html",
      content: longContent,
    },
  });
  messages.finalizeWorkflowSummary();

  const previewBody = ctx.els.messages.querySelector(".workflow-output-body");
  assert.ok(previewBody);
  assert.equal(previewBody.textContent, longContent);
});

test("streamed notebook_edit arguments create workflow previews from new_source", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 0,
    tool_name: "notebook_edit",
    arguments_delta: '{"path":"streamed.ipynb","new_source":"print',
  });
  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 0,
    tool_name: "notebook_edit",
    arguments_delta: '(1)"}',
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  const previewBody = ctx.els.messages.querySelector(".workflow-output-body");
  assert.ok(previewTitle);
  assert.ok(previewBody);
  assert.match(previewTitle.textContent, /작성 완료 - streamed\.ipynb/);
  assert.equal(previewBody.textContent, "print(1)");
});

test("empty write_file content still creates a workflow preview", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "write_file",
    tool_input: {
      path: "empty.md",
      content: "",
    },
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  const previewBody = ctx.els.messages.querySelector(".workflow-output-body");
  assert.ok(previewTitle);
  assert.ok(previewBody);
  assert.match(previewTitle.textContent, /작성 완료 - empty\.md/);
  assert.equal(previewBody.textContent, "");
});

test("streamed empty write_file content still creates a workflow preview", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 0,
    tool_name: "write_file",
    arguments_delta: '{"path":"empty-stream.md","content":""}',
  });
  messages.finalizeWorkflowSummary();

  const previewTitle = ctx.els.messages.querySelector(".workflow-output-title");
  const previewBody = ctx.els.messages.querySelector(".workflow-output-body");
  assert.ok(previewTitle);
  assert.ok(previewBody);
  assert.match(previewTitle.textContent, /작성 완료 - empty-stream\.md/);
  assert.equal(previewBody.textContent, "");
});

test("parallel streamed write_file calls keep separate workflow previews", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 0,
    tool_name: "write_file",
    arguments_delta: '{"path":"first.md","content":"one"}',
  });
  messages.appendWorkflowInputDelta({
    type: "tool_input_delta",
    tool_call_index: 1,
    tool_name: "write_file",
    arguments_delta: '{"path":"second.md","content":"two"}',
  });
  messages.finalizeWorkflowSummary();

  const titles = ctx.els.messages
    .querySelectorAll(".workflow-output-title")
    .map((node) => node.textContent);
  const bodies = ctx.els.messages
    .querySelectorAll(".workflow-output-body")
    .map((node) => node.textContent);
  assert.equal(titles.length, 2);
  assert.match(titles[0], /작성 완료 - first\.md/);
  assert.match(titles[1], /작성 완료 - second\.md/);
  assert.deepEqual(bodies, ["one", "two"]);
});

test("workflow panel stays open when it contains an output preview", async () => {
  installBrowserGlobals();
  const { createMessages } = await import("../modules/messages.js");
  const ctx = createContext();
  const messages = createMessages(ctx);

  messages.appendWorkflowEvent({
    type: "tool_started",
    tool_name: "write_file",
    tool_input: {
      path: "visible.md",
      content: "keep this visible",
    },
  });
  messages.finalizeWorkflowSummary();
  ctx.state.workflowNode.open = false;

  messages.collapseWorkflowPanel();

  assert.equal(ctx.state.workflowNode.open, true);
});
