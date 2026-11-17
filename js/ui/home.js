// ui/home.js: the home path (task E8; SPECS S10 "Unlocking", S3 `progress`; DESIGN 7 "Path node").
//
//   render(el, route) -> nothing
//   pathModel(index, letters, progress, settings) -> {units, letterLessons, next}   (pure; tests use it)
//
// Units in index order, each a header card then its word lessons as path nodes. Letter lessons are
// side nodes: a1 after lesson 1 of its unit, a2 after lesson 3, a3 (and any later) after lesson 4,
// or after the unit's last lesson when it has fewer. With settings.reads they are not on the path.
// States come only from the store's `progress` (kept across reloads by store.js):
//   word lesson: done if progress.lessons[id].done; else open if its unit is open and it is the
//     unit's first lesson or the lesson before it is done; else locked.
//   unit: the first is open; unit N+1 opens when every lesson of unit N listed in index.json is done.
//   letter lesson: own sequence across the course (letters.json order); the first is open, each later
//     one opens when the one before it is done; never blocked by word lessons, never blocks them.
// Telugu (the side node glyph) goes in only through teNode.

import * as store from '../store.js';
import * as content from '../content.js';
import { teNode } from './te.js';
import { h } from '../ex/common.js';
import { localDate } from '../session.js';

// ---- styles ---------------------------------------------------------------------------------

let styled = false;
function homeStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/home.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

// ---- icons ----------------------------------------------------------------------------------

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  tick: `<path d="M5 12.5l4.5 4.5L19 7.5" ${S}/>`,
  play: `<path d="M8 5.5v13l10.5-6.5z" ${S}/>`,
  lock: `<rect x="5" y="11" width="14" height="9.5" rx="2" ${S}/><path d="M8 11V8a4 4 0 0 1 8 0v3" ${S}/>`,
  flame: `<path d="M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.6 3-5.6 3.8-9 2.2 1.3 3.2 3.4 3.2 5.2 1-.6 1.6-1.6 1.8-2.8 1.7 1.5 4.2 3.8 4.2 6.6 0 3.4-2.6 6-6.5 6z" ${S}/>`,
  book: `<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" ${S}/><path d="M12 6v13" ${S}/>`,
};
function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name];
  return s;
}

