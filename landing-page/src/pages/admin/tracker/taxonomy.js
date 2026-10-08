/**
 * The POWR ecosystem, as the Tracker files work against it:
 * surface (which product) → area (which part of it) → feature (which piece).
 *
 * Issues store surface and area as keys and feature as its label, so an area
 * can be renamed here without touching a row; renaming a feature only changes
 * what new issues pick. `paths` are where the code lives, to start a fix from.
 * Add to this freely — nothing in the database lists these.
 */

export const SURFACES = [
    {
        key: 'app', label: 'Member app', short: 'App', color: '#E8D200', ink: '#8a7600',
        blurb: 'iOS + Android, Expo. Ships by OTA (JS) or EAS build (native).',
        areas: [
            { key: 'onboarding', label: 'Onboarding', paths: ['app/onboarding*.tsx', 'lib/onboarding/', 'components/onboarding/'],
              features: ['Account & sign-up', 'Name + username', 'Profile + home gym', 'Activities pick', 'Health permission', 'Wearables step', 'Location priming (when in use)', 'Background location ask', 'Notification priming', 'Invite code', 'First achievement', 'Resume where they left off'] },
            { key: 'auth', label: 'Sign-in & account', paths: ['context/AuthContext.tsx', 'lib/authFresh.ts', 'lib/secureKeychain.ts', 'lib/deviceLock.ts'],
              features: ['Email sign-in', 'Password reset', 'Email change & confirmation', 'Session restore', 'Sign-out loop', 'Keychain / secure storage', 'One account per device', 'Device transfer', 'Delete account'] },
            { key: 'home', label: 'Home', paths: ['app/(tabs)/index.tsx', 'components/home/'],
              features: ['Daily rings & steps', 'Walking progress', 'Streak card', 'Level card & level-up', 'Activity feed', 'Getting started / setup banners', 'Weekly Pact', 'Weekly recap', 'Live event card', 'Partner spotlight', 'Update banner', 'Sticky activity overlay'] },
            { key: 'geofencing', label: 'Gym check-in (geofencing)', paths: ['context/GeofenceContext.tsx', 'hooks/useGeofence.ts', 'hooks/useActiveGeofence.ts', 'lib/gymVisits.ts', 'lib/venuePresence.ts', 'modules/powr-visits/'],
              features: ['Entry / check-in', 'Dwell & points claim', 'Exit detection & visit close', 'Closed-app / background wakes', 'iOS region crossings', 'Android foreground service', 'Accuracy & radius gates', 'Visit beacon', 'Drive-by filtering', 'Travel / multi-gym coverage', 'Location off / revoked', 'Geofence arming'] },
            { key: 'points', label: 'Points & levels', paths: ['lib/health/points.ts', 'lib/api/points.ts', 'lib/api/pointsBreakdown.ts', 'hooks/usePoints.ts', 'app/points-ledger.tsx'],
              features: ['Earn ladder (client)', 'Award bounds & daily caps', 'Points ledger', 'Points breakdown sheet', 'Streak bonus', 'Level basis', 'Cardio effort ladder', 'Suppressed workouts', 'Verification source'] },
            { key: 'health', label: 'Health & wearables', paths: ['lib/health/', 'hooks/useHealthSync.ts', 'hooks/useHealthProviders.ts', 'app/wearables.tsx'],
              features: ['Apple Health', 'Health Connect', 'Samsung Health', 'Garmin (Terra)', 'Other Terra devices', 'Workout import & splitting', 'Steps', 'Sleep', 'Heart rate & zones', 'Backfill', 'Manual log', 'Background health sync'] },
            { key: 'progress', label: 'Progress', paths: ['app/(tabs)/progress.tsx', 'app/progress-detail.tsx', 'components/progress/'],
              features: ['Charts & weekly view', 'Calendar months', 'Lookback', 'Per-activity radial', 'Body tab', 'Sleep detail', 'Gym vitals', 'Hide empty activities', 'Timezone bucketing'] },
            { key: 'discover', label: 'Discover & gyms', paths: ['app/(tabs)/discover.tsx', 'lib/api/gyms.ts', 'lib/mapProvider.ts'],
              features: ['Map & clustering', 'Gym list & search', 'Gym detail page', 'Location tiers', 'Request a missing gym', 'Gym app page (team, photos)'] },
            { key: 'league', label: 'League & live events', paths: ['app/(tabs)/league.tsx', 'components/league/', 'components/events/', 'hooks/useLiveEvent.ts', 'lib/api/liveEvents.ts'],
              features: ['Leaderboards', 'Live event board', 'Event scoring', 'Rank movement', 'Event registration', 'Event QR / door', 'Event share card', 'Prize list & gallery', 'Coming soon state', 'Multi-event surfaces', 'Gym Clash', 'Pulse pushes'] },
            { key: 'challenges', label: 'Challenges & achievements', paths: ['app/challenges.tsx', 'app/shared-challenge.tsx', 'lib/social/', 'hooks/useWeeklyChallenge.ts', 'hooks/useSharedChallenges.ts'],
              features: ['Weekly challenges', 'Shared challenges (1v1 / group)', 'Challenge invites', 'Settle & endings', 'Achievements'] },
            { key: 'social', label: 'Friends & sharing', paths: ['app/friends.tsx', 'app/scan-friend.tsx', 'components/UserProfileSheet.tsx', 'components/share/'],
              features: ['Friends list', 'QR friend linking', 'Member profiles', 'Share stats card', 'Share prize / event card', 'Save card image', 'My Photo / circle camera', 'Referral & POWR ID'] },
            { key: 'rewards', label: 'Rewards & wallet', paths: ['app/(tabs)/rewards.tsx', 'app/redeem-modal.tsx', 'app/wallet.tsx', 'app/vault.tsx', 'lib/api/rewards.ts'],
              features: ['Rewards catalogue', 'Redeem flow', 'Promo codes', 'Wallet', 'Vault', 'Featured & placements', 'Affiliate in-app'] },
            { key: 'notifications', label: 'Notifications', paths: ['context/NotificationsContext.tsx', 'lib/notifications.ts', 'lib/backgroundNotificationTask.ts', 'lib/displayPush.ts', 'app/notifications.tsx'],
              features: ['Push permission & token', 'In-app activity feed', 'Step-goal nudge', 'Streak rescue', 'Gym visit pushes', 'Event pushes', 'Broadcasts received', 'Android channels', 'Headless / background task'] },
            { key: 'settings', label: 'Settings & profile', paths: ['app/settings-screen.tsx', 'app/edit-profile.tsx', 'app/permissions-help.tsx', 'app/help-centre.tsx'],
              features: ['Edit profile', 'Activity preferences', 'Permissions help', 'Help centre', 'Language', 'Legal pages'] },
            { key: 'platform', label: 'Stability & platform', paths: ['lib/crashHandler.ts', 'lib/sentry.ts', 'lib/otaUpdates.ts', 'lib/appUpdate.ts', 'app/+native-intent.tsx'],
              features: ['Crash / watchdog', 'OTA updates on device', 'Update prompt', 'Loading & performance', 'Deep links', 'Analytics events', 'Version telemetry'] },
        ],
    },
    {
        key: 'gym_portal', label: 'Gym Portal', short: 'Gym', color: '#10B981', ink: '#047857',
        blurb: 'powr.life/venue — what gyms run. Gated by the portal switch in Gym Portals.',
        areas: [
            { key: 'home', label: 'Overview', paths: ['landing-page/src/pages/venue/VenueHome.jsx', 'landing-page/src/pages/venue/GymAppCard.jsx'],
              features: ['Overview stats', 'App page preview', 'Tap-to-edit', 'Week posts'] },
            { key: 'events', label: 'Events', paths: ['landing-page/src/pages/venue/VenueEvents.jsx', 'landing-page/src/pages/venue/VenueEventBuilder.jsx', 'landing-page/src/pages/venue/VenueEventDetail.jsx'],
              features: ['Event builder', 'Event detail', 'First-event review', 'Door check-in', 'Event pushes', 'Event content'] },
            { key: 'clash_nights', label: 'Clash Nights', paths: ['landing-page/src/pages/venue/VenueClashNights.jsx'], features: ['Booking', 'Pricing', 'Cancel / call off', 'Crew'] },
            { key: 'studio', label: 'Gym Studio', paths: ['landing-page/src/pages/venue/VenueStudio.jsx', 'landing-page/src/studio/'], features: ['Templates', 'Co-branding', 'Drafts', 'Export'] },
            { key: 'screens', label: 'Screens', paths: ['landing-page/src/pages/venue/VenueScreens.jsx'], features: ['Board links', 'Screen keys'] },
            { key: 'members', label: 'Members & insights', paths: ['landing-page/src/pages/venue/VenueMembers.jsx', 'landing-page/src/pages/venue/MemberPeople.jsx'], features: ['Member list', 'Charts', 'Exports'] },
            { key: 'retention', label: 'Retention', paths: ['landing-page/src/pages/venue/VenueRetention.jsx'], features: ['Drift list', 'Visit opt-out', 'Win-back push'] },
            { key: 'settings', label: 'Settings & team', paths: ['landing-page/src/pages/venue/VenueSettings.jsx', 'landing-page/src/components/GymStaffPanel.jsx'], features: ['Gym details', 'Trainers & staff', 'Ask POWR', 'Logo & photos'] },
            { key: 'package', label: 'Package & billing', paths: ['landing-page/src/pages/venue/VenuePackage.jsx', 'landing-page/src/pages/venue/packages.jsx'], features: ['Tiers', 'Upgrade', 'Feature gates'] },
            { key: 'partners', label: 'Partner discounts', paths: ['landing-page/src/pages/venue/VenuePartners.jsx'], features: ['Discount list'] },
            { key: 'poster', label: 'Poster', paths: ['landing-page/src/pages/venue/VenuePoster.jsx'], features: ['QR poster'] },
            { key: 'access', label: 'Login & access', paths: ['landing-page/src/pages/venue/VenueLogin.jsx', 'landing-page/src/pages/venue/VenueSetup.jsx'], features: ['Login', 'Setup link', 'Portal handoff', 'Portal switch'] },
            { key: 'i18n', label: 'Languages', paths: ['landing-page/src/lib/locale.js'], features: ['Spanish', 'Translation keys'] },
        ],
    },
    {
        key: 'partner_portal', label: 'Partner Portal', short: 'Partner', color: '#0EA5E9', ink: '#0369A1',
        blurb: 'powr.life/partner — brands. Keyed on rewards.brand_name.',
        areas: [
            { key: 'home', label: 'Home & performance', paths: ['landing-page/src/pages/partner/PartnerHome.jsx'], features: ['Performance stats', 'Weekly report'] },
            { key: 'rewards', label: 'Rewards', paths: ['landing-page/src/pages/partner/PartnerRewards.jsx'], features: ['Create / edit reward', 'Reward limits', 'Reward submission link'] },
            { key: 'promo_codes', label: 'Promo codes', paths: ['landing-page/src/pages/partner/PartnerPromoCodes.jsx'], features: ['Code upload', 'Code pools'] },
            { key: 'featured', label: 'Featured & placements', paths: ['landing-page/src/pages/partner/PartnerFeatured.jsx', 'landing-page/src/pages/partner/PartnerPlacements.jsx'], features: ['Featured slots', 'Placement campaigns', 'Placement grid'] },
            { key: 'redemptions', label: 'Redemptions', paths: ['landing-page/src/pages/partner/PartnerRedemptions.jsx'], features: ['Redemption list', 'Receipts'] },
            { key: 'integration', label: 'Integrations', paths: ['landing-page/src/pages/partner/PartnerIntegrationHub.jsx', 'supabase/functions/partner-api/', 'supabase/functions/shopify-connect/'], features: ['Partner API & keys', 'Shopify', 'Webhooks', 'Docs'] },
            { key: 'settings', label: 'Settings & team', paths: ['landing-page/src/pages/partner/PartnerSettings.jsx'], features: ['Brand details', 'Team access'] },
            { key: 'access', label: 'Login & setup', paths: ['landing-page/src/pages/partner/PartnerSetup.jsx'], features: ['Login', 'Setup link', 'Setup reminder'] },
        ],
    },
    {
        key: 'affiliate_portal', label: 'Affiliate Portal', short: 'Affiliate', color: '#8B5CF6', ink: '#6D28D9',
        blurb: 'powr.life/affiliate — creators and athletes.',
        areas: [
            { key: 'home', label: 'Home', paths: ['landing-page/src/pages/creator/CreatorHome.jsx'], features: ['Stats', 'Programme'] },
            { key: 'links', label: 'Links', paths: ['landing-page/src/pages/creator/CreatorLinks.jsx', 'supabase/functions/creator-link/'], features: ['Invite links', 'QR'] },
            { key: 'conversions', label: 'Conversions', paths: ['landing-page/src/pages/creator/CreatorConversions.jsx'], features: ['Attribution', 'Conversion list'] },
            { key: 'rewards', label: 'Rewards & ladder', paths: ['landing-page/src/pages/creator/CreatorRewards.jsx'], features: ['Ladder', 'Payouts'] },
            { key: 'access', label: 'Login, setup & terms', paths: ['landing-page/src/pages/creator/CreatorSetup.jsx', 'landing-page/src/pages/creator/AffiliateTerms.jsx'], features: ['Login', 'Setup link', 'Terms', 'Join requests'] },
        ],
    },
    {
        key: 'admin', label: 'Admin panel', short: 'Admin', color: '#1A1A1A', ink: '#1A1A1A',
        blurb: 'powr.life/admin — this panel. Web-only for admins.',
        areas: [
            { key: 'users', label: 'Users & profiles', paths: ['landing-page/src/pages/admin/UserManager.jsx', 'landing-page/src/pages/admin/UserProfile.jsx'], features: ['User list', 'User profile', 'Seen devices', 'Account actions'] },
            { key: 'gyms', label: 'Gyms & gym portals', paths: ['landing-page/src/pages/admin/GymPortals.jsx', 'landing-page/src/pages/admin/GymRequests.jsx'], features: ['Portal switch', 'Gym requests', 'Gym boards', 'Gym settings preview'] },
            { key: 'partners', label: 'Partners & rewards', paths: ['landing-page/src/pages/admin/PartnerManager.jsx', 'landing-page/src/pages/admin/RewardManager.jsx'], features: ['Partners', 'Rewards', 'Submissions', 'Featured', 'Placements', 'Redemptions', 'Performance'] },
            { key: 'affiliates', label: 'Affiliates & athletes', paths: ['landing-page/src/pages/admin/CreatorManager.jsx'], features: ['Affiliates', 'Programmes', 'Requests', 'Athletes'] },
            { key: 'challenges', label: 'Challenges', paths: ['landing-page/src/pages/admin/WeeklyChallenges.jsx'], features: ['Weekly challenges', 'Shared challenges', 'Challenge analytics'] },
            { key: 'events', label: 'Live events', paths: ['landing-page/src/pages/admin/LiveEvents.jsx'], features: ['Event setup', 'Scoring', 'Duplicate', 'Prizes', 'Door board'] },
            { key: 'ops', label: 'Live Ops & sessions', paths: ['landing-page/src/pages/admin/LiveOps.jsx', 'landing-page/src/pages/admin/SessionReview.jsx'], features: ['Live Ops', 'Session review', 'Twin / duplicate flags'] },
            { key: 'health', label: 'System Health', paths: ['landing-page/src/pages/admin/SystemHealth.jsx'], features: ['Signals', 'Thresholds'] },
            { key: 'analytics', label: 'Analytics & usage', paths: ['landing-page/src/pages/admin/Analytics.jsx', 'landing-page/src/pages/admin/UsageAnalytics.jsx'], features: ['Analytics', 'Usage'] },
            { key: 'comms', label: 'Comms', paths: ['landing-page/src/pages/admin/Broadcast.jsx', 'landing-page/src/pages/admin/NotificationManager.jsx'], features: ['Broadcast', 'Scheduled broadcasts', 'Campaigns', 'Team letters', 'Notification switches', 'Streak rescue'] },
            { key: 'studio', label: 'Studio', paths: ['landing-page/src/pages/admin/Studio.jsx', 'landing-page/src/studio/'], features: ['Templates & pillars', 'Drafts', 'Instagram posting', 'Trend drops', 'Reels'] },
            { key: 'support', label: 'Support', paths: ['landing-page/src/pages/admin/SupportTickets.jsx'], features: ['Tickets', 'Replies'] },
            { key: 'vault', label: 'Vault', paths: ['landing-page/src/pages/admin/VaultManager.jsx'], features: ['Deposits', 'Grants'] },
            { key: 'config', label: 'Config & audit', paths: ['landing-page/src/pages/admin/SystemConfig.jsx', 'landing-page/src/pages/admin/AuditLog.jsx'], features: ['System config', 'Audit log'] },
            { key: 'tracker', label: 'Tracker', paths: ['landing-page/src/pages/admin/tracker/'], features: ['Board', 'Issues'] },
        ],
    },
    {
        key: 'screens', label: 'Big screens', short: 'Screens', color: '#F97316', ink: '#C2410C',
        blurb: 'Public boards on gym TVs and event nights.',
        areas: [
            { key: 'gym_board', label: 'Gym board', paths: ['landing-page/src/pages/GymBoard.jsx', 'supabase/functions/gym-board/'], features: ['/gym/<slug>', 'Logo & branding'] },
            { key: 'gym_clash', label: 'Gym Clash board', paths: ['landing-page/src/pages/GymLeague.jsx', 'supabase/functions/gym-league/'], features: ['/league/<slug>', 'Film mode', 'Basemap'] },
            { key: 'event_board', label: 'Live event board', paths: ['landing-page/src/pages/LiveBoard.jsx', 'supabase/functions/event-board/'], features: ['/live/<slug>', 'Sealed board', 'Door board'] },
            { key: 'event_promo', label: 'Event promo', paths: ['landing-page/src/pages/EventPromo.jsx', 'supabase/functions/event-promo/'], features: ['/promo/<slug>'] },
        ],
    },
    {
        key: 'web', label: 'Website', short: 'Web', color: '#60A5FA', ink: '#1D4ED8',
        blurb: 'powr.life marketing and public pages.',
        areas: [
            { key: 'landing', label: 'Home & story', paths: ['landing-page/src/landing/'], features: ['Home (v3)', 'Story film (/story)', 'App screens'] },
            { key: 'audiences', label: 'Partners & affiliates pages', paths: ['landing-page/src/landing/'], features: ['/partners', '/affiliates'] },
            { key: 'public', label: 'Support & legal', paths: ['landing-page/src/pages/SupportPage.jsx', 'landing-page/src/pages/DeleteAccount.jsx'], features: ['Support form', 'Delete account', 'Privacy / terms / cookies'] },
            { key: 'flows', label: 'Public flows', paths: ['landing-page/src/pages/AthleteSignup.jsx', 'landing-page/src/pages/PartnerRewardSubmit.jsx'], features: ['Athlete signup', 'Partner reward submit', 'Waitlist'] },
            { key: 'og', label: 'Share previews (OG)', paths: ['supabase/functions/share-card-og/', 'supabase/functions/challenge-invite-og/'], features: ['Share card OG', 'Challenge invite OG'] },
        ],
    },
    {
        key: 'backend', label: 'Backend', short: 'Backend', color: '#F43F5E', ink: '#BE123C',
        blurb: 'Supabase: database, RLS, edge functions, crons.',
        areas: [
            { key: 'points', label: 'Points & claims', paths: ['supabase/functions/claim-points/', 'supabase/functions/award-bonus/'], features: ['claim-points', 'award-bonus', 'DB guards & clamps', 'Ledger integrity'] },
            { key: 'visits', label: 'Gym visits & presence', paths: ['supabase/functions/gym-visit-beacon/'], features: ['Visit open / close', 'Reaper & sweep', 'Day uniqueness', 'Presence pass'] },
            { key: 'health_ingest', label: 'Health ingest', paths: ['supabase/functions/terra-webhook/', 'supabase/functions/terra-poll/', 'supabase/functions/samsung-health-oauth/'], features: ['Terra webhook', 'Terra poll', 'Samsung OAuth'] },
            { key: 'challenges', label: 'Challenges engine', paths: ['supabase/functions/create-shared-challenge/', 'supabase/functions/resolve-shared-challenges/'], features: ['Create / respond', 'Resolve', 'Weekly complete'] },
            { key: 'events', label: 'Live events engine', paths: ['supabase/functions/event-board/', 'supabase/functions/notify-gym-event/'], features: ['Scoring', 'Board feed', 'Gym event notify'] },
            { key: 'rewards', label: 'Rewards & redemption', paths: ['supabase/functions/redeem-reward/', 'supabase/functions/release-vault-deposits/'], features: ['Redeem', 'Vault release', 'Partner webhooks'] },
            { key: 'push', label: 'Push delivery', paths: ['supabase/functions/send-push-notification/', 'supabase/functions/admin-broadcast-push/'], features: ['FCM / APNs', 'push_send_log', 'Fan-out batching', 'Tokens'] },
            { key: 'crons', label: 'Crons & scheduled jobs', paths: ['supabase/functions/dispatch-daily-nudges/', 'supabase/functions/streak-rescue-sweep/', 'supabase/functions/dispatch-scheduled-broadcasts/'], features: ['Daily nudges', 'Streak rescue sweep', 'Scheduled broadcasts', 'Gym drift digest', 'Monday recap'] },
            { key: 'security', label: 'RLS & security', paths: ['supabase/migrations/'], features: ['RLS policies', 'Security definer', 'Admin reads', 'Service role', 'Storage policies'] },
            { key: 'schema', label: 'Schema & data', paths: ['supabase/migrations/'], features: ['Migrations', 'Indexes & performance', 'Row caps (1000)', 'Data fixes & backfills'] },
            { key: 'auth', label: 'Auth', paths: ['supabase/functions/admin-manage-user/'], features: ['Email confirmation', 'PKCE / OAuth', 'User admin'] },
            { key: 'integrations', label: 'Third-party integrations', paths: ['supabase/functions/publish-instagram/', 'supabase/functions/shopify-webhook/', 'supabase/functions/partner-api/'], features: ['Instagram', 'Shopify', 'Partner API', 'Terra'] },
        ],
    },
    {
        key: 'email', label: 'Email', short: 'Email', color: '#14B8A6', ink: '#0F766E',
        blurb: 'Mailgun sends from edge functions.',
        areas: [
            { key: 'member', label: 'Member emails', paths: ['supabase/functions/send-welcome-email/', 'supabase/functions/send-weekly-summary/', 'supabase/functions/send-level-up-email/'], features: ['Welcome', 'Weekly summary', 'Level-up', 'Re-engagement', 'Redemption receipt'] },
            { key: 'gym', label: 'Gym emails', paths: ['supabase/functions/send-gym-email/'], features: ['Lifecycle', 'Monday recap', 'Drift digest'] },
            { key: 'partner', label: 'Partner emails', paths: ['supabase/functions/send-brand-weekly-report/', 'supabase/functions/send-partner-setup-reminder/'], features: ['Brand weekly report', 'Setup reminder'] },
            { key: 'delivery', label: 'Delivery & templates', paths: ['supabase/functions/send-email/', 'supabase/functions/email-previews/'], features: ['Mailgun limits', 'Deep links', 'Previews', 'Waitlist'] },
        ],
    },
    {
        key: 'release', label: 'Build & release', short: 'Release', color: '#64748B', ink: '#334155',
        blurb: 'How code reaches people: OTA, EAS, stores, Vercel, Supabase deploys.',
        areas: [
            { key: 'ota', label: 'OTA updates', paths: ['eas.json', 'lib/otaUpdates.ts'], features: ['1.6.0 channel', '1.5.1 channel (worktree only)', 'Fingerprint / runtime', 'Clean npm ci'] },
            { key: 'native', label: 'Native builds (EAS)', paths: ['eas.json', 'app.config.js', 'ios/'], features: ['iOS build', 'Android build', 'Config plugins', 'Native modules'] },
            { key: 'stores', label: 'App Store & Play', features: ['App Store review', 'Play review & policy', 'Store listing'] },
            { key: 'web_deploy', label: 'Web deploys', paths: ['vercel.json', 'landing-page/vercel.json'], features: ['Vercel', 'Domains'] },
            { key: 'supabase_deploy', label: 'Supabase deploys', paths: ['supabase/'], features: ['Migrations applied', 'Function deploys', 'Secrets'] },
            { key: 'ci', label: 'CI & repo health', features: ['CodeQL', 'Dependabot', 'Tests', 'Lint'] },
            { key: 'observability', label: 'Monitoring', paths: ['lib/sentry.ts'], features: ['Sentry', 'Watchers', 'Logs'] },
            { key: 'secrets', label: 'Keys & secrets', features: ['Key rotation', 'Google Maps keys', 'Service role'] },
        ],
    },
    {
        key: 'ops', label: 'Operations & data', short: 'Ops', color: '#A16207', ink: '#854D0E',
        blurb: 'Not code: gym data, event nights, onboarding gyms and brands.',
        areas: [
            { key: 'gym_data', label: 'Gym directory data', features: ['Pins & coordinates', 'Geofence radius', 'Logos & photos', 'Chain estate loads', 'Opening soon / inactive'] },
            { key: 'event_nights', label: 'Event nights', features: ['Pre-event checks', 'On the night', 'Post-event scoring', 'Prizes'] },
            { key: 'gym_onboarding', label: 'Gym onboarding', features: ['Portal switch-on', 'Staff setup', 'Screens install'] },
            { key: 'partner_onboarding', label: 'Brand onboarding', features: ['Setup', 'Rewards live', 'Approvals'] },
            { key: 'support_followups', label: 'Member follow-ups', features: ['Points corrections', 'Account fixes'] },
            { key: 'demo_data', label: 'Demo & seed data', features: ['POWR gym demo people', 'Cleanup'] },
        ],
    },
    {
        key: 'brand', label: 'Brand & content', short: 'Brand', color: '#EC4899', ink: '#BE185D',
        blurb: 'Social, video, decks. Copy authority: POWR_Brand_Narrative.md.',
        areas: [
            { key: 'social', label: 'Social posts', features: ['Instagram', 'Partner posts', 'Gym posts'] },
            { key: 'video', label: 'Trailers & explainers', features: ['App trailer', 'Explainer series', 'Gym Clash trailer', 'Promos'] },
            { key: 'decks', label: 'Decks & sales', features: ['Investor deck', 'Gym sales', 'Partner sales'] },
            { key: 'copy', label: 'Copy & naming', features: ['App copy', 'Email copy', 'Store copy'] },
        ],
    },
];

