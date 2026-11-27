#!/usr/bin/env node
// The data file of the Brand visibility panel (ew-panel/), from the three reads and a plan.
//
//   node scripts/panel-data.js --visits out/visits-by-theme.json --reads reads.json \
//     --plan plan.json --out out/brand-visibility.json [--check-urls]
//
// visits-by-theme.json  read 1, from visits-by-theme.js
// reads.json            reads 2 and 3 (references/reads.md); the panel needs `standing`
// plan.json             by hand per run: suggestions, notes, data sources (references/panel.md)
//
// The output goes to the site's content store at /brand-visibility/brand-visibility.json,
// previewed and never published. Nothing here reads keys or calls Optel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Share of brand mentions in the answers, and rank among the brands named
export const JOB_RULE = { defendShare: 10, defendRank: 2, winShare: 5 };
export const JOB_TEXT = {
  Defend: 'Named in at least 1 of 10 brand mentions in the answer, or in the top 2. Keep what is cited working.',
  Win: 'Named in 5 to 10% of mentions while someone else owns the answer. Take share from the leader.',
  Claim: 'Under 5% of mentions. The answer is being written without the brand. Publish the page it needs.',
};
const FROM_STATE = { lead: 'Defend', comp: 'Win', open: 'Claim' };

// The two jobs a page does for AI visibility: be seen and preferred, then be chosen
export const GOALS = {
  seen: {
    label: 'Be seen and preferred',
    text: 'The answer reads the brand’s page and names the brand as the source, not a publisher or a competitor.',
    pages: 'Research, data studies, guides, insight',
    metric: 'Share of answers and citations',
  },
  chosen: {
    label: 'Be chosen',
    text: 'The person clicks the link in the answer, lands on a deep page and can act right away.',
    pages: 'Tools, offers, product and service pages, next steps, contact',
    metric: 'Engaged AI visits and leads',
  },
};
const STATUSES = ['included', 'partial', 'missing'];

