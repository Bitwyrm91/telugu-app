// ex/letter.js: the letter exercises (task E11; SPECS S4, S10 "Look-alike card"; DESIGN 7
// "Letter card", "Look-alike card").
//
//   render(exercise, el, onAnswer, ctx) -> {showResult(result), destroy()}
//     letter_intro  {letter}: the letter card (+ the look-alike card when a member of the letter's
//                   look-alike group is already taught). Not graded: Continue -> onAnswer({seen:true}).
//     letter_sound  {audio: letterId, choices: [say], answer, confusable}: hear it, pick the letter.
//     letter_name   {say, choices: [rom], answer}: see it, pick its romanization.
//     letter_build  {prompt: {audio: te}, consonants, forms, answer, syllable}: two taps, a consonant
//                   then one of its forms -> onAnswer({consonant, syllable}). Romanization of the
//                   syllable is shown only after the answer, with the syllable's confidence label.
//   letterCard(letter, cx, opts) / lookalikeCard(newLetter, other, cx) / letterGlyph(letter, size)
//     are also used by the Letters screen (ui/letters.js).
// ctx (besides common.js): letters [all letters], letter(id) -> letter, carrier (optional).
// A sign, mark or final is never drawn bare: it is always shown on its carrier (its `say`).

import { teNode } from '../ui/te.js';
import * as audio from '../audio.js';
import * as content from '../content.js';
import {
  h, ensureStyles, makeCtx, audioButtons, autoplay, confidenceLabel, title, actionBar, showVerdict,
  numberKeys, radioKeys, icon, shortcutOk, hasAudio, NO_AUDIO_HINT,
} from './common.js';

const ON_CARRIER = new Set(['sign', 'mark', 'final']);

let styled = false;
function letterStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/letters.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/** The letter as it may be shown: a sign/mark on its carrier (its `say`), else its glyph. */
export function shownGlyph(l) {
  if (!l) return '';
  return ON_CARRIER.has(l.type) ? (l.say || '') : (l.glyph || l.say || '');
}

/** A note that may name letters inside English: each Telugu run goes in through teNode. */
export function noteNode(tag, cls, text) {
  const n = h(tag, { class: cls });
  for (const part of String(text || '').split(/([ఀ-౿‌‍]+)/)) {
    if (!part) continue;
    if (/[ఀ-౿]/.test(part)) n.append(teNode(part, { class: 'te-note' }));
    else n.append(document.createTextNode(part));
  }
  return n;
}

function carrierOf(l, fallback) {
  const say = String(l.say || '');
  const c = say.replace(String(l.glyph || ''), '');
  return c || fallback || '';
}

/** Glyph for a well: a sign shows the plain carrier (ink-2), an arrow, then the full syllable. */
export function letterGlyph(l, size = 'hero', carrier = '') {
  if (!l) return h('span');
  if (ON_CARRIER.has(l.type) && l.say) {
    const c = carrierOf(l, carrier);
    return h('span', { class: 'lw-glyph lw-on-carrier' },
      c ? teNode(c, { class: `te-${size} lw-carrier` }) : null,
      c ? h('span', { class: 'lw-arrow', 'aria-hidden': 'true', text: '→' }) : null,
      teNode(l.say, { class: `te-${size} lw-full` }));
  }
  return h('span', { class: 'lw-glyph' }, teNode(shownGlyph(l), { class: `te-${size}` }));
}

function well(l, cx, extra = '') {
  return h('div', { class: `lc-well ${extra}`.trim() },
    h('span', { class: 'lc-guide lc-guide-head', 'aria-hidden': 'true' }),
    h('span', { class: 'lc-guide lc-guide-base', 'aria-hidden': 'true' }),
    letterGlyph(l, 'hero', cx.carrier));
}

/** The letter card (DESIGN 7). opts.example false leaves the example out. */
export function letterCard(l, cx, opts = {}) {
  const ex = opts.example === false ? null : l.example;
  const exBlock = ex && ex.te
    ? h('div', { class: 'lc-example', 'data-example': '' },
        h('p', { class: 'caption', text: 'Example' }),
        h('div', { class: 'stack-row' },
          audioButtons(ex, cx, { label: 'Play the example' }),
          h('div', { class: 'stack' },
            teNode(ex.te, { class: 'te-lg' }),
            ex.rom ? h('span', { class: 'rom rom-lg', text: ex.rom }) : null,
            ex.en ? h('p', { class: 'en', text: ex.en }) : null)),
        h('div', { class: 'lc-conf lc-conf-example' }, confidenceLabel(ex.confidence)))
    : null;
  return h('div', { class: 'letter-card', 'data-card': '', 'data-letter': l.id, 'data-type': l.type },
    well(l, cx),
    h('p', { class: 'lc-rom', text: l.rom || '' }),
    h('div', { class: 'lc-row' },
      audioButtons(l, cx, { label: 'Play the letter' }),
      h('div', { class: 'lc-conf lc-conf-letter' }, confidenceLabel(l.confidence))),
    l.shape_note ? noteNode('p', 'lc-note', l.shape_note) : null,
    exBlock);
}

