// web/src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST() {
  try {
    // 1. Récupérer les listings non analysés
    const listingsResult = await pool.query(`
      SELECT id, url, price_eur, surface_m2, address, geom
      FROM listings
      WHERE dvf_avg_price_m2 IS NULL
    `);

    const toAnalyze = listingsResult.rows;
    let opportunitiesFound = 0;
    const analyzed: any[] = [];

    // 2. Analyser chaque listing
    for (const listing of toAnalyze) {
      const dvfResult = await pool.query(
        `SELECT price_eur, surface_m2, address, mutation_date
         FROM dvf_sales
         WHERE ST_DWithin(geom, $1, 500)
         ORDER BY mutation_date DESC
         LIMIT 10`,
        [listing.geom],
      );

      const comparableSales = dvfResult.rows;

      if (comparableSales.length === 0) {
        await pool.query(
          `UPDATE listings
           SET dvf_avg_price_m2 = 0, listing_price_m2 = $1,
               price_gap_percent = 0, is_underpriced = FALSE, comparable_sales_count = 0
           WHERE id = $2`,
          [listing.price_eur / listing.surface_m2, listing.id],
        );
        continue;
      }

      const avgPriceM2 =
        comparableSales.reduce(
          (sum: number, s: any) => sum + s.price_eur / s.surface_m2,
          0,
        ) / comparableSales.length;
      const listingPriceM2 = listing.price_eur / listing.surface_m2;
      const priceGapPercent =
        ((listingPriceM2 - avgPriceM2) / avgPriceM2) * 100;
      const isUnderpriced = priceGapPercent < -10;

      let aiPitch = null;

      if (isUnderpriced) {
        const potentialGain = Math.round(
          (avgPriceM2 - listingPriceM2) * listing.surface_m2,
        );
        const comparableText = comparableSales
          .slice(0, 3)
          .map(
            (s: any, i: number) =>
              `${i + 1}. ${s.address} - ${s.price_eur}€ / ${s.surface_m2}m² (${(s.price_eur / s.surface_m2).toFixed(0)}€/m²)`,
          )
          .join("\n");

        const completion = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content:
                "Expert immobilier. Réponds de manière concise et percutante.",
            },
            {
              role: "user",
              content: `Maison à vendre : ${listing.address}, ${listing.price_eur}€, ${listing.surface_m2}m² (${listingPriceM2.toFixed(0)}€/m²). Moyenne quartier : ${avgPriceM2.toFixed(0)}€/m². Ventes comparables :\n${comparableText}. Rédige un message WhatsApp de 4 lignes max expliquant qu'il passe à côté de ${potentialGain}€ de valeur. Ton direct, pro, sans jargon.`,
            },
          ],
          model: "qwen/qwen3.8-27b",
        });

        aiPitch = completion.choices[0].message.content || "";
        opportunitiesFound++;
      }

      await pool.query(
        `UPDATE listings
         SET dvf_avg_price_m2 = $1, listing_price_m2 = $2, price_gap_percent = $3,
             is_underpriced = $4, ai_pitch = $5, comparable_sales_count = $6
         WHERE id = $7`,
        [
          avgPriceM2,
          listingPriceM2,
          priceGapPercent,
          isUnderpriced,
          aiPitch,
          comparableSales.length,
          listing.id,
        ],
      );

      analyzed.push({ address: listing.address, isUnderpriced, aiPitch });
    }

    return NextResponse.json({
      success: true,
      analyzed: analyzed.length,
      opportunities: opportunitiesFound,
      details: analyzed,
    });
  } catch (error) {
    console.error("Erreur analyse:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
