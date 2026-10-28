---
name: homepage-cohorts
description: Optimise the homepage of an AEM Edge Delivery Services site for the cohorts in its real traffic, using AEM Operational Telemetry (Optel) data and the AEM Experimentation plugin. Sizes first-match cohort rules on Optel bundles (referrer, campaign tags, ad clicks, AI assistants, device, on-device visit memory), renders the traffic Sankey, builds a cohort page as a proof of concept (on a branch or a noindex URL), promotes it as a 90/10 experiment against the untouched homepage with an author-controlled rollback, and reviews each cohort against its holdout every month to add, fix or drop rules. Use when asked to personalise or optimise a homepage by audience, segment or cohort, to reduce homepage bounce or no-click views, to run a homepage POC or experiment on EDS, to promote or roll back a cohort homepage, or to run the monthly cohort review.
---

# Homepage cohorts

A homepage serves very different visitors with one page. Optel usually shows it: most clicks
go to one small link (sign-in), a third of views click nothing, and the rest of the page
shares what's left. This skill finds the cohorts in that traffic, gives each a first view
that fits why it came, and proves it with a holdout, every month.

How it works on the site:

- **The AEM Experimentation plugin** runs a page-level experiment on the homepage:
  `Experiment Variants: /new`, `Experiment Split: 90`. 10% (control) keep the untouched
  homepage. Authors roll back with `Experiment Status: off`.
- **The cohort engine** (`engine/cohorts.js`, dependency-free) runs inside the cohort page:
  the first rule that matches picks the experience, and Section Metadata decides which
  sections stay (`references/content-model.md`). It fires one `audience` checkpoint per
  view (rule id, arm) in both arms, so every rule is measured against its own holdout.
- **The same rules file** (`scripts/cohort-rules.js`) is evaluated by `scripts/size.js` and
  `scripts/review.js` on Optel bundles: what is sized, served and measured is one thing.

Reports and scripts:

| Script | In → out |
| --- | --- |
| `scripts/size.js` | homepage bundles + rules → `cohorts.json` (share per rule, what each cohort does today, Sankey flows) |
| `scripts/sankey.js` | `cohorts.json` → `sankey.svg` / `sankey.html` (flows tagged for the video) |
| `scripts/verify.js` | homepage URL + cohort page URL → ok / first differing section (the holdout guarantee) |
| `scripts/review.js` | a month of bundles + rules → `review.json` / `review.md` (lift per rule vs holdout, A/A check, unmatched traffic) |

The explainer video for leadership, and the monthly video update, are made with the
`homepage-cohorts-video` skill from `cohorts.json`, `review.json` and the live pages.

## 0. Before anything

1. **The repo**: an EDS project (`scripts/aem.js`, `scripts/scripts.js`, blocks). Read its
   `AGENTS.md`/`CLAUDE.md` and how the homepage is built: `curl https://main--{repo}--{org}.aem.page/index.plain.html`.
2. **Optel access**: load the `aem-optel` skill; it explains the domain key (never write it
   to a file, a commit or a URL) and `optel-client.js`. Use the production host (`www.` matters).
3. **Mode**: ask which stage the user is at, and for the POC, which kind
   (`references/rollout.md`): branch POC (nothing published) or live POC (a noindex URL).
4. **Consent**: ask whether on-device memory needs consent on this site (EU, Quebec, ...);
   it changes `memory.requireConsent` and `Experiment Requires Consent` (`references/rules.md`, Privacy).

## 1. Analyse the homepage traffic

```bash
OPTEL=path/to/optel-client.js   # next to the aem-optel skill, or the aem-optel-clients repo root
node $OPTEL --domain www.example.com --path / --last 7d --report page
node $OPTEL --domain www.example.com --path / --last 30d --granularity hour --report raw --out home.jsonl
```

