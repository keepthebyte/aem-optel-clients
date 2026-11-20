/*
 * Cohort gallery: the variations of the cohort page side by side, one column each, scrolling
 * together, as desktop or phone. Opened as a full-size dialog in Experience Workspace
 * (extension `experience: fullsize-dialog`).
 *
 * - Variations: from the live document's Section Metadata (SDK subscribeLiveDocument), the same
 *   model as the Cohorts panel. The frames show the previewed page (?cohort=<rule id>), so an edit
 *   shows in the frames after Preview; each column says when the two differ.
 * - Frames load from this page's origin (the preview proxy in Experience Workspace), so they are
 *   same-origin: the gallery scrolls every column to the same point and counts what each shows.
 * - Compare: a picker with a checkbox per variation (All, Only), × on a column, keys 1-9 and 0.
 *   Columns are added and removed in place: the others do not reload. The choice and the device
 *   are kept for the next time the gallery opens.
 * - Explain reloads the frames with the engine's notes and no presenter dock
 *   (?demo&insights&dock=off).
 *
 * Spectrum 2 tokens with fallbacks, as the Cohorts panel; the controls follow the S2 picker,
 * menu, checkbox, action group, switch and close button.
 *
 * Standalone: /tools/cohorts/gallery.html?path=/new.
 * ?nx=<branch> imports the SDK from that da-nx branch.
 */
/* notices, frames and render call each other */
/* eslint-disable no-use-before-define */
import rules from '../../scripts/cohort-rules.js';
import { apply } from '../../scripts/cohorts.js';
import {
  COHORT_KEYS, parsePage, experiencesOf, previewUrl, groupColor,
} from './model.js';

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app');
const DEVICES = {
  desktop: { label: 'Desktop', w: 1440, min: 300 },
  phone: { label: 'Phone', w: 390, min: 220 },
};
const GAP = 16;
const STORE = 'cohort-gallery';

const saved = (() => {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
})();

const state = {
  path: params.get('path') || '',
  live: false,
  sections: null,
  exps: [],
  cohortsJson: null,
  device: params.get('device') || saved.device || 'desktop',
  // variations shown as columns, in the order of the variations; null = all
  shown: (params.get('exp') && new Set(params.get('exp').split(',')))
    || (saved.shown && new Set(saved.shown)) || null,
  explain: false,
  menu: false,
  y: 0,
  problems: {},
};
if (!DEVICES[state.device]) state.device = 'desktop';

const h = (tag, cls, ...kids) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k); });
  return el;
};
const pct = (x) => {
  if (x == null) return '';
  if (x > 0 && x < 0.001) return '<0.1%';
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
};
const tint = (el, id) => { el.style.setProperty('--c', groupColor(rules, id)); return el; };
const dot = (id) => tint(h('span', 'dot'), id);

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      device: state.device, shown: state.shown ? [...state.shown] : null,
    }));
  } catch { /* no storage */ }
}

/* ---------- problems: one line under the header, only when something needs action ---------- */

function check(key, ok, text) {
  if (ok === false) state.problems[key] = text; else delete state.problems[key];
  renderNotice();
}

function renderNotice() {
  const texts = Object.values(state.problems);
  const el = h('p', 'notice', texts.join(' · '));
  el.setAttribute('role', 'status');
  el.hidden = !texts.length;
  const old = app.querySelector('.notice');
  if (old) old.replaceWith(el);
  else app.querySelector('.top')?.after(el);
}

/* ---------- the document ---------- */

function parseHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.querySelector('main')) {
    const main = doc.createElement('main');
    main.append(...doc.body.childNodes);
    doc.body.append(main);
  }
  return parsePage(doc);
}

/** Sections the engine keeps for one variation of the live document (as the Cohorts panel). */
function keptBy(sections, exp) {
  const host = document.createElement('div');
  host.hidden = true;
  const main = document.createElement('main');
  sections.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'section';
    COHORT_KEYS.forEach((k) => { if (s.meta[k]) d.dataset[k] = s.meta[k]; });
    main.append(d);
  });
  host.append(main);
  document.body.append(host);
  apply(main, exp.keys);
  host.remove();
  return main.children.length;
}

