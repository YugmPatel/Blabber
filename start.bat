@echo off
REM ============================================
REM WhatsApp Chat - Startup Script (CMD)
REM ============================================
REM This script starts all microservices
REM For more options, use: powershell -File start.ps1 -Help
REM ============================================

echo.
echo   ========================================
echo   WhatsApp Chat - Starting All Services
echo   ========================================
echo.

REM Check if PowerShell is available
where powershell >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: PowerShell is required but not found!
    pause
    exit /b 1
)

REM Run the PowerShell script
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Quick

pause
