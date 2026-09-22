export interface BrandInviteData {
  /** The reward brand the recipient is being invited to manage. */
  brandName: string;
  /** Single-use setup link — /partner/setup/{token}. The credential itself. */
  setupUrl: string;
  /** Optional brand logo (falls back to the POWR mark). */
  logoUrl?: string | null;
  /** Optional first name for the greeting ("Hi Cara,"). */
  contactName?: string | null;
  /**
   * When set, the email is the "your reward is approved" variant sent from the
   * admin Submissions queue: it names the reward and walks the partner through
   * getting it live. Without it, the generic "you're invited" variant is sent.
   */
  rewardTitle?: string | null;
  /** How the partner chose to deliver codes — shapes step 2 of the approved variant. */
  deliveryMethod?: "code_pool" | "shopify" | "api" | "affiliate" | "manual_fulfilment" | null;
  /** Brand accent (rewards.brand_color, e.g. "#c6a13e") — tints the small pill dot. CTA stays POWR gold. */
  brandColor?: string | null;
}

const GOLD = "#E8D200";
const POWR_LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) =>
  s.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();

interface Step { title: string; detail: string }

function stepsFor(data: BrandInviteData): Step[] {
  if (!data.rewardTitle) {
    return [
      { title: "Create &amp; manage your rewards", detail: "Submit new offers and edit your listings" },
      { title: "Track redemptions", detail: "See how members are engaging with your rewards" },
      { title: "Reach active members", detail: "Put your brand in front of people who show up" },
    ];
  }
  const supply: Step =
    data.deliveryMethod === "shopify"
      ? { title: "Connect your Shopify store", detail: "POWR creates a unique discount code for every redemption &mdash; nothing to upload" }
      : data.deliveryMethod === "api"
        ? { title: "Connect your system", detail: "Add your API key or mint endpoint so codes are issued automatically" }
        : data.deliveryMethod === "affiliate"
          ? { title: "Confirm your link", detail: "Check the destination URL members are sent to" }
          : data.deliveryMethod === "manual_fulfilment"
            ? { title: "Confirm how you&#8217;ll fulfil", detail: "Tell us how each redemption reaches the member" }
            : { title: "Choose how codes are delivered", detail: "Three options in the Integration tab: upload a pool of single-use codes, connect your Shopify store so POWR mints a unique code per redemption, or connect your own system through our API" };
  return [
    { title: "Set up your login", detail: "Pick your email and password &mdash; about a minute" },
    supply,
    { title: "Go live", detail: "We switch the reward on as soon as codes are in place, and you can watch redemptions come in" },
  ];
}

