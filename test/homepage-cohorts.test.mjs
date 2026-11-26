/* Run: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as optel from '../optel-client.js';
import {
  matchRule, matches, sourceOf, intentFrom, refHostOf, SIGNALS, agentOf, consentOf, relationshipOf,
} from '../skills/homepage-cohorts/engine/cohorts.js';
import {
  signalsFromBundle, goalHit, entryOf, ruleOf, assumesFirstVisit,
} from '../skills/homepage-cohorts/scripts/lib.js';
import { defaultView, originalView } from '../skills/homepage-cohorts/scripts/verify.js';
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

test('personal AI agents match only the rules that ask for one', () => {
  const m = matchRule(rules, sig({ agent: 'chatgpt-agent' }));
  assert.equal(m.rule, 'personal-agent');
  assert.equal(m.experience, 'agent');
  // an agent's browser is automated, and it may carry a referrer or tags: still the agent rule
  assert.equal(matchRule(rules, sig({ agent: 'claude-agent', bot: true, refHost: 'portal.example.com', source: 'ai' })).rule, 'personal-agent');
  assert.equal(matchRule(rules, sig({ agent: 'manus-user', utm: { ...sig().utm, campaign: 'pricing-q1' } })).keys[0], 'agent:pricing');
  // people never get it, and without an agent rule an agent gets the original page
  assert.equal(matchRule(rules, sig({ source: 'ai' })).rule, 'ai-referred');
  const human = { ...rules, rules: rules.rules.filter((r) => r.id !== 'personal-agent') };
  assert.equal(matchRule(human, sig({ agent: 'chatgpt-agent', source: 'ai' })).rule, null);
  // a rule for some agents only
  const only = { rules: [{ id: 'claude', experience: 'agent', when: { agent: ['claude-agent'] } }] };
  assert.equal(matchRule(only, sig({ agent: 'claude-agent' })).rule, 'claude');
  assert.equal(matchRule(only, sig({ agent: 'google-agent' })).rule, null);
  assert.equal(matches({ agent: false }, sig(), rules), true);
});

test('agentOf: user agent, or what the CDN passed on from Signature-Agent', () => {
  assert.equal(agentOf('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36 Claude-Agent/1.0'), 'claude-agent');
  assert.equal(agentOf('Mozilla/5.0 (compatible; Google-Agent/1.0)'), 'google-agent');
  assert.equal(agentOf('Mozilla/5.0 Chrome/140.0 Safari/537.36 Manus-User/1.0'), 'manus-user');
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.equal(agentOf(chrome), null);
  assert.equal(agentOf(chrome, 'chatgpt-agent'), 'chatgpt-agent');
  assert.equal(agentOf(chrome, '"https://chatgpt.com"'), 'chatgpt-agent');
  assert.equal(agentOf(chrome, '"https://muse.ai"'), 'meta-agent');
  assert.equal(agentOf(chrome, 'https://www.meta.com'), 'meta-agent');
  assert.equal(agentOf(chrome, 'gptbot'), null);
  assert.equal(agentOf('Mozilla/5.0 (compatible; GPTBot/1.2)'), null);
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
  // a Facebook or DV360 ad tagged utm_source=chatgpt.com is paid, not an AI citation
  assert.equal(sourceOf('', 'example.com', { source: 'chatgpt.com' }, ['facebook']), 'direct');
  // rum-distiller#145: capgemini is not Gemini
  assert.equal(sourceOf('', 'example.com', { source: 'capgemini' }), 'direct');
  assert.equal(sourceOf('', 'example.com', { source: 'geminiforbusiness' }), 'ai');
  // attribution.now/reclaim-direct-traffic
  assert.equal(sourceOf('google.com', 'example.com', { source: 'chatgpt.com' }), 'search', 'a tagged URL in search results');
  assert.equal(sourceOf('chatgpt.com', 'example.com', { source: 'chatgpt.com' }, ['openai']), 'other', 'a ChatGPT ad is paid, not a citation');
  assert.equal(sourceOf('com.openai.chatgpt', 'example.com'), 'ai', 'ChatGPT Android app');
  assert.equal(sourceOf('copilot.cloud.microsoft', 'example.com'), 'ai');
  assert.equal(sourceOf('l.meta.ai', 'example.com'), 'ai', 'a link clicked in a Meta AI answer');
  assert.equal(sourceOf('', 'example.com', { source: 'l.metamuse.ai' }), 'ai', 'Muse mobile app tag');
  assert.notEqual(sourceOf('', 'example.com', { source: 'meta' }), 'ai', 'utm_source=meta is a Meta ad');
  assert.equal(sourceOf('', 'example.com', { source: 'copilot.com?form=mg0auo' }), 'ai');
  assert.equal(sourceOf('', 'example.com', { source: 'geminiforbusiness' }), 'ai');
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
    B([{ checkpoint: 'enter', source: '' }], { ua: 'mobile:ios' }),
    // a click without a target: it opened something (a menu), it is not a destination
    B([{ checkpoint: 'enter', source: '' }, { checkpoint: 'click', source: 'header button' }], { ua: 'mobile:ios' }),
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
  // clicks that opened something on the page are marked, links are not
  const mob = c.rules.find((r) => r.id === 'mobile-first-visit');
  assert.ok(mob.today.topClicks.some((t) => t.click === 'header button' && t.link === false));
  assert.ok(c.rules.find((r) => r.id === 'from-portal').today.topClicks.every((t) => t.link === true));
  // Optel cannot see visit counts: a first-visit rule is an upper bound
  assert.equal(mob.firstVisitAssumed, true);
  assert.equal(c.rules.find((r) => r.id === 'ai-referred').firstVisitAssumed, false);
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

test('size.js: weeks, growth, engagement against all views, standsOut', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cohorts-weeks-'));
  const at = (b, day) => ({ ...b, time: `2026-10-${String(1 + day).padStart(2, '0')}T10:00:00.000Z`, timeSlot: `2026-10-${String(1 + day).padStart(2, '0')}T10:00:00.000Z` });
  const quiet = (day) => at(B([{ checkpoint: 'enter', source: '' }]), day);
  const ai = (day) => at(B([{ checkpoint: 'enter', source: 'https://chatgpt.com/' }, { checkpoint: 'click', source: 'a', target: 'https://www.example.com/pricing' }]), day);
  const bundles = [
    ...Array.from({ length: 400 }, () => quiet(1)), ...Array.from({ length: 10 }, () => ai(2)),
    ...Array.from({ length: 400 }, () => quiet(8)), ...Array.from({ length: 25 }, () => ai(9)),
    quiet(15), // a third, partial window
  ];
  fs.writeFileSync(path.join(tmp, 'b.jsonl'), bundles.map((b) => JSON.stringify(b)).join('\n'));
  run('size.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'b.jsonl'), '--out', path.join(tmp, 'c.json')]);
  const c = JSON.parse(fs.readFileSync(path.join(tmp, 'c.json'), 'utf8'));
  assert.equal(c.meta.weeks, 3);
  assert.equal(c.meta.fullWeeks, 2);
  const r = c.rules.find((x) => x.id === 'ai-referred');
  assert.deepEqual(r.weeks, [1000, 2500, 0]);
  assert.equal(r.growth, 2.5);
  assert.equal(r.today.navigated, 1);
  assert.ok(r.today.vsAll.navigated > 1.5);
  assert.equal(r.standsOut, true);
  // the big, quiet rest never stands out
  assert.equal(c.rules.find((x) => x.id === 'none').standsOut, false);
  assert.equal(c.today.weeks.reduce((a, w) => a + w, 0), c.meta.views);
});

test('size.js and review.js: personal agents count only where a rule asks for them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cohorts-'));
  const aud = (rule, arm) => ({ checkpoint: 'audience', source: rule, target: arm });
  const bundles = [
    ...Array.from({ length: 8 }, () => B([{ checkpoint: 'enter', source: '' }, aud('none', 'challenger-1')])),
    ...Array.from({ length: 2 }, () => B([{ checkpoint: 'enter', source: '' }, aud('personal-agent', 'challenger-1')], { ua: 'bot:ai:chatgpt-agent' })),
    B([{ checkpoint: 'enter', source: '' }, aud('none', 'challenger-1')], { ua: 'bot:ai:claude-agent' }), // tagged before the rule existed
    B([{ checkpoint: 'enter', source: '' }], { ua: 'bot:ai:gptbot' }), // a crawler
  ];
  const file = path.join(tmp, 'b.jsonl');
  fs.writeFileSync(file, bundles.map((b) => JSON.stringify(b)).join('\n'));
  run('size.js', ['--rules', rulesFile, '--bundles', file, '--out', path.join(tmp, 'c.json')]);
  const c = JSON.parse(fs.readFileSync(path.join(tmp, 'c.json'), 'utf8'));
  assert.equal(c.meta.bundles, 11); // 8 people + 3 personal agents, not the crawler
  const agent = c.rules.find((r) => r.id === 'personal-agent');
  assert.equal(agent.bundles, 3);
  assert.equal(agent.signal, 'agent');
  assert.equal(c.columns[0].nodes.find((n) => n.id === 'e:agent').label, 'Personal AI agents');
  run('sankey.js', ['--in', path.join(tmp, 'c.json'), '--out', path.join(tmp, 's')]);
  assert.match(fs.readFileSync(path.join(tmp, 's.svg'), 'utf8'), /data-n="x:agent"/);
  // rules without an agent rule: agents stay out, as before
  const human = path.join(tmp, 'human-rules.mjs');
  fs.writeFileSync(human, `import r from ${JSON.stringify(pathToFileURL(rulesFile).href)};\nexport default { ...r, rules: r.rules.filter((x) => x.id !== 'personal-agent') };\n`);
  run('size.js', ['--rules', human, '--bundles', file, '--out', path.join(tmp, 'h.json')]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'h.json'), 'utf8')).meta.bundles, 8);
  // review: the agent rule is measured on the agents the engine tagged with it
  run('review.js', ['--rules', rulesFile, '--bundles', file, '--out', path.join(tmp, 'r.json')]);
  const r = JSON.parse(fs.readFileSync(path.join(tmp, 'r.json'), 'utf8'));
  assert.equal(r.rules.find((x) => x.id === 'personal-agent').cohort.bundles, 2);
  assert.equal(r.rules.find((x) => x.id === 'none').cohort.bundles, 8);
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

test('verify: section metadata as a block or as data-* attributes', () => {
  const orig = '<div><h1>Hello</h1></div><div><p>Two</p></div>';
  const asBlock = `<div><h1>Hello</h1><div class="section-metadata"><div><div>Slot</div><div>hero</div></div></div></div>
<div><h1>Risk first</h1><div class="section-metadata"><div><div>Slot</div><div>hero</div></div><div><div>Cohorts</div><div>clients</div></div></div></div>
<div><p>Two</p></div>`;
  const asAttrs = '<div data-slot="hero" data-cohorts="default"><h1>Hello</h1></div><div data-slot="hero" data-cohorts="clients"><h1>Risk first</h1></div><div data-hide-for="mobile"><p>Two</p></div><div data-cohorts="mobile"><p>Tasks</p></div>';
  assert.deepEqual(defaultView(asBlock), originalView(orig));
  assert.deepEqual(defaultView(asAttrs), originalView(orig));
  // a new section without Cohorts breaks the holdout
  assert.notDeepEqual(defaultView(`${asAttrs}<div><p>Extra</p></div>`), originalView(orig));
});

test('in-app referrers: the same app table as optel-client.js', () => {
  const www = (h) => h.replace(/^www\./, '');
  assert.deepEqual(
    Object.fromEntries(Object.entries(SIGNALS.apps).map(([k, v]) => [k, www(v)])),
    Object.fromEntries(Object.entries(optel.RULES.androidApps).map(([k, v]) => [k, www(v)])),
  );
});

test('in-app referrers become the app site, unknown packages are not hosts', () => {
  assert.equal(refHostOf('android-app://com.facebook.katana/'), 'facebook.com');
  assert.equal(refHostOf('android-app://com.google.android.youtube/'), 'youtube.com');
  assert.equal(refHostOf('android-app://com.google.android.googlequicksearchbox/'), 'google.com');
  assert.equal(refHostOf('android-app://com.google.android.apps.messaging/'), '');
  assert.equal(refHostOf('https://m.facebook.com/story'), 'facebook.com');
  assert.equal(refHostOf(''), '');
  // social apps are social, the YouTube app is not search (google.android.youtube looked like google.*)
  assert.equal(sourceOf(refHostOf('android-app://com.instagram.android/'), 'example.com'), 'social');
  assert.equal(sourceOf(refHostOf('android-app://com.google.android.youtube/'), 'example.com'), 'social');
  assert.equal(sourceOf(refHostOf('android-app://com.google.android.googlequicksearchbox/'), 'example.com'), 'search');
  assert.equal(sourceOf(refHostOf('android-app://com.openai.chatgpt/'), 'example.com'), 'ai');
  // callers that still pass a raw package
  assert.equal(sourceOf('com.google.android.youtube', 'example.com'), 'social');
  assert.equal(sourceOf('com.google.android.apps.messaging', 'example.com'), 'direct');
  // and the Node side builds the same signals from a bundle
  const fb = signalsFromBundle(optel, rules, B([{ checkpoint: 'enter', source: 'android-app://com.facebook.katana/' }], { ua: 'mobile:android' }));
  assert.equal(fb.refHost, 'facebook.com');
  assert.equal(fb.source, 'social');
  assert.equal(matches({ referrer: ['facebook.com'] }, fb, rules), true);
});

test('first-visit rules without a model are flagged as an upper bound', () => {
  assert.equal(assumesFirstVisit({ when: { device: 'mobile', visits: { max: 1 } } }), true);
  assert.equal(assumesFirstVisit({ when: { any: [{ source: 'ai' }, { visits: { max: 1 } }] } }), true);
  assert.equal(assumesFirstVisit({ when: { visits: { min: 2 }, interest: true }, model: { clickIntent: true } }), false);
  assert.equal(assumesFirstVisit({ when: { source: 'ai' } }), false);
  assert.equal(assumesFirstVisit(null), false);
});

test('size.js --site: second order, assists for the conversion, supporting step per rule', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cohorts-second-'));
  const S = 'https://www.example.com';
  const home = [
    ...Array.from({ length: 4 }, (_, i) => B([{ checkpoint: 'enter', source: 'https://chatgpt.com/' },
      ...(i < 3 ? [{ checkpoint: 'click', source: 'main a', target: `${S}/features` }] : [])])),
    B([{ checkpoint: 'enter', source: '' }]),
  ];
  const next = (page, to, from = `${S}/`) => B([{ checkpoint: 'navigate', source: from },
    ...(to ? [{ checkpoint: 'click', source: 'main a', target: `${S}${to}` }] : [])], { url: `${S}${page}` });
  const site = [...home,
    ...Array.from({ length: 6 }, (_, i) => next('/features', i < 4 ? '/pricing' : null)),
    next('/blog', null),
    ...Array.from({ length: 30 }, (_, i) => next('/x', i < 15 ? '/quote' : null, `${S}/pricing`)),
    ...Array.from({ length: 30 }, (_, i) => next('/x', i < 3 ? '/quote' : null, `${S}/blog`)),
  ];
  fs.writeFileSync(path.join(tmp, 'h.jsonl'), home.map((b) => JSON.stringify(b)).join('\n'));
  fs.writeFileSync(path.join(tmp, 's.jsonl'), site.map((b) => JSON.stringify(b)).join('\n'));
  run('size.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'h.jsonl'), '--site', path.join(tmp, 's.jsonl'), '--out', path.join(tmp, 'c.json')]);
  const c = JSON.parse(fs.readFileSync(path.join(tmp, 'c.json'), 'utf8'));
  const ai = c.rules.find((r) => r.id === 'ai-referred');
  assert.equal(ai.today.supportRate, 0.75);
  assert.equal(c.rules.find((r) => r.id === 'none').today.supportRate, null);
  const so = c.secondOrder;
  assert.equal(so.scope, 'site');
  assert.equal(so.first[0].path, '/features');
  assert.equal(so.first[0].next[0].key, '/pricing');
  assert.ok(Math.abs(so.first[0].onward - 4 / 6) < 1e-9);
  assert.equal(so.assists.pages[0].path, '/pricing');
  assert.ok(so.assists.pages[0].lift > 1.5);
  // without --site there is no second order
  run('size.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'h.jsonl'), '--out', path.join(tmp, 'c0.json')]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'c0.json'), 'utf8')).secondOrder, null);
});

test('goals: any of click / path; review.js reports the supporting step', () => {
  assert.equal(goalHit(optel, { click: 'nope', path: '^/quote' }, B([], { url: 'https://www.example.com/quote' })), true);
  assert.equal(goalHit(optel, { click: 'nope', path: '^/quote' }, B([], { url: 'https://www.example.com/x' })), false);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-support-'));
  const view = (arm, goal, sup) => B([
    { checkpoint: 'enter', source: 'https://chatgpt.com/' },
    { checkpoint: 'experiment', source: 'homepage-cohorts', target: arm === 'control' ? 'control' : 'challenger-1' },
    { checkpoint: 'audience', source: 'ai-referred', target: arm },
    ...(goal ? [{ checkpoint: 'click', source: '.hero a', target: 'https://www.example.com/quote' }] : []),
    ...(sup ? [{ checkpoint: 'click', source: 'main a', target: 'https://www.example.com/features' }] : []),
  ]);
  const bundles = [];
  for (let i = 0; i < 100; i += 1) bundles.push(view('control', i < 20, i < 10));
  for (let i = 0; i < 100; i += 1) bundles.push(view('challenger-1', i < 22, i < 40));
  fs.writeFileSync(path.join(tmp, 'm.jsonl'), bundles.map((b) => JSON.stringify(b)).join('\n'));
  run('review.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'm.jsonl'), '--out', path.join(tmp, 'r.json'), '--md', path.join(tmp, 'r.md')]);
  const ai = JSON.parse(fs.readFileSync(path.join(tmp, 'r.json'), 'utf8')).rules.find((x) => x.id === 'ai-referred');
  assert.equal(ai.support.control, 0.1);
  assert.equal(ai.support.cohort, 0.4);
  assert.equal(ai.verdict, 'promising: more take the supporting step, goal not clear yet');
  assert.match(fs.readFileSync(path.join(tmp, 'r.md'), 'utf8'), /pricing, features or customers: 10\.0% → 40\.0%/);
});

test('engine: a tie between interests goes to the one viewed last; partner is a site signal', async () => {
  const { topInterest } = await import('../skills/homepage-cohorts/engine/cohorts.js');
  assert.equal(topInterest({ interests: { a: 2, b: 2 }, lastInterest: 'b' }), 'b');
  assert.equal(topInterest({ interests: { a: 3, b: 2 }, lastInterest: 'b' }), 'a');
  assert.equal(topInterest({ interests: { a: 2, b: 2 } }), 'a');
  assert.equal(matches({ partner: true }, sig({ partner: { code: 'x' } }), rules), true);
  assert.equal(matches({ partner: true }, sig(), rules), false);
  assert.equal(matches({ partner: false }, sig(), rules), true);
});

test('pictures.js: pictures per rule, beats reached, landing pages and the page after', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-'));
  const pic = (name, sel = '.hero picture', q = '?width=750') => ({ checkpoint: 'viewmedia', source: sel, target: `https://www.example.com/media_${name}.jpg${q}` });
  const home = [
    // portal visitors scroll: hero, the electric picture, the closing band
    ...Array.from({ length: 12 }, () => B([{ checkpoint: 'enter', source: 'https://portal.example.com/' }, pic('aa01'), pic('bb02', '.cards picture'), pic('cc03', '.teaser picture', '?width=2000')])),
    // AI arrivals see the hero only; a logo is not a picture (--match drops it)
    ...Array.from({ length: 8 }, () => B([{ checkpoint: 'enter', source: 'https://chatgpt.com/' }, pic('aa01', '.hero picture', '?width=1200'), { checkpoint: 'viewmedia', source: 'header img', target: 'https://www.example.com/icons/logo.svg' }])),
  ];
  const site = [
    ...home,
    ...Array.from({ length: 5 }, () => B([{ checkpoint: 'enter', source: 'https://chatgpt.com/' }, pic('dd04')], { url: 'https://www.example.com/support' })),
    ...Array.from({ length: 4 }, () => B([{ checkpoint: 'navigate', source: 'https://www.example.com/' }, pic('ee05')], { url: 'https://www.example.com/products' })),
  ];
  fs.writeFileSync(path.join(tmp, 'h.jsonl'), home.map((b) => JSON.stringify(b)).join('\n'));
  fs.writeFileSync(path.join(tmp, 's.jsonl'), site.map((b) => JSON.stringify(b)).join('\n'));
  fs.writeFileSync(path.join(tmp, 'k.json'), JSON.stringify([['closing', 'cc03'], ['hero', 'aa01']]));
  run('pictures.js', ['--rules', rulesFile, '--bundles', path.join(tmp, 'h.jsonl'), '--site', path.join(tmp, 's.jsonl'), '--match', 'media_', '--kinds', path.join(tmp, 'k.json'), '--out', path.join(tmp, 'p.json')]);
  const p = JSON.parse(fs.readFileSync(path.join(tmp, 'p.json'), 'utf8'));
  assert.equal(p.meta.bundles, 20);
  // renditions (?width=) are one picture; the logo is out
  assert.deepEqual(p.pictures.map((x) => x.name), ['media_aa01.jpg', 'media_bb02.jpg', 'media_cc03.jpg']);
  assert.equal(p.pictures[0].share, 1);
  const portal = p.rules.find((r) => r.id === 'from-portal');
  const ai = p.rules.find((r) => r.id === 'ai-referred');
  assert.deepEqual(portal.depth.slice(0, 4), [1, 1, 1, 0]);
  assert.deepEqual(ai.depth.slice(0, 2), [1, 0]);
  assert.equal(portal.pictures.find((x) => x.name === 'media_cc03.jpg').position, 2);
  assert.equal(portal.pictures.find((x) => x.name === 'media_bb02.jpg').vsAll, 1 / 0.6);
  assert.deepEqual(portal.leansTo, ['media_bb02.jpg', 'media_cc03.jpg']);
  assert.equal(portal.kinds.closing, 1);
  assert.equal(ai.kinds.closing, undefined);
  // the same AI group lands on /support and sees its picture there
  const land = p.landing.find((r) => r.id === 'ai-referred');
  assert.equal(land.bundles, 5);
  assert.equal(land.pictures[0].page, '/support');
  // modelled memory rules are not evaluated on landing views
  assert.ok(!p.landing.some((r) => r.id === 'signed-in-before'));
  assert.equal(p.afterHome.all.pages[0].path, '/products');
  assert.equal(p.afterHome.all.pictures[0].name, 'media_ee05.jpg');
});

/* ---------- loyalty or new: the relationship split, the consent signal ---------- */

