/**
 * The two Series pushes (series_dispatch_pushes → send-push-notification):
 * the 08:00 rival push and "<name> just passed you". The gap turns into the one
 * session that closes it, the same thresholds the app's next-move line uses,
 * and the season's name (payload.series) says which Series it is.
 */
import { buildMessage } from '@/supabase/functions/_shared/pushCopy';

describe('series_rival', () => {
    it('names the rival, the gap and the session that closes it', () => {
        const run = buildMessage('series_rival', { name: 'Tom Fitzgerald', gap: 8, ahead: false, series: 'Autumn Series' }, 'en');
        expect(run.title).toBe('Your rival');
        expect(run.body).toBe('Tom Fitzgerald is 8 pts ahead in the Autumn Series. One run does it.');
        expect(run.data).toMatchObject({ type: 'series_rival', route: '/(tabs)/league?focus=rival' });

        expect(buildMessage('series_rival', { name: 'Tom', gap: 18 }, 'en').body).toContain('One gym session does it.');
        expect(buildMessage('series_rival', { name: 'Tom', gap: 44 }, 'en').body).toContain('About 3 sessions do it.');
    });

    it('tells the leader who is chasing', () => {
        const lead = buildMessage('series_rival', { name: 'Dee', gap: 3, ahead: true, series: 'Winter Series' }, 'en');
        expect(lead.body).toBe('Dee is 3 pts behind you in the Winter Series. One session today keeps you clear.');
    });

    it('says "the Series" when the season has no name to give', () => {
        expect(buildMessage('series_rival', { name: 'Tom', gap: 8 }, 'en').body).toBe('Tom is 8 pts ahead in the Series. One run does it.');
    });

    it('speaks Spanish and French', () => {
        expect(buildMessage('series_rival', { name: 'Tom', gap: 8, series: 'Autumn Series' }, 'es').body).toBe('Tom va 8 pts por delante en la Autumn Series. Con una carrera basta.');
        expect(buildMessage('series_rival', { name: 'Tom', gap: 8, series: 'Autumn Series' }, 'fr').body).toBe('Tom a 8 pts d’avance au classement Autumn Series. Une course suffit.');
    });
});

describe('series_passed', () => {
    it('says who passed you, where you are now and how to get it back', () => {
        const msg = buildMessage('series_passed', { name: 'Dee Moss', rank: 4, gap: 32, series: 'Spring Series' }, 'en');
        expect(msg.title).toBe('Dee Moss just passed you');
        expect(msg.body).toBe("You're #4 in the Spring Series, 32 pts behind. About 3 sessions get it back.");
        expect(buildMessage('series_passed', { name: 'Dee', rank: 4, gap: 6 }, 'fr').title).toBe('Dee vient de te dépasser');
    });
});

describe('series_moment', () => {
    it('uses the moment’s own name and line from /admin/series', () => {
        const msg = buildMessage('series_moment', { title: 'Power Hour', body: 'Every session counts 2× until 19:00.', series: 'Autumn Series' }, 'en');
        expect(msg.title).toBe('Power Hour');
        expect(msg.body).toBe('Every session counts 2× until 19:00.');
        expect(msg.data).toMatchObject({ type: 'series_moment', route: '/(tabs)/league' });
    });

    it('falls back to a line of its own when the moment has none', () => {
        const msg = buildMessage('series_moment', { title: 'Blind Mode', body: '', series: 'Winter Series' }, 'en');
        expect(msg.body).toBe('Something just started in the Winter Series. Open POWR to see it.');
        expect(buildMessage('series_moment', {}, 'fr').title).toBe('C’est parti');
    });
});
