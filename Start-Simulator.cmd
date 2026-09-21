@echo off
setlocal
cd /d "%~dp0"
set "SYLPH_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%SYLPH_NODE%" goto run
set "SYLPH_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js is missing. Install Node.js 24 or newer and try again.
 pause
 exit /b 1
)
:run
"%SYLPH_NODE%" "%~dp0start-simulator.mjs" %*
if errorlevel 1 (
 pause
 exit /b 1
)
