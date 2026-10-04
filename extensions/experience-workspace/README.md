# Experience Workspace extensions

Tool panels for the Experience Workspace canvas that read the open page's
Optel telemetry. They work for any site whose domain key you have.

| Panel | Folder | What it does |
| --- | --- | --- |
| **Page Insights** | [`page-insights/`](page-insights/) | A week of the page's telemetry told as a story: views and devices, the engagement funnel, taps and dead taps, where visitors came from and how much they wanted the page, redirect cost, language, scroll reach, the consent dialog. |
| **Improve Impact** | [`improve-impact/`](improve-impact/) | What to do about it. **Fix in Experience Workspace**: ranked changes an author can make with what the page already has (text, images, links, anchors, block order), each tagged with the visitor cohort it affects most, with "Ask chat to resolve". **Redesign with Stardust**: changes to a block's design that the editor cannot make yet, each with a brief to paste into Claude Code for the [Stardust skill](https://github.com/adobe/skills/tree/main/plugins/stardust). Plus talking points for other teams and context. |

`shared/analyze.js` is the analysis both panels use (labels, intent ladder,
findings) over [`optel-client.js`](../../optel-client.js) at the repo root;
`shared/site.js` resolves the per-site settings below.

## Add them to a site

The panels are served from GitHub Pages:

```
https://keepthebyte.github.io/aem-optel-clients/extensions/experience-workspace/page-insights/index.html
https://keepthebyte.github.io/aem-optel-clients/extensions/experience-workspace/improve-impact/index.html
```

Add one `library` row per panel to the site's DA config (`title`, `path` with
the absolute URL above plus settings). Experience Workspace names the panel
after its title, lowercased with hyphens: a row titled "Page Insights" is the
`page-insights` panel, which is what Improve Impact's "Open Page Insights"
link switches to.

| Setting | Meaning |
| --- | --- |
| `domain` | The hostname visitors see, the one the domain key is for (`www.example.com`). Experience Workspace tells a panel the project and the page path, not the production host. |
| `domainkey` | The Optel domain key for that host. See the [repo README](../../README.md#getting-a-domain-key). |
| `paid-medium` | Optional. `utm_medium` values that mean paid on this site, on top of the client's rule, e.g. `video\|social\|ctv\|ott`. |
| `ai` | Optional, off by default. `on` shows the AI-surface section (Adobe Brand Visibility); needs `site-id` and the workspace token. Work in progress. |
| `insights-panel` | Optional, Improve Impact only. The Page Insights panel name when its row has another title. |
| `autosend` | Optional, Improve Impact only. `0` leaves the chat prompt for review instead of sending it. |

Whatever the URL leaves out the panel asks for once: the domain is remembered
per project, the key per host, both in this browser. A key in the row URL is
visible to everyone who can read the site's config; leave it out to have
each author enter it.

## Try them standalone

Serve the repo (`npx http-server .` or any static server) and open:

- `page-insights/index.html?domain=emigrationbrewing.com&domainkey=open&path=/`, the public demo site
- `improve-impact/index.html?fixture=demo-product-page`, synthetic demo data that triggers every rule
- either panel without parameters asks for the site; Improve Impact also offers the demo data

Paths are the page paths on the live site. A site whose content paths differ
from its public URLs is not handled yet.

## Improve Impact: rules and research output

Rules are in `improve-impact/rules.js` (`deriveFindings`): dead taps, reach
cliff, no-touch bounce and translation for the Experience Workspace queue;
first screen and tap affordance for redesigns; redirects and consent as talking
points. Thresholds are blunt and meant to be tuned. The queue is ranked
cheapest effort first, then share of views affected. The next step a card
suggests is named after the link visitors follow most on the page.

`stardustBrief` builds the redesign prompt: it starts `/stardust:stardust`
with the page URL and area, then the evidence, the cohorts it has to work
for, design goals, what must not change (the content; Edge Delivery blocks
shipped through `stardust:deploy`), the numbers to watch, and the content
fixes already queued.

The panel logs what gets opened, copied and clicked in `sessionStorage`
(download from the methodology footer). A/B flags: `?order=actions-first|working-first`,
`?framing=stakes|plain`, `?variant=random`.
