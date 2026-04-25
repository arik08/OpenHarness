@echo off
setlocal

title OpenHarness Web Backend

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=4173"
if "%HOST%"=="" set "HOST=0.0.0.0"
set "OPENHARNESS_URL=http://localhost:%PORT%"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip }"`) do set "OPENHARNESS_LAN_IP=%%I"
if not "%OPENHARNESS_LAN_IP%"=="" set "OPENHARNESS_LAN_URL=http://%OPENHARNESS_LAN_IP%:%PORT%"
set "OPENHARNESS_HOME=%USERPROFILE%\.openharness"
set "OPENHARNESS_VENV_PY=%OPENHARNESS_HOME%\venv\Scripts\python.exe"

echo.
echo ============================================================
echo   OpenHarness Web Backend
echo ============================================================
echo.
echo   URL: %OPENHARNESS_URL%
if not "%OPENHARNESS_LAN_URL%"=="" echo   LAN: %OPENHARNESS_LAN_URL%
echo.
echo   This window is running the web server and backend launcher.
echo   Keep it open while using OpenHarness in the browser.
echo   Press Ctrl+C in this window to stop the server.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo Install Node.js or open this from a terminal where node is available.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH.
  echo Install Node.js with npm, or open this from a terminal where npm is available.
  echo.
  pause
  exit /b 1
)

where py >nul 2>nul
if errorlevel 1 if not exist "%OPENHARNESS_VENV_PY%" (
  echo [ERROR] Python launcher py.exe was not found on PATH.
  echo Install Python, or run Installer.bat first.
  echo.
  pause
  exit /b 1
)

echo [INFO] Checking Python package dependencies...
set "PYTHONPATH=%CD%\src;%PYTHONPATH%"
if exist "%OPENHARNESS_VENV_PY%" (
  set "OPENHARNESS_PYTHON=%OPENHARNESS_VENV_PY%"
) else (
  set "OPENHARNESS_PYTHON=py -3"
)

%OPENHARNESS_PYTHON% -c "import importlib.util, sys; required=['openharness','pydantic','yaml','httpx']; missing=[name for name in required if importlib.util.find_spec(name) is None]; sys.exit(1 if missing else 0)" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Missing Python dependencies detected. Installing now...
  %OPENHARNESS_PYTHON% -m pip install -e .
  if errorlevel 1 (
    echo.
    echo [ERROR] Python dependency installation failed.
    echo Run Installer.bat and try again.
    pause
    exit /b 1
  )
  %OPENHARNESS_PYTHON% -c "import openharness, pydantic, yaml, httpx" >nul 2>nul
  if errorlevel 1 (
    echo.
    echo [ERROR] Python dependencies are still not importable after installation.
    pause
    exit /b 1
  )
  echo [INFO] Python dependencies installed.
) else (
  echo [INFO] Python dependencies are already available.
)

if not exist "frontend\web\node_modules\.package-lock.json" (
  echo [INFO] Missing web dependencies detected. Installing now...
  pushd "frontend\web"
  call npm install
  if errorlevel 1 (
    popd
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  popd
) else (
  echo [INFO] Web dependencies are already available.
)

set "OPENHARNESS_PORT_PID="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$conn = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Write-Output $conn.OwningProcess }"`) do (
  set "OPENHARNESS_PORT_PID=%%A"
)

if not "%OPENHARNESS_PORT_PID%"=="" (
  echo [INFO] Port %PORT% is already in use by PID %OPENHARNESS_PORT_PID%.
  echo [INFO] Closing the existing process and starting MyHarness fresh...
  taskkill /PID %OPENHARNESS_PORT_PID% /T /F >nul 2>nul
  timeout /t 1 /nobreak >nul

  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue) { exit 0 } exit 1" >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo [ERROR] Port %PORT% is still in use after trying to close PID %OPENHARNESS_PORT_PID%.
    echo Try running this launcher as Administrator, or use another port:
    echo   set PORT=4174
    echo   run_openharness_web.bat
    echo.
    pause
    exit /b 1
  )
)

echo [INFO] Starting server...
echo [INFO] Server bind host: %HOST%
echo [INFO] If another PC cannot connect, allow Node.js through Windows Firewall.
echo.

pushd "frontend\web"
call npm start
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
echo [INFO] Server stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
