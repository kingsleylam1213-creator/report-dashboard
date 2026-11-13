@echo off
chcp 65001 >nul
title Update online apparel dashboard - GitHub Pages
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apparel-dashboard\tools\publish-github.ps1"
if errorlevel 1 (
  echo Online update failed. Check the message above. No success was reported.
)
pause
