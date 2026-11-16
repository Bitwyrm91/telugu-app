// ui/draw.js: letter drawing (task D3; SPECS S16 "D3", "Stroke check").
//
//   mountDraw(root, letterId, {onDone, onTraced, data, letter, inLesson, waitVisible}) -> {ready, destroy()}
//     waitVisible  the watch starts only once the box is 60 % on screen (Letters card, R5)
//     root      the element the panel goes in (its children are replaced)
//     onDone    "Done" was pressed (on the Letters card it closes the panel; in a lesson it continues)
//     onTraced  stage 2 (trace) is complete: every stroke passed once
//     data      the parsed strokes.json (else it is loaded through content.js)
//     letter    the letter object (else found in letters.json)
//     inLesson  true in the `letter_draw` step: no in-panel "Done" (the step has Continue / "Can't draw now")
//     ready     Promise<boolean>: false when the letter has no stroke data (nothing is shown)
//
// Three stages: watch (pen dot draws each stroke), trace (outline + dashed guide, every stroke
// checked), free (no outline or guide; a failed stroke shows its guide until it passes), then done.
// Test hooks on [data-draw]: data-stage = watch | trace | free | done, data-stroke = index of the
// current stroke, data-fails = fails on the current stroke, data-traced when stage 2 is complete,
// data-replays = pen-dot replays (after every second fail), data-busy while the pen dot is drawing,
// data-watched once the watch has played through, data-waiting until the box is seen (waitVisible);
// class is-drawable while a stroke can be drawn, is-finished when a stage's last stroke passed.
//
// The pure check (checkStroke, R1: start, tracking, coverage, hint choice) is exported for unit tests.

import * as content from '../content.js';
import { h, ensureStyles, confidenceLabel } from '../ex/common.js';
import { teNode } from './te.js';
import { strokeEntryOk } from '../exgen.js';

// ---- the stroke check (pure) ------------------------------------------------------------------

