/*
 * Shared by size.js and review.js: load bundles, turn a bundle into the signals the browser
 * engine sees, evaluate goals. Uses optel-client.js for the data rules (weights, bots,
 * acquisition) and engine/cohorts.js for the rules themselves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchRule, sourceOf, intentFrom } from '../engine/cohorts.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** optel-client.js: $OPTEL_CLIENT, next to the aem-optel skill, or the repo root. */
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
  return m.default || m.rules || m;
}

export function readBundles(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
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

const rx = (s) => new RegExp(s, 'i');

/** Clicks that are not the cookie banner, with their selector and target as one string. */
export function clicks(o, b) {
  const page = b.url || '';
  return o.events(b, 'click').filter((e) => o.classifyClick(e, page) !== 'consent').map((e) => ({ ...e, text: `${e.source || ''} ${e.target || ''}` }));
}

/**
 * The signals the browser would have built for this view.
 * Memory is not in Optel: rules with `model` estimate it from what the view does today
 * (steady state: today's sign-in clickers are recognised next time). `{ modelled: false }`
 * leaves memory empty, as on a first visit.
 */
export function signalsFromBundle(o, rules, b, { modelled = true } = {}) {
  const utmRaw = o.utmOf(b);
  const utm = Object.fromEntries(['source', 'medium', 'campaign', 'content', 'term'].map((k) => [k, (utmRaw[`utm_${k}`] || '').toLowerCase()]));
  const siteHost = (o.hostOf(b) || '').replace(/^www\./, '');
  const ref = o.referrerOf(b);
  let refHost = '';
  try { refHost = ref ? new URL(ref).hostname.replace(/^(www|m)\./, '') : ''; } catch { refHost = ''; }
  const visit = o.isVisit(b);
  const memory = { visits: 1, interests: {} };
  const cl = clicks(o, b);
  (rules.rules || []).forEach((r) => {
    if (!r.model || !modelled) return;
    if (r.model.click && cl.some((c) => rx(r.model.click).test(c.text))) {
      if (r.when.signedIn) memory.signedIn = true;
      if (r.when.visits?.min) memory.visits = Math.max(memory.visits, r.when.visits.min);
      // an interest rule modelled from a click: the click is the evidence of that interest
      [].concat(r.when.interest || []).forEach((i) => { memory.interests[i] = 1; });
    }
    if (r.model.clickIntent) {
      const i = cl.map((c) => intentFrom(rules, c.target || '')).find(Boolean);
      if (i) { memory.interests[i] = 1; memory.visits = Math.max(memory.visits, r.when.visits?.min || 2); }
    }
  });
  const paid = [...new Set(o.events(b, 'paid').map((e) => e.source).filter(Boolean))];
  return {
    refHost,
    // a view without `enter` came from another page of the site
    source: visit ? sourceOf(refHost, siteHost, utm, paid) : 'internal',
    utm,
    paid,
    device: o.device(b) === 'mobile' ? 'mobile' : 'desktop',
    bot: false, // realViews() already removed bots
    memory,
    path: o.pathOf(b),
  };
}

/**
 * The rule this view would get. Modelled memory is an overlay on what no observable rule claims:
 * memory is modelled from this view's own clicks, so letting it take views from referrer, tag or
 * device rules would move exactly the views that reached a goal into the memory rules (their goal
 * rate becomes ~100%, the other rules' ~0%). Views an observable rule matches keep that rule.
 */
export function ruleOf(o, rules, b) {
  const observed = matchRule(rules, signalsFromBundle(o, rules, b, { modelled: false }));
  if (observed.rule) return observed;
  return { ...matchRule(rules, signalsFromBundle(o, rules, b)), modelled: true };
}

/** goal: { click: regex } | { navigate: true } | { checkpoint: 'formsubmit' }; default: any non-consent click */
export function goalHit(o, goal, b) {
  const cl = clicks(o, b);
  if (!goal) return cl.length > 0;
  if (goal.click) return cl.some((c) => rx(goal.click).test(c.text));
  if (goal.navigate) return o.events(b, 'click').some((e) => o.isNavigation(e, b.url));
  if (goal.checkpoint) return o.has(b, goal.checkpoint);
  return cl.length > 0;
}

/** Entry column of the Sankey: a named source from rules.sources, else Optel's acquisition channel. */
export function entryOf(o, rules, b) {
  const ref = o.referrerOf(b) || '';
  let host = '';
  try { host = ref ? new URL(ref).hostname.replace(/^(www|m)\./, '') : ''; } catch { host = ''; }
  const named = (rules.sources || []).find((s) => (s.referrer || []).some((h) => host === h || host.endsWith(`.${h}`)));
  if (named) return named.id;
  if (!o.isVisit(b)) return 'internal';
  const a = o.classifyAcquisition(b);
  if (!a) return 'internal';
  if (a.channel === 'ai') return 'ai';
  if (a.type === 'paid') return 'paid';
  if (a.channel === 'direct') return 'direct';
  if (a.channel === 'search') return 'search';
  if (a.channel === 'social') return 'social';
  if (a.channel === 'email' || a.type === 'owned') return 'owned';
  return 'referral';
}

export const ENTRY_LABELS = {
  direct: 'Direct', search: 'Search', internal: 'Internal navigation', paid: 'Paid', social: 'Social', ai: 'AI assistants', owned: 'Email & owned campaigns', referral: 'Other referrers',
};

/** Which kind of signal decides a rule (Sankey flow colour). */
export function signalOf(rule) {
  if (!rule) return 'none';
  const keys = JSON.stringify(rule.when || {});
  if (/"device"/.test(keys)) return 'device';
  if (/"signedIn"|"visits"|"interest"/.test(keys)) return 'memory';
  return 'link';
}
