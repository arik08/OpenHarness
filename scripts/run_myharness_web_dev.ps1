$ErrorActionPreference = "Stop"
$script:StopRequested = $false
$script:BackendProcess = $null
$script:ViteProcess = $null

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-ChildProcess {
    param($Process)

    if (-not $Process -or $Process.HasExited) {
        return
    }

    Stop-ProcessTree -ProcessId $Process.Id
    $Process.WaitForExit(5000) | Out-Null
}

function Stop-ListeningPort {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) {
        return
    }

    $ownerPid = [int]$connection.OwningProcess
    if ($ownerPid -eq $PID) {
        return
    }

    Write-Host "[INFO] Port $Port for $Label is already in use by PID $ownerPid. Closing the existing process..."
    Stop-ProcessTree -ProcessId $ownerPid
    Start-Sleep -Milliseconds 500

    $stillListening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($stillListening) {
        throw "Port $Port is still in use after trying to close PID $ownerPid."
    }
}

function Stop-All {
    Stop-ChildProcess -Process $script:ViteProcess
    Stop-ChildProcess -Process $script:BackendProcess
}

function Start-BackendLauncher {
    Stop-ListeningPort -Port $backendPort -Label "backend"
    Write-Host "[INFO] Starting MyHarness backend launcher on http://localhost:$env:PORT ..."
    return Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) "scripts\run_myharness_web_server.ps1")
    ) -NoNewWindow -PassThru
}

function Start-ViteServer {
    Stop-ListeningPort -Port 5173 -Label "Vite dev"
    Write-Host "[INFO] Starting Vite React dev server on http://127.0.0.1:5173 ..."
    return Start-Process -FilePath "node.exe" -ArgumentList @("node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort") -NoNewWindow -PassThru
}

[Console]::add_CancelKeyPress({
    param($sender, $eventArgs)

    $eventArgs.Cancel = $true
    $script:StopRequested = $true
    Write-Host ""
    Write-Host "[INFO] Stop requested. Stopping backend and Vite dev server..."
    Stop-All
})

$backendPort = if ($env:PORT) { [int]$env:PORT } else { 4173 }
Stop-ListeningPort -Port $backendPort -Label "backend"
Stop-ListeningPort -Port 5173 -Label "Vite dev"

$script:BackendProcess = Start-BackendLauncher

Start-Sleep -Seconds 2

$script:ViteProcess = Start-ViteServer

Write-Host ""
Write-Host "MyHarness dev mode is ready:"
Write-Host "  React dev UI: http://127.0.0.1:5173"
Write-Host "  Backend API:  http://localhost:$env:PORT"
Write-Host ""
Write-Host "Keep this window open while developing."
Write-Host "If the backend or Vite exits unexpectedly, this launcher will restart it."
Write-Host "Press Q or Ctrl+C in this window to stop both servers."
Write-Host "Press R in this window to restart both servers."
Write-Host ""

try {
    while (-not $script:StopRequested) {
        Start-Sleep -Milliseconds 200

        if ($script:BackendProcess.HasExited) {
            if ($script:BackendProcess.ExitCode -eq 0) {
                $script:StopRequested = $true
                Stop-ChildProcess -Process $script:ViteProcess
                break
            }

            Write-Host "[WARN] Backend launcher exited with code $($script:BackendProcess.ExitCode). Restarting in 2 seconds..."
            Start-Sleep -Seconds 2
            $script:BackendProcess = Start-BackendLauncher
        }
        if ($script:ViteProcess.HasExited) {
            Write-Host "[WARN] Vite dev server exited with code $($script:ViteProcess.ExitCode). Restarting in 2 seconds..."
            Start-Sleep -Seconds 2
            $script:ViteProcess = Start-ViteServer
        }

        try {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                if ($key.Key -eq [ConsoleKey]::Q) {
                    $script:StopRequested = $true
                    Write-Host "[INFO] Stop requested. Stopping backend and Vite dev server..."
                    Stop-All
                    break
                }
                if ($key.Key -eq [ConsoleKey]::R) {
                    Write-Host "[INFO] Restart requested. Restarting backend and Vite dev server..."
                    Stop-All
                    Start-Sleep -Seconds 2
                    $script:BackendProcess = Start-BackendLauncher
                    Start-Sleep -Seconds 2
                    $script:ViteProcess = Start-ViteServer
                }
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
}
catch {
    Write-Host "[ERROR] $_"
    Stop-All
    exit 1
}

Stop-All
exit 0
