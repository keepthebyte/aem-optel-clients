/*
 * Cohorts panel model: what each section of a cohort page is, who sees it, and what is wrong
 * with its metadata. Pure functions over plain data, so they run in Node tests; the only DOM
 * code is parsePage(), which takes a parsed Document.
 *
 * A page reaches the panel in one of three shapes, all handled by parsePage():
 *   - the live editor document (SDK subscribeLiveDocument): <main> with one <div> per section
 *     and blocks as <div class="name">, section metadata as <div class="section-metadata">
 *   - the same as DA tables: a block is a <table> whose first cell is its name
 *   - the published .plain.html: section metadata already turned into data-* attributes
 */

/** Section Metadata keys the engine reads (scripts/cohorts.js apply()) */
export const COHORT_KEYS = ['slot', 'cohorts', 'hideFor', 'promote'];

/* keys an author plausibly means as one of those, which the engine ignores */
const NEAR_MISS = new Set(['cohort', 'audience', 'audiences', 'experience', 'experiences', 'hide', 'hidden for',
  'hide from', 'hide for cohorts', 'show for', 'show to', 'only for', 'promoted', 'promote for', 'slots']);

/* tables Experience Workspace does not count as blocks (getBlockPositions' NON_BLOCK_TABLE_NAMES):
   selection.blockIndex skips them, so the section lookup must too */
const NON_BLOCK = new Set(['metadata', 'section metadata']);

export const normName = (s) => String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  .replace(/\s*\(.*\)\s*$/, '');

/** "Hide For" / "hide-for" / "hide_for" → "hideFor" (aem.js toCamelCase of toClassName) */
export const camelKey = (s) => normName(s).replace(/ ([a-z0-9])/g, (_, c) => c.toUpperCase());

export const list = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

/** Block name and variants from a block element: <div class="promo poster"> or a table. */
function blockOf(el) {
  if (el.tagName === 'TABLE') {
    const head = text(el.querySelector('td, th'));
    const m = /^([^(]+)(?:\(([^)]*)\))?/.exec(head) || [];
    return { name: normName(m[1]), variants: list(m[2]).map((v) => v.replace(/\s+/g, '-')) };
  }
  const [name, ...variants] = [...el.classList];
  return { name: normName(name), variants };
}

/** Rows of a metadata block (div or table form) as { camelKey: value }, plus the raw keys. */
function rowsOf(el) {
  const rows = el.tagName === 'TABLE' ? [...el.querySelectorAll('tr')].slice(1) : [...el.children];
  const out = {}; const raw = [];
  rows.forEach((r) => {
    const [k, v] = [...r.children];
    if (!k) return;
    raw.push(text(k));
    out[camelKey(text(k))] = text(v);
  });
  return { values: out, raw };
}

/**
 * The page as sections: [{ i, blocks: [{ name, variants }], heading, meta: { slot, cohorts,
 * hideFor, promote, style }, rawKeys, blockCount }], plus page metadata ({ cohorts, robots, ... }).
 */
