import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { User, Star, Copy, Check, X, Award, Clock, CheckCircle } from 'lucide-react';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS = {
    pending:  { label: 'Pending',  color: '#f97316', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.25)' },
    invited:  { label: 'Invited',  color: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)' },
    approved: { label: 'Approved', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.25)' },
    rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)'  },
};

function StatusBadge({ status }) {
    const s = STATUS[status] ?? STATUS.pending;
    return (
        <span
            className="inline-flex items-center px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em]"
            style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
        >
            {s.label}
        </span>
    );
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AthleteApplications() {
    const toast = useToast();
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('pending');
    const [selected, setSelected] = useState(null);
    const [reviewNotes, setReviewNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [copiedId, setCopiedId] = useState(null);

    const fetchApplications = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('athlete_applications')
            .select('*')
            .order('submitted_at', { ascending: false });
        if (filter !== 'all') query = query.eq('status', filter);
        const { data, error } = await query;
        if (!error && data) setApplications(data);
        setLoading(false);
    }, [filter]);

    useEffect(() => { fetchApplications(); }, [fetchApplications]);

    // Stats derived from all applications regardless of filter
    const [allStats, setAllStats] = useState({ total: 0, pending: 0, approved: 0, invited: 0 });
    useEffect(() => {
        supabase
            .from('athlete_applications')
            .select('status')
            .then(({ data }) => {
                if (!data) return;
                setAllStats({
                    total:    data.length,
                    pending:  data.filter(a => a.status === 'pending').length,
                    approved: data.filter(a => a.status === 'approved').length,
                    invited:  data.filter(a => a.status === 'invited').length,
                });
            });
    }, [applications]);

    function openDetail(app) {
        setSelected(app);
        setReviewNotes(app.reviewer_notes ?? '');
    }

    async function handleDecision(decision) {
        if (!selected) return;
        setSaving(true);
        const { data: { user } } = await supabase.auth.getUser();

        const updates = {
            status: decision,
            reviewer_notes: reviewNotes.trim() || null,
            reviewed_by: user?.id,
            reviewed_at: new Date().toISOString(),
        };

        if (decision === 'approved' && selected.profile_id) {
            await supabase.from('profiles').update({
                display_name: selected.display_name,
                bio: selected.bio,
                avatar_url: selected.avatar_url,
                cover_url: selected.cover_url,
                activity_preferences: selected.activity_preferences,
                is_pro: true,
            }).eq('id', selected.profile_id);

            await supabase.from('pro_achievements').delete().eq('user_id', selected.profile_id);
            if (selected.achievements?.length > 0) {
                await supabase.from('pro_achievements').insert(
                    selected.achievements.map((a, i) => ({
                        user_id: selected.profile_id,
                        title: a.title, value: a.value, context: a.context ?? null, display_order: i,
                    }))
                );
            }

            await supabase.from('pro_gallery_photos').delete().eq('user_id', selected.profile_id);
            if (selected.gallery_urls?.length > 0) {
                await supabase.from('pro_gallery_photos').insert(
                    selected.gallery_urls.map((url, i) => ({ user_id: selected.profile_id, url, display_order: i }))
                );
            }
        }

        const { error } = await supabase.from('athlete_applications').update(updates).eq('id', selected.id);
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        toast.success(decision === 'approved' ? 'Athlete approved — profile updated' : 'Application rejected');
        setSelected(null);
        fetchApplications();
    }

    function copyInviteLink(app, e) {
        e.stopPropagation();
        navigator.clipboard.writeText(`${window.location.origin}/athlete/${app.invite_token}`);
        setCopiedId(app.id);
        setTimeout(() => setCopiedId(null), 2000);
    }

    async function regenerateInvite(app, e) {
        e.stopPropagation();
        const token = crypto.randomUUID();
        const { error } = await supabase
            .from('athlete_applications')
            .update({ invite_token: token, status: 'invited' })
            .eq('id', app.id);
        if (error) { toast.error(error.message); return; }
        toast.success('New invite link generated');
        fetchApplications();
    }

    const FILTERS = ['pending', 'invited', 'approved', 'rejected', 'all'];

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">

            {/* ── Page header ───────────────────────────────────────── */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#E8D200] font-black">
                            Subsystem / Pro Network
                        </span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">
                        Athlete Applications
                    </h1>
                    <p className="text-[#999] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Review and approve pro athlete profiles before they go live on the platform.
                    </p>
                </div>
            </div>

            {/* ── Stat cards ────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-20">
                {[
                    { label: 'Total Applications', value: allStats.total,    icon: Star,        color: '#E8D200', desc: 'ROSTER'   },
                    { label: 'Awaiting Review',    value: allStats.pending,  icon: Clock,       color: '#f97316', desc: 'QUEUE'    },
                    { label: 'Invites Sent',       value: allStats.invited,  icon: Award,       color: '#6366f1', desc: 'PIPELINE' },
                    { label: 'Approved Athletes',  value: allStats.approved, icon: CheckCircle, color: '#4ade80', desc: 'ACTIVE'   },
                ].map(s => (
                    <div
                        key={s.label}
                        className="bg-[#0A0A0A] border border-[#151515] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#202020] transition-all relative overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <span className="text-[9px] font-black text-[#999] uppercase tracking-[0.4em]">{s.desc}</span>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all">
                            <s.icon size={22} style={{ color: s.color }} />
                        </div>
                        <div>
                            <div className="text-4xl font-light tracking-tighter text-[#DDD] leading-none mb-2">
                                {loading ? '—' : s.value}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Filter bar ────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div className="flex gap-3 flex-wrap">
                    {FILTERS.map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`h-16 px-10 rounded-full text-[10px] font-black uppercase tracking-[0.3em] transition-all ${
                                filter === f
                                    ? 'bg-[#E8D200] text-[#080808] shadow-lg shadow-[#E8D200]/10'
                                    : 'bg-[#0A0A0A] border border-[#151515] text-[#444] hover:text-[#999] hover:border-[#222]'
                            }`}
                        >
                            {f}
                            {f === 'pending' && allStats.pending > 0 && (
                                <span className={`ml-3 inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-black ${
                                    filter === 'pending' ? 'bg-[#080808] text-[#E8D200]' : 'bg-[#f97316] text-white'
                                }`}>{allStats.pending}</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">
                    POWR / ATH / V1.0
                </div>
            </div>

            {/* ── Table ─────────────────────────────────────────────── */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#999] font-black">Loading Applications…</span>
                    </div>
                ) : applications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-20 h-20 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center">
                            <Star size={32} className="text-[#1E1E1E]" />
                        </div>
                        <p className="text-[11px] uppercase tracking-[0.4em] text-[#333] font-black">
                            No {filter === 'all' ? '' : filter} applications
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#050505] border-b border-[#151515]">
                                    {['Athlete', 'Sports', 'Submitted', 'Status', ''].map(h => (
                                        <th
                                            key={h}
                                            className={`px-12 py-8 text-[10px] font-black uppercase tracking-[0.5em] text-[#444] ${h === '' ? 'text-right' : ''}`}
                                        >{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#0d0d0d]">
                                {applications.map(app => (
                                    <tr
                                        key={app.id}
                                        onClick={() => openDetail(app)}
                                        className="group hover:bg-[#080808] transition-all cursor-pointer"
                                    >
                                        {/* Athlete identity */}
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-6">
                                                <div className="w-12 h-12 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0">
                                                    {app.avatar_url
                                                        ? <img src={app.avatar_url} alt="" className="w-full h-full object-cover" />
                                                        : <User size={18} className="text-[#333]" />
                                                    }
                                                </div>
                                                <div>
                                                    <div className="text-base font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors mb-1">
                                                        {app.display_name || '—'}
                                                    </div>
                                                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#444] font-black font-mono">
                                                        {app.email}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Sports */}
                                        <td className="px-12 py-10">
                                            <div className="flex flex-wrap gap-2">
                                                {(app.activity_preferences ?? []).slice(0, 3).map(p => (
                                                    <span
                                                        key={p}
                                                        className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] bg-[#111] border border-[#1A1A1A] text-[#444]"
                                                    >{p}</span>
                                                ))}
                                                {(app.activity_preferences ?? []).length > 3 && (
                                                    <span className="text-[10px] text-[#333] font-black">
                                                        +{app.activity_preferences.length - 3}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Date */}
                                        <td className="px-12 py-10 whitespace-nowrap">
                                            <div className="text-[12px] text-[#666] font-medium mb-1">
                                                {formatDate(app.submitted_at)}
                                            </div>
                                        </td>

                                        {/* Status */}
                                        <td className="px-12 py-10">
                                            <StatusBadge status={app.status} />
                                        </td>

                                        {/* Actions */}
                                        <td className="px-12 py-10 text-right" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-3">
                                                {app.status === 'invited' && app.invite_token && (
                                                    <button
                                                        onClick={e => copyInviteLink(app, e)}
                                                        className="inline-flex items-center gap-3 px-6 py-3 bg-[#050505] border border-[#151515] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#555] hover:text-[#E8D200] hover:border-[#E8D200]/30 transition-all"
                                                    >
                                                        {copiedId === app.id
                                                            ? <><Check size={12} /> Copied</>
                                                            : <><Copy size={12} /> Copy Link</>
                                                        }
                                                    </button>
                                                )}
                                                {app.status === 'rejected' && (
                                                    <button
                                                        onClick={e => regenerateInvite(app, e)}
                                                        className="inline-flex items-center gap-3 px-6 py-3 bg-[#050505] border border-[#151515] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#555] hover:text-[#6366f1] hover:border-[#6366f1]/30 transition-all"
                                                    >
                                                        Re-invite
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => openDetail(app)}
                                                    className="inline-flex items-center gap-3 px-6 py-3 bg-[#050505] border border-[#151515] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#999] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all group/btn"
                                                >
                                                    Review
                                                    <span className="text-[#555] group-hover/btn:text-[#E8D200] transition-colors">›</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="mt-12 flex items-center justify-between px-12">
                <div className="flex items-center gap-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#10B981] animate-pulse" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#999] font-black">Pro Network Sync Active</span>
                </div>
            </div>

            {/* ── Detail modal ──────────────────────────────────────── */}
            {selected && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-8"
                    onClick={() => setSelected(null)}
                >
                    <div
                        className="bg-[#0A0A0A] border border-[#1E1E1E] rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="flex items-center justify-between p-10 border-b border-[#151515] sticky top-0 bg-[#0A0A0A] z-10">
                            <div className="flex items-center gap-6">
                                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-[#050505] border border-[#151515] shrink-0">
                                    {selected.avatar_url
                                        ? <img src={selected.avatar_url} alt="" className="w-full h-full object-cover" />
                                        : <div className="w-full h-full flex items-center justify-center">
                                            <User size={20} className="text-[#333]" />
                                          </div>
                                    }
                                </div>
                                <div>
                                    <div className="text-xl font-light tracking-tight text-[#F2F2F2] mb-1">
                                        {selected.display_name || '—'}
                                    </div>
                                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#444] font-black font-mono">
                                        {selected.email}
                                    </div>
                                </div>
                                <StatusBadge status={selected.status} />
                            </div>
                            <button
                                onClick={() => setSelected(null)}
                                className="w-10 h-10 rounded-full bg-[#151515] flex items-center justify-center text-[#555] hover:text-[#F2F2F2] transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-10 space-y-10">
                            {/* Cover */}
                            {selected.cover_url && (
                                <div className="h-40 rounded-2xl overflow-hidden border border-[#151515]">
                                    <img src={selected.cover_url} alt="" className="w-full h-full object-cover" />
                                </div>
                            )}

                            {/* Bio */}
                            {selected.bio && (
                                <ModalSection label="Bio">
                                    <p className="text-sm text-[#888] font-light leading-relaxed">{selected.bio}</p>
                                </ModalSection>
                            )}

                            {/* Sports */}
                            <ModalSection label="Sports">
                                <div className="flex flex-wrap gap-2">
                                    {(selected.activity_preferences ?? []).map(p => (
                                        <span
                                            key={p}
                                            className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] bg-[#111] border border-[#1A1A1A] text-[#555]"
                                        >{p}</span>
                                    ))}
                                </div>
                            </ModalSection>

                            {/* Social */}
                            {(selected.instagram_handle || selected.website_url) && (
                                <ModalSection label="Social">
                                    {selected.instagram_handle && (
                                        <p className="text-sm text-[#777] font-light">
                                            Instagram: <span className="text-[#999]">@{selected.instagram_handle}</span>
                                        </p>
                                    )}
                                    {selected.website_url && (
                                        <p className="text-sm text-[#777] font-light">{selected.website_url}</p>
                                    )}
                                </ModalSection>
                            )}

                            {/* Achievements */}
                            {selected.achievements?.length > 0 && (
                                <ModalSection label="Achievements">
                                    <div className="space-y-3">
                                        {selected.achievements.map((a, i) => (
                                            <div
                                                key={i}
                                                className="flex items-center gap-6 p-6 rounded-2xl bg-[#050505] border border-[#151515]"
                                            >
                                                <span className="text-3xl font-light text-[#E8D200] min-w-[72px] tracking-tighter">
                                                    {a.value}
                                                </span>
                                                <div>
                                                    <div className="text-sm font-medium text-[#DDD] mb-1">{a.title}</div>
                                                    {a.context && (
                                                        <div className="text-[11px] text-[#444] uppercase tracking-widest font-black">{a.context}</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ModalSection>
                            )}

                            {/* Gallery */}
                            {selected.gallery_urls?.length > 0 && (
                                <ModalSection label={`Gallery · ${selected.gallery_urls.length} photos`}>
                                    <div className="grid grid-cols-3 gap-3">
                                        {selected.gallery_urls.map((url, i) => (
                                            <div
                                                key={i}
                                                className="aspect-square rounded-2xl overflow-hidden border border-[#151515]"
                                            >
                                                <img src={url} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                </ModalSection>
                            )}

                            {/* Invite link */}
                            {selected.status === 'invited' && selected.invite_token && (
                                <ModalSection label="Invite Link">
                                    <div className="flex gap-3">
                                        <div className="flex-1 h-14 px-6 bg-[#050505] border border-[#151515] rounded-2xl flex items-center overflow-hidden">
                                            <span className="text-[11px] text-[#444] font-mono truncate">
                                                {window.location.origin}/athlete/{selected.invite_token}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(`${window.location.origin}/athlete/${selected.invite_token}`);
                                                toast.success('Link copied');
                                            }}
                                            className="h-14 px-8 rounded-2xl bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] hover:opacity-90 transition-opacity shrink-0"
                                        >Copy</button>
                                    </div>
                                </ModalSection>
                            )}

                            {/* Reviewer notes */}
                            <ModalSection label="Reviewer Notes">
                                <textarea
                                    value={reviewNotes}
                                    onChange={e => setReviewNotes(e.target.value)}
                                    placeholder="Optional internal notes…"
                                    rows={3}
                                    disabled={saving}
                                    className="w-full px-6 py-4 bg-[#050505] border border-[#151515] rounded-2xl text-sm text-[#999] font-light outline-none focus:border-[#E8D200]/30 transition-colors resize-none placeholder-[#2A2A2A] disabled:opacity-50"
                                />
                            </ModalSection>

                            {/* Decision buttons */}
                            {selected.status === 'pending' && (
                                <div className="flex gap-4 pt-2">
                                    <button
                                        onClick={() => handleDecision('rejected')}
                                        disabled={saving}
                                        className="flex-1 h-16 rounded-2xl border text-[10px] font-black uppercase tracking-[0.3em] transition-all disabled:opacity-50 hover:translate-y-[-2px]"
                                        style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', color: '#ef4444' }}
                                    >
                                        {saving ? '…' : 'Reject'}
                                    </button>
                                    <button
                                        onClick={() => handleDecision('approved')}
                                        disabled={saving}
                                        className="flex-1 h-16 rounded-2xl border text-[10px] font-black uppercase tracking-[0.3em] transition-all disabled:opacity-50 hover:translate-y-[-2px] shadow-lg"
                                        style={{ borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.07)', color: '#4ade80', boxShadow: saving ? 'none' : '0 20px 40px rgba(74,222,128,0.08)' }}
                                    >
                                        {saving ? 'Approving…' : 'Approve & Go Live'}
                                    </button>
                                </div>
                            )}

                            {/* Already reviewed banner */}
                            {selected.status !== 'pending' && selected.status !== 'invited' && (
                                <div
                                    className="flex items-center gap-4 p-6 rounded-2xl border"
                                    style={{
                                        borderColor: STATUS[selected.status]?.border ?? '#1E1E1E',
                                        background: STATUS[selected.status]?.bg ?? 'transparent',
                                    }}
                                >
                                    <div
                                        className="text-lg"
                                        style={{ color: STATUS[selected.status]?.color }}
                                    >
                                        {selected.status === 'approved' ? '✓' : '✕'}
                                    </div>
                                    <div>
                                        <div
                                            className="text-sm font-medium"
                                            style={{ color: STATUS[selected.status]?.color }}
                                        >
                                            {selected.status === 'approved' ? 'Approved' : 'Rejected'}
                                            {selected.reviewed_at ? ` · ${formatDate(selected.reviewed_at)}` : ''}
                                        </div>
                                        {selected.reviewer_notes && (
                                            <div className="text-xs text-[#555] mt-1 font-light">{selected.reviewer_notes}</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ModalSection({ label, children }) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4">
                <div className="h-[1px] w-6 bg-[#1E1E1E]" />
                <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#333]">{label}</span>
            </div>
            {children}
        </div>
    );
}
