# Content model: one cohort page, all experiences

The cohort page (`/new` by default) is one document that holds every experience.
Authors keep editing it like any page; the engine removes what a visitor should not see.

## Start from a copy of the homepage

1. Copy the homepage document to `/new` **unchanged**. These sections are the `default`
   experience: what unmatched visitors in the challenger see, and exactly what the
   holdout sees on the real homepage.
2. Add cohort sections around them. Never edit an original section in place: give the
   new version its own section in the same slot (below).
3. Run `scripts/verify.js` after every content change. It fails if the default rendering
   drifts from the homepage, which would turn the holdout comparison into apples vs pears.

## Section Metadata keys

| Key | Value | Effect |
| --- | --- | --- |
| `Slot` | `hero` | Sections sharing a slot compete; the first whose `Cohorts` has the most specific key wins, the rest are removed. Put the original section in the slot with `Cohorts: default` (or no `Cohorts`). |
| `Cohorts` | `customer, prospect:pricing` | Section only for these experiences. `experience:intent` is more specific than `experience`. No `Cohorts` = everyone. |
| `Hide For` | `customer, mobile` | Section removed for these experiences (use `default` to hide it from unmatched visitors and keep the default identical to the homepage). On a `Slot` section it leaves the slot empty for that experience when this section would be the one shown. |
| `Promote` | `customer` | Section moved right under the first section for these experiences. |
| `Insight Path` | `/coverage-exclusions` | Not read by the engine. The page this section stands in for; Insights mode generates its findings from `cohorts.json` `secondOrder` (next stop after the homepage, next step after a page, lift before the conversion). Comma list allowed. Prefer it to typed numbers. |
| `Insight` | `coverage-next-step` | Not read by the engine. The id of the section's note in the notes file (see below). A note written here directly still works, but it is published with the page: keep numbers out of it. The note is the Optel finding behind the section, shown on the page in the demo panel's Insights mode and in the Experience Workspace panel. One or two sentences with the number and the period. |

Keys a visitor matches, most specific first: `<experience>:<intent>`, `<experience>`, `default`.
`<experience>` comes from the rule (`experience: 'prospect'`), `<intent>` from the campaign
tags or the top on-device interest (`intents` in the rules).

## Insights: say why each section is there

Every cohort section exists because of something in the data: who arrives, what they do
today, where they go next (the second-order paths). When a section brings a page onto the
homepage (coverage, FAQ, cancel policy), give it `Insight Path` with that page's path: the
note then generates the numbers from `secondOrder`, and they follow each size.js run. Keep
`Insight` for what the data cannot say on its own (why it matters, what you decided). Write that down in the section's `Insight`
while sizing, with the number and the period, in the visitor's terms:

| Section | Insight |
| --- | --- |
| Account tasks | `~15% of homepage views click Log in; customers get their tasks first.` |
| Coverage details, promoted for ad visitors | `After a product page the #1 next step is coverage & exclusions (2.8k in 8 weeks).` |
| Comparison table | `Comparison-site visitors are 4.1% of views and 58% start a quote: give them the comparison.` |

`/new?demo&insights` (or **Explain sections** in the demo dock) puts a note on top of every visible section:
a reason computed from its metadata and the visitor's match ("Hero made for Express · dog",
"Moved up for Comparing", "Everyone sees this section"), then the `Insight`. The first note and
the panel's "What the data shows" add the visitor's cohort from `cohorts.json`: share, what it
does today against the page average, goal rate, growth and caveats (modelled, low sample),
generated from the numbers, so they follow next month's `size.js` run. Keep numbers out of the
visible copy; they belong in `Insight` and `cohorts.json`.

### Notes live in a file that is not published

Section Metadata is delivered with the page (`data-insight` on the section), so a note written
there is public, with every share and rate in it. Keep the notes in a sheet instead:

| id | note |
| --- | --- |
| `account-tasks` | ~15% of homepage views click Log in; customers get their tasks first. |
| `coverage-next-step` | After a product page the #1 next step is coverage & exclusions (2.8k in 8 weeks). |

- Author it as a sheet at `/cohorts/insights` (columns `id`, `note`), **preview it and do not
  publish it**: it then exists on `*.aem.page` (where Experience Workspace and the demo run) and
  not on the live site. `rules.insights.notes` names it (`/cohorts/insights.json`); a plain
  `{ "id": "note" }` JSON file works too on a Source Bus site. A DA site previews only the sheet
  shape (`install.md`, "Data files stay off the live site").
- The section carries the id: `Insight: coverage-next-step`. An id is one word (letters, digits,
  dashes, underscores).
- Explain sections, the Experience Workspace panel and the gallery look the note up. Where the
  file cannot be read there is no note; the panel names an id it cannot find.
