@echo off
setlocal EnableExtensions

title MyHarness Installer

cd /d "%~dp0"

set "MYHARNESS_PROJECT_DIR=%CD%"
set "MYHARNESS_CONFIG_DIR=%MYHARNESS_PROJECT_DIR%\.myharness"
set "MYHARNESS_HOME=%MYHARNESS_CONFIG_DIR%"
set "MYHARNESS_DATA_DIR=%MYHARNESS_CONFIG_DIR%\data"
set "MYHARNESS_LOGS_DIR=%MYHARNESS_CONFIG_DIR%\logs"
set "MYHARNESS_SETTINGS=%MYHARNESS_CONFIG_DIR%\settings.json"

call :configure_posco_cert

echo.
echo ============================================================
echo   MyHarness Installer
echo ============================================================
echo.
echo   Project: %MYHARNESS_PROJECT_DIR%
echo   Config:  %MYHARNESS_CONFIG_DIR%
echo.

call :find_bootstrap_python
if errorlevel 1 (
  echo [ERROR] No usable Python 3.10+ was found.
  echo Tried MYHARNESS_PYTHON, PYTHON, py -3, python, and python3.
  echo Install Python 3.10+ or set MYHARNESS_PYTHON to a valid python.exe.
  echo.
  pause
  exit /b 1
)
echo [INFO] Using Python bootstrap: %MYHARNESS_BOOTSTRAP_PYTHON% %MYHARNESS_BOOTSTRAP_PYTHON_ARGS%

