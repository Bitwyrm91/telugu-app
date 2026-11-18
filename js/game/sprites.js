// game/sprites.js: chunky pixel-style drawing for the game's moving things (both modes). Everything
// is drawn with small squares on the 2D canvas; nothing here knows the rules. `reduced` (reduced
// motion) turns off flicker, wobble and flying bits.
//
//   drawMeteor(c, x, y, r, ux, uy, o)   o: {anim, reduced, kind: 'rock'|'split'|'kid'|'boss', seed, col, charge}
//   drawRocket(c, x0, y0, x, y, o)      o: {anim, reduced, big}   (x0,y0 = where it came from)
//   drawMark(c, x, y, o)                where a rocket is going
//   drawBurst(c, x, y, rad, k, o)       k = 0..1 of its life; o: {kind: 'shot'|'big'|'chain', reduced}
//   drawGroundBlast(c, x, ground, k, o) a meteor reaching the ground
//   drawBase(c, x, ground, H, o)        the launcher; o: {aim (radians, 0 = up), anim, reduced, col, empty, ammo, ammoMax}
//   drawDanger(c, x, ground, k, o)      a red target mark where a low meteor will land
//   sparks(list, x, y, n) / stepSparks(list, dt) / drawSparks(c, list)
//   drawBackdrop(c, W, ground, o)       big stars, now and then a shooting star, the moon with its halo
//   drawTownFire(c, cx, base, tw, tall, o)   flames, embers and smoke over a damaged (hp 1) or ruined (hp 0) town
//   drawSmoke(c, x, y, o)               a smoke column (and fire: true, a few flames)
//   popup(list, x, y, text, o) / stepPopups(list, dt) / drawPopups(c, list)   points floating up

export const PAL = {
  white: '#FFF7E0', yellow: '#FFD23F', orange: '#FF8A1F', red: '#E23D3D', ember: '#8C2B3A',
  smoke: '#6E6A86', steel: '#E6EEF8', shade: '#93A6C4', teal: '#62D2C5', nose: '#FF5D5D', glow: '#B8FFF4',
  rockLight: '#8A7468', rockDark: '#3B2F2B', outline: '#1A1222', moon: '#F3ECCB', moonDark: '#CFC59A', bossLight: '#A85C7E', bossDark: '#4E2439',
};

import { snap, hash, drawGlow, drawText, makeCanvas } from './pixel.js';
import { TOWN_SHAPE } from './scenery.js';

// one pixel size for every sprite (css px), so meteors, rockets and bursts sit in the same grid
const SP = 2;

const POP = ['#FFF7E0', '#FFD23F', '#FF8A1F', '#1A1222'];
const POP_HOT = ['#FFF7E0', '#FF8A1F', '#E23D3D', '#1A1222'];

const TAIL = {
  rock: [PAL.white, PAL.yellow, PAL.orange, PAL.red, PAL.ember],
  kid: [PAL.white, '#FFE0A0', '#FF9A5A', '#E0508A', '#6A2050'],
  split: [PAL.white, '#FF9CF2', '#E050C8', '#9A2A9A', '#4E1A5A'],
  boss: ['#FFE0F6', '#FF7AD0', '#D0307A', '#8A1A4A', '#3E0E2A'],
};

// the flame tail behind a meteor, drawn cell by cell at the sprite pixel size: a tapering ragged
// tongue, white-hot at the head, cooling to dark at the tip, the far end dithered out
function drawTail(c, x, y, r, ux, uy, tail, o) {
  const { anim = 0, reduced = false, seed = 1, p = 2, len = 1 } = o;
  const L = r * 4 * len;
  const frame = reduced ? 0 : Math.floor(anim * 12);
  const vx = -uy, vy = ux;
  const step = p;
  let last = '';
  for (let i = 0, a = r * 0.3; a < L; a += step, i++) {
    const f = a / L;
    const wob = reduced ? 0 : Math.sin(anim * 16 - a * 0.22 + seed) * r * 0.14 * f;
    const w = r * 0.92 * Math.pow(1 - f, 0.85) + p * 0.5;
    const cx = x + ux * a, cy = y + uy * a;
    for (let s = -w, j = 0; s <= w; s += p, j++) {
      const q = Math.abs(s) / w;
      const h = hash(i, j, seed * 7 + frame);
      if (q > 0.65 && h % 3 === 0) continue;
      if (f > 0.7 && (i + j + frame) % 2 === 0) continue;
      const heat = f * 1.15 + q * 0.6 + (h % 4) * 0.05;
      const band = Math.min(tail.length - 1, Math.floor(heat * 3.6));
      const fill = tail[band];
      if (fill !== last) { c.fillStyle = fill; last = fill; }
      c.fillRect(snap(cx + vx * (s + wob), p), snap(cy + vy * (s + wob), p), p, p);
    }
  }
  if (!reduced) {
    // embers shed along the tail
    for (let i = 0; i < 6; i++) {
      const ph = (anim * 1.3 + i * 0.37 + seed * 0.11) % 1;
      const d = r * (1.2 + ph * 4.6) * len, side = Math.sin(i * 2.4 + seed) * r * (0.5 + ph * 0.9);
      if (ph > 0.75 && i % 2) continue;
      c.fillStyle = ph < 0.4 ? tail[1] : tail[2];
      c.fillRect(snap(x + ux * d - uy * side, p), snap(y + uy * d + ux * side, p), p, p);
    }
  }
  c.globalAlpha = 1;
}

/**
 * o: {anim, reduced, kind: 'rock'|'split'|'kid'|'boss', seed, col, charge (0..1: how close a split
 * meteor is to breaking)}
 */
