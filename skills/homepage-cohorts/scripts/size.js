#!/usr/bin/env node
/*
 * Size the cohort rules on real homepage traffic: which share of views each rule would take
 * (first match wins), what those views do today, and the flows for the Sankey.
 *
 *   node optel-client.js --domain www.example.com --path / --last 30d --granularity hour --report raw --out home.jsonl
 *   node size.js --rules scripts/cohort-rules.js --bundles home.jsonl --out cohorts.json
 *
 * Output: cohorts.json { meta, columns, links, rules, experiences } (read by sankey.js, review.js and the video skill).
 * Per rule: share, what its views do today (against all views in `vsAll`), views per 7-day
 * window (`weeks`, growth from the first to the last full week) and `standsOut`: a small rule
 * whose views are clearly more engaged than the page, or growing fast. Those are the
 * audiences to call out by name: in a share-sized Sankey they are a sliver.
 */
import fs from 'node:fs';
import {
  loadOptel, loadRules, readBundles, parseArgs, ruleOf, goalHit, entryOf, ENTRY_LABELS, signalOf, clicks, assumesFirstVisit,
} from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.bundles) {
  console.error('usage: node size.js --rules cohort-rules.js --bundles home.jsonl [--path /] [--out cohorts.json]');
  process.exit(1);
}
const o = await loadOptel();
const rules = await loadRules(args.rules);
const all = readBundles(args.bundles);
// the homepage is not always '/' ('/' may redirect to '/en/home.html'); --path takes a comma list
// for one rule set over several paths (e.g. two locales with the same audience)
const pagePath = args.path || '/';
const paths = new Set(String(pagePath).split(',').map((p) => o.normalizePath(p.trim())));
const views = o.realViews(all).filter((b) => paths.has(o.pathOf(b)));
const total = o.weightOf(views);
if (!views.length) { console.error(`no human views of ${pagePath} in ${args.bundles}`); process.exit(1); }

const rows = views.map((b) => {
  const m = ruleOf(o, rules, b);
  return {
    b, entry: entryOf(o, rules, b), device: o.device(b) === 'mobile' ? 'mobile' : 'desktop', rule: m.rule || 'none', experience: m.experience,
  };
});

const ruleList = [...(rules.rules || []), { id: 'none', label: 'No rule matched', experience: 'default' }];
const expLabels = { default: { label: 'Original homepage', sub: 'Unchanged: the same page as the holdout' }, ...(rules.experiences || {}) };

// links per stage, keyed source|target|signal, remembering which rules flow through
const linkMap = new Map();
const add = (s, t, sig, w, rule) => {
  const k = `${s}|${t}|${sig}`;
  if (!linkMap.has(k)) linkMap.set(k, { s, t, signal: sig, views: 0, rules: new Set() });
  const l = linkMap.get(k); l.views += w; l.rules.add(rule);
};
rows.forEach((r) => {
  const sig = signalOf((rules.rules || []).find((x) => x.id === r.rule));
  const w = r.b.weight || 0;
  add(`e:${r.entry}`, `d:${r.device}`, sig, w, r.rule);
  add(`d:${r.device}`, `r:${r.rule}`, sig, w, r.rule);
  add(`r:${r.rule}`, `x:${r.experience}`, sig, w, r.rule);
});

const share = (w) => (total ? w / total : 0);
const sum = (pred) => o.weightOf(rows.filter(pred).map((r) => r.b));
const entryIds = [...new Set(rows.map((r) => r.entry))].sort((a, b) => sum((r) => r.entry === b) - sum((r) => r.entry === a));
const sourceLabel = (id) => (rules.sources || []).find((s) => s.id === id)?.label || ENTRY_LABELS[id] || id;

const columns = [
  { head: 'Entry source', nodes: entryIds.map((id) => ({ id: `e:${id}`, label: sourceLabel(id), views: sum((r) => r.entry === id) })) },
  { head: 'Device', nodes: ['desktop', 'mobile'].map((id) => ({ id: `d:${id}`, label: id === 'mobile' ? 'Mobile' : 'Desktop', views: sum((r) => r.device === id) })).filter((n) => n.views) },
  {
    head: 'Rule that fires · first match wins',
    nodes: ruleList.map((r, i) => ({
      id: `r:${r.id}`, label: r.id === 'none' ? 'No rule matched' : `${i + 1} · ${r.label || r.id}`, sub: r.id === 'none' ? 'Original page' : r.sub || '', signal: signalOf(r.id === 'none' ? null : r), views: sum((x) => x.rule === r.id),
    })).filter((n) => n.views),
  },
  {
    head: 'Homepage experience',
    nodes: [...new Set(ruleList.map((r) => r.experience))].map((id) => ({
      id: `x:${id}`, label: expLabels[id]?.label || id, sub: expLabels[id]?.sub || '', views: sum((r) => r.experience === id),
    })).filter((n) => n.views),
  },
];

// a click without a target opened something on the page (a menu, a search box, a carousel): its
// key is the element's selector, marked so a reader does not take it for a destination
const NO_LINK = '\u0000';
const clickKey = (b, c) => {
  if (!c.target) return `${NO_LINK}${c.source}`;
  try {
    const u = new URL(c.target, b.url);
    return u.host === new URL(b.url).host ? o.normalizePath(u.pathname) : `${u.host}${o.normalizePath(u.pathname)}`;
  } catch { return c.target; }
};
const topClicks = (bs) => o.groupBy(bs, (b) => clicks(o, b).map((c) => clickKey(b, c)), { top: 5, total: o.weightOf(bs) })
  .map((g) => {
    const link = !String(g.key).startsWith(NO_LINK);
    return {
      click: link ? g.key : g.key.slice(1), link, share: g.share, bundles: g.bundles,
    };
  });

