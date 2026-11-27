/* eslint no-use-before-define: ["error", { "functions": false }] */
/*
 * Brand visibility, a full-screen Experience Workspace extension (library experience
 * "fullsize-dialog"). It is site-wide: it does not read the page that is open. Two steps:
 *   1 Decide: a map of demand against share of answers, and the topic table with the data.
 *     The team marks each topic Focus, Watch or Skip; choices are shared in
 *     /brand-visibility/focus.json (Source Bus, previewed and never published).
 *   2 Plan: the changes suggested for the topics on Focus, with their evidence. A change, or the
 *     whole plan, can be drafted in the chat (setPrompt, not sent), or its page opened.
 * The data (/brand-visibility/brand-visibility.json) is written by the skill run.
 * Outside the workspace (opened directly, or with ?path=) choices are not saved.
 */
import {
  JOBS, CHOICES, CHOICE_LABEL, choiceOf, filtered, counts, compact, change,
  choicesDoc, shortPage, draftPrompt, sourceTarget, planOf, planPrompt, sortBy, logScale,
  GOALS, goalLabel, byGoal,
} from './model.js';

const DATA = '/brand-visibility/brand-visibility.json';
const CHOICES_PATH = 'brand-visibility/focus.json';
const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app');
const SVGNS = 'http://www.w3.org/2000/svg';

const state = {
  data: null,
  saved: null,
  view: params.get('view') === 'plan' ? 'plan' : 'decide',
  filter: 'all',
  sort: { key: 'prompts', dir: -1 },
  selected: params.get('topic'),
  actions: null,
  token: null,
  target: null,
  save: { status: 'idle', error: null },
};

const h = (tag, cls, ...kids) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  kids.flat().forEach((k) => {
    if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  });
  return el;
};
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  kids.forEach((k) => el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
};
const btn = (cls, label, onClick, attrs = {}) => {
  const b = h('button', cls, label);
  b.type = 'button';
  Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const link = (cls, label, href) => {
  const a = h('a', cls, label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};
const jobChip = (job) => h('span', `job job-${job.toLowerCase()}`, h('i', 'dot'), job);
const goalTag = (goal) => h('span', `goal-tag goal-tag-${goal || 'seen'}`, goal === 'chosen' ? 'Chosen' : 'Seen');
const canSave = () => !!(state.token && state.target);
const canDraft = () => typeof state.actions?.setPrompt === 'function';
const themeById = (id) => state.data.themes.find((t) => t.id === id);
const draft = (text) => state.actions.setPrompt(text, { autoSend: false });
const select = (id) => { state.selected = state.selected === id ? null : id; render(); };
// Wording that depends on the market: the data file's meta.labels, with these defaults
const LABELS = {
  peer: 'next competitor', peers: 'Competitors', growth: 'Growth area', notes: 'Across the sites',
};
const word = (k) => state.data.meta.labels?.[k] || LABELS[k];
const peerName = (p) => p.name || p.best || '';

/* ---------- saving choices ---------- */

async function saveChoice(id, choice) {
  const prev = state.saved;
  state.saved = choicesDoc(state.saved, id, choice);
  state.save = { status: canSave() ? 'saving' : 'local', error: null };
  render();
  if (!canSave()) return;
  const { org, site } = state.target;
  const base = `https://api.aem.live/${org}/sites/${site}`;
  const auth = { Authorization: `Bearer ${state.token}` };
  try {
    const put = await fetch(`${base}/source/${CHOICES_PATH}`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.saved, null, 1),
    });
    if (!put.ok) throw new Error(`saving returned ${put.status}`);
    const pre = await fetch(`${base}/preview/${CHOICES_PATH}`, { method: 'POST', headers: auth });
    if (!pre.ok) throw new Error(`preview returned ${pre.status}`);
    state.save = { status: 'saved', error: null };
  } catch (e) {
    state.saved = prev;
    state.save = { status: 'error', error: e.message };
  }
  render();
}

function choiceControl(theme) {
  const cur = choiceOf(theme, state.saved);
  const group = h('div', 'choice');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', `${theme.label}: decision`);
  CHOICES.forEach((c) => {
    group.append(btn(`opt opt-${c}${c === cur ? ' on' : ''}`, CHOICE_LABEL[c], (ev) => {
      ev.stopPropagation();
      if (c !== cur) saveChoice(theme.id, c);
    }, { role: 'radio', 'aria-checked': String(c === cur) }));
  });
  return group;
}

