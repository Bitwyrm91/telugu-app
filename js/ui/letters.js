// ui/letters.js: the Letters screen, #/letters (task E11; SPECS S10 "Letters screen", "Unlocking";
// DESIGN 7 "Letter grid cell", "Letter card").
//
//   render(el, route) -> cleanup
//   lessonHeading(id) -> "Unit N · Letters k" (from uNN.ak; null for another shape)
//
// Grid: every letter of letters.json, in teaching order (letter lessons in order, each lesson's
// letters in order; letters in no lesson last, under "More letters"). A letter not in `taught`
// (progress.letters[id].seen; all letters with settings.reads) is greyed but still plays. Tapping
// a cell plays the letter and opens its letter card under that group. Below: every letter lesson
// with its state (done / open / locked; states from home.pathModel), open and done ones link to
// #/letters/<lessonId>. Telugu goes in only through teNode; signs sit on their carrier.

import * as store from '../store.js';
import * as content from '../content.js';
import * as audio from '../audio.js';
import { teNode } from './te.js';
import { pathModel } from './home.js';
import { h, icon, ensureStyles, makeCtx, audioMsg, playWithMsg } from '../ex/common.js';
import { letterCard, shownGlyph, letterStyles } from '../ex/letter.js';

export function lessonHeading(id) {
  const m = /^u(\d+)\.a(\d+)$/.exec(String(id));
  return m ? `Unit ${Number(m[1])} · Letters ${Number(m[2])}` : null;
}

const STATE_TEXT = { done: 'Done', open: 'Open', locked: 'Locked' };

