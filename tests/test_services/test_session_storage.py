"""Tests for session persistence."""

from __future__ import annotations

import json
from pathlib import Path

from myharness.api.usage import UsageSnapshot
from myharness.engine.messages import ConversationMessage, TextBlock
from myharness.services.session_storage import (
    delete_session_by_id,
    display_summary_for_first_user,
    export_session_markdown,
    fallback_session_title_from_user_text,
    get_project_session_dir,
    list_session_snapshots,
    load_session_by_id,
    load_session_snapshot,
    save_session_snapshot,
    title_echoes_first_user,
)


def test_save_and_load_session_snapshot(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    path = save_session_snapshot(
        cwd=project,
        model="claude-test",
        system_prompt="system",
        messages=[ConversationMessage(role="user", content=[TextBlock(text="hello")])],
        usage=UsageSnapshot(input_tokens=1, output_tokens=2),
        tool_metadata={
            "task_focus_state": {"goal": "Fix compact carry-over"},
            "recent_verified_work": ["Focused session storage test passed"],
        },
    )

    assert path.exists()
    assert path == project / ".myharness" / "sessions" / "latest.json"
    snapshot = load_session_snapshot(project)
    assert snapshot is not None
    assert snapshot["model"] == "claude-test"
    assert snapshot["usage"]["output_tokens"] == 2
    assert snapshot["tool_metadata"]["task_focus_state"]["goal"] == "Fix compact carry-over"
    assert snapshot["tool_metadata"]["recent_verified_work"] == ["Focused session storage test passed"]


def test_user_edited_session_title_is_preserved(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    save_session_snapshot(
        cwd=project,
        model="claude-test",
        system_prompt="system",
        messages=[ConversationMessage(role="user", content=[TextBlock(text="삼성전자 보고서 만들어줘")])],
        usage=UsageSnapshot(input_tokens=1, output_tokens=2),
        tool_metadata={
            "session_title": "내가 정한 제목",
            "session_title_user_edited": True,
        },
    )

    snapshot = load_session_snapshot(project)
    assert snapshot is not None
    assert snapshot["summary"] == "내가 정한 제목"
    assert snapshot["tool_metadata"]["session_title_user_edited"] is True


def test_export_session_markdown(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    path = export_session_markdown(
        cwd=project,
        messages=[
            ConversationMessage(role="user", content=[TextBlock(text="hello")]),
            ConversationMessage(role="assistant", content=[TextBlock(text="world")]),
        ],
    )

    assert path.exists()
    content = path.read_text(encoding="utf-8")
    assert "MyHarness Session Transcript" in content
    assert "hello" in content
    assert "world" in content


def test_load_session_snapshot_sanitizes_legacy_empty_assistant_messages(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    target_dir = get_project_session_dir(project)
    payload = {
        "session_id": "legacy123",
        "cwd": str(project),
        "model": "claude-test",
        "system_prompt": "system",
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "hello"}]},
            {"role": "assistant", "content": None},
            {"role": "assistant", "content": []},
            {"role": "assistant", "content": [{"type": "text", "text": "world"}]},
        ],
        "usage": {"input_tokens": 1, "output_tokens": 1},
        "tool_metadata": {},
        "created_at": 1.0,
        "summary": "hello",
        "message_count": 4,
    }
    (target_dir / "latest.json").write_text(json.dumps(payload), encoding="utf-8")

    snapshot = load_session_snapshot(project)
    assert snapshot is not None
    assert snapshot["message_count"] == 2
    assert [message["role"] for message in snapshot["messages"]] == ["user", "assistant"]
    assert snapshot["messages"][1]["content"][0]["text"] == "world"


