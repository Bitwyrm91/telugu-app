// write/pool.js: what can be written now (SPECS S17 "Screens", S18 "Words", "Daily use").
//
//   writeItems(L, cx) -> {letters, syllables}       met letters in teaching order; syllables of two Recall parts
//   loadWords(L) -> Promise<[wordList entry]>        words of finished lessons (write/word.js wordList)
//   loadPool() -> Promise<{L, S, cx, letters, syllables, words, wordMap, ids}>
//       ids: every writable id (letters, syllables, unlocked words); wordMap for ladder.describe
//   writeCounts(ids, now) -> {due, fresh}            due: at Recall with the review date passed; fresh: not yet
//                                                    at Recall (new or still being learnt, nothing scheduled)
//   SESSION                                          a practice run is at most this many items
// Reads content and the stores; writes nothing.

import * as store from '../store.js';
import * as content from '../content.js';
import { makeCtx } from '../ex/common.js';
import { wordList } from './word.js';
import * as prog from './progress.js';

export function writeItems(L, cx) {
  const all = (L && L.letters) || [];
  const order = [];
  const seen = new Set();
  for (const ls of (Array.isArray(L.lessons) ? L.lessons : Object.values(L.lessons || {}))) {
    for (const id of ls.letters || []) if (!seen.has(id)) { seen.add(id); order.push(id); }
  }
  for (const l of all) if (!seen.has(l.id)) { seen.add(l.id); order.push(l.id); }
  const letters = order.filter(id => cx.taught.has(id) && all.some(l => l.id === id));
  const syll = [];
  const items = prog.allItems();
  const atRecall = id => items[id] && items[id].stage >= 4;
  // signs are written on the carrier (న), so carrier + sign is the sign item itself: not a second cell
  const carrierId = (all.find(l => l.glyph === L.carrier) || {}).id;
  for (const [c, signs] of Object.entries(L.built || {})) {
    if (!atRecall(c) || c === carrierId) continue;
    for (const s of Object.keys(signs || {})) if (atRecall(s)) syll.push(prog.syllableKey(c, s));
  }
  return { letters, syllables: syll };
}

export async function loadWords(L) {
  let index = null;
  try { index = await content.loadIndex(); } catch { return []; }
  const p = store.get('progress') || {};
  const done = new Set(Object.entries(p.lessons || {}).filter(([, v]) => v && v.done).map(([k]) => k));
  if (!done.size) return [];
  const units = [];
  for (const u of (index && index.units) || []) {
    if (!(u.lessons || []).some(l => done.has(l.id))) continue;
    try { units.push(await content.loadUnit(u.id)); } catch { /* a unit that does not load has no words */ }
  }
  const letterIds = new Set(((L && L.letters) || []).map(l => l.id));
  return wordList(units, letterIds, done, id => prog.getItem(id).stage);
}

export async function loadPool() {
  let L = null, S = null;
  try { L = await content.loadLetters(); } catch { L = null; }
  try { S = await content.loadStrokes(); } catch { S = null; }
  if (!L || !Array.isArray(L.letters)) return { L: null, S, cx: null, letters: [], syllables: [], words: [], wordMap: new Map(), ids: [] };
  const cx = makeCtx({ carrier: L.carrier });
  const { letters, syllables } = writeItems(L, cx);
  let words = [];
  try { words = await loadWords(L); } catch { words = []; }
  const wordMap = new Map(words.map(w => [w.id, w]));
  const ids = [...letters, ...syllables, ...words.filter(w => w.unlocked).map(w => w.id)];
  return { L, S, cx, letters, syllables, words, wordMap, ids };
}

export const SESSION = 8;

export function writeCounts(ids, now = Date.now()) {
  let due = 0, fresh = 0;
  for (const id of ids) {
    const r = prog.getItem(id);
    if (r.stage < 4) fresh += 1;
    else if (prog.isDue(r, now)) due += 1;
  }
  return { due, fresh };
}
