"""Project-local UI preference storage."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from openharness.config.paths import get_project_config_dir
from openharness.config.settings import Settings
from openharness.skills.state import get_disabled_skill_names
from openharness.utils.fs import atomic_write_text


class ProjectPreferences(BaseModel):
    """Portable project-local enablement preferences."""

    version: int = 1
    disabled_skills: list[str] = Field(default_factory=list)
    disabled_mcp_servers: list[str] = Field(default_factory=list)
    enabled_plugins: dict[str, bool] = Field(default_factory=dict)


def get_project_preferences_path(cwd: str | Path) -> Path:
    """Return the project-local preferences path."""
    return get_project_config_dir(cwd) / "preferences.json"


def load_project_preferences(cwd: str | Path) -> ProjectPreferences | None:
    """Load project-local preferences if present."""
    path = get_project_preferences_path(cwd)
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        return normalize_project_preferences(ProjectPreferences.model_validate_json(raw))
    except Exception:
        return None


def preferences_from_global(settings: Settings) -> ProjectPreferences:
    """Build project preferences from the legacy global settings files."""
    return normalize_project_preferences(
        ProjectPreferences(
            disabled_skills=sorted(get_disabled_skill_names()),
            disabled_mcp_servers=sorted(settings.disabled_mcp_servers or set()),
            enabled_plugins=dict(settings.enabled_plugins or {}),
        )
    )


def effective_project_preferences(cwd: str | Path, settings: Settings) -> ProjectPreferences:
    """Return project preferences or the legacy global fallback."""
    return load_project_preferences(cwd) or preferences_from_global(settings)


def apply_project_preferences_to_settings(settings: Settings, cwd: str | Path | None) -> Settings:
    """Overlay project-local MCP and plugin preferences onto settings."""
    if cwd is None:
        return settings
    preferences = load_project_preferences(cwd)
    if preferences is None:
        return settings
    return settings.model_copy(
        update={
            "disabled_mcp_servers": set(preferences.disabled_mcp_servers),
            "enabled_plugins": dict(preferences.enabled_plugins),
        }
    )


def save_project_preferences(cwd: str | Path, preferences: ProjectPreferences) -> ProjectPreferences:
    """Persist normalized project preferences."""
    normalized = normalize_project_preferences(preferences)
    path = get_project_preferences_path(cwd)
    payload = normalized.model_dump_json(indent=2) + "\n"
    atomic_write_text(path, payload)
    return normalized


def set_project_skill_enabled(cwd: str | Path, name: str, enabled: bool, settings: Settings) -> ProjectPreferences:
    """Persist one skill enablement value in project preferences."""
    normalized_name = _normalize_name(name)
    preferences = effective_project_preferences(cwd, settings)
    disabled = {_normalize_name(item) for item in preferences.disabled_skills if _normalize_name(item)}
    if enabled:
        disabled.discard(normalized_name)
    elif normalized_name:
        disabled.add(normalized_name)
    preferences.disabled_skills = sorted(disabled)
    return save_project_preferences(cwd, preferences)


def set_project_mcp_enabled(cwd: str | Path, name: str, enabled: bool, settings: Settings) -> ProjectPreferences:
    """Persist one MCP enablement value in project preferences."""
    preferences = effective_project_preferences(cwd, settings)
    disabled = {str(item).strip() for item in preferences.disabled_mcp_servers if str(item).strip()}
    clean_name = str(name or "").strip()
    if enabled:
        disabled.discard(clean_name)
    elif clean_name:
        disabled.add(clean_name)
    preferences.disabled_mcp_servers = sorted(disabled)
    return save_project_preferences(cwd, preferences)


def set_project_plugin_enabled(cwd: str | Path, name: str, enabled: bool, settings: Settings) -> ProjectPreferences:
    """Persist one plugin enablement value in project preferences."""
    preferences = effective_project_preferences(cwd, settings)
    clean_name = str(name or "").strip()
    if clean_name:
        preferences.enabled_plugins[clean_name] = bool(enabled)
    return save_project_preferences(cwd, preferences)


def normalize_project_preferences(preferences: ProjectPreferences) -> ProjectPreferences:
    """Return v1 preferences with stable ordering and only known fields."""
    return ProjectPreferences(
        version=1,
        disabled_skills=sorted({_normalize_name(name) for name in preferences.disabled_skills if _normalize_name(name)}),
        disabled_mcp_servers=sorted({str(name).strip() for name in preferences.disabled_mcp_servers if str(name).strip()}),
        enabled_plugins={
            str(name).strip(): bool(value)
            for name, value in sorted((preferences.enabled_plugins or {}).items())
            if str(name).strip()
        },
    )


def _normalize_name(name: Any) -> str:
    return str(name or "").strip().lower()
