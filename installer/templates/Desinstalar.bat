@echo off
title Desinstalador - Comunidade Resiliente
cd /d "%~dp0"

echo ========================================================
echo   Desinstalando Comunidade Resiliente do computador...
echo ========================================================
echo.

del "%USERPROFILE%\Desktop\Comunidade Resiliente.lnk" 2>nul
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Comunidade Resiliente" 2>nul

echo Encerrando processos em execucao...
taskkill /f /im node.exe /fi "WINDOWTITLE eq Comunidade Resiliente*" 2>nul

echo Removendo arquivos de aplicacao...
set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"

cd /d "%TEMP%"
timeout /t 2 /nobreak >nul
rmdir /s /q "%APP_DIR%" 2>nul

echo.
echo ========================================================
echo Comunidade Resiliente foi desinstalada com sucesso!
echo ========================================================
pause