function urlFor(exp) {
  // everyone else: the cohort page's own default (the homepage by the holdout guarantee, checked
  // by verify.js), so it follows edits to the cohort page like the other columns
  const u = exp.id === 'default'
    ? new URL(`${state.path}?cohort=none`, window.location.origin)
    : new URL(previewUrl(window.location.origin, state.path, exp, rules));
  // notes only with Explain, and never the presenter dock: the gallery chooses the visitor
  if (!state.explain) u.searchParams.delete('demo');
  else {
    u.searchParams.set('demo', '');
    u.searchParams.set('insights', '');
    u.searchParams.set('dock', 'off');
  }
  return u.toString().replace(/=(&|$)/g, '$1');
}

/* ---------- selection ---------- */

const isShown = (exp) => !state.shown || state.shown.has(exp.id);
const shownCount = () => state.exps.filter(isShown).length;

function setShown(ids) {
  const set = new Set(ids);
  // never an empty wall
  if (!set.size) return;
  state.shown = set.size === state.exps.length ? null : set;
  save();
  syncColumns();
  renderTop();
}

function toggle(id) {
  const set = new Set(state.exps.filter(isShown).map((e) => e.id));
  if (set.has(id)) set.delete(id); else set.add(id);
  setShown(set);
}

const only = (id) => setShown([id]);
const all = () => setShown(state.exps.map((e) => e.id));

/* ---------- columns ---------- */

const columns = () => [...app.querySelectorAll('.col')];

/* every column scrolls to the same point of the page (same device width, so the same place) */
let leader = null;
function follow(from, y) {
  state.y = y;
  columns().forEach((col) => {
    const f = col.querySelector('iframe');
    if (f === from) return;
    try { f.contentWindow.scrollTo(0, y); } catch { /* cross-origin: reported as a problem */ }
  });
}

function wireFrame(frame, exp) {
  frame.addEventListener('load', () => {
    let win;
    try {
      win = frame.contentWindow;
      // throws when the frame is cross-origin
      const main = win.document.querySelector('main');
      check(`frame-${exp.id}`, !!main, `${exp.label} did not load (blocked or an error page)`);
      if (state.y) win.scrollTo(0, state.y);
      setTimeout(() => {
        frame.dataset.sections = win.document.querySelectorAll('main > .section').length;
        badge(frame.closest('.col'), exp);
      }, 1500);
      win.addEventListener('scroll', () => {
        // the column the reader scrolls leads; the others follow until it stops
        if (leader && leader !== frame) return;
        leader = frame;
        clearTimeout(frame.lead);
        frame.lead = setTimeout(() => { leader = null; }, 150);
        follow(frame, win.scrollY);
      }, { passive: true });
    } catch (e) {
      check('framing', false, `The pages load from another origin: the columns cannot scroll together (${e.message})`);
    }
  });
}

function previewCheck() {
  const stale = columns().filter((c) => c.querySelector('.badge.stale')).length;
  check('preview', !stale, `${stale} variation${stale > 1 ? 's have' : ' has'} edits that are not previewed yet: preview the page to see them`);
}

/* the frames show the previewed page; the live document may hold edits not previewed yet */
function badge(col, exp) {
  const frame = col?.querySelector('iframe');
  if (!frame?.dataset.sections || !state.sections) return;
  const shown = Number(frame.dataset.sections);
  const el = col.querySelector('.badge');
  const expected = keptBy(state.sections, exp);
  el.className = `badge${shown === expected ? '' : ' stale'}`;
  el.textContent = shown === expected ? `${shown} sections` : `Preview: ${shown} of ${expected}`;
  el.title = shown === expected ? '' : 'The document has edits for this variation that are not previewed yet. Preview the page to see them.';
  previewCheck();
}

function column(exp) {
  const f = h('iframe');
  f.src = urlFor(exp);
  f.title = `${exp.label}, ${DEVICES[state.device].label.toLowerCase()}`;
  wireFrame(f, exp);
  const open = h('a', 'icon-btn open', '↗');
  open.href = f.src;
  open.target = '_blank';
  open.rel = 'noopener';
  open.title = `Open ${exp.label} in a new tab`;
  open.setAttribute('aria-label', open.title);
  const close = h('button', 'icon-btn close', '');
  close.type = 'button';
  close.title = `Remove ${exp.label} from the comparison`;
  close.setAttribute('aria-label', close.title);
  close.addEventListener('click', () => toggle(exp.id));
  const col = tint(h(
    'figure',
    'col',
    h('figcaption', 'cap', dot(exp.id), h('span', 'name', exp.label), h('span', 'badge', ''), open, close),
    h('div', 'frame', f),
  ), exp.id);
  col.dataset.id = exp.id;
  return col;
}

