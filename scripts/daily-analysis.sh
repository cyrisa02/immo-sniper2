#!/bin/bash
cd /chemin/vers/immo2-sniper

# 1. Scraper les nouvelles annonces
npx tsx scripts/batch-scraper.ts search "https://www.leboncoin.fr/recherche?category=9&locations=Beauvais_60000"

# 2. Analyser et envoyer les alertes
npx tsx scripts/detect-opportunities.ts --send-email