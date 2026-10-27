// web/src/app/api/alerts/send/route.ts
import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { listings } = await request.json();

    if (!listings || listings.length === 0) {
      return NextResponse.json(
        { error: "Aucune opportunité" },
        { status: 400 },
      );
    }

    // Construit le contenu de l'email
    const emailContent = listings
      .map(
        (listing: any) => `
🏠 ${listing.address}
💰 Prix: ${listing.price_eur.toLocaleString("fr-FR")} €
📐 Surface: ${listing.surface_m2} m²
 Prix au m²: ${listing.listing_price_m2.toFixed(0)} € (quartier: ${listing.dvf_avg_price_m2.toFixed(0)} €)
📉 Sous-évaluation: ${listing.price_gap_percent.toFixed(1)}%
💵 Potentiel: ${((listing.dvf_avg_price_m2 - listing.listing_price_m2) * listing.surface_m2).toLocaleString("fr-FR")} €

 Pitch IA:
${listing.ai_pitch}

🔗 Voir l'annonce: ${listing.url}

---
    `,
      )
      .join("\n");

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Immo Sniper <onboarding@resend.dev>",
      to: [process.env.EMAIL_TO || "you@example.com"],
      subject: `🎯 ${listings.length} opportunité${listings.length > 1 ? "s" : ""} immobilière${listings.length > 1 ? "s" : ""} détectée${listings.length > 1 ? "s" : ""}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #16a34a; margin-bottom: 20px;">
            🎯 ${listings.length} opportunité${listings.length > 1 ? "s" : ""} immobilière${listings.length > 1 ? "s" : ""}
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

    if (error) {
      console.error("Erreur Resend:", error);
      return NextResponse.json(
        { error: "Erreur envoi email" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Erreur API alert:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
