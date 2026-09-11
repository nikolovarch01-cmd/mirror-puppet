@echo off
cd /d "%~dp0"
chcp 65001 >nul
py serve-https.py
pause
