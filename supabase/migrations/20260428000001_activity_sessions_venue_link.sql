-- =============================================================
-- ACTIVITY SESSIONS → PARTNER VENUE LINK
-- =============================================================
-- Adds nullable references from each activity session to the partner
-- (and specific partner location) where the activity took place.
-- Populated by geofence detection at check-in time. Until that lands,
-- both fields stay null and the share card falls back to a generic label.

alter table public.activity_sessions
  add column partner_id            uuid references public.partners(id) on delete set null,
  add column partner_location_idx  smallint;

create index activity_sessions_partner_id_idx
  on public.activity_sessions (partner_id)
  where partner_id is not null;
