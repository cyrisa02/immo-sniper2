// scripts/batch-scraper.ts
import { chromium, Browser, Page } from "playwright-extra";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());
dotenv.config();

const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
  }
  return browser;
}

function isValidListingUrl(url: string): boolean {
  if (/leboncoin\.fr\/(ventes|vi)\/\d+/.test(url)) return true;
  if (/seloger\.com\/annon?ces\/[^?]+\/[A-Z0-9]+(.htm)?\/?$/i.test(url))
    return true;
  return false;
}

function cleanUrl(url: string): string {
  return url.split("?")[0].split("#")[0];
}

async function parseLeboncoin(page: Page, url: string): Promise<any> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const priceText = await page
    .locator('[data-testid="adPrice"]')
    .textContent()
    .catch(() => null);
  const title = await page
    .locator("h1")
    .textContent()
    .catch(() => null);
  const description = await page
    .locator('[data-testid="adDescription"]')
    .textContent()
    .catch(() => null);
  const surfaceText = await page
    .locator('th:has-text("Surface habitable") + td')
    .textContent()
    .catch(() => null);
  const roomsText = await page
    .locator('th:has-text("Pièces") + td')
    .textContent()
    .catch(() => null);
  const address = await page
    .locator('[data-testid="adLocation"]')
    .textContent()
    .catch(() => title);

  const photos = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => {
        const src = img.src || "";
        return (
          src.includes("img.leboncoin.fr") ||
          src.includes("lbc-vod") ||
          src.includes("lbcimg")
        );
      })
      .map((img) => img.src)
      .slice(0, 4);
  });

  const price = priceText ? parseInt(priceText.replace(/\D/g, "")) : 0;
  const surface = surfaceText ? parseFloat(surfaceText.replace(",", ".")) : 0;
  const rooms = roomsText ? parseInt(roomsText) : 0;

  const coords = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(
        /"latitude"\s*:\s*([\d.-]+).*?"longitude"\s*:\s*([\d.-]+)/,
      );
      if (match)
        return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
    }
    return null;
  });

  return {
    url: cleanUrl(url),
    source: "leboncoin",
    title: title?.trim() || "",
    price_eur: price,
    surface_m2: surface,
    rooms,
    address: address?.trim() || "",
    description: description?.trim() || "",
    photos,
    lat: coords?.lat || null,
    lon: coords?.lon || null,
  };
}

async function parseSeLoger(page: Page, url: string): Promise<any> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const pageTitle = await page.title();
  console.log(`   📄 Titre page: ${pageTitle}`);

  const isCaptcha =
    (await page.locator("text=/captcha|robot|vérification/i").count()) > 0;
  if (isCaptcha) {
    console.log("   🚫 CAPTCHA détecté - SeLoger bloque le headless");
    return null;
  }

  const priceText =
    (await page
      .locator('[data-testid="price"]')
      .textContent()
      .catch(() => null)) ||
    (await page
      .locator(".price")
      .textContent()
      .catch(() => null)) ||
    (await page
      .locator("text=/[\\d\\s]+\\s*€/")
      .first()
      .textContent()
      .catch(() => null));

  const title =
    (await page
      .locator("h1")
      .textContent()
      .catch(() => null)) ||
    (await page
      .locator('[data-testid="ad-title"]')
      .textContent()
      .catch(() => null));

  if (!title && !priceText) {
    console.log("   ⚠️  Page bloquée ou structure changée");
    const html = await page.content();
    fs.writeFileSync("debug-seloger.html", html);
    console.log("   📝 HTML sauvegardé dans debug-seloger.html");
    return null;
  }

  const description = await page
    .locator('[data-testid="description"]')
    .textContent()
    .catch(() => null);
  const surfaceText = await page
    .locator("text=/\\d+[.,]?\\d*\\s*m²/")
    .textContent()
    .catch(() => null);
  const roomsText = await page
    .locator("text=/\\d+\\s*pièce/")
    .textContent()
    .catch(() => null);
  const address = await page
    .locator('[data-testid="location"]')
    .textContent()
    .catch(() => title);

  const photos = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => {
        const src = img.src || "";
        return (
          (src.includes("v.seloger.com") ||
            src.includes("cdnihddipa.cloudimg.io") ||
            (src.includes("seloger.com") && !src.includes("logo"))) &&
          img.width > 200
        );
      })
      .map((img) => img.src)
      .slice(0, 4);
  });

  const price = priceText ? parseInt(priceText.replace(/\D/g, "")) : 0;
  const surfaceMatch = surfaceText?.match(/([\d.,]+)\s*m²/);
  const surface = surfaceMatch
    ? parseFloat(surfaceMatch[1].replace(",", "."))
    : 0;
  const roomsMatch = roomsText?.match(/(\d+)/);
  const rooms = roomsMatch ? parseInt(roomsMatch[1]) : 0;

  const coords = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(
        /"latitude"\s*:\s*([\d.-]+).*?"longitude"\s*:\s*([\d.-]+)/,
      );
      if (match)
        return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
    }
    return null;
  });

  return {
    url: cleanUrl(url),
    source: "seloger",
    title: title?.trim() || "",
    price_eur: price,
    surface_m2: surface,
    rooms,
    address: address?.trim() || "",
    description: description?.trim() || "",
    photos,
    lat: coords?.lat || null,
    lon: coords?.lon || null,
  };
}

