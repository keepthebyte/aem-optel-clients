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
const { deriveFindings, stardustBrief } = await import(new URL('improve-impact/rules.js', EW));
const { siteSettings, normalizeDomain, rememberDomain } = await import(new URL('shared/site.js', EW));
const { configure, analyze } = await import(new URL('shared/analyze.js', EW));
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
