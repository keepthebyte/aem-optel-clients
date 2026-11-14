/*
 * Site merge: shared helpers. Pure functions over Optel bundles and the merge rules, so the
 * steps and the tests use the same code.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadOptel() {
  const tries = [
    process.env.OPTEL_CLIENT,
    path.join(here, '../../aem-optel/optel-client.js'),
    path.join(here, '../../../optel-client.js'),
  ].filter(Boolean);
  const found = tries.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`optel-client.js not found (tried ${tries.join(', ')}); set OPTEL_CLIENT`);
  return import(pathToFileURL(path.resolve(found)).href);
}

export async function loadRules(file) {
  const m = await import(pathToFileURL(path.resolve(file)).href);
  const rules = m.default || m;
  ['sites', 'needs', 'audiences'].forEach((k) => {
    if (!Array.isArray(rules[k]) || !rules[k].length) throw new Error(`${file}: \`${k}\` is missing or empty`);
  });
  return { layers: [{ id: 'all', label: 'All traffic', sub: 'Every visit' }], needLabels: {}, ...rules };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
    }
  }
  return out;
}

/** Bundles of a raw .jsonl file, one at a time (site pulls are large). */
export async function* readBundles(file) {
  for await (const line of readline.createInterface({ input: fs.createReadStream(file) })) {
    if (line) yield JSON.parse(line);
  }
}

const rx = (s) => new RegExp(s, 'i');
export const CHANNELS = ['direct', 'search', 'email', 'social', 'referral', 'paid', 'ai', 'other'];
const FOLD = { display: 'paid', campaign: 'paid', video: 'paid', internal: 'referral' };
const hostOfUrl = (u) => { try { return new URL(u).host; } catch { return ''; } };
const add = (m, k, w) => { m[k] = (m[k] || 0) + w; };

/** text → need id, by the first pattern in rules.needs that matches (or undefined). */
export function needMatcher(rules) {
  const list = rules.needs.map(([id, re]) => [id, rx(re)]);
  return (text) => (list.find(([, re]) => re.test(text)) || [])[0];
}

/**
 * What one visit came for on its site.
 * A need is read from the landing page; a visit that lands on a homepage takes the need of its
 * first click that has one, and is a front-door visit (`home`) without one.
 * @returns { need, viaHome, clicked, cross, channel, vendor, mobile, path }
 */
export function classifyVisit(o, rules, site, b, needOf = needMatcher(rules)) {
  const p = o.pathOf(b);
  const clicks = o.events(b, 'click').map((e) => String(e.target || '')).filter((t) => /^https?:|^\//.test(t));
  const isHome = rx(site.home).test(p);
  let need = isHome ? (clicks.map(needOf).find(Boolean) || 'home') : needOf(p);
  const viaHome = isHome && need !== 'home';
  if (!need) need = 'other';
  // a click to another of the sites being merged. A careers subdomain is careers, not cross-sell.
  const others = rules.sites.filter((s) => s.domain !== site.domain).map((s) => s.domain);
  const cross = clicks.some((t) => {
    const h = hostOfUrl(t);
    return h && !/^careers\./.test(h) && others.some((d) => h === d || h.endsWith(`.${d}`));
  });
  const a = o.classifyAcquisition(b);
  const raw = a ? (FOLD[a.channel] || a.channel) : 'direct';
  return {
    need,
    viaHome,
    clicked: clicks.length > 0,
    cross,
    channel: CHANNELS.includes(raw) ? raw : 'other',
    vendor: String((a && (a.vendor || a.source)) || '').toLowerCase(),
    mobile: o.device(b) === 'mobile',
    path: p,
  };
}

/**
 * Step 1 for one site: its visits per layer and per need.
 * `bundles` is any (async) iterable of raw bundles of the whole site.
 */
export async function siteCohorts(o, rules, site, bundles) {
  const needOf = needMatcher(rules);
  const acc = Object.fromEntries(rules.layers.map((l) => [l.id, {
    cohorts: {}, visits: 0, bundles: 0, sources: {},
  }]));
  let visits = 0; let views = 0; let start = null; let end = null;
  for await (const b of bundles) {
    if (o.isBot(b) || !o.isPageView(b)) continue;
    const w = b.weight || 0;
    views += w;
    if (!o.isVisit(b)) continue;
    visits += w;
    if (!start || b.time < start) start = b.time;
    if (!end || b.time > end) end = b.time;
    const v = classifyVisit(o, rules, site, b, needOf);
    rules.layers.filter((l) => !l.channels || l.channels.includes(v.channel)).forEach((l) => {
      const L = acc[l.id];
      L.visits += w; L.bundles += 1;
      if (v.vendor) add(L.sources, v.vendor, w);
      const c = L.cohorts[v.need] || (L.cohorts[v.need] = {
        need: v.need, visits: 0, bundles: 0, viaHome: 0, clicked: 0, cross: 0, mobile: 0, channels: {}, pages: {},
      });
      c.visits += w; c.bundles += 1;
      if (v.viaHome) c.viaHome += w;
      if (v.clicked) c.clicked += w;
      if (v.cross) c.cross += w;
      if (v.mobile) c.mobile += w;
      add(c.channels, v.channel, w);
      add(c.pages, v.path, w);
    });
  }
  const minSample = rules.minSample || 30;
  const layers = Object.fromEntries(rules.layers.map((l) => {
    const L = acc[l.id];
    const cohorts = Object.values(L.cohorts).sort((x, y) => y.visits - x.visits).map((c) => ({
      need: c.need,
      visits: c.visits,
      bundles: c.bundles,
      share: c.visits / L.visits,
      lowSample: c.bundles < minSample,
      viaHome: c.viaHome / c.visits,
      clicked: c.clicked / c.visits,
      cross: c.cross / c.visits,
      mobile: c.mobile / c.visits,
      channels: Object.fromEntries(Object.entries(c.channels).sort((x, y) => y[1] - x[1]).map(([k, n]) => [k, n / c.visits])),
      topPages: Object.entries(c.pages).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([p, n]) => ({ path: p, share: n / c.visits })),
    }));
    return [l.id, {
      visits: L.visits,
      bundles: L.bundles,
      shareOfSite: visits ? L.visits / visits : 0,
      cross: L.visits ? cohorts.reduce((s, c) => s + c.cross * c.visits, 0) / L.visits : 0,
      sources: Object.entries(L.sources).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => ({ source: k, share: n / L.visits })),
      cohorts,
    }];
  }));
  return {
    id: site.id, name: site.name, was: site.was, host: site.host, start, end, views, visits, layers,
  };
}

