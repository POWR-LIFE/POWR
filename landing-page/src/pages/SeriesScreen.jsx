import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
    buildUpWindow,
    countdownDigits,
    crowdAt,
    fmtInt,
    monthOf,
    prizeChip,
    PRIZE_SLOTS,
    roundWindow,
    sampleSeriesScreen,
    seriesClock,
    seriesNumber,
} from '../../../shared/seriesScreen.ts';

/**
 * Series screen — powr.life/series-tv?k=<key>.
 *
 * ONE screen for every TV, not a gym's: the POWR Series as a reel. A TV
 * stage at 16:9 — scenes rotate on the left (join, how it works, the
 * seven prizes, Squad Builder, the board, the giveaway); a fixed rail on
 * the right carries the live countdown, the start-line crowd and the QR
 * code to join. The link, its pause switch and the city it names are run
 * from /admin/series → Screens (system_config); one link serves every gym.
 * (Not under /series/: vercel.json sends /series/<x> to the invite preview.)
 *
 * Everything it says comes from the series-screen feed (season, round
 * dates, prizes entered in /admin/series, the crowd), so it follows the
 * Series calendar on its own: build-up → live → complete → the next round.
 * ?preview=sample renders the sample payload with no network, for the
 * portal's television and for checking the layout.
 */

