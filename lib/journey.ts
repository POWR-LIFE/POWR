/**
 * POWR Journey — Duolingo-style section → unit → lesson hierarchy
 *
 * 5 Sections, ~40 units, ~120+ lessons.
 * State is derived at runtime from the user's completed lesson IDs.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type LessonState = 'completed' | 'current' | 'locked';

export interface JourneyLesson {
  id: string;
  title: string;
  subtitle: string;
  xpReward: number;
  icon: string;
  state: LessonState;
}

export interface JourneyUnit {
  id: string;
  title: string;
  lessons: JourneyLesson[];
  bonusXp: number;
}

export interface JourneySection {
  id: string;
  title: string;
  subtitle: string;
  colour: string;
  units: JourneyUnit[];
}

// ─── Raw definitions (without state) ─────────────────────────────────────────

type LessonDef  = Omit<JourneyLesson, 'state'>;
type UnitDef    = Omit<JourneyUnit, 'lessons'> & { lessons: LessonDef[] };
type SectionDef = Omit<JourneySection, 'units'> & { units: UnitDef[] };

export const JOURNEY_SECTIONS: SectionDef[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — Getting Started                                    #4ade80
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 's1', title: 'Getting Started', subtitle: 'Build the foundations of your fitness journey', colour: '#4ade80',
    units: [
      {
        id: 'u01', title: 'First Steps', bonusXp: 25,
        lessons: [
          { id: 'l-001', title: 'Get Moving',     subtitle: 'Log your first activity of any kind',    xpReward: 20, icon: 'footsteps-outline' },
          { id: 'l-002', title: 'Step Counter',   subtitle: 'Walk 5,000 steps in a day',              xpReward: 25, icon: 'walk-outline' },
          { id: 'l-003', title: 'Explore',         subtitle: 'Try a new type of workout',              xpReward: 30, icon: 'compass-outline' },
        ],
      },
      {
        id: 'u02', title: 'Build the Habit', bonusXp: 30,
        lessons: [
          { id: 'l-004', title: 'First Week',     subtitle: 'Move every day for 7 days',              xpReward: 50, icon: 'calendar-outline' },
          { id: 'l-005', title: 'Morning Mover',  subtitle: 'Work out before 9 am twice',             xpReward: 35, icon: 'sunny-outline' },
          { id: 'l-006', title: 'Log It',          subtitle: 'Manually log 5 workouts',                xpReward: 30, icon: 'create-outline' },
        ],
      },
      {
        id: 'u03', title: 'First Milestones', bonusXp: 35,
        lessons: [
          { id: 'l-007', title: 'First Run',      subtitle: 'Log your first run of any distance',     xpReward: 40, icon: 'walk-outline' },
          { id: 'l-008', title: 'First Gym Day',   subtitle: 'Check in at a gym',                      xpReward: 35, icon: 'barbell-outline' },
          { id: 'l-009', title: 'Hydration Hero',  subtitle: 'Log water intake 3 days in a row',       xpReward: 25, icon: 'water-outline' },
          { id: 'l-010', title: '10K Steps',       subtitle: 'Walk 10,000 steps in a single day',      xpReward: 40, icon: 'trending-up-outline' },
        ],
      },
      {
        id: 'u04', title: 'Streak Starter', bonusXp: 40,
        lessons: [
          { id: 'l-011', title: '3-Day Streak',   subtitle: 'Be active 3 days in a row',              xpReward: 35, icon: 'flame-outline' },
          { id: 'l-012', title: 'Weekend Warrior', subtitle: 'Work out on both Saturday and Sunday',   xpReward: 40, icon: 'calendar-outline' },
          { id: 'l-013', title: 'Consistency',     subtitle: 'Log activity 10 days out of 14',         xpReward: 50, icon: 'checkmark-done-outline' },
        ],
      },
      {
        id: 'u05', title: 'Social Start', bonusXp: 30,
        lessons: [
          { id: 'l-014', title: 'Add a Friend',   subtitle: 'Connect with another POWR user',         xpReward: 20, icon: 'person-add-outline' },
          { id: 'l-015', title: 'Share a Win',     subtitle: 'Share an achievement',                   xpReward: 25, icon: 'share-social-outline' },
          { id: 'l-016', title: 'Join the League', subtitle: 'Enter your first weekly league',          xpReward: 30, icon: 'trophy-outline' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — Building Strength                                  #E8D200
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 's2', title: 'Building Strength', subtitle: 'Level up your fitness with real goals', colour: '#E8D200',
    units: [
      {
        id: 'u06', title: 'Cardio Foundations', bonusXp: 35,
        lessons: [
          { id: 'l-017', title: '2K Run',         subtitle: 'Run 2 km without stopping',              xpReward: 40, icon: 'speedometer-outline' },
          { id: 'l-018', title: 'Cycle Session',   subtitle: 'Log a 30-minute cycle',                  xpReward: 35, icon: 'bicycle-outline' },
          { id: 'l-019', title: 'Cardio Trio',     subtitle: 'Do 3 different cardio activities',       xpReward: 45, icon: 'heart-outline' },
        ],
      },
      {
        id: 'u07', title: 'Gym Regular', bonusXp: 40,
        lessons: [
          { id: 'l-020', title: 'Gym Rat',         subtitle: 'Log 10 gym sessions',                    xpReward: 60, icon: 'barbell-outline' },
          { id: 'l-021', title: 'Upper Body',      subtitle: 'Complete 5 upper body workouts',         xpReward: 45, icon: 'body-outline' },
          { id: 'l-022', title: 'Leg Day',          subtitle: 'Complete 5 lower body workouts',         xpReward: 45, icon: 'fitness-outline' },
          { id: 'l-023', title: 'Full Body',        subtitle: 'Do a full-body workout 3 times',        xpReward: 50, icon: 'body-outline' },
        ],
      },
      {
        id: 'u08', title: 'Push Further', bonusXp: 45,
        lessons: [
          { id: 'l-024', title: 'Month Strong',   subtitle: 'Be active 30 days in a row',             xpReward: 80, icon: 'flame-outline' },
          { id: 'l-025', title: 'Early Bird',      subtitle: 'Work out before 7 am five times',        xpReward: 55, icon: 'sunny-outline' },
          { id: 'l-026', title: '5K Club',         subtitle: 'Run 5 km in a single session',           xpReward: 60, icon: 'speedometer-outline' },
        ],
      },
      {
        id: 'u09', title: 'City Explorer', bonusXp: 35,
        lessons: [
          { id: 'l-027', title: 'City Mover',     subtitle: 'Log activities in 3 different venues',   xpReward: 55, icon: 'location-outline' },
          { id: 'l-028', title: 'Pace Setter',     subtitle: 'Beat your best 5K time',                xpReward: 65, icon: 'timer-outline' },
          { id: 'l-029', title: 'Explorer',         subtitle: 'Visit 5 different workout locations',   xpReward: 50, icon: 'map-outline' },
        ],
      },
      {
        id: 'u10', title: 'Recovery Basics', bonusXp: 30,
        lessons: [
          { id: 'l-030', title: 'First Stretch',  subtitle: 'Log a stretching session',               xpReward: 25, icon: 'leaf-outline' },
          { id: 'l-031', title: 'Rest Day',        subtitle: 'Take a planned rest day',                xpReward: 30, icon: 'bed-outline' },
          { id: 'l-032', title: 'Sleep Right',     subtitle: 'Log 7+ hours of sleep for 5 nights',    xpReward: 40, icon: 'moon-outline' },
        ],
      },
      {
        id: 'u11', title: 'Strength Test', bonusXp: 50,
        lessons: [
          { id: 'l-033', title: 'Iron Week',       subtitle: '5 gym sessions in one week',             xpReward: 80, icon: 'fitness-outline' },
          { id: 'l-034', title: 'Personal Best',   subtitle: 'Set a new personal record',              xpReward: 60, icon: 'ribbon-outline' },
          { id: 'l-035', title: 'Double Digits',   subtitle: 'Complete 10 workouts in 2 weeks',        xpReward: 70, icon: 'stats-chart-outline' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — Mind & Body                                        #a78bfa
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 's3', title: 'Mind & Body', subtitle: 'Balance fitness with recovery and mindfulness', colour: '#a78bfa',
    units: [
      {
        id: 'u12', title: 'Yoga Introduction', bonusXp: 30,
        lessons: [
          { id: 'l-036', title: 'First Breath',   subtitle: 'Complete a yoga or pilates session',     xpReward: 40, icon: 'leaf-outline' },
          { id: 'l-037', title: 'Flow State',      subtitle: 'Do 3 yoga sessions',                     xpReward: 45, icon: 'water-outline' },
          { id: 'l-038', title: 'Flexible',         subtitle: 'Stretch for 10 minutes 5 times',        xpReward: 35, icon: 'body-outline' },
        ],
      },
      {
        id: 'u13', title: 'Mindfulness', bonusXp: 35,
        lessons: [
          { id: 'l-039', title: 'Calm Mind',       subtitle: 'Complete a meditation session',          xpReward: 30, icon: 'flower-outline' },
          { id: 'l-040', title: 'Mindful Week',     subtitle: '5 mindfulness activities in a week',     xpReward: 50, icon: 'flower-outline' },
          { id: 'l-041', title: 'Breathing',        subtitle: 'Do a 5-minute breathing exercise',      xpReward: 25, icon: 'cloud-outline' },
          { id: 'l-042', title: 'Digital Detox',    subtitle: 'Log a tech-free workout',               xpReward: 35, icon: 'phone-portrait-outline' },
        ],
      },
      {
        id: 'u14', title: 'Recovery Mastery', bonusXp: 40,
        lessons: [
          { id: 'l-043', title: 'Balanced',        subtitle: 'Alternate hard and recovery days',      xpReward: 40, icon: 'scale-outline' },
          { id: 'l-044', title: 'Cold Plunge',     subtitle: 'Try cold water therapy',                 xpReward: 45, icon: 'snow-outline' },
          { id: 'l-045', title: 'Foam Roller',     subtitle: 'Do 5 foam rolling sessions',             xpReward: 35, icon: 'ellipse-outline' },
        ],
      },
      {
        id: 'u15', title: 'Social Fitness', bonusXp: 35,
        lessons: [
          { id: 'l-046', title: 'Team Player',    subtitle: 'Join a group class or team sport',       xpReward: 50, icon: 'people-outline' },
          { id: 'l-047', title: 'Buddy System',    subtitle: 'Work out with a friend',                 xpReward: 40, icon: 'people-circle-outline' },
          { id: 'l-048', title: 'Community',        subtitle: 'Participate in 3 group activities',     xpReward: 55, icon: 'globe-outline' },
        ],
      },
      {
        id: 'u16', title: 'Zen Master', bonusXp: 45,
        lessons: [
          { id: 'l-049', title: 'Yoga Regular',   subtitle: 'Complete 10 yoga sessions',              xpReward: 65, icon: 'leaf-outline' },
          { id: 'l-050', title: 'Mindful Month',   subtitle: '20 mindfulness activities in a month',   xpReward: 70, icon: 'flower-outline' },
          { id: 'l-051', title: 'Inner Peace',     subtitle: 'Maintain a 7-day mindfulness streak',   xpReward: 60, icon: 'heart-circle-outline' },
        ],
      },
      {
        id: 'u17', title: 'Holistic Health', bonusXp: 40,
        lessons: [
          { id: 'l-052', title: 'Sleep Score',     subtitle: 'Average 7.5h+ sleep for 2 weeks',       xpReward: 50, icon: 'moon-outline' },
          { id: 'l-053', title: 'Nutrition Log',   subtitle: 'Log meals for 7 consecutive days',       xpReward: 45, icon: 'nutrition-outline' },
          { id: 'l-054', title: 'Well Rounded',     subtitle: 'Do cardio, strength & yoga in a week', xpReward: 55, icon: 'ellipsis-horizontal-circle-outline' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — Athlete                                            #38bdf8
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 's4', title: 'Athlete', subtitle: 'Train like an athlete and hit serious goals', colour: '#38bdf8',
    units: [
      {
        id: 'u18', title: 'Distance Runner', bonusXp: 45,
        lessons: [
          { id: 'l-055', title: '10K Club',        subtitle: 'Run 10 km in a single session',         xpReward: 75, icon: 'trophy-outline' },
          { id: 'l-056', title: 'Trail Runner',    subtitle: 'Complete an outdoor trail run',          xpReward: 60, icon: 'trail-sign-outline' },
          { id: 'l-057', title: 'Speed Work',       subtitle: 'Do 5 interval training sessions',       xpReward: 65, icon: 'flash-outline' },
        ],
      },
      {
        id: 'u19', title: 'Power Training', bonusXp: 50,
        lessons: [
          { id: 'l-058', title: 'Heavy Lifter',    subtitle: 'Complete 20 strength sessions',          xpReward: 70, icon: 'barbell-outline' },
          { id: 'l-059', title: 'HIIT Master',     subtitle: 'Do 10 HIIT workouts',                    xpReward: 65, icon: 'flash-outline' },
          { id: 'l-060', title: 'Circuit King',     subtitle: 'Complete 5 circuit training sessions',  xpReward: 60, icon: 'repeat-outline' },
          { id: 'l-061', title: 'Core Crusher',    subtitle: '15 dedicated core workouts',              xpReward: 55, icon: 'body-outline' },
        ],
      },
      {
        id: 'u20', title: 'Endurance', bonusXp: 50,
        lessons: [
          { id: 'l-062', title: 'Century Streak',  subtitle: '100 consecutive active days',            xpReward: 120, icon: 'ribbon-outline' },
          { id: 'l-063', title: 'Marathon Prep',    subtitle: 'Run 30 km total in a week',             xpReward: 80, icon: 'map-outline' },
          { id: 'l-064', title: 'Ironman Day',     subtitle: 'Swim, cycle, and run in one day',         xpReward: 100, icon: 'medal-outline' },
        ],
      },
      {
        id: 'u21', title: 'Peak Performance', bonusXp: 50,
        lessons: [
          { id: 'l-065', title: 'Half Marathon',   subtitle: 'Run 21 km in a single session',          xpReward: 100, icon: 'map-outline' },
          { id: 'l-066', title: '6-Pack Week',     subtitle: '6 workouts in a single week',            xpReward: 80, icon: 'stats-chart-outline' },
          { id: 'l-067', title: 'Unstoppable',     subtitle: 'Work out 60 days in a row',               xpReward: 90, icon: 'flame-outline' },
        ],
      },
      {
        id: 'u22', title: 'Competition', bonusXp: 55,
        lessons: [
          { id: 'l-068', title: 'League Climber',  subtitle: 'Finish in the top 5 of a league',       xpReward: 70, icon: 'podium-outline' },
          { id: 'l-069', title: 'Rival',            subtitle: 'Beat someone above you in the league',  xpReward: 60, icon: 'people-outline' },
          { id: 'l-070', title: 'Promotion',        subtitle: 'Get promoted to a higher league',       xpReward: 80, icon: 'arrow-up-circle-outline' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — Elite                                              #fb923c
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 's5', title: 'Elite', subtitle: 'Reach the pinnacle of fitness mastery', colour: '#fb923c',
    units: [
      {
        id: 'u23', title: 'Master Classes', bonusXp: 50,
        lessons: [
          { id: 'l-071', title: 'Decathlete',     subtitle: 'Try 10 different activity types',         xpReward: 80, icon: 'apps-outline' },
          { id: 'l-072', title: 'Coach Mode',      subtitle: 'Help 3 friends start their journey',    xpReward: 70, icon: 'school-outline' },
          { id: 'l-073', title: 'Night Owl',       subtitle: '10 evening workouts after 8 pm',         xpReward: 55, icon: 'moon-outline' },
        ],
      },
      {
        id: 'u24', title: 'Extreme Goals', bonusXp: 60,
        lessons: [
          { id: 'l-074', title: 'Marathon',        subtitle: 'Run a full 42 km marathon',               xpReward: 150, icon: 'medal-outline' },
          { id: 'l-075', title: '200 Sessions',    subtitle: 'Log 200 total workout sessions',         xpReward: 120, icon: 'stats-chart-outline' },
          { id: 'l-076', title: 'Year Strong',     subtitle: '365 consecutive active days',             xpReward: 200, icon: 'calendar-outline' },
        ],
      },
      {
        id: 'u25', title: 'Social Leader', bonusXp: 50,
        lessons: [
          { id: 'l-077', title: 'Influencer',     subtitle: 'Have 10 friends on POWR',                 xpReward: 60, icon: 'megaphone-outline' },
          { id: 'l-078', title: 'League King',     subtitle: 'Win a weekly league',                     xpReward: 100, icon: 'trophy-outline' },
          { id: 'l-079', title: 'Mentor',           subtitle: 'Refer 5 people who complete Section 1', xpReward: 80, icon: 'hand-left-outline' },
        ],
      },
      {
        id: 'u26', title: 'Champion Status', bonusXp: 60,
        lessons: [
          { id: 'l-080', title: 'Top 10%',        subtitle: 'Rank in the top 10% of your league',     xpReward: 100, icon: 'podium-outline' },
          { id: 'l-081', title: 'Diamond',          subtitle: 'Earn 5,000 total lifetime XP',           xpReward: 120, icon: 'diamond-outline' },
          { id: 'l-082', title: 'Champion',        subtitle: 'Reach Level 5: Champion',                 xpReward: 150, icon: 'star-outline' },
        ],
      },
      {
        id: 'u27', title: 'Legend', bonusXp: 100,
        lessons: [
          { id: 'l-083', title: 'Perfectionist',  subtitle: 'Complete every lesson in Section 1-4',   xpReward: 150, icon: 'checkmark-done-circle-outline' },
          { id: 'l-084', title: 'POWR Legend',     subtitle: 'Complete every lesson in the journey',   xpReward: 300, icon: 'star-outline' },
        ],
      },
    ],
  },
];

// ─── State resolver ───────────────────────────────────────────────────────────

export function resolveSections(
  defs: SectionDef[],
  completedIds: Set<string>,
): JourneySection[] {
  let currentAssigned = false;
  return defs.map(section => ({
    ...section,
    units: section.units.map(unit => ({
      ...unit,
      lessons: unit.lessons.map(lesson => {
        if (completedIds.has(lesson.id)) {
          return { ...lesson, state: 'completed' as const };
        }
        if (!currentAssigned) {
          currentAssigned = true;
          return { ...lesson, state: 'current' as const };
        }
        return { ...lesson, state: 'locked' as const };
      }),
    })),
  }));
}

/** Flatten all lessons out of the hierarchy */
export function allLessons(sections: JourneySection[]): JourneyLesson[] {
  return sections.flatMap(s => s.units.flatMap(u => u.lessons));
}

/** Check if every lesson in a unit is completed */
export function isUnitComplete(unit: JourneyUnit): boolean {
  return unit.lessons.every(l => l.state === 'completed');
}

/** Check if a section is fully locked (no completed or current lessons) */
export function isSectionLocked(section: JourneySection): boolean {
  return section.units.every(u => u.lessons.every(l => l.state === 'locked'));
}

/** Check if a section has the current lesson */
export function isSectionActive(section: JourneySection): boolean {
  return section.units.some(u => u.lessons.some(l => l.state === 'current'));
}

// ─── League utilities ─────────────────────────────────────────────────────────

export const LEAGUE_TIERS = [
  { tier: 'Starter', colour: '#9ca3af', threshold: 0   },
  { tier: 'Bronze',  colour: '#cd7f32', threshold: 200 },
  { tier: 'Silver',  colour: '#c0c0c0', threshold: 400 },
  { tier: 'Gold',    colour: '#facc15', threshold: 700 },
  { tier: 'Elite',   colour: '#fb923c', threshold: 1000 },
];

export function msUntilLeagueReset(): number {
  const now = new Date();
  const nextSunday = new Date(now);
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(0, 0, 0, 0);
  return nextSunday.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
