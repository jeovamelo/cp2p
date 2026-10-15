@echo off
title Comunidade Resiliente - No P2P
cd /d "%~dp0"

if exist "bin\node.exe" (
    set "NODE_BIN=bin\node.exe"
) else (
    set "NODE_BIN=node"
)

set "AUTO_OPEN=true"
set "HTTP_PORT=5001"
set "P2P_PORT=6001"
set "ROLE=Membro"

echo ========================================================
echo   Iniciando Comunidade Resiliente no computador...
echo   Interface Web abrindo em: http://localhost:5001
echo ========================================================
echo.

"%NODE_BIN%" src/desktop/desktop_runner.js
pause
