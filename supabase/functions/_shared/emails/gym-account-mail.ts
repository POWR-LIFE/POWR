// The gym's own account with POWR, told by email at the moments it changes:
//   welcome          someone joined the team (owner: the first jobs; staff:
//                    what the portal is for)
//   invite_reminder  a setup link nobody has used after 5 days
//   trial_ending     14 and 3 days before the free trial ends (owners)
//   trial_ended      once it has (owners)
//   package_changed  POWR set the package in /admin/gyms (owners)
// Sent by send-gym-email. Facts come from get_gym_mail_context() and
// get_gym_lifecycle_mail(); this file is only the words. Transactional: no
// unsubscribe link, like the rest of the team's mail.

import { emailShell } from "./layout.ts";
import { fmtDay, PORTAL_URL } from "./gym-weekly-recap.ts";
import { ctaRow, gold, heroRow, type Item, listSection, listText, noteRow, TEXT_SIGNOFF } from "./gym-mail-parts.ts";
import {
  ALWAYS_ON,
  FEATURE_WORDS,
  featuresAt,
  featuresLost,
  knownFeatures,
  packageLabel,
  packageLevel,
} from "../gymPackageWords.ts";

type Rendered = { subject: string; html: string; text: string };

const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function featureItems(keys: readonly string[]): Item[] {
  return knownFeatures(keys).map((f) => ({ title: FEATURE_WORDS[f].name, line: FEATURE_WORDS[f].line }));
}

// ── welcome ───────────────────────────────────────────────────────────────

export interface GymWelcomeData {
  gymName: string;
  role: "owner" | "staff";
  tz: string;
  /** While the free trial runs; null after it, or when there is none. */
  trialEndsAt?: string | null;
  /**
   * The members' notice (push gym_on_powr). sentAt null = still to go (it
   * sends between 10:00 and 20:00, half an hour after the portal goes on).
   * Leave the whole thing null to say nothing about it.
   */
  notice?: { sentAt: string | null; count: number | null } | null;
  portalUrl?: string;
}

export function gymWelcomeEmail(data: GymWelcomeData): Rendered {
  const gym = oneLine(data.gymName);
  const url = data.portalUrl ?? PORTAL_URL;
  const owner = data.role === "owner";

  const steps: Item[] = owner
    ? [
      { title: "Put your board on the TV", line: "A live weekly leaderboard of who's training at your gym, and Gym Clash against the gyms near you. The links are under Screens.", href: `${url}/screens` },
      { title: "Print the join poster", line: "A QR code for the front desk and the changing rooms. It opens your gym in the POWR app.", href: `${url}/poster` },
      { title: "Add your logo and a photo", line: "It's how your gym looks in the app. Tap them on the Overview to change them.", href: `${url}#app-cover` },
      { title: "Bring your team in", line: "Give the people who run the floor their own login, under Settings.", href: `${url}/settings#team` },
    ]
    : [
      { title: "See who's in this week", line: "The Overview has this week's sessions, the top of your board and who's new.", href: url },
      { title: "Run the screens", line: "Screens has the links for the TV: your gym's board and Gym Clash.", href: `${url}/screens` },
      { title: "On event nights", line: "Open the event on your phone to see who's in and to hand over the prizes.", href: `${url}/events` },
    ];

  const subject = owner ? `Welcome to POWR, ${gym}` : `You're on the team at ${gym}`;
  const headingHtml = owner ? `You're <span style="white-space:nowrap;">${gold("in.")}</span>` : `You're on<br class="br-d"> the ${gold("team.")}`;
  const headingText = owner ? "You're in." : "You're on the team.";
  const body = owner
    ? `${gym}'s portal is ready. Here's what to do first, in the order that gets your members checking in.`
    : `You can now use ${gym}'s portal on POWR: the screens, who's training this week, and your events.`;
  const preheader = owner
    ? "Board on the TV, poster by the door, logo in the app. Here's the order to do it in."
    : `Your login for ${gym}'s portal works now.`;

  let rows = heroRow(`${gym} · Gym portal`, headingHtml, body);
  rows += listSection(owner ? "Your first week" : "What it's for", steps, "steps");
  const text: string[] = [`${gym} · Gym portal`, "", headingText, "", body, ...listText(owner ? "Your first week" : "What it's for", steps, "steps")];

  // Owners only: the members' notice and the trial.
  if (owner && data.notice) {
    const { sentAt, count } = data.notice;
    let line: string | null = null;
    if (!sentAt) {
      line = `POWR is about to let the people who train at ${gym} know you're on POWR, with a notification on their phone between 10am and 8pm. Every Monday your recap shows how many of them have been back since.`;
    } else if ((count ?? 0) > 0) {
      line = `On ${fmtDay(sentAt, data.tz)} POWR let ${plural(count ?? 0, "person", "people")} who train at ${gym} know you're on POWR. Every Monday your recap shows how many of them have been back since.`;
    }
    if (line) {
      rows += noteRow("Your members", line);
      text.push("", "YOUR MEMBERS", line);
    }
  }
  if (owner && data.trialEndsAt) {
    const line = `Everything in the portal is switched on until ${fmtDay(data.trialEndsAt, data.tz)}, the end of your free trial. We'll write before then.`;
    rows += noteRow("Your free trial", line);
    text.push("", "YOUR FREE TRIAL", line);
  }

  rows += ctaRow(owner ? "Open your portal" : "Open the portal", url, "Questions? Reply to this email and a person at POWR will answer.");
  text.push("", `Open the portal: ${url}`, "", "Questions? Reply to this email and a person at POWR will answer.", ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader, rows, unsubscribe: false }),
    text: text.join("\n"),
  };
}

