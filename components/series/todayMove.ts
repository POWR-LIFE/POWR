import type { NextMove } from '@/lib/drop';
import { firstName, fmt, type Rival } from '@/lib/dev/seriesPrototype';
import i18n from '@/lib/i18n';

/** One action and what it does. Home's Drop card and the League say the same thing. */
export type TodayMove = {
    /** The action, in gold: "Walk 18 min", "12 active min", "65 pts". */
    head: string;
    /** What it does: "opens today’s Drop · passes Ravi". */
    tail: string;
    /** The action also takes you past your rival (sample estimate; never claimed on live data). */
    passes: boolean;
    /** Your rival's first name, for the Home card's short form. */
    who: string;
    sealed: boolean;
};

/**
 * THE next move. While today's Drop is still sealed the action is the Drop's
 * quicker route, and the line says what else it does: passes your rival when
 * the points it earns would cover the gap (`gain`, null when we can't say).
 * Once the Drop is open the next move is your rival.
 */
export function todayMove(drop: NextMove | null, rival: Rival | null, gain: number | null): TodayMove | null {
    const who = rival ? firstName(rival.p.name) : '';
    const sealed = !!rival?.sealed;
    if (drop && drop.minutes > 0) {
        const head = drop.route === 'steps' ? i18n.t('series:move.walk', { minutes: drop.minutes }) : drop.left;
        // In Blind Mode nobody knows who they'd pass.
        const chasing = rival && !rival.ahead && !sealed;
        const passes = !!chasing && gain != null && gain >= rival.gap;
        const tail = chasing
            ? (passes
                ? i18n.t('series:move.opensPasses', { name: who })
                : i18n.t('series:move.opensBehind', { count: rival.gap, name: who, gap: fmt(rival.gap) }))
            : i18n.t('series:move.opensDrop');
        return { head, tail, passes, who, sealed };
    }
    if (sealed) {
        return { head: i18n.t('series:move.darkHead'), tail: i18n.t('series:move.darkTail'), passes: false, who, sealed: true };
    }
    if (rival) {
        return {
            head: i18n.t('series:move.headPts', { gap: fmt(rival.gap) }),
            tail: rival.ahead
                ? i18n.t('series:move.clearOf', { name: rival.p.name, how: rival.how })
                : rival.friend
                    ? i18n.t('series:move.toPassFriend', { name: rival.p.name, how: rival.how })
                    : i18n.t('series:move.toPass', { name: rival.p.name, how: rival.how }),
            passes: false,
            who,
            sealed: false,
        };
    }
    return null;
}

/** The rival card's one bar: what today did to the gap. */
export type GapToday = { label: string; value: string; fill: number; tone: 'gold' | 'green' | 'grey' };

/**
 * Today against the gap, so the card can't say you're winning today while the
 * number says you're behind. `net` = what you gained on them today; this
 * morning's gap is the gap now plus that. Gaining fills gold (chasing) or green
 * (ahead) with the share of the gap you moved today; losing ground fills grey
 * (the card puts the number in red, never a red bar on Home).
 */
export function gapToday(r: Rival, first = firstName(r.p.name)): GapToday {
    if (r.sealed) return { label: i18n.t('series:move.gapClosed'), value: '?', fill: 0, tone: 'gold' };
    const net = r.meToday - r.p.today;
    const pts = (n: number) => i18n.t('series:move.pts', { count: n, n: fmt(n) });
    const part = (n: number, of: number) => Math.min(1, n / Math.max(1, of));
    // Their lead now (+) or yours (-), and this morning.
    const lead = r.ahead ? -r.gap : r.gap;
    const morning = lead + net;
    if (net >= 0) {
        if (lead > 0) return { label: i18n.t('series:move.gapClosed'), value: pts(net), fill: part(net, morning), tone: 'gold' };
        if (net === 0) return { label: i18n.t('series:move.leadHeld'), value: pts(0), fill: 0, tone: 'green' };
        return morning > 0
            ? { label: i18n.t('series:move.youPassed', { name: first }), value: `+${pts(net)}`, fill: 1, tone: 'green' }
            : { label: i18n.t('series:move.leadGrew'), value: `+${pts(net)}`, fill: part(net, r.gap), tone: 'green' };
    }
    const lost = -net;
    if (lead > 0) {
        return morning < 0
            ? { label: i18n.t('series:move.theyPassed', { name: first }), value: `+${pts(lost)}`, fill: 1, tone: 'grey' }
            : { label: i18n.t('series:move.gapGrew'), value: `+${pts(lost)}`, fill: part(lost, r.gap), tone: 'grey' };
    }
    return { label: i18n.t('series:move.theyClosed', { name: first }), value: pts(lost), fill: part(lost, -morning), tone: 'grey' };
}
