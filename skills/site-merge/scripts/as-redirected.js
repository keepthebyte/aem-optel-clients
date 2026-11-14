#!/usr/bin/env node
/*
 * For the runtime half (references/runtime.md): the homepage views of every site as they will
 * be once the sites redirect to the target, so the homepage-cohorts skill can size
 * `from-<id>` rules before a single redirect exists.
 *
 *   node as-redirected.js --rules merge-rules.js --data data/ --out data/
 *   → <out>/merged-home.jsonl   homepage views, the other sites' as arrivals on the target's homepage
 *   → <out>/merged-site.jsonl   every view of every site (for size.js --site)
 *   then: node ../homepage-cohorts/scripts/size.js --rules cohort-rules.js \
 *           --bundles <out>/merged-home.jsonl --site <out>/merged-site.jsonl --path <target homePath>
 *
 * A redirected view keeps what the visitor did; its URL becomes the target's homepage and its
 * referrer the old site (what `?from=<id>` turns into in the browser). Views inside a site
 * (no `enter`) stay without a referrer.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadOptel, loadRules, parseArgs, readBundles, redirected,
} from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.data) { console.error('usage: node as-redirected.js --rules merge-rules.js --data <dir> [--out <dir>]'); process.exit(1); }
const o = await loadOptel();
const rules = await loadRules(args.rules);
const target = rules.sites.find((s) => s.target);
if (!target || rules.sites.some((s) => !s.homePath)) { console.error('merge-rules: one site needs `target: true` and every site a `homePath`'); process.exit(1); }

const out = args.out || args.data;
fs.mkdirSync(out, { recursive: true });
const home = fs.createWriteStream(path.join(out, 'merged-home.jsonl'));
const all = fs.createWriteStream(path.join(out, 'merged-site.jsonl'));
const homePaths = new Set(rules.sites.map((s) => o.normalizePath(s.homePath)));
for (const site of rules.sites) {
  let n = 0;
  for await (const b of readBundles(path.join(args.data, `${site.id}-site.jsonl`))) {
    const p = o.pathOf(b);
    const isHome = p === o.normalizePath(site.homePath);
    // a page that only shares a homepage path with another site ('/' here, '/index.html' there)
    if (!isHome && homePaths.has(p)) continue;
    all.write(`${JSON.stringify(b)}\n`);
    if (isHome) { home.write(`${JSON.stringify(redirected(b, site, target))}\n`); if (!o.isBot(b)) n += b.weight || 0; }
  }
  console.error(`${site.host}${site.homePath}: ~${n.toLocaleString()} views`);
}
await Promise.all([home, all].map((s) => new Promise((r) => { s.end(r); })));