const times = views.map((b) => b.time || b.timeSlot).sort();
const WEEK = 7 * 24 * 3600 * 1000;
const t0 = Date.parse(times[0]);
const nWeeks = Math.max(1, Math.ceil((Date.parse(times[times.length - 1]) - t0 + 1) / WEEK));
const fullWeeks = Math.floor((Date.parse(times[times.length - 1]) - t0 + 1) / WEEK);
const weeksOf = (bs) => {
  const w = Array(nWeeks).fill(0);
  bs.forEach((b) => { w[Math.min(nWeeks - 1, Math.floor((Date.parse(b.time || b.timeSlot) - t0) / WEEK))] += b.weight || 0; });
  return w;
};
const rateOf = (bs, level) => {
  const w = o.weightOf(bs);
  return w ? o.weightOf(bs.filter((b) => o.activityOf(b) === level)) / w : 0;
};
const allNothing = rateOf(views, 'nothing');
const allNavigated = rateOf(views, 'navigated');

const ruleRows = ruleList.map((r) => {
  const bs = rows.filter((x) => x.rule === r.id).map((x) => x.b);
  const w = o.weightOf(bs);
  const weeks = weeksOf(bs);
  // growth needs two full weeks with enough views in each; the last window is often partial
  const firstW = bs.filter((b) => Date.parse(b.time || b.timeSlot) - t0 < WEEK).length;
  const lastW = bs.filter((b) => Math.floor((Date.parse(b.time || b.timeSlot) - t0) / WEEK) === fullWeeks - 1).length;
  const growth = fullWeeks >= 2 && firstW >= 10 && lastW >= 10 ? weeks[fullWeeks - 1] / weeks[0] : null;
  const navigated = rateOf(bs, 'navigated');
  const nothing = rateOf(bs, 'nothing');
  const vsAll = {
    navigated: allNavigated ? navigated / allNavigated : null,
    didNothing: allNothing ? nothing / allNothing : null,
  };
  // modelled rules are picked by what views click: their engagement is circular
  const standsOut = r.id !== 'none' && !r.model && bs.length >= o.LOW_SAMPLE && share(w) < 0.05
    && ((vsAll.navigated ?? 0) >= 1.5 || (vsAll.didNothing ?? 1) <= 0.6 || (growth ?? 0) >= 2);
  return {
    id: r.id,
    label: r.label || r.id,
    experience: r.experience,
    signal: signalOf(r.id === 'none' ? null : r),
    modelled: !!r.model,
    // visits.max without a model: every view counted as a first visit, the share is an upper bound
    firstVisitAssumed: assumesFirstVisit(r),
    views: w,
    share: share(w),
    bundles: bs.length,
    lowSample: bs.length < o.LOW_SAMPLE,
    today: {
      // a modelled rule's views are picked by the clicks that model its memory: its goal rate today is circular
      goalRate: r.model ? null : (bs.length ? bs.filter((b) => goalHit(o, r.goal, b)).length / bs.length : 0),
      didNothing: bs.length ? nothing : 0,
      navigated,
      vsAll,
      topClicks: topClicks(bs),
    },
    weeks,
    growth,
    standsOut,
  };
});

const out = {
  meta: {
    domain: o.hostOf(views[0]),
    path: pagePath,
    start: times[0],
    end: times[times.length - 1],
    views: total,
    bundles: views.length,
    weeks: nWeeks,
    fullWeeks,
    note: 'Sampled page views, bots and prerenders excluded. `weeks[]` are 7-day windows from `start`; the last one is partial when `weeks > fullWeeks`. `growth` is the last full week over the first, null without two full weeks of 10+ bundles each. `today.vsAll` compares a rule with all views (1 = the same; `didNothing` below 1 is better). `standsOut` marks a small rule (under 5% of views) that is clearly more engaged or growing 2x or more: call it out by name. Rules with `modelled: true` depend on on-device memory, which Optel cannot see: they are estimated at steady state from what views do today. Rules with `firstVisitAssumed: true` ask for a first visit, which Optel cannot see either: every view counts as one, so their share is an upper bound. `topClicks[].link: false` is a click that opened something on the page (menu, search, carousel) rather than a link: its `click` is the element selector.',
  },
  columns,
  links: [...linkMap.values()].map((l) => ({ ...l, rules: [...l.rules] })),
  rules: ruleRows,
  experiences: columns[3].nodes.map((n) => ({ id: n.id.slice(2), label: n.label, views: n.views, share: share(n.views) })),
  today: {
    didNothing: allNothing,
    navigated: allNavigated,
    topClicks: topClicks(views),
    weeks: weeksOf(views),
    devices: o.groupBy(views, o.device),
  },
};

const json = JSON.stringify(out, null, 1);
if (args.out) fs.writeFileSync(args.out, json); else process.stdout.write(`${json}\n`);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.error(`${out.meta.domain}${pagePath}: ${views.length} bundles, ~${Math.round(total).toLocaleString()} views`);
ruleRows.forEach((r) => console.error(`  ${r.id.padEnd(22)} ${pct(r.share).padStart(6)}  ${String(r.bundles).padStart(5)} bundles${r.lowSample ? '  (low sample)' : ''}${r.modelled ? '  (modelled)' : ''}${r.firstVisitAssumed ? '  (upper bound: every view counted as a first visit)' : ''}${r.growth ? `  ${r.growth.toFixed(1)}x week 1 → ${fullWeeks}` : ''}${r.standsOut ? `  ← stands out: ${(r.today.vsAll.navigated ?? 0).toFixed(1)}x as likely to go on to another page, ${(r.today.vsAll.didNothing ?? 0).toFixed(2)}x the no-click rate` : ''}`));
