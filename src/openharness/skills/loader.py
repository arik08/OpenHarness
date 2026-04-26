"""Skill loading from bundled and user directories."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable

import yaml

from openharness.config.paths import get_config_dir
from openharness.config.settings import load_settings
from openharness.project_preferences import load_project_preferences
from openharness.skills.bundled import get_bundled_skills
from openharness.skills.registry import SkillRegistry
from openharness.skills.state import apply_skill_enabled_state
from openharness.skills.types import SkillDefinition

logger = logging.getLogger(__name__)


def get_user_skills_dir() -> Path:
    """Return the user skills directory."""
    path = get_config_dir() / "skills"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_skill_registry(
    cwd: str | Path | None = None,
    *,
    extra_skill_dirs: Iterable[str | Path] | None = None,
    extra_plugin_roots: Iterable[str | Path] | None = None,
    settings=None,
    include_disabled: bool = False,
) -> SkillRegistry:
    """Load bundled and user-defined skills."""
    registry = SkillRegistry()
    loaded: list[SkillDefinition] = []
    loaded.extend(get_bundled_skills())
    loaded.extend(load_program_skills())
    loaded.extend(load_user_skills())
    loaded.extend(load_project_skills(cwd))
    loaded.extend(load_skills_from_dirs(extra_skill_dirs))
    if cwd is not None:
        from openharness.plugins.loader import load_plugins

        resolved_settings = settings or load_settings()
        for plugin in load_plugins(resolved_settings, cwd, extra_roots=extra_plugin_roots):
            if not plugin.enabled:
                continue
            loaded.extend(plugin.skills)
    project_preferences = load_project_preferences(cwd) if cwd is not None else None
    disabled_skill_names = set(project_preferences.disabled_skills) if project_preferences is not None else None
    for skill in apply_skill_enabled_state(loaded, disabled_skill_names):
        if skill.enabled or include_disabled:
            registry.register(skill)
    return registry


def load_user_skills() -> list[SkillDefinition]:
    """Load markdown skills from the user config directory."""
    return load_skills_from_dirs([get_user_skills_dir()], source="user")


def get_program_skills_dirs() -> list[Path]:
    """Return OpenHarness installation-local skill directories that exist."""
    package_dir = Path(__file__).resolve().parents[1]
    candidates = [
        package_dir / ".skills",
        package_dir.parent / ".skills",
    ]

    for ancestor in package_dir.parents:
        if (ancestor / "pyproject.toml").exists() and (ancestor / "src" / "openharness").exists():
            candidates.append(ancestor / ".skills")
            break

    seen: set[Path] = set()
    result: list[Path] = []
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        result.append(resolved)
    return result


def load_program_skills() -> list[SkillDefinition]:
    """Load skills shipped next to the OpenHarness program."""
    return load_skills_from_dirs(get_program_skills_dirs(), source="program")


def get_project_skills_dir(cwd: str | Path) -> Path:
    """Return the project-local skills directory."""
    return Path(cwd).expanduser().resolve() / ".skills"


def load_project_skills(cwd: str | Path | None) -> list[SkillDefinition]:
    """Load markdown skills from ``<cwd>/.skills`` when present."""
    if cwd is None:
        return []
    skills_dir = get_project_skills_dir(cwd)
    if not skills_dir.exists():
        return []
    return load_skills_from_dirs([skills_dir], source="project")


def load_skills_from_dirs(
    directories: Iterable[str | Path] | None,
    *,
    source: str = "user",
) -> list[SkillDefinition]:
    """Load markdown skills from one or more directories.

    Supported layout:
    - ``<root>/<skill-dir>/SKILL.md``
    """
    skills: list[SkillDefinition] = []
    if not directories:
        return skills
    seen: set[Path] = set()
    for directory in directories:
        root = Path(directory).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        candidates: list[Path] = []
        for child in sorted(root.iterdir()):
            if child.is_dir():
                skill_path = child / "SKILL.md"
                if skill_path.exists():
                    candidates.append(skill_path)
        for path in candidates:
            if path in seen:
                continue
            seen.add(path)
            content = path.read_text(encoding="utf-8")
            default_name = path.parent.name
            name, description = _parse_skill_markdown(default_name, content)
            skills.append(
                SkillDefinition(
                    name=name,
                    description=description,
                    content=content,
                    source=source,
                    path=str(path),
                )
            )
    return skills


def _parse_skill_markdown(default_name: str, content: str) -> tuple[str, str]:
    """Parse name and description from a skill markdown file with YAML frontmatter support."""
    name = default_name
    description = ""

    lines = content.splitlines()

    # Try YAML frontmatter first (--- ... ---)
    if content.startswith("---\n"):
        end_index = content.find("\n---\n", 4)
        if end_index != -1:
            try:
                metadata = yaml.safe_load(content[4:end_index])
                if isinstance(metadata, dict):
                    val = metadata.get("name")
                    if isinstance(val, str) and val.strip():
                        name = val.strip()
                    val = metadata.get("description")
                    if isinstance(val, str) and val.strip():
                        description = val.strip()
            except yaml.YAMLError:
                logger.debug("Failed to parse YAML frontmatter for skill %s", default_name)

    # Fallback: extract from headings and first paragraph
    if not description:
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("# "):
                if not name or name == default_name:
                    name = stripped[2:].strip() or default_name
                continue
            if stripped and not stripped.startswith("---") and not stripped.startswith("#"):
                description = stripped[:200]
                break

    if not description:
        description = f"Skill: {name}"
    return name, description
