"""Tests for the React backend host protocol."""

from __future__ import annotations

import asyncio
import io
import json
from types import SimpleNamespace

import pytest

from myharness.api.client import ApiMessageCompleteEvent
from myharness.api.usage import UsageSnapshot
from myharness.engine.stream_events import (
    AssistantTextDelta,
    CompactProgressEvent,
    ToolExecutionCompleted,
    ToolExecutionStarted,
    ToolInputDelta,
)
from myharness.engine.messages import ConversationMessage, TextBlock
from myharness.ui.backend_host import BackendHostConfig, ReactBackendHost, run_backend_host
from myharness.ui.protocol import BackendEvent
from myharness.ui.runtime import build_runtime, close_runtime, start_runtime


class StaticApiClient:
    """Fake streaming client for backend host tests."""

    def __init__(self, text: str) -> None:
        self._text = text

    async def stream_message(self, request):
        del request
        yield ApiMessageCompleteEvent(
            message=ConversationMessage(role="assistant", content=[TextBlock(text=self._text)]),
            usage=UsageSnapshot(input_tokens=2, output_tokens=3),
            stop_reason=None,
        )


class SequencedApiClient:
    """Fake streaming client that returns one complete message per call."""

    def __init__(self, texts: list[str]) -> None:
        self._texts = list(texts)
        self.requests = []

    async def stream_message(self, request):
        self.requests.append(request)
        text = self._texts.pop(0)
        yield ApiMessageCompleteEvent(
            message=ConversationMessage(role="assistant", content=[TextBlock(text=text)]),
            usage=UsageSnapshot(input_tokens=2, output_tokens=3),
            stop_reason=None,
        )


class FailingApiClient:
    """Fake client that triggers the query-loop ErrorEvent path."""

    def __init__(self, message: str) -> None:
        self._message = message

    async def stream_message(self, request):
        del request
        if False:
            yield None
        raise RuntimeError(self._message)


class FakeBinaryStdout:
    """Capture protocol writes through a binary stdout buffer."""

    def __init__(self) -> None:
        self.buffer = io.BytesIO()

    def flush(self) -> None:
        return None


@pytest.mark.asyncio
async def test_run_backend_host_accepts_permission_mode(monkeypatch):
    captured: dict[str, str | None] = {}

    async def _fake_run(self):
        captured["permission_mode"] = self._config.permission_mode
        return 0

    monkeypatch.setattr("myharness.ui.backend_host.ReactBackendHost.run", _fake_run)

    result = await run_backend_host(
        api_client=StaticApiClient("unused"),
        permission_mode="full_auto",
    )

    assert result == 0
    assert captured["permission_mode"] == "full_auto"


@pytest.mark.asyncio
async def test_read_requests_resolves_permission_response_without_queueing(monkeypatch):
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    fut = asyncio.get_running_loop().create_future()
    host._permission_requests["req-1"] = fut

    payload = b'{"type":"permission_response","request_id":"req-1","allowed":true}\n'

    class _FakeBuffer:
        def __init__(self):
            self._reads = 0

        def readline(self):
            self._reads += 1
            if self._reads == 1:
                return payload
            return b""

    class _FakeStdin:
        buffer = _FakeBuffer()

    monkeypatch.setattr("myharness.ui.backend_host.sys.stdin", _FakeStdin())

    await host._read_requests()

    assert fut.done()
    assert fut.result() is True
    queued = await host._request_queue.get()
    assert queued.type == "shutdown"
    assert host._request_queue.empty()


@pytest.mark.asyncio
async def test_read_requests_queues_steering_line_while_busy(monkeypatch):
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._busy = True
    events: list[BackendEvent] = []

    async def _emit(event: BackendEvent) -> None:
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    payload = b'{"type":"steer_line","line":"make it shorter"}\n'

    class _FakeBuffer:
        def __init__(self):
            self._reads = 0

        def readline(self):
            self._reads += 1
            if self._reads == 1:
                return payload
            return b""

    class _FakeStdin:
        buffer = _FakeBuffer()

    monkeypatch.setattr("myharness.ui.backend_host.sys.stdin", _FakeStdin())

    await host._read_requests()

    assert await host._steering_queue.get() == "make it shorter"
    assert any(
        event.type == "transcript_item"
        and event.item
        and event.item.role == "user"
        and event.item.kind == "steering"
        for event in events
    )
    assert any(event.type == "status" and "스티어링" in (event.message or "") for event in events)
    queued = await host._request_queue.get()
    assert queued.type == "shutdown"
    assert host._request_queue.empty()


