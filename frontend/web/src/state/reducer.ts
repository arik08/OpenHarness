import type { ArtifactSummary, BackendEvent, CommandItem, HistoryItem, SkillItem, Workspace, WorkspaceScope } from "../types/backend";
import type { AppSettings, AppState, ArtifactPayload, ChatMessage, ModalState, ThemeId, WorkflowEvent, WorkflowEventStatus } from "../types/ui";

const clientSessionKey = "myharness:clientSessionId";
const appSettingsKey = "myharness:appSettings";

const defaultAppSettings: AppSettings = {
  streamScrollDurationMs: 2000,
  streamStartBufferMs: 180,
  streamFollowLeadPx: 60,
  streamRevealDurationMs: 420,
  streamRevealWipePercent: 180,
  downloadMode: "ask",
  downloadFolderPath: "",
  shell: "auto",
};

export type AppAction =
  | { type: "backend_event"; event: BackendEvent; sessionId?: string }
  | { type: "append_message"; message: Omit<ChatMessage, "id"> }
  | { type: "session_started"; sessionId: string; clientId?: string }
  | { type: "session_replaced"; sessionId: string; workspace?: Workspace }
  | { type: "set_theme"; themeId: ThemeId }
  | { type: "set_sidebar_collapsed"; value: boolean }
  | { type: "set_draft"; value: string }
  | { type: "set_busy"; value: boolean }
  | { type: "set_chat_title"; value: string }
  | { type: "set_system_prompt"; value: string }
  | { type: "set_app_settings"; value: Partial<AppSettings> }
  | { type: "clear_composer" }
  | { type: "add_attachment"; attachment: { media_type: string; data: string; name: string } }
  | { type: "remove_attachment"; index: number }
  | { type: "add_pasted_text"; text: string }
  | { type: "remove_pasted_text"; index: number }
  | { type: "set_workspaces"; workspaces: Workspace[]; scope?: WorkspaceScope }
  | { type: "set_workspace"; workspace: Workspace }
  | { type: "set_history"; history: HistoryItem[] }
  | { type: "set_history_loading"; value: boolean }
  | { type: "begin_new_chat" }
  | { type: "begin_history_restore"; sessionId: string }
  | { type: "finish_history_restore" }
  | { type: "set_artifacts"; artifacts: ArtifactSummary[] }
  | { type: "refresh_artifacts" }
  | { type: "set_artifact_panel_width"; value: number | null }
  | { type: "set_artifact_resizing"; value: boolean }
  | { type: "open_artifact_list" }
  | { type: "open_artifact"; artifact: ArtifactSummary; payload?: ArtifactPayload | null }
  | { type: "set_artifact_payload"; payload: ArtifactPayload }
  | { type: "close_artifact" }
  | { type: "open_modal"; modal: ModalState }
  | { type: "close_modal" }
  | { type: "open_runtime_picker" }
  | { type: "close_runtime_picker" }
  | { type: "set_runtime_picker_error"; message: string }
  | { type: "select_runtime_provider"; value: string }
  | { type: "select_runtime_model"; value: string }
  | { type: "select_runtime_effort"; value: string }
  | { type: "toggle_todo_collapsed" }
  | { type: "dismiss_todo" }
  | { type: "clear_workflow" }
  | { type: "clear_messages" };

function loadClientSessionId() {
  try {
    return sessionStorage.getItem(clientSessionKey) || "";
  } catch {
    return "";
  }
}

function saveClientSessionId(value: string) {
  try {
    sessionStorage.setItem(clientSessionKey, value);
  } catch {
    // Embedded/private contexts may block sessionStorage.
  }
}

function loadLocalStorageValue(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(numberValue) ? numberValue : fallback));
}

function normalizeAppSettings(value: Partial<AppSettings> = {}): AppSettings {
  return {
    streamScrollDurationMs: clampNumber(value.streamScrollDurationMs, defaultAppSettings.streamScrollDurationMs, 0, 5000),
    streamStartBufferMs: clampNumber(value.streamStartBufferMs, defaultAppSettings.streamStartBufferMs, 0, 2000),
    streamFollowLeadPx: clampNumber(value.streamFollowLeadPx, defaultAppSettings.streamFollowLeadPx, 0, 220),
    streamRevealDurationMs: clampNumber(value.streamRevealDurationMs, defaultAppSettings.streamRevealDurationMs, 0, 2000),
    streamRevealWipePercent: clampNumber(value.streamRevealWipePercent, defaultAppSettings.streamRevealWipePercent, 100, 400),
    downloadMode: value.downloadMode === "folder" ? "folder" : "ask",
    downloadFolderPath: String(value.downloadFolderPath || ""),
    shell: value.shell === "powershell" || value.shell === "git-bash" || value.shell === "cmd" ? value.shell : "auto",
  };
}

function loadAppSettings(): AppSettings {
  try {
    return normalizeAppSettings(JSON.parse(localStorage.getItem(appSettingsKey) || "{}") as Partial<AppSettings>);
  } catch {
    return { ...defaultAppSettings };
  }
}

function saveAppSettings(settings: AppSettings) {
  try {
    localStorage.setItem(appSettingsKey, JSON.stringify(settings));
  } catch {
    // Embedded/private contexts may block localStorage.
  }
}

function initialThemeId(): ThemeId {
  const value = loadLocalStorageValue("myharness:theme");
  return value === "posco" || value === "dark" || value === "mono" || value === "mono-orange" ? value : "light";
}

function storedArtifactPanelWidth(key: string) {
  const value = Number(loadLocalStorageValue(key) || 0);
  return Number.isFinite(value) && value >= 320 ? value : null;
}

function initialArtifactPanelListWidth() {
  return storedArtifactPanelWidth("myharness:artifactPanelListWidth")
    ?? storedArtifactPanelWidth("myharness:artifactPanelWidth");
}

function initialArtifactPanelPreviewWidth() {
  return storedArtifactPanelWidth("myharness:artifactPanelPreviewWidth")
    ?? storedArtifactPanelWidth("myharness:artifactPanelWidth");
}

const issuedIds = new Set<string>();
let idCollisionSerial = 0;

function nextId() {
  const base = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (!issuedIds.has(base)) {
    issuedIds.add(base);
    return base;
  }
  let next = base;
  do {
    idCollisionSerial += 1;
    next = `${base}-${idCollisionSerial}`;
  } while (issuedIds.has(next));
  issuedIds.add(next);
  return next;
}

function createClientSessionId() {
  return nextId();
}

function initialClientSessionId() {
  const existing = loadClientSessionId();
  if (existing) {
    return existing;
  }
  const next = createClientSessionId();
  saveClientSessionId(next);
  return next;
}

