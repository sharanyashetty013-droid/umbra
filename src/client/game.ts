import { navigateTo, showShareSheet, showToast } from '@devvit/web/client';
import type { DayStats, InitResponse, Result, Streak } from '../shared/api';
import {
  applyRotation,
  encodeMove,
  fromDef,
  isSolved,
  nextMove,
  overlap,
  puzzleFor,
  shadowOf,
  starsFor,
  tutorialPuzzle,
  type Axis,
  type Mat,
  type Puzzle,
} from '../shared/puzzle';
import { Builder } from './builder';
import { init, offline, postComment, publish, submit } from './net';
import { sfx } from './sfx';
import { silhouetteSVG } from './silhouette';
import { PIECE_CSS, Stage } from './stage';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};
const input = (id: string) => {
  const el = $(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return el;
};

const ICONS: Record<string, string> = {
  'z+': '<path d="M8 5H4v4"/><path d="M4.5 9A8 8 0 1 1 6 17"/>',
  'z-': '<path d="M16 5h4v4"/><path d="M19.5 9A8 8 0 1 0 18 17"/>',
  'y-': '<path d="M15 6l-6 6 6 6"/>',
  'y+': '<path d="M9 6l6 6-6 6"/>',
  'x-': '<path d="M6 15l6-6 6 6"/>',
  'x+': '<path d="M6 9l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/>',
};
const COACH: Record<string, string> = {
  'y+': 'Swipe right →',
  'y-': 'Swipe left ←',
  'x-': 'Swipe up ↑',
  'x+': 'Swipe down ↓',
  'z+': 'Twist left ⟲',
  'z-': 'Twist right ⟳',
};
const svg = (paths: string) => `<svg viewBox="0 0 24 24">${paths}</svg>`;
const STAR = '<path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L2.9 9.4l6.3-.9z"/>';

const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`umbra:${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`umbra:${k}`, v);
    } catch {
      /* ignore */
    }
  },
};

function toast(text: string) {
  if (!offline) {
    try {
      showToast(text);
      return;
    } catch {
      /* fall through to the in-page toast */
    }
  }
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  window.setTimeout(() => (t.hidden = true), 2400);
}

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const prettyDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const starText = (n: number) => `${'★'.repeat(n)}${'☆'.repeat(3 - n)}`;

/** daily: the post's puzzle (ranked on first solve) · fun: replay · tutorial · test: player's own build */
type Mode = 'daily' | 'fun' | 'tutorial' | 'test';
type State = {
  puzzle: Puzzle;
  mode: Mode;
  mats: Mat[];
  history: string[];
  selected: number;
  startedAt: number;
  solved: boolean;
};

let data: InitResponse;
let stage: Stage;
let main: Puzzle; // this post's puzzle
let st: State;
let builder: Builder | null = null;
let view: 'intro' | 'play' | 'result' | 'build' = 'intro';

const SCREENS = ['intro', 'result', 'tut-done', 'publish', 'hud', 'dock', 'build-hud', 'tools', 'hint', 'coach'];
function show(...ids: string[]) {
  for (const id of SCREENS) $(id).hidden = !ids.includes(id);
}

// ---------- HUD ----------

function renderHud() {
  const p = st.puzzle;
  $('hud-meta').textContent =
    st.mode === 'tutorial'
      ? 'Tutorial'
      : st.mode === 'test'
        ? `Testing "${p.title ?? ''}"`
        : p.kind === 'community'
          ? `"${p.title ?? ''}" by u/${p.author ?? ''}`
          : `#${p.number} · ${p.difficulty}`;
  const moves = $('moves');
  moves.textContent = String(st.history.length);
  moves.classList.remove('bump');
  void moves.offsetWidth;
  moves.classList.add('bump');
  $('moves-label').textContent = `moves · par ${p.par}`;
  const shadow = shadowOf(p.pieces, st.mats);
  $('warmth').style.width = `${Math.round(overlap(shadow, p.target) * 100)}%`;
  stage.showCoverage(shadow);
  renderCoach();
}

function renderCoach() {
  document.querySelectorAll('.coach-on').forEach((el) => el.classList.remove('coach-on'));
  if (st.mode !== 'tutorial' || st.solved) {
    $('coach').hidden = true;
    return;
  }
  const m = nextMove(st.puzzle, st.mats);
  if (!m) return;
  const code = `${m.axis}${m.dir === 1 ? '+' : '-'}`;
  $('coach-text').textContent = COACH[code] ?? '';
  $('coach').hidden = false;
  document.querySelector(`.ctl[data-move="${code}"]`)?.classList.add('coach-on');
}

