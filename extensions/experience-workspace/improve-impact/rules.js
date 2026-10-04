/**
 * Content owner insights: rules, ranking, rendering and session logging.
 *
 * Input is a payload per page (fixtures/*.json, or the adapter over the
 * Optel analyzer in ../shared/analyze.js, which reads the bundles through
 * the aem-optel-clients module). Rules turn metrics into tiers
 * by who can act: the author (action queue), another team (talking points),
 * nobody right now (context). Counted and modeled numbers never share a
 * scale: modeled ones carry their methodology version.
 */

/* ---------- formatting ---------- */
export const fmtNum = (x) => {
  if (x == null || Number.isNaN(x)) return '–';
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e4) return `${(x / 1e3).toFixed(0)}K`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return Math.round(x).toLocaleString('en-US');
};
export const fmtPct = (x, d = 0) => {
  if (x == null) return '–';
  return x > 0 && x < 0.01 ? '<1%' : `${(x * 100).toFixed(d)}%`;
};
export const fmtMs = (ms) => {
  if (ms == null) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
};
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const langName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(String(code).split(/[-_]/)[0]) || code; } catch { return code; } };
const primary = (code) => String(code || '').toLowerCase().split(/[-_]/)[0];
/* Group browser languages by language, ignoring region (en-US, en, en-GB are one group).
   Returns [{ lang, name, views, share, variants }] sorted by views. */
export function groupLanguages(entries, sampled) {
  const groups = {};
  (entries || []).forEach((x) => {
    const code = x.key ?? x.code ?? x.lang; const views = x.views ?? 0; const lang = primary(code);
    if (!lang) return;
    const g = groups[lang] || (groups[lang] = { lang, name: langName(lang), views: 0, variants: [] });
    g.views += views; if (!g.variants.includes(code)) g.variants.push(code);
  });
  return Object.values(groups)
    .map((g) => ({ ...g, share: sampled ? g.views / sampled : (g.share ?? 0) }))
    .sort((a, b) => b.views - a.views);
}
const ratio = (a, b) => (b > 0 ? a / b : null);

/* Visitor cohorts the payload can tell apart: where they came from, what they are on. */
export function cohorts(p) {
  const m = p.metrics || {}; const c = {};
  if (m.paidOrSocialShare >= 0.5) c.ads = { label: `ad and social visitors, ${fmtPct(m.paidOrSocialShare)} of views`, share: m.paidOrSocialShare };
  if (m.mobileShare >= 0.6) c.phone = { label: `phone visitors, ${fmtPct(m.mobileShare)} of views`, share: m.mobileShare };
  return c;
}
/* what the dead taps land on: the fixture names blocks, live telemetry names what was tapped */
export function deadTapLabels(p) {
  const named = (p.deadTapBlocks || []).map((id) => (p.blocks || []).find((b) => b.id === id)?.label).filter(Boolean);
  return named.length ? named : (p.deadTapLabels || []);
}
export const pageUrl = (p) => p.page?.url || p.page?.path || '';
/* The page's own next step, named from what visitors already follow most; a generic
   phrase when the payload does not know. */
const nextStep = (p) => (p.metrics?.topLink?.label ? `the link visitors follow most (${p.metrics.topLink.label})` : 'the action the page exists for');

/* ---------- rules ----------
   Each rule reads the payload and returns nothing, or a finding for one tier.
   Action-queue items carry impact (share of views affected, 0..1) and effort
   (1 copy or relink, 2 layout change, 3 an in-tool workflow). Ranking is
   cheapest effort first, then biggest impact within the same effort: what an
   author can do in the next five minutes comes before what needs a layout
   rethink or another team's workflow. A provisional rule, see README. */
