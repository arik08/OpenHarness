"""Helpers for surfacing completed async agent tasks back to a session."""

from __future__ import annotations

import asyncio

from openharness.coordinator.coordinator_mode import (
    TaskNotification,
    format_task_notification,
)
from openharness.tasks.manager import get_task_manager


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
            continue
        output = manager.read_task_output(task_id, max_bytes=8000).strip()
        notifications.append(
            format_task_notification(
                TaskNotification(
                    task_id=agent_id,
                    status=task.status,
                    summary=build_async_task_summary(
                        entry,
                        task_status=task.status,
                        return_code=task.return_code,
                    ),
                    result=output or None,
                )
            )
        )
        entry["notification_sent"] = True
        entry["notified_status"] = task.status
    return "\n\n".join(notifications)
