// ex/bank.js: bank_te_en, bank_en_te, listen_bank (S4). Build the answer from word tiles;
// the answer is the list of placed words (English words, or Telugu token texts).

import {
  h, ensureStyles, makeCtx, tePrompt, enPrompt, listenPrompt, title, actionBar, showVerdict,
  correctAnswer, infoRow, autoplay, shortcutOk,
} from './common.js';
import { tileBoard } from './board.js';

const TITLES = {
  bank_te_en: 'Write this in English',
  bank_en_te: 'Write this in Telugu',
  listen_bank: 'Tap what you hear',
};

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  const cx = makeCtx(ctx);
  const ex = exercise;
  const root = h('section', { class: 'ex ex-bank', 'data-type': ex.type });

  let prompt;
  if (ex.type === 'bank_te_en') prompt = tePrompt(ex.prompt, cx);
  else if (ex.type === 'bank_en_te') prompt = enPrompt(ex.prompt);

  const english = ex.type === 'bank_te_en';
  const tiles = (ex.bank || []).map(b => english
    ? { kind: 'en', text: String(b), value: String(b) }
    : { kind: 'te', w: b, value: b.te });

  let done = false;
  if (ex.type === 'listen_bank') prompt = listenPrompt(ex.audio, cx, { onSkip: () => { if (done) return; done = true; onAnswer({ skip: true }); } });
  const { bar, btn } = actionBar();
  const board = tileBoard(tiles, { cx, onChange: vals => { btn.disabled = done || vals.length === 0; } });

  function submit() {
    if (done) return;
    const vals = board.values();
    if (!vals.length) return;
    done = true;
    btn.disabled = true;
    onAnswer(vals);
  }
  btn.addEventListener('click', submit);
  const onEnter = e => {
    if (e.key === 'Enter' && !done && board.values().length && shortcutOk(e, root)) { e.preventDefault(); submit(); }
  };
  document.addEventListener('keydown', onEnter);

  root.append(title(TITLES[ex.type] || 'Build the answer'), prompt,
    h('div', { class: 'board' }, board.line, board.bank), bar);
  el.replaceChildren(root);
  if (ex.type === 'listen_bank') autoplay(cx.item(ex.audio), cx);

  return {
    root,
    showResult(result) {
      done = true;
      const st = result.skipped ? '' : result.close ? 'close' : result.correct ? 'right' : 'wrong';
      board.lock(st);
      if (prompt.reveal) prompt.reveal();
      const it = cx.item(ex.itemIds && ex.itemIds[0]);
      const extra = [];
      if (!result.correct || result.close) {
        if (english) {
          extra.push(h('div', { class: 'ex-answer' }, h('p', { class: 'caption', text: 'Correct answer' }),
            h('p', { class: 'en en-lg', text: String(result.expected || (ex.accept || [])[0] || '') })));
        } else {
          extra.push(correctAnswer(it, cx)); // S2: the item's own sentence, never a te_alt
        }
      }
      if (result.message === 'spaces') extra.push(infoRow('Check the spaces'));
      showVerdict(root, { bar, btn }, result, cx, extra);
    },
    destroy() { board.destroy(); document.removeEventListener('keydown', onEnter); },
  };
}
