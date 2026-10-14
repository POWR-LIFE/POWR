import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import '../lib/i18n'; // the browser's language (no picker on this page)

// powr.life/s/<code>: where a shop's counter stand lands when someone scans it
// with the phone's own camera instead of from inside the POWR app. The stand
// only means something to the app (it proves the member is in the shop), so
// all this page does is point them there.
export default function StandLanding() {
    const { t } = useTranslation();
    const { code } = useParams();
    useEffect(() => { document.title = t('scan:stand.docTitle'); }, [t]);
    return (
        <div className="min-h-screen bg-[#0d0d0d] text-[#F2F2F2] font-['Outfit'] flex items-center justify-center px-6 py-16">
            <div className="max-w-sm w-full text-center">
                <img src="/powr-logo-white.png" alt="POWR" className="h-8 w-auto mx-auto mb-12" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <p className="text-[10px] font-semibold tracking-[0.3em] text-[#E8D200] mb-4">{t('scan:stand.eyebrow', { code: String(code ?? '').toUpperCase() })}</p>
                <h1 className="text-4xl leading-tight tracking-tight mb-5">
                    <Trans i18nKey="scan:stand.title" components={{ light: <span className="font-extralight" />, gold: <span className="font-bold text-[#E8D200]" /> }} />
                </h1>
                <p className="text-[15px] font-light text-white/65 leading-relaxed mb-10">
                    <Trans i18nKey="scan:stand.body" components={{ strong: <strong className="font-semibold text-white/90" /> }} />
                </p>
                <a href="https://powr.life/app?to=wallet" className="inline-flex items-center justify-center h-12 px-8 rounded-full bg-[#E8D200] text-[#0a0a0a] text-[12px] font-bold tracking-[0.1em] uppercase">{t('scan:stand.openWallet')}</a>
                <p className="text-[12px] text-white/45 mt-6">{t('scan:stand.noApp')}</p>
            </div>
        </div>
    );
}
