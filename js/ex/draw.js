// ex/draw.js: the `letter_draw` step (SPECS S16 R5 / R8; S17 "Screens": stages 0-2 of the writing ladder).
// Not graded: writing never feeds the lesson score or the recognition cards (it has its own `writing` record).
//
//   render(exercise, el, onAnswer, ctx) -> {root, showResult(), destroy()}
//     exercise {type: 'letter_draw', itemIds: ['L:<id>'], letterId}
//     ctx.strokes = the parsed strokes.json (else loaded); ctx.letter(id) -> letter
// Watch, Trace, Fade for every new letter (stroke data or not). Continue is enabled once Trace is passed or
// skipped -> onAnswer({seen: true}); until then it says why (aria-describedby). "Can't draw now" -> onAnswer
// ({skip: true}) and is hidden once Continue opens. DOM order: Continue, then "Can't draw now". The step opens
// with focus on its heading.

import { h, ensureStyles, title } from './common.js';
import { drawStyles } from '../ui/draw.js';
import * as content from '../content.js';
import { describe, mountLadder } from '../write/ladder.js';
import { rivalIds } from '../write/rivals.js';
import { writeStyles } from '../ui/write.js';

let uid = 0;
export const NOTE = "Trace the letter first, or choose Can't draw now.";

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  drawStyles();
  writeStyles();
  const id = exercise.letterId || String((exercise.itemIds || [])[0] || '').replace(/^L:/, '');
  const noteId = `draw-note-${++uid}`;
  const root = h('section', { class: 'ex ex-draw', 'data-type': 'letter_draw', 'data-letter': id });
  const head = title('Learn to write');
  head.setAttribute('tabindex', '-1');
  const slot = h('div', { class: 'draw-slot' });
  const note = h('p', { class: 'draw-note visually-hidden', id: noteId, text: NOTE });
  const cont = h('button', { type: 'button', class: 'btn btn-main ex-continue', disabled: true, text: 'Continue',
    'aria-describedby': noteId });
  const skip = h('button', { type: 'button', class: 'btn btn-quiet draw-skip', text: "Can't draw now" });
  root.append(head, slot, note, h('div', { class: 'ex-actions draw-step-actions' }, cont, skip));
  el.replaceChildren(root);
  try { head.focus({ preventScroll: true }); } catch { /* ignore */ }

  let answered = false, alive = true, m = null;
  const finish = ans => {
    if (answered) return;
    answered = true;
    skip.disabled = true; cont.disabled = true;
    onAnswer(ans);
  };
  const open = () => {
    if (answered || !cont.disabled) return;
    const had = skip.contains(document.activeElement);
    cont.disabled = false;
    cont.removeAttribute('aria-describedby');
    skip.hidden = true;
    if (had) { try { cont.focus({ preventScroll: true }); } catch { /* ignore */ } }
  };
  skip.addEventListener('click', () => finish({ skip: true }));
  cont.addEventListener('click', () => finish({ seen: true }));

  (async () => {
    let L = null, S = ctx.strokes || null;
    try { L = await content.loadLetters(); } catch { L = null; }
    if (!S) { try { S = await content.loadStrokes(); } catch { S = null; } }
    if (!alive) return;
    const letter = typeof ctx.letter === 'function' ? ctx.letter(id) : null;
    const LL = L || { letters: letter ? [letter] : [], carrier: 'న' };
    const item = describe(id, LL, S);
    if (!item) { open(); return; }
    m = mountLadder(slot, item, {
      from: 0, to: 2, inLesson: true, strokes: S,
      rivals: rivalIds(id, LL.letters || []).map(r => describe(r, LL, null)).filter(Boolean),
      onStage: (i, outcome) => { if (i >= 1 && (outcome === 'pass' || outcome === 'skip')) open(); },
      onFinish: () => open(),
    });
  })();

  return { root, showResult() {}, destroy() { alive = false; if (m) m.destroy(); } };
}
