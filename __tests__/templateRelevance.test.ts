import { filterTemplatesByRelevance } from '@/lib/social/templateRelevance';

const T = [
  { id: 'g1', category: 'gym' }, { id: 'w1', category: 'walking' },
  { id: 'r1', category: 'running' }, { id: 'c1', category: 'cycling' }, { id: 'm1', category: 'multi' },
];

describe('filterTemplatesByRelevance', () => {
  it('drops categories outside the relevant set but always keeps multi', () => {
    expect(filterTemplatesByRelevance(T, ['running', 'walking']).map(t => t.id)).toEqual(['w1', 'r1', 'm1']);
  });
  it('keeps gym templates for a gym-relevant user', () => {
    expect(filterTemplatesByRelevance(T, ['gym']).map(t => t.id)).toEqual(['g1', 'm1']);
  });
  it('fails open when nothing would remain', () => {
    const noMulti = T.filter(t => t.category !== 'multi');
    expect(filterTemplatesByRelevance(noMulti, [])).toEqual(noMulti);
  });
  it('preserves the incoming sort order', () => {
    expect(filterTemplatesByRelevance([...T].reverse(), ['gym', 'walking']).map(t => t.id)).toEqual(['m1', 'w1', 'g1']);
  });
});