Use hourly files for a single page (daily files are subsampled ~40x). Small sites: 8-12
weeks. From the brief, note: views, channel and device mix, the activity ladder ("did
nothing" instead of bounce), top clicks with consent separated, next pages. Those are the
problem statement for the video, so keep the numbers and their sample sizes.

## 2. Write and size the rules

Write `scripts/cohort-rules.js` from `engine/cohort-rules.js` (`references/rules.md`:
fields, conditions, how to choose and order rules, modelled memory rules). Then:

```bash
node scripts/size.js --rules ../site/scripts/cohort-rules.js --bundles home.jsonl --out cohorts.json
node scripts/sankey.js --in cohorts.json --out sankey
```

Read `cohorts.json`: share and `lowSample` per rule, `today.topClicks` and `didNothing`
per cohort (design input), `modelled` rules (estimates). Iterate on order and conditions.
Show the user the Sankey and the table, and agree the experiences before building anything:
which cohorts, what each gets first, what goes away for it.

## 3. Build the POC

1. Install the plugin and the engine, and wire `scripts.js` (`references/install.md`).
2. Create `/new` as an unchanged copy of the homepage, then add the cohort sections
   (`references/content-model.md`). Build new blocks with the `aem-edge-delivery-services`
   skills (`content-driven-development`, `building-blocks`), reusing blocks where possible.
3. Page metadata of `/new`: `Cohorts: on`, `Robots: noindex`, `Canonical: /`.
4. `node scripts/verify.js --original https://{branch}--{repo}--{org}.aem.page/ --cohort https://{branch}--{repo}--{org}.aem.page/new` must pass.
5. Fill `scenarios` in the rules with the cohorts that matter most, and check each one with
   `/new?demo` (panel: "Why am I seeing this?", "Try a visitor", Original/New).
6. Lint, the site's tests (add rule tests, `references/install.md` §5), and a PR with the
   preview link to `/new?demo`.

Automated browsers report `navigator.webdriver` and are treated as bots (original page).
To screenshot cohort pages, launch Chromium with `--disable-blink-features=AutomationControlled`
and a normal user agent, or force a rule with `?cohort=<rule id>`.

## 4. Promote, and roll back

`references/rollout.md`: preconditions, the four homepage metadata rows, the next-day check
that `experiment` and `audience` checkpoints arrive with a ~10% control, and the rollback
order (metadata first, code last).

## 5. Monthly review (the loop)

Every month, on the month's homepage bundles:

```bash
node $OPTEL --domain www.example.com --path / --start 2026-11-01 --end 2026-11-30 --granularity hour --report raw --out month.jsonl
node scripts/review.js --rules ../site/scripts/cohort-rules.js --bundles month.jsonl --out review.json --md review.md
node scripts/size.js --rules ../site/scripts/cohort-rules.js --bundles month.jsonl --out cohorts.json && node scripts/sankey.js --in cohorts.json --out sankey
```

Read the review:

- **`none` (A/A)**: both arms see the original sections. A significant difference means the
  split or the tagging is broken: stop and fix that first (run `verify.js`).
- **Per rule**: `keep` (beats the holdout), `fix or drop` (worse), `no clear difference yet`,
  `not enough data yet` (< 30 sampled views per arm: raise sampling or wait).
- **Shares**: measured shares replace the modelled estimates from step 2.
- **Unmatched traffic** (`unmatched.bySource`, `byFirstClick`): large groups no rule catches
  are candidate new rules (a new campaign, a new referrer, a new AI assistant).

Propose changes as a PR (rules, content, blocks), keeping rule ids stable (they are the
measurement keys), add new rules with new ids, then make the month's video with the
`homepage-cohorts-video` skill. Present results as Optel estimates with sample sizes
(`aem-optel` skill, section 5).

## Pitfalls

- **The default must be the homepage.** If `/new` without a rule differs from `/`, every
  comparison is off. `verify.js` after every content change.
- **The arm is sticky per browser session** (the plugin keeps it in `sessionStorage`; its
  `storage` option is not passed to the decision code in 2.0.0). A returning visitor can
  land in the other arm next session. Measurement is per view, so lifts stay valid; say so
  when someone asks "does a customer always see the same page?".
- **Extra fetch for the challenger.** The plugin loads `/new` after the homepage: check LCP
  (`--path / --report cwv` split by arm in code, or the live POC). Stage 3 in
  `references/rollout.md` removes it.
- **Do not use the plugin's `?audience=` parameter** on the homepage for demos: with no
  audiences configured it stops the experiment. Use `?cohort=<rule id>` (engine) and
  `?experiment=homepage-cohorts/control|challenger-1` (plugin).
- **Rule ids are measurement keys.** Renaming one breaks the month-over-month review.
- **Low traffic**: per-rule results need ~30 sampled views per arm. Raise the sampling rate on
  the homepage (`references/install.md` §4) or review quarterly.
