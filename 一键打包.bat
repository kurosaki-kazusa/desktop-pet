@echo off
rem ============================================================
rem  AI Desktop Pet - One-click Build (clean package)
rem  Packs to TEMP (avoids sync-drive file locks on D:\Documents),
rem  verifies the asar content is clean, copies the installer back
rem  to dist\. Personal config/user data never enters the package.
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\dist-temp.ps1"
echo.
pause
