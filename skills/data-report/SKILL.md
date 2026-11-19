---
name: data-report
description: Turn the data collected for a customer (Optel visits by theme, Adobe Brand Visibility and Semrush prompt research, citation attempts from Brand Visibility agentic traffic, homepage visitor cohorts) into a follow-up PDF that explains the AI discovery-to-revenue funnel and Return on Brand Visibility (RoBV), says which stages could be measured and how, and then walks through what was found, read by read, with the merged sankey and the cohort sankeys. Findings only, no recommendations. Use when a customer asks for "the data you showed us", a data appendix or follow-up after a brand visibility or cohort session, or to repeat the report for another customer.
---

# Data report: what the data shows

After a brand visibility session, the customer usually asks for the numbers they saw on the
screen. This skill makes that leave-behind: a landscape PDF of about twelve pages that explains
the funnel, says honestly which stages were measured, and walks through the reads one at a time.
It shows what was found and how it was collected. It does not recommend anything: the plan, the
jobs per theme and the proposed pages stay out, so the PDF can travel without a presenter.

```
brand-visibility ─▶ reads.json, out/visits-by-theme.json ─┐
Brand Visibility agentic traffic ─ fetch-join.js ─▶ fetch-join.json ─┤
homepage-cohorts ─▶ cohorts.json (one per site) ───────────┼─ report.json ─ build.js ─▶ PDF + checks
templates/report.html (copied on the first build) ─────────┘
```

| Page | What it shows | From |
| --- | --- | --- |
| Cover | Title, customer, sites, sources, period | `report.json` |
| The model | The six-stage funnel, people and personal agents, RoBV = revenue ÷ cost to own topics | fixed |
| How we collected it | Every funnel stage marked Collected, Directional, Partial or Not in this read | data, `coverage` |
| One frame | The merged sankey: sites, answer states and statements joined on the themes | reads + visits |
| Who arrives | The sankey lit for visits, a table per theme, five facts | `visits-by-theme.json` |
| What people ask AI | Prompts per theme, who is named, share of prompts by answer state | `reads.json` |
| What assistants fetch | Citation attempts per theme and per section, top pages, agents | `fetch-join.json` (optional) |
| What the firm has said | The themes the firm named, with their numbers | `wanted` in `reads.json` (optional) |
| All reads together | One row per theme across every stage read, three callouts | all |
| Visitor cohorts | One page per `cohorts.json`: entry → device → cohort sankey, rates per cohort | `homepage-cohorts` |
| Notes | Source, period, limits | all |

Pages without data drop out and the rest renumber, so a customer without agentic traffic or
without cohorts still gets a complete report.

## What you need

**Tools**: Node 18 or newer and Chrome or Chromium (`CHROME=/path` if it is not found). No npm
packages. The Adobe Clean font if it is installed (Adobe machines have it), otherwise the
system font; `build.js` says which one printed.

**Skills in this repository**, run first for the customer:

