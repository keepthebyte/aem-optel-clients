---
name: demo-guide
description: Write a self-paced demo guide for a customer, a short PDF that walks them through a demo or prototype site on their own, stop by stop, with a clickable link for every use case, a screenshot of what they should see, something to try, and an honest note on what is not real. Verifies the demo first (everything merged and deployed, every link answering), inventories what works from the site's run sheets and rules, captures the live pages, lays the guide out in the site's own design and builds the PDF with checks for overflowing pages, broken images and dead links. Use when asked for a demo guide, self-guided tour, field guide, leave-behind, handout or "package" to send a customer with the demo link, when a demo should be explorable without a presenter, or when a customer asks what they can click on in a prototype, also for sites built with the homepage-cohorts skill.
---

# Demo guide

A demo is usually presented once, to a few people. The guide is what the others get: a PDF they
open next to the site and click through alone, in about twenty minutes. It has to do three jobs a
presenter does without thinking: say where to click, say what to look at when the page loads, and
say what is not real.

The reader is a customer stakeholder, not a developer. They don't know the URL parameters, they
haven't seen the run sheets, and nobody is there to rescue a broken link. So the order of work is:
make sure the demo is in a state to hand over, find out what works on its own, then write.

```
run sheets, rules, commits ─▶ stops (what, link, what to look for, what to try)
captures.json ─ capture.js ─▶ shots/*.jpg            (homepage-cohorts-video skill)
templates/guide.html ───────▶ guide.html             (the site's fonts and colours)
guide.html ─ build.js ──────▶ <Customer>-Demo-Guide.pdf + checks
```

Needs Node 18+ and Chrome (or Chromium; `CHROME=/path` if it is not found). The captures need
Playwright, as in `homepage-cohorts-video`, and ffmpeg to crop and scale them.

## 1. Is the demo ready to hand over?

A guide freezes the demo: after it is sent, every link in it has to keep working. Check before
writing, and tell the user what you found, because "is everything in main?" is usually the
question behind the request.

- **Code**: no unmerged branches (`git branch -a --no-merged origin/main`), no open pull
  requests, no stash, local `main` equal to `origin/main`, the last build green.
- **Deployed**: the files on the demo host are the files in `main`. Compare hashes, and fetch with
  `curl --compressed`: the host answers gzipped, and a hash of the compressed bytes differs for
  every file, which reads as "nothing is deployed". `head.html` and `404.html` are processed by the
  pipeline and never match.
- **Content**: every page the guide will link returns 200 on the host the customer will use.
  Content is published separately from code, so a page can be missing while its block is there.
- **Left-overs from rehearsals**: a test that was switched on live (Experiment rows in a page's
  metadata), a partner set to paused, an edited headline. Each run sheet has a reset step and
  usually a one-line check: run it.
- **Which host**: the one the run sheets name. A demo that is only previewed must not be linked
  on its published host, and the other way round.

Fix what is yours to fix, and stop to ask before merging or publishing anything.

## 2. What can a customer do alone?

Read what the presenter uses: the run sheets and upload notes in the repo (`DEMO-*.md`,
`UPLOAD.md`, the README), the demo URLs they list, the scenarios in `cohort-rules.js`, and the
last commits (the newest feature is often in no document yet). Open the pages. Then sort every use
case into one of three:

| | What it is | Where it goes |
|---|---|---|
| **Self-serve** | Works from a link, in any browser, with no sign-in | A stop |
| **Needs a driver** | Happens in the editor, needs an account, or changes the site for everyone (publishing a form, switching on a test) | One list at the end: "better with a guide" |
| **Leave out** | Modes for other audiences (a neutral or white-label brand switch), offers written for real third-party companies, anything half-working, internal tooling | Nowhere, and say so to the user |

For a step that needs a driver there is often a self-serve half: the test cannot be switched on,
but the control and the challenger are two pages that can be opened side by side. Use that half as
the stop and say plainly why the rest is not running.

