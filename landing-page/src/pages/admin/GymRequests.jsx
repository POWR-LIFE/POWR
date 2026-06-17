import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Building2, MapPin, Clock, CheckCircle, Inbox, X, Plus, User } from 'lucide-react';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  pending:  { label: 'Pending',  color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)' },
  added:    { label: 'Added',    color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.25)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)'  },
};

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span className="inline-flex items-center px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em]"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>{s.label}</span>
  );
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function requesterName(profile) {
  if (!profile) return 'Unknown user';
  return profile.display_name || profile.username || 'Unknown user';
}

export default function GymRequests() {
  const toast = useToast();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [profiles, setProfiles] = useState({}); // user_id -> profile
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [allStats, setAllStats] = useState({ total: 0, pending: 0, added: 0, rejected: 0 });

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('gym_requests')
      .select('id, name, location_text, note, status, user_id, reviewed_at, created_at')
      .order('created_at', { ascending: false });
    if (filter !== 'all') query = query.eq('status', filter);
    const { data, error } = await query;
    if (error) { toast.error('Failed to load gym requests'); setLoading(false); return; }
    setRequests(data || []);
    setLoading(false);

    // Hydrate requester names in one follow-up query (user_id FK points at
    // auth.users, so PostgREST can't embed profiles automatically).
    const ids = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, username, display_name').in('id', ids);
      if (profs) setProfiles(prev => ({ ...prev, ...Object.fromEntries(profs.map(p => [p.id, p])) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `toast` is a fresh object each render (see useToast); including it causes an infinite fetch loop.
  }, [filter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // Stats across all statuses, refreshed whenever the visible list changes.
  useEffect(() => {
    supabase.from('gym_requests').select('status').then(({ data }) => {
      if (!data) return;
      setAllStats({
        total: data.length,
        pending: data.filter(r => r.status === 'pending').length,
        added: data.filter(r => r.status === 'added').length,
        rejected: data.filter(r => r.status === 'rejected').length,
      });
    });
  }, [requests]);

  // ── Reject ─────────────────────────────────────────────────────────────────
  async function handleReject() {
    if (!selected) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('gym_requests').update({
      status: 'rejected',
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', selected.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Request rejected');
    setSelected(null);
    fetchRequests();
  }

  // ── Add as partner ───────────────────────────────────────────────────────────
  // Hand off to the Partner manager with the gym name prefilled. The request is
  // marked 'added' there only once the partner is actually saved, so abandoning
  // the form leaves it pending.
  function handleAddAsPartner(req) {
    navigate('/admin/partners', { state: { createName: req.name, gymRequestId: req.id } });
  }

  const FILTERS = ['pending', 'added', 'rejected', 'all'];

  return (
    <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-16">
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-[1px] w-12 bg-[#E8D200]" />
            <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Subsystem / Fleet Intake</span>
          </div>
          <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Gym Requests</h1>
          <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
            Gyms members couldn't find during onboarding. Triage and add them to the fleet.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-16">
        {[
          { label: 'Total', value: allStats.total, icon: Inbox, color: '#8a7600' },
          { label: 'Awaiting Review', value: allStats.pending, icon: Clock, color: '#f97316' },
          { label: 'Added', value: allStats.added, icon: CheckCircle, color: '#4ade80' },
          { label: 'Rejected', value: allStats.rejected, icon: X, color: '#ef4444' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#E6E6E1] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#E6E6E1] transition-all">
            <div className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all">
              <s.icon size={22} style={{ color: s.color }} />
            </div>
            <div>
              <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none mb-2">{loading ? '—' : s.value}</div>
              <div className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap mb-10">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`h-16 px-10 rounded-full text-[10px] font-black uppercase tracking-[0.3em] transition-all ${filter === f ? 'bg-[#E8D200] text-[#080808] shadow-lg shadow-[#E8D200]/10' : 'bg-white border border-[#E6E6E1] text-[#AAAAAA] hover:text-[#666666] hover:border-[#E6E6E1]'}`}>
            {f}
            {f === 'pending' && allStats.pending > 0 && (
              <span className={`ml-3 inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-black ${filter === 'pending' ? 'bg-[#F4F4F1] text-[#8a7600]' : 'bg-[#f97316] text-white'}`}>{allStats.pending}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading…</span>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-20 h-20 rounded-3xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center"><Building2 size={32} className="text-[#CCCCCC]" /></div>
            <p className="text-[11px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">No {filter === 'all' ? '' : filter} gym requests</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                  {['Gym', 'Requested by', 'Location', 'Submitted', 'Status', ''].map(h => (
                    <th key={h} className={`px-6 py-5 text-[10px] font-black uppercase tracking-[0.5em] text-[#AAAAAA] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E6E1]">
                {requests.map(req => (
                  <tr key={req.id} onClick={() => setSelected(req)} className="group hover:bg-[#F4F4F1] transition-all cursor-pointer">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                          <Building2 size={18} className="text-[#BBBBBB]" />
                        </div>
                        <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors">{req.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[12px] text-[#888888] font-medium">{requesterName(profiles[req.user_id])}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[12px] text-[#999999] font-medium">{req.location_text || <span className="text-[#CCCCCC] italic font-light">Not provided</span>}</span>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="text-[12px] text-[#999999] font-medium">{formatDate(req.created_at)}</div>
                    </td>
                    <td className="px-6 py-5"><StatusBadge status={req.status} /></td>
                    <td className="px-6 py-5 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        {req.status === 'pending' && (
                          <button onClick={() => handleAddAsPartner(req)} className="inline-flex items-center gap-2 px-6 py-3 bg-[#E8D200] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#080808] hover:opacity-90 transition-all">
                            <Plus size={12} /> Add
                          </button>
                        )}
                        <button onClick={() => setSelected(req)} className="inline-flex items-center gap-3 px-6 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#666666] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all">
                          {req.status === 'pending' ? 'Review' : 'View'} <span className="text-[#999999]">›</span>
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

      {/* ── Review modal ── */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={() => setSelected(null)}>
          <div className="bg-white border border-[#E6E6E1] rounded-3xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-8 border-b border-[#E6E6E1]">
              <div className="flex items-center gap-5">
                <div className="text-lg font-light tracking-tight text-[#1A1A1A]">{selected.name}</div>
                <StatusBadge status={selected.status} />
              </div>
              <button onClick={() => setSelected(null)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-colors"><X size={16} /></button>
            </div>

            <div className="p-8 space-y-8">
              <Detail label="Gym name" icon={Building2}>{selected.name}</Detail>
              <Detail label="Requested by" icon={User}>{requesterName(profiles[selected.user_id])}</Detail>
              <Detail label="Location" icon={MapPin}>{selected.location_text || '—'}</Detail>
              {selected.note && <Detail label="Note">{selected.note}</Detail>}
              <Detail label="Submitted" icon={Clock}>{formatDate(selected.created_at)}</Detail>

              {selected.status === 'pending' ? (
                <div className="space-y-5 pt-2">
                  <div className="flex gap-4">
                    <button onClick={handleReject} disabled={saving} className="flex-1 h-16 rounded-2xl border text-[10px] font-black uppercase tracking-[0.3em] transition-all disabled:opacity-50 hover:translate-y-[-2px]"
                      style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', color: '#ef4444' }}>{saving ? '…' : 'Reject'}</button>
                    <button onClick={() => handleAddAsPartner(selected)} disabled={saving} className="flex-1 h-16 rounded-2xl border text-[10px] font-black uppercase tracking-[0.3em] transition-all disabled:opacity-50 hover:translate-y-[-2px] shadow-lg flex items-center justify-center gap-2"
                      style={{ borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.07)', color: '#22a35a' }}>
                      <Plus size={14} /> Add as Partner
                    </button>
                  </div>
                  <p className="text-[11px] text-[#AAAAAA] font-light leading-relaxed">
                    <span className="text-[#888888]">Add as Partner</span> opens the Partner manager with this name pre-filled so you can set the geofence. The request is marked added once the partner is saved.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-4 p-6 rounded-2xl border" style={{ borderColor: STATUS[selected.status].border, background: STATUS[selected.status].bg }}>
                  <div className="text-lg" style={{ color: STATUS[selected.status].color }}>{selected.status === 'added' ? '✓' : '✕'}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: STATUS[selected.status].color }}>
                      {STATUS[selected.status].label}{selected.reviewed_at ? ` · ${formatDate(selected.reviewed_at)}` : ''}
                    </div>
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

function Detail({ label, icon: Icon, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        {Icon ? <Icon size={12} className="text-[#CCCCCC]" /> : <div className="h-[1px] w-6 bg-[#E2E2DD]" />}
        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#BBBBBB]">{label}</span>
      </div>
      <p className="text-sm text-[#555555] font-light leading-relaxed break-words pl-8">{children}</p>
    </div>
  );
}
