// write/progress.js: the writing trainer's own record and SRS (SPECS S17 "Data").
//
//   STAGES                          ['watch', 'trace', 'fade', 'copy', 'recall'] (0..4)
//   INTERVALS                       writing SRS days by box: 1, 3, 7, 16, 35
//   getItem(id) -> record           {stage, box, due, last, passes, fails, skips, best} (a fresh one if none)
//   record(id, stage, outcome, {q, firstTry, now})   outcome 'pass' | 'fail' | 'skip' | 'shown'
//   isDue(rec, now), pickSession(ids, n, now) -> [id]   due recall first, then learning by lowest stage, weakest
//   syllableKey(consonantId, signId) -> 'S:<c>+<s>'
// Writing never feeds recognition cards or lesson scores: nothing here touches `cards` or `progress`.

import * as store from '../store.js';

export const STAGES = ['watch', 'trace', 'fade', 'copy', 'recall'];
export const INTERVALS = [1, 3, 7, 16, 35];
const DAY = 86400000;

const fresh = () => ({ stage: 0, box: 0, due: null, last: null, passes: 0, fails: 0, skips: 0, best: 0 });

function load() {
  let w = null;
  try { w = store.get('writing'); } catch { w = null; }
  if (!w || typeof w !== 'object' || !w.items || typeof w.items !== 'object') w = { items: {} };
  return w;
}

export function allItems() { return load().items; }

export function getItem(id) {
  const r = load().items[id];
  return r && typeof r === 'object' ? { ...fresh(), ...r } : fresh();
}

/**
 * One result. A pass moves the stage up one (to 4). At Recall a first-try pass moves the box up and sets
 * the next due date; a first-try fail at Recall resets the box and makes it due tomorrow. A skip or a
 * "Show me" never counts as a pass and changes no stage.
 */
export function record(id, stage, outcome, { q = 0, firstTry = true, now = Date.now() } = {}) {
  const w = load();
  const r = { ...fresh(), ...(w.items[id] || {}) };
  const at = new Date(now).toISOString();
  if (outcome === 'pass') {
    r.passes += 1;
    r.best = Math.max(r.best || 0, q || 0);
    if (stage >= 4) {
      if (firstTry) r.box = Math.min(INTERVALS.length - 1, (r.box || 0) + (r.stage >= 4 ? 1 : 0));
      r.due = new Date(now + INTERVALS[r.box] * DAY).toISOString();
    }
    if (stage >= r.stage) r.stage = Math.min(4, stage + 1);
    if (r.stage >= 4 && !r.due) r.due = new Date(now + INTERVALS[r.box] * DAY).toISOString();
  } else if (outcome === 'fail') {
    r.fails += 1;
    if (stage >= 4 && firstTry) { r.box = 0; r.due = new Date(now + DAY).toISOString(); }
  } else if (outcome === 'skip') r.skips += 1;
  r.last = { at, ok: outcome === 'pass', q: q || 0, stage, outcome };
  w.items[id] = r;
  try { store.set('writing', w); } catch { /* storage banner shows */ }
  return r;
}

export function isDue(r, now = Date.now()) {
  if (!r) return false;
  if (r.stage < 4) return true;   // learning: always ready
  const t = Date.parse(r.due);
  return !Number.isFinite(t) || t <= now;
}

/** Up to n ids: due recall items first (oldest due), then learning items by lowest stage, then the weakest. */
export function pickSession(ids, n = 8, now = Date.now()) {
  const items = ids.map(id => ({ id, r: getItem(id) }));
  const due = items.filter(x => x.r.stage >= 4 && isDue(x.r, now))
    .sort((a, b) => (Date.parse(a.r.due) || 0) - (Date.parse(b.r.due) || 0));
  const learning = items.filter(x => x.r.stage < 4)
    .sort((a, b) => a.r.stage - b.r.stage || (b.r.fails - b.r.passes) - (a.r.fails - a.r.passes));
  const rest = items.filter(x => x.r.stage >= 4 && !isDue(x.r, now))
    .sort((a, b) => (b.r.fails - b.r.passes) - (a.r.fails - a.r.passes));
  const out = [...due, ...learning, ...rest].map(x => x.id);
  return out.slice(0, n);
}

export const syllableKey = (c, s) => `S:${c}+${s}`;
