// game/shared.js: pieces both ways to play Sky Shield use (Classic in view.js, Arcade in
// arcade-view.js): styles, icons, the game store, the night backdrop, and RunBase (the clock,
// pause, overlays, speech and the live region of a run).

import * as store from '../store.js';
import * as audio from '../audio.js';
import { h } from '../ex/common.js';
import { makeRng } from './core.js';
import * as music from './music.js';

export const BUILD = '2026-11-17 d';

// ---- styles and icons ---------------------------------------------------------------------------

let styled = false;
export function gameStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/game.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  pause: `<path d="M9 6v12M15 6v12" ${S}/>`,
  speaker: `<path d="M4 9.5h4l5-4v13l-5-4H4z" ${S}/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" ${S}/>`,
  lock: `<rect x="5" y="11" width="14" height="9.5" rx="2" ${S}/><path d="M8 11V8a4 4 0 0 1 8 0v3" ${S}/>`,
  rocket: `<path d="M12 3c3 2.5 4.5 6 4.5 10l-2 3h-5l-2-3C7.5 9 9 5.5 12 3z" ${S}/><circle cx="12" cy="10" r="1.6" ${S}/><path d="M9.5 16l-2.5 4M14.5 16l2.5 4M12 17v4" ${S}/>`,
  target: `<circle cx="12" cy="12" r="7.5" ${S}/><circle cx="12" cy="12" r="2.5" ${S}/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" ${S}/>`,
};
export function gicon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name];
  return s;
}

export const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// ---- store ------------------------------------------------------------------------------------
// Best scores and run counts: Classic keeps the plain mode keys (`l2s`), Arcade uses `arcade.l2s`.

export function gameStore() {
  const g = store.get('game') || {};
  return { best: {}, runs: {}, mute: false, ...g };
}
export function saveGame(fn) {
  const g = gameStore();
  fn(g);
  store.set('game', g);
  return g;
}
export const scoreKey = (type, mode) => (type === 'arcade' ? `arcade.${mode}` : mode);

// ---- the night backdrop ---------------------------------------------------------------------------

export const STARS = (() => {
  const r = makeRng(7);
  return Array.from({ length: 70 }, () => ({ x: r(), y: r() * 0.75, s: 0.5 + r() * 1.3, p: r() * 6.28 }));
})();
export const SKYLINE = (() => {
  const r = makeRng(11);
  const out = [];
  let x = 0;
  while (x < 1) { const w = 0.03 + r() * 0.05; out.push({ x, w, h: 0.25 + r() * 0.55 }); x += w + 0.004; }
  return out;
})();
export const TOWN_SHAPE = [[-0.085, 0.034, 0.55], [-0.045, 0.04, 1], [0.0, 0.03, 0.75], [0.035, 0.045, 0.9], [0.075, 0.025, 0.5]];

/** The scene colours (tokens on .game-field in game.css). */
export function readColors(field) {
  const cs = getComputedStyle(field);
  const v = n => cs.getPropertyValue(n).trim();
  return {
    sky1: v('--game-sky-1'), sky2: v('--game-sky-2'), star: v('--game-star'),
    far: v('--game-far'), city: v('--game-city'), window: v('--game-window'), dark: v('--game-dark'),
    rock: v('--game-rock'), fire: v('--game-fire'), trail: v('--game-trail'), blast: v('--game-blast'),
    hurt: v('--game-hurt'), boss: v('--game-boss'),
  };
}

/** The sky gradient over the whole field. */
export function drawSky(c, W, H, col) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, col.sky1);
  g.addColorStop(1, col.sky2);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

/**
 * Stars, the far skyline and the four towns (o: W, H, ground, col, anim, reduced, towns, relaxed,
 * flash, townX).
 */
