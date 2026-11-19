/*
 * Data report: reduce the reads of brand-visibility, the fetch join and homepage-cohorts to the
 * numbers templates/report.html draws. Findings only: the plan of reads.json (job, experience)
 * and the experiences of cohorts.json are dropped here, so they cannot reach the PDF.
 */
import fs from 'node:fs';
import path from 'node:path';

const STAGES = ['topics', 'mentions', 'attempts', 'citations', 'transactions', 'trackable', 'claimable', 'influenced', 'agents', 'conversions'];
export const STATUSES = ['collected', 'directional', 'partial', 'none'];

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sum = (l, f) => l.reduce((a, x) => a + (f(x) || 0), 0);

/* Per-theme numbers: reads.json (prompts, asked, wanted, attempts) joined with visits-by-theme.json (visits). */
export function themes(reads, visits) {
  return reads.themes.map((t) => {
    const v = visits.themes[t.id];
    if (!v) throw new Error(`theme "${t.id}" is in reads.json but not in visits-by-theme.json`);
    return {
      id: t.id, label: t.label || v.label, state: t.state, prompts: t.prompts || 0, asked: t.asked || '', wanted: t.wanted || '',
      attempts: t.attempts ?? null, visits: v.visits, search: v.search || 0, ai: v.ai || 0, sites: v.sites || {},
    };
  });
}

/* A homepage-cohorts cohorts.json, without the experiences: the flows entry → device → rule, and each rule's numbers. */
export function cohorts(c) {
  const links = new Map();
  for (const l of c.links || []) {
    if (!(/^[ed]:/.test(l.s) && /^[dr]:/.test(l.t))) continue;
    const k = `${l.s}|${l.t}|${l.signal}`;
    links.set(k, (links.get(k) || 0) + l.views);
  }
  const col = (re) => (c.columns.find((x) => x.nodes.some((n) => re.test(n.id))) || { nodes: [] }).nodes.map(({ id, label, views }) => ({ id, label, views }));
  return {
    meta: { domain: c.meta.domain, path: c.meta.path, start: c.meta.start, end: c.meta.end, views: c.meta.views, bundles: c.meta.bundles },
    entry: col(/^e:/), device: col(/^d:/),
    rules: c.rules.filter((r) => r.views > 0).map((r) => ({
      id: r.id, label: r.label, signal: r.signal, modelled: !!r.modelled, views: r.views, share: r.share, bundles: r.bundles,
      low: !!r.lowSample, goal: r.today?.goalRate ?? null, nothing: r.today?.didNothing ?? null,
    })),
    links: [...links].map(([k, v]) => { const [s, t, g] = k.split('|'); return { s, t, g, v }; }),
    today: { nothing: c.today.didNothing, clicks: (c.today.topClicks || []).map(({ click, share }) => ({ click, share })), devices: c.today.devices || [] },
    conversion: null, // named in report.json: the cohort rules' click pattern does not say what it is
  };
}

/* What the coverage page says per funnel stage, from the data unless report.json says otherwise. */
export function coverage(cfg, d) {
  const T = d.reads.themes; const F = d.fetch;
  const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : Math.round(n).toLocaleString('en-US'));
  const goal = d.cohorts.find((c) => c.conversion && c.rules.some((r) => r.goal != null));
  const def = {
    topics: ['collected', `${T.length} themes, <b>${fmt(sum(T, (t) => t.prompts))} AI prompts a month</b> (${d.reads.scope}).`],
    mentions: ['directional', 'Who is named in AI answers, from one query set per theme. Counts are directional; a tracked synthetic prompt set was not part of this read.'],
    attempts: F ? ['collected', `<b>${F.attempts.toLocaleString('en-US')}</b> page loads by assistants answering a person, across ${F.urls} pages, ${F.window.replace('..', ' to ')}.`] : ['none', 'Agentic traffic was not part of this read.'],
    citations: ['none', 'Whether a page is shown as a source in the answer was not measured in this read.'],
    transactions: ['none', 'Requests from personal agents asking to transact were not part of this read.'],
    trackable: ['collected', `<b>${sum(T, (t) => t.ai).toLocaleString('en-US')}</b> visits from AI assistants on the themes${F ? `; ${F.aiVisits.toLocaleString('en-US')} on the site in the fetch window` : ''}.`],
    claimable: ['none', 'Untagged clicks from AI apps arrive as direct traffic. They were not separated from direct in this read.'],
    influenced: ['none', 'People who used an assistant and then arrived another way: not part of this read.'],
    agents: ['none', 'Visits by signed personal agents were not separated in this read. Optel excludes bots, so they are not in the visit counts.'],
    conversions: goal ? ['partial', `Adobe Analytics and CJA were not part of this read. As a stand-in, Optel counts "${goal.conversion.toLowerCase()}" clicks on the ${goal.title}.`] : ['none', 'Adobe Analytics and CJA were not part of this read.'],
  };
  return STAGES.map((id) => {
    const o = (cfg.coverage || {})[id] || {};
    const status = o.status || def[id][0];
    if (!STATUSES.includes(status)) throw new Error(`coverage.${id}.status must be one of ${STATUSES.join(', ')}`);
    return { id, status, text: o.text || def[id][1] };
  });
}

