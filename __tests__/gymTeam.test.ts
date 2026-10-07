import { isPersonalTrainer, teamHeading, teamLine } from '../shared/gymTeam';

describe('gymTeam', () => {
  it('treats a missing role as a personal trainer (every row before roles)', () => {
    expect(isPersonalTrainer(null)).toBe(true);
    expect(isPersonalTrainer('')).toBe(true);
    expect(isPersonalTrainer('  Personal Trainer ')).toBe(true);
    expect(isPersonalTrainer('PT')).toBe(true);
    expect(isPersonalTrainer('Coach')).toBe(false);
  });

  it('keeps the old heading and lines while everyone is a trainer', () => {
    const rows = [{ role: null, experience: '10 Years' }, { role: 'Personal trainer', experience: '' }];
    expect(teamHeading(rows)).toBe('Personal Trainers');
    expect(teamLine(rows[0], rows)).toBe('10 Years');
    expect(teamLine(rows[1], rows)).toBe('');
  });

  it('names everyone’s role once the team is mixed', () => {
    const rows = [{ role: null, experience: '10 Years' }, { role: 'Physio', experience: null }, { role: 'Manager', experience: ' 3 years ' }];
    expect(teamHeading(rows)).toBe('The Team');
    expect(teamLine(rows[0], rows)).toBe('Personal trainer · 10 Years');
    expect(teamLine(rows[1], rows)).toBe('Physio');
    expect(teamLine(rows[2], rows)).toBe('Manager · 3 years');
  });

  it('reads an empty team as trainers', () => {
    expect(teamHeading([])).toBe('Personal Trainers');
  });
});
