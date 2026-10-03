---
name: aem-optel
description: Pull and analyze AEM Operational Telemetry (Optel, formerly RUM) data for a website with its domain key - page views, visits, traffic sources (paid/owned/earned, search, social, AI assistants), clicks and dead clicks, Core Web Vitals, 404s and JS errors, forms, scroll reach, internal journeys, A/B experiments. Use when asked about Optel, RUM, operational telemetry, real-user data, rum bundles, bundles.aem.page, a domain key, or "how is page X doing" on an AEM / Edge Delivery Services site, or when building an app, dashboard or agent step that consumes that data.
---

# AEM Optel data

AEM sites sample real page views in the browser (by default 1 in 100) and record
what happened on each sampled view: where it came from, what was clicked, what
scrolled into view, Core Web Vitals, errors. The collector groups the events of one
view into a **bundle** and serves bundles as JSON files per hour, day or month from
`bundles.aem.page`. Reading them needs the domain's **domain key**.

This skill pulls that data with `optel-client.js` (one dependency-free file, browser +
Node 18+ + CLI) and tells you how to read it without fooling yourself.

## 0. Before anything

1. **Domain**: the exact production host, e.g. `www.example.com` (`www.` matters).
2. **Domain key**: ask the user for it. It is a read credential for all of that
   domain's telemetry.
   - Put it in the environment: `export OPTEL_DOMAIN_KEY=...` (or have the user run
     `! export OPTEL_DOMAIN_KEY=...` so it never enters the transcript).
   - Never write it into a file in a repo, a URL you print, a commit, a report, or
     front-end code that ships publicly. The client redacts it from its own errors.
   - 403 `[bundler] invalid domainkey param` = wrong key for this domain. Do not retry
     with variations; ask the user.
3. **The client**: find `optel-client.js`: next to this SKILL.md when the skill was
   installed with it, otherwise at the root of the `aem-optel-clients` repo. If it is
   not on disk: `gh repo clone keepthebyte/aem-optel-clients /tmp/aem-optel-clients`.
   Requires Node 18+. `node optel-client.js --help` lists every option.

## 1. Fastest path: the CLI

```bash
node optel-client.js --domain www.example.com --last 7d --report summary
```

Output is JSON on stdout (`{ meta, data }`), progress on stderr. Pipe to `jq` or
`--out file.json`, then read the file.

| Question | Command |
| --- | --- |
| What does this domain record at all? (run first on an unfamiliar site) | `--report checkpoints` |
| Overview: views, visits, bounce, devices, top pages, channels, CWV | `--report summary` |
| One page | `--path /products/shoes --report summary` |
| A section | `--prefix /blog --report pages` |
| Where traffic comes from (paid/owned/earned, campaigns, AI assistants) | `--report sources` |
| What people click, dead clicks, exits | `--path /x --report clicks` |
| Core Web Vitals per page, worst first | `--report cwv` |
| 404s (with referrers), JS errors, broken resources | `--report errors` |
| Form funnel: seen → started → submitted, per field | `--report forms` |
| How far people scroll (blocks / images seen) | `--path /x --report reach` / `reach-media` |
| Previous and next pages for a page | `--path /x --report flows` |
| A/B tests (AEM Experimentation plugin) | `--report experiments` |
| Any checkpoint broken down by source / target | `--report checkpoint:utm` |
| Trend over time | `--report timeseries [--by hour]` |
| See the raw data shape | `--report sample` |
| Everything raw, for your own analysis | `--report raw --out bundles.jsonl` |

Range: `--last 24h|7d|30d|3m` or `--start YYYY-MM-DD --end YYYY-MM-DD`.
Filters apply while loading: `--path`, `--prefix`, `--match <regex>`, `--device mobile|desktop`.
`--top N` sets rows per table. `--org <org>` instead of `--domain` for an org-level key.

### Cost: choose the range on purpose

There is no server-side filtering: every file is downloaded whole and filtered locally.

| Range | Files fetched | Notes |
| --- | --- | --- |
| `--last 24h` | 24 hourly | seconds |
| `--last 7d` | 168 hourly | a busy domain: hundreds of MB, 10 to 60 s |
| `--last 30d` | ~30 daily | fewer requests; no hour-level detail |
| `--last 3m`+ | monthly | cheapest per day covered |

Start with `24h` or `7d` for one page. Do not load a year to answer a question about
last week. Re-use a `--report raw --out` file instead of re-downloading for follow-ups.

## 2. In code (apps, dashboards, scripts)

```js
import {
  loadBundles, byPath, byPathPrefix, summary, clickReport, trafficSources, cwvReport,
  groupBy, realViews, events, pathOf, device, weightOf, timeSeries, isVisit,
} from './optel-client.js';

const { bundles, failed } = await loadBundles({
  domain: 'www.example.com',
  domainKey,                       // runtime input, never hard-coded
  last: '7d',                      // or start/end
  filter: byPath('/products/shoes'),   // keep only what you need WHILE loading
  onChunk: (kept, { done, total }) => render(done / total), // progressive UI
});
const report = summary(bundles);
```

Building a custom metric: every report is made of the same primitives. Read the
annotated `§5 AGGREGATION PRIMITIVES` and `§3 BUNDLE HELPERS` sections of
`optel-client.js` before writing your own loops.

