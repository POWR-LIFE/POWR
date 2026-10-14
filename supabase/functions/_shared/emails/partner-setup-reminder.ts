// The weekly "finish setting up" email to a reward brand. Sent by
// send-partner-setup-reminder while the brand's side of getting a reward live
// is unfinished: the first 5 days after it started waiting, then every 7 days.
// Facts come from get_partner_setup_reminder_candidates(); this file is only
// the words. Transactional, like the rest of the partner mail: no unsubscribe
// link, and a reply reaches a person.
//
// The body is the brand's own checklist: what's done, the one thing to do
// next (the button), what follows, and our part at the end.
//
// Words: _shared/i18n/brand/<lang>.ts (brand.setup.*), in the language the
// sender picked for each group of recipients.

import { formatLocale, tBusiness } from "../i18n/index.ts";
import { emailShell, esc, FONT, GOLD } from "./layout.ts";
import { brandLogoImg, type LogoSize } from "./brand-logo.ts";
import { ctaRow, noteRow, TEXT_SIGNOFF } from "./gym-mail-parts.ts";

export type SetupStep = "login" | "submit" | "choose" | "connect";
export type DeliveryMethod = "api" | "shopify" | "manual";

export interface PartnerSetupReminderData {
  brandName: string;
  /** The first step the brand hasn't done. */
  step: SetupStep;
  /** From the brand's submission ("Cara James" → "Hi Cara,"). */
  contactName?: string | null;
  /** The brand's newest reward, once one is approved. */
  rewardTitle?: string | null;
  /** The brand's logo (rewards.image_url), above the heading on the black hero. */
  logoUrl?: string | null;
  /** Its pixel size (measureLogo), so every client draws it at the right size. */
  logoSize?: LogoSize | null;
  /** rewards.brand_color, e.g. "#c6a13e": the dot by the eyebrow. Everything else stays POWR gold. */
  brandColor?: string | null;
  /** How codes reach members, once chosen. */
  method?: DeliveryMethod | null;
  /** The login step's setup link token (/partner/setup/{token}). */
  inviteToken?: string | null;
  /** The portal's logins, so the email can say which address to sign in with. */
  loginEmails?: string[] | null;
  /** Newest unsubmitted draft. */
  draftTitle?: string | null;
  /** That draft edits a listing that already exists (vs a new reward). */
  draftIsEdit?: boolean | null;
  siteUrl?: string;
}

type Rendered = { subject: string; html: string; text: string };

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();

/** Where each delivery method's button goes. */
const METHOD_PATH: Record<DeliveryMethod, string> = {
  manual: "/partner/promo-codes",
  shopify: "/partner/integration/shopify",
  api: "/partner/integration/api",
};

interface MethodWords { name: string; done: string; title: string; todo: string; cta: string }

/** The words for the brand's chosen method, or null when there is none (or one this email doesn't know). */
function methodWords(method: DeliveryMethod | null | undefined, lang: string): MethodWords | null {
  switch (method) {
    case "manual":
      return {
        name: tBusiness(lang, "brand.setup.methods.manual.name"),
        done: tBusiness(lang, "brand.setup.methods.manual.done"),
        title: tBusiness(lang, "brand.setup.methods.manual.title"),
        todo: tBusiness(lang, "brand.setup.methods.manual.todo"),
        cta: tBusiness(lang, "brand.setup.methods.manual.cta"),
      };
    case "shopify":
      return {
        name: tBusiness(lang, "brand.setup.methods.shopify.name"),
        done: tBusiness(lang, "brand.setup.methods.shopify.done"),
        title: tBusiness(lang, "brand.setup.methods.shopify.title"),
        todo: tBusiness(lang, "brand.setup.methods.shopify.todo"),
        cta: tBusiness(lang, "brand.setup.methods.shopify.cta"),
      };
    case "api":
      return {
        name: tBusiness(lang, "brand.setup.methods.api.name"),
        done: tBusiness(lang, "brand.setup.methods.api.done"),
        title: tBusiness(lang, "brand.setup.methods.api.title"),
        todo: tBusiness(lang, "brand.setup.methods.api.todo"),
        cta: tBusiness(lang, "brand.setup.methods.api.cta"),
      };
    default:
      return null;
  }
}

interface Row {
  title: string;
  line: string;
  state: "done" | "next" | "later" | "ours";
}

const ORDER: SetupStep[] = ["login", "submit", "choose", "connect"];

