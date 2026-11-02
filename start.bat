@echo off
REM ============================================================
REM  نظام متابعة الغياب اليومي — تشغيل التطبيق المحلي
REM  يفتح: http://127.0.0.1:5199
REM ============================================================
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if not exist "node_modules" (
  echo [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo [1/3] Dependencies are already installed.
)

if not exist "dist\index.html" (
  echo [2/3] Building the interface...
  call npm run build
  if errorlevel 1 goto :fail
) else (
  echo [2/3] The interface is already built.
)

echo [3/3] Starting the local server...
start "" "http://127.0.0.1:5199"
call npm start

endlocal
exit /b 0

:fail
echo.
echo The setup failed. Please read the messages above.
pause
exit /b 1
