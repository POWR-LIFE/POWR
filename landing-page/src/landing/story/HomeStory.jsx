import { useEffect, useMemo, useRef, useState } from 'react';
import SiteFooter from '../SiteFooter';
import { APP_STORE, GYM_PTS, PLAY_STORE, STATS_FALLBACK, fetchLiveRewards, fetchStats, searchGyms } from '../v3/data';
import { useStoryEngine } from './useStoryEngine';
import './home-story.css';

/**
 * The homepage, told as one gym session in three acts: tonight, this week,
 * this season. One pinned stage; scroll position drives the footage, the
 * clock, the counters and where the phone sits (useStoryEngine). Below the
 * story: the rest of the app as tiles, the questions, the download.
 *
 * Gyms are described as "on the map", never as partners: the directory is the
 * set of gyms where a visit is detected, not a list of agreements.
 *
 * Every class is prefixed hs- and every rule sits under .hs-root
 * (home-story.css), because style.css still ships global .hero / .btn /
 * .nav-links rules that would otherwise land on this page.
 *
 * Live numbers: gym count, sessions this week and the brand count come from
 * landing_stats(); the reward tickets from the live vault; the gym search from
 * the directory. The Series card reads the clock against the published rounds.
 */
const HERO_VIDEO = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/landing_hero.mp4';
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');

/* The four cheapest rewards as read on 23 Nov 2026. Shown only if the live vault cannot be read. */
const REWARDS_FALLBACK = [
  { id: 'afterz', brand: 'afterz', text: '15% off', pts: 100 },
  { id: 'swt', brand: 'SWT', text: '15% off', pts: 150 },
  { id: 'majic', brand: 'MAJIC', text: '15% off', pts: 180 },
  { id: 'frank', brand: 'Frank', text: '20% off', pts: 200 },
];

/* The Autumn Series as published (series_rounds, read 24 Nov 2026). Once both
   rounds have run the card stops naming dates, so it can never show a past one. */
const SERIES_ROUNDS = [
  { name: 'Round 01', label: '15–30 Nov', start: Date.UTC(2026, 10, 15), end: Date.UTC(2026, 11, 1) },
  { name: 'Round 02', label: '15–31 Dec', start: Date.UTC(2026, 11, 15), end: Date.UTC(2027, 0, 1) },
];
function seriesState(now) {
  const DAY = 864e5;
  const on = SERIES_ROUNDS.find((r) => now >= r.start && now < r.end);
  const next = SERIES_ROUNDS.find((r) => now < r.start);
  if (on) {
    const span = Math.round((on.end - on.start) / DAY);
    const day = Math.min(span, Math.floor((now - on.start) / DAY) + 1);
    const left = span - day;
    return {
      season: 'Autumn Series', round: `${on.name} · ${on.label}`, head: `Day ${day} of ${span}`,
      sub: left === 0 ? 'Last day' : `${left} ${left === 1 ? 'day' : 'days'} left`,
      pct: Math.round((day / span) * 100), hud: [on.name, `Day ${day}`],
    };
  }
  if (next) {
    const days = Math.ceil((next.start - now) / DAY);
    return {
      season: 'Autumn Series', round: `${next.name} · ${next.label}`, head: `${days} ${days === 1 ? 'day' : 'days'}`,
      sub: 'to the start', pct: 0, hud: ['Series', next.name],
    };
  }
  return { season: 'The Series', round: 'Next round', head: 'In the app', sub: 'dates land there first', pct: 0, hud: ['Series', 'Next round'] };
}

/* The live vault, cheapest first, one ticket a brand. */
function toTickets(rows) {
  return rows
    .filter((r) => r && r.brand && Number(r.pts) > 0)
    .sort((a, b) => a.pts - b.pts)
    .slice(0, 4)
    .map((r) => ({ id: r.id, brand: r.brand, text: String(r.flash || r.item || 'Member reward').replace(/\bOFF\b/g, 'off'), pts: r.pts }));
}

