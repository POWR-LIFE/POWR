-- A landscape copy of a share card for the link preview.
--
-- WhatsApp (and iMessage, Telegram…) draw a wide og:image large across the
-- message and a tall one as a small thumbnail beside the text. Cards are tall
-- (9:16, 4:5), so a card can carry a 1200×630 copy made for the preview;
-- share-card-og serves it as og:image when it's there and the card itself
-- otherwise. The app writes `<image_path without .jpg>-og.jpg` in the member's
-- own folder of the public share-cards bucket.
--
-- The row is member-written, so the path is held to that shape (a uuid folder
-- and one file name, no slashes or dots to climb out of it). share-card-og
-- checks the same shape before it builds a URL from it.

alter table public.share_cards
  add column if not exists preview_path text;

alter table public.share_cards
  drop constraint if exists share_cards_preview_path_shape;

alter table public.share_cards
  add constraint share_cards_preview_path_shape
  check (preview_path is null or preview_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.jpg$');

comment on column public.share_cards.preview_path is
  'Optional 1200×630 landscape copy of the card in the share-cards bucket; share-card-og serves it as og:image so chat apps show a large preview.';
