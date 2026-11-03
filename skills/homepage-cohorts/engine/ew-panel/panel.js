/*
 * Cohorts: an Experience Workspace panel that shows which content of a cohort page each visitor
 * cohort sees, while you edit.
 *
 * - Reads the page the author is editing live (SDK subscribeLiveDocument: the editor's HTML and
 *   the selected block, on every change). Without it, the published page.
 * - Runs the site's own engine (scripts/cohorts.js apply()) once per experience, with the site's
 *   rules (scripts/cohort-rules.js): what the panel shows is what visitors get, not a copy of
 *   the logic.
 * - Shares per experience from cohorts.json (homepage-cohorts size.js, Optel), when published.
 *
 * Standalone (no Experience Workspace): /tools/cohorts/index.html?path=/new reads the published
 * page. ?nx=<branch> imports the SDK from that da-nx branch (as the personalization panel does).
 */
/* render() and the click handlers call each other: the panel re-renders from state */
/* eslint-disable no-use-before-define */
import { apply } from '../../scripts/cohorts.js';
import rules from '../../scripts/cohort-rules.js';
import {
  COHORT_KEYS, parsePage, sectionOfBlock, sectionLabel, experiencesOf, audienceOf, lint, holdout,
  previewUrl, list,
} from './model.js';

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app');
const COLORS = ['#6b7280', '#2563eb', '#e20074', '#0d9488', '#d97706', '#7c3aed', '#0891b2'];

const state = {
  path: params.get('path') || null,
  live: false,
  doc: null, // { page, sections }
  views: [], // [{ id, order: [i], promoted: [i] }]
  exps: [],
  pick: params.get('exp') || null,
  selected: null, // section index of the selected block
  original: null, // sections of the homepage, for the holdout check
  cohortsJson: null,
  actions: null,
  readAt: null,
};

const h = (tag, cls, ...kids) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  kids.flat().forEach((k) => {
    if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  });
  return el;
};
const pct = (x) => (x == null ? '' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const colorOf = (id) => {
  const base = id.split(':')[0];
  const i = ['default', ...Object.keys(rules.experiences || {})].indexOf(base);
  return COLORS[(i < 0 ? COLORS.length - 1 : i) % COLORS.length];
};
const expById = (id) => state.exps.find((e) => e.id === id);
const visible = (s) => s.blocks.length || s.heading;

/** The engine's view of the page for one experience: section order after apply(). */
function viewOf(sections, exp) {
  const main = document.createElement('main');
  sections.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'section';
    d.dataset.i = s.i;
    COHORT_KEYS.forEach((k) => { if (s.meta[k]) d.dataset[k] = s.meta[k]; });
    main.append(d);
  });
  // apply() skips sections that are not connected (that is how it knows a slot already removed
  // one), so the scratch <main> has to be in the document while it runs
  const host = document.createElement('div');
  host.hidden = true;
  host.append(main);
  document.body.append(host);
  apply(main, exp.keys);
  host.remove();
  const order = [...main.children].map((d) => Number(d.dataset.i));
  const own = exp.keys.length === 1 ? exp.keys : exp.keys.filter((k) => k !== 'default');
  const promoted = order.filter((i) => list(sections[i].meta.promote).some((c) => own.includes(c)));
  return { id: exp.id, order, promoted };
}

function compute() {
  const { sections } = state.doc;
  state.exps = experiencesOf(rules, sections, state.cohortsJson);
  state.views = state.exps.map((e) => viewOf(sections, e));
  if (!state.pick || !expById(state.pick)) state.pick = state.exps[1]?.id || 'default';
}

/* ---------- rendering ---------- */

function chip(id, off = false) {
  const e = expById(id);
  const c = h('span', `chip${off ? ' off' : ''}`, e ? e.label.replace(/^(\w+):.*/, '$1') : id);
  c.style.setProperty('--c', colorOf(id));
  return c;
}

function jump(i) {
  state.selected = i;
  if (typeof state.actions?.scrollTo === 'function') {
    state.actions.scrollTo({ type: 'section', sectionIndex: i });
  }
  render();
}

