---
name: aem-optel
description: Pull and analyze AEM Operational Telemetry (Optel, formerly RUM) data for a website with its domain key - page views, visits, traffic sources (paid/owned/earned, search, social, AI assistants), clicks and dead clicks, Core Web Vitals, 404s and JS errors, forms, scroll reach, internal journeys, A/B experiments, plus ready-made analyses: activity ladder instead of bounce, AI assistant referrals (organic vs ChatGPT ads) versus search, redirect chains and ad-click delay, dead taps, bot / AI-agent behaviour profiles, one-page briefs and period comparisons. Use when asked about Optel, RUM, operational telemetry, real-user data, rum bundles, bundles.aem.page, a domain key, or "how is page X doing" on an AEM / Edge Delivery Services site, or when building an app, dashboard or agent step that consumes that data.
---

# AEM Optel data

AEM sites sample real page views in the browser (by default 1 in 100) and record
what happened on each sampled view: where it came from, what was clicked, what
scrolled into view, Core Web Vitals, errors. The collector groups the events of one
view into a **bundle** and serves bundles as JSON files per hour, day or month from
`bundles.aem.page`. Reading them needs the domain's **domain key**.

Reference: https://www.aem.live/developer/operational-telemetry (what is collected, sampling, privacy).

This skill pulls that data with `optel-client.js` (one dependency-free file, browser +
Node 18+ + CLI) and tells you how to read it without fooling yourself.

## 0. Before anything

1. **Domain**: the exact production host, e.g. `www.example.com` (`www.` matters).
2. **Domain key**: ask the user for it. It is a read credential for all of that
   hostname's telemetry, and keys are **per hostname**: `example.com`,
   `www.example.com` and `main--site--org.aem.page` each have their own.
   - If they have none: Adobe customers request it from Adobe (account team or
     support); there is no self-service. Adobe employees with the right entitlements
     can generate one with the key tool in the Cloud Service Workspace.
   - To try things without a key, use the public demo: domain `emigrationbrewing.com`,
     key `open` (bare domain only; `www.` is rejected).
   - Put it in the environment: `export OPTEL_DOMAIN_KEY=...` (or have the user run
     `! export OPTEL_DOMAIN_KEY=...` so it never enters the transcript).
   - Never write it into a file in a repo, a URL you print, a commit, a report, or
     front-end code that ships publicly. The client redacts it from its own errors.
   - 403 `[bundler] invalid domainkey param` or 401 `domainkey not set` = no valid key
     for this exact hostname. Check `www.` versus bare domain once, then ask the user;
     do not guess keys.
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
| Trend over time | `--report timeseries [--by hour\|week]` |
| Did visitors do anything? (nothing / consent only / scrolled / interacted / navigated) per channel | `--report activity [--by source\|device\|path]` |
| AI assistant traffic: organic citations vs ChatGPT ads, vs search, landing pages, weekly | `--report ai` |
| Redirect chains before the page, per ad network, and engagement by delay | `--report redirects` |
| Dead taps per component and page, repeat ("rage") taps | `--report dead-clicks` |
| Bot / AI-agent hunting: behaviour per user agent | `--report segments [--by ua\|os]` |
| Everything about one page (redesign brief, landing-page review) | `--path / --report page` |
| This period vs the one before, with significance | `--report compare --vs previous` |
| See the raw data shape | `--report sample` |
| Everything raw, for your own analysis | `--report raw --out bundles.jsonl` |

Range: `--last 24h|7d|30d|3m` or `--start YYYY-MM-DD --end YYYY-MM-DD`. A bare end date is
inclusive (the whole day) and loads are trimmed to `[start, end)` UTC, so hourly and daily
loads of the same dates cover the same views.
Filters apply while loading: `--path`, `--prefix`, `--match <regex>`, `--device mobile|desktop`.
`--top N` sets rows per table. `--org <org>` instead of `--domain` for an org-level key.
`--checkpoints utm,paid,click` keeps only those events while loading, plus the ones the
chosen report reads (acquisition, bot/prerender filters, activity, CWV ... are added
automatically per report): use it on big domains over weeks. In code, pass the full list
yourself: `loadBundles({ checkpoints })` keeps exactly what you name. `--normalize` groups component instances in `clicks`.

### Cost and sample size: choose the range on purpose

