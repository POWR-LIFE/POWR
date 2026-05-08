/**
 * Shared site footer — injected into any page that includes
 * <footer id="site-footer"></footer> and calls initFooter().
 */
export function initFooter() {
    const el = document.getElementById('site-footer');
    if (!el) return;

    el.innerHTML = `
        <div class="site-footer-inner">
            <div class="site-footer-brand">
                <img
                    src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext.png?v=1.1"
                    alt="POWR Logo"
                    class="site-footer-logo" />
                <p class="site-footer-tagline">Made to Move. Designed to Reward.</p>
            </div>

            <div class="site-footer-legal">
                <a href="/support">Support</a>
                <a href="mailto:support@powr.life">support@powr.life</a>
                <a href="/privacy">Privacy Policy</a>
                <a href="/cookies">Cookie Policy</a>
            </div>

            <p class="site-footer-copyright">&copy; 2026 POWR. All rights reserved.</p>
        </div>
    `;
}
