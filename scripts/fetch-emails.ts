// scripts/fetch-emails.ts
import Imap from "imap";
import { simpleParser } from "mailparser";
import { chromium, Browser } from "playwright";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const URLS_FILE = path.join(__dirname, "../urls.txt");
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
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

async function resolveSeLogerRedirect(url: string): Promise<string | null> {
  try {
    const br = await getBrowser();
    const context = await br.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "fr-FR",
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(2000);
    const finalUrl = page.url().split("?")[0];
    await context.close();
    return finalUrl;
  } catch (err: any) {
    console.log(`   ⚠️  Erreur Playwright: ${err.message}`);
    return null;
  }
}

// Cache : évite de résoudre deux fois le même lien de tracking
const resolvedCache = new Map<string, string | null>();
async function resolveCached(url: string): Promise<string | null> {
  if (!resolvedCache.has(url)) {
    resolvedCache.set(url, await resolveSeLogerRedirect(url));
  }
  return resolvedCache.get(url)!;
}

//  Extraction des données d'annonce depuis le HTML de l'email SeLoger
interface EmailListing {
  url_tracking: string;
  price_eur: number;
  price_per_m2: number;
  type: string;
  rooms: number;
  surface_m2: number;
  land_m2: number;
  address: string;
  city: string;
  postal_code: string;
  photo_url: string;
  title: string;
}

function extractListingFromEmail(html: string): EmailListing | null {
  try {
    // Prix : <strong>290 000 €</strong> (avec espace insécable \u202f)
    const priceMatch = html.match(/<strong>([\d\s\u202f]+)\s*€\s*<\/strong>/);
    const priceText = priceMatch?.[1]?.replace(/[\s\u202f]/g, "") || "0";
    const price_eur = parseInt(priceText);

    // Prix au m² : 1 705,88 €/m²
    const priceM2Match = html.match(/([\d\s\u202f,]+)\s*€\/m²/);
    const priceM2Text =
      priceM2Match?.[1]?.replace(/[\s\u202f]/g, "").replace(",", ".") || "0";
    const price_per_m2 = parseFloat(priceM2Text);

    // Type : <strong>Vente Longère 8 pièces</strong>
    const typeMatch = html.match(/<strong>(Vente [^<]+)<\/strong>/);
    const type = typeMatch?.[1]?.trim() || "";

    // Pièces
    const roomsMatch = type.match(/(\d+)\s*pièce/);
    const rooms = roomsMatch ? parseInt(roomsMatch[1]) : 0;

    // Critères : "8 pièces · 170 m² · 540 m²" (dans le lien name="adcriteria")
    const criteriaMatch = html.match(/name="adcriteria[^"]*"[^>]*>([^<]+)</);
    const criteriaText = criteriaMatch?.[1] || "";

    // Parser "8 pièces · 170 m² · 540 m²"
    const surfaceMatch = criteriaText.match(/(\d+)\s*m²/);
    const surface_m2 = surfaceMatch ? parseInt(surfaceMatch[1]) : 0;

    const landMatch = criteriaText.match(/(\d+)\s*m²\s*·\s*(\d+)\s*m²/);
    const land_m2 = landMatch ? parseInt(landMatch[2]) : 0;

    // Adresse : "Beauvais\n(60000)" (dans le lien name="adlocation")
    const locationMatch = html.match(/name="adlocation[^"]*"[^>]*>([^<]+)</);
    const locationText = locationMatch?.[1] || "";
    const locationClean = locationText.replace(/\s+/g, " ").trim();

    const cityMatch = locationClean.match(/([A-Za-zÀ-ÿ\s]+)\s*\((\d{5})\)/);
    const city = cityMatch?.[1]?.trim() || "";
    const postal_code = cityMatch?.[2] || "";
    const address = `${city} (${postal_code})`;

    // Photo : URL dans background-image
    const photoMatch = html.match(
      /background-image:\s*url\(['"]?(https:\/\/cdnihddipa\.cloudimg\.io\/[^'")\s]+)/,
    );
    const photo_url = photoMatch?.[1] || "";

    // URL tracking "Voir l'annonce" (name="adbutton")
    const buttonMatch = html.match(
      /name="adbutton[^"]*"[^>]*href=["'](https:\/\/click\.by\.seloger\.com\/[^"']+)["']/i,
    );
    const url_tracking = buttonMatch?.[1] || "";

    if (price_eur === 0 && !photo_url) return null;

    return {
      url_tracking,
      price_eur,
      price_per_m2,
      type,
      rooms,
      surface_m2,
      land_m2,
      address,
      city,
      postal_code,
      photo_url,
      title: `${type} - ${address}`,
    };
  } catch (err) {
    console.log(`   ⚠️  Erreur parsing email: ${err}`);
    return null;
  }
}

