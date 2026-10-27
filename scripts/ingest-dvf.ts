// scripts/ingest-dvf.ts
import fs from "fs";
import csvParser from "csv-parser";
import { Pool } from "pg";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

const DVF_FILE_PATH = path.join(__dirname, "../data/valeursfoncieres-2025.txt");

// Date limite : 24 mois en arrière
const TWO_YEARS_AGO = new Date();
TWO_YEARS_AGO.setFullYear(TWO_YEARS_AGO.getFullYear() - 2);

// Cache pour éviter de géocoder plusieurs fois la même adresse
const geocodeCache = new Map<string, { lon: number; lat: number } | null>();

async function geocodeAddress(
  address: string,
): Promise<{ lon: number; lat: number } | null> {
  if (geocodeCache.has(address)) {
    return geocodeCache.get(address);
  }

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1&type=housenumber`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const [lon, lat] = data.features[0].geometry.coordinates;
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

// Délai entre les appels API pour éviter le rate-limit
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ingestDVF() {
  console.log("🚀 Démarrage de l'ingestion DVF (département 60 uniquement)...");

  let insertedCount = 0;
  let skippedCount = 0;
  let geocodeCount = 0;

  const stream = fs
    .createReadStream(DVF_FILE_PATH)
    .pipe(csvParser({ separator: "|" }));

  for await (const row of stream) {
    // 1. Filtrage sur le département (Oise = 60)
    if (row["Code departement"] !== "60") {
      skippedCount++;
      continue;
    }

    // 2. Filtrage sur le type de bien
    const typeLocal = row["Type local"];
    if (typeLocal !== "Appartement" && typeLocal !== "Maison") {
      skippedCount++;
      continue;
    }

    // 3. Filtrage sur la date (format JJ/MM/AAAA)
    const dateParts = row["Date mutation"].split("/");
    const mutationDate = new Date(
      `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`,
    );

    if (mutationDate < TWO_YEARS_AGO) {
      skippedCount++;
      continue;
    }

    // 4. Récupération du prix (format français avec virgule)
    const priceStr = row["Valeur fonciere"].replace(",", ".");
    const price = parseFloat(priceStr);
    const surface = parseFloat(row["Surface reelle bati"]);

    if (isNaN(price) || price === 0 || isNaN(surface) || surface === 0) {
      skippedCount++;
      continue;
    }

    // 5. Construction de l'adresse pour géocodage
    const voie =
      `${row["No voie"] || ""} ${row["B/T/Q"] || ""} ${row["Type de voie"] || ""} ${row["Voie"] || ""}`.trim();
    const fullAddress = `${voie}, ${row["Code postal"]} ${row["Commune"]}`;

    // 6. Géocodage (avec cache)
    const coords = await geocodeAddress(fullAddress);

    if (!coords) {
      skippedCount++;
      continue;
    }

    geocodeCount++;

    // 7. Insertion dans PostGIS
    try {
      await pool.query(
        `INSERT INTO dvf_sales (mutation_date, price_eur, surface_m2, address, geom)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)`,
        [mutationDate, price, surface, fullAddress, coords.lon, coords.lat],
      );
      insertedCount++;

      if (insertedCount % 100 === 0) {
        console.log(
          `   ... ${insertedCount} ventes insérées | ${geocodeCount} géocodages | Cache: ${geocodeCache.size} adresses`,
        );
      }
    } catch {
      skippedCount++;
    }

    // Délai de 300ms entre chaque géocodage pour respecter l'API BAN
    await sleep(300);
  }

  console.log(`✅ Ingestion terminée.`);
  console.log(`   ${insertedCount} ventes insérées dans PostGIS.`);
  console.log(`   ${geocodeCount} adresses géocodées via BAN.`);
  console.log(`   ${skippedCount} lignes ignorées.`);
  await pool.end();
}

ingestDVF().catch(console.error);