export const initialAppState: AppState = {
  sessionId: null,
  clientId: initialClientSessionId(),
  ready: false,
  busy: false,
  status: "connecting",
  statusText: "연결 중",
  provider: "-",
  providerLabel: "-",
  model: "-",
  effort: "-",
  permissionMode: "-",
  chatTitle: "MyHarness",
  systemPrompt: loadLocalStorageValue("myharness:systemPrompt"),
  appSettings: loadAppSettings(),
  themeId: initialThemeId(),
  sidebarCollapsed: loadLocalStorageValue("myharness:sidebarCollapsed") === "1",
  commands: [],
  skills: [],
  workspaceName: "",
  workspacePath: "",
  workspaceScope: { mode: "shared", name: "shared", root: "" },
  workspaces: [],
  history: [],
  historyLoading: false,
  historyRefreshKey: 0,
  activeHistoryId: null,
  restoringHistory: false,
  pendingFreshChat: false,
  artifacts: [],
  artifactPanelOpen: false,
  activeArtifact: null,
  activeArtifactPayload: null,
  artifactRefreshKey: 0,
  artifactPanelWidth: initialArtifactPanelListWidth(),
  artifactPanelListWidth: initialArtifactPanelListWidth(),
  artifactPanelPreviewWidth: initialArtifactPanelPreviewWidth(),
  artifactResizing: false,
  modal: null,
  messages: [],
  workflowAnchorMessageId: null,
  workflowEventsByMessageId: {},
  workflowDurationSecondsByMessageId: {},
  workflowInputBuffers: {},
  todoMarkdown: "",
  todoCollapsed: false,
  workflowEvents: [],
  workflowDurationSeconds: null,
  runtimePicker: {
    open: false,
    loading: false,
    error: "",
    providers: [],
    modelsByProvider: {},
    models: [],
    efforts: [],
    selectedProvider: "",
    modelOpen: false,
    effortOpen: false,
  },
  composer: {
    draft: "",
    attachments: [],
    pastedTexts: [],
    token: null,
  },
};

function createMessage(message: Omit<ChatMessage, "id">): ChatMessage {
  return { id: nextId(), ...message };
}

function appendMessage(messages: ChatMessage[], message: Omit<ChatMessage, "id">): ChatMessage[] {
  return [...messages, createMessage(message)];
}

const staleSessionMessage = "세션 연결이 끊겼습니다. 페이지를 새로고침하거나 새 세션을 시작한 뒤 다시 시도해주세요.";
const brainstormingBrowserPrompt =
  "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)";
const localizedBrainstormingBrowserPrompt =
  "브라우저로 간단한 목업, 다이어그램, 비교 화면 같은 시각 자료를 함께 보여드리면 더 설명하기 쉬울 수 있습니다. 이 기능은 아직 새 기능이라 토큰을 조금 더 쓸 수 있습니다. 사용해볼까요? (로컬 URL을 여는 과정이 필요합니다)";

function normalizeVisibleText(message: string) {
  const text = String(message || "");
  if (text.trim() === "Unknown session") {
    return staleSessionMessage;
  }
  return text.replace(brainstormingBrowserPrompt, localizedBrainstormingBrowserPrompt);
}

function appendErrorMessage(messages: ChatMessage[], message: string): ChatMessage[] {
  const text = normalizeVisibleText(message).trim() || "응답 생성 중 오류가 발생했습니다.";
  const last = messages[messages.length - 1];
  if (last?.isError && last.text === text) {
    return messages;
  }
  return appendMessage(messages, { role: "system", text, isError: true });
}

function isShellTool(toolName: string) {
  const lower = toolName.toLowerCase();
  return lower === "cmd" || lower === "bash" || lower.includes("shell_command");
}

function commandFromToolInput(input?: Record<string, unknown> | null) {
  const command = input?.command;
  return typeof command === "string" ? command.trim() : "";
}

function updateLatestTerminalMessage(
  messages: ChatMessage[],
  command: string,
  patch: NonNullable<ChatMessage["terminal"]>,
) {
  const index = [...messages].reverse().findIndex((message) => {
    if (!message.terminal) return false;
    if (message.terminal.status !== "running") return false;
    return !command || message.terminal.command === command;
  });
  if (index < 0) {
    return null;
  }
  const realIndex = messages.length - 1 - index;
  return messages.map((message, currentIndex) => (
    currentIndex === realIndex
      ? {
          ...message,
          text: patch.output ?? message.text,
          isError: patch.status === "error",
          terminal: { ...message.terminal, ...patch },
        }
      : message
  ));
}

function isNonConversationTranscriptItem(item: { role?: string; text?: string }) {
  const role = item.role || "";
  const text = String(item.text || "").trim();
  if (!text) return true;
  if (role === "system" && text === "Conversation cleared.") return true;
  if (role === "system" && ["Plan mode enabled.", "Plan mode disabled."].includes(text)) return true;
  if (role === "system" && text.startsWith("Session restored")) return true;
  return false;
}

function isFinalRestoredAssistantAnswer(historyEvents: Array<Record<string, unknown>>, index: number) {
  const current = historyEvents[index];
  if (!String(current?.text || "").trim()) {
    return false;
  }
  for (const next of historyEvents.slice(index + 1)) {
    const type = String(next?.type || "");
    if (type === "user") {
      return true;
    }
    if (type === "assistant" && String(next?.text || "").trim()) {
      return false;
    }
    if (["tool_started", "tool_completed", "tool_progress", "tool_input_delta"].includes(type)) {
      return false;
    }
  }
  return true;
}

function initialWorkflowEvents(): WorkflowEvent[] {
  return [
    {
      id: nextId(),
      toolName: "",
      title: "요청 이해",
      detail: "사용자 요청을 확인했습니다.",
      status: "done",
      level: "parent",
    },
    {
      id: nextId(),
      toolName: "",
      title: "작업 계획 수립",
      detail: "필요한 맥락과 진행 방향을 정리합니다.",
      status: "running",
      level: "parent",
      role: "planning",
    },
  ];
}

function workflowTitle(toolName: string) {
  if (!toolName) return "도구 실행";
  if (toolName.includes("shell") || toolName.includes("bash") || toolName.includes("powershell")) return "명령 실행";
  if (toolName.includes("apply_patch")) return "파일 수정";
  if (toolName.includes("read") || toolName.includes("open")) return "파일 확인";
  return toolName;
}

function compactToolStatus(toolName: string, fallback = "처리 중") {
  const lower = toolName.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell") || lower === "cmd") return "명령 실행 중";
  if (lower.includes("web_fetch")) return "웹 페이지 확인 중";
  if (lower.includes("web_search")) return "웹 검색 중";
  if (lower.includes("grep")) return "텍스트 검색 중";
  if (lower.includes("glob")) return "파일 목록 확인 중";
  if (lower.includes("read")) return "파일 읽는 중";
  if (lower.includes("write") || lower.includes("edit") || lower.includes("notebook")) return "파일 작업 중";
  return fallback;
}

function workflowDetailFromInput(input?: Record<string, unknown> | null) {
  if (!input) return "";
  const candidates = ["command", "path", "file", "cwd", "query", "pattern"];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function splitWorkflowPreviewLines(value: string) {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  return normalized ? normalized.split("\n") : [""];
}

function formatWorkflowEditBlock(oldValue: string, newValue: string) {
  return [
    ...splitWorkflowPreviewLines(oldValue).map((line) => `-- ${line}`),
    ...splitWorkflowPreviewLines(newValue).map((line) => `++ ${line}`),
  ].join("\n");
}

function decodeJsonStringFragment(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      result += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      break;
    }
    index += 1;
    if (next === "n") result += "\n";
    else if (next === "r") result += "\r";
    else if (next === "t") result += "\t";
    else if (next === "b") result += "\b";
    else if (next === "f") result += "\f";
    else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 1, index + 5))) {
      result += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 5), 16));
      index += 4;
    } else {
      result += next;
    }
  }
  return result;
}

