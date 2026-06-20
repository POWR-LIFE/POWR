import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Users, KeyRound, Search, Send, Link as LinkIcon } from 'lucide-react';
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
    const [inviteEmail, setInviteEmail] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [search, setSearch] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const searchRef = useRef(null);
    const dropdownRef = useRef(null);

    const filteredBrands = brands.filter(b => b.toLowerCase().includes(search.toLowerCase()));

    // Close dropdown when clicking outside
    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

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

    const handleEmailInvite = async () => {
        const email = inviteEmail.trim();
        if (!brandName || !email || sendingEmail) return;
        setSendingEmail(true);
        try {
            const data = await invokeFn('manage-partner-user', { action: 'create_invite', brand_name: brandName, email });
            if (!data?.ok) throw new Error(data?.error ?? 'Failed to send invite');
            if (data.emailed) {
                toast.success(`Invite emailed to ${email}`);
            } else {
                // Link was saved but the email didn't go out — copy it so it's not lost
                await navigator.clipboard.writeText(setupUrl(data.token)).catch(() => {});
                toast.error(data.email_error ?? 'Email failed — link copied instead');
            }
            setInviteEmail('');
            fetchAccess(brandName);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setSendingEmail(false);
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
                        Give a reward brand a login for the self-service portal at /partner. Email them an
                        invite or copy a setup link to send yourself — they choose their own email and password.
                    </p>

                    {/* Brand selector with search */}
                    <div ref={dropdownRef}>
                        <label className="block text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black mb-2">Brand</label>
                        <div className="relative">
                            {/* Selected brand + search input */}
                            <div
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl flex items-center gap-3 cursor-pointer focus-within:border-[#E8D200]/30 transition-colors"
                                onClick={() => { setDropdownOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }}
                            >
                                <Search size={14} className="text-[#AAAAAA] shrink-0" />
                                {dropdownOpen ? (
                                    <input
                                        ref={searchRef}
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder={brandName || 'Search brand…'}
                                        className="flex-1 bg-transparent text-sm text-[#1A1A1A] font-bold outline-none placeholder-[#AAAAAA]"
                                        onClick={e => e.stopPropagation()}
                                    />
                                ) : (
                                    <span className="flex-1 text-sm text-[#1A1A1A] font-bold truncate">{brandName || 'Select brand…'}</span>
                                )}
                            </div>

                            {/* Dropdown list */}
                            {dropdownOpen && (
                                <div className="absolute z-50 top-[calc(100%+6px)] left-0 right-0 bg-white border border-[#E6E6E1] rounded-2xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                                    {filteredBrands.length === 0 ? (
                                        <div className="px-5 py-4 text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">No brands found</div>
                                    ) : filteredBrands.map(b => (
                                        <button
                                            key={b}
                                            onClick={() => { setBrandName(b); setSearch(''); setDropdownOpen(false); }}
                                            className={`w-full text-left px-5 py-3.5 text-sm font-bold transition-colors hover:bg-[#F4F4F1] ${b === brandName ? 'text-[#8a7600] bg-[#E8D200]/5' : 'text-[#1A1A1A]'}`}
                                        >
                                            {b}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Invite by email */}
                    <div className="space-y-3">
                        <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Invite by email</span>
                        <div className="flex gap-3">
                            <input
                                type="email"
                                value={inviteEmail}
                                onChange={e => setInviteEmail(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEmailInvite(); } }}
                                placeholder="brand@email.com"
                                disabled={!brandName}
                                className="flex-1 min-w-0 h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] font-bold outline-none placeholder-[#BBBBBB] focus:border-[#E8D200]/30 transition-colors disabled:opacity-50"
                            />
                            <button
                                onClick={handleEmailInvite}
                                disabled={sendingEmail || !brandName || !inviteEmail.trim()}
                                className="flex items-center justify-center gap-2 h-14 px-6 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.25em] rounded-2xl transition-all hover:translate-y-[-1px] shadow-md shadow-[#E8D200]/20 disabled:opacity-50 shrink-0"
                            >
                                {sendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                Send
                            </button>
                        </div>
                    </div>

                    {/* Or copy a setup link */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-[#E6E6E1]" />
                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">or</span>
                        <div className="flex-1 h-px bg-[#E6E6E1]" />
                    </div>

                    <button
                        onClick={handleCreateLink}
                        disabled={creatingLink || !brandName}
                        className="w-full flex items-center justify-center gap-3 h-12 bg-white border border-[#E6E6E1] text-[#666] text-[10px] font-black uppercase tracking-[0.25em] rounded-2xl transition-all hover:border-[#E8D200]/40 hover:text-[#8a7600] disabled:opacity-50"
                    >
                        {creatingLink ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                        Copy a setup link instead
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
                                                    {inv.email ? `Emailed to ${inv.email}` : 'Created'} {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · unused
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
