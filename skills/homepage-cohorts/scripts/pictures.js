#!/usr/bin/env node
/*
 * Pictures per cohort: which pictures each rule's views have in view on the homepage, how many
 * pictures down the page they get (how long a picture story each cohort will actually see), and,
 * with the whole site, which pictures the same groups see where they land elsewhere and on the
 * pages they open right after the homepage. Input for picture stories (references/picture-stories.md).
 *
 *   node pictures.js --rules scripts/cohort-rules.js --bundles home.jsonl --out pictures.json
 *   [--site site.jsonl]   the whole site over the same weeks: adds `landing` and `afterHome`
 *   [--path /]            the homepage path (comma list allowed), as for size.js
 *   [--match <regex>]     keep only media URLs that match (the site's picture host or folder:
 *                         'scene7\.com/is/' or 'media_'), so logos and icons drop out
 *   [--kinds kinds.json]  [["interior", "interior|cockpit|seat"], ["charging", "charg|wallbox"], ...]:
 *                         first matching regex on the file name gives the picture's kind; per rule,
 *                         the share of views that saw at least one picture of each kind
 *   [--top 12]            pictures per list
 *
 * viewmedia records a picture scrolled into view: exposure, not preference. A cohort that sees
 * a picture more often scrolls further, or lands on the pages that carry it; it does not like it
 * more. Read differences as "this is where the group is and what is in front of it".
 */
import fs from 'node:fs';
import { labelFor } from '../engine/ew-panel/model.js';
import {
  loadOptel, loadRules, readBundles, parseArgs, ruleOf, cohortViews, agentRuleIds,
} from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.bundles) {
  console.error('usage: node pictures.js --rules cohort-rules.js --bundles home.jsonl [--site site.jsonl] [--path /[,/b...]] [--label "..."] [--match <regex>] [--kinds kinds.json] [--top 12] [--out pictures.json]');
  process.exit(1);
}
const o = await loadOptel();
const rules = await loadRules(args.rules);
const top = Number(args.top) || 12;
const match = args.match ? new RegExp(args.match, 'i') : null;
const kinds = args.kinds ? JSON.parse(fs.readFileSync(args.kinds, 'utf8')).map(([k, r]) => [k, new RegExp(r, 'i')]) : [];
const DEPTH = 6;

const nameOf = (key) => decodeURIComponent(key.split('/').filter(Boolean).pop() || key);
const kindOf = (key) => (kinds.find(([, r]) => r.test(nameOf(key))) || ['other'])[0];

/** The distinct pictures a view had in view, in the order they came into view: [{ key, selector }]. */
function picturesOf(b) {
  const seen = new Map();
  o.events(b, 'viewmedia').forEach((e) => {
    if (!e.target || (match && !match.test(e.target))) return;
    // crops of one image are one picture: Dynamic Media smart crops end in ':<crop>' ('…/teaser:1to1')
    const key = o.mediaKey(e.target).replace(/(\/[^/]+):[\w-]+$/, '$1');
    if (!seen.has(key)) seen.set(key, e.source || '');
  });
  return [...seen].map(([key, selector]) => ({ key, selector }));
}

/** Reach of each picture in a set of views: share of the views' weight that had it in view. */
function reachOf(views, { base } = {}) {
  const w = o.weightOf(views);
  const by = new Map();
  views.forEach((b) => picturesOf(b).forEach((p, i) => {
    const r = by.get(p.key) || { weight: 0, bundles: 0, selectors: {}, order: 0 };
    r.weight += b.weight || 0; r.bundles += 1; r.order += i;
    r.selectors[p.selector] = (r.selectors[p.selector] || 0) + 1;
    by.set(p.key, r);
  }));
  return [...by].map(([key, r]) => {
    const share = w ? r.weight / w : 0;
    const all = base?.get(key);
    return {
      key,
      name: nameOf(key),
      kind: kinds.length ? kindOf(key) : undefined,
      selector: Object.entries(r.selectors).sort((a, b) => b[1] - a[1])[0][0],
      share,
      bundles: r.bundles,
      // 1 = as often as all homepage views; above 1: this group has it in view more often
      vsAll: all ? share / all : null,
      // average position among the pictures the view saw (0 = the first one)
      position: +(r.order / r.bundles).toFixed(1),
    };
  }).sort((a, b) => b.share - a.share);
}

/** Share of views that saw at least 1..DEPTH pictures: how many story beats the group reaches. */
function depthOf(views) {
  const w = o.weightOf(views);
  const out = Array(DEPTH).fill(0);
  views.forEach((b) => {
    const n = picturesOf(b).length;
    for (let i = 0; i < Math.min(n, DEPTH); i += 1) out[i] += b.weight || 0;
  });
  return out.map((x) => (w ? +(x / w).toFixed(3) : 0));
}

function kindsOf(views) {
  if (!kinds.length) return undefined;
  const w = o.weightOf(views);
  const by = {};
  views.forEach((b) => new Set(picturesOf(b).map((p) => kindOf(p.key))).forEach((k) => { by[k] = (by[k] || 0) + (b.weight || 0); }));
  return Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, x]) => [k, +(x / w).toFixed(3)]));
}

const all = readBundles(args.bundles);
const pagePath = args.path || '/';
const pathList = String(pagePath).split(',').map((p) => p.trim()).filter(Boolean);
const paths = new Set(pathList.map((p) => o.normalizePath(p)));
// what views print after the domain: --label, else the path or "first +N more"
const pathShown = args.label || labelFor(pathList);
const agentRules = agentRuleIds(rules);
const views = cohortViews(o, all, (b) => agentRules.has(ruleOf(o, rules, b).rule)).filter((b) => paths.has(o.pathOf(b)));
if (!views.length) { console.error(`no human views of ${pathShown} in ${args.bundles}`); process.exit(1); }
const withMedia = views.filter((b) => picturesOf(b).length).length;
if (!withMedia) console.error(`warning: no viewmedia events${match ? ` matching ${match}` : ''} on ${pathShown}: check --match, or the site sends none`);

