# Storyboard reference

A storyboard is one JSON file. Times are cues: `"at": "stat1"` is the moment the narrator
reaches `{stat1}`, `"stat1+1.5"` is 1.5 s later, a number is seconds from the scene start.

```json
{
  "title": "Homepage cohorts",
  "host": "www.example.com",
  "sankey": "sankey.svg",
  "review": "review.json",
  "brand": { "dark": "#1d2a3a", "dark2": "#2c3e55", "accent": "#f2a33a" },
  "fonts": "https://fonts.googleapis.com/css2?family=...",
  "voice": { "provider": "elevenlabs", "voiceId": "...", "model": "eleven_multilingual_v2", "settings": { "stability": 0.5, "similarity_boost": 0.75, "style": 0.2 } },
  "scenes": [ ... ]
}
```

`brand` sets CSS variables of the stage: `dark`, `dark2`, `accent`, `ink`, `soft`, `font`,
`serif`, and `accentInk` (the accent on white cards and chips; set it when the accent is too
light to read on white, e.g. a yellow).

`sankey` and `review` are paths relative to the storyboard. `host` is shown in the browser
address bar.

## Every scene

| Field | |
| --- | --- |
| `id` | unique, used for the audio and clip file names |
| `type` | one of the types below |
| `narration` | text with `{cue}` markers; scene length = narration + 1.3 s |
| `duration` | seconds, for scenes without narration (default 4) |
| `hold` | extra seconds after the narration (let the last element sit) |

Scenes crossfade into each other (0.5 s).

## Types

**`title`**: `kicker`, `title` (HTML: `<em>` is the accent colour, `<br>`), `sub`.

**`stats`**: big numbers on the background. `title`, `stats: [{ at, until, n, t, muted }]`
(`n` the number as shown, `t` the label, `muted` greys a card).

**`browser`**: full-page captures in a browser frame.

| Field | |
| --- | --- |
| `pages` | `[{ at, page, url, label, sig, sigAt }]`: capture id from `captures/index.json`, the path shown in the address bar, the chip top left (HTML), the chip top right and when it appears. Later pages crossfade in at their `at`. |
| `scroll` | `[{ at, to, dur }]`: `to` ≤ 1 is a share of the page height (0.25 = a quarter down), more is CSS pixels, a string is a mark (`"menu"` or `"home.menu"`), scrolled to just under the header |
| `rings` | `[{ at, until, mark, pulse }]`: a ring around `"<capture>.<mark>"`. Hidden while the mark is out of view. |
| `stats` | stat cards over a dimmed page, as in `stats` |

**`sankey-reveal`**: the Sankey, one column at a time. `intro` (a line shown before the
first column), `columns` (four cue names, default `col1`…`col4`): column *n* and its flows
appear at its cue.

**`sankey-paths`**: the full Sankey with one cohort lit at a time. `highlights: [{ at, rules, caption }]`:
`rules` is a list of rule ids (flows carrying any of them stay lit), `caption` (HTML) the
label at the bottom left. Captions state the share from `cohorts.json`, and "modelled" for
modelled rules.

**`phones`**: two phones. `left` / `right`: `{ page, label, at }` (the right phone slides in
at `right.at`; an optional `scroll: { at, to, dur }` scrolls that phone to a mark of its
capture or a CSS pixel offset, e.g. to show what sits under the hero), `notes: [{ at, until, n, t, s }]` (a number with a label to the right),
`scrollToEnd` (a cue: both scroll to their end at the same pace, to compare page length).

**`results`**: each rule against its holdout, from `review.json`. `title`, `sub`, `rules`
(rule ids in order; default all), `rowCues` (a cue per row; default every 0.9 s),
`goalLabels` (`{ ruleId: "booked a table" }`, instead of the goal's regex). Verdicts come
from `review.json`: `not enough data yet` and `no clear difference yet` are shown as such.

**`facts`**: a capture zoomed onto a mark, with a numbered list. `image` (capture id),
`zoomTo` (`"capture.mark"`), `zoomAt` (cue), `facts: [{ at, text }]`.

**`holdout`**: the split. `title`, `split` (default 90), `caption`.

## Writing it

- One idea per scene, short sentences. 130–150 spoken words a minute.
- Put the cue where the picture should change, in front of the word that names it:
  `"{stat1}Fourteen percent of views click nothing."`
- Numbers on screen are digits from the files; in the narration they are words.
- A drawn number with no source is a bug. Before the final render, list every number on
  screen and in the narration with the field it came from.
