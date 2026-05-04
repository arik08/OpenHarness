"""Shared runtime assembly for headless and Textual UIs."""

from __future__ import annotations

import json
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable

from myharness.api.client import AnthropicApiClient, ApiMessageRequest, ApiStreamEvent, SupportsStreamingMessages
from myharness.api.errors import AuthenticationFailure
from myharness.api.codex_client import CodexApiClient
from myharness.api.copilot_client import CopilotClient
from myharness.api.openai_client import OpenAICompatibleClient
from myharness.api.pgpt_auth import (
    build_pgpt_auth_token,
    resolve_pgpt_company_code,
    resolve_pgpt_employee_no,
)
from myharness.api.provider import auth_status, detect_provider
from myharness.bridge import get_bridge_manager
from myharness.commands import CommandContext, CommandResult, create_default_command_registry
from myharness.config import Settings, get_config_file_path, load_settings
from myharness.engine import QueryEngine
from myharness.engine.messages import (
    ConversationMessage,
    ToolResultBlock,
    ToolUseBlock,
    sanitize_conversation_messages,
)
from myharness.engine.query import MaxTurnsExceeded, SteeringProvider
from myharness.engine.stream_events import StreamEvent, ToolExecutionCompleted, ToolExecutionStarted
from myharness.hooks import HookEvent, HookExecutionContext, HookExecutor, load_hook_registry
from myharness.hooks.hot_reload import HookReloader
from myharness.mcp.client import McpClientManager
from myharness.mcp.config import load_mcp_server_configs
from myharness.permissions import PermissionChecker
from myharness.plugins import load_plugins
from myharness.prompts import build_runtime_system_prompt
from myharness.project_preferences import apply_project_preferences_to_settings
from myharness.state import AppState, AppStateStore
from myharness.services.session_backend import DEFAULT_SESSION_BACKEND, SessionBackend
from myharness.tools import ToolExecutionContext, ToolRegistry, create_default_tool_registry
from myharness.keybindings import load_keybindings

PermissionPrompt = Callable[[str, str], Awaitable[bool]]
AskUserPrompt = Callable[..., Awaitable[str]]
SystemPrinter = Callable[[str], Awaitable[None]]
StreamRenderer = Callable[[StreamEvent], Awaitable[None]]
ClearHandler = Callable[[], Awaitable[None]]


class MissingAuthClient:
    """Runtime placeholder that lets the UI start before credentials are configured."""

    def __init__(self, message: str) -> None:
        self._message = message

    async def stream_message(self, request: ApiMessageRequest) -> AsyncIterator[ApiStreamEvent]:
        del request
        raise AuthenticationFailure(self._message)
        yield  # pragma: no cover


@dataclass
class RuntimeBundle:
    """Shared runtime objects for one interactive session."""

    api_client: SupportsStreamingMessages
    cwd: str
    mcp_manager: McpClientManager
    tool_registry: ToolRegistry
    app_state: AppStateStore
    hook_executor: HookExecutor
    engine: QueryEngine
    commands: object
    external_api_client: bool
    enforce_max_turns: bool = True
    session_id: str = ""
    settings_overrides: dict[str, Any] = field(default_factory=dict)
    session_backend: SessionBackend = DEFAULT_SESSION_BACKEND
    extra_skill_dirs: tuple[str, ...] = ()
    extra_plugin_roots: tuple[str, ...] = ()

    def current_settings(self):
        """Return the effective settings for this session.

        We persist most settings to disk (``~/.myharness/settings.json``), but
        CLI options like ``--model``/``--api-format`` should remain in effect for
        the lifetime of the running process. Without this overlay, issuing any
        slash command (e.g. ``/fast``) would refresh UI state from disk and
        "snap back" the model/provider to whatever is stored in the config file.
        """
        settings = load_settings().merge_cli_overrides(**self.settings_overrides)
        return apply_project_preferences_to_settings(settings, self.cwd)

    def current_plugins(self):
        """Return currently visible plugins for the working tree."""
        return load_plugins(
            self.current_settings(),
            self.cwd,
            extra_roots=self.extra_plugin_roots,
        )

    def hook_summary(self) -> str:
        """Return the current hook summary."""
        return load_hook_registry(self.current_settings(), self.current_plugins()).summary()

    def plugin_summary(self) -> str:
        """Return the current plugin summary."""
        plugins = self.current_plugins()
        if not plugins:
            return "No plugins discovered."
        lines = ["Plugins:"]
        for plugin in plugins:
            state = "enabled" if plugin.enabled else "disabled"
            lines.append(f"- {plugin.manifest.name} [{state}] {plugin.manifest.description}")
        return "\n".join(lines)

    def mcp_summary(self) -> str:
        """Return the current MCP summary."""
        statuses = {status.name: status for status in self.mcp_manager.list_statuses()}
        configs = load_mcp_server_configs(
            self.current_settings(),
            self.current_plugins(),
            cwd=self.cwd,
            include_disabled=True,
        )
        disabled = set(self.current_settings().disabled_mcp_servers or set())
        if not statuses and not configs:
            return "No MCP servers configured."
        lines = ["MCP servers:"]
        for name in sorted(set(statuses) | set(configs)):
            status = statuses.get(name)
            if status is None:
                config = configs[name]
                state = "disabled" if name in disabled else "pending"
                detail = "Disabled in settings." if name in disabled else "Configured; restart or reload backend to connect."
                transport = str(getattr(config, "type", "unknown"))
                lines.append(f"- {name}: {state} ({transport}) - {detail}")
                continue
            suffix = f" - {status.detail}" if status.detail else ""
            lines.append(f"- {name}: {status.state}{suffix}")
            if status.tools:
                lines.append(f"  tools: {', '.join(tool.name for tool in status.tools)}")
            if status.resources:
                lines.append(f"  resources: {', '.join(resource.uri for resource in status.resources)}")
        return "\n".join(lines)


