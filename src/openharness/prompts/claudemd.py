"""Backward-compatible wrappers for project instruction loading."""

from __future__ import annotations

from pathlib import Path

from openharness.prompts.project_instructions import (
    discover_project_instruction_files,
    load_project_instructions_prompt,
)


def discover_claude_md_files(cwd: str | Path) -> list[Path]:
    """Discover project instruction files.

    Kept for existing imports; use discover_project_instruction_files for new code.
    """
    return discover_project_instruction_files(cwd)


def load_claude_md_prompt(cwd: str | Path, *, max_chars_per_file: int = 12000) -> str | None:
    """Load project instruction files.

    Kept for existing imports; use load_project_instructions_prompt for new code.
    """
    return load_project_instructions_prompt(cwd, max_chars_per_file=max_chars_per_file)
