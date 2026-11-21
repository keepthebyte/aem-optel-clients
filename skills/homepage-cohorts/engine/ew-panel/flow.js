/*
 * Gallery view "Flow": how the cohorts came about, from cohorts.json (size.js output).
 *
 * - An interactive Sankey: entry source → device → relationship (loyalty or new, when the rules
 *   have groups: rules.relationship) → rule (first match wins) → homepage experience, laid out at
 *   the width it gets. Hover anything for its numbers; click (or Enter
 *   on) a node to select it: its flows stay lit and the panel beside the chart explains it (where
 *   the views go, the rule's signal and behaviour today, its weekly share, its holdout result,
 *   the experience's rules, a button to see its page). Esc or a click on the background clears.
 * - Flows are coloured by experience (the colour of its column in Pages) or by the signal that
 *   decides them (Spectrum 2 visual colours).
 * - Week by week: each experience's share per full week, and what to look at again.
 */
/* eslint-disable max-len */
import { groupColor } from './model.js';

const SIG = {
  link: { label: 'Where they came from', color: 'var(--swc-blue-visual-color, #4b75ff)' },
  agent: { label: 'Personal AI agent', color: 'var(--swc-purple-visual-color, #9d5ae5)' },
  memory: { label: 'Visit memory', color: 'var(--swc-seafoam-visual-color, #0f977f)' },
  device: { label: 'Device', color: 'var(--swc-orange-visual-color, #e86a00)' },
  none: { label: 'No signal', color: 'var(--swc-gray-visual-color, #8f8f8f)' },
};
const NEUTRAL = 'var(--swc-gray-visual-color, #8f8f8f)';
const NS = 'http://www.w3.org/2000/svg';
const BAR = 10;
const PAD = 7;
const TOP = 30;
const HEIGHT = 560;
const CHAR = 6.4;

