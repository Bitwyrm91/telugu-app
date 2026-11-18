// game/sfx.js: 8-bit style effects made with WebAudio (no files). Each effect is a stack of parts:
// pulse/square/triangle sweeps (pulse waves at 12.5 % and 25 % duty), warbling sweeps, quick note
// runs and chiptune arpeggios, and noise in several colours (held "grit", fine hiss, deep rumble,
// a long shift-register crunch and a short metallic one) through a moving low-, band- or high-pass
// filter. Some effects go through a bit-crusher, jingles get a short echo, every effect can be panned
// left/right, and everything ends in a compressor so stacked blasts do not clip. Speech wins: while
// the app's <audio> element plays, effects are lowered to DUCK of their level.
//
//   sfx.play(name, {pitch, pan})  name: launch | hit | wrong | land | wave | reload | empty, and the
//                       extras (not written to sfx.log): boom | bigboom | chain | ready | split | warn |
//                       boss | start | win | over | combo | alarm | lowammo | crumble | repair |
//                       firework | entry | blip. pitch multiplies the notes (a combo climbs);
//                       pan is -1 (left) .. 1 (right).
//   sfx.setMuted(bool)  sfx.isMuted()
//   sfx.attach(audioEl) follow this element's play/pause/ended for ducking; returns detach()
//   sfx.level()         the master gain the next tone uses (1, DUCK, or 0 when muted)
//   sfx.close()         stop and release the audio context

export const DUCK = 0.25;
const VOLUME = 0.15;

// MIDI note -> Hz (69 = A4)
const M = n => 440 * 2 ** ((n - 69) / 12);
const Ms = list => list.map(M);