def _resolve_api_client_from_settings(settings) -> SupportsStreamingMessages:
    """Build the appropriate API client for the resolved settings."""
    # Ensure profile fields (base_url, model, api_format) are projected to settings
    settings = settings.materialize_active_profile()

    def _safe_resolve_auth():
        try:
            return settings.resolve_auth()
        except Exception as exc:
            raise ValueError(_missing_auth_message(settings)) from exc

    if settings.api_format == "copilot":
        from myharness.api.copilot_client import COPILOT_DEFAULT_MODEL

        copilot_model = (
            COPILOT_DEFAULT_MODEL
            if settings.model in {"claude-sonnet-4-20250514", "claude-sonnet-4-6", "sonnet", "default"}
            else settings.model
        )
        return CopilotClient(model=copilot_model)
    if settings.provider == "openai_codex":
        auth = _safe_resolve_auth()
        return CodexApiClient(
            auth_token=auth.value,
            base_url=settings.base_url,
            timeout=settings.timeout,
        )
    if settings.provider == "anthropic_claude":
        return AnthropicApiClient(
            auth_token=_safe_resolve_auth().value,
            base_url=settings.base_url,
            claude_oauth=True,
            auth_token_resolver=lambda: settings.resolve_auth().value,
        )
    if settings.api_format in ("openai", "openai_compat"):
        auth = _safe_resolve_auth()
        api_key = auth.value
        if settings.resolve_profile()[1].auth_source == "pgpt_api_key":
            employee_no = resolve_pgpt_employee_no()
            if not employee_no:
                raise ValueError(_missing_auth_message(settings))
            api_key = build_pgpt_auth_token(api_key, employee_no, resolve_pgpt_company_code())
        return OpenAICompatibleClient(
            api_key=api_key,
            base_url=settings.base_url,
            timeout=settings.timeout,
        )
    auth = _safe_resolve_auth()
    return AnthropicApiClient(
        api_key=auth.value,
        base_url=settings.base_url,
    )


def _missing_auth_message(settings) -> str:
    if settings.resolve_profile()[1].auth_source == "pgpt_api_key":
        return (
            "P-GPT 인증 정보가 없습니다. PGPT_API_KEY와 PGPT_EMPLOYEE_NO 환경 변수를 "
            "설정하세요. run_myharness_web.bat 실행 시 환경변수 등록을 진행할 수 있습니다."
        )
    if settings.provider == "openai_codex":
        return "Codex 인증 정보가 없습니다. `oh auth codex-login`으로 로그인하세요."
    if settings.provider == "anthropic_claude":
        return "Claude 인증 정보가 없습니다. `oh auth claude-login`으로 로그인하세요."
    return (
        "API key가 없습니다. 현재 provider에 맞는 환경 변수를 설정하세요."
    )


