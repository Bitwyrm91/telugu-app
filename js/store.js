// store.js: everything the app keeps on this device (task E2; SPECS S3).
//
//   get(key) -> value          synchronous; a copy (changing it changes nothing stored)
//   set(key, val)              synchronous; JSON under 'telugu.<key>' in localStorage
//   newId() -> 16 hex digits   crypto.getRandomValues (never crypto.randomUUID)
//   exportAll() -> object      every exported key; sets meta.exported
//   importAll(obj, opts)       merges (never replaces) by the S3 rules; opts.settings: take theirs
//   inContent(map, ids)        the entries of `map` whose id is in `ids` (the rest are kept, not counted)
//
// If localStorage throws (private mode, full, blocked), the app shows the banner
// "Progress can't be saved in this browser" and carries on in memory.

const PREFIX = 'telugu.';
const EXPORTED = ['meta', 'settings', 'progress', 'cards', 'streak', 'reports', 'game', 'writing'];   // writing: SPECS S17

// Shapes returned by get() when nothing is stored yet.
const DEFAULTS = {
  settings: {
    rom: 'auto', voice: 'f', slow: false, speak: true, goal: 1, theme: 'system',
    strict: false, typing: 'tiles', reads: false, onboarded: false,
  },
  progress: { lessons: {}, letters: {} },
  cards: {},
  streak: { days: [], xp: {} },
  reports: [],
  resume: null,
  meta: null,
  game: { best: {}, runs: {}, mute: false }, // game (GAME-PLAN.md): best score and runs per mode
  writing: { items: {} },   // S17 writing trainer: stage and writing SRS per letter / syllable
};

const mem = new Map();     // key -> JSON text; this session's truth, written through to storage
let broken = false;        // storage has thrown at least once

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nowIso = () => new Date().toISOString();

function ls() {
  return globalThis.localStorage; // the getter itself may throw (blocked site data)
}

function storageFailed() {
  broken = true;
  showBanner();
}

export function showBanner() {
  if (typeof document === 'undefined') return;
  const put = () => {
    if (!document.body || document.getElementById('storage-banner')) return;
    const b = document.createElement('div');
    b.className = 'banner';
    b.id = 'storage-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'
      + '<path d="M12 11v6M12 7.5v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const t = document.createElement('span');
    t.textContent = "Progress can't be saved in this browser";
    b.append(t);
    document.body.prepend(b);
  };
  if (document.body) put();
  else document.addEventListener('DOMContentLoaded', put, { once: true });
}

function readRaw(key) {
  if (mem.has(key)) return mem.get(key);
  let text = null;
  try {
    text = ls().getItem(PREFIX + key);
  } catch {
    storageFailed();
  }
  if (text != null) {
    try { JSON.parse(text); } catch { text = null; } // unreadable: treat as missing
  }
  mem.set(key, text);
  return text;
}

function writeRaw(key, text) {
  mem.set(key, text);
  try {
    if (text == null) ls().removeItem(PREFIX + key);
    else ls().setItem(PREFIX + key, text);
  } catch {
    storageFailed();
  }
}

export function get(key) {
  const text = readRaw(key);
  if (text == null) return clone(DEFAULTS[key] ?? null);
  const v = JSON.parse(text);
  if (key === 'settings' && isObj(v)) return { ...clone(DEFAULTS.settings), ...v };
  return v;
}

export function set(key, val) {
  const text = val === undefined || val === null ? null : JSON.stringify(val);
  writeRaw(key, text);
  if (key !== 'meta') {
    const meta = get('meta');
    if (meta) { meta.updated = nowIso(); writeRaw('meta', JSON.stringify(meta)); }
  }
}

export function newId() {
  const bytes = new Uint8Array(8);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- first run ----------------------------------------------------------------

function init() {
  try {
    const s = ls();
    s.setItem(PREFIX + '__probe', '1');
    s.removeItem(PREFIX + '__probe');
  } catch {
    storageFailed();
  }
  if (get('meta')) return;
  writeRaw('meta', JSON.stringify({
    schema: 1, device: newId(), updated: nowIso(), persisted: null, exported: null,
  }));
  try {
    const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (st && typeof st.persist === 'function') {
      Promise.resolve(st.persist()).then((ok) => {
        const meta = get('meta');
        if (meta) { meta.persisted = !!ok; writeRaw('meta', JSON.stringify(meta)); }
      }, () => {});
    }
  } catch { /* persisted stays null */ }
}

// ---- export / import ------------------------------------------------------------

export function exportAll() {
  const meta = get('meta') || {};
  meta.exported = nowIso();
  writeRaw('meta', JSON.stringify(meta));
  const out = {};
  for (const k of EXPORTED) if ((k !== 'game' && k !== 'writing') || readRaw(k) != null) out[k] = get(k); // game, writing: once used
  return out;
}

const time = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };

