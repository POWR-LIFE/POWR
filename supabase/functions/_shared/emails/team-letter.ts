export interface TeamLetterMetric {
  key: string;
  label: string;
  value: number;
  previous: number | null;
  delta_pct: number | null;
  format: "number" | "points" | "percent" | "decimal" | "hours" | "minutes" | "km";
}

export interface TeamLetterBar {
  label: string;
  value: number;
}

export interface TeamLetterSection {
  key: string;
  title: string;
  accent: string;
  metrics: TeamLetterMetric[];
  bars?: TeamLetterBar[];
  bar_label?: string;
  secondary_bars?: TeamLetterBar[];
  secondary_bar_label?: string;
}

export interface TeamLetterReport {
  version: number;
  generated_at: string;
  window: { start: string; end: string; previous_start: string; previous_end: string };
  headline: TeamLetterMetric[];
  trend: Array<{ date: string; workouts: number; app_sessions: number }>;
  sections: TeamLetterSection[];
}

export interface TeamLetterEmailData {
  subject: string;
  title: string;
  previewText: string;
  weekLabel: string;
  report?: TeamLetterReport;
  bodyHtml?: string;
  bodyText?: string;
}

const GOLD = "#E8D200";
const LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";
const BAR_COLORS = ["#E8D200", "#0EA5E9", "#10B981", "#F97316", "#8B5CF6", "#F43F5E"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatValue(metric: TeamLetterMetric): string {
  const value = Number(metric.value ?? 0);
  const number = Number.isInteger(value)
    ? value.toLocaleString("en-GB")
    : value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  if (metric.format === "points") return `${number} POWR`;
  if (metric.format === "percent") return `${number}%`;
  if (metric.format === "hours") return `${number}h`;
  if (metric.format === "minutes") return `${number}m`;
  if (metric.format === "km") return `${number}km`;
  return number;
}

function deltaHtml(metric: TeamLetterMetric): string {
  if (metric.delta_pct == null) return '<span style="color:#555555;">Snapshot</span>';
  const delta = Number(metric.delta_pct);
  const color = delta > 0 ? "#34D399" : delta < 0 ? "#FB7185" : "#777777";
  const arrow = delta > 0 ? "&#8593;" : delta < 0 ? "&#8595;" : "&#8594;";
  return `<span style="color:${color};">${arrow} ${Math.abs(delta).toLocaleString("en-GB", { maximumFractionDigits: 1 })}% WoW</span>`;
}

function metricGrid(metrics: TeamLetterMetric[], columns = 3): string {
  const rows: string[] = [];
  for (let index = 0; index < metrics.length; index += columns) {
    const cells = metrics.slice(index, index + columns).map((metric) => `
      <td class="metric-cell" width="${Math.floor(100 / columns)}%" valign="top" style="padding:5px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111111;border:1px solid #242424;border-radius:8px;">
          <tr><td style="padding:15px 15px 6px;font-size:10px;line-height:1.3;text-transform:uppercase;color:#777777;">${escapeHtml(metric.label)}</td></tr>
          <tr><td style="padding:0 15px;font-size:22px;line-height:1.15;color:#F5F5F5;font-weight:700;">${escapeHtml(formatValue(metric))}</td></tr>
          <tr><td style="padding:7px 15px 15px;font-size:10px;line-height:1.3;font-weight:700;">${deltaHtml(metric)}</td></tr>
        </table>
      </td>`).join("");
    const fillers = Array.from({ length: columns - Math.min(columns, metrics.length - index) }, () =>
      `<td class="metric-cell" width="${Math.floor(100 / columns)}%"></td>`).join("");
    rows.push(`<tr>${cells}${fillers}</tr>`);
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 -5px;">${rows.join("")}</table>`;
}

function barsHtml(items: TeamLetterBar[] = [], label = "Breakdown"): string {
  if (!items.length) return "";
  const max = Math.max(1, ...items.map((item) => Number(item.value)));
  return `<p style="margin:22px 0 12px;font-size:10px;line-height:1.4;text-transform:uppercase;letter-spacing:1.4px;color:#777777;font-weight:700;">${escapeHtml(label)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${items.map((item, index) => {
    const width = Math.max(3, Math.round((Number(item.value) / max) * 100));
    return `<tr><td width="38%" style="padding:5px 12px 5px 0;font-size:11px;line-height:1.3;color:#AAAAAA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(String(item.label).replaceAll("_", " "))}</td><td style="padding:5px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="${width}%" height="9" style="height:9px;background:${BAR_COLORS[index % BAR_COLORS.length]};font-size:1px;line-height:1px;">&nbsp;</td><td width="${100 - width}%" style="background:#202020;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td><td width="48" align="right" style="padding:5px 0 5px 10px;font-size:11px;color:#F2F2F2;font-weight:700;">${Number(item.value).toLocaleString("en-GB")}</td></tr>`;
  }).join("")}</table>`;
}

function trendHtml(report: TeamLetterReport): string {
  if (!report.trend.length) return "";
  const max = Math.max(1, ...report.trend.flatMap((day) => [day.workouts, day.app_sessions]));
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;"><tr>${report.trend.map((day) => {
    const appHeight = Math.max(4, Math.round((day.app_sessions / max) * 72));
    const workoutHeight = Math.max(4, Math.round((day.workouts / max) * 72));
    const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    return `<td width="14.28%" valign="bottom" align="center" style="padding:0 3px;"><table role="presentation" cellspacing="2" cellpadding="0" border="0" align="center"><tr><td valign="bottom"><div style="width:9px;height:${appHeight}px;background:#8B5CF6;border-radius:3px 3px 0 0;"></div></td><td valign="bottom"><div style="width:9px;height:${workoutHeight}px;background:#10B981;border-radius:3px 3px 0 0;"></div></td></tr></table><div style="padding-top:7px;font-size:9px;color:#777777;text-transform:uppercase;">${date}</div></td>`;
  }).join("")}</tr></table><p style="margin:12px 0 0;text-align:center;font-size:10px;color:#777777;"><span style="color:#8B5CF6;">&#9632;</span> App sessions&nbsp;&nbsp;&nbsp;<span style="color:#10B981;">&#9632;</span> Trusted workouts</p>`;
}