const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/series-screen`;
const POLL_MS = 60_000;
const SCENE_MS = 11_000;
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,300..800&display=swap';

export default function SeriesScreen() {
    const [params] = useSearchParams();
    const token = params.get('k') ?? '';
    const preview = params.get('preview') === 'sample' ? 'sample' : null;

    const [data, setData] = useState(null);
    const [invalid, setInvalid] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    // The stage's own face, loaded once; the rest of the site stays on Outfit.
    useEffect(() => {
        if (document.querySelector(`link[href="${FONT_HREF}"]`)) return undefined;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = FONT_HREF;
        document.head.appendChild(link);
        return undefined;
    }, []);

    useEffect(() => {
        if (preview) { setData(sampleSeriesScreen(Date.now())); return undefined; }
        if (!token) return undefined;
        let alive = true;
        const tick = async () => {
            try {
                const res = await fetch(`${FN_BASE}?k=${encodeURIComponent(token)}`);
                if (!alive) return;
                if (res.status === 404) { setInvalid(true); return; }
                if (!res.ok) return;
                const next = await res.json();
                if (alive) { setData(next); setInvalid(false); }
            } catch { /* keep the last good payload through wifi blips */ }
        };
        tick();
        const id = setInterval(tick, POLL_MS);
        return () => { alive = false; clearInterval(id); };
    }, [token, preview]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        const prev = document.title;
        document.title = data?.season ? `${data.season.name} · POWR` : 'POWR Series';
        return () => { document.title = prev; };
    }, [data?.season]);

    if (!token && !preview) return <Shell><CenterNote big="This link is missing its key" small="Copy the link from the Screens tab on the Series page of the admin: it carries the key" /></Shell>;
    if (invalid) return <Shell><CenterNote big="This screen link isn’t valid" small="Make a new link from the Screens tab on the Series page of the admin" /></Shell>;
    if (!data) return <Shell><CenterNote big="POWR" small="Connecting…" pulse /></Shell>;

    return (
        <Shell>
            <Stage data={data} now={now} />
            {preview && (
                <div className="ss-badge">Preview — sample data</div>
            )}
        </Shell>
    );
}

// ─── Stage ───────────────────────────────────────────────────────

function Stage({ data, now }) {
    const tz = data.tz || 'Europe/London';
    const { season, round, next_round: next, prizes = [], crowd } = data;
    const clock = useMemo(() => seriesClock(round, next, now, tz), [round, next, now, tz]);
    const digits = countdownDigits(clock.targetMs, now);
    const waiting = crowdAt(crowd, now);
    const city = data.city || null;
    const month = round ? monthOf(round.starts_at, tz) : '';
    const buildUp = round ? buildUpWindow(round, tz) : '';
    const live = round ? roundWindow(round, tz) : '';
    const roundName = round?.name ?? 'the round';
    const giveawayWhere = city ? `a live giveaway in ${city}` : 'a live giveaway';

    const chips = useMemo(
        () => Object.fromEntries(PRIZE_SLOTS.map((s) => [s.key, prizeChip(s, prizes)])),
        [prizes],
    );
    const slot = (key) => PRIZE_SLOTS.find((s) => s.key === key);
    const placeSlots = [slot('place-2'), slot('place-1'), slot('place-3')];
    const moreSlots = [slot('hot_streak'), slot('biggest_mover'), slot('rookie'), slot('patient_zero')];
    const squad = slot('patient_zero');

    const eyebrow0 = clock.phase === 'before' ? 'Build-up open now' : clock.phase === 'live' ? `${roundName} · Live now` : `${roundName} complete`;
    const joinSmall = clock.phase === 'before'
        ? 'Free on the App Store and Google Play. Build-up is open now.'
        : clock.phase === 'live'
            ? `Free on the App Store and Google Play. ${roundName} is live.`
            : 'Free on the App Store and Google Play. The next round is coming.';
    const crowdLabel = clock.phase === 'before' ? 'on the start line' : clock.phase === 'live' ? `in ${roundName}` : 'took part';

    const scenes = [
        {
            key: 'join',
            shot: { src: '/series-screen/home.jpg', alt: 'POWR home screen' },
            body: (
                <>
                    <div className="eyebrow">{eyebrow0}</div>
                    <h1>Join the {season?.name ?? 'POWR Series'}.</h1>
                    <p className="lede">One leaderboard for <strong>{city ? `all of ${city}` : 'everyone'}</strong>. Your gym, your run, your commute. Every move counts.</p>
                </>
            ),
        },
        {
            key: 'how',
            body: (
                <>
                    <div className="eyebrow">How it works</div>
                    <h2>You against<br />{city ? `all of ${city}.` : 'everyone.'}</h2>
                    <div className="steps">
                        <div className="step"><span className="n">01</span><span className="t">Build up</span><span className="d">{buildUp} · Bring friends in. Each one lifts your start.</span></div>
                        <div className="step"><span className="n">02</span><span className="t">Compete</span><span className="d">{live} · Gym, run, walk, ride. Every move scores.</span></div>
                        <div className="step"><span className="n">03</span><span className="t">Win</span><span className="d">Seven prizes, handed out at {giveawayWhere}.</span></div>
                    </div>
                </>
            ),
        },
        {
            key: 'prizes',
            cls: 'sp',
            fit: true,
            body: (
                <>
                    <div className="eyebrow">Seven ways to win</div>
                    <h2>Not just the top three.</h2>
                    <div className="podium">
                        {placeSlots.map((s) => (
                            <div key={s.key} className={`place p${s.place}`}>
                                <span className="ord">{s.place}<sup>{ordSuffix(s.place)}</sup></span>
                                <span className="pn">{s.title}</span>
                                <span className="pm">{s.how}</span>
                                <span className={`rv${chips[s.key].on ? ' on' : ''}`}>{chips[s.key].text}</span>
                            </div>
                        ))}
                    </div>
                    <div className="also"><span className="live" aria-hidden="true" />Four more prizes. Anyone can win these.</div>
                    <div className="prizes">
                        {moreSlots.map((s) => (
                            <div key={s.key} className={`prize${s.key === 'patient_zero' ? ' sb' : ''}`}>
                                <span className="ord">{s.ord}<sup>{ordSuffix(s.ord)}</sup></span>
                                <span className="pk">Prize</span>
                                <span className="pn">{s.title}</span>
                                <span className="how">{s.how.replace('{month}', month)}</span>
                                <span className={`rv${chips[s.key].on ? ' on' : ''}`}>{chips[s.key].text}</span>
                            </div>
                        ))}
                    </div>
                    <div className="when-line">Winners collect their prizes at {giveawayWhere}<i>·</i>Date and venue TBC</div>
                </>
            ),
        },
        {
            key: 'squad',
            cls: 'sq',
            shot: { src: '/series-screen/start-line.jpg', alt: 'POWR countdown screen with the Invite a friend button' },
            body: (
                <>
                    <div className="eyebrow">7th prize · A separate race</div>
                    <h2>Squad Builder.</h2>
                    <div className="prizename">{chips[squad.key].on ? chips[squad.key].text : 'Prize announced soon'}</div>
                    <p className="lede">Recruit the most active friends. <strong>Every friend who moves counts.</strong></p>
                    <div className="sqdates">
                        <div><b>{buildUp}</b><span>Recruiting open</span></div>
                        <div><b>Live giveaway</b><span>{city ? `${city} · ` : ''}Date and venue TBC</span></div>
                    </div>
                </>
            ),
        },
        {
            key: 'board',
            body: (
                <>
                    <div className="eyebrow">The field to chase</div>
                    <h2>Climb the board.</h2>
                    <p className="lede">Live positions, the points gap to the person ahead, and what it takes to pass them. <strong>Updated as you move.</strong></p>
                </>
            ),
        },
        {
            key: 'giveaway',
            body: (
                <>
                    <div className="eyebrow">Live giveaway</div>
                    <h2>Win it here.<br />Collect it live.</h2>
                    <p className="lede">Winners collect their prizes at {giveawayWhere}. <strong>Date and venue to be announced.</strong></p>
                </>
            ),
        },
    ];

    return (
        <main className="stage">
            <Scenes scenes={scenes} top={
                <div className="top">
                    <img src="/series-screen/p-mark.png" alt="POWR" />
                    <span className="sep" aria-hidden="true" />
                    <span className="season"><b>{season?.name ?? 'POWR Series'}</b>{season ? <>&nbsp;&nbsp;{seriesNumber(season.number)}</> : null}{city ? <>&nbsp;&nbsp;·&nbsp;&nbsp;{city}</> : null}</span>
                </div>
            } />

            <aside className="rail">
                <div className="clock" aria-live="off">
                    <div className="lab">{clock.label}</div>
                    <div className="digits">
                        <div><b>{digits.days}</b><span>Days</span></div>
                        <div><b>{digits.hours}</b><span>Hours</span></div>
                        <div><b>{digits.minutes}</b><span>Mins</span></div>
                        <div><b>{digits.seconds}</b><span>Secs</span></div>
                    </div>
                    <div className="when">{clock.when}</div>
                    {waiting !== null && waiting > 0 && (
                        <div className="crowd"><b>{fmtInt(waiting)}</b> {crowdLabel}</div>
                    )}
                </div>

                <div className="join">
                    <div className="qrbox">
                        <QRCodeSVG
                            value={data.join_url || 'https://powr.life/series'}
                            level="M"
                            bgColor="#F1E8DC"
                            fgColor="#111214"
                            marginSize={0}
                            className="qr"
                            title="QR code linking to POWR"
                        />
                    </div>
                    <div className="big">Scan to join.</div>
                    <div className="small">{joinSmall}</div>
                </div>

                <div className="brand">Every move counts.</div>
            </aside>

            <FullScreenButton />
        </main>
    );
}

/**
 * A scene's copy scaled down to its frame when the screen is too short for
 * it at full size — the prizes scene on a 1080p TV is exactly that tight.
 * Measured against the frame, re-measured on resize; never scales up.
 */
function FitCopy({ children }) {
    const ref = React.useRef(null);
    const [scale, setScale] = useState(1);
    useEffect(() => {
        const el = ref.current;
        const frame = el?.parentElement?.parentElement;
        if (!el || !frame) return undefined;
        const fit = () => {
            const avail = frame.clientHeight;
            const need = el.scrollHeight;
            setScale(need > 0 && avail > 0 ? Math.min(1, avail / need) : 1);
        };
        fit();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
        ro?.observe(frame);
        ro?.observe(el);
        document.fonts?.ready?.then(fit).catch(() => {});
        window.addEventListener('resize', fit);
        return () => { ro?.disconnect(); window.removeEventListener('resize', fit); };
    }, []);
    return (
        <div className="copy fit" style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}>
            <div ref={ref} className="copy">{children}</div>
        </div>
    );
}

function ordSuffix(n) {
    return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
}

// ─── Scene rotation ──────────────────────────────────────────────

function Scenes({ scenes, top }) {
    const [cur, setCur] = useState(0);
    const n = scenes.length;
    const show = useCallback((i) => setCur(((i % n) + n) % n), [n]);

    useEffect(() => {
        const id = setTimeout(() => show(cur + 1), SCENE_MS);
        return () => clearTimeout(id);
    }, [cur, show]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'ArrowRight') show(cur + 1);
            if (e.key === 'ArrowLeft') show(cur - 1);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [cur, show]);

    return (
        <section className="scenes" aria-label="POWR Series">
            {top}
            <div className="frames">
                {scenes.map((s, i) => (
                    <article key={s.key} className={`scene${s.cls ? ` ${s.cls}` : ''}${i === cur ? ' on' : ''}`} aria-hidden={i !== cur}>
                        {s.fit ? <FitCopy>{s.body}</FitCopy> : <div className="copy">{s.body}</div>}
                        {s.shot && <img className="shot" src={s.shot.src} alt={s.shot.alt} />}
                    </article>
                ))}
            </div>
            <div className="dots" role="tablist" aria-label="Screens">
                {scenes.map((s, i) => (
                    <button
                        key={s.key}
                        type="button"
                        role="tab"
                        aria-label={`Screen ${i + 1}`}
                        aria-selected={i === cur}
                        className={`dot${i === cur ? ' on' : i < cur ? ' done' : ''}`}
                        onClick={() => show(i)}
                    >
                        <i />
                    </button>
                ))}
            </div>
        </section>
    );
}

// ─── Full screen + idle ──────────────────────────────────────────

function FullScreenButton() {
    useEffect(() => {
        // Keep the TV awake while the tab is in front.
        let lock = null;
        const keepAwake = () => {
            try {
                if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
            } catch { /* not every TV browser has it */ }
        };
        const onVis = () => { if (document.visibilityState === 'visible') keepAwake(); };
        document.addEventListener('visibilitychange', onVis);
        keepAwake();

        // Hide the cursor and the button once nobody is touching anything.
        let idleT;
        const wake = () => {
            document.body.classList.remove('ss-idle');
            clearTimeout(idleT);
            idleT = setTimeout(() => document.body.classList.add('ss-idle'), 3000);
        };
        const evs = ['mousemove', 'touchstart', 'keydown'];
        evs.forEach((e) => document.addEventListener(e, wake, { passive: true }));
        wake();
        return () => {
            document.removeEventListener('visibilitychange', onVis);
            evs.forEach((e) => document.removeEventListener(e, wake));
            clearTimeout(idleT);
            document.body.classList.remove('ss-idle');
            try { lock?.release?.(); } catch { /* already gone */ }
        };
    }, []);

    const toggle = () => {
        const el = document.documentElement;
        try {
            if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
            else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        } catch { /* ignore */ }
    };
    return <button className="fs" type="button" onClick={toggle}>Full screen</button>;
}

// ─── Shell ───────────────────────────────────────────────────────

function CenterNote({ big, small, pulse }) {
    return (
        <div className="ss-center">
            <div className={`ss-center-big${pulse ? ' pulse' : ''}`}>{big}</div>
            {small && <div className="ss-center-small">{small}</div>}
        </div>
    );
}

function Shell({ children }) {
    return (
        <div className="ss">
            <style>{CSS}</style>
            {children}
        </div>
    );
}

/* Layout: TV stage, 16:9. Rotating scene on the left, a fixed rail on the
   right with the live countdown and the QR to join. Every length is in
   stage units (--u) so the same page fits a 1080p TV, a 4K wall or a
   portrait screen, where the rail stacks under the scenes. */
const CSS = `
.ss{
  --bg:#111214; --bg-2:#17191C; --line:#2A2D32;
  --ink:#F1E8DC; --muted:#9A9389; --dim:#5F5A53;
  --champagne:#D8BE86; --qr-bg:#F1E8DC;
  --display:'Archivo', 'Helvetica Neue', Arial, sans-serif;
  --u: min(1vw, 1.778vh);
  --dur: ${SCENE_MS}ms;
  position:fixed; inset:0; overflow:hidden; background:var(--bg); color:var(--ink); font-family:var(--display);
  cursor:default; color-scheme:dark; -webkit-font-smoothing:antialiased; user-select:none;
}
.ss *{box-sizing:border-box}
body.ss-idle .ss{cursor:none}
.ss .stage{height:100%; display:grid; grid-template-columns:minmax(0,1fr) calc(var(--u)*30); grid-template-rows:minmax(0,1fr); padding-left:max(16px, env(safe-area-inset-left,0px)); padding-right:max(16px, env(safe-area-inset-right,0px))}

