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
| `engine/cohort-panel.css` | `styles/cohort-panel.css` (theme with the `--cohort-*` properties) |
| `engine/cohort-preview.js` | `scripts/cohort-preview.js` (Experience Workspace Layout view, §7) |

`cohort-panel.js` imports `./cohorts.js`; keep them side by side.

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

`engine/ew-panel/` is a tool panel for the cohort page: pick a page variation (most visitors
first) and see the sections that visitor gets, in their order, with the interest variants
explained (where an interest comes from, what it swaps); put the cursor in a section to see who
it is for; a matrix of every section by every variation; and checks for what the canvas cannot show (a `Cohorts` value
no rule produces, a slot with no default, a key the engine ignores, and the holdout check: the
default view of the page against the homepage, section for section).

It runs the site's own `apply()` from `scripts/cohorts.js` with the site's
`scripts/cohort-rules.js`, so it shows what visitors get rather than a second copy of the
logic. That is also why it is installed **into the site** and not served from elsewhere: it
imports those two files, and `*.aem.page` / `*.aem.live` send no CORS headers for scripts.

| From | To |
| --- | --- |
| `engine/ew-panel/index.html`, `panel.js`, `model.js`, `cohorts.css` | `tools/cohorts/` |

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
- **Shares** per experience come from `cohorts.json` when it is published at
  `/cohorts/cohorts.json` (size.js output). That file is aggregated Optel data on a public
  host: publish it only where that is fine, otherwise the panel just leaves shares out.
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
- **Jumping** to a section uses `actions.scrollTo` when the host has it (not in production
  `da.live` yet); rows stay clickable and highlight the section in the panel either way.
- **Standalone**: `/tools/cohorts/index.html?path=/new` works outside Experience Workspace.
- Its model has tests (`test/ew-panel.test.mjs` in this repo); copy them next to the site's rule
  tests if the site changes the panel.