/* Everything the template needs. `dir` is where report.json lives; its paths are relative to it. */
export function reduce(cfg, dir) {
  const at = (p) => path.resolve(dir, p);
  if (!cfg.customer) throw new Error('report.json needs "customer"');
  if (!cfg.reads || !cfg.visits) throw new Error('report.json needs "reads" (reads.json) and "visits" (visits-by-theme.json)');
  const reads = readJson(at(cfg.reads)); const visits = readJson(at(cfg.visits));
  const d = {
    cfg: {
      customer: cfg.customer, short: cfg.short || cfg.customer, title: cfg.title || 'What the data shows',
      subtitle: cfg.subtitle || `about how people and AI find ${cfg.short || cfg.customer}`,
      lede: cfg.lede || 'The visits, AI prompts, citations and visitor cohorts we collected, with how each number was collected. Findings only: no recommendations.',
      preparedFor: cfg.preparedFor || cfg.customer, period: cfg.period || '', logo: cfg.logo || '', names: cfg.names || [cfg.short || cfg.customer],
      pulled: cfg.pulled || '', wantedSources: cfg.wantedSources || '', askNote: cfg.askNote || '', clickLabels: cfg.clickLabels || {},
      fetchPages: cfg.fetchPages || null, pathPrefix: cfg.pathPrefix || '', notOnPage: cfg.notOnPage || 'Recommendations, designs and proposed page versions.',
    },
    reads: { states: reads.states, scope: reads.scope || '', meta: visits.meta, sites: visits.sites.map(({ id, name, visits: v }) => ({ id, name, visits: v })), themes: themes(reads, visits) },
    fetch: cfg.fetch ? readJson(at(cfg.fetch)) : null,
    cohorts: (cfg.cohorts || []).map((c) => ({ title: c.title || 'Homepage', ...cohorts(readJson(at(c.file))), ...(c.conversion ? { conversion: c.conversion } : {}) })),
  };
  d.coverage = coverage(cfg, d);
  return d;
}

export const dataScript = (d) => `/* generated by build.js from report.json, do not hand-edit */\nwindow.D = ${JSON.stringify(d)};\n`;

/* ---- the fetch join: ABV citation attempts per page, with Optel visits on the same pages and days ---- */

/* `path|hits|agent|share|category` lines (the abv-traffic export). A later file overrides a path of an earlier one. */
export function readFetches(files) {
  const pages = new Map();
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const [p, hits, agent] = line.trim().split('|');
      if (p && Number.isFinite(+hits)) pages.set(p, { hits: +hits, agent: agent || pages.get(p)?.agent || 'not given' });
    }
  }
  return pages;
}

export function joinFetches(o, pages, bundles, { from, to, scope = '', sections = {} }) {
  const strip = scope ? new RegExp(scope) : null;
  const norm = (u) => {
    let p; try { p = new URL(u).pathname; } catch { return null; }
    if (strip) { if (!strip.test(p)) return null; p = p.replace(strip, '').replace(/^\.html$/, '') || '/'; }
    return p.startsWith('/') ? p : `/${p}`;
  };
  const views = new Map(); const ai = new Map(); const search = new Map(); const add = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
  let all = 0; let aiAll = 0;
  for (const b of bundles) {
    const day = (b.time || b.timeSlot || '').slice(0, 10);
    if (day < from || day >= to) continue;
    const p = norm(b.url); if (p === null) continue;
    add(views, p, b.weight); all += b.weight;
    const ch = o.classifyAcquisition(b)?.channel;
    if (ch === 'ai') { add(ai, p, b.weight); aiAll += b.weight; } else if (ch === 'search') add(search, p, b.weight);
  }
  const SEC = Object.entries(sections).map(([k, re]) => [k, new RegExp(re)]);
  const sec = (p) => (p === '/' ? 'home' : (SEC.find(([, re]) => re.test(p)) || ['other'])[0]);
  const rows = [...pages].filter(([, v]) => v.hits > 0).map(([p, v]) => ({ p, attempts: v.hits, agent: v.agent, sec: sec(p), views: views.get(p) || 0, ai: ai.get(p) || 0, search: search.get(p) || 0 }))
    .sort((a, b) => b.attempts - a.attempts);
  const bySec = {}; const agents = {};
  for (const r of rows) {
    const s = bySec[r.sec] ||= { urls: 0, attempts: 0, views: 0, ai: 0 };
    s.urls += 1; s.attempts += r.attempts; s.views += r.views; s.ai += r.ai;
    agents[r.agent] = (agents[r.agent] || 0) + r.attempts;
  }
  const last = new Date(Date.parse(to) - 864e5).toISOString().slice(0, 10);
  return {
    window: `${from}..${last}`, scope, views: all, aiVisits: aiAll, attempts: sum(rows, (r) => r.attempts), urls: rows.length,
    bySec, agents: Object.entries(agents).sort((a, b) => b[1] - a[1]), rows,
  };
}
