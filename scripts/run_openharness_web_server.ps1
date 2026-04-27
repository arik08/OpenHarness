$ErrorActionPreference = "Stop"

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

while ($true) {
    Write-Host "[INFO] Starting npm start..."
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", "npm start") -NoNewWindow -PassThru
    $restartRequested = $false
    $exitCode = 0

    try {
        while (-not $process.HasExited) {
            Start-Sleep -Milliseconds 150

            try {
                if ([Console]::KeyAvailable) {
                    $key = [Console]::ReadKey($true)
                    if ($key.Key -eq [ConsoleKey]::R) {
                        Write-Host ""
                        Write-Host "[INFO] Restart requested. Stopping server..."
                        $restartRequested = $true
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
    }

    if ($restartRequested) {
        Write-Host "[INFO] Restarting server..."
        continue
    }

    exit $exitCode
}
