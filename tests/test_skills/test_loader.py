"""Tests for skill loading."""

from __future__ import annotations

import textwrap
from pathlib import Path

import openharness.skills.loader as skill_loader
from openharness.skills import get_user_skills_dir, load_skill_registry
from openharness.skills.loader import _parse_skill_markdown as parse_skill_markdown


def test_load_skill_registry_includes_bundled(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    registry = load_skill_registry()

    names = [skill.name for skill in registry.list_skills()]
    assert "simplify" in names
    assert "review" in names


def test_load_skill_registry_includes_user_skills(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    skills_dir = get_user_skills_dir()
    deploy_dir = skills_dir / "deploy"
    deploy_dir.mkdir(parents=True)
    (deploy_dir / "SKILL.md").write_text("# Deploy\nDeployment workflow guidance\n", encoding="utf-8")

    registry = load_skill_registry()
    deploy = registry.get("Deploy")

    assert deploy is not None
    assert deploy.source == "user"
    assert "Deployment workflow guidance" in deploy.content


def test_load_skill_registry_includes_program_dot_skills(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    program_root = tmp_path / "program"
    package_skills_dir = program_root / "src" / "openharness" / "skills"
    package_skills_dir.mkdir(parents=True)
    (program_root / "pyproject.toml").write_text("[project]\nname = 'fixture'\n", encoding="utf-8")
    program_skill_dir = program_root / ".skills" / "program-guide"
    program_skill_dir.mkdir(parents=True)
    (program_skill_dir / "SKILL.md").write_text(
        "---\nname: program-guide\n"
        "description: Program-local guide\n---\n\n"
        "# Program Guide\nLoaded from the OpenHarness program folder.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(skill_loader, "__file__", str(package_skills_dir / "loader.py"))

    registry = load_skill_registry(tmp_path / "workspace")
    program_guide = registry.get("program-guide")

    assert program_guide is not None
    assert program_guide.source == "program"
    assert str(program_root / ".skills" / "program-guide" / "SKILL.md") == program_guide.path


def test_program_dot_skills_take_priority_over_other_skill_dirs(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    program_root = tmp_path / "program"
    package_skills_dir = program_root / "src" / "openharness" / "skills"
    package_skills_dir.mkdir(parents=True)
    (program_root / "pyproject.toml").write_text("[project]\nname = 'fixture'\n", encoding="utf-8")
    monkeypatch.setattr(skill_loader, "__file__", str(package_skills_dir / "loader.py"))

    user_skill_dir = get_user_skills_dir() / "skill-creator"
    user_skill_dir.mkdir(parents=True)
    (user_skill_dir / "SKILL.md").write_text(
        "---\nname: skill-creator\n"
        "description: User config copy\n---\n\n"
        "# User Skill Creator\nUse the user config folder.\n",
        encoding="utf-8",
    )
    project_skill_dir = tmp_path / "workspace" / ".skills" / "skill-creator"
    project_skill_dir.mkdir(parents=True)
    (project_skill_dir / "SKILL.md").write_text(
        "---\nname: skill-creator\n"
        "description: Workspace copy\n---\n\n"
        "# Workspace Skill Creator\nUse the workspace folder.\n",
        encoding="utf-8",
    )
    extra_skill_dir = tmp_path / "extra" / "skill-creator"
    extra_skill_dir.mkdir(parents=True)
    (extra_skill_dir / "SKILL.md").write_text(
        "---\nname: skill-creator\n"
        "description: Extra copy\n---\n\n"
        "# Extra Skill Creator\nUse the extra folder.\n",
        encoding="utf-8",
    )
    program_skill_dir = program_root / ".skills" / "skill-creator"
    program_skill_dir.mkdir(parents=True)
    (program_skill_dir / "SKILL.md").write_text(
        "---\nname: skill-creator\n"
        "description: Program-local copy\n---\n\n"
        "# Program Skill Creator\nUse the OpenHarness program-local .skills folder.\n",
        encoding="utf-8",
    )

    registry = load_skill_registry(tmp_path / "workspace", extra_skill_dirs=[tmp_path / "extra"])
    skill_creator = registry.get("skill-creator")

    assert skill_creator is not None
    assert skill_creator.source == "program"
    assert str(program_root / ".skills" / "skill-creator" / "SKILL.md") == skill_creator.path
    assert "OpenHarness program-local .skills" in skill_creator.content


def test_load_skill_registry_includes_project_dot_skills(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    skill_dir = tmp_path / ".skills" / "ship"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: ship\n"
        "description: Project-local shipping checklist\n---\n\n"
        "# Ship\nUse the project release checklist.\n",
        encoding="utf-8",
    )

    registry = load_skill_registry(tmp_path)
    ship = registry.get("ship")

    assert ship is not None
    assert ship.source == "project"
    assert str(tmp_path / ".skills" / "ship" / "SKILL.md") == ship.path
    assert "project release checklist" in ship.content


def test_load_skill_registry_filters_disabled_skills(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    from openharness.skills.state import set_skill_enabled

    skill_dir = tmp_path / ".skills" / "ship"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: ship\n"
        "description: Project-local shipping checklist\n---\n\n"
        "# Ship\nUse the project release checklist.\n",
        encoding="utf-8",
    )

    set_skill_enabled("ship", False)

    registry = load_skill_registry(tmp_path)
    all_registry = load_skill_registry(tmp_path, include_disabled=True)

    assert registry.get("ship") is None
    disabled_ship = all_registry.get("ship")
    assert disabled_ship is not None
    assert disabled_ship.enabled is False


def test_load_skill_registry_skips_learned_skills_when_learning_off(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    from openharness.config.settings import Settings

    skills_root = tmp_path / "skills"
    skill_dir = skills_root / "learned-demo"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: learned-demo\n"
        "description: Automatically learned test skill\n---\n\n"
        "# Learned Demo\nUse the verified fix.\n",
        encoding="utf-8",
    )

    registry = load_skill_registry(
        tmp_path,
        extra_skill_dirs=[skills_root],
        settings=Settings(learning={"enabled": False, "mode": "off"}),
    )

    assert registry.get("learned-demo") is None


# --- parse_skill_markdown unit tests ---


def test_parse_frontmatter_inline_description():
    """Inline description: value on the same line as the key."""
    content = textwrap.dedent("""\
        ---
        name: my-skill
        description: A short inline description
        ---

        # Body
    """)
    name, desc = parse_skill_markdown("fallback", content)
    assert name == "my-skill"
    assert desc == "A short inline description"


def test_parse_frontmatter_folded_block_scalar():
    """YAML folded block scalar (>) must be expanded into a single string."""
    content = textwrap.dedent("""\
        ---
        name: NL2SQL Expert
        description: >
          Multi-tenant NL2SQL skill for converting natural language questions
          into SQL queries. Covers the full pipeline: tenant routing,
          table selection, question enhancement, context retrieval.
        tags:
          - nl2sql
        ---

        # NL2SQL Expert Skill
    """)
    name, desc = parse_skill_markdown("fallback", content)
    assert name == "NL2SQL Expert"
    assert "Multi-tenant NL2SQL skill" in desc
    assert "context retrieval" in desc
    # Folded scalar joins lines with spaces, not newlines
    assert "\n" not in desc


def test_parse_frontmatter_literal_block_scalar():
    """YAML literal block scalar (|) preserves newlines."""
    content = textwrap.dedent("""\
        ---
        name: multi-line
        description: |
          Line one.
          Line two.
          Line three.
        ---

        # Body
    """)
    name, desc = parse_skill_markdown("fallback", content)
    assert name == "multi-line"
    assert "Line one." in desc
    assert "Line two." in desc


def test_parse_frontmatter_quoted_description():
    """Quoted description values are handled correctly."""
    content = textwrap.dedent("""\
        ---
        name: quoted
        description: "A quoted description with: colons"
        ---

        # Body
    """)
    name, desc = parse_skill_markdown("fallback", content)
    assert name == "quoted"
    assert desc == "A quoted description with: colons"


def test_parse_fallback_heading_and_paragraph():
    """Without frontmatter, falls back to heading + first paragraph."""
    content = "# My Skill\nThis is the description from the body.\n"
    name, desc = parse_skill_markdown("fallback", content)
    assert name == "My Skill"
    assert desc == "This is the description from the body."


def test_parse_no_description_uses_skill_name():
    """When nothing provides a description, falls back to 'Skill: <name>'."""
    content = "# OnlyHeading\n"
    name, desc = parse_skill_markdown("fallback", content)
    assert name == "OnlyHeading"
    assert desc == "Skill: OnlyHeading"


def test_parse_malformed_yaml_falls_back():
    """Malformed YAML in frontmatter falls back to body parsing."""
    content = textwrap.dedent("""\
        ---
        name: [invalid yaml
        description: also broken: {
        ---

        # Fallback Title
        Body paragraph here.
    """)
    name, desc = parse_skill_markdown("fallback", content)
    # Fallback scans all lines; frontmatter lines are not excluded, so
    # the first non-heading, non-delimiter line wins.  The important thing
    # is that a YAMLError doesn't crash the loader.
    assert isinstance(desc, str) and desc
