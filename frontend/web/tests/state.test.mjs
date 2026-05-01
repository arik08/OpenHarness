import assert from "node:assert/strict";
import test from "node:test";

function createElement() {
  return {
    classList: {
      hidden: false,
      toggle(name, force) {
        if (name === "hidden") {
          this.hidden = Boolean(force);
        }
      },
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    textContent: "",
    title: "",
  };
}

function installBrowserGlobals() {
  const elements = {
    "#modelValue": createElement(),
    "#providerValue": createElement(),
    "#cwdValue": createElement(),
    "#planModeIndicator": createElement(),
  };
  globalThis.localStorage = {
    getItem: () => "",
    setItem: () => undefined,
  };
  globalThis.sessionStorage = {
    getItem: () => "",
    setItem: () => undefined,
  };
  globalThis.document = {
    querySelector: (selector) => elements[selector] || createElement(),
    querySelectorAll: () => [],
  };
  return elements;
}

test("plan mode shortcut preview restores the previous non-plan permission mode", async () => {
  installBrowserGlobals();
  const { state, updateState, setPlanModeIndicatorActive } = await import("../modules/state.js");
  state.planModePinned = null;
  state.lastNonPlanPermissionMode = "";

  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "full_auto" });
  setPlanModeIndicatorActive(true);
  setPlanModeIndicatorActive(false);

  assert.equal(state.permissionMode, "full_auto");
});

test("backend permission snapshots clear plan preview state", async () => {
  installBrowserGlobals();
  const { state, updateState, setPlanModeIndicatorActive } = await import("../modules/state.js");
  state.planModePinned = null;
  state.lastNonPlanPermissionMode = "";

  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "full_auto" });
  setPlanModeIndicatorActive(true);
  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "plan" });

  assert.equal(state.planModePinned, null);
  assert.equal(state.permissionMode, "plan");
});

test("stale non-plan snapshots do not hide a pending plan-mode preview", async () => {
  installBrowserGlobals();
  const { state, updateState, setPlanModeIndicatorActive } = await import("../modules/state.js");
  state.planModePinned = null;
  state.lastNonPlanPermissionMode = "";

  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "full_auto" });
  setPlanModeIndicatorActive(true);
  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "full_auto" });

  assert.equal(state.planModePinned, true);
  assert.equal(state.permissionMode, "Plan Mode");
});

test("stale plan snapshots do not re-show plan mode while exit is pending", async () => {
  installBrowserGlobals();
  const { state, updateState, setPlanModeIndicatorActive } = await import("../modules/state.js");
  state.planModePinned = null;
  state.lastNonPlanPermissionMode = "";

  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "full_auto" });
  setPlanModeIndicatorActive(true);
  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "plan" });
  setPlanModeIndicatorActive(false);
  updateState({ provider: "codex", model: "gpt", effort: "medium", permission_mode: "plan" });

  assert.equal(state.planModePinned, false);
  assert.equal(state.permissionMode, "full_auto");
});
