@echo off
cd /d "%~dp0"

echo.
echo ============================================================
echo  Firebase Auth Emulator + ローカルサーバー 起動
echo ============================================================
echo.

REM このPCのLAN IPアドレスを取得して表示
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set RAW_IP=%%a
    goto :found_ip
)
:found_ip
set LAN_IP=%RAW_IP: =%

echo  ★ 他端末からのアクセス URL:
echo    アプリ:         http://%LAN_IP%:3000/
echo    Emulator UI:   http://%LAN_IP%:4000/  （ユーザー管理画面）
echo.
echo  ※ ローカル起動時はどのGoogleアカウント（テスト）でもログイン可能
echo  ※ Firestoreは本番データをそのまま参照します
echo ============================================================
echo.
echo Auth Emulator を起動中...（Java 不要）

REM Firebase Auth Emulator のみ起動（Firestoreエミュレータは Java が必要なため除外）
start "Firebase Auth Emulator" cmd /k "cd /d %~dp0 && firebase emulators:start --only auth"

echo Emulator の起動を待っています（6秒）...
timeout /t 6 /nobreak >nul

echo.
echo ローカルサーバーを起動しています...
start http://localhost:3000/
node server.js
pause
