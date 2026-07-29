-- Promo page fields for live events (shareable powr.life/promo/<slug>).
-- Media is a background video OR image; the page infers which from the
-- file extension. Headline is optional marketing copy — the page falls
-- back to the event name + window when blank.
alter table public.live_events
  add column if not exists promo_media_url text,
  add column if not exists promo_headline text;
