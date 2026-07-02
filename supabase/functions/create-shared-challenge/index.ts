// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Create a parallel co-op shared challenge and invite friends into it (scope §3A,
// §5). The creator auto-accepts; invitees start `invited`. Clock is OFF until
// everyone accepts (status 'forming', accept_by ticking) — see
// respond-shared-challenge for the start. Template + derived rule + bonus config
// are SNAPSHOTTED so later admin edits never mutate a live challenge.
import { createClient } from '@supabase/supabase-js';
import { pooledRule, templateRule } from '../_shared/sharedChallenges.ts';
import { notifyPush } from '../_shared/notify.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HOUR_MS = 3_600_000;
const MAX_GROUP = 6; // creator + up to 5 friends (UI cap)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { template_id: string; friend_ids: string[]; duration_hours?: number; utc_offset_minutes?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const templateId = body.template_id;
  const friendIds = [...new Set((body.friend_ids || []).map((s) => String(s).toLowerCase()))]
    .filter((id) => id && id !== user.id.toLowerCase());
  if (!templateId) return json({ error: 'Missing template_id' }, 400);
  if (friendIds.length < 1) return json({ error: 'Invite at least one friend' }, 400);
  if (friendIds.length > MAX_GROUP - 1) return json({ error: `Groups are capped at ${MAX_GROUP}` }, 400);

  // 1. Config (bonus + timer options + cap), snapshotted onto the challenge.
  const { data: cfg } = await supabase
    .from('shared_challenge_config')
    .select('per_head, max_bonus, accept_window_hours, duration_options, default_duration_hours, challenge_cap')
    .eq('id', 1).maybeSingle();
  const perHead = cfg?.per_head ?? 5;
  const maxBonus = cfg?.max_bonus ?? 30;
  const acceptWindowHours = cfg?.accept_window_hours ?? 48;
  const durationOptions: number[] = Array.isArray(cfg?.duration_options) ? cfg!.duration_options : [48, 72, 168];
  const defaultDuration = cfg?.default_duration_hours ?? 72;
  const challengeCap = cfg?.challenge_cap ?? 3;
  let durationHours = durationOptions.includes(Number(body.duration_hours))
    ? Number(body.duration_hours) : defaultDuration;

  // 2. Template → snapshot + derived rule.
  const { data: tmpl } = await supabase
    .from('shared_challenge_templates')
    .select('id, category, title, tier, base_points, goal, measure, mode, active')
    .eq('id', templateId).maybeSingle();
  if (!tmpl || tmpl.active === false) return json({ error: 'Unknown or inactive template' }, 404);
  const isPooled = tmpl.mode === 'pooled';
  const rule = isPooled ? pooledRule(tmpl.category, tmpl.measure || {}) : templateRule(tmpl.category, tmpl.measure || {});

  // A day-based goal ("10,000 steps a day, 4 days", "check in on 7 different
  // days") can't fit a shorter run — that challenge would be unwinnable. The
  // client hides too-short options; this backstop covers old clients (which
  // send no duration at all) by stretching to the shortest option that fits.
  const measure = tmpl.measure || {};
  const goalDays = Math.max(
    Number(measure.days) || 0,
    measure.measure === 'distinct_days' ? Number(measure.target) || 0 : 0,
  );
  const minHours = goalDays * 24;
  if (durationHours < minHours) {
    durationHours = durationOptions.filter((h: number) => h >= minHours).sort((a: number, b: number) => a - b)[0] ?? minHours;
  }

  // 3. Only ACCEPTED friends are invitable.
  const { data: edges } = await supabase
    .from('friendships')
    .select('user_id, friend_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
  const acceptedFriends = new Set<string>();
  for (const e of edges ?? []) {
    acceptedFriends.add((e.user_id === user.id ? e.friend_id : e.user_id).toLowerCase());
  }
  const invalid = friendIds.filter((id) => !acceptedFriends.has(id));
  if (invalid.length) return json({ error: 'Some invitees are not your friends' }, 400);

  // A friend who switched the Together feature off can't be invited — they'd
  // never see the invite in-app and get no push, leaving the challenge stuck
  // forming. The client already greys them out; this is the server backstop.
  for (const fid of friendIds) {
    const { data: u } = await supabase.auth.admin.getUserById(fid);
    if (u?.user?.user_metadata?.together_enabled === false) {
      return json({ error: 'A selected friend isn’t on Together', code: 'INVITEE_OPTED_OUT' }, 400);
    }
  }

  // 4. Concurrency cap — how many challenges already occupy a slot for the creator
  //    (accepted, not completed, live)?
  const { data: openRows } = await supabase
    .from('shared_challenge_participants')
    .select('challenge_id, shared_challenges!inner(status)')
    .eq('user_id', user.id)
    .eq('state', 'accepted')
    .eq('completed', false)
    .in('shared_challenges.status', ['forming', 'active']);
  if ((openRows?.length ?? 0) >= challengeCap) {
    return json({ error: 'Challenge slots full — finish or drop one first', code: 'AT_CAP' }, 409);
  }

  // 5. Create the challenge (forming) + participants (creator accepted, friends invited).
  const nowIso = new Date().toISOString();
  const { data: challenge, error: cErr } = await supabase
    .from('shared_challenges')
    .insert({
      creator_id: user.id,
      kind: isPooled ? 'pooled' : 'parallel',
      template: {
        id: tmpl.id, category: tmpl.category, title: tmpl.title, tier: tmpl.tier,
        goal: tmpl.goal, base_points: tmpl.base_points, measure: tmpl.measure, mode: tmpl.mode,
        ...(isPooled ? { pool: { target: rule.target, unit: (rule as any).unit } } : {}),
      },
      rule,
      category: tmpl.category,
      base_points: tmpl.base_points,
      status: 'forming',
      duration_hours: durationHours,
      accept_by: new Date(Date.now() + acceptWindowHours * HOUR_MS).toISOString(),
      bonus_per_head: perHead,
      bonus_max: maxBonus,
      utc_offset_minutes: Number.isFinite(body.utc_offset_minutes) ? body.utc_offset_minutes : 0,
    })
    .select('id')
    .single();
  if (cErr || !challenge) {
    console.error('[create-shared-challenge] insert failed:', cErr);
    return json({ error: 'Failed to create challenge' }, 500);
  }

  const participantRows = [
    { challenge_id: challenge.id, user_id: user.id, state: 'accepted', joined_at: nowIso },
    ...friendIds.map((fid) => ({ challenge_id: challenge.id, user_id: fid, state: 'invited', invited_by: user.id })),
  ];
  const { error: pErr } = await supabase.from('shared_challenge_participants').insert(participantRows);
  if (pErr) {
    await supabase.from('shared_challenges').delete().eq('id', challenge.id); // compensate
    console.error('[create-shared-challenge] participants insert failed:', pErr);
    return json({ error: 'Failed to add participants' }, 500);
  }

  // 6. Invite pushes.
  const { data: me } = await supabase.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle();
  const fromName = me?.display_name || me?.username || 'A friend';
  for (const fid of friendIds) {
    await notifyPush(fid, 'challenge_invite', { challenge_id: challenge.id, from_name: fromName, title: tmpl.title });
  }

  return json({ ok: true, challenge_id: challenge.id });
});
