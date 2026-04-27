"""Promote verified repeated mistakes into small local skills."""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from openharness.skills.loader import get_program_skills_dirs

MAX_TRACKED_FAILURES = 20
MAX_TRACKED_LEARNED_SKILLS = 12

_SECRET_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b"),
)


@dataclass(frozen=True)
class LearningCandidate:
    """One repeated mistake ready to become or update a skill."""

    skill_name: str
    trigger_description: str
    lesson: str
    do_next_time: str
    avoid_next_time: str
    evidence_hash: str
    confidence: float
    failure_signature: str


@dataclass(frozen=True)
class LearningResult:
    """Persistence result for an automatic learning pass."""

    candidate: LearningCandidate
    skill_path: Path
    action: str


def get_default_learning_skills_dir() -> Path:
    """Return the program-local ``.skills`` directory used for learned skills."""

    program_dirs = get_program_skills_dirs()
    if program_dirs:
        return program_dirs[0]
    package_dir = Path(__file__).resolve().parents[1]
    for ancestor in package_dir.parents:
        if (ancestor / "pyproject.toml").exists() and (ancestor / "src" / "openharness").exists():
            return ancestor / ".skills"
    return package_dir.parent / ".skills"


def remember_tool_failure(
    metadata: dict[str, object] | None,
    *,
    tool_name: str,
    tool_input: dict[str, object],
    tool_output: str,
) -> None:
    """Store a compact, redacted failure signature for later learning."""

    if metadata is None:
        return
    failures = metadata.setdefault("recent_tool_failures", [])
    if not isinstance(failures, list):
        failures = []
        metadata["recent_tool_failures"] = failures
    signature = _failure_signature(tool_name, tool_input, tool_output)
    summary = _failure_summary(tool_name, tool_input, tool_output)
    failures.append(
        {
            "signature": signature,
            "category": _failure_category(tool_name),
            "tool": _redact(tool_name)[:80],
            "summary": _redact(summary)[:320],
        }
    )
    if len(failures) > MAX_TRACKED_FAILURES:
        del failures[:-MAX_TRACKED_FAILURES]


def analyze_learning_candidate(metadata: dict[str, object] | None) -> LearningCandidate | None:
    """Return a skill candidate when a repeated failure was followed by verification."""

    if not isinstance(metadata, dict):
        return None
    failures = metadata.get("recent_tool_failures")
    verified_work = metadata.get("recent_verified_work")
    if not isinstance(failures, list) or not isinstance(verified_work, list) or not verified_work:
        return None

    failure_items = [item for item in failures if isinstance(item, dict)]
    signatures = [str(item.get("signature") or "").strip() for item in failure_items]
    signature_counts = Counter(signature for signature in signatures if signature)
    repeated = [(signature, count) for signature, count in signature_counts.items() if count >= 2]
    categories = [str(item.get("category") or "").strip() for item in failure_items]
    category_counts = Counter(category for category in categories if category)
    repeated_categories = [
        (category, count) for category, count in category_counts.items() if count >= 3
    ]
    if not repeated and not repeated_categories:
        return None
    if repeated:
        signature, count = sorted(repeated, key=lambda item: (-item[1], item[0]))[0]
        matching = [
            item for item in failure_items if str(item.get("signature") or "").strip() == signature
        ]
    else:
        category, count = sorted(repeated_categories, key=lambda item: (-item[1], item[0]))[0]
        signature = f"category-{category}"
        matching = [
            item for item in failure_items if str(item.get("category") or "").strip() == category
        ]
    summary = str(matching[-1].get("summary") or signature).strip()
    verified_summary = _redact(str(verified_work[-1]))[:240]
    evidence_hash = hashlib.sha256(
        "\n".join([signature, summary, verified_summary]).encode("utf-8")
    ).hexdigest()[:16]
    slug = _slugify(f"learned-{signature}")[:60]
    confidence = min(0.95, 0.65 + (count * 0.1))
    return LearningCandidate(
        skill_name=slug,
        trigger_description=(
            "Use when OpenHarness sees this repeated verified failure pattern: "
            f"{_redact(summary)[:160]}"
        ),
        lesson=f"A repeated failure was observed and later verified as resolved: {_redact(summary)[:220]}",
        do_next_time=f"Start by applying the verified corrective path: {verified_summary}",
        avoid_next_time=(
            "Do not repeat the failing command, tool input, or assumption "
            "without checking the verified fix first."
        ),
        evidence_hash=evidence_hash,
        confidence=confidence,
        failure_signature=signature,
    )


def run_auto_skill_learning(
    metadata: dict[str, object] | None,
    *,
    enabled: bool = True,
    skills_dir: Path | None = None,
) -> LearningResult | None:
    """Analyze metadata and persist a learned skill when the gate passes."""

    if not enabled or metadata is None:
        return None
    candidate = analyze_learning_candidate(metadata)
    if candidate is None:
        return None
    result = persist_learning_candidate(candidate, skills_dir=skills_dir)
    _remember_learning_result(metadata, result)
    return result


