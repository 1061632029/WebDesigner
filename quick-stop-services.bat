@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem ============================================================
rem Dim+WebGPU quick stop script.
rem Purpose: stop frontend 5173 and backend 3001 development services by port.
rem Note: it only kills processes listening on target ports.
rem ============================================================

set "FRONTEND_PORT=%~1"
set "BACKEND_PORT=%~2"

if "%FRONTEND_PORT%"=="" set "FRONTEND_PORT=5173"
if "%BACKEND_PORT%"=="" set "BACKEND_PORT=3001"

echo.
echo [Dim+WebGPU] Stopping development services...
call :KillByPort %FRONTEND_PORT% "DimMain Frontend"
call :KillByPort %BACKEND_PORT% "DimServer Backend"

echo.
echo [DONE] Stop flow has been executed.
pause
exit /b 0

:KillByPort
set "TARGET_PORT=%~1"
set "SERVICE_NAME=%~2"
set "FOUND_PROCESS=0"

rem Find process IDs listening on the target port and kill them one by one.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  set "FOUND_PROCESS=1"
  echo [STOP] !SERVICE_NAME! port %TARGET_PORT%, PID: %%P
  taskkill /F /PID %%P >nul 2>nul
  if errorlevel 1 (
    echo [WARN] Failed to stop PID %%P. It may have exited or permission is insufficient.
  ) else (
    echo [OK] PID %%P stopped.
  )
)

if "!FOUND_PROCESS!"=="0" (
  echo [SKIP] !SERVICE_NAME! port %TARGET_PORT% has no listening process.
)

exit /b 0