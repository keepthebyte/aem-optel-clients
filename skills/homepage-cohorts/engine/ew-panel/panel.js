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
import { sendPick, readPick } from '../../scripts/cohort-preview.js';
import {
  COHORT_KEYS, parsePage, sectionOfBlock, sectionLabel, experiencesOf, audienceOf, lint, holdout,
  previewUrl, list, shortName, audienceText, intentName, interestSources, variantDiff,
} from './model.js';

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app');
const COLORS = ['#6b7280', '#2563eb', '#db2777', '#0d9488', '#d97706', '#7c3aed', '#0891b2'];

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
/** The page variations (no interest variants), most visitors first; unknown shares last. */
const byShare = () => state.exps.filter((e) => !e.intent)
  .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
/** Every variation in display order: most visitors first, interest variants after their parent. */
const ordered = () => byShare()
  .flatMap((p) => [p, ...state.exps.filter((e) => e.intent && e.experience === p.id)]);
const rank = (id) => ordered().findIndex((e) => e.id === id);
const names = (keys) => audienceText(rules, keys);
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
  if (!state.pick || !expById(state.pick)) {
    const shown = state.live && readPick();
    if (shown && expById(shown.id)) {
      state.pick = shown.id;
    } else {
      state.pick = byShare()[0]?.id || 'default';
      if (state.live) state.syncLayout = true; // tell the Layout view once the page is read
    }
  }
}

/* ---------- rendering ---------- */

function chip(id, off = false) {
  const e = expById(id);
  const c = h('span', `chip${off ? ' off' : ''}`, e ? shortName(rules, e.id) : id);
  c.style.setProperty('--c', colorOf(id));
  return c;
}

/** Pick a variation; in Experience Workspace the Layout view follows. */
function choose(id) {
  state.pick = id;
  if (state.live) {
    const e = expById(id);
    sendPick({
      id: e.id,
      experience: e.experience,
      intent: e.intent,
      keys: e.keys,
      rule: e.id === 'default' ? null : e.rules[0] || null,
      label: e.label,
    });
  }
  render();
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
  if (s.meta.slot) t.append(h('span', 'tag', `${s.meta.slot} slot: one of several`));
  if (exp && view?.promoted.includes(s.i)) t.append(h('span', 'tag promo', 'moved up'));
  if (s.meta.cohorts) t.append(h('span', 'tag', `only for ${names(list(s.meta.cohorts))}`));
  if (s.meta.hideFor) t.append(h('span', 'tag', `hidden for ${names(list(s.meta.hideFor))}`));
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
  // the dot means one thing: this section was made for the variation you are looking at
  // (it has a Cohorts list). No dot: the section is on the page for everyone.
  if (exp && list(s.meta.cohorts).length) li.style.setProperty('--c', colorOf(exp.id));
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
  Object.values(who).forEach((ids) => ids.sort((a, b) => rank(a) - rank(b)));
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
  const count = (id) => state.views.find((x) => x.id === id).order
    .filter((i) => visible(state.doc.sections[i])).length;
  const picked = expById(state.pick);
  const grid = h('div', 'exps');
  byShare().forEach((e) => {
    const b = h(
      'button',
      'exp',
      h('span', 'n', e.label),
      h('span', 's', [e.share != null ? `${pct(e.share)} of visitors · ` : '', `${count(e.id)} sections`].join('')),
    );
    b.style.setProperty('--c', colorOf(e.id));
    b.setAttribute('aria-pressed', String(picked?.experience === e.id));
    b.title = e.sub || '';
    b.addEventListener('click', () => choose(e.id));
    grid.append(b);
  });
  root.append(grid);
  if (state.live) {
    root.append(h('p', 'sub layout-note', `Layout view shows this page variation: ${shortName(rules, state.pick)}. Content view shows every section.`));
  }
  renderInterest(root, picked);
}

/** Interest variants of the picked variation, explained: what an interest is, where it comes
 * from, and what it changes on the page. */
function renderInterest(root, picked) {
  const parent = picked && expById(picked.experience);
  const variants = state.exps.filter((e) => e.intent && e.experience === picked?.experience);
  if (!parent || !variants.length) return;
  const who = shortName(rules, parent.id);
  const src = interestSources(rules, parent.id);
  const first = rules.intents?.[0]?.[0] || variants[0]?.intent;
  const example = first ? `an ${intentName(first)} ad`.replace(/^an ([^aeiouAEIOU])/, 'a $1') : '';
  const box = h('div', 'card interest');
  box.append(
    h('div', 'what', `${who} visitors also get content for what they shop for`),
    h('p', 'sub', `When we know a visitor's interest, ${who.toLowerCase()} sections made for that interest replace the general ones. We know it from:`),
  );
  const how = h('ul', 'how');
  if (src.utm.length) how.append(h('li', '', h('b', '', 'the link they came in on'), `: an ad or campaign link that names it${example ? `, e.g. ${example}` : ''}`, h('span', 'sub', ` (${src.utm.join(' · ')})`)));
  if (src.memory.length) how.append(h('li', '', h('b', '', 'pages they looked at before'), ': on an earlier visit, e.g. several pages about one product', h('span', 'sub', ` (${src.memory.join(' · ')})`)));
  box.append(how);
  const row = h('div', 'intents', h('span', 'lbl', 'See the page for'));
  [parent, ...variants].forEach((e) => {
    const b = h('button', 'ichip', intentName(e.intent));
    b.setAttribute('aria-pressed', String(state.pick === e.id));
    b.style.setProperty('--c', colorOf(e.id));
    b.addEventListener('click', () => choose(e.id));
    row.append(b);
  });
  box.append(row);
  const label = (i) => {
    const { what, heading } = sectionLabel(state.doc.sections[i]);
    return `"${heading || what}"`;
  };
  if (picked.intent) {
    const pv = state.views.find((v) => v.id === parent.id);
    const v = state.views.find((x) => x.id === picked.id);
    const d = variantDiff(pv.order, v.order);
    const own = v.order.filter((i) => list(state.doc.sections[i].meta.cohorts).includes(picked.id));
    let text;
    if (d.added.length) {
      const instead = d.removed.length ? ` instead of ${d.removed.map(label).join(', ')}` : '';
      text = `${intentName(picked.intent)}: shows ${d.added.map(label).join(', ')}${instead}`;
    } else if (own.length) {
      text = `${intentName(picked.intent)}: ${own.map(label).join(', ')} is made for this interest and is also what ${who.toLowerCase()} visitors with no interest get, so the page is the same.`;
    } else {
      text = `${intentName(picked.intent)}: same page as without an interest.`;
    }
    box.append(h('p', 'change', text));
  } else {
    box.append(h('p', 'change', 'No interest known: the general version, listed below.'));
  }
  const known = new Set(variants.map((e) => e.intent));
  const rest = (rules.intents || []).map(([id]) => id).filter((id) => !known.has(id));
  if (rest.length) box.append(h('p', 'sub', `Interests with no section of their own (${rest.map(intentName).join(', ')}) get the general version.`));
  root.append(box);
}

