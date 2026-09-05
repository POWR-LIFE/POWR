import { useEffect, useRef, useState } from 'react';
import { pg, w } from '../../theme';
import { CHAINS, searchGyms } from '../data';
import { CARD, Check, Head, Reveal, Search, Section, fmt } from '../ui';

/**
 * 04 — Is your gym on POWR? A live search over the partners table. The one
 * question every visitor actually has, answered before they download.
 */
export default function GymFinder({ stats }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null); // null = idle
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) { setRows(null); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try { setRows(await searchGyms(term)); } catch { setRows([]); }
      setBusy(false);
    }, 240);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <Section id="gyms">
      <Head
        n="04" tag="Where it works" center
        title="Is your gym on POWR?"
        lede={`${fmt(stats.partners)} partner gyms across the UK — chains and independents. Type yours.`}
      />
      <Reveal amount={0.3} style={{ maxWidth: 680, margin: '0 auto' }}>
        <label
          style={{
            ...CARD, borderRadius: 999, display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px 6px 20px',
            borderColor: q ? 'rgba(232,210,0,0.45)' : 'rgba(255,255,255,0.12)', transition: 'border-color 0.3s',
            boxShadow: q ? '0 0 0 4px rgba(232,210,0,0.06)' : 'none',
          }}
        >
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a gym, studio or chain…"
            autoComplete="off"
            aria-label="Search partner gyms"
            style={{
              flex: 1, background: 'transparent', border: 0, outline: 'none', color: pg.text, fontSize: 17, fontWeight: w.light,
              fontFamily: 'inherit', padding: '12px 0', minWidth: 0,
            }}
          />
          <span style={{ fontSize: 11, color: pg.textMuted, padding: '0 12px', whiteSpace: 'nowrap' }}>{busy ? 'searching…' : rows ? `${rows.length} found` : ''}</span>
        </label>

        <div style={{ marginTop: 14, minHeight: 120 }}>
          {rows === null && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {CHAINS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setQ(c)}
                  style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: pg.textSec, borderRadius: 999,
                    padding: '8px 14px', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', fontWeight: w.light,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {rows && rows.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, ...CARD, borderRadius: 18, overflow: 'hidden' }}>
              {rows.map((g) => (
                <li key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: g.logoBg === 'white' ? '#fff' : '#1c1c1c', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {g.logo
                      ? <img src={g.logo} alt="" width={38} height={38} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                      : <span style={{ fontSize: 14, fontWeight: w.semiBold, color: pg.textSec }}>{g.name[0]}</span>}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, color: pg.text, fontWeight: w.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: pg.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.area}{g.sites > 1 ? ` · ${g.sites} sites` : ''}
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: pg.accent, whiteSpace: 'nowrap' }}>
                    <Check size={12} /> Verified check-ins
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rows && rows.length === 0 && !busy && (
            <div style={{ ...CARD, padding: '22px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, color: pg.text, fontWeight: w.light }}>Not on POWR yet.</div>
              <div style={{ fontSize: 13, color: pg.textSec, marginTop: 6, lineHeight: 1.5 }}>
                Every gym can be added. Request it from the Discover tab in the app, or email <a href="mailto:support@powr.life" style={{ color: pg.accent, textDecoration: 'none' }}>support@powr.life</a>.
              </div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 12, color: pg.textMuted, lineHeight: 1.6 }}>
          Gym sessions are verified by presence: your phone inside the gym's geofence for the whole session. Thirty minutes pays 15, forty pays 20.
        </div>
      </Reveal>
    </Section>
  );
}
