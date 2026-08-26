import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

// One fetch for "where am I on the ladder": the programme (rule set), its
// steps, which steps this creator has reached, and the basis count the steps
// are measured in. Shared by Overview (the journey hero) and Rewards (the
// full ladder) so the two never disagree about the next rung.
export function useCreatorProgram() {
    const { creatorData, isActingCreator } = useAuth();
    const creatorId = creatorData?.id;
    const programId = creatorData?.program_id;

    const [state, setState] = useState({
        loading: true,
        program: null,
        steps: [],
        reached: [],
        earnings: [],
        counts: { conversions: 0, signups: 0 },
        rewardTitles: {},
    });

    useEffect(() => {
        if (!creatorId) return;
        let cancelled = false;
        setState(s => ({ ...s, loading: true }));

        (async () => {
            // The programme RLS resolves "mine or the default" server-side for a
            // creator. Admin preview can read every programme, so pin it to the
            // creator being previewed.
            let progQ = supabase.from('creator_programs').select('*');
            if (isActingCreator) {
                progQ = programId ? progQ.eq('id', programId) : progQ.eq('is_default', true);
            }
            const [{ data: progs }, { data: m }, { data: e }, conv, sign] = await Promise.all([
                progQ.limit(1),
                supabase.from('creator_milestones').select('*').eq('creator_id', creatorId),
                supabase.from('creator_earnings').select('*').eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(100),
                supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('creator_id', creatorId).not('converted_at', 'is', null),
                supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('creator_id', creatorId),
            ]);
            if (cancelled) return;
            const program = progs?.[0] ?? null;

            let steps = [];
            let rewardTitles = {};
            if (program) {
                const { data: s } = await supabase
                    .from('creator_program_steps')
                    .select('*, creator_rewards(name, description, image_url, value_label, kind)')
                    .eq('program_id', program.id)
                    .eq('active', true)
                    .order('n');
                if (cancelled) return;
                steps = s ?? [];
                const ids = [...new Set(steps.map(x => x.reward_id).filter(Boolean))];
                if (ids.length) {
                    const { data: r } = await supabase.from('rewards').select('id, title, brand_name').in('id', ids);
                    if (cancelled) return;
                    rewardTitles = Object.fromEntries((r ?? []).map(x => [x.id, x.brand_name ? `${x.brand_name} — ${x.title}` : x.title]));
                }
            }

            setState({
                loading: false,
                program,
                steps,
                reached: m ?? [],
                earnings: e ?? [],
                counts: { conversions: conv.count ?? 0, signups: sign.count ?? 0 },
                rewardTitles,
            });
        })();

        return () => { cancelled = true; };
    }, [creatorId, isActingCreator, programId]);

    const { program, steps, reached, counts } = state;
    const reachedByStep = new Map(reached.map(m => [m.step_id, m]));
    const countsSignups = program?.step_counting === 'signups';
    const basis = countsSignups ? counts.signups : counts.conversions;
    const basisWord = countsSignups ? 'signups' : 'converted signups';
    const nextStep = steps.find(s => !reachedByStep.has(s.id) && s.n > basis) ?? null;
    const lastReached = [...steps].reverse().find(s => reachedByStep.has(s.id)) ?? null;
    const perConversion = creatorData?.conversion_points ?? program?.creator_conversion_points ?? 50;
    const totalPoints = state.earnings.reduce((sum, e) => sum + (e.points_amount ?? 0), 0);

    return {
        ...state,
        reachedByStep,
        basis,
        basisWord,
        nextStep,
        lastReached,
        perConversion,
        totalPoints,
    };
}

/** A step's headline: the catalogue reward's name, else the admin's label. */
export function stepName(step) {
    return step?.creator_rewards?.name ?? step?.label ?? 'Next reward';
}
