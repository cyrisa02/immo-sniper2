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
📉 Prix au m²: ${listing.listing_price_m2.toFixed(0)} € (quartier: ${listing.dvf_avg_price_m2.toFixed(0)} €)
📊 Sous-évaluation: ${listing.price_gap_percent.toFixed(1)}%
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
      subject: `🎯 ${listings.length} opportunité(s) immobilière(s) détectée(s)`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #16a34a; margin-bottom: 20px;">🎯 ${listings.length} opportunité(s)</h1>
          <p style="color: #6b7280; margin-bottom: 30px;">Analyse effectuée le ${new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${emailContent}</pre>
          </div>
        </div>
      `,
    });
    console.log("✅ Email envoyé avec succès");
  } catch (err) {
    console.error("❌ Erreur envoi email:", err);
  }
}

async function sendTelegramAlert(listings: any[]) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log("⚠️ Variables Telegram manquantes dans .env");
    return;
  }

  const text = listings
    .map(
      (l) =>
        `🏠 <b>${l.address}</b>\n` +
        `💰 ${l.price_eur.toLocaleString("fr-FR")} € (${l.listing_price_m2?.toFixed(0)} €/m²)\n` +
        `📉 <b>${l.price_gap_percent.toFixed(1)}%</b> sous le marché\n` +
        `💬 ${l.ai_pitch}\n` +
        `🔗 <a href="${l.url}">Voir l'annonce</a>`,
    )
    .join("\n\n---\n\n");

  const fullMessage = `🎯 <b>${listings.length} opportunité(s) détectée(s)</b>\n\n${text}`;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: fullMessage,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );

    if (res.ok) console.log("✅ Notification Telegram envoyée");
    else console.log("⚠️ Erreur Telegram:", await res.text());
  } catch (err) {
    console.error("❌ Erreur Telegram:", err);
  }
}

async function recordAnalysisHistory(newListings: any[], opportunities: any[]) {
  // Récupérer le TOTAL des annonces en base (pas juste celles à analyser)
  const totalResult = await pool.query(
    "SELECT COUNT(*)::int as total FROM listings",
  );
  const totalListings = totalResult.rows[0].total;

  // Récupérer le total des opportunités en base
  const oppResult = await pool.query(
    "SELECT COUNT(*)::int as total, AVG(price_gap_percent)::float as avg_gap, SUM(((dvf_avg_price_m2 - listing_price_m2) * surface_m2))::int as total_gain FROM listings WHERE is_underpriced = TRUE",
  );
  const oppStats = oppResult.rows[0];

  const avgGap = oppStats.avg_gap || 0;
  const totalGain = oppStats.total_gain || 0;
  const totalOpp = oppStats.total || 0;

  await pool.query(
    `INSERT INTO analysis_history (total_listings, opportunities_found, avg_price_gap, total_potential_gain)
     VALUES ($1, $2, $3, $4)`,
    [totalListings, totalOpp, avgGap, totalGain],
  );

  console.log(
    `📊 Historique enregistré : ${totalListings} annonces, ${totalOpp} opportunités, ${totalGain.toLocaleString("fr-FR")}€ de gain potentiel`,
  );
}

async function detectOpportunities(sendEmail = false) {
  console.log("🔍 Analyse des opportunités immobilières...");

  const listingsResult = await pool.query(`
    SELECT id, url, price_eur, surface_m2, rooms, address, geom
    FROM listings
    WHERE dvf_avg_price_m2 IS NULL
  `);

  console.log(`📋 ${listingsResult.rows.length} annonces à analyser`);

  const newOpportunities: any[] = [];

  for (const listing of listingsResult.rows) {
    console.log(`\n🏠 Analyse de : ${listing.address}`);

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
        `UPDATE listings SET dvf_avg_price_m2 = 0, listing_price_m2 = $1, price_gap_percent = 0, is_underpriced = FALSE, comparable_sales_count = 0 WHERE id = $2`,
        [listing.price_eur / listing.surface_m2, listing.id],
      );
      continue;
    }

    const avgPriceM2 =
      comparableSales.reduce(
        (sum: number, sale: any) => sum + sale.price_eur / sale.surface_m2,
        0,
      ) / comparableSales.length;
    const listingPriceM2 = listing.price_eur / listing.surface_m2;
    const priceGapPercent = ((listingPriceM2 - avgPriceM2) / avgPriceM2) * 100;
    const isUnderpriced = priceGapPercent < -10;

    console.log(
      `   📈 Quartier: ${avgPriceM2.toFixed(0)}€/m² | 🏷️ Listing: ${listingPriceM2.toFixed(0)}€/m² | 📊 Écart: ${priceGapPercent.toFixed(1)}%`,
    );

    if (isUnderpriced) {
      console.log("   ✅ OPPORTUNITÉ DÉTECTÉE !");

      const comparableText = comparableSales
        .slice(0, 3)
        .map(
          (sale: any, idx: number) =>
            `${idx + 1}. ${sale.address} - ${sale.price_eur}€ / ${sale.surface_m2}m² (${(sale.price_eur / sale.surface_m2).toFixed(0)}€/m²)`,
        )
        .join("\n");

      const potentialGain = Math.round(
        (avgPriceM2 - listingPriceM2) * listing.surface_m2,
      );

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Expert immobilier. Réponds de manière concise et percutante, max 4 lignes.",
          },
          {
            role: "user",
            content: `Maison à vendre : ${listing.address}, ${listing.price_eur}€, ${listing.surface_m2}m² (${listingPriceM2.toFixed(0)}€/m²). Moyenne quartier : ${avgPriceM2.toFixed(0)}€/m². Ventes comparables :\n${comparableText}. Rédige un message WhatsApp pour le propriétaire expliquant qu'il passe à côté de ${potentialGain}€ de valeur. Ton direct, pro, sans jargon.`,
          },
        ],
        model: "qwen/qwen3.8-27b",
      });

      const aiPitch = completion.choices[0].message.content || "";

      await pool.query(
        `UPDATE listings SET dvf_avg_price_m2 = $1, listing_price_m2 = $2, price_gap_percent = $3, is_underpriced = TRUE, ai_pitch = $4, comparable_sales_count = $5 WHERE id = $6`,
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
        });
        await pool.query("INSERT INTO email_alerts (listing_id) VALUES ($1)", [
          listing.id,
        ]);
      }
    } else {
      await pool.query(
        `UPDATE listings SET dvf_avg_price_m2 = $1, listing_price_m2 = $2, price_gap_percent = $3, is_underpriced = FALSE, comparable_sales_count = $4 WHERE id = $5`,
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

  // ✅ 1. Enregistrer l'historique AVANT de fermer le pool
  await recordAnalysisHistory(listingsResult.rows, newOpportunities);

  // ✅ 2. Envoyer les alertes
  if (sendEmail && newOpportunities.length > 0) {
    console.log(`\n📧 Envoi de ${newOpportunities.length} alerte(s)...`);
    await sendEmailAlert(newOpportunities);
    await sendTelegramAlert(newOpportunities);
  }

  // ✅ 3. Fermer le pool EN DERNIER
  await pool.end();
}

const sendEmail = process.argv.includes("--send-email");
detectOpportunities(sendEmail).catch(console.error);
