// ElevenLabs text-to-speech with character timestamps, cached on disk so
// re-renders of an unchanged line cost nothing.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // "George" from the ElevenLabs docs
const DEFAULT_MODEL = 'eleven_multilingual_v2';

export function voiceConfig(spec) {
  return {
    voiceId: spec.voice?.id || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE,
    modelId: spec.voice?.model || DEFAULT_MODEL,
    settings: spec.voice?.settings,
  };
}

/** Returns { file, words: [{ w, start, end }] } with times relative to the clip start. */
export async function synth({ text, prev, next, voice, apiKey, cacheDir }) {
  mkdirSync(cacheDir, { recursive: true });
  const key = createHash('sha1').update(JSON.stringify([text, prev, next, voice])).digest('hex').slice(0, 16);
  const file = join(cacheDir, key + '.mp3');
  const meta = join(cacheDir, key + '.json');
  if (existsSync(file) && existsSync(meta)) return { file, words: JSON.parse(readFileSync(meta, 'utf8')) };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: voice.modelId,
        previous_text: prev || undefined,
        next_text: next || undefined,
        voice_settings: voice.settings,
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const words = wordsFromAlignment(data.alignment);
  writeFileSync(file, Buffer.from(data.audio_base64, 'base64'));
  writeFileSync(meta, JSON.stringify(words));
  return { file, words };
}

function wordsFromAlignment(a) {
  const words = [];
  let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { cur = null; return; }
    if (!cur) words.push((cur = { w: '', start: a.character_start_times_seconds[i], end: 0 }));
    cur.w += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  return words;
}
