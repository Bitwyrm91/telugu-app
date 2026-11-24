// write/stroke.js: the per-stroke check of SPECS S16 (R1, revisions 1-5), moved out of ui/draw.js
// unchanged (S17). ui/draw.js re-exports everything here, so older imports keep working.

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
    // S17: near the end (within slack) counts as the end, so a run-on is tail even if the cursor stopped
    // a few points short of the last one
    if (c === n - 1 || LE - cum[c] <= Math.min(k.slack, 0.1 * LE)) {
      c = n - 1;
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

/** S17: does the learner's line fit a later part of the stroke (it began past the dot)? The nearest stroke
 *  point beyond `allow` to the first learner point starts a sub-stroke; its fit must be good. On a stroke
 *  that crosses itself the plain start test can find the dot near a crossing and miss this. */
function startsLater(E, P, k, allow) {
  const cum = cumulative(E);
  let bi = -1, bd = Infinity;
  for (let i = 0; i < E.length; i++) {
    if (cum[i] <= allow) continue;
    const d = dist(P[0], E[i]);
    if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0 || bd > k.tol || E.length - bi < 4) return false;
  if (dist(P[P.length - 1], E[E.length - 1]) > k.tol) return false;   // it must have gone on to the end
  const f = evaluate(E.slice(bi), P, { ...k, allow: 0 });
  return f.acquired && f.C >= 0.6 && f.F >= 0.7;
}

/** Tuned constants (R1, coordinator decision 2026-11-16). A stroke is "short" when LE < shortLE. */
export const TUNING = { shortLE: 400, tolShortMin: 105, allowMin: 40, allowShortMin: 90, Rk: 300, FminFree: 0.78, smallD: 300, CminShort: 0.65, alignTrace: 100, alignFree: 100, alignShort: 0.5, alignMinR: 0.7, alignF: 0.9, alignAllowShort: 50, alignCShort: 0.9, radLo: 0.6, radHi: 1.6, innerMax: 0.1, endRad: 0.5,
  tailK: 0.08, tailLo: 90, tailHi: 120, tailClosed: 0.2,
  // S17 (37 letters): a tiny stroke
  // (under tinyLE) has its upper length limit measured against at least Rfloor units, so finger wobble on a
  // 120-unit upright is not "too long".
  tinyLE: 200, Rfloor: 250,
  // S17 relaxed class: strokes where a strictness case (a squiggle, an overshoot, ink pulled onto another
  // part of a self-crossing stroke, a second stroke drawn over this one, wobble 60 on a small ring) cannot be
  // told from a good stroke by this check. There the check is guidance only and the writing stage is passed
  // by the shape grader. tests/e15/test_e15_check.py computes this list and asserts it is exactly this one.
  relaxed: ['cha#1', 'da#1', 'ee#1', 'i#1', 'sign-ai#1', 'sign-ii#1', 'sign-ri#1', 'ta#1', 'u#2', 'uu#3', 'uu#4'] };

/** S17: is stroke `index` (0-based) of letter `id` in the relaxed class (check = guidance only)? */
export function isRelaxed(id, index) {
  return TUNING.relaxed.includes(`${id}#${index + 1}`);
}

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
  const allow = clampN((K.allowK ?? 0.12) * LE, short ? K.allowShortMin : K.allowMin, 220);
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
  const Rok = R >= Rlo && LP <= Rhi * Math.max(LE, LE < K.tinyLE ? K.Rfloor : 0);
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
    if (startBad(f) || (f.C < Cmin && startsLater(E, P, k, allow))) hint = HINTS.start;
    else if (f.tail > tailMax && f.e <= allow && f.C >= Cmin && f.Fh >= Fmin) hint = HINTS.stop;
    // revision 5: a whole stroke whose moved line reaches both ends is out of place, not too short
    else if (movedOk && fwdA.acquired && fwdA.s <= allow && fwdA.e <= allow) hint = HINTS.close;
    else if (f.F >= Fmin && R <= 1.7 && (f.e > allow || (R >= 0.35 && !closed))) hint = HINTS.end;
    else hint = HINTS.close;
  }   // a small ring or scribble is not "nearly there"
  return { ok: false, hint, ignored: false, detail };
}
