#!/usr/bin/env node
/*
 * optel-client.js: read AEM Operational Telemetry (Optel, formerly RUM) data
 * and turn it into numbers an app can use.
 *
 * One file, no dependencies. Works as:
 *   - an ES module in the browser   import * as optel from './optel-client.js';
 *   - an ES module in Node 18+      import * as optel from './optel-client.js';
 *   - a CLI                         node optel-client.js --domain www.example.com --last 7d --report summary
 *
 * Reference: https://www.aem.live/developer/operational-telemetry
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST (written for the person, or the coding model, building on it)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHERE THE DATA COMES FROM
 *   Sites on AEM (Edge Delivery Services, and others with the Optel script) sample
 *   page views in the browser: by default 1 view in 100 is selected, and every
 *   event of a selected view is sent. The collector groups those events into one
 *   BUNDLE per page view and serves them as JSON files per hour, day or month:
 *
 *     https://bundles.aem.page/bundles/{domain}/{YYYY}/{MM}/{DD}/{HH}?domainkey={key}   (hour)
 *     https://bundles.aem.page/bundles/{domain}/{YYYY}/{MM}/{DD}?domainkey={key}        (day)
 *     https://bundles.aem.page/bundles/{domain}/{YYYY}/{MM}?domainkey={key}             (month)
 *     https://bundles.aem.page/orgs/{org}/bundles/...                                   (org key, all domains of the org)
 *
 *   Response: { "rumBundles": [ Bundle, ... ] }. All times are UTC.
 *   CORS is open (access-control-allow-origin: *), so browsers can call it directly.
 *   A wrong key answers 403 with an `x-error` header ("[bundler] invalid domainkey param").
 *
 * THE DOMAIN KEY
 *   Each hostname has its own key (the `domainkey=` value in an Optel explorer URL):
 *   example.com, www.example.com and main--site--org.aem.page are three keys. It grants
 *   read access to all of that hostname's telemetry. Adobe issues keys: customers ask
 *   their Adobe contact. To try the client without one, use the public demo:
 *   domain 'emigrationbrewing.com' with domainKey 'open'. Treat it like a password:
 *   never commit it, never put it in a URL you share, never ship it in public
 *   front-end code. Pass it at runtime (env var, user input, a server-side proxy).
 *
 * THE BUNDLE (one sampled page view)
 *   {
 *     id:        'kZ3x9q',                        // random per page view
 *     url:       'https://www.example.com/path',  // origin + path (query stripped by default)
 *     host:      'rum.hlx.page',                  // collector host, not the site
 *     time:      '2026-09-30T14:03:11.000Z',      // when the view started
 *     timeSlot:  '2026-09-30T14:00:00.000Z',      // the file's time bucket
 *     userAgent: 'mobile:ios',                    // 'desktop:windows', 'bot:crawler', ... (simplified)
 *     weight:    100,                             // how many real views this sample stands for
 *     events:    [ { checkpoint, source?, target?, value?, timeDelta? }, ... ]
 *   }
 *   See CHECKPOINTS below for what `source` and `target` mean per checkpoint.
 *
 * FIVE RULES THAT KEEP NUMBERS RIGHT
 *   1. Count with `weight`, never with bundles.length. views = Σ weight.
 *      Weights are usually 100 but a site can sample at 10 or 1000, so never assume.
 *   2. Count a bundle once per thing you group by. A view with 3 clicks on the
 *      same button is one view that clicked that button (groupBy() does this).
 *   3. Drop bots (userAgent starts with 'bot') and un-activated prerenders
 *      (isPageView()) before computing shares. viewsOf()/realViews() do both.
 *   4. Everything is an estimate. Below ~30 bundles in a group, say so. Use
 *      marginOfError() to show the ± range.
 *   5. Selectors in `source` are generated (`.cards a`, `#container-9fae63`), not
 *      human names. Map them to labels in the app if users need to read them.
 *
 * COST OF LOADING
 *   There is no per-URL or per-checkpoint query: you download whole files and
 *   filter client-side. A busy domain's week (168 hourly files) can be hundreds of
 *   MB of JSON. Pick the coarsest granularity that answers the question
 *   (planRange() does this), pass `filter` to keep only the bundles you need while
 *   loading, and `checkpoints` to drop events you will not read.
 *
 * MAP OF THIS FILE
 *   §1 Constants and the checkpoint reference (CHECKPOINTS)
 *   §2 URLs, ranges and loading               bundleUrl, planRange, loadBundles, createOptelClient
 *   §3 Bundle helpers                         events, isBot, isPageView, isVisit, pathOf, device, cwvOf, ...
 *   §4 Classification                         classifyReferrer, classifyAcquisition, classifyClick, classifyConsent, parseRedirect
 *   §5 Aggregation primitives                 weightOf, viewsOf, groupBy, percentile, timeSeries, marginOfError, compareProportions
 *   §6 Reports (ready-made, JSON-friendly)    summary, topPages, trafficSources, clickReport, cwvReport, errorReport,
 *                                             formReport, mediaReach, flows, experimentReport, checkpointReport
 *   §7 CLI
 *
 * Classification rules follow @adobe/rum-distiller (the library behind the Optel
 * explorer, Apache-2.0) where one exists, and the selector vocabulary of
 * @adobe/helix-rum-enhancer (the script that records the events).
 */

/* ═══════════════════════════════════════════════════════════════════════════
   §1 CONSTANTS AND THE CHECKPOINT REFERENCE
   ═══════════════════════════════════════════════════════════════════════════ */

export const VERSION = '0.1.0';
export const BUNDLER = 'https://bundles.aem.page';

/**
 * What each checkpoint records. Verified against @adobe/helix-rum-js 2.17 and
 * @adobe/helix-rum-enhancer 2.50. Not every site emits every checkpoint: a
 * checkpoint shows up only when the page has the thing (forms, a consent
 * banner, URL parameters) and the enhancer is loaded. Run
 * `checkpointReport(bundles)` (CLI: --report checkpoints) to see what a domain
 * actually has before building on one.
 *
 * Shape: name → { source, target, value?, use }
 */
export const CHECKPOINTS = {
  top: { source: '-', target: '-', use: 'First beacon of every sampled view. Present in (almost) every bundle.' },
  enter: { source: 'referrer URL (origin+path), "" or "(direct)" when none', target: 'document.visibilityState', use: 'The view started a visit: it came from outside the site. Acquisition and referrers.' },
  navigate: { source: 'previous page URL on the same origin', target: '"visible" | "hidden" | "prerendered"', use: 'Internal navigation: the view followed a link inside the site. flows().' },
  reload: { source: 'referrer', target: 'visibilityState', use: 'The view was a reload.' },
  back_forward: { source: 'referrer', target: 'visibilityState', use: 'The view came from the back/forward buttons.' },
  prerender: { source: 'referrer', target: 'visibilityState', use: 'Speculative prerender. Not a page view unless a navigate with target "prerendered" follows (isPageView()).' },
  click: { source: 'selector of the clicked element, e.g. ".hero a", "header button", "form#signup input[type=\'email\']"', target: 'href/src of the element or of its closest link; absent for non-links', use: 'What people click. classifyClick() tells links, buttons, dead clicks and consent apart. Focus on a form field is also recorded as a click without target.' },
  viewblock: { source: 'block selector, e.g. ".cards", ".hero", or a form selector', target: 'usually absent', use: 'A block scrolled into view (once per block per view). Scroll depth proxy for EDS sites.' },
  viewmedia: { source: 'selector of the img/video/iframe', target: 'media URL (currentSrc)', use: 'An image or video scrolled into view. Reach / scroll depth proxy. mediaReach().' },
  'cwv-lcp': { source: 'selector of the LCP element', target: 'LCP image URL when it is an image', value: 'milliseconds', use: 'Largest Contentful Paint. Only some views report CWV (the page must stay open long enough).' },
  'cwv-cls': { source: 'selector of the shifting element (sometimes)', target: '-', value: 'unitless score', use: 'Cumulative Layout Shift.' },
  'cwv-inp': { source: 'selector of the interacted element (sometimes)', target: '-', value: 'milliseconds', use: 'Interaction to Next Paint. Only views with an interaction.' },
  'cwv-ttfb': { source: '-', target: '-', value: 'milliseconds', use: 'Time to First Byte.' },
  loadresource: { source: 'resource URL (same-host JSON, .plain.html, APIs)', target: 'duration in ms', use: 'Fetches the page made: API and fragment latency.' },
  missingresource: { source: 'resource URL', target: 'HTTP status (>= 400)', use: 'Broken fetches: missing images, failing APIs. errorReport().' },
  error: { source: 'location "fn@https://host/file.js:line:col" | "undefined error" | "Unhandled Rejection" | form field selector', target: 'error message | validity type (valueMissing, typeMismatch, ...) for form validation', use: 'JavaScript errors and failed form validation. errorReport().' },
  404: { source: 'referrer (origin+path) of the 404 page', target: '-', use: 'The bundle\'s url is a missing page; source is where the visitor came from. errorReport().' },
  '4xx': { source: 'referrer', target: 'HTTP status', use: 'Other 4xx error pages (standalone script).' },
  fill: { source: 'selector of the form field changed', target: '-', use: 'A visitor typed or picked something in a form field. formReport().' },
  formsubmit: { source: 'form selector', target: 'form action URL', use: 'A valid form was submitted. formReport().' },
  search: { source: 'form selector', target: 'form action URL', use: 'A search form was submitted.' },
  login: { source: 'form selector', target: 'form action URL', use: 'A form with one password field was submitted.' },
  signup: { source: 'form selector', target: 'form action URL', use: 'A form with two or more password fields was submitted.' },
  utm: { source: 'parameter name: utm_source, utm_medium, utm_campaign, utm_content, ...', target: 'parameter value', use: 'Campaign tags on the landing URL. utm_id and utm_term are not recorded. classifyAcquisition().' },
  paid: { source: 'ad network: google | doubleclick | microsoft | facebook | twitter | linkedin | pinterest | tiktok | openai', target: 'click-id parameter name (gclid, fbclid, msclkid, ...)', use: 'The URL carried an ad click id: a paid click. classifyAcquisition().' },
  email: { source: 'mailchimp | marketo', target: 'parameter name (mc_cid, mkt_tok, ...)', use: 'The URL carried an email-tool tracking id: an owned email visit.' },
  consent: { source: 'onetrust | trustarc | usercentrics', target: '"show" | "hidden" | "suppressed"', use: 'Whether the cookie banner was shown on this view. Clicks inside it are click events with CMP selectors (classifyConsent()).' },
  redirect: { source: 'value of ?redirect_from= if any', target: '"<count>:<ms>" exact, or "<estimated count>~<ms>" estimated', use: 'The navigation went through redirects before the page; ms is time lost before the first byte. parseRedirect().' },
  language: { source: 'page language (html lang)', target: 'browser preferred language (navigator.language)', use: 'Audience language versus page language.' },
  a11y: { source: '"off" | "low" | "medium" | "high" (assistive-tech likelihood)', target: 'scale description', use: 'Accessibility audience signal (only on domains where the a11y flag is enabled).' },
  experiment: { source: 'experiment id', target: 'variant id', use: 'AEM Experimentation plugin: which variant this view saw. experimentReport().' },
  audience: { source: 'audience ids that matched', target: 'audience served', use: 'AEM Experimentation plugin audiences.' },
};

