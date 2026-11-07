@echo off
rem Prende el sistema si hace falta y abre la pagina que se le pasa.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto sinnode
curl -s -o nul -m 2 http://localhost:3000/api/sesion
if not errorlevel 1 goto abrir
start "Izel Joyas - no cerrar esta ventana" cmd /k node server.js
set intentos=0
:esperar
ping -n 2 127.0.0.1 >nul
curl -s -o nul -m 2 http://localhost:3000/api/sesion
if not errorlevel 1 goto abrir
set /a intentos+=1
if %intentos% lss 15 goto esperar
echo El sistema no pudo arrancar. Mira el mensaje en la otra ventana.
pause
exit /b 1
:abrir
start "" "http://localhost:3000/%~1"
exit /b 0
:sinnode
echo Falta instalar Node.js, version 22.13 o mas nueva. Se descarga gratis de https://nodejs.org
pause
exit /b 1