const SURFACE_BY_KEY = Object.fromEntries(SURFACES.map(s => [s.key, s]));

export const surfaceOf = (key) => SURFACE_BY_KEY[key] ?? null;

export const areaOf = (surfaceKey, areaKey) =>
    SURFACE_BY_KEY[surfaceKey]?.areas.find(a => a.key === areaKey) ?? null;

// "App › Gym check-in (geofencing) › Exit detection & visit close"
export const placeLabel = (issue, { short = false } = {}) => {
    const s = surfaceOf(issue.surface);
    const a = areaOf(issue.surface, issue.area);
    return [s ? (short ? s.short : s.label) : issue.surface, a?.label ?? issue.area, issue.feature]
        .filter(Boolean).join(' › ');
};

// Every edge function, for the ship plan's deploy step.
export const EDGE_FUNCTIONS = [
    'admin-broadcast-push', 'admin-manage-user', 'admin-review-session', 'admin-team-letters', 'award-bonus',
    'challenge-invite-og', 'claim-points', 'complete-shared-challenge', 'complete-weekly-challenge',
    'create-shared-challenge', 'creator-link', 'dispatch-daily-nudges', 'dispatch-scheduled-broadcasts',
    'email-previews', 'event-board', 'event-promo', 'gym-board', 'gym-league', 'gym-visit-beacon',
    'manage-creator-user', 'manage-friendship', 'manage-gym-staff', 'manage-partner-api', 'manage-partner-user',
    'notify-creator-request', 'notify-gym-event', 'notify-new-user', 'notify-vault-grant', 'notify-waitlist',
    'partner-api', 'partner-reward-submission', 'partner-webhook-dispatch', 'portal-handoff', 'publish-instagram',
    'redeem-reward', 'release-vault-deposits', 'resolve-shared-challenges', 'respond-shared-challenge',
    'samsung-health-oauth', 'send-brand-weekly-report', 'send-email', 'send-gym-email', 'send-level-up-email',
    'send-partner-setup-reminder', 'send-push-notification', 'send-redemption-receipt', 'send-reengagement-email',
    'send-weekly-summary', 'send-welcome-email', 'share-card-og', 'shopify-connect', 'shopify-webhook',
    'streak-rescue-sweep', 'submit-support-ticket', 'terra-auth', 'terra-poll', 'terra-webhook', 'upgrade-gym-tier',
];
