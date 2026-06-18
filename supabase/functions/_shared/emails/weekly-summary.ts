export interface WeeklySummaryTopActivity {
  /** Activity type key, e.g. "gym", "running". */
  type: string;
  count: number;
}

export interface WeeklySummaryData {
  name: string | null;
  /** Human label for the week being summarised, e.g. "9–15 Jun". */
  weekLabel: string;
  pointsThisWeek: number;
  /** Previous week's points, for the week-over-week delta. */
  pointsLastWeek?: number | null;
  /** Number of workouts (sessions excluding sleep & walking). */
  workouts: number;
  /** Distinct active days (any non-sleep activity), 0–7. */
  activeDays: number;
  currentStreak: number;
  topActivity?: WeeklySummaryTopActivity | null;
  distanceKm?: number | null;
  steps?: number | null;
  /** League position for the week, within the user's cohort. */
  weeklyRank?: number | null;
  referralCode?: string | null;
}

const GOLD = "#E8D200";

// type → display label. Mirrors constants/activities.ts (kept inline so the
// edge runtime has no app imports).
const ACTIVITY_LABELS: Record<string, string> = {
  walking: "Walking",
  running: "Running",
  cycling: "Cycling",
  swimming: "Swimming",
  gym: "Gym",
  hiit: "HIIT / Classes",
  sports: "Sports",
  yoga: "Yoga / Pilates",
  dance: "Dance",
  sleep: "Sleep",
};

function statCell(value: string, label: string): string {
  return `
                <td width="33.33%" style="padding:0 6px;vertical-align:top;text-align:center;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:12px;">
                    <tr>
                      <td style="padding:18px 8px;text-align:center;">
                        <span style="display:block;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1;font-family:Arial,Helvetica,sans-serif;">${value}</span>
                        <span style="display:block;margin-top:8px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#666666;font-family:Arial,Helvetica,sans-serif;">${label}</span>
                      </td>
                    </tr>
                  </table>
                </td>`;
}

