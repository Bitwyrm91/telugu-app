// session.js: the rules of a lesson run (task E7; SPECS S10 "Session"). No DOM.
//
// A run is an exercise list (from exgen) plus `results`, one entry per answer, in order:
//   {k, state, first, wrong?, t}
//     k      index of the exercise in the list
//     state  'right' | 'close' | 'wrong' | 'skipped' | 'seen' (intro / letter_intro)
//     first  true on the exercise's first showing, false on its re-queued retry
//     wrong  match only: item ids that had a miss (from grade.check perItem)
//     t      seconds since the run began, when this answer was given (gives `secs` after a resume)
// The queue is rebuilt from the results, so `resume` = {lessonId, seed, index, results} is enough:
//   queueOf(exercises, results)    every exercise in order, then each one whose first try was
//                                  wrong, once (never a match, never an intro)
//   entry(exercises, results, k, gradeResult, t)   the results entry for an answer
//   score(exercises, results)      {right, graded, score}: first-try right (an Almost counts, SPECS S10) over
//                                  graded first tries (skipped and intros are not counted)
//   gradesFor(exercises, results, opts) -> {id: 'again'|'hard'|'good'}   (S10 card rule)
//   summarize({...}) -> everything the summary writes, without writing it (pure)
//   finish({...})    summarize + write progress, cards, streak; clears resume
//   priorIds(cards, ids) / knownIds(cards, ids)   S10 `prior` and `known`
//   saveResume / loadResume / clearResume          the store's `resume` key
//   localDate(d)                                    'YYYY-MM-DD' in local time (streak days)

import * as store from './store.js';
import * as srs from './srs.js';

const UNGRADED = new Set(['intro', 'letter_intro']);
const RANK = { good: 0, hard: 1, again: 2 };

export function stateOf(r) {
  if (!r || r.skipped) return 'skipped';
  if (r.close) return 'close';
  return r.correct ? 'right' : 'wrong';
}

export function queueOf(exercises, results = []) {
  const q = exercises.map((_, k) => k);
  for (const r of results) {
    const ex = exercises[r.k];
    if (r.first && r.state === 'wrong' && ex && ex.type !== 'match' && !UNGRADED.has(ex.type)) q.push(r.k);
  }
  return q;
}

/** The results entry for an answer to exercise k. `res` is a grade.check result, or null for an intro. */
export function entry(exercises, results, k, res, t = 0) {
  const ex = exercises[k];
  const first = !results.some(r => r.k === k);
  const e = { k, state: UNGRADED.has(ex.type) ? 'seen' : stateOf(res), first, t: Math.max(0, Math.round(t)) };
  if (ex.type === 'match' && res && res.perItem) {
    e.wrong = Object.keys(res.perItem).filter(id => res.perItem[id] === 'wrong').sort();
    if (e.state === 'right' && e.wrong.length) e.state = 'wrong';
  }
  return e;
}

const firstTries = (exercises, results) =>
  results.filter(r => r.first && exercises[r.k] && !UNGRADED.has(exercises[r.k].type) && r.state !== 'skipped');

export function score(exercises, results) {
  const f = firstTries(exercises, results);
  const right = f.filter(r => r.state === 'right' || r.state === 'close').length; // close counts as right (S10); still revisited
  return { right, graded: f.length, score: f.length ? right / f.length : 0 };
}

function worse(map, id, g) {
  if (!(id in map) || RANK[g] > RANK[map[id]]) map[id] = g;
}

/**
 * Card grades from first tries (S10). opts.only(ex) picks the exercises that count.
 * Word exercises: wrong (not match) -> again; close or a match miss -> hard; else good.
 * Letter exercises (letter_sound / letter_name): wrong -> again, else good. letter_build: nothing.
 * A match pair with `fill: true` grades nothing.
 */
export function gradesFor(exercises, results, opts = {}) {
  const only = opts.only || (() => true);
  const out = {};
  for (const r of firstTries(exercises, results)) {
    const ex = exercises[r.k];
    if (!only(ex) || ex.type === 'letter_build') continue;
    if (ex.type === 'match') {
      const missed = new Set(r.wrong || []);
      for (const p of ex.pairs || []) {
        const id = p && p.t && p.t.itemId;
        if (!id || p.fill) continue;
        worse(out, id, missed.has(id) ? 'hard' : 'good');
      }
      continue;
    }
    const letter = ex.type === 'letter_sound' || ex.type === 'letter_name';
    const g = r.state === 'wrong' ? 'again' : (r.state === 'close' && !letter) ? 'hard' : 'good';
    for (const id of ex.itemIds || []) worse(out, id, g);
  }
  return out;
}

// ---- prior / known ----------------------------------------------------------------------

