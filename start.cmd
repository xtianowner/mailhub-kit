@echo off
rem Start local MailHub (reuses a running instance) and open the browser.
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0kit\scripts\node.ps1" kit/scripts/local.mjs start --open
set "MAILHUB_RC=%errorlevel%"
rem Double-clicked windows close at once; on failure keep the error readable for up to 60 seconds.
rem timeout exits immediately when input is redirected (e.g. run by an AI tool), so automation never hangs.
if not "%MAILHUB_RC%"=="0" (
  echo MailHub start failed. See the messages above.
  timeout /t 60
)
exit /b %MAILHUB_RC%
