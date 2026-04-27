"""Structured protocol models for the React TUI backend."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field

from openharness.state.app_state import AppState
from openharness.bridge.manager import BridgeSessionRecord
from openharness.mcp.types import McpConnectionStatus
from openharness.tasks.types import TaskRecord


class FrontendAttachment(BaseModel):
    """Inline file attachment sent by the web frontend."""

    media_type: str = Field(validation_alias=AliasChoices("media_type", "mediaType"))
    data: str
    name: str = ""


class FrontendRequest(BaseModel):
    """One request sent from the React frontend to the Python backend."""

    type: Literal[
        "submit_line",
        "permission_response",
        "question_response",
        "list_sessions",
        "delete_session",
        "refresh_skills",
        "set_skill_enabled",
        "set_mcp_enabled",
        "set_plugin_enabled",
        "set_system_prompt",
        "select_command",
        "apply_select_command",
        "cancel_current",
        "shutdown",
    ]
    line: str | None = None
    command: str | None = None
    value: str | None = None
    enabled: bool | None = None
    request_id: str | None = None
    allowed: bool | None = None
    answer: str | None = None
    attachments: list[FrontendAttachment] = Field(default_factory=list)


class TranscriptItem(BaseModel):
    """One transcript row rendered by the frontend."""

    role: Literal["system", "user", "assistant", "tool", "tool_result", "log"]
    text: str
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    is_error: bool | None = None


class TaskSnapshot(BaseModel):
    """UI-safe task representation."""

    id: str
    type: str
    status: str
    description: str
    metadata: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def from_record(cls, record: TaskRecord) -> "TaskSnapshot":
        return cls(
            id=record.id,
            type=record.type,
            status=record.status,
            description=record.description,
            metadata=dict(record.metadata),
        )


class SkillSnapshot(BaseModel):
    """UI-safe skill representation."""

    name: str
    description: str
    source: str
    enabled: bool = True


class PluginSnapshot(BaseModel):
    """UI-safe plugin representation."""

    name: str
    description: str = ""
    enabled: bool = True
    skill_count: int = 0
    command_count: int = 0
    mcp_server_count: int = 0


class BackendEvent(BaseModel):
    """One event sent from the Python backend to the React frontend."""

    type: Literal[
        "ready",
        "state_snapshot",
        "tasks_snapshot",
        "skills_snapshot",
        "transcript_item",
        "compact_progress",
        "assistant_delta",
        "tool_input_delta",
        "assistant_complete",
        "line_complete",
        "tool_started",
        "tool_progress",
        "tool_completed",
        "clear_transcript",
        "modal_request",
        "select_request",
        "todo_update",
        "plan_mode_change",
        "swarm_status",
        "status",
        "session_title",
        "active_session",
        "history_snapshot",
        "error",
        "shutdown",
    ]
    select_options: list[dict[str, Any]] | None = None
    message: str | None = None
    value: str | None = None
    item: TranscriptItem | None = None
    state: dict[str, Any] | None = None
    tasks: list[TaskSnapshot] | None = None
    mcp_servers: list[dict[str, Any]] | None = None
    plugins: list[PluginSnapshot] | None = None
    bridge_sessions: list[dict[str, Any]] | None = None
    commands: list[str | dict[str, Any]] | None = None
    skills: list[SkillSnapshot] | None = None
    history_events: list[dict[str, Any]] | None = None
    modal: dict[str, Any] | None = None
    tool_name: str | None = None
    tool_call_index: int | None = None
    has_tool_uses: bool | None = None
    arguments_delta: str | None = None
    tool_input: dict[str, Any] | None = None
    output: str | None = None
    is_error: bool | None = None
    compact_phase: str | None = None
    compact_trigger: str | None = None
    attempt: int | None = None
    compact_checkpoint: str | None = None
    compact_metadata: dict[str, Any] | None = None
    quiet: bool = False
    # New fields for enhanced events
    todo_markdown: str | None = None
    plan_mode: str | None = None
    swarm_teammates: list[dict[str, Any]] | None = None
    swarm_notifications: list[dict[str, Any]] | None = None

    @classmethod
    def ready(
        cls,
        state: AppState,
        tasks: list[TaskRecord],
        commands: list[str | dict[str, Any]],
        skills: list[SkillSnapshot] | None = None,
    ) -> "BackendEvent":
        return cls(
            type="ready",
            state=_state_payload(state),
            tasks=[TaskSnapshot.from_record(task) for task in tasks],
            mcp_servers=[],
            bridge_sessions=[],
            commands=commands,
            skills=skills or [],
        )

    @classmethod
    def state_snapshot(cls, state: AppState) -> "BackendEvent":
        return cls(type="state_snapshot", state=_state_payload(state))

    @classmethod
    def tasks_snapshot(cls, tasks: list[TaskRecord]) -> "BackendEvent":
        return cls(
            type="tasks_snapshot",
            tasks=[TaskSnapshot.from_record(task) for task in tasks],
        )

    @classmethod
    def skills_snapshot(cls, skills: list[SkillSnapshot]) -> "BackendEvent":
        return cls(type="skills_snapshot", skills=skills)

    @classmethod
    def status_snapshot(
        cls,
        *,
        state: AppState,
        mcp_servers: list[McpConnectionStatus],
        plugins: list[PluginSnapshot] | None = None,
        bridge_sessions: list[BridgeSessionRecord],
    ) -> "BackendEvent":
        return cls(
            type="state_snapshot",
            state=_state_payload(state),
            plugins=plugins or [],
            mcp_servers=[
                {
                    "name": server.name,
                    "state": server.state,
                    "detail": server.detail,
                    "transport": server.transport,
                    "auth_configured": server.auth_configured,
                    "tool_count": len(server.tools),
                    "resource_count": len(server.resources),
                }
                for server in mcp_servers
            ],
            bridge_sessions=[
                {
                    "session_id": session.session_id,
                    "command": session.command,
                    "cwd": session.cwd,
                    "pid": session.pid,
                    "status": session.status,
                    "started_at": session.started_at,
                    "output_path": session.output_path,
                }
                for session in bridge_sessions
            ],
        )


def _state_payload(state: AppState) -> dict[str, Any]:
    return {
        "model": state.model,
        "cwd": state.cwd,
        "provider": state.provider,
        "auth_status": state.auth_status,
        "base_url": state.base_url,
        "permission_mode": _format_permission_mode(state.permission_mode),
        "theme": state.theme,
        "vim_enabled": state.vim_enabled,
        "voice_enabled": state.voice_enabled,
        "voice_available": state.voice_available,
        "voice_reason": state.voice_reason,
        "fast_mode": state.fast_mode,
        "effort": state.effort,
        "passes": state.passes,
        "mcp_connected": state.mcp_connected,
        "mcp_failed": state.mcp_failed,
        "bridge_sessions": state.bridge_sessions,
        "output_style": state.output_style,
        "keybindings": dict(state.keybindings),
    }


_MODE_LABELS = {
    "default": "Default",
    "plan": "Plan Mode",
    "full_auto": "Auto",
    "PermissionMode.DEFAULT": "Default",
    "PermissionMode.PLAN": "Plan Mode",
    "PermissionMode.FULL_AUTO": "Auto",
}


def _format_permission_mode(raw: str) -> str:
    """Convert raw permission mode to human-readable label."""
    return _MODE_LABELS.get(raw, raw)


__all__ = [
    "BackendEvent",
    "FrontendRequest",
    "PluginSnapshot",
    "SkillSnapshot",
    "TaskSnapshot",
    "TranscriptItem",
]
