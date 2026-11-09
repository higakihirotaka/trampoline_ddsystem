@echo off
cd /d "%~dp0"
echo サーバーを起動しています...

REM 相手（PC-B）のIPアドレスを指定
set QIRA_TARGET_IP=192.168.1.21

echo 相手先(QIRA) IP: %QIRA_TARGET_IP%
echo http://localhost:3000/
start http://localhost:3000/
node server.js
pause