/** "Two steps from live." — the heading, HTML and text. Only 1–3 occur (submit, choose, connect). */
function fromLive(n: number, lang: string, em: Record<string, string>): { html: string; text: string } {
  switch (Math.min(Math.max(n, 1), 4)) {
    case 1:
      return { html: tBusiness(lang, "brand.setup.fromLive.oneHtml", em), text: tBusiness(lang, "brand.setup.fromLive.one") };
    case 2:
      return { html: tBusiness(lang, "brand.setup.fromLive.twoHtml", em), text: tBusiness(lang, "brand.setup.fromLive.two") };
    case 3:
      return { html: tBusiness(lang, "brand.setup.fromLive.threeHtml", em), text: tBusiness(lang, "brand.setup.fromLive.three") };
    default:
      return { html: tBusiness(lang, "brand.setup.fromLive.fourHtml", em), text: tBusiness(lang, "brand.setup.fromLive.four") };
  }
}

function checklist(d: PartnerSetupReminderData, lang: string): Row[] {
  const at = ORDER.indexOf(d.step);
  const state = (s: SetupStep): Row["state"] => {
    const i = ORDER.indexOf(s);
    return i < at ? "done" : i === at ? "next" : "later";
  };
  const reward = d.rewardTitle ? oneLine(d.rewardTitle) : null;
  const method = methodWords(d.method, lang);
  const draft = d.draftTitle ? oneLine(d.draftTitle) : null;

  const rows: Row[] = [
    {
      title: tBusiness(lang, "brand.setup.rows.login"),
      line: state("login") === "done" ? tBusiness(lang, "brand.setup.rows.loginDone") : tBusiness(lang, "brand.setup.rows.loginTodo"),
      state: state("login"),
    },
  ];
  // A brand that was approved before it had a login has nothing to submit.
  if (!(d.step === "login" && reward)) {
    rows.push({
      title: tBusiness(lang, "brand.setup.rows.submit"),
      line: state("submit") === "done"
        ? (reward ? tBusiness(lang, "brand.setup.rows.submitApproved", { reward }) : tBusiness(lang, "brand.setup.rows.submitApprovedUntitled"))
        : draft && !d.draftIsEdit
          ? tBusiness(lang, "brand.setup.rows.submitDraft", { draft })
          : tBusiness(lang, "brand.setup.rows.submitTodo"),
      state: state("submit"),
    });
  }
  rows.push({
    title: tBusiness(lang, "brand.setup.rows.choose"),
    line: state("choose") === "done" && method
      ? method.done
      : tBusiness(lang, "brand.setup.rows.chooseTodo"),
    state: state("choose"),
  });
  rows.push({
    title: method ? method.title : tBusiness(lang, "brand.setup.rows.flow"),
    line: method ? method.todo : tBusiness(lang, "brand.setup.rows.flowTodo"),
    state: state("connect"),
  });
  rows.push({
    title: tBusiness(lang, "brand.setup.rows.live"),
    line: tBusiness(lang, "brand.setup.rows.liveLine"),
    state: "ours",
  });
  return rows;
}

function checklistSection(label: string, rows: Row[], lang: string): string {
  const marker = (r: Row, n: number) => {
    const base = "display:inline-block;width:22px;height:22px;border-radius:50%;text-align:center;font-size:11px;font-weight:600;line-height:22px;";
    if (r.state === "done") return `<span style="${base}background-color:#111111;border:1px solid #222222;color:${GOLD};font-family:${FONT};">&#10003;</span>`;
    if (r.state === "next") return `<span style="${base}background-color:${GOLD};border:1px solid ${GOLD};color:#080808;font-family:${FONT};">${n}</span>`;
    return `<span style="${base}background-color:#080808;border:1px solid #222222;color:#777777;font-family:${FONT};">${n}</span>`;
  };
  const titleColor = (r: Row) => r.state === "done" ? "#777777" : r.state === "next" ? "#F2F2F2" : "#bbbbbb";
  const tag = (r: Row) => r.state === "next"
    ? ` <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};font-family:${FONT};">&nbsp;${esc(tBusiness(lang, "brand.setup.next"))}</span>`
    : "";
  const body = rows.map((r, i) => `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${i < rows.length - 1 ? ' style="border-bottom:1px solid #161616;"' : ""}>
              <tr>
                <td style="padding:13px 0;width:30px;vertical-align:top;">${marker(r, i + 1)}</td>
                <td style="padding:13px 0 13px 12px;vertical-align:top;">
                  <span style="display:block;font-size:14px;font-weight:${r.state === "next" ? 600 : 500};color:${titleColor(r)};font-family:${FONT};">${esc(r.title)}${tag(r)}</span>
                  <span style="display:block;margin-top:3px;font-size:12px;font-weight:300;color:${r.state === "done" ? "#666666" : "#999999"};line-height:1.55;font-family:${FONT};">${esc(r.line)}</span>
                </td>
              </tr>
            </table>`).join("");
  return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">${esc(label)}</span>${body}
          </td>
        </tr>`;
}

function heroRow(d: PartnerSetupReminderData, headingHtml: string, body: string, lang: string): string {
  const logo = brandLogoImg(d.logoUrl, d.brandName, d.logoSize);
  const logoRow = logo
    ? `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 26px;">
              <tr><td align="center">${logo}</td></tr>
            </table>`
    : "";
  const dot = /^#[0-9a-f]{6}$/i.test(d.brandColor ?? "") ? d.brandColor! : GOLD;
  return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">${logoRow}
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};"><span style="color:${dot};">&#9679;</span>&nbsp; ${esc(oneLine(d.brandName))} &middot; ${esc(tBusiness(lang, "brand.setup.partnerPortal"))}</p>
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(body)}</p>
          </td>
        </tr>`;
}

