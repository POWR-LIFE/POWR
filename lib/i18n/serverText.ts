import i18n from '@/lib/i18n';

/**
 * Text that reaches the screen from somewhere other than our catalogs: an
 * error Supabase Auth or Postgres wrote, a row a trigger filled in, a default a
 * shared helper returns. It is English, so these turn the strings we know into
 * the reader's language.
 *
 * The rule for every function here: **English readers see the source text
 * byte for byte**, exactly what the screen printed before. Only French and
 * Spanish readers get the mapped wording, and anything we don't recognise
 * falls back to a translated generic line (errors) or the text as stored
 * (names and notes people typed).
 *
 * Keys sit in literal maps so __tests__/appI18n.test.ts can see every one.
 */

/** Whether the reader is on English, where every function below is a passthrough. */
export function readsEnglish(): boolean {
  const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return lang.split('-')[0] === 'en';
}

// ─── Supabase Auth errors ─────────────────────────────────────────────────────

export type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
  name?: string | null;
};

/** By AuthError.code (supabase-js lib/error-codes.ts). */
const AUTH_CODE_KEYS: Record<string, string> = {
  invalid_credentials: 'auth:errors.invalidCredentials',
  email_not_confirmed: 'auth:errors.emailNotConfirmed',
  over_email_send_rate_limit: 'auth:errors.emailRateLimit',
  over_request_rate_limit: 'auth:errors.requestRateLimit',
  weak_password: 'auth:errors.weakPassword',
  same_password: 'auth:errors.samePassword',
  user_already_exists: 'auth:errors.userAlreadyExists',
  email_exists: 'auth:errors.emailExists',
  email_address_invalid: 'auth:errors.emailInvalid',
  otp_expired: 'auth:errors.linkExpired',
  flow_state_expired: 'auth:errors.linkExpired',
  flow_state_not_found: 'auth:errors.linkOtherDevice',
  bad_code_verifier: 'auth:errors.linkOtherDevice',
  session_not_found: 'auth:errors.sessionMissing',
  session_expired: 'auth:errors.sessionMissing',
  refresh_token_not_found: 'auth:errors.sessionMissing',
  refresh_token_already_used: 'auth:errors.sessionMissing',
  reauthentication_needed: 'auth:errors.reauthNeeded',
  reauthentication_not_valid: 'auth:errors.reauthNeeded',
  signup_disabled: 'auth:errors.signupDisabled',
  user_banned: 'auth:errors.userBanned',
};

/** Client-side errors supabase-js raises without a code, by AuthError.name. */
const AUTH_NAME_KEYS: Record<string, string> = {
  AuthSessionMissingError: 'auth:errors.sessionMissing',
  AuthRetryableFetchError: 'auth:errors.network',
  AuthPKCEGrantCodeExchangeError: 'auth:errors.linkOtherDevice',
};

/**
 * By message, for older GoTrue responses with no code and for the messages a
 * code alone doesn't separate (rate limits, validation_failed). Checked first.
 */
const AUTH_MESSAGE_KEYS: readonly [RegExp, string][] = [
  [/^invalid login credentials\.?$/i, 'auth:errors.invalidCredentials'],
  [/^email not confirmed\.?$/i, 'auth:errors.emailNotConfirmed'],
  [/email rate limit exceeded/i, 'auth:errors.emailRateLimit'],
  [/request rate limit/i, 'auth:errors.requestRateLimit'],
  [/^user already registered\.?$/i, 'auth:errors.userAlreadyExists'],
  [/already been registered|already registered by another user/i, 'auth:errors.emailExists'],
  [/should be different from the old password/i, 'auth:errors.samePassword'],
  [/email link is invalid or has expired|token has expired or is invalid/i, 'auth:errors.linkExpired'],
  [/code verifier|flow state/i, 'auth:errors.linkOtherDevice'],
  [/auth session missing/i, 'auth:errors.sessionMissing'],
  [/requires reauthentication/i, 'auth:errors.reauthNeeded'],
  [/network request failed|failed to fetch|load failed|network ?error/i, 'auth:errors.network'],
  [/unable to validate email address|email address .* is invalid/i, 'auth:errors.emailInvalid'],
  [/password (should|is known to be weak)/i, 'auth:errors.weakPassword'],
];