async def build_runtime(
    *,
    prompt: str | None = None,
    cwd: str | None = None,
    model: str | None = None,
    max_turns: int | None = None,
    base_url: str | None = None,
    system_prompt: str | None = None,
    api_key: str | None = None,
    api_format: str | None = None,
    active_profile: str | None = None,
    effort: str | None = None,
    api_client: SupportsStreamingMessages | None = None,
    permission_prompt: PermissionPrompt | None = None,
    ask_user_prompt: AskUserPrompt | None = None,
    restore_messages: list[dict] | None = None,
    restore_tool_metadata: dict[str, object] | None = None,
    enforce_max_turns: bool = True,
    session_backend: SessionBackend | None = None,
    permission_mode: str | None = None,
    extra_skill_dirs: Iterable[str | Path] | None = None,
    extra_plugin_roots: Iterable[str | Path] | None = None,
) -> RuntimeBundle:
    """Build the shared runtime for an MyHarness session."""
    settings_overrides: dict[str, Any] = {
        "model": model,
        "max_turns": max_turns,
        "base_url": base_url,
        "system_prompt": system_prompt,
        "api_key": api_key,
        "api_format": api_format,
        "active_profile": active_profile,
        "effort": effort,
        "permission_mode": permission_mode,
    }
    cwd = str(Path(cwd).expanduser().resolve()) if cwd else str(Path.cwd())
    settings = load_settings().merge_cli_overrides(**settings_overrides)
    settings = apply_project_preferences_to_settings(settings, cwd)
    normalized_skill_dirs = tuple(str(Path(path).expanduser().resolve()) for path in (extra_skill_dirs or ()))
    normalized_plugin_roots = tuple(str(Path(path).expanduser().resolve()) for path in (extra_plugin_roots or ()))
    plugins = load_plugins(settings, cwd, extra_roots=normalized_plugin_roots)
    if api_client:
        resolved_api_client = api_client
    else:
        try:
            resolved_api_client = _resolve_api_client_from_settings(settings)
        except ValueError as exc:
            resolved_api_client = MissingAuthClient(str(exc))
    mcp_manager = McpClientManager(load_mcp_server_configs(settings, plugins, cwd=cwd))
    await mcp_manager.connect_all()
    tool_registry = create_default_tool_registry(mcp_manager)
    # Register plugin-provided tools
    for plugin in plugins:
        if plugin.enabled and plugin.tools:
            for tool in plugin.tools:
                tool_registry.register(tool)
    provider = detect_provider(settings)
    active_profile_name, active_profile = settings.resolve_profile()
    bridge_manager = get_bridge_manager()
    app_state = AppStateStore(
        AppState(
            # Show the effective runtime model (after CLI/env/profile merges),
            # not profile.last_model which may be stale.
            model=settings.model,
            permission_mode=settings.permission.mode.value,
            theme=settings.theme,
            cwd=cwd,
            provider=provider.name,
            active_profile=active_profile_name,
            provider_label=active_profile.label,
            auth_status=auth_status(settings),
            base_url=settings.base_url or "",
            vim_enabled=settings.vim_mode,
            voice_enabled=settings.voice_mode,
            voice_available=provider.voice_supported,
            voice_reason=provider.voice_reason,
            fast_mode=settings.fast_mode,
            effort=settings.effort,
            passes=settings.passes,
            mcp_connected=sum(1 for status in mcp_manager.list_statuses() if status.state == "connected"),
            mcp_failed=sum(1 for status in mcp_manager.list_statuses() if status.state == "failed"),
            bridge_sessions=len(bridge_manager.list_sessions()),
            output_style=settings.output_style,
            keybindings=load_keybindings(),
        )
    )
    hook_reloader = HookReloader(get_config_file_path())
    hook_executor = HookExecutor(
        hook_reloader.current_registry() if api_client is None else load_hook_registry(settings, plugins),
        HookExecutionContext(
            cwd=Path(cwd).resolve(),
            api_client=resolved_api_client,
            default_model=settings.model,
        ),
    )
    engine_max_turns = settings.max_turns if (enforce_max_turns or max_turns is not None) else None
    system_prompt_text = build_runtime_system_prompt(
        settings,
        cwd=cwd,
        latest_user_prompt=prompt,
        extra_skill_dirs=normalized_skill_dirs,
        extra_plugin_roots=normalized_plugin_roots,
    )
    from uuid import uuid4

    session_id = uuid4().hex[:12]

    restored_metadata = {
        "permission_mode": settings.permission.mode.value,
        "read_file_state": [],
        "invoked_skills": [],
        "async_agent_state": [],
        "async_agent_tasks": [],
        "recent_work_log": [],
        "recent_verified_work": [],
        "recent_tool_failures": [],
        "recent_learned_skills": [],
        "task_focus_state": {
            "goal": "",
            "recent_goals": [],
            "active_artifacts": [],
            "verified_state": [],
            "next_step": "",
        },
        "compact_checkpoints": [],
    }
    if isinstance(restore_tool_metadata, dict):
        for key, value in restore_tool_metadata.items():
            restored_metadata[key] = value

    engine = QueryEngine(
        api_client=resolved_api_client,
        tool_registry=tool_registry,
        permission_checker=PermissionChecker(settings.permission),
        cwd=cwd,
        model=settings.model,
        system_prompt=system_prompt_text,
        max_tokens=settings.max_tokens,
        reasoning_effort=settings.effort,
        context_window_tokens=settings.context_window_tokens or settings.memory.context_window_tokens,
        auto_compact_threshold_tokens=(
            settings.auto_compact_threshold_tokens
            or settings.memory.auto_compact_threshold_tokens
        ),
        max_turns=engine_max_turns,
        permission_prompt=permission_prompt,
        ask_user_prompt=ask_user_prompt,
        hook_executor=hook_executor,
        auto_skill_learning_enabled=settings.learning.effective_mode != "off",
        tool_metadata={
            "mcp_manager": mcp_manager,
            "bridge_manager": bridge_manager,
            "extra_skill_dirs": normalized_skill_dirs,
            "extra_plugin_roots": normalized_plugin_roots,
            "session_id": session_id,
            "active_profile": settings.active_profile,
            "provider": settings.provider,
            "runtime_model": settings.model,
            **restored_metadata,
        },
    )
    # Restore messages from a saved session if provided
    if restore_messages:
        restored = sanitize_conversation_messages(
            [ConversationMessage.model_validate(m) for m in restore_messages]
        )
        engine.load_messages(restored)

    # Start Docker sandbox if configured
    if settings.sandbox.enabled and settings.sandbox.backend == "docker":
        from myharness.sandbox.session import start_docker_sandbox

        await start_docker_sandbox(settings, session_id, Path(cwd))

    return RuntimeBundle(
        api_client=resolved_api_client,
        cwd=cwd,
        mcp_manager=mcp_manager,
        tool_registry=tool_registry,
        app_state=app_state,
        hook_executor=hook_executor,
        engine=engine,
        commands=create_default_command_registry(
            plugin_commands=[
                command
                for plugin in plugins
                if plugin.enabled
                for command in plugin.commands
            ]
        ),
        external_api_client=api_client is not None,
        enforce_max_turns=enforce_max_turns or max_turns is not None,
        session_id=session_id,
        settings_overrides=settings_overrides,
        session_backend=session_backend or DEFAULT_SESSION_BACKEND,
        extra_skill_dirs=normalized_skill_dirs,
        extra_plugin_roots=normalized_plugin_roots,
    )


