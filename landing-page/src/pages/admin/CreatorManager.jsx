import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Link2, Copy, Check, X, Users, ExternalLink, Pause, Play, Search, UserCheck, ShieldAlert, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';
import { CreatorTabs } from './CreatorPrograms';

const INPUT = "w-full h-11 px-4 bg-white border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] placeholder-[#CCCCCC] focus:border-[#E8D200]/50 outline-none transition-all";
const LABEL = "block text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-2";

const STATUS_TONE = {
    active:     'bg-[#E8D200]/10 border-[#E8D200]/30 text-[#8a7600]',
    paused:     'bg-amber-500/10 border-amber-500/30 text-amber-700',
    terminated: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#BBBBBB]',
};

// A code that already belongs to a member's POWR ID would silently hijack that
// member's invites, so the server refuses it. Mirroring the shape here just
// saves a round trip — the server is still the authority.
const CODE_RE = /^[A-Z0-9]{6,10}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const fmtWhen = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function CopyBtn({ value }) {
    const [done, setDone] = useState(false);
    return (
        <button
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(value);
                    setDone(true);
                    setTimeout(() => setDone(false), 1600);
                } catch { /* value is on screen regardless */ }
            }}
            className="flex items-center gap-2 h-9 px-4 bg-[#1A1A1A] text-white rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:bg-[#333] transition-all"
        >
            {done ? <Check size={12} className="text-[#E8D200]" /> : <Copy size={12} />}
            {done ? 'Copied' : 'Copy link'}
        </button>
    );
}

