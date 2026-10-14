import { formatLocale, tBusiness, tEmail } from "../i18n/index.ts";
import { fmtNum, rewardValueLabel } from "./member-copy.ts";

export interface PartnerRewardStat {
  title: string;
  /** Redemptions of this reward this week. */
  count: number;
  /** Discount badge text, e.g. "£15 OFF" / "20% OFF". */
  valueLabel?: string | null;
}

export interface PartnerLowStock {
  title: string;
  /** Promo codes still available. */
  remaining: number;
}

export interface PartnerWeeklySummaryData {
  brandName: string;
  /** Human label for the week being summarised, e.g. "7–13 Jul" (partnerWeekLabel, in the reader's language). */
  weekLabel: string;
  /** Redemptions of this brand's rewards this week. */
  redemptions: number;
  /** Previous week's redemptions, for the week-over-week delta. */
  prevRedemptions?: number | null;
  /** Total POWR members spent on this brand's rewards this week. */
  powrSpent: number;
  /** Rewards currently live in the app. */
  liveRewards: number;
  /** Most-redeemed rewards this week, highest first. */
  topRewards?: PartnerRewardStat[] | null;
  /** Pool-code rewards running low on available codes. */
  lowStock?: PartnerLowStock[] | null;
  /** Submissions still in review. */
  pendingSubmissions?: number;
  portalUrl?: string;
}

const GOLD = "#E8D200";
const POWR_LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "9–15 Jun" or "30 Jun – 6 Jul" for the [since, untilExclusive) window, in
 * `lang` ("7–13 juil.", "7–13 jul"). English keeps the hand-built en-GB label.
 */
export function partnerWeekLabel(since: Date, untilExclusive: Date, lang: string = "en"): string {
  const end = new Date(untilExclusive.getTime() - DAY_MS);
  if (lang !== "en") {
    return new Intl.DateTimeFormat(formatLocale(lang), { day: "numeric", month: "short", timeZone: "UTC" }).formatRange(since, end);
  }
  const mon = (dt: Date) => dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const ds = since.getUTCDate();
  const de = end.getUTCDate();
  return mon(since) === mon(end)
    ? `${ds}–${de} ${mon(end)}`
    : `${ds} ${mon(since)} – ${de} ${mon(end)}`;
}

/** A count as the report shows it: English keeps the bare number it always printed. */
const num = (n: number, lang: string) => lang === "en" ? String(n) : n.toLocaleString(formatLocale(lang));

/** Up/down chip vs the previous week — same language as the member weekly email. */
function deltaChip(curr: number, prev: number | null | undefined, lang: string): string {
  if (prev == null) return "";
  const diff = curr - prev;
  if (diff === 0) return `<span style="font-size:11px;font-weight:600;color:#555555;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.delta.levelHtml")}</span>`;
  const up = diff > 0;
  return `<span style="font-size:11px;font-weight:700;color:${up ? GOLD : "#888888"};font-family:Arial,Helvetica,sans-serif;">${up ? "&#9650;" : "&#9660;"}&nbsp;${tBusiness(lang, "brand.weekly.delta.vsLastWeek", { diff: num(Math.abs(diff), lang) })}</span>`;
}

/** One stat tile (used in the 3-up row). */
function statTile(value: string, label: string, sub: string): string {
  return `
                <td width="33%" style="padding:0 5px;vertical-align:top;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:14px;">
                    <tr>
                      <td style="padding:20px 10px;text-align:center;">
                        <span style="display:block;font-size:34px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1.1;font-family:Arial,Helvetica,sans-serif;">${value}</span>
                        <span style="display:block;margin-top:6px;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#555555;font-family:Arial,Helvetica,sans-serif;">${label}</span>
                        <span style="display:block;margin-top:6px;line-height:1.3;">${sub}</span>
                      </td>
                    </tr>
                  </table>
                </td>`;
}

