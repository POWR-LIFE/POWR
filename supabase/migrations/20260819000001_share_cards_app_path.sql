-- Where a human who taps a share card's link preview should land, as a path
-- under powr.life. Until now every card bounced to /app?ref=<code>; a prize
-- card wants the EVENT it belongs to (/app?to=league&event=<slug>&ref=<code>).
--
-- Members insert their own rows, so the column is constrained to the /app
-- smart-link: share-card-og serves whatever is stored as a redirect, and an
-- unconstrained path would make every card an open redirect off powr.life.
-- The function re-checks the same shape before using it.
alter table public.share_cards
  add column app_path text
  constraint share_cards_app_path_is_app_link
    check (app_path is null or app_path ~ '^/app(\?[A-Za-z0-9%._~&=-]*)?$');

comment on column public.share_cards.app_path is
  'Optional powr.life path the /s/<id> page redirects humans to (must be the /app smart-link, e.g. /app?to=league&event=<slug>&ref=<code>). Null = /app?ref=<referral_code>.';