function earlier(a, b) {
  const ta = time(a), tb = time(b);
  if (tb === null) return a ?? null;
  if (ta === null) return b;
  return tb < ta ? b : a;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function higher(a, b) {
  const na = num(a), nb = num(b);
  if (nb === null) return a;
  if (na === null) return b;
  return nb > na ? b : a;
}

function mergeLesson(a, b) {
  if (!isObj(a)) return clone(b);
  if (!isObj(b)) return a;
  const out = { ...a };
  out.done = earlier(a.done, b.done);
  out.best = higher(a.best, b.best);
  out.runs = higher(a.runs, b.runs);
  if ((num(b.runs) ?? -1) > (num(a.runs) ?? -1)) out.secs = b.secs;
  for (const k of ['done', 'best', 'runs', 'secs']) if (out[k] === undefined) delete out[k];
  return out;
}

function mergeLetter(a, b) {
  if (!isObj(a)) return clone(b);
  if (!isObj(b)) return a;
  return { ...a, seen: earlier(a.seen, b.seen) };
}

function mergeMap(a, b, fn) {
  const out = isObj(a) ? { ...a } : {};
  if (!isObj(b)) return out;
  for (const [id, v] of Object.entries(b)) {
    out[id] = Object.prototype.hasOwnProperty.call(out, id) ? fn(out[id], v) : clone(v);
  }
  return out;
}

function mergeCard(a, b) {
  if (!isObj(a)) return clone(b);
  if (!isObj(b)) return a;
  const ta = time(a.last), tb = time(b.last);
  return tb !== null && (ta === null || tb > ta) ? clone(b) : a;
}

function mergeStreak(a, b) {
  const out = { days: Array.isArray(a?.days) ? [...a.days] : [], xp: isObj(a?.xp) ? { ...a.xp } : {} };
  if (Array.isArray(b?.days)) out.days = [...new Set([...out.days, ...b.days])].sort();
  if (isObj(b?.xp)) {
    for (const [d, n] of Object.entries(b.xp)) out.xp[d] = higher(out.xp[d], n);
  }
  return out;
}

function mergeReports(a, b) {
  const out = Array.isArray(a) ? a.map((r) => ({ ...r })) : [];
  if (!Array.isArray(b)) return out;
  const byId = new Map(out.map((r) => [r.id, r]));
  for (const r of b) {
    if (!isObj(r) || r.id == null) continue;
    const mine = byId.get(r.id);
    if (!mine) { const c = clone(r); out.push(c); byId.set(c.id, c); continue; }
    mine.sent = !!(mine.sent || r.sent);
    mine.failed = !!((mine.failed || r.failed) && !mine.sent);
  }
  return out;
}

// Game: the higher best score and run count per mode; this device keeps its own mute switch.
function mergeGame(a, b) {
  const out = isObj(a) ? clone(a) : clone(DEFAULTS.game);
  if (!isObj(out.best)) out.best = {};
  if (!isObj(out.runs)) out.runs = {};
  if (!isObj(b)) return out;
  for (const k of ['best', 'runs']) {
    if (!isObj(b[k])) continue;
    for (const [mode, n] of Object.entries(b[k])) {
      const v = higher(out[k][mode], n);
      if (v !== undefined && v !== null) out[k][mode] = v;
    }
  }
  return out;
}

// S17 writing: per item, the record with the later last.at wins.
function mergeWriting(a, b) {
  const out = isObj(a) && isObj(a.items) ? clone(a) : { items: {} };
  if (!isObj(b) || !isObj(b.items)) return out;
  for (const [id, v] of Object.entries(b.items)) {
    if (!isObj(v)) continue;
    const mine = out.items[id];
    const tm = isObj(mine) && isObj(mine.last) ? time(mine.last.at) : null;
    const tv = isObj(v.last) ? time(v.last.at) : null;
    if (!isObj(mine) || (tv !== null && (tm === null || tv > tm))) out.items[id] = clone(v);
  }
  return out;
}

// Merges an exported object into this device's data. `meta` and `resume` are never imported.
export function importAll(obj, opts = {}) {
  if (!isObj(obj)) throw new Error('Not a progress file');
  const next = {
    progress: (() => {
      const a = get('progress'), b = isObj(obj.progress) ? obj.progress : {};
      return {
        ...a,
        lessons: mergeMap(a.lessons, b.lessons, mergeLesson),
        letters: mergeMap(a.letters, b.letters, mergeLetter),
      };
    })(),
    cards: mergeMap(get('cards'), obj.cards, mergeCard),
    streak: mergeStreak(get('streak'), obj.streak),
    reports: mergeReports(get('reports'), obj.reports),
    game: mergeGame(get('game'), obj.game),
    writing: mergeWriting(get('writing'), obj.writing),
  };
  if (opts && opts.settings && isObj(obj.settings)) next.settings = { ...get('settings'), ...obj.settings };
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(v) !== JSON.stringify(get(k))) set(k, v);
  }
}

// Entries of a stored map (cards, progress.lessons, progress.letters) whose id is in the
// compiled content. The others stay in the store and count again if their item returns.
export function inContent(map, ids) {
  const has = ids instanceof Set ? (id) => ids.has(id) : (id) => ids.includes(id);
  const out = {};
  for (const [id, v] of Object.entries(map || {})) if (has(id)) out[id] = v;
  return out;
}

// Tests only: forget the in-memory copy and run the first-run steps again.
export function _reset() {
  mem.clear();
  broken = false;
  init();
}
export function _isBroken() { return broken; }

init();
