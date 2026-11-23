@echo off
cd /d "%~dp0"
echo Iniciando servidor local en http://localhost:8080
echo Pulsa Ctrl+C para cerrar el servidor.
echo.

:: Intenta con Python 3
python servidor.py 8080 2>nul
if %errorlevel% neq 0 (
  :: Intenta con Python
  py servidor.py 8080 2>nul
  if %errorlevel% neq 0 (
    :: Intenta con Node/npx
    npx http-server . -p 8080 --cors -c-1
  )
)
pause
