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
    domain: 'www.example.com', domainKey: 'good', last: '24h', fetch: fakeFetch, filter: optel.byPath('/products/shoes'), checkpoints: ['enter', 'click'], trim: false, // fixtures are not tied to slots
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

test('ranges: a bare end date is inclusive, and loads are trimmed to the window', async () => {
  const p = optel.planRange({ start: '2026-09-05', end: '2026-09-06', granularity: 'hour' });
  assert.equal(p.slots.length, 48, 'two whole days of hourly files');
  assert.equal(optel.planRange({ start: '2026-09-05', end: '2026-09-06', granularity: 'day' }).slots.length, 2);
  assert.equal(optel.planRange({ start: '2026-09-05T00:00:00Z', end: '2026-09-05T03:00:00Z', granularity: 'hour' }).slots.length, 3, 'ISO end is exclusive');
  const inside = bundle([], { time: '2026-09-05T10:00:00.000Z' });
  const before = bundle([], { time: '2026-09-04T23:59:00.000Z' });
  const after = bundle([], { time: '2026-09-07T00:00:01.000Z' });
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ rumBundles: [inside, before, after] }) });
  const res = await optel.loadBundles({
    domain: 'www.example.com', domainKey: 'k', start: '2026-09-05', end: '2026-09-06', granularity: 'month', fetch: fakeFetch,
  });
  assert.equal(res.files, 1);
  assert.deepEqual(res.bundles.map((b) => b.id), [inside.id], 'a monthly file is cut to the days asked for');
});

test('acquisition: real-world tagging seen on production domains', () => {
  const visit = (events, url = 'https://www.brand.com/') => bundle(events, { url });
  // ChatGPT ad (OpenAI click ids), with and without utm tags: paid AI, not a generic campaign
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'paid', source: 'openai', target: 'oppref' }, { checkpoint: 'paid', source: 'openai', target: 'olref' }])).label, 'paid:ai:chatgpt');
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'paid', source: 'openai', target: 'oppref' },
    { checkpoint: 'utm', source: 'utm_source', target: 'openai' }, { checkpoint: 'utm', source: 'utm_medium', target: 'paid_openai' }])).label, 'paid:ai:chatgpt');
  // ChatGPT citation: earned AI
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'utm', source: 'utm_source', target: 'chatgpt.com' }])).label, 'earned:ai:chatgpt');
  // Facebook ad that also carries a DV360 dclid: Facebook, not Google
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: 'http://m.facebook.com/' }, { checkpoint: 'paid', source: 'doubleclick', target: 'dclid' }, { checkpoint: 'paid', source: 'facebook', target: 'fbclid' },
    { checkpoint: 'utm', source: 'utm_source', target: 'Facebook' }, { checkpoint: 'utm', source: 'utm_medium', target: 'Paid_Social' }])).label, 'paid:social:facebook');
  // YouTube ad with Google click ids: video on YouTube
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'paid', source: 'google', target: 'gbraid' },
    { checkpoint: 'utm', source: 'utm_source', target: 'YouTube' }, { checkpoint: 'utm', source: 'utm_medium', target: 'Video' }])).label, 'paid:video:youtube');
  // brand suffix convention: _p paid, _o owned
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'utm', source: 'utm_source', target: 'social_p' }, { checkpoint: 'utm', source: 'utm_medium', target: 'social' }])).label, 'paid:social');
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'utm', source: 'utm_source', target: 'packaging_o' }, { checkpoint: 'utm', source: 'utm_medium', target: 'ooh' }, { checkpoint: 'utm', source: 'utm_content', target: 'qr' }])).label, 'owned:ooh:packaging');
  // the brand's own SSO subdomain is not a referral
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: 'https://login.emea.brand.com/' }], 'https://www.brand.com/us/en')).label, 'owned:internal:login.emea.brand.com');
  assert.equal(optel.registrableDomain('shop.brand.co.uk'), 'brand.co.uk');
});