export function drawCity(c, o) {
  const { W, H, ground, col, anim, reduced: R, towns, relaxed, flash, townX } = o;
  c.fillStyle = col.star;
  for (const st of STARS) {
    c.globalAlpha = R ? 0.7 : 0.45 + 0.4 * Math.sin(anim * 1.5 + st.p) ** 2;
    c.fillRect(st.x * W, st.y * ground, st.s, st.s);
  }
  c.globalAlpha = 1;
  const base = H;
  c.fillStyle = col.far;
  for (const b of SKYLINE) c.fillRect(b.x * W, base - b.h * (H - ground) * 0.9, b.w * W, H);
  const tw = Math.min(W * 0.22, 140);
  towns.forEach((hp, i) => {
    const cx = townX[i] * W;
    const tall = (H - ground) * 1.05;
    for (const [dx, w, hgt] of TOWN_SHAPE) {
      const bx = cx + dx * tw / 0.2, bw = w * tw / 0.2, bh = tall * hgt * (hp === 0 && !relaxed ? 0.3 : hp === 1 && !relaxed ? 0.75 : 1);
      c.fillStyle = col.city;
      c.fillRect(bx, base - bh, bw, bh);
      c.fillStyle = hp > 0 || relaxed ? col.window : col.dark;
      for (let wy = base - bh + 6; wy < base - 6; wy += 9) {
        for (let wx = bx + 4; wx < bx + bw - 4; wx += 7) {
          const on = ((wx * 7 + wy * 3) | 0) % (hp >= 2 || relaxed ? 3 : 5) !== 0;
          if (on) c.fillRect(wx, wy, 3, 4);
        }
      }
    }
    if (flash[i] > 0 && !R) {
      c.globalAlpha = flash[i];
      c.fillStyle = col.hurt;
      c.fillRect(cx - tw / 2, ground, tw, H - ground);
      c.globalAlpha = 1;
    }
  });
}

// ---- a run: clock, pause, overlays, speech --------------------------------------------------------
// Subclasses provide: build(), stepRules(dt) -> events, handle(events), tickFx(dt), sync(), draw(),
// resize(), key(e) (keys other than P and Escape), entry(id), waves (number), and may override
// keepOverlay(kind) (whether a saved overlay comes back after a pause).

export class RunBase {
  constructor(root, state, hooks) {
    this.root = root;
    this.state = state;
    this.hooks = hooks;
    this.manual = false;
    this.paused = false;
    this.ended = false;
    this.anim = 0;
    this.overlayKind = null;
    this.saved = null;
    this.reduced = reducedMotion();
  }

