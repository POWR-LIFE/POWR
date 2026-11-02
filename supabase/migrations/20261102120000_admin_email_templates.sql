-- Admin email templates: write an HTML email in the admin panel, preview it as a
-- recipient will see it, send yourself a test, then send it to an audience
-- through Mailgun (the admin-send-email edge function).
--
-- Three tables:
--   email_templates        — what the team writes and edits
--   email_sends            — one row per send, with the subject + HTML AS SENT
--                            (editing the template later never rewrites history)
--   email_send_deliveries  — one row per recipient, queued up-front, so a send
--                            that runs past the function's time budget (or
--                            dies mid-way) resumes from exactly where it stopped
-- and one RPC, admin_email_recipients(), which turns a set of user ids into
-- addresses + merge data in a single query. Service-role only: the edge
-- function is the admin gate.

create table public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 120),
  subject       text not null default '' check (length(subject) <= 200),
  preheader     text not null default '' check (length(preheader) <= 300),
  html          text not null default '' check (length(html) <= 400000),
  text          text not null default '' check (length(text) <= 100000),
  -- Wrap the HTML in the shared POWR shell (logo header, footer with the
  -- Mailgun unsubscribe link). Off = the HTML is sent exactly as written.
  use_shell     boolean not null default true,
  reply_to      text not null default 'support@powr.life' check (length(reply_to) <= 320),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_sent_at  timestamptz
);

create index email_templates_updated_idx on public.email_templates (updated_at desc);
create index email_templates_created_by_idx on public.email_templates (created_by);
create index email_templates_updated_by_idx on public.email_templates (updated_by);

create table public.email_sends (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid references public.email_templates(id) on delete set null,
  template_name    text not null,
  subject          text not null,
  preheader        text not null default '',
  html             text not null,
  text             text not null default '',
  use_shell        boolean not null default true,
  reply_to         text,
  -- Same audience spec as broadcast pushes ({mode: all|segment|users|event, …}).
  audience         jsonb not null default '{"mode":"all"}'::jsonb,
  status           text not null default 'sending'
                   check (status in ('sending', 'paused', 'sent', 'failed')),
  recipient_count  int not null default 0 check (recipient_count >= 0),
  sent_count       int not null default 0 check (sent_count >= 0),
  failed_count     int not null default 0 check (failed_count >= 0),
  -- People in the audience who turned Product news off; never emailed.
  opted_out_count  int not null default 0 check (opted_out_count >= 0),
  sent_by          uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index email_sends_created_idx on public.email_sends (created_at desc);
create index email_sends_template_idx on public.email_sends (template_id);
create index email_sends_sent_by_idx on public.email_sends (sent_by);

create table public.email_send_deliveries (
  id          uuid primary key default gen_random_uuid(),
  send_id     uuid not null references public.email_sends(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  status      text not null default 'queued'
              check (status in ('queued', 'sending', 'sent', 'failed')),
  error       text,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  unique (send_id, email)
);

create index email_send_deliveries_send_status_idx
  on public.email_send_deliveries (send_id, status);
create index email_send_deliveries_user_idx on public.email_send_deliveries (user_id);

create or replace function public.touch_email_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger email_templates_touch_updated_at
before update on public.email_templates
for each row execute function public.touch_email_updated_at();

create trigger email_sends_touch_updated_at
before update on public.email_sends
for each row execute function public.touch_email_updated_at();

alter table public.email_templates enable row level security;
alter table public.email_sends enable row level security;
alter table public.email_send_deliveries enable row level security;

-- Admins write templates in the panel. Sends and deliveries are written only by
-- the service-role edge function; admins read them for the history list.
create policy "Admins manage email templates"
  on public.email_templates for all
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

create policy "Admins read email sends"
  on public.email_sends for select
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

create policy "Admins read email send deliveries"
  on public.email_send_deliveries for select
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

grant select, insert, update, delete on public.email_templates to authenticated;
grant select on public.email_sends to authenticated;
grant select on public.email_send_deliveries to authenticated;

revoke all on function public.touch_email_updated_at() from public, anon, authenticated;

-- Addresses + merge data for a set of users (null = everyone). Reads
-- auth.users for the address, so it is SECURITY DEFINER and callable by the
-- service role only. opted_out mirrors the push broadcast's rule: Product news
-- off in the app (notification_preferences.announcements) means no marketing
-- mail either. Callers decide whether to honour it (sends do; tests don't).
create or replace function public.admin_email_recipients(p_user_ids uuid[] default null)
returns table (
  user_id        uuid,
  email          text,
  display_name   text,
  username       text,
  referral_code  text,
  language       text,
  balance        int,
  opted_out      boolean
)
language sql
security definer
set search_path = public
as $$
  select
    pr.id                                        as user_id,
    u.email::text                                as email,
    pr.display_name,
    pr.username,
    pr.referral_code,
    pr.language,
    coalesce(bal.balance, 0)::int                as balance,
    coalesce(np.announcements, true) = false     as opted_out
  from public.profiles pr
  join auth.users u on u.id = pr.id
  left join public.notification_preferences np on np.user_id = pr.id
  left join lateral (
    select coalesce(sum(pt.amount), 0)::int as balance
    from public.point_transactions pt
    where pt.user_id = pr.id
  ) bal on true
  where u.email is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and (p_user_ids is null or pr.id = any (p_user_ids));
$$;

revoke all on function public.admin_email_recipients(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_email_recipients(uuid[]) to service_role;
