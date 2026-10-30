// src/components/Map.tsx
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
  is_underpriced: boolean;
  ai_pitch: string;
  comparable_sales_count: number;
  lon: number;
  lat: number;
  photo_analysis?: string;
  dpe?: string;
  estimated_works?: number;
  estimated_rent?: number;
  gross_yield?: number;
}

interface MapProps {
  listings: Listing[];
}

export default function Map({ listings }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialiser la carte
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView(
        [49.4333, 2.0833], // Centre sur l'Oise (Beauvais/Compiègne)
        10,
      );

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;

    //  Filtrer les annonces sans coordonnées GPS
    const listingsWithCoords = listings.filter(
      (l) => l.lat != null && l.lon != null && l.lat !== 0 && l.lon !== 0,
    );

    console.log(
      ` ${listingsWithCoords.length} annonce(s) avec coordonnées GPS sur ${listings.length}`,
    );

    // Supprimer les anciens marqueurs
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    // Ajouter les nouveaux marqueurs
    listingsWithCoords.forEach((listing) => {
      //  Conversion explicite (Postgres retourne DECIMAL en string)
      const lat = Number(listing.lat);
      const lon = Number(listing.lon);
      const listingPriceM2 = Number(listing.listing_price_m2) || 0;
      const dvfAvgPriceM2 = Number(listing.dvf_avg_price_m2) || 0;
      const priceGapPercent = Number(listing.price_gap_percent) || 0;
      const estimatedRent = Number(listing.estimated_rent) || 0;
      const grossYield = Number(listing.gross_yield) || 0;
      const estimatedWorks = Number(listing.estimated_works) || 0;

      const latIng = L.latLng(lat, lon);

      const color = listing.is_underpriced ? "#16a34a" : "#6b7280";
      const radius = listing.is_underpriced ? 10 : 6;

      L.circleMarker(latIng, {
        radius,
        fillColor: color,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(map);

      const tooltipContent = `
        <div style="font-size: 13px; min-width: 180px; white-space: nowrap;">
          <strong>${listing.address}</strong><br/>
          💰 ${listing.price_eur.toLocaleString("fr-FR")} €<br/>
          📐 ${listing.surface_m2} m² • ${listing.rooms} pièces<br/>
           ${priceGapPercent.toFixed(1)}% vs marché
          ${listing.is_underpriced ? '<br/><span style="color: #16a34a; font-weight: bold;">✅ Opportunité</span>' : ""}
          ${listing.is_underpriced && estimatedRent > 0 ? `<br/>🏠 Loyer: ${estimatedRent}€/mois` : ""}
          ${listing.is_underpriced && grossYield > 0 ? `<br/>📊 Rentabilité: ${grossYield.toFixed(1)}%` : ""}
          ${listing.is_underpriced && estimatedWorks > 0 ? `<br/>🔧 Travaux: ${estimatedWorks.toLocaleString("fr-FR")}€` : ""}
        </div>
      `;

      L.popup().setLatLng(latIng).setContent(tooltipContent).openOn(map);
    });

    // Ajuster le zoom pour voir tous les marqueurs
    if (listingsWithCoords.length > 0) {
      const group = L.featureGroup(
        listingsWithCoords.map((l) => L.marker([Number(l.lat), Number(l.lon)])),
      );
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }, [listings]);

  return (
    <div
      ref={mapContainerRef}
      style={{ height: "500px", width: "100%", borderRadius: "8px" }}
    />
  );
}
