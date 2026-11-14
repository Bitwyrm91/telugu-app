// ex/typein.js: typein, listen_type (S4, S6). Two modes:
//   tiles     build the word from syllable tiles (a repeated unit has two tiles; the space tile
//             never runs out); the answer is the tiles' Telugu joined.
//   keyboard  a text field: Telugu letters or Latin letters by the S6 scheme, with a
//             "How to type" list. The answer is the text as typed.

import {
  h, ensureStyles, makeCtx, enPrompt, listenPrompt, title, actionBar, showVerdict, correctAnswer,
  infoRow, autoplay, icon, hasTelugu, shortcutOk,
} from './common.js';
import { tileBoard } from './board.js';

// The S6 Latin scheme, as the learner types it.
export const SCHEME = [
  ['aa ii uu ee oo', 'ā ī ū ē ō'],
  ['Th Dh', 'ṭh ḍh'],
  ['sh', 'ś'],
  ['jn', 'jñ'],
  ['T D N L S R M H', 'ṭ ḍ ṇ ḷ ṣ ṛ ṁ ḥ'],
  ['w', 'v'],
  ['f', 'ph'],
  ['z', 'j'],
  ['c', 'ch'],
];

function howToType() {
  const panel = h('div', { class: 'howto', id: 'howto-' + Math.random().toString(36).slice(2, 8), hidden: true },
    h('p', { class: 'howto-lead', text: 'Type Telugu letters, or English letters like this:' }),
    h('table', { class: 'howto-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Type' }), h('th', { scope: 'col', text: 'For' }))),
      h('tbody', {}, SCHEME.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', { text: k })), h('td', { class: 'rom', text: v }))))),
    h('p', { class: 'howto-foot', text: 'Double a letter for a doubled sound: amma, nīḷḷu. Capitals matter only for T D N L S R M H.' }));
  const btn = h('button', { type: 'button', class: 'btn btn-quiet howto-btn', 'aria-expanded': 'false',
    'aria-controls': panel.id }, icon('keyboard'), h('span', { text: 'How to type' }));
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  return h('div', { class: 'howto-wrap' }, btn, panel);
}

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  const cx = makeCtx(ctx);
  const ex = exercise;
  const listen = ex.type === 'listen_type';
  const mode = ex.mode === 'keyboard' ? 'keyboard' : 'tiles';
  const root = h('section', { class: `ex ex-type ex-type-${mode}`, 'data-type': ex.type, 'data-mode': mode });
  let done = false;
  const prompt = listen
    ? listenPrompt(ex.audio, cx, { onSkip: () => { if (done) return; done = true; onAnswer({ skip: true }); } })
    : enPrompt(ex.prompt);
  const { bar, btn } = actionBar();
  let board = null;
  let input = null;
  let answer = () => '';
  let body;

  if (mode === 'tiles') {
    const tiles = (ex.tiles || []).map(w => (/^\s+$/.test(w.te)
      ? { kind: 'space', value: ' ', reuse: true }
      : { kind: 'te', w, value: w.te }));
    board = tileBoard(tiles, { cx, onChange: vals => { btn.disabled = done || !vals.join('').trim(); } });
    answer = () => board.values().join('');
    body = h('div', { class: 'board' }, board.line, board.bank);
  } else {
    const id = 'ti-' + Math.random().toString(36).slice(2, 8);
    input = h('input', { type: 'text', id, class: 'type-input', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', lang: 'te-Latn', inputmode: 'text', enterkeyhint: 'done' });
    input.addEventListener('input', () => {
      input.classList.toggle('is-telugu', hasTelugu(input.value));
      btn.disabled = done || !input.value.trim();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
    });
    answer = () => input.value;
    body = h('div', { class: 'type-field' },
      h('label', { class: 'type-label', for: id, text: listen ? 'Type what you hear' : 'Type it in Telugu' }),
      input, howToType());
  }

  function submit() {
    if (done) return;
    const a = answer();
    if (!a.trim()) return;
    done = true;
    btn.disabled = true;
    onAnswer(a);
  }
  btn.addEventListener('click', submit);
  const onEnter = e => {
    if (mode === 'tiles' && e.key === 'Enter' && !done && answer().trim() && shortcutOk(e, root)) {
      e.preventDefault();
      submit();
    }
  };
  document.addEventListener('keydown', onEnter);

  root.append(title(listen ? 'Write what you hear' : 'Write this in Telugu'), prompt, body, bar);
  el.replaceChildren(root);
  if (listen) autoplay(cx.item(ex.audio), cx);
  // Q3e minor 5: on a touch phone, focusing the field raises the keyboard before the prompt is
  // read or heard; leave focus on the heading there (the keyboard rises when the field is tapped).
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (input && !coarse) { try { input.focus({ preventScroll: true }); } catch { /* ignore */ } }

  return {
    root,
    showResult(result) {
      done = true;
      const st = result.skipped ? '' : result.close ? 'close' : result.correct ? 'right' : 'wrong';
      if (board) board.lock(st);
      if (input) { input.readOnly = true; input.dataset.state = st; }
      if (prompt.reveal) prompt.reveal();
      const it = cx.item(ex.itemIds && ex.itemIds[0]);
      const typed = result.typed ?? answer().trim();
      const latin = typed && !hasTelugu(typed);
      // S10: romanization shows in the feedback after an answer typed in Latin letters, even when off.
      const fcx = latin ? { ...cx, settings: { ...cx.settings, rom: 'on' } } : cx;
      const extra = [];
      if (result.message === 'respell') {
        const exp = result.expected || (ex.accept || [])[0] || {};
        extra.push(infoRow(`Accepted. In this app's spelling: ${exp.rom || ''}`));
      }
      if (result.message === 'spaces') extra.push(infoRow('Check the spaces'));
      if (latin && (!result.correct || result.close)) {
        extra.push(h('p', { class: 'ex-typed' }, h('span', { class: 'caption', text: 'You typed: ' }),
          h('span', { class: 'typed', text: typed })));
      }
      if (!result.correct || result.close) extra.push(correctAnswer(it, fcx, result.expected));
      showVerdict(root, { bar, btn }, result, cx, extra);
    },
    destroy() { if (board) board.destroy(); document.removeEventListener('keydown', onEnter); },
  };
}
