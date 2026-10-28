#!/usr/bin/env node
/*
 * Capture the pages the video shows: full-page screenshots plus the boxes of named elements,
 * so callouts point at real elements instead of guessed coordinates.
 *
 *   node capture.js --config captures.json --out work/captures
 *
 * captures.json:
 * {
 *   "base": "https://main--site--org.aem.page",
 *   "pages": [
 *     { "id": "orig", "path": "/?experiment=homepage-cohorts/control", "marks": { "signin": "header a[href*='login']" } },
 *     { "id": "customer", "path": "/new?cohort=from-portal", "marks": { "hero": "main .section:first-child", "tasks": ".tasks" } },
 *     { "id": "m-orig", "path": "/?experiment=homepage-cohorts/control", "mobile": true },
 *     { "id": "panel", "path": "/new?demo&ref=portal.example.com", "viewport": true, "click": ".cohort-pill", "marks": { "panel": ".cohort-body" } }
 *   ]
 * }
 * Per page: path, mobile (390x844 @2x), viewport (screenshot only the first screen),
 * click (selector clicked before the shot), keepPanel (keep the ?demo panel), wait (ms), marks,
 * css (extra CSS for the shot), keepSticky (see below), session / local (storage set before
 * any page script runs, e.g. a dismissed consent or demo dialog: { "demo-ack": "1" }; also at the
 * top level for every page).
 *
 * Scroll-driven sections (a sticky stage inside a box several screens tall) come out as a frame
 * followed by screens of empty background in a full-page shot. Unless keepSticky is set, every
 * sticky element outside the header is made static and its tall parent shrunk to fit, so the
 * capture shows each stage once, the way a reader would see it.
 *
 * Writes <out>/<id>.jpg and <out>/index.json: { id: { width, height, scale, header, marks: { name: { x, y, w, h, fixed } } } }
 * in CSS pixels of the captured page. Needs Playwright (npx playwright install chromium).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[(i += 1)];
if (!args.config) { console.error('usage: node capture.js --config captures.json [--out work/captures]'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(args.config, 'utf8'));
const out = args.out || 'work/captures';
fs.mkdirSync(out, { recursive: true });

function loadPlaywright() {
  const req = createRequire(path.join(process.cwd(), 'noop.js'));
  for (const name of ['playwright', '@playwright/test']) {
    try { return req(name); } catch { /* next */ }
  }
  console.error('Playwright not found: npm i -D playwright && npx playwright install chromium (or set NODE_PATH)');
  process.exit(1);
}
const { chromium } = loadPlaywright();

// A real browser UA, and no navigator.webdriver: the cohort engine treats automation as a bot
// (bots always get the original page), which would make every cohort capture look the same.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const index = fs.existsSync(path.join(out, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')) : {};
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
for (const pg of cfg.pages) {
  const mobile = !!pg.mobile;
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, userAgent: MUA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1920, height: 1080 }, userAgent: UA, deviceScaleFactor: 1 });
  // every capture starts as a new visitor (no memory, no stored experiment arm)
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('capture-kept')) { localStorage.clear(); sessionStorage.setItem('capture-kept', '1'); } } catch (e) { /* noop */ } });
  // storage set before any page script runs, e.g. a dismissed consent or demo dialog: { "session": { "key": "1" }, "local": {...} }
  const store = { session: { ...cfg.session, ...pg.session }, local: { ...cfg.local, ...pg.local } };
  if (Object.keys(store.session).length || Object.keys(store.local).length) {
    await ctx.addInitScript((st) => { try { Object.entries(st.session).forEach(([k, v]) => sessionStorage.setItem(k, v)); Object.entries(st.local).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) { /* noop */ } }, store);
  }
  const page = await ctx.newPage();
  // networkidle never comes on pages with polling or streaming media: fall back to load
  await page.goto(new URL(pg.path, cfg.base).href, { waitUntil: 'networkidle', timeout: 20000 })
    .catch(async (e) => { if (!/Timeout/.test(e.message)) throw e; console.error(`${pg.id}: no networkidle after 20 s, continuing after load`); });
  await page.waitForTimeout(pg.wait || 1200);
  if (!pg.viewport) {
    // scroll through once so lazy images load, then back to the top
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 600) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(100); }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
  }
  if (!pg.viewport && !pg.keepSticky) {
    const collapsed = await page.evaluate(() => {
      let n = 0;
      document.querySelectorAll('main *').forEach((el) => {
        if (getComputedStyle(el).position !== 'sticky' || !el.parentElement) return;
        const box = el.parentElement;
        if (box.offsetHeight < el.offsetHeight * 1.5) return;
        el.style.position = 'static'; box.style.height = 'auto'; box.style.minHeight = '0'; n += 1;
      });
      return n;
    });
    if (collapsed) { console.error(`${pg.id}: collapsed ${collapsed} scroll-driven sticky section(s); keepSticky: true to keep them`); await page.waitForTimeout(300); }
  }
  if (pg.css) await page.addStyleTag({ content: pg.css });
  if (!pg.keepPanel && !pg.click?.includes('cohort')) await page.evaluate(() => document.querySelector('.cohort-panel')?.remove());
  if (pg.click) { await page.click(pg.click); await page.waitForTimeout(700); }
  const meta = await page.evaluate((marks) => {
    const fixedOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
    const box = (sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      const r = el.getBoundingClientRect(); const fixed = fixedOf(el);
      return { x: Math.round(r.left), y: Math.round(r.top + (fixed ? 0 : window.scrollY)), w: Math.round(r.width), h: Math.round(r.height), fixed };
    };
    const header = document.querySelector('header');
    return {
      width: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
      header: header ? Math.round(header.getBoundingClientRect().height) : 0,
      cohort: document.body.dataset.cohort || null,
      variant: document.body.dataset.variant || null,
      marks: Object.fromEntries(Object.entries(marks || {}).map(([k, s]) => [k, box(s)])),
    };
  }, pg.marks);
  const file = path.join(out, `${pg.id}.jpg`);
  await page.screenshot({ path: file, fullPage: !pg.viewport, type: 'jpeg', quality: 90 });
  index[pg.id] = { ...meta, scale: mobile ? 2 : 1, mobile, path: pg.path, file: `${pg.id}.jpg`, height: pg.viewport ? (mobile ? 844 : 1080) : meta.height };
  const missing = Object.entries(meta.marks).filter(([, v]) => !v).map(([k]) => k);
  console.error(`${pg.id}: ${index[pg.id].width}x${index[pg.id].height} cohort=${meta.cohort} variant=${meta.variant}${missing.length ? `  MISSING marks: ${missing.join(', ')}` : ''}`);
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