/* Core Web Vitals thresholds: [good up to, poor from]. Same as rum-distiller and web.dev. */
export const CWV_THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  ttfb: [800, 1800],
};

/* ═══════════════════════════════════════════════════════════════════════════
   §2 URLS, RANGES AND LOADING
   ═══════════════════════════════════════════════════════════════════════════ */

/** Thrown when the bundler refuses the request. `status` 403 means the key is wrong for this domain. */
export class OptelError extends Error {
  constructor(message, { status, url, detail } = {}) {
    super(message);
    this.name = 'OptelError';
    this.status = status;
    this.url = url;
    this.detail = detail;
  }
}

const pad = (n) => `${n}`.padStart(2, '0');

/** Accepts a Date, an ISO string, 'YYYY-MM-DD' or epoch ms. Always UTC. */
export function toDate(x) {
  if (x instanceof Date) return new Date(x.getTime());
  if (typeof x === 'number') return new Date(x);
  if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) return new Date(`${x}T00:00:00Z`);
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${x}`);
  return d;
}

/**
 * URL of one bundle file.
 * @param {object} o
 * @param {string} [o.domain]       e.g. 'www.example.com' (exactly as the site is served)
 * @param {string} [o.org]          use an org key instead: /orgs/{org}/bundles/...
 * @param {string} o.domainKey
 * @param {Date|string} o.date      any instant inside the hour/day/month wanted
 * @param {'hour'|'day'|'month'} [o.granularity='hour']
 * @param {string} [o.endpoint]     defaults to BUNDLER
 */
export function bundleUrl({
  domain, org, domainKey, date, granularity = 'hour', endpoint = BUNDLER,
}) {
  const d = toDate(date);
  const parts = [d.getUTCFullYear(), pad(d.getUTCMonth() + 1)];
  if (granularity !== 'month') parts.push(pad(d.getUTCDate()));
  if (granularity === 'hour') parts.push(pad(d.getUTCHours()));
  const base = org ? `orgs/${encodeURIComponent(org)}/bundles` : `bundles/${domain}`;
  const u = new URL(`${base}/${parts.join('/')}`, endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
  u.searchParams.set('domainkey', domainKey);
  return u.toString();
}

function floorTo(d, granularity) {
  const x = new Date(d.getTime());
  if (granularity === 'month') x.setUTCDate(1);
  if (granularity !== 'hour') x.setUTCHours(0);
  x.setUTCMinutes(0, 0, 0);
  return x;
}

function step(d, granularity) {
  const x = new Date(d.getTime());
  if (granularity === 'hour') x.setUTCHours(x.getUTCHours() + 1);
  else if (granularity === 'day') x.setUTCDate(x.getUTCDate() + 1);
  else x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}

/**
 * The files to fetch for a time range. Ranges snap outward to whole
 * hours / days / months, so the result can cover a little more than asked.
 *
 * Granularity 'auto' follows the Optel explorer: up to 7 days → hourly files,
 * up to 31 days → daily, longer → monthly. Hourly gives hour-level time series;
 * coarser files are far fewer requests.
 *
 * @returns {{ granularity: string, start: Date, end: Date, slots: Date[] }}
 */
export function planRange({ start, end = new Date(), granularity = 'auto' } = {}) {
  let s = toDate(start);
  let e = toDate(end);
  const now = new Date();
  if (e > now) e = now;
  if (e < s) throw new Error('start must be before end');
  const days = (e - s) / 864e5;
  const g = granularity !== 'auto' ? granularity : (days <= 7 ? 'hour' : days <= 31 ? 'day' : 'month');
  s = floorTo(s, g);
  const slots = [];
  for (let d = s; d <= e; d = step(d, g)) slots.push(d);
  return { granularity: g, start: s, end: e, slots };
}

/** '24h' | '7d' | '3m' → { start, end } ending now. */
export function lastRange(spec, now = new Date()) {
  const m = String(spec).match(/^(\d+)\s*([hdm])$/i);
  if (!m) throw new Error(`Use a span like 24h, 7d or 3m, got "${spec}"`);
  const n = Number(m[1]);
  const end = new Date(now.getTime());
  const start = new Date(now.getTime());
  const unit = m[2].toLowerCase();
  // `n` hours/days ending now: the current (partial) slot counts as one of them
  if (unit === 'h') start.setUTCHours(start.getUTCHours() - (n - 1));
  if (unit === 'd') start.setTime(start.getTime() - (n * 24 - 1) * 3600e3);
  if (unit === 'm') start.setUTCMonth(start.getUTCMonth() - n);
  return { start, end };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function fetchChunk(url, { fetchImpl, signal, retries }) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetchImpl(url, { signal });
    } catch (err) {
      if (signal?.aborted || attempt >= retries) throw err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(500 * 2 ** attempt);
      // eslint-disable-next-line no-continue
      continue;
    }
    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      return json.rumBundles || [];
    }
    // 404: no file for this slot (no traffic, or not written yet). Not an error.
    if (res.status === 404) return [];
    const detail = res.headers?.get?.('x-error') || '';
    if (res.status === 401 || res.status === 403) {
      throw new OptelError(`Domain key rejected (${res.status}${detail ? `: ${detail}` : ''}). Keys are per hostname: example.com, www.example.com and main--site--org.aem.page each have their own.`, { status: res.status, url: redact(url), detail });
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000 * 2 ** attempt);
      // eslint-disable-next-line no-continue
      continue;
    }
    throw new OptelError(`Bundler answered ${res.status}${detail ? `: ${detail}` : ''}`, { status: res.status, url: redact(url), detail });
  }
}

/** Never let a key end up in logs or error messages. */
export const redact = (url) => String(url).replace(/(domainkey=)[^&]+/i, '$1***');

/**
 * Load bundles for a time range. This is the one function every app calls.
 *
 * @param {object} o
 * @param {string}   [o.domain]          'www.example.com'. Either domain or org.
 * @param {string}   [o.org]             org id for an org-level key
 * @param {string}   o.domainKey         the key. Never hard-code it.
 * @param {Date|string} [o.start]        range start (UTC). Or use `last`.
 * @param {Date|string} [o.end=now]      range end
 * @param {string}   [o.last]            '24h' | '7d' | '3m': shorthand for start/end ending now
 * @param {'auto'|'hour'|'day'|'month'} [o.granularity='auto']
 * @param {(b: object) => boolean} [o.filter]  keep only matching bundles WHILE loading (saves memory).
 *                                       Combine with the predicates in §3, e.g. byPath('/blog').
 * @param {string[]} [o.checkpoints]     keep only these events in each bundle (saves memory)
 * @param {boolean}  [o.keep=true]       false: do not accumulate; use onChunk to reduce as you go
 * @param {number}   [o.concurrency=6]   parallel requests (browsers allow ~6 per host)
 * @param {number}   [o.retries=2]       retries on network errors, 429 and 5xx
 * @param {AbortSignal} [o.signal]       cancel loading
 * @param {(bundles: object[], info: {slot: Date, done: number, total: number}) => void} [o.onChunk]
 *                                       called per file with that file's kept bundles (render partial results here)
 * @param {(done: number, total: number) => void} [o.onProgress]
 * @param {typeof fetch} [o.fetch]       custom fetch (tests, proxies)
 * @param {string}   [o.endpoint]        bundler base URL, e.g. your own proxy that adds the key server-side
 * @returns {Promise<{ bundles: object[], granularity: string, start: Date, end: Date, files: number, failed: {slot: Date, error: string}[] }>}
 *
 * Failure model: a rejected key throws OptelError at once (it would fail for
 * every file). Any other failed file is listed in `failed` and loading goes on,
 * so check `failed.length` before trusting totals.
 *
 * @example
 *   const { bundles } = await loadBundles({ domain: 'www.example.com', domainKey, last: '7d', filter: byPath('/products') });
 *   const report = summary(bundles);
 */
export async function loadBundles({
  domain, org, domainKey, start, end, last, granularity = 'auto', filter, checkpoints, keep = true,
  concurrency = 6, retries = 2, signal, onChunk, onProgress, fetch: fetchImpl = globalThis.fetch, endpoint = BUNDLER,
} = {}) {
  if (!domain && !org) throw new Error('loadBundles needs `domain` (or `org`)');
  if (!domainKey) throw new Error('loadBundles needs `domainKey`');
  if (!fetchImpl) throw new Error('No fetch available: pass `fetch` or use Node 18+');
  const range = last ? lastRange(last) : { start, end };
  if (!range.start) throw new Error('loadBundles needs `start` or `last`');
  const plan = planRange({ ...range, granularity });
  const cps = checkpoints ? new Set(checkpoints) : null;
  const bundles = [];
  const failed = [];
  const queue = plan.slots.slice();
  let done = 0;
  let fatal = null;

  const worker = async () => {
    while (queue.length && !fatal && !signal?.aborted) {
      const slot = queue.shift();
      const url = bundleUrl({
        domain, org, domainKey, date: slot, granularity: plan.granularity, endpoint,
      });
      let kept = [];
      try {
        // one lane of the concurrency pool: sequential on purpose
        // eslint-disable-next-line no-await-in-loop
        const raw = await fetchChunk(url, { fetchImpl, signal, retries });
        kept = filter ? raw.filter(filter) : raw;
        if (cps) kept = kept.map((b) => ({ ...b, events: (b.events || []).filter((e) => cps.has(e.checkpoint)) }));
        if (keep) for (const b of kept) bundles.push(b);
      } catch (err) {
        if (err instanceof OptelError && (err.status === 401 || err.status === 403)) { fatal = err; return; }
        if (signal?.aborted) return;
        failed.push({ slot, error: redact(err.message || err) });
      }
      done += 1;
      onChunk?.(kept, { slot, done, total: plan.slots.length });
      onProgress?.(done, plan.slots.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  if (fatal) throw fatal;
  if (signal?.aborted) throw signal.reason || new Error('aborted');
  return {
    bundles, granularity: plan.granularity, start: plan.start, end: plan.end, files: plan.slots.length, failed,
  };
}

/**
 * Convenience wrapper that remembers domain and key.
 *
 * @example
 *   const optel = createOptelClient({ domain: 'www.example.com', domainKey });
 *   const { bundles } = await optel.load({ last: '7d' });
 *   const page = await optel.page('/products/shoes', { last: '30d' });   // { bundles, report }
 */
export function createOptelClient(config) {
  const load = (opts = {}) => loadBundles({ ...config, ...opts });
  return {
    load,
    /** Bundles and the summary() report for one page path. */
    async page(path, opts = {}) {
      const res = await load({ ...opts, filter: and(byPath(path), opts.filter) });
      return { ...res, report: summary(res.bundles) };
    },
    /** Bundles for every page under a path prefix ('/blog'). */
    section(prefix, opts = {}) {
      return load({ ...opts, filter: and(byPathPrefix(prefix), opts.filter) });
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §3 BUNDLE HELPERS (pure functions over one bundle)
   ═══════════════════════════════════════════════════════════════════════════ */

/** All events of a checkpoint (or of any of several). */
export const events = (b, cp) => (b.events || []).filter((e) => (Array.isArray(cp) ? cp.includes(e.checkpoint) : e.checkpoint === cp));
/** The first event of a checkpoint, or undefined. */
export const firstEvent = (b, cp) => (b.events || []).find((e) => e.checkpoint === cp);
/** Does the bundle have this checkpoint at least once? */
export const has = (b, cp) => (b.events || []).some((e) => e.checkpoint === cp);

/** Bots, crawlers, monitoring. Exclude them from every human metric. */
export const isBot = (b) => /^bot/i.test(b.userAgent || '');

/** A prerender only counts as a view once it was actually navigated to (rum-distiller pageViews). */
export function isPageView(b) {
  return !has(b, 'prerender') || (b.events || []).some((e) => e.checkpoint === 'navigate' && e.target === 'prerendered');
}

/** A real human page view: not a bot, not an un-activated prerender. */
export const isHumanView = (b) => !isBot(b) && isPageView(b);

/** The view started a visit (came from outside the site). */
export const isVisit = (b) => has(b, 'enter');

/** Distiller bounce: a visit without any click. */
export const isBounce = (b) => isVisit(b) && !has(b, 'click');

/** Distiller engagement: any click, or more than 3 viewblock/viewmedia events. */
export const isEngaged = (b) => has(b, 'click') || events(b, ['viewblock', 'viewmedia']).length > 3;

/** '/path' with trailing slash and '/index' removed; query and hash dropped. */
export function normalizePath(path) {
  let p = String(path || '/').split('?')[0].split('#')[0];
  if (/^https?:\/\//.test(p)) { try { p = new URL(p).pathname; } catch { /* keep */ } }
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length) || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

/** Normalized path of the page the bundle was recorded on. */
export function pathOf(b) {
  try { return normalizePath(new URL(b.url).pathname); } catch { return ''; }
}

/** Host of the page ('www.example.com'). Useful with org-level keys. */
export function hostOf(b) {
  try { return new URL(b.url).hostname; } catch { return b.domain || ''; }
}

/** 'mobile' | 'desktop' | 'bot' | 'undefined' ... (first segment of userAgent). */
export const device = (b) => (b.userAgent || 'undefined').split(':')[0];
/** 'ios', 'android', 'windows', 'mac', 'linux', ... when present. */
export const os = (b) => (b.userAgent || '').split(':')[1] || '';

/** UTC day 'YYYY-MM-DD' and hour 'YYYY-MM-DDTHH' of the view. */
export const dayOf = (b) => String(b.time || b.timeSlot || '').slice(0, 10);
export const hourOf = (b) => String(b.time || b.timeSlot || '').slice(0, 13);

/** The referrer that started the visit ('' for direct). Only visits have one. */
export function referrerOf(b) {
  const e = firstEvent(b, 'enter');
  if (!e) return null;
  return e.source && e.source !== '(direct)' ? e.source : '';
}

/** UTM parameters of the landing URL as a plain object: { utm_source: 'google', ... } (lower-cased keys). */
export function utmOf(b) {
  const out = {};
  events(b, 'utm').forEach((e) => { if (e.source) out[e.source.toLowerCase()] = String(e.target ?? ''); });
  return out;
}

/** Core Web Vitals of the view: { lcp, cls, inp, ttfb }, each a number or null. LCP/CLS take the max reported. */
export function cwvOf(b) {
  const out = {
    lcp: null, cls: null, inp: null, ttfb: null,
  };
  (b.events || []).forEach((e) => {
    const m = /^cwv-(lcp|cls|inp|ttfb)$/.exec(e.checkpoint || '');
    if (!m) return;
    const v = Number(e.value);
    if (!Number.isFinite(v)) return;
    const k = m[1];
    out[k] = (k === 'lcp' || k === 'cls') ? Math.max(out[k] ?? 0, v) : v;
  });
  return out;
}

/** 'good' | 'ni' (needs improvement) | 'poor' | null for a CWV value. */
export function rateCWV(metric, value) {
  const t = CWV_THRESHOLDS[metric];
  if (!t || value == null) return null;
  if (value >= t[1]) return 'poor';
  if (value > t[0]) return 'ni';
  return 'good';
}

/* Predicates, for `filter` in loadBundles() or Array.filter. Compose with and()/or(). */
export const byPath = (path) => { const p = normalizePath(path); return (b) => pathOf(b) === p; };
export const byPathPrefix = (prefix) => { const p = normalizePath(prefix); return (b) => { const x = pathOf(b); return x === p || x.startsWith(p === '/' ? '/' : `${p}/`); }; };
export const byPathMatch = (re) => (b) => re.test(pathOf(b));
export const byHost = (host) => (b) => hostOf(b) === host;
export const byDevice = (type) => (b) => device(b) === type;
export const byCheckpoint = (cp) => (b) => has(b, cp);
export const byTime = (start, end) => { const s = toDate(start).toISOString(); const e = toDate(end).toISOString(); return (b) => { const t = b.time || b.timeSlot; return t >= s && t < e; }; };
export const and = (...fns) => { const f = fns.filter(Boolean); return (b) => f.every((fn) => fn(b)); };
export const or = (...fns) => { const f = fns.filter(Boolean); return (b) => f.some((fn) => fn(b)); };
export const not = (fn) => (b) => !fn(b);

/* ═══════════════════════════════════════════════════════════════════════════
   §4 CLASSIFICATION
   Rules are data: change RULES to fit a site's own campaign conventions
   (e.g. RULES.paidMedium = /cpc|paid|social/i if social posts are always paid).
   ═══════════════════════════════════════════════════════════════════════════ */

export const RULES = {
  /* utm_medium / utm_source values that mean the visit was bought (rum-distiller) */
  paidMedium: /cpc|ppc|paid|cpm|cpv|banner|display|programmatic|affiliate|^sea$|ads|dv360/i,
  /* values that mean an owned channel: email, SMS, QR, print, own website */
  ownedMedium: /email|newsletter|hs_email|organic|sms|qr|qrcode|print|website|web|linkin\.bio|push/i,
  /* referrer hosts of ad networks: a visit from one is paid even without tags */
  adReferrer: /doubleclick|googlesyndication|googleadservices|amazon-adsystem|imasdk\.googleapis|adnxs|criteo|taboola|outbrain|teads/i,
  search: /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.[a-z.]+|duckduckgo\.com|ecosia\.org|baidu\.com|yandex\.[a-z]+|naver\.com|ask\.com|aol\.com|search\.brave\.com|qwant\.com|seznam\.cz|startpage\.com)$/i,
  social: /(^|\.)(facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|t\.co|snapchat\.com|pinterest\.[a-z.]+|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|youtu\.be|threads\.net|whatsapp\.com|line\.me|bsky\.app)$/i,
  ai: /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|anthropic\.com|copilot\.microsoft\.com|gemini\.google\.com|bard\.google\.com|notebooklm\.google\.com|you\.com|meta\.ai|deepseek\.com|chat\.mistral\.ai|mistral\.ai|grok\.com|x\.ai|poe\.com|phind\.com)$/i,
  aiUtm: /chatgpt|openai|perplexity|copilot|gemini|claude|deepseek|mistral|grok/i,
  email: /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.aol\.com)$/i,
  /* in-app referrers ('android-app://com.facebook.katana/') → a host the rules understand */
  androidApps: {
    'com.google.android.gm': 'mail.google.com',
    'com.google.android.googlequicksearchbox': 'www.google.com',
    'com.google.android.youtube': 'youtube.com',
    'com.facebook.katana': 'facebook.com',
    'com.instagram.android': 'instagram.com',
    'com.linkedin.android': 'linkedin.com',
    'com.pinterest': 'pinterest.com',
    'com.reddit.frontpage': 'reddit.com',
    'com.twitter.android': 'x.com',
    'jp.naver.line.android': 'line.me',
  },
};

const VENDORS = [
  [/chatgpt|openai/i, 'chatgpt'], [/perplexity/i, 'perplexity'], [/claude|anthropic/i, 'claude'], [/copilot/i, 'copilot'],
  [/gemini|bard|notebooklm/i, 'gemini'], [/meta\.ai/i, 'meta-ai'], [/deepseek/i, 'deepseek'], [/mistral/i, 'mistral'], [/grok|x\.ai/i, 'grok'],
  [/google|gclid|dclid|doubleclick|dv360|gdn|adwords|googlesyndication/i, 'google'], [/instagram|(^|[^a-z])ig([^a-z]|$)/i, 'instagram'],
  [/facebook|fbclid|(^|[^a-z])fb([^a-z]|$)|(^|[^a-z])meta([^a-z]|$)/i, 'facebook'], [/bing|msclkid/i, 'bing'], [/microsoft/i, 'microsoft'],
  [/tiktok|ttclid/i, 'tiktok'], [/youtube|youtu\.be/i, 'youtube'], [/linkedin|lnkd/i, 'linkedin'], [/twitter|(^|\.)x\.com|(^|\.)t\.co$/i, 'x'],
  [/snapchat/i, 'snapchat'], [/pinterest/i, 'pinterest'], [/reddit/i, 'reddit'], [/spotify/i, 'spotify'], [/criteo/i, 'criteo'],
  [/taboola/i, 'taboola'], [/outbrain/i, 'outbrain'], [/yahoo/i, 'yahoo'], [/duckduckgo/i, 'duckduckgo'], [/yandex/i, 'yandex'],
  [/baidu/i, 'baidu'], [/amazon/i, 'amazon'], [/marketo/i, 'marketo'], [/mailchimp/i, 'mailchimp'], [/whatsapp/i, 'whatsapp'],
];
/** Best-guess vendor name for a host, utm value or network name ('google', 'facebook', 'chatgpt', ...), or ''. */
export const vendorOf = (s) => (VENDORS.find(([re]) => re.test(s || '')) || [])[1] || '';

function hostFrom(source) {
  if (!source) return '';
  const app = /^android-app:\/\/([^/]+)/i.exec(source);
  if (app) return RULES.androidApps[app[1].toLowerCase()] || (/\.[a-z]{2,}$/i.test(app[1]) && !/^(com|org|net|io)\./i.test(app[1]) ? app[1] : '');
  try { return new URL(source).hostname.replace(/^(www|m|l|lm|mobile)\./, ''); } catch { return ''; }
}

/**
 * What kind of place a referrer URL is.
 * @param {string} url       the `enter` event source
 * @param {string} [siteHost] the site's own host, to spot internal referrers
 * @returns {{ type: 'direct'|'internal'|'search'|'social'|'ai'|'email'|'ad'|'app'|'other', vendor: string, host: string }}
 */
export function classifyReferrer(url, siteHost = '') {
  if (!url || url === '(direct)') return { type: 'direct', vendor: '', host: '' };
  const host = hostFrom(url);
  if (!host) return { type: /^android-app:/i.test(url) ? 'app' : 'other', vendor: '', host: url };
  const bare = (h) => h.replace(/^www\./, '');
  if (siteHost && bare(host) === bare(siteHost)) return { type: 'internal', vendor: '', host };
  const vendor = vendorOf(host);
  if (RULES.ai.test(host)) return { type: 'ai', vendor, host };
  if (RULES.adReferrer.test(host)) return { type: 'ad', vendor, host };
  if (RULES.email.test(host)) return { type: 'email', vendor, host };
  if (RULES.search.test(host)) return { type: 'search', vendor, host };
  if (RULES.social.test(host)) return { type: 'social', vendor, host };
  return { type: 'other', vendor, host };
}

/**
 * How a visit was acquired. Only visits (bundles with `enter`) are classified;
 * other views return null because they came from inside the site.
 *
 *   type     'paid' | 'owned' | 'earned'
 *   channel  'search' | 'social' | 'ai' | 'email' | 'display' | 'video' | 'referral' | 'direct' | 'campaign' | ...
 *   vendor   'google' | 'facebook' | 'chatgpt' | ... or ''
 *   label    'paid:search:google' (rum-distiller style; split on ':' to facet)
 *
 * Order of evidence: ad click ids (`paid`) → utm tags → email tool ids (`email`) → referrer.
 * @returns {{ type: string, channel: string, vendor: string, label: string, referrer: string, utm: object } | null}
 */
export function classifyAcquisition(b) {
  if (!isVisit(b)) return null;
  const utm = utmOf(b);
  const referrer = referrerOf(b) || '';
  const ref = classifyReferrer(referrer);
  const paidEvent = firstEvent(b, 'paid');
  const emailEvent = firstEvent(b, 'email');
  const src = utm.utm_source || '';
  const medium = utm.utm_medium || '';
  const tagChannel = (s) => {
    if (/search|sem|sea$|cpc|ppc/i.test(s)) return 'search';
    if (/display|programmatic|banner|gdn|dbm|native/i.test(s)) return 'display';
    if (/video|dv360|ctv|ott|(^|[^a-z])tv/i.test(s)) return 'video';
    if (/email|newsletter|mail/i.test(s)) return 'email';
    if (/social|bio/i.test(s)) return 'social';
    if (/affiliate/i.test(s)) return 'affiliate';
    if (/sms/i.test(s)) return 'sms';
    if (/qr/i.test(s)) return 'qr';
    if (/print/i.test(s)) return 'print';
    return '';
  };
  const make = (type, channel, vendor) => ({
    type, channel: channel || 'campaign', vendor: vendor || '', label: [type, channel || 'campaign', vendor].filter(Boolean).join(':'), referrer, utm,
  });

  if (paidEvent) {
    const vendor = vendorOf(paidEvent.source) || paidEvent.source || vendorOf(src);
    const channel = tagChannel(medium) || (['google', 'bing', 'microsoft'].includes(vendor) ? 'search' : ['facebook', 'instagram', 'linkedin', 'x', 'pinterest', 'tiktok'].includes(vendor) ? 'social' : '');
    return make('paid', channel, vendor);
  }
  if (src || medium) {
    const vendor = vendorOf(src) || vendorOf(utm.utm_source_platform) || src.toLowerCase();
    if (RULES.aiUtm.test(src)) return make('earned', 'ai', vendorOf(src) || src.toLowerCase());
    if (RULES.paidMedium.test(medium) || RULES.paidMedium.test(src)) return make('paid', tagChannel(medium) || tagChannel(src), vendor);
    if (RULES.ownedMedium.test(medium) || RULES.ownedMedium.test(src)) return make('owned', tagChannel(medium) || tagChannel(src) || 'web', vendor);
    const fallback = { direct: 'campaign', other: 'referral', app: 'referral' }[ref.type] || ref.type;
    return make('earned', tagChannel(medium) || fallback, vendor);
  }
  if (emailEvent) return make('owned', 'email', emailEvent.source);
  if (ref.type === 'ad') return make('paid', 'display', ref.vendor || ref.host);
  if (ref.type === 'direct') return make('earned', 'direct', '');
  if (ref.type === 'email') return make('owned', 'email', ref.vendor);
  return make('earned', ref.type === 'other' || ref.type === 'app' ? 'referral' : ref.type, ref.vendor || ref.host);
}

/* Cookie-banner click selectors, after rum-distiller/consent.js plus common OneTrust preference-centre ids. */
const CONSENT = [
  {
    match: /onetrust|#ot-|ot-pc|ot-sdk|ot-group|ot-switch|save-preference-btn/, accept: /accept/, reject: /reject|refuse/, dismiss: /close/, settings: /pc-btn-handler|setting|save-preference|ot-group|ot-switch/,
  },
  { match: /#usercentrics-root/, accept: /accept/, reject: /deny|reject/ },
  { match: /#truste|trustarc/, accept: /consent-button|accept/, dismiss: /close/ },
  { match: /#CybotCookiebot/, accept: /AllowAll|Allow/, reject: /Decline/ },
  { match: /#cassie|button#cassie/, accept: /accept/, reject: /reject/ },
  {
    match: /#didomi/, accept: /agree-button/, reject: /disagree-button/, dismiss: /popup-close|continue-without-agreeing/,
  },
];

/** For a click source selector inside a cookie banner: 'accept' | 'reject' | 'dismiss' | 'settings' | 'other'. Otherwise null. */
export function classifyConsent(source) {
  if (!source) return null;
  const v = CONSENT.find((c) => c.match.test(source));
  if (!v) return null;
  // check reject before accept: "accept" matches inside some reject ids, never the other way round
  return ['reject', 'accept', 'dismiss', 'settings'].find((k) => v[k] && v[k].test(source)) || 'other';
}

const MEDIA_URL = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m3u8)(\?|#|$)|\/media_[0-9a-f]+/i;

/**
 * What a click hit, from its selector and target. The enhancer names only
 * `a`, `img`, `video`, `form` (and `button` for anything button-like); other
 * elements report as `#id` or `.class`. The target is the element's own
 * href/src or the closest link's href.
 *
 * @param {{source?: string, target?: string}} e   a click event
 * @param {string} [pageUrl]  the page's own URL: a target equal to it is not a navigation
 * @returns {'consent'|'link'|'button'|'form'|'media'|'dead'|'unknown'}
 *   dead = a tap on something with no link and no button: people expected it to do something.
 */
