---
name: brand-visibility-video
description: Make a narrated explainer video of a brand visibility plan built with the brand-visibility skill, three reads of a firm (who arrives, what people ask, what the firm wants) merged by client theme into a job per theme. Storyboard template and captures for the three-reads picture revealed one read at a time, the sites today, the topic space, a scene per job (claim, defend, win) and the tracking line; rendered with the pipeline of the homepage-cohorts-video skill (Playwright, ffmpeg, ElevenLabs or macOS say). Use when asked for an explainer, pitch or walkthrough video of a GEO, AEO, SEO or brand visibility strategy, or to repeat the three-reads video for another customer.
---

# Brand visibility video

A 5 to 6 minute explainer of the plan from the `brand-visibility` skill. It teaches a way to
think (three reads, one plan) with the firm's own numbers. It uses the scripts of
`homepage-cohorts-video` as they are; read that skill for the pipeline, the voice setup and
`references/storyboard.md` for every scene type.

Everything said or shown traces to a file: `visits-by-theme.json`, `reads.json`, the topic
lists behind it, a public statement with its date, or a capture of a live page.

## The story

| Part | Scenes of the template | Scene type |
| --- | --- | --- |
| The firm today | `intro`, `situation`, `brands` | title, stats, brands |
| The model | `define` | pillars |
| Read 1 | `arrive`, `merge` (the site-merge Sankey, when there are several sites) | stats, browser |
| Read 2 | `space` | space |
| Optional read | `fetch`: what assistants fetch, when the firm has citation attempts | bars |
| Read 3 | `wants` | pillars |
| The merge | `reads`: the picture, one read at a time, then the plan | browser, four pages |
| A job each | `p-claim` + proof, `p-defend` + proof, `p-win` + proof | title, then bars, stats or browser |
| The human side | `human`, `cohorts`: who clicks nothing, then every version of the homepage, when the site has cohort pages | stats, strip |
| Tracking | `measure` | browser or stats |
| Close | `close` | title |

One theme per job, the one where the three reads agree most. A proof scene is a number
(`bars`, `stats`) followed, where it exists, by the page that does the job (`browser`).
A page that is a proposal is labelled as one (`"label": "<b>One possible answer</b> ..."`).

## Variations

- **A fourth read.** With citation attempts (see `brand-visibility/references/reads.md`), add
  `fetch` and say "four reads": a column in `define` (`"cls": "four"`), a `title` in
  `reads.json` for the picture. Rank themes by attempts; do not show a trend.
- **A firm that is changing who it sells to.** Tell it as a pivot: after `situation`, a
  `pillars` scene of the pivot (who sells, what, who buys); after `reads`, a title card that
  says what the reads show together (often: the products the firm wants are the ones it is
  least read for); then one `pillars` scene with the approach instead of a scene per job.
  A shape that held: bridge (lead with the theme already read), borrow (bring in the audience
  of a brand it owns), build (the theme that starts near zero). Jobs stay in the picture.
- **The human side.** Visibility brings the visit; the page keeps it. `human` shows the share
  of views that click nothing, overall and for two sources (`today.didNothing` in
  `cohorts.json`), `cohorts` shows every version as a full page with its share, and one
  `browser` scene walks through a single version. Capture each version with its rule forced
  (`?cohort=<rule id>`) and a mark named `slot` on what changes.
- **A sequel.** When an earlier video exists, open on the question it closed with.

## Make it

Work in a folder outside any site repository.

```bash
P=../homepage-cohorts-video/scripts
cp templates/three-reads.storyboard.json storyboard.json   # and captures.example.json → captures.json, deck-extras.css
# delete the scenes you have no data for: fetch, human, cohorts
node $P/capture.js --config captures.json --out work/captures
node $P/tts.js --storyboard storyboard.json --out work/audio             # draft voice (macOS say)
node $P/render.js --storyboard storyboard.json --work work --stills reads space   # look at stills first
node $P/render.js --storyboard storyboard.json --work work --out draft.mp4
node $P/tts.js --storyboard storyboard.json --out work/audio --final 1   # voice.final, ElevenLabs
node $P/render.js --storyboard storyboard.json --work work --hq 1 --out final.mp4
```

Captures:

- The picture four times, `three-reads.html?show=arrive`, `ask`, `want`, `plan`, at
  `"width": 1320`, with marks on `#chart`, the three groups and the themes you ring.
- The sites today, for the `brands` scene: `"consent": true` accepts the cookie banner the way
  a visitor would, so the shot shows the page and not the banner. Look at each one.
- Pages that prove a job, with marks on what the narration points at.
- A banner that appears late survives `consent`: hide it with the page's own `"css"`
  (`"#onetrust-consent-sdk { display: none !important; }"`). Open every capture of a live site.
- A page that only runs locally: capture it from the local server and write what it is in the
  address bar (`"url": "Demo · /new"`), never a host it is not on.
- With a slide template, append `deck-extras.css` to its stylesheet: four-up columns and cards
  (`"cls": "four"`) and a bars scene of eight or more rows (`"cls": "tight"`).

## Writing it

- Length: 850 to 1,050 spoken words for 5 to 6 minutes. A first draft runs long; cut every
  scene to one idea, drop scenes that repeat a point, keep title cards to 3 or 4 seconds.
- Voice for a long explainer: a narrator with some range, a little faster than default.
  A starting point for ElevenLabs: `stability` 0.4 to 0.45, `style` 0.3 to 0.35, `speed` 1.1.
  Listen to one scene before voicing the rest. A voice from where the firm is based reads as
  care: search the voice library by city or region, and voice one scene as a test (a library
  voice works by its id).
- Say what each read is: measured, estimated, read from public statements. Scope and date of
  read 2 go on screen (`sub` of the scene). Proposals are called proposals.
- For a customer you already work with: frameworks and what follows from their data. No
  product names in the narration; a source label on screen is enough.
- Numbers on screen are digits from the files; before the final render, list each one with
  the field it came from.
- A page that reproduces a brand on a demo domain says so in the video (title or end card).
