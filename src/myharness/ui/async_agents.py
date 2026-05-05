"""Helpers for surfacing completed async agent tasks back to a session."""

from __future__ import annotations

import asyncio
from pathlib import Path

from myharness.coordinator.coordinator_mode import (
    TaskNotification,
    format_task_notification,
)
from myharness.config.paths import get_tasks_dir
from myharness.tasks.manager import get_task_manager


TERMINAL_TASK_STATUSES = frozenset({"completed", "failed", "killed"})


def async_agent_task_entries(tool_metadata: dict[str, object] | None) -> list[dict[str, object]]:
    if not isinstance(tool_metadata, dict):
        return []
    value = tool_metadata.get("async_agent_tasks")
    if not isinstance(value, list):
        return []
    return [entry for entry in value if isinstance(entry, dict)]


def pending_async_agent_entries(tool_metadata: dict[str, object] | None) -> list[dict[str, object]]:
    pending: list[dict[str, object]] = []
    for entry in async_agent_task_entries(tool_metadata):
        task_id = str(entry.get("task_id") or "").strip()
        if not task_id:
            continue
        if bool(entry.get("notification_sent")):
            continue
        pending.append(entry)
    return pending


def build_async_task_summary(
    entry: dict[str, object],
    *,
    task_status: str,
    return_code: int | None,
) -> str:
    description = str(entry.get("description") or entry.get("agent_id") or "background task").strip()
    if task_status == "completed":
        return f'Agent "{description}" completed'
    if task_status == "killed":
        return f'Agent "{description}" was stopped'
    if return_code is not None:
        return f'Agent "{description}" failed with exit code {return_code}'
    return f'Agent "{description}" failed'


async def wait_for_completed_async_agent_entries(
    tool_metadata: dict[str, object] | None,
    *,
    poll_interval_seconds: float = 0.1,
) -> list[dict[str, object]]:
    manager = get_task_manager()
    while True:
        pending = pending_async_agent_entries(tool_metadata)
        if not pending:
            return []
        completed: list[dict[str, object]] = []
        for entry in pending:
            task_id = str(entry.get("task_id") or "").strip()
            task = manager.get_task(task_id)
            if task is None:
                output_file = _task_output_file(task_id)
                if output_file is not None and output_file.exists():
                    entry["status"] = "completed"
                    entry["return_code"] = 0
                    entry["output_file"] = str(output_file)
                    completed.append(entry)
                    continue
                entry["notification_sent"] = True
                entry["status"] = "missing"
                continue
            entry["status"] = task.status
            if task.status in TERMINAL_TASK_STATUSES:
                entry["return_code"] = task.return_code
                completed.append(entry)
        if completed:
            return completed
        await asyncio.sleep(poll_interval_seconds)


def format_completed_task_notifications(completed: list[dict[str, object]]) -> str:
    manager = get_task_manager()
    notifications: list[str] = []
    for entry in completed:
        task_id = str(entry.get("task_id") or "").strip()
        agent_id = str(entry.get("agent_id") or task_id).strip()
        task = manager.get_task(task_id)
        if task is None:
            output = _read_recorded_task_output(entry, max_bytes=8000)
            task_status = str(entry.get("status") or "completed").strip() or "completed"
            return_code = _entry_return_code(entry)
            if not output.strip() and task_status == "missing":
                continue
        else:
            output = manager.read_task_output(task_id, max_bytes=8000).strip()
            task_status = task.status
            return_code = task.return_code
        notifications.append(
            format_task_notification(
                TaskNotification(
                    task_id=agent_id,
                    status=task_status,
                    summary=build_async_task_summary(
                        entry,
                        task_status=task_status,
                        return_code=return_code,
                    ),
                    result=output or None,
                )
            )
        )
        entry["notification_sent"] = True
        entry["notified_status"] = task_status
    return "\n\n".join(notifications)


def _task_output_file(task_id: str) -> Path | None:
    clean = task_id.strip()
    if not clean or clean != Path(clean).name:
        return None
    return get_tasks_dir() / f"{clean}.log"


def _entry_return_code(entry: dict[str, object]) -> int | None:
    value = entry.get("return_code")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _read_recorded_task_output(entry: dict[str, object], *, max_bytes: int) -> str:
    output_file = str(entry.get("output_file") or "").strip()
    if output_file:
        path = Path(output_file)
    else:
        task_id = str(entry.get("task_id") or "").strip()
        path = _task_output_file(task_id) or Path()
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except (FileNotFoundError, OSError):
        return ""
    if max_bytes > 0 and len(content) > max_bytes:
        return content[-max_bytes:].strip()
    return content.strip()
