/*
 * Cohorts: an Experience Workspace panel for the homepage's page variations. It shows which
 * sections each visitor group gets while you edit, and makes the changes a homepage manager
 * needs: hide or remove a section for one group, move it up, add a section for a group.
 *
 * - Reads the page the author is editing live (SDK subscribeLiveDocument: the editor's HTML, the
 *   selected block and whether the page is editable). Without it, the published page.
 * - Runs the site's own engine (scripts/cohorts.js apply()) once per group, with the site's rules
 *   (scripts/cohort-rules.js): what the panel shows is what visitors get.
 * - Edits: Section Metadata changes go to the Experience Workspace assistant as one exact request
 *   (setPrompt), and the panel confirms them in the live document (edits.js explains why). New
 *   sections are dragged into the page (makeDraggable) or inserted at the cursor (sendHTML).
 * - Shares per group from cohorts.json (homepage-cohorts size.js, Optel), when published.
 *
 * Standalone (no Experience Workspace): /tools/cohorts/index.html?path=/new reads the published
 * page; edits are offered as text to copy. ?nx=<branch> imports the SDK from that da-nx branch.
 */
/* render() and the handlers call each other: the panel re-renders from state */
/* eslint-disable no-use-before-define */
import { apply } from '../../scripts/cohorts.js';
import rules from '../../scripts/cohort-rules.js';
import { sendPick, readPick } from '../../scripts/cohort-preview.js';
import {
  COHORT_KEYS, parsePage, sectionOfBlock, sectionLabel, experiencesOf, audienceOf, lint, holdout,
  previewUrl, list, shortName, intentName, interestSources, variantDiff, groupColor,
} from './model.js';
import {
  KEY_LABEL, applied, metaEdit, deleteEdit, reverse, promptFor, manualText, versionPrompt,
  newSectionHtml,
} from './edits.js';

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app');
const ASK_TIMEOUT = 120000;

const state = {
  path: params.get('path') || null,
  live: false,
  editable: true,
  doc: null, // { page, sections }
  views: [], // [{ id, order: [i], promoted: [i] }]
  exps: [],
  pick: params.get('exp') || null,
  selected: null, // section index: the canvas cursor or a row the author opened
  fromCanvas: false,
  original: null, // sections of the published homepage, for the holdout check
  cohortsJson: null,
  actions: null,
  capabilities: {},
  tab: 'page',
  menu: false,
  hiddenOpen: false,
  confirm: null, // section index waiting for "delete?"
  pending: null, // { edit, timer }
  toast: null, // { kind: 'asked'|'done'|'fail'|'info', text, edit?, manual? }
  drags: [],
};

const h = (tag, cls, ...kids) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  kids.flat().forEach((k) => {
    if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  });
  return el;
};
const btn = (cls, label, onClick, key) => {
  const b = h('button', cls, label);
  b.type = 'button';
  if (key) b.dataset.key = key;
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const pct = (x) => {
  if (x == null) return '';
  if (x > 0 && x < 0.001) return '<0.1%';
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
};
const colorOf = (id) => groupColor(rules, id);
const tint = (el, id) => { el.style.setProperty('--c', colorOf(id)); return el; };
const expById = (id) => state.exps.find((e) => e.id === id);
const viewById = (id) => state.views.find((v) => v.id === id);
const name = (id) => shortName(rules, id);
const visible = (s) => s.blocks.length || s.heading;
/** The groups: Everyone else first (the baseline), then most visitors first. */
const groups = () => {
  const all = state.exps.filter((e) => !e.intent);
  const rest = all.filter((e) => e.id !== 'default').sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
  return [...all.filter((e) => e.id === 'default'), ...rest];
};
/** Every variation in display order, interest variants after their group. */
const ordered = () => groups()
  .flatMap((p) => [p, ...state.exps.filter((e) => e.intent && e.experience === p.id)]);
const rank = (id) => ordered().findIndex((e) => e.id === id);
const picked = () => expById(state.pick);
const canAsk = () => state.live && state.editable !== false
  && typeof state.actions?.setPrompt === 'function';
const canInsert = () => state.live && state.editable !== false
  && typeof state.actions?.sendHTML === 'function';

/** The engine's view of the page for one group: section order after apply(). */
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
      state.pick = 'default';
      if (state.live) state.syncLayout = true; // tell the Layout view once the page is read
    }
  }
}

