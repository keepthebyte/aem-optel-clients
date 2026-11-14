#!/usr/bin/env node
/*
 * Step 3: the picture. Each site on its own on the left (its cohorts), the audiences of the
 * merged site on the right with what each keeps and gains, one layer of traffic at a time.
 *
 *   node sankey.js --rules merge-rules.js --out out/ [--title "Four sites, one front door"]
 *   reads out/sites.json + out/merged.json → out/sankey.html (self-contained)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, parseArgs } from './lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.rules) { console.error('usage: node sankey.js --rules merge-rules.js [--out <dir>] [--title <text>]'); process.exit(1); }
const rules = await loadRules(args.rules);
const out = args.out || '.';
const { sites } = JSON.parse(fs.readFileSync(path.join(out, 'sites.json'), 'utf8'));
const merged = JSON.parse(fs.readFileSync(path.join(out, 'merged.json'), 'utf8'));
const title = args.title || rules.title || `${sites.length} sites, one front door`;
const needLabels = { home: 'Homepage, no next step', other: 'Other pages', ...rules.needLabels };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const html = fs.readFileSync(path.join(here, 'sankey.template.html'), 'utf8')
  .replaceAll('{{TITLE}}', () => esc(title))
  .replace('/*DATA*/null', () => JSON.stringify({ sites, merged, needLabels }).replace(/</g, '\\u003c'));
fs.writeFileSync(path.join(out, 'sankey.html'), html);
console.error(`wrote ${path.join(out, 'sankey.html')}`);
