@echo off
rem Stop local MailHub and verify the process and port are released.
cd /d "%~dp0"
node kit\scripts\local.mjs stop