function reportHtml(report: TeamLetterReport): string {
  return `<tr><td class="sec" style="padding:34px 36px 38px;background:#090909;border-bottom:1px solid #202020;"><p style="margin:0 0 12px;font-size:10px;line-height:1.4;text-transform:uppercase;letter-spacing:1.6px;color:${GOLD};font-weight:700;">Platform pulse</p>${metricGrid(report.headline, 3)}</td></tr><tr><td class="sec" style="padding:34px 42px 38px;background:#0C0C0C;border-bottom:1px solid #202020;"><h2 style="margin:0;font-size:20px;line-height:1.3;color:#F3F3F3;font-weight:500;">Daily momentum</h2><p style="margin:7px 0 0;font-size:12px;line-height:1.5;color:#777777;">Product visits and trusted training across the reporting window.</p>${trendHtml(report)}</td></tr>${report.sections.map((section) => `<tr><td class="sec" style="padding:36px 42px 40px;background:#0A0A0A;border-bottom:1px solid #202020;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="5"><div style="width:5px;height:32px;background:${section.accent};"></div></td><td style="padding-left:13px;"><h2 style="margin:0;font-size:21px;line-height:1.25;color:#F3F3F3;font-weight:500;">${escapeHtml(section.title)}</h2></td></tr></table><div style="height:18px;line-height:18px;">&nbsp;</div>${metricGrid(section.metrics, 2)}${barsHtml(section.bars, section.bar_label)}${barsHtml(section.secondary_bars, section.secondary_bar_label)}</td></tr>`).join("")}`;
}

function reportText(report: TeamLetterReport): string {
  const metricLine = (metric: TeamLetterMetric) => `${metric.label}: ${formatValue(metric)}${metric.delta_pct == null ? "" : ` (${metric.delta_pct > 0 ? "+" : ""}${metric.delta_pct}% WoW)`}`;
  const headline = report.headline.map(metricLine).join("\n");
  const sections = report.sections.map((section) => {
    const metrics = section.metrics.map(metricLine).join("\n");
    const bars = [...(section.bars ?? []), ...(section.secondary_bars ?? [])]
      .map((item) => `${item.label}: ${item.value.toLocaleString("en-GB")}`).join("\n");
    return `${section.title}\n${metrics}${bars ? `\n${bars}` : ""}`;
  }).join("\n\n");
  return `${headline}\n\n${sections}`;
}

export function teamLetterEmail(data: TeamLetterEmailData): { subject: string; html: string; text: string } {
  const title = escapeHtml(data.title);
  const previewText = escapeHtml(data.previewText);
  const weekLabel = escapeHtml(data.weekLabel);
  const content = data.report
    ? reportHtml(data.report)
    : `<tr><td class="sec letter-body" style="padding:38px 42px 44px;background:#0A0A0A;">${data.bodyHtml ?? ""}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${title}</title>
<style>
body,table,td,p,a,h1,h2,h3,strong,em,li{font-family:Arial,Helvetica,sans-serif!important;}
.letter-body h2{color:${GOLD};}.letter-body p,.letter-body li{color:#B5B5B5;line-height:1.7;}.letter-body a{color:${GOLD};}
@media only screen and (max-width:620px){.sec{padding-left:18px!important;padding-right:18px!important;}.hero{font-size:32px!important;}.metric-cell{display:block!important;width:100%!important;}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F1;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F4F1;">${previewText}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F4F4F1;">
  <tr>
    <td align="center" style="padding:36px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background-color:#080808;border:1px solid #1E1E1E;border-radius:12px;overflow:hidden;">
        <tr>
          <td class="sec" style="padding:30px 42px 24px;text-align:center;border-bottom:1px solid #181818;">
            <img src="${LOGO}" alt="POWR" height="38" style="height:38px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>
        <tr>
          <td class="sec" style="padding:38px 42px 36px;text-align:center;border-bottom:1px solid #181818;">
            <span style="display:block;font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:${GOLD};">Weekly platform report &middot; ${weekLabel}</span>
            <h1 class="hero" style="margin:14px 0 0;font-size:40px;font-weight:200;letter-spacing:0;line-height:1.15;color:#F2F2F2;">${title}</h1>
            <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#777777;">Automated from POWR platform data</p>
          </td>
        </tr>
        ${content}
        <tr>
          <td class="sec" style="padding:28px 42px;text-align:center;border-top:1px solid #181818;background-color:#050505;">
            <p style="margin:0;font-size:11px;line-height:1.8;color:#555555;">Internal POWR report &middot; Data is snapshotted when generated.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const bodyText = data.report ? reportText(data.report) : (data.bodyText ?? "");
  const text = `${data.title}\n${data.weekLabel}\n\n${bodyText}\n\nInternal POWR report - data is snapshotted when generated.`;
  return { subject: data.subject, html, text };
}