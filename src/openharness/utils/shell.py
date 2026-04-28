"""Shared shell and subprocess helpers."""

from __future__ import annotations

import asyncio
import json
import os
import re
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
    shell: str | None = None,
) -> list[str]:
    """Return argv for the best available shell on the current platform."""
    resolved_platform = platform_name or get_platform()
    if resolved_platform == "windows":
        return _resolve_windows_shell_command(command, shell=shell)

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
            argv = resolve_shell_command(command, shell=resolved_settings.shell)
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
    argv = direct_argv or resolve_shell_command(
        command,
        prefer_pty=prefer_pty,
        shell=resolved_settings.shell,
    )
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
    printf_argv = _translate_simple_printf(command)
    if printf_argv is not None:
        return printf_argv

    try:
        parts = _split_windows_command(command)
    except ValueError:
        return None
    if parts and parts[0] == "&":
        parts = parts[1:]
    if not parts:
        return None

    executable = Path(parts[0].strip("\"'")).name.lower()
    if executable not in {"python", "python.exe", "python3", "python3.exe", "py", "py.exe"}:
        return None

    launcher = _resolve_windows_python_launcher(parts[0])
    remaining = parts[1:]
    if executable in {"py", "py.exe"} and launcher == [sys.executable] and remaining[:1] == ["-3"]:
        remaining = remaining[1:]
    return [*launcher, *remaining]


def _wrap_cmd_utf8(command: str) -> str:
    return f"chcp 65001>nul & {command}"


def _normalize_shell_preference(value: str | None) -> str:
    normalized = str(value or "auto").strip().lower().replace("_", "-")
    if normalized in {"pwsh", "powershell", "powershell.exe", "power-shell"}:
        return "powershell"
    if normalized in {"gitbash", "git-bash", "bash"}:
        return "git-bash"
    if normalized in {"cmd", "cmd.exe", "command-prompt"}:
        return "cmd"
    return "auto"


def _resolve_windows_shell_command(command: str, *, shell: str | None = None) -> list[str]:
    preference = _normalize_shell_preference(shell)
    if preference in {"auto", "powershell"}:
        powershell = _resolve_windows_powershell()
        if powershell:
            return [
                powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                _wrap_powershell_utf8(command),
            ]
        if preference == "powershell":
            return [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                _wrap_powershell_utf8(command),
            ]

    if preference in {"auto", "git-bash"}:
        git_bash = _resolve_git_bash()
        if git_bash:
            return [git_bash, "-lc", command]
        if preference == "git-bash":
            return ["bash.exe", "-lc", command]

    cmd = shutil.which("cmd.exe") or "cmd.exe"
    return [cmd, "/d", "/s", "/c", _wrap_cmd_utf8(command)]


def _resolve_windows_powershell() -> str | None:
    detected = shutil.which("pwsh.exe") or shutil.which("pwsh") or shutil.which("powershell.exe")
    if detected:
        return detected
    system_root = os.environ.get("SystemRoot")
    if not system_root:
        return None
    candidate = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    return str(candidate) if candidate.exists() else None


def _resolve_git_bash() -> str | None:
    candidates = [
        shutil.which("git-bash.exe"),
        shutil.which("bash.exe"),
        os.environ.get("OPENHARNESS_GIT_BASH"),
    ]
    for root_env in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
        root = os.environ.get(root_env)
        if root:
            candidates.append(str(Path(root) / "Git" / "bin" / "bash.exe"))
            candidates.append(str(Path(root) / "Programs" / "Git" / "bin" / "bash.exe"))
    for candidate in candidates:
        if candidate and _looks_like_git_bash(candidate):
            return candidate
    return None


def _looks_like_git_bash(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    return normalized.endswith("/bash.exe") and "/git/" in normalized and Path(path).exists()


def _wrap_powershell_utf8(command: str) -> str:
    return (
        "[Console]::InputEncoding = [Console]::OutputEncoding = "
        "New-Object System.Text.UTF8Encoding $false; "
        "$OutputEncoding = [Console]::OutputEncoding; "
        f"{command}"
    )


def _subprocess_env(env: Mapping[str, str] | None, *, platform_name: PlatformName) -> dict[str, str] | None:
    if platform_name != "windows":
        return dict(env) if env is not None else None
    merged = os.environ.copy()
    if env is not None:
        merged.update(env)
    merged.setdefault("PYTHONUTF8", "1")
    merged.setdefault("PYTHONIOENCODING", "utf-8")
    return merged


def _split_windows_command(command: str) -> list[str]:
    """Split simple Windows command lines without corrupting Python arguments."""
    parts: list[str] = []
    current: list[str] = []
    quote: str | None = None
    started = False
    index = 0

    while index < len(command):
        char = command[index]
        if char.isspace() and quote is None:
            if started:
                parts.append("".join(current))
                current = []
                started = False
            index += 1
            continue

        started = True
        if char == "\\" and quote != "'":
            slash_start = index
            while index < len(command) and command[index] == "\\":
                index += 1
            slash_count = index - slash_start
            if index < len(command) and command[index] == '"':
                current.extend("\\" * (slash_count // 2))
                if slash_count % 2:
                    current.append('"')
                else:
                    quote = None if quote == '"' else '"'
                index += 1
                continue
            current.extend("\\" * slash_count)
            continue

        if char in {"'", '"'} and (quote is None or quote == char):
            quote = None if quote == char else char
            index += 1
            continue

        current.append(char)
        index += 1

    if quote is not None:
        raise ValueError("No closing quotation")
    if started:
        parts.append("".join(current))
    return parts


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


def _translate_simple_printf(command: str) -> list[str] | None:
    match = re.fullmatch(
        r"""\s*printf\s+(?P<quote>['"])(?P<text>.*?)(?P=quote)\s*""",
        command,
        flags=re.DOTALL,
    )
    if match is None:
        return None
    script = "import sys; sys.stdout.write(sys.argv[1])"
    return [sys.executable, "-c", script, match.group("text")]


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
