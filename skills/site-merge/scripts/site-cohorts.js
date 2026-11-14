#!/usr/bin/env node
/*
 * Step 1: each site on its own. Visits per need, per traffic layer, with where they come from
 * and what they do.
 *
 *   node site-cohorts.js --rules merge-rules.js --data data/ --out out/   → out/sites.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadOptel, loadRules, parseArgs, readBundles, siteCohorts,
} from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.data) { console.error('usage: node site-cohorts.js --rules merge-rules.js --data <dir with <id>-site.jsonl> [--out <dir>]'); process.exit(1); }
const o = await loadOptel();
const rules = await loadRules(args.rules);
const sites = [];
for (const site of rules.sites) {
  const s = await siteCohorts(o, rules, site, readBundles(path.join(args.data, `${site.id}-site.jsonl`)));
  sites.push(s);
  console.error(`${site.host}: ~${s.visits.toLocaleString()} visits\n${rules.layers.map((l) => {
    const L = s.layers[l.id];
    return `  ${l.id.padEnd(5)} ${String(L.bundles).padStart(6)} sampled  ${(L.shareOfSite * 100).toFixed(1).padStart(5)}% of the site  ${L.cohorts.slice(0, 4).map((c) => `${c.need} ${(c.share * 100).toFixed(0)}%`).join(', ')}`;
  }).join('\n')}`);
}
const out = args.out || '.';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'sites.json'), `${JSON.stringify({ sites }, null, 1)}\n`);
