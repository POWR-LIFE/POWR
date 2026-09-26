# Sending email previews

Every server-sent email function (`send-weekly-summary`, `send-level-up-email`,
`send-brand-weekly-report`, `send-reengagement-email`, `send-partner-setup-reminder`,
`send-redemption-receipt`)
has a `sample: true` mode that renders representative data to one address and
touches nothing. It is gated by the same `x-resolve-token` as the real sends.
The anon key never authorises a send: it is public, so accepting it would make
the function an open mail relay on the powr.life domain.

The token lives in Vault, so fire previews from SQL (Supabase SQL editor or the
MCP `execute_sql`), which can read it:

```sql
select net.http_post(
  url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-reengagement-email',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
  ),
  body := '{"sample": true, "only_email": "jamie@powr.life"}'::jsonb
) as request_id;
```

Then read the reply:

```sql
select status_code, content, error_msg from net._http_response where id = <request_id>;
```

Per-function sample options:

| Function | Body |
|---|---|
| `send-weekly-summary` | `{"sample":true,"only_email":…,"variant":"up"\|"down"\|"starter"}` |
| `send-level-up-email` | `{"sample":true,"only_email":…}` |
| `send-brand-weekly-report` | `{"sample":true,"only_email":…}` |
| `send-reengagement-email` | `{"sample":true,"only_email":…,"variant":"lapsed"\|"never_started","stage":1\|2}` (both omitted = all four); `{"dry_run":true}` lists who is due without sending |
| `send-partner-setup-reminder` | `{"sample":true,"only_email":…,"stage":"invite"\|"delivery"}` (omitted = both); `{"dry_run":true}` lists the brands due without sending |
| `send-redemption-receipt` | `{"sample":true,"only_email":…,"kind":"code"\|"link"}` (omitted = both) |

The `email-previews` function is the other route: it has its own key and a
hard-coded recipient allowlist, and renders the welcome / weekly / level-up
set without going through the real functions.
