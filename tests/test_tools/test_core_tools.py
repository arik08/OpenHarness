"""Tests for built-in tools."""

from __future__ import annotations

import shlex
import subprocess
import sys
from pathlib import Path

import pytest

from myharness.tools.bash_tool import BashTool, BashToolInput
from myharness.tools.base import ToolExecutionContext
from myharness.tools.brief_tool import BriefTool, BriefToolInput
from myharness.tools.cron_create_tool import CronCreateTool, CronCreateToolInput
from myharness.tools.cron_delete_tool import CronDeleteTool, CronDeleteToolInput
from myharness.tools.cron_list_tool import CronListTool, CronListToolInput
from myharness.tools.enter_plan_mode_tool import EnterPlanModeTool, EnterPlanModeToolInput
from myharness.tools.config_tool import ConfigTool, ConfigToolInput
from myharness.tools.exit_plan_mode_tool import ExitPlanModeTool, ExitPlanModeToolInput
from myharness.tools.enter_worktree_tool import EnterWorktreeTool, EnterWorktreeToolInput
from myharness.tools.exit_worktree_tool import ExitWorktreeTool, ExitWorktreeToolInput
from myharness.tools.file_edit_tool import FileEditTool, FileEditToolInput
from myharness.tools.file_read_tool import FileReadTool, FileReadToolInput
from myharness.tools.file_write_tool import FileWriteTool, FileWriteToolInput
from myharness.tools.glob_tool import GlobTool, GlobToolInput
from myharness.tools.grep_tool import GrepTool, GrepToolInput
from myharness.tools.lsp_tool import LspTool, LspToolInput
from myharness.tools.notebook_edit_tool import NotebookEditTool, NotebookEditToolInput
from myharness.tools.remote_trigger_tool import RemoteTriggerTool, RemoteTriggerToolInput
from myharness.tools.skill_tool import SkillTool, SkillToolInput
from myharness.tools.todo_write_tool import TodoWriteTool, TodoWriteToolInput
from myharness.tools.tool_search_tool import ToolSearchTool, ToolSearchToolInput
from myharness.tools import create_default_tool_registry
from myharness.tools.ask_user_question_tool import AskUserQuestionTool
from myharness.config.settings import load_settings


def _python_stdout_command(text: str) -> str:
    code = f"import sys; sys.stdout.write({text!r})"
    if sys.platform == "win32":
        return f"& {sys.executable!r} -c {code!r}"
    return f"{shlex.quote(sys.executable)} -c {shlex.quote(code)}"


@pytest.mark.asyncio
async def test_file_write_read_and_edit(tmp_path: Path):
    context = ToolExecutionContext(cwd=tmp_path)

    write_result = await FileWriteTool().execute(
        FileWriteToolInput(path="notes.txt", content="one\ntwo\nthree\n"),
        context,
    )
    assert write_result.is_error is False
    assert write_result.output == "Wrote notes.txt"
    assert (tmp_path / "notes.txt").exists()

    read_result = await FileReadTool().execute(
        FileReadToolInput(path="notes.txt", offset=1, limit=2),
        context,
    )
    assert "2\ttwo" in read_result.output
    assert "3\tthree" in read_result.output

    edit_result = await FileEditTool().execute(
        FileEditToolInput(path="notes.txt", old_str="two", new_str="TWO"),
        context,
    )
    assert edit_result.is_error is False
    assert "TWO" in (tmp_path / "notes.txt").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_file_write_result_hides_local_path_before_playground(tmp_path: Path):
    workspace = tmp_path / "repo" / "Playground" / "shared" / "Default"
    context = ToolExecutionContext(cwd=workspace)

    write_result = await FileWriteTool().execute(
        FileWriteToolInput(path="outputs/report.md", content="# Report\n"),
        context,
    )

    assert write_result.is_error is False
    assert write_result.output == "Wrote Playground/shared/Default/outputs/report.md"
    assert str(tmp_path) not in write_result.output


