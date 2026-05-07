-- Remove existing waitlist rows that match the bot email pattern we are now blocking.
-- Criteria (mirrors is_plausible_waitlist_email for gmail/googlemail):
--   • gmail.com or googlemail.com domain
--   • 3+ dots in the local part, AND
--   • at least one of:
--       – a single-char segment (e.g. g.ohr.ni.ls)
--       – any digit in the local part (e.g. ne.zo.ki.la09.8)
--       – average chars-per-segment < 3 (very fragmented)

delete from public.waitlist
where
  -- only gmail/googlemail
  (
    lower(split_part(email, '@', 2)) = 'gmail.com'
    or lower(split_part(email, '@', 2)) = 'googlemail.com'
  )
  and (
    -- 3 or more dots in the local part
    length(split_part(lower(email), '@', 1))
      - length(replace(split_part(lower(email), '@', 1), '.', '')) >= 3
  )
  and (
    -- single-char segment
    split_part(lower(email), '@', 1) ~ '(^|\.)[a-z0-9](\.|$)'
    -- or digit present
    or split_part(lower(email), '@', 1) ~ '\d'
    -- or very fragmented (avg chars/segment < 3)
    or (
      length(replace(split_part(lower(email), '@', 1), '.', ''))
        < (
            length(split_part(lower(email), '@', 1))
            - length(replace(split_part(lower(email), '@', 1), '.', ''))
            + 1  -- segment_count = dot_count + 1
          ) * 3
    )
  );
