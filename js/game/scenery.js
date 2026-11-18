// game/scenery.js: the still parts of the night, drawn once into off-screen canvases and then copied
// each frame (both modes). The sky with a faint nebula band, two mountain ridges lit by the moon, the far
// skyline with a few lit windows, drifting pixel clouds, and the four towns in each of their states
// (whole, damaged, ruined). shared.js draws them through drawSky and drawCity.
//
//   skyLayer(W, H, col, dpr)               gradient + nebula + dim stars
//   ridgeLayer(W, H, ground, col, dpr)     mountains, far skyline, the ground strip
//   cloudLayer(W, ground, col, dpr)        a strip of clouds (drawn twice, scrolling)
//   townSprite(i, state, tw, tall, col, dpr) -> {cv, warm, hurt, ox, w, h, lights: [[x, y]]}
//   drawVignette(c, W, H, alpha, colour)   a red edge (one town left)

import { snap, hash, makeCanvas, mix } from './pixel.js';

/** Each town's buildings: [x offset, width, height] (shares of the town width / height). */
export const TOWN_SHAPE = [[-0.085, 0.034, 0.55], [-0.045, 0.04, 1], [0.0, 0.03, 0.75], [0.035, 0.045, 0.9], [0.075, 0.025, 0.5]];

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (v !== undefined) return v;
  v = make();
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  cache.set(key, v);
  return v;
}

function layer(W, H, dpr) {
  const cv = makeCanvas(W * dpr, H * dpr);
  if (!cv) return null;
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cv, x };
}

const colKey = col => `${col.sky1}${col.sky2}${col.far}${col.city}${col.window}${col.dark}`;

export function skyLayer(W, H, col, dpr) {
  return cached(`sky|${W}|${H}|${dpr}|${colKey(col)}`, () => {
    const L = layer(W, H, dpr);
    if (!L) return null;
    const { x } = L;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, col.sky1);
    g.addColorStop(0.65, mix(col.sky1, col.sky2, 0.7));
    g.addColorStop(1, col.sky2);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    // a nebula band from the upper left down to the right, dithered in 4px cells
    const p = 4;
    const tints = ['#5A3A8C', '#2E5A7A', '#7A3A7A'];
    for (let cy = 0; cy < H * 0.7; cy += p) {
      for (let cx = 0; cx < W; cx += p) {
        const band = H * 0.08 + (cx / W) * H * 0.3;
        const d = (cy - band) / (H * 0.11);
        const dens = Math.exp(-d * d) * (0.6 + 0.4 * Math.sin(cx * 0.013 + cy * 0.02));
        const hv = hash(cx, cy, 31) % 1000;
        if (hv > dens * 520) continue;
        x.globalAlpha = 0.1 + 0.12 * dens;
        x.fillStyle = tints[hv % 3];
        x.fillRect(cx, cy, p, p);
      }
    }
    // a faint aurora: a few dithered curtains hanging from a wavy line high on the left
    const ap = 2;
    for (let cx = 0; cx < W * 0.62; cx += ap) {
      const xf = cx / W;
      const fade = Math.sin(Math.min(1, xf / 0.62) * Math.PI);
      const top = H * (0.05 + 0.05 * Math.sin(xf * 11 + 0.8) + 0.02 * Math.sin(xf * 29));
      const len = H * (0.1 + 0.06 * Math.sin(xf * 7 + 2) ** 2) * fade;
      const fold = 0.5 + 0.5 * Math.sin(xf * 47);
      for (let cy = 0; cy < len; cy += ap) {
        const q = cy / Math.max(1, len);
        const dens = fade * (1 - q) * (0.35 + 0.65 * fold) * (q < 0.12 ? q / 0.12 : 1);
        if ((hash(cx, Math.round(cy), 53) % 100) > dens * 55) continue;
        x.globalAlpha = 0.07 + 0.13 * dens;
        x.fillStyle = q < 0.3 ? '#8CF2C8' : q < 0.7 ? '#4FC8A8' : '#5A78C0';
        x.fillRect(cx, snap(top + cy, ap), ap, ap);
      }
    }
    // dim far stars (the twinkling ones are drawn live)
    x.fillStyle = '#C8C4E8';
    for (let i = 0; i < 140; i++) {
      x.globalAlpha = 0.15 + (hash(i, 2, 5) % 30) / 100;
      x.fillRect(snap((hash(i, 0, 7) % 10000) / 10000 * W, 1), snap((hash(i, 1, 9) % 10000) / 10000 * H * 0.72, 1), 1, 1);
    }
    x.globalAlpha = 1;
    return L.cv;
  });
}

