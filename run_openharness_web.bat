@echo off
setlocal EnableExtensions

title OpenHarness Web Backend

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=4173"
if "%HOST%"=="" set "HOST=0.0.0.0"
set "OPENHARNESS_URL=http://localhost:%PORT%"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip }"`) do set "OPENHARNESS_LAN_IP=%%I"
if not "%OPENHARNESS_LAN_IP%"=="" set "OPENHARNESS_LAN_URL=http://%OPENHARNESS_LAN_IP%:%PORT%"
if "%OPENHARNESS_CONFIG_DIR%"=="" set "OPENHARNESS_CONFIG_DIR=%CD%\.openharness"
if "%OPENHARNESS_DATA_DIR%"=="" set "OPENHARNESS_DATA_DIR=%OPENHARNESS_CONFIG_DIR%\data"
if "%OPENHARNESS_LOGS_DIR%"=="" set "OPENHARNESS_LOGS_DIR=%OPENHARNESS_CONFIG_DIR%\logs"
set "OPENHARNESS_HOME=%OPENHARNESS_CONFIG_DIR%"
set "OPENHARNESS_VENV_PY=%OPENHARNESS_HOME%\venv\Scripts\python.exe"
set "OPENHARNESS_SETTINGS=%OPENHARNESS_CONFIG_DIR%\settings.json"

echo.
echo ============================================================
echo   OpenHarness Web Backend
echo ============================================================
echo.
echo   URL: %OPENHARNESS_URL%
if not "%OPENHARNESS_LAN_URL%"=="" echo   LAN: %OPENHARNESS_LAN_URL%
echo   Config: %OPENHARNESS_CONFIG_DIR%
if "%OPENHARNESS_WORKSPACE_SCOPE%"=="" (
  echo   Workspace scope: app setting
) else (
  echo   Workspace scope: %OPENHARNESS_WORKSPACE_SCOPE%
)
echo.
echo   This window is running the web server and backend launcher.
echo   Keep it open while using OpenHarness in the browser.
echo   Press Ctrl+C in this window to stop the server.
echo   Press R in this window to restart the server.
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

echo [INFO] Preparing project-local runtime directories...
if not exist "%OPENHARNESS_CONFIG_DIR%" mkdir "%OPENHARNESS_CONFIG_DIR%"
if not exist "%OPENHARNESS_DATA_DIR%" mkdir "%OPENHARNESS_DATA_DIR%"
if not exist "%OPENHARNESS_LOGS_DIR%" mkdir "%OPENHARNESS_LOGS_DIR%"
if not exist "Playground" mkdir "Playground"
if not exist "Playground\Default" mkdir "Playground\Default"
if not exist "Playground\shared\Default" mkdir "Playground\shared\Default"
if not exist "%OPENHARNESS_SETTINGS%" (
  > "%OPENHARNESS_SETTINGS%" echo {
  >> "%OPENHARNESS_SETTINGS%" echo   "active_profile": "p-gpt"
  >> "%OPENHARNESS_SETTINGS%" echo }
)

call :ensure_pgpt_env

echo [INFO] Checking Python package dependencies...
set "PYTHONPATH=%CD%\src;%PYTHONPATH%"
if not exist "%OPENHARNESS_VENV_PY%" (
  echo [INFO] Creating project-local Python virtual environment...
  py -3 -m venv "%OPENHARNESS_HOME%\venv"
  if errorlevel 1 (
    echo.
    echo [ERROR] Python virtual environment creation failed.
    echo Run Installer.bat and try again.
    pause
    exit /b 1
  )
)
set "OPENHARNESS_PYTHON=%OPENHARNESS_VENV_PY%"

%OPENHARNESS_PYTHON% -c "import importlib.util, sys; required=['openharness','anthropic','openai','rich','prompt_toolkit','textual','typer','pydantic','httpx','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi']; missing=[name for name in required if importlib.util.find_spec(name) is None]; sys.exit(1 if missing else 0)" >nul 2>nul
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
  %OPENHARNESS_PYTHON% -c "import importlib.util, sys; required=['openharness','anthropic','openai','rich','prompt_toolkit','textual','typer','pydantic','httpx','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi']; missing=[name for name in required if importlib.util.find_spec(name) is None]; sys.exit(1 if missing else 0)" >nul 2>nul
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
  if exist "package-lock.json" (
    call npm ci
    if errorlevel 1 (
      echo [WARN] npm ci failed. Retrying with npm install...
      call npm install
    )
  ) else (
    call npm install
  )
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
echo [INFO] Press R in this window to restart the server.
echo.

pushd "frontend\web"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_openharness_web_server.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
echo [INFO] Server stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

:ensure_pgpt_env
set "PGPT_ENV_MISSING="
if "%PGPT_API_KEY%"=="" set "PGPT_ENV_MISSING=1"
if "%PGPT_EMPLOYEE_NO%"=="" set "PGPT_ENV_MISSING=1"
if "%PGPT_ENV_MISSING%"=="" exit /b 0

echo.
echo [INFO] P-GPT environment variables are not fully configured.
echo        Required for P-GPT: PGPT_API_KEY, PGPT_EMPLOYEE_NO
echo        Company code is fixed to 30 by the app and will not be saved as an environment variable.
echo        You may skip this if you use another provider.
echo.
set "PGPT_SETUP_CHOICE="
set /p "PGPT_SETUP_CHOICE=Set and permanently save P-GPT environment variables now? [y/N]: "
if /i not "%PGPT_SETUP_CHOICE%"=="Y" (
  echo [INFO] Skipping P-GPT environment setup.
  echo        You can still use another provider, or configure P-GPT later in app settings.
  exit /b 0
)

echo.
echo [INFO] Values entered here will be saved permanently to your Windows user environment with setx.
echo        setx applies to future terminals; this launcher will also use them for the current run.
echo        To change them later, run setx again or edit Windows Environment Variables.
echo.

if not "%PGPT_API_KEY%"=="" goto pgpt_employee_no
set "PGPT_API_KEY_INPUT="
set /p "PGPT_API_KEY_INPUT=PGPT_API_KEY: "
if "%PGPT_API_KEY_INPUT%"=="" goto pgpt_employee_no
set "PGPT_API_KEY=%PGPT_API_KEY_INPUT%"
setx PGPT_API_KEY "%PGPT_API_KEY_INPUT%" >nul
if errorlevel 1 echo [WARN] Failed to permanently save PGPT_API_KEY with setx.

:pgpt_employee_no
if not "%PGPT_EMPLOYEE_NO%"=="" goto pgpt_env_done
set "PGPT_EMPLOYEE_NO_INPUT="
set /p "PGPT_EMPLOYEE_NO_INPUT=PGPT_EMPLOYEE_NO: "
if "%PGPT_EMPLOYEE_NO_INPUT%"=="" goto pgpt_env_done
set "PGPT_EMPLOYEE_NO=%PGPT_EMPLOYEE_NO_INPUT%"
setx PGPT_EMPLOYEE_NO "%PGPT_EMPLOYEE_NO_INPUT%" >nul
if errorlevel 1 echo [WARN] Failed to permanently save PGPT_EMPLOYEE_NO with setx.

:pgpt_env_done
echo [INFO] P-GPT environment setup finished.
exit /b 0