function renderChips() {
  const chips = $('chips');
  const n = view === 'build' ? 0 : st.puzzle.pieces.length;
  chips.innerHTML =
    n < 2
      ? ''
      : st.puzzle.pieces
          .map(
            (p, i) =>
              `<button class="chip" data-piece="${i}" aria-pressed="${i === st.selected}"><i style="background:${PIECE_CSS[p.color % 4]}"></i>Piece ${i + 1}</button>`,
          )
          .join('');
}

function renderMute() {
  $('mute').innerHTML = svg(sfx.muted ? (ICONS.muted ?? '') : (ICONS.sound ?? ''));
}

function select(i: number) {
  if (view === 'build') {
    builder?.select(i);
    renderBuildTabs();
    return;
  }
  if (i < 0 || i >= st.puzzle.pieces.length) return;
  st.selected = i;
  stage.select(i);
  renderChips();
}

// ---------- play ----------

function load(puzzle: Puzzle, mode: Mode) {
  st = {
    puzzle,
    mode,
    mats: puzzle.pieces.map((p) => p.start),
    history: [],
    selected: 0,
    startedAt: 0,
    solved: false,
  };
  stage.load(puzzle);
  stage.setShot('play');
  view = 'play';
  show('hud', 'dock');
  $('build-done').hidden = true;
  select(0);
  renderHud();
  $('hint').hidden = mode === 'tutorial' || local.get('seen-hint') === '1';
}

function turn(axis: Axis, dir: 1 | -1) {
  if (view === 'build') {
    builder?.turn(axis, dir);
    sfx.turn();
    return;
  }
  if (view !== 'play' || st.solved) return;
  if (!st.startedAt) st.startedAt = performance.now();
  const i = st.selected;
  st.mats[i] = applyRotation(st.mats[i]!, axis, dir);
  st.history.push(encodeMove({ piece: i, axis, dir }));
  stage.turn(i, st.mats[i]!);
  sfx.turn();
  $('hint').hidden = true;
  local.set('seen-hint', '1');
  renderHud();
  if (isSolved(st.puzzle, st.mats)) void win();
}

function undo() {
  if (view === 'build') {
    if (builder?.undo()) {
      sfx.undo();
      renderBuildTabs();
    }
    return;
  }
  if (view !== 'play' || st.solved) return;
  const last = st.history.pop();
  if (!last) return;
  const piece = Number(last[0]);
  const axis = last[1];
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') return;
  st.mats[piece] = applyRotation(st.mats[piece]!, axis, last[2] === '+' ? -1 : 1);
  stage.turn(piece, st.mats[piece]!);
  sfx.undo();
  select(piece);
  renderHud();
}

async function win() {
  st.solved = true;
  renderCoach();
  const timeMs = Math.round(performance.now() - st.startedAt);
  stage.celebrate();
  sfx.win();
  const moves = st.history.length;

  if (st.mode === 'tutorial') {
    local.set('tutorial-done', '1');
    window.setTimeout(() => show('tut-done'), 1400);
    return;
  }
  if (st.mode === 'test') {
    window.setTimeout(() => {
      $('pub-par').textContent = `It works! You solved it in ${moves} (par ${st.puzzle.par}). Ready to share it?`;
      openPublish(false);
    }, 1400);
    return;
  }

  const result: Result = { moves, timeMs, stars: starsFor(moves, st.puzzle.par) };
  const fun = st.mode === 'fun' ? moves : null;
  // The card never waits on the server: show it after the win animation,
  // and refresh it if the save comes back later.
  const ready = new Promise((r) => window.setTimeout(r, 1500));
  if (st.mode === 'daily') {
    const save = submit({ key: main.key, moves: st.history, timeMs }, main)
      .then((res) => {
        data = { ...data, played: res.result, streak: res.streak, stats: res.stats };
        return res;
      })
      .catch((e: unknown) => {
        console.error('submit failed', e);
        data = { ...data, played: result };
        return null;
      });
    await ready;
    showResult(result, data.streak, data.stats, null, null);
    const res = await save;
    if (res && view === 'result') showResult(res.result, res.streak, res.stats, res.rank, null);
    else if (!res) toast("Couldn't reach the server. Your result still counts here.");
    return;
  }
  await ready;
  const shown = data.played ?? result;
  showResult(shown, data.streak, data.stats, null, fun);
}

