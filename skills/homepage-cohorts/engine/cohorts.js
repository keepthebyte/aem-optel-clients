/*
 * Homepage cohorts: first-match rules over first-party signals,
 * applied to the sections of one page.
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
  ai: /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|copilot\.com|copilot\.cloud\.microsoft|m365copilotapp\.svc\.cloud\.microsoft|gemini\.google\.com|meta\.ai|muse\.ai|deepseek\.com|mistral\.ai|grok\.com|you\.com|phind\.com)$/i,
  // copilot, gemini, claude stand alone: capgemini, eventcopilot.ai are not AI (rum-distiller)
  aiUtm: /chatgpt|openai|perplexity|(?<![a-z0-9])(copilot|gemini(forbusiness)?|claude|anthropic)(?![a-z0-9])|deepseek|mistral|grok/i,
  search: /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.[a-z.]+|duckduckgo\.com|ecosia\.org|baidu\.com|yandex\.[a-z]+|naver\.com|search\.brave\.com|qwant\.com|startpage\.com)$/i,
  social: /(^|\.)(facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|t\.co|pinterest\.[a-z.]+|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|threads\.net|bsky\.app)$/i,
  // in-app referrers: android-app://com.facebook.katana/ → facebook.com. Same table as
  // RULES.androidApps in optel-client.js (a test keeps them equal), so the browser and size.js
  // classify an app the way Optel's reports do.
  apps: {
    'com.google.android.gm': 'mail.google.com',
    'com.google.android.googlequicksearchbox': 'google.com',
    'com.google.android.youtube': 'youtube.com',
    'com.facebook.katana': 'facebook.com',
    'com.instagram.android': 'instagram.com',
    'com.linkedin.android': 'linkedin.com',
    'com.pinterest': 'pinterest.com',
    'com.reddit.frontpage': 'reddit.com',
    'com.twitter.android': 'x.com',
    'jp.naver.line.android': 'line.me',
    'com.openai.chatgpt': 'chatgpt.com',
  },
  bot: /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview/i,
  // personal AI agents (an assistant browsing for one person), named as in Optel's bot:ai:<name>.
  // Claude, Google and Manus say so in the user agent. ChatGPT and Meta browse with an ordinary
  // Chrome user agent and sign the request (Signature-Agent header): the page only knows them
  // when the CDN passes that on as `Server-Timing: agent;desc="chatgpt-agent"` (install.md §8).
  agentUa: /claude-agent|google-agent|manus-user/i,
  agentSigned: { 'https://chatgpt.com': 'chatgpt-agent', 'https://muse.ai': 'meta-agent', 'https://www.meta.com': 'meta-agent' },
  agents: ['chatgpt-agent', 'claude-agent', 'google-agent', 'manus-user', 'meta-agent'],
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

/**
 * The referrer host the rules see. In-app referrers (android-app://<package>/) become the app's
 * site (SIGNALS.apps); an unknown package is not a host (com.google.android.apps.x would read as
 * google.* = search), so it becomes '' and the view counts as `direct`, as in optel-client.js.
 */
export function refHostOf(url) {
  if (!url) return '';
  const app = /^android-app:\/\/([^/]+)/i.exec(url);
  if (app) {
    const pkg = app[1].toLowerCase();
    if (SIGNALS.apps[pkg]) return SIGNALS.apps[pkg];
    return /\.[a-z]{2,}$/.test(pkg) && !/^(com|org|net|io)\./.test(pkg) ? pkg : '';
  }
  try { return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, ''); } catch (e) { return ''; }
}

/* same site: the host itself or a sibling under the same base
   (login.example.com, shop.example.com) */
function sameSite(host, siteHost) {
  const base = (h) => h.split('.').slice(-2).join('.');
  return !!host && !!siteHost && (host === siteHost || base(host) === base(siteHost));
}

