// write/word.js: writing whole words (SPECS S18 "Words").
//
//   wordUnits(te) -> [akshara]                      aksharas.split, spaces and punctuation dropped
//   wordLayout(te) -> layout                        the wide box: {w, h, base, head, mid, k, cells: [{text, x, size, x0, x1}]}
//   fitsWide(n, boxPx) -> bool                      every cell at least MIN_CELL_PX wide and n <= MAX_CELLS
//   assignInk(strokes, layout) -> [[stroke]] per cell   centroid rule, cell-spanning strokes cut at the edge
//   toLetter(layout, i, pl) / fromLetter(...)       word box <-> akshara i's own letter box
//   gradeWord(layout, strokes, stage, {targets?, letters?, over?}) -> Promise<{ok, q, stars, cells: [res], bad, ...}>
//   wordWords(units, letters, progress, writingItems) -> [{id: 'W:<item id>', item, units, unlocked}]
//
// Pure apart from the font measures (canvas) and getTarget.

import { split } from '../aksharas.js';
import { gradeShape } from './shape.js';
import { getTarget, placement, FAMILY } from './glyph.js';
import { syllableRivals } from './rivals.js';

export const CW = 600, WH = 1000;
const SIZE = 820, MARGIN = 40;   // WH: the most a word box can be tall
export const MIN_CELL_PX = 64, MAX_CELL_PX = 260, MAX_CELLS = 5, MAX_UNITS = 6;
const SPAN = 0.12;        // a stroke reaching this far (x CW) past a cell edge on both sides is cut there
const MIN_PIECE = 30;     // shorter cut pieces join the piece before them

const TELUGU = /[ఀ-౿]/;
export function wordUnits(te) {
  return split(String(te || '').replace(/[\s.,?!'"‍]+/g, '')).filter(u => TELUGU.test(u));
}

let mctx = null;
function measure(text) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `${SIZE}px "${FAMILY}"`;
  const m = mctx.measureText(text);
  return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent };
}

/**
 * The wide box for a word (or one akshara list). Same guide lines as a letter at the word's scale.
 * The box is only as tall as the writing needs: room above the head line for the tallest vowel sign
 * (or the word's own tallest akshara) and room below the base line for a subscript (vattu), with the
 * writing zone between them, so there is no dead band at the top.
 */
const ROOM_UP = ['కి', 'కీ', 'కో', 'ఖ', 'ఈ'], ROOM_DOWN = ['స్క', 'క్ర', 'క్ష'];
export function wordLayout(te) {
  const us = Array.isArray(te) ? te : wordUnits(te);
  const ms = us.map(measure);
  const headA = measure('ం').a;
  const maxW = Math.max(1, ...ms.map(m => m.l + m.r));
  const upA = Math.max(1, ...ms.map(m => m.a), ...ROOM_UP.map(x => measure(x).a));
  const downD = Math.max(0, ...ms.map(m => m.d), ...ROOM_DOWN.map(x => measure(x).d));
  const k = Math.min(1, (CW - 60) / maxW, (WH - 2 * MARGIN) / (upA + downD));
  const base = MARGIN + upA * k;
  const h = Math.ceil(base + downD * k + MARGIN);
  const head = base - headA * k;
  const cells = us.map((text, i) => ({
    text, size: SIZE * k, x0: i * CW, x1: (i + 1) * CW,
    x: i * CW + CW / 2 - ((ms[i].r - ms[i].l) * k) / 2,
  }));
  cells.forEach((c, i) => { c.g0 = c.x - ms[i].l * k; c.g1 = c.x + ms[i].r * k; });   // the glyph's own extent
  return { w: Math.max(1, us.length) * CW, h, base, head, mid: (head + base) / 2, k, cells, units: us };
}

export function fitsWide(n, boxPx) {
  return n >= 1 && n <= MAX_CELLS && boxPx / n >= MIN_CELL_PX;
}

// ---- ink to cells -----------------------------------------------------------------------------------

const centroidX = pts => pts.reduce((a, p) => a + p[0], 0) / Math.max(1, pts.length);
const lenOf = pts => pts.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const cellOf = (x, L) => Math.max(0, Math.min(L.cells.length - 1, Math.floor(x / CW)));

/** Cuts a stroke at the cell edges it clearly crosses (past SPAN x CW on both sides of an edge). */
export function cutStroke(pts, L) {
  if (pts.length < 2) return [pts];
  const xs = pts.map(p => p[0]);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const edges = [];
  for (let e = 1; e < L.cells.length; e++) {
    const x = e * CW;
    if (lo < x - SPAN * CW && hi > x + SPAN * CW) edges.push(x);
  }
  if (!edges.length) return [pts];
  const zone = x => edges.filter(e => x >= e).length;   // which side of the cut edges
  const pieces = [];
  let cur = [pts[0]], z = zone(pts[0][0]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], zp = zone(p[0]);
    if (zp !== z) {
      // the crossing point on the edge between the two zones goes in both pieces
      const e = edges[Math.min(z, zp)];
      const a = pts[i - 1], f = (e - a[0]) / ((p[0] - a[0]) || 1e-9);
      const q = [e, a[1] + (p[1] - a[1]) * Math.max(0, Math.min(1, f))];
      cur.push(q); pieces.push(cur); cur = [q]; z = zp;
    }
    cur.push(p);
  }
  pieces.push(cur);
  // tiny pieces (a flick over the edge) join the piece before them
  const out = [];
  for (const pc of pieces) {
    if (out.length && lenOf(pc) < MIN_PIECE) out[out.length - 1] = out[out.length - 1].concat(pc.slice(1));
    else out.push(pc);
  }
  if (out.length > 1 && lenOf(out[0]) < MIN_PIECE) { const f = out.shift(); out[0] = f.concat(out[0].slice(1)); }
  return out;
}

