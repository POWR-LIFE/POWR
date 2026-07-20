import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import ScreenHeatmap, { HEATMAP_PALETTES } from '../../components/ScreenHeatmap';
import AppPreview, { PREVIEW_ROUTES } from '../../components/preview/AppPreview';
import {
    MousePointerClick, Eye, Users, Layers, ArrowRight, Clock,
    Smartphone, Flame, LogIn, LogOut, Route as RouteIcon, Download,
} from 'lucide-react';

// Sequential ramp for the day/hour grid: ONE hue, light to dark, because the
// cells encode magnitude. Empty is a neutral grey with no hue at all, so
// "nobody opened the app" never reads as "a few people did".
const HEAT_EMPTY = '#F0F0EC';
const HEAT_RAMP = ['#F5E469', '#E8D200', '#C4AF00', '#9C8A00', '#6F6200'];

const RANGES = [
    { key: '7d', label: '7D', days: 7 },
    { key: '30d', label: '30D', days: 30 },
    { key: '90d', label: '90D', days: 90 },
];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmt = (n) => (n ?? 0).toLocaleString();

const fmtDwell = (sec) => {
    if (sec == null) return '—';
    const s = Number(sec);
    if (s < 60) return `${Math.round(s)}s`;
    return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
};

// expo-router emits tab routes with a group segment on some platforms
// ('/(tabs)/progress') and without it on others. Everything on this page keys
// off the cleaned form so one screen is never counted as two.
const clean = (route) => {
    if (!route) return '';
    return route.replace(/\/\([^)]+\)/g, '') || '/';
};

const prettyRoute = (route) => {
    const c = clean(route);
    if (!c) return '—';
    const stripped = c.replace(/^\/+/, '');
    return stripped === '' ? 'Home' : stripped;
};

