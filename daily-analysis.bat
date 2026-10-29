@echo off
chcp 65001 >nul
cd C:\Users\claud\immo2-sniper

echo ============================================
echo   Immo Sniper - Analyse quotidienne
echo   %date% %time%
echo ============================================
echo.

:: 1. Lecture automatique des emails
echo [1/4] Lecture des alertes email...
call npx tsx scripts/fetch-emails.ts
echo.

:: Vérifier que urls.txt existe et contient des URLs
if not exist urls.txt (
    echo [ERREUR] urls.txt introuvable.
    pause
    exit /b 1
)

:: Compter les URLs
for /f %%a in ('findstr /r /c:"http" urls.txt ^| find /c /v ""') do set URL_COUNT=%%a
echo [2/4] %URL_COUNT% URLs à traiter dans urls.txt
echo.

:: 2. Scraper les nouvelles annonces
echo [3/4] Scraping des annonces...
call npx tsx scripts/batch-scraper.ts file urls.txt
echo.

:: 3. Analyser et envoyer les alertes
echo [4/4] Analyse et envoi des alertes...
call npx tsx scripts/detect-opportunities.ts --send-email
echo.

:: 4. Vider urls.txt après traitement (optionnel)
echo # URLs traitées le %date% %time% > urls.txt
echo.

echo ============================================
echo   Analyse terminée
echo ============================================
pause