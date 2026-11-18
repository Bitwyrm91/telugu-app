// game/sprites.js: chunky pixel-style drawing for the game's moving things (both modes). Everything
// is drawn with small squares on the 2D canvas; nothing here knows the rules. `reduced` (reduced
// motion) turns off flicker, wobble and flying bits.
//
//   drawMeteor(c, x, y, r, ux, uy, o)   o: {anim, reduced, kind: 'rock'|'split'|'kid'|'boss', seed, col}
//   drawRocket(c, x0, y0, x, y, o)      o: {anim, reduced, big}   (x0,y0 = where it came from)
//   drawMark(c, x, y, o)                where a rocket is going
//   drawBurst(c, x, y, rad, k, o)       k = 0..1 of its life; o: {kind: 'shot'|'big'|'chain', reduced}
//   drawGroundBlast(c, x, ground, k, o) a meteor reaching the ground
//   drawBase(c, x, ground, H, o)        the launcher; o: {aim (radians, 0 = up), anim, reduced, col, empty}
//   sparks(list, x, y, n) / stepSparks(list, dt) / drawSparks(c, list)
//   drawBackdrop(c, W, ground, o)       moon, big stars, now and then a shooting star
//   drawSmoke(c, x, y, o)               smoke (and fire: true, flames) over a damaged town
//   popup(list, x, y, text, o) / stepPopups(list, dt) / drawPopups(c, list)   points floating up

export const PAL = {
  white: '#FFF7E0', yellow: '#FFD23F', orange: '#FF8A1F', red: '#E23D3D', ember: '#8C2B3A',
  smoke: '#6E6A86', steel: '#E6EEF8', shade: '#93A6C4', teal: '#62D2C5', nose: '#FF5D5D', glow: '#B8FFF4',
  rockLight: '#8A7468', rockDark: '#3B2F2B', outline: '#1A1222', moon: '#F3ECCB', moonDark: '#CFC59A', bossLight: '#A85C7E', bossDark: '#4E2439',
};

import { snap, hash, drawGlow, drawText } from './pixel.js';

const POP = ['#FFF7E0', '#FFD23F', '#FF8A1F', '#1A1222'];
const POP_HOT = ['#FFF7E0', '#FF8A1F', '#E23D3D', '#1A1222'];

const TAIL = {
  rock: [PAL.white, PAL.yellow, PAL.orange, PAL.red, PAL.ember],
  kid: [PAL.white, PAL.white, PAL.yellow, PAL.orange, PAL.red],
  split: [PAL.white, '#FF9CF2', '#E050C8', '#9A2A9A', '#4E1A5A'],
};

/**
 * o: {anim, reduced, kind: 'rock'|'split'|'kid'|'boss', seed, col, charge (0..1: how close a split
 * meteor is to breaking)}
 */
