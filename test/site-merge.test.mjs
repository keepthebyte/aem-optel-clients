/* Run: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as o from '../optel-client.js';
import {
  needMatcher, classifyVisit, siteCohorts, mergeSites, redirected, loadRules,
} from '../skills/site-merge/scripts/lib.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const skill = path.join(dir, '../skills/site-merge');
const rules = await loadRules(path.join(skill, 'merge-rules.js'));
const [group, shop, pro] = rules.sites;

let n = 0;
/** One sampled view: `ref` = entered from there ('' direct, undefined = came from inside the site). */
const view = (host, p, { ref, clicks = [], ua = 'desktop:mac', weight = 100 } = {}) => {
  n += 1;
  return {
    id: `b${n}`,
    host,
    url: `https://${host}${p}`,
    userAgent: ua,
    weight,
    time: `2026-10-${String(1 + (n % 27)).padStart(2, '0')}T10:00:00.000Z`,
    events: [
      ...(ref === undefined ? [] : [{ checkpoint: 'enter', source: ref || '(direct)', timeDelta: 0 }]),
      { checkpoint: 'top', timeDelta: 1 },
      ...clicks.map((target, i) => ({ checkpoint: 'click', target, source: 'a', timeDelta: 1000 + i })),
    ],
  };
};
const times = (k, f) => Array.from({ length: k }, f);

test('needs: first match wins, on path segments', () => {
  const need = needMatcher(rules);
  assert.equal(need('/careers/roles'), 'careers');
  assert.equal(need('/sign-in'), 'client');
  assert.equal(need('/insights/designing-for-2035'), 'insights'); // "designing" is not a sign-in
  assert.equal(need('/insights/privacy-law-update'), 'insights'); // research before notices
  assert.equal(need('/privacy-notice'), 'legal');
  assert.equal(need('/something-else'), undefined);
});

test('a visit: need from the landing page, a homepage takes the need of its first click', () => {
  const v = (b, site = shop) => classifyVisit(o, rules, site, b);
  assert.equal(v(view(shop.host, '/products/a', { ref: 'https://www.google.com/' })).need, 'solutions');
  assert.equal(v(view(shop.host, '/products/a', { ref: 'https://www.google.com/' })).channel, 'search');
  assert.deepEqual(
    (({ need, viaHome }) => ({ need, viaHome }))(v(view(shop.host, '/', { ref: '', clicks: ['https://www.example-shop.com/careers'] }))),
    { need: 'careers', viaHome: true },
  );
  assert.equal(v(view(shop.host, '/', { ref: '' })).need, 'home');
  assert.equal(v(view(shop.host, '/zzz', { ref: '' })).need, 'other');
  // cross-site: a click to another merging site; its careers subdomain is careers, not cross-sell
  assert.equal(v(view(shop.host, '/products/a', { ref: '', clicks: ['https://www.example-pro.com/services/x'] })).cross, true);
  assert.equal(v(view(shop.host, '/products/a', { ref: '', clicks: ['https://careers.example-pro.com/'] })).cross, false);
  assert.equal(v(view(shop.host, '/products/a', { ref: '', clicks: ['https://www.example-shop.com/contact'] })).cross, false);
});

