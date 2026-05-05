import assert from "node:assert/strict";
import test from "node:test";

import {
  appendRawSessionEvent,
  canReplayFromLastEventId,
  createSessionReplayState,
  rawEventsAfterLastEventId,
  replayEventsForState,
  updateSessionReplayState,
} from "../modules/sessionReplay.js";

test("coalesces many assistant deltas into one live replay event", () => {
  const state = createSessionReplayState();

  updateSessionReplayState(state, { type: "transcript_item", item: { role: "user", text: "긴 답변 요청" } });
  for (let index = 0; index < 1005; index += 1) {
    updateSessionReplayState(state, { type: "assistant_delta", message: String(index % 10) });
  }

  const replay = replayEventsForState(state);
  const assistantDeltas = replay.filter((event) => event.type === "assistant_delta");

  assert.equal(assistantDeltas.length, 1);
  assert.equal(assistantDeltas[0].message.length, 1005);
  assert.equal(assistantDeltas[0].message.startsWith("0123456789"), true);
});

test("coalesces streamed tool input deltas for live file previews", () => {
  const state = createSessionReplayState();

  updateSessionReplayState(state, {
    type: "tool_input_delta",
    tool_name: "write_file",
    tool_call_index: 0,
    arguments_delta: "{\"path\":\"outputs/live.html\",\"content\":\"hello",
  });
  updateSessionReplayState(state, {
    type: "tool_input_delta",
    tool_name: "write_file",
    tool_call_index: 0,
    arguments_delta: " world\"}",
  });

  const replay = replayEventsForState(state);
  const toolDeltas = replay.filter((event) => event.type === "tool_input_delta");

  assert.equal(toolDeltas.length, 1);
  assert.deepEqual(toolDeltas[0], {
    type: "tool_input_delta",
    tool_name: "write_file",
    tool_call_index: 0,
    arguments_delta: "{\"path\":\"outputs/live.html\",\"content\":\"hello world\"}",
  });
});

test("preserves streamed tool call ids in live file preview snapshots", () => {
  const state = createSessionReplayState();

  updateSessionReplayState(state, {
    type: "tool_input_delta",
    tool_name: "write_file",
    tool_call_id: "call-write",
    arguments_delta: "{\"path\":\"outputs/live.html\"}",
  });

  const replay = replayEventsForState(state);

  assert.equal(replay[0].tool_call_id, "call-write");
});

test("returns raw replay events after Last-Event-ID without duplicating the last event", () => {
  const rawEvents = [];
  appendRawSessionEvent(rawEvents, 1, { type: "assistant_delta", message: "a" });
  appendRawSessionEvent(rawEvents, 2, { type: "assistant_delta", message: "b" });
  appendRawSessionEvent(rawEvents, 3, { type: "tool_completed", tool_name: "shell_command", output: "done" });

  assert.deepEqual(
    rawEventsAfterLastEventId(rawEvents, "2").map((entry) => entry.event),
    [{ type: "tool_completed", tool_name: "shell_command", output: "done" }],
  );
});

test("detects when Last-Event-ID is too old for complete raw replay", () => {
  const rawEvents = [];
  appendRawSessionEvent(rawEvents, 10, { type: "assistant_delta", message: "a" }, 2);
  appendRawSessionEvent(rawEvents, 11, { type: "assistant_delta", message: "b" }, 2);
  appendRawSessionEvent(rawEvents, 12, { type: "assistant_delta", message: "c" }, 2);

  assert.equal(canReplayFromLastEventId(rawEvents, "10"), true);
  assert.equal(canReplayFromLastEventId(rawEvents, "9"), false);
});