const GUTTER = 40;        // a cut piece's joining line is trimmed where it runs this far outside its glyph

/** Trims the joining line at a cut end: the points outside the cell's glyph (plus GUTTER) at that end. */
function trimJoin(pc, c, atStart, atEnd) {
  if (c.g0 == null) return pc;
  const out = (p) => p[0] < c.g0 - GUTTER || p[0] > c.g1 + GUTTER;
  let a = 0, b = pc.length;
  if (atStart) while (a < b - 2 && out(pc[a])) a += 1;
  if (atEnd) while (b > a + 2 && out(pc[b - 1])) b -= 1;
  return pc.slice(a, b);
}

/** Ink per cell: each stroke (or cut piece) to the cell its centroid falls in; a cut piece loses the part of
 *  the joining line that lies between the glyphs. */
export function assignInk(strokes, L) {
  const per = L.cells.map(() => []);
  for (const s of strokes) {
    if (!s || !s.length) continue;
    const pcs = cutStroke(s, L);
    pcs.forEach((pc, j) => {
      const i = cellOf(centroidX(pc), L);
      const t = pcs.length > 1 ? trimJoin(pc, L.cells[i], j > 0, j < pcs.length - 1) : pc;
      per[cellOf(centroidX(t), L)].push(t);
    });
  }
  return per;
}

// ---- frames: word box <-> akshara i's letter box ---------------------------------------------------

/** {a, ox, oy}: letter point = [ox + a x, oy + a y] for a word-box point. */
export function letterMap(L, i, pl) {
  const cell = L.cells[i];
  const a = pl.size / cell.size;
  return { a, ox: pl.x - cell.x * a, oy: pl.base - L.base * a };
}
const apply = m => p => [m.ox + m.a * p[0], m.oy + m.a * p[1]];
const unapply = m => q => [(q[0] - m.ox) / m.a, (q[1] - m.oy) / m.a];

/** The grader's ink -> target map is p -> off + s p; its inverse composed with the cell map gives the
 *  pad transform that draws the model over the ink (pad.compare fits). */
export function fitFor(res, pl, m = { a: 1, ox: 0, oy: 0 }) {
  if (!res || typeof res.map !== 'function') return null;
  const off = res.map([0, 0]);
  const s = res.s || 1;
  // pad point w: letter q = F(apply(m)(w)) = off + s (m.o + m.a w)  =>  w = (q - off - s m.o) / (s m.a)
  const S = 1 / (s * m.a);
  return { text: pl.text, size: pl.size, x: pl.x, base: pl.base, s: S, ox: -(off[0] + s * m.ox) * S, oy: -(off[1] + s * m.oy) * S };
}

// ---- grading -----------------------------------------------------------------------------------------

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export const ordinal = i => ORD[i] || `${i + 1}th`;

// Word leniency (measured in checks/write/accuracy.html): each cell is graded by the letter grader with
// these overrides, since every cell of a word must pass and small misses add up over 3-5 aksharas.
// Defaults chosen in checks/write/accuracy.txt (rough-hand false reject 24/45 -> 5/45 with no substituted,
// look-alike-swapped or subscript-dropped akshara newly accepted):
//   over: the rival check needs a clearer win in a word cell (rough small cells drifted toward look-alikes)
//   borderline: a failing cell still passes (1 star, flagged) when its only faults are a missing run / extra
//   ink / recall, it scores q >= 85 with R >= 0.8, its longest missing run is <= missMax, every other cell
//   scores >= 70, and at most one cell (two in words of 4+ aksharas) is borderline. A look-alike (rival) or
//   empty cell is never borderline.
export const WORD = {
  over: { rivalK: 0.75, diffOwn: 0.25, diffOther: 0.75 },
  borderline: { why: ['missing', 'extra', 'recall'], Rmin: 0.8, q: 85, missMax: 360, others: 70, twoFrom: 4 },
};