  /** Keys, tab hiding and resizing (call from build once this.field exists). */
  listen() {
    this.onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        this.setPaused(!this.paused);
      } else if (!this.paused) {
        this.key(e);
      }
    };
    this.onVis = () => { if (document.hidden) this.setPaused(true); };
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro) this.ro.observe(this.field);
  }

  /** The top bar: wave, score, streak, towns and pause (this.hud, this.pauseBtn). */
  makeHud() {
    this.hud = {
      wave: h('span', { class: 'game-stat-v', 'data-hud': 'wave' }),
      score: h('span', { class: 'game-stat-v', 'data-hud': 'score' }),
      streak: h('span', { class: 'game-stat-v', 'data-hud': 'streak' }),
      towns: h('span', { class: 'game-towns', 'data-hud': 'towns' }),
    };
    const stat = (k, v) => h('span', { class: 'game-stat' }, h('span', { class: 'game-stat-k', text: k }), v);
    this.pauseBtn = h('button', { type: 'button', class: 'btn btn-quiet game-pause-btn', 'aria-label': 'Pause' }, gicon('pause'));
    this.pauseBtn.addEventListener('click', () => this.setPaused(true));
    return h('div', { class: 'game-hud' },
      stat('Wave', this.hud.wave), stat('Score', this.hud.score), stat('Streak', this.hud.streak),
      h('span', { class: 'game-stat game-stat-towns' }, h('span', { class: 'game-stat-k', text: 'Towns' }), this.hud.towns),
      this.pauseBtn);
  }

  /** Writes the top bar (waves: run length; hpMax: all town hit points). */
  writeHud(waves, hpMax) {
    const s = this.state;
    this.hud.wave.textContent = `${s.wave}/${waves}`;
    this.hud.score.textContent = String(s.score);
    this.hud.streak.textContent = String(s.streak);
    const hp = s.towns.reduce((a, b) => a + b, 0);
    if (this.hud.towns.dataset.hp !== String(hp) || !this.hud.towns.childNodes.length) {
      this.hud.towns.dataset.hp = String(hp);
      this.hud.towns.replaceChildren(
        ...s.towns.map(t => h('span', { class: 'game-pip', 'data-hp': String(t), 'aria-hidden': 'true' })),
        h('span', { class: 'visually-hidden', text: s.relaxed ? 'Relaxed: towns take no damage' : `${hp} of ${hpMax} town hit points left` }));
    }
  }

  key() { /* subclasses */ }
  keepOverlay(kind) { return kind !== 'banner' || this.state.phase === 'banner'; }

  /** Focus the screen heading and start the frame loop. */
  loop() {
    const h1 = this.screen.querySelector('h1');
    h1.setAttribute('tabindex', '-1');
    try { h1.focus({ preventScroll: true }); } catch { /* ignore */ }
    this.last = 0;
    const frame = ts => {
      if (this.ended) return;
      const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
      this.last = ts;
      if (!this.paused && !this.manual) this.advance(dt);
      else this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(stopAudio = true) {
    this.ended = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    if (this.ro) this.ro.disconnect();
    if (stopAudio) audio.stop();
    music.stop();
  }

  advance(secs) {
    let left = Math.max(0, Number(secs) || 0);
    while (left > 1e-9 && !this.ended) {
      const d = Math.min(0.05, left);
      left -= d;
      this.anim += d;
      this.tickFx(d);
      this.handle(this.stepRules(d));
    }
    if (!this.ended) { this.sync(); this.draw(); }
  }

  setPaused(on) {
    if (this.ended || this.state.phase === 'end') return;
    if (on === this.paused) return;
    this.paused = on;
    this.screen.dataset.paused = String(on);
    if (on) music.pause(); else music.resume();
    if (on) {
      audio.stop();
      const resume = h('button', { type: 'button', class: 'btn btn-main', 'data-resume': '' }, 'Resume');
      const quit = h('button', { type: 'button', class: 'btn btn-secondary', 'data-quit': '' }, 'Quit run');
      resume.addEventListener('click', () => this.setPaused(false));
      quit.addEventListener('click', () => this.hooks.onQuit());
      this.showOverlay('pause', h('div', { class: 'game-card', role: 'dialog', 'aria-label': 'Paused' },
        h('h2', { class: 'game-card-title', text: 'Paused' }),
        h('p', { class: 'game-card-note', text: 'Press P or Escape to go on.' }), resume, quit));
      try { resume.focus({ preventScroll: true }); } catch { /* ignore */ }
    } else {
      this.last = 0;
      this.hideOverlay('pause');
      this.restoreOverlay();
      try { this.pauseBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }

  speak(id) {
    const e = this.entry(id);
    if (!e || !e.audio) return;
    // Shown on screen: a ring while the sound plays, a notice when it cannot.
    const scr = this.screen;
    const token = (this.speakN = (this.speakN || 0) + 1);
    const done = () => { if (scr && this.speakN === token) delete scr.dataset.speaking; };
    if (scr) { scr.dataset.speaking = id; delete scr.dataset.audiofail; }
    audio.play(e).then(done, err => {
      done();
      if (scr) scr.dataset.audiofail = 'true';
      this.say('The sound could not play.');
      return err;
    });
  }

  say(text) {
    this.live.textContent = '';
    this.live.textContent = text;
  }

  showOverlay(kind, node) {
    if (kind !== 'pause') this.overlayKind = kind;
    if (kind === 'pause') this.saved = { kind: this.overlayKind, kids: [...this.overlay.childNodes] };
    this.overlay.dataset.kind = kind;
    this.overlay.replaceChildren(node);
    this.overlay.hidden = false;
  }

  hideOverlay(kind) {
    if (this.overlay.dataset.kind !== kind) return;
    if (kind !== 'pause') this.overlayKind = null;
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
    delete this.overlay.dataset.kind;
  }

  restoreOverlay() {
    const sv = this.saved;
    this.saved = null;
    if (!sv || !sv.kind || !sv.kids.length) return;
    if (!this.keepOverlay(sv.kind)) return;
    this.overlay.dataset.kind = sv.kind;
    this.overlay.replaceChildren(...sv.kids);
    this.overlay.hidden = false;
  }
}
