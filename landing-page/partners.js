import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ─── Supabase Client ───
const SUPABASE_URL = 'https://wjvvujnicwkruaeibttt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kh2lOAPJRrdykLLOR1QVxA_jj3H4CAL';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Partner Form Submit Handler ───
async function handlePartnerSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const nameInput  = form.querySelector('#partnerName');
  const emailInput = form.querySelector('#partnerEmail');
  const submitBtn  = form.querySelector('button[type="submit"]');
  const errorMsg   = document.getElementById('partnerErrorMsg');
  const successMsg = document.getElementById('partnerSuccessMsg');

  const name  = nameInput  ? nameInput.value.trim()  : '';
  const email = emailInput ? emailInput.value.trim() : '';

  if (!name || !email) return;

  // Reset state
  if (errorMsg)  { errorMsg.style.display  = 'none'; errorMsg.textContent = ''; }
  if (successMsg)  successMsg.style.display = 'none';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

  try {
    const { error } = await supabase
      .from('waitlist')
      .insert([{ name, email, typ: 'partner' }]);

    if (error) {
      if (error.code === '23505') throw new Error("You're already on the list!");
      throw error;
    }

    // Success
    form.style.display = 'none';
    if (successMsg) successMsg.style.display = 'block';

    // Remove the note below if present
    const note = successMsg?.nextElementSibling;
    if (note && note.classList.contains('cta-note')) note.remove();

  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = err.message || 'Something went wrong. Please try again.';
      errorMsg.style.display = 'block';
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Apply Now'; }
  }
}

// ─── Attach submit handler once DOM is ready ───
function init() {
  const form = document.getElementById('partnerJoinForm');
  if (form) form.addEventListener('submit', handlePartnerSubmit);

  // ── Intersection Observer for fade-up animations ──
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.08 });
  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
  
  // ─── Nav background on scroll ───
  const nav = document.getElementById('nav');
  const updateNavState = () => {
    if (nav) {
      const scrollPos = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
      const threshold = window.innerHeight * 0.1; 
      
      if (scrollPos > threshold) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }
  };
  window.addEventListener('scroll', updateNavState);
  updateNavState(); // Initial check

  // ─── Mobile nav toggle ───
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    
    // Close on link click
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navToggle.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  // ── Discover Mockup Map ──
  try {
    const mapEl = document.getElementById('discoverMockupMap');
    if (mapEl && typeof L !== 'undefined') {
      const centerCoords = [51.5238, -0.1415];
      const mockupMap = L.map(mapEl, {
        center: centerCoords, zoom: 16,
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false, touchZoom: false
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mockupMap);

      const pathCoords = [
        [51.5242, -0.1450],
        [51.5235, -0.1435],
        [51.5228, -0.1415],
        [51.5219, -0.1387]
      ];
      L.polyline(pathCoords, { color: '#E8D200', weight: 12, opacity: 0.15, lineCap: 'round', lineJoin: 'round' }).addTo(mockupMap);
      L.polyline(pathCoords, { color: '#E8D200', weight: 6, dashArray: '1, 15', lineCap: 'round', lineJoin: 'round' }).addTo(mockupMap);
      setTimeout(() => mockupMap.invalidateSize(), 300);
    }
  } catch (err) {
    console.error('Map init failed:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
