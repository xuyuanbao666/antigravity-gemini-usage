@echo off
setlocal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node.exe"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" -Action Install -NodePath "%NODE%"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
