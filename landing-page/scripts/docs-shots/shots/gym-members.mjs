// /docs/gyms/members: Members (Clash+), the members who share with the gym
// (Clash Pro) and Retention. Retention's "Can't see" card explains itself in
// terms of how visits are counted, so it's always taken out of the picture,
// and nobody in the fixtures has the location wording on their row.
import core from '../fixtures/gym-core.mjs';
import { RETENTION } from '../fixtures/gym-members.mjs';
import { OWNER } from '../world.mjs';

/**
 * A marker on the words themselves rather than their (often full-width) box:
 * an invisible probe laid over the element's own text, so anchor 'right' lands
 * just after the last word. Probes live on <body>, outside the React tree.
 */
export function words(text, { nth = 0, within, exact = false, anchor = 'right', dx = 16, dy = 0 } = {}) {
    return Object.assign(async (page) => {
        const handle = await page.evaluateHandle((s) => {
            const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const want = norm(s.text);
            const root = s.within ? document.querySelector(s.within) : document.body;
            if (!root) return null;
            const texts = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
            const own = (el) => norm(texts(el).map((n) => n.textContent).join(' '));
            const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
            const hits = [...root.querySelectorAll('*')].filter((el) => visible(el) && (s.exact ? own(el) === want : own(el).includes(want)));
            const el = hits[s.nth];
            if (!el) return null;
            const nodes = texts(el);
            const range = document.createRange();
            range.setStartBefore(nodes[0]);
            range.setEndAfter(nodes[nodes.length - 1]);
            const r = range.getBoundingClientRect();
            const probe = document.createElement('div');
            probe.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;visibility:hidden;pointer-events:none`;
            document.body.appendChild(probe);
            return probe;
        }, { text, nth, within: within ?? null, exact });
        const el = handle.asElement();
        if (!el) throw new Error(`no words "${text}"`);
        return el;
    }, { anchor, dx, dy });
}

/**
 * Every prepare starts here: the page's own confirm dialogs (Send nudge, Nudge
 * everyone) are accepted, as a click on OK would. (capture.mjs stubs Vite's
 * dev client, so other runs rewriting shots.json no longer reload the page.)
 */
export async function steady(page) {
    if (page.__steady) return;
    page.__steady = true;
    page.on('dialog', (d) => d.accept().catch(() => {}));
}

/**
 * A target (or marker) that is the box around several parts of the page at
 * once, e.g. two cards one above the other: a probe on <body> laid over the
 * union of every element found. Each part is { text, closest, exact, nth }.
 */
export function around(...parts) {
    return async (page) => {
        const handle = await page.evaluateHandle((list) => {
            const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const own = (el) => norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
            const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
            const boxes = list.map((s) => {
                const want = norm(s.text);
                const hits = [...document.body.querySelectorAll('*')].filter((el) => visible(el) && (s.exact ? own(el) === want : own(el).includes(want)));
                let el = hits[s.nth ?? 0];
                if (!el) return null;
                if (s.closest) el = el.closest(s.closest) ?? el;
                return el.getBoundingClientRect();
            });
            if (boxes.some((b) => !b)) return null;
            const x0 = Math.min(...boxes.map((b) => b.left)), y0 = Math.min(...boxes.map((b) => b.top));
            const x1 = Math.max(...boxes.map((b) => b.right)), y1 = Math.max(...boxes.map((b) => b.bottom));
            const probe = document.createElement('div');
            probe.style.cssText = `position:absolute;left:${x0 + scrollX}px;top:${y0 + scrollY}px;width:${x1 - x0}px;height:${y1 - y0}px;visibility:hidden;pointer-events:none`;
            document.body.appendChild(probe);
            return probe;
        }, parts);
        const el = handle.asElement();
        if (!el) throw new Error(`couldn’t find all of: ${parts.map((p) => p.text).join(', ')}`);
        return el;
    };
}

// Members asks for 12 weeks of visits; the shared fixture keeps 9. Three
// earlier, quieter weeks fill the chart out to what the page really draws.
const coreInsights = core.rpc.gym_insights;
const insights12 = (args) => {
    const out = coreInsights(args);
    const want = Math.min(26, args?.p_weeks ?? 8);
    const earlier = [[158, 52, 2], [161, 53, 4], [166, 54, 3]].slice(-(want - out.weeks.length));
    const first = Date.parse(out.weeks[0].week_start);
    const pad = earlier.map(([sessions, athletes, fresh], i) => ({
        week_start: new Date(first - (earlier.length - i) * 7 * 864e5).toISOString(),
        sessions, athletes, new_athletes: fresh, minutes: sessions * 57, points: sessions * 19,
    }));
    return { ...out, weeks: [...pad, ...out.weeks] };
};
const MEMBERS_FIX = { rpc: { gym_insights: insights12 } };

// Send nudge, accepted: from then on Retention shows Zoe V. as nudged today,
// with POWR's push at the top of what the team did. A fresh state per shot.
function afterNudge() {
    let sent = false;
    return {
        rpc: {
            gym_nudge_quiet: (a) => { if (a.p_user_id && !a.p_dry_run) sent = true; return core.rpc.gym_nudge_quiet(a); },
            gym_retention: () => (!sent ? RETENTION : {
                ...RETENTION,
                people: RETENTION.people.map((p) => (p.display_name !== 'Zoe V.' ? p : {
                    ...p,
                    nudged_at: new Date().toISOString(),
                    outreach: [{ id: '6f1d2c3b-0000-4000-8000-0000000c0998', at: new Date().toISOString(), channel: 'push', note: null, by: OWNER.name, mine: true }, ...p.outreach],
                })),
            }),
        },
    };
}

// Retention's Can't see card: removed from the layout (not just hidden), so
// the Won back card stands on its own.
const dropCantSee = async (page) => {
    await steady(page);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('div')) {
            const micro = el.firstElementChild;
            if (micro && micro.textContent.trim() === 'Can’t see' && el.querySelector(':scope > p')) el.style.display = 'none';
        }
    });
};

export default [
    // The page itself: the count, the four numbers, the weekly chart and the board.
    {
        id: 'gym-members-page',
        portal: 'gym',
        path: '/venue/members',
        fixtures: MEMBERS_FIX,
        ready: 'On the board this week',
        prepare: steady,
        settle: 1200,
        markers: {
            total: words('as their gym', { dx: 30 }),
            facts: words('Active', { exact: true, dx: 30 }),
            // Just left of the drifting number: its label and note fill the column to its right.
            drifting: words('7', { exact: true, within: 'main a[href="/venue/retention"]', anchor: 'left', dx: -26 }),
            chart: words('People who trained here each week', { dx: 30 }),
            board: { text: 'On the board this week', closest: '.rounded-\\[2rem\\],[class*="rounded"]', anchor: 'tr', dx: -26, dy: 26 },
        },
    },
    // What they do, where, how often and when.
    {
        id: 'gym-members-charts',
        portal: 'gym',
        path: '/venue/members',
        fixtures: MEMBERS_FIX,
        ready: 'When they come here',
        viewport: { width: 1280, height: 1900 },
        prepare: steady,
        target: { text: 'What they do', exact: true, closest: '.grid' },
        pad: 16,
        settle: 1200,
        markers: {
            what: words('What they do', { exact: true, dx: 26 }),
            where: words('At this gym', { exact: true, dx: 24 }),
            days: words('5 or more days', { exact: true, dx: 24 }),
            when: words('When they come here', { exact: true, dx: 24 }),
            day: words('By day', { exact: true }),
        },
    },
    // Members who share with you: the top of the list (quiet and slowing come first).
    {
        id: 'gym-members-sharing',
        portal: 'gym',
        path: '/venue/members',
        fixtures: MEMBERS_FIX,
        ready: 'Members who share with you',
        viewport: { width: 1280, height: 2800 },
        prepare: async (page) => {
            await steady(page);
            // Four rows tell the story (quiet, slowing, active, in the list's
            // own order); the other nineteen are more of the same.
            await page.evaluate(() => {
                const head = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'Members who share with you');
                const card = head?.closest('[class*="rounded"]');
                const rows = card?.querySelector('.divide-y');
                [...(rows?.children ?? [])].forEach((r, i) => { if (![0, 2, 5, 6].includes(i)) r.style.display = 'none'; });
            });
        },
        target: { text: 'Members who share with you', exact: true, closest: '[class*="rounded-"]' },
        pad: 16,
        settle: 1200,
        markers: {
            count: words('of 142 member', { dx: 26 }),
            filters: { text: 'Slowing everywhere · 3', closest: 'button', anchor: 'right', dx: 22 },
            label: { text: 'Quiet everywhere', exact: true, nth: 0, anchor: 'right', dx: 24 },
            id: words('POWR ID', { nth: 0, dx: 26 }),
            days: words('in the last 2 weeks', { nth: 0, dx: 26 }),
            top: { text: 'Gym session · 2', closest: 'span', anchor: 'right', dx: 24 },
        },
    },

    // Retention: the count, the status counts, the 12-week chart and Won back.
    {
        id: 'gym-retention-top',
        portal: 'gym',
        path: '/venue/retention',
        ready: 'drifting from their usual visits',
        viewport: { width: 1280, height: 1300 },
        prepare: dropCantSee,
        target: { text: 'drifting from their usual visits', closest: '.grid' },
        pad: 16,
        settle: 1200,
        markers: {
            big: words('drifting from their usual visits', { dx: 26 }),
            counts: words('On track', { exact: true, dx: 26 }),
            chart: words('Drifting each week', { dx: 26 }),
            wonback: words('Won back', { exact: true, dx: 26 }),
            nudge: { text: 'Nudge 6', closest: 'button', anchor: 'right', dx: 24 },
        },
    },
    // The named list, on the Drifting tab it opens on.
    {
        id: 'gym-retention-list',
        portal: 'gym',
        path: '/venue/retention',
        ready: 'Zoe V.',
        viewport: { width: 1280, height: 2000 },
        prepare: dropCantSee,
        target: { text: 'Drifting · 7', closest: '[class*="rounded-"]:not(button)' },
        pad: 16,
        settle: 1200,
        markers: {
            tabs: { text: 'Everyone · 158', closest: 'button', anchor: 'right', dx: 24 },
            find: Object.assign((page) => page.$('label:has(input[aria-label="Find someone"])'), { anchor: 'right', dx: -22 }),
            line: words('Usually 3× a week, evenings', { dx: 26 }),
            chip: { text: 'days quiet', closest: 'span', anchor: 'left', dx: -22 },
            reached: words('Called', { anchor: 'bottom', dy: 14 }),
        },
    },
    // One person opened: their visits, their normal, the reach-out log and the nudge.
    {
        id: 'gym-retention-person',
        portal: 'gym',
        path: '/venue/retention',
        ready: 'Zoe V.',
        viewport: { width: 1280, height: 2000 },
        prepare: async (page, h) => {
            await dropCantSee(page);
            await h.click({ text: 'Zoe V.', closest: 'button' });
            await h.click({ text: 'Called', exact: true, closest: 'button' });
            await h.type('input[placeholder="A note for the team (optional)"]', 'Got through. Knee’s fine, back Monday.');
        },
        target: { text: 'Zoe V.', closest: 'li' },
        pad: 12,
        settle: 1200,
        markers: {
            visits: { text: 'Today', exact: true, closest: 'figure', anchor: 'left', dx: -24 },
            usual: words('Usual gap', { dx: 24 }),
            log: words('Log a reach-out', { dx: 26 }),
            nudge: { text: 'Send nudge', closest: 'button', anchor: 'left', dx: -20 },
            team: words('What the team did', { dx: 26 }),
        },
    },
    // After Send nudge (the browser asks to confirm first): the row says when, and the push is on the record.
    {
        id: 'gym-retention-nudged',
        portal: 'gym',
        path: '/venue/retention',
        fixtures: afterNudge(),
        ready: 'Zoe V.',
        viewport: { width: 1280, height: 2000 },
        prepare: async (page, h) => {
            await dropCantSee(page);
            await h.click({ text: 'Zoe V.', closest: 'button' });
            await h.click({ text: 'Send nudge', closest: 'button' });
            await h.wait('Nudged today');
        },
        target: { text: 'Log a reach-out', exact: true, up: 2 },
        pad: 12,
        settle: 3500,
        markers: {
            nudged: words('Nudged today', { anchor: 'top', dy: -14 }),
            push: { text: 'POWR nudge', exact: true, closest: 'li', anchor: 'right', dx: -16 },
        },
    },
];
