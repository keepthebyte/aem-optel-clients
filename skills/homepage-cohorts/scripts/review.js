#!/usr/bin/env node
/*
 * Monthly review: did each cohort rule beat its holdout? What traffic does no rule catch yet?
 *
 *   node optel-client.js --domain www.example.com --path / --start 2026-10-01 --end 2026-10-31 \
 *     --granularity hour --report raw --out month.jsonl
 *   node review.js --rules scripts/cohort-rules.js --bundles month.jsonl --out review.json [--md review.md]
 *
 * Reads the `audience` checkpoint the engine fires on every homepage view
 * (source = rule id or `none`, target = control | challenger-1 | poc) and the plugin's
 * `experiment` checkpoint. Per rule: goal rate in the cohort experience vs the holdout,
 * lift and p-value. `none` is an A/A check: both arms see the original sections, so a
 * significant difference there means the split or the tagging is broken, not a win.
 */
import fs from 'node:fs';
import {
  loadOptel, loadRules, readBundles, parseArgs, goalHit, clicks,
} from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.bundles) {
  console.error('usage: node review.js --rules cohort-rules.js --bundles month.jsonl [--path /] [--out review.json] [--md review.md]');
  process.exit(1);
}
const o = await loadOptel();
const rules = await loadRules(args.rules);
const pagePath = o.normalizePath(args.path || '/');
const human = o.realViews(readBundles(args.bundles)).filter((b) => o.pathOf(b) === pagePath);
const tagged = human.filter((b) => o.has(b, 'audience'));
const armOf = (b) => o.firstEvent(b, 'audience').target;
const ruleOf = (b) => o.firstEvent(b, 'audience').source || 'none';
const TREATED = (a) => a === 'challenger-1' || a === 'poc';

const exp = rules.experiment || 'homepage-cohorts';
const expViews = human.filter((b) => o.events(b, 'experiment').some((e) => e.source === exp));
const controlShare = expViews.length ? expViews.filter((b) => o.events(b, 'experiment').some((e) => e.source === exp && e.target === 'control')).length / expViews.length : null;

const ruleList = [...(rules.rules || []), { id: 'none', label: 'No rule matched (A/A check)', experience: 'default' }];
const rows = ruleList.map((r) => {
  const bs = tagged.filter((b) => ruleOf(b) === r.id);
  const ctl = bs.filter((b) => armOf(b) === 'control');
  const trt = bs.filter((b) => TREATED(armOf(b)));
  const hit = (g) => g.filter((b) => goalHit(o, r.goal, b)).length;
  const nothing = (g) => (g.length ? g.filter((b) => o.activityOf(b) === 'nothing').length / g.length : 0);
  const cmp = o.compareProportions(hit(ctl), ctl.length, hit(trt), trt.length);
  const enough = ctl.length >= o.LOW_SAMPLE && trt.length >= o.LOW_SAMPLE;
  let verdict = 'not enough data yet';
  if (enough) {
    if (r.id === 'none') verdict = cmp.significant ? 'A/A FAILED: check the split and tagging' : 'A/A ok';
    else if (cmp.significant) verdict = cmp.lift > 0 ? 'keep: beats the holdout' : 'fix or drop: worse than the holdout';
    else verdict = 'no clear difference yet';
  }
  return {
    id: r.id,
    label: r.label || r.id,
    experience: r.experience,
    goal: r.goal || { click: 'any (not consent)' },
    views: o.weightOf(bs),
    share: tagged.length ? o.weightOf(bs) / o.weightOf(tagged) : 0,
    control: { bundles: ctl.length, goalRate: cmp.rateA, didNothing: nothing(ctl) },
    cohort: { bundles: trt.length, goalRate: cmp.rateB, didNothing: nothing(trt) },
    lift: cmp.lift,
    p: cmp.p,
    significant: cmp.significant,
    lowSample: !enough,
    verdict,
  };
});