/** Add and remove columns in place, in the order of the variations: the others keep loading. */
function syncColumns() {
  const stage = app.querySelector('.stage');
  if (!stage) return;
  const want = state.exps.filter(isShown).map((e) => e.id);
  const colOf = (id) => stage.querySelector(`.col[data-id="${CSS.escape(id)}"]`);
  columns().forEach((c) => { if (!want.includes(c.dataset.id)) c.remove(); });
  want.forEach((id, i) => {
    if (colOf(id)) return;
    const next = want.slice(i + 1).map(colOf).find(Boolean);
    stage.insertBefore(column(state.exps.find((e) => e.id === id)), next || null);
  });
  stage.classList.toggle('single', want.length === 1);
  fit();
  previewCheck();
}

function fit() {
  const stage = app.querySelector('.stage');
  if (!stage) return;
  const d = DEVICES[state.device];
  const cols = columns();
  const W = stage.clientWidth - GAP * 2;
  // fill the width; below the minimum column width the wall scrolls sideways
  const colW = Math.max(d.min, Math.min(d.w, (W - GAP * (cols.length - 1)) / cols.length));
  const s = colW / d.w;
  cols.forEach((col) => {
    const box = col.querySelector('.frame');
    const f = box.querySelector('iframe');
    col.style.width = `${colW}px`;
    f.style.width = `${d.w}px`;
    f.style.height = `${box.clientHeight / s}px`;
    f.style.transform = `scale(${s})`;
  });
  const scale = app.querySelector('.scale');
  if (scale) scale.textContent = `${d.w}px · ${Math.round(s * 100)}%`;
}

/* ---------- header: compare picker, device, explain ---------- */

function menuRow(e, i, n, max) {
  const box = h('input');
  box.type = 'checkbox';
  box.checked = isShown(e);
  box.id = `cmp-${i}`;
  // the last one shown cannot be unticked: the wall is never empty
  box.disabled = box.checked && n === 1;
  box.addEventListener('change', () => toggle(e.id));
  const count = state.sections ? `${keptBy(state.sections, e)} sections` : '';
  const label = h('label', 'mname', h('span', 'mlabel', e.label), h('span', 'msub', count));
  label.htmlFor = box.id;
  const bar = h('span', 'mbar', tint(h('span', ''), e.id));
  bar.firstChild.style.width = `${((e.share || 0) / max) * 100}%`;
  const onlyBtn = h('button', 'text-btn only', 'Only');
  onlyBtn.type = 'button';
  onlyBtn.setAttribute('aria-label', `Only ${e.label}`);
  onlyBtn.addEventListener('click', () => only(e.id));
  return tint(h(
    'div',
    `mrow${box.checked ? ' on' : ''}`,
    h('span', 'cbox', box, h('span', 'cmark', '')),
    dot(e.id),
    label,
    e.share != null ? bar : h('span', ''),
    h('span', 'mpct', e.share != null ? pct(e.share) : ''),
    onlyBtn,
    h('kbd', '', i < 9 ? String(i + 1) : ''),
  ), e.id);
}

function renderPicker() {
  const wrap = h('div', 'picker-wrap');
  const n = shownCount();
  const total = state.exps.length;
  const trigger = h(
    'button',
    'picker',
    h('span', 'plabel', 'Compare'),
    h('span', 'pdots', state.exps.filter(isShown).map((e) => dot(e.id))),
    h('span', 'pvalue', n === total ? `All ${n}` : `${n} of ${total}`),
    h('span', 'chevron'),
  );
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', String(state.menu));
  trigger.addEventListener('click', () => { state.menu = !state.menu; renderTop(); });
  wrap.append(trigger);
  if (!state.menu) return wrap;

  const menu = h('div', 'menu');
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Variations to compare');
  const allBtn = h('button', 'text-btn', 'All');
  allBtn.type = 'button';
  allBtn.disabled = n === total;
  allBtn.addEventListener('click', all);
  menu.append(h('div', 'mhead', h('span', 'mtitle', 'Variations'), allBtn));
  const max = Math.max(...state.exps.map((e) => e.share || 0)) || 1;
  state.exps.forEach((e, i) => menu.append(menuRow(e, i, n, max)));
  menu.append(h('p', 'mfoot', 'Keys 1 to 9 tick or untick a variation, 0 shows all. × on a column removes it.'));
  menu.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    state.menu = false;
    renderTop();
    app.querySelector('.picker')?.focus();
  });
  wrap.append(menu);
  return wrap;
}

