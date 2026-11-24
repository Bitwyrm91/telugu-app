// write/pad.js: the ink pad (SPECS S17 "Feel", S18 "Pad").
//
//   mountPad(root, {text, carrier, modelAlpha, guides, label, layout, cellMarks, onPenDown, onPenUp}) -> pad
//     text        the target text (placement and the model layer)
//     carrier     the carrier glyph of a sign (drawn as grey pre-ink, always)
//     modelAlpha  opacity of the model glyph (0 = none); pad.setModel(a) changes it
//     layout      a word box (write/word.js wordLayout): {w, h, base, head, mid, cells: [{text, x, size, x0, x1}]}
//                 default: one letter in a 1000 x 1000 box at placement(text)
//   pad.strokes() -> [[x, y], ...][] in box units · pad.timed() -> [{pts, t}] (t: ms from the stroke's start)
//   pad.undo() · pad.clear() · pad.inkLength() · pad.count()
//   pad.mark(res) draws a failed grade: the model, missing parts in the "wrong" colour, extra ink circled,
//     res.cell (a word's cell index) tinted; pad.unmark()
//   pad.compare(fits | null) draws the model over the ink, aligned as the grader aligned it
//     fits: [{text, size, x, base, s, ox, oy}]: the text at its own placement, then p -> [ox + s x, oy + s y]
//   pad.setHint([x, y] | null) a start ring · pad.replay(model?) -> Promise (the learner's strokes, timed)
//   pad.destroy()
//   Test hook on the element: el.__pad = {add(strokes), pl, layout} draws strokes without a pointer.
//
// Drawing: the guides, model and marks live on an offscreen layer that is rebuilt only when they change;
// committed ink is kept on a second offscreen layer; a pointer move appends only the new segments of the
// live stroke to that layer, and the screen is one copy of it plus the predicted tail.
// Pointers: the first pointer to move owns the stroke; a second moving pointer cancels it; once a pen has
// been seen, touch pointers are ignored (palm). A pen that hovers (no buttons down) never draws.

import { BOX } from './shape.js';
import { placement, FAMILY } from './glyph.js';

export const BASE_W = 44;
const OWN_MOVE = 6;      // box units before a pointer owns the stroke
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fontStr = size => `${size}px "${FAMILY}"`;

function cssVar(el, name, fb) {
  try { return getComputedStyle(el).getPropertyValue(name).trim() || fb; } catch { return fb; }
}
function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The default layout: one letter in the 1000 box. */
export function letterLayout(text) {
  const pl = placement(text || 'అ');
  return { w: BOX, h: BOX, base: pl.base, head: pl.head, mid: pl.mid, pl,
    cells: [{ text: pl.text, x: pl.x, size: pl.size, x0: 0, x1: BOX }] };
}

/** Draws one ink stroke (quadratic curves through midpoints, each piece its own width) from piece i0. */
function inkPieces(ctx, k, pts, ws, from = 1, to = pts.length - 1) {
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0][0] * k, pts[0][1] * k, (ws[0] * k) / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  for (let i = Math.max(1, from); i <= to; i++) {
    const prev = i === 1 ? pts[0] : [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
    const mid = i < pts.length - 1 ? [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2] : pts[i];
    ctx.beginPath();
    ctx.lineWidth = ws[i] * k;
    ctx.moveTo(prev[0] * k, prev[1] * k);
    ctx.quadraticCurveTo(pts[i][0] * k, pts[i][1] * k, mid[0] * k, mid[1] * k);
    ctx.stroke();
  }
}
function inkStyle(ctx, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}