function tagsOf(s, exp, view) {
  const t = h('div', 'tags');
  if (s.meta.slot) t.append(h('span', 'tag', `slot ${s.meta.slot}`));
  if (exp && view?.promoted.includes(s.i)) t.append(h('span', 'tag promo', 'moved up'));
  if (s.meta.cohorts) t.append(h('span', 'tag', `only ${list(s.meta.cohorts).join(', ')}`));
  if (s.meta.hideFor) t.append(h('span', 'tag', `hidden for ${list(s.meta.hideFor).join(', ')}`));
  if (s.meta.style) t.append(h('span', 'tag', s.meta.style));
  return t;
}

function sectionRow(s, n, exp, view, hidden = false) {
  const { what, heading } = sectionLabel(s);
  const li = h(
    'li',
    `hit${hidden ? ' hidden' : ''}${state.selected === s.i ? ' sel' : ''}`,
    h('span', 'num', n),
    h('div', '', h('div', 'what', what), heading ? h('div', 'heading', heading) : null, tagsOf(s, exp, view)),
  );
  const only = list(s.meta.cohorts);
  if (only.length && !only.includes('default')) li.style.setProperty('--c', colorOf(only[0]));
  li.title = `Section ${s.i + 1} in the document${typeof state.actions?.scrollTo === 'function' ? ' · click to go there' : ''}`;
  li.addEventListener('click', () => jump(s.i));
  return li;
}

function renderNow(root) {
  const { sections } = state.doc;
  const s = state.selected != null ? sections[state.selected] : null;
  if (!s) {
    root.append(h('p', 'status', state.live
      ? 'Put the cursor in a section to see who it is for.'
      : 'Click a section below to see who it is for.'));
    return;
  }
  const who = audienceOf(s.i, state.views);
  const { what, heading } = sectionLabel(s);
  const card = h('div', 'card now', h('div', 'what', `Section ${s.i + 1} · ${what}`), heading ? h('div', 'heading', heading) : null);
  const row = (lbl, ids, off) => h('div', 'who', h('span', 'lbl', lbl), ids.length ? ids.map((id) => chip(id, off)) : h('span', 'sub', 'nobody'));
  card.append(row('Shown to', who.shown));
  if (who.hidden.length) card.append(row('Not shown', who.hidden, true));
  if (who.promoted.length) card.append(row('Moved up', who.promoted));
  if (s.meta.slot) {
    const rivals = sections.filter((x) => x !== s && (x.meta.slot || '').toLowerCase() === s.meta.slot.toLowerCase());
    card.append(h('p', 'sub', `Competes in slot "${s.meta.slot}" with ${rivals.length} other section${rivals.length === 1 ? '' : 's'}: each visitor gets one of them.`));
  }
  root.append(card);
}

function renderPicker(root) {
  const sections = (id) => state.views.find((x) => x.id === id).order
    .filter((i) => visible(state.doc.sections[i])).length;
  const picked = expById(state.pick);
  const grid = h('div', 'exps');
  state.exps.filter((e) => !e.intent).forEach((e) => {
    const b = h(
      'button',
      'exp',
      h('span', 'n', e.label),
      h('span', 's', [e.share != null ? `${pct(e.share)} of views · ` : '', `${sections(e.id)} sections`].join('')),
    );
    b.style.setProperty('--c', colorOf(e.id));
    b.setAttribute('aria-pressed', String(picked?.experience === e.id));
    b.title = e.sub || '';
    b.addEventListener('click', () => { state.pick = e.id; render(); });
    grid.append(b);
  });
  root.append(grid);
  const intents = state.exps.filter((e) => e.intent && e.experience === picked?.experience);
  if (!intents.length) return;
  const row = h('div', 'intents', h('span', 'lbl', 'Interest'));
  [expById(picked.experience), ...intents].forEach((e) => {
    const b = h('button', 'ichip', e.intent || 'any');
    b.setAttribute('aria-pressed', String(state.pick === e.id));
    b.title = e.intent ? `${e.sub} · ${sections(e.id)} sections` : 'No interest known: the generic sections';
    b.style.setProperty('--c', colorOf(e.id));
    b.addEventListener('click', () => { state.pick = e.id; render(); });
    row.append(b);
  });
  root.append(row);
}

