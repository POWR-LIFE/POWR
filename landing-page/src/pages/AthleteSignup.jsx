import React, { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LOGO_SRC } from '../landing/LogoMorph';
import { supabase } from '../lib/supabase';

const ACTIVITY_OPTIONS = [
  { value: 'gym',            label: 'Gym / Weightlifting' },
  { value: 'hyrox',          label: 'Hyrox' },
  { value: 'crossfit',       label: 'CrossFit' },
  { value: 'running',        label: 'Running' },
  { value: 'cycling',        label: 'Cycling' },
  { value: 'swimming',       label: 'Swimming' },
  { value: 'triathlon',      label: 'Triathlon' },
  { value: 'powerlifting',   label: 'Powerlifting' },
  { value: 'olympic_lifting','label': 'Olympic Lifting' },
  { value: 'calisthenics',   label: 'Calisthenics' },
  { value: 'yoga',           label: 'Yoga / Pilates' },
  { value: 'football',       label: 'Football / Soccer' },
  { value: 'basketball',     label: 'Basketball' },
  { value: 'rugby',          label: 'Rugby' },
  { value: 'tennis',         label: 'Tennis / Racket Sports' },
  { value: 'martial_arts',   label: 'Martial Arts / Boxing' },
  { value: 'climbing',       label: 'Climbing' },
  { value: 'walking',        label: 'Walking / Hiking' },
  { value: 'other',          label: 'Other' },
];

const MAX_ACHIEVEMENTS = 4;
const MAX_GALLERY      = 6;
const BLANK_ACHIEVEMENT = { title: '', value: '', context: '' };

async function uploadFile(file, path) {
  const { error } = await supabase.storage
    .from('athlete-applications')
    .upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('athlete-applications').getPublicUrl(path);
  return data.publicUrl;
}

// ─── Shell states ─────────────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#080808] text-[#F2F2F2] font-['Outfit']">
      <nav className="border-b border-[#111] bg-[#080808]/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <Link to="/">
            <img
              src={LOGO_SRC}
              alt="POWR"
              className="h-7"
            />
          </Link>
          <Link to="/" className="text-[10px] uppercase tracking-[0.4em] text-[#333] hover:text-[#E8D200] transition-colors font-black">
            Back to home
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}