/* ---------- actions ---------- */

/** Pick a group; in Experience Workspace the Layout view follows. */
function choose(id, { close = true } = {}) {
  state.pick = id;
  state.confirm = null;
  if (close) state.menu = false;
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

function openRow(i) {
  state.selected = state.selected === i && !state.fromCanvas ? null : i;
  state.fromCanvas = false;
  state.confirm = null;
  render();
}

function showSection(i) {
  state.tab = 'page';
  state.selected = i;
  state.fromCanvas = false;
  const view = viewById(state.pick);
  if (view && !view.order.includes(i)) state.hiddenOpen = true;
  render();
  app.querySelector(`[data-key="row-${i}"]`)?.scrollIntoView({ block: 'center' });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Ask the assistant for one Section Metadata change and watch the page for it. */
async function request(edit) {
  const s = state.doc.sections[edit.i];
  state.confirm = null;
  if (!canAsk()) {
    const manual = manualText(edit, s);
    const ok = await copy(manual);
    state.toast = {
      kind: 'info', text: ok ? 'Copied. Paste it into the page:' : 'Make this change in the page:', manual,
    };
    render();
    return;
  }
  clearTimeout(state.pending?.timer);
  state.pending = { edit, timer: setTimeout(() => settle(false), ASK_TIMEOUT) };
  state.toast = { kind: 'asked', text: `${edit.label}: asked the assistant, watching the page…`, edit };
  state.actions.setPrompt(promptFor(edit, s), { autoSend: true });
  render();
}

function settle(ok) {
  const p = state.pending;
  if (!p) return;
  clearTimeout(p.timer);
  state.pending = null;
  const { edit } = p;
  const s = state.doc.sections[edit.i] || {
    i: edit.i, blocks: [], heading: '', meta: {},
  };
  if (ok) {
    const now = edit.kind === 'meta'
      ? `${KEY_LABEL[edit.key]}: ${edit.after.join(', ') || 'removed'}` : 'The section is gone.';
    state.toast = {
      kind: 'done', text: `${edit.label}. ${now}`, edit,
    };
  } else {
    state.toast = {
      kind: 'fail',
      text: `Not in the page yet: ${edit.label}. Check the chat, or make the change by hand:`,
      manual: manualText(edit, s),
    };
  }
  render();
}

function checkPending() {
  if (state.pending && applied(state.doc.sections, state.pending.edit)) settle(true);
}

function undo(edit) {
  if (edit.kind === 'delete') {
    state.toast = { kind: 'info', text: 'Undo the delete in the editor (Cmd+Z), or restore a version.' };
    render();
    return;
  }
  request(reverse(edit, `Undo: ${edit.label}`));
}

function insertSection(exp) {
  const gid = exp.id;
  state.actions.sendHTML(newSectionHtml(gid, name(gid)));
  state.toast = { kind: 'info', text: `Inserted a ${name(gid)} section at the cursor. Check where it landed, then write its content.` };
  render();
}

function draftVersion(s, exp) {
  state.actions.setPrompt(versionPrompt(s, exp.id, name(exp.id), exp.sub), { autoSend: false });
  state.toast = { kind: 'info', text: 'The request is in the chat. Edit it if you like, then send it.' };
  render();
}

/** What the author can do to a section for the picked group. */
function actionsFor(s, onPage) {
  const exp = picked();
  const g = exp.id;
  const who = name(g);
  const title = `section ${s.i + 1} (${sectionLabel(s).what})`;
  const only = list(s.meta.cohorts);
  const hide = list(s.meta.hideFor);
  const out = [];
  if (onPage) {
    if (s.meta.slot) {
      if (only.includes(g) && only.length > 1) {
        out.push([`Remove from ${who}`, () => request(metaEdit(s, 'cohorts', 'remove', g, `Remove ${title} from ${who}`))]);
      } else if (only.includes(g)) {
        out.push(['Delete section…', () => { state.confirm = s.i; render(); }, 'quiet']);
      }
    } else if (!only.length) {
      out.push([`Hide for ${who}`, () => request(metaEdit(s, 'hideFor', 'add', g, `Hide ${title} for ${who}`))]);
    } else if (only.length > 1) {
      out.push([`Remove from ${who}`, () => request(metaEdit(s, 'cohorts', 'remove', g, `Remove ${title} from ${who}`))]);
    } else {
      out.push(['Delete section…', () => { state.confirm = s.i; render(); }, 'quiet']);
    }
    if (!s.meta.slot && g !== 'default') {
      const up = list(s.meta.promote).includes(g);
      out.push(up
        ? [`Don't move up for ${who}`, () => request(metaEdit(s, 'promote', 'remove', g, `Stop moving ${title} up for ${who}`))]
        : [`Move up for ${who}`, () => request(metaEdit(s, 'promote', 'add', g, `Move ${title} up for ${who}`))]);
    }
  } else if (hide.includes(g)) {
    out.push([`Show for ${who}`, () => request(metaEdit(s, 'hideFor', 'remove', g, `Show ${title} for ${who}`))]);
  } else if (only.length && !only.includes(g)) {
    out.push([`Also show for ${who}`, () => request(metaEdit(s, 'cohorts', 'add', g, `Show ${title} for ${who}`))]);
  }
  if (canAsk() && onPage && (g !== 'default') && !only.includes(g)) {
    out.push([`Draft a ${who} version`, () => draftVersion(s, exp), 'quiet']);
  }
  return out;
}

/* ---------- rendering ---------- */

function chip(id, off = false) {
  return tint(h('span', `chip${off ? ' off' : ''}`, name(id)), id);
}

function dot(id, cls = '') {
  const d = tint(h('span', `dot ${cls}`.trim()), id);
  d.setAttribute('aria-hidden', 'true');
  return d;
}

function renderHeader(root) {
  const issues = lint(state.doc, rules);
  const errors = issues.filter((x) => x.level === 'error').length;
  let status = 'Published';
  if (state.live) status = state.editable === false ? 'Read-only' : 'Live';
  const bar = h('div', 'bar', h('h1', '', 'Homepage variations'), h('span', `status${state.live ? ' on' : ''}`, status));
  if (issues.length) {
    const b = btn(`issues${errors ? ' error' : ''}`, `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`, () => { state.tab = 'checks'; render(); }, 'issues');
    bar.append(b);
  }
  root.append(bar);
  renderSwitcher(root);
  renderTabs(root, issues.length);
}

function renderSwitcher(root) {
  const list0 = groups();
  const cur = picked();
  const base = expById(cur.experience) || cur;
  const wrap = h('div', 'switch');
  const trigger = btn('trigger', null, () => { state.menu = !state.menu; render(); }, 'switch');
  trigger.append(
    dot(base.id),
    h('span', 'tname', cur.intent ? name(cur.id) : name(base.id)),
    h('span', 'tshare', base.share != null ? pct(base.share) : ''),
    h('span', 'caret'),
  );
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', String(state.menu));
  trigger.setAttribute('aria-label', `Page variation: ${name(cur.id)}${base.share != null ? `, ${pct(base.share)} of visitors` : ''}. Arrow keys switch.`);
  trigger.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const k = list0.findIndex((e) => e.id === base.id);
    const next = list0[(k + (ev.key === 'ArrowDown' ? 1 : -1) + list0.length) % list0.length];
    choose(next.id, { close: false });
  });
  wrap.append(trigger);
  // every group's share at once: the strip under the switcher
  const strip = h('div', 'strip');
  strip.setAttribute('aria-hidden', 'true');
  list0.filter((e) => e.share).forEach((e) => {
    const seg = tint(h('span', e.id === base.id ? 'on' : ''), e.id);
    seg.style.flexGrow = String(e.share);
    strip.append(seg);
  });
  wrap.append(strip);
  if (state.menu) {
    const menu = h('div', 'menu');
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Page variations');
    const max = Math.max(...list0.map((e) => e.share || 0)) || 1;
    list0.forEach((e) => {
      const count = viewById(e.id).order.filter((i) => visible(state.doc.sections[i])).length;
      const bar = h('span', 'mbar', tint(h('span', ''), e.id));
      bar.firstChild.style.width = `${((e.share || 0) / max) * 100}%`;
      const o = btn('opt', null, () => choose(e.id), `opt-${e.id}`);
      o.append(dot(e.id), h('span', 'oname', name(e.id), h('span', 'osub', `${count} sections`)), bar, h('span', 'opct', pct(e.share)));
      o.setAttribute('aria-pressed', String(e.id === base.id));
      o.title = e.label;
      menu.append(o);
    });
    menu.addEventListener('keydown', (ev) => {
      const opts = [...menu.querySelectorAll('.opt')];
      const k = opts.indexOf(document.activeElement);
      if (ev.key === 'Escape') { state.menu = false; render(); app.querySelector('.trigger')?.focus(); }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        opts[(k + (ev.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
      }
    });
    wrap.append(menu);
  }
  root.append(wrap);
}

function renderTabs(root, issueCount) {
  const tabs = [['page', 'Page'], ['overview', 'Overview'], ['checks', issueCount ? `Checks (${issueCount})` : 'Checks']];
  const bar = h('div', 'tabs');
  bar.setAttribute('role', 'tablist');
  tabs.forEach(([id, label], k) => {
    const t = btn('tab', label, () => { state.tab = id; render(); }, `tab-${id}`);
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(state.tab === id));
    t.tabIndex = state.tab === id ? 0 : -1;
    t.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      const next = tabs[(k + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0];
      state.tab = next;
      render();
      app.querySelector(`[data-key="tab-${next}"]`)?.focus();
    });
    bar.append(t);
  });
  root.append(bar);
}