function saveStatus() {
  const st = state.save;
  if (!canSave()) return h('span', 'save muted', 'Not saved here: open in Experience Workspace to save');
  if (st.status === 'saving') return h('span', 'save muted', 'Saving…');
  if (st.status === 'error') return h('span', 'save error', `Not saved: ${st.error}`);
  if (st.status === 'saved') return h('span', 'save ok', 'Saved for everyone');
  return h('span', 'save muted', state.saved?.updated ? `Decisions saved ${state.saved.updated.slice(0, 10)}` : 'Defaults: nothing decided yet');
}

/* ---------- header ---------- */

function header() {
  const focus = planOf(state.data.themes, state.saved);
  const n = focus.reduce((a, t) => a + (t.suggestions?.length || 0), 0);
  const tab = (id, num, label, extra) => btn(`tab${state.view === id ? ' on' : ''}`, [h('span', 'step', num), label, extra ? h('span', 'count', extra) : null], () => {
    state.view = id;
    render();
  }, { role: 'tab', 'aria-selected': String(state.view === id) });
  const tabs = h('nav', 'tabs', tab('decide', '1', 'Decide', `${focus.length} on Focus`), tab('plan', '2', 'Plan', `${n} changes`));
  tabs.setAttribute('role', 'tablist');
  return h(
    'header',
    'top',
    h('div', 'title', h('p', 'intro', 'Choose where to improve brand visibility by selecting which topics to claim, defend or win.'), h('span', 'muted', `Data as of ${state.data.meta.asOf}`)),
    tabs,
    saveStatus(),
  );
}

/* ---------- 1 Decide: the map ---------- */

const W = 720;
const H = 300;
const M = {
  l: 44, r: 12, t: 14, b: 38,
};

function tip(p) {
  const el = app.querySelector('.tip');
  if (!el) return;
  if (!p) { el.hidden = true; return; }
  const svg = app.querySelector('.map');
  const k = svg.getBoundingClientRect().width / W;
  el.replaceChildren(
    h('b', null, p.t.label),
    h('span', null, `${compact(p.t.potential.prompts)} prompts a month`),
    h('span', null, `${p.t.standing.share}% of answers`),
    h('span', null, `${compact(p.t.potential.aiVisits)} AI visits`),
  );
  el.style.left = `${p.px * k}px`;
  el.style.top = `${p.py * k}px`;
  el.hidden = false;
}

