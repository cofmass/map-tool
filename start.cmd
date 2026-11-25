@echo off
rem map-tool local start (background). Usage: start.cmd [port] (default 6102)
setlocal
set PORT=%~1
if "%PORT%"=="" set PORT=6102
set DIR=%~dp0
rem kill stale process on that port if any
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>&1
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'serve.js','%PORT%' -WorkingDirectory '%DIR%' -WindowStyle Hidden"
ping -n 2 127.0.0.1 >nul
start "" http://localhost:%PORT%
echo map-tool started at http://localhost:%PORT% (background; use stop.cmd to stop)
