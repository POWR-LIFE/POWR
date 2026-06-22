import React, { useEffect, useRef, useState } from 'react';
import { Plus, ChevronLeft, Upload, Award, Clock, CheckCircle, XCircle, AlertCircle, Eye, X, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadPublicImage } from '../../lib/storage';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import RewardAppPreview from '../../components/RewardAppPreview';

const CATEGORY_OPTIONS = [
    { value: 'food',    label: 'Eat' },
    { value: 'gym',     label: 'Move' },
    { value: 'health',  label: 'Mind' },
    { value: 'gear',    label: 'Sleep' },
];

const DISCOUNT_OPTIONS = [
    { value: '',             label: 'Custom text' },
    { value: 'percentage',   label: '% off' },
    { value: 'fixed_amount', label: '£ off' },
];

const STATUS_BADGE = {
    invited:  { label: 'Draft',    color: 'bg-[#F4F4F1] text-[#666]',          icon: Clock        },
    pending:  { label: 'Review',   color: 'bg-[#E8D200]/10 text-[#8a7600]',    icon: AlertCircle  },
    approved: { label: 'Approved', color: 'bg-[#10B981]/10 text-[#10B981]',    icon: CheckCircle  },
    rejected: { label: 'Rejected', color: 'bg-red-500/10 text-red-500',        icon: XCircle      },
};

const INPUT = "w-full h-14 px-5 bg-white border border-[#E6E6E1] rounded-2xl text-sm font-light text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none transition-all font-['Outfit']";

// Fallback cap on how many rewards a brand may have in flight (live + in
// review) before they have to ask us for more. The real per-brand limit comes
// from brand_reward_limits (admin-managed); this is just the default when a
// brand has no row yet. Enforced server-side by the reward-submission trigger.
const DEFAULT_REWARD_LIMIT = 2;

