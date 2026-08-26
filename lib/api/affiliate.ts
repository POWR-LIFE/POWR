import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * The in-app affiliate surface. Reads the SAME rows the web portal reads,
 * under the same RLS (current_creator_id() resolves the signed-in member's
 * creator_users link), so the two can never disagree. Everything here is
 * user-facing "Affiliate"; the identifiers stay creator_* on purpose.
 */

export const PORTAL_URL = 'https://powr.life/affiliate';

export interface AffiliateProfile {
    id: string;
    handle: string;
    code: string;
    display_name: string;
    avatar_url: string | null;
    status: 'active' | 'paused' | 'terminated';
    program_id: string | null;
    conversion_points: number | null;
    shipping_address: unknown | null;
}

export interface AffiliateFunnel {
    clicks: number;
    signups: number;
    converted: number;
    points_earned: number;
    click_to_signup: number | null;
    error?: string;
}

export interface AffiliateProgram {
    id: string;
    step_counting: 'conversions' | 'signups';
    creator_conversion_points: number;
    invitee_bonus_points: number;
    event_signup_points: number;
}

export interface AffiliateStep {
    id: string;
    n: number;
    label: string | null;
    points: number;
    creator_rewards: { name: string; description: string | null; image_url: string | null; value_label: string | null } | null;
}

export interface AffiliateOverview {
    profile: AffiliateProfile;
    funnel: AffiliateFunnel | null;
    program: AffiliateProgram | null;
    steps: AffiliateStep[];
    reachedStepIds: string[];
    conversions: number;
    signups: number;
}

/** null = this member is not an affiliate. */
export async function fetchAffiliateOverview(days = 30): Promise<AffiliateOverview | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: link, error: linkErr } = await supabase
        .from('creator_users')
        .select('creator_id, creators(*)')
        .eq('user_id', user.id)
        .maybeSingle();
    if (linkErr) throw linkErr;
    const profile = (link as { creators?: AffiliateProfile } | null)?.creators ?? null;
    if (!profile) return null;

    const [funnelRes, progRes, milestonesRes, convRes, signRes] = await Promise.all([
        supabase.rpc('creator_funnel', { p_days: days, p_creator_id: null }),
        supabase.from('creator_programs').select('id, step_counting, creator_conversion_points, invitee_bonus_points, event_signup_points').limit(1),
        supabase.from('creator_milestones').select('step_id').eq('creator_id', profile.id),
        supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('creator_id', profile.id).not('converted_at', 'is', null),
        supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('creator_id', profile.id),
    ]);

    const program = (progRes.data?.[0] as AffiliateProgram | undefined) ?? null;
    let steps: AffiliateStep[] = [];
    if (program) {
        const { data: s } = await supabase
            .from('creator_program_steps')
            .select('id, n, label, points, creator_rewards(name, description, image_url, value_label)')
            .eq('program_id', program.id)
            .eq('active', true)
            .order('n');
        steps = (s as unknown as AffiliateStep[]) ?? [];
    }

    return {
        profile,
        funnel: (funnelRes.data as AffiliateFunnel | null) ?? null,
        program,
        steps,
        reachedStepIds: (milestonesRes.data ?? []).map((m: { step_id: string }) => m.step_id),
        conversions: convRes.count ?? 0,
        signups: signRes.count ?? 0,
    };
}

export interface LadderPosition {
    basis: number;
    basisWord: string;
    next: AffiliateStep | null;
    from: number;
    pct: number;
    remaining: number;
}

/** Pure: where on the ladder they stand. Mirrors useCreatorProgram on the web. */
export function ladderPosition(o: Pick<AffiliateOverview, 'program' | 'steps' | 'reachedStepIds' | 'conversions' | 'signups'>): LadderPosition {
    const countsSignups = o.program?.step_counting === 'signups';
    const basis = countsSignups ? o.signups : o.conversions;
    const basisWord = countsSignups ? 'signups' : 'converted signups';
    const reached = new Set(o.reachedStepIds);
    const next = o.steps.find((s) => !reached.has(s.id) && s.n > basis) ?? null;
    const last = [...o.steps].reverse().find((s) => reached.has(s.id)) ?? null;
    const from = last?.n ?? 0;
    const pct = next ? Math.max(0, Math.min(100, ((basis - from) / Math.max(1, next.n - from)) * 100)) : 100;
    return { basis, basisWord, next, from, pct, remaining: next ? Math.max(0, next.n - basis) : 0 };
}

export function stepName(step: AffiliateStep | null): string {
    return step?.creator_rewards?.name ?? step?.label ?? 'Next reward';
}

export function affiliateLink(handle: string): string {
    return `https://powr.life/join/${handle}`;
}

export function affiliateShareText(code: string, handle: string): string {
    return `Get paid to train. Download POWR and use my code ${code} — ${affiliateLink(handle)}`;
}

/**
 * Open the web portal already signed in. Mints a one-time handoff ticket
 * (mint_portal_handoff → 90 s, single use, hashed at rest) and puts it in the
 * URL fragment; the portal trades it for a session. Falls back to the plain
 * URL if minting fails — a login form beats a dead button.
 */
export async function openAffiliatePortal(path = ''): Promise<void> {
    let url = `${PORTAL_URL}${path}`;
    try {
        const { data: ticket } = await supabase.rpc('mint_portal_handoff');
        if (typeof ticket === 'string' && /^[0-9a-f]{64}$/.test(ticket)) url = `${url}#h=${ticket}`;
    } catch { /* fall through to the plain URL */ }
    try {
        await WebBrowser.openBrowserAsync(url);
    } catch {
        Linking.openURL(url).catch(() => {});
    }
}
