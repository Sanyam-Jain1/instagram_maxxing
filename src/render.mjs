#!/usr/bin/env node
// Render a reel spec (reels/*.json) to a 1080x1920 MP4.
//   node src/render.mjs reels/foo.json            full render -> out/foo.mp4
//   node src/render.mjs reels/foo.json --preview  one still per scene -> out/foo/
//   --silent    skip the voiceover even if a key is set
//   --voice     force the voiceover (for setups where a proxy injects the key)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { synth, voiceConfig } from './tts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1080, H = 1920, FPS = 30;
const LEAD = 0.2, TAIL = 0.45; // silence around each scene's narration
const TYPES = ['hook', 'point', 'stat', 'quote', 'cta'];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const specPath = args.find((a) => !a.startsWith('--'));
if (!specPath) {
  console.error('usage: node src/render.mjs reels/<name>.json [--preview] [--silent] [--voice]');
  process.exit(1);
}
const ff = (bin, a) => execFileSync(bin, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const plain = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const slug = basename(specPath).replace(/\.json$/, '');
validate(spec);

const work = join(ROOT, '.cache', 'render', slug);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'frames'), { recursive: true });
mkdirSync(join(ROOT, 'out'), { recursive: true });

const apiKey = flags.has('--silent') ? null : process.env.ELEVENLABS_API_KEY || (flags.has('--voice') ? 'injected-by-proxy' : null);
const timeline = await buildTimeline(spec, apiKey);
writeFileSync(join(work, 'timeline.json'), JSON.stringify(timeline, null, 2));
console.log(`${slug}: ${timeline.scenes.length} scenes, ${timeline.duration.toFixed(1)}s, ${apiKey ? 'AI voiceover' : 'silent (estimated pacing)'}`);

if (flags.has('--preview')) {
  await preview(timeline);
} else {
  await renderFrames(timeline);
  encode(timeline);
}

function validate(spec) {
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error('spec.scenes must be a non-empty array');
  spec.scenes.forEach((s, i) => {
    if (!TYPES.includes(s.type)) throw new Error(`scene ${i + 1}: type must be one of ${TYPES.join(', ')}`);
    if (s.type === 'stat' ? !s.value : !s.text) throw new Error(`scene ${i + 1}: "${s.type}" needs ${s.type === 'stat' ? 'value' : 'text'}`);
  });
}

// What gets narrated: scene.vo if given, else the on-screen text. vo: "" means no narration.
function narration(s) {
  return s.vo !== undefined ? plain(s.vo) : plain([s.type === 'stat' ? s.value : '', s.text, s.sub].filter(Boolean).join('. '));
}

function estimateWords(text) {
  let t = 0;
  return text.split(' ').filter(Boolean).map((w) => {
    const start = t;
    t += 0.17 + 0.05 * w.length + (/[.,!?;:…]$/.test(w) ? 0.22 : 0);
    return { w, start, end: t - 0.03 };
  });
}

async function buildTimeline(spec, apiKey) {
  const voice = voiceConfig(spec);
  const texts = spec.scenes.map(narration);
  const scenes = [];
  let t = 0;
  for (const [i, s] of spec.scenes.entries()) {
    let words = [], audio = null, voLen = 0;
    if (texts[i]) {
      if (apiKey) {
        const r = await synth({ text: texts[i], prev: texts[i - 1], next: texts[i + 1], voice, apiKey, cacheDir: join(ROOT, '.cache', 'tts') });
        audio = r.file;
        words = r.words;
        voLen = parseFloat(ff('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio]));
      } else {
        words = estimateWords(texts[i]);
        voLen = words[words.length - 1].end;
      }
    }
    const len = Math.max(s.duration || 0, texts[i] ? LEAD + voLen + TAIL : 2.5) + (s.hold || 0);
    scenes.push({
      ...s,
      start: t,
      end: t + len,
      audio,
      words: words.map((w) => ({ w: w.w, start: t + LEAD + w.start, end: t + LEAD + w.end })),
    });
    t += len;
  }
  return { width: W, height: H, fps: FPS, duration: t, theme: spec.theme, handle: spec.handle, captions: spec.captions, scenes };
}

async function openPages(timeline, n) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const url = pathToFileURL(join(ROOT, 'src', 'template', 'reel.html')).href;
  const pages = await Promise.all(
    Array.from({ length: n }, async () => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => { console.error('template error:', e.message); process.exit(1); });
      await page.goto(url);
      await page.evaluate((tl) => window.setup(tl), timeline);
      return page;
    }),
  );
  return { browser, pages };
}

async function preview(timeline) {
  const { browser, pages } = await openPages(timeline, 1);
  const dir = join(ROOT, 'out', slug);
  mkdirSync(dir, { recursive: true });
  for (const [i, s] of timeline.scenes.entries()) {
    const t = Math.min(s.end - 0.4, s.start + (s.end - s.start) * 0.8);
    await pages[0].evaluate((t) => window.renderFrame(t), t);
    const file = join(dir, `scene-${String(i + 1).padStart(2, '0')}.jpg`);
    await pages[0].screenshot({ path: file, type: 'jpeg', quality: 85 });
    console.log('  ' + file);
  }
  await browser.close();
}

async function renderFrames(timeline) {
  const total = Math.ceil(timeline.duration * FPS);
  const n = Math.max(1, Math.min(6, cpus().length));
  const { browser, pages } = await openPages(timeline, n);
  let next = 0, done = 0;
  await Promise.all(
    pages.map(async (page) => {
      while (next < total) {
        const i = next++;
        await page.evaluate((t) => window.renderFrame(t), i / FPS);
        await page.screenshot({ path: join(work, 'frames', String(i).padStart(6, '0') + '.jpg'), type: 'jpeg', quality: 94 });
        if (++done % 60 === 0 || done === total) process.stdout.write(`\r  frames ${done}/${total}`);
      }
    }),
  );
  process.stdout.write('\n');
  await browser.close();
}

function encode(timeline) {
  const out = join(ROOT, 'out', slug + '.mp4');
  const input = ['-y', '-framerate', String(FPS), '-i', join(work, 'frames', '%06d.jpg')];
  const hasAudio = timeline.scenes.some((s) => s.audio);
  if (hasAudio) {
    // One padded WAV per scene, concatenated, so narration lines up with scene starts.
    const list = timeline.scenes.map((s, i) => {
      const wav = join(work, `scene-${i}.wav`);
      const len = (s.end - s.start).toFixed(3);
      const src = s.audio
        ? ['-i', s.audio, '-af', `adelay=${LEAD * 1000}:all=1,apad=whole_dur=${len}`]
        : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
      ff('ffmpeg', ['-y', ...src, '-t', len, '-ar', '44100', '-ac', '2', wav]);
      return `file '${wav}'`;
    });
    writeFileSync(join(work, 'audio.txt'), list.join('\n'));
    input.push('-f', 'concat', '-safe', '0', '-i', join(work, 'audio.txt'));
  }
  ff('ffmpeg', [
    ...input,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-t', timeline.duration.toFixed(3), '-movflags', '+faststart', out,
  ]);
  rmSync(join(work, 'frames'), { recursive: true, force: true });
  console.log('  wrote ' + out);
}
