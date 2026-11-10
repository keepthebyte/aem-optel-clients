import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pct, keyLabel, sectionReasons, ruleFacts,
} from '../skills/homepage-cohorts/engine/cohort-insights.js';

const rules = {
  experiences: { express: { label: 'Express' }, proof: { label: 'Comparing' }, member: { label: 'Customer' } },
  rules: [{ id: 'paid-social', goalLabel: 'starts a quote' }],
};
const data = {
  meta: {
    domain: 'www.example.com', path: '/', start: '2026-09-14T00:00:00Z', end: '2026-11-09T00:00:00Z', views: 397400, bundles: 3974, weeks: 9, fullWeeks: 8,
  },
  today: { didNothing: 0.376 },
  experiences: [{ id: 'default', share: 0.345 }],
  rules: [
    {
      id: 'paid-social', label: 'Paid social', views: 57900, share: 0.1457, bundles: 579, growth: 0.66, today: { goalRate: 0.0915, didNothing: 0.644, vsAll: { didNothing: 1.71 }, topClicks: [{ click: 'form button', link: false, share: 0.06 }, { click: '/dog-insurance', link: true, share: 0.04 }] },
    },
    {
      id: 'signed-in', label: 'Signed in', views: 53600, share: 0.135, bundles: 536, modelled: true, today: { didNothing: 0.3, vsAll: { didNothing: 1.02 } },
    },
    {
      id: 'from-account', label: 'From the portal', views: 0, share: 0, bundles: 0, lowSample: true, today: {},
    },
    {
      id: 'ai', label: 'AI', views: 1200, share: 0.003, bundles: 12, lowSample: true, standsOut: true, today: { didNothing: 0.2 },
    },
  ],
};

test('percentages read like a person wrote them', () => {
  assert.equal(pct(0.1457, true), '14.6%');
  assert.equal(pct(0.1457), '15%');
  assert.equal(pct(0.644), '64%');
  assert.equal(pct(0.05), '5%');
  assert.equal(pct(0.0004), '<0.1%');
});

test('keys read as experience labels', () => {
  assert.equal(keyLabel(rules, 'express:dog'), 'Express · dog');
  assert.equal(keyLabel(rules, 'default'), 'everyone else');
  assert.equal(keyLabel({ experiences: { express: { label: 'Express: I know what I want' } } }, 'express'), 'Express');
});

test('a slot section says who it was made for', () => {
  const ctx = { keys: ['express:dog', 'express', 'default'] };
  assert.deepEqual(sectionReasons({ slot: 'hero', cohorts: 'express:dog, express' }, ctx, rules), ['Hero made for Express · dog']);
  assert.match(sectionReasons({ slot: 'hero', cohorts: 'default' }, { keys: ['default'] }, rules)[0], /original/);
});

test('promoted, limited and hidden sections say so; the rest are for everyone', () => {
  const ctx = { keys: ['proof', 'default'] };
  assert.deepEqual(sectionReasons({ cohorts: 'proof', promote: 'proof' }, ctx, rules), ['Only for Comparing', 'Moved up for Comparing']);
  assert.deepEqual(sectionReasons({ hideFor: 'member' }, ctx, rules), ['Hidden for Customer']);
  assert.deepEqual(sectionReasons({}, ctx, rules), ['Everyone sees this section']);
});

test('rule facts come from cohorts.json, not from copy', () => {
  const f = ruleFacts(data, 'paid-social', rules);
  assert.equal(f.headline, '14.6% of homepage views · 8 weeks');
  assert.deepEqual(f.lines, [
    '64% do nothing today (1.7× the page average)',
    '9.2% reach the goal (starts a quote)',
    'Most clicked link: /dog-insurance (4%)',
    'Up 66% from the first full week to the last',
  ]);
  assert.match(f.source, /www\.example\.com\/ · Sep 14 – Nov 9 · 397k views \(3,974 sampled\)/);
});

test('caveats: modelled, unseen, small but standing out', () => {
  const m = ruleFacts(data, 'signed-in', rules);
  assert.match(m.headline, /at most/);
  assert.match(m.caveats[0], /Modelled/);
  assert.deepEqual(m.lines, ['30% do nothing today']);
  assert.match(ruleFacts(data, 'from-account', rules).headline, /not seen/);
  const ai = ruleFacts(data, 'ai', rules);
  assert.ok(ai.lines.some((l) => /stands out/.test(l)));
  assert.match(ai.caveats[0], /12 sampled views/);
});

test('unmatched visitors and missing data', () => {
  assert.match(ruleFacts(data, null, rules).headline, /34\.5% of homepage views match no rule/);
  assert.equal(ruleFacts(null, 'paid-social', rules), null);
  assert.equal(ruleFacts(data, 'nope', rules), null);
});

test('insightText restores the comma spacing the pipeline drops', async () => {
  const { insightText } = await import('../skills/homepage-cohorts/engine/cohort-insights.js');
  assert.equal(insightText('homepage,~15% (2,800 views),then claims'), 'homepage, ~15% (2,800 views), then claims');
});
