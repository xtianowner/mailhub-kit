@echo off
rem Run setup with the Node runtime recorded during installation.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0kit\scripts\node.ps1" kit/scripts/setup.mjs %*
exit /b %errorlevel%
