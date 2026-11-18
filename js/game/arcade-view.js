// game/arcade-view.js: the run screen of Arcade (GAME-PLAN.md section 14). Rules live in
// game/arcade.js; this file draws the sky, turns a tap on the sky into a rocket, and shows the reload
// card (prompt on the left, three answers, keys 1 to 3). view.js opens it and shows the end screen.
//
//   new ArcadeRun(root, state, {onEnd, onQuit}).begin()
//   run.fireAt(x, y) -> events     (field units, as arcade.fire)
//   run.pick(i)      -> events     (answer i of the reload card)
//
// Telugu goes in only through teNode (DESIGN 3). No screen shake (DESIGN): a landing flashes the town.

import { teNode } from '../ui/te.js';
import { h, icon } from '../ex/common.js';
import * as core from './core.js';
import * as arcade from './arcade.js';
import * as sfx from './sfx.js';
import * as music from './music.js';
import { gicon, readColors, drawSky, drawCity, drawVignette, RunBase } from './shared.js';
import * as sprites from './sprites.js';
import { Fx, TEXT } from './fx.js';
import { drawText } from './pixel.js';

const pan = x => Math.max(-0.8, Math.min(0.8, (x - 0.5) * 1.5));

const QUESTION = {
  l2s: 'Which sound is this?',
  s2l: 'Which letter did you hear?',
  w2m: 'What does this mean?',
  m2w: 'Which Telugu word is this?',
  lw: 'Which word did you hear?',
};

export class ArcadeRun extends RunBase {
  constructor(root, state, hooks) {
    super(root, state, hooks);
    this.blasts = [];          // landings {x, t}
    this.sparks = [];          // flying bits (sprites.js)
    this.popups = [];          // points floating up
    this.muzzle = 0;           // seconds of muzzle flash left
    this.glare = 0;            // seconds of sky flash left (big rocket)
    this.combo = 0;            // kills in quick succession (the hit sound climbs)
    this.comboFor = 0;
    this.aim = 0;              // where the launcher points (radians, 0 = up)
    this.flash = [0, 0, 0, 0];
    this.noteFor = 0;          // seconds the note under the answers stays
    this.fx = new Fx(this.reduced);   // particles, rings, lights, pixel texts (fx.js)
    this.burstAt = new Map();  // burst id -> where it is (px), for chain lightning
    this.recoil = 0;           // the launcher kicking back
    this.trailAcc = 0;
    this.alarmed = false;      // the last-town alarm has sounded
    this.build();
  }

  get R() { return this.state.R; }

  build() {
    const s = this.state;
    const hud = this.makeHud();
    this.canvas = h('canvas', { class: 'game-canvas', 'aria-hidden': 'true' });
    this.bigBadge = h('span', { class: 'game-wide', hidden: true, 'data-big': '', text: 'Big rocket ready' });
    this.overlay = h('div', { class: 'game-overlay', hidden: true });
    this.field = h('div', { class: 'game-field is-arcade', 'data-sky': '' }, this.canvas, this.bigBadge, this.overlay);
    this.field.addEventListener('pointerdown', e => this.onSky(e));

    this.ammoPips = Array.from({ length: this.R.ammoMax }, () => h('span', { class: 'game-ammo-pip', 'aria-hidden': 'true' }, gicon('rocket')));
    this.ammoText = h('span', { class: 'visually-hidden' });
    this.ammoCount = h('span', { class: 'game-ammo-n', 'aria-hidden': 'true' });
    this.ammo = h('div', { class: 'game-ammo', 'data-ammo': String(s.ammo) },
      h('span', { class: 'game-ammo-k', 'aria-hidden': 'true', text: 'Rockets' }),
      h('span', { class: 'game-ammo-pips' }, ...this.ammoPips), this.ammoCount, this.ammoText);

    this.prompt = h('button', { type: 'button', class: 'game-prompt', 'data-prompt': '' });
    this.prompt.addEventListener('click', () => { if (s.card && !this.paused) this.speak(s.card.id); });
    // one line over the answers: the question, or a short note after an answer
    this.answers = h('div', { class: 'game-answers' });
    for (let i = 0; i < this.R.choices; i++) {
      const b = h('button', { type: 'button', class: 'game-answer', 'data-answer': String(i) },
        h('span', { class: 'game-key', 'aria-hidden': 'true', text: String(i + 1) }),
        h('span', { class: 'visually-hidden', text: `Answer ${i + 1}: ` }),
        h('span', { class: 'game-lab' }),
        h('span', { class: 'game-mark' }));
      b.addEventListener('click', () => this.pick(i));
      this.answers.append(b);
    }
    this.note = h('p', { class: 'game-reload-note', 'data-note': '' }, h('span', { text: QUESTION[s.mode] }));
    this.lockBar = h('span', { class: 'game-lock', 'aria-hidden': 'true' });
    this.card = h('div', { class: 'game-reload', 'data-card': '' },
      h('div', { class: 'game-prompt-wrap' }, this.prompt, h('span', { class: 'game-prompt-hint', 'aria-hidden': 'true', text: 'Tap to hear' })),
      h('div', { class: 'game-reload-main' }, this.note, this.answers), this.lockBar);

    this.live = h('div', { class: 'visually-hidden', 'aria-live': 'polite', 'data-live': '' });
    this.screen = h('section', { class: 'game-run is-arcade', 'data-game-screen': 'run', 'data-game': 'arcade', 'data-mode': s.mode, 'data-phase': s.phase },
      h('h1', { class: 'visually-hidden', text: `Sky Shield Arcade: ${core.MODES[s.mode].title}` }),
      hud, this.field, this.ammo, this.card, this.live);
    this.root.replaceChildren(this.screen);
    this.listen();
  }

