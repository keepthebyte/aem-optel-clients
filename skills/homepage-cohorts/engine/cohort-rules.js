/*
 * Cohort rules for the homepage. Copy to the site as scripts/cohort-rules.js and edit.
 * Order matters: the first rule that matches decides the experience.
 *
 * Every field here is read in two places:
 *   - the browser (scripts/cohorts.js) decides the page with `when`
 *   - the skill's size.js / review.js evaluate the same `when` on Optel bundles, use `model`
 *     to estimate memory-based rules from today's behaviour, and `goal` to measure each rule
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
  },

  // break out named entry sources in the Sankey (otherwise Optel's channel is used)
  sources: [
    { id: 'portal', label: 'Back from the customer portal', referrer: ['portal.example.com'] },
  ],

  rules: [
    {
      id: 'from-portal',
      label: 'Arrived from the customer portal',
      experience: 'customer',
      when: { referrer: ['portal.example.com'] },
      goal: { click: 'login|signin' },
    },
    {
      id: 'signed-in-before',
      label: 'Has signed in before',
      experience: 'customer',
      when: { signedIn: true },
      // not in Optel: views that click sign-in today are recognised on their next visit
      model: { click: 'login|signin' },
      goal: { click: 'login|signin' },
    },
    {
      id: 'ai-referred',
      label: 'Sent by an AI assistant',
      experience: 'prospect',
      when: { source: 'ai' },
      goal: { click: 'pricing|quote|contact|demo' },
    },
    {
      id: 'campaign',
      label: 'Clicked an ad or campaign link',
      experience: 'prospect',
      intent: 'utm',
      when: { any: [{ paid: true }, { utm: { medium: '^(paid|cpc|ppc|display|paid[_-]?social|email)$' } }] },
      goal: { click: 'pricing|quote|contact|demo' },
    },
    {
      id: 'returning-interest',
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
    ['Paid ad: pricing', { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'pricing-q1' }],
    ['Returning, read about product A', {}, { visits: 2, interests: { 'product-a': 3 } }],
    ['First visit on a phone', { cohort: 'mobile-first-visit' }],
  ],
};