async def start_runtime(bundle: RuntimeBundle) -> None:
    """Run session start hooks."""
    await bundle.hook_executor.execute(
        HookEvent.SESSION_START,
        {"cwd": bundle.cwd, "event": HookEvent.SESSION_START.value},
    )


async def close_runtime(bundle: RuntimeBundle) -> None:
    """Close runtime-owned resources."""
    from myharness.sandbox.session import stop_docker_sandbox

    await stop_docker_sandbox()
    # Extract local environment rules from session before closing
    try:
        from myharness.personalization.session_hook import update_rules_from_session
        update_rules_from_session(bundle.engine.messages)
    except Exception:
        pass  # personalization is best-effort, never block session end

    await bundle.mcp_manager.close()
    await bundle.hook_executor.execute(
        HookEvent.SESSION_END,
        {"cwd": bundle.cwd, "event": HookEvent.SESSION_END.value},
    )


def _last_user_text(messages: list[ConversationMessage]) -> str:
    for msg in reversed(messages):
        if msg.role == "user" and msg.text.strip():
            return msg.text.strip()
    return ""


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _format_pending_tool_results(messages: list[ConversationMessage]) -> str | None:
    """Render a compact summary when we stop after tool execution but before the follow-up model turn."""
    if not messages:
        return None

    last = messages[-1]
    if last.role != "user":
        return None
    tool_results = [block for block in last.content if isinstance(block, ToolResultBlock)]
    if not tool_results:
        return None

    tool_uses_by_id: dict[str, ToolUseBlock] = {}
    assistant_text = ""
    for msg in reversed(messages[:-1]):
        if msg.role != "assistant":
            continue
        if not msg.tool_uses:
            continue
        assistant_text = msg.text.strip()
        for tu in msg.tool_uses:
            tool_uses_by_id[tu.id] = tu
        break

    lines: list[str] = [
        "Pending continuation: tool results were produced, but the model did not get a chance to respond yet."
    ]
    if assistant_text:
        lines.append(f"Last assistant message: {_truncate(assistant_text, 400)}")

    max_results = 3
    for tr in tool_results[:max_results]:
        tu = tool_uses_by_id.get(tr.tool_use_id)
        if tu is not None:
            raw_input = json.dumps(tu.input, ensure_ascii=True, sort_keys=True)
            lines.append(
                f"- {tu.name} {_truncate(raw_input, 200)} -> {_truncate(tr.content.strip(), 400)}"
            )
        else:
            lines.append(
                f"- tool_result[{tr.tool_use_id}] -> {_truncate(tr.content.strip(), 400)}"
            )

    if len(tool_results) > max_results:
        lines.append(f"(+{len(tool_results) - max_results} more tool results)")

    lines.append("To continue from these results, run: /continue [COUNT].")
    return "\n".join(lines)


