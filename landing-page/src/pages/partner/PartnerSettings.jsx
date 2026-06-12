import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Key } from 'lucide-react';

const INPUT = "w-full h-14 px-5 bg-white border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none transition-all font-['Outfit']";

export default function PartnerSettings() {
    const toast = useToast();
    const { partnerData, user } = useAuth();

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
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-2xl">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Account</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Settings</h1>
            </div>

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
                    <p className="text-[11px] text-[#AAAAAA] leading-relaxed pt-2">
                        Your logo and imagery live on each reward listing — edit them from My Rewards via "Edit Listing".
                    </p>
                </div>
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
    );
}
