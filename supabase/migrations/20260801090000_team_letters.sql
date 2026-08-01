-- Internal team letter: admin-managed recipients, draft/sent archive and
-- per-recipient delivery outcomes. This audience is deliberately separate from
-- member notification preferences and app-user broadcast targeting.

create table public.team_letter_recipients (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (length(email) between 3 and 320 and position('@' in email) > 1),
  name        text check (name is null or length(name) <= 120),
  active      boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index team_letter_recipients_email_idx
  on public.team_letter_recipients (lower(email));
create index team_letter_recipients_active_idx
  on public.team_letter_recipients (active, created_at);

create table public.team_letters (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(title) between 1 and 160),
  subject           text not null check (length(subject) between 1 and 200),
  preview_text      text not null default '' check (length(preview_text) <= 300),
  reporting_start   date not null,
  reporting_end     date not null,
  body_markdown     text not null default '' check (length(body_markdown) <= 100000),
  status            text not null default 'draft'
                    check (status in ('draft', 'sending', 'sent', 'failed')),
  recipient_count   int not null default 0 check (recipient_count >= 0),
  sent_count        int not null default 0 check (sent_count >= 0),
  failed_count      int not null default 0 check (failed_count >= 0),
  delivery_report   jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users(id) on delete set null,
  updated_by        uuid references auth.users(id) on delete set null,
  sent_by           uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  sent_at           timestamptz,
  constraint team_letters_reporting_window check (reporting_end >= reporting_start)
);

create index team_letters_archive_idx
  on public.team_letters (reporting_end desc, created_at desc);

create table public.team_letter_deliveries (
  id               uuid primary key default gen_random_uuid(),
  letter_id        uuid not null references public.team_letters(id) on delete cascade,
  recipient_id     uuid references public.team_letter_recipients(id) on delete set null,
  recipient_email  text not null,
  recipient_name   text,
  status           text not null check (status in ('sent', 'failed')),
  error             text,
  sent_at           timestamptz not null default now(),
  unique (letter_id, recipient_email)
);

create index team_letter_deliveries_letter_idx
  on public.team_letter_deliveries (letter_id, status);

create or replace function public.touch_team_letter_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger team_letter_recipients_touch_updated_at
before update on public.team_letter_recipients
for each row execute function public.touch_team_letter_updated_at();

create trigger team_letters_touch_updated_at
before update on public.team_letters
for each row execute function public.touch_team_letter_updated_at();

alter table public.team_letter_recipients enable row level security;
alter table public.team_letters enable row level security;
alter table public.team_letter_deliveries enable row level security;

create policy "Admins manage team letter recipients"
  on public.team_letter_recipients for all
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

create policy "Admins read team letters"
  on public.team_letters for select
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

create policy "Admins create team letter drafts"
  on public.team_letters for insert
  with check (
    status = 'draft'
    and exists (select 1 from public.admin_roles where user_id = auth.uid())
  );

create policy "Admins edit unsent team letters"
  on public.team_letters for update
  using (
    status in ('draft', 'failed')
    and exists (select 1 from public.admin_roles where user_id = auth.uid())
  )
  with check (
    status in ('draft', 'failed')
    and exists (select 1 from public.admin_roles where user_id = auth.uid())
  );

create policy "Admins delete unsent team letters"
  on public.team_letters for delete
  using (
    status in ('draft', 'failed')
    and exists (select 1 from public.admin_roles where user_id = auth.uid())
  );

create policy "Admins read team letter deliveries"
  on public.team_letter_deliveries for select
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

grant select, insert, update, delete on public.team_letter_recipients to authenticated;
grant select, insert, update, delete on public.team_letters to authenticated;
grant select on public.team_letter_deliveries to authenticated;

revoke all on function public.touch_team_letter_updated_at() from public, anon, authenticated;