// a ridge line: height (0..1) along x, from a few summed waves with a seed (smooth: no high-frequency term)
function ridge(xf, seed) {
  return 0.55 + 0.27 * Math.sin(xf * 6.1 + seed) + 0.14 * Math.sin(xf * 13.7 + seed * 2.1) + 0.04 * Math.sin(xf * 29 + seed * 3.7);
}

export function ridgeLayer(W, H, ground, col, dpr) {
  return cached(`ridge|${W}|${H}|${ground}|${dpr}|${colKey(col)}`, () => {
    const L = layer(W, H, dpr);
    if (!L) return null;
    const { x } = L;
    const p = 2;
    // solid silhouettes, far to near: the far ridge light and hazy, each nearer one darker. Slopes that
    // face the moon (falling to the right) get a short highlight just inside their own edge near the
    // top; the slopes turned away a step of shade. The nearest ridge is a plain dark shape, so nothing
    // on it reads as a line between the buildings. A short strip (the end screen) gets two low ridges.
    const short = ground < 200;
    const farTone = mix(col.sky2, '#9A92D0', 0.4);
    const midTone = mix(col.sky2, '#4A4488', 0.5);
    const nearTone = mix(col.sky1, '#2A2650', 0.45);
    const ridges = short ? [
      { seed: 1.3, top: ground * 0.74, span: ground * 0.16, body: farTone, rim: '#BDB6EA', snow: false },
      { seed: 4.1, top: ground * 0.88, span: ground * 0.08, body: midTone, rim: null, snow: false },
    ] : [
      { seed: 1.3, top: ground - H * 0.27, span: H * 0.15, body: farTone, rim: '#BDB6EA', snow: true },
      { seed: 4.1, top: ground - H * 0.16, span: H * 0.1, body: midTone, rim: '#9890D0', snow: false },
      { seed: 2.6, top: ground - H * 0.06, span: H * 0.045, body: nearTone, rim: null, snow: false },
    ];
    for (const r of ridges) {
      const n = Math.ceil(W / p) + 2;
      const raw = [], ys = [];
      for (let i = 0; i < n; i++) { raw.push(r.top + (1 - ridge((i * p) / W, r.seed)) * r.span); ys.push(snap(raw[i], p)); }
      const shade = mix(r.body, col.sky1, 0.3);
      const litFace = r.rim ? mix(r.body, r.rim, 0.28) : r.body;
      x.fillStyle = r.body;
      for (let i = 0; i < n - 1; i++) x.fillRect(i * p, ys[i], p, H - ys[i]);
      if (!r.rim) continue;
      for (let i = 1; i < n - 1; i++) {
        const y = ys[i], cx = i * p;
        const slope = (raw[i + 1] - raw[i - 1]) / (2 * p);   // > 0: falling to the right, facing the moon
        const high = (y - r.top) / r.span;                     // 0 at the top of the ridge's range
        if (slope > 0.12 && high < 0.6) {
          // a lit face just under the edge, near the top of the slope; a bright rim only near the crest
          x.fillStyle = litFace;
          x.fillRect(cx, y, p, 8);
          if (high < 0.3) { x.fillStyle = r.rim; x.fillRect(cx, y, p, 2); }
        } else if (slope < -0.12) {
          x.fillStyle = shade;
          x.fillRect(cx, y, p, 6);
        }
        if (r.snow && high < 0.18) {
          x.fillStyle = '#E2DCF6';
          x.fillRect(cx, y, p, (i % 3 === 0) ? 4 : 2);
        }
      }
    }
    // the far skyline, with a few dim windows
    const base = H;
    const r = (i, s) => (hash(i, s, 17) % 1000) / 1000;
    let bx = 0, i = 0;
    while (bx < W) {
      const w = snap(W * (0.03 + r(i, 1) * 0.05), 2), hh = snap((0.25 + r(i, 2) * 0.55) * (H - ground) * 0.9, 2);
      x.fillStyle = col.far;
      x.fillRect(bx, base - hh, w, hh);
      if (r(i, 3) < 0.4) x.fillRect(bx + snap(w / 2, 2) - 1, base - hh - 6, 2, 6);
      x.fillStyle = mix(col.far, col.window, 0.35);
      for (let wy = base - hh + 5; wy < base - 4; wy += 7) {
        for (let wx = bx + 3; wx < bx + w - 3; wx += 5) if (hash(wx | 0, wy | 0, 3) % 7 === 0) x.fillRect(wx, wy, 2, 2);
      }
      bx += w + 2; i++;
    }
    return L.cv;
  });
}