export function drawMeteor(c, x, y, r, ux, uy, o = {}) {
  const { anim = 0, reduced = false, kind = 'rock', seed = 1, col = {}, charge = 0 } = o;
  const p = Math.max(2, Math.round(r / 5));
  const special = kind === 'split' || kind === 'boss';
  const tail = TAIL[special ? 'split' : kind === 'kid' ? 'kid' : 'rock'];
  // a soft heat glow around the rock and up the tail
  drawGlow(c, x + ux * r * 0.8, y + uy * r * 0.8, r * 3, special ? '#D050E0' : '#FF8A30', 0.42);
  // the flame tail: two passes (a wide dim one, then a narrow hot one) of squares that shrink and cool
  const n = 10;
  const frame = reduced ? 0 : Math.floor(anim * 14);
  for (let pass = 0; pass < 2; pass++) {
    const wide = pass === 0;
    for (let i = n; i >= 1; i--) {
      const f = i / n;
      const wob = reduced ? 0 : Math.sin(anim * 18 + i * 1.7 + seed + pass) * r * 0.3 * f;
      const d = r * 0.5 + f * r * (wide ? 4.4 : 3.4);
      const size = Math.max(p, snap(r * (wide ? 2.3 : 1.5) * (1 - f * 0.8), p));
      const cx = x + ux * d - uy * wob, cy = y + uy * d + ux * wob;
      c.globalAlpha = wide ? 0.35 * (1 - f * 0.7) : 1 - f * 0.6;
      const hot = (i + frame) % 3 === 0;
      const band = Math.min(4, Math.floor(f * 5) + (wide ? 1 : 0));
      c.fillStyle = band === 0 && hot ? PAL.white : tail[Math.min(4, band + (hot && band > 0 ? -1 : 0))];
      c.fillRect(snap(cx - size / 2, p), snap(cy - size / 2, p), size, size);
    }
  }
  if (!reduced) {
    // embers shed along the tail
    for (let i = 0; i < 6; i++) {
      const ph = (anim * 1.3 + i * 0.37 + seed * 0.11) % 1;
      const d = r * (1.2 + ph * 5.2), side = Math.sin(i * 2.4 + seed) * r * (0.5 + ph * 0.9);
      c.globalAlpha = 1 - ph;
      c.fillStyle = i % 2 ? tail[1] : tail[2];
      c.fillRect(snap(x + ux * d - uy * side, 2), snap(y + uy * d + ux * side, 2), ph < 0.5 ? 3 : 2, ph < 0.5 ? 3 : 2);
    }
  }
  c.globalAlpha = 1;
  // the rock: a pixel disc with a dark outline, lit from the upper left, white-hot where it meets the
  // air; its craters turn as it tumbles (the light stays put)
  const base = special ? (col.boss || '#7A3E5A') : kind === 'kid' ? '#6E4A3A' : (col.rock || '#5B4A43');
  const light = special ? PAL.bossLight : PAL.rockLight;
  const dark = special ? PAL.bossDark : PAL.rockDark;
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
        // the rock turned back to its own frame
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
        else if (ex + ey < -m * 0.45) fill = light;
        else if (ex + ey > m * 0.7) fill = dark;
      }
      if (!fill) continue;
      c.fillStyle = fill;
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  if (kind === 'split') {
    // glowing cracks that get brighter as it nears the split height
    const k = Math.max(0, Math.min(1, charge));
    const pulse = reduced ? 0.8 : 0.65 + 0.35 * Math.sin(anim * (8 + k * 14));
    c.globalAlpha = 0.45 + 0.55 * k * pulse;
    for (let j = 0; j < 3; j++) {
      const a = spin + j * 2.1 + seed;
      const dx = Math.cos(a), dy = Math.sin(a);
      for (let s = -m + 1; s < m - 1; s++) {
        const bend = ((hash(j, s, seed) % 3) - 1) * 0.6;
        c.fillStyle = k > 0.7 && (s + frame) % 3 === 0 ? PAL.white : '#FF9CF2';
        c.fillRect(ox + snap((dx * s - dy * bend) * p, p), oy + snap((dy * s + dx * bend) * p, p), p, p);
      }
    }
    c.globalAlpha = 1;
    // two rings of squares turning against each other: this one breaks in two
    const turn = reduced ? 0 : anim * (1.5 + k * 3);
    for (let ring = 0; ring < 2; ring++) {
      const kk = ring ? 7 : 10, rad = r + p * (ring ? 3.5 : 2), dir = ring ? -1 : 1;
      c.fillStyle = ring ? '#FF9CF2' : (col.hurt || PAL.red);
      c.globalAlpha = ring ? 0.7 : 1;
      for (let i = 0; i < kk; i++) {
        const a = dir * turn + (i / kk) * Math.PI * 2;
        c.fillRect(snap(x + Math.cos(a) * rad - p / 2, 1), snap(y + Math.sin(a) * rad - p / 2, 1), p, p);
      }
    }
    c.globalAlpha = 1;
  } else if (kind === 'boss') {
    // shards in orbit around a boss
    const turn = reduced ? 0.4 : anim * 2.2;
    for (let i = 0; i < 4; i++) {
      const a = turn + (i / 4) * Math.PI * 2;
      const sx = snap(x + Math.cos(a) * r * 1.65, p), sy = snap(y + Math.sin(a) * r * 1.2, p);
      c.fillStyle = PAL.outline; c.fillRect(sx - p, sy - p, p * 3, p * 3);
      c.fillStyle = i % 2 ? PAL.bossLight : (col.boss || '#7A3E5A'); c.fillRect(sx - p / 2, sy - p / 2, p * 2, p * 2);
      c.fillStyle = '#FF9CF2'; c.fillRect(sx - p / 2, sy - p / 2, p, p);
    }
  }
}

