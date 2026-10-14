/**
 * Server-originated text in the reader's language (lib/i18n/serverText.ts,
 * lib/eventShare.ts). The contract: English readers see exactly what the
 * screen printed before, known strings translate for everyone else, and
 * anything unknown falls back to a translated generic line (errors) or the
 * stored text (names people typed).
 */
import i18n from '@/lib/i18n';
import { buildEventShareSubtitle, buildEventShareTitle } from '@/lib/eventShare';
import {
  affiliateEarningText,
  authErrorMessage,
  liveEventJoinErrorText,
  profileSaveErrorText,
  readsEnglish,
  rescueLabelText,
  teamHeadingText,
  teamLineText,
  wearableConnectErrorText,
} from '@/lib/i18n/serverText';
import { APP_RESOURCES } from '@/shared/i18n/app';

const fr = APP_RESOURCES.fr as Record<string, any>;
const es = APP_RESOURCES.es as Record<string, any>;
const en = APP_RESOURCES.en as Record<string, any>;

afterEach(async () => {
  await i18n.changeLanguage('en');
});

// The raises of join_live_event (20261005120000_live_event_coming_soon.sql).
const JOIN_MESSAGES = [
  'Event not found',
  'This event does not require joining',
  "Registration for this event isn't open yet",
  'This event can no longer be joined',
  'Your account was created after the eligibility cutoff',
  'You cannot rejoin this event',
];

// creator_earnings notes as the migrations write them.
const EARNINGS: [string, string | null][] = [
  ['signup', 'Someone entered your code'],
  ['conversion', 'Signup converted — first verified workout'],
  ['event_signup', 'A signup joined FNL x POWR'],
  ['event_signup', 'A signup joined a live event'],
  ['milestone', 'Bronze — 5 conversions'],
  ['milestone', 'Silver — 1 signups'],
  ['manual', 'Thanks for the Instagram post'],
  ['signup', null],
  ['manual', null],
  ['something_new', null],
];