function markers(s, view) {
  const m = h('span', 'marks');
  if (s.meta.slot) m.append(h('span', 'mark', `${s.meta.slot} slot`));
  if (view?.promoted.includes(s.i)) m.append(h('span', 'mark up', 'moved up'));
  return m;
}

function row(s, n, view, onPage) {
  const exp = picked();
  const { what, heading } = sectionLabel(s);
  const open = state.selected === s.i;
  const li = h('li', `row${open ? ' open' : ''}${onPage ? '' : ' off'}`);
  const head = btn('rhead', null, () => openRow(s.i), `row-${s.i}`);
  // the dot means one thing: this section is made for the group you are looking at
  const mine = onPage && list(s.meta.cohorts).length;
  head.append(
    h('span', 'num', n),
    mine ? dot(exp.experience) : h('span', 'nodot'),
    h('span', 'rtext', h('span', 'what', what), heading ? h('span', 'heading', heading) : null),
    markers(s, onPage ? view : null),
  );
  head.setAttribute('aria-expanded', String(open));
  if (state.fromCanvas && open) head.append(h('span', 'here', 'cursor'));
  li.append(head);
  if (open) li.append(detail(s, onPage));
  return li;
}

function detail(s, onPage) {
  const who = audienceOf(s.i, state.views);
  Object.values(who).forEach((ids) => ids.sort((a, b) => rank(a) - rank(b)));
  const box = h('div', 'detail');
  const line = (lbl, ids, off) => h('div', 'who', h('span', 'lbl', lbl), h('span', 'chips', ids.length ? ids.map((id) => chip(id, off)) : h('span', 'sub', 'nobody')));
  box.append(line('Shown to', who.shown));
  if (who.hidden.length) box.append(line('Not shown', who.hidden, true));
  if (who.promoted.length) box.append(line('Moved up for', who.promoted));
  if (s.meta.insight) {
    box.append(h('p', 'insight', h('span', 'lbl', 'Why it is here'), String(s.meta.insight).replace(/,(?=[^\s\d])|(?<=\D),(?=\d)/g, ', ')));
  }
  if (s.meta.slot) {
    const rivals = state.doc.sections.filter((x) => x !== s && (x.meta.slot || '').toLowerCase() === s.meta.slot.toLowerCase());
    const wins = !list(s.meta.cohorts).length || list(s.meta.cohorts).includes('default');
    box.append(h('p', 'sub', `One of ${rivals.length + 1} sections in the ${s.meta.slot} slot: each visitor gets one.${wins && onPage && picked().id !== 'default' ? ` This is the default, so ${name(picked().id)} gets it because no ${s.meta.slot} is made for ${name(picked().id)}.` : ''}`));
  }
  if (state.confirm === s.i) {
    const c = h('div', 'confirm', h('p', '', `Delete section ${s.i + 1} from the page? It is only for ${name(picked().id)}; everyone else is unaffected.`));
    const acts = h('div', 'acts');
    acts.append(
      btn('act danger', 'Delete section', () => request(deleteEdit(s, `Delete section ${s.i + 1}`)), `del-${s.i}`),
      btn('act', 'Keep it', () => { state.confirm = null; render(); }),
    );
    c.append(acts);
    box.append(c);
    return box;
  }
  const acts = actionsFor(s, onPage);
  if (acts.length) {
    const row0 = h('div', 'acts');
    acts.forEach(([label, run, kind], k) => {
      const b = btn(`act${kind ? ` ${kind}` : ''}`, label, run, `act-${s.i}-${k}`);
      if (state.pending) b.disabled = true;
      row0.append(b);
    });
    box.append(row0);
    if (state.live && state.editable === false) box.append(h('p', 'sub', 'This page is read-only for you.'));
    else if (!canAsk()) box.append(h('p', 'sub', 'Outside Experience Workspace these copy the change for you to paste.'));
  }
  return box;
}

