#!/usr/bin/env node
/*
 * Join ABV citation attempts per page with Optel visits on the same pages and days.
 *
 *   node fetch-join.js --fetches fetches.txt[,more.txt] --bundles data/site.jsonl --from 2026-10-12 --to 2026-11-09 \
 *     [--scope '^/us-en'] [--sections sections.json] [--out out/fetch-join.json]
 *
 * --fetches   `path|hits|agent|share|category` per line, as the abv-traffic skill exports them; count only
 *             agents whose name ends in -User (a person is waiting for the answer). A later file overrides
 *             a path of an earlier one, for a second export that fills gaps.
 * --bundles   pulled bundles of the site (site-merge pull.js or optel-client --save), one JSON per line.
 * --to        exclusive. --scope strips a prefix and drops other paths (the fetch export is usually scoped too).
 * --sections  {"business": "^/business", "claims": "^/claims"}: first match wins; "/" is home, the rest other.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFetches, joinFetches } from './lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const o = await import(path.join(here, '../../../optel-client.js'));
const merge = await import(path.join(here, '../../site-merge/scripts/lib.js'));
const args = merge.parseArgs(process.argv.slice(2));
if (!args.fetches || !args.bundles || !args.from || !args.to) {
  console.error('usage: node fetch-join.js --fetches fetches.txt --bundles site.jsonl --from YYYY-MM-DD --to YYYY-MM-DD [--scope re] [--sections sections.json] [--out file]');
  process.exit(1);
}
const pages = readFetches(String(args.fetches).split(','));
const bundles = [];
for await (const b of merge.readBundles(args.bundles)) bundles.push(b);
const sections = args.sections ? JSON.parse(fs.readFileSync(args.sections, 'utf8')) : {};
const res = joinFetches(o, pages, bundles, { from: args.from, to: args.to, scope: args.scope || '', sections });
const out = typeof args.out === 'string' ? args.out : 'out/fetch-join.json';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const pct = (x) => `${Math.round((x / res.attempts) * 100)}%`;
console.log(`${out}: ${res.attempts} attempts on ${res.urls} pages, ${res.views} views and ${res.aiVisits} AI-referred views in the window`);
console.log('by section:', Object.entries(res.bySec).map(([k, s]) => `${k} ${s.attempts} (${pct(s.attempts)})`).join(', '));
console.log('by agent:', res.agents.slice(0, 5).map(([a, n]) => `${a} ${pct(n)}`).join(', '));
console.log('pages fetched with no sampled visit:', res.rows.filter((r) => !r.views).length);
