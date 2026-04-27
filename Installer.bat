@echo off
setlocal EnableExtensions

title MyHarness Installer

cd /d "%~dp0"

set "OPENHARNESS_PROJECT_DIR=%CD%"
set "OPENHARNESS_CONFIG_DIR=%OPENHARNESS_PROJECT_DIR%\.openharness"
set "OPENHARNESS_HOME=%OPENHARNESS_CONFIG_DIR%"
set "OPENHARNESS_VENV=%OPENHARNESS_CONFIG_DIR%\venv"
set "OPENHARNESS_DATA_DIR=%OPENHARNESS_CONFIG_DIR%\data"
set "OPENHARNESS_LOGS_DIR=%OPENHARNESS_CONFIG_DIR%\logs"
set "OPENHARNESS_SETTINGS=%OPENHARNESS_CONFIG_DIR%\settings.json"

echo.
echo ============================================================
echo   MyHarness Installer
echo ============================================================
echo.
echo   Project: %OPENHARNESS_PROJECT_DIR%
echo   Config:  %OPENHARNESS_CONFIG_DIR%
echo   Venv:    %OPENHARNESS_VENV%
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python launcher py.exe was not found on PATH.
  echo Install Python 3.10+ first, then run this installer again.
  echo.
  pause
  exit /b 1
)

py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3.10 or newer is required.
  echo Install a newer Python, then run this installer again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo Install Node.js LTS first, then run this installer again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH.
  echo Install Node.js with npm first, then run this installer again.
  echo.
  pause
  exit /b 1
)

echo [INFO] Preparing project-local directories...
if not exist "%OPENHARNESS_CONFIG_DIR%" mkdir "%OPENHARNESS_CONFIG_DIR%"
if not exist "%OPENHARNESS_DATA_DIR%" mkdir "%OPENHARNESS_DATA_DIR%"
if not exist "%OPENHARNESS_DATA_DIR%\memory" mkdir "%OPENHARNESS_DATA_DIR%\memory"
if not exist "%OPENHARNESS_DATA_DIR%\sessions" mkdir "%OPENHARNESS_DATA_DIR%\sessions"
if not exist "%OPENHARNESS_DATA_DIR%\tasks" mkdir "%OPENHARNESS_DATA_DIR%\tasks"
if not exist "%OPENHARNESS_LOGS_DIR%" mkdir "%OPENHARNESS_LOGS_DIR%"
if not exist "Playground" mkdir "Playground"
if not exist "Playground\Default" mkdir "Playground\Default"
if not exist "Playground\shared\Default" mkdir "Playground\shared\Default"

if not exist "%OPENHARNESS_SETTINGS%" (
  echo [INFO] Creating default settings...
  > "%OPENHARNESS_SETTINGS%" echo {
  >> "%OPENHARNESS_SETTINGS%" echo   "active_profile": "p-gpt"
  >> "%OPENHARNESS_SETTINGS%" echo }
) else (
  echo [INFO] Existing settings.json found. Keeping it.
)

if not exist ".openharness\credentials.example.json" (
  echo [INFO] Creating credentials example...
  > ".openharness\credentials.example.json" echo {
  >> ".openharness\credentials.example.json" echo   "pgpt": {
  >> ".openharness\credentials.example.json" echo     "api_key": "YOUR_PGPT_API_KEY",
  >> ".openharness\credentials.example.json" echo     "employee_no": "YOUR_EMPLOYEE_NO",
  >> ".openharness\credentials.example.json" echo     "company_code": "30"
  >> ".openharness\credentials.example.json" echo   }
  >> ".openharness\credentials.example.json" echo }
)

if not exist "%OPENHARNESS_VENV%\Scripts\python.exe" (
  echo [INFO] Creating Python virtual environment...
  py -3 -m venv "%OPENHARNESS_VENV%"
  if errorlevel 1 (
    echo.
    echo [ERROR] Failed to create Python virtual environment.
    pause
    exit /b 1
  )
) else (
  echo [INFO] Python virtual environment already exists.
)

echo [INFO] Upgrading pip...
call "%OPENHARNESS_VENV%\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to upgrade pip.
  pause
  exit /b 1
)

echo [INFO] Installing MyHarness Python package and dependencies...
set "PYTHONPATH=%OPENHARNESS_PROJECT_DIR%\src;%PYTHONPATH%"
call "%OPENHARNESS_VENV%\Scripts\python.exe" -m pip install -e .
if errorlevel 1 (
  echo.
  echo [ERROR] Python package installation failed.
  pause
  exit /b 1
)

echo [INFO] Installing document generation dependencies...
call "%OPENHARNESS_VENV%\Scripts\python.exe" -m pip install python-pptx
if errorlevel 1 (
  echo.
  echo [ERROR] Document generation dependency installation failed.
  pause
  exit /b 1
)

echo [INFO] Verifying Python runtime...
call "%OPENHARNESS_VENV%\Scripts\python.exe" -c "import importlib.util, sys; required=['openharness','anthropic','openai','rich','prompt_toolkit','textual','typer','pydantic','httpx','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi','pptx']; missing=[name for name in required if importlib.util.find_spec(name) is None]; print('Missing: ' + ', '.join(missing)) if missing else None; sys.exit(1 if missing else 0)"
if errorlevel 1 (
  echo.
  echo [ERROR] Python dependency verification failed.
  pause
  exit /b 1
)

echo [INFO] Installing web dependencies...
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
  echo [ERROR] Web dependency installation failed.
  pause
  exit /b 1
)
popd

echo [INFO] Verifying web files...
node --check "frontend\web\server.mjs"
if errorlevel 1 (
  echo.
  echo [ERROR] frontend\web\server.mjs has a syntax error.
  pause
  exit /b 1
)
node --check "frontend\web\script.js"
if errorlevel 1 (
  echo.
  echo [ERROR] frontend\web\script.js has a syntax error.
  pause
  exit /b 1
)

echo [INFO] Verifying provider defaults...
call "%OPENHARNESS_VENV%\Scripts\python.exe" -c "from openharness.config.settings import load_settings; s=load_settings(); print(f'Provider: {s.provider} / {s.api_format} / {s.model}')"
if errorlevel 1 (
  echo.
  echo [ERROR] Provider settings verification failed.
  pause
  exit /b 1
)

echo.
echo [OK] MyHarness is installed in this project folder.
echo.
echo   URL after launch: http://localhost:4173
echo   Config:           %OPENHARNESS_CONFIG_DIR%
echo   Data:             %OPENHARNESS_DATA_DIR%
echo   Logs:             %OPENHARNESS_LOGS_DIR%
echo   Venv:             %OPENHARNESS_VENV%
echo.
echo Next:
echo   1. Run run_openharness_web.bat
echo   2. Open http://localhost:4173
echo   3. Save P-GPT API Key and employee number in the app settings
echo.
pause
exit /b 0