test('activity ladder, scroll evidence, dead taps, selectors', () => {
  const t = (cp, timeDelta, extra = {}) => ({ checkpoint: cp, timeDelta, ...extra });
  const nothing = bundle([t('enter', 10, { source: '' }), t('viewmedia', 20, { source: '.hero img' }), t('viewmedia', 25, { source: '.logo img' })]);
  const consentOnly = bundle([t('enter', 10, { source: '' }), t('click', 900, { source: 'dialog button#onetrust-accept-btn-handler' })]);
  const scrolledView = bundle([t('enter', 10, { source: '' }), t('viewmedia', 20, { source: '.hero img' }), t('viewblock', 4000, { source: '.cards' })]);
  const interacted = bundle([t('enter', 10, { source: '' }), t('click', 3000, { source: '#teaser-f822f861a9 .cmp-teaser__content' }), t('click', 3300, { source: '#teaser-f822f861a9 .cmp-teaser__content' })]);
  const navigated = bundle([t('enter', 10, { source: '' }), t('click', 5000, { source: '.hero a', target: 'https://www.example.com/cart' })]);
  assert.deepEqual([nothing, consentOnly, scrolledView, interacted, navigated].map((b) => optel.activityOf(b)), optel.ACTIVITY_LEVELS);
  assert.equal(optel.scrolled(nothing), false);
  assert.equal(optel.timeTo(navigated, 'click'), 4990, 'no timed top beacon in the fixture: measured from the first timed event');
  assert.equal(optel.normalizeSelector('#promoPlusInstantWin-id-5dd86ae84b button.button-primary'), '#promoPlusInstantWin-id-* button.button-primary');
  assert.equal(optel.normalizeSelector('#teaser-cb94bd580f a#teaser-cb94bd580f-cta-0c20b31195'), '#teaser-* a#teaser-*-cta-*');
  assert.equal(optel.normalizeSelector('.cards .default-content'), '.cards .default-content');
  const a = optel.activityReport([nothing, consentOnly, scrolledView, interacted, navigated]);
  assert.equal(a.overall.navigated, 0.2);
  const d = optel.deadClickReport([interacted, navigated]);
  assert.equal(d.elements[0].key, '#teaser-* .cmp-teaser__content');
  assert.equal(d.repeatShare, 1, 'two taps on the same dead element');
});

test('AI referrals split organic and ads; redirects grouped by network', () => {
  const v = (events, extra) => bundle([{ checkpoint: 'enter', source: '' }, ...events], extra);
  const B = [
    v([{ checkpoint: 'utm', source: 'utm_source', target: 'chatgpt.com' }, { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/x' }], { url: 'https://www.example.com/a' }),
    v([{ checkpoint: 'paid', source: 'openai', target: 'oppref' }], { url: 'https://www.example.com/a' }),
    bundle([{ checkpoint: 'enter', source: 'https://www.google.com/' }, { checkpoint: 'redirect', target: '2:900' }], { url: 'https://www.example.com/b' }),
    bundle([{ checkpoint: 'enter', source: 'https://www.google.com/' }, { checkpoint: 'paid', source: 'google', target: 'gclid' }, { checkpoint: 'redirect', target: '1~400' }], { url: 'https://www.example.com/b' }),
  ];
  const r = optel.aiReferralReport(B);
  assert.deepEqual(r.segments.map((s) => s.segment).sort(), ['chatgpt:ad', 'chatgpt:organic']);
  assert.equal(r.ai.share, 0.5);
  assert.deepEqual(r.landing.searchOnly.map((x) => x.key), ['/b']);
  assert.equal(r.landing.aiAds[0].key, '/a');
  const red = optel.redirectReport(B);
  assert.equal(red.overall.redirectedShare, 0.5);
  assert.ok(red.groups.some((g) => g.key === 'paid:google' && g.redirectedShare === 1));
  const cmp = optel.comparePeriods(B.slice(0, 2), B.slice(2), { metrics: { redirected: (b) => optel.has(b, 'redirect') } });
  assert.equal(cmp.metrics.redirected.a, 0);
  assert.equal(cmp.metrics.redirected.b, 1);
});

test('loadBundles: a file over the 6 MB limit (413) is loaded as its days instead', async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url.replace(/\?.*/, ''));
    if (/\/2026\/02\?/.test(url)) return { ok: false, status: 413, headers: new Map([['x-error', '[bundler] Response payload size exceeded maximum allowed payload size (6000000 bytes).']]) };
    const m = /\/(\d{4})\/(\d{2})(?:\/(\d{2}))?\?/.exec(url);
    return { ok: true, status: 200, json: async () => ({ rumBundles: [bundle([], { time: `${m[1]}-${m[2]}-${m[3] || '15'}T12:00:00.000Z` })] }) };
  };
  const res = await optel.loadBundles({
    domain: 'www.example.com', domainKey: 'k', start: '2026-01-01', end: '2026-03-31', granularity: 'month', fetch: fakeFetch,
  });
  assert.equal(res.failed.length, 0);
  assert.equal(res.split, 1);
  assert.equal(res.bundles.length, 2 + 28, 'Jan and Mar from monthly files, February from 28 daily files');
  assert.ok(seen.includes('https://bundles.aem.page/bundles/www.example.com/2026/02/28'));
});

