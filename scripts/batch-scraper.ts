// scripts/batch-scraper.ts
import { chromium, BrowserContext, Page } from "playwright";
import Groq from "groq-sdk";
import { z } from "zod";
import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

const parseNumber = (val: any): number | undefined => {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/\s/g, "").replace(/[^0-9]/g, "");
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? undefined : num;
  }
  if (typeof val === "object" && val !== null) {
    return (
      parseNumber(val.value) || parseNumber(val.amount) || parseNumber(val.text)
    );
  }
  return undefined;
};

const ListingSchema = z.object({
  price_eur: z.preprocess(parseNumber, z.number()),
  surface_m2: z.preprocess(parseNumber, z.number()),
  rooms: z.preprocess(parseNumber, z.number()),
  address: z.string(),
  defects: z.array(z.string()).nullable().default([]),
});

const geocodeCache = new Map<string, { lon: number; lat: number } | null>();

async function geocodeAddress(address: string) {
  if (geocodeCache.has(address)) return geocodeCache.get(address);

  try {
    let url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1&type=housenumber`;
    let res = await fetch(url);
    let data = await res.json();

    if (!data.features || data.features.length === 0) {
      url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=3&autocomplete=0`;
      res = await fetch(url);
      data = await res.json();
    }

    if (data.features && data.features.length > 0) {
      const best = data.features.reduce((prev: any, curr: any) =>
        curr.properties.score > prev.properties.score ? curr : prev,
      );

      if (best.properties.score < 0.3) {
        geocodeCache.set(address, null);
        return null;
      }

      const [lon, lat] = best.geometry.coordinates;
      geocodeCache.set(address, { lon, lat });
      return { lon, lat };
    }

    geocodeCache.set(address, null);
    return null;
  } catch {
    geocodeCache.set(address, null);
    return null;
  }
}

async function extractListingUrls(
  page: Page,
  searchUrl: string,
): Promise<string[]> {
  console.log(`\n🔍 Extraction des annonces depuis : ${searchUrl}`);

  // Navigation avec domcontentloaded (plus rapide pour les pages de recherche)
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Attendre que les annonces soient visibles
  await page
    .waitForSelector(
      '[data-TestId="listing-grid"], .ListingsList, .search-results',
      { timeout: 10000 },
    )
    .catch(() => {
      console.log("   ⚠️  Grid non trouvé, on attend quand même...");
    });

  // Scroll progressif pour charger plus d'annonces
  console.log("   📜 Scroll pour charger les annonces...");
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
  }

  const delay = Math.floor(Math.random() * 3000) + 2000;
  await page.waitForTimeout(delay);

  const urls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/vi/"]'));
    return links
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((href) => href.includes("/vi/") && !href.includes("search"))
      .map((href) => href.split("?")[0]);
  });

  const uniqueUrls = [...new Set(urls)];
  console.log(`   📋 ${uniqueUrls.length} annonces trouvées sur la page`);
  return uniqueUrls;
}

async function processListing(
  context: BrowserContext,
  url: string,
): Promise<boolean> {
  try {
    const existing = await pool.query(
      "SELECT id FROM listings WHERE url = $1",
      [url],
    );
    if (existing.rows.length > 0) {
      console.log(`   ⏭️  Déjà en base, skip`);
      return true;
    }

    const page = await context.newPage();

    // Attente réseau complète + scroll pour SeLoger
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    // Scroll pour charger tout le contenu
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
      await page.waitForTimeout(1000);
    }

    const delay = Math.floor(Math.random() * 3000) + 2000;
    await page.waitForTimeout(delay);

    const rawText = await page.evaluate(() => document.body.innerText);
    await page.close();

    if (
      rawText.includes("Accès temporairement restreint") ||
      rawText.includes("Vérification de sécurité")
    ) {
      console.log(`   🚫 Blocage détecté. On arrête le batch.`);
      return false;
    }

    // Vérification minimale : le texte doit contenir des indices d'annonce
    if (
      rawText.length < 500 ||
      (!rawText.includes("€") && !rawText.includes("EUR"))
    ) {
      console.log(`   ⚠️  Contenu insuffisant, skip`);
      return true;
    }

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Extrais les données de l'annonce immobilière. Pour l'adresse, donne le NUMÉRO et le NOM DE RUE complet si disponible. Réponds UNIQUEMENT avec le JSON brut, sans balises markdown.",
        },
        {
          role: "user",
          content: `Schéma JSON attendu: ${JSON.stringify(ListingSchema.shape)}.\n\nAnnonce: ${rawText.substring(0, 5000)}`,
        },
      ],
      model: "qwen/qwen3.8-27b",
      response_format: { type: "json_object" },
    });

    const rawContent = completion.choices[0].message.content || "{}";
    const cleanedContent = rawContent
      .replace(/```json\s?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsedData = ListingSchema.parse(JSON.parse(cleanedContent));

    const coords = await geocodeAddress(parsedData.address);
    if (!coords) {
      console.log(`   ⚠️  Géocodage échoué pour : ${parsedData.address}`);
      return true;
    }

    await pool.query(
      `INSERT INTO listings (url, raw_text, price_eur, surface_m2, rooms, address, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography)
       ON CONFLICT (url) DO NOTHING`,
      [
        url,
        rawText,
        parsedData.price_eur,
        parsedData.surface_m2,
        parsedData.rooms,
        parsedData.address,
        coords.lon,
        coords.lat,
      ],
    );

    console.log(
      `   ✅ ${parsedData.address} | ${parsedData.price_eur}€ | ${parsedData.surface_m2}m²`,
    );
    return true;
  } catch (err: any) {
    console.log(`   ❌ Erreur : ${err.message}`);
    return true;
  }
}

async function main() {
  const mode = process.argv[2];
  const target = process.argv[3];

  if (!mode || !target) {
    console.log("Usage :");
    console.log("  npx tsx scripts/batch-scraper.ts file urls.txt");
    console.log('  npx tsx scripts/batch-scraper.ts search "URL_RECHERCHE"');
    process.exit(1);
  }

  const userDataDir = path.join(__dirname, "../browser-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    args: ["--disable-blink-features=AutomationControlled"],
  });

  let urls: string[] = [];

  if (mode === "file") {
    const filePath = path.join(process.cwd(), target);
    if (!fs.existsSync(filePath)) {
      console.error(`Fichier introuvable : ${filePath}`);
      await context.close();
      process.exit(1);
    }
    urls = fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));
    console.log(`📄 ${urls.length} URLs chargées depuis ${target}`);
  } else if (mode === "search") {
    urls = await extractListingUrls(
      context.pages()[0] || (await context.newPage()),
      target,
    );
  }

  if (urls.length === 0) {
    console.log("Aucune URL à traiter.");
    await context.close();
    process.exit(0);
  }

  console.log(`\n Début du batch sur ${urls.length} annonces\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);

    const ok = await processListing(context, url);
    if (!ok) break;

    if (ok) successCount++;
    else failCount++;

    if (i < urls.length - 1) {
      const wait = Math.floor(Math.random() * 7000) + 5000;
      console.log(`   ⏳ Attente ${wait}ms...\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  console.log(`\n✅ Batch terminé.`);
  console.log(`   Succès : ${successCount}`);
  console.log(`   Échecs : ${failCount}`);

  await context.close();
  await pool.end();
}

main().catch(console.error);
