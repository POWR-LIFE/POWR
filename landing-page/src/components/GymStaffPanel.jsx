import React, { useEffect, useState } from 'react';
import { Loader2, Send, Link as LinkIcon, Users, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeFn } from '../lib/invokeFn';
import { useToast } from '../lib/toast';
import { formatLocale } from '../lib/i18n';
import { serverErrorText } from '../lib/serverErrors';

// ─── Gym team (portal logins for one gym) ─────────────────────────────────────
// Used in the gym portal's Team page and on the admin Gym Portals page. All of
// it goes through manage-gym-staff, which decides what the caller may do:
//   admins  invite owners or staff, remove anyone but the last owner
//   owners  invite staff, remove staff
//   staff   see the team, nothing else
// `adminView` switches the copy to POWR's voice and offers owner invites; that
// copy is for POWR admins only, so it stays English.
export default function GymStaffPanel({ partnerId, gymName, adminView = false, selfUserId = null }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [team, setTeam] = useState([]);
    const [invites, setInvites] = useState([]);
    const [canManage, setCanManage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState(adminView ? 'owner' : 'staff');
    const [busy, setBusy] = useState(null); // 'email' | 'link' | user_id | invite id
    const [lastLink, setLastLink] = useState(null);

    const load = async () => {
        setLoading(true);
        setLoaded(false);
        try {
            const data = await invokeFn('manage-gym-staff', { action: 'list', partner_id: partnerId });
            if (!data?.ok) throw new Error(data?.error ?? t('venueSettings:team.errors.load'));
            setTeam(data.team ?? []);
            setInvites(data.invites ?? []);
            setCanManage(!!data.can_manage);
            setLoaded(true);
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (partnerId) load(); }, [partnerId]); // eslint-disable-line react-hooks/exhaustive-deps

    const invite = async (withEmail) => {
        const addr = email.trim();
        if (withEmail && !addr) return;
        setBusy(withEmail ? 'email' : 'link');
        try {
            const data = await invokeFn('manage-gym-staff', {
                action: 'create_invite', partner_id: partnerId, role, ...(withEmail ? { email: addr } : {}),
            });
            if (!data?.ok) throw new Error(data?.error ?? t('venueSettings:team.errors.invite'));
            // The raw link only exists in this response (the server keeps a hash),
            // so it stays on screen until the next one is made.
            setLastLink(data.url);
            if (withEmail && data.emailed) {
                toast.success(t('venueSettings:team.toast.emailed', { email: addr }));
                setEmail('');
            } else {
                await navigator.clipboard.writeText(data.url).catch(() => {});
                toast[withEmail ? 'error' : 'success'](withEmail ? serverErrorText(data.email_error, t('venueSettings:team.toast.emailFailed')) : t('venueSettings:team.toast.linkCopied'));
            }
            load();
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    const revoke = async (inv) => {
        setBusy(inv.id);
        try {
            const data = await invokeFn('manage-gym-staff', { action: 'revoke_invite', invite_id: inv.id });
            if (!data?.ok) throw new Error(data?.error ?? t('venueSettings:team.errors.revoke'));
            setInvites(prev => prev.filter(i => i.id !== inv.id));
            toast.success(t('venueSettings:team.toast.cancelled'));
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    const remove = async (member) => {
        if (!window.confirm(t('venueSettings:team.confirmRemove', { name: member.name || member.email, gym: gymName }))) return;
        setBusy(member.user_id);
        try {
            const data = await invokeFn('manage-gym-staff', { action: 'remove', partner_id: partnerId, user_id: member.user_id });
            if (!data?.ok) throw new Error(data?.error ?? t('venueSettings:team.errors.remove'));
            setTeam(prev => prev.filter(m => m.user_id !== member.user_id));
            toast.success(t('venueSettings:team.toast.removed'));
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    const lastSeen = (d) => {
        if (!d) return t('venueSettings:team.neverSignedIn');
        const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
        return days <= 0 ? t('venueSettings:team.signedInToday') : days === 1 ? t('venueSettings:team.signedInYesterday') : t('venueSettings:team.signedInDaysAgo', { days });
    };

    const canRemove = (m) => canManage && m.user_id !== selfUserId && (adminView || m.role === 'staff');

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
            <div className="flex items-center gap-4 px-6 sm:px-8 pt-8 pb-4">
                <Users size={16} className="text-[#8a7600]" />
                <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">{adminView ? 'Portal Logins' : t('venueSettings:team.title')}</span>
                {adminView && <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">— {gymName}</span>}
            </div>

            <div className="px-6 sm:px-8 pb-8 space-y-6">
                <p className="text-[12px] text-[#999] leading-relaxed">
                    {adminView
                        ? `Give ${gymName} logins for the gym portal at /venue. The first should be an owner: owners can bring in their own team. People who already use the POWR app can sign in with that same account.`
                        : canManage
                            ? t('venueSettings:team.introOwner', { gym: gymName })
                            : t('venueSettings:team.introStaff', { gym: gymName })}
                </p>

                {canManage && (
                    <div className="space-y-3">
                        {adminView && (
                            <div className="flex gap-2">
                                {['owner', 'staff'].map(r => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRole(r)}
                                        className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.18em] transition-all ${role === r ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666]'}`}
                                    >
                                        {r === 'owner' ? 'Owner' : 'Team member'}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-3">
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); invite(true); } }}
                                placeholder={t('venueSettings:team.emailPlaceholder')}
                                className="flex-1 min-w-0 h-12 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] outline-none placeholder-[#BBBBBB] focus:border-[#E8D200]/40 transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => invite(true)}
                                disabled={!!busy || !email.trim()}
                                className="flex items-center justify-center gap-2 h-12 px-5 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.25em] rounded-full disabled:opacity-50 shrink-0"
                            >
                                {busy === 'email' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                {t('venueSettings:team.invite')}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => invite(false)}
                            disabled={!!busy}
                            className="w-full flex items-center justify-center gap-3 h-11 bg-white border border-[#E6E6E1] text-[#666] text-[10px] font-black uppercase tracking-[0.25em] rounded-full hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all disabled:opacity-50"
                        >
                            {busy === 'link' ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                            {t('venueSettings:team.copyLink')}
                        </button>
                        {lastLink && (
                            <div className="p-4 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-2xl">
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black mb-1">{t('venueSettings:team.latestLink')}</div>
                                <div className="text-[11px] font-mono text-[#666] break-all select-all">{lastLink}</div>
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : !loaded ? (
                    <div className="py-8 text-center border border-dashed border-[#E6E6E1] rounded-2xl">
                        <p className="text-[11px] text-[#BBBBBB]">{t('venueSettings:team.loadFailed')}</p>
                        <button type="button" onClick={load} className="mt-3 h-9 px-5 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666]">{t('common:actions.retry')}</button>
                    </div>
                ) : (
                    <>
                        {invites.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('venueSettings:team.waiting')}</span>
                                {invites.map(inv => (
                                    <div key={inv.id} className="flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-bold text-[#333] truncate">{inv.email ?? t('venueSettings:team.setupLink')}</div>
                                            <div className="text-[9px] uppercase tracking-[0.25em] text-[#BBB] font-black mt-1">
                                                {inv.role === 'owner' ? t('venueSettings:team.owner') : t('venueSettings:team.member')} · {t('venueSettings:team.expires', { date: new Date(inv.expires_at).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short' }) })}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => revoke(inv)} disabled={busy === inv.id} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all shrink-0">
                                            {t('common:actions.cancel')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="space-y-2">
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('venueSettings:team.onTeam')}</span>
                            {team.length === 0 ? (
                                <div className="py-6 text-center border border-dashed border-[#E6E6E1] rounded-2xl">
                                    <p className="text-[11px] text-[#BBBBBB]">{adminView ? 'Nobody yet — invite the owner first.' : t('venueSettings:team.nobodyYet')}</p>
                                </div>
                            ) : team.map(m => (
                                <div key={m.user_id} className="flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl group">
                                    {m.avatar_url ? (
                                        <img src={m.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-white border border-[#E6E6E1] flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">
                                            {(m.name || m.email || '?')[0]}
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-[13px] font-bold text-[#1A1A1A] truncate">{m.name || m.email}</span>
                                            {m.role === 'owner' && <Crown size={12} className="text-[#8a7600] shrink-0" aria-label={t('venueSettings:team.owner')} />}
                                            {m.user_id === selfUserId && (
                                                <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.3em] bg-[#1A1A1A] text-white rounded-full shrink-0">{t('venueSettings:team.you')}</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-[#AAAAAA] font-bold truncate">
                                            {m.name && m.email ? `${m.email} · ` : ''}{m.role === 'owner' ? t('venueSettings:team.owner') : t('venueSettings:team.member')} · {lastSeen(m.last_sign_in)}
                                        </div>
                                    </div>
                                    {canRemove(m) && (
                                        <button
                                            type="button"
                                            onClick={() => remove(m)}
                                            disabled={busy === m.user_id}
                                            className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all shrink-0"
                                        >
                                            {busy === m.user_id ? '…' : t('venueSettings:status.remove')}
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
