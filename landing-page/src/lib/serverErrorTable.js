// The server messages the portals know, and their keys in the `serverErrors`
// namespace (shared/i18n/<lang>/portal/serverErrors.json). serverErrors.js does
// the lookup; this file is plain data so __tests__/portalServerErrors.test.ts can
// check it against the catalogs without Vite.
//
// Each English value in the catalog is the server's text exactly. When a
// server message changes, change it here and in en/serverErrors.json together
// (the test fails until both agree). Sources:
//   - Postgres: `raise exception` in the latest supabase/migrations definition
//     of the gym_*, partner_*, in-store, placement and code RPCs and triggers
//     the portals call or write through.
//   - Edge functions the portals invoke: manage-gym-staff, manage-partner-user,
//     manage-partner-api (+ _shared/mintTest.ts, _shared/webhookSign.ts),
//     shopify-connect.
//   - Supabase itself: Auth sign-in messages and functions-js's two generic errors.
// Left out on purpose: admin-only messages ("Preview only…", admin RPCs),
// internal callers (cron, webhooks, Shopify OAuth), and developer assertions
// (unknown keys, "x is required", raw true/false or list shapes).

/** Exact server message → key. */
export const EXACT = {
    // Shared by several functions
    'Not authorised': 'serverErrors:common.notAuthorised',
    'Not found': 'serverErrors:common.notFound',
    'Nothing to change': 'serverErrors:common.nothingToChange',
    'Nothing to save': 'serverErrors:common.nothingToSave',
    'Nothing to update': 'serverErrors:common.nothingToUpdate',
    'Already sent today. It can go again tomorrow': 'serverErrors:common.sentToday',
    'Unauthorized': 'serverErrors:common.unauthorized',
    'Forbidden': 'serverErrors:common.forbidden',
    'Enter a valid email address': 'serverErrors:common.invalidEmail',
    'Password must be at least 8 characters': 'serverErrors:common.passwordLength',

    // Gym portal: the gym itself
    'Gym not found': 'serverErrors:gym.notFound',
    "Your package doesn't include this. See Package in your portal to change it.": 'serverErrors:gym.packageMissing',
    'The name needs 2 to 60 characters': 'serverErrors:gym.nameLength',
    'Upload the logo here rather than linking to it': 'serverErrors:gym.uploadLogo',
    'Upload the photo here rather than linking to it': 'serverErrors:gym.uploadPhoto',
    'Upload the image here rather than linking to it': 'serverErrors:gym.uploadImage',

    // Gym events: builder, publishing, results
    'Event not found': 'serverErrors:event.notFound',
    'Give the event a name of 3–48 characters': 'serverErrors:event.nameLength',
    'Pick a start date': 'serverErrors:event.pickStartDate',
    'Add between 1 and 5 prizes': 'serverErrors:event.prizeCount',
    'Each prize needs 2–60 characters': 'serverErrors:event.prizeLength',
    'Upload prize photos here rather than linking to them': 'serverErrors:event.prizePhotoUpload',
    'Add up to 8 rules of your own': 'serverErrors:event.rulesCount',
    'Keep each rule under 200 characters': 'serverErrors:event.ruleLength',
    'Keep the headline under 80 characters': 'serverErrors:event.headlineLength',
    "That points option isn't available for this kind of event": 'serverErrors:event.pointsOption',
    'Pick one of the nearby distances offered': 'serverErrors:event.distance',
    'Pick one of the lengths offered': 'serverErrors:event.length',
    'Pick one of the finale night times offered': 'serverErrors:event.finaleTime',
    'Pick one of the finale night lengths offered': 'serverErrors:event.finaleLength',
    'Pick at least one activity': 'serverErrors:event.activityRequired',
    "One of those activities can't count towards an event": 'serverErrors:event.activityNotAllowed',
    'Say whether only sessions at your gym count': 'serverErrors:event.gymOnly',
    'Pick one of the leaderboard sizes offered': 'serverErrors:event.boardSize',
    'Add a booking link starting https://': 'serverErrors:event.bookingLinkHttps',
    "A booking link can't ask for members' email addresses": 'serverErrors:event.bookingLinkEmail',
    'Say whether the logo stands in for the name': 'serverErrors:event.logoAsName',
    "That partner code isn't available right now": 'serverErrors:event.partnerCodeUnavailable',
    'Pick a kind of event': 'serverErrors:event.pickKind',
    'An event needs a name, a start date and at least one prize': 'serverErrors:event.needsBasics',
    'Pick a start date from today on': 'serverErrors:event.startFromToday',
    "That can't change once the event has started": 'serverErrors:event.lockedAfterStart',
    'A published event needs to start at least 2 hours from now': 'serverErrors:event.publishedNotice',
    'This event is already published or waiting for POWR': 'serverErrors:event.alreadyPublished',
    "Move the start date: a new event needs at least 2 hours' notice": 'serverErrors:event.newEventNotice',
    'Events can be published up to 90 days ahead': 'serverErrors:event.publishHorizon',
    'Add at least one prize': 'serverErrors:event.addPrize',
    'Your gym has no location on POWR yet — contact POWR': 'serverErrors:event.noLocation',
    'Only an event waiting for POWR can be withdrawn': 'serverErrors:event.withdrawOnlyPending',
    'Only a draft can be deleted — cancel a published event instead': 'serverErrors:event.deleteOnlyDraft',
    "Only an event that hasn't started can be cancelled — contact POWR": 'serverErrors:event.cancelOnlyUpcoming',
    'The winners can be revealed once the board has sealed': 'serverErrors:event.revealAfterSeal',
    'The winners are already out': 'serverErrors:event.alreadyRevealed',
    'Pick a time after the board seals and within a week of it': 'serverErrors:event.revealWindow',
    'The results are final — contact POWR': 'serverErrors:event.resultsFinal',
    'Say why (3–200 characters) — POWR sees the reason': 'serverErrors:event.disqualifyReason',
    "They're not in this event": 'serverErrors:event.notInEvent',
    'This event is over': 'serverErrors:event.isOver',
    'This event has no finale night': 'serverErrors:event.noFinaleNight',

    // The door on a finale night, and prizes handed over
    'This event has no finale bonus, so there is nothing to check in for': 'serverErrors:door.noFinaleBonus',
    'The door is only open while the event is on': 'serverErrors:door.eventNotOn',
    'The door opens two hours before the finale and closes six hours after': 'serverErrors:door.window',
    'Already checked in': 'serverErrors:door.alreadyIn',
    "That's the limit for check-ins by hand tonight. Ask POWR if more people are here.": 'serverErrors:door.limit',
    'Prizes are handed over after the reveal': 'serverErrors:door.prizesAfterReveal',
    'No prize with that rank': 'serverErrors:door.noPrizeRank',

    // Event pushes
    'The standings push only goes out while the event is live, before the board is sealed': 'serverErrors:pushes.pulseWindow',
    'Pick an hour for the standings push': 'serverErrors:pushes.pickHour',
    'The standings push goes out between 7am and 9pm': 'serverErrors:pushes.hourRange',

    // Big screens
    "Only the gym's owner can switch the screens on": 'serverErrors:screens.ownerOnly',
    'Use 2–40 lower-case letters, numbers and single dashes': 'serverErrors:screens.slugFormat',
    "This gym's screens are already set up": 'serverErrors:screens.alreadySetUp',
    'That link is taken by another gym — try another': 'serverErrors:screens.slugTaken',
    'Switch the screens on first': 'serverErrors:screens.notSetUp',
    'Viewing distance is near, standard or far': 'serverErrors:screens.viewingDistance',
    'Board size is 10, 25 or 50': 'serverErrors:screens.boardSize',
    'League radius is 5, 10, 15, 25, 50 or 100 km': 'serverErrors:screens.leagueRadius',
    "Only the gym's owner can change the screen link": 'serverErrors:screens.ownerLink',

    // Clash Nights
    'Clash Nights come with Clash Pro. See Package in your portal to change it.': 'serverErrors:clash.needsPro',
    'Pick a date': 'serverErrors:clash.pickDate',
    'You can book up to a year ahead.': 'serverErrors:clash.horizon',
    'Pick a start time between 6am and 9pm': 'serverErrors:clash.startTime',
    'The backup date needs the same notice, and must be a different day': 'serverErrors:clash.backupDate',
    "You already have a Clash Night in that quarter. It's one per quarter.": 'serverErrors:clash.perQuarter',
    'That night is already taken. Pick another date.': 'serverErrors:clash.taken',
    "That night isn't booked": 'serverErrors:clash.notBooked',
    'That night has already happened': 'serverErrors:clash.past',

    // Partner discounts for gyms
    "That discount isn't available right now": 'serverErrors:discounts.unavailable',
    "That brand's link isn't set up yet": 'serverErrors:discounts.noLink',
    'No codes left for that brand right now': 'serverErrors:discounts.noCodes',

    // Retention
    'You can only remove your own notes': 'serverErrors:retention.ownNotesOnly',
    'Pick how you reached out': 'serverErrors:retention.pickChannel',
    'Keep the note under 280 characters': 'serverErrors:retention.noteLength',
    "That person isn't on your list": 'serverErrors:retention.notOnList',
    "They aren't slipping or drifting, or POWR can't reach their phone": 'serverErrors:retention.cantNudge',
    "Only the gym's team has this switch": 'serverErrors:retention.teamOnlySwitch',

    // Package
    'This gym has no portal': 'serverErrors:package.noPortal',
    "Only your gym's owner can change the package": 'serverErrors:package.ownerOnly',
    'Pick a package': 'serverErrors:package.pick',
    "You're already on that package": 'serverErrors:package.already',
    'Founding Pro was only available during the free trial': 'serverErrors:package.foundingTrialOnly',
    'All 10 founding places have gone': 'serverErrors:package.foundingGone',

    // The team on the gym's page in the app
    'Only the owner can change who shows in the app': 'serverErrors:team.ownerOnly',
    "They're not on your team any more": 'serverErrors:team.gone',
    'Nothing to order': 'serverErrors:team.nothingToOrder',
    'Give them a name': 'serverErrors:team.giveName',
    "That's 40 people already. Take someone off first.": 'serverErrors:team.full',
    'Keep the role under 30 characters': 'serverErrors:team.roleLength',
    'Keep the experience short, like 8 years': 'serverErrors:team.experienceLength',
    'Keep the bio under 500 characters': 'serverErrors:team.bioLength',
    'Keep each specialty under 24 characters': 'serverErrors:team.specialtyLength',
    'Pick up to 6 specialties': 'serverErrors:team.specialtyCount',
    'The booking link needs to be a web address, like calendly.com/yourname': 'serverErrors:team.bookingLinkFormat',
    'The profile link needs to be a web address, like calendly.com/yourname': 'serverErrors:team.profileLinkFormat',
    'That booking link is too long': 'serverErrors:team.bookingLinkLength',
    'That profile link is too long': 'serverErrors:team.profileLinkLength',

    // Gym settings
    "Only the owner can change the gym's details": 'serverErrors:profile.ownerOnly',
    'Keep the description under 400 characters': 'serverErrors:profile.descriptionLength',
    'Keep the address under 200 characters': 'serverErrors:profile.addressLength',
    'That phone number is too long': 'serverErrors:profile.phoneLength',
    'That web address is too long': 'serverErrors:profile.websiteLength',
    'The logo background is dark, black or white': 'serverErrors:profile.logoBackground',
    'Give each day an open and close time, like 06:00 and 22:00': 'serverErrors:profile.hours',

    // Help (gym support tickets)
    'Add a subject': 'serverErrors:help.subject',
    'Tell us a little more (10 characters or more)': 'serverErrors:help.moreDetail',
    "You've sent a few just now. We'll answer those first.": 'serverErrors:help.tooMany',

    // manage-gym-staff
    'You already have a POWR account with this email — sign in with it below and the invite will be added to it.': 'serverErrors:gymStaff.accountExists',
    'Only POWR can add another owner': 'serverErrors:gymStaff.ownerInvite',
    'Invite not found': 'serverErrors:gymStaff.inviteNotFound',
    'Not on this gym’s team': 'serverErrors:gymStaff.notOnTeam',
    'Only POWR can remove an owner': 'serverErrors:gymStaff.ownerRemove',
    'Link created, but the email could not be sent — copy it instead.': 'serverErrors:gymStaff.emailFailed',

    // manage-partner-user
    'An account with this email already exists. Contact POWR to link it to your brand.': 'serverErrors:partnerUsers.accountExists',
    "You can't remove your own access": 'serverErrors:partnerUsers.removeSelf',
    'Link created, but the email could not be sent — copy it below instead.': 'serverErrors:partnerUsers.emailFailed',

    // In store (partner portal and the staff scan page)
    'Sign in first': 'serverErrors:inStore.signIn',
    'This login is not linked to a brand': 'serverErrors:inStore.noBrand',
    'This scan link no longer works. Ask your manager for a new one.': 'serverErrors:inStore.scanLinkDead',
    'Open your scan link, or sign in to the partner portal.': 'serverErrors:inStore.scanSignIn',
    'Give the site a name': 'serverErrors:inStore.siteName',
    'Drop a pin on the map for this site': 'serverErrors:inStore.sitePin',
    'Site not found': 'serverErrors:inStore.siteNotFound',
    'Add their name': 'serverErrors:inStore.staffName',
    'Staff member not found': 'serverErrors:inStore.staffNotFound',
    'Pick online, in store or both': 'serverErrors:inStore.pickWhere',
    "In-store rewards aren't switched on for your brand yet. Talk to POWR to get set up.": 'serverErrors:inStore.notEnabled',
    'Pick how your shop checks it': 'serverErrors:inStore.pickCheck',
    'Unknown barcode type': 'serverErrors:inStore.barcodeType',
    'Reward not found': 'serverErrors:inStore.rewardNotFound',
    "Posted rewards can't be used in store": 'serverErrors:inStore.postedReward',
    'A link reward has no codes for a till to scan. Use staff scan or look at the screen.': 'serverErrors:inStore.linkReward',

    // Promo codes
    'You cannot reconcile codes for this reward': 'serverErrors:codes.reconcileForbidden',
    'A reconciliation upload can contain at most 5,000 codes': 'serverErrors:codes.reconcileMax',

    // Placements (the server answers with codes; English readers see the code)
    'PLACEMENT_NOT_FOUND': 'serverErrors:placements.notFound',
    'NOT_AUTHORIZED': 'serverErrors:placements.notAuthorized',
    'PLACEMENT_NOT_DRAFT': 'serverErrors:placements.notDraft',
    'CAMPAIGN_NAME_REQUIRED': 'serverErrors:placements.nameRequired',
    'PLACEMENT_CELLS_REQUIRED': 'serverErrors:placements.cellsRequired',
    'INVALID_FLIGHT_WINDOW': 'serverErrors:placements.flightWindow',

    // Developer API (manage-partner-api, its mint and webhook tests)
    'Subscribe to at least one event': 'serverErrors:api.subscribeOne',
    'Enter a valid URL': 'serverErrors:api.invalidUrl',
    'URL must use https://': 'serverErrors:api.httpsOnly',
    'URL must be publicly reachable': 'serverErrors:api.publicUrl',
    'Set a mint endpoint URL before enabling JIT minting': 'serverErrors:api.mintUrlFirst',
    'pool_low_threshold must be between 0 and 10,000': 'serverErrors:api.poolThreshold',
    'No mint endpoint URL is configured yet': 'serverErrors:api.mintNotConfigured',
    'Endpoint did not respond within the 3s mint budget': 'serverErrors:api.mintTimeout',
    'Response body is not valid JSON with a "code" field': 'serverErrors:api.mintBadJson',
    'The "code" value must be 4–64 letters/digits/hyphens': 'serverErrors:api.mintBadCode',
    'Response took over 2s — live mints are cut off at 3s, so add headroom': 'serverErrors:api.mintSlow',
    'timeout': 'serverErrors:api.timeout',

    // Shopify (shopify-connect)
    'Enter your store domain like your-store.myshopify.com': 'serverErrors:shopify.storeDomain',
    'Connect your Shopify store first': 'serverErrors:shopify.connectFirst',
    'Shopify query failed': 'serverErrors:shopify.queryFailed',
    'No such reward for this brand': 'serverErrors:shopify.noReward',
    'Only basic percentage or fixed-amount code discounts can be used as templates': 'serverErrors:shopify.templateKind',
    'This discount is limited to specific products, which needs the app’s product-access permission. Use an order-wide discount as the template for now.': 'serverErrors:shopify.productAccess',
    'Could not read the discount’s product restrictions — try an order-wide discount.': 'serverErrors:shopify.productRead',
    'This discount is limited to more than 100 items — too broad to clone faithfully. Use an order-wide or smaller template.': 'serverErrors:shopify.tooManyItems',
    'This discount’s item targeting can’t be cloned — use an order-wide discount as the template': 'serverErrors:shopify.targeting',
    'Map a reward to a discount first': 'serverErrors:shopify.mapFirst',
    'Shopify discount create failed — check the store connection above': 'serverErrors:shopify.createFailed',

    // Supabase Auth (sign-in, password change)
    'Invalid login credentials': 'serverErrors:auth.invalidCredentials',
    'Email not confirmed': 'serverErrors:auth.emailNotConfirmed',
    'New password should be different from the old password.': 'serverErrors:auth.samePassword',
    'Email rate limit exceeded': 'serverErrors:auth.emailRateLimit',

    // supabase.functions.invoke without lib/invokeFn's unwrapping
    'Edge Function returned a non-2xx status code': 'serverErrors:network.functionError',
    'Failed to send a request to the Edge Function': 'serverErrors:network.functionUnreachable',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Postgres's to_char(d, 'FMDD FMMonth YYYY'), e.g. "9 November 2026", in the reader's locale. */
export function localDate(text, locale) {
    const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(text);
    const month = m ? MONTHS.indexOf(m[2]) : -1;
    if (month < 0) return text;
    try {
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
            .format(new Date(Date.UTC(Number(m[3]), month, Number(m[1]))));
    } catch {
        return text;
    }
}

/**
 * Messages that carry a value: [pattern, key, (groups, locale) → interpolation values].
 * Each pattern matches the whole trimmed message.
 */
export const PATTERNS = [
    // gym_publish_event (count = the gym's events on the go)
    [/^You already have (\d+) events on the go — publish this once one has finished$/,
        'serverErrors:event.tooManyActive', ([count]) => ({ count: Number(count) })],
    // gym_book_clash_night (date is to_char 'FMDD FMMonth YYYY')
    [/^Clash Nights need (\d+) days' notice\. The first date you can pick is (\d{1,2} [A-Za-z]+ \d{4})\.$/,
        'serverErrors:clash.notice', ([days, date], locale) => ({ days, date: localDate(date, locale) })],
    // enforce_brand_reward_limit (trigger on reward_submissions)
    [/^Reward limit reached: (.+) already has (\d+) reward\(s\) live or in review \(limit (\d+)\)\.$/,
        'serverErrors:rewards.limitReached', ([brand, n, limit]) => ({ brand, n, limit })],
    // manage-partner-api
    [/^A brand can hold at most (\d+) active keys — revoke one first$/,
        'serverErrors:api.keyLimit', ([max]) => ({ max })],
    [/^A brand can hold at most (\d+) endpoints — delete one first$/,
        'serverErrors:api.endpointLimit', ([max]) => ({ max })],
    // _shared/mintTest.ts (detail is the transport's own words, e.g. "HTTP 500")
    [/^Endpoint returned no response \((.*)\)$/,
        'serverErrors:api.mintNoResponse', ([detail]) => ({ detail })],
    [/^Endpoint returned (\d+) \((.*)\)$/,
        'serverErrors:api.mintStatus', ([status, detail]) => ({ status, detail })],
    // shopify-connect (detail is the database's own words)
    [/^The code (\S+) was created in Shopify but POWR couldn't track it \((.*)\) — delete it in your store and try again$/,
        'serverErrors:shopify.codeUntracked', ([code, detail]) => ({ code, detail })],
    // Supabase Auth
    [/^For security purposes, you can only request this after (\d+) seconds?\.$/,
        'serverErrors:auth.retryAfter', ([count]) => ({ count: Number(count) })],
];
