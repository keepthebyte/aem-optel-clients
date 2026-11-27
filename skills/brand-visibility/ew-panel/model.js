// Brand visibility panel: pure logic (no DOM), so it runs under node --test.
// The data file (/brand-visibility/brand-visibility.json) is written by the skill run;
// the choices file (/brand-visibility/focus.json) is written by this panel.

export const JOBS = ['Claim', 'Defend', 'Win'];
export const CHOICES = ['focus', 'watch', 'skip'];
export const CHOICE_LABEL = { focus: 'Focus', watch: 'Watch', skip: 'Skip' };
const RANK = { focus: 0, watch: 1, skip: 2 };

// a theme's choice: the saved one, else the default from the skill run
export const choiceOf = (theme, saved) => {
  const c = saved?.themes?.[theme.id];
  if (CHOICES.includes(c)) return c;
  return CHOICES.includes(theme.focus) ? theme.focus : 'watch';
};

// Focus first, then Watch, then Skip; inside each, the most asked theme first
export function ordered(themes, saved) {
  return [...themes].sort((a, b) => (RANK[choiceOf(a, saved)] - RANK[choiceOf(b, saved)])
    || ((b.potential?.prompts || 0) - (a.potential?.prompts || 0)));
}

export function filtered(themes, saved, filter) {
  if (!filter || filter === 'all') return themes;
  if (filter === 'focus') return themes.filter((t) => choiceOf(t, saved) === 'focus');
  return themes.filter((t) => t.job === filter);
}

export function counts(themes, saved) {
  const c = { all: themes.length, focus: 0 };
  JOBS.forEach((j) => { c[j] = 0; });
  themes.forEach((t) => {
    if (c[t.job] != null) c[t.job] += 1;
    if (choiceOf(t, saved) === 'focus') c.focus += 1;
  });
  return c;
}

// 1294000 -> "1.3M", 5400 -> "5.4k", 300 -> "300"
export function compact(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

// demand change since the earlier read, as a whole percent (null when there is no earlier read)
export function change(now, before) {
  if (!now || !before) return null;
  return Math.round(((now - before) / before) * 100);
}

export function choicesDoc(saved, id, choice, now = new Date()) {
  const themes = { ...(saved?.themes || {}) };
  if (choice) themes[id] = choice; else delete themes[id];
  return { updated: now.toISOString(), themes };
}

const pathOf = (url) => {
  const m = /^https?:\/\/[^/]+(\/[^?#]*)?/.exec(url || '');
  return m ? (m[1] || '/') : url;
};
export const shortPage = (s) => `${s.site}${pathOf(s.page)}`;

// The study's two jobs, in the order a visitor meets them
export const GOALS = ['seen', 'chosen'];
const GOAL_FALLBACK = { seen: 'Be seen and preferred', chosen: 'Be chosen' };
export const goalLabel = (goal, goals) => goals?.[goal]?.label || GOAL_FALLBACK[goal] || goal;
const goalOf = (s) => (GOALS.includes(s.goal) ? s.goal : 'seen');

// suggestions grouped by goal, empty groups left out
export function byGoal(suggestions) {
  const list = suggestions || [];
  return GOALS.map((goal) => ({ goal, items: list.filter((s) => goalOf(s) === goal) }))
    .filter((g) => g.items.length);
}

// The chat prompt for one suggestion. The user sends it; nothing is changed without them.
// meta: the data file's meta (goals, pattern)
export function draftPrompt(theme, s, meta = {}) {
  const ev = (s.evidence || []).map((e) => `- ${e.kind}: ${e.text}`).join('\n');
  const g = meta.goals?.[goalOf(s)];
  const pattern = s.pattern && meta.pattern;
  return [
    `Draft this change for the ${theme.label} topic (${theme.job}): ${s.title}.`,
    `Page: ${s.page}`,
    `Goal: ${goalLabel(goalOf(s), meta.goals)}${g ? `. ${g.text} Measured by: ${g.metric}.` : ''}`,
    `What: ${s.what}`,
    ev && `Why:\n${ev}`,
    pattern && `${pattern.title}:\n${pattern.parts.map((p) => `- ${p.name} (${goalLabel(p.goal, meta.goals)}): ${p.text}`).join('\n')}`,
    'Read the live page first. Show the new H1, the first screen and any table as text I can paste, and say what you left out.',
  ].filter(Boolean).join('\n\n');
}

// Where focus.json lives: the Source Bus of this site. The panel runs at
// {ref}--{site}--{org}.aem.page/tools/brand-visibility/, or gets org and site from the workspace.
export function sourceTarget(context, hostname) {
  const org = context?.org || context?.owner;
  const site = context?.site || context?.repo;
  if (org && site) return { org, site };
  const m = /^(?:[^.]+?--)?([^.]+?)--([^.]+?)\.aem\.(?:page|live)$/.exec(hostname || '');
  return m ? { org: m[2], site: m[1] } : null;
}

// The plan: topics on Focus, most asked first, each with its suggested changes
export function planOf(themes, saved) {
  return ordered(themes, saved).filter((t) => choiceOf(t, saved) === 'focus');
}

export function planPrompt(plan, meta = {}) {
  const lines = plan.map((t) => [
    `${t.label} (${t.job}):`,
    ...byGoal(t.suggestions).flatMap((g) => [
      `  ${goalLabel(g.goal, meta.goals)}:`,
      ...g.items.map((s) => `  - ${s.title}: ${s.page}`),
    ]),
  ].join('\n'));
  const goals = GOALS.map((k) => meta.goals?.[k] && `- ${meta.goals[k].label}: ${meta.goals[k].text} Measured by: ${meta.goals[k].metric}.`).filter(Boolean);
  return [
    'These are the topics we decided to focus on for AI visibility, with the site changes suggested for each, grouped by the job they do.',
    goals.length ? goals.join('\n') : null,
    lines.join('\n\n'),
    'Order the changes into a plan for the next six weeks: quick wins first, then the pages that need new content. Say who would own each change (content, web team, research) and what to measure for each job.',
  ].filter(Boolean).join('\n\n');
}

// numeric sort for the topic table
export const SORTS = {
  prompts: (t) => t.potential?.prompts || 0,
  share: (t) => t.standing?.share || 0,
  peer: (t) => t.standing?.peer?.ratio || 0,
  visits: (t) => t.potential?.visits || 0,
  ai: (t) => t.potential?.aiVisits || 0,
};
export function sortBy(themes, key, dir = -1) {
  const f = SORTS[key];
  if (!f) return themes;
  return [...themes].sort((a, b) => dir * (f(a) - f(b)));
}

// log scale for the map's x axis
export function logScale([d0, d1], [r0, r1]) {
  const l0 = Math.log10(d0); const l1 = Math.log10(d1);
  return (v) => r0 + ((Math.log10(Math.max(v, d0)) - l0) / (l1 - l0)) * (r1 - r0);
}
