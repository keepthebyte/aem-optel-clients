/*
 * Insights mode for the demo panel (?demo → "Insights"): every visible section says why it is
 * there, and the panel says what the data shows about this visitor's cohort.
 *
 * Two sources, both data:
 *   1. Section Metadata `Insight` on the cohort page: the Optel finding behind the section,
 *      written by whoever sized the cohorts ("Coverage & exclusions is the #1 onward path
 *      from product pages: 2.8k in 8 weeks"). The reason line in front of it is computed
 *      from the section's own Slot / Cohorts / Hide For / Promote and this visitor's match.
 *   2. `cohorts.json` (scripts/size.js) published at /cohorts/cohorts.json: share, what the
 *      cohort does today, growth and caveats per rule, turned into sentences here. Nothing is
 *      typed by hand, so the numbers change when size.js runs on next month's bundles.
 *
 * Pure functions first (Node tests import them), DOM last. Copy next to cohort-panel.js.
 */

const list = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

/** 9.2%, 64%; `share` keeps one decimal at any size (14.6% of views), as the sizing reports do */
export const pct = (x, share = false) => {
  const p = (Number(x) || 0) * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  return `${p < 10 || share ? p.toFixed(1).replace(/\.0$/, '') : Math.round(p)}%`;
};

const num = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US'));
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Express · dog" for a key like express:dog (an experience label is cut at its colon:
 * "Express: I know what I want" → "Express", so a list of them stays readable) */
export function keyLabel(rules, key) {
  const [e, i] = String(key).split(':');
  const name = e === 'default' ? 'everyone else' : (rules.experiences?.[e]?.label || e).split(':')[0].trim();
  return i ? `${name} · ${i}` : name;
}

/**
 * Why this section is on this visitor's page, from its metadata and the matched keys.
 * @param meta { slot, cohorts, hideFor, promote } (a section's dataset)
 * @param ctx { keys } (window.cohorts), keys most specific first, ending in 'default'
 * @returns string[] reasons, most important first
 */
export function sectionReasons(meta, ctx, rules) {
  const keys = ctx?.keys?.length ? ctx.keys : ['default'];
  const own = keys.length === 1 ? keys : keys.filter((k) => k !== 'default');
  const out = [];
  const only = list(meta.cohorts);
  if (meta.slot) {
    const won = keys.find((k) => (only.length ? only : ['default']).includes(k)) || 'default';
    const slot = meta.slot.charAt(0).toUpperCase() + meta.slot.slice(1);
    out.push(won === 'default'
      ? `${slot}: the original, for visitors no ${meta.slot} is made for`
      : `${slot} made for ${keyLabel(rules, won)}`);
  } else if (only.length) {
    const mine = only.filter((c) => own.includes(c) || (c === 'default' && own[0] === 'default'));
    const names = only.map((c) => keyLabel(rules, c));
    out.push(`Only for ${names.join(', ')}${mine.length ? '' : ' (not you: shown anyway)'}`);
  }
  const promoted = list(meta.promote).find((c) => own.includes(c));
  if (promoted) out.push(`Moved up for ${keyLabel(rules, promoted)}`);
  const hidden = list(meta.hideFor);
  if (hidden.length) out.push(`Hidden for ${hidden.map((c) => keyLabel(rules, c)).join(', ')}`);
  if (!out.length) out.push('Everyone sees this section');
  return out;
}

/**
 * What cohorts.json says about a rule (or about unmatched visitors when id is null).
 * @returns {{ headline, lines: string[], caveats: string[], source }} or null without data
 */