function map(themes) {
  const prompts = themes.map((t) => t.potential.prompts);
  const x = logScale([Math.min(...prompts) * 0.8, Math.max(...prompts) * 1.25], [M.l, W - M.r]);
  const yMax = Math.max(16, ...themes.map((t) => t.standing.share + 2));
  const y = (v) => H - M.b - (v / yMax) * (H - M.t - M.b);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'map', role: 'img', 'aria-label': 'Topics by prompts a month and share of answers',
  });
  // zones by the job rule; a rule by rank has no share bands, the dots carry the job
  const zones = state.data.meta.jobBy === 'rank' ? [] : [[10, yMax, 'Defend'], [5, 10, 'Win'], [0, 5, 'Claim']];
  zones.forEach(([a, b, job]) => {
    svg.append(s('rect', {
      x: M.l, y: y(b), width: W - M.l - M.r, height: y(a) - y(b), class: `zone zone-${job.toLowerCase()}`,
    }));
    svg.append(s('text', { x: M.l + 8, y: y(b) + 16, class: 'zone-label' }, job));
  });
  [0, 5, 10, 15].filter((v) => v <= yMax).forEach((v) => {
    svg.append(s('line', {
      x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), class: v ? 'grid' : 'axis',
    }));
    svg.append(s('text', {
      x: M.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end',
    }, `${v}%`));
  });
  [5e5, 1e6, 2e6, 5e6].forEach((v) => {
    const px = x(v);
    if (px < M.l || px > W - M.r) return;
    svg.append(s('text', {
      x: px, y: H - M.b + 16, class: 'tick', 'text-anchor': 'middle',
    }, compact(v)));
  });
  svg.append(s('text', {
    x: (M.l + W - M.r) / 2, y: H - 4, class: 'axis-title', 'text-anchor': 'middle',
  }, 'Prompts a month (log scale)'));
  const mid = (M.t + H - M.b) / 2;
  svg.append(s('text', {
    x: 12, y: mid, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${mid})`,
  }, 'Share of answers'));
  // points, then labels: each takes the first spot (right, left, above, below, then right-aligned
  // above or below) that stays in the plot and clear of the dots and the labels already placed;
  // about 6px a character at 12px
  const pts = themes.map((t) => ({ t, px: x(t.potential.prompts), py: y(t.standing.share) }));
  const boxes = pts.map((p) => [p.px - 8, p.py - 8, p.px + 8, p.py + 8]);
  zones.forEach(([, b]) => boxes.push([M.l, y(b), M.l + 60, y(b) + 20]));
  const hits = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  pts.forEach((p) => {
    const w = p.t.label.length * 6;
    const spots = [
      [p.px + 12, p.py + 4, 'start', [p.px + 11, p.py - 8, p.px + 12 + w, p.py + 7]],
      [p.px - 12, p.py + 4, 'end', [p.px - 12 - w, p.py - 8, p.px - 11, p.py + 7]],
      [p.px, p.py - 13, 'middle', [p.px - w / 2, p.py - 25, p.px + w / 2, p.py - 10]],
      [p.px, p.py + 22, 'middle', [p.px - w / 2, p.py + 10, p.px + w / 2, p.py + 25]],
      [p.px + 8, p.py - 13, 'end', [p.px + 8 - w, p.py - 25, p.px + 8, p.py - 10]],
      [p.px + 8, p.py + 22, 'end', [p.px + 8 - w, p.py + 10, p.px + 8, p.py + 25]],
    ];
    const fits = (b) => b[0] >= M.l && b[2] <= W - M.r && b[1] >= 0 && b[3] <= H - M.b;
    p.label = spots.find(([, , , b]) => fits(b) && !hits(b))
      || spots.find(([, , , b]) => fits(b)) || spots[0];
    boxes.push(p.label[3]);
  });
  pts.forEach((p) => {
    const choice = choiceOf(p.t, state.saved);
    const g = s('g', {
      class: `pt job-${p.t.job.toLowerCase()} is-${choice}${state.selected === p.t.id ? ' sel' : ''}`,
      tabindex: 0,
      role: 'button',
      'aria-label': [
        p.t.label, `${compact(p.t.potential.prompts)} prompts a month`, `${p.t.standing.share}% of answers`, p.t.job, CHOICE_LABEL[choice],
      ].join(', '),
    });
    g.append(s('circle', {
      cx: p.px, cy: p.py, r: 14, class: 'hit',
    }));
    g.append(s('circle', {
      cx: p.px, cy: p.py, r: 7, class: 'mark',
    }));
    g.append(s('text', {
      x: p.label[0], y: p.label[1], 'text-anchor': p.label[2], class: 'pt-label',
    }, p.t.label));
    g.addEventListener('click', () => select(p.t.id));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(p.t.id); }
    });
    g.addEventListener('mouseenter', () => tip(p));
    g.addEventListener('mouseleave', () => tip(null));
    svg.append(g);
  });
  const legend = h(
    'div',
    'legend',
    JOBS.map((j) => jobChip(j)),
    h('span', 'key', h('i', 'k-focus'), 'Focus'),
    h('span', 'key', h('i', 'k-watch'), 'Watch'),
    h('span', 'key', h('i', 'k-skip'), 'Skip'),
  );
  const tipEl = h('div', 'tip');
  tipEl.hidden = true;
  return h(
    'section',
    'card map-card',
    h('div', 'card-head', h('h2', null, 'Where the questions are, and how often the brand is named'), legend),
    h('div', 'map-wrap', svg, tipEl),
    h('p', 'muted caption', 'Right is more demand; up is a larger share of the brand mentions in AI answers. Pick a topic to see its data and suggested changes.'),
  );
}

/* ---------- 1 Decide: the table ---------- */

function table(themes) {
  const c = counts(state.data.themes, state.saved);
  const chips = h('div', 'chips');
  [['all', 'All'], ...JOBS.map((j) => [j, j]), ['focus', 'Focus']].forEach(([id, label]) => {
    chips.append(btn(`chip${state.filter === id ? ' on' : ''}`, `${label} ${c[id]}`, () => {
      state.filter = id;
      render();
    }, { 'aria-pressed': String(state.filter === id) }));
  });
  const th = (label, key, cls = '') => {
    const cell = h('th', cls);
    if (!key) { cell.append(label); return cell; }
    const on = state.sort.key === key;
    const down = state.sort.dir < 0;
    let aria = 'none';
    let arrow = '';
    if (on) {
      aria = down ? 'descending' : 'ascending';
      arrow = down ? ' ↓' : ' ↑';
    }
    cell.setAttribute('aria-sort', aria);
    cell.append(btn(`sort${on ? ' on' : ''}`, [label, arrow], () => {
      state.sort = { key, dir: on ? -state.sort.dir : -1 };
      render();
    }));
    return cell;
  };
  const maxShare = Math.max(...state.data.themes.map((t) => t.standing.share));
  const rows = sortBy(filtered(themes, state.saved, state.filter), state.sort.key, state.sort.dir);
  const tbody = h('tbody');
  rows.forEach((t) => {
    const choice = choiceOf(t, state.saved);
    const tr = h('tr', `is-${choice}${state.selected === t.id ? ' sel' : ''}`);
    tr.addEventListener('click', () => select(t.id));
    const name = btn('name', t.label, (ev) => { ev.stopPropagation(); select(t.id); });
    const bar = h('span', 'bar');
    bar.style.setProperty('--w', `${(100 * t.standing.share) / maxShare}%`);
    tr.append(
      h('td', 'topic', name, t.strategy.named ? h('span', 'tag', word('growth')) : null),
      h('td', null, jobChip(t.job)),
      h('td', 'num', compact(t.potential.prompts)),
      h('td', null, h('div', 'share', h('span', 'num', `${t.standing.share}%`), bar)),
      h('td', 'num', t.standing.peer?.ratio ? `${t.standing.peer.ratio}×` : '–'),
      h('td', 'num', compact(t.potential.visits)),
      h('td', 'num', compact(t.potential.aiVisits)),
      h('td', 'decision', choiceControl(t)),
    );
    tbody.append(tr);
  });
  if (!rows.length) {
    const td = h('td', 'empty', 'No topics here.');
    td.colSpan = 8;
    tbody.append(h('tr', null, td));
  }
  const thead = h('thead', null, h(
    'tr',
    null,
    th('Topic'),
    th('Job'),
    th('Prompts a month', 'prompts', 'num'),
    th('Share of answers', 'share'),
    th(`vs ${word('peer')}`, 'peer', 'num'),
    th('Site visits', 'visits', 'num'),
    th('AI visits', 'ai', 'num'),
    th('Decision'),
  ));
  return h(
    'section',
    'card',
    h('div', 'card-head', h('h2', null, 'Topics'), chips),
    h('div', 'table-wrap', h('table', 'topics', thead, tbody)),
  );
}

/* ---------- 1 Decide: the side pane ---------- */

function facts(t) {
  const { potential: p, standing: st, strategy } = t;
  // topic volumes step month to month: the raw change can mislead, so a like-for-like one wins
  const d = p.changeLikeForLike ?? change(p.prompts, p.promptsBefore);
  const since = p.changeLikeForLike != null ? 'on the topics both reads share' : 'since the last read, raw';
  return h(
    'dl',
    'facts',
    h('dt', null, 'Asked'),
    h('dd', null, `${compact(p.prompts)} prompts a month`, d != null ? h('span', 'muted', ` (${d > 0 ? '+' : ''}${d}% ${since})`) : null),
    h('dt', null, 'Visits'),
    h('dd', null, `${compact(p.visits)} on the sites, ${compact(p.aiVisits)} from AI assistants`),
    h('dt', null, 'By site'),
    h('dd', null, Object.entries(p.bySite).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${compact(v)}`)
      .join(' · ')),
    h('dt', null, 'In answers'),
    h('dd', null, `${st.share}% of brand mentions${st.rank ? `, rank ${st.rank}` : ''}. Named most: ${(st.leaders || []).map(([n, c]) => `${n} ${compact(c)}`).join(', ')}.`),
    h('dt', null, word('peers')),
    h('dd', null, st.peer?.ratio ? `${st.peer.ratio}× the ${word('peer')} (${peerName(st.peer)})` : '–'),
    st.tracked ? h('dt', null, 'Tracked') : null,
    st.tracked ? h('dd', null, st.tracked) : null,
    h('dt', null, 'Strategy'),
    h('dd', null, strategy.text, strategy.source ? h('span', 'muted', ` · ${strategy.source}`) : null),
  );
}