// ---------- intro and results ----------

function showIntro() {
  view = 'intro';
  const p = main;
  $('intro-kicker').textContent =
    p.kind === 'community' ? `A shadow by u/${p.author ?? ''}` : `No. ${p.number} · ${prettyDate(p.date)}`;
  $('intro-shape').innerHTML = silhouetteSVG(p.target, { size: 200, unit: 18 });
  $('stage-label').textContent = p.kind === 'community' ? `By u/${p.author ?? ''}` : "Today's shadow";
  $('intro-meta').innerHTML = [
    p.kind === 'community' ? `<span class="pill"><b>${p.title ?? ''}</b></span>` : `<span class="pill"><b>${p.difficulty}</b></span>`,
    `<span class="pill">${p.pieces.length} piece${p.pieces.length > 1 ? 's' : ''}</span>`,
    `<span class="pill">Par <b>${p.par}</b></span>`,
  ].join('');
  const played = data.played;
  $('play').textContent = played ? 'Play again for fun' : 'Play';
  $('see-results').hidden = !played;
  const bits: string[] = [];
  if (played) bits.push(`You cast it in ${played.moves}`);
  if (data.streak.current) bits.push(`${data.streak.current}-day streak`);
  if (data.stats.plays) bits.push(`${data.stats.plays} played`);
  $('intro-foot').textContent = bits.length ? bits.join(' · ') : 'A new shadow every day.';
  stage.load(main);
  stage.showCoverage([]);
  stage.setShot('hero');
  show('intro');
}

function showResult(r: Result, streak: Streak, stats: DayStats, rank: number | null, funMoves: number | null) {
  view = 'result';
  const p = main;
  $('res-kicker').textContent =
    p.kind === 'community' ? `"${p.title ?? ''}" by u/${p.author ?? ''}` : `Umbra No. ${p.number} · ${prettyDate(p.date)}`;
  $('res-shape').innerHTML = silhouetteSVG(p.target, { size: 200, unit: 15 });
  $('res-stars').innerHTML = [0, 1, 2]
    .map((i) => `<svg viewBox="0 0 24 24" class="${i < r.stars ? 'on' : 'off'}">${STAR}</svg>`)
    .join('');
  const diff = r.moves - p.par;
  $('res-title').textContent = `Cast in ${r.moves} moves`;
  $('res-sub').textContent =
    (diff <= 0 ? 'Right on par. Beautiful.' : diff <= 3 ? `${diff} over par. So close.` : `${diff} over par. Tomorrow's yours.`) +
    (funMoves !== null ? ` (Just now: ${funMoves}, unranked.)` : '');
  $('res-stats').innerHTML = [
    [`${streak.current}`, 'streak'],
    [`${streak.best}`, 'best streak'],
    [fmtTime(r.timeMs), 'time'],
  ]
    .map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`)
    .join('');

  const counts = Object.entries(stats.distribution).map(([k, v]) => [Number(k), v] as const);
  const lo = Math.min(p.par, r.moves, ...counts.map((c) => c[0]));
  const hi = Math.max(p.par + 4, r.moves, ...counts.map((c) => c[0]));
  const maxN = Math.max(1, ...counts.map((c) => c[1]));
  const cols: string[] = [];
  for (let m = lo; m <= Math.min(hi, lo + 11); m++) {
    const n = stats.distribution[String(m)] ?? 0;
    const cls = ['bar', m === r.moves ? 'you' : '', m === p.par ? 'par' : ''].join(' ');
    cols.push(`<div class="${cls}"><i style="height:${Math.round((n / maxN) * 100)}%"></i><span>${m}</span></div>`);
  }
  $('bars').innerHTML = cols.join('');
  $('dist-label').textContent = stats.plays
    ? `How ${stats.plays} player${stats.plays > 1 ? 's' : ''} did${rank ? ` · you're #${rank}` : ''}`
    : 'Moves taken (you’re first today)';
  $('top').innerHTML = stats.top
    .slice(0, 3)
    .map((t, i) => `<li><span>${i + 1}. u/${t.name}</span><span>${t.moves} moves · ${fmtTime(t.timeMs)}</span></li>`)
    .join('');
  stage.setShot('hero');
  show('result');
  // line the ticket's punched notches up with the tear line
  const tear = document.querySelector<HTMLElement>('.result-card .tear');
  const card = document.querySelector<HTMLElement>('.result-card');
  if (tear && card) card.style.setProperty('--tear', `${tear.offsetTop + 1}px`);
  tickCountdown();
}

function tickCountdown() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  $('countdown').textContent = `Next shadow in ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  if (view === 'result') window.setTimeout(tickCountdown, 1000);
}

