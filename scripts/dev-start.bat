@echo off
REM ==========================================================================
REM Nexus dev launcher — démarre toute la stack en local.
REM
REM Modes :
REM   dev-start.bat            → mode Tauri (defaut, lance la window native)
REM   dev-start.bat web        → mode navigateur (lance Vite, ouvre http://localhost:5173)
REM
REM Etapes :
REM  1. Demarre Docker Desktop si pas deja lance
REM  2. Attend que le daemon soit pret puis up Postgres + Redis (compose:up)
REM  3. Ouvre Windows Terminal avec 4-5 onglets selon le mode :
REM       - Backend (Fastify port 3000)
REM       - Worker Discord (BullMQ + Discord bot)
REM       - Worker Reminders (BullMQ rappels events)
REM       - Worker Purge (purge nocturne notifs, mode tauri uniquement)
REM       - Tauri OU Web (selon le mode)
REM     (fallback : fenetres PowerShell separees si wt.exe absent)
REM
REM Note : en mode Tauri, on NE lance PAS Vite separement — Tauri spawn Vite
REM lui-meme via beforeDevCommand. Sinon erreur "port 5173 already in use".
REM
REM Adapte le chemin Docker Desktop si different.
REM ==========================================================================

setlocal
set REPO=%~dp0..
set DOCKER_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe
set MODE=tauri
if /I "%~1"=="web" set MODE=web
if /I "%~1"=="--web" set MODE=web

echo [Nexus] Mode de lancement : %MODE%

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

if "%MODE%"=="web" goto wt_web
goto wt_tauri

:wt_tauri
echo [Nexus] Windows Terminal detecte — lancement Tauri (5 onglets)...
start "" wt -w nexus-dev new-tab --title "Backend" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev" ^; new-tab --title "Worker Discord" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev:worker:discord" ^; new-tab --title "Worker Reminders" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev:worker:reminders" ^; new-tab --title "Worker Purge" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev:worker:purge" ^; new-tab --title "Tauri" -d "%REPO%" powershell -NoExit -Command "pnpm tauri:dev"
goto end

:wt_web
echo [Nexus] Windows Terminal detecte — lancement web (4 onglets)...
start "" wt -w nexus-dev new-tab --title "Backend" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev" ^; new-tab --title "Worker Discord" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev:worker:discord" ^; new-tab --title "Worker Reminders" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/backend dev:worker:reminders" ^; new-tab --title "Web" -d "%REPO%" powershell -NoExit -Command "pnpm --filter @nexus/web dev"
echo [Nexus] Attente 6s pour que Vite ait demarre...
timeout /t 6 /nobreak >NUL
echo [Nexus] Ouverture du navigateur sur http://localhost:5173
start "" http://localhost:5173
goto end

:fallback_windows
echo [Nexus] Windows Terminal absent — fallback sur fenetres PowerShell separees.
start "Nexus Backend" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/backend dev"
start "Nexus Worker Discord" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/backend dev:worker:discord"
start "Nexus Worker Reminders" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/backend dev:worker:reminders"
start "Nexus Worker Purge" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/backend dev:worker:purge"
if "%MODE%"=="web" (
  start "Nexus Web" powershell -NoExit -Command "cd '%REPO%'; pnpm --filter @nexus/web dev"
  timeout /t 6 /nobreak >NUL
  start "" http://localhost:5173
) else (
  start "Nexus Tauri" powershell -NoExit -Command "cd '%REPO%'; pnpm tauri:dev"
)

:end
echo [Nexus] Tout est lance. Ferme cette fenetre quand tu veux.
endlocal
