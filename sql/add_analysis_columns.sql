-- sql/add_analysis_columns.sql
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS dvf_avg_price_m2 FLOAT,
ADD COLUMN IF NOT EXISTS listing_price_m2 FLOAT,
ADD COLUMN IF NOT EXISTS price_gap_percent FLOAT,
ADD COLUMN IF NOT EXISTS is_underpriced BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_pitch TEXT,
ADD COLUMN IF NOT EXISTS comparable_sales_count INT;