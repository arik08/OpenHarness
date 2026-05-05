"""Higher-level system prompt assembly."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from myharness.config.paths import (
    get_project_active_repo_context_path,
    get_project_issue_file,
    get_project_pr_comments_file,
)
from myharness.config.settings import Settings
from myharness.coordinator.coordinator_mode import get_coordinator_system_prompt, is_coordinator_mode
from myharness.memory import find_relevant_memories, load_memory_prompt
from myharness.personalization.rules import load_local_rules
from myharness.prompts.project_instructions import load_project_instructions_prompt
from myharness.prompts.system_prompt import build_system_prompt
from myharness.skills.loader import load_skill_registry


def _build_skills_section(
    cwd: str | Path,
    *,
    extra_skill_dirs: Iterable[str | Path] | None = None,
    extra_plugin_roots: Iterable[str | Path] | None = None,
    settings: Settings | None = None,
) -> str | None:
    """Build a system prompt section listing available skills."""
    registry = load_skill_registry(
        cwd,
        extra_skill_dirs=extra_skill_dirs,
        extra_plugin_roots=extra_plugin_roots,
        settings=settings,
    )
    skills = registry.list_skills()
    if not skills:
        return None
    lines = [
        "# Available Skills",
        "",
        "The following skills are available via the `skill` tool. "
        "When a user's request matches a skill, invoke it with `skill(name=\"<skill_name>\")` "
        "to load detailed instructions before proceeding.",
        "",
    ]
    for skill in skills:
        lines.append(f"- **{skill.name}**: {skill.description}")
    return "\n".join(lines)


def _build_delegation_section() -> str:
    """Build a concise section describing delegation and worker usage."""
    return "\n".join(
        [
            "# Delegation And Subagents",
            "",
            "MyHarness can delegate background work with the `agent` tool.",
            "Use it when the user explicitly asks for a subagent, background worker, or parallel investigation, "
            "or when the task clearly benefits from splitting off a focused worker.",
            "When the user asks to divide work by roles, says AI team/swarm, or names roles like 조사, 정리, 검토, "
            "first sketch a lightweight workflow/DAG before spawning workers.",
            "When showing that workflow, use a fenced `mermaid` block with `flowchart LR` or `flowchart TD` "
            "so MyHarness can render it as a chart. "
            "Use labels that fit the actual task, not a fixed 조사/정리/검토 template; for example "
            "`flowchart LR; A[요건 파악: 범위 확인] --> B[데이터 수집: 원천 수집] --> C[정규화: 스키마 맞춤] --> D[검증: 결과 확인]`. "
            "Do not use raw ASCII art or the old `workflow` fence for the workflow.",
            "Spawn only the current independent wave. Do not spawn serial downstream roles prematurely; "
            "roles with unmet prerequisites wait until their inputs exist.",
            "Keep delegated work fast: use at most 5 workers per wave, give each a narrow non-overlapping scope, "
            "and ask for concise bullet findings instead of a full report. Prefer more workers only when they reduce wall-clock time.",
            "Ask workers to publish brief interim progress with `task_update` status_note updates or short progress lines "
            "so UI surfaces can show what each person is doing.",
            "Give worker descriptions visible role labels, such as `조사 담당: 전력 용량 출처 확인`, "
            "so the AI 팀 panel can show what each worker owns.",
            "",
            "Default pattern:",
            '- For coding implementation, spawn with `agent(description=..., prompt=..., subagent_type=\"worker\")`.',
            '- For office/research/analysis workers, set `team=\"office\"` and omit `subagent_type` unless a specific non-code agent definition applies.',
            "- Inspect running or recorded workers with `/agents`.",
            "- Inspect one worker in detail with `/agents show TASK_ID`.",
            "- Send follow-up instructions with `send_message(task_id=..., message=...)`.",
            "- Read worker output with `task_output(task_id=...)`.",
            "",
            "Prefer a normal direct answer for simple tasks. Use subagents only when they materially help.",
        ]
    )


def _build_task_worker_section() -> str:
    """Build guidance for stdin-driven background workers."""
    return "\n".join(
        [
            "# Background Worker Mode",
            "",
            "You are running as a background worker spawned by a parent MyHarness session.",
            "Treat the current user message as your complete assignment; you cannot see the parent chat.",
            "Do not use task_get, task_list, or task_output to inspect your own task or recover context. "
            "Those parent task records live in another process and are intentionally unavailable here.",
            "Use task_update only for brief progress updates when the prompt gives you a task id.",
            "Return concise findings or the requested change summary when finished.",
        ]
    )


def build_runtime_system_prompt(
    settings: Settings,
    *,
    cwd: str | Path,
    latest_user_prompt: str | None = None,
    extra_skill_dirs: Iterable[str | Path] | None = None,
    extra_plugin_roots: Iterable[str | Path] | None = None,
    task_worker: bool = False,
) -> str:
    """Build the runtime system prompt with project instructions and memory."""
    coordinator_mode = is_coordinator_mode() and not task_worker
    if coordinator_mode:
        sections = [get_coordinator_system_prompt()]
    else:
        sections = [build_system_prompt(custom_prompt=settings.system_prompt, cwd=str(cwd))]

    if not coordinator_mode and settings.system_prompt is None:
        sections[0] = build_system_prompt(cwd=str(cwd))

    if settings.fast_mode:
        sections.append(
            "# Session Mode\nFast mode is enabled. Prefer concise replies, minimal tool use, and quicker progress over exhaustive exploration."
        )

    sections.append(
        "# Reasoning Settings\n"
        f"- Effort: {settings.effort}\n"
        f"- Passes: {settings.passes}\n"
        "Adjust depth and iteration count to match these settings while still completing the task."
    )

    skills_section = _build_skills_section(
        cwd,
        extra_skill_dirs=extra_skill_dirs,
        extra_plugin_roots=extra_plugin_roots,
        settings=settings,
    )
    if skills_section and not coordinator_mode and not task_worker:
        sections.append(skills_section)

    if task_worker:
        sections.append(_build_task_worker_section())
    elif not coordinator_mode:
        sections.append(_build_delegation_section())

    project_instructions = load_project_instructions_prompt(cwd)
    if project_instructions:
        sections.append(project_instructions)

    local_rules = load_local_rules()
    if local_rules:
        sections.append(f"# Local Environment Rules\n\n{local_rules}")

    for title, path in (
        ("Issue Context", get_project_issue_file(cwd)),
        ("Pull Request Comments", get_project_pr_comments_file(cwd)),
        ("Active Repo Context", get_project_active_repo_context_path(cwd)),
    ):
        if path.exists():
            content = path.read_text(encoding="utf-8", errors="replace").strip()
            if content:
                sections.append(f"# {title}\n\n```md\n{content[:12000]}\n```")

    if settings.memory.enabled:
        memory_section = load_memory_prompt(
            cwd,
            max_entrypoint_lines=settings.memory.max_entrypoint_lines,
        )
        if memory_section:
            sections.append(memory_section)

        if latest_user_prompt:
            relevant = find_relevant_memories(
                latest_user_prompt,
                cwd,
                max_results=settings.memory.max_files,
            )
            if relevant:
                lines = ["# Relevant Memories"]
                for header in relevant:
                    content = header.path.read_text(encoding="utf-8", errors="replace").strip()
                    lines.extend(
                        [
                            "",
                            f"## {header.path.name}",
                            "```md",
                            content[:8000],
                            "```",
                        ]
                    )
                sections.append("\n".join(lines))

    return "\n\n".join(section for section in sections if section.strip())
