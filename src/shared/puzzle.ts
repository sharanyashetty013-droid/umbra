// Umbra puzzle engine. Shared by client (play) and server (verify).
//
// A puzzle is 1-3 small block pieces standing in a row in front of a wall.
// A light shines straight at the wall, so each piece casts an exact
// grid-aligned shadow. Players turn pieces in 90° steps until the combined
// shadow matches the target outline. Everything is deterministic from the
// date, so every player gets the same puzzle each day.

export type V3 = [number, number, number];
export type Mat = number[]; // 3x3, row-major
export type Axis = 'x' | 'y' | 'z';
export type Move = { piece: number; axis: Axis; dir: 1 | -1 };

export type Piece = {
  cells: V3[]; // relative to the pivot cell (0,0,0)
  anchor: V3; // world position of the pivot
  color: number; // index into the client palette
  start: Mat;
  target: Mat; // one orientation whose shadow equals the target
  par: number; // fewest turns from start to a matching shadow
};

export type Puzzle = {
  key: string; // storage key: the date for dailies, "c:<id>" for community puzzles
  kind: 'daily' | 'community' | 'tutorial';
  title?: string;
  author?: string;
  date: string; // YYYY-MM-DD (UTC)
  number: number;
  difficulty: 'Gentle' | 'Steady' | 'Tricky' | 'Devious';
  pieces: Piece[];
  target: string[]; // sorted "x,y" wall cells
  par: number;
};

export const LAUNCH_DATE = '2026-11-20';
const SPACING = 3;

const ALL_KEYS = new Set<string>();
export const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const ROT: Record<Axis, Mat> = {
  x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
};

export function mul(a: Mat, b: Mat): Mat {
  const r: Mat = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
}

function transpose(m: Mat): Mat {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}

export function rotation(axis: Axis, dir: 1 | -1): Mat {
  return dir === 1 ? ROT[axis] : transpose(ROT[axis]);
}

/** Turn the piece 90° about a world axis. */
export function applyRotation(m: Mat, axis: Axis, dir: 1 | -1): Mat {
  return mul(rotation(axis, dir), m);
}

function apply(m: Mat, v: V3): V3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

const matKey = (m: Mat) => m.join(',');

/** Wall cells ("x,y") covered by one piece's shadow in orientation m. */
export function pieceShadow(cells: V3[], anchor: V3, m: Mat): string[] {
  const s = new Set<string>();
  for (const c of cells) {
    const w = apply(m, c);
    s.add(`${anchor[0] + w[0]},${anchor[1] + w[1]}`);
  }
  return [...s].sort();
}

export function shadowOf(pieces: Pick<Piece, 'cells' | 'anchor'>[], mats: Mat[]): string[] {
  const s = new Set<string>();
  pieces.forEach((p, i) => pieceShadow(p.cells, p.anchor, mats[i]!).forEach((k) => s.add(k)));
  return [...s].sort();
}

export const sameShadow = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Overlap score 0..1 (intersection over union) for the warmth meter. */
export function overlap(a: string[], b: string[]): number {
  const sb = new Set(b);
  let inter = 0;
  for (const k of a) if (sb.has(k)) inter++;
  const union = a.length + b.length - inter;
  return union === 0 ? 1 : inter / union;
}

const ALL_ORIENTATIONS: Mat[] = (() => {
  const seen = new Map<string, Mat>([[matKey(IDENTITY), IDENTITY]]);
  const queue = [IDENTITY];
  while (queue.length) {
    const m = queue.shift()!;
    for (const a of ['x', 'y', 'z'] as const) {
      const n = applyRotation(m, a, 1);
      if (!seen.has(matKey(n))) {
        seen.set(matKey(n), n);
        queue.push(n);
      }
    }
  }
  return [...seen.values()];
})();

/** Fewest 90° turns from `start` to any orientation whose shadow is `goal`. */
export function minTurns(cells: V3[], anchor: V3, start: Mat, goal: string[]): number {
  const dist = new Map<string, number>([[matKey(start), 0]]);
  const queue = [start];
  while (queue.length) {
    const m = queue.shift()!;
    const d = dist.get(matKey(m))!;
    if (sameShadow(pieceShadow(cells, anchor, m), goal)) return d;
    for (const a of ['x', 'y', 'z'] as const)
      for (const dir of [1, -1] as const) {
        const n = applyRotation(m, a, dir);
        if (!dist.has(matKey(n))) {
          dist.set(matKey(n), d + 1);
          queue.push(n);
        }
      }
  }
  return Infinity;
}

// ---------- seeded randomness ----------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- dates ----------