test('every rule for people is in a group', () => {
  rules.rules.filter((r) => !r.when.agent).forEach((r) => assert.ok(['loyalty', 'new'].includes(r.group), r.id));
});

test('no signal is new or unknown; one weak signal is loyalty', () => {
  assert.deepEqual(relationshipOf(rules, sig()), {
    group: 'new', strength: null, evidence: [], remember: true,
  });
  assert.equal(matchRule(rules, sig()).group, 'new');
  const weak = relationshipOf(rules, sig({ memory: { visits: 2 } }));
  assert.equal(weak.group, 'loyalty');
  assert.equal(weak.strength, 'weak');
  const strong = relationshipOf(rules, sig({ memory: { signedIn: true, visits: 3 } }));
  assert.equal(strong.strength, 'strong');
  assert.deepEqual(strong.evidence.map((e) => e.id), ['signed-in', 'repeat-visit']);
});

test('came back after rejecting cookies: loyalty, and nothing more is remembered', () => {
  const r = relationshipOf(rules, sig({ consent: 'rejected', consentBefore: true }));
  assert.equal(r.group, 'loyalty');
  assert.equal(r.strength, 'medium');
  assert.equal(r.remember, false);
  // a decision made during this visit is not a return
  assert.equal(relationshipOf(rules, sig({ consent: 'granted' })).group, 'new');
});

