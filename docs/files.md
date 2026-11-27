# Files: what each one is, where it lives, how to refresh it

A run of these skills touches three places, and each file belongs in exactly one of them:

| Place | What lives there | Public? |
| --- | --- | --- |
| **This repository** | Code, templates, examples, references. Nothing about a customer. | Yes, the repository is public |
| **The customer workspace** | A private folder per customer (`docs/guide.md`, step 1): the raw bundles, the rules for that customer, the reads, the plan and every result | No. Never inside a repository |
| **The customer's site** | Its code repo (the engine and the panels, copied in) and its content store (the data the panels read) | Code is served to everyone; data files are previewed only, never published |

The rule behind the split: **anything with a customer's numbers stays out of a repository.**
Every file committed to an Edge Delivery repo is served, so data the site needs goes into the
content store and is previewed, never published (the `.aem.page` URL answers, the `.aem.live`
URL answers 404). Domain keys are never written to a file in any of the three places: they
come from the environment, or from a file under `~/.config/` with mode 600.

## 1. This repository

### Shared

| File | What it is |
| --- | --- |
| `optel-client.js` | The Optel client: loads bundles with a domain key, turns them into reports. Library, CLI, browser module. Every skill builds on it |
| `docs/guide.md` | The step-by-step guide, from a domain key to a video, in the order to do things |
| `docs/files.md` | This page |
| `CHANGELOG.md` | What changed, newest first. Add an entry under **Unreleased** with every change |
| `test/*.test.mjs` | `npm test`. One file per skill, plus `live.test.mjs`, which reads the public demo domain and needs a network |

### Per skill

Each skill has a `SKILL.md` (what the agent reads first), `references/` (the long version of
one topic), `scripts/` (run with Node, no packages) and examples to copy.

| Skill | Copy to the workspace and edit | Scripts | Copy into the site |
| --- | --- | --- | --- |
| `aem-optel` | – | the CLI of `optel-client.js` | – |
| `site-merge` | `merge-rules.js` | `pull.js` → `site-cohorts.js` → `merge.js` → `sankey.js`; `as-redirected.js` | – |
| `brand-visibility` | `theme-rules.js`, `reads.example.json`, `plan.example.json` | `visits-by-theme.js`, `three-reads.js`, `panel-data.js` | `ew-panel/` → `tools/brand-visibility/` |
| `homepage-cohorts` | `engine/cohort-rules.js` (also goes to the site) | `size.js`, `sankey.js`, `review.js`, `verify.js`, `notes.js`, `pictures.js`, `agent-check.js` | `engine/*.js` → `scripts/`, `engine/cohort-panel.css` → `styles/`, `engine/ew-panel/` → `tools/cohorts/` |
| `homepage-cohorts-video`, `brand-visibility-video` | `templates/*.storyboard.json`, `templates/captures.example.json` | `capture.js`, `tts.js`, `render.js` (in `homepage-cohorts-video`) | – |
| `demo-guide` | `templates/guide.html`, `templates/captures.example.json` | `build.js` | – |
| `data-report` | `report.example.json` (the build copies `templates/report.html` beside it) | `fetch-join.js`, `build.js` | – |

`extensions/experience-workspace/` holds two older panels (Page Insights, Improve Impact) that
read Optel directly for any site; its README says how to add them.

## 2. The customer workspace

One folder per customer, outside every repository. A run goes from left to right: each file is
written by the script in the second column and read by the ones in the third.

### Inputs you write

| File | What | Read by | Refresh |
| --- | --- | --- | --- |
| `merge-rules.js` | The sites (id, host), what the homepage is, and what visits come for (needs) | `pull.js`, `site-cohorts.js`, `visits-by-theme.js` | When a site, a section or a need changes |
| `theme-rules.js` | The client themes and the landing pages that belong to each | `visits-by-theme.js` | When the themes change; check `unmatched` in read 1 after every pull |
| `reads.json` | Read 2 (prompts and who is named, per theme, with `standing`) and read 3 (what the firm says it wants) | `three-reads.js`, `panel-data.js`, `data-report` | Each run: Brand Visibility or Semrush, and the firm's latest statements |
| `plan.json` | The panel's suggestions, notes and data sources | `panel-data.js` | Each run, after reads 1 to 3; check every page answers 200 |
| `*.storyboard.json`, `captures.json` | A video's scenes and the pages it shows | `capture.js`, `tts.js`, `render.js` | When the story or the site changes |
| `report.json` | The data report's sources, period and wording | `data-report/scripts/build.js` | Each report |

### Data and results the scripts write