/* kept while the gallery is open: switching views or resizing keeps the selection */
const ui = { selected: null, colorBy: 'experience', review: null };
let RULES = null;
const colorOf = (id) => groupColor(RULES, id);

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v != null) el.setAttribute(k, v); });
  kids.flat().forEach((k) => { if (k != null) el.append(k); });
  return el;
};
const h = (tag, cls, ...kids) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k); });
  return el;
};
const pct = (x, d) => (x == null || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d ?? (x < 0.1 ? 1 : 0))}%`);
const times = (x) => (x == null ? '–' : `${x.toFixed(x < 10 ? 1 : 0)}x`);
const plain = (label) => label.replace(/^\d+ · /, '');
const clip = (s, px) => {
  const n = Math.max(6, Math.floor(px / CHAR));
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const swatch = (color, cls = 'sw') => {
  const el = h('span', cls);
  el.style.setProperty('--c', color);
  return el;
};

/* ---------- model ---------- */

const KIND = {
  e: 'entry', d: 'device', g: 'group', r: 'rule', x: 'exp',
};
const expNodes = (data) => data.columns[data.columns.length - 1]?.nodes || [];

/**
 * The same data with a relationship column between device and rule, when the rules put their
 * cohorts in groups (rules.relationship.groups, `group` on each rule). cohorts.json has no such
 * column: a view's group is the group of the rule that fired, and views no rule matched are
 * `new` (new or unknown). Each device → rule flow passes through its group as one band, so it
 * keeps its colour; a rule without a group (personal agents) is `other`.
 */
function withGroups(data, rules) {
  const groups = rules.relationship?.groups;
  if (!groups || data.columns.length !== 4) return data;
  const ruleGroup = Object.fromEntries((rules.rules || []).map((r) => [r.id, r.group || 'other']));
  ruleGroup.none = 'new';
  const groupOf = (ruleNode) => ruleGroup[ruleNode.slice(2)] || 'other';
  const views = {};
  data.columns[2].nodes.forEach((n) => { views[groupOf(n.id)] = (views[groupOf(n.id)] || 0) + n.views; });
  const nodes = [...Object.keys(groups), 'other'].filter((g) => views[g]).map((g) => ({
    id: `g:${g}`, label: groups[g]?.label || 'No relationship', views: views[g],
  }));
  const signalOf = Object.fromEntries(data.columns[2].nodes.map((n) => [n.id, n.signal]));
  const links = data.links.flatMap((l) => (l.s.startsWith('d:') && l.t.startsWith('r:')
    ? [{ ...l, t: `g:${groupOf(l.t)}` }]
    : [l]));
  data.columns[2].nodes.forEach((n) => links.push({
    s: `g:${groupOf(n.id)}`, t: n.id, signal: signalOf[n.id] || 'none', views: n.views, rules: [n.id.slice(2)],
  }));
  // the rules of a group sit together (their numbers still say which is tried first)
  const order = nodes.map((n) => n.id.slice(2));
  const ruleNodes = [...data.columns[2].nodes]
    .sort((x, y) => order.indexOf(groupOf(x.id)) - order.indexOf(groupOf(y.id)));
  const columns = [...data.columns.slice(0, 2), { head: 'Relationship', nodes }, { ...data.columns[2], nodes: ruleNodes }, data.columns[3]];
  return {
    ...data, columns, links, ruleGroup,
  };
}

function model(data, rules) {
  const ruleExp = Object.fromEntries((rules.rules || []).map((r) => [r.id, r.experience]));
  ruleExp.none = 'default';
  const node = {};
  data.columns.forEach((c, ci) => c.nodes.forEach((n) => {
    node[n.id] = {
      ...n, ci, out: [], in: [], kind: KIND[n.id[0]],
    };
  }));
  const links = data.links.filter((l) => node[l.s] && node[l.t]).map((l, i) => ({ ...l, i }));
  links.forEach((l) => { node[l.s].out.push(l); node[l.t].in.push(l); });
  const ruleOf = Object.fromEntries((data.rules || []).map((r) => [r.id, r]));
  const expOf = Object.fromEntries((data.experiences || []).map((x) => [x.id, x]));
  const full = data.meta.fullWeeks || (data.today?.weeks || []).length;
  const allWeeks = (data.today?.weeks || []).slice(0, full);
  const weekShare = (weeks) => allWeeks.map((v, i) => (v ? ((weeks || [])[i] || 0) / v : 0));
  return {
    node, links, ruleExp, ruleOf, expOf, total: data.meta.views, weekShare, ruleGroup: data.ruleGroup || {},
  };
}

/** The rules a node stands for: its own for a rule, its rules for an experience. */
function rulesOf(m, n) {
  if (n.kind === 'rule') return [n.id.slice(2)];
  if (n.kind === 'exp') return Object.entries(m.ruleExp).filter(([, x]) => x === n.id.slice(2)).map(([r]) => r);
  if (n.kind === 'group') return Object.entries(m.ruleGroup).filter(([, g]) => g === n.id.slice(2)).map(([r]) => r);
  return null;
}

/** Links lit for a node: the whole path of its rules, or its own flows for a source or device. */
function litBy(m, n) {
  const ids = rulesOf(m, n);
  if (ids) return new Set(m.links.filter((l) => (l.rules || []).some((r) => ids.includes(r))).map((l) => l.i));
  return new Set([...n.in, ...n.out].map((l) => l.i));
}

function linkColor(m, l) {
  if (ui.colorBy === 'signal') return (SIG[l.signal] || SIG.none).color;
  const xs = new Set((l.rules || []).map((r) => m.ruleExp[r] || 'default'));
  return xs.size === 1 ? colorOf([...xs][0]) : NEUTRAL;
}

function nodeColor(m, n) {
  if (n.kind === 'exp') return colorOf(n.id.slice(2));
  if (n.kind === 'rule') return ui.colorBy === 'signal' ? (SIG[n.signal] || SIG.none).color : colorOf(m.ruleExp[n.id.slice(2)] || 'default');
  return 'var(--ink-2)';
}

/* ---------- layout at the width it gets ---------- */

function layout(m, data, width) {
  const labelR = Math.min(260, Math.max(170, width * 0.24));
  const span = width - labelR - BAR;
  const last = data.columns.length - 1;
  const colX = (last === 4 ? [0, 0.21, 0.4, 0.6, 1] : [0, 0.3, 0.6, 1]).map((f) => span * f);
  const avail = Math.min(...data.columns.map((c) => HEIGHT - TOP - (c.nodes.length - 1) * PAD));
  const k = avail / m.total;
  data.columns.forEach((c) => {
    let y = TOP;
    c.nodes.forEach((n0) => {
      const n = m.node[n0.id];
      n.x = colX[n.ci];
      n.y = y;
      n.h = Math.max(2, n.views * k);
      n.room = n.ci < last ? colX[n.ci + 1] - colX[n.ci] - BAR - 14 : labelR - 8;
      y += n.h + PAD;
    });
  });
  m.links.forEach((l) => { l.w = Math.max(1, l.views * k); });
  Object.values(m.node).forEach((n) => {
    let { y } = n;
    n.out.sort((a, b) => m.node[a.t].y - m.node[b.t].y).forEach((l) => { l.sy = y; y += l.w; });
    y = n.y;
    n.in.sort((a, b) => m.node[a.s].y - m.node[b.s].y).forEach((l) => { l.ty = y; y += l.w; });
  });
  return colX;
}

function band(m, l) {
  const x0 = m.node[l.s].x + BAR;
  const x1 = m.node[l.t].x;
  const c = (x0 + x1) / 2;
  const {
    sy, ty, w,
  } = l;
  return `M${x0},${sy}C${c},${sy} ${c},${ty} ${x1},${ty}L${x1},${ty + w}C${c},${ty + w} ${c},${sy + w} ${x0},${sy + w}Z`;
}

/* ---------- the chart ---------- */

function mark(root, lit, cls) {
  root.querySelectorAll('.flows path').forEach((p) => p.classList.toggle(cls, lit.has(Number(p.dataset.i))));
}

function chart(m, data, width, tip, select) {
  const colX = layout(m, data, width);
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${HEIGHT + 4}`, width, height: HEIGHT + 4, class: 'sankey', role: 'group', 'aria-label': 'How homepage views become cohorts',
  });
  data.columns.forEach((c, ci) => root.append(svg('text', { x: colX[ci], y: 12, class: 'head' }, c.head.split(' · ')[0])));
  const flows = svg('g', { class: 'flows' });
  m.links.forEach((l) => {
    const p = svg('path', { d: band(m, l), 'data-i': l.i });
    p.style.fill = linkColor(m, l);
    p.addEventListener('mousemove', (ev) => tip(ev, `${plain(m.node[l.s].label)} → ${plain(m.node[l.t].label)}`, `${pct(l.views / m.total, 1)} of homepage views`));
    p.addEventListener('mouseleave', () => tip(null));
    flows.append(p);
  });
  root.append(flows);
  const nodes = svg('g', { class: 'nodes' });
  Object.values(m.node).forEach((n) => {
    const num = n.kind === 'rule' ? (n.label.match(/^\d+/)?.[0] || '') : '';
    const name = plain(n.label);
    const share = pct(n.views / m.total);
    const bar = svg('rect', {
      class: 'bar', x: n.x, y: n.y, width: BAR, height: n.h, rx: 2,
    });
    bar.style.fill = nodeColor(m, n);
    const g = svg(
      'g',
      {
        class: `node ${n.kind}`, 'data-id': n.id, tabindex: 0, role: 'button', 'aria-label': `${name}, ${share} of views`,
      },
      // the label line is clickable too, without covering the flows under a tall bar
      svg('rect', {
        class: 'hit', x: n.x + BAR, y: n.y + n.h / 2 - 9, width: 6 + Math.min(n.room, (name.length + 8) * CHAR), height: 18,
      }),
      bar,
      svg(
        'text',
        { x: n.x + BAR + 6, y: n.y + n.h / 2, dy: '0.35em' },
        num ? svg('tspan', { class: 'nn' }, `${num} `) : null,
        svg('tspan', { class: 'nl' }, clip(name, n.room - share.length * CHAR - 14)),
        svg('tspan', { class: 'nv', dx: 5 }, share),
      ),
    );
    g.addEventListener('mousemove', (ev) => tip(ev, name, `${share} of homepage views · click for details`));
    g.addEventListener('mouseenter', () => { root.classList.add('peek'); mark(root, litBy(m, n), 'peek-on'); });
    g.addEventListener('mouseleave', () => { root.classList.remove('peek'); tip(null); });
    g.addEventListener('click', (ev) => { ev.stopPropagation(); select(ui.selected === n.id ? null : n.id); });
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(ui.selected === n.id ? null : n.id); }
    });
    nodes.append(g);
  });
  root.append(nodes);
  root.addEventListener('click', () => select(null));
  return root;
}