/* What no rule catches: biggest groups of unmatched views by where they came from and what they did. */
const none = tagged.filter((b) => ruleOf(b) === 'none');
const refKey = (b) => {
  const u = o.utmOf(b);
  if (u.utm_campaign) return `campaign: ${u.utm_campaign}`;
  if (u.utm_source) return `utm_source: ${u.utm_source}`;
  const ref = o.referrerOf(b);
  if (ref) { try { return `referrer: ${new URL(ref).hostname}`; } catch { return null; } }
  return o.isVisit(b) ? 'direct' : 'internal navigation';
};
const candidates = {
  bySource: o.groupBy(none, refKey, { top: 10, total: o.weightOf(none) }).map((g) => ({ key: g.key, share: g.share, bundles: g.bundles, lowSample: g.bundles < o.LOW_SAMPLE })),
  byFirstClick: o.groupBy(none, (b) => { const c = clicks(o, b)[0]; return c ? (c.target ? o.normalizePath(c.target) : c.source) : 'no click'; }, { top: 10, total: o.weightOf(none) })
    .map((g) => ({ key: g.key, share: g.share, bundles: g.bundles, lowSample: g.bundles < o.LOW_SAMPLE })),
};

const times = human.map((b) => b.time || b.timeSlot).sort();
const out = {
  meta: {
    domain: human.length ? o.hostOf(human[0]) : null,
    path: pagePath,
    start: times[0] || null,
    end: times[times.length - 1] || null,
    views: o.weightOf(human),
    bundles: human.length,
    taggedBundles: tagged.length,
    untaggedShare: human.length ? 1 - tagged.length / human.length : 0,
    experiment: exp,
    controlShare,
    note: 'Goal rates are per sampled view (bundle counts, as experimentReport does). Rules under 30 bundles per arm are reported but not judged.',
  },
  rules: rows,
  unmatched: { share: tagged.length ? none.length / tagged.length : 0, ...candidates },
};

const json = JSON.stringify(out, null, 1);
if (args.out) fs.writeFileSync(args.out, json); else process.stdout.write(`${json}\n`);

const cell = (v) => String(v).replace(/\|/g, '\\|');
const pct = (x, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
if (args.md) {
  const lines = [
    `# Homepage cohorts: review ${out.meta.start?.slice(0, 10)} to ${out.meta.end?.slice(0, 10)}`,
    '',
    `${out.meta.domain}${pagePath} · ${out.meta.bundles.toLocaleString()} sampled views (~${Math.round(out.meta.views).toLocaleString()} views) · ${pct(1 - out.meta.untaggedShare)} tagged · holdout ${pct(controlShare)}`,
    '',
    '| Rule | Share | Goal | Holdout | Cohort | Lift | p | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${cell(r.label)} | ${pct(r.share)} | ${cell(r.goal.click || (r.goal.navigate ? 'navigated' : r.goal.checkpoint))} | ${pct(r.control.goalRate)} (${r.control.bundles}) | ${pct(r.cohort.goalRate)} (${r.cohort.bundles}) | ${r.lowSample ? '–' : pct(r.lift, 0)} | ${r.lowSample ? '–' : r.p.toFixed(3)} | ${r.verdict} |`),
    '',
    `## Not caught by any rule (${pct(out.unmatched.share)} of views)`,
    '',
    ...out.unmatched.bySource.map((g) => `- ${g.key}: ${pct(g.share)} of unmatched (${g.bundles} bundles${g.lowSample ? ', low sample' : ''})`),
    '',
  ];
  fs.writeFileSync(args.md, lines.join('\n'));
}
console.error(`${tagged.length}/${human.length} views tagged; holdout ${pct(controlShare)}`);
rows.forEach((r) => console.error(`  ${r.id.padEnd(22)} holdout ${pct(r.control.goalRate).padStart(6)} (${r.control.bundles})  cohort ${pct(r.cohort.goalRate).padStart(6)} (${r.cohort.bundles})  ${r.verdict}`));
