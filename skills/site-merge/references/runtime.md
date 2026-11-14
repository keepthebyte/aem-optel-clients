# From the merge to the page

The Sankey says who arrives and what they must keep. On the new site, the `homepage-cohorts`
engine does the keeping. Nothing in the engine changes; it gets one signal more.

## 1. The redirect says where the visitor came from

A redirect keeps the referrer of the original visit (a search engine, nothing), not the old
site. So every redirect of a site that moves carries its id:

```
https://www.example-shop.com/        →  https://www.example.com/?from=shop
https://www.example-shop.com/x       →  https://www.example.com/shop/x?from=shop
```

The id is the site's `id` in `merge-rules.js`. Keep other query parameters (campaign tags).

## 2. `scripts.js` turns it into the referrer

```js
import { runCohorts, runsCohorts, browserSignals } from './cohorts.js';

// cohort-rules.js: origins: { shop: 'example-shop.com', pro: 'example-pro.com' }
function originSignals() {
  if (!runsCohorts(cohortRules, getMetadata)) return undefined;
  const signals = browserSignals(cohortRules);
  const origin = (cohortRules.origins || {})[new URLSearchParams(window.location.search).get('from')];
  if (origin && !signals.bot) {
    signals.refHost = origin;
    signals.source = 'other';
  }
  return signals;
}

runCohorts(main, cohortRules, { sampleRUM, getMetadata, force, signals: originSignals() });
```

A link from the old site (before it redirects) has the referrer itself and matches the same
rules.

## 3. One rule and one experience per site that moves

First in `rules`: where a visitor's site went matters before how they got here.

```js
{
  id: 'from-shop',
  label: 'Arriving from example-shop.com',
  experience: 'shop',
  when: { referrer: ['example-shop.com'], source: 'other' },
  goal: { click: '…' },
},
```

`source: 'other'` keeps the site's own pages out when the rules are sized on that site's
bundles. If a rule lists several of the merging sites, split it the same way: sites that
never host the page by `referrer` alone, the merging sites with `source: 'other'`.

What the experience does is the audience's **keep** and **gain** from `merged.json`:

- an arrival section only this experience sees (`Cohorts: shop`, `Promote: shop`): the name
  they know, what it is called now, the way on to what they came for;
- their site first wherever the sites are listed (a block can read `window.cohorts.keys`);
- the cross-site answer moved up (`Promote` on that section).

Write the arrival copy from what the sites already say about the change. Do not promise
continuity ("your team stays") unless the owner confirmed it for that site.

## 4. Size the rules before any redirect exists

`size.js` of `homepage-cohorts` reads one page of one site. `as-redirected.js` gives it the
homepages of all the sites as they will arrive:

```bash
node scripts/as-redirected.js --rules merge-rules.js --data data/ --out data/
node ../homepage-cohorts/scripts/size.js --rules ../site/scripts/cohort-rules.js \
  --bundles data/merged-home.jsonl --site data/merged-site.jsonl --path / --out cohorts.json
```

Each site in `merge-rules.js` needs a `homePath`, and the destination `target: true`. The
result counts every entry on an old homepage as an arrival from that site. Say that it is
modelled when you show it: the shares hold only once the redirects are live, and
`secondOrder` (where people go next) covers the target site only.

## 5. Check

- `?from=<id>` shows the arrival for each site, an unknown id and no id show the default.
- Automated browsers and bots always get the default (the engine's rule); test with a normal
  browser, or force a rule with `?cohort=from-<id>`.
- Add the `from-<id>` rules to the site's rule tests.
