from __future__ import annotations

from pathlib import Path

from openharness.learning.service import (
    analyze_learning_candidate,
    persist_learning_candidate,
    remember_tool_failure,
    run_auto_skill_learning,
)
from openharness.skills import load_skill_registry


def test_repeated_verified_failure_creates_program_local_skill(tmp_path: Path):
    metadata: dict[str, object] = {"recent_verified_work": ["Ran pytest after using py -3 [passed]"]}
    for _ in range(2):
        remember_tool_failure(
            metadata,
            tool_name="bash",
            tool_input={"command": "python -m pytest tests/test_demo.py"},
            tool_output="'python' is not recognized as an internal or external command",
        )

    result = run_auto_skill_learning(metadata, skills_dir=tmp_path / ".skills")

    assert result is not None
    assert result.action == "created"
    assert result.skill_path.exists()
    assert "repeated, verified OpenHarness failure pattern" in result.skill_path.read_text(encoding="utf-8")
    patterns = result.skill_path.parent / "references" / "learned-patterns.md"
    assert result.candidate.evidence_hash in patterns.read_text(encoding="utf-8")
    learned = metadata.get("recent_learned_skills")
    assert isinstance(learned, list)
    assert learned[-1]["skill"] == result.candidate.skill_name

    registry = load_skill_registry(tmp_path, extra_skill_dirs=[tmp_path / ".skills"])
    assert registry.get(result.candidate.skill_name) is not None


def test_single_failure_does_not_create_candidate():
    metadata: dict[str, object] = {"recent_verified_work": ["Verified the fix"]}
    remember_tool_failure(
        metadata,
        tool_name="bash",
        tool_input={"command": "npm test"},
        tool_output="one-off failure",
    )

    assert analyze_learning_candidate(metadata) is None


def test_unverified_repeated_failure_does_not_create_candidate():
    metadata: dict[str, object] = {}
    for _ in range(2):
        remember_tool_failure(
            metadata,
            tool_name="bash",
            tool_input={"command": "npm test"},
            tool_output="same failure",
        )

    assert analyze_learning_candidate(metadata) is None


def test_three_failures_in_same_category_create_candidate():
    metadata: dict[str, object] = {"recent_verified_work": ["Verified the corrected file workflow"]}
    for path in ("missing-one.txt", "missing-two.txt", "missing-three.txt"):
        remember_tool_failure(
            metadata,
            tool_name="read_file",
            tool_input={"path": path},
            tool_output=f"{path} was not found",
        )

    candidate = analyze_learning_candidate(metadata)

    assert candidate is not None
    assert candidate.failure_signature == "category-read-file"


def test_secret_and_user_path_are_redacted(tmp_path: Path):
    leaked_api_key = "sk-" + "x" * 26
    metadata: dict[str, object] = {
        "recent_verified_work": ["Verified with token=super-secret-value at C:\\Users\\Myeongcheol\\repo"]
    }
    for _ in range(2):
        remember_tool_failure(
            metadata,
            tool_name="bash",
            tool_input={"command": "curl -H token=super-secret-value C:\\Users\\Myeongcheol\\repo"},
            tool_output=f"failed with {leaked_api_key}",
        )

    candidate = analyze_learning_candidate(metadata)
    assert candidate is not None
    result = persist_learning_candidate(candidate, skills_dir=tmp_path / ".skills")
    combined = result.skill_path.read_text(encoding="utf-8")
    combined += (result.skill_path.parent / "references" / "learned-patterns.md").read_text(encoding="utf-8")

    assert "super-secret-value" not in combined
    assert leaked_api_key not in combined
    assert "Myeongcheol" not in combined
    assert "[REDACTED_SECRET]" in combined


def test_existing_candidate_is_not_duplicated(tmp_path: Path):
    metadata: dict[str, object] = {"recent_verified_work": ["Verified the fix"]}
    for _ in range(2):
        remember_tool_failure(
            metadata,
            tool_name="bash",
            tool_input={"command": "npm test"},
            tool_output="same failure",
        )
    candidate = analyze_learning_candidate(metadata)
    assert candidate is not None

    first = persist_learning_candidate(candidate, skills_dir=tmp_path / ".skills")
    second = persist_learning_candidate(candidate, skills_dir=tmp_path / ".skills")

    assert first.action == "created"
    assert second.action == "unchanged"

