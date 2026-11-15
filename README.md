# instagram_maxxing

Instagram reels generated from code: write a JSON script, get a 9:16 MP4 with animated text,
word-synced captions, and an AI voiceover.

```bash
npm install
npm run render reels/two-minute-rule.json   # -> out/two-minute-rule.mp4
```

Needs Node 22+, ffmpeg, and Chromium (`npx playwright install chromium`). Set
`ELEVENLABS_API_KEY` for the voiceover; without it the reel renders silent.

With Claude Code, run `/reel <topic>` to have a reel written, rendered, and delivered.
The script format and conventions are in [CLAUDE.md](CLAUDE.md).
