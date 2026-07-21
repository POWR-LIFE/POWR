/**
 * POWR level thresholds — MUST mirror constants/levels.ts LEVELS[].xpMin
 * (the app's single source of truth); the vault_level_up_check() trigger
 * carries the same array. Do not drift.
 *
 * Level is derived from LIFETIME EARNED points (positive ledger sum +
 * pending vault) — never from the current balance and never from
 * profiles.level, which is a dead column nothing writes.
 */
export const LEVELS = [
    { level: 1,  name: 'Touching Grass',    xpMin: 0 },
    { level: 2,  name: 'Cardio Goblin',     xpMin: 500 },
    { level: 3,  name: 'Streak Freak',      xpMin: 1200 },
    { level: 4,  name: 'Motion Magic',      xpMin: 2500 },
    { level: 5,  name: 'Heavy Hitter',      xpMin: 4500 },
    { level: 6,  name: "Can't Sit Still",   xpMin: 7000 },
    { level: 7,  name: 'Iron Lungs',        xpMin: 10000 },
    { level: 8,  name: 'Pavement Predator', xpMin: 14000 },
    { level: 9,  name: 'Step Collector',    xpMin: 19000 },
    { level: 10, name: 'Calorie Criminal',  xpMin: 25000 },
    { level: 11, name: 'Mile Muncher',      xpMin: 32500 },
    { level: 12, name: 'Move Machine',      xpMin: 41000 },
    { level: 13, name: 'Need New Shoes',    xpMin: 51000 },
    { level: 14, name: 'Certified Weapon',  xpMin: 63000 },
    { level: 15, name: 'Momentum Monster',  xpMin: 77000 },
    { level: 16, name: 'Limit Breaker',     xpMin: 93000 },
    { level: 17, name: 'Diesel Mode',       xpMin: 111000 },
    { level: 18, name: 'Peak Condition',    xpMin: 132000 },
    { level: 19, name: 'Long Hauler',       xpMin: 156000 },
    { level: 20, name: 'Goggins',           xpMin: 182000 },
];

/** Level number (1-20) for a lifetime-earned points total. */
export function levelFromEarned(totalEarned) {
    const earned = Number(totalEarned) || 0;
    let current = LEVELS[0];
    for (const l of LEVELS) {
        if (earned >= l.xpMin) current = l;
        else break;
    }
    return current.level;
}
