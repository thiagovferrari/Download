@echo off
title Lon Download
color 0F

echo.
echo   ╔══════════════════════════════════════╗
echo   ║         LON DOWNLOAD                 ║
echo   ║   Iniciando o sistema...             ║
echo   ╚══════════════════════════════════════╝
echo.

:: Vai para a pasta do sistema
cd /d "%~dp0"

:: Verifica se Node.js esta instalado
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    echo Baixe em: https://nodejs.org
    pause
    exit /b 1
)

:: Mata qualquer processo anterior na porta 3000
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000"') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Aguarda 1 segundo
timeout /t 1 /nobreak >nul

:: Inicia o servidor em background
echo   Servidor iniciando...
start "" /B node server.js

:: Aguarda o servidor subir
timeout /t 2 /nobreak >nul

:: Abre o navegador automaticamente
echo   Abrindo no navegador...
start "" "http://localhost:3000"

echo.
echo   ✓ Lon Download esta rodando em http://localhost:3000
echo.
echo   ╔══════════════════════════════════════╗
echo   ║  Mantenha esta janela ABERTA         ║
echo   ║  Para fechar o sistema, feche aqui   ║
echo   ╚══════════════════════════════════════╝
echo.

:: Mantem o servidor vivo enquanto a janela estiver aberta
:loop
timeout /t 60 /nobreak >nul
goto loop
