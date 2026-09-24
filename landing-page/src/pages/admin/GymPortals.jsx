import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dumbbell, Search, Eye, Plus, ShieldCheck, PauseCircle, Power, CalendarCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import GymStaffPanel from '../../components/GymStaffPanel';
import { GymLogo } from '../venue/VenueLayout';

// ─── Gym Portals (/admin/gyms) ────────────────────────────────────────────────
// Switch the gym portal (/venue) on per gym, send the first owner their
// invite, and pause or suspend access. A gym's team then runs its own
// screens (and, from phase 2, its own events). Settings live in
// gym_portal_settings (admin-only RLS); logins go through manage-gym-staff.
//
// Trusted is recorded now but only matters once gyms can publish events: a
// trusted gym's events go live without POWR reviewing each one.

function Toggle({ on, onFlip, disabled }) {
    return (
        <button
            type="button" role="switch" aria-checked={on} onClick={onFlip} disabled={disabled}
            className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-[#10B981]' : 'bg-[#D8D8D2]'}`}
        >
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
        </button>
    );
}

function statusOf(g) {
    if (g.suspended_at) return { label: 'Suspended', color: '#ef4444' };
    if (!g.enabled) return { label: 'Off', color: '#AAAAAA' };
    return { label: 'On', color: '#10B981' };
}

export default function GymPortals() {
    const toast = useToast();
    const navigate = useNavigate();
    const { user, setActingGym } = useAuth();
    const [rows, setRows] = useState([]);
    const [staffCounts, setStaffCounts] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState([]);
    const [saving, setSaving] = useState(false);
    const [pending, setPending] = useState([]);
    const [trustOnApprove, setTrustOnApprove] = useState(true);

    // Gym-run events waiting for their first-event check.
    const loadPending = async () => {
        const { data } = await supabase
            .from('live_events')
            .select('id, name, slug, template_key, window_start_at, window_end_at, doors_open_at, prizes, rules, promo_headline, submitted_at, attendance_bonus_points, audience_radius_km, partners:venue_partner_id(name)')
            .eq('review_status', 'pending')
            .order('submitted_at', { ascending: true });
        setPending(data ?? []);
    };

    const review = async (ev, decision) => {
        let note = null;
        if (decision === 'reject') {
            note = window.prompt(`What should ${ev.partners?.name ?? 'the gym'} change? They see this in their portal.`);
            if (note == null) return;
        }
        setSaving(true);
        const { error } = await supabase.rpc('admin_review_gym_event', {
            p_event_id: ev.id, p_decision: decision, p_note: note, p_trust: trustOnApprove,
        });
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        toast.success(decision === 'approve' ? `${ev.name} is live in the app${trustOnApprove ? ' — and the gym is trusted from now on' : ''}` : 'Sent back with your note');
        loadPending();
        load();
    };

    const load = async () => {
        const [{ data: settings, error }, { data: staff }] = await Promise.all([
            supabase
                .from('gym_portal_settings')
                .select('*, partners(name, logo_url, logo_bg, address, active)')
                .order('created_at', { ascending: false }),
            supabase.from('gym_staff').select('partner_id, role'),
        ]);
        if (error) toast.error('Could not load gym portals');
        setRows(settings ?? []);
        const counts = {};
        for (const s of staff ?? []) {
            counts[s.partner_id] ??= { owners: 0, staff: 0 };
            counts[s.partner_id][s.role === 'owner' ? 'owners' : 'staff'] += 1;
        }
        setStaffCounts(counts);
        setLoading(false);
    };

    useEffect(() => { load(); loadPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) { setResults([]); return; }
        const t = setTimeout(async () => {
            const { data } = await supabase
                .from('partners')
                .select('id, name, logo_url, logo_bg, address')
                .eq('category', 'gym')
                .ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
                .limit(10);
            setResults(data ?? []);
        }, 250);
        return () => clearTimeout(t);
    }, [search]);

    const audit = (action, partnerId, metadata = {}) =>
        supabase.from('admin_audit_log').insert({
            admin_id: user?.id, action, target_type: 'partner', target_id: partnerId, metadata,
        });

    const enable = async (partner) => {
        setSaving(true);
        const { error } = await supabase
            .from('gym_portal_settings')
            .upsert({ partner_id: partner.id, enabled: true, created_by: user?.id, updated_at: new Date().toISOString() }, { onConflict: 'partner_id' });
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        audit('gym_portal_enabled', partner.id, { name: partner.name });
        toast.success(`Gym portal on for ${partner.name} — invite the owner next`);
        setSearch('');
        setResults([]);
        setSelectedId(partner.id);
        load();
    };

    const patch = async (row, change, action, msg) => {
        setSaving(true);
        const { error } = await supabase
            .from('gym_portal_settings')
            .update({ ...change, updated_at: new Date().toISOString() })
            .eq('partner_id', row.partner_id);
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        audit(action, row.partner_id, change);
        toast.success(msg);
        load();
    };

    const viewAs = async (partnerId) => {
        await setActingGym(partnerId);
        navigate('/venue');
    };

    const selected = rows.find(r => r.partner_id === selectedId) ?? null;
    const enabledIds = new Set(rows.map(r => r.partner_id));

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-16">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Gyms / Self-serve</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Gym Portals</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Give a gym its own portal at /venue: its big screens, who’s training, its team.
                    </p>
                </div>
            </div>

            {pending.length > 0 && (
                <div className="bg-white border border-[#E8D200]/40 rounded-3xl p-8 mb-10">
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-3">
                            <CalendarCheck size={14} className="text-[#8a7600]" />
                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">Events waiting for your OK · {pending.length}</span>
                        </div>
                        <label className="flex items-center gap-3 text-[11px] text-[#666]">
                            <Toggle on={trustOnApprove} onFlip={() => setTrustOnApprove(t => !t)} disabled={saving} />
                            Trust the gym when I approve (its next events publish without review)
                        </label>
                    </div>
                    <div className="space-y-4">
                        {pending.map(ev => (
                            <div key={ev.id} className="p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-[10px] uppercase tracking-[0.3em] text-[#8a7600] font-black">{ev.partners?.name} · {ev.template_key}</div>
                                        <div className="text-lg font-bold mt-1">{ev.name}</div>
                                        <div className="text-[12px] text-[#888] mt-1">
                                            {new Date(ev.window_start_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                                            {' → '}
                                            {new Date(new Date(ev.window_end_at).getTime() - 60000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                                            {ev.doors_open_at ? ` · finale ${new Date(ev.doors_open_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
                                            {ev.attendance_bonus_points ? ` · +${ev.attendance_bonus_points} POWR for attending` : ''}
                                            {ev.audience_radius_km ? ` · shown within ${ev.audience_radius_km} km` : ''}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <button disabled={saving} onClick={() => review(ev, 'reject')} className="h-10 px-5 rounded-full border border-[#E6E6E1] bg-white text-[10px] font-black uppercase tracking-[0.2em] text-[#666] disabled:opacity-50">Send back</button>
                                        <button disabled={saving} onClick={() => review(ev, 'approve')} className="h-10 px-5 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-50">Approve</button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-[12px]">
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-1">Prizes</div>
                                        {(ev.prizes ?? []).map(p => <div key={p.rank}>{p.rank}. {p.label}</div>)}
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-1">Rules</div>
                                        {(ev.rules ?? []).map((r, i) => <div key={i} className="text-[#666]">· {r}</div>)}
                                        {ev.promo_headline && <div className="mt-2 italic text-[#666]">“{ev.promo_headline}”</div>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Switch a gym on */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-10">
                <div className="flex items-center gap-3 mb-4">
                    <Plus size={14} className="text-[#8a7600]" />
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">Switch a gym on</span>
                </div>
                <div className="relative max-w-xl">
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                    <input
                        type="text" value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search gyms by name…"
                        className="w-full h-12 pl-10 pr-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm outline-none focus:border-[#E8D200]/40"
                    />
                </div>
                {results.length > 0 && (
                    <div className="mt-4 space-y-2 max-w-xl">
                        {results.map(p => (
                            <div key={p.id} className="flex items-center gap-4 p-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <GymLogo gym={p} size="w-9 h-9" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold truncate">{p.name}</div>
                                    {p.address && <div className="text-[10px] text-[#AAAAAA] truncate">{p.address}</div>}
                                </div>
                                {enabledIds.has(p.id) ? (
                                    <button onClick={() => { setSelectedId(p.id); setSearch(''); }} className="h-9 px-4 rounded-full border border-[#E6E6E1] bg-white text-[10px] font-black uppercase tracking-[0.2em] text-[#666]">
                                        Open
                                    </button>
                                ) : (
                                    <button disabled={saving} onClick={() => enable(p)} className="h-9 px-4 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-50">
                                        Switch on
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
                {/* List */}
                <div className="xl:col-span-2 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden self-start">
                    {loading ? (
                        <div className="flex justify-center py-24">
                            <div className="w-10 h-10 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-20 px-8 text-center">
                            <Dumbbell size={22} className="mx-auto text-[#CCCCCC] mb-4" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">No gym has the portal yet</p>
                            <p className="text-[12px] text-[#AAAAAA] mt-3">Search above to switch one on. Start with POWR’s own gym to try it.</p>
                        </div>
                    ) : rows.map(r => {
                        const st = statusOf(r);
                        const c = staffCounts[r.partner_id] ?? { owners: 0, staff: 0 };
                        const gym = { name: r.partners?.name, logo_url: r.partners?.logo_url, logo_bg: r.partners?.logo_bg };
                        return (
                            <button
                                key={r.partner_id}
                                onClick={() => setSelectedId(r.partner_id)}
                                className={`w-full flex items-center gap-4 px-6 py-5 border-b border-[#F0F0EC] text-left transition-colors ${selectedId === r.partner_id ? 'bg-[#E8D200]/10' : 'hover:bg-[#FAFAF8]'}`}
                            >
                                <GymLogo gym={gym} size="w-10 h-10" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold truncate">{gym.name}</div>
                                    <div className="text-[10px] text-[#AAAAAA] font-bold mt-0.5">
                                        {c.owners} owner{c.owners === 1 ? '' : 's'} · {c.staff} team{r.trusted_at ? ' · trusted' : ''}
                                    </div>
                                </div>
                                <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: st.color }}>
                                    <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                                    {st.label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Detail */}
                <div className="xl:col-span-3 space-y-8">
                    {!selected ? (
                        <div className="bg-white border border-dashed border-[#E6E6E1] rounded-3xl py-24 text-center">
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Pick a gym</p>
                        </div>
                    ) : (
                        <>
                            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                                <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <GymLogo gym={{ name: selected.partners?.name, logo_url: selected.partners?.logo_url, logo_bg: selected.partners?.logo_bg }} size="w-12 h-12" />
                                        <div className="min-w-0">
                                            <div className="text-2xl font-light tracking-tight truncate">{selected.partners?.name}</div>
                                            {selected.partners?.address && <div className="text-[11px] text-[#AAAAAA] truncate">{selected.partners.address}</div>}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => viewAs(selected.partner_id)}
                                        className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[10px] font-black uppercase tracking-[0.2em] text-[#8B5CF6]"
                                    >
                                        <Eye size={13} /> View as gym
                                    </button>
                                </div>

                                <div className="divide-y divide-[#F0F0EC]">
                                    {[
                                        {
                                            icon: Power, label: 'Portal on',
                                            hint: 'Off: nobody at the gym can sign in to the portal. Their screens keep running.',
                                            on: selected.enabled,
                                            flip: () => patch(selected, { enabled: !selected.enabled }, selected.enabled ? 'gym_portal_disabled' : 'gym_portal_enabled', selected.enabled ? 'Portal switched off' : 'Portal switched on'),
                                        },
                                        {
                                            icon: PauseCircle, label: 'Suspended',
                                            hint: 'For a problem: locks the gym out until you lift it. Logged with the time.',
                                            on: !!selected.suspended_at,
                                            flip: () => patch(selected, { suspended_at: selected.suspended_at ? null : new Date().toISOString() }, selected.suspended_at ? 'gym_portal_unsuspended' : 'gym_portal_suspended', selected.suspended_at ? 'Suspension lifted' : 'Gym suspended'),
                                        },
                                        {
                                            icon: ShieldCheck, label: 'Trusted',
                                            hint: 'Once gyms can publish events: a trusted gym’s events go live without POWR reviewing each one. Its first event always gets reviewed.',
                                            on: !!selected.trusted_at,
                                            flip: () => patch(selected, selected.trusted_at ? { trusted_at: null, trusted_by: null } : { trusted_at: new Date().toISOString(), trusted_by: user?.id }, selected.trusted_at ? 'gym_trust_removed' : 'gym_trusted', selected.trusted_at ? 'No longer trusted' : 'Gym trusted'),
                                        },
                                    ].map(s => (
                                        <div key={s.label} className="flex items-center gap-5 py-5">
                                            <s.icon size={16} className="text-[#AAAAAA] shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13px] font-bold">{s.label}</div>
                                                <div className="text-[11px] text-[#999] leading-relaxed">{s.hint}</div>
                                            </div>
                                            <Toggle on={s.on} onFlip={s.flip} disabled={saving} />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <GymStaffPanel key={selected.partner_id} partnerId={selected.partner_id} gymName={selected.partners?.name} adminView />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
