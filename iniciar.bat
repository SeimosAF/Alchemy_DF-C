@echo off
cd /d "%~dp0"
rem Ajustes del archivo .env: palabra de paso, contraseña fija del superusuario "DM", Discord y correo
if exist .env for %%k in (ALQUIMIA_CLAVE ALQUIMIA_ADMIN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET ALQUIMIA_URL CORREO_USUARIO CORREO_CLAVE CORREO_SERVIDOR CORREO_PUERTO CORREO_REMITENTE) do (
  for /f "tokens=1,* delims==" %%a in ('findstr /b "%%k=" .env') do set "%%a=%%b"
)
echo Iniciando Alquimia en http://localhost:8080
echo Los datos compartidos se guardan en la carpeta "datos" (copias diarias en datos\copias).
echo Pulsa Ctrl+C para cerrar el servidor.
echo.

where python >nul 2>nul && (python servidor.py 8080 & goto fin)
where py >nul 2>nul && (py servidor.py 8080 & goto fin)

echo No se ha encontrado Python. La app se abre en modo "solo este navegador" (sin compartir).
npx http-server . -p 8080 --cors -c-1

:fin
pause
