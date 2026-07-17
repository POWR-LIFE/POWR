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
  /** Human label for the week being summarised, e.g. "7–13 Jul". */
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

/** Up/down chip vs the previous week — same language as the member weekly email. */
function deltaChip(curr: number, prev: number | null | undefined): string {
  if (prev == null) return "";
  const diff = curr - prev;
  if (diff === 0) return `<span style="font-size:11px;font-weight:600;color:#555555;font-family:Arial,Helvetica,sans-serif;">&#8212; level</span>`;
  const up = diff > 0;
  return `<span style="font-size:11px;font-weight:700;color:${up ? GOLD : "#888888"};font-family:Arial,Helvetica,sans-serif;">${up ? "&#9650;" : "&#9660;"}&nbsp;${Math.abs(diff)} vs last week</span>`;
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

/** A ranked "top reward" row. */
function rewardRow(rank: number, r: PartnerRewardStat, isLast: boolean): string {
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
                  <span style="font-size:14px;font-weight:600;color:${GOLD};font-family:Arial,Helvetica,sans-serif;">${r.count}</span>
                  <span style="font-size:11px;font-weight:300;color:#666666;font-family:Arial,Helvetica,sans-serif;">&nbsp;redeemed</span>
                </td>
              </tr>
            </table>`;
}

export function partnerWeeklySummaryEmail(data: PartnerWeeklySummaryData): { subject: string; html: string; text: string } {
  const { brandName, weekLabel } = data;
  const portalUrl = data.portalUrl ?? "https://powr.life/partner";
  const topRewards = (data.topRewards ?? []).slice(0, 3);
  const lowStock = data.lowStock ?? [];
  const pending = data.pendingSubmissions ?? 0;
  const quiet = data.redemptions === 0;

  const preheader = quiet
    ? `${weekLabel}: a quiet week for ${brandName} — here's what can move the needle.`
    : `${weekLabel}: ${data.redemptions} redemptions, ${data.powrSpent.toLocaleString()} POWR spent on ${brandName} rewards.`;

  const heroCopy = quiet
    ? `A quiet one for ${brandName} &mdash; no redemptions this week.<br>A fresh offer or a lower-cost reward usually wakes things up.`
    : `Here's how ${brandName} rewards performed with members this week.`;

  const topRewardsHtml = topRewards.length
    ? `
        <!-- TOP REWARDS -->
        <tr>
          <td style="background-color:#080808;padding:28px 40px 8px;border-bottom:1px solid #111111;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">Most redeemed</p>
            ${topRewards.map((r, i) => rewardRow(i + 1, r, i === topRewards.length - 1)).join("")}
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
                  <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#6b6420;font-family:Arial,Helvetica,sans-serif;">Running low on codes</p>
                  ${lowStock.map((s) => `<p style="margin:0 0 6px;font-size:13px;font-weight:300;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;"><strong style="font-weight:500;color:#F2F2F2;">${s.title}</strong> &mdash; <span style="color:${GOLD};font-weight:600;">${s.remaining}</span> ${s.remaining === 1 ? "code" : "codes"} left</p>`).join("")}
                  <p style="margin:10px 0 0;font-size:12px;font-weight:300;color:#666666;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Top up in the portal so members never hit an empty shelf.</p>
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
            <p style="margin:0;font-size:13px;font-weight:300;color:#888888;font-family:Arial,Helvetica,sans-serif;">${pending === 1 ? "You have 1 submission" : `You have ${pending} submissions`} in review &mdash; we'll be quick.</p>
          </td>
        </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your POWR week — ${brandName}</title>
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
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">Partner week &middot; ${weekLabel}</p>
            <h1 style="margin:0 0 6px;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Your week,<br><em style="font-style:italic;color:${GOLD};">${brandName}.</em></h1>
            <p style="margin:16px 0 0;font-size:14px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${heroCopy}</p>
          </td>
        </tr>

        <!-- STAT TILES -->
        <tr>
          <td style="background-color:#0a0a0a;padding:28px 35px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
${statTile(String(data.redemptions), "Redemptions", deltaChip(data.redemptions, data.prevRedemptions))}
${statTile(data.powrSpent.toLocaleString(), "POWR spent", `<span style="font-size:11px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">on your rewards</span>`)}
${statTile(String(data.liveRewards), "Live rewards", `<span style="font-size:11px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">in the app now</span>`)}
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
                  <a href="${portalUrl}" target="_blank" style="display:inline-block;padding:14px 34px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">Open your portal</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#555555;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Full redemption history, promo codes and reward edits &mdash; all in the portal.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              You're receiving this weekly digest because you manage ${brandName} on POWR.<br>
              <a href="%unsubscribe_url%" style="color:#333333;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="https://powr.life/privacy" style="color:#333333;text-decoration:none;">Privacy Policy</a>
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
    `Your week, ${brandName} — ${weekLabel}`,
    "",
    `Redemptions: ${data.redemptions}${data.prevRedemptions != null ? ` (last week: ${data.prevRedemptions})` : ""}`,
    `POWR spent on your rewards: ${data.powrSpent.toLocaleString()}`,
    `Live rewards in the app: ${data.liveRewards}`,
  ];
  if (topRewards.length) {
    lines.push("", "MOST REDEEMED");
    topRewards.forEach((r, i) => lines.push(`${i + 1}. ${r.title} — ${r.count} redeemed${r.valueLabel ? ` (${r.valueLabel})` : ""}`));
  }
  if (lowStock.length) {
    lines.push("", "RUNNING LOW ON CODES");
    lowStock.forEach((s) => lines.push(`- ${s.title}: ${s.remaining} left — top up in the portal`));
  }
  if (pending > 0) {
    lines.push("", `${pending} submission${pending === 1 ? "" : "s"} in review — we'll be quick.`);
  }
  lines.push("", `Open your portal: ${portalUrl}`, "", "— POWR", "https://powr.life");

  return {
    subject: quiet
      ? `${brandName} on POWR: your week in review`
      : `${brandName} on POWR: ${data.redemptions} redemption${data.redemptions === 1 ? "" : "s"} this week`,
    html,
    text: lines.join("\n"),
  };
}
