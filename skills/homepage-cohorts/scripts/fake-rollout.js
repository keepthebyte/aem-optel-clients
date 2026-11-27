#!/usr/bin/env node
/*
 * Fake a running cohort experiment, to try review.js (and a monthly-review video) before a site
 * has one. Takes FAKE homepage bundles (optel-client.js --fake … --report raw) and adds what the
 * engine and the experimentation plugin would have sent: one `audience` checkpoint per view
 * (source = the rule these cohort rules give it, target = arm) and the `experiment` checkpoint,
 * 90% challenger-1, 10% control. With --lift, treated views reach their rule's goal more often.
 *
 *   OPTEL_FAKE=profile.json node optel-client.js --path / --last 60d --granularity hour --report raw --out fake-home.jsonl
 *   node fake-rollout.js --rules scripts/cohort-rules.js --bundles fake-home.jsonl --out fake-month.jsonl [--lift 0.2] [--lift-<rule id> -0.1] [--control 0.1]
 *   node review.js --rules scripts/cohort-rules.js --bundles fake-month.jsonl --md review.md
 *
 * Refuses bundles without `fake: true`: tagging real traffic would invent results.
 */
import fs from 'node:fs';
import {
  loadOptel, loadRules, readBundles, parseArgs, goalHit, ruleOf, cohortViews, agentRuleIds,
} from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.bundles || !args.out) {
  console.error('usage: node fake-rollout.js --rules cohort-rules.js --bundles fake-home.jsonl --out fake-month.jsonl [--lift 0.2] [--lift-<rule id> 0.1] [--control 0.1] [--path /]');
  process.exit(1);
}
const o = await loadOptel();
const rules = await loadRules(args.rules);
const bundles = readBundles(args.bundles);
const real = bundles.filter((b) => b.fake !== true).length;
if (real) {
  console.error(`${real} of ${bundles.length} bundles are not fake: fake-rollout.js only tags data from optel-client.js --fake`);
  process.exit(1);
}
const exp = rules.experiment || 'homepage-cohorts';
const control = args.control != null ? Number(args.control) : 0.1;
const liftOf = (id) => Number(args[`lift-${id}`] ?? args.lift ?? 0);
const paths = new Set(String(args.path || '/').split(',').map((p) => o.normalizePath(p.trim())));

// same seeded hash as optel-fake.js: the same input gives the same arms and the same lift
const unit = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
};

// what a click must look like to reach a goal: the first literal word of its pattern
const word = (re) => (String(re).match(/[a-z][a-z-]+/i) || ['contact'])[0].toLowerCase();
function goalEvent(goal, b) {
  const origin = new URL(b.url).origin;
  const t = (b.events.at(-1)?.timeDelta || 1000) + 1500;
  if (goal?.checkpoint) return { checkpoint: goal.checkpoint, source: '.form', timeDelta: t };
  if (goal?.click) return { checkpoint: 'click', source: '.cta a', target: `${origin}/${word(goal.click)}`, timeDelta: t };
  if (goal?.path) return { checkpoint: 'click', source: '.cta a', target: `${origin}/${word(goal.path)}`, timeDelta: t };
  return { checkpoint: 'click', source: '.cta a', target: `${origin}/contact`, timeDelta: t };
}

const agentRules = agentRuleIds(rules);
const views = new Set(cohortViews(o, bundles, (b) => agentRules.has(ruleOf(o, rules, b).rule)).filter((b) => paths.has(o.pathOf(b))));
const byRule = new Map();
for (const b of views) {
  const id = ruleOf(o, rules, b).rule || 'none';
  b.events = b.events.filter((e) => e.checkpoint !== 'audience' && !(e.checkpoint === 'experiment' && e.source === exp));
  const arm = unit(`${b.id}|${b.time}|arm`) < control ? 'control' : 'challenger-1';
  b.events.splice(1, 0, { checkpoint: 'experiment', source: exp, target: arm, timeDelta: b.events[0]?.timeDelta || 0 }, { checkpoint: 'audience', source: id, target: arm, timeDelta: b.events[0]?.timeDelta || 0 });
  if (!byRule.has(id)) byRule.set(id, []);
  byRule.get(id).push({ b, arm });
}

const summary = [];
for (const [id, list] of byRule) {
  const rule = (rules.rules || []).find((r) => r.id === id);
  const goal = rule?.goal;
  const base = list.filter(({ b }) => goalHit(o, goal, b)).length / list.length;
  const lift = id === 'none' ? 0 : liftOf(id); // `none` is the A/A check: never lifted
  // treated goal rate becomes base * (1 + lift), from at least 5%: add goal clicks for a lift, drop them for a fall
  const target = Math.min(1, Math.max(base, 0.05) * (1 + lift));
  const add = lift > 0 && base < 1 ? Math.max(0, (target - base) / (1 - base)) : 0;
  const drop = lift < 0 ? Math.min(1, -lift) : 0;
  for (const { b, arm } of list) {
    if (arm !== 'challenger-1') continue;
    const u = unit(`${b.id}|${b.time}|goal`);
    const hit = goalHit(o, goal, b);
    if (!hit && u < add) b.events.push(goalEvent(goal, b));
    if (hit && u < drop && goal?.click) b.events = b.events.filter((e) => !(e.checkpoint === 'click' && new RegExp(goal.click, 'i').test(`${e.source || ''} ${e.target || ''}`)));
  }
  summary.push({ rule: id, views: list.length, baseGoalRate: Number(base.toFixed(3)), lift });
}

fs.writeFileSync(args.out, `${bundles.map((b) => JSON.stringify(b)).join('\n')}\n`);
process.stderr.write(`fake rollout: ${views.size} homepage views tagged, ${Math.round(control * 100)}% control. SYNTHETIC: not a result.\n`);
process.stdout.write(`${JSON.stringify({ fake: true, experiment: exp, control, rules: summary }, null, 2)}\n`);
