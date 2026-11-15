---
name: brand-visibility
description: Plan how a firm should show up in search, in AI answers and on its own sites as one thing, from three reads merged by client theme. Read 1, who arrives (AEM Operational Telemetry visits of every site, by the theme of the landing page). Read 2, what people ask (monthly prompt and search demand per theme and who is named in the answer, from Adobe Brand Visibility prompt research or Semrush). Read 3, what the firm wants (its stated strategy, from public sources). Gives every theme a job (claim, defend or win), an experience that does the job, and one line to track it by, and draws the three reads as one picture. Use when asked for a brand visibility, GEO, AEO or SEO strategy for a firm with one or several sites, how visit data, AI answers and company strategy fit together, where to focus content, or to repeat the three-reads analysis for another customer.
---

# Brand visibility: three reads, one plan

Search, AI answers and the website are usually planned apart, each from its own report. This
skill reads the same firm three ways and merges the reads by what a client is trying to
solve. It is a way to think about the problem, not a product tour: the result is a short list
of themes, each with a job, and a picture a leadership team can read in a minute.

| Read | Question | Source | Kind |
| --- | --- | --- | --- |
| 1. Who arrives | What do visitors come for, on every site? | Optel bundles | measured |
| 2. What people ask | What is asked of search and AI assistants, and who is named? | Adobe Brand Visibility prompt research, Semrush | third-party estimate |
| 3. What the firm wants | Where does it say growth should come from? | annual report, earnings calls, press | read and quoted |

The reads disagree, and that is the finding. The largest audience is rarely where the demand
is, and the stated growth areas are rarely where the firm is named.

## The unit: a client theme

A theme is a problem in the client's words ("cyber", "health and benefits"), not a business
unit, a product or a site section. One list has to hold for landing pages, for questions and
for the firm's statements. Eight to twelve themes. Start from the firm's own navigation and
its stated growth areas, then check against the pages people actually land on.

## Run it

Read 1 builds on the `site-merge` skill: same `merge-rules.js`, same pulled bundles, same
definition of a visit. One site is fine; it is a merge of one. Keys come from the environment
(`OPTEL_DOMAIN_KEY_<ID>`), treat them like passwords, and keep raw bundles, the reads file and
every output outside any repository that is served or public.

```bash
node ../site-merge/scripts/pull.js --rules merge-rules.js --start 2026-09-14 --end 2026-11-13 --data data/
node scripts/visits-by-theme.js --rules merge-rules.js --themes theme-rules.js --data data/ --out out/
#   → out/visits-by-theme.json   read 1, per theme: visits, sites, search, AI, top pages
#   write reads.json             reads 2 and 3 and the plan, by hand (references/reads.md)
node scripts/three-reads.js --visits out/visits-by-theme.json --reads reads.json --out out/
#   → out/three-reads.html       the picture
```

Copy `theme-rules.js` and `reads.example.json` next to the project and edit them.

## Read 1: who arrives

`visits-by-theme.js` takes the visits whose need is about a subject (`topical` in the theme
rules: services, research, campaigns, other content) and reads the theme from the words of
the landing page path. Check before you quote:

- Read `top` of every theme. Word rules misread: an article about "the cost of capital" is not
  about capital markets. Fix the words, mind the order (first match wins), rerun.
- `unmatched` should be under a third of topical visits. Its top pages show the missing theme
  or the missing word. Homepages and section fronts have no theme and stay there.
- `excluded` is what you left out on purpose. Say so wherever the totals are shown.
- Visits are sampled; a theme with a few hundred sampled views is a direction, not a number.

What to take from it: the size of each theme, how many sites bring a real part of it
(`sharedBy`, a tenth or more), and how much already comes from search and from AI.

## Read 2: what people ask

Per theme: monthly prompt (and search) volume, and whether the firm, a competitor or nobody
is named in the answers. `references/reads.md` has the calls for Adobe Brand Visibility and
Semrush and the rules that keep the totals honest. Into `reads.json` per theme:

- `prompts`: the monthly volume;
- `state`: `lead` (the firm is named most), `comp` (a competitor leads all or part), `open`
  (nobody compared is named, or the counts are too thin to call);
- `asked`: one line with the numbers behind the state.

## Read 3: what the firm wants

Only what the firm has said in public, with the source and date kept: growth areas named by
management, a rebrand, a reorganisation. `wanted` stays empty for a theme the firm has not
named; do not infer strategy from the size of a business. An account team's knowledge of the
customer goes in a separate note, not into this read.

## One plan: a job for each theme

| State in AI answers | Job | What it takes |
| --- | --- | --- |
| open | **Claim** | Be the first complete answer: a page per question, named experts, facts a model can quote |
| lead | **Defend** | Make thin leads deep; keep the name that is cited when names or sites change |
| comp | **Win** | Find the topics inside the theme where others are named, and publish what the firm already knows, with the source in the sentence |

A theme can carry two jobs (lead overall, absent from its largest topic). Order the work by
the three reads together: a named growth area, with visitors on more than one site, that is
open in AI answers comes first. Then say for each job what the visitor meets (`experience`):
the page, row or finding that does it. Jobs and experiences are proposals; label them so.

## Track it with one line

Topics owned → mentions → citations → visits → leads. One line per theme, the same five
steps, so a gain in answers can be followed to the site and to the form. Mentions and
citations come from the prompt research tool, visits from Optel (AI-referred visits per
theme are already in read 1), leads from the form or CRM. Report the steps you can measure
and name the ones you cannot.

## Say what it is

- Read 1 is measured, read 2 is an estimate of a market (often one country, while visits are
  global), read 3 is a reading of public statements. Put scope and date beside every number.
- Volumes of read 2 are directional: one or two broad topics carry most of a theme's total.
- Competitor counts cover only the competitors you compared. Say which.
- The picture draws visits to volume, prompts on a scale of their own, and the firm's
  statements as links. The footnote says so; keep it.

## Present it

`three-reads.html?show=arrive|ask|want|plan` reveals one read at a time, with marks
(`#g-arrive`, `#g-ask`, `#g-want`, `#t-<theme id>`) for callouts. The `brand-visibility-video`
skill turns it into a narrated explainer. For an existing customer, teach the model and let
the data make the case: no product pitch.
