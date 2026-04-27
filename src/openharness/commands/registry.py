"""Slash command registry."""

from __future__ import annotations

import importlib.metadata
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Awaitable, Callable, Literal, get_args, Iterable

import pyperclip

from openharness.autopilot import RepoAutopilotStore
from openharness.auth.manager import AuthManager
from openharness.config.paths import (
    get_config_dir,
    get_data_dir,
    get_feedback_log_path,
    get_project_config_dir,
    get_project_issue_file,
    get_project_pr_comments_file,
)
from openharness.bridge import get_bridge_manager
from openharness.bridge.types import WorkSecret
from openharness.bridge.work_secret import build_sdk_url, decode_work_secret, encode_work_secret
from openharness.api.provider import auth_status, detect_provider
from openharness.config.settings import Settings, display_model_setting, load_settings, save_settings
from openharness.engine.messages import ConversationMessage, sanitize_conversation_messages
from openharness.engine.query_engine import QueryEngine
from openharness.learning import get_default_learning_skills_dir
from openharness.memory import (
    add_memory_entry,
    get_memory_entrypoint,
    get_project_memory_dir,
    list_memory_files,
    remove_memory_entry,
)
from openharness.mcp.config import load_mcp_server_configs
from openharness.output_styles import load_output_styles
from openharness.permissions import PermissionChecker, PermissionMode
from openharness.plugins import load_plugins
from openharness.prompts import build_runtime_system_prompt
from openharness.plugins.installer import install_plugin_from_path, uninstall_plugin
from openharness.services import (
    build_post_compact_messages,
    compact_conversation,
    compact_messages,
    estimate_conversation_tokens,
    summarize_messages,
)
from openharness.services.session_backend import DEFAULT_SESSION_BACKEND, SessionBackend
from openharness.skills import load_skill_registry
from openharness.skills.state import set_skill_enabled, toggle_skill_enabled
from openharness.tasks import get_task_manager
from openharness.plugins.types import PluginCommandDefinition

if TYPE_CHECKING:
    from openharness.state import AppStateStore
    from openharness.tools.base import ToolRegistry


_BUILT_IN_SKILL_SOURCES = {"bundled"}


def _custom_skills(skills):
    return [skill for skill in skills if skill.source not in _BUILT_IN_SKILL_SOURCES]


def _format_skills_management_text(skills) -> str:
    if not skills:
        return "사용 가능한 스킬:\n(사용자 스킬이 없습니다)"
    lines = ["사용 가능한 스킬:"]
    for skill in skills:
        status = "활성" if skill.enabled else "비활성"
        source = f" [{skill.source}]"
        lines.append(f"- {skill.name}{source} [{status}]: {skill.description}")
    return "\n".join(lines)


def _format_mcp_management_text(settings, plugins, cwd: str | Path) -> str:
    servers = load_mcp_server_configs(settings, plugins, cwd=cwd, include_disabled=True)
    if not servers:
        return "MCP 서버:\n(설정된 MCP 서버가 없습니다)"
    disabled = set(settings.disabled_mcp_servers or set())
    lines = ["MCP 서버:"]
    for name, config in sorted(servers.items()):
        status = "비활성" if name in disabled else "활성"
        transport = getattr(config, "type", "알 수 없음")
        lines.append(f"- {name} [{status}] ({transport})")
    return "\n".join(lines)


def _format_plugins_management_text(plugins) -> str:
    if not plugins:
        return "플러그인:\n(발견된 플러그인이 없습니다)"
    lines = ["플러그인:"]
    for plugin in sorted(plugins, key=lambda item: item.manifest.name):
        status = "활성" if plugin.enabled else "비활성"
        description = f": {plugin.manifest.description}" if plugin.manifest.description else ""
        lines.append(f"- {plugin.manifest.name} [{status}]{description}")
    return "\n".join(lines)


def _format_capability_management_text(settings, plugins, skills, cwd: str | Path) -> str:
    return "\n\n".join(
        [
            _format_skills_management_text(skills),
            _format_mcp_management_text(settings, plugins, cwd),
            _format_plugins_management_text(plugins),
            "전환 사용법: /skills toggle NAME, /mcp toggle NAME, /plugin toggle NAME",
        ]
    )


@dataclass
class CommandResult:
    """Result returned by a slash command."""

    message: str | None = None
    should_exit: bool = False
    clear_screen: bool = False
    replay_messages: list | None = None  # ConversationMessage list to replay in TUI
    continue_pending: bool = False
    continue_turns: int | None = None
    refresh_runtime: bool = False
    submit_prompt: str | None = None
    submit_model: str | None = None


@dataclass
class CommandContext:
    """Context available to command handlers."""

    engine: QueryEngine
    hooks_summary: str = ""
    mcp_summary: str = ""
    plugin_summary: str = ""
    cwd: str = "."
    tool_registry: ToolRegistry | None = None
    app_state: AppStateStore | None = None
    session_backend: SessionBackend = DEFAULT_SESSION_BACKEND
    session_id: str | None = None
    extra_skill_dirs: Iterable[str | Path] | None = None
    extra_plugin_roots: Iterable[str | Path] | None = None


CommandHandler = Callable[[str, CommandContext], Awaitable[CommandResult]]


def _parse_pgpt_login_args(args: str) -> dict[str, str]:
    raw = args.strip()
    tokens = raw.split()
    return {
        "api_key": tokens[0] if len(tokens) >= 1 else "",
        "employee_no": tokens[1] if len(tokens) >= 2 else "",
        "company_code": tokens[2] if len(tokens) >= 3 else "30",
    }


@dataclass
class SlashCommand:
    """Definition of a slash command."""

    name: str
    description: str
    handler: CommandHandler
    remote_invocable: bool = True
    remote_admin_opt_in: bool = False
    aliases: tuple[str, ...] = ()


class CommandRegistry:
    """Map slash commands to handlers."""

    def __init__(self) -> None:
        # Primary commands keyed by canonical name, plus aliases pointing at
        # the same SlashCommand instance. We keep a separate set of canonical
        # names so help/listing output doesn't duplicate aliased entries.
        self._commands: dict[str, SlashCommand] = {}
        self._canonical_names: list[str] = []

    def register(self, command: SlashCommand) -> None:
        """Register a command, plus any aliases pointing at the same handler."""
        if command.name not in self._commands:
            self._canonical_names.append(command.name)
        self._commands[command.name] = command
        for alias in command.aliases:
            self._commands[alias] = command

    def lookup(self, raw_input: str) -> tuple[SlashCommand, str] | None:
        """Parse a slash command and return its handler plus raw args."""
        if not raw_input.startswith("/"):
            return None
        name, _, args = raw_input[1:].partition(" ")
        command = self._commands.get(name)
        if command is None:
            return None
        return command, args.strip()

    def help_text(self) -> str:
        """Return a formatted summary of all registered commands."""
        lines = [
            "입력 단축키:",
            "- !: 로컬 CLI 명령어를 바로 실행합니다.",
            "- @: 현재 프로젝트의 파일을 선택해 프롬프트에 첨부하거나 참조합니다.",
            "- $: 사용할 스킬, MCP, 플러그인을 선택해 프롬프트에 넣습니다.",
            "- /: 슬래시 명령어를 선택하거나 실행합니다.",
            "- Ctrl+Shift+O: 새 채팅을 엽니다.",
            "- Shift+Tab: 계획모드를 켜거나 끕니다.",
            "",
            "자주 쓰는 기능:",
            "- 채팅 입력란에 이미지를 복사한 뒤 붙여넣으면 이미지가 첨부됩니다.",
            "- 5줄 이상 긴 글을 붙여넣거나 입력하면 하나의 그룹으로 묶어 표시하고, 원문은 그대로 전송됩니다.",
            "",
            "사용 가능한 명령어:",
        ]
        commands = [self._commands[name] for name in self._canonical_names]
        for command in sorted(commands, key=lambda item: item.name):
            lines.append(f"/{command.name:<12} {command.description}")
        return "\n".join(lines)

    def list_commands(self) -> list[SlashCommand]:
        """Return canonical commands in registration order (aliases omitted)."""
        return [self._commands[name] for name in self._canonical_names]


def _run_git_command(cwd: str, *args: str) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return False, "git is not installed."
    output = (completed.stdout or completed.stderr).strip()
    if completed.returncode != 0:
        return False, output or f"git {' '.join(args)} failed"
    return True, output


def _copy_to_clipboard(text: str) -> tuple[bool, str]:
    try:
        pyperclip.copy(text)
        return True, "clipboard"
    except Exception:
        for command in (["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard"]):
            try:
                subprocess.run(command, input=text, text=True, check=True, capture_output=True)
                return True, "clipboard"
            except Exception:
                continue
    fallback = get_data_dir() / "last_copy.txt"
    fallback.write_text(text, encoding="utf-8")
    return False, str(fallback)


def _last_message_text(messages: list[ConversationMessage]) -> str:
    for message in reversed(messages):
        if message.text.strip():
            return message.text.strip()
    return ""


def _shorten_text(text: str, *, limit: int = 160) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def _rewind_turns(messages: list[ConversationMessage], turns: int) -> list[ConversationMessage]:
    updated = list(messages)
    for _ in range(max(0, turns)):
        if not updated:
            break
        while updated:
            popped = updated.pop()
            if popped.role == "user" and popped.text.strip():
                break
    return updated


def _coerce_setting_value(settings: Settings, key: str, raw: str):
    field = Settings.model_fields.get(key)
    if field is None:
        raise KeyError(key)
    annotation = field.annotation
    if annotation is bool:
        lowered = raw.lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
        raise ValueError(f"Invalid boolean value for {key}: {raw}")
    if annotation is int:
        return int(raw)
    if annotation is str:
        return raw
    if annotation is Literal or getattr(annotation, "__origin__", None) is Literal:
        allowed = get_args(annotation)
        if raw not in allowed:
            raise ValueError(f"Invalid value for {key}: {raw}")
        return raw
    return raw


def _render_plugin_command_prompt(command: PluginCommandDefinition, args: str, session_id: str | None = None) -> str:
    prompt = command.content
    raw_args = args.strip()
    if command.is_skill and command.base_dir:
        prompt = f"Base directory for this skill: {command.base_dir}\n\n{prompt}"
    prompt = prompt.replace("${ARGUMENTS}", raw_args).replace("$ARGUMENTS", raw_args)
    if session_id:
        prompt = prompt.replace("${CLAUDE_SESSION_ID}", session_id)
    if raw_args and "${ARGUMENTS}" not in command.content and "$ARGUMENTS" not in command.content:
        prompt = f"{prompt}\n\nArguments: {raw_args}"
    return prompt


