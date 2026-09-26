@echo off
setlocal
cd /d "%~dp0"
set "SYLPH_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SYLPH_NODE%" set "SYLPH_NODE=node"
"%SYLPH_NODE%" build.js
if errorlevel 1 exit /b 1
"%SYLPH_NODE%" --test --test-isolation=none test/*.test.mjs
exit /b %errorlevel%
