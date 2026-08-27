-- Let a corrected sleep receipt reach the user.
--
-- sleep_target_met has capped at 1/day since it was introduced, on the reasoning
-- that one night deserves one push. What that actually bought was first-teller-
-- wins. On a split night Terra delivers the first segment as a scored, complete
-- sleep hours before the night ends: 2026-08-23 pushed "4.8h of sleep earned you
-- 1 POWR point" at 01:56 for a night that ran to 08:13, was worth 8.8h, and paid
-- 5 points. terra-webhook did try to correct it at 06:06 — push_send_log holds
-- that attempt as status 'skipped', skip_reason 'type_daily_cap'. Same skip on
-- 08-18 and 08-21. The cap was not absorbing the fragment case, it was pinning
-- the fragment in place and discarding the truth.
--
-- 2 is the whole fix: one receipt, plus one correction if the night turns out to
-- be bigger than the piece we first saw. terra-webhook only spends the second
-- one when the night grew by at least half an hour (RECEIPT_CORRECTION_MIN_H),
-- so an ordinary night still sends exactly one push and the all-day stream of
-- Terra restatements stays silent.

update notification_config
set daily_cap = 2
where type = 'sleep_target_met';
