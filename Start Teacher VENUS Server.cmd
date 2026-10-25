@echo off
setlocal
title Teacher VENUS Local Server - Keep This Window Open
cd /d "%~dp0"

set "PYTHON="
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" set "PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not defined PYTHON where py.exe >nul 2>nul && set "PYTHON=py.exe -3"
if not defined PYTHON where python.exe >nul 2>nul && set "PYTHON=python.exe"

if not defined PYTHON (
  echo Python could not be found on this computer.
  echo Please open this project through Codex, or install Python from python.org.
  pause
  exit /b 1
)

echo.
echo Teacher VENUS website is starting...
echo Open: http://localhost:3000
echo Keep this window open while using the website.
echo Press Ctrl+C to stop the server.
echo.

if "%PYTHON%"=="py.exe -3" (
  py.exe -3 -m http.server 3000 --bind 127.0.0.1
) else (
  "%PYTHON%" -m http.server 3000 --bind 127.0.0.1
)

echo.
echo The server has stopped.
pause
