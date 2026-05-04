@echo off
setlocal EnableExtensions

title MyHarness Web Backend

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=4173"
if "%HOST%"=="" set "HOST=0.0.0.0"
set "MYHARNESS_URL=http://localhost:%PORT%"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip }"`) do set "MYHARNESS_LAN_IP=%%I"
if not "%MYHARNESS_LAN_IP%"=="" set "MYHARNESS_LAN_URL=http://%MYHARNESS_LAN_IP%:%PORT%"
if "%MYHARNESS_CONFIG_DIR%"=="" set "MYHARNESS_CONFIG_DIR=%CD%\.myharness"
if "%MYHARNESS_DATA_DIR%"=="" set "MYHARNESS_DATA_DIR=%MYHARNESS_CONFIG_DIR%\data"
if "%MYHARNESS_LOGS_DIR%"=="" set "MYHARNESS_LOGS_DIR=%MYHARNESS_CONFIG_DIR%\logs"
set "MYHARNESS_HOME=%MYHARNESS_CONFIG_DIR%"
set "MYHARNESS_SETTINGS=%MYHARNESS_CONFIG_DIR%\settings.json"

call :configure_posco_cert

echo.
echo ============================================================
echo   MyHarness Web Backend
echo ============================================================
echo.
echo   URL: %MYHARNESS_URL%
if not "%MYHARNESS_LAN_URL%"=="" echo   LAN: %MYHARNESS_LAN_URL%
echo   Config: %MYHARNESS_CONFIG_DIR%
echo   Logs: %MYHARNESS_LOGS_DIR%
if "%MYHARNESS_WORKSPACE_SCOPE%"=="" (
  echo   Workspace scope: app setting
) else (
  echo   Workspace scope: %MYHARNESS_WORKSPACE_SCOPE%
)
echo.
echo   This window is running the web server and backend launcher.
echo   Keep it open while using MyHarness in the browser.
echo   Press Q or Ctrl+C in this window to stop the server.
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

echo [INFO] Preparing project-local runtime directories...
if not exist "%MYHARNESS_CONFIG_DIR%" mkdir "%MYHARNESS_CONFIG_DIR%"
if not exist "%MYHARNESS_DATA_DIR%" mkdir "%MYHARNESS_DATA_DIR%"
if not exist "%MYHARNESS_LOGS_DIR%" mkdir "%MYHARNESS_LOGS_DIR%"
if not exist "Playground" mkdir "Playground"
if not exist "Playground\Default" mkdir "Playground\Default"
if not exist "Playground\shared\Default" mkdir "Playground\shared\Default"
if not exist "%MYHARNESS_SETTINGS%" (
  > "%MYHARNESS_SETTINGS%" echo {
  >> "%MYHARNESS_SETTINGS%" echo   "active_profile": "p-gpt"
  >> "%MYHARNESS_SETTINGS%" echo }
)

call :ensure_pgpt_env

echo [INFO] Checking Python package dependencies...
set "PYTHONPATH=%CD%\src;%PYTHONPATH%"
call :find_bootstrap_python
if errorlevel 1 (
  echo [ERROR] No usable Python 3.10+ was found.
  echo Tried MYHARNESS_PYTHON, PYTHON, py -3, python, and python3.
  echo Install Python 3.10+ or run Installer.bat after setting MYHARNESS_PYTHON.
  echo.
  pause
  exit /b 1
)
echo [INFO] Using Python: %MYHARNESS_BOOTSTRAP_PYTHON% %MYHARNESS_BOOTSTRAP_PYTHON_ARGS%

call :upgrade_posco_bundle
if errorlevel 1 (
  echo.
  echo [ERROR] POSCO CA bundle setup failed.
  pause
  exit /b 1
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

if not exist "frontend\web\dist\index.html" (
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
) else (
  echo [INFO] React web UI build is already available.
)

"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -c "import importlib.util, sys; required=['myharness','anthropic','openai','tiktoken','rich','prompt_toolkit','textual','typer','pydantic','httpx','feedparser','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi']; missing=[name for name in required if importlib.util.find_spec(name) is None]; sys.exit(1 if missing else 0)" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Missing Python dependencies detected. Installing now...
  "%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -m pip install -e .
  if errorlevel 1 (
    echo.
    echo [ERROR] Python dependency installation failed.
    echo Run Installer.bat and try again.
    pause
    exit /b 1
  )
  "%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% -c "import importlib.util, sys; required=['myharness','anthropic','openai','tiktoken','rich','prompt_toolkit','textual','typer','pydantic','httpx','feedparser','websockets','mcp','pyperclip','yaml','questionary','watchfiles','croniter','slack_sdk','telegram','discord','lark_oapi']; missing=[name for name in required if importlib.util.find_spec(name) is None]; sys.exit(1 if missing else 0)" >nul 2>nul
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

set "MYHARNESS_PORT_PID="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$conn = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Write-Output $conn.OwningProcess }"`) do (
  set "MYHARNESS_PORT_PID=%%A"
)

if not "%MYHARNESS_PORT_PID%"=="" (
  echo [INFO] Port %PORT% is already in use by PID %MYHARNESS_PORT_PID%.
  echo [INFO] Closing the existing process and starting MyHarness fresh...
  taskkill /PID %MYHARNESS_PORT_PID% /T /F >nul 2>nul
  timeout /t 1 /nobreak >nul

  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue) { exit 0 } exit 1" >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo [ERROR] Port %PORT% is still in use after trying to close PID %MYHARNESS_PORT_PID%.
    echo Try running this launcher as Administrator, or use another port:
    echo   set PORT=4174
    echo   run_myharness_web.bat
    echo.
    pause
    exit /b 1
  )
)

echo [INFO] Starting server...
echo [INFO] Server bind host: %HOST%
echo [INFO] If another PC cannot connect, allow Node.js through Windows Firewall.
echo [INFO] If the server process exits unexpectedly, this launcher will restart it.
echo [INFO] Press Q or Ctrl+C in this window to stop the server.
echo [INFO] Press R in this window to restart the server.
echo.

pushd "frontend\web"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_myharness_web_server.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
echo [INFO] Server stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

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
"%MYHARNESS_BOOTSTRAP_PYTHON%" %MYHARNESS_BOOTSTRAP_PYTHON_ARGS% "%CD%\scripts\build_posco_ca_bundle.py"
if errorlevel 1 exit /b 1
set "POSCO_CA_BUNDLE=%CD%\certs\posco-ca-bundle.pem"
set "SSL_CERT_FILE=%POSCO_CA_BUNDLE%"
set "REQUESTS_CA_BUNDLE=%POSCO_CA_BUNDLE%"
set "CURL_CA_BUNDLE=%POSCO_CA_BUNDLE%"
set "PIP_CERT=%POSCO_CA_BUNDLE%"
set "NODE_EXTRA_CA_CERTS=C:\POSCO_CA.crt"
set "npm_config_cafile=C:\POSCO_CA.crt"
exit /b 0

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
