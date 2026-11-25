@echo off
cd /d "%~dp0"
rem Contraseña fija del superusuario "DM": se lee del archivo .env (ALQUIMIA_ADMIN=...)
if exist .env for /f "tokens=1,* delims==" %%a in ('findstr /b "ALQUIMIA_ADMIN=" .env') do set "ALQUIMIA_ADMIN=%%b"
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