export function drawMeteor(c, x, y, r, ux, uy, o = {}) {
  const { kind = 'rock' } = o;
  if (kind === 'split') return drawSplitMeteor(c, x, y, r, ux, uy, o);
  if (kind === 'boss') return drawBossMeteor(c, x, y, r, ux, uy, o);
  const { anim = 0, reduced = false, seed = 1, col = {} } = o;
  const p = SP;
  const kid = kind === 'kid';
  drawGlow(c, x + ux * r * 0.8, y + uy * r * 0.8, r * 1.9, kid ? '#FF70B0' : '#FF8A30', 0.3);
  drawTail(c, x, y, r, ux, uy, TAIL[kid ? 'kid' : 'rock'], { anim, reduced, seed, p });
  // the rock: a pixel disc with a dark outline, lit from the upper right (the moon), white-hot where it
  // meets the air; its craters turn as it tumbles (the light stays put)
  const base = kid ? '#6A4650' : (col.rock || '#5B4A43');
  const light = kid ? '#9A6E78' : PAL.rockLight;
  const dark = PAL.rockDark;
  const m = Math.max(2, Math.round(r / p));
  const ox = snap(x, p), oy = snap(y, p);
  const spin = reduced ? 0.6 : anim * (1.2 + (seed % 5) * 0.25) * (seed % 2 ? 1 : -1);
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const cr = [[0.42, 0.1, 0.34], [-0.3, -0.4, 0.26], [-0.1, 0.5, 0.2]];
  for (let gy = -m - 1; gy <= m; gy++) {
    for (let gx = -m - 1; gx <= m; gx++) {
      const ex = gx + 0.5, ey = gy + 0.5;
      const e = Math.hypot(ex, ey) / m;
      if (e > 1 + 1.3 / m) continue;
      const lead = -(ex * ux + ey * uy) / m;
      let fill = base;
      if (e > 1) fill = lead > 0.7 ? PAL.white : lead > 0.3 ? PAL.yellow : lead < -0.35 ? null : PAL.outline;
      else if (e > 0.72 && lead > 0.3) fill = lead > 0.62 ? PAL.yellow : PAL.orange;
      else {
        const rx = (ex * cs + ey * sn) / m, ry = (-ex * sn + ey * cs) / m;
        let crater = 0;
        for (const [qx, qy, qr] of cr) {
          const d = Math.hypot(rx - qx, ry - qy) / qr;
          if (d < 0.75) { crater = 2; break; }
          if (d < 1.15 && crater === 0) crater = (rx - qx) + (ry - qy) < 0 ? 1 : 3;
        }
        if (crater === 2) fill = dark;
        else if (crater === 3) fill = light;
        else if (hash(Math.round(rx * 9), Math.round(ry * 9), seed) % 7 === 0) fill = dark;
        else if (ex - ey > m * 0.55) fill = light;
        else if (ey - ex > m * 0.75) fill = dark;
      }
      if (!fill) continue;
      c.fillStyle = fill;
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  // a kid is a broken half: a hot pink break face on its trailing side
  if (kid) {
    c.fillStyle = '#FF9CF2';
    for (let s = -m + 1; s < m; s++) {
      const bx = ox + snap((ux * (m - 1) * 0.55 - uy * s) * p, p), by = oy + snap((uy * (m - 1) * 0.55 + ux * s) * p, p);
      c.fillRect(bx, by, p, p);
    }
  }
}

// A meteor that will split: two lobes of violet rock joined by a glowing seam that widens and brightens
// as it nears the split height; two tails, one from each lobe.
function drawSplitMeteor(c, x, y, r, ux, uy, o) {
  const { anim = 0, reduced = false, seed = 1, charge = 0 } = o;
  const k = Math.max(0, Math.min(1, charge));
  const p = SP;
  const m = Math.max(4, Math.round((r * 1.1) / p));
  const pulse = reduced ? 0.75 : 0.6 + 0.4 * Math.sin(anim * (7 + k * 16));
  // the axis the rock will break along (across its path), rocking a little
  const rock = reduced ? 0 : Math.sin(anim * 3 + seed) * 0.22;
  const a0 = Math.atan2(ux, -uy) + rock;
  const nx = Math.cos(a0), ny = Math.sin(a0);
  const d = m * 0.4 + k * 1.5;
  const lr = m * 0.72;
  // glow and the two thin tails, one from each lobe
  drawGlow(c, x, y, r * 2.6, '#D050E0', 0.3 + 0.3 * k * pulse);
  for (const sgn of [-1, 1]) {
    drawTail(c, x + nx * d * p * sgn + ux * lr * p * 0.4, y + ny * d * p * sgn + uy * lr * p * 0.4, r * 0.45, ux, uy, TAIL.split, { anim, reduced, seed: seed + sgn * 3, p, len: 1.6 });
  }
  const ox = snap(x, p), oy = snap(y, p);
  const seamW = 0.7 + k * 0.9;
  const R = m + 2;
  for (let gy = -R; gy <= R; gy++) {
    for (let gx = -R; gx <= R; gx++) {
      const ex = gx + 0.5, ey = gy + 0.5;
      const s = ex * nx + ey * ny;            // across the break
      const t = ex * -ny + ey * nx;           // along the break
      const da = Math.hypot(s - d, t), db = Math.hypot(s + d, t);
      const ea = da / lr, eb = db / lr;
      const e = Math.min(ea, eb);
      if (e > 1 + 1.2 / lr) continue;
      const lead = -(ex * ux + ey * uy) / m;
      const jag = ((hash(Math.round(t), 1, seed) % 3) - 1) * 0.45;
      const inSeam = Math.abs(s - jag) < seamW && e <= 1;
      let fill;
      if (e > 1) fill = inSeam ? null : lead > 0.55 ? '#FFD0F0' : lead > 0.2 ? '#FF7AD0' : lead < -0.4 ? null : PAL.outline;
      else if (inSeam) {
        const core = Math.abs(s - jag) < seamW * 0.45;
        fill = core ? (k > 0.55 && pulse > 0.7 ? PAL.white : '#FFC8F6') : '#E050C8';
      } else if (e > 0.74 && lead > 0.35) fill = lead > 0.65 ? '#FFD0F0' : '#FF7AD0';
      else {
        const side = ea < eb ? 1 : -1;
        const lx = (s - side * d) / lr, ly = t / lr;
        const hv = hash(Math.round(lx * 6), Math.round(ly * 6), seed + side);
        fill = hv % 6 === 0 ? '#2E2240' : (lx * side) - ly > 0.45 ? '#9A84B0' : ly - (lx * side) > 0.6 ? '#3A2C50' : '#5E4A72';
        // hairline cracks running out from the seam, lit as it charges
        if (k > 0.3 && Math.abs(ly - lx * 0.5 * side) < 0.09 && Math.abs(lx) < 0.7) fill = '#C040C8';
      }
      if (!fill) continue;
      c.fillStyle = fill;
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  // close to breaking: sparks spit from the seam ends
  if (!reduced && k > 0.6) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const ph = (anim * 3 + i / n) % 1, sgn = i % 2 ? 1 : -1;
      const along = (lr + ph * r * 0.6) * sgn;
      const px = x + (-ny * along) * p + nx * ((hash(i, 3, seed) % 3) - 1) * p;
      const py = y + (nx * along) * p + ny * ((hash(i, 4, seed) % 3) - 1) * p;
      c.globalAlpha = 1 - ph;
      c.fillStyle = ph < 0.4 ? PAL.white : '#FF9CF2';
      c.fillRect(snap(px, 2), snap(py, 2), 2, 2);
    }
    c.globalAlpha = 1;
  }
}

// A boss: a huge crimson rock veined with magenta light, crystals on its rim, three shards circling it
// (those behind it drawn first), a slow dashed aura and a wide twin tail.
function drawBossMeteor(c, x, y, r, ux, uy, o) {
  const { anim = 0, reduced = false, seed = 1, col = {} } = o;
  const p = SP;
  const m = Math.max(4, Math.round(r / p));
  const pulse = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(anim * 4);
  const turn = reduced ? 0.4 : anim * 1.6;
  const shards = [0, 1, 2].map(i => {
    const a = turn + (i / 3) * Math.PI * 2;
    return { a, sx: x + Math.cos(a) * r * 1.55, sy: y + Math.sin(a) * r * 0.55 - Math.cos(a) * r * 0.25, front: Math.sin(a) > 0 };
  });
  const shard = s => {
    const q = SP;
    const X = snap(s.sx, q), Y = snap(s.sy, q);
    c.fillStyle = PAL.outline;
    c.fillRect(X - q, Y - q * 3, q * 2, q * 6); c.fillRect(X - q * 2, Y - q * 2, q * 4, q * 4);
    c.fillStyle = s.front ? '#C0508A' : '#7A3E5A';
    c.fillRect(X - q, Y - q * 2, q * 2, q * 4); c.fillRect(X - q * 2 + q, Y - q, q * 2, q * 2);
    c.fillStyle = s.front ? '#FFB8E8' : '#A85C7E';
    c.fillRect(X, Y - q * 2, q, q * 2);
  };
  for (const s of shards) if (!s.front) shard(s);
  drawGlow(c, x, y, r * 1.8, '#C0306A', 0.24 + 0.1 * pulse);
  for (const sgn of [-1, 1]) {
    drawTail(c, x - uy * r * 0.4 * sgn, y + ux * r * 0.4 * sgn, r * 0.55, ux, uy, TAIL.boss, { anim, reduced, seed: seed + sgn * 5, p, len: 1.3 });
  }
  // the dashed aura
  const ar = r * 1.3;
  const dashes = 14;
  c.globalAlpha = 0.35 + 0.35 * pulse;
  c.fillStyle = '#FF7AD0';
  for (let i = 0; i < dashes; i++) {
    for (let j = 0; j < 3; j++) {
      const a = (reduced ? 0 : anim * 0.5) + (i / dashes) * Math.PI * 2 + j * 0.05;
      c.fillRect(snap(x + Math.cos(a) * ar, 2) - 1, snap(y + Math.sin(a) * ar, 2) - 1, 3, 3);
    }
  }
  c.globalAlpha = 1;
  const ox = snap(x, p), oy = snap(y, p);
  const spin = reduced ? 0.6 : anim * 0.6;
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const body = col.boss || '#7A3E5A';
  for (let gy = -m - 2; gy <= m + 1; gy++) {
    for (let gx = -m - 2; gx <= m + 1; gx++) {
      const ex = gx + 0.5, ey = gy + 0.5;
      const rx = (ex * cs + ey * sn) / m, ry = (-ex * sn + ey * cs) / m;
      const ang = Math.atan2(ry, rx);
      // crystals pushing out of the rim at five places
      const spike = Math.max(0, Math.cos(ang * 5 + seed)) ** 6 * 0.28;
      const e = Math.hypot(ex, ey) / m;
      const edge = 1 + spike;
      if (e > edge + 1.2 / m) continue;
      const lead = -(ex * ux + ey * uy) / m;
      let fill;
      if (e > edge) fill = lead > 0.6 ? '#FFD0F0' : lead < -0.4 ? null : PAL.outline;
      else if (e > 1) fill = e > edge - 0.1 ? '#FFE0F6' : '#FF9CF2';
      else if (e > 0.78 && lead > 0.4) fill = lead > 0.7 ? '#FFD0F0' : '#FF7AD0';
      else {
        const v = Math.abs(Math.sin(rx * 6.5 + ry * 2.2 + seed) + Math.sin(-rx * 3.1 + ry * 7.3));
        if (v < 0.22) fill = pulse > 0.75 && v < 0.1 ? '#FFE0F6' : '#FF7AD0';
        else if (v < 0.42) fill = '#A83070';
        else if (ex - ey > m * 0.6) fill = PAL.bossLight;
        else if (ey - ex > m * 0.7) fill = PAL.bossDark;
        else fill = hash(Math.round(rx * 8), Math.round(ry * 8), seed) % 9 === 0 ? PAL.bossDark : body;
      }
      if (!fill) continue;
      c.fillStyle = fill;
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  for (const s of shards) if (s.front) shard(s);
}

const ROCKET = [
  '...N...',
  '..NWN..',
  '..WWS..',
  '..WTS..',
  '..WTS..',
  '..WWS..',
  '..WWS..',
  '.FWWSF.',
  'FFWWSFF',
  'F.DDD.F',
];
const ROCKET_BIG = [
  '....N....',
  '...NNN...',
  '...WWS...',
  '..WWWSS..',
  '..WTTTS..',
  '..WTYTS..',
  '..WTTTS..',
  '..WWWSS..',
  '..WWWSS..',
  '.FWWWSSF.',
  'FFFWWSFFF',
  'FF.DDD.FF',
];
const INK = { N: PAL.nose, W: PAL.steel, S: PAL.shade, T: PAL.teal, F: PAL.teal, Y: PAL.yellow, O: PAL.orange, D: '#4A465E' };
const INK_BIG = { ...INK, F: PAL.yellow, T: PAL.glow, N: PAL.yellow };
const EXHAUST = [PAL.white, PAL.white, PAL.yellow, PAL.yellow, PAL.orange, PAL.orange, PAL.red, PAL.ember];
const EXHAUST_BIG = [PAL.white, PAL.white, PAL.glow, PAL.glow, PAL.yellow, PAL.orange, PAL.red, PAL.ember];

export function drawRocket(c, x0, y0, x, y, o = {}) {
  const { anim = 0, reduced = false, big = false, trail = true } = o;
  const p = big ? 3 : 3;
  const dx = x - x0, dy = y - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const shape = big ? ROCKET_BIG : ROCKET, ink = big ? INK_BIG : INK;
  const w = shape[0].length, hgt = shape.length;
  // a small hot glow at the nozzle only
  drawGlow(c, x - ux * p * (hgt * 0.5 + 2), y - uy * p * (hgt * 0.5 + 2), p * (big ? 7 : 5), big ? '#9FFFF0' : '#FFB040', big ? 0.6 : 0.45);
  // under reduced motion (or with no live trail) a still line of small puffs
  if (trail || reduced) {
    const puffs = big ? 8 : 6, reach = Math.min(len - 12, big ? 110 : 80);
    for (let i = 1; i <= puffs; i++) {
      const f = i / puffs;
      const d = p * hgt * 0.5 + 8 + reach * f;
      if (d > len) break;
      const s = snap(Math.max(2, 6 - f * 4), 2);
      const X = snap(x - ux * d, 2), Y = snap(y - uy * d, 2);
      c.globalAlpha = 0.75 * (1 - f * 0.7);
      c.fillStyle = f < 0.2 ? PAL.yellow : f < 0.45 ? PAL.steel : f < 0.7 ? '#A9A6C0' : PAL.smoke;
      c.fillRect(X - s / 2, Y - s / 2, s, s);
      if (s > 2) { c.fillRect(X - s / 2 + 2, Y - s / 2 - 2, s - 4 || 2, 2); }
    }
    c.globalAlpha = 1;
  }
  c.save();
  c.translate(x, y);
  c.rotate(Math.atan2(dy, dx) + Math.PI / 2);
  const left = -(w * p) / 2, top = -(hgt * p) / 2;
  // the exhaust: a crisp tapering flame, white at the nozzle, cooling to red at the tip
  const ex = EXHAUST_BIG.length;
  const flick = reduced ? 0 : (hash(Math.floor(anim * 30), 1, big ? 2 : 1) % 3);
  const rows = (big ? 9 : 7) + flick;
  const wide = big ? 3 : 2;
  for (let j = 0; j < rows; j++) {
    const f = j / rows;
    const half = Math.max(0.5, wide * (1 - f) ** 0.8);
    const cells = Math.max(1, Math.round(half * 2));
    const xs = -Math.round(cells / 2) * (p / 1) + (cells % 2 ? p / 2 : 0);
    const ci = Math.min(ex - 1, Math.floor(f * ex));
    c.globalAlpha = f > 0.7 ? 1 - (f - 0.7) * 2 : 1;
    c.fillStyle = (big ? EXHAUST_BIG : EXHAUST)[ci];
    c.fillRect(Math.round(xs) - (cells % 2 ? p / 2 : 0), top + hgt * p + j * p * 0.85, cells * p, Math.ceil(p * 0.85));
    if (f < 0.4 && cells > 2) { c.fillStyle = PAL.white; c.fillRect(-p / 2 - (cells > 3 ? p / 2 : 0), top + hgt * p + j * p * 0.85, cells > 3 ? p * 2 : p, Math.ceil(p * 0.85)); }
  }
  c.globalAlpha = 1;
  shape.forEach((row, j) => {
    for (let i = 0; i < w; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      c.fillStyle = ink[ch];
      c.fillRect(left + i * p, top + j * p, p, p);
    }
  });
  c.restore();
}

export function drawMark(c, x, y, o = {}) {
  const { anim = 0, reduced = false, big = false } = o;
  const p = 2, g = reduced ? 4 : 4 + (Math.floor(anim * 6) % 2) * 2;
  const X = snap(x, p), Y = snap(y, p);
  c.fillStyle = PAL.outline;
  c.fillRect(X - g - 5, Y - 2, 6, p + 2); c.fillRect(X + g - 1, Y - 2, 6, p + 2);
  c.fillRect(X - 2, Y - g - 5, p + 2, 6); c.fillRect(X - 2, Y + g - 1, p + 2, 6);
  c.fillStyle = big ? PAL.yellow : PAL.glow;
  c.fillRect(X - g - 4, Y - 1, 4, p); c.fillRect(X + g, Y - 1, 4, p);
  c.fillRect(X - 1, Y - g - 4, p, 4); c.fillRect(X - 1, Y + g, p, 4);
}

// five steps from white-hot to dark, per kind of burst
const HEAT = {
  shot: [PAL.white, PAL.yellow, PAL.orange, PAL.red, PAL.ember],
  big: [PAL.white, PAL.glow, PAL.yellow, PAL.orange, PAL.red],
  chain: [PAL.white, PAL.yellow, '#FF5D9E', '#B0307A', '#4E1A4A'],
};
// fireball ramps: white-hot core to a dark smoke rim
const FIRE = {
  shot: [PAL.white, '#FFF0A0', PAL.yellow, '#FFB02E', PAL.orange, '#E85A28', PAL.red, PAL.ember, '#4A3446'],
  big: [PAL.white, PAL.glow, '#DFFFF0', PAL.yellow, '#FFB02E', PAL.orange, PAL.red, PAL.ember, '#3E3048'],
  chain: [PAL.white, '#FFE0F0', '#FF9CF2', '#FF5D9E', '#D0408A', '#B0307A', '#7A2060', '#4E1A4A', '#33203E'],
};
const RING = { shot: PAL.yellow, big: PAL.glow, chain: '#FF9CF2' };

const fireballs = new Map();
function fireball(kind, rad, k, reduced, dpr) {
  const key = `${kind}|${rad}|${k}|${reduced ? 1 : 0}|${dpr}`;
  let f = fireballs.get(key);
  if (f !== undefined) return f;
  const big = kind === 'big';
  const p = SP;
  const grow = reduced ? 0.85 : Math.min(1, 0.4 + Math.sqrt(k / 0.3) * 0.6);
  const R = rad * (big ? 0.7 : 0.64) * grow * (reduced ? 1 : 1 - Math.max(0, k - 0.6) * 0.5);
  const m = Math.ceil(R / p) + 1;
  const cool = reduced ? 0.6 : k * 3.2;
  const lift = reduced ? 0 : Math.max(0, k - 0.4) * rad * 0.35;
  const ramp = FIRE[kind] || FIRE.shot;
  const top = ramp.length - 1;
  const iR = p / R;
  const ax = (m + 1) * p, ay = (m + 1) * p + snap(lift, p);
  const w = ax * 2, h = ay + (m + 1) * p;
  const cv = makeCanvas(w * dpr, h * dpr);
  f = null;
  if (cv) {
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const ox = ax, oy = ay;
  let last = '';
  for (let gy = -m; gy < m; gy++) {
    const ly = snap(lift * Math.max(0, 1 - Math.abs(gy) / m), p);
    for (let gx = -m; gx < m; gx++) {
      const ex = gx + 0.5, ey = gy + 0.5;
      const d = Math.hypot(ex, ey);
      const lump = 1 + 0.12 * Math.sin(Math.atan2(ey, ex) * 5 + 1.3) + 0.07 * Math.cos(gx * 0.9 + gy * 0.6) + ((hash(gx, gy, 17) % 10) - 5) / 70;
      const e = (d * iR) / lump;
      if (e > 1) continue;
      if (k > 0.45 && !reduced && hash(gx, gy, 41) % 100 < (k - 0.45) * 150 * (0.4 + e)) continue;
      // heat falls off from the centre; the lower right is in shadow, the upper left catches the core
      const lit = ((ex + ey) / (m * 1.4)) * 0.9;
      const v = e * e * 4 + e * 2.6 + lit + cool;
      let idx = Math.floor(v);
      if ((v - idx) > 0.6 && (gx + gy) % 2 === 0) idx++;
      // the smoke rim, thicker on the shadow side
      if (e > (lit > 0 ? 0.86 : 0.93)) idx = Math.max(idx, top - (e > 0.95 ? 0 : 1));
      idx = Math.max(0, Math.min(top, idx));
      const fill = ramp[idx];
      if (fill !== last) { c.fillStyle = fill; last = fill; }
      c.fillRect(ox + gx * p, oy + gy * p - ly, p, p);
    }
  }
  f = { cv, w, h, ax, ay };
  }
  if (fireballs.size > 160) fireballs.delete(fireballs.keys().next().value);
  fireballs.set(key, f);
  return f;
}

/**
 * A burst in the sky. The dotted ring is the full reach and stays for the whole life; the fireball
 * inside it is a lumpy ball of heat that swells fast, cools from the outside in and breaks up into
 * smoke. A tight flash only in the first frames (no glow over the sky).
 */
export function drawBurst(c, x, y, rad, k, o = {}) {
  const { kind = 'shot', reduced = false } = o;
  const heat = HEAT[kind] || HEAT.shot;
  const big = kind === 'big';
  const p = SP;
  const ox = snap(x, p), oy = snap(y, p);
  if (!reduced && k < 0.12) drawGlow(c, x, y, rad * 0.8, big ? '#9FFFF0' : kind === 'chain' ? '#FF90C0' : '#FFD080', 0.85 * (1 - k / 0.12));
  // the fireball: white-hot core, then the kind's hot bands, a red edge and a dark smoke rim; lit from
  // the upper left, band edges dithered, cooling from the outside in and lifting as it dies
  // the fireball, drawn per cell once for each of 24 steps of its life and then copied
  const kq = reduced ? 0 : Math.round(k * 24) / 24;
  const T = c.getTransform ? c.getTransform() : null;
  const sc = T ? Math.round(Math.hypot(T.a, T.b) * 100) / 100 || 1 : 1;
  const fb = fireball(kind, Math.round(rad), kq, reduced, sc);
  if (fb) {
    const sm = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    c.drawImage(fb.cv, ox - fb.ax, oy - fb.ay, fb.w, fb.h);
    c.imageSmoothingEnabled = sm;
  }
  c.globalAlpha = 1;
  if (!reduced) {
    // a thin white shock ring racing out to the reach, then a fainter echo for a big one
    for (let s = 0; s < (big ? 2 : 1); s++) {
      const kk = (k - s * 0.08) / 0.32;
      if (kk <= 0 || kk >= 1) continue;
      const sr = rad * (0.25 + 0.75 * (1 - (1 - kk) * (1 - kk)));
      const n = Math.max(16, Math.round((Math.PI * 2 * sr) / 3));
      c.globalAlpha = (1 - kk) * (s ? 0.5 : 0.9);
      c.fillStyle = s ? heat[1] : PAL.white;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * Math.PI * 2;
        c.fillRect(snap(x + Math.cos(an) * sr, 2) - 1, snap(y + Math.sin(an) * sr, 2) - 1, 2, 2);
      }
    }
    // embers flung out, stopping short of the reach
    const ne = big ? 16 : 10;
    for (let i = 0; i < ne; i++) {
      const an = (hash(i, 5, 9) % 628) / 100, v = 0.55 + (hash(i, 6, 9) % 40) / 100;
      const q = 1 - (1 - Math.min(1, k * 1.6)) ** 2;
      const d = rad * v * q;
      c.globalAlpha = Math.max(0, 1 - k * 1.2);
      c.fillStyle = k < 0.2 ? PAL.white : k < 0.45 ? heat[1] : heat[2];
      const s = k < 0.35 ? 3 : 2;
      c.fillRect(snap(x + Math.cos(an) * d, 1), snap(y + Math.sin(an) * d + k * k * rad * 0.3, 1), s, s);
    }
    // smoke puffs lifting off as it dies
    if (k > 0.5) {
      const q = (k - 0.5) * 2;
      for (let i = 0; i < 7; i++) {
        const an = (hash(i, 7, 11) % 628) / 100, d = rad * (0.15 + (hash(i, 3, 5) % 45) / 100);
        const s = rad * (0.12 + q * 0.06);
        drawPuff(c, x + Math.cos(an) * d, y + Math.sin(an) * d - q * rad * 0.45, s, 0.25 + q * 0.75, SMOKE_RAMP.mid, i);
      }
    }
  }
  // the full reach, as a dotted ring with a dark edge so it reads on fire and on sky
  const ra = k < 0.8 ? 1 : Math.max(0, (1 - k) / 0.2);
  const dots = Math.max(12, Math.round((Math.PI * 2 * rad) / 10));
  const rot = reduced ? 0 : k * 0.5;
  const rc = RING[kind] || RING.shot;
  for (let pass = 0; pass < 2; pass++) {
    c.globalAlpha = ra * (pass ? 0.95 : 0.55);
    c.fillStyle = pass ? rc : PAL.outline;
    const s = pass ? 3 : 5;
    for (let i = 0; i < dots; i++) {
      const an = rot + (i / dots) * Math.PI * 2;
      c.fillRect(snap(x + Math.cos(an) * rad, 1) - s / 2 - 0.5, snap(y + Math.sin(an) * rad, 1) - s / 2 - 0.5, s, s);
    }
  }
  c.globalAlpha = 1;
}

const RUBBLE = [[[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[1, 0], [1, 1], [0, 1]], [[0, 0], [0, 1], [1, 1]]];

/** A meteor reaching the ground: a dome of fire that lifts into a cap, a flat shock along the ground, rubble. */
export function drawGroundBlast(c, x, ground, k, o = {}) {
  const { reduced = false, size = 40 } = o;
  const p = SP;
  if (!reduced && k < 0.12) drawGlow(c, x, ground - size * 0.3, size * 1.5, '#FFB050', 0.9 * (1 - k / 0.12));
  const R = size * (reduced ? 0.8 : 0.45 + Math.sqrt(k) * 0.65);
  const lift = reduced ? 0 : Math.max(0, k - 0.25) * size * 0.9;
  const m = Math.ceil(R / p) + 1;
  const ox = snap(x, p), oy = snap(ground, p);
  const cool = reduced ? 0.3 : k * 2.2;
  for (let gy = -m * 2; gy < 1; gy++) {
    for (let gx = -m; gx < m; gx++) {
      const ex = gx + 0.5, ey = gy + 0.5;
      // the cap (a ball lifting off) and the stem under it
      const cy = -lift / p - (lift > 0 ? m * 0.45 : 0);
      const dc = Math.hypot(ex, (ey - cy) * 1.15) * p / R;
      const stem = lift > 0 && ey > cy && Math.abs(ex) * p < R * (0.28 + 0.3 * (ey - cy) / Math.max(1, -cy)) ? Math.abs(ex) * p / (R * 0.5) + 0.25 : 9;
      let e = Math.min(dc * (1 + ((hash(gx, gy, 23) % 10) - 5) / 50), stem);
      if (e > 1) continue;
      if (k > 0.5 && !reduced && hash(gx, gy, 5) % 100 < (k - 0.5) * 160 * (0.5 + e)) continue;
      const idx = Math.min(4, Math.floor(e * 2.4 + cool - 0.3 + ((ex + ey) > 0 ? 0.4 : 0)));
      c.globalAlpha = idx >= 4 ? 0.7 : 1;
      c.fillStyle = HEAT.shot[Math.max(0, idx)];
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  c.globalAlpha = 1;
  if (!reduced) {
    // a flat shock running along the ground both ways
    if (k < 0.5) {
      const q = k / 0.5, sw = size * (0.6 + q * 1.6);
      c.globalAlpha = 1 - q;
      c.fillStyle = PAL.white;
      c.fillRect(snap(x - sw, 2), snap(ground - 2, 2), 6, 2); c.fillRect(snap(x + sw - 6, 2), snap(ground - 2, 2), 6, 2);
      c.fillStyle = PAL.yellow;
      c.fillRect(snap(x - sw + 6, 2), snap(ground - 2, 2), 8, 2); c.fillRect(snap(x + sw - 14, 2), snap(ground - 2, 2), 8, 2);
    }
    // rubble thrown up and falling back: dark chunks with hot edges
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * (0.1 + 0.8 * (i / 9)) + ((hash(i, 2, 7) % 20) - 10) / 100;
      const v = 1.2 + (hash(i, 3, 7) % 60) / 100;
      const px = x + Math.cos(a) * size * v * k;
      const py = ground - Math.sin(a) * size * 2.2 * v * k + size * 3 * k * k;
      if (py > ground + 2) continue;
      // an irregular chunk of 2-3 cells that turns as it flies and crumbles near the end
      const q = i % 3 === 0 ? 3 : 2;
      const turn = reduced ? 0 : (Math.floor(k * 18) + i) & 3;
      const left = k < 0.55 ? 3 : k < 0.75 ? 2 : k < 0.9 ? 1 : 0;
      const X = snap(px, 2), Y = snap(py, 2);
      for (let j = 0; j < left; j++) {
        const [cx, cy] = RUBBLE[turn][j];
        c.fillStyle = k < 0.15 ? PAL.yellow : k < 0.3 && j === 0 ? PAL.orange : j === 2 ? PAL.outline : i % 2 ? '#5A4E5E' : '#3B2F2B';
        c.fillRect(X + cx * q, Y + cy * q, q, q);
      }
    }
  }
  c.globalAlpha = 1;
}

/** A red target mark on the ground where a low meteor is going to land (k: 0..1, how close). */
export function drawDanger(c, x, ground, k, o = {}) {
  const { anim = 0, reduced = false } = o;
  const on = reduced || Math.floor(anim * (4 + k * 6)) % 2 === 0;
  const a = 0.45 + 0.55 * k;
  const g = snap(10 + (1 - k) * 8, 2), X = snap(x, 2), Y = snap(ground - 4, 2);
  c.globalAlpha = on ? a : a * 0.45;
  c.fillStyle = PAL.outline;
  c.fillRect(X - g - 2, Y - 2, 8, 6); c.fillRect(X + g - 6, Y - 2, 8, 6);
  c.fillStyle = PAL.nose;
  c.fillRect(X - g, Y, 6, 2); c.fillRect(X - g, Y - 4, 2, 6);
  c.fillRect(X + g - 6, Y, 6, 2); c.fillRect(X + g - 2, Y - 4, 2, 6);
  // a down arrow
  c.fillRect(X - 3, Y - 16, 6, 2); c.fillRect(X - 1, Y - 14, 2, 2);
  c.globalAlpha = 1;
}

export function drawBase(c, x, ground, H, o = {}) {
  const { aim = 0, anim = 0, reduced = false, col = {}, empty = false, flash = 0, recoil = 0, charge = false, ammo = -1, ammoMax = 0 } = o;
  const p = 3;
  const X = snap(x, p), G = snap(ground, p);
  const city = col.city || '#262245';
  // a big rocket ready: a small teal glow around the turret
  if (charge) drawGlow(c, X, G - p * 6, p * 11, '#62D2C5', reduced ? 0.42 : 0.32 + 0.16 * Math.sin(anim * 5));
  // the barrel: twin rails that turn to where the last rocket went and kick back when it fires
  c.save();
  c.translate(X, G - p * 3);
  c.rotate(Math.max(-1.2, Math.min(1.2, aim)));
  if (!reduced && recoil > 0) c.translate(0, Math.round(recoil * p * 2.5));
  c.fillStyle = PAL.outline; c.fillRect(-p * 2 - 1, -p * 11 - 1, p * 4 + 2, p * 11 + 2);
  c.fillStyle = PAL.shade; c.fillRect(-p * 2, -p * 10, p * 4, p * 10);
  c.fillStyle = PAL.steel; c.fillRect(-p * 2, -p * 10, p, p * 10);
  c.fillStyle = '#5A6A88'; c.fillRect(-p / 2, -p * 10, p, p * 10);
  // a rocket waiting in the rails
  if (!empty) { c.fillStyle = charge ? PAL.yellow : PAL.nose; c.fillRect(-p / 2, -p * 10, p, p * 2); }
  // coil bands that glow when charged
  const coil = charge ? (reduced || Math.floor(anim * 6) % 2 ? PAL.glow : PAL.teal) : '#3E8A92';
  c.fillStyle = coil; c.fillRect(-p * 2, -p * 4, p * 4, p); c.fillRect(-p * 2, -p * 7, p * 4, p);
  c.fillStyle = empty ? PAL.red : charge ? PAL.yellow : PAL.teal; c.fillRect(-p * 2, -p * 11, p * 4, p);
  if (flash > 0 && !reduced) {
    const f = Math.min(1, flash * 1.5);
    c.globalAlpha = f;
    c.fillStyle = PAL.orange; c.fillRect(-p * 3, -p * 13, p * 6, p * 2);
    c.fillStyle = PAL.yellow; c.fillRect(-p * 2, -p * 15, p * 4, p * 4);
    c.fillStyle = PAL.white; c.fillRect(-p, -p * 17, p * 2, p * 6);
    c.fillRect(-p * 4, -p * 13, p, p); c.fillRect(p * 3, -p * 13, p, p);
    c.fillStyle = PAL.orange; c.fillRect(-p * 5, -p * 15, p, p); c.fillRect(p * 4, -p * 15, p, p);
    c.globalAlpha = 1;
  }
  c.restore();
  // the turret dome
  const dome = [[3, 0], [4, 1], [5, 2], [6, 3]];
  for (const [half, j] of dome) {
    const yy = G - p * 4 + j * p;
    c.fillStyle = PAL.outline; c.fillRect(X - half * p - 1, yy - (j === 0 ? 1 : 0), half * 2 * p + 2, p + 1);
    c.fillStyle = j === 0 ? PAL.steel : '#5A6A88'; c.fillRect(X - half * p, yy, half * 2 * p, p);
    c.fillStyle = PAL.shade; c.fillRect(X - half * p + p, yy, (half * 2 - 2) * p, p);
    c.fillStyle = PAL.steel; c.fillRect(X + (half - 2) * p, yy, p, p);
  }
  // the bunker under it, down to the bottom of the field
  const bw = 8 * p;
  c.fillStyle = PAL.outline; c.fillRect(X - bw - 1, G, bw * 2 + 2, H - G);
  c.fillStyle = city; c.fillRect(X - bw, G, bw * 2, H - G);
  c.fillStyle = '#3A3466'; c.fillRect(X + bw - p, G, p, H - G);
  c.fillStyle = '#16121E'; c.fillRect(X - bw, G, p, H - G);
  c.fillStyle = PAL.teal; c.fillRect(X - bw, G, bw * 2, 2);
  // the ammo rack: one light per rocket; the last two glow orange, then blink red
  if (ammoMax > 0 && ammo >= 0) {
    const step = 4, pw = 3, tw = ammoMax * step - 1, x0 = X - Math.round(tw / 2);
    const low = ammo <= 2;
    const blink = reduced || Math.floor(anim * 4) % 2 === 0;
    for (let i = 0; i < ammoMax; i++) {
      const full = i < ammo;
      c.fillStyle = !full ? '#2A2440' : low ? (ammo <= 1 && !blink ? PAL.ember : ammo <= 1 ? PAL.red : PAL.orange) : PAL.glow;
      c.fillRect(x0 + i * step, G + p * 2, pw, p * 2);
    }
  }
  // a status light
  const lit = reduced || Math.floor(anim * 2) % 2 === 0;
  c.fillStyle = empty ? (lit ? PAL.red : PAL.ember) : (lit ? PAL.glow : PAL.teal);
  c.fillRect(X - p / 2, G - p, p, p);
}

export function sparks(list, x, y, n = 8, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (o.speed || 90) * (0.4 + Math.random() * 0.8);
    list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, life: 0.45 + Math.random() * 0.35, s: Math.random() < 0.4 ? 4 : 3 });
  }
  if (list.length > 120) list.splice(0, list.length - 120);
}

export function stepSparks(list, dt) {
  for (const s of list) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 220 * dt; }
  return list.filter((s) => s.t < s.life);
}

export function drawSparks(c, list) {
  for (const s of list) {
    const k = s.t / s.life;
    c.globalAlpha = Math.max(0, 1 - k * k);
    c.fillStyle = k < 0.25 ? PAL.white : k < 0.5 ? PAL.yellow : k < 0.8 ? PAL.orange : PAL.red;
    c.fillRect(snap(s.x, 2), snap(s.y, 2), s.s, s.s);
  }
  c.globalAlpha = 1;
}

// ---- smoke puffs ------------------------------------------------------------------------------------

/** Smoke ramps, light to dark, four steps each. */
export const SMOKE_RAMP = {
  light: ['#E2DEEE', '#B8B4CC', '#8E8AA6', '#6E6A86'],
  mid: ['#9A96B2', '#6E6A86', '#55516C', '#3E3A52'],
  dark: ['#5E586E', '#443E56', '#332E44', '#252036'],
  fire: ['#7A4A3A', '#4A2E3A', '#3A3450', '#4A465E'],
};

/**
 * One hard-edged smoke puff of size s at (X, Y), k = 0..1 of its life: a rounded block with a lit top
 * edge and a shaded underside, stepping down the ramp as it ages, then breaking into a thinning checker
 * of cells. No alpha anywhere. ph: a small integer that varies the break-up.
 */
export function drawPuff(c, X, Y, s, k, ramp, ph = 0) {
  s = Math.max(4, snap(s, 2));
  const st = Math.min(3, Math.floor(k * 3.4));
  const body = ramp[st], hi = ramp[Math.max(0, st - 1)], lo = ramp[Math.min(3, st + 1)];
  const x0 = snap(X - s / 2, 2), y0 = snap(Y - s / 2, 2);
  c.globalAlpha = 1;
  if (k < 0.55) {
    c.fillStyle = body;
    c.fillRect(x0, y0 + 2, s, s - 4);
    c.fillRect(x0 + 2, y0, s - 4, s);
    if (s >= 8) {
      c.fillStyle = lo;
      c.fillRect(x0 + 2, y0 + s - 2, s - 4, 2);
      c.fillRect(x0 + s - 2, y0 + 4, 2, s - 6);
      c.fillStyle = hi;
      c.fillRect(x0 + 2, y0, snap(s / 2, 2), 2);
      c.fillRect(x0, y0 + 2, 2, snap(s / 3, 2) || 2);
    }
    return;
  }
  // fading: the same rounded shape as an ordered dither that thins out (a checker, then one cell in four)
  const w = s > 14 ? 4 : 2;
  const n = Math.max(2, Math.round(s / w));
  const sparse = k > 0.78;
  const o = ph & 1;
  c.fillStyle = body;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      if ((gx === 0 || gx === n - 1) && (gy === 0 || gy === n - 1)) continue;
      if (sparse ? ((gx + o) % 2 || (gy + o) % 2) : (gx + gy + o) % 2) continue;
      c.fillRect(x0 + gx * w, y0 + gy * w, w, w);
    }
  }
}

