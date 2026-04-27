"""String-based file editing tool."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field, model_validator

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


class FileReplacement(BaseModel):
    """One string replacement inside a file edit."""

    old_str: str = Field(description="Existing text to replace")
    new_str: str = Field(description="Replacement text")
    replace_all: bool = Field(default=False)


class FileEditToolInput(BaseModel):
    """Arguments for the file edit tool."""

    path: str = Field(description="Path of the file to edit")
    old_str: str | None = Field(default=None, description="Existing text to replace")
    new_str: str | None = Field(default=None, description="Replacement text")
    replace_all: bool = Field(default=False)
    edits: list[FileReplacement] | None = Field(
        default=None,
        description=(
            "Multiple replacements to apply in one call. Use this for related edits in the same file "
            "instead of calling edit_file repeatedly."
        ),
    )

    @model_validator(mode="after")
    def _validate_edit_shape(self) -> "FileEditToolInput":
        has_single = self.old_str is not None or self.new_str is not None
        has_edits = bool(self.edits)
        if has_single and has_edits:
            raise ValueError("Provide either old_str/new_str or edits, not both")
        if has_single and (self.old_str is None or self.new_str is None):
            raise ValueError("old_str and new_str must be provided together")
        if not has_single and not has_edits:
            raise ValueError("Provide old_str/new_str or at least one edit")
        return self


class FileEditTool(BaseTool):
    """Replace text in an existing file."""

    name = "edit_file"
    description = (
        "Edit an existing file by replacing text. For several related changes in the same file, "
        "provide an edits array and apply them in one tool call."
    )
    input_model = FileEditToolInput

    async def execute(
        self,
        arguments: FileEditToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        path = _resolve_path(context.cwd, arguments.path)

        from openharness.sandbox.session import is_docker_sandbox_active

        if is_docker_sandbox_active():
            from openharness.sandbox.path_validator import validate_sandbox_path

            allowed, reason = validate_sandbox_path(path, context.cwd)
            if not allowed:
                return ToolResult(output=f"Sandbox: {reason}", is_error=True)

        if not path.exists():
            return ToolResult(output=f"File not found: {path}", is_error=True)

        original = path.read_text(encoding="utf-8")
        replacements = arguments.edits
        if replacements is None:
            replacements = [
                FileReplacement(
                    old_str=arguments.old_str or "",
                    new_str=arguments.new_str or "",
                    replace_all=arguments.replace_all,
                )
            ]

        updated = original
        applied_count = 0
        for index, edit in enumerate(replacements, start=1):
            if edit.old_str not in updated:
                return ToolResult(
                    output=f"old_str was not found in the file for edit {index}",
                    is_error=True,
                )
            if edit.replace_all:
                applied_count += updated.count(edit.old_str)
                updated = updated.replace(edit.old_str, edit.new_str)
            else:
                applied_count += 1
                updated = updated.replace(edit.old_str, edit.new_str, 1)

        path.write_text(updated, encoding="utf-8")
        return ToolResult(output=f"Updated {path} ({applied_count} replacement(s))")


def _resolve_path(base: Path, candidate: str) -> Path:
    path = Path(candidate).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()