function NewCreatorForm({ onDone, onCancel }) {
    // Creators are app users first — their share code comes from the app
    // (Jamie, 2026-08-25). So the form starts from a member search: pick
    // someone and their POWR ID becomes the code, their name and photo prefill,
    // and they log into the portal with the account they already have.
    const [members, setMembers] = useState(null);
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState(null);
    const [customCode, setCustomCode] = useState(false);
    const [form, setForm] = useState({ display_name: '', handle: '', code: '', bio: '', conversion_points: '' });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    useEffect(() => {
        supabase.rpc('admin_get_users').then(({ data }) => setMembers(data ?? []));
    }, []);

    const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

    const results = (() => {
        const needle = q.trim().toLowerCase().replace(/[\s-]/g, '');
        if (!members || needle.length < 2) return [];
        return members.filter(m =>
            (m.display_name ?? '').toLowerCase().includes(needle) ||
            (m.username ?? '').toLowerCase().includes(needle) ||
            (m.email ?? '').toLowerCase().includes(needle) ||
            (m.member_id ?? '').toLowerCase().includes(needle)
        ).slice(0, 8);
    })();

    const pick = (m) => {
        setPicked(m);
        setQ('');
        const handleGuess = (m.username || m.display_name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
        setForm(f => ({
            ...f,
            display_name: f.display_name || m.display_name || m.username || '',
            handle: f.handle || handleGuess,
            code: m.member_id ?? '',
        }));
        setCustomCode(false);
    };

    const submit = async (e) => {
        e.preventDefault();
        const handle = form.handle.trim().toLowerCase();
        const code = form.code.trim().toUpperCase();
        if (!HANDLE_RE.test(handle)) return setErr('Handle: 2–30 chars, lowercase letters, numbers or hyphens.');
        if (!CODE_RE.test(code)) return setErr('Code: 6–10 chars, A–Z and 0–9. Shorter codes are dropped by already-installed apps.');
        setErr(null); setBusy(true);
        try {
            await invokeFn('manage-creator-user', {
                action: 'create_creator',
                member_user_id: picked?.id ?? null,
                avatar_url: picked?.avatar_url ?? null,
                display_name: form.display_name.trim(),
                handle, code,
                bio: form.bio.trim() || null,
                conversion_points: form.conversion_points === '' ? null : Number(form.conversion_points),
            });
            onDone();
        } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
    };

    return (
        <form onSubmit={submit} className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6">
            <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-8">New affiliate</h2>

            {/* Step 1: who */}
            <div className="mb-8">
                <label className={LABEL}>Which member?</label>
                {picked ? (
                    <div className="flex items-center gap-4 p-4 bg-[#E8D200]/5 border border-[#E8D200]/30 rounded-2xl max-w-xl">
                        {picked.avatar_url
                            ? <img src={picked.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                            : <div className="w-11 h-11 rounded-full bg-white border border-[#E6E6E1] flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">{(picked.display_name || picked.username || '?')[0]}</div>}
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{picked.display_name || picked.username}</div>
                            <div className="text-[10px] text-[#999] font-black mt-0.5 truncate">
                                {picked.username ? `@${picked.username} · ` : ''}{picked.email} · POWR ID <span className="font-mono tracking-widest text-[#8a7600]">{picked.member_id}</span>
                            </div>
                        </div>
                        <UserCheck size={16} className="text-[#8a7600] shrink-0" />
                        <button type="button" onClick={() => { setPicked(null); setForm(f => ({ ...f, code: '' })); }} className="text-[9px] uppercase tracking-[0.2em] font-black text-[#999] hover:text-[#1A1A1A]">Change</button>
                    </div>
                ) : (
                    <div className="relative max-w-xl">
                        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                        <input
                            autoFocus
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            placeholder={members ? 'Search by name, @username, email or POWR ID' : 'Loading members...'}
                            disabled={!members}
                            className={`${INPUT} pl-11`}
                        />
                        {results.length > 0 && (
                            <div className="absolute z-20 left-0 right-0 mt-2 bg-white border border-[#E6E6E1] rounded-2xl shadow-xl overflow-hidden">
                                {results.map(m => (
                                    <button type="button" key={m.id} onClick={() => pick(m)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAF8] text-left border-b border-[#F0F0ED] last:border-0">
                                        {m.avatar_url
                                            ? <img src={m.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                                            : <div className="w-8 h-8 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">{(m.display_name || m.username || '?')[0]}</div>}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-bold text-[#1A1A1A] truncate">{m.display_name || m.username || m.email}</div>
                                            <div className="text-[10px] text-[#999] truncate">{m.username ? `@${m.username} · ` : ''}{m.email}</div>
                                        </div>
                                        <span className="font-mono text-[10px] tracking-widest text-[#8a7600] shrink-0">{m.member_id}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="text-[10px] text-[#BBBBBB] font-light mt-2">
                            They'll log into the portal with their app account. No member yet? Leave this blank and mint a setup link after.
                        </p>
                    </div>
                )}
            </div>

            {/* Step 2: the profile */}
            <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                    <label className={LABEL}>Display name</label>
                    <input className={INPUT} value={form.display_name} onChange={set('display_name')} required placeholder="Luke Bramley" />
                </div>
                <div>
                    <label className={LABEL}>Handle</label>
                    <input className={INPUT} value={form.handle} onChange={set('handle')} required placeholder="lukeb" />
                    <p className="text-[10px] text-[#BBBBBB] font-light mt-2">powr.life/join/<span className="font-mono">{form.handle || 'handle'}</span></p>
                </div>
                <div>
                    <label className={LABEL}>Invite code</label>
                    <input
                        className={`${INPUT} font-mono uppercase tracking-widest ${picked && !customCode ? 'text-[#8a7600]' : ''}`}
                        value={form.code}
                        readOnly={!!picked && !customCode}
                        onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                        required
                        placeholder={picked ? '' : 'LUKE2026'}
                        maxLength={10}
                    />
                    {picked ? (
                        <p className="text-[10px] text-[#BBBBBB] font-light mt-2">
                            {customCode ? 'A vanity code on top of their POWR ID. Both keep working for them. ' : 'Their POWR ID — the code they already share from the app. '}
                            <button type="button" onClick={() => setCustomCode(v => !v)} className="text-[#8a7600] underline">
                                {customCode ? 'Use their POWR ID instead' : 'Give them a vanity code instead'}
                            </button>
                        </p>
                    ) : (
                        <p className="text-[10px] text-[#BBBBBB] font-light mt-2">6–10 chars. Must not clash with a member's POWR ID.</p>
                    )}
                </div>
                <div>
                    <label className={LABEL}>Points per conversion</label>
                    <input className={INPUT} type="number" min="0" value={form.conversion_points} onChange={set('conversion_points')} placeholder="Programme default" />
                </div>
            </div>
            <div className="mb-6">
                <label className={LABEL}>Bio</label>
                <input className={INPUT} value={form.bio} onChange={set('bio')} placeholder="Shown when their link is shared" />
            </div>

            {err && <div className="text-red-500 text-xs bg-red-500/5 p-4 border border-red-500/20 rounded-2xl mb-6">{err}</div>}

            <div className="flex gap-3">
                <button type="submit" disabled={busy} className="h-12 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[11px] rounded-full hover:translate-y-[-2px] transition-all disabled:opacity-50">
                    {busy ? 'Creating...' : 'Create affiliate'}
                </button>
                <button type="button" onClick={onCancel} className="h-12 px-8 bg-[#F4F4F1] border border-[#E6E6E1] text-[#666] font-black uppercase tracking-widest text-[11px] rounded-full hover:border-[#CCC] transition-all">
                    Cancel
                </button>
            </div>
        </form>
    );
}

function AccessPanel({ creator, programs, onChanged }) {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [newLink, setNewLink] = useState(null);
    const [err, setErr] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await invokeFn('manage-creator-user', { action: 'list', creator_id: creator.id });
            setData(res);
        } catch (e) { setErr(e.message); }
    }, [creator.id]);

    useEffect(() => { load(); }, [load]);

    const mint = async () => {
        setBusy(true); setErr(null);
        try {
            const res = await invokeFn('manage-creator-user', { action: 'create_invite', creator_id: creator.id });
            setNewLink(res.url);
            await load();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const revoke = async (id) => {
        setBusy(true);
        try {
            await invokeFn('manage-creator-user', { action: 'revoke_invite', invite_id: id });
            await load();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const unlink = async (userId) => {
        setBusy(true);
        try {
            await invokeFn('manage-creator-user', { action: 'remove', user_id: userId });
            await load();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const toggleStatus = async () => {
        setBusy(true);
        try {
            await invokeFn('manage-creator-user', {
                action: 'update_creator',
                creator_id: creator.id,
                status: creator.status === 'active' ? 'paused' : 'active',
            });
            onChanged();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const openInvites = (data?.invites ?? []).filter(i => i.status === 'invited');

    // Programme + per-creator points override. Both go through the edge
    // function: the column grant refuses direct client writes to these.
    const [override, setOverride] = useState(creator.conversion_points ?? '');
    const setProgram = async (programId) => {
        setBusy(true); setErr(null);
        try {
            await invokeFn('manage-creator-user', { action: 'update_creator', creator_id: creator.id, program_id: programId || null });
            onChanged();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };
    const saveOverride = async () => {
        setBusy(true); setErr(null);
        try {
            await invokeFn('manage-creator-user', {
                action: 'update_creator', creator_id: creator.id,
                conversion_points: override === '' ? null : Number(override),
            });
            onChanged();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };
    const effective = programs.find(p => p.id === creator.program_id) ?? programs.find(p => p.is_default);

    // Fraud signals — cheap read-only checks, shown as a strip. Anything
    // non-zero is "look closer", not a verdict.
    const [signals, setSignals] = useState(null);
    useEffect(() => {
        supabase.rpc('admin_creator_fraud_signals', { p_creator_id: creator.id })
            .then(({ data }) => setSignals(data ?? null));
    }, [creator.id]);

    // Who actually came through the code — answers "who was that?" without
    // reaching for SQL. Same RLS reason as the stats: admin RPC, not a read.
    const [referred, setReferred] = useState(null);
    useEffect(() => {
        supabase.rpc('admin_creator_referrals', { p_creator_id: creator.id })
            .then(({ data }) => setReferred(Array.isArray(data) ? data : []));
    }, [creator.id]);

    return (
        <div className="px-8 pb-8 pt-2 bg-[#FAFAF8] border-t border-[#E6E6E1]">
            {err && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl mb-5">{err}</div>}

            {signals && (
                <div className={`flex items-start gap-4 rounded-2xl p-5 mb-6 border ${signals.flags > 0 ? 'bg-amber-500/5 border-amber-500/30' : 'bg-white border-[#E6E6E1]'}`}>
                    {signals.flags > 0
                        ? <ShieldAlert size={16} className="text-amber-700 shrink-0 mt-0.5" />
                        : <ShieldCheck size={16} className="text-[#CCC] shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                        <div className="text-[9px] uppercase tracking-[0.35em] font-black mb-2" style={{ color: signals.flags > 0 ? '#B45309' : '#BBBBBB' }}>
                            {signals.flags > 0 ? `${signals.flags} signal${signals.flags === 1 ? '' : 's'} worth a look` : 'No fraud signals'}
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-[#666]">
                            <span><b className="text-[#1A1A1A]">{signals.shared_devices.length}</b> shared device{signals.shared_devices.length === 1 ? '' : 's'}{signals.shared_devices.some(d => d.includes_creator) ? ' (incl. the creator\'s own)' : ''}</span>
                            <span><b className="text-[#1A1A1A]">{signals.ip_clusters.length}</b> repeat-IP cluster{signals.ip_clusters.length === 1 ? '' : 's'}</span>
                            <span><b className="text-[#1A1A1A]">{signals.fast_conversions}</b> converted within 10 min of entering the code</span>
                            <span>peak <b className="text-[#1A1A1A]">{signals.signup_burst_max_per_hour}</b> signups in one hour</span>
                        </div>
                        {(signals.shared_devices.length > 0 || signals.ip_clusters.length > 0) && (
                            <div className="mt-2 text-[10px] font-mono text-[#999]">
                                {signals.shared_devices.map((d, i) => <span key={`d${i}`} className="mr-4">device {d.device} × {d.users}</span>)}
                                {signals.ip_clusters.map((c, i) => <span key={`i${i}`} className="mr-4">ip {c.ip} × {c.clicks}</span>)}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="bg-white border border-[#E6E6E1] rounded-2xl p-5 mb-6">
                <div className="text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-3">
                    Signups{referred ? ` · ${referred.length} · ${referred.filter(r => r.converted_at).length} converted` : ''}
                </div>
                {!referred ? <div className="text-[11px] text-[#CCC] font-black">Loading...</div>
                    : referred.length === 0 ? <div className="text-[11px] text-[#CCC] font-black">Nobody has used this code yet</div>
                    : referred.map(r => (
                        <div key={r.referral_id} className="flex items-center gap-4 py-3 border-b border-[#EFEFEC] last:border-0">
                            <UserCheck size={13} className={r.converted_at ? 'text-[#8a7600] shrink-0' : 'text-[#CCC] shrink-0'} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[12px] text-[#1A1A1A] truncate">
                                    {r.display_name || r.username || r.user_id}
                                    {r.username && <span className="text-[#BBB]"> @{r.username}</span>}
                                </div>
                                <div className="text-[10px] font-mono text-[#999] truncate">{r.email ?? r.user_id}</div>
                            </div>
                            <div className="text-[10px] text-[#999] text-right shrink-0">
                                <div>signed up {fmtWhen(r.signed_up_at)}{r.source ? ` · ${r.source}` : ''}</div>
                                <div className={r.converted_at ? 'text-[#8a7600] font-black' : ''}>
                                    {r.converted_at
                                        ? <>converted {fmtWhen(r.converted_at)}
                                            {r.converting_session ? ` · ${r.converting_session.type} (${r.converting_session.verification})` : ''}
                                            {r.points_paid != null ? ` · +${r.points_paid}` : ''}</>
                                        : 'not yet converted'}
                                </div>
                            </div>
                        </div>
                    ))}
            </div>

            {/* Rules + rewards — front and centre, before the access chrome */}
            <div className="grid grid-cols-[1fr_auto] gap-6 items-end bg-white border border-[#E6E6E1] rounded-2xl p-5 mb-6">
                <div>
                    <div className="text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-2">Programme</div>
                    <select
                        value={creator.program_id ?? ''}
                        onChange={e => setProgram(e.target.value)}
                        disabled={busy}
                        className="h-11 px-4 pr-10 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/50 min-w-[260px]"
                    >
                        <option value="">Default{programs.find(p => p.is_default) ? ` (${programs.find(p => p.is_default).name})` : ''}</option>
                        {programs.filter(p => !p.is_default).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {effective && (
                        <div className="text-[10px] text-[#BBBBBB] font-black mt-2 tracking-wide">
                            {creator.conversion_points ?? effective.creator_conversion_points} pts / conversion · invitee {effective.invitee_bonus_points}
                            {effective.event_signup_points > 0 && <> · event +{effective.event_signup_points}</>}
                            {effective.min_session_minutes > 0 && <> · ≥{effective.min_session_minutes} min</>}
                            {' · '}<a href="/admin/creators/programmes" className="text-[#8a7600] hover:underline">edit programmes</a>
                        </div>
                    )}
                </div>
                <div>
                    <div className="text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-2">Points override</div>
                    <div className="flex gap-2">
                        <input type="number" min="0" value={override} onChange={e => setOverride(e.target.value)} placeholder="programme default"
                            className="w-40 h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm outline-none focus:border-[#E8D200]/50 placeholder-[#CCCCCC]" />
                        <button onClick={saveOverride} disabled={busy} className="h-11 px-5 bg-[#1A1A1A] text-white rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:bg-[#333] disabled:opacity-50">Save</button>
                    </div>
                </div>
            </div>

            {newLink && (
                <div className="bg-[#E8D200]/5 border border-[#E8D200]/30 rounded-2xl p-5 mb-6">
                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black mb-3">Setup link — this link IS the credential</div>
                    <div className="flex items-center gap-3">
                        <code className="flex-1 min-w-0 truncate text-[12px] text-[#666] bg-white px-4 py-3 rounded-xl border border-[#E6E6E1]">{newLink}</code>
                        <CopyBtn value={newLink} />
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-3 mb-8">
                <button onClick={mint} disabled={busy} className="flex items-center gap-2 h-10 px-5 bg-[#1A1A1A] text-white rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:bg-[#333] transition-all disabled:opacity-50">
                    <Link2 size={13} /> New setup link
                </button>
                <button onClick={toggleStatus} disabled={busy} className="flex items-center gap-2 h-10 px-5 bg-white border border-[#E6E6E1] text-[#666] rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:border-[#CCC] transition-all disabled:opacity-50">
                    {creator.status === 'active' ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Reactivate</>}
                </button>
                <a href={`/join/${creator.handle}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 h-10 px-5 bg-white border border-[#E6E6E1] text-[#666] rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:border-[#CCC] transition-all">
                    <ExternalLink size={13} /> View link page
                </a>
            </div>

            <div className="grid grid-cols-2 gap-8">
                <div>
                    <div className="text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-4">Portal users</div>
                    {!data ? <div className="text-[11px] text-[#CCC] font-black">Loading...</div>
                        : data.users.length === 0 ? <div className="text-[11px] text-[#CCC] font-black">Nobody has set up an account yet</div>
                        : data.users.map(u => (
                            <div key={u.user_id} className="flex items-center gap-3 py-3 border-b border-[#EFEFEC] last:border-0">
                                <Users size={13} className="text-[#CCC]" />
                                <span className="flex-1 text-[12px] text-[#666] font-mono truncate">{u.email ?? u.user_id}</span>
                                <button onClick={() => unlink(u.user_id)} disabled={busy} className="text-[9px] uppercase tracking-[0.2em] font-black text-red-400 hover:text-red-600 transition-colors">Unlink</button>
                            </div>
                        ))}
                </div>
                <div>
                    <div className="text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-4">Open setup links</div>
                    {!data ? <div className="text-[11px] text-[#CCC] font-black">Loading...</div>
                        : openInvites.length === 0 ? <div className="text-[11px] text-[#CCC] font-black">None outstanding</div>
                        : openInvites.map(i => (
                            <div key={i.id} className="flex items-center gap-3 py-3 border-b border-[#EFEFEC] last:border-0">
                                <Link2 size={13} className="text-[#CCC]" />
                                <span className="flex-1 text-[12px] text-[#666] truncate">
                                    {i.email || 'Copy-link only'} · {new Date(i.created_at).toLocaleDateString('en-GB')}
                                </span>
                                <button onClick={() => revoke(i.id)} disabled={busy} className="text-[9px] uppercase tracking-[0.2em] font-black text-red-400 hover:text-red-600 transition-colors">Revoke</button>
                            </div>
                        ))}
                </div>
            </div>
        </div>
    );
}

export default function CreatorManager() {
    const [creators, setCreators] = useState([]);
    const [programs, setPrograms] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [open, setOpen] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('creators')
            .select('*')
            .order('created_at', { ascending: false });
        setCreators(data ?? []);
        const { data: progs } = await supabase.from('creator_programs').select('*').order('is_default', { ascending: false }).order('name');
        setPrograms(progs ?? []);

        // Conversions per creator. RLS on referrals only shows the caller their
        // own rows (referrer / referred / own affiliate), so this must be an
        // admin RPC — a direct read here once showed each admin only the
        // referrals they were personally part of (2026-08-28).
        const { data: refs } = await supabase.rpc('admin_creator_referral_stats');
        const agg = {};
        (refs ?? []).forEach(r => {
            agg[r.creator_id] = { signups: Number(r.signups), converted: Number(r.converted) };
        });
        setStats(agg);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-2">
            <div className="flex items-end justify-between mb-2">
                <div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">Creators</h1>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                        {creators.length} total · invite-only
                    </p>
                </div>
                {!showNew && (
                    <button onClick={() => setShowNew(true)} className="flex items-center gap-3 h-12 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[11px] rounded-full hover:translate-y-[-2px] transition-all">
                        <Plus size={16} /> New affiliate
                    </button>
                )}
            </div>

            <CreatorTabs />

            {showNew && (
                <NewCreatorForm
                    onDone={() => { setShowNew(false); load(); }}
                    onCancel={() => setShowNew(false)}
                />
            )}

            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex justify-center py-24">
                        <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : creators.length === 0 ? (
                    <div className="text-center py-24 px-8">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-3">No creators yet</p>
                        <p className="text-sm text-[#888] font-light">Create one, then send them a setup link.</p>
                    </div>
                ) : creators.map(c => {
                    const s = stats[c.id] ?? { signups: 0, converted: 0 };
                    const isOpen = open === c.id;
                    return (
                        <div key={c.id} className="border-b border-[#F0F0ED] last:border-0">
                            <button
                                onClick={() => setOpen(isOpen ? null : c.id)}
                                className="w-full flex items-center gap-5 px-8 py-6 hover:bg-[#FAFAF8] transition-colors text-left"
                            >
                                {c.avatar_url ? (
                                    <img src={c.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                                ) : (
                                    <div className="w-11 h-11 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">
                                        {c.display_name?.[0]}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-bold text-[#1A1A1A] truncate">{c.display_name}</div>
                                    <div className="text-[11px] tracking-[0.12em] text-[#BBBBBB] font-black mt-1">
                                        @{c.handle} · <span className="font-mono tracking-[0.25em]">{c.code}</span>
                                    </div>
                                </div>
                                <div className="text-right shrink-0 w-24">
                                    <div className="text-[18px] font-light text-[#1A1A1A] tabular-nums">{s.converted}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">converted</div>
                                </div>
                                <div className="text-right shrink-0 w-24">
                                    <div className="text-[18px] font-light text-[#666] tabular-nums">{s.signups}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">signups</div>
                                </div>
                                <span className={`shrink-0 px-4 py-2 rounded-full border text-[9px] uppercase tracking-[0.2em] font-black ${STATUS_TONE[c.status]}`}>
                                    {c.status}
                                </span>
                                <X size={16} className={`shrink-0 text-[#CCC] transition-transform ${isOpen ? 'rotate-0' : 'rotate-45'}`} />
                            </button>
                            {isOpen && <AccessPanel creator={c} programs={programs} onChanged={load} />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
