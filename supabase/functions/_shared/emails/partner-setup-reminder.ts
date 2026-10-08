// The weekly "finish setting up" email to a reward brand. Sent by
// send-partner-setup-reminder while the brand's side of getting a reward live
// is unfinished: the first 5 days after it started waiting, then every 7 days.
// Facts come from get_partner_setup_reminder_candidates(); this file is only
// the words. Transactional, like the rest of the partner mail: no unsubscribe
// link, and a reply reaches a person.
//
// The body is the brand's own checklist: what's done, the one thing to do
// next (the button), what follows, and our part at the end.

import { emailShell, esc, FONT, GOLD } from "./layout.ts";
import { brandLogoImg, type LogoSize } from "./brand-logo.ts";
import { ctaRow, gold, noteRow, TEXT_SIGNOFF } from "./gym-mail-parts.ts";

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

const METHOD: Record<DeliveryMethod, { name: string; done: string; title: string; todo: string; cta: string; path: string; subject: string }> = {
  manual: {
    name: "promo codes",
    done: "Promo codes: you upload single-use codes",
    title: "Upload your codes",
    todo: "Add a CSV of single-use codes under Promo Codes. A first batch is enough, and you can top it up any time.",
    cta: "Upload codes",
    path: "/partner/promo-codes",
    subject: "upload your codes",
  },
  shopify: {
    name: "Shopify",
    done: "Shopify: a unique code for every claim",
    title: "Connect your Shopify store",
    todo: "Approve POWR in Shopify. After that we make a unique discount code for every claim, so there's nothing to upload.",
    cta: "Connect Shopify",
    path: "/partner/integration/shopify",
    subject: "connect your Shopify store",
  },
  api: {
    name: "our API",
    done: "API: your system issues the codes",
    title: "Finish your API setup",
    todo: "Add your code endpoint, or load codes through the API. The developer docs walk through both.",
    cta: "Finish API setup",
    path: "/partner/integration/api",
    subject: "finish your API setup",
  },
};

interface Row {
  title: string;
  line: string;
  state: "done" | "next" | "later" | "ours";
}

const ORDER: SetupStep[] = ["login", "submit", "choose", "connect"];
const WORDS = ["Zero", "One", "Two", "Three", "Four"];

function checklist(d: PartnerSetupReminderData): Row[] {
  const at = ORDER.indexOf(d.step);
  const state = (s: SetupStep): Row["state"] => {
    const i = ORDER.indexOf(s);
    return i < at ? "done" : i === at ? "next" : "later";
  };
  const reward = d.rewardTitle ? oneLine(d.rewardTitle) : null;
  const method = d.method ? METHOD[d.method] : null;
  const draft = d.draftTitle ? oneLine(d.draftTitle) : null;

  const rows: Row[] = [
    {
      title: "Set up your login",
      line: state("login") === "done" ? "Done" : "Pick your email and password. It takes about a minute.",
      state: state("login"),
    },
  ];
  // A brand that was approved before it had a login has nothing to submit.
  if (!(d.step === "login" && reward)) {
    rows.push({
      title: "Submit your reward",
      line: state("submit") === "done"
        ? (reward ? `${reward} is approved` : "Approved")
        : draft && !d.draftIsEdit
          ? `${draft} is saved as a draft. Finish it and send it to us for review.`
          : "Describe the offer, add your logo and a photo, and send it to us for review.",
      state: state("submit"),
    });
  }
  rows.push({
    title: "Choose how codes reach members",
    line: state("choose") === "done" && method
      ? method.done
      : "Upload single-use codes, connect your Shopify store, or use our API. You can change it later.",
    state: state("choose"),
  });
  rows.push({
    title: method ? method.title : "Get codes flowing",
    line: method ? method.todo : "Then upload the codes, or finish connecting, depending on what you chose.",
    state: state("connect"),
  });
  rows.push({
    title: "We put it live",
    line: "Our part. We check the codes work, switch the reward on, and you can watch every claim in the portal.",
    state: "ours",
  });
  return rows;
}

