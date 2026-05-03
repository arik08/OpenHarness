"""Shell command execution tool."""

from __future__ import annotations

import asyncio
import contextlib
import locale
import os
import re
from pathlib import Path
from typing import Iterable

from pydantic import BaseModel, Field

from myharness.sandbox import SandboxUnavailableError
from myharness.skills import load_skill_registry
from myharness.skills.loader import get_program_skills_dirs, get_user_skills_dir
from myharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from myharness.utils.shell import create_shell_subprocess


class BashToolInput(BaseModel):
    """Arguments for a command shell tool."""

    command: str = Field(description="Shell command to execute")
    cwd: str | None = Field(default=None, description="Working directory override")
    timeout_seconds: int = Field(default=600, ge=1, le=600)


class CmdToolInput(BashToolInput):
    """Arguments for the Windows cmd tool."""


class BashTool(BaseTool):
    """Execute a shell command with stdout/stderr capture."""

    name = "bash"
    description = "Run a shell command in the local repository."
    input_model = BashToolInput

    async def execute(self, arguments: BashToolInput, context: ToolExecutionContext) -> ToolResult:
        cwd = Path(arguments.cwd).expanduser() if arguments.cwd else context.cwd
        preflight_error = _preflight_interactive_command(arguments.command)
        if preflight_error is not None:
            return ToolResult(
                output=preflight_error,
                is_error=True,
                metadata={"interactive_required": True},
            )
        env = _python_module_env_for_skill(arguments.command, cwd, context)
        process: asyncio.subprocess.Process | None = None
        try:
            process = await create_shell_subprocess(
                arguments.command,
                cwd=cwd,
                prefer_pty=True,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
        except SandboxUnavailableError as exc:
            return ToolResult(output=str(exc), is_error=True)
        except asyncio.CancelledError:
            if process is not None:
                await _terminate_process(process, force=False)
            raise

        output_task = asyncio.create_task(_collect_output(process.stdout))
        try:
            await asyncio.wait_for(process.wait(), timeout=arguments.timeout_seconds)
        except asyncio.TimeoutError:
            await _terminate_process(process, force=True)
            output_buffer = await _finish_output_collection(output_task)
            return ToolResult(
                output=_format_timeout_output(
                    output_buffer,
                    command=arguments.command,
                    timeout_seconds=arguments.timeout_seconds,
                ),
                is_error=True,
                metadata={"returncode": process.returncode, "timed_out": True},
            )
        except asyncio.CancelledError:
            await _terminate_process(process, force=False)
            output_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await output_task
            raise

        output_buffer = await _finish_output_collection(output_task)
        text = _format_output(output_buffer)
        return ToolResult(
            output=text,
            is_error=process.returncode != 0,
            metadata={"returncode": process.returncode},
        )


class CmdTool(BashTool):
    """Execute a Windows shell command with stdout/stderr capture."""

    name = "cmd"
    description = "Run a Windows shell command in the local repository. The configured shell defaults to PowerShell."
    input_model = CmdToolInput


async def _terminate_process(process: asyncio.subprocess.Process, *, force: bool) -> None:
    if process.returncode is not None:
        return
    if force:
        process.kill()
        await process.wait()
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=2.0)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


async def _collect_output(stream: asyncio.StreamReader | None) -> bytearray:
    output_buffer = bytearray()
    if stream is None:
        return output_buffer
    while True:
        chunk = await stream.read(65536)
        if not chunk:
            return output_buffer
        output_buffer.extend(chunk)


async def _finish_output_collection(output_task: asyncio.Task[bytearray]) -> bytearray:
    try:
        return await asyncio.wait_for(output_task, timeout=2.0)
    except asyncio.TimeoutError:
        output_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await output_task
        return bytearray()


def _format_output(output_buffer: bytearray) -> str:
    text = _decode_output(output_buffer).replace("\r\n", "\n").strip()
    if not text:
        return "(no output)"
    if len(text) > 12000:
        return f"{text[:12000]}\n...[truncated]..."
    return text