async function saveListingFromEmail(
  listing: EmailListing,
  finalUrl: string,
): Promise<boolean> {
  const url = finalUrl || listing.url_tracking;

  // Vérifier si déjà en base
  const existing = await pool.query("SELECT id FROM listings WHERE url = $1", [
    url,
  ]);
  if (existing.rows.length > 0) {
    console.log(`   ⏭️  Déjà en base: ${listing.address}`);
    return false;
  }

  const lat = null;
  const lon = null;
  const geom = "NULL";

  const description = `${listing.type} - ${listing.surface_m2}m² habitable - ${listing.land_m2}m² terrain`;

  await pool.query(
    `INSERT INTO listings (url, source, title, price_eur, surface_m2, rooms, address, description, photos, lat, lon, geom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${geom})`,
    [
      url,
      "seloger",
      listing.title,
      listing.price_eur,
      listing.surface_m2,
      listing.rooms,
      listing.address,
      description,
      listing.photo_url ? [listing.photo_url] : [],
      lat,
      lon,
    ],
  );

  console.log(
    `   ✅ ${listing.address} | ${listing.price_eur}€ | ${listing.surface_m2}m² | ${listing.rooms} pièces`,
  );
  return true;
}

function extractUrlsFromHtml(html: string): {
  direct: string[];
  tracking: string[];
} {
  const direct: string[] = [];
  const tracking: string[] = [];
  const anchorRegex = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const url = match[1];
    const label = match[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      url.includes("leboncoin.fr/vi/") ||
      url.includes("leboncoin.fr/ventes/") ||
      url.includes("seloger.com/annonces/") ||
      url.includes("seloger.com/annonce/")
    ) {
      direct.push(url.split("?")[0]);
    }
    if (
      url.includes("click.by.seloger.com/") &&
      /voir\s+l.{1,8}annonce/i.test(label)
    ) {
      tracking.push(url);
    }
  }
  return { direct: [...new Set(direct)], tracking: [...new Set(tracking)] };
}

