import pytest

from myharness.config.paths import get_tasks_dir
from myharness.tasks.manager import reset_task_manager
from myharness.ui.async_agents import (
    format_completed_task_notifications,
    wait_for_completed_async_agent_entries,
)


@pytest.mark.asyncio
async def test_async_agent_notification_uses_recorded_log_when_task_record_is_gone(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    reset_task_manager()
    task_id = "a12345678"
    output_path = get_tasks_dir() / f"{task_id}.log"
    output_path.write_text("worker result <ready>", encoding="utf-8")
    metadata = {
        "async_agent_tasks": [
            {
                "agent_id": "research-demo@office",
                "task_id": task_id,
                "description": "조사 담당",
                "notification_sent": False,
            }
        ]
    }

    try:
        completed = await wait_for_completed_async_agent_entries(metadata)
        payload = format_completed_task_notifications(completed)
    finally:
        reset_task_manager()

    assert completed == [metadata["async_agent_tasks"][0]]
    assert metadata["async_agent_tasks"][0]["notification_sent"] is True
    assert metadata["async_agent_tasks"][0]["notified_status"] == "completed"
    assert "<task-notification>" in payload
    assert "research-demo@office" in payload
    assert "worker result &lt;ready&gt;" in payload
