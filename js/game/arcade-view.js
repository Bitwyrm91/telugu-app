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
import { gicon, readColors, drawSky, drawCity, RunBase } from './shared.js';

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
    this.blasts = [];          // landing rings {x, t}
    this.flash = [0, 0, 0, 0];
    this.noteFor = 0;          // seconds the note under the answers stays
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
    let hit = false;
    for (const e of events) {
      switch (e.type) {
        case 'fire': sfx.play('launch'); break;
        case 'empty': {
          sfx.play('empty');
          this.setNote('info', 'No rockets. Answer to reload.');
          this.say('No rockets. Answer a card to reload.');
          this.nudge();
          break;
        }
        case 'kill': hit = true; break;
        case 'land': {
          sfx.play('land');
          this.flash[e.town] = 0.6;
          this.blasts.push({ x: e.x, t: 0 });
          this.say(s.relaxed ? 'A meteor reached a town.' : 'A meteor hit a town.');
          break;
        }
        case 'card': this.renderCard(); this.promptSpeaks(); break;
        case 'right': {
          sfx.play('reload');
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
        case 'bigReady': this.say('Three right in a row. Big rocket ready.'); break;
        case 'waveClear': {
          sfx.play('wave');
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
          if (e.wave > 1) this.say(`Wave ${e.wave} of ${this.R.waves}.`);
          break;
        }
        case 'end': {
          this.ended = true;
          this.say(`Run over. Score ${e.score}.`);
          const go = () => this.hooks.onEnd();
          if (this.manual) go(); else setTimeout(go, 600);
          break;
        }
        default: break;
      }
    }
    if (hit) sfx.play('hit');
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

  tickFx(d) {
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
    drawCity(c, { W, H, ground, col, anim: this.anim, reduced: RM, towns: s.towns, relaxed: s.relaxed, flash: this.flash, townX: core.TOWN_X });

    // the launch base between the middle towns
    const bx = this.R.baseX * W;
    c.fillStyle = col.trail;
    c.beginPath();
    c.moveTo(bx - 14, ground + 6); c.lineTo(bx - 6, ground - 8); c.lineTo(bx + 6, ground - 8); c.lineTo(bx + 14, ground + 6);
    c.closePath(); c.fill();
    c.fillStyle = col.city;
    c.fillRect(bx - 18, ground + 6, 36, H - ground);

    // meteors: a rock with a flame tail; a meteor that will split has a ring
    const rr = Math.max(10, this.R.meteorR * W * 1.2);
    for (const m of s.meteors) {
      const p = this.px(m.x, m.y);
      const dx = (m.x1 - m.sx) * W, dy = (ground - this.geom().top) * (1 - m.sy);
      const len = Math.hypot(dx, dy) || 1;
      const ux = -dx / len, uy = -dy / len;
      const r = m.kid ? rr * 0.8 : m.split ? rr * 1.25 : rr;
      const tail = r * 4;
      const tg = c.createLinearGradient(p.x, p.y, p.x + ux * tail, p.y + uy * tail);
      tg.addColorStop(0, col.fire);
      tg.addColorStop(1, 'transparent');
      c.fillStyle = tg;
      c.beginPath();
      c.moveTo(p.x + uy * r * 0.9, p.y - ux * r * 0.9);
      c.lineTo(p.x + ux * tail, p.y + uy * tail);
      c.lineTo(p.x - uy * r * 0.9, p.y + ux * r * 0.9);
      c.closePath(); c.fill();
      c.fillStyle = m.split ? col.boss : col.rock;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      if (m.split) {
        c.strokeStyle = col.hurt; c.lineWidth = 2;
        c.beginPath(); c.arc(p.x, p.y, r + 4, 0, Math.PI * 2); c.stroke();
      }
    }

    // rockets: a mark where each is going, the rocket and its trail
    for (const r of s.rockets) {
      const to = this.px(r.x, r.y);
      const k = Math.min(1, r.t / r.dur);
      const x = bx + (to.x - bx) * k, y = ground + (to.y - ground) * k;
      const k0 = Math.max(0, k - 0.35);
      const xt = bx + (to.x - bx) * k0, yt = ground + (to.y - ground) * k0;
      c.strokeStyle = col.trail; c.lineWidth = 1.5; c.globalAlpha = 0.8;
      c.beginPath(); c.moveTo(to.x - 7, to.y); c.lineTo(to.x + 7, to.y); c.moveTo(to.x, to.y - 7); c.lineTo(to.x, to.y + 7); c.stroke();
      c.globalAlpha = 1;
      const lg = c.createLinearGradient(xt, yt, x, y);
      lg.addColorStop(0, 'transparent');
      lg.addColorStop(1, r.big ? col.blast : col.trail);
      c.strokeStyle = lg; c.lineWidth = r.big ? 6 : 3.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(xt, yt); c.lineTo(x, y); c.stroke();
      c.fillStyle = r.big ? col.blast : col.trail;
      c.beginPath(); c.arc(x, y, r.big ? 5 : 3.5, 0, Math.PI * 2); c.fill();
    }

    // bursts: the full reach is live for the whole life; it fades out
    for (const b of s.bursts) {
      const p = this.px(b.x, b.y);
      const k = b.t / this.R.burstLife;
      const rad = b.r * W;
      const shown = RM ? rad : rad * Math.min(1, 0.55 + k * 1.5);
      c.globalAlpha = Math.max(0, 0.55 * (1 - k));
      c.fillStyle = b.kind === 'chain' ? col.fire : col.blast;
      c.beginPath(); c.arc(p.x, p.y, shown, 0, Math.PI * 2); c.fill();
      c.globalAlpha = Math.max(0, 1 - k);
      c.strokeStyle = b.kind === 'chain' ? col.fire : col.blast; c.lineWidth = b.kind === 'big' ? 4 : 2.5;
      c.beginPath(); c.arc(p.x, p.y, shown, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }

    // landings: a red ring at the ground
    for (const b of this.blasts) {
      const k = b.t / 0.6;
      c.globalAlpha = Math.max(0, 1 - k);
      c.strokeStyle = col.hurt; c.lineWidth = 3;
      c.beginPath(); c.arc(b.x * W, ground, 40 * (RM ? 0.8 : 0.3 + k), 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }
  }
}
