# Infrastructure cost at 1,000 users

Modelled August 2026 from the live project (72 registered users, 19 monthly active,
32 Terra connections, 252 MB database), scaled to 1,000 registered users.

**Expected: ~$642/mo. Realistic band $600–750/mo. ~$0.64 per registered user.**

Almost every line is a plan floor rather than metered usage, so the bill is set by
which tiers we sit on, not by how many people use the app.

## The bill

| Service | Monthly | Basis |
|---|---:|---|
| **Terra** | **$499** | Plan floor. 100k credits included — enough for ~500 wearable users; ~440 connections × ~200 credits ≈ 88k. |
| Supabase | $30 | Pro $25 + ~$5 net for a Small compute instance after the $10 credit. |
| Sentry | $26 | Team, 50k errors. `tracesSampleRate: 0` keeps this small. |
| Google Maps | ~$25 | Discover-tab MapView + Directions API, right at the 10k/5k free caps. Uncapped by default. |
| Vercel | $20 | Pro, 1 seat. Static landing page; the interesting routes rewrite into Supabase. |
| EAS / Expo | $19 | Starter. Forced upgrade — free caps EAS Update at 1,000 MAU. |
| Mailgun | $15 | ~7,000 sends/mo (weekly summaries dominate). |
| Apple Developer | $8 | $99/yr amortised. |
| GitHub | $0 | Free tier. No `.github/workflows`, so zero Actions minutes. |
| **Total** | **$642** | |

Push (FCM/APNs) is free. Google Play was a one-time $25.

## The one number that could be badly wrong

`supabase/functions/terra-poll/index.ts` asks Terra to re-push data every 30 minutes
for every active connection (`to_webhook=true`). Terra meters credits on connected
users **and events**, and the ~200 credits/user figure assumes normal auto-push, not a
caller re-requesting the window 48 times a day.

At 1,000 users that is ~216,000 Terra requests/month. If those are metered, overage is
$1,600+ and Terra becomes ~$2,150/mo — the whole budget.

**Action: read this month's credit burn in the Terra dashboard.** The loop already
issues ~70,000 requests/month at our current 32 connections, so the answer is already
visible today.

## Separate scale bug found while costing this

`MAX_CONNECTIONS_PER_RUN = 100` is applied as a bare `.limit(100)` with no ordering and
no staleness filter — it takes the first 100 non-deauthed rows Postgres returns. At 32
connections that is everyone. At ~440 connections it is the same arbitrary 100 every
cycle, and ~340 users silently stop receiving wearable data. The code comment claims the
backlog drains, but nothing rotates the window.

Fix: order by `last_event_at` ascending so the stalest connections take the slot.

## Measured basis

| Signal | Today |
|---|---:|
| Registered users | 72 |
| Monthly active (signed in, 30d) | 19 |
| Terra connections | 32 (44% of users) |
| Database size | 252 MB (168 MB is `_http_response` / `job_run_details` bloat) |
| Push sends, last 7 days | 4,948 |
| App events, last 7 days | 6,218 |
| Geofence region events, last 7 days | 11,171 |
| Active pg_cron jobs | 16 (2 run every minute) |
| Supabase edge functions | 45 |

The 16 cron jobs fire ~106,000 edge invocations/month regardless of user count; Terra
webhooks and push add maybe 600k more at 1,000 users. Supabase Pro includes 2M, so this
stays free.

If "1,000 users" means 1,000 *monthly active* rather than registered, Maps and Mailgun
rise and the total lands nearer $750. The floors do not move — which is the point.

## Do these, in order

1. Read Terra's credit burn in the dashboard. It is 78% of the budget and the only
   number here that could be wrong by an order of magnitude.
2. Put a quota cap and budget alert on the Google Maps key — it is uncapped,
   client-callable, and ships in the app bundle.
3. Fix the `.limit(100)` ordering in terra-poll before we pass ~100 connections.
4. Drive wearable connection rate. The $499 floor buys ~500 wearable users whether we
   use them or not — at today's 32 connections that is $15.59 each, at 440 it is $1.13.
   We are already paying for the capacity.

Prices are list, August 2026, excluding VAT.