// Every source the run used or looked for, with what it feeds and whether it was included
const STATUS = { included: 'Included', partial: 'Partial', missing: 'Missing' };
function dataSources() {
  const list = state.data.meta.dataSources;
  if (!list?.length) return null;
  const n = (k) => list.filter((x) => x.status === k).length;
  const order = Object.keys(STATUS);
  const summary = order.filter((k) => n(k)).map((k) => `${n(k)} ${STATUS[k].toLowerCase()}`).join(' · ');
  const sorted = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const rows = sorted.map((x) => h(
    'li',
    `source source-${x.status}`,
    h('div', 'source-head', h('span', `status status-${x.status}`, h('i', 'status-icon'), STATUS[x.status] || x.status), h('b', null, x.name)),
    h('p', 'source-used', x.used),
    h('p', 'muted', x.detail),
  ));
  return h('section', 'sources', h('h2', null, 'Data sources'), h('p', 'muted', summary), h('ul', null, rows));
}

function side() {
  const t = state.selected && themeById(state.selected);
  if (!t) {
    const rules = h('dl', 'facts rules');
    JOBS.forEach((j) => rules.append(h('dt', null, jobChip(j)), h('dd', null, state.data.meta.jobRule?.[j] || '')));
    const notes = h('div', 'notes');
    state.data.notes.forEach((n) => notes.append(h('div', 'note', h('h3', null, n.title), h('p', null, n.text))));
    return h('aside', 'side', h('h2', null, 'How to read this'), rules, h('h2', null, word('notes')), notes, dataSources());
  }
  const choice = choiceOf(t, state.saved);
  const list = h('ol', 'mini');
  (t.suggestions || []).forEach((x) => list.append(h('li', null, h('b', null, x.title), h('span', 'muted', shortPage(x)), goalTag(x.goal))));
  return h(
    'aside',
    'side',
    h('div', 'side-head', h('h2', null, t.label), jobChip(t.job), btn('icon close', '×', () => select(null), { 'aria-label': 'Close topic' })),
    h('p', 'muted', state.data.meta.jobRule?.[t.job] || ''),
    h('div', 'decide-row', h('span', null, 'Decision'), choiceControl(t)),
    facts(t),
    h('h3', null, `Suggested changes (${t.suggestions.length})`),
    list,
    choice === 'focus'
      ? btn('secondary', 'See them in the plan', () => {
        state.view = 'plan';
        render();
        document.getElementById(`plan-${t.id}`)?.scrollIntoView();
      })
      : h('p', 'muted', 'Put the topic on Focus to add these changes to the plan.'),
  );
}