There is no server-side filtering: every file is downloaded whole and filtered locally.
Measured on a large brand site (~17M views a week):

| Range | Files fetched | Time / peak memory (whole domain) | Sample |
| --- | --- | --- | --- |
| `--last 24h` | 24 hourly | a few seconds | full (weight ~100) |
| `--last 7d` | 168 hourly | ~10 s, ~830 MB (~350 MB with `--path`) | full |
| `--last 30d` | ~31 daily | ~2 s, ~200 MB | **subsampled ~40x** (weight ~4,000) |
| `--last 3m`+ | monthly | ~2 s, ~160 MB | subsampled further (~700 bundles/month on a 7M-views/month site) |
| 28 days `--granularity hour --checkpoints ...` | 672 hourly | ~25 s, ~1.8 GB (623k bundles) | full |

Coarser files keep totals right but hold far fewer bundles. That is fine for
site-wide numbers and too thin for one page or a rare event: one page over 30 days
gave 395 bundles from daily files and 19,000 with `--granularity hour` (~40 s).
So for a single page, a funnel or an experiment over more than a week, add
`--granularity hour`. Sites also sample at different rates (weights of 100 and
1,000 both occur), so never assume a weight.

Start with `24h` or `7d` for one page. Do not load a year to answer a question about
last week. Re-use a `--report raw --out` file instead of re-downloading for follow-ups.

## 2. In code (apps, dashboards, scripts)

```js
import {
  loadBundles, byPath, byPathPrefix, summary, clickReport, trafficSources, cwvReport,
  groupBy, realViews, events, pathOf, device, weightOf, timeSeries, isVisit,
  activityOf, activityReport, aiReferralReport, redirectReport, deadClickReport,
  segmentProfile, pageInsights, comparePeriods, classifyAcquisition, timeTo, normalizeSelector,
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
  events: [{ checkpoint: 'enter', source: 'https://www.google.com/', timeDelta: 412 },
           { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/cart', timeDelta: 9120 },
           { checkpoint: 'cwv-lcp', value: 1840, source: '.hero img' }, ...]
}
```

`timeDelta` is ms on the page's clock. `msSinceStart(b, e)` / `timeTo(b, 'click')` turn it
into "ms after the view started" (time to first click, scroll evidence, robotic 50 ms clicks).

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
| `paid` | network (`google`, `doubleclick`, `facebook`, `tiktok`, `openai`, ...) | click-id param (`gclid`, `dclid`, `fbclid`, `ttclid`, `oppref`/`olref`) | ad click; several can ride on one URL; `openai` = an ad in ChatGPT |
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
   the most-clicked element. `clickReport()` separates it: OneTrust, Usercentrics,
   TrustArc, Cookiebot, Didomi, Cassie, Tealium, Osano, plus a generic rule for other
   banners (a cookie/consent/gdpr name inside a `dialog`, or next to a banner word such as
   `cookie-banner`; a product called "cookie dough" is not a banner). Check `--report clicks` for an unrecognised banner before trusting
   activity numbers. The `consent` checkpoint (banner shown) only exists for OneTrust,
   TrustArc and Usercentrics, so "consent shown" reads 0% on Tealium and other CMPs.
8. **Dead clicks** (selector without `a`/`button`/`img` and no target) are taps on
   things that do nothing: a strong UX signal, but check the element before claiming.
9. **CWV are sparse**: only views that stayed long enough report them. Quote p75 with
   the sample count.
