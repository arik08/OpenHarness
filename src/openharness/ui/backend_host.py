"""JSON-lines backend host for the React terminal frontend."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from openharness.api.client import ApiMessageCompleteEvent, ApiMessageRequest, SupportsStreamingMessages
from openharness.auth.manager import AuthManager
from openharness.config.settings import CLAUDE_MODEL_ALIAS_OPTIONS, resolve_model_setting
from openharness.bridge import get_bridge_manager
from openharness.mcp.config import load_mcp_server_configs
from openharness.mcp.types import McpConnectionStatus
from openharness.themes import list_themes
from openharness.engine.stream_events import (
    AssistantTextDelta,
    AssistantTurnComplete,
    CompactProgressEvent,
    ErrorEvent,
    StatusEvent,
    StreamEvent,
    ToolExecutionCompleted,
    ToolExecutionStarted,
    ToolInputDelta,
)
from openharness.engine.messages import ConversationMessage, ImageBlock, TextBlock, ToolResultBlock, sanitize_conversation_messages
from openharness.output_styles import load_output_styles
from openharness.permissions.mutation_lock import release_mutation_lock
from openharness.project_preferences import (
    set_project_mcp_enabled,
    set_project_plugin_enabled,
    set_project_skill_enabled,
)
from openharness.prompts import build_runtime_system_prompt
from openharness.services.session_storage import (
    fallback_session_title_from_user_text,
    title_echoes_first_user,
    title_matches_first_user,
)
from openharness.skills import load_skill_registry
from openharness.skills.types import SkillDefinition
from openharness.tasks import get_task_manager
from openharness.ui.protocol import BackendEvent, FrontendRequest, PluginSnapshot, SkillSnapshot, TranscriptItem
from openharness.ui.runtime import build_runtime, close_runtime, handle_line, start_runtime
from openharness.services.session_backend import SessionBackend

log = logging.getLogger(__name__)

log = logging.getLogger(__name__)

_PROTOCOL_PREFIX = "OHJSON:"
_BUILT_IN_SKILL_SOURCES = {"bundled"}
_TOOL_PROGRESS_FIRST_DELAY_SECONDS = 2.5
_TOOL_PROGRESS_INTERVAL_SECONDS = 3.0


def _truncate_progress_text(value: object, limit: int = 96) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return f"{text[:limit - 3]}..."


def _tool_progress_message(tool_name: str, tool_input: dict[str, object] | None, elapsed_seconds: int) -> str:
    lower = tool_name.lower()
    payload = tool_input or {}
    if "bash" in lower or "shell" in lower:
        command = _truncate_progress_text(payload.get("command"))
        return f"명령 실행 중... {elapsed_seconds}초 경과" + (f" · {command}" if command else "")
    if "write" in lower or "edit" in lower or "notebook" in lower:
        path = _truncate_progress_text(payload.get("file_path") or payload.get("path"))
        return f"파일 작업 중... {elapsed_seconds}초 경과" + (f" · {path}" if path else "")
    target = _truncate_progress_text(payload.get("url") or payload.get("query") or payload.get("pattern"))
    return f"{tool_name} 실행 중... {elapsed_seconds}초 경과" + (f" · {target}" if target else "")


@dataclass(frozen=True)
class BackendHostConfig:
    """Configuration for one backend host session."""

    model: str | None = None
    max_turns: int | None = None
    base_url: str | None = None
    system_prompt: str | None = None
    api_key: str | None = None
    api_format: str | None = None
    active_profile: str | None = None
    effort: str | None = None
    api_client: SupportsStreamingMessages | None = None
    cwd: str | None = None
    restore_messages: list[dict] | None = None
    restore_tool_metadata: dict[str, object] | None = None
    enforce_max_turns: bool = True
    permission_mode: str | None = None
    session_backend: SessionBackend | None = None
    extra_skill_dirs: tuple[str, ...] = ()
    extra_plugin_roots: tuple[str, ...] = ()


class ReactBackendHost:
    """Drive the OpenHarness runtime over a structured stdin/stdout protocol."""

    def __init__(self, config: BackendHostConfig) -> None:
        self._config = config
        self._bundle = None
        self._write_lock = asyncio.Lock()
        self._request_queue: asyncio.Queue[FrontendRequest] = asyncio.Queue()
        self._permission_requests: dict[str, asyncio.Future[bool]] = {}
        self._question_requests: dict[str, asyncio.Future[str]] = {}
        self._permission_lock = asyncio.Lock()
        self._busy = False
        self._active_request_task: asyncio.Task[bool] | None = None
        self._running = True
        # Track last tool input per name for rich event emission
        self._last_tool_inputs: dict[str, dict] = {}

    async def run(self) -> int:
        self._bundle = await build_runtime(
            model=self._config.model,
            max_turns=self._config.max_turns,
            base_url=self._config.base_url,
            system_prompt=self._config.system_prompt,
            api_key=self._config.api_key,
            api_format=self._config.api_format,
            active_profile=self._config.active_profile,
            effort=self._config.effort,
            api_client=self._config.api_client,
            cwd=self._config.cwd,
            restore_messages=self._config.restore_messages,
            restore_tool_metadata=self._config.restore_tool_metadata,
            permission_prompt=self._ask_permission,
            ask_user_prompt=self._ask_question,
            enforce_max_turns=self._config.enforce_max_turns,
            permission_mode=self._config.permission_mode,
            session_backend=self._config.session_backend,
            extra_skill_dirs=self._config.extra_skill_dirs,
            extra_plugin_roots=self._config.extra_plugin_roots,
        )
        await start_runtime(self._bundle)
        await self._emit(
            BackendEvent.ready(
                self._bundle.app_state.get(),
                get_task_manager().list_tasks(),
                [
                    {"name": f"/{command.name}", "description": command.description}
                    for command in self._bundle.commands.list_commands()
                ],
                self._skill_snapshots(),
            )
        )
        await self._emit(self._status_snapshot())

        reader = asyncio.create_task(self._read_requests())
        try:
            while self._running:
                request = await self._request_queue.get()
                if request.type == "shutdown":
                    await self._emit(BackendEvent(type="shutdown"))
                    break
                if request.type in ("permission_response", "question_response"):
                    continue
                if request.type == "cancel_current":
                    await self._cancel_current_request()
                    continue
                if request.type == "list_sessions":
                    await self._handle_list_sessions()
                    continue
                if request.type == "delete_session":
                    await self._handle_delete_session(request.value or "")
                    continue
                if request.type == "refresh_skills":
                    await self._emit(BackendEvent.skills_snapshot(self._skill_snapshots()))
                    await self._emit(self._status_snapshot())
                    continue
                if request.type == "set_skill_enabled":
                    await self._handle_set_skill_enabled(request.value or "", request.enabled)
                    continue
                if request.type == "set_mcp_enabled":
                    await self._handle_set_mcp_enabled(request.value or "", request.enabled)
                    continue
                if request.type == "set_plugin_enabled":
                    await self._handle_set_plugin_enabled(request.value or "", request.enabled)
                    continue
                if request.type == "set_system_prompt":
                    await self._handle_set_system_prompt(request.value or "")
                    continue
                if request.type == "select_command":
                    await self._handle_select_command(request.command or "")
                    continue
                if request.type == "apply_select_command":
                    if self._busy:
                        await self._emit(BackendEvent(type="error", message="Session is busy"))
                        continue
                    self._busy = True
                    try:
                        self._active_request_task = asyncio.create_task(
                            self._apply_select_command(
                                request.command or "",
                                request.value or "",
                            )
                        )
                        should_continue = await self._active_request_task
                    except asyncio.CancelledError:
                        should_continue = True
                        await self._emit(
                            BackendEvent(
                                type="transcript_item",
                                item=TranscriptItem(role="system", text="작업을 중단했습니다."),
                            )
                        )
                        await self._emit(self._status_snapshot())
                        await self._emit(BackendEvent(type="line_complete"))
                    finally:
                        self._active_request_task = None
                        self._busy = False
                    if not should_continue:
                        await self._emit(BackendEvent(type="shutdown"))
                        break
                    continue
                if request.type != "submit_line":
                    await self._emit(BackendEvent(type="error", message=f"Unknown request type: {request.type}"))
                    continue
                if self._busy:
                    await self._emit(BackendEvent(type="error", message="Session is busy"))
                    continue
                line = (request.line or "").strip()
                if not line and not request.attachments:
                    continue
                self._busy = True
                try:
                    self._active_request_task = asyncio.create_task(
                        self._process_line(line, attachments=request.attachments)
                    )
                    should_continue = await self._active_request_task
                except asyncio.CancelledError:
                    should_continue = True
                    await self._emit(
                        BackendEvent(type="transcript_item", item=TranscriptItem(role="system", text="작업을 중단했습니다."))
                    )
                    await self._emit(self._status_snapshot())
                    await self._emit(BackendEvent(type="line_complete"))
                finally:
                    self._active_request_task = None
                    self._busy = False
                if not should_continue:
                    await self._emit(BackendEvent(type="shutdown"))
                    break
        finally:
            reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reader
            if self._bundle is not None:
                await close_runtime(self._bundle)
        return 0

    async def _cancel_current_request(self) -> None:
        task = self._active_request_task
        if task is None or task.done():
            return
        task.cancel()

    async def _read_requests(self) -> None:
        while True:
            raw = await asyncio.to_thread(sys.stdin.buffer.readline)
            if not raw:
                await self._request_queue.put(FrontendRequest(type="shutdown"))
                return
            payload = raw.decode("utf-8").strip()
            if not payload:
                continue
            try:
                request = FrontendRequest.model_validate_json(payload)
            except Exception as exc:  # pragma: no cover - defensive protocol handling
                await self._emit(BackendEvent(type="error", message=f"Invalid request: {exc}"))
                continue
            if request.type == "permission_response" and request.request_id in self._permission_requests:
                future = self._permission_requests[request.request_id]
                if not future.done():
                    future.set_result(bool(request.allowed))
                continue
            if request.type == "question_response" and request.request_id in self._question_requests:
                future = self._question_requests[request.request_id]
                if not future.done():
                    future.set_result(request.answer or "")
                continue
            if request.type == "cancel_current":
                await self._cancel_current_request()
                continue
            await self._request_queue.put(request)

    async def _process_line(
        self,
        line: str,
        *,
        transcript_line: str | None = None,
        attachments=None,
        quiet: bool = False,
    ) -> bool:
        assert self._bundle is not None
        attachments = attachments or []
        image_blocks: list[ImageBlock] = []
        for item in attachments:
            media_type = str(getattr(item, "media_type", "") or getattr(item, "mediaType", "") or "").strip()
            data = str(getattr(item, "data", "") or "").strip()
            name = str(getattr(item, "name", "") or "")
            if media_type.startswith("image/") and data:
                image_blocks.append(ImageBlock(media_type=media_type, data=data, source_path=name))
        effective_line = self._line_with_forced_skill(line) if not image_blocks else line
        effective_prompt: str | ConversationMessage = effective_line
        if image_blocks:
            content = []
            image_note = (
                f"\n\n[Attached image count: {len(image_blocks)}. "
                "Use the attached image content directly when answering.]"
            )
            text_with_note = f"{effective_line.strip()}{image_note}" if effective_line.strip() else image_note.strip()
            content.append(TextBlock(text=text_with_note))
            content.extend(image_blocks)
            effective_prompt = ConversationMessage.from_user_content(content)
        transcript_text = transcript_line or line
        if image_blocks:
            suffix = f" [image attachments: {len(image_blocks)}]"
            transcript_text = f"{transcript_text}{suffix}" if transcript_text else suffix.strip()
        if not quiet:
            await self._emit(
                BackendEvent(type="transcript_item", item=TranscriptItem(role="user", text=transcript_text))
            )

        async def _print_system(message: str) -> None:
            if quiet:
                return
            await self._emit(
                BackendEvent(type="transcript_item", item=TranscriptItem(role="system", text=message))
            )

        tool_progress_tasks: dict[str, list[asyncio.Task[None]]] = {}

        async def _tool_progress_loop(tool_name: str, tool_input: dict[str, object] | None) -> None:
            started_at = time.monotonic()
            await asyncio.sleep(_TOOL_PROGRESS_FIRST_DELAY_SECONDS)
            while True:
                elapsed = max(1, round(time.monotonic() - started_at))
                await self._emit(
                    BackendEvent(
                        type="tool_progress",
                        tool_name=tool_name,
                        tool_input=tool_input or {},
                        message=_tool_progress_message(tool_name, tool_input, elapsed),
                    )
                )
                await asyncio.sleep(_TOOL_PROGRESS_INTERVAL_SECONDS)

        def _start_tool_progress(tool_name: str, tool_input: dict[str, object] | None) -> None:
            task = asyncio.create_task(_tool_progress_loop(tool_name, tool_input))
            tool_progress_tasks.setdefault(tool_name, []).append(task)

        async def _stop_tool_progress(tool_name: str) -> None:
            tasks = tool_progress_tasks.pop(tool_name, [])
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

        async def _stop_all_tool_progress() -> None:
            tool_names = list(tool_progress_tasks)
            for tool_name in tool_names:
                await _stop_tool_progress(tool_name)

        async def _render_event(event: StreamEvent) -> None:
            if isinstance(event, AssistantTextDelta):
                await self._emit(BackendEvent(type="assistant_delta", message=event.text))
                return
            if isinstance(event, ToolInputDelta):
                await self._emit(
                    BackendEvent(
                        type="tool_input_delta",
                        tool_call_index=event.index,
                        tool_name=event.name,
                        arguments_delta=event.arguments_delta,
                    )
                )
                return
            if isinstance(event, CompactProgressEvent):
                await self._emit(
                    BackendEvent(
                        type="compact_progress",
                        compact_phase=event.phase,
                        compact_trigger=event.trigger,
                        attempt=event.attempt,
                        compact_checkpoint=event.checkpoint,
                        compact_metadata=event.metadata,
                        message=event.message,
                    )
                )
                return
            if isinstance(event, AssistantTurnComplete):
                await self._emit(
                    BackendEvent(
                        type="assistant_complete",
                        message=event.message.text.strip(),
                        item=TranscriptItem(role="assistant", text=event.message.text.strip()),
                        has_tool_uses=bool(event.message.tool_uses),
                    )
                )
                await self._emit(BackendEvent.tasks_snapshot(get_task_manager().list_tasks()))
                return
            if isinstance(event, ToolExecutionStarted):
                self._last_tool_inputs[event.tool_name] = event.tool_input or {}
                _start_tool_progress(event.tool_name, event.tool_input or {})
                await self._emit(
                    BackendEvent(
                        type="tool_started",
                        tool_name=event.tool_name,
                        tool_input=event.tool_input,
                        item=TranscriptItem(
                            role="tool",
                            text=f"{event.tool_name} {json.dumps(event.tool_input, ensure_ascii=True)}",
                            tool_name=event.tool_name,
                            tool_input=event.tool_input,
                        ),
                    )
                )
                return
            if isinstance(event, ToolExecutionCompleted):
                await _stop_tool_progress(event.tool_name)
                await self._emit(
                    BackendEvent(
                        type="tool_completed",
                        tool_name=event.tool_name,
                        output=event.output,
                        is_error=event.is_error,
                        item=TranscriptItem(
                            role="tool_result",
                            text=event.output,
                            tool_name=event.tool_name,
                            is_error=event.is_error,
                        ),
                    )
                )
                await self._emit(BackendEvent.tasks_snapshot(get_task_manager().list_tasks()))
                await self._emit(self._status_snapshot())
                # Emit todo_update when TodoWrite tool runs
                if event.tool_name in ("TodoWrite", "todo_write"):
                    tool_input = self._last_tool_inputs.get(event.tool_name, {})
                    # TodoWrite input may have 'todos' list or markdown content field
                    todos = tool_input.get("todos") or tool_input.get("content") or []
                    if isinstance(todos, list) and todos:
                        lines = []
                        for item in todos:
                            if isinstance(item, dict):
                                checked = item.get("status", "") in ("done", "completed", "x", True)
                                text = item.get("content") or item.get("text") or str(item)
                                lines.append(f"- [{'x' if checked else ' '}] {text}")
                        if lines:
                            await self._emit(BackendEvent(type="todo_update", todo_markdown="\n".join(lines)))
                    else:
                        await self._emit_todo_update_from_output(event.output)
                # Emit plan_mode_change when plan-related tools complete
                if event.tool_name in ("set_permission_mode", "plan_mode"):
                    assert self._bundle is not None
                    new_mode = self._bundle.app_state.get().permission_mode
                    await self._emit(BackendEvent(type="plan_mode_change", plan_mode=new_mode))
                return
            if isinstance(event, ErrorEvent):
                await self._emit(BackendEvent(type="error", message=event.message))
                return
            if isinstance(event, StatusEvent):
                await self._emit(BackendEvent(type="status", message=event.message))
                return

        async def _clear_output() -> None:
            await self._emit(BackendEvent(type="clear_transcript"))

        first_token = (line.strip().split(maxsplit=1) or [""])[0].lower()
        started_at = time.monotonic()
        try:
            if first_token != "/clear" and not first_token.startswith("/") and not quiet:
                await self._maybe_update_session_title_from_prompt(transcript_text)
            should_continue = await handle_line(
                self._bundle,
                effective_prompt,
                print_system=_print_system,
                render_event=_render_event,
                clear_output=_clear_output,
            )
            self._bundle.engine.tool_metadata["workflow_duration_seconds"] = max(1, round(time.monotonic() - started_at))
            if first_token != "/clear" and not quiet:
                self._save_current_session_snapshot()
            await self._emit(self._status_snapshot())
            await self._emit(BackendEvent.tasks_snapshot(get_task_manager().list_tasks()))
            if first_token == "/clear":
                session_id = self._start_new_saved_session()
                self._save_empty_session_snapshot("새 채팅")
                await self._emit(BackendEvent(type="active_session", value=session_id))
                await self._handle_list_sessions()
            elif first_token == "/resume":
                parts = line.strip().split(maxsplit=1)
                if len(parts) > 1 and parts[1].strip():
                    self._set_saved_session_id(parts[1].strip().split()[0])
            if first_token in {"/reload-plugins", "/skills"}:
                await self._emit(BackendEvent.skills_snapshot(self._skill_snapshots()))
            if first_token != "/clear" and not quiet:
                await self._maybe_update_session_title()
            await self._emit(BackendEvent(type="line_complete", quiet=quiet))
            return should_continue
        finally:
            await _stop_all_tool_progress()
            release_mutation_lock(self._bundle.engine.tool_metadata.pop("mutation_lock_token", None))

    async def _maybe_update_session_title_from_prompt(self, user_text: str) -> None:
        assert self._bundle is not None
        metadata = self._bundle.engine.tool_metadata
        if str(metadata.get("session_title") or "").strip():
            return
        clean_user_text = user_text.strip()
        if not clean_user_text:
            return
        try:
            title = await asyncio.wait_for(self._generate_session_title_from_user_text(clean_user_text), timeout=8)
        except Exception as exc:
            log.debug("Could not generate initial session title: %s", exc)
            title = ""
        if title and (not title_matches_first_user(title, clean_user_text) or title_echoes_first_user(title, clean_user_text)):
            title = fallback_session_title_from_user_text(clean_user_text)
        if not title:
            title = fallback_session_title_from_user_text(clean_user_text)
        if not title:
            return
        metadata["session_title"] = title
        await self._emit(BackendEvent(type="session_title", message=title))

    async def _maybe_update_session_title(self) -> None:
        assert self._bundle is not None
        metadata = self._bundle.engine.tool_metadata
        if str(metadata.get("session_title") or "").strip():
            return
        messages = self._bundle.engine.messages
        user_messages = [message for message in messages if message.role == "user" and message.text.strip()]
        assistant_messages = [message for message in messages if message.role == "assistant" and message.text.strip()]
        if not user_messages or not assistant_messages:
            return
        try:
            title = await asyncio.wait_for(self._generate_session_title(messages), timeout=8)
        except Exception as exc:
            log.debug("Could not generate session title: %s", exc)
            return
        first_user_text = user_messages[0].text.strip()
        if title and (not title_matches_first_user(title, first_user_text) or title_echoes_first_user(title, first_user_text)):
            title = fallback_session_title_from_user_text(first_user_text)
        if not title:
            return
        metadata["session_title"] = title
        await self._emit(BackendEvent(type="session_title", message=title))
        self._bundle.session_backend.save_snapshot(
            cwd=self._bundle.cwd,
            model=self._bundle.engine.model,
            system_prompt=self._bundle.engine.system_prompt,
            messages=self._bundle.engine.messages,
            usage=self._bundle.engine.total_usage,
            session_id=self._bundle.session_id,
            tool_metadata=metadata,
        )

    async def _generate_session_title(self, messages: list[ConversationMessage]) -> str:
        assert self._bundle is not None
        snippets: list[str] = []
        for message in messages:
            if message.role not in {"user", "assistant"}:
                continue
            text = " ".join(message.text.strip().split())
            if not text:
                continue
            snippets.append(f"{message.role}: {text[:700]}")
            if len(snippets) >= 6:
                break
        if not snippets:
            return ""
        prompt = (
            "Create a short chat history title for the conversation below.\n"
            "Rules:\n"
            "- Reply with only the title text.\n"
            "- Korean is preferred if the conversation is Korean.\n"
            "- Keep it under 24 Korean characters or 7 English words.\n"
            "- Preserve exact product, game, company, file, and project names from the first user message.\n"
            "- If the first user message names a subject, the title must include that subject.\n"
            "- Do not copy the user's full request; summarize the subject and outcome only.\n"
            "- Prefer noun phrases like '삼성전자 메모리 경쟁사 보고서' over command phrases.\n"
            "- Do not use quotes, punctuation-heavy phrasing, or generic words like '대화'.\n\n"
            + "\n".join(snippets)
        )
        request = ApiMessageRequest(
            model=self._bundle.engine.model,
            messages=[ConversationMessage.from_user_text(prompt)],
            system_prompt="You write concise, specific chat history titles.",
            max_tokens=32,
            tools=[],
        )
        title = ""
        async for event in self._bundle.api_client.stream_message(request):
            if isinstance(event, ApiMessageCompleteEvent):
                title = event.message.text.strip()
                break
        return self._clean_session_title(title)

    async def _generate_session_title_from_user_text(self, user_text: str) -> str:
        assert self._bundle is not None
        text = " ".join(user_text.strip().split())
        if not text:
            return ""
        prompt = (
            "Create a short chat history title for the user's question below.\n"
            "Rules:\n"
            "- Reply with only the title text.\n"
            "- Korean is preferred if the question is Korean.\n"
            "- Keep it under 24 Korean characters or 7 English words.\n"
            "- Preserve exact product, game, company, file, and project names from the question.\n"
            "- If the question names a subject, the title must include that subject.\n"
            "- Do not copy the user's full request; summarize the subject and outcome only.\n"
            "- Prefer noun phrases like '삼성전자 메모리 경쟁사 보고서' over command phrases.\n"
            "- Do not use quotes, punctuation-heavy phrasing, or generic words like '대화'.\n\n"
            f"user: {text[:1000]}"
        )
        request = ApiMessageRequest(
            model=self._bundle.engine.model,
            messages=[ConversationMessage.from_user_text(prompt)],
            system_prompt="You write concise, specific chat history titles.",
            max_tokens=32,
            tools=[],
        )
        title = ""
        async for event in self._bundle.api_client.stream_message(request):
            if isinstance(event, ApiMessageCompleteEvent):
                title = event.message.text.strip()
                break
        return self._clean_session_title(title)

    def _clean_session_title(self, title: str) -> str:
        cleaned = " ".join(str(title or "").strip().split())
        cleaned = cleaned.strip("\"'`“”‘’ ")
        cleaned = cleaned.replace("\n", " ").replace("\r", " ")
        if not cleaned:
            return ""
        for prefix in ("제목:", "Title:", "title:"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()
        return cleaned[:80]

    def _set_saved_session_id(self, session_id: str) -> None:
        assert self._bundle is not None
        clean_id = session_id.strip()
        if not clean_id:
            return
        self._bundle.session_id = clean_id
        self._bundle.engine.tool_metadata["session_id"] = clean_id

    def _reset_session_scoped_metadata(self) -> None:
        assert self._bundle is not None
        for key in (
            "session_title",
            "workflow_duration_seconds",
        ):
            self._bundle.engine.tool_metadata.pop(key, None)

    def _start_new_saved_session(self) -> str:
        session_id = uuid4().hex[:12]
        self._reset_session_scoped_metadata()
        self._set_saved_session_id(session_id)
        return session_id

    def _save_empty_session_snapshot(self, title: str) -> None:
        assert self._bundle is not None
        metadata = dict(self._bundle.engine.tool_metadata)
        metadata["session_title"] = title
        self._bundle.session_backend.save_snapshot(
            cwd=self._bundle.cwd,
            model=self._bundle.engine.model,
            system_prompt=self._bundle.engine.system_prompt,
            messages=self._bundle.engine.messages,
            usage=self._bundle.engine.total_usage,
            session_id=self._bundle.session_id,
            tool_metadata=metadata,
        )

    def _save_current_session_snapshot(self) -> None:
        assert self._bundle is not None
        self._bundle.session_backend.save_snapshot(
            cwd=self._bundle.cwd,
            model=self._bundle.engine.model,
            system_prompt=self._bundle.engine.system_prompt,
            messages=self._bundle.engine.messages,
            usage=self._bundle.engine.total_usage,
            session_id=self._bundle.session_id,
            tool_metadata=self._bundle.engine.tool_metadata,
        )

    def _skill_snapshots(self) -> list[SkillSnapshot]:
        assert self._bundle is not None
        registry = load_skill_registry(
            self._bundle.cwd,
            extra_skill_dirs=self._bundle.extra_skill_dirs,
            extra_plugin_roots=self._bundle.extra_plugin_roots,
            settings=self._bundle.current_settings(),
            include_disabled=True,
        )
        return [
            SkillSnapshot(
                name=skill.name,
                description=skill.description,
                source=skill.source,
                enabled=skill.enabled,
            )
            for skill in registry.list_skills()
            if skill.source not in _BUILT_IN_SKILL_SOURCES
        ]

    async def _handle_set_skill_enabled(self, name: str, enabled: bool | None) -> None:
        if not name.strip():
            await self._emit(BackendEvent(type="error", message="Skill name is required"))
            return
        assert self._bundle is not None
        set_project_skill_enabled(
            self._bundle.cwd,
            name,
            enabled is not False,
            self._bundle.current_settings(),
        )
        await self._emit(BackendEvent.skills_snapshot(self._skill_snapshots()))
        await self._emit(self._status_snapshot())

    async def _handle_set_mcp_enabled(self, name: str, enabled: bool | None) -> None:
        assert self._bundle is not None
        if not name.strip():
            await self._emit(BackendEvent(type="error", message="MCP server name is required"))
            return
        settings = self._bundle.current_settings()
        configs = load_mcp_server_configs(
            settings,
            self._bundle.current_plugins(),
            cwd=self._bundle.cwd,
            include_disabled=True,
        )
        if name not in configs:
            await self._emit(BackendEvent(type="error", message=f"Unknown MCP server: {name}"))
            return
        set_project_mcp_enabled(self._bundle.cwd, name, enabled is not False, settings)
        await self._emit(self._status_snapshot())

    async def _handle_set_plugin_enabled(self, name: str, enabled: bool | None) -> None:
        assert self._bundle is not None
        if not name.strip():
            await self._emit(BackendEvent(type="error", message="Plugin name is required"))
            return
        settings = self._bundle.current_settings()
        plugins = {plugin.manifest.name: plugin for plugin in self._bundle.current_plugins()}
        if name not in plugins:
            await self._emit(BackendEvent(type="error", message=f"Unknown plugin: {name}"))
            return
        set_project_plugin_enabled(self._bundle.cwd, name, enabled is not False, settings)
        await self._emit(self._status_snapshot())

    def _line_with_forced_skill(self, line: str) -> str:
        parsed = self._parse_forced_skill_line(line)
        if parsed is None:
            return line
        skill_name, user_request = parsed
        skill = self._loaded_skill_by_name(skill_name)
        if skill is None:
            return line
        request_text = user_request.strip() or "(No additional request was provided.)"
        return (
            f"The user explicitly selected the `{skill.name}` skill with `$`. "
            "Treat the selected skill content below as mandatory task guidance and follow it "
            "before applying any general approach.\n\n"
            "# Selected Skill Content\n"
            "```md\n"
            f"{skill.content.strip()}\n"
            "```\n\n"
            f"User request:\n{request_text}"
        )

    def _loaded_skill_by_name(self, name: str) -> SkillDefinition | None:
        assert self._bundle is not None
        registry = load_skill_registry(
            self._bundle.cwd,
            extra_skill_dirs=self._bundle.extra_skill_dirs,
            extra_plugin_roots=self._bundle.extra_plugin_roots,
            settings=self._bundle.current_settings(),
        )
        for skill in registry.list_skills():
            if skill.name.lower() == name.lower():
                return skill
        return None

    def _parse_forced_skill_line(self, line: str) -> tuple[str, str] | None:
        stripped = line.strip()
        if not stripped.startswith("$") or stripped == "$":
            return None
        remainder = stripped[1:].lstrip()
        if not remainder:
            return None
        if remainder[0] in {"'", '"'}:
            quote = remainder[0]
            end = remainder.find(quote, 1)
            if end <= 1:
                return None
            requested_name = remainder[1:end].strip()
            user_request = remainder[end + 1 :].lstrip()
        else:
            requested_name, _, user_request = remainder.partition(" ")
            requested_name = requested_name.strip()
        if not requested_name:
            return None
        skills = {skill.name.lower(): skill.name for skill in self._skill_snapshots()}
        canonical_name = skills.get(requested_name.lower())
        if canonical_name is None:
            return None
        return canonical_name, user_request

    async def _apply_select_command(self, command_name: str, value: str) -> bool:
        command = command_name.strip().lstrip("/").lower()
        selected = value.strip()
        if command == "resume":
            await self._restore_history_snapshot(selected)
            return True
        line = self._build_select_command_line(command, selected)
        if line is None:
            await self._emit(BackendEvent(type="error", message=f"Unknown select command: {command_name}"))
            await self._emit(BackendEvent(type="line_complete"))
            return True
        quiet = command in {"provider", "model", "effort"}
        return await self._process_line(line, transcript_line=f"/{command}", quiet=quiet)

    def _build_select_command_line(self, command: str, value: str) -> str | None:
        if command == "provider":
            return f"/provider {value}"
        if command == "resume":
            return f"/resume {value}" if value else "/resume"
        if command == "permissions":
            return f"/permissions {value}"
        if command == "theme":
            return f"/theme {value}"
        if command == "output-style":
            return f"/output-style {value}"
        if command == "effort":
            return f"/effort {value}"
        if command == "passes":
            return f"/passes {value}"
        if command == "turns":
            return f"/turns {value}"
        if command == "fast":
            return f"/fast {value}"
        if command == "vim":
            return f"/vim {value}"
        if command == "voice":
            return f"/voice {value}"
        if command == "model":
            return f"/model {value}"
        return None

    async def _restore_history_snapshot(self, session_id: str) -> None:
        assert self._bundle is not None
        selected = session_id.strip()
        if not selected:
            await self._emit(BackendEvent(type="error", message="Missing session id"))
            await self._emit(BackendEvent(type="line_complete"))
            return
        snapshot = self._bundle.session_backend.load_by_id(self._bundle.cwd, selected)
        if snapshot is None:
            await self._emit(BackendEvent(type="error", message=f"Session not found: {selected}"))
            await self._emit(BackendEvent(type="line_complete"))
            return
        messages = sanitize_conversation_messages(
            [ConversationMessage.model_validate(item) for item in snapshot.get("messages", [])]
        )
        self._bundle.engine.load_messages(messages)
        self._set_saved_session_id(selected)
        await self._emit(BackendEvent(type="clear_transcript"))
        await self._emit(
            BackendEvent(
                type="history_snapshot",
                value=selected,
                message=str(snapshot.get("summary") or "").strip(),
                compact_metadata={
                    "workflow_duration_seconds": (
                        snapshot.get("tool_metadata", {}) if isinstance(snapshot.get("tool_metadata"), dict) else {}
                    ).get("workflow_duration_seconds")
                },
                history_events=self._history_events_from_messages(messages),
            )
        )
        await self._emit(self._status_snapshot())
        await self._emit(BackendEvent.tasks_snapshot(get_task_manager().list_tasks()))
        await self._emit(BackendEvent(type="line_complete"))

    def _history_events_from_messages(self, messages: list[ConversationMessage]) -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        pending_tools: dict[str, tuple[str, dict[str, object]]] = {}
        for message in messages:
            if message.role == "user":
                user_text = message.text.strip()
                has_image = any(isinstance(block, ImageBlock) for block in message.content)
                if has_image and "[image]" not in user_text:
                    user_text = f"{user_text} [image]".strip()
                if user_text:
                    events.append({"type": "user", "text": user_text})
                for block in message.content:
                    if not isinstance(block, ToolResultBlock):
                        continue
                    tool_name, tool_input = pending_tools.pop(block.tool_use_id, ("tool", {}))
                    events.append(
                        {
                            "type": "tool_completed",
                            "tool_name": tool_name,
                            "tool_input": tool_input,
                            "output": block.content,
                            "is_error": block.is_error,
                        }
                    )
            elif message.role == "assistant":
                for tool_use in message.tool_uses:
                    tool_input = dict(tool_use.input)
                    pending_tools[tool_use.id] = (tool_use.name, tool_input)
                    events.append(
                        {
                            "type": "tool_started",
                            "tool_name": tool_use.name,
                            "tool_input": tool_input,
                        }
                    )
                if message.text.strip():
                    events.append({"type": "assistant", "text": message.text.strip()})
        return events

    def _status_snapshot(self) -> BackendEvent:
        assert self._bundle is not None
        return BackendEvent.status_snapshot(
            state=self._bundle.app_state.get(),
            mcp_servers=self._mcp_statuses_for_snapshot(),
            plugins=self._plugin_snapshots(),
            bridge_sessions=get_bridge_manager().list_sessions(),
        )

    def _mcp_statuses_for_snapshot(self) -> list[McpConnectionStatus]:
        assert self._bundle is not None
        statuses = {status.name: status for status in self._bundle.mcp_manager.list_statuses()}
        configs = load_mcp_server_configs(
            self._bundle.current_settings(),
            self._bundle.current_plugins(),
            cwd=self._bundle.cwd,
            include_disabled=True,
        )
        disabled = set(self._bundle.current_settings().disabled_mcp_servers or set())
        for name, config in configs.items():
            if name in statuses:
                continue
            transport = getattr(config, "type", "unknown")
            if name in disabled:
                statuses[name] = McpConnectionStatus(
                    name=name,
                    state="disabled",
                    detail="Disabled in settings.",
                    transport=str(transport),
                )
                continue
            statuses[name] = McpConnectionStatus(
                name=name,
                state="pending",
                detail="Configured; restart or reload backend to connect.",
                transport=str(transport),
            )
        return sorted(statuses.values(), key=lambda status: status.name)

    def _plugin_snapshots(self) -> list[PluginSnapshot]:
        assert self._bundle is not None
        return [
            PluginSnapshot(
                name=plugin.manifest.name,
                description=plugin.manifest.description,
                enabled=plugin.enabled,
                skill_count=len(plugin.skills),
                command_count=len(plugin.commands),
                mcp_server_count=len(plugin.mcp_servers),
            )
            for plugin in self._bundle.current_plugins()
        ]

    async def _emit_todo_update_from_output(self, output: str) -> None:
        """Emit a todo_update event by extracting markdown checklist from tool output."""
        # TodoWrite tools typically echo back the written content
        # We look for markdown checklist patterns in the output
        lines = output.splitlines()
        checklist_lines = [line for line in lines if line.strip().startswith("- [")]
        if checklist_lines:
            markdown = "\n".join(checklist_lines)
            await self._emit(BackendEvent(type="todo_update", todo_markdown=markdown))

    def _emit_swarm_status(self, teammates: list[dict], notifications: list[dict] | None = None) -> None:
        """Emit a swarm_status event synchronously (schedule as coroutine)."""
        import asyncio
        loop = asyncio.get_event_loop()
        loop.create_task(
            self._emit(BackendEvent(type="swarm_status", swarm_teammates=teammates, swarm_notifications=notifications))
        )

    async def _handle_list_sessions(self) -> None:
        import time as _time

        assert self._bundle is not None
        sessions = self._bundle.session_backend.list_snapshots(self._bundle.cwd, limit=None)
        options = []
        for s in sessions:
            ts = _time.strftime("%m/%d %H:%M", _time.localtime(s["created_at"]))
            summary = s.get("summary", "")[:50] or "새 채팅"
            options.append({
                "value": s["session_id"],
                "label": f"{ts}  {s['message_count']}msg  {summary}",
            })
        await self._emit(
            BackendEvent(
                type="select_request",
                modal={"kind": "select", "title": "Resume Session", "command": "resume"},
                select_options=options,
            )
        )

    async def _handle_delete_session(self, session_id: str) -> None:
        assert self._bundle is not None
        session_id = session_id.strip()
        if not session_id:
            await self._emit(BackendEvent(type="error", message="Missing session id"))
            return
        deleted = self._bundle.session_backend.delete_by_id(self._bundle.cwd, session_id)
        if not deleted:
            await self._emit(BackendEvent(type="error", message=f"Session not found: {session_id}"))
            return
        await self._handle_list_sessions()

    async def _handle_set_system_prompt(self, value: str) -> None:
        assert self._bundle is not None
        system_prompt = value.strip()
        if system_prompt:
            self._bundle.settings_overrides["system_prompt"] = system_prompt
        else:
            self._bundle.settings_overrides.pop("system_prompt", None)
        prompt_text = build_runtime_system_prompt(
            self._bundle.current_settings(),
            cwd=self._bundle.cwd,
            latest_user_prompt=None,
            extra_skill_dirs=self._bundle.extra_skill_dirs,
            extra_plugin_roots=self._bundle.extra_plugin_roots,
        )
        self._bundle.engine.set_system_prompt(prompt_text)
        await self._emit(
            BackendEvent(
                type="transcript_item",
                item=TranscriptItem(role="system", text="시스템 프롬프트 설정을 적용했습니다."),
            )
        )

    async def _handle_select_command(self, command_name: str) -> None:
        assert self._bundle is not None
        command = command_name.strip().lstrip("/").lower()
        if command == "resume":
            await self._handle_list_sessions()
            return

        settings = self._bundle.current_settings()
        state = self._bundle.app_state.get()
        _, active_profile = settings.resolve_profile()
        current_model = settings.model

        if command == "provider":
            statuses = AuthManager(settings).get_profile_statuses()
            hidden_profiles = {"copilot", "moonshot", "gemini", "minimax"}
            hidden_providers = {"copilot", "moonshot", "gemini", "minimax"}
            options = [
                {
                    "value": name,
                    "label": info["label"],
                    "description": f"{info['provider']} / {info['auth_source']}" + (" [missing auth]" if not info["configured"] else ""),
                    "active": info["active"],
                }
                for name, info in statuses.items()
                if name not in hidden_profiles and info["provider"] not in hidden_providers
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Provider Profile", "command": "provider"},
                    select_options=options,
                )
            )
            return

        if command == "permissions":
            options = [
                {
                    "value": "default",
                    "label": "Default",
                    "description": "Ask before write/execute operations",
                    "active": settings.permission.mode.value == "default",
                },
                {
                    "value": "full_auto",
                    "label": "Auto",
                    "description": "Allow all tools automatically",
                    "active": settings.permission.mode.value == "full_auto",
                },
                {
                    "value": "plan",
                    "label": "Plan Mode",
                    "description": "Block all write operations",
                    "active": settings.permission.mode.value == "plan",
                },
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Permission Mode", "command": "permissions"},
                    select_options=options,
                )
            )
            return

        if command == "theme":
            options = [
                {
                    "value": name,
                    "label": name,
                    "active": name == settings.theme,
                }
                for name in list_themes()
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Theme", "command": "theme"},
                    select_options=options,
                )
            )
            return

        if command == "output-style":
            options = [
                {
                    "value": style.name,
                    "label": style.name,
                    "description": style.source,
                    "active": style.name == settings.output_style,
                }
                for style in load_output_styles()
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Output Style", "command": "output-style"},
                    select_options=options,
                )
            )
            return

        if command == "effort":
            options = [
                {"value": "none", "label": "Auto", "description": "Use the provider default", "active": settings.effort in {"none", "auto", ""}},
                {"value": "low", "label": "Low", "description": "Fastest responses", "active": settings.effort == "low"},
                {"value": "medium", "label": "Medium", "description": "Balanced reasoning", "active": settings.effort == "medium"},
                {"value": "high", "label": "High", "description": "Deepest reasoning", "active": settings.effort == "high"},
                {"value": "xhigh", "label": "XHigh", "description": "Maximum reasoning", "active": settings.effort in {"xhigh", "max"}},
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Reasoning Effort", "command": "effort"},
                    select_options=options,
                )
            )
            return

        if command == "passes":
            current = int(state.passes or settings.passes)
            options = [
                {"value": str(value), "label": f"{value} pass{'es' if value != 1 else ''}", "active": value == current}
                for value in range(1, 9)
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Reasoning Passes", "command": "passes"},
                    select_options=options,
                )
            )
            return

        if command == "turns":
            current = self._bundle.engine.max_turns
            values = {32, 64, 128, 200, 256, 512}
            if isinstance(current, int):
                values.add(current)
            options = [{"value": "unlimited", "label": "Unlimited", "description": "Do not hard-stop this session", "active": current is None}]
            options.extend(
                {"value": str(value), "label": f"{value} turns", "active": value == current}
                for value in sorted(values)
            )
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Max Turns", "command": "turns"},
                    select_options=options,
                )
            )
            return

        if command == "fast":
            current = bool(state.fast_mode)
            options = [
                {"value": "on", "label": "On", "description": "Prefer shorter, faster responses", "active": current},
                {"value": "off", "label": "Off", "description": "Use normal response mode", "active": not current},
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Fast Mode", "command": "fast"},
                    select_options=options,
                )
            )
            return

        if command == "vim":
            current = bool(state.vim_enabled)
            options = [
                {"value": "on", "label": "On", "description": "Enable Vim keybindings", "active": current},
                {"value": "off", "label": "Off", "description": "Use standard keybindings", "active": not current},
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Vim Mode", "command": "vim"},
                    select_options=options,
                )
            )
            return

        if command == "voice":
            current = bool(state.voice_enabled)
            options = [
                {"value": "on", "label": "On", "description": state.voice_reason or "Enable voice mode", "active": current},
                {"value": "off", "label": "Off", "description": "Disable voice mode", "active": not current},
            ]
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Voice Mode", "command": "voice"},
                    select_options=options,
                )
            )
            return

        if command == "model":
            options = self._model_select_options(current_model, active_profile.provider, active_profile.allowed_models)
            await self._emit(
                BackendEvent(
                    type="select_request",
                    modal={"kind": "select", "title": "Model", "command": "model"},
                    select_options=options,
                )
            )
            return

        await self._emit(BackendEvent(type="error", message=f"No selector available for /{command}"))

    def _model_select_options(self, current_model: str, provider: str, allowed_models: list[str] | None = None) -> list[dict[str, object]]:
        if allowed_models:
            return [
                {
                    "value": value,
                    "label": value,
                    "description": "Allowed for this profile",
                    "active": value == current_model,
                }
                for value in allowed_models
            ]
        provider_name = provider.lower()
        if provider_name in {"anthropic", "anthropic_claude"}:
            resolved_current = resolve_model_setting(current_model, provider_name)
            return [
                {
                    "value": value,
                    "label": label,
                    "description": description,
                    "active": value == current_model
                    or resolve_model_setting(value, provider_name) == resolved_current,
                }
                for value, label, description in CLAUDE_MODEL_ALIAS_OPTIONS
            ]
        families: list[tuple[str, str]] = []
        if provider_name == "pgpt":
            families.extend(
                [
                    ("gpt-5.4", "P-GPT GPT-5.4"),
                    ("gpt-5.4-mini", "P-GPT GPT-5.4 mini"),
                    ("gpt-5.4-nano", "P-GPT GPT-5.4 nano"),
                ]
            )
        elif provider_name in {"openai-codex", "openai", "openai-compatible", "openrouter", "github_copilot"}:
            families.extend(
                [
                    ("gpt-5.5", "OpenAI flagship"),
                    ("gpt-5.4", "Previous GPT-5.4"),
                    ("gpt-5", "General GPT-5"),
                    ("gpt-4.1", "Stable GPT-4.1"),
                    ("o4-mini", "Fast reasoning"),
                ]
            )
        elif provider_name in {"moonshot", "moonshot-compatible"}:
            families.extend(
                [
                    ("kimi-k2.5", "Moonshot K2.5"),
                    ("kimi-k2-turbo-preview", "Faster Moonshot"),
                ]
            )
        elif provider_name == "dashscope":
            families.extend(
                [
                    ("qwen3.5-flash", "Fast Qwen"),
                    ("qwen3-max", "Strong Qwen"),
                    ("deepseek-r1", "Reasoning model"),
                ]
            )
        elif provider_name == "gemini":
            families.extend(
                [
                    ("gemini-2.5-pro", "Gemini Pro"),
                    ("gemini-2.5-flash", "Gemini Flash"),
                ]
            )
        elif provider_name == "minimax":
            families.extend(
                [
                    ("MiniMax-M2.7", "MiniMax flagship"),
                    ("MiniMax-M2.7-highspeed", "MiniMax fast"),
                ]
            )
        seen: set[str] = set()
        options: list[dict[str, object]] = []
        for value, description in [(current_model, "Current model"), *families]:
            if not value or value in seen:
                continue
            seen.add(value)
            options.append(
                {
                    "value": value,
                    "label": value,
                    "description": description,
                    "active": value == current_model,
                }
            )
        return options

    async def _ask_permission(self, tool_name: str, reason: str) -> bool:
        async with self._permission_lock:
            request_id = uuid4().hex
            future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
            self._permission_requests[request_id] = future
            await self._emit(
                BackendEvent(
                    type="modal_request",
                    modal={
                        "kind": "permission",
                        "request_id": request_id,
                        "tool_name": tool_name,
                        "reason": reason,
                    },
                )
            )
            try:
                return await asyncio.wait_for(future, timeout=300)
            except asyncio.TimeoutError:
                log.warning("Permission request %s timed out after 300s, denying", request_id)
                return False
            finally:
                self._permission_requests.pop(request_id, None)

    async def _ask_question(self, question: str) -> str:
        request_id = uuid4().hex
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._question_requests[request_id] = future
        await self._emit(
            BackendEvent(
                type="modal_request",
                modal={
                    "kind": "question",
                    "request_id": request_id,
                    "question": question,
                },
            )
        )
        try:
            return await future
        finally:
            self._question_requests.pop(request_id, None)

    async def _emit(self, event: BackendEvent) -> None:
        log.debug("emit event: type=%s tool=%s", event.type, getattr(event, "tool_name", None))
        async with self._write_lock:
            payload = _PROTOCOL_PREFIX + event.model_dump_json() + "\n"
            buffer = getattr(sys.stdout, "buffer", None)
            if buffer is not None:
                buffer.write(payload.encode("utf-8"))
                buffer.flush()
                return
            sys.stdout.write(payload)
            sys.stdout.flush()


async def run_backend_host(
    *,
    model: str | None = None,
    max_turns: int | None = None,
    base_url: str | None = None,
    system_prompt: str | None = None,
    api_key: str | None = None,
    api_format: str | None = None,
    active_profile: str | None = None,
    effort: str | None = None,
    cwd: str | None = None,
    api_client: SupportsStreamingMessages | None = None,
    restore_messages: list[dict] | None = None,
    restore_tool_metadata: dict[str, object] | None = None,
    enforce_max_turns: bool = True,
    permission_mode: str | None = None,
    session_backend: SessionBackend | None = None,
    extra_skill_dirs: tuple[str | Path, ...] = (),
    extra_plugin_roots: tuple[str | Path, ...] = (),
) -> int:
    """Run the structured React backend host."""
    if cwd:
        os.chdir(cwd)
    host = ReactBackendHost(
        BackendHostConfig(
            model=model,
            max_turns=max_turns,
            base_url=base_url,
            system_prompt=system_prompt,
            api_key=api_key,
            api_format=api_format,
            active_profile=active_profile,
            effort=effort,
            api_client=api_client,
            cwd=cwd,
            restore_messages=restore_messages,
            restore_tool_metadata=restore_tool_metadata,
            enforce_max_turns=enforce_max_turns,
            permission_mode=permission_mode,
            session_backend=session_backend,
            extra_skill_dirs=tuple(str(Path(path).expanduser().resolve()) for path in extra_skill_dirs),
            extra_plugin_roots=tuple(str(Path(path).expanduser().resolve()) for path in extra_plugin_roots),
        )
    )
    return await host.run()


__all__ = ["run_backend_host", "ReactBackendHost", "BackendHostConfig"]
