/* Run: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as o from '../optel-client.js';
import { reduce, readFetches, joinFetches, dataScript } from '../skills/data-report/scripts/lib.js';

// Invented numbers, the shapes of brand-visibility, homepage-cohorts and the fetch join.
const reads = {
  scope: 'US, all AI engines, November 2026',
  states: { lead: 'Example leads', comp: 'A competitor leads', open: 'Open' },
  themes: [
    { id: 'home', state: 'lead', prompts: 3000000, asked: 'Example 1,200. Peer 300.', wanted: '', attempts: 800, job: ['Defend'], experience: 'a proposal' },
    { id: 'pet', state: 'comp', prompts: 2000000, asked: 'Example Pets 812. Peer 2,255.', wanted: 'Named growth area (2025)', attempts: 24, job: ['Win'], experience: 'a proposal' },
  ],
};
const visits = {
  meta: { period: '2026-09-14 to 2026-11-13', visits: 100000, topical: 40000, themed: 30000 },
  sites: [{ id: 'www', name: 'example.com', visits: 70000 }, { id: 'pets', name: 'Example Pets', visits: 30000 }],
  themes: {
    home: { label: 'Home', visits: 10000, search: 8000, ai: 50, sites: { www: 10000 } },
    pet: { label: 'Pet health', visits: 20000, search: 9000, ai: 30, sites: { www: 500, pets: 19500 } },
  },
};
const cohorts = {
  meta: { domain: 'www.example.com', path: '/', start: '2026-10-01T00:00:00Z', end: '2026-10-29T00:00:00Z', views: 50000, bundles: 500 },
  columns: [
    { head: 'Entry source', nodes: [{ id: 'e:direct', label: 'Direct', views: 30000 }, { id: 'e:search', label: 'Search', views: 20000 }] },
    { head: 'Device', nodes: [{ id: 'd:desktop', label: 'Desktop', views: 30000 }, { id: 'd:mobile', label: 'Mobile', views: 20000 }] },
    { head: 'Rule', nodes: [{ id: 'r:none', label: 'No rule matched', views: 50000 }] },
    { head: 'Experience', nodes: [{ id: 'x:default', label: 'Original homepage', views: 50000 }] },
  ],
  links: [
    { s: 'e:direct', t: 'd:desktop', signal: 'none', views: 30000 }, { s: 'e:search', t: 'd:mobile', signal: 'none', views: 20000 },
    { s: 'd:desktop', t: 'r:none', signal: 'none', views: 30000 }, { s: 'd:mobile', t: 'r:none', signal: 'none', views: 20000 },
    { s: 'r:none', t: 'x:default', signal: 'none', views: 50000 },
  ],
  rules: [
    { id: 'none', label: 'No rule matched', signal: 'none', modelled: false, views: 50000, share: 1, bundles: 500, today: { goalRate: 0.1, didNothing: 0.5 } },
    { id: 'empty', label: 'Never fires', signal: 'link', modelled: false, views: 0, share: 0, bundles: 0, today: {} },
  ],
  experiences: [{ id: 'default', label: 'Original homepage', views: 50000 }],
  today: { didNothing: 0.5, navigated: 0.2, topClicks: [{ click: 'header a', link: true, share: 0.3, bundles: 150 }], devices: [{ key: 'mobile', share: 0.4 }] },
};

function workspace(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-report-'));
  fs.writeFileSync(path.join(dir, 'reads.json'), JSON.stringify(reads));
  fs.writeFileSync(path.join(dir, 'visits.json'), JSON.stringify(visits));
  fs.writeFileSync(path.join(dir, 'cohorts.json'), JSON.stringify(cohorts));
  return { dir, cfg: { customer: 'Example Insurance', short: 'Example', reads: 'reads.json', visits: 'visits.json', ...extra } };
}

test('reduce joins the reads by theme and leaves the plan out', () => {
  const { dir, cfg } = workspace({ cohorts: [{ file: 'cohorts.json', title: 'Homepage', conversion: 'Start a quote' }] });
  const d = reduce(cfg, dir);
  assert.deepEqual(d.reads.themes.map((t) => [t.id, t.label, t.visits, t.prompts, t.attempts]), [['home', 'Home', 10000, 3000000, 800], ['pet', 'Pet health', 20000, 2000000, 24]]);
  const js = dataScript(d);
  assert.ok(!/a proposal|Defend|"job"|experience|Original homepage/.test(js), 'no job, experience or cohort experience in the data');
  assert.equal(d.cohorts[0].rules.length, 1, 'rules that never fire are dropped');
  assert.deepEqual(d.cohorts[0].links.map((l) => `${l.s}>${l.t}`).sort(), ['d:desktop>r:none', 'd:mobile>r:none', 'e:direct>d:desktop', 'e:search>d:mobile']);
  assert.equal(d.cohorts[0].conversion, 'Start a quote');
  assert.equal(d.cfg.subtitle, 'about how people and AI find Example');
});

test('coverage is conservative: a stage is collected only when its input is there', () => {
  const { dir, cfg } = workspace();
  const st = Object.fromEntries(reduce(cfg, dir).coverage.map((r) => [r.id, r.status]));
  assert.equal(st.topics, 'collected');
  assert.equal(st.mentions, 'directional');
  assert.equal(st.attempts, 'none', 'no fetch join, no citation attempts');
  assert.equal(st.conversions, 'none', 'no cohort with a named conversion');
  const over = workspace({ coverage: { citations: { status: 'partial', text: 'Checked by hand for ten prompts.' } } });
  const row = reduce(over.cfg, over.dir).coverage.find((r) => r.id === 'citations');
  assert.deepEqual([row.status, row.text], ['partial', 'Checked by hand for ten prompts.']);
  const bad = workspace({ coverage: { citations: { status: 'done' } } });
  assert.throws(() => reduce(bad.cfg, bad.dir), /must be one of/);
});

test('reduce says what is missing', () => {
  const { dir } = workspace();
  assert.throws(() => reduce({ reads: 'reads.json', visits: 'visits.json' }, dir), /customer/);
  assert.throws(() => reduce({ customer: 'X', reads: 'reads.json' }, dir), /visits/);
  fs.writeFileSync(path.join(dir, 'visits.json'), JSON.stringify({ ...visits, themes: { home: visits.themes.home } }));
  assert.throws(() => reduce({ customer: 'X', reads: 'reads.json', visits: 'visits.json' }, dir), /"pet" is in reads.json but not in visits-by-theme.json/);
});

test('the fetch join counts attempts per page and section, with visits on the same days', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-report-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), '/|100|ChatGPT-User|99|Other\n/personal/home.html|40|ChatGPT-User|100|Insurance\n/business/cyber.html|60|Claude-User|100|Insurance\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), '/personal/home.html|45\n/personal/pet.html|5\n');
  const pages = readFetches([path.join(dir, 'a.txt'), path.join(dir, 'b.txt')]);
  assert.deepEqual(pages.get('/personal/home.html'), { hits: 45, agent: 'ChatGPT-User' }, 'a later export overrides hits and keeps the agent');
  assert.equal(pages.get('/personal/pet.html').agent, 'not given');
  const view = (p, day, source) => ({ id: p + day, url: `https://www.example.com/us${p}`, weight: 100, time: `2026-10-${day}T10:00:00Z`, events: source ? [{ checkpoint: 'enter', source }] : [] });
  const bundles = [
    view('/personal/home.html', '12', 'https://chatgpt.com/'),
    view('/personal/home.html', '13', 'https://www.google.com/'),
    view('/personal/home.html', '20'),
    view('/personal/home.html', '30', 'https://chatgpt.com/'), // after the window
    view('.html', '14'), // /us.html is the home page
    { ...view('/personal/home.html', '15'), url: 'https://www.example.com/de/personal/home.html' }, // out of scope
  ];
  const r = joinFetches(o, pages, bundles, { from: '2026-10-12', to: '2026-10-26', scope: '^/us', sections: { personal: '^/personal', business: '^/business' } });
  assert.equal(r.window, '2026-10-12..2026-10-25');
  assert.equal(r.attempts, 100 + 45 + 60 + 5);
  assert.deepEqual(Object.fromEntries(Object.entries(r.bySec).map(([k, v]) => [k, v.attempts])), { home: 100, personal: 50, business: 60 });
  const home = r.rows.find((x) => x.p === '/personal/home.html');
  assert.deepEqual([home.views, home.ai, home.search], [300, 100, 100]);
  assert.equal(r.rows.find((x) => x.p === '/').views, 100);
  assert.equal(r.aiVisits, 100);
  assert.deepEqual(r.agents[0], ['ChatGPT-User', 145]);
});