function applySelection(m, root) {
  const n = ui.selected && m.node[ui.selected];
  root.classList.toggle('focus', !!n);
  root.querySelectorAll('.node').forEach((g) => g.classList.toggle('selected', g.dataset.id === ui.selected));
  if (n) mark(root, litBy(m, n), 'on');
}

/* ---------- details panel ---------- */

function spark(values, color, w = 120, ht = 28) {
  const n = values.length;
  if (n < 2) return null;
  const max = Math.max(...values, 0.0001);
  const x = (i) => (i / (n - 1)) * (w - 6) + 3;
  const y = (v) => ht - 3 - (v / max) * (ht - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const path = svg('path', { d, fill: 'none', 'stroke-width': 2 });
  path.style.stroke = color;
  const end = svg('circle', { cx: x(n - 1), cy: y(values[n - 1]), r: 3 });
  end.style.fill = color;
  return svg('svg', {
    width: w, height: ht, class: 'spark', 'aria-hidden': 'true',
  }, path, end);
}

function bars(rows, total) {
  const max = Math.max(...rows.map((r) => r.views), 1);
  return h('ul', 'bars', rows.map((r) => {
    const fill = h('span', 'fill');
    fill.style.width = `${(r.views / max) * 100}%`;
    fill.style.background = r.color || 'var(--ink-2)';
    const li = h('li', r.onClick ? 'pick' : '', h('span', 'blabel', r.label), h('span', 'btrack', fill), h('span', 'bval', pct(r.views / total)));
    if (r.onClick) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('click', r.onClick);
      li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') r.onClick(); });
    }
    return li;
  }));
}

