// web/src/app/api/history/route.ts
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
    const historyResult = await pool.query(`
      SELECT analyzed_at, total_listings, opportunities_found, avg_price_gap, total_potential_gain
      FROM analysis_history
      ORDER BY analyzed_at DESC
      LIMIT 30
    `);

    const statsResult = await pool.query(`
      SELECT 
        COUNT(*)::int as total_analyses,
        COALESCE(SUM(opportunities_found), 0)::int as total_opportunities,
        COALESCE(SUM(total_potential_gain), 0)::int as total_gain,
        COALESCE(AVG(avg_price_gap), 0)::float as avg_gap
      FROM analysis_history
    `);

    return NextResponse.json({
      history: historyResult.rows,
      stats: statsResult.rows[0],
    });
  } catch (error) {
    console.error("Erreur historique:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
