# Install: plugin, engine, wiring

All of this is inert until a page opts in: the engine only runs on a page with
`Cohorts: on` metadata (the POC page) or inside the `homepage-cohorts` experiment
(the promoted homepage). Merging it to `main` changes nothing for visitors.

## 1. AEM Experimentation plugin

```bash
git subtree add --squash --prefix plugins/experimentation https://github.com/adobe/aem-experimentation.git main
```

Create `scripts/experiment-loader.js` exactly as in the plugin README ("Step 1"),
and preload it in `head.html`. If `head.html` has a Content-Security-Policy with
`'nonce-aem'` (the boilerplate's), the preload needs the same nonce or the browser
blocks it:

```html
<link rel="modulepreload" nonce="aem" href="/scripts/experiment-loader.js"/>
```

The README's loader can fail the site's lint in a few places; fix them in the site's
copy. The usual one is `import/no-relative-packages` on both `import('../plugins/experimentation/src/index.js')`
(the plugin has its own `package.json`): add `// eslint-disable-next-line import/no-relative-packages`
above each, and `plugins/` to `.eslintignore`. The engine files below pass the boilerplate's
airbnb lint as they are.

On a fresh aem-boilerplate checkout, `npm i` needs `--legacy-peer-deps` (its pinned `eslint@8`),
and if eslint then fails with `Cannot find module '@babel/core/package.json'`, add it:
`npm i -D @babel/core --legacy-peer-deps`.
Register the Sidekick "Experimentation" button (README, "Enabling the simulation panel").

If the plugin is already installed, keep it; check `VERSION` in
`plugins/experimentation/src/index.js` is 2.x.

## 2. Engine files

Copy from this skill's `engine/`:

| From | To |
| --- | --- |
| `engine/cohorts.js` | `scripts/cohorts.js` |
| `engine/cohort-rules.js` | `scripts/cohort-rules.js` (then write the site's rules) |
| `engine/cohort-panel.js` | `scripts/cohort-panel.js` |
| `engine/cohort-insights.js` | `scripts/cohort-insights.js` (Insights mode of the panel) |
| `engine/cohort-panel.css` | `styles/cohort-panel.css` (theme with the `--cohort-*` properties) |
| `engine/cohort-preview.js` | `scripts/cohort-preview.js` (Experience Workspace Layout view, §7) |

`cohort-panel.js` imports `./cohorts.js` and `./cohort-insights.js`; keep them side by side.

"Explain sections" (the dock switch, or `?demo&insights`) reads `insights.src` from the
rules (default `/cohorts/cohorts.json`): put `size.js` output there (run with `--site` so
`Insight Path` notes have the second order to generate from) as a file in the content store
that is **previewed and not published** (see "Data files stay off the live site" below).
Without it the
section notes still show their reasons and `Insight` text; only the numbers are left out. Theme
the notes with `--cohort-insight-max`, `--cohort-insight-gutter`, `--cohort-insight-gap`,
`--cohort-font`, `--cohort-accent`, `--cohort-tint`, `--cohort-ink`, `--cohort-ink-2`, `--cohort-rule`
and `--cohort-radius` on the site's `:root`, and move the launcher with `--cohort-bottom`. The panel
itself is Spectrum 2 (light) and stays the same on every site, so it reads as the tool and not as
part of the page; its tokens are inlined, and a site can still override any `--cohort-s2-*` (the
defaults sit in `:where(:root)`, so the site wins although cohort-panel.css loads last).

## 3. `scripts/scripts.js`

```js
import {
  // ...existing imports from './aem.js'
  getMetadata,
  sampleRUM,
} from './aem.js';
import { runExperimentation, runExperimentationLazy } from './experiment-loader.js';
import cohortRules from './cohort-rules.js';
import { runCohorts, rememberVisit, watchSignIn } from './cohorts.js';
import { previewForce, listenForPicks } from './cohort-preview.js';

const experimentationConfig = {
  prodHost: 'www.example.com', // the production host
  audiences: {},
};

async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  // 1. the plugin picks the arm and, for the challenger, swaps in the cohort page's <main>
  await runExperimentation(doc, experimentationConfig);
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    // 2. after decoration (sections carry their metadata), before the first section shows
    // in the Experience Workspace Layout view: the variation picked in the Cohorts panel (§7)
    const force = previewForce();
    const cohort = runCohorts(main, cohortRules, { sampleRUM, getMetadata, force });
    if (cohort) listenForPicks(force?.id || 'default');
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }
  // ...rest unchanged
}

async function loadLazy(doc) {
  // ...existing code
  // on-device memory on every page: visits, interests, signed in
  rememberVisit(cohortRules);
  watchSignIn(cohortRules);
  await runExperimentationLazy(doc, experimentationConfig);
}

function loadDelayed() {
  // ...existing code
  if (new URLSearchParams(window.location.search).has('demo')) {
    loadCSS(`${window.hlx.codeBasePath}/styles/cohort-panel.css`);
    import('./cohort-panel.js').then((m) => m.default(cohortRules));
  }
}
```

Order matters: `runExperimentation` before `decorateMain` (it replaces `<main>`), and
`runCohorts` after `decorateMain` (it reads `data-*` from Section Metadata) but before
`loadSection` (nothing is visible yet, so no flicker).

If the site's `aem.js` does not export `sampleRUM`, use `window.hlx.rum.sampleRUM`.

A site signal the engine cannot read itself (a partner looked up from an index, a segment from a
first-party cookie) goes in through `signals`: read `browserSignals(cohortRules)`, add the field,
and pass `{ signals }` to `runCohorts`. `when: { partner: true }` reads `signals.partner` this
way. `runsCohorts(cohortRules, getMetadata)` says whether the page runs cohorts at all, so the
lookup is only paid for where it is used.

## 4. Consent manager

With `memory.requireConsent: true` or `Experiment Requires Consent: true` (`rules.md`,
Privacy), the site's consent manager has to tell the plugin. Both read
`localStorage['experimentation-consented']`, which only `updateUserConsent()` writes.
Bridge the CMP's event in `experiment-loader.js`, importing the plugin only when the
stored decision changes. Osano, for example (`Osano.cm` fires `osano-cm-initialized` and
`osano-cm-consent-saved` with `{ PERSONALIZATION: 'ACCEPT' | 'DENY', ... }`):

```js
async function syncConsent(consent) {
  const consented = consent?.PERSONALIZATION === 'ACCEPT';
  let stored;
  try {
    stored = localStorage.getItem('experimentation-consented') === 'true';
  } catch (e) {
    return;
  }
  if (stored === consented) return;
  const { updateUserConsent } = await import('../plugins/experimentation/src/index.js');
  updateUserConsent(consented);
}
window.Osano?.cm?.addEventListener('osano-cm-initialized', syncConsent);
window.Osano?.cm?.addEventListener('osano-cm-consent-saved', syncConsent);
```

Pick the category with the privacy team (personalization, or analytics if that is how
the banner is worded). OneTrust: read `OnetrustActiveGroups` in `OptanonWrapper`.

The engine reads the stored decision itself for the loyalty split (`consentOf()`, `rules.md`):
OneTrust from its cookies, Osano from `Osano.cm.getConsent()`. Osano's own cookie
(`osano_consentmanager`) is encrypted; it only says that a choice was made. So load Osano's
script in the head before the engine (Osano asks for that anyway): when the engine runs before
it, a visitor who chose reads as `decided`, and nothing is remembered on that view.

Consent changes what can be shown: before consent, memory rules (returning visitor,
signed in, interests) never match, so demos and screenshots of them use `?cohort=<rule id>`,
which forces the rule without memory. On a replica or demo site without the real CMP,
stand in with a query flag that calls the same bridge.

## 5. Sampling on low-traffic homepages

Optel samples 1 in 100 views by default. A homepage with fewer than ~100k views a month
will not reach significance per rule in a month at that rate. The plugin README
("Increasing sampling rate for low traffic pages") shows how to sample 1 in 10 on pages
with experiment metadata. Weights in the bundles adjust, so the review stays correct.

## 6. Tests

Add the site's rules to the site's tests, so a rules change cannot silently reorder cohorts.
`matchRule()` returns `{ rule, experience, intent, keys, label }`: assert on `.rule` (the id) or
`.experience`, and `.rule === null` for the original page. The boilerplate's `package.json` is not
`type: module`, so name the test `*.test.mjs`; Node prints a harmless "Reparsing as ES module"
warning when the test (or `size.js`) imports `scripts/cohort-rules.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRule } from '../scripts/cohorts.js';
import rules from '../scripts/cohort-rules.js';

const s = (o) => ({ refHost: '', source: 'direct', utm: {}, paid: [], device: 'desktop', bot: false, memory: {}, ...o });
test('portal visitors are customers', () => assert.equal(matchRule(rules, s({ refHost: 'portal.example.com' })).experience, 'customer'));
```

## 7. Experience Workspace panel: who sees which section

`engine/ew-panel/` is a tool panel for the cohort page, laid out for a ~340px side panel:

- **Header** (sticky): live / read-only status, the issue count, a one-line switcher for the
  page variation (Everyone else first as the baseline, then most visitors first; a strip under it
  shows every share; arrow keys step through) and three tabs.
- **Page**: the picked variation's sections in their order. Putting the cursor in a section, or
  clicking its row, opens it in place: who sees it, the `Insight` behind it, and what the author
  can do for this variation (hide, remove, move up, show, delete, draft a version for it).
  Sections the variation does not get are listed under "Not on this page".
- **Overview**: a matrix of every section by every variation, then every variation with its
  share and the rules that lead to it.
- **Checks**: what the canvas cannot show (a `Cohorts` value no rule produces, a slot with no
  default, a key the engine ignores, and the holdout check: the default view of the page against
  the homepage, section for section).
- **Dock**: add a section for the picked variation, and review the changes against live.

It runs the site's own `apply()` from `scripts/cohorts.js` with the site's
`scripts/cohort-rules.js`, so it shows what visitors get rather than a second copy of the
logic. That is also why it is installed **into the site** and not served from elsewhere: it
imports those two files, and `*.aem.page` / `*.aem.live` send no CORS headers for scripts.

| From | To |
| --- | --- |
| `engine/ew-panel/index.html`, `panel.js`, `model.js`, `edits.js`, `cohorts.css` | `tools/cohorts/` |
| `engine/ew-panel/gallery.html`, `gallery.js`, `gallery.css`, `flow.js`, `holdout.js` (the gallery, §7b) | `tools/cohorts/` |

Register it with a `library` row in the site's Experience Workspace config
(`https://da.live/config#/{org}/{site}/`):

| title | path |
| --- | --- |
| Cohorts | `/tools/cohorts/index.html` |

A relative path follows the branch the canvas is opened on (`?ref=`), so a branch build of the
panel can be tried before it reaches `main`.

- **Live while editing**: it subscribes to the editor's document (SDK `subscribeLiveDocument`)
  and maps `selection.blockIndex` to its section. Without that action it reads the published
  page (`{path}.plain.html`, page metadata from the page head) and says "published".
- **Shares** per experience come from `cohorts.json` at `/cohorts/cohorts.json` (size.js
  output), previewed and not published; without it the panel leaves shares out.
- **Data files stay off the live site.** `cohorts.json`, `review.json` and the notes file
  (`insights.json`, `content-model.md`) hold the site's shares, rates and findings. Nothing a
  visitor gets needs them: only Explain sections, this panel and the gallery read them, on
  `*.aem.page`. So they live in the content store, previewed and never published: then they are
  200 on `*.aem.page` and 404 on `*.aem.live`. A file committed to the repository is served on
  both hosts by Code Sync: keep a copy there only with `/cohorts/*` in `.hlxignore`. After each
  sizing run, upload and preview again. With site authentication on preview, the files are
  behind the sign-in too. How to upload depends on the content store (`content.source.type` in
  the site config):

  | | Source Bus (`api.aem.live`) | DA (`admin.da.live`) |
  | --- | --- | --- |
  | Upload | `PUT {api}/source/cohorts/<file>.json`, raw body, `Content-Type: application/json` | `PUT https://admin.da.live/source/{org}/{site}/cohorts/<file>.json`, multipart field `data` (`-F "data=@file;type=application/json"`) |
  | Preview | `POST {api}/preview/cohorts/<file>.json` | `POST https://admin.hlx.page/preview/{org}/{site}/main/cohorts/<file>.json` |
  | `insights.json` | any shape | **sheet shape only** (below) |
  | `cohorts.json`, `review.json` | yes | **no**: preview answers 400 `error from content-bus` |

  `{api}` is `https://api.aem.live/{org}/sites/{site}`. DA previews a JSON file only when it is a
  sheet: `{ "total": n, "offset": 0, "limit": n, "data": [{ "id", "note" }], ":type": "sheet" }`
  (or author `/cohorts/insights` as a sheet in Experience Workspace). The notes fit that shape;
  `cohorts.json` and `review.json` are nested and do not. On a DA site they stay in the
  repository and are public on `*.aem.live`, so keep them there only where that is fine (a demo
  on synthetic data, or with the site owner's OK); otherwise leave them out, and the panel and
  gallery show no shares, and Explain sections no numbers. Either way, a file uploaded to DA
  that preview rejects is still stored: delete it (`DELETE` on the same source URL).
  (Checked November 2026.)
- **Layout view follows the panel**: picking a variation (or an interest) reloads the canvas
  Layout view as that variation; Content view keeps showing every section. The canvas serves the
  panel and the Layout page from the same `{ref}--{site}--{org}.preview.da.live` origin, so
  `scripts/cohort-preview.js` passes the pick over `localStorage` + `BroadcastChannel` and the
  page hands it to `runCohorts({ force })`. It only runs inside that preview iframe: visitors on
  `*.aem.page` / `*.aem.live` never read it, and a pick expires after 2 hours. Needs the §3
  wiring; without it the panel works and the Layout view stays on what the author's own visit
  matches.
- **Page metadata in the live document**: the editor's document has no page Metadata block
  (Experience Workspace edits it in its Page panel), so `Cohorts: on` / `Experiment` come from
  the published page head; a change there shows in the panel after publishing.
- **After a code push**, hard-reload the canvas: the preview iframe keeps the block CSS it
  loaded, so a fix can look missing in Layout view while `*.aem.live` already has it.
- **Edits go through the assistant.** The SDK can replace only the node under the author's
  cursor (`sendHTML(html, { replace: true })`), the panel cannot move that cursor, and Section
  Metadata tables are not blocks (`selection.blockIndex` is `null` in them). So a row action sends
  one exact request to the Experience Workspace assistant (`setPrompt`, auto-sent: "edit the
  Section Metadata table of section 4 (the cards block, starting "…") only: set the "Hide For"
  row to: …"), then confirms it in the live document (`subscribeLiveDocument`, and
  `subscribeChatTurnCompleted` when the host advertises `chatTurnCompleted`). Confirmed: a note
  with the new value and Undo (the reverse request). Not seen within the turn (or 2 minutes):
  the exact change to make by hand, with Copy. Needs chat enabled for the site (not
  `ew.disableChat`); `edits.js` holds the requests and the check, with tests.
- **New sections** for a variation are dragged into the page (`makeDraggable`; the host places
  them where the author releases) or inserted at the cursor (`sendHTML`), as a section with
  `Cohorts: <id>` in DA table form. "Draft a version" pre-fills a request in the chat without
  sending it. **Review** opens the comparison against live (`openComparison`).
- **Read-only**: actions are off when the live document says `editable: false`.
- **Spectrum 2**: styles use the `--swc-*` tokens from `@adobe/spectrum-wc` `tokens.css`, linked
  pinned from jsDelivr in `index.html`, with a fallback value on every alias (the panel still
  reads well without the sheet). `cohorts.css` also carries the three-line size-scale setup from
  `swc.css`: without it every size token is invalid ("14px 17px") and text falls back to 16px.
- **Jumping**: the SDK has no action to move the canvas to a section; rows open in the panel.
- **Standalone**: `/tools/cohorts/index.html?path=/new` works outside Experience Workspace; row
  actions then copy the change to paste.
- Its model has tests (`test/ew-panel.test.mjs` in this repo); copy them next to the site's rule
  tests if the site changes the panel.


## 7b. Experience Workspace gallery: every variation side by side

`engine/ew-panel/gallery.html` opens as a full-size dialog in Experience Workspace (90% of the
window, at most 1200px wide) and shows the cohort page once per variation, one column each,
scrolling together, as desktop (1440px) or phone (390px), scaled to the column. It is the
pre-production view: what each cohort will get, next to each other, before the experiment runs.

- **Variations** come from the live document's Section Metadata, the same model as the panel
  (`model.js`). Each column loads the previewed page with `?cohort=<rule id>`; the columns show
  edits after Preview, and a column whose section count differs from the document says so
  ("Preview: 9 of 10"), with one line under the header.
- **Everyone else** loads `{cohort page}?cohort=none`: the engine's original sections, which are
  the homepage by the holdout guarantee (`verify.js`), so this column follows edits too.
- **Compare**: a picker with a checkbox per variation (colour, section count, share from
  `cohorts.json`), Only per row and All; × on a column; keys 1-9 and 0. Columns are added and
  removed in place, so the others do not reload. The choice and the device are kept in
  `localStorage` for the next time; `?exp=a,b&device=phone` opens a given set.
- **Explain** reloads the columns with `?demo&insights&dock=off`: the section notes without the
  presenter dock (`cohort-panel.js`), since the gallery chooses the visitor.
- **Scrolling together** works because the frames load from the gallery's own origin (the
  canvas preview proxy, `{ref}--{site}--{org}.preview.da.live`), so the gallery can scroll them.
- An explicit `?cohort=` beats the panel's pick (`cohort-preview.js`): picking a variation in the
  Cohorts panel does not change or reload the gallery's columns.

Three tabs, kept for the next time:

- **Experiences**: the columns above.
- **Cohort data** (`flow.js`): how the cohorts came about, from `/cohorts/cohorts.json` (size.js
  output, §7): an interactive Sankey of entry source → device → rule that fires → homepage
  experience, coloured by experience or by signal. Clicking a node opens its details (who gets
  there, share by week, the holdout result) with a button to show that experience's page. Under
  it: week by week per experience, and "Look at again" (a small rule that stands out, a rule that
  grew, rules with too few views to judge, the share no rule matches, memory rules that are
  estimates). Without `cohorts.json` the tab says so.
- **Outcome** (`holdout.js`): each cohort against the visitors held back on the original page,
  from `/cohorts/review.json` (review.js output). Rules are grouped as Needs attention (worse
  than the holdout), Working (better), Optimize (enough visitors, no clear difference) and
  Waiting for data, each with its lift, a 95% interval and what to do next. A `weeks` series per
  rule (cumulative bundles and goal conversions) adds the goal-rate chart and "after N weeks";
  without it the rest works. **Until review.json exists the tab shows example data built from
  cohorts.json, labelled as such**: real shares and goal rates, invented effects.

Register it as a second extension with `experience: fullsize-dialog`:

| title | path | experience |
| --- | --- | --- |
| Cohort gallery | `/tools/cohorts/gallery.html` | `fullsize-dialog` |

- **DA sites**: a row in the `library` sheet of the site config (`https://da.live/config#/{org}/{site}/`,
  stored at `admin.da.live/config/{org}/{site}/`), with an `experience` column.
- **Source Bus sites**: the editor config is `https://api.aem.live/{org}/sites/{site}/config/editor/da.json`,
  plain JSON `{ "library": [{ "title", "path", "experience" }] }` (GET, then POST the whole object
  with `content-type: application/json`; an IMS token with access to the site).
- **Before it is on `main`**: a relative path loads from the branch the canvas is on. To try a
  branch from the main canvas, give an absolute branch URL
  (`https://{branch}--{site}--{org}.aem.live/tools/cohorts/gallery.html`): the canvas serves it
  through the preview proxy of that branch. A `ref` column instead hides the row unless the
  canvas is opened with that `?ref=`.
- **Opening**: from its row in the Panels list (the popout button). The Cohorts panel cannot
  open it: the SDK's `showPanel` takes a panel id and opens it in the side panel, not as a modal.
- Experience Workspace forces a light canvas for now (its dark mode is unfinished); the gallery
  and the panel follow the OS setting (`color-scheme: light dark`), with S2 tokens and fallbacks.
- Standalone: `/tools/cohorts/gallery.html?path=/new` outside Experience Workspace reads the
  published page.

## 8. Personal AI agents (only for a rule with `when.agent`)

Claude, Google and Manus agents name themselves in the user agent (`Claude-Agent`,
`Google-Agent`, `Manus-User`); the engine reads that and nothing else is needed.

ChatGPT and Meta agents browse from cloud browsers with an ordinary Chrome user agent and
`navigator.webdriver` off. They identify themselves with a request header the page cannot see:
`Signature-Agent: "https://chatgpt.com"` (Meta: `"https://muse.ai"` or `"https://www.meta.com"`).
Optel's collector reads the same header for `bot:ai:chatgpt-agent` and `bot:ai:meta-agent`.
To let the engine see it, the CDN copies it to the HTML response as a `Server-Timing` entry
named `agent`, which the page reads from its navigation timing:

```
Server-Timing: agent;desc="https://chatgpt.com"
```

`desc` is the header value as sent, or an agent name (`chatgpt-agent`, `meta-agent`). Add it
when the response is delivered, after the cache lookup, so the cached page stays one object
and no `Vary` is needed. Sketches; adapt to the site's CDN setup:

```js
// Cloudflare Worker
const KNOWN = ['"https://chatgpt.com"', '"https://muse.ai"', '"https://www.meta.com"'];
export default {
  async fetch(request, env, ctx) {
    const res = await fetch(request);
    const agent = request.headers.get('signature-agent');
    if (!KNOWN.includes(agent)) return res;
    const out = new Response(res.body, res);
    out.headers.append('Server-Timing', `agent;desc=${agent}`);
    return out;
  },
};
```

```vcl
# Fastly, in vcl_deliver
if (req.http.Signature-Agent == {""https://chatgpt.com""} || req.http.Signature-Agent == {""https://muse.ai""} || req.http.Signature-Agent == {""https://www.meta.com""}) {
  add resp.http.Server-Timing = "agent;desc=" req.http.Signature-Agent;
}
```

Without this step the rule still works for the three agents the user agent names; ChatGPT and
Meta agents then look like people and get whichever rule their referrer or device matches.
The header is self-declared (the signature is not verified here): fine for choosing a layout,
not for access or pricing. Check with `?agent=chatgpt-agent`, then with
`curl -sI -H 'Signature-Agent: "https://chatgpt.com"' https://www.example.com/ | grep -i server-timing`.

