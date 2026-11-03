import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  camelKey, sectionOfBlock, experiencesOf, lint, holdout, previewUrl, audienceOf,
} from '../skills/homepage-cohorts/engine/ew-panel/model.js';
import rules from '../skills/homepage-cohorts/engine/cohort-rules.js';

const S = (i, meta = {}, blocks = [{ name: 'promo', variants: [] }], heading = `s${i}`) => ({
  i, blocks, heading, meta, rawKeys: Object.keys(meta),
});

test('metadata keys normalise like aem.js', () => {
  assert.equal(camelKey('Hide For'), 'hideFor');
  assert.equal(camelKey('hide-for'), 'hideFor');
  assert.equal(camelKey('Cohorts'), 'cohorts');
});

test('selection.blockIndex maps to its section, metadata tables do not count', () => {
  const secs = [S(0, {}, []), S(1, {}, [{ name: 'quick links', variants: [] }]),
    S(2, {}, [{ name: 'promo', variants: [] }, { name: 'cards', variants: [] }]), S(3)];
  assert.equal(sectionOfBlock(secs, 0), 1);
  assert.equal(sectionOfBlock(secs, 1), 2);
  assert.equal(sectionOfBlock(secs, 2), 2);
  assert.equal(sectionOfBlock(secs, 3), 3);
  assert.equal(sectionOfBlock(secs, 9), null);
  assert.equal(sectionOfBlock(secs, null), null);
});

test('experiences come from the rules, intents from the keys the page uses', () => {
  const secs = [S(0, { slot: 'hero', cohorts: 'prospect:pricing' }), S(1, { cohorts: 'customer' })];
  const cj = { rules: [{ id: 'from-portal', share: 0.05 }, { id: 'signed-in-before', share: 0.1 }, { id: 'none', share: 0.2 }] };
  const exps = experiencesOf(rules, secs, cj);
  assert.deepEqual(exps.map((e) => e.id), ['default', 'customer', 'prospect', 'prospect:pricing', 'mobile']);
  assert.deepEqual(exps.find((e) => e.id === 'prospect:pricing').keys, ['prospect:pricing', 'prospect', 'default']);
  assert.ok(Math.abs(exps.find((e) => e.id === 'customer').share - 0.15) < 1e-9);
  assert.equal(exps.find((e) => e.id === 'default').share, 0.2);
});

test('lint: typos, unknown experiences, slots without a default', () => {
  const page = { cohorts: 'on' };
  const secs = [
    S(0, { slot: 'hero', cohorts: 'customer' }),
    S(1, { cohorts: 'custmer' }),
    S(2, { cohorts: 'prospect:pricng' }),
    { ...S(3), rawKeys: ['Audience'] },
  ];
  const t = lint({ page, sections: secs }, rules).map((x) => `${x.level}:${x.section}:${x.text.slice(0, 40)}`);
  assert.ok(t.some((x) => x.startsWith('error:0:Slot "hero" has no default')));
  assert.ok(t.some((x) => x.startsWith('error:1:"custmer"')));
  assert.ok(t.some((x) => x.startsWith('error:2:"prospect:pricng"')));
  assert.ok(t.some((x) => x.startsWith('error:3:"Audience" is not a key')));
  // cohort metadata on a page that does not run cohorts does nothing
  assert.ok(lint({ page: {}, sections: [S(0, { cohorts: 'customer' })] }, rules).some((x) => x.level === 'warn' && x.section === null));
});

test('holdout: the default view must be the original page', () => {
  const orig = [S(0), S(1)];
  const mine = [S(0), S(1), S(2, { cohorts: 'customer' })];
  assert.equal(holdout(orig, [0, 1], mine).ok, true);
  const bad = holdout(orig, [0, 2], mine);
  assert.equal(bad.ok, false);
  assert.equal(bad.at, 1);
});

test('who sees a section, and preview links', () => {
  const views = [{ id: 'default', order: [0, 1], promoted: [] }, { id: 'customer', order: [0, 2, 1], promoted: [2] }];
  assert.deepEqual(audienceOf(2, views), { shown: ['customer'], hidden: ['default'], promoted: ['customer'] });
  const o = 'https://main--site--org.aem.page';
  assert.equal(previewUrl(o, '/new', { id: 'default' }, rules), `${o}/`);
  assert.equal(previewUrl(o, '/new', { id: 'customer', experience: 'customer', intent: null }, rules), `${o}/new?cohort=from-portal&demo`);
  assert.match(previewUrl(o, '/new', { id: 'prospect:pricing', experience: 'prospect', intent: 'pricing' }, rules), /cohort=campaign&utm_campaign=pricing&demo$/);
});
