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

// ============================================================
// NOTIFICATIONS
// ============================================================

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

🔧 Travaux estimés: ${listing.estimated_works?.toLocaleString("fr-FR") || 0} €
🏠 Loyer potentiel: ${listing.estimated_rent || 0} €/mois
 Rentabilité brute: ${listing.gross_yield?.toFixed(1) || 0}%
${listing.dpe ? `🏷️ DPE: ${listing.dpe}` : ""}

${listing.photo_analysis ? `📸 Diagnostic photos:\n${listing.photo_analysis}\n` : ""}
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
    .map((l) => {
      const works = l.estimated_works
        ? `🔧 Travaux : ${l.estimated_works.toLocaleString("fr-FR")} €\n`
        : "";
      const rent = l.estimated_rent
        ? ` Loyer : ${l.estimated_rent} €/mois\n`
        : "";
      const yield_ = l.gross_yield
        ? `📊 Rentabilité : <b>${l.gross_yield.toFixed(1)}%</b>\n`
        : "";
      const dpe = l.dpe && l.dpe !== "inconnu" ? `🏷️ DPE : ${l.dpe}\n` : "";
      const photo = l.photo_analysis
        ? `📸 <i>${l.photo_analysis.substring(0, 200)}...</i>\n`
        : "";

      return (
        `🏠 <b>${l.address}</b>\n` +
        `💰 ${l.price_eur.toLocaleString("fr-FR")} € (${l.listing_price_m2?.toFixed(0)} €/m²)\n` +
        `📉 <b>${l.price_gap_percent.toFixed(1)}%</b> sous le marché\n` +
        works +
        rent +
        yield_ +
        dpe +
        photo +
        `💬 ${l.ai_pitch}\n` +
        `🔗 <a href="${l.url}">Voir l'annonce</a>`
      );
    })
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

// ============================================================
// ANALYSE PHOTOS (Vision IA)
// ============================================================