/**
 * direct | internal | search | social | ai | other
 * AI after https://attribution.now/reclaim-direct-traffic: an AI referrer or utm_source counts,
 * but a search referrer wins (Google results linking a chatgpt.com-tagged URL are organic search)
 * and an ad click (`paid`, e.g. ChatGPT ads `['openai']`) is paid, not an AI citation.
 */
export function sourceOf(refHost, siteHost, utm = {}, paid = []) {
  const host = SIGNALS.apps[refHost] || (/^(com|org|net|io)\.[^.]+\./.test(refHost) ? '' : refHost);
  const ai = !paid.length && (SIGNALS.aiUtm.test(utm.source || '') || SIGNALS.ai.test(host));
  if (host && SIGNALS.search.test(host)) return 'search';
  if (ai) return 'ai';
  if (!host) return 'direct';
  if (sameSite(host, siteHost)) return 'internal';
  if (SIGNALS.social.test(host)) return 'social';
  return 'other';
}

/**
 * The personal AI agent behind this view, or null. `hint` is what the CDN passed on:
 * an agent name, or the raw Signature-Agent value ('"https://chatgpt.com"').
 */
export function agentOf(ua = '', hint = '') {
  const h = String(hint || '').replace(/"/g, '').trim().toLowerCase();
  const m = SIGNALS.agentUa.exec(ua || '');
  return (m && m[0].toLowerCase()) || SIGNALS.agentSigned[h] || (SIGNALS.agents.includes(h) ? h : null);
}

/**
 * The intent named by a text (campaign tags, a path),
 * from rules.intents: [[id, regex], ...] in priority order.
 */
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
 *   utm: { source, medium, campaign, content, term, any }
 *        regex strings (case-insensitive); any = campaign|content|term
 *   paid: true | false | ['google', 'facebook', ...]
 *   device: 'mobile' | 'desktop'
 *   agent: true | ['chatgpt-agent', ...]  a personal AI agent is browsing (any, or one of)
 *   signedIn: true | false            on-device memory: this browser clicked sign-in before
 *   visits: { min, max }              on-device memory: visits including this one
 *   interest: true | ['pricing', ...] on-device memory: top interest exists / is one of
 *   intent: ['pricing', ...]          intent named by the campaign tags (or the top interest)
 *   any: [when, when, ...]            at least one nested clause holds
 */
function paidMatches(v, s) {
  if (v === true) return s.paid.length > 0;
  if (v === false) return !s.paid.length;
  return arr(v).some((n) => s.paid.includes(n));
}

export function matches(when, s, rules = {}) {
  return Object.entries(when || {}).every(([k, v]) => {
    switch (k) {
      case 'source': return arr(v).includes(s.source);
      case 'referrer': return arr(v).some((h) => s.refHost === h || s.refHost.endsWith(`.${h}`));
      case 'utm': return Object.entries(v).every(([f, re]) => (f === 'any'
        ? rx(re).test(`${s.utm.campaign} ${s.utm.content} ${s.utm.term}`)
        : rx(re).test(s.utm[f] || '')));
      case 'paid': return paidMatches(v, s);
      case 'device': return s.device === v;
      case 'agent': return v === true ? !!s.agent : v === false ? !s.agent : arr(v).includes(s.agent);
      case 'signedIn': return !!s.memory.signedIn === v;
      case 'visits': return (s.memory.visits || 0) >= (v.min ?? 0) && (s.memory.visits || 0) <= (v.max ?? Infinity);
      case 'interest': { const t = topInterest(s.memory); return v === true ? !!t : arr(v).includes(t); }
      case 'intent': return arr(v).includes(intentFrom(rules, `${s.utm.campaign} ${s.utm.content} ${s.utm.term}`) || topInterest(s.memory));
      case 'any': return arr(v).some((w) => matches(w, s, rules));
      default: return false; // unknown condition: never match silently
    }
  });
}

/** The rule's intent: from the campaign tags, from visit memory, or tags first then memory. */
function intentOf(rules, r, s) {
  const fromUtm = intentFrom(rules, `${s.utm.campaign} ${s.utm.content} ${s.utm.term}`);
  if (r.intent === false) return null;
  if (r.intent === 'utm') return fromUtm;
  if (r.intent === 'memory') return topInterest(s.memory);
  return fromUtm || topInterest(s.memory);
}

/**
 * First rule that matches wins. Bots never match (they always get the original sections).
 * A personal AI agent only matches rules that ask for one (`when.agent`): the rules written
 * for people never fire for an agent, so their numbers stay human.
 * @returns {{ rule: string|null, experience: string, intent: string|null,
 *   keys: string[], label: string }}
 */
export function matchRule(rules, s) {
  const pool = (rules.rules || []).filter((x) => !s.agent || (x.when && x.when.agent));
  const r = s.bot && !s.agent ? null : pool.find((x) => matches(x.when, s, rules));
  if (!r) {
    return {
      rule: null, experience: 'default', intent: null, keys: ['default'], label: 'no rule matched',
    };
  }
  const intent = intentOf(rules, r, s);
  const keys = [...new Set([intent && `${r.experience}:${intent}`, r.experience, 'default'].filter(Boolean))];
  return {
    rule: r.id, experience: r.experience, intent, keys, label: r.label || r.id,
  };
}

/* ---------- browser: signals, memory, apply ---------- */

/**
 * With `memory.requireConsent`, memory is read and written only after the experimentation
 * plugin recorded consent (localStorage `experimentation-consented`).
 */
export function memoryAllowed(rules) {
  if (!rules.memory?.requireConsent) return true;
  try {
    return localStorage.getItem('experimentation-consented') === 'true';
  } catch (e) {
    return false;
  }
}

const storeKey = (rules) => rules.memory?.storeKey || 'cohorts-v1';

export function readMemory(rules) {
  if (!memoryAllowed(rules)) return {};
  try {
    return JSON.parse(localStorage.getItem(storeKey(rules))) || {};
  } catch (e) {
    return {};
  }
}

function writeMemory(rules, v) {
  try {
    localStorage.setItem(storeKey(rules), JSON.stringify(v));
  } catch (e) { /* storage blocked */ }
}

/** What the CDN said about the request: the `agent` entry of the page's Server-Timing header. */
function agentHint() {
  try {
    const [nav] = performance.getEntriesByType('navigation');
    return ((nav && nav.serverTiming) || []).find((t) => t.name === 'agent')?.description || '';
  } catch (e) {
    return '';
  }
}

/**
 * Signals for a URL, a referrer and a memory: the engine's whole view of a visitor.
 * Demo/simulation overrides in the URL: `ref` stands in for the referrer (a host or a full
 * referrer), `agent=<name>` for a personal AI agent.
 */
export function signalsFor(rules, href, referrer = '', memory = {}) {
  const u = new URL(href);
  const q = u.searchParams;
  const utm = Object.fromEntries(UTM.map((k) => [k, (q.get(`utm_${k}`) || '').toLowerCase()]));
  // ?ref= takes a host (portal.example.com) or a full referrer (android-app://com.facebook.katana/)
  let ref = q.get('ref') || referrer;
  if (ref && !ref.includes('://')) ref = `https://${ref}/`;
  const refHost = refHostOf(ref);
  const siteHost = u.hostname.replace(/^www\./, '');
  const paid = [...new Set(Object.entries(SIGNALS.paidParams)
    .filter(([p]) => q.has(p))
    .map(([, n]) => n))];
  const ua = navigator.userAgent;
  // the CDN's hint describes this page's request, not a URL previewed in the demo panel
  const here = typeof window !== 'undefined' && href === window.location.href;
  const agent = agentOf(ua, q.get('agent') || (here ? agentHint() : ''));
  const mobile = (navigator.userAgentData && navigator.userAgentData.mobile)
    || SIGNALS.mobileUa.test(ua) || window.matchMedia('(max-width: 599px)').matches;
  return {
    refHost,
    source: sourceOf(refHost, siteHost, utm, paid),
    utm,
    paid,
    device: mobile ? 'mobile' : 'desktop',
    agent,
    // an agent's browser is automated too; it is an agent first
    bot: !agent && (SIGNALS.bot.test(ua) || navigator.webdriver === true),
    memory,
    path: u.pathname,
  };
}

/** Signals for this view (see signalsFor for the ?ref= and ?agent= overrides). */
export function browserSignals(rules) {
  return signalsFor(rules, window.location.href, document.referrer, readMemory(rules));
}

/** Resolve this view's rule. ?cohort=<rule id> forces a rule (demo and screenshots). */
export function resolve(rules, signals = browserSignals(rules)) {
  const forced = new URLSearchParams(window.location.search).get('cohort');
  const r = forced && (rules.rules || []).find((x) => x.id === forced);
  const ctx = r
    ? {
      ...matchRule({ ...rules, rules: [{ ...r, when: {} }] }, { ...signals, bot: false }),
      forced: true,
    }
    : matchRule(rules, signals);
  return { ...ctx, signals };
}

/**
 * Prune and reorder decorated sections for the matched keys (most specific first).
 * Section Metadata on the cohort page:
 *   Slot: hero        one section per slot survives: the first whose
 *                     Cohorts list has the most specific key
 *   Cohorts: a, b:x   section only for these experiences (default = the original page's sections)
 *   Hide For: a       section removed for these experiences
 *   Promote: a        section moved right under the first section for these experiences
 * Must run after decorateMain() and before the first loadSection().
 */
export function apply(main, keys) {
  const own = keys.length === 1 ? keys : keys.filter((k) => k !== 'default');
  const sections = [...main.querySelectorAll(':scope > .section')];
  const slots = {};
  sections.forEach((s) => {
    const { slot } = s.dataset;
    if (slot) (slots[slot] = slots[slot] || []).push(s);
  });
  Object.values(slots).forEach((group) => {
    let winner;
    keys.some((k) => { winner = group.find((s) => list(s.dataset.cohorts || 'default').includes(k)); return winner; });
    group.forEach((s) => { if (s !== winner) s.remove(); });
    // Hide For on the winner leaves the slot empty for that experience
    if (winner && list(winner.dataset.hideFor).some((c) => own.includes(c))) winner.remove();
  });
  sections.forEach((s) => {
    if (!s.isConnected || s.dataset.slot) return;
    const only = list(s.dataset.cohorts);
    const hide = list(s.dataset.hideFor);
    const mine = (c) => own.includes(c);
    if ((only.length && !only.some(mine)) || hide.some(mine)) s.remove();
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
export function runCohorts(main, rules, { sampleRUM, getMetadata, force } = {}) {
  const exp = rules.experiment || 'homepage-cohorts';
  const { body } = document;
  const inExperiment = body.classList.contains(`experiment-${exp}`);
  const poc = getMetadata && getMetadata('cohorts') === 'on';
  if (!inExperiment && !poc) return null;
  const arm = inExperiment ? (body.dataset.variant || 'control') : 'poc';
  let ctx;
  try {
    // force = { rule, experience, intent, keys }: an editor preview showing a picked variation
    ctx = force
      ? {
        rule: force.rule || null,
        experience: force.experience,
        intent: force.intent || null,
        keys: force.keys,
        label: force.label || '',
        forced: true,
      }
      : resolve(rules);
    apply(main, arm === 'control' && !force ? ['default'] : ctx.keys);
  } catch (e) {
    // never show every variant at once: fall back to the original sections
    apply(main, ['default']);
    ctx = {
      rule: null, experience: 'default', keys: ['default'], error: String(e),
    };
  }
  ctx.arm = arm;
  body.dataset.cohort = ctx.rule || 'none';
  body.dataset.experience = arm === 'control' && !force ? 'default' : ctx.experience;
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

/**
 * Mark this browser as signed in once it clicks a sign-in control
 * (rules.memory.signIn: CSS selector).
 */
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
