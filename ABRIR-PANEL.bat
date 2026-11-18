@echo off
title Bot del negocio
cd /d "%~dp0"
echo Encendiendo el bot... el navegador se abre solo en unos segundos.
node pruebas\servidor-local.js
pause
