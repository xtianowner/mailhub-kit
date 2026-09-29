@echo off
rem Start local MailHub (reuses a running instance) and open the browser.
cd /d "%~dp0"
node kit\scripts\local.mjs start --open
