import { useEffect, useState } from 'react';
import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { SERIES_FALLBACK, fetchSeries } from '../data';
import { CARD, Check, Head, Item, Parallax, Pts, Reveal, Section, Stagger, fmt } from '../ui';

/**
 * 05 — The Series. POWR's competition: a season of rounds on one live board,
 * free to enter, with prizes for more than first place. Evergreen by design,
 * like the events section it replaced: the left card explains how a round
 * works, the right card wears the season (its ground colour and the butter
 * P, as the app does) and lets the clock decide what it shows — the start
 * line before the gun, the board while a round is on, the next round once
 * one has finished, a sealed card before a season is published. Nothing
 * here is dated by hand; the numbers are the app's own. The two cards
 * arrive from either side, the ways to win cascade in, and the season's P
 * drifts behind the card as the page scrolls.
 */

/* One ground colour per season, from components/series/season.tsx. */
const SEASON_GROUND = { autumn: '#013E37', winter: '#13294B', spring: '#4A1E43', summer: '#5A2A14' };
const BUTTER = '#FFEFB3';
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return `#${A.map((x, i) => Math.round(x * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
};
const alpha = (h, a) => `rgba(${rgbOf(h).join(',')},${a})`;

/* The POWR P, as the app draws it (components/series/pCrowd.ts). */
const P_W = 760.59;
const P_H = 531.05;
const P_LEG = 'M251.65 0.00 L505.45 0.00 A78.00 78.00 0 0 0 465.67 41.58 L283.61 490.33 A65.25 65.25 0 0 1 223.14 531.05 L0.00 531.05 L201.84 33.54 A53.75 53.75 0 0 1 251.65 0.00 Z';
const P_BOWL = 'M556.68 0.00 L719.59 0.00 A41.00 41.00 0 0 1 757.59 56.41 L644.27 335.71 A68.25 68.25 0 0 1 581.03 378.30 L361.61 378.30 L499.46 38.54 A61.75 61.75 0 0 1 556.68 0.00 Z';

/* The round's prizes, named as the app names them (series.json → prizes). */
const WAYS = [
  { kind: 'place', name: 'Champion', how: 'First on the board. Contender and Challenger, second and third, win too.' },
  { kind: 'patient_zero', name: 'Squad Builder', how: 'Most friends brought in. A friend counts once they’ve worked out.' },
  { kind: 'hot_streak', name: 'Unbreakable', how: 'Most days in a row with a session that counts.' },
  { kind: 'biggest_mover', name: 'Level Up', how: 'Most places climbed from the end of day 3 to the finish.' },
  { kind: 'rookie', name: 'Rookie of the Series', how: 'Best newcomer: joined POWR in the 30 days before the round, or during it.' },
  { kind: 'draw', name: 'Every Move Counts', how: (need, days) => `A draw from everyone active on ${need} of the ${days} days.` },
];

export default function Series() {
  const compact = useCompact(960);
  const [series, setSeries] = useState({ ...SERIES_FALLBACK, live: false, loading: true });
  const now = useClock();
  useEffect(() => {
    let alive = true;
    fetchSeries().then((s) => { if (alive) setSeries({ ...s, loading: false }); });
    return () => { alive = false; };
  }, []);

  const round = series.round || series.next_round || SERIES_FALLBACK.round;
  const days = roundDays(round);
  const need = round.draw_days || SERIES_FALLBACK.round.draw_days;
  const prizes = series.round?.prizes || [];
  const season = series.season?.name || 'the season';

  const STEPS = [
    { n: '01', title: 'Join in the app', body: `One tap, free to enter. It covers every round of the ${season}, and your name goes on the board.` },
    { n: '02', title: 'Train the round', body: 'Every verified session earns Series points — gym, run, ride, swim, walk. Everyone starts on 0 at the gun. Most points wins.' },
    { n: '03', title: 'Prizes land', body: `The top three win, and so do the named prizes — one each. Move on ${need} of the ${days} days and you’re in the draw as well.` },
  ];

  return (
    <Section id="series" style={{ overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', left: '50%', top: '30%', width: 1100, height: 700, transform: 'translate(-50%,-50%)', background: 'radial-gradient(ellipse, rgba(232,210,0,0.07), transparent 60%)', pointerEvents: 'none' }} />
      <Head
        n="05" tag="The Series"
        title="One board for everyone. A season of rounds. Prizes for more than first place."
        lede="The Series is POWR’s competition, free to enter. Join once in the app and every verified session counts towards the round’s live board. First place wins, and so does whoever brings the most friends, moves the most days in a row, climbs the furthest, or only just joined."
      />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '0.9fr 1.1fr', gap: compact ? 28 : 44, alignItems: 'stretch' }}>
        {/* How a round works */}
        <Reveal from="left" amount={0.2}>
          <Stagger gap={0.12} delay={0.25} amount={0.2} style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold, marginBottom: 12 }}>HOW THE SERIES WORKS</div>
            {STEPS.map((s, i) => (
              <Item key={s.n} from="left" dist={0.5} duration={0.7} style={{ display: 'flex', gap: 16, padding: '14px 0', borderTop: i ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                <span style={{ color: pg.accent, fontSize: 12, fontWeight: w.semiBold, letterSpacing: 3, paddingTop: 4, flexShrink: 0 }}>{s.n}</span>
                <span>
                  <div style={{ fontSize: 'clamp(17px, 1.4vw, 20px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.3 }}>{s.title}</div>
                  <div style={{ fontSize: 13.5, color: pg.textSec, lineHeight: 1.5, fontWeight: w.light, marginTop: 5 }}>{s.body}</div>
                </span>
              </Item>
            ))}
            <Item from="up" dist={0.4} duration={0.7} style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 12.5, color: pg.textMuted, lineHeight: 1.5 }}>
              Up to 120 active minutes a day count. The round’s moments boost up to ×2 and never stack. Blind Mode hides every rank while it’s on. Prizes never cost points.
            </Item>
          </Stagger>
        </Reveal>

        {/* The season, live */}
        <Reveal from="right" dist={1.1} amount={0.2} delay={0.08}>
          {series.season && series.round
            ? <SeasonCard s={series} now={now} />
            : <SealedCard season={series.season} />}
        </Reveal>
      </div>

      {/* Ways to win */}
      <div style={{ marginTop: compact ? 28 : 44 }}>
        <Reveal from="up" dist={0.5} amount={0.5} style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', justifyContent: 'space-between', alignItems: compact ? 'flex-start' : 'baseline', gap: compact ? 6 : 16, marginBottom: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold, whiteSpace: 'nowrap' }}>WAYS TO WIN</span>
          <span style={{ fontSize: 12.5, color: pg.textMuted, fontWeight: w.light }}>One prize each. Win two and the next in line takes the other.</span>
        </Reveal>
        <Stagger gap={0.08} amount={0.2} style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 10 }}>
          {WAYS.map((way) => {
            const prize = prizeFor(prizes, way.kind);
            const how = typeof way.how === 'function' ? way.how(need, days) : way.how;
            return (
              <Item key={way.kind} from="up" scale={0.96} duration={0.7} style={{ ...CARD, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 112 }}>
                <div style={{ fontSize: 'clamp(16px, 1.3vw, 18px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.3 }}>{way.name}</div>
                <div style={{ fontSize: 12.5, color: pg.textSec, lineHeight: 1.45, fontWeight: w.light }}>{how}</div>
                {prize && (
                  <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                    <Pts size={10.5}>{prizeLabel(prize)}</Pts>
                  </div>
                )}
              </Item>
            );
          })}
        </Stagger>
      </div>
    </Section>
  );
}

/* ── The clock, once a minute: the start line fills and the countdown turns ── */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ── Date helpers (en-GB, London, no library) ────────────────────────── */
const DAY = 86_400_000;
const LON = { timeZone: 'Europe/London' };
const dayMonth = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...LON });
const dayMonthLong = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...LON });
/* A round ends at midnight, so its last day is the day before ends_at. */
const lastDay = (r) => dayMonth(new Date(Date.parse(r.ends_at) - 3_600_000).toISOString());
const roundDays = (r) => Math.max(1, Math.round((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / DAY));
const countdown = (ms) => {
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d} ${d === 1 ? 'DAY' : 'DAYS'} · ${h} ${h === 1 ? 'HR' : 'HRS'}`;
  if (h > 0) return `${h} ${h === 1 ? 'HR' : 'HRS'} · ${m} MIN`;
  return `${Math.max(1, m)} MIN`;
};

