// write/pad.js: the ink pad (SPECS S17 "Feel"). One canvas, redrawn on every frame that changed.
//
//   mountPad(root, {text, carrier, modelAlpha, guides, onPenUp, onInk}) -> pad
//     text        the target text (placement and the model layer)
//     carrier     the carrier glyph of a sign (drawn as grey pre-ink, always)
//     modelAlpha  opacity of the model glyph (0 = none); pad.setModel(a) changes it
//   pad.strokes() -> [[x, y], ...][] in box units · pad.undo() · pad.clear() · pad.inkLength()
//   pad.mark(result, target) draws a failed grade: the model, missing parts in the "wrong" colour, extra
//   ink circled; pad.unmark() · pad.destroy()
//   Test hook on the element: el.__pad = {add(strokes)} draws strokes without a pointer (fires onPenUp).
//
// Pointers: the first pointer to move owns the stroke; a second moving pointer cancels it; once a pen has
// been seen, touch pointers are ignored (palm). Coalesced events feed the points; predicted events only
// draw a temporary tail. Width: pen pressure when reported, else speed (fast = thinner).

import { BOX } from './shape.js';
import { placement, drawText } from './glyph.js';

const BASE_W = 44;
const OWN_MOVE = 6;      // box units before a pointer owns the stroke
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function cssVar(el, name, fb) {
  try { return getComputedStyle(el).getPropertyValue(name).trim() || fb; } catch { return fb; }
}