function weakestFirst(cards, ids) {
  return ids.sort((a, b) => {
    const ca = cards[a], cb = cards[b];
    const la = ca.lapses || 0, lb = cb.lapses || 0;
    if (la !== lb) return lb - la;
    const sa = Number(ca.fsrs && ca.fsrs.stability) || 0, sb = Number(cb.fsrs && cb.fsrs.stability) || 0;
    if (sa !== sb) return sa - sb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Item ids with a card that are in the content (`ids`: Set), weakest first. */
export function priorIds(cards, ids) {
  cards = cards || {};
  return weakestFirst(cards, Object.keys(cards).filter(id => !id.startsWith('L:') && ids.has(id) && cards[id]));
}

/** Letter ids (no 'L:') with an L: card in the content, weakest first. */
export function knownIds(cards, ids) {
  cards = cards || {};
  return weakestFirst(cards, Object.keys(cards).filter(id => id.startsWith('L:') && ids.has(id) && cards[id]))
    .map(id => id.slice(2));
}

// ---- dates --------------------------------------------------------------------------------

export function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- summary ------------------------------------------------------------------------------

/**
 * kind: 'lesson' | 'letters' | 'review'
 * lesson: the lesson object ({id, items, practice} or a letter lesson {id, letters}); null for review
 * Returns {kind, replay, right, graded, score, xp, secs, grades, apply: {id: rating}, revisit,
 *          progress, cards, streak} where progress/cards/streak are the new store values.
 */
export function summarize({ kind = 'lesson', lesson = null, exercises, results, secs = 0,
  progress, cards, streak, now = new Date() }) {
  const at = new Date(now);
  progress = structuredClone(progress || { lessons: {}, letters: {} });
  progress.lessons = progress.lessons || {};
  progress.letters = progress.letters || {};
  cards = structuredClone(cards || {});
  streak = structuredClone(streak || { days: [], xp: {} });
  streak.days = streak.days || [];
  streak.xp = streak.xp || {};

  const { right, graded, score: sc } = score(exercises, results);
  const id = lesson && lesson.id;
  const before = id ? progress.lessons[id] : null;
  const replay = kind !== 'review' && !!(before && before.done);
  const xp = (replay || kind === 'review' ? 5 : 10) + right;
  secs = Math.max(0, Math.round(secs));

  // What the run says about each card (also used for "words to revisit").
  const all = gradesFor(exercises, results);
  const apply = {};
  if (kind === 'review') {
    for (const [cid, g] of Object.entries(all)) if (cards[cid]) apply[cid] = g;
  } else if (!replay && kind === 'lesson') {
    const fresh = gradesFor(exercises, results, { only: ex => ex.isNew !== false });
    const step4 = gradesFor(exercises, results, { only: ex => ex.isNew === false });
    for (const nid of [...(lesson.items || []), ...(lesson.practice || [])]) apply[nid] = fresh[nid] || 'good';
    for (const [pid, g] of Object.entries(step4)) if (!(pid in apply) && cards[pid]) apply[pid] = g;
  } else if (!replay && kind === 'letters') {
    const fresh = gradesFor(exercises, results, { only: ex => ex.isNew !== false });
    const knownG = gradesFor(exercises, results, { only: ex => ex.isNew === false });
    for (const lid of lesson.letters || []) {
      const cid = 'L:' + lid;
      apply[cid] = fresh[cid] || 'good';
    }
    for (const [cid, g] of Object.entries(knownG)) if (!(cid in apply) && cards[cid]) apply[cid] = g;
  }

  for (const [cid, g] of Object.entries(apply)) {
    const base = cards[cid] || srs.newCard(cid, at);
    cards[cid] = srs.grade(base, g, at);
  }

  if (id && kind !== 'review') {
    const prev = before || {};
    progress.lessons[id] = {
      done: prev.done || at.toISOString(),
      best: Math.max(Number(prev.best) || 0, sc),
      runs: (Number(prev.runs) || 0) + 1,
      secs,
    };
    if (kind === 'letters') {
      for (const lid of lesson.letters || []) {
        if (!progress.letters[lid] || !progress.letters[lid].seen) progress.letters[lid] = { seen: at.toISOString() };
      }
    }
  }

  const day = localDate(at);
  if (!streak.days.includes(day)) { streak.days.push(day); streak.days.sort(); }
  streak.xp[day] = (Number(streak.xp[day]) || 0) + xp;

  const revisit = Object.keys(all).filter(cid => all[cid] !== 'good');
  return { kind, replay, right, graded, score: sc, xp, secs, grades: all, apply, revisit, progress, cards, streak };
}

/** summarize() and write it: progress, cards, streak; resume cleared. */
export function finish(args) {
  const s = summarize({
    ...args,
    progress: store.get('progress'),
    cards: store.get('cards'),
    streak: store.get('streak'),
  });
  store.set('progress', s.progress);
  store.set('cards', s.cards);
  store.set('streak', s.streak);
  clearResume();
  return s;
}

// ---- resume -------------------------------------------------------------------------------

/** opts: the settings the exercises were built with ({typing, speak}); a resume made with others is dropped. */
export function saveResume(lessonId, seed, results, opts = null) {
  const r = { lessonId, seed, index: results.length, results };
  if (opts) r.opts = { typing: opts.typing, speak: !!opts.speak };
  store.set('resume', r);
}

export function loadResume(lessonId, opts = null) {
  const r = store.get('resume');
  if (!(r && r.lessonId === lessonId && Array.isArray(r.results))) return null;
  if (opts && r.opts && (r.opts.typing !== opts.typing || r.opts.speak !== !!opts.speak)) return null;
  return r;
}

export function clearResume() {
  store.set('resume', null);
}