| Skill | Gives | Needs |
| --- | --- | --- |
| [`site-merge`](../site-merge/SKILL.md) | `merge-rules.js`, pulled bundles per site (`data/<id>-site.jsonl`) | an Optel domain key per hostname |
| [`brand-visibility`](../brand-visibility/SKILL.md) | `out/visits-by-theme.json` (read 1) and `reads.json` (reads 2 and 3, and `attempts` per theme for read 4) | Adobe Brand Visibility (prompt research, the customer's organisation) or Semrush |
| [`homepage-cohorts`](../homepage-cohorts/SKILL.md) | `cohorts.json` per homepage (`size.js`) | the homepage bundles and the cohort rules |

**Optional, for the fetch page**: an export of Brand Visibility agentic traffic (chatbot fetches
per URL), one `path|hits|agent|share|category` line per page, counting only agents whose name ends
in `-User`. Brand Visibility shows it under agentic traffic; an agent with access can pull it with
the customer's sign-in. It is the customer's data: read it with their knowledge.

**Optional, for the cover**: the Adobe logo as a PNG or SVG next to `report.json` (`"logo"`). It is
not shipped here; take the current one from Adobe's brand portal. A white version suits the dark
cover.

Keep `report.json`, the inputs and the PDF in the customer's workspace, outside any repository that
is served or public.

## 1. The fetch join (optional)

```bash
R=~/Code/aem-optel-clients/skills/data-report
node $R/scripts/fetch-join.js --fetches fetches.txt[,second-export.txt] --bundles data/www-site.jsonl \
  --from 2026-10-12 --to 2026-11-09 --scope '^/us-en' --sections sections.json --out fetch-join.json
```

- `--from`/`--to` (exclusive) must be the window of the export, so attempts and visits cover the same
  days. `--scope` keeps one part of the site and strips that prefix from the paths, as the export does.
- `sections.json` names the parts of the site, first match wins: `{"business": "^/business", "claims": "^/claims"}`.
  `/` is `home`, the rest `other`. The page shows where the attempts go by section, so name the
  audiences a reader will recognise.
- A second export overrides the first for the pages it has (to fill gaps); an agent it does not name
  is kept from the first.
- AI-referred visits use `classifyAcquisition()` of `optel-client.js`, the same as the other skills.
  A hand-written referrer regex finds a few more; say which one a number came from.

For the per-theme column, add `attempts` (citation attempts on the theme's pages) to each theme in
`reads.json`, as `brand-visibility/references/reads.md` describes.

## 2. report.json

Copy `report.example.json` next to the inputs and fill it. Paths are relative to it.

| Key | |
| --- | --- |
| `customer`, `short` | The name on the cover and in footers; `short` in the sentences ("Example's pages"). |
| `title`, `subtitle`, `lede`, `preparedFor`, `period` | Cover. Defaults: "What the data shows", "about how people and AI find …", a findings-only lede. |
| `logo` | Optional image path for the cover. The build fails if it is named and does not load. |
| `reads`, `visits` | `reads.json` and `visits-by-theme.json`. Required. |
| `fetch` | `fetch-join.json`. Leave out to drop the fetch page. |
| `cohorts` | `[{ "file", "title", "conversion" }]`, one page each, in this order. `conversion` names the goal click of the cohort rules ("Start a quote"); without it the goal column is left out, because a click pattern alone does not say what it means. |
| `names` | The brand names to count in the "Named" column, read from each theme's `asked` text (a sub-brand counts: `["Example", "Example Pets"]`). |
| `pulled`, `wantedSources`, `askNote` | The date the prompt research was pulled, the documents behind `wanted`, a one-line caveat under read 2 (who leads every theme). |
| `fetchPages`, `pathPrefix` | The section whose pages are listed on the fetch page (`"consumer"`), and a path prefix shown as `…`. |
| `clickLabels` | Plain words for the clicked selectors on the cohort pages (`{"header .cmp-tabs__tab": "Header tabs"}`). Unlabelled ones print as code. |
| `coverage` | Per stage (`topics`, `mentions`, `attempts`, `citations`, `transactions`, `trackable`, `claimable`, `influenced`, `agents`, `conversions`), `{ "status", "text" }` to override the default: `collected`, `directional`, `partial` or `none`. |
| `notOnPage` | What the report leaves out on purpose (default: recommendations, designs, proposed pages). |

The coverage defaults are written from the data and are conservative: a stage is only Collected
when its input is there. Raise one only when you have the evidence in hand, and say in `text`
what it is. "Not in this read" is a finding too: the customer sees where the gaps are.

## 3. Build and check

```bash
node $R/scripts/build.js --config report.json [--out Example-What-the-Data-Shows.pdf]
```

The first build copies `templates/report.html` next to `report.json`. Wording the config does not
cover can be edited in that copy; the numbers always come from `report.data.js`, which every build
rewrites. To take a newer template, delete the copy.

`build.js` prints with headless Chrome and fails if a page runs past its footer line, the PDF has
more pages than sections, a script fails, or the logo does not load. Then read the PDF as the
customer:

- Every headline is a number with its unit and period. Check three against the source files.
- Read each sankey: the largest theme and the largest site are where the table says.
- The cohort pages: small samples are flagged and their rates left out; modelled cohorts (memory on
  the device) have no rates. If a cohort's rate is the point of a sentence, say how many sampled
  views it rests on.
- Nothing in the PDF proposes anything. The theme jobs and experiences of `reads.json` and the
  experiences of `cohorts.json` are dropped by the build; check that no hand edit put one back.

## Rules that keep it honest

- Periods differ by source (visits over weeks, prompts a month, fetches over four weeks). Each page
  names its period; the theme-by-theme table says to read rows as profiles, not conversion rates.
- Mentions from one query set per theme are directional. Prompt volumes are panel estimates.
- Citation attempts rank pages inside one window; assistants change how they fetch, so no trends.
- Optel is sampled (about one view in a hundred). Shares are estimates; small cohorts move a lot.
- What the firm said comes from public statements, or documents the customer shared and that are
  named as such in `wantedSources`. Account knowledge stays out.

Hand over the PDF with a short note: the sources and periods, which stages were not measured, and
that recommendations are available separately.
