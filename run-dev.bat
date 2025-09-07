@echo off
echo RAG-Debugger Development Environment Setup
echo ==========================================
echo.

echo Setting up Python virtual environment...
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

echo Activating virtual environment and installing dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt

echo.
echo Starting FastAPI backend in background...
start "Backend" cmd /k "call venv\Scripts\activate.bat && python main.py"

echo Waiting for backend to start...
timeout /t 3 /nobreak >nul

echo.
echo Installing frontend dependencies...
cd frontend
if not exist node_modules (
    npm install
)

echo.
echo Starting React frontend...
echo.
echo Backend will be available at: http://127.0.0.1:8000
echo Frontend will be available at: http://localhost:3000
echo.
npm start