-- ---------------------------------------------------------------------------
-- Cron → edge-function invocations: a 30 s pg_net timeout, not the 5 s default.
--
-- System Health, day one (2026-08-25): 37 of 885 pg_net responses in the 6 h
-- window were 5 s timeouts, and 34 of those landed 0–2 s past the minute —
-- the cron-invoked edge functions (gym-visit-beacon and dispatch-brand-webhooks
-- every minute, the rest on 15/30/60-minute cadences). None of the ten cron
-- commands set timeout_milliseconds, so every one ran on pg_net's 5,000 ms
-- default. Ten of the failures were the function itself taking longer than
-- that to answer; the other 27 were DNS resolution stalling inside the worker.
--
-- Nothing else records these. net.http_post only ENQUEUES, so
-- cron.job_run_details shows every run as 'succeeded', and pg_net purges its
-- own response table after 6 hours. A beacon tick that dies here simply does
-- not happen, and the settle/nudge passes wait for the next minute.
--
-- 30 s covers the slow-answer class outright (the beacon's 24 h p95 is 0.07 s;
-- its worst tick 0.6 s — the 5 s cases are cold starts and the occasional heavy
-- pass). It does nothing for the DNS-stall class, which needs a retry — that is
-- the W4 durable-relay workstream, and the relay.fail_pct signal now measures
-- it. Same command text, one extra argument; the schedule, headers and body
-- are untouched.
-- ---------------------------------------------------------------------------

do $$
declare
  j record;
  v_cmd text;
begin
  for j in
    select jobid, jobname, command
    from cron.job
    where command ilike '%net.http_post(%'
      and command not ilike '%timeout_milliseconds%'
  loop
    -- Insert the timeout as the last argument of the net.http_post(...) call.
    -- Every one of these commands ends with `body := '{}'::jsonb\n  )` — anchor
    -- on the final closing paren so the edit cannot land inside the headers
    -- jsonb_build_object.
    v_cmd := regexp_replace(
      j.command,
      '\)\s*$',
      E',\n    timeout_milliseconds := 30000\n  )\n  '
    );

    if v_cmd = j.command then
      raise exception 'cron_http_timeouts: could not place timeout in job % (%)', j.jobname, j.jobid;
    end if;

    perform cron.alter_job(job_id := j.jobid, command := v_cmd);
    raise notice 'cron_http_timeouts: % → 30 s', j.jobname;
  end loop;
end $$;

-- Every http cron now carries the timeout. A job added later without one
-- shows up on System Health only as a 5 s failure, so keep this invariant.
do $$
declare
  n int;
begin
  select count(*) into n
  from cron.job
  where command ilike '%net.http_post(%'
    and command not ilike '%timeout_milliseconds := 30000%';
  if n > 0 then
    raise exception 'cron_http_timeouts: % http cron job(s) still without a 30 s timeout', n;
  end if;
end $$;
