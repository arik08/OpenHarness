"""Tests for background task management."""

from __future__ import annotations

import asyncio
import shlex
import sys
from pathlib import Path

import pytest

from myharness.tasks.manager import BackgroundTaskManager


def _python_stdout_command(text: str) -> str:
    code = f"import sys; sys.stdout.write({text!r})"
    if sys.platform == "win32":
        return f"& {sys.executable!r} -c {code!r}"
    return f"{shlex.quote(sys.executable)} -c {shlex.quote(code)}"


def _python_stdin_echo_command() -> str:
    code = "import sys; line=sys.stdin.readline().rstrip('\\n'); print('got:' + line)"
    if sys.platform == "win32":
        return f"& {sys.executable!r} -u -c {code!r}"
    return f"{shlex.quote(sys.executable)} -u -c {shlex.quote(code)}"


@pytest.mark.asyncio
async def test_create_shell_task_and_read_output(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    task = await manager.create_shell_task(
        command=_python_stdout_command("hello task"),
        description="hello",
        cwd=tmp_path,
    )

    await asyncio.wait_for(manager._waiters[task.id], timeout=5)  # type: ignore[attr-defined]
    updated = manager.get_task(task.id)
    assert updated is not None
    assert updated.status == "completed"
    assert "hello task" in manager.read_task_output(task.id)


@pytest.mark.asyncio
async def test_create_agent_task_with_command_override_and_write(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    task = await manager.create_agent_task(
        prompt="first",
        description="agent",
        cwd=tmp_path,
        command=_python_stdin_echo_command(),
    )

    await asyncio.wait_for(manager._waiters[task.id], timeout=5)  # type: ignore[attr-defined]
    assert "got:first" in manager.read_task_output(task.id)


@pytest.mark.asyncio
async def test_write_to_stopped_agent_task_restarts_process(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    task = await manager.create_agent_task(
        prompt="ready",
        description="agent",
        cwd=tmp_path,
        command=_python_stdin_echo_command(),
    )
    await asyncio.wait_for(manager._waiters[task.id], timeout=5)  # type: ignore[attr-defined]

    await manager.write_to_task(task.id, "follow-up")
    await asyncio.wait_for(manager._waiters[task.id], timeout=5)  # type: ignore[attr-defined]

    output = manager.read_task_output(task.id)
    assert "got:ready" in output
    assert "got:follow-up" in output
    updated = manager.get_task(task.id)
    assert updated is not None
    assert updated.metadata["restart_count"] == "1"


@pytest.mark.asyncio
async def test_stop_task(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    task = await manager.create_shell_task(
        command="sleep 30",
        description="sleeper",
        cwd=tmp_path,
    )
    await manager.stop_task(task.id)
    updated = manager.get_task(task.id)
    assert updated is not None
    assert updated.status == "killed"


@pytest.mark.asyncio
async def test_read_task_output_returns_empty_string_when_log_file_is_missing(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    task = await manager.create_shell_task(
        command=_python_stdout_command("short lived"),
        description="missing output",
        cwd=tmp_path,
    )
    await asyncio.wait_for(manager._waiters[task.id], timeout=5)  # type: ignore[attr-defined]
    task.output_file.unlink()

    assert manager.read_task_output(task.id) == ""


@pytest.mark.asyncio
async def test_read_task_output_returns_empty_string_for_non_positive_max_bytes(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    task = await manager.create_shell_task(
        command=_python_stdout_command("visible output"),
        description="zero tail",
        cwd=tmp_path,
    )
    await asyncio.wait_for(manager._waiters[task.id], timeout=5)  # type: ignore[attr-defined]

    assert manager.read_task_output(task.id, max_bytes=0) == ""
    assert manager.read_task_output(task.id, max_bytes=-1) == ""


@pytest.mark.asyncio
async def test_create_shell_task_marks_record_failed_when_process_start_fails(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()

    with pytest.raises(OSError):
        await manager.create_shell_task(
            command=_python_stdout_command("never starts"),
            description="bad cwd",
            cwd=tmp_path / "missing",
        )

    tasks = manager.list_tasks()
    assert len(tasks) == 1
    assert tasks[0].status == "failed"
    assert tasks[0].ended_at is not None
    assert tasks[0].metadata["start_error"]


@pytest.mark.asyncio
async def test_start_failure_notifies_completion_listener(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()
    seen: list[tuple[str, str]] = []

    def _listener(task):
        seen.append((task.description, task.status))

    manager.register_completion_listener(_listener)

    with pytest.raises(OSError):
        await manager.create_shell_task(
            command=_python_stdout_command("never starts"),
            description="bad cwd",
            cwd=tmp_path / "missing",
        )

    assert seen == [("bad cwd", "failed")]


@pytest.mark.asyncio
async def test_completion_listener_fires_when_task_finishes(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()
    seen: list[tuple[str, str, int | None]] = []
    done = asyncio.Event()

    async def _listener(task):
        seen.append((task.id, task.status, task.return_code))
        done.set()

    manager.register_completion_listener(_listener)

    task = await manager.create_shell_task(
        command=_python_stdout_command("done"),
        description="listener",
        cwd=tmp_path,
    )

    await asyncio.wait_for(done.wait(), timeout=5)

    assert seen == [(task.id, "completed", 0)]


@pytest.mark.asyncio
async def test_completion_listener_sees_killed_status_for_stopped_task(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    manager = BackgroundTaskManager()
    seen: list[tuple[str, str]] = []
    done = asyncio.Event()

    def _listener(task):
        seen.append((task.id, task.status))
        done.set()

    manager.register_completion_listener(_listener)

    task = await manager.create_shell_task(
        command="sleep 30",
        description="listener stop",
        cwd=tmp_path,
    )

    await manager.stop_task(task.id)
    await asyncio.wait_for(done.wait(), timeout=5)

    assert seen == [(task.id, "killed")]
