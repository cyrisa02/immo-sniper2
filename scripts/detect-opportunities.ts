// scripts/detect-opportunities.ts
import { Pool } from "pg";
import Groq from "groq-sdk";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

const pool = new Pool({
  user: "immo_user",
  host: "localhost",
  database: "immo_db",
  password: "immo_secret",
  port: 5432,
});

async function sendEmailAlert(listings: any[]) {
  if (listings.length === 0) return;

  const emailContent = listings
    .map(
      (listing) => `
🏠 ${listing.address}
💰 Prix: ${listing.price_eur.toLocaleString("fr-FR")} €
📐 Surface: ${listing.surface_m2} m²
 Prix au m²: ${listing.listing_price_m2.toFixed(0)} € (quartier: ${listing.dvf_avg_price_m2.toFixed(0)} €)
📉 Sous-évaluation: ${listing.price_gap_percent.toFixed(1)}%
💵 Potentiel: ${((listing.dvf_avg_price_m2 - listing.listing_price_m2) * listing.surface_m2).toLocaleString("fr-FR")} €

💬 Pitch IA:
${listing.ai_pitch}

🔗 Voir l'annonce: ${listing.url}

---
  `,
    )
    .join("\n");

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Immo Sniper <onboarding@resend.dev>",
      to: [process.env.EMAIL_TO || "you@example.com"],
      subject: ` ${listings.length} opportunité${listings.length > 1 ? "s" : ""} immobilière${listings.length > 1 ? "s" : ""} détectée${listings.length > 1 ? "s" : ""}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #16a34a; margin-bottom: 20px;">
             ${listings.length} opportunité${listings.length > 1 ? "s" : ""} immobilière${listings.length > 1 ? "s" : ""}
          </h1>
          <p style="color: #6b7280; margin-bottom: 30px;">
            Analyse effectuée le ${new Date().toLocaleDateString("fr-FR", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${emailContent}</pre>
          </div>
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            Immo Sniper - Analyse automatisée basée sur les données DVF
          </p>
        </div>
      `,
    });
    console.log("✅ Email envoyé avec succès");
  } catch (err) {
    console.error("❌ Erreur envoi email:", err);
  }
}