/** `lang`: the language of this group of recipients (send-partner-setup-reminder splits a brand's people by it). */
export function partnerSetupReminderEmail(d: PartnerSetupReminderData, lang: string = "en"): Rendered {
  const site = d.siteUrl ?? "https://powr.life";
  const brand = oneLine(d.brandName);
  const reward = d.rewardTitle ? oneLine(d.rewardTitle) : null;
  const method = methodWords(d.method, lang);
  const firstName = oneLine(d.contactName ?? "").split(" ")[0] ?? "";
  // Without a name the body opens the sentence, so its first letter is a
  // capital — a reward title's included, as English always did.
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  // Markup for the headings: a desktop-only break, then the gold words.
  const em = { br: '<br class="br-d">', em: `<em style="font-style:italic;color:${GOLD};">`, end: "</em>" };
  // "Your reward" opens a subject; "your reward" sits inside a body.
  const rewardAtStart = reward ?? tBusiness(lang, "brand.setup.yourReward");
  const rewardInside = reward ?? tBusiness(lang, "brand.setup.yourRewardLower");

  // Steps still on the brand's side, counting this one.
  const left = ORDER.length - ORDER.indexOf(d.step) - (d.step === "login" && reward ? 1 : 0);

  let subject: string;
  let preheader: string;
  let headingHtml: string;
  let headingText: string;
  let body: string;
  let cta: string;
  let href: string;

  switch (d.step) {
    case "login":
      subject = reward
        ? tBusiness(lang, "brand.setup.login.subjectApproved", { reward, brand })
        : tBusiness(lang, "brand.setup.login.subject", { brand });
      preheader = tBusiness(lang, "brand.setup.login.preheader");
      headingHtml = tBusiness(lang, "brand.setup.login.headingHtml", em);
      headingText = tBusiness(lang, "brand.setup.login.heading");
      body = reward
        ? (firstName
          ? tBusiness(lang, "brand.setup.login.bodyApprovedNamed", { name: firstName, reward, brand })
          : cap(tBusiness(lang, "brand.setup.login.bodyApproved", { reward, brand })))
        : (firstName
          ? tBusiness(lang, "brand.setup.login.bodyNamed", { name: firstName, brand })
          : cap(tBusiness(lang, "brand.setup.login.body", { brand })));
      cta = tBusiness(lang, "brand.setup.login.cta");
      href = d.inviteToken ? `${site}/partner/setup/${d.inviteToken}` : `${site}/partner/login`;
      break;
    case "submit": {
      subject = tBusiness(lang, "brand.setup.submit.subject", { brand });
      preheader = tBusiness(lang, "brand.setup.submit.preheader");
      ({ html: headingHtml, text: headingText } = fromLive(left, lang, em));
      body = firstName
        ? tBusiness(lang, "brand.setup.submit.bodyNamed", { name: firstName, brand })
        : cap(tBusiness(lang, "brand.setup.submit.body", { brand }));
      cta = d.draftTitle && !d.draftIsEdit ? tBusiness(lang, "brand.setup.submit.ctaDraft") : tBusiness(lang, "brand.setup.submit.cta");
      href = `${site}/partner/rewards`;
      break;
    }
    case "choose":
      subject = tBusiness(lang, "brand.setup.choose.subject", { reward: rewardAtStart });
      preheader = tBusiness(lang, "brand.setup.choose.preheader");
      ({ html: headingHtml, text: headingText } = fromLive(left, lang, em));
      body = firstName
        ? tBusiness(lang, "brand.setup.choose.bodyNamed", { name: firstName, reward: rewardInside })
        : cap(tBusiness(lang, "brand.setup.choose.body", { reward: rewardInside }));
      cta = tBusiness(lang, "brand.setup.choose.cta");
      href = `${site}/partner/integration`;
      break;
    case "connect":
    default: {
      const chosen = method ? d.method : null;
      subject = chosen === "manual"
        ? tBusiness(lang, "brand.setup.connect.subject.manual", { reward: rewardAtStart })
        : chosen === "shopify"
          ? tBusiness(lang, "brand.setup.connect.subject.shopify", { reward: rewardAtStart })
          : chosen === "api"
            ? tBusiness(lang, "brand.setup.connect.subject.api", { reward: rewardAtStart })
            : tBusiness(lang, "brand.setup.connect.subject.none", { reward: rewardAtStart });
      preheader = method
        ? tBusiness(lang, "brand.setup.connect.preheaderMethod", { method: method.name })
        : tBusiness(lang, "brand.setup.connect.preheader");
      ({ html: headingHtml, text: headingText } = fromLive(1, lang, em));
      const vars = { name: firstName, method: method ? method.name : tBusiness(lang, "brand.setup.connect.howCodesReach"), reward: rewardInside };
      body = firstName
        ? tBusiness(lang, "brand.setup.connect.bodyNamed", vars)
        : cap(tBusiness(lang, "brand.setup.connect.body", vars));
      cta = method ? method.cta : tBusiness(lang, "brand.setup.connect.cta");
      href = `${site}${chosen ? METHOD_PATH[chosen] : "/partner/integration"}`;
      break;
    }
  }

  const rows = checklist(d, lang);
  const setupLabel = tBusiness(lang, "brand.setup.yourSetup");
  let html = heroRow(d, headingHtml, body, lang);
  html += checklistSection(setupLabel, rows, lang);
  const text: string[] = [`${brand} · ${tBusiness(lang, "brand.setup.partnerPortal")}`, "", headingText, "", body, "", setupLabel.toUpperCase()];
  rows.forEach((r, i) => {
    const mark = r.state === "done"
      ? tBusiness(lang, "brand.setup.text.done")
      : r.state === "next" ? `${i + 1}. ${tBusiness(lang, "brand.setup.text.next")}` : `${i + 1}.`;
    text.push(tBusiness(lang, "brand.setup.text.row", { mark, title: r.title, line: r.line }));
  });

  // An edit saved with "Save & continue" is a draft until the last step's
  // button is pressed, and nothing in the portal says so loudly enough.
  const draft = d.draftTitle ? oneLine(d.draftTitle) : null;
  if (draft && d.step !== "submit") {
    const line = d.draftIsEdit
      ? tBusiness(lang, "brand.setup.draft.edit", { draft })
      : tBusiness(lang, "brand.setup.draft.new", { draft });
    const label = tBusiness(lang, "brand.setup.notSentYet");
    html += noteRow(label, line);
    text.push("", label.toUpperCase(), line);
  }

  const logins = (d.loginEmails ?? []).filter(Boolean);
  // English keeps "a or b or c"; other languages list them their own way ("a, b ou c").
  const emails = lang === "en" ? logins.join(" or ") : new Intl.ListFormat(formatLocale(lang), { type: "disjunction" }).format(logins);
  const small = d.step !== "login" && logins.length
    ? tBusiness(lang, "brand.setup.smallSignIn", { emails })
    : tBusiness(lang, "brand.setup.small");
  html += ctaRow(cta, href, small);
  text.push("", tBusiness(lang, "brand.setup.text.cta", { cta, url: href }), "", small, ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader, rows: html, unsubscribe: false, lang }),
    text: text.join("\n"),
  };
}

/** Representative data for previews (send-partner-setup-reminder `sample`, email-previews). */
export function partnerSetupReminderSample(step: SetupStep): PartnerSetupReminderData {
  return {
    brandName: "Healthspan Elite",
    step,
    contactName: "Cara James",
    rewardTitle: step === "submit" ? null : "Fuel Up for 25% Less",
    logoUrl: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-submissions/logos/1789985967117-km17c8.png",
    brandColor: "#c6a13e",
    method: step === "connect" ? "manual" : null,
    inviteToken: "sample-token-not-valid",
    loginEmails: step === "login" ? [] : ["healthspandigital@gmail.com"],
    draftTitle: "Fuel Up for 25% Less",
    draftIsEdit: step !== "submit",
  };
}
