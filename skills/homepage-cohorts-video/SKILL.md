---
name: homepage-cohorts-video
description: Make a narrated explainer video of a cohort homepage built with the homepage-cohorts skill, from its real data and live pages. Captures the original and cohort pages with Playwright, voices a storyboard (ElevenLabs with character timestamps, macOS say, or silent), and renders scenes frame by frame (browser scrolls with callouts, the traffic Sankey revealed column by column and path by path, phone side-by-sides, each rule against its holdout) into an MP4 with ffmpeg. Two templates, the leadership pitch for a POC and the monthly results update. Use when asked for an explainer, demo, walkthrough or update video of a cohort, personalised or optimised homepage, or a video of the Optel Sankey and the monthly cohort review.
---

# Homepage cohorts video

The video documents what the cohort engine does, with the site's own numbers. Two uses:

- **The pitch** (`templates/explainer.storyboard.json`, 3–5 min): the problem on today's
  homepage, the traffic mix (Sankey), the biggest and most valuable cohorts and what each
  gets now, how it is measured. For leadership, before promoting the POC.
- **The monthly update** (`templates/monthly.storyboard.json`, 1–2 min): last month against
  the 10% holdout, what is kept, fixed or dropped, which unmatched traffic becomes the next
  rule. Re-run after every monthly review of the `homepage-cohorts` skill.

Everything said or shown must trace to a file: `cohorts.json` (sizing), `review.json` (the
monthly review) or a capture of a live page. No invented numbers, no client names that are
not the site's own. `references/storyboard.md` has every scene type and field.

## Pipeline

```
captures.json ─ capture.js ─▶ work/captures/*.jpg + index.json   (pages and the boxes of marked elements)
storyboard.json ─ tts.js ───▶ work/audio/<scene>.mp3 + .json      (narration and the time of each {cue})
cohorts.json ─ sankey.js ───▶ sankey.svg                           (homepage-cohorts skill)
all of it ─ render.js ──────▶ work/stills/*.png  |  work/video.mp4 + video.timeline.txt
```

Needs Node 18+, ffmpeg/ffprobe and Playwright (`npm i -D playwright && npx playwright install chromium`
in a scratch folder, or `NODE_PATH` to an install). Work in a folder outside the site repo:
captures, audio and video are large, and every committed file of an EDS repo is served.

## 1. Inputs

From the `homepage-cohorts` skill: `cohorts.json`, `sankey.svg` (run `sankey.js` with the
`--title`/`--subtitle` you want on screen), and for the monthly update `review.json`. Read
them first and write down the numbers the story will use: total views and weeks, the share
that clicks nothing, the device split, the 3–4 rules to feature (largest share × value; a
small cohort with a high-value goal beats a big one with none), each one's goal rate today.

Modelled rules (`rules[].modelled`, memory rules sized from proxies) are said as modelled,
in the narration and on screen, the way the Sankey footnote does.

## 2. Captures

Copy `templates/captures.example.json`. One entry per page the video shows:

- the original homepage as the holdout sees it: `/?experiment=<id>/control` once promoted,
  `/` before;
- each featured cohort experience: `/new?cohort=<rule id>` (POC) or
  `/?experiment=<id>/challenger-1&cohort=<rule id>`;
- the same on a phone (`"mobile": true`) for the device rules;
- `marks`: CSS selectors of what a callout points at (sign-in link, hero, the slot).

```bash
node capture.js --config captures.json --out work/captures
```

Check the log: `cohort=` must be the rule you asked for (a capture showing `none` means the
engine took the browser for a bot: run through capture.js, which hides automation, and
never headless shell), and `MISSING marks` must be empty. Scroll-driven sections (a sticky
stage inside a box several screens tall) are collapsed so the shot is not screens of
background; `"keepSticky": true` keeps them. Look at every capture before using it.

## 3. Storyboard and voice

Copy a template and fill it from step 1. Write the narration first, scene by scene, short
sentences, one idea per scene; put `{cue}` markers where the picture should change, and
time visuals to cues, never to seconds.

Voice (`storyboard.voice`):

- `{"provider": "none"}` for layout drafts, `{"provider": "say", "sayVoice": "Samantha"}`
  for timing drafts (macOS, free);
- `{"provider": "elevenlabs", "voiceId": "...", "model": "eleven_multilingual_v2", "settings": {...}}`
  for the final. Key in `ELEVENLABS_API_KEY` or `~/.config/elevenlabs/key`, never in the repo or
  the storyboard. To find an accent the audience will hear as local, search the shared voice library:
  `curl -s -H "xi-api-key: $KEY" "https://api.elevenlabs.io/v1/shared-voices?language=en&accent=canadian&gender=male&page_size=20"`,
  listen to `preview_url`, then add the voice to the account (`POST /v1/voices/add/{public_owner_id}/{voice_id}`) before using its id.

```bash
node tts.js --storyboard storyboard.json --out work/audio             # cached per scene: re-voices only edited scenes
```

Spell numbers the way they should be spoken ("forty-eight percent"); the screen shows the
digits. Brand the stage with `storyboard.brand` (CSS variables `dark`, `dark2`, `accent`,
`ink`, `soft`, `font`, `serif`) and `storyboard.fonts` (a stylesheet URL).

## 4. Render

```bash
node render.js --storyboard storyboard.json --work work --stills            # a PNG at every cue: review these
node render.js --storyboard storyboard.json --work work --stills mix paths  # some scenes only
node render.js --storyboard storyboard.json --work work                     # the video
node render.js --storyboard storyboard.json --work work --only results      # re-render scenes, reuse the other clips
```

Review the stills before the full render (a 4-minute video takes a few minutes). Look for:
callouts on the right element, text over busy images, numbers matching the files, scenes
that end before their last element appears (add `hold` seconds), and a ring that never shows
because its mark is scrolled out of view.

Hand over `work/video.mp4` with `video.timeline.txt` (scene start times) and the storyboard.
Keep the storyboard with the review: next month's update starts from it.

## Pitfalls

- **The default must equal the homepage.** If the original capture and the cohort page with
  no rule matched differ, fix the site (`verify.js` in `homepage-cohorts`) before filming.
- **Session stickiness**: the experiment arm is kept per browser session; capture.js starts
  each page in a new context, so `?experiment=` and `?cohort=` always apply.
- **Sankey labels** come from the rules' `label`s and the experiences: make them readable
  before rendering the Sankey; the video cannot fix them.
- **Synthetic or low-sample data** says so on screen (`sub` of the results scene) and in the
  narration. A rule marked `not enough data yet` is never presented as a win.
