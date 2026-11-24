// write/ladder.js: the stage runner for one target (SPECS S17 "Stages", S18).
//
//   describe(id, lettersJson, strokesJson, words?) -> item | null
//     item {id, text, carrier, display, rom, letter (audio), entry (stroke data or null), syllable, word?}
//     words: Map 'W:<item id>' -> {item, units} (write/word.js wordList) for word ids
//   mountLadder(root, item, opts) -> {ready, destroy()}
//     opts.from      first stage (default: the stored stage; syllables and words start at Copy)
//     opts.to        last stage (default 4)
//     opts.record    false: nothing is stored (default true)
//     opts.rivals    look-alike items ([item]) for the rival check
//     opts.onStage(i, outcome, res)  after each stage: outcome 'pass' | 'skip'
//     opts.onFinish({passed, skipped}) after the last stage
//     opts.inLesson  the lesson step: no "Next" after the last stage (the step's Continue goes on)
// Test hooks on [data-ladder]: data-stage (watch|trace|fade|copy|recall|done), data-fails,
// data-result (pass|fail while shown), data-stars, data-mode (wide|seq for words), data-unit (seq: index);
// el.__ladder = {item, draw(strokes), check(), next(), graded(), pad()}.
//
// S18 feedback: Compare (the model over the ink, aligned as graded), Replay mine (the learner's strokes at
// their speed, over the model's stroke demo when there is stroke data), a start ring in Fade and Copy
// ("Hints", settings.writeHints), "I wrote it right" after a failed Recall, diagnostics (write/diag.js).

import { h } from '../ex/common.js';
import { noteNode } from '../ex/letter.js';
import { teNode } from '../ui/te.js';
import { mountDraw, drawStyles } from '../ui/draw.js';
import { strokeEntryOk } from '../exgen.js';
import * as audio from '../audio.js';
import * as store from '../store.js';
import { gradeShape } from './shape.js';
import { syllableRivals } from './rivals.js';
import { getTarget, targetFor, fontReady, SIGN_TYPES, strokeFit } from './glyph.js';
import { mountPad } from './pad.js';
import { wordLayout, gradeWord, fitsWide, fitFor, ordinal, MAX_CELL_PX } from './word.js';
import * as prog from './progress.js';
import * as diag from './diag.js';

export const STAGE_NAMES = ['Watch', 'Trace', 'Fade', 'Copy', 'Recall'];
const KEYS = prog.STAGES;
const AUTO_MS = 1200;
const FAILS_FOR_HELP = 3;