// ---- the backdrop: big stars, shooting stars, the moon ------------------------------------------------

const BIG_STARS = [[0.12, 0.1, 0], [0.33, 0.24, 1.3], [0.58, 0.07, 2.2], [0.9, 0.36, 3.1], [0.22, 0.47, 4.4], [0.7, 0.52, 5.2], [0.46, 0.32, 0.7]];

// the moon (a crescent with its dark side faintly showing) and a dithered halo, drawn once per scale
const moons = new Map();
function moonSprite(dpr) {
  let s = moons.get(dpr);
  if (s !== undefined) return s;
  const p = 3, m = 7, hr = m + 5;
  const S = (hr * 2 + 2) * p;
  const cv = makeCanvas(S * dpr, S * dpr);
  s = null;
  if (cv) {
    const x = cv.getContext('2d');
    x.scale(dpr, dpr);
    const c0 = S / 2;
    for (let gy = -hr; gy < hr; gy++) {
      for (let gx = -hr; gx < hr; gx++) {
        const ex = gx + 0.5, ey = gy + 0.5;
        const d = Math.hypot(ex, ey);
        const X = c0 + gx * p, Y = c0 + gy * p;
        if (d > m) {
          // the halo: denser near the moon, thinning out
          // a clean round ring: a checker of pale cells hugging the disc, then a sparser outer ring
          const g = d - m;
          let a = 0;
          if (g < 2.2) a = (gx + gy) % 2 === 0 ? 0.26 : 0.12;
          else if (g < 3.6) a = (gx + gy) % 2 === 0 ? 0.1 : 0;
          else if (g < 4.6) a = gx % 2 === 0 && gy % 2 === 0 ? 0.07 : 0;
          if (!a) continue;
          x.globalAlpha = a;
          x.fillStyle = g < 2.2 ? '#F3ECCB' : '#C8C0F0';
          x.fillRect(X, Y, p, p);
          continue;
        }
        x.globalAlpha = 1;
        const shadow = Math.hypot(ex - m * 0.5, ey + m * 0.28) < m * 0.88;
        if (shadow) {
          x.fillStyle = d > m - 1 ? '#3E3A68' : '#2C2A54';
          x.fillRect(X, Y, p, p);
          continue;
        }
        const rim = d > m - 1.1;
        const crater = hash(gx, gy, 9) % 6 === 0 || Math.hypot(ex + 3, ey - 1.5) < 1.4 || Math.hypot(ex + 1, ey + 3.5) < 1;
        x.fillStyle = rim ? '#FFFBEA' : crater ? PAL.moonDark : PAL.moon;
        x.fillRect(X, Y, p, p);
      }
    }
    x.globalAlpha = 1;
    s = { cv, S };
  }
  moons.set(dpr, s);
  return s;
}