function renderDevices() {
  const group = h('div', 'action-group');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Device');
  Object.entries(DEVICES).forEach(([id, d]) => {
    const b = h('button', 'action', d.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.device === id));
    b.addEventListener('click', () => {
      if (state.device === id) return;
      state.device = id;
      state.y = 0;
      save();
      renderStage();
      renderTop();
    });
    group.append(b);
  });
  return group;
}

function renderExplain() {
  const b = h('button', 'switch', h('span', 'track', h('span', 'handle')), h('span', '', 'Explain'));
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(state.explain));
  b.title = 'Show why each section is there, with the Optel data behind it';
  b.addEventListener('click', () => {
    state.explain = !state.explain;
    renderStage();
    renderTop();
  });
  return b;
}

function renderTop() {
  const focusId = document.activeElement?.closest?.('.picker-wrap') ? document.activeElement.id : '';
  const top = h(
    'header',
    'top',
    h('h1', '', 'Cohort gallery'),
    renderPicker(),
    renderDevices(),
    renderExplain(),
    state.live ? null : h('span', 'sub', 'Published page: not connected to the editor'),
    h('span', 'scale', ''),
  );
  const old = app.querySelector('.top');
  if (old) old.replaceWith(top); else app.prepend(top);
  if (!app.querySelector('.notice')) renderNotice();
  if (focusId) document.getElementById(focusId)?.focus();
  fit();
}

function renderStage() {
  const stage = h('main', `stage ${state.device}`);
  const old = app.querySelector('.stage');
  if (old) old.replaceWith(stage);
  else app.append(stage);
  syncColumns();
}

function render() {
  if (!state.exps.length) return;
  // a saved choice that names variations no longer on the page: show all
  if (state.shown && !state.exps.some(isShown)) state.shown = null;
  app.replaceChildren();
  renderStage();
  renderTop();
}

/* ---------- keys and clicks ---------- */

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (/^[1-9]$/.test(ev.key)) {
    const e = state.exps[Number(ev.key) - 1];
    if (e) { ev.preventDefault(); toggle(e.id); }
  } else if (ev.key === '0') {
    ev.preventDefault();
    all();
  }
});

document.addEventListener('click', (ev) => {
  if (state.menu && !ev.target.closest('.picker-wrap')) { state.menu = false; renderTop(); }
});

/* ---------- boot ---------- */

function setDocument(html) {
  state.sections = parseHtml(html).sections;
  const ids = (x) => x.map((e) => e.id).join();
  const exps = experiencesOf(rules, state.sections, state.cohortsJson);
  const changed = ids(exps) !== ids(state.exps);
  state.exps = exps;
  if (changed || !app.querySelector('.stage')) render();
  else columns().forEach((col) => badge(col, state.exps.find((e) => e.id === col.dataset.id)));
}

async function showPublished() {
  const plain = state.path.endsWith('/') ? `${state.path}index.plain.html` : `${state.path}.plain.html`;
  const res = await fetch(plain, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${plain}: ${res.status}`);
  setDocument(await res.text());
}

async function loadShares() {
  try {
    const res = await fetch('/cohorts/cohorts.json');
    state.cohortsJson = res.ok ? await res.json() : null;
  } catch { state.cohortsJson = null; }
}

async function boot() {
  window.addEventListener('resize', fit);
  await loadShares();
  const inFrame = window.parent !== window;
  if (!inFrame || params.has('path')) {
    state.path = state.path || rules.pocPath || '/new';
    await showPublished();
    return;
  }
  const nx = params.get('nx') ? `https://${params.get('nx')}--da-nx--adobe.aem.live` : 'https://da.live';
  const timer = setTimeout(() => check('handshake', false, 'No answer from Experience Workspace after 8 seconds: close and open the gallery again'), 8000);
  const { default: DA_SDK } = await import(`${nx}/nx/utils/sdk.js`);
  const sdk = await DA_SDK;
  clearTimeout(timer);
  const ctx = sdk.context || {};
  // the homepage's document is /index; its pages are served at /
  state.path = (ctx.path || rules.pocPath || '/new').replace(/\/index$/, '/');
  check('handshake', true);
  if (typeof sdk.actions?.subscribeLiveDocument === 'function') {
    sdk.actions.subscribeLiveDocument(({ html }) => { state.live = true; setDocument(html); });
    setTimeout(() => { if (!state.sections) showPublished(); }, 2500);
  } else {
    await showPublished();
  }
}

boot().catch((e) => {
  app.append(h('p', 'note bad', `Could not start: ${e.message}`));
});