async function analyzePhotos(photos: string[]): Promise<string | null> {
  if (!photos || photos.length === 0) return null;

  try {
    const photosToAnalyze = photos.slice(0, 3);

    const completion = await groq.chat.completions.create({
      model: "qwen/qwen3.8-27b",
      messages: [
        {
          role: "system",
          content:
            "Expert en diagnostic immobilier. Analyse les photos et donne un résumé concis en 3-4 lignes maximum en français. Focus sur : état général, travaux visibles (toiture, façade, intérieur), qualité lumineuse, type de sol. Si tu vois des rendus 3D au lieu de vraies photos, signale-le clairement.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyse ces photos d'annonce immobilière et donne ton diagnostic :",
            },
            ...photosToAnalyze.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
      max_tokens: 300,
    });

    return completion.choices[0].message.content || null;
  } catch (err: any) {
    console.log(`   ⚠️  Erreur analyse photos: ${err.message}`);
    return null;
  }
}

// ============================================================
// CALCULATEUR DE RENTABILITÉ & TRAVAUX
// ============================================================

async function calculateProfitability(
  listing: any,
  description: string,
): Promise<{
  dpe: string;
  estimated_works: number;
  estimated_rent: number;
  gross_yield: number;
}> {
  // 1. Extraire le DPE de la description
  const dpeMatch = description?.match(/DPE\s*[:\(]?\s*([A-G])/i);
  const dpe = dpeMatch?.[1]?.toUpperCase() || "inconnu";

  // 2. Estimer les travaux selon DPE + mots-clés
  let worksPerM2 = 0;
  const descLower = description?.toLowerCase() || "";

  if (dpe === "G") worksPerM2 = 600;
  else if (dpe === "F") worksPerM2 = 450;
  else if (dpe === "E") worksPerM2 = 300;
  else if (dpe === "D") worksPerM2 = 150;
  else if (dpe === "C") worksPerM2 = 50;

  if (descLower.includes("à rénover") || descLower.includes("a rénover"))
    worksPerM2 += 400;
  if (descLower.includes("travaux")) worksPerM2 += 200;
  if (descLower.includes("rafraîchir")) worksPerM2 += 100;
  if (descLower.includes("neuf") || descLower.includes("récemment"))
    worksPerM2 = 0;

  const estimated_works = Math.round(listing.surface_m2 * worksPerM2);

  // 3. Estimer le loyer via IA
  let estimated_rent = 0;
  try {
    const rentCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Expert en estimation locative française. Réponds UNIQUEMENT avec un nombre entier (le loyer mensuel en euros), sans texte supplémentaire, sans unité, sans espace. Base-toi sur le code postal, la surface, le nombre de pièces et le type de bien.",
        },
        {
          role: "user",
          content: `Estime le loyer mensuel hors charges pour ce bien :
- Adresse : ${listing.address}
- Type : ${listing.title || "logement"}
- Surface : ${listing.surface_m2} m²
- Pièces : ${listing.rooms}
- Description : ${description?.substring(0, 300) || "N/A"}

Réponds uniquement avec le montant en euros (ex: 850).`,
        },
      ],
      model: "qwen/qwen3.8-27b",
      max_tokens: 10,
    });

    const rentText = rentCompletion.choices[0].message.content?.trim() || "0";
    const rentMatch = rentText.match(/\d+/);
    estimated_rent = rentMatch ? parseInt(rentMatch[0]) : 0;

    // Sanity check : loyer cohérent (entre 5 et 25€/m²)
    const rentPerM2 = estimated_rent / listing.surface_m2;
    if (rentPerM2 < 5 || rentPerM2 > 25) {
      console.log(
        `   ⚠️  Loyer IA incohérent (${estimated_rent}€), fallback règles`,
      );
      estimated_rent = 0;
    }
  } catch {
    estimated_rent = 0;
  }

  // Fallback : règles forfaitaires par zone
  if (estimated_rent === 0) {
    const postalCode = listing.address?.match(/\((\d{5})\)/)?.[1] || "";
    let rentPerM2 = 8;
    if (postalCode.startsWith("60")) rentPerM2 = 9;
    if (postalCode.startsWith("02")) rentPerM2 = 7;
    if (postalCode.startsWith("75")) rentPerM2 = 22;
    if (
      postalCode.startsWith("92") ||
      postalCode.startsWith("93") ||
      postalCode.startsWith("94")
    )
      rentPerM2 = 18;
    estimated_rent = Math.round(listing.surface_m2 * rentPerM2);
  }

  // 4. Calculer la rentabilité brute
  const totalInvestment = listing.price_eur + estimated_works;
  const gross_yield =
    totalInvestment > 0 ? ((estimated_rent * 12) / totalInvestment) * 100 : 0;

  return { dpe, estimated_works, estimated_rent, gross_yield };
}

// ============================================================
// HISTORIQUE
// ============================================================

