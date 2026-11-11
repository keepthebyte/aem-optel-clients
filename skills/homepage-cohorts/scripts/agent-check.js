#!/usr/bin/env node
/*
 * Check the page a personal AI agent gets (references/agent-experience.md).
 *
 *   node agent-check.js --url https://main--site--org.aem.page/new [--out agent-check]
 *                       [--agent chatgpt-agent] [--experience agent] [--cls 0.01]
 *
 * Loads the URL with ?agent=<name> on a desktop and a phone and reports what an agent would
 * trip over: no form in the first screen, layout shift, overlays, closed disclosures, small
 * targets, controls without a name, action names with more than one target, tables without a
 * caption, overflow, script errors, answers lost on reload. Writes report.json, and for the
 * cold read <viewport>-first-screen.png and accessibility-tree.yml. Exit code 1 on a finding.
 *
 * Needs Playwright (npm i -D playwright && npx playwright install chromium).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.js';

export const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 375, height: 812 } };

/** Findings for one measured viewport: plain sentences, empty when the page is fine. */
export function findingsOf(name, m, { experience = 'agent', cls = 0.01 } = {}) {
  const f = [];
  const add = (text) => f.push(`${name}: ${text}`);
  const some = (list) => list.slice(0, 5).join(' | ') + (list.length > 5 ? ` (+${list.length - 5})` : '');
  if (m.experience !== experience) add(`experience is "${m.experience}", expected "${experience}" (is there a rule with when.agent, and Cohorts: on?)`);
  if (!m.h1InFirstScreen) add('no H1 in the first screen');
  if (!m.controlInFirstScreen) add('no form control in the first screen: the task should start there');
  if (m.cls > cls) add(`layout shift on load ${m.cls} (reserve the header, result and error areas)`);
  if (m.movedByAnswering) add(`${m.movedByAnswering} sections moved when the form was answered`);
  if (m.fixedOrSticky.length) add(`fixed or sticky parts: ${some(m.fixedOrSticky)}`);
  if (m.dialogs) add('an open dialog covers the page');
  if (m.closed.length) add(`closed disclosures: ${some(m.closed)}`);
  if (m.animated) add(`${m.animated} running animations or transitions`);
  if (m.smallTargets.length) add(`small targets: ${some(m.smallTargets)}`);
  if (m.unnamed.length) add(`controls without a name: ${some(m.unnamed)}`);
  if (m.duplicateNames.length) add(`one name, several targets: ${some(m.duplicateNames)}`);
  if (m.tablesWithoutCaption) add(`${m.tablesWithoutCaption} tables without a caption`);
  if (m.fakeControls.length) add(`controls that are not native: ${some(m.fakeControls)}`);
  if (m.overflow) add('the page scrolls sideways');
  if (m.reloadLost) add('a reload lost the answers (keep them in the URL)');
  if (m.errors.length) add(`script errors: ${some(m.errors)}`);
  return f;
}

