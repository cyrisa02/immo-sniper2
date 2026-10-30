// src/components/ListingsMap.tsx
"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Listing {
  id: number;
  url: string;
  price_eur: number;
  surface_m2: number;
  rooms: number;
  address: string;
  dvf_avg_price_m2: number;
  listing_price_m2: number;
  price_gap_percent: number;
  is_underpriced: boolean | string | number;
  ai_pitch: string;
  comparable_sales_count: number;
  lon: number | string;
  lat: number | string;
  photo_analysis?: string;
  dpe?: string;
  estimated_works?: number;
  estimated_rent?: number;
  gross_yield?: number;
  plu_zone_code?: string;
  plu_zone_type?: string;
  plu_constructibilite?: string;
  plu_conseil?: string;
}

interface MapProps {
  listings: Listing[];
}

// Postgres peut renvoyer des nombres en string, et les booléens en "t"/"true"
const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return NaN;
  return Number(String(v).replace(",", "."));
};
const toBool = (v: unknown): boolean =>
  v === true || v === 1 || v === "1" || v === "t" || v === "true";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

export default function ListingsMap({ listings }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 1) Initialisation de la carte (une seule fois, nettoyée au démontage)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([49.4333, 2.0833], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Corrige les tuiles/marqueurs mal placés si le conteneur change de taille
    setTimeout(() => map.invalidateSize(), 200);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // 2) Mise à jour des marqueurs
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const valid = listings
      .map((l) => ({ l, lat: toNum(l.lat), lon: toNum(l.lon) }))
      .filter(
        ({ lat, lon }) =>
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat !== 0 &&
          lon !== 0,
      );
    console.log(
      `📍 ${valid.length} annonce(s) avec GPS sur ${listings.length}`,
    );
    console.log(
      ` ${valid.filter(({ l }) => toBool(l.is_underpriced)).length} opportunité(s)`,
    );

    // Les opportunités en dernier pour qu'elles soient au-dessus
    valid.sort(
      (a, b) =>
        Number(toBool(a.l.is_underpriced)) - Number(toBool(b.l.is_underpriced)),
    );

    valid.forEach(({ l: listing, lat, lon }) => {
      const underpriced = toBool(listing.is_underpriced);
      const price = toNum(listing.price_eur) || 0;
      const listingPriceM2 = toNum(listing.listing_price_m2) || 0;
      const dvfAvgPriceM2 = toNum(listing.dvf_avg_price_m2) || 0;
      const priceGapPercent = toNum(listing.price_gap_percent) || 0;
      const estimatedRent = toNum(listing.estimated_rent) || 0;
      const grossYield = toNum(listing.gross_yield) || 0;
      const estimatedWorks = toNum(listing.estimated_works) || 0;
      const quartier = dvfAvgPriceM2 > 0 ? dvfAvgPriceM2.toFixed(0) : "N/A";

      const marker = L.circleMarker(L.latLng(lat, lon), {
        radius: underpriced ? 12 : 8,
        fillColor: underpriced ? "#16a34a" : "#6b7280",
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(layer);

      const popupContent = `
        <div style="font-size: 13px; min-width: 220px; max-width: 300px;">
          <strong style="font-size: 14px; color: #1f2937;">${esc(listing.address)}</strong><br/>
          <div style="margin-top: 8px; padding: 6px; background: #f3f4f6; border-radius: 4px;">
            💰 <b>${price.toLocaleString("fr-FR")} €</b><br/>
            📐 ${esc(listing.surface_m2)} m² • ${esc(listing.rooms)} pièces
          </div>
          <div style="margin-top: 6px;">
            📊 <b>Prix annonce:</b> ${listingPriceM2.toFixed(0)} €/m²<br/>
            📈 <b>Prix quartier:</b> ${quartier} €/m²<br/>
            📉 <b style="color: ${priceGapPercent < 0 ? "#16a34a" : "#dc2626"};">${priceGapPercent.toFixed(1)}%</b> vs marché
          </div>
          ${
            underpriced
              ? `<div style="margin-top: 8px; padding: 6px; background: #dcfce7; border-radius: 4px; border-left: 3px solid #16a34a;">
                   <span style="color: #16a34a; font-weight: bold;">✅ Opportunité détectée !</span>
                 </div>`
              : ""
          }
          ${estimatedRent > 0 ? `<div style="margin-top: 4px;"> Loyer estimé: <b>${estimatedRent} €/mois</b></div>` : ""}
          ${grossYield > 0 ? `<div> Rentabilité: <b>${grossYield.toFixed(1)}%</b></div>` : ""}
          ${estimatedWorks > 0 ? `<div> Travaux: <b>${estimatedWorks.toLocaleString("fr-FR")} €</b></div>` : ""}
          ${listing.dpe && listing.dpe !== "inconnu" ? `<div>️ DPE: <b>${esc(listing.dpe)}</b></div>` : ""}
          ${
            listing.plu_zone_code
              ? `<div style="margin-top: 6px; padding: 4px; background: #fef3c7; border-radius: 4px;">
                   🏗️ Zone PLU: <b>${esc(listing.plu_zone_code)}</b> (${esc(listing.plu_zone_type)})<br/>
                   <i style="font-size: 11px;">${esc(listing.plu_constructibilite)}</i>
                 </div>`
              : ""
          }
          <div style="margin-top: 8px; text-align: center;">
            <a href="${esc(listing.url)}" target="_blank" rel="noopener noreferrer"
               style="display: inline-block; padding: 6px 12px; background: #2563eb; color: white; text-decoration: none; border-radius: 4px; font-weight: 500;">
               🔗 Voir l'annonce
            </a>
          </div>
        </div>
      `;
      marker.bindPopup(popupContent, { maxWidth: 320 });
      marker.bindTooltip(
        `<b style="${underpriced ? "color:#16a34a;" : ""}">${underpriced ? "✅ " : ""}${esc(listing.address)}</b><br/>
         💰 ${price.toLocaleString("fr-FR")} €<br/>
         📊 ${listingPriceM2.toFixed(0)} €/m² (quartier: ${quartier} €/m²)` +
          (underpriced
            ? `<br/>📉 <b style="color:#16a34a;">${priceGapPercent.toFixed(1)}%</b>`
            : ""),
        { direction: "top", offset: [0, -10], sticky: true },
      );
      if (underpriced) marker.bringToFront();
    });

    // Ajuster le zoom sur tous les points
    if (valid.length > 0) {
      const bounds = L.latLngBounds(valid.map(({ lat, lon }) => [lat, lon]));
      map.invalidateSize();
      map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
    }
  }, [listings]);

  return (
    <div
      ref={containerRef}
      style={{ height: "500px", width: "100%", borderRadius: "8px" }}
    />
  );
}
