// gymRecap emails — en. See ../index.ts (tBusiness) and shared/i18n/README.md
// (Portals: vous / usted). English must render each email exactly as before.
//
// The two emails a gym's team gets about its members: the Monday recap
// (recap.*, emails/gym-weekly-recap.ts) and the morning drift digest (drift.*,
// emails/gym-drift-digest.ts). Words match the portal: Overview (venueHome)
// for the week's numbers, Retention (venueMembers) for who's drifting.
//
//   - keys ending in Html go into the HTML as written: they may hold entities
//     (&middot; &nbsp; &#8212;) and markup placeholders — {{newline}} = a line
//     break everywhere, {{br}} = a line break on desktop only, {{strong}}/
//     {{em}}/{{link}} … {{end}} = the opening tag and its closing tag around
//     the words between them. busiestHtml and driftingHtml also make the
//     plain-text line, with {{strong}}/{{end}} empty: no entities in those.
//   - every other key is plain text, for the text part and the HTML alike.
//     Most go into the HTML as they are (the template escapes only what it
//     fills in: names, the gym), so keep & < > out of them; the notice lines,
//     drift.totals and retention.* are escaped whole.
//   - plural keys that never vary in English are identical, so French and
//     Spanish can agree with the number.
//   - retention.* mirrors _shared/retentionCopy.ts (and the portal's
//     venueMembers retention words). English renders through retentionCopy
//     itself; these English strings are only the fallback and the reference.
import type { Catalog } from "../t.ts";