export function parsePage(doc) {
  const main = doc.querySelector('main') || doc.body;
  let sectionEls = [...main.children].filter((c) => c.tagName === 'DIV');
  // the editor's table form has no section wrappers: split the flow at <hr>
  if (!sectionEls.length || main.querySelector(':scope > hr, :scope > table')) {
    sectionEls = [];
    let cur = doc.createElement('div');
    [...main.childNodes].forEach((n) => {
      if (n.nodeName === 'HR') { sectionEls.push(cur); cur = doc.createElement('div'); } else cur.append(n.cloneNode(true));
    });
    sectionEls.push(cur);
  }
  const page = {};
  const sections = sectionEls.map((s, i) => {
    const blocks = []; let meta = {}; let rawKeys = [];
    [...s.children].forEach((c) => {
      const isBlock = c.tagName === 'TABLE' || (c.tagName === 'DIV' && c.classList.length);
      if (!isBlock) return;
      const b = blockOf(c);
      if (b.name === 'section metadata') {
        const r = rowsOf(c); meta = { ...meta, ...r.values }; rawKeys = rawKeys.concat(r.raw);
      } else if (b.name === 'metadata') {
        Object.assign(page, rowsOf(c).values);
      } else blocks.push(b);
    });
    // published .plain.html: the pipeline already moved section metadata to data-*
    Object.entries(s.dataset || {}).forEach(([k, v]) => { if (meta[k] == null) meta[k] = v; });
    // heading and text come from the content, never from a metadata block in the section
    const content = s.cloneNode(true);
    [...content.children].filter((c) => ['metadata', 'section metadata'].includes(blockOf(c).name)
      && (c.tagName === 'TABLE' || c.classList.length)).forEach((c) => c.remove());
    const h = content.querySelector('h1, h2, h3, h4');
    // icons are :name: in the editor and <span class="icon"> once published
    const firstText = text([...content.querySelectorAll('p, li')].find((p) => text(p).length > 3))
      .replace(/:[a-z0-9-]+:/g, '').trim();
    return {
      i, blocks, title: text(h), heading: text(h) || firstText.slice(0, 90), meta, rawKeys,
    };
  });
  return { page, sections };
}

/** Section index for the SDK's selection.blockIndex (blocks counted in document order). */
export function sectionOfBlock(sections, blockIndex) {
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return null;
  let n = 0;
  return sections.find((s) => {
    n += s.blocks.filter((b) => !NON_BLOCK.has(b.name)).length;
    return blockIndex < n;
  })?.i ?? null;
}

/** "promo (poster)" */
export const blockLabel = (b) => (b ? `${b.name}${b.variants.length ? ` (${b.variants.join(', ')})` : ''}` : '');

/** Short label of a section for lists: its main block and heading. */
export function sectionLabel(s) {
  const main = s.blocks[0];
  let what = 'text';
  if (main) what = blockLabel(main);
  else if (s.meta.style) what = `text · ${s.meta.style}`;
  return { what, heading: s.heading || '' };
}

/**
 * Every experience a visitor can get, from the rules and the keys the page uses:
 * [{ id: 'switcher:iphone', experience: 'switcher', intent: 'iphone', keys: [...], label,
 *    rules: [ids], share }]
 * `keys` is what the engine's apply() is called with for that visitor.
 */
export function experiencesOf(rules, sections, cohortsJson) {
  const exps = rules.experiences || {};
  const used = new Set();
  sections.forEach((s) => ['cohorts', 'hideFor', 'promote'].forEach((k) => list(s.meta[k]).forEach((c) => used.add(c))));
  const share = (ids) => {
    const rows = (cohortsJson?.rules || []).filter((r) => ids.includes(r.id));
    return rows.length ? rows.reduce((a, r) => a + (r.share || 0), 0) : null;
  };
  const rulesFor = (id) => (rules.rules || []).filter((r) => r.experience === id).map((r) => r.id);
  const out = [{
    id: 'default', experience: 'default', intent: null, keys: ['default'], label: 'Everyone else', sub: 'The original homepage', rules: ['none'], share: share(['none']),
  }];
  Object.entries(exps).forEach(([id, e]) => {
    const ids = rulesFor(id);
    out.push({
      id, experience: id, intent: null, keys: [id, 'default'], label: e.label || id, sub: e.sub || '', rules: ids, share: share(ids),
    });
    [...used].filter((k) => k.startsWith(`${id}:`)).sort().forEach((k) => {
      const intent = k.slice(id.length + 1);
      out.push({
        id: k, experience: id, intent, keys: [k, id, 'default'], label: `${(e.label || id).split(':')[0]} · ${intent}`, sub: `Interest "${intent}" from campaign tags or pages visited`, rules: ids, share: null,
      });
    });
  });
  return out;
}

