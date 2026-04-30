"""File writing tool."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from myharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from myharness.tools.path_display import display_tool_path


class FileWriteToolInput(BaseModel):
    """Arguments for the file write tool."""

    path: str = Field(description="Path of the file to write")
    content: str = Field(description="Full file contents")
    create_directories: bool = Field(default=True)


class FileWriteTool(BaseTool):
    """Write complete file contents."""

    name = "write_file"
    description = (
        "Create or intentionally overwrite a complete text file in the local repository. "
        "For changes to an existing file, prefer read_file followed by edit_file unless a full rewrite is clearly intended. "
        "For new standalone artifacts, prefer an `outputs/` relative path; keep files that reference each other in the same subfolder. "
        "Avoid generic names like index.html for newly created artifacts unless the user explicitly asks for that name "
        "or a required app/framework/hosting entrypoint would otherwise break."
    )
    input_model = FileWriteToolInput

    async def execute(
        self,
        arguments: FileWriteToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        path = _resolve_path(context.cwd, arguments.path)

        from myharness.sandbox.session import is_docker_sandbox_active

        if is_docker_sandbox_active():
            from myharness.sandbox.path_validator import validate_sandbox_path

            allowed, reason = validate_sandbox_path(path, context.cwd)
            if not allowed:
                return ToolResult(output=f"Sandbox: {reason}", is_error=True)

        if arguments.create_directories:
            path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(arguments.content, encoding="utf-8")
        return ToolResult(output=f"Wrote {display_tool_path(path, context.cwd)}")


def _resolve_path(base: Path, candidate: str) -> Path:
    path = Path(candidate).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()

