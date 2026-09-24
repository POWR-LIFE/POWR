import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Pause, Play, RefreshCw, Trophy, Tv, MonitorPlay } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, BTN_GOLD, INPUT, LABEL } from '../../components/portal/ui';
import { fetchGymSummary, setupGymScreens, updateGymScreens } from './venueApi';
import { boardUrl, gymSlug, VIEWINGS, VIEWING_LABEL } from '../../../../shared/gymBoard.ts';
import { LEAGUE_RADII, leagueUrl } from '../../../../shared/gymLeague.ts';

// The gym's two TV screens, run by the gym: the weekly leaderboard
// (powr.life/gym/<slug>?k=) and the Gym League (/league/<slug>?k=). Same
// gym_boards row and link key the admin panel manages; every change goes
// through gym_board_setup / gym_board_update, which check the caller is on
// this gym's team. Only an owner can switch the screens on or change the key.

const BOARD_SIZES = [10, 25, 50];

const pill = (on) =>
    `h-10 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.18em] transition-all disabled:opacity-40 ${
        on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]'
    }`;

function Action({ icon: Icon, label, onClick, href, tone = 'neutral', disabled }) {
    const tones = {
        neutral: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]',
        danger: 'bg-white border-red-500/20 text-red-500/70 hover:text-red-500 hover:border-red-500/40',
        gold: 'bg-[#E8D200]/15 border-[#E8D200]/40 text-[#8a7600] hover:bg-[#E8D200]/25',
    };
    const cls = `inline-flex items-center gap-2 h-10 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.18em] transition-all disabled:opacity-40 ${tones[tone]}`;
    if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}><Icon size={13} /> {label}</a>;
    return <button type="button" onClick={onClick} disabled={disabled} className={cls}><Icon size={13} /> {label}</button>;
}

function Live({ on, onLabel = 'Live', offLabel = 'Paused' }) {
    return (
        <span className={`inline-flex items-center gap-2 h-8 px-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${on ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[#F4F4F1] text-[#888] border border-[#E6E6E1]'}`}>
            <span className={`w-2 h-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-[#BBBBBB]'}`} />
            {on ? onLabel : offLabel}
        </span>
    );
}

