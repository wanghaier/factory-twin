@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found / Node.js not installed.
  echo Please install Node.js from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

node "scripts\start-demo.mjs"

echo.
echo Server stopped.
pause
