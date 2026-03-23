/**
 * POWR Activity Type Definitions
 * Mirrors the logic documented in context/POWR_Points_Logic.md
 */

export type ActivityType =
  | 'walking'
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'gym'
  | 'hiit'
  | 'sports'
  | 'yoga';

export interface ActivityConfig {
  type: ActivityType;
  label: string;
  /** Short label for tight UI */
  labelShort: string;
  /** Ionicon name (outline variant for inactive, filled for active) */
  icon: string;
  iconActive: string;
  /** Marketing tag from points logic doc */
  tag: string;
  dailyCap: number;
  /** Colour used for category tinting */
  colour: string;
  /** Minimum session duration in minutes */
  minDuration: number;
  /** Primary verification method */
  verification: 'gps' | 'geofence' | 'wearable' | 'manual';
}

export const ACTIVITIES: Record<ActivityType, ActivityConfig> = {
  walking: {
    type: 'walking',
    label: 'Walking',
    labelShort: 'Walk',
    icon: 'footsteps-outline',
    iconActive: 'footsteps',
    tag: 'Mass Market',
    dailyCap: 5,
    colour: '#4AF2A1',
    minDuration: 0,
    verification: 'wearable',
  },
  running: {
    type: 'running',
    label: 'Running',
    labelShort: 'Run',
    icon: 'body-outline',
    iconActive: 'body',
    tag: 'Effort-Based',
    dailyCap: 10,
    colour: '#FF9944',
    minDuration: 15,
    verification: 'gps',
  },
  cycling: {
    type: 'cycling',
    label: 'Cycling',
    labelShort: 'Cycle',
    icon: 'bicycle-outline',
    iconActive: 'bicycle',
    tag: 'Effort-Based',
    dailyCap: 10,
    colour: '#0EA5E9',
    minDuration: 20,
    verification: 'gps',
  },
  swimming: {
    type: 'swimming',
    label: 'Swimming',
    labelShort: 'Swim',
    icon: 'water-outline',
    iconActive: 'water',
    tag: 'Verified Sport',
    dailyCap: 10,
    colour: '#38BDF8',
    minDuration: 15,
    verification: 'wearable',
  },
  gym: {
    type: 'gym',
    label: 'Gym',
    labelShort: 'Gym',
    icon: 'barbell-outline',
    iconActive: 'barbell',
    tag: 'Premium Lane',
    dailyCap: 30,
    colour: '#E8D200',
    minDuration: 20,
    verification: 'geofence',
  },
  hiit: {
    type: 'hiit',
    label: 'HIIT / Classes',
    labelShort: 'HIIT',
    icon: 'flame-outline',
    iconActive: 'flame',
    tag: 'High Intensity',
    dailyCap: 10,
    colour: '#EF4444',
    minDuration: 20,
    verification: 'geofence',
  },
  sports: {
    type: 'sports',
    label: 'Sports',
    labelShort: 'Sport',
    icon: 'football-outline',
    iconActive: 'football',
    tag: 'Social / Casual',
    dailyCap: 10,
    colour: '#7C3AED',
    minDuration: 30,
    verification: 'gps',
  },
  yoga: {
    type: 'yoga',
    label: 'Yoga / Pilates',
    labelShort: 'Yoga',
    icon: 'leaf-outline',
    iconActive: 'leaf',
    tag: 'Low Intensity',
    dailyCap: 6,
    colour: '#88CC28',
    minDuration: 20,
    verification: 'manual',
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
];
