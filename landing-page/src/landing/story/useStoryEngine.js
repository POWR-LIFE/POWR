import { useEffect } from 'react';

const clamp = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/* The walk-in film is a run of stills (public/landing-story/walk), drawn to a
   canvas. A <video> scrubbed by currentTime updates in jumps: every seek has to
   decode from the last keyframe. A still per scroll position does not. */
const FRAMES = 96;
const frameSrc = (i) => `/landing-story/walk/f${String(i).padStart(3, '0')}.webp`;

const FADE = 9;  // how much scroll (viewport %) a scene's copy takes to fade in, and to fade out
const RISE = 34; // how far (px) the copy travels while it does

/**
 * Drives the homepage story from the scroll position.
 *
 * The story is one tall section with a pinned stage. Each <article data-key
 * data-len> is a scene; data-len is how much scrolling it lasts, in viewport
 * percent. On every scroll frame this works out which scene is on stage and
 * how far through it the page is, then:
 *   - on a change of scene, sets data-step / data-act on the section, which is
 *     all the CSS needs to move the phone and swap the backdrop;
 *   - moves the scene's copy with the scroll (--o, --y on the scene), so text
 *     fades and travels as the page moves instead of swapping on a timer;
 *   - runs the scene's scrubber for what CSS cannot count: the film frame, the
 *     session clock, the point counters, the story clock.
 * Scenes that are not on stage rest in their finished state.
 *
 * Two rules keep scrolling cheap, and both matter:
 *   1. Nothing is read from layout inside a scroll frame. Sizes are measured
 *      once (layout()) and again only when the page resizes.
 *   2. A custom property is set on the one element that uses it, never on the
 *      section. Set on the section, every descendant restyles on every frame:
 *      that was 10 ms a frame before this was changed.
 * Writes go through text() / setVar(), which skip a value that has not changed.
 *
 * It writes to the DOM directly. React renders those nodes once with fixed
 * text and never touches them again. `liveRef` is the one way live data gets
 * in: the gym count the map scene counts up to, and the Series clock label.
 */
