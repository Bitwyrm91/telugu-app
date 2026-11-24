// ui/lesson.js: the lesson screen (task E7; SPECS S10 "Session", "Feedback sheet", "Report button";
// DESIGN 5 "Inside a lesson", DESIGN 7 "Feedback sheet", "Report sheet", "Summary screen").
// Routes: #/lesson/<lessonId> (word lesson) and #/letters/<lessonId> (letter lesson).
//
//   render(el, route) -> cleanup
// Exercises come from exgen and are drawn by ex/index.js with ctx.verdict = false; this screen
// grades them (grade.check), shows its own feedback sheet with "Continue", and keeps the run in
// session.js terms (results, re-queue, resume, summary). Telugu goes in only through teNode.
// For tests, `el.__lesson` exposes {exercises, queue(), pos(), current()} (read only).

import * as store from '../store.js';
import * as content from '../content.js';
import * as exgen from '../exgen.js';
import * as grade from '../grade.js';
import * as ex from '../ex/index.js';
import * as audio from '../audio.js';
import * as router from '../router.js';
import * as session from '../session.js';
import * as report from '../report.js';
import { split } from '../aksharas.js';
import { teNode } from './te.js';
import { pathModel } from './home.js';
import {
  h, ensureStyles, makeCtx, romMode, audioButtons, confidenceLabel, infoRow, icon, hasTelugu, teWords,
} from '../ex/common.js';

// ---- styles ---------------------------------------------------------------------------------

let styled = false;
function lessonStyles() {
  ensureStyles();
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/lesson.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

// ---- icons this screen needs beyond ex/common.js ----------------------------------------------

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const MORE = {
  close: `<path d="M6 6l12 12M18 6L6 18" ${S}/>`,
  flag: `<path d="M5 21V4M5 4h11l-2 4 2 4H5" ${S}/>`,
  star: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" ${S}/>`,
  flame: `<path d="M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.6 3-5.6 3.8-9 2.2 1.3 3.2 3.4 3.2 5.2 1-.6 1.6-1.6 1.8-2.8 1.7 1.5 4.2 3.8 4.2 6.6 0 3.4-2.6 6-6.5 6z" ${S}/>`,
  clock: `<circle cx="12" cy="12" r="9" ${S}/><path d="M12 7v5l3 2" ${S}/>`,
};
function icon2(name, cls = '') {
  if (!MORE[name]) return icon(name, cls);
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = MORE[name];
  return s;
}

// ---- small helpers ----------------------------------------------------------------------------

const UNGRADED = new Set(['intro', 'letter_intro', 'letter_draw']);
const DONE_KEY = 'telugu.summary-shown';
let firstRender = true;
function pageWasReloaded() {
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) return nav.type === 'reload';
    return performance.navigation && performance.navigation.type === 1;
  } catch { return false; }
}
const LISTEN = new Set(['listen_choice', 'listen_bank', 'listen_type', 'letter_sound', 'letter_build']);
const SPACE_OR_PUNCT = /^[\s.,?!\-‌]*$/;
const VOWEL_ROM = /[aāiīuūeēoōṛṝḷ]/;
const SIGN = /[ా-ౌౕౖౢౣ]/;

function noteText(note) {
  if (!note) return '';
  if (typeof note === 'string') return note;
  if (Array.isArray(note)) return note.map(b => (b.spans || []).map(s => s.s ?? s.b ?? s.i ?? '').join('')).join(' ');
  return String(note.text ?? '');
}