export function weeklySummaryEmail(data: WeeklySummaryData): { subject: string; html: string; text: string } {
  const firstName = data.name?.split(" ")[0] ?? "there";
  const points = data.pointsThisWeek;
  const lastWeek = data.pointsLastWeek ?? null;

  // Week-over-week delta line.
  let deltaHtml = "";
  let deltaText = "";
  if (lastWeek !== null && lastWeek > 0) {
    const pct = Math.round(((points - lastWeek) / lastWeek) * 100);
    if (pct > 0) {
      deltaHtml = `<span style="color:${GOLD};">&#9650; ${pct}%</span> vs last week`;
      deltaText = `Up ${pct}% vs last week.`;
    } else if (pct < 0) {
      deltaHtml = `<span style="color:#888888;">&#9660; ${Math.abs(pct)}%</span> vs last week`;
      deltaText = `Down ${Math.abs(pct)}% vs last week.`;
    } else {
      deltaHtml = `Level with last week`;
      deltaText = `Level with last week.`;
    }
  } else if (points > 0 && lastWeek === 0) {
    deltaHtml = `<span style="color:${GOLD};">Back in action</span>`;
    deltaText = `Back in action this week.`;
  }

  const topLabel = data.topActivity
    ? (ACTIVITY_LABELS[data.topActivity.type] ?? data.topActivity.type)
    : null;

  // Optional "highlights" line: most-done activity, distance, steps.
  const highlightBits: string[] = [];
  if (topLabel && data.topActivity) {
    highlightBits.push(`${topLabel} &times;${data.topActivity.count}`);
  }
  if (data.distanceKm && data.distanceKm >= 0.1) {
    highlightBits.push(`${data.distanceKm.toFixed(1)} km moved`);
  }
  if (data.steps && data.steps > 0) {
    highlightBits.push(`${data.steps.toLocaleString()} steps`);
  }
  const highlightsHtml = highlightBits.length
    ? `
        <tr>
          <td style="background-color:#080808;padding:0 40px 28px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0f0f0a;border:1px solid #232318;border-radius:12px;">
              <tr>
                <td style="padding:16px 20px;font-size:13px;font-weight:300;color:#cccccc;line-height:1.6;font-family:Arial,Helvetica,sans-serif;text-align:center;">
                  ${highlightBits.join(`<span style="color:#444444;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : "";

  const rankHtml = data.weeklyRank
    ? `
        <tr>
          <td style="background-color:#0a0a0a;padding:28px 40px;border-bottom:1px solid #161616;text-align:center;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#555555;font-family:Arial,Helvetica,sans-serif;">League finish</span>
            <span style="display:block;margin-top:8px;font-size:34px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;font-family:Arial,Helvetica,sans-serif;">#${data.weeklyRank}</span>
            <span style="display:block;margin-top:6px;font-size:13px;font-weight:300;color:#888888;font-family:Arial,Helvetica,sans-serif;">where you ranked this week</span>
          </td>
        </tr>`
    : "";

  const preheader =
    points > 0
      ? `You earned ${points.toLocaleString()} POWR this week${deltaText ? " — " + deltaText : "."}`
      : `Your POWR week in review.`;

  const referralUrl = data.referralCode ? `https://powr.life/?ref=${data.referralCode}` : "https://powr.life";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your week in POWR</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600;700;800;900&display=swap');
body,table,td,th,p,span,a,h1,h2,h3,em,strong{font-family:'Outfit',Arial,Helvetica,sans-serif!important;}
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Outfit',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border:1px solid #1e1e1e;border-radius:20px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background-color:#080808;padding:40px 40px 32px;text-align:center;border-bottom:1px solid #111111;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${GOLD};font-family:Arial,Helvetica,sans-serif;opacity:0.6;">Your week &middot; ${data.weekLabel}</span>
            <h1 style="margin:14px 0 0;font-size:34px;font-weight:200;letter-spacing:-0.5px;line-height:1.2;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Here&#8217;s your week,<br>${firstName}.</h1>
          </td>
        </tr>

        <!-- POINTS -->
        <tr>
          <td style="background-color:#0a0a0a;padding:34px 40px;border-bottom:1px solid #161616;text-align:center;">
            <span style="display:block;font-size:72px;font-weight:200;color:${GOLD};letter-spacing:-3px;line-height:1;font-family:Arial,Helvetica,sans-serif;">${points.toLocaleString()}</span>
            <span style="display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${GOLD};font-family:Arial,Helvetica,sans-serif;opacity:0.55;">POWR earned this week</span>
            ${deltaHtml ? `<p style="margin:14px 0 0;font-size:13px;font-weight:400;color:#999999;font-family:Arial,Helvetica,sans-serif;">${deltaHtml}</p>` : ""}
          </td>
        </tr>

        <!-- STAT GRID -->
        <tr>
          <td style="background-color:#080808;padding:28px 34px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                ${statCell(String(data.workouts), "Workouts")}
                ${statCell(`${data.activeDays}/7`, "Active days")}
                ${statCell(String(data.currentStreak), "Day streak")}
              </tr>
            </table>
          </td>
        </tr>
${highlightsHtml}${rankHtml}
        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:14px;font-weight:300;color:#999999;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">New week, fresh leaderboard. Every workout from here<br>climbs you back up the ranks.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:${GOLD};">
                  <a href="https://powr.life/app" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;font-family:Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">Start this week</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;font-weight:300;color:#555555;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Bring a friend with <a href="${referralUrl}" style="color:#888888;text-decoration:underline;">your code${data.referralCode ? ` ${data.referralCode}` : ""}</a> — you both earn +20 POWR.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              powr.life<br>
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

  const lines: string[] = [
    `Here's your week, ${firstName}. (${data.weekLabel})`,
    ``,
    `${points.toLocaleString()} POWR earned this week.${deltaText ? " " + deltaText : ""}`,
    ``,
    `Workouts: ${data.workouts}`,
    `Active days: ${data.activeDays}/7`,
    `Day streak: ${data.currentStreak}`,
  ];
  if (highlightBits.length) {
    lines.push("", highlightBits.map((b) => b.replace("&times;", "x")).join("  ·  "));
  }
  if (data.weeklyRank) {
    lines.push("", `League finish: #${data.weeklyRank} this week.`);
  }
  lines.push(
    "",
    "New week, fresh leaderboard. Start this week: https://powr.life/app",
    "",
    `Bring a friend with your code${data.referralCode ? ` ${data.referralCode}` : ""} — you both earn +20 POWR.`,
    `${referralUrl}`,
    "",
    "Every move counts.",
    "— POWR",
    "https://powr.life",
  );

  const subject =
    points > 0
      ? `Your POWR week: ${points.toLocaleString()} points${deltaText && deltaText.startsWith("Up") ? ", " + deltaText.toLowerCase().replace(".", "") : ""}`
      : `Your POWR week in review`;

  return { subject, html, text: lines.join("\n") };
}
