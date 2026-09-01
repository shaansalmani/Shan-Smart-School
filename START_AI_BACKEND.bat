@echo off
title Smart School AI Backend Server
echo ===================================================
echo   BAV INTER COLLEGE - SMART SCHOOL AI BACKEND
echo ===================================================
echo.

:: Check Python availability
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in system PATH.
    echo Please install Python 3.10+ from python.org and add to PATH.
    echo.
    pause
    exit /b 1
)

echo [OK] Python detected:
python --version
echo.

:: Ensure requirements are installed
echo [INFO] Verifying dependencies (FastAPI, Uvicorn, Pydantic, Python-dotenv)...
python -c "import fastapi, uvicorn, pydantic, dotenv, pyautogui, pynput" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Installing required dependencies...
    pip install -r backend/requirements.txt
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)
echo [OK] Dependencies verified.
echo.

:: Check .env configuration
if exist backend\.env (
    echo [OK] Backend environment file detected: backend\.env
) else if exist .env (
    echo [OK] Root environment file detected: .env
) else (
    echo [WARNING] No .env file found. Creating from .env.example...
    if exist .env.example copy .env.example .env
)
echo.

echo ===================================================
echo Starting FastAPI AI Backend Server on port 8000...
echo Health check: http://127.0.0.1:8000/health
echo Press Ctrl+C to stop the server.
echo ===================================================
echo.

python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Backend server stopped unexpectedly with code %errorlevel%.
    pause
)
