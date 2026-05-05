const defaultRawEventLimit = 400;
const defaultStableEventLimit = 1000;
const replayExcludedTypes = new Set(["modal_request", "select_request"]);

function eventType(event) {
  return String(event?.type || "");
}

function nextOrder(state) {
  state.nextOrder += 1;
  return state.nextOrder;
}

function cloneEvent(event) {
  return event && typeof event === "object" ? { ...event } : event;
}

function toolCallKey(event) {
  const callId = typeof event.tool_call_id === "string" && event.tool_call_id ? event.tool_call_id : "";
  if (callId) return `id:${callId}`;
  const rawIndex = Number(event.tool_call_index);
  if (Number.isFinite(rawIndex)) return `index:${rawIndex}`;
  return `tool:${String(event.tool_name || "")}`;
}

function resetActiveStreams(state) {
  state.assistantDelta = null;
  state.toolInputDeltas.clear();
  state.toolProgress.clear();
}

function resetConversationReplay(state) {
  state.stableEvents = [];
  resetActiveStreams(state);
}

function pushStableEvent(state, event) {
  state.stableEvents.push({ order: nextOrder(state), event: cloneEvent(event) });
  if (state.stableEvents.length > defaultStableEventLimit) {
    state.stableEvents.splice(0, state.stableEvents.length - defaultStableEventLimit);
  }
}

function rememberLatestEvent(state, key, event) {
  const current = state.latestEvents.get(key);
  state.latestEvents.set(key, {
    order: current?.order ?? nextOrder(state),
    event: cloneEvent(event),
  });
}

function deleteToolStream(state, event) {
  const key = toolCallKey(event);
  state.toolInputDeltas.delete(key);
  state.toolProgress.delete(key);
}

function isRegularUserTranscript(event) {
  const item = event.item || {};
  return event.type === "transcript_item"
    && item.role === "user"
    && item.kind !== "steering"
    && item.kind !== "queued";
}

function updateAssistantDelta(state, event) {
  const delta = String(event.message ?? event.value ?? "");
  if (!delta) return;
  if (!state.assistantDelta) {
    state.assistantDelta = {
      order: nextOrder(state),
      message: "",
    };
  }
  state.assistantDelta.message += delta;
}

function updateToolInputDelta(state, event) {
  const delta = String(event.arguments_delta || "");
  if (!delta) return;
  const key = toolCallKey(event);
  const current = state.toolInputDeltas.get(key);
  const currentDelta = current?.event.arguments_delta || "";
  const argumentsDelta = currentDelta && /^\s*\{/.test(delta) && /\}\s*$/.test(currentDelta)
    ? delta
    : `${currentDelta}${delta}`;
  const toolCallId = event.tool_call_id || current?.event.tool_call_id || "";
  const toolInputEvent = {
    type: "tool_input_delta",
    tool_name: event.tool_name || current?.event.tool_name || "",
    tool_call_index: event.tool_call_index ?? current?.event.tool_call_index,
    arguments_delta: argumentsDelta,
  };
  if (toolCallId) {
    toolInputEvent.tool_call_id = toolCallId;
  }
  state.toolInputDeltas.set(key, {
    order: current?.order ?? nextOrder(state),
    event: toolInputEvent,
  });
}

function updateToolProgress(state, event) {
  const key = toolCallKey(event);
  const current = state.toolProgress.get(key);
  state.toolProgress.set(key, {
    order: current?.order ?? nextOrder(state),
    event: cloneEvent(event),
  });
}

export function createSessionReplayState() {
  return {
    nextOrder: 0,
    latestEvents: new Map(),
    stableEvents: [],
    assistantDelta: null,
    toolInputDeltas: new Map(),
    toolProgress: new Map(),
  };
}

export function shouldReplayRawEvent(event) {
  return !replayExcludedTypes.has(eventType(event));
}

export function appendRawSessionEvent(events, id, event, limit = defaultRawEventLimit) {
  events.push({ id, event: cloneEvent(event) });
  if (events.length > limit) {
    events.splice(0, events.length - limit);
  }
}

export function rawEventsAfterLastEventId(events, lastEventId) {
  const parsed = Number.parseInt(String(lastEventId || ""), 10);
  if (!Number.isFinite(parsed)) {
    return [];
  }
  return events.filter((entry) => entry.id > parsed && shouldReplayRawEvent(entry.event));
}

export function canReplayFromLastEventId(events, lastEventId) {
  const parsed = Number.parseInt(String(lastEventId || ""), 10);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  if (!events.length) {
    return true;
  }
  return parsed >= events[0].id - 1;
}

export function updateSessionReplayState(state, event) {
  const type = eventType(event);
  if (!type || replayExcludedTypes.has(type)) {
    return;
  }
  if (type === "clear_transcript") {
    resetConversationReplay(state);
    return;
  }
  if (type === "history_snapshot") {
    resetConversationReplay(state);
    pushStableEvent(state, event);
    return;
  }
  if (type === "ready" || type === "state_snapshot" || type === "skills_snapshot" || type === "tasks_snapshot") {
    rememberLatestEvent(state, type, event);
    return;
  }
  if (type === "status" || type === "session_title" || type === "active_session" || type === "todo_update" || type === "plan_mode_change") {
    rememberLatestEvent(state, type, event);
    return;
  }
  if (isRegularUserTranscript(event)) {
    resetActiveStreams(state);
  }
  if (type === "assistant_delta") {
    updateAssistantDelta(state, event);
    return;
  }
  if (type === "assistant_complete") {
    state.assistantDelta = null;
    pushStableEvent(state, event);
    return;
  }
  if (type === "tool_input_delta") {
    updateToolInputDelta(state, event);
    return;
  }
  if (type === "tool_progress") {
    updateToolProgress(state, event);
    return;
  }
  if (type === "tool_started" || type === "tool_completed") {
    deleteToolStream(state, event);
    pushStableEvent(state, event);
    return;
  }
  pushStableEvent(state, event);
}

export function replayEventsForState(state) {
  const entries = [
    ...state.latestEvents.values(),
    ...state.stableEvents,
    ...state.toolInputDeltas.values(),
    ...state.toolProgress.values(),
  ];
  if (state.assistantDelta?.message) {
    entries.push({
      order: state.assistantDelta.order,
      event: { type: "assistant_delta", message: state.assistantDelta.message },
    });
  }
  return entries
    .filter((entry) => shouldReplayRawEvent(entry.event))
    .sort((left, right) => left.order - right.order)
    .map((entry) => cloneEvent(entry.event));
}
