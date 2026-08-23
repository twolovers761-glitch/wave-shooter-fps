@echo off
cd /d "%~dp0"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "if (-not (Get-NetTCPConnection -LocalPort 8123 -ErrorAction SilentlyContinue)) { Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0serve.ps1' -WindowStyle Hidden }"
timeout /t 1 /nobreak > nul
start "" "http://localhost:8123"
