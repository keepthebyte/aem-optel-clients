/*
 * Homepage cohorts: first-match rules over first-party signals, applied to the sections of one page.
 *
 * Copy to the site as scripts/cohorts.js (with scripts/cohort-rules.js). Dependency-free.
 * The same module runs in Node: the skill's size.js and review.js evaluate these rules on
 * Optel bundles, so the rules that decide the page are the rules that get measured.
 *
 * How a view gets its page:
 *   1. The AEM Experimentation plugin runs first. On the homepage, a page-level experiment
 *      (`Experiment: homepage-cohorts`, `Experiment Variants: /new`, `Experiment Split: 90`)
 *      sends 90% to the cohort page (challenger-1) and keeps 10% on the original (control).
 *   2. runCohorts() reads the arm from the body (`experiment-<id>`, `data-variant`), or runs
 *      in POC mode on a page with `Cohorts: on` metadata (the /new page itself, no holdout).
 *   3. resolve() finds the first rule that matches; apply() keeps one section per slot and
 *      drops, hides or promotes sections for that rule's experience.
 *   4. One `audience` checkpoint per view: source = rule id (or `none`), target = arm. Control
 *      views are classified too, so the monthly review compares each rule against its holdout.
 */

/* ---------- built-in signal classification (kept small: this ships to every visitor) ---------- */

export const SIGNALS = {
  ai: /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|gemini\.google\.com|meta\.ai|deepseek\.com|mistral\.ai|grok\.com|you\.com|phind\.com)$/i,
  aiUtm: /chatgpt|openai|perplexity|copilot|gemini|claude|deepseek|mistral|grok/i,
  search: /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.[a-z.]+|duckduckgo\.com|ecosia\.org|baidu\.com|yandex\.[a-z]+|naver\.com|search\.brave\.com|qwant\.com|startpage\.com)$/i,
  social: /(^|\.)(facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|t\.co|pinterest\.[a-z.]+|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|threads\.net|bsky\.app)$/i,
  bot: /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview/i,
  mobileUa: /Mobi|Android|iPhone|iPad/i,
  // ad click ids on the landing URL → network (same names as Optel's `paid` checkpoint)
  paidParams: {
    gclid: 'google', gbraid: 'google', wbraid: 'google', dclid: 'doubleclick', fbclid: 'facebook', msclkid: 'microsoft', ttclid: 'tiktok', li_fat_id: 'linkedin', twclid: 'x', oppref: 'openai', olref: 'openai',
  },
};

const UTM = ['source', 'medium', 'campaign', 'content', 'term'];
const rx = (s) => (s instanceof RegExp ? s : new RegExp(s, 'i'));
const arr = (v) => (v == null ? [] : [].concat(v));
const list = (v) => (v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, ''); } catch (e) { return ''; }
}

/* same site: the host itself or a sibling under the same base (login.example.com, shop.example.com) */
function sameSite(host, siteHost) {
  const base = (h) => h.split('.').slice(-2).join('.');
  return !!host && !!siteHost && (host === siteHost || base(host) === base(siteHost));
}

/** direct | internal | search | social | ai | other */
export function sourceOf(refHost, siteHost, utm = {}) {
  if (SIGNALS.aiUtm.test(utm.source || '')) return 'ai';
  if (!refHost) return 'direct';
  if (sameSite(refHost, siteHost)) return 'internal';
  if (SIGNALS.ai.test(refHost)) return 'ai';
  if (SIGNALS.search.test(refHost)) return 'search';
  if (SIGNALS.social.test(refHost)) return 'social';
  return 'other';
}

/** The intent named by a text (campaign tags, a path), from rules.intents: [[id, regex], ...] in priority order. */
export function intentFrom(rules, text = '') {
  return ((rules.intents || []).find(([, re]) => rx(re).test(text)) || [null])[0];
}

export function topInterest(memory = {}) {
  const e = Object.entries(memory.interests || {});
  return e.length ? e.sort((a, b) => b[1] - a[1])[0][0] : null;
}

/* ---------- rules ---------- */

/**
 * Does one `when` clause hold? Every key must hold; an array value means "any of".
 *   source: 'direct'|'internal'|'search'|'social'|'ai'|'other' (or an array)
 *   referrer: ['portal.example.com', ...]   host or parent domain of the referrer
 *   utm: { source, medium, campaign, content, term, any }   regex strings (case-insensitive); any = campaign|content|term
 *   paid: true | false | ['google', 'facebook', ...]
 *   device: 'mobile' | 'desktop'
 *   signedIn: true | false            on-device memory: this browser clicked sign-in before
 *   visits: { min, max }              on-device memory: visits including this one
 *   interest: true | ['pricing', ...] on-device memory: top interest exists / is one of
 *   intent: ['pricing', ...]          intent named by the campaign tags (or the top interest)
 *   any: [when, when, ...]            at least one nested clause holds
 */
