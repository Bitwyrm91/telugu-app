// write/shape.js: the shape grader (SPECS S17 "Grader"). Pure: no DOM, no canvas.
//
//   SHAPE                                  every tuning number, by stage
//   thin(mask, w, h) -> Uint8Array         Zhang-Suen thinning (1 = centre-line cell)
//   edt(mask, w, h) -> Float32Array        exact distance (in cells) from each cell to the nearest set cell
//   prepareTarget({mask, w, h, carrier}) -> target   centre-line, distance fields, cached by glyph.js
//   gradeShape(target, strokes, stage, over) -> result
//   skeletonPaths(target) -> [[x, y], ...][]   centre-line as polylines in box units (tests, demo ink)
//
// Box: 1000 x 1000 units; the masks are G x G cells over it. Strokes are arrays of [x, y] in box units.
// result: {ok, q, stars, R, P, L, C, s, missing: [[x,y]...][] (glyph space), extra: [[x,y]...][] (ink
// space), hint, region, why: [failed rule names], map(p) (ink -> glyph space)}

export const BOX = 1000;

export const SHAPE = {
  grid: 128,
  sample: 8,              // ink is sampled every 8 units
  spur: 2,                // centre-line end cells pruned (font stroke ends, noise)
  sMin: 0.55, sMax: 1.8,  // normalise: allowed uniform scale
  sSteps: [0.9, 1, 1.1], dSteps: [-40, 0, 40],
  lenMin: 0.45, lenMax: 2.4,
  missMax: 80, extraMax: 110,
  carrierPad: 40,
  minInk: 30,
  rivalK: 0.85, rivalD: 2,   // a look-alike wins when its fit cost < own cost x 0.85 - 2
  // look-alike difference regions (diffRegions): a part only the target has must be written (own share
  // reached >= diffOwn) and a part only the rival has must not (its share reached <= diffOther); regions
  // shorter than diffMin units are not judged; diffPad: how far from the other glyph's centre-line a cell
  // must be; a cell is written when the ink passes within diffNear x its distance to the other glyph
  diff: true, diffPad: 40, diffMin: 4, diffNear: 0.5, diffOwn: 0.35, diffOther: 0.65,
  weights: [0.35, 0.35, 0.3],
  stars: [85, 70],
  stages: {   // tolR: centre-line reached; tolP: ink near the glyph; tolM: tighter, for naming missing parts
    trace:  { tolR: 70, tolP: 55, tolM: 55, Rmin: 0.85, Pmin: 0.85, norm: false },
    fade:   { tolR: 70, tolP: 55, tolM: 55, Rmin: 0.85, Pmin: 0.85, norm: false },
    copy:   { tolR: 70, tolP: 60, tolM: 55, Rmin: 0.85, Pmin: 0.85, norm: true },
    recall: { tolR: 70, tolP: 60, tolM: 55, Rmin: 0.85, Pmin: 0.85, norm: true },
  },
};

// ---- thinning -------------------------------------------------------------------------------------

export function thin(mask, w, h) {
  const m = Uint8Array.from(mask, v => (v ? 1 : 0));
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  let changed = true;
  const del = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(y * w + x);
      }
      if (del.length) { changed = true; for (const i of del) m[i] = 0; }
    }
  }
  return m;
}

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function degree(m, w, h, x, y) {
  let d = 0;
  for (const [dx, dy] of N8) {
    const X = x + dx, Y = y + dy;
    if (X >= 0 && Y >= 0 && X < w && Y < h && m[Y * w + X]) d++;
  }
  return d;
}

function prune(m, w, h, n) {
  for (let k = 0; k < n; k++) {
    const ends = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (m[y * w + x] && degree(m, w, h, x, y) === 1) ends.push(y * w + x);
    for (const i of ends) m[i] = 0;
  }
  return m;
}

// ---- exact distance transform (Felzenszwalb and Huttenlocher) ------------------------------------

const INF = 1e12;
function dt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

export function edt(mask, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = g[i] >= INF / 2 ? 1e6 : Math.sqrt(g[i]);
  return out;
}

// ---- target -----------------------------------------------------------------------------------------

