// game/sfx.js: short effect tones made with WebAudio (no files). Speech wins: while the app's
// <audio> element plays, effects are lowered to DUCK of their level.
//
//   sfx.play(name)      name: launch | hit | wrong | land | wave
//   sfx.setMuted(bool)  sfx.isMuted()
//   sfx.attach(audioEl) follow this element's play/pause/ended for ducking; returns detach()
//   sfx.level()         the master gain the next tone uses (1, DUCK, or 0 when muted)
//   sfx.close()         stop and release the audio context

export const DUCK = 0.25;
const VOLUME = 0.18;

// Each tone: [type, startHz, endHz, seconds, gain, delay]
const TONES = {
  launch: [['triangle', 320, 880, 0.16, 0.7, 0]],
  hit: [['square', 660, 990, 0.08, 0.5, 0], ['triangle', 990, 1320, 0.12, 0.6, 0.07]],
  wrong: [['sawtooth', 180, 120, 0.22, 0.5, 0]],
  land: [['sine', 140, 50, 0.45, 1, 0], ['sawtooth', 90, 40, 0.3, 0.35, 0]],
  wave: [['triangle', 523, 523, 0.12, 0.6, 0], ['triangle', 659, 659, 0.12, 0.6, 0.12], ['triangle', 784, 784, 0.22, 0.6, 0.24]],
};

let ctx = null;
let master = null;
let muted = false;
let ducked = false;
export const log = []; // names played (tests read it)

function context() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = target();
    master.connect(ctx.destination);
  } catch { ctx = null; master = null; }
  return ctx;
}

const target = () => (muted ? 0 : (ducked ? DUCK : 1));

function apply() {
  if (!ctx || !master) return;
  try { master.gain.setTargetAtTime(target(), ctx.currentTime, 0.03); } catch { master.gain.value = target(); }
}

export function level() { return target(); }
export function isMuted() { return muted; }

export function setMuted(v) { muted = !!v; apply(); }

export function play(name) {
  const parts = TONES[name];
  if (!parts || muted) return false;
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') { try { c.resume(); } catch { /* needs a gesture */ } }
  log.push(name);
  if (log.length > 50) log.shift();
  const t0 = c.currentTime + 0.01;
  for (const [type, f0, f1, dur, g, delay] of parts) {
    try {
      const o = c.createOscillator();
      const v = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0 + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + delay + dur);
      v.gain.setValueAtTime(0.0001, t0 + delay);
      v.gain.exponentialRampToValueAtTime(VOLUME * g, t0 + delay + 0.01);
      v.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      o.connect(v); v.connect(master);
      o.start(t0 + delay);
      o.stop(t0 + delay + dur + 0.02);
    } catch { /* a closed context: skip */ }
  }
  return true;
}

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
  ctx = null; master = null;
}
