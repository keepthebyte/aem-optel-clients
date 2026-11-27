import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceOf, ordered, filtered, counts, compact, change,
  choicesDoc, draftPrompt, sourceTarget, shortPage,
} from '../skills/brand-visibility/ew-panel/model.js';

const T = [
  {
    id: 'a', label: 'A', job: 'Claim', focus: 'focus', potential: { prompts: 100 },
  },
  {
    id: 'b', label: 'B', job: 'Defend', focus: 'watch', potential: { prompts: 900 },
  },
  {
    id: 'c', label: 'C', job: 'Win', focus: 'watch', potential: { prompts: 500 },
  },
];

test('saved choice wins over the default, bad values fall back', () => {
  assert.equal(choiceOf(T[0], null), 'focus');
  assert.equal(choiceOf(T[0], { themes: { a: 'skip' } }), 'skip');
  assert.equal(choiceOf(T[0], { themes: { a: 'maybe' } }), 'focus');
  assert.equal(choiceOf({ id: 'x' }, null), 'watch');
});

test('order: focus, watch, skip, then most asked', () => {
  const saved = { themes: { b: 'skip' } };
  assert.deepEqual(ordered(T, saved).map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(ordered(T, null).map((t) => t.id), ['a', 'b', 'c']);
});

test('filters and counts', () => {
  const saved = { themes: { c: 'focus' } };
  assert.deepEqual(filtered(T, saved, 'focus').map((t) => t.id), ['a', 'c']);
  assert.deepEqual(filtered(T, saved, 'Defend').map((t) => t.id), ['b']);
  assert.equal(filtered(T, saved, 'all').length, 3);
  assert.deepEqual(counts(T, saved), {
    all: 3, focus: 2, Claim: 1, Defend: 1, Win: 1,
  });
});

test('compact numbers and change', () => {
  assert.equal(compact(1294000), '1.3M');
  assert.equal(compact(2000000), '2M');
  assert.equal(compact(5400), '5.4k');
  assert.equal(compact(53900), '54k');
  assert.equal(compact(300), '300');
  assert.equal(compact(null), '–');
  assert.equal(change(200, 100), 100);
  assert.equal(change(200, null), null);
});

test('choices doc keeps other themes and stamps the time', () => {
  const now = new Date('2026-11-26T10:00:00Z');
  const d = choicesDoc({ themes: { a: 'skip' } }, 'b', 'focus', now);
  assert.deepEqual(d, { updated: '2026-11-26T10:00:00.000Z', themes: { a: 'skip', b: 'focus' } });
  assert.deepEqual(choicesDoc(d, 'a', null, now).themes, { b: 'focus' });
});

test('draft prompt carries page, what and evidence', () => {
  const s = {
    title: 'Do X', page: 'https://www.example.com/p.html', site: 'example.com', what: 'Change it.', evidence: [{ kind: 'Study', text: 'Because.' }],
  };
  const p = draftPrompt({ label: 'Cyber', job: 'Defend' }, s);
  assert.match(p, /Cyber topic \(Defend\): Do X/);
  assert.match(p, /Page: https:\/\/www\.example\.com\/p\.html/);
  assert.match(p, /- Study: Because\./);
  assert.equal(shortPage(s), 'example.com/p.html');
});

test('source target from context or from the preview host', () => {
  assert.deepEqual(sourceTarget({ org: 'o', repo: 's' }, ''), { org: 'o', site: 's' });
  assert.deepEqual(sourceTarget({}, 'my-branch--example-site--example-org.aem.page'), { org: 'example-org', site: 'example-site' });
  assert.deepEqual(sourceTarget(null, 'example-site--example-org.aem.live'), { org: 'example-org', site: 'example-site' });
  assert.equal(sourceTarget({}, 'localhost'), null);
});

test('plan holds the focus topics and its prompt lists their changes', async () => {
  const { planOf, planPrompt } = await import('../skills/brand-visibility/ew-panel/model.js');
  const themes = T.map((t) => ({ ...t, suggestions: [{ title: `Fix ${t.id}`, page: `https://x/${t.id}` }] }));
  const plan = planOf(themes, { themes: { b: 'focus' } });
  assert.deepEqual(plan.map((t) => t.id), ['b', 'a']);
  assert.match(planPrompt(plan), /B \(Defend\):\n {2}Be seen and preferred:\n {2}- Fix b: https:\/\/x\/b/);
});

test('suggestions group by goal, and the draft names the goal and the page pattern', async () => {
  const { byGoal } = await import('../skills/brand-visibility/ew-panel/model.js');
  const list = [{ id: 1, goal: 'chosen' }, { id: 2 }, { id: 3, goal: 'seen' }];
  assert.deepEqual(byGoal(list).map((g) => [g.goal, g.items.map((x) => x.id)]), [['seen', [2, 3]], ['chosen', [1]]]);
  assert.deepEqual(byGoal([{ goal: 'chosen' }]).map((g) => g.goal), ['chosen']);
  const meta = {
    goals: { seen: { label: 'Be seen and preferred', text: 'Cited.', metric: 'Share' } },
    pattern: { title: 'Make the page do both jobs', parts: [{ goal: 'seen', name: 'The question as the H1', text: 'Answer first.' }] },
  };
  const s = {
    title: 'Open it', page: 'https://x/p', goal: 'seen', what: 'W', pattern: true,
  };
  const p = draftPrompt({ label: 'Health', job: 'Win' }, s, meta);
  assert.match(p, /Goal: Be seen and preferred\. Cited\. Measured by: Share\./);
  assert.match(p, /Make the page do both jobs:\n- The question as the H1 \(Be seen and preferred\): Answer first\./);
  assert.doesNotMatch(draftPrompt({ label: 'H', job: 'Win' }, { ...s, pattern: false }, meta), /both jobs/);
});

test('sort and log scale', async () => {
  const { sortBy, logScale } = await import('../skills/brand-visibility/ew-panel/model.js');
  assert.deepEqual(sortBy(T, 'prompts').map((t) => t.id), ['b', 'c', 'a']);
  assert.deepEqual(sortBy(T, 'prompts', 1).map((t) => t.id), ['a', 'c', 'b']);
  const x = logScale([1, 100], [0, 200]);
  assert.equal(x(10), 100);
  assert.equal(x(0.5), 0);
});

/* ---------- the panel's data file: scripts/panel-data.js ---------- */

test('job from share and rank, else from the state of read 2', async () => {
  const { jobOf } = await import('../skills/brand-visibility/scripts/panel-data.js');
  assert.equal(jobOf({ share: 12, rank: 3 }), 'Defend');
  assert.equal(jobOf({ share: 3, rank: 2 }), 'Defend');
  assert.equal(jobOf({ share: 7, rank: 4 }), 'Win');
  assert.equal(jobOf({ share: 2, rank: 9 }), 'Claim');
  assert.equal(jobOf({}, 'open'), 'Claim');
  assert.equal(jobOf(null, 'lead'), 'Defend');
  assert.equal(jobOf({ share: 7 }, 'open', { defendShare: 6, defendRank: 1, winShare: 3 }), 'Defend');
  const byRank = { by: 'rank', defendRank: 3, winRank: 9 };
  assert.deepEqual([2, 3, 4, 9, 10].map((rank) => jobOf({ share: 12, rank }, 'lead', byRank)), ['Defend', 'Defend', 'Win', 'Win', 'Claim']);
});

test('the example reads and plan build the panel data', async () => {
  const fs = await import('node:fs');
  const { panelData } = await import('../skills/brand-visibility/scripts/panel-data.js');
  const dir = new URL('../skills/brand-visibility/', import.meta.url);
  const reads = JSON.parse(fs.readFileSync(new URL('reads.example.json', dir), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(new URL('plan.example.json', dir), 'utf8'));
  const visits = {
    sites: [{ id: 'group', name: 'example.com' }],
    themes: Object.fromEntries(reads.themes.map((t, i) => [t.id, { label: t.id.toUpperCase(), visits: 1000 * (i + 1), ai: 10 * (i + 1), sites: { group: 1000 * (i + 1) } }])),
  };
  const { data, problems } = panelData({ visits, reads, plan }, { today: new Date('2026-11-26') });
  assert.deepEqual(problems, []);
  const health = data.themes.find((t) => t.id === 'health');
  assert.equal(health.job, 'Defend');
  assert.equal(health.focus, 'focus');
  assert.deepEqual(health.potential.bySite, { 'example.com': 1000 });
  assert.equal(health.standing.peer.ratio, 1.6);
  assert.deepEqual(health.suggestions.map((s) => [s.id, s.goal, s.site, !!s.pattern]), [['health-1', 'seen', 'example.com', true], ['health-2', 'chosen', 'example.com', false]]);
  assert.equal(data.themes.find((t) => t.id === 'people').focus, 'watch');
  assert.equal(data.meta.goals.chosen.label, 'Be chosen');
  assert.equal(data.meta.labels.peer, 'next competitor');
  assert.match(data.meta.jobRule.Claim, /without the brand/);
});

test('a theme without share, or a plan for an unknown theme, stops the build', async () => {
  const { panelData } = await import('../skills/brand-visibility/scripts/panel-data.js');
  const reads = { themes: [{ id: 'a', state: 'open', prompts: 10 }] };
  const r1 = panelData({ visits: { themes: {} }, reads, plan: {} });
  assert.equal(r1.data, null);
  assert.ok(r1.problems.some((p) => /a: standing.share is missing/.test(p)));
  const ok = { themes: [{ id: 'a', state: 'open', prompts: 10, standing: { share: 1 } }] };
  const r2 = panelData({ visits: { themes: { a: { visits: 1 } } }, reads: ok, plan: { suggestions: { b: [] } } });
  assert.equal(r2.data, null);
  assert.ok(r2.problems.some((p) => /plan.suggestions.b/.test(p)));
});

test('suggested pages must answer 200', async () => {
  const { checkUrls } = await import('../skills/brand-visibility/scripts/panel-data.js');
  const data = { themes: [{ suggestions: [{ id: 'a-1', page: 'https://x/ok' }, { id: 'a-2', page: 'https://x/moved' }] }] };
  const fake = async (u) => ({ status: u.endsWith('ok') ? 200 : 301 });
  assert.deepEqual(await checkUrls(data, fake), ['a-2: 301 https://x/moved']);
});
