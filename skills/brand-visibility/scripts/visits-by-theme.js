#!/usr/bin/env node
/*
 * Read 1: who arrives, by client theme. Uses the bundles and the rules of the site-merge skill.
 *
 *   node visits-by-theme.js --rules merge-rules.js --themes theme-rules.js --data data/ --out out/
 *     → out/visits-by-theme.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadMergeLib, loadThemes, visitsByTheme, sharedBy } from './lib.js';

const lib = await loadMergeLib();
const args = lib.parseArgs(process.argv.slice(2));
if (!args.rules || !args.themes || !args.data) { console.error('usage: node visits-by-theme.js --rules merge-rules.js --themes theme-rules.js --data <dir with <id>-site.jsonl> [--out <dir>]'); process.exit(1); }
const o = await lib.loadOptel();
const rules = await lib.loadRules(args.rules);
const themes = await loadThemes(args.themes);
const res = await visitsByTheme(o, lib, rules, themes, (site) => lib.readBundles(path.join(args.data, `${site.id}-site.jsonl`)));
const out = args.out || '.';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'visits-by-theme.json'), `${JSON.stringify(res, null, 1)}\n`);

const pct = (a, b) => `${(b ? (100 * a) / b : 0).toFixed(0)}%`;
const { meta } = res;
console.error(`${meta.period}: ~${meta.visits.toLocaleString()} visits, ${pct(meta.topical, meta.visits)} land on a page about a subject, ${pct(meta.themed, meta.topical)} of those match a theme`);
for (const [id, t] of Object.entries(res.themes).sort((a, b) => b[1].visits - a[1].visits)) {
  console.error(`  ${id.padEnd(22)} ${String(t.visits).padStart(9)}  ${sharedBy(t)} site(s)  search ${pct(t.search, t.visits)}  ai ${pct(t.ai, t.visits)}  ${t.top.slice(0, 2).map(([p]) => p).join('  ')}`);
}
console.error(`  ${'(no theme)'.padEnd(22)} ${String(res.unmatched.visits).padStart(9)}  ${res.unmatched.top.slice(0, 3).map(([p]) => p).join('  ')}`);
if (res.excluded.visits) console.error(`  ${'(excluded)'.padEnd(22)} ${String(res.excluded.visits).padStart(9)}`);
