import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronLeft, Upload, Award, Clock, CheckCircle, XCircle, AlertCircle, Eye, X, Mail } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { uploadPublicImage } from '../../lib/storage';
import { useToast } from '../../lib/toast';
import { validateHeroVideoUrl } from '../../lib/heroVideoUrl';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { useAuth } from '../../App';
import RewardAppPreview, { cleanPrefix, prefixFromPromo, previewFromReward, previewValueLabel } from '../../components/RewardAppPreview';

// Option lists hold translation keys; they're translated where they render.
// The values are what's stored, so they never change.
const CATEGORY_OPTIONS = [
    { value: 'food',    label: 'brandRewards:sectors.food' },
    { value: 'gym',     label: 'brandRewards:sectors.gym' },
    { value: 'health',  label: 'brandRewards:sectors.health' },
    { value: 'gear',    label: 'brandRewards:sectors.gear' },
];

const DISCOUNT_OPTIONS = [
    { value: '',             label: 'brandRewards:valueTypes.custom' },
    { value: 'percentage',   label: 'brandRewards:valueTypes.percentage' },
    { value: 'fixed_amount', label: 'brandRewards:valueTypes.fixedAmount' },
];

const STATUS_BADGE = {
    invited:  { label: 'brandRewards:status.draft',    color: 'bg-[#F4F4F1] text-[#666]',          icon: Clock        },
    draft:    { label: 'brandRewards:status.draft',    color: 'bg-[#F4F4F1] text-[#666]',          icon: Clock        },
    pending:  { label: 'brandRewards:status.pending',  color: 'bg-[#E8D200]/10 text-[#8a7600]',    icon: AlertCircle  },
    approved: { label: 'brandRewards:status.approved', color: 'bg-[#10B981]/10 text-[#10B981]',    icon: CheckCircle  },
    rejected: { label: 'brandRewards:status.rejected', color: 'bg-red-500/10 text-red-500',        icon: XCircle      },
};

// lib/heroVideoUrl.js (shared with the admin reward editor) answers in English.
// Its messages are mapped to keys here, so the English text below must match
// that file word for word; a message it gains later simply shows in English.
const HERO_VIDEO_MESSAGE_KEYS = {
    'Enter a full URL starting with https://': 'brandRewards:imagery.videoUrl.notUrl',
    "That's a YouTube/Vimeo-style page link, which can't be a card background. Upload the file, or paste a direct .mp4/.m3u8 link (e.g. Cloudflare Stream).": 'brandRewards:imagery.videoUrl.streamingSite',
    "Saved — but that link doesn't end in .mp4/.m3u8/.webm. If it's a web page rather than a direct video file, the card will just show the image.": 'brandRewards:imagery.videoUrl.notAFile',
};

const INPUT = "w-full h-14 px-5 bg-white border border-[#E6E6E1] rounded-2xl text-sm font-light text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none transition-all font-['Outfit']";

