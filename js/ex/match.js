// ex/match.js: match (S4; DESIGN 7 "Match"). Two columns, Telugu and English. Tap one of each:
// a pair locks in (surface-2 with a tick); a mismatch shows the wrong state (red, a cross, a short shake) for 900 ms and counts a
// miss against both items involved. When every pair is matched the answer {misses} is sent.

import { h, ensureStyles, makeCtx, teWords, revealRom, title, actionBar, showVerdict, icon, seededShuffle,
  audioMsg, playWithMsg } from './common.js';

export const MISS_MS = 900;   // design 2 E2

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  const cx = makeCtx(ctx);
  const ex = exercise;
  const pairs = (ex.pairs || []).map((p, i) => ({ ...p, k: i, id: (p.t && p.t.itemId) || `pair${i}` }));
  const misses = {};
  let sel = { te: null, en: null };
  let matched = 0;
  let busy = false;
  let done = false;
  const msg = audioMsg(); // Q3c S2: a tile's clip that won't play says so, under the board

  function card(p, side) {
    const telugu = side === 'te';
    const c = h('button', { type: 'button', class: `match-card match-${side}`, 'data-pair': String(p.k),
      'data-item': p.id, 'aria-pressed': 'false', ...(telugu ? { 'data-card': '' } : {}) },
      telugu ? teWords(p.t, cx, 'md', { tapReveal: false }) : h('span', { class: 'en', text: p.en }),
      h('span', { class: 'match-mark', 'aria-hidden': 'true' }));
    c.addEventListener('click', () => pick(side, p, c));
    return c;
  }
  // design 1 #10: both columns share one grid (.match-col is display: contents), row n facing row n
  const at = (c, col, row) => { c.style.gridColumn = String(col); c.style.gridRow = String(row); return c; };
  const left = pairs.map((p, i) => at(card(p, 'te'), 1, i + 1));
  const rightOrder = seededShuffle(pairs, ex.id || pairs.map(p => p.id).join('|'));
  const right = rightOrder.map((p, i) => at(card(p, 'en'), 2, i + 1));
  const cardOf = (side, p) => (side === 'te' ? left[p.k] : right[rightOrder.indexOf(p)]);

  function pick(side, p, c) {
    if (busy || done || c.classList.contains('is-matched')) return;
    if (side === 'te') {
      revealRom(c);
      const it = cx.item(p.id);
      if (it && it.audio) playWithMsg(it, cx, msg, { slow: false });
    }
    const prev = sel[side];
    if (prev) { prev.c.classList.remove('is-selected'); prev.c.setAttribute('aria-pressed', 'false'); }
    if (prev && prev.p === p) { sel[side] = null; return; }
    sel[side] = { p, c };
    c.classList.add('is-selected');
    c.setAttribute('aria-pressed', 'true');
    if (sel.te && sel.en) settle();
  }

  function settle() {
    const a = sel.te, b = sel.en;
    sel = { te: null, en: null };
    for (const x of [a, b]) { x.c.classList.remove('is-selected'); x.c.setAttribute('aria-pressed', 'false'); }
    if (a.p === b.p) {
      for (const x of [a, b]) {
        x.c.classList.add('is-matched');
        x.c.disabled = true;
        x.c.querySelector('.match-mark').append(icon('tick'));
      }
      matched += 1;
      if (matched === pairs.length) finish();
      return;
    }
    for (const id of new Set([a.p.id, b.p.id])) misses[id] = (misses[id] || 0) + 1;
    busy = true;
    // design 2 E2: a wrong pair is not shown by colour alone: each card gets a cross
    for (const x of [a, b]) { x.c.classList.add('is-wrong'); x.c.querySelector('.match-mark').replaceChildren(icon('cross')); }
    setTimeout(() => {
      for (const x of [a, b]) { x.c.classList.remove('is-wrong'); x.c.querySelector('.match-mark').replaceChildren(); }
      busy = false;
    }, MISS_MS);
  }

  const { bar, btn } = actionBar();
  btn.hidden = true;

  function finish() {
    done = true;
    onAnswer({ misses: { ...misses } });
  }

  const root = h('section', { class: 'ex ex-match', 'data-type': 'match' },
    title('Tap the pairs'),
    h('div', { class: 'match-grid' },
      h('div', { class: 'match-col match-col-te', role: 'group', 'aria-label': 'Telugu' }, left),
      h('div', { class: 'match-col match-col-en', role: 'group', 'aria-label': 'English' }, right)),
    msg, bar);
  el.replaceChildren(root);

  return {
    root,
    misses: () => ({ ...misses }),
    showResult(result) {
      done = true;
      for (const p of pairs) {
        const bad = result.perItem && result.perItem[p.id] === 'wrong';
        for (const side of ['te', 'en']) {
          const c = cardOf(side, p);
          c.disabled = true;
          if (bad) c.classList.add('was-missed');
        }
      }
      showVerdict(root, { bar, btn }, result, cx, []);
    },
    destroy() {},
  };
}
