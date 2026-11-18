// game/music.js: the game's soundtrack, made with WebAudio (no files). An original tune in a South
// Indian (Carnatic) style played with chip sounds: the scale of raga Mayamalavagowla (S R1 G3 M1 P D1 N3),
// a square-wave lead that slides into its notes, a Sa-Pa drone, and drum sounds on an 8-beat cycle
// (Adi tala). Speech wins: while the app's <audio> element plays, the music drops to DUCK.
//
//   music.start(wave)   begin (needs a user gesture earlier on the page); no-op when off
//   music.setWave(n)    later waves play a little faster with busier drums
//   music.pause() / music.resume() / music.stop()
//   music.setOn(bool) / music.isOn()
//   music.attach(audioEl) -> detach()   follow speech for ducking

const VOLUME = 0.085;
export const DUCK = 0.12;
const SA = 293.66; // D4
const SCALE = [0, 1, 4, 5, 7, 8, 11];
const _ = null;

// Lead: scale degrees (0 = Sa, 7 = upper Sa), null = hold, -1 = rest. 16 steps = one 8-beat cycle.
const LEAD = [
  [4, _, 5, 4, 3, 2, 3, _, 4, _, 5, 6, 7, _, _, _],
  [7, _, 6, 5, 4, _, 3, 2, 3, 4, 3, 2, 1, _, 0, _],
  [0, 1, 2, 3, 4, _, 4, _, 5, 4, 3, 2, 3, _, _, _],
  [2, 3, 4, 5, 6, 5, 4, 3, 2, _, 1, _, 0, _, _, _],
  [7, _, 8, 7, 6, 7, _, 5, 6, _, 7, 8, 9, _, 8, 7],
  [9, _, 8, 7, 8, _, 7, 6, 7, _, 6, 5, 4, _, _, _],
  [4, 5, 6, 7, 6, 5, 4, 3, 4, 5, 4, 3, 2, 3, 2, 1],
  [0, _, 2, _, 4, _, 7, _, 6, 5, 4, 3, 2, 1, 0, _],
];
// Bass (drone plucks), degrees one octave down: Pa Sa Sa Sa, the tanpura order.
const BASS = [4, _, _, _, 7, _, _, _, 7, _, _, _, 0, _, _, _];
// Drums: 'T' low stroke (thom), 't' high stroke (ta), '.' nothing.
const DRUMS = ['T...t.T.T...t.t.', 'T.t.t.T.T.t.t.tt', 'T.ttt.T.T.ttT.tt'];

let ctx = null, out = null, noise = null;
let on = true, ducked = false, playing = false, paused = false;
let timer = null, step = 0, nextAt = 0, wave = 1, lastHz = 0;

const hz = d => SA * 2 ** (Math.floor(d / 7) + SCALE[((d % 7) + 7) % 7] / 12);
const stepLen = () => 60 / (104 + 5 * Math.min(6, wave)) / 2;
const level = () => (on && playing && !paused ? VOLUME * (ducked ? DUCK : 1) : 0);

function context() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0;
    out.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.2);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
  } catch { ctx = null; out = null; }
  return ctx;
}

function apply() {
  if (!ctx || !out) return;
  try { out.gain.setTargetAtTime(level(), ctx.currentTime, 0.05); } catch { out.gain.value = level(); }
}

function tone(type, f0, f1, t, dur, gain, glide = 0.03) {
  const o = ctx.createOscillator(), v = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  v.gain.setValueAtTime(gain, t + Math.max(0.01, dur - 0.04));
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(v); v.connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

function tick(t, gain) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
  src.buffer = noise;
  f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 2;
  v.gain.setValueAtTime(gain, t);
  v.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(f); f.connect(v); v.connect(out);
  src.start(t); src.stop(t + 0.06);
}

function schedule(i, t) {
  const L = stepLen();
  const k = i % 16, bar = Math.floor(i / 16) % LEAD.length;
  // lead
  const d = LEAD[bar][k];
  if (d != null && d >= 0) {
    let n = 1;
    while (k + n < 16 && LEAD[bar][k + n] === null) n++;
    const f = hz(d + 7);
    tone('square', lastHz || f, f, t, L * n * 0.95, 0.5, 0.045);
    lastHz = f;
  }
  // drone plucks
  const b = BASS[k];
  if (b != null) tone('triangle', hz(b - 7), hz(b - 7), t, L * 3.6, 0.8);
  // drums
  const pat = DRUMS[wave <= 2 ? 0 : wave <= 4 ? 1 : 2][k];
  if (pat === 'T') tone('sine', 150, 70, t, 0.16, 1, 0.12);
  else if (pat === 't') tick(t, 0.5);
}

function pump() {
  if (!ctx || !playing || paused) return;
  while (nextAt < ctx.currentTime + 0.25) {
    try { schedule(step, nextAt); } catch { /* a closed context: skip */ }
    step += 1;
    nextAt += stepLen();
  }
}

export function start(w = 1) {
  wave = Math.max(1, Number(w) || 1);
  if (!on) return false;
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') { try { c.resume(); } catch { /* needs a gesture */ } }
  playing = true; paused = false; step = 0; lastHz = 0;
  nextAt = c.currentTime + 0.1;
  apply();
  clearInterval(timer);
  timer = setInterval(pump, 80);
  pump();
  return true;
}

export function setWave(w) { wave = Math.max(1, Number(w) || 1); }

export function pause() { if (!playing) return; paused = true; apply(); }

export function resume() {
  if (!playing || !paused) return;
  paused = false;
  if (ctx) nextAt = ctx.currentTime + 0.1;
  apply();
}

export function stop() {
  playing = false; paused = false;
  clearInterval(timer); timer = null;
  apply();
}

export function isOn() { return on; }
export function isPlaying() { return playing && !paused && on; }
export function setOn(v) { on = !!v; if (!on) stop(); }

export function attach(el) {
  if (!el) return () => {};
  const a = () => { ducked = true; apply(); };
  const b = () => { ducked = false; apply(); };
  const evs = [['playing', a], ['play', a], ['pause', b], ['ended', b], ['emptied', b]];
  for (const [k, f] of evs) el.addEventListener(k, f);
  return () => { for (const [k, f] of evs) el.removeEventListener(k, f); ducked = false; };
}

export function close() {
  stop();
  if (ctx) { try { ctx.close(); } catch { /* already closed */ } }
  ctx = null; out = null; noise = null;
}