async function recordAnalysisHistory(newListings: any[], opportunities: any[]) {
  const totalResult = await pool.query(
    "SELECT COUNT(*)::int as total FROM listings",
  );
  const totalListings = totalResult.rows[0].total;

  const oppResult = await pool.query(`
    SELECT 
      COUNT(*)::int as total,
      AVG(price_gap_percent)::float as avg_gap,
      SUM(((dvf_avg_price_m2 - listing_price_m2) * surface_m2))::int as total_gain
    FROM listings 
    WHERE is_underpriced = TRUE
  `);
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
// ============================================================
// REQUÊTE PLU (Urbanisme)
// ============================================================

interface PluInfo {
  zone_code: string;
  zone_libelle: string;
  zone_type: string;
  commune: string;
  constructibilite: string;
  conseil_investissement: string;
}

async function getPluInfo(lat: number, lon: number): Promise<PluInfo | null> {
  if (!lat || !lon) return null;

  try {
    // Trouver la zone PLU contenant ce point
    const result = await pool.query(
      `SELECT zone_code, zone_libelle, zone_type, commune
       FROM plu_zones
       WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       LIMIT 1`,
      [lon, lat],
    );

    if (result.rows.length === 0) return null;

    const zone = result.rows[0];

    // Interprétation des zones PLU par un LLM
    const interpretation = await interpretPluZone(zone);

    return {
      zone_code: zone.zone_code,
      zone_libelle: zone.zone_libelle,
      zone_type: zone.zone_type,
      commune: zone.commune,
      constructibilite: interpretation.constructibilite,
      conseil_investissement: interpretation.conseil_investissement,
    };
  } catch (err: any) {
    console.log(`   ️  Erreur requête PLU: ${err.message}`);
    return null;
  }
}

async function interpretPluZone(zone: any): Promise<{
  constructibilite: string;
  conseil_investissement: string;
}> {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `Expert en urbanisme français. Tu interprètes les zones PLU pour des investisseurs immobiliers.
Règles :
- Réponds en 2 phrases maximum pour chaque champ.
- Sois factuel, pas de jargon.
- Utilise UNIQUEMENT le code de zone fourni.

Codes de zones PLU :
- UA, UB, UC, UD : zones urbaines (déjà construites)
- 1AU, 2AU : zones à urbaniser (constructibles sous conditions)
- A : zones agricoles (non constructibles sauf dérogation)
- N : zones naturelles (non constructibles)
- Zones avec suffixe "p" = secteur de projet`,
        },
        {
          role: "user",
          content: `Zone PLU : ${zone.zone_code} (${zone.zone_libelle || "non spécifié"})
Type : ${zone.zone_type}
Commune : ${zone.commune}

Donne-moi :
1. constructibilite : Peut-on construire ou étendre sur cette zone ? (1 phrase)
2. conseil_investissement : Quel est l'intérêt pour un investisseur ? (1 phrase)

Réponds en JSON : {"constructibilite": "...", "conseil_investissement": "..."}`,
        },
      ],
      model: "qwen/qwen3.8-27b",
      max_tokens: 150,
    });

    const content = completion.choices[0].message.content || "{}";
    // Extraire le JSON de la réponse
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return {
      constructibilite: "Zone non documentée",
      conseil_investissement: "Vérifier le PLU en mairie",
    };
  } catch {
    return {
      constructibilite: "Zone non documentée",
      conseil_investissement: "Vérifier le PLU en mairie",
    };
  }
}
// ============================================================
// ANALYSE PRINCIPALE
// ============================================================