const stat = (label, value, note) => h('div', 'stat', h('dt', '', label), h('dd', '', value), note ? h('dd', 'note-s', note) : null);

function verdictBadge(row) {
  const v = row.verdict || '';
  let key = 'neutral';
  if (/^Keep|A\/A ok/.test(v)) key = 'positive';
  else if (/^Fix|failed/i.test(v)) key = 'negative';
  else if (/^Promising/.test(v)) key = 'informative';
  return h('span', `badge-s ${key}`, v.split(':')[0]);
}

function textLink(text, onClick) {
  const b = h('button', 'text-link', text);
  b.type = 'button';
  b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

function pageButton(x, onPick) {
  const b = h('button', 'button-s', 'Show its page');
  b.type = 'button';
  b.addEventListener('click', () => onPick(x));
  return h('p', 'actions', b);
}

function holdoutBlock(ids) {
  const rows = (ui.review?.rules || []).filter((r) => ids.includes(r.id));
  if (!rows.length) return null;
  return h(
    'div',
    'holdout-mini',
    h('h4', '', ui.review.mock ? 'Against the holdout (example data)' : 'Against the holdout'),
    h('ul', 'hrows', rows.map((r) => h(
      'li',
      '',
      h('span', 'blabel', r.label),
      h('span', 'bval', r.lowSample ? '–' : `${r.lift >= 0 ? '+' : '−'}${Math.abs(r.lift * 100).toFixed(0)}%`),
      verdictBadge(r),
    ))),
  );
}

/* links summed per node on one side (`t` or `s`): several flows can join the same two nodes */
const byNode = (links, side) => Object.entries(links.reduce((acc, l) => ({ ...acc, [l[side]]: (acc[l[side]] || 0) + l.views }), {}));

const sumWeeks = (m, ids) => ids.reduce((acc, id) => (m.ruleOf[id]?.weeks || []).map((v, i) => (acc[i] || 0) + v), []);

function panel(m, data, select, onPick) {
  const el = h('aside', 'details');
  // DOM append writes null as text: skip the parts that are not there
  const add = el.append.bind(el);
  el.append = (...kids) => add(...kids.filter((k) => k != null && k !== false && k !== ''));
  el.setAttribute('aria-live', 'polite');
  const n = ui.selected && m.node[ui.selected];
  if (!n) {
    el.append(
      h('p', 'eyebrow', 'Details'),
      h('h3', '', 'Pick a part of the flow'),
      h('p', 'sub', `Click a rule or an experience to follow its visitors and see what they do today. Sources and devices show where their views go${data.ruleGroup ? ', loyalty and new which cohorts they hold' : ''}.`),
      h('h4', '', 'Experiences'),
      bars(expNodes(data).map((x) => ({
        label: plain(x.label), views: x.views, color: colorOf(x.id.slice(2)), onClick: () => select(x.id),
      })), m.total),
    );
    return el;
  }
  const name = plain(n.label);
  const close = h('button', 'icon-btn close', '');
  close.type = 'button';
  close.setAttribute('aria-label', 'Clear the selection');
  close.addEventListener('click', () => select(null));
  const kindLabel = {
    entry: 'Entry source', device: 'Device', group: 'Relationship', rule: `Rule ${n.label.match(/^\d+/)?.[0] || ''} · first match wins`, exp: 'Homepage experience',
  }[n.kind];
  el.append(h('header', '', swatch(nodeColor(m, n), 'dot'), h('div', '', h('p', 'eyebrow', kindLabel), h('h3', '', name)), close));

  if (n.kind === 'entry' || n.kind === 'device') {
    el.append(
      h('dl', 'stats', h('div', 'stat', h('dt', '', 'Homepage views'), h('dd', '', pct(n.views / m.total)))),
      h('h4', '', { entry: 'Then on', device: data.ruleGroup ? 'Relationship' : 'Rules that fire' }[n.kind]),
      bars(byNode(n.out, 't').map(([id, views]) => ({
        label: plain(m.node[id].label), views, color: nodeColor(m, m.node[id]), onClick: () => select(id),
      })), m.total),
    );
    if (n.kind === 'device') {
      el.append(h('h4', '', 'Coming from'), bars(n.in.map((l) => ({ label: plain(m.node[l.s].label), views: l.views, onClick: () => select(l.s) })), m.total));
    }
    return el;
  }

  if (n.kind === 'group') {
    const g = RULES.relationship?.groups?.[n.id.slice(2)] || {};
    el.append(
      g.sub ? h('p', 'sub', g.sub) : null,
      h('dl', 'stats', stat('Homepage views', pct(n.views / m.total)), stat('Cohorts', String(n.out.filter((l) => l.t !== 'r:none').length))),
      g.goalLabel ? h('p', 'sub', `Optimised for: ${g.goalLabel}.`) : null,
      h('h4', '', 'Cohorts in this group'),
      bars(n.out.map((l) => ({
        label: plain(m.node[l.t].label), views: l.views, color: nodeColor(m, m.node[l.t]), onClick: () => select(l.t),
      })), m.total),
      h('h4', '', 'Coming from'),
      bars(byNode(n.in, 's').map(([id, views]) => ({ label: plain(m.node[id].label), views, onClick: () => select(id) })), m.total),
      h('p', 'note-s', n.id === 'g:new'
        ? 'A view counts here when its rule is a new-visitor cohort or when no rule matched. Returning visitors that only a cookie decision or visit memory would show are in here too: this data cannot see them.'
        : 'A view counts here when the rule that fired is a loyalty cohort. Rules that depend on visit memory are estimates.'),
    );
    return el;
  }

  if (n.kind === 'rule') {
    const id = n.id.slice(2);
    const r = m.ruleOf[id] || {};
    const x = m.ruleExp[id] || 'default';
    const t = r.today || {};
    const xNode = m.node[`x:${x}`];
    const flags = [
      r.modelled && 'Estimated: depends on visit memory, which Optel cannot see.',
      r.firstVisitAssumed && 'Upper bound: Optel cannot see first visits, so every view counts as one.',
      r.lowSample && 'Few sampled views: read with care.',
      r.standsOut && 'Small but stands out: more engaged or growing fast.',
    ].filter(Boolean);
    el.append(
      h('p', 'sub', `${(SIG[n.signal] || SIG.none).label} · leads to `, xNode ? textLink(plain(xNode.label), () => select(xNode.id)) : x),
      h(
        'dl',
        'stats',
        stat('Homepage views', pct(n.views / m.total), r.growth != null ? `${times(r.growth)} over the period` : null),
        stat('Reach the goal', pct(t.goalRate), t.supportRate != null ? `${pct(t.supportRate)} take the supporting step` : null),
        stat('Do nothing', pct(t.didNothing), t.vsAll?.didNothing != null ? `${times(t.vsAll.didNothing)} all visitors` : null),
      ),
      flags.length ? h('ul', 'flags', flags.map((f) => h('li', '', f))) : null,
      r.weeks ? h('div', 'trend', h('h4', '', 'Share by week'), spark(m.weekShare(r.weeks), nodeColor(m, n), 260, 44)) : null,
    );
    if (t.topClicks?.length) {
      el.append(h('h4', '', 'What they click today'), h('ol', 'clicks', t.topClicks.slice(0, 5).map((c) => h('li', '', h('span', 'blabel', c.link ? c.click : `${c.click.split(' ').pop()} (on the page)`), h('span', 'bval', pct(c.share))))));
    }
    el.append(holdoutBlock([id]), pageButton(x, onPick));
    return el;
  }

  const x = n.id.slice(2);
  const ids = rulesOf(m, n);
  const weeks = sumWeeks(m, ids);
  el.append(
    h('dl', 'stats', stat('Homepage views', pct(n.views / m.total)), stat('Rules', String(n.in.length))),
    h('h4', '', 'Rules that lead here'),
    bars(n.in.map((l) => ({
      label: plain(m.node[l.s].label), views: l.views, color: nodeColor(m, m.node[l.s]), onClick: () => select(l.s),
    })), m.total),
    weeks.length ? h('div', 'trend', h('h4', '', 'Share by week'), spark(m.weekShare(weeks), nodeColor(m, n), 260, 44)) : null,
  );
  el.append(holdoutBlock(ids), pageButton(x, onPick));
  return el;
}

/* ---------- week by week, look at again ---------- */

function weekly(m, data) {
  return (data.experiences || []).map((x) => {
    const ids = Object.entries(m.ruleExp).filter(([, e]) => e === x.id).map(([r]) => r);
    const shares = m.weekShare(sumWeeks(m, ids));
    const first = shares[0];
    const last = shares[shares.length - 1];
    return { ...x, shares, change: first ? last / first : null };
  });
}

function lookAgain(data, rows) {
  const out = [];
  (data.rules || []).forEach((r) => {
    if (r.standsOut) out.push(`"${r.label}" is small (${pct(r.share, 1)}) but stands out: more engaged or growing fast. Worth its own look.`);
    if (r.growth != null && r.growth >= 2) out.push(`"${r.label}" doubled over the period (${times(r.growth)}): check its experience still fits a bigger group.`);
    if (r.growth != null && r.growth <= 0.5) out.push(`"${r.label}" halved over the period (${times(r.growth)}): is the campaign behind it over?`);
  });
  const low = (data.rules || []).filter((r) => r.lowSample).map((r) => r.label);
  if (low.length) out.push(`Too few sampled views to judge: ${low.join(', ')}.`);
  const none = rows.find((x) => x.id === 'default');
  if (none && none.share > 0.25) out.push(`${pct(none.share)} of views match no rule and get the original page.`);
  const modelled = (data.rules || []).filter((r) => r.modelled).map((r) => r.label);
  if (modelled.length) out.push(`Estimated, not measured (visit memory is not in Optel): ${modelled.join(', ')}.`);
  return out;
}

function foot(m, data, select) {
  const rows = weekly(m, data);
  const full = data.meta.fullWeeks || rows[0]?.shares.length || 0;
  const table = h('table', 'weeks');
  table.append(h('thead', '', h('tr', '', h('th', '', 'Experience'), h('th', '', `Share by week (${full} full weeks)`), h('th', 'num', 'Now'), h('th', 'num', 'Change'))));
  const body = h('tbody');
  rows.forEach((r) => {
    const color = colorOf(r.id);
    let ch = '–';
    if (r.change != null) ch = r.change >= 1 ? `+${pct(r.change - 1, 0)}` : `−${pct(1 - r.change, 0)}`;
    const tr = h(
      'tr',
      'pick',
      h('td', '', swatch(color, 'dot'), ` ${r.label}`),
      h('td', '', spark(r.shares, color)),
      h('td', 'num', pct(r.shares[r.shares.length - 1])),
      h('td', `num${r.change != null && (r.change >= 1.5 || r.change <= 0.67) ? ' strong' : ''}`, ch),
    );
    tr.addEventListener('click', () => { select(`x:${r.id}`); window.scrollTo?.(0, 0); tr.closest('.stage')?.scrollTo({ top: 0, behavior: 'smooth' }); });
    body.append(tr);
  });
  table.append(body);
  const notes = lookAgain(data, rows);
  return h(
    'div',
    'flow-foot',
    h('section', '', h('h3', '', 'Week by week'), table),
    h('section', '', h('h3', '', 'Look at again'), notes.length ? h('ul', 'again', notes.map((t) => h('li', '', t))) : h('p', 'sub', 'Nothing stands out this period.')),
  );
}

/* ---------- view ---------- */

function actionGroup(label, options, value, onChange) {
  const g = h('div', 'action-group');
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  Object.entries(options).forEach(([id, text]) => {
    const b = h('button', 'action', text);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === id));
    b.addEventListener('click', () => onChange(id));
    g.append(b);
  });
  return h('div', 'field', h('span', 'field-label', label), g);
}