/**
 * A strip of clouds (it tiles across W): each cloud a union of puffs on a flat base, lit along its
 * upper right edge by the moon, a shaded underside, a dithered fringe. variant picks the shapes.
 */
export function cloudLayer(W, ground, col, dpr, variant = 0) {
  const Hc = 52;
  return cached(`cloud|${W}|${ground}|${dpr}|${variant}|${colKey(col)}`, () => {
    const L = layer(W, Hc, dpr);
    if (!L) return null;
    const { x } = L;
    const p = 3;
    const body = mix(col.sky2, '#7A72B0', 0.6), lit = mix(col.sky2, '#D8D0F4', 0.6), rim = '#ECE6FF';
    const under = mix(col.sky1, col.sky2, 0.55);
    const n = Math.max(2, Math.round(W / 170));
    const cols = Math.ceil(W / p), rows = Math.ceil(Hc / p);
    // which cell belongs to a cloud: a puff list per cloud, then test cells against it (made once)
    const puffs = [];
    for (let k = 0; k < n; k++) {
      const cx = ((k + 0.25 + (hash(k, 1, 3 + variant) % 50) / 100) / n) * W;
      const w = 70 + (hash(k, 2, 3 + variant) % 70);
      const np = 4 + (hash(k, 3, 3 + variant) % 3);
      for (let j = 0; j < np; j++) {
        const f = j / (np - 1);
        const r = (13 + (hash(k, j, 5 + variant) % 10)) * (1 - Math.abs(f - 0.45) * 0.75);
        puffs.push({ x: cx - w / 2 + f * w, y: Hc - 7 - r * 0.45, r: Math.max(8, r) });
      }
    }
    const inside = (px, py) => {
      if (py > Hc - 6) return false;
      for (const q of puffs) {
        let dx = px - q.x;
        if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
        if (dx * dx + (py - q.y) * (py - q.y) < q.r * q.r) return true;
      }
      return false;
    };
    let grid = [];
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) grid.push(inside(gx * p + p / 2, gy * p + p / 2));
    const at = (gx, gy) => gy >= 0 && gy < rows && grid[gy * cols + ((gx + cols) % cols)];
    // solid bodies only: drop any cell that is one cell thick (thin arcs, slivers between puffs), twice
    for (let pass = 0; pass < 2; pass++) {
      const next = grid.slice();
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (!at(gx, gy)) continue;
          const v = at(gx, gy - 1) || at(gx, gy + 1), hz = at(gx - 1, gy) || at(gx + 1, gy);
          const vv = at(gx, gy - 1) + at(gx, gy + 1), hh = at(gx - 1, gy) + at(gx + 1, gy);
          if (!v || !hz || (vv + hh) < 2) next[gy * cols + gx] = false;
        }
      }
      grid = next;
    }
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (!at(gx, gy)) {
          // a dithered fringe below a cloud's base
          continue;
        }
        const openUp = !at(gx, gy - 1), openRight = !at(gx + 1, gy), openUR = !at(gx + 1, gy - 1);
        const openDown = !at(gx, gy + 1) || !at(gx, gy + 2);
        let fill = body;
        if (openUp && (openRight || openUR)) fill = rim;
        else if (openUp) fill = lit;
        else if (!at(gx, gy - 2) && hash(gx, gy, 4) % 2) fill = lit;
        else if (openDown) fill = under;
        else if (!at(gx - 1, gy)) fill = mix(body, under, 0.5);
        x.fillStyle = fill;
        x.fillRect(gx * p, gy * p, p, p);
      }
    }
    return { cv: L.cv, h: Hc };
  });
}