test('review fixes: syndicated search ads, utm order, weighted lift, selectors, shared hosts', () => {
  const visit = (events) => bundle(events, { url: 'https://www.brand.com/' });
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: 'https://duckduckgo.com/' }, { checkpoint: 'paid', source: 'microsoft', target: 'msclkid' }])).label, 'paid:search:microsoft');
  assert.equal(optel.classifyAcquisition(visit([{ checkpoint: 'enter', source: '' }, { checkpoint: 'utm', source: 'utm_source', target: 'newsletter' }, { checkpoint: 'utm', source: 'utm_content', target: 'hero_banner' }])).label, 'owned:email:newsletter');
  const A = [bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: '.a a', target: 'https://x/' }], { weight: 1000 }), bundle([{ checkpoint: 'enter', source: '' }], { weight: 100 })];
  const B = [bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: '.a a', target: 'https://x/' }], { weight: 100 }), bundle([{ checkpoint: 'enter', source: '' }], { weight: 1000 })];
  const c = optel.comparePeriods(A, B, { metrics: { clicked: (b) => optel.has(b, 'click') } }).metrics.clicked;
  assert.ok(c.a > 0.9 && c.b < 0.1 && c.lift < -0.8, 'lift follows the weighted rates');
  assert.equal(optel.normalizeSelector('.card-decade1'), '.card-decade1');
  assert.equal(optel.normalizeSelector('#uuid-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d a'), '#uuid-* a');
  assert.equal(optel.registrableDomain('main--site--org.aem.live'), 'main--site--org.aem.live');
  assert.equal(optel.registrableDomain('192.168.0.1'), '192.168.0.1');
  assert.equal(optel.activityOf(bundle([{ checkpoint: 'click', source: '""' }])), 'nothing');
  const r = optel.redirectReport([bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'redirect', target: 'odd' }])]);
  assert.equal(r.byDelay[0].key, 'unknown');
});