/**
 * Who sees a section, given the order the engine produced for each experience:
 * { shown: [expIds], hidden: [expIds], promoted: [expIds] }
 */
export function audienceOf(i, views) {
  const shown = []; const hidden = []; const promoted = [];
  views.forEach((v) => {
    const pos = v.order.indexOf(i);
    if (pos < 0) hidden.push(v.id); else shown.push(v.id);
    if (pos >= 0 && v.promoted.includes(i)) promoted.push(v.id);
  });
  return { shown, hidden, promoted };
}

/**
 * Metadata mistakes the canvas does not show. Each: { level: 'error'|'warn', section, text }.
 * `known` = experience ids, `intents` = intent ids from the rules.
 */
export function lint({ page, sections }, rules) {
  const out = [];
  const known = new Set(['default', ...Object.keys(rules.experiences || {})]);
  const intents = new Set((rules.intents || []).map(([id]) => id));
  const add = (level, section, t) => out.push({ level, section, text: t });
  const on = String(page.cohorts || '').toLowerCase() === 'on' || page.experiment;
  const usesCohorts = sections.some((s) => COHORT_KEYS.some((k) => s.meta[k]));
  if (usesCohorts && !on) {
    add('warn', null, 'Sections carry cohort metadata, but the page has neither "Cohorts: on" nor experiment metadata: visitors get every section.');
  }
  sections.forEach((s) => {
    s.rawKeys.forEach((k) => {
      if (NEAR_MISS.has(normName(k))) {
        add('error', s.i, `"${k}" is not a key the engine reads, so it does nothing. Use Cohorts, Hide For, Promote or Slot.`);
      }
    });
    ['cohorts', 'hideFor', 'promote'].forEach((k) => list(s.meta[k]).forEach((c) => {
      const [exp, intent] = c.split(':');
      if (!known.has(exp)) {
        add('error', s.i, `"${c}" in ${k === 'hideFor' ? 'Hide For' : k[0].toUpperCase() + k.slice(1)} is not an experience (${[...known].join(', ')}). Nobody matches it.`);
      } else if (intent && intents.size && !intents.has(intent)) {
        add('error', s.i, `"${c}": "${intent}" is not an interest in the rules (${[...intents].join(', ')}).`);
      }
    }));
    if (s.meta.promote && s.meta.slot) add('warn', s.i, 'Promote has no effect on a section in a slot: the slot decides its place.');
  });
  const slots = {};
  sections.forEach((s) => {
    const slot = (s.meta.slot || '').toLowerCase();
    if (slot) (slots[slot] = slots[slot] || []).push(s);
  });
  Object.entries(slots).forEach(([slot, group]) => {
    const defaults = group.filter((s) => !s.meta.cohorts || list(s.meta.cohorts).includes('default'));
    if (!defaults.length) add('error', group[0].i, `Slot "${slot}" has no default section: everyone else sees nothing there, and the page no longer matches the homepage.`);
    if (defaults.length > 1) add('warn', defaults[1].i, `Slot "${slot}" has ${defaults.length} default sections: only the first is shown.`);
    const seen = new Map();
    group.forEach((s) => list(s.meta.cohorts).forEach((c) => {
      if (seen.has(c) && c !== 'default') add('warn', s.i, `Slot "${slot}": "${c}" already wins with section ${seen.get(c) + 1}; this one is never shown to it.`);
      else seen.set(c, s.i);
    }));
  });
  return out;
}

/**
 * The holdout check (homepage-cohorts verify.js, in the panel): the default view of the cohort
 * page must be the original page, section for section. `original` and `defaultView` are lists
 * of section signatures (block names + heading).
 */