def _decode_output(output_buffer: bytearray) -> str:
    data = bytes(output_buffer)
    if not data:
        return ""
    candidates = ["utf-8", locale.getpreferredencoding(False), "cp949", "mbcs"]
    seen: set[str] = set()
    decoded_with_replacement: list[str] = []
    for encoding in candidates:
        if not encoding or encoding.lower() in seen:
            continue
        seen.add(encoding.lower())
        try:
            return data.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            with contextlib.suppress(LookupError):
                decoded_with_replacement.append(data.decode(encoding, errors="replace"))
    if decoded_with_replacement:
        return min(decoded_with_replacement, key=lambda value: value.count("\ufffd"))
    return data.decode("utf-8", errors="replace")


def _python_module_env_for_skill(
    command: str,
    cwd: Path,
    context: ToolExecutionContext,
) -> dict[str, str] | None:
    module = _python_m_module_name(command)
    if module is None or _module_package_exists(cwd, module):
        return None

    candidates = _skill_roots_with_module(cwd, module, context)
    if len(candidates) != 1:
        return None

    skill_root = str(candidates[0])
    current_pythonpath = os.environ.get("PYTHONPATH", "")
    env = os.environ.copy()
    env["PYTHONPATH"] = (
        skill_root
        if not current_pythonpath
        else f"{skill_root}{os.pathsep}{current_pythonpath}"
    )
    return env


def _python_m_module_name(command: str) -> str | None:
    match = re.match(
        r"""(?ix)
        ^\s*
        (?:&\s*)?
        (?:
            (?:"[^"]*python(?:3)?(?:\.exe)?")
            |(?:'[^']*python(?:3)?(?:\.exe)?')
            |(?:[^\s'"]*python(?:3)?(?:\.exe)?)
            |py(?:\.exe)?
        )
        (?:\s+-3)?
        (?:
            \s+-[A-Za-z0-9]+
            (?!\s+[A-Za-z_][\w.]*\b)
        )*
        \s+-m\s+
        (?P<module>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)
        \b
        """,
        command,
    )
    if match is None:
        return None
    return match.group("module")


def _skill_roots_with_module(
    cwd: Path,
    module: str,
    context: ToolExecutionContext,
) -> list[Path]:
    seen: set[Path] = set()
    for roots in _skill_directory_groups(cwd, context):
        candidates = _module_skill_roots_from_dirs(roots, module, seen)
        if candidates:
            return candidates

    try:
        registry = load_skill_registry(
            cwd,
            extra_skill_dirs=context.metadata.get("extra_skill_dirs"),
            extra_plugin_roots=context.metadata.get("extra_plugin_roots"),
        )
    except Exception:
        return []

    roots: list[Path] = []
    for skill in registry.list_skills():
        path = getattr(skill, "path", None)
        if not path:
            continue
        skill_root = Path(path).expanduser().resolve().parent
        if skill_root in seen or not _module_package_exists(skill_root, module):
            continue
        seen.add(skill_root)
        roots.append(skill_root)
    return roots


def _skill_directory_groups(
    cwd: Path,
    context: ToolExecutionContext,
) -> list[list[Path]]:
    groups: list[list[Path]] = [[cwd / ".skills"]]
    extra_skill_dirs = context.metadata.get("extra_skill_dirs")
    if isinstance(extra_skill_dirs, (list, tuple)):
        groups.append([Path(path).expanduser() for path in extra_skill_dirs])
    elif isinstance(extra_skill_dirs, str):
        groups.append([Path(extra_skill_dirs).expanduser()])
    try:
        groups.append([get_user_skills_dir()])
    except Exception:
        pass
    try:
        groups.append(get_program_skills_dirs())
    except Exception:
        pass
    return groups