export const BOX = 1000;
export const N_POINTS = 48;
export const MIN_LEN = 60;     // R1/R8: shorter ink is a stray tap, not a try
export const HINTS = {
  start: 'Start at the dot.',
  end: 'Keep going to the end of the line.',
  other: 'Go the other way.',
  close: 'Stay closer to the line.',
  stop: 'Stop at the end of the line.',
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** n points evenly spaced along the polyline (by arc length). */
export function resample(pts, n = N_POINTS) {
  if (!pts.length) return [];
  const L = pathLength(pts);
  if (L === 0 || pts.length === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const step = L / (n - 1);
  const out = [[pts[0][0], pts[0][1]]];
  let i = 1, prev = pts[0], acc = 0;
  for (let k = 1; k < n - 1; k++) {
    const want = k * step;
    while (i < pts.length) {
      const d = dist(prev, pts[i]);
      if (acc + d >= want) {
        const t = d ? (want - acc) / d : 0;
        out.push([prev[0] + (pts[i][0] - prev[0]) * t, prev[1] + (pts[i][1] - prev[1]) * t]);
        break;
      }
      acc += d; prev = pts[i]; i++;
    }
    if (out.length <= k) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToPolyline(p, line) {
  if (line.length === 1) return dist(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1], line[i]));
  return best;
}

// ---- stroke check, version 2 (SPECS S16 revision 1, R1) -------------------------------------------

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Points kept at least `step` apart along the drawing (the last point always kept): the
 *  "25-unit resample" the learner's length is measured on, so hand jitter does not count. */
export function decimate(pts, step) {
  if (!pts.length) return [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (dist(out[out.length - 1], pts[i]) >= step) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out.length === 1 || out[out.length - 1] !== last) out.push(last);
  return out;
}

const cumulative = pts => {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
};

/** One evaluation of learner points P against expected points E (R1 steps 4 to 7). */
function evaluate(E, P, k) {
  const n = E.length, m = P.length;
  const cum = cumulative(E);
  const LE = cum[n - 1];
  // 4. start: the nearest E point to P[0] within the first allow + slack of path
  let start = -1, best = Infinity;
  for (let i = 0; i < n && cum[i] <= k.allow + k.slack; i++) {
    const d = dist(P[0], E[i]);
    if (d < best) { best = d; start = i; }
  }
  const acquired = best <= (k.startTol ?? k.tol);
  const covered = new Uint8Array(n);
  let onTrack = 0;
  // 5. tracking (without an acquired start the cursor begins at 0: the numbers are only for hints)
  let c = acquired ? start : 0;
  // tail: learner ink after the end of the line was reached and away from it; head: the points before that
  let travelled = 0, tail = 0, head = 0, onHead = 0;
  const endR = k.endR ?? 1.5 * k.tol;
  for (let j = 0; j < m; j++) {
    if (j > 0) travelled += dist(P[j - 1], P[j]);
    if (c === n - 1) {
      const de = dist(P[j], E[n - 1]);
      if (de <= 1.5 * k.tol) { onTrack++; travelled = 0; covered[n - 1] = 1; }
      if (j > 0 && de > endR) tail += dist(P[j - 1], P[j]);
      continue;
    }
    head++;
    const ahead = 150 + 1.5 * travelled;
    let bi = c, bd = Infinity;
    for (let i = c; i < n && cum[i] - cum[c] <= ahead; i++) {
      const d = dist(P[j], E[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bd <= k.tol) {
      onTrack++; onHead++;
      if (cum[bi] - cum[c] <= 150) for (let i = c; i <= bi; i++) covered[i] = 1;
      else covered[bi] = 1;
      c = bi;
      travelled = 0;
    }
  }
  // 6. the ends: points within slack of an end, near the first / last learner point
  for (let i = 0; i < n && cum[i] <= k.slack && dist(P[0], E[i]) <= k.slack; i++) covered[i] = 1;
  for (let i = n - 1; i >= 0 && LE - cum[i] <= k.slack && dist(P[m - 1], E[i]) <= k.slack; i--) covered[i] = 1;
  // 7. measures
  let first = -1, last = -1, count = 0;
  for (let i = 0; i < n; i++) if (covered[i]) { count++; if (first < 0) first = i; last = i; }
  const s = first < 0 ? LE : cum[first];
  const e = last < 0 ? LE : LE - cum[last];
  return { acquired, s, e, C: count / n, F: onTrack / m, tail, Fh: head ? onHead / head : 1 };
}

/** Tuned constants (R1, coordinator decision 2026-11-16). A stroke is "short" when LE < shortLE. */
export const TUNING = { shortLE: 400, tolShortMin: 105, allowMin: 40, allowShortMin: 90, Rk: 300, FminFree: 0.78, smallD: 300, CminShort: 0.65, alignTrace: 100, alignFree: 100, alignShort: 0.5, alignMinR: 0.7, alignF: 0.9, alignAllowShort: 50, alignCShort: 0.9, radLo: 0.6, radHi: 1.6, innerMax: 0.1, endRad: 0.5,
  tailK: 0.08, tailLo: 90, tailHi: 120, tailClosed: 0.2 };

/**
 * The stroke check (R1). expected and learner are box-unit point lists; stage 'trace' | 'free'.
 * -> {ok, hint, ignored, detail}; ignored (a stray tap, under MIN_LEN) is neither pass nor fail.
 */
export function checkStroke(expected, learner, stage = 'trace', over = {}) {   // over: test-only parameter overrides
  const free = stage === 'free';
  // 1. clamp to the box; the learner's length on a 25-unit resample
  const L = (Array.isArray(learner) ? learner : []).filter(p => p && isFinite(p[0]) && isFinite(p[1]))
    .map(p => [clampN(+p[0], 0, BOX), clampN(+p[1], 0, BOX)]);
  const Ld = decimate(L, 25);
  const LP = pathLength(Ld);
  if (L.length < 2 || LP < MIN_LEN) return { ok: false, hint: null, ignored: true, detail: { LP } };
  // 2. resampling
  const LE = pathLength(expected);
  const n = clampN(Math.round(LE / 10), 16, 300);
  const m = clampN(Math.round(LP / 10), 16, 300);
  const E = resample(expected, n);
  const P = resample(Ld, m);
  // 3. tolerances
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of E) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const D = Math.max(x1 - x0, y1 - y0);
  const K = { ...TUNING, ...over };
  const short = LE < K.shortLE;   // below finger precision: wider floors, more room for wobble
  const small = short || D < K.smallD;   // a small ring (the sunna) gets the wider floor too
  const tol0 = clampN(0.35 * D, small ? K.tolShortMin : 75, Math.max(120, small ? K.tolShortMin : 0));
  const tol = tol0 * (free ? 1.4 : 1);
  const allow = clampN(0.12 * LE, short ? K.allowShortMin : K.allowMin, 220);
  const k = { tol, startTol: Math.min(tol0, 120), allow, slack: 0.5 * tol, endR: tol0 };
  const Cmin = short ? K.CminShort : free ? 0.70 : 0.75, Fmin = free ? K.FminFree : 0.80;
  const Rlo = 0.6, Rhi = Math.min(3.0, 1.7 + K.Rk / (LE || 1));
  // revision 3: placement. The learner's line is moved towards the expected one (centre to centre) by at most
  // align units, so a well-shaped stroke a finger-width to the side is not a fail.
  const mid = pts => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
  const cE = mid(E), cP = mid(P);
  let ax = cE[0] - cP[0], ay = cE[1] - cP[1];
  let cap = free ? K.alignFree : K.alignTrace;
  if (short) cap = Math.min(cap, K.alignShort * LE);   // revision 4: a tick is not moved by more than half its length
  const ad = Math.hypot(ax, ay);
  if (ad > cap) { ax *= cap / ad; ay *= cap / ad; }
  const Pa = P.map(p => [p[0] + ax, p[1] + ay]);
  // revision 3: a closed stroke (a ring) must keep its distance from the centre: no spiral into the middle
  const closed = Math.hypot(E[0][0] - E[n - 1][0], E[0][1] - E[n - 1][1]) <= 80;
  const meanR = pts => { let t = 0; for (const p of pts) t += Math.hypot(p[0] - cE[0], p[1] - cE[1]); return t / pts.length; };
  const rE = meanR(E) || 1;
  const rad = closed ? meanR(Pa) / rE : 1;
  const inner = closed ? Pa.filter(p => Math.hypot(p[0] - cE[0], p[1] - cE[1]) < 0.4 * rE).length / Pa.length : 0;   // share of the line in the middle of the ring
  // revision 4: the last fifth of the line of a ring must still be out on the ring
  const lastN = Pa.slice(Math.floor(Pa.length * 0.8));
  const endRad = closed ? meanR(lastN) / rE : 1;
  // revision 4: ink after the end of the line (a run-on, the next stroke without lifting, a second lap)
  const tailMax = closed ? K.tailClosed * LE : clampN(K.tailK * LE, K.tailLo, K.tailHi);
  const passes = (f, cmin) => f.acquired && f.s <= allow && f.e <= allow && f.C >= cmin && f.F >= Fmin && f.tail <= tailMax;
  const fwd = evaluate(E, P, k);            // as drawn
  // moved into place: may pass instead, but only a whole stroke, at the tracing tolerance and the long-stroke cover
  const kA = { tol: tol0, startTol: k.startTol, allow, slack: 0.5 * tol0, endR: k.endR };
  const fwdA = passes(fwd, Cmin) ? fwd : evaluate(E, Pa, kA);
  const R = LP / (LE || 1);
  const Rok = R >= Rlo && R <= Rhi;
  const radOk = R < Rlo || (rad >= K.radLo && rad <= K.radHi && inner <= K.innerMax && endRad >= K.endRad);   // too short a line fails on R, with its own hint
  const movedOk = R >= K.alignMinR;
  const allowA = short ? K.alignAllowShort : allow, CminA = short ? K.alignCShort : Cmin;
  const moved = movedOk && passes(fwdA, CminA) && fwdA.s <= allowA && fwdA.e <= allowA && fwdA.F >= K.alignF && fwd.tail <= tailMax;
  const ok = (passes(fwd, Cmin) || moved) && Rok && radOk;
  const detail = { ...fwd, R, LP, LE, D, tol, allow, slack: k.slack, Cmin, Fmin, Rhi, short, n, m, closed, rad, inner, endRad, tailMax, align: Math.min(ad, cap), aligned: fwdA };
  if (ok) return { ok: true, hint: null, ignored: false, detail };
  // 9. the hint: the first that applies
  const Er = [...E].reverse(), isRev = r => r.acquired && r.C >= 0.6 && r.F >= 0.7;
  const rev = evaluate(Er, P, k);
  detail.rev = rev;
  let hint;
  if (isRev(rev) || isRev(evaluate(Er, Pa, k))) hint = HINTS.other;
  else if (!radOk) hint = HINTS.close;
  else {
    // a whole stroke in the wrong place whose moved line starts at the dot is not a start problem
    const startBad = f => !f.acquired || f.s > allow;
    const f = startBad(fwd) && movedOk && !startBad(fwdA) ? fwdA : fwd;
    if (startBad(f)) hint = HINTS.start;
    else if (f.tail > tailMax && f.e <= allow && f.C >= Cmin && f.Fh >= Fmin) hint = HINTS.stop;
    // revision 5: a whole stroke whose moved line reaches both ends is out of place, not too short
    else if (movedOk && fwdA.acquired && fwdA.s <= allow && fwdA.e <= allow) hint = HINTS.close;
    else if (f.F >= Fmin && R <= 1.7 && (f.e > allow || (R >= 0.35 && !closed))) hint = HINTS.end;
    else hint = HINTS.close;
  }   // a small ring or scribble is not "nearly there"
  return { ok: false, hint, ignored: false, detail };
}

// ---- styles and small SVG helpers -----------------------------------------------------------------

let styled = false;
export function drawStyles() {
  ensureStyles();
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/draw.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  return n;
}
const ptsAttr = pts => pts.map(p => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`).join(' ');

export const DEFAULT_WIDTH = 56;
export const CHEVRON_STEP = 150;   // R6: one chevron about every 150 units of a finished stroke
export const BADGE = { hw: 26, hh: 34 };   // half size of a number badge (64-unit digit with its halo)

/** The first `frac` of a polyline (by arc length). */
export function cutAt(pts, frac) {
  const L = pathLength(pts) * frac;
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= L) {
      const t = d ? (L - acc) / d : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      return out;
    }
    acc += d; out.push(pts[i]);
  }
  return out;
}

/** R6: where the guide's arrowhead goes; a stroke that ends within 80 units of its start gets it at 88 %. */
export function arrowPath(pts) {
  return dist(pts[0], pts[pts.length - 1]) <= 80 ? cutAt(pts, 0.88) : pts;
}

function arrowHead(pts, size = 56) {
  const n = pts.length;
  const tip = pts[n - 1];
  let j = n - 2;
  while (j > 0 && dist(pts[j], tip) < size * 0.6) j--;
  const from = pts[Math.max(0, j)];
  const L = dist(from, tip) || 1;
  const ux = (tip[0] - from[0]) / L, uy = (tip[1] - from[1]) / L;
  const bx = tip[0] - ux * size, by = tip[1] - uy * size;
  const w = size * 0.55;
  return s('polygon', { class: 'draw-arrow',
    points: ptsAttr([[tip[0] + ux * size * 0.35, tip[1] + uy * size * 0.35], [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]]) });
}

/** R6: positions along a stroke for chevrons, every CHEVRON_STEP units, clear of both ends. */
export function chevronSpots(pts, step = CHEVRON_STEP) {
  const L = pathLength(pts);
  const out = [];
  let acc = 0, i = 1;
  for (let want = step; want < L - 90; want += step) {
    while (i < pts.length && acc + dist(pts[i - 1], pts[i]) < want) { acc += dist(pts[i - 1], pts[i]); i++; }
    if (i >= pts.length) break;
    const a = pts[i - 1], b = pts[i], d = dist(a, b) || 1, t = (want - acc) / d;
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], u: [(b[0] - a[0]) / d, (b[1] - a[1]) / d] });
  }
  return out;
}

function chevrons(pts, W) {
  const g = s('g', { class: 'draw-chevs' });
  const a = Math.max(12, W * 0.28);
  for (const { p, u } of chevronSpots(pts)) {
    const nx = -u[1], ny = u[0];
    const back = [p[0] - u[0] * a, p[1] - u[1] * a];
    g.append(s('polyline', { class: 'draw-chev',
      points: ptsAttr([[back[0] + nx * a, back[1] + ny * a], [p[0] + u[0] * a * 0.4, p[1] + u[1] * a * 0.4], [back[0] - nx * a, back[1] - ny * a]]) }));
  }
  return g;
}

/**
 * R6: number badges outside the glyph. For each stroke, the first position (radius outward, then
 * 8 directions starting behind the stroke's start) whose badge box is inside the box, touches no
 * glyph (`inside(x, y)` is true on the glyph) and no other badge or start dot.
 * -> [{x, y, hair}] (hair: the gap to the dot is over 60 units, so a hairline joins them).
 */
export function placeBadges(strokes, inside, { hw = BADGE.hw, hh = BADGE.hh, dotR = 30 } = {}) {
  const dots = strokes.map(p => p[0]);
  const placed = [];
  const hitsGlyph = (x, y) => {
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      if (inside(x - hw + (2 * hw * i) / 4, y - hh + (2 * hh * j) / 4)) return true;
    }
    return false;
  };
  const rectDot = (x, y, d) => Math.hypot(Math.max(0, Math.abs(d[0] - x) - hw), Math.max(0, Math.abs(d[1] - y) - hh));
  return strokes.map((pts, k) => {
    const p = pts[0];
    const q = pts[Math.min(pts.length - 1, 3)];
    const back = Math.atan2(p[1] - q[1], p[0] - q[0]);
    const dirs = [0, 1, -1, 2, -2, 3, -3, 4].map(i => back + (i * Math.PI) / 4);
    let found = null;
    for (let r = 60; r <= 320 && !found; r += 10) {
      for (const a of dirs) {
        const x = p[0] + Math.cos(a) * r, y = p[1] + Math.sin(a) * r;
        if (x - hw < 8 || x + hw > BOX - 8 || y - hh < 8 || y + hh > BOX - 8) continue;
        if (dots.some(d => rectDot(x, y, d) < dotR + 6)) continue;
        if (placed.some(b => Math.abs(b.x - x) < 2 * hw + 6 && Math.abs(b.y - y) < 2 * hh + 6)) continue;
        if (hitsGlyph(x, y)) continue;
        found = { x, y };
        break;
      }
    }
    if (!found) {
      const x = Math.max(8 + hw, Math.min(BOX - 8 - hw, p[0] + Math.cos(back) * 70));
      const y = Math.max(8 + hh, Math.min(BOX - 8 - hh, p[1] + Math.sin(back) * 70));
      found = { x, y };
    }
    found.hair = rectDot(found.x, found.y, p) - dotR > 60;
    found.k = k;
    placed.push(found);
    return found;
  });
}

/** The glyph test for placeBadges: inside the outline path, or within reach of any stroke's ink. */
function glyphTest(entry, W) {
  const lines = [...entry.strokes, ...(Array.isArray(entry.ghost) ? entry.ghost : [])];
  const near = (x, y) => lines.some(l => distToPolyline([x, y], l) <= W / 2 + 4);
  let path = null, ctx = null;
  try {
    if (entry.outline && typeof Path2D !== 'undefined') {
      path = new Path2D(entry.outline);
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch { path = null; }
  return (x, y) => near(x, y) || !!(path && ctx && ctx.isPointInPath(path, x, y, 'nonzero'));
}

function startDot(p, cls = '') {
  return s('circle', { class: `draw-start ${cls}`.trim(), cx: p[0], cy: p[1], r: 30 });
}

function badge(b, p, num) {
  const g = s('g', { class: 'draw-badge' });
  if (b.hair) {
    const L = dist([b.x, b.y], p) || 1;
    const ux = (b.x - p[0]) / L, uy = (b.y - p[1]) / L;
    g.append(s('line', { class: 'draw-hair', x1: p[0] + ux * 34, y1: p[1] + uy * 34,
      x2: b.x - ux * Math.min(BADGE.hw, BADGE.hh), y2: b.y - uy * Math.min(BADGE.hw, BADGE.hh) }));
  }
  const t = s('text', { class: 'draw-num', x: b.x, y: b.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  t.textContent = String(num);
  g.append(t);
  return g;
}

function inked(pts, cls) {
  const g = s('g', { class: cls });
  g.append(s('polyline', { class: 'draw-edge', points: ptsAttr(pts) }), s('polyline', { class: 'draw-fill', points: ptsAttr(pts) }));
  return g;
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const DIALOG = '.rp-backdrop, dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
/** R5: the animation pauses while the page is hidden or a dialog is open. */
function shouldPause() {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return true;
  return [...document.querySelectorAll(DIALOG)].some(d => !d.hidden && d.getClientRects().length > 0);
}

/** R2/R3: the stroke width and the confidence label from an entry. */
export function entryWidth(entry) {
  const w = entry && Number(entry.width);
  return Number.isFinite(w) && w >= 20 && w <= 200 ? Math.round(w) : DEFAULT_WIDTH;
}
export function confidenceKind(entry) {
  return entry && entry.confidence === 'partner' ? 'native' : 'low';
}

const STAGES = ['watch', 'trace', 'free'];
const PEN_SPEED = 600;   // box units per second
const PAUSE_MS = 350;
const STEP_MS = 600;     // reduced motion: one whole stroke per 600 ms
const FADE_MS = 300;
const OWN_MOVE = 30;     // R4: a pointer owns the stroke once it has travelled this far

let uid = 0;

/** R7: the instruction lines (one row at 360 px). */
export function lines(n, part = false) {
  const strokesWord = `${n} stroke${n === 1 ? '' : 's'}`;
  return {
    watch: part ? `Watch the new part: ${strokesWord}. The grey part is already there.` : `Watch: ${strokesWord}, in this order.`,
    trace: i => `Trace stroke ${i + 1} of ${n}. Start at the dot.`,
    free: i => `Now without the guide: stroke ${i + 1} of ${n}.`,
    traced: "That's it.",
    replay: 'Watch this stroke again.',
  };
}

// ---- the component ---------------------------------------------------------------------------------

export function mountDraw(root, letterId, opts = {}) {
  drawStyles();
  let alive = true;
  let cleanup = () => {};
  const ready = (async () => {
    let data = opts.data;
    if (!data) { try { data = await content.loadStrokes(); } catch { data = null; } }
    const entry = data && data.letters && data.letters[letterId];
    if (!alive || !strokeEntryOk(entry)) return false;
    let letter = opts.letter;
    if (!letter) {
      try { letter = ((await content.loadLetters()).letters || []).find(l => l.id === letterId); } catch { letter = null; }
    }
    if (!alive) return false;
    cleanup = build(root, letterId, entry, letter || { id: letterId }, opts);
    return true;
  })();
  return {
    ready,
    destroy() { alive = false; cleanup(); },
  };
}

function build(root, letterId, entry, letter, opts) {
  const strokes = entry.strokes.map(l => l.map(p => [+p[0], +p[1]]));
  const ghost = Array.isArray(entry.ghost) ? entry.ghost.map(l => l.map(p => [+p[0], +p[1]])) : [];
  const n = strokes.length;
  const W = entryWidth(entry);
  const rom = letter.rom || letterId;
  const isSign = ['sign', 'mark', 'final'].includes(letter.type);
  const part = ghost.length > 0;
  const glyph = isSign ? (letter.say || '') : (letter.glyph || letter.say || '');
  const TXT = lines(n, part);
  let alive = true;
  let stage = 'watch';
  let cur = 0, fails = 0, replays = 0, traced = false, guideOn = false;
  let run = 0;          // bumps to cancel an animation
  let raf = 0;
  let seen = !opts.waitVisible;   // R5: the watch starts once the box is 60 % visible
  const timers = new Set();
  const frame = () => new Promise(res => { raf = requestAnimationFrame(res); });
  // R5: waits and the pen both stop the clock while paused (hidden page, open dialog, not yet seen)
  const paused = () => !seen || shouldPause();
  async function wait(ms, myRun) {
    let left = ms, t = performance.now();
    while (left > 0) {
      await frame();
      if (!alive || myRun !== run) return false;
      const now = performance.now();
      if (!paused()) left -= now - t;
      t = now;
    }
    return true;
  }
  ++uid;

  // ---- DOM ----
  const panel = h('div', { class: 'draw', 'data-draw': '', 'data-letter': letterId, 'data-stage': 'watch',
    'data-stroke': '0', 'data-fails': '0', 'data-replays': '0' });
  panel.style.setProperty('--draw-w', `${W}px`);
  const dots = h('ol', { class: 'draw-dots', 'aria-hidden': 'true' }, STAGES.map(st => h('li', { 'data-for': st })));
  const line = h('p', { class: 'draw-line', tabindex: '-1' });
  const live = h('p', { class: 'visually-hidden draw-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const label = isSign && part ? `How to add this sign: ${n} stroke${n === 1 ? '' : 's'}`
    : `How to write ${rom}: ${n} stroke${n === 1 ? '' : 's'}`;
  const svg = s('svg', { class: 'draw-svg', viewBox: `0 0 ${BOX} ${BOX}`, role: 'img', 'aria-label': label, focusable: 'false' });
  const gBase = s('g', { class: 'draw-base' });
  gBase.append(s('line', { class: 'draw-baseline', x1: 80, x2: BOX - 80, y1: 880, y2: 880 }));
  const outline = s('path', { class: 'draw-outline', d: entry.outline || '', 'fill-rule': 'nonzero' });
  const gGhost = s('g', { class: 'draw-ghost' });
  for (const g of ghost) gGhost.append(inked(g, 'draw-ghost-stroke'));
  const gDone = s('g', { class: 'draw-done' });
  const gGuide = s('g', { class: 'draw-guide' });
  const gAnim = s('g', { class: 'draw-anim' });
  const gInk = s('g', { class: 'draw-ink' });
  svg.append(gBase, outline, gGhost, gDone, gGuide, gAnim, gInk);
  const box = h('div', { class: 'draw-box' }, svg);
  const actions = h('div', { class: 'draw-actions' });
  // R3/R5: one compact block; "partner" -> the app's partner-checked label, anything else Unverified
  const kind = confidenceKind(entry);
  const conf = h('div', { class: 'draw-conf', 'data-confidence': kind }, confidenceLabel(kind),
    kind === 'low' ? h('span', { class: 'draw-conf-text', text: 'Stroke order not yet confirmed by a native writer.' }) : null);
  panel.append(h('div', { class: 'draw-head' }, dots, line), box, actions, conf, live);
  root.replaceChildren(panel);

  const badges = placeBadges(strokes, glyphTest({ ...entry, strokes, ghost }, W));

  // R5: start the watch only when the box is at least 60 % on screen
  let io = null;
  if (!seen) {
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(es => {
        if (es.some(e => e.intersectionRatio >= 0.6)) { seen = true; panel.removeAttribute('data-waiting'); io.disconnect(); io = null; }
      }, { threshold: [0, 0.6, 1] });
      io.observe(box);
      panel.setAttribute('data-waiting', '');
    } else seen = true;
  }

  // ---- state shown ----
  const canDraw = () => (stage === 'trace' && !traced) || stage === 'free';
  function setAttrs() {
    panel.dataset.stage = stage;
    panel.dataset.stroke = String(cur);
    panel.dataset.fails = String(fails);
    panel.dataset.replays = String(replays);
    panel.toggleAttribute('data-traced', traced);
    panel.classList.toggle('is-drawable', canDraw());
    const at = stage === 'done' ? 3 : STAGES.indexOf(stage);
    [...dots.children].forEach((d, i) => {
      d.toggleAttribute('data-on', i === at);
      d.toggleAttribute('data-past', i < at);
    });
  }
  // R7: the live region speaks exactly the visible line
  function say(text, hint = false) {
    // one inline run (the line is a flex box: loose children would each become a block)
    line.replaceChildren(h('span', {}, ...(Array.isArray(text) ? text : [text])));
    line.toggleAttribute('data-hint', hint);
    const spoken = line.textContent;
    live.textContent = '';
    const t = setTimeout(() => { timers.delete(t); if (alive) live.textContent = spoken; }, 30);
    timers.add(t);
  }
  function btn(text, cls, onclick) {
    const b = h('button', { type: 'button', class: `btn ${cls}`, text });
    b.addEventListener('click', onclick);
    return b;
  }
  function focusLine() { try { line.focus({ preventScroll: true }); } catch { /* ignore */ } }
  function setButtons(list) {
    const inPanel = panel.contains(document.activeElement);
    const quiet = !opts.inLesson && !list.some(b => b.classList.contains('draw-done-btn'))
      ? btn('Done', 'btn-quiet draw-close', () => done()) : null;
    actions.replaceChildren(...list, ...(quiet ? [quiet] : []));
    // a focused button that went away: focus stays in the panel, on the line
    if (inPanel && (!document.activeElement || !panel.contains(document.activeElement))) focusLine();
  }
  function done() {
    if (typeof opts.onDone === 'function') opts.onDone();
  }
  function busy(on) { panel.toggleAttribute('data-busy', on); }
  function finished(on) { panel.classList.toggle('is-finished', on); }

  // ---- animation ----
  async function penStroke(pts, myRun, g) {
    const poly = s('polyline', { class: 'draw-pen-line', points: ptsAttr(pts.slice(0, 1)) });
    const pen = s('circle', { class: 'draw-pen', cx: pts[0][0], cy: pts[0][1], r: 26 });
    g.append(poly, pen);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];
    let elapsed = 0, t = performance.now();
    for (;;) {
      await frame();
      if (!alive || myRun !== run) return false;
      const now = performance.now();
      if (!paused()) elapsed += now - t;
      t = now;
      const d = Math.min(total, (elapsed / 1000) * PEN_SPEED);
      let k = 1;
      while (k < pts.length && cum[k] <= d) k++;
      const shown = pts.slice(0, k);
      if (k < pts.length) {
        const seg = cum[k] - cum[k - 1] || 1, f = (d - cum[k - 1]) / seg;
        shown.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]);
      }
      poly.setAttribute('points', ptsAttr(shown));
      const head = shown[shown.length - 1];
      pen.setAttribute('cx', head[0]); pen.setAttribute('cy', head[1]);
      if (d >= total) break;
    }
    pen.remove();
    return true;
  }

  // a whole stroke as the still picture shows it: line, chevrons, arrowhead, start dot on top
  function stillStroke(g, pts) {
    g.append(s('polyline', { class: 'draw-pen-line', points: ptsAttr(pts) }), chevrons(pts, W), arrowHead(arrowPath(pts), Math.max(56, W)));
  }

  async function watch() {
    const myRun = ++run;
    gAnim.replaceChildren();
    panel.removeAttribute('data-watched');
    busy(true);
    const reduce = reducedMotion();
    while (paused()) { await frame(); if (!alive || myRun !== run) return; }
    for (let i = 0; i < n; i++) {
      if (!alive || myRun !== run) return;
      const g = s('g', { class: 'draw-anim-stroke', 'data-i': i });
      gAnim.append(g);
      if (reduce) {
        stillStroke(g, strokes[i]);
        g.append(startDot(strokes[i][0]), badge(badges[i], strokes[i][0], i + 1));
        if (!(await wait(STEP_MS, myRun))) return;
      } else {
        g.append(badge(badges[i], strokes[i][0], i + 1));
        if (!(await penStroke(strokes[i], myRun, g))) return;
        g.replaceChildren();
        stillStroke(g, strokes[i]);
        g.append(startDot(strokes[i][0]), badge(badges[i], strokes[i][0], i + 1));
        if (i < n - 1 && !(await wait(PAUSE_MS, myRun))) return;
      }
    }
    if (alive && myRun === run) { busy(false); panel.setAttribute('data-watched', ''); }
  }

  async function replay(i, then) {
    const myRun = ++run;
    busy(true);
    gAnim.replaceChildren();
    const g = s('g', { class: 'draw-anim-stroke draw-replay' });
    gAnim.append(g);
    if (reducedMotion()) {
      stillStroke(g, strokes[i]);
      if (!(await wait(STEP_MS, myRun))) return;
    } else if (!(await penStroke(strokes[i], myRun, g))) return;
    if (!(await wait(250, myRun))) return;
    gAnim.replaceChildren();
    busy(false);
    if (then) then();
  }

  function stopAnim() {
    run++;
    cancelAnimationFrame(raf);
    gAnim.replaceChildren();
    busy(false);
  }

  // ---- stages ----
  function showGuide() {
    gGuide.replaceChildren();
    if (cur >= n) return;
    const showIt = stage === 'trace' || guideOn;
    if (!showIt) return;
    const pts = strokes[cur];
    gGuide.append(s('polyline', { class: 'draw-guide-line', points: ptsAttr(pts) }), arrowHead(arrowPath(pts), Math.max(56, W * 0.8)),
      startDot(pts[0], 'draw-pulse'));
  }

  function toWatch(fromFree = false) {   // fromFree: the learner has already traced the letter
    stage = 'watch'; cur = 0; fails = 0; traced = fromFree;
    gDone.replaceChildren(); gGuide.replaceChildren(); gInk.replaceChildren();
    panel.classList.remove('is-free');
    finished(false);
    setAttrs();
    say(TXT.watch);
    setButtons([btn('Watch again', 'btn-secondary draw-again-watch', () => { if (stage === 'watch') watch(); }),
      fromFree ? btn('Without the guide', 'btn-main draw-free', () => { toFree(); focusLine(); })   // back where the learner came from
        : btn('My turn', 'btn-main draw-myturn', () => { toTrace(); focusLine(); })]);
    watch();
  }

  // critic 2, finding 10: the animation can be asked for again while drawing
  const rewatch = () => btn('Watch again', 'btn-quiet draw-rewatch', () => { toWatch(traced); focusLine(); });

  function toTrace() {
    stopAnim();
    stage = 'trace'; cur = 0; fails = 0; traced = false;
    gDone.replaceChildren(); gInk.replaceChildren();
    panel.classList.remove('is-free');
    finished(false);
    setAttrs();
    say(TXT.trace(cur));
    showGuide();
    setButtons([rewatch()]);
  }

  function toFree() {
    stopAnim();
    stage = 'free'; cur = 0; fails = 0; guideOn = false;
    gDone.replaceChildren(); gInk.replaceChildren(); gGuide.replaceChildren();
    panel.classList.add('is-free');
    finished(false);
    setAttrs();
    say(TXT.free(cur));
    setButtons([rewatch()]);
  }

  function traceComplete() {
    traced = true;
    gGuide.replaceChildren();
    finished(true);
    setAttrs();
    say(TXT.traced);
    // R8: in a lesson the step's Continue is the one primary; no in-panel Done
    setButtons(opts.inLesson
      ? [btn('Without the guide', 'btn-secondary draw-free', () => { toFree(); focusLine(); }), rewatch()]
      : [btn('Without the guide', 'btn-main draw-free', () => { toFree(); focusLine(); }),
        btn('Done', 'btn-secondary draw-done-btn', () => done())]);
    if (typeof opts.onTraced === 'function') opts.onTraced();
  }

  function freeComplete() {
    stage = 'done';
    gGuide.replaceChildren();
    finished(true);
    setAttrs();
    // finding 14: a sign is added to the grey carrier, not written as a whole syllable
    say(isSign && part ? ['You added the sign: ', teNode(glyph, { class: 'te-md draw-glyph' }), '.']
      : ['You wrote ', teNode(glyph, { class: 'te-md draw-glyph' }), '.']);
    const again = btn('Again', 'btn-secondary draw-again', () => { toFree(); focusLine(); });
    setButtons(opts.inLesson ? [again, rewatch()] : [again, btn('Done', 'btn-main draw-done-btn', () => done())]);
  }

  // ---- drawing (R4: pointers) ----
  // every pointer down on the box is tracked; the first to travel OWN_MOVE owns the stroke; a
  // second one that travels as far cancels the attempt (no fail); still pointers are ignored.
  const ptrs = new Map();   // id -> {pts, moved}
  let owner = null;         // {id, pts, poly}
  let cancelled = false;
  const toBox = e => {
    const r = svg.getBoundingClientRect();
    return [clampN(((e.clientX - r.left) / r.width) * BOX, 0, BOX), clampN(((e.clientY - r.top) / r.height) * BOX, 0, BOX)];
  };

  function onDown(e) {
    if (!canDraw() || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!ptrs.size) cancelled = false;
    ptrs.set(e.pointerId, { pts: [toBox(e)], moved: 0 });
  }
  function startOwn(id, p) {
    if (panel.hasAttribute('data-busy')) stopAnim();
    gInk.querySelectorAll('.draw-fade').forEach(x => x.remove());
    const poly = s('polyline', { class: 'draw-ink-line', points: ptsAttr(p.pts) });
    gInk.append(poly);
    owner = { id, pts: p.pts, poly };
  }
  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const q = toBox(ev);
      p.moved += dist(p.pts[p.pts.length - 1], q);
      p.pts.push(q);
    }
    if (cancelled || p.moved <= OWN_MOVE) { if (owner && owner.id === e.pointerId) owner.poly.setAttribute('points', ptsAttr(p.pts)); return; }
    if (!owner && canDraw()) startOwn(e.pointerId, p);
    else if (owner && owner.id !== e.pointerId) {
      // two pointers drawing: not a try
      cancelled = true;
      owner.poly.remove();
      owner = null;
      return;
    }
    if (owner) owner.poly.setAttribute('points', ptsAttr(p.pts));
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (!owner || owner.id !== e.pointerId) return;
    const d = owner;
    owner = null;
    if (e.type === 'pointercancel' || cancelled) { d.poly.remove(); return; }
    judge(d);
  }

  function judge(d) {
    if (!canDraw()) { d.poly.remove(); return; }
    const res = checkStroke(strokes[cur], d.pts, stage);
    if (res.ignored) { d.poly.remove(); return; }
    if (res.ok) {
      d.poly.remove();
      gDone.append(inked(strokes[cur], 'draw-done-stroke'));
      cur += 1; fails = 0; guideOn = false;
      setAttrs();
      if (cur >= n) { if (stage === 'trace') traceComplete(); else freeComplete(); return; }
      say(stage === 'trace' ? TXT.trace(cur) : TXT.free(cur));
      showGuide();
      return;
    }
    // fail: the ink fades, one hint
    fails += 1;
    setAttrs();
    if (reducedMotion()) d.poly.remove();
    else {
      d.poly.classList.add('draw-fade');
      const t = setTimeout(() => { timers.delete(t); d.poly.remove(); }, FADE_MS);
      timers.add(t);
    }
    if (stage === 'free') { guideOn = true; showGuide(); }
    // R7: after every second fail, in both stages, the pen shows the stroke again (announced)
    if (fails % 2 === 0) {
      replays += 1; setAttrs();
      say(`${res.hint} ${TXT.replay}`, true);
      replay(cur);
    } else say(res.hint, true);
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  // no page scroll or long-press menu while drawing (touch-action: none only while drawable, R4)
  const noTouch = e => { if (canDraw()) e.preventDefault(); };
  svg.addEventListener('touchstart', noTouch, { passive: false });
  svg.addEventListener('contextmenu', e => { if (canDraw()) e.preventDefault(); });

  // test hook: draw a stroke from box points without a pointer
  panel.__draw = {
    judge: pts => { if (canDraw()) judge({ pts: pts.map(p => [clampN(p[0], 0, BOX), clampN(p[1], 0, BOX)]), poly: s('polyline') }); },
    badges,
  };

  toWatch();

  return () => {
    alive = false;
    run++;
    cancelAnimationFrame(raf);
    if (io) { io.disconnect(); io = null; }
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
