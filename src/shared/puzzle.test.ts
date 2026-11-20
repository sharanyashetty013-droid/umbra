import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzleFor, addDays, isSolved, replay, shadowOf, sameShadow, minTurns, pieceShadow } from './puzzle.ts';

test('90 days of puzzles are valid, solvable and deterministic', () => {
  const pars: Record<string, number[]> = {};
  for (let i = 0; i < 90; i++) {
    const d = addDays('2026-11-20', i);
    const p = puzzleFor(d);
    const plan = new Date(d + 'T00:00:00Z').getUTCDay();
    assert.ok(p.pieces.length >= 1, d);
    assert.ok(isSolved(p, p.pieces.map((x) => x.target)), 'target solves ' + d);
    assert.ok(!isSolved(p, p.pieces.map((x) => x.start)), 'start not solved ' + d);
    for (const pc of p.pieces) {
      assert.equal(minTurns(pc.cells, pc.anchor, pc.start, pieceShadow(pc.cells, pc.anchor, pc.target)), pc.par);
      assert.ok(pc.par >= 1 && pc.par <= 3);
    }
    assert.ok(sameShadow(shadowOf(p.pieces, p.pieces.map((x) => x.target)), p.target));
    (pars[plan] ??= []).push(p.par * 10 + p.pieces.length);
  }
  console.log(pars);
});

test('replay rejects junk', () => {
  const p = puzzleFor('2026-11-21');
  assert.equal(replay(p, ['9x+']), null);
  assert.equal(replay(p, ['hello']), null);
});

import { tutorialPuzzle, validateDef, fromDef, nextMove, scramble, anchorFor, IDENTITY } from './puzzle.ts';
test('tutorial is two moves and coachable', () => {
  const t = tutorialPuzzle();
  console.log('tutorial par', t.par, nextMove(t, t.pieces.map((p) => p.start)));
  assert.equal(t.par, 2);
});
test('community defs validate and build', () => {
  const good = { title: 'Duck', author: 'me', pieces: [{ cells: [[0,0,0],[1,0,0],[1,1,0],[0,0,1]], target: IDENTITY }] };
  assert.equal(validateDef(good), null);
  const p = fromDef(good as never, 'c:1', '2026-11-22');
  assert.ok(p.par >= 1);
  assert.equal(validateDef({ ...good, pieces: [{ cells: [[0,0,0],[1,1,1]], target: IDENTITY }] }), 'Blocks in a piece must touch');
  assert.equal(validateDef({ ...good, pieces: [{ cells: [[0,0,0],[2,0,0]], target: IDENTITY }] }), 'Blocks must stay inside the 3×3×3 space');
  assert.equal(validateDef({ ...good, pieces: [{ cells: [[0,0,0],[1,0,0]], target: [1,0,0,0,1,0,0,0,2] }] }), 'Bad pose');
  // a straight bar has symmetric shadows but still scrambles
  console.log('bar', scramble([[0,0,0],[1,0,0]], anchorFor(0,1), IDENTITY).par);
});