export function brandInviteEmail(data: BrandInviteData): { subject: string; html: string; text: string } {
  const { brandName, setupUrl } = data;
  const approved = !!data.rewardTitle?.trim();
  const rewardTitle = (data.rewardTitle ?? "").trim();
  const safeBrandNameForHeader = oneLine(brandName);
  const safeRewardTitleForHeader = oneLine(rewardTitle);
  const firstName = (data.contactName ?? "").trim().split(/\s+/)[0] ?? "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)}, ` : "";
  const steps = stepsFor(data);

  const subject = approved
    ? `${safeRewardTitleForHeader} is approved — set up your ${safeBrandNameForHeader} portal on POWR`
    : `You're invited to the ${safeBrandNameForHeader} rewards portal on POWR`;
  const preheader = approved
    ? `${safeRewardTitleForHeader} is ready to go live. Set up your ${safeBrandNameForHeader} portal to load codes and switch it on.`
    : `Set up your ${safeBrandNameForHeader} portal on POWR — pick your email and password, takes a minute.`;
  const pill = approved ? "Reward approved" : "Rewards Partner";
  const heading = approved
    ? `Your reward is<br><em style="font-style:italic;color:${GOLD};">approved.</em>`
    : `Welcome to the<br><em style="font-style:italic;color:${GOLD};">${escapeHtml(brandName)} portal.</em>`;
  const intro = approved
    ? `${greeting}<strong style="font-weight:500;color:#bbbbbb;">${escapeHtml(rewardTitle)}</strong> is ready to go live on POWR.<br>Set up your ${escapeHtml(brandName)} portal to load codes and switch it on &mdash; it takes about a minute.`
    : `${greeting}You&#8217;ve been invited to manage ${escapeHtml(brandName)} rewards on POWR.<br>Set up your login below &mdash; it takes about a minute.`;
  const stepsHeading = approved ? "Three steps to live" : "In the portal you can";
  const accent = /^#[0-9a-f]{6}$/i.test(data.brandColor ?? "") ? data.brandColor! : GOLD;
  const logoUrl = (data.logoUrl ?? "").trim();
  // The brand's own mark sits above the headline in a white tile, so dark and
  // light logos both read on the black hero. Sized by height; portrait and
  // landscape marks both fit inside the 120×56 box.
  const logoTile = logoUrl && /^https:\/\//.test(logoUrl)
    ? `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px;">
              <tr>
                <td style="background-color:#ffffff;border-radius:16px;padding:14px 22px;">
                  <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" height="56" style="display:block;height:56px;max-width:120px;width:auto;object-fit:contain;margin:0 auto;">
                </td>
              </tr>
            </table>`
    : "";

  const stepRows = steps.map((s, i) => `
              <tr>
                <td style="${i < steps.length - 1 ? "padding-bottom:18px;" : ""}vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">${i + 1}</span>
                </td>
                <td style="padding:0 0 ${i < steps.length - 1 ? "18px" : "0"} 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">${s.title}</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">${s.detail}</p>
                </td>
              </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${approved ? "Your reward is approved" : "You're invited"} — POWR Rewards Portal</title>
</head>
<body style="margin:0;padding:0;background-color:#111111;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#111111;">${escapeHtml(preheader)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
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
          <td style="background-color:#080808;padding:44px 40px 36px;text-align:center;border-bottom:1px solid #111111;">${logoTile}
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="width:6px;height:6px;background-color:${accent};border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#888888;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">${pill}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 6px;font-size:40px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${heading}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${intro}</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:8px 40px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:100px;background-color:${GOLD};">
                  <a href="${setupUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">Set up your portal</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:11px;font-weight:300;color:#444444;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Or paste this link into your browser:<br><span style="color:#666666;word-break:break-all;">${setupUrl}</span></p>
          </td>
        </tr>

        <!-- STEPS -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">${stepsHeading}</p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${stepRows}
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              This invite link is single-use and tied to your brand.<br>
              ${approved ? "Questions about your listing? Reply to this email." : "Didn&#8217;t expect this? Reply to this email and we&#8217;ll sort it."}
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const plain = (s: string) => s.replace(/&mdash;/g, "—").replace(/&#8217;/g, "’").replace(/&amp;/g, "&");
  const textSteps = steps.map((s, i) => `${i + 1}. ${plain(s.title)} — ${plain(s.detail)}`).join("\n");
  const text = approved
    ? `${firstName ? `Hi ${firstName},\n\n` : ""}${rewardTitle} is approved and ready to go live on POWR.

Set up your ${brandName} portal to load codes and switch it on — it takes about a minute:
${setupUrl}

THREE STEPS TO LIVE
${textSteps}

This invite link is single-use and tied to your brand. Questions about your listing? Reply to this email.

— POWR
https://powr.life`
    : `Welcome to the ${brandName} portal on POWR.

${firstName ? `Hi ${firstName}, you` : "You"}'ve been invited to manage ${brandName} rewards on POWR. Set up your login below — it takes about a minute.

Set up your portal:
${setupUrl}

IN THE PORTAL YOU CAN
${textSteps}

This invite link is single-use and tied to your brand. Didn't expect this? Reply to this email and we'll sort it.

— POWR
https://powr.life`;

  return { subject, html, text };
}