/* ---------- Scenes ---------- */
.ss .scenes{position:relative; min-width:0; min-height:0; padding:calc(var(--u)*4) calc(var(--u)*4) calc(var(--u)*3) calc(var(--u)*2.5); display:flex; flex-direction:column}
.ss .top{display:flex; align-items:center; gap:calc(var(--u)*1.6); font-size:calc(var(--u)*1); letter-spacing:.42em; text-transform:uppercase; font-weight:600; font-stretch:125%; color:var(--muted); min-width:0}
.ss .top img{width:calc(var(--u)*3.4); height:auto}
.ss .top .sep{width:1px; height:calc(var(--u)*2.4); background:var(--line); flex:none}
.ss .top b{color:var(--champagne); font-weight:600}
.ss .top .season{white-space:nowrap}
.ss .frames{position:relative; flex:1; min-height:0; margin-top:calc(var(--u)*1.2)}
.ss .scene{position:absolute; inset:0; display:flex; align-items:center; gap:calc(var(--u)*4); opacity:0; transform:translateY(calc(var(--u)*1)); transition:opacity .9s ease, transform .9s ease; pointer-events:none}
.ss .scene.on{opacity:1; transform:none; pointer-events:auto}
.ss .copy{min-width:0; flex:1; display:flex; flex-direction:column; gap:calc(var(--u)*1.8)}
.ss .copy.fit{transform-origin:left center; display:block; min-width:0}
.ss .copy.fit > .copy{width:100%}
.ss .eyebrow{font-size:calc(var(--u)*1.05); letter-spacing:.4em; text-transform:uppercase; font-weight:600; font-stretch:125%; color:var(--champagne)}
.ss h1,.ss h2{margin:0; font-weight:300; letter-spacing:-.025em; line-height:.98; text-wrap:balance; color:var(--ink)}
.ss h1{font-size:calc(var(--u)*7.4)}
.ss h2{font-size:calc(var(--u)*5.2)}
.ss .lede{font-size:calc(var(--u)*1.9); line-height:1.35; color:var(--muted); max-width:30ch; margin:0}
.ss .lede strong{color:var(--ink); font-weight:500}
.ss .shot{height:calc(var(--u)*40); width:auto; max-width:100%; border-radius:calc(var(--u)*1.6); box-shadow:0 0 0 1px var(--line), 0 calc(var(--u)*2) calc(var(--u)*6) rgba(0,0,0,.55); flex:none}