export default function VenueScreens() {
    const { gym } = useAuth();
    const toast = useToast();
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState(null);
    const [acting, setActing] = useState(false);
    const [slugDraft, setSlugDraft] = useState(gymSlug(gym.name || ''));

    useEffect(() => {
        let alive = true;
        fetchGymSummary(gym.partner_id)
            .then(s => { if (alive) setSummary(s); })
            .catch(err => { if (alive) setError(err.message); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Empty title="Couldn't load your screens">{error}</Empty>;
    if (!summary) return <Spinner />;

    const board = summary.board;
    const canOwn = summary.role === 'owner' || summary.role === 'admin';

    const run = async (fn, ok) => {
        setActing(true);
        try {
            const next = await fn();
            setSummary(s => ({ ...s, board: next }));
            if (ok) toast.success(ok);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setActing(false);
        }
    };
    const update = (patch, ok) => run(() => updateGymScreens(gym.partner_id, patch), ok);

    const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); toast.success('Link copied'); } catch { toast.error('Copy failed'); }
    };

    // ── Not switched on yet ───────────────────────────────────────────────
    if (!board) {
        return (
            <Page>
                <PageTitle eyebrow="Screens" title="Your gym on the big screen" />
                <Card className="p-6 sm:p-10 max-w-3xl" glow>
                    <p className="text-[15px] text-[#555] font-light leading-relaxed">
                        A weekly leaderboard of points earned at {summary.gym?.name ?? gym.name}, made for a TV on the gym floor.
                        It resets every Monday, shows last week’s champion and carries a QR code so members can join.
                        Switching it on also gives you the <span className="font-semibold text-[#1A1A1A]">Gym League</span>: your gym racing every other POWR gym.
                    </p>
                    {canOwn ? (
                        <div className="mt-8 space-y-4">
                            <div>
                                <label className={LABEL}>Your screen link</label>
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-[13px] font-mono text-[#999]">powr.life/gym/</span>
                                    <input
                                        value={slugDraft}
                                        onChange={e => setSlugDraft(e.target.value)}
                                        onBlur={() => setSlugDraft(gymSlug(slugDraft))}
                                        className={`${INPUT} flex-1 min-w-[12rem] font-mono`}
                                    />
                                </div>
                                <p className="text-[11px] text-[#AAAAAA] mt-2">Lower-case letters, numbers and dashes. It’s part of the link you’ll open on the TV, so pick it once.</p>
                            </div>
                            <button
                                disabled={acting}
                                onClick={() => run(() => setupGymScreens(gym.partner_id, gymSlug(slugDraft)), 'Screens switched on')}
                                className={BTN_GOLD}
                            >
                                <Tv size={14} /> {acting ? 'Switching on…' : 'Switch on the screens'}
                            </button>
                        </div>
                    ) : (
                        <p className="mt-6 text-[13px] text-[#888]">Your gym’s owner can switch the screens on from here.</p>
                    )}
                </Card>
            </Page>
        );
    }

    // Copyable links are canonical (powr.life); Open/Preview use this page's
    // own host so they work from branch previews too.
    const here = window.location.origin;
    const bUrl = boardUrl(board.slug, board.display_token);
    const lUrl = leagueUrl(board.slug, board.display_token);
    const radius = board.league_radius_km ?? 15;

    const rotate = () => {
        if (!window.confirm('Change the screen link? Any TV showing the old link goes blank until you open the new one on it.')) return;
        update({ rotate_token: true }, 'New link made — open it on your TVs');
    };

    return (
        <Page>
            <PageTitle eyebrow="Screens" title="Your gym on the big screen" sub="Open a link in Chrome on the TV, press F11. It refreshes itself." />

            <Card className="p-6 sm:p-10">
                <div className="flex items-start justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-3">
                            <Tv size={16} className="text-[#8a7600]" />
                            <h2 className="text-2xl font-light tracking-tight">Weekly leaderboard</h2>
                        </div>
                        <p className="text-[12px] text-[#999] mt-2">Points earned at your gym, Monday to Sunday. Updates every few seconds.</p>
                    </div>
                    <Live on={board.enabled} />
                </div>

                <div className="space-y-8">
                    <div>
                        <Micro className="mb-3">Screen link</Micro>
                        <code className="block text-[12px] font-mono text-[#555] bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl px-4 py-3 break-all select-all">{bUrl}</code>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <Action icon={Copy} label="Copy" onClick={() => copy(bUrl)} />
                            <Action icon={ExternalLink} label="Open" href={boardUrl(board.slug, board.display_token, null, here)} />
                            <Action icon={MonitorPlay} label="Preview with sample members" href={boardUrl(board.slug, board.display_token, 'sample', here)} />
                        </div>
                        <p className="text-[11px] text-[#AAAAAA] mt-3 leading-relaxed">The link can only show the board. Keep it to your screens: anyone with it can open the board.</p>
                    </div>

                    <div className="border-t border-[#F0F0EC] pt-6">
                        <Micro className="mb-3">Viewing distance</Micro>
                        <div className="flex flex-wrap gap-2">
                            {VIEWINGS.map(v => {
                                const on = (board.viewing ?? 'standard') === v;
                                return (
                                    <button
                                        key={v}
                                        disabled={acting}
                                        onClick={() => !on && update({ viewing: v }, `Viewing distance: ${VIEWING_LABEL[v].label}`)}
                                        className={`text-left w-full sm:w-[15rem] rounded-2xl border px-4 py-3 transition-all ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555] hover:border-[#E8D200]/40'}`}
                                    >
                                        <span className="block text-[10px] font-black uppercase tracking-[0.18em]">{VIEWING_LABEL[v].label}</span>
                                        <span className={`block text-[11px] mt-1 leading-snug ${on ? 'text-white/70' : 'text-[#888]'}`}>{VIEWING_LABEL[v].hint}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="border-t border-[#F0F0EC] pt-6 flex flex-wrap gap-8">
                        <div>
                            <Micro className="mb-3">Board size</Micro>
                            <div className="flex gap-2">
                                {BOARD_SIZES.map(n => (
                                    <button key={n} disabled={acting} onClick={() => n !== board.board_size && update({ board_size: n }, `Showing the top ${n}`)} className={pill(board.board_size === n)}>
                                        Top {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <Micro className="mb-3">Leaderboard</Micro>
                            {board.enabled
                                ? <Action icon={Pause} label="Pause" disabled={acting} onClick={() => update({ enabled: false }, 'Paused — the screen goes blank on its next refresh')} />
                                : <Action icon={Play} label="Resume" tone="gold" disabled={acting} onClick={() => update({ enabled: true }, 'Leaderboard live')} />}
                        </div>
                    </div>
                </div>
            </Card>

            <Card className="p-6 sm:p-10">
                <div className="flex items-start justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-3">
                            <Trophy size={16} className="text-[#8a7600]" />
                            <h2 className="text-2xl font-light tracking-tight">Gym League</h2>
                        </div>
                        <p className="text-[12px] text-[#999] mt-2">Your gym against every other POWR gym this week: nearby first, then the whole network.</p>
                    </div>
                    <Live on={board.league_enabled !== false} />
                </div>

                <div className="space-y-8">
                    <div>
                        <Micro className="mb-3">Screen link</Micro>
                        <code className="block text-[12px] font-mono text-[#555] bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl px-4 py-3 break-all select-all">{lUrl}</code>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <Action icon={Copy} label="Copy" onClick={() => copy(lUrl)} />
                            <Action icon={ExternalLink} label="Open" href={leagueUrl(board.slug, board.display_token, null, here)} />
                            <Action icon={MonitorPlay} label="Preview with sample gyms" href={leagueUrl(board.slug, board.display_token, 'sample', here)} />
                        </div>
                    </div>

                    <div className="border-t border-[#F0F0EC] pt-6 flex flex-wrap gap-8">
                        <div>
                            <Micro className="mb-3">Nearby means within</Micro>
                            <div className="flex flex-wrap gap-2">
                                {LEAGUE_RADII.map(km => (
                                    <button key={km} disabled={acting} onClick={() => km !== radius && update({ league_radius_km: km }, `Nearby: gyms within ${km} km`)} className={pill(radius === km)}>
                                        {km} km
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#AAAAAA] mt-3 max-w-xl leading-relaxed">A city needs 10–15 km to catch real neighbours, a town 25–50.</p>
                        </div>
                        <div>
                            <Micro className="mb-3">League</Micro>
                            {board.league_enabled !== false
                                ? <Action icon={Pause} label="Pause" disabled={acting} onClick={() => update({ league_enabled: false }, 'League paused')} />
                                : <Action icon={Play} label="Resume" tone="gold" disabled={acting} onClick={() => update({ league_enabled: true }, 'League live')} />}
                        </div>
                    </div>
                </div>
            </Card>

            {canOwn && (
                <Card className="p-6 sm:p-8">
                    <Micro className="mb-3">Screen link key</Micro>
                    <p className="text-[13px] text-[#888] font-light leading-relaxed max-w-2xl">
                        Both links share one key. If a link has got out, make a new one: every TV on the old link goes blank until you open the new link on it.
                    </p>
                    <div className="mt-4">
                        <Action icon={RefreshCw} label="Make a new link" tone="danger" disabled={acting} onClick={rotate} />
                    </div>
                </Card>
            )}
        </Page>
    );
}
