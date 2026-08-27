import { motion } from 'framer-motion';
import { pg, t, w } from '../../theme';
import { GhostLabel, GoldButton, Kicker, Panel, Section, SectionHead, rise } from '../../partners/bits';
import { useCompact } from '../../stages/shared';
import { INVITEE_PTS, WAY_IN } from '../data';

/**
 * 05 — THE WAY IN. There is no form on this page, on purpose.
 *
 * The programme is invite-only and the invite is EARNED inside the app: a
 * member whose code has brought in `threshold` people who each logged a
 * verified first workout inside `windowDays` is asked on Home, taps ASK TO
 * JOIN, and a person approves it. So the application IS downloading the app
 * and bringing people in — which is also the only proof that matters.
 *
 * The panel on the right gives the two people who aren't served by that
 * path a door: someone already invited (open the app), and someone with a
 * real audience who wants the first cohort (email — admins hand-invite).
 */
const STEPS = [
  {
    n: '01',
    title: 'Get the app',
    body: `You get a POWR ID the moment you sign up. It is already an invite code: every friend who joins with it earns you both ${INVITEE_PTS} points on their first verified workout. Nothing to apply for.`,
    ui: <PowrIdChip />,
  },
  {
    n: '02',
    title: `Bring ${WAY_IN.threshold} people in`,
    body: `${WAY_IN.threshold} people who join with your code and each log a verified first workout, inside ${WAY_IN.windowDays} days. Not ${WAY_IN.threshold} downloads — ${WAY_IN.threshold} people who trained. If your audience really moves, this takes a couple of weeks.`,
    ui: <ThreeDots />,
  },
  {
    n: '03',
    title: 'We ask you',
    body: `A card lands on your Home screen the moment the ${WAY_IN.threshold === 5 ? 'fifth' : 'last'} one converts. One tap files your request — no form, no pitch, no follower count. A real person reads every one.`,
    ui: <AskCard />,
  },
  {
    n: '04',
    title: 'Your ladder switches on',
    body: 'Approved, you get a push, Affiliate appears under Settings, your link page goes live and the portal is yours. Accept the terms once, and start sharing.',
    ui: <ApprovedRow />,
  },
];

export default function WayIn() {
  const compact = useCompact(900);
  return (
    <Section id="apply" style={{ overflow: 'hidden' }}>
      <GhostLabel bottom={-10} left={-20} gold>THE WAY IN</GhostLabel>

      <SectionHead
        n="05"
        label="The way in"
        title={<>You don’t apply.<br />You earn the invite.</>}
        body="There is no form because a form can’t tell us the one thing we need to know: whether the people you bring in actually train. So the application is the app. Bring five people in and we come to you."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) minmax(0, 360px)',
          gap: compact ? 36 : 56,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {STEPS.map((s) => (
            <Panel key={s.n} style={{ padding: compact ? '22px 20px' : '26px 28px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) 200px',
                  gap: compact ? 16 : 28, alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 24, fontWeight: w.extraLight, color: pg.accent, lineHeight: 1 }}>{s.n}</span>
                    <h3 style={{ margin: 0, fontSize: 19, fontWeight: w.medium, letterSpacing: -0.4, color: pg.text }}>{s.title}</h3>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62, color: pg.textSec, fontWeight: w.light }}>{s.body}</p>
                </div>
                <div style={{ display: 'flex', justifyContent: compact ? 'flex-start' : 'flex-end' }}>{s.ui}</div>
              </div>
            </Panel>
          ))}
        </div>

        <div style={{ position: compact ? 'static' : 'sticky', top: 110, display: 'grid', gap: 12 }}>
          <Panel lit style={{ padding: compact ? '26px 24px' : '30px 28px' }}>
            <Kicker color={pg.accent}>Start here</Kicker>
            <h3 style={{ margin: '12px 0 0', fontSize: 'clamp(22px, 2.4vw, 28px)', fontWeight: w.extraLight, letterSpacing: -0.8, lineHeight: 1.1, color: pg.text }}>
              The application is
              <br />
              in your pocket.
            </h3>
            <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
              Install POWR, find your POWR ID under Settings, and send it to the five people
              most likely to show up. Everything else follows.
            </p>
            <div style={{ marginTop: 20 }}>
              <GoldButton href="/app" style={{ width: '100%' }}>Get the app</GoldButton>
            </div>
          </Panel>

          <Panel style={{ padding: '22px 24px' }}>
            <Kicker color={pg.textMuted}>Already invited?</Kicker>
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
              Your affiliate home is in the app under Settings › Affiliate.{' '}
              <a href="/app?to=affiliate" style={{ color: pg.accent, textDecoration: 'none' }}>Open it in POWR</a>.
            </p>
          </Panel>

          <Panel style={{ padding: '22px 24px' }}>
            <Kicker color={pg.textMuted}>Run a gym, a club or a big audience?</Kicker>
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
              We hand-invite a small first cohort. Tell us who you are and where your people are —{' '}
              <a href="mailto:support@powr.life?subject=POWR%20Affiliates" style={{ color: pg.accent, textDecoration: 'none' }}>support@powr.life</a>.
            </p>
          </Panel>

          <motion.p variants={rise} style={{ margin: '4px 4px 0', fontSize: 11.5, lineHeight: 1.6, color: pg.textMuted, fontWeight: w.light }}>
            18 or over, one account per person, and every post that carries your link says it is one — #ad is
            enough. The rest is in the{' '}
            <a href="/affiliate/terms" style={{ color: pg.textSec, textDecoration: 'none', borderBottom: `1px solid ${pg.border}` }}>terms</a>.
          </motion.p>
        </div>
      </div>
    </Section>
  );
}