export function classifyClick(e, pageUrl = '') {
  const source = (e?.source || '').trim();
  const target = e?.target || '';
  if (!source) return 'unknown';
  if (classifyConsent(source)) return 'consent';
  const parts = source.split(/\s+/);
  const name = parts[parts.length - 1] || '';
  if (/^button\b/.test(name)) return 'button';
  if (/^(input|select|textarea)\b/.test(name) || /^form\b/.test(name)) return 'form';
  if (/^a\b/.test(name)) return 'link';
  if (/^(img|video)\b/.test(name)) return 'media';
  if (target && !MEDIA_URL.test(target) && normalizeUrl(target) !== normalizeUrl(pageUrl)) return 'link';
  return 'dead';
}

const normalizeUrl = (u) => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '');

/** True when a click's target is a page URL other than the current page (the visitor left via a link). */
export function isNavigation(e, pageUrl = '') {
  const t = e?.target || '';
  return /^https?:\/\//.test(t) && !MEDIA_URL.test(t) && normalizeUrl(t) !== normalizeUrl(pageUrl);
}

/**
 * The redirect chain before the page: { hops, ms, exact, from } or null.
 * Target format is "<count>:<ms>" when the browser reported the redirects,
 * "<estimate>~<ms>" when the enhancer inferred them from a slow fetchStart.
 */
