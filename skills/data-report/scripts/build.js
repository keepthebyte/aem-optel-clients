#!/usr/bin/env node
/*
 * Build the data report: report.json → report.data.js → PDF, and check it.
 *
 *   node build.js --config report.json [--out Customer-Data-Report.pdf]
 *
 * The first run copies templates/report.html next to report.json; edit that copy for wording the
 * config does not cover. Checks, each of which fails the build:
 *   - a page whose content runs past its footer line (it would be cut off in print);
 *   - more pages in the PDF than sections in the report;
 *   - a script error in the page, or the logo named in report.json not loading.
 *
 * The page measures itself: opened with ?check it writes its findings into <script id="report-check">,
 * read here from Chrome's --dump-dom. No dependencies: Node 18+ and Chrome or Chromium
 * (CHROME=/path/to/binary if it is not found).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reduce, dataScript } from './lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = !argv[i + 1] || argv[i + 1].startsWith('--') ? true : argv[(i += 1)];
if (typeof args.config !== 'string') { console.error('usage: node build.js --config report.json [--out Report.pdf]'); process.exit(1); }

const cfgFile = path.resolve(args.config);
const dir = path.dirname(cfgFile);
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const html = path.join(dir, 'report.html');
if (!fs.existsSync(html)) { fs.copyFileSync(path.join(here, '../templates/report.html'), html); console.log(`copied the template to ${html}`); }
fs.writeFileSync(path.join(dir, 'report.data.js'), dataScript(reduce(cfg, dir)));
const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(dir, `${cfg.customer.replace(/[^\w]+/g, '-')}-What-the-Data-Shows.pdf`));

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  console.error('Chrome not found: set CHROME=/path/to/chrome');
  return process.exit(1);
}
const chrome = findChrome();
const run = (extra) => execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=8000', ...extra], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
});
const url = pathToFileURL(html).href;

const dom = run(['--window-size=1056,816', '--dump-dom', `${url}?check`]);
const found = dom.match(/<script type="application\/json" id="report-check">([\s\S]*?)<\/script>/);
if (!found) { console.error('No check result in the page: did a script fail? Open report.html?check in Chrome and read the console.'); process.exit(1); }
const check = JSON.parse(found[1]);
const problems = [...check.errors];
check.pages.forEach((p) => { if (p.room < 0) problems.push(`page ${p.page} (${p.kick}) overflows by ${-p.room}px: shorten it, or set fewer rows`); });
if (cfg.logo && !check.logo) problems.push(`the logo ${cfg.logo} did not load`);

run(['--no-pdf-header-footer', `--print-to-pdf=${out}`, url]);
const pdfPages = (fs.readFileSync(out, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
if (pdfPages !== check.pages.length) problems.push(`the PDF has ${pdfPages} pages for ${check.pages.length} sections: a page spills onto the next`);

console.log(`${out}: ${pdfPages} pages${check.font ? '' : ' (Adobe Clean is not installed: printed in the system font)'}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`); process.exit(2); }
console.log('checks passed: no overflow, no script errors');