export function todayUTC(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dayIndex(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${LAUNCH_DATE}T00:00:00Z`)) / 86400000);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// ---------- generation ----------

const NEIGHBOURS: V3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function growShape(rand: () => number, size: number): V3[] {
  const cells: V3[] = [[0, 0, 0]];
  const has = (v: V3) => cells.some((c) => c[0] === v[0] && c[1] === v[1] && c[2] === v[2]);
  let guard = 0;
  while (cells.length < size && guard++ < 500) {
    const base = cells[Math.floor(rand() * cells.length)]!;
    const step = NEIGHBOURS[Math.floor(rand() * 6)]!;
    const next: V3 = [base[0] + step[0], base[1] + step[1], base[2] + step[2]];
    if (next.every((v) => Math.abs(v) <= 1) && !has(next)) cells.push(next);
  }
  return cells;
}

/** How many different shadows a shape can make; more = more interesting. */
function shadowVariety(cells: V3[]): number {
  return new Set(ALL_ORIENTATIONS.map((m) => pieceShadow(cells, [0, 0, 0], m).join('|'))).size;
}

type DayPlan = { pieces: number; sizes: [number, number]; minTurns: number; label: Puzzle['difficulty'] };

function planFor(date: string): DayPlan {
  // Monday gentle, weekend devious.
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun
  switch (dow) {
    case 1: return { pieces: 1, sizes: [4, 5], minTurns: 2, label: 'Gentle' };
    case 2: return { pieces: 2, sizes: [4, 4], minTurns: 1, label: 'Gentle' };
    case 3: return { pieces: 2, sizes: [4, 5], minTurns: 2, label: 'Steady' };
    case 4: return { pieces: 2, sizes: [5, 5], minTurns: 2, label: 'Steady' };
    case 5: return { pieces: 3, sizes: [4, 5], minTurns: 1, label: 'Tricky' };
    case 6: return { pieces: 3, sizes: [4, 5], minTurns: 2, label: 'Tricky' };
    default: return { pieces: 3, sizes: [5, 6], minTurns: 2, label: 'Devious' };
  }
}

const cache = new Map<string, Puzzle>();

export function puzzleFor(date: string): Puzzle {
  const hit = cache.get(date);
  if (hit) return hit;
  const rand = mulberry32(hashString(`umbra:${date}`));
  const plan = planFor(date);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const pieces: Piece[] = [];
  const colors = [0, 1, 2, 3].sort(() => rand() - 0.5);

  for (let i = 0; i < plan.pieces; i++) {
    const anchor: V3 = [(i - (plan.pieces - 1) / 2) * SPACING, 0, 0];
    for (let attempt = 0; attempt < 400; attempt++) {
      const size = plan.sizes[0] + Math.floor(rand() * (plan.sizes[1] - plan.sizes[0] + 1));
      const cells = growShape(rand, size);
      if (cells.length < size || shadowVariety(cells) < 8) continue;
      const target = pick(ALL_ORIENTATIONS);
      const start = pick(ALL_ORIENTATIONS);
      const goal = pieceShadow(cells, anchor, target);
      const par = minTurns(cells, anchor, start, goal);
      if (par < plan.minTurns || par === Infinity) continue;
      // Avoid a target that is just a flat line: it gives away nothing.
      if (new Set(goal.map((k) => k.split(',')[1])).size < 2) continue;
      if (new Set(goal.map((k) => k.split(',')[0])).size < 2) continue;
      pieces.push({ cells, anchor, color: colors[i % 4]!, start, target, par });
      break;
    }
  }

  const puzzle: Puzzle = {
    key: date,
    kind: 'daily',
    date,
    number: dayIndex(date) + 1,
    difficulty: plan.label,
    pieces,
    target: shadowOf(pieces, pieces.map((p) => p.target)),
    par: pieces.reduce((s, p) => s + p.par, 0),
  };
  cache.set(date, puzzle);
  return puzzle;
}

// ---------- moves ----------

export const encodeMove = (m: Move) => `${m.piece}${m.axis}${m.dir === 1 ? '+' : '-'}`;

export function decodeMove(s: string): Move | null {
  const r = /^([0-2])([xyz])([+-])$/.exec(s);
  if (!r) return null;
  const axis = r[2];
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') return null;
  return { piece: Number(r[1]), axis, dir: r[3] === '+' ? 1 : -1 };
}

/** Replay a move list from the start; returns final orientations or null if invalid. */
export function replay(p: Puzzle, moves: string[]): Mat[] | null {
  const mats = p.pieces.map((x) => x.start);
  for (const s of moves) {
    const m = decodeMove(s);
    if (!m || m.piece >= mats.length) return null;
    mats[m.piece] = applyRotation(mats[m.piece]!, m.axis, m.dir);
  }
  return mats;
}

export function isSolved(p: Puzzle, mats: Mat[]): boolean {
  return sameShadow(shadowOf(p.pieces, mats), p.target);
}

export function starsFor(moves: number, par: number): number {
  if (moves <= par) return 3;
  if (moves <= par + 3) return 2;
  return 1;
}

// ---------- community puzzles ----------

export type PieceDef = { cells: V3[]; target: Mat; start?: Mat };
export type PuzzleDef = { title: string; author: string; pieces: PieceDef[] };

export const anchorFor = (i: number, n: number): V3 => [(i - (n - 1) / 2) * SPACING, 0, 0];

export function isOrientation(m: unknown): m is Mat {
  if (!Array.isArray(m) || m.length !== 9) return false;
  if (!ALL_KEYS.size) ALL_ORIENTATIONS.forEach((o) => ALL_KEYS.add(matKey(o)));
  return ALL_KEYS.has(m.join(','));
}

export function connected(cells: V3[]): boolean {
  const key = (c: V3) => c.join(',');
  const all = new Set(cells.map(key));
  const seen = new Set<string>([key(cells[0]!)]);
  const stack = [cells[0]!];
  while (stack.length) {
    const c = stack.pop()!;
    for (const n of NEIGHBOURS) {
      const k = `${c[0] + n[0]},${c[1] + n[1]},${c[2] + n[2]}`;
      if (all.has(k) && !seen.has(k)) {
        seen.add(k);
        const [x = 0, y = 0, z = 0] = k.split(',').map(Number);
        stack.push([x, y, z]);
      }
    }
  }
  return seen.size === all.size;
}

/** Hardest start orientation for a piece (most turns needed). Deterministic. */
export function scramble(cells: V3[], anchor: V3, target: Mat): { start: Mat; par: number } {
  const goal = pieceShadow(cells, anchor, target);
  let best = { start: target, par: 0 };
  for (const m of ALL_ORIENTATIONS) {
    const par = minTurns(cells, anchor, m, goal);
    if (par > best.par && par !== Infinity) best = { start: m, par };
  }
  return best;
}

/** Returns an error message, or null if the definition is a fair puzzle. */
export function validateDef(def: unknown): string | null {
  if (!def || typeof def !== 'object') return 'Missing puzzle';
  const d = def as Partial<PuzzleDef>;
  if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 40) return 'Give it a name (up to 40 letters)';
  if (!Array.isArray(d.pieces) || d.pieces.length < 1 || d.pieces.length > 3) return 'Use 1 to 3 pieces';
  for (const p of d.pieces) {
    if (!p || !Array.isArray(p.cells) || p.cells.length < 2 || p.cells.length > 8) return 'Each piece needs 2 to 8 blocks';
    const seen = new Set<string>();
    for (const c of p.cells) {
      if (!Array.isArray(c) || c.length !== 3 || !c.every((v) => Number.isInteger(v) && Math.abs(v) <= 1))
        return 'Blocks must stay inside the 3×3×3 space';
      const k = c.join(',');
      if (seen.has(k)) return 'Two blocks in one spot';
      seen.add(k);
    }
    if (!seen.has('0,0,0')) return 'Each piece needs its centre block';
    if (!connected(p.cells)) return 'Blocks in a piece must touch';
    if (!isOrientation(p.target)) return 'Bad pose';
  }
  return null;
}

/** Build a playable puzzle from a community definition. */
export function fromDef(def: PuzzleDef, key: string, date: string): Puzzle {
  const n = def.pieces.length;
  const pieces: Piece[] = def.pieces.map((d, i) => {
    const anchor = anchorFor(i, n);
    const goal = pieceShadow(d.cells, anchor, d.target);
    const start = d.start && isOrientation(d.start) ? d.start : scramble(d.cells, anchor, d.target).start;
    return { cells: d.cells, anchor, color: i % 4, start, target: d.target, par: minTurns(d.cells, anchor, start, goal) };
  });
  return {
    key,
    kind: 'community',
    title: def.title,
    author: def.author,
    date,
    number: dayIndex(date) + 1,
    difficulty: n >= 3 ? 'Tricky' : n === 2 ? 'Steady' : 'Gentle',
    pieces,
    target: shadowOf(pieces, pieces.map((p) => p.target)),
    par: pieces.reduce((s, p) => s + p.par, 0),
  };
}

/** One best next move toward the goal (for coaching), or null when solved. */
export function nextMove(p: Puzzle, mats: Mat[]): Move | null {
  for (let i = 0; i < p.pieces.length; i++) {
    const pc = p.pieces[i]!;
    const goal = pieceShadow(pc.cells, pc.anchor, pc.target);
    const d0 = minTurns(pc.cells, pc.anchor, mats[i]!, goal);
    if (d0 === 0) continue;
    for (const axis of ['y', 'x', 'z'] as const)
      for (const dir of [1, -1] as const) {
        if (minTurns(pc.cells, pc.anchor, applyRotation(mats[i]!, axis, dir), goal) < d0) return { piece: i, axis, dir };
      }
  }
  return null;
}

/** A fixed two-move puzzle used to teach the controls. */
export function tutorialPuzzle(): Puzzle {
  const cells: V3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 1], [-1, 0, 0]];
  const target = IDENTITY;
  const start = applyRotation(applyRotation(IDENTITY, 'x', 1), 'y', 1);
  const p = fromDef({ title: 'Tutorial', author: '', pieces: [{ cells, target, start }] }, 'tutorial', todayUTC());
  return { ...p, kind: 'tutorial', difficulty: 'Gentle' };
}
