// scripts/fetch-plu-zones-api.ts
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

const TARGET_COMMUNES = [
  { insee: "60057", name: "Beauvais" },
  { insee: "60159", name: "Compiègne" },
  { insee: "02691", name: "Soissons" },
  { insee: "60395", name: "Méru" },
  { insee: "60141", name: "Clermont" },
  { insee: "60176", name: "Creil" },
  { insee: "60282", name: "Nogent-sur-Oise" },
];

// API REST du Géoportail de l'Urbanisme
const GPU_API_URL = "https://www.geoportail-urbanisme.gouv.fr/api";

async function fetchPluInfoForCommune(inseeCode: string, communeName: string) {
  try {
    // Récupérer les infos PLU de la commune
    const response = await fetch(`${GPU_API_URL}/communes/${inseeCode}/plu`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      console.log(`   ⚠️  HTTP ${response.status} pour ${communeName}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err: any) {
    console.log(`   ❌ Erreur pour ${communeName}: ${err.message}`);
    return null;
  }
}

async function fetchAllPluInfo() {
  console.log("🗺️  Récupération des infos PLU via l'API REST...\n");

  // Vider la table
  await pool.query("TRUNCATE TABLE plu_zones RESTART IDENTITY");

  for (const commune of TARGET_COMMUNES) {
    console.log(` ${commune.name} (${commune.insee})`);

    const info = await fetchPluInfoForCommune(commune.insee, commune.name);

    if (info) {
      console.log(
        `   ✅ PLU trouvé : ${JSON.stringify(info).substring(0, 100)}...`,
      );

      // Insérer une entrée simplifiée (zone par défaut si pas de géométrie)
      await pool.query(
        `INSERT INTO plu_zones (insee_code, commune, zone_code, zone_libelle, zone_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [commune.insee, commune.name, "UA", "Zone urbaine (défaut)", "urbaine"],
      );
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  const count = await pool.query("SELECT COUNT(*) FROM plu_zones");
  console.log(`\n✅ ${count.rows[0].count} entrée(s) PLU en base`);

  await pool.end();
}

fetchAllPluInfo().catch((err) => {
  console.error("❌ Erreur:", err);
  pool.end();
  process.exit(1);
});
