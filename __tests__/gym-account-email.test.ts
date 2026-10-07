import {
  featuresAt,
  featuresLost,
  knownFeatures,
  packageLabel,
  packageLevel,
} from '../supabase/functions/_shared/gymPackageWords';
import {
  gymInviteReminderEmail,
  gymPackageEmail,
  gymTrialEmail,
  gymWelcomeEmail,
} from '../supabase/functions/_shared/emails/gym-account-mail';
import {
  clockTime,
  gymClashNightEmail,
  gymSupportReplyEmail,
  splitTopic,
} from '../supabase/functions/_shared/emails/gym-reply-mail';
import { gymWeeklyRecapEmail, noticeLines, type GymWeeklyRecapData } from '../supabase/functions/_shared/emails/gym-weekly-recap';
import {
  sampleClashNight,
  sampleNotice,
  samplePackage,
  sampleSupportReply,
  sampleTrial,
  sampleWelcome,
} from '../supabase/functions/_shared/emails/gym-mail.samples';
import { eventPushCopy } from '../supabase/functions/_shared/eventPushCopy';

const TZ = 'Europe/London';
const NOW = Date.parse('2026-10-07T12:00:00Z');

describe('package words mirror _gym_features', () => {
  it('levels', () => {
    expect([packageLevel('clash'), packageLevel('clash_plus'), packageLevel('pro'), packageLevel('founding'), packageLevel(null)]).toEqual([0, 1, 2, 2, 0]);
    expect(packageLabel('clash_plus')).toBe('Clash+');
    expect(packageLabel('nonsense')).toBe('Clash');
  });
  it('what each level has, and loses', () => {
    expect(featuresAt(0)).toEqual([]);
    expect(featuresAt(1)).toEqual(['events', 'insights']);
    expect(featuresAt(2)).toEqual(['events', 'insights', 'people', 'studio']);
    expect(featuresLost(2, 0)).toEqual(['events', 'insights', 'people', 'studio']);
    expect(featuresLost(2, 1)).toEqual(['people', 'studio']);
    expect(featuresLost(1, 2)).toEqual([]);
  });
  it('keeps the email order and drops keys it does not know', () => {
    expect(knownFeatures(['studio', 'boards', 'events'])).toEqual(['events', 'studio']);
  });
});

describe('welcome', () => {
  it('gives an owner the first week, the members notice and the trial', () => {
    const r = gymWelcomeEmail({ ...sampleWelcome('owner', NOW), gymName: 'Iron <House>' });
    expect(r.subject).toBe('Welcome to POWR, Iron <House>');
    expect(r.html).toContain('Iron &lt;House&gt;');
    expect(r.html).not.toContain('Iron <House>');
    expect(r.text).toContain('Print the join poster');
    expect(r.html).toContain('https://powr.life/venue/poster');
    expect(r.text).toMatch(/let 38 people who train at Iron <House> know/);
    expect(r.text).toContain('YOUR FREE TRIAL');
  });
  it('says the notice is on its way while it is', () => {
    const r = gymWelcomeEmail({ ...sampleWelcome('owner', NOW), notice: { sentAt: null, count: null } });
    expect(r.text).toMatch(/is about to let the people who train at .* know/);
  });
  it('says nothing about a notice that never went', () => {
    const r = gymWelcomeEmail({ ...sampleWelcome('owner', NOW), notice: null, trialEndsAt: null });
    expect(r.text).not.toContain('YOUR MEMBERS');
    expect(r.text).not.toContain('YOUR FREE TRIAL');
  });
  it('keeps staff to what the portal is for', () => {
    const r = gymWelcomeEmail({ ...sampleWelcome('staff', NOW), notice: { sentAt: null, count: null }, trialEndsAt: '2027-01-01T00:00:00Z' });
    expect(r.subject).toBe("You're on the team at POWR Gym Leamington");
    expect(r.text).not.toContain('YOUR MEMBERS');
    expect(r.text).not.toContain('YOUR FREE TRIAL');
    expect(r.text).not.toContain('Bring your team in');
  });
});

