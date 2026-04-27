"""Shared shell and subprocess helpers."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

from openharness.config import Settings, load_settings
from openharness.platforms import PlatformName, get_platform
from openharness.sandbox import wrap_command_for_sandbox


def resolve_shell_command(
    command: str,
    *,
    platform_name: PlatformName | None = None,
    prefer_pty: bool = False,
) -> list[str]:
    """Return argv for the best available shell on the current platform."""
    resolved_platform = platform_name or get_platform()
    if resolved_platform == "windows":
        cmd = shutil.which("cmd.exe")
        if cmd:
            return [cmd, "/d", "/s", "/c", _wrap_cmd_utf8(command)]
        return ["cmd.exe", "/d", "/s", "/c", _wrap_cmd_utf8(command)]

    bash = shutil.which("bash")
    if bash:
        argv = [bash, "-lc", command]
        if prefer_pty:
            wrapped = _wrap_command_with_script(argv, platform_name=resolved_platform)
            if wrapped is not None:
                return wrapped
        return argv
    shell = shutil.which("sh") or os.environ.get("SHELL") or "/bin/sh"
    argv = [shell, "-lc", command]
    if prefer_pty:
        wrapped = _wrap_command_with_script(argv, platform_name=resolved_platform)
        if wrapped is not None:
            return wrapped
    return argv


async def create_shell_subprocess(
    command: str,
    *,
    cwd: str | Path,
    settings: Settings | None = None,
    prefer_pty: bool = False,
    stdin: int | None = asyncio.subprocess.DEVNULL,
    stdout: int | None = None,
    stderr: int | None = None,
    env: Mapping[str, str] | None = None,
) -> asyncio.subprocess.Process:
    """Spawn a shell command with platform-aware shell selection and sandboxing."""
    resolved_settings = settings or load_settings()
    resolved_platform = get_platform()

    # Docker backend: route through docker exec
    if resolved_settings.sandbox.enabled and resolved_settings.sandbox.backend == "docker":
        from openharness.sandbox.session import get_docker_sandbox

        session = get_docker_sandbox()
        if session is not None and session.is_running:
            argv = resolve_shell_command(command)
            return await session.exec_command(
                argv,
                cwd=cwd,
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
                env=dict(env) if env is not None else None,
            )
        if resolved_settings.sandbox.fail_if_unavailable:
            from openharness.sandbox import SandboxUnavailableError

            raise SandboxUnavailableError("Docker sandbox session is not running")

    # Existing srt path
    direct_argv = (
        _resolve_windows_direct_command(command)
        if resolved_platform == "windows"
        else None
    )
    argv = direct_argv or resolve_shell_command(command, prefer_pty=prefer_pty)
    argv, cleanup_path = wrap_command_for_sandbox(argv, settings=resolved_settings)
    subprocess_env = _subprocess_env(env, platform_name=resolved_platform)

    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(Path(cwd).resolve()),
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            env=subprocess_env,
        )
    except Exception:
        if cleanup_path is not None:
            cleanup_path.unlink(missing_ok=True)
        raise

    if cleanup_path is not None:
        asyncio.create_task(_cleanup_after_exit(process, cleanup_path))
    return process


def _resolve_windows_direct_command(command: str) -> list[str] | None:
    """Return argv for Windows commands that should bypass shell parsing."""
    heredoc_argv = _translate_python_stdin_heredoc(command)
    if heredoc_argv is not None:
        return heredoc_argv

    printf_argv = _translate_simple_printf_redirection(command)
    if printf_argv is not None:
        return printf_argv

    try:
        parts = [_strip_outer_quotes(part) for part in shlex.split(command, posix=False)]
    except ValueError:
        return None
    if parts and parts[0] == "&":
        parts = parts[1:]
    if not parts:
        return None

    executable = Path(parts[0].strip("\"'")).name.lower()
    if executable not in {"python", "python.exe", "python3", "python3.exe"}:
        return None

    return [*_resolve_windows_python_launcher(parts[0]), *parts[1:]]


def _wrap_cmd_utf8(command: str) -> str:
    return f"chcp 65001>nul & {command}"


def _subprocess_env(env: Mapping[str, str] | None, *, platform_name: PlatformName) -> dict[str, str] | None:
    if platform_name != "windows":
        return dict(env) if env is not None else None
    merged = os.environ.copy()
    if env is not None:
        merged.update(env)
    merged.setdefault("PYTHONUTF8", "1")
    merged.setdefault("PYTHONIOENCODING", "utf-8")
    return merged


def _strip_outer_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", "\""}:
        return value[1:-1]
    return value


def _translate_simple_printf_redirection(command: str) -> list[str] | None:
    match = re.fullmatch(
        r"""\s*printf\s+(?P<quote>['"])(?P<text>.*?)(?P=quote)\s*>\s*(?P<target>[^\s]+)\s*""",
        command,
        flags=re.DOTALL,
    )
    if match is None:
        return None
    target = match.group("target").strip("\"'")
    if not target:
        return None
    script = (
        "from pathlib import Path; "
        "Path(__import__('sys').argv[1]).write_text(__import__('sys').argv[2], encoding='utf-8')"
    )
    return [sys.executable, "-c", script, target, match.group("text")]


def _translate_python_stdin_heredoc(command: str) -> list[str] | None:
    """Translate common Bash heredoc Python snippets for native Windows shells."""
    match = re.fullmatch(
        r"""\s*(?P<prefix>(?:python3?|py)(?:\.exe)?(?:\s+-3)?)\s+-\s+<<\s*(?P<quote>['"]?)(?P<tag>[A-Za-z_][A-Za-z0-9_]*)(?P=quote)\s*\r?\n(?P<body>.*)\r?\n(?P=tag)\s*""",
        command,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if match is None:
        return None
    prefix_parts = match.group("prefix").split()
    if not prefix_parts:
        return None
    launcher = _resolve_windows_python_launcher(prefix_parts[0])
    body = match.group("body").replace("\r\n", "\n")
    return [*launcher, *prefix_parts[1:], "-c", body]


def _resolve_windows_python_launcher(executable: str) -> list[str]:
    executable_name = Path(executable.strip("\"'")).name.lower()
    generic = executable_name in {"python", "python.exe", "python3", "python3.exe"}
    if generic:
        cached = _load_cached_windows_python_launcher()
        if cached is not None:
            return cached

    candidate = shutil.which(executable) or executable
    if _windows_command_prefix_is_usable([candidate]):
        launcher = [candidate]
        if generic:
            _store_cached_windows_python_launcher(launcher, source="python")
        return launcher

    py_launcher = shutil.which("py")
    if py_launcher and _windows_command_prefix_is_usable([py_launcher, "-3"]):
        launcher = [py_launcher, "-3"]
        if generic:
            _store_cached_windows_python_launcher(launcher, source="py")
        return launcher

    launcher = [sys.executable]
    if generic:
        _store_cached_windows_python_launcher(launcher, source="sys.executable")
    return launcher


def _windows_command_prefix_is_usable(prefix: list[str]) -> bool:
    try:
        result = subprocess.run(
            [*prefix, "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and "Python " in f"{result.stdout}{result.stderr}"


def _load_cached_windows_python_launcher() -> list[str] | None:
    path = _windows_python_launcher_cache_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("version") != 1:
        return None
    launcher = payload.get("launcher")
    if (
        not isinstance(launcher, list)
        or not launcher
        or not all(isinstance(part, str) for part in launcher)
    ):
        return None
    executable = launcher[0]
    if Path(executable).is_absolute():
        if not Path(executable).exists():
            return None
    elif shutil.which(executable) is None:
        return None
    return launcher


def _store_cached_windows_python_launcher(launcher: list[str], *, source: str) -> None:
    try:
        from openharness.utils.fs import atomic_write_text

        atomic_write_text(
            _windows_python_launcher_cache_path(),
            json.dumps(
                {
                    "version": 1,
                    "launcher": launcher,
                    "source": source,
                },
                indent=2,
            )
            + "\n",
        )
    except OSError:
        return


def _windows_python_launcher_cache_path() -> Path:
    from openharness.config.paths import get_data_dir

    return get_data_dir() / "runtime" / "windows_python_launcher.json"


def _wrap_command_with_script(
    argv: list[str],
    *,
    platform_name: PlatformName | None = None,
) -> list[str] | None:
    resolved_platform = platform_name or get_platform()
    if resolved_platform == "macos":
        return None
    script = shutil.which("script")
    if script is None:
        return None
    if len(argv) >= 3 and argv[1] == "-lc":
        return [script, "-qefc", argv[2], "/dev/null"]
    return None


async def _cleanup_after_exit(process: asyncio.subprocess.Process, cleanup_path: Path) -> None:
    try:
        await process.wait()
    finally:
        cleanup_path.unlink(missing_ok=True)
