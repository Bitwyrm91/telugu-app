// ui/write.js: the writing trainer screens (SPECS S17 "Screens", S18 "Words", "Daily use").
//
//   #/write           grid of met letters (stage dots, due mark), syllables once both parts are at Recall,
//                     words from finished lessons (locked until their letters reach Copy), "Practise now",
//                     "Free writing"
//   #/write/<id>      one item's ladder from its stored stage to Recall (W:<item id> for a word)
//   #/write/practice  a practice run (the Home card opens it); #/write/free the scratchpad
//   reviewTail(slot, ids, {onDone})   S18 "Writing in reviews": up to 2 Recall items, not scored
// Test hooks: [data-write-screen], [data-write-cell][data-item][data-stage][data-due][data-locked],
// [data-session] (data-at, data-total), [data-summary] with [data-sum-item][data-stars][data-moved],
// [data-free] (the scratchpad), [data-review-tail].

import * as store from '../store.js';
import { h, ensureStyles, confidenceLabel } from '../ex/common.js';
import { teNode } from './te.js';
import { describe, mountLadder, STAGE_NAMES, firstStage, starsNode } from '../write/ladder.js';
import { rivalIds } from '../write/rivals.js';
import { loadPool, writeItems as poolItems, SESSION } from '../write/pool.js';
import { mountPad, letterLayout } from '../write/pad.js';
import { wordLayout } from '../write/word.js';
import { fontReady } from '../write/glyph.js';
import * as prog from '../write/progress.js';

export const writeItems = poolItems;

