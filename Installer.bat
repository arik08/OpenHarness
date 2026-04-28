@echo off
setlocal EnableExtensions

title MyHarness Installer

cd /d "%~dp0"

set "OPENHARNESS_PROJECT_DIR=%CD%"
set "OPENHARNESS_CONFIG_DIR=%OPENHARNESS_PROJECT_DIR%\.openharness"
set "OPENHARNESS_HOME=%OPENHARNESS_CONFIG_DIR%"
set "OPENHARNESS_DATA_DIR=%OPENHARNESS_CONFIG_DIR%\data"
set "OPENHARNESS_LOGS_DIR=%OPENHARNESS_CONFIG_DIR%\logs"
set "OPENHARNESS_SETTINGS=%OPENHARNESS_CONFIG_DIR%\settings.json"

call :configure_posco_cert

echo.
echo ============================================================
echo   MyHarness Installer
echo ============================================================
echo.
echo   Project: %OPENHARNESS_PROJECT_DIR%
echo   Config:  %OPENHARNESS_CONFIG_DIR%
echo.

call :find_bootstrap_python
if errorlevel 1 (
  echo [ERROR] No usable Python 3.10+ was found.
  echo Tried OPENHARNESS_PYTHON, PYTHON, py -3, python, and python3.
  echo Install Python 3.10+ or set OPENHARNESS_PYTHON to a valid python.exe.
  echo.
  pause
  exit /b 1
)
echo [INFO] Using Python bootstrap: %OPENHARNESS_BOOTSTRAP_PYTHON% %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS%

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

echo [INFO] Upgrading pip...
call "%OPENHARNESS_BOOTSTRAP_PYTHON%" %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install --upgrade pip
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to upgrade pip.
  pause
  exit /b 1
)

echo [INFO] Installing MyHarness Python package and dependencies...
set "PYTHONPATH=%OPENHARNESS_PROJECT_DIR%\src;%PYTHONPATH%"
call "%OPENHARNESS_BOOTSTRAP_PYTHON%" %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install -e .
if errorlevel 1 (
  echo.
  echo [ERROR] Python package installation failed.
  pause
  exit /b 1
)

echo [INFO] Installing Python-pptx for PowerPoint document generation...
call "%OPENHARNESS_BOOTSTRAP_PYTHON%" %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install --upgrade python-pptx
if errorlevel 1 (
  echo.
  echo [ERROR] Python-pptx installation failed.
  pause
  exit /b 1
)

echo [INFO] Verifying Python runtime...
call "%OPENHARNESS_BOOTSTRAP_PYTHON%" %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS% -c "import importlib.util, sys; required=['openharness','anthropic','openai','rich','prompt_toolkit','textual','typer','pydantic','httpx','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi','pptx']; missing=[name for name in required if importlib.util.find_spec(name) is None]; print('Missing: ' + ', '.join(missing)) if missing else None; sys.exit(1 if missing else 0)"
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
call "%OPENHARNESS_BOOTSTRAP_PYTHON%" %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS% -c "from openharness.config.settings import load_settings; s=load_settings(); print(f'Provider: {s.provider} / {s.api_format} / {s.model}')"
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
echo   Python:           %OPENHARNESS_BOOTSTRAP_PYTHON% %OPENHARNESS_BOOTSTRAP_PYTHON_ARGS%
echo.
echo Next:
echo   1. Run run_openharness_web.bat
echo   2. Open http://localhost:4173
echo   3. Save P-GPT API Key and employee number in the app settings
echo.
pause
exit /b 0

:find_bootstrap_python
set "OPENHARNESS_BOOTSTRAP_PYTHON="
set "OPENHARNESS_BOOTSTRAP_PYTHON_ARGS="
if not "%OPENHARNESS_PYTHON%"=="" (
  call :try_bootstrap_python "%OPENHARNESS_PYTHON%" ""
  if not errorlevel 1 exit /b 0
)
if not "%PYTHON%"=="" (
  call :try_bootstrap_python "%PYTHON%" ""
  if not errorlevel 1 exit /b 0
)
call :try_bootstrap_python "py" "-3"
if not errorlevel 1 exit /b 0
call :try_bootstrap_python "python" ""
if not errorlevel 1 exit /b 0
call :try_bootstrap_python "python3" ""
if not errorlevel 1 exit /b 0
exit /b 1

:try_bootstrap_python
set "PY_CANDIDATE=%~1"
set "PY_CANDIDATE_ARGS=%~2"
call "%PY_CANDIDATE%" %PY_CANDIDATE_ARGS% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 exit /b 1
set "OPENHARNESS_BOOTSTRAP_PYTHON=%PY_CANDIDATE%"
set "OPENHARNESS_BOOTSTRAP_PYTHON_ARGS=%PY_CANDIDATE_ARGS%"
exit /b 0

:configure_posco_cert
if not exist "C:\POSCO.crt" exit /b 0
set "SSL_CERT_FILE=C:\POSCO.crt"
set "REQUESTS_CA_BUNDLE=C:\POSCO.crt"
set "CURL_CA_BUNDLE=C:\POSCO.crt"
set "PIP_CERT=C:\POSCO.crt"
set "NODE_EXTRA_CA_CERTS=C:\POSCO.crt"
set "npm_config_cafile=C:\POSCO.crt"
echo [INFO] POSCO certificate detected: C:\POSCO.crt
exit /b 0
