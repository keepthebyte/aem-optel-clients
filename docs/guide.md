# From traffic data to a cohort homepage, a visibility plan and a video

A step-by-step guide to the whole sequence these skills were built for. You start with a
customer's website and its Operational Telemetry (Optel) domain key. You end with:

- a **traffic picture**: who visits, from where, and what they do (a Sankey);
- a **brand visibility plan**: who arrives, what people ask search and AI assistants, and what
  the firm wants, merged into one picture with a job per theme;
- a **cohort homepage**: one page that shows each group of visitors the version that fits why
  they came, with the reason for every section, ready to test against the original;
- a **narrated video** that explains all of it with the customer's own numbers.

You do not have to do all four. Each step says what it needs and what it produces, and the
steps after it only need those files.

You work with a coding agent (Claude Code is assumed below). The skills tell the agent how to
do each step; this guide tells you which step comes when, what to ask for, and what to check
before you move on.

## The sequence at a glance

| Step | Skill | You need | You get |
| --- | --- | --- | --- |
| [0. Set up](#0-set-up-once) | | Node, ffmpeg, the repo | skills installed |
| [1. A workspace per customer](#1-a-workspace-per-customer) | | a domain key per site | a private folder, keys in the environment |
| [2. First look](#2-first-look-at-the-traffic) | `aem-optel` | the key | what the site records, the homepage brief |
| [3. Several sites as one](#3-several-sites-as-one-optional) (optional) | `site-merge` | a key per site | the merge Sankey, the audiences |
| [4. The visibility plan](#4-the-visibility-plan-three-reads) | `brand-visibility` | step 2 or 3, prompt research, public statements | `reads.json`, the three-reads picture |
| [5. The cohort homepage](#5-the-cohort-homepage) | `homepage-cohorts`, `stardust` | an Edge Delivery site, the homepage bundles | rules, `cohorts.json`, the Sankey, the `/new` page |
| [6. The video](#6-the-video) | `brand-visibility-video`, `homepage-cohorts-video` | the files of steps 4 and 5 | an MP4 and its storyboard |
| [6b. The data report](#6b-the-data-report-optional) (optional) | `data-report` | the files of steps 4 and 5, Chrome | a findings-only PDF for the customer |
| [7. Go live and review](#7-go-live-and-review) | `homepage-cohorts` | the customer's go-ahead | a 90/10 experiment, a monthly review |

A first run for one customer takes two to four working days: about a day for steps 1 to 4,
one to two for the page, half a day for a video.

## 0. Set up (once)

### Tools

- **Node 18 or newer** and **git**.
- **ffmpeg** (with ffprobe) for the videos: `brew install ffmpeg`.
- **Playwright** for page captures and the agent check. Install it once in a scratch folder
  and point `NODE_PATH` at it, or install it in each video folder:

  ```bash
  npm i -D playwright && npx playwright install chromium
  ```

- **Claude Code**, and the GitHub CLI (`gh`) if you will open pull requests on a site repo.

### The skills

Clone the repository and link every skill into your agent's skills folder. Linking instead of
copying means `git pull` updates them, and the skills find each other and the client
(`optel-client.js`) by their place in the repository.

```bash
git clone https://github.com/keepthebyte/aem-optel-clients ~/Code/aem-optel-clients
mkdir -p ~/.claude/skills
for s in ~/Code/aem-optel-clients/skills/*/; do ln -sfn "$s" ~/.claude/skills/"$(basename "$s")"; done
```

Check it: `node ~/Code/aem-optel-clients/optel-client.js --help`, and try the public demo
site, whose key is `open`:

```bash
OPTEL_DOMAIN_KEY=open node ~/Code/aem-optel-clients/optel-client.js --domain emigrationbrewing.com --last 30d --report summary
```

For the page (step 5) also add Adobe's Edge Delivery skills in Claude Code:
`/plugin marketplace add adobe/skills`, then install `aem-edge-delivery-services` (building the
page) and [`stardust`](https://github.com/adobe/skills/tree/main/plugins/stardust) (designing the
versions in the site's existing design).

### Access you will need

| For | What | Where it comes from |
| --- | --- | --- |
| Steps 2, 3, 5 | An Optel **domain key** per hostname | README, [Getting a domain key](../README.md#getting-a-domain-key). Keys are per hostname: `www.example.com` and `example.com` differ. |
| Step 4, read 2 | **Adobe Brand Visibility** (a login to the customer's organisation and its MCP connector) or **Semrush** | Your Adobe or Semrush account. Either one is enough. |
| Step 4, optional | **Agentic traffic** in Adobe Brand Visibility | Only when the customer has it set up. It adds a fourth read. |
| Step 5 | An **Edge Delivery Services site** you can push to | The customer's repo, or a demo copy of the homepage in a repo of your own. |
| Step 6, final voice | An **ElevenLabs** API key | Optional. Drafts use the macOS `say` voice for free. |

## 1. A workspace per customer

Make one private folder per customer, outside any site repository and outside this one.
Everything you pull and produce lives there: bundles, rules, reads, pictures, videos.

```
~/Code/acme-insights/
  data/              raw bundles (large, never committed)
  out/               JSON and HTML results
  merge-rules.js     the sites and what visits come for
  theme-rules.js     the client themes
  reads.json         reads 2 and 3 and the plan
  video/             storyboard, captures, audio, MP4
```

Rules that hold for every step:

- **A domain key is a password.** Give it to the shell, never to a file, a URL, a commit or
  the chat. In Claude Code, type `! export OPTEL_DOMAIN_KEY=...` so the key stays out of the
  transcript. For several sites: `OPTEL_DOMAIN_KEY_<ID>` per site, where `<ID>` is the site's
  id in `merge-rules.js`.
- **Raw bundles and results stay in the private folder.** Every file committed to an Edge
  Delivery repo is served to the public.
- **Brand Visibility account data is the customer's.** Read it only with their knowledge and
  change nothing. Topic research is market data and needs no such care.
- **This repository is public.** If you improve a skill, keep customer names and numbers out
  of commits, pull requests and examples.

## 2. First look at the traffic

Skill: [`aem-optel`](../skills/aem-optel/SKILL.md).

Ask the agent, with the key in the environment:

> Use the aem-optel skill. Domain www.example.com. Run the checkpoints report, then a summary
> of the last 7 days and the page report for the homepage. Tell me what stands out.

What to look at:

- `--report checkpoints` first: sites record different things. Build only on what is there.
- `--report summary`: views, visits, channels, devices, top pages.
- `--path / --report page`: the homepage brief. The share that clicks nothing, the top clicks
  (with cookie-banner clicks separated), where people go next.
- `--report ai`: visits from AI assistants next to search.

Then pull the data the later steps reuse, once, as hourly files (daily and monthly files hold
far fewer samples):

```bash
OPTEL=~/Code/aem-optel-clients/optel-client.js
node $OPTEL --domain www.example.com --path / --last 30d --granularity hour --report raw --out data/home.jsonl
node $OPTEL --domain www.example.com --last 30d --granularity hour --report raw --out data/site.jsonl
```

Before moving on: the CLI reports `0 files failed` (reload until it does), you know the
homepage's real path (`/` often redirects, and Optel records the final path), and you have
written down the sample sizes. Small sites need 8 to 12 weeks.

## 3. Several sites as one (optional)

Skill: [`site-merge`](../skills/site-merge/SKILL.md). Use it when the firm has several sites
or brands, whether or not they are being consolidated: it puts them in one picture.

```bash
S=~/Code/aem-optel-clients/skills/site-merge
cp $S/merge-rules.js .            # edit: the sites, the need patterns, the audiences
node $S/scripts/pull.js         --rules merge-rules.js --start 2026-09-14 --end 2026-11-13 --data data/
node $S/scripts/site-cohorts.js --rules merge-rules.js --data data/ --out out/
node $S/scripts/merge.js        --rules merge-rules.js --out out/
node $S/scripts/sankey.js       --rules merge-rules.js --out out/      # out/sankey.html
```

Before moving on: read `topPages` of every cohort in `out/sites.json` and fix the patterns
that misread a page; `other` is a few percent, not a third. The Sankey shows which audiences
several sites share. That share is the first number to quote.

## 4. The visibility plan: three reads

Skill: [`brand-visibility`](../skills/brand-visibility/SKILL.md), with
[`references/reads.md`](../skills/brand-visibility/references/reads.md) for the sources.

The idea: read the same firm three ways and merge the reads by **client theme**, a problem in
the client's words ("cyber", "health and benefits"), eight to twelve of them.

| Read | Question | Source |
| --- | --- | --- |
| 1. Who arrives | What do visitors come for? | Optel, measured |
| 2. What people ask | What is asked of search and AI assistants, and who is named? | Adobe Brand Visibility or Semrush, an estimate |
| 3. What the firm wants | Where does it say growth should come from? | Annual report, earnings calls, press |
| 4. What assistants fetch (optional) | Which pages do AI assistants load to answer someone? | Brand Visibility agentic traffic |

```bash
B=~/Code/aem-optel-clients/skills/brand-visibility
cp $B/theme-rules.js $B/reads.example.json .     # edit the themes; one site is a merge of one
node $S/scripts/pull.js --rules merge-rules.js --start 2026-09-14 --end 2026-11-13 --data data/   # if not pulled in step 3
node $B/scripts/visits-by-theme.js --rules merge-rules.js --themes theme-rules.js --data data/ --out out/
#   read 1 is now in out/visits-by-theme.json
#   reads 2 and 3 and the plan go into reads.json (the agent writes it, you check it)
node $B/scripts/three-reads.js --visits out/visits-by-theme.json --reads reads.json --out out/
#   out/three-reads.html?show=arrive|ask|want|plan
```

Ask the agent for one read at a time:

> Use the brand-visibility skill. Sites and keys are set up in merge-rules.js. Propose ten
> client themes from the navigation and the landing pages, run read 1 and show me the top
> pages per theme and what is unmatched.

> Read 2: for each theme, pull the prompt demand from Brand Visibility topic research and who
> is named. Read-only. Keep the queries and the topic lists beside reads.json.

> Read 3: find what the firm has said in public about where growth should come from, with
> source and date. Leave a theme empty if they have not named it.

Then each theme gets a **job**: *claim* it (nobody is named in the answers), *defend* it (the
firm leads) or *win* it (a competitor leads), plus the experience that does the job and one
line to track it by: topics owned → mentions → citations → visits → leads.

Before moving on:

- Read the top pages of every theme; word rules misread. Unmatched is under a third.
- Every number has its scope and date beside it. Read 2 is often one country while visits
  are global; say so.
- Read 3 holds only what the firm said in public. What you know from the account goes in a
  separate note.
- For the fourth read, count only agents whose name ends in `-User`, and use the counts to
  rank pages inside one period, not as a trend.
- Jobs and experiences are your proposals. Label them as proposals.

## 5. The cohort homepage

Skill: [`homepage-cohorts`](../skills/homepage-cohorts/SKILL.md). This is the step that
writes code, into an Edge Delivery Services site repository.

**Which repository?** For a customer's own Edge Delivery site, work on a branch of their repo.
For a pitch or a prospect, build a demo copy of the homepage in a repository of your own
(`stardust:replica`, or the `create-site` and `page-import` skills of
`aem-edge-delivery-services`, do this). A demo
copy of someone's brand needs three things: a private repository, a page that is never
indexed (`Robots: noindex`, preview only), and a visible notice that it is not the brand's
website.

### 5a. Size the rules

A rule describes a group of visitors by something the browser knows on arrival: the referrer,
campaign tags, an ad click, an AI assistant, the device, an earlier visit. The first rule that
matches decides the experience.

```bash
H=~/Code/aem-optel-clients/skills/homepage-cohorts
cp $H/engine/cohort-rules.js ../site/scripts/cohort-rules.js      # edit it: references/rules.md
node $H/scripts/size.js   --rules ../site/scripts/cohort-rules.js --bundles data/home.jsonl --site data/site.jsonl --out out/cohorts.json
node $H/scripts/sankey.js --in out/cohorts.json --out out/sankey
```

> Use the homepage-cohorts skill. The homepage bundles are in data/home.jsonl. Propose cohort
> rules from the traffic, size them, draw the Sankey and show me the table: share, what each
> group clicks today, and what each should see first.

Agree the experiences with whoever owns the page before anything is built: which cohorts,
what each gets first, what goes away for it. Feed in the plan of step 4: a theme with the
job "win" or "claim" is a candidate for a section, and visits from AI assistants are usually
a small cohort that behaves differently enough to get its own.

### 5b. Design the versions with Stardust

Each cohort's version should look like the site it belongs to. The Stardust skills read the
existing design from the live site and propose new sections in it, so a version is a
rearrangement and extension of the brand, not a new look.

1. `stardust:extract` captures the current site: design tokens, typography, components,
   voice, and the homepage's content.
2. `stardust:direct` sets the direction. Give it the evidence per cohort from `cohorts.json`
   (`today.topClicks`, `didNothing`, dead taps) and the experiences agreed in 5a.
3. `stardust:prototype` renders one prototype per experience. Ask for a comment at the top of
   each that maps every section to a block: that comment becomes the section table of `/new`.

> Use stardust to extract the design of www.example.com, then prototype one homepage version
> per experience in cohorts.json, in the existing design. Reuse copy, offers and prices
> exactly as they are on the site; new copy only for labels. Map each section to a block.

Review the prototypes with the page owner before building. Details, including what to do when
the site itself was rebuilt with Stardust:
[`references/content-model.md`](../skills/homepage-cohorts/references/content-model.md), "Designs from Stardust".
For a demo copy of a site you do not have the code of, `stardust:replica` rebuilds its pages
in Edge Delivery keeping the current design.

### 5b+. Picture stories (optional)

Once the versions stand, the pictures in them can follow each cohort too: the large pictures
down the page tell one story per cohort ("Will it fit my life?": an electric car in the city,
a wallbox at home, far from home with it), taken from the site's own pages where that group
lands. First done on bmw.de.

```bash
node $H/scripts/pictures.js --rules ../site/scripts/cohort-rules.js --bundles data/home.jsonl --site data/site.jsonl --match 'media_' --out out/pictures.json
```

> Use the homepage-cohorts skill, references/picture-stories.md. From out/pictures.json, say
> how many pictures each cohort reaches and where its pictures can come from, then propose one
> picture story per cohort as a storyboard. Check every picture on its source page.

`viewmedia` is exposure, not preference: the report says what each group has in front of it
and how far down it gets, not what it likes. Agree the storyboard with the page owner;
the pictures go into `/new` as one section per cohort in a `Slot` per picture.

### 5c. Build the page

The agent follows [`references/install.md`](../skills/homepage-cohorts/references/install.md)
and [`references/content-model.md`](../skills/homepage-cohorts/references/content-model.md):

1. Install the AEM Experimentation plugin and the cohort engine, and wire `scripts.js`.
2. Create `/new` as an unchanged copy of the homepage, then add the cohort sections from the
   prototypes of 5b. Section Metadata says which cohorts see a section.
3. Give every cohort section an `Insight`: the finding behind it, in one sentence with its
   number. This is what the explain mode shows.
4. Page metadata of `/new`: `Cohorts: on`, `Robots: noindex`, `Canonical: /`.
5. Run `verify.js`: `/new` with no rule matched must equal the homepage, or no comparison
   holds.

Content is authored in Experience Workspace like any other page; the Cohorts panel
(install.md, section 7) shows authors who sees which section while they edit.

### 5d. Check and demo it

- `https://{branch}--{repo}--{org}.aem.page/new?demo` opens the presenter dock: **Visitor**
  switches between cohorts and shows what Optel says about each, **Explain sections** shows
  the reason for every section.
- `?cohort=<rule id>` forces one rule, for screenshots and review.
- `?agent=chatgpt-agent` shows the page a personal AI agent gets; check it with
  `scripts/agent-check.js` ([`references/agent-experience.md`](../skills/homepage-cohorts/references/agent-experience.md)).

Before moving on: `verify.js` passes, every cohort in the Sankey has a version you have
looked at on desktop and phone, and every section can say why it is there.

## 6. The video

Skills: [`brand-visibility-video`](../skills/brand-visibility-video/SKILL.md) for the plan,
[`homepage-cohorts-video`](../skills/homepage-cohorts-video/SKILL.md) for the page. Both run on
the same scripts; [`references/storyboard.md`](../skills/homepage-cohorts-video/references/storyboard.md)
lists every scene type.

```bash
mkdir video && cd video
P=~/Code/aem-optel-clients/skills/homepage-cohorts-video/scripts
T=~/Code/aem-optel-clients/skills/brand-visibility-video/templates
cp $T/three-reads.storyboard.json storyboard.json && cp $T/captures.example.json captures.json && cp $T/deck-extras.css .
node $P/capture.js --config captures.json --out work/captures        # pages, with the boxes of marked elements
node $P/tts.js    --storyboard storyboard.json --out work/audio      # draft voice: macOS say
node $P/render.js --storyboard storyboard.json --work work --stills  # a PNG per cue: look at these first
node $P/render.js --storyboard storyboard.json --work work --out draft.mp4
node $P/tts.js    --storyboard storyboard.json --out work/audio --final 1          # ElevenLabs
node $P/render.js --storyboard storyboard.json --work work --hq 1 --out final.mp4
```

> Use the brand-visibility-video skill. The files are in ../out and ../reads.json, the cohort
> page is at {preview URL}. Draft the storyboard, list every number with the file it came
> from, and render a draft with the say voice.

How to work:

- **Draft first.** Stills, then a draft with the free voice, then one round of changes, then
  the final voice. A five-minute video is 850 to 1,050 spoken words.
- **Every number on screen traces to a file.** Ask for the list before the final render.
- **Look at every capture.** Cookie banners, demo dialogs and late pop-ups hide the page.
- **Say what is measured, estimated or proposed**, and say when a page is a demo.
- **The ElevenLabs key** goes in `ELEVENLABS_API_KEY` or `~/.config/elevenlabs/key`, never in
  the storyboard or a repository.
- **Know the audience.** For an existing customer: the way of thinking and what follows from
  their data, no product pitch. For a monthly update: start from last month's storyboard.

## 6b. The data report (optional)

Skill: [`data-report`](../skills/data-report/SKILL.md).

When the customer asks for the numbers they saw, send a PDF rather than the deck: the funnel and
RoBV, which stages were measured, then each read and the cohorts, with sources and periods.
Findings only; the plan and the proposed pages stay out.

```bash
R=~/Code/aem-optel-clients/skills/data-report
cp $R/report.example.json report.json          # name the inputs of steps 4 and 5, the customer, the logo
node $R/scripts/fetch-join.js --fetches fetches.txt --bundles data/www-site.jsonl --from 2026-10-12 --to 2026-11-09 --out fetch-join.json   # optional
node $R/scripts/build.js --config report.json  # copies the template on the first run, prints and checks the PDF
```

Check three headline numbers against the source files, and that nothing in it proposes anything.

## 7. Go live and review

Skill: `homepage-cohorts`, [`references/rollout.md`](../skills/homepage-cohorts/references/rollout.md).

1. **Promote.** Four metadata rows on the homepage start a page-level experiment: 90% of
   visitors get the cohort page, 10% keep the original. Authors turn it off with one row
   (`Experiment Status: off`).
2. **Check the next day** that the `experiment` and `audience` checkpoints arrive and the
   control is about 10%.
3. **Review every month.** `review.js` compares every rule with its own holdout: keep, fix or
   drop, or not enough data yet. Unmatched traffic shows the next rule to write.

   ```bash
   node $OPTEL --domain www.example.com --path / --start 2026-11-01 --end 2026-11-30 --granularity hour --report raw --out data/month.jsonl
   node $H/scripts/review.js --rules ../site/scripts/cohort-rules.js --bundles data/month.jsonl --out out/review.json --md out/review.md
   ```

4. **Track visibility on the same line as step 4**: topics owned → mentions → citations →
   visits → leads, per theme. Report the steps you can measure and name the ones you cannot.

A rule needs about 30 sampled views in each arm before it can be judged, and the holdout
gets a tenth of the views. Small cohorts need several months pooled. Rule ids are the
measurement keys: never rename one.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| `403 invalid domainkey` or `401 domainkey not set` | The key is for another hostname. Check `www.` against the bare domain once, then ask for the right key. |
| `N files failed` after a pull | Run it again until it is 0; failed files undercount everything. |
| A cohort capture shows the original page | The engine took the browser for a bot. Capture with `capture.js`, or force the rule with `?cohort=<rule id>`. |
| `verify.js` fails | `/new` without a rule differs from the homepage. Fix the content before sizing, filming or promoting. |
| `optel-client.js not found` | The skill was copied without the repository. Link it as in step 0, or set `OPTEL_CLIENT`. |
| `Playwright not found` | Install it in the folder you run from, or set `NODE_PATH`. |
| Brand Visibility returns `429` | Run the calls one after another with a pause; the skill's reference says how. |
| A theme has a few hundred sampled visits | Quote it as a direction, with the sample size, not as a share. |

## Where to read more

- The numbers and how not to misread them: [`skills/aem-optel/SKILL.md`](../skills/aem-optel/SKILL.md), section 4.
- Writing rules: [`skills/homepage-cohorts/references/rules.md`](../skills/homepage-cohorts/references/rules.md).
- From a merge of sites to rules on the new site: [`skills/site-merge/references/runtime.md`](../skills/site-merge/references/runtime.md).
- The Experience Workspace panels (Page Insights, Improve Impact): [`extensions/experience-workspace/`](../extensions/experience-workspace/README.md).