async function scrapeListing(url: string): Promise<any> {
  const br = await getBrowser();
  const context = await br.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "fr-FR",
  });
  const page = await context.newPage();

  try {
    if (url.includes("leboncoin.fr")) {
      return await parseLeboncoin(page, url);
    } else if (url.includes("seloger.com")) {
      return await parseSeLoger(page, url);
    }
    return null;
  } finally {
    await context.close();
  }
}

async function saveListing(listing: any): Promise<boolean> {
  const existing = await pool.query("SELECT id FROM listings WHERE url = $1", [
    listing.url,
  ]);
  if (existing.rows.length > 0) {
    console.log("   ⏭️  Déjà en base, skip");
    return false;
  }

  const geom =
    listing.lat && listing.lon
      ? `ST_SetSRID(ST_MakePoint(${listing.lon}, ${listing.lat}), 4326)`
      : "NULL";

  await pool.query(
    `INSERT INTO listings (url, source, title, price_eur, surface_m2, rooms, address, description, photos, lat, lon, geom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${geom})`,
    [
      listing.url,
      listing.source,
      listing.title,
      listing.price_eur,
      listing.surface_m2,
      listing.rooms,
      listing.address,
      listing.description,
      listing.photos || [],
      listing.lat,
      listing.lon,
    ],
  );

  return true;
}

async function batchScrape(source: string, input: string) {
  console.log("🚀 Démarrage du scraping batch...");

  let urls: string[] = [];

  if (source === "file") {
    const filePath = path.resolve(input);
    if (!fs.existsSync(filePath)) {
      console.error(` Fichier introuvable: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    urls = content
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));
    console.log(`📄 ${urls.length} URLs lues depuis ${filePath}`);
  } else {
    console.error('❌ Source non supportée. Utilise "file <chemin>"');
    process.exit(1);
  }

  const validUrls = urls.filter((u) => isValidListingUrl(u));
  const invalidCount = urls.length - validUrls.length;
  if (invalidCount > 0) {
    console.log(`⚠️  ${invalidCount} URL(s) invalide(s) ignorée(s)`);
  }
  console.log(`✅ ${validUrls.length} URL(s) valide(s) à traiter\n`);

  let success = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < validUrls.length; i++) {
    const url = validUrls[i];
    console.log(`[${i + 1}/${validUrls.length}] ${url}`);

    try {
      const listing = await scrapeListing(url);

      if (!listing || listing.price_eur === 0) {
        console.log("   ⚠️  Contenu insuffisant, skip");
        errors++;
        continue;
      }

      console.log(
        `   ✅ ${listing.address} | ${listing.price_eur}€ | ${listing.surface_m2}m²`,
      );

      const saved = await saveListing(listing);
      if (saved) {
        success++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      console.log(`   ❌ Erreur: ${err.message}`);
      errors++;
    }

    if (i < validUrls.length - 1) {
      const waitTime = 3000 + Math.random() * 3000;
      console.log(`   ⏳ Attente ${Math.round(waitTime)}ms...`);
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }

  console.log("\n✅ Batch terminé.");
  console.log(`   Succès : ${success}`);
  console.log(`   Déjà en base : ${skipped}`);
  console.log(`   Échecs : ${errors}`);

  if (browser) {
    await browser.close();
    browser = null;
  }

  await pool.end();
}

const args = process.argv.slice(2);
const source = args[0];
const input = args[1];

if (!source || !input) {
  console.log("Usage: npx tsx scripts/batch-scraper.ts file <chemin_urls.txt>");
  process.exit(1);
}

batchScrape(source, input).catch(console.error);
