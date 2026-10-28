/* Run: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as optel from '../optel-client.js';
import {
  matchRule, matches, sourceOf, intentFrom,
} from '../skills/homepage-cohorts/engine/cohorts.js';
import {
  signalsFromBundle, goalHit, entryOf, ruleOf,
} from '../skills/homepage-cohorts/scripts/lib.js';
import rules from '../skills/homepage-cohorts/engine/cohort-rules.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(dir, '../skills/homepage-cohorts/scripts');
const rulesFile = path.join(dir, '../skills/homepage-cohorts/engine/cohort-rules.js');

const sig = (o = {}) => ({
  refHost: '', source: 'direct', utm: { source: '', medium: '', campaign: '', content: '', term: '' }, paid: [], device: 'desktop', bot: false, memory: {}, path: '/', ...o,
});

test('first match wins, in rule order', () => {
  // from the portal AND signed in: the portal rule is first
  assert.equal(matchRule(rules, sig({ refHost: 'portal.example.com', source: 'other', memory: { signedIn: true } })).rule, 'from-portal');
  assert.equal(matchRule(rules, sig({ memory: { signedIn: true }, source: 'ai' })).rule, 'signed-in-before');
  assert.equal(matchRule(rules, sig({ source: 'ai' })).rule, 'ai-referred');
});

test('no signal, and bots, get the original sections', () => {
  const none = matchRule(rules, sig());
  assert.equal(none.rule, null);
  assert.deepEqual(none.keys, ['default']);
  assert.equal(matchRule(rules, sig({ bot: true, source: 'ai' })).rule, null);
});

test('campaign: ad click id or paid medium, intent from the tags', () => {
  const m = matchRule(rules, sig({ source: 'search', paid: ['google'], utm: { ...sig().utm, campaign: 'pricing-q1' } }));
  assert.equal(m.rule, 'campaign');
  assert.equal(m.intent, 'pricing');
  assert.deepEqual(m.keys, ['prospect:pricing', 'prospect', 'default']);
  assert.equal(matchRule(rules, sig({ utm: { ...sig().utm, medium: 'cpc' } })).rule, 'campaign');
  assert.equal(matchRule(rules, sig({ utm: { ...sig().utm, medium: 'organic' } })).rule, null);
});

test('returning with an interest, then first visit on a phone', () => {
  const r = matchRule(rules, sig({ memory: { visits: 3, interests: { 'product-a': 2, pricing: 1 } } }));
  assert.equal(r.rule, 'returning-interest');
  assert.equal(r.intent, 'product-a');
  assert.equal(matchRule(rules, sig({ device: 'mobile' })).rule, 'mobile-first-visit');
  assert.equal(matchRule(rules, sig({ device: 'mobile', memory: { visits: 4 } })).rule, null);
});

test('conditions: unknown keys never match; any is an or', () => {
  assert.equal(matches({ nope: 1 }, sig(), rules), false);
  assert.equal(matches({ any: [{ device: 'mobile' }, { source: 'direct' }] }, sig(), rules), true);
  assert.equal(matches({ utm: { any: 'spring' } }, sig({ utm: { ...sig().utm, content: 'spring-sale' } }), rules), true);
});

test('source and intent classification', () => {
  assert.equal(sourceOf('', 'example.com'), 'direct');
  assert.equal(sourceOf('login.example.com', 'example.com'), 'internal');
  assert.equal(sourceOf('chatgpt.com', 'example.com'), 'ai');
  assert.equal(sourceOf('', 'example.com', { source: 'chatgpt.com' }), 'ai');
  assert.equal(sourceOf('google.co.uk', 'example.com'), 'search');
  assert.equal(intentFrom(rules, '/plans/business'), 'pricing');
});

/* bundles shaped like the bundler's, for the Node side */
let n = 0;
const B = (events, { ua = 'desktop:windows', url = 'https://www.example.com/' } = {}) => ({
  id: `h${n += 1}`, url, userAgent: ua, weight: 100, time: '2026-10-02T10:00:00.000Z', timeSlot: '2026-10-02T10:00:00.000Z', events: [{ checkpoint: 'top' }, ...events],
});

