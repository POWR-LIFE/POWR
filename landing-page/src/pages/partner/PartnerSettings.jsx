import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { serverErrorText } from '../../lib/serverErrors';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { ChevronRight, Key, LifeBuoy, Award } from 'lucide-react';
import BrandAccessPanel from '../../components/BrandAccessPanel';
import { methodMeta, SectionCard, INPUT } from './integrationShared';

export default function PartnerSettings() {
    const { t } = useTranslation();
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
        if (newPassword !== confirmPassword) { toast.error(t('brandShell:auth.passwordsDontMatch')); return; }
        if (newPassword.length < 8) { toast.error(t('brandShell:auth.passwordTooShort')); return; }
        setChangingPw(true);

        // Re-auth first
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
        if (signInErr) { toast.error(t('brandShell:settings.currentPasswordWrong')); setChangingPw(false); return; }

        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) toast.error(serverErrorText(error));
        else {
            toast.success(t('brandShell:settings.passwordUpdated'));
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
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{t('brandShell:settings.eyebrow')}</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">{t('brandShell:settings.title')}</h1>
            </div>

            {/* Two-col like the integration pages: settings left, sticky
                help rail right on xl (stacks below on smaller screens). */}
            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            <div className="flex-1 min-w-0 max-w-3xl xl:order-1">

            {/* Brand info (read-only) */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6">
                <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB] mb-6">{t('brandShell:settings.brandInfo')}</h2>
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandShell:settings.brandName')}</label>
                        <div className="flex items-center h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#666] font-bold">
                            {partnerData.name}
                        </div>
                        <p className="text-[10px] text-[#BBB] mt-1.5">{t('brandShell:settings.brandNameHint')}</p>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('common:states.signedInAs')}</label>
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
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB] mb-3">{t('brandShell:settings.deliveryMethod')}</h2>
                    {/* undefined means the resolve is still in flight (or fell
                        over); only an explicit null means nothing was ever
                        chosen — a live partner must never read "Not chosen yet". */}
                    <div className={`text-sm font-bold ${deliveryMethod === undefined ? 'text-[#BBB]' : 'text-[#1A1A1A]'}`}>
                        {deliveryMethod === undefined
                            ? t('brandShell:settings.checking')
                            : (methodMeta(deliveryMethod)?.label ?? t('brandShell:settings.notChosen'))}
                    </div>
                    <p className="text-[10px] text-[#BBB] mt-1.5">{t('brandShell:settings.deliveryHint')}</p>
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
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">{t('brandShell:settings.changePassword')}</h2>
                </div>
                <form onSubmit={handleChangePassword} className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandShell:settings.currentPassword')}</label>
                        <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={INPUT} required />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandShell:settings.newPassword')}</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={INPUT} required minLength={8} />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandShell:settings.confirmNewPassword')}</label>
                        <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={INPUT} required />
                    </div>
                    <div className="flex justify-end pt-2">
                        <button type="submit" disabled={changingPw} className="h-11 px-8 bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:bg-[#333] transition-all disabled:opacity-50">
                            {changingPw ? t('brandShell:settings.updating') : t('brandShell:settings.updatePassword')}
                        </button>
                    </div>
                </form>
            </div>
            </div>

            {/* ── Sticky help rail: the things this page can't do itself,
                   each with somewhere to go. */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6 mt-6 xl:mt-0">
                <SectionCard icon={LifeBuoy} title={t('brandShell:settings.help.title')}>
                    <p className="text-[12px] text-[#999] leading-relaxed mb-5">
                        {t('brandShell:settings.help.body')}
                    </p>
                    <Link to="/partner/support"
                        className="flex items-center justify-center gap-2 h-11 px-6 bg-[#E8D200] text-[#080808] rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:translate-y-[-1px] transition-all shadow-lg shadow-[#E8D200]/10">
                        <LifeBuoy size={13} /> {t('brandShell:settings.help.contact')}
                    </Link>
                </SectionCard>

                <SectionCard icon={Award} title={t('brandShell:settings.listing.title')}>
                    <p className="text-[12px] text-[#999] leading-relaxed mb-5">
                        {t('brandShell:settings.listing.body')}
                    </p>
                    <Link to="/partner/rewards"
                        className="flex items-center justify-center gap-2 h-11 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all">
                        <Award size={13} /> {t('brandShell:settings.listing.edit')}
                    </Link>
                </SectionCard>
            </aside>
            </div>
        </div>
    );
}
