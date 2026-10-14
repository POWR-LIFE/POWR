// brand emails — en. See ../index.ts (tBusiness) and shared/i18n/README.md
// (Portals: vous / usted). English must render each email exactly as before.
//
// What a reward brand's people get from POWR: the portal invite and its
// "reward approved" variant (_shared/emails/brand-invite.ts), the welcome once
// the portal is set up (partner-welcome.ts), the Monday report
// (partner-weekly-summary.ts) and the weekly setup reminder
// (partner-setup-reminder.ts). Name things as the partner portal does
// (shared/i18n/<lang>/portal/brand*.json).
//
// Same conventions as ../email/en.ts:
//   - keys ending in Html go into the HTML as written: they may hold entities
//     (&mdash; &#8217; &amp;) and markup placeholders — {{newline}} = a line
//     break everywhere, {{br}} = one on desktop only, {{em}}/{{strong}} …
//     {{end}} = the gold italic or bold words between them. Translations can
//     use plain characters (’ — U+00A0) instead of entities.
//   - every other key is plain text (subjects, preheaders, the text/plain part)
//     or is escaped where the template escapes it.
//   - plural keys (_one/_other) that never vary in English are identical, so
//     French and Spanish can agree with the number.
//   - brand names, reward titles and anything else a brand or POWR staff typed
//     arrive in {{placeholders}} as written: never translate them.
import type { Catalog } from "../t.ts";

