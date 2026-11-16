// content.js: loads the compiled content (task E2; PLAN 4.3 and 4.5).
//
//   loadIndex()    -> content/index.json
//   loadUnit(id)   -> content/units/<id>.json
//   loadLetters()  -> content/letters.json
//   loadOnboard()  -> content/onboard.json
//   loadStrokes()  -> content/strokes.json (S16 letter drawing; may be missing)
//   contentIds(units, letters) -> Set of every item id, letter id, 'L:'+letter id and lesson id
//   audioUrl(path) -> absolute URL of an audio path written by the build
//
// Each file is fetched once and kept in memory. The folder is `content/` unless the page
// is on localhost and `?content=<folder>` names another (tests only).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// The content folder as an absolute URL ending in '/'.
export function contentBase(loc = globalThis.location) {
  let folder = 'content/';
  try {
    const url = new URL(loc.href);
    const asked = url.searchParams.get('content');
    if (asked && LOCAL_HOSTS.has(url.hostname)) folder = asked.endsWith('/') ? asked : asked + '/';
    return new URL(folder, url).href;
  } catch {
    return folder;
  }
}

// Audio paths (`audio: {f, m}`) are relative to the content folder, as the build writes them
// (`../audio/…` in the real build: `app/audio/` sits beside `app/content/`).
export function audioUrl(path, loc = globalThis.location) {
  return new URL(path, contentBase(loc)).href;
}

const cache = new Map(); // url -> Promise of parsed JSON

function load(rel) {
  const url = new URL(rel, contentBase()).href;
  if (!cache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${rel} (${r.status})`);
      return r.json();
    });
    p.catch(() => cache.delete(url)); // a failed load can be tried again
    cache.set(url, p);
  }
  return cache.get(url);
}

export const loadIndex = () => load('index.json');
export const loadUnit = (id) => load(`units/${encodeURIComponent(id)}.json`);
export const loadLetters = () => load('letters.json');
export const loadOnboard = () => load('onboard.json');
// S16: optional. A missing or broken file means "no stroke data": callers catch and carry on.
export const loadStrokes = () => load('strokes.json');

// Every id a stored card or lesson entry can have that is in the compiled content.
// A card or lesson whose id is not here is kept in the store but not counted (SPECS S3).
export function contentIds(units = [], letters = null) {
  const ids = new Set();
  for (const u of units) {
    if (!u) continue;
    for (const it of u.items || []) ids.add(it.id);
    for (const l of u.lessons || []) ids.add(l.id);
  }
  if (letters) {
    for (const l of letters.letters || []) { ids.add('L:' + l.id); ids.add(l.id); } // cards, progress.letters
    const lessons = letters.lessons || {};
    for (const id of Array.isArray(lessons) ? lessons.map((l) => l.id) : Object.keys(lessons)) ids.add(id);
  }
  return ids;
}

// Tests only.
export function _clearCache() { cache.clear(); }
