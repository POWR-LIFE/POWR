import { useEffect, useState } from 'react';
import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { fetchEvents, PAST_EVENTS_FALLBACK } from '../data';
import { CARD, Check, Head, Pts, Reveal, Section, fmt } from '../ui';

/**
 * 05 — The gym floor, live. Evergreen by design: events come and go, so
 * the section explains HOW an event works and lets the data decide what
 * to show beside it — the current event (registering, live, or just
 * revealed) when there is one, otherwise the sealed "next event" card and
 * the track record of events already run. Nothing here is dated by hand.
 */
const STEPS = [
  { n: '01', title: 'Register in the app', body: 'Events open to members first. Tap in, and your week goes on the board.' },
  { n: '02', title: 'Train the week', body: 'Every verified session counts — gym, run, ride, swim. Streaks and multipliers don’t. The board is effort, not tenure.' },
  { n: '03', title: 'The doors', body: 'The board seals the night before. Winners are revealed at the venue, in the room, with the prizes on the table.' },
];

const RANK = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];

export default function Events() {
  const compact = useCompact(960);
  const [events, setEvents] = useState({ current: null, past: PAST_EVENTS_FALLBACK, live: false, loading: true });
  useEffect(() => {
    let alive = true;
    fetchEvents().then((e) => { if (alive) setEvents({ ...e, loading: false }); });
    return () => { alive = false; };
  }, []);

  return (
    <Section id="events" style={{ overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', left: '50%', top: '30%', width: 1100, height: 700, transform: 'translate(-50%,-50%)', background: 'radial-gradient(ellipse, rgba(232,210,0,0.07), transparent 60%)', pointerEvents: 'none' }} />
      <Head
        n="05" tag="The gym floor, live"
        title="A week of training. A live leaderboard. A room full of people who showed up."
        lede="Events turn one week of verified sessions into a leaderboard at a real venue, with prizes worth the effort. They run through the year; the next one is always announced in the app first."
      />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '0.9fr 1.1fr', gap: compact ? 28 : 44, alignItems: 'stretch' }}>
        {/* How an event works */}
        <Reveal amount={0.2}>
          <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold, marginBottom: 12 }}>HOW AN EVENT WORKS</div>
            {STEPS.map((s, i) => (
              <div key={s.n} style={{ display: 'flex', gap: 16, padding: '14px 0', borderTop: i ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                <span style={{ color: pg.accent, fontSize: 12, fontWeight: w.semiBold, letterSpacing: 3, paddingTop: 4, flexShrink: 0 }}>{s.n}</span>
                <span>
                  <div style={{ fontSize: 'clamp(17px, 1.4vw, 20px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.3 }}>{s.title}</div>
                  <div style={{ fontSize: 13.5, color: pg.textSec, lineHeight: 1.5, fontWeight: w.light, marginTop: 5 }}>{s.body}</div>
                </span>
              </div>
            ))}
            <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 12.5, color: pg.textMuted, lineHeight: 1.5 }}>
              Only points earned during the event week count. One board per venue; one winner per prize.
            </div>
          </div>
        </Reveal>

        {/* The live side */}
        <Reveal amount={0.2} delay={0.08}>
          {events.current ? <CurrentEvent ev={events.current} compact={compact} /> : <NextEvent past={events.past} compact={compact} />}
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Date helpers (en-GB, no library) ─────────────────────────────────── */
const DAY = 86_400_000;
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const monthYear = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const doorsLine = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(/\s/g, '');
  return `${day}, ${time}`;
};

/* Where the event is in its life, from the clock — mirrors the app's
   eventStatusChip / scoringLine so the site and the app never disagree. */
function phase(ev, now = Date.now()) {
  const start = new Date(ev.window_start_at).getTime();
  const end = new Date(ev.window_end_at).getTime();
  if (now < start) {
    const days = Math.max(0, Math.ceil((start - now) / DAY));
    const chip = days === 0 ? 'SCORING TODAY' : days === 1 ? 'SCORING TOMORROW' : `SCORING IN ${days} DAYS`;
    return { key: 'upcoming', chip, line: `Scoring starts ${shortDate(ev.window_start_at)}`, cta: 'Register in the app' };
  }
  if (now <= end) return { key: 'live', chip: 'LIVE NOW', line: `Scoring ends ${shortDate(ev.window_end_at)}`, cta: 'Follow the board in the app' };
  return { key: 'revealed', chip: 'WINNERS REVEALED', line: `Ran ${shortDate(ev.window_start_at)} – ${shortDate(ev.window_end_at)}`, cta: 'Get the app for the next one' };
}

function VenueChip({ ev, size = 52 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.27, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
      {ev.venueLogo
        ? <img src={ev.venueLogo} alt={ev.venue || ''} width={size} height={size} style={{ width: size * 0.76, height: size * 0.76, objectFit: 'contain' }} />
        : <span style={{ fontSize: size * 0.4, fontWeight: w.semiBold, color: '#111' }}>{(ev.venue || ev.name || '?')[0]}</span>}
    </span>
  );
}

function CurrentEvent({ ev, compact }) {
  const p = phase(ev);
  const doors = doorsLine(ev.doors_open_at);
  const prizes = (ev.prizes || []).slice(0, 4);
  return (
    <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 18, background: 'linear-gradient(180deg, #151515, #0f0f0f)', borderColor: p.key === 'live' ? 'rgba(232,210,0,0.35)' : CARD.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <VenueChip ev={ev} />
        <span style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.key === 'live' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: pg.accent, boxShadow: `0 0 10px ${pg.accent}` }} />}
            <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>{p.chip}</span>
          </div>
          <div style={{ fontSize: 'clamp(24px, 2.2vw, 30px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.6, marginTop: 4 }}>{ev.name}</div>
        </span>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 18px', fontSize: 14 }}>
        {ev.venue && <Row k="Venue" v={ev.venue_address ? `${ev.venue} · ${shortAddress(ev.venue_address)}` : ev.venue} />}
        <Row k="Scoring" v={`${shortDate(ev.window_start_at)} – ${shortDate(ev.window_end_at)}`} />
        {doors && <Row k="The night" v={doors} />}
        {ev.participants > 0 && <Row k="Board" v={`${fmt(ev.participants)} in so far`} />}
      </dl>
      {prizes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(prizes.length, compact ? 2 : 4)}, 1fr)`, gap: 10 }}>
          {prizes.map((pr, i) => (
            <figure key={pr.rank ?? i} style={{ margin: 0, position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '4 / 5', background: '#0e0e0e', border: '1px solid rgba(255,255,255,0.08)' }}>
              {pr.img && <img src={pr.img} alt={pr.label} loading="lazy" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', maxWidth: 'none' }} />}
              <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.85) 100%)' }} />
              <span style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 999, background: i === 0 ? pg.accent : 'rgba(0,0,0,0.6)', color: i === 0 ? pg.onAccent : pg.text, fontSize: 9.5, fontWeight: w.semiBold, letterSpacing: 1.8, border: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.14)' }}>
                {RANK[i]}
              </span>
              <figcaption style={{ position: 'absolute', left: 10, right: 10, bottom: 10, fontSize: 12, color: pg.text, fontWeight: w.medium, lineHeight: 1.3 }}>{pr.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <div style={{ marginTop: 'auto', paddingTop: 6 }}>
        <a href="#download" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999, background: pg.accent, color: pg.onAccent, fontSize: 13, fontWeight: w.semiBold, textDecoration: 'none' }}>
          {p.cta}
        </a>
      </div>
    </div>
  );
}

/* No event on the board: the app's sealed-board idea — a seal, a promise,
   and the record of what has already been run. */
function NextEvent({ past, compact }) {
  return (
    <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 18, background: 'linear-gradient(180deg, #151515, #0f0f0f)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,210,0,0.12), transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Seal />
        <span>
          <div style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>NEXT EVENT</div>
          <div style={{ fontSize: 'clamp(22px, 2vw, 28px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.5, marginTop: 4 }}>Announced in the app first.</div>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 14, color: pg.textSec, lineHeight: 1.55, fontWeight: w.light }}>
        Members get first entry and a push the moment registration opens. The board stays sealed until then — no date, no venue, no leaks.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['Registration opens in the app', 'One week of verified sessions', 'Winners revealed at the doors'].map((r) => (
          <li key={r} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: pg.textSec }}><Check size={12} />{r}</li>
        ))}
      </ul>

      {past.length > 0 && (
        <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontSize: 10.5, letterSpacing: 2.4, color: pg.textMuted, fontWeight: w.semiBold }}>ALREADY RUN</span>
            <span style={{ fontSize: 11, color: pg.textMuted }}>{past.length} {past.length === 1 ? 'event' : 'events'}</span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {past.slice(0, 4).map((ev) => (
              <li key={ev.slug} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <VenueChip ev={ev} size={34} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, color: pg.text, fontWeight: w.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: pg.textMuted, marginTop: 2 }}>
                    {[ev.venue, monthYear(ev.window_start_at), ev.participants ? `${fmt(ev.participants)} competitors` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {(ev.prizes?.length > 0) && <Pts size={10.5}>{ev.prizes.length} PRIZES</Pts>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ paddingTop: 4 }}>
        <a href="#download" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999, background: pg.accent, color: pg.onAccent, fontSize: 13, fontWeight: w.semiBold, textDecoration: 'none' }}>
          Get the app for first entry
        </a>
      </div>
    </div>
  );
}

/* The app's board seal — lock on a gold disc inside two slow counter-rotating arcs */
function Seal({ size = 64 }) {
  return (
    <span style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ position: 'absolute', inset: 0, animation: 'powrSpin 18s linear infinite' }}>
        <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(232,210,0,0.55)" strokeWidth="1.2" strokeDasharray="60 40 30 52" strokeLinecap="round" />
      </svg>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ position: 'absolute', inset: 0, animation: 'powrSpin 26s linear infinite reverse' }}>
        <circle cx="32" cy="32" r="23" fill="none" stroke="rgba(232,210,0,0.3)" strokeWidth="1" strokeDasharray="40 24 50 30" strokeLinecap="round" />
      </svg>
      <span style={{ width: size * 0.5, height: size * 0.5, borderRadius: '50%', background: pg.accent, display: 'grid', placeItems: 'center', boxShadow: '0 0 24px rgba(232,210,0,0.45)' }}>
        <svg width={size * 0.24} height={size * 0.24} viewBox="0 0 24 24" fill="none" stroke={pg.onAccent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
    </span>
  );
}

const shortAddress = (addr) => {
  const parts = String(addr).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(-2).join(', ').replace(/\s+\w{1,2}\d\w?\s*\d\w{2}$/i, '') : addr;
};

function Row({ k, v }) {
  return (
    <>
      <dt style={{ color: pg.textMuted, fontSize: 11, letterSpacing: 2, fontWeight: w.semiBold, textTransform: 'uppercase', alignSelf: 'center' }}>{k}</dt>
      <dd style={{ margin: 0, color: pg.text, fontWeight: w.light }}>{v}</dd>
    </>
  );
}