/* runs in the page */
function measure() {
  const shown = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const inFirst = (el) => { const r = el.getBoundingClientRect(); return shown(el) && r.top >= 0 && r.bottom <= window.innerHeight; };
  const nameOf = (el) => (el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ')
    || (el.labels && [...el.labels].map((l) => l.textContent).join(' '))
    || el.textContent || el.getAttribute('alt') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ');
  const tag = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;
  const controls = [...document.querySelectorAll('main input:not([type=hidden]), main select, main textarea, main button')].filter(shown);
  const actions = [...document.querySelectorAll('a[href], button')].filter(shown);
  const inline = (el) => el.matches('a') && el.closest('p, li, td, dd') && el.parentElement.textContent.trim() !== el.textContent.trim();
  const box = (el) => (el.matches('input[type=radio], input[type=checkbox]') && el.closest('label') ? el.closest('label') : el).getBoundingClientRect();
  const byName = {};
  actions.forEach((el) => {
    const n = `${el.tagName === 'A' ? 'link' : 'button'} "${nameOf(el)}"`;
    (byName[n] = byName[n] || new Set()).add(el.tagName === 'A' ? new URL(el.href, window.location.href).href : (el.form && el.form.id) || el.id || tag(el));
  });
  return {
    experience: document.body.dataset.experience || '',
    cohort: document.body.dataset.cohort || '',
    title: document.title,
    h1InFirstScreen: [...document.querySelectorAll('h1')].some(inFirst),
    controlInFirstScreen: controls.some(inFirst),
    controls: controls.length,
    fixedOrSticky: [...document.querySelectorAll('body *')].filter((el) => shown(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position)).map(tag),
    dialogs: document.querySelectorAll('dialog[open], [role=dialog]:not([hidden]), [aria-modal=true]').length,
    closed: [...document.querySelectorAll('main details:not([open]), main [aria-expanded=false], main [role=tab][aria-selected=false]')].filter(shown).map((el) => nameOf(el).slice(0, 40) || tag(el)),
    animated: document.getAnimations().filter((a) => a.playState === 'running').length,
    smallTargets: [...controls, ...actions].filter((el, i, all) => all.indexOf(el) === i && !inline(el))
      .filter((el) => { const r = box(el); return r.height < 24 || r.width < 24 || (el.matches('button, input[type=submit]') && r.height < 44); })
      .map((el) => nameOf(el).slice(0, 40) || tag(el)),
    unnamed: [...controls, ...actions].filter((el, i, all) => all.indexOf(el) === i && !nameOf(el)).map(tag),
    duplicateNames: Object.entries(byName).filter(([, t]) => t.size > 1).map(([n, t]) => `${n} → ${t.size} targets`),
    tablesWithoutCaption: [...document.querySelectorAll('main table')].filter((t) => shown(t) && !t.querySelector('caption') && !t.getAttribute('aria-label') && !t.getAttribute('aria-labelledby')).length,
    fakeControls: [...document.querySelectorAll('main [role=radio], main [role=checkbox], main [role=button], main [role=combobox], main [role=listbox], main [onclick]')]
      .filter((el) => shown(el) && !el.matches('input, button, select, textarea, a[href]')).map(tag),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    pageHeight: document.documentElement.scrollHeight,
  };
}

function loadPlaywright() {
  const req = createRequire(path.join(process.cwd(), 'noop.js'));
  for (const name of ['playwright', '@playwright/test']) {
    try { return req(name); } catch { /* next */ }
  }
  console.error('Playwright not found: npm i -D playwright && npx playwright install chromium (or set NODE_PATH)');
  return process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) { console.error('usage: node agent-check.js --url <cohort page> [--out agent-check] [--agent chatgpt-agent] [--experience agent] [--cls 0.01]'); process.exit(1); }
  const out = path.resolve(args.out || 'agent-check');
  fs.mkdirSync(out, { recursive: true });
  const url = new URL(args.url);
  if (!url.searchParams.has('agent')) url.searchParams.set('agent', args.agent || 'chatgpt-agent');
  const opts = { experience: args.experience || 'agent', cls: Number(args.cls || 0.01) };
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const settle = async (page) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3500); // past the lazy and delayed phases
  };
  const report = { url: url.href, at: new Date().toISOString(), viewports: {}, findings: [] };

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }))
        .observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(url.href);
    await settle(page);
    const m = await page.evaluate(measure);
    m.cls = await page.evaluate(() => Number(window.__cls.toFixed(4)));
    await page.screenshot({ path: path.join(out, `${name}-first-screen.png`) });
    if (name === 'desktop') fs.writeFileSync(path.join(out, 'accessibility-tree.yml'), await page.locator('body').ariaSnapshot());

    // answer the form the way an agent would: the first option of every radio group
    const tops = () => page.evaluate(() => [...document.querySelectorAll('main > *')].map((s) => Math.round(s.getBoundingClientRect().top + window.scrollY)));
    const before = await tops();
    const picked = await page.evaluate(() => {
      const seen = new Set(); const ids = [];
      document.querySelectorAll('main input[type=radio]').forEach((r) => {
        if (seen.has(r.name) || r.disabled || !(r.offsetWidth || r.getClientRects().length || r.labels?.[0]?.offsetWidth)) return;
        seen.add(r.name); ids.push({ name: r.name, value: r.value });
      });
      return ids;
    });
    for (const p of picked) {
      await page.locator(`main input[type=radio][name="${p.name}"][value="${p.value}"]`).first().check({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(500);
    const after = await tops();
    m.answered = picked.length;
    m.movedByAnswering = picked.length ? before.filter((v, i) => v !== after[i]).length : 0;
    if (picked.length) {
      await page.reload();
      await settle(page);
      const kept = await page.evaluate((list) => list.filter((p) => document.querySelector(`main input[type=radio][name="${p.name}"][value="${p.value}"]`)?.checked).length, picked);
      m.reloadLost = kept < picked.length;
    } else m.reloadLost = false;
    m.errors = errors;
    report.viewports[name] = m;
    report.findings.push(...findingsOf(name, m, opts));
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (!report.findings.length) {
    console.log(`ok: ${url.href} serves the "${opts.experience}" experience with no findings (${out})`);
    return;
  }
  console.log(`${report.findings.length} findings for ${url.href}:`);
  report.findings.forEach((f) => console.log(`- ${f}`));
  console.log(`Details: ${path.join(out, 'report.json')}. Rules: references/agent-experience.md`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
