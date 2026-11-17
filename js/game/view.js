// game/view.js: the "Sky Shield" screens (route #/game; GAME-PLAN.md section 11). It only renders
// and forwards input: the rules live in game/core.js.
//
//   render(el, route) -> cleanup
//
// Screens: mode picker -> run (canvas sky + DOM target labels + launcher buttons) -> end screen.
// Telugu goes in only through teNode (DESIGN 3). Tests drive a run through el.__game.

import * as store from '../store.js';
import * as content from '../content.js';
import * as audio from '../audio.js';
import { teNode } from '../ui/te.js';
import { h, icon, confidenceLabel, ensureStyles } from '../ex/common.js';
import * as core from './core.js';
import * as sfx from './sfx.js';

// ---- styles and icons ---------------------------------------------------------------------------

let styled = false;
function gameStyles() {
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
};
function gicon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name];
  return s;
}

const MODE_TEXT = {
  l2s: 'A Telugu letter falls. Fire the launcher with its sound.',
  s2l: 'You hear a sound. Fire the launcher with its letter.',
  w2m: 'A Telugu word falls. Fire the launcher with its meaning.',
  m2w: 'A meaning falls. Fire the launcher with the Telugu word.',
  lw: 'You hear a word. Fire the launcher with that word.',
};

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// ---- store ------------------------------------------------------------------------------------

function gameStore() {
  const g = store.get('game') || {};
  return { best: {}, runs: {}, mute: false, ...g };
}
function saveGame(fn) {
  const g = gameStore();
  fn(g);
  store.set('game', g);
  return g;
}

// ---- the screen ---------------------------------------------------------------------------------

