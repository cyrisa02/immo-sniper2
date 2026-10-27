@echo off
cd C:\Users\claud\immo2-sniper
npx tsx scripts/batch-scraper.ts search "https://www.leboncoin.fr/recherche?category=9&locations=Beauvais_60000"
npx tsx scripts/batch-scraper.ts search "https://www.seloger.com/immobilier/achat/immo-hauts-de-france/oise/bien-maison-appartement/?idtypebien=2,1&tri=initial&idtt=2&naturebien=1,2&places=60"
npx tsx scripts/detect-opportunities.ts --send-email