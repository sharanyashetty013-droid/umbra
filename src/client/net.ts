import type {
  CommentResponse,
  PublishRequest,
  PublishResponse,
  DayStats,
  InitResponse,
  Result,
  Streak,
  SubmitRequest,
  SubmitResponse,
} from '../shared/api';
import { addDays, replay, isSolved, starsFor, todayUTC, type Puzzle } from '../shared/puzzle';

// When the game runs outside Reddit (local preview), everything falls back to
// localStorage so it is still fully playable.
export let offline = false;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`umbra:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(`umbra:${key}`, v);
    } catch {
      /* storage can be unavailable; the game still works */
    }
  },
};

const emptyStats = (): DayStats => ({ plays: 0, distribution: {}, top: [] });

function readJSON<T>(key: string, fallback: T): T {
  const raw = store.get(key);
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}

function localInit(): InitResponse {
  const date = todayUTC();
  const played = readJSON<Result | null>(`res:${date}`, null);
  return {
    type: 'init',
    date,
    custom: null,
    username: null,
    played: played && typeof played.moves === 'number' ? played : null,
    streak: readJSON<Streak>('streak', { current: 0, best: 0 }),
    stats: readJSON<DayStats>(`stats:${date}`, emptyStats()),
  };
}

function localSubmit(req: SubmitRequest, p: Puzzle): SubmitResponse {
  const mats = replay(p, req.moves);
  if (!mats || !isSolved(p, mats)) throw new Error('not solved');
  const prev = readJSON<Result | null>(`res:${p.key}`, null);
  const result: Result = { moves: req.moves.length, timeMs: req.timeMs, stars: starsFor(req.moves.length, p.par) };
  const streakRaw = readJSON<Streak & { last?: string }>('streak', { current: 0, best: 0 });
  let streak: Streak = { current: streakRaw.current, best: streakRaw.best };
  const stats = readJSON<DayStats>(`stats:${p.key}`, emptyStats());
  if (!prev) {
    store.set(`res:${p.key}`, JSON.stringify(result));
    if (p.kind === 'daily') {
      const current = streakRaw.last === addDays(p.date, -1) ? streakRaw.current + 1 : streakRaw.last === p.date ? streakRaw.current : 1;
      streak = { current, best: Math.max(streakRaw.best, current) };
      store.set('streak', JSON.stringify({ ...streak, last: p.date }));
    }
    stats.plays += 1;
    stats.distribution[String(result.moves)] = (stats.distribution[String(result.moves)] ?? 0) + 1;
    store.set(`stats:${p.key}`, JSON.stringify(stats));
  }
  return { type: 'submit', result: prev ?? result, firstTry: !prev, streak, stats, rank: null };
}

export async function init(): Promise<InitResponse> {
  try {
    const r = await fetch('/api/init', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(String(r.status));
    const data: InitResponse = await r.json();
    if (data.type !== 'init') throw new Error('bad init');
    return data;
  } catch {
    offline = true;
    return localInit();
  }
}

export async function submit(req: SubmitRequest, p: Puzzle): Promise<SubmitResponse> {
  if (offline) return localSubmit(req, p);
  const r = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`submit ${r.status}`);
  return r.json();
}

export async function postComment(date: string): Promise<boolean> {
  if (offline) return false;
  const r = await fetch('/api/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: date }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return false;
  const data: CommentResponse = await r.json();
  return data.ok;
}

export async function publish(req: PublishRequest): Promise<PublishResponse> {
  if (offline) return { type: 'publish', ok: false, message: 'Publishing works once this runs on Reddit' };
  try {
    const r = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return await r.json();
  } catch {
    return { type: 'publish', ok: false, message: 'Network error, try again' };
  }
}