def persist_learning_candidate(
    candidate: LearningCandidate,
    *,
    skills_dir: Path | None = None,
) -> LearningResult:
    """Create or update the program-local skill for a candidate."""

    root = (skills_dir or get_default_learning_skills_dir()).resolve()
    skill_dir = root / candidate.skill_name
    skill_file = skill_dir / "SKILL.md"
    patterns_file = skill_dir / "references" / "learned-patterns.md"
    existing_patterns = patterns_file.read_text(encoding="utf-8") if patterns_file.exists() else ""
    if candidate.evidence_hash in existing_patterns:
        return LearningResult(candidate=candidate, skill_path=skill_file, action="unchanged")

    skill_dir.mkdir(parents=True, exist_ok=True)
    patterns_file.parent.mkdir(parents=True, exist_ok=True)
    if not skill_file.exists():
        skill_file.write_text(_render_skill(candidate), encoding="utf-8")
        action = "created"
    else:
        action = "updated"
    with patterns_file.open("a", encoding="utf-8", newline="\n") as handle:
        if existing_patterns and not existing_patterns.endswith("\n"):
            handle.write("\n")
        handle.write(_render_pattern(candidate))
    return LearningResult(candidate=candidate, skill_path=skill_file, action=action)


def _remember_learning_result(metadata: dict[str, object], result: LearningResult) -> None:
    learned = metadata.setdefault("recent_learned_skills", [])
    if not isinstance(learned, list):
        learned = []
        metadata["recent_learned_skills"] = learned
    entry = {
        "skill": result.candidate.skill_name,
        "action": result.action,
        "evidence_hash": result.candidate.evidence_hash,
        "summary": result.candidate.lesson[:240],
        "path": str(result.skill_path),
    }
    learned[:] = [
        item
        for item in learned
        if not isinstance(item, dict) or item.get("evidence_hash") != result.candidate.evidence_hash
    ]
    learned.append(entry)
    if len(learned) > MAX_TRACKED_LEARNED_SKILLS:
        del learned[:-MAX_TRACKED_LEARNED_SKILLS]


def _render_skill(candidate: LearningCandidate) -> str:
    return (
        "---\n"
        f"name: {candidate.skill_name}\n"
        f"description: {candidate.trigger_description}\n"
        "---\n\n"
        f"# {candidate.skill_name}\n\n"
        "This skill was generated automatically from a repeated, verified OpenHarness failure pattern.\n\n"
        "## When To Use\n"
        f"- {candidate.trigger_description}\n\n"
        "## Process\n"
        "1. Read `references/learned-patterns.md` for the concrete observed pattern.\n"
        "2. Apply the verified corrective path before retrying the failed approach.\n"
        "3. Keep new evidence concise and avoid storing raw transcripts or secrets.\n"
    )


def _render_pattern(candidate: LearningCandidate) -> str:
    return (
        f"\n## Evidence {candidate.evidence_hash}\n"
        f"- Confidence: {candidate.confidence:.2f}\n"
        f"- Signature: `{candidate.failure_signature}`\n"
        f"- Lesson: {candidate.lesson}\n"
        f"- Do next time: {candidate.do_next_time}\n"
        f"- Avoid next time: {candidate.avoid_next_time}\n"
    )


def _failure_signature(tool_name: str, tool_input: dict[str, object], output: str) -> str:
    input_hint = ""
    for key in ("command", "path", "file_path", "pattern", "name"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            input_hint = value.strip()
            break
    first_line = next((line.strip() for line in output.splitlines() if line.strip()), "")
    raw = "|".join([tool_name.strip().lower(), input_hint[:120].lower(), first_line[:120].lower()])
    return _slugify(_redact(raw))[:80]


def _failure_summary(tool_name: str, tool_input: dict[str, object], output: str) -> str:
    input_hint = ""
    for key in ("command", "path", "file_path", "pattern", "name"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            input_hint = f" input={value.strip()[:160]}"
            break
    first_line = next((line.strip() for line in output.splitlines() if line.strip()), "tool failed")
    return f"{tool_name}{input_hint}: {first_line[:180]}"


def _failure_category(tool_name: str) -> str:
    return _slugify(tool_name.strip().lower() or "tool")


def _slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned or "learned-skill"


def _redact(value: str) -> str:
    text = value
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[REDACTED_SECRET]", text)
    text = re.sub(r"C:\\Users\\[^\\\s]+", r"C:\\Users\\[USER]", text, flags=re.IGNORECASE)
    text = re.sub(r"/home/[^/\s]+", "/home/[USER]", text)
    return " ".join(text.split())