/* The crowd on the start line — the app's crowdAt (lib/api/series.ts):
   real members waiting plus the pacers who fill the line towards the gun. */
function crowdAt(c, t) {
  if (!c) return null;
  const from = Date.parse(c.ramp_from);
  const to = Date.parse(c.ramp_to);
  const p = to > from ? Math.min(1, Math.max(0, (t - from) / (to - from))) : 1;
  const base = Number(c.base);
  return c.real + Math.round(c.pacers_at_gun * (base + (1 - base) * p));
}
const crowdAtGun = (c) => (c ? c.real + c.pacers_at_gun : null);

/* Where the round is in its life, from the clock — the app's own states. */
function phase(s, now) {
  const r = s.round;
  const start = Date.parse(r.starts_at);
  const end = Date.parse(r.ends_at);
  const days = roundDays(r);
  const name = r.name.toUpperCase();
  if (now < start) return { key: 'before', chip: `${name} · STARTS ${dayMonth(r.starts_at).toUpperCase()}`, cta: 'Join in the app', days };
  if (now < end) {
    const day = Math.min(days, Math.floor((now - start) / DAY) + 1);
    return { key: 'on', chip: `${name} · DAY ${day} OF ${days}`, cta: 'Join in the app', days, day, left: days - day + 1 };
  }
  return { key: 'done', chip: `${name} · FINISHED`, cta: 'Get the app for the next round', days };
}

