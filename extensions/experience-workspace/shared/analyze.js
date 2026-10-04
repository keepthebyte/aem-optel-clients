/*
 * Page insights from AEM Operational Telemetry (Optel) bundles, shared by the
 * Experience Workspace panels in this folder.
 *
 * Pure functions, no DOM. Loading, bot and prerender rules, click, consent,
 * acquisition and redirect classification, and the weighted aggregation
 * primitives come from optel-client.js at the root of this repo; the panels
 * ship with the client they were tested against. This file adds the panels'
 * layer: per-site settings, human labels, the intent ladder, the shape the
 * panels render, and the findings.
 */

import * as optel from '../../../optel-client.js';

const {
  RULES, loadBundles, lastRange, planRange, byPath, normalizePath,
  events, has, isBot, isPageView, isVisit, isBounce, dayOf, cwvOf,
  classifyAcquisition, classifyClick, classifyConsent, isNavigation, parseRedirect,
  weightOf, ratio, percentile, groupBy, timeSeries, mediaReach,
} = optel;

export { normalizePath };

/* ---------- per-site settings ----------
   Sites tag campaigns their own way. Some run video, social or connected-TV buys with
   the medium name as utm_medium (`video`, `ctv`, ...); `paidMedium` adds those names to
   the client's paid rule, e.g. configure({ paidMedium: 'video|social|ctv|ott' }). */
const DEFAULT_PAID_MEDIUM = RULES.paidMedium;
export function configure({ paidMedium } = {}) {
  RULES.paidMedium = paidMedium
    ? new RegExp(`${DEFAULT_PAID_MEDIUM.source}|${paidMedium}`, 'i')
    : DEFAULT_PAID_MEDIUM;
}

/* ---------- loading ---------- */

/** The 168 hourly slots of the week ending at `now`, oldest first. */
export function hourList(now = new Date()) {
  return planRange({ ...lastRange('7d', now), granularity: 'hour' }).slots;
}

/**
 * Fetch a week of hourly bundles and keep only the bundles for `path`, the
 * explorer's week view. `onProgress(done, total, bundles)` fires after every
 * file so the panel can render partial results. A rejected key throws an
 * OptelError with status 401 or 403; other failed files are counted in `failed`.
 */
export async function loadWeek({
  domain, domainKey, path, now = new Date(), onProgress = () => {},
}) {
  const hours = hourList(now);
  const got = [];
  const { bundles, failed } = await loadBundles({
    domain,
    domainKey,
    start: hours[0],
    end: now,
    granularity: 'hour',
    filter: byPath(path),
    onChunk: (kept, { done, total }) => {
      got.push(...kept);
      onProgress(done, total, got);
    },
  });
  return { bundles, failed: failed.length, hours };
}

/* ---------- labels ---------- */

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* the client's vendor slugs, as people write them */
const VENDOR_NAMES = {
  facebook: 'Meta',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  duckduckgo: 'DuckDuckGo',
  x: 'X',
  chatgpt: 'ChatGPT',
  'meta-ai': 'Meta AI',
  tradedesk: 'The Trade Desk',
};
const vendorName = (v) => VENDOR_NAMES[v] || cap(v);

const KNOWN_HOSTS = {
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'snapchat.com': 'Snapchat',
  'tiktok.com': 'TikTok',
  'google.com': 'Google',
  'bing.com': 'Bing',
  'youtube.com': 'YouTube',
  't.co': 'X',
  'x.com': 'X',
  'reddit.com': 'Reddit',
  'pinterest.com': 'Pinterest',
  'duckduckgo.com': 'DuckDuckGo',
  'ad.doubleclick.net': 'Google Ads',
  'tpc.googlesyndication.com': 'Google Ads',
  'googlesyndication.com': 'Google Ads',
  'c.amazon-adsystem.com': 'Amazon Ads',
  'amazon-adsystem.com': 'Amazon Ads',
  'imasdk.googleapis.com': 'Google video ads',
  'connect.themediatrust.com': 'The Media Trust',
};

