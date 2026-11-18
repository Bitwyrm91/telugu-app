// game/music.js: the game's soundtrack, made with WebAudio (no files). An original tune in the style
// of 16-bit console adventure games: A minor, eight bars (Am F C G | Am F G E), a soft lead with an
// echo, a running chord arpeggio, an octave bass and light drums. Speech wins: while the app's
// <audio> element plays, the music drops to DUCK.
//
//   music.start(wave)   begin (needs a user gesture earlier on the page); no-op when off
//   music.setWave(n)    later waves play a little faster with busier drums
//   music.pause() / music.resume() / music.stop()
//   music.setOn(bool) / music.isOn()
//   music.attach(audioEl) -> detach()   follow speech for ducking

const VOLUME = 0.11;
export const DUCK = 0.12;
const _ = null;
const N = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const hz = (n) => { const m = /^([A-G]#?)(\d)$/.exec(n); return 440 * 2 ** ((N[m[1]] + 12 * (Number(m[2]) + 1) - 69) / 12); };

// Lead: one note name per 16th step, null = hold. 8 bars of 16 steps.
const LEAD = [
  ['E5', _, _, _, 'A5', _, _, 'G5', 'E5', _, _, _, 'C5', _, 'D5', _],
  ['C5', _, _, _, _, _, 'A4', _, 'C5', _, 'F5', _, 'E5', _, _, _],
  ['G5', _, _, _, 'E5', _, _, 'C5', 'D5', _, 'E5', _, 'G5', _, _, _],
  ['D5', _, _, _, _, _, 'B4', _, 'D5', _, _, _, _, _, _, _],
  ['E5', _, _, _, 'A5', _, _, 'B5', 'C6', _, _, _, 'B5', _, 'A5', _],
  ['A5', _, _, _, _, _, 'F5', _, 'A5', _, 'C6', _, 'A5', _, _, _],
  ['B5', _, _, _, 'G5', _, _, 'D5', 'G5', _, 'A5', _, 'B5', _, _, _],
  ['G#5', _, _, _, _, _, 'E5', _, 'B5', _, _, _, _, _, _, _],
];
// Chord of each bar: bass root, then the four arpeggio notes.
const CHORDS = [
  ['A2', 'A3', 'C4', 'E4', 'A4'], ['F2', 'F3', 'A3', 'C4', 'F4'], ['C3', 'G3', 'C4', 'E4', 'G4'], ['G2', 'G3', 'B3', 'D4', 'G4'],
  ['A2', 'A3', 'C4', 'E4', 'A4'], ['F2', 'F3', 'A3', 'C4', 'F4'], ['G2', 'G3', 'B3', 'D4', 'G4'], ['E2', 'G#3', 'B3', 'E4', 'G#4'],
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 2, 1];
const BASS = '1.1.2.1.1.1.2.12'; // 1 = root, 2 = octave up
// Drums: 'K' kick, 'S' snare, 'h' hat, '.' nothing.
const DRUMS = ['K...h...K...h...', 'K.h.S.h.K.h.S.h.', 'K.h.S.hhK.KhS.hh'];

let ctx = null, out = null, noise = null, echo = null;
let on = true, ducked = false, playing = false, paused = false;
let timer = null, step = 0, nextAt = 0, wave = 1;

const stepLen = () => 60 / (112 + 4 * Math.min(6, wave)) / 4;
const level = () => (on && playing && !paused ? VOLUME * (ducked ? DUCK : 1) : 0);

function context() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0;
    const soft = ctx.createBiquadFilter(); // takes the edge off the square waves
    soft.type = 'lowpass'; soft.frequency.value = 3200; soft.Q.value = 0.5;
    out.connect(soft); soft.connect(ctx.destination);
    echo = ctx.createDelay(1);
    echo.delayTime.value = 0.27;
    const back = ctx.createGain();
    back.gain.value = 0.32;
    echo.connect(back); back.connect(echo); back.connect(out);
    const len = Math.floor(ctx.sampleRate * 0.2);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
  } catch { ctx = null; out = null; echo = null; }
  return ctx;
}

function apply() {
  if (!ctx || !out) return;
  try { out.gain.setTargetAtTime(level(), ctx.currentTime, 0.05); } catch { out.gain.value = level(); }
}

function tone(type, f, t, dur, gain, opts = {}) {
  const o = ctx.createOscillator(), v = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(opts.from || f, t);
  if (opts.from) o.frequency.exponentialRampToValueAtTime(f, t + (opts.glide || 0.1));
  if (opts.vibrato && dur > 0.3) {
    const l = ctx.createOscillator(), d = ctx.createGain();
    l.frequency.value = 5.5; d.gain.setValueAtTime(0, t); d.gain.linearRampToValueAtTime(f * 0.006, t + 0.3);
    l.connect(d); d.connect(o.frequency); l.start(t); l.stop(t + dur + 0.02);
  }
  const rel = Math.min(opts.release || 0.04, dur * 0.6);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  v.gain.setValueAtTime(gain, t + dur - rel);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(v); v.connect(out);
  if (opts.echo && echo) v.connect(echo);
  o.start(t); o.stop(t + dur + 0.02);
}

function hit(t, gain, freq, len) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
  src.buffer = noise;
  f.type = freq > 4000 ? 'highpass' : 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  v.gain.setValueAtTime(gain, t);
  v.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f); f.connect(v); v.connect(out);
  src.start(t); src.stop(t + len + 0.01);
}

function schedule(i, t) {
  const L = stepLen();
  const k = i % 16, bar = Math.floor(i / 16) % LEAD.length, pass = Math.floor(i / (16 * LEAD.length));
  const chord = CHORDS[bar];
  // lead (rests through the first pass, so the tune builds up)
  const n = LEAD[bar][k];
  if (n && pass > 0) {
    let len = 1;
    while (k + len < 16 && LEAD[bar][k + len] === null) len++;
    tone('square', hz(n), t, L * len * 0.92, 0.3, { echo: true, vibrato: true, release: 0.08 });
    tone('triangle', hz(n), t, L * len * 0.92, 0.35, { release: 0.08 });
  }
  // arpeggio
  tone('square', hz(chord[1 + ARP[k]]), t, L * 0.9, 0.11, { echo: pass === 0 });
  // bass
  const b = BASS[k];
  if (b !== '.') tone('triangle', hz(chord[0]) * (b === '2' ? 2 : 1), t, L * 1.7, 0.75);
  // drums
  const d = DRUMS[wave <= 1 ? 0 : wave <= 3 ? 1 : 2][k];
  if (d === 'K') tone('sine', 55, t, 0.14, 0.9, { from: 160, glide: 0.1 });
  else if (d === 'S') hit(t, 0.4, 1900, 0.11);
  else if (d === 'h') hit(t, 0.12, 7000, 0.035);
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
  playing = true; paused = false; step = 0;
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
  ctx = null; out = null; noise = null; echo = null;
}
