/* ════════════════════════════════════════════
   POWR Landing Page — JavaScript
   ════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Map Integration (Leaflet) ───
// Dark theme map using CartoDB Dark Matter tiles
const londonCoords = [51.505, -0.09];
const mapOptions = {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    attributionControl: false
};

const tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

// Initialize the base card map
const mapBaseEl = document.getElementById('mapBase');
let mapBase;
if (mapBaseEl) {
    mapBase = L.map('mapBase', mapOptions).setView(londonCoords, 13);
    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(mapBase);
}

// Initialize the overlay map (hidden by default)
const mapOverlayEl = document.getElementById('mapOverlay');
let mapOverlay;
if (mapOverlayEl) {
    mapOverlay = L.map('mapOverlay', mapOptions).setView(londonCoords, 13);
    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(mapOverlay);
}

// Handle map resizing when expansion triggers
function invalidateMaps() {
    if (mapBase) mapBase.invalidateSize();
    if (mapOverlay) mapOverlay.invalidateSize();
}

// Observe the overlay container for size changes during scroll expansion
if (mapOverlayEl) {
    const ro = new ResizeObserver(() => {
        invalidateMaps();
    });
    ro.observe(mapOverlayEl);
}


// ─── Scroll-triggered reveal animations ───
const observer = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));


// ─── Initialize Lenis for Smooth Scrolling ───
const lenis = new Lenis({
    lerp: 0.1, // Smoothness intensity (lower is smoother, higher is more rigid)
    smoothWheel: true,
});

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// ─── Mobile nav toggle ───
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
    navToggle.classList.toggle('open');
    navLinks.classList.toggle('open');
});

// Close mobile nav on link click
navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
        navToggle.classList.remove('open');
        navLinks.classList.remove('open');
    });
});


// ─── Smooth scroll for anchor links ───
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
        const href = anchor.getAttribute('href');
        const target = document.querySelector(href);
        if (target) {
            e.preventDefault();

            // If clicking a waitlist link while in the hero section, just focus the hero waitlist form
            if (href === '#waitlist' && window.scrollY < window.innerHeight / 2) {
                const heroInput = document.querySelector('#heroWaitlistForm input[type="email"]');
                if (heroInput) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    // Slight delay to allow any scrolling, then focus
                    setTimeout(() => heroInput.focus(), 100);
                    return;
                }
            }

            const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 72;
            const top = target.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top, behavior: 'smooth' });
        }
    });
});

// ─── Partner Link handling ───
document.querySelectorAll('.partner-link').forEach(link => {
    link.addEventListener('click', () => {
        // Reveal the website URL inputs
        document.querySelectorAll('.partner-website').forEach(input => {
            input.style.display = 'block';
            input.required = true;
        });
        // Update the submit buttons' text
        document.querySelectorAll('.waitlist-form button[type="submit"]').forEach(btn => {
            btn.textContent = 'Apply to Partner';
        });
    });
});

// ─── Normal Waitlist Link handling ───
document.querySelectorAll('a[href="#waitlist"]:not(.partner-link)').forEach(link => {
    link.addEventListener('click', () => {
        // Hide the website URL inputs
        document.querySelectorAll('.partner-website').forEach(input => {
            input.style.display = 'none';
            input.required = false;
        });
        // Revert the submit buttons' text
        document.querySelectorAll('.waitlist-form button[type="submit"]').forEach(btn => {
            btn.textContent = 'Join the Waitlist';
        });
    });
});


// ─── Nav background on scroll ───
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
        nav.classList.add('scrolled');
    } else {
        nav.classList.remove('scrolled');
    }
});


// ─── Horizontal scroll for 'How It Works' ───
const horizontalWrapper = document.getElementById('horizontalScrollWrapper');
const horizontalTrack = document.getElementById('horizontalScrollTrack');
const animatedWords = document.querySelectorAll('.animated-word');
const stepIndicators = document.querySelectorAll('.step-indicator');

if (horizontalWrapper && horizontalTrack) {
    const stepCards = horizontalTrack.querySelectorAll('.step-card');
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

    let ticking = false;

    // tick marks for premium ring
    const ticksSvg = document.getElementById('ticks');
    if (ticksSvg) {
        for (let i = 0; i < 60; i++) {
            const angle = (i / 60) * 360 - 90;
            const rad = angle * Math.PI / 180;
            const cx = 160, cy = 160, r = 140;
            const major = i % 10 === 0;
            const len = major ? 10 : 5;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', cx + r * Math.cos(rad));
            line.setAttribute('y1', cy + r * Math.sin(rad));
            line.setAttribute('x2', cx + (r - len) * Math.cos(rad));
            line.setAttribute('y2', cy + (r - len) * Math.sin(rad));
            line.setAttribute('stroke', major ? 'rgba(242,237,230,0.15)' : 'rgba(242,237,230,0.06)');
            line.setAttribute('stroke-width', major ? '1.5' : '0.8');
            ticksSvg.appendChild(line);
        }
    }

    function updateHorizontalScroll() {
        if (isMobile()) {
            // On mobile, reset horizontal track but setup static data
            horizontalTrack.style.transform = 'translateX(0)';
            stepCards.forEach(card => {
                card.classList.add('in-view');
                card.classList.remove('active');
            });
            animatedWords.forEach(word => word.classList.remove('active'));
            if (animatedWords[0]) animatedWords[0].classList.add('active');

            // ── Static Mobile Setup (Day 30) ──
            const miniCards = horizontalTrack.querySelectorAll('.mini-card');
            const miniTotal = document.getElementById('miniTotalVal');
            miniCards.forEach(mc => mc.classList.add('revealed'));
            if (miniTotal) miniTotal.textContent = '25';

            const ring = document.getElementById('ringProgress');
            const dayNum = document.getElementById('dayNum');
            const flameEl = document.getElementById('ringFlame');
            const ms1 = document.getElementById('ms1'), bar1 = document.getElementById('bar1');
            const ms2 = document.getElementById('ms2'), bar2 = document.getElementById('bar2');
            const ms3 = document.getElementById('ms3'), bar3 = document.getElementById('bar3');
            const statusEl = document.getElementById('ringStatus');

            if (ring && dayNum) {
                dayNum.textContent = '10';
                dayNum.classList.add('gold');
                ring.style.strokeDashoffset = 0;
                ring.style.stroke = '#E8D200';
                if (flameEl) flameEl.classList.add('active');
                
                if (ms1) { ms1.classList.add('active'); if (bar1) bar1.style.width = '100%'; }
                if (ms2) { ms2.classList.add('active'); if (bar2) bar2.style.width = '100%'; }
                if (ms3) { ms3.classList.add('active'); if (bar3) bar3.style.width = '100%'; }
                if (statusEl) statusEl.innerHTML = '<em>×3.0</em> — maximum multiplier.';
            }
            return;
        }

        const rect = horizontalWrapper.getBoundingClientRect();
        const wrapperHeight = horizontalWrapper.offsetHeight;
        const viewportHeight = window.innerHeight;

        // Progress: 0 when wrapper top hits viewport top → 1 when wrapper bottom reaches viewport bottom
        const scrolled = -rect.top;
        const totalScrollable = wrapperHeight - viewportHeight;

        // Progress can go slightly below 0 or above 1 due to overscroll, clamp it
        const progress = Math.max(0, Math.min(1, scrolled / totalScrollable));

        // Keyframe-based translation: each card slides in, HOLDS at center, then slides out.
        // Compressed into progress 0-0.6, leaving 0.6-1.0 for Redeem card expansion.
        const totalCards = stepCards.length;
        const viewportWidth = horizontalWrapper.querySelector('.horizontal-scroll-viewport').offsetWidth;
        const redeemCard = stepCards[2]; // The last card
        const infoPanel = horizontalWrapper.querySelector('.horizontal-scroll-info');

        // ─── Phase 1: Card Sliding (progress 0 → 0.60) ───
        const CARD_PHASE_END = 0.60;
        // ─── Phase 2: Redeem Hold (progress 0.60 → 0.65) ───
        const HOLD_END = 0.65;
        // ─── Phase 3: Redeem Expansion (progress 0.65 → 0.75) ───
        const EXPAND_END = 0.75;
        // ─── Phase 4: Map Points Counter (progress 0.75 → 1.0) ───

        if (progress <= CARD_PHASE_END) {
            // ── Normal card sliding ──
            // Map 0-0.6 to the full card timeline
            const cardProgress = progress / CARD_PHASE_END;

            const keyframes = [
                [0.00, viewportWidth],              // All cards off-screen right
                [0.05, 0],                          // Card 0 slides in fast
                [0.45, 0],                          // Card 0 holds VERY LONG
                [0.50, -viewportWidth],             // Card 1 slides in fast
                [0.90, -viewportWidth],             // Card 1 holds VERY LONG
                [0.95, -(2 * viewportWidth)],       // Card 2 slides in
                [1.00, -(2 * viewportWidth)],       // Card 2 holds briefly (covered by HOLD phase)
            ];

            let currentX = keyframes[0][1];
            for (let k = 1; k < keyframes.length; k++) {
                const [prevP, prevX] = keyframes[k - 1];
                const [currP, currX] = keyframes[k];
                if (cardProgress <= currP) {
                    const segProg = (cardProgress - prevP) / (currP - prevP);
                    const eased = prevX === currX ? 0 : segProg * segProg * (3 - 2 * segProg);
                    currentX = prevX + eased * (currX - prevX);
                    break;
                }
            }

            horizontalTrack.style.transform = `translateX(${currentX}px)`;

            // Remove expansion state
            redeemCard.classList.remove('expanding');
            redeemCard.style.cssText = '';
            if (infoPanel) infoPanel.style.opacity = '';
            const overlay1 = document.getElementById('expandOverlay');
            if (overlay1) {
                overlay1.classList.remove('visible', 'expanded');
                overlay1.style.opacity = '';
                overlay1.style.transform = '';
            }
            const vp1 = horizontalWrapper.querySelector('.horizontal-scroll-viewport');
            if (vp1) vp1.style.opacity = '';
            const sticky1 = horizontalWrapper.querySelector('.horizontal-scroll-sticky');
            if (sticky1) sticky1.style.opacity = '1';

            // Determine active card
            let activeIndex = 0;
            let minDistance = Infinity;
            stepCards.forEach((card, i) => {
                const wrapperLeft = currentX + (i * viewportWidth);
                const distanceToCenter = Math.abs(wrapperLeft);
                if (distanceToCenter < minDistance) {
                    minDistance = distanceToCenter;
                    activeIndex = i;
                }
                if (distanceToCenter < viewportWidth * 0.8) {
                    card.classList.add('in-view');
                } else {
                    card.classList.remove('in-view');
                }
            });

            // Apply active class to cards, words, numbers
            stepCards.forEach((card, i) => {
                card.classList.toggle('active', i === activeIndex);
            });
            const stepNumbers = document.getElementById('stepNumbers')?.querySelectorAll('.step-num');
            if (stepNumbers) {
                stepNumbers.forEach((num, i) => num.classList.toggle('active', i === activeIndex));
            }
            // Light up dividers as we progress: divider i is "passed" when activeIndex > i
            const stepDividers = document.getElementById('stepNumbers')?.querySelectorAll('.step-divider');
            if (stepDividers) {
                stepDividers.forEach((div, i) => div.classList.toggle('passed', activeIndex > i));
            }
            animatedWords.forEach((word, i) => word.classList.toggle('active', i === activeIndex));

            // ── Mini-card sequential reveal during Move phase ──
            const miniContainer = horizontalTrack.querySelector('.mini-cards-container');
            if (miniContainer) {
                const miniCards = miniContainer.querySelectorAll('.mini-card');
                const totalEl = document.getElementById('miniTotalVal');
                if (activeIndex === 0 && miniCards.length > 0) {
                    // Faster sub-divide of the Move hold to reveal mini-cards earlier
                    const holdStart = 0.05;
                    const holdEnd = 0.30; // Complete reveal by 30%, Card slides out at 45%
                    const holdProgress = Math.max(0, Math.min(1, (cardProgress - holdStart) / (holdEnd - holdStart)));

                    let runningTotal = 0;
                    miniCards.forEach((mc, idx) => {
                        // Each card gets a third of the hold progress
                        const cardThreshold = (idx + 0.5) / miniCards.length;
                        if (holdProgress >= cardThreshold) {
                            mc.classList.add('revealed');
                            runningTotal += parseInt(mc.dataset.points || '0', 10);
                        } else {
                            mc.classList.remove('revealed');
                        }
                    });

                    if (totalEl) totalEl.textContent = runningTotal.toLocaleString();
                } else {
                    // Not in Move phase — hide all mini-cards
                    miniCards.forEach(mc => mc.classList.remove('revealed'));
                    if (totalEl) totalEl.textContent = '0';
                }
            }

            // ── Premium ring animation during Earn phase ──
            const ring = document.getElementById('ringProgress');
            const dayEl = document.getElementById('dayNum');
            const statusEl = document.getElementById('ringStatus');
            const ms1 = document.getElementById('ms1'), bar1 = document.getElementById('bar1');
            const ms2 = document.getElementById('ms2'), bar2 = document.getElementById('bar2');
            const ms3 = document.getElementById('ms3'), bar3 = document.getElementById('bar3');
            const circ = 879; // ~2 * Math.PI * 140

            if (ring && dayEl) {
                if (activeIndex === 1) {
                    const earnStart = 0.50;
                    const earnEnd = 0.85; 
                    const earnProgress = Math.max(0, Math.min(1, (cardProgress - earnStart) / (earnEnd - earnStart)));

                    const day = Math.round(earnProgress * 10);
                    dayEl.textContent = day;
                    ring.style.strokeDashoffset = circ - earnProgress * circ;

                    const flameEl = document.getElementById('ringFlame');
                    
                    // ring colour & flame
                    if (day >= 10) { 
                        ring.style.stroke = '#E8D200'; 
                        dayEl.classList.add('gold'); 
                        if (flameEl) flameEl.classList.add('active'); 
                    }
                    else if (day >= 3) { 
                        ring.style.stroke = '#E8D200'; 
                        dayEl.classList.remove('gold'); 
                        if (flameEl) flameEl.classList.add('active'); 
                    }
                    else { 
                        ring.style.stroke = 'rgba(242,237,230,0.2)'; 
                        dayEl.classList.remove('gold'); 
                        if (flameEl) flameEl.classList.remove('active'); 
                    }

                    // milestones
                    if (ms1 && bar1) {
                        if (day >= 3)  { ms1.classList.add('active'); bar1.style.width = '100%'; }
                        else           { ms1.classList.remove('active'); bar1.style.width = (day / 3 * 100) + '%'; }
                    }

                    if (ms2 && bar2) {
                        if (day >= 7) { ms2.classList.add('active'); bar2.style.width = '100%'; }
                        else if (day >= 3) { ms2.classList.add('active'); bar2.style.width = ((day - 3) / 4 * 100) + '%'; }
                        else           { ms2.classList.remove('active'); bar2.style.width = '0%'; }
                    }

                    if (ms3 && bar3) {
                        if (day >= 10) { ms3.classList.add('active'); bar3.style.width = '100%'; }
                        else if (day >= 7) { ms3.classList.add('active'); bar3.style.width = ((day - 7) / 3 * 100) + '%'; }
                        else           { ms3.classList.remove('active'); bar3.style.width = '0%'; }
                    }

                    // status
                    if (statusEl) {
                        if (day >= 10)      statusEl.innerHTML = '<em>×3.0</em> — maximum multiplier.';
                        else if (day >= 7)  statusEl.innerHTML = `<strong>${10 - day} days</strong> to <em>×3.0</em>`;
                        else if (day >= 3)  statusEl.innerHTML = `<strong>${7 - day} days</strong> to <em>×2.0</em>`;
                        else if (day > 0)   statusEl.innerHTML = `<strong>${3 - day} days</strong> to first multiplier`;
                        else                statusEl.innerHTML = 'Start your streak.';
                    }
                } else {
                    // Reset when not in Earn phase
                    dayEl.textContent = '0';
                    ring.style.strokeDashoffset = circ;
                    ring.style.stroke = 'rgba(242,237,230,0.2)';
                    dayEl.classList.remove('gold');
                    const flameEl = document.getElementById('ringFlame');
                    if (flameEl) flameEl.classList.remove('active');
                    if (ms1) ms1.classList.remove('active');
                    if (bar1) bar1.style.width = '0%';
                    if (ms2) ms2.classList.remove('active');
                    if (bar2) bar2.style.width = '0%';
                    if (ms3) ms3.classList.remove('active');
                    if (bar3) bar3.style.width = '0%';
                    if (statusEl) statusEl.innerHTML = 'Start your streak.';
                }
            }

        } else if (progress <= HOLD_END) {
            // ── Redeem holds at center, info still visible ──
            horizontalTrack.style.transform = `translateX(${-(2 * viewportWidth)}px)`;
            redeemCard.classList.remove('expanding');
            redeemCard.style.cssText = '';
            if (infoPanel) infoPanel.style.opacity = '';
            const overlay2 = document.getElementById('expandOverlay');
            if (overlay2) {
                overlay2.classList.remove('visible', 'expanded');
                overlay2.style.opacity = '';
                overlay2.style.transform = '';
            }
            const vp2 = horizontalWrapper.querySelector('.horizontal-scroll-viewport');
            if (vp2) vp2.style.opacity = '';
            const sticky2 = horizontalWrapper.querySelector('.horizontal-scroll-sticky');
            if (sticky2) sticky2.style.opacity = '1';

            stepCards.forEach((card, i) => {
                card.classList.toggle('active', i === 2);
                card.classList.toggle('in-view', i === 2);
            });
            const stepNumbers = document.getElementById('stepNumbers')?.querySelectorAll('.step-num');
            if (stepNumbers) stepNumbers.forEach((num, i) => num.classList.toggle('active', i === 2));
            const stepDividers2 = document.getElementById('stepNumbers')?.querySelectorAll('.step-divider');
            if (stepDividers2) stepDividers2.forEach(div => div.classList.add('passed'));
            animatedWords.forEach((word, i) => word.classList.toggle('active', i === 2));

        } else if (progress <= EXPAND_END) {
            // ── Phase 3: Overlay slides LEFT then expands to fill viewport ──
            const expandProgress = (progress - HOLD_END) / (EXPAND_END - HOLD_END); // 0 → 1
            const expandOverlay = document.getElementById('expandOverlay');
            if (expandOverlay) {
                expandOverlay.classList.remove('expanded');
                expandOverlay.style.opacity = '';
                expandOverlay.style.transform = '';
            }

            // Hide the actual cards and the viewport during expansion
            stepCards.forEach(card => card.classList.remove('active', 'in-view'));
            const vpForHide = horizontalWrapper.querySelector('.horizontal-scroll-viewport');
            if (vpForHide) vpForHide.style.opacity = '0';

            // Get the sticky container rect (our coordinate system for absolute positioning)
            const stickyEl = horizontalWrapper.querySelector('.horizontal-scroll-sticky');
            const stickyRect = stickyEl.getBoundingClientRect();

            // Get the viewport element's position to know where the card was resting
            const vpEl = horizontalWrapper.querySelector('.horizontal-scroll-viewport');
            const vpRect = vpEl.getBoundingClientRect();

            // Card's resting position relative to the sticky container
            const cardW = Math.min(680, vpRect.width - 40);
            const cardH = 480;
            const cardRestLeft = (vpRect.left - stickyRect.left) + (vpRect.width - cardW) / 2;
            const cardRestTop = (vpRect.top - stickyRect.top) + (vpRect.height - cardH) / 2;

            // Show the overlay
            if (expandOverlay) {
                expandOverlay.classList.add('visible');

                if (expandProgress <= 0.5) {
                    // ── Step A: Slide left ──
                    const slideProgress = expandProgress / 0.5;
                    const eased = slideProgress * slideProgress * (3 - 2 * slideProgress);

                    // Fade out the info panel
                    if (infoPanel) infoPanel.style.opacity = String(1 - eased);

                    // Overlay slides from card's resting spot to left edge
                    const currentLeft = cardRestLeft + eased * (0 - cardRestLeft);

                    expandOverlay.style.left = `${currentLeft}px`;
                    expandOverlay.style.top = `${cardRestTop}px`;
                    expandOverlay.style.width = `${cardW}px`;
                    expandOverlay.style.height = `${cardH}px`;
                    expandOverlay.style.borderRadius = '16px';

                } else {
                    // ── Step B: Expand from left edge to fill viewport ──
                    const expandProg = (expandProgress - 0.5) / 0.5;
                    const eased = expandProg * expandProg * (3 - 2 * expandProg);

                    if (infoPanel) infoPanel.style.opacity = '0';

                    const currentTop = cardRestTop + eased * (0 - cardRestTop);
                    const currentWidth = cardW + eased * (stickyRect.width - cardW);
                    const currentHeight = cardH + eased * (stickyRect.height - cardH);
                    const currentRadius = 16 * (1 - eased);

                    expandOverlay.style.left = '0px';
                    expandOverlay.style.top = `${currentTop}px`;
                    expandOverlay.style.width = `${currentWidth}px`;
                    expandOverlay.style.height = `${currentHeight}px`;
                    expandOverlay.style.borderRadius = `${currentRadius}px`;
                }
            }

            // Hide words/numbers during expansion
            const stepNumbers = document.getElementById('stepNumbers')?.querySelectorAll('.step-num');
            if (stepNumbers) stepNumbers.forEach(num => num.classList.remove('active'));
            animatedWords.forEach(word => word.classList.remove('active'));

        } else {
            // ── Phase 4: Map Points Counter (progress 0.85 → 1.0) ──
            const mapProgress = (progress - EXPAND_END) / (1.0 - EXPAND_END); // 0 → 1
            const expandOverlay = document.getElementById('expandOverlay');

            // Hide the actual cards and the viewport
            stepCards.forEach(card => card.classList.remove('active', 'in-view'));
            const vpForHide = horizontalWrapper.querySelector('.horizontal-scroll-viewport');
            if (vpForHide) vpForHide.style.opacity = '0';
            if (infoPanel) infoPanel.style.opacity = '0';

            if (expandOverlay) {
                expandOverlay.classList.add('visible', 'expanded');

                // Keep it fully expanded
                const stickyEl = horizontalWrapper.querySelector('.horizontal-scroll-sticky');
                const stickyRect = stickyEl.getBoundingClientRect();

                expandOverlay.style.left = '0px';
                expandOverlay.style.top = '0px'; // 0 offset inside the sticky container
                expandOverlay.style.width = `${stickyRect.width}px`;
                expandOverlay.style.height = `${stickyRect.height}px`;
                expandOverlay.style.borderRadius = '0px';

                // Points Counter logic — completes before contraction starts
                const pointsProgress = Math.min(1, mapProgress / 0.75);
                const maxPoints = 1000;
                let currentPoints = Math.floor(pointsProgress * maxPoints);
                if (pointsProgress >= 0.99) currentPoints = maxPoints;

                const pointsValEl = expandOverlay.querySelector('.points-val');
                if (pointsValEl) {
                    pointsValEl.textContent = currentPoints.toLocaleString();
                }

                // Activity Thread Animation
                const threadEl = expandOverlay.querySelector('.activity-thread');
                if (threadEl) {
                    const items = threadEl.querySelectorAll('.activity-item');
                    const totalItems = items.length;

                    if (totalItems > 0) {
                        // We want to scroll through the items as mapProgress goes 0 -> 1
                        // Each item has a rough height + gap of ~50px
                        const itemHeight = 50;

                        // Current "active" index based on scroll
                        // When mapProgress is 0, index is totalItems - 1 (bottom item)
                        // When mapProgress is 1, index is 0 (top item)
                        const activeIndexRaw = (totalItems - 1) - (mapProgress * (totalItems - 1));
                        const activeIndex = Math.round(activeIndexRaw);

                        // Translate the thread up so the activeIndex is always near the top
                        // We want the active item to be centered in the 300px tall container.
                        // Container center is at 150px.
                        const containerCenter = 150;
                        const activeItemCenter = (activeIndexRaw * itemHeight) + (itemHeight / 2);

                        // We translate the container by the difference so the active item hits the center
                        const yOffset = containerCenter - activeItemCenter;
                        threadEl.style.transform = `translateY(${yOffset}px)`;

                        // Assign active class
                        items.forEach((item, idx) => {
                            if (idx === activeIndex) {
                                item.classList.add('active');
                            } else {
                                item.classList.remove('active');
                            }
                        });
                    }
                }

                // Partner pins highlighting
                const pins = expandOverlay.querySelectorAll('.partner-pin');
                pins.forEach(pin => {
                    const threshold = parseInt(pin.getAttribute('data-threshold') || '0', 10);
                    if (currentPoints >= threshold) {
                        pin.classList.add('highlighted');
                    } else {
                        pin.classList.remove('highlighted');
                    }
                });

                // ── Map Stays Expanded ──
                // Removed the contraction fade-out. By allowing the map to stay fully expanded,
                // the native scroll engine gracefully pushes it up out of the viewport as the
                // next waitlist section comes into view, creating a buttery-smooth handoff.
                expandOverlay.style.transform = 'none';
                expandOverlay.style.opacity = '1';
                expandOverlay.style.borderRadius = '0px';

                const stickyContainer = horizontalWrapper.querySelector('.horizontal-scroll-sticky');
                if (stickyContainer) stickyContainer.style.opacity = '1';
            }

            // Hide words/numbers during phase 4
            const stepNumbers = document.getElementById('stepNumbers')?.querySelectorAll('.step-num');
            if (stepNumbers) stepNumbers.forEach(num => num.classList.remove('active'));
            animatedWords.forEach(word => word.classList.remove('active'));

        }

        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(updateHorizontalScroll);
            ticking = true;
        }
    }, { passive: true });

    // Initial call
    updateHorizontalScroll();

    // Recalculate on resize
    window.addEventListener('resize', () => {
        updateHorizontalScroll();
        invalidateMaps();
    });
}


// ─── Referral Tracking ───
const urlParams = new URLSearchParams(window.location.search);
const referrerId = urlParams.get('ref');

// ─── Waitlist form handling ───
async function handleWaitlistSubmit(e) {
    e.preventDefault();
    const form = e.target;

    // Disable submit button while processing
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const emailInput = form.querySelector('input[type="email"]');
        const email = emailInput ? emailInput.value.trim() : null;

        // This handles both the main waitlist and the partners waitlist
        const websiteInput = form.querySelector('.partner-website');
        const website = websiteInput ? websiteInput.value.trim() : null;

        let favicon_url = null;
        if (website) {
            // Very naive domain extractor for favicon service
            let domain = website.replace(/^https?:\/\//, '').split('/')[0];
            favicon_url = `https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=128`;
        }

        const typ = website ? 'partner' : 'user';

        if (!email) throw new Error("Email is required");

        // Insert including the referrerId if present
        const { data, error } = await supabase
            .from('waitlist')
            .insert([{ 
                email, 
                typ, 
                website, 
                favicon_url,
                referred_by_id: referrerId
            }])
            .select();

        if (error) {
            if (error.code === '23505') { // Unique violation
                throw new Error("You're already on the list!");
            }
            throw error;
        }

        const newUser = data[0];
        
        // Robust referral URL generation
        let origin = window.location.origin;
        // If testing on localhost, ensure we use http to avoid SSL protocol errors
        if (origin.includes('localhost')) {
            origin = origin.replace('https://', 'http://');
        }
        
        let pathname = window.location.pathname;
        // Clean up pathname for prettier links
        if (pathname.endsWith('index.html')) {
            pathname = pathname.replace('index.html', '');
        }

        const referralUrl = `${origin}${pathname}?ref=${newUser.id}`;

        // Replace form with success message & referral dashboard
        const successContainer = document.createElement('div');
        successContainer.className = 'waitlist-success-container';
        
        successContainer.innerHTML = `
            <div class="waitlist-success-msg">
                🎉 You're on the list! We'll be in touch at <strong>${email}</strong>
            </div>
            <div class="referral-dashboard">
                <p class="referral-title">Invite friends to earn <strong>+10 POWR</strong></p>
                <div class="referral-link-box">
                    <input type="text" class="referral-link-input" value="${referralUrl}" readonly />
                    <button class="copy-btn">Copy</button>
                </div>
                <div class="referral-share-group">
                    <a href="https://wa.me/?text=${encodeURIComponent('Join the POWR waitlist and start earning rewards for moving! ' + referralUrl)}" target="_blank" class="share-btn wa">WhatsApp</a>
                    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Just joined the @POWR waitlist! Move to earn. Join here: ')}&url=${encodeURIComponent(referralUrl)}" target="_blank" class="share-btn tw">X / Twitter</a>
                    <a href="https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${encodeURIComponent('Join the POWR waitlist and start earning rewards for moving!')}" target="_blank" class="share-btn tg">Telegram</a>
                </div>
            </div>
        `;

        form.parentNode.replaceChild(successContainer, form);

        // Add copy logic
        const copyBtn = successContainer.querySelector('.copy-btn');
        const linkInput = successContainer.querySelector('.referral-link-input');
        copyBtn.addEventListener('click', () => {
            linkInput.select();
            document.execCommand('copy');
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.classList.remove('copied');
            }, 2000);
        });

        // Remove the note below if it exists
        const note = successContainer.nextElementSibling;
        if (note && (note.classList.contains('waitlist-note') || note.classList.contains('cta-note'))) {
            note.remove();
        }

    } catch (err) {
        alert(err.message || 'Something went wrong. Please try again.');
        if (submitBtn) submitBtn.disabled = false;
    }
}

document.querySelectorAll('.waitlist-form').forEach((form) => {
    form.addEventListener('submit', handleWaitlistSubmit);
});