function renderView(root) {
  const exp = expById(state.pick);
  const view = state.views.find((v) => v.id === state.pick);
  const { sections } = state.doc;
  const shown = view.order.map((i) => sections[i]).filter(visible);
  root.append(h('h2', '', `What ${exp.label} sees`));
  if (exp.rules.length && exp.id !== 'default') {
    const names = exp.rules.map((id) => (rules.rules || []).find((r) => r.id === id)?.label || id);
    root.append(h('p', 'sub', `Rules: ${names.join(' · ')}`));
  }
  const ol = h('ol', 'secs');
  shown.forEach((s, k) => ol.append(sectionRow(s, k + 1, exp, view)));
  root.append(ol);
  const hidden = sections.filter((s) => visible(s) && !view.order.includes(s.i));
  if (hidden.length) {
    const d = h('details', '', h('summary', '', `Not shown to ${exp.label} (${hidden.length})`));
    const ol2 = h('ol', 'secs');
    hidden.forEach((s) => ol2.append(sectionRow(s, '–', null, null, true)));
    d.append(ol2);
    root.append(d);
  }
  const actions = h('div', 'actions');
  const a = h('a', 'btn primary', exp.id === 'default' ? 'Open the original' : `Preview as ${exp.label}`);
  a.href = previewUrl(window.location.origin, state.path, exp, rules);
  a.target = '_blank';
  a.rel = 'noopener';
  actions.append(a);
  if (state.actions?.sendHTML && exp.id !== 'default') {
    const ins = h('button', 'btn', `Insert a section for ${exp.label.split(':')[0]}`);
    ins.addEventListener('click', () => {
      state.actions.sendHTML(`<hr><p>New section for ${exp.label}</p><table><tr><td>section metadata</td></tr><tr><td>Cohorts</td><td>${exp.id}</td></tr></table>`);
    });
    actions.append(ins);
  }
  root.append(actions);
}

function renderMatrix(root) {
  const { sections } = state.doc;
  const d = h('details', '', h('summary', '', 'Who sees what (all experiences)'));
  const table = h('table');
  const head = h('tr', '', h('th', '', ''));
  state.exps.forEach((e) => { const th = h('th', '', e.label); th.title = e.sub || ''; head.append(th); });
  table.append(h('thead', '', head));
  const body = h('tbody');
  sections.filter(visible).forEach((s) => {
    const { what, heading } = sectionLabel(s);
    const th = h('th', '', `${s.i + 1} ${heading || what}`);
    th.title = `${what}${heading ? ` · ${heading}` : ''}`;
    const tr = h('tr', `hit${state.selected === s.i ? ' sel' : ''}`, th);
    state.views.forEach((v) => {
      const td = h('td');
      if (v.order.includes(s.i)) {
        const dot = h('span', `dot${v.promoted.includes(s.i) ? ' top' : ''}`);
        dot.style.setProperty('--c', colorOf(v.id));
        dot.title = v.promoted.includes(s.i) ? 'shown, moved up' : 'shown';
        td.append(dot);
      }
      tr.append(td);
    });
    tr.addEventListener('click', () => jump(s.i));
    body.append(tr);
  });
  table.append(body);
  d.append(h('div', 'matrix', table));
  root.append(d);
}

function renderChecks(root) {
  root.append(h('h2', '', 'Checks'));
  const issues = lint(state.doc, rules);
  const def = state.views.find((v) => v.id === 'default');
  if (state.original && def) {
    const r = holdout(state.original, def.order, state.doc.sections);
    root.append(r.ok
      ? h('div', 'check ok', `Everyone else sees the homepage, section for section (${r.count} sections). The holdout comparison is fair.`)
      : h('div', 'check error', `Everyone else does not see the homepage: section ${r.at + 1} is "${r.got}", the homepage has "${r.expected}". Every cohort is measured against the wrong page until this matches.`));
  }
  if (!issues.length) root.append(h('div', 'check ok', 'No metadata problems found.'));
  issues.forEach((x) => {
    const c = h('div', `check ${x.level}`, x.section != null ? `Section ${x.section + 1}: ` : '', x.text);
    if (x.section != null) {
      const b = h('button', '', 'show');
      b.addEventListener('click', () => jump(x.section));
      c.append(' ', b);
    }
    root.append(c);
  });
}

