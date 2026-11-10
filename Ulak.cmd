@echo off
if not exist "%~dp0target\debug\ulak-desktop.exe" (
  echo Build Ulak first with scripts\desktop.ps1.
  pause
  exit /b 1
)
powershell.exe -NoProfile -WindowStyle Hidden -File "%~dp0scripts\open.ps1"