/** The borderline rule (WORD.borderline) on graded cells: marks the near-miss cells ok, 1 star, borderline. */
export function applyBorderline(cells, BL) {
  if (!BL || cells.length < 2) return cells;
  const fails = cells.filter(c => !c.ok);
  const near = c => {
    const ml = c.missing && c.missing[0] ? c.missing[0].length * (c.tcell || 1) : 0;
    return c.why.length > 0 && c.why.every(w => BL.why.includes(w)) && c.R >= BL.Rmin && c.q >= BL.q && ml <= BL.missMax;
  };
  if (fails.length && fails.length <= (cells.length >= BL.twoFrom ? 2 : 1) && fails.every(near)
    && cells.every(x => fails.includes(x) || x.q >= BL.others)) {
    for (const c of fails) Object.assign(c, { ok: true, stars: 1, borderline: true });
  }
  return cells;
}

export async function gradeWord(L, strokes, stage = 'copy', opts = {}) {
  const o = opts.over || WORD.over;
  const per = assignInk(strokes, L);
  const cells = [];
  for (let i = 0; i < L.cells.length; i++) {
    const text = L.cells[i].text;
    const t = opts.targets && opts.targets[i] ? opts.targets[i] : await getTarget(text);
    const pl = t.pl || placement(text);
    const m = letterMap(L, i, pl);
    const F = apply(m), B = unapply(m);
    const ink = per[i].map(s => s.map(F));
    // look-alikes of this akshara (its first letter or a vowel sign swapped): the rival check of the letters
    const rivals = [];
    if (ink.length) for (const x of syllableRivals(text, opts.letters || [])) { try { rivals.push(await getTarget(x)); } catch { /* skip */ } }
    const r = ink.length ? gradeShape(t, ink, stage, { ...o, rivals })
      : { ok: false, q: 0, stars: 0, R: 0, P: 0, L: 0, C: 0, s: 1, why: ['empty'], hint: 'Its box is empty: write it in the shaded box.', missing: [], extra: [], map: p => p };
    // marks in the word box: missing centre-line runs (target frame: undo the grader's normalise, then the
    // cell map) and extra ink (letter frame) mapped back
    const off = r.map([0, 0]), s = r.s || 1;
    const invF = q => [(q[0] - off[0]) / s, (q[1] - off[1]) / s];
    const missingW = (r.missing || []).map(run => run.map(q => B(invF(q))));
    const extraW = (r.extra || []).map(run => run.map(B));
    // an empty cell gets no red "missing" marks (a whole letter in red reads as written ink): the cell is
    // tinted and its model is shown plainly, at the cell's own place
    cells.push({ ...r, i, text, ink, inkW: per[i], m, pl, missingW, extraW, tcell: t.cell || 1,
      fit: fitFor(ink.length ? r : { map: p => p, s: 1 }, pl, m) });
  }
  applyBorderline(cells, opts.borderline !== undefined ? opts.borderline : WORD.borderline);
  const bad = cells.findIndex(c => !c.ok);
  const ok = bad < 0 && cells.length > 0;
  const q = cells.length ? Math.round(cells.reduce((a, c) => a + c.q, 0) / cells.length) : 0;
  const stars = ok ? Math.min(...cells.map(c => c.stars || 1)) : 0;
  const b = bad >= 0 ? cells[bad] : null;
  return {
    ok, q, stars, cells, bad: ok ? -1 : bad, borderline: cells.some(c => c.borderline),
    R: avg(cells, 'R'), P: avg(cells, 'P'), L: avg(cells, 'L'), C: avg(cells, 'C'),
    why: b ? b.why : [], hint: b ? b.hint : null,
    // for pad.mark: the failed cell's marks, in the word box
    missing: b ? b.missingW : [], extra: b ? b.extraW : [], cell: b ? b.i : null,
  };
}
const avg = (cs, k) => (cs.length ? cs.reduce((a, c) => a + (c[k] || 0), 0) / cs.length : 0);

// ---- which words ---------------------------------------------------------------------------------------

/**
 * Words met in finished lessons: unit items of kind 'word' with 2..MAX_UNITS aksharas, in lesson order.
 * Unlocked when every `needs` id that is a letter in letters.json is at writing stage >= 3.
 * units: loaded unit JSON objects; done: Set of finished lesson ids; stageOf(id) -> 0..4.
 */
export function wordList(units, letterIds, done, stageOf) {
  const out = [];
  const seen = new Set();
  for (const u of units || []) {
    if (!u) continue;
    const byId = new Map((u.items || []).map(it => [it.id, it]));
    for (const ls of u.lessons || []) {
      if (!done.has(ls.id)) continue;
      for (const id of ls.items || []) {
        const it = byId.get(id);
        if (!it || it.kind !== 'word' || seen.has(id) || !it.te) continue;
        const us = wordUnits(it.te);
        if (us.length < 2 || us.length > MAX_UNITS) continue;
        seen.add(id);
        const needs = [...new Set((it.units || []).flatMap(x => x.needs || []))].filter(n => letterIds.has(n));
        if (!needs.length) continue;
        out.push({ id: 'W:' + id, item: it, units: us, needs, unlocked: needs.every(n => stageOf(n) >= 3) });
      }
    }
  }
  return out;
}