export async function render(el) {
  ensureStyles();
  letterStyles();
  let letters;
  try {
    letters = await content.loadLetters();
  } catch {
    letters = null;
  }
  const page = h('section', { class: 'letters' }, h('h1', { class: 'screen-title', text: 'Letters' }));
  if (!letters || !Array.isArray(letters.letters) || !letters.letters.length) {
    page.append(h('div', { class: 'state-empty' }, h('p', { text: 'The letters are not in the app yet.' })));
    el.replaceChildren(page);
    return () => {};
  }

  const settings = store.get('settings') || {};
  const progress = store.get('progress') || {};
  const all = letters.letters;
  const byId = new Map(all.map(l => [l.id, l]));
  const cx = makeCtx({ settings, carrier: letters.carrier });
  const taught = settings.reads ? new Set(all.map(l => l.id)) : cx.taught;
  let lessons = letters.lessons || [];
  if (!Array.isArray(lessons)) lessons = Object.entries(lessons).map(([id, v]) => ({ id, ...v }));

  // groups in teaching order
  const placed = new Set();
  const groups = [];
  for (const ls of lessons) {
    const ls2 = (ls.letters || []).map(id => byId.get(id)).filter(l => l && !placed.has(l.id));
    ls2.forEach(l => placed.add(l.id));
    if (ls2.length) groups.push({ id: ls.id, heading: lessonHeading(ls.id) || String(ls.id), letters: ls2 });
  }
  // design 1 #7c / design 2 #11: the letter lesson that teaches each letter ("Unit 4, Letters 1")
  const teachIn = new Map();
  for (const ls of lessons) {
    const m = /\.a(\d+)$/.exec(String(ls.id || ''));
    const u = /^u(\d+)/.exec(String(ls.unit || ls.id || ''));
    const name = m && (u ? `Unit ${Number(u[1])}, Letters ${Number(m[1])}` : `Letters ${Number(m[1])}`);
    for (const id of ls.letters || []) if (name && !teachIn.has(id)) teachIn.set(id, name);
  }
  const rest = all.filter(l => !placed.has(l.id));
  if (rest.length) groups.push({ id: 'more', heading: 'More letters', letters: rest });

  let openCell = null;
  const gridBox = h('div', { class: 'lg-groups' });
  for (const g of groups) {
    const slot = h('div', { class: 'lg-card-slot', 'aria-live': 'polite' });
    const msg = audioMsg(); // Q3c S2: a cell's clip that won't play says so, under the grid
    const cells = g.letters.map(l => {
      const on = taught.has(l.id);
      const b = h('button', { type: 'button', class: 'lg-cell', 'data-letter': l.id, 'data-taught': String(on),
        'aria-expanded': 'false', 'aria-label': `${l.rom || l.id}${on ? '' : ', not taught yet'}` },
        teNode(shownGlyph(l), { class: 'te-xl' }),
        h('span', { class: 'lg-rom', text: l.rom || '' }));
      b.addEventListener('click', () => {
        playWithMsg(l, cx, msg);
        if (openCell === b) {
          b.setAttribute('aria-expanded', 'false');
          slot.replaceChildren();
          openCell = null;
          return;
        }
        if (openCell) {
          openCell.setAttribute('aria-expanded', 'false');
          const old = openCell.closest('.lg-group').querySelector('.lg-card-slot');
          if (old) old.replaceChildren();
        }
        openCell = b;
        b.setAttribute('aria-expanded', 'true');
        // design 1 #7c: a letter not taught yet says where it is taught, above its card
        const where = teachIn.get(l.id);
        const note = on ? null : h('p', { class: 'lg-locked-note',
          text: where ? `You will learn this letter in ${where}.` : 'You will learn this letter later.' });
        // design 3 #11: the open card has its own close button and comes into view
        const close = h('button', { type: 'button', class: 'lg-card-close', 'aria-label': 'Close' }, icon('cross'));
        close.addEventListener('click', () => {
          b.setAttribute('aria-expanded', 'false');
          slot.replaceChildren();
          openCell = null;
          try { b.focus({ preventScroll: true }); } catch { /* ignore */ }
        });
        const wrap = h('div', { class: 'lg-card-wrap' }, ...[note, letterCard(l, cx), close].filter(Boolean));
        slot.replaceChildren(wrap);
        try { wrap.scrollIntoView({ block: 'nearest', behavior: 'instant' }); } catch { /* ignore */ }
      });
      return b;
    });
    gridBox.append(h('section', { class: 'lg-group', 'data-group': g.id },
      h('h2', { class: 'lg-heading', text: g.heading }),
      h('div', { class: 'lg-grid' }, cells),
      msg, slot));
  }

  const model = pathModel(null, { ...letters, lessons }, progress, settings);
  const rows = model.letterLessons.map(x => {
    const name = lessonHeading(x.id) || x.id;
    const kids = [h('span', { class: 'll-name', text: name }), h('span', { class: 'll-state', text: STATE_TEXT[x.state] || '' })];
    const row = x.state === 'locked'
      ? h('div', { class: 'll-row', 'data-lesson': x.id, 'data-state': x.state, 'aria-disabled': 'true' }, kids)
      : h('a', { class: 'll-row', 'data-lesson': x.id, 'data-state': x.state, href: x.href }, kids);
    return h('li', {}, row);
  });
  // design 1 #7d: done and open lessons, the next 2 locked ones, then "Show all" (in place)
  const list = h('ul', { class: 'll-list' }, rows);
  let shownLocked = 0, more = null;
  const hiddenRows = [];
  model.letterLessons.forEach((x, i) => {
    if (x.state !== 'locked') return;
    if (shownLocked < 2) { shownLocked += 1; return; }
    rows[i].hidden = true;
    hiddenRows.push(rows[i]);
  });
  if (hiddenRows.length) {
    more = h('button', { type: 'button', class: 'btn btn-quiet ll-more', 'aria-expanded': 'false', text: 'Show all' });
    more.addEventListener('click', () => {
      hiddenRows.forEach(r => { r.hidden = false; });
      more.remove();
      const first = hiddenRows[0].querySelector('.ll-row');
      if (first) { first.setAttribute('tabindex', '-1'); try { first.focus({ preventScroll: true }); } catch { /* ignore */ } }
    });
  }

  page.append(gridBox,
    h('section', { class: 'll' }, h('h2', { class: 'lg-heading', text: 'Letter lessons' }), list, more));
  el.replaceChildren(page);
  return () => { audio.stop(); };
}
