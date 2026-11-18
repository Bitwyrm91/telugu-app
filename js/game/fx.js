// game/fx.js: the flying bits and lights of Sky Shield (both modes). An Fx keeps a fixed pool of
// particles (sparks, rock chunks, smoke, fire puffs, embers, exhaust, firework stars, dust, glints),
// plus pixel shock rings, lightning links between chained kills, short lights (which also tint the
// towns), and pixel-font texts (combo counts, wave titles, warnings). Nothing here knows the rules.
// With `reduced` (reduced motion) it spawns no particles, rings or lights, links do not flicker and
// texts appear in place without popping or sliding.
//
//   const fx = new Fx(reduced)
//   fx.step(dt)  fx.draw(c, 'back' | 'front')  fx.tint(x, y) -> 0..1 light on a point
//   fx.explode(x, y, rad, kind)  fx.debris(x, y, n, o)  fx.impact(x, ground, o)  fx.collapse(x, ground, w)
//   fx.trail(x, y, ux, uy, big)  fx.muzzle(x, y, ux, uy)  fx.reload(x, y)  fx.repair(x, y, w)
//   fx.link(x0, y0, x1, y1)  fx.splitPop(x, y)  fx.entry(x, y)  fx.warn(x, y)
//   fx.text(str, x, y, o)  fx.title(str, W, H)  fx.firework(x, y, colour)  fx.shell(x0, y0, x1, y1, delay)
//   fx.ash = {W, H} | null   (embers drifting down after a lost run)
//   endScene(canvas, o) -> stop()   the small sky over the end screen (fireworks or embers)

import { PAL } from './sprites.js';
import { snap, hash, drawGlow, drawText } from './pixel.js';

const MAXP = 340;
const K = { SPARK: 0, DEBRIS: 1, SMOKE: 2, EMBER: 3, TRAIL: 4, STAR: 5, SHELL: 6, FIRE: 7, GLINT: 8, DUST: 9 };
const BACK = new Set([K.SMOKE, K.TRAIL, K.DUST]);
const ROCK = ['#8A7468', '#5B4A43', '#6E5A50', '#3B2F2B'];
const FIREWORK = ['#FFD23F', '#62D2C5', '#FF5D9E', '#B8FFF4', '#FF8A1F', '#9C7BFF'];
export const TEXT = {
  gold: ['#FFF7E0', '#FFD23F', '#FF8A1F', '#1A1222'],
  hot: ['#FFF7E0', '#FF8A1F', '#E23D3D', '#1A1222'],
  cool: ['#FFFFFF', '#B8FFF4', '#62D2C5', '#10202A'],
  red: ['#FFD0C8', '#FF5D5D', '#A82020', '#1A0A12'],
  pink: ['#FFF0FA', '#FF9CF2', '#C040C8', '#1A0A1E'],
};