export default function HomeStory() {
  const root = useRef(null);
  const [stats, setStats] = useState({ ...STATS_FALLBACK, live: false });
  const [tickets, setTickets] = useState(REWARDS_FALLBACK);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null); // null = nothing searched yet
  const series = useMemo(() => seriesState(Date.now()), []);
  /* The story happens on a Monday, so the lock screen shows this week's. */
  const monday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }, []);

  /* What the scroll engine reads without re-running: the gym count it counts up to, the Series clock label. */
  const live = useRef({ partners: STATS_FALLBACK.partners, seriesLabel: series.hud });
  live.current.partners = stats.partners;
  live.current.seriesLabel = series.hud;

  useEffect(() => {
    let on = true;
    fetchStats().then((s) => { if (on) setStats(s); });
    fetchLiveRewards()
      .then((rows) => { const next = toTickets(rows ?? []); if (on && next.length) setTickets(next); })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  /* Gym search against the live directory, a beat after typing stops. */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return undefined; }
    let on = true;
    const timer = setTimeout(async () => {
      let rows = [];
      try { rows = await searchGyms(term); } catch { rows = []; }
      if (on) setHits(rows.slice(0, 3));
    }, 260);
    return () => { on = false; clearTimeout(timer); };
  }, [q]);

  useStoryEngine(root, live);

  const gyms = fmt(stats.partners);

  return (
    <>
      <div className="hs-root hs-js" ref={root}>
        <div className="hs-progress" id="bar" aria-hidden="true"></div>

        <header className="hs-nav">
          <div className="hs-wrap hs-nav-in">
            <a className="hs-nav-logo" href="#top" data-go="top" aria-label="POWR, back to top"><img src="/powr-logo-white.png" alt="POWR" /></a>
            <nav className="hs-nav-links" aria-label="Main">
              <a href="#walk-in" data-go="walk">How it works</a>
              <a href="#spend" data-go="spend">Rewards</a>
              <a href="#series" data-go="series">The Series</a>
              <a href="#more" data-go="more">Features</a>
              <a href="#faq" data-go="faq">FAQ</a>
              <a href="/partners">For Brands</a>
              <a className="hs-btn" href="#download" data-go="download">Get the App</a>
            </nav>
          </div>
        </header>

        <main>
          <section className="hs-story" id="story" data-step="top" data-act="">
            <div className="hs-pin">

              <div className="hs-backdrop" aria-hidden="true">
                <div className="hs-bd hs-bd-hero"><video id="heroVid" src={HERO_VIDEO} poster="/landing-story/hero-poster.webp" autoPlay muted loop playsInline></video></div>
                <div className="hs-bd hs-bd-walk"><canvas id="walkCanvas" width="960" height="540" /></div>
                <div className="hs-bd hs-bd-map"><img src="/landing-story/gym-map-alpha.webp" alt="" /></div>
                <div className="hs-bd hs-bd-train"><img src="/landing-story/ph-pullup.webp" alt="" /></div>
                <div className="hs-bd hs-bd-week"><img src="/landing-story/ph-runner.webp" alt="" /></div>
                <div className="hs-bd hs-bd-season"><img src="/landing-story/startline-alpha.webp" alt="" /></div>
                <div className="hs-actword hs-aw-tonight">Tonight</div>
                <div className="hs-actword hs-aw-week">This week</div>
                <div className="hs-actword hs-aw-season">This season</div>
              </div>

              <div className="hs-rig" role="img" aria-label="A phone running POWR. Its screen follows the story: the home screen, an arrival notification, the rewards list and the Series board.">
                <div className="hs-phone-pos">
                  <div className="hs-glow"></div>
                  <i className="hs-ring"></i>
                  <div className="hs-phone-float">
                    <div className="hs-phone">
                      <i className="hs-b1"></i><i className="hs-b2"></i><i className="hs-b3"></i><i className="hs-b4"></i>
                      <div className="hs-bezel">
                        <div className="hs-screen">
                          <b className="hs-island"></b>
                          <div className="hs-view hs-shot hs-is-on" data-view="home">
                            <div className="hs-sb"><span className="hs-sb-time">17:54</span><span className="hs-sb-r"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><i></i></span></div>
                            <img src="/landing-story/home.webp" alt="" />
                          </div>
                          <div className="hs-view hs-lock" data-view="lock">
                            <img className="hs-lock-wall" src="/landing-story/lock-wall.webp" alt="" />
                            <div className="hs-lock-top">
                              <svg viewBox="0 0 24 24"><path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10zm2 0h6V7.5a3 3 0 0 0-6 0z"/></svg>
                              <span className="hs-lock-date">{monday}</span>
                              <span className="hs-lock-time" id="lockTime">18:02</span>
                            </div>
                            <div className="hs-notif">
                              <span className="hs-notif-icon"><img src="/landing-story/logo-dark.png" alt="" /></span>
                              <div className="hs-notif-body">
                                <div className="hs-notif-head"><b>POWR</b><span>now</span></div>
                                <div className="hs-notif-title">You're in.</div>
                                <div className="hs-notif-text">Arrival detected. Session started.</div>
                              </div>
                            </div>
                            <div className="hs-lock-bottom">
                              <span><svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6h-4zM10 9v9a2 2 0 0 0 4 0V9M12 12v2"/></svg></span>
                              <span><svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
                            </div>
                          </div>
                          <div className="hs-view hs-shot" data-view="progress">
                            <div className="hs-sb"><span className="hs-sb-time">18:47</span><span className="hs-sb-r"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><i></i></span></div>
                            <img src="/landing-story/progress.webp" alt="" />
                          </div>
                          <div className="hs-view hs-shot" data-view="rewards">
                            <div className="hs-sb"><span className="hs-sb-time">18:47</span><span className="hs-sb-r"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><i></i></span></div>
                            <img src="/landing-story/rewards.webp" alt="" />
                          </div>
                          <div className="hs-view hs-shot" data-view="league">
                            <div className="hs-sb"><span className="hs-sb-time">18:47</span><span className="hs-sb-r"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><i></i></span></div>
                            <img src="/landing-story/league.webp" alt="" />
                          </div>
                          <div className="hs-view hs-shot hs-grey" data-view="profile">
                            <div className="hs-sb"><span className="hs-sb-time">18:47</span><span className="hs-sb-r"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><i></i></span></div>
                            <img src="/landing-story/profile.webp" alt="" />
                          </div>
                          <b className="hs-homebar"></b>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="hs-callout hs-c-a"><span className="hs-ico"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div><small>Gym session verified</small><b><em>+20</em> pts</b></div></div>
                  <div className="hs-callout hs-c-b"><span className="hs-ico hs-y"><svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5 5 9.5a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 1.5 1 2 2 2.5C11 8.5 11 6 12 3z"/></svg></span><div><small>Streak</small><b>12 weeks</b></div></div>
                  <div className="hs-callout hs-c-c"><span className="hs-ico"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div><small>Verified · 43 min</small><b><em>+20</em> today</b></div></div>
                </div>
              </div>

              <div className="hs-steps">

                <article className="hs-step hs-hero hs-is-on" id="top" data-key="top" data-len="70" data-at="0" data-view="home" data-sb="17:54">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>Every move counts</span>
                    <h1>Your workout is<br /><b>worth something.</b></h1>
                    <p className="hs-lede">POWR turns the training you already do into points, and points into rewards from brands you'd buy anyway. Nothing to log. Nothing to scan.</p>
                    <div className="hs-stores">
                      <a className="hs-store" href={APP_STORE} target="_blank" rel="noopener">
                        <svg viewBox="0 0 384 512" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                        <span><small>Download on the</small><strong>App Store</strong></span>
                      </a>
                      <a className="hs-store" href={PLAY_STORE} target="_blank" rel="noopener">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>
                        <span><small>Get it on</small><strong>Google Play</strong></span>
                      </a>
                    </div>
                    <p className="hs-foot">Free on iOS &amp; Android · {gyms} UK gyms on the map · Verified automatically</p>
                  </div>
                </article>

                <article className="hs-step" id="walk-in" data-key="walk" data-act="tonight" data-len="120" data-at=".62" data-view="lock">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>Tonight · <span id="walkWhen">18:02</span></span>
                    <h2>Walk in.<br /><b>That's the check-in.</b></h2>
                    <p className="hs-lede">Your phone knows when you've arrived. No QR code, no front desk, no button to press. The session starts on its own.</p>
                    <p className="hs-status"><i></i><span className="hs-st-before">Approaching your gym…</span><span className="hs-st-after"><b>Arrived 18:02.</b> Session started.</span></p>
                  </div>
                </article>

                <article className="hs-step" id="coverage" data-key="map" data-act="tonight" data-len="70" data-at=".6" data-view="lock">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>Where it works</span>
                    <div className="hs-count">
                      <div className="hs-bignum" id="gymCount" />
                      <span className="hs-label">UK gyms already on the map</span>
                    </div>
                    <h3>Yours is probably <b>one of them.</b></h3>
                    <p className="hs-lede">Chains and independents. Your gym doesn't have to sign up to anything, and there's nothing to arrange at the front desk.</p>
                    <form className="hs-finder" role="search" onSubmit={(e) => e.preventDefault()}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
                      <label className="hs-sr-only" htmlFor="gymq">Search for your gym</label>
                      <input id="gymq" type="search" placeholder="Is yours on the map? Type its name" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
                    </form>
                    {hits && (
                      <ul className="hs-results" aria-live="polite">
                        {hits.length === 0 && (
                          <li><span className="hs-none">Not on the map yet. Request it from the Discover tab in the app and we'll add it.</span></li>
                        )}
                        {hits.map((g) => (
                          <li key={g.id}><span>{g.name} <span className="hs-where">{g.area}</span></span><span className="hs-tag">On the map</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>

                <article className="hs-step" id="train" data-key="train" data-act="tonight" data-len="110" data-at=".5" data-view="lock">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>Tonight · <span id="trainWhen">18:47</span></span>
                    <h2>Train like you<br /><b>always do.</b></h2>
                    <p className="hs-lede">Nothing to start and nothing to log. Your phone stays in your pocket. Thirty minutes is worth 15 points. Forty is worth 20.</p>
                  </div>
                  <div className="hs-session" aria-hidden="true">
                    <div className="hs-sess-top"><span className="hs-live"><i></i>Session live</span><span>Phone in your pocket</span></div>
                    <div className="hs-timer hs-paid" id="timer">43:00</div>
                    <div className="hs-ladder" id="ladder">
                      <div className="hs-lad-track"><i></i></div>
                      <span className="hs-rung hs-on" id="r30" style={{ left: '66.67%' }}><b>15 pts</b><small>30 min</small></span>
                      <span className="hs-rung hs-on" id="r40" style={{ left: '88.89%' }}><b>20 pts</b><small>40 min</small></span>
                    </div>
                  </div>
                </article>

                <article className="hs-step" id="earn" data-key="earn" data-act="tonight" data-len="70" data-at=".6" data-view="home" data-sb="18:47">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>Tonight · 18:47</span>
                    <div className="hs-bignum" id="plus" aria-hidden="true">+20</div>
                    <h3>Walk out <b>20 points up.</b></h3>
                    <p className="hs-lede">Every session is verified before it pays, so a point always means a real workout. Hit your week and your streak grows with it.</p>
                    <p className="hs-proof"><i></i><span><b>{fmt(stats.sessions_7d)}</b> sessions verified in the last 7 days</span></p>
                  </div>
                </article>

                <article className="hs-step hs-right" id="week" data-key="stack" data-act="week" data-len="80" data-at=".85" data-view="progress" data-sb="07:12">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>This week</span>
                    <h2>Five sessions.<br /><b>One hundred points.</b></h2>
                    <div className="hs-weekbars">
                      <div className="hs-wb-total"><b id="wkTotal">100</b><span>pts by<br />Friday</span></div>
                      <ol className="hs-wb-days" id="wkDays" aria-label="Twenty points a session, Monday to Friday">
                        <li><i></i><span>Mon</span></li><li><i></i><span>Tue</span></li><li><i></i><span>Wed</span></li><li><i></i><span>Thu</span></li><li><i></i><span>Fri</span></li>
                      </ol>
                    </div>
                    <div className="hs-also">
                      <span className="hs-label">Not a gym day? These count too</span>
                      <div className="hs-chips">
                        <span className="hs-chip"><b>Run</b> 5 km <i>8 pts</i></span>
                        <span className="hs-chip"><b>Ride</b> 25 km <i>8 pts</i></span>
                        <span className="hs-chip"><b>Swim</b> 1 km <i>7 pts</i></span>
                        <span className="hs-chip"><b>Yoga</b> 45 min <i>5 pts</i></span>
                        <span className="hs-chip"><b>Steps</b> 10,000 <i>5 pts</i></span>
                        <span className="hs-chip"><b>Sleep</b> 8 hours <i>5 pts</i></span>
                      </div>
                    </div>
                    <div className="hs-wear" aria-label="Synced through Apple Health or Health Connect">
                      <img src="/wearables/apple-health.png" alt="Apple Health" /><img src="/wearables/whoop.png" alt="WHOOP" /><img src="/wearables/garmin.png" alt="Garmin" /><img src="/wearables/oura.png" alt="Oura" /><img src="/wearables/strava.png" alt="Strava" /><img src="/wearables/fitbit.png" alt="Fitbit" />
                    </div>
                  </div>
                </article>

                <article className="hs-step hs-right" id="spend" data-key="spend" data-act="week" data-len="80" data-at=".8" data-view="rewards" data-sb="18:20">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>Friday</span>
                    <h2>Points buy<br /><b>real things.</b></h2>
                    <p className="hs-lede hs-opt">Skincare, protein desserts, pizza night. Rewards from {stats.brands} brands, priced in sessions. The code lands in your wallet the moment you redeem.</p>
                    <ul className="hs-tickets" id="tickets">
                      {tickets.map((t, n) => {
                        const first = n === 0 && t.pts <= 100;
                        const sessions = Math.ceil(t.pts / GYM_PTS);
                        return (
                          <li key={t.id} className={`hs-ticket hs-in${first ? ' hs-first' : ''}`}>
                            <div className="hs-t-main">
                              <span className="hs-t-brand">{t.brand}{first && <span className="hs-t-tag">Yours by Friday</span>}</span>
                              <span className="hs-t-offer">{t.text}</span>
                            </div>
                            <div className="hs-t-cost"><b>{fmt(t.pts)}<small>pts</small></b><span>{sessions} gym {sessions === 1 ? 'session' : 'sessions'}</span></div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </article>

                <article className="hs-step" id="series" data-key="series" data-act="season" data-len="80" data-at=".5" data-view="league" data-sb="18:20">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>This season</span>
                    <h2>Then there's<br /><b>the Series.</b></h2>
                    <p className="hs-lede">One live board, a season of rounds, real prizes. The points you earn anyway move you up it. Join once in the app, free.</p>
                    <div className="hs-series">
                      <div className="hs-series-top">
                        <img className="hs-pmark" src="/landing-story/logo-butter.png" alt="" />
                        <div className="hs-s-names"><span className="hs-s-name">{series.season}</span><span className="hs-s-round">{series.round}</span></div>
                        <div className="hs-s-state">{series.head}<small>{series.sub}</small></div>
                      </div>
                      <div className="hs-s-bar" aria-hidden="true"><i style={{ width: `${series.pct}%` }} /></div>
                      <div className="hs-s-ways" aria-label="Ways to win">
                        <span>Champion</span><span>Squad Builder</span><span>Unbreakable</span><span>Level Up</span><span>Rookie of the Series</span><span>Every Move Counts</span>
                      </div>
                      <p className="hs-s-note">Six ways to win, and only one of them is finishing first. Joining late costs nothing.</p>
                    </div>
                  </div>
                </article>

                <article className="hs-step" id="levels" data-key="levels" data-act="season" data-len="70" data-at=".5" data-view="profile" data-sb="18:20">
                  <div className="hs-copy">
                    <span className="hs-when"><i></i>And every season after</span>
                    <h2>Twenty levels.<br /><b>All yours to climb.</b></h2>
                    <div className="hs-lvstrip" aria-label="Level badges, from Touching Grass to Need New Shoes">
                      <ol>
                        <li><img src="/landing-story/lv-touching-grass-1.webp" alt="" /><b>01</b><span>Touching Grass</span></li>
                        <li><img src="/landing-story/lv-streak-freak.webp" alt="" /><b>03</b><span>Streak Freak</span></li>
                        <li><img src="/landing-story/lv-heavy-hit.webp" alt="" /><b>05</b><span>Heavy Hitter</span></li>
                        <li><img src="/landing-story/lv-cant-sit-still.webp" alt="" /><b>06</b><span>Can't Sit Still</span></li>
                        <li><img src="/landing-story/lv-pavement-predator.webp" alt="" /><b>08</b><span>Pavement Predator</span></li>
                        <li><img src="/landing-story/lv-step-collector.webp" alt="" /><b>09</b><span>Step Collector</span></li>
                        <li><img src="/landing-story/lv-calorie-criminal.webp" alt="" /><b>10</b><span>Calorie Criminal</span></li>
                        <li><img src="/landing-story/lv-mile-muncher.webp" alt="" /><b>11</b><span>Mile Muncher</span></li>
                        <li><img src="/landing-story/lv-need-new-shoes.webp" alt="" /><b>13</b><span>Need New Shoes</span></li>
                      </ol>
                    </div>
                    <ul className="hs-facts">
                      <li><span className="hs-label">Streaks</span>Hit your weekly target and the streak holds.</li>
                      <li><span className="hs-label">Levels</span>Twenty to climb, starting at Touching Grass.</li>
                      <li><span className="hs-label">Friends</span>Add friends and see their streaks and sessions.</li>
                    </ul>
                  </div>
                </article>

              </div>

              <a className="hs-cue" href="#walk-in" data-go="walk">Follow one session<i></i></a>

              <div className="hs-hud" id="hud">
                <div className="hs-hud-clock"><small id="hudA">Mon</small><b id="hudB">18:02</b></div>
                <ol className="hs-hud-acts" aria-label="The story in three acts">
                  <li data-act="tonight"><button type="button" data-go="walk">Tonight<i></i></button></li>
                  <li data-act="week"><button type="button" data-go="stack">This week<i></i></button></li>
                  <li data-act="season"><button type="button" data-go="series">This season<i></i></button></li>
                </ol>
                <div className="hs-hud-pts"><small>Earned</small><b id="hudPts">+100</b></div>
              </div>

            </div>
          </section>

          <div className="hs-after">
            <section className="hs-sec hs-more" id="more">
              <div className="hs-wrap">
                <div className="hs-more-head">
                  <span className="hs-when"><i></i>Also in the app</span>
                  <h2>There's <b>more inside.</b></h2>
                  <p className="hs-lede">One session is where it starts. Here is what else you get.</p>
                </div>
                <div className="hs-bento">
                  <article className="hs-tile hs-t-lead">
                    <div className="hs-tile-copy"><span className="hs-label">Streaks</span><h3>A streak that counts <b>in weeks.</b></h3><p>Hit your weekly targets and it holds. The rings show how close you are.</p></div>
                    <div className="hs-tile-shot"><img src="/landing-story/ft-streak.webp" alt="A 12 week streak with this week's gym, walk and yoga rings" /></div>
                  </article>
                  <article className="hs-tile hs-t-body">
                    <div className="hs-tile-shot"><img src="/landing-story/ft-body.webp" alt="The Body tab: resting heart rate of 52 beats a minute over 30 days, with recovery below" /></div>
                    <div className="hs-tile-copy"><span className="hs-label">Body</span><h3>Sleep and recovery, read for you.</h3><p>Resting heart rate, HRV and sleep from your wearable.</p></div>
                  </article>
                  <article className="hs-tile hs-t-wear">
                    <div className="hs-wearwall"><img src="/wearables/apple-health.png" alt="Apple Health" /><img src="/wearables/whoop.png" alt="WHOOP" /><img src="/wearables/garmin.png" alt="Garmin" /><img src="/wearables/oura.png" alt="Oura" /><img src="/wearables/strava.png" alt="Strava" /><img src="/wearables/fitbit.png" alt="Fitbit" /></div>
                    <div className="hs-tile-copy"><span className="hs-label">Wearables</span><h3>Your watch does the logging.</h3><p>Runs, rides, swims, steps and sleep sync through Apple Health or Health Connect.</p></div>
                  </article>
                  <article className="hs-tile hs-t-progress">
                    <div className="hs-tile-shot"><img src="/landing-story/ft-progress.webp" alt="A month calendar with gym days filled in: 13 sessions, longest visit 52 minutes" /></div>
                    <div className="hs-tile-copy"><span className="hs-label">Progress</span><h3>Every session on a calendar.</h3><p>A tab for each activity, with your month at a glance.</p></div>
                  </article>
                  <article className="hs-tile hs-t-boards">
                    <div className="hs-tile-shot"><img src="/landing-story/ft-boards.webp" alt="The Series board: 7 points to pass the person above, and one run does it" /></div>
                    <div className="hs-tile-copy"><span className="hs-label">The board</span><h3>Know your next move.</h3><p>The Series shows how many points it takes to pass the person above you.</p></div>
                  </article>
                  <article className="hs-tile hs-t-alerts">
                    <div className="hs-tile-copy"><span className="hs-label">Alerts</span><h3>Know the moment it lands.</h3><p>A level reached, a reward unlocked, a session in the bank.</p></div>
                    <div className="hs-tile-shot"><img src="/landing-story/ft-alerts.webp" alt="The activity feed: level 4 reached, new reward unlocked" /></div>
                  </article>
                  <article className="hs-tile hs-t-share">
                    <div className="hs-tile-copy"><span className="hs-label">Share cards</span><h3>Cards worth posting.</h3><p>Turn a check-in, a streak or a level into an image for your story.</p></div>
                    <div className="hs-tile-shot"><img src="/landing-story/ft-share.webp" alt="A check-in share card showing a level badge, the gym name and session stats" /></div>
                  </article>
                </div>
              </div>
            </section>

            <section className="hs-sec" id="faq">
              <div className="hs-wrap">
                <div className="hs-sec-head"><span className="hs-label">Questions</span><h2>Straight <b>answers.</b></h2></div>
                <div className="hs-faq">
                  <details open>
                    <summary>Does my gym need to sign up?</summary>
                    <p>No. POWR works from your phone's location, so a session counts at any of the {gyms} UK gyms on our map. If yours is missing, request it from the Discover tab in the app and we'll add it.</p>
                  </details>
                  <details>
                    <summary>How does POWR know I trained?</summary>
                    <p>Your phone's location, checked against the gym's boundary. Arrive and a session starts on its own. Stay thirty minutes and it pays 15 points; forty pays 20. Runs, rides, swims, steps and sleep arrive through Apple Health or Health Connect.</p>
                  </details>
                  <details>
                    <summary>Is it free?</summary>
                    <p>Yes. Free to download on iOS and Android, free to earn. Points come from moving. There is nothing to buy.</p>
                  </details>
                  <details>
                    <summary>What can I spend points on?</summary>
                    <p>Live rewards from brands including HUEL, MAJIC, TRIBE, REP and SWT: discounts and codes at their checkouts. A code lands in your wallet the moment you redeem.</p>
                  </details>
                </div>
              </div>
            </section>

            <section className="hs-cta" id="download">
              <img className="hs-cta-photo" src="/landing-story/ph-rope.webp" alt="" />
              <div className="hs-wrap hs-cta-in">
                <span className="hs-when"><i></i>Your turn</span>
                <h2 className="hs-h1">Start with<br /><b>your next session.</b></h2>
                <p className="hs-lede">Download POWR, walk into your gym tonight, and let the session pay you back.</p>
                <div className="hs-stores">
                  <a className="hs-store" href={APP_STORE} target="_blank" rel="noopener">
                    <svg viewBox="0 0 384 512" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                    <span><small>Download on the</small><strong>App Store</strong></span>
                  </a>
                  <a className="hs-store" href={PLAY_STORE} target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>
                    <span><small>Get it on</small><strong>Google Play</strong></span>
                  </a>
                </div>
                <p className="hs-foot">Free to download. Free to earn.</p>
              </div>
            </section>

              </div>
        </main>

        <div className="hs-dock" id="dock">
          <span className="hs-dock-clock"><small id="dockA">Free on</small><b id="dockB">iOS &amp; Android</b><em id="dockPts"></em></span>
          <a className="hs-btn" href="/app.html">Get the App</a>
        </div>
      </div>
      <div className="hs-foot-pad"><SiteFooter /></div>
    </>
  );
}