test('consent: Tealium prompt and generic cookie banners; form consent checkboxes are not banners', () => {
  assert.equal(optel.classifyConsent('dialog button#consent_prompt_submit'), 'accept');
  assert.equal(optel.classifyConsent('dialog button#consent_prompt_decline'), 'reject');
  assert.equal(optel.classifyConsent('#__tealiumGDPRecModal'), 'other');
  assert.equal(optel.classifyConsent('.cookie-banner button.accept-all'), 'accept');
  assert.equal(optel.classifyConsent("form#newsletter input#consent"), null);
  assert.equal(optel.classifyConsent('#notifyMe-d8c2e7ec3a #input-generalConsent'), null, 'a signup checkbox outside a <form> token');
  assert.equal(optel.classifyClick({ source: "form#newsletter input#consent" }), 'form');
  assert.equal(optel.classifyConsent('.cmp-button'), null, 'cmp- is the AEM core components prefix, not a CMP');
  assert.equal(optel.classifyConsent('dialog button.cc-btn.cc-allow'), 'accept', 'Osano cookieconsent');
  assert.equal(optel.classifyConsent('#cookie-notice button#cn-accept-cookie'), 'accept');
  assert.equal(optel.classifyConsent('#gdpr-banner button.reject'), 'reject');
  // content that merely mentions cookies or consent is not a banner (food and legal sites)
  for (const s of ['.cards a#cookie-recipes', '#cookies-and-cream .cmp-teaser__content', '.product-grid a.cookie-dough',
    'main a.gdpr-guide-download', '.article #consent-decree-faq a', 'footer a.cookie-policy', '.hero button.cookie-flavour']) {
    assert.equal(optel.classifyConsent(s), null, s);
  }
  const v = bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: 'dialog button#consent_prompt_submit' }]);
  assert.equal(optel.activityOf(v), 'consent-only');
});

test('flows: a click on an image or file is not a next page', () => {
  const b = [bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: 'header img', target: 'https://www.example.com/content/dam/logo.svg' },
    { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/contact' }], { url: 'https://www.example.com/' })];
  assert.deepEqual(optel.flows(b, { path: '/' }).next.map((r) => r.key), ['/contact']);
});

test('small-site fixes: text clicks, click resolution, messaging/dev referrers, rounding, low samples', () => {
  assert.equal(optel.classifyClick({ source: '.code-sample .hljs' }), 'text');
  assert.equal(optel.classifyClick({ source: 'pre' }), 'text');
  assert.equal(optel.classifyClick({ source: '.cards .cards-card-body' }), 'dead');
  assert.equal(optel.clickResolution('.default-content-wrapper'), 'block');
  assert.equal(optel.clickResolution('.product-list'), 'block');
  assert.equal(optel.clickResolution('.cards .cards-card-body'), 'element');
  assert.equal(optel.clickResolution('main .section-wrapper'), 'block');
  assert.equal(optel.classifyReferrer('https://teams.microsoft.com/').type, 'messaging');
  assert.equal(optel.classifyReferrer('https://app.slack.com/client/T1').type, 'messaging');
  assert.equal(optel.classifyReferrer('http://localhost:3000/').type, 'dev');
  assert.equal(optel.classifyReferrer('android-app://com.google.android.googlequicksearchbox/').host, 'google.com', 'same host as the web referrer');
  const v = (src) => bundle([{ checkpoint: 'enter', source: src }]);
  assert.equal(optel.classifyAcquisition(v('http://localhost:3000/')).label, 'owned:dev:localhost');
  assert.equal(optel.classifyAcquisition(v('https://teams.microsoft.com/')).channel, 'messaging');
  assert.deepEqual(optel.cwvOf(bundle([{ checkpoint: 'cwv-ttfb', value: 134.69999999995343 }, { checkpoint: 'cwv-cls', value: 0.0782205 }])), { lcp: null, cls: 0.0782, inp: null, ttfb: 135 });
  const few = [bundle([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: '.product-list' }])];
  assert.equal(optel.activityReport(few).groups[0].lowSample, true);
  const d = optel.deadClickReport(few);
  assert.equal(d.elements[0].resolution, 'block');
  assert.equal(d.elementDeadViewShare, 0);
  assert.equal(d.deadViewShare, 1);
  assert.ok(optel.errorReport([bundle([{ checkpoint: 'error', source: 'undefined error' }])]).jsErrors[0].key.startsWith('(no message) @'));
});
