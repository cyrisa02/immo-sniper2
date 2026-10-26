// scripts/ingest.ts
import { chromium } from "playwright";
import Groq from "groq-sdk";
import { z } from "zod";
import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

// Schéma de validation pour forcer la structure de sortie de l'IA
const ListingSchema = z.object({
  price_eur: z.number(),
  surface_m2: z.number(),
  rooms: z.number(),
  address: z.string(),
  defects: z.array(z.string()).optional(),
});

async function geocodeAddress(address: string) {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.features && data.features.length > 0) {
    const [lon, lat] = data.features[0].geometry.coordinates;
    return { lon, lat };
  }
  throw new Error(`Géocodage échoué pour : ${address}`);
}

async function processListing(url: string) {
  console.log(`[1/4] Scraping de ${url}...`);

  // Profil navigateur persistant (cookies, cache, historique)
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

  const page = context.pages()[0] || (await context.newPage());

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Délai aléatoire humain (2-5 secondes)
  const delay = Math.floor(Math.random() * 3000) + 2000;
  console.log(`Attente ${delay}ms...`);
  await page.waitForTimeout(delay);

  // Pause manuelle pour résoudre les CAPTCHAs si nécessaire
  console.log(
    "Si bloqué, résous le CAPTCHA manuellement. Appuie sur Entrée pour continuer...",
  );
  await new Promise((resolve) => process.stdin.once("data", resolve));

  const rawText = await page.evaluate(() => document.body.innerText);
  await context.close();

  if (rawText.includes("Accès temporairement restreint")) {
    throw new Error(
      "Leboncoin bloque l'accès. Réessaie dans 30 min ou change d'IP.",
    );
  }

  console.log(`[2/4] Extraction structurée via Qwen...`);
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "Extrais les données de l'annonce immobilière. Réponds UNIQUEMENT avec le JSON brut, sans balises markdown, sans explication.",
      },
      {
        role: "user",
        content: `Schéma JSON attendu: ${JSON.stringify(ListingSchema.shape)}.\n\nAnnonce: ${rawText.substring(0, 4000)}`,
      },
    ],
    model: "qwen/qwen3.8-27b",
    response_format: { type: "json_object" },
  });

  const rawContent = completion.choices[0].message.content || "{}";
  // Nettoyage au cas où Qwen ajouterait des balises markdown
  const cleanedContent = rawContent
    .replace(/```json\s?/g, "")
    .replace(/```/g, "")
    .trim();
  const parsedData = ListingSchema.parse(JSON.parse(cleanedContent));

  console.log(`[3/4] Géocodage via l'API BAN...`);
  const { lon, lat } = await geocodeAddress(parsedData.address);

  console.log(`[4/4] Insertion dans PostGIS...`);
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
      lon,
      lat,
    ],
  );

  console.log("✅ Annonce ingérée avec succès.");
  console.log(
    `   Prix: ${parsedData.price_eur} € | Surface: ${parsedData.surface_m2} m² | Pièces: ${parsedData.rooms}`,
  );
  console.log(`   Adresse: ${parsedData.address} (${lon}, ${lat})`);
}

// Exécution
const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("Usage: npx tsx scripts/ingest.ts <URL_LEBONCOIN>");
  process.exit(1);
}

processListing(targetUrl)
  .catch((err) => {
    console.error("❌ Erreur:", err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
