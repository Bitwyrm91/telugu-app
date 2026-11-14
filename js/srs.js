// Spaced repetition (SPECS S10 "srs.js"): a thin wrapper over the vendored
// ts-fsrs 5.2.3 file (app/js/vendor/ts-fsrs.js, unchanged).
//
// Stored card (SPECS S3 `cards`): {fsrs: <ts-fsrs card>, lapses: n, last: <ISO time>}
// The ts-fsrs card is kept JSON-safe: its dates (`due`, `last_review`) are ISO strings.
import { fsrs, createEmptyCard, Rating, State } from './vendor/ts-fsrs.js';

// Library defaults: retention 0.9, learning steps 1m/10m, relearning 10m, no fuzz
// (so the same history always gives the same schedule).
const scheduler = fsrs();

const RATINGS = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good };

function toDate(now) {
  const d = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error('srs: bad time ' + String(now));
  return d;
}

function iso(v) {
  return v == null ? v : new Date(v).toISOString();
}

// ts-fsrs card -> JSON-safe plain object.
function plain(c) {
  return { ...c, due: iso(c.due), last_review: c.last_review == null ? undefined : iso(c.last_review) };
}

function clean(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

/** A new card, due at once. `id` is the card's key in the store (item id or 'L:'+letterId). */
export function newCard(id, now) {
  const t = toDate(now);
  return { fsrs: clean(plain(createEmptyCard(t))), lapses: 0, last: t.toISOString() };
}

/** Grades a stored card; returns a new stored card (the argument is not changed). */
export function grade(card, rating, now) {
  const r = RATINGS[rating];
  if (r === undefined) throw new Error('srs: unknown grade ' + String(rating));
  const t = toDate(now);
  const graduated = card.fsrs.state === State.Review;
  const next = scheduler.next(card.fsrs, t, r).card;
  return {
    fsrs: clean(plain(next)),
    lapses: (card.lapses || 0) + (r === Rating.Again && graduated ? 1 : 0),
    last: t.toISOString(),
  };
}

/** Ids of the cards due at `now`, earliest due first (ties by id). `cards` = {id: card}. */
export function due(cards, now) {
  const t = toDate(now).getTime();
  return Object.entries(cards || {})
    .map(([id, c]) => [id, new Date(c.fsrs.due).getTime()])
    .filter(([, d]) => d <= t)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id]) => id);
}
