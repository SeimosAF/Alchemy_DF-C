@echo off
chcp 65001 >nul
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop no esta abierto. Abrelo, espera a que ponga "Engine running" y vuelve a hacer doble clic aqui.
  pause
  exit /b 1
)
echo Construyendo y arrancando la app. La primera vez tarda unos minutos...
docker compose up -d --build --force-recreate
if errorlevel 1 (
  echo.
  echo Algo ha fallado. Copia todo el texto de esta ventana y pegaselo a Claude.
  pause
  exit /b 1
)
timeout /t 3 >nul
start "" http://localhost:8080
echo.
echo Listo. La app esta en http://localhost:8080
for /f "tokens=1,* delims==" %%a in ('findstr /b "ALQUIMIA_CLAVE=" .env') do echo Palabra de paso para crear cuentas: %%b
for /f "tokens=1,* delims==" %%a in ('findstr /b "ALQUIMIA_ADMIN=" .env') do echo Superusuario: entra con el nombre DM y la contrasena %%b
pause
