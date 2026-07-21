@echo off
setlocal
title Teacher VENUS Local Server - Keep This Window Open
cd /d "%~dp0"

set "PYTHON=python"

echo.
echo Teacher VENUS website is starting...
echo Open: http://localhost:3000
echo Keep this window open while using the website.
echo Press Ctrl+C to stop the server.
echo.

"%PYTHON%" -m http.server 3000 --bind 127.0.0.1

echo.
echo The server has stopped.
pause
