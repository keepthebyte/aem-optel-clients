/*
 * Cohort rules for the homepage. Copy to the site as scripts/cohort-rules.js and edit.
 * Order matters: the first rule that matches decides the experience.
 *
 * Every field here is read in two places:
 *   - the browser (scripts/cohorts.js) decides the page with `when`
 *   - the skill's size.js / review.js evaluate the same `when` on Optel bundles, use `model`
 *     to estimate memory-based rules from today's behaviour, `goal` to measure each rule and
 *     `support` for its secondary action (the convincing content the experience points to)
 *
 * Regexes are strings (case-insensitive) so the file stays plain data.
 */
export default {
  // must match the homepage metadata `Experiment` value (as a class name)
  experiment: 'homepage-cohorts',

  // product interests, from campaign tags and from pages visited (first match wins)
  intents: [
    ['pricing', 'pricing|plans|quote'],
    ['product-a', 'product-a'],
    ['product-b', 'product-b'],
    ['support', 'support|help|contact'],
  ],

  // demo panel Insights mode (cohort-insights.js): where size.js output is published, and the
  // tag on each section note. A rule's optional `goalLabel` / `supportLabel` name its goal and
  // supporting step in plain words; `pages` names paths in generated notes.
  // `notes`: the section notes by id ({ data: [{ id, note }] } or { id: note }). A section's
  // `Insight` then holds an id, not the text: Section Metadata is published with the page, the
  // notes file is previewed and not published, so its numbers stay out of the live site.
  insights: {
    src: '/cohorts/cohorts.json', notes: '/cohorts/insights.json', label: 'Optel', pages: { '/pricing': 'Pricing' },
  },

  // The first split of the optimisation: loyalty (some evidence that the visitor knows us) or
  // new / unknown (nothing says so). Every rule is in one group (`group`); the cohorts of a group
  // are optimised against each other, on the group's goal. The signals say which group a visitor
  // is in (strong, medium or weak; one weak signal is enough). `consentBefore`: the visitor
  // decided about cookies on an earlier visit, whatever they decided; someone who rejected is
  // loyalty too, and nothing more is remembered about them. Leave `relationship` out to do without.
  relationship: {
    groups: {
      loyalty: { label: 'Loyalty', sub: 'Customers and visitors who came back', goalLabel: 'sign in or pick up where they left' },
      new: { label: 'New or unknown', sub: 'Nothing says they know us: the request is all we have', goalLabel: 'take the first step' },
    },
    signals: [
      { id: 'portal', label: 'Arrived from the customer portal', strength: 'strong', when: { referrer: ['portal.example.com'] } },
      { id: 'signed-in', label: 'Signed in on this device before', strength: 'strong', when: { signedIn: true } },
      { id: 'email', label: 'Clicked an email we sent', strength: 'strong', when: { utm: { medium: '^email$' } } },
      { id: 'consent-before', label: 'Decided about cookies on an earlier visit', strength: 'medium', when: { consentBefore: true } },
      { id: 'repeat-visit', label: 'Visited before (on-device)', strength: 'weak', when: { visits: { min: 2 } } },
    ],
  },

  // the site's conversion, anywhere on the site: size.js --site lists the pages viewed right
  // before it (assists: the convincing content). Any of click / path.
  conversion: { click: 'quote|demo|contact', path: '^/(quote|contact)', label: 'ask for a quote' },

  memory: {
    storeKey: 'cohorts-v1',
    sessionGapMs: 30 * 60 * 1000,
    // true: read and write on-device memory only after experimentation consent (GDPR, Law 25, ...)
    requireConsent: false,
    // CSS selector of sign-in controls; a click marks this browser as signed in
    signIn: 'a[href*="login"], a[href*="signin"], [data-signin]',
  },

  // what each experience is, for the Sankey, the review and the video
  // (`default` = the original page)
  experiences: {
    customer: { label: 'Customer: sign-in first', sub: 'Sign in · help signing in · top tasks · one offer' },
    prospect: { label: 'Prospect: answer & act', sub: 'Repeats the ad or the interest · quote · advisor' },
    mobile: { label: 'Mobile: quick tasks', sub: 'Thumb-sized top tasks · shorter page' },
    agent: { label: 'Personal agent: plain & actionable', sub: 'Facts and prices as text · labelled actions · nothing hidden behind hover or carousels' },
  },

  // break out named entry sources in the Sankey (otherwise Optel's channel is used)
  sources: [
    { id: 'portal', label: 'Back from the customer portal', referrer: ['portal.example.com'] },
  ],

  rules: [
    {
      // An assistant browsing for one person (ChatGPT, Claude, Google, Manus, Meta agents).
      // First: the signal is explicit, and an agent matches no other rule. Small today
      // (Optel started tracking them in late 2026); kept because the layout is cheap.
      id: 'personal-agent',
      label: 'A personal AI agent is browsing',
      experience: 'agent',
      intent: 'utm',
      when: { agent: true },
      goal: { click: 'pricing|quote|contact|demo' },
    },
    {
      id: 'from-portal',
      group: 'loyalty',
      label: 'Arrived from the customer portal',
      experience: 'customer',
      when: { referrer: ['portal.example.com'] },
      goal: { click: 'login|signin' },
    },
    {
      id: 'signed-in-before',
      group: 'loyalty',
      label: 'Has signed in before',
      experience: 'customer',
      when: { signedIn: true },
      // not in Optel: views that click sign-in today are recognised on their next visit
      model: { click: 'login|signin' },
      goal: { click: 'login|signin' },
    },
    {
      id: 'ai-referred',
      group: 'new',
      label: 'Sent by an AI assistant',
      experience: 'prospect',
      when: { source: 'ai' },
      goal: { click: 'pricing|quote|contact|demo' },
      // the secondary action: AI visitors check the details before they ask (review.js tests both)
      support: { click: 'pricing|features|customers' },
      supportLabel: 'pricing, features or customers',
    },
    {
      id: 'campaign',
      group: 'new',
      label: 'Clicked an ad or campaign link',
      experience: 'prospect',
      intent: 'utm',
      when: { any: [{ paid: true }, { utm: { medium: '^(paid|cpc|ppc|display|paid[_-]?social|email)$' } }] },
      goal: { click: 'pricing|quote|contact|demo' },
    },
    {
      id: 'returning-interest',
      group: 'loyalty',
      label: 'Back with a product interest',
      experience: 'prospect',
      intent: 'memory',
      when: { visits: { min: 2 }, interest: true, source: ['direct', 'search', 'other'] },
      // not in Optel: views that click into a product page today come back with that interest
      model: { clickIntent: true },
      goal: { click: 'pricing|quote|contact|demo' },
    },
    {
      id: 'mobile-first-visit',
      group: 'new',
      label: 'First visit on a phone',
      experience: 'mobile',
      when: { device: 'mobile', visits: { max: 1 } },
      goal: { navigate: true },
    },
  ],

  // demo panel (?demo): visitors to simulate, each sets real signals
  scenarios: [
    ['No signal', {}],
    ['Back from the portal', { ref: 'portal.example.com' }],
    ['From ChatGPT', { utm_source: 'chatgpt.com' }],
    ['A personal AI agent', { agent: 'chatgpt-agent' }],
    ['Paid ad: pricing', { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'pricing-q1' }],
    ['Returning, read about product A', {}, { visits: 2, interests: { 'product-a': 3 } }],
    ['First visit on a phone', { cohort: 'mobile-first-visit' }],
    ['Came back, rejected cookies', { consent: 'rejected' }],
  ],
};
