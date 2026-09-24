// Shared shell for every POWR email — head, preheader, header logo, footer.
//
// One place for the things that must be identical across the set: the card
// width, the mobile breakpoint, the font stack and a footer people can read.
// Templates supply only their body rows (<tr>…</tr>, each cell class="sec").

export const GOLD = "#E8D200";
export const TEXT = "#F2F2F2";
export const TEXT_DIM = "#999999";
export const TEXT_MUTE = "#777777";

// Gmail/Outlook ignore the Outfit @import, and Arial has no light cut — so the
// thin numerals rendered at regular weight there. 'Helvetica Neue' does carry
// 200/300, which restores the look on every Apple device; Arial stays last.
export const FONT = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif";

export const POWR_LOGO =
  "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";

/** Escape user-supplied text (names, gym names, titles) for HTML bodies and attributes. */
export function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Reward images are user-uploaded and can be huge (multiple MB, 8000px wide),
// which email clients (and Gmail's image proxy) refuse to load — and at native
// aspect ratio they render as giant blocks. Route Supabase storage objects
// through the on-the-fly image transform so we only ever send a small, fixed-
// size version. Non-Supabase URLs are left untouched.
export function optimizeImage(
  url: string,
  opts: { width?: number; height?: number; resize?: "cover" | "contain" } = {},
): string {
  const marker = "/storage/v1/object/public/";
  if (!url.includes(marker)) return url;
  const base = url.split("?")[0].replace(marker, "/storage/v1/render/image/public/");
  const { width = 600, height, resize } = opts;
  let q = `?width=${width}&quality=75`;
  if (height) q += `&height=${height}`;
  if (resize) q += `&resize=${resize}`;
  return `${base}${q}`;
}

/** Gold uppercase eyebrow used to title each section. */
export function sectionLabel(text: string, color = "#8F8203"): string {
  return `<span style="display:block;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${color};font-family:${FONT};">${text}</span>`;
}

/** Pill CTA. `primary` = gold fill, `ghost` = gold outline. */
export function ctaButton(label: string, href: string, variant: "primary" | "ghost" = "primary"): string {
  const cell = variant === "primary"
    ? `border-radius:24px;background-color:${GOLD};`
    : `border-radius:24px;border:1px solid #5d5514;`;
  const color = variant === "primary" ? "#080808" : GOLD;
  return `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="${cell}">
                  <a href="${href}" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:${color};font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">${label}</a>
                </td>
              </tr>
            </table>`;
}

export interface EmailShellOptions {
  /** <title> — shown by some clients as the tab/window title. */
  title: string;
  /** Inbox preview line. Plain text; escaped here. */
  preheader: string;
  /** Body rows: one or more <tr><td class="sec">…</td></tr>. */
  rows: string;
  /** Include the Mailgun unsubscribe link (marketing/lifecycle mail). Default true. */
  unsubscribe?: boolean;
}

export function emailShell(opts: EmailShellOptions): string {
  const unsubscribe = opts.unsubscribe ?? true;
  const footerLinks = [
    unsubscribe ? `<a href="%unsubscribe_url%" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe</a>` : "",
    `<a href="https://powr.life/privacy" style="color:#8a8a8a;text-decoration:underline;">Privacy Policy</a>`,
  ].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(opts.title)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600;700&display=swap');
body,table,td,th,p,span,a,h1,h2,h3,em,strong{font-family:${FONT}!important;}
@media only screen and (max-width:620px){
  .outer{padding:16px 8px!important;}
  .sec{padding-left:22px!important;padding-right:22px!important;}
  .hero-h1{font-size:28px!important;}
  .points-num{font-size:58px!important;}
  .statnum{font-size:25px!important;}
  .br-d{display:none!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:${FONT};-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${esc(opts.preheader)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;">
  <tr>
    <td class="outer" align="center" style="padding:40px 16px;">

      <table role="presentation" width="100%" bgcolor="#080808" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;table-layout:fixed;border:1px solid #1e1e1e;border-radius:20px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td class="sec" bgcolor="#080808" style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;">
            <img src="${POWR_LOGO}" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>
${opts.rows}
        <!-- FOOTER -->
        <tr>
          <td class="sec" bgcolor="#050505" style="background-color:#050505;padding:30px 40px;text-align:center;">
            <p style="margin:0 0 10px;font-size:12px;font-weight:400;color:#8a8a8a;line-height:1.6;font-family:${FONT};">Every move counts. &nbsp;&middot;&nbsp; <a href="https://powr.life" style="color:#8a8a8a;text-decoration:none;">powr.life</a></p>
            <p style="margin:0;font-size:12px;font-weight:400;color:#8a8a8a;line-height:1.6;font-family:${FONT};">${footerLinks}</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}
