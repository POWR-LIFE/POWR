import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { initFooter } from './src/components/SiteFooter';
import './src/components/site-footer.css';

const SUPABASE_URL = 'https://wjvvujnicwkruaeibttt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kh2lOAPJRrdykLLOR1QVxA_jj3H4CAL';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const brand    = form.querySelector('#partnerBrand');
  const category = form.querySelector('#partnerCategory');
  const name     = form.querySelector('#partnerName');
  const email    = form.querySelector('#partnerEmail');
  const offer    = form.querySelector('#partnerOffer');
  const btn      = form.querySelector('button[type="submit"]');
  const errorEl  = document.getElementById('partnerErrorMsg');
  const successEl = document.getElementById('partnerSuccessMsg');

  const data = {
    brand:    brand?.value.trim()    || '',
    category: category?.value        || '',
    name:     name?.value.trim()     || '',
    email:    email?.value.trim()    || '',
    offer:    offer?.value.trim()    || null,
  };

  if (!data.brand || !data.category || !data.name || !data.email) return;

  if (errorEl)   { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  if (successEl) successEl.style.display = 'none';
  if (btn)       { btn.disabled = true; btn.textContent = 'Sending\u2026'; }

  try {
    const { error } = await supabase
      .from('partner_applications')
      .insert([data]);

    if (error) {
      if (error.code === '23505') throw new Error("You've already applied with this email.");
      throw error;
    }

    form.style.display = 'none';
    if (successEl) successEl.style.display = 'block';

    const note = document.querySelector('.apply-note');
    if (note) note.style.display = 'none';
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Apply Now'; }
  }
}

function init() {
  initFooter();

  const form = document.getElementById('partnerApplyForm');
  if (form) form.addEventListener('submit', handleSubmit);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

  const nav = document.getElementById('nav');
  const updateNav = () => {
    if (!nav) return;
    const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
    nav.classList.toggle('scrolled', scrollY > window.innerHeight * 0.1);
  };
  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navToggle.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
