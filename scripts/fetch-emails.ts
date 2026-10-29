// scripts/fetch-emails.ts
import Imap from "imap";
import { simpleParser } from "mailparser";
import { chromium, Browser } from "playwright";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const URLS_FILE = path.join(__dirname, "../urls.txt");

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

    // Attendre que le JavaScript exécute la redirection
    await page.waitForTimeout(2000);

    const finalUrl = page.url().split("?")[0];
    await context.close();

    return finalUrl;
  } catch (err: any) {
    console.log(`        ️  Erreur Playwright: ${err.message}`);
    return null;
  }
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

    // SeLoger : seul le bouton "Voir l'annonce" pointe vers une annonce.
    // Tous les autres liens click.by.seloger.com (logo, alertes, CGU...) sont ignorés.
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
  const slRegex = /https:\/\/www\.seloger\.com\/annon?ces\/[^\s<"]+/gi;
  urls.push(...(text.match(lbcRegex) || []).map((u) => u.split("?")[0]));
  urls.push(...(text.match(slRegex) || []).map((u) => u.split("?")[0]));
  return [...new Set(urls)];
}

function isValidListingUrl(url: string): boolean {
  if (/leboncoin\.fr\/(vi|ventes)\/\d+/.test(url)) return true;
  if (/seloger\.com\/annonces?\/.+\/[A-Z0-9]+(\.htm)?\/?$/i.test(url))
    return true;
  return false;
}

interface EmailData {
  subject: string;
  directUrls: string[];
  trackingUrls: string[];
}

async function fetchFromFolder(
  imap: Imap,
  folder: string,
): Promise<EmailData[]> {
  return new Promise((resolve, reject) => {
    imap.openBox(folder, false, (err: any) => {
      if (err) {
        console.log(`   ⚠️  Dossier "${folder}" introuvable, skip`);
        resolve([]);
        return;
      }
      imap.search(["UNSEEN"], (err: any, results: any) => {
        if (err) reject(err);
        if (!results || results.length === 0) {
          console.log(`   📭 Aucun email non lu dans "${folder}"`);
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
                    console.log(`     [${processed}] ${subject} (ignoré)`);
                    return done();
                  }
                  const { direct, tracking } = extractUrlsFromHtml(html);
                  const textUrls = extractUrlsFromText(text);
                  const allDirect = [...new Set([...direct, ...textUrls])];
                  console.log(
                    `     [${processed}] ${subject} → ${allDirect.length} directes, ${tracking.length} tracking`,
                  );
                  emails.push({
                    subject,
                    directUrls: allDirect,
                    trackingUrls: tracking,
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

  return new Promise<void>((resolve, reject) => {
    imap.once("ready", async () => {
      try {
        console.log("🔍 Recherche dans INBOX...");
        const inboxEmails = await fetchFromFolder(imap, "INBOX");
        allEmails.push(...inboxEmails);

        console.log("🔍 Recherche dans [Gmail]/Promotions...");
        const promoEmails = await fetchFromFolder(imap, "[Gmail]/Promotions");
        allEmails.push(...promoEmails);

        // Résoudre les redirects avec Playwright
        const totalTracking = allEmails.reduce(
          (sum, e) => sum + e.trackingUrls.length,
          0,
        );
        if (totalTracking > 0) {
          console.log(
            `\n Résolution de ${totalTracking} redirect(s) avec Playwright...`,
          );

          const seenTracking = new Set<string>();
          for (const email of allEmails) {
            for (const trackingUrl of email.trackingUrls) {
              if (seenTracking.has(trackingUrl)) continue;
              seenTracking.add(trackingUrl);
              console.log(`   🔗 ${trackingUrl.substring(0, 70)}...`);
              const finalUrl = await resolveSeLogerRedirect(trackingUrl);
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
          console.log("\n⚠️  Aucune URL trouvée");
        }

        // Fermer le navigateur
        if (browser) {
          await browser.close();
          browser = null;
        }

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
