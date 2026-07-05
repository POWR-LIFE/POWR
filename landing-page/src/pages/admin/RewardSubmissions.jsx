import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Link } from 'react-router-dom';
import { Inbox, Clock, Send, CheckCircle, Copy, Check, X, Plus, Award } from 'lucide-react';
import RewardAppPreview from '../../components/RewardAppPreview';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  invited:  { label: 'Invited',  color: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)' },
  pending:  { label: 'Pending',  color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)' },
  approved: { label: 'Approved', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.25)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)'  },
};

// legacy partner_category → app sector label
const SECTOR_LABEL = { food: 'Eat', nutrition: 'Eat', gym: 'Move', health: 'Mind', gear: 'Sleep', fashion: 'Sleep' };

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

export default function RewardSubmissions() {
  const toast = useToast();
  const [subs, setSubs] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [powrCost, setPowrCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [allStats, setAllStats] = useState({ total: 0, invited: 0, pending: 0, approved: 0 });

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invPartnerId, setInvPartnerId] = useState('');
  const [invBrand, setInvBrand] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invPrefix, setInvPrefix] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState(null);

  const fetchSubs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('reward_submissions')
      .select('*, partners(name, partner_code, logo_url)')
      .order('created_at', { ascending: false });
    if (filter !== 'all') query = query.eq('status', filter);
    const { data, error } = await query;
    if (!error && data) setSubs(data);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  useEffect(() => {
    supabase.from('partners').select('id, name, partner_code, roles').contains('roles', ['reward_provider']).order('name')
      .then(({ data }) => { if (data) setPartners(data); });
  }, []);

  useEffect(() => {
    supabase.from('reward_submissions').select('status').then(({ data }) => {
      if (!data) return;
      setAllStats({
        total: data.length,
        invited: data.filter(s => s.status === 'invited').length,
        pending: data.filter(s => s.status === 'pending').length,
        approved: data.filter(s => s.status === 'approved').length,
      });
    });
  }, [subs]);

  function openDetail(sub) {
    setSelected(sub);
    setReviewNotes(sub.reviewer_notes ?? '');
    setPowrCost('');
  }

  function copyLink(sub, e) {
    e?.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/partner-reward/${sub.invite_token}`);
    setCopiedId(sub.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // ── Create an invite ───────────────────────────────────────────────────────
  async function handleCreateInvite(e) {
    e.preventDefault();
    if (!invPartnerId && !invBrand.trim()) { toast.error('Pick a partner or enter a brand name'); return; }
    setCreating(true);
    const token = crypto.randomUUID();
    const linkedPartner = partners.find(p => p.id === invPartnerId);
    const row = {
      invite_token: token,
      status: 'invited',
      partner_id: invPartnerId || null,
      brand_name: invPartnerId ? (linkedPartner?.name ?? null) : (invBrand.trim() || null),
      contact_email: invEmail.trim() || null,
      code_prefix: linkedPartner?.partner_code
        ? linkedPartner.partner_code
        : invPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || null,
    };
    const { error } = await supabase.from('reward_submissions').insert(row);
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    setCreatedLink(`${window.location.origin}/partner-reward/${token}`);
    setInvPartnerId(''); setInvBrand(''); setInvEmail(''); setInvPrefix('');
    fetchSubs();
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  // New submission → create an (inactive) reward in the Vault.
  // Listing update (target_reward_id) → apply the changes to the live reward
  // in place; points price is optional and kept unchanged when blank.
  async function handleApprove() {
    if (!selected) return;
    const isEdit = !!selected.target_reward_id;
    const cost = parseInt(powrCost, 10);
    const hasCost = Number.isInteger(cost) && cost > 0;
    if (!isEdit && !hasCost) { toast.error('Enter a valid points cost'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    let rewardId;
    if (isEdit) {
      const updatePayload = {
        title: selected.title,
        description: selected.description || null,
        category: selected.category || 'gym',
        reward_kind: selected.reward_kind || 'digital',
        value_label: selected.value_label || null,
        discount_type: selected.discount_type || null,
        discount_value: selected.discount_value ?? null,
        offer: selected.offer || null,
        partner_blurb: selected.partner_blurb || null,
        terms: selected.terms || null,
        url: selected.url || null,
        image_url: selected.image_url || null,
        hero_image_url: selected.hero_image_url || null,
        hero_video_url: selected.hero_video_url || null,
      };
      if (hasCost) updatePayload.powr_cost = cost;

      const { error: editErr } = await supabase
        .from('rewards').update(updatePayload).eq('id', selected.target_reward_id);
      if (editErr) { setSaving(false); toast.error(editErr.message); return; }
      rewardId = selected.target_reward_id;
    } else {
      const rewardPayload = {
        partner_id: selected.partner_id || null,
        brand_name: selected.partner_id ? null : (selected.brand_name || null),
        title: selected.title,
        description: selected.description || null,
        powr_cost: cost,
        category: selected.category || 'gym',
        reward_kind: selected.reward_kind || 'digital',
        integration_type: 'API_VALIDATED',
        value_label: selected.value_label || null,
        discount_type: selected.discount_type || null,
        discount_value: selected.discount_value ?? null,
        offer: selected.offer || null,
        partner_blurb: selected.partner_blurb || null,
        terms: selected.terms || null,
        url: selected.url || null,
        image_url: selected.image_url || null,
        hero_image_url: selected.hero_image_url || null,
        hero_video_url: selected.hero_video_url || null,
        brand_color: selected.brand_color || null,
        active: false,
        featured_on_home: false,
      };

      const { data: created, error: insErr } = await supabase
        .from('rewards').insert(rewardPayload).select('id').single();
      if (insErr) { setSaving(false); toast.error(insErr.message); return; }
      rewardId = created.id;

      // Pre-seed the promo-code scheme so RewardManager opens with it ready to generate.
      if (selected.code_prefix) {
        try { localStorage.setItem(`powr_scheme_${rewardId}`, `POWR-${selected.code_prefix.toUpperCase()}-A1B2C3`); } catch { /* ignore */ }
      }
    }

    const { error: updErr } = await supabase.from('reward_submissions').update({
      status: 'approved',
      created_reward_id: rewardId,
      reviewer_notes: reviewNotes.trim() || null,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', selected.id);
    setSaving(false);
    if (updErr) { toast.error(updErr.message); return; }
    toast.success(isEdit ? 'Listing updated — changes are live' : 'Reward created in the Vault — finalize & generate codes there');
    setSelected(null);
    fetchSubs();
  }

  async function handleReject() {
    if (!selected) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('reward_submissions').update({
      status: 'rejected',
      reviewer_notes: reviewNotes.trim() || null,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', selected.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Submission rejected');
    setSelected(null);
    fetchSubs();
  }

  async function reInvite(sub, e) {
    e.stopPropagation();
    const token = crypto.randomUUID();
    const { error } = await supabase.from('reward_submissions')
      .update({ invite_token: token, status: 'invited' }).eq('id', sub.id);
    if (error) { toast.error(error.message); return; }
    toast.success('New invite link generated');
    fetchSubs();
  }

  const FILTERS = ['pending', 'invited', 'approved', 'rejected', 'all'];

  return (
    <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-16">
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-[1px] w-12 bg-[#E8D200]" />
            <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Subsystem / Partner Intake</span>
          </div>
          <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Reward Submissions</h1>
          <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
            Invite partners to submit rewards, then review and commit them to the Vault.
          </p>
        </div>
        <button onClick={() => { setInviteOpen(true); setCreatedLink(null); }}
          className="flex items-center gap-4 h-16 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 shrink-0">
          <Plus size={18} /> Invite Partner
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-16">
        {[
          { label: 'Total', value: allStats.total, icon: Inbox, color: '#8a7600' },
          { label: 'Awaiting Review', value: allStats.pending, icon: Clock, color: '#f97316' },
          { label: 'Invites Sent', value: allStats.invited, icon: Send, color: '#6366f1' },
          { label: 'Approved', value: allStats.approved, icon: CheckCircle, color: '#4ade80' },
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
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-20 h-20 rounded-3xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center"><Inbox size={32} className="text-[#CCCCCC]" /></div>
            <p className="text-[11px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">No {filter === 'all' ? '' : filter} submissions</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                  {['Reward / Brand', 'Sector', 'Updated', 'Status', ''].map(h => (
                    <th key={h} className={`px-6 py-5 text-[10px] font-black uppercase tracking-[0.5em] text-[#AAAAAA] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E6E1]">
                {subs.map(sub => (
                  <tr key={sub.id} onClick={() => openDetail(sub)} className="group hover:bg-[#F4F4F1] transition-all cursor-pointer">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center overflow-hidden shrink-0">
                          {(sub.image_url || sub.partners?.logo_url) ? <img src={sub.image_url || sub.partners.logo_url} alt="" className="w-full h-full object-contain p-1.5" /> : <Award size={18} className="text-[#BBBBBB]" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors">{sub.title || <span className="text-[#AAAAAA] italic font-light">Awaiting submission…</span>}</span>
                            {sub.target_reward_id && (
                              <span className="px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: '#8B5CF6', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)' }}>Listing Update</span>
                            )}
                          </div>
                          <div className="text-[10px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">{sub.partners?.name || sub.brand_name || sub.contact_email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[11px] font-black text-[#888888] uppercase tracking-[0.2em]">{SECTOR_LABEL[sub.category] || '—'}</span>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="text-[12px] text-[#999999] font-medium">{formatDate(sub.submitted_at || sub.created_at)}</div>
                    </td>
                    <td className="px-6 py-5"><StatusBadge status={sub.status} /></td>
                    <td className="px-6 py-5 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        {sub.status === 'invited' && (
                          <button onClick={e => copyLink(sub, e)} className="inline-flex items-center gap-3 px-6 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#999999] hover:text-[#8a7600] hover:border-[#E8D200]/30 transition-all">
                            {copiedId === sub.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Link</>}
                          </button>
                        )}
                        {sub.status === 'rejected' && (
                          <button onClick={e => reInvite(sub, e)} className="inline-flex items-center gap-3 px-6 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#999999] hover:text-[#6366f1] hover:border-[#6366f1]/30 transition-all">Re-invite</button>
                        )}
                        <button onClick={() => openDetail(sub)} className="inline-flex items-center gap-3 px-6 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#666666] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all">
                          {sub.status === 'pending' ? 'Review' : 'View'} <span className="text-[#999999]">›</span>
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

      {/* ── Invite modal ── */}
      {inviteOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={() => setInviteOpen(false)}>
          <div className="bg-white border border-[#E6E6E1] rounded-3xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-10 border-b border-[#E6E6E1]">
              <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A]">Invite a Partner</h2>
              <button onClick={() => setInviteOpen(false)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-colors"><X size={16} /></button>
            </div>
            {createdLink ? (
              <div className="p-10 space-y-6">
                <p className="text-sm text-[#777777] font-light">Invite created. Send this private link to the partner:</p>
                <div className="flex gap-3">
                  <div className="flex-1 h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl flex items-center overflow-hidden">
                    <span className="text-[11px] text-[#888888] font-mono truncate">{createdLink}</span>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(createdLink); toast.success('Link copied'); }}
                    className="h-14 px-8 rounded-2xl bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] hover:opacity-90 transition-opacity shrink-0">Copy</button>
                </div>
                <button onClick={() => setInviteOpen(false)} className="w-full h-12 rounded-2xl border border-[#E6E6E1] text-[#666666] text-[10px] font-black uppercase tracking-[0.3em] hover:text-[#1A1A1A] transition-colors">Done</button>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite} className="p-10 space-y-6">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black mb-2">Existing partner (optional)</label>
                  <select value={invPartnerId} onChange={e => setInvPartnerId(e.target.value)} className={modalInp}>
                    <option value="">— New / standalone brand —</option>
                    {partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.partner_code ? ` (${p.partner_code})` : ''}</option>)}
                  </select>
                </div>
                {!invPartnerId && (
                  <>
                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black mb-2">Brand name</label>
                      <input value={invBrand} onChange={e => setInvBrand(e.target.value)} placeholder="e.g. Tribe" className={modalInp} />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black mb-2">Suggested code name (optional)</label>
                      <input value={invPrefix} onChange={e => setInvPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="e.g. TRIBE" className={modalInp + ' uppercase tracking-[0.2em]'} />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black mb-2">Contact email (optional)</label>
                  <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="partner@brand.com" className={modalInp} />
                </div>
                <button type="submit" disabled={creating} className="w-full h-14 rounded-2xl bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] hover:opacity-90 transition-opacity disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create Invite Link'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Review modal ── */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={() => setSelected(null)}>
          <div className="bg-white border border-[#E6E6E1] rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-8 border-b border-[#E6E6E1] sticky top-0 bg-white z-10">
              <div className="flex items-center gap-5">
                <div className="text-lg font-light tracking-tight text-[#1A1A1A]">{selected.title || 'Submission'}</div>
                <StatusBadge status={selected.status} />
              </div>
              <button onClick={() => setSelected(null)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-colors"><X size={16} /></button>
            </div>

            <div className="grid lg:grid-cols-[1fr_320px] gap-8 p-8">
              {/* Details */}
              <div className="space-y-8 order-2 lg:order-1">
                {selected.status === 'invited' ? (
                  <div className="space-y-4">
                    <p className="text-sm text-[#777777] font-light">This partner hasn't submitted yet. Share their invite link:</p>
                    <div className="flex gap-3">
                      <div className="flex-1 h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl flex items-center overflow-hidden">
                        <span className="text-[11px] text-[#888888] font-mono truncate">{window.location.origin}/partner-reward/{selected.invite_token}</span>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/partner-reward/${selected.invite_token}`); toast.success('Link copied'); }}
                        className="h-14 px-8 rounded-2xl bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] hover:opacity-90 transition-opacity shrink-0">Copy</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Detail label="Brand">{selected.partners?.name || selected.brand_name || '—'}</Detail>
                    <Detail label="Contact">{[selected.contact_name, selected.contact_email].filter(Boolean).join(' · ') || '—'}</Detail>
                    <Detail label="Description">{selected.description || '—'}</Detail>
                    <Detail label="Promo code">POWR-{(selected.code_prefix || 'BRAND').toUpperCase()}-XXXXXX</Detail>
                    {selected.offer && <Detail label="Offer detail">{selected.offer}</Detail>}
                    {selected.partner_blurb && <Detail label="About brand">{selected.partner_blurb}</Detail>}
                    {selected.terms && <Detail label="Terms">{selected.terms}</Detail>}
                    {selected.url && <Detail label="URL">{selected.url}</Detail>}

                    {/* Reviewer notes */}
                    <div className="space-y-3">
                      <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#BBBBBB]">Reviewer notes</span>
                      <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} disabled={saving} placeholder="Optional internal notes…"
                        className="w-full px-6 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#666666] font-light outline-none focus:border-[#E8D200]/30 transition-colors resize-none placeholder-[#BBBBBB]" />
                    </div>

                    {/* Decision (pending only) */}
                    {selected.status === 'pending' && (
                      <div className="space-y-5 pt-2">
                        <div className="space-y-3">
                          <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#8a7600]">
                            {selected.target_reward_id ? 'Update points price (optional — blank keeps current)' : 'Set points price *'}
                          </span>
                          <div className="flex items-center gap-3">
                            <input type="number" min="1" value={powrCost} onChange={e => setPowrCost(e.target.value)} placeholder={selected.target_reward_id ? 'Keep current' : 'e.g. 500'} disabled={saving}
                              className="w-40 h-14 px-6 bg-[#F4F4F1] border border-[#E8D200]/20 rounded-2xl text-lg text-[#1A1A1A] font-light outline-none focus:border-[#E8D200]/50 transition-colors" />
                            <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">POWR points</span>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <button onClick={handleReject} disabled={saving} className="flex-1 h-16 rounded-2xl border text-[10px] font-black uppercase tracking-[0.3em] transition-all disabled:opacity-50 hover:translate-y-[-2px]"
                            style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', color: '#ef4444' }}>{saving ? '…' : 'Reject'}</button>
                          <button onClick={handleApprove} disabled={saving} className="flex-1 h-16 rounded-2xl border text-[10px] font-black uppercase tracking-[0.3em] transition-all disabled:opacity-50 hover:translate-y-[-2px] shadow-lg"
                            style={{ borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.07)', color: '#4ade80' }}>
                            {saving ? 'Saving…' : selected.target_reward_id ? 'Approve & Update Listing' : 'Approve & Create Reward'}
                          </button>
                        </div>
                        <p className="text-[11px] text-[#AAAAAA] font-light leading-relaxed">
                          {selected.target_reward_id
                            ? <>Approving applies these changes <span className="text-[#888888]">directly to the live reward</span>. Rejecting leaves the listing untouched.</>
                            : <>Approving creates an <span className="text-[#888888]">inactive</span> reward in the Vault with the promo-code scheme pre-loaded. Finalize and toggle it live there.</>}
                        </p>
                      </div>
                    )}

                    {(selected.status === 'approved' || selected.status === 'rejected') && (
                      <div className="flex items-center gap-4 p-6 rounded-2xl border" style={{ borderColor: STATUS[selected.status].border, background: STATUS[selected.status].bg }}>
                        <div className="text-lg" style={{ color: STATUS[selected.status].color }}>{selected.status === 'approved' ? '✓' : '✕'}</div>
                        <div className="flex-1">
                          <div className="text-sm font-medium" style={{ color: STATUS[selected.status].color }}>
                            {STATUS[selected.status].label}{selected.reviewed_at ? ` · ${formatDate(selected.reviewed_at)}` : ''}
                          </div>
                          {selected.reviewer_notes && <div className="text-xs text-[#999999] mt-1 font-light">{selected.reviewer_notes}</div>}
                        </div>
                        {selected.created_reward_id && (
                          <Link to="/admin/rewards" className="text-[9px] font-black uppercase tracking-[0.3em] text-[#8a7600] hover:underline shrink-0">Open in Vault ›</Link>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Live preview */}
              <div className="order-1 lg:order-2">
                <RewardAppPreview
                  brandName={selected.partners?.name || selected.brand_name || ''}
                  title={selected.title || ''}
                  description={selected.description || ''}
                  partnerBlurb={selected.partner_blurb || ''}
                  offer={selected.offer || ''}
                  valueLabel={selected.value_label || ''}
                  discountType={selected.discount_type || ''}
                  discountValue={selected.discount_value ?? ''}
                  pts={selected.status === 'pending' ? (powrCost || null) : null}
                  logoUrl={selected.image_url || selected.partners?.logo_url || null}
                  heroUrl={selected.hero_image_url || null}
                  heroVideoUrl={selected.hero_video_url || null}
                  codePrefix={selected.code_prefix || ''}
                  category={selected.category || ''}
                  pageTheme="light"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div className="h-[1px] w-6 bg-[#E2E2DD]" />
        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#BBBBBB]">{label}</span>
      </div>
      <p className="text-sm text-[#555555] font-light leading-relaxed break-words">{children}</p>
    </div>
  );
}

const modalInp = "w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] font-light outline-none focus:border-[#E8D200]/30 transition-colors placeholder-[#BBBBBB]";