function shareText(): string {
  const r = data.played;
  const p = main;
  const name = p.kind === 'community' ? `"${p.title ?? ''}" on Umbra` : `Umbra No. ${p.number}`;
  return r ? `${name}: cast in ${r.moves} (par ${p.par}) ${starText(r.stars)}` : name;
}

// ---------- builder ----------

function openBuilder() {
  builder ??= new Builder(stage);
  view = 'build';
  stage.load({ ...main, pieces: [], target: [] });
  builder.open();
  stage.setShot('play');
  show('build-hud', 'tools', 'dock');
  $('chips').innerHTML = '';
  $('build-done').hidden = false;
  renderBuildTabs();
  renderTool();
}

function renderBuildTabs() {
  if (!builder) return;
  const b = builder;
  const tabs = b.pieces
    .map(
      (_, i) =>
        `<button class="chip" data-tab="${i}" aria-pressed="${i === b.selected}"><i style="background:${PIECE_CSS[i]}"></i>Piece ${i + 1}</button>`,
    )
    .join('');
  const add = b.pieces.length < 3 ? '<button class="chip chip-add" data-tab="add">+ Piece</button>' : '';
  const del = b.pieces.length > 1 ? '<button class="chip" data-tab="del">Remove</button>' : '';
  $('build-tabs').innerHTML = tabs + add + del;
}

function renderTool() {
  const erase = builder?.erase ?? false;
  $('tool-add').setAttribute('aria-pressed', String(!erase));
  $('tool-erase').setAttribute('aria-pressed', String(erase));
}

function openPublish(fromBuilder: boolean) {
  if (!builder) return;
  $('pub-shape').innerHTML = silhouetteSVG(builder.shadow(), { size: 200, unit: 18 });
  if (fromBuilder) {
    const par = builder.par();
    $('pub-par').textContent =
      par < 2 ? 'This one is too easy (par under 2). Try a pose that looks different from most angles.' : `Players will need at least ${par} turns.`;
  }
  $('pub-error').hidden = true;
  show('publish');
}

function testPlay() {
  if (!builder) return;
  const title = input('pub-title').value.trim() || 'My shadow';
  const req = builder.request(title);
  const puzzle = fromDef({ title, author: data.username ?? 'you', pieces: req.pieces }, 'test', data.date);
  load(puzzle, 'test');
}

async function doPublish() {
  if (!builder) return;
  const title = input('pub-title').value.trim();
  const err = $('pub-error');
  if (!title) {
    err.textContent = 'Give your shadow a name first';
    err.hidden = false;
    input('pub-title').focus();
    return;
  }
  const btn = $('pub-go');
  btn.textContent = 'Publishing…';
  const res = await publish(builder.request(title));
  btn.textContent = 'Publish';
  if (!res.ok) {
    err.textContent = res.message;
    err.hidden = false;
    return;
  }
  toast('Published! Opening your post');
  navigateTo(res.url);
}

// ---------- tutorial ----------

function startTutorial() {
  load(tutorialPuzzle(), 'tutorial');
}

// ---------- input ----------