function muggu(cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 120 120');
  s.setAttribute('class', `muggu ${cls}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  let dots = '';
  for (let y = 30; y <= 90; y += 30) for (let x = 30; x <= 90; x += 30) dots += `<circle cx="${x}" cy="${y}" r="2.5" class="muggu-dot"/>`;
  s.innerHTML = '<path class="muggu-line" d="M15 60 C15 25 35 15 60 15 C85 15 105 25 105 60 C105 95 85 105 60 105 C35 105 15 95 15 60 Z'
    + ' M45 45 C55 33 65 33 75 45 C87 55 87 65 75 75 C65 87 55 87 45 75 C33 65 33 55 45 45 Z"/>' + dots;
  return s;
}

// ---- the model (pure) -------------------------------------------------------------------------

const SIDE_AFTER = [0, 2, 3]; // a1 after lesson 1, a2 after lesson 3, a3 after lesson 4 (0-based)

function unitNumber(id) {
  const m = /^u(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
}

function letterNumber(id) {
  const m = /\.a(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
}

function unitOfLetterLesson(l) {
  return l.unit || String(l.id).split('.')[0];
}

// The glyph a side node shows: the lesson's first letter; a sign or mark sits on its carrier (`say`).
function sideGlyph(lesson, letters) {
  const first = (lesson.letters || [])[0];
  const l = (letters && letters.letters || []).find(x => x.id === first);
  if (!l) return null;
  return (l.type === 'sign' || l.type === 'mark') ? (l.say || null) : (l.glyph || l.say || null);
}

export function pathModel(index, letters, progress, settings = {}) {
  const done = id => !!(progress && progress.lessons && progress.lessons[id] && progress.lessons[id].done);
  const best = id => (progress && progress.lessons && progress.lessons[id] && progress.lessons[id].best) || 0;

  // Letter lessons: one sequence across the course.
  let lls = letters && letters.lessons;
  if (lls && !Array.isArray(lls)) lls = Object.entries(lls).map(([id, v]) => ({ id, ...v }));
  const letterLessons = [];
  let prevDone = true;
  for (const l of lls || []) {
    const state = done(l.id) ? 'done' : (settings.reads || prevDone ? 'open' : 'locked');
    letterLessons.push({
      kind: 'letters', id: l.id, unit: unitOfLetterLesson(l), n: letterNumber(l.id),
      state, best: best(l.id), glyph: sideGlyph(l, letters),
      href: '#/letters/' + encodeURIComponent(l.id),
    });
    prevDone = done(l.id);
  }

  const units = [];
  let unitOpen = true;
  for (const u of (index && index.units) || []) {
    const lessons = (u.lessons || []).map(l => (typeof l === 'string' ? { id: l, title: l } : l));
    const nodes = [];
    let before = true;
    lessons.forEach((l, i) => {
      const state = done(l.id) ? 'done' : (unitOpen && before ? 'open' : 'locked');
      nodes.push({ kind: 'lesson', id: l.id, title: l.title, state, best: best(l.id), href: '#/lesson/' + encodeURIComponent(l.id) });
      before = done(l.id);
    });
    // Side nodes, placed after their word lesson (display only).
    if (!settings.reads && lessons.length) {
      const mine = letterLessons.filter(x => x.unit === u.id);
      const placed = new Map(); // lesson index -> side nodes after it
      for (const x of mine) {
        const k = x.n ? x.n - 1 : 0;
        const after = Math.min(SIDE_AFTER[Math.min(k, SIDE_AFTER.length - 1)], lessons.length - 1);
        if (!placed.has(after)) placed.set(after, []);
        placed.get(after).push(x);
      }
      for (let i = lessons.length - 1; i >= 0; i--) {
        if (placed.has(i)) nodes.splice(nodes.findIndex(n => n.id === lessons[i].id) + 1, 0, ...placed.get(i));
      }
    }
    const doneCount = lessons.filter(l => done(l.id)).length;
    units.push({
      id: u.id, n: unitNumber(u.id), title: u.title, open: unitOpen,
      done: doneCount, total: lessons.length, nodes,
    });
    unitOpen = unitOpen && doneCount === lessons.length;
  }

  // "Next up": the first open word lesson, else the first open letter lesson on the path.
  const all = units.flatMap(u => u.nodes);
  const next = all.find(n => n.kind === 'lesson' && n.state === 'open') || all.find(n => n.state === 'open') || null;
  return { units, letterLessons, next };
}

// ---- drawing ----------------------------------------------------------------------------------

const STATE_WORD = { done: 'Done', open: 'Open', locked: 'Locked' };
// design 2 #2: a straight path; the Start bubble sits in the label column
function lessonNode(n, isNext) {
  const label = h('span', { class: 'node-label' },
    isNext ? h('span', { class: 'node-bubble', 'aria-hidden': 'true', text: 'Start' }) : null,
    h('span', { class: 'node-title', text: n.title }),
    h('span', { class: 'node-state', text: n.state === 'done' && n.best >= 1 ? 'Done · perfect' : STATE_WORD[n.state] }));
  const circle = h('span', { class: 'node-circle' }, icon(n.state === 'done' ? 'tick' : n.state === 'open' ? 'play' : 'lock'));
  const attrs = {
    class: 'path-node', 'data-id': n.id, 'data-kind': 'lesson', 'data-state': n.state,
    'data-perfect': n.state === 'done' && n.best >= 1 ? 'true' : null,
    'aria-label': `${n.title}, ${STATE_WORD[n.state].toLowerCase()}`,
  };
  const node = n.state === 'locked'
    ? h('span', { ...attrs, role: 'link', 'aria-disabled': 'true' }, circle, label)
    : h('a', { ...attrs, href: n.href }, circle, label);
  const row = h('li', { class: 'path-row' }, node);
  if (isNext) row.classList.add('is-next');
  return row;
}

function sideNode(n, isNext) {
  const name = `Letters ${n.n || ''}`.trim();
  const square = h('span', { class: 'side-square', 'data-card': '' });
  if (n.glyph) square.append(teNode(n.glyph, { class: 'side-glyph' }));
  if (n.state !== 'open') square.append(h('span', { class: 'side-badge' }, icon(n.state === 'done' ? 'tick' : 'lock')));
  const label = h('span', { class: 'node-label side-label' },
    isNext ? h('span', { class: 'node-bubble', 'aria-hidden': 'true', text: 'Start' }) : null,
    h('span', { class: 'node-title', text: name }),
    h('span', { class: 'node-state', text: STATE_WORD[n.state] }));
  const attrs = {
    class: 'side-node', 'data-id': n.id, 'data-kind': 'letters', 'data-state': n.state,
    'aria-label': `${name}, ${STATE_WORD[n.state].toLowerCase()}`,
  };
  const node = n.state === 'locked'
    ? h('span', { ...attrs, role: 'link', 'aria-disabled': 'true' }, square, label)
    : h('a', { ...attrs, href: n.href }, square, label);
  const row = h('li', { class: 'path-row path-side' }, h('span', { class: 'side-link', 'aria-hidden': 'true' }), node);
  if (isNext) row.classList.add('is-next');
  return row;
}

function unitHeader(u) {
  const title = `Unit ${u.n ?? ''}`.trim();
  return h('div', { class: 'unit-card', 'data-unit': u.id, 'data-open': String(u.open) },
    muggu('unit-muggu'),
    h('div', { class: 'unit-text' },
      h('h2', { class: 'unit-kicker', text: title }),
      h('p', { class: 'unit-title', text: u.title || '' }),
      h('p', { class: 'unit-progress' },
        u.open ? null : icon('lock', 'unit-lock'),
        h('span', { text: u.open ? `${u.done} of ${u.total} lessons done` : `Locked · ${u.done} of ${u.total} lessons done` }))),
    h('a', { class: 'btn btn-quiet unit-notes', href: '#/notes/' + encodeURIComponent(u.id) }, icon('book'), 'Notes'));
}

// Days in a row up to today (the lesson summary's count, from streak.days).
function streakRun() {
  const days = new Set(((store.get('streak') || {}).days) || []);
  let run = 0;
  for (const d = new Date(); days.has(localDate(d)); d.setDate(d.getDate() - 1)) run += 1;
  return run;
}
const streakText = run => `${run} day streak`;
const nextName = next => (next.kind === 'letters' ? `Letters ${next.n || ''}`.trim() : next.title);
// design 1 #9: nothing next: the last finished unit
function doneText(units) {
  const u = [...units].reverse().find(x => x.total && x.done >= x.total) || units[units.length - 1];
  return `Unit ${(u && u.n) ?? ''} complete`.replace('  ', ' ');
}

// design 1 #9: the panel is always there from 1100 px, so the path column never moves.
function sidePanel(side, next, units, run) {
  if (!side) return;
  const streak = h('p', { class: 'home-streak' }, icon('flame', 'home-flame'), h('span', { text: streakText(run) }));
  side.append(next
    ? h('section', { class: 'home-next' },
      h('h2', { class: 'home-next-title', text: 'Next up' }),
      h('p', { class: 'home-next-name', text: nextName(next) }),
      h('a', { class: 'btn btn-main home-next-go', href: next.href }, 'Start'), streak)
    : h('section', { class: 'home-next home-done' },
      h('h2', { class: 'home-next-name', text: doneText(units) }), streak));
  side.hidden = false;
}

// design 1 #8: under 1100 px, one line under the title: streak at left, next lesson at right.
function homeStrip(next, units, run) {
  return h('div', { class: 'home-strip' },
    h('span', { class: 'home-strip-streak' }, icon('flame', 'home-flame'), h('span', { text: streakText(run) })),
    h('span', { class: 'home-strip-next', text: next ? `Next: ${nextName(next)}` : doneText(units) }));
}

export async function render(el) {
  homeStyles();
  const [index, letters] = await Promise.all([
    content.loadIndex(),
    content.loadLetters().catch(() => null), // no letters file: the path simply has no letter nodes
  ]);
  const settings = store.get('settings') || {};
  const model = pathModel(index, letters, store.get('progress'), settings);

  const header = h('header', { class: 'home-head' },
    h('h1', { class: 'screen-title', text: 'Learn' }), muggu('home-muggu'));

  if (!model.units.length) {
    el.append(header, h('section', { class: 'state-empty' },
      h('p', { text: 'No lessons are here yet.' }),
      h('a', { class: 'btn btn-secondary', href: '#/letters' }, 'Go to Letters')));
    return;
  }

  const path = h('div', { class: 'home-path', 'data-reads': String(!!settings.reads) });
  for (const u of model.units) {
    const list = h('ol', { class: 'path-list', 'aria-label': `Unit ${u.n ?? ''} lessons`.replace('  ', ' ') });
    // design 2 #2: which part of the line each row carries (first main node to last main node)
    const mains = u.nodes.map((n, k) => (n.kind === 'lesson' ? k : -1)).filter(k => k >= 0);
    const first = mains[0], last = mains[mains.length - 1];
    u.nodes.forEach((n, k) => {
      const isNext = model.next === n;
      const row = n.kind === 'lesson' ? lessonNode(n, isNext) : sideNode(n, isNext);
      row.dataset.seg = first === undefined || first === last || k < first || k > last ? 'none'
        : k === first ? 'first' : k === last ? 'last' : 'mid';
      list.append(row);
    });
    const section = h('section', { class: 'path-unit', 'data-unit': u.id }, unitHeader(u), list);
    // design 2 #16: a finished unit ends in a closing card, not empty space
    if (u.total && u.done >= u.total) {
      const firstLesson = u.nodes.find(n => n.kind === 'lesson');
      const later = model.units.indexOf(u) < model.units.length - 1;
      section.append(h('div', { class: 'card unit-end', 'data-unit': u.id },
        h('h2', { class: 'unit-end-title', text: `Unit ${u.n ?? ''} complete`.replace('  ', ' ') }),
        later ? null : h('p', { class: 'unit-end-note', text: 'More units are coming.' }),
        h('a', { class: 'btn btn-secondary unit-end-again', href: firstLesson.href }, 'Practise again')));
    }
    path.append(section);
  }
  // Game: a "Play" card at the end of the path (#/game).
  path.append(h('a', { class: 'home-play', href: '#/game', 'data-game': '' },
    h('span', { class: 'home-play-icon' }, icon('play')),
    h('span', { class: 'home-play-text' },
      h('span', { class: 'home-play-title', text: 'Play' }),
      h('span', { class: 'home-play-note', text: 'Sky Shield: shoot down falling letters and words' }))));
  const run = streakRun();
  el.append(header, homeStrip(model.next, model.units, run), path);
  sidePanel(document.getElementById('side'), model.next, model.units, run);
}
