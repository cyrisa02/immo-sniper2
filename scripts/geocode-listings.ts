// scripts/geocode-listings.ts
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

// API Nominatim (OpenStreetMap) - gratuite, 1 requête/seconde max
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

interface ListingToGeocode {
  id: number;
  address: string;
  surface_m2: number;
  rooms: number;
  price_eur: number;
}

async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    // Nettoyer l'adresse : enlever les parenthèses du code postal
    const cleanAddress = address
      .replace(/\s*\(\d{5}\)\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();

    const params = new URLSearchParams({
      q: cleanAddress,
      format: "json",
      limit: "1",
      countrycodes: "fr",
    });

    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": "ImmoSniperBot/1.0 (contact@immosniper.fr)",
        "Accept-Language": "fr",
      },
    });

    if (!response.ok) {
      console.log(`   ⚠️  HTTP ${response.status} pour "${address}"`);
      return null;
    }

    const results = await response.json();

    if (results.length === 0) {
      console.log(`   ⚠️  Aucun résultat pour "${address}"`);
      return null;
    }

    const { lat, lon } = results[0];
    return { lat: parseFloat(lat), lon: parseFloat(lon) };
  } catch (err: any) {
    console.log(`   ❌ Erreur géocodage "${address}": ${err.message}`);
    return null;
  }
}

async function geocodeAllListings() {
  console.log("🗺️  Géocodage des annonces sans coordonnées...\n");

  // Récupérer les annonces sans coordonnées
  const result = await pool.query(`
    SELECT id, address, surface_m2, rooms, price_eur
    FROM listings
    WHERE (lat IS NULL OR lon IS NULL OR lat = 0 OR lon = 0)
      AND address IS NOT NULL
      AND address != ''
    ORDER BY id ASC
  `);

  const listings: ListingToGeocode[] = result.rows;
  console.log(`📋 ${listings.length} annonce(s) à géocoder\n`);

  if (listings.length === 0) {
    console.log("✅ Toutes les annonces ont déjà des coordonnées");
    await pool.end();
    return;
  }

  let success = 0;
  let errors = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    console.log(`[${i + 1}/${listings.length}] ${listing.address}`);

    // Respecter la limite de 1 requête/seconde de Nominatim
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 1100));
    }

    const coords = await geocodeAddress(listing.address);

    if (coords) {
      // Mettre à jour la base avec les coordonnées + géométrie PostGIS
      await pool.query(
        `UPDATE listings 
         SET lat = $1, lon = $2, geom = ST_SetSRID(ST_MakePoint($2, $1), 4326)
         WHERE id = $3`,
        [coords.lat, coords.lon, listing.id],
      );
      console.log(`   ✅ ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
      success++;
    } else {
      errors++;
    }
  }

  console.log("\n✅ Géocodage terminé.");
  console.log(`   Succès : ${success}`);
  console.log(`   Échecs : ${errors}`);

  await pool.end();
}

geocodeAllListings().catch((err) => {
  console.error("❌ Erreur:", err);
  pool.end();
  process.exit(1);
});
