"""Tests for openharness.prompts.system_prompt."""

from __future__ import annotations

from openharness.prompts.environment import EnvironmentInfo
from openharness.prompts.system_prompt import build_system_prompt


def _make_env(**overrides) -> EnvironmentInfo:
    defaults = dict(
        os_name="Linux",
        os_version="5.15.0",
        platform_machine="x86_64",
        shell="bash",
        cwd="/home/user/project",
        home_dir="/home/user",
        date="2026-04-01",
        python_version="3.10.17",
        python_executable="/home/user/.openharness-venv/bin/python",
        virtual_env="/home/user/.openharness-venv",
        is_git_repo=True,
        git_branch="main",
        hostname="testhost",
    )
    defaults.update(overrides)
    return EnvironmentInfo(**defaults)


def test_build_system_prompt_contains_environment():
    env = _make_env()
    prompt = build_system_prompt(env=env)
    assert "Linux 5.15.0" in prompt
    assert "x86_64" in prompt
    assert "bash" in prompt
    assert "/home/user/project" in prompt
    assert "2026-04-01" in prompt
    assert "3.10.17" in prompt
    assert "/home/user/.openharness-venv/bin/python" in prompt
    assert "Virtual environment: /home/user/.openharness-venv" in prompt
    assert "branch: main" in prompt


def test_build_system_prompt_no_git():
    env = _make_env(is_git_repo=False, git_branch=None)
    prompt = build_system_prompt(env=env)
    assert "Git:" not in prompt


def test_build_system_prompt_git_no_branch():
    env = _make_env(is_git_repo=True, git_branch=None)
    prompt = build_system_prompt(env=env)
    assert "Git: yes" in prompt
    assert "branch:" not in prompt


def test_build_system_prompt_custom_prompt():
    env = _make_env()
    prompt = build_system_prompt(custom_prompt="You are a helpful bot.", env=env)
    assert prompt.startswith("You are a helpful bot.")
    assert "Linux 5.15.0" in prompt
    # Base prompt should not appear
    assert "OpenHarness" not in prompt


def test_build_system_prompt_default_includes_base():
    env = _make_env()
    prompt = build_system_prompt(env=env)
    assert "OpenHarness" in prompt


def test_build_system_prompt_encourages_parallel_research_tools():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "Parallelism is for speed, not for increasing the amount of work" in prompt
    assert "start with a small, high-signal batch" in prompt
    assert "2-3 `web_fetch` calls" in prompt
    assert "Avoid 4 or more parallel web calls" in prompt
    assert "call those `web_fetch` or `web_search` tools in parallel" in prompt
    assert "Escalate blocked web research by source importance" in prompt
    assert "central to the answer" in prompt
    assert 'invoke `skill(name="insane-search")`' in prompt
    assert "401, 402, 403, 429" in prompt
    assert "source-importance test" in prompt
    assert "casual lead, duplicate source, low-value search result" in prompt
    assert "Do not use `insane-search` for simple web searches" in prompt


def test_build_system_prompt_plans_substantial_tasks_first():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "For substantial tasks, share a short execution plan" in prompt
    assert "3+ files" in prompt
    assert "broad refactors" in prompt
    assert "Do not add a plan for tiny, obvious, or purely informational tasks" in prompt


def test_build_system_prompt_prefers_existing_files_and_batched_edits():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "Use repository context and senior engineering judgment" in prompt
    assert 'Do not treat words like "write an html"' in prompt
    assert "Treat requests such as" in prompt
    assert "Search for and read the likely existing file" in prompt
    assert "small tweak, bug fix, style change, text change, or behavior change" in prompt
    assert "standalone preview, demo, script, report, or sample" in prompt
    assert "Avoid `index.html` for newly created artifacts whenever possible" in prompt
    assert "too generic for users and future AI sessions" in prompt
    assert "Do not reuse a generic file such as `index.html`" in prompt
    assert "For unrelated standalone HTML previews or demos" in prompt
    assert "required app/framework/hosting entrypoint would otherwise break" in prompt
    assert "If both editing and creating are plausible" in prompt
    assert "batch them into one `edit_file` call with the `edits` array" in prompt
    assert "issue the necessary `edit_file` calls in the same assistant response" in prompt
