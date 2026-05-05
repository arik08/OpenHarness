"""Tests for myharness.prompts.system_prompt."""

from __future__ import annotations

from myharness.prompts.environment import EnvironmentInfo
from myharness.prompts.system_prompt import build_system_prompt


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
        python_executable="/home/user/.myharness-venv/bin/python",
        virtual_env="/home/user/.myharness-venv",
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
    assert "/home/user/.myharness-venv/bin/python" in prompt
    assert "Virtual environment: /home/user/.myharness-venv" in prompt
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
    assert "MyHarness" not in prompt


def test_build_system_prompt_default_includes_base():
    env = _make_env()
    prompt = build_system_prompt(env=env)
    assert "You are MyHarness" in prompt
    assert "You are OpenHarness" not in prompt
    assert "MyHarness" in prompt


def test_build_system_prompt_encourages_parallel_research_tools():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "Parallelism is for speed, not for increasing the amount of work" in prompt
    assert "start with a small, high-signal batch" in prompt
    assert "2-3 `web_search` calls" in prompt
    assert "1-2 `web_fetch` calls" in prompt
    assert "around 5 parallel web calls total" in prompt
    assert "Avoid 6 or more parallel web calls" in prompt
    assert "call those `web_fetch` or `web_search` tools in parallel" in prompt
    assert "Escalate blocked web research by source importance" in prompt
    assert "directly asks for a specific URL, page, or source" in prompt
    assert "when you judge that a blocked or sparse source needs to be fetched" in prompt
    assert "central to the answer" in prompt
    assert 'invoke `skill(name="insane-search")`' in prompt
    assert "401, 402, 403, 429" in prompt
    assert "direct-request/source-importance test" in prompt
    assert "casual lead, duplicate source, low-value search result" in prompt
    assert "Do not use `insane-search` for simple web searches" in prompt


def test_build_system_prompt_plans_substantial_tasks_first():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "For substantial tasks, share progress as a short markdown checklist" in prompt
    assert "`todo_write` with a full `todos` list and `persist=false`" in prompt
    assert "immediately after each checklist item is actually completed" in prompt
    assert "Do not wait until the end to mark multiple items done at once" in prompt
    assert "3+ files" in prompt
    assert "broad refactors" in prompt
    assert "Do not add a checklist for tiny, obvious, or purely informational tasks" in prompt


def test_build_system_prompt_discourages_repeated_clarification_rounds():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "Clarifying-question budget" in prompt
    assert "state your assumption and proceed" in prompt
    assert "batch the necessary choices into one message" in prompt
    assert "at most two clarification rounds" in prompt
    assert 'Do not ask "should I proceed?"' in prompt
    assert "After the user answers a clarification question" in prompt
    assert 'A short numeric reply like "2" counts as choosing' in prompt
    assert "Do not restate the full plan, table of contents, or alternative approaches" in prompt
    assert "unless the answer creates a new concrete blocker or risky action" in prompt
    assert "Do not ask another clarification immediately after the user answers" in prompt
    assert "batch them into one question" in prompt
    assert "(1/N)" in prompt


def test_build_system_prompt_guides_chat_html_rendering_and_report_charts():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "MyHarness can render fenced `html` code blocks directly in the chat" in prompt
    assert "MyHarness can render fenced `mermaid` code blocks in chat and Markdown artifact previews" in prompt
    assert "use Mermaid for flowcharts, sequence diagrams, state diagrams, and other compact process diagrams" in prompt
    assert "For standalone HTML reports or web reports, use Mermaid when workflow, architecture, sequence, or dependency diagrams" in prompt
    assert "include Mermaid via CDN only when the HTML artifact needs it" in prompt
    assert "quick charts, small data views" in prompt
    assert "Do not force inline HTML for every answer" in prompt
    assert "HTML report or 리포트" in prompt
    assert "add charts or graphs" in prompt
    assert "prefer ECharts via CDN" in prompt
    assert "business-style HTML reports, dashboards, and charts" in prompt
    assert "Avoid oversized border-radius" in prompt
    assert "usually around 4-8px radius" in prompt
    assert "self-contained, compact, readable in a constrained iframe" in prompt


def test_build_system_prompt_guides_interactive_3d_html_artifacts():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "3D model, character, object, or interactive 3D preview" in prompt
    assert "single self-contained `outputs/*.html` artifact" in prompt
    assert "Three.js via CDN is acceptable" in prompt
    assert "procedural geometry, materials, lighting, and camera controls" in prompt
    assert "Default controls: left-click drag rotates/orbits the scene, wheel zooms in or out, right-click drag pans the scene, and double-click resets the view" in prompt
    assert "Do not add middle-click or keyboard controls by default" in prompt
    assert "Avoid plain white or plain black backgrounds" in prompt
    assert "low-contrast gradient or lit backdrop" in prompt


def test_build_system_prompt_guides_high_fidelity_3d_html_artifacts():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "If the user asks for a polished, detailed, high-poly, or production-quality 3D HTML artifact" in prompt
    assert "avoid a vector-icon-like result made from only a few boxes, cylinders, and spheres" in prompt
    assert "rounded/beveled shells, chamfered edges, layered panels, joints, cables, screws, vents, lenses, LEDs" in prompt
    assert "Use higher segment counts and smooth normals for curved parts" in prompt
    assert "PBR-style materials, multiple lights, soft shadows, and subtle animation" in prompt
    assert "If the requested fidelity is closer to a real model than procedural primitives can support" in prompt
    assert ".glb/.gltf asset workflow" in prompt
    assert "Do not present a simple low-poly proxy as high fidelity" in prompt


def test_build_system_prompt_rejects_yellowed_report_palettes():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "Avoid yellowed report palettes" in prompt
    assert "aged paper, parchment, sepia" in prompt
    assert "cream/beige/yellowed document" in prompt
    assert "any appropriate non-yellowed palette" in prompt


def test_build_system_prompt_includes_default_report_chart_palette():
    env = _make_env()
    prompt = build_system_prompt(env=env)

    assert "Default report chart palette" in prompt
    assert "#3288bd, #66c2a5, #e6f598, #d53e4f" in prompt
    assert "#9e0142, #f46d43, #fdae61, #fee08b, #abdda4, #5e4fa2" in prompt
    assert "first choices are not mandatory" in prompt
    assert "avoid dull default chart palettes" in prompt


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
    assert "place it under `outputs/`" in prompt
    assert "prefer a concise readable Korean filename" in prompt
    assert "using underscores between words instead of hyphens" in prompt
    assert "outputs/인터넷_문화_변천사_보고서.html" in prompt
    assert "English snake/kebab-style names are fine" in prompt
    assert "keep files that reference each other in the same subfolder" in prompt
    assert "If both editing and creating are plausible" in prompt
    assert "create, install, persist, or update a MyHarness skill" in prompt
    assert "(program location)\\MyHarness\\.skills" in prompt
    assert "Use a workspace `.skills`, user-level skill directory, or another location only" in prompt
    assert "batch them into one `edit_file` call with the `edits` array" in prompt
    assert "issue the necessary `edit_file` calls in the same assistant response" in prompt
