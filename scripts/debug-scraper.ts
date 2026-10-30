// scripts/debug-scraper.ts
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

chromium.use(StealthPlugin());
dotenv.config();

const URLS_TO_DEBUG = [
  {
    name: "SeLoger Oise",
    url: "https://www.seloger.com/classified-search?distributionTypes=Buy&estateTypes=House&locations=AD06FR61&priceMax=300000&priceMin=100000",
  },
  {
    name: "Leboncoin Oise",
    url: "https://www.leboncoin.fr/recherche?text=maison+compi%C3%A8gne&locations=d_60",
  },
];

async function debugPage(name: string, url: string) {
  console.log(`\n🔍 Debug : ${name}`);
  console.log(`   URL: ${url.substring(0, 100)}...`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "fr-FR",
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    // 1. Sauvegarder le HTML complet
    const html = await page.content();
    const safeName = name.replace(/\s+/g, "-").toLowerCase();
    fs.writeFileSync(`debug-${safeName}.html`, html, "utf-8");
    console.log(`   📄 HTML sauvegardé dans debug-${safeName}.html`);

    // 2. Titre de la page
    const title = await page.title();
    console.log(`   📄 Titre: ${title}`);

    // 3. Vérifier captcha
    const bodyText = await page.locator("body").textContent();
    const isCaptcha = /captcha|robot|vérification|blocked/i.test(
      bodyText || "",
    );
    console.log(`   🚫 Captcha détecté: ${isCaptcha}`);

    // 4. Chercher les sélecteurs potentiels pour les annonces
    console.log("\n   🔎 Sélecteurs potentiels :");

    // data-testid
    const testIds = await page.evaluate(() => {
      const els = document.querySelectorAll("[data-testid]");
      return Array.from(
        new Set(Array.from(els).map((e) => e.getAttribute("data-testid"))),
      );
    });
    console.log(`   📌 data-testid: ${testIds.slice(0, 20).join(", ")}`);

    // Classes courantes de cartes
    const cardClasses = await page.evaluate(() => {
      const classes = new Set<string>();
      document.querySelectorAll("[class]").forEach((el) => {
        const cls = el.getAttribute("class") || "";
        if (
          /card|listing|annonce|result|item|property|offer/i.test(cls) &&
          cls.length > 3 &&
          cls.length < 100
        ) {
          classes.add(cls.split(/\s+/)[0]); // première classe
        }
      });
      return Array.from(classes).slice(0, 20);
    });
    console.log(`   📌 Classes candidates: ${cardClasses.join(", ")}`);

    // Liens vers annonces
    const listingLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      return links
        .filter((a) => {
          const href = a.href || "";
          return (
            href.includes("seloger.com/annonces") ||
            href.includes("seloger.com/classified") ||
            href.includes("leboncoin.fr/vi/") ||
            href.includes("leboncoin.fr/ad/")
          );
        })
        .map((a) => ({
          href: a.href.substring(0, 80),
          text: a.textContent?.trim().substring(0, 50),
        }))
        .slice(0, 10);
    });
    console.log(`   🔗 Liens annonces trouvés: ${listingLinks.length}`);
    listingLinks.forEach((l) => console.log(`      - ${l.href} | ${l.text}`));

    // 5. Compter les éléments avec des liens d'annonces
    const count = listingLinks.length;
    console.log(`\n   ✅ Total liens annonces: ${count}`);

    // 6. Structure des parents des liens (pour trouver le sélecteur de carte)
    if (listingLinks.length > 0) {
      const parentInfo = await page.evaluate(() => {
        const link = document.querySelector(
          'a[href*="seloger.com/annonces"], a[href*="leboncoin.fr/vi/"]',
        );
        if (!link) return null;
        let el: HTMLElement | null = link;
        const chain: string[] = [];
        for (let i = 0; i < 6 && el; i++) {
          chain.push(
            `${el.tagName}.${(el.getAttribute("class") || "").split(/\s+/).slice(0, 2).join(".")}`,
          );
          el = el.parentElement;
        }
        return chain;
      });
      console.log(`   🏗️  Chaîne de parents: ${parentInfo?.join(" > ")}`);
    }
  } catch (err: any) {
    console.log(`   ❌ Erreur: ${err.message}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  console.log(" Debug scraping - Analyse de la structure des pages\n");

  for (const target of URLS_TO_DEBUG) {
    await debugPage(target.name, target.url);
  }

  console.log(
    "\n✅ Debug terminé. Ouvre les fichiers debug-*.html dans un navigateur pour inspecter.",
  );
}

main().catch(console.error);
