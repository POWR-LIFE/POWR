-- Follow-up from the Supabase advisors after the archive migration: cover the
-- administrative foreign keys and evaluate auth.uid() once per statement in
-- RLS policies rather than once per row.

create index team_letter_recipients_created_by_idx
  on public.team_letter_recipients (created_by);
create index team_letters_created_by_idx
  on public.team_letters (created_by);
create index team_letters_updated_by_idx
  on public.team_letters (updated_by);
create index team_letters_sent_by_idx
  on public.team_letters (sent_by);
create index team_letter_deliveries_recipient_idx
  on public.team_letter_deliveries (recipient_id);

drop policy "Admins manage team letter recipients" on public.team_letter_recipients;
create policy "Admins manage team letter recipients"
  on public.team_letter_recipients for all
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy "Admins read team letters" on public.team_letters;
create policy "Admins read team letters"
  on public.team_letters for select
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy "Admins create team letter drafts" on public.team_letters;
create policy "Admins create team letter drafts"
  on public.team_letters for insert
  with check (
    status = 'draft'
    and exists (select 1 from public.admin_roles where user_id = (select auth.uid()))
  );

drop policy "Admins edit unsent team letters" on public.team_letters;
create policy "Admins edit unsent team letters"
  on public.team_letters for update
  using (
    status in ('draft', 'failed')
    and exists (select 1 from public.admin_roles where user_id = (select auth.uid()))
  )
  with check (
    status in ('draft', 'failed')
    and exists (select 1 from public.admin_roles where user_id = (select auth.uid()))
  );

drop policy "Admins delete unsent team letters" on public.team_letters;
create policy "Admins delete unsent team letters"
  on public.team_letters for delete
  using (
    status in ('draft', 'failed')
    and exists (select 1 from public.admin_roles where user_id = (select auth.uid()))
  );

drop policy "Admins read team letter deliveries" on public.team_letter_deliveries;
create policy "Admins read team letter deliveries"
  on public.team_letter_deliveries for select
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));