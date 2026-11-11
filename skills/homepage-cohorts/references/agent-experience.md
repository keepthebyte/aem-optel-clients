# The page a personal agent gets

How to design and build the experience for a rule with `when.agent` (`rules.md`, "Personal AI
agents"). A personal agent is an assistant driving a real browser for one person. It looks at a
screenshot and the accessibility tree, then clicks and types. It has an errand ("get me a
price", "book a table", "find the opening hours"), not time to explore.

The experience is the same offer, the same facts and the same prices as every other version
of the homepage. What changes is the composition: **the task comes first, as a form, and
nothing has to be opened, hovered or waited for.**

## What agents do differently

Findings from Optel, agents against people on the same sites. Check them on the site you work
on with `--report agents` (`aem-optel` skill); the agent sample is small, so read directions,
not decimals.

| Agents, compared with people | What the page does about it |
| --- | --- |
| A much larger share of their clicks is on form controls | The task is a native form in the first screen |
| They hardly click the header or the menu | Nothing depends on the navigation; every action is in the content |
| They submit forms about twice as often | A named submit button, even if the result also updates live |
| They reload far more often | State lives in the URL; a reload keeps the answers and the result |
| They rarely use back or forward | One page, no wizard steps |
| They almost never log in or sign up, and never call | The result needs no account; the conversion is a link handed to the person |
| They reject or dismiss consent banners far more often | No optional cookies in this experience, so no banner (needs privacy sign-off) |
| Their interactions get a slower response | No animation, no late-loading parts, light script |
| They see more layout shift | Result and error areas are reserved; nothing moves |
| Some browse as a phone | One column at 375 px, no hamburger |
| They do not ask for `llms.txt`, `agents.json` or similar | The page itself says what it can do |
| They use site search more, and guess `/search` | Answer at `/search` (a site task, not a homepage section) |

## Build rules

1. **Say what the page does, in the first screen, in text.** One H1 and one sentence: the task
   and what it does not need (no account, no call).
2. **The task is a native form in the first screen.** Radios in fieldsets with legends, text
   inputs with a visible label and a visible format hint, a real submit button. State shows in
   the screenshot (the option looks selected) and in the tree (`checked`). No custom widgets,
   no placeholder-only fields.
3. **Visible label = accessible name = action.** No icon-only controls. No two actions with
   the same name and different targets: "Get a price for renters insurance", not three links
   called "Get a price". An empty state says so ("No price yet"), not "$0".
4. **Everything is open.** No carousels, tabs, closed accordions, hover content or "read
   more". Questions and answers are headings and text.
5. **Facts are tables.** Prices, cover and comparisons as tables with a caption and header
   cells, so one row reads as one statement in the tree.
6. **Nothing moves, nothing covers.** No animation, no sticky bars, no overlays, no modal, no
   consent banner. Reserve the height of the result, the error line and the header. A notice
   that must be shown (legal, demo) goes in the page flow.
7. **State in the URL.** Answers are query parameters, links that pre-answer do it in place,
   and a reload shows the same result.
8. **A line between what the agent may do and what the person must do.** Getting a result and
   checking the facts are open. Paying, confirming identity and signing in are named as the
   person's. Give a link to pass on that reopens the page with the same answers (without the
   agent parameter, so the person gets the version for people).
9. **One column at phone width**, links wrap, no hamburger. Targets at least 24 px, buttons and
   options 44 px.
10. **The brand stays, the decoration goes.** Wordmark, type and colour as on the site. No
    photography above the form: the first screen is needed for the task.

## What must not change

The agent signal is self-declared, like a user agent, and unverified. Use it to pick a layout.
Never use it for different prices, facts, offers or access, and never serve an agent content a
person could not also get. If the default homepage carries a legal line, so does this one.

## In Edge Delivery

- Sections for the agent get `Cohorts: agent` in Section Metadata; sections it should not see
  get `Hide For: agent` (`content-model.md`). Facts shared with people stay one section where
  the block can render both ways, so copy is authored once.
- Blocks check `document.body.dataset.experience === 'agent'` for the open, static variant
  (an accordion rendered as headings, a ledger with list roles).
- Put the agent header height and any reserved heights in the global stylesheet, not in a
  lazily loaded block stylesheet, or the first screen shifts.
- The form block reads its answers from `location.search` and writes them with
  `history.replaceState`, keeping `agent` and campaign parameters.
- Markdown (`/new.md`) carries every variation; keep the facts in sections, not in scripts.

## Check it

```bash
node scripts/agent-check.js --url https://main--site--org.aem.page/new --out agent-check
```

Loads the page as an agent (`?agent=chatgpt-agent`) on a desktop and a phone and reports:
experience served, a form control and the H1 in the first screen, layout shift on load and
after answering, overlays and sticky parts, closed disclosures, small targets, controls without
a name, action names with more than one target, tables without a caption, horizontal overflow,
script errors, and whether a reload keeps the answers. Exit code 1 on a finding. It also writes
`first-screen.png` and `accessibility-tree.yml`.

Then the **cold read**: give a fresh agent only those two files and an errand a customer would
have ("renter, one cat, wants a monthly price"). Ask it what the page is for, which controls it
would use by role and name, and what it would not do. Fix what it misnames or cannot find.
Last, run the errand end to end with a real agent product on the preview URL.

## Questions for the site owner

- No optional cookies for agents: acceptable to privacy and analytics owners?
- May an agent fill in checkout with details the person gave it, or does the page hand over a
  link?
- Structured data (offers, prices) on the page: only once the prices are real.
- Measurement: the agent rule will read "not enough data yet" for a long time (`rules.md`).
  Agree on what counts as its goal: the form submitted, or the hand-off link copied.