export function deriveFindings(p) {
  const m = p.metrics || {};
  const actions = []; const talking = []; const context = []; const redesigns = []; let working = null;
  const touched = 1 - (m.noTouchShare ?? 1);
  const coh = cohorts(p);
  const where = deadTapLabels(p);
  const next = nextStep(p);

  /* dead taps: cheap to fix, hits everyone who tries to interact */
  if (m.deadTapShare != null && touched > 0 && m.deadTapShare >= 0.3) {
    actions.push({
      id: 'dead-taps',
      tier: 'action',
      kind: 'tap',
      stat: fmtPct(m.deadTapShare),
      lead: 'dead taps',
      meaning: `Of the ${fmtPct(touched, 1)} of views that touch the content, this many tap something that opens nothing`,
      impact: touched * m.deadTapShare,
      effort: 1,
      cohort: `visitors who tap, ${fmtPct(touched, 1)} of views`,
      title: `${fmtPct(m.deadTapShare)} of taps on the content land on nothing`,
      number: `${fmtPct(m.deadTapShare)} of ${fmtPct(touched, 1)} of views that touch the page`,
      body: `${where.length ? `People tap ${list(where)} expecting them to open.` : 'People tap images and headings expecting them to open.'} A tap is intent to learn more, so answer it: link each one to the block further down this page that says more (an anchor, no need to leave the page), or to where the page wants them to go next, and make anything that stays static look static.`,
      blocks: p.deadTapBlocks || [],
    });
  }
  /* reach cliff: layout change */
  if (m.reach?.from && m.reach?.to && m.reach.from.share - m.reach.to.share >= 0.3) {
    actions.push({
      id: 'reach-cliff',
      tier: 'action',
      kind: 'reach',
      stat: `${fmtPct(m.reach.from.share)}\u2192${fmtPct(m.reach.to.share)}`,
      lead: 'reach drop',
      meaning: `Views that see the ${m.reach.from.label}, then ${m.reach.to.label}`,
      impact: m.reach.from.share - m.reach.to.share,
      effort: 2,
      cohort: coh.phone ? coh.phone.label : 'everyone who scrolls',
      title: `Reach falls from ${fmtPct(m.reach.from.share)} to ${fmtPct(m.reach.to.share)} after the ${m.reach.from.label}`,
      number: `${fmtPct(m.reach.from.share)} see the ${m.reach.from.label}, ${fmtPct(m.reach.to.share)} see ${m.reach.to.label}`,
      body: `Almost everyone stops at the ${m.reach.from.label}. Move the block they must see (the one with ${next}) right under it, or shorten the ${m.reach.from.label} so that block starts on the first screen. Both are moves of blocks already on the page.`,
      blocks: ['hero'],
    });
  }
  /* no-touch bounce: a first-screen problem, the author's to fix */
  if (m.noTouchShare != null && m.noTouchShare >= 0.7) {
    actions.push({
      id: 'no-touch',
      tier: 'action',
      kind: 'bounce',
      stat: fmtPct(m.noTouchShare),
      lead: 'never touch',
      meaning: `Views that leave without touching the content, ${fmtNum(m.views * m.noTouchShare)} of ${fmtNum(m.views)}`,
      impact: m.noTouchShare,
      effort: 2,
      cohort: coh.ads ? coh.ads.label : 'everyone landing here',
      title: `${fmtPct(m.noTouchShare)} of views never touch the content`,
      number: `${fmtNum(m.views * m.noTouchShare)} of ${fmtNum(m.views)} views`,
      body: m.paidOrSocialShare >= 0.7 ? `Most arrive from an ad or a feed and leave from the first screen. Rewrite the hero heading to repeat the ad’s promise word for word, and add one button under it: ${next}, or an anchor to the block that says more.` : `The first screen is being seen, not used. Add one clear next step under the hero heading: a button to ${next}.`,
      blocks: ['hero'],
    });
  }
  /* language mismatch: an in-tool workflow. Languages are grouped ignoring region, and a
     group has to reach 4% of views on its own; a scatter of small locales is not an action. */
  const pageLang = primary(p.page?.language);
  const langGroups = (m.language?.groups || []).filter((g) => primary(g.lang) !== pageLang);
  const wanted = langGroups.filter((g) => (g.share ?? 0) >= 0.04);
  if (wanted.length) {
    const top = wanted[0]; const names = wanted.map((g) => g.name || langName(g.lang));
    const share = wanted.reduce((acc, g) => acc + g.share, 0);
    actions.push({
      id: 'translation',
      tier: 'action',
      kind: 'translate',
      stat: fmtPct(top.share, top.share < 0.1 ? 1 : 0),
      lead: `${top.name || langName(top.lang)} readers`,
      meaning: `Visitors whose browser asked for ${list(names)} first, all regional variants together; the page is in ${p.page?.language || 'its own language'}`,
      impact: share,
      effort: 3,
      cohort: `${list(names)} readers, ${fmtPct(share, share < 0.1 ? 1 : 0)} of views`,
      workflow: 'translate',
      title: `${fmtPct(top.share, top.share < 0.1 ? 1 : 0)} of visitors read in ${list(names)}, the page is in ${p.page?.language || 'its own language'}`,
      number: `${fmtNum(m.views * share)} views this window`,
      body: 'Their browser asked for another language first. Request a translation and link it from the top of this page.',
      languages: names,
    });
  }

  /* redesigns: the content fixes above work with the blocks the page has; these need the
     blocks themselves to change, which Experience Workspace cannot do yet. Each carries a
     brief for the Stardust redesign skill (stardustBrief). */
  const cliff = m.reach?.from && m.reach?.to && m.reach.from.share - m.reach.to.share >= 0.3 ? m.reach : null;
  if ((m.noTouchShare ?? 0) >= 0.7 || cliff) {
    const goals = [];
    if (m.paidOrSocialShare >= 0.5) goals.push('Carry the promise of the ad or post that brought people here: the first screen restates it and offers one next step, so an ad visitor knows in a glance they landed in the right place.');
    if (m.mobileShare >= 0.6) goals.push('Design for a phone first: on a 390 by 844 screen the offer, the promise and the one action are all visible without scrolling.');
    if (cliff) goals.push(`Make the page continue: the block after the ${cliff.from.label} starts on the first screen, so the ${cliff.from.label} no longer reads as the whole page.`);
    if (m.consent?.dismissShareOfClicks >= 0.5) goals.push('The cookie dialog covers the bottom of the first screen on arrival; keep the action above where it sits.');
    if (m.tapRate?.search >= 0.1) goals.push(`Keep what works for search visitors (${fmtPct(m.tapRate.search)} of them tap in): ${next} stays one tap away.`);
    const measures = [];
    if (m.tapRate?.ads != null) measures.push(`Ad and social visitors who tap into the content, ${fmtPct(m.tapRate.ads, 1)} today`);
    else if (m.noTouchShare != null) measures.push(`Views that touch the content, ${fmtPct(1 - m.noTouchShare, 1)} today`);
    if (cliff) measures.push(`Views that reach ${cliff.to.label}, ${fmtPct(cliff.to.share)} today`);
    redesigns.push({
      id: 'redesign-hero',
      tier: 'redesign',
      kind: 'design',
      area: 'hero and first screen',
      stat: fmtPct(m.noTouchShare ?? (cliff.from.share - cliff.to.share)),
      lead: m.noTouchShare != null ? 'never touch' : 'reach drop',
      meaning: 'The first screen is where almost every visit ends; rewording it helps, a first screen built for how people arrive helps more',
      cohorts: [coh.ads?.label, coh.phone?.label].filter(Boolean),
      body: `Redesign the hero as a first screen for ${coh.ads ? 'someone arriving from an ad' : 'a first-time visitor'}${coh.phone ? ' on a phone' : ''}: the promise, the offer and one action, with the next block in view.`,
      goals,
      measures,
    });
  }
  /* the hero brief already owns the first screen; this one covers the rest of the dead taps */
  const cards = redesigns.length ? where.filter((x) => !/hero/i.test(x)) : where;
  if (m.deadTapShare >= 0.5 && cards.length) {
    redesigns.push({
      id: 'redesign-affordance',
      tier: 'redesign',
      kind: 'design',
      area: list(cards.slice(0, 2)),
      stat: fmtPct(m.deadTapShare),
      lead: 'dead taps',
      meaning: `${list(cards)} look tappable and are not; links fix the dead ends, a design that shows what opens fixes the expectation`,
      cohorts: [`visitors who tap, ${fmtPct(touched, 1)} of views`, coh.phone?.label].filter(Boolean),
      body: `Redesign ${list(cards.slice(0, 2))} so that what looks tappable is tappable (the whole card opens where its link goes) and what is not reads as static.`,
      goals: [
        'Each card is one link target with a visible action (an arrow, a button, a short call to action), not an image that invites a tap and opens nothing.',
        'Static content (headings, body text, decorative images) stops looking like a control: no card chrome, no hover lift.',
        coh.phone ? 'Tap targets sized for a thumb: at least 44 px tall, spaced so a scroll does not land as a tap.' : null,
      ].filter(Boolean),
      measures: [`Taps on the content that open nothing, ${fmtPct(m.deadTapShare)} today`],
    });
  }

  /* talking points: real, page-specific, someone else's to fix, with a number */
  if (m.redirect?.share >= 0.2 && (m.redirect.addedMs || 0) >= 300) {
    talking.push({
      id: 'redirects',
      tier: 'talking',
      kind: 'redirect',
      stat: fmtPct(m.redirect.share),
      lead: 'via redirects',
      meaning: `Views that wait ${fmtMs(m.redirect.addedMs)} in an ad redirect chain before the page starts`,
      audience: m.redirect.team || 'paid media',
      title: `${fmtPct(m.redirect.share)} of views wait ${fmtMs(m.redirect.addedMs)} in ad redirects before the page starts`,
      say: `${fmtPct(m.redirect.share)} of visits to ${p.page?.title || 'this page'} arrive through a redirect chain, mostly ${m.redirect.topSource}, adding ${fmtMs(m.redirect.addedMs)} before the first byte. LCP is ${fmtMs(m.redirect.lcpRedirectedMs)} for those visits against ${fmtMs(m.redirect.lcpDirectMs)} for direct ones. Can the ad platform be given the final URL with its tracking parameters, so the click lands directly?`,
    });
  }
  if (m.consent?.dismissShareOfClicks >= 0.5) {
    talking.push({
      id: 'consent',
      tier: 'talking',
      kind: 'consent',
      stat: fmtPct(m.consent.dismissShareOfClicks),
      lead: 'consent clicks',
      meaning: 'Of all clicks on the page, the cookie dialog being dismissed',
      audience: m.consent.team || 'web engineering',
      title: `${fmtPct(m.consent.dismissShareOfClicks)} of all clicks on the page are people dismissing the cookie dialog`,
      say: `On ${p.page?.title || 'this page'}, ${fmtPct(m.consent.dismissShareOfClicks)} of all clicks are the consent dialog being dismissed; only ${fmtPct(touched, 1)} of views ever touch the content. Could the dialog be a bottom sheet or a lighter banner that leaves the first screen visible?`,
    });
  }

  /* what's working: a behavioural contrast, not a vanity metric */
  const lift = ratio(m.tapRate?.search, m.tapRate?.ads);
  if (lift && lift >= 3) {
    working = {
      id: 'search-lift',
      tier: 'working',
      kind: 'lift',
      stat: `${lift.toFixed(0)}\u00d7`,
      lead: 'search lift',
      meaning: `Search visitors tap into the content at ${fmtPct(m.tapRate.search)}, ad-driven ones at ${fmtPct(m.tapRate.ads, 1)}`,
      title: `Visitors who searched for this page tap into it ${lift.toFixed(0)}× more than ad-driven ones`,
      number: `${fmtPct(m.tapRate.search)} against ${fmtPct(m.tapRate.ads, 1)}`,
      body: 'The content works for people who wanted it. The gap is an audience problem, not a page problem; keep the first screen answering the search.',
    };
  }

  /* context: real, nobody's to act on right now */
  if (p.trafficNote) context.push({ label: 'Traffic pattern', value: p.trafficNote });
  if (p.aiSurface) {
    const a = p.aiSurface;
    context.push({ label: 'AI assistants fetched this page', value: `${fmtNum(a.fetches)} times (counted)` });
    context.push({ label: 'Estimated times featured in an answer', value: `~${fmtNum(a.featuredEstimate)}`, modeled: `${a.methodologyVersion}, ratio ${fmtPct(a.citationToUseRatio)}` });
    if (a.clickThroughs28d != null) context.push({ label: 'Click-throughs from AI answers, 28 days', value: `${fmtNum(a.clickThroughs28d)} (counted, CDN logs)` });
    if (a.assistants?.length) context.push({ label: 'Assistants seen', value: list(a.assistants) });
  }
  if (m.mobileShare != null) context.push({ label: 'On a phone', value: fmtPct(m.mobileShare) });

  actions.sort((x, y) => (x.effort - y.effort) || (y.impact - x.impact));
  /* evidence behind each finding, when the payload carries it (see payloadFromInsights) */
  const withDetails = (f) => (f ? { ...f, details: p.details?.[f.id] || null } : f);
  return { actions: actions.map(withDetails), redesigns, talking: talking.map(withDetails), working: withDetails(working), context };
}

