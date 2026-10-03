/* Run: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as optel from '../optel-client.js';

const PAGE = 'https://www.example.com/products/shoes';
let n = 0;
const bundle = (events, { url = PAGE, ua = 'mobile:ios', weight = 100, time = '2026-09-30T14:03:11.000Z' } = {}) => ({
  id: `b${n += 1}`, host: 'rum.hlx.page', url, userAgent: ua, weight, time, timeSlot: `${time.slice(0, 13)}:00:00.000Z`, events: [{ checkpoint: 'top' }, ...events],
});

const BUNDLES = [
  // paid Google search visit, clicked the hero CTA, good LCP
  bundle([{ checkpoint: 'enter', source: 'https://www.google.com/' }, { checkpoint: 'paid', source: 'google', target: 'gclid' },
    { checkpoint: 'utm', source: 'utm_medium', target: 'cpc' }, { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/cart' },
    { checkpoint: 'cwv-lcp', value: 1800, source: '.hero img' }, { checkpoint: 'redirect', target: '2:340' }]),
  // organic search visit, dead click, slow LCP
  bundle([{ checkpoint: 'enter', source: 'https://www.bing.com/' }, { checkpoint: 'click', source: '.cards .cards-card-body' },
    { checkpoint: 'cwv-lcp', value: 4200 }, { checkpoint: 'redirect', target: '1~800' }], { ua: 'desktop:windows' }),
  // direct visit, bounce, consent accept only
  bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'consent', source: 'onetrust', target: 'show' },
    { checkpoint: 'click', source: 'dialog button#onetrust-accept-btn-handler' }]),
  // ChatGPT visit
  bundle([{ checkpoint: 'enter', source: 'https://chatgpt.com/' }, { checkpoint: 'click', source: 'main button.add-to-cart' }]),
  // internal navigation from home, submits the newsletter form
  bundle([{ checkpoint: 'navigate', source: 'https://www.example.com/', target: 'visible' },
    { checkpoint: 'viewblock', source: '.newsletter form#signup' }, { checkpoint: 'fill', source: "form#signup input[type='email']" },
    { checkpoint: 'formsubmit', source: '.newsletter form#signup', target: 'https://www.example.com/subscribe' }]),
  // a 404 page reached from a blog post
  bundle([{ checkpoint: '404', source: 'https://www.example.com/blog/post' }, { checkpoint: 'error', source: 'f@https://www.example.com/x.js:1:2', target: 'TypeError: x' }], { url: 'https://www.example.com/old-page' }),
  // a bot: must never count
  bundle([{ checkpoint: 'enter', source: '' }], { ua: 'bot:crawler' }),
  // an un-activated prerender: must never count
  bundle([{ checkpoint: 'prerender', source: '' }]),
  // experiment variants
  bundle([{ checkpoint: 'experiment', source: 'hero-test', target: 'control' }, { checkpoint: 'navigate', source: 'https://www.example.com/' }], { url: 'https://www.example.com/' }),
  bundle([{ checkpoint: 'experiment', source: 'hero-test', target: 'challenger-1' }, { checkpoint: 'navigate', source: 'https://www.example.com/' }, { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/products/shoes' }], { url: 'https://www.example.com/' }),
];

test('urls and ranges', () => {
  assert.equal(optel.bundleUrl({ domain: 'www.example.com', domainKey: 'k', date: '2026-09-30T14:20:00Z' }), 'https://bundles.aem.page/bundles/www.example.com/2026/09/30/14?domainkey=k');
  assert.equal(optel.bundleUrl({ domain: 'www.example.com', domainKey: 'k', date: '2026-09-30', granularity: 'day' }), 'https://bundles.aem.page/bundles/www.example.com/2026/09/30?domainkey=k');
  assert.equal(optel.bundleUrl({ org: 'acme', domainKey: 'k', date: '2026-09-30', granularity: 'month' }), 'https://bundles.aem.page/orgs/acme/bundles/2026/09?domainkey=k');
  assert.equal(optel.planRange(optel.lastRange('7d')).slots.length, 168);
  assert.equal(optel.planRange(optel.lastRange('24h')).granularity, 'hour');
  assert.equal(optel.planRange(optel.lastRange('30d')).granularity, 'day');
  assert.equal(optel.planRange({ start: '2026-01-01', end: '2026-06-30', granularity: 'auto' }).granularity, 'month');
  assert.equal(optel.redact('https://x/?domainkey=secret&a=1'), 'https://x/?domainkey=***&a=1');
});

test('bundle helpers', () => {
  assert.equal(optel.normalizePath('/a/b/index'), '/a/b');
  assert.equal(optel.normalizePath('/a/b/?q=1'), '/a/b');
  assert.equal(optel.pathOf(BUNDLES[0]), '/products/shoes');
  assert.equal(optel.realViews(BUNDLES).length, 8, 'bot and prerender dropped');
  assert.deepEqual(optel.parseRedirect(BUNDLES[0]), { hops: 2, ms: 340, exact: true, from: '' });
  assert.deepEqual(optel.parseRedirect(BUNDLES[1]), { hops: 1, ms: 800, exact: false, from: '' });
  assert.equal(optel.rateCWV('lcp', 4200), 'poor');
  assert.equal(optel.rateCWV('lcp', 2500), 'good');
});

test('classification', () => {
  assert.equal(optel.classifyAcquisition(BUNDLES[0]).label, 'paid:search:google');
  assert.equal(optel.classifyAcquisition(BUNDLES[1]).label, 'earned:search:bing');
  assert.equal(optel.classifyAcquisition(BUNDLES[2]).label, 'earned:direct');
  assert.equal(optel.classifyAcquisition(BUNDLES[3]).label, 'earned:ai:chatgpt');
  assert.equal(optel.classifyAcquisition(BUNDLES[4]), null, 'internal views are not visits');
  assert.equal(optel.classifyReferrer('android-app://com.google.android.gm/').type, 'email');
  assert.equal(optel.classifyReferrer('https://www.example.com/x', 'www.example.com').type, 'internal');
  assert.equal(optel.classifyClick({ source: '.cards .cards-card-body' }, PAGE), 'dead');
  assert.equal(optel.classifyClick({ source: '.hero a', target: 'https://www.example.com/cart' }, PAGE), 'link');
  assert.equal(optel.classifyClick({ source: 'dialog button#onetrust-accept-btn-handler' }), 'consent');
  assert.equal(optel.classifyConsent('button#onetrust-reject-all-handler'), 'reject');
  assert.equal(optel.classifyClick({ source: "form#signup input[type='email']" }), 'form');
});

test('aggregation', () => {
  const g = optel.groupBy(optel.realViews(BUNDLES), (b) => optel.events(b, 'click').map((e) => e.source));
  assert.equal(g.find((r) => r.key === '.hero a').views, 200);
  assert.equal(optel.percentile([[1, 1], [2, 1], [3, 1], [4, 1]], 0.75), 3);
  assert.equal(optel.marginOfError(10000, 100), 1960);
  const c = optel.compareProportions(100, 1000, 150, 1000);
  assert.ok(c.significant && c.lift > 0.49 && c.lift < 0.51);
  const ts = optel.timeSeries(optel.realViews(BUNDLES), { by: 'hour' });
  assert.equal(ts.length, 1);
  assert.equal(ts[0].views, 800);
});

test('reports', () => {
  const s = optel.summary(BUNDLES);
  assert.equal(s.views, 800);
  assert.equal(s.visits, 400);
  assert.equal(s.botViews, 100);
  assert.equal(s.bounceRate, 0);
  assert.equal(s.cwv.lcp.samples, 2);
  assert.equal(s.errors.notFoundViews, 100);

  const shoes = BUNDLES.filter(optel.byPath('/products/shoes'));
  const clicks = optel.clickReport(shoes, { pageUrl: PAGE });
  assert.equal(clicks.elements.find((e) => e.source === '.cards .cards-card-body').kind, 'dead');
  assert.equal(clicks.consent[0].key, 'accept');

  const forms = optel.formReport(BUNDLES);
  assert.equal(forms[0].form, 'form#signup');
  assert.equal(forms[0].completionRate, 1);

  const errs = optel.errorReport(BUNDLES);
  assert.equal(errs.notFound[0].key, '/old-page');
  assert.equal(errs.notFound[0].from[0].referrer, 'https://www.example.com/blog/post');

  const f = optel.flows(BUNDLES, { path: '/' });
  assert.equal(f.next[0].key, '/products/shoes');

  const ex = optel.experimentReport(BUNDLES);
  assert.equal(ex[0].experiment, 'hero-test');
  assert.equal(ex[0].control, 'control');

  const sources = optel.trafficSources(BUNDLES);
  assert.equal(sources.ai[0].key, 'chatgpt');

  const cps = optel.checkpointReport(BUNDLES);
  assert.ok(cps.find((r) => r.checkpoint === 'click' && r.documented));
  JSON.stringify([s, clicks, forms, errs, f, ex, sources, cps, optel.cwvReport(BUNDLES, { minSamples: 1 }), optel.mediaReach(BUNDLES), optel.topPages(BUNDLES)]);
});

test('loadBundles: filter while loading, 404 slots are empty, 403 fails fast, key never leaks', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('domainkey=bad')) return { ok: false, status: 403, headers: new Map([['x-error', '[bundler] invalid domainkey param']]) };
    if (calls.length % 5 === 0) return { ok: false, status: 404, headers: new Map() };
    return { ok: true, status: 200, json: async () => ({ rumBundles: BUNDLES }) };
  };
  const res = await optel.loadBundles({
    domain: 'www.example.com', domainKey: 'good', last: '24h', fetch: fakeFetch, filter: optel.byPath('/products/shoes'), checkpoints: ['enter', 'click'],
  });
  assert.equal(res.files, 24);
  assert.equal(res.failed.length, 0);
  assert.ok(res.bundles.length > 0 && res.bundles.every((b) => optel.pathOf(b) === '/products/shoes'));
  assert.ok(res.bundles.every((b) => b.events.every((e) => ['enter', 'click'].includes(e.checkpoint))));

  await assert.rejects(
    optel.loadBundles({ domain: 'www.example.com', domainKey: 'bad', last: '24h', fetch: fakeFetch }),
    (err) => err.name === 'OptelError' && err.status === 403 && !err.url.includes('bad'),
  );
});

test('flows label back/forward and reload instead of unknown', () => {
  const b = [bundle([{ checkpoint: 'back_forward', source: '' }], { url: 'https://www.example.com/menu' }),
    bundle([{ checkpoint: 'reload', source: '' }], { url: 'https://www.example.com/menu' })];
  const keys = optel.flows(b, { path: '/menu' }).previous.map((r) => r.key).sort();
  assert.deepEqual(keys, ['(back/forward button)', '(reload)']);
});

test('clickReport: an element\'s targets come only from clicks on that element', () => {
  const b = [bundle([{ checkpoint: 'click', source: '#box' }, { checkpoint: 'click', source: '.nav a', target: 'https://www.example.com/other' }]),
    bundle([{ checkpoint: 'click', source: '#box' }])];
  const el = optel.clickReport(b, { pageUrl: PAGE }).elements.find((e) => e.source === '#box');
  assert.equal(el.kind, 'dead');
  assert.equal(el.targets.length, 0);
});

test('OneTrust buttons without an onetrust token are consent clicks', () => {
  assert.equal(optel.classifyConsent('dialog button#close-pc-btn-handler'), 'dismiss');
  assert.equal(optel.classifyConsent('dialog button#accept-recommended-btn-handler'), 'accept');
  assert.equal(optel.classifyConsent('dialog a.privacy-notice-link'), 'other');
});
