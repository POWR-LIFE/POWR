import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, Loader2, Star, ChevronRight, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';

// ── helpers ──────────────────────────────────────────────────────────────────

function toDatetimeLocal(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60_000);
    return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value) {
    if (!value) return '';
    return new Date(value).toISOString();
}

function nextMonday(from = new Date()) {
    const d = new Date(from);
    const day = d.getDay(); // 0=Sun
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addWeeks(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n * 7);
    return d;
}

function formatWindow(starts, ends) {
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmt(starts)} → ${fmt(ends)}`;
}

function isActive(starts, ends) {
    const now = Date.now();
    return new Date(starts).getTime() <= now && new Date(ends).getTime() > now;
}

function isUpcoming(starts) {
    return new Date(starts).getTime() > Date.now();
}

// ── component ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = { reward_id: '', starts_at: '', ends_at: '' };

export default function FeaturedSchedule() {
    const toast = useToast();
    const [schedule, setSchedule] = useState([]);
    const [rewards, setRewards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        const [sched, rew] = await Promise.all([
            supabase
                .from('featured_reward_schedule')
                .select('id, reward_id, starts_at, ends_at, rewards(title, brand_name, partners(name, logo_url))')
                .order('starts_at', { ascending: false }),
            supabase
                .from('rewards')
                .select('id, title, brand_name, partners(name, logo_url)')
                .eq('active', true)
                .order('title'),
        ]);
        if (sched.error) toast.error('Failed to load schedule');
        else setSchedule(sched.data || []);
        if (rew.data) setRewards(rew.data);
        setLoading(false);
    };

    const openCreate = () => {
        const start = nextMonday();
        const end = addWeeks(start, 1);
        setFormData({
            reward_id: '',
            starts_at: toDatetimeLocal(start.toISOString()),
            ends_at: toDatetimeLocal(end.toISOString()),
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.reward_id) { toast.error('Select a reward'); return; }
        setSaving(true);
        const payload = {
            reward_id: formData.reward_id,
            starts_at: fromDatetimeLocal(formData.starts_at),
            ends_at: fromDatetimeLocal(formData.ends_at),
        };
        const { error } = await supabase.from('featured_reward_schedule').insert([payload]);
        if (error) {
            toast.error(error.message);
        } else {
            toast.success('Slot scheduled');
            setIsModalOpen(false);
            fetchData();
        }
        setSaving(false);
    };

    const handleDelete = async (id) => {
        const { error } = await supabase.from('featured_reward_schedule').delete().eq('id', id);
        if (error) {
            toast.error('Delete failed');
        } else {
            toast.success('Slot removed');
            setSchedule(prev => prev.filter(s => s.id !== id));
        }
        setConfirmDeleteId(null);
    };

    const rewardLabel = (row) => {
        const r = row.rewards;
        if (!r) return row.reward_id;
        return r.partners?.name || r.brand_name || r.title || row.reward_id;
    };

    const logoUrl = (row) => row.rewards?.partners?.logo_url ?? null;

    const upcoming = schedule.filter(s => isUpcoming(s.starts_at));
    const past = schedule.filter(s => !isUpcoming(s.starts_at) && !isActive(s.starts_at, s.ends_at));
    const current = schedule.find(s => isActive(s.starts_at, s.ends_at));

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Subsystem / Featured Slot</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Featured Rotation</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Schedule which reward occupies the featured card on the rewards screen, week by week.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="flex items-center gap-4 h-16 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 shrink-0"
                >
                    <Plus size={18} /> Schedule Slot
                </button>
            </div>

            {/* Current slot callout */}
            {current && (
                <div className="mb-12 flex items-center gap-6 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-3xl px-10 py-7">
                    <div className="w-10 h-10 rounded-2xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                        <Star size={18} className="text-[#8a7600]" />
                    </div>
                    <div className="flex-1">
                        <div className="text-[9px] uppercase tracking-[0.5em] text-[#8a7600] font-black mb-1">Live Now</div>
                        <div className="text-base font-bold text-[#1A1A1A]">{rewardLabel(current)}</div>
                        <div className="text-[11px] text-[#888888] mt-0.5 font-black uppercase tracking-[0.2em]">{formatWindow(current.starts_at, current.ends_at)}</div>
                    </div>
                    {confirmDeleteId === current.id ? (
                        <div className="flex items-center gap-3">
                            <button onClick={() => handleDelete(current.id)} className="h-9 px-5 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] rounded-full border border-red-500/20 hover:bg-red-500/20 transition-all">Remove</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="h-9 px-5 bg-[#F4F4F1] text-[#666666] text-[10px] font-black uppercase tracking-[0.3em] rounded-full border border-[#E6E6E1] hover:text-[#333333] transition-all">Cancel</button>
                        </div>
                    ) : (
                        <button onClick={() => setConfirmDeleteId(current.id)} className="text-[#AAAAAA] hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                    )}
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-48 gap-6">
                    <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Schedule...</span>
                </div>
            ) : (
                <>
                    {/* Upcoming */}
                    <Section title="Upcoming" count={upcoming.length}>
                        {upcoming.length === 0 ? (
                            <EmptyState label="No upcoming slots — schedule one above" />
                        ) : upcoming.map(slot => (
                            <SlotRow
                                key={slot.id}
                                slot={slot}
                                label={rewardLabel(slot)}
                                logo={logoUrl(slot)}
                                confirmDeleteId={confirmDeleteId}
                                onConfirmDelete={() => setConfirmDeleteId(slot.id)}
                                onCancelDelete={() => setConfirmDeleteId(null)}
                                onDelete={() => handleDelete(slot.id)}
                            />
                        ))}
                    </Section>

                    {/* Past */}
                    {past.length > 0 && (
                        <Section title="Past" count={past.length} muted>
                            {past.map(slot => (
                                <SlotRow
                                    key={slot.id}
                                    slot={slot}
                                    label={rewardLabel(slot)}
                                    logo={logoUrl(slot)}
                                    muted
                                    confirmDeleteId={confirmDeleteId}
                                    onConfirmDelete={() => setConfirmDeleteId(slot.id)}
                                    onCancelDelete={() => setConfirmDeleteId(null)}
                                    onDelete={() => handleDelete(slot.id)}
                                />
                            ))}
                        </Section>
                    )}
                </>
            )}

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="flex min-h-full items-center justify-center p-8">
                        <div className="bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl w-full max-w-xl shadow-[0_0_100px_rgba(232,210,0,0.05)]">
                            <form onSubmit={handleSave} className="p-12">
                                <div className="flex items-center justify-between mb-12">
                                    <div>
                                        <h2 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">New Featured Slot</h2>
                                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">Assign a reward to a date window</p>
                                    </div>
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="w-12 h-12 bg-white border border-[#E6E6E1] rounded-3xl flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] hover:border-[#E8D200]/40 transition-all">
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="mb-8">
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Reward</label>
                                    <select
                                        required
                                        className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#222222] tracking-[0.1em] uppercase"
                                        value={formData.reward_id}
                                        onChange={e => setFormData({ ...formData, reward_id: e.target.value })}
                                    >
                                        <option value="">— Select a reward —</option>
                                        {rewards.map(r => {
                                            const name = r.partners?.name || r.brand_name || r.title;
                                            return <option key={r.id} value={r.id}>{name} — {r.title}</option>;
                                        })}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-6 mb-10">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Starts</label>
                                        <input
                                            type="datetime-local"
                                            required
                                            className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#1A1A1A]"
                                            value={formData.starts_at}
                                            onChange={e => setFormData({ ...formData, starts_at: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Ends</label>
                                        <input
                                            type="datetime-local"
                                            required
                                            className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#1A1A1A]"
                                            value={formData.ends_at}
                                            onChange={e => setFormData({ ...formData, ends_at: e.target.value })}
                                        />
                                    </div>
                                </div>

                                {/* Quick-fill week buttons */}
                                <div className="mb-10">
                                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black mb-4">Quick fill — week of</div>
                                    <div className="flex flex-wrap gap-3">
                                        {[0, 1, 2, 3].map(offset => {
                                            const start = addWeeks(nextMonday(), offset);
                                            const end = addWeeks(start, 1);
                                            const label = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                                            return (
                                                <button
                                                    key={offset}
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({
                                                        ...prev,
                                                        starts_at: toDatetimeLocal(start.toISOString()),
                                                        ends_at: toDatetimeLocal(end.toISOString()),
                                                    }))}
                                                    className="h-9 px-5 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all"
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="flex justify-end gap-4">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="h-14 px-8 text-[11px] uppercase tracking-[0.4em] font-black text-[#666666] hover:text-[#BBB] transition-colors">Cancel</button>
                                    <button type="submit" disabled={saving} className="h-14 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] rounded-full transition-all hover:translate-y-[-2px] shadow-xl shadow-[#E8D200]/20 disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Schedule'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── sub-components ────────────────────────────────────────────────────────────

function Section({ title, count, muted, children }) {
    return (
        <div className="mb-12">
            <div className="flex items-center gap-4 mb-6">
                <span className={`text-[10px] uppercase tracking-[0.5em] font-black ${muted ? 'text-[#AAAAAA]' : 'text-[#666666]'}`}>{title}</span>
                <div className={`h-[1px] flex-1 ${muted ? 'bg-[#EFEFEC]' : 'bg-[#E2E2DD]'}`} />
                <span className={`text-[10px] font-black ${muted ? 'text-[#BBBBBB]' : 'text-[#999999]'}`}>{count}</span>
            </div>
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden divide-y divide-[#E6E6E1]">
                {children}
            </div>
        </div>
    );
}

function EmptyState({ label }) {
    return (
        <div className="flex items-center justify-center py-16">
            <span className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{label}</span>
        </div>
    );
}

function SlotRow({ slot, label, logo, muted, confirmDeleteId, onConfirmDelete, onCancelDelete, onDelete }) {
    return (
        <div className={`flex items-center gap-6 px-10 py-7 group ${muted ? 'opacity-40' : ''}`}>
            <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0 overflow-hidden">
                {logo ? (
                    <img src={logo} alt="" className="w-full h-full object-contain p-1" />
                ) : (
                    <CalendarClock size={16} className="text-[#999999]" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#222222] truncate">{label}</div>
                <div className="text-[11px] text-[#999999] font-black uppercase tracking-[0.2em] mt-0.5">
                    {formatWindow(slot.starts_at, slot.ends_at)}
                </div>
            </div>
            {confirmDeleteId === slot.id ? (
                <div className="flex items-center gap-3">
                    <button onClick={onDelete} className="h-9 px-5 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] rounded-full border border-red-500/20 hover:bg-red-500/20 transition-all">Remove</button>
                    <button onClick={onCancelDelete} className="h-9 px-5 bg-[#F4F4F1] text-[#666666] text-[10px] font-black uppercase tracking-[0.3em] rounded-full border border-[#E6E6E1] hover:text-[#333333] transition-all">Cancel</button>
                </div>
            ) : (
                <button onClick={onConfirmDelete} className="text-[#BBBBBB] group-hover:text-[#999999] hover:!text-red-500 transition-colors">
                    <Trash2 size={15} />
                </button>
            )}
        </div>
    );
}
