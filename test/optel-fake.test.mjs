/* Run: node --test test/optel-fake.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as optel from '../optel-client.js';
import * as fake from '../optel-fake.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const noNetwork = () => { throw new Error('no network in fake mode'); };
const START = '2026-09-01';
const END = '2026-09-15';
const load = (profile = true, o = {}) => optel.loadBundles({
  domain: 'www.example.com', start: START, end: END, granularity: 'hour', fake: profile, fetch: noNetwork, ...o,
});
const ids = (res) => res.bundles.map((b) => `${b.id}${b.time}`);

test('fake: no key, no network, every bundle marked', async () => {
  const res = await optel.loadBundles({ start: START, end: END, granularity: 'hour', fake: true, fetch: noNetwork });
  assert.equal(res.fake, true);
  assert.equal(res.failed.length, 0);
  assert.ok(res.bundles.length > 1000);
  assert.ok(res.bundles.every((b) => b.fake === true && new URL(b.url).hostname === 'www.example.com'));
  const s = optel.summary(res.bundles);
  assert.ok(s.botViews > 0 && s.views > s.botViews, 'bots are generated and kept out of views');
  assert.ok(s.bounceRate > 0.1 && s.bounceRate < 0.7);
});

test('fake: the same input gives the same bundles; another domain gives others', async () => {
  assert.deepEqual(ids(await load()), ids(await load()));
  const other = await load(true, { domain: 'shop.example.com' });
  assert.notDeepEqual(ids(other).slice(0, 50), ids(await load()).slice(0, 50));
  assert.ok(other.bundles.every((b) => b.url.startsWith('https://shop.example.com/')));
});

test('fake: day files hold the hours, month files a subsample at a higher weight', async () => {
  const views = (res) => optel.summary(res.bundles).views;
  const hour = views(await load());
  const day = views(await load(true, { granularity: 'day' }));
  assert.equal(day, hour);
  const month = await load(true, { granularity: 'month' });
  assert.ok(month.bundles.length < (await load()).bundles.length / 2);
  assert.ok(Math.abs(views(month) - hour) / hour < 0.25, `month ${views(month)} vs hour ${hour}`);
});

test('fake: nothing after now', async () => {
  const res = await optel.loadBundles({ last: '2d', fake: true, fetch: noNetwork });
  assert.ok(res.bundles.every((b) => new Date(b.time) <= new Date()));
});

test('fake scenarios show in their reports', async () => {
  const sc = (s, o) => fake.resolveProfile(true, { scenarios: s }).then((p) => load({ ...p, ...o }));
  const plain = (await load()).bundles;

  const ai = (await sc('ai-growth', { scenarios: [{ name: 'ai-growth', from: START, to: END }] })).bundles;
  const share = (bs) => optel.aiReferralReport(bs).ai.share;
  assert.ok(share(ai) > share(plain) * 1.5, `ai ${share(ai)} vs ${share(plain)}`);

  const dead = (await sc('dead-click-hotspot', { scenarios: [{ name: 'dead-click-hotspot', from: START, to: END }] })).bundles;
  assert.ok(optel.deadClickReport(dead).deadViewShare > optel.deadClickReport(plain).deadViewShare * 1.5);

  const exp = (await sc('experiment', { scenarios: [{ name: 'experiment', from: START, to: END }] })).bundles;
  const [row] = optel.experimentReport(exp);
  assert.ok(row && row.variants.length === 2);

  const agents = (await sc('agent-surge', { scenarios: [{ name: 'agent-surge', from: START, to: END }] })).bundles;
  assert.ok(optel.personalAgentReport(agents).views > optel.personalAgentReport(plain).views);

  assert.throws(() => fake.compileProfile({ scenarios: ['nope'] }), /nope/);
});

test('buildProfile reads the sitemap and the pages, skipping library and drafts', async () => {
  const site = 'https://main--site--org.aem.live';
  const pages = {
    '/query-index.json': null,
    '/sitemap.xml': `<urlset><url><loc>https://www.site.com/</loc></url><url><loc>https://www.site.com/pricing</loc></url>
      <url><loc>https://www.site.com/library/blocks/hero</loc></url><url><loc>https://www.site.com/drafts/x</loc></url></urlset>`,
    '/index.plain.html': '<div class="hero"><p><img src="./media_1a2b.png"></p><a href="/pricing?x=1&#x26;y=2">Pricing</a></div><div class="faq"><p>q</p></div>',
    '/pricing.plain.html': '<div class="columns"><a href="https://www.site.com/contact">Contact</a></div><form></form>',
    '/nav.plain.html': '<ul><li><a href="/pricing">Pricing</a></li></ul>',
    '/footer.plain.html': '<a href="/imprint">Imprint</a>',
  };
  const fetchImpl = async (url) => {
    const body = pages[new URL(url).pathname];
    return body == null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => body };
  };
  const p = await fake.buildProfile({ site, fetch: fetchImpl });
  assert.deepEqual(p.pages.map((x) => x.path).sort(), ['/', '/pricing']);
  const home = p.pages.find((x) => x.path === '/');
  assert.deepEqual(home.blocks.map((b) => b.name), ['hero', 'faq']);
  assert.ok(home.blocks[0].links.includes('/pricing'));
  assert.deepEqual(p.header, ['/pricing']);
  const res = await optel.loadBundles({ domain: 'www.site.com', start: START, end: '2026-09-03', fake: p, fetch: noNetwork });
  assert.ok(res.bundles.some((b) => b.events.some((e) => e.checkpoint === 'viewblock' && e.source === '.hero')));
});

test('CLI --fake needs no key and labels the output', () => {
  const env = { ...process.env };
  delete env.OPTEL_DOMAIN_KEY;
  delete env.OPTEL_FAKE;
  const out = JSON.parse(execFileSync(process.execPath, [path.join(root, 'optel-client.js'), '--fake', '--scenario', 'campaign', '--last', '3d', '--report', 'summary', '--quiet'], { env, encoding: 'utf8' }));
  assert.equal(out.meta.fake, true);
  assert.equal(out.meta.domain, 'www.example.com');
  assert.deepEqual(out.meta.scenarios, ['campaign']);
  assert.match(out.meta.fakeNote, /SYNTHETIC/);
  assert.throws(() => execFileSync(process.execPath, [path.join(root, 'optel-client.js'), '--domain', 'www.example.com', '--scenario', 'campaign'], { env, stdio: 'pipe' }), /needs --fake/);
});

test('fake-rollout.js tags fake homepage views for review.js and refuses real ones', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-rollout-'));
  const H = path.join(root, 'skills/homepage-cohorts');
  const rules = path.join(H, 'engine/cohort-rules.js');
  const { bundles } = await load(true, { start: '2026-08-01', end: END, filter: optel.byPath('/') });
  fs.writeFileSync(path.join(tmp, 'in.jsonl'), bundles.map((b) => JSON.stringify(b)).join('\n'));
  const run = (args) => execFileSync(process.execPath, [path.join(H, 'scripts/fake-rollout.js'), '--rules', rules, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const sum = JSON.parse(run(['--bundles', path.join(tmp, 'in.jsonl'), '--out', path.join(tmp, 'out.jsonl'), '--lift', '0.5']));
  assert.equal(sum.fake, true);
  const tagged = fs.readFileSync(path.join(tmp, 'out.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const aud = tagged.filter((b) => b.events.some((e) => e.checkpoint === 'audience'));
  assert.ok(aud.length > 100);
  const control = aud.filter((b) => b.events.find((e) => e.checkpoint === 'audience').target === 'control').length / aud.length;
  assert.ok(control > 0.05 && control < 0.15, `control ${control}`);
  assert.ok(sum.rules.some((r) => r.rule !== 'none'), 'some views match a cohort rule');

  fs.writeFileSync(path.join(tmp, 'real.jsonl'), JSON.stringify({ ...bundles[0], fake: undefined }));
  assert.throws(() => run(['--bundles', path.join(tmp, 'real.jsonl'), '--out', path.join(tmp, 'x.jsonl')]), /not fake/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
