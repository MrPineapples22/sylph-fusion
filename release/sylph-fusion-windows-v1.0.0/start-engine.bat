@echo off
title Sylph Fusion - Autonomous Strategy Engine
echo ===================================================================
echo   SYLPH FUSION - HIGH FREQUENCY EXECUTION ENGINE
echo ===================================================================
if not exist .env (
  echo Error: .env file missing. Run start-dashboard.bat first.
  pause
  exit /b 1
)
echo Starting execution engine with pre-trade risk and staleness gates...
node --env-file=.env dist/fusion.js
pause
