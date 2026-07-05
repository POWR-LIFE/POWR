import React, { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { uploadPublicImage } from '../lib/storage';
import RewardAppPreview from '../components/RewardAppPreview';

// ─── Category options (app sectors) ─────────────────────────────────────────
// value = legacy partner_category stored in DB; label = app-facing sector.
const CATEGORY_OPTIONS = [
  { value: 'food',   label: 'Eat' },
  { value: 'gym',    label: 'Move' },
  { value: 'health', label: 'Mind' },
  { value: 'gear',   label: 'Sleep' },
];

const DISCOUNT_OPTIONS = [
  { value: '',            label: 'Custom text' },
  { value: 'percentage',  label: '% off' },
  { value: 'fixed_amount',label: '£ off' },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const INPUT_BASE = "w-full h-14 rounded-2xl text-sm font-light px-6 outline-none transition-colors border font-['Outfit']";

function cleanPrefix(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// ─── Theme ────────────────────────────────────────────────────────────────────
// Light/white is the standard theme for the partner portal. The in-app preview
// stays dark regardless (the POWR app is dark-mode only).
const t = {
  page:        'bg-[#F4F4F1] text-[#1A1A1A]',
  nav:         'border-[#E6E6E1] bg-[#F4F4F1]/90',
  navText:     'text-[#888]',
  heroBg:      'bg-white border-[#E6E6E1]',
  heroBody:    'text-[#666]',
  heroBodyStrong: 'text-[#444]',
  accentText:  'text-[#8a7600]',
  sectionBorder: 'border-[#E6E6E1]',
  indexNum:    'text-[#BBB]',
  h2:          'text-[#1A1A1A]',
  sectionDesc: 'text-[#777]',
  label:       'text-[#666]',
  input:       'bg-white border-[#DDD] text-[#1A1A1A] placeholder-[#BBB] focus:border-[#E8D200]',
  chipActive:  'border-[#E8D200]/60 bg-[#E8D200]/10 text-[#8a7600]',
  chipInactive:'border-[#DDD] bg-white text-[#888] hover:text-[#444]',
  imgBox:      'border-[#DDD] bg-[#FAFAFA] hover:border-[#BBB]',
  imgInner:    'border-[#DDD]',
  imgPlaceholder: 'text-[#AAA]',
  promoBox:    'border-[#E8D200]/40 bg-[#E8D200]/[0.10]',
  promoLabel:  'text-[#777]',
  promoCode:   'text-[#1A1A1A]',
  promoName:   'text-[#8a7600]',
  promoSuffix: 'text-[#AAA]',
  promoNote:   'text-[#888]',
  specStrong:  'text-[#444]',
  specText:    'text-[#888]',
  legal:       'text-[#999]',
  error:       'border-red-300 bg-red-50 text-red-600',
  backLink:    'text-[#999] hover:text-[#8a7600]',
  body:        'text-[#777]',
};

// ─── Shell ───────────────────────────────────────────────────────────────────
function Shell({ children }) {
  return (
    <div className={`min-h-screen font-['Outfit'] ${t.page}`}>
      <nav className={`border-b backdrop-blur-xl sticky top-0 z-50 ${t.nav}`}>
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <Link to="/"><img src="/powr-logo-black.png" alt="POWR" className="h-7" /></Link>
          <span className={`text-[10px] uppercase tracking-[0.4em] font-black ${t.navText}`}>Partner Portal</span>
        </div>
      </nav>
      {children}
    </div>
  );
}

export default function PartnerRewardSubmit() {
  const { token } = useParams();

  const [tokenState, setTokenState] = useState('loading'); // loading | invalid | used | valid
  const [ctx, setCtx] = useState({ brandLocked: false, prefixLocked: false, partnerCode: null });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [brandName, setBrandName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('gym');
  const [rewardKind, setRewardKind] = useState('digital');
  const [discountType, setDiscountType] = useState('');
  const [discountValue, setDiscountValue] = useState('');
  const [valueLabel, setValueLabel] = useState('');
  const [offer, setOffer] = useState('');
  const [partnerBlurb, setPartnerBlurb] = useState('');
  const [terms, setTerms] = useState('');
  const [url, setUrl] = useState('');
  const [codePrefix, setCodePrefix] = useState('');

  // Images
  const [logoUrl, setLogoUrl] = useState(null);
  const [heroUrl, setHeroUrl] = useState(null);
  const [heroVideoUrl, setHeroVideoUrl] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingHeroVideo, setUploadingHeroVideo] = useState(false);
  const logoRef = useRef(null);
  const heroRef = useRef(null);
  const heroVideoRef = useRef(null);

  useEffect(() => {
    if (!token) { setTokenState('invalid'); return; }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('partner-reward-submission', {
          body: { action: 'validate', token },
        });
        if (error || !data?.ok) {
          setTokenState(data?.reason === 'used' ? 'used' : 'invalid');
          return;
        }
        const c = data.context ?? {};
        setCtx({ brandLocked: !!c.brandLocked, prefixLocked: !!c.prefixLocked, partnerCode: c.partnerCode ?? null });
        if (c.brandName) setBrandName(c.brandName);
        if (c.codePrefix) setCodePrefix(cleanPrefix(c.codePrefix));
        setTokenState('valid');
      } catch {
        setTokenState('invalid');
      }
    })();
  }, [token]);

  async function handleImage(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setError('Image must be under 5 MB.'); return; }
    setError('');
    const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingHero;
    setUploading(true);
    try {
      const publicUrl = await uploadPublicImage('reward-submissions', file, kind === 'logo' ? 'logos' : 'heroes');
      if (kind === 'logo') setLogoUrl(publicUrl); else setHeroUrl(publicUrl);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleHeroVideo(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { setError('Video must be under 20 MB — use a short, compressed loop.'); return; }
    setError('');
    setUploadingHeroVideo(true);
    try {
      const publicUrl = await uploadPublicImage('reward-submissions', file, 'hero-videos');
      setHeroVideoUrl(publicUrl);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploadingHeroVideo(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Every field is required — collect anything missing so we can tell the
    // partner exactly what's left to complete.
    const missing = [];
    if (!ctx.brandLocked && !brandName.trim()) missing.push('Brand name');
    if (!website.trim()) missing.push('Website');
    if (!contactName.trim()) missing.push('Contact name');
    if (!contactEmail.trim()) missing.push('Contact email');
    if (!title.trim()) missing.push('Reward title');
    if (!description.trim()) missing.push('Short description');
    if (discountType) {
      if (discountValue === '' || !(Number(discountValue) > 0)) missing.push(discountType === 'percentage' ? 'Percent off' : 'Amount off');
    } else if (!valueLabel.trim()) {
      missing.push('Value label');
    }
    if (!offer.trim()) missing.push('Offer detail');
    if (!partnerBlurb.trim()) missing.push('About your brand');
    if (!terms.trim()) missing.push('Terms & conditions');
    if (!ctx.prefixLocked && cleanPrefix(codePrefix).length < 2) missing.push('Promo code name');
    if (!logoUrl) missing.push('Logo image');
    if (!heroUrl) missing.push('Hero image');

    if (missing.length) {
      setError(`Please complete every field before submitting — still needed: ${missing.join(', ')}.`);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('partner-reward-submission', {
        body: {
          action: 'submit',
          token,
          payload: {
            brand_name: brandName,
            contact_name: contactName,
            contact_email: contactEmail,
            title,
            description,
            category,
            reward_kind: rewardKind,
            discount_type: discountType,
            discount_value: discountValue,
            value_label: valueLabel,
            offer,
            partner_blurb: partnerBlurb,
            terms,
            url: website || url,
            image_url: logoUrl,
            hero_image_url: heroUrl,
            hero_video_url: heroVideoUrl,
            code_prefix: codePrefix,
          },
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setTokenState(data?.reason === 'used' ? 'used' : 'invalid');
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Token states ─────────────────────────────────────────────────────────
  if (tokenState === 'loading') {
    return <Shell><div className="min-h-[80vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div></Shell>;
  }
  if (tokenState === 'invalid') {
    return (
      <Shell>
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="w-16 h-16 rounded-full border border-red-400/40 flex items-center justify-center text-red-500 text-2xl">✕</div>
          <h1 className="text-3xl font-light tracking-tight">Invalid link</h1>
          <p className={`${t.body} font-light max-w-xs leading-relaxed text-sm`}>This link isn't valid. Please check the URL or contact POWR for a new one.</p>
        </div>
      </Shell>
    );
  }
  if (tokenState === 'used') {
    return (
      <Shell>
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="w-16 h-16 rounded-full border border-[#E8D200]/50 flex items-center justify-center text-[#8a7600] text-2xl">✓</div>
          <h1 className="text-3xl font-light tracking-tight">Already submitted</h1>
          <p className={`${t.body} font-light max-w-xs leading-relaxed text-sm`}>This reward has already been submitted. Our team will be in touch once it's reviewed.</p>
        </div>
      </Shell>
    );
  }
  if (submitted) {
    return (
      <Shell>
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-8 px-6 text-center">
          <div className="w-20 h-20 rounded-full border-2 border-[#E8D200] flex items-center justify-center text-[#8a7600] text-4xl">✓</div>
          <div>
            <h1 className="text-4xl font-light tracking-tight mb-3">Reward submitted</h1>
            <p className={`${t.heroBody} font-light max-w-sm leading-relaxed`}>Thanks{brandName ? `, ${brandName}` : ''}. Our team will review it and get it live on POWR shortly.</p>
          </div>
          <Link to="/" className={`text-[10px] uppercase tracking-[0.4em] transition-colors font-black mt-4 ${t.backLink}`}>Back to home</Link>
        </div>
      </Shell>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <Shell>
      {/* Hero header */}
      <div className={`border-b ${t.heroBg}`}>
        <div className="max-w-7xl mx-auto px-8 py-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-[1px] w-10 bg-[#E8D200]" />
            <span className={`text-[10px] uppercase tracking-[0.5em] font-black ${t.accentText}`}>Partner Reward Submission</span>
          </div>
          <h1 className="text-5xl lg:text-6xl font-light tracking-tighter mb-5">Add your reward to POWR</h1>
          <p className={`text-sm font-light max-w-xl leading-relaxed ${t.heroBody}`}>
            Fill in the details below and watch the live preview update on the right — it's exactly how POWR members
            will see your reward in the app. Our team sets the points price and makes it live after a quick review.
            <span className={t.heroBodyStrong}> All fields are required.</span>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="max-w-7xl mx-auto px-8 lg:grid lg:grid-cols-[1fr_360px] lg:gap-16">
          {/* ── LEFT: form ── */}
          <div>
            {/* 01 Brand & contact */}
            <FormSection index="01" title="Your Brand" description="Who's offering this reward, and how we reach you.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Brand name *">
                  <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="e.g. Tribe" required readOnly={ctx.brandLocked} className={`${INPUT_BASE} ${t.input}` + (ctx.brandLocked ? ' opacity-60 cursor-default' : '')} />
                </Field>
                <Field label="Website *">
                  <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourbrand.com" className={`${INPUT_BASE} ${t.input}`} />
                </Field>
                <Field label="Contact name *">
                  <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Your name" className={`${INPUT_BASE} ${t.input}`} />
                </Field>
                <Field label="Contact email *">
                  <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="you@brand.com" required className={`${INPUT_BASE} ${t.input}`} />
                </Field>
              </div>
            </FormSection>

            {/* 02 The offer */}
            <FormSection index="02" title="The Offer" description="What members unlock. Keep the title short and punchy — it's the headline on the card.">
              <Field label="Reward title *">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 30% off your first order" required maxLength={60} className={`${INPUT_BASE} ${t.input}`} />
              </Field>
              <Field label="Short description *">
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Tribe · Any product" maxLength={80} className={`${INPUT_BASE} ${t.input}`} />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Field label="Value type *">
                  <select value={discountType} onChange={e => setDiscountType(e.target.value)} className={`${INPUT_BASE} ${t.input}`}>
                    {DISCOUNT_OPTIONS.map(o => <option key={o.value || 'text'} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                {discountType ? (
                  <Field label={(discountType === 'percentage' ? 'Percent off' : 'Amount off (£)') + ' *'}>
                    <input type="number" min="0" value={discountValue} onChange={e => setDiscountValue(e.target.value)} placeholder={discountType === 'percentage' ? '30' : '20'} className={`${INPUT_BASE} ${t.input}`} />
                  </Field>
                ) : (
                  <Field label="Value label *">
                    <input value={valueLabel} onChange={e => setValueLabel(e.target.value)} placeholder="e.g. £20 value" className={`${INPUT_BASE} ${t.input}`} />
                  </Field>
                )}
                <Field label="Sector *">
                  <select value={category} onChange={e => setCategory(e.target.value)} className={`${INPUT_BASE} ${t.input}`}>
                    {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Reward type *">
                <div className="flex gap-3">
                  {[['digital', 'Digital code'], ['physical', 'Physical item']].map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setRewardKind(val)}
                      className={`flex-1 h-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border transition-all cursor-pointer ${rewardKind === val ? t.chipActive : t.chipInactive}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Offer detail * (shown when the card is expanded)">
                <textarea value={offer} onChange={e => setOffer(e.target.value)} rows={2} placeholder="e.g. Get 30% off any single order at tribe.com. New customers only." className={`${INPUT_BASE} ${t.input} h-auto py-4 resize-none`} />
              </Field>
              <Field label="About your brand *">
                <textarea value={partnerBlurb} onChange={e => setPartnerBlurb(e.target.value)} rows={2} placeholder="A short line about who you are." className={`${INPUT_BASE} ${t.input} h-auto py-4 resize-none`} />
              </Field>
              <Field label="Terms & conditions *">
                <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={2} placeholder="e.g. One use per member. Cannot be combined with other offers." className={`${INPUT_BASE} ${t.input} h-auto py-4 resize-none`} />
              </Field>
            </FormSection>

            {/* 03 Promo code */}
            <FormSection index="03" title="Promo Code" description="Pick the middle of your code. POWR adds POWR- at the front and generates a unique 6-character suffix for every member.">
              <Field label="Your code name *">
                <input
                  value={codePrefix}
                  onChange={e => setCodePrefix(cleanPrefix(e.target.value))}
                  placeholder="e.g. TRIBE"
                  readOnly={ctx.prefixLocked}
                  maxLength={8}
                  className={`${INPUT_BASE} ${t.input} uppercase tracking-[0.2em]` + (ctx.prefixLocked ? ' opacity-60 cursor-default' : '')}
                />
              </Field>
              <div className={`mt-2 p-6 rounded-2xl border ${t.promoBox}`}>
                <p className={`text-[10px] uppercase tracking-[0.3em] font-black mb-3 ${t.promoLabel}`}>This is what members get</p>
                <div className={`font-mono text-xl tracking-[0.15em] ${t.promoCode}`}>
                  POWR-<span className={t.promoName}>{codePrefix || 'BRAND'}</span>-<span className={t.promoSuffix}>A1B2C3</span>
                </div>
                <p className={`text-xs font-light mt-3 leading-relaxed ${t.promoNote}`}>
                  {ctx.prefixLocked
                    ? 'Your code name is set from your existing POWR partner code.'
                    : 'Letters and numbers only. The last 6 characters are generated uniquely per member at redemption.'}
                </p>
              </div>
            </FormSection>

            {/* 04 Imagery */}
            <FormSection index="04" title="Imagery" description="Two images bring the card to life. Use crisp, high-resolution files.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Logo */}
                <div>
                  <p className={`text-[10px] uppercase tracking-[0.3em] font-black mb-2 ${t.label}`}>Logo / brand mark *</p>
                  <p className={`text-[11px] font-light mb-3 leading-relaxed ${t.specText}`}>Square, min <span className={t.specStrong}>512×512px</span>. Transparent PNG preferred. Max 5 MB.</p>
                  <ImagePicker preview={logoUrl} uploading={uploadingLogo} onClick={() => logoRef.current?.click()} aspect="aspect-square" label="Add logo" />
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, 'logo')} />
                </div>
                {/* Hero */}
                <div>
                  <p className={`text-[10px] uppercase tracking-[0.3em] font-black mb-2 ${t.label}`}>Hero / banner image *</p>
                  <p className={`text-[11px] font-light mb-3 leading-relaxed ${t.specText}`}>Landscape 16:9, min <span className={t.specStrong}>1200×675px</span>. JPG or PNG. Max 5 MB.</p>
                  <ImagePicker preview={heroUrl} uploading={uploadingHero} onClick={() => heroRef.current?.click()} aspect="aspect-video" label="Add hero" />
                  <input ref={heroRef} type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, 'hero')} />
                </div>
                {/* Hero video (optional) */}
                <div className="md:col-span-2">
                  <p className={`text-[10px] uppercase tracking-[0.3em] font-black mb-2 ${t.label}`}>Hero / banner video <span className={t.specText}>— optional</span></p>
                  <p className={`text-[11px] font-light mb-3 leading-relaxed ${t.specText}`}>A short, looping clip that plays <span className={t.specStrong}>instead of the hero image</span>. Landscape 16:9, MP4, muted. Max 20 MB. The hero image is still used as the still fallback.</p>
                  <ImagePicker preview={heroVideoUrl} uploading={uploadingHeroVideo} onClick={() => heroVideoRef.current?.click()} aspect="aspect-video" label="Add video" isVideo />
                  <input ref={heroVideoRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleHeroVideo} />
                </div>
              </div>
            </FormSection>

            {/* Submit */}
            <div className={`py-16 border-t ${t.sectionBorder}`}>
              {error && <div className={`mb-8 px-6 py-4 rounded-2xl border text-sm text-center ${t.error}`}>{error}</div>}
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
                <p className={`text-xs font-light leading-relaxed max-w-md ${t.legal}`}>
                  By submitting you agree to let POWR feature this reward in the app. We'll set the points price and review before it goes live.
                </p>
                <button type="submit" disabled={submitting || uploadingLogo || uploadingHero || uploadingHeroVideo}
                  className={`shrink-0 h-16 px-16 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] transition-all shadow-lg shadow-[#E8D200]/20 ${(submitting || uploadingLogo || uploadingHero || uploadingHeroVideo) ? 'opacity-50 cursor-not-allowed' : 'hover:translate-y-[-2px] cursor-pointer'}`}>
                  {submitting ? 'Submitting…' : 'Submit Reward'}
                </button>
              </div>
            </div>
          </div>

          {/* ── RIGHT: sticky live preview (always dark — mirrors the dark-only app) ── */}
          <div className="hidden lg:block">
            <div className="sticky top-24 py-16">
              <RewardAppPreview
                pageTheme="light"
                brandName={brandName}
                title={title}
                description={description}
                partnerBlurb={partnerBlurb}
                offer={offer}
                valueLabel={valueLabel}
                discountType={discountType}
                discountValue={discountValue}
                pts={null}
                logoUrl={logoUrl}
                heroUrl={heroUrl}
                heroVideoUrl={heroVideoUrl}
                codePrefix={codePrefix}
                category={category}
              />
            </div>
          </div>
        </div>
      </form>
    </Shell>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function FormSection({ index, title, description, children }) {
  return (
    <div className={`py-12 border-b ${t.sectionBorder}`}>
      <div className="mb-8">
        <div className={`text-[10px] font-black uppercase tracking-[0.4em] mb-3 ${t.indexNum}`}>{index}</div>
        <h2 className={`text-2xl font-light tracking-tight mb-2 ${t.h2}`}>{title}</h2>
        <p className={`text-[13px] font-light leading-relaxed max-w-lg ${t.sectionDesc}`}>{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className={`text-[10px] uppercase tracking-[0.3em] font-black ${t.label}`}>{label}</label>
      {children}
    </div>
  );
}

function ImagePicker({ preview, uploading, onClick, aspect, label, isVideo }) {
  return (
    <div onClick={onClick} className={`${aspect} rounded-2xl border flex items-center justify-center cursor-pointer overflow-hidden transition-colors group ${t.imgBox}`}>
      {uploading ? (
        <div className="w-7 h-7 border-2 border-[#E8D200]/30 border-t-[#E8D200] rounded-full animate-spin" />
      ) : preview ? (
        isVideo
          ? <video src={preview} className="w-full h-full object-cover" muted loop autoPlay playsInline />
          : <img src={preview} alt="" className="w-full h-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center group-hover:border-[#E8D200]/40 transition-colors ${t.imgInner}`}><span className={`${t.imgPlaceholder} text-xl`}>+</span></div>
          <span className={`text-[10px] uppercase tracking-[0.3em] font-black ${t.imgPlaceholder}`}>{label}</span>
        </div>
      )}
    </div>
  );
}