export function mountPad(root, opts = {}) {
  const el = document.createElement('div');
  el.className = 'wpad';
  el.setAttribute('data-pad', '');
  const cv = document.createElement('canvas');
  cv.className = 'wpad-canvas';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', opts.label || 'Writing box');
  el.append(cv);
  root.append(el);
  const ctx = cv.getContext('2d');

  const pl = placement(opts.text || 'అ');
  let modelAlpha = opts.modelAlpha || 0;
  let strokes = [];        // [{pts: [[x,y]...], w: [..]}]
  let live = null;         // the stroke being drawn {id, pts, w, owned, moved}
  let tail = [];           // predicted points (display only)
  let marks = null;        // {res, t}
  let penSeen = false;
  let dirty = true, raf = 0, alive = true;
  let k = 1, dpr = 1, size = 0;

  function resize() {
    const r = cv.getBoundingClientRect();
    const s = Math.max(1, Math.round(r.width));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    if (s === size && cv.width === Math.round(s * dpr)) return;
    size = s;
    cv.width = cv.height = Math.round(s * dpr);
    k = (s * dpr) / BOX;
    dirty = true; schedule();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(cv); else window.addEventListener('resize', resize);

  function schedule() { if (!raf && alive) raf = requestAnimationFrame(paint); }

  function inkPath(pts, ws, color) {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0][0] * k, pts[0][1] * k, (ws[0] * k) / 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // quadratic curves through the midpoints, each piece with its own width
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const mid = i < pts.length - 1 ? [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2] : pts[i];
      ctx.beginPath();
      ctx.lineWidth = ws[i] * k;
      ctx.moveTo(prev[0] * k, prev[1] * k);
      ctx.quadraticCurveTo(pts[i][0] * k, pts[i][1] * k, mid[0] * k, mid[1] * k);
      ctx.stroke();
      prev = mid;
    }
  }

  function paint() {
    raf = 0;
    if (!alive || !dirty) return;
    dirty = false;
    const C = {
      ink: cssVar(el, '--ink', '#1F1A17'), line: cssVar(el, '--line', '#DDD2C1'), border: cssVar(el, '--border', '#8C7F70'),
      wrong: cssVar(el, '--wrong', '#A8231C'), primary: cssVar(el, '--primary', '#0B6B63'), carrier: cssVar(el, '--ink-2', '#574C44'),
    };
    ctx.clearRect(0, 0, cv.width, cv.height);
    // guide lines: head (dashed), middle (dotted), base (solid)
    if (opts.guides !== false) {
      ctx.save();
      ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, 3 * k);
      const ln = (y, dash) => { ctx.setLineDash(dash.map(d => d * k)); ctx.beginPath(); ctx.moveTo(40 * k, y * k); ctx.lineTo((BOX - 40) * k, y * k); ctx.stroke(); };
      ln(pl.head, [24, 18]); ln(pl.mid, [4, 22]);
      ctx.strokeStyle = C.border; ln(pl.base, []);
      ctx.restore();
    }
    if (opts.carrier) {
      ctx.save(); ctx.globalAlpha = 0.45; drawText(ctx, pl, k, C.carrier, opts.carrier); ctx.restore();
    }
    const showModel = marks ? Math.max(modelAlpha, 0.3) : modelAlpha;
    if (showModel > 0) { ctx.save(); ctx.globalAlpha = showModel; drawText(ctx, pl, k, C.ink); ctx.restore(); }
    if (marks && marks.res) {
      ctx.save();
      ctx.strokeStyle = C.wrong; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 26 * k;
      for (const run of marks.res.missing || []) {
        ctx.beginPath();
        run.forEach((p, i) => (i ? ctx.lineTo(p[0] * k, p[1] * k) : ctx.moveTo(p[0] * k, p[1] * k)));
        if (run.length === 1) ctx.lineTo(run[0][0] * k + 0.1, run[0][1] * k);
        ctx.stroke();
      }
      ctx.restore();
    }
    const inkC = marks ? C.carrier : C.ink;   // marked: ink-2, still darker than the 0.3 model under it
    for (const s of strokes) inkPath(s.pts, s.w, inkC);
    if (live && live.owned) {
      inkPath(live.pts, live.w, C.ink);
      if (tail.length) {
        ctx.save(); ctx.globalAlpha = 0.35;
        const last = live.pts[live.pts.length - 1], lw = live.w[live.w.length - 1];
        inkPath([last, ...tail], [lw, ...tail.map(() => lw)], C.ink);
        ctx.restore();
      }
    }
    if (marks && marks.res) {
      ctx.save();
      ctx.strokeStyle = C.wrong; ctx.lineWidth = 6 * k; ctx.setLineDash([16 * k, 10 * k]);
      for (const run of marks.res.extra || []) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of run) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const rx = (x1 - x0) / 2 + 40, ry = (y1 - y0) / 2 + 40;
        ctx.beginPath(); ctx.ellipse(cx * k, cy * k, rx * k, ry * k, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  const toBox = e => {
    const r = cv.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * BOX, 0, BOX), clamp(((e.clientY - r.top) / r.height) * BOX, 0, BOX)];
  };
  function widthFor(e, p, q, dt) {
    if (e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5) return BASE_W * clamp(0.55 + 0.7 * e.pressure, 0.6, 1.15);
    const v = q ? dist(p, q) / Math.max(1, dt) : 0;   // units per ms
    return BASE_W * clamp(1.15 - 0.22 * v, 0.6, 1.15);
  }

  const ptrs = new Map();
  let cancelled = false;
  function onDown(e) {
    if (opts.disabled && opts.disabled()) return;
    if (e.button !== undefined && e.button > 0) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (penSeen && e.pointerType === 'touch') return;   // palm on the screen while a pen writes
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!ptrs.size) cancelled = false;
    const p = toBox(e);
    ptrs.set(e.pointerId, { id: e.pointerId, pts: [p], w: [widthFor(e, p, null, 0)], t: e.timeStamp, moved: 0, owned: false });
    if (typeof opts.onPenDown === 'function') opts.onPenDown();
    if (!live && ptrs.size === 1) { live = ptrs.get(e.pointerId); live.owned = true; dirty = true; schedule(); }
  }
  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const q = toBox(ev);
      const last = p.pts[p.pts.length - 1];
      const d = dist(last, q);
      if (d < 1.5) continue;
      p.moved += d;
      const wRaw = widthFor(ev, q, last, ev.timeStamp - p.t);
      p.t = ev.timeStamp;
      p.w.push(p.w[p.w.length - 1] * 0.7 + wRaw * 0.3);
      p.pts.push(q);
    }
    if (live && live.id !== e.pointerId && p.moved > OWN_MOVE * 3) {
      // a second pointer moving: a pinch or a palm, not a stroke
      cancelled = true; live = null; tail = [];
    }
    if (cancelled) { dirty = true; schedule(); return; }
    const pr = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
    tail = live && live.id === e.pointerId ? pr.slice(0, 3).map(toBox) : [];
    dirty = true; schedule();
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (!live || live.id !== e.pointerId) return;
    const d = live;
    live = null; tail = [];
    if (e.type === 'pointercancel' || cancelled) { dirty = true; schedule(); return; }
    strokes.push({ pts: d.pts, w: d.w });
    dirty = true; schedule();
    if (typeof opts.onPenUp === 'function') opts.onPenUp();
  }
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  const noTouch = e => e.preventDefault();
  cv.addEventListener('touchstart', noTouch, { passive: false });

  const pad = {
    el,
    strokes: () => strokes.map(s => s.pts.map(p => [p[0], p[1]])),
    inkLength: () => strokes.reduce((a, s) => a + s.pts.reduce((b, p, i) => b + (i ? dist(s.pts[i - 1], p) : 0), 0), 0),
    count: () => strokes.length,
    undo() { strokes.pop(); marks = null; dirty = true; schedule(); },
    clear() { strokes = []; marks = null; dirty = true; schedule(); },
    setModel(a) { if (a !== modelAlpha) { modelAlpha = a; dirty = true; schedule(); } },
    mark(res) { marks = { res }; dirty = true; schedule(); },
    unmark() { if (marks) { marks = null; dirty = true; schedule(); } },
    marked: () => !!marks,
    redraw() { dirty = true; schedule(); },
    destroy() {
      alive = false; cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    },
  };
  el.__pad = {
    add(list) {
      for (const pts of list) {
        if (opts.disabled && opts.disabled()) return;
        if (typeof opts.onPenDown === 'function') opts.onPenDown();
        const P = pts.map(p => [clamp(p[0], 0, BOX), clamp(p[1], 0, BOX)]);
        strokes.push({ pts: P, w: P.map(() => BASE_W) });
        dirty = true; schedule();
        if (typeof opts.onPenUp === 'function') opts.onPenUp();
      }
    },
    pl,
  };
  requestAnimationFrame(resize);
  resize();
  return pad;
}
