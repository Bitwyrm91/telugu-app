// ui/write.js: the writing trainer screens (SPECS S17 "Screens").
//
//   #/write        grid of met letters (stage dots, due mark), syllables once both parts are at Recall,
//                  "Practise now" (up to 8 items: due recall first, then learning by lowest stage, weakest)
//   #/write/<id>   one item's ladder from its stored stage to Recall
// Test hooks: [data-write-screen], [data-write-cell][data-item][data-stage][data-due], [data-session]
// (data-at = item index, data-total).

import * as store from '../store.js';
import * as content from '../content.js';
import { h, ensureStyles, makeCtx, confidenceLabel } from '../ex/common.js';
import { teNode } from './te.js';
import { describe, mountLadder, STAGE_NAMES } from '../write/ladder.js';
import { rivalIds } from '../write/rivals.js';
import * as prog from '../write/progress.js';

const SESSION = 8;

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

/** Met letters in teaching order, and syllables whose consonant and sign are both at Recall. */
export function writeItems(L, cx) {
  const all = (L && L.letters) || [];
  const order = [];
  const seen = new Set();
  for (const ls of (Array.isArray(L.lessons) ? L.lessons : Object.values(L.lessons || {}))) {
    for (const id of ls.letters || []) if (!seen.has(id)) { seen.add(id); order.push(id); }
  }
  for (const l of all) if (!seen.has(l.id)) { seen.add(l.id); order.push(l.id); }
  const letters = order.filter(id => cx.taught.has(id) && all.some(l => l.id === id));
  const syll = [];
  const items = prog.allItems();
  const atRecall = id => items[id] && items[id].stage >= 4;
  // signs are written on the carrier (న), so carrier + sign is the sign item itself: not a second cell
  const carrierId = (all.find(l => l.glyph === L.carrier) || {}).id;
  for (const [c, signs] of Object.entries(L.built || {})) {
    if (!atRecall(c) || c === carrierId) continue;
    for (const s of Object.keys(signs || {})) if (atRecall(s)) syll.push(prog.syllableKey(c, s));
  }
  return { letters, syllables: syll };
}

function rivalsFor(item, L) {
  if (!item || item.syllable) return [];
  return rivalIds(item.id, L.letters || []).map(id => describe(id, L, null)).filter(Boolean);
}

function stageDots(stage, syllable) {
  const from = syllable ? 3 : 0;
  return h('span', { class: 'ww-dots', 'aria-hidden': 'true' },
    STAGE_NAMES.slice(from).map((_, i) => h('span', { class: `ww-dot${i + from < stage ? ' is-past' : ''}${i + from === stage ? ' is-on' : ''}` })));
}

function applyHand(el) {
  const s = store.get('settings') || {};
  el.toggleAttribute('data-left', !!s.leftHanded);
}

