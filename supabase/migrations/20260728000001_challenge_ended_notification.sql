-- Shared challenges: tell people when one ENDS BADLY, and let the loss linger
-- long enough to be seen.
--
-- Until now every one of the four failure exits (parallel flop, pooled miss,
-- forming too thin, roster dropped below two) wrote a terminal status and
-- returned silently. There was no failure notification type in the system at
-- all, and because user_activity rows are only written inside
-- send-push-notification, no push also meant no in-app record. Meanwhile the
-- list RPC dropped 'expired'/'cancelled' the instant they were set, so the card
-- simply vanished from Home — sometimes mid-session. A win lingered three days
-- and was dismissed on the user's terms; a loss was deleted without a word.
--
-- Three parts:
--   1. a `challenge_ended` preference column + notification_config seed
--   2. settled_at means "reached a terminal state" (cancels stamp it too)
--   3. the list RPC keeps terminal challenges for the same 3 days a win gets

-- ── 1. Preference column ─────────────────────────────────────────────────────
-- send-push-notification derives the preference column straight from the type
-- name, so this MUST be called challenge_ended. A missing column doesn't error
-- there — it silently disables the gate — so the opt-out would be decorative
-- without this.
alter table public.notification_preferences
  add column if not exists challenge_ended boolean not null default true;

insert into public.notification_config (type, enabled, category, class, description)
values (
  'challenge_ended', true, 'social', 'social',
  'Sent to everyone still in a shared challenge when it ends without a win — expired, came up short, or cancelled'
)
on conflict (type) do nothing;

-- ── 2. settled_at on cancellations ───────────────────────────────────────────
-- 'expired' already carries settled_at (the resolve cron stamps it as part of
-- the settlement claim before flipping the status). 'cancelled' never did, so
-- any visibility window keyed on settled_at would silently miss every
-- cancellation. Backfill terminal rows so the column is never null on a
-- finished challenge, and let the edge functions stamp it going forward.
--
-- Backfilled values are all well outside the 3-day window below, so this does
-- not resurface any historical challenge — it just removes the null trap.
update public.shared_challenges
   set settled_at = coalesce(settled_at, ends_at, created_at)
 where status in ('completed', 'expired', 'cancelled')
   and settled_at is null;

-- ── 3. Terminal challenges linger for 3 days ─────────────────────────────────
-- Same window losses and wins alike. Without this the #258 verdict copy on the
-- detail screen is only reachable by tapping a stale notification, because
-- nothing in the app links to a challenge the list RPC won't return.
create or replace function public.get_my_shared_challenges()
returns table(
  id uuid, creator_id uuid, kind text, template jsonb, rule jsonb, category text,
  base_points integer, status text, duration_hours integer,
  accept_by timestamptz, starts_at timestamptz, ends_at timestamptz,
  bonus_per_head integer, bonus_max integer, settled_at timestamptz,
  created_at timestamptz, dismissed_at timestamptz, participants jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    c.id, c.creator_id, c.kind, c.template, c.rule, c.category, c.base_points, c.status,
    c.duration_hours, c.accept_by, c.starts_at, c.ends_at, c.bonus_per_head,
    c.bonus_max, c.settled_at, c.created_at,
    (select me.dismissed_at from public.shared_challenge_participants me
      where me.challenge_id = c.id and me.user_id = auth.uid()) as dismissed_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id', sp.user_id,
                'username', p.username,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'state', sp.state,
                'progress', sp.progress,
                'momentum', sp.momentum,
                'completed', sp.completed,
                'contribution', sp.contribution,
                'is_self', sp.user_id = auth.uid()
              ) order by (sp.user_id = c.creator_id) desc, sp.created_at)
       from public.shared_challenge_participants sp
       join public.profiles p on p.id = sp.user_id
       where sp.challenge_id = c.id
         and sp.state not in ('declined','left')),
      '[]'::jsonb
    ) as participants
  from public.shared_challenges c
  where exists (
    select 1 from public.shared_challenge_participants me
    where me.challenge_id = c.id
      and me.user_id = auth.uid()
      and me.state not in ('declined','left')
  )
  and (
    c.status in ('forming','active')
    -- Every terminal state now lingers, not just the happy one. Keyed on
    -- settled_at, which part 2 guarantees is set on all three.
    or (c.status in ('completed','expired','cancelled')
        and c.settled_at > now() - interval '3 days')
  )
  order by c.created_at desc;
$function$;

revoke all on function public.get_my_shared_challenges() from anon;
grant execute on function public.get_my_shared_challenges() to authenticated;