export default function UsageAnalytics() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30d');
    const [data, setData] = useState({
        overview: null, screens: [], flows: [], taps: [], byHour: [], paths: [], entries: [],
    });

    // Heatmap viewer
    const [selected, setSelected] = useState('/');
    const [heat, setHeat] = useState([]);
    const [heatLoading, setHeatLoading] = useState(false);
    const [radius, setRadius] = useState(26);
    const [intensity, setIntensity] = useState(1);
    const [showPoints, setShowPoints] = useState(false);
    const [showHeat, setShowHeat] = useState(true);
    const [palette, setPalette] = useState('inferno');
    const [exporting, setExporting] = useState(false);
    const previewRef = useRef(null);

    const days = RANGES.find((r) => r.key === range)?.days ?? 30;

    useEffect(() => { fetchUsage(); /* eslint-disable-next-line */ }, [range]);

    const fetchUsage = async () => {
        setLoading(true);
        try {
            // Every one of these is an aggregate computed in Postgres. Nothing
            // here selects raw app_events rows: that table grows by thousands a
            // week and an unbounded PostgREST select silently truncates at
            // 1000, which would quietly understate every number on this page.
            const [overview, screens, flows, taps, byHour, paths, entries] = await Promise.all([
                supabase.rpc('admin_usage_overview', { p_days: days }),
                supabase.rpc('admin_usage_screens', { p_days: days }),
                supabase.rpc('admin_usage_flows', { p_days: days, p_limit: 60 }),
                supabase.rpc('admin_usage_taps', { p_days: days, p_limit: 60 }),
                supabase.rpc('admin_usage_by_hour', { p_days: days }),
                supabase.rpc('admin_usage_paths', { p_days: days, p_steps: 4, p_limit: 20 }),
                supabase.rpc('admin_usage_entries', { p_days: days }),
            ]);

            // Fail SOFT, per query. These seven feed independent panels, and an
            // earlier version threw on the first error — so one broken RPC
            // blanked the entire page, KPIs included, which reads as "we have no
            // data" rather than "one panel is broken". Each panel now keeps
            // whatever it could load and the failures are named in the console.
            const named = { overview, screens, flows, taps, byHour, paths, entries };
            const broken = Object.entries(named).filter(([, r]) => r.error);
            if (broken.length > 0) {
                for (const [name, r] of broken) console.error(`[usage] ${name} failed:`, r.error.message);
                toast.error(`Usage: ${broken.map(([n]) => n).join(', ')} unavailable`);
            }

            setData({
                overview: overview.data || null,
                screens: screens.data || [],
                flows: flows.data || [],
                taps: taps.data || [],
                byHour: byHour.data || [],
                paths: paths.data || [],
                entries: entries.data || [],
            });
        } catch (e) {
            toast.error('Usage sync failed');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // Heat points for whichever screen is being inspected. Refetched per screen
    // rather than pulled in one go for all of them: this is the only query on
    // the page that returns rows-per-touch instead of an aggregate, so it is
    // kept as narrow as the current selection.
    const fetchHeat = useCallback(async (route, dayCount) => {
        setHeatLoading(true);
        try {
            const { data: rows, error } = await supabase.rpc('admin_usage_heatmap', {
                p_route: route, p_days: dayCount, p_limit: 4000,
            });
            if (error) throw error;
            setHeat(rows || []);
        } catch (e) {
            console.error(e);
            setHeat([]);
        } finally {
            setHeatLoading(false);
        }
    }, []);

    useEffect(() => { fetchHeat(selected, days); }, [selected, days, fetchHeat]);

    // Export the phone exactly as it appears — screen plus heat — as a PNG, so
    // a finding can leave the panel and go into a deck or a ticket.
    //
    // Rasterised at 3× because the preview is displayed well below the device's
    // true 390×844: exporting at the on-screen size would hand back an image
    // blurrier than what the admin is looking at.
    const downloadPng = useCallback(async () => {
        if (!previewRef.current) return;
        setExporting(true);
        try {
            const opts = {
                pixelRatio: 3,
                // The screen is dark and its corners are rounded; matching the
                // app background keeps the corners from exporting as white
                // fringes.
                backgroundColor: '#060606',
                // Outfit is served from Google Fonts, and a cross-origin
                // stylesheet's rules cannot be read to inline them — the
                // attempt throws a SecurityError and poisons the whole render.
                // The Ionicons face is same-origin and inlines fine, so the
                // export keeps its glyphs; body text falls back one step.
                skipFonts: true,
            };

            // Rendered twice on purpose. html-to-image builds an <img> from a
            // serialised SVG, and on a first call the browser frequently
            // rasterises it before the inlined sub-resources have decoded — the
            // result is a picture of the background with the entire UI missing,
            // which is exactly what this produced until the second pass was
            // added. The first call primes the cache; the second is the one we
            // keep. Cache-busting is deliberately NOT used, because it defeats
            // the priming and reintroduces the empty render.
            await toPng(previewRef.current, opts);
            const url = await toPng(previewRef.current, opts);
            const a = document.createElement('a');
            const name = prettyRoute(selected).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
            a.href = url;
            a.download = `powr-heatmap-${name}-${range}.png`;
            a.click();
        } catch (e) {
            console.error('[usage] png export failed', e);
            toast.error('Could not generate the image');
        } finally {
            setExporting(false);
        }
    }, [selected, range, toast]);

    const grid = useMemo(() => {
        const cells = new Map();
        let max = 0;
        for (const row of data.byHour) {
            cells.set(`${row.dow}-${row.hour}`, row);
            if (row.events > max) max = row.events;
        }
        return { cells, max };
    }, [data.byHour]);

    const heatColor = (n) => {
        if (!n || grid.max <= 0) return HEAT_EMPTY;
        // Rank on a square root so a single runaway hour does not flatten every
        // other cell to the palest step — app usage is heavily peaked.
        const t = Math.sqrt(n) / Math.sqrt(grid.max);
        return HEAT_RAMP[Math.min(HEAT_RAMP.length - 1, Math.floor(t * HEAT_RAMP.length))];
    };

    // Every screen the preview can render, plus anything the data saw that the
    // preview does not know about — a route with traffic must never be hidden
    // just because nobody has recreated it yet.
    const screensByRoute = useMemo(() => {
        const m = new Map();
        for (const s of data.screens) m.set(clean(s.route), s);
        return m;
    }, [data.screens]);

    // Grouped by area of the app rather than ranked by traffic. A ranked list
    // reshuffles every time the range changes, so the screen you were just
    // looking at moves; grouping keeps the app's shape stable and makes the
    // quiet screens (which are the interesting ones) findable.
    const screenGroups = useMemo(() => {
        const groups = new Map();
        for (const p of PREVIEW_ROUTES) {
            const g = p.group || 'Other';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push({
                route: p.route, label: p.label, inPreview: true,
                stats: screensByRoute.get(p.route) || null,
            });
        }
        // Any route with traffic that the preview does not recreate still has
        // to appear — a screen nobody has drawn yet is exactly the one whose
        // numbers might surprise you.
        const known = new Set(PREVIEW_ROUTES.map((p) => p.route));
        const extra = [...screensByRoute.keys()]
            .filter((r) => !known.has(r))
            .map((r) => ({ route: r, label: prettyRoute(r), inPreview: false, stats: screensByRoute.get(r) }));
        if (extra.length) groups.set('Not recreated', extra);
        return [...groups.entries()];
    }, [screensByRoute]);

    const selectedStats = screensByRoute.get(selected) || null;

    const selectedTaps = useMemo(
        () => data.taps.filter((t) => clean(t.route) === selected).slice(0, 8),
        [data.taps, selected],
    );

    // Where this screen sits in the journey: what led here, and what followed.
    const inbound = useMemo(
        () => data.flows.filter((f) => clean(f.to_route) === selected)
            .sort((a, b) => Number(b.moves) - Number(a.moves)).slice(0, 6),
        [data.flows, selected],
    );
    const outbound = useMemo(
        () => data.flows.filter((f) => clean(f.from_route) === selected)
            .sort((a, b) => Number(b.moves) - Number(a.moves)).slice(0, 6),
        [data.flows, selected],
    );

    const o = data.overview || {};
    const hasData = (o.events ?? 0) > 0;

    const kpis = [
        { label: 'Screen Views', value: fmt(o.screen_views), icon: Eye, color: '#0EA5E9' },
        { label: 'Touches', value: fmt(o.touches), icon: Flame, color: '#E8D200' },
        { label: 'Buttons', value: fmt(o.taps), icon: MousePointerClick, color: '#F97316' },
        { label: 'People', value: fmt(o.users), icon: Users, color: '#10B981' },
        { label: 'App Opens', value: fmt(o.app_sessions), icon: Smartphone, color: '#8B5CF6' },
        { label: 'Screens / Open', value: o.screens_per_session ?? '—', icon: Layers, color: '#F43F5E' },
    ];

    const Card = ({ accent, title, sub, icon: Icon, children, className = '' }) => (
        <div className={`bg-white border border-[#E6E6E1] rounded-[2rem] p-8 ${className}`}>
            <div className="flex items-start justify-between mb-7">
                <div className="flex items-center gap-3">
                    <div className="h-[2px] w-5" style={{ background: accent }} />
                    <div>
                        <h3 className="text-base font-light tracking-tighter text-[#1A1A1A]">{title}</h3>
                        {sub && <p className="text-[8px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mt-1">{sub}</p>}
                    </div>
                </div>
                {Icon && <Icon size={16} className="text-[#CCCCCC]" />}
            </div>
            {children}
        </div>
    );

    const Empty = ({ h = 'h-40', label = 'No data in range' }) => (
        <div className={`${h} flex items-center justify-center text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black`}>{label}</div>
    );

    const Bar = ({ value, max, color }) => (
        <div className="w-full h-1.5 bg-[#F4F4F1] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(value / Math.max(max, 1)) * 100}%`, backgroundColor: color }} />
        </div>
    );

    // ── The day/hour grid ──────────────────────────────────────────────────
    const UsageGrid = () => (
        <div>
            <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                    <div className="flex gap-[3px] mb-1.5 pl-10">
                        {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="flex-1 text-center text-[7px] font-black text-[#CCCCCC]">
                                {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                            </div>
                        ))}
                    </div>
                    {DOW.map((label, d) => (
                        <div key={label} className="flex items-center gap-[3px] mb-[3px]">
                            <div className="w-10 text-[8px] uppercase tracking-[0.2em] text-[#AAAAAA] font-black flex-shrink-0">{label}</div>
                            {Array.from({ length: 24 }, (_, h) => {
                                const cell = grid.cells.get(`${d}-${h}`);
                                const n = cell?.events ?? 0;
                                return (
                                    <div key={h} className="flex-1 group relative">
                                        <div className="w-full rounded-[3px]" style={{ height: 22, background: heatColor(n) }} />
                                        <div className="absolute -top-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[#1A1A1A] text-white text-[8px] font-black px-2 py-1.5 rounded whitespace-nowrap z-20 leading-tight">
                                            {label} {String(h).padStart(2, '0')}:00
                                            <br />{fmt(n)} events · {fmt(cell?.users ?? 0)} people
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-2 mt-5">
                <span className="text-[8px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">Less</span>
                <div className="flex gap-[3px]">
                    <div className="w-5 h-2.5 rounded-[2px]" style={{ background: HEAT_EMPTY }} />
                    {HEAT_RAMP.map((c) => <div key={c} className="w-5 h-2.5 rounded-[2px]" style={{ background: c }} />)}
                </div>
                <span className="text-[8px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">More</span>
                <span className="text-[8px] uppercase tracking-[0.3em] text-[#DDDDDD] font-black ml-auto">Peak {fmt(grid.max)} / hr</span>
            </div>
        </div>
    );

    // ── The inspector ──────────────────────────────────────────────────────
    // A working copy of the app with heat painted over it. Clicking inside the
    // phone navigates it, exactly as a member would, and every panel around it
    // follows the screen you land on.
    const PREVIEW_SCALE = 0.72;

    const maxIn = Math.max(1, ...inbound.map((f) => Number(f.moves)));
    const maxOut = Math.max(1, ...outbound.map((f) => Number(f.moves)));

    const Inspector = () => (
        <div className="grid grid-cols-1 xl:grid-cols-[200px_auto_1fr] gap-8">
            {/* Screen picker */}
            <div>
                <div className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black mb-4">Screens</div>
                <div className="space-y-4 max-h-[660px] overflow-y-auto pr-2">
                    {screenGroups.map(([group, items]) => (
                        <div key={group}>
                            <div className="text-[7px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-1.5 px-3">{group}</div>
                            <div className="space-y-0.5">
                                {items.map((s) => {
                                    const active = s.route === selected;
                                    const views = Number(s.stats?.views ?? 0);
                                    return (
                                        <button key={s.route} onClick={() => setSelected(s.route)}
                                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${active ? 'bg-[#1A1A1A]' : 'hover:bg-[#F4F4F1]'}`}>
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-[10px] font-black uppercase tracking-[0.1em] truncate ${active ? 'text-white' : 'text-[#444444]'}`}>
                                                    {s.label}
                                                </div>
                                                <div className={`text-[8px] font-black uppercase tracking-[0.18em] ${active ? 'text-[#888888]' : 'text-[#BBBBBB]'}`}>
                                                    {views > 0 ? `${fmt(views)} views` : 'no visits'}
                                                </div>
                                            </div>
                                            {!s.inPreview && (
                                                <span className="text-[7px] font-black uppercase tracking-[0.1em] text-[#CCCCCC] flex-shrink-0">n/a</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* The app itself */}
            <div>
                <AppPreview
                    route={selected}
                    onNavigate={setSelected}
                    scale={PREVIEW_SCALE}
                    overlay={showHeat ? (
                        <ScreenHeatmap
                            points={heat}
                            width={390}
                            height={844}
                            radius={radius}
                            intensity={intensity}
                            showPoints={showPoints}
                            palette={palette}
                        />
                    ) : null}
                />

                {/* The copy that gets exported, rendered at the device's true
                    390×844 with no CSS scale anywhere in its ancestry. Parked
                    off-canvas rather than display:none, because a hidden subtree
                    has no layout to rasterise. exportRef lands on the screen
                    node inside it — see the note in AppPreview for why the
                    wrapper cannot be used. */}
                <div
                    aria-hidden
                    style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}
                >
                    <AppPreview
                        route={selected}
                        scale={1}
                        exportRef={previewRef}
                        overlay={showHeat ? (
                            <ScreenHeatmap
                                points={heat}
                                width={390}
                                height={844}
                                radius={radius}
                                intensity={intensity}
                                showPoints={showPoints}
                                palette={palette}
                            />
                        ) : null}
                    />
                </div>
                <div className="mt-4" style={{ width: 414 * PREVIEW_SCALE }}>
                    <div className="flex items-center gap-2">
                        <span className="text-[8px] uppercase tracking-[0.25em] text-[#CCCCCC] font-black">Cool</span>
                        <div className="flex-1 h-2 rounded-full"
                            style={{ background: HEATMAP_PALETTES.find((p) => p.key === palette)?.legend }} />
                        <span className="text-[8px] uppercase tracking-[0.25em] text-[#CCCCCC] font-black">Hot</span>
                    </div>
                    <button onClick={downloadPng} disabled={exporting}
                        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#1A1A1A] text-white text-[9px] font-black uppercase tracking-[0.18em] disabled:opacity-50 hover:bg-[#333333] transition-colors">
                        <Download size={12} />
                        {exporting ? 'Generating…' : 'Download image'}
                    </button>
                    <p className="text-[9px] text-[#BBBBBB] font-black uppercase tracking-[0.15em] mt-3 leading-relaxed">
                        Click inside the phone to move around
                    </p>
                </div>
            </div>

            {/* Numbers, controls, and where this screen sits in the journey */}
            <div className="space-y-7">
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black">{prettyRoute(selected)}</span>
                        {heatLoading && <span className="text-[7px] uppercase tracking-[0.2em] text-[#CCCCCC] font-black">loading…</span>}
                    </div>
                    <div className="grid grid-cols-3 gap-y-5 gap-x-4">
                        {[
                            { label: 'Touches', value: fmt(heat.length) },
                            { label: 'Views', value: fmt(Number(selectedStats?.views ?? 0)) },
                            { label: 'People', value: fmt(Number(selectedStats?.users ?? 0)) },
                            { label: 'Avg Dwell', value: selectedStats?.avg_dwell_sec != null ? fmtDwell(selectedStats.avg_dwell_sec) : '—' },
                            {
                                label: 'Exit Rate',
                                value: selectedStats?.exit_pct != null ? `${Number(selectedStats.exit_pct).toFixed(0)}%` : '—',
                                color: Number(selectedStats?.exit_pct) >= 40 ? '#F43F5E' : undefined,
                            },
                            { label: 'Buttons', value: fmt(selectedTaps.reduce((n, t) => n + Number(t.taps), 0)) },
                        ].map((s) => (
                            <div key={s.label}>
                                <div className="text-[7px] uppercase tracking-[0.28em] text-[#AAAAAA] font-black mb-1.5">{s.label}</div>
                                <div className="text-xl font-light tracking-tighter leading-none" style={{ color: s.color || '#1A1A1A' }}>
                                    {s.value}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* In / out — the journey around this one screen */}
                <div className="border-t border-[#F0F0EC] pt-6 grid grid-cols-2 gap-6">
                    <div>
                        <div className="flex items-center gap-1.5 mb-3">
                            <LogIn size={11} className="text-[#10B981]" />
                            <span className="text-[8px] uppercase tracking-[0.28em] text-[#AAAAAA] font-black">Arrived from</span>
                        </div>
                        {inbound.length === 0 ? (
                            <span className="text-[9px] text-[#CCCCCC] font-black uppercase tracking-[0.15em]">—</span>
                        ) : inbound.map((f, i) => (
                            <div key={i} className="mb-2.5">
                                <div className="flex justify-between mb-1">
                                    <span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#444444] truncate pr-2">{prettyRoute(f.from_route)}</span>
                                    <span className="text-[9px] font-black text-[#AAAAAA]">{fmt(Number(f.moves))}</span>
                                </div>
                                <Bar value={Number(f.moves)} max={maxIn} color="#10B981" />
                            </div>
                        ))}
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5 mb-3">
                            <LogOut size={11} className="text-[#8B5CF6]" />
                            <span className="text-[8px] uppercase tracking-[0.28em] text-[#AAAAAA] font-black">Went to</span>
                        </div>
                        {outbound.length === 0 ? (
                            <span className="text-[9px] text-[#CCCCCC] font-black uppercase tracking-[0.15em]">—</span>
                        ) : outbound.map((f, i) => (
                            <button key={i} onClick={() => setSelected(clean(f.to_route))} className="w-full mb-2.5 text-left group">
                                <div className="flex justify-between mb-1">
                                    <span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#444444] truncate pr-2 group-hover:text-[#8B5CF6]">{prettyRoute(f.to_route)}</span>
                                    <span className="text-[9px] font-black text-[#AAAAAA]">{fmt(Number(f.moves))}</span>
                                </div>
                                <Bar value={Number(f.moves)} max={maxOut} color="#8B5CF6" />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="border-t border-[#F0F0EC] pt-6 space-y-4">
                    <div className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black">Overlay</div>

                    <div>
                        <div className="flex gap-1.5 mb-2">
                            {HEATMAP_PALETTES.map((p) => (
                                <button key={p.key} onClick={() => setPalette(p.key)}
                                    className={`flex-1 rounded-lg overflow-hidden border-2 transition-colors ${palette === p.key ? 'border-[#1A1A1A]' : 'border-transparent hover:border-[#E6E6E1]'}`}>
                                    <div className="h-4 w-full" style={{ background: p.legend }} />
                                    <div className={`text-[8px] font-black uppercase tracking-[0.12em] py-1 ${palette === p.key ? 'text-[#1A1A1A]' : 'text-[#BBBBBB]'}`}>
                                        {p.label}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <p className="text-[8px] text-[#BBBBBB] font-black uppercase tracking-[0.12em] leading-relaxed">
                            {HEATMAP_PALETTES.find((p) => p.key === palette)?.note}
                        </p>
                    </div>

                    {[
                        { label: 'Blob size', value: radius, set: setRadius, min: 10, max: 60, step: 1 },
                        { label: 'Intensity', value: intensity, set: setIntensity, min: 0.2, max: 2.5, step: 0.1 },
                    ].map((c) => (
                        <div key={c.label}>
                            <div className="flex justify-between mb-1.5">
                                <span className="text-[9px] uppercase tracking-[0.2em] text-[#888888] font-black">{c.label}</span>
                                <span className="text-[9px] font-black text-[#BBBBBB]">{c.value}</span>
                            </div>
                            <input type="range" min={c.min} max={c.max} step={c.step} value={c.value}
                                onChange={(e) => c.set(Number(e.target.value))} className="w-full accent-[#E8D200]" />
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                        {[
                            { label: 'Heat', on: showHeat, toggle: () => setShowHeat((v) => !v) },
                            { label: 'Touch points', on: showPoints, toggle: () => setShowPoints((v) => !v) },
                        ].map((t) => (
                            <button key={t.label} onClick={t.toggle}
                                className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] border transition-colors ${t.on ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#AAAAAA] border-[#E6E6E1] hover:text-[#1A1A1A]'}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                {selectedTaps.length > 0 && (
                    <div className="border-t border-[#F0F0EC] pt-6">
                        <div className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black mb-4">Buttons on this screen</div>
                        <div className="space-y-2.5">
                            {selectedTaps.map((t, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#444444] flex-1 truncate">{t.target}</span>
                                    <span className="text-[10px] font-black text-[#1A1A1A]">{fmt(Number(t.taps))}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const maxJourney = Math.max(1, ...data.paths.map((p) => Number(p.journeys)));
    const maxEntry = Math.max(1, ...data.entries.map((p) => Number(p.entries)));
    const maxMoves = Math.max(1, ...data.flows.map((f) => Number(f.moves)));

    return (
        <div className="px-4 lg:px-0 py-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-6 mb-12">
                <div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="h-[1px] w-12 bg-[#F97316]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#F97316] font-black">Subsystem / Behaviour</span>
                    </div>
                    <h1 className="text-5xl lg:text-6xl font-light tracking-tighter text-[#1A1A1A] mb-4">Usage</h1>
                    <p className="text-[#888888] text-[10px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Where members tap &amp; how they move through the app
                    </p>
                </div>
                <div className="flex items-center gap-1 bg-white border border-[#E6E6E1] rounded-full p-1">
                    {RANGES.map((r) => (
                        <button key={r.key} onClick={() => setRange(r.key)}
                            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all ${range === r.key ? 'bg-[#1A1A1A] text-white' : 'text-[#AAAAAA] hover:text-[#1A1A1A]'}`}>
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Collection only starts when an instrumented build reaches devices,
                so an empty panel is the expected state on day one — say so
                rather than letting it read as a broken page. */}
            {!loading && !hasData && (
                <div className="bg-white border border-[#E6E6E1] rounded-[2rem] p-8 mb-6">
                    <h3 className="text-base font-light tracking-tighter text-[#1A1A1A] mb-3">No events collected yet</h3>
                    <p className="text-[11px] text-[#888888] leading-relaxed max-w-2xl">
                        This panel fills up once an app build carrying the analytics module is on members&apos; devices.
                        Unlike the other admin pages there is nothing historic to show — usage data only exists from
                        the moment collection ships, so expect this to stay empty until the next release goes out and
                        then fill in over the following days. The phone below is live either way: click through it to
                        see the screens the heat will land on.
                    </p>
                    <p className="text-[10px] text-[#AAAAAA] leading-relaxed max-w-2xl mt-3">
                        Collection can be paused at any time from Config → <span className="font-black">analytics_enabled</span>.
                    </p>
                </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
                {kpis.map((c) => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] p-6 rounded-2xl">
                        <div className="flex items-center gap-2 mb-4">
                            <c.icon size={13} style={{ color: c.color }} />
                            <span className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black truncate">{c.label}</span>
                        </div>
                        <span className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-none">
                            {loading ? '—' : c.value}
                        </span>
                    </div>
                ))}
            </div>

            {/* The inspector */}
            <div className="mb-6">
                <Card accent="#F97316" title="Screen Inspector" sub={`Live app · heat · ${range.toUpperCase()}`} icon={Flame}>
                    {loading ? <Empty h="h-96" /> : <Inspector />}
                </Card>
            </div>

            {/* Journeys */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#8B5CF6" title="Top Journeys" sub="First four screens of a visit" icon={RouteIcon} className="lg:col-span-2">
                    {loading ? <Empty /> : data.paths.length === 0 ? <Empty label="No journeys yet" /> : (
                        <div className="space-y-3.5 max-h-[420px] overflow-y-auto">
                            {data.paths.map((p, i) => (
                                <div key={i}>
                                    <div className="flex items-center gap-3 mb-1.5">
                                        <span className="text-[10px] font-black text-[#DDDDDD] w-4 flex-shrink-0">{i + 1}</span>
                                        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#444444] flex-1 truncate">
                                            {p.path.split('  →  ').map(prettyRoute).join('  →  ')}
                                        </span>
                                        <span className="text-[11px] font-black text-[#1A1A1A] flex-shrink-0">{fmt(Number(p.journeys))}</span>
                                        <span className="text-[9px] font-black text-[#CCCCCC] w-12 text-right flex-shrink-0">{fmt(Number(p.users))} ppl</span>
                                    </div>
                                    <Bar value={Number(p.journeys)} max={maxJourney} color="#8B5CF6" />
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <Card accent="#10B981" title="Entry Screens" sub="Where a visit begins" icon={LogIn}>
                    {loading ? <Empty /> : data.entries.length === 0 ? <Empty /> : (
                        <div className="space-y-3.5 max-h-[420px] overflow-y-auto">
                            {data.entries.map((e, i) => (
                                <button key={i} onClick={() => setSelected(clean(e.route))} className="w-full text-left group">
                                    <div className="flex justify-between mb-1.5">
                                        <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#444444] truncate pr-2 group-hover:text-[#10B981]">{prettyRoute(e.route)}</span>
                                        <span className="text-[10px] font-black text-[#1A1A1A]">{fmt(Number(e.entries))}</span>
                                    </div>
                                    <Bar value={Number(e.entries)} max={maxEntry} color="#10B981" />
                                </button>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* Full move graph + when the app is open */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#E8D200" title="When The App Is Open" sub={`Events by day & hour · ${range.toUpperCase()}`} icon={Clock} className="lg:col-span-2">
                    {loading ? <Empty h="h-48" /> : !hasData ? <Empty h="h-48" /> : <UsageGrid />}
                </Card>

                <Card accent="#0EA5E9" title="Every Move" sub="Screen to screen" icon={ArrowRight}>
                    {loading ? <Empty /> : data.flows.length === 0 ? <Empty /> : (
                        <div className="divide-y divide-[#F4F4F1] -my-2 max-h-[420px] overflow-y-auto">
                            {data.flows.slice(0, 25).map((f, i) => (
                                <div key={i} className="py-2.5">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#444444] truncate">{prettyRoute(f.from_route)}</span>
                                        <ArrowRight size={9} className="text-[#DDDDDD] flex-shrink-0" />
                                        <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#444444] truncate">{prettyRoute(f.to_route)}</span>
                                        <span className="ml-auto text-[10px] font-black text-[#1A1A1A] flex-shrink-0">{fmt(Number(f.moves))}</span>
                                    </div>
                                    <Bar value={Number(f.moves)} max={maxMoves} color="#0EA5E9" />
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* Screen table */}
            <Card accent="#0EA5E9" title="All Screens" sub="Views · time on screen · exit rate" icon={Eye}>
                {loading ? <Empty /> : data.screens.length === 0 ? <Empty /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px]">
                            <thead>
                                <tr className="text-[8px] uppercase tracking-[0.25em] text-[#CCCCCC] font-black">
                                    <th className="text-left pb-3">Screen</th>
                                    <th className="text-right pb-3">Views</th>
                                    <th className="text-right pb-3">People</th>
                                    <th className="text-right pb-3">Dwell</th>
                                    <th className="text-right pb-3">Exit</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {data.screens.map((s) => (
                                    <tr key={s.route} className="cursor-pointer hover:bg-[#FAFAF8]" onClick={() => setSelected(clean(s.route))}>
                                        <td className="py-3 pr-3">
                                            <div className="text-[11px] font-black uppercase tracking-[0.1em] text-[#444444] truncate mb-1.5">{prettyRoute(s.route)}</div>
                                            <Bar value={Number(s.views)} max={Math.max(1, ...data.screens.map((x) => Number(x.views)))} color="#0EA5E9" />
                                        </td>
                                        <td className="py-3 text-right text-[11px] font-black text-[#1A1A1A] align-top">{fmt(Number(s.views))}</td>
                                        <td className="py-3 text-right text-[10px] font-black text-[#AAAAAA] align-top">{fmt(Number(s.users))}</td>
                                        <td className="py-3 text-right text-[10px] font-black text-[#AAAAAA] align-top whitespace-nowrap">{fmtDwell(s.avg_dwell_sec)}</td>
                                        <td className="py-3 text-right align-top">
                                            <span className="text-[10px] font-black" style={{ color: Number(s.exit_pct) >= 40 ? '#F43F5E' : '#AAAAAA' }}>
                                                {Number(s.exit_pct ?? 0).toFixed(0)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