def test_load_session_snapshot_returns_none_for_corrupt_json(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    target_dir = get_project_session_dir(project)
    (target_dir / "latest.json").write_text("{not valid json", encoding="utf-8")

    assert load_session_snapshot(project) is None


def test_load_session_snapshot_returns_none_for_non_object_json(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    target_dir = get_project_session_dir(project)
    (target_dir / "latest.json").write_text("[]", encoding="utf-8")

    assert load_session_snapshot(project) is None


def test_load_session_snapshot_returns_none_for_invalid_message_payload(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    target_dir = get_project_session_dir(project)
    payload = {
        "session_id": "broken",
        "cwd": str(project),
        "model": "claude-test",
        "system_prompt": "system",
        "messages": [{"role": "not-a-role", "content": [{"type": "text", "text": "hello"}]}],
        "usage": {},
        "tool_metadata": {},
        "created_at": 1.0,
        "summary": "broken",
        "message_count": 1,
    }
    (target_dir / "latest.json").write_text(json.dumps(payload), encoding="utf-8")

    assert load_session_snapshot(project) is None


def test_load_session_by_id_returns_none_for_corrupt_json(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    target_dir = get_project_session_dir(project)
    (target_dir / "session-broken.json").write_text("{not valid json", encoding="utf-8")

    assert load_session_by_id(project, "broken") is None


def test_list_session_snapshots_skips_invalid_message_payload(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    target_dir = get_project_session_dir(project)
    payload = {
        "session_id": "broken",
        "cwd": str(project),
        "model": "claude-test",
        "system_prompt": "system",
        "messages": [{"role": "not-a-role", "content": [{"type": "text", "text": "hello"}]}],
        "usage": {},
        "tool_metadata": {},
        "created_at": 1.0,
        "summary": "broken",
        "message_count": 1,
    }
    (target_dir / "session-broken.json").write_text(json.dumps(payload), encoding="utf-8")

    assert list_session_snapshots(project) == []


def test_delete_session_by_id_ignores_non_object_latest_json(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    target_dir = get_project_session_dir(project)
    latest = target_dir / "latest.json"
    latest.write_text("[]", encoding="utf-8")

    assert delete_session_by_id(project, "anything") is False
    assert latest.exists()


def test_korean_report_prompt_fallback_title_is_not_prompt_echo():
    prompt = (
        "삼성전자 메모리 경쟁사를 정의하고, 그 회사들의 최근 1주일 내 근황을 정리하여 "
        "md 보고서 만들고, 그걸로 html 보고서 만들어줘, 그리고 마지막으로 pptx 만들어줘"
    )

    assert fallback_session_title_from_user_text(prompt) == "삼성전자 메모리 경쟁사 보고서"


def test_display_summary_replaces_prompt_echo_title():
    prompt = (
        "삼성전자 메모리 경쟁사를 정의하고, 그 회사들의 최근 1주일 내 근황을 정리하여 "
        "md 보고서 만들고, 그걸로 html 보고서 만들어줘"
    )
    echoed = prompt[:80]

    assert title_echoes_first_user(echoed, prompt) is True
    assert display_summary_for_first_user(echoed, prompt) == "삼성전자 메모리 경쟁사 보고서"


def test_korean_first_clause_title_counts_as_prompt_echo():
    prompt = "삼성전자 메모리 경쟁사를 정의하고, 그 회사들의 최근 1주일 내 근황을 정리해줘"
    echoed_clause = "삼성전자 메모리 경쟁사를 정의하고"

    assert title_echoes_first_user(echoed_clause, prompt) is True
    assert display_summary_for_first_user(echoed_clause, prompt) == "삼성전자 메모리 경쟁사"


def test_korean_recommendation_prompt_fallback_title():
    assert fallback_session_title_from_user_text("서울 피자 맛집 추천해줘") == "서울 피자 맛집 추천"


def test_list_session_snapshots_uses_clean_display_summary(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()
    prompt = (
        "삼성전자 메모리 경쟁사를 정의하고, 그 회사들의 최근 1주일 내 근황을 정리하여 "
        "md 보고서 만들고, 그걸로 html 보고서 만들어줘"
    )

    save_session_snapshot(
        cwd=project,
        model="claude-test",
        system_prompt="system",
        messages=[ConversationMessage(role="user", content=[TextBlock(text=prompt)])],
        usage=UsageSnapshot(input_tokens=1, output_tokens=2),
        tool_metadata={"session_title": prompt[:80]},
    )

    sessions = list_session_snapshots(project)

    assert sessions[0]["summary"] == "삼성전자 메모리 경쟁사 보고서"