function extractPartialJsonStringField(source: string, key: string) {
  const marker = `"${key}"`;
  const keyIndex = source.indexOf(marker);
  if (keyIndex < 0) return { found: false, value: "" };
  const colonIndex = source.indexOf(":", keyIndex + marker.length);
  if (colonIndex < 0) return { found: false, value: "" };
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < source.length && /\s/.test(source[quoteIndex])) {
    quoteIndex += 1;
  }
  if (source[quoteIndex] !== "\"") return { found: false, value: "" };
  let cursor = quoteIndex + 1;
  let escaped = false;
  let raw = "";
  while (cursor < source.length) {
    const char = source[cursor];
    if (!escaped && char === "\"") break;
    raw += char;
    escaped = !escaped && char === "\\";
    if (char !== "\\") escaped = false;
    cursor += 1;
  }
  return { found: true, value: decodeJsonStringFragment(raw) };
}

function firstPartialJsonStringField(source: string, keys: string[]) {
  for (const key of keys) {
    const field = extractPartialJsonStringField(source, key);
    if (field.found) return field;
  }
  return { found: false, value: "" };
}

function isWorkflowOutputTool(toolName: string) {
  const lower = toolName.toLowerCase();
  return lower !== "todo_write" && lower !== "todowrite" && (lower.includes("write") || lower.includes("edit"));
}

function workflowInputBufferKey(event: Extract<BackendEvent, { type: "tool_input_delta" }>) {
  const rawIndex = Number(event.tool_call_index);
  const index = Number.isFinite(rawIndex) ? rawIndex : 0;
  return `${event.tool_name || "tool"}:${index}`;
}