const ROCKET = [
  '...N...',
  '..NNN..',
  '..WWS..',
  '..WTS..',
  '..WTS..',
  '..WWS..',
  '.FWWSF.',
  'FFWWSFF',
  'F.WWS.F',
];
const FLAMES = [['.YYY.', '.OYO.', '..O..'], ['.YYY.', '.YOY.', '.O.O.', '..O..'], ['.YYY.', '..Y..']];
const INK = { N: PAL.nose, W: PAL.steel, S: PAL.shade, T: PAL.teal, F: PAL.teal, Y: PAL.yellow, O: PAL.orange };

export function drawRocket(c, x0, y0, x, y, o = {}) {
  const { anim = 0, reduced = false, big = false, trail = true } = o;
  const p = big ? 4 : 3;
  const dx = x - x0, dy = y - y0;
  const len = Math.hypot(dx, dy) || 1;
  // the exhaust glow, then smoke puffs behind it (unless fx.js draws a real trail)
  drawGlow(c, x - (dx / len) * p * 6, y - (dy / len) * p * 6, p * (big ? 9 : 6), big ? '#9FFFF0' : '#FFB040', big ? 0.7 : 0.5);
  const puffs = trail || reduced ? (big ? 8 : 6) : 0, reach = Math.min(len, big ? 120 : 80);
  for (let i = 1; i <= puffs; i++) {
    const f = i / puffs;
    const size = snap(p * (1.5 + f * 3), p);
    const jx = reduced ? 0 : Math.sin(anim * 9 + i * 2.1) * 3 * f;
    c.globalAlpha = 0.6 * (1 - f);
    c.fillStyle = i % 2 ? PAL.steel : PAL.smoke;
    c.fillRect(snap(x - (dx / len) * (10 + reach * f) + jx - size / 2, p), snap(y - (dy / len) * (10 + reach * f) - size / 2, p), size, size);
  }
  c.globalAlpha = 0.22;
  c.fillStyle = big ? PAL.glow : PAL.yellow;
  const gs = p * (big ? 8 : 6);
  c.fillRect(snap(x - (dx / len) * p * 6 - gs / 2, p), snap(y - (dy / len) * p * 6 - gs / 2, p), gs, gs);
  c.globalAlpha = 1;
  c.save();
  c.translate(x, y);
  c.rotate(Math.atan2(dy, dx) + Math.PI / 2);
  const w = ROCKET[0].length, hgt = ROCKET.length;
  const left = -(w * p) / 2, top = -(hgt * p) / 2;
  ROCKET.forEach((row, j) => {
    for (let i = 0; i < w; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      c.fillStyle = big && ch === 'T' ? PAL.yellow : INK[ch];
      c.fillRect(left + i * p, top + j * p, p, p);
    }
  });
  const fl = FLAMES[reduced ? 0 : Math.floor(anim * 24) % FLAMES.length];
  fl.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '.') continue;
      c.fillStyle = INK[row[i]];
      c.fillRect(left + (i + 1) * p, top + (hgt + j) * p, p, p);
    }
  });
  c.restore();
}

export function drawMark(c, x, y, o = {}) {
  const { anim = 0, reduced = false, big = false } = o;
  const p = 2, g = reduced ? 4 : 4 + (Math.floor(anim * 6) % 2) * 2;
  c.fillStyle = big ? PAL.yellow : PAL.glow;
  const X = snap(x, p), Y = snap(y, p);
  c.fillRect(X - g - 4, Y - 1, 4, p); c.fillRect(X + g, Y - 1, 4, p);
  c.fillRect(X - 1, Y - g - 4, p, 4); c.fillRect(X - 1, Y + g, p, 4);
}

