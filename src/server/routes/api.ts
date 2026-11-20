import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  CommentResponse,
  DayStats,
  ErrorResponse,
  InitResponse,
  PublishRequest,
  PublishResponse,
  Result,
  Streak,
  SubmitRequest,
  SubmitResponse,
} from '../../shared/api';
import {
  addDays,
  anchorFor,
  isSolved,
  replay,
  scramble,
  starsFor,
  todayUTC,
  validateDef,
  type PuzzleDef,
} from '../../shared/puzzle';
import { createCommunityPost } from '../core/post';
import { loadPostPuzzle, ugcKey } from '../core/puzzles';

export const api = new Hono();

const MAX_TIME = 9_999_999;
const DAILY_PUBLISH_LIMIT = 3;
const keys = {
  result: (key: string, user: string) => `res:${key}:${user}`,
  dist: (key: string) => `dist:${key}`,
  board: (key: string) => `board:${key}`,
  streak: (user: string) => `streak:${user}`,
};

function parseResult(raw: string | undefined): Result | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && 'moves' in v && 'timeMs' in v && 'stars' in v) {
      const { moves, timeMs, stars } = v;
      if (typeof moves === 'number' && typeof timeMs === 'number' && typeof stars === 'number')
        return { moves, timeMs, stars };
    }
  } catch {
    /* corrupt value */
  }
  return null;
}

async function readStreak(user: string | null): Promise<Streak & { last: string }> {
  if (!user) return { current: 0, best: 0, last: '' };
  const h = await redis.hGetAll(keys.streak(user));
  return { current: Number(h.current ?? 0), best: Number(h.best ?? 0), last: h.last ?? '' };
}

async function readStats(key: string): Promise<DayStats> {
  const [dist, plays, top] = await Promise.all([
    redis.hGetAll(keys.dist(key)),
    redis.zCard(keys.board(key)),
    redis.zRange(keys.board(key), 0, 4, { by: 'rank' }),
  ]);
  return {
    plays,
    distribution: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, Number(v)])),
    top: top.map((t) => ({ name: t.member, moves: Math.floor(t.score / 1e7), timeMs: t.score % 1e7 })),
  };
}

api.get('/init', async (c) => {
  try {
    const { puzzle, def } = await loadPostPuzzle();
    const username = (await reddit.getCurrentUsername()) ?? null;
    const [played, streak, stats] = await Promise.all([
      username ? redis.get(keys.result(puzzle.key, username)).then(parseResult) : Promise.resolve(null),
      readStreak(username),
      readStats(puzzle.key),
    ]);
    const alive = streak.last === todayUTC() || streak.last === addDays(todayUTC(), -1);
    return c.json<InitResponse>({
      type: 'init',
      date: puzzle.date,
      custom: def
        ? {
            // ship the exact start orientations so client and server agree
            def: { ...def, pieces: puzzle.pieces.map((p) => ({ cells: p.cells, target: p.target, start: p.start })) },
            key: puzzle.key,
            kind: puzzle.kind === 'community' ? 'community' : 'daily',
          }
        : null,
      username,
      played,
      streak: { current: alive ? streak.current : 0, best: streak.best },
      stats,
    });
  } catch (error) {
    console.error('init failed', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'init failed' }, 500);
  }
});

