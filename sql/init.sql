-- sql/init.sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE listings (
    id SERIAL PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    raw_text TEXT,
    price_eur INT,
    surface_m2 FLOAT,
    rooms INT,
    address TEXT,
    geom GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE dvf_sales (
    id SERIAL PRIMARY KEY,
    mutation_date DATE,
    price_eur INT,
    surface_m2 FLOAT,
    address TEXT,
    geom GEOGRAPHY(POINT, 4326)
);

-- Index spatial pour accélérer les recherches par rayon (Étape 5)
CREATE INDEX idx_listings_geom ON listings USING GIST (geom);
CREATE INDEX idx_dvf_geom ON dvf_sales USING GIST (geom);