export function useStoryEngine(rootRef, liveRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const $ = (id) => root.querySelector('#' + id);
    const story = $('story');
    const pin = story.querySelector('.hs-pin');
    const rig = story.querySelector('.hs-rig');
    const bar = $('bar');
    const dock = $('dock');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stopped = false;

    const lastText = new WeakMap();
    const text = (el, v) => { if (lastText.get(el) !== v) { lastText.set(el, v); el.textContent = v; } };
    const lastVars = new WeakMap();
    const setVar = (el, name, v) => {
      let seen = lastVars.get(el);
      if (!seen) { seen = {}; lastVars.set(el, seen); }
      if (seen[name] !== v) { seen[name] = v; el.style.setProperty(name, v); }
    };

    const steps = [...story.querySelectorAll('.hs-step')].map((el) => ({
      el, key: el.dataset.key, len: Number(el.dataset.len), act: el.dataset.act || '', at: Number(el.dataset.at || 0.5),
    }));
    const total = steps.reduce((sum, s) => sum + s.len, 0);
    let acc = 0;
    steps.forEach((s) => { s.start = acc; acc += s.len; });
    story.style.height = (total + 100) + (window.CSS && CSS.supports('height', '1svh') ? 'svh' : 'vh');

    const acts = [...story.querySelectorAll('.hs-hud-acts li')].map((li) => {
      const mine = steps.filter((s) => s.act === li.dataset.act);
      const end = mine[mine.length - 1];
      return { li, key: li.dataset.act, start: mine[0].start, end: end.start + end.len };
    });
    const views = [...story.querySelectorAll('.hs-view')];
    const sbTimes = [...story.querySelectorAll('.hs-sb-time')];

    /* Who reads the scene's progress (--p) and the act's progress (--a). */
    const one = (sel) => story.querySelector(sel);
    const pUsers = {
      top: [one('.hs-bd-hero video'), rig],
      map: [one('.hs-bd-map img')],
      levels: [one('.hs-lvstrip ol')],
    };
    const aUsers = {
      tonight: [one('.hs-aw-tonight'), one('.hs-bd-train img')],
      week: [one('.hs-aw-week')],
      season: [one('.hs-aw-season'), one('.hs-bd-season img')],
    };

    /* Sizes, measured outside the scroll frame. */
    let vh = 1, storyTop = 0, storyH = 0, maxScroll = 0;
    function layout() {
      vh = pin.offsetHeight || window.innerHeight;
      storyTop = story.getBoundingClientRect().top + window.scrollY;
      storyH = story.offsetHeight;
      maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    }

    /* The story clock: in the bar along the bottom on wide screens, in the dock on phones. */
    const hudA = $('hudA'), hudB = $('hudB'), hudPts = $('hudPts');
    const dockA = $('dockA'), dockB = $('dockB'), dockPts = $('dockPts');
    const setClock = (a, b) => { text(hudA, a); text(hudB, b); text(dockA, a); text(dockB, b); };
    const setPts = (n) => { text(hudPts, n ? '+' + n : '0'); text(dockPts, n ? '+' + n + ' pts' : ''); };
    const dockIdle = () => { text(dockA, 'Free on'); text(dockB, 'iOS & Android'); text(dockPts, ''); };

    const heroVid = $('heroVid');
    const lockTime = $('lockTime'), walkWhen = $('walkWhen');
    const gymCount = $('gymCount'), timer = $('timer'), ladder = $('ladder'), r30 = $('r30'), r40 = $('r40'), trainWhen = $('trainWhen');
    const plus = $('plus'), wkTotal = $('wkTotal'), wkDays = [...$('wkDays').children], ticketList = $('tickets');
    let cur = -1;

    /* The walk-in film. Stills arrive coarse first, then the gaps, so even a fast
       scroll has something close to draw; the canvas shows the nearest one in. */
    const canvas = $('walkCanvas');
    const ctx = canvas.getContext('2d');
    const frames = new Array(FRAMES).fill(null);
    let filmWanted = false, filmShown = -1, filmTarget = 0;
    function paintFilm() {
      let pick = -1;
      for (let d = 0; d < FRAMES && pick < 0; d += 1) {
        const before = frames[filmTarget - d], after = frames[filmTarget + d];
        if (before && before.ok) pick = filmTarget - d;
        else if (after && after.ok) pick = filmTarget + d;
      }
      if (pick < 0 || pick === filmShown) return;
      filmShown = pick;
      ctx.drawImage(frames[pick], 0, 0, canvas.width, canvas.height);
    }
    function fetchFrame(i) {
      if (frames[i]) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { img.ok = true; if (!stopped) paintFilm(); };
      img.src = frameSrc(i);
      frames[i] = img;
    }
    function wantFilm() {
      if (filmWanted) return;
      filmWanted = true;
      [16, 8, 4, 2, 1].forEach((stride) => { for (let i = 0; i < FRAMES; i += stride) fetchFrame(i); });
      fetchFrame(FRAMES - 1);
    }
    fetchFrame(0);

    let arrived = null;
    function arrive(on) {
      if (on === arrived) return;
      arrived = on;
      story.classList.toggle('hs-arrived', on);
      text(lockTime, on ? '18:02' : '18:01');
      text(walkWhen, on ? '18:02' : '18:01');
    }

    /* What each scene does as the page scrolls through it. */
    let ticketsIn = -1;
    const scrub = {
      top(p) { if (p > 0.08) wantFilm(); setClock('Mon', '17:54'); setPts(0); dockIdle(); },
      walk(p) {
        filmTarget = Math.round(clamp(p / 0.74) * (FRAMES - 1));
        paintFilm();
        const on = p > 0.46;
        arrive(on); setClock('Mon', on ? '18:02' : '18:01'); setPts(0);
      },
      map(p) {
        text(gymCount, fmt(Math.round(liveRef.current.partners * easeOut(clamp(p / 0.5)))));
        setClock('Mon', '18:02'); setPts(0);
      },
      train(p) {
        const secs = Math.floor(43 * 60 * clamp(p / 0.84));
        const m = Math.floor(secs / 60);
        text(timer, pad(m) + ':' + pad(secs % 60));
        setVar(ladder, '--f', (secs / 60 / 45).toFixed(3));
        r30.classList.toggle('hs-on', m >= 30);
        r40.classList.toggle('hs-on', m >= 40);
        timer.classList.toggle('hs-paid', m >= 40);
        const t = '18:' + pad(4 + m);
        text(trainWhen, t); setClock('Mon', t); setPts(m >= 40 ? 20 : m >= 30 ? 15 : 0);
      },
      earn(p) { text(plus, '+' + Math.round(20 * easeOut(clamp(p / 0.3)))); setClock('Mon', '18:47'); setPts(20); },
      stack(p) {
        const f = clamp(p / 0.78) * 5;
        wkDays.forEach((li, i) => setVar(li, '--f', clamp(f - i).toFixed(2)));
        const pts = Math.max(20, Math.round(f * 20));
        text(wkTotal, String(pts)); setClock('Week', DAYS[Math.min(4, Math.floor(f))]); setPts(pts);
      },
      spend(p) {
        const n = Math.floor(p / 0.13) + 1;
        if (n !== ticketsIn) { ticketsIn = n; [...ticketList.children].forEach((t, i) => t.classList.toggle('hs-in', i < n)); }
        setClock('Week', 'Fri'); setPts(100);
      },
      series() { const [a, b] = liveRef.current.seriesLabel; setClock(a, b); setPts(100); },
      levels() { const [a, b] = liveRef.current.seriesLabel; setClock(a, b); setPts(100); },
    };

    /* Every scene rests in its finished state when it is not the one on stage. */
    function rest(key) {
      if (key !== 'map') text(gymCount, fmt(liveRef.current.partners));
      if (key !== 'train') {
        text(timer, '43:00'); timer.classList.add('hs-paid'); setVar(ladder, '--f', '0.955');
        r30.classList.add('hs-on'); r40.classList.add('hs-on'); text(trainWhen, '18:47');
      }
      if (key !== 'earn') text(plus, '+20');
      if (key !== 'stack') { wkDays.forEach((li) => setVar(li, '--f', '1.00')); text(wkTotal, '100'); }
      if (key !== 'spend') { ticketsIn = -1; [...ticketList.children].forEach((t) => t.classList.add('hs-in')); }
      if (key !== 'walk') arrive(true);
    }

    function setStep(i) {
      cur = i;
      const s = steps[i];
      steps.forEach((x, j) => { x.el.classList.toggle('hs-is-on', j === i); x.el.classList.toggle('hs-is-past', j < i); });
      story.dataset.step = s.key; story.dataset.act = s.act;
      acts.forEach((a) => a.li.classList.toggle('hs-on', a.key === s.act));
      const view = s.el.dataset.view;
      views.forEach((v) => v.classList.toggle('hs-is-on', v.dataset.view === view));
      if (s.el.dataset.sb) sbTimes.forEach((t) => text(t, s.el.dataset.sb));
      rest(s.key);
      if (s.key !== 'top') wantFilm();
      if (s.key === 'top' && !reduce) { const playing = heroVid.play(); if (playing && playing.catch) playing.catch(() => {}); } else heroVid.pause();
    }

    let queued = false, dockShown = null, barAt = '';
    function measure() {
      queued = false;
      if (stopped) return;
      const sy = window.scrollY;
      const yl = Math.min(Math.max(sy - storyTop, 0) / vh * 100, total - 0.001);
      let i = steps.length - 1;
      while (i > 0 && yl < steps[i].start) i -= 1;
      const s = steps[i];
      const p = clamp((yl - s.start) / s.len);
      if (i !== cur) setStep(i);

      const users = pUsers[s.key];
      if (users) { const v = p.toFixed(4); users.forEach((el) => setVar(el, '--p', v)); }

      /* The copy rides the scroll: in over the scene's first stretch, out over its last. */
      const fin = i === 0 ? 1 : clamp((yl - s.start) / FADE);
      const fout = i === steps.length - 1 ? 1 : clamp((s.start + s.len - yl) / FADE);
      setVar(s.el, '--o', Math.min(fin, fout).toFixed(3));
      setVar(s.el, '--y', reduce ? '0px' : ((fout - fin) * RISE).toFixed(1) + 'px');

      acts.forEach((a) => {
        const f = clamp((yl - a.start) / (a.end - a.start));
        setVar(a.li, '--f', f.toFixed(3));
        if (a.key === s.act) { const v = f.toFixed(4); aUsers[a.key].forEach((el) => setVar(el, '--a', v)); }
      });

      scrub[s.key](p);

      const at = 'scaleX(' + (maxScroll > 0 ? clamp(sy / maxScroll) : 0).toFixed(4) + ')';
      if (at !== barAt) { barAt = at; bar.style.transform = at; }
      const show = sy > vh * 0.4;
      if (show !== dockShown) { dockShown = show; dock.classList.toggle('hs-show', show); }
      if (storyTop + storyH - sy < vh * 0.5) dockIdle();
    }
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(measure); } };
    const onResize = () => { layout(); onScroll(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    /* The page below the story changes height (a question opens, an image lands): re-measure then, not per frame. */
    const sizeWatch = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
    if (sizeWatch) sizeWatch.observe(root);

    /* Links and the act bar jump to a point inside the pinned story. */
    function go(key) {
      const behavior = reduce ? 'auto' : 'smooth';
      const s = steps.find((x) => x.key === key);
      if (!s) { const target = $(key); if (target) target.scrollIntoView({ behavior, block: 'start' }); return; }
      layout();
      window.scrollTo({ top: storyTop + (s.start + s.len * s.at) / 100 * vh, behavior });
    }
    const onClick = (e) => {
      const el = e.target.closest('[data-go]');
      if (!el || !root.contains(el)) return;
      e.preventDefault();
      go(el.dataset.go);
    };
    root.addEventListener('click', onClick);

    if (reduce) heroVid.pause();

    /* Feature tiles settle into place as they come into view. */
    const tiles = [...root.querySelectorAll('.hs-tile')];
    let io = null;
    if (reduce || !('IntersectionObserver' in window)) tiles.forEach((t) => t.classList.add('hs-seen'));
    else {
      io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('hs-seen'); io.unobserve(e.target); }
      }), { rootMargin: '0px 0px -6% 0px' });
      tiles.forEach((t) => io.observe(t));
    }

    /* A scene change shows a large picture for the first time (a backdrop, a phone
       screen), and decoding it in that frame is a visible hitch. Decode them one
       at a time in idle moments instead, while the visitor is still on the hero. */
    const idle = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
      : (fn) => setTimeout(fn, 250);
    const toWarm = [...story.querySelectorAll('.hs-bd > img, .hs-view img, .hs-lvstrip img')];
    function warmNext() {
      if (stopped || !toWarm.length) return;
      const img = toWarm.shift();
      const next = () => idle(warmNext);
      if (img.decode) img.decode().then(next, next); else next();
    }
    idle(warmNext);

    layout();
    measure();

    return () => {
      stopped = true;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      root.removeEventListener('click', onClick);
      if (sizeWatch) sizeWatch.disconnect();
      if (io) io.disconnect();
    };
  }, [rootRef, liveRef]);
}
