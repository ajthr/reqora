@echo off
setlocal
if exist "%~dp0web\runtime\node.exe" (
  "%~dp0web\runtime\node.exe" "%~dp0web\app\cli\main.js" %*
) else (
  set ELECTRON_RUN_AS_NODE=1
  "%~dp0desktop\reqora.exe" "%~dp0desktop\resources\app\dist-electron\cli\main.js" %*
)
exit /b %errorlevel%