test('bundle → signals: referrer, utm, ad clicks, modelled memory', () => {
  const portal = signalsFromBundle(optel, rules, B([{ checkpoint: 'enter', source: 'https://portal.example.com/home' }]));
  assert.equal(portal.refHost, 'portal.example.com');
  const paid = signalsFromBundle(optel, rules, B([{ checkpoint: 'enter', source: 'https://www.google.com/' }, { checkpoint: 'paid', source: 'google', target: 'gclid' }, { checkpoint: 'utm', source: 'utm_campaign', target: 'Pricing-Q1' }]));
  assert.deepEqual(paid.paid, ['google']);
  assert.equal(paid.utm.campaign, 'pricing-q1');
  // clicking sign-in today models "signed in before" (steady state)
  const signin = signalsFromBundle(optel, rules, B([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: '.header a', target: 'https://www.example.com/login' }]));
  assert.equal(signin.memory.signedIn, true);
  assert.equal(matchRule(rules, signin).rule, 'signed-in-before');
  // internal navigation (no enter)
  assert.equal(signalsFromBundle(optel, rules, B([{ checkpoint: 'navigate', source: 'https://www.example.com/x' }])).source, 'internal');
});

test('modelled memory only takes views no observable rule claims', () => {
  // a first visit on a phone that clicks sign-in stays a mobile view: its own click is not memory
  const mobileSignin = B([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: '.header a', target: 'https://www.example.com/login' }], { ua: 'mobile:ios' });
  assert.equal(ruleOf(optel, rules, mobileSignin).rule, 'mobile-first-visit');
  // the same click on desktop with no other signal is modelled as "signed in before"
  const desktopSignin = B([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: '.header a', target: 'https://www.example.com/login' }]);
  const m = ruleOf(optel, rules, desktopSignin);
  assert.equal(m.rule, 'signed-in-before');
  assert.equal(m.modelled, true);
});

test('model.click sets the interest an interest rule asks for', () => {
  const r = {
    intents: [['careers', 'careers|jobs']],
    rules: [{ id: 'careers-back', experience: 'careers', when: { visits: { min: 2 }, interest: ['careers'] }, model: { click: 'careers' } }],
  };
  const s = signalsFromBundle(optel, r, B([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: 'a', target: 'https://careers.example.com/' }]));
  assert.equal(s.memory.interests.careers, 1);
  assert.equal(matchRule(r, s).rule, 'careers-back');
});

test('email tools that link through their own host are owned email', () => {
  const a = optel.classifyAcquisition(B([{ checkpoint: 'enter', source: 'https://x.us.prod.marketingusercontent.com/' }]));
  assert.equal(a.type, 'owned');
  assert.equal(a.channel, 'email');
});