export function matches(when = {}, s, rules = {}) {
  return Object.entries(when).every(([k, v]) => {
    switch (k) {
      case 'source': return arr(v).includes(s.source);
      case 'referrer': return arr(v).some((h) => s.refHost === h || s.refHost.endsWith(`.${h}`));
      case 'utm': return Object.entries(v).every(([f, re]) => (f === 'any'
        ? rx(re).test(`${s.utm.campaign} ${s.utm.content} ${s.utm.term}`)
        : rx(re).test(s.utm[f] || '')));
      case 'paid': return v === true ? s.paid.length > 0 : v === false ? !s.paid.length : arr(v).some((n) => s.paid.includes(n));
      case 'device': return s.device === v;
      case 'signedIn': return !!s.memory.signedIn === v;
      case 'visits': return (s.memory.visits || 0) >= (v.min ?? 0) && (s.memory.visits || 0) <= (v.max ?? Infinity);
      case 'interest': { const t = topInterest(s.memory); return v === true ? !!t : arr(v).includes(t); }
      case 'intent': return arr(v).includes(intentFrom(rules, `${s.utm.campaign} ${s.utm.content} ${s.utm.term}`) || topInterest(s.memory));
      case 'any': return arr(v).some((w) => matches(w, s, rules));
      default: return false; // unknown condition: never match silently
    }
  });
}

/**
 * First rule that matches wins. Bots never match (they always get the original sections).
 * @returns {{ rule: string|null, experience: string, intent: string|null, keys: string[], label: string }}
 */
export function matchRule(rules, s) {
  const r = s.bot ? null : (rules.rules || []).find((x) => matches(x.when, s, rules));
  if (!r) return { rule: null, experience: 'default', intent: null, keys: ['default'], label: 'no rule matched' };
  const fromUtm = intentFrom(rules, `${s.utm.campaign} ${s.utm.content} ${s.utm.term}`);
  const intent = r.intent === false ? null
    : r.intent === 'utm' ? fromUtm
      : r.intent === 'memory' ? topInterest(s.memory)
        : fromUtm || topInterest(s.memory);
  const keys = [...new Set([intent && `${r.experience}:${intent}`, r.experience, 'default'].filter(Boolean))];
  return {
    rule: r.id, experience: r.experience, intent, keys, label: r.label || r.id,
  };
}

/* ---------- browser: signals, memory, apply ---------- */

export function readMemory(rules) {
  if (!memoryAllowed(rules)) return {};
  try { return JSON.parse(localStorage.getItem(rules.memory?.storeKey || 'cohorts-v1')) || {}; } catch (e) { return {}; }
}

function writeMemory(rules, v) {
  try { localStorage.setItem(rules.memory?.storeKey || 'cohorts-v1', JSON.stringify(v)); } catch (e) { /* blocked */ }
}

/** With `memory.requireConsent`, memory is read and written only after the experimentation plugin recorded consent. */
export function memoryAllowed(rules) {
  if (!rules.memory?.requireConsent) return true;
  try { return localStorage.getItem('experimentation-consented') === 'true'; } catch (e) { return false; }
}

/** Signals for this view. Demo/simulation overrides: ?ref=<host> stands in for the referrer. */
export function browserSignals(rules) {
  const u = new URL(window.location.href);
  const q = u.searchParams;
  const utm = Object.fromEntries(UTM.map((k) => [k, (q.get(`utm_${k}`) || '').toLowerCase()]));
  const refHost = (q.get('ref') || hostOf(document.referrer)).replace(/^(www|m)\./, '');
  const siteHost = u.hostname.replace(/^www\./, '');
  const ua = navigator.userAgent;
  const mobile = (navigator.userAgentData && navigator.userAgentData.mobile)
    || SIGNALS.mobileUa.test(ua) || window.matchMedia('(max-width: 599px)').matches;
  return {
    refHost,
    source: sourceOf(refHost, siteHost, utm),
    utm,
    paid: [...new Set(Object.entries(SIGNALS.paidParams).filter(([p]) => q.has(p)).map(([, n]) => n))],
    device: mobile ? 'mobile' : 'desktop',
    bot: SIGNALS.bot.test(ua) || navigator.webdriver === true,
    memory: readMemory(rules),
    path: u.pathname,
  };
}

