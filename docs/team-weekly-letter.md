# POWR Team Weekly

The Team Weekly is an automated internal platform report. It aggregates a fixed
UTC window from POWR's operational data, compares it with the previous equal
window, renders a visual email, and stores the exact JSON snapshot that was
reviewed and sent.

This is separate from the personalised member weekly summary and the partner
performance email. Those emails describe one recipient's week; this letter
describes the health and direction of the whole platform.

## Reporting rhythm

- **Reporting window:** Monday 00:00 through Sunday 23:59 UTC.
- **Generate:** Monday after the previous week closes.
- **Send:** Monday morning to the internal weekly-report list after previewing a
   test email.
- **Archive:** Generate, send and review every report in Admin > Team Letters. A
   sent report is read-only and retains its data snapshot and recipient delivery
   record.
- **Refresh:** Preview, test and production send refresh unsent reports from live
   data. Sent reports always render their frozen snapshot.

Manage the internal mailing list under Admin > Team Letters > Recipients. It is
deliberately separate from app users, push audiences and member notification
preferences. Use **Send test** before the final send and confirm the inbox preview,
links, dates and final metrics in a real email client.

## Data rules

1. Use half-open UTC windows: Monday 00:00 through the following Monday 00:00.
2. Compare every flow metric with the previous equal window. All-time inventory
   metrics are labelled `Snapshot` rather than given a misleading delta.
3. Store aggregate data only. Do not include member names, emails, support
   messages, tokens, or partner-confidential commercial terms.
4. Trusted workouts exclude walking, sleep, and flagged sessions.
5. Historical reports never query current data after they are sent.
6. A failed panel must be treated as a generation error, never silently shown as
   zero.

## Automated sources

Use the same sources each week so changes are comparable.

| Area | Source | Pull |
| --- | --- | --- |
| Members | `profiles`, `user_push_tokens` | Total/new/active members, Pro, health and push reach |
| Product | `app_events` | Users, app sessions, screen views, taps, top screens/actions and daily trend |
| Movement | `activity_sessions` | Sessions, trusted workouts, duration, trust, flags, activity and verification mix |
| Economy | `point_transactions`, `redemptions` | POWR issued/spent, claims, used codes, sources and leading rewards |
| Challenges | Challenge completion, shared challenge and participant tables | Completions, members, POWR, starts, joins and settlements |
| Partners | Partners, locations, linked sessions and gym visits | Directory reach, active venues, members, visits, claims and flags |
| Operations | Support, reward submissions, push logs and live events | Workload, backlog, delivery outcomes and event participation |

## Report shape

The email starts with six headline KPIs and a seven-day product/workout chart.
Seven visual sections then show compact scorecards and ranked bars for members,
product engagement, movement and trust, the POWR economy, challenges, partners,
and operations. The plaintext alternative contains the same metrics and deltas.

The server generates the subject and preheader from current headline values.
Admins choose only the reporting window and recipients; there is no report-body
editor.