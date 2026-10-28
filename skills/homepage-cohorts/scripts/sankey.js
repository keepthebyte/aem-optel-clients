#!/usr/bin/env node
/*
 * Render cohorts.json as a Sankey: entry source → device → rule (first match wins) → experience.
 *
 *   node sankey.js --in cohorts.json --out sankey   →  sankey.svg + sankey.html
 *   [--title "..."] [--subtitle "..."]
 *
 * Every flow carries data-col and data-rules, every node data-n and data-col, so the video
 * skill can reveal columns and light up one rule's path.
 */
import fs from 'node:fs';
import { parseArgs } from './lib.js';

const args = parseArgs(process.argv.slice(2));
if (!args.in) { console.error('usage: node sankey.js --in cohorts.json [--out sankey] [--title ...]'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(args.in, 'utf8'));
const outBase = args.out || 'sankey';

const SIG = {
  link: { label: 'Where they came from (referrer / UTM / ad)', color: '#2f74d0' },
  memory: { label: 'Visit memory (on device)', color: '#17a08a' },
  device: { label: 'Device', color: '#e8693c' },
  none: { label: 'No signal', color: '#9a9a9a' },
};
const ORDER = ['link', 'memory', 'device', 'none'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const total = data.meta.views;
const pct = (v) => `${((v / total) * 100).toFixed(1)}%`;

const W = 2000; const top = 300; const bottom = 1090; const H = 1220;
const colX = [62, 495, 928, 1361]; const barW = 14; const pad = 46; const minH = 3;
const node = {};
data.columns.forEach((c, ci) => c.nodes.forEach((n, ni) => { node[n.id] = { ...n, ci, ni }; }));
const avail = Math.min(...data.columns.map((c) => (bottom - top) - (c.nodes.length - 1) * pad));
const k = avail / total;
data.columns.forEach((c) => {
  let y = top;
  c.nodes.forEach((n0) => { const n = node[n0.id]; n.x = colX[n.ci]; n.y = y; n.h = Math.max(minH, n.views * k); y += n.h + pad; });
});

const links = data.links.map((l) => ({ ...l }));
const ord = (a, b, key) => node[a[key]].ni - node[b[key]].ni || ORDER.indexOf(a.signal) - ORDER.indexOf(b.signal);
Object.values(node).forEach((n) => {
  let yo = n.y; let yi = n.y;
  const sc = n.h / (n.views * k || 1);
  links.filter((l) => l.s === n.id).sort((a, b) => ord(a, b, 't')).forEach((l) => { l.sw = l.views * k * sc; l.y0 = yo + l.sw / 2; yo += l.sw; });
  links.filter((l) => l.t === n.id).sort((a, b) => ord(a, b, 's')).forEach((l) => { l.tw = l.views * k * sc; l.y1 = yi + l.tw / 2; yi += l.tw; });
});

const paths = links.map((l) => {
  const x0 = node[l.s].x + barW; const x1 = node[l.t].x; const xm = (x0 + x1) / 2;
  const w = Math.max(1, (l.sw + l.tw) / 2);
  return `<path class="flow" data-col="${node[l.s].ci}" data-s="${l.s}" data-t="${l.t}" data-rules="${l.rules.join(' ')}" d="M${x0},${l.y0.toFixed(1)}C${xm},${l.y0.toFixed(1)} ${xm},${l.y1.toFixed(1)} ${x1},${l.y1.toFixed(1)}" stroke="${SIG[l.signal].color}" stroke-width="${w.toFixed(1)}"><title>${esc(node[l.s].label)} → ${esc(node[l.t].label)}: ${pct(l.views)}</title></path>`;
}).join('\n');

const bars = Object.values(node).map((n) => `<rect class="bar" data-col="${n.ci}" data-n="${n.id}" x="${n.x}" y="${n.y.toFixed(1)}" width="${barW}" height="${n.h.toFixed(1)}" rx="2"${n.signal ? ` style="fill:${SIG[n.signal].color}"` : ''}><title>${esc(n.label)}: ${pct(n.views)}</title></rect>`).join('\n');

const labels = Object.values(node).map((n) => {
  const x = n.x + barW + 14; const cy = n.y + n.h / 2;
  let t;
  if (n.ci < 2) {
    t = n.views / total < 0.03
      ? `<text class="lbl" x="${x}" y="${cy + 7}"><tspan class="nm sm">${esc(n.label)}</tspan> <tspan class="pc">${pct(n.views)}</tspan></text>`
      : `<text class="lbl" x="${x}" y="${cy - 2}"><tspan class="nm">${esc(n.label)}</tspan></text><text class="lbl" x="${x}" y="${cy + 26}"><tspan class="pc">${pct(n.views)}</tspan></text>`;
  } else {
    t = `<text class="lbl" x="${x}" y="${cy - 4}"><tspan class="nm ${n.ci === 3 ? 'xl' : 'md'}">${esc(n.label)}</tspan> <tspan class="pc">${pct(n.views)}</tspan></text>${n.sub ? `<text class="lbl" x="${x}" y="${cy + 24}"><tspan class="sub">${esc(n.sub)}</tspan></text>` : ''}`;
  }
  return `<g class="nl" data-col="${n.ci}" data-n="${n.id}">${t}</g>`;
}).join('\n');

const heads = data.columns.map((c, i) => `<text class="head${i === 3 ? ' strong' : ''}" data-col="${i}" x="${colX[i]}" y="${top - 30}">${esc(c.head.toUpperCase())}</text>`).join('\n');
const used = ORDER.filter((s) => links.some((l) => l.signal === s));
let lx = 420;
const legend = ['<text class="legend" x="62" y="215">Flow colour = the signal that decided:</text>'].concat(used.map((s) => {
  const r = `<rect x="${lx}" y="198" width="20" height="20" rx="3" fill="${SIG[s].color}"/><text class="legend" x="${lx + 30}" y="215">${esc(SIG[s].label)}</text>`;
  lx += 62 + SIG[s].label.length * 8.6; return r;
})).join('\n');

const days = Math.max(1, Math.round((new Date(data.meta.end) - new Date(data.meta.start)) / 864e5));
const title = args.title || 'First match wins: how every visit picks its homepage';
const subtitle = args.subtitle || `${data.meta.domain}${data.meta.path} traffic, run through the cohort rules in order. Each visit gets the experience of the first rule it matches.`;
const modelled = data.rules.filter((r) => r.modelled).map((r) => r.label).join(', ');
const foot1 = `Source: AEM Operational Telemetry, ${data.meta.domain}${data.meta.path}, ${days} days to ${data.meta.end.slice(0, 10)}, ${data.meta.bundles.toLocaleString()} sampled views (bots and prerenders excluded).`;
const foot2 = modelled ? `Modelled at steady state (on-device memory is not in Optel): ${modelled}. The 10% holdout sees the original page and is not shown.` : 'The 10% holdout sees the original page and is not shown.';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">Sankey of homepage views from entry source and device through the cohort rule that fires to the homepage experience served.</desc>
<rect width="${W}" height="${H}" fill="#fff"/>
<text class="title" x="62" y="96">${esc(title)}</text>
<text class="subtitle" x="62" y="150">${esc(subtitle)}</text>
${legend}
${heads}
<g class="flows">${paths}</g>
${bars}
${labels}
<text class="foot" x="62" y="${H - 70}">${esc(foot1)}</text>
<text class="foot" x="62" y="${H - 42}">${esc(foot2)}</text>
</svg>`;

const css = `.title{font-size:50px;font-weight:700;fill:#111;letter-spacing:-.5px}.subtitle{font-size:25px;fill:#444}.legend{font-size:20px;fill:#444}
.head{font-size:17px;font-weight:600;letter-spacing:2px;fill:#777}.head.strong{fill:#111;font-weight:700}
.flow{fill:none;stroke-opacity:.38;mix-blend-mode:multiply}.flow:hover{stroke-opacity:.7}.bar{fill:#3a3a3a}
.lbl{paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}.nm{font-size:28px;font-weight:600;fill:#111}
.nm.sm{font-size:21px}.nm.md{font-size:23px}.nm.xl{font-size:27px}.pc{font-size:21px;fill:#444}.sub{font-size:18px;fill:#444}.foot{font-size:17px;fill:#777}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Homepage Cohort Rules</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#fff}body{font-family:'Source Sans 3',system-ui,sans-serif}svg{display:block;width:100%;max-width:2000px;height:auto}${css}</style>
</head><body>${svg}</body></html>`;

fs.writeFileSync(`${outBase}.svg`, svg.replace('<rect width', `<style>text{font-family:'Source Sans 3',system-ui,sans-serif}${css}</style><rect width`));
fs.writeFileSync(`${outBase}.html`, html);
console.error(`wrote ${outBase}.svg and ${outBase}.html`);