function renderPage(root) {
  const exp = picked();
  const view = viewById(state.pick);
  const { sections } = state.doc;
  const shown = view.order.map((i) => sections[i]).filter(visible);
  if (exp.id === 'default') {
    root.append(h('p', 'gets', 'Visitors no rule matches. They see the original homepage, so this is also the baseline the other groups are measured against.'));
  } else if (exp.rules.length) {
    const why = exp.rules.map((id) => (rules.rules || []).find((r) => r.id === id)?.label || id);
    root.append(h('p', 'gets', h('span', 'lbl', 'Who gets it '), why.join(' · ')));
  }
  renderInterest(root, exp);
  if (state.selected != null && state.fromCanvas && !view.order.includes(state.selected)) {
    root.append(h('p', 'note', `Your cursor is in section ${state.selected + 1}, which ${name(exp.id)} does not see. It is listed under "Not on this page".`));
  }
  const ol = h('ol', 'rows');
  shown.forEach((s, k) => ol.append(row(s, k + 1, view, true)));
  root.append(ol);
  const hidden = sections.filter((s) => visible(s) && !view.order.includes(s.i));
  if (hidden.length) {
    const d = h('details', 'hidden', h('summary', '', `Not on ${name(exp.id)}'s page (${hidden.length})`));
    d.open = state.hiddenOpen;
    d.addEventListener('toggle', () => { state.hiddenOpen = d.open; });
    const ol2 = h('ol', 'rows');
    hidden.forEach((s) => ol2.append(row(s, s.i + 1, view, false)));
    d.append(ol2);
    root.append(d);
  }
  const prev = h('a', 'link', exp.id === 'default' ? 'Open the original homepage' : `Open the page as ${name(exp.id)} visitors see it`);
  prev.href = previewUrl(window.location.origin, state.path, exp, rules);
  prev.target = '_blank';
  prev.rel = 'noopener';
  root.append(h('p', 'preview', prev));
}