test('the rule group and the visitor can differ; bots and agents have no relationship', () => {
  const r = matchRule(rules, sig({ source: 'ai', memory: { visits: 2 } }));
  assert.equal(r.rule, 'ai-referred');
  assert.equal(r.group, 'new');
  assert.equal(r.relationship.group, 'loyalty');
  assert.equal(relationshipOf(rules, sig({ bot: true })), null);
  assert.equal(relationshipOf(rules, sig({ agent: 'chatgpt-agent' })), null);
  assert.equal(relationshipOf({ ...rules, relationship: undefined }, sig()), null);
});

test('when.consent and when.consentBefore', () => {
  assert.ok(matches({ consent: true }, sig({ consent: 'rejected' })));
  assert.ok(!matches({ consent: true }, sig({ consent: 'undecided' })));
  assert.ok(matches({ consent: ['granted', 'customized'] }, sig({ consent: 'customized' })));
  assert.ok(matches({ consent: false }, sig()));
  assert.ok(matches({ consentBefore: true }, sig({ consentBefore: true })));
  assert.ok(!matches({ consentBefore: true }, sig()));
});

test('OneTrust cookies: granted, rejected, customized, undecided, none', () => {
  const c = (groups, closed = 'OptanonAlertBoxClosed=2026-11-01T10:00:00.000Z; ') => `${closed}OptanonConsent=isGpcEnabled=0&groups=${encodeURIComponent(groups)}&version=1`;
  assert.equal(consentOf(c('C0001:1,C0002:1,C0004:1')).state, 'granted');
  assert.equal(consentOf(c('C0001:1,C0002:0,C0004:0')).state, 'rejected');
  assert.equal(consentOf(c('C0001:1,C0002:1,C0004:0')).state, 'customized');
  assert.equal(consentOf(c('C0001:1,C0002:1')).at, Date.parse('2026-11-01T10:00:00.000Z'));
  // a default the visitor never confirmed is not a decision
  assert.equal(consentOf(c('C0001:1,C0002:0', '')).state, 'undecided');
  assert.equal(consentOf('other=1'), null);
});