function legend(data) {
  if (ui.colorBy === 'signal') {
    return h('ul', 'legend', Object.values(SIG).map((s) => h('li', '', swatch(s.color), s.label)));
  }
  return h(
    'ul',
    'legend',
    expNodes(data).map((x) => h('li', '', swatch(colorOf(x.id.slice(2))), plain(x.label).split(':')[0])),
    h('li', '', swatch(NEUTRAL), 'Shared by several'),
  );
}

export default async function renderFlow(host, { data, rules, onPick }) {
  RULES = rules;
  if (!data?.columns) {
    host.append(h('p', 'note', 'No cohorts.json published at /cohorts/cohorts.json: run size.js and publish it to see how the cohorts came about.'));
    return;
  }
  // eslint-disable-next-line no-param-reassign
  data = withGroups(data, rules);
  const m = model(data, rules);
  const { meta } = data;
  const head = h('div', 'flow-head');
  const chartBox = h('div', 'sankey-wrap');
  const tipEl = h('div', 'tip');
  tipEl.hidden = true;
  chartBox.append(tipEl);
  let side = h('aside', 'details');
  let svgEl = null;

  const tip = (ev, title, text) => {
    if (!ev) { tipEl.hidden = true; return; }
    tipEl.replaceChildren(h('strong', '', title), h('span', '', text));
    tipEl.hidden = false;
    const box = chartBox.getBoundingClientRect();
    const x = ev.clientX - box.left + 14;
    const y = ev.clientY - box.top + 14;
    tipEl.style.left = `${Math.max(0, Math.min(x, box.width - tipEl.offsetWidth - 4))}px`;
    tipEl.style.top = `${y}px`;
  };

  const drawPanel = (select) => {
    const next = panel(m, data, select, onPick);
    side.replaceWith(next);
    side = next;
  };
  const select = (id) => {
    ui.selected = id;
    drawPanel(select);
    if (svgEl) applySelection(m, svgEl);
  };
  const drawChart = () => {
    const width = Math.max(520, chartBox.clientWidth);
    const next = chart(m, data, width, tip, select);
    if (svgEl) svgEl.replaceWith(next); else chartBox.prepend(next);
    svgEl = next;
    applySelection(m, svgEl);
  };
  const drawHead = () => {
    head.replaceChildren(
      h(
        'div',
        'title-row',
        h('div', '', h('h2', '', 'How the cohorts came about'), h('p', 'sub', `${meta.domain}${meta.path} · ${String(meta.start).slice(0, 10)} to ${String(meta.end).slice(0, 10)} · ${meta.bundles.toLocaleString()} sampled views (about ${meta.views.toLocaleString()})`)),
        actionGroup('Colour flows by', { experience: 'Experience', signal: 'Signal' }, ui.colorBy, (v) => {
          ui.colorBy = v;
          drawHead();
          drawChart();
          drawPanel(select);
        }),
      ),
      legend(data),
    );
  };

  host.append(head, h('div', 'flow-body', chartBox, side), foot(m, data, select));
  drawHead();
  drawChart();
  drawPanel(select);

  const ro = new ResizeObserver(() => {
    if (svgEl && Math.abs(Number(svgEl.getAttribute('width')) - chartBox.clientWidth) > 8) drawChart();
  });
  ro.observe(chartBox);
  const onKey = (ev) => { if (ev.key === 'Escape' && ui.selected && host.isConnected) select(null); };
  document.addEventListener('keydown', onKey);
  const gone = new MutationObserver(() => {
    if (host.isConnected) return;
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    gone.disconnect();
  });
  gone.observe(document.body, { childList: true, subtree: true });

  // the holdout result per rule, for the panel (real review.json or the labelled example)
  if (!ui.review) {
    const { loadReview } = await import('./holdout.js');
    ui.review = await loadReview(data, rules);
    if (host.isConnected) drawPanel(select);
  }
}