function bindInput() {
  document.querySelectorAll<HTMLButtonElement>('.ctl[data-move]').forEach((b) => {
    const mv = b.dataset.move ?? '';
    b.innerHTML = svg(ICONS[mv] ?? '');
    b.addEventListener('click', () => {
      const axis = mv[0];
      if (axis === 'x' || axis === 'y' || axis === 'z') turn(axis, mv[1] === '+' ? 1 : -1);
    });
  });
  $('undo').innerHTML = svg(ICONS.undo ?? '');
  $('undo').addEventListener('click', undo);
  renderMute();
  $('mute').addEventListener('click', () => {
    sfx.toggle();
    renderMute();
  });

  $('chips').addEventListener('click', (e) => {
    const t = e.target;
    const chip = t instanceof Element ? t.closest<HTMLElement>('[data-piece]') : null;
    if (chip) {
      select(Number(chip.dataset.piece));
      sfx.tap();
    }
  });

  // Swipe to turn, tap to pick (or, in the builder, to add/erase a block).
  const canvas = $('stage');
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || (view !== 'play' && view !== 'build')) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) {
      if (view === 'build' && builder) {
        const r = builder.tap(e.clientX, e.clientY);
        if (r === 'added' || r === 'removed') sfx.build();
        else if (r === 'selected') sfx.tap();
        else if (r !== 'none') {
          sfx.nope();
          toast(r.blocked);
        }
        renderBuildTabs();
        return;
      }
      const hit = stage.pick(e.clientX, e.clientY);
      if (hit !== null) {
        select(hit);
        sfx.tap();
      }
      return;
    }
    if (dist < 26) return;
    if (Math.abs(dx) > Math.abs(dy)) turn('y', dx > 0 ? 1 : -1);
    else turn('x', dy > 0 ? 1 : -1);
  });

  window.addEventListener('keydown', (e) => {
    if (view !== 'play' && view !== 'build') return;
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key;
    if (k === 'ArrowLeft') turn('y', -1);
    else if (k === 'ArrowRight') turn('y', 1);
    else if (k === 'ArrowUp') turn('x', -1);
    else if (k === 'ArrowDown') turn('x', 1);
    else if (k === 'q' || k === 'Q') turn('z', 1);
    else if (k === 'e' || k === 'E') turn('z', -1);
    else if (k === 'z' || k === 'Z' || k === 'Backspace') undo();
    else if (k === 'Tab' && view === 'play') select((st.selected + 1) % st.puzzle.pieces.length);
    else if (/^[1-3]$/.test(k)) select(Number(k) - 1);
    else return;
    e.preventDefault();
  });

  $('play').addEventListener('click', () => {
    if (local.get('tutorial-done') !== '1') startTutorial();
    else load(main, data.played ? 'fun' : 'daily');
  });
  $('how').addEventListener('click', startTutorial);
  $('tut-go').addEventListener('click', () => load(main, data.played ? 'fun' : 'daily'));
  $('see-results').addEventListener('click', () => {
    if (data.played) showResult(data.played, data.streak, data.stats, null, null);
  });
  $('replay').addEventListener('click', () => load(main, 'fun'));
  $('comment').addEventListener('click', async () => {
    const ok = await postComment(main.key).catch(() => false);
    toast(ok ? 'Posted to the comments' : offline ? 'Comments work once this runs on Reddit' : "Couldn't post the comment");
  });
  $('share').addEventListener('click', async () => {
    const text = shareText();
    if (!offline) {
      try {
        await showShareSheet({ title: 'Umbra', text });
        return;
      } catch {
        /* fall back to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied your result');
    } catch {
      toast(text);
    }
  });

  // builder
  $('open-builder').addEventListener('click', openBuilder);
  $('res-build').addEventListener('click', openBuilder);
  $('build-close').addEventListener('click', showIntro);
  $('back').addEventListener('click', () => {
    sfx.tap();
    showIntro();
  });
  $('res-close').addEventListener('click', showIntro);
  $('pub-close').addEventListener('click', () => {
    if (view === 'build') show('build-hud', 'tools', 'dock');
    else openBuilder();
  });
  $('tool-add').addEventListener('click', () => {
    if (builder) builder.erase = false;
    renderTool();
  });
  $('tool-erase').addEventListener('click', () => {
    if (builder) builder.erase = true;
    renderTool();
  });
  $('build-tabs').addEventListener('click', (e) => {
    const t = e.target;
    const tab = t instanceof Element ? t.closest<HTMLElement>('[data-tab]') : null;
    if (!tab || !builder) return;
    const v = tab.dataset.tab;
    if (v === 'add') builder.addPiece();
    else if (v === 'del') builder.removePiece();
    else builder.select(Number(v));
    sfx.tap();
    renderBuildTabs();
  });
  $('build-done').addEventListener('click', () => openPublish(true));
  $('pub-back').addEventListener('click', () => {
    if (view !== 'build') openBuilder();
    else show('build-hud', 'tools', 'dock');
  });
  $('pub-test').addEventListener('click', testPlay);
  $('pub-go').addEventListener('click', () => void doPublish());
  input('pub-title').addEventListener('input', () => ($('pub-error').hidden = true));
}

async function start() {
  data = await init();
  main = data.custom
    ? { ...fromDef(data.custom.def, data.custom.key, data.date), kind: data.custom.kind }
    : puzzleFor(data.date);
  const canvas = $('stage');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas missing');
  stage = new Stage(canvas);
  bindInput();
  showIntro();
}

void start();
