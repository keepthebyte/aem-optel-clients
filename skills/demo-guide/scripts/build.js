#!/usr/bin/env node
/*
 * Build a demo guide (templates/guide.html, filled in) into a PDF, and check it.
 *
 *   node build.js --guide guide.html [--out Guide.pdf] [--no-links]
 *
 * Checks, each of which fails the build:
 *   - a page whose content runs past its footer (or into an absolutely placed block such as
 *     the cover's bottom strip): it would be cut off in print;
 *   - more pages in the PDF than <section class="page"> in the guide;
 *   - an image that did not load, a link with no target, a {{placeholder}} left in the text;
 *   - a link that does not answer 200 (skipped with --no-links).
 *
 * The page measures itself: opened with ?check, the script at the end of the template writes
 * its findings into <script id="guide-check">, which is read here from Chrome's --dump-dom.
 * No dependencies: Node 18+ and Chrome or Chromium (CHROME=/path/to/binary if not found).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = !argv[i + 1] || argv[i + 1].startsWith('--') ? true : argv[(i += 1)];
if (!args.guide || args.guide === true) { console.error('usage: node build.js --guide guide.html [--out Guide.pdf] [--no-links]'); process.exit(1); }

const guide = path.resolve(args.guide);
const out = path.resolve(typeof args.out === 'string' ? args.out : guide.replace(/\.html?$/, '.pdf'));
const url = pathToFileURL(guide).href;

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
const run = (extra) => execFileSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=8000', ...extra], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
});

const problems = [];

// 1. the page's own measurements
const dom = run(['--dump-dom', `${url}?check`]);
const found = dom.match(/<script type="application\/json" id="guide-check">([\s\S]*?)<\/script>/);
if (!found) {
  console.error('No check result in the page: is the script at the end of templates/guide.html still in the guide?');
  process.exit(1);
}
const check = JSON.parse(found[1]);
check.pages.forEach((p) => {
  const room = p.limit - p.bottom;
  console.error(`page ${p.page}: content ends ${room >= 0 ? `${room}px above` : `${-room}px BELOW`} its limit`);
  if (room < 0) problems.push(`page ${p.page} overflows by ${-room}px: shorten it, or move something to another page`);
});
check.images.forEach((src) => problems.push(`image did not load: ${src}`));
check.empty.forEach((text) => problems.push(`link without a target: "${text}"`));
check.placeholders.forEach((text) => problems.push(`placeholder left in: ${text}`));

// 2. the PDF
run(['--no-pdf-header-footer', `--print-to-pdf=${out}`, url]);
const pdfPages = (fs.readFileSync(out, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
console.error(`${path.basename(out)}: ${pdfPages} page(s), ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
if (pdfPages !== check.pages.length) problems.push(`the PDF has ${pdfPages} pages for ${check.pages.length} sections: a page spills onto the next`);

// 3. the links
const links = [...new Set(check.links)].filter((l) => /^https?:/.test(l));
if (args['no-links']) {
  console.error(`links: ${links.length} not checked (--no-links)`);
} else {
  const results = await Promise.all(links.map(async (l) => {
    try {
      const r = await fetch(l, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      return [l, r.status];
    } catch (e) { return [l, e.name]; }
  }));
  results.forEach(([l, status]) => { if (status !== 200) problems.push(`link answers ${status}: ${l}`); });
  console.error(`links: ${results.filter(([, s]) => s === 200).length} of ${links.length} answer 200`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.error('ok');
console.log(out);