// ── invite_reminder ───────────────────────────────────────────────────────

export interface GymInviteReminderData {
  gymName: string;
  role: "owner" | "staff";
  tz: string;
  /** The reminder's own link, /venue/setup/{token}. The first one still works too. */
  setupUrl: string;
  invitedAt: string;
  expiresAt: string;
}

export function gymInviteReminderEmail(data: GymInviteReminderData): Rendered {
  const gym = oneLine(data.gymName);
  const owner = data.role === "owner";
  const subject = owner ? `Your POWR portal for ${gym} is waiting` : `Your login for ${gym} on POWR is waiting`;
  const body = `You were invited to ${gym}'s portal on POWR on ${fmtDay(data.invitedAt, data.tz)}, and the link hasn't been used yet. This one works too, once, until ${fmtDay(data.expiresAt, data.tz)}.`;
  const what = owner
    ? "Your gym's board on the TV, Gym Clash against the gyms near you, and who's training, week by week."
    : `${gym}'s screens, who's training this week, and your events.`;

  const rows = heroRow(`${gym} · Gym portal`, `Still waiting<br class="br-d"> for ${gold("you.")}`, body)
    + noteRow("What's inside", what)
    + ctaRow("Set up your login", data.setupUrl, "Not the right person? Reply to this email and we'll sort it out.");

  const text = [
    `${gym} · Gym portal`, "", "Still waiting for you.", "", body, "", "WHAT'S INSIDE", what, "",
    `Set up your login: ${data.setupUrl}`, "", "Not the right person? Reply to this email and we'll sort it out.", ...TEXT_SIGNOFF,
  ];
  return {
    subject,
    html: emailShell({ title: subject, preheader: `The link works once, until ${fmtDay(data.expiresAt, data.tz)}.`, rows, unsubscribe: false }),
    text: text.join("\n"),
  };
}

// ── trial_ending / trial_ended ────────────────────────────────────────────

export interface GymTrialData {
  kind: "trial_ending" | "trial_ended";
  gymName: string;
  tz: string;
  trialEndsAt: string;
  /** Whole days left on the gym's calendar (trial_ending). */
  daysLeft: number;
  /** The package the gym drops to. */
  package: string;
  /** _gym_features keys the trial has and the package doesn't. */
  lost: string[];
  portalUrl?: string;
}