@pytest.mark.asyncio
async def test_read_requests_queues_line_after_busy_turn(monkeypatch):
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._busy = True
    events: list[BackendEvent] = []

    async def _emit(event: BackendEvent) -> None:
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    payload = b'{"type":"queue_line","line":"next question"}\n'

    class _FakeBuffer:
        def __init__(self):
            self._reads = 0

        def readline(self):
            self._reads += 1
            if self._reads == 1:
                return payload
            return b""

    class _FakeStdin:
        buffer = _FakeBuffer()

    monkeypatch.setattr("myharness.ui.backend_host.sys.stdin", _FakeStdin())

    await host._read_requests()

    assert await host._queued_line_queue.get() == "next question"
    assert any(
        event.type == "transcript_item"
        and event.item
        and event.item.role == "user"
        and event.item.kind == "queued"
        for event in events
    )
    assert any(event.type == "status" and "대기열" in (event.message or "") for event in events)
    queued = await host._request_queue.get()
    assert queued.type == "shutdown"
    assert host._request_queue.empty()


@pytest.mark.asyncio
async def test_promote_next_queued_line_submits_after_current_turn():
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    events: list[BackendEvent] = []

    async def _emit(event: BackendEvent) -> None:
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await host._queued_line_queue.put("follow up")

    await host._promote_next_queued_line()

    queued = await host._request_queue.get()
    assert queued.type == "submit_line"
    assert queued.line == "follow up"
    assert queued.suppress_user_transcript is True
    assert any(event.type == "status" and "전송" in (event.message or "") for event in events)