function decide() {
  const { themes } = state.data;
  return h('main', 'decide', h('div', 'col', map(themes), table(themes)), side());
}

/* ---------- 2 Plan ---------- */

function evidence(items) {
  const ul = h('ul', 'evidence');
  items.forEach((e) => ul.append(h('li', null, h('span', `kind kind-${e.kind.toLowerCase().replace(/\s+/g, '-')}`, e.kind), ' ', e.text)));
  return ul;
}

function changeCard(t, x) {
  const actions = h('div', 'actions');
  if (canDraft()) actions.append(btn('primary', 'Draft in chat', () => draft(draftPrompt(t, x, state.data.meta))));
  actions.append(link('secondary', 'Open page', x.page));
  return h('article', 'change', h('h4', null, x.title), h('p', 'page', shortPage(x)), h('p', 'what', x.what), patternList(x), evidence(x.evidence || []), actions);
}

// Where the pattern fits a change: what else the page needs, by job
function patternList(x) {
  const pattern = x.pattern && state.data.meta.pattern;
  if (!pattern) return null;
  return h(
    'div',
    'pattern',
    h('p', 'pattern-title', pattern.title),
    h('ul', null, pattern.parts.map((p) => h('li', null, goalTag(p.goal), h('b', null, p.name), ' ', p.text))),
  );
}

// The study's two jobs
function goalsCard() {
  const { goals } = state.data.meta;
  if (!goals) return null;
  const col = (g) => h(
    'div',
    `goal goal-${g}`,
    h('h3', null, goalTag(g), goals[g].label),
    h('p', null, goals[g].text),
    h('dl', 'goal-facts', h('dt', null, 'Pages'), h('dd', null, goals[g].pages), h('dt', null, 'Measured by'), h('dd', null, goals[g].metric)),
  );
  return h(
    'section',
    'card goals',
    h('div', 'goal-cols', GOALS.filter((g) => goals[g]).map(col)),
    h('p', 'muted', 'A page seen but never chosen builds awareness and loses the visit; a page built to be chosen but never seen never gets the visit.'),
  );
}

