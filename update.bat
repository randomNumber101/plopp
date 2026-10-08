@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8

if exist "%USERPROFILE%\anaconda3\python.exe" (
  "%USERPROFILE%\anaconda3\python.exe" setup.py --update
  goto end
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 setup.py --update
  goto end
)
python setup.py --update

:end
echo.
pause