export function describe(id, L, S, W = null) {
  const letters = (L && L.letters) || [];
  const carrier = (L && L.carrier) || 'న';
  const w = /^W:(.+)$/.exec(String(id));
  if (w) {
    const x = W ? (typeof W.get === 'function' ? W.get(id) : W[id]) : null;
    if (!x || !x.item) return null;
    return { id, text: x.item.te, carrier: null, display: x.item.te, rom: x.item.rom || '', en: x.item.en || '',
      letter: null, entry: null, syllable: false, word: { units: x.units, item: x.item, letters } };
  }
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

/** The first stage an item can be at: words and syllables start at Copy. */
export const firstStage = item => (item && (item.syllable || item.word) ? 3 : 0);

function starSvg(on) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `wl-star${on ? ' is-on' : ''}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = '<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" stroke-linejoin="round" stroke-width="1.6"/>';
  return s;
}
export function starsNode(n) {
  return h('span', { class: 'wl-stars', role: 'img', 'aria-label': `${n} of 3 stars` }, [1, 2, 3].map(i => starSvg(i <= n)));
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function buzz() {
  if (reducedMotion()) return;
  try { if (navigator.vibrate) navigator.vibrate(15); } catch { /* ignore */ }
}
export const hintsOn = () => { try { return (store.get('settings') || {}).writeHints !== false; } catch { return true; } };
function setHints(on) {
  try { const s = store.get('settings') || {}; s.writeHints = !!on; store.set('settings', s); } catch { /* banner */ }
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
  const first = firstStage(item);
  let stageI = Math.max(first, Math.min(4, opts.from ?? stored.stage));
  const to = Math.min(4, opts.to ?? 4);
  if (stageI > to) stageI = to;
  const record = opts.record !== false;
  let passed = 0, skipped = 0;
  let fails = 0, timer = 0, sub = null, pad = null, graded = null, shownHelp = false, busy = false;
  let tools = null;          // the tools row's refresh function for the current pad stage
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };

  const el = h('div', { class: 'wl', 'data-ladder': '', 'data-item': item.id });
  if (item.word) el.dataset.word = '';
  const dots = h('ol', { class: 'wl-dots', 'aria-label': 'Stages' }, STAGE_NAMES.map((n, i) => h('li', { 'data-i': String(i) },
    h('span', { class: 'wl-dot', 'aria-hidden': 'true' }), h('span', { class: 'wl-dot-name', text: n }))));
  if (first) [...dots.children].slice(0, first).forEach(d => { d.hidden = true; });
  const head = h('p', { class: 'wl-line', tabindex: '-1' });
  const live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const model = h('div', { class: 'wl-model' });
  const body = h('div', { class: 'wl-body' });
  const result = h('div', { class: 'wl-result', hidden: true });
  const toolRow = h('div', { class: 'wl-tools', role: 'group', 'aria-label': 'Writing help' });
  const actions = h('div', { class: 'wl-actions', role: 'group', 'aria-label': 'Writing box' });
  const help = h('div', { class: 'wl-help', hidden: true });
  el.append(dots, head, model, body, result, actions, toolRow, help, live);
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
    body.replaceChildren(); model.replaceChildren(); actions.replaceChildren(); toolRow.replaceChildren();
    result.hidden = true; result.replaceChildren(); help.hidden = true; help.replaceChildren();
    el.removeAttribute('data-result'); el.removeAttribute('data-stars'); el.removeAttribute('data-mode'); el.removeAttribute('data-unit');
    fails = 0; shownHelp = false; graded = null; tools = null;
    head.hidden = false;
  }

  function sound() { return item.letter || (item.word && item.word.item) || null; }
  function playSound() {
    const s = sound();
    if (!s) return;
    audio.play(s).catch(() => { later(() => { live.textContent = 'The sound did not play.'; }, 30); });
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

  function stageDone(outcome, res = null, firstTry = true, override = false) {
    const st = stageI;
    if (record) prog.record(item.id, st, outcome, { q: res ? res.q : 0, firstTry, override });
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

  // ---- the pad stages (Trace / Fade / Copy / Recall), letters and words ----
  // A word is written in one wide box (one cell per akshara) when every cell gets at least 64 px; otherwise
  // one akshara at a time in the letter box, with a strip of the word's cells above.
  let seq = null;            // {j, res: []} while a word is written akshara by akshara
  let layout = null;         // the wide word box layout
  let t0 = null;             // the current target (letters, or the current akshara)
  let fit = null;            // stroke data -> pad (letters with stroke data)

  function padStage(key) {
    const word = item.word;
    const recall = key === 'recall';
    seq = null; layout = null; t0 = null; fit = null;
    if (word) {
      const n = word.units.length;
      const avail = body.clientWidth || el.clientWidth || 280;
      const boxPx = Math.min(avail, n * MAX_CELL_PX);
      if (fitsWide(n, boxPx)) { layout = wordLayout(word.units); el.dataset.mode = 'wide'; }
      else { seq = { j: 0, res: [] }; el.dataset.mode = 'seq'; }
    }
    const instr = word ? {
      copy: seq ? 'Copy the word, one syllable at a time.' : 'Copy the word in the box, one syllable in each space.',
      recall: `Write the word for “${item.en}”.${seq ? ' One syllable at a time.' : ''}`,
    }[key] : {
      trace: 'Trace over the grey letter.',
      fade: 'Write it again. The letter fades as you write.',
      copy: 'Copy the letter in the box.',
      recall: `Write the letter you hear: ${item.rom}.`,
    }[key];
    say(item.sign && !recall ? `${instr} The grey part is already there; add the sign.` : instr);
    if (key === 'copy') {
      const m = word && seq
        ? h('div', { class: 'wl-copy-model wl-copy-word', lang: 'te' }, word.units.map((u, i) => h('span', { class: 'te wl-unit', lang: 'te', 'data-u': String(i), text: u })))
        : h('div', { class: 'wl-copy-model' }, teNode(item.display, { class: 'te-lg' }));
      model.append(m);
    }
    if (recall) {
      const s = sound();
      model.append(h('div', { class: 'wl-recall' },
        word ? h('span', { class: 'wl-en', text: `“${item.en}”` }) : h('span', { class: 'wl-rom', text: item.rom }),
        s && s.audio ? btn('Hear it', 'btn-quiet wl-hear', playSound) : null));
      playSound();
    }
    if (seq) body.append(stripNode());
    const box = h('div', { class: 'wl-box' });
    if (layout) { box.dataset.wide = ''; box.style.maxWidth = `${word.units.length * MAX_CELL_PX}px`; }
    body.append(box);
    const startAlpha = key === 'trace' ? 0.35 : key === 'fade' ? 0.35 : 0;
    const undo = btn('Undo', 'btn-secondary wl-undo', () => { pad.undo(); clearTimeout(timer); el.removeAttribute('data-result'); setUndo(); });
    const clear = btn('Clear', 'btn-secondary wl-clear', () => { pad.clear(); clearTimeout(timer); el.removeAttribute('data-result'); setUndo(); if (key === 'fade') pad.setModel(0.35); });
    const chk = btn('Check', 'btn-main wl-check', () => check(false));
    function setUndo() {
      const none = !pad || !pad.count(); undo.disabled = none; clear.disabled = none; chk.disabled = none;
      if (pad) pad.setHint(none ? hintPoint(key) : null);
      if (tools) tools();
    }
    actions.append(undo, clear, chk);

    const mount = () => {
      if (pad) pad.destroy();
      box.replaceChildren();
      const text = seq ? word.units[seq.j] : item.text;
      pad = mountPad(box, {
        text, carrier: item.carrier, modelAlpha: startAlpha,
        layout: layout || undefined, cellMarks: !!layout,
        label: word ? `Writing box for the word${recall ? '' : ` ${item.rom}`}${seq ? `, syllable ${seq.j + 1} of ${word.units.length}` : ''}` : `Writing box for ${item.rom}`,
        disabled: () => busy || el.hasAttribute('data-result') && el.dataset.result === 'pass',
        onPenDown: () => {
          clearTimeout(timer);
          if (pad && (pad.marked() || pad.comparing())) {
            const wasMarked = pad.marked();
            pad.unmark(); el.removeAttribute('data-result');
            if (recall && wasMarked) pad.clear();
          }
          if (pad) pad.setHint(null);
        },
        onPenUp: () => {
          if (key === 'fade' && pad && t0) pad.setModel(Math.max(0.08, 0.35 - 0.27 * Math.min(1, pad.inkLength() / Math.max(1, t0.len))));
          setUndo();
          clearTimeout(timer);
          timer = later(() => check(true), AUTO_MS);
        },
      });
      if (seq) { el.dataset.unit = String(seq.j); stripNode(true); }
      t0 = null; fit = null;
      if (!layout) {
        getTarget(text, { carrier: item.carrier }).then(t => {
          if (!alive) return;
          t0 = t;
          fit = item.entry && !seq ? strokeFit(item.entry, t) : null;
          setUndo();
        }).catch(() => {});
      }
      setUndo();
    };
    mount();
    seqMount = mount;
    tools = toolsFor(key);
    tools();
  }
  let seqMount = null;

  function hintPoint(key) {
    if (!(key === 'fade' || key === 'copy') || !fit || !item.entry || !hintsOn()) return null;
    const s0 = item.entry.strokes && item.entry.strokes[0];
    return s0 && s0.length ? fit.map(s0[0]) : null;
  }

  function stripNode(update = false) {
    const n = item.word.units.length;
    let strip = body.querySelector('.wl-strip');
    if (!strip) {
      strip = h('ol', { class: 'wl-strip', 'aria-label': 'Syllables of the word' },
        item.word.units.map((_, i) => h('li', { class: 'wl-strip-cell', 'data-i': String(i) })));
    }
    if (update || !strip.isConnected) {
      [...strip.children].forEach((li, i) => {
        const done = seq && i < seq.j, on = seq && i === seq.j;
        li.toggleAttribute('data-done', done);
        li.toggleAttribute('data-on', on);
        if (on) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        li.replaceChildren(done ? teNode(item.word.units[i], { class: 'te-sm' }) : h('span', { class: 'wl-strip-n', text: String(i + 1) }),
          h('span', { class: 'visually-hidden', text: done ? ' written' : on ? ` of ${n}: now` : ` of ${n}` }));
      });
      const cm = model.querySelector('.wl-copy-word');
      if (cm) [...cm.children].forEach((s, i) => s.toggleAttribute('data-on', seq && i === seq.j));
    }
    return strip;
  }

  // the tools row: Hints (Fade / Copy with stroke data), Compare, Replay mine, I wrote it right
  function toolsFor(key) {
    const recall = key === 'recall';
    // S18: in a lesson the row stays short (shorter Tab loop): no Hints toggle (the Write screen's setting
    // applies), and Compare / Replay mine only after a failed check
    const lesson = !!opts.inLesson;
    const hintsBtn = (key === 'fade' || key === 'copy') && item.entry && !lesson
      ? btn('', 'btn-quiet wl-hints', () => {
        setHints(!hintsOn());
        hintsBtn.setAttribute('aria-pressed', String(hintsOn()));
        hintsBtn.textContent = hintsOn() ? 'Hints: on' : 'Hints: off';
        if (pad) pad.setHint(pad.count() ? null : hintPoint(key));
      }, { 'aria-pressed': String(hintsOn()), title: 'Show a dot where the first stroke starts' })
      : null;
    if (hintsBtn) hintsBtn.textContent = hintsOn() ? 'Hints: on' : 'Hints: off';
    const cmp = btn('Compare', 'btn-quiet wl-compare', () => compare(), { 'aria-pressed': 'false' });
    const rep = btn('Replay mine', 'btn-quiet wl-replay', () => replayMine());
    const ok = btn('I wrote it right', 'btn-quiet wl-override', () => override());
    return () => {
      const has = !!(pad && pad.count());
      const failed = el.dataset.result === 'fail';
      const passedNow = el.dataset.result === 'pass';
      // Recall: the model only after a fail or a pass (never on demand before)
      const showCmp = has && (!recall || failed || passedNow) && (!lesson || failed);
      cmp.hidden = !showCmp;
      cmp.setAttribute('aria-pressed', String(!!(pad && pad.comparing())));
      rep.hidden = !has || (lesson && !failed);
      ok.hidden = !(recall && failed && !passedNow);
      const list = [hintsBtn, cmp, rep, ok].filter(Boolean);
      if (toolRow.children.length !== list.length) toolRow.replaceChildren(...list);
      toolRow.hidden = list.every(b => b.hidden);
    };
  }

  async function compare() {
    if (!pad || !pad.count()) return;
    if (pad.comparing()) { pad.compare(null); if (tools) tools(); return; }
    let res = graded;
    if (!res || res.__strokes !== pad.count()) { try { res = await grade(); } catch { res = null; } }
    if (!res || !pad) return;
    pad.compare(res.fits);
    if (tools) tools();
    say(item.word ? 'The model is drawn over your writing.' : 'The model letter is drawn over your writing.', false, true);
  }

  async function replayMine() {
    if (!pad || !pad.count()) return;
    let model = null;
    if (fit && item.entry && !seq) model = item.entry.strokes.map(s => s.map(fit.map));
    say(model ? 'Your strokes, as you wrote them, over the model strokes.' : 'Your strokes, as you wrote them.', false, true);
    await pad.replay(model);
  }

  async function grade() {
    const key = KEYS[stageI];
    if (layout) {
      const r = await gradeWord(layout, pad.strokes(), key, { letters: item.word.letters || [] });
      r.fits = r.cells.map(c => c.fit).filter(Boolean);
      r.__strokes = pad.count();
      return r;
    }
    const text = seq ? item.word.units[seq.j] : item.text;
    const t = await getTarget(text, { carrier: item.carrier });
    const rivals = [];
    if (!seq) for (const r of opts.rivals || []) { try { rivals.push(await getTarget(r.text, { carrier: r.carrier })); } catch { /* skip */ } }
    // a word's akshara, one at a time: its look-alikes (first letter or a vowel sign swapped)
    if (seq) for (const x of syllableRivals(text, item.word.letters || [])) { try { rivals.push(await getTarget(x)); } catch { /* skip */ } }
    const r = gradeShape(t, pad.strokes(), key, { rivals });
    // marks on the pad: the missing runs undo the grader's normalise, so they sit on the aligned model
    const off = r.map([0, 0]), s = r.s || 1;
    const inv = q => [(q[0] - off[0]) / s, (q[1] - off[1]) / s];
    r.padMarks = { missing: (r.missing || []).map(run => run.map(inv)), extra: r.extra || [] };
    const f = fitFor(r, t.pl);
    r.fits = f ? [f] : [];
    r.__strokes = pad.count();
    r.__map = r.map;
    return r;
  }

  function diagInk(res) {
    if (!res) return { ink: [] };
    if (res.cells) return { ink: res.cells.flatMap(c => diag.compactInk(c.ink, c.map)), cells: res.cells.map(c => ({ text: c.text, q: c.q, ok: c.ok })) };
    return { ink: diag.compactInk(pad ? pad.strokes() : [], res.map) };
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
    const key = KEYS[stageI];
    if (res.ok) {
      if (seq && seq.j < item.word.units.length - 1) { unitPassed(res); return; }
      let all = res;
      if (seq) {
        seq.res.push(res);
        all = { ...res, q: Math.round(seq.res.reduce((a, r) => a + r.q, 0) / seq.res.length), stars: Math.min(...seq.res.map(r => r.stars || 1)) };
      }
      const firstTry = fails === 0;
      if (res.borderline) diag.log({ id: item.id, stage: key, kind: 'borderline', text: item.text, scores: all, ...diagInk(res) });
      if (fails >= 2) diag.log({ id: item.id, stage: key, kind: 'tries', tries: fails + 1, text: item.text, scores: all, ...diagInk(res) });
      stageDone('pass', all, firstTry);
      showPass(all, praise(all));
      return;
    }
    if (auto) return;   // an automatic check only ever passes; a fail needs the learner's Check
    fails += 1; setAttr();
    el.dataset.result = 'fail';
    pad.mark(res.padMarks || res);
    pad.compare(res.fits);
    if (key === 'recall' && fails === 1 && record) prog.record(item.id, 4, 'fail', { q: res.q, firstTry: true });
    const tail = key === 'recall' ? 'The red part is what is missing. Write it again.' : 'Write over it or clear and try again.';
    if (item.word) {
      const i = layout ? res.bad : seq.j;
      const te = item.word.units[i];
      const empty = (res.why || []).includes('empty');
      say([`The ${ordinal(i)} syllable, `, teNode(te, { class: 'te-md' }), `, needs work. ${res.hint || ''}${empty ? '' : ' ' + tail}`], true);
    } else say(`${res.hint || 'Not quite.'} ${tail}`, true);
    if (tools) tools();
    if (fails >= FAILS_FOR_HELP && !shownHelp) offerHelp(() => {
      pad.setModel(0.55);
      later(() => { if (pad) pad.setModel(KEYS[stageI] === 'trace' || KEYS[stageI] === 'fade' ? 0.35 : 0); }, 2500);
    });
  }

  function unitPassed(res) {
    seq.res.push(res);
    seq.j += 1;
    fails = 0; setAttr();
    el.removeAttribute('data-result');
    say(`Good. Now the ${ordinal(seq.j)} syllable.`, false, true);
    if (seqMount) seqMount();
    if (tools) tools();
  }

  function override() {
    if (!pad || el.dataset.result !== 'fail' || KEYS[stageI] !== 'recall') return;
    const res = graded;
    diag.log({ id: item.id, stage: 'recall', kind: 'override', tries: fails, text: item.text, scores: res || {}, ...diagInk(res) });
    const r = { q: 0, stars: 1, override: true };
    stageDone('pass', r, false, true);
    showPass(r, 'Counted as right, with one star. Thank you: this helps make the checker fairer.');
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
    result.hidden = false;
    result.replaceChildren(starsNode(n), h('p', { class: 'wl-praise', text }),
      // Recall hides the target until it is written; after the pass it is shown to compare
      KEYS[stageI] === 'recall' ? h('p', { class: 'wl-reveal' }, item.word ? 'The word: ' : 'The letter: ', teNode(item.display, { class: 'te-md' })) : null);
    say(`${STAGE_NAMES[stageI]} passed.`, false, true);
    if (pad && pad.marked()) pad.unmark();
    if (seq) { seq.j = item.word.units.length; stripNode(true); }
    help.hidden = true;
    const nb = nextBtn();
    actions.replaceChildren(...(nb ? [nb] : []));
    if (tools) tools();
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
    pad: () => pad,
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