export function gymTrialEmail(data: GymTrialData): Rendered {
  const gym = oneLine(data.gymName);
  const url = data.portalUrl ?? PORTAL_URL;
  const pkg = packageLabel(data.package);
  const onPkg = data.package === "clash" ? "Clash, the free one" : pkg;
  const end = fmtDay(data.trialEndsAt, data.tz);
  const items = featureItems(data.lost);
  const ended = data.kind === "trial_ended";
  const days = Math.max(1, Math.round(data.daysLeft));

  const subject = ended
    ? `${gym}: your free trial has ended`
    : days <= 3 ? `${gym}: ${plural(days, "day")} left on your free trial` : `${gym}: your free trial ends ${end}`;
  const headingHtml = ended ? `Your trial<br class="br-d"> has ${gold("ended.")}` : `${n(days)} ${days === 1 ? "day" : "days"} ${gold("left.")}`;
  const headingText = ended ? "Your trial has ended." : `${plural(days, "day")} left.`;
  const body = ended
    ? `${gym} is now on ${onPkg}. These are switched off until you pick a package:`
    : `Your free trial ends on ${end}. Unless you pick a package, ${gym} moves to ${onPkg}, and these switch off:`;
  const preheader = ended
    ? `${gym} is on ${pkg}. Pick a package to switch the rest back on.`
    : `After ${end}, ${gym} stays on ${pkg} unless you pick a package.`;
  const carryOn = `${ALWAYS_ON} carry on, whatever you pick. Anything already running finishes: an event that's live when the trial ends still reveals its winners.`;

  const rows = heroRow(`${gym} · Free trial`, headingHtml, body)
    + listSection(ended ? "Switched off" : "Switches off", items, "off")
    + noteRow("Carries on", carryOn)
    + ctaRow("Choose a package", `${url}/package`, "Reply to this email if you'd like to talk it through first.");

  const text = [
    `${gym} · Free trial`, "", headingText, "", body,
    ...listText(ended ? "Switched off" : "Switches off", items, "off"),
    "", "CARRIES ON", carryOn, "", `Choose a package: ${url}/package`, "",
    "Reply to this email if you'd like to talk it through first.", ...TEXT_SIGNOFF,
  ];
  return {
    subject,
    html: emailShell({ title: subject, preheader, rows, unsubscribe: false }),
    text: text.join("\n"),
  };
}

// ── package_changed ───────────────────────────────────────────────────────

export interface GymPackageData {
  gymName: string;
  tz: string;
  from: string;
  to: string;
  billing?: string | null;
  /** The free trial still runs: everything stays on until it ends. */
  onTrial: boolean;
  trialEndsAt?: string | null;
  portalUrl?: string;
}

export function gymPackageEmail(data: GymPackageData): Rendered {
  const gym = oneLine(data.gymName);
  const url = data.portalUrl ?? PORTAL_URL;
  const label = packageLabel(data.to);
  const fromLevel = packageLevel(data.from);
  const toLevel = packageLevel(data.to);
  const founding = data.to === "founding";
  const down = toLevel < fromLevel;
  const billed = data.to !== "clash" && data.billing ? `, billed ${data.billing === "annual" ? "yearly" : "monthly"}` : "";
  const trialEnd = data.onTrial && data.trialEndsAt ? fmtDay(data.trialEndsAt, data.tz) : null;

  const subject = founding ? `${gym} is a Founding Pro gym` : `${gym} is on ${label}`;
  const headingHtml = founding ? `Welcome, founding<br class="br-d"> ${gold("gym.")}` : `You're on<br class="br-d"> ${gold(`${label}.`)}`;
  const headingText = founding ? "Welcome, founding gym." : `You're on ${label}.`;

  let body = `POWR has moved ${gym} to ${label}${billed}.`;
  if (down) {
    body += trialEnd ? ` Your free trial keeps everything switched on until ${trialEnd}.` : " These are switched off now:";
  } else if (trialEnd) {
    body += ` Your free trial still runs until ${trialEnd}; after it, you keep everything below.`;
  }

  let items: Item[];
  let listLabel: string;
  let marker: "on" | "off";
  if (down) {
    items = trialEnd ? [] : featureItems(featuresLost(fromLevel, toLevel));
    listLabel = "Switched off";
    marker = "off";
  } else {
    items = featureItems(featuresAt(toLevel));
    if (toLevel >= 2) items.push({ title: "Clash Nights", line: "Four a year, one a quarter. POWR brings the DJ, the photographer and partner prizes. Book your dates in the portal.", href: `${url}/clash-nights` });
    if (founding) {
      items.push({ title: "Founding gym", line: "Your price is locked when you renew, and Gym Clash shows your gym as a founding gym." });
    }
    listLabel = "Yours now";
    marker = "on";
  }
  const preheader = down ? `${gym} is on ${label}. Your board and Gym Clash carry on.` : `${label}${billed}. Here's what it switches on.`;

  let rows = heroRow(`${gym} · Package`, headingHtml, body) + listSection(listLabel, items, marker);
  const text = [`${gym} · Package`, "", headingText, "", body, ...listText(listLabel, items, marker)];
  if (down) {
    const carry = `${ALWAYS_ON} carry on.`;
    rows += noteRow("Carries on", carry);
    text.push("", "CARRIES ON", carry);
  }
  rows += ctaRow("See your package", `${url}/package`, "Questions about billing? Reply to this email.");
  text.push("", `See your package: ${url}/package`, "", "Questions about billing? Reply to this email.", ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader, rows, unsubscribe: false }),
    text: text.join("\n"),
  };
}

