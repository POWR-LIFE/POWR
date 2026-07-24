-- Discovery RPC performance: nearby_partners/nearest_partners full-scanned all
-- ~7.8k partners and unnested locations jsonb per row on EVERY call (~368ms
-- measured for a central-London box). The Discover map now fetches per panned
-- viewport, multiplying that cost. Fix: a flat, trigger-synced
-- partner_locations table with a (lat, lng) btree; the RPCs are rewritten on
-- top of it with UNCHANGED signatures/return shapes, so all deployed app
-- versions speed up with no client change.

-- 1. Flat location table — one row per (partner, location index).
CREATE TABLE IF NOT EXISTS public.partner_locations (
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  loc_idx    integer NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  PRIMARY KEY (partner_id, loc_idx)
);

CREATE INDEX IF NOT EXISTS partner_locations_lat_lng_idx
  ON public.partner_locations (lat, lng);

-- Same read surface as partners.locations (public geo data, read-only to clients).
ALTER TABLE public.partner_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_locations_read_all ON public.partner_locations;
CREATE POLICY partner_locations_read_all ON public.partner_locations
  FOR SELECT USING (true);
GRANT SELECT ON public.partner_locations TO anon, authenticated;

-- 2. Sync trigger: rebuild a partner's flat rows whenever its locations/active
-- change. SECURITY DEFINER (house pattern) so admin edits through RLS'd roles
-- can maintain the table without client write grants. Only ACTIVE partners are
-- materialized — the RPCs filter on active anyway.
CREATE OR REPLACE FUNCTION public.sync_partner_locations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.partner_locations WHERE partner_id = NEW.id;
  IF NEW.active
     AND NEW.locations IS NOT NULL
     AND jsonb_typeof(NEW.locations) = 'array' THEN
    INSERT INTO public.partner_locations (partner_id, loc_idx, lat, lng)
    SELECT NEW.id, t.ord - 1, (t.loc->>'lat')::float8, (t.loc->>'lng')::float8
    FROM jsonb_array_elements(NEW.locations) WITH ORDINALITY AS t(loc, ord)
    WHERE t.loc->>'lat' IS NOT NULL
      AND t.loc->>'lng' IS NOT NULL
    ON CONFLICT (partner_id, loc_idx) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_sync_locations ON public.partners;
CREATE TRIGGER partners_sync_locations
  AFTER INSERT OR UPDATE OF locations, active ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.sync_partner_locations();

-- 3. Backfill from current data.
DELETE FROM public.partner_locations;
INSERT INTO public.partner_locations (partner_id, loc_idx, lat, lng)
SELECT p.id, t.ord - 1, (t.loc->>'lat')::float8, (t.loc->>'lng')::float8
FROM public.partners p,
     jsonb_array_elements(p.locations) WITH ORDINALITY AS t(loc, ord)
WHERE p.active
  AND jsonb_typeof(p.locations) = 'array'
  AND t.loc->>'lat' IS NOT NULL
  AND t.loc->>'lng' IS NOT NULL
ON CONFLICT (partner_id, loc_idx) DO NOTHING;

-- 4. Same-signature rewrites over the flat table. Distance = the equirectangular
-- metres formula the old bodies used; ordering semantics unchanged for
-- single-location partners (all current rows). Box hits now also bound the
-- distance used for ordering (old body ordered by min over ALL locations).
CREATE OR REPLACE FUNCTION public.nearby_partners(
  user_lat   double precision,
  user_lng   double precision,
  radius_deg double precision DEFAULT 0.15
)
RETURNS TABLE(
  id            uuid,
  name          text,
  description   text,
  category      text,
  address       text,
  locations     jsonb,
  logo_url      text,
  logo_bg       text,
  image1_url    text,
  image2_url    text,
  opening_hours jsonb
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    p.id, p.name, p.description, p.category, p.address,
    p.locations, p.logo_url, p.logo_bg, p.image1_url, p.image2_url,
    p.opening_hours
  FROM (
    SELECT pl.partner_id,
           min(111320.0 * sqrt(
             power(pl.lat - user_lat, 2) +
             power((pl.lng - user_lng) * cos(radians(user_lat)), 2)
           )) AS dist
    FROM public.partner_locations pl
    WHERE pl.lat BETWEEN user_lat - radius_deg AND user_lat + radius_deg
      AND pl.lng BETWEEN user_lng - radius_deg AND user_lng + radius_deg
    GROUP BY pl.partner_id
  ) hit
  JOIN public.partners p ON p.id = hit.partner_id AND p.active
  ORDER BY hit.dist ASC;
$$;

CREATE OR REPLACE FUNCTION public.nearest_partners(
  user_lat    double precision,
  user_lng    double precision,
  max_results integer DEFAULT 20
)
RETURNS TABLE(
  id            uuid,
  name          text,
  description   text,
  category      text,
  address       text,
  locations     jsonb,
  logo_url      text,
  logo_bg       text,
  image1_url    text,
  image2_url    text,
  opening_hours jsonb
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    p.id, p.name, p.description, p.category, p.address,
    p.locations, p.logo_url, p.logo_bg, p.image1_url, p.image2_url,
    p.opening_hours
  FROM (
    SELECT pl.partner_id,
           min(111320.0 * sqrt(
             power(pl.lat - user_lat, 2) +
             power((pl.lng - user_lng) * cos(radians(user_lat)), 2)
           )) AS dist
    FROM public.partner_locations pl
    GROUP BY pl.partner_id
  ) hit
  JOIN public.partners p ON p.id = hit.partner_id AND p.active
  ORDER BY hit.dist ASC
  LIMIT greatest(1, least(max_results, 100));
$$;
