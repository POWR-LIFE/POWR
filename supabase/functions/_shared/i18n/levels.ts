// Level names for pushes and emails, per language. The app's names live in
// shared/i18n/<lang>/app/points.json (levels.<key>.name), which an edge function
// cannot import, so they are repeated here. __tests__/serverI18n.test.ts fails
// if any name here differs from the app's, so the two can't drift.

import { LEVELS } from "../levels.ts";

/** Catalog key for each level, in ladder order (level 1 first). */
export const LEVEL_KEYS = ["touchingGrass", "cardioGoblin", "streakFreak", "motionMagic", "heavyHitter", "cantSitStill", "ironLungs", "pavementPredator", "stepCollector", "calorieCriminal", "mileMuncher", "moveMachine", "needNewShoes", "certifiedWeapon", "momentumMonster", "limitBreaker", "dieselMode", "peakCondition", "longHauler", "goggins"] as const;

export const LEVEL_NAMES: Record<string, Record<(typeof LEVEL_KEYS)[number], string>> = {
  en: {
    touchingGrass: "Touching Grass",
    cardioGoblin: "Cardio Goblin",
    streakFreak: "Streak Freak",
    motionMagic: "Motion Magic",
    heavyHitter: "Heavy Hitter",
    cantSitStill: "Can't Sit Still",
    ironLungs: "Iron Lungs",
    pavementPredator: "Pavement Predator",
    stepCollector: "Step Collector",
    calorieCriminal: "Calorie Criminal",
    mileMuncher: "Mile Muncher",
    moveMachine: "Move Machine",
    needNewShoes: "Need New Shoes",
    certifiedWeapon: "Certified Weapon",
    momentumMonster: "Momentum Monster",
    limitBreaker: "Limit Breaker",
    dieselMode: "Diesel Mode",
    peakCondition: "Peak Condition",
    longHauler: "Long Hauler",
    goggins: "Goggins",
  },
  fr: {
    touchingGrass: "Adieu canapé",
    cardioGoblin: "Gobelin du cardio",
    streakFreak: "Série infernale",
    motionMagic: "Magie du mouvement",
    heavyHitter: "Poids lourd",
    cantSitStill: "La bougeotte",
    ironLungs: "Poumons d’acier",
    pavementPredator: "Terreur du bitume",
    stepCollector: "Mille-pattes",
    calorieCriminal: "Braquage calorique",
    mileMuncher: "Avale-kilomètres",
    moveMachine: "Machine à bouger",
    needNewShoes: "Baskets à bout",
    certifiedWeapon: "Bête de compét",
    momentumMonster: "Rouleau compresseur",
    limitBreaker: "Brise-limites",
    dieselMode: "Mode diesel",
    peakCondition: "Forme olympique",
    longHauler: "Long-courrier",
    goggins: "Goggins",
  },
  es: {
    touchingGrass: "Adiós sofá",
    cardioGoblin: "Duende del cardio",
    streakFreak: "Rachamanía",
    motionMagic: "Magia en movimiento",
    heavyHitter: "Peso pesado",
    cantSitStill: "Culo inquieto",
    ironLungs: "Pulmones de acero",
    pavementPredator: "Terror del asfalto",
    stepCollector: "Ciempiés",
    calorieCriminal: "Atraco calórico",
    mileMuncher: "Comekilómetros",
    moveMachine: "Pura máquina",
    needNewShoes: "Zapas fundidas",
    certifiedWeapon: "Bestia certificada",
    momentumMonster: "Monstruo imparable",
    limitBreaker: "Rompelímites",
    dieselMode: "Modo diésel",
    peakCondition: "Estado de gracia",
    longHauler: "Largo recorrido",
    goggins: "Goggins",
  },
};

/** A level's name in `lang`, falling back to the server ladder's English name. */
export function levelName(lang: string, level: number): string {
  const key = LEVEL_KEYS[level - 1];
  return (key && LEVEL_NAMES[lang]?.[key]) || LEVELS.find((l) => l.level === level)?.name || `Level ${level}`;
}
