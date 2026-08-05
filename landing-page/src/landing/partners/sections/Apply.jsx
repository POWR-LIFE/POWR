import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../../../lib/supabase';
import { pg, w } from '../../theme';
import { GhostLabel, GoldButton, Panel, Section, SectionHead, rise } from '../bits';
import { useCompact } from '../../stages/shared';

/**
 * 07 — APPLY. The form the old static page carried, ported unchanged in
 * behaviour: an anon insert into `partner_applications`, with the duplicate
 * -email unique violation (23505) surfaced as plain English. It is a live
 * intake channel — applications land in it weekly — so the contract with the
 * table must not drift: { brand, category, name, email, offer }.
 */
const CATEGORIES = [
  { value: 'eat', label: 'Eat — Nutrition & Food' },
  { value: 'move', label: 'Move — Activewear & Gear' },
  { value: 'mind', label: 'Mind — Wellness & Mental Health' },
  { value: 'sleep', label: 'Sleep — Recovery & Rest' },
];

const EMPTY = { brand: '', category: '', name: '', email: '', offer: '' };

export default function Apply() {
  const compact = useCompact(900);
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const ready = form.brand.trim() && form.category && form.name.trim() && form.email.trim();

  async function onSubmit(e) {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError('');
    try {
      if (!supabase) throw new Error('Something went wrong. Please email support@powr.life.');
      const { error: insertError } = await supabase.from('partner_applications').insert([{
        brand: form.brand.trim(),
        category: form.category,
        name: form.name.trim(),
        email: form.email.trim(),
        offer: form.offer.trim() || null,
      }]);
      if (insertError) {
        if (insertError.code === '23505') throw new Error('You’ve already applied with this email.');
        throw insertError;
      }
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Section id="apply" style={{ overflow: 'hidden' }}>
      <GhostLabel bottom={-10} left={-20} gold>APPLY</GhostLabel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 420px) minmax(0, 1fr)',
          gap: compact ? 40 : 64,
          alignItems: 'start',
        }}
      >
        <div>
          <SectionHead
            n="07"
            label="Apply"
            title={<>Put your brand<br />in the lineup.</>}
            body="Tell us who you are and what you’d offer. If it fits, we build the listing and come back to you with it — normally the same week."
          />
          <motion.p variants={rise} style={{ fontSize: 13, color: pg.textMuted, fontWeight: w.light, lineHeight: 1.6 }}>
            Already a partner? <a href="/partner/login" style={{ color: pg.accent, textDecoration: 'none' }}>Sign in to the portal</a>.
            <br />
            Prefer email? <a href="mailto:support@powr.life" style={{ color: pg.accent, textDecoration: 'none' }}>support@powr.life</a>
          </motion.p>
        </div>

        <Panel lit style={{ padding: compact ? '28px 24px' : '36px 38px' }}>
          {sent ? (
            <div style={{ padding: '30px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 'clamp(24px, 3vw, 34px)', fontWeight: w.extraLight, letterSpacing: -1, color: pg.text }}>
                Application received.
              </div>
              <p style={{ marginTop: 14, fontSize: 14, color: pg.textSec, fontWeight: w.light }}>
                We’ll be in touch shortly.
              </p>
            </div>
          ) : (
            // Native validation, deliberately: a gold CTA that sits dimmed
            // until every field is filled reads as a broken button on load
            <form onSubmit={onSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 18 }}>
                <Field label="Brand name" htmlFor="brand">
                  <input id="brand" style={inputStyle} value={form.brand} onChange={set('brand')} placeholder="e.g. Grenade" required />
                </Field>
                <Field label="Category" htmlFor="category">
                  <select id="category" style={inputStyle} value={form.category} onChange={set('category')} required>
                    <option value="" disabled>Select category</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value} style={{ background: pg.surface1 }}>{c.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Your name" htmlFor="name">
                  <input id="name" style={inputStyle} value={form.name} onChange={set('name')} placeholder="First & last name" required />
                </Field>
                <Field label="Email" htmlFor="email">
                  <input id="email" type="email" style={inputStyle} value={form.email} onChange={set('email')} placeholder="you@brand.com" required />
                </Field>
              </div>

              <div style={{ marginTop: 18 }}>
                <Field label="Your offer" htmlFor="offer" optional>
                  <textarea
                    id="offer"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 88, paddingTop: 12 }}
                    value={form.offer}
                    onChange={set('offer')}
                    placeholder="What would POWR members get? e.g. 20% off all orders, a free trial…"
                  />
                </Field>
              </div>

              {error && (
                <p style={{ marginTop: 18, fontSize: 13, color: '#FF6B6B', fontWeight: w.light }} role="alert">{error}</p>
              )}

              <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <GoldButton type="submit" disabled={sending}>
                  {sending ? 'Sending…' : 'Apply to partner'}
                </GoldButton>
                {/* No pricing claim here — POWR intends to charge for
                    placements, so "no cost to list" is a promise with a
                    shelf life. Same rule as the NO_NEED list in Listing.jsx. */}
                <span style={{ fontSize: 11.5, color: pg.textMuted, fontWeight: w.light }}>
                  Selective onboarding
                </span>
              </div>
            </form>
          )}
        </Panel>
      </div>
    </Section>
  );
}

function Field({ label, htmlFor, optional, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        style={{
          display: 'block', marginBottom: 8, fontSize: 10, fontWeight: w.semiBold,
          letterSpacing: 2, textTransform: 'uppercase', color: pg.textSec,
        }}
      >
        {label}
        {optional && <span style={{ marginLeft: 8, opacity: 0.5, letterSpacing: 1 }}>Optional</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '13px 14px', borderRadius: 12,
  background: 'rgba(255,255,255,0.03)', border: `1px solid ${pg.border}`,
  color: pg.text, fontSize: 14, fontWeight: 300, fontFamily: 'inherit',
  outline: 'none',
};
