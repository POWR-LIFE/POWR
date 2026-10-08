-- Tracker → Slack (#issues and #development).
--
-- When an issue is filed, or its status, priority or assignee changes, pg_net
-- calls the tracker-slack edge function with x-webhook-secret from Vault
-- (db_webhook_secret) — the same model as _gym_event_notify. pg_net sends
-- after commit, so a rolled-back change never posts. The function decides
-- what's worth saying where (supabase/functions/_shared/trackerSlack.ts).
--
-- Bulk loads stay quiet with:  set local tracker.slack = 'off';
-- (the seed of Claude's notes uses it, so #issues isn't flooded with 40 posts).

-- An issue's thread in #issues, so later moves reply under it and the
-- Tracker can link to it. Written by the edge function (service role).
create table if not exists public.tracker_slack_threads (
    issue_id uuid primary key references public.tracker_issues(id) on delete cascade,
    channel text not null,
    ts text not null,
    permalink text,
    created_at timestamptz not null default now()
);

alter table public.tracker_slack_threads enable row level security;

drop policy if exists "Admins read tracker slack threads" on public.tracker_slack_threads;
create policy "Admins read tracker slack threads" on public.tracker_slack_threads
    for select to authenticated using ((select public.is_admin()));

create or replace function public._tracker_slack_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
    if coalesce(current_setting('tracker.slack', true), '') = 'off' then
        return null;
    end if;
    if tg_op = 'UPDATE'
       and (new.status, new.priority, new.assignee_id) is not distinct from (old.status, old.priority, old.assignee_id) then
        return null;
    end if;

    perform net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/tracker-slack',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'db_webhook_secret')
        ),
        body := jsonb_build_object(
            'kind', case when tg_op = 'INSERT' then 'created' else 'updated' end,
            'issue', jsonb_build_object(
                'id', new.id, 'number', new.number, 'title', new.title, 'type', new.type,
                'status', new.status, 'resolution', new.resolution, 'priority', new.priority,
                'surface', new.surface, 'area', new.area, 'feature', new.feature,
                'platforms', to_jsonb(new.platforms), 'risks', to_jsonb(new.risks),
                'pr_numbers', to_jsonb(new.pr_numbers), 'ship_steps', new.ship_steps,
                'verify_how', new.verify_how, 'verified_note', new.verified_note, 'source', new.source
            ),
            'old', case when tg_op = 'UPDATE' then jsonb_build_object(
                'status', old.status, 'priority', old.priority, 'assignee_id', old.assignee_id
            ) end,
            -- Who did it: the signed-in admin; a filed issue's reporter when
            -- written with the service role (Claude sessions → none).
            'actor', (select coalesce(p.display_name, p.username) from public.profiles p
                      where p.id = coalesce(auth.uid(), case when tg_op = 'INSERT' then new.created_by end)),
            'assignee_id', new.assignee_id,
            'assignee', (select coalesce(p.display_name, p.username) from public.profiles p where p.id = new.assignee_id)
        ),
        timeout_milliseconds := 5000
    );
    return null;
exception when others then
    -- Slack being down must never stop an issue saving.
    raise warning '[_tracker_slack_notify] %', sqlerrm;
    return null;
end;
$$;

drop trigger if exists tracker_issues_slack on public.tracker_issues;
create trigger tracker_issues_slack after insert or update on public.tracker_issues
    for each row execute function public._tracker_slack_notify();
