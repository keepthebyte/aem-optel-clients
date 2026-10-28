#!/usr/bin/env node
/*
 * Render the storyboard into a video: every scene frame by frame from stage.html, crossfades
 * between scenes, narration placed on each scene's start.
 *
 *   node render.js --storyboard storyboard.json --work work [--out work/video.mp4]
 *   node render.js --storyboard storyboard.json --work work --stills [scene ...]   → work/stills/*.png at every cue
 *   node render.js --storyboard storyboard.json --work work --only problem,mix      → re-render some scenes, reuse the rest
 *
 * Reads work/captures/index.json (capture.js), work/audio/<scene>.json (tts.js), and from the
 * storyboard: sankey (svg path), review (review.json path). Needs ffmpeg and Playwright.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i] === '--stills'; // a switch: the scene names after it are positional
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = flag || !argv[i + 1] || argv[i + 1].startsWith('--') ? true : argv[(i += 1)];
  else args._.push(argv[i]);
}
if (!args.storyboard) { console.error('usage: node render.js --storyboard storyboard.json --work work [--stills] [--only a,b] [--out file.mp4]'); process.exit(1); }
const FPS = 30; const LEAD = 0.4; const TAIL = 0.9; const XF = 0.5;
const sbFile = path.resolve(args.storyboard);
const sbDir = path.dirname(sbFile);
const sb = JSON.parse(fs.readFileSync(sbFile, 'utf8'));
const work = path.resolve(args.work || 'work');
const rel = (p) => (p ? path.resolve(sbDir, p) : null);

const captures = JSON.parse(fs.readFileSync(path.join(work, 'captures/index.json'), 'utf8'));
Object.values(captures).forEach((c) => { c.src = pathToFileURL(path.join(work, 'captures', c.file)).href; });
const svg = sb.sankey ? fs.readFileSync(rel(sb.sankey), 'utf8') : '';
const review = sb.review ? JSON.parse(fs.readFileSync(rel(sb.review), 'utf8')) : { rules: [] };

/* scene timing: lead-in + narration + tail (+ hold), or a fixed duration for silent scenes */
const scenes = sb.scenes.map((sc) => {
  const metaFile = path.join(work, 'audio', `${sc.id}.json`);
  const a = sc.narration && fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
  if (sc.narration && !a) throw new Error(`${sc.id}: no narration audio; run tts.js first`);
  const dur = a ? LEAD + a.duration + TAIL + (sc.hold || 0) : (sc.duration || 4);
  return {
    id: sc.id, dur, audio: a?.file ? path.join(work, 'audio', a.file) : null, cues: a ? Object.fromEntries(Object.entries(a.cues).map(([k, v]) => [k, v + LEAD])) : {},
  };
});
const cues = Object.fromEntries(scenes.map((s) => [s.id, s.cues]));

const req = createRequire(path.join(process.cwd(), 'noop.js'));
let chromium;
for (const name of ['playwright', '@playwright/test']) { try { ({ chromium } = req(name)); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.error('stage error:', e.message));
await page.goto(pathToFileURL(path.join(here, 'stage.html')).href);
await page.evaluate((d) => window.init(d), { storyboard: sb, captures, svg, review, cues });

if (args.stills) {
  const dir = path.join(work, 'stills'); fs.mkdirSync(dir, { recursive: true });
  const want = args._;
  for (const [i, s] of scenes.entries()) {
    if (want.length && !want.includes(s.id)) continue;
    const ts = [...new Set([0.6, ...Object.values(s.cues).map((v) => v + 1.6), s.dur - 0.2])].filter((t) => t < s.dur).sort((a, b) => a - b);
    for (const t of ts) { await page.evaluate(([j, tt]) => window.render(j, tt), [i, t]); await page.screenshot({ path: path.join(dir, `${String(i).padStart(2, '0')}-${s.id}-${t.toFixed(1)}.png`) }); }
    console.error(`${s.id}: ${ts.length} stills`);
  }
  await browser.close();
  process.exit(0);
}

const only = typeof args.only === 'string' ? args.only.split(',') : null;
const clipDir = path.join(work, 'clips'); fs.mkdirSync(clipDir, { recursive: true });
for (const [i, s] of scenes.entries()) {
  const clip = path.join(clipDir, `${s.id}.mp4`);
  if (only ? !only.includes(s.id) : false) { if (!fs.existsSync(clip)) throw new Error(`${s.id}: no clip to reuse`); continue; }
  const n = Math.round(s.dur * FPS);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', clip], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < n; f += 1) {
    await page.evaluate(([j, tt]) => window.render(j, tt), [i, f / FPS]);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => { ff.stdin.once('drain', r); });
  }
  ff.stdin.end(); await new Promise((r) => { ff.on('close', r); });
  console.error(`${s.id}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();

/* assemble: crossfade chain, narration at each scene's start + lead-in */
const out = path.resolve(args.out || path.join(work, 'video.mp4'));
const inputs = scenes.flatMap((s) => ['-i', path.join(clipDir, `${s.id}.mp4`)]);
let f = ''; let last = '[0:v]'; let off = 0; const starts = [0];
for (let i = 1; i < scenes.length; i += 1) {
  off += scenes[i - 1].dur - XF; starts.push(off);
  const o = i === scenes.length - 1 ? '[v]' : `[x${i}]`;
  f += `${last}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}${o};`;
  last = o;
}
if (scenes.length === 1) f += '[0:v]null[v];';
const total = starts[starts.length - 1] + scenes[scenes.length - 1].dur;
const au = scenes.map((s, i) => (s.audio ? { file: s.audio, at: starts[i] + LEAD } : null)).filter(Boolean);
const ain = au.flatMap((a) => ['-i', a.file]);
if (au.length) {
  au.forEach((a, j) => { const ms = Math.round(a.at * 1000); f += `[${scenes.length + j}:a]adelay=${ms}|${ms}[a${j}];`; });
  f += `${au.map((_, j) => `[a${j}]`).join('')}amix=inputs=${au.length}:normalize=0,loudnorm=I=-16:TP=-1.5,apad[a]`;
} else {
  f += `anullsrc=r=44100:cl=stereo[a]`;
}
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, ...ain, '-filter_complex', f, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', total.toFixed(2), out], { stdio: 'inherit' });
console.error(`${total.toFixed(1)} s → ${out}`);
const timeline = scenes.map((s, i) => `${new Date(starts[i] * 1000).toISOString().slice(14, 19)}  ${s.id}`).join('\n');
fs.writeFileSync(out.replace(/\.mp4$/, '.timeline.txt'), `${timeline}\n`);