export function hostLabel(source) {
  if (!source || source === '(direct)') return 'Direct';
  try {
    const host = new URL(source).hostname.replace(/^(www|m|l|lm|mobile)\./, '');
    return KNOWN_HOSTS[host] || host;
  } catch {
    return source;
  }
}

const AI_PLATFORM = [
  [/chatgpt|openai/i, 'ChatGPT'], [/perplexity/i, 'Perplexity'], [/claude|anthropic/i, 'Claude'], [/copilot|microsoft|bing/i, 'Microsoft Copilot'],
  [/gemini|bard|notebooklm|google/i, 'Google Gemini'], [/meta/i, 'Meta AI'], [/deepseek/i, 'DeepSeek'], [/mistral/i, 'Mistral'], [/grok|x\.ai/i, 'Grok'],
];
export function aiPlatformLabel(x) {
  const hit = AI_PLATFORM.find(([re]) => re.test(x || ''));
  return hit ? hit[1] : cap(String(x || 'AI assistant'));
}

/**
 * "Google · cpc" for a tagged or paid visit, the referring site for an
 * untagged one, "(owned)" appended for the brand's own channels.
 */
export function acquisitionLabel(a) {
  // a campaign tag is a source or a medium; utm_content alone does not make a direct visit a campaign
  const tagged = a.type === 'paid' || a.utm.utm_source || a.utm.utm_medium || a.channel === 'email';
  let label;
  // an ad server the client has no vendor name for comes back as its host: name it after the referrer instead
  const who = a.vendor.includes('.') ? hostLabel(a.referrer) : vendorName(a.vendor);
  if (tagged) label = `${who || 'Unknown vendor'} · ${a.channel}`;
  else if (a.channel === 'direct') label = 'Direct';
  else label = hostLabel(a.referrer) || vendorName(a.vendor);
  return a.type === 'owned' ? `${label} (owned)` : label;
}

/* Click kinds the panel tells apart. The client's kinds, plus one: a modal that
   is not the consent dialog (a store picker, a sign-up) reports its buttons as
   buttons, but taps on its chrome are not dead taps on the page. */
function clickKind(e, pageUrl) {
  const kind = classifyClick(e, pageUrl);
  if (kind === 'consent') return kind;
  const parts = (e.source || '').trim().split(/\s+/);
  if (parts[0] === 'dialog' && !/^(button|a)\b/.test(parts[parts.length - 1] || '')) return 'dialog';
  return kind === 'media' ? 'image' : kind;
}

const contentClick = (b, pageUrl) => events(b, 'click').some((e) => classifyClick(e, pageUrl) !== 'consent');

function imageName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts.pop() || '';
    const name = /^width\d+\./.test(last) ? parts.pop() || last : last;
    // "MO_Summer-Sale_HeroBanner_2x.png" → "Summer Sale Hero Banner 2x": drop the
    // breakpoint prefix and the extension, split words the way asset names join them
    return decodeURIComponent(name)
      .replace(/\.(png|jpe?g|gif|webp|avif|svg)$/i, '')
      .replace(/^(MO|DT|TB|MOB|DESK)[_-]/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return url;
  }
}

const AREAS = { header: 'Header', footer: 'Footer', nav: 'Navigation', dialog: 'Dialog', aside: 'Sidebar' };
const KINDS = [['button', 'Button'], ['a', 'Link'], ['img', 'Image'], ['video', 'Video'], ['form', 'Form']];

