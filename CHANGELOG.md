# Changelog

What changed in `optel-client.js` and the `aem-optel` skill, newest first.
The version is `VERSION` in `optel-client.js` and `version` in `package.json`;
each release is tagged `vX.Y.Z`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[semantic versioning](https://semver.org/). Before 1.0, a minor version can
change report shapes or classification results; read **Changed** before upgrading.

## [Unreleased]

## [0.3.0] - 2026-10-03

Classification fixes from testing on small sites and more consent banners. Before
upgrading, note that consent clicks, referrer channels (messaging, dev, intranet) and
code-block clicks are classified differently, so those numbers move compared with 0.2.0.

### Added
- Cookie banners from Tealium and Osano (cookieconsent) count as consent clicks, plus a
  fallback for other banners: a cookie, consent or gdpr name inside a `dialog`, or next to a
  banner word (`cookie-banner`, `consent-notice`). A cookie word alone is not enough, so
  `a.cookie-dough` on a food site stays a content click. Before this, a Tealium banner's clicks
  counted as content interaction on about 20% of one site's homepage views. (#2)
- Small samples are flagged: `lowSample: true` on grouped rows under 30 bundles (`LOW_SAMPLE`)
  in `activityReport`, `aiReferralReport` segments, `redirectReport` groups and `deadClickReport`.
- `clickResolution(selector)`: `element` or `block`. Dead-tap rows carry it, and
  `deadClickReport` adds `elementDeadViewShare`. On a developer docs site, 11% of views had a
  "dead tap", 2% at element level; the rest were clicks on text and section wrappers.
- `classifyClick` returns `text` for clicks in code blocks (`pre`, `code`, `.hljs`, Prism
  `.language-*`): text selection, not dead taps. Only whole classes match, so `.pre-order`
  and `.code-of-conduct` stay dead taps.
- Referrer types `messaging` (Teams, Slack, Discord, Telegram, WhatsApp web), `dev`
  (localhost, `127.x`, `.test`) and `intranet` (private IP ranges, `.local`, `.internal`,
  `.corp`, `.lan`). Visits become `earned:messaging`, `owned:dev` and `earned:intranet`
  instead of `earned:referral`. Teams was 3.6% of visits on a developer site. Intranet
  referrers are a company's internal systems (ERP, service portals) linking to the site:
  a real audience on B2B sites, so they count as earned, not as developer traffic.
- `CHECKPOINTS.cwv`: the value-less marker older script versions send.
- Skill: small-site guidance (sample sizes, mixed weights, bot and prerender shares).

### Changed
- CWV values are rounded where they are read (`cwvOf`): whole ms, CLS to 4 places.
  p75s no longer print as `134.69999999995343`.

### Fixed
- `flows()` listed clicks on images and files (a logo `.svg`) as next pages. (#2)
- Google's Android app referrer was reported as `www.google.com` next to `google.com`.
- JS errors without a message or location were labelled `" @ undefined error"`; now
  `(no message) @ ...`.

## [0.2.0] - 2026-10-03

Use-case reports. Tested on two production domains and cross-checked against an
independent count for the same 28 days: visits within 0.2%, raw page views within
0.5%, ChatGPT-tagged entries identical. (#1)

### Added
- Reports, in the library and the CLI:
  - `activity`: what each visit did (nothing, consent banner only, scrolled,
    interacted, navigated), per channel or any key. Use it instead of bounce.
  - `ai`: AI assistant visits split into organic citations and ChatGPT ads,
    compared with search, with landing pages, a weekly trend and an automation flag.
  - `redirects`: redirect chains per ad network, time lost, TTFB and LCP,
    engagement by delay.
  - `dead-clicks`: dead taps per component and page, repeat taps.
  - `segments`: behaviour per user agent, for spotting bots and AI agents.
  - `page`: everything about one page in one call.
  - `compare --vs previous`: key rates against the previous period, with p-values.
- Helpers: `activityOf`, `scrolled`, `msSinceStart`, `timeTo`, `normalizeSelector`,
  `registrableDomain`, `weekOf`, `comparePeriods`, `acquisitionKey`.
- CLI options `--checkpoints` (keep fewer events while loading, but always the ones
  the report needs), `--normalize`, `--by week`.
- Skill: a recipe per use case, and a section on what bundles cannot answer
  (cross-domain benchmarks, geo and IP, sessions, bot volumes).

### Changed
- Ranges: a bare `--end` date includes that whole day, and loads are trimmed to
  `[start, end)` UTC, so hourly and daily loads of the same dates cover the same
  views. `--last 3m` now ends exactly three months back instead of loading whole
  calendar months.
- Acquisition:
  - ChatGPT ads are `paid:ai:chatgpt`.
  - A Facebook ad that also carries a DV360 click id is Facebook, not Google.
  - YouTube ads are `paid:video:youtube`.
  - A referrer on the brand's own domain (an SSO or market subdomain) is `owned:internal`.
- Campaign tags ending in `_p`, `_o` or `_e` count as paid, owned or earned
  (`RULES.typeSuffix`). This is on for every site; set it to `null` to turn it off.
- `reach` falls back to `viewmedia` on sites that send no `viewblock` (AEM Cloud Service).

### Fixed
- A file the bundler refuses as too large (413, over 6 MB) is loaded as its days
  or hours instead of being dropped.

## [0.1.0] - 2026-10-03

First release: one dependency-free client plus an agent skill.

### Added
- `optel-client.js`, for the browser, Node 18+ and the command line:
  - `loadBundles`: hourly, daily and monthly files; filtering and event pruning
    while loading; retries; and an immediate error with the key redacted when a
    domain key is rejected.
  - `CHECKPOINTS`: what each event's source and target mean, checked against
    helix-rum-js 2.17 and helix-rum-enhancer 2.50.
  - Classifiers: referrers, acquisition (paid, owned, earned), clicks, cookie
    banner clicks, redirects. Rules live in `RULES` so a site can override them.
  - Aggregation: `groupBy`, `percentile`, `timeSeries`, `marginOfError`,
    `compareProportions`.
  - Reports: summary, pages, sources, clicks, cwv, errors, forms, reach, flows,
    experiments, checkpoints.
- `skills/aem-optel/SKILL.md`: getting and protecting a key, which command answers
  which question, the data model, and rules for reading sampled data.
- How to get a domain key, and the public demo domain (`emigrationbrewing.com`,
  key `open`) for trying the client without one.
- `npm run test:live`: a smoke test against the demo domain.

### Fixed
- `clickReport` took each element's link targets from every click in the same
  views, so a dead element could show up as a link. Targets are now counted per element.
- OneTrust buttons that report as `dialog button#close-pc-btn-handler`, with no
  `onetrust` in the selector, count as cookie-banner clicks.
- Journeys label back/forward and reload views instead of "(unknown)".

[Unreleased]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/keepthebyte/aem-optel-clients/releases/tag/v0.1.0
