// How a gym's team reads on its page in the app (app/(tabs)/discover.tsx)
// and in the gym portal's phone (landing-page GymAppPreview.jsx): one rule
// for both, so the preview is the app.
//
// Every row was a personal trainer before roles existed, so a row with no
// role still is one. While the whole team is personal trainers the section
// keeps its old heading and nobody's role is spelled out; once anyone else
// joins (a coach, a physio, the manager) it becomes "The Team" and each
// person's role shows next to their experience.

export type TeamRow = { role?: string | null; experience?: string | null };

const PT = /^(personal trainers?|pt)$/i;

export function isPersonalTrainer(role?: string | null): boolean {
  const r = (role ?? '').trim();
  return r === '' || PT.test(r);
}

const allTrainers = (rows: TeamRow[]) => rows.every((r) => isPersonalTrainer(r.role));

/** The section heading above the team. */
export function teamHeading(rows: TeamRow[]): string {
  return allTrainers(rows) ? 'Personal Trainers' : 'The Team';
}

/** The line under a name: their role when the team is mixed, then their experience. */
export function teamLine(row: TeamRow, rows: TeamRow[]): string {
  const role = allTrainers(rows) ? '' : ((row.role ?? '').trim() || 'Personal trainer');
  return [role, (row.experience ?? '').trim()].filter(Boolean).join(' · ');
}