export async function render(el, route) {
  writeStyles();
  let L = null, S = null;
  try { L = await content.loadLetters(); } catch { L = null; }
  try { S = await content.loadStrokes(); } catch { S = null; }
  const page = h('section', { class: 'ww', 'data-write-screen': '' });
  applyHand(page);
  el.replaceChildren(page);
  if (!L || !Array.isArray(L.letters)) {
    page.append(h('h1', { class: 'screen-title', text: 'Writing' }), h('div', { class: 'state-empty' }, h('p', { text: 'The letters are not in the app yet.' })));
    return () => {};
  }
  const cx = makeCtx({ carrier: L.carrier });
  let current = null;
  const stop = () => { if (current) { current.destroy(); current = null; } };

  if (route && route.name === 'writeItem') {
    one(route.params.id);
    return stop;
  }
  grid();
  return stop;

  // ---- one item ----
  function one(id) {
    const item = describe(id, L, S);
    const back = h('a', { class: 'btn btn-quiet ww-back', href: '#/write', text: 'All writing' });
    if (!item) {
      page.replaceChildren(back, h('h1', { class: 'screen-title', text: 'Writing' }),
        h('div', { class: 'state-empty' }, h('p', { text: 'That letter is not in the app.' })));
      return;
    }
    // romanisation only: the item can open at Recall, where the glyph must not be on screen before a pass
    const title = h('h1', { class: 'screen-title ww-title', tabindex: '-1', text: `Write: ${item.rom}` });
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
        : 'The app checks the shape of your writing, not the stroke order.' }));
  }

  // ---- grid ----
  function grid() {
    stop();
    const { letters, syllables } = writeItems(L, cx);
    const ids = [...letters, ...syllables];
    const now = Date.now();
    const items = prog.allItems();
    const dueN = ids.filter(id => prog.isDue(prog.getItem(id), now)).length;
    const head = h('h1', { class: 'screen-title', text: 'Writing', tabindex: '-1' });
    if (!letters.length) {
      page.replaceChildren(head, h('div', { class: 'state-empty' },
        h('p', { text: 'Meet a letter in a lesson first. Then you can practise writing it here.' }),
        h('a', { class: 'btn btn-secondary', href: '#/letters' }, 'Go to Letters')));
      return;
    }
    const go = h('button', { type: 'button', class: 'btn btn-main ww-go', text: 'Practise now' });
    go.addEventListener('click', () => session(prog.pickSession(ids, SESSION, Date.now())));
    const intro = h('p', { class: 'ww-intro', text: dueN
      ? `${dueN} to practise now. Each letter climbs five steps: watch, trace, fade, copy, then write it from memory.`
      : 'Nothing is due. Practise any letter, or come back later.' });
    const cell = id => {
      const it = describe(id, L, S);
      if (!it) return null;
      const r = items[id] ? prog.getItem(id) : null;
      const stage = r ? r.stage : (it.syllable ? 3 : 0);
      const due = r && r.stage >= 4 && prog.isDue(r, now);
      const a = h('a', { class: 'ww-cell', href: '#/write/' + encodeURIComponent(id), 'data-write-cell': '', 'data-item': id,
        'data-stage': String(stage), 'data-due': String(!!due),
        'aria-label': `${it.rom}: ${stage >= 4 ? 'writing from memory' : `next step ${STAGE_NAMES[stage]}`}${due ? ', due' : ''}` },
      teNode(it.display, { class: 'ww-glyph' }), h('span', { class: 'ww-rom', text: it.rom }), stageDots(stage, it.syllable),
      due ? h('span', { class: 'ww-due', text: 'Due' }) : null);
      return a;
    };
    const blocks = [h('section', { class: 'ww-group' }, h('h2', { class: 'ww-h2', text: 'Letters you have met' }),
      h('div', { class: 'ww-grid' }, letters.map(cell).filter(Boolean)))];
    if (syllables.length) {
      blocks.push(h('section', { class: 'ww-group' }, h('h2', { class: 'ww-h2', text: 'Syllables' }),
        h('p', { class: 'ww-note', text: 'A consonant with a vowel sign, once you can write both from memory.' }),
        h('div', { class: 'ww-grid' }, syllables.map(cell).filter(Boolean))));
    }
    page.replaceChildren(head, intro, h('div', { class: 'ww-actions' }, go), ...blocks);
  }

  // ---- a practice run ----
  function session(list) {
    stop();
    let at = 0, passed = 0, skipped = 0;
    const box = h('div', { class: 'ww-session', 'data-session': '', 'data-total': String(list.length) });
    const count = h('p', { class: 'ww-count' });
    const bar = h('div', { class: 'ww-bar', role: 'progressbar', 'aria-label': 'Practice', 'aria-valuemin': '0', 'aria-valuemax': String(list.length) },
      h('span', { class: 'ww-bar-fill' }));
    const quit = h('button', { type: 'button', class: 'btn btn-quiet ww-quit', text: 'End practice' });
    quit.addEventListener('click', () => grid());
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
      const item = describe(list[at], L, S);
      if (!item) { at += 1; nextItem(); return; }
      const r = prog.getItem(item.id);
      const from = Math.max(item.syllable ? 3 : 0, r.stage);
      const to = from >= 4 ? 4 : Math.min(4, from + 1);
      current = mountLadder(slot, item, {
        strokes: S, rivals: rivalsFor(item, L), from, to,
        lastLabel: at + 1 < list.length ? 'Next letter' : 'Finish',
        onStage: (_, outcome) => { if (outcome === 'pass') passed += 1; else if (outcome === 'skip') skipped += 1; },
        onFinish: () => { at += 1; nextItem(); },
      });
    };
    const done = () => {
      bar.firstChild.style.width = '100%';
      const msg = h('div', { class: 'ww-done', tabindex: '-1' },
        h('h2', { class: 'ww-h2', text: 'Practice done' }),
        h('p', { text: `${passed} step${passed === 1 ? '' : 's'} passed${skipped ? `, ${skipped} skipped` : ''}.` }),
        h('a', { class: 'btn btn-main', href: '#/write', text: 'Back to writing' }));
      msg.querySelector('a').addEventListener('click', e => { e.preventDefault(); grid(); });
      slot.replaceChildren(msg);
      count.textContent = 'Done';
      try { msg.focus({ preventScroll: true }); } catch { /* ignore */ }
    };
    nextItem();
  }
}