def create_default_command_registry(
    plugin_commands: Iterable[PluginCommandDefinition] | None = None,
) -> CommandRegistry:
    """Create the built-in command registry."""
    registry = CommandRegistry()

    def _effort_label(value: object) -> str:
        normalized = str(value or "").strip()
        return "Auto" if normalized.lower() in {"", "none", "auto"} else normalized

    async def _help_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        plugins = load_plugins(settings, context.cwd, extra_roots=context.extra_plugin_roots)
        skill_registry = load_skill_registry(
            context.cwd,
            extra_skill_dirs=context.extra_skill_dirs,
            extra_plugin_roots=context.extra_plugin_roots,
            settings=settings,
            include_disabled=True,
        )
        skills = _custom_skills(skill_registry.list_skills())
        return CommandResult(
            message=f"{registry.help_text()}\n\n{_format_capability_management_text(settings, plugins, skills, context.cwd)}"
        )

    async def _exit_handler(_: str, context: CommandContext) -> CommandResult:
        del context
        return CommandResult(should_exit=True)

    async def _clear_handler(_: str, context: CommandContext) -> CommandResult:
        context.engine.clear()
        return CommandResult(message="Conversation cleared.", clear_screen=True)

    async def _status_handler(_: str, context: CommandContext) -> CommandResult:
        usage = context.engine.total_usage
        state = context.app_state.get() if context.app_state is not None else None
        manager = AuthManager()
        return CommandResult(
            message=(
                f"Messages: {len(context.engine.messages)}\n"
                f"Usage: input={usage.input_tokens} output={usage.output_tokens}\n"
                f"Profile: {manager.get_active_profile()}\n"
                f"Effort: {_effort_label(state.effort if state is not None else load_settings().effort)}\n"
                f"Passes: {state.passes if state is not None else load_settings().passes}"
            )
        )

    async def _version_handler(_: str, context: CommandContext) -> CommandResult:
        del context
        try:
            version = importlib.metadata.version("openharness")
        except importlib.metadata.PackageNotFoundError:
            version = "0.1.7"
        return CommandResult(message=f"OpenHarness {version}")

    async def _context_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        prompt = build_runtime_system_prompt(settings, cwd=context.cwd)
        return CommandResult(message=prompt)

    async def _summary_handler(args: str, context: CommandContext) -> CommandResult:
        max_messages = 8
        if args:
            try:
                max_messages = max(1, int(args))
            except ValueError:
                return CommandResult(message="Usage: /summary [MAX_MESSAGES]")
        summary = summarize_messages(context.engine.messages, max_messages=max_messages)
        return CommandResult(message=summary or "No conversation content to summarize.")

    async def _compact_handler(args: str, context: CommandContext) -> CommandResult:
        preserve_recent = 6
        if args:
            try:
                preserve_recent = max(1, int(args))
            except ValueError:
                return CommandResult(message="Usage: /compact [PRESERVE_RECENT]")
        before = len(context.engine.messages)
        try:
            compacted_result = await compact_conversation(
                context.engine.messages,
                api_client=context.engine.api_client,
                model=context.engine.model,
                system_prompt=context.engine.system_prompt,
                preserve_recent=preserve_recent,
                trigger="manual",
            )
            compacted = build_post_compact_messages(compacted_result)
        except Exception:
            compacted = compact_messages(context.engine.messages, preserve_recent=preserve_recent)
        context.engine.load_messages(compacted)
        return CommandResult(
            message=f"Compacted conversation from {before} messages to {len(compacted)}."
        )

    async def _usage_handler(_: str, context: CommandContext) -> CommandResult:
        usage = context.engine.total_usage
        estimated = estimate_conversation_tokens(context.engine.messages)
        return CommandResult(
            message=(
                f"Actual usage: input={usage.input_tokens} output={usage.output_tokens}\n"
                f"Estimated conversation tokens: {estimated}\n"
                f"Messages: {len(context.engine.messages)}"
            )
        )

    async def _cost_handler(_: str, context: CommandContext) -> CommandResult:
        usage = context.engine.total_usage
        model = context.app_state.get().model if context.app_state is not None else load_settings().model
        estimated_cost = "unavailable"
        if model.startswith("claude-3-5-sonnet"):
            estimated = (usage.input_tokens * 3.0 + usage.output_tokens * 15.0) / 1_000_000
            estimated_cost = f"${estimated:.4f} (estimated)"
        elif model.startswith("claude-3-7-sonnet"):
            estimated = (usage.input_tokens * 3.0 + usage.output_tokens * 15.0) / 1_000_000
            estimated_cost = f"${estimated:.4f} (estimated)"
        elif model.startswith("claude-3-opus"):
            estimated = (usage.input_tokens * 15.0 + usage.output_tokens * 75.0) / 1_000_000
            estimated_cost = f"${estimated:.4f} (estimated)"
        return CommandResult(
            message=(
                f"Model: {model}\n"
                f"Input tokens: {usage.input_tokens}\n"
                f"Output tokens: {usage.output_tokens}\n"
                f"Total tokens: {usage.total_tokens}\n"
                f"Estimated cost: {estimated_cost}"
            )
        )

    async def _stats_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        memory_count = len(list_memory_files(context.cwd))
        task_count = len(get_task_manager().list_tasks())
        tool_count = len(context.tool_registry.list_tools()) if context.tool_registry is not None else 0
        style = settings.output_style
        if context.app_state is not None:
            state = context.app_state.get()
            style = state.output_style
        return CommandResult(
            message=(
                "Session stats:\n"
                f"- messages: {len(context.engine.messages)}\n"
                f"- estimated_tokens: {estimate_conversation_tokens(context.engine.messages)}\n"
                f"- tools: {tool_count}\n"
                f"- memory_files: {memory_count}\n"
                f"- background_tasks: {task_count}\n"
                f"- output_style: {style}"
            )
        )

    async def _memory_handler(args: str, context: CommandContext) -> CommandResult:
        tokens = args.split(maxsplit=1)
        if not tokens:
            memory_dir = get_project_memory_dir(context.cwd)
            entrypoint = get_memory_entrypoint(context.cwd)
            return CommandResult(
                message=f"Memory directory: {memory_dir}\nEntrypoint: {entrypoint}"
            )
        action = tokens[0]
        rest = tokens[1] if len(tokens) == 2 else ""
        if action == "list":
            memory_files = list_memory_files(context.cwd)
            if not memory_files:
                return CommandResult(message="No memory files.")
            return CommandResult(message="\n".join(path.name for path in memory_files))
        if action == "show" and rest:
            memory_dir = get_project_memory_dir(context.cwd)
            path, invalid = _resolve_memory_entry_path(memory_dir, rest)
            if invalid:
                return CommandResult(message="Memory entry path must stay within the project memory directory.")
            if path is None:
                return CommandResult(message=f"Memory entry not found: {rest}")
            if not path.exists():
                return CommandResult(message=f"Memory entry not found: {rest}")
            return CommandResult(message=path.read_text(encoding="utf-8"))
        if action == "add" and rest:
            title, separator, content = rest.partition("::")
            if not separator or not title.strip() or not content.strip():
                return CommandResult(message="Usage: /memory add TITLE :: CONTENT")
            path = add_memory_entry(context.cwd, title.strip(), content.strip())
            return CommandResult(message=f"Added memory entry {path.name}")
        if action == "remove" and rest:
            if remove_memory_entry(context.cwd, rest.strip()):
                return CommandResult(message=f"Removed memory entry {rest.strip()}")
            return CommandResult(message=f"Memory entry not found: {rest.strip()}")
        return CommandResult(message="Usage: /memory [list|show NAME|add TITLE :: CONTENT|remove NAME]")

    async def _hooks_handler(_: str, context: CommandContext) -> CommandResult:
        return CommandResult(message=context.hooks_summary or "No hooks configured.")

    async def _resume_handler(args: str, context: CommandContext) -> CommandResult:
        tokens = args.strip().split()

        # /resume <session_id> — load a specific session
        if tokens:
            sid = tokens[0]
            snapshot = context.session_backend.load_by_id(context.cwd, sid)
            if snapshot is None:
                return CommandResult(message=f"Session not found: {sid}")
            messages = sanitize_conversation_messages(
                [ConversationMessage.model_validate(item) for item in snapshot.get("messages", [])]
            )
            context.engine.load_messages(messages)
            summary = snapshot.get("summary", "")[:60]
            return CommandResult(
                message=f"Restored {len(messages)} messages from session {sid}"
                + (f" ({summary})" if summary else ""),
                replay_messages=messages,
            )

        # /resume — list sessions (for the TUI to show a picker)
        sessions = context.session_backend.list_snapshots(context.cwd, limit=10)
        if not sessions:
            # Fall back to latest.json
            snapshot = context.session_backend.load_latest(context.cwd)
            if snapshot is None:
                return CommandResult(message="No saved sessions found for this project.")
            messages = sanitize_conversation_messages(
                [ConversationMessage.model_validate(item) for item in snapshot.get("messages", [])]
            )
            context.engine.load_messages(messages)
            return CommandResult(
                message=f"Restored {len(messages)} messages from the latest session.",
                replay_messages=messages,
            )

        # Format session list for display / picker
        import time
        lines = ["Saved sessions:"]
        for s in sessions:
            ts = time.strftime("%m/%d %H:%M", time.localtime(s["created_at"]))
            summary = s["summary"][:50] or "(no summary)"
            lines.append(f"  {s['session_id']}  {ts}  {s['message_count']}msg  {summary}")
        lines.append("")
        lines.append("Use /resume <session_id> to restore a specific session.")
        return CommandResult(message="\n".join(lines))

    async def _export_handler(_: str, context: CommandContext) -> CommandResult:
        path = context.session_backend.export_markdown(cwd=context.cwd, messages=context.engine.messages)
        return CommandResult(message=f"Exported transcript to {path}")

    async def _share_handler(_: str, context: CommandContext) -> CommandResult:
        path = context.session_backend.export_markdown(cwd=context.cwd, messages=context.engine.messages)
        return CommandResult(message=f"Created shareable transcript snapshot at {path}")

    async def _copy_handler(args: str, context: CommandContext) -> CommandResult:
        text = args.strip() or _last_message_text(context.engine.messages)
        if not text:
            return CommandResult(message="Nothing to copy.")
        copied, target = _copy_to_clipboard(text)
        if copied:
            return CommandResult(message=f"Copied {len(text)} characters to the clipboard.")
        return CommandResult(message=f"Clipboard unavailable. Saved copied text to {target}")

    async def _session_handler(args: str, context: CommandContext) -> CommandResult:
        session_dir = context.session_backend.get_session_dir(context.cwd)
        tokens = args.split()
        if not tokens or tokens[0] == "show":
            latest = session_dir / "latest.json"
            transcript = session_dir / "transcript.md"
            lines = [
                f"Session directory: {session_dir}",
                f"Latest snapshot: {'present' if latest.exists() else 'missing'}",
                f"Transcript export: {'present' if transcript.exists() else 'missing'}",
                f"Message count: {len(context.engine.messages)}",
            ]
            return CommandResult(message="\n".join(lines))
        if tokens[0] == "ls":
            files = sorted(path.name for path in session_dir.iterdir())
            return CommandResult(message="\n".join(files) if files else "(empty)")
        if tokens[0] == "path":
            return CommandResult(message=str(session_dir))
        if tokens[0] == "tag" and len(tokens) == 2:
            safe_name = "".join(character for character in tokens[1] if character.isalnum() or character in {"-", "_"})
            if not safe_name:
                return CommandResult(message="Usage: /session tag NAME")
            snapshot_path = context.session_backend.save_snapshot(
                cwd=context.cwd,
                model=context.app_state.get().model if context.app_state is not None else load_settings().model,
                system_prompt=build_runtime_system_prompt(load_settings(), cwd=context.cwd),
                messages=context.engine.messages,
                usage=context.engine.total_usage,
            )
            export_path = context.session_backend.export_markdown(cwd=context.cwd, messages=context.engine.messages)
            tagged_json = session_dir / f"{safe_name}.json"
            tagged_md = session_dir / f"{safe_name}.md"
            shutil.copy2(snapshot_path, tagged_json)
            shutil.copy2(export_path, tagged_md)
            return CommandResult(message=f"Tagged session as {safe_name}:\n- {tagged_json}\n- {tagged_md}")
        if tokens[0] == "clear":
            if session_dir.exists():
                shutil.rmtree(session_dir)
            session_dir.mkdir(parents=True, exist_ok=True)
            return CommandResult(message=f"Cleared session storage at {session_dir}")
        return CommandResult(message="Usage: /session [show|ls|path|tag NAME|clear]")

    async def _rewind_handler(args: str, context: CommandContext) -> CommandResult:
        turns = 1
        if args.strip():
            try:
                turns = max(1, int(args.strip()))
            except ValueError:
                return CommandResult(message="Usage: /rewind [TURNS]")
        before = len(context.engine.messages)
        updated = _rewind_turns(context.engine.messages, turns)
        context.engine.load_messages(updated)
        removed = before - len(updated)
        return CommandResult(message=f"Rewound {turns} turn(s); removed {removed} message(s).")

    async def _tag_handler(args: str, context: CommandContext) -> CommandResult:
        name = args.strip()
        if not name:
            return CommandResult(message="Usage: /tag NAME")
        return await _session_handler(f"tag {name}", context)

    async def _files_handler(args: str, context: CommandContext) -> CommandResult:
        raw = args.strip()
        root = Path(context.cwd)
        max_items = 30
        tokens = raw.split(maxsplit=1)
        if tokens and tokens[0] == "dirs":
            dirs = [
                path
                for path in sorted(root.rglob("*"))
                if path.is_dir() and ".git" not in path.parts and ".venv" not in path.parts
            ]
            lines = [path.relative_to(root).as_posix() for path in dirs[:max_items]]
            if len(dirs) > max_items:
                lines.append(f"... {len(dirs) - max_items} more")
            return CommandResult(message="\n".join(lines) if lines else "(no directories)")
        if tokens and tokens[0].isdigit():
            max_items = max(1, min(int(tokens[0]), 200))
            raw = tokens[1] if len(tokens) == 2 else ""
        needle = raw.lower()
        files = [
            path
            for path in sorted(root.rglob("*"))
            if path.is_file() and ".git" not in path.parts and ".venv" not in path.parts
        ]
        if needle:
            files = [path for path in files if needle in path.relative_to(root).as_posix().lower()]
        lines = [path.relative_to(root).as_posix() for path in files[:max_items]]
        if len(files) > max_items:
            lines.append(f"... {len(files) - max_items} more")
        return CommandResult(
            message="\n".join(lines) if lines else "(no matching files)"
        )

    async def _agents_handler(args: str, context: CommandContext) -> CommandResult:
        tokens = args.split(maxsplit=1)
        guide = (
            "서브에이전트 안내:\n"
            "- 백그라운드 작업이나 병렬 조사가 필요할 때 모델에게 에이전트 도구로 위임하라고 요청하세요.\n"
            '- 일반적인 작업자 형태는 subagent_type="worker"입니다.\n'
            "- /agents 는 알려진 작업자 태스크를 나열합니다.\n"
            "- /agents show TASK_ID 는 특정 작업자의 출력과 메타데이터를 보여줍니다.\n"
            "- send_message(task_id=..., message=...) 로 생성된 작업자에게 후속 메시지를 보낼 수 있습니다.\n"
            "- task_output(task_id=...) 로 작업자의 최신 출력을 읽을 수 있습니다."
        )
        if tokens and tokens[0] in {"help", "usage"}:
            return CommandResult(
                message=guide
            )
        if tokens and tokens[0] == "show" and len(tokens) == 2:
            task = get_task_manager().get_task(tokens[1])
            if task is None or task.type not in {"local_agent", "remote_agent", "in_process_teammate"}:
                return CommandResult(message=f"해당 ID의 에이전트를 찾을 수 없습니다: {tokens[1]}")
            output = get_task_manager().read_task_output(task.id)
            return CommandResult(
                message=(
                    f"{task.id} {task.type} {task.status} {task.description}\n"
                    f"메타데이터={task.metadata}\n"
                    f"출력:\n{output or '(출력 없음)'}"
                )
            )
        tasks = [
            task
            for task in get_task_manager().list_tasks()
            if task.type in {"local_agent", "remote_agent", "in_process_teammate"}
        ]
        if not tasks:
            return CommandResult(
                message=f"활성 또는 기록된 에이전트가 없습니다. 사용법은 /agents help 로 확인하세요.\n\n{guide}"
            )
        lines = [
            f"{task.id} {task.type} {task.status} {task.description}"
            for task in tasks
        ]
        return CommandResult(message="\n".join(lines))

    async def _init_handler(args: str, context: CommandContext) -> CommandResult:
        del args
        project_dir = get_project_config_dir(context.cwd)
        created: list[str] = []

        agents_md = Path(context.cwd) / "AGENTS.md"
        if not agents_md.exists():
            agents_md.write_text(
                "# Project Instructions\n\n"
                "- Use OpenHarness tools deliberately.\n"
                "- Keep changes minimal and verify with tests when possible.\n",
                encoding="utf-8",
            )
            created.append(str(agents_md.relative_to(Path(context.cwd))))

        for relative, content in (
            (
                project_dir / "README.md",
                "# Project OpenHarness Config\n\nThis directory stores project-specific OpenHarness state.\n",
            ),
            (
                project_dir / "memory" / "MEMORY.md",
                "# Project Memory\n\nAdd reusable project knowledge here.\n",
            ),
            (
                project_dir / "plugins" / ".gitkeep",
                "",
            ),
            (
                project_dir / "skills" / ".gitkeep",
                "",
            ),
        ):
            relative.parent.mkdir(parents=True, exist_ok=True)
            if not relative.exists():
                relative.write_text(content, encoding="utf-8")
                created.append(str(relative.relative_to(Path(context.cwd))))

        if not created:
            return CommandResult(message="Project already initialized for OpenHarness.")
        return CommandResult(message="Initialized project files:\n" + "\n".join(f"- {item}" for item in created))

    async def _bridge_handler(args: str, context: CommandContext) -> CommandResult:
        tokens = args.split()
        if not tokens or tokens[0] == "show":
            sessions = get_bridge_manager().list_sessions()
            lines = [
                "Bridge summary:",
                "- backend host: available",
                f"- cwd: {context.cwd}",
                f"- sessions: {len(sessions)}",
                "- utilities: encode, decode, sdk, spawn, list, output, stop",
            ]
            return CommandResult(message="\n".join(lines))
        if tokens[0] == "encode" and len(tokens) == 3:
            encoded = encode_work_secret(
                WorkSecret(version=1, session_ingress_token=tokens[2], api_base_url=tokens[1])
            )
            return CommandResult(message=encoded)
        if tokens[0] == "decode" and len(tokens) == 2:
            secret = decode_work_secret(tokens[1])
            return CommandResult(message=json.dumps(secret.__dict__, indent=2))
        if tokens[0] == "sdk" and len(tokens) == 3:
            return CommandResult(message=build_sdk_url(tokens[1], tokens[2]))
        if tokens[0] == "spawn" and len(tokens) >= 2:
            command = args[len("spawn ") :]
            handle = await get_bridge_manager().spawn(
                session_id=f"bridge-{datetime.now(timezone.utc).strftime('%H%M%S')}",
                command=command,
                cwd=context.cwd,
            )
            return CommandResult(
                message=f"Spawned bridge session {handle.session_id} pid={handle.process.pid}"
            )
        if tokens[0] == "list":
            sessions = get_bridge_manager().list_sessions()
            if not sessions:
                return CommandResult(message="No bridge sessions.")
            return CommandResult(
                message="\n".join(
                    f"{item.session_id} [{item.status}] pid={item.pid} {item.command}"
                    for item in sessions
                )
            )
        if tokens[0] == "output" and len(tokens) == 2:
            return CommandResult(message=get_bridge_manager().read_output(tokens[1]) or "(no output)")
        if tokens[0] == "stop" and len(tokens) == 2:
            try:
                await get_bridge_manager().stop(tokens[1])
            except ValueError as exc:
                return CommandResult(message=str(exc))
            return CommandResult(message=f"Stopped bridge session {tokens[1]}")
        return CommandResult(
            message="Usage: /bridge [show|encode API_BASE_URL TOKEN|decode SECRET|sdk API_BASE_URL SESSION_ID|spawn CMD|list|output SESSION_ID|stop SESSION_ID]"
        )

    async def _reload_plugins_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        plugins = load_plugins(settings, context.cwd, extra_roots=context.extra_plugin_roots)
        skill_registry = load_skill_registry(
            context.cwd,
            extra_skill_dirs=context.extra_skill_dirs,
            extra_plugin_roots=context.extra_plugin_roots,
            settings=settings,
            include_disabled=True,
        )
        skills = _custom_skills(skill_registry.list_skills())
        lines = [
            f"Reloaded plugin and skill registry: {len(plugins)} plugin(s), {len(skills)} custom skill(s)."
        ]
        lines.append("")
        lines.append(_format_capability_management_text(settings, plugins, skills, context.cwd))
        return CommandResult(message="\n".join(lines))

    async def _skills_handler(args: str, context: CommandContext) -> CommandResult:
        skill_registry = load_skill_registry(
            context.cwd,
            extra_skill_dirs=context.extra_skill_dirs,
            extra_plugin_roots=context.extra_plugin_roots,
            include_disabled=True,
        )
        tokens = args.split(maxsplit=1)
        action = tokens[0].lower() if tokens else "list"
        rest = tokens[1].strip() if len(tokens) > 1 else ""
        if action in {"on", "off", "enable", "disable", "toggle"} and rest:
            skill = skill_registry.get(rest)
            if skill is None:
                return CommandResult(message=f"Skill not found: {rest}")
            if action in {"on", "enable"}:
                enabled = set_skill_enabled(skill.name, True)
            elif action in {"off", "disable"}:
                enabled = set_skill_enabled(skill.name, False)
            else:
                enabled = toggle_skill_enabled(skill.name)
            refreshed = load_skill_registry(
                context.cwd,
                extra_skill_dirs=context.extra_skill_dirs,
                extra_plugin_roots=context.extra_plugin_roots,
                include_disabled=True,
            )
            skills = _custom_skills(refreshed.list_skills())
            return CommandResult(
                message=(
                    f"Skill '{skill.name}' {'enabled' if enabled else 'disabled'}.\n\n"
                    f"{_format_skills_management_text(skills)}"
                )
            )
        if args and action not in {"list", "show"}:
            skill = skill_registry.get(args)
            if skill is None:
                return CommandResult(
                    message="Usage: /skills [list|show NAME|enable NAME|disable NAME|toggle NAME]"
                )
            return CommandResult(message=skill.content)
        if action == "show" and rest:
            skill = skill_registry.get(rest)
            if skill is None:
                return CommandResult(message=f"Skill not found: {rest}")
            return CommandResult(message=skill.content)
        skills = _custom_skills(skill_registry.list_skills())
        return CommandResult(message=_format_skills_management_text(skills))

    async def _learned_skills_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        tokens = args.split()
        action = tokens[0].lower() if tokens else "show"
        if action in {"on", "off"}:
            enabled = action == "on"
            settings.learning.enabled = enabled
            save_settings(settings)
            return CommandResult(
                message=f"Automatic learned skills {'enabled' if enabled else 'disabled'}.",
                refresh_runtime=True,
            )
        if action not in {"show", "list"}:
            return CommandResult(message="Usage: /learned-skills [show|on|off]")

        root = get_default_learning_skills_dir()
        learned = context.engine.tool_metadata.get("recent_learned_skills")
        lines = [
            f"Automatic learned skills: {'enabled' if settings.learning.enabled else 'disabled'}",
            f"Program skills directory: {root}",
        ]
        if isinstance(learned, list) and learned:
            lines.append("")
            lines.append("Recent automatic updates:")
            for item in learned[-8:]:
                if not isinstance(item, dict):
                    continue
                skill = str(item.get("skill") or "").strip()
                action_text = str(item.get("action") or "learned").strip()
                summary = str(item.get("summary") or "").strip()
                path = str(item.get("path") or "").strip()
                lines.append(f"- {skill} [{action_text}]: {summary}")
                if path:
                    lines.append(f"  {path}")
        else:
            lines.append("")
            lines.append("No automatic skill updates in this session yet.")

        if root.exists():
            learned_dirs = sorted(
                path
                for path in root.iterdir()
                if path.is_dir() and path.name.startswith("learned-") and (path / "SKILL.md").exists()
            )
            if learned_dirs:
                lines.append("")
                lines.append("Program-local learned skills:")
                for path in learned_dirs[-12:]:
                    lines.append(f"- {path.name}: {path / 'SKILL.md'}")
        return CommandResult(message="\n".join(lines))

    async def _config_handler(args: str, context: CommandContext) -> CommandResult:
        del context
        settings = load_settings()
        tokens = args.split(maxsplit=2)
        if not tokens or tokens[0] == "show":
            return CommandResult(message=settings.model_dump_json(indent=2))
        if tokens[0] == "set" and len(tokens) == 3:
            key, value = tokens[1], tokens[2]
            if key not in Settings.model_fields:
                return CommandResult(message=f"Unknown config key: {key}")
            try:
                coerced = _coerce_setting_value(settings, key, value)
            except ValueError as exc:
                return CommandResult(message=str(exc))
            setattr(settings, key, coerced)
            save_settings(settings)
            return CommandResult(message=f"Updated {key}")
        return CommandResult(message="Usage: /config [show|set KEY VALUE]")

    async def _login_handler(args: str, context: CommandContext) -> CommandResult:
        del context
        settings = load_settings()
        manager = AuthManager(settings)
        profile_name, profile = settings.resolve_profile()
        provider = detect_provider(settings)
        api_key = args.strip()
        if not api_key:
            masked = (
                f"{settings.api_key[:6]}...{settings.api_key[-4:]}"
                if settings.api_key
                else "(not configured)"
            )
            return CommandResult(
                message=(
                    f"Auth status:\n"
                    f"- profile: {profile_name}\n"
                    f"- provider: {provider.name}\n"
                    f"- auth_source: {profile.auth_source}\n"
                    f"- auth_status: {auth_status(settings)}\n"
                    f"- base_url: {settings.base_url or '(default)'}\n"
                    f"- model: {settings.model}\n"
                    f"- api_key: {masked}\n"
                    f"Usage: {'/login API_KEY EMPLOYEE_NO [COMPANY_CODE]' if profile.auth_source == 'pgpt_api_key' else '/login API_KEY'}"
                )
            )
        if profile.auth_source == "pgpt_api_key":
            values = _parse_pgpt_login_args(api_key)
            if not values.get("api_key") or not values.get("employee_no"):
                return CommandResult(message="Usage: /login API_KEY EMPLOYEE_NO [COMPANY_CODE]")
            manager.store_profile_credential(profile_name, "api_key", values["api_key"])
            manager.store_profile_credential(profile_name, "employee_no", values["employee_no"])
            manager.store_profile_credential(profile_name, "company_code", values.get("company_code") or "30")
            return CommandResult(message="Stored P-GPT credentials in ~/.openharness/credentials.json")
        manager.store_profile_credential(profile_name, "api_key", api_key)
        return CommandResult(message="Stored API key in ~/.openharness/settings.json")

    async def _logout_handler(_: str, context: CommandContext) -> CommandResult:
        del context
        settings = load_settings()
        profile_name = settings.resolve_profile()[0]
        AuthManager(settings).clear_profile_credential(profile_name)
        return CommandResult(message="Cleared stored API key.")

    async def _feedback_handler(args: str, context: CommandContext) -> CommandResult:
        del context
        path = get_feedback_log_path()
        if not args.strip():
            return CommandResult(message=f"Feedback log: {path}\nUsage: /feedback TEXT")
        timestamp = datetime.now(timezone.utc).isoformat()
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{timestamp}] {args.strip()}\n")
        return CommandResult(message=f"Saved feedback to {path}")

    async def _onboarding_handler(_: str, context: CommandContext) -> CommandResult:
        del context
        return CommandResult(
            message=(
                "OpenHarness quickstart:\n"
                "1. Ask for a coding task in plain language.\n"
                "2. Use /help to inspect commands.\n"
                "3. Use /doctor to inspect runtime state.\n"
                "4. Use /tasks for background work and /memory for project memory.\n"
                "5. Use /login to store an API key if needed."
            )
        )

    async def _fast_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        current = (
            context.app_state.get().fast_mode
            if context.app_state is not None
            else settings.fast_mode
        )
        action = args.strip() or "show"
        if action == "show":
            return CommandResult(message=f"Fast mode: {'on' if current else 'off'}")
        enabled = {"on": True, "off": False, "toggle": not current}.get(action)
        if enabled is None:
            return CommandResult(message="Usage: /fast [show|on|off|toggle]")
        settings.fast_mode = enabled
        save_settings(settings)
        if context.app_state is not None:
            context.app_state.set(fast_mode=enabled)
        return CommandResult(message=f"Fast mode {'enabled' if enabled else 'disabled'}.")

    async def _effort_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        current = context.app_state.get().effort if context.app_state is not None else settings.effort
        value = args.strip() or "show"
        if value == "show":
            return CommandResult(message=f"Reasoning effort: {_effort_label(current)}")
        if value not in {"auto", "none", "low", "medium", "high", "xhigh", "max"}:
            return CommandResult(message="Usage: /effort [show|auto|low|medium|high|xhigh|max]")
        stored_value = "none" if value == "auto" else value
        settings.effort = stored_value
        save_settings(settings)
        context.engine.set_reasoning_effort(stored_value)
        context.engine.set_system_prompt(build_runtime_system_prompt(settings, cwd=context.cwd))
        if context.app_state is not None:
            context.app_state.set(effort=stored_value)
        return CommandResult(message=f"Reasoning effort set to {_effort_label(stored_value)}.")

    async def _passes_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        current = context.app_state.get().passes if context.app_state is not None else settings.passes
        value = args.strip() or "show"
        if value == "show":
            return CommandResult(message=f"Passes: {current}")
        try:
            passes = max(1, min(int(value), 8))
        except ValueError:
            return CommandResult(message="Usage: /passes [show|COUNT]")
        settings.passes = passes
        save_settings(settings)
        context.engine.set_system_prompt(build_runtime_system_prompt(settings, cwd=context.cwd))
        if context.app_state is not None:
            context.app_state.set(passes=passes)
        return CommandResult(message=f"Pass count set to {passes}.")

    async def _turns_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        engine_turns = "unlimited" if context.engine.max_turns is None else str(context.engine.max_turns)
        tokens = args.split()
        if not tokens or tokens[0] == "show":
            return CommandResult(
                message=(
                    f"Max turns (engine): {engine_turns}\n"
                    f"Max turns (config): {settings.max_turns}\n"
                    "Usage: /turns [show|unlimited|COUNT]"
                )
            )
        if tokens[0] == "set" and len(tokens) == 2:
            raw = tokens[1]
        elif len(tokens) == 1:
            raw = tokens[0]
        else:
            return CommandResult(message="Usage: /turns [show|unlimited|COUNT]")
        if raw.lower() == "unlimited":
            context.engine.set_max_turns(None)
            return CommandResult(
                message=(
                    "Max turns set to unlimited for this session. "
                    f"Saved config remains {settings.max_turns}."
                )
            )
        try:
            turns = int(raw)
        except ValueError:
            return CommandResult(message="Usage: /turns [show|unlimited|COUNT]")
        turns = max(1, min(turns, 512))
        settings.max_turns = turns
        save_settings(settings)
        context.engine.set_max_turns(turns)
        return CommandResult(message=f"Max turns set to {turns}.")

    async def _continue_handler(args: str, context: CommandContext) -> CommandResult:
        raw = args.strip()
        if not context.engine.has_pending_continuation():
            return CommandResult(message="Nothing to continue (no pending tool results).")

        turns: int | None = None
        if raw:
            tokens = raw.split()
            if tokens[0] == "set" and len(tokens) == 2:
                raw = tokens[1]
            try:
                turns = int(raw)
            except ValueError:
                return CommandResult(message="Usage: /continue [COUNT]")
            turns = max(1, min(turns, 512))

        return CommandResult(
            message="Continuing pending tool loop...",
            continue_pending=True,
            continue_turns=turns,
        )

    async def _issue_handler(args: str, context: CommandContext) -> CommandResult:
        path = get_project_issue_file(context.cwd)
        tokens = args.split(maxsplit=1)
        action = tokens[0] if tokens else "show"
        rest = tokens[1] if len(tokens) == 2 else ""
        if action == "show":
            if not path.exists():
                return CommandResult(message=f"No issue context. File path: {path}")
            return CommandResult(message=path.read_text(encoding="utf-8"))
        if action == "set" and rest:
            title, separator, body = rest.partition("::")
            if not separator or not title.strip() or not body.strip():
                return CommandResult(message="Usage: /issue set TITLE :: BODY")
            content = f"# {title.strip()}\n\n{body.strip()}\n"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            return CommandResult(message=f"Saved issue context to {path}")
        if action == "clear":
            if path.exists():
                path.unlink()
                return CommandResult(message="Cleared issue context.")
            return CommandResult(message="No issue context to clear.")
        return CommandResult(message="Usage: /issue [show|set TITLE :: BODY|clear]")

    async def _pr_comments_handler(args: str, context: CommandContext) -> CommandResult:
        path = get_project_pr_comments_file(context.cwd)
        tokens = args.split(maxsplit=1)
        action = tokens[0] if tokens else "show"
        rest = tokens[1] if len(tokens) == 2 else ""
        if action == "show":
            if not path.exists():
                return CommandResult(message=f"No PR comments context. File path: {path}")
            return CommandResult(message=path.read_text(encoding="utf-8"))
        if action == "add" and rest:
            location, separator, comment = rest.partition("::")
            if not separator or not location.strip() or not comment.strip():
                return CommandResult(message="Usage: /pr_comments add FILE[:LINE] :: COMMENT")
            existing = path.read_text(encoding="utf-8") if path.exists() else "# PR Comments\n"
            if not existing.endswith("\n"):
                existing += "\n"
            existing += f"- {location.strip()}: {comment.strip()}\n"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(existing, encoding="utf-8")
            return CommandResult(message=f"Added PR comment to {path}")
        if action == "clear":
            if path.exists():
                path.unlink()
                return CommandResult(message="Cleared PR comments context.")
            return CommandResult(message="No PR comments context to clear.")
        return CommandResult(message="Usage: /pr_comments [show|add FILE[:LINE] :: COMMENT|clear]")

    async def _mcp_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        tokens = args.split()
        plugins = load_plugins(settings, context.cwd, extra_roots=context.extra_plugin_roots)
        servers = load_mcp_server_configs(settings, plugins, cwd=context.cwd, include_disabled=True)
        if not tokens or tokens[0] == "list":
            return CommandResult(message=_format_mcp_management_text(settings, plugins, context.cwd))
        if tokens[0] in {"enable", "disable", "toggle"} and len(tokens) == 2:
            server_name = tokens[1]
            if server_name not in servers:
                return CommandResult(message=f"Unknown MCP server: {server_name}")
            disabled = set(settings.disabled_mcp_servers or set())
            if tokens[0] == "enable":
                disabled.discard(server_name)
            elif tokens[0] == "disable":
                disabled.add(server_name)
            else:
                if server_name in disabled:
                    disabled.remove(server_name)
                else:
                    disabled.add(server_name)
            settings.disabled_mcp_servers = disabled
            save_settings(settings)
            enabled = server_name not in disabled
            return CommandResult(
                message=f"MCP server '{server_name}' {'enabled' if enabled else 'disabled'}.",
                refresh_runtime=True,
            )
        if tokens and tokens[0] == "auth" and len(tokens) >= 3:
            server_name = tokens[1]
            config = settings.mcp_servers.get(server_name)
            if config is None:
                return CommandResult(message=f"Unknown MCP server: {server_name}")

            if len(tokens) == 3:
                mode = "bearer"
                key = None
                value = tokens[2]
            elif len(tokens) == 4:
                mode = tokens[2]
                key = None
                value = tokens[3]
            elif len(tokens) == 5:
                mode = tokens[2]
                key = tokens[3]
                value = tokens[4]
            else:
                return CommandResult(
                    message="Usage: /mcp auth SERVER TOKEN | /mcp auth SERVER [bearer|env] VALUE | /mcp auth SERVER header KEY VALUE"
                )

            if hasattr(config, "headers"):
                if mode not in {"bearer", "header"}:
                    return CommandResult(message="HTTP/WS MCP auth supports bearer or header modes.")
                header_key = key or "Authorization"
                header_value = (
                    f"Bearer {value}" if mode == "bearer" and header_key == "Authorization" else value
                )
                headers = dict(getattr(config, "headers", {}) or {})
                headers[header_key] = header_value
                settings.mcp_servers[server_name] = config.model_copy(update={"headers": headers})
            elif hasattr(config, "env"):
                if mode not in {"bearer", "env"}:
                    return CommandResult(message="stdio MCP auth supports bearer or env modes.")
                env_key = key or "MCP_AUTH_TOKEN"
                env_value = f"Bearer {value}" if mode == "bearer" else value
                env = dict(getattr(config, "env", {}) or {})
                env[env_key] = env_value
                settings.mcp_servers[server_name] = config.model_copy(update={"env": env})
            else:
                return CommandResult(message=f"Server {server_name} does not support auth updates")
            save_settings(settings)
            return CommandResult(message=f"Saved MCP auth for {server_name}. Restart session to reconnect.")
        return CommandResult(message="Usage: /mcp [list|enable NAME|disable NAME|toggle NAME|auth SERVER ...]")

    async def _plugin_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        tokens = args.split()
        if not tokens or tokens[0] == "list":
            plugins = load_plugins(settings, context.cwd, extra_roots=context.extra_plugin_roots)
            return CommandResult(message=_format_plugins_management_text(plugins))
        if tokens[0] == "enable" and len(tokens) == 2:
            settings.enabled_plugins[tokens[1]] = True
            save_settings(settings)
            return CommandResult(message=f"Enabled plugin '{tokens[1]}'. Restart session to reload.")
        if tokens[0] == "disable" and len(tokens) == 2:
            settings.enabled_plugins[tokens[1]] = False
            save_settings(settings)
            return CommandResult(message=f"Disabled plugin '{tokens[1]}'. Restart session to reload.")
        if tokens[0] == "toggle" and len(tokens) == 2:
            plugins = load_plugins(settings, context.cwd, extra_roots=context.extra_plugin_roots)
            known_plugins = {plugin.manifest.name: plugin for plugin in plugins}
            current = known_plugins.get(tokens[1])
            if current is None:
                return CommandResult(message=f"Unknown plugin: {tokens[1]}")
            enabled = not current.enabled
            settings.enabled_plugins[tokens[1]] = enabled
            save_settings(settings)
            return CommandResult(
                message=f"{'Enabled' if enabled else 'Disabled'} plugin '{tokens[1]}'. Restart session to reload."
            )
        if tokens[0] == "install" and len(tokens) == 2:
            path = install_plugin_from_path(tokens[1])
            return CommandResult(message=f"Installed plugin to {path}")
        if tokens[0] == "uninstall" and len(tokens) == 2:
            if uninstall_plugin(tokens[1]):
                return CommandResult(message=f"Uninstalled plugin '{tokens[1]}'")
            return CommandResult(message=f"Plugin '{tokens[1]}' not found")
        plugins = load_plugins(settings, context.cwd, extra_roots=context.extra_plugin_roots)
        if plugins:
            return CommandResult(message=_format_plugins_management_text(plugins))
        return CommandResult(message="Usage: /plugin [list|enable NAME|disable NAME|toggle NAME|install PATH|uninstall NAME]")

    _MODE_LABELS = {"default": "Default", "plan": "Plan Mode", "full_auto": "Auto"}

    async def _permissions_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        tokens = args.split()
        if not tokens or tokens[0] == "show":
            permission = settings.permission
            active_mode = (
                context.app_state.get().permission_mode
                if context.app_state is not None
                else permission.mode.value
            )
            label = _MODE_LABELS.get(active_mode, active_mode)
            return CommandResult(
                message=(
                    f"Mode: {label}\n"
                    f"Allowed tools: {permission.allowed_tools}\n"
                    f"Denied tools: {permission.denied_tools}"
                )
            )
        target_mode: str | None = None
        if tokens[0] == "set" and len(tokens) == 2:
            target_mode = tokens[1]
        elif len(tokens) == 1 and tokens[0] in _MODE_LABELS:
            target_mode = tokens[0]
        if target_mode is not None:
            settings.permission.mode = PermissionMode(target_mode)
            save_settings(settings)
            context.engine.set_permission_checker(PermissionChecker(settings.permission))
            if context.app_state is not None:
                context.app_state.set(permission_mode=settings.permission.mode.value)
            label = _MODE_LABELS.get(target_mode, target_mode)
            return CommandResult(message=f"Permission mode set to {label}", refresh_runtime=True)
        return CommandResult(message="Usage: /permissions [show|MODE]")

    async def _plan_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        raw_app_mode = (
            context.app_state.get().permission_mode
            if context.app_state is not None
            else None
        )
        current_mode = str(raw_app_mode or "").strip().lower().replace(" ", "_")
        saved_mode = str(settings.permission.mode.value).strip().lower().replace(" ", "_")
        plan_values = {PermissionMode.PLAN.value, "plan_mode", "permissionmode.plan"}
        mode = args.strip() or ("off" if current_mode in plan_values or saved_mode in plan_values else "on")
        if mode in {"on", "enter"}:
            settings.permission.mode = PermissionMode.PLAN
            save_settings(settings)
            context.engine.set_permission_checker(PermissionChecker(settings.permission))
            if context.app_state is not None:
                context.app_state.set(permission_mode=settings.permission.mode.value)
            return CommandResult(message="Plan mode enabled.", refresh_runtime=True)
        if mode in {"off", "exit"}:
            settings.permission.mode = PermissionMode.DEFAULT
            save_settings(settings)
            context.engine.set_permission_checker(PermissionChecker(settings.permission))
            if context.app_state is not None:
                context.app_state.set(permission_mode=settings.permission.mode.value)
            return CommandResult(message="Plan mode disabled.", refresh_runtime=True)
        return CommandResult(message="Usage: /plan [on|off]")

    async def _model_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        manager = AuthManager(settings)
        active_profile = manager.get_active_profile()
        _, profile = settings.resolve_profile(active_profile)
        tokens = args.split(maxsplit=1)
        if not tokens or tokens[0] == "show":
            return CommandResult(message=f"Model: {display_model_setting(profile)}\nProfile: {active_profile}")
        if tokens[0] == "set" and len(tokens) == 2:
            model_name = tokens[1].strip()
        elif args.strip():
            model_name = args.strip()
        else:
            model_name = None
        if model_name:
            if profile.allowed_models and model_name.lower() != "default" and model_name not in profile.allowed_models:
                allowed = ", ".join(profile.allowed_models)
                return CommandResult(message=f"Model '{model_name}' is not allowed for profile '{active_profile}'. Allowed models: {allowed}")
            if model_name.lower() == "default":
                manager.update_profile(active_profile, last_model="")
                message = "Model reset to default."
            else:
                manager.update_profile(active_profile, last_model=model_name)
                message = f"Model set to {model_name}."
            updated = load_settings()
            context.engine.set_model(updated.model)
            if context.app_state is not None:
                updated_profile = updated.resolve_profile()[1]
                context.app_state.set(model=display_model_setting(updated_profile))
            return CommandResult(message=message, refresh_runtime=True)
        return CommandResult(message="Usage: /model [show|MODEL]")

    async def _provider_handler(args: str, context: CommandContext) -> CommandResult:
        manager = AuthManager()
        profiles = manager.get_profile_statuses()
        tokens = args.split()
        if not tokens or tokens[0] == "show":
            active_name = manager.get_active_profile()
            active = profiles[active_name]
            lines = [
                f"Active profile: {active_name}",
                f"Label: {active['label']}",
                f"Provider: {active['provider']}",
                f"Auth source: {active['auth_source']}",
                f"Configured: {'yes' if active['configured'] else 'no'}",
                f"Base URL: {active['base_url'] or '(default)'}",
                f"Model: {active['model']}",
            ]
            return CommandResult(message="\n".join(lines))
        if tokens[0] == "list":
            lines = ["Provider profiles:"]
            for name, info in profiles.items():
                marker = "*" if info["active"] else " "
                configured = "configured" if info["configured"] else "missing auth"
                lines.append(f"{marker} {name} [{configured}] {info['label']} -> {info['model']}")
            return CommandResult(message="\n".join(lines))
        target = tokens[1] if tokens[0] == "use" and len(tokens) == 2 else (tokens[0] if len(tokens) == 1 else None)
        if target is None:
            return CommandResult(message="Usage: /provider [show|list|PROFILE]")
        manager.use_profile(target)
        updated = load_settings()
        profile = updated.resolve_profile()[1]
        context.engine.set_model(updated.model)
        if context.app_state is not None:
            context.app_state.set(
                model=display_model_setting(profile),
                provider=detect_provider(updated).name,
                auth_status=auth_status(updated),
                base_url=updated.base_url or "",
            )
        return CommandResult(
            message=f"Switched provider profile to {target} ({profile.label}).",
            refresh_runtime=True,
        )

    async def _theme_handler(args: str, context: CommandContext) -> CommandResult:
        from openharness.themes import list_themes, load_theme

        settings = load_settings()
        tokens = args.split(maxsplit=1)
        current = (
            context.app_state.get().theme
            if context.app_state is not None and hasattr(context.app_state.get(), "theme")
            else settings.theme
        )

        if not tokens or tokens[0] == "show":
            try:
                theme = load_theme(current)
                lines = [
                    f"Theme: {theme.name}",
                    f"  Colors:  primary={theme.colors.primary}  secondary={theme.colors.secondary}"
                    f"  accent={theme.colors.accent}  error={theme.colors.error}"
                    f"  muted={theme.colors.muted}",
                    f"           background={theme.colors.background}  foreground={theme.colors.foreground}",
                    f"  Borders: style={theme.borders.style}",
                    f"  Icons:   spinner={theme.icons.spinner}  tool={theme.icons.tool}"
                    f"  error={theme.icons.error}  success={theme.icons.success}"
                    f"  agent={theme.icons.agent}",
                    f"  Layout:  compact={theme.layout.compact}"
                    f"  show_tokens={theme.layout.show_tokens}"
                    f"  show_time={theme.layout.show_time}",
                ]
                return CommandResult(message="\n".join(lines))
            except KeyError:
                return CommandResult(message=f"Theme: {current} (not found)")

        if tokens[0] == "list":
            available = list_themes()
            lines = [f"{'*' if name == current else ' '} {name}" for name in available]
            return CommandResult(message="\n".join(lines))

        if tokens[0] == "set" and len(tokens) == 2:
            name = tokens[1]
        elif len(tokens) == 1 and tokens[0] not in {"list", "preview"}:
            name = tokens[0]
        else:
            name = None
        if name is not None:
            try:
                load_theme(name)
            except KeyError:
                available = list_themes()
                return CommandResult(
                    message=f"Unknown theme: {name!r}. Available: {', '.join(available)}"
                )
            settings.theme = name
            save_settings(settings)
            if context.app_state is not None:
                context.app_state.set(theme=name)
            return CommandResult(message=f"Theme set to {name}")

        if tokens[0] == "preview" and len(tokens) == 2:
            name = tokens[1]
            try:
                theme = load_theme(name)
            except KeyError:
                available = list_themes()
                return CommandResult(
                    message=f"Unknown theme: {name!r}. Available: {', '.join(available)}"
                )
            lines = [
                f"Preview: {theme.name}",
                f"  primary    {theme.colors.primary}",
                f"  secondary  {theme.colors.secondary}",
                f"  accent     {theme.colors.accent}",
                f"  error      {theme.colors.error}",
                f"  muted      {theme.colors.muted}",
                f"  background {theme.colors.background}",
                f"  foreground {theme.colors.foreground}",
                f"  borders    {theme.borders.style}",
                f"  icons      spinner={theme.icons.spinner} tool={theme.icons.tool}"
                f" success={theme.icons.success} error={theme.icons.error}"
                f" agent={theme.icons.agent}",
            ]
            return CommandResult(message="\n".join(lines))

        return CommandResult(message="Usage: /theme [list|show|NAME|preview NAME]")

    async def _output_style_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        tokens = args.split(maxsplit=1)
        styles = load_output_styles()
        available = {style.name: style for style in styles}
        current = (
            context.app_state.get().output_style
            if context.app_state is not None
            else settings.output_style
        )
        if not tokens or tokens[0] == "show":
            return CommandResult(message=f"Output style: {current}")
        if tokens[0] == "list":
            return CommandResult(
                message="\n".join(f"{style.name} [{style.source}]" for style in styles)
            )
        if tokens[0] == "set" and len(tokens) == 2:
            style_name = tokens[1]
        elif len(tokens) == 1 and tokens[0] not in {"list"}:
            style_name = tokens[0]
        else:
            style_name = None
        if style_name is not None:
            if style_name not in available:
                return CommandResult(message=f"Unknown output style: {style_name}")
            settings.output_style = style_name
            save_settings(settings)
            if context.app_state is not None:
                context.app_state.set(output_style=style_name)
            return CommandResult(message=f"Output style set to {style_name}")
        return CommandResult(message="Usage: /output-style [show|list|NAME]")

    async def _keybindings_handler(_: str, context: CommandContext) -> CommandResult:
        from openharness.keybindings import get_keybindings_path, load_keybindings

        bindings = (
            context.app_state.get().keybindings
            if context.app_state is not None and context.app_state.get().keybindings
            else load_keybindings()
        )
        lines = [f"Keybindings file: {get_keybindings_path()}"]
        lines.extend(f"{key} -> {command}" for key, command in sorted(bindings.items()))
        return CommandResult(message="\n".join(lines))

    async def _vim_handler(args: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        current = (
            context.app_state.get().vim_enabled
            if context.app_state is not None
            else settings.vim_mode
        )
        action = args.strip() or "show"
        if action == "show":
            return CommandResult(message=f"Vim mode: {'on' if current else 'off'}")
        enabled = {"on": True, "off": False, "toggle": not current}.get(action)
        if enabled is None:
            return CommandResult(message="Usage: /vim [show|on|off|toggle]")
        settings.vim_mode = enabled
        save_settings(settings)
        if context.app_state is not None:
            context.app_state.set(vim_enabled=enabled)
        return CommandResult(message=f"Vim mode {'enabled' if enabled else 'disabled'}.")

    async def _voice_handler(args: str, context: CommandContext) -> CommandResult:
        from openharness.voice import extract_keyterms, inspect_voice_capabilities

        settings = load_settings()
        diagnostics = inspect_voice_capabilities(detect_provider(settings))
        current = (
            context.app_state.get().voice_enabled
            if context.app_state is not None
            else settings.voice_mode
        )
        tokens = args.split(maxsplit=1)
        if not tokens or tokens[0] == "show":
            return CommandResult(
                message=(
                    f"Voice mode: {'on' if current else 'off'}\n"
                    f"Available: {'yes' if diagnostics.available else 'no'}\n"
                    f"Recorder: {diagnostics.recorder or '(none)'}\n"
                    f"Reason: {diagnostics.reason}"
                )
            )
        if tokens[0] == "keyterms" and len(tokens) == 2:
            keyterms = extract_keyterms(tokens[1])
            return CommandResult(message="\n".join(keyterms) if keyterms else "(no keyterms)")
        enabled = {"on": True, "off": False, "toggle": not current}.get(tokens[0])
        if enabled is None:
            return CommandResult(message="Usage: /voice [show|on|off|toggle|keyterms TEXT]")
        settings.voice_mode = enabled
        save_settings(settings)
        if context.app_state is not None:
            context.app_state.set(
                voice_enabled=enabled,
                voice_available=diagnostics.available,
                voice_reason=diagnostics.reason,
            )
        return CommandResult(message=f"Voice mode {'enabled' if enabled else 'disabled'}.")

    async def _doctor_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        manager = AuthManager(settings)
        active_profile_name, active_profile = settings.resolve_profile()
        memory_dir = get_project_memory_dir(context.cwd)
        state = context.app_state.get() if context.app_state is not None else None
        lines = [
            "Doctor summary:",
            f"- cwd: {context.cwd}",
            f"- active_profile: {active_profile_name}",
            f"- model: {settings.model}",
            f"- provider_workflow: {active_profile.label}",
            f"- auth_source: {active_profile.auth_source}",
            f"- permission_mode: {state.permission_mode if state is not None else settings.permission.mode}",
            f"- theme: {state.theme if state is not None else settings.theme}",
            f"- output_style: {state.output_style if state is not None else settings.output_style}",
            f"- vim_mode: {'on' if (state.vim_enabled if state is not None else settings.vim_mode) else 'off'}",
            f"- voice_mode: {'on' if (state.voice_enabled if state is not None else settings.voice_mode) else 'off'}",
            f"- effort: {_effort_label(state.effort if state is not None else settings.effort)}",
            f"- passes: {state.passes if state is not None else settings.passes}",
            f"- memory_dir: {memory_dir}",
            f"- plugin_count: {max(len(context.plugin_summary.splitlines()) - 1, 0) if context.plugin_summary else 0}",
            f"- mcp_configured: {'yes' if context.mcp_summary and 'No MCP' not in context.mcp_summary else 'no'}",
            f"- auth_configured: {'yes' if manager.get_profile_statuses()[active_profile_name]['configured'] else 'no'}",
        ]
        return CommandResult(message="\n".join(lines))

    async def _privacy_settings_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        session_dir = context.session_backend.get_session_dir(context.cwd)
        lines = [
            "Privacy settings:",
            f"- user_config_dir: {get_config_dir()}",
            f"- project_config_dir: {get_project_config_dir(context.cwd)}",
            f"- session_dir: {session_dir}",
            f"- feedback_log: {get_feedback_log_path()}",
            f"- api_base_url: {settings.base_url or '(default Anthropic-compatible endpoint)'}",
            "- network: enabled only for provider and explicit web/MCP calls",
            "- storage: local files under ~/.openharness and project .openharness",
        ]
        return CommandResult(message="\n".join(lines))

    async def _rate_limit_options_handler(_: str, context: CommandContext) -> CommandResult:
        settings = load_settings()
        provider = "moonshot-compatible" if (settings.base_url and "moonshot" in settings.base_url) else "anthropic-compatible"
        lines = [
            "Rate limit options:",
            f"- provider: {provider}",
            "- reduce /passes or switch /effort low for lighter requests",
            "- enable /fast for shorter responses and less tool churn",
            "- use /compact to shrink long transcripts before retrying",
            "- prefer background /tasks for long-running local work",
        ]
        return CommandResult(message="\n".join(lines))

    async def _release_notes_handler(_: str, context: CommandContext) -> CommandResult:
        path = Path(context.cwd) / "RELEASE_NOTES.md"
        if path.exists():
            return CommandResult(message=path.read_text(encoding="utf-8"))
        return CommandResult(
            message=(
                "# Release Notes\n\n"
                "- React TUI is now the default `oh` interface.\n"
                "- Added richer session, files, bridge, agent, copy, rewind, effort, passes, and privacy commands.\n"
                "- Expanded real-model validation across tools, MCP, tasks, plugins, notebook, LSP, cron, and worktree flows.\n"
            )
        )

    async def _upgrade_handler(_: str, context: CommandContext) -> CommandResult:
        del context
        try:
            version = importlib.metadata.version("openharness")
        except importlib.metadata.PackageNotFoundError:
            version = "0.1.7"
        return CommandResult(
            message=(
                f"Current version: {version}\n"
                "Upgrade instructions:\n"
                "- uv sync --extra dev\n"
                "- uv pip install -e .\n"
                "- npm --prefix frontend/terminal install"
            )
        )

    async def _diff_handler(args: str, context: CommandContext) -> CommandResult:
        if args.strip() == "full":
            ok, output = _run_git_command(context.cwd, "diff", "HEAD")
            return CommandResult(message=output or "(no diff)")
        ok, output = _run_git_command(context.cwd, "diff", "--stat")
        if not ok:
            return CommandResult(message=output)
        return CommandResult(message=output or "(no diff)")

    async def _branch_handler(args: str, context: CommandContext) -> CommandResult:
        action = args.strip() or "show"
        if action == "show":
            ok, current = _run_git_command(context.cwd, "branch", "--show-current")
            if not ok:
                return CommandResult(message=current)
            return CommandResult(message=f"Current branch: {current or '(detached HEAD)'}")
        if action == "list":
            ok, branches = _run_git_command(context.cwd, "branch", "--format", "%(refname:short)")
            return CommandResult(message=branches if ok else branches)
        return CommandResult(message="Usage: /branch [show|list]")

    async def _commit_handler(args: str, context: CommandContext) -> CommandResult:
        message = args.strip()
        if not message:
            ok, status = _run_git_command(context.cwd, "status", "--short")
            return CommandResult(message=status if ok and status else "(working tree clean)")
        ok, status = _run_git_command(context.cwd, "status", "--short")
        if not ok:
            return CommandResult(message=status)
        if not status.strip():
            return CommandResult(message="Nothing to commit.")
        ok, output = _run_git_command(context.cwd, "add", "-A")
        if not ok:
            return CommandResult(message=output)
        ok, output = _run_git_command(context.cwd, "commit", "-m", message)
        return CommandResult(message=output if ok else output)

    async def _tasks_handler(args: str, context: CommandContext) -> CommandResult:
        manager = get_task_manager()
        tokens = args.split(maxsplit=2)
        if not tokens or tokens[0] == "list":
            tasks = manager.list_tasks()
            if not tasks:
                return CommandResult(message="No background tasks.")
            return CommandResult(
                message="\n".join(f"{task.id} {task.type} {task.status} {task.description}" for task in tasks)
            )
        if tokens[0] == "run" and len(tokens) >= 2:
            command = args[len("run ") :]
            task = await manager.create_shell_task(
                command=command,
                description=command[:80],
                cwd=context.cwd,
            )
            return CommandResult(message=f"Started task {task.id}")
        if tokens[0] == "stop" and len(tokens) == 2:
            task = await manager.stop_task(tokens[1])
            return CommandResult(message=f"Stopped task {task.id}")
        if tokens[0] == "show" and len(tokens) == 2:
            task = manager.get_task(tokens[1])
            if task is None:
                return CommandResult(message=f"No task found with ID: {tokens[1]}")
            return CommandResult(message=str(task))
        if tokens[0] == "update" and len(tokens) == 3:
            task_id = tokens[1]
            rest = tokens[2]
            field, _, value = rest.partition(" ")
            if not value.strip():
                return CommandResult(
                    message="Usage: /tasks update ID [description TEXT|progress NUMBER|note TEXT]"
                )
            try:
                if field == "description":
                    task = manager.update_task(task_id, description=value)
                    return CommandResult(message=f"Updated task {task.id} description")
                if field == "progress":
                    try:
                        progress = int(value)
                    except ValueError:
                        return CommandResult(message="Progress must be an integer between 0 and 100.")
                    task = manager.update_task(task_id, progress=progress)
                    return CommandResult(message=f"Updated task {task.id} progress to {progress}%")
                if field == "note":
                    task = manager.update_task(task_id, status_note=value)
                    return CommandResult(message=f"Updated task {task.id} note")
            except ValueError as exc:
                return CommandResult(message=str(exc))
            return CommandResult(
                message="Usage: /tasks update ID [description TEXT|progress NUMBER|note TEXT]"
            )
        if tokens[0] == "output" and len(tokens) == 2:
            return CommandResult(message=manager.read_task_output(tokens[1]) or "(no output)")
        return CommandResult(
            message=(
                "Usage: /tasks "
                "[list|run CMD|stop ID|show ID|update ID description TEXT|update ID progress NUMBER|update ID note TEXT|output ID]"
            )
        )

    async def _autopilot_handler(args: str, context: CommandContext) -> CommandResult:
        store = RepoAutopilotStore(context.cwd)
        tokens = args.split()
        action = tokens[0].lower() if tokens else "status"

        def _render_card(card) -> str:
            lines = [
                f"{card.id} [{card.status}] score={card.score} {card.title}",
                f"source={card.source_kind} ref={card.source_ref or '-'}",
            ]
            if card.labels:
                lines.append(f"labels={', '.join(card.labels)}")
            if card.score_reasons:
                lines.append(f"reasons={', '.join(card.score_reasons[:4])}")
            if card.body:
                lines.append(_shorten_text(card.body, limit=220))
            return "\n".join(lines)

        if action == "status":
            counts = store.stats()
            active = store.pick_next_card()
            lines = ["Autopilot queue status:"]
            for status_name in (
                "queued",
                "accepted",
                "preparing",
                "running",
                "verifying",
                "pr_open",
                "waiting_ci",
                "repairing",
                "completed",
                "merged",
                "failed",
                "rejected",
                "superseded",
            ):
                lines.append(f"- {status_name}: {counts.get(status_name, 0)}")
            lines.append(f"- registry: {store.registry_path}")
            lines.append(f"- journal: {store.journal_path}")
            lines.append(f"- context: {store.context_path}")
            if active is not None:
                lines.append(f"- next: {active.id} {active.title} (score={active.score})")
            return CommandResult(message="\n".join(lines))

        if action == "list":
            status = tokens[1].lower() if len(tokens) >= 2 else None
            if status is not None and status not in {
                "queued",
                "accepted",
                "preparing",
                "running",
                "verifying",
                "pr_open",
                "waiting_ci",
                "repairing",
                "completed",
                "merged",
                "failed",
                "rejected",
                "superseded",
            }:
                return CommandResult(message=f"Unknown autopilot status: {status}")
            cards = store.list_cards(status=status)
            if not cards:
                return CommandResult(message="No autopilot cards.")
            return CommandResult(message="\n\n".join(_render_card(card) for card in cards[:12]))

        if action == "show" and len(tokens) >= 2:
            card = store.get_card(tokens[1])
            if card is None:
                return CommandResult(message=f"No autopilot card found with ID: {tokens[1]}")
            return CommandResult(message=_render_card(card))

        if action == "next":
            card = store.pick_next_card()
            if card is None:
                return CommandResult(message="No queued autopilot cards.")
            return CommandResult(message=_render_card(card))

        if action == "context":
            content = store.load_active_context()
            return CommandResult(message=content or "Active repo context is empty.")

        if action == "journal":
            limit = 8
            if len(tokens) >= 2:
                try:
                    limit = max(1, min(30, int(tokens[1])))
                except ValueError:
                    return CommandResult(message="Usage: /autopilot journal [LIMIT]")
            entries = store.load_journal(limit=limit)
            if not entries:
                return CommandResult(message="Repo journal is empty.")
            lines = []
            for entry in entries:
                timestamp = datetime.fromtimestamp(entry.timestamp, tz=timezone.utc).strftime(
                    "%Y-%m-%d %H:%M UTC"
                )
                task_suffix = f" [{entry.task_id}]" if entry.task_id else ""
                lines.append(f"{timestamp} {entry.kind}{task_suffix}: {entry.summary}")
            return CommandResult(message="\n".join(lines))

        if action == "add":
            raw = args[len("add") :].strip()
            if not raw:
                return CommandResult(
                    message=(
                        "Usage: /autopilot add "
                        "[idea|ohmo|issue|pr|claude] TITLE :: DETAILS"
                    )
                )
            source_kind = "manual_idea"
            source_map = {
                "idea": "manual_idea",
                "manual": "manual_idea",
                "ohmo": "ohmo_request",
                "issue": "github_issue",
                "pr": "github_pr",
                "claude": "claude_code_candidate",
            }
            if " " in raw:
                first, remainder = raw.split(" ", 1)
                mapped = source_map.get(first.lower())
                if mapped is not None:
                    source_kind = mapped
                    raw = remainder.strip()
            title, _, body = raw.partition("::")
            if not title.strip():
                return CommandResult(
                    message=(
                        "Usage: /autopilot add "
                        "[idea|ohmo|issue|pr|claude] TITLE :: DETAILS"
                    )
                )
            card, created = store.enqueue_card(
                source_kind=source_kind,
                title=title.strip(),
                body=body.strip(),
            )
            status_word = "Queued" if created else "Refreshed"
            return CommandResult(
                message=f"{status_word} autopilot card {card.id} (score={card.score}): {card.title}"
            )

        if action in {"accept", "start", "complete", "reject", "fail"} and len(tokens) >= 2:
            status_map = {
                "accept": "accepted",
                "start": "running",
                "complete": "completed",
                "fail": "failed",
                "reject": "rejected",
            }
            note = ""
            if len(tokens) >= 3:
                note = args.split(maxsplit=2)[2]
            try:
                card = store.update_status(tokens[1], status=status_map[action], note=note or None)
            except ValueError as exc:
                return CommandResult(message=str(exc))
            return CommandResult(message=f"{card.id} -> {card.status}: {card.title}")

        if action == "run-next":
            try:
                result = await store.run_next()
            except ValueError as exc:
                return CommandResult(message=str(exc))
            return CommandResult(
                message=(
                    f"{result.card_id} -> {result.status}\n"
                    f"run report: {result.run_report_path}\n"
                    f"verification report: {result.verification_report_path}"
                )
            )

        if action == "tick":
            try:
                result = await store.tick()
            except ValueError as exc:
                return CommandResult(message=str(exc))
            if result is None:
                return CommandResult(message="Autopilot tick completed with no execution.")
            return CommandResult(
                message=(
                    f"Autopilot tick executed {result.card_id} -> {result.status}\n"
                    f"run report: {result.run_report_path}\n"
                    f"verification report: {result.verification_report_path}"
                )
            )

        if action == "install-cron":
            names = store.install_default_cron()
            return CommandResult(message="Installed autopilot cron jobs: " + ", ".join(names))

        if action == "export-dashboard":
            output = tokens[1] if len(tokens) >= 2 else None
            path = store.export_dashboard(output)
            return CommandResult(message=f"Exported autopilot dashboard: {path}")

        if action == "scan":
            if len(tokens) < 2:
                return CommandResult(
                    message="Usage: /autopilot scan [issues|prs|claude-code|all] [LIMIT]"
                )
            target = tokens[1].lower()
            limit = 10
            if len(tokens) >= 3:
                try:
                    limit = max(1, min(50, int(tokens[2])))
                except ValueError:
                    return CommandResult(
                        message="Usage: /autopilot scan [issues|prs|claude-code|all] [LIMIT]"
                    )
            try:
                if target == "issues":
                    cards = store.scan_github_issues(limit=limit)
                    return CommandResult(message=f"Scanned {len(cards)} GitHub issues into autopilot.")
                if target == "prs":
                    cards = store.scan_github_prs(limit=limit)
                    return CommandResult(message=f"Scanned {len(cards)} GitHub PRs into autopilot.")
                if target == "claude-code":
                    cards = store.scan_claude_code_candidates(limit=limit)
                    return CommandResult(
                        message=f"Scanned {len(cards)} claude-code candidates into autopilot."
                    )
                if target == "all":
                    counts = store.scan_all_sources(issue_limit=limit, pr_limit=limit)
                    return CommandResult(message=f"Scanned all sources: {json.dumps(counts)}")
            except ValueError as exc:
                return CommandResult(message=str(exc))
            return CommandResult(
                message="Usage: /autopilot scan [issues|prs|claude-code|all] [LIMIT]"
            )

        return CommandResult(
            message=(
                "Usage: /autopilot "
                "[status|list [STATUS]|show ID|next|context|journal [LIMIT]|"
                "add [idea|ohmo|issue|pr|claude] TITLE :: DETAILS|"
                "accept ID|start ID|complete ID [NOTE]|fail ID [NOTE]|reject ID [NOTE]|"
                "run-next|tick|install-cron|export-dashboard [OUTPUT]|"
                "scan [issues|prs|claude-code|all] [LIMIT]]"
            )
        )

    async def _ship_handler(args: str, context: CommandContext) -> CommandResult:
        raw = args.strip()
        if not raw:
            return CommandResult(message="Usage: /ship TITLE :: DETAILS")
        title, _, body = raw.partition("::")
        if not title.strip():
            return CommandResult(message="Usage: /ship TITLE :: DETAILS")
        store = RepoAutopilotStore(context.cwd)
        card, _ = store.enqueue_card(
            source_kind="ohmo_request",
            title=title.strip(),
            body=body.strip(),
        )
        try:
            result = await store.run_card(card.id)
        except ValueError as exc:
            return CommandResult(message=str(exc))
        return CommandResult(
            message=(
                f"{result.card_id} -> {result.status}\n"
                f"run report: {result.run_report_path}\n"
                f"verification report: {result.verification_report_path}"
            )
        )

    registry.register(SlashCommand("help", "사용 가능한 명령어를 보여줍니다", _help_handler))
    registry.register(
        SlashCommand("exit", "OpenHarness를 종료합니다", _exit_handler, aliases=("quit",))
    )
    registry.register(SlashCommand("clear", "현재 대화 기록을 지웁니다", _clear_handler))
    registry.register(SlashCommand("version", "설치된 OpenHarness 버전을 보여줍니다", _version_handler))
    registry.register(SlashCommand("status", "세션 상태를 보여줍니다", _status_handler))
    registry.register(SlashCommand("context", "현재 런타임 시스템 프롬프트를 보여줍니다", _context_handler))
    registry.register(SlashCommand("summary", "대화 기록을 요약합니다", _summary_handler))
    registry.register(SlashCommand("compact", "오래된 대화 기록을 압축합니다", _compact_handler))
    registry.register(SlashCommand("cost", "토큰 사용량과 예상 비용을 보여줍니다", _cost_handler))
    registry.register(SlashCommand("usage", "사용량과 토큰 추정치를 보여줍니다", _usage_handler))
    registry.register(SlashCommand("stats", "세션 통계를 보여줍니다", _stats_handler))
    registry.register(SlashCommand("memory", "프로젝트 메모리를 확인하고 관리합니다", _memory_handler))
    registry.register(SlashCommand("hooks", "설정된 훅을 보여줍니다", _hooks_handler))
    registry.register(SlashCommand("resume", "최근 저장된 세션을 복원합니다", _resume_handler))
    registry.register(SlashCommand("session", "현재 세션 저장 정보를 확인합니다", _session_handler))
    registry.register(SlashCommand("export", "현재 대화 기록을 내보냅니다", _export_handler))
    registry.register(SlashCommand("share", "공유 가능한 대화 스냅샷을 만듭니다", _share_handler))
    registry.register(SlashCommand("copy", "최근 응답이나 입력한 텍스트를 복사합니다", _copy_handler))
    registry.register(SlashCommand("tag", "현재 세션의 이름 있는 스냅샷을 만듭니다", _tag_handler))
    registry.register(SlashCommand("rewind", "최근 대화 턴을 되돌립니다", _rewind_handler))
    registry.register(SlashCommand("files", "현재 작업공간의 파일을 나열합니다", _files_handler))
    registry.register(SlashCommand("init", "프로젝트 OpenHarness 파일을 초기화합니다", _init_handler))
    registry.register(SlashCommand("bridge", "브리지 헬퍼와 브리지 세션을 확인합니다", _bridge_handler))
    registry.register(SlashCommand("login", "인증 상태를 보거나 API 키를 저장합니다", _login_handler))
    registry.register(SlashCommand("logout", "저장된 API 키를 지웁니다", _logout_handler))
    registry.register(SlashCommand("feedback", "CLI 피드백을 로컬 로그에 저장합니다", _feedback_handler))
    registry.register(SlashCommand("onboarding", "빠른 시작 안내를 보여줍니다", _onboarding_handler))
    registry.register(SlashCommand("skills", "사용 가능한 스킬을 보거나 자세히 확인합니다", _skills_handler))
    registry.register(
        SlashCommand(
            "learned-skills",
            "자동 학습 스킬을 보거나 켜고 끕니다",
            _learned_skills_handler,
        )
    )
    registry.register(SlashCommand("config", "설정을 보거나 변경합니다", _config_handler))
    registry.register(SlashCommand("mcp", "MCP 서버를 나열하거나 켜고 끕니다", _mcp_handler))
    registry.register(
        SlashCommand(
            "plugin",
            "플러그인을 관리합니다",
            _plugin_handler,
            remote_invocable=False,
            remote_admin_opt_in=True,
        )
    )
    registry.register(
        SlashCommand(
            "reload-plugins",
            "이 작업공간의 플러그인 검색을 다시 실행합니다",
            _reload_plugins_handler,
            remote_invocable=False,
            remote_admin_opt_in=True,
        )
    )
    registry.register(
        SlashCommand(
            "permissions",
            "권한 모드를 보거나 변경합니다",
            _permissions_handler,
            remote_invocable=False,
            remote_admin_opt_in=True,
        )
    )
    registry.register(
        SlashCommand(
            "plan",
            "계획 권한 모드를 켜거나 끕니다",
            _plan_handler,
            remote_invocable=False,
            remote_admin_opt_in=True,
        )
    )
    registry.register(SlashCommand("fast", "빠른 모드를 보거나 변경합니다", _fast_handler))
    registry.register(SlashCommand("effort", "추론 강도를 보거나 변경합니다", _effort_handler))
    registry.register(SlashCommand("passes", "추론 반복 횟수를 보거나 변경합니다", _passes_handler))
    registry.register(SlashCommand("turns", "최대 에이전트 턴 수를 보거나 변경합니다", _turns_handler))
    registry.register(SlashCommand("continue", "중단된 이전 도구 루프를 이어서 실행합니다", _continue_handler))
    registry.register(SlashCommand("provider", "프로바이더 프로필을 보거나 전환합니다", _provider_handler))
    registry.register(SlashCommand("model", "기본 모델을 보거나 변경합니다", _model_handler))
    registry.register(SlashCommand("theme", "TUI 테마를 나열, 설정, 표시 또는 미리보기합니다", _theme_handler))
    registry.register(SlashCommand("output-style", "출력 스타일을 보거나 변경합니다", _output_style_handler))
    registry.register(SlashCommand("keybindings", "적용된 키 바인딩을 보여줍니다", _keybindings_handler))
    registry.register(SlashCommand("vim", "Vim 모드를 보거나 변경합니다", _vim_handler))
    registry.register(SlashCommand("voice", "음성 모드를 보거나 변경합니다", _voice_handler))
    registry.register(SlashCommand("doctor", "환경 진단 정보를 보여줍니다", _doctor_handler))
    registry.register(SlashCommand("diff", "Git diff 출력을 보여줍니다", _diff_handler))
    registry.register(SlashCommand("branch", "Git 브랜치 정보를 보여줍니다", _branch_handler))
    registry.register(SlashCommand("commit", "Git 상태를 보거나 커밋을 생성합니다", _commit_handler))
    registry.register(SlashCommand("issue", "프로젝트 이슈 컨텍스트를 보거나 변경합니다", _issue_handler))
    registry.register(SlashCommand("pr_comments", "PR 코멘트 컨텍스트를 보거나 변경합니다", _pr_comments_handler))
    registry.register(SlashCommand("privacy-settings", "로컬 개인정보와 저장 설정을 보여줍니다", _privacy_settings_handler))
    registry.register(SlashCommand("rate-limit-options", "요청 제한 부담을 줄이는 방법을 보여줍니다", _rate_limit_options_handler))
    registry.register(SlashCommand("release-notes", "최근 OpenHarness 릴리스 노트를 보여줍니다", _release_notes_handler))
    registry.register(SlashCommand("upgrade", "업그레이드 안내를 보여줍니다", _upgrade_handler))
    registry.register(SlashCommand("agents", "에이전트와 팀 작업을 나열하거나 확인합니다", _agents_handler))
    registry.register(SlashCommand("subagents", "서브에이전트 사용량과 작업자 태스크를 확인합니다", _agents_handler))
    registry.register(SlashCommand("tasks", "백그라운드 작업을 관리합니다", _tasks_handler))
    registry.register(SlashCommand("autopilot", "저장소 자동 작업 입력과 컨텍스트를 관리합니다", _autopilot_handler))
    registry.register(SlashCommand("ship", "ohmo 기반 저장소 작업을 큐에 넣고 실행합니다", _ship_handler))

    for plugin_command in plugin_commands or ():
        if not plugin_command.user_invocable:
            continue

        async def _plugin_command_handler(
            args: str,
            context: CommandContext,
            *,
            command: PluginCommandDefinition = plugin_command,
        ) -> CommandResult:
            prompt = _render_plugin_command_prompt(
                command,
                args,
                getattr(context, "session_id", None),
            )
            if command.disable_model_invocation:
                return CommandResult(message=prompt)
            return CommandResult(
                submit_prompt=prompt,
                submit_model=command.model,
            )

        registry.register(
            SlashCommand(
                plugin_command.name,
                plugin_command.description,
                _plugin_command_handler,
            )
        )
    return registry


def _resolve_memory_entry_path(memory_dir: Path, candidate: str) -> tuple[Path | None, bool]:
    """Resolve a memory entry path while enforcing containment under ``memory_dir``."""

    base = memory_dir.resolve()
    resolved, invalid = _resolve_memory_candidate(base, candidate)
    if invalid:
        return None, True
    if resolved is not None and resolved.exists():
        return resolved, False
    fallback, invalid = _resolve_memory_candidate(base, f"{candidate}.md")
    if invalid:
        return None, True
    if fallback is not None and fallback.exists():
        return fallback, False
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", candidate.strip().lower()).strip("_")
    if slug and slug != candidate:
        slugged, invalid = _resolve_memory_candidate(base, f"{slug}.md")
        if invalid:
            return None, True
        if slugged is not None and slugged.exists():
            return slugged, False
    return None, False


def _resolve_memory_candidate(memory_dir: Path, candidate: str) -> tuple[Path | None, bool]:
    path = Path(candidate).expanduser()
    if not path.is_absolute():
        path = memory_dir / path
    resolved = path.resolve()
    try:
        resolved.relative_to(memory_dir)
    except ValueError:
        return None, True
    return resolved, False