/** Interest variants of the picked group (only when the page has sections for an interest). */
function renderInterest(root, exp) {
  const parent = expById(exp.experience);
  const variants = state.exps.filter((e) => e.intent && e.experience === exp.experience);
  if (!parent || !variants.length) return;
  const who = name(parent.id);
  const src = interestSources(rules, parent.id);
  const box = h('div', 'interest');
  const how = [src.utm.length ? 'the link they came in on' : null, src.memory.length ? 'pages they looked at before' : null].filter(Boolean).join(' or ');
  box.append(h('p', 'sub', `${who} visitors whose interest we know (from ${how}) get the sections made for it.`));
  const r = h('div', 'intents');
  [parent, ...variants].forEach((e) => {
    const b = tint(btn('ichip', intentName(e.intent), () => choose(e.id), `int-${e.id}`), e.id);
    b.setAttribute('aria-pressed', String(state.pick === e.id));
    r.append(b);
  });
  box.append(r);
  if (exp.intent) {
    const d = variantDiff(viewById(parent.id).order, viewById(exp.id).order);
    const label = (i) => `"${sectionLabel(state.doc.sections[i]).heading || sectionLabel(state.doc.sections[i]).what}"`;
    box.append(h('p', 'sub', d.added.length
      ? `Shows ${d.added.map(label).join(', ')}${d.removed.length ? ` instead of ${d.removed.map(label).join(', ')}` : ''}.`
      : 'Same page as without an interest.'));
  }
  root.append(box);
}

