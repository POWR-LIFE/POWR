/**
 * POWR Activity Type Definitions
 * Mirrors the logic documented in context/POWR_Points_Logic.md
 *
 * The member-facing text (label, labelShort, tag) is a getter over the
 * `activities` catalog, so `ACTIVITIES.gym.label` reads in the language on
 * screen at the moment it's read. Copy it into module-level state and it
 * freezes in whatever language was showing then.
 */

import i18n from '@/lib/i18n';

export type ActivityType =
  | 'walking'
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'gym'
  | 'hiit'
  | 'sports'
  | 'yoga'
  | 'dance'
  | 'sleep';

export interface ActivityConfig {
  type: ActivityType;
  readonly label: string;
  /**
   * The English label whatever the screen shows. Provider-reported workout
   * names arrive in English, so this is the one to compare them against.
   */
  readonly labelEn: string;
  /** Short label for tight UI */
  readonly labelShort: string;
  /** Icon name (outline variant for inactive, filled for active) */
  icon: string;
  iconActive: string;
  /** Icon library – defaults to 'ionicons' */
  iconLib?: 'ionicons' | 'material-community';
  /** Marketing tag from points logic doc */
  readonly tag: string;
  dailyCap: number;
  /** Colour used for category tinting */
  colour: string;
  /** Minimum session duration in minutes */
  minDuration: number;
  /** Primary verification method */
  verification: 'gps' | 'geofence' | 'wearable' | 'manual';
  /** If true, not shown in the activity focus picker — tracked automatically via wearable only */
  hideFromPicker?: boolean;
}

export const ACTIVITIES: Record<ActivityType, ActivityConfig> = {
  walking: {
    type: 'walking',
    get label() { return i18n.t('activities:names.walking'); },
    get labelEn() { return i18n.t('activities:names.walking', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.walking'); },
    icon: 'footsteps-outline',
    iconActive: 'footsteps',
    get tag() { return i18n.t('activities:tags.massMarket'); },
    dailyCap: 5,
    colour: '#4AF2A1',
    minDuration: 0,
    verification: 'gps',
  },
  running: {
    type: 'running',
    get label() { return i18n.t('activities:names.running'); },
    get labelEn() { return i18n.t('activities:names.running', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.running'); },
    icon: 'run',
    iconActive: 'run-fast',
    iconLib: 'material-community',
    get tag() { return i18n.t('activities:tags.effortBased'); },
    dailyCap: 10,
    colour: '#FF9944',
    minDuration: 15,
    verification: 'wearable',
  },
  cycling: {
    type: 'cycling',
    get label() { return i18n.t('activities:names.cycling'); },
    get labelEn() { return i18n.t('activities:names.cycling', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.cycling'); },
    icon: 'bicycle-outline',
    iconActive: 'bicycle',
    get tag() { return i18n.t('activities:tags.effortBased'); },
    dailyCap: 10,
    colour: '#0EA5E9',
    minDuration: 20,
    verification: 'wearable',
  },
  swimming: {
    type: 'swimming',
    get label() { return i18n.t('activities:names.swimming'); },
    get labelEn() { return i18n.t('activities:names.swimming', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.swimming'); },
    icon: 'water-outline',
    iconActive: 'water',
    get tag() { return i18n.t('activities:tags.verifiedSport'); },
    dailyCap: 10,
    colour: '#38BDF8',
    minDuration: 15,
    verification: 'wearable',
  },
  gym: {
    type: 'gym',
    get label() { return i18n.t('activities:names.gym'); },
    get labelEn() { return i18n.t('activities:names.gym', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.gym'); },
    icon: 'barbell-outline',
    iconActive: 'barbell',
    get tag() { return i18n.t('activities:tags.premiumLane'); },
    dailyCap: 30,
    colour: '#E8D200',
    minDuration: 30,
    verification: 'geofence',
  },
  hiit: {
    type: 'hiit',
    get label() { return i18n.t('activities:names.hiit'); },
    get labelEn() { return i18n.t('activities:names.hiit', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.hiit'); },
    icon: 'flame-outline',
    iconActive: 'flame',
    get tag() { return i18n.t('activities:tags.highIntensity'); },
    // Strength lane — HIIT/classes score exactly like a gym session (same 15/20
    // tiers, same streak multipliers, same cap). Keep in step with claim-points
    // DAILY_CAPS and enforce_point_award_cap.
    dailyCap: 30,
    colour: '#EF4444',
    minDuration: 20,
    verification: 'geofence',
  },
  sports: {
    type: 'sports',
    get label() { return i18n.t('activities:names.sports'); },
    get labelEn() { return i18n.t('activities:names.sports', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.sports'); },
    icon: 'football-outline',
    iconActive: 'football',
    get tag() { return i18n.t('activities:tags.socialCasual'); },
    dailyCap: 10,
    colour: '#7C3AED',
    minDuration: 30,
    verification: 'wearable',
  },
  yoga: {
    type: 'yoga',
    get label() { return i18n.t('activities:names.yoga'); },
    get labelEn() { return i18n.t('activities:names.yoga', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.yoga'); },
    icon: 'leaf-outline',
    iconActive: 'leaf',
    get tag() { return i18n.t('activities:tags.lowIntensity'); },
    dailyCap: 6,
    colour: '#88CC28',
    minDuration: 20,
    verification: 'manual',
  },
  dance: {
    type: 'dance',
    get label() { return i18n.t('activities:names.dance'); },
    get labelEn() { return i18n.t('activities:names.dance', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.dance'); },
    icon: 'musical-notes-outline',
    iconActive: 'musical-notes',
    get tag() { return i18n.t('activities:tags.cardio'); },
    dailyCap: 8,
    colour: '#EC4899',
    minDuration: 20,
    verification: 'wearable',
  },
  sleep: {
    type: 'sleep',
    get label() { return i18n.t('activities:names.sleep'); },
    get labelEn() { return i18n.t('activities:names.sleep', { lng: 'en' }); },
    get labelShort() { return i18n.t('activities:short.sleep'); },
    icon: 'moon-outline',
    iconActive: 'moon',
    get tag() { return i18n.t('activities:tags.recovery'); },
    dailyCap: 5,
    colour: '#6366F1',
    minDuration: 0,
    verification: 'wearable',
    hideFromPicker: true,
  },
};

export const ACTIVITY_LIST = Object.values(ACTIVITIES);

/** All 8 types in display order */
export const ACTIVITY_ORDER: ActivityType[] = [
  'gym',
  'running',
  'hiit',
  'cycling',
  'walking',
  'swimming',
  'sports',
  'yoga',
  'dance',
  'sleep',
];