10. **Campaign conventions are site-specific.** The default rules (rum-distiller's)
    call `utm_medium=social` earned. The client already reads a type suffix on
    `utm_source`/`utm_medium` (`social_p` paid, `packaging_o` owned, `pr_e` earned;
    `RULES.typeSuffix`, set it to null to turn off). For other conventions look at
    `--report checkpoint:utm`, ask, and extend the rules instead of misreporting:
    ```js
    RULES.paidMedium = new RegExp(`${RULES.paidMedium.source}|^social$`, 'i');
    ```
11. **"Bounce" and distiller "engagement" are blunt.** Bounce counts a cookie-banner
    click as engagement and a long read as a bounce; engagement (">3 blocks or media
    seen") is ~80% on media-heavy pages that load many images on arrival. Use the
    activity ladder (`activityOf`, `--report activity`): nothing / consent-only /
    scrolled / interacted / navigated. "Scrolled" is a heuristic (blocks or media that
    came into view 1 s+ after the first ones; carousels can fake it). Say so.
12. **Prerenders.** Speculation-rules sites can have 20%+ of raw bundles as prerenders
    that were never shown (one retail site: ~1.8M of 8.9M in four weeks). Built-in reports drop
    them; a hand count of all bundles, or a BigQuery query that does not exclude
    `checkpoint='prerender'` views, overstates page views by that much (visits are unaffected).
13. **Same-brand referrers are internal.** A visit from `login.emea.brand.com` or another
    market's subdomain is `owned:internal`, not a referral (matched on registrable domain).
14. **Redirect `~` values are estimates** from a late fetchStart; exact (`:`) ones come from
    the browser and miss cross-origin hops (ad trackers). Compare redirect delay within one
    channel: QR and packaging traffic has long chains *and* high intent, so a pooled
    "slow redirects engage more" result is confounded.
15. **Dead taps need eyes.** Class-only selectors on custom widgets (configurator tiles,
    React inputs, accordions) look dead but do work. Group with `normalizeSelector`,
    then open the page before calling anything broken. Each dead-tap row has a
    `resolution`: `element` (a specific element inside a block) or `block` (only a
    block, section or `-wrapper`: the click hit text, padding or an element without
    id/class). Lead with `elementDeadViewShare`; treat block-level rows as "look here".
    On a documentation site, block-level "dead taps" were mostly text selection: 11% of
    views dropped to 2% at element level. Clicks in code blocks (`.hljs`, `pre`, `code`)
    are classified `text`, not dead.
16. **Small sites: say how small.** Every grouped row carries `bundles`; reports set
    `lowSample: true` under 30 (`LOW_SAMPLE`). On a site with ~2k human bundles in 8
    weeks, AI referrals were 7 bundles and most channels under 30: give counts, not
    percentages, for those ("7 sampled AI visits in 8 weeks"). Load 8-12 weeks of
    hourly files, and check `weight`: one host mixed 100, 10 and 1.

## 4b. Recipes: questions first answered in BigQuery, now from bundles

All built on one domain's bundles. Load once with `--report raw --out x.jsonl` (or in code)
and run every report on that file instead of downloading again.

**AI assistant referrals (ChatGPT benchmark).** `--report ai --start ... --end ... --granularity hour`.
Gives share of visits, AI visits per 100 earned-search visits, content-click rate and the
activity ladder for AI vs search vs all, landing pages for organic AI, for ChatGPT ads and
the search landings organic AI never reaches (missing product lines), a weekly series, and a
`likelyAutomated` flag (click rate < 0.35x search on >= 100 bundles). Ads (`paid` checkpoint
`openai`) and organic citations (`utm_source=chatgpt.com` or a chatgpt.com referrer) are split:
on one retail site ChatGPT ads were 3x the organic visits and clicked 12% vs 65%. A query on
`utm_source LIKE '%chatgpt%'` alone misses the ads (their source is `openai`). Use 8-12 weeks
for a small site: organic ChatGPT is often < 0.3% of visits (~70 bundles a month).

**Paid traffic quality (activity instead of bounce).** `--report activity --by source` → per
ad network, the share of visits that did nothing, only touched the consent banner, scrolled,
interacted, or clicked through, plus how often the banner was shown and time to first click.

**Ad-click redirect chains and load delay.** `--report redirects` → per ad network: redirected
share, multi-hop share, ms lost p50/p75, TTFB and LCP p75, plus the activity ladder per delay
bucket, the `redirect_from` values, and landing pages with the slowest chains. Name the
vendors from the redirect sources and click ids (`dclid` = Campaign Manager / DV360).

**Dead taps.** `--report dead-clicks` (all pages) or `--path /x --report dead-clicks`.

**Bot / AI browsing agent check (e.g. desktop:linux).** `--report segments` → per user agent:
direct-entry share, events per view, click / scroll / form rates, share of first clicks under
500 ms, TTFB p50/p90 (datacenter vs residential), weekend share, peak UTC hour, CWV reporting
rate, top paths. Compare the suspect agent with windows/mac. Synthetic monitoring looks like:
~95% direct, few events, < 5% clicks, weekday-heavy, one landing page. Then trend it with
`timeseries --by week` filtered by user agent in code.

**Homepage / landing page brief.** `--path / --report page` → views, entry share, channels,
activity overall and by channel, clicks (consent and dead separated), reach (viewblock on EDS,
viewmedia elsewhere), LCP p75 and element, previous/next pages, errors. Feed it to a design
step as evidence: what is seen, what is clicked, what is ignored, where people go next.

**Before/after.** `--report compare --vs previous` (same length, immediately before) for
channel mix, AI share, did-nothing, content clicks, redirects, poor LCP, JS errors, dead taps,
each with p-value. In code, `comparePeriods(a, b, { base, metrics })` for anything else.

## 4b-2. Small sites (a few thousand bundles a month or less)

- Load `--start ... --end ... --granularity hour` over 8-12 weeks once with
  `--report raw --out site.jsonl`; a mid-size apparel retailer gave 17k bundles in 8 weeks
  (25 s), a developer docs site 3.7k.
- Run `--report checkpoints` first. Small sites often lack `utm`, `consent` or `viewblock`,
  and older script versions send a value-less `cwv` marker (ignore it).
- Expect bots and unactivated prerenders to be a large share of raw bundles (36% bots on
  one site, 26% prerenders on another). Report how many were dropped.
- Channels like `earned:messaging` (Teams, Slack) and `owned:dev` (localhost previews)
  matter on B2B and developer sites; they are split out of `earned:referral`.
- Prefer site-wide rates and the top pages; per-page or per-channel splits are usually
  `lowSample`.

## 4c. What bundles cannot answer (use BigQuery or another source)

- **Anything across domains.** One key reads one hostname (an org key: one org's hosts).
  Vertical benchmarks, "AEM fleet" trends, peer sets and "is this a broad effect or one
  site?" need every peer's key, which is the BigQuery tables' job.
- **Industry / vertical** is not in the data anywhere (neither is it in BigQuery).
- **Geo, IP, raw user agent, browser version**: not collected. The user agent is the
  simplified `device:os:engine` string. Scrapers can't be traced to IPs from here; use CDN logs.
- **Bot share varies wildly by site.** A small site can be mostly bots (one banking site:
  55% of bundles in 8 weeks); reports drop them, but say how much was dropped.
- **Bots are under-represented.** The bundler drops part of the bot traffic (one retail
  site, 4 weeks: 93k bot views in bundles vs 158k in BigQuery) and few `bot:ai:*` agents remain.
  Use bundles for "is this human-looking segment really human", not for bot volumes.
- **Sessions and visitors.** No visitor or session id: a visit is one entry view. Multi-page
  journeys are stitched only from `navigate` (previous page) and click targets.
- **Rare events over long ranges** at full sample need hourly files: a year is 8,760
  requests. Monthly files keep totals right with ~700 bundles a month on a mid-size site.
- **History**: files went back two years on the sites tested (Sept 2024), roughly
  BigQuery's 25-month retention, but only monthly/daily files are practical that far back.

## 5. Presenting results

Lead with what the data says and what to change, then the numbers that back it.
Always state: domain, path filter, date range (UTC), granularity, sampled bundles,
and any `failedFiles`. Round (`12.4k views`, `38%`), don't print raw weights.
For customer-facing reports call the data "AEM Operational Telemetry", as aem.live does.
State heuristics as heuristics (scrolled, dead taps, likelyAutomated) and give the
sample size behind every rate.

## 6. Without Node (raw HTTP)

```bash
curl -s --compressed "https://bundles.aem.page/bundles/www.example.com/2026/09/30/14?domainkey=$OPTEL_DOMAIN_KEY" \
  | jq '[.rumBundles[] | select(.url | endswith("/products/shoes"))] | map(.weight) | add'
```

Paths: `/bundles/{domain}/{YYYY}/{MM}/{DD}/{HH}` (hour), `/{YYYY}/{MM}/{DD}` (day),
`/{YYYY}/{MM}` (month); `/orgs/{org}/bundles/...` for org keys. UTC. 404 = no data for
that slot. Always ask for gzip (`--compressed`): uncompressed responses over 6 MB are refused
with 413 (`Response payload size exceeded`), which hits daily and monthly files of busy sites.
The client compresses (fetch does) and also falls back to smaller files on 413.
Same rules as section 4 apply.