async function detectOpportunities(sendEmail = false) {
  console.log("🔍 Analyse des opportunités immobilières...");

  const listingsResult = await pool.query(`
    SELECT id, url, price_eur, surface_m2, rooms, address, geom
    FROM listings
    WHERE dvf_avg_price_m2 IS NULL
  `);

  console.log(` ${listingsResult.rows.length} annonces à analyser`);

  const newOpportunities: any[] = [];

  for (const listing of listingsResult.rows) {
    console.log(`\n🏠 Analyse de : ${listing.address}`);
    console.log(
      `   Prix: ${listing.price_eur}€ | Surface: ${listing.surface_m2}m²`,
    );

    const dvfResult = await pool.query(
      `SELECT price_eur, surface_m2, address, mutation_date
       FROM dvf_sales
       WHERE ST_DWithin(geom, $1, 500)
       ORDER BY mutation_date DESC
       LIMIT 10`,
      [listing.geom],
    );

    const comparableSales = dvfResult.rows;
    console.log(
      `   📍 ${comparableSales.length} ventes comparables trouvées dans un rayon de 500m`,
    );

    if (comparableSales.length === 0) {
      console.log("   ⚠️  Pas assez de données DVF dans le rayon");
      await pool.query(
        `UPDATE listings
         SET dvf_avg_price_m2 = 0,
             listing_price_m2 = $1,
             price_gap_percent = 0,
             is_underpriced = FALSE,
             comparable_sales_count = 0
         WHERE id = $2`,
        [listing.price_eur / listing.surface_m2, listing.id],
      );
      continue;
    }

    const avgPriceM2 =
      comparableSales.reduce((sum: number, sale: any) => {
        return sum + sale.price_eur / sale.surface_m2;
      }, 0) / comparableSales.length;

    const listingPriceM2 = listing.price_eur / listing.surface_m2;
    const priceGapPercent = ((listingPriceM2 - avgPriceM2) / avgPriceM2) * 100;
    const isUnderpriced = priceGapPercent < -10;

    console.log(`   📈 Prix moyen quartier: ${avgPriceM2.toFixed(0)}€/m²`);
    console.log(`   🏷️  Prix listing: ${listingPriceM2.toFixed(0)}€/m²`);
    console.log(`   📊 Écart: ${priceGapPercent.toFixed(1)}%`);

    if (isUnderpriced) {
      console.log("   ✅ OPPORTUNITÉ DÉTECTÉE !");

      const comparableText = comparableSales
        .slice(0, 3)
        .map(
          (sale: any, idx: number) =>
            `${idx + 1}. ${sale.address} - ${sale.price_eur}€ pour ${sale.surface_m2}m² (${(
              sale.price_eur / sale.surface_m2
            ).toFixed(
              0,
            )}€/m²) - Vendu le ${sale.mutation_date.toLocaleDateString("fr-FR")}`,
        )
        .join("\n");

      const potentialGain = Math.round(
        (avgPriceM2 - listingPriceM2) * listing.surface_m2,
      );

      const prompt = `Voici une maison/appartement à vendre :
- Adresse: ${listing.address}
- Prix: ${listing.price_eur}€
- Surface: ${listing.surface_m2}m²
- Prix au m²: ${listingPriceM2.toFixed(0)}€/m²

Voici 3 ventes comparables dans un rayon de 500m :
${comparableText}

La moyenne du quartier est de ${avgPriceM2.toFixed(0)}€/m².

Rédige un message WhatsApp de 4 lignes maximum pour le propriétaire, en lui expliquant qu'il passe à côté de ${potentialGain}€ de valeur potentielle. Ton direct, professionnel, sans jargon.`;

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Tu es un expert immobilier. Réponds de manière concise et percutante.",
          },
          { role: "user", content: prompt },
        ],
        model: "qwen/qwen3.8-27b",
      });

      const aiPitch = completion.choices[0].message.content || "";

      console.log(`\n💬 Pitch IA généré :\n${aiPitch}\n`);

      await pool.query(
        `UPDATE listings
         SET dvf_avg_price_m2 = $1,
             listing_price_m2 = $2,
             price_gap_percent = $3,
             is_underpriced = TRUE,
             ai_pitch = $4,
             comparable_sales_count = $5
         WHERE id = $6`,
        [
          avgPriceM2,
          listingPriceM2,
          priceGapPercent,
          aiPitch,
          comparableSales.length,
          listing.id,
        ],
      );

      const alreadySent = await pool.query(
        "SELECT id FROM email_alerts WHERE listing_id = $1 AND DATE(sent_at) = CURRENT_DATE",
        [listing.id],
      );

      if (alreadySent.rows.length === 0) {
        newOpportunities.push({
          ...listing,
          dvf_avg_price_m2: avgPriceM2,
          listing_price_m2: listingPriceM2,
          price_gap_percent: priceGapPercent,
          ai_pitch: aiPitch,
          potential_gain: potentialGain,
        });

        await pool.query("INSERT INTO email_alerts (listing_id) VALUES ($1)", [
          listing.id,
        ]);
      }
    } else {
      await pool.query(
        `UPDATE listings
         SET dvf_avg_price_m2 = $1,
             listing_price_m2 = $2,
             price_gap_percent = $3,
             is_underpriced = FALSE,
             comparable_sales_count = $4
         WHERE id = $5`,
        [
          avgPriceM2,
          listingPriceM2,
          priceGapPercent,
          comparableSales.length,
          listing.id,
        ],
      );
    }
  }

  console.log("\n✅ Analyse terminée.");

  const summary = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN is_underpriced = TRUE THEN 1 END) as opportunities
    FROM listings
    WHERE dvf_avg_price_m2 IS NOT NULL
  `);

  console.log(`\n📊 Résumé :`);
  console.log(`   Total analysé: ${summary.rows[0].total}`);
  console.log(`   Opportunités détectées: ${summary.rows[0].opportunities}`);

  if (sendEmail && newOpportunities.length > 0) {
    console.log(`\n📧 Envoi de ${newOpportunities.length} alerte(s) email...`);
    await sendEmailAlert(newOpportunities);
  }

  await pool.end();
}

const sendEmail = process.argv.includes("--send-email");

detectOpportunities(sendEmail).catch(console.error);
