# Install: plugin, engine, wiring

All of this is inert until a page opts in: the engine only runs on a page with
`Cohorts: on` metadata (the POC page) or inside the `homepage-cohorts` experiment
(the promoted homepage). Merging it to `main` changes nothing for visitors.

## 1. AEM Experimentation plugin

```bash
git subtree add --squash --prefix plugins/experimentation https://github.com/adobe/aem-experimentation.git main
```

Create `scripts/experiment-loader.js` exactly as in the plugin README ("Step 1"),
and add `<link rel="modulepreload" href="/scripts/experiment-loader.js" />` to `head.html`.
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
    runCohorts(main, cohortRules, { sampleRUM, getMetadata });
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

## 4. Sampling on low-traffic homepages

Optel samples 1 in 100 views by default. A homepage with fewer than ~100k views a month
will not reach significance per rule in a month at that rate. The plugin README
("Increasing sampling rate for low traffic pages") shows how to sample 1 in 10 on pages
with experiment metadata. Weights in the bundles adjust, so the review stays correct.

## 5. Tests

Add the site's rules to the site's tests, so a rules change cannot silently reorder cohorts:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRule } from '../scripts/cohorts.js';
import rules from '../scripts/cohort-rules.js';

const s = (o) => ({ refHost: '', source: 'direct', utm: {}, paid: [], device: 'desktop', bot: false, memory: {}, ...o });
test('portal visitors are customers', () => assert.equal(matchRule(rules, s({ refHost: 'portal.example.com' })).experience, 'customer'));
```
