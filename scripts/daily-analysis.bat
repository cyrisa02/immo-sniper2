@echo off
cd C:\Users\claud\immo2-sniper

echo === Leboncoin - Beauvais ===
npx tsx scripts/batch-scraper.ts search "https://www.leboncoin.fr/recherche?category=9&locations=Beauvais_60000&real_estate_type=2"

echo === Leboncoin - Compiègne ===
npx tsx scripts/batch-scraper.ts search "https://www.leboncoin.fr/recherche?category=9&locations=Compiègne_60200&real_estate_type=2"

echo === Analyse et envoi emails ===
npx tsx scripts/detect-opportunities.ts --send-email