/* ---------- Stardust brief ----------
   A redesign finding as a prompt for a Claude Code session with the Stardust plugin
   (github.com/adobe/skills, plugins/stardust). A freeform phrase after /stardust:stardust
   is read as redesign intent, so the first line says what and where; the rest is the
   evidence, the audiences, the goals, what must not change and how to tell it worked. */
export function stardustBrief(r, p, { fixes = [] } = {}) {
  const m = p.metrics || {}; const url = pageUrl(p);
  const evidence = [];
  if (m.views != null) evidence.push(`${fmtNum(m.views)} views in the window.`);
  if (m.paidOrSocialShare != null) evidence.push(`${fmtPct(m.paidOrSocialShare)} of visits start from a paid ad or a social feed.`);
  if (m.mobileShare != null) evidence.push(`${fmtPct(m.mobileShare)} of views are on a phone.`);
  if (m.noTouchShare != null) evidence.push(`${fmtPct(m.noTouchShare)} of views never touch the content.`);
  if (m.reach?.from && m.reach?.to) evidence.push(`${fmtPct(m.reach.from.share)} see the ${m.reach.from.label}, ${fmtPct(m.reach.to.share)} see ${m.reach.to.label}.`);
  const dead = deadTapLabels(p);
  if (m.deadTapShare != null) evidence.push(`${fmtPct(m.deadTapShare)} of taps on the content land on something that opens nothing${dead.length ? ` (mostly ${list(dead.slice(0, 3))})` : ''}.`);
  if (m.tapRate) evidence.push(`Search visitors tap into the content at ${fmtPct(m.tapRate.search)}, ad-driven ones at ${fmtPct(m.tapRate.ads, 1)}.`);
  if (m.consent?.dismissShareOfClicks != null) evidence.push(`${fmtPct(m.consent.dismissShareOfClicks)} of all clicks are the cookie dialog being dismissed.`);
  const bullets = (xs) => xs.map((x) => `- ${x}`).join('\n');
  return [
    `/stardust:stardust Redesign the ${r.area} of ${url || p.page?.path}. Scope: this one page, and on it only the ${r.area}; the rest of the page stays as it is. Brand-faithful: keep the site's captured palette, type and voice.`,
    '',
    `${r.body}`,
    '',
    `Why, from Optel telemetry (${p.page?.window || 'last 7 days'}, sampled, each session stands for many):`,
    bullets(evidence),
    '',
    'Who it has to work for:',
    bullets(r.cohorts),
    '',
    'Design goals:',
    r.goals.map((g, i) => `${i + 1}. ${g}`).join('\n'),
    '',
    'Keep:',
    bullets([
      'The page\u2019s content: copy, names, images and links. Rearrange and restyle, do not invent claims or offers.',
      'Edge Delivery Services blocks: the result ships through stardust:deploy as one or more EDS blocks that authors fill in Experience Workspace, so prototype the area as blocks, not a page rewrite.',
    ]),
    '',
    'Measure it by:',
    bullets(r.measures),
    ...(fixes.length ? ['', 'Content fixes already queued in Experience Workspace for this page (assume they ship):', bullets(fixes)] : []),
  ].join('\n');
}