// A small separate part of the glyph (a dot, a short inner mark) thins to a few cells that pruning
// removes; those marks are what tell some look-alikes apart (ra / ttha, tha / dha), so every mask part
// left with no centre-line gets back its unpruned centre-line (or its middle cell).
function keepSmallParts(mask, th, sk, w, h) {
  const seen = new Uint8Array(w * h);
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!mask[i0] || seen[i0]) continue;
    const comp = [i0], stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of N8) {
        const X = x + dx, Y = y + dy, j = Y * w + X;
        if (X >= 0 && Y >= 0 && X < w && Y < h && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); comp.push(j); }
      }
    }
    if (comp.length < 4 || comp.some(i => sk[i])) continue;
    const thinned = comp.filter(i => th[i]);
    if (thinned.length) { for (const i of thinned) sk[i] = 1; continue; }
    let sx = 0, sy = 0;
    for (const i of comp) { sx += i % w; sy += (i / w) | 0; }
    const cx = sx / comp.length, cy = sy / comp.length;
    let bi = comp[0], bd = Infinity;
    for (const i of comp) { const d = (i % w - cx) ** 2 + (((i / w) | 0) - cy) ** 2; if (d < bd) { bd = d; bi = i; } }
    sk[bi] = 1;
  }
}

export function prepareTarget({ mask, w, h, carrier = null }) {
  const cell = BOX / w;
  const th = thin(mask, w, h);
  const sk = prune(Uint8Array.from(th), w, h, SHAPE.spur);
  keepSmallParts(mask, th, sk, w, h);
  const dtM = edt(mask, w, h), dtK = edt(sk, w, h);
  const dtC = carrier ? edt(carrier, w, h) : null;
  const skel = [];                 // graded centre-line cells
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!sk[i]) continue;
    if (dtC && dtC[i] * cell <= SHAPE.carrierPad) continue;
    skel.push(i);
    const X = (x + 0.5) * cell, Y = (y + 0.5) * cell;
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  // centre-line length: half the summed links between neighbouring graded cells
  const graded = new Uint8Array(w * h);
  for (const i of skel) graded[i] = 1;
  let len = 0;
  for (const i of skel) {
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of N8) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h && graded[Y * w + X]) len += Math.hypot(dx, dy) * cell / 2;
    }
  }
  len = Math.max(len, skel.length * cell * 0.9);
  const skelPts = skel.map(i => [((i % w) + 0.5) * cell, (((i / w) | 0) + 0.5) * cell]);
  return {
    w, h, cell, mask, sk, graded, skel, skelPts, dtM, dtK, len,
    bbox: skel.length ? [x0, y0, x1, y1] : [0, 0, BOX, BOX],
    hasCarrier: !!carrier,
  };
}

// ---- helpers ----------------------------------------------------------------------------------------

const look = (t, field, p) => {
  const x = Math.floor(p[0] / t.cell), y = Math.floor(p[1] / t.cell);
  const X = Math.max(0, Math.min(t.w - 1, x)), Y = Math.max(0, Math.min(t.h - 1, y));
  const out = Math.hypot(x - X, y - Y);   // beyond the grid: add the distance to it
  return (field[Y * t.w + X] + out) * t.cell;
};

export function sampleStrokes(strokes, step = SHAPE.sample) {
  const runs = [];
  let len = 0;
  for (const st of strokes) {
    if (!st || !st.length) continue;
    const run = [st[0]];
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      len += d;
      const n = Math.floor(d / step);
      for (let k = 1; k <= n; k++) run.push([a[0] + (b[0] - a[0]) * k / (n + 1), a[1] + (b[1] - a[1]) * k / (n + 1)]);
      run.push(b);
    }
    runs.push(run);
  }
  return { runs, len };
}

function inkField(runs, w, h, cell) {
  const m = new Uint8Array(w * h);
  for (const r of runs) for (const p of r) {
    const x = Math.floor(p[0] / cell), y = Math.floor(p[1] / cell);
    if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1;
  }
  return edt(m, w, h);
}

const REGIONS = [['top left', 'top', 'top right'], ['left', 'middle', 'right'], ['bottom left', 'bottom', 'bottom right']];
export function regionName(p, bbox) {
  const [x0, y0, x1, y1] = bbox;
  const fx = (p[0] - x0) / Math.max(1, x1 - x0), fy = (p[1] - y0) / Math.max(1, y1 - y0);
  const c = fx < 1 / 3 ? 0 : fx > 2 / 3 ? 2 : 1, r = fy < 1 / 3 ? 0 : fy > 2 / 3 ? 2 : 1;
  return REGIONS[r][c];
}

const centroid = pts => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);

