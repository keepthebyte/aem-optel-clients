#!/usr/bin/env node
/*
 * The holdout is only a holdout if the cohort page, with no rule matched, IS the original page.
 * Compares the sections of the original homepage with the sections the cohort page keeps for
 * `default` (Section Metadata: no `Cohorts`, or `Cohorts` containing `default`, and not `Hide For: default`).
 *
 *   node verify.js --original https://main--site--org.aem.page/ --cohort https://main--site--org.aem.page/new
 *
 * Reads the .plain.html of both (no browser). Exit code 1 on a mismatch, with the first difference.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.js';

const plainUrl = (u) => {
  const url = new URL(u);
  url.pathname = url.pathname.endsWith('/') ? `${url.pathname}index.plain.html` : `${url.pathname}.plain.html`;
  return url.href;
};

/* top-level <div> sections of a .plain.html body */
export function sections(html) {
  const out = []; let depth = 0; let start = -1;
  const re = /<(\/?)div\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    if (!m[1]) { if (depth === 0) start = m.index; depth += 1; } else {
      depth -= 1;
      if (depth === 0 && start >= 0) { out.push(html.slice(start, re.lastIndex)); start = -1; }
    }
  }
  return out;
}

const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const key = (k) => k.toLowerCase().replace(/[^a-z]/g, '');

/*
 * Section metadata → { cohorts, hidefor, slot, ... } and the section without its metadata block.
 * Two deliveries: a `section-metadata` block inside the section (document authoring), or
 * `data-*` attributes on the section's own <div> (Source Bus / Experience Workspace sites:
 * `<div data-slot="hero" data-cohorts="default">`). Read both.
 */
export function meta(section) {
  const open = section.match(/^<div\b([^>]*)>/i)?.[1] || '';
  const m = Object.fromEntries([...open.matchAll(/\sdata-([\w-]+)="([^"]*)"/gi)].map(([, k, v]) => [key(k), v.toLowerCase()]));
  const i = section.search(/<div class="section-metadata">/i);
  if (i < 0) return { m, body: section };
  const block = sections(section.slice(i))[0] || '';
  const rows = [...block.matchAll(/<div>\s*<div>([\s\S]*?)<\/div>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/gi)];
  rows.forEach(([, k, v]) => { m[key(text(k))] = text(v).toLowerCase(); });
  return { m, body: section.replace(block, '') };
}

const list = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
export const keptForDefault = ({ m }) => (!m.cohorts || list(m.cohorts).includes('default')) && !list(m.hidefor).includes('default');

/** The sections a visitor with no rule matched gets: kept for default, one per slot (as apply() does). */
export function defaultView(html) {
  const slotsSeen = new Set();
  return sections(html).map(meta).filter(keptForDefault).filter(({ m }) => {
    if (!m.slot) return true;
    if (slotsSeen.has(m.slot)) return false;
    slotsSeen.add(m.slot);
    return true;
  }).map((s) => text(s.body));
}

export const originalView = (html) => sections(html).map(meta).map((s) => text(s.body));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.original || !args.cohort) {
    console.error('usage: node verify.js --original <url of the homepage> --cohort <url of the cohort page>');
    process.exit(2);
  }
  const get = async (u) => {
    const r = await fetch(plainUrl(u));
    if (!r.ok) throw new Error(`${r.status} ${plainUrl(u)}`);
    return r.text();
  };
  const [orig, cohort] = await Promise.all([get(args.original), get(args.cohort)]);
  const a = originalView(orig);
  const b = defaultView(cohort);
  let ok = a.length === b.length;
  let first = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) { ok = false; first = i; break; }
  }
  if (ok) {
    console.log(`ok: the cohort page with no rule matched has the original's ${a.length} sections`);
    return;
  }
  console.log(`MISMATCH: original has ${a.length} sections, cohort page keeps ${b.length} for default`);
  if (first >= 0) {
    console.log(`first difference at section ${first + 1}:`);
    console.log(`  original: ${(a[first] || '(none)').slice(0, 160)}`);
    console.log(`  cohort:   ${(b[first] || '(none)').slice(0, 160)}`);
  }
  console.log('Fix: new sections need `Cohorts: <experience>` (or `Hide For: default`); default slots must be the original sections, unchanged.');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