function cleanPrefix(raw) {
    return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function ImagePicker({ label, preview, uploading, onFile, aspect = 'aspect-video' }) {
    const ref = useRef(null);
    return (
        <div>
            <p className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">{label}</p>
            <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
            <div
                onClick={() => !uploading && ref.current?.click()}
                className={`${aspect} rounded-2xl border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden transition-colors ${uploading ? 'border-[#E8D200]/40 opacity-60 cursor-not-allowed' : preview ? 'border-[#E6E6E1] hover:border-[#E8D200]/40' : 'border-[#E6E6E1] bg-[#FAFAFA] hover:border-[#E8D200]/40'}`}
            >
                {uploading ? (
                    <div className="w-6 h-6 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                ) : preview ? (
                    <img src={preview} alt="" className="w-full h-full object-contain" />
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <Upload size={20} className="text-[#BBBBBB]" />
                        <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#BBB]">Upload</span>
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
    logo_url: null, hero_image_url: null,
};

// Extract the brand segment from a stored promo code: 'POWR-TRIBE' / 'POWR-TRIBE-XXXXXX' / 'TRIBE' → 'TRIBE'
function prefixFromPromo(promo, fallbackName) {
    const parts = String(promo ?? '').toUpperCase().split('-').filter(Boolean);
    if (parts[0] === 'POWR') parts.shift();
    return cleanPrefix(parts[0] ?? fallbackName ?? '');
}

const previewFromReward = (r, partnerName) => ({
    brandName: r.brand_name || partnerName || '',
    title: r.title ?? '',
    description: r.description ?? '',
    partnerBlurb: r.partner_blurb ?? '',
    offer: r.offer ?? '',
    valueLabel: r.value_label ?? '',
    discountType: r.discount_type ?? '',
    discountValue: r.discount_value ?? '',
    pts: r.powr_cost,
    logoUrl: r.image_url,
    heroUrl: r.hero_image_url,
    codePrefix: prefixFromPromo(r.promo_code, r.brand_name || partnerName),
});

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
    codePrefix: cleanPrefix(s.code_prefix ?? ''),
});

export default function PartnerRewards() {
    const toast = useToast();
    const { partnerData, user } = useAuth();
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
    const [selectedKey, setSelectedKey] = useState(null);
    const [rewardLimit, setRewardLimit] = useState(DEFAULT_REWARD_LIMIT);
    const [limitOpen, setLimitOpen] = useState(false);
    const [contactNote, setContactNote] = useState('');
    const [sendingContact, setSendingContact] = useState(false);
    const pageTopRef = useRef(null);

    const brand = partnerData?.brand_name;

    // Count rewards toward the cap: live rewards + any brand-new submission
    // still in review. Listing-update change requests (target_reward_id) and
    // rejected submissions don't count; approved submissions are excluded too
    // because they already exist as a live reward (would otherwise double-count).
    const pendingNewCount = submissions.filter(
        s => !s.target_reward_id && (s.status === 'pending' || s.status === 'invited')
    ).length;
    const rewardCount = rewards.length + pendingNewCount;
    const atLimit = rewardCount >= rewardLimit;

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
    // back into view when switching between list and form.
    useEffect(() => {
        pageTopRef.current?.scrollIntoView({ block: 'start' });
    }, [formOpen]);

    const fetchAll = async () => {
        setLoading(true);
        const [r, s, lim] = await Promise.all([
            supabase.from('rewards').select('*').ilike('brand_name', brand).order('created_at', { ascending: false }),
            supabase.from('reward_submissions').select('*').ilike('brand_name', brand).order('created_at', { ascending: false }),
            supabase.from('brand_reward_limits').select('reward_limit').eq('brand_key', (brand ?? '').trim().toLowerCase()),
        ]);
        setRewards(r.data ?? []);
        setSubmissions(s.data ?? []);
        setRewardLimit(lim.data?.[0]?.reward_limit ?? DEFAULT_REWARD_LIMIT);
        setLoading(false);
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
        if (!user) { toast.error('Please sign in again'); return; }
        setSendingContact(true);
        const note = contactNote.trim();
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
            toast.error(error.message);
        } else {
            toast.success("Thanks — our team will be in touch shortly");
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
            logo_url: r.image_url ?? null,
            hero_image_url: r.hero_image_url ?? null,
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
            logo_url: sub.image_url ?? null,
            hero_image_url: sub.hero_image_url ?? null,
        });
        setFormOpen(true);
    };

    const uploadImage = async (file, kind) => {
        if (file.size > MAX_IMAGE_BYTES) { toast.error('Image must be under 5 MB'); return null; }
        const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingHero;
        setUploading(true);
        try {
            const url = await uploadPublicImage('reward-submissions', file, kind === 'logo' ? 'logos' : 'heroes');
            return url;
        } catch (err) {
            toast.error(err.message || 'Upload failed');
            return null;
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const missing = [];
        if (!form.title.trim()) missing.push('Reward title');
        if (!form.description.trim()) missing.push('Short description');
        if (form.discount_type) {
            if (!(Number(form.discount_value) > 0)) missing.push('Discount value');
        } else if (!form.value_label.trim()) {
            missing.push('Value label');
        }
        if (!form.offer.trim()) missing.push('Offer detail');
        if (!form.partner_blurb.trim()) missing.push('About your brand');
        if (!form.terms.trim()) missing.push('Terms & conditions');
        if (cleanPrefix(form.code_prefix).length < 2) missing.push('Promo code name (min 2 characters)');
        if (!form.logo_url) missing.push('Logo image');
        if (!form.hero_image_url) missing.push('Hero image');

        if (missing.length) {
            toast.error(`Still needed: ${missing.join(', ')}`);
            return;
        }

        setSaving(true);
        const payload = {
            brand_name: brand ?? '',
            status: 'pending',
            title: form.title.trim(),
            description: form.description.trim(),
            category: form.category,
            reward_kind: form.reward_kind,
            discount_type: form.discount_type || null,
            discount_value: form.discount_value ? Number(form.discount_value) : null,
            value_label: form.value_label.trim() || null,
            offer: form.offer.trim(),
            partner_blurb: form.partner_blurb.trim(),
            terms: form.terms.trim(),
            url: form.url.trim() || null,
            code_prefix: cleanPrefix(form.code_prefix),
            image_url: form.logo_url,
            hero_image_url: form.hero_image_url,
            submitted_at: new Date().toISOString(),
        };

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
            toast.error(error.message);
        } else {
            toast.success(
                editingListing ? "Changes submitted — they'll go live once approved by POWR"
                : editingSubmission ? 'Submission updated'
                : 'Reward submitted for review'
            );
            closeForm();
            fetchAll();
        }
        setSaving(false);
    };

    const tabs = [
        { key: 'live',        label: 'Live Rewards',  count: rewards.length },
        { key: 'submissions', label: 'Submissions',   count: submissions.length },
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
                        <ChevronLeft size={14} /> Back to My Rewards
                    </button>
                    <div className="mb-10">
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-3">
                            {editingListing ? 'Edit Listing' : editingSubmission ? 'Edit Submission' : 'Submit a Reward'}
                        </h1>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">
                            {editingListing
                                ? 'Your live listing stays unchanged until POWR approves these changes'
                                : 'Our team reviews all submissions before going live'}
                        </p>
                    </div>

                    <form onSubmit={handleSave} className="bg-white border border-[#E6E6E1] rounded-3xl p-10 space-y-10">
                        {/* The Offer */}
                        <section className="space-y-5">
                            <h3 className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black">The Offer</h3>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Reward Title *</label>
                                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. 30% off your first order" maxLength={60} className={INPUT} />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Short Description *</label>
                                <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. Your Brand · Any product" maxLength={80} className={INPUT} />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Value type *</label>
                                    <select value={form.discount_type} onChange={e => setForm(p => ({ ...p, discount_type: e.target.value }))} className={INPUT}>
                                        {DISCOUNT_OPTIONS.map(o => <option key={o.value || 'x'} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                                {form.discount_type ? (
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{form.discount_type === 'percentage' ? 'Percent off *' : 'Amount off £ *'}</label>
                                        <input type="number" min="0" value={form.discount_value} onChange={e => setForm(p => ({ ...p, discount_value: e.target.value }))} placeholder={form.discount_type === 'percentage' ? '30' : '20'} className={INPUT} />
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Value label *</label>
                                        <input value={form.value_label} onChange={e => setForm(p => ({ ...p, value_label: e.target.value }))} placeholder="e.g. £20 value" className={INPUT} />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Sector *</label>
                                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={INPUT}>
                                        {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Reward type *</label>
                                <div className="flex gap-3">
                                    {[['digital', 'Digital code'], ['physical', 'Physical item']].map(([val, lbl]) => (
                                        <button key={val} type="button" onClick={() => setForm(p => ({ ...p, reward_kind: val }))}
                                            className={`flex-1 h-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.15em] border transition-all ${form.reward_kind === val ? 'border-[#E8D200]/60 bg-[#E8D200]/10 text-[#8a7600]' : 'border-[#DDD] bg-white text-[#888] hover:text-[#444]'}`}>
                                            {lbl}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Offer detail * (expanded view)</label>
                                <textarea value={form.offer} onChange={e => setForm(p => ({ ...p, offer: e.target.value }))} rows={2} placeholder="e.g. Get 30% off any single order. New customers only." className={`${INPUT} h-auto py-4 resize-none`} />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">About your brand *</label>
                                <textarea value={form.partner_blurb} onChange={e => setForm(p => ({ ...p, partner_blurb: e.target.value }))} rows={2} placeholder="A short line about who you are." className={`${INPUT} h-auto py-4 resize-none`} />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Terms & conditions *</label>
                                <textarea value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} rows={2} placeholder="e.g. One use per member. Cannot be combined with other offers." className={`${INPUT} h-auto py-4 resize-none`} />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Website URL</label>
                                <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder="https://yourbrand.com" className={INPUT} />
                            </div>
                        </section>

                        {/* Promo code */}
                        <section className="space-y-4">
                            <h3 className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black">Promo Code</h3>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Code name * (your brand segment)</label>
                                <input value={form.code_prefix} onChange={e => setForm(p => ({ ...p, code_prefix: cleanPrefix(e.target.value) }))} placeholder="e.g. TRIBE" maxLength={8} className={`${INPUT} uppercase tracking-[0.2em]`} />
                            </div>
                            <div className="p-5 rounded-2xl border border-[#E8D200]/40 bg-[#E8D200]/5">
                                <p className="text-[9px] uppercase tracking-[0.3em] font-black text-[#777] mb-2">Members receive</p>
                                <div className="font-mono text-lg tracking-[0.12em] text-[#1A1A1A]">
                                    POWR-<span className="text-[#8a7600]">{form.code_prefix || 'BRAND'}</span>-<span className="text-[#AAA]">A1B2C3</span>
                                </div>
                            </div>
                        </section>

                        {/* Imagery */}
                        <section className="space-y-4">
                            <h3 className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black">Imagery</h3>
                            <div className="grid grid-cols-2 gap-5">
                                <ImagePicker
                                    label="Logo / brand mark * (square, min 512×512px)"
                                    preview={form.logo_url}
                                    uploading={uploadingLogo}
                                    aspect="aspect-square"
                                    onFile={async (file) => { const url = await uploadImage(file, 'logo'); if (url) setForm(p => ({ ...p, logo_url: url })); }}
                                />
                                <ImagePicker
                                    label="Hero / banner * (landscape 16:9, min 1200×675px)"
                                    preview={form.hero_image_url}
                                    uploading={uploadingHero}
                                    aspect="aspect-video"
                                    onFile={async (file) => { const url = await uploadImage(file, 'hero'); if (url) setForm(p => ({ ...p, hero_image_url: url })); }}
                                />
                            </div>
                        </section>

                        {/* Footer */}
                        <div className="flex items-center justify-between gap-6 pt-8 border-t border-[#E6E6E1]">
                            <p className="text-[10px] text-[#BBB] font-black max-w-sm leading-relaxed">
                                {editingListing
                                    ? 'POWR will review your changes and apply them to the live listing.'
                                    : 'Our team will set the points price and review before it goes live.'}
                            </p>
                            <div className="flex gap-4 shrink-0">
                                <button type="button" onClick={closeForm} className="h-12 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors">Cancel</button>
                                <button type="submit" disabled={saving || uploadingLogo || uploadingHero} className="h-12 px-10 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-50">
                                    {saving ? 'Submitting...' : editingListing ? 'Submit Changes' : editingSubmission ? 'Update Submission' : 'Submit for Review'}
                                </button>
                            </div>
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
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">Reward Management</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">My Rewards</h1>
            </div>

            {/* Tabs + submit */}
            <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
                <div className="flex gap-2 bg-white border border-[#E6E6E1] rounded-[2rem] p-2 w-fit">
                    {tabs.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`h-10 px-6 rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${tab === t.key ? 'bg-[#E8D200] text-[#080808]' : 'text-[#555] hover:text-[#222]'}`}
                        >
                            {t.label}
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${tab === t.key ? 'bg-[#1A1A1A]/10' : 'bg-[#F4F4F1]'}`}>{t.count}</span>
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-4">
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${atLimit ? 'text-[#8a7600]' : 'text-[#BBB]'}`}>
                        {rewardCount}/{rewardLimit} rewards{atLimit ? ' · limit reached' : ''}
                    </span>
                    <button
                        onClick={openNew}
                        className="flex items-center gap-3 h-12 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20"
                    >
                        {atLimit ? <><Mail size={15} /> Request More</> : <><Plus size={15} /> Submit Reward</>}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : tab === 'live' ? (
                    rewards.length === 0 ? (
                        <div className="py-24 text-center">
                            <Award size={32} className="text-[#E6E6E1] mx-auto mb-4" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black mb-2">No live rewards yet</p>
                            <p className="text-xs text-[#BBBBBB] mb-6">Submit a reward and our team will review and publish it.</p>
                            <button onClick={openNew} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/15">
                                Submit Your First Reward
                            </button>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    {['Reward', 'Category', 'Cost', 'Status', ''].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.4em] text-[#888]">{h}</th>
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
                                            <span className="px-3 py-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase font-black tracking-[0.3em] text-[#666]">{r.category}</span>
                                        </td>
                                        <td className="px-6 py-5 text-sm font-bold text-[#222]">{r.powr_cost?.toLocaleString()} pts</td>
                                        <td className="px-6 py-5">
                                            <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] w-fit ${r.active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#F4F4F1] text-[#BBBBBB]'}`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${r.active ? 'bg-[#10B981] animate-pulse' : 'bg-[#BBBBBB]'}`} />
                                                {r.active ? 'Live' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            {pendingEditRewardIds.has(r.id) ? (
                                                <span className="inline-flex items-center gap-2 px-4 py-2 bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-[#8a7600]">
                                                    <Clock size={10} /> Update in review
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); openEditListing(r); }}
                                                    className="h-9 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all"
                                                >
                                                    Edit Listing
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                ) : (
                    submissions.length === 0 ? (
                        <div className="py-24 text-center">
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No submissions yet</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    {['Reward', 'Status', 'Submitted', ''].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.4em] text-[#888]">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F4F1]">
                                {submissions.map(s => {
                                    const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.pending;
                                    const BadgeIcon = badge.icon;
                                    const canEdit = s.status === 'pending' || s.status === 'invited';
                                    return (
                                        <tr
                                            key={s.id}
                                            onClick={() => setSelectedKey(`submissions-${s.id}`)}
                                            className={`group cursor-pointer transition-colors ${selectedItem?.id === s.id ? 'bg-[#E8D200]/5' : 'hover:bg-[#FAFAFA]'}`}
                                        >
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-bold text-[#222]">{s.title || <span className="text-[#BBB] italic">Untitled</span>}</span>
                                                    {s.target_reward_id && (
                                                        <span className="px-2.5 py-0.5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 rounded-full text-[8px] font-black uppercase tracking-[0.2em] text-[#8B5CF6]">Listing update</span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-[#BBB] font-black uppercase tracking-wider mt-0.5">{s.description}</div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] w-fit border border-current/20 ${badge.color}`}>
                                                    <BadgeIcon size={10} />
                                                    {badge.label}
                                                </span>
                                                {s.reviewer_notes && (
                                                    <p className="text-[10px] text-[#999] mt-2 max-w-xs leading-relaxed">{s.reviewer_notes}</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-5 text-[11px] text-[#BBB] font-black">
                                                {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                            </td>
                                            <td className="px-6 py-5 text-right">
                                                {canEdit && (
                                                    <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="h-9 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all">
                                                        Edit
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
                    {preview ? (
                        <RewardAppPreview key={formOpen ? 'form' : `${tab}-${selectedItem?.id}`} pageTheme="light" {...preview} />
                    ) : (
                        <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl p-12 text-center">
                            <Eye size={24} className="text-[#DDDDDD] mx-auto mb-4" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black leading-relaxed">
                                Select a reward<br />to preview it in the app
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
                            <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A]">Reward limit reached</h2>
                            <button onClick={() => setLimitOpen(false)} disabled={sendingContact} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#999] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"><X size={16} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <p className="text-sm text-[#666] font-light leading-relaxed">
                                Brands can run up to <span className="font-bold text-[#1A1A1A]">{rewardLimit} rewards</span> live or in review at a time. Want to offer more? Tell us a little about what you want to add and our team will get in touch.
                            </p>
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Anything we should know? (optional)</label>
                                <textarea
                                    value={contactNote}
                                    onChange={e => setContactNote(e.target.value)}
                                    rows={3}
                                    placeholder="e.g. We'd like to add a seasonal offer and a members-only reward."
                                    className={`${INPUT} h-auto py-4 resize-none`}
                                />
                            </div>
                            <div className="flex justify-end gap-4 pt-2">
                                <button type="button" onClick={() => setLimitOpen(false)} disabled={sendingContact} className="h-12 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors disabled:opacity-50">Cancel</button>
                                <button
                                    type="button"
                                    onClick={handleGetInTouch}
                                    disabled={sendingContact}
                                    className="flex items-center gap-3 h-12 px-10 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-50 disabled:translate-y-0"
                                >
                                    {sendingContact
                                        ? <div className="w-4 h-4 border-2 border-[#080808]/30 border-t-[#080808] rounded-full animate-spin" />
                                        : <Mail size={14} />}
                                    {sendingContact ? 'Sending…' : 'Get in touch'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
