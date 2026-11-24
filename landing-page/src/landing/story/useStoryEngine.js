import { useEffect } from 'react';

const clamp = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/**
 * Drives the homepage story from the scroll position.
 *
 * The story is one tall section with a pinned stage. Each <article data-key
 * data-len> is a scene; data-len is how much scrolling it lasts, in viewport
 * percent. On every scroll frame this works out which scene is on stage and
 * how far through it the page is, then:
 *   - sets data-step / data-act on the section and --p / --a on its style,
 *     which is all the CSS needs to move the phone, swap the backdrop and
 *     slide the copy;
 *   - runs that scene's scrubber for the things CSS cannot count: the walk-in
 *     film's playhead, the session clock, the point counters, the story clock.
 * Scenes that are not on stage rest in their finished state, so scrolling
 * back up never shows a half-run counter.
 *
 * It writes to the DOM directly. React renders those nodes once with fixed
 * text and never touches them again, so the two do not fight. `liveRef` is the
 * one way live data gets in: the gym count the map scene counts up to, and the
 * Series label for the clock.
 */
export function useStoryEngine(rootRef, liveRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const $ = (id) => root.querySelector('#' + id);
    const story = $('story');
    const pin = story.querySelector('.hs-pin');
    const bar = $('bar');
    const dock = $('dock');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stopped = false;

    const steps = [...story.querySelectorAll('.hs-step')].map((el) => ({
      el, key: el.dataset.key, len: Number(el.dataset.len), act: el.dataset.act || '', at: Number(el.dataset.at || 0.5),
    }));
    const total = steps.reduce((sum, s) => sum + s.len, 0);
    let acc = 0;
    steps.forEach((s) => { s.start = acc; acc += s.len; });
    story.style.height = (total + 100) + (window.CSS && CSS.supports('height', '1svh') ? 'svh' : 'vh');

    const acts = [...story.querySelectorAll('.hs-hud-acts li')].map((li) => {
      const mine = steps.filter((s) => s.act === li.dataset.act);
      const last = mine[mine.length - 1];
      return { li, key: li.dataset.act, start: mine[0].start, end: last.start + last.len };
    });
    const views = [...story.querySelectorAll('.hs-view')];
    const sbTimes = [...story.querySelectorAll('.hs-sb-time')];

    /* The story clock: in the bar along the bottom on wide screens, in the dock on phones. */
    const hudA = $('hudA'), hudB = $('hudB'), hudPts = $('hudPts');
    const dockA = $('dockA'), dockB = $('dockB'), dockPts = $('dockPts');
    const setClock = (a, b) => { hudA.textContent = a; hudB.textContent = b; dockA.textContent = a; dockB.textContent = b; };
    const setPts = (n) => { hudPts.textContent = n ? '+' + n : '0'; dockPts.textContent = n ? '+' + n + ' pts' : ''; };
    const dockIdle = () => { dockA.textContent = 'Free on'; dockB.textContent = 'iOS & Android'; dockPts.textContent = ''; };

    const heroVid = $('heroVid'), walkVid = $('walkVid');
    const lockTime = $('lockTime'), walkWhen = $('walkWhen');
    const gymCount = $('gymCount'), timer = $('timer'), ladder = $('ladder'), r30 = $('r30'), r40 = $('r40'), trainWhen = $('trainWhen');
    const plus = $('plus'), wkTotal = $('wkTotal'), wkDays = [...$('wkDays').children], ticketList = $('tickets');
    let cur = -1;

    /* The walk-in film follows the scroll: its playhead chases a target instead of playing. */
    let walkTarget = 0, walkLoop = false, walkWanted = false;
    /* The film is 5 MB: only its first frame loads with the page, the rest once the visitor starts down it. */
    const wantWalk = () => { if (!walkWanted) { walkWanted = true; walkVid.preload = 'auto'; } };
    function walkTick() {
      if (stopped || cur < 0 || steps[cur].key !== 'walk') { walkLoop = false; return; }
      if (walkVid.readyState > 1 && !walkVid.seeking && Math.abs(walkVid.currentTime - walkTarget) > 0.035) walkVid.currentTime = walkTarget;
      requestAnimationFrame(walkTick);
    }
    let arrived = null;
    function arrive(on) {
      if (on === arrived) return;
      arrived = on;
      story.classList.toggle('hs-arrived', on);
      lockTime.textContent = on ? '18:02' : '18:01';
      walkWhen.textContent = on ? '18:02' : '18:01';
    }

    /* What each scene does as the page scrolls through it. */
    const scrub = {
      top(p) { if (p > 0.1) wantWalk(); setClock('Mon', '17:54'); setPts(0); dockIdle(); },
      walk(p) {
        const dur = walkVid.duration || 8;
        walkTarget = clamp(p / 0.74) * (dur - 0.08);
        const on = p > 0.46;
        arrive(on); setClock('Mon', on ? '18:02' : '18:01'); setPts(0);
      },
      map(p) {
        gymCount.textContent = fmt(Math.round(liveRef.current.partners * easeOut(clamp(p / 0.5))));
        setClock('Mon', '18:02'); setPts(0);
      },
      train(p) {
        const secs = Math.floor(43 * 60 * clamp(p / 0.84));
        const m = Math.floor(secs / 60);
        timer.textContent = pad(m) + ':' + pad(secs % 60);
        ladder.style.setProperty('--f', (secs / 60 / 45).toFixed(4));
        r30.classList.toggle('hs-on', m >= 30);
        r40.classList.toggle('hs-on', m >= 40);
        timer.classList.toggle('hs-paid', m >= 40);
        const t = '18:' + pad(4 + m);
        trainWhen.textContent = t; setClock('Mon', t); setPts(m >= 40 ? 20 : m >= 30 ? 15 : 0);
      },
      earn(p) { plus.textContent = '+' + Math.round(20 * easeOut(clamp(p / 0.3))); setClock('Mon', '18:47'); setPts(20); },
      stack(p) {
        const f = clamp(p / 0.78) * 5;
        wkDays.forEach((li, i) => li.style.setProperty('--f', clamp(f - i).toFixed(3)));
        const pts = Math.max(20, Math.round(f * 20));
        wkTotal.textContent = pts; setClock('Week', DAYS[Math.min(4, Math.floor(f))]); setPts(pts);
      },
      spend(p) {
        const n = Math.floor(p / 0.13) + 1;
        [...ticketList.children].forEach((t, i) => t.classList.toggle('hs-in', i < n));
        setClock('Week', 'Fri'); setPts(100);
      },
      series() { const [a, b] = liveRef.current.seriesLabel; setClock(a, b); setPts(100); },
      levels() { const [a, b] = liveRef.current.seriesLabel; setClock(a, b); setPts(100); },
    };

    /* Every scene rests in its finished state when it is not the one on stage. */
    function rest(key) {
      if (key !== 'map') gymCount.textContent = fmt(liveRef.current.partners);
      if (key !== 'train') {
        timer.textContent = '43:00'; timer.classList.add('hs-paid'); ladder.style.removeProperty('--f');
        r30.classList.add('hs-on'); r40.classList.add('hs-on'); trainWhen.textContent = '18:47';
      }
      if (key !== 'earn') plus.textContent = '+20';
      if (key !== 'stack') { wkDays.forEach((li) => li.style.removeProperty('--f')); wkTotal.textContent = '100'; }
      if (key !== 'spend') [...ticketList.children].forEach((t) => t.classList.add('hs-in'));
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
      if (s.el.dataset.sb) sbTimes.forEach((t) => { t.textContent = s.el.dataset.sb; });
      rest(s.key);
      if (s.key !== 'top') wantWalk();
      if (s.key === 'top' && !reduce) { const playing = heroVid.play(); if (playing && playing.catch) playing.catch(() => {}); } else heroVid.pause();
      if (s.key === 'walk' && !reduce && !walkLoop) { walkLoop = true; requestAnimationFrame(walkTick); }
    }

    let queued = false;
    function measure() {
      queued = false;
      if (stopped) return;
      const vh = pin.offsetHeight || window.innerHeight;
      const rect = story.getBoundingClientRect();
      const yl = Math.min(Math.max(-rect.top, 0) / vh * 100, total - 0.001);
      let i = steps.length - 1;
      while (i > 0 && yl < steps[i].start) i -= 1;
      const p = clamp((yl - steps[i].start) / steps[i].len);
      if (i !== cur) setStep(i);
      story.style.setProperty('--p', p.toFixed(4));
      acts.forEach((a) => {
        const f = clamp((yl - a.start) / (a.end - a.start));
        a.li.style.setProperty('--f', f.toFixed(4));
        if (a.key === steps[i].act) story.style.setProperty('--a', f.toFixed(4));
      });
      scrub[steps[i].key](p);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? clamp(window.scrollY / max) : 0) + ')';
      dock.classList.toggle('hs-show', window.scrollY > window.innerHeight * 0.4);
      if (rect.bottom < window.innerHeight * 0.5) dockIdle();
    }
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(measure); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    /* Links and the act bar jump to a point inside the pinned story. */
    function go(key) {
      const behavior = reduce ? 'auto' : 'smooth';
      const s = steps.find((x) => x.key === key);
      if (!s) { const target = $(key); if (target) target.scrollIntoView({ behavior, block: 'start' }); return; }
      const top = story.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + (s.start + s.len * s.at) / 100 * (pin.offsetHeight || window.innerHeight), behavior });
    }
    const onClick = (e) => {
      const el = e.target.closest('[data-go]');
      if (!el || !root.contains(el)) return;
      e.preventDefault();
      go(el.dataset.go);
    };
    root.addEventListener('click', onClick);

    /* Phones only load the walk-in film once it has been asked to play. */
    const prime = () => { const playing = walkVid.play(); if (playing && playing.then) playing.then(() => walkVid.pause()).catch(() => {}); };
    window.addEventListener('touchstart', prime, { once: true, passive: true });
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

    measure();

    return () => {
      stopped = true;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('touchstart', prime);
      root.removeEventListener('click', onClick);
      if (io) io.disconnect();
    };
  }, [rootRef, liveRef]);
}
