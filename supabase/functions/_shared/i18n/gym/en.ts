// gym emails — en. See ../index.ts (tBusiness) and shared/i18n/README.md
// (Portals: vous / usted). English must render each email exactly as before.
//
// What POWR writes to a gym's team about its own account and events:
// event (results ready, POWR's review), welcome, inviteReminder, trial,
// package, support (POWR's answer), clashNight, invite (the setup link), and
// features (what each package switches on). The Monday recap and the drift
// digest are gymRecap.*.
//
//   - keys ending in Html go into the HTML as written: {{br}} = a line break
//     on desktop only, {{newline}} = one everywhere, {{gold}} … {{end}} = the
//     gold italic accent around the words between them. Names arrive escaped.
//   - every other key is plain text (subject, preheader, the text/plain part)
//     or is escaped where the template escapes it.
//   - {{n}} is a number already formatted for the language; `count` (never
//     shown) picks the _one / _other form.
//   - Names, notes and answers typed by POWR staff or the gym stay as typed.
import type { Catalog } from "../t.ts";

const catalog: Catalog = {
  common: {
    /** Plain-text part: a list row or a link ("Choose a package: https://…"). */
    labelValue: "{{label}}: {{value}}",
    /** Eyebrow over the heading, and the first line of the text part. */
    portalEyebrow: "{{gym}} · Gym portal",
    /** French and Spanish only ("samedi 10 octobre à 13:00"): English keeps "Sat 10 Oct, 13:00" from its date format. */
    dayAtTime: "{{day}}, {{time}}",
    noteFromPowr: "A note from POWR",
    carriesOn: "Carries on",
    switchedOff: "Switched off",
  },

  // What each package switches on (gymPackageWords.ts). Names match the portal.
  features: {
    events: {
      name: "Your own challenges",
      line: "Monthly challenges, sprints and finale nights, plus partner discounts for buying prizes",
    },
    insights: {
      name: "Members and Retention",
      line: "What your members do, when they come in, and how many are slipping from their usual visits",
    },
    people: {
      name: "Retention by name",
      line: "Who’s drifting, the morning email when someone starts, and the one-tap nudge",
    },
    studio: {
      name: "Studio and event kits",
      line: "Your photos and clips turned into posts, reels and posters at every size",
    },
    /** What the free package always keeps; the start of package.carryOn and trial.carryOn. */
    alwaysOn: "Your board on the TV, Gym Clash against the gyms near you, and your live ranking",
  },

  event: {
    /** Under the button. {{gym}} arrives escaped. */
    sentToTeamHtml: "Sent to the team at {{gym}} on POWR.",
    resultsReady: {
      subject: "{{event}}: the results are in",
      heading: "The results are in.",
      headingHtml: "The results{{br}} are {{gold}}in.{{end}}",
      body: "The board for {{event}} sealed after {{day}} and the results are set. Reveal the winners from your phone when you're ready: everyone in it gets a notification and your screen flips at the same moment.",
      /** Added after body when POWR has a reveal time. */
      safety: "If nobody does, POWR reveals them {{when}}.",
      preheader: "Reveal the winners from your phone when you're ready.",
      preheaderLeader: "{{name}} leads. Reveal from your phone when you're ready.",
      cta: "Reveal the winners",
      podium: "The podium, as it stands",
      podiumSub: "Only your team can see this until you reveal it.",
      podiumText: "THE PODIUM, AS IT STANDS (only your team can see this until you reveal it)",
    },
    approved: {
      subject: "{{event}} is on",
      heading: "It's on.",
      headingHtml: "It's {{gold}}on.{{end}}",
      body: "POWR checked {{event}} and it's in the app for your members from now. Scoring starts {{day}}.",
      /** Added after body when the gym's events no longer need a check. */
      trusted: "From here your events go straight out, no check.",
      preheader: "{{event}} is in the app. Scoring starts {{day}}.",
      cta: "See the event",
    },
    rejected: {
      subject: "{{event}}: one change before it goes out",
      heading: "One change, then it's on.",
      headingHtml: "One change,{{br}} then it's {{gold}}on.{{end}}",
      body: "POWR looked at {{event}} and asked for a change before it goes out. Edit it in the portal and send it again; it's usually approved within a day.",
      preheader: "Edit {{event}} and send it again.",
      cta: "Edit the event",
      label: "What to change",
      noNote: "Open the event for the note.",
      /** The same, after "What to change: " in the text part. */
      noNoteText: "open the event for the note.",
    },
    pulled: {
      subject: "{{event}} was pulled",
      heading: "POWR pulled {{event}}.",
      headingHtml: "POWR pulled{{br}} {{gold}}{{event}}.{{end}}",
      body: "It no longer shows in the app for anyone. If that's a surprise, reply to this email and a person will look.",
      bodyJoined_one: "It no longer shows in the app for anyone, including the {{n}} person who had joined. If that's a surprise, reply to this email and a person will look.",
      bodyJoined_other: "It no longer shows in the app for anyone, including the {{n}} people who had joined. If that's a surprise, reply to this email and a person will look.",
      preheader: "It no longer shows in the app. Reply if that's a surprise.",
      cta: "Open the event",
      label: "The reason",
      noNote: "Reply to this email and we'll explain.",
      noNoteText: "reply to this email and we'll explain.",
    },
  },

  welcome: {
    owner: {
      subject: "Welcome to POWR, {{gym}}",
      heading: "You're in.",
      headingHtml: "You're {{gold}}in.{{end}}",
      body: "{{gym}}'s portal is ready. Here's what to do first, in the order that gets your members checking in.",
      preheader: "Board on the TV, poster by the door, logo in the app. Here's the order to do it in.",
      list: "Your first week",
      cta: "Open your portal",
    },
    staff: {
      subject: "You're on the team at {{gym}}",
      heading: "You're on the team.",
      headingHtml: "You're on{{br}} the {{gold}}team.{{end}}",
      body: "You can now use {{gym}}'s portal on POWR: the screens, who's training this week, and your events.",
      preheader: "Your login for {{gym}}'s portal works now.",
      list: "What it's for",
      cta: "Open the portal",
    },
    /** The owner's first jobs, in order. */
    steps: {
      board: { title: "Put your board on the TV", line: "A live weekly leaderboard of who's training at your gym, and Gym Clash against the gyms near you. The links are under Screens." },
      poster: { title: "Print the join poster", line: "A QR code for the front desk and the changing rooms. It opens your gym in the POWR app." },
      logo: { title: "Add your logo and a photo", line: "It's how your gym looks in the app. Tap them on the Overview to change them." },
      team: { title: "Bring your team in", line: "Give the people who run the floor their own login, under Settings." },
    },
    /** What the portal is for, for the rest of the team. */
    staffSteps: {
      week: { title: "See who's in this week", line: "The Overview has this week's sessions, the top of your board and who's new." },
      screens: { title: "Run the screens", line: "Screens has the links for the TV: your gym's board and Gym Clash." },
      events: { title: "On event nights", line: "Open the event on your phone to see who's in and to hand over the prizes." },
    },
    members: "Your members",
    /** The members' notice is still to go out (it sends between 10:00 and 20:00). */
    noticeSoon: "POWR is about to let the people who train at {{gym}} know you're on POWR, with a notification on their phone between 10am and 8pm. Every Monday your recap shows how many of them have been back since.",
    noticeSent_one: "On {{day}} POWR let {{n}} person who trains at {{gym}} know you're on POWR. Every Monday your recap shows how many of them have been back since.",
    noticeSent_other: "On {{day}} POWR let {{n}} people who train at {{gym}} know you're on POWR. Every Monday your recap shows how many of them have been back since.",
    trial: "Your free trial",
    trialLine: "Everything in the portal is switched on until {{day}}, the end of your free trial. We'll write before then.",
    /** The text part's link line, owner and staff alike. */
    openThePortal: "Open the portal",
    questions: "Questions? Reply to this email and a person at POWR will answer.",
  },

  inviteReminder: {
    subjectOwner: "Your POWR portal for {{gym}} is waiting",
    subjectStaff: "Your login for {{gym}} on POWR is waiting",
    heading: "Still waiting for you.",
    headingHtml: "Still waiting{{br}} for {{gold}}you.{{end}}",
    body: "You were invited to {{gym}}'s portal on POWR on {{invited}}, and the link hasn't been used yet. This one works too, once, until {{expires}}.",
    inside: "What's inside",
    insideOwner: "Your gym's board on the TV, Gym Clash against the gyms near you, and who's training, week by week.",
    insideStaff: "{{gym}}'s screens, who's training this week, and your events.",
    cta: "Set up your login",
    notYou: "Not the right person? Reply to this email and we'll sort it out.",
    preheader: "The link works once, until {{day}}.",
  },

  trial: {
    eyebrow: "{{gym}} · Free trial",
    /** The package a gym drops to, when it is the free one. */
    clashFree: "Clash, the free one",
    subjectEnded: "{{gym}}: your free trial has ended",
    subjectEnds: "{{gym}}: your free trial ends {{day}}",
    subjectDays_one: "{{gym}}: {{n}} day left on your free trial",
    subjectDays_other: "{{gym}}: {{n}} days left on your free trial",
    headingEnded: "Your trial has ended.",
    headingEndedHtml: "Your trial{{br}} has {{gold}}ended.{{end}}",
    heading_one: "{{n}} day left.",
    heading_other: "{{n}} days left.",
    headingHtml_one: "{{n}} day {{gold}}left.{{end}}",
    headingHtml_other: "{{n}} days {{gold}}left.{{end}}",
    bodyEnded: "{{gym}} is now on {{name}}. These are switched off until you pick a package:",
    body: "Your free trial ends on {{day}}. Unless you pick a package, {{gym}} moves to {{name}}, and these switch off:",
    preheaderEnded: "{{gym}} is on {{name}}. Pick a package to switch the rest back on.",
    preheader: "After {{day}}, {{gym}} stays on {{name}} unless you pick a package.",
    switchesOff: "Switches off",
    carryOn: "{{alwaysOn}} carry on, whatever you pick. Anything already running finishes: an event that's live when the trial ends still reveals its winners.",
    cta: "Choose a package",
    talk: "Reply to this email if you'd like to talk it through first.",
  },

  package: {
    eyebrow: "{{gym}} · Package",
    subject: "{{gym}} is on {{name}}",
    subjectFounding: "{{gym}} is a Founding Pro gym",
    heading: "You're on {{name}}.",
    headingHtml: "You're on{{br}} {{gold}}{{name}}.{{end}}",
    headingFounding: "Welcome, founding gym.",
    headingFoundingHtml: "Welcome, founding{{br}} {{gold}}gym.{{end}}",
    moved: "POWR has moved {{gym}} to {{name}}.",
    movedYearly: "POWR has moved {{gym}} to {{name}}, billed yearly.",
    movedMonthly: "POWR has moved {{gym}} to {{name}}, billed monthly.",
    /** Added after moved*: down a package while the trial runs. */
    downTrial: "Your free trial keeps everything switched on until {{day}}.",
    /** Added after moved*: down a package, the list below follows. */
    downNow: "These are switched off now:",
    /** Added after moved*: up a package while the trial runs. */
    upTrial: "Your free trial still runs until {{day}}; after it, you keep everything below.",
    nights: {
      title: "Clash Nights",
      line: "Four a year, one a quarter. POWR brings the DJ, the photographer and partner prizes. Book your dates in the portal.",
    },
    founding: {
      title: "Founding gym",
      line: "Your price is locked when you renew, and Gym Clash shows your gym as a founding gym.",
    },
    yoursNow: "Yours now",
    preheaderDown: "{{gym}} is on {{name}}. Your board and Gym Clash carry on.",
    preheaderUp: "{{name}}. Here's what it switches on.",
    preheaderUpYearly: "{{name}}, billed yearly. Here's what it switches on.",
    preheaderUpMonthly: "{{name}}, billed monthly. Here's what it switches on.",
    carryOn: "{{alwaysOn}} carry on.",
    cta: "See your package",
    billing: "Questions about billing? Reply to this email.",
  },

  support: {
    eyebrow: "{{gym}} · POWR support",
    /** When the question had no subject. */
    yourQuestion: "Your question",
    heading: "POWR answered.",
    headingHtml: "POWR {{gold}}answered.{{end}}",
    headingUpdated: "POWR updated its answer.",
    headingUpdatedHtml: "POWR updated{{br}} its {{gold}}answer.{{end}}",
    lead: "Here's our answer to \"{{subject}}\".",
    leadUpdated: "We've changed our answer to \"{{subject}}\". Here it is in full.",
    ourAnswer: "Our answer",
    youAsked: "You asked",
    cta: "See it in your portal",
    carryOn: "Reply to this email to carry on the conversation.",
  },

  clashNight: {
    confirmed: {
      subject: "Clash Night confirmed: {{day}}",
      heading: "It's confirmed.",
      headingHtml: "It's {{gold}}confirmed.{{end}}",
      body: "{{gym}}'s Clash Night is on {{day}}. POWR brings the DJ, the photographer and partner prizes. We'll be in touch about the plan for the night.",
      bodyTime: "{{gym}}'s Clash Night is on {{day}} from {{time}}. POWR brings the DJ, the photographer and partner prizes. We'll be in touch about the plan for the night.",
      cta: "See your Clash Nights",
    },
    calledOff: {
      subject: "Clash Night on {{day}} is off",
      heading: "We've had to call it off.",
      headingHtml: "We've had to{{br}} call it {{gold}}off.{{end}}",
      body: "POWR has called off {{gym}}'s Clash Night on {{day}}. We're sorry for the change. The quarter is free again: pick another date and we'll confirm it.",
    },
    declined: {
      subject: "Clash Night on {{day}}: pick another date",
      heading: "Not that night.",
      headingHtml: "Not that {{gold}}night.{{end}}",
      body: "POWR can't do {{day}} for {{gym}}'s Clash Night. The quarter is still yours: pick another date and we'll confirm it.",
      bodyBackup: "POWR can't do {{day}} or {{backup}} for {{gym}}'s Clash Night. The quarter is still yours: pick another date and we'll confirm it.",
    },
    pickAnother: "Pick another date",
    before: "Before the night",
    prep: "Tell your members early: it's the night of the quarter. The join poster and the Studio are in your portal for exactly this.",
    questions: "Questions about the night? Reply to this email.",
  },

  // The setup link (manage-gym-staff create_invite). The reader may not have a
  // POWR account yet: it goes out in the language of whoever sent it.
  invite: {
    subjectOwner: "Set up {{gym}} on POWR",
    subjectStaff: "You're invited to the {{gym}} team on POWR",
    subjectStaffBy: "{{inviter}} added you to the {{gym}} team on POWR",
    preheaderOwner: "Your gym portal is ready: screens, insights and your team, in one place. Takes a minute to set up.",
    preheaderStaff: "Join the {{gym}} team on POWR. Takes a minute to set up.",
    /** First line of the text part. */
    headingOwner: "Run {{gym}} on POWR.",
    headingStaff: "Join the {{gym}} team on POWR.",
    headingOwnerHtml: "Run {{gym}}{{newline}}{{gold}}on POWR.{{end}}",
    headingStaffHtml: "Join the{{newline}}{{gold}}{{gym}} team.{{end}}",
    /** Used in the HTML as written (names arrive escaped) and in the text part. */
    introOwner: "Your gym portal is ready. Set up your login below and you're in. Already use the POWR app? Sign in with that same account.",
    introStaff: "You've been invited to help run {{gym}} on POWR. Set up your login below. Already use the POWR app? Sign in with that same account.",
    introStaffBy: "{{inviter}} has invited you to help run {{gym}} on POWR. Set up your login below. Already use the POWR app? Sign in with that same account.",
    labelOwner: "Gym Portal",
    labelStaff: "Gym Team",
    cta: "Set up your access",
    /** Text part, above the link. */
    ctaText: "Set up your access:",
    pasteLink: "Or paste this link into your browser:",
    inPortal: "In the portal you can",
    steps: {
      board: { title: "Put your leaderboard on the gym TV", line: "A live weekly board of who's training at your gym, plus Gym Clash against every other POWR gym" },
      coming: { title: "See who's coming in", line: "Athletes, sessions and busiest hours, week by week" },
      team: { title: "Bring your team in", line: "Give the people who run the floor their own login" },
    },
    /** Text part: one step. */
    stepText: "{{n}}. {{title}} — {{line}}",
    footerHtml: "This link works once and expires in 14 days. Didn&#8217;t expect it? Reply to this email and we&#8217;ll sort it.",
    footer: "This link works once and expires in 14 days. Didn't expect it? Reply to this email and we'll sort it.",
  },
};

export default catalog;