| File | Written by | What | Refresh |
| --- | --- | --- | --- |
| `data/<site>.jsonl` | `pull.js` (or `optel-client.js --report raw`) | Raw bundles, the whole site, over the window. Large: never committed (`*.jsonl` is ignored here too) | Each run: pull the same window for every site |
| `out/sites.json`, `out/merged.json`, `out/sankey.html` | `site-cohorts.js`, `merge.js`, `sankey.js` | Each site by need, merged audiences, the picture | After each pull |
| `out/visits-by-theme.json` | `visits-by-theme.js` | Read 1: visits, AI visits and top pages per theme | After each pull |
| `out/three-reads.html` | `three-reads.js` | The three reads as one picture (`?show=arrive\|ask\|want\|plan`) | After read 1 or `reads.json` changes |
| `out/brand-visibility.json` | `panel-data.js` | The panel's data file; uploaded to the site (below) | After read 1, `reads.json` or `plan.json` changes |
| `home.jsonl`, `month.jsonl` | `optel-client.js --path / --report raw` | Homepage bundles for sizing, then for each monthly review | Sizing once; a month at a time for review |
| `cohorts.json`, `sankey.svg/html` | `size.js`, `sankey.js` | Each rule's share and baseline, and the picture; `cohorts.json` is uploaded to the site | When the rules change |
| `review.json`, `review.md` | `review.js` | Each rule against its holdout; uploaded to the site | Monthly |
| `insights.json` | `notes.js` | The Insight notes taken out of the cohort page, so they are not published; uploaded to the site | When a note changes |
| `pictures.json`, `agent-check/` | `pictures.js`, `agent-check.js` | Pictures per cohort; what a personal agent gets | When you need them |
| `video/work/` | `capture.js`, `tts.js`, `render.js` | Captures, narration, stills and the MP4 | When the storyboard or the site changes |
| `out/fetch-join.json`, the report PDF | `fetch-join.js`, `build.js` | Citation attempts joined with visits; the data report | Each report |

## 3. The customer's site

### Code (the site's repository)

Copied from this repository, committed, served. Copy again after a change here, and note the
version in the commit.

| Path in the site | From | Why it is there |
| --- | --- | --- |
| `scripts/cohorts.js`, `scripts/cohort-rules.js` | `homepage-cohorts/engine/` | Decides the homepage per visitor; the same rules `size.js` and `review.js` measure |
| `scripts/cohort-panel.js`, `cohort-insights.js`, `cohort-preview.js`, `styles/cohort-panel.css` | `homepage-cohorts/engine/` | The `?demo` presenter controls and the preview in the editor |
| `tools/cohorts/` | `homepage-cohorts/engine/ew-panel/` | The Cohorts panel and the gallery in Experience Workspace |
| `tools/brand-visibility/` | `brand-visibility/ew-panel/` | The Brand visibility panel in Experience Workspace |
| `.hlxignore` | – | Must list `/cohorts/*` and `/brand-visibility/*`, so no data file is served from code |

### Data (the site's content store, previewed only)

| Path | Written by | Read by | Refresh |
| --- | --- | --- | --- |
| `/cohorts/cohorts.json` | `size.js`, uploaded | Cohorts panel, gallery (Flow), demo panel | When the rules change |
| `/cohorts/review.json` | `review.js`, uploaded | Gallery (Holdout) | Monthly |
| `/cohorts/insights.json` | `notes.js`, uploaded | Insights mode of the demo panel | When a note changes |
| `/brand-visibility/brand-visibility.json` | `panel-data.js`, uploaded | Brand visibility panel | Each run |
| `/brand-visibility/focus.json` | The Brand visibility panel, from the team's choices | Brand visibility panel | Never by hand: the panel writes it. A new run keeps it |

Upload and preview, never publish: `PUT …/source/<path>`, then `POST …/preview/<path>` on a
Source Bus site (`references/install.md` of `homepage-cohorts`, `references/panel.md` of
`brand-visibility`). Then check the `.aem.page` URL answers 200 and the `.aem.live` URL 404.

### Editor config

The panels are registered as `library` rows in the site's editor config (`/config/editor/da.json`
on a Source Bus site, the `library` sheet on a DA site). The rows hold paths only, no data.

## Refresh a customer, end to end

1. **Pull** the bundles for the new window (`pull.js`), same weeks for every site.
2. **Read 1**: `visits-by-theme.js`. Check `unmatched`; fix `theme-rules.js` if a large page has
   no theme, and run it again.
3. **Reads 2 and 3**: update `reads.json` (prompt research, `standing` from the brands tab, the
   firm's latest statements).
4. **Plan**: update `plan.json` (evidence numbers, notes, data source statuses); check pages.
5. **Build and upload** `brand-visibility.json`; redraw `three-reads.html` if it is shown.
6. **Cohorts**: monthly `review.js` on the last month, upload `review.json`; `size.js` again only
   when the rules change.
7. **Video, guide, report**: rebuild the ones that show numbers that moved.

Write the date of the window into every file that shows numbers (`asOf`, `window`, the notes),
so a reader can tell which run they are looking at.