export function holdout(originalSections, defaultOrder, sections) {
  // block names and real headings: body text differs between editor and published markup
  const sig = (s) => `${s.blocks.map(blockLabel).join('+')}|${s.title ?? s.heading}`;
  const orig = originalSections.filter((s) => s.blocks.length || s.heading).map(sig);
  const mine = defaultOrder.map((i) => sections[i])
    .filter((s) => s.blocks.length || s.heading).map(sig);
  const n = Math.max(orig.length, mine.length);
  for (let k = 0; k < n; k += 1) {
    if (orig[k] !== mine[k]) {
      return {
        ok: false, at: k, expected: orig[k] || '(nothing)', got: mine[k] || '(nothing)', count: orig.length,
      };
    }
  }
  return { ok: true, count: orig.length };
}

/** Preview URL for an experience: the first rule that leads to it, forced with ?cohort= */
export function previewUrl(origin, path, exp, rules) {
  // everyone else gets the original page: that is the homepage itself, not a forced rule
  if (exp.id === 'default') return new URL('/', origin).toString();
  const u = new URL(path || '/', origin);
  {
    const r = (rules.rules || []).find((x) => x.experience === exp.experience && (!exp.intent || x.intent === 'utm')) || (rules.rules || []).find((x) => x.experience === exp.experience);
    if (r) u.searchParams.set('cohort', r.id);
    if (exp.intent) u.searchParams.set('utm_campaign', exp.intent);
  }
  u.searchParams.set('demo', '');
  return u.toString().replace(/demo=$/, 'demo').replace(/demo=&/, 'demo&');
}

/* ---------- plain-language names ---------- */

const INTENT_NAMES = { iphone: 'iPhone', 'home-internet': 'Home internet', switch: 'Switching' };

/** 'home-internet' → 'Home internet', 'iphone' → 'iPhone'. */
export function intentName(id) {
  if (!id) return 'No interest known';
  return INTENT_NAMES[id] || `${id[0].toUpperCase()}${id.slice(1).replace(/-/g, ' ')}`;
}

/** Short name of a variation key: 'default' → 'Everyone else', 'switcher' → 'Prospect',
 * 'switcher:iphone' → 'Prospect · iPhone' (the part of the label before ':'). */
export function shortName(rules, key) {
  const [exp, intent] = String(key || '').split(':');
  if (exp === 'default') return 'Everyone else';
  const label = rules.experiences?.[exp]?.label || exp;
  const base = label.split(':')[0].trim();
  return intent ? `${base} · ${intentName(intent)}` : base;
}

/** Where a variation's interest comes from, given its rules:
 * { utm: [rule labels], memory: [rule labels] } (a rule with no `intent` reads both). */
export function interestSources(rules, experience) {
  const out = { utm: [], memory: [] };
  const own = (rules.rules || []).filter((r) => r.experience === experience && r.intent !== false);
  own.forEach((r) => {
    const label = r.label || r.id;
    if (r.intent !== 'memory') out.utm.push(label);
    if (r.intent !== 'utm') out.memory.push(label);
  });
  return out;
}

/** What an interest variant changes against its parent: { added: [i], removed: [i] }. */
export function variantDiff(parentOrder, order) {
  return {
    added: order.filter((i) => !parentOrder.includes(i)),
    removed: parentOrder.filter((i) => !order.includes(i)),
  };
}

/** A Cohorts / Hide For list in words, grouped by variation:
 * 'switcher:iphone, switcher, mobile' → 'Prospect (iPhone or no interest), Mobile'. */
export function audienceText(rules, keys) {
  const groups = new Map();
  keys.forEach((k) => {
    const [exp, intent] = k.split(':');
    if (!groups.has(exp)) groups.set(exp, { base: false, intents: [] });
    if (intent) groups.get(exp).intents.push(intentName(intent)); else groups.get(exp).base = true;
  });
  return [...groups].map(([exp, g]) => {
    const name = shortName(rules, exp);
    if (!g.intents.length) return name;
    const ints = g.intents.join(', ');
    return g.base ? `${name} (${ints} or no interest)` : `${name} · ${ints}`;
  }).join(', ');
}