@pytest.mark.asyncio
async def test_file_tool_results_hide_absolute_paths_outside_workspace(tmp_path: Path):
    workspace = tmp_path / "repo" / "Playground" / "shared" / "Default"
    outside = tmp_path / "external" / "notes.txt"
    outside.parent.mkdir(parents=True)
    outside.write_text("alpha\n", encoding="utf-8")
    context = ToolExecutionContext(cwd=workspace)

    read_missing = await FileReadTool().execute(
        FileReadToolInput(path=str(tmp_path / "external" / "missing.txt")),
        context,
    )
    assert read_missing.is_error is True
    assert read_missing.output == "File not found: missing.txt"
    assert str(tmp_path) not in read_missing.output

    edit_result = await FileEditTool().execute(
        FileEditToolInput(path=str(outside), old_str="alpha", new_str="beta"),
        context,
    )
    assert edit_result.is_error is False
    assert edit_result.output == "Updated notes.txt (1 replacement(s))"
    assert str(tmp_path) not in edit_result.output


@pytest.mark.asyncio
async def test_file_edit_applies_multiple_replacements_in_one_call(tmp_path: Path):
    context = ToolExecutionContext(cwd=tmp_path)
    target = tmp_path / "notes.txt"
    target.write_text("one\ntwo\nthree\ntwo\n", encoding="utf-8")

    edit_result = await FileEditTool().execute(
        FileEditToolInput(
            path="notes.txt",
            edits=[
                {"old_str": "one", "new_str": "ONE"},
                {"old_str": "two", "new_str": "TWO", "replace_all": True},
                {"old_str": "three", "new_str": "THREE"},
            ],
        ),
        context,
    )

    assert edit_result.is_error is False
    assert target.read_text(encoding="utf-8") == "ONE\nTWO\nTHREE\nTWO\n"


@pytest.mark.asyncio
async def test_file_edit_multi_replacement_does_not_partially_write_on_missing_text(tmp_path: Path):
    context = ToolExecutionContext(cwd=tmp_path)
    target = tmp_path / "notes.txt"
    original = "one\ntwo\nthree\n"
    target.write_text(original, encoding="utf-8")

    edit_result = await FileEditTool().execute(
        FileEditToolInput(
            path="notes.txt",
            edits=[
                {"old_str": "one", "new_str": "ONE"},
                {"old_str": "missing", "new_str": "MISSING"},
            ],
        ),
        context,
    )

    assert edit_result.is_error is True
    assert "edit 2" in edit_result.output
    assert target.read_text(encoding="utf-8") == original


@pytest.mark.asyncio
async def test_glob_and_grep(tmp_path: Path):
    context = ToolExecutionContext(cwd=tmp_path)
    (tmp_path / "a.py").write_text("def alpha():\n    return 1\n", encoding="utf-8")
    (tmp_path / "b.py").write_text("def beta():\n    return 2\n", encoding="utf-8")

    glob_result = await GlobTool().execute(GlobToolInput(pattern="*.py"), context)
    assert glob_result.output.splitlines() == ["a.py", "b.py"]

    grep_result = await GrepTool().execute(
        GrepToolInput(pattern=r"def\s+beta", file_glob="*.py"),
        context,
    )
    assert "b.py:1:def beta():" in grep_result.output

    file_root_result = await GrepTool().execute(
        GrepToolInput(pattern=r"def\s+alpha", root="a.py"),
        context,
    )
    assert "a.py:1:def alpha():" in file_root_result.output


