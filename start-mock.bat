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

echo Starting Character Normalizer with mock provider...
set IMAGE_GENERATION_PROVIDER=mock
start "Character Normalizer Server" cmd /c "npm run dev"

timeout /t 3 /nobreak > nul
start http://localhost:3000
