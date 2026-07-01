@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)

if "%IMAGE_GENERATION_PROVIDER%"=="" (
  set "IMAGE_GENERATION_PROVIDER=codex-cli"
)

if /I "%IMAGE_GENERATION_PROVIDER%"=="codex-cli" (
  if "%CODEX_CLI_COMMAND%"=="" (
    for /f "delims=" %%I in ('where codex 2^>nul') do (
      set "CODEX_CLI_COMMAND=%%I"
    )
    if exist "%LOCALAPPDATA%\OpenAI\Codex\bin\codex.cmd" (
      set "CODEX_CLI_COMMAND=%LOCALAPPDATA%\OpenAI\Codex\bin\codex.cmd"
    )
  )

  if not "%CODEX_CLI_COMMAND%"=="" (
    echo Using Codex CLI: %CODEX_CLI_COMMAND%
  ) else (
    echo Codex CLI not found. Set CODEX_CLI_COMMAND or use start-mock.bat.
  )
) else (
  echo Using provider: %IMAGE_GENERATION_PROVIDER%
)

echo Starting Character Normalizer server...
start "Character Normalizer Server" cmd /c "npm run dev"

timeout /t 3 /nobreak > nul
start http://localhost:3000