@pytest.mark.asyncio
async def test_bash_tool_runs_command(tmp_path: Path):
    result = await BashTool().execute(
        BashToolInput(command=_python_stdout_command("hello")),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert result.is_error is False
    assert result.output == "hello"


@pytest.mark.asyncio
async def test_tool_search_and_brief_tools(tmp_path: Path):
    registry = create_default_tool_registry()
    context = ToolExecutionContext(cwd=tmp_path, metadata={"tool_registry": registry})

    search_result = await ToolSearchTool().execute(
        ToolSearchToolInput(query="file"),
        context,
    )
    assert "read_file" in search_result.output

    brief_result = await BriefTool().execute(
        BriefToolInput(text="abcdefghijklmnopqrstuvwxyz", max_chars=20),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert brief_result.output == "abcdefghijklmnopqrst..."


@pytest.mark.asyncio
async def test_skill_todo_and_config_tools(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))
    skills_dir = tmp_path / "config" / "skills"
    skills_dir.mkdir(parents=True)
    pytest_dir = skills_dir / "pytest"
    pytest_dir.mkdir()
    (pytest_dir / "SKILL.md").write_text("# Pytest\nHelpful pytest notes.\n", encoding="utf-8")

    skill_result = await SkillTool().execute(
        SkillToolInput(name="Pytest"),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert skill_result.output.startswith("Skill: Pytest\nDescription: Helpful pytest notes.")
    assert "Skill file:" not in skill_result.output
    assert "Skill directory:" not in skill_result.output
    assert "Helpful pytest notes." in skill_result.output

    todo_result = await TodoWriteTool().execute(
        TodoWriteToolInput(item="wire commands"),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert todo_result.is_error is False
    assert "wire commands" in (tmp_path / "TODO.md").read_text(encoding="utf-8")

    config_result = await ConfigTool().execute(
        ConfigToolInput(action="set", key="theme", value="solarized"),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert config_result.output == "Updated theme"


@pytest.mark.asyncio
async def test_plan_mode_tools_restore_previous_full_auto_mode(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_CONFIG_DIR", str(tmp_path / "config"))

    enter_result = await EnterPlanModeTool().execute(
        EnterPlanModeToolInput(),
        ToolExecutionContext(cwd=tmp_path, metadata={"permission_mode": "full_auto"}),
    )

    assert enter_result.metadata["permission_mode"] == "plan"
    assert enter_result.metadata["plan_previous_permission_mode"] == "full_auto"
    assert load_settings().permission.mode == "plan"
    assert load_settings().permission.plan_previous_mode == "full_auto"

    exit_result = await ExitPlanModeTool().execute(
        ExitPlanModeToolInput(),
        ToolExecutionContext(cwd=tmp_path, metadata=enter_result.metadata),
    )

    assert exit_result.metadata["permission_mode"] == "full_auto"
    assert load_settings().permission.mode == "full_auto"
    assert load_settings().permission.plan_previous_mode is None


@pytest.mark.asyncio
async def test_todo_write_upsert(tmp_path: Path):
    tool = TodoWriteTool()
    ctx = ToolExecutionContext(cwd=tmp_path)

    await tool.execute(TodoWriteToolInput(item="task A"), ctx)
    await tool.execute(TodoWriteToolInput(item="task B"), ctx)

    # Marking done should update in-place, not append a duplicate
    result = await tool.execute(TodoWriteToolInput(item="task A", checked=True), ctx)
    assert result.is_error is False

    content = (tmp_path / "TODO.md").read_text(encoding="utf-8")
    assert content.count("task A") == 1
    assert "- [x] task A" in content
    assert "- [ ] task A" not in content
    assert "- [ ] task B" in content

    # Calling again with same state is a no-op
    noop = await tool.execute(TodoWriteToolInput(item="task A", checked=True), ctx)
    assert "No change" in noop.output
    assert (tmp_path / "TODO.md").read_text(encoding="utf-8").count("task A") == 1


@pytest.mark.asyncio
async def test_todo_write_batch_can_be_session_only(tmp_path: Path):
    result = await TodoWriteTool().execute(
        TodoWriteToolInput(
            persist=False,
            todos=[
                {"text": "inspect files", "checked": True},
                {"text": "patch code", "checked": False},
            ],
        ),
        ToolExecutionContext(cwd=tmp_path),
    )

    assert result.output == "- [x] inspect files\n- [ ] patch code"
    assert not (tmp_path / "TODO.md").exists()


def test_todo_write_schema_guides_incremental_progress_updates():
    schema = TodoWriteTool.input_model.model_json_schema()
    assert "immediately after each step completes" in TodoWriteTool.description
    assert "full current checklist" in schema["properties"]["todos"]["description"]
    assert "actually completed since the prior update" in schema["properties"]["todos"]["description"]


def test_ask_user_question_schema_discourages_unnecessary_follow_ups():
    schema = AskUserQuestionTool.input_model.model_json_schema()

    assert "Use this only when the missing information" in AskUserQuestionTool.description
    assert "state the assumption and proceed" in AskUserQuestionTool.description
    assert "batch the choices into one prompt" in AskUserQuestionTool.description
    assert "avoid approval-only questions" in AskUserQuestionTool.description
    assert "After the user answers, continue the original task" in AskUserQuestionTool.description
    assert "without restating the plan" in AskUserQuestionTool.description
    assert "Do not ask another clarification immediately after the user answers" in AskUserQuestionTool.description
    assert "label each item as (1/N)" in AskUserQuestionTool.description
    assert "Batch all necessary clarification" in schema["properties"]["question"]["description"]
    assert "(1/N)" in schema["properties"]["question"]["description"]


@pytest.mark.asyncio
async def test_notebook_edit_tool(tmp_path: Path):
    result = await NotebookEditTool().execute(
        NotebookEditToolInput(path="demo.ipynb", cell_index=0, new_source="print('nb ok')\n"),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert result.is_error is False
    assert "demo.ipynb" in result.output
    assert "nb ok" in (tmp_path / "demo.ipynb").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_lsp_tool(tmp_path: Path):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "utils.py").write_text(
        'def greet(name):\n    """Return a greeting."""\n    return f"hi {name}"\n',
        encoding="utf-8",
    )
    (tmp_path / "pkg" / "app.py").write_text(
        "from pkg.utils import greet\n\nprint(greet('world'))\n",
        encoding="utf-8",
    )
    context = ToolExecutionContext(cwd=tmp_path)

    document_symbols = await LspTool().execute(
        LspToolInput(operation="document_symbol", file_path="pkg/utils.py"),
        context,
    )
    assert "function greet" in document_symbols.output

    definition = await LspTool().execute(
        LspToolInput(operation="go_to_definition", file_path="pkg/app.py", symbol="greet"),
        context,
    )
    assert "pkg/utils.py:1:1" in definition.output.replace("\\", "/")

    references = await LspTool().execute(
        LspToolInput(operation="find_references", file_path="pkg/app.py", symbol="greet"),
        context,
    )
    assert "pkg/app.py:1:from pkg.utils import greet" in references.output.replace("\\", "/")

    hover = await LspTool().execute(
        LspToolInput(operation="hover", file_path="pkg/app.py", symbol="greet"),
        context,
    )
    assert "Return a greeting." in hover.output


@pytest.mark.asyncio
async def test_worktree_tools(tmp_path: Path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True, text=True)
    subprocess.run(
        ["git", "config", "user.email", "myharness@example.com"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "MyHarness Tests"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    (tmp_path / "demo.txt").write_text("hello\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True, capture_output=True, text=True)
    subprocess.run(
        ["git", "commit", "-m", "init"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )

    enter_result = await EnterWorktreeTool().execute(
        EnterWorktreeToolInput(branch="feature/demo"),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert enter_result.is_error is False
    worktree_path = Path(enter_result.output.split("Path: ", 1)[1].strip())
    assert worktree_path.exists()

    exit_result = await ExitWorktreeTool().execute(
        ExitWorktreeToolInput(path=str(worktree_path)),
        ToolExecutionContext(cwd=tmp_path),
    )
    assert exit_result.is_error is False
    assert not worktree_path.exists()


@pytest.mark.asyncio
async def test_cron_and_remote_trigger_tools(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MYHARNESS_DATA_DIR", str(tmp_path / "data"))
    context = ToolExecutionContext(cwd=tmp_path)

    create_result = await CronCreateTool().execute(
        CronCreateToolInput(
            name="nightly",
            schedule="0 0 * * *",
            command=_python_stdout_command("CRON_OK"),
        ),
        context,
    )
    assert create_result.is_error is False

    list_result = await CronListTool().execute(CronListToolInput(), context)
    assert "nightly" in list_result.output

    trigger_result = await RemoteTriggerTool().execute(
        RemoteTriggerToolInput(name="nightly"),
        context,
    )
    assert trigger_result.is_error is False
    assert "CRON_OK" in trigger_result.output

    delete_result = await CronDeleteTool().execute(
        CronDeleteToolInput(name="nightly"),
        context,
    )
    assert delete_result.is_error is False
