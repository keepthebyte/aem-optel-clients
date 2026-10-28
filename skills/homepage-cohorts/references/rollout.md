# Rollout: POC, promote, roll back

Each step is reversible on its own, and none of them edits the homepage's content.

## Stage 1: POC (no effect on the homepage)

Pick one, with the user:

| | Branch POC | Live POC |
| --- | --- | --- |
| Code | on a branch (`cohorts-poc`) | merged to `main` (inert without opt-in metadata) |
| Cohort page | `/new` previewed, not published | `/new` published with `Robots: noindex` |
| URL to share | `https://cohorts-poc--{repo}--{org}.aem.page/new?demo` | `https://www.example.com/new?demo` |
| Who sees it | people with the link | people with the link (not linked anywhere) |
| Good for | first review, design iterations | leadership demos on the real domain, real performance numbers |

The page carries `Cohorts: on` in its metadata: every visitor of `/new` gets their cohort
experience (no holdout), and the `?demo` panel lets anyone switch visitors. The panel's
`Original` link opens the homepage forced to the control arm.

Show leadership: the Sankey (how traffic splits), then three or four scenarios in the
panel (largest and highest-value cohorts first), each next to `Original`.

## Stage 2: promote (the homepage runs the experiment)

Preconditions:
- `verify.js` passes (cohort page with no rule = the homepage).
- Code is on `main`, `/new` is published.
- LCP of `/new` is no worse than `/` (the challenger also fetches `/new`, about one extra round trip; check the Optel `cwv` report on `/new` from the live POC, or PageSpeed).
- Consent decision recorded (see SKILL.md): `Experiment Requires Consent` and `memory.requireConsent`.

Add to the **homepage's** page metadata, then publish the homepage:

| Metadata | |
| --- | --- |
| Experiment | homepage-cohorts |
| Experiment Variants | /new |
| Experiment Split | 90 |
| Experiment Status | Active |

90% get the cohort page (challenger-1), 10% keep the original homepage (control).
The value of `Experiment` must match `experiment` in `cohort-rules.js` (as a class name).

Next day, check it took:

```bash
node optel-client.js --domain www.example.com --path / --last 24h --granularity hour --report checkpoint:experiment
node optel-client.js --domain www.example.com --path / --last 24h --granularity hour --report checkpoint:audience
```

Expect `homepage-cohorts` with ~10% `control`, and `audience` sources that look like the
sizing in `cohorts.json`.

## Roll back (fastest first)

| How | Who | Time | Effect |
| --- | --- | --- | --- |
| Homepage metadata `Experiment Status: off`, publish | author | seconds | everyone gets the original homepage; checkpoints keep coming (all control) |
| Remove the four `Experiment` rows, publish | author | seconds | same, and no experiment code is loaded on the homepage |
| Revert the code PR | developer | one deploy | only needed to remove the engine itself; do this after one of the above |

Never revert the code while the homepage still has the experiment metadata and `/new` is
published: the plugin would still swap in `/new`, and without the engine every cohort
section would show at once.

## Stage 3 (optional): inline the cohort page

The challenger fetches `/new` after the homepage loads. Once a cohort set has proven
itself over a few months, move the cohort sections into the homepage document and switch
to a code-level experiment (`Experiment Variants: 1`, same split): no extra fetch, the
original sections are still the default, and control renders the default only. Roll back
the same way (`Experiment Status: off`).
