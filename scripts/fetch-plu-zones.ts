// scripts/fetch-plu-zones.ts
import { Pool } from "pg";
import fs from "fs";
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

interface PluZoneConfig {
  code: string;
  type: string;
  libelle: string;
  constructibilite: string;
  conseil: string;
}

interface CommuneConfig {
  insee: string;
  name: string;
  center: { lat: number; lon: number };
  zones: PluZoneConfig[];
}

interface PluConfig {
  communes: CommuneConfig[];
}

async function importPluZones() {
  console.log("🗺️  Import des zones PLU depuis la configuration...\n");

  // Charger le fichier de config
  const configPath = path.join(__dirname, "../data/plu-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("❌ Fichier data/plu-config.json introuvable");
    await pool.end();
    process.exit(1);
  }

  const config: PluConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log(`📋 ${config.communes.length} commune(s) à importer\n`);

  // Vider la table
  await pool.query("TRUNCATE TABLE plu_zones RESTART IDENTITY");

  let totalZones = 0;

  for (const commune of config.communes) {
    console.log(` ${commune.name} (${commune.insee})`);

    for (const zone of commune.zones) {
      // Créer un polygone circulaire simplifié autour du centre de la commune
      // Rayon : 3km pour UA/UB, 5km pour 1AU/2AU, 8km pour A/N
      let radiusKm = 3;
      if (zone.code.startsWith("AU")) radiusKm = 5;
      if (zone.code === "A" || zone.code === "N") radiusKm = 8;

      // Approximation : 1 degré ≈ 111 km
      const radiusDeg = radiusKm / 111;
      const lat = commune.center.lat;
      const lon = commune.center.lon;

      // Créer un cercle approximatif (16 points)
      const points: string[] = [];
      const numPoints = 16;
      for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const px = lon + radiusDeg * Math.cos(angle);
        const py = lat + radiusDeg * Math.sin(angle);
        points.push(`${px} ${py}`);
      }
      const wkt = `POLYGON((${points.join(",")}))`;

      try {
        await pool.query(
          `INSERT INTO plu_zones (insee_code, commune, zone_code, zone_libelle, zone_type, geom)
           VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 4326))`,
          [
            commune.insee,
            commune.name,
            zone.code,
            zone.libelle,
            zone.type,
            wkt,
          ],
        );
        totalZones++;
      } catch (err: any) {
        console.log(`   ️  Erreur zone ${zone.code}: ${err.message}`);
      }
    }

    console.log(`   ✅ ${commune.zones.length} zone(s) importées`);
  }

  console.log(`\n✅ ${totalZones} zones PLU importées au total`);

  // Créer une table de règles métier pour le RAG
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plu_rules (
      id SERIAL PRIMARY KEY,
      zone_code VARCHAR(20) UNIQUE,
      zone_type VARCHAR(50),
      constructibilite TEXT,
      conseil_investissement TEXT
    );
  `);

  // Insérer les règles métier (une seule entrée par code de zone)
  const allZones = new Map<string, PluZoneConfig>();
  for (const commune of config.communes) {
    for (const zone of commune.zones) {
      if (!allZones.has(zone.code)) {
        allZones.set(zone.code, zone);
      }
    }
  }

  for (const [code, zone] of allZones) {
    await pool.query(
      `INSERT INTO plu_rules (zone_code, zone_type, constructibilite, conseil_investissement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (zone_code) DO UPDATE SET 
         constructibilite = EXCLUDED.constructibilite,
         conseil_investissement = EXCLUDED.conseil_investissement`,
      [code, zone.type, zone.constructibilite, zone.conseil],
    );
  }

  console.log(`📊 ${allZones.size} règle(s) métier importées dans plu_rules`);

  // Statistiques
  const stats = await pool.query(`
    SELECT zone_type, COUNT(*) as count
    FROM plu_zones
    GROUP BY zone_type
    ORDER BY count DESC
  `);
  console.log("\n📊 Répartition par type :");
  stats.rows.forEach((row) => {
    console.log(`   ${row.zone_type}: ${row.count} zones`);
  });

  await pool.end();
}

importPluZones().catch((err) => {
  console.error("❌ Erreur:", err);
  pool.end();
  process.exit(1);
});
