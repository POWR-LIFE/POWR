import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Link2, MonitorPlay, Pause, Play, RefreshCw, Trophy, Tv } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { boardUrl, gymSlug, newDisplayToken, VIEWINGS, VIEWING_LABEL } from '../../../../shared/gymBoard.ts';
import { LEAGUE_RADII, leagueUrl } from '../../../../shared/gymLeague.ts';

/**
 * "Big screen" tab on the admin partner profile — provisions and manages the
 * gym's weekly leaderboard display (powr.life/gym/<slug>?k=<token>).
 *
 * One row in gym_boards per partner. The slug is the URL, the token is the
 * credential: regenerating it kills every link previously sent to the gym.
 * Pausing keeps the row (and the slug) but the screen goes blank on its
 * next poll.
 *
 * The same row also carries the gym's second screen, the Gym League
 * (powr.life/league/<slug>?k=<token>): this gym racing every other POWR
 * gym, locally (within league_radius_km) and globally. Same token, its own
 * pause switch.
 */

const BOARD_SIZES = [10, 25, 50];

const randomBytes = (bytes) => crypto.getRandomValues(bytes);

export default function GymBoardPanel({ partner, adminId }) {
    const toast = useToast();
    const [board, setBoard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [slugDraft, setSlugDraft] = useState(gymSlug(partner.name || ''));

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            const { data, error } = await supabase.from('gym_boards').select('*').eq('partner_id', partner.id).maybeSingle();
            if (!alive) return;
            if (error) toast.error('Could not load the big-screen board');
            setBoard(data ?? null);
            setLoading(false);
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [partner.id]);

    const audit = async (action, metadata) => {
        if (!adminId) return;
        await supabase.from('admin_audit_log').insert({
            admin_id: adminId, action, target_type: 'partner', target_id: partner.id, metadata,
        });
    };

    const create = async () => {
        const slug = gymSlug(slugDraft);
        if (slug.length < 2) { toast.error('Slug needs at least two characters'); return; }
        setActing(true);
        const { data, error } = await supabase
            .from('gym_boards')
            .insert({ partner_id: partner.id, slug, created_by: adminId ?? null })
            .select('*')
            .single();
        setActing(false);
        if (error) {
            toast.error(error.code === '23505' ? 'That slug is taken by another gym — pick a different one' : 'Could not create the board');
            return;
        }
        setBoard(data);
        audit('gym_board_created', { slug });
        toast.success('Big-screen board created');
    };

    const update = async (patch, okMsg, action) => {
        setActing(true);
        const { data, error } = await supabase
            .from('gym_boards')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('partner_id', partner.id)
            .select('*')
            .single();
        setActing(false);
        if (error) { toast.error('Update failed'); return; }
        setBoard(data);
        if (action) audit(action, patch.display_token ? { rotated: true } : patch);
        if (okMsg) toast.success(okMsg);
    };

    const regenerate = async () => {
        if (!window.confirm('Regenerate the display token? Any link already open on the gym’s screen stops working immediately.')) return;
        await update({ display_token: newDisplayToken(randomBytes) }, 'Token regenerated — old links are dead', 'gym_board_token_rotated');
    };

    const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Copy failed'); }
    };

    const Btn = ({ icon: Icon, label, onClick, tone = 'neutral', disabled, href }) => {
        const tones = {
            neutral: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2]',
            primary: 'bg-[#1A1A1A] border-[#1A1A1A] text-white hover:bg-[#333333]',
            danger:  'bg-[#F43F5E]/10 border-[#F43F5E]/25 text-[#F43F5E] hover:bg-[#F43F5E]/15',
            gold:    'bg-[#E8D200]/15 border-[#E8D200]/40 text-[#8a7600] hover:bg-[#E8D200]/25',
        };
        const cls = `inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`;
        if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}><Icon size={13} /> {label}</a>;
        return <button onClick={onClick} disabled={disabled || acting} className={cls}><Icon size={13} /> {label}</button>;
    };

    if (loading) {
        return <div className="text-[11px] uppercase tracking-[0.3em] text-[#999999] font-black py-10">Loading…</div>;
    }

    // ── Not provisioned yet ──────────────────────────────────────────────
    if (!board) {
        return (
            <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden max-w-3xl">
                <div className="p-10 border-b border-[#E6E6E1]">
                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Big-screen leaderboard</h3>
                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Not set up for this gym</p>
                </div>
                <div className="p-10 space-y-6">
                    <p className="text-[13px] text-[#555555] leading-relaxed">
                        A weekly leaderboard of points earned at <span className="font-semibold text-[#1A1A1A]">{partner.name}</span>,
                        designed for a TV on the gym floor. Resets every Monday, shows last week&apos;s champion, and a QR code
                        for members to join. You send the gym one link; it refreshes itself. Creating it also unlocks the
                        <span className="font-semibold text-[#1A1A1A]"> Gym League</span> screen: this gym racing every other POWR gym.
                    </p>
                    <div>
                        <label className="block text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mb-2">URL slug</label>
                        <div className="flex items-center gap-3">
                            <span className="text-[12px] font-mono text-[#999999]">powr.life/gym/</span>
                            <input
                                value={slugDraft}
                                onChange={(e) => setSlugDraft(e.target.value)}
                                onBlur={() => setSlugDraft(gymSlug(slugDraft))}
                                className="flex-1 h-10 px-4 rounded-xl border border-[#E6E6E1] bg-[#F4F4F1] text-[13px] font-mono text-[#1A1A1A] outline-none focus:border-[#E8D200]"
                            />
                        </div>
                        <p className="text-[11px] text-[#999999] mt-2">Lower-case letters, numbers and dashes. It&apos;s baked into the link you send, so pick it once.</p>
                    </div>
                    <Btn icon={Tv} label={acting ? 'Creating…' : 'Create big-screen board'} tone="primary" onClick={create} />
                </div>
            </section>
        );
    }

    // ── Provisioned ──────────────────────────────────────────────────────
    // The copyable link is canonical (powr.life); Open/Preview use this
    // admin's own host so they work from localhost and branch previews.
    const url = boardUrl(board.slug, board.display_token);
    const here = typeof window !== 'undefined' ? window.location.origin : 'https://powr.life';
    const open = (preview) => boardUrl(board.slug, board.display_token, preview, here);
    const lUrl = leagueUrl(board.slug, board.display_token);
    const lOpen = (preview) => leagueUrl(board.slug, board.display_token, preview, here);
    const leagueOn = board.league_enabled !== false;
    const radius = board.league_radius_km ?? 15;
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
            <div className="lg:col-span-2 space-y-16">
                <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                    <div className="p-10 border-b border-[#E6E6E1] flex items-start justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Big-screen leaderboard</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">
                                {board.enabled ? 'Live — the screen updates every 12 seconds' : 'Paused — the screen is blank'}
                            </p>
                        </div>
                        <span className={`inline-flex items-center gap-2 h-8 px-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${board.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[#F4F4F1] text-[#888888] border border-[#E6E6E1]'}`}>
                            <span className={`w-2 h-2 rounded-full ${board.enabled ? 'bg-emerald-500' : 'bg-[#BBBBBB]'}`} />
                            {board.enabled ? 'Live' : 'Paused'}
                        </span>
                    </div>

                    <div className="p-10 space-y-8">
                        {/* Display URL */}
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Link2 size={13} className="text-[#888888]" />
                                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Big-screen display URL</span>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <code className="text-[12px] font-mono text-[#555555] bg-[#F4F4F1] border border-[#EAEAE5] rounded-lg px-3 py-2 select-all break-all">{url}</code>
                                <Btn icon={Copy} label="Copy" onClick={() => copy(url)} />
                                <Btn icon={ExternalLink} label="Open" href={open(null)} />
                                <Btn icon={RefreshCw} label="Regenerate token" tone="danger" onClick={regenerate} />
                            </div>
                            <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                                Send this to the gym. Open it in Chrome on the TV and press F11 for full screen — it scales to any
                                screen size and refreshes itself. The link can only show the board. Regenerating it stops any
                                previously shared link from working.
                            </p>
                        </div>

                        {/* Previews */}
                        <div className="border-t border-[#F0F0EC] pt-6">
                            <div className="flex items-center gap-2 mb-2">
                                <MonitorPlay size={13} className="text-[#888888]" />
                                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Preview the screen</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {[['sample', 'With sample members'], ['empty', 'Empty board']].map(([state, label]) => (
                                    <a
                                        key={state}
                                        href={open(state)}
                                        target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center h-7 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] transition-all bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                                    >
                                        {label}
                                    </a>
                                ))}
                                <span className="text-[10px] text-[#AAAAAA]">— badged PREVIEW; the real board is the plain link.</span>
                            </div>
                        </div>

                        {/* Viewing distance */}
                        <div className="border-t border-[#F0F0EC] pt-6">
                            <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">Viewing distance</span>
                            <div className="flex items-stretch gap-2 flex-wrap">
                                {VIEWINGS.map((v) => {
                                    const on = (board.viewing ?? 'standard') === v;
                                    return (
                                        <button
                                            key={v}
                                            type="button"
                                            disabled={acting}
                                            onClick={() => !on && update({ viewing: v }, `Viewing distance: ${VIEWING_LABEL[v].label}`, 'gym_board_viewing')}
                                            className={`text-left w-[15.5rem] rounded-xl border px-4 py-3 transition-all ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:border-[#D8D8D2]'}`}
                                        >
                                            <span className="block text-[10.5px] font-bold uppercase tracking-[0.18em]">{VIEWING_LABEL[v].label}</span>
                                            <span className={`block text-[11px] mt-1 leading-snug ${on ? 'text-white/70' : 'text-[#888888]'}`}>{VIEWING_LABEL[v].hint}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                                How far members stand from the screen. Further means bigger type and less on screen at once. The screen picks it up on its next refresh.
                            </p>
                        </div>

                        {/* Controls */}
                        <div className="border-t border-[#F0F0EC] pt-6 flex items-center gap-10 flex-wrap">
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">Status</span>
                                {board.enabled
                                    ? <Btn icon={Pause} label="Pause board" onClick={() => update({ enabled: false }, 'Board paused — the screen goes blank on its next refresh', 'gym_board_paused')} />
                                    : <Btn icon={Play} label="Resume board" tone="gold" onClick={() => update({ enabled: true }, 'Board live', 'gym_board_resumed')} />}
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">Board size</span>
                                <div className="flex items-center gap-2">
                                    {BOARD_SIZES.map((n) => (
                                        <button
                                            key={n}
                                            disabled={acting}
                                            onClick={() => n !== board.board_size && update({ board_size: n }, null, 'gym_board_size')}
                                            className={`h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all ${board.board_size === n ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:border-[#D8D8D2]'}`}
                                        >
                                            Top {n}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── Gym League: the second screen on the same credential ── */}
                <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                    <div className="p-10 border-b border-[#E6E6E1] flex items-start justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Gym League</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">
                                {leagueOn ? 'Live — this gym racing every POWR gym' : 'Paused — the league screen is blank'}
                            </p>
                        </div>
                        <span className={`inline-flex items-center gap-2 h-8 px-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${leagueOn ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[#F4F4F1] text-[#888888] border border-[#E6E6E1]'}`}>
                            <span className={`w-2 h-2 rounded-full ${leagueOn ? 'bg-emerald-500' : 'bg-[#BBBBBB]'}`} />
                            {leagueOn ? 'Live' : 'Paused'}
                        </span>
                    </div>
                    <div className="p-10 space-y-8">
                        <p className="text-[13px] text-[#555555] leading-relaxed">
                            A second screen for the gym: <span className="font-semibold text-[#1A1A1A]">{partner.name}</span> against every
                            other POWR gym on points earned this week — first the gyms nearby, then the whole network, then points per athlete,
                            then a head-to-head with the gym directly above. Every session that lands anywhere on POWR moves it. Same link key as the leaderboard.
                        </p>
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Trophy size={13} className="text-[#888888]" />
                                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Gym League display URL</span>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <code className="text-[12px] font-mono text-[#555555] bg-[#F4F4F1] border border-[#EAEAE5] rounded-lg px-3 py-2 select-all break-all">{lUrl}</code>
                                <Btn icon={Copy} label="Copy" onClick={() => copy(lUrl)} />
                                <Btn icon={ExternalLink} label="Open" href={lOpen(null)} />
                                <a
                                    href={lOpen('sample')}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center h-7 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] transition-all bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                                >
                                    Preview with simulated sessions
                                </a>
                            </div>
                            <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                                Regenerating the leaderboard token above also changes this link. Real gyms are quiet until they have
                                members training — the preview runs a simulated feed on real gym names so you can see it move.
                            </p>
                        </div>
                        <div className="border-t border-[#F0F0EC] pt-6 flex items-start gap-10 flex-wrap">
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">Local lens</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {LEAGUE_RADII.map((km) => (
                                        <button
                                            key={km}
                                            disabled={acting}
                                            onClick={() => km !== radius && update({ league_radius_km: km }, `Local lens: gyms within ${km} km`, 'gym_league_radius')}
                                            className={`h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all ${radius === km ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:border-[#D8D8D2]'}`}
                                        >
                                            {km} km
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[11px] text-[#999999] mt-2 leading-relaxed max-w-xl">
                                    Gyms within this distance of {partner.name} make up the &ldquo;Local&rdquo; race. Pick a radius that
                                    catches real neighbours — a city needs 10–15 km, a town 25–50.
                                </p>
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">Status</span>
                                {leagueOn
                                    ? <Btn icon={Pause} label="Pause league" onClick={() => update({ league_enabled: false }, 'League paused — the screen goes blank on its next refresh', 'gym_league_paused')} />
                                    : <Btn icon={Play} label="Resume league" tone="gold" onClick={() => update({ league_enabled: true }, 'League live', 'gym_league_resumed')} />}
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <div className="space-y-16">
                <section className="bg-white border border-[#E6E6E1] p-10 rounded-[2rem]">
                    <h3 className="text-base font-black uppercase tracking-[0.3em] text-[#555555] mb-10">How it scores</h3>
                    <div className="space-y-4 text-[12px] text-[#555555] leading-relaxed">
                        <p>Points from verified sessions <span className="font-semibold text-[#1A1A1A]">at this gym</span> — the same earn, adjustment and penalty rows as the app&apos;s weekly board. Streak and referral bonuses don&apos;t buy rank.</p>
                        <p>The week runs Monday 00:00 → Sunday 23:59 in <span className="font-mono text-[11px]">{board.tz}</span>. Arrows show places moved since the day began.</p>
                        <p>Only members with &ldquo;show on leaderboard&rdquo; on appear. Names and avatars come from their POWR profile.</p>
                        <p>The Gym League adds up the same points per gym across every gym where someone has earned points in the last 28 days. Totals are the race; a second table ranks <span className="font-semibold text-[#1A1A1A]">points per athlete</span> (three athletes minimum) so a small gym can beat a chain on effort.</p>
                    </div>
                </section>
                <section className="bg-white border border-[#E6E6E1] p-10 rounded-[2rem]">
                    <h3 className="text-base font-black uppercase tracking-[0.3em] text-[#555555] mb-10">Board data</h3>
                    <div className="space-y-6">
                        {[
                            { label: 'Slug', value: board.slug },
                            { label: 'Created', value: new Date(board.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
                            { label: 'Timezone', value: board.tz },
                        ].map((x) => (
                            <div key={x.label} className="flex items-center justify-between p-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#666666] font-black">{x.label}</span>
                                <span className="text-[11px] font-medium text-[#888888] font-mono">{x.value}</span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
