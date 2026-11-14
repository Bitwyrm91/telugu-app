// ui/notes.js: the grammar note screen (task E12; SPECS S7 "Grammar note", S10 "Grammar note
// screen", "Confidence labels elsewhere"; DESIGN 7).
// Route: #/notes/<unitId>.
//
//   render(el, route) -> cleanup
// Draws the unit's compiled `note` block list:
//   {t:'h', spans} heading · {t:'p', spans} paragraph · {t:'ul', items:[spans]} bullet list ·
//   {t:'item', id} item card (te-stack with audio, English and the item's confidence label).
// Spans: {s} text · {b} bold · {i} emphasis (weight 500, never slanted) · {ref: itemId} a tappable
// chip; tapping it plays the item and opens (or closes) a small item card under its block.
// The unit's `note_confidence` label sits under the title. A unit with no note (none written, or
// left out by the build because it is not in use / marked wrong) shows the empty state.
// Telugu goes in only through teNode (via ex/common.js teWords); none is typed here.

import * as content from '../content.js';
import { teNode } from './te.js';
import { h, ensureStyles, makeCtx, romMode, audioButtons, confidenceLabel, teWords, icon, hasTelugu } from '../ex/common.js';

let styled = false;
function noteStyles() {
  ensureStyles(); // ex.css: audio buttons, te sizes, te-words, confidence labels
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/notes.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function unitNumber(id) {
  const m = /^u0*(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
}

function backLink() {
  return h('a', { class: 'btn btn-quiet notes-back', href: '#/' }, icon('back'), h('span', { text: 'Learn' }));
}

function emptyState(titleText, msg) {
  return h('section', { class: 'state-empty notes-empty' },
    backLink(),
    h('h1', { class: 'screen-title', text: titleText }),
    h('p', { text: msg }),
    h('a', { class: 'btn btn-secondary', href: '#/', text: 'Go to Learn' }));
}

/** Text that should hold no Telugu (rule 9); any that slips through still goes through teNode. */
function textNode(text) {
  return hasTelugu(text) ? teNode(text, { class: 'te-sm' }) : document.createTextNode(text);
}

export async function render(el, route) {
  noteStyles();
  const unitId = route.params.unitId;
  let unit = null;
  try {
    unit = await content.loadUnit(unitId);
  } catch {
    unit = null;
  }
  if (!unit) {
    el.append(emptyState('Grammar note', 'This unit could not be found. It may not be in the app yet.'));
    return;
  }

  const cx = makeCtx({});
  const byId = new Map((unit.items || []).map(it => [it.id, it]));
  const n = unitNumber(unit.id);
  const blocks = Array.isArray(unit.note) ? unit.note : [];

  const head = h('header', { class: 'notes-head' },
    backLink(),
    h('p', { class: 'notes-unit', text: n ? `Unit ${n} · grammar note` : 'Grammar note' }),
    h('h1', { class: 'screen-title notes-title', text: unit.title || 'Grammar note' }));

  if (!blocks.length) {
    el.append(h('section', { class: 'ex notes' }, head,
      h('div', { class: 'state-empty notes-empty' },
        h('p', { text: 'This unit has no grammar note yet. Its lessons teach whole phrases you can use straight away.' }),
        h('a', { class: 'btn btn-secondary', href: '#/', text: 'Go to Learn' }))));
    return;
  }

  const conf = confidenceLabel(unit.note_confidence);
  if (conf) head.append(h('div', { class: 'notes-conf' }, conf));

  // ---- item card (an `item` block, and the card a chip opens) ----
  const itemCard = (it, cls) => h('div', { class: `notes-item ${cls}`, 'data-card': '', 'data-item': it.id },
    h('div', { class: 'stack-row' },
      audioButtons(it, cx, { label: `Play: ${it.en}` }),
      h('div', { class: 'stack notes-stack' },
        teWords(it, cx, 'lg'),
        h('p', { class: 'en', text: it.en }),
        confidenceLabel(it.confidence, it.source))));

  const missing = () => h('span', { class: 'notes-missing', text: '(a word not in the app yet)' });

  let open = null; // {chip, card}
  const closeOpen = () => {
    if (!open) return;
    open.card.remove();
    open.chip.setAttribute('aria-expanded', 'false');
    open = null;
  };

  let refCount = 0;
  const chip = (it, place) => {
    const id = `note-ref-${++refCount}`;
    const mode = romMode(it, cx);
    const b = h('button', { type: 'button', class: 'notes-chip', 'data-ref': it.id,
      'aria-expanded': 'false', 'aria-controls': id, 'aria-label': `${it.en}: play and show` },
    teNode(it.te, { class: 'te-sm' }),
    mode === 'show' ? h('span', { class: 'rom notes-chip-rom', text: it.rom }) : null);
    b.addEventListener('click', () => {
      const same = open && open.chip === b;
      closeOpen();
      if (same) return;
      const card = itemCard(it, 'notes-ref-card');
      card.id = id;
      place(card);
      b.setAttribute('aria-expanded', 'true');
      open = { chip: b, card };
      const pair = card.querySelector('.audio-pair');
      if (pair && typeof pair.playNow === 'function') pair.playNow();
    });
    return b;
  };

  const spans = (list, place) => {
    const out = [];
    for (const sp of list || []) {
      if (!sp || typeof sp !== 'object') continue;
      if ('ref' in sp) {
        const it = byId.get(sp.ref);
        out.push(it ? chip(it, place) : missing());
      } else if ('b' in sp) {
        out.push(h('strong', { class: 'notes-b' }, textNode(String(sp.b))));
      } else if ('i' in sp) {
        out.push(h('em', { class: 'notes-i' }, textNode(String(sp.i))));
      } else if ('s' in sp) {
        out.push(textNode(String(sp.s)));
      }
    }
    return out;
  };

  const body = h('div', { class: 'notes-body' });
  for (const blk of blocks) {
    if (!blk || typeof blk !== 'object') continue;
    let node = null;
    if (blk.t === 'h') {
      node = h('h2', { class: 'notes-h' });
      node.append(...spans(blk.spans, card => node.after(card)));
    } else if (blk.t === 'p') {
      node = h('p', { class: 'notes-p' });
      node.append(...spans(blk.spans, card => node.after(card)));
    } else if (blk.t === 'ul') {
      node = h('ul', { class: 'notes-ul' });
      for (const li of blk.items || []) {
        const liEl = h('li', {});
        liEl.append(...spans(li, card => liEl.append(card)));
        node.append(liEl);
      }
    } else if (blk.t === 'item') {
      const it = byId.get(blk.id);
      node = it ? itemCard(it, 'notes-item-block') : h('p', { class: 'notes-p' }, missing());
    }
    if (node) { node.dataset.block = blk.t; body.append(node); }
  }

  el.append(h('article', { class: 'ex notes', 'data-unit': unit.id }, head, body));
  return () => closeOpen();
}
