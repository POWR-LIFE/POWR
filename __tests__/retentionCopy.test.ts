import {
  driftHeadline, dowList, frequency, patternLine, personLine, quietLabel, sinceLabel, statusLabel,
} from '@/supabase/functions/_shared/retentionCopy';

// Retention's words (portal + morning email). The rule is SQL; these only
// say its numbers, and must say them the same way everywhere.

describe('patternLine', () => {
  it('says how often, when and which days, like the trailer', () => {
    expect(patternLine({ per_week: 3.1, part: 'morning', dows: [1, 3, 5] })).toBe('Usually 3× a week, mornings · Mon, Wed & Fri');
  });

  it('leaves out what isn\'t a habit', () => {
    expect(patternLine({ per_week: 2.2, part: null, dows: null })).toBe('Usually 2× a week');
    expect(patternLine({ per_week: '1.6', part: 'evening', dows: [2] })).toBe('Usually 2× a week, evenings · Tue');
  });

  it('has nothing to say without a pattern', () => {
    expect(patternLine({ per_week: null })).toBe('');
  });

  it('rounds frequency into words people use', () => {
    expect(frequency({ per_week: 5.2 })).toBe('most days');
    expect(frequency({ per_week: 1.0 })).toBe('about once a week');
    expect(frequency({ per_week: 0.5 })).toBe('every couple of weeks');
  });
});

describe('labels', () => {
  it('counts quiet days, then weeks', () => {
    expect(quietLabel(12)).toBe('12 days quiet');
    expect(quietLabel(1)).toBe('1 day quiet');
    expect(quietLabel(35)).toBe('5 weeks quiet');
  });

  it('says when they were last in', () => {
    expect(sinceLabel(0)).toBe('today');
    expect(sinceLabel(1)).toBe('yesterday');
    expect(sinceLabel(16)).toBe('16 days ago');
    expect(sinceLabel(null)).toBe('not yet');
  });

  it('joins weekdays', () => {
    expect(dowList([1, 3, 5])).toBe('Mon, Wed & Fri');
    expect(dowList([6, 7])).toBe('Sat & Sun');
    expect(dowList(null)).toBe('');
  });

  it('blames the phone, not the member, when POWR can\'t hear it', () => {
    expect(statusLabel('drifting', 'ok')).toBe('Drifting');
    expect(statusLabel('drifting', 'no_signal')).toBe('Not syncing');
    expect(statusLabel('slipping', 'location_off')).toBe('Location off');
    // Not at risk: the signal doesn't change what they are.
    expect(statusLabel('regular', 'no_signal')).toBe('On track');
  });

  it('names one person, counts several', () => {
    expect(driftHeadline(1, 'Callum R.')).toBe('Callum R. is drifting');
    expect(driftHeadline(3)).toBe('3 people are drifting');
  });
});

describe('personLine', () => {
  it('pairs the last visit with their normal', () => {
    expect(personLine({ status: 'drifting', signal: 'ok', gap_days: 16, per_week: 1.5, part: 'morning', dows: null }))
      .toBe('Last visit 16 days ago · Usually 2× a week, mornings');
  });

  it('says they may still be training when the phone has gone quiet', () => {
    expect(personLine({ status: 'drifting', signal: 'no_signal', gap_days: 27, per_week: 2.2 }))
      .toBe('Last visit 27 days ago · POWR hasn\'t heard from their phone, so they may still be training');
  });

  it('covers new faces and members who never came in', () => {
    const asOf = '2026-10-07';
    expect(personLine({ status: 'new', first_visit: '2026-09-28', visit_days: 1, gap_days: 9, as_of: asOf })).toBe('First visit 9 days ago, not back yet');
    expect(personLine({ status: 'new', first_visit: '2026-09-28', visit_days: 3, gap_days: 2, as_of: asOf })).toBe('First visit 9 days ago, 3 visits so far');
    expect(personLine({ status: 'unseen' })).toBe('Picked your gym, not checked in here yet');
  });
});