api.post('/submit', async (c) => {
  console.log('submit: start');
  const body = await c.req.json<SubmitRequest>().catch(() => null);
  const { puzzle } = await loadPostPuzzle();
  if (!body || body.key !== puzzle.key || !Array.isArray(body.moves) || body.moves.length > 400) {
    return c.json<ErrorResponse>({ status: 'error', message: 'bad request' }, 400);
  }
  const moves = body.moves.filter((m): m is string => typeof m === 'string');
  const mats = replay(puzzle, moves);
  if (!mats || !isSolved(puzzle, mats)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'that does not cast the shape' }, 400);
  }

  const username = (await reddit.getCurrentUsername()) ?? null;
  const timeMs = Math.max(0, Math.min(MAX_TIME, Math.round(Number(body.timeMs) || 0)));
  const fresh: Result = { moves: moves.length, timeMs, stars: starsFor(moves.length, puzzle.par) };
  if (!username) {
    return c.json<SubmitResponse>({
      type: 'submit',
      result: fresh,
      firstTry: true,
      streak: { current: 0, best: 0 },
      stats: await readStats(puzzle.key),
      rank: null,
    });
  }

  const resultKey = keys.result(puzzle.key, username);
  const prev = parseResult(await redis.get(resultKey));
  let streak = await readStreak(username);

  if (!prev) {
    await redis.set(resultKey, JSON.stringify(fresh));
    await redis.expire(resultKey, 60 * 60 * 24 * 120);
    await redis.hIncrBy(keys.dist(puzzle.key), String(fresh.moves), 1);
    await redis.zAdd(keys.board(puzzle.key), { member: username, score: fresh.moves * 1e7 + fresh.timeMs });

    // Streaks count the daily puzzle only, on the day it's live.
    if (puzzle.kind === 'daily' && puzzle.date === todayUTC()) {
      const date = puzzle.date;
      const current =
        streak.last === addDays(date, -1) ? streak.current + 1 : streak.last === date ? streak.current : 1;
      streak = { current, best: Math.max(streak.best, current), last: date };
      await redis.hSet(keys.streak(username), { current: String(current), best: String(streak.best), last: date });
      if (context.subredditName) {
        // fire and forget: flair is a bonus and must not delay the result
        void reddit
          .setUserFlair({
            subredditName: context.subredditName,
            username,
            text: `Shadowcaster · ${current} day${current === 1 ? '' : 's'}`,
            backgroundColor: '#f0b54a',
            textColor: 'dark',
          })
          .catch((e: unknown) => console.log('flair skipped', e));
      }
    }
  }

  const rank = await redis.zRank(keys.board(puzzle.key), username);
  console.log(`submit: saved ${username} ${fresh.moves} moves`);
  return c.json<SubmitResponse>({
    type: 'submit',
    result: prev ?? fresh,
    firstTry: !prev,
    streak: { current: streak.current, best: streak.best },
    stats: await readStats(puzzle.key),
    rank: typeof rank === 'number' ? rank + 1 : null,
  });
});

api.post('/comment', async (c) => {
  const { postId } = context;
  const { puzzle } = await loadPostPuzzle();
  const username = (await reddit.getCurrentUsername()) ?? null;
  if (!postId || !username) return c.json<CommentResponse>({ type: 'comment', ok: false });
  const r = parseResult(await redis.get(keys.result(puzzle.key, username)));
  if (!r) return c.json<CommentResponse>({ type: 'comment', ok: false });
  const stars = `${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`;
  const name = puzzle.kind === 'community' ? `"${puzzle.title ?? ''}"` : `Umbra No. ${puzzle.number}`;
  try {
    await reddit.submitComment({ id: postId, text: `${name}: cast in ${r.moves} (par ${puzzle.par}) ${stars}`, runAs: 'USER' });
    return c.json<CommentResponse>({ type: 'comment', ok: true });
  } catch (error) {
    console.error('comment failed', error);
    return c.json<CommentResponse>({ type: 'comment', ok: false });
  }
});

api.post('/publish', async (c) => {
  const fail = (message: string) => c.json<PublishResponse>({ type: 'publish', ok: false, message });
  const username = (await reddit.getCurrentUsername()) ?? null;
  if (!username) return fail('Log in to publish a shadow');
  const body = await c.req.json<PublishRequest>().catch(() => null);
  if (!body) return fail('Something went wrong');

  const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
  const draft = { title, author: username, pieces: Array.isArray(body.pieces) ? body.pieces : [] };
  const problem = validateDef(draft);
  if (problem) return fail(problem);

  const n = draft.pieces.length;
  const pieces = draft.pieces.map((p, i) => {
    const { start, par } = scramble(p.cells, anchorFor(i, n), p.target);
    return { cells: p.cells, target: p.target, start, par };
  });
  if (pieces.reduce((s, p) => s + p.par, 0) < 2) return fail('Too easy: try a pose that looks different from most angles');

  const today = todayUTC();
  const quotaKey = `ugc-quota:${username}:${today}`;
  const used = await redis.incrBy(quotaKey, 1);
  await redis.expire(quotaKey, 60 * 60 * 26);
  if (used > DAILY_PUBLISH_LIMIT) return fail(`You can publish ${DAILY_PUBLISH_LIMIT} shadows a day`);

  const id = String(await redis.incrBy('ugc:next', 1));
  const def: PuzzleDef = { title, author: username, pieces: pieces.map(({ cells, target, start }) => ({ cells, target, start })) };
  await redis.set(ugcKey(id), JSON.stringify(def));
  try {
    const post = await createCommunityPost(id, def);
    await redis.zAdd('ugc:recent', { member: id, score: Date.now() });
    await redis.hSet('ugc:post', { [id]: post.id });
    return c.json<PublishResponse>({ type: 'publish', ok: true, url: post.url });
  } catch (error) {
    console.error('publish failed', error);
    return fail("Couldn't create the post");
  }
});
