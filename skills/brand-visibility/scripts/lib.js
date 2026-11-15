/*
 * Brand visibility: shared helpers. Read 1 (who arrives) by client theme, on top of the visit
 * classification of the site-merge skill, so both skills count a visit the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadMergeLib() {
  const tries = [process.env.SITE_MERGE_LIB, path.join(here, '../../site-merge/scripts/lib.js')].filter(Boolean);
  const found = tries.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`site-merge/scripts/lib.js not found (tried ${tries.join(', ')}); set SITE_MERGE_LIB`);
  return import(pathToFileURL(path.resolve(found)).href);
}

export async function loadThemes(file) {
  const m = await import(pathToFileURL(path.resolve(file)).href);
  const t = m.default || m;
  if (!Array.isArray(t.themes) || !t.themes.length) throw new Error(`${file}: \`themes\` is missing or empty`);
  t.themes.forEach((x) => { if (!x.id || !x.words) throw new Error(`${file}: every theme needs an id and words`); });
  return { topical: ['solutions', 'insights', 'campaign', 'other'], ...t };
}

/** A landing page path as words: "/en/insights/cyber-risk_2026.html" → " en insights cyber risk 2026 ". */
export const pathWords = (p) => ` ${decodeURIComponent(String(p).replace(/%(?![0-9a-f]{2})/gi, ' ')).toLowerCase().replace(/\.html?$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** path → theme id, 'excluded', or undefined. Whole words, first theme that matches wins. */
export function themeMatcher(themes) {
  const whole = (w) => new RegExp(`\\b(${w})\\b`, 'i');
  const list = themes.themes.map((t) => [t.id, whole(t.words)]);
  const out = themes.exclude ? whole(themes.exclude) : null;
  return (p) => {
    const t = pathWords(p);
    if (out && out.test(t)) return 'excluded';
    return (list.find(([, re]) => re.test(t)) || [])[0];
  };
}

const pathOfTarget = (t) => { try { return new URL(String(t || ''), 'https://x.invalid').pathname; } catch { return ''; } };
const TOP = 12;
const top = (pages) => Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, TOP);

/**
 * Read 1 by theme. `bundlesOf(site)` is an (async) iterable of the raw bundles of one site.
 * Visits are entry page views, bots excluded, weighted by the sample.
 */
export async function visitsByTheme(o, lib, rules, themes, bundlesOf) {
  const needOf = lib.needMatcher(rules);
  const themeOf = themeMatcher(themes);
  const topical = new Set(themes.topical);
  const blank = () => ({ visits: 0, search: 0, ai: 0, cross: 0, sites: {}, pages: {} });
  const T = Object.fromEntries(themes.themes.map((t) => [t.id, { label: t.label || t.id, ...blank() }]));
  const none = blank(); const excluded = blank();
  const sites = []; const meta = { visits: 0, topical: 0, themed: 0 };
  let from = ''; let to = '';
  for (const site of rules.sites) {
    const S = { id: site.id, name: site.label || site.host.replace(/^www\./, '') + (site.scopeLabel ? ` ${site.scopeLabel}` : ''), visits: 0, topical: 0, themed: 0 };
    for await (const b of bundlesOf(site)) {
      if (o.isBot(b) || !o.isPageView(b) || !o.isVisit(b)) continue;
      const w = b.weight || 0;
      const day = String(b.time || '').slice(0, 10);
      if (day) { if (!from || day < from) from = day; if (day > to) to = day; }
      S.visits += w;
      const v = lib.classifyVisit(o, rules, site, b, needOf);
      if (site.scope && !new RegExp(site.scope, 'i').test(v.path)) { S.outOfScope = (S.outOfScope || 0) + w; S.visits -= w; continue; }
      if (!topical.has(v.need)) continue;
      S.topical += w;
      // a homepage visit has no theme of its own: it takes the theme of the first click that has one;
      // a site that is about one thing (themes.sites) gives that theme to what is left
      let id = themeOf(v.path);
      if (!id && v.viaHome) id = o.events(b, 'click').map((e) => pathOfTarget(e.target)).map(themeOf).find(Boolean);
      if (!id && themes.sites && themes.sites[site.id]) id = themes.sites[site.id];
      const row = id === 'excluded' ? excluded : (T[id] || none);
      if (T[id]) S.themed += w;
      row.visits += w;
      if (v.channel === 'search') row.search += w;
      if (v.channel === 'ai') row.ai += w;
      if (v.cross) row.cross += w;
      row.sites[site.id] = (row.sites[site.id] || 0) + w;
      const p = v.path.toLowerCase();
      row.pages[p] = (row.pages[p] || 0) + w;
    }
    sites.push(S);
    ['visits', 'topical', 'themed'].forEach((k) => { meta[k] += S[k]; });
  }
  const done = (r) => { const { pages, ...rest } = r; return { ...rest, share: meta.topical ? r.visits / meta.topical : 0, top: top(pages) }; };
  return {
    meta: { period: from ? `${from} to ${to}` : '', ...meta },
    sites,
    themes: Object.fromEntries(Object.entries(T).map(([id, r]) => [id, done(r)])),
    unmatched: done(none),
    excluded: done(excluded),
  };
}

/** Sites that bring a real part (a tenth or more) of a theme's visits. */
export const sharedBy = (theme, part = 0.1) => Object.values(theme.sites || {}).filter((v) => v >= part * theme.visits).length;

/** The data of the picture: the measured read joined with the two that are written by hand. */
export function threeReads(visits, reads) {
  const known = new Set(Object.keys(visits.themes));
  reads.themes.forEach((t) => { if (!known.has(t.id)) throw new Error(`reads: theme "${t.id}" is not in the theme rules`); });
  return {
    firm: reads.firm || 'the firm',
    scope: reads.scope || '',
    states: { lead: 'The firm leads', comp: 'A competitor leads part', open: 'Open, or thin', ...reads.states },
    note: reads.note || '',
    wantedNote: reads.wantedNote || '',
    meta: visits.meta,
    sites: visits.sites,
    themes: reads.themes.map((t) => ({ prompts: 0, asked: '', wanted: '', job: [], experience: '', state: 'open', ...t, ...visits.themes[t.id] })),
  };
}