/* `#container-9fae6b6303` → "container 9fae", `.cmp-teaser__content` → "teaser content" */
function prettyToken(token) {
  const m = token.match(/^[.#]?(.*?)(?:-([0-9a-f]{8,}))?$/i);
  const base = (m ? m[1] : token).replace(/^cmp-/, '').replace(/__|[-_]+/g, ' ').trim();
  return m && m[2] ? `${base} ${m[2].slice(0, 4)}` : base;
}

/** Human label for a click source selector. */
export function sourceLabel(source) {
  if (!source) return 'Page background (no element)';
  const parts = source.trim().split(/\s+/);
  const name = parts[parts.length - 1];
  const ctx = parts.length > 1 ? parts[0] : '';
  const kind = KINDS.find(([tag]) => new RegExp(`^${tag}\\b`).test(name));
  const rest = kind ? name.slice(kind[0].length) : name;
  const detail = rest ? prettyToken(rest) : '';
  let base;
  const kindName = kind ? kind[1] : '';
  if (kind && detail && !new RegExp(`^${kindName}( |$)`, 'i').test(detail)) base = `${kindName} ${detail}`;
  else if (kind) base = kindName;
  else base = cap(detail || name);
  if (AREAS[ctx]) return `${AREAS[ctx]} · ${base.toLowerCase()}`;
  if (ctx) return `${base} in ${prettyToken(ctx)}`;
  return base;
}

/* ---------- intent ladder ----------
   Where a view starts says how much it wanted this page. Five rungs, low to high. */
export const RUNGS = [
  { id: 'ads', name: 'Ads & social feeds', why: 'interrupted while doing something else' },
  { id: 'internal', name: 'Browsing the site', why: 'already here, followed a link' },
  { id: 'search', name: 'Search & referring sites', why: 'looked for something, Google AI answers included' },
  { id: 'ai', name: 'AI answers', why: 'asked an assistant, got this page cited, clicked' },
  { id: 'direct', name: 'Direct & bookmarks', why: 'typed or saved the address' },
];
const FEEDS = ['facebook', 'instagram', 'tiktok', 'snapchat', 'x', 'linkedin', 'pinterest', 'reddit', 'youtube'];

export function intentRung(b) {
  const a = classifyAcquisition(b);
  if (!a) return { rung: 'internal', label: 'Another page on the site' };
  if (a.channel === 'ai') return { rung: 'ai', label: aiPlatformLabel(a.vendor || a.referrer), paid: a.type === 'paid' };
  const label = acquisitionLabel(a);
  if (a.type === 'paid') return { rung: 'ads', label, paid: true };
  if (a.channel === 'social' || FEEDS.includes(a.vendor)) return { rung: 'ads', label };
  // another property of the same site (a market site, the shop) sent the visit
  if (a.channel === 'internal') return { rung: 'internal', label };
  if (a.channel === 'direct') return { rung: 'direct', label };
  return { rung: 'search', label };
}

/* ---------- findings ---------- */

const fmtPct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const fmtMs = (ms) => {
  if (ms == null) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
};
export const langName = (code) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; }
};
export const fmtNum = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).format(n || 0);

/**
 * Turn the numbers into things an author can act on. Each finding names the
 * evidence and one concrete change; thresholds are deliberately blunt.
 */