/** Another member of l's look-alike group that is already taught, or null. */
export function lookalikeOf(l, letters, taught) {
  if (!l || !l.confusable) return null;
  return (letters || []).find(o => o && o.id !== l.id && o.confusable === l.confusable && taught.has(o.id)) || null;
}

/** The look-alike card (DESIGN 7): the taught letter, "≠", the new letter; its shape note under. */
export function lookalikeCard(l, other, cx) {
  const side = (x, isNew) => h('div', { class: `la-side${isNew ? ' is-new' : ''}`, 'data-letter': x.id },
    isNew ? h('span', { class: 'la-tag', text: 'new' }) : null,
    well(x, cx),
    h('p', { class: 'lc-rom', text: x.rom || '' }),
    audioButtons(x, cx, { label: `Play ${x.rom || 'letter'}` }));
  return h('div', { class: 'lookalike', 'data-card': '', 'data-group': l.confusable },
    h('h3', { class: 'la-title', text: 'Easy to mix up' }),
    h('div', { class: 'la-wells' },
      side(other, false),
      h('span', { class: 'la-ne', 'aria-hidden': 'true', text: '≠' }),
      side(l, true)),
    l.shape_note ? noteNode('p', 'la-note', l.shape_note) : null);
}

function letterCtx(ctx) {
  const cx = makeCtx(ctx);
  const letters = Array.isArray(ctx.letters) ? ctx.letters : [];
  const byId = new Map(letters.map(l => [l.id, l]));
  cx.letterOf = id => (typeof ctx.letter === 'function' && ctx.letter(id)) || byId.get(id) || null;
  cx.allLetters = letters;
  cx.taughtLetters = cx.settings.reads ? new Set(letters.map(l => l.id)) : cx.taught;
  return cx;
}

// ---- letter_intro ---------------------------------------------------------------------------

function renderIntro(ex, el, onAnswer, cx) {
  const l = ex.letter || cx.letterOf(String((ex.itemIds || [])[0] || '').slice(2));
  const root = h('section', { class: 'ex ex-letter ex-letter-intro', 'data-type': 'letter_intro' });
  if (!l) { el.replaceChildren(root); return { showResult() {}, destroy() {} }; }
  const other = lookalikeOf(l, cx.allLetters, cx.taughtLetters);
  const cont = h('button', { type: 'button', class: 'btn btn-main ex-check ex-continue', text: 'Continue' });
  let done = false;
  cont.addEventListener('click', () => {
    if (done) return;
    done = true;
    onAnswer({ seen: true });
    if (typeof cx.onContinue === 'function') cx.onContinue({ seen: true });
  });
  root.append(title('New letter'), letterCard(l, cx));
  if (other) root.append(lookalikeCard(l, other, cx)); // S1: never append null (DOM writes "null")
  root.append(h('div', { class: 'ex-actions' }, cont));
  el.replaceChildren(root);
  autoplay(l, cx);
  // Q3e minor 1: Enter anywhere outside a button continues (a focused Play button still plays).
  const onKey = e => {
    if (e.key === 'Enter' && !done && shortcutOk(e, root)) { e.preventDefault(); cont.click(); }
  };
  document.addEventListener('keydown', onKey);
  return { root, showResult() {}, destroy() { document.removeEventListener('keydown', onKey); } };
}

// ---- letter_sound / letter_name --------------------------------------------------------------