// rule.by 'rank' (defendRank, winRank) suits a brand whose own name lifts its share everywhere
export function jobOf(standing, state, rule = JOB_RULE) {
  const share = standing?.share;
  if (rule.by === 'rank' && standing?.rank) {
    if (standing.rank <= rule.defendRank) return 'Defend';
    return standing.rank <= rule.winRank ? 'Win' : 'Claim';
  }
  if (share == null) return FROM_STATE[state] || 'Claim';
  if (share >= rule.defendShare || (standing.rank && standing.rank <= rule.defendRank)) return 'Defend';
  if (share >= rule.winShare) return 'Win';
  return 'Claim';
}

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// returns { data, problems }; problems are strings, data is null when a problem blocks the build
export function panelData({ visits, reads, plan }, { today = new Date() } = {}) {
  const problems = [];
  const rule = { ...JOB_RULE, ...(plan.jobRule || {}) };
  const siteName = Object.fromEntries((visits.sites || []).map((s) => [s.id, s.name || s.id]));
  const vt = visits.themes || {};
  const suggestions = plan.suggestions || {};
  const ids = new Set(reads.themes.map((t) => t.id));
  Object.keys(suggestions).filter((id) => !ids.has(id))
    .forEach((id) => problems.push(`plan.suggestions.${id}: no such theme in reads.json`));

  const themes = reads.themes.map((r) => {
    const v = vt[r.id] || {};
    const st = r.standing || {};
    if (st.share == null) problems.push(`${r.id}: standing.share is missing (the map plots it)`);
    if (!vt[r.id]) problems.push(`${r.id}: not in visits-by-theme.json (visits count as 0)`);
    const ratio = st.peer?.mentions && st.mentions != null
      ? Math.round((10 * st.mentions) / st.peer.mentions) / 10 : null;
    const peer = ratio != null ? { name: st.peer.name, mentions: st.peer.mentions, ratio } : null;
    const named = !!r.wanted;
    const list = (suggestions[r.id] || []).map((s, i) => {
      const id = `${r.id}-${i + 1}`;
      if (!s.title || !s.page) problems.push(`${id}: title and page are required`);
      if (s.goal && !GOALS[s.goal]) problems.push(`${id}: goal "${s.goal}" is not seen or chosen`);
      return {
        id,
        goal: s.goal || 'seen',
        title: s.title,
        page: s.page,
        site: s.site || hostOf(s.page),
        what: s.what || '',
        evidence: s.evidence || [],
        ...(s.pattern ? { pattern: true } : {}),
      };
    });
    return {
      id: r.id,
      label: r.label || v.label || r.id,
      job: plan.jobs?.[r.id] || jobOf(st, r.state, rule),
      potential: {
        prompts: r.prompts || 0,
        promptsBefore: r.promptsBefore ?? null,
        changeLikeForLike: r.likeForLike ?? null,
        visits: v.visits || 0,
        aiVisits: v.ai || 0,
        bySite: Object.fromEntries(Object.entries(v.sites || {})
          .map(([k, n]) => [siteName[k] || k, n])),
      },
      standing: {
        share: st.share ?? null,
        rank: st.rank ?? null,
        mentions: st.mentions ?? null,
        leaders: st.leaders || [],
        peer,
        tracked: st.tracked || null,
        queries: st.queries || [],
      },
      strategy: {
        named,
        text: named ? r.wanted : 'Not named as a growth area in public statements.',
        source: named ? (r.wantedSource || reads.wantedSource || null) : null,
      },
      focus: plan.focus?.[r.id] || (named ? 'focus' : 'watch'),
      suggestions: list,
    };
  });

  (plan.dataSources || []).forEach((d, i) => {
    if (!STATUSES.includes(d.status)) {
      problems.push(`dataSources[${i}] (${d.name}): status must be ${STATUSES.join(', ')}`);
    }
  });
  const blocking = problems.some((p) => /share is missing|required|no such theme|status must/.test(p));
  const data = blocking ? null : {
    meta: {
      brand: plan.brand || reads.firm || '',
      asOf: plan.asOf || today.toISOString().slice(0, 10),
      window: plan.window || reads.scope || '',
      jobRule: { ...JOB_TEXT, ...(plan.jobText || {}) },
      ...(rule.by ? { jobBy: rule.by } : {}),
      ...(plan.study ? { study: plan.study } : {}),
      goals: Object.fromEntries(Object.keys(GOALS)
        .map((g) => [g, { ...GOALS[g], ...(plan.goals?.[g] || {}) }])),
      ...(plan.pattern ? { pattern: plan.pattern } : {}),
      labels: plan.labels || {},
      dataSources: plan.dataSources || [],
    },
    notes: plan.notes || [],
    themes,
  };
  return { data, problems };
}

// every suggested page should answer 200 before it is shown
export async function checkUrls(data, fetchImpl = fetch) {
  const all = data.themes.flatMap((t) => t.suggestions);
  const out = await Promise.all(all.map(async (s) => {
    try {
      const r = await fetchImpl(s.page, { method: 'GET', redirect: 'manual' });
      return r.status === 200 ? null : `${s.id}: ${r.status} ${s.page}`;
    } catch (e) {
      return `${s.id}: ${e.message} ${s.page}`;
    }
  }));
  return out.filter(Boolean);
}

const args = (argv) => {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
    }
  }
  return o;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  if (!a.visits || !a.reads || !a.plan || !a.out) {
    console.error('usage: panel-data.js --visits visits-by-theme.json --reads reads.json --plan plan.json'
      + ' --out brand-visibility.json [--check-urls]');
    process.exit(2);
  }
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const input = { visits: read(a.visits), reads: read(a.reads), plan: read(a.plan) };
  const { data, problems } = panelData(input);
  problems.forEach((p) => console.error(`! ${p}`));
  if (!data) process.exit(1);
  if (a['check-urls']) {
    const bad = await checkUrls(data);
    bad.forEach((b) => console.error(`! not 200: ${b}`));
    if (bad.length) process.exit(1);
  }
  fs.writeFileSync(a.out, `${JSON.stringify(data, null, 1)}\n`);
  const n = data.themes.reduce((k, t) => k + t.suggestions.length, 0);
  console.error(`${a.out}: ${data.themes.length} themes, ${n} suggestions`);
}