/** "For security purposes, you can only request this after 42 seconds." */
const WAIT_SECONDS = /only request this after (\d+) seconds?/i;

/**
 * A Supabase Auth error as the reader should see it. English: the message as
 * Supabase wrote it, as before. French/Spanish: our wording when the code,
 * name or message is one we know, else `fallback` (default: a generic "try
 * again" line), so nobody reads a lone English sentence.
 */
export function authErrorMessage(error: AuthErrorLike, fallback?: string): string {
  const message = error.message ?? '';
  if (readsEnglish()) return message;
  const wait = WAIT_SECONDS.exec(message);
  if (wait) return i18n.t('auth:errors.waitSeconds', { count: Number(wait[1]) });
  const key =
    AUTH_MESSAGE_KEYS.find(([pattern]) => pattern.test(message))?.[1] ??
    (error.code ? AUTH_CODE_KEYS[error.code] : undefined) ??
    (error.name ? AUTH_NAME_KEYS[error.name] : undefined);
  return key ? i18n.t(key) : (fallback ?? i18n.t('auth:errors.generic'));
}

// ─── join_live_event refusals ────────────────────────────────────────────────

/**
 * The P0001/P0002 raises of join_live_event, verbatim
 * (supabase/migrations/20261005120000_live_event_coming_soon.sql).
 */
const JOIN_ERROR_KEYS: Record<string, string> = {
  'Event not found': 'events:register.errors.notFound',
  'This event does not require joining': 'events:register.errors.notRequired',
  "Registration for this event isn't open yet": 'events:register.errors.notOpenYet',
  'This event can no longer be joined': 'events:register.errors.closed',
  'Your account was created after the eligibility cutoff': 'events:register.errors.cutoff',
  'You cannot rejoin this event': 'events:register.errors.noRejoin',
};

/** A deliberate join_live_event refusal (P0001/P0002) as the reader should see it. */
export function liveEventJoinErrorText(message: string): string {
  if (readsEnglish()) return message;
  const key = JOIN_ERROR_KEYS[message.trim()];
  return key ? i18n.t(key) : i18n.t('events:register.errorBody');
}

// ─── Affiliate earnings (creator_earnings.note) ──────────────────────────────

// The notes the database writes (creator_program_foundations, creator_programmes,
// live_event_referral_attribution …). Milestone notes carry the step's label,
// which the admin typed and which stays as typed.
const SIGNUP_NOTE = 'Someone entered your code';
const CONVERSION_NOTE = 'Signup converted — first verified workout';
const EVENT_SIGNUP_NOTE = /^A signup joined ([\s\S]+)$/;
const EVENT_FALLBACK_NAME = 'a live event';
const MILESTONE_NOTE = /^([\s\S]+) — (\d+) (conversions|signups)$/;

/**
 * One row of the affiliate earnings feed. English: the stored note (or the raw
 * kind when there is none), as before. Otherwise the note rebuilt from its kind
 * when it is one the database writes; a note someone typed (a manual credit)
 * stays as typed.
 */
export function affiliateEarningText(kind: string, note: string | null | undefined): string {
  const stored = note ?? kind;
  if (readsEnglish()) return stored;
  switch (kind) {
    case 'signup':
      if (note == null || note === SIGNUP_NOTE) return i18n.t('affiliate:earnings.kinds.signup');
      break;
    case 'conversion':
      if (note == null || note === CONVERSION_NOTE) return i18n.t('affiliate:earnings.kinds.conversion');
      break;
    case 'event_signup': {
      const event = note == null ? EVENT_FALLBACK_NAME : EVENT_SIGNUP_NOTE.exec(note)?.[1];
      if (event === EVENT_FALLBACK_NAME) return i18n.t('affiliate:earnings.kinds.eventSignupNoName');
      if (event) return i18n.t('affiliate:earnings.kinds.eventSignup', { event });
      break;
    }
    case 'milestone': {
      if (note == null) return i18n.t('affiliate:earnings.kinds.milestone');
      const m = MILESTONE_NOTE.exec(note);
      if (m) {
        const vars = { label: m[1], count: Number(m[2]) };
        return m[3] === 'signups'
          ? i18n.t('affiliate:earnings.kinds.milestoneSignups', vars)
          : i18n.t('affiliate:earnings.kinds.milestoneConversions', vars);
      }
      break;
    }
    case 'manual':
      if (note == null) return i18n.t('affiliate:earnings.kinds.manual');
      break;
  }
  return stored;
}