// A part is one of:
//   [wave, startHz, endHz, seconds, gain, delay]                      a pitch sweep
//   ['wob', wave, startHz, endHz, seconds, gain, delay, rateHz, depthHz]   a sweep that warbles
//   ['noise', startHz, endHz, seconds, gain, delay, colour, filter, q] noise through a moving filter
//                colour: grit | hiss | deep | crunch | metal; filter: lowpass | bandpass | highpass
//   ['run', wave, [Hz...], secondsPerNote, gain, delay]               a quick run; the last note rings
//   ['arp', wave, [Hz...], stepSeconds, seconds, gain, delay]         notes cycled fast (a chip chord)
// wave: square | triangle | sawtooth | sine | p12 | p25 (pulse duty 12.5 % / 25 %)
const TONES = {
  launch: [
    ['noise', 700, 4200, 0.22, 0.5, 0, 'crunch', 'bandpass', 1.4],
    ['wob', 'p25', 247, 1319, 0.2, 0.22, 0, 34, 50],
    ['triangle', 110, 40, 0.16, 0.8, 0],
    ['noise', 3000, 900, 0.3, 0.16, 0.06, 'hiss', 'lowpass'],
  ],
  hit: [
    ['run', 'p12', Ms([83, 88, 95, 100]), 0.035, 0.32, 0],
    ['noise', 6000, 1500, 0.07, 0.35, 0, 'metal', 'highpass'],
    ['triangle', 494, 988, 0.1, 0.45, 0],
    ['run', 'p25', Ms([95, 100]), 0.04, 0.12, 0.09],
  ],
  wrong: [
    ['run', 'sawtooth', Ms([56, 51]), 0.11, 0.36, 0],
    ['wob', 'p25', 117, 82, 0.26, 0.24, 0, 18, 6],
    ['noise', 500, 260, 0.06, 0.3, 0, 'crunch'],
  ],
  land: [
    ['noise', 2600, 60, 0.85, 1, 0, 'crunch'],
    ['noise', 500, 40, 1.1, 0.9, 0.02, 'deep'],
    ['square', 130, 30, 0.55, 0.38, 0],
    ['triangle', 82, 28, 0.8, 1, 0.01],
    ['noise', 2200, 700, 0.06, 0.4, 0.22, 'metal', 'bandpass', 2],
    ['noise', 1800, 600, 0.06, 0.32, 0.33, 'metal', 'bandpass', 2],
    ['noise', 1500, 500, 0.06, 0.25, 0.45, 'metal', 'bandpass', 2],
    ['run', 'p25', Ms([67, 63, 67, 63]), 0.09, 0.14, 0.32],
  ],
  reload: [
    ['run', 'p25', Ms([72, 76, 79, 84]), 0.05, 0.28, 0],
    ['run', 'triangle', Ms([60, 64, 67, 72]), 0.05, 0.5, 0],
    ['noise', 4200, 2000, 0.03, 0.4, 0.24, 'metal', 'bandpass', 3],
    ['noise', 2600, 1400, 0.035, 0.36, 0.31, 'metal', 'bandpass', 3],
    ['arp', 'p12', Ms([84, 88, 91]), 0.03, 0.15, 0.1, 0.22],
  ],
  empty: [
    ['p25', 147, 131, 0.06, 0.28, 0], ['noise', 1400, 700, 0.035, 0.4, 0, 'metal', 'bandpass', 4],
    ['p25', 147, 131, 0.06, 0.28, 0.11], ['noise', 1400, 700, 0.035, 0.4, 0.11, 'metal', 'bandpass', 4],
  ],
  wave: [
    ['run', 'p25', Ms([72, 76, 79, 84, 79, 84, 88, 91]), 0.08, 0.27, 0],
    ['run', 'triangle', Ms([48, 48, 55, 55, 52, 55, 60, 60]), 0.08, 0.6, 0],
    ['arp', 'p12', Ms([84, 88, 91, 96]), 0.035, 0.45, 0.12, 0.62],
    ['noise', 7000, 3000, 0.05, 0.22, 0.56, 'hiss', 'highpass'],
    ['noise', 7000, 3000, 0.05, 0.18, 0.64, 'hiss', 'highpass'],
  ],
  // ---- extras ----
  boom: [
    ['noise', 9000, 2500, 0.05, 0.45, 0, 'hiss', 'highpass'],
    ['noise', 3600, 150, 0.36, 0.75, 0, 'crunch'],
    ['triangle', 150, 38, 0.28, 0.9, 0],
    ['square', 160, 45, 0.2, 0.22, 0],
    ['noise', 800, 70, 0.45, 0.55, 0.06, 'deep'],
  ],
  bigboom: [
    ['noise', 10000, 3000, 0.08, 0.5, 0, 'hiss', 'highpass'],
    ['noise', 5200, 80, 1.0, 1, 0, 'crunch'],
    ['noise', 600, 35, 1.4, 1, 0.03, 'deep'],
    ['wob', 'square', 147, 26, 0.75, 0.4, 0, 16, 12],
    ['triangle', 70, 24, 1.0, 1, 0],
    ['run', 'p12', Ms([103, 98, 91, 86, 79, 74]), 0.05, 0.16, 0.03],
    ['arp', 'p12', Ms([96, 100, 103]), 0.03, 0.5, 0.06, 0.3],
  ],
  chain: [
    ['wob', 'p12', 2400, 300, 0.14, 0.24, 0, 60, 300],
    ['noise', 5000, 1200, 0.1, 0.35, 0, 'metal', 'bandpass', 2],
    ['triangle', 180, 50, 0.16, 0.6, 0.02],
  ],
  ready: [
    ['run', 'p25', Ms([67, 72, 76, 79, 84, 88]), 0.05, 0.25, 0],
    ['run', 'triangle', Ms([55, 60, 64, 67, 72, 76]), 0.05, 0.5, 0],
    ['wob', 'p12', 600, 2400, 0.32, 0.1, 0, 22, 80],
    ['arp', 'p12', Ms([88, 91, 96]), 0.03, 0.4, 0.1, 0.3],
  ],
  split: [
    ['noise', 6000, 900, 0.12, 0.45, 0, 'crunch', 'bandpass', 1.2],
    ['wob', 'p25', 880, 330, 0.14, 0.24, 0, 40, 60],
    ['wob', 'p25', 440, 990, 0.14, 0.24, 0.1, 40, 60],
    ['triangle', 220, 60, 0.18, 0.5, 0],
  ],
  warn: [
    ['run', 'p25', Ms([81, 74, 81, 74]), 0.09, 0.13, 0],
    ['run', 'triangle', Ms([69, 62, 69, 62]), 0.09, 0.25, 0],
  ],
  boss: [
    ['wob', 'p25', 98, 82, 0.9, 0.24, 0, 6, 8],
    ['wob', 'sawtooth', 49, 41, 0.9, 0.18, 0, 6, 3],
    ['noise', 400, 60, 1.0, 0.45, 0, 'deep'],
    ['run', 'p12', Ms([62, 61, 62, 61]), 0.16, 0.1, 0.1],
  ],
  start: [
    ['run', 'p25', Ms([64, 67, 71, 76]), 0.065, 0.22, 0],
    ['run', 'triangle', Ms([52, 55, 59, 64]), 0.065, 0.45, 0],
    ['noise', 5000, 1500, 0.08, 0.3, 0.26, 'crunch', 'bandpass', 1],
  ],
  win: [
    ['run', 'p25', Ms([72, 72, 72, 76, 79, 76, 79, 84, 88]), 0.1, 0.27, 0],
    ['run', 'triangle', Ms([48, 48, 48, 52, 55, 52, 55, 60, 60]), 0.1, 0.55, 0],
    ['run', 'p12', Ms([67, 67, 67, 72, 76, 72, 76, 79, 84]), 0.1, 0.13, 0],
    ['arp', 'p12', Ms([84, 88, 91, 96]), 0.035, 0.7, 0.1, 0.85],
    ['noise', 8000, 3000, 0.05, 0.2, 0.8, 'hiss', 'highpass'],
  ],
  over: [
    ['run', 'p25', Ms([67, 66, 65, 64, 62, 60, 55]), 0.14, 0.24, 0],
    ['run', 'triangle', Ms([55, 54, 53, 52, 50, 48, 43]), 0.14, 0.55, 0],
    ['wob', 'p12', 196, 98, 0.8, 0.08, 0.85, 5, 6],
    ['noise', 500, 50, 0.9, 0.4, 0.8, 'deep'],
  ],
  combo: [
    ['arp', 'p12', Ms([84, 88, 91]), 0.025, 0.12, 0.2, 0],
    ['p25', 1760, 2637, 0.07, 0.12, 0.05],
  ],
  alarm: [
    ['wob', 'p25', 660, 880, 0.3, 0.16, 0, 4, 60],
    ['wob', 'p25', 660, 880, 0.3, 0.16, 0.34, 4, 60],
    ['triangle', 330, 440, 0.6, 0.2, 0],
  ],
  lowammo: [
    ['p12', 1568, 1568, 0.04, 0.14, 0], ['p12', 1175, 1175, 0.05, 0.14, 0.07],
  ],
  crumble: [
    ['noise', 1200, 80, 0.9, 0.7, 0, 'deep'],
    ['noise', 1800, 400, 0.05, 0.3, 0.05, 'metal', 'bandpass', 3],
    ['noise', 1500, 350, 0.05, 0.28, 0.16, 'metal', 'bandpass', 3],
    ['noise', 1300, 300, 0.05, 0.26, 0.27, 'metal', 'bandpass', 3],
    ['noise', 1100, 250, 0.05, 0.22, 0.4, 'metal', 'bandpass', 3],
    ['square', 98, 33, 0.6, 0.2, 0.05],
  ],
  repair: [
    ['run', 'p12', Ms([79, 84, 88, 91, 96]), 0.045, 0.2, 0],
    ['noise', 3000, 1500, 0.03, 0.35, 0.02, 'metal', 'bandpass', 4],
    ['noise', 3400, 1700, 0.03, 0.3, 0.12, 'metal', 'bandpass', 4],
  ],
  firework: [
    ['noise', 6000, 400, 0.18, 0.45, 0, 'crunch'],
    ['triangle', 300, 70, 0.1, 0.4, 0],
    ['noise', 9000, 5000, 0.03, 0.22, 0.12, 'hiss', 'highpass'],
    ['noise', 9000, 5000, 0.03, 0.2, 0.19, 'hiss', 'highpass'],
    ['noise', 9000, 5000, 0.03, 0.18, 0.27, 'hiss', 'highpass'],
    ['noise', 9000, 5000, 0.03, 0.14, 0.36, 'hiss', 'highpass'],
  ],
  entry: [
    ['noise', 4000, 900, 0.5, 0.18, 0, 'hiss', 'bandpass', 2],
    ['wob', 'triangle', 900, 300, 0.45, 0.06, 0, 12, 30],
  ],
  blip: [['p25', 988, 1319, 0.04, 0.16, 0]],
};
const LOGGED = new Set(['launch', 'hit', 'wrong', 'land', 'reload', 'empty', 'wave']);
const EXTRA = new Set(Object.keys(TONES).filter(n => !LOGGED.has(n)));
const ECHO = new Set(['wave', 'ready', 'reload', 'win', 'over', 'start', 'bigboom', 'repair', 'firework']);
const CRUSH = new Set(['wrong', 'bigboom', 'land', 'boss', 'crumble', 'empty']);
const VARY = new Set(['launch', 'boom', 'bigboom', 'land', 'split', 'chain', 'firework', 'entry', 'crumble']);
// background effects that are skipped when many sounds already ring (never the logged ones)
const MINOR = new Set(['entry', 'firework', 'combo', 'blip', 'lowammo', 'chain', 'boom']);
const LONGEST = 2.2; // seconds: no effect rings longer (bus cleanup)