/** Big stars, now and then a shooting star, then the moon (in front of the stars, behind clouds). */
export function drawBackdrop(c, W, ground, o = {}) {
  const { anim = 0, reduced = false, dpr = 1 } = o;
  // a few big stars that twinkle as little crosses
  c.fillStyle = PAL.white;
  for (const [fx, fy, ph] of BIG_STARS) {
    const X = snap(fx * W, 2), Y = snap(fy * ground, 2);
    const tw = reduced ? 0.6 : Math.sin(anim * 1.8 + ph);
    const on = tw > -0.2;
    c.globalAlpha = on ? 0.95 : 0.5;
    c.fillRect(X, Y, 2, 2);
    if (on) {
      c.globalAlpha = 0.55;
      c.fillRect(X - 2, Y, 2, 2); c.fillRect(X + 2, Y, 2, 2); c.fillRect(X, Y - 2, 2, 2); c.fillRect(X, Y + 2, 2, 2);
      if (tw > 0.85) { c.globalAlpha = 0.3; c.fillRect(X - 4, Y, 2, 2); c.fillRect(X + 4, Y, 2, 2); c.fillRect(X, Y - 4, 2, 2); c.fillRect(X, Y + 4, 2, 2); }
    }
  }
  // now and then a shooting star, far away
  if (!reduced) {
    const every = 9, life = 0.8, n = Math.floor(anim / every), q = (anim - n * every) / life;
    if (q < 1 && n > 0) {
      const sx = (0.12 + (hash(n, 1, 2) % 60) / 100) * W, sy = (0.04 + (hash(n, 2, 3) % 22) / 100) * ground;
      const dir = hash(n, 3, 4) % 2 ? 1 : -1;
      const cols = [PAL.white, PAL.white, '#E8F4FF', '#B8C8F0', '#8C96D0', '#6A70B0', '#50548E', '#3E4078'];
      for (let i = 0; i < cols.length; i++) {
        const d = q * 170 - i * 6;
        if (d < 0) continue;
        c.globalAlpha = (1 - q * q) * (1 - i / (cols.length + 1));
        c.fillStyle = cols[i];
        c.fillRect(snap(sx + dir * d, 2), snap(sy + d * 0.42, 2), i === 0 ? 3 : 2, i === 0 ? 3 : 2);
      }
    }
  }
  c.globalAlpha = 1;
  // the moon and its halo
  const ms = moonSprite(dpr);
  const mx = snap(W * 0.83, 3), my = snap(Math.max(34, ground * 0.13), 3);
  if (ms) {
    const sm = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    c.drawImage(ms.cv, mx - ms.S / 2, my - ms.S / 2, ms.S, ms.S);
    c.imageSmoothingEnabled = sm;
  }
}

