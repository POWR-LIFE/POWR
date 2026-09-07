import fs from 'fs';
import path from 'path';

/**
 * Discover's location handling is a READ-only surface with two banner tiers:
 *  - foreground missing  → "Location is off"           → PermissionFixScreen 'location'
 *  - While Using only    → "Automatic check-ins are off" → PermissionFixScreen 'location-background'
 *
 * Both asks happen behind the primed screen off a user tap. The repo invariant
 * (see project_onboarding_permission_priming) is that no launch/mount path may
 * fire an OS permission dialog cold — one iOS "Don't Allow" burns it forever.
 * Source assertions, because the screen is a 2k-line map tab with no render
 * harness and this is the kind of regression a refactor re-introduces quietly.
 */
const src = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'discover.tsx'), 'utf8');

describe('discover.tsx location tiers', () => {
    it('never requests a location permission itself — reads only', () => {
        // Call sites, not mentions: a comment in the file describes the old
        // mount-time request precisely so nobody reintroduces it.
        expect(src).not.toMatch(/Location\.requestForegroundPermissionsAsync\(/);
        expect(src).not.toMatch(/Location\.requestBackgroundPermissionsAsync\(/);
        expect(src).toMatch(/Location\.getForegroundPermissionsAsync\(/);
    });

    it('probes the background tier through the shared While-Using gate', () => {
        expect(src).toMatch(/isWhileUsingOnly\(\)/);
    });

    it('opens the primed background screen from the second banner, never a takeover', () => {
        expect(src).toMatch(/setLocationFix\('location-background'\)/);
        // The background tier must not spend the foreground pacing counter.
        const bgBanner = src.slice(src.indexOf('showBackgroundBanner &&'));
        const bgBannerEnd = bgBanner.indexOf('</Pressable>');
        expect(bgBanner.slice(0, bgBannerEnd)).not.toMatch(/recordForegroundPromptShown/);
    });

    it('renders both banner tiers with the primed screen kind driven by one state', () => {
        expect(src).toMatch(/<PermissionFixScreen kind=\{locationFix\}/);
        expect(src).toMatch(/Automatic check-ins are off\./);
        expect(src).toMatch(/Location is off\./);
    });
});
