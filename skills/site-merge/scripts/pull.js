#!/usr/bin/env node
/*
 * Step 0: the raw bundles of each site, the whole site, over the same weeks.
 *
 *   node pull.js --rules merge-rules.js --start 2026-09-14 --end 2026-11-13 --data data/
 *
 * One domain key per site, from the environment only: OPTEL_DOMAIN_KEY_<ID> (the site id in
 * upper case, e.g. OPTEL_DOMAIN_KEY_SHOP). Keys are never written, printed or passed as arguments.
 * Writes <data>/<id>-site.jsonl. Keep that folder out of the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRules, parseArgs } from './lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.rules || !args.data || !(args.last || (args.start && args.end))) {
  console.error('usage: node pull.js --rules merge-rules.js --data <dir> (--start YYYY-MM-DD --end YYYY-MM-DD | --last 30d)');
  process.exit(1);
}
const rules = await loadRules(args.rules);
const client = [process.env.OPTEL_CLIENT, path.join(here, '../../aem-optel/optel-client.js'), path.join(here, '../../../optel-client.js')].filter(Boolean).find((p) => fs.existsSync(p));
const envOf = (site) => `OPTEL_DOMAIN_KEY_${site.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
const missing = rules.sites.filter((s) => !process.env[envOf(s)]);
if (missing.length) { console.error(`missing ${missing.map(envOf).join(', ')} (one domain key per site, in the environment)`); process.exit(1); }
fs.mkdirSync(args.data, { recursive: true });
const range = args.last ? ['--last', args.last] : ['--start', args.start, '--end', args.end];
const results = await Promise.all(rules.sites.map((site) => new Promise((resolve) => {
  const out = path.join(args.data, `${site.id}-site.jsonl`);
  const p = spawn('node', [client, '--domain', site.host, ...range, '--granularity', 'hour', '--report', 'raw', '--quiet', '--out', out], {
    env: { ...process.env, OPTEL_DOMAIN_KEY: process.env[envOf(site)] }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  p.on('close', (code) => { console.error(`${site.host}: ${code === 0 ? out : `failed (${code})`}`); resolve(code); });
})));
process.exit(results.some(Boolean) ? 1 : 0);