function render() {
  app.replaceChildren();
  const head = h(
    'div',
    'head',
    h('div', '', h('h1', '', 'Cohorts'), h('div', 'path', state.path || '')),
    h('span', `badge${state.live ? '' : ' stale'}`, state.live ? 'live' : 'published'),
  );
  app.append(head);
  if (!state.doc) { app.append(h('p', 'status', 'Reading the page…')); return; }
  const usesCohorts = state.doc.sections.some((s) => COHORT_KEYS.some((k) => s.meta[k]));
  if (!usesCohorts) {
    const home = ['/', '/index'].includes(state.path);
    app.append(h(
      'div',
      'card',
      h('p', '', 'This page has no cohort sections, so every visitor sees all of it.'),
      home ? h('p', 'sub', `The homepage's cohort experiences live on ${rules.pocPath || '/new'}: open that page to edit them.`) : null,
    ));
    return;
  }
  renderNow(app);
  app.append(h('h2', '', 'Experiences'));
  renderPicker(app);
  renderView(app);
  renderMatrix(app);
  renderChecks(app);
  const src = state.cohortsJson?.meta;
  app.append(h('p', 'foot', src
    ? `Shares: Optel, ${src.domain}${src.path}, ${String(src.start).slice(0, 10)} to ${String(src.end).slice(0, 10)}, ${src.bundles.toLocaleString()} sampled views. Memory rules are estimates.`
    : 'Shares appear when cohorts.json (homepage-cohorts size.js) is published at /cohorts/cohorts.json.'));
}

/* ---------- data ---------- */

function setDocument(html, selection, pageMeta = null) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // .plain.html has no <main>: wrap it so parsePage sees one section per top-level div
  if (!doc.querySelector('main')) {
    const main = doc.createElement('main');
    main.append(...doc.body.childNodes);
    doc.body.append(main);
  }
  state.doc = parsePage(doc);
  if (pageMeta) state.doc.page = { ...pageMeta, ...state.doc.page };
  state.readAt = Date.now();
  if (selection && Number.isInteger(selection.blockIndex)) {
    state.selected = sectionOfBlock(state.doc.sections, selection.blockIndex);
  }
  compute();
  render();
}

async function readPublished(path) {
  const p = path === '/' ? '/index' : path.replace(/\.html$/, '');
  const res = await fetch(`${p}.plain.html`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${p}.plain.html: ${res.status}`);
  return res.text();
}

async function loadSide() {
  const [cj, orig] = await Promise.allSettled([
    fetch('/cohorts/cohorts.json').then((r) => (r.ok ? r.json() : null)),
    readPublished('/'),
  ]);
  state.cohortsJson = cj.value || null;
  if (orig.value) {
    const d = new DOMParser().parseFromString(`<main>${orig.value}</main>`, 'text/html');
    state.original = parsePage(d).sections;
  }
}

/* .plain.html drops page metadata (it becomes <meta> in the head): read it from the page */
async function readPageMeta(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    const { head } = new DOMParser().parseFromString(await res.text(), 'text/html');
    const meta = {};
    head.querySelectorAll('meta[name]').forEach((m) => { meta[m.name.toLowerCase()] = m.content; });
    return meta;
  } catch {
    return {};
  }
}

async function showPublished(path) {
  const [html, meta] = await Promise.all([readPublished(path), readPageMeta(path)]);
  setDocument(html, null, meta);
}

async function startStandalone() {
  state.path = state.path || rules.pocPath || '/new';
  await loadSide();
  await showPublished(state.path);
}

async function startInWorkspace(sdk) {
  state.actions = sdk.actions;
  const ctx = sdk.context || sdk.project || {};
  state.path = ctx.path || '/';
  await loadSide();
  try {
    if (typeof sdk.actions.subscribeLiveDocument !== 'function') throw new Error('no live document');
    sdk.actions.subscribeLiveDocument(({ html, selection }) => {
      state.live = true;
      setDocument(html, selection);
    });
    // the first callback arrives once the host has the document; until then show the published one
    setTimeout(() => { if (!state.doc) showPublished(state.path); }, 2500);
  } catch {
    await showPublished(state.path);
  }
}

async function boot() {
  render();
  const inFrame = window.parent !== window;
  if (!inFrame || params.has('path')) { await startStandalone(); return; }
  const nx = params.get('nx') ? `https://${params.get('nx')}--da-nx--adobe.aem.live` : 'https://da.live';
  const timer = setTimeout(() => {
    app.append(h('p', 'status', 'No handshake from Experience Workspace after 8s. Open this from the tool panel; header-rewriting extensions and Grammarly break the handshake.'));
  }, 8000);
  const { default: DA_SDK } = await import(`${nx}/nx/utils/sdk.js`);
  const sdk = await DA_SDK;
  clearTimeout(timer);
  await startInWorkspace(sdk);
}

boot().catch((e) => {
  app.append(h('p', 'check error', `Could not read the page: ${e.message}`));
});
