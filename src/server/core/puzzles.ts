import { context, redis } from '@devvit/web/server';
import { fromDef, puzzleFor, todayUTC, type Puzzle, type PuzzleDef } from '../../shared/puzzle';

export type Loaded = {
  puzzle: Puzzle;
  /** the community definition, when the puzzle is not generated from the date */
  def: PuzzleDef | null;
};

export const ugcKey = (id: string) => `ugc:${id}`;
export const featureKey = (date: string) => `feature:${date}`;

export function parseDef(raw: string | undefined): PuzzleDef | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && 'pieces' in v && 'title' in v && 'author' in v) {
      const { pieces, title, author } = v;
      if (Array.isArray(pieces) && typeof title === 'string' && typeof author === 'string')
        return { pieces, title, author };
    }
  } catch {
    /* corrupt value */
  }
  return null;
}

function postDate(): string {
  const d = context.postData?.date;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayUTC();
}

/** Work out which puzzle this post shows. */
export async function loadPostPuzzle(): Promise<Loaded> {
  const ugc = context.postData?.ugc;
  const date = postDate();
  if (typeof ugc === 'string') {
    const def = parseDef(await redis.get(ugcKey(ugc)));
    if (def) return { puzzle: fromDef(def, `c:${ugc}`, date), def };
  }
  // Community Sunday: a featured player-made puzzle replaces the generated one.
  const featured = await redis.get(featureKey(date));
  if (featured) {
    const def = parseDef(await redis.get(ugcKey(featured)));
    if (def) return { puzzle: { ...fromDef(def, date, date), kind: 'daily' }, def };
  }
  return { puzzle: puzzleFor(date), def: null };
}
