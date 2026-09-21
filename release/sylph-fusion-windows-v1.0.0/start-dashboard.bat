@echo off
title Sylph Fusion - Solana Trading Dashboard
echo ===================================================================
echo   SYLPH FUSION - COMMERCIAL GRADE SOLANA TRADING APPLICATION
echo   Version: 1.0.0-PROD (Windows x64)
echo ===================================================================
echo [1/2] Checking environment configuration...
if not exist .env (
  echo No .env found. Copying from .env.example template...
  copy .env.example .env
  echo IMPORTANT: Please edit .env with your private RPC/WSS endpoints if needed.
)
echo [2/2] Launching Terminal Dashboard Server on http://127.0.0.1:3000...
node terminal/server.mjs
pause
