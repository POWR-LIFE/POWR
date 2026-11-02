-- Admin email templates: the HTML cap of 400,000 characters is hit at once by
-- a pasted design export, because those embed every image as base64. Raise it
-- to 2,000,000 so the paste lands and the Email page can then upload the
-- images to storage and shrink the HTML. Gmail still clips anything over
-- 102 KB; the page warns about that separately.
--
-- The inline column checks were auto-named, so find them by definition rather
-- than trusting the name.

do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.email_templates'::regclass, 'public.email_sends'::regclass)
      and pg_get_constraintdef(oid) ilike '%length(html)%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.email_templates
  add constraint email_templates_html_check check (length(html) <= 2000000);
alter table public.email_sends
  add constraint email_sends_html_check check (length(html) <= 2000000);
