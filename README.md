# Umbra

A daily 3D shadow puzzle for Reddit (Devvit Web). Turn the block pieces until their shadow on the wall fills the gold outline.

- New puzzle every day (UTC), same for everyone. Monday is gentle, Sunday is devious.
- Every puzzle is checked to be solvable, with a computed par.
- Streaks, user flair, move distribution, a top-3 board, and "Post my result" as a comment.
- The server replays your moves to verify the solve, so scores can't be faked.
- Guided tutorial on first play (coaches the next move, glowing button).
- Shape Builder: players build 1-3 block pieces, pose the shadow, test play, and publish it as a new post. The most upvoted player shadow each week becomes Community Sunday's daily, credited to its maker.
- Synthesized sound (with mute) and haptics.

## Run it

```bash
npm install
npm run login      # log in to Reddit once
npm run dev        # playtest on your test subreddit
```

To test only the game in a normal browser: `npm run build`, then serve `dist/client` and open `game.html` (it falls back to local storage when there is no Reddit server).

## Controls

Swipe (or arrow keys) to turn, Q/E to twist, tap a piece or press 1-3 to select it, Z to undo.

## Code map

- `src/shared/puzzle.ts`: puzzle generator, rotations, shadow maths, par solver
- `src/client/stage.ts`: three.js scene (light, wall, shadows, animations)
- `src/client/game.ts`: game flow, controls, intro and result screens
- `src/client/builder.ts`: Shape Builder logic (add/erase blocks, pose, publish request)
- `src/client/sfx.ts`: sounds and vibration
- `src/client/splash.ts`: the light card shown in the feed
- `src/server/routes/api.ts`: init, submit (verified), streaks, stats, comment
- `src/server/core/puzzles.ts`: which puzzle a post shows (daily, community, featured)
- `src/server/routes/scheduler.ts`: posts a new puzzle every day at 00:05 UTC, picks Community Sunday