export function ruleFacts(data, id, rules = {}) {
  if (!data?.rules) return null;
  const m = data.meta || {};
  const weeks = m.fullWeeks || m.weeks;
  const source = `Optel · ${m.domain || ''}${m.path || ''} · ${m.start ? `${day(m.start)} – ${day(m.end)}` : ''} · ${num(m.views || 0)} views (${num(m.bundles || 0)} sampled)`;
  if (!id) {
    const d = (data.experiences || []).find((e) => e.id === 'default');
    const lines = [];
    if (data.today?.didNothing != null) lines.push(`Across all homepage views, ${pct(data.today.didNothing)} do nothing today`);
    return {
      headline: d ? `${pct(d.share, true)} of homepage views match no rule and get the original page` : 'No rule matched: the original page',
      lines,
      caveats: [],
      source,
    };
  }
  const r = data.rules.find((x) => x.id === id);
  if (!r) return null;
  const rule = (rules.rules || []).find((x) => x.id === id) || {};
  const t = r.today || {};
  const lines = [];
  const caveats = [];
  if (!r.views) {
    return {
      headline: `${r.label}: not seen on the homepage in these ${weeks} weeks`, lines, caveats: ['Kept for visitors the data cannot see yet.'], source,
    };
  }
  const headline = `${pct(r.share, true)} of homepage views${r.modelled || r.firstVisitAssumed ? ' at most' : ''} · ${weeks} weeks`;
  if (t.didNothing != null) {
    const ratio = t.vsAll?.didNothing;
    const vs = ratio && Math.abs(ratio - 1) >= 0.15 ? ` (${ratio.toFixed(1)}× the page average)` : '';
    lines.push(`${pct(t.didNothing)} do nothing today${vs}`);
  }
  if (t.goalRate) lines.push(`${pct(t.goalRate)} reach the goal${rule.goalLabel ? ` (${rule.goalLabel})` : ''}`);
  const link = (t.topClicks || []).find((c) => c.link);
  if (link) lines.push(`Most clicked link: ${link.click} (${pct(link.share)})`);
  if (r.growth != null && Math.abs(r.growth) >= 0.2) {
    lines.push(`${r.growth > 0 ? 'Up' : 'Down'} ${pct(Math.abs(r.growth))} from the first full week to the last`);
  }
  if (r.standsOut) lines.push('Small, but stands out: more engaged or growing fast');
  if (r.modelled) caveats.push('Modelled: depends on on-device memory, which Optel cannot see, so it is estimated from what views do today.');
  if (r.firstVisitAssumed) caveats.push('Upper bound: Optel cannot tell first visits from repeat ones.');
  if (r.lowSample) caveats.push(`Only ${r.bundles} sampled views: read it as directional.`);
  return {
    headline, lines, caveats, source,
  };
}

/* ---------- DOM ---------- */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

/** cohorts.json, once per page; null when it is not published */
let pending;
// The pipeline reads section metadata values as comma lists and drops the space after each comma
// ("homepage, ~15%" → "homepage,~15%"): put it back, leaving thousands (2,800) alone.
export const insightText = (t) => String(t || '').replace(/,(?=[^\s\d])|(?<=\D),(?=\d)/g, ', ');

export function loadInsightData(rules) {
  if (!pending) {
    const src = rules.insights?.src || `${window.hlx?.codeBasePath || ''}/cohorts/cohorts.json`;
    pending = fetch(src).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return pending;
}

export function hideInsights(main = document.querySelector('main')) {
  main?.querySelectorAll('.cohort-insight').forEach((n) => n.remove());
  document.body.classList.remove('cohort-insights');
}

/** One note at the top of every visible section; the first section also gets the cohort's facts. */
export function showInsights(rules, data, ctx = window.cohorts, main = document.querySelector('main')) {
  if (!main) return;
  hideInsights(main);
  document.body.classList.add('cohort-insights');
  const tag = rules.insights?.label || 'Optel';
  const facts = ruleFacts(data, ctx?.rule || null, rules);
  [...main.querySelectorAll(':scope > .section')].forEach((s, i) => {
    const note = document.createElement('div');
    note.className = 'cohort-insight';
    const reasons = sectionReasons(s.dataset, ctx, rules);
    const insight = s.dataset.insight ? `<p class="cohort-insight-text">${esc(insightText(s.dataset.insight))}</p>` : '';
    const who = i === 0 && facts
      ? `<p class="cohort-insight-facts"><b>${esc(ctx?.label && ctx.rule ? `${ctx.label}: ` : '')}${esc(facts.headline)}.</b> ${esc(facts.lines.join(' · '))}</p>`
      : '';
    note.innerHTML = `<span class="cohort-insight-tag">${esc(tag)}</span><div><p class="cohort-insight-why">${esc(reasons.join(' · '))}</p>${who}${insight}</div>`;
    s.prepend(note);
  });
}