- The panel's Checks flag a written note that has numbers in it.
- `scripts/notes.js <page.html> --out <page.html> --notes insights.json` moves the written notes
  of a page's stored HTML into the notes file and leaves their ids in the page.
- With site authentication on preview, the notes and `cohorts.json` are behind the same sign-in.
  `cohorts.json` and `review.json` follow the same rule: preview, do not publish. DA cannot
  preview them (`install.md`).

## Example

| Section | Section Metadata |
| --- | --- |
| Original hero | `Slot: hero` · `Cohorts: default` |
| "Welcome back" sign-in hero | `Slot: hero` · `Cohorts: customer` |
| Pricing hero matching the ad | `Slot: hero` · `Cohorts: prospect:pricing` |
| Generic prospect hero | `Slot: hero` · `Cohorts: prospect` |
| Four quick tasks | `Cohorts: mobile` · `Promote: mobile` |
| Original product rows | `Hide For: customer` |
| Customer top tasks | `Cohorts: customer` · `Promote: customer` |
| Original footer CTA | (none) |

## Blocks

Cohort sections usually need a few new blocks (a sign-in-first hero, task tiles, an
answer-first prospect hero). Build them with the `aem-edge-delivery-services` skills
(`content-driven-development`, `building-blocks`), scoped CSS, defensive decoration,
and test content on the cohort page. Reuse existing blocks wherever an existing block
with different content does the job: fewer blocks, less to maintain per cohort.

Prefer a **variant of an existing block** (`promo (poster)`, `promo (ledger)`) over a new block
when the content shape is the same: one telco POC shipped three cohort designs with one new
block (`tasks`, four variants) and four variants of the existing `promo`.

Design each experience from the evidence in `cohorts.json` (`rules[].today.topClicks`,
`didNothing`): put what that cohort already looks for first, and remove what it ignores.
`topClicks[].link: false` is a control that opened something (a menu, the search box), not a
destination: on a large homepage the account menu toggle can be the top "click" of most cohorts.

**Reused images on new backgrounds.** A cohort design often puts an existing image on a
background the original never had (a brand-colour poster, a dark ledger). Product photos come
with their own backdrop; brand graphics (a price lockup, a logo, type on transparency) often do
not, and brand-colour type on a brand-colour card disappears. Look at each reused image on its
new background; give the media a neutral panel in the block CSS rather than editing the asset.

**Size media by its aspect ratio** (`height: auto; aspect-ratio: …`), never `height: 100%`
on an image or a single card. Experience Workspace's preview gives the page's ancestors a
definite height, so `100%` resolves there and stretches the image or card to the full section,
while on `*.aem.live` it resolves to `auto` and looks right. Keep `height: 100%` for cards that
sit side by side (equal heights in a row) and check the cohort page in the canvas Layout view.

## Header, nav and other shared chrome

Sections only cover `<main>`. The header and footer are fragments shared with the original
page, so a cohort cannot change them through Section Metadata. The engine marks the body
instead: `body[data-experience="mobile"]`, `body[data-cohort="<rule id>"]` (both `default` /
`none` in the holdout). Style or decorate the shared header against those, scoped so the
original never changes, e.g. a visible "Log in" button for `mobile` where the original shows an
account icon. Check the holdout with `verify.js` afterwards: the header is not in its section
comparison.

## Pictures per cohort

The same `Slot` mechanism carries a picture story: one section per cohort for each large
picture down the page (hero, feature section, brand moment, closing band), the original in the
slot with `Cohorts: default`. How to choose the pictures from Optel and the site's own pages,
check them, and lay out the slots: `references/picture-stories.md`.

## Designs from Stardust

To have Stardust propose the cohort designs (`stardust:direct` + `stardust:prototype`, one
prototype per experience): if the site itself was rebuilt with `stardust:replica`, run the
redesign in its own Stardust workspace (e.g. `cohorts/design/`, seeded with a copy of
`stardust/current/`). Replica's flow guard refuses a redesign in the same project. Give
`direct` the Optel evidence (`today.topClicks`, `didNothing`, dead taps per cohort), and ask for
a section → block comment at the top of each prototype: that comment becomes the `Slot` /
`Cohorts` / `Hide For` / `Promote` table of `/new`. Reuse copy, offers and prices verbatim
from the capture; new copy is functional labels only.

## SEO and indexing

The cohort page is not a second homepage: give it `Robots: noindex` and
`Canonical: /` in its page metadata. Crawlers get the original sections anyway (bots never
match a rule), and on the promoted homepage the URL stays `/`.

**For agents**: Edge Delivery serves every page as markdown at `{path}.md` (`/new.md`,
`/index.md`). The cohort page's markdown holds every variation, each with its `Cohorts` section
metadata, since no rule runs for an agent; that is the full content and offer set, worth
saying in a pitch. Keep copy in the sections (not in images or scripts) so it is there.