test('Osano: the choice from its API, the cookie says a choice was made', () => {
  const all = (v) => ({ ESSENTIAL: 'ACCEPT', ANALYTICS: v, MARKETING: v, PERSONALIZATION: v, STORAGE: v, OPT_OUT: 'DENY' });
  const c = 'osano_consentmanager_uuid=u; osano_consentmanager=opaque';
  assert.deepEqual(consentOf(c, all('ACCEPT')), { state: 'granted', at: null });
  // "Reject Non-Essential", as read from a live Osano banner (November 2026)
  assert.equal(consentOf(c, { ...all('DENY'), OPT_OUT: 'ACCEPT' }).state, 'rejected');
  assert.equal(consentOf(c, { ...all('ACCEPT'), MARKETING: 'DENY' }).state, 'customized');
  // accepted everything but opted out of sale or sharing: limited
  assert.equal(consentOf(c, { ...all('ACCEPT'), OPT_OUT: 'ACCEPT' }).state, 'customized');
  // before a choice Osano reports its defaults and sets no cookie
  assert.equal(consentOf('', all('DENY')).state, 'undecided');
  // the cookie is encrypted: without the API, a choice the engine cannot read
  assert.deepEqual(consentOf(c), { state: 'decided', at: null });
  assert.equal(consentOf('', null), null);
});

