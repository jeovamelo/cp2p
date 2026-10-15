@echo off
setlocal
title Instalador - Comunidade Resiliente
cd /d "%~dp0.."

echo =======================================================================
echo         COMUNIDADE RESILIENTE - INSTALADOR PARA WINDOWS
echo =======================================================================
echo.
echo Iniciando assistente de instalacao automatizada...
echo Aguarde alguns instantes...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Ocorreu uma falha durante a instalacao automatizada.
    echo Pressione qualquer tecla para fechar...
    pause >nul
)

exit /b 0
