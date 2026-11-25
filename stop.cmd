@echo off
rem map-tool local stop: kill node processes running serve.js
setlocal
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'serve\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('stopped PID ' + $_.ProcessId) }"
