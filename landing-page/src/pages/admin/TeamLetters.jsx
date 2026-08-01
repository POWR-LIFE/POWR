import {
    Activity, AlertCircle, Archive, BarChart3, CheckCircle2, Database,
    Eye, FilePlus2, Mail, RefreshCw, Send, Trash2, UserPlus, Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../App';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';

const AUTOMATED_BODY = 'Automated weekly platform report. See report_data for the archived snapshot.';

const STATUS = {
    draft: { label: 'Draft', className: 'bg-[#F4F4F1] text-[#777777]' },
    sending: { label: 'Sending', className: 'bg-[#DBEAFE] text-[#1D4ED8]' },
    sent: { label: 'Sent', className: 'bg-[#DCFCE7] text-[#166534]' },
    failed: { label: 'Failed', className: 'bg-[#FEE2E2] text-[#991B1B]' },
};

const fieldClass = 'w-full rounded-lg border border-[#E6E6E1] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200] disabled:bg-[#F4F4F1] disabled:text-[#888888]';

const dateKey = (date) => [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
].join('-');

function currentWeek() {
    const now = new Date();
    const mondayOffset = (now.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - mondayOffset);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { start: dateKey(start), end: dateKey(end) };
}

function blankLetter() {
    const week = currentWeek();
    return {
        id: null,
        title: 'POWR Platform Pulse',
        subject: `[POWR Weekly] Platform report | week ending ${week.end}`,
        preview_text: '',
        reporting_start: week.start,
        reporting_end: week.end,
        body_markdown: AUTOMATED_BODY,
        report_data: {},
        generated_at: null,
        generation_version: 1,
        status: 'draft',
        recipient_count: 0,
        sent_count: 0,
        failed_count: 0,
        sent_at: null,
    };
}

const formatDate = (value) => value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

const formatDateTime = (value) => value
    ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

const formatMetric = (metric) => {
    const value = Number(metric?.value ?? 0);
    const number = value.toLocaleString('en-GB', { maximumFractionDigits: 1 });
    if (metric?.format === 'points') return `${number} POWR`;
    if (metric?.format === 'percent') return `${number}%`;
    if (metric?.format === 'hours') return `${number}h`;
    if (metric?.format === 'minutes') return `${number}m`;
    if (metric?.format === 'km') return `${number}km`;
    return number;
};

function Delta({ value }) {
    if (value == null) return <span className="text-[#AAAAAA]">Snapshot</span>;
    const positive = value > 0;
    const negative = value < 0;
    return <span className={positive ? 'text-emerald-600' : negative ? 'text-rose-600' : 'text-[#999999]'}>{positive ? '+' : ''}{value}% WoW</span>;
}

function MetricGrid({ metrics, headline = false }) {
    return (
        <div className={`grid gap-px bg-[#E6E6E1] border border-[#E6E6E1] ${headline ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-2 lg:grid-cols-3'}`}>
            {(metrics ?? []).map((metric) => (
                <div key={metric.key} className="bg-white px-4 py-4 min-w-0">
                    <div className="text-[9px] uppercase tracking-[0.2em] text-[#999999] font-black truncate">{metric.label}</div>
                    <div className={`${headline ? 'text-2xl' : 'text-xl'} font-light tracking-tight text-[#1A1A1A] mt-2 truncate`}>{formatMetric(metric)}</div>
                    <div className="text-[10px] font-bold mt-1"><Delta value={metric.delta_pct} /></div>
                </div>
            ))}
        </div>
    );
}

function RankedBars({ title, items, accent }) {
    if (!items?.length) return null;
    const max = Math.max(1, ...items.map((item) => Number(item.value)));
    return (
        <div>
            <div className="text-[9px] uppercase tracking-[0.24em] text-[#999999] font-black mb-3">{title}</div>
            <div className="space-y-3">
                {items.map((item) => (
                    <div key={item.label} className="grid grid-cols-[minmax(90px,0.8fr)_minmax(120px,1.4fr)_48px] gap-3 items-center">
                        <span className="text-xs text-[#666666] truncate capitalize">{String(item.label).replaceAll('_', ' ')}</span>
                        <div className="h-2 bg-[#EFEFEC] overflow-hidden"><div className="h-full" style={{ width: `${Math.max(3, (Number(item.value) / max) * 100)}%`, backgroundColor: accent }} /></div>
                        <span className="text-xs text-[#333333] font-bold text-right">{Number(item.value).toLocaleString()}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ReportView({ report }) {
    if (!report?.sections?.length) return (
        <div className="py-20 px-6 text-center border border-dashed border-[#DADAD5] bg-[#FAFAF8]">
            <Database size={28} className="mx-auto text-[#BBBBBB] mb-4" />
            <h3 className="text-lg font-light text-[#333333]">No data snapshot yet</h3>
            <p className="text-sm text-[#888888] mt-2">Generate the report to aggregate this window from the live platform.</p>
        </div>
    );
    const trendMax = Math.max(1, ...report.trend.flatMap((day) => [day.workouts, day.app_sessions]));
    return (
        <div className="space-y-8">
            <MetricGrid metrics={report.headline} headline />
            <section className="border border-[#E6E6E1] p-5">
                <div className="flex items-center justify-between gap-4 mb-5">
                    <div><h3 className="text-base font-semibold">Daily momentum</h3><p className="text-xs text-[#888888] mt-1">App sessions and trusted workouts</p></div>
                    <BarChart3 size={17} className="text-[#999999]" />
                </div>
                <div className="h-36 flex items-end gap-2 border-b border-[#E6E6E1]">
                    {report.trend.map((day) => (
                        <div key={day.date} className="flex-1 h-full flex flex-col justify-end items-center min-w-0">
                            <div className="h-[110px] flex items-end gap-1">
                                <div title={`${day.app_sessions} app sessions`} className="w-2.5 bg-[#8B5CF6]" style={{ height: `${Math.max(4, (day.app_sessions / trendMax) * 100)}%` }} />
                                <div title={`${day.workouts} trusted workouts`} className="w-2.5 bg-[#10B981]" style={{ height: `${Math.max(4, (day.workouts / trendMax) * 100)}%` }} />
                            </div>
                            <span className="text-[9px] uppercase text-[#999999] py-2">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                        </div>
                    ))}
                </div>
                <div className="flex justify-center gap-5 mt-3 text-[10px] text-[#777777]"><span><b className="text-[#8B5CF6]">■</b> App sessions</span><span><b className="text-[#10B981]">■</b> Trusted workouts</span></div>
            </section>
            {report.sections.map((section) => (
                <section key={section.key} className="border-t-4 border border-[#E6E6E1]" style={{ borderTopColor: section.accent }}>
                    <div className="px-5 py-4 border-b border-[#E6E6E1] flex items-center gap-3"><Activity size={16} style={{ color: section.accent }} /><h3 className="font-semibold">{section.title}</h3></div>
                    <div className="p-5 space-y-6">
                        <MetricGrid metrics={section.metrics} />
                        <div className={`grid gap-7 ${section.secondary_bars?.length ? 'lg:grid-cols-2' : ''}`}>
                            <RankedBars title={section.bar_label} items={section.bars} accent={section.accent} />
                            <RankedBars title={section.secondary_bar_label} items={section.secondary_bars} accent={section.accent} />
                        </div>
                    </div>
                </section>
            ))}
        </div>
    );
}

async function callTeamLetter(action, letterId) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Your admin session has expired');
    const response = await fetch(
        `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-team-letters`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
                apikey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action, letter_id: letterId }),
        },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Team letter request failed');
    return payload;
}

function StatusBadge({ status }) {
    const meta = STATUS[status] ?? STATUS.draft;
    return <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] ${meta.className}`}>{meta.label}</span>;
}

export default function TeamLetters() {
    const toast = useToast();
    const { user } = useAuth();
    const [mode, setMode] = useState('letters');
    const [letters, setLetters] = useState([]);
    const [recipients, setRecipients] = useState([]);
    const [draft, setDraft] = useState(null);
    const [deliveries, setDeliveries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [working, setWorking] = useState(null);
    const [recipientForm, setRecipientForm] = useState({ name: '', email: '' });
    const [addingRecipient, setAddingRecipient] = useState(false);

    const activeRecipients = useMemo(() => recipients.filter((recipient) => recipient.active), [recipients]);
    const readOnly = draft?.status === 'sent' || draft?.status === 'sending';

    const loadData = async (preferredId = null) => {
        setLoading(true);
        const [letterResult, recipientResult] = await Promise.all([
            supabase.from('team_letters').select('*').order('reporting_end', { ascending: false }).order('created_at', { ascending: false }),
            supabase.from('team_letter_recipients').select('*').order('active', { ascending: false }).order('created_at', { ascending: true }),
        ]);
        setLoading(false);
        if (letterResult.error) { toast.error(letterResult.error.message); return; }
        if (recipientResult.error) { toast.error(recipientResult.error.message); return; }

        const nextLetters = letterResult.data ?? [];
        setLetters(nextLetters);
        setRecipients(recipientResult.data ?? []);
        const wantedId = preferredId ?? draft?.id;
        const selected = nextLetters.find((letter) => letter.id === wantedId) ?? nextLetters[0] ?? null;
        if (selected) setDraft(selected);
        else if (!draft) setDraft(blankLetter());
        setDirty(false);
    };

    useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!draft?.id || draft.status !== 'sent') { setDeliveries([]); return; }
        supabase.from('team_letter_deliveries')
            .select('*')
            .eq('letter_id', draft.id)
            .order('recipient_email')
            .then(({ data }) => setDeliveries(data ?? []));
    }, [draft?.id, draft?.status]);

    const updateDraft = (patch) => {
        setDraft((current) => ({ ...current, ...patch }));
        setDirty(true);
    };

    const chooseLetter = (letter) => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        setDraft(letter);
        setDirty(false);
        setMode('letters');
    };

    const startNew = () => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        setDraft(blankLetter());
        setDirty(true);
        setMode('letters');
    };

    const replaceLetter = (letter) => {
        setDraft(letter);
        setDirty(false);
        setLetters((current) => [letter, ...current.filter((item) => item.id !== letter.id)]
            .sort((a, b) => b.reporting_end.localeCompare(a.reporting_end)));
    };

    const saveDraft = async (silent = false) => {
        if (!draft) return null;
        if (draft.reporting_end < draft.reporting_start) {
            toast.error('The reporting end must be on or after the start');
            return null;
        }
        if (readOnly) return draft;

        setSaving(true);
        const payload = {
            title: draft.title || 'POWR Platform Pulse',
            subject: draft.subject || `[POWR Weekly] Platform report | week ending ${draft.reporting_end}`,
            preview_text: draft.preview_text || '',
            reporting_start: draft.reporting_start,
            reporting_end: draft.reporting_end,
            body_markdown: AUTOMATED_BODY,
            updated_by: user?.id ?? null,
            status: 'draft',
        };
        const result = draft.id
            ? await supabase.from('team_letters').update(payload).eq('id', draft.id).select('*').single()
            : await supabase.from('team_letters').insert({ ...payload, created_by: user?.id ?? null }).select('*').single();
        setSaving(false);
        if (result.error) { toast.error(result.error.message); return null; }
        replaceLetter(result.data);
        if (!silent) toast.success('Report window saved');
        return result.data;
    };

    const generateReport = async () => {
        const saved = dirty || !draft?.id ? await saveDraft(true) : draft;
        if (!saved) return;
        setWorking('generate');
        try {
            const result = await callTeamLetter('generate', saved.id);
            replaceLetter(result.letter);
            toast.success('Report refreshed from live platform data');
        } catch (error) {
            toast.error(error.message);
        } finally {
            setWorking(null);
        }
    };

    const previewEmail = async () => {
        const previewWindow = window.open('', '_blank');
        if (previewWindow) previewWindow.document.write('<p style="font-family:Arial;padding:24px">Rendering preview...</p>');
        const saved = dirty || !draft?.id ? await saveDraft(true) : draft;
        if (!saved) { previewWindow?.close(); return; }
        setWorking('preview');
        try {
            const result = await callTeamLetter('render', saved.id);
            if (result.letter) replaceLetter(result.letter);
            if (!previewWindow) throw new Error('Allow pop-ups to open the email preview');
            previewWindow.document.open();
            previewWindow.document.write(result.html);
            previewWindow.document.close();
        } catch (error) {
            previewWindow?.close();
            toast.error(error.message);
        } finally {
            setWorking(null);
        }
    };

    const sendTest = async () => {
        const saved = dirty || !draft?.id ? await saveDraft(true) : draft;
        if (!saved) return;
        setWorking('test');
        try {
            const result = await callTeamLetter('test', saved.id);
            toast.success(`Test sent to ${result.sent_to}`);
            await loadData(saved.id);
        } catch (error) {
            toast.error(error.message);
        } finally {
            setWorking(null);
        }
    };

    const sendLetter = async () => {
        const saved = dirty || !draft?.id ? await saveDraft(true) : draft;
        if (!saved) return;
        if (!activeRecipients.length) { toast.error('Add at least one active recipient'); return; }
        if (!window.confirm(`Refresh this report from live data and send it to ${activeRecipients.length} active recipient${activeRecipients.length === 1 ? '' : 's'}? A sent report cannot be changed or sent again.`)) return;
        setWorking('send');
        try {
            const result = await callTeamLetter('send', saved.id);
            toast.success(`Sent to ${result.sent} of ${result.recipients} recipients`);
            await loadData(saved.id);
        } catch (error) {
            toast.error(error.message);
            await loadData(saved.id);
        } finally {
            setWorking(null);
        }
    };

    const deleteDraft = async () => {
        if (!draft?.id || readOnly) return;
        if (!window.confirm('Delete this draft from the archive?')) return;
        const { error } = await supabase.from('team_letters').delete().eq('id', draft.id);
        if (error) { toast.error(error.message); return; }
        setDraft(null);
        toast.success('Draft deleted');
        await loadData();
    };

    const addRecipient = async (event) => {
        event.preventDefault();
        const email = recipientForm.email.trim().toLowerCase();
        if (!email) return;
        setAddingRecipient(true);
        const { error } = await supabase.from('team_letter_recipients').insert({
            email,
            name: recipientForm.name.trim() || null,
            created_by: user?.id ?? null,
        });
        setAddingRecipient(false);
        if (error) { toast.error(error.code === '23505' ? 'That email is already on the list' : error.message); return; }
        setRecipientForm({ name: '', email: '' });
        toast.success('Recipient added');
        await loadData(draft?.id);
    };

    const toggleRecipient = async (recipient) => {
        const { error } = await supabase.from('team_letter_recipients')
            .update({ active: !recipient.active })
            .eq('id', recipient.id);
        if (error) { toast.error(error.message); return; }
        await loadData(draft?.id);
    };

    const removeRecipient = async (recipient) => {
        if (!window.confirm(`Remove ${recipient.email} from the team list? Past delivery records remain in the archive.`)) return;
        const { error } = await supabase.from('team_letter_recipients').delete().eq('id', recipient.id);
        if (error) { toast.error(error.message); return; }
        await loadData(draft?.id);
    };

    return (
        <div className="max-w-[1500px] mx-auto">
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
                <div>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-px w-10 bg-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.45em] text-[#8a7600] font-black">Internal communications</span>
                    </div>
                    <h1 className="text-4xl font-light text-[#1A1A1A]">Weekly Reports</h1>
                    <p className="mt-2 text-sm text-[#777777]">Generate, email and preserve POWR's weekly platform pulse.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-[#E6E6E1] bg-white p-1">
                        <button onClick={() => setMode('letters')} className={`h-9 px-4 rounded-md text-xs font-semibold ${mode === 'letters' ? 'bg-[#1A1A1A] text-white' : 'text-[#777777]'}`}>
                            Archive
                        </button>
                        <button onClick={() => setMode('recipients')} className={`h-9 px-4 rounded-md text-xs font-semibold ${mode === 'recipients' ? 'bg-[#1A1A1A] text-white' : 'text-[#777777]'}`}>
                            Recipients ({activeRecipients.length})
                        </button>
                    </div>
                    <button onClick={startNew} className="h-11 px-4 rounded-lg bg-[#E8D200] text-[#080808] text-xs font-bold flex items-center gap-2">
                        <FilePlus2 size={15} /> New report
                    </button>
                </div>
            </header>

            {mode === 'recipients' ? (
                <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
                    <form onSubmit={addRecipient} className="bg-white border border-[#E6E6E1] rounded-lg p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <UserPlus size={18} className="text-[#8a7600]" />
                            <h2 className="text-lg font-semibold">Add recipient</h2>
                        </div>
                        <div>
                            <label className="block text-[10px] uppercase tracking-[0.25em] text-[#888888] font-bold mb-1.5">Name</label>
                            <input className={fieldClass} value={recipientForm.name} onChange={(event) => setRecipientForm((form) => ({ ...form, name: event.target.value }))} placeholder="Jamie" />
                        </div>
                        <div>
                            <label className="block text-[10px] uppercase tracking-[0.25em] text-[#888888] font-bold mb-1.5">Email</label>
                            <input type="email" required className={fieldClass} value={recipientForm.email} onChange={(event) => setRecipientForm((form) => ({ ...form, email: event.target.value }))} placeholder="name@powr.life" />
                        </div>
                        <button disabled={addingRecipient} className="w-full h-10 rounded-lg bg-[#1A1A1A] text-white text-xs font-bold disabled:opacity-40">
                            {addingRecipient ? 'Adding...' : 'Add to team list'}
                        </button>
                        <p className="text-xs leading-relaxed text-[#999999]">This list is internal and independent of member accounts, push audiences and notification preferences.</p>
                    </form>

                    <section className="bg-white border border-[#E6E6E1] rounded-lg overflow-hidden">
                        <div className="px-6 py-5 border-b border-[#E6E6E1] flex items-center justify-between">
                            <div className="flex items-center gap-3"><Users size={18} /><h2 className="font-semibold">Team list</h2></div>
                            <span className="text-xs text-[#888888]">{activeRecipients.length} active · {recipients.length} total</span>
                        </div>
                        {recipients.length === 0 ? (
                            <div className="py-16 text-center text-sm text-[#999999]">No recipients yet.</div>
                        ) : recipients.map((recipient) => (
                            <div key={recipient.id} className="px-6 py-4 border-b border-[#EFEFEC] last:border-0 flex items-center gap-4">
                                <button type="button" onClick={() => toggleRecipient(recipient)} className={`relative w-10 h-6 rounded-full transition-colors ${recipient.active ? 'bg-[#E8D200]' : 'bg-[#DADAD5]'}`} title={recipient.active ? 'Pause recipient' : 'Activate recipient'}>
                                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${recipient.active ? 'left-5' : 'left-1'}`} />
                                </button>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-[#222222] truncate">{recipient.name || recipient.email}</div>
                                    {recipient.name && <div className="text-xs text-[#888888] truncate">{recipient.email}</div>}
                                </div>
                                <span className={`text-[9px] uppercase tracking-[0.2em] font-black ${recipient.active ? 'text-[#166534]' : 'text-[#999999]'}`}>{recipient.active ? 'Active' : 'Paused'}</span>
                                <button type="button" onClick={() => removeRecipient(recipient)} className="w-9 h-9 rounded-lg text-[#BBBBBB] hover:text-red-600 hover:bg-red-50 flex items-center justify-center" title="Remove recipient">
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        ))}
                    </section>
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
                    <aside className="bg-white border border-[#E6E6E1] rounded-lg overflow-hidden xl:sticky xl:top-20">
                        <div className="px-5 py-4 border-b border-[#E6E6E1] flex items-center justify-between">
                            <div className="flex items-center gap-2"><Archive size={16} /><span className="text-sm font-semibold">Reports</span></div>
                            <span className="text-xs text-[#999999]">{letters.length}</span>
                        </div>
                        <div className="max-h-[70vh] overflow-y-auto">
                            {loading ? <div className="p-8 text-center text-sm text-[#999999]">Loading...</div> : letters.length === 0 ? (
                                <div className="p-8 text-center text-sm text-[#999999]">No saved reports yet.</div>
                            ) : letters.map((letter) => (
                                <button key={letter.id} onClick={() => chooseLetter(letter)} className={`w-full px-5 py-4 text-left border-b border-[#EFEFEC] transition-colors ${draft?.id === letter.id ? 'bg-[#FFFCE8]' : 'hover:bg-[#FAFAF8]'}`}>
                                    <div className="flex items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-[#222222] truncate">{letter.title}</div>
                                            <div className="text-xs text-[#888888] mt-1">{formatDate(letter.reporting_start)} - {formatDate(letter.reporting_end)}</div>
                                        </div>
                                        <StatusBadge status={letter.status} />
                                    </div>
                                    {letter.status === 'sent' && <div className="mt-2 text-[11px] text-[#999999]">{letter.sent_count}/{letter.recipient_count} delivered</div>}
                                </button>
                            ))}
                        </div>
                    </aside>

                    {draft && (
                        <main className="bg-white border border-[#E6E6E1] rounded-lg overflow-hidden">
                            <div className="px-6 py-4 border-b border-[#E6E6E1] flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <StatusBadge status={draft.status} />
                                    {dirty && <span className="text-xs text-[#B45309]">Unsaved changes</span>}
                                    {draft.sent_at && <span className="text-xs text-[#888888]">Sent {formatDateTime(draft.sent_at)}</span>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {!readOnly && draft.id && <button onClick={deleteDraft} className="w-9 h-9 rounded-lg border border-[#E6E6E1] text-[#999999] hover:text-red-600 flex items-center justify-center" title="Delete draft"><Trash2 size={14} /></button>}
                                    <button onClick={previewEmail} disabled={working !== null} className="h-9 px-3 rounded-lg border border-[#E6E6E1] text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><Eye size={14} /> Preview</button>
                                    {!readOnly && <button onClick={generateReport} disabled={saving || working !== null} className="h-9 px-3 rounded-lg border border-[#1A1A1A] text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><RefreshCw size={14} className={working === 'generate' ? 'animate-spin' : ''} /> {working === 'generate' ? 'Generating...' : draft.generated_at ? 'Refresh data' : 'Generate report'}</button>}
                                    {!readOnly && <button onClick={sendTest} disabled={working !== null} className="h-9 px-3 rounded-lg border border-[#1A1A1A] text-xs font-semibold flex items-center gap-2 disabled:opacity-40"><Mail size={14} /> {working === 'test' ? 'Sending...' : 'Send test'}</button>}
                                    {!readOnly && <button onClick={sendLetter} disabled={working !== null || activeRecipients.length === 0} className="h-9 px-4 rounded-lg bg-[#E8D200] text-[#080808] text-xs font-bold flex items-center gap-2 disabled:opacity-40"><Send size={14} /> {working === 'send' ? 'Sending...' : `Send to ${activeRecipients.length}`}</button>}
                                </div>
                            </div>

                            <div className="p-6 space-y-6">
                                {draft.status === 'sent' && (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="rounded-lg bg-[#F4F4F1] p-4"><div className="text-2xl font-light">{draft.recipient_count}</div><div className="text-[10px] uppercase tracking-[0.2em] text-[#888888] font-bold mt-1">Recipients</div></div>
                                        <div className="rounded-lg bg-green-50 p-4"><div className="text-2xl font-light text-green-700">{draft.sent_count}</div><div className="text-[10px] uppercase tracking-[0.2em] text-green-700 font-bold mt-1">Sent</div></div>
                                        <div className="rounded-lg bg-red-50 p-4"><div className="text-2xl font-light text-red-700">{draft.failed_count}</div><div className="text-[10px] uppercase tracking-[0.2em] text-red-700 font-bold mt-1">Failed</div></div>
                                    </div>
                                )}

                                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 border-b border-[#E6E6E1] pb-6">
                                    <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.25em] text-[#888888] font-bold mb-1.5">Reporting start</label>
                                        <input type="date" disabled={readOnly} className={fieldClass} value={draft.reporting_start} onChange={(event) => updateDraft({ reporting_start: event.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.25em] text-[#888888] font-bold mb-1.5">Reporting end</label>
                                        <input type="date" disabled={readOnly} className={fieldClass} value={draft.reporting_end} onChange={(event) => updateDraft({ reporting_end: event.target.value })} />
                                    </div>
                                    </div>
                                    <div className="lg:text-right">
                                        <div className="text-[10px] uppercase tracking-[0.22em] text-[#999999] font-black">Data snapshot</div>
                                        <div className="text-sm text-[#555555] mt-1">{draft.generated_at ? formatDateTime(draft.generated_at) : 'Not generated'}</div>
                                        {draft.generated_at && <div className="text-xs text-[#999999] mt-1">Version {draft.generation_version}</div>}
                                    </div>
                                </div>

                                <ReportView report={draft.report_data} />

                                {draft.status === 'sent' && deliveries.length > 0 && (
                                    <section className="border-t border-[#E6E6E1] pt-5">
                                        <h3 className="text-sm font-semibold mb-3">Delivery record</h3>
                                        <div className="divide-y divide-[#EFEFEC] border border-[#E6E6E1] rounded-lg">
                                            {deliveries.map((delivery) => (
                                                <div key={delivery.id} className="px-4 py-3 flex items-start gap-3">
                                                    {delivery.status === 'sent' ? <CheckCircle2 size={16} className="text-green-600 mt-0.5" /> : <AlertCircle size={16} className="text-red-600 mt-0.5" />}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm text-[#333333] truncate">{delivery.recipient_name || delivery.recipient_email}</div>
                                                        {delivery.recipient_name && <div className="text-xs text-[#999999] truncate">{delivery.recipient_email}</div>}
                                                        {delivery.error && <div className="text-xs text-red-700 mt-1">{delivery.error}</div>}
                                                    </div>
                                                    <span className="text-[10px] uppercase tracking-[0.2em] text-[#888888] font-bold">{delivery.status}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>
                        </main>
                    )}
                </div>
            )}
        </div>
    );
}