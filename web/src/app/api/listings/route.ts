// web/src/app/api/listings/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT 
        id, url, source, title, price_eur, surface_m2, rooms, address, description,
        dvf_avg_price_m2, listing_price_m2, price_gap_percent, is_underpriced,
        ai_pitch, comparable_sales_count, photo_analysis,
        dpe, estimated_works, estimated_rent, gross_yield,
        lat, lon
      FROM listings
      ORDER BY created_at DESC
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Erreur listings:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
