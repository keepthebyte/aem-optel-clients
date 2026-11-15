/* Run: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as o from '../optel-client.js';
import * as merge from '../skills/site-merge/scripts/lib.js';
import {
  loadThemes, pathWords, themeMatcher, visitsByTheme, sharedBy, threeReads,
} from '../skills/brand-visibility/scripts/lib.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const skill = path.join(dir, '../skills/brand-visibility');
const rules = await merge.loadRules(path.join(dir, '../skills/site-merge/merge-rules.js'));
const themes = await loadThemes(path.join(skill, 'theme-rules.js'));
const [group, shop, pro] = rules.sites;

let n = 0;
const view = (host, p, { ref, ua = 'desktop:mac', weight = 100 } = {}) => {
  n += 1;
  return {
    id: `t${n}`,
    host,
    url: `https://${host}${p}`,
    userAgent: ua,
    weight,
    time: `2026-10-${String(1 + (n % 27)).padStart(2, '0')}T10:00:00.000Z`,
    events: [
      ...(ref === undefined ? [] : [{ checkpoint: 'enter', source: ref || '(direct)', timeDelta: 0 }]),
      { checkpoint: 'top', timeDelta: 1 },
    ],
  };
};
const times = (k, f) => Array.from({ length: k }, f);
const data = {
  group: [
    ...times(30, () => view(group.host, '/insights/cyber-risk-outlook.html', { ref: 'https://www.google.com/' })),
    ...times(10, () => view(group.host, '/insights/health-benefits-trends', { ref: 'https://chatgpt.com/' })),
    ...times(20, () => view(group.host, '/investors/results', { ref: '' })), // not about a subject
    ...times(5, () => view(group.host, '/insights/annual-review', { ref: '' })), // a subject, no theme
    ...times(9, () => view(group.host, '/insights/cyber-risk-outlook', {})), // inside the site: not a visit
    view(group.host, '/insights/cyber-risk-outlook', { ref: '', ua: 'bot:search' }),
  ],
  shop: [
    ...times(20, () => view(shop.host, '/products/health-plans', { ref: '' })),
    ...times(4, () => view(shop.host, '/products/personal-insurance', { ref: '' })),
  ],
  pro: [
    ...times(10, () => view(pro.host, '/services/employee-benefits', { ref: 'https://www.bing.com/' })),
  ],
};
const read = () => visitsByTheme(o, merge, rules, themes, (site) => data[site.id]);

test('themes: whole words of the path, first match wins, exclusions first', () => {
  const theme = themeMatcher(themes);
  assert.equal(pathWords('/en/Insights/Cyber-Risk_2026.html'), ' en insights cyber risk 2026 ');
  assert.equal(theme('/insights/cyber-risk-2026'), 'cyber'); // cyber before risk
  assert.equal(theme('/insights/ai-in-claims'), 'ai-data');
  assert.equal(theme('/insights/product-details'), undefined); // "ai" inside "details" is not AI
  assert.equal(theme('/services/paying-agents'), undefined); // "pay" inside "paying" is not pay
  assert.equal(theme('/services/personal-insurance'), 'excluded');
  assert.equal(theme('/services/property%20insurance'), 'risk');
});

test('read 1: visits by theme, per site, with what stays outside', async () => {
  const r = await read();
  assert.equal(r.meta.visits, 9900);
  assert.equal(r.meta.topical, 7900);
  assert.equal(r.meta.themed, 7000);
  assert.equal(r.meta.period.length, 24);
  assert.equal(r.themes.cyber.visits, 3000);
  assert.equal(r.themes.cyber.search, 3000);
  assert.deepEqual(r.themes.health.sites, { group: 1000, shop: 2000, pro: 1000 });
  assert.equal(r.themes.health.ai, 1000);
  assert.equal(sharedBy(r.themes.health), 3);
  assert.equal(sharedBy(r.themes.cyber), 1);
  assert.equal(r.unmatched.visits, 500);
  assert.equal(r.unmatched.top[0][0], '/insights/annual-review');
  assert.equal(r.excluded.visits, 400);
  assert.equal(r.themes.cyber.top[0][0], '/insights/cyber-risk-outlook.html');
  const shares = [...Object.values(r.themes), r.unmatched, r.excluded].reduce((a, t) => a + t.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);
});

test('the picture: the measured read joined with the written ones', async () => {
  const visits = await read();
  const reads = JSON.parse(fs.readFileSync(path.join(skill, 'reads.example.json'), 'utf8'));
  const d = threeReads(visits, reads);
  assert.equal(d.themes.length, reads.themes.length);
  assert.equal(d.themes[0].id, 'health');
  assert.equal(d.themes[0].visits, 4000);
  assert.equal(d.themes[0].label, 'Health and benefits');
  assert.deepEqual(d.themes[0].job, ['Defend']);
  assert.throws(() => threeReads(visits, { themes: [{ id: 'nope' }] }), /not in the theme rules/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-'));
  fs.writeFileSync(path.join(tmp, 'visits.json'), JSON.stringify(visits));
  fs.writeFileSync(path.join(tmp, 'reads.json'), JSON.stringify({ ...reads, note: '</script><b>x' }));
  execFileSync('node', [path.join(skill, 'scripts/three-reads.js'), '--visits', path.join(tmp, 'visits.json'), '--reads', path.join(tmp, 'reads.json'), '--out', tmp], { stdio: 'pipe' });
  const html = fs.readFileSync(path.join(tmp, 'three-reads.html'), 'utf8');
  assert.ok(!html.includes('/*DATA*/null'));
  assert.ok(html.includes('"firm":"Example Group"'));
  assert.equal(html.split('</script>').length, 2); // text from the reads file cannot close the script
});

test('scope, a one-theme site, and the theme of a homepage click', async () => {
  const click = (host, p, target) => { const b = view(host, p, { ref: '' }); b.events.push({ checkpoint: 'click', target, source: 'a', timeDelta: 900 }); return b; };
  const d = {
    group: [...times(4, () => click(group.host, '/', `https://${group.host}/insights/cyber-risk-outlook`)), ...times(3, () => view(group.host, '/de/insights/cyber-risk', { ref: '' }))],
    shop: [...times(5, () => view(shop.host, '/products/annual-plan', { ref: '' }))],
    pro: [],
  };
  const scoped = { ...rules, sites: rules.sites.map((s) => (s.id === 'group' ? { ...s, scope: '^/(?!de/)' } : s)) };
  const r = await visitsByTheme(o, merge, scoped, { ...themes, sites: { shop: 'health' } }, (site) => d[site.id]);
  assert.equal(r.themes.cyber.visits, 400); // homepage visits, by their click; /de is out of scope
  assert.equal(r.sites[0].outOfScope, 300);
  assert.equal(r.sites[0].visits, 400);
  assert.equal(r.themes.health.visits, 500); // the one-theme site
  assert.equal(r.unmatched.visits, 0);
});
