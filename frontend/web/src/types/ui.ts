import type { ArtifactSummary, Attachment, CommandItem, HistoryItem, SkillItem, SwarmNotificationSnapshot, SwarmTeammateSnapshot, TranscriptItem, Workspace, WorkspaceScope } from "./backend";

export type StatusKind =
  | "connecting"
  | "startingBackend"
  | "ready"
  | "thinking"
  | "sending"
  | "processing"
  | "restoring"
  | "error"
  | "stopped"
  | "startFailed"
  | "connectionError";

export type ChatMessage = {
  id: string;
  role: TranscriptItem["role"];
  text: string;
  kind?: TranscriptItem["kind"];
  toolName?: string;
  isError?: boolean;
  isComplete?: boolean;
  terminal?: {
    command: string;
    output?: string;
    status?: "running" | "done" | "error";
  };
};

export type WorkflowEventStatus = "running" | "done" | "error" | "warning";

export type WorkflowEvent = {
  id: string;
  toolName: string;
  title: string;
  detail: string;
  status: WorkflowEventStatus;
  level?: "parent" | "child";
  role?: "planning" | "purpose" | "activity" | "final" | "waiting";
  purpose?: "info" | "action" | "verification";
  groupId?: string;
  toolCallId?: string | null;
  toolCallIndex?: number | null;
  toolInput?: Record<string, unknown> | null;
  output?: string;
};

export type ThemeId = "light" | "posco" | "dark" | "mono" | "mono-orange";

export type ComposerState = {
  draft: string;
  attachments: Attachment[];
  pastedTexts: string[];
  token: string | null;
};

export type AppState = {
  sessionId: string | null;
  clientId: string;
  ready: boolean;
  busy: boolean;
  status: StatusKind;
  statusText: string;
  provider: string;
  providerLabel: string;
  model: string;
  effort: string;
  permissionMode: string;
  chatTitle: string;
  systemPrompt: string;
  appSettings: AppSettings;
  themeId: ThemeId;
  sidebarCollapsed: boolean;
  commands: CommandItem[];
  skills: SkillItem[];
  workspaceName: string;
  workspacePath: string;
  workspaceScope: WorkspaceScope;
  workspaces: Workspace[];
  history: HistoryItem[];
  deletedHistoryIds: string[];
  historyLoading: boolean;
  historyRefreshKey: number;
  activeHistoryId: string | null;
  restoringHistory: boolean;
  historyReadOnly: boolean;
  pendingFreshChat: boolean;
  preserveMessagesOnNextClearTranscript: boolean;
  artifacts: ArtifactSummary[];
  artifactPanelOpen: boolean;
  activeArtifact: ArtifactSummary | null;
  activeArtifactPayload: ArtifactPayload | null;
  artifactRefreshKey: number;
  artifactPanelWidth: number | null;
  artifactPanelListWidth: number | null;
  artifactPanelPreviewWidth: number | null;
  artifactResizing: boolean;
  modal: ModalState | null;
  backendModalsBySessionId: Record<string, Extract<ModalState, { kind: "backend" }>>;
  messages: ChatMessage[];
  workflowAnchorMessageId: string | null;
  workflowEventsByMessageId: Record<string, WorkflowEvent[]>;
  workflowDurationSecondsByMessageId: Record<string, number>;
  workflowInputBuffers: Record<string, string>;
  todoMarkdown: string;
  todoCollapsed: boolean;
  swarmTeammates: SwarmTeammateSnapshot[];
  swarmNotifications: SwarmNotificationSnapshot[];
  swarmPopupOpen: boolean;
  workflowEvents: WorkflowEvent[];
  workflowDurationSeconds: number | null;
  workflowStartedAtMs: number | null;
  composer: ComposerState;
  runtimePicker: RuntimePickerState;
};

export type AppSettings = {
  streamScrollDurationMs: number;
  streamStartBufferMs: number;
  streamFollowLeadPx: number;
  streamRevealDurationMs: number;
  streamRevealWipePercent: number;
  downloadMode: "browser" | "ask" | "folder";
  downloadFolderPath: string;
  shell: "auto" | "powershell" | "git-bash" | "cmd";
};

export type RuntimePickerOption = {
  value: string;
  label: string;
  description?: string;
  active?: boolean;
};

export type RuntimePickerState = {
  open: boolean;
  loading: boolean;
  error: string;
  providers: RuntimePickerOption[];
  modelsByProvider: Record<string, RuntimePickerOption[]>;
  models: RuntimePickerOption[];
  efforts: RuntimePickerOption[];
  selectedProvider: string;
  modelOpen: boolean;
  effortOpen: boolean;
};

export type ArtifactPayload = {
  path?: string;
  name?: string;
  kind?: string;
  mime?: string;
  size?: number;
  content?: string;
  dataUrl?: string;
  assetBaseUrl?: string;
};

export type ModalState =
  | { kind: "settings" }
  | { kind: "modelSettings" }
  | { kind: "workspace" }
  | { kind: "imagePreview"; src: string; name?: string; alt?: string }
  | { kind: "error"; message: string }
  | { kind: "backend"; payload?: Record<string, unknown> };
