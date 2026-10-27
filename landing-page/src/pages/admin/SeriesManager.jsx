import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import {
    Trophy, Rocket, CalendarDays, Gift, ListOrdered, MapPin, Bot, Medal, Plus, Save, Trash2, Search, X, Check,
    RefreshCw, AlertTriangle, ShieldCheck, UserX, UserCheck, Megaphone, ImagePlus, LoaderCircle, ChevronLeft,
    ChevronRight, Shuffle, Eye, EyeOff, Bell, ExternalLink, Ticket, Crown, Zap, Timer, Flame, Flag, Lock,
    Target, TrendingUp, ArrowUpCircle, Users,
} from 'lucide-react';

/*
 * The Series, run from here, season by season: the launch switch, seasons and
 * their monthly rounds, prizes, the board (with pacers marked), cities, pacers
 * and the results.
 *
 * Server side: supabase/migrations/20261020150000_autumn_series.sql,
 * 20261022120000_series_pacers_and_cities.sql, 20261022150000_series_admin.sql.
 * Rounds, prizes and pacers are written straight to their tables (admin RLS);
 * everything that has to stay consistent (results, exclusions, a member's city)
 * goes through an admin_series_* function. Every write lands in the audit log.
 *
 * Pacers fill the board until real members do. They are never in a prize: the
 * board caps them under the real #3 and every result is drawn from members only.
 */

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

const ACCENT = '#E8D200';
const TABS = [
    { key: 'overview', label: 'Overview', icon: Rocket },
    { key: 'rounds', label: 'Seasons', icon: CalendarDays },
    { key: 'prizes', label: 'Prizes', icon: Gift },
    { key: 'moments', label: 'Moments', icon: Zap },
    { key: 'board', label: 'Board', icon: ListOrdered },
    { key: 'cities', label: 'Cities', icon: MapPin },
    { key: 'pacers', label: 'Pacers', icon: Bot },
    { key: 'results', label: 'Results', icon: Medal },
];

// ── Dates: rounds run London midnight to London midnight ─────────────────────

