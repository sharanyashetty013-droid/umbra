import type { PublishRequest } from '../shared/api';
import {
  anchorFor,
  applyRotation,
  connected,
  IDENTITY,
  scramble,
  shadowOf,
  type Axis,
  type Mat,
  type V3,
} from '../shared/puzzle';
import type { Stage, StagePiece } from './stage';

type Draft = { cells: V3[]; mat: Mat };
export type EditResult = 'added' | 'removed' | 'selected' | 'none' | { blocked: string };

const MAX_BLOCKS = 8;
const same = (a: V3, b: V3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Shape Builder: players make their own puzzle and pose its shadow. */
export class Builder {
  pieces: Draft[] = [{ cells: [[0, 0, 0], [0, 1, 0], [1, 0, 0]], mat: IDENTITY }];
  selected = 0;
  erase = false;
  private history: string[] = [];

  constructor(private stage: Stage) {}

  open() {
    this.refresh();
  }

  private snapshot() {
    this.history.push(JSON.stringify({ pieces: this.pieces, selected: this.selected }));
    if (this.history.length > 60) this.history.shift();
  }

  undo(): boolean {
    const last = this.history.pop();
    if (!last) return false;
    const v: { pieces: Draft[]; selected: number } = JSON.parse(last);
    this.pieces = v.pieces;
    this.selected = v.selected;
    this.refresh();
    return true;
  }

  stagePieces(): StagePiece[] {
    const n = this.pieces.length;
    return this.pieces.map((p, i) => ({ cells: p.cells, anchor: anchorFor(i, n), color: i, mat: p.mat }));
  }

  refresh() {
    this.stage.setPieces(this.stagePieces());
    this.stage.select(this.selected);
    this.stage.showGrid(true);
  }

  select(i: number) {
    if (i < 0 || i >= this.pieces.length) return;
    this.selected = i;
    this.stage.select(i);
  }

  tap(x: number, y: number): EditResult {
    const hit = this.stage.pickFace(x, y);
    if (!hit) return 'none';
    if (hit.piece !== this.selected) {
      this.select(hit.piece);
      return 'selected';
    }
    const piece = this.pieces[hit.piece]!;
    if (this.erase) {
      if (same(hit.cell, [0, 0, 0])) return { blocked: "That's the centre block, it has to stay" };
      if (piece.cells.length <= 2) return { blocked: 'A piece needs at least 2 blocks' };
      const rest = piece.cells.filter((c) => !same(c, hit.cell));
      if (!connected(rest)) return { blocked: 'That would split the piece in two' };
      this.snapshot();
      piece.cells = rest;
    } else {
      const next: V3 = [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]];
      if (piece.cells.length >= MAX_BLOCKS) return { blocked: `Max ${MAX_BLOCKS} blocks per piece` };
      if (next.some((v) => Math.abs(v) > 1)) return { blocked: 'Stay inside the box' };
      if (piece.cells.some((c) => same(c, next))) return { blocked: 'There is already a block there' };
      this.snapshot();
      piece.cells = [...piece.cells, next];
    }
    this.refresh();
    return this.erase ? 'removed' : 'added';
  }

  turn(axis: Axis, dir: 1 | -1) {
    const p = this.pieces[this.selected];
    if (!p) return;
    this.snapshot();
    p.mat = applyRotation(p.mat, axis, dir);
    this.stage.turn(this.selected, p.mat);
  }

  addPiece(): boolean {
    if (this.pieces.length >= 3) return false;
    this.snapshot();
    this.pieces.push({ cells: [[0, 0, 0], [1, 0, 0]], mat: IDENTITY });
    this.selected = this.pieces.length - 1;
    this.refresh();
    return true;
  }

  removePiece(): boolean {
    if (this.pieces.length <= 1) return false;
    this.snapshot();
    this.pieces.splice(this.selected, 1);
    this.selected = Math.max(0, this.selected - 1);
    this.refresh();
    return true;
  }

  shadow(): string[] {
    const sp = this.stagePieces();
    return shadowOf(sp, sp.map((p) => p.mat));
  }

  /** Par the puzzle would have once scrambled. */
  par(): number {
    const n = this.pieces.length;
    return this.pieces.reduce((s, p, i) => s + scramble(p.cells, anchorFor(i, n), p.mat).par, 0);
  }

  request(title: string): PublishRequest {
    return { title, pieces: this.pieces.map((p) => ({ cells: p.cells, target: p.mat })) };
  }
}