// ─── Profile save errors (lib/api/user.ts) ───────────────────────────────────

/**
 * A failed profile save, upload or update as the reader should see it. A taken
 * username gets its own line in every language (English used to show the raw
 * Postgres error). Otherwise English keeps the raw message, as before; other
 * languages get a lost-session line or a generic one.
 */
export function profileSaveErrorText(error: string): string {
  // Postgres 23505 on profiles_username_key: 'duplicate key value violates
  // unique constraint "profiles_username_key"'.
  if (/duplicate key|unique constraint/i.test(error) && /username/i.test(error)) {
    return i18n.t('account:editProfile.errors.usernameTaken');
  }
  if (readsEnglish()) return error;
  if (error === 'Not authenticated') return i18n.t('account:editProfile.errors.notSignedIn');
  return i18n.t('account:editProfile.errors.generic');
}

// ─── Wearable connect failures ───────────────────────────────────────────────

/** Longest provider message worth quoting after the translated line. */
const MAX_DETAIL = 120;

/**
 * A provider's own exception text when connecting fails. English: the raw
 * text, as before. Otherwise our line, with the provider's (English) text in
 * brackets when it's short enough to help support.
 */
export function wearableConnectErrorText(raw: string): string {
  if (readsEnglish()) return raw;
  const detail = raw.trim();
  return detail && detail.length <= MAX_DETAIL
    ? i18n.t('settings:providers.couldNotStartDetail', { detail })
    : i18n.t('settings:providers.couldNotStart');
}

// ─── Streak rescue challenge names ───────────────────────────────────────────

/**
 * streak_rescue_challenges.label, copied onto each rescue. The seed
 * (20260723120000_streak_rescue_challenges.sql) is "Back on track"; admins can
 * add more in /admin, which have no translation and show as typed.
 */
const RESCUE_LABEL_KEYS: Record<string, string> = {
  'back on track': 'home:rescue.labels.backOnTrack',
};

export function rescueLabelText(label: string | null): string | null {
  if (!label || readsEnglish()) return label;
  const key = RESCUE_LABEL_KEYS[label.trim().toLowerCase()];
  return key ? i18n.t(key) : label;
}

// ─── Gym team (shared/gymTeam.ts) ────────────────────────────────────────────

/**
 * teamHeading() returns English shared with the gym portal's phone preview.
 * Its two fixed values map to keys; anything else passes through.
 */
const TEAM_HEADING_KEYS: Record<string, string> = {
  'Personal Trainers': 'discover:team.headingTrainers',
  'The Team': 'discover:team.headingTeam',
};

export function teamHeadingText(heading: string): string {
  if (readsEnglish()) return heading;
  const key = TEAM_HEADING_KEYS[heading];
  return key ? i18n.t(key) : heading;
}

/** teamLine()'s role for a row with none (every trainer row before roles existed). */
const DEFAULT_ROLE = 'Personal trainer';

/**
 * teamLine() output ("Personal trainer · 8 years"). The role is translated
 * only when it is the default (or typed as exactly that); a role the gym typed
 * and the experience stay as written.
 */
export function teamLineText(line: string, role: string | null | undefined): string {
  if (readsEnglish()) return line;
  const shown = (role ?? '').trim() || DEFAULT_ROLE;
  if (shown.toLowerCase() !== DEFAULT_ROLE.toLowerCase()) return line;
  if (line !== shown && !line.startsWith(`${shown} · `)) return line;
  return i18n.t('discover:team.personalTrainer') + line.slice(shown.length);
}