/** Resolve this view's rule. ?cohort=<rule id> forces a rule (demo and screenshots). */
export function resolve(rules, signals = browserSignals(rules)) {
  const forced = new URLSearchParams(window.location.search).get('cohort');
  const r = forced && (rules.rules || []).find((x) => x.id === forced);
  const ctx = r
    ? { ...matchRule({ ...rules, rules: [{ ...r, when: {} }] }, { ...signals, bot: false }), forced: true }
    : matchRule(rules, signals);
  return { ...ctx, signals };
}

/**
 * Prune and reorder decorated sections for the matched keys (most specific first).
 * Section Metadata on the cohort page:
 *   Slot: hero        one section per slot survives: the first whose Cohorts list has the most specific key
 *   Cohorts: a, b:x   section only for these experiences (default = the original page's sections)
 *   Hide For: a       section removed for these experiences
 *   Promote: a        section moved right under the first section for these experiences
 * Must run after decorateMain() and before the first loadSection().
 */
export function apply(main, keys) {
  const own = keys.length === 1 ? keys : keys.filter((k) => k !== 'default');
  const sections = [...main.querySelectorAll(':scope > .section')];
  const slots = {};
  sections.forEach((s) => { if (s.dataset.slot) (slots[s.dataset.slot] = slots[s.dataset.slot] || []).push(s); });
  Object.values(slots).forEach((group) => {
    let winner;
    keys.some((k) => { winner = group.find((s) => list(s.dataset.cohorts || 'default').includes(k)); return winner; });
    group.forEach((s) => { if (s !== winner) s.remove(); });
  });
  sections.forEach((s) => {
    if (!s.isConnected || s.dataset.slot) return;
    const only = list(s.dataset.cohorts);
    const hide = list(s.dataset.hideFor);
    if ((only.length && !only.some((c) => own.includes(c))) || hide.some((c) => own.includes(c))) s.remove();
  });
  const live = [...main.querySelectorAll(':scope > .section')];
  const [anchor] = live;
  live.filter((s) => s !== anchor && list(s.dataset.promote).some((c) => own.includes(c)))
    .reverse().forEach((s) => anchor.after(s));
}

/**
 * Entry point for scripts.js loadEager(), after runExperimentation() and decorateMain().
 * @returns the context (also on window.cohorts) or null when this page doesn't run cohorts
 */
export function runCohorts(main, rules, { sampleRUM, getMetadata } = {}) {
  const exp = rules.experiment || 'homepage-cohorts';
  const { body } = document;
  const inExperiment = body.classList.contains(`experiment-${exp}`);
  const poc = getMetadata && getMetadata('cohorts') === 'on';
  if (!inExperiment && !poc) return null;
  const arm = inExperiment ? (body.dataset.variant || 'control') : 'poc';
  let ctx;
  try {
    ctx = resolve(rules);
    apply(main, arm === 'control' ? ['default'] : ctx.keys);
  } catch (e) {
    // never show every variant at once: fall back to the original sections
    apply(main, ['default']);
    ctx = { rule: null, experience: 'default', keys: ['default'], error: String(e) };
  }
  ctx.arm = arm;
  body.dataset.cohort = ctx.rule || 'none';
  body.dataset.experience = arm === 'control' ? 'default' : ctx.experience;
  if (sampleRUM) sampleRUM('audience', { source: ctx.rule || 'none', target: arm });
  window.cohorts = ctx;
  return ctx;
}

/** Record this view in on-device memory (every page, from loadLazy). */
export function rememberVisit(rules, now = Date.now()) {
  if (!memoryAllowed(rules)) return;
  const gap = rules.memory?.sessionGapMs || 30 * 60 * 1000;
  const m = readMemory(rules);
  if (!m.last || now - m.last > gap) m.visits = (m.visits || 0) + 1;
  m.last = now;
  m.interests = m.interests || {};
  const i = intentFrom(rules, window.location.pathname);
  if (i) m.interests[i] = (m.interests[i] || 0) + 1;
  writeMemory(rules, m);
}

/** Mark this browser as signed in once it clicks a sign-in control (rules.memory.signIn: CSS selector). */
export function watchSignIn(rules) {
  const sel = rules.memory?.signIn;
  if (!sel) return;
  document.addEventListener('click', (e) => {
    if (!e.target.closest(sel) || !memoryAllowed(rules)) return;
    writeMemory(rules, { ...readMemory(rules), signedIn: true });
  }, { capture: true });
}

export function forgetVisitor(rules) {
  try { localStorage.removeItem(rules.memory?.storeKey || 'cohorts-v1'); } catch (e) { /* noop */ }
}