function renderChoice(ex, el, onAnswer, cx) {
  const sound = ex.type === 'letter_sound';
  const target = cx.letterOf(sound ? ex.audio : String((ex.itemIds || [])[0] || '').slice(2));
  const root = h('section', { class: 'ex ex-letter ex-letter-choice', 'data-type': ex.type });
  if (ex.confusable) root.setAttribute('data-confusable', '');

  let chosen = -1, done = false;
  let prompt, pair = null;
  if (sound) {
    const hint = hasAudio(target) ? h('p', { class: 'en listen-hint', text: 'Listen' }) : null;
    pair = audioButtons(target, cx, { label: 'Play again', noneText: NO_AUDIO_HINT,
      onState: s => { if (hint) hint.hidden = s === 'fail'; },
      onSkip: () => { if (done) return; done = true; onAnswer({ skip: true }); } });
    prompt = h('div', { class: 'ex-prompt ex-prompt-listen lx-listen', 'data-card': '' }, pair, hint);
  } else {
    prompt = h('div', { class: 'ex-prompt lx-say', 'data-card': '' },
      h('div', { class: 'lc-well' }, teNode(ex.say || '', { class: 'te-hero' })));
  }

  const { bar, btn } = actionBar();
  const tiles = (ex.choices || []).map((c, i) => {
    const body = sound
      ? h('span', { class: 'choice-body lx-choice-te' }, teNode(String(c), { class: 'te-xl' }))
      : h('span', { class: 'choice-body en lx-choice-rom', text: String(c) });
    const t = h('button', { type: 'button', class: `choice ${sound ? 'choice-te' : 'choice-en'}`,
      role: 'radio', 'aria-checked': 'false', 'data-index': String(i) },
      h('span', { class: 'choice-key', 'aria-hidden': 'true', text: String(i + 1) }),
      body,
      h('span', { class: 'choice-mark', 'aria-hidden': 'true' }));
    t.addEventListener('click', () => select(i));
    return t;
  });
  const list = h('div', { class: `choices${sound ? ' lx-grid' : ''}`, role: 'radiogroup', 'aria-label': 'Choices' }, tiles);

  function select(i) {
    if (done || i < 0 || i >= tiles.length) return;
    chosen = i;
    tiles.forEach((t, k) => { t.classList.toggle('is-selected', k === i); t.setAttribute('aria-checked', String(k === i)); });
    mark(i);
    btn.disabled = false;
  }
  function submit() {
    if (done || chosen < 0) return;
    done = true;
    btn.disabled = true;
    onAnswer(chosen);
  }
  const mark = radioKeys(tiles, select, submit, () => done);
  btn.addEventListener('click', submit);
  const offKeys = numberKeys(i => {
    if (i >= tiles.length) return;
    select(i);
    if (list.contains(document.activeElement)) tiles[i].focus();
  }, root);
  const onEnter = e => {
    if (e.key === 'Enter' && !done && chosen >= 0 && shortcutOk(e, root)) { e.preventDefault(); submit(); }
  };
  document.addEventListener('keydown', onEnter);

  const heading = sound
    ? (ex.confusable ? 'These look alike. Which one did you hear?' : 'Which letter did you hear?')
    : 'How is this said?';
  root.append(title(heading), prompt, list, bar);
  el.replaceChildren(root);
  if (sound) autoplay(target, cx);

  return {
    root,
    showResult(result) {
      done = true;
      if (pair) { pair.noSkip = true; for (const b of (pair.msg || pair).querySelectorAll('.audio-skip')) b.remove(); }
      const ans = typeof result.expected === 'number' ? result.expected : ex.answer;
      tiles.forEach((t, k) => {
        t.disabled = true;
        t.classList.remove('is-selected');
        if (k === chosen) {
          t.classList.add(result.correct ? 'is-right' : 'is-wrong');
          t.querySelector('.choice-mark').append(icon(result.correct ? 'tick' : 'cross'));
        } else if (k === ans && !result.correct) {
          t.classList.add('is-answer');
          t.querySelector('.choice-mark').append(icon('tick'));
        }
      });
      const extra = target ? [h('div', { class: 'lx-answer' }, letterGlyph(target, 'xl', cx.carrier),
        h('span', { class: 'rom rom-xl', text: target.rom || '' }),
        h('div', { class: 'lx-conf' }, confidenceLabel(target.confidence)))] : [];
      showVerdict(root, { bar, btn }, result, cx, extra);
    },
    destroy() { offKeys(); document.removeEventListener('keydown', onEnter); },
  };
}

// ---- letter_build ------------------------------------------------------------------------------

/** The syllable's audio: from the letter lessons' syllables in letters.json. */
async function syllableAudio(te) {
  try {
    const L = await content.loadLetters();
    const want = String(te || '').normalize('NFC');
    for (const ls of (L && L.lessons) || []) {
      for (const s of ls.syllables || []) if (String(s.te).normalize('NFC') === want && s.audio) return s;
    }
    for (const byC of Object.values((L && L.built) || {})) {
      for (const b of Object.values(byC || {})) if (b && String(b.te).normalize('NFC') === want && b.audio) return b;
    }
  } catch { /* no letters file: no audio */ }
  return null;
}