A use case is only a stop if the reader can see it. An arrival that matches a rule but whose
page looks like the default (the rule only reorders something far down, or changes nothing
visible) is left out: the reader would click, see the same page and doubt the rest.

Some demos have no run sheets. Then the repo cannot say what is normally shown live: ask the
user what they present with the editor open, rather than guessing the "better with a guide" list.

Prefer the links a real visitor would arrive with (campaign tags, a referrer stand-in) over a
parameter that forces an experience: the point of the demo is that the page works it out. Keep the
forcing parameter for the cheat sheet.

## 3. Plan the stops

Six to eight stops, about twenty minutes in total, each with a time. More than that and nobody
finishes; a stop that needs more than five steps is two stops.

Order them the way a presenter would:

1. **The one control that explains the rest** (on a cohort site: the `?demo` visitor switcher and
   "Explain sections"). The cover's button opens this.
2. **Arriving like a real visitor**: a grid of four to six arrivals, each a link.
3. **Things to click**: a calculator, a builder, a form. Say that nothing is sent.
4. **What the site remembers**: browse something, go back to the homepage.
5. **The newer ideas**: AI visitors, partners, content inside another app, a test.
6. **The last page**: the final stop on top, and under it a cheat sheet of the URL parameters,
   the list that needs a driver, and how to get unstuck (a private window; a site with memory
   keeps showing the last experience). The cheat sheet alone leaves half a page empty.

Every stop has the same parts, because the reader learns the pattern on the first one:

- a **headline** that says what happens ("Become someone else in one click"), not the feature name;
- one or two sentences of why it matters to them;
- **numbered steps**, each starting with a verb, each link clickable;
- **look for**: the one thing on the loaded page that proves the point. Without it the reader
  sees a nice page and misses that it changed;
- **try this**: a small experiment with a visible result (swap a word in the link, pick two
  visitors after each other);
- a **screenshot** of the state they should reach, so they know they are in the right place.

## 4. Captures

Screenshots come from the live host, never from a mock-up, so the guide cannot show something the
site doesn't do. Use `capture.js` of the `homepage-cohorts-video` skill with
`templates/captures.example.json`: it hides automation, so links with real signals show their
experience (a plain headless browser is taken for a bot and gets the default page for every one).

```bash
C=~/Code/aem-optel-clients/skills/homepage-cohorts-video/scripts
node $C/capture.js --config captures.json --out shots
```

- **Find where the change is before choosing the shot.** Capture each arrival as a full page
  first and look at them side by side. Where the hero changes, the first screen is the shot
  (`"viewport": true`). Where the hero is the same for everyone and the difference sits under it
  (a band, a section moved up), first screens all look alike: crop the full page around what
  changed instead.
- Captures are at `"width": 1360, "height": 850`, a size that stays readable when it is
  3.5 inches wide.
- Dismiss the demo or consent dialog with `"session"` / `"local"` (the storage key the site sets
  when it is acknowledged), so it is not in every shot. On a first screen leave the "this is a
  demo" badge in: the reader will see it too. On a full page hide it
  (`"css": ".demo-badge{display:none}"`): a fixed badge lands in the middle of the page and
  covers what the crop is about.
- A state behind one click (an open panel) takes `"click"`. A part further down the page takes
  a `mark` on the element; its position is in `shots/index.json`.
- **Crop and scale with ffmpeg.** capture.js writes at 2x (2720 px wide for a 1360 window): a
  dozen captures are 10 MB and more, and the PDF does not need them. Positions in `index.json`
  are in CSS pixels, so double them for the crop, then scale to 1360:

  ```bash
  # the 574 px starting 560 px down the page (a card of the arrivals grid is 1360 x 574)
  ffmpeg -loglevel error -y -i shots/f-arrival.jpg -vf "crop=2720:1148:0:1120,scale=1360:-1" -q:v 3 shots/g-arrival.jpg
  ffmpeg -loglevel error -y -i shots/home.jpg -vf "scale=1360:-1" -q:v 3 shots/g-home.jpg    # scale only
  ```

  (`sips -c … --cropOffset` on macOS crops somewhere else than asked: do not use it.)
