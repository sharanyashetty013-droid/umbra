import { context, redis, reddit } from '@devvit/web/server';
import { puzzleFor, todayUTC, type PuzzleDef } from '../../shared/puzzle';
import { featureKey, parseDef, ugcKey } from './puzzles';

const subreddit = () => context.subredditName ?? '';

export const createPost = async (date = todayUTC()) => {
  const p = puzzleFor(date);
  const featured = await redis.get(featureKey(date));
  const def = featured ? parseDef(await redis.get(ugcKey(featured))) : null;
  const title = def
    ? `Umbra No. ${p.number}: Community Sunday, "${def.title}" by u/${def.author}`
    : `Umbra No. ${p.number}: today's shadow (${p.difficulty}, par ${p.par})`;
  return await reddit.submitCustomPost({
    subredditName: subreddit(),
    title,
    postData: { date },
    textFallback: { text: `Umbra No. ${p.number}. Turn the pieces until their shadow matches the outline.` },
  });
};

export const createCommunityPost = async (id: string, def: PuzzleDef) =>
  await reddit.submitCustomPost({
    subredditName: subreddit(),
    title: `"${def.title}", a shadow by u/${def.author}`,
    postData: { date: todayUTC(), ugc: id },
    textFallback: { text: `A player-made Umbra puzzle: "${def.title}" by u/${def.author}.` },
  });

/** Sundays: feature last week's most upvoted player-made shadow. */
export async function pickFeatured(date: string): Promise<string | null> {
  const now = Date.now();
  const recent = await redis.zRange('ugc:recent', now - 7 * 86400000, now, { by: 'score' });
  const posts = await redis.hGetAll('ugc:post');
  const already = await redis.hGetAll('ugc:featured');
  let best: { id: string; score: number } | null = null;
  for (const { member: id } of recent.slice(-60)) {
    const postId = posts[id];
    if (!postId || already[id]) continue;
    const post = await reddit.getPostById(`t3_${postId.replace(/^t3_/, '')}`).catch(() => null);
    if (post && (!best || post.score > best.score)) best = { id, score: post.score };
  }
  if (!best) return null;
  await redis.set(featureKey(date), best.id);
  await redis.hSet('ugc:featured', { [best.id]: date });
  return best.id;
}
