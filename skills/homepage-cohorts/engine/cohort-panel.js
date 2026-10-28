/*
 * Demo-only "Why am I seeing this?" panel, for showing the cohorts to stakeholders.
 * Loaded from loadDelayed() when the URL has ?demo. Copy to scripts/cohort-panel.js
 * (and styles/cohort-panel.css). Scenarios come from cohort-rules.js `scenarios`:
 * each one sets real signals (ref, utm_*, memory), so detection does the rest.
 */
import { forgetVisitor, readMemory } from './cohorts.js';

const PARAMS = ['cohort', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'experiment', 'gclid', 'fbclid'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

function go(params, path = window.location.pathname) {
  const u = new URL(path, window.location.origin);
  PARAMS.forEach((k) => u.searchParams.delete(k));
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('demo', '');
  window.location.href = `${u.pathname}${u.search.replace(/=(&|$)/g, '$1')}`;
}

/* Original = the plugin forced to control (works before and after promotion);
   New = the cohort page. */
function switcher(rules) {
  const exp = rules.experiment || 'homepage-cohorts';
  const newPath = rules.pocPath || '/new';
  const onNew = window.location.pathname === newPath || document.body.dataset.experience !== 'default';
  const keep = new URLSearchParams(window.location.search);
  ['demo', 'experiment'].forEach((k) => keep.delete(k));
  const qs = keep.toString() ? `&${keep}` : '';
  return `<nav class="cohort-compare" aria-label="Compare">
    <a href="/?experiment=${exp}/control&demo${qs}"${onNew ? '' : ' aria-current="page"'}>Original</a>
    <a href="${newPath}?demo${qs}"${onNew ? ' aria-current="page"' : ''}>New</a>
  </nav>`;
}

export default function initPanel(rules) {
  const ctx = window.cohorts;
  const el = document.createElement('aside');
  el.className = 'cohort-panel';
  el.setAttribute('aria-label', 'Personalization details');

  if (!ctx || ctx.arm === 'control') {
    el.innerHTML = `<div class="cohort-bar">${switcher(rules)}<span class="cohort-same">Original page: the same for every visitor</span></div>`;
    document.body.append(el);
    return;
  }

  const s = ctx.signals || {};
  const mem = readMemory(rules);
  const rule = (rules.rules || []).find((r) => r.id === ctx.rule);
  const exp = (rules.experiences || {})[ctx.experience];
  const label = `${ctx.rule || 'no rule'}${ctx.intent ? ` · ${ctx.intent}` : ''}`;
  const utm = Object.entries(s.utm || {}).filter(([, v]) => v).map(([k, v]) => `utm_${k}=${v}`).join(' ') || '(none)';
  el.innerHTML = `
    <div class="cohort-bar">
      ${switcher(rules)}
      <button class="cohort-pill" aria-expanded="false" aria-controls="cohort-body"><span>Why am I seeing this?</span> <b>${esc(label)}</b></button>
    </div>
    <div class="cohort-body" id="cohort-body" hidden>
      <p class="cohort-why">${esc(exp ? `${exp.label}. ${exp.sub || ''}` : 'No rule matched, so this is the original page.')}</p>
      <dl>
        <dt>Rule</dt><dd>${esc(ctx.forced ? `${rule?.label || ctx.rule} (forced with ?cohort)` : rule?.label || ctx.label)}</dd>
        <dt>Referrer</dt><dd>${esc(s.refHost || '(none)')} · ${esc(s.source || '')}</dd>
        <dt>UTM</dt><dd>${esc(utm)}</dd>
        <dt>Ad click</dt><dd>${esc((s.paid || []).join(', ') || 'no')}</dd>
        <dt>Device</dt><dd>${esc(s.device || '')}</dd>
        <dt>Memory</dt><dd>${esc(mem.visits || 0)} visits · signed in before: ${mem.signedIn ? 'yes' : 'no'} · ${esc(Object.entries(mem.interests || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'no interests')}</dd>
      </dl>
      <p class="cohort-note">On-device only. No personal information, no third-party calls. Decided before the page paints.</p>
      <p class="cohort-try">Try a visitor</p>
      <div class="cohort-switch">
        ${(rules.scenarios || []).map(([name], i) => `<button type="button" data-s="${i}">${esc(name)}</button>`).join('')}
      </div>
    </div>`;

  const pill = el.querySelector('.cohort-pill');
  const body = el.querySelector('.cohort-body');
  const toggle = (open) => {
    body.hidden = !open;
    pill.setAttribute('aria-expanded', String(open));
    try { sessionStorage.setItem('cohort-panel', open ? '1' : '0'); } catch (e) { /* noop */ }
  };
  pill.addEventListener('click', () => toggle(body.hidden));
  el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
    const [, params, memory] = rules.scenarios[Number(b.dataset.s)];
    forgetVisitor(rules);
    if (memory) {
      try {
        const last = Date.now() - (rules.memory?.sessionGapMs || 30 * 60 * 1000) - 1;
        localStorage.setItem(rules.memory?.storeKey || 'cohorts-v1', JSON.stringify({ ...memory, last }));
      } catch (e) { /* storage blocked */ }
    }
    go(params, rules.pocPath || '/new');
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !body.hidden) toggle(false);
  });
  document.body.append(el);
  try { if (sessionStorage.getItem('cohort-panel') === '1') toggle(true); } catch (e) { /* noop */ }
}
