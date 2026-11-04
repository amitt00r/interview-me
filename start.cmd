@echo off
rem Starts the backend, then the frontend (Windows). Runs start.ps1 without changing the PowerShell execution policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
