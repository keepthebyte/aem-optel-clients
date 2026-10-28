#!/usr/bin/env node
/*
 * Narration per scene, with the time of every {cue} marker in the text.
 *
 *   node tts.js --storyboard storyboard.json --out work/audio
 *
 * storyboard.voice.provider:
 *   elevenlabs  final voice. ELEVENLABS_API_KEY or ~/.config/elevenlabs/key. Character timestamps → exact cues.
 *   say         macOS `say`, offline and free: for timing drafts. Cues estimated from character position.
 *   none        silence at ~15 characters a second: for layout drafts without audio.
 *
 * Cached per scene (provider, voice, settings, text): editing one scene re-voices only that scene,
 * which matters on ElevenLabs plans with a monthly character budget.
 * Writes <out>/<scene>.mp3 (or .m4a for say) and <out>/<scene>.json { hash, duration, cues, words }.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[(i += 1)];
if (!args.storyboard) { console.error('usage: node tts.js --storyboard storyboard.json [--out work/audio] [--provider say]'); process.exit(1); }
const sb = JSON.parse(fs.readFileSync(args.storyboard, 'utf8'));
const voice = { provider: 'say', ...sb.voice, ...(args.provider ? { provider: args.provider } : {}) };
const out = args.out || 'work/audio';
fs.mkdirSync(out, { recursive: true });

const duration = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

function split(narration) {
  const cues = {}; let text = '';
  narration.split(/(\{[\w-]+\})/).forEach((part) => {
    const m = part.match(/^\{([\w-]+)\}$/);
    if (m) cues[m[1]] = text.length; else text += part;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), cues };
}

function elevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const f = path.join(os.homedir(), '.config/elevenlabs/key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  throw new Error('No ElevenLabs key: set ELEVENLABS_API_KEY or write it to ~/.config/elevenlabs/key (never into the repo)');
}

/* character index → seconds, from per-character start times */
const cueTimes = (cues, starts, chars) => Object.fromEntries(Object.entries(cues).map(([k, i]) => {
  for (let j = i; j < starts.length; j += 1) if (chars[j].trim()) return [k, +starts[j].toFixed(3)];
  return [k, +(starts[starts.length - 1] || 0).toFixed(3)];
}));

let used = 0;
for (const sc of sb.scenes) {
  if (!sc.narration) continue;
  const { text, cues: cueIdx } = split(sc.narration);
  const hash = crypto.createHash('sha1').update(JSON.stringify([voice, text])).digest('hex').slice(0, 12);
  const metaFile = path.join(out, `${sc.id}.json`);
  if (fs.existsSync(metaFile) && JSON.parse(fs.readFileSync(metaFile, 'utf8')).hash === hash) { console.error(`${sc.id}: cached`); continue; }
  let meta;
  if (voice.provider === 'elevenlabs') {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': elevenKey(), 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: voice.model || 'eleven_multilingual_v2', voice_settings: voice.settings }),
    });
    if (!r.ok) throw new Error(`${sc.id}: ElevenLabs ${r.status} ${await r.text()}`);
    const j = await r.json();
    const file = path.join(out, `${sc.id}.mp3`);
    fs.writeFileSync(file, Buffer.from(j.audio_base64, 'base64'));
    const a = j.alignment;
    meta = { file: path.basename(file), cues: cueTimes(cueIdx, a.character_start_times_seconds, a.characters), duration: duration(file) };
    used += text.length;
  } else {
    let file = null; let dur;
    if (voice.provider === 'say') {
      file = path.join(out, `${sc.id}.m4a`);
      execFileSync('say', [...(voice.sayVoice ? ['-v', voice.sayVoice] : []), '-r', String(voice.sayRate || 175), '-o', file, '--file-format=m4af', text]);
      dur = duration(file);
    } else {
      dur = text.length / 15;
    }
    // no timestamps: place cues by character position
    const starts = [...text].map((_, i) => (i / text.length) * dur);
    meta = { file: file && path.basename(file), cues: cueTimes(cueIdx, starts, [...text]), duration: dur, estimated: true };
  }
  meta = { hash, text, provider: voice.provider, ...meta };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  console.error(`${sc.id}: ${meta.duration.toFixed(1)} s ${JSON.stringify(meta.cues)}`);
}
if (used) console.error(`ElevenLabs characters used: ${used}`);