/* ---------- header + framing ---------- */
export function headerMetrics(p, derived) {
  const m = p.metrics || {};
  const tiles = [{ id: 'findings', kind: 'opportunity', label: 'Opportunities', value: String(derived.actions.length), note: 'to fix in this editor' }];
  /* engaged = a tap on a real link or button; omit rather than mislead when unknown */
  if (m.realHitShare != null) tiles.push({ id: 'engaged', kind: 'engaged', label: 'Engaged', value: fmtPct(m.realHitShare, 1), note: 'tapped a real link or button' });
  return tiles;
}

export function framingLine(p, variant = 'stakes') {
  const m = p.metrics || {};
  const channel = m.paidOrSocialShare >= 0.5 ? 'a paid ad or social feed' : 'search or a direct visit';
  let device = 'on phones and desktops alike';
  if (m.mobileShare >= 0.6) device = 'on a phone';
  else if (m.mobileShare <= 0.4) device = 'on a desktop';
  const share = fmtPct(m.paidOrSocialShare >= 0.5 ? m.paidOrSocialShare : 1 - (m.paidOrSocialShare ?? 0));
  const base = `${share} of visits here start as ${channel}, mostly ${device}.`;
  if (variant === 'plain') return base;
  if (m.paidOrSocialShare >= 0.75) return `${base} Most people weren’t looking for this page, and every one already cost ad spend to bring here.`;
  if (m.paidOrSocialShare != null && m.paidOrSocialShare < 0.5) return `${base} They came looking; the page’s job is to answer fast.`;
  return base;
}

