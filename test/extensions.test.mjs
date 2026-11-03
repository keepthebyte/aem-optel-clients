/* Experience Workspace panels: rules, the Stardust brief, per-site settings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* the panels use localStorage; a Map stands in for it */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const EW = new URL('../extensions/experience-workspace/', import.meta.url);
const {
  deriveFindings, stardustBrief, cohorts, payloadFromInsights,
} = await import(new URL('improve-impact/rules.js', EW));
const { siteSettings, normalizeDomain, rememberDomain } = await import(new URL('shared/site.js', EW));
const {
  configure, analyze, isChrome, cohortSplit, dominantRule, emptyPageNote, partialPacer,
} = await import(new URL('shared/analyze.js', EW));
const { RULES } = await import('../optel-client.js');

const demo = JSON.parse(readFileSync(new URL('improve-impact/fixtures/demo-product-page.json', EW)));

test('demo fixture: content fixes, ranked cheapest first, each with a cohort', () => {
  const d = deriveFindings(demo);
  assert.deepEqual(d.actions.map((a) => a.id), ['dead-taps', 'no-touch', 'reach-cliff', 'translation']);
  d.actions.forEach((a) => assert.ok(a.cohort, `${a.id} has a cohort`));
  assert.match(d.actions.find((a) => a.id === 'no-touch').body, /\/shop\/trail-runner/, 'next step named from the most-followed link');
});

test('demo fixture: redesigns for the first screen and for tap affordance', () => {
  const d = deriveFindings(demo);
  assert.deepEqual(d.redesigns.map((r) => r.id), ['redesign-hero', 'redesign-affordance']);
  const cards = d.redesigns[1];
  assert.ok(!/hero/i.test(cards.area), 'the hero belongs to the first brief');
});

test('Stardust brief: starts the skill with the page URL and carries evidence and constraints', () => {
  const d = deriveFindings(demo);
  const brief = stardustBrief(d.redesigns[0], demo, { fixes: d.actions.map((a) => a.title) });
  assert.ok(brief.startsWith('/stardust:stardust Redesign the hero and first screen of https://www.example.com/products/trail-runner.'));
  for (const part of ['Why, from Optel telemetry', 'Who it has to work for:', 'Design goals:', 'Keep:', 'Measure it by:', 'Content fixes already queued']) {
    assert.ok(brief.includes(part), `brief has "${part}"`);
  }
  assert.match(brief, /stardust:deploy/);
});

test('no findings from an empty payload', () => {
  const d = deriveFindings({ page: { path: '/' }, metrics: {} });
  assert.equal(d.actions.length, 0);
  assert.equal(d.redesigns.length, 0);
});

test('site settings: URL wins and is remembered, per project and per host', () => {
  store.clear();
  assert.equal(normalizeDomain('https://WWW.Example.com/a/b'), 'www.example.com');
  const s = siteSettings(new URLSearchParams('domain=www.example.com&domainkey=k1&paid-medium=video|ctv'), 'org/site');
  assert.equal(s.domain, 'www.example.com');
  assert.equal(s.domainKey, 'k1');
  assert.equal(s.paidMedium, 'video|ctv');
  assert.equal(s.ai, false, 'AI section off by default');
  assert.equal(s.siteId, null);
  assert.equal(s.pageUrl('/x'), 'https://www.example.com/x');
  const again = siteSettings(new URLSearchParams(''), 'org/site');
  assert.equal(again.domain, 'www.example.com');
  assert.equal(again.domainKey, 'k1');
  assert.equal(siteSettings(new URLSearchParams(''), 'org/other').domain, '', 'another project asks again');
  rememberDomain('org/other', 'shop.example.org');
  assert.equal(siteSettings(new URLSearchParams(''), 'org/other').domainKey, null, 'keys are per host');
});

test('site settings: ai=on reads the Brand Visibility site id', () => {
  store.clear();
  const s = siteSettings(new URLSearchParams('domain=www.example.com&ai=on&site-id=abc'), 'org/site');
  assert.equal(s.ai, true);
  assert.equal(s.siteId, 'abc');
});

test('analyze: paid-medium setting extends the client rule and resets', () => {
  const before = RULES.paidMedium.source;
  configure({ paidMedium: 'video|ctv' });
  assert.ok(RULES.paidMedium.test('ctv'));
  configure({});
  assert.equal(RULES.paidMedium.source, before);
});

test('analyze: no bundles, no crash', () => {
  const r = analyze([], { pageUrl: 'https://www.example.com/', hours: [] });
  assert.equal(r.sample.views, 0);
});

/* bundles shaped like the bundler's: one sampled page view each */
let id = 0;
const view = (events, { ua = 'desktop:windows', weight = 100 } = {}) => ({
  id: `b${id += 1}`, url: 'https://www.example.com/', userAgent: ua, weight, time: '2026-11-01T10:00:00.000Z', timeSlot: '2026-11-01T10:00:00.000Z',
  events: [{ checkpoint: 'top' }, { checkpoint: 'enter', source: '' }, ...events],
});

test('site chrome: header, nav and footer are not content', () => {
  assert.equal(isChrome('header img'), true);
  assert.equal(isChrome('nav a.unav-headerNav__header-link'), true);
  assert.equal(isChrome('footer .links a'), true);
  assert.equal(isChrome('#image-dedd771f03-img img.cmp-image__image'), false);
  assert.equal(isChrome('main .hero img'), false);
  assert.equal(isChrome('.headerless img'), false);
});

