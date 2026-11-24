// write/diag.js: writing diagnostics (SPECS S18 "Data stored"). Local only: never exported, never sent.
//
//   log({id, stage, kind, tries, text, ink, scores})   kind 'override' | 'tries' | 'borderline'; keeps the newest CAP
//   entries() -> [entry] · json() -> string (what Settings copies) · CAP
//   compactInk(strokes, map?) -> [[[x, y]...]]          rounded, about one point per 16 units

import * as store from '../store.js';

export const CAP = 50;
export const KEY = 'writingLog';
const STEP = 16;

export function compactInk(strokes, map = p => p) {
  return (strokes || []).map(s => {
    const out = [];
    let last = null;
    for (const p0 of s) {
      const p = map(p0);
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= STEP) { out.push([Math.round(p[0]), Math.round(p[1])]); last = p; }
    }
    const e = s.length ? map(s[s.length - 1]) : null;
    if (e && out.length && (out[out.length - 1][0] !== Math.round(e[0]) || out[out.length - 1][1] !== Math.round(e[1]))) out.push([Math.round(e[0]), Math.round(e[1])]);
    return out;
  }).filter(s => s.length);
}

const r2 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

export function entries() {
  let v = null;
  try { v = store.get(KEY); } catch { v = null; }
  return v && Array.isArray(v.entries) ? v.entries : [];
}

export function log(e) {
  const list = entries();
  const sc = e.scores || {};
  list.push({
    at: new Date().toISOString(), id: e.id, stage: e.stage, kind: e.kind, tries: e.tries || 1, text: e.text || '',
    ink: e.ink || [], scores: { q: sc.q ?? 0, R: r2(sc.R), P: r2(sc.P), L: r2(sc.L), C: r2(sc.C), why: sc.why || [] },
    ...(e.cells ? { cells: e.cells } : {}),
  });
  try { store.set(KEY, { entries: list.slice(-CAP) }); } catch { /* storage banner shows */ }
}

export function json() {
  return JSON.stringify({ app: 'telugu-writing-diagnostics', version: 1, entries: entries() }, null, 1);
}