// ---- fire and smoke over damaged towns -------------------------------------------------------------

const FLAME_OUT = [PAL.yellow, PAL.orange, PAL.orange, PAL.red, PAL.red, PAL.ember];
const FLAME_IN = [PAL.white, PAL.white, PAL.yellow, PAL.yellow, PAL.orange, PAL.orange];

/** One tongue of flame standing on (x, y): tapering, swaying, white-hot inside, red at the tips. */
function flame(c, x, y, w, h, anim, reduced, seed) {
  const q = 2;
  const flick = reduced ? 1 : 0.78 + 0.16 * Math.sin(anim * 9 + seed * 1.7) + 0.08 * ((hash(Math.floor(anim * 12), seed, 31) % 3) - 1);
  const rows = Math.max(3, Math.round((h * flick) / q));
  for (let j = 0; j < rows; j++) {
    const f = j / rows;
    const half = Math.max(1, (w / 2) * (1 - f) ** 0.75);
    const sway = reduced ? 0 : Math.sin(anim * 7 + seed + j * 0.55) * f * 3;
    const cx = x + sway;
    const ci = Math.min(5, Math.floor(f * 6));
    c.fillStyle = FLAME_OUT[ci];
    c.fillRect(snap(cx - half, q), y - (j + 1) * q, Math.max(q, snap(half * 2, q)), q);
    if (f < 0.7 && half > 2) {
      c.fillStyle = FLAME_IN[ci];
      const ih = Math.max(1, half * 0.45);
      c.fillRect(snap(cx - ih, q), y - (j + 1) * q, Math.max(q, snap(ih * 2, q)), q);
    }
  }
  // a lick that breaks off the tip
  if (!reduced) {
    const ph = (anim * 2.2 + seed * 0.37) % 1;
    c.globalAlpha = 1 - ph;
    c.fillStyle = ph < 0.4 ? PAL.orange : PAL.red;
    c.fillRect(snap(x + Math.sin(seed + anim * 5) * 3, q), snap(y - rows * q - 2 - ph * h * 0.6, q), q, q);
    c.globalAlpha = 1;
  }
}