// ---- towns ------------------------------------------------------------------------------------------

const ROOFS = ['antenna', 'tank', 'step', 'spire', 'ledge'];

/** state: 2 whole, 1 damaged, 0 ruined. */
export function townSprite(i, state, tw, tall, col, dpr) {
  tw = Math.round(tw); tall = Math.round(tall);
  return cached(`town|${i}|${state}|${tw}|${tall}|${dpr}|${colKey(col)}`, () => {
    const ox = Math.round(tw * 0.62), w = Math.round(tw * 1.24), h = Math.round(tall * 1.35) + 4;
    const L = layer(w, h, dpr), WM = layer(w, h, dpr), HM = layer(w, h, dpr);
    if (!L) return null;
    const { x } = L;
    const lights = [];
    const factor = state === 0 ? 0.3 : state === 1 ? 0.75 : 1;
    const lit = mix(col.city, '#7A74B0', 0.3), shade = mix(col.city, '#000000', 0.3), off = mix(col.city, '#000000', 0.45);
    const winA = col.window, winB = mix(col.window, '#FFF7E0', 0.45), winC = mix(col.window, '#62D2C5', 0.6);
    const sil = (fn) => { for (const M of [WM, HM]) if (M) fn(M.x); };
    TOWN_SHAPE.forEach(([dx, bw0, hg], b) => {
      const bx = snap(ox + dx * tw / 0.2, 2), bw = snap(bw0 * tw / 0.2, 2);
      const bh = snap(tall * hg * factor, 2);
      const top = h - bh;
      const seed = i * 7 + b;
      const roof = ROOFS[hash(seed, 3, 1) % ROOFS.length];
      // the body, with a moonlit right edge and a shaded left edge
      x.fillStyle = col.city; x.fillRect(bx, top, bw, bh);
      x.fillStyle = shade; x.fillRect(bx, top, 2, bh);
      x.fillStyle = lit; x.fillRect(bx + bw - 2, top, 2, bh);
      sil(m => m.fillRect(bx, top, bw, bh));
      let jag = [];
      if (state < 2) {
        // a broken top: notches bitten out, scorch marks below
        for (let q = 0; q < bw; q += 2) {
          const d = (hash(seed, q, 9) % 5) * (state === 0 ? 3 : 2) + (q > bw * 0.3 && q < bw * 0.7 ? 2 : 0);
          jag.push(d);
          x.clearRect(bx + q, top, 2, d);
          if (WM) WM.x.clearRect(bx + q, top, 2, d); if (HM) HM.x.clearRect(bx + q, top, 2, d);
          x.fillStyle = '#16121E'; x.fillRect(bx + q, top + d, 2, 2);
        }
        for (let s = 0; s < (state === 0 ? 4 : 3); s++) {
          const sx = bx + 2 + (hash(seed, s, 4) % Math.max(1, bw - 8)), sy = top + 4 + (hash(seed, s, 6) % Math.max(1, bh - 8));
          x.fillStyle = '#16121E'; x.globalAlpha = 0.7;
          x.fillRect(snap(sx, 2), snap(sy, 2), 6, 4); x.fillRect(snap(sx, 2) + 2, snap(sy, 2) - 2, 4, 8);
          x.globalAlpha = 1;
        }
        // a crack down the face
        let cxk = bx + snap(bw * 0.5, 2), cyk = top + 4;
        x.fillStyle = '#16121E';
        for (let s = 0; s < Math.min(12, bh / 4); s++) { x.fillRect(cxk, cyk, 2, 4); cyk += 4; cxk += ((hash(seed, s, 8) % 3) - 1) * 2; }
      } else {
        // roof details
        const mx = bx + snap(bw / 2, 2);
        x.fillStyle = col.city;
        if (roof === 'antenna') { x.fillRect(mx, top - 12, 2, 12); x.fillRect(mx - 2, top - 6, 6, 2); lights.push([mx, top - 14, 'red', seed]); }
        else if (roof === 'tank') { x.fillRect(mx - 5, top - 8, 10, 6); x.fillRect(mx - 4, top - 2, 2, 2); x.fillRect(mx + 2, top - 2, 2, 2); x.fillStyle = lit; x.fillRect(mx + 3, top - 8, 2, 6); }
        else if (roof === 'step') { x.fillRect(bx + 4, top - 4, bw - 8, 4); x.fillRect(bx + 8, top - 8, Math.max(2, bw - 16), 4); x.fillStyle = lit; x.fillRect(bx + bw - 6, top - 4, 2, 4); }
        else if (roof === 'spire') { for (let s = 0; s < 6; s++) x.fillRect(mx - 4 + s, top - s * 3 - 3, 8 - s * 2 + 1, 3); x.fillRect(mx, top - 24, 2, 6); lights.push([mx, top - 26, 'white', seed]); }
        else { x.fillStyle = lit; x.fillRect(bx - 2, top, bw + 4, 2); x.fillRect(bx - 2, top + snap(bh * 0.3, 2), bw + 4, 2); }
        sil(m => m.fillRect(bx, top - 12, bw, 12));
      }
      // windows
      for (let wy = top + 6; wy < h - 6; wy += 9) {
        for (let wx = bx + 4; wx < bx + bw - 5; wx += 7) {
          const hv = hash(wx | 0, wy | 0, seed);
          const qi = Math.floor((wx - bx) / 2);
          if (state < 2 && jag.length && wy < top + (jag[Math.min(jag.length - 1, qi)] || 0) + 4) continue;
          let fill;
          if (state === 2) fill = hv % 4 === 0 ? off : hv % 11 === 0 ? winC : hv % 5 === 0 ? winB : winA;
          else if (state === 1) fill = hv % 3 === 0 ? (hv % 2 ? PAL_ORANGE : winA) : off;
          else fill = hv % 6 === 0 ? '#E23D3D' : '#16121E';
          x.fillStyle = fill;
          x.fillRect(wx, wy, 3, 4);
          if (state === 2 && fill !== off) { x.fillStyle = shade; x.fillRect(wx, wy + 3, 3, 1); }
        }
      }
    });
    // a ruined town has a rubble heap at its foot; a damaged one has a little
    if (state < 2) {
      const n = state === 0 ? 70 : 24;
      const rub = ['#3A3456', '#262245', '#4A465E', '#16121E', '#5A4E5E'];
      for (let k = 0; k < n; k++) {
        const t = (hash(i, k, 21) % 1000) / 1000;
        const rx = snap(ox - tw * 0.48 + t * tw * 0.98, 2);
        const peak = (state === 0 ? 0.13 : 0.06) * tall * Math.sin(t * Math.PI);
        const ry = snap(h - (hash(i, k, 22) % 1000) / 1000 * peak - 2, 2);
        x.fillStyle = rub[k % rub.length];
        const s = 2 + (hash(i, k, 23) % 3) * 2;
        x.fillRect(rx, ry - s + 2, s, s);
        sil(m => m.fillRect(rx, ry - s + 2, s, s));
        if (state === 0 && k % 9 === 0) { x.fillStyle = '#FF8A1F'; x.fillRect(rx, ry - 2, 2, 2); }
      }
    }
    // the masks: the same outline filled with warm light and with the hurt colour
    if (WM) { WM.x.globalCompositeOperation = 'source-in'; WM.x.fillStyle = '#FFB060'; WM.x.fillRect(0, 0, w, h); }
    if (HM) { HM.x.globalCompositeOperation = 'source-in'; HM.x.fillStyle = col.hurt || '#FF6B5E'; HM.x.fillRect(0, 0, w, h); }
    return { cv: L.cv, warm: WM && WM.cv, hurt: HM && HM.cv, ox, w, h, lights };
  });
}
const PAL_ORANGE = '#FF8A1F';

export function drawVignette(c, W, H, alpha, colour = '#E23D3D') {
  if (!(alpha > 0.005)) return;
  const v = cached(`vig|${Math.round(W)}|${Math.round(H)}|${colour}`, () => {
    const cv = makeCanvas(Math.max(8, Math.round(W / 4)), Math.max(8, Math.round(H / 4)));
    if (!cv) return null;
    const x = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, colour);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return cv;
  });
  if (!v) return;
  c.globalAlpha = Math.min(1, alpha);
  c.drawImage(v, 0, 0, W, H);
  c.globalAlpha = 1;
}