test('a choice the engine cannot read: a decision, and nothing is remembered', () => {
  assert.ok(matches({ consent: true }, sig({ consent: 'decided' })));
  assert.ok(!matches({ consent: 'granted' }, sig({ consent: 'decided' })));
  const r = relationshipOf(rules, sig({ consent: 'decided', consentBefore: true }));
  assert.equal(r.group, 'loyalty');
  assert.equal(r.remember, false);
});

test('Osano keeps no time: a stored choice on a page entered from elsewhere predates the visit', async () => {
  const { signalsFor } = await import('../skills/homepage-cohorts/engine/cohorts.js');
  const saved = { window: globalThis.window, document: globalThis.document };
  const href = 'https://www.example.com/';
  globalThis.window = {
    location: { href, search: '' },
    matchMedia: () => ({ matches: false }),
    Osano: { cm: { getConsent: () => ({ ANALYTICS: 'ACCEPT', MARKETING: 'ACCEPT', PERSONALIZATION: 'ACCEPT', STORAGE: 'ACCEPT', OPT_OUT: 'DENY' }) } },
  };
  globalThis.document = { cookie: 'osano_consentmanager=opaque', querySelector: () => null };
  try {
    const outside = signalsFor(rules, href, 'https://www.google.com/');
    assert.equal(outside.consent, 'granted');
    assert.equal(outside.consentBefore, true);
    assert.equal(signalsFor(rules, href, '').consentBefore, true);
    // the next page of the visit in which the choice was made
    assert.equal(signalsFor(rules, href, 'https://www.example.com/about').consentBefore, false);
    globalThis.document.cookie = '';
    assert.equal(signalsFor(rules, href, 'https://www.google.com/').consentBefore, false);
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
});