const LONDON = 'Europe/London';
/** 'YYYY-MM-DD' of an instant in London. */
const londonDay = (iso) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const get = (t) => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
};
const addDays = (day, n) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
/** The last day of a round (ends_at is the London midnight after it). */
const lastDay = (endsAt) => addDays(londonDay(endsAt), -1);
// Plain dates ('2027-01-01'); anything longer is cut to its date.
const fmtDay = (day) => new Date(`${String(day).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }) : '—');
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB'));

function roundState(r, now = Date.now()) {
    const s = new Date(r.starts_at).getTime();
    const e = new Date(r.ends_at).getTime();
    const days = Math.round((e - s) / 86_400_000);
    if (now < s) return { key: 'upcoming', label: 'Upcoming', color: '#3B82F6', days };
    if (now < e) {
        const day = Math.min(days, Math.floor((now - s) / 86_400_000) + 1);
        return { key: 'running', label: `Running · day ${day} of ${days}`, color: '#10B981', days, day };
    }
    return { key: 'ended', label: 'Ended', color: '#6B7280', days };
}

/** Which round to open first: the one running, else the next, else the latest. */
function pickDefault(rounds) {
    const now = Date.now();
    return rounds.find(r => roundState(r, now).key === 'running')
        ?? [...rounds].filter(r => roundState(r, now).key === 'upcoming').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
        ?? [...rounds].sort((a, b) => b.ends_at.localeCompare(a.ends_at))[0]
        ?? null;
}

// ── Small parts ──────────────────────────────────────────────────────────────

const card = 'bg-white border border-[#E6E6E1] rounded-3xl';
const input = 'h-10 px-3.5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#B8A800]/50 transition-all';
const btn = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const btnQuiet = `${btn} bg-[#F4F4F1] border border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2]`;
const btnGold = `${btn} bg-[#E8D200] text-[#080808] hover:brightness-95`;
const btnDanger = `${btn} bg-white border border-[#F43F5E]/30 text-[#E11D48] hover:bg-[#FFF1F2]`;

function Section({ title, right, children, blurb }) {
    return (
        <section className="mb-10">
            <div className="flex items-end justify-between gap-4 mb-4 px-1">
                <div>
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">{title}</h2>
                    {blurb && <p className="text-[12.5px] text-[#888888] leading-snug mt-1 max-w-3xl">{blurb}</p>}
                </div>
                {right}
            </div>
            {children}
        </section>
    );
}

function Stat({ label, value, sub, tone }) {
    return (
        <div className={`${card} px-6 py-5`}>
            <div className="text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999] mb-2">{label}</div>
            <div className="text-3xl font-light tracking-tight tabular-nums" style={{ color: tone ?? '#1A1A1A' }}>{value}</div>
            {sub && <div className="text-[11.5px] text-[#888888] mt-1.5 leading-snug">{sub}</div>}
        </div>
    );
}

function Pill({ color, children }) {
    return (
        <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[9.5px] font-black uppercase tracking-[0.18em]"
            style={{ background: `${color}14`, color, border: `1px solid ${color}33` }}>
            {children}
        </span>
    );
}

function Field({ label, hint, children }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[9.5px] font-black uppercase tracking-[0.25em] text-[#999999]">{label}</span>
            {children}
            {hint && <span className="text-[11px] text-[#999999] leading-snug">{hint}</span>}
        </label>
    );
}

function Empty({ icon: Icon, text }) {
    return (
        <div className={`${card} p-14 text-center`}>
            <Icon size={34} className="mx-auto text-[#CCCCCC] mb-4" />
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#888888] font-black">{text}</p>
        </div>
    );
}

function Loading() {
    return (
        <div className={`${card} flex items-center justify-center py-20`}>
            <div className="w-9 h-9 border-2 border-[#E8D200]/25 border-t-[#B8A800] rounded-full animate-spin" />
        </div>
    );
}

/** A small modal that asks for a reason (or just a yes) before a write. */
function Confirm({ open, title, body, reasonLabel, confirmLabel, danger, onCancel, onConfirm, extra }) {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open) { setReason(''); setBusy(false); } }, [open]);
    if (!open) return null;
    const needsReason = !!reasonLabel;
    const go = async () => {
        if (needsReason && reason.trim().length < 3) return;
        setBusy(true);
        try { await onConfirm(reason.trim()); } finally { setBusy(false); }
    };
    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onCancel}>
            <div className={`${card} w-full max-w-md p-7 shadow-2xl`} onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-bold text-[#1A1A1A] tracking-tight mb-2">{title}</h3>
                {body && <p className="text-[13px] text-[#666666] leading-relaxed mb-5">{body}</p>}
                {extra}
                {needsReason && (
                    <Field label={reasonLabel}>
                        <input autoFocus className={input} value={reason} onChange={e => setReason(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') go(); }} placeholder="Goes on the record" />
                    </Field>
                )}
                <div className="flex justify-end gap-3 mt-6">
                    <button className={btnQuiet} onClick={onCancel}>Cancel</button>
                    <button className={danger ? btnDanger : btnGold} onClick={go} disabled={busy || (needsReason && reason.trim().length < 3)}>
                        {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />} {confirmLabel ?? 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
    );
}

const rpcError = (e) => e?.message?.replace(/^.*?:\s/, '') ?? 'Something went wrong';

// ── The page ─────────────────────────────────────────────────────────────────

// The look each season wears in the app (components/series/season.tsx).
const LOOKS = {
    autumn: { label: 'Autumn', colour: '#013E37' },
    winter: { label: 'Winter', colour: '#13294B' },
    spring: { label: 'Spring', colour: '#4A1E43' },
    summer: { label: 'Summer', colour: '#5A2A14' },
};
const seasonNo = (se) => `Nº ${String(se.number).padStart(2, '0')}${se.code ? ` — ${se.code}` : ''}`;
function seasonState(se, now = Date.now()) {
    const today = londonDay(new Date(now).toISOString());
    if (today < String(se.starts_on).slice(0, 10)) return { key: 'upcoming', label: 'Upcoming', color: '#3B82F6' };
    if (today <= String(se.ends_on).slice(0, 10)) return { key: 'running', label: 'On now', color: '#10B981' };
    return { key: 'ended', label: 'Ended', color: '#6B7280' };
}
const monthSpan = (se) => {
    const f = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    return `${f(se.starts_on)} – ${f(se.ends_on)}`;
};

export default function SeriesManager() {
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview';
    const [rounds, setRounds] = useState(null);
    const [seasons, setSeasons] = useState([]);
    const [seasonsError, setSeasonsError] = useState(null);
    const [slug, setSlug] = useState(params.get('round'));
    const [seasonSlug, setSeasonSlug] = useState(params.get('season'));

    const loadRounds = useCallback(async () => {
        const [r, se] = await Promise.all([
            supabase.from('series_rounds').select('*').order('starts_at'),
            supabase.from('series_seasons').select('*').order('starts_on'),
        ]);
        if (r.error) { toast.error(r.error.message); setRounds([]); return; }
        const rs = r.data ?? [];
        const ss = se.error ? [] : (se.data ?? []);
        setSeasonsError(se.error ? se.error.message : null);
        setRounds(rs);
        setSeasons(ss);
        const pick = (prev) => (prev && rs.some(x => x.slug === prev) ? prev : pickDefault(rs)?.slug ?? null);
        setSlug(prev => {
            const next = pick(prev);
            const owner = rs.find(x => x.slug === next)?.season_id;
            setSeasonSlug(sp => (sp && ss.some(x => x.slug === sp) ? sp : ss.find(x => x.id === owner)?.slug ?? ss[0]?.slug ?? null));
            return next;
        });
    }, [toast]);
    useEffect(() => { loadRounds(); }, [loadRounds]);

    const season = seasons.find(x => x.slug === seasonSlug) ?? null;
    const shownRounds = (rounds ?? []).filter(r => (season ? r.season_id === season.id : true));
    const round = rounds?.find(r => r.slug === slug) ?? null;
    const go = (patch) => {
        const next = new URLSearchParams(params);
        Object.entries(patch).forEach(([k, v]) => (v == null ? next.delete(k) : next.set(k, v)));
        setParams(next, { replace: true });
    };
    const pickRound = (s) => { setSlug(s); go({ round: s }); };
    const pickSeason = (se) => {
        setSeasonSlug(se.slug);
        const inIt = (rounds ?? []).filter(r => r.season_id === se.id);
        const first = pickDefault(inIt)?.slug ?? null;
        setSlug(first);
        go({ season: se.slug, round: first });
    };

    return (
        <div className="max-w-[1200px]">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12" style={{ background: ACCENT }} />
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#B8A800] font-black">Live Ops / League</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-4">Series</h1>
                <p className="text-[#666666] text-sm max-w-2xl leading-relaxed">
                    The League tab, season by season: Autumn, Winter, Spring and Summer, each with its monthly rounds,
                    prizes, board and winners. The app wears the season that’s on. Pacers fill the board until members
                    do and are never in a prize.
                </p>
            </div>

            {seasonsError && (
                <div className="mb-6 px-5 py-4 rounded-2xl border border-[#F43F5E]/30 bg-[#FFF1F2] text-[13px] text-[#BE123C]">
                    Couldn’t load the seasons ({seasonsError}). If the seasons migration was just applied, reload the page.
                </div>
            )}
            {seasons.length > 0 && (
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                    {seasons.map(se => {
                        const st = seasonState(se);
                        const on = se.slug === seasonSlug;
                        return (
                            <button key={se.id} onClick={() => pickSeason(se)}
                                className={`flex items-center gap-3 h-14 pl-2 pr-4 rounded-2xl border text-left transition-all ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#555555] hover:border-[#D8D8D2]'}`}>
                                <span className="w-10 h-10 rounded-xl shrink-0" style={{ background: LOOKS[se.look]?.colour ?? '#333' }} />
                                <span>
                                    <span className="block text-[12.5px] font-bold leading-none mb-1.5">
                                        {se.name}{!se.published && <span className="ml-1.5 text-[9px] font-black tracking-[0.15em] text-[#F97316]">DRAFT</span>}
                                    </span>
                                    <span className={`block text-[9.5px] font-black uppercase tracking-[0.16em] leading-none ${on ? 'text-white/60' : ''}`} style={on ? undefined : { color: st.color }}>
                                        {seasonNo(se)} · {monthSpan(se)}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
            {shownRounds.length > 0 && (
                <div className="mb-8 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9.5px] font-black uppercase tracking-[0.25em] text-[#AAAAAA] mr-2">Round</span>
                    {shownRounds.map(r => {
                        const st = roundState(r);
                        const on = r.slug === slug;
                        return (
                            <button key={r.id} onClick={() => pickRound(r.slug)}
                                className={`h-8 px-3 rounded-full border text-[11px] font-semibold transition-all ${on ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#555555] hover:border-[#D8D8D2]'}`}>
                                {r.name} · {fmtDay(londonDay(r.starts_at))}
                                {!r.published ? <span className="ml-1.5 text-[8.5px] font-black tracking-[0.12em] text-[#F97316]">DRAFT</span>
                                    : st.key === 'running' ? <span className="ml-1.5 text-[8.5px] font-black tracking-[0.12em] text-[#10B981]">ON</span> : null}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="flex items-center gap-1.5 mb-10 border-b border-[#E6E6E1] overflow-x-auto">
                {TABS.map(t => {
                    const on = t.key === tab;
                    return (
                        <button key={t.key} onClick={() => go({ tab: t.key })}
                            className={`flex items-center gap-2 h-11 px-4 -mb-px border-b-2 text-[11px] font-bold uppercase tracking-[0.22em] whitespace-nowrap transition-all ${on ? 'border-[#B8A800] text-[#1A1A1A]' : 'border-transparent text-[#AAAAAA] hover:text-[#555555]'}`}>
                            <t.icon size={14} strokeWidth={on ? 2.4 : 1.8} /> {t.label}
                        </button>
                    );
                })}
            </div>

            {rounds === null ? <Loading /> : (
                <>
                    {tab === 'overview' && <OverviewTab round={round} season={seasons.find(x => x.id === round?.season_id) ?? season} />}
                    {tab === 'rounds' && <SeasonsTab seasons={seasons} rounds={rounds} focus={season}
                        onSaved={(s) => { loadRounds(); if (s) pickRound(s); }} />}
                    {tab !== 'overview' && tab !== 'rounds' && !round && <Empty icon={CalendarDays} text="Pick a round, or add one on Seasons" />}
                    {tab === 'prizes' && round && <PrizesTab key={round.id} round={round} />}
                    {tab === 'moments' && round && <MomentsTab key={round.id} round={round} />}
                    {tab === 'board' && round && <BoardTab key={round.id} round={round} />}
                    {tab === 'cities' && round && <CitiesTab key={round.id} round={round} />}
                    {tab === 'pacers' && round && <PacersTab key={round.id} round={round} />}
                    {tab === 'results' && round && <ResultsTab key={round.id} round={round} />}
                </>
            )}
        </div>
    );
}

// ── Overview ─────────────────────────────────────────────────────────────────

const LIVE_MODES = [
    { key: 'off', label: 'Off', note: 'Nobody sees the Series. The League tab is as it was.' },
    { key: 'testers', label: 'Testers', note: 'Admins and the member IDs below see it, and only they get its pushes.' },
    { key: 'on', label: 'On', note: 'Every member sees the Series and gets its pushes.' },
];

function OverviewTab({ round, season }) {
    const toast = useToast();
    const { user } = useAuth();
    const [cfg, setCfg] = useState(null);
    const [testers, setTesters] = useState('');
    const [pushes, setPushes] = useState([]);
    const [stats, setStats] = useState(null);
    const [pacers, setPacers] = useState(null);
    const [prizeCount, setPrizeCount] = useState(null);
    const [resultsState, setResultsState] = useState(null);
    const [saving, setSaving] = useState(false);
    const [confirmOn, setConfirmOn] = useState(false);

    const load = useCallback(async () => {
        const [c, n] = await Promise.all([
            supabase.from('system_config').select('key, value, updated_at').in('key', ['series_live', 'series_testers']),
            supabase.from('notification_config').select('type, enabled').in('type', ['series_rival', 'series_passed']),
        ]);
        const map = Object.fromEntries((c.data ?? []).map(r => [r.key, r]));
        setCfg(map);
        setTesters(map.series_testers?.value ?? '');
        setPushes(n.data ?? []);
        if (round) {
            const [s, p, pr, rs] = await Promise.all([
                supabase.rpc('admin_series_round_stats', { p_slug: round.slug }),
                supabase.rpc('admin_series_pacers', { p_slug: round.slug }),
                supabase.from('series_prizes').select('id', { count: 'exact', head: true }).eq('round_id', round.id),
                supabase.from('series_results').select('status, announced_at').eq('round_id', round.id).neq('status', 'void'),
            ]);
            setStats(s.data ?? null);
            setPacers(p.data ?? null);
            setPrizeCount(pr.count ?? 0);
            const live = rs.data ?? [];
            setResultsState(!live.length ? 'none' : live.some(r => r.status === 'provisional') ? 'provisional'
                : live.some(r => r.announced_at) ? 'announced' : 'confirmed');
        }
    }, [round]);
    useEffect(() => { load(); }, [load]);

    const live = cfg?.series_live?.value ?? 'off';
    const setLive = async (value) => {
        setSaving(true);
        const { error } = await supabase.from('system_config')
            .update({ value, updated_at: new Date().toISOString(), updated_by: user.id }).eq('key', 'series_live');
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'config_update', 'system_config', 'series_live', { old_value: live, new_value: value });
        toast.success(`Series ${value === 'on' ? 'on for everyone' : value === 'testers' ? 'on for testers' : 'off'}`);
        load();
    };
    const saveTesters = async () => {
        const clean = testers.split(/[\s,]+/).filter(Boolean).join(',');
        const bad = clean.split(',').filter(x => x && !/^[0-9a-f-]{36}$/i.test(x));
        if (bad.length) { toast.error(`Not a user id: ${bad[0]}`); return; }
        const { error } = await supabase.from('system_config')
            .update({ value: clean, updated_at: new Date().toISOString(), updated_by: user.id }).eq('key', 'series_testers');
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'config_update', 'system_config', 'series_testers', { new_value: clean });
        toast.success('Testers saved');
        load();
    };

    if (!cfg) return <Loading />;
    const st = round ? roundState(round) : null;
    const safe = pacers && (pacers.top_pacer == null || pacers.real_third == null || pacers.top_pacer < pacers.real_third);
    const noConfig = !cfg.series_live;

    return (
        <>
            <Section title="Launch" blurb="Who sees the Series in the app. Its pushes follow the same switch.">
                {noConfig ? (
                    <div className={`${card} p-6 text-[13px] text-[#E11D48]`}>series_live isn’t in System Config yet: the Series migrations haven’t been applied.</div>
                ) : (
                    <div className={`${card} p-6`}>
                        <div className="flex flex-wrap items-start gap-3 mb-5">
                            {LIVE_MODES.map(m => {
                                const on = m.key === live;
                                return (
                                    <button key={m.key} disabled={saving || on}
                                        onClick={() => (m.key === 'on' ? setConfirmOn(true) : setLive(m.key))}
                                        className={`w-[220px] text-left p-4 rounded-2xl border transition-all ${on ? 'border-[#B8A800] bg-[#E8D200]/10' : 'border-[#E6E6E1] hover:border-[#D8D8D2]'}`}>
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className={`w-2 h-2 rounded-full ${on ? 'bg-[#10B981]' : 'bg-[#DDDDDD]'}`} />
                                            <span className="text-[13px] font-bold text-[#1A1A1A]">{m.label}</span>
                                        </div>
                                        <p className="text-[11.5px] text-[#888888] leading-snug">{m.note}</p>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-end gap-3 max-w-3xl">
                            <div className="flex-1">
                                <Field label="Testers (user ids, comma separated)" hint="Used while the switch is on Testers. Admins always count as testers.">
                                    <input className={`${input} font-mono text-[12px]`} value={testers} onChange={e => setTesters(e.target.value)} />
                                </Field>
                            </div>
                            <button className={btnQuiet} onClick={saveTesters} disabled={testers === (cfg.series_testers?.value ?? '')}><Save size={13} /> Save</button>
                        </div>
                        <div className="mt-5 pt-5 border-t border-[#F0F0EC] flex items-center gap-6 flex-wrap text-[12px] text-[#666666]">
                            <span className="flex items-center gap-2"><Bell size={14} className="text-[#999999]" /> Pushes:</span>
                            {['series_rival', 'series_passed'].map(t => {
                                const row = pushes.find(p => p.type === t);
                                return (
                                    <span key={t} className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${row?.enabled ? 'bg-[#10B981]' : 'bg-[#DDDDDD]'}`} />
                                        {t === 'series_rival' ? '08:00 rival' : 'Someone passed you'} · {row ? (row.enabled ? 'on' : 'off') : 'missing'}
                                    </span>
                                );
                            })}
                            <Link to="/admin/notifications" className="inline-flex items-center gap-1.5 text-[#8a7600] font-semibold hover:underline">
                                Switch in Notifications <ExternalLink size={12} />
                            </Link>
                        </div>
                    </div>
                )}
            </Section>

            {round ? (
                <>
                    <Section title={`${season ? `${season.name} · ` : ''}${round.name} · ${fmtDay(londonDay(round.starts_at))} – ${fmtDay(lastDay(round.ends_at))}`}
                        right={<div className="flex items-center gap-2">
                            {!round.published && <Pill color="#F97316">Draft · hidden from the app</Pill>}
                            <Pill color={st.color}>{st.label}</Pill>
                        </div>}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {/* Members join the Series (20261027120000); before that everyone was in. */}
                            {stats?.joined != null
                                ? <Stat label="Joined" value={fmtN(stats.joined)} sub={`${fmtN(stats.entrants)} shown on the board · ${fmtN(stats.moved)} have moved`} />
                                : <Stat label="Members" value={fmtN(stats?.entrants)} sub={`${fmtN(stats?.moved)} have moved this round`} />}
                            <Stat label="On the board" value={fmtN(stats?.board_total)} sub={`${fmtN(stats?.pacers_on_board)} of them pacers`} />
                            <Stat label="In The Draw" value={fmtN(stats?.in_the_draw)} sub={`logged ${round.draw_days}+ days · avg ${stats?.avg_days_logged ?? '—'} days`} />
                            <Stat label="Came back" value={fmtN(stats?.came_back)} sub={`moved in week 1 and again after · ${fmtN(stats?.week1_movers)} in week 1`} />
                        </div>
                    </Section>
                    <Section title="Prize safety" blurb="Pacers are capped under the real #3 and every result is drawn from members only.">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <Stat label="Highest pacer" value={fmtN(pacers?.top_pacer)} sub={`real #3 is on ${fmtN(pacers?.real_third)}`}
                                tone={safe ? '#10B981' : '#E11D48'} />
                            <Stat label="Pacers seated" value={fmtN(pacers?.seated)} sub={`${fmtN(pacers?.target)} + ${fmtN(pacers?.growth)}/day − ${fmtN(pacers?.members)} members`} />
                            <Stat label="Prizes set" value={fmtN(prizeCount)} sub={prizeCount ? 'see Prizes' : 'none yet: the app shows “to be announced”'} tone={prizeCount ? undefined : '#F97316'} />
                            <Stat label="Results"
                                value={{ none: 'Not settled', provisional: 'To check', confirmed: 'Confirmed', announced: 'Announced' }[resultsState] ?? '—'}
                                sub={{ none: st.key === 'ended' ? 'the round is over: settle it on Results' : 'settle once the round ends',
                                    provisional: 'drawn, not confirmed yet', confirmed: 'ready to announce', announced: 'winners are in the app' }[resultsState]}
                                tone={resultsState === 'provisional' || (resultsState === 'none' && st.key === 'ended') ? '#F97316' : undefined} />
                        </div>
                    </Section>
                </>
            ) : <Empty icon={CalendarDays} text="No rounds yet: plan ahead on Seasons" />}

            <Confirm open={confirmOn} title="Turn the Series on for everyone?"
                body="Every member sees the Series on the League tab and gets its pushes (where those are switched on). Check the round is published and its prizes are set."
                confirmLabel="Turn it on" onCancel={() => setConfirmOn(false)}
                onConfirm={async () => { await setLive('on'); setConfirmOn(false); }} />
        </>
    );
}

// ── Seasons and rounds ───────────────────────────────────────────────────────

const BLANK_ROUND = { name: '', slug: '', season_id: '', start: '', end: '', draw_days: 10, pacer_target: 1500, pacer_growth: 10, city_min_members: 5, city_min_cities: 3, published: false };
const BLANK_SEASON = { name: '', slug: '', look: 'winter', number: 1, code: '', start: '', end: '', published: false };
// Seasons are quarters: Jan–Mar Winter, Apr–Jun Spring, Jul–Sep Summer, Oct–Dec Autumn.
const QUARTER_LOOK = { 1: 'winter', 4: 'spring', 7: 'summer', 10: 'autumn' };
/** The season after `prev` (or the one this quarter), filled in the way Plan ahead names them. */
function nextSeason(prev, number) {
    const today = new Date().toISOString().slice(0, 10);
    const from = prev ? addDays(String(prev.ends_on).slice(0, 10), 1) : today;
    const [y, m] = from.split('-').map(Number);
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    const start = `${y}-${String(qm).padStart(2, '0')}-01`;
    const end = lastOfMonth(`${y}-${String(qm + 2).padStart(2, '0')}`);
    const look = QUARTER_LOOK[qm];
    const yy = String(y).slice(2);
    const code = look === 'winter' ? `AW${String(y - 1).slice(2)}` : look === 'autumn' ? `AW${yy}` : `SS${yy}`;
    return { ...BLANK_SEASON, look, name: `${LOOKS[look].label} Series`, slug: `${look}-${yy}`, number, code, start, end };
}
const lastOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

function SeasonsTab({ seasons, rounds, focus, onSaved }) {
    const toast = useToast();
    const { user } = useAuth();
    const [edit, setEdit] = useState(null);       // round form; id = editing
    const [seasonEdit, setSeasonEdit] = useState(null);
    const [busy, setBusy] = useState(false);
    const [del, setDel] = useState(null);
    const [publish, setPublish] = useState(null); // { season, on }
    const [withRounds, setWithRounds] = useState(true);
    const [plan, setPlan] = useState(null);       // { until: 'YYYY-MM', start, days }

    // ── Rounds
    const openRound = (r, season) => {
        if (r) {
            setEdit({
                id: r.id, name: r.name, slug: r.slug, season_id: r.season_id ?? '', start: londonDay(r.starts_at), end: lastDay(r.ends_at),
                draw_days: r.draw_days, pacer_target: r.pacer_target, pacer_growth: r.pacer_growth,
                city_min_members: r.city_min_members, city_min_cities: r.city_min_cities, published: r.published,
                // The invite race (20261026120000): kept to the minute unless the day is changed.
                invite: r.invite_from ? londonDay(r.invite_from) : '', inviteWas: r.invite_from ?? null,
            });
            return;
        }
        // A new round in a season: the next free month, the 1st to the 15th, the latest round's settings.
        const inIt = rounds.filter(x => x.season_id === season?.id);
        const tpl = [...rounds].sort((x, y) => y.starts_at.localeCompare(x.starts_at))[0];
        let start = season ? String(season.starts_on).slice(0, 10) : '';
        const taken = new Set(inIt.map(x => londonDay(x.starts_at).slice(0, 7)));
        const seasonEnd = season ? String(season.ends_on).slice(0, 10) : start;
        while (start && taken.has(start.slice(0, 7)) && start <= seasonEnd) start = addDays(lastOfMonth(start.slice(0, 7)), 1);
        const n = inIt.length + 1;
        setEdit({
            ...BLANK_ROUND, ...(tpl ? { draw_days: tpl.draw_days, pacer_target: tpl.pacer_target, pacer_growth: tpl.pacer_growth, city_min_members: tpl.city_min_members, city_min_cities: tpl.city_min_cities } : {}),
            season_id: season?.id ?? '', name: `Round ${String(n).padStart(2, '0')}`,
            slug: season ? `${season.slug}-r${String(n).padStart(2, '0')}` : '',
            start: start && start <= seasonEnd ? start : '', end: start && start <= seasonEnd ? addDays(start, 14) : '',
        });
    };
    const set = (patch) => setEdit(e => ({ ...e, ...patch }));
    const days = edit?.start && edit?.end ? Math.round((new Date(`${edit.end}T12:00:00Z`) - new Date(`${edit.start}T12:00:00Z`)) / 86_400_000) + 1 : null;

    const saveRound = async () => {
        const e = edit;
        if (!e.name.trim() || !/^[a-z0-9-]{3,40}$/.test(e.slug)) { toast.error('Give it a name and a slug (a-z, 0-9 and dashes)'); return; }
        if (!e.start || !e.end) { toast.error('Pick a first and last day'); return; }
        if (days < 1) { toast.error('The last day is before the first day'); return; }
        if (Number(e.draw_days) > days) { toast.error(`The Draw can’t need more than the round’s ${days} days`); return; }
        if (e.invite && e.invite >= e.start) { toast.error('The invite race has to open before the round’s first day'); return; }
        const row = {
            name: e.name.trim(), slug: e.slug, season_id: e.season_id || null,
            starts_at: `${e.start} 00:00 Europe/London`,
            ends_at: `${addDays(e.end, 1)} 00:00 Europe/London`,
            draw_days: Number(e.draw_days), pacer_target: Number(e.pacer_target), pacer_growth: Number(e.pacer_growth),
            city_min_members: Number(e.city_min_members), city_min_cities: Number(e.city_min_cities), published: !!e.published,
            invite_from: !e.invite ? null
                : e.inviteWas && londonDay(e.inviteWas) === e.invite ? e.inviteWas : `${e.invite} 00:00 Europe/London`,
        };
        setBusy(true);
        const res = e.id
            ? await supabase.from('series_rounds').update(row).eq('id', e.id).select().single()
            : await supabase.from('series_rounds').insert(row).select().single();
        setBusy(false);
        if (res.error) { toast.error(rpcError(res.error)); return; }
        await logAction(user.id, e.id ? 'series_round_update' : 'series_round_create', 'series_round', res.data.id, row);
        toast.success(e.id ? 'Round saved' : 'Round added');
        setEdit(null);
        onSaved(res.data.slug);
    };
    const removeRound = async () => {
        const { error } = await supabase.from('series_rounds').delete().eq('id', del.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'series_round_delete', 'series_round', del.id, { slug: del.slug, name: del.name });
        toast.success('Round deleted');
        setDel(null);
        onSaved(null);
    };

    // ── Seasons
    const openSeason = (se) => setSeasonEdit(se ? {
        id: se.id, name: se.name, slug: se.slug, look: se.look, number: se.number, code: se.code ?? '',
        start: String(se.starts_on).slice(0, 10), end: String(se.ends_on).slice(0, 10), published: se.published,
    } : nextSeason([...seasons].sort((a, b) => String(b.ends_on).localeCompare(String(a.ends_on)))[0], Math.max(0, ...seasons.map(x => x.number)) + 1));
    const setS = (patch) => setSeasonEdit(e => ({ ...e, ...patch }));
    const seasonBackwards = !!(seasonEdit?.start && seasonEdit?.end && seasonEdit.end < seasonEdit.start);
    const saveSeason = async () => {
        const e = seasonEdit;
        if (!e.name.trim() || !/^[a-z0-9-]{3,40}$/.test(e.slug)) { toast.error('Give it a name and a slug (a-z, 0-9 and dashes)'); return; }
        if (!e.start || !e.end) { toast.error('Pick a first and last day'); return; }
        if (e.end < e.start) { toast.error('The last day is before the first day'); return; }
        const row = { name: e.name.trim(), slug: e.slug, look: e.look, number: Number(e.number), code: e.code.trim() || null, starts_on: e.start, ends_on: e.end };
        if (!e.id) row.published = false;
        setBusy(true);
        const res = e.id
            ? await supabase.from('series_seasons').update(row).eq('id', e.id).select().single()
            : await supabase.from('series_seasons').insert(row).select().single();
        setBusy(false);
        if (res.error) { toast.error(rpcError(res.error)); return; }
        await logAction(user.id, e.id ? 'series_season_update' : 'series_season_create', 'series_season', res.data.id, row);
        toast.success(e.id ? 'Season saved' : 'Season added as a draft');
        setSeasonEdit(null);
        onSaved(null);
    };
    const doPublish = async () => {
        const { season: se, on } = publish;
        const r1 = await supabase.from('series_seasons').update({ published: on }).eq('id', se.id);
        if (r1.error) { toast.error(rpcError(r1.error)); return; }
        let n = 0;
        if (on && withRounds) {
            const r2 = await supabase.from('series_rounds').update({ published: true }).eq('season_id', se.id).eq('published', false).select('id');
            if (r2.error) { toast.error(rpcError(r2.error)); return; }
            n = r2.data?.length ?? 0;
        }
        await logAction(user.id, on ? 'series_season_publish' : 'series_season_unpublish', 'series_season', se.id, { slug: se.slug, rounds: n });
        toast.success(on ? `${se.name} is live${n ? ` with ${n} round${n === 1 ? '' : 's'}` : ''}` : `${se.name} and its rounds are hidden`);
        setPublish(null);
        onSaved(null);
    };
    const runPlan = async () => {
        const until = lastOfMonth(plan.until);
        setBusy(true);
        const { data, error } = await supabase.rpc('admin_series_plan', { p_until: until, p_days: Number(plan.days), p_start_day: Number(plan.start) });
        setBusy(false);
        if (error) { toast.error(rpcError(error)); return; }
        await logAction(user.id, 'series_plan', 'series_season', null, { until, ...data });
        toast.success(data.seasons || data.rounds ? `Drafted ${data.seasons} season${data.seasons === 1 ? '' : 's'} and ${data.rounds} round${data.rounds === 1 ? '' : 's'}` : 'Already planned that far');
        setPlan(null);
        onSaved(null);
    };

    const orphans = rounds.filter(r => !r.season_id);
    const ordered = focus ? [focus, ...seasons.filter(x => x.id !== focus.id)] : seasons;
    const nextYear = () => { const d = new Date(); return `${d.getUTCFullYear() + 1}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

    const RoundRow = ({ r }) => {
        const st = roundState(r);
        return (
            <div className="flex items-center gap-5 px-6 py-4 hover:bg-[#FAFAF8]">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[14px] font-semibold text-[#1A1A1A]">{r.name}</span>
                        <code className="text-[10px] font-mono text-[#999999] bg-[#F4F4F1] border border-[#EAEAE5] rounded-md px-1.5 py-0.5">{r.slug}</code>
                        <Pill color={st.color}>{st.label}</Pill>
                        {r.published ? <Pill color="#10B981"><Eye size={10} /> Published</Pill> : <Pill color="#F97316"><EyeOff size={10} /> Draft</Pill>}
                    </div>
                    <p className="text-[12px] text-[#777777]">
                        {fmtDay(londonDay(r.starts_at))} – {fmtDay(lastDay(r.ends_at))} · {st.days} days · Draw needs {r.draw_days} ·
                        board {fmtN(r.pacer_target)} +{r.pacer_growth}/day · cities {r.city_min_cities} × {r.city_min_members}
                        {r.invite_from ? ` · invite race from ${fmtDay(londonDay(r.invite_from))}` : ''}
                    </p>
                </div>
                <button className={btnQuiet} onClick={() => openRound(r)}>Edit</button>
                <button className={btnDanger} onClick={() => setDel(r)} disabled={st.key !== 'upcoming'} title={st.key !== 'upcoming' ? 'Only a round that hasn’t started can be deleted' : undefined}>
                    <Trash2 size={13} />
                </button>
            </div>
        );
    };

    return (
        <>
            <Section title="Seasons" blurb="Four a year, each with a round a month: Autumn (Oct–Dec), Winter (Jan–Mar), Spring (Apr–Jun), Summer (Jul–Sep). The app wears the season that’s on: its name, colours and Nº. Drafts are invisible in the app until you publish them; a round can only go live in a published season."
                right={<div className="flex items-center gap-2">
                    <button className={btnQuiet} onClick={() => setPlan({ until: nextYear(), start: 1, days: 15 })}><CalendarDays size={13} /> Plan ahead</button>
                    <button className={btnGold} onClick={() => openSeason(null)}><Plus size={13} /> Add a season</button>
                </div>}>
                {seasons.length === 0 && orphans.length === 0 ? <Empty icon={CalendarDays} text="No seasons yet: plan ahead to draft the year" /> : (
                    <div className="space-y-5">
                        {ordered.map(se => {
                            const st = seasonState(se);
                            const its = rounds.filter(r => r.season_id === se.id);
                            const drafts = its.filter(r => !r.published).length;
                            return (
                                <div key={se.id} className={`${card} overflow-hidden ${focus?.id === se.id ? 'ring-2 ring-[#E8D200]/50' : ''}`}>
                                    <div className="flex items-center gap-5 px-6 py-5 border-b border-[#F0F0EC]">
                                        <span className="w-12 h-12 rounded-2xl shrink-0" style={{ background: LOOKS[se.look]?.colour }} title={`${LOOKS[se.look]?.label} look`} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                                                <span className="text-[17px] font-bold text-[#1A1A1A] tracking-tight">{se.name}</span>
                                                <span className="text-[11px] font-black tracking-[0.12em] text-[#B8A800]">{seasonNo(se)}</span>
                                                <Pill color={st.color}>{st.label}</Pill>
                                                {se.published ? <Pill color="#10B981"><Eye size={10} /> Published</Pill> : <Pill color="#F97316"><EyeOff size={10} /> Draft</Pill>}
                                            </div>
                                            <p className="text-[12.5px] text-[#777777]">
                                                {fmtDay(se.starts_on)} – {fmtDay(se.ends_on)} · {LOOKS[se.look]?.label} look · {its.length} round{its.length === 1 ? '' : 's'}{drafts ? ` (${drafts} draft${drafts === 1 ? '' : 's'})` : ''}
                                            </p>
                                        </div>
                                        <button className={btnQuiet} onClick={() => openRound(null, se)}><Plus size={13} /> Round</button>
                                        <button className={btnQuiet} onClick={() => openSeason(se)}>Edit</button>
                                        {se.published
                                            ? <button className={btnDanger} onClick={() => setPublish({ season: se, on: false })}><EyeOff size={13} /> Unpublish</button>
                                            : <button className={btnGold} onClick={() => { setWithRounds(true); setPublish({ season: se, on: true }); }}><Eye size={13} /> Publish</button>}
                                    </div>
                                    {its.length === 0
                                        ? <div className="px-6 py-4 text-[12.5px] text-[#999999]">No rounds yet.</div>
                                        : <div className="divide-y divide-[#F4F4F1]">{its.map(r => <RoundRow key={r.id} r={r} />)}</div>}
                                </div>
                            );
                        })}
                        {orphans.length > 0 && (
                            <div className={`${card} overflow-hidden`}>
                                <div className="px-6 py-4 border-b border-[#F0F0EC] text-[12.5px] text-[#999999]">Not in a season: edit a round to put it in one.</div>
                                <div className="divide-y divide-[#F4F4F1]">{orphans.map(r => <RoundRow key={r.id} r={r} />)}</div>
                            </div>
                        )}
                    </div>
                )}
            </Section>

            {edit && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setEdit(null)}>
                    <div className={`${card} w-full max-w-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">{edit.id ? 'Edit round' : 'Add a round'}</h3>
                            <button className="w-9 h-9 rounded-xl hover:bg-[#F4F4F1] flex items-center justify-center" onClick={() => setEdit(null)}><X size={16} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                            <Field label="Season" hint="Its dates have to sit inside the season">
                                <select className={input} value={edit.season_id} onChange={e => set({ season_id: e.target.value })}>
                                    <option value="">No season</option>
                                    {seasons.map(se => <option key={se.id} value={se.id}>{se.name} · {monthSpan(se)}</option>)}
                                </select>
                            </Field>
                            <Field label="Name" hint="What the app calls it: “Round 02”"><input className={input} value={edit.name} onChange={e => set({ name: e.target.value })} /></Field>
                            <Field label="Slug" hint="Never shown to members">
                                <input className={`${input} font-mono`} value={edit.slug} onChange={e => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="winter-27-r02" />
                            </Field>
                            <div />
                            <Field label="First day"><input type="date" className={input} value={edit.start} onChange={e => set({ start: e.target.value })} /></Field>
                            <Field label="Last day" hint={days > 0 ? `${days} days, ends at midnight after ${fmtDay(edit.end)}` : undefined}>
                                <input type="date" className={`${input} ${days != null && days < 1 ? 'border-[#F43F5E]/60' : ''}`} value={edit.end} onChange={e => set({ end: e.target.value })} />
                            </Field>
                            {days != null && days < 1 && <p className="col-span-2 -mt-2 text-[12px] font-semibold text-[#E11D48]">The last day ({fmtDay(edit.end)}) is before the first day ({fmtDay(edit.start)}).</p>}
                            <Field label="Days to log for The Draw"><input type="number" min={1} className={input} value={edit.draw_days} onChange={e => set({ draw_days: e.target.value })} /></Field>
                            <Field label="Invite race opens" hint="Friends who join from here until the round starts count for Patient Zero. Opens by itself when the Series goes on; empty = none.">
                                <input type="date" className={input} value={edit.invite ?? ''} onChange={e => set({ invite: e.target.value })} />
                            </Field>
                            <Field label="Board size on day 1" hint="Pacers fill the gap to this; 0 = no pacers"><input type="number" min={0} className={input} value={edit.pacer_target} onChange={e => set({ pacer_target: e.target.value })} /></Field>
                            <Field label="Board grows by (a day)" hint="So the size doesn’t sit still"><input type="number" min={0} className={input} value={edit.pacer_growth} onChange={e => set({ pacer_growth: e.target.value })} /></Field>
                            <Field label="City: real members to rank"><input type="number" min={1} className={input} value={edit.city_min_members} onChange={e => set({ city_min_members: e.target.value })} /></Field>
                            <Field label="City: ranked cities to open"><input type="number" min={1} className={input} value={edit.city_min_cities} onChange={e => set({ city_min_cities: e.target.value })} /></Field>
                        </div>
                        <label className="flex items-center gap-3 mt-6 p-4 rounded-2xl bg-[#FAFAF8] border border-[#EAEAE5] cursor-pointer">
                            <input type="checkbox" checked={edit.published} onChange={e => set({ published: e.target.checked })} className="w-4 h-4 accent-[#B8A800]" />
                            <span className="text-[13px] text-[#333333]"><b>Published</b> · the app can see this round (as “next round” before it starts). Its season has to be published.</span>
                        </label>
                        <div className="flex justify-end gap-3 mt-7">
                            <button className={btnQuiet} onClick={() => setEdit(null)}>Cancel</button>
                            <button className={btnGold} onClick={saveRound} disabled={busy || (days != null && days < 1)}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
                        </div>
                    </div>
                </div>
            )}

            {seasonEdit && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setSeasonEdit(null)}>
                    <div className={`${card} w-full max-w-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">{seasonEdit.id ? 'Edit season' : 'Add a season'}</h3>
                            <button className="w-9 h-9 rounded-xl hover:bg-[#F4F4F1] flex items-center justify-center" onClick={() => setSeasonEdit(null)}><X size={16} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                            <Field label="Name" hint="What the app calls it: “Winter Series”"><input className={input} value={seasonEdit.name} onChange={e => setS({ name: e.target.value })} /></Field>
                            <Field label="Slug" hint="Never shown to members">
                                <input className={`${input} font-mono`} value={seasonEdit.slug} onChange={e => setS({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="winter-27" />
                            </Field>
                            <div className="col-span-2">
                                <Field label="Look" hint="The colours and mark the whole app wears during the season">
                                    <div className="flex gap-2">
                                        {Object.entries(LOOKS).map(([k, l]) => (
                                            <button key={k} type="button" onClick={() => setS({ look: k })}
                                                className={`flex items-center gap-2.5 h-11 pl-1.5 pr-4 rounded-xl border transition-all ${seasonEdit.look === k ? 'border-[#B8A800] bg-[#E8D200]/10' : 'border-[#E6E6E1] hover:border-[#D8D8D2]'}`}>
                                                <span className="w-8 h-8 rounded-lg" style={{ background: l.colour }} />
                                                <span className="text-[12.5px] font-semibold text-[#1A1A1A]">{l.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </Field>
                            </div>
                            <Field label="Nº" hint={`Shown as Nº ${String(seasonEdit.number || 1).padStart(2, '0')} on the card`}><input type="number" min={1} className={input} value={seasonEdit.number} onChange={e => setS({ number: e.target.value })} /></Field>
                            <Field label="Code" hint="Beside the Nº: AW for autumn and winter, SS for spring and summer, then the year (AW26, SS27)"><input className={`${input} font-mono`} value={seasonEdit.code} onChange={e => setS({ code: e.target.value.toUpperCase() })} /></Field>
                            <Field label="First day"><input type="date" className={input} value={seasonEdit.start} onChange={e => setS({ start: e.target.value })} /></Field>
                            <Field label="Last day" hint={seasonBackwards ? undefined : seasonEdit.start && seasonEdit.end ? `${fmtDay(seasonEdit.start)} to ${fmtDay(seasonEdit.end)}` : undefined}>
                                <input type="date" className={`${input} ${seasonBackwards ? 'border-[#F43F5E]/60' : ''}`} value={seasonEdit.end} onChange={e => setS({ end: e.target.value })} />
                            </Field>
                            {seasonBackwards && <p className="col-span-2 -mt-2 text-[12px] font-semibold text-[#E11D48]">The last day ({fmtDay(seasonEdit.end)}) is before the first day ({fmtDay(seasonEdit.start)}).</p>}
                        </div>
                        {!seasonEdit.id && <p className="mt-5 text-[12px] text-[#999999]">New seasons start as drafts. Publish one from its card when its rounds are ready.</p>}
                        <div className="flex justify-end gap-3 mt-7">
                            <button className={btnQuiet} onClick={() => setSeasonEdit(null)}>Cancel</button>
                            <button className={btnGold} onClick={saveSeason} disabled={busy || seasonBackwards}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
                        </div>
                    </div>
                </div>
            )}

            <Confirm open={!!plan} title="Plan ahead"
                body="Drafts every season and a round a month up to the month you pick, skipping months that already have a round. New rounds copy the latest round’s settings. Nothing reaches the app until you publish it."
                confirmLabel="Draft them" onCancel={() => setPlan(null)} onConfirm={runPlan}
                extra={plan && (
                    <div className="grid grid-cols-2 gap-3 mb-2">
                        <div className="col-span-2">
                            <Field label="Up to (the last month to plan)"><input type="month" className={`${input} w-full`} value={plan.until} onChange={e => setPlan(p => ({ ...p, until: e.target.value }))} /></Field>
                        </div>
                        <Field label="From day"><input type="number" min={1} max={28} className={input} value={plan.start} onChange={e => setPlan(p => ({ ...p, start: e.target.value }))} /></Field>
                        <Field label="For days"><input type="number" min={1} max={28} className={input} value={plan.days} onChange={e => setPlan(p => ({ ...p, days: e.target.value }))} /></Field>
                    </div>
                )} />
            <Confirm open={!!publish} danger={publish && !publish.on}
                title={publish?.on ? `Publish ${publish?.season.name}?` : `Unpublish ${publish?.season.name}?`}
                body={publish?.on
                    ? 'The app can see it: as the season that’s on, or as the next one. Check its prizes are set on each round first.'
                    : 'It and all its rounds disappear from the app. Points already scored stay where they are.'}
                confirmLabel={publish?.on ? 'Publish' : 'Unpublish'} onCancel={() => setPublish(null)} onConfirm={doPublish}
                extra={publish?.on && (
                    <label className="flex items-center gap-2.5 mb-4 text-[12.5px] text-[#555555] cursor-pointer">
                        <input type="checkbox" checked={withRounds} onChange={e => setWithRounds(e.target.checked)} className="accent-[#B8A800]" /> Publish its draft rounds too
                    </label>
                )} />
            <Confirm open={!!del} danger title={`Delete ${del?.name}?`} body="Its prizes and pacer plan go with it. Only a round that hasn’t started can be deleted."
                confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={removeRound} />
        </>
    );
}

// ── Prizes ───────────────────────────────────────────────────────────────────

// One prize each: settling gives the places, then these in this order, passing
// over anyone who already holds a prize; Every Move Counts and the top city are
// drawn last from whoever's left (20261025120000).
const NAMED_KINDS = [
    { kind: 'most_wanted', title: 'Most Wanted', icon: Target, blurb: 'Most bounties claimed: taking the lead from a member claims one (checked every 15 minutes, paused in Blind Mode).', unit: (n) => `${n} bount${n === 1 ? 'y' : 'ies'}` },
    { kind: 'hot_streak', title: 'Hot Streak', icon: Flame, blurb: 'Most days in a row with a paying session.', unit: (n) => `${n} days in a row` },
    { kind: 'biggest_mover', title: 'Biggest Mover', icon: TrendingUp, blurb: 'Most places climbed from the end of day 3 to the finish (members only).', unit: (n) => `▲${n} places` },
    { kind: 'underdog', title: 'Underdog', icon: ArrowUpCircle, blurb: 'Best finish from the bottom half at halfway (members only).', unit: (n) => `finished #${n}` },
    { kind: 'patient_zero', title: 'Patient Zero', icon: Users, blurb: 'Most friends who joined with their code during The Plague (the whole round if there’s no Plague moment) and logged a verified workout before the end.', unit: (n) => `${n} friend${n === 1 ? '' : 's'}` },
    { kind: 'photo_finish', title: 'Photo Finish', icon: Timer, blurb: 'Most Series points on the last day.', unit: (n) => `${n} pts on the last day` },
];
const PRIZE_KINDS = [
    ...NAMED_KINDS.map(k => ({ ...k, many: false })),
    { kind: 'draw', title: 'Every Move Counts', icon: Ticket, blurb: 'Drawn at random from everyone who logged enough days and holds no other prize.', many: true },
    { kind: 'city', title: 'Top city', icon: MapPin, blurb: 'Parked until the city game opens: only paid when set. Drawn from the members of the city with the best average.', many: true },
    { kind: 'golden', title: 'Golden P', icon: Crown, blurb: 'For whoever finds it (the Golden P isn’t live on the server yet).', many: true },
];
const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`);

function PrizesTab({ round }) {
    const toast = useToast();
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const [draft, setDraft] = useState({}); // id or 'new-<kind>[-place]' -> row

    const load = useCallback(async () => {
        const { data, error } = await supabase.from('series_prizes').select('*').eq('round_id', round.id).order('kind').order('place');
        if (error) toast.error(error.message);
        setRows(data ?? []);
        setDraft({});
    }, [round.id, toast]);
    useEffect(() => { load(); }, [load]);

    const places = (rows ?? []).filter(r => r.kind === 'place').sort((a, b) => a.place - b.place);
    const val = (r) => draft[r.id] ?? r;
    const change = (r, patch) => setDraft(d => ({ ...d, [r.id]: { ...val(r), ...patch } }));

    const save = async (r) => {
        const v = val(r);
        if (!v.name?.trim()) { toast.error('A prize needs a name'); return; }
        const row = { round_id: round.id, kind: v.kind, place: v.kind === 'place' ? v.place : null, name: v.name.trim(),
            sponsor: v.sponsor?.trim() || null, detail: v.detail?.trim() || null, image_url: v.image_url ?? null,
            winners: v.kind === 'place' ? 1 : Math.max(1, Number(v.winners) || 1), updated_at: new Date().toISOString() };
        const res = r.id.startsWith('new')
            ? await supabase.from('series_prizes').insert(row).select().single()
            : await supabase.from('series_prizes').update(row).eq('id', r.id).select().single();
        if (res.error) { toast.error(rpcError(res.error)); return; }
        await logAction(user.id, r.id.startsWith('new') ? 'series_prize_create' : 'series_prize_update', 'series_prize', res.data.id, { round: round.slug, ...row });
        toast.success('Prize saved');
        load();
    };
    const remove = async (r) => {
        if (r.id.startsWith('new')) { setRows(rs => rs.filter(x => x.id !== r.id)); return; }
        const { error } = await supabase.from('series_prizes').delete().eq('id', r.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'series_prize_delete', 'series_prize', r.id, { round: round.slug, name: r.name });
        toast.success('Prize removed');
        load();
    };
    const addPlace = () => {
        const next = (places.at(-1)?.place ?? 0) + 1;
        setRows(rs => [...rs, { id: `new-place-${next}`, kind: 'place', place: next, name: '', sponsor: '', detail: '', image_url: null, winners: 1 }]);
    };
    const addKind = (kind) => setRows(rs => [...rs, { id: `new-${kind}`, kind, place: null, name: '', sponsor: '', detail: '', image_url: null, winners: kind === 'city' ? 5 : kind === 'draw' ? 3 : kind === 'golden' ? 10 : 1 }]);

    if (!rows) return <Loading />;
    return (
        <>
            <Section title="Places" blurb="Finishing places, won by points. The app shows these on the race and in “Ways to win”. Without any, settling still names a top 3."
                right={<button className={btnQuiet} onClick={addPlace}><Plus size={13} /> Add a place</button>}>
                {places.length === 0 ? <Empty icon={Trophy} text="No place prizes yet" /> : (
                    <div className="space-y-3">{places.map(r => <PrizeRow key={r.id} r={val(r)} dirty={!!draft[r.id] || r.id.startsWith('new')} onChange={p => change(r, p)} onSave={() => save(r)} onRemove={() => remove(r)} />)}</div>
                )}
            </Section>
            {PRIZE_KINDS.map(k => {
                const r = rows.find(x => x.kind === k.kind);
                return (
                    <Section key={k.kind} title={k.title} blurb={k.blurb}
                        right={!r && <button className={btnQuiet} onClick={() => addKind(k.kind)}><Plus size={13} /> Add</button>}>
                        {r ? <PrizeRow r={val(r)} many={k.many} dirty={!!draft[r.id] || r.id.startsWith('new')} onChange={p => change(r, p)} onSave={() => save(r)} onRemove={() => remove(r)} />
                            : <div className={`${card} px-6 py-5 text-[12.5px] text-[#999999]`}>Not set. {k.kind === 'draw' ? 'Settling draws 3 winners without one.' : 'Nothing is awarded.'}</div>}
                    </Section>
                );
            })}
        </>
    );
}

function PrizeRow({ r, many, dirty, onChange, onSave, onRemove }) {
    return (
        <div className={`${card} flex items-start gap-5 p-4`}>
            <PrizeImage value={r.image_url} onChange={url => onChange({ image_url: url })} />
            <div className="flex-1 min-w-0 grid grid-cols-2 gap-3">
                <div className="col-span-2 flex items-center gap-3">
                    {r.kind === 'place' && <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#B8A800] w-10 shrink-0">{ordinal(r.place)}</span>}
                    <input className={`${input} flex-1`} value={r.name ?? ''} placeholder="Prize · e.g. Wellness day for two" onChange={e => onChange({ name: e.target.value })} />
                </div>
                <input className={input} value={r.sponsor ?? ''} placeholder="From · e.g. Mandarin Oriental" onChange={e => onChange({ sponsor: e.target.value })} />
                {many ? (
                    <div className="flex items-center gap-2">
                        <input type="number" min={1} max={100} className={`${input} w-24`} value={r.winners ?? 1} onChange={e => onChange({ winners: e.target.value })} />
                        <span className="text-[11px] text-[#999999]">winners</span>
                    </div>
                ) : <div />}
                <input className={`${input} col-span-2`} value={r.detail ?? ''} placeholder="One line · e.g. A 2-hour ritual with spa access" onChange={e => onChange({ detail: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
                <button className={btnGold} onClick={onSave} disabled={!dirty}><Save size={13} /> Save</button>
                <button className={btnDanger} onClick={onRemove}><Trash2 size={13} /></button>
            </div>
        </div>
    );
}

function PrizeImage({ value, onChange }) {
    const toast = useToast();
    const [uploading, setUploading] = useState(false);
    const handle = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type?.startsWith('image/')) { toast.error('That isn’t an image'); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error('Keep the image under 5MB'); return; }
        setUploading(true);
        try { onChange(await uploadPublicImage('reward-images', file, 'series-prizes')); toast.success('Image uploaded: save to apply'); }
        catch (err) { toast.error(err.message ?? 'Upload failed'); }
        finally { setUploading(false); }
    };
    return (
        <label className={`relative w-[104px] h-[104px] shrink-0 rounded-2xl overflow-hidden cursor-pointer flex items-center justify-center ${value ? 'bg-[#141414]' : 'border border-dashed border-[#D8D8D2] bg-[#FAFAF8] text-[#999999] hover:text-[#1A1A1A]'} ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {value ? <img src={storageImage(value, 256)} alt="" className="w-full h-full object-cover" />
                : (uploading ? <LoaderCircle size={16} className="animate-spin" /> : <span className="flex flex-col items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em]"><ImagePlus size={16} />Image</span>)}
            <input type="file" accept="image/*" className="hidden" onChange={handle} disabled={uploading} />
        </label>
    );
}

// ── Moments ──────────────────────────────────────────────────────────────────

// What each moment does on the server (20261023090000_series_moments.sql).
const MOMENT_KINDS = {
    gun:         { label: 'The Gun', icon: Flag, blurb: 'The round opens. An announcement, nothing else.', boost: false,
                   name: 'The Gun', line: 'The board is live. Every verified session counts from now.' },
    double_down: { label: 'Double Down', icon: Zap, blurb: 'The activities you pick count more for the window.', boost: true,
                   name: 'Double Down', line: 'Runs count 2× today, until midnight.', multiplier: 2, activities: ['running'] },
    event_night: { label: 'Event night', icon: MapPin, blurb: 'Sessions verified at one venue count more.', boost: true,
                   name: 'Event night', line: 'Check in at the event for 2× Series points.', multiplier: 2 },
    power_hour:  { label: 'Power Hour', icon: Timer, blurb: 'Every session counts more for the window.', boost: true,
                   name: 'Power Hour', line: 'Every session counts 2× for the next hour.', multiplier: 2 },
    all_in:      { label: 'All In', icon: Flame, blurb: 'Everyone outside the top N (when it starts) gets the boost.', boost: true,
                   name: 'All In', line: 'The last 48 hours: ×1.5 for everyone outside the top 10.', multiplier: 1.5, top_n: 10 },
    blind:       { label: 'Blind Mode', icon: EyeOff, blurb: 'Every rank hidden while it’s on, and no “passed you” pushes.', boost: false,
                   name: 'Blind Mode', line: 'Every rank is hidden. Keep moving.' },
    plague:      { label: 'The Plague', icon: Users, blurb: 'No boost. Friends who join with a member’s code in this window count for Patient Zero.', boost: false,
                   name: 'The Plague', line: 'For two days, every friend who joins with your code counts for Patient Zero.' },
};
const MOMENT_ACTIVITIES = ['running', 'cycling', 'gym', 'swimming', 'walking', 'hiit', 'yoga', 'sports', 'dance'];

/** 'YYYY-MM-DDTHH:MM' in London, for a datetime-local input. */
const londonInput = (iso) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const g = (t) => parts.find(p => p.type === t)?.value;
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
};
/** A datetime-local value, read as London time, the way Postgres takes it. */
const londonValue = (v) => `${v.replace('T', ' ')} Europe/London`;
/** Day n of the round (1 = first day) at hh:mm, as an input value. */
const roundAt = (round, n, hhmm = '00:00') => {
    const days = roundState(round).days;
    const d = Math.max(1, Math.min(days + 1, n));
    return `${addDays(londonDay(round.starts_at), d - 1)}T${hhmm}`;
};
/** The usual timing for each kind, scaled to the round's length. */
function defaultWindow(round, kind) {
    const days = roundState(round).days;
    const at = (n) => Math.max(1, Math.min(days, Math.round((n / 15) * days)));
    switch (kind) {
        case 'gun': return [roundAt(round, 1), roundAt(round, 2)];
        case 'double_down': return [roundAt(round, at(4)), roundAt(round, at(4) + 1)];
        case 'event_night': return [roundAt(round, at(6), '18:00'), roundAt(round, at(6) + 1)];
        case 'blind': return [roundAt(round, at(10)), roundAt(round, at(10) + 2)];
        case 'plague': return [roundAt(round, at(8)), roundAt(round, at(8) + 2)];
        case 'power_hour': return [roundAt(round, at(12), '18:00'), roundAt(round, at(12), '19:00')];
        default: return [roundAt(round, Math.max(1, days - 1)), roundAt(round, days + 1)];
    }
}
const effectOf = (m) => {
    const x = `×${Number(m.multiplier).toString()}`;
    switch (m.kind) {
        case 'double_down': return `${x} on ${(m.activities ?? []).join(', ') || 'every activity'}`;
        case 'event_night': return `${x} at ${m.partners?.name ?? 'the venue'}`;
        case 'power_hour': return `${x} on every session`;
        case 'all_in': return `${x} for everyone outside the top ${m.top_n}`;
        case 'blind': return 'Ranks hidden · no “passed you” pushes';
        case 'plague': return 'No boost · friends who join count for Patient Zero';
        default: return 'Announcement';
    }
};

function MomentsTab({ round }) {
    const toast = useToast();
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const [pushOn, setPushOn] = useState(null);
    const [edit, setEdit] = useState(null);
    const [busy, setBusy] = useState(false);
    const [del, setDel] = useState(null);
    const [venueQ, setVenueQ] = useState('');
    const [venues, setVenues] = useState([]);

    const load = useCallback(async () => {
        const [m, n] = await Promise.all([
            supabase.from('series_moments').select('*, partners(name)').eq('round_id', round.id).order('starts_at'),
            supabase.from('notification_config').select('enabled').eq('type', 'series_moment').maybeSingle(),
        ]);
        if (m.error) toast.error(m.error.message);
        setRows(m.data ?? []);
        setPushOn(n.data?.enabled ?? null);
    }, [round.id, toast]);
    useEffect(() => { load(); }, [load]);

    const open = (m, kind = 'power_hour') => {
        if (m) {
            setEdit({ ...m, start: londonInput(m.starts_at), end: londonInput(m.ends_at), venueName: m.partners?.name ?? '' });
        } else {
            const k = MOMENT_KINDS[kind];
            const [start, end] = defaultWindow(round, kind);
            setEdit({ kind, name: k.name, line: k.line, start, end, multiplier: k.multiplier ?? 1, activities: k.activities ?? null,
                partner_id: null, venueName: '', top_n: k.top_n ?? null, secret: false, push: true });
        }
        setVenueQ(''); setVenues([]);
    };
    const set = (patch) => setEdit(e => ({ ...e, ...patch }));
    const pickKind = (kind) => {
        const k = MOMENT_KINDS[kind];
        const [start, end] = defaultWindow(round, kind);
        set({ kind, name: k.name, line: k.line, multiplier: k.multiplier ?? 1, activities: k.activities ?? null, top_n: k.top_n ?? null,
            ...(edit?.id ? {} : { start, end }) });
    };
    useEffect(() => {
        if (!edit || edit.kind !== 'event_night' || venueQ.trim().length < 2) { setVenues([]); return undefined; }
        const t = setTimeout(async () => {
            const { data } = await supabase.from('partners').select('id, name, city').ilike('name', `%${venueQ.trim().replace(/[%,()]/g, ' ')}%`).order('name').limit(8);
            setVenues(data ?? []);
        }, 250);
        return () => clearTimeout(t);
    }, [venueQ, edit]);

    const backwards = !!(edit?.start && edit?.end && edit.end <= edit.start);
    const save = async () => {
        const e = edit;
        if (!e.name?.trim()) { toast.error('Give it a name'); return; }
        if (backwards) { toast.error('It has to end after it starts'); return; }
        const k = MOMENT_KINDS[e.kind];
        const row = {
            round_id: round.id, kind: e.kind, name: e.name.trim(), line: e.line?.trim() || null,
            starts_at: londonValue(e.start), ends_at: londonValue(e.end),
            multiplier: k.boost ? Number(e.multiplier) : 1,
            activities: e.kind === 'double_down' && e.activities?.length ? e.activities : null,
            partner_id: e.kind === 'event_night' ? e.partner_id : null,
            top_n: e.kind === 'all_in' ? Number(e.top_n) : null,
            secret: !!e.secret, push: !!e.push,
        };
        setBusy(true);
        const res = e.id
            ? await supabase.from('series_moments').update(row).eq('id', e.id).select().single()
            : await supabase.from('series_moments').insert(row).select().single();
        setBusy(false);
        if (res.error) { toast.error(rpcError(res.error)); return; }
        await logAction(user.id, e.id ? 'series_moment_update' : 'series_moment_create', 'series_moment', res.data.id, { round: round.slug, ...row });
        toast.success(e.id ? 'Moment saved' : 'Moment added');
        setEdit(null);
        load();
    };
    const remove = async () => {
        const { error } = await supabase.from('series_moments').delete().eq('id', del.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'series_moment_delete', 'series_moment', del.id, { round: round.slug, name: del.name });
        toast.success('Moment removed');
        setDel(null);
        load();
    };
    const usualSet = async () => {
        const kinds = ['gun', 'double_down', 'plague', 'blind', 'power_hour', 'all_in'];
        const inserts = kinds.map((kind) => {
            const k = MOMENT_KINDS[kind];
            const [start, end] = defaultWindow(round, kind);
            return { round_id: round.id, kind, name: k.name, line: k.line, starts_at: londonValue(start), ends_at: londonValue(end),
                multiplier: k.multiplier ?? 1, activities: k.activities ?? null, top_n: k.top_n ?? null, secret: false, push: true };
        });
        const { error } = await supabase.from('series_moments').insert(inserts);
        if (error) { toast.error(rpcError(error)); return; }
        await logAction(user.id, 'series_moment_usual_set', 'series_round', round.id, { round: round.slug, kinds });
        toast.success('Added The Gun, Double Down, Blind Mode, Power Hour and All In: check the dates');
        load();
    };

    if (!rows) return <Loading />;
    const now = Date.now();
    return (
        <>
            <Section title="Moments" blurb="Windows inside the round that change the game. Boosts multiply Series points only (never POWR points), never stack, and top out at ×2. Members see the next moment named, the later ones sealed, and a secret one only when it starts."
                right={<div className="flex items-center gap-2">
                    {rows.length === 0 && <button className={btnQuiet} onClick={usualSet}><Zap size={13} /> Add the usual set</button>}
                    <button className={btnGold} onClick={() => open(null)}><Plus size={13} /> Add a moment</button>
                </div>}>
                <div className={`${card} px-6 py-4 mb-4 flex items-center gap-3 text-[12.5px] text-[#666666]`}>
                    <Bell size={14} className="text-[#999999]" />
                    Moment pushes are {pushOn ? <b className="text-[#10B981]">on</b> : <b className="text-[#F97316]">off</b>} (each moment also has its own switch).
                    <Link to="/admin/notifications" className="inline-flex items-center gap-1.5 text-[#8a7600] font-semibold hover:underline ml-1">Switch in Notifications <ExternalLink size={12} /></Link>
                </div>
                {rows.length === 0 ? <Empty icon={Zap} text="No moments in this round yet" /> : (
                    <div className={`${card} divide-y divide-[#F4F4F1] overflow-hidden`}>
                        {rows.map(m => {
                            const K = MOMENT_KINDS[m.kind];
                            const st = now >= new Date(m.ends_at).getTime() ? { label: 'Done', color: '#6B7280' }
                                : now >= new Date(m.starts_at).getTime() ? { label: 'On now', color: '#10B981' } : { label: 'Upcoming', color: '#3B82F6' };
                            return (
                                <div key={m.id} className="flex items-center gap-5 px-6 py-4 hover:bg-[#FAFAF8]">
                                    <div className="w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center bg-[#E8D200]/10 border border-[#E8D200]/30">
                                        {K ? <K.icon size={18} className="text-[#8a7600]" /> : null}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="text-[14.5px] font-semibold text-[#1A1A1A]">{m.name}</span>
                                            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#AAAAAA]">{K?.label}</span>
                                            <Pill color={st.color}>{st.label}</Pill>
                                            {m.secret && <Pill color="#8B5CF6"><Lock size={10} /> Secret</Pill>}
                                            {m.push ? <Pill color={m.pushed_at ? '#6B7280' : '#0EA5E9'}><Bell size={10} /> {m.pushed_at ? `Pushed ${fmtWhen(m.pushed_at)}` : 'Push'}</Pill> : null}
                                        </div>
                                        <p className="text-[12.5px] text-[#777777]">{fmtWhen(m.starts_at)} → {fmtWhen(m.ends_at)} · {effectOf(m)}</p>
                                        {m.line && <p className="text-[12px] text-[#999999] mt-0.5 truncate">“{m.line}”</p>}
                                    </div>
                                    <button className={btnQuiet} onClick={() => open(m)}>Edit</button>
                                    <button className={btnDanger} onClick={() => setDel(m)}><Trash2 size={13} /></button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

            {edit && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setEdit(null)}>
                    <div className={`${card} w-full max-w-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">{edit.id ? 'Edit moment' : 'Add a moment'}</h3>
                            <button className="w-9 h-9 rounded-xl hover:bg-[#F4F4F1] flex items-center justify-center" onClick={() => setEdit(null)}><X size={16} /></button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                            {Object.entries(MOMENT_KINDS).map(([key, k]) => (
                                <button key={key} type="button" onClick={() => pickKind(key)}
                                    className={`flex items-center gap-2.5 h-12 px-3 rounded-xl border text-left transition-all ${edit.kind === key ? 'border-[#B8A800] bg-[#E8D200]/10' : 'border-[#E6E6E1] hover:border-[#D8D8D2]'}`}>
                                    <k.icon size={15} className="text-[#8a7600] shrink-0" />
                                    <span className="text-[12.5px] font-semibold text-[#1A1A1A]">{k.label}</span>
                                </button>
                            ))}
                        </div>
                        <p className="text-[12px] text-[#888888] mb-6">{MOMENT_KINDS[edit.kind]?.blurb}</p>
                        <div className="grid grid-cols-2 gap-5">
                            <Field label="Name" hint="On the card and as the push title"><input className={input} value={edit.name} onChange={e => set({ name: e.target.value })} /></Field>
                            <div />
                            <div className="col-span-2">
                                <Field label="Line" hint="One line on the card and in the push (English for now)">
                                    <input className={`${input} w-full`} maxLength={120} value={edit.line ?? ''} onChange={e => set({ line: e.target.value })} />
                                </Field>
                            </div>
                            <Field label="Starts (London)"><input type="datetime-local" className={input} value={edit.start} onChange={e => set({ start: e.target.value })} /></Field>
                            <Field label="Ends (London)">
                                <input type="datetime-local" className={`${input} ${backwards ? 'border-[#F43F5E]/60' : ''}`} value={edit.end} onChange={e => set({ end: e.target.value })} />
                            </Field>
                            {backwards && <p className="col-span-2 -mt-2 text-[12px] font-semibold text-[#E11D48]">It has to end after it starts.</p>}
                            {MOMENT_KINDS[edit.kind]?.boost && (
                                <Field label="Boost" hint="Series points only; the highest boost a session qualifies for, at most ×2">
                                    <select className={input} value={edit.multiplier} onChange={e => set({ multiplier: e.target.value })}>
                                        {[1.25, 1.5, 1.75, 2].map(x => <option key={x} value={x}>×{x}</option>)}
                                    </select>
                                </Field>
                            )}
                            {edit.kind === 'all_in' && (
                                <Field label="Who misses out" hint="The top N when it starts get no boost">
                                    <input type="number" min={1} className={input} value={edit.top_n ?? 10} onChange={e => set({ top_n: e.target.value })} />
                                </Field>
                            )}
                            {edit.kind === 'double_down' && (
                                <div className="col-span-2">
                                    <Field label="Activities that count" hint="None picked = every activity">
                                        <div className="flex flex-wrap gap-2">
                                            {MOMENT_ACTIVITIES.map(a => {
                                                const on = (edit.activities ?? []).includes(a);
                                                return (
                                                    <button key={a} type="button"
                                                        onClick={() => set({ activities: on ? edit.activities.filter(x => x !== a) : [...(edit.activities ?? []), a] })}
                                                        className={`h-9 px-3.5 rounded-full border text-[12px] font-semibold capitalize transition-all ${on ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'border-[#E6E6E1] text-[#555555] hover:border-[#D8D8D2]'}`}>
                                                        {a}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </Field>
                                </div>
                            )}
                            {edit.kind === 'event_night' && (
                                <div className="col-span-2">
                                    <Field label="Venue" hint={edit.partner_id ? `Picked: ${edit.venueName}` : 'Sessions verified at this venue get the boost'}>
                                        <input className={`${input} w-full`} value={venueQ} onChange={e => setVenueQ(e.target.value)} placeholder={edit.venueName || 'Search venues, e.g. ONE LDN'} />
                                    </Field>
                                    {venues.length > 0 && (
                                        <div className="mt-2 rounded-xl border border-[#E6E6E1] divide-y divide-[#F4F4F1] overflow-hidden">
                                            {venues.map(v => (
                                                <button key={v.id} type="button" onClick={() => { set({ partner_id: v.id, venueName: v.name }); setVenueQ(''); setVenues([]); }}
                                                    className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[#FAFAF8]">
                                                    <b>{v.name}</b>{v.city ? <span className="text-[#999999]"> · {v.city}</span> : null}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-6">
                            <label className="flex items-center gap-3 p-4 rounded-2xl bg-[#FAFAF8] border border-[#EAEAE5] cursor-pointer">
                                <input type="checkbox" checked={!!edit.secret} onChange={e => set({ secret: e.target.checked })} className="w-4 h-4 accent-[#8B5CF6]" />
                                <span className="text-[12.5px] text-[#333333]"><b>Secret</b> · a sealed card until it starts</span>
                            </label>
                            <label className="flex items-center gap-3 p-4 rounded-2xl bg-[#FAFAF8] border border-[#EAEAE5] cursor-pointer">
                                <input type="checkbox" checked={!!edit.push} onChange={e => set({ push: e.target.checked })} className="w-4 h-4 accent-[#B8A800]" />
                                <span className="text-[12.5px] text-[#333333]"><b>Push</b> · tell everyone when it starts</span>
                            </label>
                        </div>
                        <div className="flex justify-end gap-3 mt-7">
                            <button className={btnQuiet} onClick={() => setEdit(null)}>Cancel</button>
                            <button className={btnGold} onClick={save} disabled={busy || backwards || (edit.kind === 'event_night' && !edit.partner_id)}>
                                {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />} Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Confirm open={!!del} danger title={`Remove ${del?.name}?`} body="Points already boosted by it go back to normal on the board."
                confirmLabel="Remove" onCancel={() => setDel(null)} onConfirm={remove} />
        </>
    );
}

// ── Board ────────────────────────────────────────────────────────────────────

const PAGE = 50;
const flag = (code) => (code ? String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');

function BoardTab({ round }) {
    const toast = useToast();
    const { user } = useAuth();
    const [q, setQ] = useState('');
    const [search, setSearch] = useState('');
    const [realOnly, setRealOnly] = useState(false);
    const [page, setPage] = useState(0);
    const [board, setBoard] = useState(null);
    const [exclusions, setExclusions] = useState([]);
    const [act, setAct] = useState(null); // { kind: 'exclude' | 'city', row }
    const [allRounds, setAllRounds] = useState(false);
    const [city, setCity] = useState('');

    const load = useCallback(async () => {
        const [b, x] = await Promise.all([
            supabase.rpc('admin_series_board', { p_slug: round.slug, p_offset: page * PAGE, p_limit: PAGE, p_real_only: realOnly, p_search: search || null }),
            supabase.from('series_exclusions').select('*, profiles(display_name, username)').or(`round_id.eq.${round.id},round_id.is.null`).order('created_at', { ascending: false }),
        ]);
        if (b.error) toast.error(b.error.message);
        setBoard(b.data ?? { rows: [], total: 0, members: 0, pacers: 0, matches: 0 });
        setExclusions(x.data ?? []);
    }, [round.slug, round.id, page, realOnly, search, toast]);
    useEffect(() => { load(); }, [load]);

    const exclude = async (reason) => {
        const { error } = await supabase.rpc('admin_series_exclude', { p_slug: round.slug, p_user: act.row.user_id, p_reason: reason, p_every_round: allRounds });
        if (error) { toast.error(rpcError(error)); return; }
        await logAction(user.id, 'series_exclude', 'user', act.row.user_id, { round: allRounds ? 'all' : round.slug, reason });
        toast.success(`${act.row.name} is out of ${allRounds ? 'every round' : round.name}`);
        setAct(null);
        load();
    };
    const include = async (x) => {
        const { error } = await supabase.rpc('admin_series_include', { p_exclusion: x.id });
        if (error) { toast.error(rpcError(error)); return; }
        await logAction(user.id, 'series_include', 'user', x.user_id, { round: x.round_id ? round.slug : 'all' });
        toast.success('Back on the board');
        load();
    };
    const setMemberCity = async () => {
        const { error } = await supabase.rpc('admin_series_set_city', { p_slug: round.slug, p_user: act.row.user_id, p_city: city.trim() || null });
        if (error) { toast.error(rpcError(error)); return; }
        await logAction(user.id, 'series_set_city', 'user', act.row.user_id, { round: round.slug, city: city.trim() || null });
        toast.success(city.trim() ? `${act.row.name} now counts for ${city.trim()}` : `${act.row.name} is back on their gym’s city`);
        setAct(null);
        load();
    };

    const pages = board ? Math.max(1, Math.ceil(board.matches / PAGE)) : 1;
    return (
        <>
            <Section title="The board" blurb="Exactly what the app ranks, with pacers marked. “Member place” is a member’s place among members only: that’s what decides the prizes.">
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <form className="relative flex-1 min-w-[260px] max-w-md" onSubmit={e => { e.preventDefault(); setPage(0); setSearch(q.trim()); }}>
                        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                        <input className={`${input} w-full pl-11 h-11 bg-white`} value={q} onChange={e => setQ(e.target.value)} placeholder="Name, username or POWR ID, then Enter" />
                    </form>
                    <button className={realOnly ? btnGold : btnQuiet} onClick={() => { setPage(0); setRealOnly(v => !v); }}>
                        <UserCheck size={13} /> Members only
                    </button>
                    <button className={btnQuiet} onClick={load}><RefreshCw size={13} /> Refresh</button>
                    {board && <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black ml-auto">
                        {fmtN(board.total)} on the board · {fmtN(board.members)} members · {fmtN(board.pacers)} pacers
                    </span>}
                </div>
                {!board ? <Loading /> : board.rows.length === 0 ? <Empty icon={Search} text={search ? `Nobody matches “${search}”` : 'Nobody on the board yet'} /> : (
                    <div className={`${card} overflow-hidden`}>
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="text-[9.5px] font-black uppercase tracking-[0.22em] text-[#999999] border-b border-[#F0F0EC]">
                                    <th className="text-left px-6 py-3 w-16">Board</th>
                                    <th className="text-left px-2 py-3 w-20">Member place</th>
                                    <th className="text-left px-2 py-3">Name</th>
                                    <th className="text-left px-2 py-3">City</th>
                                    <th className="text-right px-2 py-3">Today</th>
                                    <th className="text-right px-2 py-3">Days</th>
                                    <th className="text-right px-2 py-3">Points</th>
                                    <th className="px-6 py-3 w-[150px]" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {board.rows.map(r => (
                                    <tr key={r.user_id} className={r.pacer ? 'text-[#AAAAAA]' : 'text-[#1A1A1A] hover:bg-[#FAFAF8]'}>
                                        <td className="px-6 py-3 tabular-nums font-mono">{r.rank}</td>
                                        <td className="px-2 py-3 tabular-nums font-mono">{r.pacer ? '' : r.real_rank <= 3 ? <span className="font-bold text-[#B8A800]">{r.real_rank}</span> : r.real_rank}</td>
                                        <td className="px-2 py-3">
                                            <span className="mr-2">{flag(r.country)}</span>
                                            {r.pacer ? r.name : <Link to={`/admin/users/${r.user_id}`} className="font-medium hover:underline">{r.name}</Link>}
                                            {r.pacer && <span className="ml-2"><Pill color="#9CA3AF"><Bot size={10} /> Pacer</Pill></span>}
                                            {r.member_id && <span className="ml-2 text-[10.5px] font-mono text-[#AAAAAA]">{r.member_id}</span>}
                                        </td>
                                        <td className="px-2 py-3">{r.city ?? <span className="text-[#CCCCCC]">—</span>}</td>
                                        <td className="px-2 py-3 text-right tabular-nums">{r.today ? `+${r.today}` : ''}</td>
                                        <td className="px-2 py-3 text-right tabular-nums">{r.pacer ? '' : r.days}</td>
                                        <td className="px-2 py-3 text-right tabular-nums font-semibold">{fmtN(r.points)}</td>
                                        <td className="px-6 py-2 text-right whitespace-nowrap">
                                            {!r.pacer && <>
                                                <button className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#8a7600] hover:underline mr-3" onClick={() => { setCity(r.city ?? ''); setAct({ kind: 'city', row: r }); }}>City</button>
                                                <button className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#E11D48] hover:underline" onClick={() => { setAllRounds(false); setAct({ kind: 'exclude', row: r }); }}>Exclude</button>
                                            </>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between px-6 py-3 border-t border-[#F0F0EC]">
                            <span className="text-[11px] text-[#999999]">{fmtN(board.matches)} {search || realOnly ? 'matching' : 'rows'} · page {page + 1} of {pages}</span>
                            <div className="flex gap-2">
                                <button className={btnQuiet} onClick={() => setPage(p => p - 1)} disabled={page === 0}><ChevronLeft size={14} /></button>
                                <button className={btnQuiet} onClick={() => setPage(p => p + 1)} disabled={page + 1 >= pages}><ChevronRight size={14} /></button>
                            </div>
                        </div>
                    </div>
                )}
            </Section>

            <Section title="Excluded" blurb="Members taken out of this round (or every round): off the board, out of every count and never a winner.">
                {exclusions.length === 0 ? <div className={`${card} px-6 py-5 text-[12.5px] text-[#999999]`}>Nobody.</div> : (
                    <div className={`${card} divide-y divide-[#F0F0EC]`}>
                        {exclusions.map(x => (
                            <div key={x.id} className="flex items-center gap-5 px-6 py-4">
                                <UserX size={16} className="text-[#E11D48] shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <Link to={`/admin/users/${x.user_id}`} className="text-[13.5px] font-semibold text-[#1A1A1A] hover:underline">
                                        {x.profiles?.display_name || x.profiles?.username || x.user_id}
                                    </Link>
                                    <div className="text-[12px] text-[#888888]">{x.reason} · {x.round_id ? round.name : 'every round'} · {fmtWhen(x.created_at)}</div>
                                </div>
                                <button className={btnQuiet} onClick={() => include(x)}><UserCheck size={13} /> Put back</button>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            <Confirm open={act?.kind === 'exclude'} danger title={`Exclude ${act?.row.name}?`}
                body="They leave the board, every count and every draw. Results already drawn aren’t touched: redraw those on Results."
                reasonLabel="Why" confirmLabel="Exclude" onCancel={() => setAct(null)} onConfirm={exclude}
                extra={<label className="flex items-center gap-2.5 mb-4 text-[12.5px] text-[#555555] cursor-pointer">
                    <input type="checkbox" checked={allRounds} onChange={e => setAllRounds(e.target.checked)} className="accent-[#E11D48]" /> From every round, not just {round.name}
                </label>} />
            <Confirm open={act?.kind === 'city'} title={`${act?.row.name}’s city`}
                body={`Which city they count for in ${round.name}. Leave it empty to go back to their gym’s city.`}
                confirmLabel="Save" onCancel={() => setAct(null)} onConfirm={setMemberCity}
                extra={<input autoFocus className={`${input} w-full`} value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Manchester" />} />
        </>
    );
}

// ── Cities ───────────────────────────────────────────────────────────────────

function CitiesTab({ round }) {
    const toast = useToast();
    const { user } = useAuth();
    const [data, setData] = useState(null);
    const [gyms, setGyms] = useState(null);
    const [gymCount, setGymCount] = useState({ shown: 0, missing: 0 });
    const [gq, setGq] = useState('');
    const [search, setSearch] = useState('');
    const [missingOnly, setMissingOnly] = useState(false);
    const [edits, setEdits] = useState({});

    const load = useCallback(async () => {
        const c = await supabase.rpc('admin_series_cities', { p_slug: round.slug });
        if (c.error) toast.error(c.error.message);
        setData(c.data ?? null);
    }, [round.slug, toast]);
    useEffect(() => { load(); }, [load]);

    // There are thousands of gyms, so the search runs on the server: 200 at a time.
    const loadGyms = useCallback(async () => {
        let req = supabase.from('partners').select('id, name, address, city, active', { count: 'exact' }).eq('category', 'gym');
        const s = search.replace(/[%,()]/g, ' ').trim();
        if (s) req = req.or(`name.ilike.%${s}%,city.ilike.%${s}%,address.ilike.%${s}%`);
        if (missingOnly) req = req.is('city', null);
        const [g, m] = await Promise.all([
            req.order('name').limit(200),
            supabase.from('partners').select('id', { count: 'exact', head: true }).eq('category', 'gym').is('city', null),
        ]);
        if (g.error) toast.error(g.error.message);
        setGyms(g.data ?? []);
        setGymCount({ shown: g.count ?? 0, missing: m.count ?? 0 });
        setEdits({});
    }, [search, missingOnly, toast]);
    useEffect(() => { loadGyms(); }, [loadGyms]);
    const shownGyms = gyms ?? [];

    const saveGym = async (g) => {
        const city = (edits[g.id] ?? '').trim() || null;
        const { error } = await supabase.from('partners').update({ city }).eq('id', g.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'partner_city_update', 'partner', g.id, { old: g.city, new: city });
        toast.success(`${g.name}: ${city ?? 'no city'}`);
        setGyms(gs => gs.map(x => (x.id === g.id ? { ...x, city } : x)));
        setGymCount(c => ({ ...c, missing: c.missing + (g.city && !city ? 1 : !g.city && city ? -1 : 0) }));
        setEdits(e => { const n = { ...e }; delete n[g.id]; return n; });
    };

    if (!data || !gyms) return <Loading />;
    const ranked = data.cities.filter(c => c.ranked).length;
    return (
        <>
            <Section title="My city" blurb={`A city ranks once it has ${data.min_members} real members; the game opens when ${data.min_cities} cities rank. Members shown in the app include pacers; the average (and the Top city prize) is real members only.`}
                right={<Pill color={data.open ? '#10B981' : '#F97316'}>{data.open ? 'Open' : `Shut · ${ranked} of ${data.min_cities} cities ranked`}</Pill>}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <Stat label="Leading city" value={data.top ?? '—'} sub="by real members’ average" />
                    <Stat label="Cities ranked" value={`${ranked} / ${data.min_cities}`} sub="needed to open the game" />
                    <Stat label="Members without a city" value={fmtN(data.no_city)} sub="no gym and haven’t picked" tone={data.no_city ? '#F97316' : undefined} />
                    <Stat label="Cities with anyone" value={fmtN(data.cities.length)} />
                </div>
                {data.cities.length === 0 ? <Empty icon={MapPin} text="No cities yet" /> : (
                    <div className={`${card} overflow-hidden`}>
                        <table className="w-full text-[13px]">
                            <thead><tr className="text-[9.5px] font-black uppercase tracking-[0.22em] text-[#999999] border-b border-[#F0F0EC]">
                                <th className="text-left px-6 py-3">City</th><th className="text-right px-3 py-3">Real members</th><th className="text-right px-3 py-3">Moving</th>
                                <th className="text-right px-3 py-3">Pacers</th><th className="text-right px-3 py-3">Avg (real)</th><th className="text-right px-3 py-3">Gyms</th><th className="text-right px-6 py-3">Status</th>
                            </tr></thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {data.cities.map(c => (
                                    <tr key={c.city} className="hover:bg-[#FAFAF8]">
                                        <td className="px-6 py-3 font-medium">{c.city}{c.city === data.top && <Crown size={12} className="inline ml-2 text-[#B8A800]" />}</td>
                                        <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtN(c.members)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">{fmtN(c.moving)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums text-[#AAAAAA]">{fmtN(c.pacers)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">{fmtN(c.avg)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">{fmtN(c.gyms)}</td>
                                        <td className="px-6 py-3 text-right">{c.ranked ? <Pill color="#10B981">Ranked</Pill> : <Pill color="#9CA3AF">{c.members}/{data.min_members}</Pill>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            <Section title="Gym cities" blurb="A member’s city comes from their gym. It’s read from the gym’s address (London postcodes and Greater London towns count as London); correct it here. A member’s own city is set on the Board tab.">
                <div className="flex items-center gap-3 mb-4">
                    <form className="relative flex-1 max-w-md" onSubmit={e => { e.preventDefault(); setSearch(gq.trim()); }}>
                        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                        <input className={`${input} w-full pl-11 h-11 bg-white`} value={gq} onChange={e => setGq(e.target.value)} placeholder="Gym, city or address, then Enter" />
                    </form>
                    <button className={missingOnly ? btnGold : btnQuiet} onClick={() => setMissingOnly(v => !v)}><AlertTriangle size={13} /> No city ({fmtN(gymCount.missing)})</button>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black ml-auto">{fmtN(gymCount.shown)} gyms</span>
                </div>
                <div className={`${card} divide-y divide-[#F4F4F1] max-h-[560px] overflow-y-auto`}>
                    {shownGyms.map(g => {
                        const v = edits[g.id] ?? g.city ?? '';
                        const dirty = edits[g.id] !== undefined && (edits[g.id].trim() || null) !== (g.city ?? null);
                        return (
                            <div key={g.id} className="flex items-center gap-4 px-6 py-3">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13.5px] font-semibold text-[#1A1A1A] truncate">{g.name}{!g.active && <span className="ml-2 text-[9px] font-black tracking-[0.15em] text-[#AAAAAA]">INACTIVE</span>}</div>
                                    <div className="text-[11.5px] text-[#999999] truncate">{g.address || 'No address'}</div>
                                </div>
                                <input className={`${input} w-44 ${g.city ? '' : 'border-[#F97316]/40'}`} value={v} placeholder="City" onChange={e => setEdits(ed => ({ ...ed, [g.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter' && dirty) saveGym(g); }} />
                                <button className={btnGold} onClick={() => saveGym(g)} disabled={!dirty}><Save size={13} /></button>
                            </div>
                        );
                    })}
                    {gymCount.shown > shownGyms.length && <div className="px-6 py-3 text-[11.5px] text-[#999999]">Showing {shownGyms.length} of {fmtN(gymCount.shown)}: search to narrow it down.</div>}
                </div>
            </Section>
        </>
    );
}

// ── Pacers ───────────────────────────────────────────────────────────────────

const KINDS = ['heavy', 'committed', 'regular', 'light', 'dormant'];

function PacersTab({ round }) {
    const toast = useToast();
    const { user } = useAuth();
    const [sum, setSum] = useState(null);
    const [list, setList] = useState(null);
    const [q, setQ] = useState('');
    const [offOnly, setOffOnly] = useState(false);

    const load = useCallback(async () => {
        const [s, l] = await Promise.all([
            supabase.rpc('admin_series_pacers', { p_slug: round.slug }),
            supabase.from('series_pacers').select('id, name, country_code, city, kind, habit, active_share, retire_order, disabled').order('retire_order', { ascending: false }).limit(2000),
        ]);
        if (s.error) toast.error(s.error.message);
        setSum(s.data ?? null);
        setList(l.data ?? []);
    }, [round.slug, toast]);
    useEffect(() => { load(); }, [load]);

    const toggle = async (p) => {
        const { error } = await supabase.from('series_pacers').update({ disabled: !p.disabled }).eq('id', p.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, p.disabled ? 'series_pacer_enable' : 'series_pacer_disable', 'series_pacer', p.id, { name: p.name });
        toast.success(p.disabled ? `${p.name} is back in the pool` : `${p.name} is off the board; the next pacer takes the seat`);
        setList(ls => ls.map(x => (x.id === p.id ? { ...x, disabled: !p.disabled } : x)));
        const s = await supabase.rpc('admin_series_pacers', { p_slug: round.slug });
        setSum(s.data ?? null);
    };

    const shown = useMemo(() => {
        const s = q.trim().toLowerCase();
        return (list ?? []).filter(p => (!offOnly || p.disabled) && (!s || p.name.toLowerCase().includes(s) || (p.city ?? '').toLowerCase().includes(s)));
    }, [list, q, offOnly]);

    if (!sum || !list) return <Loading />;
    const safe = sum.top_pacer == null || sum.real_third == null || sum.top_pacer < sum.real_third;
    return (
        <>
            <Section title="Seats" blurb={`Board size ${fmtN(sum.target)} on day 1, +${sum.growth} a day; every real member takes a seat, so each one who joins retires a pacer (the slowest first). Change the size on Seasons (edit a round).`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <Stat label={`Seats on day ${sum.day}`} value={fmtN(sum.seats)} sub={`${fmtN(sum.target)} + ${sum.growth} × ${sum.day - 1} − ${fmtN(sum.members)} members`} />
                    <Stat label="Seated now" value={fmtN(sum.seated)} sub={sum.seated < sum.seats ? 'fewer than seats: name clashes with members are skipped' : 'every seat filled'} />
                    <Stat label="Highest pacer" value={fmtN(sum.top_pacer)} sub={`real #3 on ${fmtN(sum.real_third)}`} tone={safe ? '#10B981' : '#E11D48'} />
                    <Stat label="Pool" value={fmtN(sum.pool)} sub={`${fmtN(sum.disabled)} switched off · ${fmtN(sum.planned_days)} planned sessions`} />
                </div>
                <div className={`${card} px-6 py-4 flex items-center gap-6 flex-wrap text-[12.5px] text-[#666666]`}>
                    <span className="text-[9.5px] font-black uppercase tracking-[0.25em] text-[#999999]">Seated by pace</span>
                    {KINDS.map(k => <span key={k}><b className="text-[#1A1A1A]">{fmtN(sum.by_kind?.[k] ?? 0)}</b> {k}</span>)}
                </div>
            </Section>

            <Section title="Pacers" blurb="Switch one off if its name reads badly or matches someone real. The next pacer takes its seat. Fastest first.">
                <div className="flex items-center gap-3 mb-4">
                    <div className="relative flex-1 max-w-md">
                        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                        <input className={`${input} w-full pl-11 h-11 bg-white`} value={q} onChange={e => setQ(e.target.value)} placeholder="Name or city" />
                    </div>
                    <button className={offOnly ? btnGold : btnQuiet} onClick={() => setOffOnly(v => !v)}><EyeOff size={13} /> Switched off</button>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black ml-auto">{shown.length} pacers</span>
                </div>
                <div className={`${card} divide-y divide-[#F4F4F1] max-h-[560px] overflow-y-auto`}>
                    {shown.slice(0, 300).map(p => (
                        <div key={p.id} className={`flex items-center gap-4 px-6 py-3 ${p.disabled ? 'opacity-50' : ''}`}>
                            <span className="w-6 text-center">{flag(p.country_code)}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13.5px] font-semibold text-[#1A1A1A]">{p.name}</div>
                                <div className="text-[11.5px] text-[#999999]">{p.city ?? 'no city'} · {p.kind} · {p.habit} · moves {Math.round(p.active_share * 100)}% of days</div>
                            </div>
                            <button className={p.disabled ? btnQuiet : btnDanger} onClick={() => toggle(p)}>
                                {p.disabled ? <><Eye size={13} /> Switch on</> : <><EyeOff size={13} /> Switch off</>}
                            </button>
                        </div>
                    ))}
                    {shown.length > 300 && <div className="px-6 py-3 text-[11.5px] text-[#999999]">Showing 300 of {shown.length}: search to narrow it down.</div>}
                </div>
            </Section>
        </>
    );
}

// ── Results ──────────────────────────────────────────────────────────────────

const KIND_LABEL = { place: 'Places', draw: 'Every Move Counts', city: 'Top city', ...Object.fromEntries(NAMED_KINDS.map(k => [k.kind, k.title])) };
const scoreOf = (r) => NAMED_KINDS.find(k => k.kind === r.kind)?.unit(r.score ?? 0);
const STATUS_COLOR = { provisional: '#F97316', confirmed: '#10B981', void: '#9CA3AF' };

function ResultsTab({ round }) {
    const toast = useToast();
    const { user } = useAuth();
    const [preview, setPreview] = useState(null);
    const [results, setResults] = useState(null);
    const [ask, setAsk] = useState(null); // { kind: 'settle' | 'redraw' | 'confirm' | 'announce' | 'hide', row? }
    const st = roundState(round);

    const load = useCallback(async () => {
        const [p, r] = await Promise.all([
            supabase.rpc('admin_series_settle', { p_slug: round.slug, p_preview: true }),
            supabase.from('series_results').select('*, profiles(display_name, username, referral_code), series_prizes(name, sponsor)').eq('round_id', round.id).order('kind').order('place').order('created_at'),
        ]);
        if (p.error) toast.error(p.error.message);
        setPreview(p.data ?? null);
        setResults(r.data ?? []);
    }, [round.slug, round.id, toast]);
    useEffect(() => { load(); }, [load]);

    const live = (results ?? []).filter(r => r.status !== 'void');
    const provisional = live.filter(r => r.status === 'provisional').length;
    const announced = live.some(r => r.announced_at);
    const nameOf = (r) => r.profiles?.display_name || r.profiles?.username || r.user_id;

    const run = async (fn, args, action, msg, meta = {}) => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) { toast.error(rpcError(error)); return false; }
        await logAction(user.id, action, 'series_round', round.id, { round: round.slug, ...meta, result: data });
        toast.success(typeof msg === 'function' ? msg(data) : msg);
        setAsk(null);
        load();
        return true;
    };

    if (!preview || !results) return <Loading />;
    return (
        <>
            <Section title="Who’s winning" blurb={st.key === 'ended' ? 'The round is over. Settle it to draw The Draw and the top city, then check, confirm and announce.' : 'A live preview from the board. Settling waits for the round to end (or force it to test).'}
                right={<button className={btnQuiet} onClick={load}><RefreshCw size={13} /> Refresh</button>}>
                <div className="grid md:grid-cols-3 gap-4">
                    <div className={`${card} p-6`}>
                        <div className="text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999] mb-3">Places · by points</div>
                        {preview.places.length === 0 ? <p className="text-[12.5px] text-[#999999]">Nobody has points yet.</p> : preview.places.map(p => (
                            <div key={p.user_id} className="flex items-center gap-3 py-1.5">
                                <span className="w-9 text-[11px] font-black text-[#B8A800]">{ordinal(p.place)}</span>
                                <span className="flex-1 text-[13.5px] font-medium truncate">{p.name}</span>
                                <span className="tabular-nums text-[13px]">{fmtN(p.points)}</span>
                                {p.tied && <span title="Level on points with the next place: decide it before confirming"><AlertTriangle size={13} className="text-[#F97316]" /></span>}
                            </div>
                        ))}
                    </div>
                    <Stat label="Every Move Counts" value={fmtN(preview.draw.eligible)} sub={`in it (logged ${preview.draw.days_needed}+ days, no other prize) · ${preview.draw.winners} to draw`} />
                    <Stat label="Top city" value={preview.city.name ?? '—'} sub={preview.city.name ? `${fmtN(preview.city.eligible)} members with points · ${preview.city.winners} to draw` : preview.city.winners ? 'no city has enough real members' : 'no city prize set'} />
                </div>
                {(preview.prizes ?? []).length > 0 && (
                    <div className={`${card} p-6 mt-4`}>
                        <div className="text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999] mb-3">The named prizes · one each, in order</div>
                        {preview.prizes.map(p => (
                            <div key={p.kind} className="flex items-center gap-3 py-1.5">
                                <span className="w-32 text-[11px] font-black uppercase tracking-[0.12em] text-[#B8A800]">{KIND_LABEL[p.kind]}</span>
                                <span className="flex-1 text-[13.5px] font-medium truncate">{p.name}</span>
                                <span className="tabular-nums text-[13px]">{scoreOf(p)}</span>
                                {p.tied && <span title="Level with the next in line: decide it before confirming"><AlertTriangle size={13} className="text-[#F97316]" /></span>}
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            <Section title="Results"
                right={<div className="flex items-center gap-2">
                    <button className={btnQuiet} onClick={() => setAsk({ kind: 'settle' })} disabled={live.some(r => r.status === 'confirmed')}
                        title={live.some(r => r.status === 'confirmed') ? 'Confirmed results: redraw them one at a time' : undefined}>
                        <Shuffle size={13} /> {provisional ? 'Settle again' : 'Settle and draw'}
                    </button>
                    <button className={btnQuiet} onClick={() => setAsk({ kind: 'confirm' })} disabled={!provisional}><ShieldCheck size={13} /> Confirm all</button>
                    {announced
                        ? <button className={btnDanger} onClick={() => setAsk({ kind: 'hide' })}><EyeOff size={13} /> Hide from the app</button>
                        : <button className={btnGold} onClick={() => setAsk({ kind: 'announce' })} disabled={!live.length || !!provisional}><Megaphone size={13} /> Announce</button>}
                </div>}
                blurb="Members only, one prize each. Redraw a result that can’t stand (say why, it’s on the record): a place moves everyone below up one; a named prize goes to the next in line; a draw or city win is drawn again. Announcing shows the winners in the app.">
                {results.length === 0 ? <Empty icon={Medal} text="Not settled yet" /> : (
                    <div className="space-y-6">
                        {['place', ...NAMED_KINDS.map(k => k.kind), 'city', 'draw'].map(kind => {
                            // Live results in place order, anything voided underneath.
                            const rows = results.filter(r => r.kind === kind)
                                .sort((a, b) => (a.status === 'void') - (b.status === 'void') || a.place - b.place);
                            if (!rows.length) return null;
                            return (
                                <div key={kind} className={`${card} overflow-hidden`}>
                                    <div className="px-6 py-3 border-b border-[#F0F0EC] text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999]">{KIND_LABEL[kind]}</div>
                                    <div className="divide-y divide-[#F4F4F1]">
                                        {rows.map(r => (
                                            <div key={r.id} className={`flex items-center gap-4 px-6 py-3 ${r.status === 'void' ? 'opacity-45' : ''}`}>
                                                <span className="w-10 text-[11px] font-black text-[#B8A800]">{kind === 'place' ? ordinal(r.place) : `#${r.place}`}</span>
                                                <div className="flex-1 min-w-0">
                                                    <Link to={`/admin/users/${r.user_id}`} className={`text-[13.5px] font-semibold text-[#1A1A1A] hover:underline ${r.status === 'void' ? 'line-through' : ''}`}>{nameOf(r)}</Link>
                                                    <span className="ml-2 text-[10.5px] font-mono text-[#AAAAAA]">{r.profiles?.referral_code}</span>
                                                    <div className="text-[11.5px] text-[#999999]">
                                                        {fmtN(r.points)} pts{scoreOf(r) ? ` · ${scoreOf(r)}` : ''}{r.city ? ` · ${r.city}` : ''} · {r.series_prizes?.name ?? 'no prize set'}
                                                        {r.void_reason ? ` · void: ${r.void_reason}` : ''}
                                                        {r.announced_at ? ` · announced ${fmtWhen(r.announced_at)}` : ''}
                                                    </div>
                                                </div>
                                                <Pill color={STATUS_COLOR[r.status]}>{r.status}</Pill>
                                                {r.status !== 'void' && <button className={btnQuiet} onClick={() => setAsk({ kind: 'redraw', row: r })}><Shuffle size={13} /> Redraw</button>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

            <Confirm open={ask?.kind === 'settle'} title={st.key === 'ended' ? 'Settle the round?' : 'Settle a round that’s still running?'}
                body={st.key === 'ended'
                    ? 'Places go by points, then each named prize in order, one prize each; Every Move Counts and the top city are drawn from whoever’s left. Anything not yet confirmed is replaced.'
                    : 'It’s still running, so this is a test: the places and draws will change by the end. Anything not yet confirmed is replaced.'}
                confirmLabel={st.key === 'ended' ? 'Settle and draw' : 'Settle anyway'}
                onCancel={() => setAsk(null)}
                onConfirm={() => run('admin_series_settle', { p_slug: round.slug, p_preview: false, p_force: st.key !== 'ended' }, 'series_settle',
                    (d) => `${d?.results ?? 0} results drawn: check them, then confirm`)} />
            <Confirm open={ask?.kind === 'redraw'} danger title={`Redraw ${ask?.row ? nameOf(ask.row) : ''}?`}
                body={ask?.row?.kind === 'place' ? 'Everyone below moves up one place and the next member down who holds no prize comes in last.'
                    : ask?.row && KIND_LABEL[ask.row.kind] && !['draw', 'city'].includes(ask.row.kind) ? 'Their prize is void and goes to the next in line who holds no prize.'
                        : 'Their win is void and someone else from the same pool who holds no prize is drawn.'}
                reasonLabel="Why" confirmLabel="Redraw" onCancel={() => setAsk(null)}
                onConfirm={(reason) => run('admin_series_redraw', { p_result: ask.row.id, p_reason: reason }, 'series_redraw',
                    (d) => (d?.replaced ? `${d.name} comes in` : 'Voided: nobody left to draw'), { voided: ask.row.user_id, reason })} />
            <Confirm open={ask?.kind === 'confirm'} title="Confirm these results?" body="Confirmed results can’t be wiped by settling again: only redrawn one at a time."
                confirmLabel="Confirm" onCancel={() => setAsk(null)}
                onConfirm={() => run('admin_series_confirm', { p_slug: round.slug }, 'series_confirm', (n) => `${n} confirmed`)} />
            <Confirm open={ask?.kind === 'announce'} title="Announce the winners?" body="They show in the app when the round is over. Send a Broadcast too if you want a push."
                confirmLabel="Announce" onCancel={() => setAsk(null)}
                onConfirm={() => run('admin_series_announce', { p_slug: round.slug, p_on: true }, 'series_announce', 'Announced: the winners are in the app')} />
            <Confirm open={ask?.kind === 'hide'} danger title="Hide the winners from the app?" confirmLabel="Hide" onCancel={() => setAsk(null)}
                onConfirm={() => run('admin_series_announce', { p_slug: round.slug, p_on: false }, 'series_unannounce', 'Hidden from the app')} />
        </>
    );
}
