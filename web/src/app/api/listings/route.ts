// web/src/app/api/listings/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT 
        id, url, price_eur, surface_m2, rooms, address,
        dvf_avg_price_m2, listing_price_m2, price_gap_percent,
        is_underpriced, ai_pitch, comparable_sales_count,
        ST_X(geom::geometry) as lon, ST_Y(geom::geometry) as lat
      FROM listings
      WHERE dvf_avg_price_m2 IS NOT NULL
      ORDER BY price_gap_percent ASC
    `);

    const listings = result.rows;

    // Pour chaque listing sous-évalué, on récupère les ventes DVF comparables (rayon 500m)
    for (const listing of listings) {
      if (listing.is_underpriced) {
        const dvfRes = await pool.query(
          `
          SELECT 
            price_eur, surface_m2, address, mutation_date,
            ST_X(geom::geometry) as lon, ST_Y(geom::geometry) as lat
          FROM dvf_sales
          WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 500)
          ORDER BY mutation_date DESC
          LIMIT 15
        `,
          [listing.lon, listing.lat],
        );

        listing.comparable_sales = dvfRes.rows;
      } else {
        listing.comparable_sales = [];
      }
    }

    return NextResponse.json(listings);
  } catch (error) {
    console.error("Erreur API listings:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