/**
 * Step 2: per layer, the cohorts of each site that share a need become one audience.
 * `sites` is the output of siteCohorts() for every site.
 */
export function mergeSites(rules, sites) {
  const all = sites.reduce((s, x) => s + x.visits, 0);
  const layers = rules.layers.map((layer) => {
    const total = sites.reduce((s, x) => s + x.layers[layer.id].visits, 0);
    const audiences = rules.audiences.map((m) => {
      const from = sites.map((s) => {
        const c = s.layers[layer.id].cohorts.find((x) => x.need === m.id);
        return c && {
          site: s.id, visits: c.visits, bundles: c.bundles, shareOfSite: c.share, cross: c.cross, clicked: c.clicked, lowSample: c.lowSample, topChannel: Object.keys(c.channels)[0],
        };
      }).filter(Boolean);
      const visits = from.reduce((s, f) => s + f.visits, 0);
      // shared: more than one site brings a real part of it (not a low sample)
      const real = from.filter((f) => !f.lowSample);
      return {
        ...m,
        need: rules.needLabels[m.id] || m.id,
        visits,
        share: total ? visits / total : 0,
        // every site counting the same: the mean of the audience's share of each site
        shareEvenSites: from.reduce((s, f) => s + f.shareOfSite, 0) / sites.length,
        sites: real.length,
        shared: real.length > 1,
        // today's baseline for the gain: visits of this audience that click to another site
        cross: visits ? from.reduce((s, f) => s + f.cross * f.visits, 0) / visits : 0,
        from,
      };
    }).filter((a) => a.visits);
    const bundles = sites.reduce((s, x) => s + x.layers[layer.id].bundles, 0);
    return {
      ...layer,
      visits: total,
      bundles,
      shareOfAll: all ? total / all : 0,
      lowSample: bundles < (rules.minLayerSample || 300),
      cross: total ? sites.reduce((s, x) => s + x.layers[layer.id].cross * x.layers[layer.id].visits, 0) / total : 0,
      sharedVisits: total ? audiences.filter((a) => a.shared && a.gain).reduce((s, a) => s + a.visits, 0) / total : 0,
      audiences,
    };
  });
  return {
    meta: {
      note: 'Visits: sampled entry page views, bots excluded. A need is read from the landing page; a homepage visit takes the need of its first click.',
      start: sites.map((s) => s.start).filter(Boolean).sort()[0] || null,
      end: sites.map((s) => s.end).filter(Boolean).sort().pop() || null,
      visits: all,
    },
    layers,
  };
}

/**
 * One homepage view of `site` as it will be once the site redirects to `to`: a view of the
 * target's homepage arriving from the old site. What the visitor did on the page is kept.
 */
export function redirected(b, site, to) {
  if (site.id === to.id) return b;
  const u = new URL(b.url);
  const events = (b.events || []).map((e) => (e.checkpoint === 'enter' ? { ...e, source: `https://${site.host}/` } : e));
  return { ...b, url: `https://${to.host}${to.homePath}${u.search}`, events };
}