def sync_app_state(bundle: RuntimeBundle) -> None:
    """Refresh UI state from current settings and dynamic keybindings."""
    settings = bundle.current_settings()
    if bundle.enforce_max_turns:
        bundle.engine.set_max_turns(settings.max_turns)
    provider = detect_provider(settings)
    permission_mode = _active_runtime_permission_mode(bundle, settings)
    bundle.app_state.set(
        model=settings.model,
        permission_mode=permission_mode,
        theme=settings.theme,
        cwd=bundle.cwd,
        provider=provider.name,
        auth_status=auth_status(settings),
        base_url=settings.base_url or "",
        vim_enabled=settings.vim_mode,
        voice_enabled=settings.voice_mode,
        voice_available=provider.voice_supported,
        voice_reason=provider.voice_reason,
        fast_mode=settings.fast_mode,
        effort=settings.effort,
        passes=settings.passes,
        mcp_connected=sum(1 for status in bundle.mcp_manager.list_statuses() if status.state == "connected"),
        mcp_failed=sum(1 for status in bundle.mcp_manager.list_statuses() if status.state == "failed"),
        bridge_sessions=len(get_bridge_manager().list_sessions()),
        output_style=settings.output_style,
        keybindings=load_keybindings(),
    )


def _active_runtime_permission_mode(bundle: RuntimeBundle, settings: Settings) -> str:
    checker_settings = getattr(getattr(bundle.engine, "_permission_checker", None), "_settings", None)
    checker_mode = getattr(checker_settings, "mode", None)
    if checker_mode is not None:
        return getattr(checker_mode, "value", str(checker_mode))
    return settings.permission.mode.value


def refresh_runtime_client(bundle: RuntimeBundle) -> None:
    """Refresh the active runtime client after provider/auth/profile changes."""
    settings = bundle.current_settings()
    if not bundle.external_api_client:
        try:
            bundle.api_client = _resolve_api_client_from_settings(settings)
        except ValueError as exc:
            bundle.api_client = MissingAuthClient(str(exc))
        bundle.engine.set_api_client(bundle.api_client)
        bundle.hook_executor.update_context(
            api_client=bundle.api_client,
            default_model=settings.model,
        )
    bundle.engine.set_model(settings.model)
    sync_app_state(bundle)