test('goals and entry sources', () => {
  const b = B([{ checkpoint: 'enter', source: 'https://chatgpt.com/' }, { checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/pricing' }]);
  assert.equal(goalHit(optel, { click: 'pricing' }, b), true);
  assert.equal(goalHit(optel, { click: 'login' }, b), false);
  assert.equal(goalHit(optel, undefined, b), true);
  assert.equal(entryOf(optel, rules, b), 'ai');
  assert.equal(entryOf(optel, rules, B([{ checkpoint: 'enter', source: 'https://portal.example.com/' }])), 'portal');
});

function run(script, args) {
  return execFileSync(process.execPath, [path.join(scripts, script), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('size.js → cohorts.json → sankey.js', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cohorts-'));
  const bundles = [
    ...Array.from({ length: 4 }, () => B([{ checkpoint: 'enter', source: 'https://portal.example.com/' }, { checkpoint: 'click', source: 'a', target: 'https://www.example.com/login' }])),
    ...Array.from({ length: 3 }, () => B([{ checkpoint: 'enter', source: 'https://chatgpt.com/' }])),
    ...Array.from({ length: 2 }, () => B([{ checkpoint: 'enter', source: '' }], { ua: 'mobile:ios' })),
    B([{ checkpoint: 'enter', source: '' }]),
    B([{ checkpoint: 'enter', source: '' }], { url: 'https://www.example.com/other' }),
  ];
  fs.writeFileSync(path.join(tmp, 'b.jsonl'), bundles.map((b) => JSON.stringify(b)).join('\n'));
  run('size.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'b.jsonl'), '--out', path.join(tmp, 'c.json')]);
  const c = JSON.parse(fs.readFileSync(path.join(tmp, 'c.json'), 'utf8'));
  assert.equal(c.meta.bundles, 10); // the /other view is not the homepage
  const share = Object.fromEntries(c.rules.map((r) => [r.id, r.share]));
  assert.equal(share['from-portal'], 0.4);
  assert.equal(share['ai-referred'], 0.3);
  assert.equal(share['mobile-first-visit'], 0.2);
  assert.equal(share.none, 0.1);
  assert.equal(c.columns.length, 4);
  // signed-in-before is modelled: its goal rate today would be circular
  c.rules.filter((r) => r.modelled).forEach((r) => assert.equal(r.today.goalRate, null));
  // external click targets keep their host
  assert.ok(c.rules.find((r) => r.id === 'from-portal').today.topClicks.some((t) => t.click === '/login'));
  // --path takes a comma list
  run('size.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'b.jsonl'), '--path', '/,/other', '--out', path.join(tmp, 'c2.json')]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'c2.json'), 'utf8')).meta.bundles, 11);
  // every flow stage sums to the total
  [0, 1, 2].forEach((col) => {
    const ids = new Set(c.columns[col].nodes.map((x) => x.id));
    assert.equal(c.links.filter((l) => ids.has(l.s)).reduce((a, l) => a + l.views, 0), c.meta.views);
  });
  run('sankey.js', ['--in', path.join(tmp, 'c.json'), '--out', path.join(tmp, 's')]);
  const svg = fs.readFileSync(path.join(tmp, 's.svg'), 'utf8');
  assert.match(svg, /data-rules="from-portal"/);
  assert.match(svg, /data-n="x:customer"/);
});

test('review.js: lift per rule against the holdout, A/A on unmatched', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
  const view = (rule, arm, converted) => B([
    { checkpoint: 'enter', source: rule === 'ai-referred' ? 'https://chatgpt.com/' : '' },
    { checkpoint: 'experiment', source: 'homepage-cohorts', target: arm === 'control' ? 'control' : 'challenger-1' },
    { checkpoint: 'audience', source: rule, target: arm },
    ...(converted ? [{ checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/pricing' }] : []),
  ]);
  const bundles = [];
  for (let i = 0; i < 100; i += 1) bundles.push(view('ai-referred', 'control', i < 20));
  for (let i = 0; i < 100; i += 1) bundles.push(view('ai-referred', 'challenger-1', i < 45));
  for (let i = 0; i < 60; i += 1) bundles.push(view('none', 'control', i < 30));
  for (let i = 0; i < 60; i += 1) bundles.push(view('none', 'challenger-1', i < 31));
  fs.writeFileSync(path.join(tmp, 'm.jsonl'), bundles.map((b) => JSON.stringify(b)).join('\n'));
  run('review.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'm.jsonl'), '--out', path.join(tmp, 'r.json'), '--md', path.join(tmp, 'r.md')]);
  const r = JSON.parse(fs.readFileSync(path.join(tmp, 'r.json'), 'utf8'));
  const ai = r.rules.find((x) => x.id === 'ai-referred');
  assert.equal(ai.control.goalRate, 0.2);
  assert.equal(ai.cohort.goalRate, 0.45);
  assert.equal(ai.significant, true);
  assert.equal(ai.verdict, 'keep: beats the holdout');
  assert.equal(r.rules.find((x) => x.id === 'none').verdict, 'A/A ok');
  assert.equal(r.rules.find((x) => x.id === 'campaign').verdict, 'not enough data yet');
  assert.equal(r.meta.controlShare, 160 / 320);
  assert.match(fs.readFileSync(path.join(tmp, 'r.md'), 'utf8'), /\| Sent by an AI assistant \|/);
});
