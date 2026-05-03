@echo off
REM ==========================================================================
REM Nexus dev launcher — démarre toute la stack en local.
REM
REM Etapes :
REM  1. Demarre Docker Desktop si pas deja lance
REM  2. Attend que le daemon soit pret puis up Postgres + Redis (compose:up)
REM  3. Ouvre Windows Terminal avec 3 onglets : backend, worker Discord, web
REM     (fallback : 3 fenetres PowerShell separees si wt.exe absent)
REM  4. Ouvre le navigateur sur http://localhost:5173/app
REM
REM Adapte le chemin Docker Desktop si different.
REM ==========================================================================

setlocal
set REPO=%~dp0..
set DOCKER_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe

echo [Nexus] Demarrage Docker Desktop si pas deja lance...
tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>NUL | find /I /N "Docker Desktop.exe" >NUL
if errorlevel 1 (
  start "" "%DOCKER_EXE%"
  echo [Nexus] Docker Desktop lance. Attente 10s pour le daemon...
  timeout /t 10 /nobreak >NUL
) else (
  echo [Nexus] Docker Desktop deja en cours.
)

echo [Nexus] Attente que le daemon Docker reponde...
:wait_docker
docker info >NUL 2>&1
if errorlevel 1 (
  timeout /t 3 /nobreak >NUL
  goto wait_docker
)
echo [Nexus] Docker pret.

echo [Nexus] Demarrage Postgres + Redis (docker compose)...
pushd "%REPO%"
call pnpm compose:up
popd

echo [Nexus] Attente 5s pour que Postgres / Redis acceptent les connexions...
timeout /t 5 /nobreak >NUL

REM Detecte si Windows Terminal est dispo
where wt.exe >NUL 2>&1
if errorlevel 1 goto fallback_windows

echo [Nexus] Windows Terminal detecte — lancement en 3 onglets...
REM Une seule fenetre wt avec 3 onglets enchainés via ` ; ` (echappe en `^;` pour cmd.exe)
start "" wt -w nexus-dev new-tab --title "Backend" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev" ^; new-tab --title "Worker Discord" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev:worker:discord" ^; new-tab --title "Web" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/web dev"
goto open_browser

:fallback_windows
echo [Nexus] Windows Terminal absent — fallback sur 3 fenetres PowerShell.
start "Nexus Backend" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/backend dev"
start "Nexus Worker Discord" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/backend dev:worker:discord"
start "Nexus Web" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/web dev"

:open_browser
echo [Nexus] Attente 6s pour que Vite ait demarre...
timeout /t 6 /nobreak >NUL

echo [Nexus] Ouverture du navigateur sur http://localhost:5173
start "" http://localhost:5173
start "" http://localhost:5173/login
start "" http://localhost:5173/app
start "" http://localhost:3000/api/v1/health

echo [Nexus] Tout est lance. Ferme cette fenetre quand tu veux.
endlocal
