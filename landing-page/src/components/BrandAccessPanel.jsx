import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle, AlertCircle, Users, KeyRound, Send, Link as LinkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeFn } from '../lib/invokeFn';
import { useToast } from '../lib/toast';
import i18n, { formatLocale } from '../lib/i18n';
import { serverErrorText } from '../lib/serverErrors';

// ─── Brand Access panel (inline, single brand) ────────────────────────────────
// Embedded inside the reward editor's "Partner & Access" tab. Manages portal
// logins for a single reward brand (rewards.brand_name — no link to the
// partners/gyms table): mint single-use setup links, list users, revoke access.
// This is the non-modal sibling of BrandPortalAccess.jsx.
//
// Also rendered partner-side in /partner/settings: pass partnerView for
// team-voice copy and selfUserId to mark the signed-in user (who can't remove
// their own access — the edge fn enforces that too).
//
// Language: the partner view follows the portal's language. The admin view
// (the reward editor) is POWR staff only and stays English, so it reads the
// same keys through a fixed-English t and shows server errors as they came.
export default function BrandAccessPanel({ brandName, partnerView = false, selfUserId = null }) {
    const { t: portalT } = useTranslation();
    const t = partnerView ? portalT : i18n.getFixedT('en');
    const errorText = (err) => (partnerView ? serverErrorText(err) : (typeof err === 'string' ? err : err?.message));
    const dateLocale = partnerView ? formatLocale() : 'en-GB';
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [invites, setInvites] = useState([]);
    // Starts loading: the list is fetched on mount, and an empty team is a
    // claim we can only make once the round-trip has actually succeeded
    // (`loaded` is tracked apart from the payload so a failure settles the
    // panel into a retry rather than into "no users").
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [creatingLink, setCreatingLink] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const [inviteEmail, setInviteEmail] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);

    // Build setup links from the admin's own origin so they work on any deploy
    const setupUrl = (token) => `${window.location.origin}/partner/setup/${token}`;

    const fetchAccess = async (b) => {
        if (!b) { setUsers([]); setInvites([]); setLoading(false); return; }
        setLoading(true);
        setLoaded(false);
        try {
            const data = await invokeFn('manage-partner-user', { action: 'list', brand_name: b });
            if (!data?.ok) throw new Error(data?.error ?? t('brandShell:team.errors.load'));
            setUsers(data.users ?? []);
            setInvites(data.invites ?? []);
            setLoaded(true);
        } catch (err) {
            toast.error(errorText(err));
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
            if (!data?.ok) throw new Error(data?.error ?? t('brandShell:team.errors.createLink'));
            await navigator.clipboard.writeText(setupUrl(data.token)).catch(() => {});
            // The admin hands the link to the brand; a brand hands it to a teammate.
            toast.success(partnerView ? t('brandShell:team.toast.linkCreated') : 'Setup link created & copied — send it to the brand');
            fetchAccess(brandName);
        } catch (err) {
            toast.error(errorText(err));
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
            if (!data?.ok) throw new Error(data?.error ?? t('brandShell:team.errors.sendInvite'));
            if (data.emailed) {
                toast.success(t('brandShell:team.toast.emailed', { email }));
            } else {
                // Link was saved but the email didn't go out — copy it so it's not lost
                await navigator.clipboard.writeText(setupUrl(data.token)).catch(() => {});
                toast.error(data.email_error ? errorText(data.email_error) : t('brandShell:team.toast.emailFailed'));
            }
            setInviteEmail('');
            fetchAccess(brandName);
        } catch (err) {
            toast.error(errorText(err));
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
            if (!data?.ok) throw new Error(data?.error ?? t('brandShell:team.errors.revoke'));
            toast.success(t('brandShell:team.toast.linkRevoked'));
            setInvites(prev => prev.filter(i => i.id !== inv.id));
        } catch (err) {
            toast.error(errorText(err));
        }
    };

    const handleRemove = async (userId) => {
        setRemovingId(userId);
        try {
            const data = await invokeFn('manage-partner-user', { action: 'remove', user_id: userId });
            if (!data?.ok) throw new Error(data?.error ?? t('brandShell:team.errors.remove'));
            toast.success(t('brandShell:team.toast.accessRevoked'));
            setUsers(prev => prev.filter(u => u.user_id !== userId));
        } catch (err) {
            toast.error(errorText(err));
        } finally {
            setRemovingId(null);
        }
    };

    const lastLogin = (d) => {
        if (!d) return t('brandShell:team.lastLogin.never');
        const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
        if (days === 0) return t('brandShell:team.lastLogin.today');
        if (days === 1) return t('brandShell:team.lastLogin.yesterday');
        return t('brandShell:team.lastLogin.daysAgo', { days });
    };

    if (!brandName) {
        // Admin only (the reward editor before a brand is set).
        return (
            <div className="bg-white border border-[#E6E6E1] rounded-[2rem] p-8 text-center">
                <p className="text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">
                    Set a brand name and save the reward to manage portal access
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
                <div className="flex items-center gap-4">
                    {partnerView ? <Users size={16} className="text-[#8a7600]" /> : <KeyRound size={16} className="text-[#8a7600]" />}
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">{partnerView ? t('brandShell:team.title') : 'Portal Logins'}</span>
                    {!partnerView && <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black ml-1">— {brandName}</span>}
                </div>
            </div>

            <div className="px-8 pb-8 space-y-6">
                <p className="text-[11px] text-[#AAAAAA] font-black leading-relaxed">
                    {partnerView
                        ? t('brandShell:team.intro', { brand: brandName })
                        : 'Give this brand logins for the self-service portal at /partner. Email them an invite or copy a setup link to send yourself — either way they choose their own email and password. Add as many as you like; each gets its own login.'}
                </p>

                {/* Invite by email */}
                <div className="space-y-3">
                    <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('brandShell:team.inviteByEmail')}</span>
                    <div className="flex gap-3">
                        <input
                            type="email"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEmailInvite(); } }}
                            placeholder="brand@email.com"
                            className="flex-1 min-w-0 h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] font-bold outline-none placeholder-[#BBBBBB] focus:border-[#E8D200]/30 transition-colors"
                        />
                        <button
                            type="button"
                            onClick={handleEmailInvite}
                            disabled={sendingEmail || !inviteEmail.trim()}
                            className="flex items-center justify-center gap-2 h-14 px-6 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.25em] rounded-2xl transition-all hover:translate-y-[-1px] shadow-md shadow-[#E8D200]/20 disabled:opacity-50 shrink-0"
                        >
                            {sendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            {t('brandShell:team.send')}
                        </button>
                    </div>
                </div>

                {/* Or copy a setup link */}
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-[#E6E6E1]" />
                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">{t('brandShell:team.or')}</span>
                    <div className="flex-1 h-px bg-[#E6E6E1]" />
                </div>

                <button
                    type="button"
                    onClick={handleCreateLink}
                    disabled={creatingLink}
                    className="w-full flex items-center justify-center gap-3 h-12 bg-white border border-[#E6E6E1] text-[#666] text-[10px] font-black uppercase tracking-[0.25em] rounded-2xl transition-all hover:border-[#E8D200]/40 hover:text-[#8a7600] disabled:opacity-50"
                >
                    {creatingLink ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                    {t('brandShell:team.copyLink')}
                </button>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : !loaded ? (
                    <div className="py-8 text-center border border-dashed border-[#E6E6E1] rounded-2xl">
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">
                            {partnerView ? t('brandShell:team.loadFailed') : "Couldn't load portal users"}
                        </p>
                        <p className="text-[11px] text-[#BBBBBB] mt-2">{t('brandShell:team.loadFailedBody')}</p>
                        <button
                            type="button"
                            onClick={() => fetchAccess(brandName)}
                            className="inline-flex items-center justify-center h-10 px-6 mt-4 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                        >
                            {t('common:actions.retry')}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Open setup links */}
                        {invites.length > 0 && (
                            <div className="space-y-3">
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('brandShell:team.openLinks')}</span>
                                {invites.map(inv => (
                                    <div key={inv.id} className="flex items-center gap-4 p-4 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-2xl">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[10px] font-mono text-[#888] truncate">{setupUrl(inv.token)}</div>
                                            <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-1">
                                                {(() => {
                                                    const date = new Date(inv.created_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
                                                    return inv.email
                                                        ? t('brandShell:team.emailedOn', { email: inv.email, date })
                                                        : t('brandShell:team.createdOn', { date });
                                                })()}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => copyInvite(inv)} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-[#E6E6E1] rounded-full text-[#666] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all shrink-0">
                                            {copiedId === inv.id ? t('brandShell:team.copied') : t('brandShell:team.copy')}
                                        </button>
                                        <button type="button" onClick={() => revokeInvite(inv)} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all shrink-0">
                                            {t('brandShell:team.revoke')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Users */}
                        <div className="space-y-3">
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black flex items-center gap-2">
                                <Users size={11} /> {partnerView ? t('brandShell:team.members') : 'Portal Users'}
                            </span>
                            {users.length === 0 ? (
                                <div className="py-6 text-center border border-dashed border-[#E6E6E1] rounded-2xl">
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">{t('brandShell:team.noUsers')}</p>
                                </div>
                            ) : users.map(u => (
                                <div key={u.user_id} className="flex items-center gap-5 p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl group">
                                    <div className="w-9 h-9 rounded-xl bg-white border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                        {u.confirmed ? <CheckCircle size={16} className="text-[#10B981]" /> : <AlertCircle size={16} className="text-[#E8D200]" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="text-[12px] font-bold text-[#222] truncate">{u.email}</div>
                                            {u.user_id === selfUserId && (
                                                <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.3em] bg-[#1A1A1A] text-white rounded-full shrink-0">{t('brandShell:team.you')}</span>
                                            )}
                                        </div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-0.5">
                                            {u.confirmed ? lastLogin(u.last_sign_in) : t('brandShell:team.invitePending')}
                                        </div>
                                    </div>
                                    {u.user_id !== selfUserId && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemove(u.user_id)}
                                            disabled={removingId === u.user_id}
                                            className="opacity-0 group-hover:opacity-100 h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all"
                                        >
                                            {removingId === u.user_id ? '...' : t('brandShell:team.revoke')}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
