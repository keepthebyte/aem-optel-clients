# aem-optel-clients

Use AEM Operational Telemetry (Optel, formerly RUM) data anywhere: in a web page,
a Node script, an Experience Workspace extension, or an agent.

Reference: [Operational Telemetry on aem.live](https://www.aem.live/developer/operational-telemetry) (what is collected,
sampling, privacy, checkpoints).

Two things:

| | |
| --- | --- |
| [`optel-client.js`](optel-client.js) | One dependency-free ES module. Loads bundles from `bundles.aem.page` with a domain key, and turns them into reports (traffic sources, clicks and dead clicks, Core Web Vitals, errors and 404s, forms, scroll reach, journeys, experiments). Runs in the browser, in Node 18+, and as a CLI. Annotated for the coding model that builds on it: the header and section comments explain the data model, the checkpoints, and the rules that keep numbers right. |
| [`skills/aem-optel/SKILL.md`](skills/aem-optel/SKILL.md) | An agent skill: how to get the key, which command answers which question, what the data means, and how not to misread a sample. |

It grew out of two Experience Workspace panels built on a demo site
(page insights and content-owner insights), which read the same bundles.

## Getting a domain key

The bundles are read with a key per hostname. `example.com`, `www.example.com`
and `main--site--org.aem.page` each have their own key, so ask for the exact
hostname visitors see (usually the `www.` one).

- **Adobe customers**: there is no self-service yet. Contact Adobe (your account
  team or Adobe support) and ask for the Operational Telemetry domain key for your
  hostname.
- **Adobe employees**: the Cloud Service Workspace has a tool that generates the
  key for a given hostname. You need the right entitlements to use it.
- **No key yet?** `emigrationbrewing.com` is a public demo site whose key is
  `open`. Use it to try the client:

  ```bash
  OPTEL_DOMAIN_KEY=open node optel-client.js --domain emigrationbrewing.com --last 30d --report summary
  ```

Treat a key like a password. Don't commit it or put it in shared URLs or public
front-end code.

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
npm test             # offline
npm run test:live    # against the open demo domain, needs network
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
