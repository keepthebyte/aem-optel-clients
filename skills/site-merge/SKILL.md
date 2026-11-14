---
name: site-merge
description: Plan the audiences of a site that replaces several sites, from AEM Operational Telemetry (Optel) data of each. Reads every site on its own (its visits by what they come for), merges the cohorts that share a need into the audiences of the new site, and draws a Sankey with each site on the left, the merged audiences on the right, and what each audience keeps after the redirect and gains from the sites coming together. Layers show the same merge for one kind of traffic (all, SEO, GEO). Use when sites, brands or domains are being consolidated, migrated or redirected into one, when asked how audiences of several sites overlap, where the cross-sell is, what a redirect must not break, or how search and AI traffic of several sites combines.
---

# Site merge

Several sites become one. Each has visitors who come for something and get it today; the old
sites will redirect to the new one. Two things have to hold:

- **Keep.** Nobody who is served today is worse off after the redirect.
- **Gain.** Audiences that were split across sites meet what the other sites offer.

`homepage-cohorts` decides one page for one site. This skill comes before it: it describes
the audiences of several sites while they are still apart. It writes no code into a site.

## The method

1. **Each site on its own.** Every visit (an entry page view, bots excluded) gets a *need*
   from the page it lands on: sign-in, careers, research, services, company, contact and so
   on (`needs` in the rules). A visit that lands on a homepage takes the need of its first
   click; without one it is a front-door visit. Per need: share of the site, where the
   visits come from, how many click through to another of the sites.
2. **Merge.** Cohorts with the same need on different sites become one *audience* of the new
   site. For each audience the rules say what it keeps and what it gains; the data says how
   large it is, which sites bring it, and how often it reaches another site today. That last
   number is the baseline the merged site has to beat.
3. **The picture.** A Sankey: sites and their cohorts on the left, audiences on the right
   with keep and gain beside them. Two scales (each site at its own scale, so a small site
   reads as clearly as a large one, or real visit volume) and one layer of traffic at a time.

## Run it

Copy `merge-rules.js` next to the project and edit it: the sites, the need patterns, the
audiences. Keys come from the environment, one per site (`OPTEL_DOMAIN_KEY_<ID>`); treat them
like passwords (see the `aem-optel` skill). Raw bundles stay out of the repository.

```bash
node scripts/pull.js         --rules merge-rules.js --start 2026-09-14 --end 2026-11-13 --data data/
node scripts/site-cohorts.js --rules merge-rules.js --data data/ --out out/    # out/sites.json
node scripts/merge.js        --rules merge-rules.js --out out/                 # out/merged.json
node scripts/sankey.js       --rules merge-rules.js --out out/                 # out/sankey.html
```

Use the same weeks for every site and at least a month; two is better for small sites.

## Check the needs before you read the result

The merge is only as good as the need patterns, and they are written per project.

- Open `out/sites.json` and read `topPages` of every cohort on every site. An article with
  "dashboard" in its name is not a sign-in; a privacy article is research, a privacy notice
  is not. Fix the pattern, anchor it on path segments, rerun.
- `other` should stay small (a few percent). If it is large, a need is missing.
- Order decides: the first pattern that matches wins.

## Read the result

- **Shared audiences** (more than one site brings a real part): these are where the merge
  pays. The share of visits in shared audiences is the first number to quote.
- **Cross-site rate today** per audience and per layer: the baseline for the gain.
- **Audiences one site owns** (investors, a client portal, a campaign): the redirect must not
  lose them. They are the "keep" list.
- **A cohort that is large on one site and small overall** (careers on a consulting site):
  easy to drop in a merge by volume. The "own scale" view exists for this.
- Low samples are marked (`*`, under 30 sampled visits; a layer under 300). Use them as a
  direction, not as shares to quote. AI traffic is usually in this range.
- `keep` and `gain` are your decisions; only the sizes and rates are measured. Say so when
  you present it.

## Layers

`layers` in the rules filter visits by acquisition channel: `search` for SEO, `ai` for GEO
(visits from AI assistants; citations in AI answers are a different source and not in Optel),
or `email`, `social`, `paid`, `referral`, `direct`. Every layer gets its own merge and its own
view in the Sankey.

## From the picture to the page

`references/runtime.md`: how the new site recognises a visitor of a site that moved
(`?from=<id>` on the redirect), the `from-<id>` rules for `homepage-cohorts`, and how to size
them before any redirect exists (`scripts/as-redirected.js`).

## Publishing

`sites.json`, `merged.json` and `sankey.html` are aggregated telemetry of every site in the
merge. Keep them where the site owners agreed to; none of them contains a domain key.
