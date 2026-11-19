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

/**
 * series_passed since 20261118180000: the payload also carries `was` (your
 * place at the last check) and `places` (how many places win), so losing the
 * lead or a prize place says so. Without them it reads as before.
 */
describe('series_passed, the place you lost', () => {
    it('says when you lost the lead', () => {
        const msg = buildMessage('series_passed', { name: 'Dee', rank: 2, was: 1, places: 3, gap: 8, series: 'Autumn Series' }, 'en');
        expect(msg.title).toBe('Dee just passed you');
        expect(msg.body).toBe("You've lost the lead in the Autumn Series. You're #2, 8 pts behind. One run gets it back.");
    });

    it('says when you dropped out of the prize places', () => {
        const msg = buildMessage('series_passed', { name: 'Dee', rank: 4, was: 3, places: 3, gap: 18, series: 'Autumn Series' }, 'en');
        expect(msg.body).toBe("You're out of the prize places in the Autumn Series. You're #4, 18 pts behind. One gym session gets it back.");
    });

    it('is the plain line otherwise, or from a dispatcher that sends neither', () => {
        const inside = buildMessage('series_passed', { name: 'Dee', rank: 3, was: 2, places: 3, gap: 5, series: 'Autumn Series' }, 'en');
        expect(inside.body).toBe("You're #3 in the Autumn Series, 5 pts behind. One run gets it back.");
        const below = buildMessage('series_passed', { name: 'Dee', rank: 9, was: 8, places: 3, gap: 5, series: 'Autumn Series' }, 'en');
        expect(below.body).toBe("You're #9 in the Autumn Series, 5 pts behind. One run gets it back.");
        const old = buildMessage('series_passed', { name: 'Dee', rank: 2, gap: 5, series: 'Autumn Series' }, 'en');
        expect(old.body).toBe("You're #2 in the Autumn Series, 5 pts behind. One run gets it back.");
    });

    it('when only 1st wins, losing it is losing the lead', () => {
        const msg = buildMessage('series_passed', { name: 'Dee', rank: 2, was: 1, places: 1, gap: 30 }, 'en');
        expect(msg.body).toBe("You've lost the lead in the Series. You're #2, 30 pts behind. About 2 sessions get it back.");
    });

    it('speaks Spanish and French', () => {
        expect(buildMessage('series_passed', { name: 'Dee', rank: 2, was: 1, places: 3, gap: 8, series: 'Autumn Series' }, 'es').body)
            .toBe('Ya no vas en cabeza en la Autumn Series. Vas el n.º 2, a 8 pts. Una carrera y lo recuperas.');
        expect(buildMessage('series_passed', { name: 'Dee', rank: 4, was: 3, places: 3, gap: 8, series: 'Autumn Series' }, 'fr').body)
            .toBe('Tu sors des places primées du classement Autumn Series. Tu es n° 4, à 8 pts. Une course et tu reprends ta place.');
    });
});

/**
 * series_placement (20261118180000): once between 20:00 and 21:00 the member's
 * own time, where they finished the day against where it began. Up past a
 * member, or down because one passed you; the lead and the prize places have
 * their own lines. The gap turns into the session that closes it.
 */