def _module_skill_roots_from_dirs(
    skill_dirs: Iterable[Path],
    module: str,
    seen: set[Path],
) -> list[Path]:
    roots: list[Path] = []
    for skills_dir in skill_dirs:
        try:
            resolved_dir = skills_dir.expanduser().resolve()
            children = sorted(resolved_dir.iterdir())
        except OSError:
            continue
        for child in children:
            if not child.is_dir() or not (child / "SKILL.md").exists():
                continue
            skill_root = child.resolve()
            if skill_root in seen or not _module_package_exists(skill_root, module):
                continue
            seen.add(skill_root)
            roots.append(skill_root)
    return roots


def _module_package_exists(root: Path, module: str) -> bool:
    package_dir = root.joinpath(*module.split("."))
    return (package_dir / "__main__.py").exists() or (package_dir / "__init__.py").exists()


def _format_timeout_output(output_buffer: bytearray, *, command: str, timeout_seconds: int) -> str:
    parts = [f"Command timed out after {timeout_seconds} seconds."]
    text = _format_output(output_buffer)
    if text != "(no output)":
        parts.extend(["", "Partial output:", text])
    hint = _interactive_command_hint(command=command, output=text)
    if hint:
        parts.extend(["", hint])
    return "\n".join(parts)


def _preflight_interactive_command(command: str) -> str | None:
    lowered_command = command.lower()
    stripped_command = lowered_command.strip()
    if re.fullmatch(r"(python3?|py)(?:\.exe)?(?:\s+-3)?(?:\s+-i)?", stripped_command):
        return (
            "This command starts an interactive Python session, but the command tool is non-interactive. "
            "Use a one-shot command such as `python -c \"...\"` instead."
        )
    if re.fullmatch(r"(python3?|py)(?:\.exe)?(?:\s+-3)?\s+-", stripped_command):
        return (
            "`python -` expects Python code from standard input, but the command tool does not provide live stdin. "
            "Use `python -c \"...\"` or a translated heredoc form that MyHarness supports on Windows."
        )
    if not _looks_like_interactive_scaffold(lowered_command):
        return None
    return (
        "This command appears to require interactive input before it can continue. "
        "The command tool is non-interactive, so it cannot answer installer/scaffold prompts live. "
        "Prefer non-interactive flags (for example --yes, -y, --skip-install, --defaults, --non-interactive), "
        "or run the scaffolding step once in an external terminal before asking the agent to continue."
    )


def _interactive_command_hint(*, command: str, output: str) -> str | None:
    lowered_command = command.lower()
    if _looks_like_interactive_scaffold(lowered_command) or _looks_like_prompt(output):
        return (
            "This command appears to require interactive input. "
            "The command tool is non-interactive, so prefer non-interactive flags "
            "(for example --yes, -y, --skip-install, or similar) or run the "
            "scaffolding step once in an external terminal before continuing."
        )
    return None


def _looks_like_interactive_scaffold(lowered_command: str) -> bool:
    scaffold_markers: tuple[str, ...] = (
        "create-next-app",
        "npm create ",
        "pnpm create ",
        "yarn create ",
        "bun create ",
        "pnpm dlx ",
        "npm init ",
        "pnpm init ",
        "yarn init ",
        "bunx create-",
        "npx create-",
    )
    non_interactive_markers: tuple[str, ...] = (
        "--yes",
        " -y",
        "--skip-install",
        "--defaults",
        "--non-interactive",
        "--ci",
    )
    return any(marker in lowered_command for marker in scaffold_markers) and not any(
        marker in lowered_command for marker in non_interactive_markers
    )


def _looks_like_prompt(output: str) -> bool:
    if not output:
        return False
    prompt_markers: Iterable[str] = (
        "would you like",
        "ok to proceed",
        "select an option",
        "which",
        "press enter to continue",
        "?",
    )
    lowered_output = output.lower()
    return any(marker in lowered_output for marker in prompt_markers)
