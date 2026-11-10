/*
 * Demo-only presenter controls (?demo), for showing the cohorts to stakeholders on a shared
 * screen. Loaded from loadDelayed(); copy to scripts/cohort-panel.js (and styles/cohort-panel.css),
 * beside cohorts.js and cohort-insights.js.
 *
 * One dock, bottom centre:
 *   - Visitor: who the page is for. Opens a sheet with what Optel shows for that group, the
 *     visitors to switch to (cohort-rules.js `scenarios`: each sets real signals, detection does
 *     the rest), how the visitor was detected, and a link to the original page.
 *   - Explain sections (or ?insights): a note on every section saying why it is there, with the
 *     data behind it (cohort-insights.js).
 */
import { forgetVisitor, readMemory } from './cohorts.js';
import {
  loadInsightData, showInsights, hideInsights, ruleFacts, statsHTML,
} from './cohort-insights.js';

const INSIGHTS_KEY = 'cohort-insights';
const PICK_KEY = 'cohort-scenario';
const PARAMS = ['cohort', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'experiment', 'gclid', 'fbclid'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEVRON = icon('M6 15l6-6 6 6');
const CHECK = icon('M5 12.5l4.5 4.5L19 7.5');
const CLOSE = icon('M6 6l12 12M18 6L6 18');

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
};

/** the visitor-defining query, order-free, so a scenario can be recognised after its reload */
const signature = (params) => PARAMS.filter((k) => params[k] != null).map((k) => `${k}=${params[k]}`).join('&');
const currentSignature = () => {
  const q = new URLSearchParams(window.location.search);
  return signature(Object.fromEntries(PARAMS.filter((k) => q.has(k)).map((k) => [k, q.get(k)])));
};

function go(params, path) {
  const u = new URL(path, window.location.origin);
  PARAMS.forEach((k) => u.searchParams.delete(k));
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('demo', '');
  window.location.href = `${u.pathname}${u.search.replace(/=(&|$)/g, '$1')}`;
}

/** Which scenario this page shows: the one picked last, if the URL still carries its signals. */
function currentScenario(rules) {
  let last;
  try { last = JSON.parse(store.get(PICK_KEY) || 'null'); } catch (e) { last = null; }
  const list = rules.scenarios || [];
  if (last && last.sig === currentSignature() && list[last.i]?.[0] === last.name) return last.i;
  const sig = currentSignature();
  const i = list.findIndex(([, params, memory]) => !memory && signature(params) === sig);
  return i >= 0 && sig ? i : -1;
}

function visitorName(rules, ctx, i) {
  if (i >= 0) return rules.scenarios[i][0];
  const rule = (rules.rules || []).find((r) => r.id === ctx?.rule);
  if (rule) return rule.label;
  return 'New visitor';
}

/* ---------- Explain sections switch ---------- */

function insightsOn() {
  if (new URLSearchParams(window.location.search).has('insights')) return true;
  return store.get(INSIGHTS_KEY) === '1';
}

function explainSwitch(rules) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cohort-explain';
  b.setAttribute('role', 'switch');
  b.innerHTML = '<span class="cohort-track" aria-hidden="true"></span><span>Explain<span class="cohort-wide"> sections</span></span>';
  b.title = 'Show why each section is on this page, with the Optel data behind it';
  const set = async (on) => {
    b.setAttribute('aria-checked', String(on));
    store.set(INSIGHTS_KEY, on ? '1' : '0');
    if (on) showInsights(rules, await loadInsightData(rules));
    else hideInsights();
  };
  b.addEventListener('click', () => set(b.getAttribute('aria-checked') !== 'true'));
  set(insightsOn());
  return b;
}

/* ---------- the visitor sheet ---------- */

async function fillData(box, rules, ctx) {
  const f = ruleFacts(await loadInsightData(rules), ctx?.rule || null, rules);
  if (!f) {
    box.innerHTML = '<p class="cohort-muted">Publish size.js output at /cohorts/cohorts.json to show the numbers behind this group.</p>';
    return;
  }
  box.innerHTML = `<h3>What Optel shows for this group</h3>
    ${f.stats.length ? statsHTML(f.stats, 'cohort-stats') : `<p>${esc(f.headline)}</p>`}
    ${f.caveats.map((c) => `<p class="cohort-caveat">${esc(c)}</p>`).join('')}
    <p class="cohort-muted">${esc(f.source)}</p>`;
}

