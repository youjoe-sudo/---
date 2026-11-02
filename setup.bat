@echo off
REM ============================================================
REM  التهيئة الكاملة مرة واحدة: تثبيت الحزم + بناء الواجهة
REM ============================================================
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 goto :fail

echo [2/2] Building the interface...
call npm run build
if errorlevel 1 goto :fail

echo.
echo Done. Run start.bat to open the application.
echo تم. شغّل start.bat لفتح التطبيق.
pause
endlocal
exit /b 0

:fail
echo.
echo The setup failed. Please read the messages above.
pause
exit /b 1
