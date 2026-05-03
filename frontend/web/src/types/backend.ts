export type WorkspaceScope = {
  mode: "shared" | "ip" | string;
  name: string;
  root: string;
};

export type Workspace = {
  name: string;
  path: string;
  scope?: WorkspaceScope;
};

export type Attachment = {
  media_type: string;
  data: string;
  name: string;
};

export type BackendStateSnapshot = {
  provider?: string;
  provider_label?: string;
  model?: string;
  effort?: string;
  permission_mode?: string;
  cwd?: string;
  workspace?: Workspace;
};

export type TranscriptItem = {
  role: "system" | "user" | "assistant" | "tool" | "tool_result" | "log";
  text: string;
  kind?: "steering" | "queued" | null;
  tool_name?: string | null;
  tool_input?: Record<string, unknown> | null;
  is_error?: boolean | null;
};

export type BackendEvent =
  | { type: "ready"; state?: BackendStateSnapshot; commands?: unknown[]; skills?: unknown[]; tasks?: unknown[] }
  | { type: "state_snapshot"; state?: BackendStateSnapshot }
  | { type: "skills_snapshot"; skills?: unknown[] }
  | { type: "transcript_item"; item?: TranscriptItem }
  | { type: "assistant_delta"; message?: string | null; value?: string | null }
  | { type: "assistant_complete"; message?: string | null; has_tool_uses?: boolean | null }
  | { type: "session_title"; message?: string | null; value?: string | null }
  | { type: "tool_started"; tool_name?: string; tool_call_id?: string | null; tool_call_index?: number | null; tool_input?: Record<string, unknown> | null }
  | { type: "tool_input_delta"; tool_name?: string; tool_call_index?: number; arguments_delta?: string }
  | { type: "tool_progress"; tool_name?: string; tool_call_id?: string | null; tool_call_index?: number | null; message?: string; tool_input?: Record<string, unknown> | null }
  | { type: "tool_completed"; tool_name?: string; tool_call_id?: string | null; tool_call_index?: number | null; output?: string; is_error?: boolean | null }
  | { type: "line_complete"; quiet?: boolean; compact_metadata?: Record<string, unknown> | null }
  | { type: "modal_request"; modal?: Record<string, unknown> | null }
  | { type: "select_request"; modal?: Record<string, unknown> | null; select_options?: Array<Record<string, unknown>> | null; message?: string | null }
  | { type: "todo_update"; todo_markdown?: string | null }
  | { type: "plan_mode_change"; plan_mode?: string | null }
  | { type: "active_session"; value?: string | null }
  | { type: "history_snapshot"; value?: string | null; message?: string | null; history_events?: Array<Record<string, unknown>> | null; compact_metadata?: Record<string, unknown> | null }
  | { type: "status"; message?: string | null; value?: string | null }
  | { type: "error"; message?: string | null }
  | { type: "shutdown"; message?: string | null }
  | { type: string; [key: string]: unknown };

export type SessionResponse = {
  sessionId: string;
  clientId?: string;
  frontendId?: string;
  workspace?: Workspace;
};

export type LiveSessionItem = {
  sessionId: string;
  savedSessionId: string;
  title?: string;
  workspace?: Workspace;
  busy: boolean;
  createdAt: number;
};

export type LiveSessionsResponse = {
  sessions: LiveSessionItem[];
};

export type HistoryItem = {
  value: string;
  label: string;
  description?: string;
  workspace?: Workspace | null;
  live?: boolean;
  liveSessionId?: string;
  busy?: boolean;
};

export type ArtifactSummary = {
  path: string;
  name: string;
  kind: string;
  category?: string;
  label?: string;
  mime?: string;
  size?: number;
  mtimeMs?: number;
  birthtimeMs?: number;
};

export type CommandItem = {
  name: string;
  description: string;
};

export type SkillItem = {
  name: string;
  description: string;
  source?: string;
  enabled?: boolean;
};