function signalsHTML(rules, ctx) {
  const s = ctx.signals || {};
  const mem = readMemory(rules);
  const rule = (rules.rules || []).find((r) => r.id === ctx.rule);
  const utm = Object.entries(s.utm || {}).filter(([, v]) => v).map(([k, v]) => `utm_${k}=${v}`).join(' ') || 'none';
  const interests = Object.entries(mem.interests || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet';
  const rows = [
    ['Rule', ctx.forced ? `${rule?.label || ctx.rule} (forced with ?cohort)` : (rule?.label || 'none matched')],
    ['Referrer', s.refHost || 'none'],
    ['Campaign', utm],
    ['Ad click', (s.paid || []).join(', ') || 'no'],
    ['Device', s.device || ''],
    ['Visits', `${mem.visits || 0}, signed in before: ${mem.signedIn ? 'yes' : 'no'}`],
    ['Interests', interests],
  ];
  return `<dl class="cohort-signals">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function originalHref(rules) {
  const keep = new URLSearchParams(window.location.search);
  ['demo', 'experiment'].forEach((k) => keep.delete(k));
  const qs = keep.toString() ? `&${keep}` : '';
  return `/?experiment=${rules.experiment || 'homepage-cohorts'}/control&demo${qs}`;
}

function sheetHTML(rules, ctx, current) {
  const exp = (rules.experiences || {})[ctx.experience];
  const name = visitorName(rules, ctx, current);
  const about = exp ? `${exp.label}. ${exp.sub || ''}` : 'No rule matched, so this visitor sees the original page.';
  return `
    <div class="cohort-sheet-head">
      <h2 id="cohort-sheet-title">${esc(name)}</h2>
      <button type="button" class="cohort-close" aria-label="Close">${CLOSE}</button>
    </div>
    <p class="cohort-about">${esc(about)}</p>
    <div class="cohort-cols">
    <section class="cohort-pick">
      <h3>Switch visitor</h3>
      <ul>${(rules.scenarios || []).map(([n], i) => `<li><button type="button" data-s="${i}"${i === current ? ' aria-current="true"' : ''}>
        <span>${esc(n)}</span>${i === current ? CHECK : ''}</button></li>`).join('')}</ul>
    </section>
    <div class="cohort-side">
      <section class="cohort-data" aria-live="polite"></section>
      <details class="cohort-more">
        <summary>How this visitor was detected</summary>
        ${signalsHTML(rules, ctx)}
        <p class="cohort-muted">On-device only: no personal information, no third-party calls, decided before the page paints.</p>
      </details>
      <a class="cohort-link" href="${originalHref(rules)}">Compare with the original page</a>
    </div>
    </div>`;
}

function pick(rules, i) {
  const [name, params, memory] = rules.scenarios[i];
  forgetVisitor(rules);
  if (memory) {
    try {
      const last = Date.now() - (rules.memory?.sessionGapMs || 30 * 60 * 1000) - 1;
      localStorage.setItem(rules.memory?.storeKey || 'cohorts-v1', JSON.stringify({ ...memory, last }));
    } catch (e) { /* storage blocked */ }
  }
  store.set(PICK_KEY, JSON.stringify({ i, name, sig: signature(params) }));
  go(params, rules.pocPath || '/new');
}

/* ---------- the dock ---------- */

export default function initPanel(rules) {
  const ctx = window.cohorts;
  const el = document.createElement('aside');
  el.className = 'cohort-panel';
  el.setAttribute('aria-label', 'Demo controls');
  const dock = document.createElement('div');
  dock.className = 'cohort-dock';
  document.body.classList.add('cohort-demo');

  if (!ctx || ctx.arm === 'control') {
    const back = rules.pocPath || '/new';
    dock.innerHTML = `<p class="cohort-state"><b>Original page</b> <span>the same for every visitor</span></p>
      <a class="cohort-cta" href="${back}?demo">Show personalized</a>`;
    dock.append(explainSwitch(rules));
    el.append(dock);
    document.body.append(el);
    return;
  }

  const current = currentScenario(rules);
  const sheet = document.createElement('div');
  sheet.className = 'cohort-sheet';
  sheet.id = 'cohort-sheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-labelledby', 'cohort-sheet-title');
  sheet.innerHTML = sheetHTML(rules, ctx, current);

  const visitor = document.createElement('button');
  visitor.type = 'button';
  visitor.className = 'cohort-visitor';
  visitor.setAttribute('aria-expanded', 'false');
  visitor.setAttribute('aria-controls', 'cohort-sheet');
  visitor.innerHTML = `<span class="cohort-visitor-k">Visitor</span>
    <span class="cohort-visitor-name">${esc(visitorName(rules, ctx, current))}</span>${CHEVRON}`;
  dock.append(visitor, explainSwitch(rules));
  el.append(sheet, dock);

  const open = (on) => {
    sheet.hidden = !on;
    visitor.setAttribute('aria-expanded', String(on));
    if (on) (sheet.querySelector('[aria-current]') || sheet.querySelector('button[data-s]'))?.focus({ preventScroll: true });
  };
  visitor.addEventListener('click', () => open(sheet.hidden));
  sheet.querySelector('.cohort-close').addEventListener('click', () => { open(false); visitor.focus(); });
  sheet.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => pick(rules, Number(b.dataset.s))));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) { open(false); visitor.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!sheet.hidden && !el.contains(e.target)) open(false);
  });

  document.body.append(el);
  fillData(sheet.querySelector('.cohort-data'), rules, ctx);
}
