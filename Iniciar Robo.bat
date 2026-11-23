@echo off
chcp 65001 >nul
title Robô de Ofertas Shopee
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js ainda nao esta instalado neste computador.
  echo  Vou abrir a pagina de download: baixe a versao LTS, instale
  echo  ^(Next, Next, Finish^) e depois de dois cliques neste arquivo de novo.
  echo.
  start https://nodejs.org/pt
  pause
  exit /b
)
set HOST=127.0.0.1
set SETUP_CODE=robo2026
echo.
echo  ==========================================================
echo   ROBO DE OFERTAS SHOPEE
echo   - O painel vai abrir no navegador em instantes.
echo   - No primeiro acesso, o CODIGO e:  robo2026
echo   - DEIXE ESTA JANELA ABERTA. Se fechar, o robo para.
echo  ==========================================================
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node server.js
echo.
echo  O robo parou. Veja a mensagem acima.
pause