const HEAT = {
  shot: [PAL.white, PAL.yellow, PAL.orange, PAL.red],
  big: [PAL.white, PAL.glow, PAL.yellow, PAL.orange],
  chain: [PAL.yellow, PAL.orange, PAL.red, PAL.ember],
};

export function drawBurst(c, x, y, rad, k, o = {}) {
  const { kind = 'shot', reduced = false } = o;
  const heat = HEAT[kind] || HEAT.shot;
  const p = Math.max(3, Math.round(rad / 7));
  const grow = reduced ? 1 : Math.min(1, 0.45 + k * 1.8);
  const m = Math.max(1, Math.round((rad * grow) / p));
  const ox = snap(x, p), oy = snap(y, p);
  // the core flash, early on
  if (!reduced && k < 0.35) drawGlow(c, x, y, rad * 1.5, kind === 'big' ? '#9FFFF0' : '#FFC060', 0.8 * (1 - k / 0.35));
  c.globalAlpha = Math.max(0, 0.9 * (1 - k * 0.7));
  for (let gy = -m; gy < m; gy++) {
    for (let gx = -m; gx < m; gx++) {
      // a ragged fireball edge (always inside the dotted reach ring)
      const e = (Math.hypot(gx + 0.5, gy + 0.5) / m) * (1 + (hash(gx, gy, 17) % 14) / 100);
      if (e > 1) continue;
      // it dissolves from the middle out near the end
      if (k > 0.55 && ((gx + gy) & 1) === 0 && e < (k - 0.55) * 2.6) continue;
      if (k > 0.75 && hash(gx, gy, 3) % 3 === 0) continue;
      const i = e < 0.38 - k * 0.5 ? 0 : e < 0.66 - k * 0.4 ? 1 : e < 0.9 ? 2 : 3;
      c.fillStyle = heat[i];
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  if (!reduced) {
    if (k < 0.4) {
      // a white shock ring racing out to the edge
      c.globalAlpha = 1 - k / 0.4;
      c.fillStyle = PAL.white;
      const sr = rad * Math.min(1, 0.2 + k * 2.4), n = Math.max(12, Math.round(sr / 2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        c.fillRect(snap(x + Math.cos(a) * sr, p) - p / 2, snap(y + Math.sin(a) * sr, p) - p / 2, p, p);
      }
    } else if (k > 0.5) {
      // smoke lifting off as it fades
      const q = (k - 0.5) * 2;
      for (let i = 0; i < 6; i++) {
        const a = (hash(i, 7, 11) % 628) / 100, d = rad * (0.2 + (hash(i, 3, 5) % 60) / 100);
        const size = snap(p * (1 + q * 1.5), p);
        c.globalAlpha = 0.55 * (1 - q);
        c.fillStyle = i % 2 ? PAL.smoke : PAL.ember;
        c.fillRect(snap(x + Math.cos(a) * d, p), snap(y + Math.sin(a) * d - q * rad * 0.7, p), size, size);
      }
    }
  }
  // the full reach, as a dotted ring
  c.globalAlpha = Math.max(0, 1 - k);
  c.fillStyle = heat[1];
  const dots = Math.max(10, Math.round((Math.PI * 2 * rad) / 12));
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2;
    c.fillRect(snap(x + Math.cos(a) * rad - 1.5, 1), snap(y + Math.sin(a) * rad - 1.5, 1), 3, 3);
  }
  c.globalAlpha = 1;
}

export function drawGroundBlast(c, x, ground, k, o = {}) {
  const { reduced = false, size = 40 } = o;
  const p = 4;
  const rad = size * (reduced ? 0.8 : 0.35 + k * 0.8);
  const m = Math.round(rad / p);
  const ox = snap(x, p), oy = snap(ground, p);
  c.globalAlpha = Math.max(0, 1 - k);
  for (let gy = -m; gy < 0; gy++) {
    for (let gx = -m; gx < m; gx++) {
      const e = Math.hypot(gx + 0.5, gy + 0.5) / m;
      if (e > 1 || (k > 0.5 && hash(gx, gy, 5) % 2 === 0)) continue;
      c.fillStyle = e < 0.4 - k * 0.4 ? PAL.white : e < 0.65 ? PAL.yellow : e < 0.88 ? PAL.orange : PAL.red;
      c.fillRect(ox + gx * p, oy + gy * p, p, p);
    }
  }
  if (!reduced) {
    // rubble thrown up and falling back
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.12 + 0.76 * (i / 8));
      const px = x + Math.cos(a) * size * 1.5 * k;
      const py = ground - Math.sin(a) * size * 2 * k + size * 2.2 * k * k;
      c.fillStyle = i % 3 === 0 ? PAL.red : i % 3 === 1 ? PAL.orange : PAL.smoke;
      c.fillRect(snap(px, 2), snap(Math.min(py, ground), 2), p, p);
    }
  }
  c.globalAlpha = 1;
}

