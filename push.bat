@echo off
chcp 65001 >nul
cd /d "%~dp0"

where git >nul 2>nul
if not %errorlevel%==0 (
  echo Git wurde nicht gefunden. Bitte Git fuer Windows installieren: https://git-scm.com
  pause
  exit /b 1
)

rem Beim ersten Mal: Ordner mit dem GitHub-Repo verbinden
if not exist ".git" (
  echo Verbinde Ordner mit github.com/randomNumber101/plopp ...
  git init -b main
  git remote add origin https://github.com/randomNumber101/plopp.git
  git fetch origin
  git reset origin/main
)

git add -A
git commit -m "Update %date% %time%"
rem Aenderungen von GitHub (z. B. Katalog-Bericht) vorher holen
git pull --rebase origin main
git push -u origin main

echo.
echo Fertig. GitHub baut die App jetzt neu (ca. 1-2 Minuten):
echo   https://github.com/randomNumber101/plopp/actions
echo Danach ist sie hier online: https://randomnumber101.github.io/plopp/
echo.
pause
