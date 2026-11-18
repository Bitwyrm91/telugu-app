// game/music.js: the game's soundtrack, made with WebAudio (no files). Twelve original tunes in the
// style of 16-bit console adventure games. Each is eight bars: a soft lead with an echo over a chord
// arpeggio, a bass and light drums. A run starts on a random tune and moves to the next after PASSES
// times through. Speech wins: while the app's <audio> element plays, the music drops to DUCK.
//
//   music.start(wave)   begin (needs a user gesture earlier on the page); no-op when off
//   music.setWave(n)    later waves play a little faster with busier drums
//   music.pause() / music.resume() / music.stop()
//   music.setOn(bool) / music.isOn()
//   music.attach(audioEl) -> detach()   follow speech for ducking
//   music.trackName() / music.trackNames() / music.problems()

const VOLUME = 0.11;
export const DUCK = 0.12;
export const PASSES = 3;
const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midi = (n) => { const m = /^([A-G]#?)(\d)$/.exec(n); return m ? PC[m[1]] + 12 * (Number(m[2]) + 1) : NaN; };
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Arpeggio shapes (index into the chord's four notes; '.' = nothing), bass ('1' root, '2' octave up)
// and drum sets by wave ('K' kick, 'S' snare, 'h' hat).
const ARPS = {
  run: '0123212301232121',
  half: '0.1.2.3.2.1.2.3.',
  bounce: '0.32.1320.32.132',
  climb: '0.1.2.3.0.1.2.3.',
};
const BASSES = {
  walk: '1.1.2.1.1.1.2.12',
  long: '1.......1.....1.',
  pulse: '1.1.1.1.1.1.1.1.',
  drive: '1.121.121.121.12',
  skip: '1..1..1.1..1..2.',
};
const DRUMS = {
  light: ['K...h...K...h...', 'K.h.S.h.K.h.S.h.', 'K.h.S.hhK.KhS.hh'],
  soft: ['....h.......h...', 'K...h...K...h.h.', 'K.h.S.h.K.h.S.h.'],
  drive: ['K.h.S.h.K.h.S.h.', 'K.hhS.h.KKh.S.hh', 'KhhhSh.hKKhhShSh'],
  march: ['K..hS...K..hS...', 'K..hS.h.K.KhS.h.', 'K.hhS.hhK.KhS.SS'],
};

// Lead: 16 steps per bar. A note name starts a note, '-' holds it, '.' is silence.
const TRACKS = [
  { name: 'Skyward', bpm: 112, arp: 'run', bass: 'walk', drums: 'light',
    chords: 'Am F C G Am F G E',
    lead: [
      'E5 - - - A5 - - G5 E5 - - - C5 - D5 -',
      'C5 - - - - - A4 - C5 - F5 - E5 - - -',
      'G5 - - - E5 - - C5 D5 - E5 - G5 - - -',
      'D5 - - - - - B4 - D5 - - - - - - -',
      'E5 - - - A5 - - B5 C6 - - - B5 - A5 -',
      'A5 - - - - - F5 - A5 - C6 - A5 - - -',
      'B5 - - - G5 - - D5 G5 - A5 - B5 - - -',
      'G#5 - - - - - E5 - B5 - - - - - - -',
    ] },
  { name: 'Lantern Town', bpm: 96, arp: 'half', bass: 'long', drums: 'soft',
    chords: 'C G Am F C G F G',
    lead: [
      'E5 - - G5 - - E5 - C5 - - - D5 - E5 -',
      'D5 - - - B4 - - - D5 - G5 - - - - -',
      'C5 - - E5 - - C5 - A4 - - - B4 - C5 -',
      'A4 - - - C5 - - - F5 - E5 - D5 - C5 -',
      'E5 - - G5 - - C6 - B5 - - - G5 - E5 -',
      'D5 - - - G5 - - - B5 - A5 - G5 - - -',
      'A5 - - F5 - - A5 - G5 - F5 - E5 - D5 -',
      'D5 - - - - - G5 - - - - - . . . .',
    ] },
  { name: 'Storm Front', bpm: 130, arp: 'run', bass: 'drive', drums: 'drive',
    chords: 'Dm A# C Am Dm A# C A',
    lead: [
      'D5 - F5 - A5 - - - G5 - F5 - E5 - F5 -',
      'D5 - - - - - F5 - A#5 - - - A5 - - -',
      'G5 - E5 - C5 - - - E5 - G5 - C6 - - -',
      'A5 - - - - - E5 - C5 - - - E5 - - -',
      'D5 - F5 - A5 - - - D6 - C6 - A5 - F5 -',
      'A#5 - - - - - D6 - F5 - - - A#5 - - -',
      'C6 - A#5 - G5 - - - E5 - G5 - A#5 - - -',
      'A5 - - - C#6 - - - E6 - - - - - . .',
    ] },
  { name: 'Old Road', bpm: 104, arp: 'climb', bass: 'walk', drums: 'light',
    chords: 'Em C G D Em C D B',
    lead: [
      'B4 - - - E5 - - - G5 - - F#5 E5 - - -',
      'E5 - - - - - C5 - E5 - G5 - - - - -',
      'D5 - - - G5 - - - B5 - - A5 G5 - - -',
      'F#5 - - - - - D5 - A5 - - - - - - -',
      'B5 - - - G5 - - - E5 - - F#5 G5 - - -',
      'E5 - - - - - G5 - C6 - B5 - G5 - - -',
      'A5 - - - F#5 - - - D5 - F#5 - A5 - - -',
      'B5 - - - - - F#5 - D#5 - - - - - - -',
    ] },
  { name: 'Festival', bpm: 124, arp: 'bounce', bass: 'skip', drums: 'march',
    chords: 'G C D G Em C D D',
    lead: [
      'G5 - B5 - D6 - B5 - G5 - - - D5 - G5 -',
      'E5 - G5 - C6 - G5 - E5 - - - G5 - - -',
      'F#5 - A5 - D6 - A5 - F#5 - A5 - C6 - - -',
      'B5 - - - G5 - - - D5 - G5 - B5 - - -',
      'E5 - G5 - B5 - - - A5 - G5 - E5 - - -',
      'C5 - E5 - G5 - - - C6 - B5 - G5 - - -',
      'A5 - F#5 - D5 - F#5 - A5 - D6 - C6 - A5 -',
      'D6 - - - - - A5 - F#5 - - - - - . .',
    ] },
  { name: 'Deep Night', bpm: 88, arp: 'half', bass: 'long', drums: 'soft',
    chords: 'Cm G# D# A# Cm G# G G',
    lead: [
      'G5 - - - - - D#5 - C5 - - - - - D5 -',
      'D#5 - - - - - C5 - G#4 - - - - - - -',
      'A#4 - - - D#5 - - - G5 - - - F5 - D#5 -',
      'D5 - - - - - A#4 - F5 - - - - - - -',
      'G5 - - - - - C6 - A#5 - - - G5 - - -',
      'G#5 - - - - - D#5 - C5 - - - D#5 - - -',
      'D5 - - - G5 - - - B5 - - - D6 - - -',
      'B5 - - - - - G5 - D5 - - - - - . .',
    ] },
  { name: 'Last Stand', bpm: 136, arp: 'run', bass: 'drive', drums: 'drive',
    chords: 'Bm G A F#m Bm G A F#',
    lead: [
      'B5 - - F#5 - - B5 - D6 - - C#6 - - B5 -',
      'B5 - - G5 - - D5 - G5 - - - B5 - - -',
      'A5 - - E5 - - A5 - C#6 - - B5 - - A5 -',
      'F#5 - - - - - C#5 - F#5 - A5 - - - - -',
      'B5 - - F#5 - - B5 - D6 - - E6 - - F#6 -',
      'D6 - - B5 - - G5 - B5 - - - D6 - - -',
      'C#6 - - A5 - - E5 - A5 - C#6 - E6 - - -',
      'F#6 - - - - - C#6 - A#5 - - - - - . .',
    ] },
  { name: 'Morning Sail', bpm: 108, arp: 'climb', bass: 'skip', drums: 'light',
    chords: 'F C Dm A# F C A# C',
    lead: [
      'A5 - - - F5 - - - C5 - F5 - A5 - - -',
      'G5 - - - E5 - - - C5 - E5 - G5 - - -',
      'F5 - - - D5 - - - A4 - D5 - F5 - A5 -',
      'A#5 - - - - - F5 - D5 - - - F5 - - -',
      'A5 - - - C6 - - - F6 - - E6 C6 - - -',
      'G5 - - - C6 - - - E6 - - D6 C6 - - -',
      'D6 - - - A#5 - - - F5 - A#5 - D6 - - -',
      'C6 - - - - - G5 - E5 - - - - - . .',
    ] },
  { name: 'Clockwork', bpm: 120, arp: 'bounce', bass: 'pulse', drums: 'march',
    chords: 'A E F#m D A E D E',
    lead: [
      'C#5 - E5 - A5 - - - G#5 - E5 - C#5 - - -',
      'B4 - E5 - G#5 - - - B5 - G#5 - E5 - - -',
      'A5 - - F#5 - - C#5 - F#5 - A5 - C#6 - - -',
      'A5 - - - F#5 - - - D5 - F#5 - A5 - - -',
      'C#6 - - A5 - - E5 - A5 - C#6 - E6 - - -',
      'B5 - - G#5 - - E5 - G#5 - B5 - E6 - - -',
      'D6 - - - A5 - - - F#5 - A5 - D6 - C#6 -',
      'B5 - - - - - G#5 - E5 - - - - - . .',
    ] },
  { name: 'Ruins', bpm: 92, arp: 'half', bass: 'long', drums: 'soft',
    chords: 'Dm G Dm G F C Dm A',
    lead: [
      'A4 - - - D5 - - - F5 - E5 - D5 - - -',
      'B4 - - - D5 - - - G5 - - - - - D5 -',
      'F5 - - - A5 - - - G5 - F5 - E5 - D5 -',
      'D5 - - - B4 - - - G4 - - - B4 - - -',
      'C5 - - - F5 - - - A5 - - - C6 - - -',
      'G5 - - - E5 - - - C5 - E5 - G5 - - -',
      'F5 - - - D5 - - - A4 - D5 - F5 - - -',
      'E5 - - - - - C#5 - A4 - - - - - . .',
    ] },
  { name: 'Chase', bpm: 140, arp: 'run', bass: 'drive', drums: 'drive',
    chords: 'Gm D# F Dm Gm D# F D',
    lead: [
      'G5 - A#5 - D6 - - A#5 - - G5 - A#5 - - -',
      'G5 - A#5 - D#6 - - A#5 - - G5 - D#5 - - -',
      'A5 - C6 - F6 - - C6 - - A5 - F5 - - -',
      'D5 - F5 - A5 - - - D6 - - - A5 - - -',
      'G5 - A#5 - D6 - - G6 - - F6 - D6 - - -',
      'D#6 - - - A#5 - - - G5 - A#5 - D#6 - - -',
      'F6 - - - C6 - - - A5 - C6 - F6 - D#6 -',
      'D6 - - - - - A5 - F#5 - - - - - . .',
    ] },
  { name: 'Homecoming', bpm: 100, arp: 'climb', bass: 'walk', drums: 'light',
    chords: 'D A Bm G D A G A',
    lead: [
      'F#5 - - - A5 - - - D6 - - C#6 A5 - - -',
      'E5 - - - A5 - - - C#6 - - B5 A5 - - -',
      'D5 - - - F#5 - - - B5 - - A5 F#5 - - -',
      'G5 - - - - - D5 - B4 - - - D5 - - -',
      'F#5 - - - A5 - - - D6 - - E6 F#6 - - -',
      'E6 - - - C#6 - - - A5 - - B5 C#6 - - -',
      'B5 - - - G5 - - - D5 - G5 - B5 - - -',
      'A5 - - - - - E5 - C#5 - - - - - . .',
    ] },
];

/** A chord name ('Am', 'F#') as {bass, arp[4]} in MIDI numbers. */
function chord(sym) {
  const m = /^([A-G]#?)(m?)$/.exec(sym);
  if (!m) return null;
  const pc = PC[m[1]], tones = [0, m[2] ? 3 : 4, 7];
  const arp = [];
  for (let n = 55; arp.length < 4; n++) if (tones.includes((((n - pc) % 12) + 12) % 12)) arp.push(n);
  return { bass: pc >= 4 ? 36 + pc : 48 + pc, arp };
}

const SONGS = TRACKS.map((t) => ({
  ...t,
  chords: t.chords.split(' ').map(chord),
  lead: t.lead.map((bar) => bar.split(' ').map((x) => (x === '-' ? null : x === '.' ? 0 : midi(x)))),
}));

/** Mistakes in the track data (wrong bar length, unknown note or chord); [] when fine. */
export function problems() {
  const bad = [];
  SONGS.forEach((s) => {
    if (s.chords.length !== 8 || s.chords.some((c) => !c)) bad.push(`${s.name}: chords`);
    if (s.lead.length !== 8) bad.push(`${s.name}: ${s.lead.length} bars`);
    s.lead.forEach((bar, i) => {
      if (bar.length !== 16) bad.push(`${s.name} bar ${i + 1}: ${bar.length} steps`);
      if (bar.some((x) => Number.isNaN(x))) bad.push(`${s.name} bar ${i + 1}: unknown note`);
    });
    if (!ARPS[s.arp] || !BASSES[s.bass] || !DRUMS[s.drums]) bad.push(`${s.name}: style`);
  });
  return bad;
}
export const trackNames = () => SONGS.map((s) => s.name);

let ctx = null, out = null, noise = null, echo = null;
let on = true, ducked = false, playing = false, paused = false;
let timer = null, step = 0, nextAt = 0, wave = 1;
let order = [0], at = 0, lastFirst = -1, firstTune = true;

const song = () => SONGS[order[at % order.length]];
export const trackName = () => (playing ? song().name : '');
const stepLen = () => 60 / (song().bpm + 3 * Math.min(6, wave)) / 4;
const level = () => (on && playing && !paused ? VOLUME * (ducked ? DUCK : 1) : 0);

function shuffle() {
  order = SONGS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length > 1 && order[0] === lastFirst) order.push(order.shift());
  lastFirst = order[0];
  at = 0; firstTune = true;
}

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
  const s = song(), L = stepLen();
  const k = i % 16, bar = Math.floor(i / 16) % 8, pass = Math.floor(i / 128);
  const ch = s.chords[bar];
  const intro = firstTune && pass === 0; // the first tune of a run builds up: no lead the first time round
  // lead
  const n = s.lead[bar][k];
  if (n && !intro) {
    let len = 1;
    while (k + len < 16 && s.lead[bar][k + len] === null) len++;
    tone('square', hz(n), t, L * len * 0.92, 0.3, { echo: true, vibrato: true, release: 0.08 });
    tone('triangle', hz(n), t, L * len * 0.92, 0.35, { release: 0.08 });
  }
  // arpeggio
  const shape = ARPS[s.arp], a = shape[k];
  if (a !== '.') tone('square', hz(ch.arp[Number(a)]), t, L * (shape[(k + 1) % 16] === '.' ? 1.8 : 0.9), 0.11, { echo: intro });
  // bass
  const b = BASSES[s.bass][k];
  if (b !== '.') tone('triangle', hz(ch.bass + (b === '2' ? 12 : 0)), t, L * (s.bass === 'long' ? 6 : 1.7), 0.75);
  // drums
  const d = DRUMS[s.drums][wave <= 1 ? 0 : wave <= 3 ? 1 : 2][k];
  if (d === 'K') tone('sine', 55, t, 0.14, 0.9, { from: 160, glide: 0.1 });
  else if (d === 'S') hit(t, 0.4, 1900, 0.11);
  else if (d === 'h') hit(t, 0.12, 7000, 0.035);
}

function pump() {
  if (!ctx || !playing || paused) return;
  while (nextAt < ctx.currentTime + 0.25) {
    try { schedule(step, nextAt); } catch { /* a closed context: skip */ }
    nextAt += stepLen();
    step += 1;
    if (step >= 128 * PASSES) { step = 0; at += 1; firstTune = false; }
  }
}

export function start(w = 1) {
  wave = Math.max(1, Number(w) || 1);
  if (!on) return false;
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') { try { c.resume(); } catch { /* needs a gesture */ } }
  shuffle();
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
