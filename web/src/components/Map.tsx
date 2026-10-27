// web/src/components/Map.tsx
"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface ComparableSale {
  price_eur: number;
  surface_m2: number;
  address: string;
  mutation_date: string;
  lon: number;
  lat: number;
}

interface Listing {
  id: number;
  address: string;
  price_eur: number;
  surface_m2: number;
  price_gap_percent: number;
  is_underpriced: boolean;
  lon: number;
  lat: number;
  listing_price_m2?: number;
  dvf_avg_price_m2?: number;
  comparable_sales?: ComparableSale[];
}

interface MapProps {
  listings: Listing[];
}

export default function Map({ listings }: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    if (!mapRef.current) return;

    // Nettoyer l'ancienne instance
    if (mapInstance.current) {
      try {
        mapInstance.current.remove();
      } catch (e) {
        // Ignore les erreurs de cleanup
      }
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current).setView([49.431, 2.089], 12);
    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    if (listings.length === 0) return;

    const bounds = L.latLngBounds([]);

    listings.forEach((listing) => {
      const color = listing.is_underpriced ? "#22c55e" : "#9ca3af";
      const radius = listing.is_underpriced ? 14 : 10;

      const marker = L.circleMarker([listing.lat, listing.lon], {
        radius,
        fillColor: color,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(map);

      const tooltipContent = `
        <div style="font-size: 13px; min-width: 180px; white-space: nowrap;">
          <strong style="color: ${listing.is_underpriced ? "#22c55e" : "#6b7280"};">
            ${listing.is_underpriced ? " OPPORTUNITÉ" : "⚪ Annonce"}
          </strong><br/>
          <strong>${listing.address}</strong><br/>
           ${listing.price_eur.toLocaleString("fr-FR")} €<br/>
          📐 ${listing.surface_m2} m²<br/>
           ${listing.listing_price_m2?.toFixed(0) || 0} €/m²
          ${listing.is_underpriced ? `<br/><span style="color: #22c55e; font-weight: 600;">${listing.price_gap_percent.toFixed(1)}% sous le marché</span>` : ""}
        </div>
      `;

      marker.bindTooltip(tooltipContent, {
        permanent: false,
        direction: "top",
        offset: [0, -10],
      });

      marker.bindPopup(`
        <div style="min-width: 220px;">
          <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">
            ${listing.address}
          </h3>
          <p style="margin: 4px 0; font-size: 13px;">
            <strong>${listing.price_eur.toLocaleString("fr-FR")} €</strong> • ${listing.surface_m2} m²
          </p>
          <p style="margin: 4px 0; font-size: 12px;">
            Prix au m²: <strong>${listing.listing_price_m2?.toFixed(0) || 0} €</strong>
            ${listing.dvf_avg_price_m2 ? `(marché: ${listing.dvf_avg_price_m2.toFixed(0)} €)` : ""}
          </p>
          <p style="margin: 4px 0; font-size: 12px; color: ${listing.is_underpriced ? "#22c55e" : "#6b7280"}; font-weight: 600;">
            ${listing.price_gap_percent > 0 ? "+" : ""}${listing.price_gap_percent.toFixed(1)}% vs marché
          </p>
        </div>
      `);

      bounds.extend([listing.lat, listing.lon]);

      if (listing.is_underpriced) {
        L.circle([listing.lat, listing.lon], {
          radius: 500,
          color: "#22c55e",
          fillColor: "#22c55e",
          fillOpacity: 0.05,
          weight: 1,
          dashArray: "4",
        }).addTo(map);

        if (listing.comparable_sales && listing.comparable_sales.length > 0) {
          listing.comparable_sales.forEach((sale) => {
            const salePriceM2 = (sale.price_eur / sale.surface_m2).toFixed(0);

            const saleMarker = L.circleMarker([sale.lat, sale.lon], {
              radius: 5,
              fillColor: "#3b82f6",
              color: "#fff",
              weight: 1,
              opacity: 1,
              fillOpacity: 0.7,
            }).addTo(map);

            saleMarker.bindTooltip(
              `<div style="font-size: 12px; white-space: nowrap;">
                <strong style="color: #3b82f6;">Vente notaire</strong><br/>
                ${sale.price_eur.toLocaleString("fr-FR")} € | ${sale.surface_m2} m²<br/>
                <strong>${salePriceM2} €/m²</strong>
              </div>`,
              { permanent: false, direction: "top", offset: [0, -5] },
            );

            saleMarker.bindPopup(`
              <div style="font-size: 12px;">
                <strong style="color: #3b82f6;">Vente DVF (Notaire)</strong><br/>
                ${sale.address}<br/>
                ${sale.price_eur.toLocaleString("fr-FR")} € | ${sale.surface_m2} m²<br/>
                <strong>${salePriceM2} €/m²</strong><br/>
                <em>Vendu le ${new Date(sale.mutation_date).toLocaleDateString("fr-FR")}</em>
              </div>
            `);

            bounds.extend([sale.lat, sale.lon]);
          });
        }
      }
    });

    if (listings.length > 0 && isMounted.current) {
      try {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      } catch (e) {
        // Ignore si la carte est déjà détruite
      }
    }

    return () => {
      isMounted.current = false;
      if (mapInstance.current) {
        try {
          mapInstance.current.remove();
        } catch (e) {
          // Ignore les erreurs de cleanup
        }
        mapInstance.current = null;
      }
    };
  }, [listings]);

  return (
    <div
      ref={mapRef}
      style={{ height: "500px", width: "100%", borderRadius: "8px" }}
    />
  );
}