function plan() {
  const focus = planOf(state.data.themes, state.saved);
  const watching = state.data.themes.filter((t) => choiceOf(t, state.saved) === 'watch');
  const skipped = state.data.themes.filter((t) => choiceOf(t, state.saved) === 'skip');
  const n = focus.reduce((a, t) => a + (t.suggestions?.length || 0), 0);
  const nav = h('nav', 'plan-nav', h('h3', null, 'On Focus'));
  focus.forEach((t) => nav.append(btn('nav-item', [h('span', 'nav-name', t.label), jobChip(t.job), h('span', 'count', t.suggestions.length)], () => document.getElementById(`plan-${t.id}`)?.scrollIntoView({ behavior: 'smooth' }))));
  const others = (label, list) => (list.length ? h('div', 'others', h('h3', null, label), h('p', 'muted', list.map((t) => t.label).join(' · '))) : null);
  [others('Watching', watching), others('Skipped', skipped)].filter(Boolean).forEach((el) => nav.append(el));
  const body = h('div', 'plan-body');
  body.append(h(
    'div',
    'plan-head',
    h('div', null, h('h2', null, `${n} changes for ${focus.length} topics on Focus`), h('p', 'muted', 'Each change names a page, what to change, and why, grouped by the job it does. Drafting puts a prompt in the chat, ready to review and send.')),
    canDraft() && focus.length ? btn('primary', 'Draft the plan in chat', () => draft(planPrompt(focus, state.data.meta))) : null,
  ));
  const goals = goalsCard();
  if (goals) body.append(goals);
  if (!focus.length) {
    body.append(h('div', 'card empty-plan', h('p', null, 'No topic is on Focus yet.'), btn('secondary', 'Go to Decide', () => { state.view = 'decide'; render(); })));
  }
  focus.forEach((t) => {
    const sec = h(
      'section',
      'card plan-topic',
      h('div', 'card-head', h('div', 'plan-title', h('h3', null, t.label), jobChip(t.job), h('span', 'muted', `${compact(t.potential.prompts)} prompts a month · ${t.standing.share}% of answers`)), choiceControl(t)),
      byGoal(t.suggestions).map((g) => h(
        'div',
        'goal-group',
        h('h4', 'goal-head', goalTag(g.goal), goalLabel(g.goal, state.data.meta.goals), h('span', 'muted', `${g.items.length} · ${state.data.meta.goals?.[g.goal]?.metric || ''}`)),
        h('div', 'changes', g.items.map((x) => changeCard(t, x))),
      )),
    );
    sec.id = `plan-${t.id}`;
    body.append(sec);
  });
  const { study } = state.data.meta;
  if (study?.url) body.append(h('p', 'muted foot', 'Study: ', link(null, study.title || study.url, study.url)));
  return h('main', 'plan', nav, body);
}

/* ---------- boot ---------- */

function render() {
  if (!state.data) return;
  const keep = [...app.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, el.scrollTop]);
  app.replaceChildren(header(), state.view === 'plan' ? plan() : decide());
  const areas = app.querySelectorAll('main > *');
  areas.forEach((el, i) => { el.dataset.scroll = `${state.view}-${i}`; });
  keep.forEach(([k, top]) => {
    const el = app.querySelector(`[data-scroll="${k}"]`);
    if (el) el.scrollTop = top;
  });
}

async function load() {
  const [data, saved] = await Promise.all([
    fetch(DATA, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${DATA} returned ${r.status}`)))),
    fetch(`/${CHOICES_PATH}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  state.data = data;
  state.saved = saved;
  if (state.selected && !themeById(state.selected)) state.selected = null;
  render();
}

async function boot() {
  const inFrame = window.parent !== window;
  if (!inFrame || params.has('path')) { await load(); return; }
  const nx = params.get('nx') ? `https://${params.get('nx')}--da-nx--adobe.aem.live` : 'https://da.live';
  const timer = setTimeout(() => {
    app.append(h('p', 'save error', 'No answer from Experience Workspace after 8 seconds: close and open Brand visibility again.'));
  }, 8000);
  const { default: DA_SDK } = await import(`${nx}/nx/utils/sdk.js`);
  const sdk = await DA_SDK;
  clearTimeout(timer);
  state.actions = sdk.actions;
  state.token = sdk.token;
  state.target = sourceTarget(sdk.context, window.location.hostname);
  await load();
}

boot().catch((e) => {
  app.replaceChildren(h('p', 'save error', `Could not load: ${e.message}`));
});
