// write/ladder.js: the stage runner for one target (SPECS S17 "Stages").
//
//   describe(id, lettersJson, strokesJson) -> item | null
//     item {id, text, carrier, display, rom, letter (audio), entry (stroke data or null), syllable}
//   mountLadder(root, item, opts) -> {ready, destroy()}
//     opts.from      first stage (default: the stored stage; syllables start at Copy)
//     opts.to        last stage (default 4)
//     opts.record    false: nothing is stored (default true)
//     opts.rivals    look-alike items ([item]) for the rival check
//     opts.onStage(i, outcome, res)  after each stage: outcome 'pass' | 'skip'
//     opts.onFinish({passed, skipped}) after the last stage
//     opts.inLesson  the lesson step: no "Next" after the last stage (the step's Continue goes on)
// Test hooks on [data-ladder]: data-stage (watch|trace|fade|copy|recall|done), data-fails,
// data-result (pass|fail while shown), data-stars; el.__ladder = {draw(strokes), check(), next()}.

import { h } from '../ex/common.js';
import { noteNode } from '../ex/letter.js';
import { teNode } from '../ui/te.js';
import { mountDraw, drawStyles } from '../ui/draw.js';
import { strokeEntryOk } from '../exgen.js';
import * as audio from '../audio.js';
import { gradeShape } from './shape.js';
import { getTarget, targetFor, fontReady, SIGN_TYPES } from './glyph.js';
import { mountPad } from './pad.js';
import * as prog from './progress.js';

export const STAGE_NAMES = ['Watch', 'Trace', 'Fade', 'Copy', 'Recall'];
const KEYS = prog.STAGES;
const AUTO_MS = 1200;
const FAILS_FOR_HELP = 3;

export function describe(id, L, S) {
  const letters = (L && L.letters) || [];
  const carrier = (L && L.carrier) || 'న';
  const m = /^S:([^+]+)\+(.+)$/.exec(String(id));
  if (m) {
    const b = L && L.built && L.built[m[1]] && L.built[m[1]][m[2]];
    if (!b) return null;
    return { id, text: b.te, carrier: null, display: b.te, rom: b.rom, letter: null, entry: null, syllable: true, parts: [m[1], m[2]] };
  }
  const letter = letters.find(l => l.id === id);
  if (!letter) return null;
  const t = targetFor(letter, carrier);
  const entry = S && S.letters && strokeEntryOk(S.letters[id]) ? S.letters[id] : null;
  return { id, text: t.text, carrier: t.carrier, display: t.display, rom: letter.rom || id, letter, entry,
    syllable: false, sign: SIGN_TYPES.has(letter.type) };
}

