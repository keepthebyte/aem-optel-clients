#!/usr/bin/env node
/*
 * Step 2: merge. The cohorts of each site that share a need become one audience of the new
 * site: who it is made of, today's baseline, what is kept and what is gained.
 *
 *   node merge.js --rules merge-rules.js --out out/   reads out/sites.json → out/merged.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRules, parseArgs, mergeSites } from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.rules) { console.error('usage: node merge.js --rules merge-rules.js [--out <dir with sites.json>]'); process.exit(1); }
const rules = await loadRules(args.rules);
const out = args.out || '.';
const { sites } = JSON.parse(fs.readFileSync(path.join(out, 'sites.json'), 'utf8'));
const merged = mergeSites(rules, sites);
fs.writeFileSync(path.join(out, 'merged.json'), `${JSON.stringify(merged, null, 1)}\n`);
merged.layers.forEach((l) => console.error(`${l.label}: ~${l.visits.toLocaleString()} visits (${l.bundles} sampled, ${(l.shareOfAll * 100).toFixed(1)}% of all)${l.lowSample ? '  (low sample)' : ''} · ${(l.cross * 100).toFixed(1)}% reach another site today\n${l.audiences.map((a) => `  ${a.label.padEnd(26)} ${(a.share * 100).toFixed(1).padStart(5)}%  ${a.from.map((f) => `${f.site} ${(f.shareOfSite * 100).toFixed(0)}%`).join(', ')}`).join('\n')}`));
