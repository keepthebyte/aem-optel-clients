import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  camelKey, sectionOfBlock, experiencesOf, relationshipSections, lint, holdout, previewUrl, audienceOf, campaignFor,
  groupColor,
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
  assert.deepEqual(exps.map((e) => e.id), ['default', 'customer', 'prospect', 'prospect:pricing', 'mobile', 'agent']);
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

test('plain-language names for variations and interests', async () => {
  const { shortName, intentName } = await import('../skills/homepage-cohorts/engine/ew-panel/model.js');
  assert.equal(shortName(rules, 'default'), 'Everyone else');
  assert.equal(shortName(rules, 'prospect'), 'Prospect');
  assert.equal(shortName(rules, 'prospect:pricing'), 'Prospect · Pricing');
  assert.equal(intentName('product-a'), 'Product a');
  assert.equal(intentName(null), 'No interest known');
});

test('interest sources follow the rules and a variant diff names the swap', async () => {
  const { interestSources, variantDiff } = await import('../skills/homepage-cohorts/engine/ew-panel/model.js');
  const src = interestSources(rules, 'prospect');
  const label = (id) => rules.rules.find((r) => r.id === id).label;
  assert.ok(src.utm.includes(label('campaign')) && !src.memory.includes(label('campaign')));
  assert.ok(src.memory.includes(label('returning-interest')) && !src.utm.includes(label('returning-interest')));
  assert.deepEqual(variantDiff([0, 1, 2], [0, 5, 2]), { added: [5], removed: [1] });
});

test('audience lists read as words', async () => {
  const { audienceText } = await import('../skills/homepage-cohorts/engine/ew-panel/model.js');
  assert.equal(audienceText(rules, ['prospect:pricing', 'prospect', 'mobile']), 'Prospect (Pricing or no interest), Mobile');
  assert.equal(audienceText(rules, ['prospect:support']), 'Prospect · Support');
  assert.equal(audienceText(rules, ['default']), 'Everyone else');
});

test('edits: one metadata change, its prompt, its check and its undo', async () => {
  const {
    metaEdit, deleteEdit, reverse, applied, promptFor, manualText, newSectionHtml, versionPrompt,
  } = await import('../skills/homepage-cohorts/engine/ew-panel/edits.js');
  const s = S(3, { hideFor: 'customer' }, [{ name: 'cards', variants: [] }], 'Plans for every team');
  const e = metaEdit(s, 'hideFor', 'add', 'prospect', 'Hide section 4 for Prospect');
  assert.deepEqual(e.after, ['customer', 'prospect']);
  assert.equal(applied([s], e), false);
  const edited = { ...s, meta: { hideFor: 'prospect, customer' } };
  assert.equal(applied([edited], e), true, 'order of ids does not matter');
  // the section is found by its blocks and heading when its index moved
  assert.equal(applied([S(0), { ...edited, i: 4 }], e), true);
  const u = reverse(e, 'Undo');
  assert.deepEqual(u.after, ['customer']);
  assert.equal(applied([s], u), true);
  assert.match(promptFor(e, s), /section 4 \(the cards block, starting "Plans for every team"\) only: set the "Hide For" row to: customer, prospect\./);
  const rm = metaEdit({ ...s, meta: { promote: 'prospect' } }, 'promote', 'remove', 'prospect', 'x');
  assert.match(promptFor(rm, s), /remove the "Promote" row/);
  assert.equal(manualText(rm, s), 'Section 4, Section Metadata: remove the Promote row');
  assert.equal(applied([], deleteEdit(s, 'd')), true);
  assert.equal(applied([s], deleteEdit(s, 'd')), false);
  assert.match(newSectionHtml('prospect', 'Prospect'), /<td>Cohorts<\/td><td>prospect<\/td>/);
  assert.match(versionPrompt({ ...s, meta: { slot: 'hero' } }, 'customer', 'Customer'), /"Slot: hero" and "Cohorts: customer"\.$/);
  assert.match(versionPrompt(s, 'customer', 'Customer'), /add "customer" to the original section's "Hide For" row/);
});

test('intent links use a campaign value the engine reads as that intent', () => {
  const r = {
    ...rules,
    intents: [['used', 'second-hand|used-car|certified'], ['electric', 'ev|electric|/model-e[x0-9]'], ['m', '/m/|sport-m']],
  };
  // the id itself is not matched by the used pattern: the first plain word that is
  assert.equal(campaignFor(r, 'used'), 'second-hand');
  // the id itself when the pattern reads it
  assert.equal(campaignFor(r, 'electric'), 'electric');
  // regex pieces are skipped: '/m/' is not a campaign value, 'sport-m' is
  assert.equal(campaignFor(r, 'm'), 'sport-m');
  // an intent the rules do not list: the id
  assert.equal(campaignFor(r, 'other'), 'other');
  const u = new URL(previewUrl('https://x.example', '/new', { id: 'prospect:used', experience: 'prospect', intent: 'used' }, r));
  assert.equal(u.searchParams.get('utm_campaign'), 'second-hand');
});

test('group colours: default first, intents share their group\'s colour', () => {
  const ids = Object.keys(rules.experiences || {});
  assert.match(groupColor(rules, 'default'), /gray/);
  assert.equal(groupColor(rules, `${ids[0]}:anything`), groupColor(rules, ids[0]));
  assert.notEqual(groupColor(rules, ids[0]), groupColor(rules, 'default'));
});

test('a written Insight note with numbers is flagged, a note id is not', () => {
  const warns = (insight) => lint({ page: { cohorts: 'on' }, sections: [S(0, { insight })] }, rules).filter((x) => /published with the page/.test(x.text));
  assert.equal(warns('58% of comparison visitors start a quote.').length, 1);
  assert.equal(warns('Customers get their tasks first.').length, 0);
  assert.equal(warns('hero-proof-2').length, 0);
});

test('relationshipSections: the switcher by loyalty and new, by where most visitors are', () => {
  const r = {
    relationship: { groups: { loyalty: { label: 'Loyalty' }, new: { label: 'New or unknown' } } },
    rules: [
      { id: 'email', group: 'loyalty', experience: 'owner' },
      { id: 'search', group: 'new', experience: 'shopper' },
      { id: 'back', group: 'loyalty', experience: 'shopper' },
      { id: 'agent', experience: 'agent' },
    ],
  };
  const exps = [
    { id: 'default', rules: ['none'] }, { id: 'owner', rules: ['email'] },
    { id: 'shopper', rules: ['search', 'back'] }, { id: 'agent', rules: ['agent'] },
  ];
  const cj = { rules: [{ id: 'search', share: 0.3 }, { id: 'back', share: 0.05 }] };
  const secs = relationshipSections(r, exps, cj);
  assert.deepEqual(secs.map((s) => [s.label, s.exps.map((e) => e.id)]), [
    ['Loyalty', ['owner']], ['New or unknown', ['default', 'shopper']], ['No relationship', ['agent']],
  ]);
  // without shares, the rule tried first decides
  assert.deepEqual(relationshipSections(r, exps, null).map((s) => s.exps.map((e) => e.id).join()), ['owner', 'default,shopper', 'agent']);
  // no groups: one unlabelled section
  assert.deepEqual(relationshipSections({ rules: [] }, exps, null).map((s) => s.label), ['']);
});