const catalog: Catalog = {
  common: {
    /** The pill over the invite and welcome headings. */
    rewardsPartner: "Rewards Partner",
    openPortal: "Open your portal",
    text: {
      openPortal: "Open your portal: {{url}}",
    },
  },

  // ── Invite to the portal (brand-invite.ts) ───────────────────────────────────
  invite: {
    title: "POWR Rewards Portal",
    cta: "Set up your portal",
    pasteLinkHtml: "Or paste this link into your browser:",
    footerHtml: "This invite link is single-use and tied to your brand.",
    text: {
      /** One numbered step in the text part. */
      step: "{{n}}. {{title}} — {{detail}}",
    },
    // Sent from the portal's Team page or by POWR, without a reward.
    invited: {
      subject: "You're invited to the {{brand}} rewards portal on POWR",
      preheader: "Set up your {{brand}} portal on POWR — pick your email and password, takes a minute.",
      headingHtml: "Welcome to the{{newline}}{{em}}{{brand}} portal.{{end}}",
      introHtml: "You&#8217;ve been invited to manage {{brand}} rewards on POWR.{{newline}}Set up your login below &mdash; it takes about a minute.",
      /** English keeps its capital "You" after the greeting, as it always had. */
      introNamedHtml: "Hi {{name}}, You&#8217;ve been invited to manage {{brand}} rewards on POWR.{{newline}}Set up your login below &mdash; it takes about a minute.",
      stepsTitle: "In the portal you can",
      unexpectedHtml: "Didn&#8217;t expect this? Reply to this email and we&#8217;ll sort it.",
      steps: {
        createHtml: "Create &amp; manage your rewards",
        createDetailHtml: "Submit new offers and edit your listings",
        trackHtml: "Track redemptions",
        trackDetailHtml: "See how members are engaging with your rewards",
        reachHtml: "Reach active members",
        reachDetailHtml: "Put your brand in front of people who show up",
      },
      text: {
        welcome: "Welcome to the {{brand}} portal on POWR.",
        intro: "You've been invited to manage {{brand}} rewards on POWR. Set up your login below — it takes about a minute.",
        introNamed: "Hi {{name}}, you've been invited to manage {{brand}} rewards on POWR. Set up your login below — it takes about a minute.",
        setUp: "Set up your portal:",
        footer: "This invite link is single-use and tied to your brand. Didn't expect this? Reply to this email and we'll sort it.",
      },
    },
    // Sent from the admin Submissions queue when a brand's reward is approved.
    approved: {
      subject: "{{reward}} is approved — set up your {{brand}} portal on POWR",
      preheader: "{{reward}} is ready to go live. Set up your {{brand}} portal to load codes and switch it on.",
      pill: "Reward approved",
      headingHtml: "Your reward is{{newline}}{{em}}approved.{{end}}",
      introHtml: "{{strong}}{{reward}}{{end}} is ready to go live on POWR.{{newline}}Set up your {{brand}} portal to load codes and switch it on &mdash; it takes about a minute.",
      introNamedHtml: "Hi {{name}}, {{strong}}{{reward}}{{end}} is ready to go live on POWR.{{newline}}Set up your {{brand}} portal to load codes and switch it on &mdash; it takes about a minute.",
      stepsTitle: "Three steps to live",
      questionsHtml: "Questions about your listing? Reply to this email.",
      steps: {
        loginHtml: "Set up your login",
        loginDetailHtml: "Pick your email and password &mdash; about a minute",
        // Step 2 follows the delivery method the brand chose.
        shopifyHtml: "Connect your Shopify store",
        shopifyDetailHtml: "POWR creates a unique discount code for every redemption &mdash; nothing to upload",
        apiHtml: "Connect your system",
        apiDetailHtml: "Add your API key or mint endpoint so codes are issued automatically",
        affiliateHtml: "Confirm your link",
        affiliateDetailHtml: "Check the destination URL members are sent to",
        fulfilmentHtml: "Confirm how you&#8217;ll fulfil",
        fulfilmentDetailHtml: "Tell us how each redemption reaches the member",
        chooseHtml: "Choose how codes are delivered",
        chooseDetailHtml: "Three options in the Integration tab: upload a pool of single-use codes, connect your Shopify store so POWR mints a unique code per redemption, or connect your own system through our API",
        liveHtml: "Go live",
        liveDetailHtml: "We switch the reward on as soon as codes are in place, and you can watch redemptions come in",
      },
      text: {
        hi: "Hi {{name}},",
        ready: "{{reward}} is approved and ready to go live on POWR.",
        setUp: "Set up your {{brand}} portal to load codes and switch it on — it takes about a minute:",
        footer: "This invite link is single-use and tied to your brand. Questions about your listing? Reply to this email.",
      },
    },
  },

  // ── Portal set up (partner-welcome.ts) ───────────────────────────────────────
  welcome: {
    subject: "{{brand}} is live on POWR — your portal is ready",
    title: "{{brand}} is live on POWR",
    preheader: "{{brand}} is live on POWR — here's how to get your first reward in front of members.",
    greeting: "You're in.",
    greetingNamed: "You're in, {{name}}.",
    /** Gold second line of the heading, and the text part's first line after the greeting. */
    live: "{{brand}} is live on POWR.",
    introHtml: "Your portal is set up and ready. From here, everything {{brand}}{{newline}}does on POWR runs through one place.",
    stepsTitle: "Your first reward, in three steps",
    steps: {
      create: "Create your first reward",
      createDetail: "A few fields — what it is, what it's worth, how it's delivered",
      review: "We give it a quick review",
      reviewDetail: "Usually same day. You'll see the status in your portal",
      redeem: "Members start redeeming",
      redeemDetail: "Your reward goes in front of people earning points by moving",
    },
    mondayTitle: "Every Monday",
    mondayHtml: "We'll send you {{brand}}'s week in numbers &mdash; redemptions,{{newline}}POWR spent on your rewards, and what's working.",
    footerReceiving: "You're receiving this because you manage {{brand}} on POWR.",
    footerStuck: "Stuck on anything? Reply to this email and we'll sort it.",
    text: {
      intro: "Your portal is set up and ready. From here, everything {{brand}} does on POWR runs through one place.",
      create: "Create your first reward — a few fields: what it is, what it's worth, how it's delivered",
      review: "We give it a quick review — usually same day; you'll see the status in your portal",
      redeem: "Members start redeeming — your reward goes in front of people earning points by moving",
      monday: "We'll send you {{brand}}'s week in numbers — redemptions, POWR spent on your rewards, and what's working.",
    },
  },

  // ── Monday report (partner-weekly-summary.ts) ────────────────────────────────
  // Mirrors the portal's Overview: redemptions, POWR spent, live rewards.
  weekly: {
    title: "Your POWR week — {{brand}}",
    /** {{week}}: "7–13 Jul", already in the reader's language. */
    eyebrowHtml: "Partner week &middot; {{week}}",
    headingHtml: "Your week,{{newline}}{{em}}{{brand}}.{{end}}",
    subjectQuiet: "{{brand}} on POWR: your week in review",
    subject_one: "{{brand}} on POWR: {{count}} redemption this week",
    subject_other: "{{brand}} on POWR: {{count}} redemptions this week",
    preheaderQuiet: "{{week}}: a quiet week for {{brand}} — here's what can move the needle.",
    // _one fixed: English used to say "1 redemptions".
    preheader_one: "{{week}}: {{count}} redemption, {{powr}} POWR spent on {{brand}} rewards.",
    preheader_other: "{{week}}: {{count}} redemptions, {{powr}} POWR spent on {{brand}} rewards.",
    heroQuietHtml: "A quiet one for {{brand}} &mdash; no redemptions this week.{{newline}}A fresh offer or a lower-cost reward usually wakes things up.",
    heroHtml: "Here's how {{brand}} rewards performed with members this week.",
    stats: {
      redemptions: "Redemptions",
      powrSpent: "POWR spent",
      powrSpentSub: "on your rewards",
      liveRewards: "Live rewards",
      liveRewardsSub: "in the app now",
    },
    delta: {
      /** No change on last week. */
      levelHtml: "&#8212; level",
      /** After ▲ or ▼. */
      vsLastWeek: "{{diff}} vs last week",
    },
    mostRedeemed: "Most redeemed",
    /** After the count on a top reward ("12 redeemed"). */
    redeemed_one: "redeemed",
    redeemed_other: "redeemed",
    lowStock: {
      title: "Running low on codes",
      /** {{number}} is the gold count. */
      lineHtml_one: "{{strong}}{{title}}{{end}} &mdash; {{number}} code left",
      lineHtml_other: "{{strong}}{{title}}{{end}} &mdash; {{number}} codes left",
      topUp: "Top up in the portal so members never hit an empty shelf.",
    },
    pendingHtml_one: "You have {{count}} submission in review &mdash; we'll be quick.",
    pendingHtml_other: "You have {{count}} submissions in review &mdash; we'll be quick.",
    portalNoteHtml: "Full redemption history, promo codes and reward edits &mdash; all in the portal.",
    footerReceiving: "You're receiving this weekly digest because you manage {{brand}} on POWR.",
    text: {
      title: "Your week, {{brand}} — {{week}}",
      redemptions: "Redemptions: {{n}}",
      redemptionsVs: "Redemptions: {{n}} (last week: {{prev}})",
      powrSpent: "POWR spent on your rewards: {{amount}}",
      liveRewards: "Live rewards in the app: {{n}}",
      topReward_one: "{{rank}}. {{title}} — {{count}} redeemed",
      topReward_other: "{{rank}}. {{title}} — {{count}} redeemed",
      topRewardValue_one: "{{rank}}. {{title}} — {{count}} redeemed ({{value}})",
      topRewardValue_other: "{{rank}}. {{title}} — {{count}} redeemed ({{value}})",
      lowStock_one: "- {{title}}: {{count}} left — top up in the portal",
      lowStock_other: "- {{title}}: {{count}} left — top up in the portal",
      pending_one: "{{count}} submission in review — we'll be quick.",
      pending_other: "{{count}} submissions in review — we'll be quick.",
    },
  },

  // ── Weekly "finish setting up" reminder (partner-setup-reminder.ts) ─────────
  setup: {
    partnerPortal: "Partner portal",
    yourSetup: "Your setup",
    /** Tag on the step to do now. */
    next: "Next",
    notSentYet: "Not sent yet",
    /** Subject fallback when no reward is named (starts the sentence). */
    yourReward: "Your reward",
    /** The same, inside a sentence. */
    yourRewardLower: "your reward",
    // How codes reach members, once the brand has chosen.
    methods: {
      manual: {
        /** "You chose {{method}}." */
        name: "promo codes",
        done: "Promo codes: you upload single-use codes",
        title: "Upload your codes",
        todo: "Add a CSV of single-use codes under Promo Codes. A first batch is enough, and you can top it up any time.",
        cta: "Upload codes",
      },
      shopify: {
        name: "Shopify",
        done: "Shopify: a unique code for every claim",
        title: "Connect your Shopify store",
        todo: "Approve POWR in Shopify. After that we make a unique discount code for every claim, so there's nothing to upload.",
        cta: "Connect Shopify",
      },
      api: {
        name: "our API",
        done: "API: your system issues the codes",
        title: "Finish your API setup",
        todo: "Add your code endpoint, or load codes through the API. The developer docs walk through both.",
        cta: "Finish API setup",
      },
    },
    // The checklist, in order.
    rows: {
      login: "Set up your login",
      loginDone: "Done",
      loginTodo: "Pick your email and password. It takes about a minute.",
      submit: "Submit your reward",
      submitApproved: "{{reward}} is approved",
      submitApprovedUntitled: "Approved",
      submitDraft: "{{draft}} is saved as a draft. Finish it and send it to us for review.",
      submitTodo: "Describe the offer, add your logo and a photo, and send it to us for review.",
      choose: "Choose how codes reach members",
      chooseTodo: "Upload single-use codes, connect your Shopify store, or use our API. You can change it later.",
      flow: "Get codes flowing",
      flowTodo: "Then upload the codes, or finish connecting, depending on what you chose.",
      live: "We put it live",
      liveLine: "Our part. We check the codes work, switch the reward on, and you can watch every claim in the portal.",
    },
    // Heading: how many of the brand's own steps are left.
    fromLive: {
      oneHtml: "One step{{br}} {{em}}from live.{{end}}",
      one: "One step from live.",
      twoHtml: "Two steps{{br}} {{em}}from live.{{end}}",
      two: "Two steps from live.",
      threeHtml: "Three steps{{br}} {{em}}from live.{{end}}",
      three: "Three steps from live.",
      fourHtml: "Four steps{{br}} {{em}}from live.{{end}}",
      four: "Four steps from live.",
    },
    // Each step's subject, preheader, body and button. Body*Named greets the
    // contact by first name; without a name the body starts the sentence.
    login: {
      subject: "Your {{brand}} portal on POWR is still waiting",
      subjectApproved: "{{reward}} is approved — set up your {{brand}} portal to put it live",
      preheader: "Your setup link still works. It takes about a minute.",
      headingHtml: "Your portal is{{br}} {{em}}still waiting.{{end}}",
      heading: "Your portal is still waiting.",
      body: "Your invite to the {{brand}} portal on POWR hasn't been used yet. The link still works, and it takes about a minute.",
      bodyNamed: "Hi {{name}}, your invite to the {{brand}} portal on POWR hasn't been used yet. The link still works, and it takes about a minute.",
      bodyApproved: "{{reward}} is approved, but it can't go live until someone at {{brand}} sets up the portal. Your setup link still works, and it takes about a minute.",
      bodyApprovedNamed: "Hi {{name}}, {{reward}} is approved, but it can't go live until someone at {{brand}} sets up the portal. Your setup link still works, and it takes about a minute.",
      cta: "Set up your login",
    },
    submit: {
      subject: "Your {{brand}} portal is ready for its first reward",
      preheader: "Submit a reward and we'll review it. Then it's codes, and you're live.",
      body: "Your {{brand}} portal is set up, but there's no reward in it yet. Submit one and we'll review it.",
      bodyNamed: "Hi {{name}}, your {{brand}} portal is set up, but there's no reward in it yet. Submit one and we'll review it.",
      cta: "Submit a reward",
      ctaDraft: "Finish your reward",
    },
    choose: {
      subject: "{{reward}} isn't live yet — choose how codes reach members",
      preheader: "One choice in the portal, then your codes, and we switch it on.",
      body: "{{reward}} is approved, but members can't claim it yet because there's no way for codes to reach them. Choose one in the portal and you're nearly there.",
      bodyNamed: "Hi {{name}}, {{reward}} is approved, but members can't claim it yet because there's no way for codes to reach them. Choose one in the portal and you're nearly there.",
      cta: "Choose how codes arrive",
    },
    connect: {
      subject: {
        manual: "{{reward}} isn't live yet — upload your codes",
        shopify: "{{reward}} isn't live yet — connect your Shopify store",
        api: "{{reward}} isn't live yet — finish your API setup",
        none: "{{reward}} isn't live yet — finish connecting your codes",
      },
      preheader: "One more step and we switch it on.",
      preheaderMethod: "You chose {{method}}. One more step and we switch it on.",
      body: "You chose {{method}} for {{reward}}, but no codes can reach members yet. Once they can, we switch it on.",
      bodyNamed: "Hi {{name}}, you chose {{method}} for {{reward}}, but no codes can reach members yet. Once they can, we switch it on.",
      /** {{method}} when none is recorded. */
      howCodesReach: "how codes reach members",
      cta: "Finish connecting",
    },
    // A draft that never reached POWR ("Save & continue" without the last step).
    draft: {
      edit: "Your changes to {{draft}} are saved as a draft but haven't reached us. Open Rewards, click Continue, and submit them on the last step.",
      new: "Your new reward {{draft}} is saved as a draft but hasn't reached us. Open Rewards, click Continue, and submit it on the last step.",
    },
    small: "Questions, or not the right person? Reply and a person at POWR will answer.",
    /** {{emails}}: the portal's logins, "a@x.com or b@x.com". */
    smallSignIn: "Sign in as {{emails}}. Questions, or not the right person? Reply and a person at POWR will answer.",
    text: {
      done: "[done]",
      next: "[next]",
      row: "{{mark}} {{title}}: {{line}}",
      cta: "{{cta}}: {{url}}",
    },
  },
};

export default catalog;
