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
| `Hide For` | `customer, mobile` | Section removed for these experiences (use `default` to hide it from unmatched visitors and keep the default identical to the homepage). |
| `Promote` | `customer` | Section moved right under the first section for these experiences. |

Keys a visitor matches, most specific first: `<experience>:<intent>`, `<experience>`, `default`.
`<experience>` comes from the rule (`experience: 'prospect'`), `<intent>` from the campaign
tags or the top on-device interest (`intents` in the rules).

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

## Header, nav and other shared chrome

Sections only cover `<main>`. The header and footer are fragments shared with the original
page, so a cohort cannot change them through Section Metadata. The engine marks the body
instead: `body[data-experience="mobile"]`, `body[data-cohort="<rule id>"]` (both `default` /
`none` in the holdout). Style or decorate the shared header against those, scoped so the
original never changes, e.g. a visible "Log in" button for `mobile` where the original shows an
account icon. Check the holdout with `verify.js` afterwards: the header is not in its section
comparison.

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