function renderView(root) {
  const exp = expById(state.pick);
  const view = state.views.find((v) => v.id === state.pick);
  const { sections } = state.doc;
  const shown = view.order.map((i) => sections[i]).filter(visible);
  root.append(h('h2', '', `The page for ${shortName(rules, exp.id)}`));
  if (exp.id === 'default') {
    root.append(h('p', 'sub', 'Who gets it: visitors no rule matches. They see the original homepage.'));
  } else if (exp.rules.length) {
    const why = exp.rules.map((id) => (rules.rules || []).find((r) => r.id === id)?.label || id);
    root.append(h('p', 'sub', `Who gets it: ${why.join(' · ')}`));
  }
  if (shown.some((s) => list(s.meta.cohorts).length)) {
    const key = h('p', 'legend', h('span', 'dot'), ` made for ${shortName(rules, exp.experience)} · no dot: on the page for everyone`);
    key.style.setProperty('--c', colorOf(exp.id));
    root.append(key);
  }
  const ol = h('ol', 'secs');
  shown.forEach((s, k) => ol.append(sectionRow(s, k + 1, exp, view)));
  root.append(ol);
  const hidden = sections.filter((s) => visible(s) && !view.order.includes(s.i));
  if (hidden.length) {
    const d = h('details', '', h('summary', '', `Not on this page (${hidden.length})`));
    const ol2 = h('ol', 'secs');
    hidden.forEach((s) => ol2.append(sectionRow(s, '–', null, null, true)));
    d.append(ol2);
    root.append(d);
  }
  const actions = h('div', 'actions');
  const a = h('a', 'btn primary', exp.id === 'default' ? 'Open the original' : `Preview as ${shortName(rules, exp.id)}`);
  a.href = previewUrl(window.location.origin, state.path, exp, rules);
  a.target = '_blank';
  a.rel = 'noopener';
  actions.append(a);
  if (state.actions?.sendHTML && exp.id !== 'default') {
    const ins = h('button', 'btn', `Insert a section for ${shortName(rules, exp.id)}`);
    ins.addEventListener('click', () => {
      state.actions.sendHTML(`<hr><p>New section for ${exp.label}</p><table><tr><td>section metadata</td></tr><tr><td>Cohorts</td><td>${exp.id}</td></tr></table>`);
    });
    actions.append(ins);
  }
  root.append(actions);
}

function renderMatrix(root) {
  const { sections } = state.doc;
  const d = h('details', '', h('summary', '', 'Who sees what (all page variations)'));
  const table = h('table');
  const head = h('tr', '', h('th', '', ''));
  const cols = ordered();
  cols.forEach((e) => { const th = h('th', '', shortName(rules, e.id)); th.title = e.label; head.append(th); });
  table.append(h('thead', '', head));
  const body = h('tbody');
  sections.filter(visible).forEach((s) => {
    const { what, heading } = sectionLabel(s);
    const th = h('th', '', `${s.i + 1} ${heading || what}`);
    th.title = `${what}${heading ? ` · ${heading}` : ''}`;
    const tr = h('tr', `hit${state.selected === s.i ? ' sel' : ''}`, th);
    cols.map((e) => state.views.find((x) => x.id === e.id)).forEach((v) => {
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
      home ? h('p', 'sub', `The homepage's page variations live on ${rules.pocPath || '/new'}: open that page to edit them.`) : null,
    ));
    return;
  }
  renderNow(app);
  app.append(h('h2', '', 'Page variations'));
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
  if (state.syncLayout) { state.syncLayout = false; choose(state.pick); return; }
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
  // the editor's live HTML carries no page Metadata block (EW edits it in its Page panel):
  // page-level keys (Cohorts: on, Experiment) come from the published page, the document wins
  const [, pubMeta] = await Promise.all([loadSide(), readPageMeta(state.path)]);
  try {
    if (typeof sdk.actions.subscribeLiveDocument !== 'function') throw new Error('no live document');
    sdk.actions.subscribeLiveDocument(({ html, selection }) => {
      state.live = true;
      setDocument(html, selection, pubMeta);
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
