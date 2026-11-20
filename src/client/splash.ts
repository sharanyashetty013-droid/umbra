import { context, requestExpandedMode } from '@devvit/web/client';
import { fromDef, puzzleFor, todayUTC } from '../shared/puzzle';
import { init, offline } from './net';
import { silhouetteSVG } from './silhouette';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

function draw(p: ReturnType<typeof puzzleFor>) {
  $('shadow').innerHTML = silhouetteSVG(p.target, { size: 240, unit: 26 });
  $('kicker').textContent = `No. ${p.number} · ${p.difficulty} · Par ${p.par}`;
}

async function main() {
  // Draw today's shape straight away so the card is never empty, then refine.
  let postDate: unknown;
  try {
    postDate = context?.postData?.date;
  } catch {
    postDate = undefined;
  }
  draw(puzzleFor(typeof postDate === 'string' ? postDate : todayUTC()));
  const data = await init();
  const p = data.custom ? fromDef(data.custom.def, data.custom.key, data.date) : puzzleFor(data.date);
  $('shadow').innerHTML = silhouetteSVG(p.target, { size: 240, unit: 26 });
  if (data.custom?.kind === 'community') {
    $('kicker').textContent = `Community shadow · Par ${p.par}`;
    $('line').textContent = `"${p.title ?? ''}" by u/${p.author ?? ''}`;
  } else {
    $('kicker').textContent = `No. ${p.number} · ${p.difficulty} · Par ${p.par}`;
  }
  if (data.played) {
    $('line').textContent = `You cast it in ${data.played.moves}. ${'★'.repeat(data.played.stars)}${'☆'.repeat(3 - data.played.stars)}`;
    $('play').textContent = 'See results';
  }
  const bits: string[] = [];
  if (data.streak.current) bits.push(`${data.streak.current}-day streak`);
  if (data.stats.plays) bits.push(`${data.stats.plays} played today`);
  $('foot').textContent = bits.join(' · ');
  $('play').addEventListener('click', (e) => {
    if (offline) {
      window.location.href = 'game.html';
      return;
    }
    requestExpandedMode(e, 'game');
  });
}

void main();
