import json
from pathlib import Path

from openharness.config.settings import Settings, save_settings, load_settings
from openharness.project_preferences import (
    apply_project_preferences_to_settings,
    effective_project_preferences,
    get_project_preferences_path,
    save_project_preferences,
    set_project_mcp_enabled,
    set_project_plugin_enabled,
    set_project_skill_enabled,
    ProjectPreferences,
)


def test_project_preferences_fall_back_to_global_settings(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    save_settings(
        Settings(
            disabled_mcp_servers={"global-mcp"},
            enabled_plugins={"global-plugin": False},
        )
    )
    skill_state = tmp_path / "config" / "skill_state.json"
    skill_state.write_text(json.dumps({"disabled_skills": ["global-skill"]}), encoding="utf-8")

    preferences = effective_project_preferences(tmp_path / "workspace", load_settings())

    assert preferences.disabled_skills == ["global-skill"]
    assert preferences.disabled_mcp_servers == ["global-mcp"]
    assert preferences.enabled_plugins == {"global-plugin": False}


def test_project_preferences_overlay_settings(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    save_settings(
        Settings(
            disabled_mcp_servers={"global-mcp"},
            enabled_plugins={"global-plugin": False},
        )
    )
    workspace = tmp_path / "workspace"
    save_project_preferences(
        workspace,
        ProjectPreferences(
            disabled_mcp_servers=["project-mcp"],
            enabled_plugins={"project-plugin": True},
        ),
    )

    settings = apply_project_preferences_to_settings(load_settings(), workspace)

    assert settings.disabled_mcp_servers == {"project-mcp"}
    assert settings.enabled_plugins == {"project-plugin": True}


def test_project_toggle_writes_portable_json(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    save_settings(
        Settings(
            disabled_mcp_servers={"global-mcp"},
            enabled_plugins={"global-plugin": False},
        )
    )
    workspace = tmp_path / "workspace"
    settings = load_settings()

    set_project_skill_enabled(workspace, "Demo Skill", False, settings)
    set_project_mcp_enabled(workspace, "demo-mcp", False, settings)
    set_project_plugin_enabled(workspace, "demo-plugin", True, settings)

    payload = json.loads(get_project_preferences_path(workspace).read_text(encoding="utf-8"))
    assert payload == {
        "version": 1,
        "disabled_skills": ["demo skill"],
        "disabled_mcp_servers": ["demo-mcp", "global-mcp"],
        "enabled_plugins": {
            "demo-plugin": True,
            "global-plugin": False,
        },
    }
