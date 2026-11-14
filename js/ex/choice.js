// ex/choice.js: choice_te_en, choice_en_te, listen_choice (S4; DESIGN 7 "Choice tile").
// Tap a tile to select it (number keys 1-4 too), then Check. The answer is the chosen index.

import {
  h, ensureStyles, makeCtx, teWords, revealRom, tePrompt, enPrompt, listenPrompt, title,
  actionBar, showVerdict, correctAnswer, numberKeys, radioKeys, icon, autoplay, shortcutOk,
} from './common.js';

const TITLES = {
  choice_te_en: 'What does this mean?',
  choice_en_te: 'Pick the Telugu',
  listen_choice: 'What did you hear?',
};

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  const cx = makeCtx(ctx);
  const ex = exercise;
  const root = h('section', { class: 'ex ex-choice', 'data-type': ex.type });

  let prompt = null;
  if (ex.type === 'choice_te_en') prompt = tePrompt(ex.prompt, cx);
  else if (ex.type === 'choice_en_te') prompt = enPrompt(ex.prompt);

  let chosen = -1;
  let done = false;
  const skip = () => { if (done) return; done = true; onAnswer({ skip: true }); };
  if (ex.type === 'listen_choice') prompt = listenPrompt(ex.audio, cx, { onSkip: skip });
  const { bar, btn } = actionBar();
  const tiles = (ex.choices || []).map((c, i) => {
    const telugu = c && typeof c === 'object';
    const body = telugu
      ? h('span', { class: 'choice-body', 'data-card': '' }, teWords(c, cx, 'md', { tapReveal: false }))
      : h('span', { class: 'choice-body en', text: String(c) });
    const t = h('button', { type: 'button', class: `choice ${telugu ? 'choice-te' : 'choice-en'}`,
      role: 'radio', 'aria-checked': 'false', 'data-index': String(i) },
      h('span', { class: 'choice-key', 'aria-hidden': 'true', text: String(i + 1) }),
      body,
      h('span', { class: 'choice-mark', 'aria-hidden': 'true' }));
    t.addEventListener('click', () => select(i));
    return t;
  });
  const list = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Choices' }, tiles);

  function select(i) {
    if (done || i < 0 || i >= tiles.length) return;
    chosen = i;
    tiles.forEach((t, k) => {
      t.classList.toggle('is-selected', k === i);
      t.setAttribute('aria-checked', String(k === i));
    });
    mark(i);
    revealRom(tiles[i]);
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

  root.append(title(TITLES[ex.type] || 'Choose'), prompt, list, bar);
  el.replaceChildren(root);
  if (ex.type === 'listen_choice') autoplay(cx.item(ex.audio), cx);

  return {
    root,
    showResult(result) {
      done = true;
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
      revealRom(list);
      if (prompt.reveal) prompt.reveal();
      const id = ex.itemIds && ex.itemIds[0];
      const extra = result.correct ? [] : [correctAnswer(cx.item(id), cx)];
      showVerdict(root, { bar, btn }, result, cx, extra);
    },
    destroy() { offKeys(); document.removeEventListener('keydown', onEnter); },
  };
}
