-- ============================================================
-- Immo Sniper - Schéma complet de la base de données
-- À exécuter sur une base PostGIS fraîche
-- ============================================================

-- Extension PostGIS (géolocalisation)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- TABLE : listings (annonces immobilières)
-- ============================================================
CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  source TEXT,                          -- 'seloger', 'leboncoin', etc.
  title TEXT,
  price_eur INTEGER,
  surface_m2 NUMERIC,
  rooms INTEGER,
  address TEXT,
  description TEXT,
  photos TEXT[],                        -- URLs des photos
  photo_analysis TEXT,                  -- Analyse IA des photos
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  geom GEOMETRY(POINT, 4326),           -- Géométrie PostGIS
  
  -- Analyse DVF (valeurs foncières)
  dvf_avg_price_m2 NUMERIC,             -- Prix moyen quartier (DVF)
  listing_price_m2 NUMERIC,             -- Prix au m² de l'annonce
  price_gap_percent NUMERIC,            -- Écart en %
  is_underpriced BOOLEAN DEFAULT FALSE,
  ai_pitch TEXT,                        -- Message IA pour le propriétaire
  comparable_sales_count INTEGER DEFAULT 0,
  
  -- Rentabilité & travaux
  dpe TEXT,                             -- DPE extrait (A-G)
  estimated_works INTEGER,              -- Budget travaux estimé (€)
  estimated_rent INTEGER,               -- Loyer mensuel estimé (€)
  gross_yield NUMERIC,                  -- Rentabilité brute (%)
  
  -- Urbanisme (PLU)
  plu_zone_code TEXT,                   -- Code zone PLU (UA, UB, 1AU...)
  plu_zone_type TEXT,                   -- Type (urbaine, agricole...)
  plu_constructibilite TEXT,            -- Règles de constructibilité
  plu_conseil TEXT,                     -- Conseil investissement
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_url ON listings (url);
CREATE INDEX IF NOT EXISTS idx_listings_is_underpriced ON listings (is_underpriced);
CREATE INDEX IF NOT EXISTS idx_listings_geom ON listings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_listings_source ON listings (source);

-- ============================================================
-- TABLE : dvf_sales (ventes foncières DVF)
-- ============================================================
CREATE TABLE IF NOT EXISTS dvf_sales (
  id SERIAL PRIMARY KEY,
  mutation_date DATE,
  price_eur INTEGER,
  surface_m2 NUMERIC,
  address TEXT,
  city TEXT,
  postal_code VARCHAR(5),
  property_type TEXT,                   -- 'Appartement', 'Maison', etc.
  rooms INTEGER,
  geom GEOMETRY(POINT, 4326),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dvf_sales_geom ON dvf_sales USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_dvf_sales_postal_code ON dvf_sales (postal_code);
CREATE INDEX IF NOT EXISTS idx_dvf_sales_mutation_date ON dvf_sales (mutation_date DESC);

-- ============================================================
-- TABLE : email_alerts (historique des alertes envoyées)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_alerts (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  channel TEXT DEFAULT 'email',         -- 'email', 'telegram'
  UNIQUE(listing_id, DATE(sent_at))     -- Une alerte max par jour par annonce
);

CREATE INDEX IF NOT EXISTS idx_email_alerts_listing_id ON email_alerts (listing_id);
CREATE INDEX IF NOT EXISTS idx_email_alerts_sent_at ON email_alerts (sent_at DESC);

-- ============================================================
-- TABLE : analysis_history (historique des analyses)
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_history (
  id SERIAL PRIMARY KEY,
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  total_listings INTEGER DEFAULT 0,
  opportunities_found INTEGER DEFAULT 0,
  avg_price_gap NUMERIC DEFAULT 0,
  total_potential_gain INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_analysis_history_analyzed_at ON analysis_history (analyzed_at DESC);

-- ============================================================
-- TABLE : plu_zones (zones PLU par commune)
-- ============================================================
CREATE TABLE IF NOT EXISTS plu_zones (
  id SERIAL PRIMARY KEY,
  insee_code VARCHAR(5) NOT NULL,
  commune VARCHAR(100) NOT NULL,
  zone_code VARCHAR(20) NOT NULL,       -- UA, UB, 1AU, A, N...
  zone_libelle TEXT,
  zone_type VARCHAR(50),                -- urbaine, agricole, naturelle...
  geom GEOMETRY(POLYGON, 4326)
);

CREATE INDEX IF NOT EXISTS idx_plu_zones_geom ON plu_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_plu_zones_insee ON plu_zones (insee_code);
CREATE INDEX IF NOT EXISTS idx_plu_zones_code ON plu_zones (zone_code);

-- ============================================================
-- TABLE : plu_rules (règles métier par type de zone)
-- ============================================================
CREATE TABLE IF NOT EXISTS plu_rules (
  id SERIAL PRIMARY KEY,
  zone_code VARCHAR(20) UNIQUE NOT NULL,
  zone_type VARCHAR(50),
  constructibilite TEXT,                -- "Extensions possibles sous conditions"
  conseil_investissement TEXT           -- "Bon potentiel familial"
);

-- ============================================================
-- TABLE : scrape_jobs (suivi des jobs de scraping)
-- ============================================================
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,                 -- 'leboncoin', 'seloger'
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  urls_processed INTEGER DEFAULT 0,
  urls_success INTEGER DEFAULT 0,
  urls_failed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running'         -- 'running', 'success', 'failed'
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs (status);

-- ============================================================
-- VUE : listings_with_plu (jointure listings + PLU)
-- ============================================================
CREATE OR REPLACE VIEW listings_with_plu AS
SELECT 
  l.*,
  p.zone_code AS plu_zone,
  p.zone_type AS plu_type,
  p.commune AS plu_commune
FROM listings l
LEFT JOIN LATERAL (
  SELECT zone_code, zone_type, commune
  FROM plu_zones
  WHERE ST_Contains(geom, l.geom)
  LIMIT 1
) p ON true;

-- ============================================================
-- FONCTION : mise à jour automatique de updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER listings_updated_at
BEFORE UPDATE ON listings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();