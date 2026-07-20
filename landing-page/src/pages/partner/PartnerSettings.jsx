import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { ChevronRight, Key, LifeBuoy, Award } from 'lucide-react';
import BrandAccessPanel from '../../components/BrandAccessPanel';
import { methodMeta, SectionCard, INPUT } from './integrationShared';

export default function PartnerSettings() {
    const toast = useToast();
    const { partnerData, user, deliveryMethod } = useAuth();

    // Password change
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPw, setChangingPw] = useState(false);

    if (!partnerData) return null;

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
        if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
        setChangingPw(true);

        // Re-auth first
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
        if (signInErr) { toast.error('Current password is incorrect'); setChangingPw(false); return; }

        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) toast.error(error.message);
        else {
            toast.success('Password updated');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        }
        setChangingPw(false);
    };

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Account</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Settings</h1>
            </div>

            {/* Two-col like the integration pages: settings left, sticky
                help rail right on xl (stacks below on smaller screens). */}
            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            <div className="flex-1 min-w-0 max-w-3xl xl:order-1">

            {/* Brand info (read-only) */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6">
                <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB] mb-6">Brand Info</h2>
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Brand name</label>
                        <div className="flex items-center h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#666] font-bold">
                            {partnerData.name}
                        </div>
                        <p className="text-[10px] text-[#BBB] mt-1.5">Brand name is managed by POWR. Contact us to change it.</p>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Signed in as</label>
                        <div className="flex items-center h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#666] font-mono">
                            {user?.email}
                        </div>
                    </div>
                </div>
            </div>

            {/* Delivery method — managed on the integration hub */}
            <Link to="/partner/integration"
                className="flex items-center justify-between gap-6 bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6 hover:border-[#E8D200]/40 transition-all group">
                <div>
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB] mb-3">Delivery Method</h2>
                    <div className="text-sm font-bold text-[#1A1A1A]">
                        {methodMeta(deliveryMethod)?.label ?? 'Not chosen yet'}
                    </div>
                    <p className="text-[10px] text-[#BBB] mt-1.5">How codes reach members when they redeem — view status or switch method.</p>
                </div>
                <ChevronRight size={16} className="text-[#CCC] group-hover:text-[#8a7600] transition-colors shrink-0" />
            </Link>

            {/* Team — invite/remove portal logins for this brand */}
            <div className="mb-6">
                <BrandAccessPanel brandName={partnerData.brand_name} partnerView selfUserId={user?.id} />
            </div>

            {/* Account / password */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                <div className="flex items-center gap-3 mb-6">
                    <Key size={16} className="text-[#BBBBBB]" />
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">Change Password</h2>
                </div>
                <form onSubmit={handleChangePassword} className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Current password</label>
                        <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={INPUT} required />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">New password</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={INPUT} required minLength={8} />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Confirm new password</label>
                        <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={INPUT} required />
                    </div>
                    <div className="flex justify-end pt-2">
                        <button type="submit" disabled={changingPw} className="h-11 px-8 bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:bg-[#333] transition-all disabled:opacity-50">
                            {changingPw ? 'Updating...' : 'Update Password'}
                        </button>
                    </div>
                </form>
            </div>
            </div>

            {/* ── Sticky help rail: the things this page can't do itself,
                   each with somewhere to go. */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6 mt-6 xl:mt-0">
                <SectionCard icon={LifeBuoy} title="Need a Hand?">
                    <p className="text-[12px] text-[#999] leading-relaxed mb-5">
                        Brand name changes and anything you can't edit here go through
                        the POWR team — send a ticket and we'll reply within one business day.
                    </p>
                    <Link to="/partner/support"
                        className="flex items-center justify-center gap-2 h-11 px-6 bg-[#E8D200] text-[#080808] rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:translate-y-[-1px] transition-all shadow-lg shadow-[#E8D200]/10">
                        <LifeBuoy size={13} /> Contact Support
                    </Link>
                </SectionCard>

                <SectionCard icon={Award} title="Your Brand on POWR">
                    <p className="text-[12px] text-[#999] leading-relaxed mb-5">
                        Your logo, imagery and reward descriptions live on each reward
                        listing — that's exactly what members see in the app.
                    </p>
                    <Link to="/partner/rewards"
                        className="flex items-center justify-center gap-2 h-11 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all">
                        <Award size={13} /> Edit Your Listings
                    </Link>
                </SectionCard>
            </aside>
            </div>
        </div>
    );
}
