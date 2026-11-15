# Reads 2 and 3: where the numbers come from

Both reads end up in `reads.json` (see `reads.example.json`), one entry per theme, with
`scope` (country, engines, month) and a `note` that names the sources. Keep the working files
(topic lists, exports, quotes) beside it, outside the repository.

## Read 2 from Adobe Brand Visibility prompt research

Needs a login to the organisation in Adobe Brand Visibility and its MCP connector. Topic
research is market data and does not depend on the organisation's own domain; everything
here is read-only. Tracked prompts, mentions and citations are the customer's own account
data: read them only with the customer's knowledge, and change nothing without being asked.

1. Look up the recipe first: `lookup-api-spec`, recipe `topic-demand-research`. Endpoints and
   fields change; trust the spec over this page.
2. Per theme, two to four queries in the client's words ("cyber insurance", "cyber risk").
   For each, the related topics:

   ```js
   aem.post('/adobe/brand-visibility/v1/research-topics', {
     tab: 'related_topics', query: 'cyber insurance', sortBy: 'RELEVANCE_SCORE', limit: 50,
   })
   // → topics: [{ id, name, volume, relevanceScore }]
   ```

3. Keep topics with a relevance score of 91 or more, count each topic id once per theme and
   once overall (the first theme in order takes it), read the list and remove what is plainly
   off theme. Record the queries, the count, the largest topic and what you removed.
4. `prompts` of the theme is the sum of the volumes that remain.

Rules that keep it honest:

- Run the calls one after another and wait 2 to 3 seconds between them; in parallel they
  return 429. Retry a 429 after a pause.
- A full-text volume for a query (`tab: 'stats'`) is too fuzzy to quote; sum close topics.
- Totals are directional. Say so, and name the largest topic when it carries the total.
- Who is named: the `brands` tab takes a free-text `query`, not a topic, and its result is
  fuzzy (a product query also returns the leaders of the wider category). Use a specific
  query per theme, read the top rows, and find the firm's own rows with `textFilter`. Quote
  it as directional, with the query. The firm's own tracked topics and mentions, where the
  customer has them set up, are the better source.
- The sandbox has no timers: run the calls one after another and keep each run to a few
  queries; retry a 429 in a later run.

## Read 2 from Semrush

- **AI visibility** (mentions and topics by brand): Semrush's AI toolkit. Where the connector
  offers no AI topic report, export the topic list per brand from the product and sum it per
  theme with the same rules as above.
- **Search demand**: the keyword reports of the Semrush connector (discover the report, read
  its schema, execute it). Per theme, the monthly volume of the same queries, for the same
  country. Search and prompt volume are different quantities: show both, never add them.
- **Who ranks**: organic research per domain gives the pages and keywords each site already
  holds, which is the search-side version of "who is named".

## Calling the state

| State | When |
| --- | --- |
| `lead` | the firm (all its brands together) is named clearly more often than the next competitor |
| `comp` | a competitor is named more often on the theme or on a large part of it |
| `open` | nobody compared is named on the largest topics, or all counts are too small to rank |

Count the firm's brands together and separately. A lead that only exists when several
brand names are added up is a finding in itself: it is lost if the names stop being cited.

## Optional: what assistants fetch (citation attempts)

When the firm has agentic traffic in Adobe Brand Visibility, add a fourth read. A citation
attempt is a page load by an agent whose name ends in `-User` (ChatGPT-User, Claude-User,
Perplexity-User): an assistant loading the page to answer a person. Filter on those agents, not
on the whole "Chatbots" agent type.

- `GET /adobe/brand-visibility/v1/sites/{siteId}/agentic-traffic/by-url` with
  `datePreset: 'custom'`, `startDate`, `endDate`, `userAgent`, `limit: 100`, `pageOffset`,
  `sortBy: 'total_hits'`; the rows are under `body.data.rows`. One pass per agent, summed by path.
- Join with visits per page from the bundles, for the same window. Pages with many attempts and
  few visits are answered about more than they are visited.
- Read the most fetched pages. Their headings tell you which questions sent the assistant
  there; say that the questions are inferred. Prompts that cite a URL exist only when the brand
  has tracked prompts (URL Inspector).
- Use attempts to rank pages and themes inside one window, not as a trend: how assistants fetch
  changes on their side.

In `reads.json`, a theme takes `attempts` (a number) and `fetched` (one line), and the file
`fetchedNote` (the tile text) and `title` (the heading, e.g. "Four reads, one plan"). The
picture then draws a "Fetched" line per theme and a fourth tile.

## Read 3 from public statements

Sources, newest first: the last earnings call and release, the annual report and investor
day, press releases on a rebrand or reorganisation, what leadership says in interviews.

Write down, with source and date:

- the growth areas management names (the words they use, not yours);
- changes of brand or structure that change which names people and models use;
- where growth is coming from now and where it is not.

Map each named growth area to one theme. If it fits none, the theme list is missing one.
What is not said in public is not in this read.