test('analyze: the header logo is not the first image, header links are not the next step', () => {
  const logo = { checkpoint: 'viewmedia', source: 'header img', target: 'https://www.example.com/logo.svg' };
  const hero = { checkpoint: 'viewmedia', source: 'main .hero img', target: 'https://www.example.com/hero.jpg' };
  const account = { checkpoint: 'click', source: 'header a', target: 'https://www.example.com/account' };
  const shop = { checkpoint: 'click', source: 'main .hero a', target: 'https://www.example.com/shop' };
  const bundles = [
    ...Array.from({ length: 8 }, () => view([logo, account])),
    view([logo, hero, shop]), view([logo, hero, shop]),
  ];
  const r = analyze(bundles, { pageUrl: 'https://www.example.com/', hours: [] });
  assert.ok(r.reach.items.every((x) => !isChrome(x.source)), 'no chrome in the reach ladder');
  assert.equal(r.reach.items[0].source, 'main .hero img');
  assert.equal(r.reach.anyMediaShare, 0.2, 'views that saw a content image, not the logo');
  assert.equal(r.clicks.navigations[0].label, '/account', 'all links still listed');
  assert.equal(r.clicks.pageNavigations[0].label, '/shop', 'the page\'s own next step');
  const p = payloadFromInsights(r, { path: '/', url: 'https://www.example.com/' });
  assert.equal(p.metrics.topLink.label, '/shop');
});

test('cohorts: audience checkpoints per rule and arm, against the holdout', () => {
  const aud = (rule, arm) => [{ checkpoint: 'audience', source: rule, target: arm }, { checkpoint: 'experiment', source: 'homepage-cohorts', target: arm }];
  const click = { checkpoint: 'click', source: 'main a', target: 'https://www.example.com/shop' };
  const bundles = [
    ...Array.from({ length: 40 }, (_, i) => view([...aud('from-portal', 'challenger-1'), ...(i < 20 ? [click] : [])])),
    ...Array.from({ length: 5 }, (_, i) => view([...aud('from-portal', 'control'), ...(i < 1 ? [click] : [])])),
    ...Array.from({ length: 50 }, () => view(aud('none', 'challenger-1'), { ua: 'mobile:ios' })),
    view([]),
  ];
  const c = cohortSplit(bundles, { pageUrl: 'https://www.example.com/' });
  assert.equal(c.rules[0].rule, 'from-portal');
  assert.equal(c.rules.at(-1).rule, 'none', 'unmatched last');
  const [served, control] = c.rules[0].arms;
  assert.equal(served.arm, 'challenger-1'); assert.equal(control.arm, 'control');
  assert.equal(served.engagedShare, 0.5); assert.equal(control.engagedShare, 0.2);
  assert.equal(served.navigatedShare, 0.5);
  assert.equal(served.lowSample, false); assert.equal(control.lowSample, true);
  assert.equal(Math.round(c.coverage * 1000) / 1000, 0.99);
  assert.equal(c.experiments[0].id, 'homepage-cohorts');
  assert.equal(cohortSplit([view([])]), null, 'no audience checkpoint, no cohorts');
  // phones mostly carried no rule here: no rule is named for them
  assert.equal(dominantRule(bundles, (b) => b.userAgent.startsWith('mobile')), null);
  assert.equal(dominantRule(bundles, (b) => b.userAgent.startsWith('desktop')).rule, 'from-portal');
  const r = analyze(bundles, { pageUrl: 'https://www.example.com/', hours: [] });
  assert.equal(r.cohorts.rules.length, 2);
});

test('Improve Impact: cohort tags name the site\'s own cohort rule when there is one', () => {
  const p = { metrics: { mobileShare: 0.7, paidOrSocialShare: 0.6, cohortOf: { phone: { rule: 'mobile-first-visit', share: 0.8 }, ads: null } } };
  const c = cohorts(p);
  assert.match(c.phone.label, /mostly cohort mobile-first-visit/);
  assert.equal(c.phone.rule, 'mobile-first-visit');
  assert.doesNotMatch(c.ads.label, /cohort/);
});

test('Improve Impact: no sampled views, no findings (not "100% never touch")', () => {
  const r = analyze([], { pageUrl: 'https://www.example.com/new', hours: [] });
  const p = payloadFromInsights(r, { path: '/new', url: 'https://www.example.com/new' });
  const d = deriveFindings(p);
  assert.equal(d.empty, true);
  assert.equal(d.actions.length + d.redesigns.length + d.talking.length, 0);
});

test('empty page note: a cohort page is read on /', () => {
  assert.match(emptyPageNote('/new').join(' '), /cohort page.*recorded on \//);
  assert.doesNotMatch(emptyPageNote('/index').join(' '), /cohort page/, '/index is the homepage');
});

test('partial analyses are paced by their cost', () => {
  let t = 0; const pace = partialPacer({ minGap: 1000, factor: 5, now: () => t });
  assert.equal(pace.due(), true);
  pace.run(() => { t += 400; }); // an analysis that took 400 ms
  t += 1500; assert.equal(pace.due(), false, '1.5 s later: still under 5 x 400 ms');
  t += 600; assert.equal(pace.due(), true);
});
