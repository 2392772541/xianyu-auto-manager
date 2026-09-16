@echo off
cd /d "%~dp0downloader"
where node >nul 2>nul
if errorlevel 1 (echo Please install Node.js first. & pause & exit /b 1)
if not exist node_modules (call npm.cmd ci || exit /b 1)
powershell -NoProfile -Command "try { $r=Invoke-WebRequest 'http://127.0.0.1:8792/api/jobs' -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:8792'; exit 0 } } catch {}; exit 1"
if not errorlevel 1 exit /b 0
set FISH_OPEN=1
node server.mjs
pause
