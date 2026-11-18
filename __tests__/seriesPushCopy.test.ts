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

/**
 * series_trophy (20261118120000): the morning after award_honours, the top
 * metal of each trophy reached since the last push. The numbers come from
 * honours.count / detail, read by the same ladders as _honour_tier.
 */
describe('series_trophy', () => {
    const one = (item: Record<string, unknown>, lang = 'en', series: string | undefined = 'Autumn Series') =>
        buildMessage('series_trophy', { items: [item], series }, lang);

    it('names the trophy, the metal and what earned it', () => {
        const msg = one({ kind: 'strength', tier: 'bronze', count: 4, detail: {} });
        expect(msg.title).toBe('New trophy: Strength Bronze');
        expect(msg.body).toBe('For 4 strength sessions in the Autumn Series. It’s next to your name on the board.');
        expect(msg.data).toMatchObject({ type: 'series_trophy', route: '/(tabs)/league?focus=series' });
    });

    it('reads each ladder the way the server awards it', () => {
        expect(one({ kind: 'on_fire', tier: 'bronze', count: 2, detail: {} }).body).toContain('For 2 weeks with a session');
        expect(one({ kind: 'power', tier: 'silver', count: 4, detail: { w5: 1, w6: 0 } }).body).toContain('For 4 weeks of 4+ active days');
        expect(one({ kind: 'power', tier: 'gold', count: 7, detail: { w5: 6, w6: 2 } }).body).toContain('For 6 weeks of 5+ active days');
        expect(one({ kind: 'power', tier: 'platinum', count: 9, detail: { w5: 8, w6: 8 } }).body).toContain('For 8 weeks of 6+ active days');
        expect(one({ kind: 'diamond', tier: 'bronze', count: 1, detail: {} }).body).toContain('For moving every day of a round');
        expect(one({ kind: 'diamond', tier: 'silver', count: 3, detail: {} }).body).toContain('For moving every day of 3 rounds');
        expect(one({ kind: 'wings', tier: 'bronze', count: 12, detail: { top: false } }).body).toContain('For climbing 12 places in a round');
        expect(one({ kind: 'wings', tier: 'platinum', count: 40, detail: { top: true } }).body).toContain('For reaching Nº 1 from outside the top 10');
        expect(one({ kind: 'hive', tier: 'bronze', count: 3, detail: { active: 1 } }).body).toContain('For bringing in 3 friends');
        expect(one({ kind: 'hive', tier: 'silver', count: 8, detail: { active: 6 } }).body).toContain('For 6 friends who stayed active');
        expect(one({ kind: 'strength', tier: 'silver', count: 1, detail: {} }).body).toContain('For 1 strength session');
    });

    it('never says 0: a missing number drops the reason', () => {
        const msg = one({ kind: 'power', tier: 'gold', count: 7, detail: {} });
        expect(msg.title).toBe('New trophy: Power Gold');
        expect(msg.body).toBe('It’s next to your name on the Autumn Series board.');
    });

    it('lists several, top metal first as the server sends them', () => {
        const two = buildMessage('series_trophy', { series: 'Autumn Series', items: [
            { kind: 'on_fire', tier: 'silver', count: 4, detail: {} },
            { kind: 'diamond', tier: 'bronze', count: 1, detail: {} },
        ] }, 'en');
        expect(two.title).toBe('2 new trophies');
        expect(two.body).toBe('On Fire Silver and Diamond Bronze in the Autumn Series. They’re next to your name on the board.');
        const three = buildMessage('series_trophy', { series: 'Autumn Series', items: [
            { kind: 'wings', tier: 'silver', count: 22, detail: {} },
            { kind: 'diamond', tier: 'bronze', count: 1, detail: {} },
            { kind: 'strength', tier: 'bronze', count: 4, detail: {} },
        ] }, 'en');
        expect(three.title).toBe('3 new trophies');
        expect(three.body).toBe('Wings Silver, Diamond Bronze and Strength Bronze in the Autumn Series. They’re next to your name on the board.');
    });

    it('crowns the King with the round they won', () => {
        const king = one({ kind: 'king', tier: 'gold', count: 1, detail: {}, round: 'Round 01' });
        expect(king.title).toBe('You’re the King');
        expect(king.body).toBe('You won Round 01 of the Autumn Series. The crown sits next to your name until the next round is won.');
        expect(one({ kind: 'king', tier: 'gold', count: 1, detail: {} }).body).toBe('You won the round in the Autumn Series. The crown sits next to your name until the next round is won.');
    });

    it('drops what it does not know and says "the Series" with no season name', () => {
        const msg = buildMessage('series_trophy', { items: [{ kind: 'unicorn', tier: 'gold' }, { kind: 'strength', tier: 'bronze', count: 4 }] }, 'en');
        expect(msg.title).toBe('New trophy: Strength Bronze');
        expect(msg.body).toBe('For 4 strength sessions in the Series. It’s next to your name on the board.');
        expect(buildMessage('series_trophy', {}, 'en').title).toBe('New trophy');
    });

    it('speaks French and Spanish, trophy names in English as in the app', () => {
        const fr = one({ kind: 'strength', tier: 'silver', count: 30, detail: {} }, 'fr');
        expect(fr.title).toBe('Nouveau trophée : Strength Argent');
        expect(fr.body).toBe('Pour 30 séances de muscu, au classement Autumn Series. Tu le vois à côté de ton nom.');
        const es = one({ kind: 'on_fire', tier: 'bronze', count: 2, detail: {} }, 'es');
        expect(es.title).toBe('Nuevo trofeo: On Fire Bronce');
        expect(es.body).toBe('Por 2 semanas con una sesión en la Autumn Series. Ya está junto a tu nombre en la tabla.');
        expect(one({ kind: 'diamond', tier: 'bronze', count: 1, detail: {} }, 'es').body).toContain('Por moverte cada día de una ronda');
        expect(one({ kind: 'king', tier: 'gold', count: 1, detail: {}, round: 'Round 01' }, 'fr').title).toBe('La couronne est à toi');
    });
});