export function mountPad(root, opts = {}) {
  const el = document.createElement('div');
  el.className = 'wpad';
  el.setAttribute('data-pad', '');
  const L = opts.layout || letterLayout(opts.text);
  const W = L.w, H = L.h;
  if (W !== H) { el.style.aspectRatio = `${W} / ${H}`; el.dataset.wide = ''; }
  const cv = document.createElement('canvas');
  cv.className = 'wpad-canvas';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', opts.label || 'Writing box');
  el.append(cv);
  root.append(el);
  const ctx = cv.getContext('2d');
  const bg = document.createElement('canvas'), bgx = bg.getContext('2d');      // guides, model, marks
  const ink = document.createElement('canvas'), inkx = ink.getContext('2d');   // bg + committed ink + live

  let modelAlpha = opts.modelAlpha || 0;
  let strokes = [];        // [{pts: [[x,y]...], w: [..], t: [..]}]
  let live = null;         // the stroke being drawn {id, pts, w, t, owned, moved, drawn}
  let tail = [];           // predicted points (display only)
  let marks = null;        // {res}
  let fits = null;         // compare overlay
  let hint = null;         // start ring [x, y]
  let penSeen = false;
  let bgDirty = true, inkDirty = true, raf = 0, alive = true, replaying = null;
  let k = 1, dpr = 1, cssW = 0;
  let C = null;

  function colors() {
    C = {
      ink: cssVar(el, '--ink', '#1F1A17'), line: cssVar(el, '--line', '#DDD2C1'), border: cssVar(el, '--border', '#8C7F70'),
      wrong: cssVar(el, '--wrong', '#A8231C'), wrongBg: cssVar(el, '--wrong-bg', 'rgba(168,35,28,0.08)'),
      primary: cssVar(el, '--primary', '#0B6B63'), carrier: cssVar(el, '--ink-2', '#574C44'),
    };
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    const s = Math.max(1, Math.round(r.width));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const pw = Math.round(s * dpr), ph = Math.round((s * H / W) * dpr);
    if (s === cssW && cv.width === pw && cv.height === ph) return;
    cssW = s;
    for (const c of [cv, bg, ink]) { c.width = pw; c.height = ph; }
    k = pw / W;
    bgDirty = true; inkDirty = true; schedule();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(cv); else window.addEventListener('resize', resize);
  // the theme can change under an open pad: new colours on the next paint
  const mq = (() => { try { return window.matchMedia('(prefers-color-scheme: dark)'); } catch { return null; } })();
  const onScheme = () => { C = null; bgDirty = true; inkDirty = true; schedule(); };
  if (mq && mq.addEventListener) mq.addEventListener('change', onScheme);

  function schedule() { if (!raf && alive) raf = requestAnimationFrame(paint); }

  function drawModel(c, alpha, color) {
    c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    for (const cell of L.cells) { c.font = fontStr(cell.size * k); c.fillText(cell.text, cell.x * k, L.base * k); }
    c.restore();
  }

  function paintBg() {
    const c = bgx;
    c.clearRect(0, 0, bg.width, bg.height);
    if (marks && marks.res && Number.isInteger(marks.res.cell) && L.cells[marks.res.cell]) {
      const cell = L.cells[marks.res.cell];
      c.save(); c.fillStyle = C.wrongBg; c.globalAlpha = 0.9;
      c.fillRect(cell.x0 * k, 0, (cell.x1 - cell.x0) * k, H * k); c.restore();
    }
    if (opts.guides !== false) {
      c.save();
      c.strokeStyle = C.line; c.lineWidth = Math.max(1, 3 * k);
      const ln = (y, dash) => { c.setLineDash(dash.map(d => d * k)); c.beginPath(); c.moveTo(40 * k, y * k); c.lineTo((W - 40) * k, y * k); c.stroke(); };
      ln(L.head, [24, 18]); ln(L.mid, [4, 22]);
      c.strokeStyle = C.border; ln(L.base, []);
      c.restore();
    }
    if (opts.cellMarks && L.cells.length > 1) {   // one faint marker per akshara: a dotted divider between cells
      c.save(); c.strokeStyle = C.line; c.lineWidth = Math.max(1, 3 * k); c.setLineDash([6 * k, 16 * k]);
      for (const cell of L.cells.slice(1)) {
        c.beginPath(); c.moveTo(cell.x0 * k, (L.head - 140) * k); c.lineTo(cell.x0 * k, (L.base + 140) * k); c.stroke();
      }
      c.restore();
    }
    if (opts.carrier) {
      c.save(); c.globalAlpha = 0.45; c.fillStyle = C.carrier; c.font = fontStr(L.cells[0].size * k);
      c.fillText(opts.carrier, L.cells[0].x * k, L.base * k); c.restore();
    }
    const showModel = marks ? Math.max(modelAlpha, 0.3) : modelAlpha;
    if (showModel > 0 && !fits) drawModel(c, showModel, C.ink);
    if (marks && marks.res) {
      c.save();
      c.strokeStyle = C.wrong; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 26 * k;
      for (const run of marks.res.missing || []) {
        c.beginPath();
        run.forEach((p, i) => (i ? c.lineTo(p[0] * k, p[1] * k) : c.moveTo(p[0] * k, p[1] * k)));
        if (run.length === 1) c.lineTo(run[0][0] * k + 0.1, run[0][1] * k);
        c.stroke();
      }
      c.restore();
    }
    if (hint && !marks) {
      c.save();
      c.strokeStyle = C.primary; c.fillStyle = C.primary; c.lineWidth = 8 * k;
      c.beginPath(); c.arc(hint[0] * k, hint[1] * k, 34 * k, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(hint[0] * k, hint[1] * k, 11 * k, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    bgDirty = false;
  }

  function overlays(c) {
    if (fits) {
      c.save(); c.globalAlpha = 0.45; c.fillStyle = C.primary; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
      for (const f of fits) {
        c.setTransform(k * f.s, 0, 0, k * f.s, k * f.ox, k * f.oy);
        c.font = fontStr(f.size); c.fillText(f.text, f.x, f.base);
      }
      c.restore();
    }
    if (marks && marks.res) {
      c.save();
      c.strokeStyle = C.wrong; c.lineWidth = 6 * k; c.setLineDash([16 * k, 10 * k]);
      for (const run of marks.res.extra || []) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of run) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const rx = (x1 - x0) / 2 + 40, ry = (y1 - y0) / 2 + 40;
        c.beginPath(); c.ellipse(cx * k, cy * k, rx * k, ry * k, 0, 0, Math.PI * 2); c.stroke();
      }
      c.restore();
    }
  }

  // the committed layer: bg, every stroke, the overlays; then the live stroke so far
  function paintInk() {
    inkx.clearRect(0, 0, ink.width, ink.height);
    inkx.drawImage(bg, 0, 0);
    inkStyle(inkx, marks || fits ? C.carrier : C.ink);
    for (const s of strokes) inkPieces(inkx, k, s.pts, s.w);
    overlays(inkx);
    if (live && live.owned) live.drawn = 0;
    inkDirty = false;
  }

  function paint() {
    raf = 0;
    if (!alive || replaying) return;
    if (!C) colors();
    if (bgDirty) { paintBg(); inkDirty = true; }
    if (inkDirty) paintInk();
    // the live stroke: only the pieces not yet on the ink layer (the last piece waits for the next point)
    if (live && live.owned && !cancelled) {
      inkStyle(inkx, C.ink);
      const n = live.pts.length;
      if (n === 1 && !live.drawn) { inkPieces(inkx, k, live.pts, live.w); live.drawn = 0; }
      else if (n - 2 > live.drawn) { inkPieces(inkx, k, live.pts, live.w, live.drawn + 1, n - 2); live.drawn = n - 2; }
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(ink, 0, 0);
    if (live && live.owned && !cancelled && live.pts.length > 1) {
      // the last piece and the predicted tail: screen only
      const n = live.pts.length;
      const from = [(live.pts[n - 2][0] + live.pts[n - 1][0]) / 2, (live.pts[n - 2][1] + live.pts[n - 1][1]) / 2];
      const lw = live.w[n - 1];
      inkStyle(ctx, C.ink);
      ctx.lineWidth = lw * k;
      ctx.beginPath(); ctx.moveTo(from[0] * k, from[1] * k); ctx.lineTo(live.pts[n - 1][0] * k, live.pts[n - 1][1] * k); ctx.stroke();
      if (tail.length) {
        ctx.save(); ctx.globalAlpha = 0.35;
        inkPieces(ctx, k, [live.pts[n - 1], ...tail], [lw, ...tail.map(() => lw)]);
        ctx.restore();
      }
    }
  }

  const toBox = e => {
    const r = cv.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * W, 0, W), clamp(((e.clientY - r.top) / r.height) * H, 0, H)];
  };
  function widthFor(e, p, q, dt) {
    if (e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5) return BASE_W * clamp(0.55 + 0.7 * e.pressure, 0.6, 1.15);
    const v = q ? dist(p, q) / Math.max(1, dt) : 0;   // units per ms
    return BASE_W * clamp(1.15 - 0.22 * v, 0.6, 1.15);
  }

  const ptrs = new Map();
  let cancelled = false;
  function onDown(e) {
    if (replaying) return;
    if (opts.disabled && opts.disabled()) return;
    if (e.button !== undefined && e.button > 0) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (penSeen && e.pointerType === 'touch') return;   // palm on the screen while a pen writes
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!ptrs.size) cancelled = false;
    const p = toBox(e);
    ptrs.set(e.pointerId, { id: e.pointerId, pts: [p], w: [widthFor(e, p, null, 0)], t: [0], t0: e.timeStamp, tl: e.timeStamp,
      moved: 0, owned: false, drawn: 0 });
    if (typeof opts.onPenDown === 'function') opts.onPenDown();
    if (!live && ptrs.size === 1) { live = ptrs.get(e.pointerId); live.owned = true; live.drawn = 0; schedule(); }
  }
  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;   // hover (pen or mouse with nothing down) never draws
    if (e.pointerType === 'pen' && e.buttons === 0) return;
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const q = toBox(ev);
      const last = p.pts[p.pts.length - 1];
      const d = dist(last, q);
      if (d < 1.5) continue;
      p.moved += d;
      const wRaw = widthFor(ev, q, last, ev.timeStamp - p.tl);
      p.tl = ev.timeStamp;
      p.w.push(p.w[p.w.length - 1] * 0.7 + wRaw * 0.3);
      p.pts.push(q);
      p.t.push(Math.max(0, ev.timeStamp - p.t0));
    }
    if (live && live.id !== e.pointerId && p.moved > OWN_MOVE * 3) {
      // a second pointer moving: a pinch or a palm, not a stroke
      cancelled = true; live = null; tail = []; inkDirty = true;
    }
    if (cancelled) { schedule(); return; }
    const pr = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
    tail = live && live.id === e.pointerId ? pr.slice(0, 3).map(toBox) : [];
    schedule();
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (!live || live.id !== e.pointerId) return;
    const d = live;
    live = null; tail = [];
    if (e.type === 'pointercancel' || cancelled) { inkDirty = true; schedule(); return; }
    strokes.push({ pts: d.pts, w: d.w, t: d.t });
    // finish the stroke on the ink layer: its last piece (or all of it if the layer was rebuilt meanwhile)
    if (!inkDirty && !bgDirty && C) { inkStyle(inkx, C.ink); inkPieces(inkx, k, d.pts, d.w, d.drawn + 1); }
    else inkDirty = true;
    schedule();
    if (typeof opts.onPenUp === 'function') opts.onPenUp();
  }
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  const noTouch = e => e.preventDefault();
  cv.addEventListener('touchstart', noTouch, { passive: false });

  const redrawAll = () => { bgDirty = true; schedule(); };
  const setFits = f => { fits = f && f.length ? f : null; el.toggleAttribute('data-compare', !!fits); };

  // ---- replay: the learner's own strokes, at their speed, over the model's demo when given ----
  function replay(model = null) {
    if (!strokes.length || replaying) return Promise.resolve(false);
    if (!C) colors();
    if (bgDirty) paintBg();
    const reduce = reducedMotion();
    const GAP = 600, PEN = 0.6;   // ms cap between strokes; model demo speed in units per ms
    // a timeline: [{pts, w, t: [abs ms], color, alpha}]
    const tl = [];
    let at = 0;
    for (const s of strokes) {
      const ts = s.t && s.t.length === s.pts.length ? s.t : s.pts.map((p, i) => (i ? null : 0));
      if (ts.includes(null)) {   // test ink: no times; a steady hand speed
        let acc = 0;
        for (let i = 0; i < s.pts.length; i++) { if (i) acc += dist(s.pts[i - 1], s.pts[i]) / PEN; ts[i] = acc; }
      }
      const dur = reduce ? 0 : ts[ts.length - 1];
      tl.push({ pts: s.pts, w: s.w, t: ts.map(x => at + (reduce ? 0 : x)), color: C.ink, alpha: 1 });
      at += dur + (reduce ? 400 : Math.min(GAP, 250));
    }
    const mine = at;
    if (model && model.length) {
      let mt = 0;
      for (const pts of model) {
        let acc = 0;
        const ts = pts.map((p, i) => { if (i) acc += dist(pts[i - 1], p) / PEN; return mt + (reduce ? 0 : acc); });
        tl.push({ pts, w: pts.map(() => BASE_W * 0.9), t: ts, color: C.primary, alpha: 0.4, model: true });
        mt += (reduce ? 400 : acc + 250);
      }
      at = Math.max(mine, mt);
    }
    el.dataset.replay = 'on';
    return new Promise(resolve => {
      const t0 = performance.now();
      replaying = { resolve };
      const step = now => {
        if (!alive || !replaying) { resolve(false); return; }
        const tt = now - t0;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(bg, 0, 0);
        for (const s of tl) {
          let n = 0;
          while (n < s.pts.length && s.t[n] <= tt) n++;
          if (!n) continue;
          ctx.save(); ctx.globalAlpha = s.alpha; inkStyle(ctx, s.color);
          inkPieces(ctx, k, s.pts.slice(0, n), s.w.slice(0, n));
          ctx.restore();
        }
        if (tt < at + 200) requestAnimationFrame(step);
        else { replaying = null; delete el.dataset.replay; inkDirty = true; schedule(); resolve(true); }
      };
      requestAnimationFrame(step);
    });
  }

  const pad = {
    el,
    layout: L,
    strokes: () => strokes.map(s => s.pts.map(p => [p[0], p[1]])),
    timed: () => strokes.map(s => ({ pts: s.pts.map(p => [p[0], p[1]]), t: (s.t || []).slice() })),
    inkLength: () => strokes.reduce((a, s) => a + s.pts.reduce((b, p, i) => b + (i ? dist(s.pts[i - 1], p) : 0), 0), 0),
    count: () => strokes.length,
    undo() { strokes.pop(); marks = null; setFits(null); redrawAll(); },
    clear() { strokes = []; marks = null; setFits(null); redrawAll(); },
    setModel(a) { if (a !== modelAlpha) { modelAlpha = a; redrawAll(); } },
    setHint(p) { const same = JSON.stringify(p || null) === JSON.stringify(hint); if (!same) { hint = p || null; el.toggleAttribute('data-hint', !!hint); redrawAll(); } },
    mark(res) { marks = { res }; redrawAll(); },
    unmark() { if (marks || fits) { marks = null; setFits(null); redrawAll(); } },
    marked: () => !!marks,
    compare(f) { setFits(f); redrawAll(); },
    comparing: () => !!fits,
    replay,
    stopReplay() { if (replaying) { const r = replaying; replaying = null; delete el.dataset.replay; inkDirty = true; schedule(); r.resolve(false); } },
    redraw() { C = null; redrawAll(); },
    destroy() {
      alive = false; cancelAnimationFrame(raf); replaying = null;
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onScheme);
    },
  };
  el.__pad = {
    add(list) {
      for (const pts of list) {
        if (opts.disabled && opts.disabled()) return;
        if (typeof opts.onPenDown === 'function') opts.onPenDown();
        const P = pts.map(p => [clamp(p[0], 0, W), clamp(p[1], 0, H)]);
        strokes.push({ pts: P, w: P.map(() => BASE_W), t: null });
        inkDirty = true; schedule();
        if (typeof opts.onPenUp === 'function') opts.onPenUp();
      }
    },
    pl: L.pl || null,
    layout: L,
    // measurement hook: how long the pointer handlers take (S18 performance check)
    handlers: { onDown, onMove, onUp },
  };
  requestAnimationFrame(resize);
  resize();
  return pad;
}