const rnd = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor(reduced = false) {
    this.reduced = !!reduced;
    this.P = Array.from({ length: MAXP }, () => ({ on: false, k: 0, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, s: 2, g: 0, drag: 0, col: '', floor: 1e9, ph: 0 }));
    this.cur = 0;
    this.rings = [];
    this.links = [];
    this.lights = [];
    this.texts = [];
    this.time = 0;
    this.ash = null;
    this.ashAcc = 0;
  }

  add(k, x, y, vx, vy, life, s, delay = 0) {
    const p = this.P[this.cur];
    this.cur = (this.cur + 1) % MAXP;
    p.on = true; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = -delay; p.life = life; p.s = s;
    p.g = 0; p.drag = 0; p.col = ''; p.floor = 1e9; p.ph = Math.random() * 6.28;
    return p;
  }

  get busy() { let n = 0; for (const p of this.P) if (p.on) n++; return n; }

  // ---- spawners ----

  ring(x, y, r0, r1, life, col, o = {}) {
    if (this.reduced) return;
    this.rings.push({ x, y, r0, r1, t: -(o.delay || 0), life, col, p: o.p || 3, flat: o.flat || 1 });
    if (this.rings.length > 16) this.rings.shift();
  }

  light(x, y, r, a, life, col = '#FFB040') {
    if (this.reduced) return;
    this.lights.push({ x, y, r, a, t: 0, life, col });
    if (this.lights.length > 12) this.lights.shift();
  }

  sparks(x, y, n, speed = 140, o = {}) {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = speed * rnd(0.35, 1.1);
      const p = this.add(K.SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v - (o.up || 30), rnd(0.35, 0.7), Math.random() < 0.35 ? 4 : 2, o.delay || 0);
      p.g = o.g ?? 240; p.drag = 1.2; p.col = o.col || '';
    }
  }

  debris(x, y, n, o = {}) {
    if (this.reduced) return;
    const sp = o.speed || 140;
    for (let i = 0; i < n; i++) {
      const a = (o.up ? -Math.PI / 2 + rnd(-1.1, 1.1) : Math.random() * 6.283), v = sp * rnd(0.4, 1);
      const p = this.add(K.DEBRIS, x + rnd(-4, 4), y + rnd(-4, 4), Math.cos(a) * v, Math.sin(a) * v - 40, rnd(0.8, 1.3), Math.random() < 0.4 ? 5 : Math.random() < 0.5 ? 4 : 3);
      p.g = 380; p.col = o.cols ? o.cols[i % o.cols.length] : ROCK[i % ROCK.length]; p.floor = o.floor ?? 1e9;
    }
  }

  smoke(x, y, n, o = {}) {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const p = this.add(K.SMOKE, x + rnd(-1, 1) * (o.spread || 10), y + rnd(-1, 1) * (o.spread || 10) * 0.6,
        rnd(-12, 12) + (o.vx || 0), rnd(-30, -12) * (o.rise || 1), rnd(1.1, 1.8) * (o.long || 1), Math.round(rnd(5, 9) * (o.size || 1)), (o.delay || 0) + rnd(0, 0.18));
      p.drag = 0.8; p.col = Math.random() < 0.5 ? '#4A465E' : PAL.smoke;
      if (o.dark) p.col = Math.random() < 0.5 ? '#2E2A3E' : '#3E3850';
    }
  }

  fire(x, y, n, o = {}) {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const p = this.add(K.FIRE, x + rnd(-1, 1) * (o.spread || 8), y + rnd(-1, 1) * (o.spread || 8) * 0.5,
        rnd(-20, 20) * (o.wide || 1), rnd(-70, -25) * (o.rise || 1), rnd(0.55, 0.95), Math.round(rnd(6, 11) * (o.size || 1)), (o.delay || 0) + i * (o.stagger || 0));
      p.drag = 1.6;
    }
  }

  embers(x, y, n, o = {}) {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = (o.speed || 40) * rnd(0.3, 1);
      const p = this.add(K.EMBER, x + rnd(-1, 1) * (o.spread || 6), y + rnd(-1, 1) * (o.spread || 6), Math.cos(a) * v, Math.sin(a) * v - (o.up || 20), rnd(0.9, 1.8) * (o.long || 1), 2, (o.delay || 0) + rnd(0, 0.2));
      p.g = o.g ?? 25; p.drag = 1.4;
    }
  }

  /** A burst in the sky: flash, fireball sparks, shock ring (inside the reach), smoke left behind. */
  explode(x, y, rad, kind = 'shot') {
    if (this.reduced) return;
    const big = kind === 'big', chain = kind === 'chain';
    this.light(x, y, rad * (big ? 3.4 : 2.6), big ? 0.75 : chain ? 0.4 : 0.55, big ? 0.45 : 0.3, big ? '#9FFFF0' : '#FFB040');
    this.sparks(x, y, big ? 26 : chain ? 9 : 14, rad * (big ? 4.2 : 3.4), { col: big ? 'cool' : '' });
    if (big) {
      this.ring(x, y, rad * 0.2, rad * 0.98, 0.32, PAL.glow, { p: 4 });
      this.ring(x, y, rad * 0.1, rad * 0.7, 0.42, PAL.yellow, { delay: 0.1, p: 3 });
      this.fire(x, y, 6, { spread: rad * 0.3, size: 1.4, rise: 0.6 });
    }
    this.smoke(x, y, big ? 9 : chain ? 3 : 5, { spread: rad * 0.45, size: big ? 1.5 : 1, delay: 0.18 });
    this.embers(x, y, big ? 8 : 4, { speed: rad * 1.4, spread: rad * 0.3 });
  }

  /** A meteor destroyed: chunks of rock, a few still glowing. */
  shatter(x, y, r, o = {}) {
    if (this.reduced) return;
    this.debris(x, y, o.n || 7, { speed: 90 + r * 4, cols: o.cols });
    this.sparks(x, y, 6, 120, { col: o.col || '' });
  }

  /** A meteor reaching the ground: a fireball column, dust along the ground, rubble, a big light. */
  impact(x, ground, o = {}) {
    if (this.reduced) return;
    const size = o.size || 40;
    this.light(x, ground - size * 0.5, size * 5, 0.8, 0.7, '#FF9A3A');
    this.fire(x, ground - 4, 9, { spread: size * 0.35, size: 1.3, stagger: 0.04, rise: 1.2 });
    this.smoke(x, ground - size * 0.6, 10, { spread: size * 0.5, size: 1.7, delay: 0.25, rise: 1.4, long: 1.4, dark: true });
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 ? 1 : -1;
      const p = this.add(K.DUST, x + dir * rnd(4, 14), ground - rnd(0, 6), dir * rnd(50, 110), rnd(-14, -4), rnd(0.8, 1.3), Math.round(rnd(6, 10)), rnd(0, 0.1));
      p.drag = 2.2; p.col = i % 3 ? '#5A4E5E' : '#6E6A86';
    }
    this.debris(x, ground - 6, 12, { speed: 200, up: true, floor: ground + 30 });
    this.sparks(x, ground - 6, 16, 220, { up: 120 });
    this.embers(x, ground - 10, 10, { speed: 60, up: 40, long: 1.6 });
    this.ring(x, ground - 2, 6, size * 1.6, 0.4, PAL.orange, { flat: 0.28, p: 3 });
  }

  /** A town falls: billowing dust and falling rubble along its width. */
  collapse(x, ground, w) {
    if (this.reduced) return;
    for (let i = 0; i < 5; i++) this.smoke(x + (i - 2) * w * 0.2, ground + 10, 2, { spread: 8, size: 1.6, delay: 0.1 + i * 0.06, rise: 0.6, long: 1.6, dark: true });
    this.debris(x, ground - 10, 10, { speed: 120, up: true, cols: ['#3A3456', '#262245', '#5A4E5E'] });
  }

  /** Rocket exhaust: a puff where the rocket is, a spark now and then for the big one. */
  trail(x, y, ux, uy, big) {
    if (this.reduced) return;
    const p = this.add(K.TRAIL, x - ux * 10 + rnd(-1.5, 1.5), y - uy * 10 + rnd(-1.5, 1.5), -ux * 20 + rnd(-8, 8), -uy * 20 + rnd(-8, 8), big ? 0.75 : 0.55, big ? 5 : 4);
    p.drag = 2;
    if (big && Math.random() < 0.6) {
      const q = this.add(K.STAR, x - ux * 12, y - uy * 12, rnd(-40, 40), rnd(-40, 40), rnd(0.3, 0.55), 2);
      q.col = Math.random() < 0.5 ? PAL.yellow : PAL.glow; q.g = 40; q.drag = 2;
    }
  }

  /** The launcher fires: smoke to both sides, a few sparks up the barrel. */
  muzzle(x, y, ux, uy, big) {
    if (this.reduced) return;
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      const p = this.add(K.SMOKE, x + dir * 6, y - 4, dir * rnd(30, 70), rnd(-20, -4), rnd(0.5, 0.9), Math.round(rnd(4, 7)));
      p.drag = 2.5; p.col = i % 3 ? '#B8B4CC' : PAL.smoke;
    }
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const v = rnd(80, 200);
      const p = this.add(K.SPARK, x + ux * 16, y + uy * 16, ux * v + rnd(-30, 30), uy * v + rnd(-30, 30), rnd(0.15, 0.35), 2);
      p.g = 100; p.drag = 2; p.col = big ? 'cool' : '';
    }
    this.light(x, y - 10, 60, big ? 0.55 : 0.35, 0.16, big ? '#9FFFF0' : '#FFC860');
  }

  /** Right answer: glints fly into the launcher and a ring closes on it. */
  reload(x, y) {
    if (this.reduced) return;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * 6.283, d = rnd(44, 70);
      const life = rnd(0.35, 0.5);
      const p = this.add(K.GLINT, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, -Math.cos(a) * d / life, -Math.sin(a) * d * 0.7 / life, life, 2, i * 0.012);
      p.col = i % 3 ? PAL.glow : PAL.white;
    }
    this.ring(x, y, 46, 8, 0.35, PAL.teal, { p: 2, flat: 0.7 });
    this.light(x, y, 50, 0.35, 0.4, '#62D2C5');
  }

  /** A town mended: glints rising over it. */
  repair(x, y, w) {
    if (this.reduced) return;
    for (let i = 0; i < 18; i++) {
      const p = this.add(K.GLINT, x + rnd(-0.5, 0.5) * w, y - rnd(0, 30), rnd(-6, 6), rnd(-50, -20), rnd(0.7, 1.2), 2, i * 0.03);
      p.col = i % 2 ? '#7CF29A' : PAL.white;
    }
  }

  /** A jagged bolt from a burst to the meteor it set off. */
  link(x0, y0, x1, y1) {
    this.links.push({ x0, y0, x1, y1, t: 0, life: this.reduced ? 0.3 : 0.28, seed: (Math.random() * 1e6) | 0 });
    if (this.links.length > 12) this.links.shift();
  }

  splitPop(x, y) {
    if (this.reduced) return;
    this.light(x, y, 90, 0.5, 0.3, '#E070FF');
    this.ring(x, y, 4, 34, 0.3, '#FF9CF2', { p: 3 });
    this.sparks(x, y, 12, 160, { col: 'pink' });
    this.debris(x, y, 5, { speed: 110, cols: ['#A85C7E', '#7A3E5A', '#4E2439'] });
  }

  /** A meteor appears: a brief glint where it breaks through. */
  entry(x, y) {
    if (this.reduced) return;
    this.light(x, y, 40, 0.3, 0.25, '#FFD9A0');
    for (let i = 0; i < 5; i++) {
      const p = this.add(K.GLINT, x + rnd(-8, 8), y + rnd(0, 6), rnd(-30, 30), rnd(10, 60), rnd(0.25, 0.4), 2);
      p.col = PAL.white;
    }
  }

  /** A warning sign at the top of the sky (a meteor that will split, or a boss). */
  warn(x, y, text = '!') {
    this.texts.push({ kind: 'warn', text, x, y, t: 0, life: 1.4, scale: 3, cols: TEXT.red, vy: 0 });
    if (this.texts.length > 8) this.texts.shift();
  }

  /** A short word that pops up and drifts (a combo, a chain, NO AMMO). o: {scale, cols, life, rise} */
  text(str, x, y, o = {}) {
    this.texts.push({ kind: 'pop', text: str, x, y, t: 0, life: o.life || 0.9, scale: o.scale || 2, cols: o.cols || TEXT.gold, vy: o.rise ?? -22 });
    if (this.texts.length > 8) this.texts.shift();
  }

  /** A big title across the middle of the sky (WAVE 3). */
  title(str, W, H, o = {}) {
    this.texts = this.texts.filter(t => t.kind !== 'title');
    const scale = Math.max(3, Math.min(6, Math.floor(W / (str.length * 6 + 6))));
    this.texts.push({ kind: 'title', text: str, x: W / 2, y: o.y ?? H * 0.36, t: 0, life: o.life || 1.5, scale, cols: o.cols || TEXT.gold, vy: 0, W });
    if (!this.reduced) {
      for (let i = 0; i < 16; i++) {
        const p = this.add(K.GLINT, W / 2 + rnd(-1, 1) * str.length * scale * 3.4, (o.y ?? H * 0.36) + rnd(-1, 1) * scale * 5, rnd(-20, 20), rnd(-30, -6), rnd(0.6, 1.1), 2, 0.12 + i * 0.03);
        p.col = i % 2 ? PAL.yellow : PAL.white;
      }
    }
  }

  firework(x, y, colour) {
    if (this.reduced) return;
    const col = colour || FIREWORK[(Math.random() * FIREWORK.length) | 0];
    const n = 26, sp = rnd(90, 140);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rnd(-0.1, 0.1), v = sp * rnd(0.75, 1.05);
      const p = this.add(K.STAR, x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.9, 1.4), i % 4 ? 2 : 3);
      p.col = i % 5 ? col : PAL.white; p.g = 70; p.drag = 1.3;
    }
    this.light(x, y, 120, 0.4, 0.4, col);
    this.ring(x, y, 4, sp * 0.45, 0.25, PAL.white, { p: 2 });
  }

  shell(x0, y0, x1, y1, delay = 0, colour) {
    if (this.reduced) return;
    const life = rnd(0.7, 0.95);
    const p = this.add(K.SHELL, x0, y0, (x1 - x0) / life, (y1 - y0) / life, life, 3, delay);
    p.col = colour || FIREWORK[(Math.random() * FIREWORK.length) | 0];
  }

  /** Light on a point from the live lights (0 none .. about 1). */
  tint(x, y) {
    let s = 0;
    for (const l of this.lights) {
      const d = Math.hypot(x - l.x, y - l.y);
      if (d >= l.r) continue;
      const k = l.t / l.life;
      s += l.a * (1 - k) * (1 - d / l.r);
    }
    return Math.min(1, s);
  }

  // ---- time ----

  step(dt) {
    this.time += dt;
    for (const p of this.P) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t < 0) continue;
      if (p.t >= p.life) {
        p.on = false;
        if (p.k === K.SHELL) { this.firework(p.x, p.y, p.col); }
        continue;
      }
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === K.DEBRIS && p.y > p.floor) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.6; }
      if (p.k === K.SHELL && Math.random() < 0.7) {
        const q = this.add(K.GLINT, p.x, p.y, rnd(-10, 10), rnd(10, 30), 0.3, 2);
        q.col = '#FFE8B0';
      }
    }
    for (const r of this.rings) r.t += dt;
    if (this.rings.length) this.rings = this.rings.filter(r => r.t < r.life);
    for (const l of this.links) l.t += dt;
    if (this.links.length) this.links = this.links.filter(l => l.t < l.life);
    for (const l of this.lights) l.t += dt;
    if (this.lights.length) this.lights = this.lights.filter(l => l.t < l.life);
    for (const t of this.texts) { t.t += dt; if (!this.reduced) t.y += t.vy * dt; }
    if (this.texts.length) this.texts = this.texts.filter(t => t.t < t.life);
    if (this.ash && !this.reduced) {
      this.ashAcc += dt;
      while (this.ashAcc > 0.07) {
        this.ashAcc -= 0.07;
        const p = this.add(K.EMBER, Math.random() * this.ash.W, -4, rnd(-10, 14), rnd(16, 34), rnd(2.5, 4.5), 2);
        p.g = 0; p.drag = 0;
      }
    }
  }

  // ---- drawing ----

  draw(c, layer = 'front') {
    const back = layer === 'back';
    for (const p of this.P) {
      if (!p.on || p.t < 0 || BACK.has(p.k) !== back) continue;
      const k = p.t / p.life;
      const X = snap(p.x, 2), Y = snap(p.y, 2);
      switch (p.k) {
        case K.SPARK: {
          c.globalAlpha = Math.max(0, 1 - k * k);
          if (p.col === 'cool') c.fillStyle = k < 0.3 ? PAL.white : k < 0.6 ? PAL.glow : PAL.teal;
          else if (p.col === 'pink') c.fillStyle = k < 0.3 ? PAL.white : k < 0.6 ? '#FF9CF2' : '#C040C8';
          else c.fillStyle = k < 0.25 ? PAL.white : k < 0.5 ? PAL.yellow : k < 0.8 ? PAL.orange : PAL.red;
          c.fillRect(X, Y, p.s, p.s);
          if (k < 0.3 && p.s > 2) { c.globalAlpha *= 0.5; c.fillRect(snap(p.x - p.vx * 0.02, 2), snap(p.y - p.vy * 0.02, 2), 2, 2); }
          break;
        }
        case K.DEBRIS: {
          c.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
          const hot = k < 0.25;
          c.fillStyle = hot ? PAL.orange : PAL.outline;
          c.fillRect(X - 1, Y - 1, p.s + 2, p.s + 2);
          c.fillStyle = hot && k < 0.1 ? PAL.yellow : p.col;
          c.fillRect(X, Y, p.s, p.s);
          break;
        }
        case K.SMOKE: {
          const s = snap(p.s * (1 + k * 1.6), 2);
          c.globalAlpha = 0.5 * (1 - k) * Math.min(1, p.t * 8);
          c.fillStyle = p.col;
          c.fillRect(X - s / 2, Y - s / 2, s, s);
          c.globalAlpha *= 0.6;
          c.fillRect(X - s / 2 + 2, Y - s / 2 - 2, s - 4, 2);
          c.fillRect(X - s / 2 - 2, Y - s / 2 + 2, 2, s - 4);
          break;
        }
        case K.FIRE: {
          const s = snap(p.s * (0.6 + k * 1.3), 2);
          c.globalAlpha = Math.max(0, 1 - k * k);
          c.fillStyle = k < 0.15 ? PAL.white : k < 0.35 ? PAL.yellow : k < 0.6 ? PAL.orange : k < 0.8 ? PAL.red : PAL.smoke;
          c.fillRect(X - s / 2, Y - s / 2, s, s);
          if (k < 0.5) { c.fillStyle = k < 0.25 ? PAL.white : PAL.yellow; c.fillRect(X - s / 4, Y - s / 4, snap(s / 2, 2), snap(s / 2, 2)); }
          break;
        }
        case K.EMBER: {
          const fl = this.reduced ? 1 : 0.6 + 0.4 * Math.sin(this.time * 18 + p.ph);
          c.globalAlpha = Math.max(0, (1 - k) * fl);
          c.fillStyle = k < 0.4 ? PAL.yellow : k < 0.75 ? PAL.orange : PAL.red;
          c.fillRect(X, Y, 2, 2);
          break;
        }
        case K.TRAIL: {
          const s = snap(p.s * (1 + k * 2.2), 2);
          c.globalAlpha = 0.65 * (1 - k);
          c.fillStyle = k < 0.12 ? PAL.yellow : k < 0.3 ? PAL.steel : k < 0.6 ? '#A9A6C0' : PAL.smoke;
          c.fillRect(X - s / 2, Y - s / 2, s, s);
          break;
        }
        case K.STAR: {
          const tw = k > 0.6 && !this.reduced && Math.sin(this.time * 40 + p.ph) < 0 ? 0.3 : 1;
          c.globalAlpha = Math.max(0, (1 - k * k) * tw);
          c.fillStyle = k < 0.15 ? PAL.white : p.col;
          c.fillRect(X, Y, p.s, p.s);
          break;
        }
        case K.SHELL: {
          c.globalAlpha = 1;
          c.fillStyle = PAL.white;
          c.fillRect(X - 1, Y - 1, 3, 3);
          break;
        }
        case K.GLINT: {
          c.globalAlpha = Math.max(0, 1 - k);
          c.fillStyle = p.col;
          c.fillRect(X, Y, 2, 2);
          if (k < 0.5) { c.globalAlpha *= 0.6; c.fillRect(X - 2, Y, 2, 2); c.fillRect(X + 2, Y, 2, 2); c.fillRect(X, Y - 2, 2, 2); c.fillRect(X, Y + 2, 2, 2); }
          break;
        }
        case K.DUST: {
          const s = snap(p.s * (1 + k * 1.8), 2);
          c.globalAlpha = 0.45 * (1 - k);
          c.fillStyle = p.col;
          c.fillRect(X - s / 2, Y - s, s, s);
          break;
        }
        default: break;
      }
    }
    c.globalAlpha = 1;
    if (back) return;
    for (const l of this.lights) {
      const k = l.t / l.life;
      drawGlow(c, l.x, l.y, l.r * 0.55, l.col, l.a * 0.45 * (1 - k) * (1 - k));
    }
    for (const r of this.rings) this.drawRing(c, r);
    for (const l of this.links) this.drawLink(c, l);
    for (const t of this.texts) this.drawTextItem(c, t);
    c.globalAlpha = 1;
  }

  drawRing(c, r) {
    if (r.t < 0) return;
    const k = r.t / r.life;
    const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
    const n = Math.max(10, Math.round((6.283 * rad) / (r.p * 2.2)));
    c.globalAlpha = Math.max(0, 1 - k);
    c.fillStyle = r.col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283;
      c.fillRect(snap(r.x + Math.cos(a) * rad, r.p) - r.p / 2, snap(r.y + Math.sin(a) * rad * r.flat, r.p) - r.p / 2, r.p, r.p);
    }
    c.globalAlpha = 1;
  }

  drawLink(c, l) {
    const k = l.t / l.life;
    const frame = this.reduced ? 0 : Math.floor(this.time * 30);
    const dx = l.x1 - l.x0, dy = l.y1 - l.y0, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const segs = 6;
    let px = l.x0, py = l.y0;
    for (let pass = 0; pass < 2; pass++) {
      px = l.x0; py = l.y0;
      const sz = pass ? 2 : 4;
      c.globalAlpha = Math.max(0, (1 - k)) * (pass ? 1 : 0.45);
      c.fillStyle = pass ? PAL.white : PAL.glow;
      for (let i = 1; i <= segs; i++) {
        const f = i / segs;
        const off = i === segs ? 0 : (((hash(l.seed, i, frame) % 1000) / 1000) - 0.5) * Math.min(28, len * 0.35) * Math.sin(f * Math.PI);
        const qx = l.x0 + dx * f + nx * off, qy = l.y0 + dy * f + ny * off;
        const sl = Math.hypot(qx - px, qy - py), st = Math.max(1, Math.round(sl / 2));
        for (let j = 0; j < st; j++) {
          const g = j / st;
          c.fillRect(snap(px + (qx - px) * g, 2) - sz / 2, snap(py + (qy - py) * g, 2) - sz / 2, sz, sz);
        }
        px = qx; py = qy;
      }
    }
    if (!this.reduced) drawGlow(c, l.x1, l.y1, 26, '#9FFFF0', 0.5 * (1 - k));
    c.globalAlpha = 1;
  }

  drawTextItem(c, t) {
    const k = t.t / t.life;
    const R = this.reduced;
    if (t.kind === 'warn') {
      const on = R || Math.floor(t.t * 6) % 2 === 0;
      const a = k > 0.8 ? (1 - k) * 5 : 1;
      if (!on) return;
      // a pixel triangle with "!" in it
      const s = t.scale, X = Math.round(t.x), Y = Math.round(t.y);
      c.globalAlpha = a;
      c.fillStyle = '#1A0A12';
      for (let r = 0; r < 9; r++) c.fillRect(X - (r + 2) * s, Y - 5 * s + r * s * 1.3, (r + 2) * 2 * s, Math.ceil(s * 1.3));
      c.fillStyle = PAL.yellow;
      for (let r = 0; r < 8; r++) c.fillRect(X - (r + 1) * s, Y - 4.4 * s + r * s * 1.3, (r + 1) * 2 * s, Math.ceil(s * 1.3));
      c.fillStyle = PAL.red;
      for (let r = 1; r < 8; r++) c.fillRect(X - (r + 1) * s + s, Y - 4.4 * s + r * s * 1.3, r * 2 * s, Math.ceil(s * 1.3));
      drawText(c, t.text, X, Y + s * 1.6, Math.max(1, Math.round(s * 0.7)), TEXT.gold, a);
      return;
    }
    let scale = t.scale, a = 1, x = t.x, y = t.y;
    if (t.kind === 'pop') {
      if (!R && t.t < 0.12) scale = t.scale * (1.7 - (t.t / 0.12) * 0.7);
      a = k > 0.65 ? (1 - k) / 0.35 : 1;
    } else if (t.kind === 'title') {
      // slides in from the right, holds, then lifts and fades
      if (!R && t.t < 0.25) { const q = 1 - t.t / 0.25; x = t.x + q * q * (t.W || 300) * 0.6; }
      a = k > 0.75 ? (1 - k) / 0.25 : Math.min(1, t.t * 8);
      if (!R && k > 0.75) y = t.y - (k - 0.75) * 40;
      if (!R && t.t > 0.25 && t.t < 0.4) drawGlow(c, x, y, scale * 30, '#FFC860', 0.35 * (1 - (t.t - 0.25) / 0.15));
    }
    drawText(c, t.text, x, y, Math.max(1, Math.round(scale)), t.cols, a);
  }
}

