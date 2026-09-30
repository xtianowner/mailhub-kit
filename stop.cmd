@echo off
rem Stop local MailHub and verify the process and port are released.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0kit\scripts\node.ps1" kit/scripts/local.mjs stop
exit /b %errorlevel%
