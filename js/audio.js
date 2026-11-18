// audio.js: plays an item's or a letter's clip (task E2; PLAN 4.5).
//
//   play(itemOrLetter, {voice: 'f'|'m'|'alt', slow}) -> Promise, resolved on `ended`
//   stop()                                           stops what is playing (its promise resolves)
//   element()                                        the page's one <audio> element
//
// `itemOrLetter.audio` = {f, m}: paths written by the build (content.js audioUrl). When the
// asked voice is missing (or fails to load) the other one plays. 'alt' takes female and male
// in turn, one call to the next. The whole file is fetched and played from memory (iPhone
// can't seek cached files). Slow = playbackRate 0.75 with the pitch kept.
// With no clip at all the promise resolves at once with false; it resolves true after `ended`.

import { audioUrl } from './content.js';

let el = null;
let altNext = 'f';
let current = null; // {done} for the clip playing now
const blobs = new Map(); // url -> object URL
const MAX_BLOBS = 60;

export function element() {
  if (!el) {
    el = document.createElement('audio');
    el.preload = 'auto';
    el.hidden = true;
    el.className = 'app-audio';
    (document.body || document.documentElement).append(el);
  }
  return el;
}

async function objectUrl(path) {
  const url = audioUrl(path);
  if (blobs.has(url)) return blobs.get(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`audio ${r.status}`);
  const obj = URL.createObjectURL(await r.blob());
  if (blobs.size >= MAX_BLOBS) {
    const [oldUrl, oldObj] = blobs.entries().next().value;
    blobs.delete(oldUrl);
    URL.revokeObjectURL(oldObj);
  }
  blobs.set(url, obj);
  return obj;
}

function setSlow(a, slow) {
  a.playbackRate = slow ? 0.75 : 1;
  a.defaultPlaybackRate = a.playbackRate;
  for (const k of ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch']) {
    try { a[k] = true; } catch { /* not supported */ }
  }
}

/** Fetch the sound files of these items ahead of time, so a later play() starts at once. */
export function preload(items) {
  for (const it of items || []) {
    const files = (it && it.audio) || {};
    const f = (typeof files.f === 'string' && files.f) || (typeof files.m === 'string' && files.m);
    if (f) objectUrl(f).catch(() => {});
  }
}

export function stop() {
  if (current) { const c = current; current = null; c.done(false); }
  if (el) { try { el.pause(); } catch { /* nothing playing */ } }
}

export async function play(itemOrLetter, opts = {}) {
  const files = (itemOrLetter && itemOrLetter.audio) || {};
  let voice = opts.voice || 'f';
  if (voice === 'alt') { voice = altNext; altNext = altNext === 'f' ? 'm' : 'f'; }
  const other = voice === 'f' ? 'm' : 'f';
  const order = [voice, other].filter((v) => typeof files[v] === 'string' && files[v]);
  stop();
  if (!order.length) return false;

  let src = null, lastErr = null;
  for (const v of order) {
    try { src = await objectUrl(files[v]); break; } catch (e) { lastErr = e; }
  }
  if (!src) throw lastErr || new Error('audio missing');

  const a = element();
  stop();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
    };
    const me = { done: (v) => { cleanup(); resolve(v); } };
    const onEnded = () => { if (current === me) current = null; me.done(true); };
    const onError = () => {
      if (current === me) current = null;
      cleanup();
      reject(new Error('audio could not play'));
    };
    current = me;
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    a.src = src;
    setSlow(a, !!opts.slow);
    const p = a.play();
    // load() resets playbackRate to defaultPlaybackRate; set again once playing.
    setSlow(a, !!opts.slow);
    if (p && typeof p.catch === 'function') p.catch((e) => { if (current === me) { current = null; cleanup(); reject(e); } });
  });
}
