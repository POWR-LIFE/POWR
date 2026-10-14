import React from 'react';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { rememberProfileLanguage, setPortalLanguage, usePortalLanguage } from '../../lib/i18n';
import { LANGUAGE_NAMES } from '../../../../shared/i18n/index.ts';

/**
 * The portal's language, for the sidebar and the phone menu. Hidden while the
 * portal speaks a single language (it only appears with the translator
 * preview until French and Spanish go live). Each language is listed in its
 * own words, so someone who can't read the current one still finds theirs.
 */
export function LanguagePicker({ userId, className = '' }) {
    const { t } = useTranslation();
    const { available, pick, browser } = usePortalLanguage();
    if (available.length < 2) return null;

    const browserName = LANGUAGE_NAMES[browser] ?? browser;
    const onChange = async (e) => {
        await setPortalLanguage(e.target.value || null);
        rememberProfileLanguage(supabase, userId);
    };

    return (
        <label className={`block px-4 py-3 bg-[#F4F4F1] rounded-2xl border border-[#E6E6E1] ${className}`}>
            <span className="flex items-center gap-2 text-[9px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-1">
                <Languages size={11} aria-hidden /> {t('common:language.label')}
            </span>
            <select
                value={pick && available.includes(pick) ? pick : ''}
                onChange={onChange}
                className="w-full bg-transparent text-[12px] text-[#666] font-bold outline-none cursor-pointer"
            >
                <option value="">{t('common:language.browser', { language: browserName })}</option>
                {available.map((lang) => (
                    <option key={lang} value={lang} lang={lang}>{LANGUAGE_NAMES[lang] ?? lang}</option>
                ))}
            </select>
        </label>
    );
}
