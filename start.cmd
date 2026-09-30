@echo off
rem Start local MailHub (reuses a running instance) and open the browser.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0kit\scripts\node.ps1" kit/scripts/local.mjs start --open
exit /b %errorlevel%