export function drawBase(c, x, ground, H, o = {}) {
  const { aim = 0, anim = 0, reduced = false, col = {}, empty = false, flash = 0, recoil = 0, charge = false } = o;
  const p = 3;
  const X = snap(x, p), G = snap(ground, p);
  // a big rocket ready: the launcher glows teal
  if (charge) drawGlow(c, X, G - p * 6, p * 9, '#62D2C5', reduced ? 0.4 : 0.35 + 0.15 * Math.sin(anim * 5));
  // the barrel turns to where the last rocket went, and kicks back when it fires
  c.save();
  c.translate(X, G - p * 2);
  c.rotate(Math.max(-1.2, Math.min(1.2, aim)));
  if (!reduced && recoil > 0) c.translate(0, Math.round(recoil * p * 2));
  c.fillStyle = PAL.outline; c.fillRect(-p * 2, -p * 6, p * 4, p * 6);
  c.fillStyle = PAL.shade; c.fillRect(-p, -p * 5, p * 2, p * 5);
  c.fillStyle = PAL.steel; c.fillRect(-p, -p * 5, p, p * 5);
  c.fillStyle = empty ? PAL.red : charge ? PAL.yellow : PAL.teal; c.fillRect(-p, -p * 6, p * 2, p);
  c.fillStyle = PAL.shade; c.fillRect(-p * 2, -p * 2, p * 4, p);
  if (flash > 0 && !reduced) {
    c.globalAlpha = Math.min(1, flash * 1.5);
    c.fillStyle = PAL.yellow; c.fillRect(-p * 2, -p * 9, p * 4, p * 3);
    c.fillStyle = PAL.white; c.fillRect(-p, -p * 10, p * 2, p * 3);
    c.fillStyle = PAL.orange; c.fillRect(-p * 3, -p * 7, p, p); c.fillRect(p * 2, -p * 7, p, p);
    c.globalAlpha = 1;
  }
  c.restore();
  // a stepped mound
  const rows = [[2, PAL.steel], [3, PAL.teal], [5, PAL.teal], [6, col.city || '#262245']];
  rows.forEach(([half, fill], j) => {
    c.fillStyle = fill;
    c.fillRect(X - half * p, G - p * 2 + j * p, half * 2 * p, p);
  });
  c.fillStyle = PAL.shade; c.fillRect(X + p, G - p, p * 2, p);
  c.fillStyle = col.city || '#262245';
  c.fillRect(X - 6 * p, G + p * 2, 12 * p, H - G);
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

const BIG_STARS = [[0.12, 0.1, 0], [0.33, 0.24, 1.3], [0.58, 0.07, 2.2], [0.9, 0.36, 3.1], [0.22, 0.47, 4.4], [0.7, 0.52, 5.2]];

export function drawBackdrop(c, W, ground, o = {}) {
  const { anim = 0, reduced = false } = o;
  // a crescent moon
  const p = 3, m = 6;
  const mx = snap(W * 0.83, p), my = snap(Math.max(34, ground * 0.13), p);
  for (let gy = -m; gy < m; gy++) {
    for (let gx = -m; gx < m; gx++) {
      const ex = gx + 0.5, ey = gy + 0.5;
      if (Math.hypot(ex, ey) > m) continue;
      if (Math.hypot(ex - m * 0.55, ey + m * 0.25) < m * 0.9) continue;
      c.fillStyle = hash(gx, gy, 9) % 5 === 0 ? PAL.moonDark : PAL.moon;
      c.fillRect(mx + gx * p, my + gy * p, p, p);
    }
  }
  // a few big stars that twinkle as little crosses
  c.fillStyle = PAL.white;
  for (const [fx, fy, ph] of BIG_STARS) {
    const X = snap(fx * W, 2), Y = snap(fy * ground, 2);
    const on = reduced || Math.sin(anim * 1.8 + ph) > -0.2;
    c.globalAlpha = on ? 0.9 : 0.5;
    c.fillRect(X, Y, 2, 2);
    if (on) { c.globalAlpha = 0.55; c.fillRect(X - 2, Y, 2, 2); c.fillRect(X + 2, Y, 2, 2); c.fillRect(X, Y - 2, 2, 2); c.fillRect(X, Y + 2, 2, 2); }
  }
  // now and then a shooting star, far away
  if (!reduced) {
    const every = 9, life = 0.7, n = Math.floor(anim / every), q = (anim - n * every) / life;
    if (q < 1 && n > 0) {
      const sx = (0.15 + (hash(n, 1, 2) % 60) / 100) * W, sy = (0.05 + (hash(n, 2, 3) % 25) / 100) * ground;
      const dir = hash(n, 3, 4) % 2 ? 1 : -1;
      for (let i = 0; i < 7; i++) {
        const d = q * 150 - i * 7;
        if (d < 0) continue;
        c.globalAlpha = (1 - q) * (1 - i / 7);
        c.fillRect(snap(sx + dir * d, 2), snap(sy + d * 0.45, 2), i === 0 ? 3 : 2, i === 0 ? 3 : 2);
      }
    }
  }
  c.globalAlpha = 1;
}

export function drawSmoke(c, x, y, o = {}) {
  const { anim = 0, reduced = false, fire = false } = o;
  const n = reduced ? 2 : 6;
  for (let i = 0; i < n; i++) {
    const ph = reduced ? 0.3 + i * 0.3 : (anim * 0.35 + i / n) % 1;
    const size = snap(4 + ph * 8, 2);
    c.globalAlpha = 0.5 * (1 - ph);
    c.fillStyle = i % 2 ? PAL.smoke : '#4A465E';
    c.fillRect(snap(x + Math.sin(i * 1.9 + ph * 3) * 6 + ph * 14 - size / 2, 2), snap(y - ph * 46 - size, 2), size, size);
  }
  if (fire) {
    const f = reduced ? 0 : Math.floor(anim * 10);
    for (let i = -2; i <= 2; i++) {
      const hgt = 4 + (hash(i, f, 13) % 4) * 3;
      c.globalAlpha = 0.95;
      c.fillStyle = PAL.red; c.fillRect(snap(x + i * 5, 1) - 2, y - hgt, 5, hgt);
      c.fillStyle = PAL.orange; c.fillRect(snap(x + i * 5, 1) - 1, y - hgt * 0.7, 3, hgt * 0.7);
      if ((i + f) % 2 === 0) { c.fillStyle = PAL.yellow; c.fillRect(snap(x + i * 5, 1), y - hgt * 0.4, 2, hgt * 0.4); }
    }
  }
  c.globalAlpha = 1;
}

export function popup(list, x, y, text, o = {}) {
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
    const X = Math.round(q.x), Y = Math.round(q.y - 14 - k * 30);
    drawText(c, q.text, X, Y, q.hot ? 3 : 2, q.hot ? POP_HOT : POP, Math.max(0, 1 - k * k));
  }
  c.globalAlpha = 1;
}