export async function render(el) {
  gameStyles();
  ensureStyles();
  const [letters, index] = await Promise.all([
    content.loadLetters().catch(() => null),
    content.loadIndex().catch(() => null),
  ]);
  const units = index ? await Promise.all((index.units || []).map(u => content.loadUnit(u.id).catch(() => null))) : [];
  const progress = store.get('progress');
  const pools = { ...core.letterPool(letters, progress), ...core.wordPool(units, progress) };

  sfx.setMuted(!!gameStore().mute);
  const undoDuck = sfx.attach(audio.element());

  let run = null; // the live run (see startRun)
  const api = {
    pools,
    get state() { return run && run.state; },
    get screen() { return el.querySelector('[data-game-screen]')?.dataset.gameScreen || null; },
    start: (mode, opts = {}) => startRun(mode, opts),
    tap: i => run && run.press(i),
    right: () => (run ? core.rightLauncher(run.state) : -1),
    advance: secs => run && run.advance(secs),
    manual: on => { if (run) run.manual = !!on; },
    pause: () => run && run.setPaused(true),
    resume: () => run && run.setPaused(false),
    sfx,
  };
  el.__game = api;

  function stopRun() {
    if (run) { run.stop(); run = null; }
  }

  function showModes() {
    stopRun();
    const g = gameStore();
    const relaxed = h('input', { type: 'checkbox', id: 'game-relaxed', class: 'game-check' });
    relaxed.checked = !!(g.last && g.last.relaxed);
    const sound = h('input', { type: 'checkbox', id: 'game-sound', class: 'game-check' });
    sound.checked = !g.mute;
    sound.addEventListener('change', () => {
      saveGame(x => { x.mute = !sound.checked; });
      sfx.setMuted(!sound.checked);
    });

    const card = mode => {
      const st = core.modeStatus(mode, pools);
      const best = g.best[mode], runs = g.runs[mode];
      const meta = st.ok
        ? (runs ? `Best ${best || 0} · ${runs} ${runs === 1 ? 'run' : 'runs'}` : 'Not played yet')
        : st.reason;
      const btn = h('button', {
        type: 'button', class: 'game-mode', 'data-mode': mode, 'data-locked': st.ok ? null : 'true',
        'aria-disabled': st.ok ? null : 'true',
      },
      h('span', { class: 'game-mode-icon' }, st.ok ? gicon('rocket') : gicon('lock')),
      h('span', { class: 'game-mode-text' },
        h('span', { class: 'game-mode-title', text: core.MODES[mode].title }),
        h('span', { class: 'game-mode-desc', text: MODE_TEXT[mode] }),
        h('span', { class: 'game-mode-meta', text: meta })));
      btn.addEventListener('click', () => {
        if (!st.ok) return;
        startRun(mode, { relaxed: relaxed.checked });
      });
      return h('li', {}, btn);
    };

    const screen = h('section', { class: 'game-modes', 'data-game-screen': 'modes' },
      h('h1', { class: 'screen-title', text: 'Sky Shield' }),
      h('p', { class: 'game-intro', text: 'Meteors fall toward the towns. Fire the launcher with the right answer to stop each one. Keys 1 to 4 fire too.' }),
      pools.fallback ? h('p', { class: 'game-note', 'data-fallback': '' }, icon('info'),
        h('span', { text: 'Using the first 8 letters. Finish letter lessons to play the letters you have met.' })) : null,
      h('h2', { class: 'game-group', text: 'Letters' }),
      h('ul', { class: 'game-mode-list' }, card('l2s'), card('s2l')),
      h('h2', { class: 'game-group', text: 'Words' }),
      h('ul', { class: 'game-mode-list' }, card('w2m'), card('m2w'), card('lw')),
      h('div', { class: 'game-options' },
        h('label', { class: 'game-option', for: 'game-relaxed' }, relaxed,
          h('span', {}, h('span', { class: 'game-option-title', text: 'Relaxed' }),
            h('span', { class: 'game-option-note', text: 'Towns take no damage' }))),
        h('label', { class: 'game-option', for: 'game-sound' }, sound,
          h('span', {}, h('span', { class: 'game-option-title', text: 'Sound effects' }),
            h('span', { class: 'game-option-note', text: 'Speech always plays' })))),
      h('a', { class: 'btn btn-quiet game-back', href: '#/' }, icon('back'), 'Back to Learn'));
    el.replaceChildren(screen);
    const head = screen.querySelector('h1');
    head.setAttribute('tabindex', '-1');
    try { head.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function startRun(mode, opts = {}) {
    stopRun();
    const seed = (opts.seed ?? globalThis.__gameSeed ?? Date.now()) >>> 0;
    const relaxed = !!opts.relaxed;
    saveGame(x => { x.last = { mode, relaxed }; });
    const state = core.createRun({
      letters: pools.letters, words: pools.words, sentences: pools.sentences, mode, seed, relaxed,
    });
    run = new Run(el, state, {
      onEnd: () => { if (run && run.state === state) showEnd(mode, state); },
      onQuit: () => showModes(),
    });
    if (opts.manual) run.manual = true;
    run.begin();
    return state;
  }

  function showEnd(mode, state) {
    const prev = gameStore().best[mode] || 0;
    const g = saveGame(x => {
      x.runs[mode] = (x.runs[mode] || 0) + 1;
      x.best[mode] = Math.max(x.best[mode] || 0, state.score);
    });
    const r = run;
    if (r) r.stop(false);
    run = null;
    const won = state.wavesCleared >= core.RULES.waves;
    const missed = state.missed.map(id => core.entryOf(state, id)).filter(Boolean);
    const list = h('ul', { class: 'game-missed' });
    for (const e of missed) {
      const play = h('button', { type: 'button', class: 'btn btn-quiet game-play', 'data-play': e.id },
        icon('play'), h('span', { class: 'visually-hidden', text: 'Play' }));
      play.addEventListener('click', () => { audio.play(e).catch(err => { play.dataset.failed = 'true'; play.title = 'The sound could not play'; return err; }); });
      if (!e.audio) play.disabled = true;
      const conf = e.confidence === 'low' ? confidenceLabel('low') : null;
      list.append(h('li', { class: 'game-missed-row', 'data-id': e.id },
        h('span', { class: 'game-missed-text', 'data-card': '' },
          teNode(e.te, { class: e.kind === 'letter' ? 'game-missed-te is-letter' : 'game-missed-te' }),
          e.rom ? h('span', { class: 'rom', text: e.rom }) : null,
          e.en ? h('span', { class: 'game-missed-en', text: e.en }) : null,
          conf),
        play));
    }
    const stat = (k, v, attr) => h('div', { class: 'game-end-stat', [attr]: String(v) },
      h('span', { class: 'game-end-v', text: String(v) }), h('span', { class: 'game-end-k', text: k }));
    const isBest = state.score > prev && state.score > 0;
    const screen = h('section', { class: 'game-end', 'data-game-screen': 'end', 'data-won': String(won) },
      h('h1', { class: 'screen-title', text: won ? 'All waves cleared' : 'The towns have fallen' }),
      h('p', { class: 'game-end-mode', text: core.MODES[mode].title + (state.relaxed ? ' · Relaxed' : '') }),
      h('div', { class: 'game-end-stats' },
        stat('Score', state.score, 'data-score'),
        stat('Best streak', state.bestStreak, 'data-best-streak'),
        stat('Waves cleared', `${state.wavesCleared} of ${core.RULES.waves}`, 'data-waves')),
      h('p', { class: 'game-end-best', 'data-best': String(g.best[mode]) },
        isBest ? h('strong', { text: 'New best score. ' }) : null, `Best for this mode: ${g.best[mode]}`),
      h('h2', { class: 'game-group', text: missed.length ? `Missed (${missed.length})` : 'Missed' }),
      missed.length ? list : h('p', { class: 'game-none', text: 'Nothing missed. Well played.' }),
      h('div', { class: 'game-end-actions' },
        h('button', { type: 'button', class: 'btn btn-main', 'data-again': '', onclick: () => startRun(mode, { relaxed: state.relaxed }) }, 'Play again'),
        h('a', { class: 'btn btn-secondary', href: '#/', 'data-done': '' }, 'Done')));
    el.replaceChildren(screen);
    const head = screen.querySelector('h1');
    head.setAttribute('tabindex', '-1');
    try { head.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  showModes();

  return () => {
    stopRun();
    audio.stop();
    undoDuck();
    sfx.close();
    delete el.__game;
  };
}

// ---- a run ---------------------------------------------------------------------------------------

const STARS = (() => {
  const r = core.makeRng(7);
  return Array.from({ length: 70 }, () => ({ x: r(), y: r() * 0.75, s: 0.5 + r() * 1.3, p: r() * 6.28 }));
})();
const SKYLINE = (() => {
  const r = core.makeRng(11);
  const out = [];
  let x = 0;
  while (x < 1) { const w = 0.03 + r() * 0.05; out.push({ x, w, h: 0.25 + r() * 0.55 }); x += w + 0.004; }
  return out;
})();
const TOWN_SHAPE = [[-0.085, 0.034, 0.55], [-0.045, 0.04, 1], [0.0, 0.03, 0.75], [0.035, 0.045, 0.9], [0.075, 0.025, 0.5]];

class Run {
  constructor(root, state, hooks) {
    this.root = root;
    this.state = state;
    this.hooks = hooks;
    this.manual = false;
    this.paused = false;
    this.ended = false;
    this.anim = 0;          // seconds, drives cosmetic animation
    this.rockets = [];      // {x0,y0,x1,y1,t,dur,wide}
    this.blasts = [];       // {x,y,t,big}
    this.shake = 0;
    this.flash = [0, 0, 0, 0];
    this.chips = new Map(); // tid -> element
    this.labels = [];
    this.reduced = reducedMotion();
    this.build();
  }

  build() {
    const s = this.state;
    const words = core.MODES[s.mode].kind === 'words';
    this.hud = {
      wave: h('span', { class: 'game-stat-v', 'data-hud': 'wave' }),
      score: h('span', { class: 'game-stat-v', 'data-hud': 'score' }),
      streak: h('span', { class: 'game-stat-v', 'data-hud': 'streak' }),
      towns: h('span', { class: 'game-towns', 'data-hud': 'towns' }),
    };
    const stat = (k, v) => h('span', { class: 'game-stat' }, h('span', { class: 'game-stat-k', text: k }), v);
    this.pauseBtn = h('button', { type: 'button', class: 'btn btn-quiet game-pause-btn', 'aria-label': 'Pause' }, gicon('pause'));
    this.pauseBtn.addEventListener('click', () => this.setPaused(true));
    this.wideBadge = h('span', { class: 'game-wide', hidden: true, text: 'Wide shot ready' });
    const hud = h('div', { class: 'game-hud' },
      stat('Wave', this.hud.wave), stat('Score', this.hud.score), stat('Streak', this.hud.streak),
      h('span', { class: 'game-stat game-stat-towns' }, h('span', { class: 'game-stat-k', text: 'Towns' }), this.hud.towns),
      this.pauseBtn);
    this.canvas = h('canvas', { class: 'game-canvas', 'aria-hidden': 'true' });
    this.layer = h('div', { class: 'game-targets' });
    this.overlay = h('div', { class: 'game-overlay', hidden: true });
    this.field = h('div', { class: 'game-field' }, this.canvas, this.layer, this.wideBadge, this.overlay);
    this.pad = h('div', { class: `game-launchers${words ? ' is-words' : ''}` });
    this.live = h('div', { class: 'visually-hidden', 'aria-live': 'polite', 'data-live': '' });
    this.screen = h('section', { class: 'game-run', 'data-game-screen': 'run', 'data-mode': s.mode, 'data-phase': s.phase },
      h('h1', { class: 'visually-hidden', text: `Sky Shield: ${core.MODES[s.mode].title}` }), hud, this.field, this.pad, this.live);
    this.root.replaceChildren(this.screen);

    this.onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (/^[1-4]$/.test(e.key)) {
        if (this.paused) return;
        e.preventDefault();
        this.press(Number(e.key) - 1);
      } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        this.setPaused(!this.paused);
      }
    };
    this.onVis = () => { if (document.hidden) this.setPaused(true); };
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro) this.ro.observe(this.field);
  }

  begin() {
    this.resize();
    this.syncLaunchers();
    this.syncHud();
    const h1 = this.screen.querySelector('h1');
    h1.setAttribute('tabindex', '-1');
    try { h1.focus({ preventScroll: true }); } catch { /* ignore */ }
    this.say(`Wave 1 of ${core.RULES.waves}.`);
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
  }

  // -- time --
  advance(secs) {
    let left = Math.max(0, Number(secs) || 0);
    while (left > 1e-9 && !this.ended) {
      const d = Math.min(0.05, left);
      left -= d;
      this.anim += d;
      this.tickFx(d);
      this.handle(core.step(this.state, d));
    }
    if (!this.ended) { this.sync(); this.draw(); }
  }

  setPaused(on) {
    if (this.ended || this.state.phase === 'end') return;
    if (on === this.paused) return;
    this.paused = on;
    this.screen.dataset.paused = String(on);
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

  // -- input --
  press(i) {
    if (this.ended || this.paused) return;
    const btn = this.pad.children[i];
    const from = btn ? this.launcherPoint(btn) : { x: 0.5, y: 1 };
    const evs = core.tap(this.state, i);
    if (evs.length) sfx.play('launch');
    for (const e of evs) {
      if (e.type === 'hit' || e.type === 'crack') {
        this.rocket(from, e, e.type === 'hit' && e.wide && e.wide.length > 0);
      }
    }
    this.handle(evs);
    this.sync();
    this.draw();
  }

  // -- events from core --
  handle(events) {
    const s = this.state;
    const m = core.MODES[s.mode];
    for (const e of events) {
      switch (e.type) {
        case 'spawn': {
          this.addChip(e);
          if (m.show === 'audio' || e.boss) this.speak(e.id);
          break;
        }
        case 'hit': {
          this.dropChip(e.tid);
          sfx.play('hit');
          for (const o of e.wide || []) {
            this.dropChip(o.tid);
            this.blasts.push({ x: o.x, y: o.y, t: 0, big: true });
          }
          if (m.show !== 'audio' && !e.boss) this.speak(e.id);
          if (e.boss) { this.speak(e.id); this.say('The sentence is complete.'); }
          break;
        }
        case 'crack': {
          sfx.play('hit');
          const chip = this.chips.get(e.tid);
          if (chip) this.fillBoss(chip);
          break;
        }
        case 'wide': this.say('Wide shot.'); break;
        case 'wideReady': this.say('Wide shot ready.'); break;
        case 'miss':
        case 'bossWrong': {
          sfx.play('wrong');
          const chip = this.chips.get(e.tid);
          if (chip && !this.reduced) { chip.classList.remove('is-shake'); void chip.offsetWidth; chip.classList.add('is-shake'); }
          break;
        }
        case 'land': {
          this.dropChip(e.tid);
          sfx.play('land');
          this.flash[e.town] = 0.6;
          if (!this.reduced) this.shake = 0.35;
          this.blasts.push({ x: e.x, y: 1, t: 0, big: true, land: true });
          this.reveal(e.id, e.boss);
          break;
        }
        case 'waveClear': {
          sfx.play('wave');
          const fix = e.repaired != null ? ' A town was repaired.' : '';
          this.showOverlay('banner', h('div', { class: 'game-banner', 'data-banner': String(e.wave) },
            h('span', { class: 'game-banner-title', text: `Wave ${e.wave} cleared` }),
            h('span', { class: 'game-banner-note', text: `+${core.RULES.waveBonus} points.${fix}` })));
          this.say(`Wave ${e.wave} cleared. Score ${s.score}.${fix}`);
          break;
        }
        case 'waveStart': {
          this.hideOverlay('banner');
          if (e.wave > 1) this.say(`Wave ${e.wave} of ${core.RULES.waves}.`);
          break;
        }
        case 'end': {
          this.ended = true;
          this.say(`Run over. Score ${e.score}.`);
          // let the live region speak before the screen changes
          const go = () => this.hooks.onEnd();
          if (this.manual) go(); else setTimeout(go, 600);
          break;
        }
        default: break;
      }
    }
    if (s.phase === 'play' && this.overlayKind === 'reveal') this.hideOverlay('reveal');
  }

  reveal(id, boss) {
    const e = core.entryOf(this.state, id);
    if (!e) return;
    const kids = [h('span', { class: 'game-card-kicker', text: boss ? 'The sentence was' : 'The answer was' }),
      teNode(e.te, { class: e.kind === 'letter' ? 'game-reveal-te is-letter' : 'game-reveal-te' })];
    if (e.rom) kids.push(h('span', { class: 'rom game-reveal-rom', text: e.rom }));
    if (e.en && e.kind !== 'letter') kids.push(h('span', { class: 'game-reveal-en', text: e.en }));
    this.showOverlay('reveal', h('div', { class: 'game-card game-reveal', 'data-reveal': id, 'data-card': '' }, ...kids));
    this.speak(id);
    const said = e.kind === 'letter' ? `"${e.rom}"` : (e.rom ? `"${e.en}", said ${e.rom}` : `"${e.en}"`);
    this.say(`A meteor hit a town. The answer was ${said}.`);
  }

  speak(id) {
    const e = core.entryOf(this.state, id);
    if (!e || !e.audio) return;
    audio.play(e).catch(err => { this.say('The sound could not play.'); return err; });
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
    if ((sv.kind === 'reveal' && this.state.phase !== 'freeze') || (sv.kind === 'banner' && this.state.phase !== 'banner')) return;
    this.overlay.dataset.kind = sv.kind;
    this.overlay.replaceChildren(...sv.kids);
    this.overlay.hidden = false;
  }

  // -- DOM sync --
  sync() {
    this.syncChips();
    this.syncLaunchers();
    this.syncHud();
    this.screen.dataset.phase = this.state.phase;
  }

  syncHud() {
    const s = this.state;
    this.hud.wave.textContent = `${s.wave}/${core.RULES.waves}`;
    this.hud.score.textContent = String(s.score);
    this.hud.streak.textContent = String(s.streak);
    const hp = s.towns.reduce((a, b) => a + b, 0);
    if (this.hud.towns.dataset.hp !== String(hp) || !this.hud.towns.childNodes.length) {
      this.hud.towns.dataset.hp = String(hp);
      this.hud.towns.replaceChildren(
        ...s.towns.map(t => h('span', { class: 'game-pip', 'data-hp': String(t), 'aria-hidden': 'true' })),
        h('span', { class: 'visually-hidden', text: s.relaxed ? 'Relaxed: towns take no damage' : `${hp} of ${core.RULES.towns * core.RULES.townHp} town hit points left` }));
    }
    this.wideBadge.hidden = !s.wideReady;
    this.pad.classList.toggle('is-wide', !!s.wideReady);
  }

  launcherLabel(text) {
    const m = core.MODES[this.state.mode];
    const kind = this.state.bossTarget ? 'te' : m.ans;
    if (kind === 'te') return teNode(text, { class: m.kind === 'letters' ? 'game-lab-te is-letter' : 'game-lab-te' });
    return h('span', { class: kind === 'rom' ? 'game-lab-rom' : 'game-lab-en', text });
  }

  syncLaunchers() {
    const s = this.state;
    const want = s.launchers;
    const n = core.launcherCount(s.wave);
    if (this.pad.children.length !== n) {
      this.pad.replaceChildren();
      for (let i = 0; i < n; i++) {
        const b = h('button', { type: 'button', class: 'game-launcher', 'data-launcher': String(i) },
          h('span', { class: 'game-key', 'aria-hidden': 'true', text: String(i + 1) }),
          h('span', { class: 'visually-hidden', text: `Launcher ${i + 1}: ` }),
          h('span', { class: 'game-lab' }),
          h('span', { class: 'game-jam', 'aria-hidden': 'true' }));
        b.addEventListener('click', () => this.press(i));
        this.pad.append(b);
      }
      this.labels = [];
    }
    [...this.pad.children].forEach((b, i) => {
      const text = want[i] ?? null;
      if (this.labels[i] !== text) {
        const lab = b.querySelector('.game-lab');
        lab.replaceChildren(text == null ? '' : this.launcherLabel(text));
        b.dataset.answer = text == null ? '' : 'set';
      }
      const jam = s.jam[i] || 0;
      const jammed = jam > 0;
      b.classList.toggle('is-jammed', jammed);
      if (jammed || text == null) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.style.setProperty('--jam', String(jam / core.RULES.jam));
    });
    this.labels = want.slice();
  }

  addChip(e) {
    const s = this.state;
    const ent = core.entryOf(s, e.id);
    const m = core.MODES[s.mode];
    let chip;
    if (e.boss) {
      chip = h('div', { class: 'game-chip is-boss', 'data-tid': String(e.tid), 'data-id': e.id },
        h('span', { class: 'game-chip-en', text: ent.en }),
        h('span', { class: 'game-boss-built' }),
        h('span', { class: 'game-boss-left' }));
      this.fillBoss(chip);
    } else if (ent.show.kind === 'audio') {
      chip = h('button', { type: 'button', class: 'game-chip is-audio', 'data-tid': String(e.tid), 'data-id': e.id, 'aria-label': 'Play the sound again' },
        gicon('speaker'));
      chip.addEventListener('click', () => this.speak(e.id));
    } else if (ent.show.kind === 'te') {
      chip = h('div', { class: 'game-chip', 'data-tid': String(e.tid), 'data-id': e.id },
        teNode(ent.show.text, { class: m.kind === 'letters' ? 'game-chip-te is-letter' : 'game-chip-te' }));
    } else {
      chip = h('div', { class: 'game-chip', 'data-tid': String(e.tid), 'data-id': e.id },
        h('span', { class: 'game-chip-en', text: ent.show.text }));
    }
    this.layer.append(chip);
    this.chips.set(e.tid, chip);
    this.place(chip, s.targets.find(t => t.tid === e.tid));
  }

  fillBoss(chip) {
    const t = this.state.bossTarget;
    if (!t) return;
    const built = chip.querySelector('.game-boss-built');
    const done = t.words.slice(0, t.next);
    built.replaceChildren(done.length ? teNode(done.join(' '), { class: 'game-boss-te' }) : '');
    chip.querySelector('.game-boss-left').textContent = `${t.words.length - t.next} of ${t.words.length} words left`;
    chip.style.setProperty('--crack', String(t.next / t.words.length));
  }

  dropChip(tid) {
    const c = this.chips.get(tid);
    if (c) { c.remove(); this.chips.delete(tid); }
  }

  syncChips() {
    const live = new Set();
    for (const t of this.state.targets) {
      live.add(t.tid);
      const c = this.chips.get(t.tid);
      if (c) this.place(c, t);
    }
    for (const tid of [...this.chips.keys()]) if (!live.has(tid)) this.dropChip(tid);
  }

  geom() {
    const W = this.W || this.field.clientWidth || 1, H = this.H || this.field.clientHeight || 1;
    const ground = H - Math.min(96, H * 0.16);
    return { W, H, top: 40, ground };
  }

  // field units -> pixels (chip centre)
  px(x, y) {
    const g = this.geom();
    return { x: x * g.W, y: g.top + y * (g.ground - g.top) };
  }

  place(chip, t) {
    if (!t) return;
    const g = this.geom();
    const p = this.px(t.x, t.y);
    const w = chip.offsetWidth || 60;
    const hh = chip.offsetHeight || 60;
    const x = Math.max(w / 2 + 4, Math.min(g.W - w / 2 - 4, p.x));
    const sh = this.shake > 0 && !this.reduced ? (Math.sin(this.anim * 90) * 4 * this.shake / 0.35) : 0;
    chip.style.transform = `translate(${(x - w / 2 + sh).toFixed(1)}px, ${(p.y - hh / 2).toFixed(1)}px)`;
    t._px = { x, y: p.y };
  }

  launcherPoint(btn) {
    const fr = this.field.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    return { px: br.left + br.width / 2 - fr.left, py: fr.height };
  }

  rocket(from, e, wide) {
    const to = this.px(e.x, e.y);
    const g = this.geom();
    const x1 = Math.max(20, Math.min(g.W - 20, to.x));
    this.rockets.push({ x0: from.px ?? g.W / 2, y0: from.py ?? g.H, x1, y1: to.y, t: 0, dur: 0.22, wide, ex: e.x, ey: e.y });
  }

  tickFx(d) {
    for (const r of this.rockets) {
      r.t += d;
      if (r.t >= r.dur && !r.done) { r.done = true; this.blasts.push({ px: r.x1, py: r.y1, t: 0, big: r.wide }); }
    }
    this.rockets = this.rockets.filter(r => r.t < r.dur + 0.25);
    for (const b of this.blasts) b.t += d;
    this.blasts = this.blasts.filter(b => b.t < 0.6);
    this.shake = Math.max(0, this.shake - d);
    this.flash = this.flash.map(f => Math.max(0, f - d));
  }

  resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const W = this.field.clientWidth, H = this.field.clientHeight;
    if (!W || !H) return;
    this.W = W; this.H = H;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.dpr = dpr;
    const cs = getComputedStyle(this.field);
    const v = n => cs.getPropertyValue(n).trim();
    this.col = {
      sky1: v('--game-sky-1'), sky2: v('--game-sky-2'), star: v('--game-star'),
      far: v('--game-far'), city: v('--game-city'), window: v('--game-window'), dark: v('--game-dark'),
      rock: v('--game-rock'), fire: v('--game-fire'), trail: v('--game-trail'), blast: v('--game-blast'),
      hurt: v('--game-hurt'), boss: v('--game-boss'),
    };
    this.syncChips();
    this.draw();
  }

  draw() {
    const c = this.canvas.getContext && this.canvas.getContext('2d');
    if (!c || !this.W) return;
    const { W, H, ground } = this.geom();
    const col = this.col;
    const R = this.reduced;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sh = this.shake > 0 && !R ? Math.sin(this.anim * 90) * 4 * this.shake / 0.35 : 0;
    // sky
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, col.sky1);
    g.addColorStop(1, col.sky2);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.save();
    c.translate(sh, 0);
    c.fillStyle = col.star;
    for (const st of STARS) {
      c.globalAlpha = R ? 0.7 : 0.45 + 0.4 * Math.sin(this.anim * 1.5 + st.p) ** 2;
      c.fillRect(st.x * W, st.y * ground, st.s, st.s);
    }
    c.globalAlpha = 1;
    // far skyline
    const base = H;
    c.fillStyle = col.far;
    for (const b of SKYLINE) c.fillRect(b.x * W, base - b.h * (H - ground) * 0.9, b.w * W, H);
    // towns
    const tw = Math.min(W * 0.22, 140);
    this.state.towns.forEach((hp, i) => {
      const cx = core.TOWN_X[i] * W;
      const tall = (H - ground) * 1.05;
      for (const [dx, w, hgt] of TOWN_SHAPE) {
        const bx = cx + dx * tw / 0.2, bw = w * tw / 0.2, bh = tall * hgt * (hp === 0 && !this.state.relaxed ? 0.3 : hp === 1 && !this.state.relaxed ? 0.75 : 1);
        c.fillStyle = col.city;
        c.fillRect(bx, base - bh, bw, bh);
        c.fillStyle = hp > 0 || this.state.relaxed ? col.window : col.dark;
        for (let wy = base - bh + 6; wy < base - 6; wy += 9) {
          for (let wx = bx + 4; wx < bx + bw - 4; wx += 7) {
            const on = ((wx * 7 + wy * 3) | 0) % (hp >= 2 || this.state.relaxed ? 3 : 5) !== 0;
            if (on) c.fillRect(wx, wy, 3, 4);
          }
        }
      }
      if (this.flash[i] > 0 && !R) {
        c.globalAlpha = this.flash[i];
        c.fillStyle = col.hurt;
        c.fillRect(cx - tw / 2, ground, tw, H - ground);
        c.globalAlpha = 1;
      }
    });
    // meteors (the label is a DOM chip on top; here the rock and its flame tail)
    for (const t of this.state.targets) {
      const p = t._px || this.px(t.x, t.y);
      const r = t.boss ? 46 : 26;
      const vx = (t.x1 - t.x0) * W, vy = ground;
      const len = Math.hypot(vx, vy) || 1;
      const ux = -vx / len, uy = -vy / len;
      const tail = t.boss ? 120 : 70;
      const tg = c.createLinearGradient(p.x, p.y, p.x + ux * tail, p.y + uy * tail);
      tg.addColorStop(0, col.fire);
      tg.addColorStop(1, 'transparent');
      c.fillStyle = tg;
      c.beginPath();
      c.moveTo(p.x + uy * r * 0.9, p.y - ux * r * 0.9);
      c.lineTo(p.x + ux * tail, p.y + uy * tail);
      c.lineTo(p.x - uy * r * 0.9, p.y + ux * r * 0.9);
      c.closePath();
      c.fill();
      c.fillStyle = t.boss ? col.boss : col.rock;
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
    }
    // rockets
    for (const r of this.rockets) {
      const k = Math.min(1, r.t / r.dur);
      const x = r.x0 + (r.x1 - r.x0) * k, y = r.y0 + (r.y1 - r.y0) * k;
      const k0 = Math.max(0, k - 0.45);
      const xt = r.x0 + (r.x1 - r.x0) * k0, yt = r.y0 + (r.y1 - r.y0) * k0;
      c.globalAlpha = r.done ? Math.max(0, 1 - (r.t - r.dur) / 0.25) : 1;
      const lg = c.createLinearGradient(xt, yt, x, y);
      lg.addColorStop(0, 'transparent');
      lg.addColorStop(1, col.trail);
      c.strokeStyle = lg;
      c.lineWidth = r.wide ? 6 : 4;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(xt, yt); c.lineTo(x, y); c.stroke();
      if (!r.done) { c.fillStyle = col.trail; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
    }
    // blasts: a ring; particles unless reduced motion
    for (const b of this.blasts) {
      const p = b.px != null ? { x: b.px, y: b.py } : this.px(b.x, b.y);
      const k = b.t / 0.6;
      const rad = (b.big ? 60 : 36) * (R ? 0.8 : (0.3 + k));
      c.globalAlpha = Math.max(0, 1 - k);
      c.strokeStyle = b.land ? col.hurt : col.blast;
      c.lineWidth = 3;
      c.beginPath(); c.arc(p.x, Math.min(p.y, H - 4), rad, 0, Math.PI * 2); c.stroke();
      if (!R) {
        c.fillStyle = b.land ? col.hurt : col.blast;
        for (let i = 0; i < 10; i++) {
          const a = i * 0.628 + b.t;
          c.fillRect(p.x + Math.cos(a) * rad * 0.8, p.y + Math.sin(a) * rad * 0.8, 3, 3);
        }
      }
      c.globalAlpha = 1;
    }
    c.restore();
  }
}