describe('invite reminder', () => {
  it('carries the new link and when it runs out', () => {
    const r = gymInviteReminderEmail({
      gymName: 'Stars Gym', role: 'staff', tz: TZ, setupUrl: 'https://powr.life/venue/setup/abc',
      invitedAt: '2026-10-02T09:00:00Z', expiresAt: '2026-10-16T09:00:00Z',
    });
    expect(r.subject).toBe('Your login for Stars Gym on POWR is waiting');
    expect(r.html).toContain('https://powr.life/venue/setup/abc');
    expect(r.text).toContain('until Fri 16 Oct');
  });
});

describe('trial', () => {
  it('14 days out names the date and everything that switches off', () => {
    const r = gymTrialEmail({ ...sampleTrial('trial_ending', 14, NOW) });
    expect(r.subject).toBe('POWR Gym Leamington: your free trial ends Wed 21 Oct');
    for (const name of ['Your own challenges', 'Members and Retention', 'Retention by name', 'Studio and event kits']) {
      expect(r.text).toContain(name);
    }
    expect(r.text).toContain('moves to Clash, the free one');
    expect(r.html).toContain('https://powr.life/venue/package');
  });
  it('3 days and 1 day out count down in the subject', () => {
    expect(gymTrialEmail(sampleTrial('trial_ending', 3, NOW)).subject).toBe('POWR Gym Leamington: 3 days left on your free trial');
    expect(gymTrialEmail(sampleTrial('trial_ending', 1, NOW)).subject).toBe('POWR Gym Leamington: 1 day left on your free trial');
  });
  it('a Clash+ gym only loses the Pro parts', () => {
    const r = gymTrialEmail({ ...sampleTrial('trial_ending', 10, NOW), package: 'clash_plus', lost: ['people', 'studio'] });
    expect(r.text).toContain('moves to Clash+');
    expect(r.text).not.toContain('Your own challenges');
    expect(r.text).toContain('Retention by name');
  });
  it('once ended', () => {
    const r = gymTrialEmail(sampleTrial('trial_ended', 0, NOW));
    expect(r.subject).toBe('POWR Gym Leamington: your free trial has ended');
    expect(r.text).toContain('SWITCHED OFF');
  });
});

describe('package changed', () => {
  it('up to Clash+: what it switches on, and the trial still running', () => {
    const r = gymPackageEmail(samplePackage('clash', 'clash_plus', NOW));
    expect(r.subject).toBe('POWR Gym Leamington is on Clash+');
    expect(r.text).toContain('billed monthly');
    expect(r.text).toContain('+ Your own challenges');
    expect(r.text).toContain('+ Members and Retention');
    expect(r.text).not.toContain('Clash Nights');
    expect(r.text).toMatch(/free trial still runs until/);
  });
  it('Founding Pro gets the nights and the founding lines', () => {
    const r = gymPackageEmail(samplePackage('clash', 'founding', NOW));
    expect(r.subject).toBe('POWR Gym Leamington is a Founding Pro gym');
    expect(r.text).toContain('billed yearly');
    expect(r.text).toContain('Clash Nights');
    expect(r.text).toContain('Founding gym');
  });
  it('down, after the trial: what switched off and what carries on', () => {
    const r = gymPackageEmail({ ...samplePackage('pro', 'clash', NOW), onTrial: false });
    expect(r.text).toContain('- Retention by name');
    expect(r.text).toContain('- Your own challenges');
    expect(r.text).toContain('CARRIES ON');
    expect(r.text).not.toContain('billed');
  });
  it('down, during the trial: nothing switches off yet', () => {
    const r = gymPackageEmail({ ...samplePackage('pro', 'clash', NOW), onTrial: true });
    expect(r.text).toMatch(/keeps everything switched on until/);
    expect(r.text).not.toContain('SWITCHED OFF');
  });
});

