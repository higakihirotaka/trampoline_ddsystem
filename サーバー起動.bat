@echo off
cd /d "%~dp0"
echo サーバーを起動しています...
echo http://localhost:3000/
start http://localhost:3000/
node server.js
pause
