---
description: Write, render, and deliver a new reel on a topic
argument-hint: <topic or idea>
---
Make a new Instagram reel about: $ARGUMENTS

Follow "Making a reel" and "Writing guidelines" in CLAUDE.md:

1. Write `reels/<slug>.json`. Check any factual claim before using it.
2. Run `npm run preview reels/<slug>.json` and look at every still. Fix anything that reads badly.
3. Run `npm run render reels/<slug>.json` and send `out/<slug>.mp4` to the user.
4. Give the user a caption and 5 to 8 hashtags to post with it.
5. Commit the script.