export function parseRedirect(b) {
  const e = firstEvent(b, 'redirect');
  if (!e) return null;
  const m = /^(\d+)([:~])(\d+)$/.exec(String(e.target ?? ''));
  if (!m) return { hops: 1, ms: null, exact: false, from: e.source || '' };
  return {
    hops: Math.max(1, Number(m[1])), ms: Number(m[3]), exact: m[2] === ':', from: e.source || '',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5 AGGREGATION PRIMITIVES
   Use these to build any metric the built-in reports do not cover.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Σ weight. The estimated number of real page views the bundles stand for. */
export const weightOf = (bundles) => bundles.reduce((a, b) => a + (b.weight || 0), 0);

/** Human page views only (bots and un-activated prerenders removed). */
export const realViews = (bundles) => bundles.filter(isHumanView);

/** Estimated human page views. */
export const viewsOf = (bundles) => weightOf(realViews(bundles));

/** Safe ratio (0 when the denominator is 0). */
export const ratio = (n, d) => (d ? n / d : 0);

/**
 * 95% margin of error for an estimated total, as rum-distiller computes it:
 * each bundle is a Bernoulli sample standing for `total / bundles` views.
 * @returns {number} ± views
 */
export function marginOfError(total, bundles) {
  if (!bundles) return 0;
  const w = total / bundles;
  return Math.round(1.96 * Math.sqrt(w * w * bundles));
}

/**
 * Weighted percentile.
 * @param {Array<[number, number]>} pairs  [value, weight]
 * @param {number} p                      0..1 (0.75 for CWV p75)
 */
export function percentile(pairs, p) {
  const clean = pairs.filter(([v]) => v != null && Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = clean.slice().sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((a, x) => a + x[1], 0);
  let acc = 0;
  for (const [v, w] of sorted) { acc += w; if (acc >= p * total) return v; }
  return sorted[sorted.length - 1][0];
}

/**
 * Group bundles and count weighted views per group, facet style: `keyFn` may
 * return a string, an array of strings (the bundle counts once in each), or
 * null/'' to skip. A bundle is counted ONCE per distinct key.
 *
 * @param {object[]} bundles
 * @param {(b: object) => string|string[]|null} keyFn
 * @param {object} [o]
 * @param {number} [o.top]          keep the N largest groups
 * @param {number} [o.total]        denominator for `share` (default: Σ weight of the input)
 * @param {Record<string, (groupBundles: object[]) => any>} [o.metrics]  extra columns per group
 * @returns {Array<{ key: string, views: number, bundles: number, share: number, [metric: string]: any }>}
 *
 * @example
 *   groupBy(realViews(bundles), device)                                  // views by device
 *   groupBy(realViews(bundles), pathOf, { top: 10, metrics: { lcpP75: (g) => cwvP75(g, 'lcp') } })
 *   groupBy(bundles, (b) => events(b, 'click').map((e) => e.source))    // views that clicked each element
 */
export function groupBy(bundles, keyFn, { top, total, metrics } = {}) {
  const groups = new Map();
  bundles.forEach((b) => {
    let keys = keyFn(b);
    if (keys == null || keys === '') return;
    keys = Array.isArray(keys) ? [...new Set(keys.filter((k) => k != null && k !== ''))] : [keys];
    keys.forEach((k) => {
      let g = groups.get(k);
      if (!g) { g = { key: String(k), views: 0, bundles: 0, members: metrics ? [] : null }; groups.set(k, g); }
      g.views += b.weight || 0;
      g.bundles += 1;
      if (metrics) g.members.push(b);
    });
  });
  const denom = total ?? weightOf(bundles);
  let rows = [...groups.values()].sort((a, b) => b.views - a.views);
  if (top) rows = rows.slice(0, top);
  return rows.map(({ members, ...g }) => {
    const row = { ...g, share: ratio(g.views, denom) };
    if (metrics) Object.entries(metrics).forEach(([name, fn]) => { row[name] = fn(members); });
    return row;
  });
}

/** Weighted p75 (or other percentile) of one CWV metric across bundles. */
export function cwvP75(bundles, metric, p = 0.75) {
  return percentile(bundles.map((b) => [cwvOf(b)[metric], b.weight || 0]), p);
}

/**
 * Views per hour or day, with optional extra series.
 * @param {object[]} bundles
 * @param {object} [o]
 * @param {'hour'|'day'} [o.by='day']
 * @param {Record<string, (b: object) => number>} [o.series]  per-bundle values to sum, e.g. { visits: (b) => isVisit(b) ? b.weight : 0 }
 * @param {Date[]} [o.slots]  pre-fill empty buckets (pass planRange(...).slots for gap-free charts)
 * @returns {Array<{ t: string, views: number, [series: string]: number }>} sorted by time
 */
export function timeSeries(bundles, { by = 'day', series = {}, slots } = {}) {
  const keyOf = by === 'hour' ? hourOf : dayOf;
  const out = new Map();
  const blank = (t) => ({ t, views: 0, ...Object.fromEntries(Object.keys(series).map((k) => [k, 0])) });
  (slots || []).forEach((d) => { const t = d.toISOString().slice(0, by === 'hour' ? 13 : 10); if (!out.has(t)) out.set(t, blank(t)); });
  bundles.forEach((b) => {
    const t = keyOf(b);
    if (!out.has(t)) out.set(t, blank(t));
    const row = out.get(t);
    row.views += b.weight || 0;
    Object.entries(series).forEach(([k, fn]) => { row[k] += fn(b) || 0; });
  });
  return [...out.values()].sort((a, b) => a.t.localeCompare(b.t));
}

/** Standard normal CDF (Abramowitz-Stegun). */
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Is a difference between two rates real? Two-proportion z-test on the
 * sampled bundle counts (not weighted views: the test needs independent samples).
 * @param {number} hitsA  bundles in A with the outcome
 * @param {number} nA     bundles in A
 * @returns {{ rateA: number, rateB: number, lift: number, z: number, p: number, significant: boolean }}
 *   lift = (rateB - rateA) / rateA; significant at p < 0.05 (two-sided)
 */
export function compareProportions(hitsA, nA, hitsB, nB) {
  const rateA = ratio(hitsA, nA);
  const rateB = ratio(hitsB, nB);
  const pooled = ratio(hitsA + hitsB, nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (ratio(1, nA) + ratio(1, nB)));
  const z = se ? (rateB - rateA) / se : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return {
    rateA, rateB, lift: rateA ? (rateB - rateA) / rateA : 0, z, p, significant: nA > 0 && nB > 0 && p < 0.05,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §6 REPORTS
   Each takes an array of bundles (already filtered to what you care about)
   and returns plain JSON. They drop bots/prerenders themselves unless noted.
   Combine with filters: summary(bundles.filter(byPath('/pricing'))).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The overview a dashboard or an agent usually wants first.
 * @param {object[]} bundles
 * @param {object} [o]
 * @param {number} [o.top=10]
 */
export function summary(bundles, { top = 10 } = {}) {
  const human = realViews(bundles);
  const views = weightOf(human);
  const visits = human.filter(isVisit);
  const visitViews = weightOf(visits);
  const times = bundles.map((b) => b.time || b.timeSlot).filter(Boolean).sort();
  const cwv = Object.fromEntries(['lcp', 'cls', 'inp', 'ttfb'].map((m) => {
    const sampled = human.filter((b) => cwvOf(b)[m] != null);
    const p75 = cwvP75(sampled, m);
    return [m, {
      p75, rating: rateCWV(m, p75), samples: sampled.length, goodShare: ratio(weightOf(sampled.filter((b) => rateCWV(m, cwvOf(b)[m]) === 'good')), weightOf(sampled)),
    }];
  }));
  return {
    window: { first: times[0] || null, last: times[times.length - 1] || null },
    sample: { bundles: human.length, botBundles: bundles.filter(isBot).length, marginOfError: marginOfError(views, human.length) },
    views,
    botViews: weightOf(bundles.filter(isBot)),
    visits: visitViews,
    pagesPerVisit: ratio(views, visitViews),
    bounceRate: ratio(weightOf(visits.filter(isBounce)), visitViews),
    engagementRate: ratio(weightOf(human.filter(isEngaged)), views),
    devices: groupBy(human, device),
    os: groupBy(human, (b) => [device(b), os(b)].filter(Boolean).join(':'), { top }),
    pages: groupBy(human, pathOf, { top }),
    acquisition: groupBy(visits, (b) => classifyAcquisition(b)?.type, { total: visitViews }),
    channels: groupBy(visits, (b) => { const a = classifyAcquisition(b); return a && `${a.type}:${a.channel}`; }, { top, total: visitViews }),
    referrers: groupBy(visits, (b) => { const r = classifyReferrer(referrerOf(b), hostOf(b)); return r.type === 'direct' ? '(direct)' : r.host; }, { top, total: visitViews }),
    cwv,
    errors: { views: weightOf(human.filter((b) => has(b, 'error'))), notFoundViews: weightOf(human.filter((b) => has(b, '404'))) },
    consent: groupBy(human, (b) => firstEvent(b, 'consent')?.target, { total: views }),
  };
}

/** Pages ranked by views, with visits, bounce, engagement and LCP p75 per page. */
export function topPages(bundles, { top = 25, pathFn = pathOf } = {}) {
  const human = realViews(bundles);
  return groupBy(human, pathFn, {
    top,
    metrics: {
      visits: (g) => weightOf(g.filter(isVisit)),
      bounceRate: (g) => ratio(weightOf(g.filter(isBounce)), weightOf(g.filter(isVisit))),
      engagementRate: (g) => ratio(weightOf(g.filter(isEngaged)), weightOf(g)),
      lcpP75: (g) => cwvP75(g, 'lcp'),
    },
  });
}

/**
 * Where visits come from, at three levels: type (paid/owned/earned), channel
 * (paid:search, earned:ai, ...) and source (paid:search:google). Engagement
 * per row tells good traffic from cheap traffic.
 */
export function trafficSources(bundles, { top = 20 } = {}) {
  const visits = realViews(bundles).filter(isVisit);
  const total = weightOf(visits);
  const engaged = { engagementRate: (g) => ratio(weightOf(g.filter(isEngaged)), weightOf(g)), bounceRate: (g) => ratio(weightOf(g.filter(isBounce)), weightOf(g)) };
  const acq = (b) => classifyAcquisition(b);
  return {
    visits: total,
    types: groupBy(visits, (b) => acq(b)?.type, { total, metrics: engaged }),
    channels: groupBy(visits, (b) => { const a = acq(b); return a && `${a.type}:${a.channel}`; }, { total, metrics: engaged }),
    sources: groupBy(visits, (b) => acq(b)?.label, { top, total, metrics: engaged }),
    referrerHosts: groupBy(visits, (b) => classifyReferrer(referrerOf(b), hostOf(b)).host || '(direct)', { top, total }),
    campaigns: groupBy(visits, (b) => utmOf(b).utm_campaign, { top, total }),
    ai: groupBy(visits, (b) => { const a = acq(b); return a?.channel === 'ai' ? a.vendor || 'ai' : null; }, { total }),
  };
}

/**
 * What people click on a page (or set of pages). Pass pageUrl for single-page
 * analysis so clicks on links to the page itself are not counted as navigation.
 *
 * Returns per element: views that clicked it, kind, top targets. Plus the
 * headline rates: share of views that clicked anything, anything but the
 * cookie banner, followed a link; and dead clicks (taps on things that do nothing).
 */
export function clickReport(bundles, { pageUrl = '', top = 20 } = {}) {
  const human = realViews(bundles);
  const views = weightOf(human);
  const nonConsent = (b) => events(b, 'click').filter((e) => classifyClick(e, pageUrl) !== 'consent');
  const clickedContent = human.filter((b) => nonConsent(b).length);
  const deadViews = human.filter((b) => events(b, 'click').some((e) => classifyClick(e, pageUrl) === 'dead'));
  const elements = groupBy(human, (b) => nonConsent(b).map((e) => e.source || ''), {
    top,
    total: views,
    metrics: {
      targets: (g) => groupBy(g, (b) => events(b, 'click').filter((e) => e.target).map((e) => e.target), { top: 3 }).map(({ key, views: v }) => ({ target: key, views: v })),
    },
  }).map((r) => {
    const target = r.targets[0]?.target || '';
    return { source: r.key, kind: classifyClick({ source: r.key, target }, pageUrl), ...r };
  });
  return {
    views,
    clickedAnyShare: ratio(weightOf(human.filter((b) => has(b, 'click'))), views),
    clickedContentShare: ratio(weightOf(clickedContent), views),
    navigatedShare: ratio(weightOf(human.filter((b) => events(b, 'click').some((e) => isNavigation(e, pageUrl)))), views),
    deadClickShare: ratio(weightOf(deadViews), weightOf(clickedContent)),
    elements,
    destinations: groupBy(human, (b) => events(b, 'click').filter((e) => isNavigation(e, pageUrl)).map((e) => normalizeUrl(e.target)), { top, total: views }),
    consent: groupBy(human, (b) => events(b, 'click').map((e) => classifyConsent(e.source)).filter(Boolean), { total: views }),
  };
}

/**
 * Core Web Vitals per page (or any grouping), worst LCP first. p75 is the
 * value Google uses; rating is good / ni / poor for that p75. Only views
 * that reported a metric count toward it (`samples`).
 */
export function cwvReport(bundles, { by = pathOf, top = 25, minSamples = 5 } = {}) {
  const human = realViews(bundles).filter((b) => events(b, ['cwv-lcp', 'cwv-cls', 'cwv-inp', 'cwv-ttfb']).length);
  const metric = (m) => (g) => { const s = g.filter((b) => cwvOf(b)[m] != null); const v = cwvP75(s, m); return { p75: v, rating: rateCWV(m, v), samples: s.length }; };
  return groupBy(human, by, {
    metrics: {
      lcp: metric('lcp'), cls: metric('cls'), inp: metric('inp'), ttfb: metric('ttfb'),
      lcpElement: (g) => groupBy(g, (b) => firstEvent(b, 'cwv-lcp')?.source, { top: 1 })[0]?.key || null,
    },
  })
    .filter((r) => r.bundles >= minSamples)
    .sort((a, b) => (b.lcp.p75 ?? -1) - (a.lcp.p75 ?? -1))
    .slice(0, top);
}

/** JavaScript errors, 404 pages (with where people came from) and broken resources. */
export function errorReport(bundles, { top = 20 } = {}) {
  const human = realViews(bundles);
  const views = weightOf(human);
  const nf = human.filter((b) => has(b, '404'));
  return {
    views,
    errorViewShare: ratio(weightOf(human.filter((b) => has(b, 'error'))), views),
    jsErrors: groupBy(human, (b) => events(b, 'error').map((e) => `${e.target ?? ''} @ ${e.source ?? ''}`), { top, total: views }),
    notFound: groupBy(nf, pathOf, {
      top, total: views, metrics: { from: (g) => groupBy(g, (b) => firstEvent(b, '404')?.source || '(direct)', { top: 3 }).map(({ key, views: v }) => ({ referrer: key, views: v })) },
    }),
    missingResources: groupBy(human, (b) => events(b, 'missingresource').map((e) => `${e.target} ${e.source}`), { top, total: views }),
  };
}

/**
 * Forms: how many views saw, started and submitted each form. A form is
 * identified by its selector; `seen` comes from viewblock on the form,
 * `started` from fill events whose source sits inside it, `submitted` from
 * formsubmit / search / login / signup. Validation errors are error events
 * whose source is a field of the form.
 */
export function formReport(bundles) {
  const human = realViews(bundles);
  const SUBMIT = ['formsubmit', 'search', 'login', 'signup'];
  // the form token can sit anywhere in a selector: 'form#contact input[type=email]', '.form form#contact'
  const formOf = (sel) => (/(?:^|\s)(form(?:[#.][^\s]+)?)(?=\s|$)/.exec(sel || '') || [])[1] || null;
  const forms = new Set();
  human.forEach((b) => (b.events || []).forEach((e) => {
    if (SUBMIT.includes(e.checkpoint) || e.checkpoint === 'fill' || e.checkpoint === 'viewblock' || e.checkpoint === 'error') {
      const f = formOf(e.source); if (f) forms.add(f);
    }
  }));
  return [...forms].map((form) => {
    const inForm = (e) => formOf(e.source) === form;
    const seen = human.filter((b) => events(b, 'viewblock').some(inForm));
    const started = human.filter((b) => events(b, 'fill').some(inForm));
    const submitted = human.filter((b) => events(b, SUBMIT).some(inForm));
    const invalid = human.filter((b) => events(b, 'error').some(inForm));
    return {
      form,
      pages: groupBy(started.length ? started : seen, pathOf, { top: 3 }).map((r) => r.key),
      seen: weightOf(seen),
      started: weightOf(started),
      submitted: weightOf(submitted),
      invalid: weightOf(invalid),
      startRate: ratio(weightOf(started), weightOf(seen)),
      completionRate: ratio(weightOf(submitted), weightOf(started)),
      fields: groupBy(started, (b) => events(b, 'fill').filter(inForm).map((e) => e.source), { total: weightOf(started) }),
      submitKinds: groupBy(submitted, (b) => events(b, SUBMIT).filter(inForm).map((e) => e.checkpoint)),
    };
  }).sort((a, b) => b.seen - a.seen);
}

/**
 * How far down people get, from viewblock (EDS blocks) and viewmedia
 * (images/videos) events: share of views in which each block/medium scrolled
 * into view, most-seen first. On a single page this is a scroll-depth curve.
 * `cliff` is the largest relative drop between consecutive items with >= 2% reach.
 */
export function mediaReach(bundles, { top = 25, checkpoint = 'viewblock' } = {}) {
  const human = realViews(bundles);
  const views = weightOf(human);
  const items = groupBy(human, (b) => events(b, checkpoint).map((e) => e.source).filter((s) => s && !s.startsWith('"')), {
    top,
    total: views,
    metrics: checkpoint === 'viewmedia' ? { media: (g) => groupBy(g, (b) => events(b, 'viewmedia').map((e) => normalizeUrl(e.target)), { top: 1 })[0]?.key || '' } : undefined,
  });
  let cliff = null;
  items.forEach((r, i) => {
    if (!i || items[i - 1].share < 0.02) return;
    const drop = 1 - r.share / items[i - 1].share;
    if (!cliff || drop > cliff.drop) cliff = { from: items[i - 1].key, to: r.key, drop };
  });
  return { views, checkpoint, items, cliff };
}

/**
 * Internal journeys: for each page, where people came from inside the site
 * (`navigate` source) and how many started their visit on it (`enter`).
 * With a path, returns that page's previous pages and next pages (clicked internal links).
 */
export function flows(bundles, { path, top = 15 } = {}) {
  const human = realViews(bundles);
  const prev = (b) => { const e = firstEvent(b, 'navigate'); return e?.source ? normalizePath(e.source) : null; };
  if (!path) {
    return groupBy(human.filter((b) => prev(b)), (b) => `${prev(b)} → ${pathOf(b)}`, { top });
  }
  const p = normalizePath(path);
  const here = human.filter((b) => pathOf(b) === p);
  const host = here[0] ? hostOf(here[0]) : '';
  return {
    path: p,
    views: weightOf(here),
    entries: weightOf(here.filter(isVisit)),
    previous: groupBy(here, (b) => {
      if (isVisit(b)) return '(entered here)';
      if (has(b, 'back_forward')) return '(back/forward button)';
      if (has(b, 'reload')) return '(reload)';
      return prev(b) || '(unknown)';
    }, { top }),
    next: groupBy(here, (b) => events(b, 'click').filter((e) => { try { return new URL(e.target).hostname === host; } catch { return false; } }).map((e) => normalizePath(e.target)).filter((t) => t !== p), { top, total: weightOf(here) }),
    exits: groupBy(here, (b) => events(b, 'click').filter((e) => { try { return isNavigation(e) && new URL(e.target).hostname !== host; } catch { return false; } }).map((e) => new URL(e.target).hostname), { top, total: weightOf(here) }),
  };
}

/**
 * A/B results for the AEM Experimentation plugin (`experiment` checkpoint).
 * Conversion defaults to "clicked anything but the cookie banner"; pass your
 * own predicate (e.g. (b) => has(b, 'formsubmit')). The first variant named
 * `control` (or the largest one) is the baseline.
 */
export function experimentReport(bundles, { conversion = (b) => events(b, 'click').some((e) => classifyClick(e) !== 'consent') } = {}) {
  const human = realViews(bundles).filter((b) => has(b, 'experiment'));
  const byExp = groupBy(human, (b) => firstEvent(b, 'experiment').source);
  return byExp.map(({ key: experiment }) => {
    const inExp = human.filter((b) => firstEvent(b, 'experiment').source === experiment);
    const variants = groupBy(inExp, (b) => firstEvent(b, 'experiment').target, {
      metrics: { conversions: (g) => g.filter(conversion).length, conversionViews: (g) => weightOf(g.filter(conversion)) },
    });
    const control = variants.find((v) => /control/i.test(v.key)) || variants[0];
    return {
      experiment,
      control: control?.key,
      variants: variants.map((v) => ({
        variant: v.key,
        views: v.views,
        bundles: v.bundles,
        conversionRate: ratio(v.conversions, v.bundles),
        vsControl: v === control ? null : compareProportions(control.conversions, control.bundles, v.conversions, v.bundles),
      })),
    };
  });
}

/**
 * Discovery: which checkpoints a domain records and how often, with example
 * sources and targets. Run this first on an unfamiliar domain.
 * With `checkpoint`, a breakdown of that checkpoint's sources/targets instead.
 */
export function checkpointReport(bundles, { checkpoint, top = 20 } = {}) {
  const human = realViews(bundles);
  const views = weightOf(human);
  if (checkpoint) {
    return {
      checkpoint,
      reference: CHECKPOINTS[checkpoint] || null,
      views: weightOf(human.filter(byCheckpoint(checkpoint))),
      share: ratio(weightOf(human.filter(byCheckpoint(checkpoint))), views),
      sources: groupBy(human, (b) => events(b, checkpoint).map((e) => e.source), { top, total: views }),
      targets: groupBy(human, (b) => events(b, checkpoint).map((e) => (e.target == null ? null : String(e.target))), { top, total: views }),
      values: percentile(human.flatMap((b) => events(b, checkpoint).filter((e) => e.value != null).map((e) => [Number(e.value), b.weight])), 0.5),
    };
  }
  return groupBy(human, (b) => (b.events || []).map((e) => e.checkpoint), { total: views }).map((r) => {
    const ex = human.flatMap((b) => events(b, r.key)).find((e) => e.source || e.target) || {};
    return {
      checkpoint: r.key, views: r.views, share: r.share, bundles: r.bundles, documented: !!CHECKPOINTS[r.key], exampleSource: ex.source ?? null, exampleTarget: ex.target ?? null,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   §7 CLI
   node optel-client.js --help
   ═══════════════════════════════════════════════════════════════════════════ */

const HELP = `optel-client ${VERSION}: read AEM Optel (RUM) bundles and print a JSON report.

Usage
  OPTEL_DOMAIN_KEY=... node optel-client.js --domain <host> [range] [filters] [--report <name>]

Range (default --last 7d)
  --last 24h|7d|30d|3m          span ending now
  --start YYYY-MM-DD --end YYYY-MM-DD
  --granularity auto|hour|day|month   (auto: <=7d hour, <=31d day, else month)

Filters (applied while loading)
  --path /exact/page            one page
  --prefix /section             a page and everything under it
  --match <regex>               paths matching a regex
  --device mobile|desktop

Reports
  summary (default)  pages  sources  clicks  cwv  errors  forms  reach  reach-media
  flows (with --path: previous/next pages)  experiments  checkpoints
  checkpoint:<name>  (breakdown of one checkpoint, e.g. checkpoint:utm)
  timeseries         (views/visits per day, per hour with --by hour)
  sample             (first 3 bundles, raw: check the data shape)
  raw                (all kept bundles as JSON lines)

Other
  --key <key>          domain key (prefer the OPTEL_DOMAIN_KEY env var: keeps it out of shell history)
  --org <org>          use an org-level key instead of --domain
  --top <n>            rows per table (default 10-25 depending on report)
  --page-url <url>     page URL for click classification (defaults to https://<domain><path>)
  --concurrency <n>    parallel requests (default 8)
  --out <file>         write JSON to a file instead of stdout
  --quiet              no progress on stderr`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (inline !== undefined) out[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[k] = argv[i + 1]; i += 1; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

async function cli(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) { process.stdout.write(`${HELP}\n`); return; }
  const domainKey = args.key || process.env.OPTEL_DOMAIN_KEY;
  if (!args.domain && !args.org) throw new Error('--domain is required (see --help)');
  if (!domainKey) throw new Error('Set OPTEL_DOMAIN_KEY (or pass --key)');
  const report = String(args.report || 'summary');
  const top = args.top ? Number(args.top) : undefined;
  const filter = and(
    args.path && byPath(args.path),
    args.prefix && byPathPrefix(args.prefix),
    args.match && byPathMatch(new RegExp(args.match)),
    args.device && byDevice(args.device),
  );
  const quiet = !!args.quiet;
  // redraw one progress line on a terminal; in logs and agent transcripts print every 10% instead
  const tty = !!process.stderr.isTTY;
  let lastTenth = -1;
  const progress = (d, n) => {
    if (tty) { process.stderr.write(`\rloading ${d}/${n} files`); return; }
    const tenth = Math.floor((d / n) * 10);
    if (tenth !== lastTenth) { lastTenth = tenth; process.stderr.write(`loading ${d}/${n} files\n`); }
  };
  const t0 = Date.now();
  const res = await loadBundles({
    domain: args.domain,
    org: args.org,
    domainKey,
    last: args.start ? undefined : (args.last || '7d'),
    start: args.start,
    end: args.end,
    granularity: args.granularity || 'auto',
    filter,
    concurrency: Number(args.concurrency || 8),
    onProgress: quiet ? undefined : progress,
  });
  if (!quiet) process.stderr.write(`${tty ? '\r' : ''}loaded ${res.files} ${res.granularity} files, kept ${res.bundles.length} bundles in ${((Date.now() - t0) / 1000).toFixed(1)}s${res.failed.length ? `, ${res.failed.length} files failed` : ''}\n`);

  const { bundles } = res;
  const pageUrl = args['page-url'] || (args.path && args.domain ? `https://${args.domain}${normalizePath(args.path)}` : '');
  const o = top ? { top } : {};
  let data;
  if (report === 'raw') {
    const text = bundles.map((b) => JSON.stringify(b)).join('\n');
    if (args.out) { const { writeFile } = await import('node:fs/promises'); await writeFile(args.out, `${text}\n`); } else process.stdout.write(`${text}\n`);
    return;
  }
  if (report.startsWith('checkpoint:')) data = checkpointReport(bundles, { ...o, checkpoint: report.slice('checkpoint:'.length) });
  else {
    const reports = {
      summary: () => summary(bundles, o),
      pages: () => topPages(bundles, o),
      sources: () => trafficSources(bundles, o),
      clicks: () => clickReport(bundles, { ...o, pageUrl }),
      cwv: () => cwvReport(bundles, o),
      errors: () => errorReport(bundles, o),
      forms: () => formReport(bundles),
      reach: () => mediaReach(bundles, { ...o, checkpoint: 'viewblock' }),
      'reach-media': () => mediaReach(bundles, { ...o, checkpoint: 'viewmedia' }),
      flows: () => flows(bundles, { ...o, path: args.path }),
      experiments: () => experimentReport(bundles),
      checkpoints: () => checkpointReport(bundles, o),
      timeseries: () => timeSeries(realViews(bundles), { by: args.by === 'hour' ? 'hour' : 'day', series: { visits: (b) => (isVisit(b) ? b.weight : 0) } }),
      sample: () => bundles.slice(0, 3),
    };
    if (!reports[report]) throw new Error(`Unknown report "${report}" (see --help)`);
    data = reports[report]();
  }
  const out = {
    meta: {
      domain: args.domain || null, org: args.org || null, report, filter: { path: args.path || null, prefix: args.prefix || null, match: args.match || null, device: args.device || null }, granularity: res.granularity, start: res.start.toISOString(), end: res.end.toISOString(), files: res.files, failedFiles: res.failed.length, bundles: bundles.length, note: 'views are estimates: sampled bundles x weight; bots excluded',
    },
    data,
  };
  const text = JSON.stringify(out, null, 2);
  if (args.out) { const { writeFile } = await import('node:fs/promises'); await writeFile(args.out, `${text}\n`); } else process.stdout.write(`${text}\n`);
}

/* Run the CLI only when this file is executed directly (never in a browser, never on import). */
function invokedDirectly() {
  if (typeof process === 'undefined' || !process.argv?.[1] || typeof import.meta === 'undefined') return false;
  try {
    const self = decodeURIComponent(new URL(import.meta.url).pathname);
    const arg = process.argv[1].replace(/\\/g, '/');
    return self === arg || self.endsWith(`/${arg.replace(/^\.?\//, '')}`) || self.replace(/^\/([A-Za-z]:)/, '$1') === arg;
  } catch { return false; }
}

if (invokedDirectly()) {
  cli(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`\n${err.name === 'OptelError' ? '' : 'error: '}${redact(err.message || err)}\n`);
    process.exitCode = 1;
  });
}
