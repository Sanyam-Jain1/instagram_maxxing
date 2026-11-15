# instagram_maxxing

Code-generated Instagram reels. A reel is a JSON script in `reels/`; the renderer turns it
into a 1080x1920, 30fps MP4 with animated text, word-synced captions, and an AI voiceover.

## Commands

- `npm install` — once (set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in Claude cloud sessions; Chromium is preinstalled)
- `npm run preview reels/<name>.json` — one still per scene in `out/<name>/` (seconds; use it to check layout)
- `npm run render reels/<name>.json` — full video at `out/<name>.mp4` (about 3x the reel's length)
- Flags: `--silent` skips the voiceover; `--voice` forces it when a proxy injects the API key

## Making a reel

1. Write `reels/<slug>.json` (format below). Start from `reels/two-minute-rule.json`.
2. Run the preview, look at every still, fix overflow or awkward line breaks.
3. Run the full render, then send the MP4 to the user. `out/` is gitignored.

## Script format

```json
{
  "theme": "midnight",            // midnight | ember | paper | ultraviolet
  "handle": "@account",           // watermark and default CTA button
  "captions": true,               // word-synced captions of the narration
  "voice": { "id": "<ElevenLabs voice id>", "model": "eleven_multilingual_v2" },
  "scenes": [ { "type": "hook", "text": "...", "vo": "..." } ]
}
```

Scene types and their fields (`text` is on screen; `vo` is what is spoken):

| type    | fields                                   | use                              |
|---------|------------------------------------------|----------------------------------|
| `hook`  | `text`, `kicker` (pill label)            | first scene, largest type        |
| `point` | `text`, `kicker` (e.g. "01"), `sub`      | one idea plus a supporting line  |
| `stat`  | `value` (e.g. "2 min", "80%"), `text`    | a number that counts up          |
| `quote` | `text`, `author`                         | quotation                        |
| `cta`   | `text`, `sub`, `button`                  | last scene                       |

- `*word*` in `text`/`sub` renders in the accent colour and serif italic. Use one per scene.
- `vo` defaults to the on-screen text; `"vo": ""` makes a scene silent. Scene length follows
  the narration; `duration` sets a minimum and `hold` adds seconds.
- Text shrinks to fit automatically, but short reads better: headlines of 3 to 7 words.

## Writing guidelines

- 20 to 35 seconds, 5 to 7 scenes. The hook must work in the first 1.5 seconds.
- On-screen text is the headline; put the fuller sentence in `vo`.
- Only state facts that are verifiable. No invented statistics or quotes.
- Keep content inside the template's safe area; Instagram UI covers the top ~250px and bottom ~420px.

## Voiceover

ElevenLabs (`src/tts.mjs`), key in `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`.
Clips are cached in `.cache/tts` by text and voice, so unchanged lines are not re-billed.
Without a key the render is silent and paced by a words-per-second estimate.

In Claude cloud sessions the key is a network secret on the `instagram_maxxing` environment and is
injected by the proxy, so no variable holds it. Render with:
`NODE_USE_ENV_PROXY=1 npm run render reels/<name>.json -- --voice`

## Layout

- `src/render.mjs` — spec → timeline → frames (parallel Playwright pages) → ffmpeg
- `src/template/` — the page: `reel.js` exposes `setup(timeline)` and `renderFrame(t)`;
  every animation is a pure function of `t` (no CSS animations), so frames render in any order
- New scene type: add it to `TYPES` in `render.mjs`, build it in `buildScene`, style it in `reel.css`