let ctx = null;
let master = null;
let echoIn = null;
let crushIn = null;
let noiseBufs = {};
let pulses = {};
let muted = false;
let ducked = false;
const lastAt = {};
let ringing = []; // end times of effects still sounding
export const log = []; // names played (tests read it)

function context() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    noiseBufs = {}; pulses = {};
    // master level -> compressor (a soft limiter) -> speakers
    master = ctx.createGain();
    master.gain.value = target();
    let out = ctx.destination;
    if (ctx.createDynamicsCompressor) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 10;
      comp.attack.value = 0.003; comp.release.value = 0.18;
      comp.connect(ctx.destination);
      out = comp;
    }
    master.connect(out);
    // a short echo for jingles
    echoIn = ctx.createGain();
    echoIn.gain.value = 0.35;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.17;
    const back = ctx.createGain();
    back.gain.value = 0.3;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 3800;
    echoIn.connect(delay); delay.connect(tone); tone.connect(back); back.connect(delay); tone.connect(master);
    // a bit-crusher: boost, round to a few levels, bring back down
    const pre = ctx.createGain(); pre.gain.value = 5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.round(x * 6) / 6; }
    shaper.curve = curve;
    const post = ctx.createGain(); post.gain.value = 0.22;
    pre.connect(shaper); shaper.connect(post); post.connect(master);
    crushIn = pre;
  } catch { ctx = null; master = null; echoIn = null; crushIn = null; }
  return ctx;
}