async function detectOpportunities(sendEmail = false) {
  console.log("🔍 Analyse des opportunités immobilières...");

  const listingsResult = await pool.query(`
    SELECT id, url, price_eur, surface_m2, rooms, address, geom, photos, description, title
    FROM listings
    WHERE dvf_avg_price_m2 IS NULL
  `);

  console.log(`📋 ${listingsResult.rows.length} annonces à analyser`);

  const newOpportunities: any[] = [];

  for (const listing of listingsResult.rows) {
    console.log(`\n🏠 Analyse de : ${listing.address}`);

    // 📸 Analyser les photos si présentes
    let photoAnalysis = null;
    if (listing.photos && listing.photos.length > 0) {
      console.log(`    Analyse de ${listing.photos.length} photo(s)...`);
      photoAnalysis = await analyzePhotos(listing.photos);
      if (photoAnalysis) {
        console.log(
          `   📝 Diagnostic photos: ${photoAnalysis.substring(0, 100)}...`,
        );
      }
    }

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
        `UPDATE listings SET dvf_avg_price_m2 = 0, listing_price_m2 = $1, price_gap_percent = 0, is_underpriced = FALSE, comparable_sales_count = 0, photo_analysis = $2 WHERE id = $3`,
        [listing.price_eur / listing.surface_m2, photoAnalysis, listing.id],
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

    // Filtre : opportunité si écart entre -10% et -50%
    const isUnderpriced = priceGapPercent < -10 && priceGapPercent > -50;

    console.log(
      `   📈 Quartier: ${avgPriceM2.toFixed(0)}€/m² | 🏷️ Listing: ${listingPriceM2.toFixed(0)}€/m² | 📊 Écart: ${priceGapPercent.toFixed(1)}%`,
    );

    if (isUnderpriced) {
      console.log("   ✅ OPPORTUNITÉ DÉTECTÉE !");

      // 📊 Calcul rentabilité
      console.log("   📊 Calcul de rentabilité...");
      const profitability = await calculateProfitability(
        listing,
        listing.description,
      );
      console.log(
        `      DPE: ${profitability.dpe} | Travaux: ${profitability.estimated_works.toLocaleString("fr-FR")}€ | Loyer: ${profitability.estimated_rent}€/mois | Rentabilité: ${profitability.gross_yield.toFixed(1)}%`,
      );
      // 🏗️ Requête PLU (si coordonnées disponibles)
      let pluInfo: PluInfo | null = null;
      if (listing.lat && listing.lon) {
        console.log("   🏗️  Consultation du PLU...");
        pluInfo = await getPluInfo(Number(listing.lat), Number(listing.lon));
        if (pluInfo) {
          console.log(
            `      Zone: ${pluInfo.zone_code} (${pluInfo.zone_type}) - ${pluInfo.constructibilite}`,
          );
        }
      }
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

      const needsVerification = priceGapPercent < -40;
      const photoContext = photoAnalysis
        ? `\n\n📸 DIAGNOSTIC PHOTOS :\n${photoAnalysis}`
        : "";

      // 🎯 Prompt IA enrichi avec PLU
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `Tu es un expert immobilier qui rédige des messages WhatsApp pour des propriétaires vendeurs.
RÈGLES STRICTES :
- N'invente JAMAIS de chiffres. Utilise UNIQUEMENT les données fournies ci-dessous.
- Le prix de vente est ${listing.price_eur.toLocaleString("fr-FR")}€. Ne le modifie pas.
- Le prix au m² du quartier est ${avgPriceM2.toFixed(0)}€/m².
- Le prix au m² de l'annonce est ${listingPriceM2.toFixed(0)}€/m².
- L'écart est de ${priceGapPercent.toFixed(1)}%.
- Le potentiel de plus-value est de ${potentialGain.toLocaleString("fr-FR")}€.
- Travaux estimés : ${profitability.estimated_works.toLocaleString("fr-FR")}€.
- Loyer potentiel : ${profitability.estimated_rent}€/mois.
- Rentabilité brute : ${profitability.gross_yield.toFixed(1)}%.
- Ton direct, pro, max 6 lignes. Pas de formules de politesse.
- Si des infos PLU sont fournies, mentionne le potentiel d'extension ou de valorisation.`,
          },
          {
            role: "user",
            content: `Annonce : ${listing.address}, ${listing.rooms} pièces, ${listing.surface_m2}m².
Prix affiché : ${listing.price_eur.toLocaleString("fr-FR")}€ (${listingPriceM2.toFixed(0)}€/m²).
Prix moyen quartier (DVF) : ${avgPriceM2.toFixed(0)}€/m².
Ventes comparables récentes :
${comparableText}${photoContext}${pluContext}

Rédige un message WhatsApp au propriétaire. Dis-lui qu'il passe à côté de ${potentialGain.toLocaleString("fr-FR")}€ de valeur. Mentionne le potentiel locatif (${profitability.estimated_rent}€/mois, rentabilité ${profitability.gross_yield.toFixed(1)}%). ${pluInfo ? `Mentionne aussi le potentiel d'urbanisme (zone ${pluInfo.zone_code}).` : ""} Sois direct, pro, sans jargon. N'invente aucun chiffre.`,
          },
        ],
        model: "qwen/qwen3.8-27b",
      });

      //  Éviter les doublons d'alerte
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
          photo_analysis: photoAnalysis,
          dpe: profitability.dpe,
          estimated_works: profitability.estimated_works,
          estimated_rent: profitability.estimated_rent,
          gross_yield: profitability.gross_yield,
        });
        await pool.query("INSERT INTO email_alerts (listing_id) VALUES ($1)", [
          listing.id,
        ]);
      }
    } else {
      await pool.query(
        `UPDATE listings SET dvf_avg_price_m2 = $1, listing_price_m2 = $2, price_gap_percent = $3, is_underpriced = FALSE, comparable_sales_count = $4, photo_analysis = $5 WHERE id = $6`,
        [
          avgPriceM2,
          listingPriceM2,
          priceGapPercent,
          comparableSales.length,
          photoAnalysis,
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
