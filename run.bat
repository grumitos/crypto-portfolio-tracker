@echo off
rem Crypto Portfolio Tracker: sirve la app en local y la abre en el navegador.
rem No instala nada: el servidor solo necesita Bun. Las claves se configuran desde la app.
rem Uso: run.bat [puerto]   p. ej.: run.bat 5180
setlocal
cd /d "%~dp0"
set "MIN_BUN=1.3.0"
set "NODE_ENV=production"
set "PUBLIC_APP_ENV=production"
set "PORT=5176"
if not "%~1"=="" set "PORT=%~1"
set "EXIT_CODE=0"

rem Con doble clic (cmd /c "...\run.bat") se hace una pausa final si algo falla; si todo sale bien,
rem la app se abre en el navegador y esta ventana es el servidor.
set "DOUBLE_CLICK="
echo %cmdcmdline% | "%SystemRoot%\System32\find.exe" /i "%~nx0" >nul && set "DOUBLE_CLICK=1"

call :find_bun || goto :failed
call :check_port || goto :failed
call :open_browser_when_ready

echo Sirviendo en http://localhost:%PORT%/ (cierra esta ventana o pulsa Ctrl+C para detenerlo).
bun src/server.ts
set "EXIT_CODE=%ERRORLEVEL%"
rem Ctrl+C no es un fallo: Windows lo informa como 0xC000013A.
if "%EXIT_CODE%"=="-1073741510" set "EXIT_CODE=0"
goto :finish

:find_bun
rem Comprueba que haya un Bun %MIN_BUN% o superior en el PATH.
bun -e "process.exit(Bun.semver.satisfies(Bun.version, '>=%MIN_BUN%') ? 0 : 1)" >nul 2>&1 && exit /b 0
echo ERROR: se necesita Bun %MIN_BUN% o superior en el PATH (https://bun.sh).
exit /b 1

:check_port
rem Bun en Windows puede compartir un puerto ocupado sin avisar: se comprueba antes de arrancar.
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue) { exit 1 }" && exit /b 0
echo ERROR: el puerto %PORT% ya esta en uso. Cierra la otra instancia o usa otro: run.bat 5180
exit /b 1

:open_browser_when_ready
rem Abre el navegador en segundo plano en cuanto el servidor responde (espera hasta 15 s).
start "" /b powershell -NoProfile -Command "$u='http://localhost:%PORT%/'; for ($i = 0; $i -lt 50; $i++) { try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $u; Start-Process $u; break } catch { Start-Sleep -Milliseconds 300 } }"
exit /b 0

:failed
set "EXIT_CODE=1"

:finish
if defined DOUBLE_CLICK if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
