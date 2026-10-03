# aem-optel-clients

Use AEM Operational Telemetry (Optel, formerly RUM) data anywhere: in a web page,
a Node script, an Experience Workspace extension, or an agent.

Two things:

| | |
| --- | --- |
| [`optel-client.js`](optel-client.js) | One dependency-free ES module. Loads bundles from `bundles.aem.page` with a domain key, and turns them into reports (traffic sources, clicks and dead clicks, Core Web Vitals, errors and 404s, forms, scroll reach, journeys, experiments). Runs in the browser, in Node 18+, and as a CLI. Annotated for the coding model that builds on it: the header and section comments explain the data model, the checkpoints, and the rules that keep numbers right. |
| [`skills/aem-optel/SKILL.md`](skills/aem-optel/SKILL.md) | An agent skill: how to get the key, which command answers which question, what the data means, and how not to misread a sample. |

It grew out of two Experience Workspace panels built on the Coca-Cola demo site
(page insights and content-owner insights), which read the same bundles.

## Quick start

```bash
export OPTEL_DOMAIN_KEY=...            # the domain's key; never commit it
node optel-client.js --domain www.example.com --last 7d --report summary
node optel-client.js --domain www.example.com --path /products/shoes --report clicks
node optel-client.js --help
```

```js
import { loadBundles, byPath, summary } from './optel-client.js';

const { bundles } = await loadBundles({
  domain: 'www.example.com', domainKey, last: '7d', filter: byPath('/products/shoes'),
});
console.log(summary(bundles));
```

In a browser, import the file with `<script type="module">`. The bundler allows
any origin. A key in front-end code is visible to every visitor, though, so public
apps should go through a small proxy that adds the key (pass its URL as `endpoint`).

## Use the skill

Claude Code: copy the skill and the client next to each other.

```bash
mkdir -p ~/.claude/skills/aem-optel
cp skills/aem-optel/SKILL.md optel-client.js ~/.claude/skills/aem-optel/
```

Other agents: point them at `skills/aem-optel/SKILL.md`. It is plain Markdown with
a name/description front matter.

## What is in a bundle

One bundle is one sampled page view: `url`, `userAgent` (`mobile:ios`), `weight`
(how many real views it stands for, usually 100), `time`, and `events`, each a
`{ checkpoint, source, target, value }`. `CHECKPOINTS` in the client lists what
every checkpoint's source and target mean. It was checked against
`@adobe/helix-rum-js` 2.17 and `@adobe/helix-rum-enhancer` 2.50.

## Tests

```bash
npm test
```

Synthetic bundles in the real shape plus a mocked bundler. They cover URL and
range planning, classification, aggregation, every report, and the loading
failure modes (404 slots, rejected keys, key redaction).

## Notes

- Classification rules (acquisition, consent, CWV thresholds, page views, bounces,
  engagement) follow [`@adobe/rum-distiller`](https://www.npmjs.com/package/@adobe/rum-distiller),
  the library behind the Optel explorer. Use it directly when you need its full
  faceting engine. This client trades that for one file with no dependencies.
- Campaign conventions differ per site; adjust `RULES` in the client rather than
  forking the classifier.

Apache-2.0.