describe('series_placement', () => {
    const day = (payload: Record<string, unknown>, lang = 'en') =>
        buildMessage('series_placement', { series: 'Autumn Series', ...payload }, lang);

    it('up: your place tonight and where you started the day', () => {
        const msg = day({ dir: 'up', rank: 6, was: 16, gap: 12 });
        expect(msg.title).toBe('Up to #6 today');
        expect(msg.body).toBe('You started the day at #16 in the Autumn Series. #5 is 12 pts ahead. One gym session does it.');
        expect(msg.data).toMatchObject({ type: 'series_placement', route: '/(tabs)/league?focus=rival' });
        expect(msg.priority).toBe('high');
    });

    it('down: the same, with how to get it back', () => {
        const msg = day({ dir: 'down', rank: 9, was: 7, gap: 6 });
        expect(msg.title).toBe('Down to #9 today');
        expect(msg.body).toBe('You started the day at #7 in the Autumn Series. #8 is 6 pts ahead. One run gets it back.');
    });

    it('your first points of the round', () => {
        const msg = day({ dir: 'up', rank: 238, was: null, gap: 2 });
        expect(msg.title).toBe('Up to #238 today');
        expect(msg.body).toBe('Your first points in the Autumn Series. #237 is 2 pts ahead. One run does it.');
    });

    it('into and out of the prize places', () => {
        const into = day({ dir: 'up', rank: 3, was: 7, milestone: 'prize', gap: 5 });
        expect(into.title).toBe('In the prize places: #3');
        expect(into.body).toBe('You started the day at #7 in the Autumn Series. #2 is 5 pts ahead. One run does it.');
        const out = day({ dir: 'down', rank: 4, was: 3, milestone: 'out_of_prizes', gap: 18 });
        expect(out.title).toBe('Out of the prize places: #4');
        expect(out.body).toBe('You started the day at #3 in the Autumn Series. #3 is 18 pts ahead. One gym session gets it back.');
    });

    it('taking the lead, by how much or level on points', () => {
        const lead = day({ dir: 'up', rank: 1, was: 2, milestone: 'lead', gap: 20 });
        expect(lead.title).toBe("You're #1 tonight");
        expect(lead.body).toBe('You took the lead in the Autumn Series today, 20 pts clear of #2. One session tomorrow keeps you there.');
        expect(day({ dir: 'up', rank: 1, was: 2, milestone: 'lead', gap: 0 }).body)
            .toBe('You took the lead in the Autumn Series today, level on points with #2. One session tomorrow keeps you there.');
    });

    it('losing the lead', () => {
        const msg = day({ dir: 'down', rank: 2, was: 1, milestone: 'lost_lead', gap: 34 });
        expect(msg.title).toBe('You lost the lead today');
        expect(msg.body).toBe("You're #2 in the Autumn Series, 34 pts behind #1. About 3 sessions get it back.");
    });

    it('never says 0 pts to the place above, and says "the Series" with no season name', () => {
        expect(buildMessage('series_placement', { dir: 'up', rank: 4, was: 6, gap: 0 }, 'en').body)
            .toBe('You started the day at #6 in the Series. #3 is 1 pts ahead. One run does it.');
    });

    it('speaks Spanish and French', () => {
        expect(day({ dir: 'up', rank: 6, was: 16, gap: 8 }, 'es').title).toBe('Subes al n.º 6 hoy');
        expect(day({ dir: 'up', rank: 6, was: 16, gap: 8 }, 'es').body)
            .toBe('Empezaste el día en el n.º 16 de la Autumn Series. El n.º 5 va 8 pts por delante. Con una carrera basta.');
        expect(day({ dir: 'down', rank: 9, was: 7, gap: 8 }, 'es').title).toBe('Bajas al n.º 9 hoy');
        expect(day({ dir: 'up', rank: 1, was: 2, milestone: 'lead', gap: 9 }, 'es').title).toBe('Esta noche vas en cabeza');
        expect(day({ dir: 'down', rank: 9, was: 7, gap: 8 }, 'fr').title).toBe('Tu recules au n° 9 aujourd’hui');
        expect(day({ dir: 'up', rank: 6, was: 16, gap: 8 }, 'fr').body)
            .toBe('Tu as commencé la journée n° 16 au classement Autumn Series. Le n° 5 a 8 pts d’avance. Une course suffit.');
        expect(day({ dir: 'down', rank: 2, was: 1, milestone: 'lost_lead', gap: 8 }, 'fr').title).toBe('Tu n’es plus en tête');
        expect(day({ dir: 'up', rank: 3, was: 7, milestone: 'prize', gap: 8 }, 'fr').title).toBe('Dans les places primées\u00a0: n° 3');
    });
});