function partialToolInputFromBuffer(toolName: string, buffer: string): Record<string, unknown> | null {
  if (!isWorkflowOutputTool(toolName)) {
    return null;
  }
  const path = firstPartialJsonStringField(buffer, ["file_path", "path"]);
  const input: Record<string, unknown> = {};
  if (path.found) {
    input.path = path.value;
  }
  const lower = toolName.toLowerCase();
  const oldField = firstPartialJsonStringField(buffer, ["old_str", "old_string"]);
  const newField = firstPartialJsonStringField(buffer, ["new_str", "new_string"]);
  if (lower.includes("edit") && (oldField.found || newField.found)) {
    input.old_str = oldField.value;
    input.new_str = newField.value;
    input.content = formatWorkflowEditBlock(oldField.value, newField.value);
    return input;
  }
  const contentField = firstPartialJsonStringField(buffer, ["content", "new_string", "new_source"]);
  if (!contentField.found) {
    return null;
  }
  input.content = contentField.value;
  return input;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function backendToolCallId(event: BackendEvent) {
  const value = "tool_call_id" in event ? event.tool_call_id : null;
  return typeof value === "string" && value ? value : null;
}

function backendToolCallIndex(event: BackendEvent) {
  const value = "tool_call_index" in event ? Number(event.tool_call_index) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

function appendWorkflowEvent(events: WorkflowEvent[], event: Omit<WorkflowEvent, "id">) {
  return [...events, { id: nextId(), ...event }];
}

function updateWorkflowEventByRole(events: WorkflowEvent[], role: WorkflowEvent["role"], patch: Partial<Omit<WorkflowEvent, "id">>) {
  const index = events.findIndex((event) => event.role === role);
  if (index < 0) {
    return events;
  }
  return events.map((event, currentIndex) => currentIndex === index ? { ...event, ...patch } : event);
}

function completePlanning(events: WorkflowEvent[]) {
  return updateWorkflowEventByRole(events, "planning", {
    status: "done",
    detail: "진행 방향을 정했습니다.",
  });
}

function removeWorkflowEventsByRole(events: WorkflowEvent[], role: WorkflowEvent["role"]) {
  return events.filter((event) => event.role !== role);
}

function purposeForTool(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower.includes("read") || lower.includes("grep") || lower.includes("glob") || lower.includes("web")) {
    return "info" as const;
  }
  if (lower.includes("test") || lower.includes("lint") || lower.includes("typecheck") || lower.includes("playwright")) {
    return "verification" as const;
  }
  return "action" as const;
}

function purposeCopy(purpose: WorkflowEvent["purpose"]) {
  if (purpose === "info") {
    return { title: "정보 수집", running: "필요한 자료와 맥락을 확인하고 있습니다.", done: "필요한 정보를 확인했습니다." };
  }
  if (purpose === "verification") {
    return { title: "결과 검증", running: "결과를 확인하고 있습니다.", done: "결과를 확인했습니다." };
  }
  return { title: "작업 실행", running: "필요한 변경이나 명령을 실행하고 있습니다.", done: "작업 실행을 마쳤습니다." };
}

function ensurePurposeEvent(events: WorkflowEvent[], toolName: string): { events: WorkflowEvent[]; groupId: string } {
  const purpose = purposeForTool(toolName);
  const latestPurpose = [...events].reverse().find((event) => event.role === "purpose");
  if (latestPurpose?.purpose === purpose && latestPurpose.groupId) {
    const copy = purposeCopy(purpose);
    return {
      events: events.map((event) => event.id === latestPurpose.id ? { ...event, status: "running", detail: copy.running } : event),
      groupId: latestPurpose.groupId,
    };
  }
  const groupId = `purpose-${nextId()}`;
  const copy = purposeCopy(purpose);
  return {
    events: appendWorkflowEvent(events, {
      toolName: "",
      title: copy.title,
      detail: copy.running,
      status: "running",
      level: "parent",
      role: "purpose",
      purpose,
      groupId,
    }),
    groupId,
  };
}

function refreshPurposeEvents(events: WorkflowEvent[]) {
  return events.map((event) => {
    if (event.role !== "purpose" || !event.groupId) return event;
    const children = events.filter((item) => item.groupId === event.groupId && item.role !== "purpose");
    if (!children.length) return event;
    const copy = purposeCopy(event.purpose);
    const hasRunning = children.some((item) => item.status === "running");
    const hasError = children.some((item) => item.status === "error");
    return {
      ...event,
      status: hasError ? "error" as const : hasRunning ? "running" as const : "done" as const,
      detail: hasError ? "작업 중 문제가 발생했습니다." : hasRunning ? copy.running : copy.done,
    };
  });
}

function startActivityStep(events: WorkflowEvent[]): WorkflowEvent[] {
  if (events.some((event) => event.role === "activity" && event.status === "running")) {
    return events;
  }
  if (events.some((event) => event.level === "child" && event.status === "running")) {
    return events;
  }
  return appendWorkflowEvent(events, {
    toolName: "",
    title: "다음 판단 중",
    detail: "도구 결과를 읽고 다음 작업이나 최종 답변을 결정하고 있습니다.",
    status: "running",
    level: "parent",
    role: "activity",
  });
}

function answerDraftDetail(characterCount = 0) {
  return characterCount > 0
    ? `답변 본문을 작성하고 있습니다. ${characterCount.toLocaleString()}자 수신 중입니다.`
    : "답변이나 다음 도구 호출 내용을 작성하고 있습니다.";
}

function startFinalAnswerStep(events: WorkflowEvent[], characterCount = 0): WorkflowEvent[] {
  let next = completePlanning(removeWorkflowEventsByRole(events, "activity"));
  const existing = next.find((event) => event.role === "final");
  if (existing) {
    return next.map((event) => event.role === "final" ? {
      ...event,
      status: "running" as const,
      title: "응답 작성",
      detail: answerDraftDetail(characterCount),
    } : event);
  }
  next = appendWorkflowEvent(next, {
    toolName: "",
    title: "응답 작성",
    detail: answerDraftDetail(characterCount),
    status: "running",
    level: "parent",
    role: "final",
  });
  return refreshPurposeEvents(next);
}

function finishFinalAnswerStep(events: WorkflowEvent[], status: WorkflowEventStatus = "done", detail = "최종 답변을 작성했습니다."): WorkflowEvent[] {
  let next = completePlanning(removeWorkflowEventsByRole(events, "activity"));
  const existing = next.find((event) => event.role === "final");
  if (!existing) {
    next = appendWorkflowEvent(next, {
      toolName: "",
      title: "최종 답변",
      detail,
      status,
      level: "parent",
      role: "final",
    });
  } else {
    next = next.map((event) => event.role === "final" ? { ...event, title: "응답 작성", status, detail } : event);
  }
  return refreshPurposeEvents(next);
}

function updateLatestWorkflowEvent(
  events: WorkflowEvent[],
  toolName: string,
  patch: Partial<Omit<WorkflowEvent, "id" | "toolName">>,
  identity: { toolCallId?: string | null; toolCallIndex?: number | null } = {},
) {
  const callId = identity.toolCallId || null;
  const callIndex = identity.toolCallIndex ?? null;
  const reversed = [...events].reverse();
  let index = callId
    ? reversed.findIndex((event) => event.toolCallId === callId && event.status === "running")
    : -1;
  if (index === -1 && callIndex !== null) {
    index = reversed.findIndex(
      (event) => event.toolName === toolName && event.toolCallIndex === callIndex && event.status === "running",
    );
  }
  if (index === -1) {
    index = reversed.findIndex((event) => (
      event.toolName === toolName
      && event.status === "running"
      && !event.toolCallId
      && (callIndex === null || event.toolCallIndex === callIndex || event.toolCallIndex === null)
    ));
  }
  if (index === -1) return null;
  const realIndex = events.length - 1 - index;
  return events.map((event, currentIndex) => (currentIndex === realIndex ? { ...event, ...patch } : event));
}

function workflowSnapshotMap(state: AppState) {
  if (!state.workflowAnchorMessageId || !state.workflowEvents.length) {
    return state.workflowEventsByMessageId;
  }
  return {
    ...state.workflowEventsByMessageId,
    [state.workflowAnchorMessageId]: state.workflowEvents,
  };
}

function workflowDurationSnapshotMap(state: AppState) {
  if (!state.workflowAnchorMessageId || !state.workflowDurationSeconds) {
    return state.workflowDurationSecondsByMessageId;
  }
  return {
    ...state.workflowDurationSecondsByMessageId,
    [state.workflowAnchorMessageId]: state.workflowDurationSeconds,
  };
}

function workflowDurationFromMetadata(metadata?: Record<string, unknown> | null) {
  const seconds = Number(metadata?.workflow_duration_seconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

function normalizeCommands(commands: unknown[]): CommandItem[] {
  return commands
    .map((command) => {
      if (typeof command === "string") {
        return { name: command, description: "" };
      }
      if (command && typeof command === "object") {
        const raw = command as Record<string, unknown>;
        return {
          name: String(raw.name || raw.command || "").trim(),
          description: String(raw.description || raw.detail || "").trim(),
        };
      }
      return { name: "", description: "" };
    })
    .filter((command) => command.name);
}

function normalizeSkills(skills: unknown[]): SkillItem[] {
  return skills
    .map((skill) => {
      if (typeof skill === "string") {
        return { name: skill, description: "", enabled: true };
      }
      if (skill && typeof skill === "object") {
        const raw = skill as Record<string, unknown>;
        return {
          name: String(raw.name || "").trim(),
          description: String(raw.description || "").trim(),
          source: String(raw.source || "").trim(),
          enabled: raw.enabled !== false,
        };
      }
      return { name: "", description: "", enabled: true };
    })
    .filter((skill) => skill.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeChatTitle(value: string) {
  return value.trim() || "MyHarness";
}

function updateCurrentHistoryTitle(history: HistoryItem[], sessionId: string | null, title: string) {
  if (!sessionId) return history;
  return history.map((item) => (
    item.value === sessionId ? { ...item, description: title } : item
  ));
}

function removeLiveHistoryRowsForSession(history: HistoryItem[], sessionId: string | null) {
  const activeSessionId = String(sessionId || "").trim();
  if (!activeSessionId) return history;
  return history.filter((item) => (
    item.live !== true
    || (item.liveSessionId !== activeSessionId && item.value !== activeSessionId)
  ));
}

function ensureLiveHistoryItem(state: AppState, userText: string) {
  const sessionId = state.activeHistoryId || state.sessionId;
  if (!sessionId) return state.history;
  if (state.history.some((item) => item.value === sessionId)) {
    return state.history;
  }
  const description = state.chatTitle !== "MyHarness"
    ? state.chatTitle
    : userText.trim().replace(/\s+/g, " ").slice(0, 50) || "새 채팅";
  return [
    {
      value: sessionId,
      label: "진행 중인 채팅",
      description,
      workspace: state.workspacePath || state.workspaceName
        ? { name: state.workspaceName, path: state.workspacePath, scope: state.workspaceScope }
        : null,
    },
    ...state.history,
  ];
}

function applyStateSnapshot(state: AppState, event: Extract<BackendEvent, { type: "ready" | "state_snapshot" }>): AppState {
  const snapshot = event.state || {};
  const provider = String(snapshot.provider || state.provider);
  const providerLabel = String(snapshot.provider_label || state.providerLabel || provider);
  return {
    ...state,
    ready: event.type === "ready" ? true : state.ready,
    status: event.type === "ready" ? "ready" : state.status,
    statusText: event.type === "ready" ? "준비됨" : state.statusText,
    provider,
    providerLabel,
    model: String(snapshot.model || state.model),
    effort: String(snapshot.effort || state.effort),
    permissionMode: String(snapshot.permission_mode || state.permissionMode),
    workspaceName: String(snapshot.workspace?.name || state.workspaceName),
    workspacePath: String(snapshot.workspace?.path || state.workspacePath),
    workspaceScope: snapshot.workspace?.scope || state.workspaceScope,
  };
}

function normalizeRuntimeOption(option: Record<string, unknown>): { value: string; label: string; description?: string; active?: boolean } | null {
  const value = String(option.value || option.name || option.label || "").trim();
  const label = String(option.label || option.name || option.value || "").trim();
  if (!value && !label) return null;
  return {
    value: value || label,
    label: label || value,
    description: typeof option.description === "string" ? option.description : undefined,
    active: option.active === true,
  };
}

function activeRuntimeOptions(options: Array<{ value: string; label: string; description?: string; active?: boolean }>, currentValue: string) {
  const current = String(currentValue || "").trim().toLowerCase();
  const activeIndex = options.findIndex((option) => String(option.value || "").trim().toLowerCase() === current)
    ?? -1;
  const fallbackIndex = activeIndex >= 0 ? activeIndex : options.findIndex((option) => option.active);
  return options.map((option, index) => ({ ...option, active: index === fallbackIndex }));
}

function runtimePickerFromOptions(state: AppState, runtimeOptions: Record<string, unknown>) {
  const providers = activeRuntimeOptions(
    (Array.isArray(runtimeOptions.providers) ? runtimeOptions.providers : [])
      .map((option) => normalizeRuntimeOption(option as Record<string, unknown>))
      .filter((option): option is NonNullable<typeof option> => Boolean(option)),
    state.provider,
  );
  const rawModels = runtimeOptions.models_by_provider && typeof runtimeOptions.models_by_provider === "object"
    ? runtimeOptions.models_by_provider as Record<string, unknown>
    : {};
  const modelsByProvider = Object.fromEntries(Object.entries(rawModels).map(([provider, options]) => [
    provider,
    activeRuntimeOptions(
      (Array.isArray(options) ? options : [])
        .map((option) => normalizeRuntimeOption(option as Record<string, unknown>))
        .filter((option): option is NonNullable<typeof option> => Boolean(option)),
      state.model,
    ),
  ]));
  const selectedProvider = providers.find((option) => option.active)?.value || state.provider || providers[0]?.value || "";
  const models = modelsByProvider[selectedProvider] || [];
  const efforts = activeRuntimeOptions(
    (Array.isArray(runtimeOptions.efforts) ? runtimeOptions.efforts : [])
      .map((option) => normalizeRuntimeOption(option as Record<string, unknown>))
      .filter((option): option is NonNullable<typeof option> => Boolean(option)),
    state.effort,
  );
  return {
    ...state.runtimePicker,
    open: true,
    loading: false,
    error: "",
    providers,
    modelsByProvider,
    models,
    efforts,
    selectedProvider,
    modelOpen: false,
    effortOpen: false,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "session_started":
      return {
        ...state,
        sessionId: action.sessionId,
        clientId: action.clientId || state.clientId,
        history: removeLiveHistoryRowsForSession(state.history, action.sessionId),
        pendingFreshChat: false,
        status: "ready",
        statusText: "준비됨",
      };

    case "append_message":
      if (action.message.role === "user") {
        const message = createMessage(action.message);
        return {
          ...state,
          history: ensureLiveHistoryItem(state, action.message.text),
          messages: [...state.messages, message],
          workflowAnchorMessageId: message.id,
          workflowEventsByMessageId: workflowSnapshotMap(state),
          workflowDurationSecondsByMessageId: workflowDurationSnapshotMap(state),
          workflowEvents: initialWorkflowEvents(),
          workflowDurationSeconds: null,
        };
      }
      return {
        ...state,
        messages: appendMessage(state.messages, action.message),
      };

    case "session_replaced":
      return {
        ...state,
        sessionId: action.sessionId,
        chatTitle: "MyHarness",
        ready: false,
        busy: false,
        status: "connecting",
        statusText: "연결 중",
        messages: [],
        workflowAnchorMessageId: null,
        workflowEventsByMessageId: {},
        workflowDurationSecondsByMessageId: {},
        workflowInputBuffers: {},
        activeHistoryId: null,
        restoringHistory: false,
        pendingFreshChat: false,
        artifacts: [],
        artifactPanelOpen: false,
        activeArtifact: null,
        activeArtifactPayload: null,
        artifactRefreshKey: state.artifactRefreshKey + 1,
        todoMarkdown: "",
        todoCollapsed: false,
        workflowEvents: [],
        workflowDurationSeconds: null,
        history: removeLiveHistoryRowsForSession(state.history, action.sessionId),
        workspaceName: action.workspace?.name || state.workspaceName,
        workspacePath: action.workspace?.path || state.workspacePath,
        workspaceScope: action.workspace?.scope || state.workspaceScope,
      };

    case "set_theme":
      return { ...state, themeId: action.themeId };

    case "set_sidebar_collapsed":
      return { ...state, sidebarCollapsed: action.value };

    case "set_draft":
      return { ...state, composer: { ...state.composer, draft: action.value } };

    case "set_busy":
      return { ...state, busy: action.value };

    case "set_chat_title": {
      const title = normalizeChatTitle(action.value);
      return {
        ...state,
        chatTitle: title,
        history: updateCurrentHistoryTitle(state.history, state.activeHistoryId || state.sessionId, title),
      };
    }

    case "set_system_prompt": {
      try {
        localStorage.setItem("myharness:systemPrompt", action.value);
      } catch {
        // Embedded/private contexts may block localStorage.
      }
      return { ...state, systemPrompt: action.value };
    }

    case "set_app_settings": {
      const appSettings = normalizeAppSettings({ ...state.appSettings, ...action.value });
      saveAppSettings(appSettings);
      return { ...state, appSettings };
    }

    case "clear_composer":
      return {
        ...state,
        composer: { draft: "", attachments: [], pastedTexts: [], token: null },
      };

    case "add_attachment":
      return {
        ...state,
        composer: {
          ...state.composer,
          attachments: [...state.composer.attachments, action.attachment],
        },
      };

    case "remove_attachment":
      return {
        ...state,
        composer: {
          ...state.composer,
          attachments: state.composer.attachments.filter((_, index) => index !== action.index),
        },
      };

    case "add_pasted_text":
      return {
        ...state,
        composer: {
          ...state.composer,
          pastedTexts: [...state.composer.pastedTexts, action.text],
        },
      };

    case "remove_pasted_text":
      return {
        ...state,
        composer: {
          ...state.composer,
          pastedTexts: state.composer.pastedTexts.filter((_, index) => index !== action.index),
        },
      };

    case "set_workspaces":
      return {
        ...state,
        workspaces: action.workspaces,
        workspaceScope: action.scope || state.workspaceScope,
      };

    case "set_workspace":
      return {
        ...state,
        workspaceName: action.workspace.name,
        workspacePath: action.workspace.path,
        workspaceScope: action.workspace.scope || state.workspaceScope,
      };

    case "set_history":
      return {
        ...state,
        history: removeLiveHistoryRowsForSession(action.history, state.sessionId),
        historyLoading: false,
      };

    case "set_history_loading":
      return { ...state, historyLoading: action.value };

    case "begin_new_chat":
      return {
        ...state,
        chatTitle: "MyHarness",
        busy: false,
        status: state.sessionId ? "ready" : state.status,
        statusText: state.sessionId ? "준비됨" : state.statusText,
        messages: [],
        workflowAnchorMessageId: null,
        workflowEventsByMessageId: {},
        workflowDurationSecondsByMessageId: {},
        workflowInputBuffers: {},
        activeHistoryId: null,
        restoringHistory: false,
        pendingFreshChat: Boolean(state.sessionId),
        artifactPanelOpen: false,
        activeArtifact: null,
        activeArtifactPayload: null,
        todoMarkdown: "",
        todoCollapsed: false,
        workflowEvents: [],
        workflowDurationSeconds: null,
      };

    case "begin_history_restore":
      return {
        ...state,
        activeHistoryId: action.sessionId,
        restoringHistory: true,
        pendingFreshChat: false,
      };

    case "finish_history_restore":
      return { ...state, restoringHistory: false };

    case "set_artifacts":
      return { ...state, artifacts: action.artifacts };

    case "refresh_artifacts":
      return { ...state, artifactRefreshKey: state.artifactRefreshKey + 1 };

    case "set_artifact_panel_width":
      return state.activeArtifact
        ? { ...state, artifactPanelWidth: action.value, artifactPanelPreviewWidth: action.value }
        : { ...state, artifactPanelWidth: action.value, artifactPanelListWidth: action.value };

    case "set_artifact_resizing":
      return { ...state, artifactResizing: action.value };

    case "open_artifact_list":
      return {
        ...state,
        artifactPanelOpen: true,
        activeArtifact: null,
        activeArtifactPayload: null,
        artifactPanelWidth: state.artifactPanelListWidth,
      };

    case "open_artifact":
      return {
        ...state,
        artifactPanelOpen: true,
        activeArtifact: action.artifact,
        activeArtifactPayload: action.payload || null,
        artifactPanelWidth: state.artifactPanelPreviewWidth,
      };

    case "set_artifact_payload":
      return { ...state, activeArtifactPayload: action.payload };

    case "close_artifact":
      return {
        ...state,
        artifactPanelOpen: false,
        activeArtifact: null,
        activeArtifactPayload: null,
      };

    case "open_modal":
      return { ...state, modal: action.modal };

    case "close_modal":
      return { ...state, modal: null };

    case "open_runtime_picker":
      return {
        ...state,
        modal: state.modal?.kind === "modelSettings" ? null : state.modal,
        runtimePicker: { ...state.runtimePicker, open: true, loading: true, error: "" },
      };

    case "close_runtime_picker":
      return { ...state, runtimePicker: { ...state.runtimePicker, open: false, loading: false, error: "" } };

    case "set_runtime_picker_error":
      return { ...state, runtimePicker: { ...state.runtimePicker, open: true, loading: false, error: action.message } };

    case "select_runtime_provider": {
      const models = state.runtimePicker.modelsByProvider[action.value] || [];
      return {
        ...state,
        provider: action.value,
        providerLabel: state.runtimePicker.providers.find((option) => option.value === action.value)?.label || state.providerLabel,
        runtimePicker: {
          ...state.runtimePicker,
          providers: state.runtimePicker.providers.map((option) => ({ ...option, active: option.value === action.value })),
          selectedProvider: action.value,
          models: activeRuntimeOptions(models, state.model),
          modelOpen: true,
          effortOpen: false,
        },
      };
    }

    case "select_runtime_model":
      return {
        ...state,
        model: action.value,
        runtimePicker: {
          ...state.runtimePicker,
          models: state.runtimePicker.models.map((option) => ({ ...option, active: option.value === action.value })),
          effortOpen: true,
        },
      };

    case "select_runtime_effort":
      return {
        ...state,
        effort: action.value,
        runtimePicker: {
          ...state.runtimePicker,
          efforts: state.runtimePicker.efforts.map((option) => ({ ...option, active: option.value === action.value })),
        },
      };

    case "toggle_todo_collapsed":
      return { ...state, todoCollapsed: !state.todoCollapsed };

    case "dismiss_todo":
      return { ...state, todoMarkdown: "", todoCollapsed: false };

    case "clear_workflow":
      return { ...state, workflowEvents: [], workflowEventsByMessageId: {}, workflowDurationSecondsByMessageId: {}, workflowDurationSeconds: null };

    case "clear_messages":
      return { ...state, messages: [], workflowAnchorMessageId: null, workflowEventsByMessageId: {}, workflowDurationSecondsByMessageId: {}, workflowInputBuffers: {}, todoMarkdown: "", todoCollapsed: false, workflowEvents: [], workflowDurationSeconds: null };

    case "backend_event": {
      if (action.sessionId && action.sessionId !== state.sessionId) {
        return state;
      }
      const event = action.event;

      if (event.type === "ready" || event.type === "state_snapshot") {
        const next = applyStateSnapshot(state, event as Extract<BackendEvent, { type: "ready" | "state_snapshot" }>);
        if (event.type === "ready") {
          return {
            ...next,
            commands: normalizeCommands(Array.isArray(event.commands) ? event.commands : []),
            skills: normalizeSkills(Array.isArray(event.skills) ? event.skills : []),
          };
        }
        return next;
      }

      if (event.type === "skills_snapshot") {
        return {
          ...state,
          skills: normalizeSkills(Array.isArray(event.skills) ? event.skills : []),
        };
      }

      if (event.type === "clear_transcript") {
        return {
          ...state,
          messages: [],
          workflowAnchorMessageId: null,
          workflowEventsByMessageId: {},
          workflowDurationSecondsByMessageId: {},
          workflowInputBuffers: {},
          todoMarkdown: "",
          workflowEvents: [],
          workflowDurationSeconds: null,
        };
      }

      if (event.type === "history_snapshot") {
        const historyEvent = event as Extract<BackendEvent, { type: "history_snapshot" }>;
        const messages: ChatMessage[] = [];
        let workflowEvents: WorkflowEvent[] = [];
        let workflowAnchorMessageId: string | null = null;
        const workflowEventsByMessageId: Record<string, WorkflowEvent[]> = {};
        const workflowDurationSecondsByMessageId: Record<string, number> = {};
        const historyEvents = (Array.isArray(historyEvent.history_events) ? historyEvent.history_events : [])
          .map((item) => (item && typeof item === "object" ? item as Record<string, unknown> : {}));
        for (const [index, record] of historyEvents.entries()) {
          const type = String(record.type || "");
          if (type === "user") {
            if (workflowAnchorMessageId && workflowEvents.length) {
              workflowEventsByMessageId[workflowAnchorMessageId] = workflowEvents;
            }
            const message = createMessage({ role: "user", text: String(record.text || "") });
            messages.push(message);
            workflowAnchorMessageId = message.id;
            workflowEvents = initialWorkflowEvents();
            continue;
          }
          if (type === "assistant") {
            const text = String(record.text || "");
            if (text.trim()) {
              messages.push(createMessage({ role: "assistant", text, isComplete: isFinalRestoredAssistantAnswer(historyEvents, index) }));
            }
            continue;
          }
          if (type === "tool_started") {
            const toolName = String(record.tool_name || "");
            const toolInput = recordOrNull(record.tool_input);
            const toolCallId = typeof record.tool_call_id === "string" && record.tool_call_id ? record.tool_call_id : null;
            const rawToolCallIndex = Number(record.tool_call_index);
            const toolCallIndex = Number.isFinite(rawToolCallIndex) ? rawToolCallIndex : null;
            const purpose = ensurePurposeEvent(completePlanning(workflowEvents.length ? workflowEvents : initialWorkflowEvents()), toolName);
            workflowEvents = appendWorkflowEvent(purpose.events, {
              toolName,
              title: workflowTitle(toolName),
              detail: workflowDetailFromInput(toolInput),
              status: "running",
              level: "child",
              groupId: purpose.groupId,
              toolCallId,
              toolCallIndex,
              toolInput,
            });
            continue;
          }
          if (type === "tool_completed") {
            const toolName = String(record.tool_name || "");
            const toolCallId = typeof record.tool_call_id === "string" && record.tool_call_id ? record.tool_call_id : null;
            const rawToolCallIndex = Number(record.tool_call_index);
            const toolCallIndex = Number.isFinite(rawToolCallIndex) ? rawToolCallIndex : null;
            const output = String(record.output || "");
            const isError = record.is_error === true;
            let nextEvents = updateLatestWorkflowEvent(workflowEvents, toolName, {
              detail: output.split(/\r?\n/).find((line) => line.trim()) || `${toolName || "도구"} 완료`,
              output,
              status: isError ? "error" : "done",
              toolCallId,
              toolCallIndex,
            }, { toolCallId, toolCallIndex });
            if (!nextEvents) {
              const purpose = ensurePurposeEvent(completePlanning(workflowEvents.length ? workflowEvents : initialWorkflowEvents()), toolName);
              nextEvents = appendWorkflowEvent(purpose.events, {
                toolName,
                title: workflowTitle(toolName),
                detail: output.split(/\r?\n/).find((line) => line.trim()) || `${toolName || "도구"} 완료`,
                output,
                status: isError ? "error" : "done",
                level: "child",
                groupId: purpose.groupId,
                toolCallId,
                toolCallIndex,
              });
            }
            workflowEvents = refreshPurposeEvents(nextEvents);
          }
        }
        if (workflowAnchorMessageId && workflowEvents.length) {
          workflowEventsByMessageId[workflowAnchorMessageId] = workflowEvents;
          const workflowDurationSeconds = workflowDurationFromMetadata(historyEvent.compact_metadata);
          if (workflowDurationSeconds) {
            workflowDurationSecondsByMessageId[workflowAnchorMessageId] = workflowDurationSeconds;
          }
        }
        return {
          ...state,
          activeHistoryId: String(historyEvent.value || state.activeHistoryId || "").trim() || null,
          chatTitle: normalizeChatTitle(String(historyEvent.message || state.chatTitle || "")),
          messages,
          workflowAnchorMessageId,
          workflowEventsByMessageId,
          workflowDurationSecondsByMessageId,
          workflowEvents,
          workflowDurationSeconds: workflowAnchorMessageId ? workflowDurationSecondsByMessageId[workflowAnchorMessageId] ?? null : null,
          restoringHistory: true,
          pendingFreshChat: false,
          busy: false,
          status: "ready",
          statusText: "준비됨",
        };
      }

      if (event.type === "status") {
        return {
          ...state,
          statusText: String(event.message || event.value || state.statusText),
        };
      }

      if (event.type === "session_title") {
        const title = normalizeChatTitle(String(event.message ?? event.value ?? ""));
        return {
          ...state,
          chatTitle: title,
          history: updateCurrentHistoryTitle(state.history, state.activeHistoryId || state.sessionId, title),
        };
      }

      if (event.type === "active_session") {
        const activeHistoryId = String(event.value || "").trim() || null;
        return {
          ...state,
          activeHistoryId,
          restoringHistory: false,
          pendingFreshChat: false,
        };
      }

      if (event.type === "transcript_item" && event.item) {
        const item = event.item as NonNullable<Extract<BackendEvent, { type: "transcript_item" }>["item"]>;
        if (isNonConversationTranscriptItem(item)) {
          return state;
        }
        if (
          item.role === "user"
          && (item.kind === "steering" || item.kind === "queued")
          && /^\/plan(?:\s|$)/i.test(String(item.text || "").trim())
        ) {
          return state;
        }
        const text = normalizeVisibleText(item.text);
        if (item.role === "user" && item.kind !== "steering" && item.kind !== "queued") {
          const last = state.messages[state.messages.length - 1];
          if (last?.role === "user" && last.text === text && !last.kind) {
            return state;
          }
        }
        return {
          ...state,
          messages: appendMessage(state.messages, {
            role: item.role,
            text,
            kind: item.kind || undefined,
            toolName: item.tool_name || undefined,
            isError: item.is_error === true,
          }),
        };
      }

      if (event.type === "assistant_delta") {
        const value = String(event.message ?? event.value ?? "");
        const last = state.messages[state.messages.length - 1];
        const characterCount = (last?.role === "assistant" ? last.text.length : 0) + value.length;
        const workflowEvents = startFinalAnswerStep(state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents(), characterCount);
        if (last?.role === "assistant") {
          return {
            ...state,
            busy: true,
            status: "processing",
            statusText: "응답 작성 중",
            workflowEvents,
            messages: [
              ...state.messages.slice(0, -1),
              { ...last, text: `${last.text}${value}` },
            ],
          };
        }
        return {
          ...state,
          busy: true,
          status: "processing",
          statusText: "응답 작성 중",
          workflowEvents,
          messages: appendMessage(state.messages, { role: "assistant", text: value }),
        };
      }

      if (event.type === "assistant_complete") {
        const value = normalizeVisibleText(String(event.message || ""));
        const last = state.messages[state.messages.length - 1];
        const isFinalAnswer = event.has_tool_uses !== true;
        const messages = value
          ? last?.role === "assistant"
            ? [
                ...state.messages.slice(0, -1),
                { ...last, text: value, isComplete: isFinalAnswer },
              ]
            : appendMessage(state.messages, { role: "assistant", text: value, isComplete: isFinalAnswer })
          : isFinalAnswer && last?.role === "assistant"
            ? [...state.messages.slice(0, -1), { ...last, isComplete: true }]
            : state.messages;
        return {
          ...state,
          busy: event.has_tool_uses === true,
          messages,
          workflowEvents: isFinalAnswer
            ? finishFinalAnswerStep(state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents())
            : removeWorkflowEventsByRole(state.workflowEvents, "final"),
          status: event.has_tool_uses === true ? "processing" : "ready",
          statusText: event.has_tool_uses === true ? "도구 실행 준비 중" : "준비됨",
        };
      }

      if (event.type === "tool_started") {
        const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
        const label = compactToolStatus(toolName, "도구 실행 중");
        const toolInput = recordOrNull(event.tool_input);
        const toolCallId = backendToolCallId(event);
        const toolCallIndex = backendToolCallIndex(event);
        const purpose = ensurePurposeEvent(
          completePlanning(removeWorkflowEventsByRole(state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents(), "activity")),
          toolName,
        );
        const command = isShellTool(toolName) ? commandFromToolInput(toolInput) : "";
        const messages = command
          ? updateLatestTerminalMessage(state.messages, command, { command, status: "running" }) || state.messages
          : state.messages;
        const startedWorkflowEvents = updateLatestWorkflowEvent(purpose.events, toolName, {
          detail: workflowDetailFromInput(toolInput),
          status: "running",
          toolCallId,
          toolCallIndex,
          toolInput,
        }, { toolCallId, toolCallIndex }) || appendWorkflowEvent(purpose.events, {
          toolName,
          title: workflowTitle(toolName),
          detail: workflowDetailFromInput(toolInput),
          status: "running",
          level: "child",
          groupId: purpose.groupId,
          toolCallId,
          toolCallIndex,
          toolInput,
        });
        return {
          ...state,
          busy: true,
          messages,
          status: "processing",
          statusText: label,
          workflowInputBuffers: Object.fromEntries(
            Object.entries(state.workflowInputBuffers).filter(([key]) => !key.startsWith(`${toolName || "tool"}:`)),
          ),
          workflowEvents: startedWorkflowEvents,
        };
      }

      if (event.type === "tool_input_delta") {
        const deltaEvent = event as Extract<BackendEvent, { type: "tool_input_delta" }>;
        const toolName = typeof deltaEvent.tool_name === "string" ? deltaEvent.tool_name : "";
        const toolCallIndex = backendToolCallIndex(deltaEvent);
        const delta = String(deltaEvent.arguments_delta || "");
        if (!delta) {
          return state;
        }
        const key = workflowInputBufferKey(deltaEvent);
        const current = state.workflowInputBuffers[key] || "";
        const nextBuffer = current && /^\s*\{/.test(delta) && /\}\s*$/.test(current) ? delta : `${current}${delta}`;
        const toolInput = partialToolInputFromBuffer(toolName, nextBuffer);
        const workflowInputBuffers = { ...state.workflowInputBuffers, [key]: nextBuffer };
        if (!toolInput) {
          return { ...state, busy: true, workflowInputBuffers };
        }
        const detail = workflowDetailFromInput(toolInput) || "작성 내용 수신 중";
        let workflowEvents = updateLatestWorkflowEvent(state.workflowEvents, toolName, {
          detail,
          status: "running",
          toolCallIndex,
          toolInput,
        }, { toolCallIndex });
        if (!workflowEvents) {
          const purpose = ensurePurposeEvent(
            completePlanning(removeWorkflowEventsByRole(state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents(), "activity")),
            toolName,
          );
          workflowEvents = appendWorkflowEvent(purpose.events, {
            toolName,
            title: workflowTitle(toolName),
            detail,
            status: "running",
            level: "child",
            groupId: purpose.groupId,
            toolCallIndex,
            toolInput,
          });
        }
        return {
          ...state,
          busy: true,
          workflowInputBuffers,
          workflowEvents: refreshPurposeEvents(workflowEvents),
          status: "processing",
          statusText: compactToolStatus(toolName, `${workflowTitle(toolName)} 중`),
        };
      }

      if (event.type === "tool_progress") {
        const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
        const toolCallId = backendToolCallId(event);
        const toolCallIndex = backendToolCallIndex(event);
        const detail = String(event.message || workflowDetailFromInput(recordOrNull(event.tool_input)) || "처리 중");
        let workflowEvents = updateLatestWorkflowEvent(state.workflowEvents, toolName, {
          detail,
          status: "running",
          toolCallId,
          toolCallIndex,
        }, { toolCallId, toolCallIndex });
        if (!workflowEvents) {
          const purpose = ensurePurposeEvent(completePlanning(state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents()), toolName);
          workflowEvents = appendWorkflowEvent(purpose.events, {
            toolName,
            title: `${workflowTitle(toolName)} 중`,
            detail,
            status: "running",
            level: "child",
            groupId: purpose.groupId,
            toolCallId,
            toolCallIndex,
            toolInput: recordOrNull(event.tool_input),
          });
        }
        return {
          ...state,
          busy: true,
          workflowEvents: refreshPurposeEvents(workflowEvents),
          status: "processing",
          statusText: compactToolStatus(toolName),
        };
      }

      if (event.type === "tool_completed") {
        const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
        const toolCallId = backendToolCallId(event);
        const toolCallIndex = backendToolCallIndex(event);
        const output = String(event.output || "");
        const isError = event.is_error === true;
        const lastToolInput = [...state.workflowEvents]
          .reverse()
          .find((workflowEvent) => {
            if (toolCallId) {
              return workflowEvent.toolCallId === toolCallId && workflowEvent.toolInput;
            }
            if (toolCallIndex !== null) {
              return workflowEvent.toolName === toolName && workflowEvent.toolCallIndex === toolCallIndex && workflowEvent.toolInput;
            }
            return workflowEvent.toolName === toolName && workflowEvent.toolInput;
          })?.toolInput || null;
        const command = isShellTool(toolName) ? commandFromToolInput(lastToolInput) : "";
        const messages = command
          ? updateLatestTerminalMessage(state.messages, command, {
              command,
              output,
              status: isError ? "error" : "done",
            }) || state.messages
          : state.messages;
        let workflowEvents = updateLatestWorkflowEvent(state.workflowEvents, toolName, {
          detail: output.split(/\r?\n/).find((line) => line.trim()) || `${toolName || "도구"} 완료`,
          output,
          status: isError ? "error" : "done",
          toolCallId,
          toolCallIndex,
        }, { toolCallId, toolCallIndex });
        if (!workflowEvents) {
          const purpose = ensurePurposeEvent(completePlanning(state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents()), toolName);
          workflowEvents = appendWorkflowEvent(purpose.events, {
            toolName,
            title: workflowTitle(toolName),
            detail: output.split(/\r?\n/).find((line) => line.trim()) || `${toolName || "도구"} 완료`,
            output,
            status: isError ? "error" : "done",
            level: "child",
            groupId: purpose.groupId,
            toolCallId,
            toolCallIndex,
          });
        }
        workflowEvents = startActivityStep(refreshPurposeEvents(workflowEvents));
        return {
          ...state,
          busy: true,
          messages,
          workflowEvents,
          workflowInputBuffers: Object.fromEntries(
            Object.entries(state.workflowInputBuffers).filter(([key]) => !key.startsWith(`${toolName || "tool"}:`)),
          ),
          artifactRefreshKey: state.artifactRefreshKey + 1,
          status: "processing",
          statusText: isError ? "도구 결과 확인 중" : "도구 결과 검토 중",
        };
      }

      if (event.type === "todo_update") {
        const todoMarkdown = String(event.todo_markdown || "");
        return {
          ...state,
          todoMarkdown,
          todoCollapsed: todoMarkdown.trim() ? state.todoCollapsed : false,
        };
      }

      if (event.type === "modal_request") {
        const payload = event.modal && typeof event.modal === "object"
          ? event.modal as Record<string, unknown>
          : {};
        return {
          ...state,
          modal: { kind: "backend", payload },
        };
      }

      if (event.type === "select_request") {
        const modal = event.modal && typeof event.modal === "object" ? event.modal as Record<string, unknown> : {};
        const command = String(modal.command || "").trim().toLowerCase();
        if (state.runtimePicker.open && command === "runtime-picker") {
          const runtimeOptions = modal.runtime_options && typeof modal.runtime_options === "object"
            ? modal.runtime_options as Record<string, unknown>
            : {};
          return {
            ...state,
            runtimePicker: runtimePickerFromOptions(state, runtimeOptions),
          };
        }
        const payload = {
          ...modal,
          select_options: Array.isArray(event.select_options) ? event.select_options : [],
          message: event.message || "",
        };
        return {
          ...state,
          modal: { kind: "backend", payload },
        };
      }

      if (event.type === "line_complete") {
        const workflowDurationSeconds = workflowDurationFromMetadata(recordOrNull(event.compact_metadata));
        const workflowDurationSecondsByMessageId = workflowDurationSeconds && state.workflowAnchorMessageId
          ? {
              ...state.workflowDurationSecondsByMessageId,
              [state.workflowAnchorMessageId]: workflowDurationSeconds,
            }
          : state.workflowDurationSecondsByMessageId;
        return {
          ...state,
          busy: false,
          status: state.status === "error" ? "error" : "ready",
          statusText: state.status === "error" ? state.statusText : "준비됨",
          artifactRefreshKey: event.type === "line_complete" ? state.artifactRefreshKey + 1 : state.artifactRefreshKey,
          historyRefreshKey: state.historyRefreshKey + 1,
          workflowDurationSeconds: workflowDurationSeconds ?? state.workflowDurationSeconds,
          workflowDurationSecondsByMessageId,
        };
      }

      if (event.type === "shutdown") {
        const message = "진행 중이던 세션이 종료되었습니다. 새 세션에 다시 연결한 뒤 이어서 입력해주세요.";
        return {
          ...state,
          sessionId: null,
          ready: false,
          busy: false,
          status: "connecting",
          statusText: "세션이 종료되어 새 세션에 다시 연결 중입니다.",
          messages: state.busy ? appendErrorMessage(state.messages, message) : state.messages,
          workflowEvents: state.busy
            ? finishFinalAnswerStep(
                state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents(),
                "error",
                message,
              )
            : state.workflowEvents,
        };
      }

      if (event.type === "error") {
        const message = normalizeVisibleText(String(event.message || "오류"));
        return {
          ...state,
          messages: appendErrorMessage(state.messages, message),
          workflowEvents: finishFinalAnswerStep(
            state.workflowEvents.length ? state.workflowEvents : initialWorkflowEvents(),
            "error",
            message || "응답을 마무리하지 못했습니다.",
          ),
          busy: false,
          status: "error",
          statusText: message,
        };
      }

      return state;
    }

    default:
      return state;
  }
}