```js
// share of mobile views per page that clicked "add to cart"
groupBy(realViews(bundles).filter((b) => device(b) === 'mobile'), pathOf, {
  metrics: { addToCart: (g) => weightOf(g.filter((b) => events(b, 'click').some((e) => /add-to-cart/.test(e.source)))) / weightOf(g) },
});
```

**Browser apps and the key**: the bundler allows CORS from any origin, so a browser
can call it directly, but then the key is visible to anyone who opens dev tools.
Fine for an internal tool where the user types their own key (store it in
`localStorage`, not the URL). For anything public, put a small server-side proxy in
front that adds `domainkey` and pass its base URL as `endpoint`.

## 3. The data model

```js
{
  id: 'kZ3x9q', url: 'https://www.example.com/path', userAgent: 'mobile:ios',
  weight: 100,                                   // real views this sample stands for
  time: '2026-09-30T14:03:11.000Z', timeSlot: '2026-09-30T14:00:00.000Z',
  events: [{ checkpoint: 'enter', source: 'https://www.google.com/' },
           { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/cart' },
           { checkpoint: 'cwv-lcp', value: 1840, source: '.hero img' }, ...]
}
```

Checkpoints you will meet (full reference with source/target meaning: `CHECKPOINTS`
in `optel-client.js`):

| checkpoint | source | target / value | means |
| --- | --- | --- | --- |
| `enter` | referrer URL ("" = direct) | | view started a visit |
| `navigate` | previous page (same site) | `visible`/`hidden`/`prerendered` | internal navigation |
| `click` | element selector | link href/src, if any | a click |
| `viewblock` / `viewmedia` | block / media selector | media URL | scrolled into view |
| `cwv-lcp` `cwv-cls` `cwv-inp` `cwv-ttfb` | LCP element (lcp) | `value` (ms; CLS unitless) | Core Web Vitals, only some views |
| `utm` | `utm_source`, `utm_medium`, ... | value | campaign tags |
| `paid` | network (`google`, `facebook`, ...) | click-id param (`gclid`) | ad click |
| `email` | `mailchimp` / `marketo` | param | email tool click |
| `consent` | `onetrust` / `trustarc` / `usercentrics` | `show`/`hidden`/`suppressed` | cookie banner state |
| `error` | `fn@file:line:col` or field selector | message or validity type | JS error / form validation |
| `404` | referrer | | bundle `url` is the missing page |
| `missingresource` / `loadresource` | resource URL | status / duration ms | broken / slow fetches |
| `fill` / `formsubmit` / `search` / `login` / `signup` | field / form selector | form action | forms |
| `redirect` | `redirect_from` | `count:ms` (exact) or `count~ms` (estimated) | redirects before the page |
| `language` | page lang | browser lang | audience language |
| `experiment` | experiment id | variant | A/B test exposure |

Sites differ. Run `--report checkpoints` and only build on what is actually there.

## 4. Rules for correct numbers (do not skip)

1. **Weight, not count.** Views = Σ `weight`. Never `bundles.length`, never assume 100.
2. **One bundle counts once per group.** Three clicks on a button in one view = one
   view that clicked it. `groupBy()` does this; hand-rolled loops often do not.
3. **Remove bots and prerenders** (`realViews()`); all built-in reports do.
4. **It is a sample.** Report estimates as estimates ("about 12k views"), give the
   sample size, and treat groups under ~30 bundles as anecdotes. `marginOfError()`
   gives the ± range; `compareProportions()` says whether a difference is real.
5. **Visits vs views.** A visit is a view with `enter` (came from outside). Acquisition
   and bounce are per visit; clicks and reach are per view. Say which one you mean.
6. **Selectors are not names.** `#container-9fae6b6303` means nothing to a reader.
   Describe what it likely is (from block names, link targets, the live page) and
   show the raw selector next to it.
7. **Consent clicks are not engagement.** On sites with a cookie banner it is often
   the most-clicked element. `clickReport()` separates it.
8. **Dead clicks** (selector without `a`/`button`/`img` and no target) are taps on
   things that do nothing: a strong UX signal, but check the element before claiming.
9. **CWV are sparse**: only views that stayed long enough report them. Quote p75 with
   the sample count.
10. **Campaign conventions are site-specific.** If a site tags paid social as
    `utm_medium=social`, adjust `RULES.paidMedium` instead of misreporting it as earned.

## 5. Presenting results

Lead with what the data says and what to change, then the numbers that back it.
Always state: domain, path filter, date range (UTC), granularity, sampled bundles,
and any `failedFiles`. Round (`12.4k views`, `38%`), don't print raw weights.

## 6. Without Node (raw HTTP)

```bash
curl -s "https://bundles.aem.page/bundles/www.example.com/2026/09/30/14?domainkey=$OPTEL_DOMAIN_KEY" \
  | jq '[.rumBundles[] | select(.url | endswith("/products/shoes"))] | map(.weight) | add'
```

Paths: `/bundles/{domain}/{YYYY}/{MM}/{DD}/{HH}` (hour), `/{YYYY}/{MM}/{DD}` (day),
`/{YYYY}/{MM}` (month); `/orgs/{org}/bundles/...` for org keys. UTC. 404 = no data for
that slot. Same rules as section 4 apply.