const AUTH_ERRORS = [
  { code: 'invalid_credentials', message: 'Invalid login credentials' },
  { code: 'email_not_confirmed', message: 'Email not confirmed' },
  { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
  { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' },
  { code: 'same_password', message: 'New password should be different from the old password.' },
  { code: 'weak_password', message: 'Password should be at least 6 characters.' },
  { code: 'user_already_exists', message: 'User already registered' },
  { code: 'email_address_invalid', message: 'Email address "x@y" is invalid' },
  { message: 'Auth session missing!', name: 'AuthSessionMissingError' },
  { message: 'Network request failed', name: 'AuthRetryableFetchError' },
  { code: 'something_new', message: 'A brand new GoTrue error' },
  { message: '' },
];

describe('English is a passthrough', () => {
  it('reads English by default', () => {
    expect(readsEnglish()).toBe(true);
  });

  it('keeps every Supabase Auth message byte for byte', () => {
    for (const error of AUTH_ERRORS) expect(authErrorMessage(error)).toBe(error.message);
    expect(authErrorMessage({ message: 'x' }, 'fallback')).toBe('x');
  });

  it('keeps join_live_event refusals, known or not', () => {
    for (const m of [...JOIN_MESSAGES, 'Some future refusal']) expect(liveEventJoinErrorText(m)).toBe(m);
  });

  it('keeps the affiliate note, or the raw kind when there is none', () => {
    for (const [kind, note] of EARNINGS) expect(affiliateEarningText(kind, note)).toBe(note ?? kind);
  });

  it('keeps profile, wearable, rescue and team text', () => {
    for (const e of ['Not authenticated', 'boom']) {
      expect(profileSaveErrorText(e)).toBe(e);
    }
    // The one English change: a taken username no longer shows the raw Postgres error.
    expect(profileSaveErrorText('duplicate key value violates unique constraint "profiles_username_key"'))
      .toBe('That username is taken. Try another one.');
    expect(wearableConnectErrorText('Terra widget session failed')).toBe('Terra widget session failed');
    expect(rescueLabelText('Back on track')).toBe('Back on track');
    expect(rescueLabelText('Comeback Kid')).toBe('Comeback Kid');
    expect(rescueLabelText(null)).toBeNull();
    expect(teamHeadingText('Personal Trainers')).toBe('Personal Trainers');
    expect(teamHeadingText('The Team')).toBe('The Team');
    expect(teamLineText('Personal trainer · 8 years', null)).toBe('Personal trainer · 8 years');
  });

  it('says the share preview exactly as before', () => {
    const event = {
      name: 'FNL x POWR',
      window_start_at: '2026-08-26T23:00:00.000Z',
      window_end_at: '2026-09-03T23:00:00.000Z',
      doors_open_at: null,
      doors_close_at: null,
      venue: { name: 'ONE LDN', logo_url: null, logo_bg: 'dark' as const },
    };
    expect(buildEventShareTitle(event)).toBe('FNL x POWR · Live event on POWR');
    expect(buildEventShareSubtitle(event)).toMatch(/^At ONE LDN\. Scoring .+\. Tap to get POWR and join me\.$/);
    expect(buildEventShareSubtitle({ ...event, venue: null })).toMatch(/^Scoring .+\. Tap to get POWR and join me\.$/);
  });

  it('keeps the catalog English identical to the server text it stands for', () => {
    const join = en.events.register.errors;
    expect([join.notFound, join.notRequired, join.notOpenYet, join.closed, join.cutoff, join.noRejoin]).toEqual(JOIN_MESSAGES);
    expect(en.auth.errors.invalidCredentials).toBe('Invalid login credentials');
    expect(en.auth.errors.emailNotConfirmed).toBe('Email not confirmed');
    expect(en.auth.errors.emailRateLimit).toBe('Email rate limit exceeded');
    expect(en.auth.errors.samePassword).toBe('New password should be different from the old password.');
    expect(en.auth.errors.userAlreadyExists).toBe('User already registered');
    expect(en.affiliate.earnings.kinds.signup).toBe('Someone entered your code');
    expect(en.affiliate.earnings.kinds.conversion).toBe('Signup converted — first verified workout');
    expect(en.home.rescue.labels.backOnTrack).toBe('Back on track');
    expect(en.discover.team).toEqual({ headingTrainers: 'Personal Trainers', headingTeam: 'The Team', personalTrainer: 'Personal trainer' });
    expect(en.system.otaUpdate).toEqual({
      title: 'Update ready',
      body: 'A new version of POWR is ready. Restart now to get the latest improvements?',
      later: 'Later',
      restart: 'Restart',
    });
    expect(i18n.t('health:authExpired.title', { name: 'Samsung Health' })).toBe('Samsung Health disconnected');
    expect(i18n.t('health:authExpired.body', { name: 'Samsung Health' })).toBe(
      'Your Samsung Health connection has expired. Go to Settings to reconnect.',
    );
  });
});

describe.each(['fr', 'es'])('%s', lang => {
  const cat = lang === 'fr' ? fr : es;
  beforeEach(async () => {
    await i18n.changeLanguage(lang);
  });

  it('translates known Supabase Auth errors and generalises the rest', () => {
    expect(readsEnglish()).toBe(false);
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(cat.auth.errors.invalidCredentials);
    // By message alone (older GoTrue, no code).
    expect(authErrorMessage({ message: 'Email not confirmed' })).toBe(cat.auth.errors.emailNotConfirmed);
    expect(authErrorMessage({ code: 'same_password', message: 'whatever' })).toBe(cat.auth.errors.samePassword);
    expect(authErrorMessage({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(cat.auth.errors.sessionMissing);
    expect(authErrorMessage({ message: 'Network request failed' })).toBe(cat.auth.errors.network);
    const wait = authErrorMessage({ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' });
    expect(wait).toContain('42');
    expect(wait).toBe(cat.auth.errors.waitSeconds_other.replace('{{count}}', '42'));
    expect(authErrorMessage({ code: 'something_new', message: 'A brand new GoTrue error' })).toBe(cat.auth.errors.generic);
    expect(authErrorMessage({ message: 'A brand new GoTrue error' }, 'custom')).toBe('custom');
  });

  it('translates every join_live_event refusal, and generalises an unknown one', () => {
    const keys = cat.events.register.errors;
    expect(JOIN_MESSAGES.map(liveEventJoinErrorText)).toEqual([
      keys.notFound, keys.notRequired, keys.notOpenYet, keys.closed, keys.cutoff, keys.noRejoin,
    ]);
    expect(liveEventJoinErrorText('Some future refusal')).toBe(cat.events.register.errorBody);
  });

  it('labels affiliate earnings by kind, and keeps typed notes and unknown kinds', () => {
    const k = cat.affiliate.earnings.kinds;
    expect(affiliateEarningText('signup', 'Someone entered your code')).toBe(k.signup);
    expect(affiliateEarningText('signup', null)).toBe(k.signup);
    expect(affiliateEarningText('conversion', 'Signup converted — first verified workout')).toBe(k.conversion);
    expect(affiliateEarningText('event_signup', 'A signup joined FNL x POWR')).toBe(k.eventSignup.replace('{{event}}', 'FNL x POWR'));
    expect(affiliateEarningText('event_signup', 'A signup joined a live event')).toBe(k.eventSignupNoName);
    expect(affiliateEarningText('milestone', 'Bronze — 5 conversions')).toBe(
      k.milestoneConversions_other.replace('{{label}}', 'Bronze').replace('{{count}}', '5'),
    );
    expect(affiliateEarningText('milestone', 'Silver — 1 signups')).toBe(
      k.milestoneSignups_one.replace('{{label}}', 'Silver').replace('{{count}}', '1'),
    );
    expect(affiliateEarningText('manual', null)).toBe(k.manual);
    expect(affiliateEarningText('manual', 'Thanks for the Instagram post')).toBe('Thanks for the Instagram post');
    expect(affiliateEarningText('signup', 'A note an admin rewrote')).toBe('A note an admin rewrote');
    expect(affiliateEarningText('something_new', null)).toBe('something_new');
  });

  it('turns raw profile save errors into readable ones', () => {
    const e = cat.account.editProfile.errors;
    expect(profileSaveErrorText('duplicate key value violates unique constraint "profiles_username_key"')).toBe(e.usernameTaken);
    expect(profileSaveErrorText('Not authenticated')).toBe(e.notSignedIn);
    expect(profileSaveErrorText('new row violates row-level security policy')).toBe(e.generic);
  });

  it('puts our line in front of a short provider message, and drops a long one', () => {
    expect(wearableConnectErrorText('Terra widget session failed')).toBe(
      cat.settings.providers.couldNotStartDetail.replace('{{detail}}', 'Terra widget session failed'),
    );
    expect(wearableConnectErrorText('x'.repeat(500))).toBe(cat.settings.providers.couldNotStart);
    expect(wearableConnectErrorText('  ')).toBe(cat.settings.providers.couldNotStart);
  });

  it('translates the seed rescue name only', () => {
    expect(rescueLabelText('Back on track')).toBe(cat.home.rescue.labels.backOnTrack);
    expect(rescueLabelText(' back on Track ')).toBe(cat.home.rescue.labels.backOnTrack);
    expect(rescueLabelText('Comeback Kid')).toBe('Comeback Kid');
    expect(rescueLabelText(null)).toBeNull();
  });

  it('translates the team heading and the default role, nothing the gym typed', () => {
    expect(teamHeadingText('Personal Trainers')).toBe(cat.discover.team.headingTrainers);
    expect(teamHeadingText('The Team')).toBe(cat.discover.team.headingTeam);
    expect(teamHeadingText('Something else')).toBe('Something else');
    const pt = cat.discover.team.personalTrainer;
    expect(teamLineText('Personal trainer · 8 years', null)).toBe(`${pt} · 8 years`);
    expect(teamLineText('Personal trainer', '')).toBe(pt);
    expect(teamLineText('Personal Trainer · 3 yrs', 'Personal Trainer')).toBe(`${pt} · 3 yrs`);
    expect(teamLineText('Physio · 8 years', 'Physio')).toBe('Physio · 8 years');
    expect(teamLineText('8 years', null)).toBe('8 years');
  });

  it("writes the share preview in the sharer's language", () => {
    const event = {
      name: 'FNL x POWR',
      window_start_at: '2026-08-26T23:00:00.000Z',
      window_end_at: '2026-09-03T23:00:00.000Z',
      doors_open_at: null,
      doors_close_at: null,
      venue: { name: 'ONE LDN', logo_url: null, logo_bg: 'dark' as const },
    };
    expect(buildEventShareTitle(event)).toBe(cat.events.shareLink.title.replace('{{event}}', 'FNL x POWR'));
    const subtitle = buildEventShareSubtitle(event);
    expect(subtitle).toContain('ONE LDN');
    expect(subtitle).not.toMatch(/Scoring|Tap to get/);
  });
});