function renderBuild(ex, el, onAnswer, cx) {
  const root = h('section', { class: 'ex ex-letter ex-letter-build', 'data-type': 'letter_build' });
  const syl = ex.syllable || { te: ex.answer, rom: '', confidence: null };
  const holder = h('span', { class: 'lb-audio' }, audioButtons(null, cx));
  const hint = h('p', { class: 'en listen-hint', text: 'Listen, then build it: a letter, then its form' });
  const prompt = h('div', { class: 'ex-prompt ex-prompt-listen lb-prompt', 'data-card': '' }, holder, hint);
  let alive = true;
  let cons = null, done = false, picked = null, pair = null;
  // Q3c S1: the prompt is audio only (no text to read), so a clip that won't play offers Skip.
  const audioOnly = !(ex.prompt && (ex.prompt.te || ex.prompt.text));
  const onSkip = audioOnly ? () => { if (done) return; done = true; onAnswer({ skip: true }); } : undefined;
  syllableAudio((ex.prompt && ex.prompt.audio) || ex.answer).then(src => {
    if (!alive) return;
    // Q3e minor 2 / Q3f minor 3: no clip: one line, "No audio for this one yet", and no hint
    if (!src || !hasAudio(src)) hint.hidden = true;
    if (!src) {
      // Q3d m7: no clip at all ("No audio yet"): the same Skip as a clip that fails.
      if (done) return;
      pair = audioButtons(null, cx, { onSkip, noneText: NO_AUDIO_HINT });
      holder.replaceChildren(pair);
      return;
    }
    pair = audioButtons(src, cx, { label: 'Play again', onSkip, noneText: NO_AUDIO_HINT,
      onState: s => { hint.hidden = s === 'fail' || !hasAudio(src); } });
    if (done) pair.noSkip = true;
    holder.replaceChildren(pair);
    autoplay(src, cx);
  });

  const formsBox = h('div', { class: 'lb-forms', role: 'group', 'aria-label': 'Forms' });
  const consBtns = (ex.consonants || []).map(g => {
    const b = h('button', { type: 'button', class: 'tile lb-cons', 'data-glyph': g, 'aria-pressed': 'false' },
      teNode(g, { class: 'te-xl' }));
    b.addEventListener('click', () => pickCons(g));
    return b;
  });
  const consRow = h('div', { class: 'lb-row lb-cons-row', role: 'group', 'aria-label': 'Letters' }, consBtns);
  let formBtns = [];

  function pickCons(g) {
    if (done) return;
    cons = g;
    consBtns.forEach(b => { const on = b.dataset.glyph === g; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); });
    formBtns = ((ex.forms || {})[g] || []).map((f, i) => {
      const b = h('button', { type: 'button', class: 'tile lb-form', 'data-te': f.te, 'data-index': String(i) },
        teNode(f.te, { class: 'te-xl' }));
      b.addEventListener('click', () => pickForm(f, b));
      return b;
    });
    formsBox.replaceChildren(h('p', { class: 'caption', text: 'Now pick its form' }), h('div', { class: 'lb-row' }, formBtns));
  }
  function pickForm(f, b) {
    if (done || cons === null) return;
    done = true;
    picked = b;
    b.classList.add('is-selected');
    onAnswer({ consonant: cons, syllable: f.te });
  }

  root.append(title('Build what you hear'), prompt,
    h('div', { class: 'board lb-board' }, h('p', { class: 'caption', text: 'Pick the letter' }), consRow, formsBox));
  el.replaceChildren(root);
  const bar = { bar: h('div', { class: 'ex-actions' }), btn: h('button', { type: 'button', hidden: true }) };
  root.append(bar.bar);

  return {
    root,
    showResult(result) {
      done = true;
      if (pair) { pair.noSkip = true; for (const b of (pair.msg || pair).querySelectorAll('.audio-skip')) b.remove(); }
      for (const b of [...consBtns, ...formBtns]) b.disabled = true;
      if (picked) {
        picked.classList.remove('is-selected');
        picked.classList.add(result.correct ? 'is-right' : 'is-wrong');
      }
      const want = String(ex.answer || '').normalize('NFC');
      if (!result.correct) {
        for (const b of formBtns) if (String(b.dataset.te).normalize('NFC') === want) b.classList.add('is-answer');
      }
      const box = h('div', { class: 'lb-result', 'data-card': '' },
        h('p', { class: 'caption', text: 'The syllable' }),
        h('div', { class: 'stack' }, teNode(syl.te || ex.answer || '', { class: 'te-xl' }),
          syl.rom ? h('span', { class: 'rom rom-xl lb-rom', text: syl.rom }) : null),
        // In a lesson (verdict:false) the feedback sheet carries the label instead.
        cx.verdict === false ? null : h('div', { class: 'lb-conf' }, confidenceLabel(syl.confidence)));
      root.insertBefore(box, bar.bar);
      showVerdict(root, bar, result, cx);
    },
    destroy() { alive = false; audio.stop(); },
  };
}

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  letterStyles();
  const cx = letterCtx(ctx);
  if (exercise.type === 'letter_intro') return renderIntro(exercise, el, onAnswer, cx);
  if (exercise.type === 'letter_build') return renderBuild(exercise, el, onAnswer, cx);
  return renderChoice(exercise, el, onAnswer, cx);
}

export { letterStyles };
