// Tiny synthesized sounds: no audio files to load.
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('umbra:muted') === '1';
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

export const sfx = {
  /** a wooden "tock" for each turn */
  turn() {
    tone(196, 0, 0.12, 0.18, 'triangle');
    tone(392, 0, 0.05, 0.06, 'square');
    buzz(8);
  },
  tap() {
    tone(660, 0, 0.06, 0.05, 'sine');
  },
  undo() {
    tone(330, 0, 0.08, 0.1, 'triangle');
    tone(247, 0.05, 0.1, 0.08, 'triangle');
  },
  build() {
    tone(523, 0, 0.09, 0.08, 'triangle');
    buzz(6);
  },
  nope() {
    tone(150, 0, 0.14, 0.12, 'sawtooth');
    buzz(20);
  },
  /** a bell arpeggio when the shadow matches */
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(f, i * 0.09, 0.9, 0.12);
      tone(f * 2, i * 0.09, 0.4, 0.03);
    });
    buzz(30);
  },
  get muted() {
    return muted;
  },
  toggle(): boolean {
    muted = !muted;
    try {
      localStorage.setItem('umbra:muted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return muted;
  },
};
