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
  } else if (only.length && only.includes('default') && rules.experiences) {
    // "default, express, proof" = everyone but the experiences left out: say who is left out
    const named = only.filter((c) => c !== 'default');
    const out2 = Object.keys(rules.experiences).filter((e) => !named.includes(e)).map((e) => {
      const part = named.filter((c) => c.startsWith(`${e}:`)).map((c) => c.split(':')[1]);
      return part.length ? `${keyLabel(rules, e)} (except ${part.join(', ')})` : keyLabel(rules, e);
    });
    if (out2.length) out.push(`Hidden for ${out2.join(', ')}`);
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
 * @returns {{ headline, lines: string[], stats: {value, text}[], caveats: string[], source }}
 *   or null without data. `stats` is the same data as value + words, for large display.
 */
export function ruleFacts(data, id, rules = {}) {
  if (!data?.rules) return null;
  const m = data.meta || {};
  const weeks = m.fullWeeks || m.weeks;
  const source = `Optel · ${m.domain || ''}${m.path || ''} · ${m.start ? `${day(m.start)} – ${day(m.end)}` : ''} · ${num(m.views || 0)} views (${num(m.bundles || 0)} sampled)`;
  if (!id) {
    const d = (data.experiences || []).find((e) => e.id === 'default');
    const lines = [];
    const stats = [];
    if (d) stats.push({ value: pct(d.share, true), text: `of homepage views match no rule and see the original page · ${weeks} weeks` });
    if (data.today?.didNothing != null) {
      lines.push(`Across all homepage views, ${pct(data.today.didNothing)} do nothing today`);
      stats.push({ value: pct(data.today.didNothing), text: 'of all homepage views do nothing today' });
    }
    return {
      headline: d ? `${pct(d.share, true)} of homepage views match no rule and get the original page` : 'No rule matched: the original page',
      lines,
      stats,
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
      headline: `${r.label}: not seen on the homepage in these ${weeks} weeks`, lines, stats: [], caveats: ['Kept for visitors the data cannot see yet.'], source,
    };
  }
  const atMost = r.modelled || r.firstVisitAssumed ? ' at most' : '';
  const headline = `${pct(r.share, true)} of homepage views${atMost} · ${weeks} weeks`;
  const stats = [{ value: pct(r.share, true), text: `of homepage views${atMost} · ${weeks} weeks` }];
  if (t.didNothing != null && !r.modelled) {
    const ratio = t.vsAll?.didNothing;
    const vs = ratio && Math.abs(ratio - 1) >= 0.15 ? ` (${ratio.toFixed(1)}× the page average)` : '';
    lines.push(`${pct(t.didNothing)} do nothing today${vs}`);
  }
  if (t.goalRate) lines.push(`${pct(t.goalRate)} reach the goal${rule.goalLabel ? ` (${rule.goalLabel})` : ''}`);
  if (t.supportRate) lines.push(`${pct(t.supportRate)} take the supporting step${rule.supportLabel ? ` (${rule.supportLabel})` : ''}`);
  // a modelled rule's views were picked by what they clicked: their "do nothing" is circular
  // (0% for a rule modelled on a click), as their goal rate is (size.js leaves that null)
  // goal first in the large display: it is what the experience is built to move
  if (t.goalRate) stats.push({ value: pct(t.goalRate), text: `reach the goal${rule.goalLabel ? `: ${rule.goalLabel}` : ''}` });
  if (t.supportRate) stats.push({ value: pct(t.supportRate), text: `take the supporting step${rule.supportLabel ? `: ${rule.supportLabel}` : ''}` });
  if (t.didNothing != null && !r.modelled) {
    const ratio = t.vsAll?.didNothing;
    stats.push({
      value: pct(t.didNothing),
      text: `do nothing today${ratio && Math.abs(ratio - 1) >= 0.15 ? `, ${ratio.toFixed(1)}× the page average` : ''}`,
    });
  }
  const link = (t.topClicks || []).find((c) => c.link);
  if (link) lines.push(`Most clicked link: ${link.click} (${pct(link.share)})`);
  if (r.growth != null && Math.abs(r.growth) >= 0.2) {
    lines.push(`${r.growth > 0 ? 'Up' : 'Down'} ${pct(Math.abs(r.growth))} from the first full week to the last`);
    stats.push({ value: `${r.growth > 0 ? '+' : '−'}${pct(Math.abs(r.growth))}`, text: 'first full week to the last' });
  }
  if (r.standsOut) lines.push('Small, but stands out: more engaged or growing fast');
  if (r.modelled) caveats.push('Modelled: depends on on-device memory, which Optel cannot see, so it is estimated from what views do today.');
  if (r.firstVisitAssumed) caveats.push('Upper bound: Optel cannot tell first visits from repeat ones.');
  if (r.lowSample) caveats.push(`Only ${r.bundles} sampled views: read it as directional.`);
  return {
    headline, lines, stats, caveats, source,
  };
}

/**
 * Generated findings for a section about a page (Section Metadata `Insight Path`), from the
 * site-wide second order in cohorts.json (size.js --site): is it a first step after the
 * homepage, a next step after one, content that comes right before the conversion?
 * Numbers follow each size.js run, so nobody types them.
 * @param paths string or comma list ('/coverage, /how-to-cancel')
 * @returns string[] at most three sentences, most telling first; [] without data
 */
// a second step under MIN_STEP sampled views is not said at all; under 30 it is said with a hedge
const MIN_STEP = 5;
const small = (row) => (row.lowSample ? ' (small sample)' : '');

export function pathFacts(data, paths, rules = {}) {
  const so = data?.secondOrder;
  if (!so?.first) return [];
  const name = (p) => rules.insights?.pages?.[p] || p;
  const weeks = so.weeks ? ` in ${so.weeks} weeks` : '';
  const out = [];
  list(paths).forEach((raw) => {
    const p = raw.startsWith('/') ? raw : `/${raw}`;
    // a next step from the homepage's own arrivals when the sample holds, else from all the
    // page's visitors (said so); under MIN_STEP sampled views it is not said at all
    const step = (f, key) => {
      const is = (n) => !key || n.key === key;
      const own = (f.next || []).find((n) => is(n) && !n.lowSample);
      if (own) return { n: own, k: f.next.indexOf(own), who: 'of its visitors from the homepage' };
      const all = (f.nextAll || []).find((n) => is(n) && n.bundles >= MIN_STEP);
      if (all) return { n: all, k: f.nextAll.indexOf(all), who: 'of all its visitors' };
      const thin = (f.next || []).find((n) => is(n) && n.bundles >= MIN_STEP);
      return thin ? { n: thin, k: f.next.indexOf(thin), who: 'of its visitors from the homepage' } : null;
    };
    const i = so.first.findIndex((f) => f.path === p);
    if (i >= 0) {
      const f = so.first[i];
      const s0 = step(f);
      const then = s0 ? `; then ${pct(s0.n.share)} ${s0.who} go on to ${name(s0.n.key)}${small(s0.n)}` : '';
      out.push(`${i === 0 ? 'The #1' : `#${i + 1}`} next stop after the homepage: ${pct(f.share)} of the visitors who go on land on ${name(p)} (~${num(f.views)} views${weeks})${small(f)}${then}`);
    }
    let best = null;
    so.first.forEach((f) => {
      const st = step(f, p);
      if (st && (!best || st.n.views > best.n.views)) best = { f, ...st };
    });
    if (best) {
      out.push(`${best.k === 0 ? 'The #1' : `#${best.k + 1}`} next step from ${name(best.f.path)}: ${pct(best.n.share)} ${best.who} go on to ${name(p)} (~${num(best.n.views)} views${weeks})${small(best.n)}`);
    }
    const a = (so.assists?.pages || []).find((x) => x.path === p);
    if (a && !a.lowSample && a.lift >= 1.2) {
      const goal = so.conversion?.label || 'convert';
      out.push(`Visitors coming from ${name(p)} ${goal} ${a.lift.toFixed(1)}× as often as the site average (${pct(a.rate)} vs ${pct(so.assists.rate)})`);
    }
  });
  // most telling first: a finding without a sample hedge, then a #1
  const weight = (t) => (t.includes('(small sample)') ? 2 : 0) + (t.startsWith('The #1') ? 0 : 1);
  return out.map((t, i) => ({ t, i }))
    .sort((a, b) => weight(a.t) - weight(b.t) || a.i - b.i)
    .map((x) => x.t)
    .slice(0, 3);
}

/** "Optel · site journeys · Sep 14 – Nov 9" for generated findings */
export const pathSource = (data, tag = 'Optel') => {
  const so = data?.secondOrder;
  return so?.start ? `${tag} · site journeys · ${day(so.start)} – ${day(so.end)}` : `${tag} data`;
};

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

/** numbers in an authored finding, bolded so they read first (on already-escaped text) */
export const markNumbers = (html) => html.replace(/(~?\d(?:[\d,.]*\d)?(?:k\b|%|×)?)(?![a-z\d])/gi, '<b>$1</b>');

const ICON = '<svg class="cohort-insight-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';

export const statsHTML = (stats, cls) => `<ul class="${cls}">${stats.map((x) => `<li><b>${esc(x.value)}</b> <span>${esc(x.text)}</span></li>`).join('')}</ul>`;

/** A note at the top of every visible section; the first one also gets the cohort's numbers. */
export function showInsights(rules, data, ctx = window.cohorts, main = document.querySelector('main')) {
  if (!main) return;
  hideInsights(main);
  document.body.classList.add('cohort-insights');
  const tag = rules.insights?.label || 'Optel';
  const facts = ruleFacts(data, ctx?.rule || null, rules);
  [...main.querySelectorAll(':scope > .section')].forEach((s, i) => {
    const reasons = sectionReasons(s.dataset, ctx, rules);
    const text = s.dataset.insight ? insightText(s.dataset.insight) : '';
    const generated = s.dataset.insightPath ? pathFacts(data, s.dataset.insightPath, rules) : [];
    const first = i === 0 && facts;
    const note = document.createElement('aside');
    const quiet = !text && !generated.length && !first && reasons[0] === 'Everyone sees this section';
    note.className = `cohort-insight${quiet ? ' is-quiet' : ''}`;
    note.setAttribute('aria-label', 'Why this section is here');
    note.innerHTML = `${ICON}<div class="cohort-insight-body">
      <p class="cohort-insight-why">${reasons.map(esc).join('<span aria-hidden="true"> · </span>')}</p>
      ${first && facts.stats.length ? statsHTML(facts.stats, 'cohort-insight-stats') : ''}
      ${generated.map((g) => `<p class="cohort-insight-text">${markNumbers(esc(g))}.</p>`).join('')}
      ${text ? `<p class="cohort-insight-text">${markNumbers(esc(text))}</p>` : ''}
      ${first || text || generated.length ? `<p class="cohort-insight-src">${esc(first ? facts.source : pathSource(generated.length ? data : null, tag))}</p>` : ''}
    </div>`;
    s.prepend(note);
  });
}