/* ---------- session log: the research output ---------- */
const LOG_KEY = 'improve-impact:session';
export function createLog(variant) {
  let entries = [];
  try { entries = JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]'); } catch { entries = []; }
  const t0 = performance.now();
  let firstAction = entries.find((e) => e.action)?.sinceOpenMs ?? null;
  const write = () => { try { sessionStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch { /* storage blocked */ } };
  const log = (event, detail = {}, { action = false } = {}) => {
    const sinceOpenMs = Math.round(performance.now() - t0);
    const entry = { t: new Date().toISOString(), sinceOpenMs, variant, event, ...detail, action };
    if (action && firstAction == null) { firstAction = sinceOpenMs; entry.timeToFirstActionMs = sinceOpenMs; }
    entries.push(entry); write();
    // eslint-disable-next-line no-console
    console.debug('[improve-impact]', event, entry);
    return entry;
  };
  return { log, entries: () => entries, timeToFirstAction: () => firstAction, clear: () => { entries = []; write(); } };
}

/* Grouped language rows for a details table: one line per language with its variants,
   everything under 1% folded into Others. */
export function languageRows(groups) {
  const big = groups.filter((g) => g.share >= 0.01); const small = groups.filter((g) => g.share < 0.01);
  const rows = big.map((g) => [`${g.name} (${g.variants.join(', ')})`, fmtNum(g.views), fmtPct(g.share, g.share < 0.1 ? 1 : 0)]);
  if (small.length) rows.push([`Others (${small.length} language${small.length === 1 ? '' : 's'})`, fmtNum(small.reduce((a, g) => a + g.views, 0)), fmtPct(small.reduce((a, g) => a + g.share, 0), 1)]);
  return rows;
}

/* The evidence tables the Page Insights panel shows, cut down to what backs each finding.
   Shape per finding: { rows: [[label, value]], table: { cols, rows }, method }. */
export function detailsFromInsights(r) {
  const e = r.engagement; const pctS = (x) => fmtPct(x, x > 0 && x < 0.1 ? 1 : 0);
  const d = {};
  d['dead-taps'] = {
    rows: [['Views that touched the content', fmtNum(e.clickedContent)], ['Of those, taps that hit nothing clickable', `${fmtNum(r.clicks.deadViews)} (${fmtPct(r.clicks.deadShare)})`]],
    table: { cols: ['What was tapped', 'Views', 'Of content taps'], rows: (r.clicks.dead || []).slice(0, 6).map((x) => [x.label || x.source, fmtNum(x.views), pctS(x.views / (e.clickedContent || 1))]) },
    method: 'A tap counts as dead when its target is an image, heading or text with no link behind it; the selector under each label is what the telemetry recorded. Sampled: every session stands for many.',
  };
  d['reach-cliff'] = {
    table: { cols: ['Block or image', 'Views that saw it', 'Share'], rows: (r.reach?.items || []).slice(0, 8).map((x) => [x.label || x.key, fmtNum(x.views), pctS(x.share)]) },
    method: 'Reach is the share of views in which a block or image scrolled into view. The cliff is the largest drop between two consecutive items in page order.',
  };
  d['no-touch'] = {
    rows: [['Page views', fmtNum(e.views)], ['Entered the site on this page', fmtNum(e.visits)], ['Touched the content', `${fmtNum(e.clickedContent)} (${pctS(e.contentClickShare)})`], ['Only touched the cookie dialog', fmtNum(e.clickedConsentOnly)], ['Left without touching anything', pctS(e.strictBounceRate)]],
    method: 'Touching the content means any click that is not on the consent dialog. The bounce rate counts visits that entered on this page and clicked nothing but the dialog.',
  };
  d.translation = {
    table: { cols: ['Browser language', 'Views', 'Share'], rows: languageRows(groupLanguages(r.language?.preferred, r.language?.sampled)) },
    method: `The browser sends its preferred language with every visit; the page declares ${r.language?.contentLang || 'its own'}. Regional variants are grouped (en-US, en and en-GB are one line); languages under 1% are folded into Others. A language needs 4% on its own to become an opportunity.`,
  };
  d.redirects = {
    rows: [['Views arriving through redirects', `${fmtNum(r.redirects?.redirected)} (${pctS(r.redirects?.redirectedShare)})`], ['Median chain', `${r.redirects?.hopsMedian ?? '–'} hops, ${fmtMs(r.redirects?.msMedian)}`], ['LCP p75, direct vs redirected', `${fmtMs(r.redirects?.lcpP75Direct)} vs ${fmtMs(r.redirects?.lcpP75Redirected)}`]],
    table: { cols: ['Source', 'Redirected', 'Median wait', 'LCP p75'], rows: (r.redirects?.sources || []).slice(0, 6).map((x) => [x.label, fmtPct(x.redirectedShare), fmtMs(x.msMedian), x.lcpSamples ? fmtMs(x.lcpP75) : '–']) },
    method: 'The browser reports how many redirects a navigation went through and how long they took; that time runs before the first byte and lands one to one on LCP. Sources are the acquisition classes of the visit.',
  };
  const ca = r.consent?.actions || {};
  d.consent = {
    rows: [['Views that saw the dialog', pctS(r.consent?.shownShare)], ['Dismissed', fmtNum(ca.dismiss)], ['Accepted', fmtNum(ca.accept)], ['Rejected', fmtNum(ca.reject)], ['Views that clicked anything', fmtNum(e.clickedAny)], ['Of those, only the dialog', fmtNum(e.clickedConsentOnly)]],
    method: 'Consent clicks are recognised by the dialog\u2019s own control ids; every other click counts as content.',
  };
  d['search-lift'] = {
    table: { cols: ['Where the visit started', 'Share of views', 'Touched the content'], rows: (r.intent?.rungs || []).map((x) => [x.name, fmtPct(x.share), pctS(x.engagedShare)]) },
    method: 'Rungs are inferred from the referrer and campaign tags of the visit; the tap rate is the share of those views that clicked anything but the consent dialog.',
  };
  return d;
}

/* ---------- adapter: the Optel analyzer's result -> payload ----------
   Lets the same panel run on real telemetry through ../shared/analyze.js. */
export function payloadFromInsights(r, { path, title, url, language = 'en-US' } = {}) {
  const e = r.engagement; const rung = (id) => r.intent?.rungs?.find((x) => x.id === id);
  const ads = rung('ads'); const search = rung('search');
  const cliff = r.reach?.cliff;
  const top = r.redirects?.sources?.[0];
  const consentClicks = e.clickedAny ? e.clickedConsentOnly / e.clickedAny : null;
  return {
    schema: 'improve-impact-payload/0.1',
    page: { path, url, title: title || path, language: r.language?.contentLang || language, window: 'last 7 days', source: 'Optel telemetry (sampled), live' },
    metrics: {
      views: e.views,
      paidOrSocialShare: ads ? ads.share : r.acquisition?.paidShare,
      mobileShare: r.devices.mobileShare,
      noTouchShare: 1 - e.contentClickShare,
      deadTapShare: r.clicks.deadShare,
      realHitShare: e.contentClickShare * (1 - (r.clicks.deadShare || 0)),
      reach: cliff ? {
        from: { label: cliff.from.label, share: cliff.from.share },
        to: { label: cliff.to.label, share: cliff.to.share },
      } : null,
      language: r.language?.sampled ? {
        mismatchShare: r.language.otherShare,
        groups: groupLanguages(r.language.preferred, r.language.sampled),
      } : null,
      tapRate: ads && search ? { search: search.engagedShare, ads: ads.engagedShare } : null,
      redirect: r.redirects?.redirected ? { share: r.redirects.redirectedShare, addedMs: r.redirects.msMedian, lcpRedirectedMs: r.redirects.lcpP75Redirected, lcpDirectMs: r.redirects.lcpP75Direct, topSource: top?.label || 'ad networks', team: 'paid media' } : null,
      consent: consentClicks != null ? { dismissShareOfClicks: consentClicks, team: 'web engineering' } : null,
      topLink: r.clicks?.navigations?.[0] ? { label: r.clicks.navigations[0].label, share: e.views ? r.clicks.navigations[0].views / e.views : null } : null,
    },
    blocks: (r.reach?.items || []).slice(0, 6).map((x, i) => ({ id: `block-${i}`, label: x.label, note: `reach ${fmtPct(x.share)}` })),
    deadTapLabels: (r.clicks?.dead || []).slice(0, 3).map((x) => x.label || x.source).filter(Boolean),
    aiSurface: r.aiSurface ? { fetches: r.aiSurface.hits, featuredEstimate: r.aiSurface.est, citationToUseRatio: null, methodologyVersion: 'per-assistant factors (ai-surface.json)', clickThroughs28d: r.aiReferrals?.pageviews28d ?? null, assistants: r.aiSurface.agents } : null,
    trafficNote: r.traffic?.spike >= 3 ? `Traffic peaked at ${r.traffic.spike.toFixed(0)}x the median day; the week is shaped by a burst.` : 'A steady week with no campaign burst.',
    details: detailsFromInsights(r),
  };
}