@pytest.mark.asyncio
async def test_backend_host_processes_command(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("/version")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert any(event.type == "transcript_item" and event.item and event.item.role == "user" for event in events)
    assert any(
        event.type == "transcript_item"
        and event.item
        and event.item.role == "system"
        and "MyHarness" in event.item.text
        for event in events
    )
    assert any(event.type == "state_snapshot" for event in events)


@pytest.mark.asyncio
async def test_backend_host_processes_model_turn(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("hello from react backend")))
    host._bundle = await build_runtime(api_client=StaticApiClient("hello from react backend"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("hi")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert any(
        event.type == "assistant_complete" and event.message == "hello from react backend"
        for event in events
    )
    assert any(
        event.type == "assistant_complete"
        and event.item
        and event.item.role == "assistant"
        and "hello from react backend" in event.item.text
        for event in events
    )


@pytest.mark.asyncio
async def test_backend_host_enqueues_completed_async_agent_notification(monkeypatch):
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    metadata = {
        "async_agent_tasks": [
            {
                "agent_id": "worker@default",
                "task_id": "local_agent_123",
                "description": "Inspect CI",
                "notification_sent": False,
            }
        ]
    }
    host._bundle = SimpleNamespace(engine=SimpleNamespace(tool_metadata=metadata))
    events: list[BackendEvent] = []

    async def _emit(event: BackendEvent) -> None:
        events.append(event)

    class _FakeTaskManager:
        def get_task(self, task_id):
            assert task_id == "local_agent_123"
            return SimpleNamespace(status="completed", return_code=0)

        def read_task_output(self, task_id, *, max_bytes=12000):
            assert task_id == "local_agent_123"
            assert max_bytes == 8000
            return "worker result <ready>"

    monkeypatch.setattr("myharness.ui.backend_host.is_coordinator_mode", lambda: True)
    monkeypatch.setattr("myharness.ui.async_agents.get_task_manager", lambda: _FakeTaskManager())
    host._emit = _emit  # type: ignore[method-assign]

    host._ensure_async_agent_monitor()

    assert host._async_agent_monitor_task is not None
    await asyncio.wait_for(host._async_agent_monitor_task, timeout=1)
    request = await asyncio.wait_for(host._request_queue.get(), timeout=1)

    assert request.type == "submit_line"
    assert request.suppress_user_transcript is True
    assert request.line is not None
    assert "<task-notification>" in request.line
    assert "worker@default" in request.line
    assert "worker result &lt;ready&gt;" in request.line
    assert metadata["async_agent_tasks"][0]["notification_sent"] is True
    assert any(event.type == "status" and "결과" in (event.message or "") for event in events)


@pytest.mark.asyncio
async def test_backend_host_emits_title_before_answer_stream(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("피자 추천")))
    host._bundle = await build_runtime(api_client=StaticApiClient("피자 추천"))
    events = []

    async def _emit(event):
        events.append(event)

    async def _fake_handle_line(bundle, line, print_system, render_event, clear_output):
        del bundle, line, print_system, clear_output
        await render_event(AssistantTextDelta(text="답변 시작"))
        return True

    monkeypatch.setattr("myharness.ui.backend_host.handle_line", _fake_handle_line)
    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("서울 피자 맛집 추천해줘")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    event_types = [event.type for event in events]
    assert event_types.index("session_title") < event_types.index("assistant_delta")
    assert next(event for event in events if event.type == "session_title").message == "서울 피자 맛집 추천"


@pytest.mark.asyncio
async def test_backend_host_refines_initial_title_once_from_early_conversation(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    client = SequencedApiClient([
        "첫 답변입니다",
        "초기 제품 전략 보고서",
        "두 번째 답변입니다",
    ])
    host = ReactBackendHost(BackendHostConfig(api_client=client))
    host._bundle = await build_runtime(api_client=client)
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._process_line("초기 제품 전략 정리해줘")
        await host._process_line("완전히 다른 주제로 오늘 날씨 알려줘")
    finally:
        await close_runtime(host._bundle)

    title_events = [event.message for event in events if event.type == "session_title"]
    assert title_events == ["초기 제품 전략", "초기 제품 전략 보고서"]
    assert host._bundle.engine.tool_metadata["session_title_source"] == "conversation"
    assert len(client.requests) == 3
    assert "Create a short chat history title" in client.requests[1].messages[0].text


@pytest.mark.asyncio
async def test_backend_host_persists_user_edited_session_title(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        host._set_saved_session_id("abc123")
        host._bundle.engine.load_messages([
            ConversationMessage(role="user", content=[TextBlock(text="삼성전자 보고서 만들어줘")]),
        ])
        await host._handle_update_session_title("내가 정한 제목")
        snapshot = host._bundle.session_backend.load_by_id(host._bundle.cwd, "abc123")
    finally:
        await close_runtime(host._bundle)

    assert snapshot is not None
    assert snapshot["summary"] == "내가 정한 제목"
    assert snapshot["tool_metadata"]["session_title_user_edited"] is True
    assert any(event.type == "session_title" and event.message == "내가 정한 제목" for event in events)


@pytest.mark.asyncio
async def test_backend_host_forces_skill_from_dollar_prefix(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    skill_dir = tmp_path / "config" / "skills" / "review-pr"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: review-pr\ndescription: Review pull requests.\n---\n\n# Review PR\n",
        encoding="utf-8",
    )

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    captured: dict[str, str] = {}

    async def _emit(_event):
        return None

    async def _fake_handle_line(bundle, line, print_system, render_event, clear_output):
        del bundle, print_system, render_event, clear_output
        captured["line"] = line
        return True

    monkeypatch.setattr("myharness.ui.backend_host.handle_line", _fake_handle_line)
    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("$review-pr inspect this branch")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert "explicitly selected the `review-pr` skill" in captured["line"]
    assert "# Selected Skill Content" in captured["line"]
    assert "# Review PR" in captured["line"]
    assert "inspect this branch" in captured["line"]


@pytest.mark.asyncio
async def test_backend_host_emits_compact_progress_event(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    async def _fake_handle_line(bundle, line, print_system, render_event, clear_output):
        del bundle, line, print_system, clear_output
        await render_event(
            CompactProgressEvent(
                phase="compact_start",
                trigger="auto",
                message="Compacting conversation memory.",
                checkpoint="compact_start",
                metadata={"token_count": 12345},
            )
        )
        return True

    monkeypatch.setattr("myharness.ui.backend_host.handle_line", _fake_handle_line)
    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("hi")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert any(
        event.type == "compact_progress"
        and event.compact_phase == "compact_start"
        and event.compact_checkpoint == "compact_start"
        and event.compact_metadata == {"token_count": 12345}
        for event in events
    )


@pytest.mark.asyncio
async def test_backend_host_emits_tool_progress_heartbeat(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("myharness.ui.backend_host._TOOL_PROGRESS_FIRST_DELAY_SECONDS", 0.01)
    monkeypatch.setattr("myharness.ui.backend_host._TOOL_PROGRESS_INTERVAL_SECONDS", 0.01)

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    async def _fake_handle_line(bundle, line, print_system, render_event, clear_output):
        del bundle, line, print_system, clear_output
        await render_event(ToolExecutionStarted(tool_name="bash", tool_input={"command": "python make_deck.py"}))
        await asyncio.sleep(0.035)
        await render_event(ToolExecutionCompleted(tool_name="bash", output="done", is_error=False))
        return True

    monkeypatch.setattr("myharness.ui.backend_host.handle_line", _fake_handle_line)
    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("make pptx")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert any(
        event.type == "tool_progress"
        and event.tool_name == "bash"
        and "명령 실행 중" in (event.message or "")
        for event in events
    )


@pytest.mark.asyncio
async def test_backend_host_emits_tool_input_delta(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    async def _fake_handle_line(bundle, line, print_system, render_event, clear_output):
        del bundle, line, print_system, clear_output
        await render_event(
            ToolInputDelta(
                index=0,
                name="write_file",
                arguments_delta='{"path":"notes.md","content":"hello',
            )
        )
        await render_event(
            ToolExecutionStarted(
                tool_name="write_file",
                tool_input={"path": "notes.md", "content": "hello"},
            )
        )
        await render_event(
            ToolExecutionCompleted(tool_name="write_file", output="Wrote notes.md", is_error=False)
        )
        return True

    monkeypatch.setattr("myharness.ui.backend_host.handle_line", _fake_handle_line)
    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("write notes")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    event = next(item for item in events if item.type == "tool_input_delta")
    assert event.tool_name == "write_file"
    assert event.arguments_delta == '{"path":"notes.md","content":"hello'


@pytest.mark.asyncio
async def test_backend_host_emits_todo_update_from_todo_write(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    async def _fake_handle_line(bundle, line, print_system, render_event, clear_output):
        del bundle, line, print_system, clear_output
        await render_event(
            ToolExecutionStarted(
                tool_name="todo_write",
                tool_input={
                    "persist": False,
                    "todos": [
                        {"text": "read code", "checked": True},
                        {"text": "run tests", "checked": False},
                    ],
                },
            )
        )
        await render_event(
            ToolExecutionCompleted(
                tool_name="todo_write",
                output="- [x] read code\n- [ ] run tests",
                is_error=False,
            )
        )
        return True

    monkeypatch.setattr("myharness.ui.backend_host.handle_line", _fake_handle_line)
    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("do a complex task")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert any(
        event.type == "todo_update"
        and event.todo_markdown == "- [x] read code\n- [ ] run tests"
        for event in events
    )


@pytest.mark.asyncio
async def test_backend_host_surfaces_query_errors(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=FailingApiClient("rate limit")))
    host._bundle = await build_runtime(api_client=FailingApiClient("rate limit"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._process_line("hi")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    assert any(event.type == "error" and "rate limit" in event.message for event in events)
    assert any(
        event.type == "transcript_item"
        and event.item
        and event.item.role == "system"
        and "rate limit" in event.item.text
        for event in events
    )


@pytest.mark.asyncio
async def test_backend_host_command_does_not_reset_cli_overrides(tmp_path, monkeypatch):
    """Regression: slash commands should not snap model/provider back to persisted defaults.

    When the session is launched with CLI overrides (e.g. --provider openai -m 5.4),
    issuing a command like /fast triggers a UI state refresh. That refresh must
    preserve the effective session settings, not reload ~/.myharness/settings.json
    verbatim.
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(
        api_client=StaticApiClient("unused"),
        model="5.4",
        api_format="openai",
    )
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        # Sanity: the initial session state reflects CLI overrides.
        assert host._bundle.app_state.get().model == "5.4"
        assert host._bundle.app_state.get().provider == "openai-compatible"

        # Run a command that triggers sync_app_state.
        await host._process_line("/fast show")

        # CLI overrides should remain in effect.
        assert host._bundle.app_state.get().model == "5.4"
        assert host._bundle.app_state.get().provider == "openai-compatible"
    finally:
        await close_runtime(host._bundle)


@pytest.mark.asyncio
async def test_backend_host_uses_effective_model_from_env_override(tmp_path, monkeypatch):
    """Regression: header model should reflect effective env override, not stale profile last_model."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("MYHARNESS_MODEL", "minimax-m1")

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        assert host._bundle.app_state.get().model == "minimax-m1"

        # Exercise sync_app_state through a slash command refresh path.
        await host._process_line("/fast show")
        assert host._bundle.app_state.get().model == "minimax-m1"
    finally:
        await close_runtime(host._bundle)


@pytest.mark.asyncio
async def test_backend_host_plan_toggle_survives_state_sync(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(
        api_client=StaticApiClient("unused"),
        permission_mode="full_auto",
    )
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._process_line("/plan")

        assert host._bundle.app_state.get().permission_mode == "plan"
        assert host._bundle.app_state.get().plan_previous_permission_mode == "full_auto"
        assert any(
            event.type == "state_snapshot"
            and event.state
            and event.state.get("permission_mode") == "Plan Mode"
            for event in events
        )

        await host._process_line("/plan")

        assert host._bundle.app_state.get().permission_mode == "full_auto"
        assert host._bundle.app_state.get().plan_previous_permission_mode == ""
        assert any(
            event.type == "state_snapshot"
            and event.state
            and event.state.get("permission_mode") == "Auto"
            for event in events
        )
    finally:
        await close_runtime(host._bundle)


@pytest.mark.asyncio
async def test_build_runtime_leaves_interactive_sessions_unbounded_by_default(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    bundle = await build_runtime(
        api_client=StaticApiClient("unused"),
        enforce_max_turns=False,
    )
    try:
        assert bundle.engine.max_turns is None
        assert bundle.enforce_max_turns is False
    finally:
        await close_runtime(bundle)


@pytest.mark.asyncio
async def test_backend_host_emits_utf8_protocol_bytes(monkeypatch):
    host = ReactBackendHost(BackendHostConfig())
    fake_stdout = FakeBinaryStdout()
    monkeypatch.setattr("myharness.ui.backend_host.sys.stdout", fake_stdout)

    await host._emit(BackendEvent(type="assistant_delta", message="你好😊"))

    raw = fake_stdout.buffer.getvalue()
    assert raw.startswith(b"OHJSON:")
    decoded = raw.decode("utf-8").strip()
    payload = json.loads(decoded.removeprefix("OHJSON:"))
    assert payload["type"] == "assistant_delta"
    assert payload["message"] == "你好😊"


@pytest.mark.asyncio
async def test_backend_host_emits_model_select_request(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"), model="opus", api_format="anthropic")
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._handle_select_command("model")
    finally:
        await close_runtime(host._bundle)

    event = next(item for item in events if item.type == "select_request")
    assert event.modal["command"] == "model"
    assert any(option["value"] == "opus" and option.get("active") for option in event.select_options)
    assert any(option["value"] == "default" for option in event.select_options)


@pytest.mark.asyncio
async def test_backend_host_emits_theme_select_request(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._handle_select_command("theme")
    finally:
        await close_runtime(host._bundle)

    event = next(item for item in events if item.type == "select_request")
    assert event.modal["command"] == "theme"
    assert any(option["value"] == "default" for option in event.select_options)


@pytest.mark.asyncio
async def test_backend_host_emits_turns_select_request_with_unlimited_option(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"), enforce_max_turns=False)
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._handle_select_command("turns")
    finally:
        await close_runtime(host._bundle)

    event = next(item for item in events if item.type == "select_request")
    assert event.modal["command"] == "turns"
    assert any(option["value"] == "unlimited" and option.get("active") for option in event.select_options)


@pytest.mark.asyncio
async def test_backend_host_emits_provider_select_request(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._handle_select_command("provider")
    finally:
        await close_runtime(host._bundle)

    event = next(item for item in events if item.type == "select_request")
    assert event.modal["command"] == "provider"
    assert any(option["value"] == "p-gpt" and option.get("active") for option in event.select_options)


@pytest.mark.asyncio
async def test_backend_host_emits_runtime_picker_bundle(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        await host._handle_select_command("runtime-picker")
    finally:
        await close_runtime(host._bundle)

    event = next(item for item in events if item.type == "select_request")
    assert event.modal["command"] == "runtime-picker"
    runtime_options = event.modal["runtime_options"]
    active_provider = next(option["value"] for option in runtime_options["providers"] if option.get("active"))
    assert runtime_options["models_by_provider"][active_provider]
    assert [option["value"] for option in runtime_options["models_by_provider"]["p-gpt"]][:2] == ["gpt-5.5", "gpt-5.4"]
    assert runtime_options["models_by_provider"]["p-gpt"][0]["description"] == "Strongest coding and reasoning"
    assert any(option["value"] == "low" for option in runtime_options["efforts"])
    none_option = next(option for option in runtime_options["efforts"] if option["value"] == "none")
    assert none_option["label"] == "None"


@pytest.mark.asyncio
async def test_backend_host_apply_select_command_shows_single_segment_transcript(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._apply_select_command("theme", "default")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    user_event = next(item for item in events if item.type == "transcript_item" and item.item and item.item.role == "user")
    assert user_event.item.text == "/theme"


@pytest.mark.asyncio
async def test_backend_host_apply_provider_select_command_shows_single_segment_transcript(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))

    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    host._bundle = await build_runtime(api_client=StaticApiClient("unused"))
    events = []

    async def _emit(event):
        events.append(event)

    host._emit = _emit  # type: ignore[method-assign]
    await start_runtime(host._bundle)
    try:
        should_continue = await host._apply_select_command("provider", "claude-api")
    finally:
        await close_runtime(host._bundle)

    assert should_continue is True
    user_event = next(item for item in events if item.type == "transcript_item" and item.item and item.item.role == "user")
    assert user_event.item.text == "/provider"


@pytest.mark.asyncio
async def test_concurrent_ask_permission_are_serialised():
    """Concurrent _ask_permission calls must be serialised so the frontend
    never receives two overlapping modal_request events.

    Without _permission_lock the second call emits a modal_request before the
    first future is resolved, overwriting the frontend's modal state. The first
    tool then silently waits 300 s and gets Permission denied.
    """
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))

    emitted_order: list[str] = []

    async def _fake_emit(event: BackendEvent) -> None:
        if event.type == "modal_request" and event.modal:
            emitted_order.append(str(event.modal.get("request_id", "")))

    host._emit = _fake_emit  # type: ignore[method-assign]

    async def _ask_and_approve(tool: str) -> bool:
        # Start the ask; a background task resolves the future once it appears.
        async def _resolver():
            # Busy-wait until this tool's future is registered.
            while True:
                await asyncio.sleep(0)
                for rid, fut in list(host._permission_requests.items()):
                    if not fut.done():
                        fut.set_result(True)
                        return

        asyncio.create_task(_resolver())
        return await host._ask_permission(tool, "reason")

    # Fire two permission requests concurrently.
    result_a, result_b = await asyncio.gather(
        _ask_and_approve("write_file"),
        _ask_and_approve("bash"),
    )

    assert result_a is True
    assert result_b is True
    # With the lock in place the two modal_request events must be emitted
    # sequentially (one completes before the other starts), so exactly two
    # distinct request IDs must have been emitted.
    assert len(emitted_order) == 2
    assert emitted_order[0] != emitted_order[1]


@pytest.mark.asyncio
async def test_ask_question_emits_structured_choices():
    host = ReactBackendHost(BackendHostConfig(api_client=StaticApiClient("unused")))
    events: list[BackendEvent] = []

    async def _fake_emit(event: BackendEvent) -> None:
        events.append(event)
        if event.type == "modal_request" and event.modal:
            request_id = str(event.modal.get("request_id", ""))
            future = host._question_requests[request_id]
            future.set_result("green")

    host._emit = _fake_emit  # type: ignore[method-assign]

    answer = await host._ask_question(
        "Which color?",
        choices=[
            {"label": "Green", "value": "green", "description": "Use the green theme"},
            {"label": "Blue", "value": "blue"},
        ],
    )

    assert answer == "green"
    event = next(item for item in events if item.type == "modal_request" and item.modal)
    assert event.modal["choices"] == [
        {"value": "green", "label": "Green", "description": "Use the green theme"},
        {"value": "blue", "label": "Blue", "description": ""},
    ]
