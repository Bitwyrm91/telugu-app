// write/glyph.js: the target text as the font draws it (SPECS S17 "Modules").
//
//   fontReady() -> Promise          Noto Sans Telugu is loaded (adds the face itself when no CSS declares it)
//   placement(text) -> {text, size, x, base, head, mid, top, bottom}   box units; same for mask and screen
//   drawText(ctx, pl, k, style)     fills the text on a canvas whose box -> pixel factor is k
//   getTarget(text, {carrier}) -> Promise<target>   prepared shape target (cached per text + carrier)
//   targetFor(letter, built?) -> {text, carrier}    what is graded for a letter (signs: carrier + sign)
//
// One font size and baseline for every single letter, so the head, base and centre guide lines stay put
// between stages and the hand learns one position. The baseline sits low enough that a letter's ink (its
// above-mark to its base) is about centred, with room below for a short descender. A text that would leave
// the box at that baseline (clusters with a deep vattu, tall stacks) is scaled to fit and centred on its
// own ink bounds instead.

import { BOX, SHAPE, prepareTarget } from './shape.js';

export const FAMILY = 'Noto Sans Telugu';
const SIZE = 820;        // font size in box units (the round body is about 360 units high)
const BASE = 760;        // baseline for single letters (ink about 140..770 of 1000)
const MARGIN = 40;
const fontStr = size => `${size}px "${FAMILY}"`;

let fontP = null;
export function fontReady() {
  if (fontP) return fontP;
  fontP = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const has = [...document.fonts].some(f => f.family.replace(/["']/g, '') === FAMILY);
    if (!has && typeof FontFace !== 'undefined') {
      const url = new URL('../../fonts/NotoSansTelugu.woff2', import.meta.url).href;
      const face = new FontFace(FAMILY, `url(${url})`, { weight: '100 900' });
      document.fonts.add(face);
      await face.load().catch(() => {});
    }
    await document.fonts.load(fontStr(50), 'అం').catch(() => {});
    await document.fonts.ready;
  })();
  return fontP;
}

let mctx = null;
function measurer() {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  return mctx;
}

function measure(text, size) {
  const ctx = measurer();
  ctx.font = fontStr(size);
  const m = ctx.measureText(text);
  return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent };
}

const plCache = new Map();
export function placement(text) {
  if (plCache.has(text)) return plCache.get(text);
  const m = measure(text, SIZE);
  const headA = measure('ం', SIZE).a;   // the round body: top of most letters' bowl
  const fits = m.a <= BASE - MARGIN && m.d <= BOX - MARGIN - BASE && m.l + m.r <= BOX - 2 * MARGIN;
  let k = 1, base = BASE;
  if (!fits) {   // scale to fit, then centre the ink bounds vertically
    k = Math.min(1, (BOX - 2 * MARGIN) / Math.max(1, m.l + m.r), (BOX - 2 * MARGIN) / Math.max(1, m.a + m.d));
    if (k < 1 && k >= 0.98) k = 1;   // a 2 % overflow stays inside the margin: keep one size and head line
    // only too wide: keep the shared baseline; too tall or too deep: centre the ink bounds
    if (m.a * k > BASE - MARGIN || m.d * k > BOX - MARGIN - BASE) base = BOX / 2 + ((m.a - m.d) * k) / 2;
  }
  const size = SIZE * k;
  const w = (m.r - m.l) * k;   // l is measured leftwards; glyph spans [x - l, x + r]
  const x = BOX / 2 - ((m.r * k) - (m.l * k)) / 2;
  const head = base - headA * k;
  const pl = { text, size, x, base, head, mid: (head + base) / 2, top: base - m.a * k, bottom: base + m.d * k, width: w };
  if (document.fonts.check(fontStr(50), text)) plCache.set(text, pl);   // never cache fallback-font metrics
  return pl;
}

export function drawText(ctx, pl, k, style = '#000', text = pl.text) {
  ctx.save();
  ctx.font = fontStr(pl.size * k);
  ctx.fillStyle = style;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(text, pl.x * k, pl.base * k);
  ctx.restore();
}

function mask(pl, text, G) {
  const c = document.createElement('canvas');
  c.width = c.height = G;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  drawText(ctx, pl, G / BOX, '#000', text);
  const a = ctx.getImageData(0, 0, G, G).data;
  const m = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

const tCache = new Map();
export async function getTarget(text, { carrier = null } = {}) {
  const key = `${text}|${carrier || ''}`;
  if (tCache.has(key)) return tCache.get(key);
  const p = (async () => {
    await fontReady();
    const G = SHAPE.grid;
    const pl = placement(text);
    const full = mask(pl, text, G);
    let cm = null;
    if (carrier) {
      cm = mask(pl, carrier, G);
      for (let i = 0; i < cm.length; i++) cm[i] = cm[i] && full[i] ? 1 : 0;   // the part of the carrier still drawn
    }
    const t = prepareTarget({ mask: full, w: G, h: G, carrier: cm });
    t.text = text; t.carrier = carrier; t.pl = pl;
    return t;
  })();
  tCache.set(key, p);
  return p;
}

/** A shape target from S16 stroke data (its own frame): the strokes drawn as round lines of the entry
 *  width; a sign's grey ghost part is the carrier. Grades a trace done stroke by stroke (relaxed strokes). */
export function strokeTarget(entry, width = 56) {
  const G = SHAPE.grid, k = G / BOX;
  const draw = lines => {
    const c = document.createElement('canvas');
    c.width = c.height = G;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width * k; ctx.strokeStyle = '#000';
    for (const l of lines) {
      ctx.beginPath();
      l.forEach((p, i) => (i ? ctx.lineTo(p[0] * k, p[1] * k) : ctx.moveTo(p[0] * k, p[1] * k)));
      ctx.stroke();
    }
    const a = ctx.getImageData(0, 0, G, G).data;
    const m = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
    return m;
  };
  const ghost = Array.isArray(entry.ghost) ? entry.ghost : [];
  const full = draw([...entry.strokes, ...ghost]);
  const t = prepareTarget({ mask: full, w: G, h: G, carrier: ghost.length ? draw(ghost) : null });
  t.text = ''; t.carrier = null;
  return t;
}

export const SIGN_TYPES =new Set(['sign', 'mark', 'final']);

// What is graded for a letter: its glyph; for signs and marks the carrier + sign (`say`).
export function targetFor(letter, carrierGlyph = 'న') {
  if (!letter) return null;
  if (SIGN_TYPES.has(letter.type)) {
    const text = letter.say || (carrierGlyph + letter.glyph.replace(/^◌/, ''));
    return { text, carrier: carrierGlyph, display: text };
  }
  return { text: letter.glyph, carrier: null, display: letter.glyph };
}