const home = reachOf(views);
const homeBase = new Map(home.map((p) => [p.key, p.share]));
const ruleList = [...(rules.rules || []), { id: 'none', label: 'No rule matched', experience: 'default' }];
const tagged = views.map((b) => ({ b, m: ruleOf(o, rules, b) }));

const ruleRows = ruleList.map((r) => {
  const bs = tagged.filter((x) => (x.m.rule || 'none') === r.id).map((x) => x.b);
  return {
    id: r.id,
    label: r.label || r.id,
    experience: r.experience,
    modelled: !!r.model,
    bundles: bs.length,
    lowSample: bs.length < o.LOW_SAMPLE,
    depth: depthOf(bs),
    kinds: kindsOf(bs),
    pictures: reachOf(bs, { base: homeBase }).slice(0, top),
    // pictures this group has in view clearly more often than everyone (at least 1.5x, 10+ bundles)
    leansTo: reachOf(bs, { base: homeBase }).filter((p) => p.bundles >= 10 && (p.vsAll ?? 0) >= 1.5).slice(0, 5).map((p) => p.name),
  };
});

/* The whole site: the same groups where they land elsewhere (the rule is evaluated on the landing
   view, observable signals only: referrer, campaign, ad click, device; memory is not in Optel),
   and the pages opened right after the homepage (only device can be split there: the referrer is
   the homepage). These are the pictures the site already uses for what each group came for. */
let landing = null;
let afterHome = null;
if (args.site) {
  const site = o.realViews(readBundles(args.site));
  const from = [...paths];
  const lands = site.filter((b) => !paths.has(o.pathOf(b)) && o.events(b, 'enter').length);
  landing = ruleList.filter((r) => !r.model && !(r.when && r.when.agent)).map((r) => {
    const bs = lands.filter((b) => (ruleOf(o, { ...rules, rules: (rules.rules || []).filter((x) => !x.model) }, b).rule || 'none') === r.id);
    const pages = o.groupBy(bs, (b) => o.pathOf(b), { top: 5, total: o.weightOf(bs) });
    const pics = reachOf(bs).slice(0, top).map((p) => {
      const on = o.groupBy(bs.filter((b) => picturesOf(b).some((x) => x.key === p.key)), (b) => o.pathOf(b), { top: 1 })[0];
      return { ...p, vsAll: undefined, page: on ? on.key : null };
    });
    return {
      id: r.id, bundles: bs.length, lowSample: bs.length < o.LOW_SAMPLE, pages: pages.map((x) => ({ path: x.key, share: x.share })), pictures: pics,
    };
  });
  const after = site.filter((b) => o.events(b, 'navigate').some((e) => e.source && from.includes(o.normalizePath(e.source))));
  const deviceOf = (b) => (o.device(b) === 'mobile' ? 'mobile' : 'desktop');
  afterHome = Object.fromEntries(['all', 'mobile', 'desktop'].map((d) => {
    const bs = d === 'all' ? after : after.filter((b) => deviceOf(b) === d);
    return [d, {
      bundles: bs.length,
      pages: o.groupBy(bs, (b) => o.pathOf(b), { top: 5, total: o.weightOf(bs) }).map((x) => ({ path: x.key, share: x.share })),
      pictures: reachOf(bs).slice(0, top).map((p) => ({ ...p, vsAll: undefined })),
    }];
  }));
}

const times = views.map((b) => b.time || b.timeSlot).sort();
const out = {
  meta: {
    domain: o.hostOf(views[0]),
    path: pathShown,
    paths: pathList,
    start: times[0],
    end: times[times.length - 1],
    bundles: views.length,
    withPictures: withMedia,
    match: args.match || null,
    note: 'viewmedia = a picture scrolled into view: exposure, not preference. `pictures[].share` = share of the group\'s views that had the picture in view; `vsAll` against all homepage views (above 1: in view more often, usually because the group scrolls further or gets other renditions); `position` = average order among the pictures a view saw (0 = first). `depth[i]` = share of views that saw at least i+1 pictures: how many beats of a picture story the group reaches. `landing` (with --site): the group\'s landing views on other pages, rule evaluated on observable signals only. `afterHome`: the pages opened right after the homepage, by device. Renditions of one image are one picture (AEM width suffixes, query strings); separate mobile and desktop files are not: group them with --kinds.',
  },
  pictures: home.slice(0, top * 2),
  depth: depthOf(views),
  kinds: kindsOf(views),
  rules: ruleRows,
  landing,
  afterHome,
};

const json = JSON.stringify(out, null, 1);
if (args.out) fs.writeFileSync(args.out, json); else process.stdout.write(`${json}\n`);
const pct = (x) => `${(x * 100).toFixed(0)}%`;
console.error(`${out.meta.domain}${pathShown}: ${views.length} bundles, ${withMedia} with pictures in view; 1/2/3/4 pictures reached by ${out.depth.slice(0, 4).map(pct).join(' / ')}`);
ruleRows.forEach((r) => console.error(`  ${r.id.padEnd(22)} ${String(r.bundles).padStart(5)} bundles  beats ${r.depth.slice(0, 4).map(pct).join('/')}${r.leansTo.length ? `  leans to ${r.leansTo.slice(0, 3).join(', ')}` : ''}${r.lowSample ? '  (low sample)' : ''}`));