function extractUrlsFromText(text: string): string[] {
  const urls: string[] = [];
  const lbcRegex = /https:\/\/www\.leboncoin\.fr\/vi\/[^\s<"]+/gi;
  // FIX : "annonce" ET "annonces"
  const slRegex = /https:\/\/www\.seloger\.com\/annonces?\/[^\s<"]+/gi;
  urls.push(...(text.match(lbcRegex) || []).map((u) => u.split("?")[0]));
  urls.push(...(text.match(slRegex) || []).map((u) => u.split("?")[0]));
  return [...new Set(urls)];
}

function isValidListingUrl(url: string): boolean {
  if (/leboncoin\.fr\/(vi|ventes)\/\d+/.test(url)) return true;
  // FIX : "annonce" ET "annonces"
  if (/seloger\.com\/annonces?\/.+\/[A-Z0-9]+(\.htm)?\/?$/i.test(url))
    return true;
  return false;
}

interface EmailData {
  subject: string;
  directUrls: string[];
  trackingUrls: string[];
  listingData: EmailListing | null;
}

async function fetchFromFolder(
  imap: Imap,
  folder: string,
): Promise<EmailData[]> {
  return new Promise((resolve, reject) => {
    imap.openBox(folder, false, (err: any) => {
      if (err) {
        console.log(`   ️  Dossier "${folder}" introuvable, skip`);
        resolve([]);
        return;
      }
      imap.search(["UNSEEN"], (err: any, results: any) => {
        if (err) reject(err);
        if (!results || results.length === 0) {
          console.log(`    Aucun email non lu dans "${folder}"`);
          resolve([]);
          return;
        }
        console.log(
          `    ${results.length} email(s) non lu(s) dans "${folder}"`,
        );
        const emails: EmailData[] = [];
        const parsing: Promise<void>[] = [];
        let processed = 0;
        const f = imap.fetch(results, { bodies: "" });
        f.on("message", (msg: any) => {
          msg.on("body", (stream: any) => {
            parsing.push(
              new Promise<void>((done) =>
                simpleParser(stream, (err: any, parsed: any) => {
                  if (err) return done();
                  processed++;
                  const from = parsed.from?.text || "";
                  const subject = parsed.subject || "";
                  const text = parsed.text || "";
                  const html = parsed.html || "";
                  const isImmoAlert =
                    from.toLowerCase().includes("leboncoin") ||
                    from.toLowerCase().includes("seloger") ||
                    subject.toLowerCase().includes("annonce") ||
                    subject.toLowerCase().includes("recherche") ||
                    subject.toLowerCase().includes("propriété");
                  if (!isImmoAlert) {
                    console.log(`   [${processed}] ${subject} (ignoré)`);
                    return done();
                  }
                  const { direct, tracking } = extractUrlsFromHtml(html);
                  const textUrls = extractUrlsFromText(text);
                  const allDirect = [...new Set([...direct, ...textUrls])];

                  // 📧 Extraire les données d'annonce du HTML
                  const listingData = extractListingFromEmail(html);

                  console.log(
                    `[${processed}] ${subject} → ${allDirect.length} directes, ${tracking.length} tracking${
                      listingData
                        ? `, données: ${listingData.price_eur}€ / ${listingData.surface_m2}m² / ${listingData.rooms} pièces`
                        : ""
                    }`,
                  );
                  emails.push({
                    subject,
                    directUrls: allDirect,
                    trackingUrls: tracking,
                    listingData,
                  });
                  done();
                }),
              ),
            );
          });
        });
        f.once("end", () => Promise.all(parsing).then(() => resolve(emails)));
      });
    });
  });
}

async function fetchEmails() {
  const imap = new Imap({
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || "993"),
    tls: process.env.IMAP_TLS === "true",
    tlsOptions: { rejectUnauthorized: false },
  });

  const allEmails: EmailData[] = [];
  const allUrls: string[] = [];
  let savedFromEmail = 0;

  return new Promise<void>((resolve, reject) => {
    imap.once("ready", async () => {
      try {
        console.log("🔍 Recherche dans INBOX...");
        const inboxEmails = await fetchFromFolder(imap, "INBOX");
        allEmails.push(...inboxEmails);

        console.log("🔍 Recherche dans [Gmail]/Promotions...");
        const promoEmails = await fetchFromFolder(imap, "[Gmail]/Promotions");
        allEmails.push(...promoEmails);

        // 📧 Sauvegarder directement les annonces extraites des emails
        console.log("\n Sauvegarde des annonces extraites des emails...");
        for (const email of allEmails) {
          if (email.listingData && email.trackingUrls.length > 0) {
            const trackingUrl = email.trackingUrls[0];
            console.log(`   📧 ${email.subject}`);

            // FIX : résoudre (avec cache) et ignorer si l'URL finale est invalide
            const resolved = await resolveCached(trackingUrl);
            if (!resolved || !isValidListingUrl(resolved)) {
              console.log(`   ❌ Redirect invalide, ignoré: ${resolved}`);
              continue;
            }

            const saved = await saveListingFromEmail(
              email.listingData,
              resolved,
            );
            if (saved) savedFromEmail++;
          }
        }

        // 🔗 Résoudre les redirects restants (cache : pas de doublon de requête)
        const totalTracking = allEmails.reduce(
          (sum, e) => sum + e.trackingUrls.length,
          0,
        );
        if (totalTracking > 0) {
          console.log(
            `\n🔗 Résolution de ${totalTracking} redirect(s) avec Playwright...`,
          );
          const seenTracking = new Set<string>();
          for (const email of allEmails) {
            for (const trackingUrl of email.trackingUrls) {
              if (seenTracking.has(trackingUrl)) continue;
              seenTracking.add(trackingUrl);
              console.log(`   🔗 ${trackingUrl.substring(0, 70)}...`);
              const finalUrl = await resolveCached(trackingUrl);
              if (finalUrl && isValidListingUrl(finalUrl)) {
                console.log(`      ✅ → ${finalUrl}`);
                allUrls.push(finalUrl);
              } else {
                console.log(`      ❌ Invalide: ${finalUrl}`);
              }
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }

        // Ajouter les URLs directes
        for (const email of allEmails) {
          allUrls.push(...email.directUrls);
        }

        if (allUrls.length > 0) {
          const existingContent = fs.existsSync(URLS_FILE)
            ? fs.readFileSync(URLS_FILE, "utf-8")
            : "";
          const existingUrls = existingContent
            .split("\n")
            .map((u) => u.trim())
            .filter((u) => u.startsWith("http"));
          const newUrls = [...new Set([...existingUrls, ...allUrls])];
          const header = "# URLs extraites automatiquement des alertes email\n";
          const content = header + newUrls.join("\n") + "\n";
          fs.writeFileSync(URLS_FILE, content, "utf-8");
          console.log(`\n✅ ${allUrls.length} URL(s) extraite(s)`);
          console.log(`   Total: ${newUrls.length} URLs dans urls.txt`);
        } else {
          console.log("\n️  Aucune URL trouvée");
        }

        if (savedFromEmail > 0) {
          console.log(
            `\n🎉 ${savedFromEmail} annonce(s) sauvegardée(s) directement depuis les emails`,
          );
        }

        // Fermer le navigateur
        if (browser) {
          await browser.close();
          browser = null;
        }

        await pool.end();
        imap.end();
        resolve();
      } catch (err) {
        if (browser) {
          await browser.close();
          browser = null;
        }
        reject(err);
      }
    });

    imap.once("error", (err: any) => {
      console.error("❌ Erreur IMAP:", err.message);
      reject(err);
    });

    imap.connect();
  });
}

fetchEmails().catch(console.error);