/* how it works */
.ss .steps{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border-top:1px solid var(--line); margin-top:calc(var(--u)*1.5)}
.ss .step{padding:calc(var(--u)*2) calc(var(--u)*2) 0 0; display:flex; flex-direction:column; gap:calc(var(--u)*.7)}
.ss .step + .step{padding-left:calc(var(--u)*2); border-left:1px solid var(--line)}
.ss .step .n{font-size:calc(var(--u)*4); font-weight:200; color:var(--champagne); line-height:1}
.ss .step .t{font-size:calc(var(--u)*2.2); font-weight:600}
.ss .step .d{font-size:calc(var(--u)*1.35); color:var(--muted); font-variant-numeric:tabular-nums}

/* podium + prizes */
.ss .podium{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:calc(var(--u)*1.2); align-items:end; margin-top:calc(var(--u)*.6)}
.ss .place{position:relative; overflow:hidden; border:1px solid var(--line); border-radius:calc(var(--u)*1); padding:calc(var(--u)*1.4) calc(var(--u)*1.8); display:flex; flex-direction:column; gap:calc(var(--u)*.4); min-width:0; background:var(--bg-2); transform-origin:bottom}
.ss .ord{font-size:calc(var(--u)*4.6); font-weight:200; line-height:1; letter-spacing:-.03em; font-variant-numeric:tabular-nums}
.ss .ord sup{font-size:.36em; font-weight:500; letter-spacing:.02em; vertical-align:top; position:relative; top:.35em; margin-left:.08em}
.ss .place .pn{font-size:calc(var(--u)*2.1); font-weight:600}
.ss .place .pm{font-size:calc(var(--u)*1.2); color:var(--muted)}
.ss .p1{padding-top:calc(var(--u)*3.2); border-color:var(--champagne); background:linear-gradient(180deg, rgba(216,190,134,.14), rgba(216,190,134,0) 70%), var(--bg-2)}
.ss .p1 .ord{color:var(--champagne); font-size:calc(var(--u)*5.8)}
.ss .p2{padding-top:calc(var(--u)*2.2)} .ss .p2 .ord{color:#CFCBC4}
.ss .p3 .ord{color:#C08F62}
.ss .p1::after{content:""; position:absolute; inset:0; background:linear-gradient(105deg, transparent 35%, rgba(241,232,220,.16) 50%, transparent 65%); transform:translateX(-120%); pointer-events:none}
.ss .also{display:flex; align-items:center; gap:calc(var(--u)*.9); margin-top:calc(var(--u)*2); font-size:calc(var(--u)*1.35); font-weight:500; color:var(--ink)}
.ss .live{width:calc(var(--u)*.8); height:calc(var(--u)*.8); border-radius:50%; background:var(--champagne); flex:none}
.ss .prizes{display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:calc(var(--u)*1.2); margin-top:calc(var(--u)*1.1)}
.ss .prize{border:1px solid var(--line); border-radius:calc(var(--u)*1); padding:calc(var(--u)*1.3) calc(var(--u)*1.4); display:flex; flex-direction:column; gap:calc(var(--u)*.35); min-width:0}
.ss .prize .ord{font-size:calc(var(--u)*3.2); color:var(--champagne)}
.ss .prize .pk{font-size:calc(var(--u)*.85); letter-spacing:.35em; text-transform:uppercase; font-weight:600; color:var(--muted); margin-top:calc(var(--u)*.3)}
.ss .prize .pn{font-size:calc(var(--u)*1.7); font-weight:600; line-height:1.15}
.ss .prize .how{font-size:calc(var(--u)*1.2); color:var(--muted); line-height:1.3}

/* alive: podium rises, prizes deal in, champion shimmers */
.ss .scene.on .place{animation:ssRise .8s cubic-bezier(.2,.8,.2,1) both}
.ss .scene.on .p2{animation-delay:.15s} .ss .scene.on .p1{animation-delay:.35s} .ss .scene.on .p3{animation-delay:.55s}
.ss .scene.on .p1::after{animation:ssShine 3.2s ease-in-out 1.4s infinite}
.ss .scene.on .prize{animation:ssDeal .6s cubic-bezier(.2,.8,.2,1) both}
.ss .scene.on .prize:nth-child(1){animation-delay:1s} .ss .scene.on .prize:nth-child(2){animation-delay:1.15s}
.ss .scene.on .prize:nth-child(3){animation-delay:1.3s} .ss .scene.on .prize:nth-child(4){animation-delay:1.45s}
.ss .scene.on .live{animation:ssPulse 1.6s ease-in-out infinite}
@keyframes ssRise{from{opacity:0; transform:scaleY(.6) translateY(calc(var(--u)*3))}to{opacity:1; transform:none}}
@keyframes ssDeal{from{opacity:0; transform:translateY(calc(var(--u)*2))}to{opacity:1; transform:none}}
@keyframes ssShine{0%{transform:translateX(-120%)}45%,100%{transform:translateX(120%)}}
@keyframes ssPulse{0%,100%{box-shadow:0 0 0 0 rgba(216,190,134,.6)}60%{box-shadow:0 0 0 calc(var(--u)*.9) rgba(216,190,134,0)}}

/* prizes scene fits a 16:9 frame */
.ss .sp .copy{gap:calc(var(--u)*.6)}
.ss .sp h2{font-size:calc(var(--u)*2.8)}
.ss .sp .prize .pk{display:none}
.ss .sp .when-line{margin-top:calc(var(--u)*.8)}
.ss .sp .rv{white-space:nowrap; margin-top:calc(var(--u)*.4)}
.ss .sp .podium{margin-top:calc(var(--u)*.8)}
.ss .sp .place{padding:calc(var(--u)*1.1) calc(var(--u)*1.6)}
.ss .sp .p1{padding-top:calc(var(--u)*2.4)} .ss .sp .p2{padding-top:calc(var(--u)*1.7)}
.ss .sp .place .ord{font-size:calc(var(--u)*3.6)} .ss .sp .p1 .ord{font-size:calc(var(--u)*4.4)}
.ss .sp .place .pn{font-size:calc(var(--u)*1.9)}
.ss .sp .place .pm{font-size:calc(var(--u)*1.05)}
.ss .sp .also{margin-top:calc(var(--u)*1.3)}
.ss .sp .prizes{margin-top:calc(var(--u)*.6)}
.ss .sp .prize{padding:calc(var(--u)*1) calc(var(--u)*1.3)}
.ss .sp .prize .ord{font-size:calc(var(--u)*2.6)}
.ss .sp .prize .pn{font-size:calc(var(--u)*1.55)}
.ss .sp .prize .how{font-size:calc(var(--u)*1.1)}

.ss .when-line{margin-top:calc(var(--u)*1.2); font-size:calc(var(--u)*1.15); color:var(--muted); display:flex; flex-wrap:wrap; gap:calc(var(--u)*.4) calc(var(--u)*.9)}
.ss .when-line i{font-style:normal; color:var(--dim)}
.ss .rv{white-space:nowrap; margin-top:calc(var(--u)*.6); align-self:flex-start; font-size:calc(var(--u)*.95); font-weight:600; letter-spacing:.06em; color:var(--champagne); border:1px solid rgba(216,190,134,.45); border-radius:999px; padding:calc(var(--u)*.35) calc(var(--u)*.9)}
.ss .rv.on{background:var(--champagne); color:var(--bg); border-color:var(--champagne)}
.ss .prize.sb{border-color:var(--champagne)}
/* Chips share one line: each card's chip sits on its bottom edge, however
   long the line above it runs (the grid already makes the cards one height). */
.ss .prize .how,.ss .place .pm{margin-bottom:calc(var(--u)*.4)}
.ss .prize .rv,.ss .place .rv,.ss .sp .prize .rv,.ss .sp .place .rv{margin-top:auto}
.ss .prizename{font-size:calc(var(--u)*3); font-weight:300; color:var(--champagne); letter-spacing:-.01em}
.ss .sqdates{display:flex; gap:calc(var(--u)*3); border-top:1px solid var(--line); padding-top:calc(var(--u)*1.6); margin-top:calc(var(--u)*.6)}
.ss .sqdates div{display:flex; flex-direction:column; gap:calc(var(--u)*.4)}
.ss .sqdates b{font-size:calc(var(--u)*2.4); font-weight:400; font-variant-numeric:tabular-nums; white-space:nowrap}
.ss .sqdates span{font-size:calc(var(--u)*.9); letter-spacing:.3em; text-transform:uppercase; color:var(--muted); font-weight:600}
.ss .scene.on.sq .prizename{animation:ssDeal .7s cubic-bezier(.2,.8,.2,1) .3s both}
.ss .scene.on.sq .shot{animation:ssDeal .8s cubic-bezier(.2,.8,.2,1) .15s both}

/* progress */
.ss .dots{display:flex; gap:calc(var(--u)*.8); margin-top:calc(var(--u)*2)}
.ss .dot{position:relative; width:calc(var(--u)*5); height:3px; background:var(--line); border-radius:2px; overflow:hidden; border:0; padding:0; cursor:pointer}
.ss .dot i{position:absolute; inset:0; width:0; background:var(--champagne)}
.ss .dot.done i{width:100%}
.ss .dot.on i{animation:ssFill var(--dur) linear forwards}
@keyframes ssFill{to{width:100%}}

/* ---------- Rail ---------- */
.ss .rail{background:var(--bg-2); border-left:1px solid var(--line); padding:calc(var(--u)*4) calc(var(--u)*2.6) calc(var(--u)*2.4); display:flex; flex-direction:column; justify-content:space-between; gap:calc(var(--u)*1.6); min-width:0; min-height:0; overflow:hidden; margin-right:calc(max(16px, env(safe-area-inset-right,0px)) * -1); padding-right:max(calc(var(--u)*2.6), env(safe-area-inset-right,0px))}
.ss .clock .lab{font-size:calc(var(--u)*.95); letter-spacing:.4em; text-transform:uppercase; font-weight:600; font-stretch:125%; color:var(--champagne)}
.ss .digits{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:calc(var(--u)*1.2) calc(var(--u)*1); margin-top:calc(var(--u)*1.4)}
.ss .digits div{display:flex; flex-direction:column; gap:calc(var(--u)*.3)}
.ss .digits b{font-size:calc(var(--u)*4.8); font-weight:200; line-height:.95; font-variant-numeric:tabular-nums; letter-spacing:-.03em}
.ss .digits span{font-size:calc(var(--u)*.85); letter-spacing:.3em; text-transform:uppercase; color:var(--muted); font-weight:600}
.ss .clock .when{margin-top:calc(var(--u)*1.2); font-size:calc(var(--u)*1.2); color:var(--muted)}
.ss .clock .crowd{margin-top:calc(var(--u)*.7); font-size:calc(var(--u)*1.15); color:var(--muted)}
.ss .clock .crowd b{font-size:calc(var(--u)*2); font-weight:300; color:var(--ink); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-right:calc(var(--u)*.4)}
.ss .join{display:flex; flex-direction:column; gap:calc(var(--u)*1.1)}
.ss .qrbox{background:var(--qr-bg); border-radius:calc(var(--u)*1.2); padding:calc(var(--u)*1.4); width:calc(var(--u)*16); max-width:100%; aspect-ratio:1}
.ss .qr{width:100%; height:100%; display:block}
.ss .join .big{font-size:calc(var(--u)*2.4); font-weight:400; letter-spacing:-.01em; line-height:1.05}
.ss .join .small{font-size:calc(var(--u)*1.1); color:var(--muted); line-height:1.4}
.ss .brand{font-size:calc(var(--u)*.85); letter-spacing:.42em; text-transform:uppercase; color:var(--dim); font-weight:600}

.ss .fs{position:fixed; right:calc(16px + env(safe-area-inset-right,0px)); bottom:calc(16px + env(safe-area-inset-bottom,0px)); background:transparent; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:8px 14px; font:600 11px/1 var(--display); letter-spacing:.2em; text-transform:uppercase; cursor:pointer; transition:opacity .4s; z-index:5}
.ss .fs:focus-visible,.ss .dot:focus-visible{outline:2px solid var(--champagne); outline-offset:3px}
body.ss-idle .ss .fs{opacity:0}

.ss .ss-badge{position:fixed; left:calc(16px + env(safe-area-inset-left,0px)); bottom:calc(16px + env(safe-area-inset-bottom,0px)); border:1px solid rgba(216,190,134,.5); border-radius:999px; padding:8px 14px; font:600 11px/1 var(--display); letter-spacing:.2em; text-transform:uppercase; color:var(--champagne); background:rgba(216,190,134,.08); z-index:5; pointer-events:none}

.ss .ss-center{height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:calc(var(--u)*1.2); text-align:center; padding:calc(var(--u)*4)}
.ss .ss-center-big{font-size:calc(var(--u)*4); font-weight:300; letter-spacing:-.02em}
.ss .ss-center-big.pulse{animation:ssBreath 2.4s ease-in-out infinite}
.ss .ss-center-small{font-size:calc(var(--u)*1.3); color:var(--muted); max-width:40ch; line-height:1.4}
@keyframes ssBreath{0%,100%{opacity:1}50%{opacity:.45}}

@media (prefers-reduced-motion:reduce){
  .ss .scene{transition:none; transform:none}
  .ss .dot.on i{animation:none; width:100%}
  .ss .scene.on .place,.ss .scene.on .prize,.ss .scene.on .p1::after,.ss .scene.on .live,.ss .scene.on.sq .prizename,.ss .scene.on.sq .shot{animation:none}
}

/* Portrait screens and phones: stack the rail under the scenes */
@media (max-aspect-ratio: 1/1){
  .ss{--u: min(1.9vw, 1.1vh); overflow:auto}
  .ss .stage{grid-template-columns:minmax(0,1fr); height:auto; min-height:100%}
  .ss .scenes{min-height:calc(var(--u)*110)}
  .ss .top{flex-wrap:wrap; row-gap:calc(var(--u)*.8)}
    .ss .scene{flex-direction:column; align-items:flex-start; justify-content:center}
  .ss .shot{height:calc(var(--u)*46)}
  .ss .rail{border-left:0; border-top:1px solid var(--line); margin-right:0; flex-direction:row; flex-wrap:wrap; align-items:flex-end}
  .ss .prizes{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`;
