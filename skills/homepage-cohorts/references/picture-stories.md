# Picture stories: the pictures per cohort

The rules decide which sections a cohort gets. The pictures in them are a second facet. Down
the page, the large pictures tell a story whether anyone planned one or not. On the original
homepage it is the campaign's story, the same for everyone. A picture story gives each cohort
pictures that follow its question, one step per picture, and ends with the question answered.

First done on bmw.de (November 2026): five stories over the hero, the electric section, a brand
moment, the closing band and the model finder. 14 pictures from bmw.de's own pages, 14 more
sections in the cohort page, no change to the engine.

Do this after the experiences are agreed and their sections exist (SKILL.md step 3). The story
changes pictures, and sometimes the order inside a block. It does not change which cohorts
exist or what they get first.

## 1. What the data can say

```bash
node scripts/pictures.js --rules ../site/scripts/cohort-rules.js --bundles home.jsonl --site site.jsonl \
  --match 'media_|scene7\.com/is/' [--kinds kinds.json] --out pictures.json
```

Optel's `viewmedia` records a picture scrolled into view. That is **exposure, not
preference**: a group that has a picture in view more often scrolls further, or gets another
rendition, or lands on the page that carries it. Nothing in Optel says a group likes a picture.
Read `pictures.json` for three things:

- **How long the story can be** (`rules[].depth`): the share of each cohort's views that get 1,
  2, 3 ... pictures into view. On bmw.de, 97% of homepage views reached one picture, 69% two,
  22% three and 9% four. First visits on phones got 93% / 49% / 8%. Plan the beats a cohort
  actually reaches. Put the one that matters most second, not fourth, and keep the closing
  picture for the cohorts that get there.
- **Where the group already is** (`landing`, with `--site`): the same rule evaluated on the
  group's landing views elsewhere on the site, with each picture's page. On bmw.de, search-ad
  arrivals landed on the BMW i3 and iX3 model stages, and AI referrals on recall and service
  pages. These pages are where the pictures come from (step 3). Only rules on observable signals
  are evaluated there (referrer, campaign, ad click, device). Memory rules are not, since memory
  is not in Optel.
- **What comes after the homepage** (`afterHome`, by device): the pages opened right after the
  homepage and their pictures. Only device can be split out there, because the referrer of that
  view is the homepage.

`leansTo` lists pictures a group has in view clearly more often than everyone. Separate mobile
and desktop files of one picture count as two pictures, which makes a device rule "lean to" its
own renditions. Group them with `--kinds` (regexes on the file name, first match wins), and read
`kinds` per rule.

For blocks that show a list (models, products, plans), the order is part of the story. Take it
from what the group views: model pages per arrival group, `size.js` `secondOrder`, `landing.pages`.
On bmw.de the search and ad arrivals viewed the i3 Limousine most (17.6% of their model-page
views), so their Elektro tab leads with it. The electric-intent cohort's tab is ordered by range.

## 2. The storyboard

1. **The beats** are the page's large pictures, top to bottom: the hero and two or three more
   (a feature section, a brand moment, the closing band). Small cards and icons are not beats.
2. **One question per cohort**, in the visitor's words, from what the group does today
   (`cohorts.json` `today.topClicks`, `secondOrder`). bmw.de:

   | Cohort | Question | Beats |
   | --- | --- | --- |
   | shopper | "Which one is mine?" | dealer conversation · two people with their 1er |
   | shopper:electric | "Will it fit my life?" | i3 in the city · wallbox at home · far from home with an iX3 |
   | shopper:used | "A BMW within reach" | saloon from above · dealer · collecting the car |
   | configured | "Almost mine" | the iX5 four ways: seat, from above, driveway, out with it |
   | owner | "Look after me" | people with their 1er · BMW Service · roadside help |

3. **Each beat moves the question a step**, and the last one shows it answered (the decision
   made, the car collected, help arrived). A cohort that has decided (configured, returning to
   a product) sees one subject throughout: the thing it chose, from more sides.
