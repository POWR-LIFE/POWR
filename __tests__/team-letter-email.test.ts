import { teamLetterEmail, TeamLetterReport } from '../supabase/functions/_shared/emails/team-letter';

const report: TeamLetterReport = {
  version: 1,
  generated_at: '2026-08-01T12:00:00Z',
  window: {
    start: '2026-07-27',
    end: '2026-08-02',
    previous_start: '2026-07-20',
    previous_end: '2026-07-26',
  },
  headline: [
    { key: 'members', label: 'Active members', value: 15, previous: 12, delta_pct: 25, format: 'number' },
    { key: 'points', label: 'POWR issued', value: 1274, previous: 1400, delta_pct: -9, format: 'points' },
  ],
  trend: [
    { date: '2026-07-27', workouts: 8, app_sessions: 24 },
    { date: '2026-07-28', workouts: 5, app_sessions: 19 },
  ],
  sections: [{
    key: 'product',
    title: 'Product <engagement>',
    accent: '#8B5CF6',
    metrics: [
      { key: 'sessions', label: 'App sessions', value: 156, previous: 133, delta_pct: 17.3, format: 'number' },
      { key: 'screens', label: 'Screens / session', value: 4.2, previous: 3.8, delta_pct: 10.5, format: 'decimal' },
    ],
    bars: [{ label: '/rewards', value: 82 }, { label: '/progress', value: 54 }],
    bar_label: 'Most viewed screens',
  }],
};

describe('teamLetterEmail', () => {
  it('renders an escaped visual report with a plaintext fallback', () => {
    const email = teamLetterEmail({
      subject: '[POWR Weekly] 15 active members',
      title: 'POWR Platform Pulse <draft>',
      previewText: '156 app sessions & 39 trusted workouts.',
      weekLabel: '27 Jul - 2 Aug 2026',
      report,
    });

    expect(email.subject).toBe('[POWR Weekly] 15 active members');
    expect(email.html).toContain('POWR Platform Pulse &lt;draft&gt;');
    expect(email.html).toContain('156 app sessions &amp; 39 trusted workouts.');
    expect(email.html).toContain('Product &lt;engagement&gt;');
    expect(email.html).toContain('1,274 POWR');
    expect(email.html).toContain('17.3% WoW');
    expect(email.html).toContain('Most viewed screens');
    expect(email.html).toContain('/rewards');
    expect(email.html).toContain('Internal POWR report');
    expect(email.html).not.toContain('Unsubscribe');
    expect(email.text).toContain('27 Jul - 2 Aug 2026');
    expect(email.text).toContain('App sessions: 156 (+17.3% WoW)');
    expect(email.text).toContain('/progress: 54');
  });
});