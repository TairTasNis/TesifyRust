@echo off
echo ========================================
echo         TESIFY BUILD SCRIPT
echo ========================================
echo.

echo [1/4] Activating virtual environment...
call "D:\Python\Tesify\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo ERROR: Failed to activate venv
    pause
    exit /b 1
)

echo [2/4] Installing Python dependencies...
pip install pyinstaller uvicorn fastapi yt-dlp pydantic h11 httptools anyio starlette aiohttp deep-translator > build_log.txt 2>&1

echo [3/4] Building frontend (npm run build)...
call npm run build >> build_log.txt 2>&1
if errorlevel 1 (
    echo ERROR: npm build failed. Check build_log.txt
    pause
    exit /b 1
)

echo [4/4] Building tesify.exe with PyInstaller (clean cache)...
python -m PyInstaller --clean --distpath release tesify.spec >> build_log.txt 2>&1
if errorlevel 1 (
    echo ERROR: PyInstaller failed. Check build_log.txt
    pause
    exit /b 1
)

echo.
echo ========================================
echo   BUILD SUCCESSFUL!
echo   Output: release\tesify.exe
echo ========================================
pause
