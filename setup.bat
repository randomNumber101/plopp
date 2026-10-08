@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8

if exist "%USERPROFILE%\anaconda3\python.exe" (
  "%USERPROFILE%\anaconda3\python.exe" setup.py
  goto end
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 setup.py
  goto end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python setup.py
  goto end
)
echo Python wurde nicht gefunden. Bitte Python von https://www.python.org installieren.

:end
echo.
pause
