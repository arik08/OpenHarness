$ErrorActionPreference = "Stop"
$script:StopRequested = $false
$script:CurrentServerProcess = $null
$script:RestartCount = 0
$script:LogDirectory = if ($env:MYHARNESS_LOGS_DIR) { $env:MYHARNESS_LOGS_DIR } else { Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) ".myharness\logs" }
$script:LauncherLog = Join-Path $script:LogDirectory "myharness-web-launcher.log"

function Write-LauncherLog {
    param(
        [Parameter(Mandatory = $true)][string]$Event,
        [hashtable]$Details = @{}
    )

    try {
        if (-not (Test-Path -LiteralPath $script:LogDirectory)) {
            New-Item -ItemType Directory -Path $script:LogDirectory -Force | Out-Null
        }
        $entry = [ordered]@{
            ts = (Get-Date).ToUniversalTime().ToString("o")
            event = $Event
            pid = $PID
        }
        foreach ($key in $Details.Keys) {
            $entry[$key] = $Details[$key]
        }
        Add-Content -LiteralPath $script:LauncherLog -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
    }
    catch {
        # Logging must never be the reason the launcher exits.
    }
}

function Clear-ConsoleInputBuffer {
    $discarded = 0

    try {
        while ([Console]::KeyAvailable) {
            [Console]::ReadKey($true) | Out-Null
            $discarded += 1
        }
    }
    catch {
        # Some hosts do not expose an interactive console. Key polling is best effort.
    }

    return $discarded
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-ServerProcess {
    param([Parameter(Mandatory = $true)]$Process)

    if ($Process.HasExited) {
        return
    }

    Stop-ProcessTree -ProcessId $Process.Id
    if (-not $Process.WaitForExit(5000)) {
        Write-Host "[WARN] Server process did not exit cleanly; continuing restart."
    }
}

[Console]::add_CancelKeyPress({
    param($sender, $eventArgs)

    $eventArgs.Cancel = $true
    $script:StopRequested = $true
    Write-Host ""
    Write-Host "[INFO] Stop requested. Stopping server..."
    Write-LauncherLog "stop_requested" @{ reason = "ctrl_c" }

    if ($script:CurrentServerProcess -and -not $script:CurrentServerProcess.HasExited) {
        Stop-ServerProcess -Process $script:CurrentServerProcess
    }
})

while (-not $script:StopRequested) {
    Write-Host "[INFO] Starting npm start..."
    Write-LauncherLog "server_starting" @{ restart_count = $script:RestartCount }
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", "npm start") -NoNewWindow -PassThru
    $script:CurrentServerProcess = $process
    Write-LauncherLog "server_started" @{ child_pid = $process.Id; restart_count = $script:RestartCount }
    $restartRequested = $false
    $exitCode = 0

    try {
        while (-not $script:StopRequested -and -not $process.HasExited) {
            Start-Sleep -Milliseconds 150

            try {
                if ([Console]::KeyAvailable) {
                    $key = [Console]::ReadKey($true)
                    if ($key.Key -eq [ConsoleKey]::R) {
                        $discardedKeys = Clear-ConsoleInputBuffer
                        Write-Host ""
                        Write-Host "[INFO] Restart requested. Stopping server..."
                        Write-LauncherLog "restart_requested" @{ reason = "keyboard_r"; child_pid = $process.Id; discarded_keys = $discardedKeys }
                        $restartRequested = $true
                        Stop-ServerProcess -Process $process
                        break
                    }
                    if ($key.Key -eq [ConsoleKey]::Q) {
                        $discardedKeys = Clear-ConsoleInputBuffer
                        Write-Host ""
                        Write-Host "[INFO] Stop requested. Stopping server..."
                        Write-LauncherLog "stop_requested" @{ reason = "keyboard_q"; child_pid = $process.Id; discarded_keys = $discardedKeys }
                        $script:StopRequested = $true
                        Stop-ServerProcess -Process $process
                        break
                    }
                }
            }
            catch {
                Start-Sleep -Milliseconds 500
            }
        }

        if ($process.HasExited) {
            $exitCode = $process.ExitCode
        }
    }
    finally {
        Stop-ServerProcess -Process $process
        if ($script:CurrentServerProcess -eq $process) {
            $script:CurrentServerProcess = $null
        }
    }

    if ($script:StopRequested) {
        exit 0
    }

    if ($restartRequested) {
        Clear-ConsoleInputBuffer | Out-Null
        Write-Host "[INFO] Restarting server..."
        continue
    }

    Write-Host "[WARN] Server process exited with code $exitCode."
    Write-Host "[INFO] Keeping launcher alive; restarting server in 3 seconds. Press Q or Ctrl+C to stop."
    Write-LauncherLog "server_exited_unexpectedly" @{ child_pid = $process.Id; exit_code = $exitCode; restart_count = $script:RestartCount }
    Start-Sleep -Seconds 3
    $script:RestartCount += 1
}

exit 0
