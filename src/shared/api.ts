import type { Mat, PuzzleDef, V3 } from './puzzle';

export type Result = {
  moves: number;
  timeMs: number;
  stars: number;
};

export type Streak = {
  current: number;
  best: number;
};

export type DayStats = {
  plays: number;
  /** moves -> number of players who finished in that many moves */
  distribution: Record<string, number>;
  top: { name: string; moves: number; timeMs: number }[];
};

export type InitResponse = {
  type: 'init';
  date: string;
  /** set for community posts and for featured community dailies */
  custom: { def: PuzzleDef; key: string; kind: 'daily' | 'community' } | null;
  username: string | null;
  played: Result | null;
  streak: Streak;
  stats: DayStats;
};

export type SubmitRequest = {
  key: string;
  moves: string[];
  timeMs: number;
};

export type SubmitResponse = {
  type: 'submit';
  result: Result;
  firstTry: boolean;
  streak: Streak;
  stats: DayStats;
  rank: number | null;
};

export type PublishRequest = { title: string; pieces: { cells: V3[]; target: Mat }[] };
export type PublishResponse = { type: 'publish'; ok: true; url: string } | { type: 'publish'; ok: false; message: string };
export type CommentResponse = { type: 'comment'; ok: boolean };

export type ErrorResponse = { status: 'error'; message: string };
