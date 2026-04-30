"""Display helpers for tool file paths."""

from __future__ import annotations

from pathlib import Path


def display_tool_path(path: Path, cwd: Path) -> str:
    """Return a user-facing path without local machine prefixes."""

    parts = path.parts
    playground_index = next(
        (index for index, part in enumerate(parts) if part.lower() == "playground"),
        None,
    )
    if playground_index is not None:
        return Path(*parts[playground_index:]).as_posix()

    try:
        return path.relative_to(cwd.resolve()).as_posix()
    except ValueError:
        return path.name