/* ── Tiny product surfaces beside each step. App tokens, app anatomy. ── */

const mini = {
  card: {
    width: 200, maxWidth: '100%', borderRadius: 16, padding: '12px 14px',
    background: t.cardBg, border: `1px solid ${t.borderCard}`, boxSizing: 'border-box',
  },
  eyebrow: { fontSize: 9, letterSpacing: 2.2, textTransform: 'uppercase', color: t.accent, fontWeight: w.semiBold },
};

function PowrIdChip() {
  return (
    <div style={mini.card}>
      <div style={mini.eyebrow}>Your POWR ID</div>
      <div style={{ marginTop: 6, fontSize: 20, letterSpacing: 4, fontWeight: w.light, color: t.text, fontVariantNumeric: 'tabular-nums' }}>
        K7PX 42MQ
      </div>
      <div style={{ marginTop: 8, height: 26, borderRadius: 100, background: 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', fontSize: 9.5, letterSpacing: 1.8, color: t.textSec, fontWeight: w.semiBold }}>
        SHARE
      </div>
    </div>
  );
}

/* One avatar per person the threshold asks for — the chip must never show
   fewer faces than the number in its own eyebrow. */
const INITIALS = ['AM', 'JS', 'RB', 'TK', 'DN', 'LP', 'MO', 'SW'];

function ThreeDots() {
  const people = INITIALS.slice(0, WAY_IN.threshold);
  const size = people.length > 4 ? 30 : 34;
  return (
    <div style={mini.card}>
      <div style={mini.eyebrow}>Converted · {WAY_IN.threshold} of {WAY_IN.threshold}</div>
      <div style={{ display: 'flex', gap: people.length > 4 ? 6 : 8, marginTop: 10 }}>
        {people.map((i) => (
          <div
            key={i}
            style={{
              width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center',
              background: 'rgba(232,210,0,0.12)', border: '1px solid rgba(232,210,0,0.45)',
              fontSize: 10, fontWeight: w.semiBold, color: t.accent, position: 'relative',
            }}
          >
            {i}
            <span
              style={{
                position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: '50%',
                background: t.success, border: '2px solid #222', display: 'grid', placeItems: 'center',
              }}
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 10.5, color: t.textSec, fontWeight: w.light }}>verified first workouts</div>
    </div>
  );
}

function AskCard() {
  return (
    <div style={{ ...mini.card, border: '1px solid rgba(232,210,0,0.35)' }}>
      <div style={mini.eyebrow}>POWR Affiliates</div>
      <div style={{ marginTop: 5, fontSize: 13, fontWeight: w.light, color: t.text, lineHeight: 1.3 }}>You’re bringing people in.</div>
      <div style={{ marginTop: 10, height: 28, borderRadius: 100, background: t.accent, display: 'grid', placeItems: 'center', fontSize: 9.5, letterSpacing: 1.8, color: t.onAccent, fontWeight: w.bold }}>
        ASK TO JOIN
      </div>
    </div>
  );
}

function ApprovedRow() {
  return (
    <div style={mini.card}>
      <div style={{ ...mini.eyebrow, color: t.success }}>You’re in</div>
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: w.light, color: t.text, lineHeight: 1.3 }}>Welcome to POWR Affiliates.</div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: t.textSec }}>
        <span>Settings › <span style={{ color: t.text }}>Affiliate</span></span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </div>
    </div>
  );
}
