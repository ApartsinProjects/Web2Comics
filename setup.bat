@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ======================================
echo   Web to Comic - Setup Installer
echo ======================================
echo.

REM Check if running from correct directory
if not exist "manifest.json" (
    echo ERROR: Please run this script from the WebToComin folder
    echo.
    pause
    exit /b 1
)

echo Checking files...

REM Check required directories
set "missing="
if not exist "popup\popup.html" set "missing=!missing! popup"
if not exist "sidepanel\sidepanel.html" set "missing=!missing! sidepanel"
if not exist "options\options.html" set "missing=!missing! options"
if not exist "background\service-worker.js" set "missing=!missing! background"
if not exist "providers\gemini-provider.js" set "missing=!missing! providers"
if not exist "content\content-script.js" set "missing=!missing! content"

if not "!missing!"=="" (
    echo ERROR: Missing required folders: !missing!
    echo Please ensure you have the complete extension files.
    echo.
    pause
    exit /b 1
)

echo All required files found.
echo.

REM Check for icons
echo Checking icons...
if exist "icons\icon16.svg" (
    echo   - icon16.svg: OK
) else if exist "icons\icon16.png" (
    echo   - icon16.png: OK
) else (
    echo WARNING: icon16 not found
)

if exist "icons\icon48.svg" (
    echo   - icon48.svg: OK
) else if exist "icons\icon48.png" (
    echo   - icon48.png: OK
) else (
    echo WARNING: icon48 not found
)

if exist "icons\icon128.svg" (
    echo   - icon128.svg: OK
) else if exist "icons\icon128.png" (
    echo   - icon128.png: OK
) else (
    echo WARNING: icon128 not found
)

echo.
echo ======================================
echo Installation Check Complete
echo ======================================
echo.
echo To load the extension in Chrome:
echo 1. Open Chrome and go to: chrome://extensions/
echo 2. Enable Developer Mode (top-right)
echo 3. Click "Load unpacked"
echo 4. Select this folder
echo.
echo Next steps:
echo 1. Configure API key in extension Options
echo 2. Pin extension to toolbar
echo 3. Visit any article and click Generate
echo.
echo For detailed instructions, see docs/INSTALL.md
echo.

pause