const catalog: Catalog = {
  common: {
    /** Portal nav name for /venue/retention. */
    retention: "Retention",
    seeWho: "See who in Retention.",
    /** Text part: a button's words and where it goes. */
    link: "{{label}}: {{url}}",
  },
  recap: {
    /** The week, "15–21 Sep" or "29 Sep – 5 Oct" (day and short month in the language's own format). */
    weekLabel: {
      sameMonth: "{{from}}–{{to}} {{month}}",
      twoMonths: "{{from}} {{fromMonth}} – {{to}} {{toMonth}}",
    },
    subject_one: "{{gym}} on POWR: {{n}} session last week",
    subject_other: "{{gym}} on POWR: {{n}} sessions last week",
    subjectQuiet: "{{gym}} on POWR: last week",
    preheader_one: "{{week}}: {{n}} athlete trained here.",
    preheader_other: "{{week}}: {{n}} athletes trained here.",
    preheaderNew_one: "{{week}}: {{n}} athlete trained here, {{newFaces}} for the first time.",
    preheaderNew_other: "{{week}}: {{n}} athletes trained here, {{newFaces}} for the first time.",
    /** Added after the preheader when someone topped the board. */
    preheaderTop: "{{name}} topped the board.",
    preheaderQuiet: "{{week}}: nothing logged at {{gym}}. The board on the TV and the poster by the door bring people back.",
    /** <title> */
    title: "Your week at {{gym}}",
    eyebrowHtml: "Your gym's week &middot; {{week}}",
    headingHtml: "Your week,{{newline}}{{em}}{{gym}}.{{end}}",
    lead: "Here's what your members did at {{gym}} last week.",
    leadQuiet: "Nothing was logged at {{gym}} last week. The board on the TV and the poster by the door are what get members checking in.",
    sessions_one: "{{n}} session",
    sessions_other: "{{n}} sessions",
    tiles: {
      sessions: "Sessions",
      athletes: "Athletes",
      newFaces: "New faces",
      firstSession: "first session here",
      /** {{arrow}} = ▲ or ▼. */
      deltaHtml: "{{arrow}}&nbsp;{{n}} vs the week before",
      levelHtml: "&#8212; level with the week before",
    },
    top: {
      title: "Top of the board",
      sub: "As your screen showed it, Monday to Sunday.",
    },
    notice: {
      title: "Since we told your members",
      /** After the big number of people back. */
      backLabel_one: "back through the door",
      backLabel_other: "back through the door",
      back_one: "{{n}} back through the door.",
      back_other: "{{n}} back through the door.",
      /** {{told}} = notice.people. Counted on how many were away. */
      lead_one: "Of the {{n}} who was away when POWR told {{told}} you're on POWR, on {{date}}.",
      lead_other: "Of the {{n}} who were away when POWR told {{told}} you're on POWR, on {{date}}.",
      people_one: "{{n}} person",
      people_other: "{{n}} people",
      /** Everyone told was already a regular. Counted on how many were told. */
      allRegular_one: "On {{date}} POWR told {{n}} person who trains at {{gym}} that you're on POWR. They were already coming in regularly.",
      allRegular_other: "On {{date}} POWR told {{n}} people who train at {{gym}} that you're on POWR. Every one of them was already coming in regularly.",
      behind_one: "{{back}} of the {{away}} who had fallen behind their usual visits",
      behind_other: "{{back}} of the {{away}} who had fallen behind their usual visits",
      unseen_one: "{{back}} of the {{unseen}} who hadn't been in for six months or more",
      unseen_other: "{{back}} of the {{unseen}} who hadn't been in for six months or more",
      lastWeek_one: "{{n}} of them came back last week",
      lastWeek_other: "{{n}} of them came back last week",
      footnote: "Back = a POWR check-in at {{gym}} since. Away = behind their own usual gap between visits, or not in for six months, on the day.",
    },
    also: {
      title: "Also last week",
      busiestHtml_one: "Busiest day: {{strong}}{{day}}{{end}}, {{n}} session.",
      busiestHtml_other: "Busiest day: {{strong}}{{day}}{{end}}, {{n}} sessions.",
      driftingHtml_one: "{{strong}}{{n}} regular is drifting{{end}}: well past their usual gap between visits.",
      driftingHtml_other: "{{strong}}{{n}} regulars are drifting{{end}}: well past their usual gap between visits.",
      nobody: "Nobody is drifting.",
    },
    events: {
      title: "Your events",
      joined_one: "{{n}} person in",
      joined_other: "{{n}} people in",
      /** Before the line of an event POWR runs at the gym. */
      runByPowr: "Run by POWR · {{line}}",
      pending: "With POWR for a check",
      rejected: "POWR asked for a change: open it in the portal",
      scheduled: "Starts {{date}} · {{joined}}",
      live: "Live · {{joined}} · last day {{date}}",
      locked: "Board sealed · {{joined}} · reveal the winners from your phone",
      revealed: "Winners revealed {{date}} · hand over the prizes",
    },
    cta: {
      button: "Open your portal",
      sub: "Members, events, the Studio and your screens, all in the portal.",
    },
    footerHtml: "You get this every Monday because you're on the team at {{gym}} on POWR. Turn it off under {{link}}Settings{{end}} in the portal.",
    text: {
      heading: "Your week, {{gym}} — {{week}}",
      sessions: "Sessions: {{n}} (the week before: {{prev}})",
      athletes: "Athletes: {{n}} (the week before: {{prev}})",
      newFaces: "New faces: {{n}}",
      topRow: "{{rank}}. {{name}} — {{points}} POWR, {{sessions}}",
      eventRow: "- {{name}}: {{line}} — {{url}}",
      footer: "You get this every Monday because you're on the team at {{gym}} on POWR. Turn it off under Settings in the portal: {{url}}",
    },
  },
  drift: {
    subject: "{{headline}} at {{gym}}",
    /** The headline: one named person, or how many. */
    headlineNamed: "{{name}} is drifting",
    headline_one: "{{n}} person is drifting",
    headline_other: "{{n}} people are drifting",
    titleNamedHtml: "{{name}} is {{em}}drifting.{{end}}",
    titleHtml_one: "{{n}} person is{{br}} {{em}}drifting.{{end}}",
    titleHtml_other: "{{n}} people are{{br}} {{em}}drifting.{{end}}",
    body_one: "They've gone well past their usual gap between visits. A call or a text from the team now is easier than winning them back later.",
    body_other: "Each has gone well past their usual gap between visits. A call or a text from the team now is easier than winning them back later.",
    /** The first sentence of body. */
    preheader_one: "They've gone well past their usual gap between visits.",
    preheader_other: "Each has gone well past their usual gap between visits.",
    /** {{quiet}} = "12 days quiet"; {{rest}} = their usual pattern, or common.seeWho. */
    preheaderNamed: "{{name}}: {{quiet}}. {{rest}}",
    /** {{drifting}} and {{slipping}} = the counts below. */
    totals: "In all at {{gym}} right now: {{drifting}}, {{slipping}}.",
    drifting_one: "{{n}} drifting",
    drifting_other: "{{n}} drifting",
    slipping_one: "{{n}} slipping",
    slipping_other: "{{n}} slipping",
    newly: "Newly drifting",
    more_one: "And {{n}} more in Retention.",
    more_other: "And {{n}} more in Retention.",
    whoTitle: "Who they are",
    whoBody: "Clash Pro names them, with when they usually come in and a one-tap nudge from POWR.",
    ctaNamed: "See who's drifting",
    ctaOpen: "Open Retention",
    footerHtml: "You get this on mornings when someone at {{gym}} starts drifting. Visits only, from POWR check-ins; members can switch this off in the app. Turn these emails off under {{link}}Settings{{end}} in the portal.",
    textRow: "- {{name}}: {{quiet}}",
    textRowPattern: "- {{name}}: {{quiet}} ({{pattern}})",
    textFooter: "You get this on mornings when someone at {{gym}} starts drifting. Turn it off under Settings in the portal: {{url}}",
  },
  retention: {
    quiet: {
      days_one: "{{count}} day quiet",
      days_other: "{{count}} days quiet",
      weeks_one: "{{count}} week quiet",
      weeks_other: "{{count}} weeks quiet",
    },
    frequency: {
      mostDays: "most days",
      perWeek: "{{n}}× a week",
      weekly: "about once a week",
      fortnightly: "every couple of weeks",
    },
    pattern: {
      base: "Usually {{frequency}}",
      withPart: "Usually {{frequency}}, {{part}}",
      /** "Mon, Wed & Fri": the last two weekdays. */
      lastDay: "{{rest}} & {{last}}",
    },
    dayParts: {
      morning: "mornings",
      midday: "lunchtimes",
      afternoon: "afternoons",
      evening: "evenings",
    },
  },
};

export default catalog;
