// ex/board.js: the tile board shared by the word banks and tile typing (DESIGN 7 "Word tile").
// Tap a bank tile to put it on the answer line (it leaves a ghost behind); tap a placed tile to
// send it back. A `reuse` tile (the space tile) never runs out. Backspace takes the last one back.

import { h, teWords, revealRom, icon, shortcutOk } from './common.js';

/**
 * tiles: [{kind: 'te'|'en'|'space', w (W, for te), text (for en), value}]
 * opts: {cx, onChange(values), label}
 */
export function tileBoard(tiles, opts) {
  const { cx } = opts;
  const placed = []; // {i, node}
  let locked = false;

  const line = h('div', { class: 'answer-line', 'aria-label': opts.label || 'Your answer', role: 'list' });
  const bank = h('div', { class: 'bank', role: 'list', 'aria-label': 'Tiles' });

  function face(t, isPlaced) {
    if (t.kind === 'space') {
      return h('span', { class: 'tile-space-face' }, icon('space-bar', 'i-space'),
        h('span', { class: 'en', text: 'space' }));
    }
    if (t.kind === 'te') {
      const words = teWords(t.w, cx, 'md', { tapReveal: false });
      if (isPlaced) revealRom(words);
      return words;
    }
    return h('span', { class: 'en', text: t.text });
  }

  // design 3 #15: an invisible zero-width placed tile (the tallest kind on this board) holds the
  // empty line at one tile row, so the first tile placed moves nothing below it
  const probeTile = tiles.find(t => t.kind === 'te') || tiles[0];
  if (probeTile) line.append(h('span', { class: 'tile-probe', 'aria-hidden': 'true' }, face(probeTile, true)));

  const bankBtns = tiles.map((t, i) => {
    const b = h('button', { type: 'button', class: `tile tile-${t.kind}`, role: 'listitem', 'data-index': String(i),
      'data-value': t.kind === 'space' ? ' ' : String(t.value), ...(t.kind === 'te' ? { 'data-card': '' } : {}) },
      face(t, false));
    b.addEventListener('click', e => place(i, e.detail === 0)); // detail 0: Enter / Space, not a pointer
    noRepeat(b);
    bank.append(b);
    return b;
  });

  // Q3g minor 1: a held Enter / Space on a tile acts once (no auto-repeat clicks)
  function noRepeat(btn) {
    btn.addEventListener('keydown', e => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
  }

  function focusBox() {
    const box = line.parentElement || line;
    box.tabIndex = -1;
    try { box.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function changed() {
    line.classList.toggle('is-empty', placed.length === 0);
    opts.onChange(placed.map(p => tiles[p.i].value));
  }

  function place(i, byKey = true) {
    if (locked) return;
    const t = tiles[i];
    const b = bankBtns[i];
    if (!t.reuse && b.classList.contains('is-ghost')) return;
    const node = h('button', { type: 'button', class: `tile tile-${t.kind} tile-placed`, role: 'listitem',
      'data-value': t.kind === 'space' ? ' ' : String(t.value), ...(t.kind === 'te' ? { 'data-card': '' } : {}) },
      face(t, true));
    const rec = { i, node };
    node.addEventListener('click', e => unplace(rec, e.detail === 0));
    noRepeat(node);
    placed.push(rec);
    line.append(node);
    revealRom(b);
    if (!t.reuse) {
      if (document.activeElement === b) { // keep focus off a hidden tile
        // Q3f S1: by keyboard, on to the next tile; after a pointer click, the board itself, so
        // Enter reaches the page shortcut and checks instead of adding another tile.
        const nx = bankBtns.find(x => x !== b && !x.classList.contains('is-ghost'));
        if (!byKey) focusBox();
        else try { (nx || node).focus({ preventScroll: true }); } catch { /* ignore */ }
      }
      b.classList.add('is-ghost');
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-hidden', 'true'); // Q3b minor 5: a used tile is out of the reading order
      b.tabIndex = -1;
    }
    changed();
  }

  function unplace(rec, byKey = true) {
    if (locked) return;
    const k = placed.indexOf(rec);
    if (k < 0) return;
    const had = document.activeElement === rec.node;
    placed.splice(k, 1);
    rec.node.remove();
    const b = bankBtns[rec.i];
    if (!placed.some(p => p.i === rec.i)) {
      b.classList.remove('is-ghost');
      b.removeAttribute('aria-disabled');
      b.removeAttribute('aria-hidden');
      b.tabIndex = 0;
    }
    // Q3g S1: focus never drops to the page. By keyboard: the neighbouring placed tile (next, else
    // previous), else the tile just put back in the bank; after a pointer click: the board.
    if (had) {
      if (!byKey) focusBox();
      else {
        const nb = (placed[k] || placed[k - 1] || {}).node || b;
        try { nb.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    }
    changed();
  }

  const onKey = e => {
    if (locked || e.key !== 'Backspace') return;
    if (!shortcutOk(e, line.closest('.ex') || line, 'key')) return;
    if (placed.length) { e.preventDefault(); unplace(placed[placed.length - 1]); }
  };
  document.addEventListener('keydown', onKey);
  line.classList.add('is-empty');

  return {
    line,
    bank,
    values: () => placed.map(p => tiles[p.i].value),
    lock(state) {
      locked = true;
      for (const b of bankBtns) b.disabled = true;
      // design 4 #6: once graded, the used tiles' ghosts leave the pool (an empty pool goes too)
      for (const b of bankBtns) if (b.classList.contains('is-ghost')) b.style.display = 'none';
      if (bankBtns.every(b => b.style.display === 'none')) bank.style.display = 'none';
      for (const p of placed) {
        p.node.disabled = true;
        if (state) p.node.classList.add(`is-${state}`);
      }
      line.dataset.state = state || '';
    },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}