- A state behind several clicks (a form two steps in) is more than capture.js does. Write a few
  lines of Playwright for that one shot: the same window and `deviceScaleFactor: 2`, the storage
  key set in `addInitScript`, the clicks, then `page.screenshot`.
- Check the log: `cohort=` is the experience you meant for that link. Then look at every image,
  cropped, before placing it. A capture of the wrong state is worse than none.

## 5. Write and lay out

Copy `templates/guide.html` next to the `shots/` folder and fill it. Put it where it is not
served: every committed file of an EDS repo is public, so a folder covered by `.hlxignore`
(check it), or outside the repo.

- **Brand**: set the colour variables and the two font families at the top from the site's own
  stylesheet, and load the site's fonts. The guide should look like it belongs to the demo.
- **Host**: the `demo-host` meta tag. Links are written as `<a data-p="/path?query">`, so the host
  is in one place and every link in the PDF is clickable.
- **Cover**: dark (the default) or light (`class="page cover light"`). Choose the one the
  homepage screenshot stands out on: a site whose first screen is dark disappears into a dark
  cover of the same colour.
- **Pages**: Letter, one `<section class="page">` each. The template has the cover, a stop with
  steps and a screenshot, the arrivals grid, two stops on one page, a side-by-side, and the last
  page. Reuse them; delete what the demo doesn't have.
- **Screenshots are shown whole** (no fixed height) unless they sit in the grid, where the top of
  the page is enough. A fixed height crops the right-hand side, which is where the price or the
  panel usually is.

Voice: short, second person, a little fun ("try to break it"). One idea per sentence. No feature
names the reader hasn't met, no rule ids, no internal tool names without a word of explanation.

Honesty, because the PDF travels without you:

- The cover says, before anything else: the site announces that it is a demo, nothing is real
  (prices, offers, partners), nothing typed is sent, and which browser to use.
- Numbers shown on the site are named with their source and period. If there are no results
  (no traffic on a demo), say that there are none; never fill the gap.
- A fictional partner or brand is called fictional. Real third-party companies are not given
  offers they never made.
- Where the demo stands in for something production would do differently (a parameter instead of
  a signed request, a preview host without a CDN step), say so in a "good to know" note.
- The footer of the last page carries the customer's name, "for discussion", and that prices,
  offers, statistics and names are illustrative.

## 6. Build and check

```bash
node ~/Code/aem-optel-clients/skills/demo-guide/scripts/build.js --guide guide.html --out Customer-Demo-Guide.pdf
```

`build.js` prints the PDF with headless Chrome and fails if:

- a page's content runs past its footer or into the cover's bottom block (the text would be cut
  off in print), or the PDF has more pages than the guide has sections;
- an image is missing, or a `{{placeholder}}` is still in the text;
- a link does not answer 200 (`--no-links` skips this when offline).

Then open the PDF and read it as the customer: click three links at random, check each
screenshot against its caption, and check the times add up to what the cover promises.

Hand over the PDF with a short note: what was verified (branches, deployed code, links), what was
left out and why, and what could not be checked (links with real signals in an ordinary browser,
if the captures used a forced experience). Say that the guide's source and screenshots are not
committed, if they aren't.

## Pitfalls

- **A link that worked yesterday**: content can be unpublished or a test left on between the
  check and the send. Run `build.js` again on the day it goes out.
- **Memory**: after a "browse, then go home" stop the site keeps that experience, and the next
  stops look wrong. Put the private-window tip on the stop and on the last page.
- **The demo dialog** comes back in a private window. Say so on the cover, so the reader doesn't
  think they left the demo.
- **Editor steps written as if anyone could do them**: the reader hits a sign-in and stops
  reading. They belong in the driver list.
- **Passing the build is not looking right.** `build.js` checks overflow, images and links. It
  cannot see a screenshot that blends into its background or a crop that misses the point: look
  at every page of the PDF.
- **Too much**: every scenario of the switcher as its own card. Pick the ones with a visibly
  different first screen; the switcher shows the rest.