call :upgrade_posco_bundle
if errorlevel 1 (
  echo.
  echo [ERROR] POSCO CA bundle setup failed.
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
if not exist "%MYHARNESS_CONFIG_DIR%" mkdir "%MYHARNESS_CONFIG_DIR%"
if not exist "%MYHARNESS_DATA_DIR%" mkdir "%MYHARNESS_DATA_DIR%"
if not exist "%MYHARNESS_DATA_DIR%\memory" mkdir "%MYHARNESS_DATA_DIR%\memory"
if not exist "%MYHARNESS_DATA_DIR%\sessions" mkdir "%MYHARNESS_DATA_DIR%\sessions"
if not exist "%MYHARNESS_DATA_DIR%\tasks" mkdir "%MYHARNESS_DATA_DIR%\tasks"
if not exist "%MYHARNESS_LOGS_DIR%" mkdir "%MYHARNESS_LOGS_DIR%"
if not exist "Playground" mkdir "Playground"
if not exist "Playground\Default" mkdir "Playground\Default"
if not exist "Playground\shared\Default" mkdir "Playground\shared\Default"

if not exist "%MYHARNESS_SETTINGS%" (
  echo [INFO] Creating default settings...
  > "%MYHARNESS_SETTINGS%" echo {
  >> "%MYHARNESS_SETTINGS%" echo   "active_profile": "p-gpt"
  >> "%MYHARNESS_SETTINGS%" echo }
) else (
  echo [INFO] Existing settings.json found. Keeping it.
)

echo [INFO] Upgrading pip...
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install --upgrade pip
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to upgrade pip.
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
echo [INFO] Building React web UI...
pushd "frontend\web"
call npm run build
if errorlevel 1 (
  popd
  echo.
  echo [ERROR] React web UI build failed.
  pause
  exit /b 1
)
popd

echo [INFO] Installing MyHarness Python package and dependencies...
set "PYTHONPATH=%MYHARNESS_PROJECT_DIR%\src;%PYTHONPATH%"
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install -e .
if errorlevel 1 (
  echo.
  echo [ERROR] Python package installation failed.
  pause
  exit /b 1
)

echo [INFO] Installing Python-pptx for PowerPoint document generation...
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install --upgrade python-pptx
if errorlevel 1 (
  echo.
  echo [ERROR] Python-pptx installation failed.
  pause
  exit /b 1
)

echo [INFO] Installing pytest for local verification...
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install --upgrade pytest
if errorlevel 1 (
  echo.
  echo [ERROR] pytest installation failed.
  pause
  exit /b 1
)

echo [INFO] Verifying Python runtime...
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -c "import importlib.util, sys; required=['myharness','anthropic','openai','tiktoken','rich','prompt_toolkit','textual','typer','pydantic','httpx','feedparser','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi','pptx','pytest']; missing=[name for name in required if importlib.util.find_spec(name) is None]; print('Missing: ' + ', '.join(missing)) if missing else None; sys.exit(1 if missing else 0)"
if errorlevel 1 (
  echo.
  echo [ERROR] Python dependency verification failed.
  pause
  exit /b 1
)

echo [INFO] Verifying provider defaults...
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -c "from myharness.config.settings import load_settings; s=load_settings(); print(f'Provider: {s.provider} / {s.api_format} / {s.model}')"
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
echo   Config:           %MYHARNESS_CONFIG_DIR%
echo   Data:             %MYHARNESS_DATA_DIR%
echo   Logs:             %MYHARNESS_LOGS_DIR%
echo   Python:           %MYHARNESS_BOOTSTRAP_PYTHON% %MYHARNESS_BOOTSTRAP_PYTHON_ARGS%
echo.
echo Next:
echo   1. Run run_myharness_web.bat
echo   2. Open http://localhost:4173
echo   3. Save P-GPT API Key and employee number in the app settings
echo.
pause
exit /b 0

:find_bootstrap_python
set "MYHARNESS_BOOTSTRAP_PYTHON="
set "MYHARNESS_BOOTSTRAP_PYTHON_ARGS="
if not "%MYHARNESS_PYTHON%"=="" (
  call :try_bootstrap_python "%MYHARNESS_PYTHON%" ""
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
"%PY_CANDIDATE%" %PY_CANDIDATE_ARGS% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 exit /b 1
set "MYHARNESS_BOOTSTRAP_PYTHON=%PY_CANDIDATE%"
set "MYHARNESS_BOOTSTRAP_PYTHON_ARGS=%PY_CANDIDATE_ARGS%"
exit /b 0

:configure_posco_cert
if not exist "C:\POSCO_CA.crt" exit /b 0
set "POSCO_CA_CERT=C:\POSCO_CA.crt"
set "POSCO_CA_BUNDLE=%CD%\certs\posco-ca-bundle.pem"
if exist "%POSCO_CA_BUNDLE%" (
  set "SSL_CERT_FILE=%POSCO_CA_BUNDLE%"
  set "REQUESTS_CA_BUNDLE=%POSCO_CA_BUNDLE%"
  set "CURL_CA_BUNDLE=%POSCO_CA_BUNDLE%"
  set "PIP_CERT=%POSCO_CA_BUNDLE%"
)
set "NODE_EXTRA_CA_CERTS=C:\POSCO_CA.crt"
set "npm_config_cafile=C:\POSCO_CA.crt"
if "%NODE_OPTIONS%"=="" (
  set "NODE_OPTIONS=--tls-cipher-list=DEFAULT@SECLEVEL=1"
) else (
  set "NODE_OPTIONS=--tls-cipher-list=DEFAULT@SECLEVEL=1 %NODE_OPTIONS%"
)
echo [INFO] POSCO certificate detected: C:\POSCO_CA.crt
echo [INFO] Node TLS compatibility mode enabled for POSCO CA.
exit /b 0

:upgrade_posco_bundle
if not exist "C:\POSCO_CA.crt" exit /b 0
echo [INFO] Building POSCO Python CA bundle...
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% "%MYHARNESS_PROJECT_DIR%\scripts\build_posco_ca_bundle.py"
if errorlevel 1 exit /b 1
set "POSCO_CA_BUNDLE=%MYHARNESS_PROJECT_DIR%\certs\posco-ca-bundle.pem"
set "SSL_CERT_FILE=%POSCO_CA_BUNDLE%"
set "REQUESTS_CA_BUNDLE=%POSCO_CA_BUNDLE%"
set "CURL_CA_BUNDLE=%POSCO_CA_BUNDLE%"
set "PIP_CERT=%POSCO_CA_BUNDLE%"
set "NODE_EXTRA_CA_CERTS=C:\POSCO_CA.crt"
set "npm_config_cafile=C:\POSCO_CA.crt"
exit /b 0
