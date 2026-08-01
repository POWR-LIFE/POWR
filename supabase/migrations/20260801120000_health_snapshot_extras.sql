-- Capture the rest of what Terra already sends per workout.
--
-- terra-webhook read 5 fields out of a payload carrying dozens: elevation, HR
-- zones, power, swim laps, intensity minutes and max HR all arrived and were
-- dropped on the floor. Terra does not re-serve an old payload on demand, so
-- every field not read at ingest is lost for that session permanently — which is
-- why this is a jsonb catch-all rather than a column per metric: providers fill
-- wildly different subsets (Whoop sends no distance, Garmin no max HR), and ten
-- mostly-null columns would be worse than one bag we can read selectively.
--
-- DELIBERATELY BOUNDED. Only scalar summaries and the small hr_zones array go in
-- here. The sample series Terra also sends (heart_rate_samples, power_samples,
-- MET_samples, position_data) are thousands of points per workout and must NEVER
-- be written to this column — an oversized json write is exactly what took every
-- points award down for 4.5 hours on 2026-07-20.

alter table public.health_snapshots
    add column if not exists extras jsonb;

comment on column public.health_snapshots.extras is
    'Bounded per-workout metrics from the provider: elevation_gain_m, elevation_loss_m, '
    'steps, hr_min, hrv_rmssd, avg_watts, max_watts, swim_laps, swim_strokes, pool_length_m, '
    'floors, net_calories, high_intensity_min, moderate_intensity_min, hr_zones[]. '
    'Scalars + the short hr_zones array only — never sample series.';
