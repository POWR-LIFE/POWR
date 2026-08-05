import { pg, w } from './theme';
import { LOGO_SRC } from './LogoMorph';

/**
 * The site footer — brand + tagline, support/legal links, and a subordinate
 * second tier for the brand/partner audience.
 *
 * Shared by every page on the marketing canvas (the homepage film and the
 * partners page), so a link added here shows up on both. It ships its own
 * layout CSS because the classes are only ever used by this component.
 */
export default function SiteFooter() {
  const links = [
    { label: 'Support', href: '/support' },
    { label: 'support@powr.life', href: 'mailto:support@powr.life' },
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Cookie Policy', href: '/cookies' },
  ];
  /* Second tier: brand/partner audience. Deliberately subordinate to the links
     above — a consumer never needs these, a brand scrolls looking for them.
     No email here: brands and members share support@powr.life, and it is
     already one row up. */
  const brandLinks = [
    { label: 'Partner With Us', href: '/partners' },
    { label: 'Partner Login', href: '/partner/login' },
    { label: 'Integration Docs', href: '/docs' },
  ];
  return (
    <footer style={{ borderTop: `1px solid ${pg.border}`, padding: '40px clamp(18px, 3vw, 28px)' }}>
      <FooterStyles />
      <div className="powr-footer-inner">
        <div className="powr-footer-brand">
          <img src={LOGO_SRC} alt="POWR" style={{ height: 28, width: 'auto', display: 'block', opacity: 0.5 }} />
          <span style={{ fontSize: 13, color: pg.textSec, fontWeight: w.light }}>Made to Move. Designed to Reward.</span>
        </div>
        <div className="powr-footer-links">
          {links.map((l) => (
            <a key={l.label} className="powr-footer-link" href={l.href}>{l.label}</a>
          ))}
        </div>
      </div>
      <div className="powr-footer-sub">
        <div className="powr-footer-links">
          <span className="powr-footer-label">For Brands</span>
          {brandLinks.map((l) => (
            <a key={l.label} className="powr-footer-link" href={l.href}>{l.label}</a>
          ))}
        </div>
        <span style={{ fontSize: 12, color: pg.textSec, fontWeight: w.light }}>© 2026 POWR. All rights reserved.</span>
      </div>
    </footer>
  );
}

function FooterStyles() {
  return (
    <style>{`
      .powr-footer-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 24px; }
      .powr-footer-brand { display: flex; align-items: center; gap: 16px; }
      .powr-footer-links { display: flex; gap: 24px; flex-wrap: wrap; }
      .powr-footer-link { font-size: 13px; color: ${pg.textSec}; font-weight: 300; text-decoration: none; transition: color 0.2s; }
      .powr-footer-link:hover { color: ${pg.accent}; }
      .powr-footer-sub { max-width: 1200px; margin: 24px auto 0; padding-top: 20px; border-top: 1px solid ${pg.border}; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px 24px; }
      .powr-footer-sub .powr-footer-link { font-size: 12px; opacity: 0.72; }
      .powr-footer-sub .powr-footer-link:hover { opacity: 1; }
      .powr-footer-label { font-size: 10px; color: ${pg.textSec}; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6; }
      @media (max-width: 768px) {
        .powr-footer-inner { flex-direction: column; text-align: center; gap: 16px; }
        .powr-footer-brand { flex-direction: column; gap: 8px; }
        .powr-footer-links { justify-content: center; gap: 14px 18px; }
        .powr-footer-sub { flex-direction: column; text-align: center; gap: 14px; }
      }
    `}</style>
  );
}
