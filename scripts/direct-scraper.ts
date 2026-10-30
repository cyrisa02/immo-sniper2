// scripts/direct-scraper-v2.ts
import { chromium } from "playwright-extra";
import type { BrowserContext } from "playwright";
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

let context: BrowserContext | null = null;

// Vrai Chrome, visible, avec profil persistant (garde la session/captcha résolu)
async function getContext(): Promise<BrowserContext> {
  if (!context) {
    context = await chromium.launchPersistentContext(
      path.join(__dirname, "../.chrome-profile"),
      {
        channel: "chrome",
        headless: false,
        locale: "fr-FR",
        viewport: null,
        args: ["--disable-blink-features=AutomationControlled"],
      },
    );
  }
  return context;
}

interface SearchResult {
  url: string;
  title: string;
  price: number;
  surface: number;
  rooms: number;
  address: string;
  photo_url: string;
}

async function scrapeLeboncoinResults(
  page: any,
  searchUrl: string,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    console.log("   🌐 Chargement de la page...");

    await page.goto(searchUrl, {
      waitUntil: "load",
      timeout: 30000,
    });

    // Attendre que les annonces soient visibles
    try {
      await page.waitForSelector('a[href*="/ad/"]', { timeout: 10000 });
    } catch {
      console.log("   ⚠️  Aucune annonce visible après 10s");
    }

    await page.waitForTimeout(5000);

    let pageTitle = await page.title();
    console.log(`   📄 Titre: ${pageTitle}`);

    // Captcha : laisse 60s pour le résoudre à la main (Chrome est visible)
    if (pageTitle === "leboncoin.fr" || pageTitle === "Just a moment...") {
      console.log(
        "   🚫 Blocage détecté. Résous le captcha dans Chrome (60s)...",
      );
      try {
        await page.waitForSelector('a[href*="/ad/"]', { timeout: 60000 });
        await page.waitForTimeout(3000);
        pageTitle = await page.title();
      } catch {
        console.log("   🚫 Captcha non résolu, recherche ignorée.");
        return results;
      }
    }

    // Extraire les annonces
    const listings = await page.evaluate(() => {
      const items: any[] = [];

      const links = Array.from(
        document.querySelectorAll('a[href*="/ad/ventes_immobilieres/"]'),
      );

      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        if (!href) return;

        let parent: HTMLElement | null = link.closest(
          'article, div[class*="adCard"], div[data-testid="adItem"]',
        );
        if (!parent) {
          parent = link.parentElement;
          let depth = 0;
          while (parent && depth < 6 && parent.children.length > 10) {
            parent = parent.parentElement;
            depth++;
          }
        }

        if (!parent) return;

        const text = parent.textContent || "";

        const priceMatch = text.match(/(\d+\s?\d*\s?\d*)\s*€/);
        const price = priceMatch
          ? parseInt(priceMatch[1].replace(/\s/g, ""))
          : 0;

        if (price < 1000) return;

        const surfaceMatch = text.match(/(\d+)\s*m²/);
        const surface = surfaceMatch ? parseInt(surfaceMatch[1]) : 0;

        const roomsMatch = text.match(/(\d+)\s*pièce/);
        const rooms = roomsMatch ? parseInt(roomsMatch[1]) : 0;

        const addressMatch = text.match(
          /([A-Za-zÀ-ÿ\s\-]+)\s+(\d{5}).*?(?=Située|$)/,
        );
        const address = addressMatch
          ? `${addressMatch[1].trim()} ${addressMatch[2]}`.trim()
          : "";

        const img = parent.querySelector('img[src*="leboncoin.fr"]');
        const photo_url = img?.getAttribute("src") || "";

        const titleMatch = text.match(/Maison\s+\d+\s*pièce/);
        const title = titleMatch ? titleMatch[0] : "Maison";

        const url = href.split("?")[0];

        if (url && price > 0 && surface > 0) {
          items.push({
            url,
            title,
            price,
            surface,
            rooms,
            address,
            photo_url,
          });
        }
      });

      // Dédupliquer
      const seen = new Set<string>();
      return items.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    });

    results.push(...listings);
    console.log(`   ✅ ${listings.length} annonces extraites et valides`);

    if (listings.length > 0) {
      console.log(
        `   📄 Exemple: ${listings[0].address} | ${listings[0].price}€ | ${listings[0].surface}m²`,
      );
    }
  } catch (err: any) {
    console.log(`   ❌ Erreur scraping Leboncoin: ${err.message}`);
    try {
      const html = await page.content();
      fs.writeFileSync("debug-leboncoin-live.html", html, "utf-8");
      console.log("   📄 HTML sauvegardé dans debug-leboncoin-live.html");
    } catch {}
  }

  return results;
}

async function saveNewListing(
  result: SearchResult,
  platform: string,
): Promise<boolean> {
  const existing = await pool.query("SELECT id FROM listings WHERE url = $1", [
    result.url,
  ]);
  if (existing.rows.length > 0) {
    return false;
  }

  const description = `${result.title} - ${result.surface}m²`;
  const photos = result.photo_url ? [result.photo_url] : [];

  await pool.query(
    `INSERT INTO listings (url, source, title, price_eur, surface_m2, rooms, address, description, photos, lat, lon, geom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL)`,
    [
      result.url,
      platform,
      result.title,
      result.price,
      result.surface,
      result.rooms,
      result.address,
      description,
      photos,
    ],
  );

  return true;
}

async function directScrape() {
  console.log("🚀 Scraping direct des pages de recherche...\n");

  const searchesPath = path.join(__dirname, "../data/searches.json");
  if (!fs.existsSync(searchesPath)) {
    console.error("❌ Fichier data/searches.json introuvable");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(searchesPath, "utf-8"));
  const activeSearches = config.searches.filter((s: any) => s.enabled);

  console.log(`📋 ${activeSearches.length} recherche(s) active(s)\n`);

  const ctx = await getContext();

  let totalNew = 0;
  let totalExisting = 0;

  for (const search of activeSearches) {
    console.log(` ${search.name} (${search.platform})`);

    if (search.platform === "seloger") {
      console.log("   ⚠️  SeLoger bloque le scraping direct (Captcha).");
      console.log(
        "   💡 Utilise scripts/fetch-emails.ts pour SeLoger (déjà fonctionnel et sans captcha).",
      );
      continue;
    }

    if (search.platform === "leboncoin") {
      const page = await ctx.newPage();
      const results = await scrapeLeboncoinResults(page, search.url);
      await page.close();

      let newCount = 0;
      for (const result of results) {
        const saved = await saveNewListing(result, search.platform);
        if (saved) {
          console.log(
            `   🆕 ${result.address} | ${result.price}€ | ${result.surface}m²`,
          );
          newCount++;
        } else {
          totalExisting++;
        }
      }

      totalNew += newCount;
      console.log(`   📊 ${newCount} nouvelle(s) annonce(s)\n`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  await ctx.close();
  context = null;

  console.log("✅ Scraping direct terminé.");
  console.log(`   🆕 ${totalNew} nouvelle(s) annonce(s)`);
  console.log(`   ⏭️  ${totalExisting} déjà en base`);

  await pool.end();
}

directScrape().catch(async (err) => {
  console.error("❌ Erreur:", err);
  if (context) await context.close().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