export function findings(r) {
  const out = [];
  const e = r.engagement;
  const v = e.views;
  if (v < 500) {
    out.push({ level: 'info', title: 'Thin data', body: `Only ${fmtNum(v)} sampled views this week. Read the shares as rough; one campaign day would change them.` });
  }

  if (r.devices.mobileShare >= 0.8) {
    out.push({ level: 'info', title: `${fmtPct(r.devices.mobileShare)} of views are on phones`, body: 'Judge the page by its phone fold: what is visible in the first 850px decides whether anyone scrolls. Check the hero in the mobile preview before the desktop one.' });
  } else if (r.devices.mobileShare <= 0.35) {
    out.push({ level: 'info', title: `${fmtPct(1 - r.devices.mobileShare)} of views are on desktop`, body: 'Wide-screen layout matters here: make sure the hero does not push the first call to action below a laptop fold.' });
  }

  const R = r.redirects;
  if (R && v >= 500 && R.redirectedShare >= 0.2 && (R.msMedian || 0) >= 300) {
    const worst = R.sources.filter((x) => x.type === 'paid' && x.redirectedShare >= 0.5 && x.visits >= 100).slice(0, 2);
    const who = worst.map((x) => `${x.label} (${x.hopsMedian} hop${x.hopsMedian === 1 ? '' : 's'}, ${fmtMs(x.msMedian)} median)`).join(' and ');
    const lcp = R.lcpP75Redirected && R.lcpP75Direct ? ` LCP p75 is ${fmtMs(R.lcpP75Redirected)} for redirected views against ${fmtMs(R.lcpP75Direct)} for direct ones.` : '';
    out.push({ level: 'warn', title: `${fmtPct(R.redirectedShare)} of views arrive through redirects that cost ${fmtMs(R.msMedian)} before the page starts`, body: `${who ? `The chains come mostly from ${who}.` : 'The chains are spread across sources.'}${lcp} Give the ad platform the final URL with its tracking parameters so the click lands here directly, and ask each intermediary in the chain to drop its hop; every hop is time the page cannot win back.` });
  }

  const L = r.language;
  if (L && L.sampled >= 200 && L.otherShare >= 0.01) {
    const names = L.otherLangs.slice(0, 3).map((x) => langName(x.key)).join(', ');
    const body = `The page is in ${langName(L.contentLang)} (${L.contentLang}); those browsers ask for ${names} first. Point them to the matching locale page with hreflang and a visible language switch near the top, or accept that this share reads a page in a language they did not choose.`;
    if (L.otherShare >= 0.05) out.push({ level: 'warn', title: `${fmtPct(L.otherShare)} of visitors read in a different language than the page`, body });
    else out.push({ level: 'info', title: `${fmtPct(L.otherShare, 1)} of visitors prefer another language than the page's`, body });
  }

  if (e.visits > 0 && e.strictBounceRate >= 0.7) {
    out.push({ level: 'warn', title: `${fmtPct(e.strictBounceRate)} of visits leave without touching the content`, body: `Counting the cookie dialog as an interaction the bounce rate is ${fmtPct(e.bounceRate)}; without it, ${fmtPct(e.strictBounceRate)}. The page is being seen, not used. Give the first screen one clear next step, the action the page exists for, instead of a headline alone.` });
  }

  if (e.clickedAny > 0 && e.clickedConsentOnly / e.clickedAny >= 0.6) {
    const a = r.consent.actions;
    out.push({ level: 'warn', title: 'The cookie dialog is the most-used control on the page', body: `${fmtPct(e.clickedConsentOnly / e.clickedAny)} of views that click at all only click the consent dialog (${fmtNum(a.dismiss)} dismiss, ${fmtNum(a.accept)} accept, ${fmtNum(a.reject)} reject). Only ${fmtPct(e.contentClickShare, 1)} of views click anything else. Every tap on the dialog is one the page did not get; a lighter banner or a bottom sheet keeps the hero visible while it is open.` });
  }

  if (r.clicks.deadViews > 0 && r.clicks.deadShare >= 0.3) {
    const top = r.clicks.dead.slice(0, 3).map((d) => `${d.label} (${fmtNum(d.views)})`).join(', ');
    out.push({ level: 'warn', title: `${fmtPct(r.clicks.deadShare)} of content clicks land on things that do nothing`, body: `${fmtNum(r.clicks.deadViews)} views tapped areas with no link or button: ${top}. People expect these to respond. Make the whole teaser or card a link to where its call to action goes, or move the button to where the taps are.` });
  }

  const c = r.reach.cliff;
  if (c && c.drop >= 0.5 && c.from.share >= 0.2) {
    out.push({ level: 'warn', title: `Reach falls from ${fmtPct(c.from.share)} to ${fmtPct(c.to.share, 1)} between "${c.from.label}" and "${c.to.label}"`, body: 'Most visitors see the first image and stop before the next one scrolls into view. Whatever should be seen (the offer, the main call to action) needs to sit right under the hero, or the hero needs to be shorter so it appears on the first screen.' });
  }

  const I = r.intent;
  if (I && v >= 500) {
    const rung = (id) => I.rungs.find((x) => x.id === id);
    const ads = rung('ads'); const search = rung('search'); const ai = rung('ai');
    if (ads.share >= 0.5) {
      const cmp = search.views >= 100 ? ` against ${fmtPct(search.engagedShare, 1)} for people who came from a search` : '';
      out.push({ level: 'info', title: `${fmtPct(ads.share)} of views were interrupted, not looking: ads and social feeds`, body: `They touch the content ${fmtPct(ads.engagedShare, 1)} of the time${cmp}. A scroll-by visitor needs one immediate hook in the first screen (what is on offer and the one action) rather than a brand statement; the ad's promise should be repeated word for word.` });
    } else if (I.looking >= 0.6) {
      out.push({ level: 'good', title: `${fmtPct(I.looking)} of views came looking for this page`, body: 'Search, AI answers and direct visits carry intent. Make the next step obvious for them and keep the hero from delaying it.' });
    }
    if (ai.views > 0) {
      const who = ai.sources.slice(0, 2).map((x) => x.key).join(' and ');
      out.push({ level: 'info', title: `${fmtNum(ai.views)} views arrived from AI answers, the highest-intent external visit`, body: `Someone asked ${who}, saw this page cited and chose to click through. They touch the content ${fmtPct(ai.engagedShare, 1)} of the time. Optel samples these, so read small numbers as rough.` });
    }
  }

  if (r.traffic.spike >= 3 && r.traffic.peak) {
    out.push({ level: 'info', title: `Traffic peaked on ${r.traffic.peak.day} at ${r.traffic.spike.toFixed(0)}× the median day`, body: 'A campaign burst dominates the numbers for this week, so the week-level shares describe campaign visitors more than steady traffic.' });
  }

  if (e.navigatedShare > 0 && e.navigatedShare < 0.02) {
    const n = r.clicks.navigations[0];
    out.push({ level: 'warn', title: `Only ${fmtPct(e.navigatedShare, 1)} of views follow any link`, body: `${n ? `The most-followed link is ${n.label} (${fmtNum(n.views)} views).` : ''} If this page exists to send people somewhere, that destination needs a visible button on the first screen.` });
  }

  if (!out.some((f) => f.level === 'warn')) {
    out.push({ level: 'good', title: 'Nothing alarming this week', body: 'Engagement, reach and clicks are within the ranges this panel watches for.' });
  }
  return out;
}

