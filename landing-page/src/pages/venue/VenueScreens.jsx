import React, { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Maximize2, MonitorPlay, Pause, Play, RefreshCw, Tv, CalendarClock } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, BTN_GOLD, INPUT, LABEL } from '../../components/portal/ui';
import { fetchGymSummary, setupGymScreens, updateGymScreens } from './venueApi';
import { boardUrl, gymSlug, VIEWINGS, VIEWING_LABEL } from '../../../../shared/gymBoard.ts';
import { LEAGUE_RADII, leagueUrl } from '../../../../shared/gymLeague.ts';

// The gym's two TV screens, shown AS screens: each one is the real board,
// live, playing inside a television on the page (the same link the TV
// opens, rendered at 1920×1080 and scaled to fit), with its controls
// beside it. Every change goes through gym_board_setup / gym_board_update,
// which check the caller is on this gym's team; only an owner can switch
// the screens on or change the link key.

const BOARD_SIZES = [10, 25, 50];

const pill = (on) =>
    `h-9 px-3.5 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-all disabled:opacity-40 ${
        on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]'
    }`;

function Action({ icon: Icon, label, onClick, href, tone = 'neutral', disabled }) {
    const tones = {
        neutral: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]',
        danger: 'bg-white border-red-500/20 text-red-500/70 hover:text-red-500 hover:border-red-500/40',
        gold: 'bg-[#E8D200] border-[#E8D200] text-[#080808] hover:-translate-y-0.5',
    };
    const cls = `inline-flex items-center gap-2 h-10 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-all disabled:opacity-40 ${tones[tone]}`;
    if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}><Icon size={13} /> {label}</a>;
    return <button type="button" onClick={onClick} disabled={disabled} className={cls}><Icon size={13} /> {label}</button>;
}

function LivePill({ on }) {
    return (
        <span className={`inline-flex items-center gap-2 h-7 px-3 rounded-full text-[9px] font-black uppercase tracking-[0.2em] ${on ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[#F4F4F1] text-[#888] border border-[#E6E6E1]'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-500 animate-pulse' : 'bg-[#BBBBBB]'}`} />
            {on ? 'Live' : 'Paused'}
        </span>
    );
}

/**
 * A television with the real screen playing inside it. The board pages are
 * authored at 1920×1080 and never shrink their type below a 9px root, so the
 * frame is rendered at full size and scaled down, which keeps it exact and
 * crisp. It is display only: the wall has nothing to click either.
 */
