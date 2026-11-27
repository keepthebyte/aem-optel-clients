# The Brand visibility panel: decide the focus, plan the changes

The three reads end in a plan a team can act on inside Experience Workspace. `ew-panel/` is a
full-screen extension, site-wide (it does not read the page that is open), in two steps:

1. **Decide.** A map of demand (prompts a month) against share of answers, zoned by job, and the
   topic table with the data behind it. The team marks each topic **Focus**, **Watch** or
   **Skip**. Choices are shared in `/brand-visibility/focus.json` in the site's content store.
2. **Plan.** The changes suggested for the topics on Focus, grouped by the two jobs a page does
   (be seen and preferred, be chosen), each with its page and its evidence. A change, or the
   whole plan, can be drafted in the chat (the prompt is filled in, not sent).

The side pane says how the jobs are given, the findings across the sites, and every data
source the run used or looked for, with its status: included, partial or missing.

## Build the data file

```bash
node scripts/panel-data.js --visits out/visits-by-theme.json --reads reads.json \
  --plan plan.json --out out/brand-visibility.json --check-urls
```

- `visits-by-theme.json`: read 1, unchanged.
- `reads.json`: reads 2 and 3, plus `standing` per theme (below).
- `plan.json`: written by hand for the run (below). Copy `plan.example.json`.
- `--check-urls` fetches every suggested page and stops on anything but 200 (a redirect too:
  link the page it lands on).

The script stops on a theme without `standing.share`, a suggestion without `title` or `page`,
a plan entry for a theme that is not in `reads.json`, or a data source status it does not know.
It prints the rest as warnings (a theme missing from read 1 counts 0 visits).

### `standing` in reads.json

The firm as a share of **all brand mentions** in the theme's answers (the answer field, not only
the competitors you compared), so the map and the job rule compare like with like:

| Field | What |
| --- | --- |
| `share` | the firm's mentions as a percentage of all brand mentions in the answers |
| `rank` | the firm's place among the brands named |
| `mentions` | the firm's mentions (all its brand names together) |
| `leaders` | `[[name, mentions], …]`, the brands named most, three to five |
| `peer` | `{ name, mentions }`, the closest competitor of the same kind (another broker, another carmaker), for "vs next competitor" |
| `tracked` | optional, one line on the firm's own tracked prompts |

`references/reads.md` has the calls (brands tab, one specific query per theme). Quote it as
directional, with the query and the date.

### The job

| Rule (defaults) | Job |
| --- | --- |
| share ≥ 10%, or rank 1 or 2 | Defend |
| share 5 to 10% | Win |
| under 5% | Claim |

`plan.jobRule` (`defendShare`, `defendRank`, `winShare`) and `plan.jobText` override the rule
and its wording; `plan.jobs` sets a theme's job by hand. Say so in a note when you do.

### plan.json

| Key | What |
| --- | --- |
| `brand`, `asOf`, `window` | `asOf` shows in the header ("Data as of"); all three go in the data file's `meta` |
| `labels` | `peer` ("next competitor"), `peers` ("Competitors"), `growth` ("Growth area"), `notes` ("Across the sites") |
| `focus` | optional `{ themeId: 'focus' \| 'watch' \| 'skip' }`; by default a theme the firm names as a growth area starts on Focus, the rest on Watch |
| `goals` | optional, to reword the two jobs (`seen`, `chosen`: `label`, `text`, `pages`, `metric`) |
| `pattern` | optional, the parts a page needs to do both jobs (`{ title, parts: [{ goal, name, text }] }`), shown on the suggestions marked `pattern: true` |
| `study` | optional `{ title, url }`, linked at the foot of the plan |
| `notes` | `[{ title, text }]`, findings across the sites, three to six |
| `dataSources` | `[{ name, status, used, detail }]`, every source used **or looked for** |
| `suggestions` | `{ themeId: [{ goal, title, page, what, evidence, pattern? }] }`, two to four per theme |

## Write the suggestions

A suggestion is one page and one change, with the reason in the data. Write them for every
theme, not only the ones on Focus: the team decides the focus in the panel.

- **The page** is a real URL on the firm's sites that answers 200 (`--check-urls`). Prefer the
  pages AI visitors already land on for the theme (read 1 `top`) and the pages already cited.
- **The goal** is the job the change does:
  - `seen`: the answer reads the page and names the firm as the source. Facts as text, a dated
    summary, one named thing per page, content that agents can read without scripts.
  - `chosen`: the visitor who clicks can act. The H1 states the job, a next step on every deep
    page, a tool, offer or contact in the first screen, redirects that keep old links working.
- **What** says the change in one or two sentences a content team can do without the report.
- **Evidence**, one line each, with its kind:
  - `Brand data`: the firm's own numbers (visits, tracked prompts, stated strategy);
  - `Brand Visibility`: an open opportunity on that page (summaries, hidden content, table of
    contents, readability), with the count;
  - `Study`: a finding from the study the run uses.
- **pattern: true** where the page publishes findings openly and the plan's `pattern` fits. The
  card then lists what else the page needs for both jobs. Keep the pattern generic: it names
  page parts, not another site.
- Speak of the brand, not "you": the reader works for the firm or for its agency.
- No product pitch. The changes are about the firm's pages.

## Data sources

List every source the run used or looked for, so a reader sees what the numbers rest on:

- `included`: used as planned. Put scope and date in `detail`.
- `partial`: used with a gap (one market, one engine, form interactions but not leads).
- `missing`: looked for and not available (no CDN connected, no URL-level citations). Say what
  it would have added in `used`.

## Install on a site

The panel is installed **into the site**: `*.aem.page` and `*.aem.live` send no CORS headers
for scripts.

| From | To |
| --- | --- |
| `ew-panel/index.html`, `panel.js`, `model.js`, `brand-visibility.css` | `tools/brand-visibility/` |

1. Add `/brand-visibility/*` to the site's `.hlxignore`, so no data file is served from code.
2. Upload `brand-visibility.json` to the content store at `/brand-visibility/brand-visibility.json`
   and **preview it; never publish it**. On a Source Bus site: `PUT
   https://api.aem.live/{org}/sites/{site}/source/brand-visibility/brand-visibility.json`, then
   `POST …/preview/brand-visibility/brand-visibility.json`, with an IMS token (`da-auth` skill).
   Check `https://main--{site}--{org}.aem.page/brand-visibility/brand-visibility.json` answers
   200 and the `.aem.live` URL answers 404.
3. Register a `library` row with `experience: fullsize-dialog`:

   | title | path | experience |
   | --- | --- | --- |
   | Brand visibility | `/tools/brand-visibility/index.html` | `fullsize-dialog` |

   On a Source Bus site the editor config is `https://api.aem.live/{org}/sites/{site}/config/editor/da.json`:
   GET it, add the row, POST the whole object back. On a DA site, a row in the `library` sheet
   of the site config.
4. Open any page of the site in Experience Workspace, then Brand visibility from the tools.
   The first Focus, Watch or Skip creates `/brand-visibility/focus.json` (PUT and preview with
   the user's token, from the panel). It is previewed and never published.

- **Standalone**: `/tools/brand-visibility/index.html?path=/` works outside Experience Workspace;
  choices are then not saved, and drafting in the chat is not offered.
- **Deep links**: `?view=plan` opens the plan, `?topic=<id>` opens a topic.
- The page carries `noindex`. The data and the choices hold the firm's numbers and decisions:
  they stay in the content store, previewed only, like the cohort files.
- Model tests: `test/brand-visibility-panel.test.mjs` in this repo.