export default function AthleteSignup() {
  const { token } = useParams();

  const [tokenState, setTokenState] = useState('loading');
  const [applicationId, setApplicationId] = useState(null);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [submitted, setSubmitted]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');

  const [displayName, setDisplayName]   = useState('');
  const [username, setUsername]         = useState('');
  const [email, setEmail]               = useState('');
  const [bio, setBio]                   = useState('');
  const [instagram, setInstagram]       = useState('');
  const [website, setWebsite]           = useState('');
  const [activities, setActivities]     = useState([]);
  const [otherActivity, setOtherActivity] = useState('');
  const [achievements, setAchievements] = useState([{ ...BLANK_ACHIEVEMENT }]);
  const [avatarFile, setAvatarFile]     = useState(null);
  const [coverFile, setCoverFile]       = useState(null);
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [avatarPreview, setAvatarPreview]     = useState(null);
  const [coverPreview, setCoverPreview]       = useState(null);
  const [galleryPreviews, setGalleryPreviews] = useState([]);

  const avatarRef  = useRef(null);
  const coverRef   = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    if (!token) { setTokenState('invalid'); return; }
    (async () => {
      const { data, error } = await supabase
        .from('athlete_applications')
        .select('id, email, status')
        .eq('invite_token', token)
        .maybeSingle();
      if (error || !data) { setTokenState('invalid'); return; }
      if (data.status !== 'invited') { setTokenState('used'); return; }
      setApplicationId(data.id);
      setPrefillEmail(data.email ?? '');
      setEmail(data.email ?? '');
      setTokenState('valid');
    })();
  }, [token]);

  function toggleActivity(val) {
    setActivities(prev => prev.includes(val) ? prev.filter(a => a !== val) : [...prev, val]);
  }

  function updateAchievement(i, field, value) {
    setAchievements(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleCoverChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  function handleGalleryChange(e) {
    const files = Array.from(e.target.files ?? []);
    const added = files.slice(0, MAX_GALLERY - galleryFiles.length);
    setGalleryFiles(prev => [...prev, ...added]);
    setGalleryPreviews(prev => [...prev, ...added.map(f => URL.createObjectURL(f))]);
  }

  function removeGallery(i) {
    setGalleryFiles(prev => prev.filter((_, idx) => idx !== i));
    setGalleryPreviews(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!displayName.trim() || !email.trim() || activities.length === 0) {
      setError('Please fill in your name, email, and select at least one sport.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const ts = Date.now();
      let avatarUrl = null;
      if (avatarFile) avatarUrl = await uploadFile(avatarFile, `${ts}/avatar.${avatarFile.name.split('.').pop()}`);
      let coverUrl = null;
      if (coverFile) coverUrl = await uploadFile(coverFile, `${ts}/cover.${coverFile.name.split('.').pop()}`);
      const galleryUrls = [];
      for (let i = 0; i < galleryFiles.length; i++) {
        const f = galleryFiles[i];
        galleryUrls.push(await uploadFile(f, `${ts}/gallery_${i}.${f.name.split('.').pop()}`));
      }
      const validAchievements = achievements
        .filter(a => a.title.trim() && a.value.trim())
        .map(a => ({ title: a.title.trim(), value: a.value.trim(), context: a.context.trim() || null }));
      const { error: updateError } = await supabase
        .from('athlete_applications')
        .update({
          email: email.trim(),
          display_name: displayName.trim(),
          username: username.trim() || null,
          bio: bio.trim() || null,
          avatar_url: avatarUrl,
          cover_url: coverUrl,
          activity_preferences: activities.includes('other') && otherActivity.trim()
            ? [...activities.filter(a => a !== 'other'), `other:${otherActivity.trim()}`]
            : activities,
          achievements: validAchievements,
          gallery_urls: galleryUrls,
          instagram_handle: instagram.trim().replace(/^@/, '') || null,
          website_url: website.trim() || null,
          status: 'pending',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', applicationId)
        .eq('status', 'invited');
      if (updateError) throw updateError;
      setSubmitted(true);
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (tokenState === 'loading') {
    return (
      <Shell>
        <div className="min-h-[80vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
        </div>
      </Shell>
    );
  }

  // ── Invalid token ────────────────────────────────────────────────────────────
  if (tokenState === 'invalid') {
    return (
      <Shell>
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="w-16 h-16 rounded-full border border-red-500/30 flex items-center justify-center text-red-400 text-2xl">✕</div>
          <h1 className="text-3xl font-light tracking-tight">Invalid invite link</h1>
          <p className="text-[#444] font-light max-w-xs leading-relaxed text-sm">
            This link isn't valid. Please check the URL or contact POWR to get a new invite.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Already used ─────────────────────────────────────────────────────────────
  if (tokenState === 'used') {
    return (
      <Shell>
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="w-16 h-16 rounded-full border border-[#E8D200]/30 flex items-center justify-center text-[#E8D200] text-2xl">✓</div>
          <h1 className="text-3xl font-light tracking-tight">Already submitted</h1>
          <p className="text-[#444] font-light max-w-xs leading-relaxed text-sm">
            This invite has already been used. We'll be in touch once your application is reviewed.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <Shell>
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-8 px-6 text-center">
          <div className="w-20 h-20 rounded-full border border-[#E8D200] flex items-center justify-center text-[#E8D200] text-4xl">✓</div>
          <div>
            <h1 className="text-4xl font-light tracking-tight mb-3">Application submitted</h1>
            <p className="text-[#666] font-light max-w-sm leading-relaxed">
              Thanks {displayName.split(' ')[0]}. We'll review your profile and be in touch shortly.
            </p>
          </div>
          <Link to="/" className="text-[10px] uppercase tracking-[0.4em] text-[#333] hover:text-[#E8D200] transition-colors font-black mt-4">
            Back to home
          </Link>
        </div>
      </Shell>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <Shell>
      {/* Hero header */}
      <div className="border-b border-[#111] bg-[#050505]">
        <div className="max-w-7xl mx-auto px-8 py-20">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-[1px] w-10 bg-[#E8D200]" />
            <span className="text-[10px] uppercase tracking-[0.5em] text-[#E8D200] font-black">Pro Athlete Onboarding</span>
          </div>
          <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-5">Athlete Profile</h1>
          <p className="text-[#555] text-sm font-light max-w-lg leading-relaxed">
            Fill in your details below. Your profile will be reviewed by our team before going live on the POWR platform.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="max-w-7xl mx-auto px-8">

          {/* ── Your details ───────────────────────────────── */}
          <FormSection
            index="01"
            title="Your Details"
            description="Basic contact and identity information."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Full name *">
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Alex Johnson" required className={inp} />
              </Field>
              <Field label="Email *">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required readOnly={!!prefillEmail} className={inp + (prefillEmail ? ' opacity-60 cursor-default' : '')} />
              </Field>
              <Field label="Username">
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="@handle (optional)" className={inp} />
              </Field>
              <Field label="Instagram">
                <input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@yourusername" className={inp} />
              </Field>
            </div>
            <Field label="Website">
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yoursite.com" className={inp} />
            </Field>
            <Field label="Bio">
              <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="A short description about you and your training…" rows={4} className={inp + ' resize-none'} />
            </Field>
          </FormSection>

          {/* ── Sports ─────────────────────────────────────── */}
          <FormSection
            index="02"
            title="Sports & Activities"
            description="Select everything that applies. This determines which leagues and leaderboards you appear on."
            required
          >
            <div className="flex flex-wrap gap-3">
              {ACTIVITY_OPTIONS.map(opt => {
                const active = activities.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleActivity(opt.value)}
                    className={`h-12 px-6 rounded-full text-[11px] font-black uppercase tracking-[0.2em] border transition-all cursor-pointer ${
                      active
                        ? 'border-[#E8D200]/50 bg-[#E8D200]/10 text-[#E8D200] shadow-[0_0_20px_rgba(232,210,0,0.08)]'
                        : 'border-[#1A1A1A] bg-[#0A0A0A] text-[#444] hover:border-[#2A2A2A] hover:text-[#888]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {activities.includes('other') && (
              <div className="mt-4">
                <input
                  type="text"
                  value={otherActivity}
                  onChange={e => setOtherActivity(e.target.value)}
                  placeholder="Describe your sport or activity…"
                  maxLength={100}
                  className="w-full h-14 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl text-[#F2F2F2] text-sm font-light px-6 outline-none focus:border-[#E8D200]/40 transition-all placeholder:text-[#333]"
                />
              </div>
            )}
          </FormSection>

          {/* ── Photos ─────────────────────────────────────── */}
          <FormSection
            index="03"
            title="Photos"
            description="Add a profile photo, a cover banner, and up to 6 gallery shots."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
              {/* Avatar */}
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#444] font-black mb-3">Profile photo</p>
                <div
                  onClick={() => avatarRef.current?.click()}
                  className="h-48 rounded-2xl border border-[#1A1A1A] bg-[#050505] flex items-center justify-center cursor-pointer overflow-hidden hover:border-[#2A2A2A] transition-colors group"
                >
                  {avatarPreview
                    ? <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                    : <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl border border-[#1E1E1E] flex items-center justify-center group-hover:border-[#E8D200]/20 transition-colors">
                          <span className="text-[#333] text-xl">+</span>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#333] font-black">Add photo</span>
                      </div>
                  }
                </div>
                <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>
              {/* Cover */}
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#444] font-black mb-3">Cover / banner</p>
                <div
                  onClick={() => coverRef.current?.click()}
                  className="h-48 rounded-2xl border border-[#1A1A1A] bg-[#050505] flex items-center justify-center cursor-pointer overflow-hidden hover:border-[#2A2A2A] transition-colors group"
                >
                  {coverPreview
                    ? <img src={coverPreview} alt="" className="w-full h-full object-cover" />
                    : <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl border border-[#1E1E1E] flex items-center justify-center group-hover:border-[#E8D200]/20 transition-colors">
                          <span className="text-[#333] text-xl">+</span>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#333] font-black">Add cover</span>
                      </div>
                  }
                </div>
                <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
              </div>
            </div>

            {/* Gallery */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#444] font-black mb-3">Gallery photos (up to {MAX_GALLERY})</p>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {galleryPreviews.map((src, i) => (
                  <div key={i} className="aspect-square rounded-2xl overflow-hidden border border-[#1A1A1A] relative group">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeGallery(i)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/80 text-white text-sm flex items-center justify-center leading-none border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    >×</button>
                  </div>
                ))}
                {galleryFiles.length < MAX_GALLERY && (
                  <div
                    onClick={() => galleryRef.current?.click()}
                    className="aspect-square rounded-2xl border border-dashed border-[#1A1A1A] bg-[#050505] flex items-center justify-center cursor-pointer hover:border-[#2A2A2A] transition-colors group"
                  >
                    <span className="text-[#333] text-2xl group-hover:text-[#555] transition-colors">+</span>
                  </div>
                )}
              </div>
              <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryChange} />
            </div>
          </FormSection>

          {/* ── Achievements ───────────────────────────────── */}
          <FormSection
            index="04"
            title="Achievements"
            description={`Up to ${MAX_ACHIEVEMENTS} stat cards shown on your athlete profile — PRs, titles, best times.`}
          >
            <div className="space-y-4">
              {achievements.map((a, i) => (
                <div key={i} className="bg-[#0A0A0A] border border-[#151515] rounded-2xl p-8">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#2A2A2A]">Achievement {i + 1}</span>
                    {achievements.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAchievements(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-[10px] text-red-400/50 hover:text-red-400 transition-colors border-none bg-transparent cursor-pointer font-black uppercase tracking-widest"
                      >Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Stat / value">
                      <input value={a.value} onChange={e => updateAchievement(i, 'value', e.target.value)} placeholder="e.g. 185kg, Sub-3hr, #1" className={inp} />
                    </Field>
                    <Field label="Title">
                      <input value={a.title} onChange={e => updateAchievement(i, 'title', e.target.value)} placeholder="e.g. Deadlift PB" className={inp} />
                    </Field>
                  </div>
                  <Field label="Context (optional)">
                    <input value={a.context} onChange={e => updateAchievement(i, 'context', e.target.value)} placeholder="e.g. British Natural Powerlifting Championship 2024" className={inp} />
                  </Field>
                </div>
              ))}
            </div>
            {achievements.length < MAX_ACHIEVEMENTS && (
              <button
                type="button"
                onClick={() => setAchievements(prev => [...prev, { ...BLANK_ACHIEVEMENT }])}
                className="w-full h-14 rounded-2xl border border-dashed border-[#151515] bg-transparent text-[#333] text-[10px] font-black uppercase tracking-[0.3em] hover:border-[#2A2A2A] hover:text-[#555] transition-all cursor-pointer"
              >
                + Add Achievement
              </button>
            )}
          </FormSection>

          {/* ── Submit ─────────────────────────────────────── */}
          <div className="py-20 border-t border-[#111]">
            {error && (
              <div className="mb-8 px-6 py-4 rounded-2xl border border-red-500/20 bg-red-500/6 text-red-400 text-sm text-center">
                {error}
              </div>
            )}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
              <p className="text-xs text-[#333] font-light leading-relaxed max-w-md">
                By submitting you agree to let POWR feature your profile on the platform. We'll be in touch once your application is reviewed.
              </p>
              <button
                type="submit"
                disabled={submitting}
                className={`shrink-0 h-16 px-16 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] transition-all shadow-lg shadow-[#E8D200]/10 ${submitting ? 'opacity-50 cursor-not-allowed' : 'hover:translate-y-[-2px] hover:shadow-[#E8D200]/20 cursor-pointer'}`}
              >
                {submitting ? 'Submitting…' : 'Submit Application'}
              </button>
            </div>
          </div>

        </div>
      </form>
    </Shell>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function FormSection({ index, title, description, required, children }) {
  return (
    <div className="py-16 border-b border-[#111] grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-12">
      <div className="lg:pt-1">
        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-[#2A2A2A] mb-3">{index}</div>
        <h2 className="text-2xl font-light tracking-tight text-[#DDD] mb-3">
          {title}
          {required && <span className="text-[#E8D200] ml-1">*</span>}
        </h2>
        <p className="text-[13px] text-[#444] font-light leading-relaxed">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">{label}</label>
      {children}
    </div>
  );
}

const inp = "w-full h-14 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl text-[#F2F2F2] text-sm font-light px-6 outline-none placeholder-[#2A2A2A] focus:border-[#E8D200]/30 transition-colors font-['Outfit']";