  key(e) {
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= this.R.choices) {
      e.preventDefault();
      this.pick(Number(e.key) - 1);
    }
  }

  stepRules(d) { return arcade.step(this.state, d); }
  entry(id) { return arcade.entryOf(this.state, id); }

  begin() {
    this.resize();
    this.renderCard();
    this.sync();
    this.say(`Wave 1 of ${this.R.waves}. Tap the sky to fire. Answer to reload.`);
    if (this.W) this.fx.title('WAVE 1', this.W, this.H);
    this.promptSpeaks();
    this.loop();
  }

  // -- input --
  onSky(e) {
    if (e.button != null && e.button !== 0) return;
    if (this.ended || this.paused || this.state.phase !== 'play') return;
    const r = this.canvas.getBoundingClientRect();
    const g = this.geom();
    const x = (e.clientX - r.left) / g.W;
    const y = (e.clientY - r.top - g.top) / (g.ground - g.top);
    e.preventDefault();
    this.fireAt(x, y);
  }

  fireAt(x, y) {
    if (this.ended || this.paused) return [];
    const evs = arcade.fire(this.state, x, y);
    this.handle(evs);
    this.sync();
    this.draw();
    return evs;
  }

  pick(i) {
    if (this.ended || this.paused) return [];
    const evs = arcade.answer(this.state, i);
    this.handle(evs);
    this.sync();
    this.draw();
    return evs;
  }

  // -- events from the rules --
  handle(events) {
    const s = this.state;
    let hit = false, hitX = 0.5;
    const fx = this.fx, on = !!this.W;
    const g = this.geom();
    const bx = this.R.baseX * g.W;
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          sfx.play('launch', { pan: pan(e.x) });
          if (e.ammo === 0) sfx.play('lowammo');
          this.muzzle = 0.14;
          this.recoil = 1;
          if (on) {
            const to = this.px(e.x, e.y);
            const len = Math.hypot(to.x - bx, to.y - g.ground) || 1;
            fx.muzzle(bx, g.ground - 8, (to.x - bx) / len, (to.y - g.ground) / len, e.big);
          }
          break;
        }
        case 'empty': {
          sfx.play('empty');
          if (on) fx.text('NO AMMO', bx, g.ground - 46, { cols: TEXT.red, scale: 2, life: 1.1, rise: -10 });
          this.setNote('info', 'No rockets. Answer to reload.');
          this.say('No rockets. Answer a card to reload.');
          this.nudge();
          break;
        }
        case 'spawn': {
          sfx.play(e.split ? 'warn' : 'entry', { pan: pan(e.x) });
          if (on) {
            const q = this.px(e.x, 0);
            fx.entry(q.x, q.y + 6);
            if (e.split) fx.warn(Math.max(24, Math.min(g.W - 24, q.x)), q.y + 30);
          }
          break;
        }
        case 'kill': {
          hit = true; hitX = e.x;
          this.combo += 1; this.comboFor = 1.2;
          if (on) {
            const q = this.px(e.x, e.y);
            fx.shatter(q.x, q.y, this.R.meteorR * g.W * 1.2);
            sprites.popup(this.popups, q.x, q.y, `+${e.points}`, { hot: !!e.chain });
            const from = this.burstAt.get(e.by);
            if (e.chain && from) fx.link(from.x, from.y, q.x, q.y);
            if (this.combo >= 2) {
              // above the points popup (which may itself have been stacked), rising a little faster
              const pq = this.popups[this.popups.length - 1];
              const py = pq ? pq.y : q.y;
              fx.text(e.chain ? `CHAIN x${this.combo}` : `COMBO x${this.combo}`, q.x, py - 14 - 36,
                { cols: this.combo >= 5 ? TEXT.hot : e.chain ? TEXT.cool : TEXT.gold, scale: this.combo >= 4 ? 3 : 2, rise: -40 });
            }
          }
          break;
        }
        case 'burst': {
          if (e.kind === 'chain') sfx.play('chain', { pan: pan(e.x) });
          else sfx.play(e.kind === 'big' ? 'bigboom' : 'boom', { pan: pan(e.x) });
          if (on) {
            const q = this.px(e.x, e.y);
            this.burstAt.set(e.bid, q);
            if (this.burstAt.size > 24) this.burstAt.delete(this.burstAt.keys().next().value);
            fx.explode(q.x, q.y, e.r * g.W, e.kind === 'big' ? 'big' : e.kind === 'chain' ? 'chain' : 'shot');
          }
          break;
        }
        case 'split': {
          sfx.play('split', { pan: pan(e.x) });
          if (on) { const q = this.px(e.x, e.y); fx.splitPop(q.x, q.y); fx.text('SPLIT', q.x, q.y - 26, { cols: TEXT.pink, scale: 2, life: 0.7 }); }
          break;
        }
        case 'land': {
          sfx.play('land', { pan: pan(e.x) });
          this.flash[e.town] = 0.6;
          this.blasts.push({ x: e.x, t: 0 });
          if (on) fx.impact(e.x * g.W, g.ground, { size: 40 });
          if (!s.relaxed && e.hp === 0) {
            sfx.play('crumble', { pan: pan(e.x) });
            if (on) fx.collapse(core.TOWN_X[e.town] * g.W, g.H, Math.min(g.W * 0.22, 140));
          }
          if (!s.relaxed && !this.alarmed && s.towns.filter(t => t > 0).length === 1) {
            this.alarmed = true;
            sfx.play('alarm');
            if (on) fx.text('LAST TOWN', g.W / 2, g.ground * 0.5, { cols: TEXT.red, scale: 3, life: 1.6, rise: 0 });
          }
          this.say(s.relaxed ? 'A meteor reached a town.' : 'A meteor hit a town.');
          break;
        }
        case 'card': this.renderCard(); this.promptSpeaks(); break;
        case 'right': {
          sfx.play('reload');
          if (on) fx.reload(bx, g.ground - 10);
          const text = e.gained > 0 ? `Right. +${e.gained} rockets.` : 'Right. Rockets full.';
          this.setNote('right', text);
          this.say(text);
          break;
        }
        case 'wrong': {
          sfx.play('wrong');
          this.showReveal();
          this.speak(e.id);
          const ent = this.entry(e.id);
          const said = ent.kind === 'letter' ? `"${ent.rom}"` : (ent.rom ? `"${ent.en}", said ${ent.rom}` : `"${ent.en}"`);
          this.say(`Not right. The answer is ${said}.${e.lost ? ' One rocket lost.' : ''}`);
          break;
        }
        case 'bigReady': {
          sfx.play('ready');
          if (on) fx.text('BIG ROCKET', bx, g.ground - 56, { cols: TEXT.cool, scale: 2, life: 1.4, rise: -14 });
          this.say('Three right in a row. Big rocket ready.');
          break;
        }
        case 'waveClear': {
          sfx.play('wave');
          if (e.repaired != null) {
            sfx.play('repair');
            if (on) fx.repair(core.TOWN_X[e.repaired] * g.W, g.ground, Math.min(g.W * 0.22, 140));
          }
          const fix = e.repaired != null ? ' A town was repaired.' : '';
          this.showOverlay('banner', h('div', { class: 'game-banner', 'data-banner': String(e.wave) },
            h('span', { class: 'game-banner-title', text: `Wave ${e.wave} cleared` }),
            h('span', { class: 'game-banner-note', text: `+${e.bonus + e.ammoBonus} points.${fix}` })));
          this.say(`Wave ${e.wave} cleared. Score ${s.score}.${fix}`);
          break;
        }
        case 'waveStart': {
          this.hideOverlay('banner');
          music.setWave(e.wave);
          if (e.wave > 1) sfx.play('start');
          if (e.wave > 1) this.say(`Wave ${e.wave} of ${this.R.waves}.`);
          if (e.wave > 1 && on) {
            const last = e.wave >= this.R.waves;
            fx.title(last ? 'FINAL WAVE' : `WAVE ${e.wave}`, g.W, g.H, { cols: last ? TEXT.hot : TEXT.gold });
          }
          break;
        }
        case 'end': {
          this.ended = true;
          const won = e.wavesCleared >= this.R.waves;
          sfx.play(won ? 'win' : 'over');
          if (on && won) for (let i = 0; i < 4; i++) fx.shell(g.W * (0.2 + i * 0.2), g.ground, g.W * (0.15 + Math.random() * 0.7), g.H * (0.15 + Math.random() * 0.25), i * 0.12);
          if (on && !won) fx.ash = { W: g.W, H: g.H };
          this.say(`Run over. Score ${e.score}.`);
          const go = () => this.hooks.onEnd();
          if (this.manual) go(); else setTimeout(go, 600);
          break;
        }
        default: break;
      }
    }
    if (hit) {
      sfx.play('hit', { pitch: 1 + 0.09 * Math.min(6, this.combo - 1), pan: pan(hitX) });
      if (this.combo >= 3) sfx.play('combo', { pitch: 1 + 0.06 * Math.min(8, this.combo - 3), pan: pan(hitX) });
    }
  }

  /** Sound modes: the prompt is a sound, so it plays when the card appears. */
  promptSpeaks() {
    const s = this.state;
    if (!s.card || s.phase === 'end') return;
    if (this.entry(s.card.id)?.show.kind === 'audio') this.speak(s.card.id);
  }

  setNote(kind, text) {
    this.note.dataset.kind = kind;
    this.note.replaceChildren(icon(kind === 'right' ? 'tick' : kind === 'wrong' ? 'cross' : 'info'), h('span', { text }));
    this.noteFor = kind === 'wrong' ? 0 : 1.6;
  }

  clearNote() {
    delete this.note.dataset.kind;
    this.note.replaceChildren(h('span', { text: QUESTION[this.state.mode] }));
  }

  nudge() {
    if (this.reduced) return;
    this.card.classList.remove('is-nudge');
    void this.card.offsetWidth;
    this.card.classList.add('is-nudge');
  }

  answerLabel(text) {
    const m = core.MODES[this.state.mode];
    if (m.ans === 'te') return teNode(text, { class: m.kind === 'letters' ? 'game-lab-te is-letter' : 'game-lab-te' });
    return h('span', { class: m.ans === 'rom' ? 'game-lab-rom' : 'game-lab-en', text });
  }

  renderCard() {
    const s = this.state;
    const c = s.card;
    if (!c) return;
    const e = this.entry(c.id);
    const m = core.MODES[s.mode];
    this.card.dataset.n = String(c.n);
    this.card.dataset.id = c.id;
    this.card.dataset.back = String(!!c.back);
    let kid;
    if (e.show.kind === 'audio') {
      kid = [gicon('speaker'), h('span', { class: 'visually-hidden', text: 'Play the sound again' })];
    } else if (e.show.kind === 'te') {
      kid = [teNode(e.show.text, { class: m.kind === 'letters' ? 'game-prompt-te is-letter' : 'game-prompt-te' }),
        h('span', { class: 'visually-hidden', text: e.audio ? ': play the sound' : '' })];
    } else {
      kid = [h('span', { class: 'game-prompt-en', text: e.show.text }),
        h('span', { class: 'visually-hidden', text: e.audio ? ': play the Telugu' : '' })];
    }
    this.prompt.replaceChildren(...kid);
    this.prompt.dataset.kind = e.show.kind;
    this.prompt.disabled = !e.audio;
    this.card.classList.toggle('no-audio', !e.audio);
    [...this.answers.children].forEach((b, i) => {
      b.classList.remove('is-wrong', 'is-answer');
      b.querySelector('.game-lab').replaceChildren(this.answerLabel(c.choices[i]));
      b.querySelector('.game-mark').replaceChildren();
      b.dataset.text = c.choices[i];
    });
    if (this.note.dataset.kind === 'wrong' || this.note.dataset.kind === 'lock') this.clearNote();
    this.answers.classList.toggle('is-words', m.kind === 'words');
  }

  // A wrong answer: the pick is marked wrong, the right one gets the dashed answer border; the card
  // stays locked for state.lock seconds.
  showReveal() {
    const v = this.state.reveal;
    if (!v) return;
    const bs = [...this.answers.children];
    const mark = (b, cls, ic, word) => {
      b.classList.add(cls);
      b.querySelector('.game-mark').replaceChildren(icon(ic), h('span', { text: word }));
    };
    if (bs[v.choice]) mark(bs[v.choice], 'is-wrong', 'cross', 'Wrong');
    if (bs[v.right]) mark(bs[v.right], 'is-answer', 'tick', 'Answer');
    this.setNote('wrong', 'Not quite. Back soon.');
    this.lockTotal = this.state.lock;
  }

  // -- DOM sync --
  sync() {
    const s = this.state;
    this.writeHud(this.R.waves, this.R.towns * this.R.townHp);
    this.screen.dataset.phase = s.phase;
    this.screen.dataset.ammo = String(s.ammo);
    this.ammo.dataset.ammo = String(s.ammo);
    this.ammoPips.forEach((p, i) => p.classList.toggle('is-full', i < s.ammo));
    this.ammoCount.textContent = String(s.ammo);
    this.ammoText.textContent = `${s.ammo} of ${this.R.ammoMax} rockets`;
    this.ammo.classList.toggle('is-empty', s.ammo === 0);
    this.ammo.classList.toggle('is-big', !!s.bigReady);
    this.bigBadge.hidden = !s.bigReady;
    const locked = s.lock > 0;
    this.card.dataset.locked = String(locked);
    for (const b of this.answers.children) {
      if (locked || s.phase === 'end') b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    }
    this.lockBar.style.setProperty('--lock', locked && this.lockTotal ? String(s.lock / this.lockTotal) : '0');
  }

  spark(x, y, n) {
    if (this.reduced || !this.W || x == null || y == null) return;
    const p = this.px(x, y);
    sprites.sparks(this.sparks, p.x, p.y, n);
  }

  tickFx(d) {
    this.fx.step(d);
    this.recoil = Math.max(0, this.recoil - d * 7);
    // rocket exhaust, about 60 puffs a second per rocket
    this.trailAcc += d;
    if (this.W && this.trailAcc >= 1 / 60) {
      this.trailAcc = 0;
      const g = this.geom(), bx = this.R.baseX * g.W;
      for (const r of this.state.rockets) {
        const to = this.px(r.x, r.y), k = Math.min(1, r.t / r.dur);
        const len = Math.hypot(to.x - bx, to.y - g.ground) || 1;
        this.fx.trail(bx + (to.x - bx) * k, g.ground + (to.y - g.ground) * k, (to.x - bx) / len, (to.y - g.ground) / len, r.big);
      }
    }
    this.sparks = sprites.stepSparks(this.sparks, d);
    this.popups = sprites.stepPopups(this.popups, d);
    this.muzzle = Math.max(0, this.muzzle - d);
    this.glare = Math.max(0, this.glare - d);
    if (this.comboFor > 0) { this.comboFor -= d; if (this.comboFor <= 0) this.combo = 0; }
    for (const b of this.blasts) b.t += d;
    this.blasts = this.blasts.filter(b => b.t < 0.6);
    this.flash = this.flash.map(f => Math.max(0, f - d));
    if (this.noteFor > 0) {
      this.noteFor -= d;
      if (this.noteFor <= 0 && this.note.dataset.kind !== 'wrong') this.clearNote();
    }
  }

  // -- drawing --
  geom() {
    const W = this.W || this.field.clientWidth || 1, H = this.H || this.field.clientHeight || 1;
    const ground = H - Math.min(64, H * 0.15);
    return { W, H, top: 10, ground };
  }

  px(x, y) {
    const g = this.geom();
    return { x: x * g.W, y: g.top + y * (g.ground - g.top) };
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
    this.col = readColors(this.field);
    const g = this.geom();
    this.state.aspect = (g.ground - g.top) / W;
    this.draw();
  }

  draw() {
    const c = this.canvas.getContext && this.canvas.getContext('2d');
    if (!c || !this.W) return;
    const s = this.state;
    const { W, H, ground } = this.geom();
    const col = this.col;
    const RM = this.reduced;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawSky(c, W, H, col);
    drawCity(c, { W, H, ground, col, anim: this.anim, reduced: RM, towns: s.towns, relaxed: s.relaxed, flash: this.flash, townX: core.TOWN_X, light: this.fx });
    this.fx.draw(c, 'back');

    // the launcher between the middle towns; it points at the last rocket fired
    const bx = this.R.baseX * W;
    const last = s.rockets[s.rockets.length - 1];
    if (last) { const to = this.px(last.x, last.y); this.aim = Math.atan2(to.x - bx, ground - to.y); }
    sprites.drawBase(c, bx, ground, H, { aim: this.aim, anim: this.anim, reduced: RM, col, empty: s.ammo === 0, flash: this.muzzle / 0.14, recoil: this.recoil, charge: !!s.bigReady, ammo: s.ammo, ammoMax: this.R.ammoMax });
    if (s.ammo === 0 && s.phase === 'play' && (RM || Math.floor(this.anim * 3) % 2 === 0)) drawText(c, 'NO AMMO', bx, ground - 44, 2, TEXT.red);
    else if (s.ammo > 0 && s.ammo <= 2 && s.phase === 'play') drawText(c, 'LOW', bx, ground - 44, 1, TEXT.hot, RM ? 0.9 : 0.6 + 0.4 * Math.sin(this.anim * 6));

    // meteors: a rock with a flame tail; a meteor that will split has a glowing seam
    const rr = Math.max(10, this.R.meteorR * W * 1.2);
    const top = this.geom().top;
    // danger: a red mark on the ground under each meteor in the lower part of the sky
    if (!s.relaxed && s.phase === 'play') {
      for (const m of s.meteors) if (m.y > 0.68) sprites.drawDanger(c, m.x1 * W, ground, Math.min(1, (m.y - 0.68) / 0.3), { anim: this.anim, reduced: RM });
    }
    for (const m of s.meteors) {
      const p = this.px(m.x, m.y);
      const dx = (m.x1 - m.sx) * W, dy = (ground - top) * (1 - m.sy);
      const len = Math.hypot(dx, dy) || 1;
      const r = m.kid ? rr * 0.8 : m.split ? rr * 1.25 : rr;
      sprites.drawMeteor(c, p.x, p.y, r, -dx / len, -dy / len,
        { anim: this.anim, reduced: RM, kind: m.split ? 'split' : m.kid ? 'kid' : 'rock', seed: Math.round(m.sx * 997) + 1, col, charge: m.split ? m.y / this.R.splitAt : 0 });
    }

    // rockets: a mark where each is going, the rocket and its smoke
    for (const r of s.rockets) {
      const to = this.px(r.x, r.y);
      const k = Math.min(1, r.t / r.dur);
      sprites.drawMark(c, to.x, to.y, { anim: this.anim, reduced: RM, big: r.big });
      sprites.drawRocket(c, bx, ground, bx + (to.x - bx) * k, ground + (to.y - ground) * k, { anim: this.anim, reduced: RM, big: r.big, trail: false });
    }

    // bursts: the dotted ring is the full reach, live for the whole life
    for (const b of s.bursts) {
      const p = this.px(b.x, b.y);
      sprites.drawBurst(c, p.x, p.y, b.r * W, Math.min(1, b.t / this.R.burstLife), { kind: b.kind, reduced: RM });
    }

    // landings and flying bits
    for (const b of this.blasts) sprites.drawGroundBlast(c, b.x * W, ground, b.t / 0.6, { reduced: RM });
    sprites.drawSparks(c, this.sparks);
    this.fx.draw(c, 'front');
    sprites.drawPopups(c, this.popups);
    // one town left: a slow red pulse at the edges (steady under reduced motion)
    if (!s.relaxed && s.phase !== 'end' && s.towns.filter(t => t > 0).length === 1) {
      drawVignette(c, W, H, RM ? 0.22 : 0.2 + 0.1 * Math.sin(this.anim * 3), col.hurt || '#E23D3D');
    }
  }
}
