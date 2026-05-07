-- Harden waitlist email validation so bot submissions cannot bypass client checks.
create or replace function public.is_plausible_waitlist_email(candidate text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  cleaned text := lower(btrim(candidate));
  local_part text;
  domain_part text;
  dot_count integer;
  compact_length integer;
  segment_count integer;
begin
  if cleaned = '' then
    return false;
  end if;

  if cleaned !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    return false;
  end if;

  local_part := split_part(cleaned, '@', 1);
  domain_part := split_part(cleaned, '@', 2);

  if local_part = '' or domain_part = '' then
    return false;
  end if;

  if local_part like '.%' or local_part like '%.' or local_part like '%..%' then
    return false;
  end if;

  if length(local_part) < 2 or length(local_part) > 64 then
    return false;
  end if;

  if length(domain_part) < 4 or length(domain_part) > 255 then
    return false;
  end if;

  -- Block the observed gmail/googlemail bot pattern: fragmented local-part
  -- using many dots plus single-char chunks, digits, or very short average chunks.
  if domain_part in ('gmail.com', 'googlemail.com') then
    dot_count := length(local_part) - length(replace(local_part, '.', ''));

    if dot_count >= 3 then
      compact_length := length(replace(local_part, '.', ''));
      segment_count := dot_count + 1;

      if local_part ~ '(^|\.)[a-z0-9](\.|$)'
         or local_part ~ '\d'
         or compact_length < (segment_count * 3)
      then
        return false;
      end if;
    end if;
  end if;

  return true;
end;
$$;

alter table public.waitlist
  drop constraint if exists waitlist_email_quality_check;

alter table public.waitlist
  add constraint waitlist_email_quality_check
  check (public.is_plausible_waitlist_email(email));

drop policy if exists "Allow anonymous inserts" on public.waitlist;

create policy "Allow anonymous inserts"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (public.is_plausible_waitlist_email(email));
