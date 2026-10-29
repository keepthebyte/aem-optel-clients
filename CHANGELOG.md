# Changelog

What changed in `optel-client.js` and the `aem-optel` skill, newest first.
The version is `VERSION` in `optel-client.js` and `version` in `package.json`;
each release is tagged `vX.Y.Z`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[semantic versioning](https://semver.org/). Before 1.0, a minor version can
change report shapes or classification results; read **Changed** before upgrading.

## [Unreleased]

## [0.4.0] - 2026-10-29

### Changed
- AI assistant attribution follows https://attribution.now/reclaim-direct-traffic, in
  `classifyAcquisition` and the `homepage-cohorts` engine (`sourceOf`):
  - A `utm_source` like `chatgpt.com` behind a search referrer is organic search (a search
    result linking a tagged URL), not AI.
  - The ChatGPT Android app referrer `android-app://com.openai.chatgpt/` is ChatGPT.
  - Copilot referrers `copilot.com`, `copilot.cloud.microsoft` and
    `m365copilotapp.svc.cloud.microsoft` are AI.
  - `sourceOf` takes the view's ad networks: a ChatGPT ad click (`oppref`/`olref`) is no
    longer `source: 'ai'`. Match it with `paid: ['openai']`.

### Fixed
- `homepage-cohorts-video` render: each scene's narration is levelled to the same loudness
  before the mix. Scenes are voiced one request each and came back up to 12 dB apart; only
  the whole track was normalised, so quiet scenes stayed quiet.
- `homepage-cohorts-video` stage: the dim behind stat cards fades out with them; rings work
  on marks in the header; the ring glow and background shade follow the brand colours; the
  web fonts are loaded before the first frame; the holdout label wraps instead of clipping.
- `classifyConsent`: the Osano Cookie Manager (`osano-cm-*`, `osano-manage-cookies`) is a
  cookie banner. Before, its accept/deny/manage clicks counted as content clicks and topped
  homepage click lists and cohort goals on a site using it.
- `classifyAcquisition`: links from Dynamics 365 Customer Insights marketing email
  (`marketingusercontent.com`, `mkt.dynamics.com`) are owned email, not referrals.
- `homepage-cohorts` sizing:
  - Modelled memory now applies only to views no referrer, tag or device rule matches.
    Modelled from the view's own clicks, it used to move the views that reached a goal into
    the memory rules (one search rule read 0% instead of 27%).
  - Modelled rules report no goal rate today, since their views are chosen by clicking.
  - `model.click` sets the rule's `when.interest`, so interest rules can be modelled from a
    click pattern.
  - External click targets keep their host in `topClicks`: a jobs site is no longer listed
    as `/`.
  - `verify.js` reads Section Metadata delivered as `data-*` attributes on the section
    (as `.plain.html` serves it on Source Bus sites), not only as a block. Before, every
    section looked unlabelled there and the check reported a false mismatch.
  - The engine (`cohorts.js`, `cohort-panel.js`, `cohort-rules.js`) passes the
    boilerplate's airbnb lint, so sites no longer need to lint-ignore it.
- `homepage-cohorts` install: the `experiment-loader.js` preload carries the CSP nonce
  (`nonce="aem"`); without it the boilerplate's policy blocks it.

### Added
- `homepage-cohorts-video`:
  - `capture.js`: `session` / `local` storage set before page scripts run, to dismiss a demo
    or consent dialog in every shot. Pages that never go network-idle are captured after load.
  - Stage: `accentInk` brand variable for a light accent on white; per-phone `scroll` in
    `phones` scenes.
- `homepage-cohorts` install: wiring a consent manager (Osano, OneTrust) to the plugin's
  consent, and what consent means for demos of memory rules (`?cohort=`).
- `homepage-cohorts`:
  - `size.js` and `review.js` take a comma list in `--path`, for one rule set across locales
    with the same audience.
  - SKILL.md says to find the homepage's real path (`/` often redirects), compare locales
    before writing one rule set, check that the cookie banner is recognised, and name email
    tools and Wi-Fi portals as sources.

### Changed
- `aem-optel` skill: sample-size guidance measured on a second, mid-size site. Daily and
  monthly files are thinned subsets of the hourly ones, by 1.4x to ~50x for one page
  depending on traffic (monthly ~11x on the mid-size site), so the factor is measured, not
  assumed. Per-page, cohort and experiment work always loads hourly files; a load with
  failed files is reloaded before reporting.
- `homepage-cohorts` skill: always hourly files, ~100 s per month; the holdout arm is the
  sample bottleneck, so small rules are judged on pooled months.

### Added
- `skills/homepage-cohorts`: optimise an EDS homepage for the cohorts in its traffic.
  First-match rules in one file (`cohort-rules.js`) are sized on Optel bundles
  (`size.js` → `cohorts.json`), drawn as a Sankey (`sankey.js`), served by a
  dependency-free engine (`engine/cohorts.js`, Section Metadata picks the sections) and
  reviewed monthly against the holdout (`review.js`: lift and p per rule, an A/A check
  on unmatched views, the biggest unmatched groups). POC on `/new` or a branch; promotion
  is a 90/10 experiment with the AEM Experimentation plugin, rolled back by authors with
  `Experiment Status: off`. `verify.js` checks the cohort page with no rule matched is
  the homepage. The engine fires an `audience` checkpoint (rule id, arm) on every view.
- `skills/homepage-cohorts-video`: a narrated video of that work, for the pitch and the
  monthly update. `capture.js` (pages and marked elements; hides automation so the engine
  does not serve the bot default; collapses scroll-driven sticky sections), `tts.js`
  (ElevenLabs with timestamps, `say`, or silent; cached per scene), `stage.html` (scene
  types: browser, Sankey reveal and paths, phones, results, facts, holdout) and
  `render.js` (stills at every cue, or the MP4).
- `extensions/experience-workspace/`: two Experience Workspace tool panels for any
  site, served from GitHub Pages. **Page Insights** reads a week of a page's
  telemetry and tells its story (taps, reach, intent, redirects, language, consent).
  **Improve Impact** ranks what an author can fix in Experience Workspace (each with
  the visitor cohort it affects) and what needs a redesign, with a ready-to-paste
  brief for the Stardust skill. Site, key and campaign conventions come from the
  extension URL or are asked once; the AI-surface section is off unless `?ai=on`.
  The panels import `optel-client.js` from this repo, so they ship with the client.

## [0.3.1] - 2026-10-04

Paid-visit attribution and media reach fixes, found by porting an Experience Workspace
panel onto the client and comparing its old numbers with the client's. Paid visits are
labelled differently, so `paid:*` labels move: on one large brand site 11.6% of visits
changed label (all of them paid), on a B2B site 0.01%.

### Fixed
- `mediaReach()` named every item after the most-seen media of the whole page instead of
  the item's own media, so all rows carried the same image (the logo, typically).
- Paid visits ignored `utm_source_platform` (the buying platform the marketer declared)
  and fell back to the ad server they passed through: Trade Desk buys landing through
  Amazon's ad server were `paid:display:amazon`. The platform now counts, after the source
  tag and a social referrer (an Instagram referrer stays Instagram when the platform is "Meta").
- Paid visits ignored the channel named in the source tag: `utm_source=display_p` with a
  doubleclick click id and no medium was `paid:search:google`. The source tag and then
  `utm_content` (`video`, `image`) now set the channel, after the medium and the referrer.
- A doubleclick or DV360 click id without tags is display, not search. Google Ads click ids
  (`gclid`) without tags stay search.

### Added
- Vendor `tradedesk` (The Trade Desk: `THETRADE`, `ttd`, `adsrvr.org`). Untagged visits
  from `adsrvr.org` count as paid display, like other ad-server referrers.
- Short source names `yt` (YouTube) and `snap` (Snapchat): `utm_source=yt_p` is YouTube
  whatever the platform (DV360) or the click id (Google) says.
- `mediaReach()` groups an image's renditions (`…/image.png/width750.png`,
  `…/width1280.png`) under one media URL.

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

[Unreleased]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/keepthebyte/aem-optel-clients/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/keepthebyte/aem-optel-clients/releases/tag/v0.1.0
