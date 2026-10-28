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

Design each experience from the evidence in `cohorts.json` (`rules[].today.topClicks`,
`didNothing`): put what that cohort already looks for first, and remove what it ignores.

## SEO and indexing

The cohort page is not a second homepage: give it `Robots: noindex` and
`Canonical: /` in its page metadata. Crawlers get the original sections anyway (bots never
match a rule), and on the promoted homepage the URL stays `/`.
