// The gym's own account with POWR, told by email at the moments it changes:
//   welcome          someone joined the team (owner: the first jobs; staff:
//                    what the portal is for)
//   invite_reminder  a setup link nobody has used after 5 days
//   trial_ending     14 and 3 days before the free trial ends (owners)
//   trial_ended      once it has (owners)
//   package_changed  POWR set the package in /admin/gyms (owners)
// Sent by send-gym-email. Facts come from get_gym_mail_context() and
// get_gym_lifecycle_mail(); this file is only the words, in the reader's
// language (tBusiness "gym.*", last parameter). Package names stay as they
// are. Transactional: no unsubscribe link, like the rest of the team's mail.

import { tBusiness } from "../i18n/index.ts";
import { emailShell, esc } from "./layout.ts";
import { PORTAL_URL } from "./gym-weekly-recap.ts";
import {
  ctaRow,
  fmtCount,
  fmtDay,
  HTML_MARKUP,
  heroRow,
  type Item,
  labelValue,
  listSection,
  listText,
  noteRow,
  TEXT_SIGNOFF,
} from "./gym-mail-parts.ts";
import {
  alwaysOn,
  featuresAt,
  featuresLost,
  featureWords,
  knownFeatures,
  packageLabel,
  packageLevel,
} from "../gymPackageWords.ts";

