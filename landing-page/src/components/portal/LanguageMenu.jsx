import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { rememberProfileLanguage, setPortalLanguage, usePortalLanguage } from '../../lib/i18n';
import { LANGUAGE_NAMES } from '../../../../shared/i18n/index.ts';

/**
 * The portals' language switcher: a globe button showing the current
 * language, opening a list of every language the portal speaks, each in its
 * own words (no flags: a flag is a country, not a language). Sits in the top
 * bar, the phone account sheet and on the sign-in/setup pages. Hidden while
 * the portal speaks only English (with ?lang= it lists the drafts too).
 */
export function LanguageMenu({ userId, align = 'right', className = '' }) {
    const { t } = useTranslation();
    const { available, language } = usePortalLanguage();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (available.length < 2) return null;

    const choose = async (lang) => {
        setOpen(false);
        if (lang === language) return;
        await setPortalLanguage(lang);
        rememberProfileLanguage(supabase, userId);
    };

    return (
        <div ref={ref} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={t('common:language.change', { language: LANGUAGE_NAMES[language] ?? language })}
                className="h-10 pl-3.5 pr-3 inline-flex items-center gap-2 bg-white border border-[#E6E6E1] rounded-full text-[#1A1A1A] hover:border-[#E8D200]/60 transition-colors"
            >
                <Globe size={14} className="text-[#8a7600] shrink-0" aria-hidden />
                <span className="text-[12px] font-bold whitespace-nowrap" lang={language}>{LANGUAGE_NAMES[language] ?? language}</span>
                <ChevronDown size={13} className={`text-[#BBBBBB] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {open && (
                <ul
                    role="listbox"
                    aria-label={t('common:language.label')}
                    className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-2 min-w-[180px] bg-white border border-[#E6E6E1] rounded-2xl shadow-xl p-1.5 z-[200]`}
                >
                    {available.map((lang) => {
                        const current = lang === language;
                        return (
                            <li key={lang} role="option" aria-selected={current}>
                                <button
                                    type="button"
                                    lang={lang}
                                    onClick={() => choose(lang)}
                                    className={`w-full flex items-center justify-between gap-6 px-3.5 py-2.5 rounded-xl text-left text-[13px] font-bold transition-colors ${current ? 'text-[#1A1A1A] bg-[#E8D200]/10' : 'text-[#666] hover:bg-[#F4F4F1] hover:text-[#1A1A1A]'}`}
                                >
                                    {LANGUAGE_NAMES[lang] ?? lang}
                                    {current && <Check size={14} className="text-[#8a7600] shrink-0" aria-hidden />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
