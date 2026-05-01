-- ==========================================================================
-- GEE Carbon Stock Column
-- Adds two IMMUTABLE helper functions and a stored generated column
-- `gee_carbon` (tCO₂) computed from gee_age + grow_area.
--
-- Formula mirrors next/lib/map-utils.ts → carbonForAge():
--   H   = LEAST(2.0 + 1.8 * age, 28)          -- height (m)
--   D   = LEAST(3.0 + 4.5 * age, 60)           -- DBH (cm)
--   AGB = 0.1284 * D² * H * 0.001              -- above-ground biomass (t/tree)
--   BGB = AGB * 0.26                            -- below-ground biomass
--   co2 = (AGB + BGB) * 0.47 * 3.67 * trees    -- tCO₂ total
--
-- Tree count = area_rai × 80  (standard Thai rubber plantation density)
-- grow_area format: "R-N-W"  (rai-ngan-wah), e.g. "6-1-0"
-- ==========================================================================

-- ── 1. Area parser: "R-N-W" text → decimal rai ───────────────────────────
CREATE OR REPLACE FUNCTION parse_area_rai(area_text TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN area_text IS NULL OR trim(area_text) = '' THEN 0
    WHEN trim(area_text) ~ '^\d+-\d+-\d+' THEN
        split_part(trim(area_text), '-', 1)::NUMERIC
      + split_part(trim(area_text), '-', 2)::NUMERIC * 0.25
      + split_part(trim(area_text), '-', 3)::NUMERIC / 400.0
    ELSE COALESCE(NULLIF(trim(area_text), '')::NUMERIC, 0)
  END
$$;

-- ── 2. Carbon calculator: (age, grow_area) → tCO₂ ────────────────────────
CREATE OR REPLACE FUNCTION carbon_for_gee_age(age INTEGER, area_text TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN age IS NULL OR age <= 0 THEN NULL
    ELSE ROUND(
        0.1284
      * POWER(LEAST(3.0 + 4.5::NUMERIC * age, 60), 2)   -- D²
      * LEAST(2.0 + 1.8::NUMERIC * age, 28)              -- H
      * 0.001                                             -- → tonnes/tree
      * 1.26                                              -- × (1 + BGB 0.26)
      * 0.47                                              -- carbon fraction
      * 3.67                                              -- CO₂/C ratio
      * GREATEST(parse_area_rai(area_text) * 80, 0)       -- trees (80/rai)
    , 2)
  END
$$;

-- ── 3. Add generated column to rubber_plots ───────────────────────────────
ALTER TABLE rubber_plots
  ADD COLUMN IF NOT EXISTS gee_carbon NUMERIC
  GENERATED ALWAYS AS (carbon_for_gee_age(gee_age, grow_area)) STORED;

-- ── 4. Index for range queries on carbon stock ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rubber_plots_gee_carbon ON rubber_plots (gee_carbon);