async def handle_line(
    bundle: RuntimeBundle,
    line: str | ConversationMessage,
    *,
    print_system: SystemPrinter,
    render_event: StreamRenderer,
    clear_output: ClearHandler,
    steering_provider: SteeringProvider | None = None,
) -> bool:
    """Handle one submitted line for either headless or TUI rendering."""
    if not bundle.external_api_client:
        bundle.hook_executor.update_registry(
            load_hook_registry(bundle.current_settings(), bundle.current_plugins())
        )

    line_text = line.text if isinstance(line, ConversationMessage) else line
    has_attachments = isinstance(line, ConversationMessage) and any(
        getattr(block, "type", "") == "image" for block in line.content
    )

    if not has_attachments and line_text.startswith("!"):
        await _run_shell_shortcut(bundle, line_text[1:].strip(), print_system, render_event)
        sync_app_state(bundle)
        return True

    parsed = None if has_attachments else bundle.commands.lookup(line_text)
    if parsed is not None:
        command, args = parsed
        result = await command.handler(
            args,
            CommandContext(
                engine=bundle.engine,
                hooks_summary=bundle.hook_summary(),
                mcp_summary=bundle.mcp_summary(),
                plugin_summary=bundle.plugin_summary(),
                cwd=bundle.cwd,
                tool_registry=bundle.tool_registry,
                app_state=bundle.app_state,
                session_backend=bundle.session_backend,
                session_id=bundle.session_id,
                extra_skill_dirs=bundle.extra_skill_dirs,
                extra_plugin_roots=bundle.extra_plugin_roots,
            ),
        )
        if result.refresh_runtime:
            refresh_runtime_client(bundle)
        await _render_command_result(result, print_system, clear_output, render_event)
        if result.submit_prompt is not None:
            original_model = bundle.engine.model
            if result.submit_model:
                bundle.engine.set_model(result.submit_model)
            settings = bundle.current_settings()
            submit_prompt = result.submit_prompt
            system_prompt = build_runtime_system_prompt(
                settings,
                cwd=bundle.cwd,
                latest_user_prompt=submit_prompt,
                extra_skill_dirs=bundle.extra_skill_dirs,
                extra_plugin_roots=bundle.extra_plugin_roots,
            )
            bundle.engine.set_system_prompt(system_prompt)
            try:
                async for event in bundle.engine.submit_message(
                    submit_prompt,
                    steering_provider=steering_provider,
                ):
                    await render_event(event)
            except MaxTurnsExceeded as exc:
                await print_system(f"Stopped after {exc.max_turns} turns (max_turns).")
                pending = _format_pending_tool_results(bundle.engine.messages)
                if pending:
                    await print_system(pending)
            finally:
                if result.submit_model:
                    bundle.engine.set_model(original_model)
            bundle.session_backend.save_snapshot(
                cwd=bundle.cwd,
                model=bundle.engine.model,
                system_prompt=system_prompt,
                messages=bundle.engine.messages,
                usage=bundle.engine.total_usage,
                session_id=bundle.session_id,
                tool_metadata=bundle.engine.tool_metadata,
            )
        if result.continue_pending:
            settings = bundle.current_settings()
            if bundle.enforce_max_turns:
                bundle.engine.set_max_turns(settings.max_turns)
            system_prompt = build_runtime_system_prompt(
                settings,
                cwd=bundle.cwd,
                latest_user_prompt=_last_user_text(bundle.engine.messages),
                extra_skill_dirs=bundle.extra_skill_dirs,
                extra_plugin_roots=bundle.extra_plugin_roots,
            )
            bundle.engine.set_system_prompt(system_prompt)
            turns = result.continue_turns if result.continue_turns is not None else bundle.engine.max_turns
            try:
                async for event in bundle.engine.continue_pending(
                    max_turns=turns,
                    steering_provider=steering_provider,
                ):
                    await render_event(event)
            except MaxTurnsExceeded as exc:
                await print_system(f"Stopped after {exc.max_turns} turns (max_turns).")
                pending = _format_pending_tool_results(bundle.engine.messages)
                if pending:
                    await print_system(pending)
            bundle.session_backend.save_snapshot(
                cwd=bundle.cwd,
                model=settings.model,
                system_prompt=system_prompt,
                messages=bundle.engine.messages,
                usage=bundle.engine.total_usage,
                session_id=bundle.session_id,
                tool_metadata=bundle.engine.tool_metadata,
            )
        sync_app_state(bundle)
        return not result.should_exit

    settings = bundle.current_settings()
    if bundle.enforce_max_turns:
        bundle.engine.set_max_turns(settings.max_turns)
    system_prompt = build_runtime_system_prompt(
        settings,
        cwd=bundle.cwd,
        latest_user_prompt=line_text,
        extra_skill_dirs=bundle.extra_skill_dirs,
        extra_plugin_roots=bundle.extra_plugin_roots,
    )
    bundle.engine.set_system_prompt(system_prompt)
    try:
        async for event in bundle.engine.submit_message(
            line,
            steering_provider=steering_provider,
        ):
            await render_event(event)
    except MaxTurnsExceeded as exc:
        await print_system(f"Stopped after {exc.max_turns} turns (max_turns).")
        pending = _format_pending_tool_results(bundle.engine.messages)
        if pending:
            await print_system(pending)
        bundle.session_backend.save_snapshot(
            cwd=bundle.cwd,
            model=settings.model,
            system_prompt=system_prompt,
            messages=bundle.engine.messages,
            usage=bundle.engine.total_usage,
            session_id=bundle.session_id,
            tool_metadata=bundle.engine.tool_metadata,
        )
        sync_app_state(bundle)
        return True
    bundle.session_backend.save_snapshot(
        cwd=bundle.cwd,
        model=settings.model,
        system_prompt=system_prompt,
        messages=bundle.engine.messages,
        usage=bundle.engine.total_usage,
        session_id=bundle.session_id,
        tool_metadata=bundle.engine.tool_metadata,
    )
    sync_app_state(bundle)
    return True


