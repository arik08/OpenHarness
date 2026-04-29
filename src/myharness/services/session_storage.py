"""Session persistence helpers."""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from myharness.api.usage import UsageSnapshot
from myharness.config.paths import get_project_config_dir
from myharness.engine.messages import ConversationMessage, ImageBlock, sanitize_conversation_messages, strip_internal_message_text
from myharness.utils.fs import atomic_write_text


_PERSISTED_TOOL_METADATA_KEYS = (
    "permission_mode",
    "read_file_state",
    "invoked_skills",
    "async_agent_state",
    "async_agent_tasks",
    "recent_work_log",
    "recent_verified_work",
    "recent_tool_failures",
    "recent_learned_skills",
    "task_focus_state",
    "compact_checkpoints",
    "compact_last",
    "session_title",
    "session_title_source",
    "session_title_user_edited",
    "workflow_duration_seconds",
)

_TITLE_STOPWORDS = {
    "about",
    "and",
    "game",
    "know",
    "latest",
    "let",
    "me",
    "of",
    "overview",
    "story",
    "table",
    "tables",
    "tell",
    "the",
    "with",
}

_KOREAN_COMMAND_VERB_RE = re.compile(
    r"(?:정의|분석|조사|정리|작성|생성|제작|만들|구현|수정|고치|고쳐|점검|확인|설치|업데이트|추가|추천|바꾸|바꿔|정하|정해|합치|합쳐|열|저장)"
)


