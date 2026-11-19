# aem-optel-clients

Use AEM Operational Telemetry (Optel, formerly RUM) data anywhere: in a web page,
a Node script, an Experience Workspace extension, or an agent.

Reference: [Operational Telemetry on aem.live](https://www.aem.live/developer/operational-telemetry) (what is collected,
sampling, privacy, checkpoints).

New here? Start with the **[step-by-step guide](docs/guide.md)**: from a domain key to a traffic
picture, a brand visibility plan, a cohort homepage and a narrated video, in the order to do them.

What is here:

| | |
| --- | --- |
| [`optel-client.js`](optel-client.js) | One dependency-free ES module. Loads bundles from `bundles.aem.page` with a domain key, and turns them into reports (traffic sources, clicks and dead clicks, Core Web Vitals, errors and 404s, forms, scroll reach, journeys, experiments), plus use-case reports: an activity ladder instead of bounce, AI assistant referrals (organic vs ChatGPT ads) vs search, redirect chains per ad network, dead taps per component, behaviour profiles for bot / AI-agent hunting, one-page briefs and period comparisons. Runs in the browser, in Node 18+, and as a CLI. Annotated for the coding model that builds on it: the header and section comments explain the data model, the checkpoints, and the rules that keep numbers right. |
| [`skills/aem-optel/SKILL.md`](skills/aem-optel/SKILL.md) | An agent skill: how to get the key, which command answers which question, what the data means, and how not to misread a sample. |
| [`skills/homepage-cohorts/SKILL.md`](skills/homepage-cohorts/SKILL.md) | An agent skill for EDS sites: size cohort rules on the homepage's Optel traffic, draw the Sankey, build a cohort homepage as a POC, promote it as a 90/10 experiment with the [AEM Experimentation plugin](https://github.com/adobe/aem-experimentation) (rollback is one metadata row), and review every rule against its holdout each month. Ships a dependency-free cohort engine. |
| [`skills/site-merge/SKILL.md`](skills/site-merge/SKILL.md) | An agent skill for sites that are being consolidated into one: read each site's visits by what they come for, merge the cohorts that share a need into the audiences of the new site, and draw the Sankey (each site on the left, merged audiences on the right, what each keeps and gains), with layers for all traffic, SEO and GEO. Includes the runtime guide for arrivals from the old sites. |
| [`skills/brand-visibility/SKILL.md`](skills/brand-visibility/SKILL.md) | An agent skill for planning search, AI answers and the website as one thing: three reads of a firm merged by client theme. Who arrives (Optel visits of every site by the theme of the landing page), what people ask (prompt and search demand per theme and who is named, from Adobe Brand Visibility prompt research or Semrush), what the firm wants (its public statements). Each theme gets a job (claim, defend, win), an experience and one line to track it by; the three reads are drawn as one picture. |
| [`skills/brand-visibility-video/SKILL.md`](skills/brand-visibility-video/SKILL.md) | An agent skill: the narrated explainer of that plan, a storyboard template and captures on the video pipeline below. |
| [`skills/homepage-cohorts-video/SKILL.md`](skills/homepage-cohorts-video/SKILL.md) | An agent skill: a narrated explainer or monthly update video of the cohort homepage, from the site's captures, `cohorts.json` and `review.json`. Playwright, ffmpeg, and ElevenLabs or macOS `say`. |
| [`skills/demo-guide/SKILL.md`](skills/demo-guide/SKILL.md) | An agent skill: the self-paced guide a customer gets with the link to a demo site. Checks that the demo is merged, deployed and answering, sorts the use cases into what works from a link and what needs a presenter, captures the live pages, and builds a PDF of six to eight stops in the site's own design, each with a link, what to look for and something to try. `build.js` fails on overflowing pages, missing images and dead links. |
| [`skills/data-report/SKILL.md`](skills/data-report/SKILL.md) | An agent skill: the follow-up PDF a customer asks for after a brand visibility session, "the data you showed us". Explains the AI discovery-to-revenue funnel and Return on Brand Visibility (RoBV), marks which stages were measured and how, then walks through the reads (Optel visits by theme, Brand Visibility and Semrush prompts, citation attempts, the firm's statements) with the merged sankey, and one cohort sankey per homepage. Findings only, no recommendations. Built from the outputs of `brand-visibility`, `homepage-cohorts` and an optional Brand Visibility agentic-traffic export; Node and Chrome, no packages. |

It grew out of two Experience Workspace panels, which now live here too:
[`extensions/experience-workspace/`](extensions/experience-workspace/README.md)
(Page Insights and Improve Impact), for any site whose domain key you have.

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

Claude Code: clone the repository and link every skill. The skills find the client and each
other by their place in the repository, and `git pull` updates them.

```bash
git clone https://github.com/keepthebyte/aem-optel-clients ~/Code/aem-optel-clients
mkdir -p ~/.claude/skills
for s in ~/Code/aem-optel-clients/skills/*/; do ln -sfn "$s" ~/.claude/skills/"$(basename "$s")"; done
```

To copy only the first skill instead, keep the client next to it:

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
failure modes (404 slots, rejected keys, key redaction). The Experience
Workspace panels' rules, Stardust brief and per-site settings run on a
synthetic fixture. The homepage-cohorts engine, sizing, Sankey and monthly
review run on synthetic bundles too. So do the site-merge steps: need
classification, the merge per layer, the redirect model and the Sankey build,
and the brand-visibility read of visits by theme and its picture.

## Versions

See [CHANGELOG.md](CHANGELOG.md). When you change the client or the skill, add a
line under **Unreleased**. To release, move those lines under a new version, bump
`VERSION` in `optel-client.js` and `version` in `package.json` to match, and tag
the commit `vX.Y.Z`.

## Notes

- Classification rules (acquisition, consent, CWV thresholds, page views, bounces,
  engagement) follow [`@adobe/rum-distiller`](https://www.npmjs.com/package/@adobe/rum-distiller),
  the library behind the Optel explorer. Use it directly when you need its full
  faceting engine. This client trades that for one file with no dependencies.
- Campaign conventions differ per site; adjust `RULES` in the client rather than
  forking the classifier.

Apache-2.0.