function checklistSection(label: string, rows: Row[]): string {
  const marker = (r: Row, n: number) => {
    const base = "display:inline-block;width:22px;height:22px;border-radius:50%;text-align:center;font-size:11px;font-weight:600;line-height:22px;";
    if (r.state === "done") return `<span style="${base}background-color:#111111;border:1px solid #222222;color:${GOLD};font-family:${FONT};">&#10003;</span>`;
    if (r.state === "next") return `<span style="${base}background-color:${GOLD};border:1px solid ${GOLD};color:#080808;font-family:${FONT};">${n}</span>`;
    return `<span style="${base}background-color:#080808;border:1px solid #222222;color:#777777;font-family:${FONT};">${n}</span>`;
  };
  const titleColor = (r: Row) => r.state === "done" ? "#777777" : r.state === "next" ? "#F2F2F2" : "#bbbbbb";
  const tag = (r: Row) => r.state === "next"
    ? ` <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};font-family:${FONT};">&nbsp;Next</span>`
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

function heroRow(d: PartnerSetupReminderData, headingHtml: string, body: string): string {
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
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};"><span style="color:${dot};">&#9679;</span>&nbsp; ${esc(oneLine(d.brandName))} &middot; Partner portal</p>
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(body)}</p>
          </td>
        </tr>`;
}

export function partnerSetupReminderEmail(d: PartnerSetupReminderData): Rendered {
  const site = d.siteUrl ?? "https://powr.life";
  const brand = oneLine(d.brandName);
  const reward = d.rewardTitle ? oneLine(d.rewardTitle) : null;
  const method = d.method ? METHOD[d.method] : null;
  const firstName = oneLine(d.contactName ?? "").split(" ")[0] ?? "";
  const hi = (s: string) => firstName ? `Hi ${firstName}, ${s}` : s.charAt(0).toUpperCase() + s.slice(1);

  // Steps still on the brand's side, counting this one.
  const left = ORDER.length - ORDER.indexOf(d.step) - (d.step === "login" && reward ? 1 : 0);
  const fromLive = (n: number) => `${WORDS[n] ?? n} ${n === 1 ? "step" : "steps"}`;

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
        ? `${reward} is approved — set up your ${brand} portal to put it live`
        : `Your ${brand} portal on POWR is still waiting`;
      preheader = "Your setup link still works. It takes about a minute.";
      headingHtml = `Your portal is<br class="br-d"> ${gold("still waiting.")}`;
      headingText = "Your portal is still waiting.";
      body = reward
        ? hi(`${reward} is approved, but it can't go live until someone at ${brand} sets up the portal. Your setup link still works, and it takes about a minute.`)
        : hi(`your invite to the ${brand} portal on POWR hasn't been used yet. The link still works, and it takes about a minute.`);
      cta = "Set up your login";
      href = d.inviteToken ? `${site}/partner/setup/${d.inviteToken}` : `${site}/partner/login`;
      break;
    case "submit":
      subject = `Your ${brand} portal is ready for its first reward`;
      preheader = "Submit a reward and we'll review it. Then it's codes, and you're live.";
      headingHtml = `${fromLive(left)}<br class="br-d"> ${gold("from live.")}`;
      headingText = `${fromLive(left)} from live.`;
      body = hi(`your ${brand} portal is set up, but there's no reward in it yet. Submit one and we'll review it.`);
      cta = d.draftTitle && !d.draftIsEdit ? "Finish your reward" : "Submit a reward";
      href = `${site}/partner/rewards`;
      break;
    case "choose":
      subject = `${reward ?? "Your reward"} isn't live yet — choose how codes reach members`;
      preheader = "One choice in the portal, then your codes, and we switch it on.";
      headingHtml = `${fromLive(left)}<br class="br-d"> ${gold("from live.")}`;
      headingText = `${fromLive(left)} from live.`;
      body = hi(`${reward ?? "your reward"} is approved, but members can't claim it yet because there's no way for codes to reach them. Choose one in the portal and you're nearly there.`);
      cta = "Choose how codes arrive";
      href = `${site}/partner/integration`;
      break;
    case "connect":
    default:
      subject = `${reward ?? "Your reward"} isn't live yet — ${method ? method.subject : "finish connecting your codes"}`;
      preheader = method ? `You chose ${method.name}. One more step and we switch it on.` : "One more step and we switch it on.";
      headingHtml = `${fromLive(1)}<br class="br-d"> ${gold("from live.")}`;
      headingText = `${fromLive(1)} from live.`;
      body = hi(`you chose ${method ? method.name : "how codes reach members"} for ${reward ?? "your reward"}, but no codes can reach members yet. Once they can, we switch it on.`);
      cta = method ? method.cta : "Finish connecting";
      href = `${site}${method ? method.path : "/partner/integration"}`;
      break;
  }

  const rows = checklist(d);
  let html = heroRow(d, headingHtml, body);
  html += checklistSection("Your setup", rows);
  const text: string[] = [`${brand} · Partner portal`, "", headingText, "", body, "", "YOUR SETUP"];
  rows.forEach((r, i) => {
    const mark = r.state === "done" ? "[done]" : r.state === "next" ? `${i + 1}. [next]` : `${i + 1}.`;
    text.push(`${mark} ${r.title}: ${r.line}`);
  });

  // An edit saved with "Save & continue" is a draft until the last step's
  // button is pressed, and nothing in the portal says so loudly enough.
  const draft = d.draftTitle ? oneLine(d.draftTitle) : null;
  if (draft && d.step !== "submit") {
    const line = d.draftIsEdit
      ? `Your changes to ${draft} are saved as a draft but haven't reached us. Open Rewards, click Continue, and submit them on the last step.`
      : `Your new reward ${draft} is saved as a draft but hasn't reached us. Open Rewards, click Continue, and submit it on the last step.`;
    html += noteRow("Not sent yet", line);
    text.push("", "NOT SENT YET", line);
  }

  const logins = (d.loginEmails ?? []).filter(Boolean);
  const small = d.step !== "login" && logins.length
    ? `Sign in as ${logins.join(" or ")}. Questions, or not the right person? Reply and a person at POWR will answer.`
    : "Questions, or not the right person? Reply and a person at POWR will answer.";
  html += ctaRow(cta, href, small);
  text.push("", `${cta}: ${href}`, "", small, ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader, rows: html, unsubscribe: false }),
    text: text.join("\n"),
  };
}
