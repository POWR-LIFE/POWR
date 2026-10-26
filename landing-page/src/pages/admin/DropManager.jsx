import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { fetchRewardCodeSupply } from '../../lib/promoCodes';
import {
    Rocket, Gift, ListOrdered, Users, Search, Plus, Save, Trash2, X, Check, RefreshCw, AlertTriangle,
    LoaderCircle, ChevronLeft, ChevronRight, ExternalLink, Flag, Database, Power, Shuffle, Ban, SlidersHorizontal,
} from 'lucide-react';

/*
 * POWR Drop, run from here: the launch switch and its testers, the prize pool,
 * the daily POWR budget, each day's opens, and a member lookup with void and
 * reissue.
 *
 * Server side: supabase/migrations/20261026180000_powr_drop.sql. Settings are
 * system_config rows, written directly as System Config does; the pool is
 * drop_prizes (admin RLS), also written directly. The opens, the lookup, voids
 * and reissues go through admin_drop_* functions. admin_void_drop and
 * admin_reissue_drop write their own audit rows; every other write here logs one.
 *
 * Target tuning (drop_starter_steps … drop_comeback_after_days) stays in System
 * Config, in its POWR Drop group.
 */

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

const ACCENT = '#E8D200';
const TABS = [
    { key: 'overview', label: 'Launch', icon: Rocket },
    { key: 'prizes', label: 'Prize pool', icon: Gift },
    { key: 'opens', label: 'Opens', icon: ListOrdered },
    { key: 'members', label: 'Members', icon: Users },
];

const TARGET_KEYS = [
    'drop_starter_steps', 'drop_starter_minutes', 'drop_stretch', 'drop_steps_floor', 'drop_steps_ceiling',
    'drop_minutes_floor', 'drop_minutes_ceiling', 'drop_comeback_share', 'drop_comeback_after_days',
];
const CONFIG_KEYS = ['drop_live', 'drop_testers', 'drop_launch_at', 'drop_daily_budget', ...TARGET_KEYS];

// ── The database might not have the Drop yet ─────────────────────────────────

const MIGRATION = 'supabase/migrations/20261026180000_powr_drop.sql';
/** A missing table, function or column, as Postgres or PostgREST reports it. */
const isMissing = (e) => !!e && (
    ['42P01', '42883', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code)
    || /does not exist|schema cache|could not find the (table|function)/i.test(e.message ?? '')
);
// Server messages are written to be read as they are (raise exception '…').
const rpcError = (e) => (isMissing(e) ? 'The Drop isn’t in the database yet' : e?.message?.replace(/^ERROR:\s*/i, '') || 'Something went wrong');

// ── Dates: the budget and the Opens day are London days ──────────────────────

const LONDON = 'Europe/London';
/** 'YYYY-MM-DD' of an instant in London. */
const londonDay = (iso) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const get = (t) => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
};
const todayLondon = () => londonDay(new Date().toISOString());
const addDays = (day, n) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const fmtDay = (day) => new Date(`${String(day).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }) : '—');
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB'));

// datetime-local speaks naive local time; the stored value is UTC ISO.
const toLocalInput = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ── Small parts (as on Series) ───────────────────────────────────────────────

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

function Pill({ color, children, title }) {
    return (
        <span title={title} className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[9.5px] font-black uppercase tracking-[0.18em] whitespace-nowrap"
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

function Warn({ children, tone = 'orange' }) {
    const c = tone === 'red'
        ? 'border-[#F43F5E]/30 bg-[#FFF1F2] text-[#BE123C]'
        : 'border-[#F97316]/30 bg-[#FFF7ED] text-[#C2410C]';
    return (
        <div className={`mb-4 px-5 py-3.5 rounded-2xl border text-[12.5px] leading-snug flex items-start gap-2.5 ${c}`}>
            <AlertTriangle size={15} className="shrink-0 mt-[1px]" /> <span>{children}</span>
        </div>
    );
}

function Toggle({ on, onChange, label, disabled }) {
    return (
        <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-[#10B981]' : 'bg-[#D8D8D2]'}`}>
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
        </button>
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

// ── Shared helpers ───────────────────────────────────────────────────────────

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// The server matches testers as uuid::text, which is lower case.
const parseIds = (v) => [...new Set(String(v ?? '').split(/[\s,]+/).filter(Boolean).map(x => x.toLowerCase()))];
const nameOf = (m) => m?.display_name || m?.username || (m?.user_id ?? m?.id ?? '').slice(0, 8) || 'Unknown member';

/** Write one system_config row the way System Config does, then log it. Returns an error message or null. */
async function writeConfig(adminId, key, value, oldValue) {
    const { data, error } = await supabase.from('system_config')
        .update({ value, updated_at: new Date().toISOString(), updated_by: adminId }).eq('key', key).select('key');
    if (error) return error.message;
    if (!data?.length) return `${key} isn’t in System Config yet: apply ${MIGRATION}`;
    await logAction(adminId, 'config_update', 'system_config', key, { old_value: oldValue, new_value: value });
    return null;
}

const KINDS = [
    { key: 'points', label: 'POWR now' },
    { key: 'vault', label: 'POWR to the Vault' },
    { key: 'partner', label: 'Partner code' },
];
const BASIS = {
    starter: { label: 'Starter', title: 'Under 5 known days: the starter target' },
    history: { label: 'Usual', title: 'Their typical day, stretched' },
    recovery: { label: 'Easy day', title: 'Eased back to their typical day after a big one' },
    comeback: { label: 'Comeback', title: 'Back after days away: asked at a share of their typical day' },
};
const STATUS = {
    sealed: { label: 'Sealed', color: '#3B82F6' },
    opened: { label: 'Opened', color: '#10B981' },
    void: { label: 'Void', color: '#9CA3AF' },
};

const rewardText = (rw) => (rw ? [rw.brand_name, rw.title].filter(Boolean).join(' · ') + (rw.value_label ? ` (${rw.value_label})` : '') : 'Unknown reward');
/** A pool row, in words. */
const poolPrizeText = (p, rewards) => (p.kind === 'points' ? `${p.amount} POWR now`
    : p.kind === 'vault' ? `${p.amount} POWR to the Vault`
        : `Code: ${rewardText(rewards?.[p.reward_id])}`);
/** A paid prize (the server's prize json), in words. */
const prizeText = (p) => {
    if (!p?.kind) return '—';
    if (p.kind === 'points') return `${p.amount} POWR now`;
    if (p.kind === 'vault') return `${p.amount} POWR to the Vault${p.vest_days ? ` · ${p.vest_days} days` : ''}`;
    return `Code: ${[p.brand, p.title ?? p.value_label].filter(Boolean).join(' · ') || 'partner'}`;
};
const voidDetailText = (d) => {
    if (!d) return '';
    if ('took_back' in d) return d.kept ? `took back ${fmtN(d.took_back)} POWR, ${fmtN(d.kept)} already spent` : `took back ${fmtN(d.took_back)} POWR`;
    if (d.vault) return d.vault === 'removed' ? 'Vault deposit removed' : 'the Vault deposit was already released';
    if (d.code) return d.code === 'expired' ? 'code expired' : 'the code was already used or gone';
    return '';
};

/** In the roll right now: on, inside its dates, in stock. */
const liveNow = (p, now = Date.now()) => p.active
    && (!p.starts_at || new Date(p.starts_at).getTime() <= now)
    && (!p.ends_at || new Date(p.ends_at).getTime() > now)
    && (p.stock == null || p.given < p.stock);
/** What an average daily open pays in POWR (partner codes count 0), or null. */
function averagePowr(prizes) {
    const live = prizes.filter(p => p.pool === 'daily' && liveNow(p));
    const w = live.reduce((s, p) => s + p.weight, 0);
    if (!w) return null;
    return live.reduce((s, p) => s + p.weight * (p.kind === 'partner' ? 0 : p.amount), 0) / w;
}