test('each site on its own, then merged by need, per layer', async () => {
  const data = {
    group: [
      ...times(40, () => view(group.host, '/', { ref: '' })),
      ...times(40, () => view(group.host, '/investors/results', { ref: 'https://www.google.com/' })),
      ...times(20, () => view(group.host, '/insights/a', { ref: 'https://chatgpt.com/' })),
      ...times(50, () => view(group.host, '/about', {})), // inside the site: not a visit
      view(group.host, '/insights/a', { ref: '', ua: 'bot:search' }),
    ],
    shop: [
      ...times(60, (_, i) => view(shop.host, '/products/a', { ref: 'https://www.google.com/', clicks: i < 6 ? ['https://www.example.com/insights/a'] : [] })),
      ...times(40, () => view(shop.host, '/insights/b', { ref: '' })),
    ],
    pro: [
      ...times(70, () => view(pro.host, '/careers', { ref: 'https://www.google.com/' })),
      ...times(30, () => view(pro.host, '/insights/c', { ref: '' })),
      ...times(5, () => view(pro.host, '/services/x', { ref: '' })),
    ],
  };
  const sites = [];
  for (const s of rules.sites) sites.push(await siteCohorts(o, rules, s, data[s.id]));
  const [g, sh, pr] = sites;
  assert.equal(g.visits, 10000); // 100 visits x weight 100; internal views and the bot are out
  assert.equal(g.views, 15000);
  const cohort = (site, layer, need) => site.layers[layer].cohorts.find((c) => c.need === need);
  assert.equal(cohort(g, 'all', 'home').share, 0.4);
  assert.equal(cohort(g, 'all', 'investors').share, 0.4);
  assert.equal(g.layers.seo.shareOfSite, 0.4);
  assert.equal(cohort(g, 'seo', 'investors').share, 1);
  assert.equal(g.layers.geo.cohorts[0].need, 'insights');
  assert.equal(cohort(sh, 'all', 'solutions').cross, 0.1);
  assert.equal(cohort(pr, 'all', 'solutions').lowSample, true);
  assert.equal(cohort(pr, 'all', 'careers').topPages[0].path, '/careers');

  const merged = mergeSites(rules, sites);
  const all = merged.layers.find((l) => l.id === 'all');
  const aud = (layer, id) => layer.audiences.find((a) => a.id === id);
  assert.equal(merged.meta.visits, 30500);
  assert.equal(all.visits, 30500);
  // research: three sites bring it → shared; investors: one site → kept, not shared
  assert.deepEqual([aud(all, 'insights').sites, aud(all, 'insights').shared], [2, true]); // group's 20 are a low sample
  assert.equal(aud(all, 'insights').from.length, 3);
  assert.equal(aud(all, 'insights').visits, 9000);
  assert.deepEqual([aud(all, 'investors').sites, aud(all, 'investors').shared], [1, false]);
  assert.equal(aud(all, 'solutions').shared, false); // pro's 5 visits are a low sample
  assert.ok(Math.abs(aud(all, 'solutions').cross - 600 / 6500) < 1e-9);
  assert.ok(Math.abs(all.cross - 600 / 30500) < 1e-9);
  // each site counting the same: careers is 67% of one site, a third of that on average
  assert.ok(Math.abs(aud(all, 'careers').shareEvenSites - (70 / 105) / 3) < 1e-9);
  assert.deepEqual(all.audiences.map((a) => a.id), ['solutions', 'insights', 'home', 'careers', 'investors']);
  const seo = merged.layers.find((l) => l.id === 'seo');
  assert.equal(seo.visits, 17000);
  assert.deepEqual(seo.audiences.map((a) => a.id), ['solutions', 'careers', 'investors']);
  assert.equal(merged.layers.find((l) => l.id === 'geo').lowSample, true);
});

test('as redirected: an old homepage view arrives on the target from the old site', () => {
  const b = view(shop.host, '/?utm_source=x', { ref: 'https://www.google.com/', clicks: ['https://www.example-shop.com/contact'] });
  const r = redirected(b, shop, group);
  assert.equal(r.url, 'https://www.example.com/?utm_source=x');
  assert.equal(o.referrerOf(r), 'https://www.example-shop.com/');
  assert.equal(r.events.filter((e) => e.checkpoint === 'click').length, 1);
  assert.equal(o.referrerOf(b), 'https://www.google.com/'); // the original is untouched
  assert.equal(redirected(b, group, group), b);
  const inside = view(shop.host, '/', {});
  assert.equal(o.referrerOf(redirected(inside, shop, group)), null);
});

test('the steps run end to end and the Sankey carries the data', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-merge-'));
  const write = (id, list) => fs.writeFileSync(path.join(tmp, `${id}-site.jsonl`), `${list.map((b) => JSON.stringify(b)).join('\n')}\n`);
  write('group', times(40, () => view(group.host, '/', { ref: '' })));
  write('shop', times(40, () => view(shop.host, '/products/a', { ref: 'https://www.google.com/' })));
  write('pro', times(40, () => view(pro.host, '/index.html', { ref: '', clicks: ['https://www.example-pro.com/services/x'] })));
  const run = (script, ...a) => execFileSync('node', [path.join(skill, 'scripts', script), '--rules', path.join(skill, 'merge-rules.js'), ...a], { stdio: ['ignore', 'ignore', 'pipe'] });
  run('site-cohorts.js', '--data', tmp, '--out', tmp);
  run('merge.js', '--out', tmp);
  run('sankey.js', '--out', tmp);
  const merged = JSON.parse(fs.readFileSync(path.join(tmp, 'merged.json'), 'utf8'));
  assert.equal(merged.layers[0].audiences.find((a) => a.id === 'solutions').from.length, 2);
  const html = fs.readFileSync(path.join(tmp, 'sankey.html'), 'utf8');
  assert.ok(html.includes('<title>Three sites, one front door</title>'));
  assert.ok(!html.includes('/*DATA*/null') && html.includes('"audiences"'));
  run('as-redirected.js', '--data', tmp, '--out', tmp);
  const home = fs.readFileSync(path.join(tmp, 'merged-home.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(home.length, 80); // group's and pro's homepages; shop's product page is not one
  assert.ok(home.every((b) => b.url.startsWith('https://www.example.com/')));
  // pull.js refuses to run without a key per site, and names the variables
  assert.throws(() => execFileSync('node', [path.join(skill, 'scripts/pull.js'), '--rules', path.join(skill, 'merge-rules.js'), '--data', tmp, '--last', '7d'], { stdio: 'pipe', env: { PATH: process.env.PATH } }), /OPTEL_DOMAIN_KEY_GROUP, OPTEL_DOMAIN_KEY_SHOP, OPTEL_DOMAIN_KEY_PRO/);
  fs.rmSync(tmp, { recursive: true });
});
