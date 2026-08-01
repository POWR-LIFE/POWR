update public.team_letters
set
  title = 'POWR Platform Pulse',
  subject = '[POWR Weekly] Automated platform report | ' || reporting_start || ' - ' || reporting_end,
  preview_text = 'Live member, movement, product, rewards, partner and operations data for the week.',
  body_markdown = 'Automated weekly platform report. See report_data for the archived snapshot.',
  report_data = public.generate_team_letter_report(reporting_start, reporting_end),
  generated_at = now(),
  generation_version = 1
where status in ('draft', 'failed')
  and report_data = '{}'::jsonb;