/**
 * Challenge names and goal lines in the reader's language.
 *
 * They come from data, not from screens: weekly challenges from the bundled
 * catalog (shared/weeklyChallenges.js, English), Together templates from
 * shared_challenge_templates rows (English, written by an admin). Each is
 * translated by a stable handle — the weekly catalog id, the template's stored
 * English title (supabase/functions/_shared/i18n/challengeNames.ts) — and
 * anything without one shows exactly as stored.
 *
 * The hooks hand screens objects whose `title` / `goal` / `description` are
 * GETTERS over these functions (withLocalized…), so every screen that prints
 * `template.title` gets the language on screen at render time, and a language
 * switch shows on the next render. The stored English stays readable as
 * `sourceTitle` / `sourceGoal`. English output is byte-identical to the stored
 * text (__tests__/challengeNames.test.ts).
 */
import i18n, { getFormatLocale } from '@/lib/i18n';
import { sharedChallengeGoalText, type GoalMeasure } from '@/shared/sharedChallengeGoal';
import { CATALOG } from '@/shared/weeklyChallenges';
import { templateTitleKey } from '@/supabase/functions/_shared/i18n/challengeNames';

type CatalogEntry = { id: string; title: string; description: string; rule: Record<string, any> };
const BUNDLED = new Map<string, CatalogEntry>((CATALOG as CatalogEntry[]).map((c) => [c.id, c]));

/** The step count a walking challenge's description quotes, from its rule. */
function stepsOf(rule: Record<string, any>): number | undefined {
  if (rule.kind === 'daily_metric_days' || rule.kind === 'step_window') return rule.threshold;
  if (rule.metric === 'steps') return rule.target;
  return undefined;
}

/** The bundled entry for `id`, only while `text` still matches it (an admin catalog override may reword one). */
function bundled(id: string, field: 'title' | 'description', text: string): CatalogEntry | null {
  const entry = BUNDLED.get(id);
  return entry && entry[field] === text ? entry : null;
}

/** A weekly challenge's name, e.g. "Just Run" → « Cours, c’est tout ». */
export function weeklyChallengeTitle(id: string, title: string): string {
  return bundled(id, 'title', title) ? i18n.t(`challenges:weekly.${id}.title`) : title;
}

/**
 * A weekly challenge's name when only its English title is known (the points
 * ledger stores "Weekly challenge: Just Run (+15)"). Titles shared by two
 * challenges ("Twice This Week") stay as stored.
 */
export function weeklyChallengeTitleByName(title: string): string {
  const matches = (CATALOG as CatalogEntry[]).filter((c) => c.title === title);
  return matches.length === 1 ? weeklyChallengeTitle(matches[0].id, title) : title;
}

/** A weekly challenge's one-line description. */
export function weeklyChallengeDescription(id: string, description: string): string {
  const entry = bundled(id, 'description', description);
  if (!entry) return description;
  const steps = stepsOf(entry.rule);
  return i18n.t(`challenges:weekly.${id}.description`, steps == null ? undefined : { steps: steps.toLocaleString(getFormatLocale()) });
}

/** A Together template's title, from the English stored on the row (or its snapshot). */
export function challengeTemplateTitle(title: string): string {
  const key = templateTitleKey(title);
  return key ? i18n.t(`challenges:templates.${key}`) : title;
}

export interface GoalSourceFields {
  /** The stored English line (shared_challenge_templates.goal, or the snapshot's copy). */
  goal: string;
  category: string;
  mode?: string | null;
  measure?: GoalMeasure | null;
}

/**
 * A Together template's goal line. English shows the stored line as written —
 * it is what the panel generated, and the generator reproduces it exactly, so
 * this only matters for a line someone edited by hand. Other languages get the
 * line generated from the measure, or the stored English when the measure is
 * missing (an old snapshot) or one the generator doesn't know.
 */
export function challengeTemplateGoal(source: GoalSourceFields): string {
  if (i18n.language === 'en' && source.goal) return source.goal;
  const generated = sharedChallengeGoalText(source, (key, vars) => i18n.t(key, vars), getFormatLocale());
  return generated ?? source.goal;
}

/**
 * A template (catalog row or challenge snapshot) whose `title` and `goal` read
 * in the language on screen. `fallbackTitle` covers a snapshot with no title.
 */
export function withLocalizedTemplateText<T extends { title: string; goal: string; category: string; mode?: string | null }>(
  template: T & { measure?: GoalMeasure | null },
  hasTitle = true,
): T & { sourceTitle: string; sourceGoal: string } {
  const sourceTitle = template.title;
  const sourceGoal = template.goal;
  const out = { ...template, sourceTitle, sourceGoal };
  Object.defineProperties(out, {
    title: {
      enumerable: true,
      configurable: true,
      get: () => (hasTitle ? challengeTemplateTitle(sourceTitle) : i18n.t('social:fallbackTitle')),
    },
    goal: {
      enumerable: true,
      configurable: true,
      get: () => challengeTemplateGoal({ goal: sourceGoal, category: template.category, mode: template.mode, measure: template.measure }),
    },
  });
  return out;
}

/** A weekly card or recap row whose `title` (and `description`, `completeSubtitle` where present) read in the language on screen. */
export function withLocalizedWeeklyText<T extends { id: string; title: string; description?: string; completeSubtitle?: string }>(card: T): T {
  const { id, title, description, completeSubtitle } = card;
  const out = { ...card };
  const props: PropertyDescriptorMap = {
    title: { enumerable: true, configurable: true, get: () => weeklyChallengeTitle(id, title) },
  };
  if (description !== undefined) {
    props.description = { enumerable: true, configurable: true, get: () => weeklyChallengeDescription(id, description) };
  }
  if (completeSubtitle !== undefined) {
    props.completeSubtitle = { enumerable: true, configurable: true, get: () => weeklyChallengeDescription(id, completeSubtitle) };
  }
  Object.defineProperties(out, props);
  return out;
}
