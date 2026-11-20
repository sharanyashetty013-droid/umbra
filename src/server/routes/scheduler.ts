import { Hono } from 'hono';
import { todayUTC } from '../../shared/puzzle';
import { createPost, pickFeatured } from '../core/post';

export const scheduler = new Hono();

// Runs every day just after midnight UTC (see devvit.json).
scheduler.post('/daily-post', async (c) => {
  try {
    const date = todayUTC();
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) {
      const id = await pickFeatured(date);
      console.log(`community sunday: ${id ?? 'none, using generated puzzle'}`);
    }
    const post = await createPost(date);
    console.log(`daily post ${post.id}`);
    return c.json({ status: 'ok' }, 200);
  } catch (error) {
    console.error('daily post failed', error);
    return c.json({ status: 'error' }, 500);
  }
});