-- Import the issue already being drafted when the archive shipped. It remains
-- a draft because the reporting window and final metrics have not closed yet.
insert into public.team_letters (
  title,
  subject,
  preview_text,
  reporting_start,
  reporting_end,
  body_markdown
) values (
  'POWR Weekly',
  '[POWR Weekly] Events move end to end | 27 Jul - 2 Aug',
  'The event journey is connected; next week is about proving the funnel with real participants.',
  '2026-07-27',
  '2026-08-02',
  $team_letter$
## The week in one minute

This week connected acquisition, participation, and live competition into one event journey. Members can discover and register for an event in the app, join through a unique promo QR, compete on a server-driven leaderboard, and appear on a venue display. Admin now has the controls to preview, operate, and review that journey. Alongside it, challenges became more personal and easier to restart, while geofence wake handling and points accounting received reliability fixes.

The important operational question for next week is whether the event journey works cleanly with real participants from scan through verified workout. The product path is in place; the next evidence must come from funnel and failure data rather than more surface area.

## At a glance

| Signal | This week | WoW | What it means |
| --- | ---: | ---: | --- |
| Weekly active members | Pending | Pending | Pull from Admin Analytics after Sunday closes |
| Verified workouts | Pending | Pending | Exclude sleep, walking, and flagged sessions |
| POWR issued | Pending | Pending | Check cap and vault adjustments before publishing |
| Reward redemptions | Pending | Pending | Break out the leading reward brand |
| Partner visits | Pending | Pending | Pull unique members and session count |
| Open support issues | Pending | Pending | Add repeated themes, not private ticket details |

## Member app

### Shipped

- Live events now have an end-to-end member journey: in-app event cards, registration, promo-code entry, event leaderboards, and shareable promo pages.
- The weekly challenge board now personalises available challenges around a member's selected activities, uses two focused slots, supports solo starts and makes it easier to run a challenge again.
- The Together carousel now gives friend activity a first-class card, making social momentum visible without leaving the home flow.
- Onboarding now leads with wearables, finishes with native health connection, and treats permissions as a soft gate rather than a dead end.
- Progress month view now follows calendar months and refreshes when background activity awards points. Session detail and drag-to-dismiss behaviour were also tightened.

### What members did

- Pending: add registrations, challenge starts, challenge completions, weekly active members, and the leading activity after the reporting window closes.

### Friction and feedback

- Geofence wake processing could reuse a stale visit and leave the wake hard to observe. Reuse is now bounded and wake telemetry is explicit; monitor the new events for delayed or duplicate visit claims.
- iOS background pushes now read the Expo APNs envelope correctly. Confirm the fix against production wake telemetry rather than push acceptance alone.

## Admin and operations

### Shipped

- Live Events gained lifecycle controls, draft previews, registration QR preview and PNG download, participant vetting, disqualification controls, funnel visibility, standings through blur, and an anti-cheat report built from four event-window signals.
- Big-screen event boards now support server-driven states and repeatable preview modes, allowing venue teams to test the display before an event is live.
- Admin Users now reports observed device provenance and supports wearable filtering, making device and integration support questions easier to diagnose.
- Web support requests now land as support tickets and are flagged in admin.

### Operating picture

- Reliability work enforced one live gym visit per user, corrected cap-clamped point vaulting, repaired streak rescue progress, and tightened service-role access around beacon nudge RPCs.
- Pending: add event funnel counts, flagged event participants, geofence wake success, opened and resolved support tickets, and the oldest open ticket.

### Needs attention

- Assign an owner for the first full event rehearsal and record pass/fail at each stage: promo scan, registration, app entry, verified workout, score update, admin review, and venue display.

## Partners and portal

### Shipped

- The partner Overview was rebuilt around a single clear verdict, with restored data loading and deliberate blank and zero-data states across the portal.
- Partners can now request a What's On week and understand placements before they have an active placement.
- Reward brands can see which promo code was claimed and whether the claim still stands.
- Brand-facing documentation and partner login are now easier to find from the public site.

### Network health

- Pending: add active partner count, partner-linked sessions, unique members, average session duration, redemptions, POWR spent, low-code alerts, and pending reward submissions.

### Partner voice

- Pending: add the most repeated partner request or question from the week and state whether it changes the roadmap, documentation, or onboarding.

## Decisions and learnings

- **Decision:** Treat event registration, competition, admin operations, and the venue display as one funnel with shared identifiers and measurable states.
- **Learning:** Empty and pre-launch states are part of the partner product, not edge cases; the portal now explains what happens before data exists.
- **Watch:** Challenge personalisation should improve relevance, but it may narrow discovery. Compare starts and completions by activity preference before drawing a conclusion.

## Next week

- **Product and Ops:** Run and document the complete event rehearsal, including failure recovery and venue-display behaviour.
- **Growth:** Establish baseline conversion from promo-page visit to registration and from registration to first verified event workout.
- **Partners:** Review zero-data portal accounts and contact the partners whose next best action is unclear or blocked.
- **Engineering:** Review geofence wake telemetry and verify that stale reuse, duplicate live visits, and silent wake failures have fallen.
  $team_letter$
);