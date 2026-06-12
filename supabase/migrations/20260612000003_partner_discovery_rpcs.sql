-- Discovery RPC improvements:
-- 1. nearby_partners: add address + logo_bg (the nearby list rendered a wrong
--    logo background and empty address vs search results), and ORDER BY true
--    min-distance so callers get a stable nearest-first row order.
-- 2. nearest_partners: nearest-N regardless of distance — fallback so a user
--    outside any partner's bounding box still sees their closest partners
--    instead of an empty Discover screen.

-- Return type changes require DROP (CREATE OR REPLACE can't alter OUT columns).
DROP FUNCTION IF EXISTS public.nearby_partners(double precision, double precision, double precision);

CREATE FUNCTION public.nearby_partners(
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
  FROM public.partners p
  WHERE p.active = true
    AND p.locations IS NOT NULL
    AND jsonb_typeof(p.locations) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.locations) AS loc
      WHERE (loc->>'lat')::float BETWEEN user_lat - radius_deg AND user_lat + radius_deg
        AND (loc->>'lng')::float BETWEEN user_lng - radius_deg AND user_lng + radius_deg
    )
  -- Equirectangular metres — exact enough for ordering at city scale.
  ORDER BY (
    SELECT min(
      111320.0 * sqrt(
        power((loc->>'lat')::float8 - user_lat, 2) +
        power(((loc->>'lng')::float8 - user_lng) * cos(radians(user_lat)), 2)
      )
    )
    FROM jsonb_array_elements(p.locations) AS loc
    WHERE loc->>'lat' IS NOT NULL AND loc->>'lng' IS NOT NULL
  ) ASC NULLS LAST;
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
  FROM public.partners p
  WHERE p.active = true
    AND p.locations IS NOT NULL
    AND jsonb_typeof(p.locations) = 'array'
  ORDER BY (
    SELECT min(
      111320.0 * sqrt(
        power((loc->>'lat')::float8 - user_lat, 2) +
        power(((loc->>'lng')::float8 - user_lng) * cos(radians(user_lat)), 2)
      )
    )
    FROM jsonb_array_elements(p.locations) AS loc
    WHERE loc->>'lat' IS NOT NULL AND loc->>'lng' IS NOT NULL
  ) ASC NULLS LAST
  LIMIT greatest(1, least(max_results, 100));
$$;
