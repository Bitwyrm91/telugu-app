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
//     ladder    S17: the writing ladder runs Watch + Trace here; no "Without the guide" after the trace
//     onStage   S17: called with the new stage name whenever it changes
//     onFail    S17: called after each failed stroke
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

// ---- the stroke check (pure): moved to write/stroke.js (SPECS S17), re-exported here ----------

import { BOX, pathLength, distToPolyline, checkStroke, isRelaxed, HINTS } from '../write/stroke.js';
import { strokeTarget } from '../write/glyph.js';
import { gradeShape } from '../write/shape.js';
export { BOX, N_POINTS, MIN_LEN, HINTS, pathLength, resample, distToSegment, distToPolyline, decimate, TUNING, checkStroke, isRelaxed } from '../write/stroke.js';
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  let inks = [], relaxedUsed = false, shapeT = null;   // S17: learner ink per stroke; a relaxed stroke was let through
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
  let lastStage = null;
  function setAttrs() {
    if (stage !== lastStage) { lastStage = stage; if (typeof opts.onStage === 'function') { try { opts.onStage(stage); } catch { /* ignore */ } } }
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
    list = list.filter(Boolean);
    const inPanel = panel.contains(document.activeElement);
    const quiet = !opts.inLesson && !opts.ladder &&!list.some(b => b.classList.contains('draw-done-btn'))
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
    // S17: in the ladder, after the trace the next step is the ladder's own button (no "Without the guide")
    setButtons([btn('Watch again', 'btn-secondary draw-again-watch', () => { if (stage === 'watch') watch(); }),
      fromFree && opts.ladder ? null : fromFree ? btn('Without the guide', 'btn-main draw-free', () => { toFree(); focusLine(); })   // back where the learner came from
        : btn('My turn', 'btn-main draw-myturn', () => { toTrace(); focusLine(); })]);
    watch();
  }

  // critic 2, finding 10: the animation can be asked for again while drawing
  const rewatch = () => btn('Watch again', 'btn-quiet draw-rewatch', () => { toWatch(traced); focusLine(); });

  function toTrace() {
    stopAnim();
    stage = 'trace'; cur = 0; fails = 0; traced = false; inks = []; relaxedUsed = false;
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
    stage = 'free'; cur = 0; fails = 0; guideOn = false; inks = []; relaxedUsed = false;
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
    setButtons(opts.ladder ? [rewatch()] : opts.inLesson
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

  // S17: a relaxed stroke's own check only guides; the whole letter is then graded by shape
  function stageComplete() {
    if (relaxedUsed) {
      let res = null;
      try { shapeT = shapeT || strokeTarget(entry, W); res = gradeShape(shapeT, inks, 'trace'); } catch { res = null; }
      if (res && !res.ok) {
        const again = stage;
        say(`${res.hint} Try the whole letter again.`, true);
        const t = setTimeout(() => { timers.delete(t); if (!alive || stage !== again) return; if (again === 'trace') toTrace(); else toFree(); say(`${res.hint} Try the whole letter again.`, true); }, 900);
        timers.add(t);
        cur = n; setAttrs();
        return;
      }
    }
    if (stage === 'trace') traceComplete(); else freeComplete();
  }

  function judge(d) {
    if (!canDraw() || cur >= n) { d.poly.remove(); return; }
    const res = checkStroke(strokes[cur], d.pts, stage);
    if (res.ignored) { d.poly.remove(); return; }
    const guided = !res.ok && isRelaxed(letterId, cur) && res.hint !== HINTS.other;
    if (res.ok || guided) {
      d.poly.remove();
      inks[cur] = d.pts;
      if (guided) { relaxedUsed = true; gDone.append(inked(d.pts, 'draw-done-stroke draw-own')); }
      else gDone.append(inked(strokes[cur], 'draw-done-stroke'));
      cur += 1; fails = 0; guideOn = false;
      setAttrs();
      if (cur >= n) { stageComplete(); return; }
      if (guided) say(`${res.hint} ${stage === 'trace' ? TXT.trace(cur) : TXT.free(cur)}`, true);
      else say(stage === 'trace' ? TXT.trace(cur) : TXT.free(cur));
      showGuide();
      return;
    }
    // fail: the ink fades, one hint
    fails += 1;
    if (typeof opts.onFail === 'function') { try { opts.onFail(fails); } catch { /* ignore */ } }
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
