// web/src/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const ListingsMap = dynamic(() => import("@/components/Map"), { ssr: false });

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
  plu_zone_code?: string;
  plu_zone_type?: string;
  plu_constructibilite?: string;
  plu_conseil?: string;
}

interface HistoryEntry {
  analyzed_at: string;
  total_listings: number;
  opportunities_found: number;
  avg_price_gap: number;
  total_potential_gain: number;
}

interface Stats {
  total_analyses: number;
  total_opportunities: number;
  total_gain: number;
  avg_gap: number;
}

interface Filters {
  city: string;
  minPrice: string;
  maxPrice: string;
  minSurface: string;
  onlyOpportunities: boolean;
}

export default function Dashboard() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<Filters>({
    city: "",
    minPrice: "",
    maxPrice: "",
    minSurface: "",
    onlyOpportunities: false,
  });
  const [lastAnalysis, setLastAnalysis] = useState<{
    analyzed: number;
    opportunities: number;
  } | null>(null);

  const fetchListings = () => {
    fetch("/api/listings")
      .then((res) => res.json())
      .then((data) => {
        setListings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const fetchHistory = () => {
    fetch("/api/history")
      .then((res) => res.json())
      .then((data) => {
        setHistory(data.history || []);
        setStats(data.stats || null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchListings();
    fetchHistory();
  }, []);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLastAnalysis({
          analyzed: data.analyzed,
          opportunities: data.opportunities,
        });
        fetchListings();
        fetchHistory();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredListings = listings.filter((l) => {
    if (
      filters.city &&
      !l.address.toLowerCase().includes(filters.city.toLowerCase())
    )
      return false;
    if (filters.minPrice && l.price_eur < parseInt(filters.minPrice))
      return false;
    if (filters.maxPrice && l.price_eur > parseInt(filters.maxPrice))
      return false;
    if (filters.minSurface && l.surface_m2 < parseInt(filters.minSurface))
      return false;
    if (filters.onlyOpportunities && !l.is_underpriced) return false;
    return true;
  });

  const opportunities = filteredListings.filter((l) => l.is_underpriced);
  const regular = filteredListings.filter((l) => !l.is_underpriced);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xl text-gray-600">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Immo Sniper - Dashboard
            </h1>
            <p className="text-gray-600">
              {listings.length} annonces analysées •{" "}
              {listings.filter((l) => l.is_underpriced).length} opportunités
              détectées
            </p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="bg-green-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {analyzing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Analyse en cours...
              </>
            ) : (
              <>🔄 Relancer l'analyse</>
            )}
          </button>
        </div>

        {/* Notification dernière analyse */}
        {lastAnalysis && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex justify-between items-center">
            <div>
              <span className="font-semibold text-green-800">
                Analyse terminée
              </span>
              <span className="text-green-700 ml-2">
                {lastAnalysis.analyzed} annonce(s) analysée(s) •{" "}
                {lastAnalysis.opportunities} opportunité(s) trouvée(s)
              </span>
            </div>
            <button
              onClick={() => setLastAnalysis(null)}
              className="text-green-600 hover:text-green-800"
            >
              ✕
            </button>
          </div>
        )}

        {/* Statistiques globales */}
        {stats && stats.total_analyses > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-200">
              <div className="text-xs text-gray-500 uppercase font-medium">
                Analyses
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {stats.total_analyses}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-200">
              <div className="text-xs text-gray-500 uppercase font-medium">
                Opportunités
              </div>
              <div className="text-2xl font-bold text-green-600 mt-1">
                {stats.total_opportunities}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-200">
              <div className="text-xs text-gray-500 uppercase font-medium">
                Gain potentiel cumulé
              </div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {stats.total_gain.toLocaleString("fr-FR")} €
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-200">
              <div className="text-xs text-gray-500 uppercase font-medium">
                Écart moyen
              </div>
              <div className="text-2xl font-bold text-orange-600 mt-1">
                {stats.avg_gap.toFixed(1)}%
              </div>
            </div>
          </div>
        )}

        {/* Historique */}
        {history.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-200 mb-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              Historique des analyses
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">
                      Date
                    </th>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">
                      Annonces
                    </th>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">
                      Opportunités
                    </th>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">
                      Écart moy.
                    </th>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">
                      Gain potentiel
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 px-3">
                        {new Date(h.analyzed_at).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 px-3">{h.total_listings}</td>
                      <td className="py-2 px-3 font-semibold text-green-600">
                        {h.opportunities_found}
                      </td>
                      <td className="py-2 px-3">
                        {parseFloat(String(h.avg_price_gap)).toFixed(1)}%
                      </td>
                      <td className="py-2 px-3 font-semibold text-blue-600">
                        {h.total_potential_gain.toLocaleString("fr-FR")} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Barre de filtres */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Ville
              </label>
              <input
                type="text"
                placeholder="Beauvais, Compiègne..."
                value={filters.city}
                onChange={(e) =>
                  setFilters({ ...filters, city: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Prix min (€)
              </label>
              <input
                type="number"
                placeholder="0"
                value={filters.minPrice}
                onChange={(e) =>
                  setFilters({ ...filters, minPrice: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Prix max (€)
              </label>
              <input
                type="number"
                placeholder=""
                value={filters.maxPrice}
                onChange={(e) =>
                  setFilters({ ...filters, maxPrice: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Surface min (m²)
              </label>
              <input
                type="number"
                placeholder="0"
                value={filters.minSurface}
                onChange={(e) =>
                  setFilters({ ...filters, minSurface: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                id="onlyOpp"
                checked={filters.onlyOpportunities}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    onlyOpportunities: e.target.checked,
                  })
                }
                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
              />
              <label
                htmlFor="onlyOpp"
                className="text-sm text-gray-700 font-medium"
              >
                Opportunités uniquement
              </label>
            </div>
            <button
              onClick={() =>
                setFilters({
                  city: "",
                  minPrice: "",
                  maxPrice: "",
                  minSurface: "",
                  onlyOpportunities: false,
                })
              }
              className="text-sm text-gray-500 hover:text-gray-700 pb-2"
            >
              Réinitialiser
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {filteredListings.length} résultat(s) affiché(s) sur{" "}
            {listings.length}
          </div>
        </div>

        {/* Carte */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-8">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">
            Carte des opportunités
          </h2>
          <ListingsMap listings={filteredListings} />
        </div>

        {/* Opportunités */}
        {opportunities.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-green-700 mb-4">
              Opportunités sous-évaluées ({opportunities.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {opportunities.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        )}

        {/* Autres annonces */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-700 mb-4">
            Autres annonces ({regular.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regular.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  const [copied, setCopied] = useState(false);

  const copyPitch = () => {
    if (listing.ai_pitch) {
      navigator.clipboard.writeText(listing.ai_pitch);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  //  Conversion explicite (Postgres retourne DECIMAL/NUMERIC en string)
  const listingPriceM2 = Number(listing.listing_price_m2) || 0;
  const dvfAvgPriceM2 = Number(listing.dvf_avg_price_m2) || 0;
  const priceGapPercent = Number(listing.price_gap_percent) || 0;
  const estimatedWorks = Number(listing.estimated_works) || 0;
  const estimatedRent = Number(listing.estimated_rent) || 0;
  const grossYield = Number(listing.gross_yield) || 0;

  return (
    <div
      className={`bg-white rounded-lg shadow-md p-6 border-l-4 ${
        listing.is_underpriced ? "border-green-500" : "border-gray-300"
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">
            {listing.address}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {listing.rooms} pièces • {listing.surface_m2} m²
          </p>
        </div>
        <span
          className={`text-xs font-bold px-2 py-1 rounded ${
            listing.is_underpriced
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {priceGapPercent > 0 ? "+" : ""}
          {priceGapPercent.toFixed(1)}%
        </span>
      </div>

      <div className="mb-4">
        <div className="text-2xl font-bold text-gray-900">
          {listing.price_eur.toLocaleString("fr-FR")} €
        </div>
        <div className="text-sm text-gray-600">
          {listingPriceM2 > 0
            ? `${listingPriceM2.toFixed(0)} €/m²`
            : "Non analysé"}
          {dvfAvgPriceM2 > 0 && (
            <span className="text-gray-400">
              {" "}
              (quartier: {dvfAvgPriceM2.toFixed(0)} €/m²)
            </span>
          )}
        </div>
      </div>

      {/*  Bloc rentabilité (uniquement pour les opportunités analysées) */}
      {listing.is_underpriced && listingPriceM2 > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
          <div className="bg-orange-50 p-2 rounded">
            <div className="text-orange-600 font-medium">Travaux</div>
            <div className="font-bold">
              {estimatedWorks.toLocaleString("fr-FR")} €
            </div>
          </div>
          <div className="bg-blue-50 p-2 rounded">
            <div className="text-blue-600 font-medium">Loyer</div>
            <div className="font-bold">{estimatedRent} €/mois</div>
          </div>
          <div className="bg-green-50 p-2 rounded">
            <div className="text-green-600 font-medium">Rentabilité</div>
            <div className="font-bold">{grossYield.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/*  Diagnostic photos */}
      {listing.photo_analysis && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">
            Diagnostic photos
          </div>
          <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
            {listing.photo_analysis}
          </p>
        </div>
      )}

      {/*  Pitch IA */}
      {listing.ai_pitch && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">
            Pitch IA ({listing.comparable_sales_count} ventes comparables)
          </div>
          <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
            {listing.ai_pitch}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 transition"
        >
          Voir l'annonce
        </a>
        {listing.ai_pitch && (
          <button
            onClick={copyPitch}
            className="text-sm bg-gray-600 text-white px-3 py-2 rounded hover:bg-gray-700 transition"
          >
            {copied ? "✓ Copié" : "Copier"}
          </button>
        )}
      </div>
    </div>
  );
}
