#!/usr/bin/env node
/*
 * The picture: three reads on the left, merged by client theme, the job per theme on the right.
 *
 *   node three-reads.js --visits out/visits-by-theme.json --reads reads.json --out out/
 *     → out/three-reads.html   (?show=arrive | ask | want | plan reveals one read at a time)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMergeLib, threeReads } from './lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseArgs } = await loadMergeLib();
const args = parseArgs(process.argv.slice(2));
if (!args.visits || !args.reads) { console.error('usage: node three-reads.js --visits visits-by-theme.json --reads reads.json [--out <dir>]'); process.exit(1); }
const data = threeReads(JSON.parse(fs.readFileSync(args.visits, 'utf8')), JSON.parse(fs.readFileSync(args.reads, 'utf8')));
const tpl = fs.readFileSync(path.join(here, 'three-reads.template.html'), 'utf8');
const out = args.out || '.';
fs.mkdirSync(out, { recursive: true });
// "<" escaped so a text of the reads file cannot close the script element
fs.writeFileSync(path.join(out, 'three-reads.html'), tpl.replace('/*DATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c')));
console.error(`${path.join(out, 'three-reads.html')}: ${data.themes.length} themes, ${data.sites.length} sites`);
