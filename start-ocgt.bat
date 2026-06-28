@echo off
title ocgt desktop launcher
chcp 65001 > nul
setlocal
pushd "%~dp0"

set "LOG_FILE=%~dp0ocgt-launch.log"
set "WAILS_PATH=wails"

echo ===================================================
echo   Building and launching ocgt desktop
echo ===================================================
echo Project: %CD%
echo Log:     %LOG_FILE%
echo.

where wails >nul 2>nul
if errorlevel 1 (
    if exist "%USERPROFILE%\go\bin\wails.exe" (
        set "WAILS_PATH=%USERPROFILE%\go\bin\wails.exe"
    ) else (
        for /f "tokens=*" %%i in ('go env GOPATH') do set "GO_PATH=%%i"
        if exist "%GO_PATH%\bin\wails.exe" (
            set "WAILS_PATH=%GO_PATH%\bin\wails.exe"
        ) else (
            echo Wails CLI not found. Installing...
            go install github.com/wailsapp/wails/v2/cmd/wails@latest
            if errorlevel 1 (
                echo Failed to install Wails CLI.
                pause
                popd
                exit /b 1
            )
            set "WAILS_PATH=%USERPROFILE%\go\bin\wails.exe"
        )
    )
)

echo Wails: %WAILS_PATH%
echo Stopping old ocgt.exe if it exists...
taskkill /F /IM ocgt.exe >nul 2>nul

echo Building...
"%WAILS_PATH%" build -clean > "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo Build failed. Log:
    echo %LOG_FILE%
    type "%LOG_FILE%"
    pause
    popd
    exit /b 1
)

if not exist "%CD%\build\bin\ocgt.exe" (
    echo Build output missing: %CD%\build\bin\ocgt.exe
    pause
    popd
    exit /b 1
)

echo Launching latest ocgt.exe...
start "" "%CD%\build\bin\ocgt.exe"
echo Done. You can close this window after the desktop app appears.
echo.
pause
popd
endlocal
