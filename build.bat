@echo off
REM build.bat - Build ocgt with automatic version injection (Windows)
REM Usage: build.bat [version]
REM   If version is not provided, it will be read from wails.json

setlocal enabledelayedexpansion

cd /d "%~dp0"
set SHOULD_PAUSE=
echo %cmdcmdline% | findstr /i /c:" /c " >nul && set SHOULD_PAUSE=1

REM Get version from argument or wails.json
if not "%~1"=="" (
    set VERSION=%~1
) else (
    REM Parse version from wails.json (simple approach)
    for /f "tokens=2 delims=:," %%a in ('findstr "productVersion" wails.json') do (
        set VER_RAW=%%a
    )
    REM Remove quotes and spaces
    set VERSION=!VER_RAW:"=!
    set VERSION=!VERSION: =!
)

if "!VERSION!"=="" (
    echo Error: Could not determine version
    goto :fail
)

for /f "tokens=2 delims=:," %%a in ('findstr "outputfilename" wails.json') do (
    set OUT_RAW=%%a
)
set OUTPUT_NAME=!OUT_RAW:"=!
set OUTPUT_NAME=!OUTPUT_NAME: =!
if "!OUTPUT_NAME!"=="" set OUTPUT_NAME=ocgt

echo Building ocgt version: !VERSION!

REM Build with version injection via ldflags
set LDFLAGS=-X github.com/ethan-blue/open-code-go-tools/internal/version.Version=!VERSION!

echo Building with ldflags: !LDFLAGS!

REM Check known wails paths first, then PATH
set WAILS_BIN=
if exist "D:\Project\Go_Project\bin\wails.exe" (
    set WAILS_BIN=D:\Project\Go_Project\bin\wails.exe
) else (
    where wails >nul 2>nul
    if not errorlevel 1 (
        set WAILS_BIN=wails
    )
)

if "!WAILS_BIN!"=="" (
    echo Wails CLI not found. Please install wails or add it to PATH.
    echo   Install: go install github.com/wailsapp/wails/v2/cmd/wails@latest
    goto :fail
)

echo Using Wails: !WAILS_BIN!
"!WAILS_BIN!" build -ldflags "!LDFLAGS!"

if errorlevel 1 (
    echo Build failed
    goto :fail
)

echo.
echo Build complete!
echo Output: build\bin\!OUTPUT_NAME!.exe

endlocal
exit /b 0

:fail
if defined SHOULD_PAUSE pause
endlocal
exit /b 1