function starSvg(on) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `wl-star${on ? ' is-on' : ''}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = '<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" stroke-linejoin="round" stroke-width="1.6"/>';
  return s;
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function buzz() {
  if (reducedMotion()) return;
  try { if (navigator.vibrate) navigator.vibrate(15); } catch { /* ignore */ }
}

const PRAISE = {
  3: 'Clean shape.',
  2: 'Good shape. A little neater next time.',
  1: 'It counts. Slow down for a neater shape.',
};

/** What a pass says, from the grade: the weakest of fit, coverage and size. */
function praise(res) {
  if (!res || !res.stars) return PRAISE[1];
  if (res.stars === 3) return PRAISE[3];
  const tips = [];
  if (res.R < 0.92) tips.push('reach every part of the letter');
  if (res.P < 0.92) tips.push('keep the ink on the letter');
  if (res.C < 0.6) tips.push('stay near the middle of each line');
  return tips.length ? `${res.stars === 2 ? 'Good shape' : 'It counts'}. Next time ${tips[0]}.` : PRAISE[res.stars];
}

export function mountLadder(root, item, opts = {}) {
  drawStyles();
  let alive = true;
  const stored = prog.getItem(item.id);
  const first = item.syllable ? 3 : 0;
  let stageI = Math.max(first, Math.min(4, opts.from ?? stored.stage));
  const to = Math.min(4, opts.to ?? 4);
  if (stageI > to) stageI = to;
  const record = opts.record !== false;
  let passed = 0, skipped = 0;
  let fails = 0, timer = 0, sub = null, pad = null, graded = null, shownHelp = false, busy = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };

  const el = h('div', { class: 'wl', 'data-ladder': '', 'data-item': item.id });
  const dots = h('ol', { class: 'wl-dots', 'aria-label': 'Stages' }, STAGE_NAMES.map((n, i) => h('li', { 'data-i': String(i) },
    h('span', { class: 'wl-dot', 'aria-hidden': 'true' }), h('span', { class: 'wl-dot-name', text: n }))));
  if (item.syllable) [...dots.children].slice(0, 3).forEach(d => { d.hidden = true; });
  const head = h('p', { class: 'wl-line', tabindex: '-1' });
  const live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const model = h('div', { class: 'wl-model' });
  const body = h('div', { class: 'wl-body' });
  const result = h('div', { class: 'wl-result', hidden: true });
  const actions = h('div', { class: 'wl-actions' });
  const help = h('div', { class: 'wl-help', hidden: true });
  el.append(dots, head, model, body, result, actions, help, live);
  root.replaceChildren(el);

  function say(text, hint = false, speak = false) {
    head.replaceChildren(...(Array.isArray(text) ? text : [text]));
    head.toggleAttribute('data-hint', hint);
    const spoken = head.textContent;
    live.textContent = '';
    if (head.hidden && !speak) return;   // the stroke panel speaks for itself (its own line and live region)
    later(() => { live.textContent = spoken; }, 30);
  }
  function btn(text, cls, onclick, extra = {}) {
    const b = h('button', { type: 'button', class: `btn ${cls}`, text, ...extra });
    b.addEventListener('click', onclick);
    return b;
  }
  function focus(n) { try { n.focus({ preventScroll: true }); } catch { /* ignore */ } }
  function setDots() {
    [...dots.children].forEach((d, i) => {
      d.toggleAttribute('data-on', i === stageI);
      d.toggleAttribute('data-past', i < stageI);
      if (i === stageI) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
    });
  }
  function setAttr() {
    el.dataset.stage = stageI > to || stageI > 4 ? 'done' : KEYS[stageI];
    el.dataset.fails = String(fails);
  }

  function teardown() {
    clearTimeout(timer);
    if (sub) { sub.destroy(); sub = null; }
    if (pad) { pad.destroy(); pad = null; }
    body.replaceChildren(); model.replaceChildren(); actions.replaceChildren();
    result.hidden = true; result.replaceChildren(); help.hidden = true; help.replaceChildren();
    el.removeAttribute('data-result'); el.removeAttribute('data-stars');
    fails = 0; shownHelp = false; graded = null;
    head.hidden = false;
  }

  function playSound() {
    if (!item.letter) return;
    audio.play(item.letter).catch(() => { later(() => { live.textContent = 'The sound did not play.'; }, 30); });
  }

  // ---- stages ----
  function start() {
    teardown();
    setDots(); setAttr();
    if (stageI > to) { finish(); return; }
    const key = KEYS[stageI];
    if ((key === 'watch' || key === 'trace') && item.entry) strokeStage();
    else if (key === 'watch') watchPlain();
    else padStage(key);
  }

  function finish() {
    el.dataset.stage = 'done';
    if (typeof opts.onFinish === 'function') opts.onFinish({ passed, skipped });
  }

  function stageDone(outcome, res = null, firstTry = true) {
    const st = stageI;
    if (record) prog.record(item.id, st, outcome, { q: res ? res.q : 0, firstTry });
    if (outcome === 'pass') passed += 1; else if (outcome === 'skip') skipped += 1;
    if (typeof opts.onStage === 'function') opts.onStage(st, outcome, res);
  }

  function nextBtn(primary = true) {
    const last = stageI >= to;
    if (last && opts.inLesson) return null;
    const b = btn(last ? (opts.lastLabel || 'Done') : `Next: ${STAGE_NAMES[stageI + 1]}`, `${primary ? 'btn-main' : 'btn-secondary'} wl-next`, () => { stageI += 1; start(); focus(head); });
    return b;
  }

  // Watch without stroke data: the big glyph, its sound, the shape note
  function watchPlain() {
    say(item.syllable ? ['Look at ', teNode(item.display, { class: 'te-md' }), '.'] : `Look at the letter ${item.rom}. Then write it.`);
    const note = item.letter && item.letter.shape_note ? noteNode('p', 'wl-note', item.letter.shape_note) : null;
    const hear = item.letter && item.letter.audio ? btn('Hear it', 'btn-secondary wl-hear', playSound) : null;
    body.append(h('div', { class: 'wl-watch' }, teNode(item.display, { class: 'te-xl wl-big' }), note));
    actions.append(...[hear, btn('Next: Trace', 'btn-main wl-next', () => { stageDone('pass'); stageI += 1; start(); focus(head); })].filter(Boolean));
    playSound();
  }

  // Watch + Trace with stroke data: the S16 panel, per-stroke check
  function strokeStage() {
    const slot = h('div', { class: 'wl-draw' });
    body.append(slot);
    head.hidden = true;   // the panel has its own instruction line; one line, not two
    let traceFails = 0;
    sub = mountDraw(slot, item.id, {
      ladder: true, letter: item.letter, data: opts.strokes ? opts.strokes : undefined,
      onStage: s => {
        if (s === 'trace' && stageI === 0) {
          if (record) prog.record(item.id, 0, 'pass');
          passed += 1;
          if (typeof opts.onStage === 'function') opts.onStage(0, 'pass', null);
          stageI = 1; setDots(); setAttr();
          if (stageI > to) { later(finish, 0); }
        }
      },
      onFail: () => {
        traceFails += 1; fails = traceFails; setAttr();
        if (traceFails >= FAILS_FOR_HELP && !shownHelp) offerHelp(() => {
          const panel = slot.querySelector('[data-draw]');
          const again = panel && panel.querySelector('.draw-rewatch');
          if (again) again.click();
        });
      },
      onTraced: () => {
        const res = { q: Math.max(40, 100 - 12 * traceFails), stars: traceFails === 0 ? 3 : traceFails <= 2 ? 2 : 1 };
        stageDone('pass', res, traceFails === 0);
        showPass(res, traceFails === 0 ? 'Every stroke right first time.' : 'Traced. Each stroke is right now.');
      },
    });
    sub.ready.then(ok => {
      if (!alive) return;
      if (!ok) { sub = null; head.hidden = false; if (stageI === 0) watchPlain(); else padStage('trace'); return; }
      if (stageI === 1) { const b = slot.querySelector('.draw-myturn'); if (b) b.click(); }
    });
  }

  // Trace / Fade / Copy / Recall on the pad, graded by shape
  function padStage(key) {
    const instr = {
      trace: `Trace over the grey letter.`,
      fade: 'Write it again. The letter fades as you write.',
      copy: 'Copy the letter in the box.',
      recall: `Write the letter you hear: ${item.rom}.`,
    }[key];
    say(item.sign && key !== 'recall' ? `${instr} The grey part is already there; add the sign.` : instr);
    if (key === 'copy') model.append(h('div', { class: 'wl-copy-model' }, teNode(item.display, { class: 'te-lg' })));
    if (key === 'recall') {
      model.append(h('div', { class: 'wl-recall' }, h('span', { class: 'wl-rom', text: item.rom }),
        item.letter && item.letter.audio ? btn('Hear it', 'btn-quiet wl-hear', playSound) : null));
      playSound();
    }
    const startAlpha = key === 'trace' ? 0.35 : key === 'fade' ? 0.35 : 0;
    const box = h('div', { class: 'wl-box' });
    body.append(box);
    pad = mountPad(box, {
      text: item.text, carrier: item.carrier, modelAlpha: startAlpha,
      label: `Writing box for ${item.rom}`,
      disabled: () => busy || el.hasAttribute('data-result') && el.dataset.result === 'pass',
      onPenDown: () => {
        clearTimeout(timer);
        if (pad && pad.marked()) {
          pad.unmark(); el.removeAttribute('data-result');
          if (key === 'recall') pad.clear();
        }
      },
      onPenUp: () => {
        if (key === 'fade' && pad && t0) pad.setModel(Math.max(0.08, 0.35 - 0.27 * Math.min(1, pad.inkLength() / Math.max(1, t0.len))));
        setUndo();
        clearTimeout(timer);
        timer = later(() => check(true), AUTO_MS);
      },
    });
    let t0 = null;
    getTarget(item.text, { carrier: item.carrier }).then(t => { t0 = t; }).catch(() => {});
    const undo = btn('Undo', 'btn-secondary wl-undo', () => { pad.undo(); clearTimeout(timer); el.removeAttribute('data-result'); setUndo(); });
    const clear = btn('Clear', 'btn-secondary wl-clear', () => { pad.clear(); clearTimeout(timer); el.removeAttribute('data-result'); setUndo(); if (key === 'fade') pad.setModel(0.35); });
    const chk = btn('Check', 'btn-main wl-check', () => check(false));
    function setUndo() { const none = !pad || !pad.count(); undo.disabled = none; clear.disabled = none; chk.disabled = none; }
    actions.append(undo, clear, chk);
    setUndo();
  }

  async function grade() {
    const t = await getTarget(item.text, { carrier: item.carrier });
    const rivals = [];
    for (const r of opts.rivals || []) { try { rivals.push(await getTarget(r.text, { carrier: r.carrier })); } catch { /* skip */ } }
    return gradeShape(t, pad.strokes(), KEYS[stageI], { rivals });
  }

  async function check(auto) {
    if (!pad || busy || !pad.count()) return;
    if (el.dataset.result === 'pass') return;
    clearTimeout(timer);
    busy = true;
    let res;
    try { res = await grade(); } catch { res = null; } finally { busy = false; }
    if (!alive || !res || !pad) return;
    graded = res;
    if (res.ok) {
      const firstTry = fails === 0;
      stageDone('pass', res, firstTry);
      showPass(res, praise(res));
      return;
    }
    if (auto) return;   // an automatic check only ever passes; a fail needs the learner's Check
    fails += 1; setAttr();
    el.dataset.result = 'fail';
    pad.mark(res);
    if (KEYS[stageI] === 'recall' && fails === 1 && record) prog.record(item.id, 4, 'fail', { q: res.q, firstTry: true });
    say(`${res.hint || 'Not quite.'} ${KEYS[stageI] === 'recall' ? 'The red part is what is missing. Write it again.' : 'Write over it or clear and try again.'}`, true);
    if (fails >= FAILS_FOR_HELP && !shownHelp) offerHelp(() => {
      pad.setModel(0.55);
      later(() => { if (pad) pad.setModel(KEYS[stageI] === 'trace' || KEYS[stageI] === 'fade' ? 0.35 : 0); }, 2500);
    });
  }

  function offerHelp(showMe) {
    shownHelp = true;
    help.hidden = false;
    help.replaceChildren(
      h('p', { class: 'wl-help-text', text: 'Stuck? See it again, or move on. Skipping does not count as a pass.' }),
      h('div', { class: 'wl-help-actions' },
        btn('Show me', 'btn-secondary wl-showme', () => showMe()),
        btn('Skip', 'btn-quiet wl-skip', () => {
          stageDone('skip');
          stageI += 1;
          start();
          focus(head);
        })));
  }

  function showPass(res, text) {
    clearTimeout(timer);
    buzz();
    el.dataset.result = 'pass';
    el.dataset.stars = String(res.stars || 1);
    const n = res.stars || 1;
    const stars = h('span', { class: 'wl-stars', role: 'img', 'aria-label': `${n} of 3 stars` },
      [1, 2, 3].map(i => starSvg(i <= n)));
    result.hidden = false;
    result.replaceChildren(stars, h('p', { class: 'wl-praise', text }),
      // Recall hides the letter until it is written; after the pass it is shown to compare
      KEYS[stageI] === 'recall' ? h('p', { class: 'wl-reveal' }, 'The letter: ', teNode(item.display, { class: 'te-md' })) : null);
    say(`${STAGE_NAMES[stageI]} passed.`, false, true);
    if (pad) pad.unmark();
    help.hidden = true;
    const nb = nextBtn();
    actions.replaceChildren(...(nb ? [nb] : []));
    if (nb) later(() => focus(nb), 0);
    if (stageI >= to && opts.inLesson) later(finish, 0);
    else if (stageI >= to && opts.autoFinish) later(finish, 0);
  }

  el.__ladder = {
    item,
    draw: list => { if (pad) el.querySelector('[data-pad]').__pad.add(list); },
    check: () => check(false),
    next: () => { const b = el.querySelector('.wl-next'); if (b) b.click(); },
    graded: () => graded,
  };

  const ready = fontReady().then(() => { if (alive) start(); return true; });
  return {
    el, ready,
    destroy() {
      alive = false;
      clearTimeout(timer);
      for (const t of timers) clearTimeout(t);
      if (sub) sub.destroy();
      if (pad) pad.destroy();
    },
  };
}
