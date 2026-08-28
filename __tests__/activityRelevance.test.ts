import {
  RELEVANCE_WINDOW_MS,
  isActivityRelevant,
  isGymRelevant,
  observedActivityTypes,
  relevantActivities,
} from '@/supabase/functions/_shared/activityRelevance';

const NOW = Date.parse('2026-08-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe('observedActivityTypes', () => {
  it('collects distinct session types and drops sleep + garbage', () => {
    expect(observedActivityTypes([
      { type: 'running' }, { type: 'running' }, { type: 'sleep' },
      { type: null }, { type: '' }, null as any, { type: 'walking' },
    ])).toEqual(['running', 'walking']);
  });

  it('excludes manual logs by default and includes them on request', () => {
    const rows = [{ type: 'gym', verification: 'manual' }, { type: 'walking', verification: 'wearable' }];
    expect(observedActivityTypes(rows)).toEqual(['walking']);
    expect(observedActivityTypes(rows, { includeManual: true })).toEqual(['gym', 'walking']);
  });

  it('respects the sinceMs window and ignores unparseable timestamps', () => {
    const rows = [
      { type: 'gym', started_at: at(30) },
      { type: 'cycling', started_at: at(2) },
      { type: 'swimming', started_at: 'not a date' },
    ];
    expect(observedActivityTypes(rows, { sinceMs: NOW - RELEVANCE_WINDOW_MS })).toEqual(['cycling']);
  });
});

describe('relevantActivities', () => {
  it('is declared ∪ observed, declared first, de-duplicated', () => {
    expect(relevantActivities(['gym', 'running'], ['running', 'cycling'])).toEqual(['gym', 'running', 'cycling']);
  });

  it('tolerates a non-array declared value and non-string entries', () => {
    expect(relevantActivities(null, ['walking'])).toEqual(['walking']);
    expect(relevantActivities('gym', [])).toEqual([]);
    expect(relevantActivities([1, null, 'gym', 'sleep'], undefined)).toEqual(['gym']);
  });
});

describe('isGymRelevant', () => {
  it('is false for a cardio-only user with no gym in prefs or sessions', () => {
    expect(isGymRelevant(['walking', 'running'], [{ type: 'walking', started_at: at(1) }], NOW)).toBe(false);
  });

  it('is true when gym is declared, even with no gym sessions', () => {
    expect(isGymRelevant(['gym', 'walking'], [], NOW)).toBe(true);
  });

  it('is true when gym was observed recently, even if not declared', () => {
    expect(isGymRelevant(['walking'], [{ type: 'gym', started_at: at(5), verification: 'geofence' }], NOW)).toBe(true);
  });

  it('counts a manual gym log as evidence for copy decisions', () => {
    expect(isGymRelevant(['walking'], [{ type: 'gym', started_at: at(5), verification: 'manual' }], NOW)).toBe(true);
  });

  it('forgets gym sessions older than the 21-day window', () => {
    expect(isGymRelevant(['walking'], [{ type: 'gym', started_at: at(22), verification: 'geofence' }], NOW)).toBe(false);
    expect(isActivityRelevant('gym', ['walking'], [])).toBe(false);
  });
});