function renderOverview(root) {
  const { sections } = state.doc;
  // the group picker at the top lists every group with its share: the overview is the matrix
  const vis = sections.filter(visible);
  const shared = vis.filter((s) => !s.meta.cohorts && !s.meta.hideFor && !s.meta.slot).length;
  root.append(h('h2', '', 'Who sees what'));
  root.append(h('p', 'sub', `${vis.length} sections: ${shared} for everyone, ${vis.length - shared} for some groups only.`));
  const cols = ordered();
  const table = h('table');
  const head = h('tr', '', h('th', '', h('span', 'sr', 'Section')));
  cols.forEach((e) => {
    const th = h('th', '', dot(e.id), h('span', 'abbr', name(e.id).slice(0, 2)));
    th.className = 'col';
    th.title = name(e.id);
    th.setAttribute('aria-label', name(e.id));
    head.append(th);
  });
  table.append(h('thead', '', head));
  const body = h('tbody');
  vis.forEach((s) => {
    const { what, heading } = sectionLabel(s);
    const th = h('th', '', btn('mrow', `${s.i + 1} ${heading || what}`, () => showSection(s.i), `m-${s.i}`));
    th.title = `${what}${heading ? ` · ${heading}` : ''}`;
    const tr = h('tr', state.selected === s.i ? 'sel' : '', th);
    cols.forEach((e) => {
      const v = viewById(e.id);
      const td = h('td');
      if (v.order.includes(s.i)) {
        const up = v.promoted.includes(s.i);
        td.append(dot(e.id, up ? 'moved' : ''));
        td.setAttribute('aria-label', `${name(e.id)}: ${up ? 'shown, moved up' : 'shown'}`);
      } else td.setAttribute('aria-label', `${name(e.id)}: not shown`);
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  root.append(h('div', 'matrix', table));
  root.append(h('p', 'legend', 'Round: shown. Square: shown and moved up.'));
  const src = state.cohortsJson?.meta;
  root.append(h('p', 'foot', src
    ? `Shares: Optel, ${src.domain}${src.path}, ${String(src.start).slice(0, 10)} to ${String(src.end).slice(0, 10)}, ${src.bundles.toLocaleString()} sampled views. Memory rules are estimates.`
    : 'Shares appear when cohorts.json (homepage-cohorts size.js) is published at /cohorts/cohorts.json.'));
}

function renderChecks(root) {
  const issues = lint(state.doc, rules);
  const def = viewById('default');
  // cohort sections on the homepage itself (pocPath '/'): the holdout and "everyone else" both get
  // the default sections of this one document, so there is no second page that could drift
  const onHome = rules.pocPath === '/' && ['/', '/index'].includes(state.path);
  if (onHome && def) {
    root.append(h('div', 'check ok', `Everyone else and the holdout both get this page's ${def.order.length} default sections, so the holdout comparison is fair.`));
  } else if (state.original && def) {
    const r = holdout(state.original, def.order, state.doc.sections);
    root.append(r.ok
      ? h('div', 'check ok', `Everyone else sees the homepage, section for section (${r.count} sections). The holdout comparison is fair.`)
      : h('div', 'check error', `Everyone else does not see the homepage: section ${r.at + 1} is "${r.got}", the homepage has "${r.expected}". Every group is measured against the wrong page until this matches.`));
  }
  if (!issues.length) root.append(h('div', 'check ok', 'No metadata problems found.'));
  issues.forEach((x, k) => {
    const c = h('div', `check ${x.level}`, h('span', '', x.section != null ? `Section ${x.section + 1}: ` : '', x.text));
    if (x.section != null) c.append(btn('linkbtn', 'Show', () => showSection(x.section), `chk-${k}`));
    root.append(c);
  });
}

function renderDock(root) {
  const t = state.toast;
  if (t) {
    const box = h('div', `toast ${t.kind}`);
    box.setAttribute('role', 'status');
    box.append(h('p', '', t.text));
    if (t.manual) box.append(h('code', 'manual', t.manual));
    const acts = h('div', 'tacts');
    if (t.kind === 'done' && t.edit) acts.append(btn('linkbtn', 'Undo', () => undo(t.edit), 'undo'));
    if (t.manual) acts.append(btn('linkbtn', 'Copy', async () => { await copy(t.manual); }, 'copy'));
    if (t.kind !== 'asked') acts.append(btn('linkbtn', 'Dismiss', () => { state.toast = null; render(); }, 'dismiss'));
    else acts.append(btn('linkbtn', 'Stop watching', () => { clearTimeout(state.pending?.timer); state.pending = null; state.toast = null; render(); }, 'stop'));
    box.append(acts);
    root.append(box);
  }
  if (!state.live) return;
  const exp = expById(picked().experience) || picked();
  const acts = h('div', 'dacts');
  const add = btn('primary', `Add section for ${name(exp.id)}`, () => insertSection(exp), 'add');
  add.title = 'Drag it into the page, or click to insert it at the cursor';
  add.disabled = !canInsert();
  acts.append(add);
  if (typeof state.actions?.openComparison === 'function') {
    const review = btn('secondary', 'Review', () => state.actions.openComparison({ candidate: 'document', baseline: 'live' }), 'review');
    review.title = 'Compare your edits with the live page';
    acts.append(review);
  }
  root.append(acts);
  if (canInsert()) root.append(h('p', 'hint', 'Drag into the page, or click to insert at the cursor.'));
  if (canInsert() && typeof state.actions.makeDraggable === 'function') {
    const html = newSectionHtml(exp.id, name(exp.id));
    state.actions.makeDraggable({
      element: add,
      getData: () => ({ data: { 'text/html': html } }),
      onResult: ({ ok, error }) => {
        if (ok) state.toast = { kind: 'info', text: `Added a ${name(exp.id)} section. Write its content in the page.` };
        else if (error !== 'cancelled') state.toast = { kind: 'fail', text: `Could not drop the section (${error}).` };
        render();
      },
    }).then((dispose) => state.drags.push(dispose)).catch(() => {});
  }
}

function render() {
  const key = document.activeElement?.dataset?.key;
  const { scrollY } = window;
  state.drags.splice(0).forEach((d) => { try { d(); } catch { /* gone */ } });
  app.replaceChildren();
  if (!state.doc) {
    app.append(h('div', 'top', h('div', 'bar', h('h1', '', 'Homepage variations'))), h('p', 'status-line', 'Reading the page…'));
    return;
  }
  const usesCohorts = state.doc.sections.some((s) => COHORT_KEYS.some((k) => s.meta[k]));
  if (!usesCohorts) {
    const home = ['/', '/index'].includes(state.path) && rules.pocPath && rules.pocPath !== '/';
    app.append(
      h('div', 'top', h('div', 'bar', h('h1', '', 'Homepage variations'))),
      h('p', 'status-line', 'This page has no cohort sections, so every visitor sees all of it.'),
      home ? h('p', 'status-line', `The homepage's page variations live on ${rules.pocPath}: open that page to edit them.`) : null,
    );
    return;
  }
  const top = h('header', 'top');
  renderHeader(top);
  const body = h('div', 'body');
  body.setAttribute('role', 'tabpanel');
  if (state.tab === 'overview') renderOverview(body);
  else if (state.tab === 'checks') renderChecks(body);
  else renderPage(body);
  const dock = h('footer', 'dock');
  renderDock(dock);
  app.append(top, body);
  if (dock.childNodes.length) app.append(dock);
  window.scrollTo(0, scrollY);
  if (key) app.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
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
  let moved = false;
  if (selection && Number.isInteger(selection.blockIndex)) {
    const i = sectionOfBlock(state.doc.sections, selection.blockIndex);
    moved = i !== state.selected || !state.fromCanvas;
    state.selected = i;
    state.fromCanvas = i != null;
  }
  compute();
  checkPending();
  if (state.syncLayout) { state.syncLayout = false; choose(state.pick); return; }
  render();
  if (moved && state.tab === 'page' && state.selected != null) {
    const view = viewById(state.pick);
    if (!view.order.includes(state.selected) && !state.hiddenOpen) {
      state.hiddenOpen = true;
      render();
    }
    app.querySelector(`[data-key="row-${state.selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }
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
  state.capabilities = sdk.capabilities || {};
  const ctx = sdk.context || sdk.project || {};
  state.path = ctx.path || '/';
  // the editor's live HTML carries no page Metadata block (EW edits it in its Page panel):
  // page-level keys (Cohorts: on, Experiment) come from the published page, the document wins
  const [, pubMeta] = await Promise.all([loadSide(), readPageMeta(state.path)]);
  // a finished chat turn: the requested edit is in the page by now, or it is not coming
  if (state.capabilities.chatTurnCompleted === 1
    && typeof sdk.actions.subscribeChatTurnCompleted === 'function') {
    sdk.actions.subscribeChatTurnCompleted(() => {
      if (!state.pending) return;
      // the live document can arrive just after the turn: give it a moment
      setTimeout(() => {
        if (state.pending) settle(applied(state.doc.sections, state.pending.edit));
      }, 2000);
    });
  }
  try {
    if (typeof sdk.actions.subscribeLiveDocument !== 'function') throw new Error('no live document');
    sdk.actions.subscribeLiveDocument(({ html, selection, editable }) => {
      state.live = true;
      if (typeof editable === 'boolean') state.editable = editable;
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
  document.addEventListener('click', (ev) => {
    if (state.menu && !ev.target.closest('.switch')) { state.menu = false; render(); }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.menu) { state.menu = false; render(); app.querySelector('.trigger')?.focus(); }
  });
  const inFrame = window.parent !== window;
  if (!inFrame || params.has('path')) { await startStandalone(); return; }
  const nx = params.get('nx') ? `https://${params.get('nx')}--da-nx--adobe.aem.live` : 'https://da.live';
  const timer = setTimeout(() => {
    app.append(h('p', 'check error', 'No handshake from Experience Workspace after 8s. Open this from the tool panel; header-rewriting extensions and Grammarly break the handshake.'));
  }, 8000);
  const { default: DA_SDK } = await import(`${nx}/nx/utils/sdk.js`);
  const sdk = await DA_SDK;
  clearTimeout(timer);
  await startInWorkspace(sdk);
}

boot().catch((e) => {
  app.append(h('p', 'check error', `Could not read the page: ${e.message}`));
});
