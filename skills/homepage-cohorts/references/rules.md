# Writing cohort rules

`scripts/cohort-rules.js` is plain data, read by the browser (to decide) and by
`size.js` / `review.js` (to size and measure). Start from `engine/cohort-rules.js`.

## Fields

| Field | Meaning |
| --- | --- |
| `experiment` | the homepage's `Experiment` metadata value, as a class name |
| `intents` | `[[id, regex], ...]`: interests named by campaign tags and paths visited, first match wins |
| `memory` | `storeKey`, `sessionGapMs`, `requireConsent`, `signIn` (CSS selector of sign-in controls) |
| `experiences` | `{ id: { label, sub } }`: what each experience is (Sankey, review, video, demo panel) |
| `sources` | named entry sources for the Sankey: `{ id, label, referrer: [hosts] }` |
| `rules` | ordered; first match wins (below) |
| `scenarios` | demo panel visitors: `[label, urlParams, memory?]` |
| `pocPath` | the cohort page, default `/new` |

A rule:

```js
{
  id: 'ai-referred',              // stable: it is the `audience` checkpoint source; renaming breaks month-over-month
  label: 'Sent by an AI assistant',
  experience: 'prospect',         // Section Metadata `Cohorts` key
  intent: 'utm',                  // 'utm' | 'memory' | false; default: campaign tags, else top interest
  when: { source: 'ai' },         // conditions, all must hold
  goal: { click: 'pricing|quote' }, // what success means for THIS cohort (review.js)
  model: { click: 'login' },      // only for memory rules: how size.js estimates them from Optel
}
```

`when` conditions (all must hold; an array means "any of"):

| Condition | Example | From |
| --- | --- | --- |
| `source` | `'ai'`, `['search', 'social']` | referrer class: `direct internal search social ai other`. `ai` = an AI referrer or `utm_source`, unless a search referrer (organic search) or an ad click id (`paid`, e.g. ChatGPT ads `['openai']`) |
| `referrer` | `['portal.example.com']` | referrer host or a parent domain |
| `utm` | `{ medium: '^(paid|cpc)$', any: 'spring' }` | regex per tag; `any` = campaign, content or term |
| `paid` | `true`, `['google', 'openai']` | ad click ids on the URL (gclid, fbclid, msclkid, oppref, ...) |
| `device` | `'mobile'` | user agent, `userAgentData.mobile`, or width < 600 px |
| `signedIn` | `true` | memory: this browser clicked a `memory.signIn` control |
| `visits` | `{ min: 2 }`, `{ max: 1 }` | memory: visits including this one |
| `interest` | `true`, `['pricing']` | memory: top interest from pages visited |
| `intent` | `['pricing']` | intent from campaign tags, else top interest |
| `any` | `[{ paid: true }, { utm: { medium: 'email' } }]` | at least one nested clause |

Unknown conditions never match (a typo turns a rule off; the tests catch it).

`goal`: `{ click: regex }` on click selector + target, `{ navigate: true }` (clicked through
to another page), or `{ checkpoint: 'formsubmit' }`. Default: any click that is not the
cookie banner.

## Designing the set

1. **Start from what Optel shows on the homepage** (`--path / --report page`): who comes
   (channels, devices), what they click, how many do nothing. Typical findings: most clicks
   go to one small link (sign-in); a third do nothing; campaign and AI traffic land on deep
   pages, not the homepage (then those cohorts are small; say so).
2. **Order by certainty, then value.** Explicit signals (came from the portal, an ad, an AI
   assistant) before memory (signed in before, returning with an interest) before weak
   signals (device). A visitor who matches several rules gets the most certain one.
3. **Few experiences, more rules.** Several rules can share an experience (portal and
   signed-in-before both get `customer`). Rules stay separate so each is measured.
4. **Size before building** (`size.js`). Drop or merge cohorts under ~2% of views unless
   they are high value (prospects shopping); they cost content and won't reach significance.
5. **Modelled rules are estimates.** Memory is on the device; Optel cannot see it. `model`
   says which of today's views would be recognised next visit. Never model with the page's
   main action: on a site where "Menu" is what everyone clicks, "clicked a product page"
   puts half the traffic into "returning with an interest". Report modelled shares as
   ranges and replace them with measured ones after the first month (review.js measures
   what the rules actually matched).
   size.js applies modelled memory only to views no referrer, tag or device rule matches:
   memory is modelled from the view's own clicks, so letting it take other rules' views would
   move exactly the views that reached a goal (a searcher who clicked a service page) into the
   memory rule, leaving the search rule at ~0%. For the same reason a modelled rule has no
   goal rate today (`today.goalRate: null`): its views were chosen by clicking.
   `model.click` also sets the rule's `when.interest`, so interest rules can be modelled from
   a click pattern as well as from `clickIntent`.
6. **One goal per rule, the cohort's own job**: sign-in for customers, quote or contact for
   prospects, any navigation for mobile explorers. Not "any click" everywhere.
7. **Read `today.topClicks` before you pick a rule's experience.** "Clicked an ad" is not
   "prospect" on a well-known brand: brand search ads (`gclid` with no product or offer tag) are
   largely customers typing the brand to sign in. On one telco homepage the brand-search
   cohort's top clicks were the account menu and the login link, like the portal cohort's. Split
   paid rules by what the tags say (an offer or product campaign → prospect; no tag → look at the
   clicks), and give a customer-shaped paid rule a goal that counts both sign-in and shopping.
8. **Check how many views carry the tags an intent rule needs.** Large advertisers often land
   paid traffic on deep pages and send the homepage only untagged brand clicks: a
   `utm: { any: 'phone|plan|switch' }` rule sized at 0.1% on a homepage with 12% ad clicks. Before
   you design per-intent heroes (`experience:intent` sections), count the views with tags
   (`--report checkpoint:utm`). When few do, get the intent from on-device interest instead.
9. **Weak signals last, and read their size as an upper bound.** A `device` or first-visit rule
   catches everything that is left; `size.js` marks first-visit rules `firstVisitAssumed` (Optel
   cannot see visit counts, so every view is a first visit). A rule that takes half the page is
   "the rest of mobile", not a cohort: say so, or split it by what those views click.
10. **In-app referrers** (`android-app://com.google.android.googlequicksearchbox/` is the Google
   app, not your own app) are mapped to the app's site by `refHostOf()`, so write
   `referrer: ['facebook.com']`, not the package name. Look at the raw `enter` sources before
   naming a referrer after a guess.

## Privacy

Everything is first-party and on the device: referrer, URL tags, user agent, and a small
`localStorage` record (visit count, interest counts, signed-in flag). Nothing personal is
stored or sent; Optel receives only the rule id and the arm. Where consent is required
for on-device storage (GDPR, Quebec Law 25, ...), there are two levels:

- `memory.requireConsent: true`: memory is read and written only after the plugin's
  experimentation consent (`updateUserConsent(true)` from the CMP). Without it, memory rules
  never match; referrer, campaign and device rules still work.
- `Experiment Requires Consent: true` on the homepage: without consent the plugin serves
  the original homepage, no cohorts at all, and fires no experiment checkpoint.

Wire the CMP as in the plugin README ("Consent Management"). The site's privacy team decides
which level applies; record the decision in the PR.