const prizeFor = (prizes, kind) => (kind === 'place'
  ? prizes.find((p) => p.kind === 'place' && p.place === 1) || prizes.find((p) => p.kind === 'place')
  : prizes.find((p) => p.kind === kind)) || null;
const prizeLabel = (p) => [p.name, p.winners > 1 ? `×${p.winners}` : null].filter(Boolean).join(' ');

function PMark({ height = 40, color = BUTTER, style }) {
  return (
    <svg height={height} width={height * (P_W / P_H)} viewBox={`0 0 ${P_W} ${P_H}`} aria-hidden style={{ display: 'block', flexShrink: 0, ...style }}>
      <path d={P_LEG} fill={color} />
      <path d={P_BOWL} fill={color} />
    </svg>
  );
}

function SeasonCard({ s, now }) {
  const r = s.round;
  const p = phase(s, now);
  const ground = SEASON_GROUND[s.season.look] || SEASON_GROUND.autumn;
  const prizes = r.prizes || [];
  const first = prizeFor(prizes, 'place') || prizes[0] || null;
  const prizeLine = !first ? 'To be announced' : prizes.length > 1 ? `${first.name} · +${prizes.length - 1} more` : first.name;
  const waiting = p.key === 'before' ? crowdAt(r.crowd, now) : p.key === 'on' ? crowdAtGun(r.crowd) : null;
  const no = `Nº ${String(s.season.number ?? 1).padStart(2, '0')}${s.season.code ? ` — ${s.season.code}` : ''}`;
  const span = `${dayMonth(r.starts_at)} – ${lastDay(r)}`;

  return (
    <div
      style={{
        ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 18, position: 'relative', overflow: 'hidden',
        background: `radial-gradient(80% 50% at 50% 0%, ${alpha(mix(ground, '#FFFFFF', 0.82), 0.9)}, transparent 70%), linear-gradient(180deg, ${ground} 0%, ${mix(ground, '#030303', 0.4)} 100%)`,
        border: `1px solid ${alpha(BUTTER, p.key === 'on' ? 0.4 : 0.2)}`,
      }}
    >
      <Parallax y={[34, -34]} style={{ position: 'absolute', right: -40, bottom: -46, pointerEvents: 'none' }}>
        <PMark height={190} color={BUTTER} style={{ opacity: 0.07 }} />
      </Parallax>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: alpha(BUTTER, 0.1), border: `1px solid ${alpha(BUTTER, 0.25)}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <PMark height={22} />
        </span>
        <span style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.key === 'on' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: BUTTER, boxShadow: `0 0 10px ${BUTTER}` }} />}
            <span style={{ fontSize: 11, letterSpacing: 2.6, color: BUTTER, fontWeight: w.semiBold }}>{p.chip}</span>
          </div>
          <div style={{ fontSize: 'clamp(24px, 2.2vw, 30px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.6, marginTop: 4 }}>{s.season.name}</div>
          <div style={{ fontSize: 12, color: alpha(BUTTER, 0.6), letterSpacing: 1.2, marginTop: 2 }}>
            {no}{s.season.rounds > 1 ? ` · ${s.season.rounds} rounds` : ''}
          </div>
        </span>
      </div>

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 18px', fontSize: 14, position: 'relative' }}>
        {p.key === 'before' && <Row k="The round" v={`${span} · ${p.days} days`} />}
        {p.key === 'on' && <Row k="The round" v={`${span} · ${p.left === 1 ? 'last day' : `${p.left} days left`}`} />}
        {p.key === 'done' && <Row k="The round" v={`${span} · finished`} />}
        {p.key !== 'done' && <Row k="The draw" v={`Move on ${r.draw_days} of the ${p.days} days`} />}
        {p.key === 'before' && waiting > 0 && <Row k="Start line" v={`${fmt(waiting)} waiting`} />}
        {p.key === 'on' && waiting > 0 && <Row k="The board" v={`${fmt(waiting)} racing`} />}
        <Row k="Prizes" v={p.key === 'done' ? 'Winners in the app' : prizeLine} />
        {p.key === 'done' && <Row k="Next" v={s.next_round ? `${s.next_round.name} · ${dayMonth(s.next_round.starts_at)}` : 'Next season, announced in the app first'} />}
      </dl>

      {p.key === 'before' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', position: 'relative' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, border: `1px solid ${alpha(BUTTER, 0.35)}`, background: alpha(BUTTER, 0.08), color: BUTTER, fontSize: 11, fontWeight: w.semiBold, letterSpacing: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: BUTTER, boxShadow: `0 0 8px ${BUTTER}`, animation: 'powrBreathe 2.4s ease-in-out infinite' }} />
            {countdown(Date.parse(r.starts_at) - now)} TO THE GUN
          </span>
          {s.prev_round && <span style={{ fontSize: 12, color: alpha(BUTTER, 0.6) }}>{s.prev_round.name} finished · winners in the app</span>}
        </div>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
        <a href="#download" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999, background: pg.accent, color: pg.onAccent, fontSize: 13, fontWeight: w.semiBold, textDecoration: 'none' }}>
          {p.cta}
        </a>
        <span style={{ fontSize: 12, color: alpha(BUTTER, 0.55), lineHeight: 1.5 }}>
          {p.key === 'before' && `Free to enter · one tap covers every round of the ${s.season.name}`}
          {p.key === 'on' && `Joining late costs nothing: every session since ${dayMonth(r.starts_at)} counts.`}
          {p.key === 'done' && (s.next_round ? `Starts ${dayMonthLong(s.next_round.starts_at)} · everyone starts on 0 at the gun` : 'Everyone starts on 0 at the next gun')}
        </span>
      </div>
    </div>
  );
}

/* No season published: the app's sealed-board idea — a promise and the rules
   that never change. */
function SealedCard({ season }) {
  return (
    <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 18, background: 'linear-gradient(180deg, #151515, #0f0f0f)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,210,0,0.12), transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: alpha(BUTTER, 0.08), border: `1px solid ${alpha(BUTTER, 0.2)}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <PMark height={22} />
        </span>
        <span>
          <div style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>NEXT SEASON</div>
          <div style={{ fontSize: 'clamp(22px, 2vw, 28px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.5, marginTop: 4 }}>{season?.name || 'Announced in the app first.'}</div>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 14, color: pg.textSec, lineHeight: 1.55, fontWeight: w.light }}>
        Members get a push the moment the next round opens. Everyone starts on 0 at the gun, so there is nothing to catch up on.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['Free to enter, one tap in the app', 'Every verified session counts', 'Prizes for more than first place'].map((t) => (
          <li key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: pg.textSec }}><Check size={12} />{t}</li>
        ))}
      </ul>
      <div style={{ marginTop: 'auto', paddingTop: 4 }}>
        <a href="#download" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999, background: pg.accent, color: pg.onAccent, fontSize: 13, fontWeight: w.semiBold, textDecoration: 'none' }}>
          Get the app for the gun
        </a>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <>
      <dt style={{ color: alpha(BUTTER, 0.6), fontSize: 11, letterSpacing: 2, fontWeight: w.semiBold, textTransform: 'uppercase', alignSelf: 'center' }}>{k}</dt>
      <dd style={{ margin: 0, color: pg.text, fontWeight: w.light }}>{v}</dd>
    </>
  );
}