/** The pool plus the rewards it points at, for labels and the reissue picker. */
function usePool() {
    const [pool, setPool] = useState({ prizes: [], rewards: {} });
    const load = useCallback(async () => {
        const { data, error } = await supabase.from('drop_prizes').select('*').order('created_at');
        if (error) return;
        const ids = [...new Set((data ?? []).map(p => p.reward_id).filter(Boolean))];
        const r = ids.length
            ? await supabase.from('rewards').select('id, title, brand_name, value_label, integration_type, promo_code, active').in('id', ids)
            : { data: [] };
        setPool({ prizes: data ?? [], rewards: Object.fromEntries((r.data ?? []).map(x => [x.id, x])) });
    }, []);
    useEffect(() => { load(); }, [load]);
    return [pool, load];
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function DropManager() {
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview';
    // null = checking, 'ready', 'missing', or { error }
    const [db, setDb] = useState(null);

    const probe = useCallback(async () => {
        setDb(null);
        // Not a head request: PostgREST answers a missing table's HEAD with an
        // empty 404, which supabase-js reads as success.
        const [p, c] = await Promise.all([
            supabase.from('drop_prizes').select('id').limit(1),
            supabase.from('system_config').select('key').eq('key', 'drop_live'),
        ]);
        if (isMissing(p.error) || (!c.error && !(c.data ?? []).length)) { setDb('missing'); return; }
        if (p.error || c.error) { setDb({ error: (p.error ?? c.error).message }); return; }
        setDb('ready');
    }, []);
    useEffect(() => { probe(); }, [probe]);
    const onMissing = useCallback(() => setDb('missing'), []);

    const go = (key) => {
        const next = new URLSearchParams(params);
        next.set('tab', key);
        setParams(next, { replace: true });
    };

    return (
        <div className="max-w-[1200px]">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12" style={{ background: ACCENT }} />
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#B8A800] font-black">Live Ops / Home</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-4">POWR Drop</h1>
                <p className="text-[#666666] text-sm max-w-2xl leading-relaxed">
                    One sealed reward a day for each member who hits their steps or active-minutes target. The server
                    rolls a prize from the pool, pays it (POWR now, POWR to the Vault or a partner code in the Wallet)
                    and records it. Nothing reaches members while the switch is off.
                </p>
            </div>

            {db === null && <Loading />}
            {db === 'missing' && (
                <div className={`${card} p-10 text-center`}>
                    <Database size={34} className="mx-auto text-[#CCCCCC] mb-4" />
                    <p className="text-[15px] font-semibold text-[#1A1A1A] mb-2">The Drop tables aren’t in the database yet</p>
                    <p className="text-[13px] text-[#666666] leading-relaxed mb-6">
                        Apply <code className="font-mono text-[12px] bg-[#F4F4F1] border border-[#EAEAE5] rounded-md px-1.5 py-0.5">{MIGRATION}</code>, then check again. Nothing here can load or save until then.
                    </p>
                    <button className={btnQuiet} onClick={probe}><RefreshCw size={13} /> Check again</button>
                </div>
            )}
            {db?.error && (
                <div className={`${card} p-10 text-center`}>
                    <AlertTriangle size={30} className="mx-auto text-[#F97316] mb-4" />
                    <p className="text-[13px] text-[#666666] mb-6">Couldn’t reach the Drop ({db.error}).</p>
                    <button className={btnQuiet} onClick={probe}><RefreshCw size={13} /> Try again</button>
                </div>
            )}

            {db === 'ready' && (
                <>
                    <div className="flex items-center gap-1.5 mb-10 border-b border-[#E6E6E1] overflow-x-auto">
                        {TABS.map(t => {
                            const on = t.key === tab;
                            return (
                                <button key={t.key} onClick={() => go(t.key)}
                                    className={`flex items-center gap-2 h-11 px-4 -mb-px border-b-2 text-[11px] font-bold uppercase tracking-[0.22em] whitespace-nowrap transition-all ${on ? 'border-[#B8A800] text-[#1A1A1A]' : 'border-transparent text-[#AAAAAA] hover:text-[#555555]'}`}>
                                    <t.icon size={14} strokeWidth={on ? 2.4 : 1.8} /> {t.label}
                                </button>
                            );
                        })}
                    </div>
                    {tab === 'overview' && <OverviewTab onMissing={onMissing} />}
                    {tab === 'prizes' && <PrizesTab onMissing={onMissing} />}
                    {tab === 'opens' && <OpensTab onMissing={onMissing} />}
                    {tab === 'members' && <MembersTab />}
                </>
            )}
        </div>
    );
}

// ── Launch, budget, targets ──────────────────────────────────────────────────

const LIVE_MODES = [
    { key: 'off', label: 'Off', note: 'Nobody gets a Drop. Off always wins, launch date or not.' },
    { key: 'testers', label: 'Testers', note: 'Admins and the testers below get it, then everyone once the launch date passes.' },
    { key: 'on', label: 'On', note: 'Every member gets a Drop a day.' },
];

function OverviewTab({ onMissing }) {
    const toast = useToast();
    const { user } = useAuth();
    const [cfg, setCfg] = useState(null);
    const [today, setToday] = useState(null);
    const [prizes, setPrizes] = useState([]);
    const [saving, setSaving] = useState(null); // the key being written
    const [confirmOn, setConfirmOn] = useState(false);
    const [confirmLaunch, setConfirmLaunch] = useState(null); // an ISO time waiting on a yes
    const [budget, setBudget] = useState('');
    const [launchLocal, setLaunchLocal] = useState('');

    const load = useCallback(async () => {
        const [c, o, p] = await Promise.all([
            supabase.from('system_config').select('key, value, updated_at').in('key', CONFIG_KEYS),
            supabase.rpc('admin_drop_overview'),
            supabase.from('drop_prizes').select('pool, kind, amount, weight, active, stock, given, starts_at, ends_at'),
        ]);
        if (isMissing(o.error) || isMissing(p.error)) { onMissing(); return; }
        if (c.error) toast.error(c.error.message);
        if (o.error) toast.error(rpcError(o.error));
        const map = Object.fromEntries((c.data ?? []).map(r => [r.key, r]));
        setCfg(map);
        setBudget(map.drop_daily_budget?.value ?? '');
        setLaunchLocal(map.drop_launch_at?.value ? toLocalInput(map.drop_launch_at.value) : '');
        setToday(o.data ?? null);
        setPrizes(p.data ?? []);
    }, [toast, onMissing]);
    useEffect(() => { load(); }, [load]);

    const write = async (key, value, okMsg) => {
        setSaving(key);
        const err = await writeConfig(user.id, key, value, cfg?.[key]?.value);
        setSaving(null);
        if (err) { toast.error(err); return false; }
        toast.success(okMsg);
        await load();
        return true;
    };

    if (!cfg) return <Loading />;

    const live = (cfg.drop_live?.value ?? 'off').trim();
    const launchRaw = (cfg.drop_launch_at?.value ?? '').trim();
    const launchAt = launchRaw ? new Date(launchRaw) : null;
    const launchOk = !!launchAt && !Number.isNaN(launchAt.getTime());
    const launched = launchOk && launchAt.getTime() <= Date.now();
    const testerCount = parseIds(cfg.drop_testers?.value).filter(isUuid).length;
    const reach = live === 'on' ? { text: 'Everyone', color: '#10B981' }
        : live === 'testers' ? (launched ? { text: 'Everyone: the launch date has passed', color: '#10B981' }
            : { text: `Admins and ${testerCount} tester${testerCount === 1 ? '' : 's'}`, color: '#3B82F6' })
            : { text: 'Nobody', color: '#9CA3AF' };

    const setLive = (value) => write('drop_live', value,
        value === 'on' ? 'The Drop is on for everyone' : value === 'testers' ? 'The Drop is on for testers' : 'The Drop is off');

    const saveLaunch = () => {
        const iso = fromLocalInput(launchLocal);
        if (!iso) { toast.error('Pick a date and time'); return; }
        if (new Date(iso).getTime() <= Date.now() && live === 'testers') { setConfirmLaunch(iso); return; }
        write('drop_launch_at', iso, 'Launch date saved');
    };
    const chosenIso = fromLocalInput(launchLocal);

    const saveBudget = () => {
        const t = String(budget).trim();
        if (!/^\d+$/.test(t)) { toast.error('The budget is a whole number of POWR (0 or more)'); return; }
        write('drop_daily_budget', String(Number(t)), 'Budget saved');
    };

    // Today's spend against the budget (London day).
    const cap = Number(today?.budget ?? cfg.drop_daily_budget?.value ?? 0);
    const spent = Number(today?.spent ?? 0);
    const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : (spent > 0 ? 100 : 0);
    const barTone = pct >= 100 ? '#E11D48' : pct >= 80 ? '#F97316' : '#B8A800';
    const avg = averagePowr(prizes);

    // Target settings, read only here.
    const num = (k, d) => {
        const raw = String(cfg[k]?.value ?? '').trim();
        const v = Number(raw);
        return raw !== '' && Number.isFinite(v) ? v : d;
    };
    const t = {
        sSteps: num('drop_starter_steps', 6000), sMins: num('drop_starter_minutes', 20), stretch: num('drop_stretch', 1.1),
        sLo: num('drop_steps_floor', 4000), sHi: num('drop_steps_ceiling', 15000), mLo: num('drop_minutes_floor', 15),
        mHi: num('drop_minutes_ceiling', 60), share: num('drop_comeback_share', 0.7), after: num('drop_comeback_after_days', 3),
    };

    return (
        <>
            <Section title="Launch" blurb="Who gets a Drop in the app."
                right={<Pill color={reach.color}>Reaches: {reach.text}</Pill>}>
                <div className={`${card} p-6`}>
                    <div className="flex flex-wrap items-start gap-3 mb-2">
                        {LIVE_MODES.map(m => {
                            const on = m.key === live;
                            return (
                                <button key={m.key} disabled={!!saving || on}
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

                    <TestersEditor value={cfg.drop_testers?.value ?? ''} busy={saving === 'drop_testers'}
                        onSave={(v, msg) => write('drop_testers', v, msg)} />

                    <div className="mt-6 pt-6 border-t border-[#F0F0EC]">
                        <div className="text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999] mb-1.5">Launch date</div>
                        <p className="text-[12px] text-[#888888] leading-snug mb-4 max-w-2xl">
                            Only matters while the switch is on Testers: once it passes, everyone gets the Drop. Off always wins.
                        </p>
                        {launchRaw && !launchOk && <Warn tone="red">The stored launch date (“{launchRaw}”) isn’t a time the server can read, so it’s ignored. Set it again or clear it.</Warn>}
                        <div className="flex flex-wrap items-end gap-3">
                            <Field label="Opens to everyone at (your local time)"
                                hint={chosenIso ? `${fmtWhen(chosenIso)} London` : 'Not set'}>
                                <input type="datetime-local" className={`${input} w-64 font-mono`} value={launchLocal} onChange={e => setLaunchLocal(e.target.value)} />
                            </Field>
                            <div className="flex gap-2 pb-[22px]">
                                <button className={btnQuiet} onClick={saveLaunch} disabled={!!saving || !launchLocal || chosenIso === (launchOk ? launchAt.toISOString() : null)}>
                                    <Save size={13} /> {launchRaw ? 'Update' : 'Set'}
                                </button>
                                {launchRaw && (
                                    <button className={btnQuiet} onClick={() => write('drop_launch_at', '', 'Launch date cleared')} disabled={!!saving}>
                                        <X size={13} /> Clear
                                    </button>
                                )}
                            </div>
                            {launchOk && (
                                <div className="pb-[26px]">
                                    <Pill color={launched ? '#10B981' : '#3B82F6'}>{launched ? `Passed ${fmtWhen(launchRaw)}` : `Set for ${fmtWhen(launchRaw)}`}</Pill>
                                </div>
                            )}
                        </div>
                        {live === 'off' && launchOk && !launched && (
                            <p className="text-[12px] text-[#C2410C] mt-1">The switch is Off, so nothing opens on that date until it’s on Testers.</p>
                        )}
                    </div>
                </div>
            </Section>

            <Section title="Daily budget" blurb="The most POWR (now and to the Vault) all Drops pay in one London day. Partner codes cost no POWR and don’t count. Once it’s spent, the daily pool pays partner codes only, then the fallback pool pays past it.">
                <div className={`${card} p-6 grid md:grid-cols-[auto_1fr] gap-8 items-start`}>
                    <div className="flex items-end gap-3">
                        <Field label="POWR per London day">
                            <input type="number" min={0} step={50} className={`${input} w-40 font-mono`} value={budget} onChange={e => setBudget(e.target.value)} />
                        </Field>
                        <button className={btnQuiet} onClick={saveBudget} disabled={!!saving || String(budget).trim() === String(cfg.drop_daily_budget?.value ?? '').trim()}>
                            <Save size={13} /> Save
                        </button>
                    </div>
                    <div>
                        <div className="flex items-baseline justify-between gap-4 mb-2">
                            <span className="text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999]">Today · {today ? fmtDay(today.day) : '—'}</span>
                            <span className="text-[13px] tabular-nums text-[#1A1A1A]"><b>{fmtN(spent)}</b> of {fmtN(cap)} POWR</span>
                        </div>
                        <div className="h-3 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barTone }} />
                        </div>
                        <div className="text-[11.5px] text-[#888888] mt-2 leading-snug">
                            {today ? `${fmtN(today.opened)} opened today.` : 'Today’s numbers didn’t load.'}
                            {avg != null && ` An average daily open pays about ${Math.round(avg)} POWR, so ${fmtN(cap)} covers about ${fmtN(Math.floor(cap / Math.max(avg, 1)))} opens.`}
                            {cap > 0 && spent >= cap && <span className="text-[#E11D48]"> Spent for today.</span>}
                        </div>
                    </div>
                </div>
            </Section>

            <Section title="Targets" blurb="Each member’s target is set from their last 14 days the first time the app asks, then frozen for the day: their steps or active minutes, whichever comes first."
                right={<Link to="/admin/config?q=drop_" className={btnQuiet}><SlidersHorizontal size={13} /> Tune in System Config <ExternalLink size={12} /></Link>}>
                {(t.sLo > t.sHi || t.mLo > t.mHi) && <Warn>A floor is above its ceiling, so every target lands on the ceiling. Fix it in System Config.</Warn>}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label="Starter" value={`${fmtN(t.sSteps)}`} sub={`steps or ${t.sMins} min, under 5 known days`} />
                    <Stat label="Stretch" value={`×${t.stretch}`} sub="their typical day of steps; minutes go typical + 5" />
                    <Stat label="Range" value={`${fmtN(t.sLo)}–${fmtN(t.sHi)}`} sub={`steps · ${t.mLo}–${t.mHi} min`} />
                    <Stat label="Comeback" value={`×${t.share}`} sub={`of their typical day, after ${t.after} day${t.after === 1 ? '' : 's'} away`} />
                </div>
            </Section>

            <Confirm open={confirmOn} title="Turn the Drop on for everyone?"
                body="Every member gets a sealed Drop each day, and it pays real POWR and partner codes, up to the daily budget. Check the prize pool and the budget first."
                confirmLabel="Turn it on" onCancel={() => setConfirmOn(false)}
                onConfirm={async () => { await setLive('on'); setConfirmOn(false); }} />
            <Confirm open={!!confirmLaunch} title="That time has passed"
                body="The switch is on Testers, so the Drop opens to everyone as soon as you save this."
                confirmLabel="Save it" onCancel={() => setConfirmLaunch(null)}
                onConfirm={async () => { await write('drop_launch_at', confirmLaunch, 'Launch date saved: the Drop is open to everyone'); setConfirmLaunch(null); }} />
        </>
    );
}

function TestersEditor({ value, busy, onSave }) {
    const toast = useToast();
    const ids = useMemo(() => parseIds(value), [value]);
    const [people, setPeople] = useState(null); // id -> profile, null while loading
    const [q, setQ] = useState('');
    const [found, setFound] = useState(null);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        const valid = ids.filter(isUuid);
        if (!valid.length) { setPeople({}); return undefined; }
        let alive = true;
        supabase.from('profiles').select('id, username, display_name').in('id', valid).then(({ data }) => {
            if (alive) setPeople(Object.fromEntries((data ?? []).map(p => [p.id, p])));
        });
        return () => { alive = false; };
    }, [ids]);

    const search = async () => {
        const term = q.trim();
        if (term.length < 2) { toast.error('Type at least 2 characters'); return; }
        setSearching(true);
        const { data, error } = await supabase.rpc('admin_drop_lookup', { p_query: term });
        setSearching(false);
        if (error) { toast.error(rpcError(error)); return; }
        setFound(data ?? []);
    };
    const add = (m) => onSave([...ids, m.user_id.toLowerCase()].join(','), `${nameOf(m)} is a tester`);
    const remove = (id) => onSave(ids.filter(x => x !== id).join(','), 'Tester removed');

    return (
        <div className="mt-6 pt-6 border-t border-[#F0F0EC]">
            <div className="text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999] mb-1.5">Testers · {ids.length}</div>
            <p className="text-[12px] text-[#888888] leading-snug mb-4">They get the Drop while the switch is on Testers. Admins always count as testers.</p>
            {ids.length === 0 ? <p className="text-[12.5px] text-[#AAAAAA] mb-4">No testers yet.</p> : (
                <div className="flex flex-wrap gap-2 mb-4">
                    {ids.map(id => {
                        const p = people?.[id];
                        const bad = !isUuid(id);
                        const unknown = !bad && people && !p;
                        return (
                            <span key={id} className={`inline-flex items-center gap-2 h-9 pl-3.5 pr-1.5 rounded-full border text-[12.5px] ${bad || unknown ? 'border-[#F43F5E]/30 bg-[#FFF1F2]' : 'border-[#E6E6E1] bg-[#F4F4F1]'}`}>
                                {p ? (
                                    <Link to={`/admin/users/${id}`} className="font-semibold text-[#1A1A1A] hover:underline">{nameOf(p)}</Link>
                                ) : <span className="font-mono text-[11px] text-[#666666]">{id.length > 13 ? `${id.slice(0, 8)}…` : id}</span>}
                                {p?.username && <span className="text-[11px] text-[#999999]">@{p.username}</span>}
                                {bad && <span className="text-[10.5px] text-[#E11D48]">not a user id</span>}
                                {unknown && <span className="text-[10.5px] text-[#E11D48]">no such member</span>}
                                <button type="button" aria-label={`Remove ${p ? nameOf(p) : id}`} disabled={busy} onClick={() => remove(id)}
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#999999] hover:text-[#E11D48] hover:bg-white disabled:opacity-40">
                                    <X size={13} />
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}
            <div className="flex items-center gap-2 max-w-xl">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                    <input className={`${input} w-full pl-10`} value={q} placeholder="Add a tester: name, username or email"
                        onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} />
                </div>
                <button className={btnQuiet} onClick={search} disabled={searching || q.trim().length < 2}>
                    {searching ? <LoaderCircle size={13} className="animate-spin" /> : <Search size={13} />} Find
                </button>
            </div>
            {found && (
                <div className="mt-3 max-w-xl rounded-2xl border border-[#E6E6E1] divide-y divide-[#F4F4F1] overflow-hidden">
                    {found.length === 0 ? <div className="px-4 py-3 text-[12.5px] text-[#999999]">Nobody matches.</div> : found.map(m => {
                        const isIn = ids.includes(String(m.user_id).toLowerCase());
                        return (
                            <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-semibold text-[#1A1A1A] truncate">{nameOf(m)} {m.username && <span className="font-normal text-[#999999]">@{m.username}</span>}</div>
                                    {m.email && <div className="text-[11px] text-[#999999] truncate">{m.email}</div>}
                                </div>
                                {isIn ? <Pill color="#10B981">Tester</Pill> : (
                                    <button className={btnQuiet} disabled={busy} onClick={() => add(m)}><Plus size={13} /> Add</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Prize pool ───────────────────────────────────────────────────────────────

const isWhole = (x) => /^\d+$/.test(String(x ?? '').trim());
/** The DB checks on drop_prizes, in words, so a save never bounces off them. */
function prizeProblems(v) {
    const out = [];
    if (v.kind === 'points' || v.kind === 'vault') {
        if (!isWhole(v.amount) || Number(v.amount) < 1 || Number(v.amount) > 100) out.push('The amount is a whole number from 1 to 100 POWR.');
    } else if (v.kind === 'partner') {
        if (!v.reward_id) out.push('Pick the partner reward.');
    } else out.push('Pick a kind.');
    if (!isWhole(v.weight) || Number(v.weight) < 1 || Number(v.weight) > 1000) out.push('The weight is a whole number from 1 to 1,000.');
    if (String(v.stock ?? '').trim() !== '' && !isWhole(v.stock)) out.push('Stock is a whole number, or blank for unlimited.');
    if (v.starts_at && v.ends_at && new Date(v.starts_at).getTime() >= new Date(v.ends_at).getTime()) out.push('The end has to be after the start.');
    return out;
}
const dbError = (e) => {
    const m = e?.message ?? '';
    if (/drop_prizes_shape/.test(m)) return 'The amount and reward don’t fit the kind: POWR needs 1–100 and no reward, a partner code needs a reward.';
    if (/drop_prizes_window/.test(m)) return 'The end has to be after the start.';
    if (/weight/.test(m) && /check/.test(m)) return 'The weight is a whole number from 1 to 1,000.';
    if (/stock/.test(m) && /check/.test(m)) return 'Stock can’t be below 0.';
    return rpcError(e);
};

const BLANK_PRIZE = { kind: 'points', amount: 10, reward_id: null, weight: 10, stock: null, given: 0, active: true, starts_at: null, ends_at: null, note: '' };

function PrizesTab({ onMissing }) {
    const toast = useToast();
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const [rewards, setRewards] = useState([]);
    const [supply, setSupply] = useState(null);
    const [draft, setDraft] = useState({}); // id -> edited row
    const [savingId, setSavingId] = useState(null);
    const [del, setDel] = useState(null);

    const load = useCallback(async () => {
        const [p, r] = await Promise.all([
            supabase.from('drop_prizes').select('*').order('created_at'),
            supabase.from('rewards').select('id, title, brand_name, value_label, integration_type, promo_code, active').order('brand_name').order('title'),
        ]);
        if (isMissing(p.error)) { onMissing(); return; }
        if (p.error) toast.error(p.error.message);
        if (r.error) toast.error(`Couldn’t load rewards: ${r.error.message}`);
        setRows(p.data ?? []);
        // Affiliate links can't be handed out as a code.
        setRewards((r.data ?? []).filter(x => x.integration_type !== 'AFFILIATE'));
        setDraft({});
        try { setSupply(await fetchRewardCodeSupply()); } catch { setSupply(null); }
    }, [toast, onMissing]);
    useEffect(() => { load(); }, [load]);

    const rewardsById = useMemo(() => Object.fromEntries(rewards.map(x => [x.id, x])), [rewards]);
    const val = (r) => draft[r.id] ?? r;
    const change = (r, patch) => setDraft(d => ({ ...d, [r.id]: { ...val(r), ...patch } }));
    const forget = (id) => setDraft(d => { const n = { ...d }; delete n[id]; return n; });

    const save = async (r) => {
        const v = val(r);
        const bad = prizeProblems(v);
        if (bad.length) { toast.error(bad[0]); return; }
        const partner = v.kind === 'partner';
        const row = {
            pool: v.pool, kind: v.kind,
            amount: partner ? null : Number(v.amount),
            reward_id: partner ? v.reward_id : null,
            weight: Number(v.weight),
            stock: String(v.stock ?? '').trim() === '' ? null : Number(v.stock),
            active: !!v.active,
            starts_at: v.starts_at || null, ends_at: v.ends_at || null,
            note: v.note?.trim() || null,
            updated_at: new Date().toISOString(), updated_by: user.id,
        };
        const isNew = String(r.id).startsWith('new');
        setSavingId(r.id);
        const res = isNew
            ? await supabase.from('drop_prizes').insert(row).select().single()
            : await supabase.from('drop_prizes').update(row).eq('id', r.id).select().single();
        setSavingId(null);
        if (res.error) { toast.error(dbError(res.error)); return; }
        await logAction(user.id, isNew ? 'drop_prize_create' : 'drop_prize_update', 'drop_prize', res.data.id, row);
        setRows(rs => rs.map(x => (x.id === r.id ? res.data : x)));
        forget(r.id);
        toast.success('Prize saved');
    };
    const turnOff = async (r) => {
        setSavingId(r.id);
        const { data, error } = await supabase.from('drop_prizes')
            .update({ active: false, updated_at: new Date().toISOString(), updated_by: user.id }).eq('id', r.id).select().single();
        setSavingId(null);
        if (error) { toast.error(dbError(error)); return; }
        await logAction(user.id, 'drop_prize_update', 'drop_prize', r.id, { active: false });
        setRows(rs => rs.map(x => (x.id === r.id ? data : x)));
        if (draft[r.id]) change(r, { active: false });
        toast.success('Prize turned off');
    };
    const remove = async (r) => {
        if (String(r.id).startsWith('new')) { setRows(rs => rs.filter(x => x.id !== r.id)); forget(r.id); return; }
        const { error } = await supabase.from('drop_prizes').delete().eq('id', r.id);
        if (error) { toast.error(dbError(error)); return; }
        await logAction(user.id, 'drop_prize_delete', 'drop_prize', r.id, { pool: r.pool, kind: r.kind, amount: r.amount, reward_id: r.reward_id });
        setRows(rs => rs.filter(x => x.id !== r.id));
        forget(r.id);
        setDel(null);
        toast.success('Prize deleted');
    };
    const add = (pool) => setRows(rs => [...rs, { ...BLANK_PRIZE, id: `new-${pool}-${Date.now()}`, pool }]);

    if (!rows) return <Loading />;

    const saved = rows.filter(r => !String(r.id).startsWith('new'));
    const liveDaily = saved.filter(r => r.pool === 'daily' && liveNow(r));
    const liveFallback = saved.filter(r => r.pool === 'fallback' && liveNow(r));
    const avg = averagePowr(saved);

    const pool = (key) => {
        const list = rows.filter(r => r.pool === key);
        // Odds from what's switched on in this pool, as edited.
        const activeWeight = list.map(val).filter(v => v.active && isWhole(v.weight)).reduce((s, v) => s + Number(v.weight), 0);
        return list.length === 0
            ? <Empty icon={Gift} text={key === 'daily' ? 'No daily prizes yet' : 'No fallback prize yet'} />
            : (
                <div className="space-y-3">
                    {list.map(r => {
                        const v = val(r);
                        const share = v.active && isWhole(v.weight) && activeWeight > 0 ? Number(v.weight) / activeWeight : null;
                        return (
                            <PrizeRow key={r.id} saved={r} v={v} share={share} rewards={rewards} rewardsById={rewardsById} supply={supply}
                                dirty={!!draft[r.id] || String(r.id).startsWith('new')} busy={savingId === r.id}
                                onChange={p => change(r, p)} onSave={() => save(r)} onTurnOff={() => turnOff(r)}
                                onRemove={() => (String(r.id).startsWith('new') ? remove(r) : setDel(r))} />
                        );
                    })}
                </div>
            );
    };

    return (
        <>
            <Section title="Every day"
                blurb={`Rolled for every open, by weight. A prize sits out while it’s off, outside its dates, out of stock, or when its POWR would take today past the budget. The app shows the four best-odds prizes as “could be inside”.${avg != null ? ` An average open pays about ${Math.round(avg)} POWR.` : ''}`}
                right={<button className={btnQuiet} onClick={() => add('daily')}><Plus size={13} /> Add a prize</button>}>
                {liveDaily.length === 0 && (
                    <Warn tone={liveFallback.length ? 'orange' : 'red'}>
                        No daily prize is in the roll right now (on, inside its dates and in stock), so every open falls to the fallback pool
                        {liveFallback.length ? '.' : ', and that has nothing either: members who hit their target get nothing.'}
                    </Warn>
                )}
                {pool('daily')}
            </Section>

            <Section title="Fallback"
                blurb="Only paid once the daily budget is spent or nothing in the daily pool can pay. It ignores the budget, so keep it small."
                right={<button className={btnQuiet} onClick={() => add('fallback')}><Plus size={13} /> Add a prize</button>}>
                {liveFallback.length === 0 ? (
                    <Warn>The fallback pool is empty: once the budget is spent, members who hit their target open nothing.</Warn>
                ) : liveFallback.every(r => r.stock != null) && (
                    <Warn>Every fallback prize has a stock limit. Keep one unlimited so there’s always something to pay.</Warn>
                )}
                {pool('fallback')}
            </Section>

            <Confirm open={!!del} danger title="Delete this prize?"
                body={del ? `${poolPrizeText(del, rewardsById)}. It’s never been given, so nothing points at it.` : ''}
                confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => remove(del)} />
        </>
    );
}

function PrizeRow({ saved, v, share, rewards, rewardsById, supply, dirty, busy, onChange, onSave, onTurnOff, onRemove }) {
    const partner = v.kind === 'partner';
    const rw = partner && v.reward_id ? rewardsById[v.reward_id] : null;
    const problems = prizeProblems(v);
    const isNew = String(saved.id).startsWith('new');
    const given = saved.given ?? 0;
    const stock = String(v.stock ?? '').trim() === '' || !isWhole(v.stock) ? null : Number(v.stock);
    const now = Date.now();

    // Notes that don't block a save but change what members get.
    const notes = [];
    if (stock != null && given >= stock) notes.push({ tone: 'orange', text: `Sold out: ${fmtN(given)} given of ${fmtN(stock)}. It sits out until you raise the stock.` });
    if (v.ends_at && new Date(v.ends_at).getTime() <= now) notes.push({ tone: 'orange', text: `Ended ${fmtWhen(v.ends_at)}: not rolled.` });
    else if (v.starts_at && new Date(v.starts_at).getTime() > now) notes.push({ tone: 'grey', text: `Starts ${fmtWhen(v.starts_at)} (London).` });
    let codes = null;
    if (partner && rw) {
        if (!rw.active) notes.push({ tone: 'orange', text: 'This reward is off in Rewards, so the prize sits out until it’s live.' });
        if (rw.promo_code?.trim()) codes = { text: 'Shared code · unlimited', n: Infinity };
        else if (!supply) codes = { text: 'Code pool · couldn’t count the codes', n: null };
        else {
            const n = supply[rw.id]?.claimable ?? 0;
            codes = { text: `Code pool · ${fmtN(n)} code${n === 1 ? '' : 's'} left`, n };
            if (n === 0) notes.push({ tone: 'red', text: 'No codes left: the prize sits out. Load codes on the reward.' });
            else if (stock == null) notes.push({ tone: 'orange', text: `Stock is unlimited but only ${fmtN(n)} codes are left: it stops when they run out.` });
            else if (stock - given > n) notes.push({ tone: 'orange', text: `${fmtN(stock - given)} left in stock but only ${fmtN(n)} codes: it stops when the codes run out.` });
            if (rw.integration_type === 'API_VALIDATED') notes.push({ tone: 'grey', text: 'The Drop doesn’t mint codes: it only hands out codes already loaded.' });
        }
    }
    const toneClass = { red: 'text-[#E11D48]', orange: 'text-[#C2410C]', grey: 'text-[#888888]' };

    // Active rewards first; keep the chosen one in the list even if it's gone.
    const options = useMemo(() => [...rewards].sort((a, b) => (b.active - a.active) || rewardText(a).localeCompare(rewardText(b))), [rewards]);

    return (
        <div className={`${card} p-5 ${!v.active ? 'bg-[#FAFAF8]' : ''}`}>
            <div className="flex flex-wrap items-end gap-3">
                <Field label="Kind">
                    <select className={`${input} w-44`} value={v.kind}
                        onChange={e => {
                            const kind = e.target.value;
                            onChange(kind === 'partner' ? { kind, amount: null } : { kind, reward_id: null, amount: v.amount ?? 10 });
                        }}>
                        {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                    </select>
                </Field>
                {partner ? (
                    <div className="flex-1 min-w-[260px]">
                        <Field label="Partner reward">
                            <select className={`${input} w-full`} value={v.reward_id ?? ''} onChange={e => onChange({ reward_id: e.target.value || null })}>
                                <option value="">Pick a reward…</option>
                                {v.reward_id && !rewardsById[v.reward_id] && <option value={v.reward_id}>Unknown reward ({v.reward_id.slice(0, 8)})</option>}
                                {options.map(x => <option key={x.id} value={x.id}>{rewardText(x)}{x.active ? '' : ' · off'}</option>)}
                            </select>
                        </Field>
                    </div>
                ) : (
                    <Field label="Amount">
                        <div className="flex items-center gap-2">
                            <input type="number" min={1} max={100} className={`${input} w-24`} value={v.amount ?? ''} onChange={e => onChange({ amount: e.target.value })} />
                            <span className="text-[11px] text-[#999999]">POWR</span>
                        </div>
                    </Field>
                )}
                <Field label="Weight">
                    <div className="flex items-center gap-2">
                        <input type="number" min={1} max={1000} className={`${input} w-24`} value={v.weight ?? ''} onChange={e => onChange({ weight: e.target.value })} />
                        <span className="w-14 text-[12.5px] font-bold tabular-nums" style={{ color: share == null ? '#BBBBBB' : '#8a7600' }}
                            title="Share of this pool’s switched-on weight">
                            {share == null ? 'off' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`}
                        </span>
                    </div>
                </Field>
                <Field label="Stock">
                    <input type="number" min={0} className={`${input} w-28`} placeholder="Unlimited" value={v.stock ?? ''} onChange={e => onChange({ stock: e.target.value })} />
                </Field>
                <div className="pb-2.5 text-[12px] text-[#888888] tabular-nums w-20">{fmtN(given)} given</div>
                <div className="flex items-center gap-2 pb-1.5">
                    <Toggle on={!!v.active} onChange={on => onChange({ active: on })} label="Prize on" />
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${v.active ? 'text-[#10B981]' : 'text-[#BBBBBB]'}`}>{v.active ? 'On' : 'Off'}</span>
                </div>
                <div className="ml-auto flex gap-2">
                    <button className={btnGold} onClick={onSave} disabled={!dirty || busy || problems.length > 0}>
                        {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />} Save
                    </button>
                    {isNew || given === 0 ? (
                        <button className={btnDanger} onClick={onRemove} disabled={busy} aria-label="Delete prize" title="Delete"><Trash2 size={13} /></button>
                    ) : saved.active ? (
                        <button className={btnQuiet} onClick={onTurnOff} disabled={busy} title={`Given ${given} times, so it stays for the record`}><Power size={13} /> Turn off</button>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-wrap items-end gap-3 mt-3">
                <Field label="Starts (optional)">
                    <input type="datetime-local" className={`${input} w-56 font-mono text-[12.5px]`} value={v.starts_at ? toLocalInput(v.starts_at) : ''}
                        onChange={e => onChange({ starts_at: fromLocalInput(e.target.value) })} />
                </Field>
                <Field label="Ends (optional)">
                    <input type="datetime-local" className={`${input} w-56 font-mono text-[12.5px]`} value={v.ends_at ? toLocalInput(v.ends_at) : ''}
                        onChange={e => onChange({ ends_at: fromLocalInput(e.target.value) })} />
                </Field>
                <div className="flex-1 min-w-[220px]">
                    <Field label="Note">
                        <input className={`${input} w-full`} placeholder="Only admins see this" value={v.note ?? ''} onChange={e => onChange({ note: e.target.value })} />
                    </Field>
                </div>
            </div>
            {(partner || problems.length > 0 || notes.length > 0) && (
                <div className="mt-3 space-y-1 text-[11.5px] leading-snug">
                    {codes && <div className="text-[#555555] font-semibold">{codes.text}</div>}
                    {partner && <div className="text-[#999999]">A reward’s own stock isn’t enforced anywhere: this prize’s stock is what limits it.</div>}
                    {problems.map(p => <div key={p} className="text-[#E11D48]">{p}</div>)}
                    {notes.map(n => <div key={n.text} className={toneClass[n.tone]}>{n.text}</div>)}
                </div>
            )}
        </div>
    );
}

// ── Void and reissue, for Opens and Members ──────────────────────────────────

function DropActions({ ask, setAsk, pool, onDone }) {
    const toast = useToast();
    const { prizes, rewards } = pool;
    const [pick, setPick] = useState('');
    useEffect(() => { setPick(''); }, [ask]);
    const row = ask?.row;
    const who = ask?.name ?? 'this member';
    const kind = row?.prize?.kind ?? row?.prize_kind;

    const doVoid = async (reason) => {
        const { data, error } = await supabase.rpc('admin_void_drop', { p_id: row.id, p_reason: reason });
        if (error) { toast.error(rpcError(error)); return; }
        const d = voidDetailText(data);
        toast.success(d ? `Voided: ${d}` : 'Voided');
        setAsk(null);
        onDone();
    };
    const doReissue = async (reason) => {
        const { data, error } = await supabase.rpc('admin_reissue_drop', { p_id: row.id, p_prize: pick || null, p_reason: reason });
        if (error) { toast.error(rpcError(error)); return; }
        toast.success(`Reissued: ${prizeText(data)}`);
        setAsk(null);
        onDone();
    };

    return (
        <>
            <Confirm open={ask?.kind === 'void'} danger title={`Void ${who}’s Drop?`}
                body={`${kind === 'points' ? 'Takes the POWR back, as far as their balance allows: anything already spent stays spent.'
                    : kind === 'vault' ? 'Removes the Vault deposit, unless it’s already been released.'
                        : kind === 'partner' ? 'Expires the code in their Wallet, unless they’ve used it.'
                            : 'Takes back what can be taken back.'} The day is marked void; you can reissue it after.`}
                reasonLabel="Why" confirmLabel="Void" onCancel={() => setAsk(null)} onConfirm={doVoid} />
            <Confirm open={ask?.kind === 'reissue'} title={`Reissue ${who}’s Drop?`}
                body="A fresh roll uses the pool as it is now but pays past the budget. A chosen prize is paid even if it’s off or outside its dates; its stock still holds. Either way it counts towards today’s spend."
                extra={(
                    <div className="mb-4">
                        <Field label="Prize">
                            <select className={`${input} w-full`} value={pick} onChange={e => setPick(e.target.value)}>
                                <option value="">Fresh roll from the pool</option>
                                {['daily', 'fallback'].map(pl => (
                                    <optgroup key={pl} label={pl === 'daily' ? 'Every day' : 'Fallback'}>
                                        {prizes.filter(p => p.pool === pl).map(p => {
                                            const sold = p.stock != null && p.given >= p.stock;
                                            return (
                                                <option key={p.id} value={p.id} disabled={sold}>
                                                    {poolPrizeText(p, rewards)}{p.active ? '' : ' · off'}{sold ? ' · sold out' : ''}
                                                </option>
                                            );
                                        })}
                                    </optgroup>
                                ))}
                            </select>
                        </Field>
                    </div>
                )}
                reasonLabel="Why" confirmLabel="Reissue" onCancel={() => setAsk(null)} onConfirm={doReissue} />
        </>
    );
}

/** Opens (one day, many members) or a member's days: the same columns. */
function DropTable({ rows, showMember, allowSealed, onAsk, memberName }) {
    return (
        <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-[#F0F0EC] text-[9.5px] font-black uppercase tracking-[0.24em] text-[#999999]">
                        <th className="px-5 py-3 font-black">{showMember ? 'Member' : 'Day'}</th>
                        <th className="px-3 py-3 font-black">Opened</th>
                        <th className="px-3 py-3 font-black">Target</th>
                        <th className="px-3 py-3 font-black">At open</th>
                        <th className="px-3 py-3 font-black">Prize</th>
                        <th className="px-3 py-3 font-black">Status</th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#F4F4F1]">
                    {rows.map(r => {
                        const flagged = r.flagged ?? (r.typical_steps > 0 && (r.steps_at_open ?? 0) > 3 * r.typical_steps);
                        const name = showMember ? nameOf(r) : memberName;
                        const basis = BASIS[r.basis];
                        const prize = r.prize ? prizeText(r.prize) : r.prize_kind ? prizeText({ kind: r.prize_kind, amount: r.prize_amount }) : null;
                        const st = STATUS[r.status] ?? { label: r.status, color: '#9CA3AF' };
                        const vd = voidDetailText(r.void_detail);
                        return (
                            <tr key={r.id} className="align-top">
                                <td className="px-5 py-3">
                                    {showMember ? (
                                        <>
                                            <Link to={`/admin/users/${r.user_id}`} className="text-[13px] font-semibold text-[#1A1A1A] hover:underline">{name}</Link>
                                            {r.username && <div className="text-[11px] text-[#999999]">@{r.username}</div>}
                                        </>
                                    ) : <span className="text-[13px] font-semibold text-[#1A1A1A] whitespace-nowrap">{fmtDay(r.day)}</span>}
                                    {flagged && (
                                        <div className="mt-1"><Pill color="#E11D48" title="Steps at open over 3× their typical day"><Flag size={10} /> Flag</Pill></div>
                                    )}
                                </td>
                                <td className="px-3 py-3 text-[12.5px] text-[#555555] whitespace-nowrap">{fmtWhen(r.opened_at)}</td>
                                <td className="px-3 py-3 text-[12.5px] text-[#1A1A1A] whitespace-nowrap">
                                    {fmtN(r.target_steps)} steps or {fmtN(r.target_minutes)} min
                                    <div className="text-[11px] text-[#999999]" title={basis?.title}>
                                        {basis?.label ?? r.basis}{r.typical_steps ? ` · typical ${fmtN(r.typical_steps)}` : ''}
                                    </div>
                                </td>
                                <td className="px-3 py-3 text-[12.5px] text-[#555555] whitespace-nowrap">
                                    {r.steps_at_open == null && r.minutes_at_open == null ? '—' : `${fmtN(r.steps_at_open ?? 0)} steps · ${fmtN(r.minutes_at_open ?? 0)} min`}
                                </td>
                                <td className="px-3 py-3 text-[12.5px] min-w-[180px]">
                                    {prize && <span className={r.status === 'void' ? 'line-through text-[#AAAAAA]' : 'text-[#1A1A1A]'}>{prize}</span>}
                                    {!prize && r.status !== 'void' && <span className="text-[#AAAAAA]">—</span>}
                                    {r.fallback && r.status === 'opened' && <span className="ml-2"><Pill color="#F97316">Fallback</Pill></span>}
                                    {r.status === 'void' && (
                                        <div className="text-[11px] text-[#999999] leading-snug">Void: {r.void_reason ?? '—'}{vd ? ` (${vd})` : ''}</div>
                                    )}
                                    {r.reissue_reason && <div className="text-[11px] text-[#999999] leading-snug">Reissued: {r.reissue_reason}</div>}
                                </td>
                                <td className="px-3 py-3"><Pill color={st.color}>{st.label}</Pill></td>
                                <td className="px-5 py-3 text-right whitespace-nowrap">
                                    {r.status === 'opened' && (
                                        <button className={btnDanger} onClick={() => onAsk({ kind: 'void', row: r, name })}><Ban size={13} /> Void</button>
                                    )}
                                    {(r.status === 'void' || (allowSealed && r.status === 'sealed')) && (
                                        <button className={btnQuiet} onClick={() => onAsk({ kind: 'reissue', row: r, name })}><Shuffle size={13} /> Reissue</button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Opens ────────────────────────────────────────────────────────────────────

function OpensTab({ onMissing }) {
    const toast = useToast();
    const [day, setDay] = useState(todayLondon());
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [ask, setAsk] = useState(null);
    const [pool, reloadPool] = usePool();
    const { prizes, rewards } = pool;
    const today = todayLondon();

    const load = useCallback(async () => {
        setBusy(true);
        const { data: d, error } = await supabase.rpc('admin_drop_overview', { p_day: day });
        setBusy(false);
        if (isMissing(error)) { onMissing(); return; }
        if (error) { toast.error(rpcError(error)); setData({ error: rpcError(error) }); return; }
        setData(d);
    }, [day, toast, onMissing]);
    useEffect(() => { load(); }, [load]);

    const label = (b) => {
        if (b.kind === 'partner') {
            const p = prizes.find(x => x.id === b.prize_id);
            return `Code: ${p ? rewardText(rewards[p.reward_id]) : (b.brand ?? 'partner')}`;
        }
        return prizeText(b);
    };

    const picker = (
        <div className="flex items-center gap-2">
            <button className={btnQuiet} aria-label="Day before" onClick={() => setDay(d => addDays(d, -1))}><ChevronLeft size={14} /></button>
            <input type="date" className={`${input} font-mono`} value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} />
            <button className={btnQuiet} aria-label="Day after" onClick={() => setDay(d => addDays(d, 1))} disabled={day >= today}><ChevronRight size={14} /></button>
            {day !== today && <button className={btnQuiet} onClick={() => setDay(today)}>Today</button>}
            <button className={btnQuiet} onClick={load} disabled={busy}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh</button>
        </div>
    );

    if (!data) return <Loading />;
    if (data.error) {
        return (
            <Section title="Opens" right={picker}>
                <Warn tone="red">Couldn’t load the day: {data.error}</Warn>
            </Section>
        );
    }

    const members = Number(data.members ?? 0);
    const opened = Number(data.opened ?? 0);
    const budget = Number(data.budget ?? 0);
    const spent = Number(data.spent ?? 0);
    const last14 = data.last14 ?? [];
    const maxPowr = Math.max(budget, ...last14.map(x => Number(x.powr) || 0), 1);
    const opens = data.opens ?? [];
    const flagged = opens.filter(o => o.flagged).length;

    return (
        <>
            <Section title={`Opens · ${fmtDay(data.day)}`} right={picker}
                blurb="Members and opens go by each member’s own day; POWR paid goes by the London day it was paid, the budget’s day.">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Stat label="Members with a Drop" value={fmtN(members)} sub="the app asked for their Drop" />
                    <Stat label="Opened" value={fmtN(opened)} sub={flagged ? `${flagged} flagged: see below` : 'none flagged'} />
                    <Stat label="Open rate" value={members ? `${Math.round((opened / members) * 100)}%` : '—'} sub="opened of members with a Drop" />
                    <Stat label="POWR paid" value={fmtN(spent)} sub={`of ${fmtN(budget)} budget · codes not counted`} tone={budget > 0 && spent >= budget ? '#E11D48' : undefined} />
                    <Stat label="Void" value={fmtN(data.void)} sub="taken back by an admin" tone={data.void ? '#F97316' : undefined} />
                </div>
            </Section>

            <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 mb-10">
                <div>
                    <div className="px-1 mb-3 text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999]">Last 14 days</div>
                    <div className={`${card} overflow-x-auto`}>
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-[#F0F0EC] text-[9.5px] font-black uppercase tracking-[0.24em] text-[#999999]">
                                    <th className="px-5 py-2.5 font-black">Day</th>
                                    <th className="px-3 py-2.5 font-black text-right">Members</th>
                                    <th className="px-3 py-2.5 font-black">Opened</th>
                                    <th className="px-5 py-2.5 font-black">POWR</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {[...last14].reverse().map(x => {
                                    const m = Number(x.members) || 0;
                                    const o = Number(x.opened) || 0;
                                    const pw = Number(x.powr) || 0;
                                    const on = String(x.day).slice(0, 10) === String(data.day).slice(0, 10);
                                    return (
                                        <tr key={x.day} onClick={() => setDay(String(x.day).slice(0, 10))}
                                            className={`cursor-pointer text-[12.5px] ${on ? 'bg-[#E8D200]/10' : 'hover:bg-[#FAFAF8]'}`}>
                                            <td className="px-5 py-2 whitespace-nowrap font-medium text-[#1A1A1A]">{fmtDay(x.day)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-[#555555]">{fmtN(m)}</td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-20 h-2 rounded-full bg-[#F4F4F1] overflow-hidden">
                                                        <div className="h-full bg-[#10B981]" style={{ width: `${m ? (o / m) * 100 : 0}%` }} />
                                                    </div>
                                                    <span className="tabular-nums text-[#555555]">{fmtN(o)}{m ? ` · ${Math.round((o / m) * 100)}%` : ''}</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-20 h-2 rounded-full bg-[#F4F4F1] overflow-hidden">
                                                        <div className="h-full" style={{ width: `${(pw / maxPowr) * 100}%`, background: budget > 0 && pw >= budget ? '#E11D48' : '#B8A800' }} />
                                                    </div>
                                                    <span className="tabular-nums text-[#555555]">{fmtN(pw)}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div>
                    <div className="px-1 mb-3 text-[9.5px] font-black uppercase tracking-[0.28em] text-[#999999]">By prize</div>
                    <div className={`${card} p-5`}>
                        {(data.by_prize ?? []).length === 0 ? <p className="text-[12.5px] text-[#999999]">Nothing opened this day.</p> : data.by_prize.map(b => (
                            <div key={`${b.prize_id}-${b.kind}-${b.amount}`} className="flex items-center gap-3 py-1.5">
                                <span className="flex-1 text-[13px] text-[#1A1A1A] truncate">{label(b)}</span>
                                {b.fallback && <Pill color="#F97316">Fallback</Pill>}
                                <span className="tabular-nums text-[13px] font-semibold w-10 text-right">{fmtN(b.count)}</span>
                                <span className="tabular-nums text-[11px] text-[#999999] w-10 text-right">{opened ? `${Math.round((b.count / opened) * 100)}%` : ''}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <Section title="Who opened" blurb="Flag: steps at open over 3× their typical day. Void takes the prize back; a void day can be reissued.">
                {opens.length === 0 ? <Empty icon={ListOrdered} text="No opens this day" /> : (
                    <DropTable rows={opens} showMember onAsk={setAsk} />
                )}
            </Section>

            <DropActions ask={ask} setAsk={setAsk} pool={pool} onDone={() => { load(); reloadPool(); }} />
        </>
    );
}

// ── Member lookup ────────────────────────────────────────────────────────────

function MembersTab() {
    const toast = useToast();
    const [q, setQ] = useState('');
    const [ran, setRan] = useState('');
    const [results, setResults] = useState(null);
    const [busy, setBusy] = useState(false);
    const [ask, setAsk] = useState(null);
    const [pool, reloadPool] = usePool();

    const search = useCallback(async (term) => {
        const t = String(term ?? '').trim();
        if (t.length < 2) { toast.error('Type at least 2 characters'); return; }
        setBusy(true);
        const { data, error } = await supabase.rpc('admin_drop_lookup', { p_query: t });
        setBusy(false);
        if (error) { toast.error(rpcError(error)); return; }
        setResults(data ?? []);
        setRan(t);
    }, [toast]);

    return (
        <>
            <Section title="Find a member" blurb="By name, username or email. Shows their last 30 days of Drops, with void and reissue.">
                <div className="flex items-center gap-2 max-w-xl">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                        <input autoFocus className={`${input} w-full pl-10`} value={q} placeholder="Name, username or email"
                            onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(q); }} />
                    </div>
                    <button className={btnGold} onClick={() => search(q)} disabled={busy || q.trim().length < 2}>
                        {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Search size={13} />} Search
                    </button>
                </div>
            </Section>

            {results && (results.length === 0 ? <Empty icon={Users} text={`Nobody matches “${ran}”`} /> : (
                <div className="space-y-8">
                    {results.length >= 10 && <p className="px-1 text-[12px] text-[#888888]">Showing the first 10 matches. Narrow the search to find someone else.</p>}
                    {results.map(m => (
                        <section key={m.user_id}>
                            <div className="flex flex-wrap items-center gap-3 mb-3 px-1">
                                <Link to={`/admin/users/${m.user_id}`} className="text-lg font-bold text-[#1A1A1A] tracking-tight hover:underline">{nameOf(m)}</Link>
                                {m.username && <span className="text-[12.5px] text-[#999999]">@{m.username}</span>}
                                {m.email && <span className="text-[12.5px] text-[#999999]">{m.email}</span>}
                                <Pill color={m.enabled ? '#10B981' : '#9CA3AF'}>{m.enabled ? 'Drop on for them' : 'Drop off for them'}</Pill>
                            </div>
                            {(m.days ?? []).length === 0
                                ? <div className={`${card} px-6 py-5 text-[12.5px] text-[#999999]`}>No Drops in the last 30 days.</div>
                                : <DropTable rows={m.days} allowSealed memberName={nameOf(m)} onAsk={setAsk} />}
                        </section>
                    ))}
                </div>
            ))}

            <DropActions ask={ask} setAsk={setAsk} pool={pool} onDone={() => { search(ran); reloadPool(); }} />
        </>
    );
}