// ---- the small sky over the end screen ---------------------------------------------------------------

/** o: {won, reduced, towns, relaxed, draw(c, W, H, anim, fx)} draw paints the scene under the effects. */
export function endScene(canvas, o) {
  const fx = new Fx(o.reduced);
  let raf = 0, last = 0, anim = 0, next = 0.2, stopped = false;
  const size = () => {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const W = canvas.clientWidth || 300, H = canvas.clientHeight || 90;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    return { W, H, dpr };
  };
  const frame = ts => {
    if (stopped) return;
    if (!canvas.isConnected) { stopped = true; return; }
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    anim += dt;
    const { W, H, dpr } = size();
    if (!o.won) fx.ash = { W, H };
    if (o.won && anim < 7) {
      next -= dt;
      if (next <= 0) {
        next = 0.35 + Math.random() * 0.5;
        fx.shell(W * (0.15 + Math.random() * 0.7), H + 4, W * (0.1 + Math.random() * 0.8), H * (0.18 + Math.random() * 0.3));
      }
    }
    fx.step(dt);
    const c = canvas.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.draw(c, W, H, anim, fx);
    fx.draw(c, 'back');
    fx.draw(c, 'front');
    if (anim < 10) raf = requestAnimationFrame(frame);
  };
  if (o.reduced) {
    const once = () => { const { W, H, dpr } = size(); const c = canvas.getContext('2d'); if (!c) return; c.setTransform(dpr, 0, 0, dpr, 0, 0); o.draw(c, W, H, 0, fx); };
    requestAnimationFrame(once);
    return () => {};
  }
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