/** A ranked "top reward" row. `r.valueLabel` arrives already in the reader's language. */
function rewardRow(rank: number, r: PartnerRewardStat, isLast: boolean, lang: string): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:14px 0;width:30px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">${rank}</span>
                </td>
                <td style="padding:14px 0 14px 12px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${r.title}</p>
                  ${r.valueLabel ? `<p style="margin:3px 0 0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#6b6420;font-family:Arial,Helvetica,sans-serif;">${r.valueLabel}</p>` : ""}
                </td>
                <td style="padding:14px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:14px;font-weight:600;color:${GOLD};font-family:Arial,Helvetica,sans-serif;">${num(r.count, lang)}</span>
                  <span style="font-size:11px;font-weight:300;color:#666666;font-family:Arial,Helvetica,sans-serif;">&nbsp;${tBusiness(lang, "brand.weekly.redeemed", { count: r.count })}</span>
                </td>
              </tr>
            </table>`;
}

/**
 * `lang`: the portal login's language (send-brand-weekly-report). Pass a
 * `weekLabel` made in the same language (partnerWeekLabel).
 */
export function partnerWeeklySummaryEmail(data: PartnerWeeklySummaryData, lang: string = "en"): { subject: string; html: string; text: string } {
  const { brandName, weekLabel } = data;
  const portalUrl = data.portalUrl ?? "https://powr.life/partner";
  // Discount badges the way the app's reward card shows them ("20% OFF" → "-20 %"); a brand's own wording stays.
  const topRewards = (data.topRewards ?? []).slice(0, 3)
    .map((r) => (r.valueLabel ? { ...r, valueLabel: rewardValueLabel(r.valueLabel, lang) } : r));
  const lowStock = data.lowStock ?? [];
  const pending = data.pendingSubmissions ?? 0;
  const quiet = data.redemptions === 0;
  const powrSpent = fmtNum(data.powrSpent, lang);

  const preheader = quiet
    ? tBusiness(lang, "brand.weekly.preheaderQuiet", { week: weekLabel, brand: brandName })
    : tBusiness(lang, "brand.weekly.preheader", { count: data.redemptions, week: weekLabel, powr: powrSpent, brand: brandName });

  const heroCopy = quiet
    ? tBusiness(lang, "brand.weekly.heroQuietHtml", { brand: brandName, newline: "<br>" })
    : tBusiness(lang, "brand.weekly.heroHtml", { brand: brandName });

  const topRewardsHtml = topRewards.length
    ? `
        <!-- TOP REWARDS -->
        <tr>
          <td style="background-color:#080808;padding:28px 40px 8px;border-bottom:1px solid #111111;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.mostRedeemed")}</p>
            ${topRewards.map((r, i) => rewardRow(i + 1, r, i === topRewards.length - 1, lang)).join("")}
          </td>
        </tr>`
    : "";

  const lowStockHtml = lowStock.length
    ? `
        <!-- LOW STOCK -->
        <tr>
          <td style="background-color:#0a0a0a;padding:28px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#161608;border:1px dashed #3a3a2a;border-radius:14px;">
              <tr>
                <td style="padding:22px 26px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#6b6420;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.lowStock.title")}</p>
                  ${lowStock.map((s) => `<p style="margin:0 0 6px;font-size:13px;font-weight:300;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.lowStock.lineHtml", { count: s.remaining, title: s.title, strong: '<strong style="font-weight:500;color:#F2F2F2;">', end: "</strong>", number: `<span style="color:${GOLD};font-weight:600;">${num(s.remaining, lang)}</span>` })}</p>`).join("")}
                  <p style="margin:10px 0 0;font-size:12px;font-weight:300;color:#666666;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.lowStock.topUp")}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : "";

  const pendingHtml = pending > 0
    ? `
        <!-- PENDING -->
        <tr>
          <td style="background-color:#080808;padding:24px 40px;border-bottom:1px solid #161616;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:300;color:#888888;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.pendingHtml", { count: pending })}</p>
          </td>
        </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${lang.replace(/[^\w-]/g, "")}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${tBusiness(lang, "brand.weekly.title", { brand: brandName })}</title>
</head>
<body style="margin:0;padding:0;background-color:#111111;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#111111;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border:1px solid #1e1e1e;border-radius:20px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;">
            <img src="${POWR_LOGO}" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.eyebrowHtml", { week: weekLabel })}</p>
            <h1 style="margin:0 0 6px;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.headingHtml", { brand: brandName, newline: "<br>", em: `<em style="font-style:italic;color:${GOLD};">`, end: "</em>" })}</h1>
            <p style="margin:16px 0 0;font-size:14px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${heroCopy}</p>
          </td>
        </tr>

        <!-- STAT TILES -->
        <tr>
          <td style="background-color:#0a0a0a;padding:28px 35px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
${statTile(num(data.redemptions, lang), tBusiness(lang, "brand.weekly.stats.redemptions"), deltaChip(data.redemptions, data.prevRedemptions, lang))}
${statTile(powrSpent, tBusiness(lang, "brand.weekly.stats.powrSpent"), `<span style="font-size:11px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.stats.powrSpentSub")}</span>`)}
${statTile(num(data.liveRewards, lang), tBusiness(lang, "brand.weekly.stats.liveRewards"), `<span style="font-size:11px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.stats.liveRewardsSub")}</span>`)}
              </tr>
            </table>
          </td>
        </tr>
${topRewardsHtml}${lowStockHtml}${pendingHtml}
        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:100px;background-color:${GOLD};">
                  <a href="${portalUrl}" target="_blank" style="display:inline-block;padding:14px 34px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.common.openPortal")}</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#555555;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.weekly.portalNoteHtml")}</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              ${tBusiness(lang, "brand.weekly.footerReceiving", { brand: brandName })}<br>
              <a href="%unsubscribe_url%" style="color:#333333;text-decoration:none;">${tEmail(lang, "layout.unsubscribe")}</a> &nbsp;&middot;&nbsp; <a href="https://powr.life/privacy" style="color:#333333;text-decoration:none;">${tEmail(lang, "layout.privacy")}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const lines = [
    tBusiness(lang, "brand.weekly.text.title", { brand: brandName, week: weekLabel }),
    "",
    data.prevRedemptions != null
      ? tBusiness(lang, "brand.weekly.text.redemptionsVs", { n: num(data.redemptions, lang), prev: num(data.prevRedemptions, lang) })
      : tBusiness(lang, "brand.weekly.text.redemptions", { n: num(data.redemptions, lang) }),
    tBusiness(lang, "brand.weekly.text.powrSpent", { amount: powrSpent }),
    tBusiness(lang, "brand.weekly.text.liveRewards", { n: num(data.liveRewards, lang) }),
  ];
  if (topRewards.length) {
    lines.push("", tBusiness(lang, "brand.weekly.mostRedeemed").toUpperCase());
    topRewards.forEach((r, i) => lines.push(r.valueLabel
      ? tBusiness(lang, "brand.weekly.text.topRewardValue", { count: r.count, rank: i + 1, title: r.title, value: r.valueLabel })
      : tBusiness(lang, "brand.weekly.text.topReward", { count: r.count, rank: i + 1, title: r.title })));
  }
  if (lowStock.length) {
    lines.push("", tBusiness(lang, "brand.weekly.lowStock.title").toUpperCase());
    lowStock.forEach((s) => lines.push(tBusiness(lang, "brand.weekly.text.lowStock", { count: s.remaining, title: s.title })));
  }
  if (pending > 0) {
    lines.push("", tBusiness(lang, "brand.weekly.text.pending", { count: pending }));
  }
  lines.push("", tBusiness(lang, "brand.common.text.openPortal", { url: portalUrl }), "", "— POWR", "https://powr.life");

  return {
    subject: quiet
      ? tBusiness(lang, "brand.weekly.subjectQuiet", { brand: brandName })
      : tBusiness(lang, "brand.weekly.subject", { count: data.redemptions, brand: brandName }),
    html,
    text: lines.join("\n"),
  };
}