// ---- alignment ------------------------------------------------------------------------------------
// Symmetric chamfer cost (centre-line to ink, ink to centre-line, each capped). Without normalising the
// transform is the identity; with it, a coarse grid around the bbox fit picks a start and a pattern search
// over shift and uniform scale refines it. Returns {c: {s, ci, cg, d}, cost}.
const CAP = 120;
export function align(t, pts, dtI, norm, S = SHAPE) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const [gx0, gy0, gx1, gy1] = t.bbox;
  const ci = [(x0 + x1) / 2, (y0 + y1) / 2], cg = [(gx0 + gx1) / 2, (gy0 + gy1) / 2];
  const cands = [];
  if (norm) {
    const s0 = Math.max(S.sMin, Math.min(S.sMax, ((gx1 - gx0) + (gy1 - gy0)) / Math.max(1, (x1 - x0) + (y1 - y0))));
    for (const k of S.sSteps) for (const dx of S.dSteps) for (const dy of S.dSteps)
      cands.push({ s: Math.max(S.sMin, Math.min(S.sMax, s0 * k)), ci, cg, d: [dx, dy] });
  } else {
    cands.push({ s: 1, ci: [0, 0], cg: [0, 0], d: [0, 0] });
  }
  const skelPts = t.skelPts;
  const cost = c => {
    let a = 0, b = 0;
    for (const q of skelPts) {
      const x = c.ci[0] + (q[0] - c.cg[0] - c.d[0]) / c.s, y = c.ci[1] + (q[1] - c.cg[1] - c.d[1]) / c.s;
      a += Math.min(CAP, look(t, dtI, [x, y]) * c.s);
    }
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      b += Math.min(CAP, look(t, t.dtK, [c.cg[0] + c.s * (p[0] - c.ci[0]) + c.d[0], c.cg[1] + c.s * (p[1] - c.ci[1]) + c.d[1]]));
    }
    return a / skelPts.length + b / Math.ceil(pts.length / 2);
  };
  let bc = cands[0], bcost = cost(bc);
  for (const c of cands.slice(1)) { const k = cost(c); if (k < bcost) { bc = c; bcost = k; } }
  if (norm) {
    for (const [ds, ks] of [[24, 1.06], [12, 1.03], [6, 1.015]]) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const [dx, dy, ks2] of [[ds, 0, 1], [-ds, 0, 1], [0, ds, 1], [0, -ds, 1], [0, 0, ks], [0, 0, 1 / ks]]) {
          const c = { ...bc, s: Math.max(S.sMin, Math.min(S.sMax, bc.s * ks2)), d: [bc.d[0] + dx, bc.d[1] + dy] };
          if (Math.abs(c.d[0]) > 150 || Math.abs(c.d[1]) > 150) continue;
          const k = cost(c);
          if (k < bcost - 1e-6) { bc = c; bcost = k; moved = true; }
        }
      }
    }
  }
  return { c: bc, cost: bcost };
}

// ---- look-alike difference regions ------------------------------------------------------------------
// The rival is shifted onto the target (best chamfer fit of its centre-line on the target's, whole
// cells, no scaling). own: target centre-line cells farther than diffPad from the rival's centre-line;
// other: the rival's centre-line cells farther than diffPad from the target's, in target space. Centre-
// lines, not filled shapes: the marks that tell look-alikes apart sit inside the thick font strokes.
// Cached per pair.
const diffCache = new WeakMap();
export function diffRegions(t, r, S = SHAPE) {
  let m = diffCache.get(t);
  if (!m) { m = new WeakMap(); diffCache.set(t, m); }
  if (m.has(r)) return m.get(r);
  const cell = t.cell, R = Math.round(150 / cell);
  let best = null;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let c = 0;
    for (const p of r.skelPts) c += Math.min(CAP, look(t, t.dtK, [p[0] + dx * cell, p[1] + dy * cell]));
    for (const p of t.skelPts) c += Math.min(CAP, look(r, r.dtK, [p[0] - dx * cell, p[1] - dy * cell]));
    if (!best || c < best.c) best = { c, dx, dy };
  }
  const own = [], other = [];
  t.skel.forEach((i, k) => {
    const p = t.skelPts[k];
    const d = look(r, r.dtK, [p[0] - best.dx * cell, p[1] - best.dy * cell]);
    if (d > S.diffPad) own.push({ p, d });
  });
  for (const p of r.skelPts) {
    const q = [p[0] + best.dx * cell, p[1] + best.dy * cell];
    const d = look(t, t.dtK, q);
    if (d > S.diffPad) other.push({ p: q, d });
  }
  const out = { own, other, shift: [best.dx * cell, best.dy * cell] };
  m.set(r, out);
  return out;
}