4. **Who keeps the original**: `default` (the holdout guarantee), usually the phone cohort
   (it reaches two beats), and personal agents, which get no decorative beats
   (`references/agent-experience.md`).
5. Put the storyboard on one image, one row per cohort and one column per beat, and agree it
   before building. The pictures are the argument, and they are faster to judge in a row than
   in five pages.

## 3. Choosing the pictures

- **From the site's own pages**, the ones the cohort lands on or goes to (`landing.pictures[].page`).
  Do not generate pictures or bring in stock. Reuse the source page's alt text.
- **Pictures of what the cohort can act on.** bmw.de's configured cohort had the iX3 M60 in
  its hero, a model that cannot be configured. It was replaced by the iX5 driver's seat.
- **Check each picture on its source page** and keep the result (a script that opens each page
  and reads, per picture, whether an AI label is near it, its alt text, and the legal lines on
  it and on the page):
  - **AI label**: a picture the site labels as AI-generated keeps its label, or is not used.
  - **Legal lines tied to the picture**: consumption and emissions (WLTP, EU automotive), price
    and finance disclaimers, product safety lines. Rule used on bmw.de, named as an assumption:
    a picture that shows an identifiable current product carries that product's line as the
    site states it on the product page. A picture with no identifiable product carries none,
    as on its source page. A picture whose line cannot be established is dropped. Six models on
    the road were dropped that way.
  - **Usage**: campaign pictures can have an end date. Ask the owner when a picture comes from a
    campaign page.
- **Crops**: give a reused picture a focus variant on the block (`teaser (moment, focus-top)`,
  `object-position`) instead of editing the asset. Check the phone crop on its own.

## 4. On the cohort page

No new mechanism. Each beat is a `Slot`, and each cohort's picture is its own section in that
slot (`references/content-model.md`). The original section stays in the slot with
`Cohorts: default`:

| Section | Section Metadata |
| --- | --- |
| Original electric section | `Slot: electric` · `Cohorts: default` |
| Electric section, i3 in the city | `Slot: electric` · `Cohorts: shopper:electric` |
| Original brand moment | `Slot: moment` · `Cohorts: default` |
| Moment: wallbox at home | `Slot: moment` · `Cohorts: shopper:electric` · `Hide For: agent` |
| Moment: BMW Service | `Slot: moment` · `Cohorts: owner` · `Hide For: agent` |
| Original closing band | `Slot: closing` · `Cohorts: default` |
| Closing: collecting the used car | `Slot: closing` · `Cohorts: shopper:used` |

- Give every picture section an `Insight` that names the story and the finding: `Picture story
  "Almost mine": every large picture is the BMW iX5. 6.6% of homepage views come back from the
  configurator.` The demo panel and the Experience Workspace panel show it.
- **Blocks with internal state** (tabs, carousels) repeated per cohort: give each copy its own
  ids and group names. On bmw.de, one shared tab group name left only the last copy with a
  selected tab and the others showing every panel.
- **Page weight**: every variant repeats its block's content (bmw.de's cohort page went from
  52 KB to 103 KB with the finder variants). The engine removes the other variants before the
  first section shows, so their lazy images should not be requested. Check the network panel for
  one cohort.
- `verify.js` after the change: the default must still be the homepage.
- Check each cohort with `?cohort=<rule id>` at desktop and phone widths: the right pictures,
  no overflow, the phone crop.

## 5. In the monthly review

`review.js` measures the whole experience against its holdout. The pictures are part of it and
cannot be isolated from the sections around them. What can be read on its own:

- Run `pictures.js` on the cohort page's views (`--path /new`, or `/` once promoted) and read
  `depth` per rule: does each cohort reach its own closing picture? If a cohort stops one beat
  short, move its key picture up or shorten the story.
- A picture test on its own needs its own arm. Two sections in the same slot with the same
  `Cohorts` cannot split traffic. That is an experiment of its own (the Experimentation
  plugin), not something the cohort engine does.