/** A smoke column: clustered puffs rising and drifting, dark near the fire, thinning out as they rise. */
function smokeColumn(c, x, y, o) {
  const { anim = 0, reduced = false, n = 7, height = 60, size = 1, seed = 0 } = o;
  const count = reduced ? 3 : n;
  for (let i = 0; i < count; i++) {
    const ph = reduced ? 0.15 + i * 0.28 : (anim * 0.22 + i / count + seed * 0.13) % 1;
    const s = snap((4 + ph * 10) * size, 2);
    const X = snap(x + ph * height * 0.35 + Math.sin(i * 1.9 + ph * 4 + seed) * 3, 2);
    const Y = snap(y - ph * height, 2);
    drawPuff(c, X, Y, s, ph, ph < 0.18 ? SMOKE_RAMP.fire : SMOKE_RAMP.dark, i + seed);
  }
  c.globalAlpha = 1;
}

/** Fire over a town: hp 1 (damaged) a small fire and a smoke column, hp 0 (ruined) every building burning. */
export function drawTownFire(c, cx, base, tw, tall, o = {}) {
  const { anim = 0, reduced = false, hp = 0, seed = 0 } = o;
  const ruined = hp === 0;
  const factor = ruined ? 0.3 : 0.75;
  // the warm light of the fire on the ground
  drawGlow(c, cx, base - tall * (ruined ? 0.12 : 0.4), tw * (ruined ? 0.6 : 0.3),
    '#FF5A1A', reduced ? 0.3 : (ruined ? 0.3 : 0.2) + 0.06 * Math.sin(anim * 11 + seed) + 0.04 * Math.sin(anim * 23));
  const tops = TOWN_SHAPE.map(([dx, bw0, hg], b) => ({
    x: cx + dx * tw / 0.2 + (bw0 * tw / 0.2) / 2, w: bw0 * tw / 0.2, y: base - tall * hg * factor + (ruined ? 6 : 4), b,
  }));
  const burning = ruined ? tops : tops.filter(t => hash(seed, t.b, 3) % 5 < 1 || t.b === 1);
  // smoke first (behind the flames)
  const smokeFrom = ruined ? [burning[1], burning[3]] : [burning[0]];
  smokeFrom.forEach((t, j) => t && smokeColumn(c, t.x, t.y - 8, { anim, reduced, n: ruined ? 7 : 6, height: ruined ? 70 : 55, size: ruined ? 1.2 : 1, seed: seed * 3 + j }));
  for (const t of burning) {
    const n = Math.max(1, Math.round(t.w / (ruined ? 7 : 10)));
    for (let i = 0; i < n; i++) {
      const fx = t.x - t.w / 2 + ((i + 0.5) / n) * t.w;
      const hgt = (ruined ? 12 : 8) + (hash(seed, t.b * 7 + i, 5) % 7) * (ruined ? 1.4 : 0.8);
      flame(c, fx, snap(t.y, 2), Math.max(6, (t.w / n) * 1.2), hgt, anim, reduced, seed * 11 + t.b * 5 + i);
    }
  }
  if (ruined) {
    // small fires and hot coals in the rubble between the buildings
    for (let i = 0; i < 4; i++) {
      const fx = cx + (((hash(seed, i, 61) % 100) / 100) - 0.5) * tw * 0.9;
      flame(c, fx, base - 2, 6, 6 + (hash(seed, i, 62) % 4) * 2, anim, reduced, seed * 13 + i + 40);
    }
    for (let i = 0; i < 10; i++) {
      const rx = cx + (((hash(seed, i, 71) % 100) / 100) - 0.5) * tw;
      const glow = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(anim * 3 + i * 1.3);
      c.globalAlpha = glow;
      c.fillStyle = glow > 0.75 ? PAL.yellow : PAL.orange;
      c.fillRect(snap(rx, 2), snap(base - 2 - (hash(seed, i, 72) % 6), 2), 2, 2);
    }
    c.globalAlpha = 1;
  }
  // embers rising off the fire
  if (!reduced) {
    const ne = ruined ? 9 : 4;
    for (let i = 0; i < ne; i++) {
      const t = burning[i % burning.length];
      const ph = (anim * 0.45 + i * 0.173 + seed * 0.29) % 1;
      const ex = t.x + Math.sin(ph * 7 + i * 2.1) * 5 + ph * 12;
      const ey = t.y - 6 - ph * (ruined ? 55 : 35);
      c.globalAlpha = (1 - ph) * (0.6 + 0.4 * Math.sin(anim * 17 + i));
      c.fillStyle = ph < 0.3 ? PAL.yellow : ph < 0.65 ? PAL.orange : PAL.red;
      c.fillRect(snap(ex, 2), snap(ey, 2), 2, 2);
    }
    c.globalAlpha = 1;
  }
}