// Fallback cap on how many rewards a brand may have in flight (live + in
// review) before they have to ask us for more. The real per-brand limit comes
// from brand_reward_limits (admin-managed); this is just the default when a
// brand has no row yet. Enforced server-side by the reward-submission trigger.
const DEFAULT_REWARD_LIMIT = 2;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function ImagePicker({ label, preview, uploading, onFile, aspect = 'aspect-video', accept = 'image/*', isVideo = false }) {
    const { t } = useTranslation();
    const ref = useRef(null);
    return (
        <div>
            <p className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">{label}</p>
            <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
            <div
                onClick={() => !uploading && ref.current?.click()}
                className={`${aspect} rounded-2xl border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden transition-colors ${uploading ? 'border-[#E8D200]/40 opacity-60 cursor-not-allowed' : preview ? 'border-[#E6E6E1] hover:border-[#E8D200]/40' : 'border-[#E6E6E1] bg-[#FAFAFA] hover:border-[#E8D200]/40'}`}
            >
                {uploading ? (
                    <div className="w-6 h-6 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                ) : preview ? (
                    isVideo
                        ? <video src={preview} className="w-full h-full object-cover" muted loop autoPlay playsInline preload="auto" />
                        : <img src={preview} alt="" className="w-full h-full object-contain" />
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <Upload size={20} className="text-[#BBBBBB]" />
                        <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#BBB]">{t('brandRewards:imagery.upload')}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

const BLANK_FORM = {
    title: '', description: '', category: 'gym', reward_kind: 'digital',
    discount_type: '', discount_value: '', value_label: '',
    offer: '', partner_blurb: '', terms: '', url: '', code_prefix: '',
    delivery_method: 'code_pool', fulfilment_notes: '', stock: '', max_redemptions_per_user: '',
    logo_url: null, hero_image_url: null, hero_video_url: null,
};

// ── Submission wizard ────────────────────────────────────────────────────────
// The form is split into ordered steps so brands fill it out a section at a
// time instead of facing one long scroll. Each step validates its own required
// fields (see fieldErrors); the "Next" button is blocked and errors surface
// inline until the current step is complete. Steps stay freely clickable — this
// is soft gating, not a locked sequence.
const WIZARD_STEPS = [
    { key: 'offer',   label: 'brandRewards:steps.offer.label',    hint: 'brandRewards:steps.offer.hint' },
    { key: 'details', label: 'brandRewards:steps.details.label',  hint: 'brandRewards:steps.details.hint' },
    { key: 'delivery', label: 'brandRewards:steps.delivery.label', hint: 'brandRewards:steps.delivery.hint' },
    { key: 'imagery', label: 'brandRewards:steps.imagery.label',  hint: 'brandRewards:steps.imagery.hint' },
    { key: 'review',  label: 'brandRewards:steps.review.label',   hint: 'brandRewards:steps.review.hint' },
];

// Which required fields live on each step, and the message shown when missing
// (as a translation key, translated where it renders). Keyed by field so the
// input can highlight itself and the step can tell whether it's complete.
// Kept in one place so validation and the review summary never drift apart.
function fieldErrors(form) {
    const e = {};
    if (!form.title.trim()) e.title = 'brandRewards:errors.title';
    if (!form.description.trim()) e.description = 'brandRewards:errors.description';
    if (form.discount_type) {
        if (!(Number(form.discount_value) > 0)) e.discount_value = 'brandRewards:errors.discountValue';
    } else if (!form.value_label.trim()) {
        e.value_label = 'brandRewards:errors.valueLabel';
    }
    if (!form.offer.trim()) e.offer = 'brandRewards:errors.offer';
    if (!form.partner_blurb.trim()) e.partner_blurb = 'brandRewards:errors.partnerBlurb';
    if (!form.terms.trim()) e.terms = 'brandRewards:errors.terms';
    if (form.delivery_method === 'code_pool' && cleanPrefix(form.code_prefix).length < 2) e.code_prefix = 'brandRewards:errors.codePrefix';
    if (form.delivery_method === 'affiliate' && !form.url.trim()) e.url = 'brandRewards:errors.url';
    if (form.delivery_method === 'manual_fulfilment' && !form.fulfilment_notes.trim()) e.fulfilment_notes = 'brandRewards:errors.fulfilmentNotes';
    if (!form.logo_url) e.logo_url = 'brandRewards:errors.logo';
    if (!form.hero_image_url) e.hero_image_url = 'brandRewards:errors.hero';
    return e;
}

// Required-field keys per step, in order, so a step reports complete/incomplete.
const STEP_FIELDS = {
    offer:   ['title', 'description', 'discount_value', 'value_label'],
    details: ['offer', 'partner_blurb', 'terms'],
    delivery: ['code_prefix', 'url', 'fulfilment_notes'],
    imagery: ['logo_url', 'hero_image_url'],
    review:  [],
};

const previewFromSubmission = (s, partnerName) => ({
    brandName: s.brand_name || partnerName || '',
    title: s.title ?? '',
    description: s.description ?? '',
    partnerBlurb: s.partner_blurb ?? '',
    offer: s.offer ?? '',
    valueLabel: s.value_label ?? '',
    discountType: s.discount_type ?? '',
    discountValue: s.discount_value ?? '',
    pts: null, // points price is set by POWR on approval
    logoUrl: s.image_url,
    heroUrl: s.hero_image_url,
    heroVideoUrl: s.hero_video_url,
    codePrefix: cleanPrefix(s.code_prefix ?? ''),
});

export default function PartnerRewards() {
    const { t } = useTranslation();
    const toast = useToast();
    const { partnerData, user, isAdmin, inStoreEnabled } = useAuth();
    const [rewards, setRewards] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('live'); // live | submissions
    const [formOpen, setFormOpen] = useState(false);
    const [editingSubmission, setEditingSubmission] = useState(null);
    const [editingListing, setEditingListing] = useState(null); // live reward being edited (change request)
    const [form, setForm] = useState(BLANK_FORM);
    const [saving, setSaving] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [uploadingHero, setUploadingHero] = useState(false);
    const [uploadingHeroVideo, setUploadingHeroVideo] = useState(false);
    const [selectedKey, setSelectedKey] = useState(null);
    const [rewardLimit, setRewardLimit] = useState(DEFAULT_REWARD_LIMIT);
    const [limitOpen, setLimitOpen] = useState(false);
    const [contactNote, setContactNote] = useState('');
    const [sendingContact, setSendingContact] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);   // active wizard step
    const [showErrors, setShowErrors] = useState(false); // reveal inline errors after a blocked Next/Submit
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const pageTopRef = useRef(null);

    const brand = partnerData?.brand_name;

    // The rewards, the submissions and the brand's cap all arrive together in
    // fetchAll, so nothing on this page can assert a number until it lands —
    // the tab counts, the N/N counter and the phone rail would otherwise show
    // the empty defaults ("0/2 rewards") and then snap to the truth.
    const ready = !!brand && !loading;

    // Live validation for the open form. errors is keyed by field; a step is
    // "complete" when none of its required fields have an error.
    const errors = fieldErrors(form);
    const step = WIZARD_STEPS[stepIndex];
    const stepComplete = (key) => STEP_FIELDS[key].every(f => !errors[f]);
    const currentStepComplete = stepComplete(step.key);
    const err = (field) => (showErrors && errors[field] ? t(errors[field]) : null);
    const heroVideoText = (message) => (HERO_VIDEO_MESSAGE_KEYS[message] ? t(HERO_VIDEO_MESSAGE_KEYS[message]) : message);
    const sectorLabel = (value) => {
        const option = CATEGORY_OPTIONS.find(o => o.value === value);
        return option ? t(option.label) : value;
    };

    // Count rewards toward the cap: live rewards + any brand-new submission
    // still in review. Listing-update change requests (target_reward_id) and
    // rejected submissions don't count; approved submissions are excluded too
    // because they already exist as a live reward (would otherwise double-count).
    const pendingNewCount = submissions.filter(
        s => !s.target_reward_id && (s.status === 'pending' || s.status === 'invited')
    ).length;
    const rewardCount = rewards.length + pendingNewCount;
    const atLimit = rewardCount >= rewardLimit;

    // Nothing live doesn't mean nothing done — a brand can be waiting on us.
    const reviewCount = submissions.filter(s => s.status === 'pending').length;

    // The previewed item: while the form is open, the phone mirrors the form
    // live; otherwise it shows the clicked row in the active tab (or first row).
    const activeItems = tab === 'live' ? rewards : submissions;
    const selectedItem = activeItems.find(x => `${tab}-${x.id}` === selectedKey) ?? activeItems[0] ?? null;
    const preview = formOpen
        ? {
            brandName: editingSubmission?.brand_name || partnerData?.name || '',
            title: form.title,
            description: form.description,
            partnerBlurb: form.partner_blurb,
            offer: form.offer,
            valueLabel: form.value_label,
            discountType: form.discount_type,
            discountValue: form.discount_value,
            pts: editingListing?.powr_cost ?? null,
            logoUrl: form.logo_url,
            heroUrl: form.hero_image_url,
            heroVideoUrl: form.hero_video_url,
            codePrefix: form.code_prefix,
        }
        : selectedItem
            ? (tab === 'live'
                ? previewFromReward(selectedItem, partnerData?.name)
                : previewFromSubmission(selectedItem, partnerData?.name))
            : null;

    useEffect(() => {
        if (!brand) return;
        fetchAll();
    }, [brand]);

    // The portal scrolls inside the layout's container, so bring the page top
    // back into view when switching between list and form. Opening the form
    // (new, edit listing, or edit submission) always starts on step one with a
    // clean error slate.
    useEffect(() => {
        pageTopRef.current?.scrollIntoView({ block: 'start' });
        if (formOpen) { setStepIndex(0); setShowErrors(false); setLastSavedAt(null); }
    }, [formOpen]);

    // Settled in a finally so a failed fetch still releases the page instead of
    // pinning every surface on its loading state forever.
    const fetchAll = async () => {
        setLoading(true);
        try {
            const [r, s, lim] = await Promise.all([
                supabase.from('rewards').select('*').ilike('brand_name', brand).order('created_at', { ascending: false }),
                supabase.from('reward_submissions').select('*').ilike('brand_name', brand).order('created_at', { ascending: false }),
                supabase.from('brand_reward_limits').select('reward_limit').eq('brand_key', (brand ?? '').trim().toLowerCase()),
            ]);
            if (r.error) throw r.error;
            if (s.error) throw s.error;
            if (lim.error) throw lim.error;
            setRewards(r.data ?? []);
            setSubmissions(s.data ?? []);
            setRewardLimit(lim.data?.[0]?.reward_limit ?? DEFAULT_REWARD_LIMIT);
        } catch (e) {
            console.error('[PartnerRewards]', e);
        } finally {
            setLoading(false);
        }
    };

    // Rewards with a change request already in review (block duplicate edit requests)
    const pendingEditRewardIds = new Set(
        submissions
            .filter(s => s.target_reward_id && (s.status === 'pending' || s.status === 'invited'))
            .map(s => s.target_reward_id)
    );

    const closeForm = () => {
        setFormOpen(false);
        setEditingListing(null);
        setEditingSubmission(null);
    };

    const openNew = () => {
        if (atLimit) { setLimitOpen(true); return; }
        setEditingSubmission(null);
        setEditingListing(null);
        setForm({ ...BLANK_FORM, partner_blurb: partnerData?.name ?? '' });
        setFormOpen(true);
    };

    // Brand has hit the cap and wants more rewards → file a request into the
    // admin support inbox so the team can follow up. Reuses support_tickets
    // (RLS: insert allowed when user_id = auth.uid()).
    const handleGetInTouch = async () => {
        if (!user) { toast.error(t('brandRewards:toasts.signInAgain')); return; }
        setSendingContact(true);
        const note = contactNote.trim();
        // The ticket is read by POWR staff in the admin inbox: it stays English.
        const { error } = await supabase.from('support_tickets').insert({
            user_id: user.id,
            email: user.email ?? '',
            category: 'brand_request',
            subject: `More rewards request — ${brand ?? partnerData?.name ?? 'Brand'}`,
            message:
                `${brand ?? partnerData?.name ?? 'A brand'} has reached the ${rewardLimit}-reward limit `
                + `(${rewardCount} live/in review) and would like to add more.`
                + (note ? `\n\nNote from brand:\n${note}` : ''),
        });
        setSendingContact(false);
        if (error) {
            toast.error(serverErrorText(error));
        } else {
            toast.success(t('brandRewards:toasts.requestSent'));
            setLimitOpen(false);
            setContactNote('');
        }
    };

    // Edit a LIVE reward → prefill from the live listing; submit becomes a change request
    const openEditListing = (r) => {
        setEditingSubmission(null);
        setEditingListing(r);
        setForm({
            title: r.title ?? '',
            description: r.description ?? '',
            category: r.category ?? 'gym',
            reward_kind: r.reward_kind ?? 'digital',
            discount_type: r.discount_type ?? '',
            discount_value: r.discount_value ?? '',
            value_label: r.value_label ?? '',
            offer: r.offer ?? '',
            partner_blurb: r.partner_blurb ?? '',
            terms: r.terms ?? '',
            url: r.url ?? '',
            code_prefix: prefixFromPromo(r.promo_code, r.brand_name || partnerData?.name),
            delivery_method: r.reward_kind === 'physical' ? 'manual_fulfilment' : r.integration_type === 'AFFILIATE' ? 'affiliate' : r.integration_type === 'IN_STORE' ? 'in_store' : 'code_pool',
            fulfilment_notes: '',
            stock: r.stock ?? '',
            max_redemptions_per_user: r.max_redemptions_per_user ?? '',
            logo_url: r.image_url ?? null,
            hero_image_url: r.hero_image_url ?? null,
            hero_video_url: r.hero_video_url ?? null,
        });
        setFormOpen(true);
    };

    const openEdit = (sub) => {
        setEditingListing(null);
        setEditingSubmission(sub);
        setForm({
            title: sub.title ?? '',
            description: sub.description ?? '',
            category: sub.category ?? 'gym',
            reward_kind: sub.reward_kind ?? 'digital',
            discount_type: sub.discount_type ?? '',
            discount_value: sub.discount_value ?? '',
            value_label: sub.value_label ?? '',
            offer: sub.offer ?? '',
            partner_blurb: sub.partner_blurb ?? '',
            terms: sub.terms ?? '',
            url: sub.url ?? '',
            code_prefix: sub.code_prefix ?? '',
            delivery_method: sub.delivery_method ?? (sub.reward_kind === 'physical' ? 'manual_fulfilment' : 'code_pool'),
            fulfilment_notes: sub.fulfilment_notes ?? '',
            stock: sub.stock ?? '',
            max_redemptions_per_user: sub.max_redemptions_per_user ?? '',
            logo_url: sub.image_url ?? null,
            hero_image_url: sub.hero_image_url ?? null,
            hero_video_url: sub.hero_video_url ?? null,
        });
        setFormOpen(true);
    };

    const uploadVideo = async (file) => {
        if (file.size > MAX_VIDEO_BYTES) { toast.error(t('brandRewards:toasts.videoTooLarge')); return null; }
        setUploadingHeroVideo(true);
        try {
            return await uploadPublicImage('reward-submissions', file, 'hero-videos');
        } catch (err) {
            toast.error(serverErrorText(err, t('brandRewards:toasts.uploadFailed')));
            return null;
        } finally {
            setUploadingHeroVideo(false);
        }
    };

    const uploadImage = async (file, kind) => {
        if (file.size > MAX_IMAGE_BYTES) { toast.error(t('brandRewards:toasts.imageTooLarge')); return null; }
        const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingHero;
        setUploading(true);
        try {
            const url = await uploadPublicImage('reward-submissions', file, kind === 'logo' ? 'logos' : 'heroes');
            return url;
        } catch (err) {
            toast.error(serverErrorText(err, t('brandRewards:toasts.uploadFailed')));
            return null;
        } finally {
            setUploading(false);
        }
    };

    const submissionPayload = (status) => ({
        brand_name: brand ?? '',
        status,
        title: form.title.trim() || null,
        description: form.description.trim() || null,
        category: form.category,
        reward_kind: form.reward_kind,
        discount_type: form.discount_type || null,
        discount_value: form.discount_value ? Number(form.discount_value) : null,
        value_label: form.value_label.trim() || null,
        offer: form.offer.trim() || null,
        partner_blurb: form.partner_blurb.trim() || null,
        terms: form.terms.trim() || null,
        url: form.url.trim() || null,
        code_prefix: cleanPrefix(form.code_prefix) || null,
        delivery_method: form.delivery_method,
        fulfilment_notes: form.fulfilment_notes.trim() || null,
        stock: form.stock === '' ? null : Number(form.stock),
        max_redemptions_per_user: form.max_redemptions_per_user === '' ? null : Number(form.max_redemptions_per_user),
        image_url: form.logo_url,
        hero_image_url: form.hero_image_url,
        hero_video_url: form.hero_video_url,
        updated_at: new Date().toISOString(),
        ...(status === 'pending' ? { submitted_at: new Date().toISOString() } : {}),
    });

    const saveDraft = async () => {
        if (!brand) { toast.error(t('brandRewards:toasts.brandLoading')); return false; }
        setSaving(true);
        // Keep an already-submitted reward in review when its owner saves an
        // edit. Drafts and revision requests remain editable work in progress.
        const status = editingSubmission?.status === 'pending' ? 'pending' : 'draft';
        const payload = submissionPayload(status);
        let data;
        let error;
        if (editingSubmission) {
            ({ data, error } = await supabase.from('reward_submissions').update(payload).eq('id', editingSubmission.id).select().single());
        } else {
            ({ data, error } = await supabase.from('reward_submissions').insert({
                ...payload,
                invite_token: crypto.randomUUID(),
                target_reward_id: editingListing?.id ?? null,
            }).select().single());
        }
        setSaving(false);
        if (error) { toast.error(serverErrorText(error)); return false; }
        setEditingSubmission(data);
        setLastSavedAt(new Date());
        toast.success(t(status === 'pending' ? 'brandRewards:toasts.changesSaved' : 'brandRewards:toasts.draftSaved'));
        fetchAll();
        return true;
    };

    const saveAndContinue = async () => {
        if (!currentStepComplete) { setShowErrors(true); return; }
        const saved = await saveDraft();
        if (!saved) return;
        setShowErrors(false);
        setStepIndex(current => Math.min(WIZARD_STEPS.length - 1, current + 1));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        // Final guard: if anything's still missing, reveal inline errors and
        // jump to the first step that has a gap rather than a vague toast.
        const problems = fieldErrors(form);
        if (Object.keys(problems).length) {
            setShowErrors(true);
            const firstBad = WIZARD_STEPS.findIndex(s => !STEP_FIELDS[s.key].every(f => !problems[f]));
            if (firstBad >= 0) setStepIndex(firstBad);
            toast.error(t('brandRewards:toasts.needsAttention'));
            return;
        }

        setSaving(true);
        const payload = submissionPayload('pending');

        let error;
        if (editingSubmission) {
            ({ error } = await supabase.from('reward_submissions').update(payload).eq('id', editingSubmission.id));
        } else {
            ({ error } = await supabase.from('reward_submissions').insert({
                ...payload,
                invite_token: crypto.randomUUID(),
                target_reward_id: editingListing?.id ?? null,
            }));
        }

        if (error) {
            toast.error(serverErrorText(error));
        } else {
            toast.success(t(
                editingListing ? 'brandRewards:toasts.changesSubmitted'
                : editingSubmission ? 'brandRewards:toasts.submissionUpdated'
                : 'brandRewards:toasts.submitted'
            ));
            closeForm();
            fetchAll();
        }
        setSaving(false);
    };

    const tabs = [
        { key: 'live',        label: t('brandRewards:list.tabs.live'),        count: rewards.length },
        { key: 'submissions', label: t('brandRewards:list.tabs.submissions'), count: submissions.length },
    ];

    return (
        <div ref={pageTopRef} className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 items-start">
            <div>
            {formOpen ? (
                /* ── Inline form view ──────────────────────────────────────── */
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <button
                        type="button"
                        onClick={closeForm}
                        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-[#999] hover:text-[#8a7600] transition-colors mb-8"
                    >
                        <ChevronLeft size={14} /> {t('brandRewards:form.backToList')}
                    </button>
                    <div className="mb-10">
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-3">
                            {t(editingListing ? 'brandRewards:form.titleEditListing' : editingSubmission ? 'brandRewards:form.titleEditSubmission' : 'brandRewards:form.titleNew')}
                        </h1>
                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">
                            {t(editingListing
                                ? 'brandRewards:form.subtitleEditListing'
                                : 'brandRewards:form.subtitleNew')}
                        </p>
                            {lastSavedAt && <p className="mt-3 text-[10px] uppercase tracking-[0.25em] text-[#10B981] font-black">{t('brandRewards:form.savedAt', { time: lastSavedAt.toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' }) })}</p>}
                    </div>

                    <form onSubmit={handleSave} className="bg-white border border-[#E6E6E1] rounded-3xl p-10">
                        {/* Step rail — one section at a time. Steps stay clickable
                            (soft gating); a green tick marks a completed step. */}
                        <div className="flex items-stretch gap-2 mb-4 overflow-x-auto pb-1">
                            {WIZARD_STEPS.map((s, i) => {
                                const active = i === stepIndex;
                                const done = stepComplete(s.key) && i !== stepIndex;
                                return (
                                    <button
                                        key={s.key}
                                        type="button"
                                        onClick={() => setStepIndex(i)}
                                        className={`group flex-1 min-w-[8.5rem] text-left px-4 py-3 rounded-2xl border transition-all ${active ? 'border-[#E8D200] bg-[#E8D200]/10' : 'border-[#EDEDEA] bg-white hover:border-[#DDD]'}`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black shrink-0 ${active ? 'bg-[#E8D200] text-[#080808]' : done ? 'bg-[#10B981] text-white' : 'bg-[#F0F0EC] text-[#AAA]'}`}>
                                                {done ? <CheckCircle size={12} /> : i + 1}
                                            </span>
                                            <span className={`text-[10px] uppercase tracking-[0.2em] font-black truncate ${active ? 'text-[#8a7600]' : 'text-[#888]'}`}>{t(s.label)}</span>
                                        </div>
                                        <p className="text-[9px] uppercase tracking-[0.2em] font-black text-[#BBB] truncate pl-7">{t(s.hint)}</p>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="h-1 w-full bg-[#F0F0EC] rounded-full overflow-hidden mb-10">
                            <div className="h-full bg-[#E8D200] transition-all duration-500" style={{ width: `${((stepIndex + 1) / WIZARD_STEPS.length) * 100}%` }} />
                        </div>

                        {/* ── Step 1 · The Offer ── */}
                        {step.key === 'offer' && (
                        <section className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-300">
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:offer.titleLabel')}</label>
                                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder={t('brandRewards:offer.titlePlaceholder')} maxLength={60} className={`${INPUT} ${err('title') ? 'border-red-400' : ''}`} />
                                {err('title') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('title')}</p>}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:offer.descriptionLabel')}</label>
                                <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder={t('brandRewards:offer.descriptionPlaceholder')} maxLength={80} className={`${INPUT} ${err('description') ? 'border-red-400' : ''}`} />
                                {err('description') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('description')}</p>}
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:offer.valueTypeLabel')}</label>
                                    <select value={form.discount_type} onChange={e => setForm(p => ({ ...p, discount_type: e.target.value }))} className={INPUT}>
                                        {DISCOUNT_OPTIONS.map(o => <option key={o.value || 'x'} value={o.value}>{t(o.label)}</option>)}
                                    </select>
                                </div>
                                {form.discount_type ? (
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t(form.discount_type === 'percentage' ? 'brandRewards:offer.percentOffLabel' : 'brandRewards:offer.amountOffLabel')}</label>
                                        <input type="number" min="0" value={form.discount_value} onChange={e => setForm(p => ({ ...p, discount_value: e.target.value }))} placeholder={form.discount_type === 'percentage' ? '30' : '20'} className={`${INPUT} ${err('discount_value') ? 'border-red-400' : ''}`} />
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:offer.valueLabelLabel')}</label>
                                        <input value={form.value_label} onChange={e => setForm(p => ({ ...p, value_label: e.target.value }))} placeholder={t('brandRewards:offer.valueLabelPlaceholder')} className={`${INPUT} ${err('value_label') ? 'border-red-400' : ''}`} />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:offer.sectorLabel')}</label>
                                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={INPUT}>
                                        {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                                    </select>
                                </div>
                            </div>
                            {(err('discount_value') || err('value_label')) && <p className="text-[10px] font-black text-red-500 tracking-[0.1em]">{err('discount_value') || err('value_label')}</p>}
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:offer.rewardTypeLabel')}</label>
                                <div className="flex gap-3">
                                    {[['digital', t('brandRewards:offer.digital')], ['physical', t('brandRewards:offer.physical')]].map(([val, lbl]) => (
                                        <button key={val} type="button" onClick={() => setForm(p => ({ ...p, reward_kind: val, delivery_method: val === 'physical' ? 'manual_fulfilment' : (p.delivery_method === 'manual_fulfilment' ? 'code_pool' : p.delivery_method) }))}
                                            className={`flex-1 h-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.15em] border transition-all ${form.reward_kind === val ? 'border-[#E8D200]/60 bg-[#E8D200]/10 text-[#8a7600]' : 'border-[#DDD] bg-white text-[#888] hover:text-[#444]'}`}>
                                            {lbl}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </section>
                        )}

                        {/* ── Step 2 · Details & Terms ── */}
                        {step.key === 'details' && (
                        <section className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-300">
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:details.offerLabel')}</label>
                                <textarea value={form.offer} onChange={e => setForm(p => ({ ...p, offer: e.target.value }))} rows={2} placeholder={t('brandRewards:details.offerPlaceholder')} className={`${INPUT} h-auto py-4 resize-none ${err('offer') ? 'border-red-400' : ''}`} />
                                {err('offer') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('offer')}</p>}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:details.blurbLabel')}</label>
                                <textarea value={form.partner_blurb} onChange={e => setForm(p => ({ ...p, partner_blurb: e.target.value }))} rows={2} placeholder={t('brandRewards:details.blurbPlaceholder')} className={`${INPUT} h-auto py-4 resize-none ${err('partner_blurb') ? 'border-red-400' : ''}`} />
                                {err('partner_blurb') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('partner_blurb')}</p>}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:details.termsLabel')}</label>
                                <textarea value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} rows={2} placeholder={t('brandRewards:details.termsPlaceholder')} className={`${INPUT} h-auto py-4 resize-none ${err('terms') ? 'border-red-400' : ''}`} />
                                {err('terms') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('terms')}</p>}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2"><Trans i18nKey="brandRewards:details.websiteLabel" components={{ muted: <span className="text-[#BBB] normal-case tracking-normal ml-1" /> }} /></label>
                                <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder={t('brandRewards:details.websitePlaceholder')} className={INPUT} />
                            </div>
                        </section>
                        )}

                        {/* ── Step 3 · Delivery ── */}
                        {step.key === 'delivery' && (
                        <section className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
                            {form.reward_kind === 'digital' ? (
                                <>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:delivery.methodLabel')}</label>
                                        <div className={`grid grid-cols-1 gap-3 ${isAdmin || inStoreEnabled ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                                            {[
                                                ['code_pool', t('brandRewards:delivery.codePool.label'), t('brandRewards:delivery.codePool.detail')],
                                                ['affiliate', t('brandRewards:delivery.affiliate.label'), t('brandRewards:delivery.affiliate.detail')],
                                                ...(isAdmin || inStoreEnabled ? [['in_store', t('brandRewards:delivery.inStore.label'), t('brandRewards:delivery.inStore.detail')]] : []),
                                            ].map(([value, label, detail]) => (
                                                <button key={value} type="button" onClick={() => setForm(p => ({ ...p, delivery_method: value }))} className={`text-left p-4 rounded-2xl border transition-all ${form.delivery_method === value ? 'border-[#E8D200] bg-[#E8D200]/10' : 'border-[#E6E6E1] bg-white hover:border-[#DDD]'}`}>
                                                    <span className={`block text-[10px] font-black uppercase tracking-[0.2em] ${form.delivery_method === value ? 'text-[#8a7600]' : 'text-[#666]'}`}>{label}</span>
                                                    <span className="block text-[10px] text-[#999] mt-2 leading-relaxed">{detail}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {form.delivery_method === 'code_pool' ? <>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:delivery.codeNameLabel')}</label>
                                            <input value={form.code_prefix} onChange={e => setForm(p => ({ ...p, code_prefix: cleanPrefix(e.target.value) }))} placeholder={t('brandRewards:delivery.codeNamePlaceholder')} maxLength={8} className={`${INPUT} uppercase tracking-[0.2em] ${err('code_prefix') ? 'border-red-400' : ''}`} />
                                            {err('code_prefix') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('code_prefix')}</p>}
                                        </div>
                                        <div className="p-5 rounded-2xl border border-[#E8D200]/40 bg-[#E8D200]/5">
                                            <p className="text-[9px] uppercase tracking-[0.3em] font-black text-[#777] mb-2">{t('brandRewards:delivery.membersReceive')}</p>
                                            <div className="font-mono text-lg tracking-[0.12em] text-[#1A1A1A]">POWR-<span className="text-[#8a7600]">{form.code_prefix || t('brandRewards:delivery.codeSample')}</span>-<span className="text-[#AAA]">A1B2C3</span></div>
                                        </div>
                                    </> : form.delivery_method === 'in_store' ? (
                                        <div className="p-5 rounded-2xl border border-[#E8D200]/40 bg-[#E8D200]/5">
                                            <p className="text-[9px] uppercase tracking-[0.3em] font-black text-[#777] mb-2">{t('brandRewards:delivery.atYourTill')}</p>
                                            <p className="text-sm text-[#1A1A1A] font-light leading-relaxed">{t('brandRewards:delivery.inStoreBody')}</p>
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:delivery.affiliateUrlLabel')}</label>
                                            <input type="url" value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder={t('brandRewards:delivery.affiliateUrlPlaceholder')} className={`${INPUT} ${err('url') ? 'border-red-400' : ''}`} />
                                            {err('url') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('url')}</p>}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:delivery.fulfilmentLabel')}</label>
                                    <textarea value={form.fulfilment_notes} onChange={e => setForm(p => ({ ...p, fulfilment_notes: e.target.value }))} rows={3} placeholder={t('brandRewards:delivery.fulfilmentPlaceholder')} className={`${INPUT} h-auto py-4 resize-none ${err('fulfilment_notes') ? 'border-red-400' : ''}`} />
                                    {err('fulfilment_notes') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('fulfilment_notes')}</p>}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2"><Trans i18nKey="brandRewards:delivery.stockLabel" components={{ muted: <span className="normal-case tracking-normal text-[#BBB]" /> }} /></label>
                                    <input type="number" min="0" value={form.stock} onChange={e => setForm(p => ({ ...p, stock: e.target.value }))} placeholder={t('brandRewards:delivery.unlimited')} className={INPUT} />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2"><Trans i18nKey="brandRewards:delivery.perMemberLabel" components={{ muted: <span className="normal-case tracking-normal text-[#BBB]" /> }} /></label>
                                    <input type="number" min="1" value={form.max_redemptions_per_user} onChange={e => setForm(p => ({ ...p, max_redemptions_per_user: e.target.value }))} placeholder={t('brandRewards:delivery.unlimited')} className={INPUT} />
                                </div>
                            </div>
                        </section>
                        )}

                        {/* ── Step 4 · Imagery ── */}
                        {step.key === 'imagery' && (
                        <section className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <ImagePicker
                                        label={t('brandRewards:imagery.logoLabel')}
                                        preview={form.logo_url}
                                        uploading={uploadingLogo}
                                        aspect="aspect-square"
                                        onFile={async (file) => { const url = await uploadImage(file, 'logo'); if (url) setForm(p => ({ ...p, logo_url: url })); }}
                                    />
                                    {err('logo_url') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('logo_url')}</p>}
                                </div>
                                <div>
                                    <ImagePicker
                                        label={t('brandRewards:imagery.heroLabel')}
                                        preview={form.hero_image_url}
                                        uploading={uploadingHero}
                                        aspect="aspect-video"
                                        onFile={async (file) => { const url = await uploadImage(file, 'hero'); if (url) setForm(p => ({ ...p, hero_image_url: url })); }}
                                    />
                                    {err('hero_image_url') && <p className="mt-2 text-[10px] font-black text-red-500 tracking-[0.1em]">{err('hero_image_url')}</p>}
                                </div>
                                <div className="col-span-2">
                                    <ImagePicker
                                        label={t('brandRewards:imagery.videoLabel')}
                                        preview={form.hero_video_url}
                                        uploading={uploadingHeroVideo}
                                        aspect="aspect-video"
                                        accept="video/mp4,video/quicktime,video/webm"
                                        isVideo
                                        onFile={async (file) => { const url = await uploadVideo(file); if (url) setForm(p => ({ ...p, hero_video_url: url })); }}
                                    />
                                    {form.hero_video_url && (
                                        <button type="button" onClick={() => setForm(p => ({ ...p, hero_video_url: null }))} className="mt-2 text-[10px] uppercase tracking-[0.2em] text-[#999] hover:text-red-500 transition-colors font-black">{t('brandRewards:imagery.removeVideo')}</button>
                                    )}
                                    {/* Or paste a direct video-file URL instead of uploading (own CDN /
                                        Cloudflare Stream). Bound to hero_video_url so it also live-previews;
                                        validated on blur so streaming-site links are rejected. */}
                                    <input
                                        type="url"
                                        placeholder={t('brandRewards:imagery.videoUrlPlaceholder')}
                                        className="mt-3 w-full h-11 px-5 bg-white border border-[#E6E6E1] rounded-full focus:border-[#E8D200] outline-none transition-all text-[11px] font-bold text-[#1A1A1A] placeholder-[#BBB] tracking-[0.05em]"
                                        value={form.hero_video_url || ''}
                                        onChange={e => setForm(p => ({ ...p, hero_video_url: e.target.value }))}
                                        onBlur={e => {
                                            const res = validateHeroVideoUrl(e.target.value);
                                            if (res.error) { toast.error(heroVideoText(res.error)); setForm(p => ({ ...p, hero_video_url: null })); return; }
                                            setForm(p => ({ ...p, hero_video_url: res.value || null }));
                                            if (res.warn) toast.info(heroVideoText(res.warn));
                                        }}
                                    />
                                    <p className="mt-2 text-[9px] uppercase tracking-[0.2em] text-[#AAA] font-black">{t('brandRewards:imagery.videoUrlHint')}</p>
                                </div>
                            </div>
                        </section>
                        )}

                        {/* ── Step 5 · Review ── */}
                        {step.key === 'review' && (
                        <section className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
                            <p className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black">{t('brandRewards:review.intro')}</p>
                            <div className="rounded-2xl border border-[#EDEDEA] divide-y divide-[#F0F0EC]">
                                {/* Labels translate; the brand's own words show as typed. The Value
                                    row is the app's display string (previewValueLabel), English
                                    like the phone preview beside it. */}
                                {[
                                    [t('brandRewards:review.rows.title'), form.title],
                                    [t('brandRewards:review.rows.description'), form.description],
                                    [t('brandRewards:review.rows.value'), previewValueLabel({ valueLabel: form.value_label, discountType: form.discount_type, discountValue: form.discount_value }) || '—'],
                                    [t('brandRewards:review.rows.sector'), sectorLabel(form.category)],
                                    [t('brandRewards:review.rows.rewardType'), t(form.reward_kind === 'physical' ? 'brandRewards:offer.physical' : 'brandRewards:offer.digital')],
                                    [t('brandRewards:review.rows.offer'), form.offer],
                                    [t('brandRewards:review.rows.about'), form.partner_blurb],
                                    [t('brandRewards:review.rows.terms'), form.terms],
                                    [t('brandRewards:review.rows.website'), form.url || '—'],
                                    [t('brandRewards:review.rows.delivery'), form.delivery_method === 'code_pool' ? t('brandRewards:review.deliveryCode', { code: `POWR-${cleanPrefix(form.code_prefix) || t('brandRewards:delivery.codeSample')}-A1B2C3` }) : form.delivery_method === 'affiliate' ? t('brandRewards:review.deliveryAffiliate') : form.delivery_method === 'in_store' ? t('brandRewards:review.deliveryInStore') : t('brandRewards:review.deliveryManual')],
                                    ...(form.fulfilment_notes ? [[t('brandRewards:review.rows.fulfilment'), form.fulfilment_notes]] : []),
                                    [t('brandRewards:review.rows.imagery'), [form.logo_url && t('brandRewards:review.imageryLogo'), form.hero_image_url && t('brandRewards:review.imageryHero'), form.hero_video_url && t('brandRewards:review.imageryVideo')].filter(Boolean).join(' · ') || '—'],
                                ].map(([k, v]) => (
                                    <div key={k} className="flex gap-4 px-5 py-3">
                                        <span className="w-32 shrink-0 text-[9px] uppercase tracking-[0.25em] font-black text-[#AAA] pt-0.5">{k}</span>
                                        <span className="text-sm text-[#1A1A1A] font-light break-words min-w-0">{v}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[10px] text-[#BBB] font-black leading-relaxed">
                                {t(editingListing
                                    ? 'brandRewards:review.noteEditListing'
                                    : 'brandRewards:review.noteNew')}
                            </p>
                        </section>
                        )}

                        {/* Footer nav — Back / Next through the steps, Submit on the last. */}
                        <div className="flex items-center justify-between gap-6 pt-8 mt-10 border-t border-[#E6E6E1]">
                            <button
                                type="button"
                                onClick={() => (stepIndex === 0 ? closeForm() : setStepIndex(stepIndex - 1))}
                                className="h-12 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors"
                            >
                                {stepIndex === 0 ? t('common:actions.cancel') : t('brandRewards:form.back')}
                            </button>
                            {step.key === 'review' ? (
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={saveDraft} disabled={saving || uploadingLogo || uploadingHero || uploadingHeroVideo} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors disabled:opacity-50">{t('brandRewards:form.saveDraft')}</button>
                                    <button type="submit" disabled={saving || uploadingLogo || uploadingHero || uploadingHeroVideo} className="h-12 px-10 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-50">
                                        {t(saving ? 'brandRewards:form.submitting' : editingListing ? 'brandRewards:form.submitChanges' : editingSubmission?.status === 'rejected' ? 'brandRewards:form.resubmit' : editingSubmission ? 'brandRewards:form.updateSubmission' : 'brandRewards:form.submitForReview')}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={saveDraft} disabled={saving || uploadingLogo || uploadingHero || uploadingHeroVideo} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors disabled:opacity-50">{t('brandRewards:form.saveDraft')}</button>
                                    <button
                                        type="button"
                                        onClick={saveAndContinue}
                                        disabled={saving || uploadingLogo || uploadingHero || uploadingHeroVideo}
                                        className="h-12 px-10 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-50"
                                    >
                                        {t(saving ? 'brandRewards:form.saving' : 'brandRewards:form.saveAndContinue')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </form>
                </div>
            ) : (
                /* ── List view ─────────────────────────────────────────────── */
                <>
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#10B981]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">{t('brandRewards:list.eyebrow')}</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">{t('brandRewards:list.title')}</h1>
            </div>

            {/* Tabs + submit */}
            <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
                <div className="flex gap-2 bg-white border border-[#E6E6E1] rounded-[2rem] p-2 w-fit">
                    {tabs.map(item => (
                        <button
                            key={item.key}
                            onClick={() => setTab(item.key)}
                            className={`h-10 px-6 rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${tab === item.key ? 'bg-[#E8D200] text-[#080808]' : 'text-[#555] hover:text-[#222]'}`}
                        >
                            {item.label}
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${tab === item.key ? 'bg-[#1A1A1A]/10' : 'bg-[#F4F4F1]'}`}>{ready ? item.count : '—'}</span>
                        </button>
                    ))}
                </div>
                {/* The count, the cap and which job the button does all come
                    from the same fetch — showing any of them early tells an
                    at-limit brand it can submit, and the wizard then refuses. */}
                <div className="flex items-center gap-4">
                    {ready ? (
                        <>
                            <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${atLimit ? 'text-[#8a7600]' : 'text-[#BBB]'}`}>
                                {t(atLimit ? 'brandRewards:list.counterAtLimit' : 'brandRewards:list.counter', { used: rewardCount, limit: rewardLimit })}
                            </span>
                            <button
                                onClick={openNew}
                                className="flex items-center gap-3 h-12 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20"
                            >
                                {atLimit ? <><Mail size={15} /> {t('brandRewards:list.requestMore')}</> : <><Plus size={15} /> {t('brandRewards:list.submitReward')}</>}
                            </button>
                        </>
                    ) : (
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BBB]">{t('brandRewards:list.checking')}</span>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {!ready ? (
                    <div className="flex items-center justify-center py-24">
                        <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : tab === 'live' ? (
                    rewards.length === 0 ? (
                        /* A brand waiting on approval has already done the thing
                           the first-run panel asks for, and its submissions may
                           have filled the cap — so the prompt would only open the
                           limit modal. Tell it where its work actually is. */
                        submissions.length > 0 ? (
                            <div className="py-24 text-center">
                                <Clock size={32} className="text-[#E6E6E1] mx-auto mb-4" />
                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black mb-2">
                                    {t(reviewCount > 0 ? 'brandRewards:list.withPowr' : 'brandRewards:list.nothingLive')}
                                </p>
                                <p className="text-xs text-[#BBBBBB] mb-6">
                                    {reviewCount > 0
                                        ? t('brandRewards:list.inReview', { count: reviewCount })
                                        : t('brandRewards:list.workInProgress')}
                                </p>
                                <button onClick={() => setTab('submissions')} className="h-10 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all">
                                    {t('brandRewards:list.viewSubmissions')}
                                </button>
                            </div>
                        ) : (
                            <div className="py-24 text-center">
                                <Award size={32} className="text-[#E6E6E1] mx-auto mb-4" />
                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black mb-2">{t('brandRewards:list.noLiveRewards')}</p>
                                <p className="text-xs text-[#BBBBBB] mb-6">{t('brandRewards:list.noLiveRewardsBody')}</p>
                                {!atLimit && (
                                    <button onClick={openNew} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/15">
                                        {t('brandRewards:list.submitFirst')}
                                    </button>
                                )}
                            </div>
                        )
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    {['brandRewards:list.columns.reward', 'brandRewards:list.columns.category', 'brandRewards:list.columns.cost', 'brandRewards:list.columns.status', ''].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.4em] text-[#888]">{h && t(h)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {rewards.map(r => (
                                    <tr
                                        key={r.id}
                                        onClick={() => setSelectedKey(`live-${r.id}`)}
                                        className={`group cursor-pointer transition-colors ${selectedItem?.id === r.id ? 'bg-[#E8D200]/5' : 'hover:bg-[#FAFAFA]'}`}
                                    >
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-4">
                                                {r.image_url ? (
                                                    <img src={r.image_url} alt="" className="w-10 h-10 rounded-xl object-contain border border-[#E6E6E1] p-1" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                                                        <Award size={16} className="text-[#BBBBBB]" />
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="text-sm font-bold text-[#222]">{r.title}</div>
                                                    <div className="text-[10px] text-[#BBB] font-black uppercase tracking-wider">{r.description}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            {/* English shows the stored category as is; other languages get its sector name. */}
                                            <span className="px-3 py-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase font-black tracking-[0.3em] text-[#666]">{r.category ? t(`brandRewards:list.categoryValue.${r.category}`, { defaultValue: r.category }) : r.category}</span>
                                        </td>
                                        <td className="px-6 py-5 text-sm font-bold text-[#222]">{t('brandRewards:list.pts', { points: r.powr_cost?.toLocaleString(formatLocale()) ?? '' })}</td>
                                        <td className="px-6 py-5">
                                            <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] w-fit ${r.active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#F4F4F1] text-[#BBBBBB]'}`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${r.active ? 'bg-[#10B981] animate-pulse' : 'bg-[#BBBBBB]'}`} />
                                                {t(r.active ? 'brandRewards:status.live' : 'brandRewards:status.inactive')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            {/* Stacked: the table shares the page with the phone preview, so two pills side by side don't fit. */}
                                            <div className="inline-flex flex-col items-end gap-2">
                                                {/* The Studio, opened on this reward's voucher. */}
                                                <Link
                                                    to={`/partner/studio?reward=${r.id}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="inline-flex items-center h-9 px-5 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all"
                                                >
                                                    {t('brandRewards:list.makePost')}
                                                </Link>
                                                {pendingEditRewardIds.has(r.id) ? (
                                                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-[#8a7600]">
                                                        <Clock size={10} /> {t('brandRewards:list.updateInReview')}
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); openEditListing(r); }}
                                                        className="h-9 px-5 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all"
                                                    >
                                                        {t('brandRewards:list.editListing')}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                ) : (
                    submissions.length === 0 ? (
                        <div className="py-24 text-center">
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">{t('brandRewards:list.noSubmissions')}</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    {['brandRewards:list.columns.reward', 'brandRewards:list.columns.status', 'brandRewards:list.columns.submitted', ''].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.4em] text-[#888]">{h && t(h)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {submissions.map(s => {
                                    const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.pending;
                                    const BadgeIcon = badge.icon;
                                    const canEdit = s.status === 'draft' || s.status === 'pending' || s.status === 'invited' || s.status === 'rejected';
                                    return (
                                        <tr
                                            key={s.id}
                                            onClick={() => setSelectedKey(`submissions-${s.id}`)}
                                            className={`group cursor-pointer transition-colors ${selectedItem?.id === s.id ? 'bg-[#E8D200]/5' : 'hover:bg-[#FAFAFA]'}`}
                                        >
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-bold text-[#222]">{s.title || <span className="text-[#BBB] italic">{t('brandRewards:list.untitled')}</span>}</span>
                                                    {s.target_reward_id && (
                                                        <span className="px-2.5 py-0.5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 rounded-full text-[8px] font-black uppercase tracking-[0.2em] text-[#8B5CF6]">{t('brandRewards:list.listingUpdate')}</span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-[#BBB] font-black uppercase tracking-wider mt-0.5">{s.description}</div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] w-fit border border-current/20 ${badge.color}`}>
                                                    <BadgeIcon size={10} />
                                                    {t(badge.label)}
                                                </span>
                                                {s.partner_feedback && (
                                                    // The feedback itself is POWR staff's words, shown as written.
                                                    <p className="text-[10px] text-red-500 mt-2 max-w-xs leading-relaxed">{t('brandRewards:list.feedback', { feedback: s.partner_feedback })}</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-5 text-[11px] text-[#BBB] font-black">
                                                {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                            </td>
                                            <td className="px-6 py-5 text-right">
                                                {canEdit && (
                                                    <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="h-9 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all">
                                                        {t(s.status === 'rejected' ? 'brandRewards:list.revise' : s.status === 'draft' ? 'brandRewards:list.continue' : 'brandRewards:list.edit')}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )
                )}
            </div>
                </>
            )}
            </div>

            {/* Sticky phone preview — mirrors the form while editing, else the selected row */}
            <div className="hidden lg:block self-start sticky top-6">
                <div>
                    {/* "Select a reward" is only true once we know there are
                        rows to select — before that it's a guess, and for a
                        brand with none it's an instruction it can't follow. */}
                    {!ready ? (
                        <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl p-12 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        </div>
                    ) : preview ? (
                        <RewardAppPreview key={formOpen ? 'form' : `${tab}-${selectedItem?.id}`} pageTheme="light" {...preview} />
                    ) : rewards.length + submissions.length === 0 ? (
                        <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl p-12 text-center">
                            <Eye size={24} className="text-[#DDDDDD] mx-auto mb-4" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black leading-relaxed mb-3">
                                {t('brandRewards:preview.nothingYet')}
                            </p>
                            <p className="text-[11px] text-[#BBBBBB] leading-relaxed mb-6">
                                {t('brandRewards:preview.nothingYetBody')}
                            </p>
                            {!atLimit && (
                                <button type="button" onClick={openNew} className="inline-flex items-center gap-2 h-10 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all">
                                    <Plus size={13} /> {t('brandRewards:preview.submit')}
                                </button>
                            )}
                        </div>
                    ) : (
                        // The brand does have rows — this tab just has none of
                        // them, so the instruction is still the right one.
                        <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl p-12 text-center">
                            <Eye size={24} className="text-[#DDDDDD] mx-auto mb-4" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black leading-relaxed">
                                <Trans i18nKey="brandRewards:preview.select" components={{ nl: <br /> }} />
                            </p>
                        </div>
                    )}
                </div>
            </div>
            </div>

            {/* ── Reward-limit / "get in touch" modal ── */}
            {limitOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={() => !sendingContact && setLimitOpen(false)}>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-8 border-b border-[#E6E6E1]">
                            <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A]">{t('brandRewards:limit.title')}</h2>
                            <button onClick={() => setLimitOpen(false)} disabled={sendingContact} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#999] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"><X size={16} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <p className="text-sm text-[#666] font-light leading-relaxed">
                                <Trans i18nKey="brandRewards:limit.body" count={rewardLimit} components={{ strong: <span className="font-bold text-[#1A1A1A]" /> }} />
                            </p>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandRewards:limit.noteLabel')}</label>
                                <textarea
                                    value={contactNote}
                                    onChange={e => setContactNote(e.target.value)}
                                    rows={3}
                                    placeholder={t('brandRewards:limit.notePlaceholder')}
                                    className={`${INPUT} h-auto py-4 resize-none`}
                                />
                            </div>
                            <div className="flex justify-end gap-4 pt-2">
                                <button type="button" onClick={() => setLimitOpen(false)} disabled={sendingContact} className="h-12 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors disabled:opacity-50">{t('common:actions.cancel')}</button>
                                <button
                                    type="button"
                                    onClick={handleGetInTouch}
                                    disabled={sendingContact}
                                    className="flex items-center gap-3 h-12 px-10 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-50 disabled:translate-y-0"
                                >
                                    {sendingContact
                                        ? <div className="w-4 h-4 border-2 border-[#080808]/30 border-t-[#080808] rounded-full animate-spin" />
                                        : <Mail size={14} />}
                                    {t(sendingContact ? 'brandRewards:limit.sending' : 'brandRewards:limit.getInTouch')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