async def _run_shell_shortcut(
    bundle: RuntimeBundle,
    command: str,
    print_system: SystemPrinter,
    render_event: StreamRenderer,
) -> None:
    if not command:
        await print_system("Usage: !<command>")
        return
    tool = bundle.tool_registry.get("cmd") or bundle.tool_registry.get("bash")
    if tool is None:
        await print_system("command tool is not available.")
        return

    tool_input = {"command": command}
    tool_name = tool.name
    await render_event(ToolExecutionStarted(tool_name=tool_name, tool_input=tool_input))
    try:
        result = await tool.execute(
            tool.input_model(**tool_input),
            ToolExecutionContext(cwd=Path(bundle.cwd), hook_executor=bundle.hook_executor),
        )
    except asyncio.CancelledError:
        await render_event(
            ToolExecutionCompleted(
                tool_name=tool_name,
                output="Command cancelled.",
                is_error=True,
            )
        )
        raise
    except Exception as exc:
        await render_event(
            ToolExecutionCompleted(
                tool_name=tool_name,
                output=str(exc),
                is_error=True,
            )
        )
        return

    await render_event(
        ToolExecutionCompleted(
            tool_name=tool_name,
            output=result.output,
            is_error=result.is_error,
        )
    )


async def _render_command_result(
    result: CommandResult,
    print_system: SystemPrinter,
    clear_output: ClearHandler,
    render_event: StreamRenderer | None = None,
) -> None:
    if result.clear_screen:
        await clear_output()
    if result.replay_messages and render_event is not None:
        # Replay restored conversation messages as transcript events
        from myharness.engine.stream_events import (
            AssistantTextDelta,
            AssistantTurnComplete,
            ToolExecutionCompleted,
            ToolExecutionStarted,
        )
        from myharness.api.usage import UsageSnapshot

        await clear_output()
        await print_system("Session restored:")
        pending_tools: dict[str, tuple[str, dict[str, object]]] = {}
        for msg in result.replay_messages:
            if msg.role == "user":
                has_image = any(getattr(block, "type", "") == "image" for block in msg.content)
                user_text = msg.text.strip()
                if has_image and "[image]" not in user_text:
                    user_text = f"{user_text} [image]".strip()
                if user_text:
                    await print_system(f"> {user_text}")
                for block in msg.content:
                    if getattr(block, "type", "") != "tool_result":
                        continue
                    tool_name, tool_input = pending_tools.pop(
                        block.tool_use_id,
                        ("tool", {}),
                    )
                    await render_event(
                        ToolExecutionCompleted(
                            tool_name=tool_name,
                            output=block.content,
                            is_error=block.is_error,
                        )
                    )
            elif msg.role == "assistant" and msg.text.strip():
                for tool_use in msg.tool_uses:
                    pending_tools[tool_use.id] = (tool_use.name, dict(tool_use.input))
                    await render_event(
                        ToolExecutionStarted(
                            tool_name=tool_use.name,
                            tool_input=dict(tool_use.input),
                        )
                    )
                await render_event(AssistantTextDelta(text=msg.text))
                await render_event(AssistantTurnComplete(message=msg, usage=UsageSnapshot()))
            elif msg.role == "assistant":
                for tool_use in msg.tool_uses:
                    pending_tools[tool_use.id] = (tool_use.name, dict(tool_use.input))
                    await render_event(
                        ToolExecutionStarted(
                            tool_name=tool_use.name,
                            tool_input=dict(tool_use.input),
                        )
                    )
    if result.message and not result.replay_messages:
        await print_system(result.message)