// One second of noise in a given colour.
function noise(c, colour = 'grit') {
  if (noiseBufs[colour]) return noiseBufs[colour];
  const n = c.sampleRate;
  const buf = c.createBuffer(1, n, n);
  const d = buf.getChannelData(0);
  let v = 0;
  if (colour === 'hiss') {
    for (let i = 0; i < n; i++) { if (i % 2 === 0) v = Math.random() * 2 - 1; d[i] = v; }
  } else if (colour === 'deep') {
    // brown-ish: integrated white noise, a low rumble
    for (let i = 0; i < n; i++) { v = (v + 0.04 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.2; }
  } else if (colour === 'crunch' || colour === 'metal') {
    // a linear-feedback shift register: long (15 bit) is a rough crunch, short (7 bit) repeats
    // quickly and rings like metal
    const short = colour === 'metal';
    let reg = 0x7fff;
    const hold = short ? 9 : 4;
    for (let i = 0; i < n; i++) {
      if (i % hold === 0) {
        const bit = (reg ^ (reg >> 1)) & 1;
        reg = (reg >> 1) | (bit << 14);
        if (short) reg = (reg & ~(1 << 6)) | (bit << 6);
        v = reg & 1 ? 0.9 : -0.9;
      }
      d[i] = v;
    }
  } else {
    for (let i = 0; i < n; i++) { if (i % 6 === 0) v = Math.random() * 2 - 1; d[i] = v; }
  }
  noiseBufs[colour] = buf;
  return buf;
}

// Pulse waves (duty 12.5 % or 25 %): thinner, brighter than a square.
function pulse(c, duty) {
  if (pulses[duty]) return pulses[duty];
  const N = 40;
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (let k = 1; k < N; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  pulses[duty] = c.createPeriodicWave(real, imag);
  return pulses[duty];
}

const target = () => (muted ? 0 : (ducked ? DUCK : 1));

function apply() {
  if (!ctx || !master) return;
  try { master.gain.setTargetAtTime(target(), ctx.currentTime, 0.03); } catch { master.gain.value = target(); }
}

export function level() { return target(); }
export function isMuted() { return muted; }

export function setMuted(v) { muted = !!v; apply(); }

function envelope(c, t, dur, g, bus) {
  const v = c.createGain();
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(Math.max(0.0002, VOLUME * g), t + 0.006);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  v.connect(bus);
  return v;
}

function setWave(c, o, type) {
  if (type === 'p12' || type === 'p25') {
    try { o.setPeriodicWave(pulse(c, type === 'p12' ? 0.125 : 0.25)); return; } catch { o.type = 'square'; return; }
  }
  o.type = type;
}

// An oscillator into `out`; a square or pulse gets a second, slightly sharp copy for a fuller sound.
function voices(c, type, out, t, end, shape) {
  const list = [0];
  if (type === 'square' || type === 'p25') list.push(11);
  for (const cents of list) {
    const o = c.createOscillator();
    setWave(c, o, type);
    o.detune.value = cents;
    shape(o.frequency);
    if (cents) { const half = c.createGain(); half.gain.value = 0.5; o.connect(half); half.connect(out); } else o.connect(out);
    o.start(t); o.stop(end);
  }
}

function part(c, t0, p, k, bus) {
  if (p[0] === 'noise') {
    const [, f0, f1, dur, g, delay, colour = 'grit', type = 'lowpass', q] = p;
    const t = t0 + delay;
    const src = c.createBufferSource();
    src.buffer = noise(c, colour); src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    if (q != null) f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    src.connect(f); f.connect(envelope(c, t, dur, g, bus));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    return t + dur;
  }
  if (p[0] === 'run') {
    const [, type, notes, step, g, delay] = p;
    const t = t0 + delay, dur = step * (notes.length + 1.5);
    voices(c, type, envelope(c, t, dur, g, bus), t, t + dur + 0.02,
      f => notes.forEach((hz, i) => f.setValueAtTime(hz * k, t + i * step)));
    return t + dur;
  }
  if (p[0] === 'arp') {
    const [, type, notes, step, dur, g, delay] = p;
    const t = t0 + delay;
    voices(c, type, envelope(c, t, dur, g, bus), t, t + dur + 0.02, f => {
      for (let i = 0, at = 0; at < dur; i++, at += step) f.setValueAtTime(notes[i % notes.length] * k, t + at);
    });
    return t + dur;
  }
  const wob = p[0] === 'wob';
  const [type, f0, f1, dur, g, delay, rate, depth] = wob ? p.slice(1) : p;
  const t = t0 + delay;
  const out = envelope(c, t, dur, g, bus);
  let lfo = null;
  if (wob) {
    const osc = c.createOscillator();
    osc.frequency.value = rate;
    lfo = c.createGain();
    lfo.gain.value = depth * k;
    osc.connect(lfo);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  voices(c, type, out, t, t + dur + 0.02, f => {
    f.setValueAtTime(f0 * k, t);
    f.exponentialRampToValueAtTime(Math.max(20, f1 * k), t + dur);
    if (lfo) lfo.connect(f);
  });
  return t + dur;
}

export function play(name, opts = {}) {
  const parts = TONES[name];
  if (!parts || muted) return false;
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') { try { c.resume(); } catch { /* needs a gesture */ } }
  if (!EXTRA.has(name)) {
    log.push(name);
    if (log.length > 50) log.shift();
  }
  const now = c.currentTime;
  // the same effect twice in one instant (a chain of kills) sounds once, louder is not better
  if (lastAt[name] != null && now - lastAt[name] < 0.03) return true;
  ringing = ringing.filter(e => e > now);
  if (MINOR.has(name) && ringing.length >= 10) return true;
  lastAt[name] = now;
  const t0 = now + 0.01;
  const k = (Number(opts.pitch) || 1) * (VARY.has(name) ? 0.95 + Math.random() * 0.1 : 1);
  let bus = null;
  try {
    bus = c.createGain();
    let tail = bus;
    const pan = Math.max(-1, Math.min(1, Number(opts.pan) || 0));
    if (pan && c.createStereoPanner) {
      const sp = c.createStereoPanner();
      sp.pan.value = pan;
      bus.connect(sp);
      tail = sp;
    }
    tail.connect(CRUSH.has(name) && crushIn ? crushIn : master);
    if (CRUSH.has(name)) { const dry = c.createGain(); dry.gain.value = 0.7; tail.connect(dry); dry.connect(master); }
    if (ECHO.has(name) && echoIn) tail.connect(echoIn);
  } catch { return true; }
  let end = t0;
  for (const p of parts) {
    try { end = Math.max(end, part(c, t0, p, k, bus)); } catch { /* a closed context: skip */ }
  }
  ringing.push(end);
  setTimeout(() => { try { bus.disconnect(); } catch { /* gone */ } }, (Math.min(LONGEST, end - now) + 0.6) * 1000);
  return true;
}

export function names() { return Object.keys(TONES); }

export function attach(el) {
  if (!el) return () => {};
  const on = () => { ducked = true; apply(); };
  const off = () => { ducked = false; apply(); };
  el.addEventListener('playing', on);
  el.addEventListener('play', on);
  el.addEventListener('pause', off);
  el.addEventListener('ended', off);
  el.addEventListener('emptied', off);
  ducked = !el.paused && !el.ended;
  apply();
  return () => {
    for (const [k, f] of [['playing', on], ['play', on], ['pause', off], ['ended', off], ['emptied', off]]) el.removeEventListener(k, f);
    ducked = false;
  };
}

export function close() {
  if (ctx) { try { ctx.close(); } catch { /* already closed */ } }
  ctx = null; master = null; echoIn = null; crushIn = null; noiseBufs = {}; pulses = {}; ringing = [];
  for (const k of Object.keys(lastAt)) delete lastAt[k];
}
