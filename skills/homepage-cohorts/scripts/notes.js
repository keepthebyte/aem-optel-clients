#!/usr/bin/env node
/*
 * Move the Insight notes out of a cohort page. Section Metadata is published with the page, so
 * a note written there is public, numbers included (content-model.md, "Notes live in a file
 * that is not published"). This reads the page's stored HTML (the source document, div form),
 * gives every written note an id, puts the id in the page and the note in a notes file.
 *
 *   node notes.js new.html --out new.out.html --notes insights.json [--merge insights.json]
 *
 * - An `Insight` value that is already an id (one word) is left alone.
 * - Ids come from the section: its Slot and first Cohorts value ("hero-member-xsell-pet"), else
 *   its heading ("built-to-pay-claims"), else note-<n>. They are unique within the file.
 * - --merge keeps the notes of an earlier run (same text: same id; an id is never reused).
 * - The notes file is { "data": [{ "id", "note" }] }: publish it nowhere, preview it only.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
  .replace(/\s+/g, ' ')
  .trim();
const decode = (html) => strip(html).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const slug = (s, words = 5) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean)
  .slice(0, words)
  .join('-');
export const isRef = (v) => /^[\w-]+$/.test(v.trim());

const CELLS = '<div>\\s*<div>((?:(?!</div>).)*)</div>\\s*<div>((?:(?!</div>).)*)</div>\\s*</div>';
const ROW = new RegExp(CELLS, 'gs');
// the block's opening tag and its rows (key / value); a metadata cell holds no div
const META = new RegExp(`<div class="section-metadata">((?:\\s*${CELLS.replace(/\((?!\?)/g, '(?:')})+)`, 'gs');

/**
 * @param {string} html the page's stored HTML
 * @param {{ id: string, note: string }[]} known notes of an earlier run
 * @returns {{ html: string, notes: { id: string, note: string }[], moved: number }}
 */
export function moveNotes(html, known = []) {
  const notes = known.map((n) => ({ ...n }));
  const taken = new Set(notes.map((n) => n.id));
  let moved = 0;
  let from = 0;
  const out = html.replace(META, (block, inner, at) => {
    const rows = [...inner.matchAll(ROW)].map((m) => ({ key: strip(m[1]).toLowerCase(), raw: m[2], all: m[0] }));
    const row = rows.find((r) => r.key === 'insight');
    const before = html.slice(from, at);
    from = at + block.length;
    if (!row) return block;
    const note = decode(row.raw);
    if (!note || isRef(note)) return block;
    let id = notes.find((n) => n.note === note)?.id;
    if (!id) {
      const val = (k) => strip(rows.find((r) => r.key === k)?.raw || '');
      const cohort = val('cohorts').split(',')[0].trim();
      const heading = [...before.matchAll(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/gs)].pop()?.[1] || '';
      const base = (val('slot') && slug(`${val('slot')} ${cohort}`)) || slug(strip(heading), 4) || slug(cohort) || 'note';
      id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
      taken.add(id);
      notes.push({ id, note });
    }
    moved += 1;
    return block.replace(row.all, row.all.replace(row.raw, id));
  });
  return { html: out, notes, moved };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
  const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
  if (!file || !opt('out') || !opt('notes')) {
    console.error('usage: node notes.js <page.html> --out <page.out.html> --notes <insights.json> [--merge <insights.json>]');
    process.exit(1);
  }
  const merge = opt('merge') && fs.existsSync(opt('merge')) ? JSON.parse(fs.readFileSync(opt('merge'), 'utf8')).data || [] : [];
  const r = moveNotes(fs.readFileSync(file, 'utf8'), merge);
  fs.writeFileSync(opt('out'), r.html);
  fs.writeFileSync(opt('notes'), `${JSON.stringify({ data: r.notes }, null, 2)}\n`);
  console.log(`${r.moved} notes moved, ${r.notes.length} in ${opt('notes')}`);
}