def _sanitize_metadata(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _sanitize_metadata(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_metadata(item) for item in value]
    return str(value)


def _persistable_tool_metadata(tool_metadata: dict[str, object] | None) -> dict[str, Any]:
    if not isinstance(tool_metadata, dict):
        return {}
    payload: dict[str, Any] = {}
    for key in _PERSISTED_TOOL_METADATA_KEYS:
        if key in tool_metadata:
            payload[key] = _sanitize_metadata(tool_metadata[key])
    return payload


def _session_title_from_metadata(tool_metadata: dict[str, object] | None) -> str:
    if not isinstance(tool_metadata, dict):
        return ""
    title = str(tool_metadata.get("session_title") or "").strip()
    title = " ".join(title.split())
    return title[:80]


def _with_image_marker(text: str, has_image: bool) -> str:
    clean = strip_internal_message_text(text)
    if has_image and "[image]" not in clean:
        return f"{clean} [image]".strip()
    return clean


def _title_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for raw in re.findall(r"[A-Za-z][A-Za-z0-9&+_-]*|\d+", str(text or "").lower()):
        token = raw.strip("_-")
        if len(token) < 2 or token in _TITLE_STOPWORDS:
            continue
        tokens.add(token)
        alpha = re.sub(r"\d+$", "", token)
        if len(alpha) >= 3 and alpha not in _TITLE_STOPWORDS:
            tokens.add(alpha)
    return tokens


def _trim_title(text: str, limit: int = 34) -> str:
    clean = " ".join(str(text or "").split()).strip(" .,!?:;\"'`“”‘’")
    if len(clean) <= limit:
        return clean
    return clean[:limit].rstrip(" .,!?:;\"'`“”‘’")


def _strip_korean_object_particle(text: str) -> str:
    return re.sub(r"(을|를|이|가|은|는)$", "", text.strip())


def _korean_fallback_session_title(clean: str) -> str:
    text = clean.strip()
    if not re.search(r"[가-힣]", text):
        return ""

    subject = ""
    first_clause = re.split(r"[,.;\n]|그리고|그걸로|마지막으로|후에|다음으로", text, maxsplit=1)[0].strip()
    match = _KOREAN_COMMAND_VERB_RE.search(first_clause)
    if match:
        subject = first_clause[: match.start()].strip()
    if not subject:
        match = re.match(r"(.+?)(?:에\s*대해|에\s*대해서|관련|위한)", text)
        if match:
            subject = match.group(1).strip()
    if not subject:
        subject = first_clause or text

    subject = re.sub(r"^(?:이거|저거|그거|요거)\s*", "", subject)
    subject = re.sub(r"\s+", " ", subject).strip(" .,!?:;\"'`“”‘’")
    subject = _strip_korean_object_particle(subject)
    subject = re.sub(r"\s*(?:다시|좀|한번|바로|같은데|것 같은데|나오는거 같은데)\s*$", "", subject).strip()

    if not subject:
        return ""

    suffix = ""
    if "보고서" in text:
        suffix = "보고서"
    elif re.search(r"\b(?:pptx|html|md)\b", text, flags=re.IGNORECASE):
        suffix = "산출물"
    elif "history" in text.lower() or "히스토리" in text or "채팅이력" in text:
        suffix = "히스토리"
    elif "제목" in subject or "제목" in text:
        suffix = "점검"
    elif re.search(r"추천|recommend", text, flags=re.IGNORECASE):
        suffix = "추천"
    elif re.search(r"설치|Installer|python-pptx", text, flags=re.IGNORECASE):
        suffix = "설치 설정"
    elif re.search(r"수정|고치|고쳐|문제|안보|안 바뀌|반응이 없", text):
        suffix = "수정"
    elif re.search(r"합치|합쳐|통합", text):
        suffix = "통합"

    title = subject
    if suffix and suffix not in title:
        title = f"{title} {suffix}"
    return _trim_title(title)


def fallback_session_title_from_user_text(text: str) -> str:
    clean = strip_internal_message_text(text)
    clean = " ".join(clean.split()).strip("\"'`“”‘’ ")
    if not clean or clean.startswith("The user explicitly selected the `"):
        return ""

    korean_title = _korean_fallback_session_title(clean)
    if korean_title:
        return korean_title

    topic = ""
    story_like = bool(re.search(r"\bstor(?:y|ies)\b", clean, flags=re.IGNORECASE))
    match = re.search(
        r"(?i)\b(?:story|stories|overview|info|information)\b.*?\b(?:of|about)\b\s+(.+)$",
        clean,
    )
    if not match:
        match = re.search(r"(?i)\b(?:of|about)\b\s+(.+)$", clean)
    if match:
        topic = match.group(1)
        topic = re.sub(r"(?i)\s+(?:with|in)\s+tables?\b.*$", "", topic)
        topic = re.sub(r"(?i)^game\s*,?\s*", "", topic)

    if not topic:
        korean = re.match(r"(.+?)(?:에\s*대해|에\s*대해서|관련|설명|정리)", clean)
        if korean:
            topic = korean.group(1)

    title = (topic or clean).strip(" .,!?:;\"'`“”‘’")
    if story_like and title and "story" not in title.lower() and "스토리" not in title:
        title = f"{title} Story"
    return _trim_title(title, limit=64)


def title_echoes_first_user(title: str, first_user_text: str) -> bool:
    title_clean = strip_internal_message_text(title)
    title_clean = " ".join(title_clean.split()).strip("\"'`“”‘’ ")
    first_clean = strip_internal_message_text(first_user_text)
    first_clean = " ".join(first_clean.split()).strip("\"'`“”‘’ ")
    if not title_clean or not first_clean:
        return False

    folded_title = title_clean.casefold()
    folded_first = first_clean.casefold()
    has_korean = bool(re.search(r"[가-힣]", title_clean + first_clean))
    prefix_threshold = 14 if has_korean else 24
    similarity_threshold = 20 if has_korean else 32
    if len(title_clean) >= prefix_threshold and folded_first.startswith(folded_title):
        return True
    if len(title_clean) >= similarity_threshold and SequenceMatcher(None, folded_title, folded_first[: len(title_clean) + 20]).ratio() >= 0.82:
        return True
    return False


def title_matches_first_user(title: str, first_user_text: str) -> bool:
    title = strip_internal_message_text(title)
    first_user_text = strip_internal_message_text(first_user_text)
    if not title or not first_user_text:
        return True
    required = _title_tokens(first_user_text)
    if not required:
        return True
    return bool(required & _title_tokens(title))


def display_summary_for_first_user(summary: str, first_user_text: str) -> str:
    clean = strip_internal_message_text(summary)
    if clean and title_matches_first_user(clean, first_user_text) and not title_echoes_first_user(clean, first_user_text):
        return clean
    fallback = fallback_session_title_from_user_text(first_user_text)
    return fallback or clean


def _message_summary(message: ConversationMessage) -> str:
    has_image = any(isinstance(block, ImageBlock) for block in message.content)
    return _with_image_marker(message.text, has_image)


def _raw_message_summary(message: dict[str, Any]) -> str:
    content = message.get("content", [])
    if not isinstance(content, list):
        return ""
    text = " ".join(
        str(block.get("text", ""))
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    )
    has_image = any(
        isinstance(block, dict) and block.get("type") == "image"
        for block in content
    )
    return _with_image_marker(text, has_image)


def get_project_session_dir(cwd: str | Path) -> Path:
    """Return the session directory for a project."""
    session_dir = get_project_config_dir(cwd) / "sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def save_session_snapshot(
    *,
    cwd: str | Path,
    model: str,
    system_prompt: str,
    messages: list[ConversationMessage],
    usage: UsageSnapshot,
    session_id: str | None = None,
    tool_metadata: dict[str, object] | None = None,
) -> Path:
    """Persist a session snapshot. Saves both by ID and as latest."""
    session_dir = get_project_session_dir(cwd)
    sid = session_id or uuid4().hex[:12]
    now = time.time()
    messages = sanitize_conversation_messages(messages)
    metadata_title = _session_title_from_metadata(tool_metadata)
    first_user_summary = ""
    for msg in messages:
        if msg.role == "user":
            first_user_summary = _message_summary(msg)
            break
    user_edited_title = bool(
        isinstance(tool_metadata, dict) and tool_metadata.get("session_title_user_edited")
    )
    summary = metadata_title if user_edited_title else (
        display_summary_for_first_user(metadata_title, first_user_summary) if metadata_title else ""
    )
    if not summary and first_user_summary:
        summary = first_user_summary[:80]

    payload = {
        "session_id": sid,
        "cwd": str(Path(cwd).resolve()),
        "model": model,
        "system_prompt": system_prompt,
        "messages": [message.model_dump(mode="json") for message in messages],
        "usage": usage.model_dump(),
        "tool_metadata": _persistable_tool_metadata(tool_metadata),
        "created_at": now,
        "summary": summary,
        "message_count": len(messages),
    }
    data = json.dumps(payload, indent=2) + "\n"

    # Save as latest
    latest_path = session_dir / "latest.json"
    atomic_write_text(latest_path, data)

    # Save by session ID
    session_path = session_dir / f"session-{sid}.json"
    atomic_write_text(session_path, data)

    return latest_path


