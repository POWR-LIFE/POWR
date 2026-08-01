-- Strip fabricated zeroes written by the first version of the extras extractor.
--
-- terra-webhook's num() coerced explicit nulls to 0: `typeof null === 'object'`,
-- so null fell past the number check into `Number(null) === 0`, which is finite
-- and survived the null-strip. Garmin sends populated summary objects whose
-- unmeasured members are explicit nulls (Whoop omits the keys entirely, which is
-- why only Garmin rows were affected), so every Garmin workout landed holding a
-- dozen zero "readings" — including swim_laps and pool_length_m on a gym session
-- and hr_min: 0 on a HIIT session.
--
-- A zero can no longer be told apart from a missing value on these rows, and
-- Terra never re-serves a payload, so the honest repair is to drop every
-- zero-valued key: the UI renders each metric only when > 0, so a genuine zero
-- carried no information anyway, while a fabricated one is a wrong reading.
--
-- The extractor now rejects null/boolean/blank input at the source
-- (supabase/functions/_shared/terraExtras.ts, covered by __tests__/terraExtras.test.ts),
-- so this is a one-off repair, not a recurring sweep.

update public.health_snapshots
set extras = nullif(
    (
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        from jsonb_each(extras) as e
        where e.value <> to_jsonb(0)
    ),
    '{}'::jsonb
)
where extras is not null
  and exists (
      select 1 from jsonb_each(extras) as e where e.value = to_jsonb(0)
  );