// ---- the grade ------------------------------------------------------------------------------------

export function gradeShape(t, strokes, stage = 'copy', over = {}) {
  const S = { ...SHAPE, ...over };
  const st = { ...SHAPE.stages[stage], ...(over.stage || {}) };
  const { runs, len } = sampleStrokes(strokes, S.sample);
  const pts = runs.flat();
  const fail = (hint, why) => ({ ok: false, q: 0, stars: 0, R: 0, P: 0, L: 0, C: 0, s: 1, missing: [], extra: [], hint, region: null, why, map: p => p });
  if (!t.skel.length) return fail('Nothing to grade.', ['target']);
  if (!pts.length || len < S.minInk && pts.length < 2) return fail('Write the letter in the box.', ['empty']);

  const dtI = inkField(runs, t.w, t.h, t.cell);
  const norm = st.norm && !t.hasCarrier;
  const { c: bc, cost: bcost } = align(t, pts, dtI, norm, S);
  const fwd = c => p => [c.cg[0] + c.s * (p[0] - c.ci[0]) + c.d[0], c.cg[1] + c.s * (p[1] - c.ci[1]) + c.d[1]];
  const inv = c => q => [c.ci[0] + (q[0] - c.cg[0] - c.d[0]) / c.s, c.ci[1] + (q[1] - c.cg[1] - c.d[1]) / c.s];
  const cellPt = i => [((i % t.w) + 0.5) * t.cell, (((i / t.w) | 0) + 0.5) * t.cell];
  const skelPts = t.skelPts;

  const measure = c => {
    const F = fwd(c), I = inv(c);
    const dq = skelPts.map(q => look(t, dtI, I(q)) * c.s);
    const hit = dq.map(d => d <= st.tolR);
    const inside = pts.map(p => look(t, t.dtM, F(p)) <= st.tolP);
    const R = hit.filter(Boolean).length / hit.length;
    const P = inside.filter(Boolean).length / inside.length;
    return { c, dq, hit, inside, R, P, F: R + P ? 2 * R * P / (R + P) : 0 };
  };
  // a look-alike letter that fits the ink clearly better than the target: the learner wrote that one
  let rival = null;
  for (const r of over.rivals || []) {
    if (!r || !r.skel.length || r === t) continue;
    const rc = align(r, pts, dtI, st.norm && !r.hasCarrier, S).cost;
    if (rc < bcost * S.rivalK - S.rivalD && (!rival || rc < rival.cost)) rival = { t: r, cost: rc };
  }
  const best = measure(bc);
  const { c, R, P } = best;
  const tolM = st.tolM ?? st.tolR;   // missing parts: a tighter tolerance than recall
  const hit = best.dq.map(d => d <= tolM);
  const F = fwd(c);
  // look-alikes, by the regions where the two glyphs differ
  if (S.diff && !rival) {
    const I = inv(c);
    for (const r of over.rivals || []) {
      if (!r || !r.skel.length || r === t) continue;
      const d = diffRegions(t, r, S);
      // a cell counts as written when the ink passes nearer to it than half its distance to the other glyph
      const near = o => look(t, dtI, I(o.p)) * c.s < o.d * S.diffNear;
      const ownBad = d.own.length * t.cell >= S.diffMin && d.own.filter(near).length / d.own.length < S.diffOwn;
      const otherBad = d.other.length * t.cell >= S.diffMin && d.other.filter(near).length / d.other.length > S.diffOther;
      if (ownBad || otherBad) { rival = { t: r, cost: null, own: ownBad, other: otherBad }; break; }
    }
  }

  // missing runs: 8-connected centre-line cells not reached
  const miss = new Uint8Array(t.w * t.h);
  t.skel.forEach((i, k) => { if (!hit[k]) miss[i] = 1; });
  const missing = [];
  const seen = new Uint8Array(t.w * t.h);
  for (const i0 of t.skel) {
    if (!miss[i0] || seen[i0]) continue;
    const comp = [], stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % t.w, y = (i / t.w) | 0;
      for (const [dx, dy] of N8) {
        const X = x + dx, Y = y + dy, j = Y * t.w + X;
        if (X >= 0 && Y >= 0 && X < t.w && Y < t.h && miss[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    missing.push(comp.map(cellPt));
  }
  missing.sort((a, b) => b.length - a.length);
  const missLen = missing.length ? missing[0].length * t.cell : 0;

  // extra runs: consecutive ink samples outside the glyph (+ tolP)
  const extra = [];
  let k = 0;
  for (const r of runs) {
    let cur = [];
    for (const p of r) {
      if (!best.inside[k++]) cur.push(p);
      else if (cur.length) { extra.push(cur); cur = []; }
    }
    if (cur.length) extra.push(cur);
  }
  extra.sort((a, b) => b.length - a.length);
  const extraLen = extra.length ? (extra[0].length - 1) * S.sample : 0;

  const L = len * c.s / t.len;
  let Cs = 0;
  for (const p of pts) Cs += Math.min(look(t, t.dtK, F(p)), st.tolR);
  const C = 1 - Cs / pts.length / st.tolR;
  const [wR, wP, wC] = S.weights;
  const q = Math.round(100 * Math.max(0, Math.min(1, wR * R + wP * P + wC * C)));

  const why = [];
  if (R < st.Rmin) why.push('recall');
  if (P < st.Pmin) why.push('precision');
  if (L < S.lenMin) why.push('short');
  if (L > S.lenMax) why.push('long');
  if (missLen > S.missMax) why.push('missing');
  if (extraLen > S.extraMax) why.push('extra');
  if (rival) why.push('rival');
  const ok = !why.length;

  let hint = null, region = null;
  if (!ok) {
    if (why.length === 1 && rival) hint = `That looks like ${rival.t.text}. Look at the model again.`;
    else if (why.includes('long') && !why.includes('recall')) hint = 'Too much ink: write each line once.';
    else if ((why.includes('recall') || why.includes('missing') || why.includes('short')) && missing.length) {
      region = regionName(centroid(missing[0]), t.bbox);
      hint = `A part is missing: ${region}.`;
    } else if (extra.length) {
      region = regionName(centroid(extra[0].map(F)), t.bbox);
      hint = `Extra ink: ${region}.`;
    } else hint = 'Not quite. Look at the model and try again.';
  }
  const stars = ok ? (q >= S.stars[0] ? 3 : q >= S.stars[1] ? 2 : 1) : 0;
  return {
    ok, q, stars, R, P, L, C, s: c.s, why, hint, region, rival: rival ? rival.t.text : null,
    missing: missing.filter(m => m.length * t.cell >= 30),
    extra: extra.filter(e => (e.length - 1) * S.sample >= 30),
    map: F,
  };
}

// ---- centre-line as polylines (synthetic ink for tests) ------------------------------------------

export function skeletonPaths(t) {
  const { w, h, cell } = t;
  const left = Uint8Array.from(t.graded);
  const nb = i => {
    const x = i % w, y = (i / w) | 0, out = [];
    for (const [dx, dy] of N8) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h && left[Y * w + X]) out.push(Y * w + X);
    }
    return out;
  };
  const paths = [];
  const order = [...t.skel].sort((a, b) => nb(a).length - nb(b).length);   // endpoints first
  for (const s of order) {
    if (!left[s]) continue;
    const path = [s];
    left[s] = 0;
    let cur = s, prev = null;
    for (;;) {
      const n = nb(cur);
      if (!n.length) break;
      // prefer straight on
      let next = n[0];
      if (prev !== null && n.length > 1) {
        const dx0 = (cur % w) - (prev % w), dy0 = ((cur / w) | 0) - ((prev / w) | 0);
        let bestDot = -Infinity;
        for (const j of n) {
          const dot = ((j % w) - (cur % w)) * dx0 + (((j / w) | 0) - ((cur / w) | 0)) * dy0;
          if (dot > bestDot) { bestDot = dot; next = j; }
        }
      }
      left[next] = 0; path.push(next); prev = cur; cur = next;
    }
    const pts = path.map(i => [((i % w) + 0.5) * cell, (((i / w) | 0) + 0.5) * cell]);
    if (pts.length >= 2) paths.push(pts);
    else paths.push([[pts[0][0] - 8, pts[0][1]], [pts[0][0] + 8, pts[0][1]]]);   // a dot: a short dab
  }
  return paths;
}
