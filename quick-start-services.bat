@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem ============================================================
rem Dim+WebGPU quick start script.
rem Purpose: start DimMain frontend and DimServer backend services.
rem Frontend: http://localhost:5173/
rem Backend health: http://localhost:3001/api/health
rem ============================================================

set "ROOT_DIR=%~dp0"
set "FRONTEND_PORT=5173"
set "BACKEND_PORT=3001"

echo.
echo [Dim+WebGPU] Checking pnpm...
where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm.cmd was not found. Please install pnpm or add it to PATH.
  pause
  exit /b 1
)

echo [Dim+WebGPU] Checking service ports...
call :IsPortListening %FRONTEND_PORT%
set "IS_FRONTEND_RUNNING=!ERRORLEVEL!"
call :IsPortListening %BACKEND_PORT%
set "IS_BACKEND_RUNNING=!ERRORLEVEL!"

if "!IS_FRONTEND_RUNNING!"=="0" (
  echo [SKIP] Frontend port %FRONTEND_PORT% is already listening: http://localhost:%FRONTEND_PORT%/
) else (
  echo [START] Starting DimMain frontend on port %FRONTEND_PORT%...
  start "DimMain Frontend :%FRONTEND_PORT%" /D "%ROOT_DIR%DimMain" cmd /k "pnpm.cmd run dev -- --host 0.0.0.0 --clearScreen false"
)

if "!IS_BACKEND_RUNNING!"=="0" (
  echo [SKIP] Backend port %BACKEND_PORT% is already listening: http://localhost:%BACKEND_PORT%/api/health
) else (
  echo [START] Starting DimServer backend on port %BACKEND_PORT%...
  start "DimServer Backend :%BACKEND_PORT%" /D "%ROOT_DIR%DimServer" cmd /k "pnpm.cmd run dev"
)

echo.
echo [DONE] Start commands have been executed. Services may need a few seconds.
echo [FRONTEND] http://localhost:%FRONTEND_PORT%/
echo [BACKEND]  http://localhost:%BACKEND_PORT%/api/health
echo [TIP] Run quick-stop-services.bat to stop services.
echo.
pause
exit /b 0

:IsPortListening
rem Check whether the given port is in LISTENING state. 0 means listening, 1 means not listening.
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul 2>nul
exit /b %ERRORLEVEL%