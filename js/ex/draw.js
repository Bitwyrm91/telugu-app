// ex/draw.js: the `letter_draw` step (task D3; SPECS S16, revision 1 R5 / R8). Not graded.
//
//   render(exercise, el, onAnswer, ctx) -> {root, showResult(), destroy()}
//     exercise {type: 'letter_draw', itemIds: ['L:<id>'], letterId}
//     ctx.strokes = the parsed strokes.json (else draw.js loads it); ctx.letter(id) -> letter
// Continue is enabled once the trace stage is complete -> onAnswer({seen: true}); until then it
// says why (aria-describedby). "Can't draw now" (same style as "Can't speak now") -> onAnswer({skip: true})
// and is hidden once the letter is traced (Continue is then the one way on). DOM order: Continue, then
// "Can't draw now". The step opens with focus on its heading.

import { h, ensureStyles, title } from './common.js';
import { mountDraw, drawStyles } from '../ui/draw.js';

let uid = 0;
export const NOTE = "Trace the letter first, or choose Can't draw now.";

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  drawStyles();
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

  let answered = false;
  const finish = ans => {
    if (answered) return;
    answered = true;
    skip.disabled = true; cont.disabled = true;
    onAnswer(ans);
  };
  const open = () => {
    if (answered) return;
    cont.disabled = false;
    cont.removeAttribute('aria-describedby');
  };
  skip.addEventListener('click', () => finish({ skip: true }));
  cont.addEventListener('click', () => finish({ seen: true }));

  const letter = typeof ctx.letter === 'function' ? ctx.letter(id) : null;
  const m = mountDraw(slot, id, {
    inLesson: true,
    data: ctx.strokes || undefined,
    letter: letter || undefined,
    onTraced: () => {
      if (answered) return;
      const had = skip.contains(document.activeElement);
      open();
      skip.hidden = true;
      if (had) { try { cont.focus({ preventScroll: true }); } catch { /* ignore */ } }
    },
    onDone: () => finish({ seen: true }),
  });
  // no data after all (should not happen: exgen only makes the step for letters with strokes)
  m.ready.then(ok => { if (!ok) open(); });

  return { root, showResult() {}, destroy() { m.destroy(); } };
}
