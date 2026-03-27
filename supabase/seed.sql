-- =============================================================
-- SEED DATA — development / testing only
-- =============================================================

-- POWR Test Gym — used for geofence testing on-device
-- Located: 52.124353, -1.764163 (Poplar Dr area)
-- Radius: 2m (tight test radius — overridden by DEV_RADIUS_M in GeofenceContext)
insert into public.partners (name, category, locations, active)
values (
  'POWR Test Gym',
  'gym',
  '[{"lat": 52.124353, "lng": -1.764163, "radius": 2, "name": "Test Location"}]'::jsonb,
  true
);