/* ---------- analysis ---------- */

/** groupBy rows as the panel's `{ key, views }` lists. */
const top = (rows, limit) => rows.slice(0, limit).map(({ key, views }) => ({ key, views }));

/**
 * Build everything the panel shows from one page's bundles.
 * `pageUrl` is the canonical live URL (used to spot buttons whose target is
 * the page itself, i.e. modal openers).
 */
export function analyze(all, { pageUrl = '', hours = [] } = {}) {
  const bots = all.filter(isBot);
  const bundles = all.filter((b) => !isBot(b) && isPageView(b));
  const views = weightOf(bundles);
  const botViews = weightOf(bots);
  const visits = bundles.filter(isVisit);
  const visitViews = weightOf(visits);
  const acq = new Map(visits.map((b) => [b, classifyAcquisition(b)]));
  const engagedClick = new Map(bundles.map((b) => [b, contentClick(b, pageUrl)]));

  /* devices */
  const devices = { mobile: 0, desktop: 0, other: 0 };
  bundles.forEach((b) => {
    const type = (b.userAgent || '').split(':')[0];
    devices[type in devices ? type : 'other'] += b.weight;
  });
  const platforms = top(groupBy(bundles, (b) => (b.userAgent || '').split(':').filter(Boolean).join(' · ')), 5);

  /* language: the `language` checkpoint carries the page's content language as
     source and the browser's preferred language as target. One event per view. */
  const primary = (l) => String(l || '').toLowerCase().split(/[-_]/)[0];
  const langEvent = (b) => events(b, 'language').find((e) => e.target);
  const langSampled = bundles.filter(langEvent);
  const sampledLang = weightOf(langSampled);
  const match = (b, how) => {
    const ev = langEvent(b); const content = String(ev.source || ''); const pref = String(ev.target);
    if (pref.toLowerCase() === content.toLowerCase()) return how === 'exact';
    if (primary(pref) === primary(content)) return how === 'variant';
    return how === 'other';
  };
  const exact = weightOf(langSampled.filter((b) => match(b, 'exact')));
  const variant = weightOf(langSampled.filter((b) => match(b, 'variant')));
  const otherLang = langSampled.filter((b) => match(b, 'other'));
  const other = weightOf(otherLang);

  /* intent ladder */
  const rungOf = new Map(bundles.map((b) => [b, intentRung(b)]));
  const intent = {
    rungs: RUNGS.map((x, i) => {
      const g = bundles.filter((b) => rungOf.get(b).rung === x.id);
      const v = weightOf(g);
      return {
        ...x,
        level: i + 1,
        views: v,
        paid: weightOf(g.filter((b) => rungOf.get(b).paid)),
        share: ratio(v, views),
        engagedShare: ratio(weightOf(g.filter((b) => engagedClick.get(b))), v),
        sources: top(groupBy(g, (b) => rungOf.get(b).label), 5),
      };
    }),
  };
  intent.index = views ? intent.rungs.reduce((s, x) => s + x.views * x.level, 0) / views : 0;
  intent.looking = intent.rungs.filter((x) => ['search', 'ai', 'direct'].includes(x.id)).reduce((s, x) => s + x.share, 0);

  /* redirect chains: ad clicks often hop through trackers before landing here; that
     time runs before the first byte and counts towards LCP. Grouped by acquisition source. */
  const redirectOf = new Map(bundles.map((b) => [b, parseRedirect(b)]));
  const redirected = bundles.filter((b) => redirectOf.get(b));
  const hopPairs = (g) => g.filter((b) => redirectOf.get(b)).map((b) => [redirectOf.get(b).hops, b.weight]);
  const msPairs = (g) => g.filter((b) => redirectOf.get(b)?.ms != null).map((b) => [redirectOf.get(b).ms, b.weight]);
  const lcpPairs = (g) => g.map((b) => [cwvOf(b).lcp, b.weight]).filter(([x]) => x != null);
  const lcpRedirected = lcpPairs(redirected);
  const lcpDirect = lcpPairs(bundles.filter((b) => !redirectOf.get(b)));
  const bySource = groupBy(visits, (b) => acquisitionLabel(acq.get(b)), {
    metrics: {
      type: (g) => (acq.get(g[0]).type === 'paid' ? 'paid' : 'organic'),
      redirected: (g) => weightOf(g.filter((b) => redirectOf.get(b))),
      hopsMedian: (g) => percentile(hopPairs(g), 0.5),
      msMedian: (g) => percentile(msPairs(g), 0.5),
      msP75: (g) => percentile(msPairs(g), 0.75),
      lcp: lcpPairs,
    },
  });
  const redirectSources = bySource
    .filter((x) => x.redirected > 0)
    .map((x) => ({
      label: x.key,
      type: x.type,
      visits: x.views,
      redirected: x.redirected,
      redirectedShare: ratio(x.redirected, x.views),
      hopsMedian: x.hopsMedian,
      msMedian: x.msMedian,
      msP75: x.msP75,
      lcpP75: percentile(x.lcp, 0.75),
      lcpSamples: x.lcp.length,
      /* views lost time × how much: what fixing this source would give back */
      cost: x.redirected * (x.msMedian || 0),
    }))
    .sort((p, q) => q.cost - p.cost);

  /* time series */
  const pageViews = all.filter(isPageView);
  const human = (b) => (isBot(b) ? 0 : b.weight);
  const daily = timeSeries(pageViews, {
    by: 'day',
    slots: hours,
    series: { human, botViews: (b) => (isBot(b) ? b.weight : 0), visits: (b) => (!isBot(b) && isVisit(b) ? b.weight : 0) },
  }).map((d) => ({ day: d.t, views: d.human, botViews: d.botViews, visits: d.visits }));
  const hourly = timeSeries(pageViews, { by: 'hour', slots: hours, series: { human } })
    .map((d) => ({ hour: d.t, views: d.human }));

  /* clicks */
  const clicks = (b) => events(b, 'click');
  const contentClicks = (b) => clicks(b).filter((e) => classifyClick(e, pageUrl) !== 'consent');
  const clickers = bundles.filter((b) => clicks(b).length);
  const clickedAny = weightOf(clickers);
  const clickedContent = weightOf(clickers.filter((b) => engagedClick.get(b)));
  const clickedConsentOnly = clickedAny - clickedContent;
  const deadViews = weightOf(clickers.filter((b) => clicks(b).some((e) => ['dead', 'unknown'].includes(clickKind(e, pageUrl)))));
  const navigated = weightOf(bundles.filter((b) => contentClicks(b).some((e) => isNavigation(e, pageUrl))));
  const consentActions = { accept: 0, reject: 0, dismiss: 0, settings: 0, other: 0 };
  groupBy(bundles, (b) => clicks(b).map((e) => classifyConsent(e.source))).forEach((x) => { consentActions[x.key] = x.views; });
  const NONE = '(no element)'; // groupBy skips empty keys; a click without a selector is still a tap
  // where each area leads: every tap counts here, not once per view
  const areaTargets = {};
  bundles.forEach((b) => contentClicks(b).forEach((e) => {
    if (!e.target) return;
    const t = areaTargets[e.source || NONE] || (areaTargets[e.source || NONE] = {});
    t[e.target] = (t[e.target] || 0) + b.weight;
  }));
  const areas = groupBy(bundles, (b) => contentClicks(b).map((e) => e.source || NONE), { total: views }).map(({ key, views: v, share }) => {
    const source = key === NONE ? '' : key;
    const targets = Object.entries(areaTargets[key] || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => ({ key: k, views: n }));
    const target = targets[0] ? targets[0].key : '';
    return {
      source, label: sourceLabel(source), views: v, share, kind: clickKind({ source, target }, pageUrl), target, targets,
    };
  });
  const dead = areas.filter((a) => a.kind === 'dead' || a.kind === 'unknown');
  const pageHost = pageUrl ? new URL(pageUrl).hostname : '';
  const followed = (b) => contentClicks(b).filter((e) => isNavigation(e, pageUrl)).map((e) => e.target);
  const navigations = top(groupBy(bundles, followed), 8).map((x) => ({
    ...x,
    label: x.key.replace(/^https?:\/\//, '').replace(new RegExp(`^${pageHost}`), ''),
    internal: !!pageHost && new URL(x.key).hostname === pageHost,
  }));

  /* consent banner display */
  const consent = { shown: 0, hidden: 0, suppressed: 0 };
  groupBy(bundles, (b) => events(b, 'consent').map((e) => ({ show: 'shown', shown: 'shown', hidden: 'hidden' }[e.target] || 'suppressed')))
    .forEach((x) => { consent[x.key] = x.views; });

  /* engagement: the strict variants do not count a tap on the cookie dialog */
  const bounces = weightOf(visits.filter(isBounce));
  const strictBounces = weightOf(visits.filter((b) => !engagedClick.get(b)));
  const engaged = weightOf(bundles.filter((b) => engagedClick.get(b) || events(b, ['viewmedia', 'viewblock']).length > 3));

  /* acquisition */
  const counts = { paid: 0, owned: 0, earned: 0 };
  visits.forEach((b) => { counts[acq.get(b).type] += b.weight; });
  const tagged = counts.paid + counts.owned + counts.earned;
  const days = daily.map((d) => d.day);
  const withTrend = (paid) => {
    const g = visits.filter((b) => (acq.get(b).type === 'paid') === paid);
    return groupBy(g, (b) => acquisitionLabel(acq.get(b)), { top: 5, metrics: { members: (m) => m } }).map((s) => {
      const perDay = Object.fromEntries(groupBy(s.members, dayOf).map((x) => [x.key, x.views]));
      const series = days.map((d) => perDay[d] || 0);
      const half = Math.floor(series.length / 2);
      const first = series.slice(0, half).reduce((x, y) => x + y, 0);
      const second = series.slice(half).reduce((x, y) => x + y, 0);
      let trend = 0;
      if (first > 0) trend = (second - first) / first;
      else if (second > 0) trend = null; // new this half of the week
      return { key: s.key, views: s.views, label: s.key, share: ratio(s.views, tagged), series, trend };
    });
  };
  const acquisition = {
    ...counts,
    internal: views - visitViews,
    organic: counts.owned + counts.earned,
    paidShare: ratio(counts.paid, visitViews),
    organicShare: ratio(counts.owned + counts.earned, visitViews),
    paidSources: withTrend(true),
    organicSources: withTrend(false),
  };

  /* content reach (viewmedia as a scroll-depth proxy) */
  const reach = mediaReach(bundles, { checkpoint: 'viewmedia', top: 100 }).items.map((x) => ({
    source: x.key, views: x.views, share: x.share, image: x.media, label: x.media ? imageName(x.media) : sourceLabel(x.key),
  }));
  let cliff = null;
  reach.forEach((r, i) => {
    if (i === 0 || reach[i - 1].share < 0.02) return;
    const drop = 1 - r.share / reach[i - 1].share;
    if (!cliff || drop > cliff.drop) cliff = { from: reach[i - 1], to: r, drop };
  });
  const anyMedia = weightOf(bundles.filter((b) => has(b, 'viewmedia')));

  /* traffic shape */
  const dayViews = daily.map((d) => d.views);
  const peak = daily.reduce((a, d) => (!a || d.views > a.views ? d : a), null);
  const median = dayViews.slice().sort((a, b) => a - b)[Math.floor(dayViews.length / 2)] || 0;

  const result = {
    sample: { bundles: bundles.length, views, botViews, visits: visitViews, days: daily.length },
    devices: { ...devices, mobileShare: ratio(devices.mobile, views), platforms },
    intent,
    redirects: {
      redirected: weightOf(redirected),
      redirectedShare: ratio(weightOf(redirected), views),
      hopsMedian: percentile(hopPairs(redirected), 0.5),
      msMedian: percentile(msPairs(redirected), 0.5),
      msP75: percentile(msPairs(redirected), 0.75),
      lcpP75Redirected: percentile(lcpRedirected, 0.75),
      lcpP75Direct: percentile(lcpDirect, 0.75),
      lcpSamples: lcpRedirected.length + lcpDirect.length,
      /* redirected views that were not visits (no enter): internal or referrer-less navigations */
      unattributedShare: ratio(weightOf(redirected.filter((b) => !isVisit(b))), weightOf(redirected)),
      sources: redirectSources.slice(0, 8),
    },
    language: {
      sampled: sampledLang,
      sampledShare: ratio(sampledLang, views),
      contentLang: groupBy(langSampled, (b) => String(langEvent(b).source || ''))[0]?.key || '',
      exact,
      variant,
      other,
      exactShare: ratio(exact, sampledLang),
      variantShare: ratio(variant, sampledLang),
      otherShare: ratio(other, sampledLang),
      preferred: top(groupBy(langSampled, (b) => String(langEvent(b).target)), 8),
      otherLangs: top(groupBy(otherLang, (b) => primary(langEvent(b).target)), 6),
    },
    daily,
    hourly,
    engagement: {
      views,
      visits: visitViews,
      bounces,
      bounceRate: ratio(bounces, visitViews),
      strictBounces,
      strictBounceRate: ratio(strictBounces, visitViews),
      engaged,
      engagedShare: ratio(engaged, views),
      clickedAny,
      clickShare: ratio(clickedAny, views),
      clickedContent,
      contentClickShare: ratio(clickedContent, views),
      clickedConsentOnly,
      navigated,
      navigatedShare: ratio(navigated, views),
    },
    clicks: { areas: areas.slice(0, 12), dead: dead.slice(0, 6), deadViews, deadShare: ratio(deadViews, clickedContent), navigations },
    consent: { ...consent, shownShare: ratio(consent.shown, views), actions: consentActions },
    acquisition,
    reach: { items: reach.slice(0, 12), cliff, anyMedia, anyMediaShare: ratio(anyMedia, views) },
    traffic: { peak, median, spike: median && peak ? peak.views / median : 0 },
  };
  result.findings = findings(result);
  return result;
}
