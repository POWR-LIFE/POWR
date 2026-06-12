import React, { useEffect, useState } from 'react';
import { X, Plus, Loader2, CheckCircle, AlertCircle, Users, KeyRound } from 'lucide-react';
import { invokeFn } from '../lib/invokeFn';
import { useToast } from '../lib/toast';

// ─── Brand Portal Access modal ────────────────────────────────────────────────
// Manages portal logins for a reward brand (rewards.brand_name — no link to the
// partners/gyms table). Mint single-use setup links, list users, revoke access.
export default function BrandPortalAccess({ brands, onClose }) {
    const toast = useToast();
    const [brandName, setBrandName] = useState(brands[0] ?? '');
    const [users, setUsers] = useState([]);
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(false);
    const [creatingLink, setCreatingLink] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const [copiedId, setCopiedId] = useState(null);

    // Build setup links from the admin's own origin so they work on any deploy
    const setupUrl = (token) => `${window.location.origin}/partner/setup/${token}`;

    const fetchAccess = async (b) => {
        if (!b) { setUsers([]); setInvites([]); return; }
        setLoading(true);
        try {
            const data = await invokeFn('manage-partner-user', { action: 'list', brand_name: b });
            if (!data?.ok) throw new Error(data?.error ?? 'Failed to load');
            setUsers(data.users ?? []);
            setInvites(data.invites ?? []);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAccess(brandName); }, [brandName]);

    const handleCreateLink = async () => {
        if (!brandName) return;
        setCreatingLink(true);
        try {
            const data = await invokeFn('manage-partner-user', { action: 'create_invite', brand_name: brandName });
            if (!data?.ok) throw new Error(data?.error ?? 'Failed to create link');
            await navigator.clipboard.writeText(setupUrl(data.token)).catch(() => {});
            toast.success('Setup link created & copied — send it to the brand');
            fetchAccess(brandName);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setCreatingLink(false);
        }
    };

    const copyInvite = async (inv) => {
        await navigator.clipboard.writeText(setupUrl(inv.token));
        setCopiedId(inv.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const revokeInvite = async (inv) => {
        try {
            const data = await invokeFn('manage-partner-user', { action: 'revoke_invite', invite_id: inv.id });
            if (!data?.ok) throw new Error(data?.error ?? 'Revoke failed');
            toast.success('Setup link revoked');
            setInvites(prev => prev.filter(i => i.id !== inv.id));
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRemove = async (userId) => {
        setRemovingId(userId);
        try {
            const data = await invokeFn('manage-partner-user', { action: 'remove', user_id: userId });
            if (!data?.ok) throw new Error(data?.error ?? 'Remove failed');
            toast.success('Access revoked');
            setUsers(prev => prev.filter(u => u.user_id !== userId));
        } catch (err) {
            toast.error(err.message);
        } finally {
            setRemovingId(null);
        }
    };

    const timeAgo = (d) => {
        if (!d) return 'Never';
        const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        return `${days}d ago`;
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={onClose}>
            <div className="bg-white border border-[#E6E6E1] rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-8 border-b border-[#E6E6E1] sticky top-0 bg-white z-10">
                    <div className="flex items-center gap-4">
                        <KeyRound size={18} className="text-[#8a7600]" />
                        <h2 className="text-xl font-light tracking-tight text-[#1A1A1A]">Portal Access</h2>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-colors"><X size={16} /></button>
                </div>

                <div className="p-8 space-y-6">
                    <p className="text-[11px] text-[#AAAAAA] font-black leading-relaxed">
                        Give a reward brand a login for the self-service portal at /partner. Generate a setup
                        link and send it over any channel — they choose their own email and password.
                    </p>

                    {/* Brand selector */}
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black mb-2">Brand</label>
                        <select
                            value={brandName}
                            onChange={e => setBrandName(e.target.value)}
                            className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] font-bold outline-none focus:border-[#E8D200]/30 transition-colors cursor-pointer"
                        >
                            {brands.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>

                    {/* Generate setup link */}
                    <button
                        onClick={handleCreateLink}
                        disabled={creatingLink || !brandName}
                        className="w-full flex items-center justify-center gap-3 h-14 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.25em] rounded-2xl transition-all hover:translate-y-[-1px] shadow-md shadow-[#E8D200]/20 disabled:opacity-50"
                    >
                        {creatingLink ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Generate Setup Link
                    </button>

                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="w-6 h-6 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        </div>
                    ) : (
                        <>
                            {/* Open setup links */}
                            {invites.length > 0 && (
                                <div className="space-y-3">
                                    <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Open Setup Links</span>
                                    {invites.map(inv => (
                                        <div key={inv.id} className="flex items-center gap-4 p-4 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-2xl">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[10px] font-mono text-[#888] truncate">{setupUrl(inv.token)}</div>
                                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-1">
                                                    Created {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · unused
                                                </div>
                                            </div>
                                            <button onClick={() => copyInvite(inv)} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-[#E6E6E1] rounded-full text-[#666] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all shrink-0">
                                                {copiedId === inv.id ? 'Copied' : 'Copy'}
                                            </button>
                                            <button onClick={() => revokeInvite(inv)} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all shrink-0">
                                                Revoke
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Users */}
                            <div className="space-y-3">
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black flex items-center gap-2">
                                    <Users size={11} /> Portal Users
                                </span>
                                {users.length === 0 ? (
                                    <div className="py-6 text-center border border-dashed border-[#E6E6E1] rounded-2xl">
                                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No portal users yet</p>
                                    </div>
                                ) : users.map(u => (
                                    <div key={u.user_id} className="flex items-center gap-5 p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl group">
                                        <div className="w-9 h-9 rounded-xl bg-white border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                            {u.confirmed ? <CheckCircle size={16} className="text-[#10B981]" /> : <AlertCircle size={16} className="text-[#E8D200]" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-bold text-[#222] truncate">{u.email}</div>
                                            <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-0.5">
                                                {u.confirmed ? `Last login: ${timeAgo(u.last_sign_in)}` : 'Invite pending'}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRemove(u.user_id)}
                                            disabled={removingId === u.user_id}
                                            className="opacity-0 group-hover:opacity-100 h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all"
                                        >
                                            {removingId === u.user_id ? '...' : 'Revoke'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