def _sanitize_snapshot_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize persisted messages for forward compatibility."""
    raw_messages = payload.get("messages", [])
    if isinstance(raw_messages, list):
        messages = sanitize_conversation_messages(
            [ConversationMessage.model_validate(item) for item in raw_messages]
        )
        payload = dict(payload)
        payload["messages"] = [message.model_dump(mode="json") for message in messages]
        payload["message_count"] = len(messages)
    return payload


def _load_snapshot_file(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        return _sanitize_snapshot_payload(payload)
    except ValueError:
        return None


def load_session_snapshot(cwd: str | Path) -> dict[str, Any] | None:
    """Load the most recent session snapshot for the project."""
    path = get_project_session_dir(cwd) / "latest.json"
    if not path.exists():
        return None
    return _load_snapshot_file(path)


def _first_user_summary_from_snapshot(data: dict[str, Any]) -> str:
    messages = data.get("messages", [])
    if not isinstance(messages, list):
        return ""
    for msg in messages:
        if isinstance(msg, dict) and msg.get("role") == "user":
            return _raw_message_summary(msg)
    return ""


def _snapshot_display_summary(data: dict[str, Any], *, default: str = "") -> str:
    summary = strip_internal_message_text(data.get("summary", ""))
    first_user_summary = _first_user_summary_from_snapshot(data)
    summary = display_summary_for_first_user(summary, first_user_summary)
    if first_user_summary.endswith("[image]"):
        summary = _with_image_marker(summary or first_user_summary, True)
    if summary.startswith("The user explicitly selected the `") and first_user_summary:
        summary = first_user_summary
    return summary or first_user_summary[:80] or default


def _snapshot_list_item(
    data: dict[str, Any],
    *,
    session_id: str,
    path: Path,
    summary_default: str = "",
) -> dict[str, Any]:
    messages = data.get("messages", [])
    message_count = len(messages) if isinstance(messages, list) else 0
    return {
        "session_id": session_id,
        "summary": _snapshot_display_summary(data, default=summary_default),
        "message_count": data.get("message_count", message_count),
        "model": data.get("model", ""),
        "created_at": data.get("created_at", path.stat().st_mtime),
    }


def list_session_snapshots(cwd: str | Path, limit: int | None = 20) -> list[dict[str, Any]]:
    """List saved sessions for the project, newest first."""
    session_dir = get_project_session_dir(cwd)
    sessions: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    # Named session files
    session_paths = sorted(
        session_dir.glob("session-*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in session_paths:
        data = _load_snapshot_file(path)
        if data is None:
            continue
        sid = str(data.get("session_id", path.stem.replace("session-", "")))
        seen_ids.add(sid)
        sessions.append(_snapshot_list_item(data, session_id=sid, path=path))
        if limit is not None and len(sessions) >= limit:
            break

    # Also include latest.json if it has no corresponding session file
    latest_path = session_dir / "latest.json"
    if latest_path.exists() and (limit is None or len(sessions) < limit):
        data = _load_snapshot_file(latest_path)
        if data is not None:
            sid = str(data.get("session_id", "latest"))
            if sid not in seen_ids:
                sessions.append(
                    _snapshot_list_item(
                        data,
                        session_id=sid,
                        path=latest_path,
                        summary_default="(latest session)",
                    )
                )

    # Sort by created_at descending
    sessions.sort(key=lambda s: s.get("created_at", 0), reverse=True)
    return sessions if limit is None else sessions[:limit]


def load_session_by_id(cwd: str | Path, session_id: str) -> dict[str, Any] | None:
    """Load a specific session by ID."""
    session_dir = get_project_session_dir(cwd)
    # Try named session first
    path = session_dir / f"session-{session_id}.json"
    if path.exists():
        return _load_snapshot_file(path)
    # Fallback to latest.json if session_id matches
    latest = session_dir / "latest.json"
    if latest.exists():
        data = _load_snapshot_file(latest)
        if data is not None and (data.get("session_id") == session_id or session_id == "latest"):
            return data
    return None


def delete_session_by_id(cwd: str | Path, session_id: str) -> bool:
    """Delete a saved session snapshot by ID."""
    session_dir = get_project_session_dir(cwd)
    deleted = False

    session_path = session_dir / f"session-{session_id}.json"
    if session_path.exists():
        session_path.unlink()
        deleted = True

    latest_path = session_dir / "latest.json"
    if latest_path.exists():
        data = _load_snapshot_file(latest_path)
        if data is not None and data.get("session_id") == session_id:
            latest_path.unlink()
            deleted = True

    return deleted


def export_session_markdown(
    *,
    cwd: str | Path,
    messages: list[ConversationMessage],
) -> Path:
    """Export the session transcript as Markdown."""
    session_dir = get_project_session_dir(cwd)
    path = session_dir / "transcript.md"
    parts: list[str] = ["# MyHarness Session Transcript"]
    for message in messages:
        parts.append(f"\n## {message.role.capitalize()}\n")
        text = message.text.strip()
        if text:
            parts.append(text)
        for block in message.tool_uses:
            parts.append(f"\n```tool\n{block.name} {json.dumps(block.input, ensure_ascii=True)}\n```")
        for block in message.content:
            if getattr(block, "type", "") == "tool_result":
                parts.append(f"\n```tool-result\n{block.content}\n```")
    atomic_write_text(path, "\n".join(parts).strip() + "\n")
    return path