let styled = false;
export function writeStyles() {
  ensureStyles();
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/write.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function rivalsFor(item, L) {
  if (!item || item.syllable || item.word) return [];
  return rivalIds(item.id, L.letters || []).map(id => describe(id, L, null)).filter(Boolean);
}

function stageDots(stage, from) {
  return h('span', { class: 'ww-dots', 'aria-hidden': 'true' },
    STAGE_NAMES.slice(from).map((_, i) => h('span', { class: `ww-dot${i + from < stage ? ' is-past' : ''}${i + from === stage ? ' is-on' : ''}` })));
}

function applyHand(el) {
  const s = store.get('settings') || {};
  el.toggleAttribute('data-left', !!s.leftHanded);
}

const nameOf = it => (it.word ? it.en : it.rom);

export async function render(el, route) {
  writeStyles();
  const page = h('section', { class: 'ww', 'data-write-screen': '' });
  applyHand(page);
  el.replaceChildren(page);
  const P = await loadPool();
  const { L, S } = P;
  if (!L) {
    page.append(h('h1', { class: 'screen-title', text: 'Writing' }), h('div', { class: 'state-empty' }, h('p', { text: 'The letters are not in the app yet.' })));
    return () => {};
  }
  let current = null;
  const stop = () => { if (current) { current.destroy(); current = null; } };
  const desc = id => describe(id, L, S, P.wordMap);

  if (route && route.name === 'writeItem') {
    const id = route.params.id;
    if (id === 'practice') { session(prog.pickSession(P.ids, SESSION, Date.now()), true); return stop; }
    if (id === 'free') { free(); return stop; }
    one(id);
    return stop;
  }
  grid();
  return stop;

  // ---- one item ----
  function one(id) {
    const item = desc(id);
    const back = h('a', { class: 'btn btn-quiet ww-back', href: '#/write', text: 'All writing' });
    if (!item) {
      page.replaceChildren(back, h('h1', { class: 'screen-title', text: 'Writing' }),
        h('div', { class: 'state-empty' }, h('p', { text: id.startsWith('W:') ? 'That word is not open for writing yet.' : 'That letter is not in the app.' })));
      return;
    }
    // romanisation or meaning only: the item can open at Recall, where the target must not be on screen
    const title = h('h1', { class: 'screen-title ww-title', tabindex: '-1', text: `Write: ${nameOf(item)}` });
    const slot = h('div', { class: 'ww-slot' });
    page.replaceChildren(back, title, slot, honesty(item));
    current = mountLadder(slot, item, {
      strokes: S, rivals: rivalsFor(item, L), lastLabel: 'Back to all writing',
      onFinish: () => { location.hash = '#/write'; },
    });
    try { title.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function honesty(item) {
    return h('div', { class: 'ww-honest' },
      item.entry ? confidenceLabel('low') : null,
      h('p', { class: 'ww-honest-text', text: item.entry
        ? 'Stroke order is not yet confirmed by a native writer. The writing stages check the shape only.'
        : item.word ? 'The app checks the shape of each syllable, not the stroke order or the spacing.'
          : 'The app checks the shape of your writing, not the stroke order.' }));
  }

  // ---- grid ----
  function grid() {
    stop();
    const { letters, syllables, words } = P;
    const now = Date.now();
    const items = prog.allItems();
    const dueN = P.ids.filter(id => prog.isDue(prog.getItem(id), now)).length;
    const head = h('h1', { class: 'screen-title', text: 'Writing', tabindex: '-1' });
    const freeBtn = h('a', { class: 'btn btn-secondary ww-free', href: '#/write/free', text: 'Free writing' });
    if (!letters.length) {
      page.replaceChildren(head, h('div', { class: 'state-empty' },
        h('p', { text: 'Meet a letter in a lesson first. Then you can practise writing it here.' }),
        h('a', { class: 'btn btn-secondary', href: '#/letters' }, 'Go to Letters')), h('div', { class: 'ww-actions' }, freeBtn));
      return;
    }
    const go = h('button', { type: 'button', class: 'btn btn-main ww-go', text: 'Practise now' });
    go.addEventListener('click', () => session(prog.pickSession(P.ids, SESSION, Date.now())));
    const intro = h('p', { class: 'ww-intro', text: dueN
      ? `${dueN} to practise now. Each letter climbs five steps: watch, trace, fade, copy, then write it from memory.`
      : 'Nothing is due. Practise any letter, or come back later.' });
    const cell = (id, locked = null) => {
      const it = desc(id);
      if (!it) return null;
      const r = items[id] ? prog.getItem(id) : null;
      const from = firstStage(it);
      const stage = Math.max(from, r ? r.stage : 0);
      const due = r && r.stage >= 4 && prog.isDue(r, now);
      const kids = [it.word ? teNode(it.display, { class: 'ww-glyph ww-word' }) : teNode(it.display, { class: 'ww-glyph' }),
        h('span', { class: 'ww-rom', text: it.word ? it.en : it.rom }), stageDots(stage, from),
        due ? h('span', { class: 'ww-due', text: 'Due' }) : null];
      const label = `${nameOf(it)}: ${locked ? `locked until ${locked}` : stage >= 4 ? 'writing from memory' : `next step ${STAGE_NAMES[stage]}`}${due ? ', due' : ''}`;
      const attrs = { class: `ww-cell${it.word ? ' ww-cell-word' : ''}`, 'data-write-cell': '', 'data-item': id,
        'data-stage': String(stage), 'data-due': String(!!due), 'aria-label': label };
      if (locked) return h('div', { ...attrs, role: 'img', 'data-locked': '' }, ...kids);
      return h('a', { ...attrs, href: '#/write/' + encodeURIComponent(id) }, ...kids);
    };
    const blocks = [h('section', { class: 'ww-group' }, h('h2', { class: 'ww-h2', text: 'Letters you have met' }),
      h('div', { class: 'ww-grid' }, letters.map(id => cell(id)).filter(Boolean)))];
    if (syllables.length) {
      blocks.push(h('section', { class: 'ww-group' }, h('h2', { class: 'ww-h2', text: 'Syllables' }),
        h('p', { class: 'ww-note', text: 'A consonant with a vowel sign, once you can write both from memory.' }),
        h('div', { class: 'ww-grid' }, syllables.map(id => cell(id)).filter(Boolean))));
    }
    if (words.length) {
      const rom = id => { const l = L.letters.find(x => x.id === id); return l ? l.rom || id : id; };
      blocks.push(h('section', { class: 'ww-group', 'data-words': '' }, h('h2', { class: 'ww-h2', text: 'Words' }),
        h('p', { class: 'ww-note', text: 'Words from your lessons. Copy them, then write them from their meaning. A word opens when you can copy each of its letters.' }),
        h('div', { class: 'ww-grid ww-grid-words' }, words.map(w => cell(w.id, w.unlocked ? null
          : `you can copy ${w.needs.filter(n => prog.getItem(n).stage < 3).map(rom).join(', ')}`)).filter(Boolean))));
    }
    page.replaceChildren(head, intro, h('div', { class: 'ww-actions' }, go, freeBtn), ...blocks);
  }

  // ---- a practice run ----
  function session(list, fromHome = false) {
    stop();
    if (!list.length) {
      page.replaceChildren(h('a', { class: 'btn btn-quiet ww-back', href: '#/write', text: 'All writing' }),
        h('h1', { class: 'screen-title', text: 'Writing' }),
        h('div', { class: 'state-empty' }, h('p', { text: 'Nothing to write yet. Meet a letter in a lesson first.' })));
      return;
    }
    let at = 0, passed = 0, skipped = 0;
    const rows = [];   // {id, before, after, stars}
    const box = h('div', { class: 'ww-session', 'data-session': '', 'data-total': String(list.length) });
    const count = h('p', { class: 'ww-count' });
    const bar = h('div', { class: 'ww-bar', role: 'progressbar', 'aria-label': 'Practice', 'aria-valuemin': '0', 'aria-valuemax': String(list.length) },
      h('span', { class: 'ww-bar-fill' }));
    const quit = h('button', { type: 'button', class: 'btn btn-quiet ww-quit', text: 'End practice' });
    quit.addEventListener('click', () => (rows.some(r => r.done) ? done() : fromHome ? (location.hash = '#/') : grid()));
    const slot = h('div', { class: 'ww-slot' });
    box.append(h('div', { class: 'ww-session-head' }, count, quit), bar, slot);
    page.replaceChildren(box);
    const nextItem = () => {
      stop();
      if (at >= list.length) { done(); return; }
      box.dataset.at = String(at);
      count.textContent = `${at + 1} of ${list.length}`;
      bar.setAttribute('aria-valuenow', String(at));
      bar.firstChild.style.width = `${(100 * at) / list.length}%`;
      const item = desc(list[at]);
      if (!item) { at += 1; nextItem(); return; }
      const r = prog.getItem(item.id);
      const from = Math.max(firstStage(item), r.stage);
      const to = from >= 4 ? 4 : Math.min(4, from + 1);
      const row = { id: item.id, item, before: from, after: from, stars: 0, done: false };
      rows.push(row);
      current = mountLadder(slot, item, {
        strokes: S, rivals: rivalsFor(item, L), from, to,
        lastLabel: at + 1 < list.length ? (list.length - at > 1 ? 'Next item' : 'Finish') : 'Finish',
        onStage: (_, outcome, res) => {
          if (outcome === 'pass') { passed += 1; row.stars = Math.max(row.stars, (res && res.stars) || 1); } else if (outcome === 'skip') skipped += 1;
          row.after = Math.max(firstStage(item), prog.getItem(item.id).stage);
          row.done = true;
        },
        onFinish: () => { at += 1; nextItem(); },
      });
    };
    const done = () => {
      stop();
      bar.firstChild.style.width = '100%';
      const list2 = rows.filter(r => r.done);
      const moved = list2.filter(r => r.after > r.before);
      const sum = h('ul', { class: 'ww-sum', 'aria-label': 'What you wrote' }, list2.map(r => h('li', { class: 'ww-sum-row', 'data-sum-item': r.id,
        'data-stars': String(r.stars), 'data-moved': String(r.after > r.before) },
      // after a practice the target can be shown: it has been written
      teNode(r.item.display, { class: 'ww-sum-te' }),
      h('span', { class: 'ww-sum-name', text: nameOf(r.item) }),
      r.stars ? starsNode(r.stars) : h('span', { class: 'ww-sum-skip', text: 'Skipped' }),
      h('span', { class: 'ww-sum-move', text: r.after > r.before ? `Up to ${STAGE_NAMES[Math.min(4, r.after)]}` : r.before >= 4 ? 'Recall kept' : `At ${STAGE_NAMES[r.before]}` }))));
      const msg = h('div', { class: 'ww-done', tabindex: '-1', 'data-summary': '' },
        h('h2', { class: 'ww-h2', text: 'Practice done' }),
        h('p', { text: `${passed} step${passed === 1 ? '' : 's'} passed${skipped ? `, ${skipped} skipped` : ''}. ${moved.length ? `${moved.length} moved up a stage.` : ''}`.trim() }),
        sum,
        h('a', { class: 'btn btn-main', href: '#/write', text: 'Back to writing' }));
      msg.querySelector('a.btn-main').addEventListener('click', e => { e.preventDefault(); if (location.hash !== '#/write') location.hash = '#/write'; else grid(); });
      slot.replaceChildren(msg);
      count.textContent = 'Done';
      quit.hidden = true;
      try { msg.focus({ preventScroll: true }); } catch { /* ignore */ }
    };
    nextItem();
  }

  // ---- free writing ----
  function free() {
    stop();
    const back = h('a', { class: 'btn btn-quiet ww-back', href: '#/write', text: 'All writing' });
    const title = h('h1', { class: 'screen-title ww-title', tabindex: '-1', text: 'Free writing' });
    const note = h('p', { class: 'ww-intro', text: 'Write anything. Nothing is checked or scored here.' });
    const sel = h('select', { class: 'ww-select', id: 'ww-model', 'aria-describedby': 'ww-model-help' });
    sel.append(h('option', { value: '', text: 'No model' }));
    const og1 = h('optgroup', { label: 'Letters' });
    for (const l of L.letters || []) {
      const t = (l.type && ['sign', 'mark', 'final'].includes(l.type)) ? null : l.glyph;
      if (t) og1.append(h('option', { value: t, text: `${l.glyph}  ${l.rom || l.id}` }));
    }
    sel.append(og1);
    if (P.words.length) {
      const og2 = h('optgroup', { label: 'Words' });
      for (const w of P.words) og2.append(h('option', { value: w.item.te, text: `${w.item.te}  ${w.item.en || ''}` }));
      sel.append(og2);
    }
    const lab = h('label', { class: 'ww-label', for: 'ww-model', text: 'Faint model' });
    const help = h('p', { class: 'visually-hidden', id: 'ww-model-help', text: 'A grey letter or word under your writing, to copy.' });
    const slot = h('div', { class: 'ww-free-box' });
    const undo = h('button', { type: 'button', class: 'btn btn-secondary wl-undo', text: 'Undo' });
    const clear = h('button', { type: 'button', class: 'btn btn-secondary wl-clear', text: 'Clear' });
    const acts = h('div', { class: 'wl-actions', role: 'group', 'aria-label': 'Writing box' }, undo, clear);
    page.replaceChildren(back, title, note, h('div', { class: 'ww-model-row' }, lab, sel, help),
      h('div', { class: 'ww-free', 'data-free': '' }, slot, acts));
    let pad = null;
    const setBtns = () => { const n = !pad || !pad.count(); undo.disabled = n; clear.disabled = n; };
    const mount = async () => {
      await fontReady();
      const prev = pad ? pad.timed() : [];
      if (pad) pad.destroy();
      slot.replaceChildren();
      const text = sel.value;
      let layout;
      if (!text) { const b = letterLayout('అ'); layout = { w: 2000, h: 1000, base: b.base, head: b.head, mid: b.mid, cells: [] }; }
      else if (P.words.some(w => w.item.te === text)) layout = wordLayout(text);
      pad = mountPad(slot, { text: text || 'అ', layout, modelAlpha: text ? 0.18 : 0, cellMarks: false,
        label: text ? 'Free writing box with a faint model' : 'Free writing box', onPenUp: setBtns });
      if (prev.length && pad.el.__pad) pad.el.__pad.add(prev.map(s => s.pts || s));
      setBtns();
    };
    undo.addEventListener('click', () => { if (pad) { pad.undo(); setBtns(); } });
    clear.addEventListener('click', () => { if (pad) { pad.clear(); setBtns(); } });
    sel.addEventListener('change', () => { if (pad) pad.clear(); mount(); });
    mount();
    current = { destroy() { if (pad) pad.destroy(); pad = null; } };
    try { title.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
}

/**
 * S18 "Writing in reviews": up to 2 Recall items (letters due for writing), written at the end of a review.
 * Not scored: the writing record is still kept, lesson and recognition scores are never touched.
 * Resolves to false when there is nothing to write (the caller then goes straight on).
 */
export async function reviewTail(slot, { onDone } = {}) {
  writeStyles();
  const P = await loadPool();
  if (!P.L) return false;
  const now = Date.now();
  const ids = P.letters.filter(id => { const r = prog.getItem(id); return r.stage >= 4 && prog.isDue(r, now); }).slice(0, 2);
  if (!ids.length) return false;
  let at = 0, cur = null;
  const box = h('section', { class: 'ww-tail', 'data-review-tail': '', 'aria-label': 'Writing' });
  const head = h('h2', { class: 'ww-h2', tabindex: '-1', text: 'Write from memory' });
  const note = h('p', { class: 'ww-note', text: 'Not scored. Your review is already saved.' });
  const inner = h('div', { class: 'ww-slot' });
  const skip = h('button', { type: 'button', class: 'btn btn-quiet ww-quit', text: 'Skip writing' });
  box.append(head, note, inner, h('div', { class: 'ww-actions' }, skip));
  slot.replaceChildren(box);
  const end = () => {
    if (cur) cur.destroy();
    cur = null;
    box.dataset.done = '';
    box.replaceChildren(h('p', { class: 'ww-note', role: 'status', text: at ? 'Writing done. Nothing here changed your score.' : 'Writing skipped.' }));
    if (typeof onDone === 'function') onDone();
  };
  skip.addEventListener('click', end);
  const next = () => {
    if (cur) cur.destroy();
    if (at >= ids.length) { end(); return; }
    const item = describe(ids[at], P.L, P.S, P.wordMap);
    box.dataset.at = String(at);
    cur = mountLadder(inner, item, { strokes: P.S, from: 4, to: 4, lastLabel: at + 1 < ids.length ? 'Next' : 'Done',
      onFinish: () => { at += 1; next(); } });
  };
  next();
  try { head.focus({ preventScroll: true }); } catch { /* ignore */ }
  return true;
}