function Television({ src, title, paused, children }) {
    const ref = useRef(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const k = width / 1920;
    return (
        <div className="rounded-[26px] bg-[#101010] p-2.5 sm:p-3 shadow-[0_40px_70px_-40px_rgba(0,0,0,0.55)] border border-black/60">
            <div ref={ref} className="relative aspect-video overflow-hidden rounded-[14px] bg-black">
                {/* Behind the frame while it loads or reloads (switching to sample
                    data reloads it), so a dark moment reads as loading, not broken. */}
                {src && !paused && (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black uppercase tracking-[0.35em] text-white/25">Loading</div>
                )}
                {src && !paused && k > 0 && (
                    <iframe
                        src={src} title={title} tabIndex={-1} loading="lazy"
                        className="absolute top-0 left-0 border-0 pointer-events-none"
                        style={{ width: 1920, height: 1080, transform: `scale(${k})`, transformOrigin: 'top left' }}
                    />
                )}
                {children}
                {paused && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/40">
                        <Pause size={22} />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Paused</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/** The dark screen shown before the screens are switched on. */
function Teaser({ title, lines }) {
    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8" style={{ background: 'radial-gradient(ellipse at 50% 30%, #1c1a0a 0%, #0d0d0d 60%)' }}>
            <span className="w-9 h-9 rounded-[10px] bg-[#0d0d0d] border border-white/10 flex items-center justify-center text-[13px] font-black text-[#E8D200]">P</span>
            <div className="mt-4 text-[clamp(18px,3.2vw,34px)] font-extralight tracking-tight text-white">{title}</div>
            <div className="mt-2 text-[clamp(10px,1.2vw,13px)] uppercase tracking-[0.3em] font-black text-white/40">{lines}</div>
        </div>
    );
}

function Setting({ label, hint, children }) {
    return (
        <div>
            <Micro className="mb-2.5">{label}</Micro>
            {children}
            {hint && <p className="text-[11px] text-[#AAAAAA] mt-2.5 leading-relaxed">{hint}</p>}
        </div>
    );
}

/** One screen: the television, and beside it what it shows and how to change it. */
function ScreenRow({ eyebrow, title, blurb, live, src, sampleSrc, shortLink, copyLink, openHref, onPause, onResume, acting, children, sampleLabel }) {
    const [sample, setSample] = useState(false);
    return (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 lg:gap-8 items-start">
            <div>
                <Television src={sample ? sampleSrc : src} title={`${title}, as it shows on the TV`} paused={!live} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
                    <div className="flex items-center gap-3 min-w-0">
                        <LivePill on={live} />
                        <span className="text-[11px] font-mono text-[#999] truncate">{shortLink}</span>
                    </div>
                    <div className="inline-flex rounded-full bg-[#F4F4F1] border border-[#E6E6E1] p-0.5" role="radiogroup" aria-label="What the preview shows">
                        {[[false, 'Your gym'], [true, sampleLabel]].map(([v, l]) => (
                            <button key={String(v)} type="button" role="radio" aria-checked={sample === v} onClick={() => setSample(v)}
                                className={`h-7 px-3 rounded-full text-[9px] font-black uppercase tracking-[0.15em] transition-all ${sample === v ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'}`}>
                                {l}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <Card className="p-6 sm:p-7">
                <Micro gold>{eyebrow}</Micro>
                <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A] mt-2">{title}</h2>
                <p className="text-[12px] text-[#888] leading-relaxed mt-2">{blurb}</p>
                <div className="flex flex-wrap gap-2 mt-5">
                    <Action icon={ExternalLink} label="Open" href={openHref} tone="gold" />
                    <Action icon={Copy} label="Copy link" onClick={copyLink} />
                    {live
                        ? <Action icon={Pause} label="Pause" disabled={acting} onClick={onPause} />
                        : <Action icon={Play} label="Resume" disabled={acting} onClick={onResume} />}
                </div>
                <div className="mt-7 pt-6 border-t border-[#F0F0EC] space-y-6">{children}</div>
            </Card>
        </div>
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
    const gymName = summary.gym?.name ?? gym.name;

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

    // ── Not switched on yet: the television, dark, and the switch ─────────
    if (!board) {
        return (
            <Page>
                <PageTitle eyebrow="Screens" title="Your gym on the big screen" sub={gymName} />
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 lg:gap-8 items-start">
                    <Television title="Your leaderboard, before it's switched on">
                        <Teaser title={`${gymName} · this week`} lines="The weekly leaderboard, live on your TV" />
                    </Television>
                    <Card className="p-6 sm:p-8" glow>
                        <Micro gold>Two screens, one switch</Micro>
                        <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A] mt-2">Switch on your screens</h2>
                        <p className="text-[13px] text-[#666] font-light leading-relaxed mt-3">
                            A weekly leaderboard of points earned at {gymName}, made for a TV on the gym floor. It resets every Monday, shows last
                            week’s champion and carries a QR code so members can join. You also get the <span className="font-semibold text-[#1A1A1A]">Gym League</span>:
                            your gym racing every other POWR gym nearby.
                        </p>
                        {canOwn ? (
                            <div className="mt-7 space-y-4">
                                <div>
                                    <label className={LABEL}>Your screen link</label>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[12px] font-mono text-[#999]">powr.life/gym/</span>
                                        <input value={slugDraft} onChange={e => setSlugDraft(e.target.value)} onBlur={() => setSlugDraft(gymSlug(slugDraft))}
                                            className={`${INPUT} flex-1 min-w-[10rem] font-mono`} aria-label="Screen link name" />
                                    </div>
                                    <p className="text-[11px] text-[#AAAAAA] mt-2">Lower-case letters, numbers and dashes. It’s part of the link you’ll open on the TV, so pick it once.</p>
                                </div>
                                <button disabled={acting} onClick={() => run(() => setupGymScreens(gym.partner_id, gymSlug(slugDraft)), 'Screens switched on')} className={BTN_GOLD}>
                                    <Tv size={14} /> {acting ? 'Switching on…' : 'Switch on the screens'}
                                </button>
                            </div>
                        ) : (
                            <p className="mt-6 text-[13px] text-[#888]">Your gym’s owner can switch the screens on from here.</p>
                        )}
                    </Card>
                </div>
            </Page>
        );
    }

    // The televisions load this page's own host, so branch previews and
    // localhost show their own boards; the copied links are canonical.
    const here = window.location.origin;
    const bUrl = boardUrl(board.slug, board.display_token);
    const lUrl = leagueUrl(board.slug, board.display_token);
    const radius = board.league_radius_km ?? 15;
    const viewing = board.viewing ?? 'standard';
    const leagueLive = board.league_enabled !== false;

    const rotate = () => {
        if (!window.confirm('Change the screen link? Any TV showing the old link goes blank until you open the new one on it.')) return;
        update({ rotate_token: true }, 'New link made — open it on your TVs');
    };

    return (
        <Page>
            <PageTitle eyebrow="Screens" title="Your gym on the big screen" sub={gymName} />

            <ScreenRow
                eyebrow="Screen 1" title="Weekly leaderboard"
                blurb={`Points earned at ${gymName}, Monday to Sunday, with last week’s champion and a QR code to join. It changes scene by itself and updates every few seconds.`}
                live={board.enabled}
                src={boardUrl(board.slug, board.display_token, null, here)}
                sampleSrc={boardUrl(board.slug, board.display_token, 'sample', here)}
                sampleLabel="Sample members"
                shortLink={`powr.life/gym/${board.slug}`}
                copyLink={() => copy(bUrl)}
                openHref={boardUrl(board.slug, board.display_token, null, here)}
                onPause={() => update({ enabled: false }, 'Paused — the TV goes blank on its next refresh')}
                onResume={() => update({ enabled: true }, 'Leaderboard live')}
                acting={acting}
            >
                <Setting label="Viewing distance" hint={VIEWING_LABEL[viewing]?.hint}>
                    <div className="flex flex-wrap gap-2">
                        {VIEWINGS.map(v => (
                            <button key={v} disabled={acting} onClick={() => v !== viewing && update({ viewing: v }, `Viewing distance: ${VIEWING_LABEL[v].label}`)} className={pill(viewing === v)}>
                                {VIEWING_LABEL[v].label}
                            </button>
                        ))}
                    </div>
                </Setting>
                <Setting label="Board size">
                    <div className="flex flex-wrap gap-2">
                        {BOARD_SIZES.map(n => (
                            <button key={n} disabled={acting} onClick={() => n !== board.board_size && update({ board_size: n }, `Showing the top ${n}`)} className={pill(board.board_size === n)}>
                                Top {n}
                            </button>
                        ))}
                    </div>
                </Setting>
            </ScreenRow>

            <ScreenRow
                eyebrow="Screen 2" title="Gym League"
                blurb={`${gymName} against the gyms nearby this week, then the whole POWR network, with a head-to-head against the gym just above you.`}
                live={leagueLive}
                src={leagueUrl(board.slug, board.display_token, null, here)}
                sampleSrc={leagueUrl(board.slug, board.display_token, 'sample', here)}
                sampleLabel="Sample gyms"
                shortLink={`powr.life/league/${board.slug}`}
                copyLink={() => copy(lUrl)}
                openHref={leagueUrl(board.slug, board.display_token, null, here)}
                onPause={() => update({ league_enabled: false }, 'League paused')}
                onResume={() => update({ league_enabled: true }, 'League live')}
                acting={acting}
            >
                <Setting label="Nearby means within" hint="A city needs 10–15 km to catch real neighbours, a town 25–50.">
                    <div className="flex flex-wrap gap-2">
                        {LEAGUE_RADII.map(km => (
                            <button key={km} disabled={acting} onClick={() => km !== radius && update({ league_radius_km: km }, `Nearby: gyms within ${km} km`)} className={pill(radius === km)}>
                                {km} km
                            </button>
                        ))}
                    </div>
                </Setting>
            </ScreenRow>

            <Card className="p-6 sm:p-8">
                <Micro gold className="mb-5">Putting it on the TV</Micro>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        [MonitorPlay, 'Open the link', 'In the TV’s own browser, or cast a laptop tab to it. Copy the link from the screen you want.'],
                        [Maximize2, 'Go full screen', 'Press F11 (or the browser’s full-screen button). The board fits any size of screen.'],
                        [CalendarClock, 'Leave it running', 'It refreshes itself, changes scene, and starts a new week every Monday. Nothing to touch.'],
                    ].map(([Icon, t, body], i) => (
                        <div key={t} className="flex gap-4">
                            <span className="w-10 h-10 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#8a7600] shrink-0"><Icon size={16} /></span>
                            <div>
                                <div className="text-[13px] font-bold text-[#1A1A1A]"><span className="text-[#BBBBBB] mr-1.5">{i + 1}</span>{t}</div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-1">{body}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-6 pt-5 border-t border-[#F0F0EC] flex flex-wrap items-center justify-between gap-4">
                    <p className="text-[11px] text-[#AAAAAA] leading-relaxed max-w-xl">
                        Both links share one key, and a link can only show its board. Keep them to your screens: anyone with a link can open it.
                        {canOwn && ' If one has got out, make a new key: every TV on the old links goes blank until you open the new ones.'}
                    </p>
                    {canOwn && <Action icon={RefreshCw} label="Make a new link" tone="danger" disabled={acting} onClick={rotate} />}
                </div>
            </Card>
        </Page>
    );
}