function fmtSecs(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** te -> rom for every unit, syllable and letter the compiled content names (rom is never made up). */
function romIndex(units, letters) {
  const map = new Map();
  const put = (te, rom) => { if (te && rom && !map.has(te.normalize('NFC'))) map.set(te.normalize('NFC'), rom); };
  const walkW = list => { for (const w of list || []) put(w.te, w.rom); };
  for (const u of units) {
    for (const it of u.items || []) {
      walkW(it.units);
      walkW(it.tokens);
      put(it.te, it.rom);
      for (const a of it.alts || []) { walkW(a.units); put(a.te, a.rom); }
    }
  }
  if (letters) {
    for (const l of letters.letters || []) {
      if (l.type === 'consonant' || l.type === 'vowel' || l.type === 'cluster') put(l.glyph, l.rom);
      put(l.say, l.rom);
      if (l.example) { walkW(l.example.units); put(l.example.te, l.example.rom); }
    }
    for (const byC of Object.values(letters.built || {})) for (const b of Object.values(byC || {})) put(b.te, b.rom);
    for (const ls of letters.lessons || []) for (const s of ls.syllables || []) put(s.te, s.rom);
  }
  return map;
}

// S2 step 5 pieces of one unit (consonants, vowel, mark, tail), for the per-part lines.
function vowelOf(unit) {
  const s = Array.from(String(unit).split('‌').join(''));
  let i = 0;
  const isC = ch => { const o = ch.codePointAt(0); return (o >= 0x0C15 && o <= 0x0C39) || (o >= 0x0C58 && o <= 0x0C5A) || o === 0x0C5D; };
  if (s.length && isC(s[0])) {
    i = 1;
    while (i + 1 < s.length && s[i] === '్' && isC(s[i + 1])) i += 2;
    return i < s.length && SIGN.test(s[i]) ? s[i] : '';
  }
  return s[0] || '';
}

// The vowel part of a unit's romanization: drop the shared consonant start.
function vowelRoms(expRom, gotRom) {
  if (!expRom || !gotRom) return [null, null];
  let n = 0;
  while (n < expRom.length && n < gotRom.length && expRom[n] === gotRom[n]) n++;
  while (n > 0 && VOWEL_ROM.test(expRom[n - 1])) n--;
  return [expRom.slice(n), gotRom.slice(n)];
}

// ---- the screen -------------------------------------------------------------------------------

export async function render(el, route) {
  lessonStyles();
  const lessonId = route.params.lessonId;
  const isLetters = route.name === 'letterLesson';
  const settings = store.get('settings');
  const cleanups = [];
  const cleanup = () => { for (const f of cleanups.splice(0)) { try { f(); } catch { /* gone */ } } };
  // Q3c minor 6: this lesson's summary was on screen when the page was reloaded: go home.
  // Only a reload of the page counts: a new visit to the address in the same tab (typed, a link,
  // a bookmark) opens the lesson as usual, and so does any later render in this page.
  let doneHere = null;
  try { doneHere = sessionStorage.getItem(DONE_KEY); sessionStorage.removeItem(DONE_KEY); } catch { /* storage blocked */ }
  const reloaded = firstRender && pageWasReloaded();
  firstRender = false;
  if (reloaded && doneHere && doneHere === location.hash) {
    location.replace(location.pathname + location.search + '#/');
    return cleanup;
  }

  // Content: the index, every unit (for `prior`, distractors and romanization), letters.
  let index, units, letters, unit = null, lesson = null;
  try {
    index = await content.loadIndex();
    units = await Promise.all((index.units || []).map(u => content.loadUnit(u.id).catch(() => null)));
    units = units.filter(Boolean);
    letters = await content.loadLetters().catch(() => null);
  } catch {
    el.replaceChildren(errorState('This lesson could not be loaded. Check your connection and try again.'));
    return cleanup;
  }
  if (isLetters) {
    lesson = letters && (letters.lessons || []).find(l => l.id === lessonId) || null;
  } else {
    for (const u of units) {
      const l = (u.lessons || []).find(x => x.id === lessonId);
      if (l) { unit = u; lesson = l; break; }
    }
  }
  if (!lesson) {
    el.replaceChildren(missingLesson());
    return cleanup;
  }
  // S6: a lesson the home path shows as locked can't be opened from its address: go home.
  if (lockedOnPath(index, letters, lessonId, isLetters, settings)) {
    location.replace(location.pathname + location.search + '#/');
    return cleanup;
  }

  const items = new Map();
  for (const u of units) for (const it of u.items || []) items.set(it.id, it);
  const letterById = new Map(((letters && letters.letters) || []).map(l => [l.id, l]));
  const ids = content.contentIds(units, letters);
  const roms = romIndex(units, letters);
  const pool = unit ? units.filter(u => u !== unit).flatMap(u => u.items || []) : [];

  // `speak` needs E9's module; without it, lessons are made without speaking.
  let canSpeak = false;
  if (!isLetters && settings.speak) {
    try { await import('../ex/speak.js'); canSpeak = true; } catch { canSpeak = false; }
  }

  // S16: stroke data for `letter_draw`; missing or unloadable = no draw steps, no message.
  let strokes = null;
  if (isLetters) {
    try {
      const s = await content.loadStrokes();
      strokes = s && s.letters && typeof s.letters === 'object' ? s : null;
    } catch { strokes = null; }
  }

  function generate(seed) {
    const cards = store.get('cards');
    if (isLetters) {
      return exgen.forLetters(lesson, session.knownIds(cards, ids),
        { seed, built: letters.built, letters: letters.letters, lessons: letters.lessons,
          strokes: strokes ? strokes.letters : null });
    }
    return exgen.forLesson(unit, lessonId, session.priorIds(cards, ids),
      { seed, speak: canSpeak, typing: settings.typing || 'tiles', pool });
  }

  // ---- run state ----
  let seed = 0;
  let exercises = [];
  let results = [];
  let queue = [];
  let pos = 0;
  let base = 0;        // seconds already spent before this sitting (resume)
  let t0 = Date.now();
  let ctrl = null;
  let finished = false;
  let lastAnswer;      // the answer given at this step (for a report)
  let keyOff = null;
  let mine = 0;

  const elapsed = () => base + (Date.now() - t0) / 1000;

  el.__lesson = {
    get exercises() { return exercises; },
    queue: () => queue.slice(),
    pos: () => pos,
    current: () => (pos < queue.length ? { k: queue[pos], exercise: exercises[queue[pos]] } : null),
    results: () => results.slice(),
  };

  // ---- layout: top bar, stage, sheet ----
  const fill = h('span', { class: 'lp-fill' });
  const stepText = h('span', { class: 'visually-hidden lp-text' });
  const closeBtn = h('button', { type: 'button', class: 'lesson-close icon-btn', 'aria-label': 'Leave lesson' }, icon2('close'));
  const flagBtn = h('button', { type: 'button', class: 'lesson-report icon-btn', 'aria-label': 'Report a problem' }, icon2('flag'));
  const top = h('header', { class: 'lesson-top' },
    closeBtn,
    h('div', { class: 'lesson-progress' }, h('span', { class: 'lp-track', 'aria-hidden': 'true' }, fill), stepText),
    flagBtn);
  const stage = h('div', { class: 'lesson-stage' });
  const sheetSlot = h('div', { class: 'lesson-sheet-slot' });
  const page = h('section', { class: 'lesson', 'data-lesson': lessonId, 'data-kind': isLetters ? 'letters' : 'lesson' },
    h('h1', { class: 'visually-hidden', text: lesson.title || (isLetters ? 'Letter lesson' : 'Lesson') }),
    top, stage, sheetSlot);

  closeBtn.addEventListener('click', () => router.go('#/'));
  flagBtn.addEventListener('click', () => openReport());

  // Q3h M1: a double click/tap on Continue must not also press the next card's Continue.
  // For a short while after a step renders, its Continue (and the Enter shortcut) is ignored.
  // Nothing changes visually; the button stays enabled.
  const GUARD_MS = 400;
  let guardUntil = 0;
  const guarded = () => performance.now() < guardUntil;
  stage.addEventListener('click', e => {
    if (!guarded() || !(e.target instanceof Element)) return;
    if (!e.target.closest('.ex-continue, .ex-skip-missing')) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  const guardKey = e => {
    if (e.key !== 'Enter' || !guarded() || document.querySelector('.rp-backdrop')) return;
    if (!stage.querySelector('.ex-continue, .ex-skip-missing')) return;
    // Enter on another control (the flag, a Play button) keeps its own job
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('button, input, textarea, select, a[href], [role="button"], [role="radio"]')
      && !t.closest('.ex-continue, .ex-skip-missing')) return;
    e.preventDefault(); e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', guardKey, true);
  cleanups.push(() => window.removeEventListener('keydown', guardKey, true));
  function armGuard() {
    guardUntil = performance.now() + GUARD_MS;
    stage.dataset.guardUntil = String(guardUntil);
  }

  // Q3d m6: once a step's report is sent, its report buttons show "sent" and cannot send again.
  const reported = new Set();
  const stepKey = () => `${pos}:${pos < queue.length ? queue[pos] : 'end'}`;
  function markReported() {
    const sent = reported.has(stepKey());
    // stays focusable (aria-disabled, not disabled): a sent report's dialog returns focus here
    if (sent) flagBtn.setAttribute('aria-disabled', 'true'); else flagBtn.removeAttribute('aria-disabled');
    flagBtn.toggleAttribute('data-sent', sent);
    flagBtn.setAttribute('aria-label', sent ? 'Problem reported' : 'Report a problem');
    for (const b of page.querySelectorAll('.fb-report')) {
      b.disabled = sent;
      b.toggleAttribute('data-sent', sent);
      const s = b.querySelector('span:last-child');
      if (s) s.textContent = sent ? 'Reported' : 'Report';
    }
  }

  router.setGuard(next => {
    if (finished || !results.length || leaving) return true;
    confirmLeave(next);
    return false;
  });
  cleanups.push(() => router.setGuard(null));
  cleanups.push(() => { if (ctrl && ctrl.destroy) ctrl.destroy(); ctrl = null; });
  cleanups.push(() => { if (keyOff) keyOff(); keyOff = null; });
  cleanups.push(() => audio.stop());
  cleanups.push(() => { delete el.__lesson; });
  let leaving = false;

  function updateProgress() {
    const n = queue.length || 1;
    const step = Math.min(pos + 1, queue.length);
    fill.style.width = `${Math.round((pos / n) * 100)}%`;
    stepText.textContent = `${step} of ${queue.length}`;
    page.dataset.step = String(step);
    page.dataset.steps = String(queue.length);
  }

  // ---- start / resume ----
  function begin(s, res = []) {
    seed = s;
    exercises = generate(seed);
    results = res.slice();
    queue = session.queueOf(exercises, results);
    pos = results.length;
    base = results.length ? Number(results[results.length - 1].t) || 0 : 0;
    t0 = Date.now();
    finished = false;
    el.replaceChildren(page);
    showStep();
  }

  function newSeed() { return Math.floor(Math.random() * 2147483647); }

  // (b) a resume made with other typing / speaking settings is dropped: its exercises would differ.
  const runOpts = { typing: settings.typing, speak: settings.speak };
  const saved = session.loadResume(lessonId, runOpts);
  const valid = saved && saved.results.every(r => r && Number.isInteger(r.k) && r.k >= 0)
    && (() => { try { const list = generate(saved.seed); return saved.results.every(r => r.k < list.length); } catch { return false; } })();
  if (valid && saved.results.length) {
    // design 2 #5: the lesson's own top row (close) and a progress bar, then the card
    const rClose = h('button', { type: 'button', class: 'lesson-close icon-btn resume-close', 'aria-label': 'Leave lesson' }, icon2('close'));
    rClose.addEventListener('click', () => router.go('#/'));
    const rFill = h('span', { class: 'lp-fill' });
    const box = h('section', { class: 'lesson-resume', 'data-card': '' },
      h('h1', { class: 'screen-title', text: lesson.title || (isLetters ? 'Letters' : 'Lesson') }),
      h('p', { text: 'You were partway through this lesson.' }));
    // design 1 #12: how far the saved run got ("4 of 11 done")
    try {
      const total = session.queueOf(generate(saved.seed), saved.results).length;
      const done = Math.min(saved.results.length, total);
      if (total) {
        rFill.style.width = `${Math.round((done / total) * 100)}%`;
        box.append(h('div', { class: 'resume-bar' },
          h('span', { class: 'lp-track resume-track', role: 'progressbar', 'aria-label': 'Lesson progress',
            'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) }, rFill),
          h('p', { class: 'resume-progress', text: `${done} of ${total} done` })));
      }
    } catch { /* no fraction */ }
    const cont = h('button', { type: 'button', class: 'btn btn-main resume-continue', text: 'Continue' });
    const over = h('button', { type: 'button', class: 'btn btn-secondary resume-over', text: 'Start over' });
    cont.addEventListener('click', () => begin(saved.seed, saved.results));
    over.addEventListener('click', () => { session.clearResume(); begin(newSeed()); });
    box.append(h('div', { class: 'lesson-resume-actions' }, cont, over));
    el.replaceChildren(h('div', { class: 'lesson-resume-page' }, h('header', { class: 'lesson-top resume-top' }, rClose), box));
    try { cont.focus({ preventScroll: true }); } catch { /* ignore */ }
  } else if (valid) {
    begin(saved.seed); // a run saved before its first answer: nothing to offer, same exercises
  } else {
    if (saved) session.clearResume();
    // Q3b minor 2: a resume dropped because typing / speaking changed says so in one line.
    const raw = store.get('resume');
    const dropped = !saved && raw && raw.lessonId === lessonId && Array.isArray(raw.results) && raw.results.length > 0;
    if (dropped) session.clearResume();
    begin(newSeed());
    if (dropped) {
      stage.before(h('p', { class: 'lesson-notice', role: 'status', text: 'Settings changed, so this lesson starts again.' }));
    }
  }

  // ---- one step ----
  async function showStep() {
    const ticket = ++mine;
    if (ctrl && ctrl.destroy) ctrl.destroy();
    ctrl = null;
    if (keyOff) { keyOff(); keyOff = null; }
    sheetSlot.replaceChildren();
    markReported();
    stage.removeAttribute('data-answered');
    stage.removeAttribute('data-ready');
    stage.style.paddingBottom = '';
    lastAnswer = undefined;
    audio.stop();
    updateProgress();
    if (pos >= queue.length) { summary(); return; }
    const k = queue[pos];
    const exercise = exercises[k];
    page.dataset.type = exercise.type;
    page.dataset.k = String(k);
    const ctx = { item: id => items.get(id) || null, settings, verdict: false,
      letters: letters ? letters.letters : [], built: letters ? letters.built : {}, letter: id => letterById.get(id) || null,
      strokes };
    let answered = false;
    const onAnswer = answer => {
      if (answered || ticket !== mine) return;
      answered = true;
      lastAnswer = answer;
      if (UNGRADED.has(exercise.type)) { record(k, null); next(); return; }
      const res = grade.check(exercise, answer, settings);
      // B2: "Skip this one" when a listening clip won't play: no grade, no sheet, straight on.
      if (res.skipped && LISTEN.has(exercise.type)) { record(k, res); next(); return; }
      holdStep();   // design 4 #5: before the step marks itself (a graded pool shrinks), so its top stays put
      try { ctrl && ctrl.showResult(res); } catch { /* a screen that can't mark itself still gets the sheet */ }
      record(k, res);
      stage.setAttribute('data-answered', '');
      feedback(exercise, answer, res);
    };
    try {
      const c = await ex.render(exercise, stage, onAnswer, ctx);
      if (ticket !== mine) { if (c && c.destroy) c.destroy(); return; }
      ctrl = c;
      window.scrollTo({ top: 0, behavior: 'instant' });   // a new step starts at its top
      armGuard();
      stage.setAttribute('data-ready', String(results.length));
      focusStep();
    } catch {
      if (ticket !== mine) return;
      armGuard();
      stage.setAttribute('data-ready', String(results.length));
      // A type whose screen is not built yet (E9 speak, E11 letters): passed over as skipped.
      stage.replaceChildren(h('section', { class: 'ex ex-missing', 'data-type': exercise.type },
        infoRow("This exercise isn't ready yet."),
        h('div', { class: 'ex-actions' }, Object.assign(h('button', { type: 'button', class: 'btn btn-main ex-skip-missing', text: 'Continue' }),
          { onclick: () => { if (answered) return; answered = true; record(k, UNGRADED.has(exercise.type) ? null : { skipped: true }); next(); } }))));
    }
  }

  // Q3d m5: on arrival at a step, focus goes to the step heading unless the screen already
  // focused its own control (a typing box); never left on BODY.
  function focusStep() {
    const a = document.activeElement;
    if (a && a !== document.body && stage.contains(a)) return;
    if (document.querySelector('.rp-backdrop')) return;
    const head = stage.querySelector('.ex-title, .ex-title-small, h2, h1');
    const first = [...stage.querySelectorAll('button, input, textarea, [tabindex="0"]')]
      .find(b => !b.disabled && !b.hidden && b.offsetParent !== null);
    const target = head || first;
    if (!target) return;
    if (target === head && !head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function record(k, res) {
    results.push(session.entry(exercises, results, k, res, elapsed()));
    queue = session.queueOf(exercises, results);
    session.saveResume(lessonId, seed, results, runOpts);
  }

  function next() {
    pos = results.length;
    showStep();
  }

  // design 2 #4 / design 3 #2: after answering, the learner's answer (and the question, when both
  // fit) stays fully visible between the header and the sheet, and nothing is left half cut by the
  // header or the sheet: a block that cannot fit goes fully out of sight instead. Candidate scroll
  // positions are tried and measured (no paint happens in between), and the best one is kept.
  const ATOMS = ['.ex-title', '.ex-title-small', '.ex-prompt-listen', '.speak-prompt', '.intro-card', '.letter-card', '.lx-say',
    '.lb-result', '.lx-grid > *', '.choice', '.match-card', '.tile', '.answer-line', '.type-input', 'textarea',
    '.howto-btn', '.howto', '.audio-btn', '.speak-rec-row', '.speak-plays .btn', '.chip', '.btn', 'p', 'h2', 'h3',
    'label', '.te', '.rom', '.en', '.caption', 'img', 'svg'].join(', ');
  function keepInView(sheet) {
    const ex = stage.querySelector('.ex');
    if (!ex || !sheet.isConnected) return;
    for (const c of ex.querySelectorAll('.kiv-cut, .kiv-frame')) c.classList.remove('kiv-cut', 'kiv-frame');
    const y0 = window.scrollY;
    // room to scroll a cut prompt fully out under the header: spare space under the step, trimmed
    // to what the chosen position needs at the end
    const baseMax = Math.max(0, document.scrollingElement.scrollHeight - window.innerHeight);
    stage.style.paddingBottom = `${window.innerHeight}px`;
    const maxY = Math.max(0, document.scrollingElement.scrollHeight - window.innerHeight);
    const all = [...ex.querySelectorAll(ATOMS)].filter(b => b.offsetParent !== null && !b.closest('.ex-actions, .tile-probe')
      && !b.matches('.audio-msg:empty') && b.getBoundingClientRect().height > 0);
    // a prompt card is judged by what is in it (its frame may run under the header; its words may not)
    const FRAMES = '.ex-prompt-listen, .speak-prompt, .intro-card, .letter-card, .lx-say';
    const frames = all.filter(b => b.matches(FRAMES));
    const inner = all.filter(b => !b.matches(FRAMES));
    const atoms = inner.filter(b => !inner.some(o => o !== b && o.contains(b)));
    if (!atoms.length) { stage.style.paddingBottom = ''; return; }
    const answerEl = ex.querySelector('[aria-checked="true"], .answer-line, textarea, input[type="text"], .match-grid, .lb-forms') || atoms[atoms.length - 1];
    const measure = () => {
      const Hh = top.getBoundingClientRect().bottom, H = Hh + 8;   // the header, and it with its fade
      const S = Math.min(sheet.getBoundingClientRect().top, window.innerHeight);
      let cuts = 0, seen = 0;
      const edges = [];
      const ar = answerEl.getBoundingClientRect();
      for (const l of atoms) {
        const r = l.getBoundingClientRect();
        // cut: partly hidden by the header or by the sheet
        const v = Math.min(r.bottom, S) - Math.max(r.top, Hh);
        if (v > 0.5 && v < r.height - 0.5) cuts += 1;
        else if (v >= r.height - 0.5 && r.top < ar.top) seen += 1;
        edges.push(r.top - H, r.bottom - S, r.bottom - Hh, r.top - S);
      }
      // design 4 #4: a whole block left inside the sheet's fade reads as sliced too
      let fades = 0;
      for (const l of atoms) {
        if (l.contains(answerEl) || answerEl.contains(l)) continue;
        const r = l.getBoundingClientRect();
        if (r.bottom > S - 23.5 && r.top < S - 0.5 && r.bottom - r.top > 0.5 && Math.min(r.bottom, S) - Math.max(r.top, Hh) > 0.5) fades += 1;
        edges.push(r.bottom - S + 24);
      }
      let frameCuts = 0;
      for (const f of frames) {
        const r = f.getBoundingClientRect(), v = Math.min(r.bottom, S) - Math.max(r.top, Hh);
        // a card that would fit whole counts as cut; one taller than the gap may run under the header
        if (v > 0.5 && v < r.height - 0.5) { if (r.height <= S - H) cuts += 1; else frameCuts += 1; }
        edges.push(r.top - H, r.bottom - S, r.bottom - Hh, r.top - S);
      }
      const fits = ar.height <= S - H;
      // 0: the answer shown whole (or, too tall for the gap, its end with whole tiles / cards);
      // 1: the answer out of the gap altogether; 2: the answer cut
      const av = Math.min(ar.bottom, S) - Math.max(ar.top, Hh);
      let answerOk = fits ? (ar.top >= H - 0.5 && ar.bottom <= S + 0.5 ? 0 : av <= 0.5 ? 1 : 2) : av <= 0.5 ? 1 : 2;
      // the answer's end under the sheet's 24px fade: avoided when nothing gets cut for it
      const fadeHit = answerOk === 0 && ar.bottom > S - 23.5 && ar.bottom <= S + 0.5 ? 1 : 0;
      if (!fits) {
        let parts = [...answerEl.querySelectorAll('.tile, .match-card')].filter(t => !t.closest('.tile-probe'));
        if (!parts.length) parts = [...answerEl.querySelectorAll('.te, .rom, .en, svg')].filter(t => t.getBoundingClientRect().height > 0);
        let whole = 0, cut = 0;
        for (const t of parts) {
          const r = t.getBoundingClientRect(), v = Math.min(r.bottom, S) - Math.max(r.top, Hh);
          if (v >= r.height - 0.5) whole += 1; else if (v > 0.5) cut += 1;
          edges.push(r.top - H, r.bottom - S, r.top - S, r.bottom - Hh);
        }
        if (ar.bottom <= S + 0.5 && (parts.length ? whole > 0 && !cut : ar.bottom - H >= 48)) answerOk = 0;
        else if (cut) answerOk = 2;
      }
      edges.push(ar.top - H, ar.bottom - S, ar.bottom - S + 24);
      return { y: window.scrollY, key: [answerOk, cuts, frameCuts, fadeHit, fades, -seen, Math.abs(window.scrollY - y0)], edges };
    };
    const better = (p, q) => { for (let i = 0; i < p.key.length; i++) if (p.key[i] !== q.key[i]) return p.key[i] < q.key[i]; return false; };
    const at = y => { window.scrollTo({ top: y, behavior: 'instant' }); return measure(); };
    let best = measure();
    const tried = new Set([Math.round(best.y)]);
    let round = [best];
    for (let pass = 0; pass < 2; pass++) {
      const next = [];
      for (const m of round) {
        for (const e of [...m.edges, -m.y, maxY - m.y]) {
          const y = Math.round(Math.min(maxY, Math.max(0, m.y + e)));
          if (tried.has(y)) continue;
          tried.add(y);
          const r = at(y);
          next.push(r);
          if (better(r, best)) best = r;
        }
      }
      round = [best].filter(r => next.includes(r));
      if (!round.length) break;
    }
    stage.style.paddingBottom = best.y > baseMax ? `${Math.ceil(best.y - baseMax)}px` : '';
    window.scrollTo({ top: best.y, behavior: 'instant' });
    // whatever still straddles the header or the sheet (no position avoided it) is taken out of
    // sight whole rather than shown half cut; the answer itself never is
    const Hh = top.getBoundingClientRect().bottom, S = Math.min(sheet.getBoundingClientRect().top, window.innerHeight);
    // (design 4 #4: the sheet's 24px fade counts as the sheet)
    for (const l of atoms) {
      if (l.contains(answerEl) || answerEl.contains(l)) continue;
      const r = l.getBoundingClientRect(), v = Math.min(r.bottom, S) - Math.max(r.top, Hh);
      if ((v > 0.5 && v < r.height - 0.5) || (v > 0.5 && r.bottom > S - 23.5)) l.classList.add('kiv-cut');
    }
    // the answer box itself stays, but a frame the header or the sheet's fade would slice is dropped
    { const r = answerEl.getBoundingClientRect();
      if (answerEl.matches('.answer-line, .match-grid, .lb-forms') && (r.top < Hh - 0.5 || r.bottom > S - 23.5) && r.bottom > Hh && r.top < S) answerEl.classList.add('kiv-frame'); }
    // a card frame left as an empty sliver (nothing in it fully in sight) goes too
    for (const f of frames) {
      if (f.contains(answerEl)) continue;
      const r = f.getBoundingClientRect(), v = Math.min(r.bottom, S) - Math.max(r.top, Hh);
      if (!(v > 0.5 && (v < r.height - 0.5 || r.bottom > S - 23.5))) continue;
      const shown = atoms.some(l => f.contains(l) && !l.classList.contains('kiv-cut') && (() => {
        const q = l.getBoundingClientRect(); return Math.min(q.bottom, S) - Math.max(q.top, Hh) >= q.height - 0.5; })());
      f.classList.add(shown ? 'kiv-frame' : 'kiv-cut');
    }
  }

  // design 3 #17: the step is centred by CSS (auto margins); when the sheet opens, the step keeps the
  // place it had, so answering does not move it.
  function holdStep() {
    const first = stage.querySelector('.ex > :first-child');
    if (first) first.style.marginTop = getComputedStyle(first).marginTop;
  }

  // ---- feedback sheet (S10, DESIGN 7) ----
  function feedback(exercise, answer, res) {
    const st = session.stateOf(res);
    const it = items.get((exercise.itemIds || [])[0]) || null;
    const typed = typeof res.typed === 'string' ? res.typed : (typeof answer === 'string' ? answer.trim() : null);
    const latin = !!(typed && !hasTelugu(typed) && (exercise.type === 'typein' || exercise.type === 'listen_type'));
    const cx = makeCtx({ item: id => items.get(id) || null, settings: latin ? { ...settings, rom: 'on' } : settings });
    const WORD = { right: ['tick', 'Correct'], close: ['almost', 'Almost'], wrong: ['cross', 'Not quite'], skipped: ['info', 'Skipped'] };
    // Q3d m4: a speak step the learner rated "Not yet" is graded `again` (SPECS S2 table) but the
    // app did not judge the voice, so the sheet is neutral: no "Not quite", no "Correct answer".
    const selfAgain = exercise.type === 'speak' && st === 'wrong';
    const [ic, word] = selfAgain ? ['info', 'You will practise this one again'] : WORD[st];
    const row = h('div', { class: 'fb-state', role: 'status', tabindex: '-1' },
      icon(ic, 'fb-icon'), h('span', { class: 'fb-word', text: word }));
    const parts = [row];

    const teBank = exercise.type === 'bank_en_te' || exercise.type === 'listen_bank';
    if (selfAgain) {
      if (it) {
        parts.push(h('div', { class: 'fb-answer fb-listen-again' },
          h('p', { class: 'caption', text: 'Listen once more' }),
          h('div', { class: 'stack-row' }, audioButtons(it, cx),
            h('div', { class: 'stack' }, teWords(it, cx, 'lg', { tapReveal: true }), it.en ? h('p', { class: 'en', text: it.en }) : null))));
      }
    } else if ((st === 'wrong' || st === 'close') && teBank) {
      // S2/S3: a word bank shows the item's own sentence with its romanization, no syllable diff.
      parts.push(bankAnswer(it, cx));
    } else if ((st === 'wrong' || st === 'close') && exercise.type === 'letter_build' && exercise.syllable) {
      // design 1 E3: the syllable with its audio and romanization, like a word sheet
      const syl = exercise.syllable;
      parts.push(letterAnswer(syllableSrc(syl), syl.te, syl.rom, cx));
    } else if ((st === 'wrong' || st === 'close') && exercise.type !== 'match' && exercise.type !== 'letter_sound' && exercise.type !== 'letter_name') {
      // design 1 #3b / design 2: when more than half of the syllables are wrong, no part list and no
      // per-syllable marks (a whole word in red with a row of triangles says nothing more)
      const hasDiff = Array.isArray(res.diff) && res.diff.length && 'status' in res.diff[0];
      const units = hasDiff ? res.diff.filter(d => !(d.exp ? SPACE_OR_PUNCT.test(d.exp) : (!d.got || SPACE_OR_PUNCT.test(d.got)))) : [];
      const most = hasDiff && units.filter(d => d.status !== 'ok').length * 2 > units.length;
      parts.push(answerBlock(exercise, res, it, cx, st, latin, most));
      if (hasDiff) {
        parts.push(youWrote(res.diff, st, most));
        const lines = most ? [] : partLines(res.diff, res.expected);
        if (lines.length) parts.push(h('ul', { class: 'fb-parts' }, lines));
      }
      if (latin) {
        parts.push(h('p', { class: 'fb-typed' }, h('span', { class: 'caption', text: 'You typed: ' }),
          h('span', { class: 'typed', text: typed })));
      }
    } else if (st === 'wrong' && exercise.type === 'match') {
      parts.push(missedPairs(exercise, res, cx));
    } else if (st === 'right' && it && RIGHT_BLOCK.has(exercise.type)) {
      // design 1 #4: after typing or building, the right sheet shows and plays the Telugu too
      const rcx = makeCtx({ item: id => items.get(id) || null, settings });
      parts.push(h('div', { class: 'fb-answer', 'data-of': 'right' },
        h('div', { class: 'stack-row' }, audioButtons(it, rcx),
          h('div', { class: 'stack' }, teWords(it, rcx, 'lg', { tapReveal: true }), it.en ? h('p', { class: 'en', text: it.en }) : null))));
    } else if (st === 'right' && exercise.type === 'letter_build' && exercise.syllable) {
      // design 4 #1: a listening step's sheet always shows and plays what was heard
      const syl = exercise.syllable;
      parts.push(letterAnswer(syllableSrc(syl), syl.te, syl.rom, cx, true));
    } else if (st === 'right' && exercise.type === 'letter_sound') {
      const l = letterById.get(String((exercise.itemIds || [])[0] || '').slice(2)) || null;
      if (l) parts.push(letterAnswer(l, (l.type === 'sign' || l.type === 'mark' || l.type === 'final') ? l.say : (l.glyph || l.say), l.rom, cx, true));
    }
    if (res.message === 'spaces') parts.push(infoRow('Check the spaces'));
    if (res.message === 'strict') parts.splice(1, 0, infoRow('Strict is on: long vowels and marks must be exact.'));
    if (res.message === 'respell') {
      const exp = res.expected || (exercise.accept || [])[0] || {};
      parts.push(infoRow(`Accepted. In this app's spelling: ${exp.rom || ''}`));
    }
    if (it && exercise.type !== 'match') parts.push(...extras(it, cx));
    else if (String((exercise.itemIds || [])[0] || '').startsWith('L:')) parts.push(...letterExtras(exercise, st, cx));
    const rep = h('button', { type: 'button', class: 'btn btn-quiet fb-report' }, icon2('flag'), h('span', { text: 'Report' }));
    rep.addEventListener('click', () => openReport());
    parts.push(rep);
    if (reported.has(stepKey())) {
      rep.disabled = true;
      rep.setAttribute('data-sent', '');
      rep.querySelector('span:last-child').textContent = 'Reported';
    }

    const look = selfAgain ? 'skipped' : st;
    const cont = h('button', { type: 'button', class: `btn btn-main fb-continue cont-${look}`, text: 'Continue' });
    cont.addEventListener('click', () => next());
    const sheet = h('section', { class: `fb fb-${look}${selfAgain ? ' fb-self-again' : ''}`, 'data-state': st, 'data-card': '', 'aria-label': 'Feedback' },
      h('div', { class: 'fb-body' }, parts), h('div', { class: 'fb-actions' }, cont));
    sheetSlot.replaceChildren(sheet);
    try { row.focus({ preventScroll: true }); } catch { /* ignore */ }
    keepInView(sheet);
    // Q3c minor 1: when the sheet grows after it opens (an audio-failure line), Continue is kept
    // fully on screen.
    if (typeof ResizeObserver === 'function') {
      let h0 = sheet.offsetHeight;
      const ro = new ResizeObserver(() => {
        if (!sheet.isConnected) { ro.disconnect(); return; }
        const grown = sheet.offsetHeight > h0;
        h0 = sheet.offsetHeight;
        if (!grown) return;
        const r = sheet.getBoundingClientRect();
        if (r.bottom > window.innerHeight || cont.getBoundingClientRect().top < 0) {
          // the whole sheet (with its padding under Continue) when it fits, else Continue itself
          const target = r.height <= window.innerHeight ? sheet : cont;
          try { target.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
        }
      });
      ro.observe(sheet);
    }
    // Enter continues (added after this key press has finished, so the Enter that checked doesn't skip).
    const t = setTimeout(() => {
      const onKey = e => {
        if (e.key !== 'Enter' || e.repeat || e.isComposing || document.querySelector('.rp-backdrop')) return; // Q3f minor 1: held Enter
        const tg = e.target;
        const ctl = tg && tg.closest && tg.closest('button, a, textarea, input, select');
        // Q3g minor 2: an inert control (the sent report flag) does not block Continue
        if (ctl && ctl !== cont && ctl.getAttribute('aria-disabled') !== 'true') return;
        e.preventDefault();
        cont.click();
      };
      document.addEventListener('keydown', onKey);
      keyOff = () => document.removeEventListener('keydown', onKey);
    }, 0);
    keyOff = () => clearTimeout(t);
  }

  // The accepted answer: marked units (S6) at te-lg, its romanization, its English, audio.
  function answerBlock(exercise, res, it, cx, st, latin, plain = false) {
    const exp = res.expected;
    let line = null, rom = '', needs = [];
    if (Array.isArray(res.diff) && res.diff.length && 'status' in res.diff[0]) {
      line = markedLine(res.diff.filter(d => d.exp !== null).map(d => ({ te: d.exp, mark: !plain && d.status !== 'ok' })), st, 'lg');
      if (exp && typeof exp === 'object' && !Array.isArray(exp)) { rom = exp.rom || ''; needs = (exp.units || []).flatMap(u => u.needs || []); }
      else if (it && Array.isArray(exp) && grade.tokens(it.te).join(' ') === exp.join(' ')) { rom = it.rom; needs = (it.units || []).flatMap(u => u.needs || []); }
    } else if (Array.isArray(res.diff) && res.diff.length && 'unit' in res.diff[0] && exp && typeof exp === 'object') {
      const flags = res.diff.map(d => d.marked);
      let q = 0;
      const all = Array.isArray(exp.units) && exp.units.length ? exp.units : res.diff.map(d => d.unit);
      const segs = all.map(u => (SPACE_OR_PUNCT.test(u.te) ? { te: u.te, mark: false } : { te: u.te, mark: !!flags[q++] }));
      const shown = segs.map(s => s.te).join('');
      if (exp.te && shown.replace(/\s+/g, '') !== String(exp.te).replace(/[\s.,?!]+/g, '').replace(/\s+/g, '')
        && shown.replace(/\s+/g, '') !== String(exp.te).replace(/\s+/g, '')) segs.push({ te: '', mark: false });
      line = markedLine(segs, st, 'lg');
      rom = exp.rom || ''; needs = all.flatMap(u => u.needs || []);
    }
    const en = exercise.type === 'bank_te_en' && typeof exp === 'string' ? exp : (it ? it.en : '');
    let stack;
    if (line) {
      const mode = romMode({ rom, needs }, cx);
      const r = mode === 'none' ? null : h('span', { class: 'rom rom-lg fb-rom', text: rom });
      if (r && mode === 'tap') {
        r.hidden = true;
        line.addEventListener('click', () => { r.hidden = false; });
        line.setAttribute('data-rom', 'tap');
      }
      stack = h('div', { class: 'stack' }, line, r, en ? h('p', { class: 'en', text: en }) : null);
    } else {
      let src = it;
      if (exercise.type === 'letter_build' && exercise.syllable) src = exercise.syllable;
      stack = h('div', { class: 'stack' }, src ? teWords(src, cx, 'lg', { tapReveal: true }) : null,
        en ? h('p', { class: 'en', text: en }) : null);
    }
    // Q3b S2: an accepted alternate (not the item's own form) is shown as text only, with no play
    // button (its clip does not exist); under it, the taught form with its romanization and audio.
    const nfc = s => String(s || '').normalize('NFC').trim();
    const alt = !!(it && exp && typeof exp === 'object' && !Array.isArray(exp) && exp.te
      && Array.isArray(exercise.accept) && exercise.accept[0] && exp !== exercise.accept[0]
      && nfc(exp.te) !== nfc(it.te));
    if (alt) {
      const rcx = { ...cx, settings: { ...cx.settings, rom: cx.settings.rom === 'off' ? 'off' : 'on' } };
      return h('div', { class: 'fb-answer', 'data-alt': '' },
        h('p', { class: 'caption', text: 'Correct answer' }),
        h('div', { class: 'stack-row' }, stack),
        h('div', { class: 'fb-taught' },
          h('p', { class: 'caption', text: 'Taught form:' }),
          h('div', { class: 'stack-row' }, audioButtons(it, cx),
            h('div', { class: 'stack' }, teWords(it, rcx, 'md')))));
    }
    return h('div', { class: 'fb-answer' },
      h('p', { class: 'caption', text: 'Correct answer' }),
      h('div', { class: 'stack-row' }, it ? audioButtons(it, cx) : null, stack));
  }

  // S2: the bank item's main sentence (never a te_alt) as a te-stack with romanization shown.
  function bankAnswer(it, cx) {
    if (!it) return null;
    const rcx = { ...cx, settings: { ...cx.settings, rom: cx.settings.rom === 'off' ? 'off' : 'on' } };
    return h('div', { class: 'fb-answer', 'data-of': 'item' },
      h('p', { class: 'caption', text: 'Correct answer' }),
      h('div', { class: 'stack-row' }, audioButtons(it, cx),
        h('div', { class: 'stack' }, teWords(it, rcx, 'lg'), it.en ? h('p', { class: 'en', text: it.en }) : null)));
  }

  // S4: the pairs a match missed, Telugu - English.
  function missedPairs(exercise, res, cx) {
    const missed = new Set(Object.keys(res.perItem || {}).filter(id => res.perItem[id] === 'wrong'));
    const rows = (exercise.pairs || []).filter(p => p && p.t && missed.has(p.t.itemId)).map(p => {
      const it = items.get(p.t.itemId) || null;
      const te = p.t.te ? p.t : it;
      const en = p.en ?? (it ? it.en : '');
      return h('li', { class: 'fb-pair', 'data-item': p.t.itemId },
        te ? teWords(te, cx, 'md', { tapReveal: true }) : null,
        h('span', { class: 'en', text: String(en || '') }));
    });
    return h('div', { class: 'fb-missed' },
      h('p', { class: 'caption', text: rows.length === 1 ? 'This pair took more than one try:' : 'These pairs took more than one try:' }),
      h('ul', { class: 'fb-pairs' }, rows));
  }

  // A line of units; each marked unit is its own teNode (cut only at unit boundaries).
  function markedLine(segs, st, size) {
    const line = h('span', { class: `fb-line fb-line-${size}` });
    let run = '';
    const flush = () => {
      if (!run) return;
      if (hasTelugu(run)) line.append(teNode(run, { class: `te-${size}` }));
      else line.append(document.createTextNode(run));
      run = '';
    };
    for (const s of segs) {
      if (!s.mark) { run += s.te; continue; }
      flush();
      line.append(teNode(s.te, { class: `te-${size} fb-mark fb-mark-${st === 'close' ? 'close' : 'wrong'}` }));
    }
    flush();
    return line;
  }

  function youWrote(diff, st, plain = false) {
    const segs = diff.filter(d => d.got !== null).map(d => ({ te: d.got, mark: !plain && d.status !== 'ok' }));
    return h('div', { class: 'fb-wrote' }, h('p', { class: 'caption', text: 'You wrote' }), markedLine(segs, st, 'lg'));
  }

  // Per-part lines (S2 step 6). design 2 #1: a vowel line shows the learner's own syllable and the
  // expected one, whole (a conjunct with all its consonants), never a sign on a fixed carrier.
  function partLines(diff, expected) {
    const expRoms = new Map();
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      for (const u of expected.units || []) if (u.te && u.rom) expRoms.set(u.te.normalize('NFC'), u.rom);
    }
    const romOf = te => expRoms.get(String(te).normalize('NFC')) || roms.get(String(te).normalize('NFC')) || null;
    const te = s => teNode(s, { class: 'te-md' });
    // A space is named in words (S3: never an empty "( )").
    // design 2 #1 / design 3 #1: a glyph, its romanization and the mark after it never break apart
    const piece = (glyph, rom, after = '') => (!String(glyph ?? '').trim() ? [h('span', { class: 'fb-unit', text: `a space${after}` })]
      : [h('span', { class: 'fb-unit' }, te(glyph), rom ? ` (${rom})${after}` : after)]);
    const endWith = (li, mark) => { const u = li.querySelector('.fb-unit:last-of-type'); (u || li).append(mark); };
    const out = [];
    let missing = null; // design 1 #3b: every missing part on one line, where the first one was
    for (const d of diff) {
      if (d.status === 'ok') continue;
      if ((d.exp && SPACE_OR_PUNCT.test(d.exp)) && (!d.got || SPACE_OR_PUNCT.test(d.got))) continue;
      let kids;
      if (d.status === 'missing') {
        const bit = piece(d.exp, romOf(d.exp));
        if (missing) { endWith(missing, ','); missing.append(' ', ...bit); continue; }
        missing = h('li', { class: 'fb-part', 'data-part': 'missing' }, 'Missing: ', ...bit);
        out.push(missing);
        continue;
      } else if (d.status === 'extra') kids = ['Extra: ', ...piece(d.got, romOf(d.got), '.')];
      else if (d.part === 'vowel') {
        const ev = vowelOf(d.exp), gv = vowelOf(d.got);
        const label = (SIGN.test(ev) || SIGN.test(gv) || ev === '' || gv === '') ? 'Vowel sign: ' : 'Vowel: ';
        kids = [label, 'you wrote ', ...piece(d.got, romOf(d.got), ';'), ' it should be ', ...piece(d.exp, romOf(d.exp), '.')];
      } else {
        const label = d.part === 'consonant' ? 'Consonant: you wrote ' : d.part === 'nasal' ? 'Ending: you wrote ' : 'You wrote ';
        kids = [label, ...piece(d.got, romOf(d.got), ';'), ' it should be ', ...piece(d.exp, romOf(d.exp), '.')];
      }
      out.push(h('li', { class: 'fb-part', 'data-part': d.status === 'wrong' ? (d.part || 'whole') : d.status }, kids));
    }
    if (missing) endWith(missing, '.');
    return out;
  }

  // E11: a letter exercise's sheet: the right letter after a miss (a sign on its carrier, its `say`)
  // and the confidence label of the letter (letter_build: of the answer syllable).
  function letterExtras(exercise, st, cx) {
    const out = [];
    const l = letterById.get(String(exercise.itemIds[0]).slice(2)) || null;
    if (l && st === 'wrong' && (exercise.type === 'letter_sound' || exercise.type === 'letter_name')) {
      const shown = (l.type === 'sign' || l.type === 'mark' || l.type === 'final') ? l.say : (l.glyph || l.say);
      out.push(letterAnswer(l, shown, l.rom, cx));
    }
    const conf = exercise.type === 'letter_build' && exercise.syllable ? exercise.syllable.confidence : l && l.confidence;
    const lab = confidenceLabel(conf);
    if (lab) out.push(h('div', { class: 'fb-conf', 'data-of': exercise.type === 'letter_build' ? 'syllable' : 'letter' }, lab));
    return out;
  }

  // design 1 E3: a letter or syllable answer: audio buttons, then te-xl over its romanization.
  function letterAnswer(src, te, rom, cx, right = false) {
    return h('div', { class: 'fb-answer', 'data-of': right ? 'right' : 'letter' }, right ? null : h('p', { class: 'caption', text: 'Correct answer' }),
      h('div', { class: 'stack-row' }, audioButtons(src, cx),
        h('div', { class: 'stack' }, teNode(te || '', { class: 'te-xl' }),
          rom ? h('span', { class: 'rom rom-lg fb-rom', text: rom }) : null)));
  }

  // The syllable's clip from letters.json (lesson syllables, then built forms); none: no audio.
  function syllableSrc(syl) {
    const want = String(syl.te || '').normalize('NFC');
    for (const ls of (letters && Array.isArray(letters.lessons) ? letters.lessons : [])) {
      for (const x of ls.syllables || []) if (x && String(x.te).normalize('NFC') === want && x.audio) return { ...x, rom: x.rom || syl.rom };
    }
    for (const byC of Object.values((letters && letters.built) || {})) {
      for (const b of Object.values(byC || {})) if (b && String(b.te).normalize('NFC') === want && b.audio) return { ...b, rom: b.rom || syl.rom };
    }
    return { te: syl.te, rom: syl.rom };
  }

  // Confidence label, note, literary and hyd forms (te-sm stacks).
  function extras(it, cx) {
    const out = [];
    const conf = confidenceLabel(it.confidence, it.source);
    if (conf) out.push(h('div', { class: 'fb-conf' }, conf));
    const note = noteText(it.note);
    if (note) out.push(h('p', { class: 'fb-note', text: note }));
    const variant = (label, v, cls) => {
      if (!v || !v.te) return null;
      return h('div', { class: `fb-variant fb-${cls}`, 'data-variant': cls },
        h('p', { class: 'en fb-variant-label', text: label }),
        h('div', { class: 'stack' }, teNode(v.te, { class: 'te-sm' }),
          v.rom ? h('span', { class: 'rom', text: v.rom }) : null,
          v.note ? h('p', { class: 'fb-variant-note', text: noteText(v.note) }) : null));
    };
    const lit = variant('Written / formal:', it.literary, 'literary');
    const hyd = variant("In Hyderabad you'll also hear:", it.hyd, 'hyd');
    if (lit) out.push(lit);
    if (hyd) out.push(hyd);
    return out;
  }

  // ---- report sheet (S10, S3; DESIGN 7) ----
  const KIND_TEXT = {
    'wrong-telugu': 'The Telugu is wrong',
    'wrong-english': 'The English is wrong',
    'my-answer-should-count': 'My answer should count',
    audio: 'Something is wrong with the audio',
    other: 'Something else',
  };

  function answerSoFar() {
    if (lastAnswer !== undefined) return lastAnswer;
    const inp = stage.querySelector('.type-input');
    if (inp) return inp.value;
    const placed = stage.querySelectorAll('.answer-line .tile');
    if (placed.length) return [...placed].map(t => t.dataset.value);
    const sel = stage.querySelector('.choice.is-selected');
    if (sel) return Number(sel.dataset.index);
    return null;
  }

  function modal(build, opts = {}) {
    const prev = document.activeElement;
    const backdrop = h('div', { class: 'rp-backdrop' });
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      // a report button that just went to its sent state is disabled: focus Continue (or the step) instead
      const to = typeof opts.returnTo === 'function' ? opts.returnTo() : null;
      const back = to && to.isConnected ? to : prev && !prev.disabled && prev.isConnected ? prev
        : page.querySelector('.fb-continue') || page.querySelector('.ex-title');
      try { back && back.focus && back.focus({ preventScroll: true }); } catch { /* ignore */ }
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        const f = [...backdrop.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    const dialog = build(close);
    backdrop.append(dialog);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    cleanups.push(() => backdrop.remove());
    const first = (opts.focus && dialog.querySelector(opts.focus)) || dialog.querySelector('input, button');
    try { first && first.focus({ preventScroll: true }); } catch { /* ignore */ }
    return close;
  }

  // Q3h M2: on a typing step with a keyboard (fine pointer), closing the report dialog puts
  // focus back in the text box so typing and Enter carry on; other steps return to the flag.
  function typingBox() {
    if (stage.hasAttribute('data-answered') || pos >= queue.length) return null;
    const inp = stage.querySelector('.type-input');
    if (!inp || inp.disabled || inp.readOnly) return null;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return coarse ? null : inp;
  }

  function openReport() {
    if (document.querySelector('.rp-backdrop')) return;
    if (reported.has(stepKey())) return;
    const key = stepKey();
    const cur = pos < queue.length ? exercises[queue[pos]] : null;
    const snapshot = {
      itemId: cur ? ((cur.itemIds || [])[0] ?? null) : null,
      exercise: { type: cur ? cur.type : null, lessonId, step: Math.min(pos + 1, queue.length),
        itemIds: cur && Array.isArray(cur.itemIds) ? cur.itemIds.slice() : [] },
      answer: cur && UNGRADED.has(cur.type) ? null : answerSoFar(),
    };
    modal(close => {
      const name = 'rp-kind-' + Math.random().toString(36).slice(2, 8);
      const send = h('button', { type: 'button', class: 'btn btn-main rp-send', disabled: true, text: 'Send' });
      const cancel = h('button', { type: 'button', class: 'btn btn-quiet rp-cancel', text: 'Cancel' });
      const rows = report.KINDS.map(k => {
        const input = h('input', { type: 'radio', name, value: k, class: 'rp-radio' });
        input.addEventListener('change', () => { send.disabled = false; });
        return h('label', { class: 'rp-row', 'data-kind': k }, input, h('span', { text: KIND_TEXT[k] }));
      });
      const tid = 'rp-text-' + Math.random().toString(36).slice(2, 8);
      const text = h('textarea', { id: tid, class: 'rp-text', rows: '3', maxlength: '1000' });
      const body = h('div', { class: 'rp-body' },
        h('fieldset', { class: 'rp-kinds' }, h('legend', { class: 'visually-hidden', text: 'What is wrong?' }), rows),
        h('label', { class: 'rp-text-label', for: tid, text: 'Tell us more (optional)' }), text);
      const actions = h('div', { class: 'rp-actions' }, cancel, send);
      const dialog = h('section', { class: 'rp', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': name + '-t' },
        h('h2', { class: 'rp-title', id: name + '-t', text: 'Report a problem' }), body, actions);
      cancel.addEventListener('click', close);
      send.addEventListener('click', () => {
        const picked = dialog.querySelector('.rp-radio:checked');
        if (!picked || reported.has(key)) return;
        reported.add(key);
        send.disabled = true;
        report.add({ ...snapshot, kind: picked.value, text: text.value }).catch(() => {});
        markReported();
        const done = h('button', { type: 'button', class: 'btn btn-main rp-close', text: 'Close' });
        done.addEventListener('click', close);
        body.replaceChildren(h('p', { class: 'rp-done', role: 'status' }, icon('tick'), h('span', { text: 'Saved. Thank you.' })));
        actions.replaceChildren(done);
        try { done.focus({ preventScroll: true }); } catch { /* ignore */ }
      });
      return dialog;
    }, { returnTo: () => typingBox() || (reported.has(key) ? flagBtn : null) }); // Q3f minor 3
  }

  // ---- leaving ----
  function confirmLeave(nextRoute) {
    if (document.querySelector('.rp-backdrop')) return;
    modal(close => {
      const stay = h('button', { type: 'button', class: 'btn btn-main leave-stay', text: 'Keep going' });
      const go = h('button', { type: 'button', class: 'btn btn-secondary leave-go', text: 'Leave' });
      stay.addEventListener('click', close);
      go.addEventListener('click', () => {
        close();
        leaving = true;
        router.setGuard(null);
        router.go('#' + nextRoute.path);
      });
      return h('section', { class: 'rp rp-leave', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'leave-t' },
        h('h2', { class: 'rp-title', id: 'leave-t', text: 'Leave this lesson?' }),
        h('p', { text: 'Your place is saved. You can carry on later.' }),
        h('div', { class: 'rp-actions' }, go, stay));
    }, { focus: '.leave-stay' }); // Q3f minor 5: the safe choice is the default; Esc stays too
  }

  // ---- summary (S10; DESIGN 7 "Summary screen") ----
  function summary() {
    finished = true;
    router.setGuard(null);
    const secs = Math.round(elapsed());
    const s = session.finish({ kind: isLetters ? 'letters' : 'lesson', lesson, exercises, results, secs });
    const streak = store.get('streak');
    let run = 0;
    const days = new Set(streak.days || []);
    for (let d = new Date(); days.has(session.localDate(d)); d.setDate(d.getDate() - 1)) run += 1;

    const R = 52, C = 2 * Math.PI * R;
    const frac = s.graded ? s.right / s.graded : 0;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 128 128');
    ring.setAttribute('class', 'sum-ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = `<circle cx="64" cy="64" r="${R}" class="ring-track"/>`
      // design 2 #18: no arc at all at 0 (a round cap would leave a lone dot)
      + (frac > 0 ? `<circle cx="64" cy="64" r="${R}" class="ring-arc" stroke-dasharray="${(C * frac).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 64 64)"/>` : '');
    const muggu = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    muggu.setAttribute('viewBox', '0 0 200 200');
    muggu.setAttribute('class', 'sum-muggu');
    muggu.setAttribute('aria-hidden', 'true');
    let dots = '';
    for (let y = 40; y <= 160; y += 40) for (let x = 40; x <= 160; x += 40) dots += `<circle cx="${x}" cy="${y}" r="3" class="muggu-dot"/>`;
    muggu.innerHTML = `<path class="muggu-line" d="M20 100 C20 40 60 20 100 20 C140 20 180 40 180 100 C180 160 140 180 100 180 C60 180 20 160 20 100 Z M60 60 C80 40 120 40 140 60 C160 80 160 120 140 140 C120 160 80 160 60 140 C40 120 40 80 60 60 Z"/>` + dots;

    // (c) each card to revisit has its play button
    const revisit = s.revisit.map(id => {
      const cx = makeCtx({ item: x => items.get(x) || null, settings });
      if (id.startsWith('L:')) {
        const l = letterById.get(id.slice(2));
        return l ? h('li', { class: 'sum-word sum-letter', 'data-card': '' },
          h('div', { class: 'stack-row' }, audioButtons(l, cx, { label: `Play ${l.rom || 'letter'}` }),
            h('div', { class: 'stack' }, teNode(l.say || l.glyph, { class: 'te-lg' }), h('span', { class: 'rom', text: l.rom || '' })))) : null;
      }
      const it = items.get(id);
      if (!it) return null;
      return h('li', { class: 'sum-word', 'data-card': '', 'data-item': id },
        h('div', { class: 'stack-row' }, audioButtons(it, cx),
          h('div', { class: 'stack' }, teWords(it, cx, 'md'), h('p', { class: 'en', text: it.en }))));
    }).filter(Boolean);
    // design 1 #6: five words, then "Show n more" (every word stays playable)
    const CAP = 5;
    let more = null;
    if (revisit.length > CAP) {
      const rest = revisit.slice(CAP);
      rest.forEach(li => { li.hidden = true; });
      more = h('button', { type: 'button', class: 'btn btn-quiet sum-more', text: `Show ${rest.length} more` });
      more.addEventListener('click', () => {
        rest.forEach(li => { li.hidden = false; });
        more.remove();
        let b = rest[0] && rest[0].querySelector('button:not([disabled])');
        if (!b && rest[0]) { b = rest[0]; b.setAttribute('tabindex', '-1'); }  // a word with no clip yet
        try { b && b.focus({ preventScroll: true }); } catch { /* ignore */ }
      });
    }
    const low = s.graded > 0 && s.right / s.graded < 0.6;

    // Q3c minor 5: an Almost counts as right, so the summary does not claim "first try" then and
    // heads the list as near misses (when nothing was plainly wrong).
    const anyClose = results.some(r => r.state === 'close');
    const anyWrong = results.some(r => r.state === 'wrong');
    // Q3c minor 6: a reload on this screen goes home, not into a new run of the lesson.
    try { sessionStorage.setItem(DONE_KEY, location.hash); } catch { /* storage blocked */ }
    cleanups.push(() => { try { sessionStorage.removeItem(DONE_KEY); } catch { /* storage blocked */ } });
    const cont = h('button', { type: 'button', class: 'btn btn-main sum-continue', text: 'Continue' });
    cont.addEventListener('click', () => router.go('#/'));
    const box = h('section', { class: 'lesson-summary', 'data-score': String(s.score), 'data-right': String(s.right),
      'data-graded': String(s.graded), 'data-xp': String(s.xp), 'data-secs': String(s.secs), 'data-replay': String(s.replay) },
    h('h1', { class: 'screen-title sum-title', text: s.replay ? 'Lesson practised' : low ? 'Lesson complete' : 'Lesson complete!' }),
    h('div', { class: 'sum-ring-wrap' }, muggu, ring,
      h('p', { class: 'sum-fraction' }, h('span', { 'aria-hidden': 'true', text: `${s.right}/${s.graded}` }),
        h('span', { class: 'visually-hidden', text: `${s.right} of ${s.graded} right${anyClose ? '' : ' on the first try'}` }))),
    h('ul', { class: 'sum-stats' },
      // design 2 #8: every card is a value over a one-line label
      h('li', { class: 'sum-xp' }, icon2('star', 'sum-icon'), h('span', { class: 'sum-num', text: `+${s.xp}` }), h('span', { class: 'stat-label', text: 'XP' })),
      h('li', { class: 'sum-streak' }, icon2('flame', 'sum-icon'), h('span', { class: 'sum-num', text: String(run) }),
        h('span', { class: 'stat-label', text: 'day streak' })),
      h('li', { class: 'sum-time' }, icon2('clock', 'sum-icon'), h('span', { class: 'sum-num', text: fmtSecs(s.secs) }), h('span', { class: 'stat-label', text: 'Time' }))),
    revisit.length ? h('div', { class: 'sum-revisit' }, h('h2', { class: 'sum-h2',
      text: anyClose && !anyWrong ? 'Almost right: look at these again' : isLetters ? 'Letters to revisit' : 'Words to revisit' }),
      h('ul', { class: 'sum-words' }, revisit), more) : null,
    h('div', { class: 'sum-actions' }, cont));
    el.replaceChildren(box);
    try { cont.focus({ preventScroll: true }); } catch { /* ignore */ }
    // S18 "Writing in reviews" (default off): after a "Practise again" run, up to two letters from memory.
    // Not scored: the lesson result above is already saved and writing never changes it.
    if (s.replay && (store.get('settings') || {}).writeInReviews) {
      const slot = h('div', { class: 'sum-write' });
      box.querySelector('.sum-actions').before(slot);
      import('./write.js').then(m => m.reviewTail(slot, {})).then(ok => { if (!ok) slot.remove(); })
        .catch(() => slot.remove());
    }
  }

  return cleanup;
}

// design 1 #4: steps whose right sheet shows the answer block (no caption)
// design 4 #1/#3: listening and speaking steps too (the card above may be out of sight)
const RIGHT_BLOCK = new Set(['typein', 'listen_type', 'bank_en_te', 'listen_bank', 'listen_choice', 'speak']);

// The home screen's lock rule (home.pathModel); a lesson the path does not list is not locked.
function lockedOnPath(index, letters, lessonId, isLetters, settings) {
  try {
    const m = pathModel(index, letters, store.get('progress'), settings);
    const nodes = isLetters ? m.letterLessons : m.units.flatMap(u => u.nodes).filter(n => n.kind === 'lesson');
    const n = nodes.find(x => x.id === lessonId);
    return !!(n && n.state === 'locked');
  } catch {
    return false;
  }
}

// design 2 #3: a lesson address that names no lesson: the normal shell (nav shown), one card.
function missingLesson() {
  const shell = document.querySelector('[data-layout]');
  if (shell) shell.dataset.layout = 'nav';
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === 'home') a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const kolam = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  kolam.setAttribute('viewBox', '0 0 120 120');
  kolam.setAttribute('class', 'muggu lesson-missing-kolam');
  kolam.setAttribute('aria-hidden', 'true');
  kolam.setAttribute('focusable', 'false');
  let dots = '';
  for (let y = 30; y <= 90; y += 30) for (let x = 30; x <= 90; x += 30) dots += `<circle cx="${x}" cy="${y}" r="2.5" class="muggu-dot"/>`;
  kolam.innerHTML = '<path class="muggu-line" d="M15 60 C15 25 35 15 60 15 C85 15 105 25 105 60 C105 95 85 105 60 105 C35 105 15 95 15 60 Z'
    + ' M45 45 C55 33 65 33 75 45 C87 55 87 65 75 75 C65 87 55 87 45 75 C33 65 33 55 45 45 Z"/>' + dots;
  return h('section', { class: 'lesson-missing', role: 'alert' }, kolam,
    h('h1', { class: 'screen-title', text: "We can't find that lesson" }),
    h('p', { text: 'The link may be old or mistyped. Your progress is safe.' }),
    h('a', { class: 'btn btn-main', href: '#/', text: 'Back to Learn' }));
}

function errorState(text) {
  return h('section', { class: 'state-error', role: 'alert' },
    h('h1', { class: 'screen-title', text: 'Lesson' }),
    h('p', { text }),
    h('a', { class: 'btn btn-quiet', href: '#/', text: 'Go to Learn' }));
}