/** A smoke column on its own (and fire: true, a few flames at its foot). */
export function drawSmoke(c, x, y, o = {}) {
  const { anim = 0, reduced = false, fire = false } = o;
  smokeColumn(c, x, y, { anim, reduced });
  if (fire) for (let i = -1; i <= 1; i++) flame(c, x + i * 6, y, 6, 10, anim, reduced, i + 3);
}

const popupY = q => q.y - 14 - (1 - (1 - q.t / 0.9) ** 2) * 30;

/** A points popup; stacked above any live popup it would overlap, so two never print on each other. */
export function popup(list, x, y, text, o = {}) {
  const half = (text.length * 6 * 3) / 2 + 6;
  for (let tries = 0; tries < 6; tries++) {
    const clash = list.find(q => Math.abs(q.x - x) < half + (q.text.length * 9) && Math.abs(popupY(q) - (y - 14)) < 24);
    if (!clash) break;
    y = popupY(clash) + 14 - 26;
  }
  list.push({ x, y, t: 0, text, hot: !!o.hot });
  if (list.length > 12) list.shift();
}

export function stepPopups(list, dt) {
  for (const q of list) q.t += dt;
  return list.filter((q) => q.t < 0.9);
}

export function drawPopups(c, list) {
  for (const q of list) {
    const k = q.t / 0.9;
    const X = Math.round(q.x), Y = Math.round(popupY(q));
    const base = q.hot ? 3 : 2;
    const scale = q.t < 0.08 ? base + 1 : base;
    drawText(c, q.text, X, Y, scale, q.hot ? POP_HOT : POP, Math.max(0, 1 - k * k * k));
  }
  c.globalAlpha = 1;
}
