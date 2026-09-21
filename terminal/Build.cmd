@echo off
setlocal
cd /d "%~dp0"
set "SYLPH_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SYLPH_NODE%" set "SYLPH_NODE=node"
set "SYLPH_ESBUILD="
for /r "%~dp0node_modules\.pnpm" %%E in (esbuild.exe) do if exist "%%E" set "SYLPH_ESBUILD=%%E"
if not defined SYLPH_ESBUILD (
 echo Dependencies are missing. Run pnpm --ignore-workspace install first.
 exit /b 1
)
if not exist dist\assets mkdir dist\assets
"%SYLPH_ESBUILD%" src/main.jsx --bundle --minify --format=esm --outfile=dist/assets/app.js --loader:.css=empty --define:process.env.NODE_ENV=\"production\"
if errorlevel 1 exit /b 1
"%SYLPH_ESBUILD%" ../src/execution-engine.ts --bundle --format=esm --platform=node --outfile=dist/execution-engine.js
if errorlevel 1 exit /b 1
"%SYLPH_NODE%" build-assets.mjs
if errorlevel 1 exit /b 1
"%SYLPH_NODE%" --test --test-isolation=none test/*.test.mjs
