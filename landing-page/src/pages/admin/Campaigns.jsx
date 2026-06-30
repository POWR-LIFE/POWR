import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X, Send, Trash2, Clock, Megaphone, Globe } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import AudienceSelector, { audienceLabel } from '../../components/AudienceSelector';

const TITLE_MAX = 65;
const BODY_MAX = 178;

const ROUTE_PRESETS = [
    { label: 'Home',     value: '' },
    { label: 'Rewards',  value: '/(tabs)/rewards' },
    { label: 'Progress', value: '/(tabs)/progress' },
    { label: 'Friends',  value: '/friends' },
];

// Calendar dot palette for new campaigns.
const CAMPAIGN_COLORS = ['#E8D200', '#10B981', '#0EA5E9', '#8B5CF6', '#F97316', '#F43F5E', '#14B8A6'];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// Local YYYY-MM-DD (calendar dates are stored as plain dates, no tz shift).
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = dateKey(new Date());

const prettyDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
const prettyTime = (t) => (t ? t.slice(0, 5) : '');

const STATUS_STYLE = {
    scheduled: { label: 'Scheduled', cls: 'bg-[#FEF9C3] text-[#854D0E]' },
    sending:   { label: 'Sending',   cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
    sent:      { label: 'Sent',      cls: 'bg-[#DCFCE7] text-[#166534]' },
    cancelled: { label: 'Cancelled', cls: 'bg-[#F3F4F6] text-[#6B7280]' },
    failed:    { label: 'Failed',    cls: 'bg-[#FEE2E2] text-[#991B1B]' },
};

const blankDraft = (date) => ({
    id: null,
    date,
    time: '09:00',
    title: '',
    body: '',
    route: '',
    campaignId: '',
    newCampaignName: '',
    audience: { mode: 'all' },
    audienceCount: null,
});

export default function Campaigns() {
    const toast = useToast();
    const now = new Date();
    const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
    const [campaigns, setCampaigns] = useState([]);
    const [items, setItems] = useState([]);       // scheduled_broadcasts (+ campaign)
    const [dayKey, setDayKey] = useState(null);    // open day panel
    const [draft, setDraft] = useState(null);      // composer draft (null = closed)
    const [saving, setSaving] = useState(false);

    const load = async () => {
        const [{ data: camps }, { data: rows }] = await Promise.all([
            supabase.from('broadcast_campaigns').select('*').order('created_at', { ascending: false }),
            supabase.from('scheduled_broadcasts')
                .select('*, campaign:broadcast_campaigns(id,name,color)')
                .order('send_date', { ascending: true })
                .order('send_local_time', { ascending: true }),
        ]);
        setCampaigns(camps ?? []);
        setItems(rows ?? []);
    };
    useEffect(() => { load(); }, []);

    // Group scheduled rows by their calendar day for the grid.
    const byDay = useMemo(() => {
        const m = {};
        for (const it of items) (m[it.send_date] ??= []).push(it);
        return m;
    }, [items]);

    // Build the month grid (Mon-first).
    const cells = useMemo(() => {
        const first = new Date(cursor.year, cursor.month, 1);
        const lead = (first.getDay() + 6) % 7;          // 0 = Monday
        const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
        const out = [];
        for (let i = 0; i < lead; i++) out.push(null);
        for (let d = 1; d <= days; d++) out.push(dateKey(new Date(cursor.year, cursor.month, d)));
        return out;
    }, [cursor]);

    const stepMonth = (delta) => {
        const m = cursor.month + delta;
        setCursor({ year: cursor.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 });
    };

    const upcoming = useMemo(
        () => items.filter((i) => ['scheduled', 'sending'].includes(i.status)),
        [items],
    );
    const recent = useMemo(
        () => items.filter((i) => ['sent', 'failed', 'cancelled'].includes(i.status))
            .sort((a, b) => (a.send_date < b.send_date ? 1 : -1)).slice(0, 12),
        [items],
    );

    const openNew = (key) => { setDayKey(key); setDraft(blankDraft(key)); };
    const openEdit = (it) => {
        setDayKey(it.send_date);
        setDraft({
            id: it.id,
            date: it.send_date,
            time: prettyTime(it.send_local_time),
            title: it.title,
            body: it.body,
            route: it.route ?? '',
            campaignId: it.campaign_id ?? '',
            newCampaignName: '',
            audience: it.audience ?? { mode: 'all' },
            audienceCount: null,
        });
    };

    const setD = (patch) => setDraft((d) => ({ ...d, ...patch }));

    const save = async () => {
        if (!draft.title.trim() || !draft.body.trim()) { toast.error('Title and message are required'); return; }
        setSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            let campaignId = draft.campaignId || null;

            // Create a new campaign on the fly if a name was typed.
            if (!campaignId && draft.newCampaignName.trim()) {
                const color = CAMPAIGN_COLORS[campaigns.length % CAMPAIGN_COLORS.length];
                const { data: c, error } = await supabase
                    .from('broadcast_campaigns')
                    .insert({ name: draft.newCampaignName.trim(), color, created_by: user?.id })
                    .select('id').single();
                if (error) throw error;
                campaignId = c.id;
            }

            const payload = {
                campaign_id: campaignId,
                title: draft.title.trim(),
                body: draft.body.trim(),
                route: draft.route || null,
                audience: draft.audience,
                send_date: draft.date,
                send_local_time: draft.time,
            };

            if (draft.id) {
                const { error } = await supabase.from('scheduled_broadcasts')
                    .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', draft.id);
                if (error) throw error;
                toast.success('Schedule updated');
            } else {
                const { error } = await supabase.from('scheduled_broadcasts')
                    .insert({ ...payload, status: 'scheduled', created_by: user?.id });
                if (error) throw error;
                toast.success('Push scheduled');
            }
            setDraft(null);
            await load();
        } catch (e) {
            toast.error(e.message || 'Could not save');
        } finally {
            setSaving(false);
        }
    };

    const cancelItem = async (it) => {
        const { error } = await supabase.from('scheduled_broadcasts')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', it.id);
        if (error) return toast.error(error.message);
        toast.success('Cancelled');
        load();
    };
    const deleteItem = async (it) => {
        const { error } = await supabase.from('scheduled_broadcasts').delete().eq('id', it.id);
        if (error) return toast.error(error.message);
        toast.success('Removed');
        load();
    };

    const dayItems = dayKey ? (byDay[dayKey] ?? []) : [];

    return (
        <div className="max-w-5xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                    <CalendarDays size={22} className="text-[#E8D200]" />
                    <h1 className="text-xl font-bold text-[#111]">Campaigns &amp; Schedule</h1>
                </div>
                <Link to="/admin/broadcast" className="flex items-center gap-1.5 text-sm text-[#777] hover:text-[#111] transition-colors">
                    <Megaphone size={15} /> Send one now
                </Link>
            </div>
            <p className="text-sm text-[#777] mb-5 flex items-center gap-1.5">
                <Globe size={13} className="text-[#AAA]" />
                Scheduled pushes are delivered at the chosen time in <span className="font-medium text-[#555]">each user's local timezone</span>.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Calendar */}
                <div className="lg:col-span-2 rounded-2xl border border-[#E6E6E1] bg-white p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-semibold text-[#111]">{MONTHS[cursor.month]} {cursor.year}</h2>
                        <div className="flex items-center gap-1">
                            <button onClick={() => stepMonth(-1)} className="p-1.5 rounded-lg hover:bg-[#F4F4F1] text-[#666]"><ChevronLeft size={18} /></button>
                            <button onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })} className="px-2.5 py-1 rounded-lg hover:bg-[#F4F4F1] text-xs font-medium text-[#666]">Today</button>
                            <button onClick={() => stepMonth(1)} className="p-1.5 rounded-lg hover:bg-[#F4F4F1] text-[#666]"><ChevronRight size={18} /></button>
                        </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1 mb-1">
                        {WEEKDAYS.map((w) => (
                            <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wide text-[#AAA] py-1">{w}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {cells.map((key, i) => {
                            if (!key) return <div key={`b${i}`} />;
                            const dayRows = byDay[key] ?? [];
                            const isToday = key === todayKey;
                            const isPast = key < todayKey;
                            return (
                                <button
                                    key={key}
                                    onClick={() => openNew(key)}
                                    className={`aspect-square rounded-xl border p-1.5 flex flex-col items-start text-left transition-colors ${
                                        isToday ? 'border-[#E8D200] bg-[#FEFCE8]' : 'border-[#EEEEEA] hover:border-[#D8D8D2] hover:bg-[#FAFAF8]'
                                    } ${isPast ? 'opacity-60' : ''}`}
                                >
                                    <span className={`text-xs font-medium ${isToday ? 'text-[#8a7600]' : 'text-[#444]'}`}>{Number(key.split('-')[2])}</span>
                                    <div className="mt-auto flex flex-wrap gap-1">
                                        {dayRows.slice(0, 4).map((it) => (
                                            <span key={it.id} className="w-1.5 h-1.5 rounded-full"
                                                style={{ background: it.campaign?.color || (it.status === 'sent' ? '#10B981' : '#E8D200') }} />
                                        ))}
                                        {dayRows.length > 4 && <span className="text-[8px] text-[#AAA] leading-none">+{dayRows.length - 4}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Upcoming list */}
                <div className="rounded-2xl border border-[#E6E6E1] bg-white p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-[#555] flex items-center gap-1.5"><Clock size={15} /> Upcoming</h2>
                        <button onClick={() => openNew(todayKey)} className="flex items-center gap-1 text-xs font-semibold text-[#8a7600] hover:text-[#6b5b00]">
                            <Plus size={14} /> New
                        </button>
                    </div>
                    {upcoming.length === 0 && <div className="text-sm text-[#AAA] py-6 text-center">Nothing scheduled.</div>}
                    <div className="space-y-2">
                        {upcoming.map((it) => (
                            <button key={it.id} onClick={() => openEdit(it)}
                                className="w-full text-left rounded-xl border border-[#EEEEEA] hover:border-[#D8D8D2] p-3">
                                <div className="flex items-center gap-2 mb-0.5">
                                    {it.campaign && <span className="w-2 h-2 rounded-full" style={{ background: it.campaign.color }} />}
                                    <span className="text-xs font-medium text-[#666]">{prettyDate(it.send_date)} · {prettyTime(it.send_local_time)}</span>
                                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[it.status].cls}`}>{STATUS_STYLE[it.status].label}</span>
                                </div>
                                <div className="text-sm font-semibold text-[#111] truncate">{it.title}</div>
                                {it.campaign && <div className="text-[11px] text-[#999] truncate">{it.campaign.name}</div>}
                            </button>
                        ))}
                    </div>

                    {recent.length > 0 && (
                        <>
                            <h2 className="text-sm font-semibold text-[#555] mt-6 mb-2">Recent</h2>
                            <div className="space-y-1.5">
                                {recent.map((it) => (
                                    <div key={it.id} className="flex items-center gap-2 text-xs px-1">
                                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[it.status].cls}`}>{STATUS_STYLE[it.status].label}</span>
                                        <span className="text-[#444] truncate flex-1">{it.title}</span>
                                        <span className="text-[#AAA]">{prettyDate(it.send_date)}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Day panel / composer modal */}
            {dayKey && (
                <div className="fixed inset-0 z-[400] flex items-start justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={() => { setDayKey(null); setDraft(null); }}>
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0EC]">
                            <h3 className="text-base font-bold text-[#111]">{prettyDate(dayKey)}</h3>
                            <button onClick={() => { setDayKey(null); setDraft(null); }} className="text-[#999] hover:text-[#111]"><X size={18} /></button>
                        </div>

                        <div className="px-6 py-5 space-y-5">
                            {/* Existing sends this day */}
                            {dayItems.length > 0 && !draft?.id && (
                                <div className="space-y-2">
                                    <div className="text-xs font-semibold text-[#888] uppercase tracking-wide">Scheduled this day</div>
                                    {dayItems.map((it) => (
                                        <div key={it.id} className="flex items-center gap-3 rounded-xl border border-[#EEEEEA] p-3">
                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: it.campaign?.color || '#E8D200' }} />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium text-[#111] truncate">{it.title}</div>
                                                <div className="text-[11px] text-[#999]">{prettyTime(it.send_local_time)} · {audienceLabel(it.audience)} · {STATUS_STYLE[it.status].label}</div>
                                            </div>
                                            {['scheduled'].includes(it.status) && (
                                                <button onClick={() => openEdit(it)} className="text-xs font-medium text-[#8a7600] hover:underline">Edit</button>
                                            )}
                                            {['scheduled', 'sending'].includes(it.status) && (
                                                <button onClick={() => cancelItem(it)} className="text-xs font-medium text-[#B91C1C] hover:underline">Cancel</button>
                                            )}
                                            {['cancelled', 'failed'].includes(it.status) && (
                                                <button onClick={() => deleteItem(it)} className="text-[#BBB] hover:text-[#B91C1C]"><Trash2 size={14} /></button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Composer */}
                            {draft && (
                                <div className="space-y-4">
                                    <div className="text-xs font-semibold text-[#888] uppercase tracking-wide">{draft.id ? 'Edit scheduled push' : 'Schedule a push'}</div>

                                    {/* Campaign + when */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] font-medium text-[#999] mb-1">Date</label>
                                            <input type="date" value={draft.date} onChange={(e) => setD({ date: e.target.value })}
                                                className="w-full rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8D200]" />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-medium text-[#999] mb-1">Local time</label>
                                            <input type="time" value={draft.time} onChange={(e) => setD({ time: e.target.value })}
                                                className="w-full rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8D200]" />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-medium text-[#999] mb-1">Campaign <span className="text-[#CCC]">(optional)</span></label>
                                        <div className="flex gap-2">
                                            <select value={draft.campaignId} onChange={(e) => setD({ campaignId: e.target.value, newCampaignName: '' })}
                                                className="flex-1 rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8D200]">
                                                <option value="">No campaign</option>
                                                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                            {!draft.campaignId && (
                                                <input value={draft.newCampaignName} onChange={(e) => setD({ newCampaignName: e.target.value })}
                                                    placeholder="…or new campaign name"
                                                    className="flex-1 rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8D200]" />
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-[#F0F0EC] p-3">
                                        <AudienceSelector key={draft.id ?? 'new'} onChange={({ audience, count }) => setD({ audience, audienceCount: count })} />
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-medium text-[#999] mb-1">Title</label>
                                        <input value={draft.title} maxLength={TITLE_MAX} onChange={(e) => setD({ title: e.target.value })}
                                            placeholder="e.g. 3 days to go 🔥"
                                            className="w-full rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8D200]" />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-medium text-[#999] mb-1">Message</label>
                                        <textarea value={draft.body} maxLength={BODY_MAX} rows={2} onChange={(e) => setD({ body: e.target.value })}
                                            placeholder="Get ready — it kicks off this weekend."
                                            className="w-full rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] resize-none focus:outline-none focus:border-[#E8D200]" />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-medium text-[#999] mb-1">Opens</label>
                                        <div className="flex flex-wrap gap-2">
                                            {ROUTE_PRESETS.map((p) => (
                                                <button key={p.label} onClick={() => setD({ route: p.value })}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                                        draft.route === p.value ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#CFCFCF]'
                                                    }`}>{p.label}</button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-2 pt-1">
                                        <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl text-sm text-[#666] hover:bg-[#F4F4F1]">Cancel</button>
                                        <button onClick={save} disabled={saving}
                                            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#E8D200] text-[#080808] text-sm font-semibold hover:brightness-95 disabled:opacity-40">
                                            <Send size={15} /> {saving ? 'Saving…' : draft.id ? 'Update' : 'Schedule'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!draft && (
                                <button onClick={() => setDraft(blankDraft(dayKey))}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-[#D8D8D2] text-sm font-medium text-[#666] hover:border-[#E8D200] hover:text-[#8a7600]">
                                    <Plus size={16} /> Schedule a push for this day
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
