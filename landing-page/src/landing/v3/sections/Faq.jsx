import { useState } from 'react';
import { pg, w } from '../../theme';
import { CARD, Chevron, Head, Reveal, Section, fmt } from '../ui';

/**
 * 07 — Questions. Native <details> so the answers are in the HTML for search
 * engines and screen readers; React only decorates the chevron.
 */
export default function Faq({ stats }) {
  const QA = [
    { q: 'Is POWR free?', a: 'Yes. Free to download on iOS and Android, free to earn. Points come from moving — there is nothing to buy.' },
    { q: 'How does POWR know I was at the gym?', a: 'Your phone\'s location, checked against the gym\'s geofence. Arrive and a session starts on its own; stay thirty minutes and it pays 15 points, forty minutes pays 20. No check-in button, no QR code, no photo of the treadmill.' },
    { q: 'Which gyms count?', a: `${fmt(stats.partners)} partner gyms across the UK — chains like Everlast, Virgin Active and Anytime Fitness, and thousands of independents. Search yours above. If it's missing, request it from the Discover tab in the app and we'll add it.` },
    { q: 'Which wearables and apps connect?', a: 'Apple Health and Health Connect out of the box, plus WHOOP, Garmin, Oura, Fitbit, Strava and more through a single connection. Runs, rides, swims, sport, yoga, sleep and steps all count.' },
    { q: 'Can I game it?', a: 'Not usefully. Gym points need your phone inside the geofence for the whole session; workouts need a device record; manual logs earn at a reduced, capped rate. Every award is bounded per session and per day, so the numbers stay honest for everyone.' },
    { q: 'What can I spend points on?', a: 'Live rewards from HUEL, MAJIC, TRIBE, REP, FRANk, SWT, OMNITY and MATHAN — discounts and codes at their checkouts. The vault above is the live catalogue; a code lands in your wallet the moment you redeem.' },
    { q: 'Does walking count?', a: 'Yes — up to 5 points a day for 10,000 steps, and up to 5 for a full night\'s sleep. Gym sessions, runs, rides and swims are where the big numbers are.' },
  ];
  return (
    <Section id="faq">
      <Head n="07" tag="Questions" title="Straight answers." center />
      <Reveal amount={0.1} style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ ...CARD, borderRadius: 20, overflow: 'hidden' }}>
          {QA.map((item, i) => <Item key={item.q} {...item} first={i === 0} />)}
        </div>
      </Reveal>
    </Section>
  );
}

function Item({ q, a, first }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.07)' }}
    >
      <summary
        style={{
          listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          padding: '20px 24px', fontSize: 'clamp(16px, 1.3vw, 18px)', fontWeight: w.light, color: pg.text, userSelect: 'none',
        }}
      >
        <span>{q}</span>
        <Chevron open={open} />
      </summary>
      <div style={{ padding: '0 24px 22px', fontSize: 14.5, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light, maxWidth: 680 }}>{a}</div>
    </details>
  );
}
