"""Tests for shell resolution helpers."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from openharness.config.settings import Settings
from openharness.platforms import get_platform
from openharness.utils.shell import (
    _resolve_windows_direct_command,
    create_shell_subprocess,
    resolve_shell_command,
)


def test_resolve_shell_command_prefers_bash_on_linux(monkeypatch):
    monkeypatch.setattr(
        "openharness.utils.shell.shutil.which",
        lambda name: {"bash": "/usr/bin/bash", "cmd.exe": "C:/Windows/System32/cmd.exe"}.get(name),
    )

    command = resolve_shell_command("echo hi", platform_name="linux")

    assert command == ["/usr/bin/bash", "-lc", "echo hi"]


def test_resolve_shell_command_wraps_with_script_when_pty_requested(monkeypatch):
    def fake_which(name: str) -> str | None:
        mapping = {
            "bash": "/usr/bin/bash",
            "script": "/usr/bin/script",
        }
        return mapping.get(name)

    monkeypatch.setattr("openharness.utils.shell.shutil.which", fake_which)

    command = resolve_shell_command("echo hi", platform_name="linux", prefer_pty=True)

    assert command == ["/usr/bin/script", "-qefc", "echo hi", "/dev/null"]


def test_resolve_shell_command_uses_cmd_on_windows(monkeypatch):
    def fake_which(name: str) -> str | None:
        mapping = {
            "cmd.exe": "C:/Windows/System32/cmd.exe",
        }
        return mapping.get(name)

    monkeypatch.setattr("openharness.utils.shell.shutil.which", fake_which)

    command = resolve_shell_command("echo hi", platform_name="windows")

    assert command == ["C:/Windows/System32/cmd.exe", "/d", "/s", "/c", "chcp 65001>nul & echo hi"]


def test_resolve_shell_command_prefers_cmd_over_bash_on_windows(monkeypatch):
    def fake_which(name: str) -> str | None:
        mapping = {
            "powershell": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            "cmd.exe": "C:/Windows/System32/cmd.exe",
            "bash": "C:/Windows/System32/bash.exe",
        }
        return mapping.get(name)

    monkeypatch.setattr("openharness.utils.shell.shutil.which", fake_which)

    command = resolve_shell_command("py -3 --version", platform_name="windows")

    assert command == ["C:/Windows/System32/cmd.exe", "/d", "/s", "/c", "chcp 65001>nul & py -3 --version"]


def test_resolve_shell_command_skips_script_on_macos(monkeypatch):
    def fake_which(name: str) -> str | None:
        mapping = {
            "bash": "/bin/bash",
            "script": "/usr/bin/script",
        }
        return mapping.get(name)

    monkeypatch.setattr("openharness.utils.shell.shutil.which", fake_which)

    command = resolve_shell_command("echo hi", platform_name="macos", prefer_pty=True)

    assert command == ["/bin/bash", "-lc", "echo hi"]


def test_resolve_shell_command_linux_without_script_falls_back(monkeypatch):
    def fake_which(name: str) -> str | None:
        mapping = {
            "bash": "/usr/bin/bash",
        }
        return mapping.get(name)

    monkeypatch.setattr("openharness.utils.shell.shutil.which", fake_which)

    command = resolve_shell_command("echo hi", platform_name="linux", prefer_pty=True)

    assert command == ["/usr/bin/bash", "-lc", "echo hi"]


@pytest.mark.asyncio
async def test_create_shell_subprocess_defaults_stdin_to_devnull(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}

    async def fake_create_subprocess_exec(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs

        class _FakeProcess:
            returncode = 0

            async def wait(self):
                return 0

        return _FakeProcess()

    monkeypatch.setattr(
        "openharness.utils.shell.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )
    monkeypatch.setattr(
        "openharness.utils.shell.wrap_command_for_sandbox",
        lambda argv, settings=None: (argv, None),
    )
    monkeypatch.setattr(
        "openharness.utils.shell.shutil.which",
        lambda name: {"bash": "/usr/bin/bash", "cmd.exe": "C:/Windows/System32/cmd.exe"}.get(name),
    )

    await create_shell_subprocess(
        "echo hi",
        cwd=tmp_path,
        settings=Settings(),
    )

    if get_platform() == "windows":
        assert captured["args"] == ("C:/Windows/System32/cmd.exe", "/d", "/s", "/c", "chcp 65001>nul & echo hi")
    else:
        assert captured["args"] == ("/usr/bin/bash", "-lc", "echo hi")
    assert captured["kwargs"]["stdin"] is asyncio.subprocess.DEVNULL


def test_windows_python_launcher_choice_is_cached(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("OPENHARNESS_DATA_DIR", str(tmp_path / "data"))
    calls: list[tuple[str, ...]] = []

    def fake_which(name: str) -> str | None:
        return {"python": "C:/WindowsApps/python.exe", "py": "C:/Windows/py.exe"}.get(name)

    def fake_run(argv, **kwargs):
        del kwargs
        calls.append(tuple(argv))

        class _Result:
            returncode = 0 if argv[0] == "C:/Windows/py.exe" else 1
            stdout = "Python 3.13.3" if returncode == 0 else "Python"
            stderr = ""

        return _Result()

    monkeypatch.setattr("openharness.utils.shell.shutil.which", fake_which)
    monkeypatch.setattr("openharness.utils.shell.subprocess.run", fake_run)

    first = _resolve_windows_direct_command('python -u -c "print(1)"')
    second = _resolve_windows_direct_command('python -u -c "print(2)"')

    assert first == ["C:/Windows/py.exe", "-3", "-u", "-c", "print(1)"]
    assert second == ["C:/Windows/py.exe", "-3", "-u", "-c", "print(2)"]
    assert calls == [
        ("C:/WindowsApps/python.exe", "--version"),
        ("C:/Windows/py.exe", "-3", "--version"),
    ]


def test_windows_python_heredoc_is_translated_to_python_c(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("OPENHARNESS_DATA_DIR", str(tmp_path / "data"))

    monkeypatch.setattr(
        "openharness.utils.shell.shutil.which",
        lambda name: "C:/Python/python.exe" if name == "python" else None,
    )

    def fake_run(argv, **kwargs):
        del kwargs

        class _Result:
            returncode = 0
            stdout = "Python 3.13.3"
            stderr = ""

        return _Result()

    monkeypatch.setattr("openharness.utils.shell.subprocess.run", fake_run)

    command = "python - <<'PY'\nprint('안녕')\nPY"
    argv = _resolve_windows_direct_command(command)

    assert argv == ["C:/Python/python.exe", "-c", "print('안녕')"]
