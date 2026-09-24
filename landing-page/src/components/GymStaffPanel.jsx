import React, { useEffect, useState } from 'react';
import { Loader2, Send, Link as LinkIcon, Users, Crown } from 'lucide-react';
import { invokeFn } from '../lib/invokeFn';
import { useToast } from '../lib/toast';

// ─── Gym team (portal logins for one gym) ─────────────────────────────────────
// Used in the gym portal's Team page and on the admin Gym Portals page. All of
// it goes through manage-gym-staff, which decides what the caller may do:
//   admins  invite owners or staff, remove anyone but the last owner
//   owners  invite staff, remove staff
//   staff   see the team, nothing else
// `adminView` switches the copy to POWR's voice and offers owner invites.
export default function GymStaffPanel({ partnerId, gymName, adminView = false, selfUserId = null }) {
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
            if (!data?.ok) throw new Error(data?.error ?? 'Failed to load');
            setTeam(data.team ?? []);
            setInvites(data.invites ?? []);
            setCanManage(!!data.can_manage);
            setLoaded(true);
        } catch (err) {
            toast.error(err.message);
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
            if (!data?.ok) throw new Error(data?.error ?? 'Failed to create invite');
            // The raw link only exists in this response (the server keeps a hash),
            // so it stays on screen until the next one is made.
            setLastLink(data.url);
            if (withEmail && data.emailed) {
                toast.success(`Invite emailed to ${addr}`);
                setEmail('');
            } else {
                await navigator.clipboard.writeText(data.url).catch(() => {});
                toast[withEmail ? 'error' : 'success'](withEmail ? (data.email_error ?? 'Email failed — link copied instead') : 'Setup link copied');
            }
            load();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    const revoke = async (inv) => {
        setBusy(inv.id);
        try {
            const data = await invokeFn('manage-gym-staff', { action: 'revoke_invite', invite_id: inv.id });
            if (!data?.ok) throw new Error(data?.error ?? 'Revoke failed');
            setInvites(prev => prev.filter(i => i.id !== inv.id));
            toast.success('Invite cancelled');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    const remove = async (member) => {
        if (!window.confirm(`Remove ${member.name || member.email} from ${gymName}? They lose access to the portal straight away.`)) return;
        setBusy(member.user_id);
        try {
            const data = await invokeFn('manage-gym-staff', { action: 'remove', partner_id: partnerId, user_id: member.user_id });
            if (!data?.ok) throw new Error(data?.error ?? 'Remove failed');
            setTeam(prev => prev.filter(m => m.user_id !== member.user_id));
            toast.success('Removed from the team');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    const lastSeen = (d) => {
        if (!d) return 'Never signed in';
        const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
        return days <= 0 ? 'Signed in today' : days === 1 ? 'Signed in yesterday' : `Signed in ${days}d ago`;
    };

    const canRemove = (m) => canManage && m.user_id !== selfUserId && (adminView || m.role === 'staff');

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
            <div className="flex items-center gap-4 px-6 sm:px-8 pt-8 pb-4">
                <Users size={16} className="text-[#8a7600]" />
                <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">{adminView ? 'Portal Logins' : 'Team'}</span>
                {adminView && <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">— {gymName}</span>}
            </div>

            <div className="px-6 sm:px-8 pb-8 space-y-6">
                <p className="text-[12px] text-[#999] leading-relaxed">
                    {adminView
                        ? `Give ${gymName} logins for the gym portal at /venue. The first should be an owner: owners can bring in their own team. People who already use the POWR app can sign in with that same account.`
                        : canManage
                            ? `Give the people who run ${gymName} their own login. They can use their POWR app account, or set one up from the link.`
                            : `Everyone who can run ${gymName} in the portal. Ask an owner to add someone.`}
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
                                placeholder="name@gym.com"
                                className="flex-1 min-w-0 h-12 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] outline-none placeholder-[#BBBBBB] focus:border-[#E8D200]/40 transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => invite(true)}
                                disabled={!!busy || !email.trim()}
                                className="flex items-center justify-center gap-2 h-12 px-5 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.25em] rounded-full disabled:opacity-50 shrink-0"
                            >
                                {busy === 'email' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                Invite
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => invite(false)}
                            disabled={!!busy}
                            className="w-full flex items-center justify-center gap-3 h-11 bg-white border border-[#E6E6E1] text-[#666] text-[10px] font-black uppercase tracking-[0.25em] rounded-full hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all disabled:opacity-50"
                        >
                            {busy === 'link' ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                            Copy a setup link instead
                        </button>
                        {lastLink && (
                            <div className="p-4 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-2xl">
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black mb-1">Latest link — works once, for 14 days</div>
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
                        <p className="text-[11px] text-[#BBBBBB]">Couldn’t load the team — nothing has changed.</p>
                        <button type="button" onClick={load} className="mt-3 h-9 px-5 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666]">Try again</button>
                    </div>
                ) : (
                    <>
                        {invites.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Waiting to join</span>
                                {invites.map(inv => (
                                    <div key={inv.id} className="flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-bold text-[#333] truncate">{inv.email ?? 'Setup link'}</div>
                                            <div className="text-[9px] uppercase tracking-[0.25em] text-[#BBB] font-black mt-1">
                                                {inv.role === 'owner' ? 'Owner' : 'Team'} · expires {new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => revoke(inv)} disabled={busy === inv.id} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all shrink-0">
                                            Cancel
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="space-y-2">
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">On the team</span>
                            {team.length === 0 ? (
                                <div className="py-6 text-center border border-dashed border-[#E6E6E1] rounded-2xl">
                                    <p className="text-[11px] text-[#BBBBBB]">Nobody yet{adminView ? ' — invite the owner first' : ''}.</p>
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
                                            {m.role === 'owner' && <Crown size={12} className="text-[#8a7600] shrink-0" aria-label="Owner" />}
                                            {m.user_id === selfUserId && (
                                                <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.3em] bg-[#1A1A1A] text-white rounded-full shrink-0">You</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-[#AAAAAA] font-bold truncate">
                                            {m.name && m.email ? `${m.email} · ` : ''}{m.role === 'owner' ? 'Owner' : 'Team'} · {lastSeen(m.last_sign_in)}
                                        </div>
                                    </div>
                                    {canRemove(m) && (
                                        <button
                                            type="button"
                                            onClick={() => remove(m)}
                                            disabled={busy === m.user_id}
                                            className="sm:opacity-0 sm:group-hover:opacity-100 h-8 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-red-500/60 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-full transition-all shrink-0"
                                        >
                                            {busy === m.user_id ? '…' : 'Remove'}
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