type Rendered = { subject: string; html: string; text: string };

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function featureItems(keys: readonly string[], lang = "en"): Item[] {
  return knownFeatures(keys).map((f) => {
    const words = featureWords(f, lang);
    return { title: words.name, line: words.line };
  });
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

export function gymWelcomeEmail(data: GymWelcomeData, lang = "en"): Rendered {
  const gym = oneLine(data.gymName);
  const url = data.portalUrl ?? PORTAL_URL;
  const owner = data.role === "owner";

  const steps: Item[] = owner
    ? [
      { title: tBusiness(lang, "gym.welcome.steps.board.title"), line: tBusiness(lang, "gym.welcome.steps.board.line"), href: `${url}/screens` },
      { title: tBusiness(lang, "gym.welcome.steps.poster.title"), line: tBusiness(lang, "gym.welcome.steps.poster.line"), href: `${url}/poster` },
      { title: tBusiness(lang, "gym.welcome.steps.logo.title"), line: tBusiness(lang, "gym.welcome.steps.logo.line"), href: `${url}#app-cover` },
      { title: tBusiness(lang, "gym.welcome.steps.team.title"), line: tBusiness(lang, "gym.welcome.steps.team.line"), href: `${url}/settings#team` },
    ]
    : [
      { title: tBusiness(lang, "gym.welcome.staffSteps.week.title"), line: tBusiness(lang, "gym.welcome.staffSteps.week.line"), href: url },
      { title: tBusiness(lang, "gym.welcome.staffSteps.screens.title"), line: tBusiness(lang, "gym.welcome.staffSteps.screens.line"), href: `${url}/screens` },
      { title: tBusiness(lang, "gym.welcome.staffSteps.events.title"), line: tBusiness(lang, "gym.welcome.staffSteps.events.line"), href: `${url}/events` },
    ];

  // The owner's "in." stays on one line with the word before it.
  const ownerMarkup = { ...HTML_MARKUP, gold: `<span style="white-space:nowrap;">${HTML_MARKUP.gold}`, end: `${HTML_MARKUP.end}</span>` };
  const subject = owner ? tBusiness(lang, "gym.welcome.owner.subject", { gym }) : tBusiness(lang, "gym.welcome.staff.subject", { gym });
  const headingHtml = owner ? tBusiness(lang, "gym.welcome.owner.headingHtml", ownerMarkup) : tBusiness(lang, "gym.welcome.staff.headingHtml", HTML_MARKUP);
  const headingText = owner ? tBusiness(lang, "gym.welcome.owner.heading") : tBusiness(lang, "gym.welcome.staff.heading");
  const body = owner ? tBusiness(lang, "gym.welcome.owner.body", { gym }) : tBusiness(lang, "gym.welcome.staff.body", { gym });
  const preheader = owner ? tBusiness(lang, "gym.welcome.owner.preheader") : tBusiness(lang, "gym.welcome.staff.preheader", { gym });
  const eyebrow = tBusiness(lang, "gym.common.portalEyebrow", { gym });
  const listLabel = owner ? tBusiness(lang, "gym.welcome.owner.list") : tBusiness(lang, "gym.welcome.staff.list");

  let rows = heroRow(eyebrow, headingHtml, body);
  rows += listSection(listLabel, steps, "steps");
  const text: string[] = [eyebrow, "", headingText, "", body, ...listText(listLabel, steps, "steps", lang)];

  // Owners only: the members' notice and the trial.
  if (owner && data.notice) {
    const { sentAt, count } = data.notice;
    let line: string | null = null;
    if (!sentAt) {
      line = tBusiness(lang, "gym.welcome.noticeSoon", { gym });
    } else if ((count ?? 0) > 0) {
      line = tBusiness(lang, "gym.welcome.noticeSent", { day: fmtDay(sentAt, data.tz, lang), count: count ?? 0, n: fmtCount(count ?? 0, lang), gym });
    }
    if (line) {
      const label = tBusiness(lang, "gym.welcome.members");
      rows += noteRow(label, line);
      text.push("", label.toUpperCase(), line);
    }
  }
  if (owner && data.trialEndsAt) {
    const line = tBusiness(lang, "gym.welcome.trialLine", { day: fmtDay(data.trialEndsAt, data.tz, lang) });
    const label = tBusiness(lang, "gym.welcome.trial");
    rows += noteRow(label, line);
    text.push("", label.toUpperCase(), line);
  }

  const questions = tBusiness(lang, "gym.welcome.questions");
  rows += ctaRow(esc(owner ? tBusiness(lang, "gym.welcome.owner.cta") : tBusiness(lang, "gym.welcome.staff.cta")), url, questions);
  text.push("", labelValue(tBusiness(lang, "gym.welcome.openThePortal"), url, lang), "", questions, ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader, rows, unsubscribe: false, lang }),
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

export function gymInviteReminderEmail(data: GymInviteReminderData, lang = "en"): Rendered {
  const gym = oneLine(data.gymName);
  const owner = data.role === "owner";
  const subject = owner ? tBusiness(lang, "gym.inviteReminder.subjectOwner", { gym }) : tBusiness(lang, "gym.inviteReminder.subjectStaff", { gym });
  const expires = fmtDay(data.expiresAt, data.tz, lang);
  const body = tBusiness(lang, "gym.inviteReminder.body", { gym, invited: fmtDay(data.invitedAt, data.tz, lang), expires });
  const what = owner ? tBusiness(lang, "gym.inviteReminder.insideOwner") : tBusiness(lang, "gym.inviteReminder.insideStaff", { gym });
  const eyebrow = tBusiness(lang, "gym.common.portalEyebrow", { gym });
  const inside = tBusiness(lang, "gym.inviteReminder.inside");
  const cta = tBusiness(lang, "gym.inviteReminder.cta");
  const notYou = tBusiness(lang, "gym.inviteReminder.notYou");

  const rows = heroRow(eyebrow, tBusiness(lang, "gym.inviteReminder.headingHtml", HTML_MARKUP), body)
    + noteRow(inside, what)
    + ctaRow(esc(cta), data.setupUrl, notYou);

  const text = [
    eyebrow, "", tBusiness(lang, "gym.inviteReminder.heading"), "", body, "", inside.toUpperCase(), what, "",
    labelValue(cta, data.setupUrl, lang), "", notYou, ...TEXT_SIGNOFF,
  ];
  return {
    subject,
    html: emailShell({ title: subject, preheader: tBusiness(lang, "gym.inviteReminder.preheader", { day: expires }), rows, unsubscribe: false, lang }),
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

export function gymTrialEmail(data: GymTrialData, lang = "en"): Rendered {
  const gym = oneLine(data.gymName);
  const url = data.portalUrl ?? PORTAL_URL;
  const pkg = packageLabel(data.package);
  const onPkg = data.package === "clash" ? tBusiness(lang, "gym.trial.clashFree") : pkg;
  const end = fmtDay(data.trialEndsAt, data.tz, lang);
  const items = featureItems(data.lost, lang);
  const ended = data.kind === "trial_ended";
  const days = Math.max(1, Math.round(data.daysLeft));
  const dayVars = { count: days, n: fmtCount(days, lang) };

  const subject = ended
    ? tBusiness(lang, "gym.trial.subjectEnded", { gym })
    : days <= 3 ? tBusiness(lang, "gym.trial.subjectDays", { gym, ...dayVars }) : tBusiness(lang, "gym.trial.subjectEnds", { gym, day: end });
  const headingHtml = ended ? tBusiness(lang, "gym.trial.headingEndedHtml", HTML_MARKUP) : tBusiness(lang, "gym.trial.headingHtml", { ...HTML_MARKUP, ...dayVars });
  const headingText = ended ? tBusiness(lang, "gym.trial.headingEnded") : tBusiness(lang, "gym.trial.heading", dayVars);
  const body = ended
    ? tBusiness(lang, "gym.trial.bodyEnded", { gym, name: onPkg })
    : tBusiness(lang, "gym.trial.body", { day: end, gym, name: onPkg });
  const preheader = ended
    ? tBusiness(lang, "gym.trial.preheaderEnded", { gym, name: pkg })
    : tBusiness(lang, "gym.trial.preheader", { day: end, gym, name: pkg });
  const carryOn = tBusiness(lang, "gym.trial.carryOn", { alwaysOn: alwaysOn(lang) });
  const eyebrow = tBusiness(lang, "gym.trial.eyebrow", { gym });
  const listLabel = ended ? tBusiness(lang, "gym.common.switchedOff") : tBusiness(lang, "gym.trial.switchesOff");
  const carries = tBusiness(lang, "gym.common.carriesOn");
  const cta = tBusiness(lang, "gym.trial.cta");
  const talk = tBusiness(lang, "gym.trial.talk");

  const rows = heroRow(eyebrow, headingHtml, body)
    + listSection(listLabel, items, "off")
    + noteRow(carries, carryOn)
    + ctaRow(esc(cta), `${url}/package`, talk);

  const text = [
    eyebrow, "", headingText, "", body,
    ...listText(listLabel, items, "off", lang),
    "", carries.toUpperCase(), carryOn, "", labelValue(cta, `${url}/package`, lang), "",
    talk, ...TEXT_SIGNOFF,
  ];
  return {
    subject,
    html: emailShell({ title: subject, preheader, rows, unsubscribe: false, lang }),
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

export function gymPackageEmail(data: GymPackageData, lang = "en"): Rendered {
  const gym = oneLine(data.gymName);
  const url = data.portalUrl ?? PORTAL_URL;
  const label = packageLabel(data.to);
  const fromLevel = packageLevel(data.from);
  const toLevel = packageLevel(data.to);
  const founding = data.to === "founding";
  const down = toLevel < fromLevel;
  const billed = data.to !== "clash" && data.billing ? (data.billing === "annual" ? "yearly" : "monthly") : null;
  const trialEnd = data.onTrial && data.trialEndsAt ? fmtDay(data.trialEndsAt, data.tz, lang) : null;

  const subject = founding ? tBusiness(lang, "gym.package.subjectFounding", { gym }) : tBusiness(lang, "gym.package.subject", { gym, name: label });
  const headingHtml = founding
    ? tBusiness(lang, "gym.package.headingFoundingHtml", HTML_MARKUP)
    : tBusiness(lang, "gym.package.headingHtml", { ...HTML_MARKUP, name: esc(label) });
  const headingText = founding ? tBusiness(lang, "gym.package.headingFounding") : tBusiness(lang, "gym.package.heading", { name: label });

  let body = billed === "yearly"
    ? tBusiness(lang, "gym.package.movedYearly", { gym, name: label })
    : billed === "monthly" ? tBusiness(lang, "gym.package.movedMonthly", { gym, name: label }) : tBusiness(lang, "gym.package.moved", { gym, name: label });
  if (down) {
    body += ` ${trialEnd ? tBusiness(lang, "gym.package.downTrial", { day: trialEnd }) : tBusiness(lang, "gym.package.downNow")}`;
  } else if (trialEnd) {
    body += ` ${tBusiness(lang, "gym.package.upTrial", { day: trialEnd })}`;
  }

  let items: Item[];
  let listLabel: string;
  let marker: "on" | "off";
  if (down) {
    items = trialEnd ? [] : featureItems(featuresLost(fromLevel, toLevel), lang);
    listLabel = tBusiness(lang, "gym.common.switchedOff");
    marker = "off";
  } else {
    items = featureItems(featuresAt(toLevel), lang);
    if (toLevel >= 2) items.push({ title: tBusiness(lang, "gym.package.nights.title"), line: tBusiness(lang, "gym.package.nights.line"), href: `${url}/clash-nights` });
    if (founding) {
      items.push({ title: tBusiness(lang, "gym.package.founding.title"), line: tBusiness(lang, "gym.package.founding.line") });
    }
    listLabel = tBusiness(lang, "gym.package.yoursNow");
    marker = "on";
  }
  const preheader = down
    ? tBusiness(lang, "gym.package.preheaderDown", { gym, name: label })
    : billed === "yearly"
      ? tBusiness(lang, "gym.package.preheaderUpYearly", { name: label })
      : billed === "monthly" ? tBusiness(lang, "gym.package.preheaderUpMonthly", { name: label }) : tBusiness(lang, "gym.package.preheaderUp", { name: label });
  const eyebrow = tBusiness(lang, "gym.package.eyebrow", { gym });

  let rows = heroRow(eyebrow, headingHtml, body) + listSection(listLabel, items, marker);
  const text = [eyebrow, "", headingText, "", body, ...listText(listLabel, items, marker, lang)];
  if (down) {
    const carry = tBusiness(lang, "gym.package.carryOn", { alwaysOn: alwaysOn(lang) });
    const carries = tBusiness(lang, "gym.common.carriesOn");
    rows += noteRow(carries, carry);
    text.push("", carries.toUpperCase(), carry);
  }
  const cta = tBusiness(lang, "gym.package.cta");
  const billing = tBusiness(lang, "gym.package.billing");
  rows += ctaRow(esc(cta), `${url}/package`, billing);
  text.push("", labelValue(cta, `${url}/package`, lang), "", billing, ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader, rows, unsubscribe: false, lang }),
    text: text.join("\n"),
  };
}