describe('support reply', () => {
  it('splits the topic off the message', () => {
    expect(splitTopic('[Screens] The TV is blank')).toEqual({ topic: 'Screens', body: 'The TV is blank' });
    expect(splitTopic('No topic here')).toEqual({ topic: null, body: 'No topic here' });
  });
  it('quotes the answer with its line breaks, escaped', () => {
    const r = gymSupportReplyEmail({ ...sampleSupportReply(), reply: 'Line one <b>\nLine two' });
    expect(r.subject).toBe('Re: The board on our TV stopped updating');
    expect(r.html).toContain('Line one &lt;b&gt;<br>Line two');
    expect(r.text).toContain('YOU ASKED (Screens)');
    expect(r.html).toContain('https://powr.life/venue/settings#help');
  });
  it('says when the answer changed', () => {
    expect(gymSupportReplyEmail(sampleSupportReply(true)).text).toContain('POWR updated its answer.');
  });
});

describe('Clash Night', () => {
  it('reads the start time', () => {
    expect(clockTime('19:00:00')).toBe('7pm');
    expect(clockTime('18:30')).toBe('6:30pm');
    expect(clockTime('00:00')).toBe('12am');
    expect(clockTime(null)).toBe('');
  });
  it('confirmed', () => {
    const r = gymClashNightEmail({ ...sampleClashNight('confirmed', NOW), nightDate: '2026-11-20' });
    expect(r.subject).toBe('Clash Night confirmed: Fri 20 Nov');
    expect(r.text).toContain('from 7pm');
    expect(r.text).toContain('BEFORE THE NIGHT');
  });
  it('declined names the backup too', () => {
    const r = gymClashNightEmail({ ...sampleClashNight('declined', NOW), nightDate: '2026-11-20', backupDate: '2026-11-27' });
    expect(r.subject).toBe('Clash Night on Fri 20 Nov: pick another date');
    expect(r.text).toContain("can't do Fri 20 Nov or Fri 27 Nov");
  });
  it('a confirmed night declined later was called off', () => {
    const r = gymClashNightEmail({ ...sampleClashNight('called_off', NOW), nightDate: '2026-11-20' });
    expect(r.subject).toBe('Clash Night on Fri 20 Nov is off');
  });
});

describe('Monday recap: since we told your members', () => {
  const base: GymWeeklyRecapData = {
    gymName: 'Stars Gym', weekLabel: '28 Sept – 4 Oct', tz: TZ,
    sessions: 40, prevSessions: 30, athletes: 12, prevAthletes: 10, minutes: 2000,
    newFaces: 1, members: 30, top: [], busiest: null, quiet: null, events: [],
  };
  it('counts who has been back, of those who were away', () => {
    const l = noticeLines(sampleNotice(NOW), TZ, 'Stars Gym');
    expect(l.big).toBe(6);
    expect(l.lead).toMatch(/^Of the 14 who were away when POWR told 38 people you're on POWR, on /);
    expect(l.lines).toEqual([
      '4 of the 9 who had fallen behind their usual visits',
      "2 of the 5 who hadn't been in for six months or more",
      '2 of them came back last week',
    ]);
  });
  it('says so when everyone told was already coming in', () => {
    const l = noticeLines({ ...sampleNotice(NOW), away: 0, unseen: 0, back: 0, unseenBack: 0, backIn: 0, unseenBackIn: 0 }, TZ, 'Stars Gym');
    expect(l.big).toBeNull();
    expect(l.lead).toMatch(/Every one of them was already coming in/);
  });
  it('shows the section only when there was a notice', () => {
    expect(gymWeeklyRecapEmail(base).text).not.toContain('SINCE WE TOLD YOUR MEMBERS');
    const r = gymWeeklyRecapEmail({ ...base, notice: sampleNotice(NOW) });
    expect(r.text).toContain('SINCE WE TOLD YOUR MEMBERS');
    expect(r.text).toContain('6 back through the door');
  });
});

describe('gym_on_powr push', () => {
  it('names the gym and the switch', () => {
    const c = eventPushCopy('gym_on_powr', { gym_name: 'Stars Gym' });
    expect(c.title).toBe('Stars Gym is on POWR');
    expect(c.body).toContain('Settings, then Privacy');
    expect(c.body.length).toBeLessThanOrEqual(178);
  });
  it('without a name', () => {
    expect(eventPushCopy('gym_on_powr', {}).title).toBe('Your gym is on POWR');
  });
});
