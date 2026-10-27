// scripts/batch-oise.ts
import { chromium } from "playwright";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

async function main() {
  const searchUrl =
    "https://www.leboncoin.fr/recherche?category=9&locations=d_60&real_estate_type=2";

  const userDataDir = path.join(__dirname, "../browser-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });

  const page = context.pages()[0] || (await context.newPage());

  console.log("🔍 Navigation vers la page de recherche...");
  await page.goto(searchUrl, { waitUntil: "load", timeout: 120000 });

  console.log("⏳ Attente 15 secondes pour le chargement JS...");
  await page.waitForTimeout(15000);

  // Scroll pour déclencher le chargement des annonces
  console.log("📜 Scroll progressif...");
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
  }

  // Debug : voir combien de liens au total sur la page
  const allLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    return {
      total: links.length,
      viLinks: links.filter((a) =>
        (a as HTMLAnchorElement).href.includes("/vi/"),
      ).length,
      sampleVi: links
        .filter((a) => (a as HTMLAnchorElement).href.includes("/vi/"))
        .slice(0, 5)
        .map((a) => (a as HTMLAnchorElement).href),
    };
  });

  console.log(`\n📊 Debug :`);
  console.log(`   Total liens sur la page : ${allLinks.total}`);
  console.log(`   Liens contenant /vi/ : ${allLinks.viLinks}`);
  console.log(`   Exemples :`);
  allLinks.sampleVi.forEach((url) => console.log(`      - ${url}`));

  // Extraction large
  const urls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/vi/"]'));
    return links
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((href) => href.includes("/vi/") && !href.includes("search"))
      .map((href) => href.split("?")[0]);
  });

  const uniqueUrls = [...new Set(urls)];
  console.log(`\n📋 ${uniqueUrls.length} annonces uniques trouvées :\n`);
  uniqueUrls.slice(0, 10).forEach((url, i) => console.log(`${i + 1}. ${url}`));

  await context.close();
}

main().catch(console.error);
