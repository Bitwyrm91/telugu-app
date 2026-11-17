// game/arcade.js: rules of the "Arcade" way to play Sky Shield (GAME-PLAN.md section 14). Pure: no DOM,
// no Date.now, no Math.random. Positions are field units: x 0..1 across the sky (left to right),
// y 0..1 down it (0 = top, 1 = the towns). `aspect` is the sky's height / width; distances on screen
// (burst reach) are measured in widths, rocket flight in heights.
//
//   createArcade({letters, words, mode, seed, relaxed, aspect}) -> state
//   step(state, dtSeconds) -> events
//   fire(state, x, y)      -> events   (a rocket from the base to that point; costs 1)
//   answer(state, i)       -> events   (choice i of the reload card)
//   meteorAt(m, t)         -> {x, y}   where meteor m will be after t seconds (ignoring a split)
//   flightTime(state, x, y)-> seconds a rocket needs to reach (x, y)
//   entryOf(state, id)     -> the run entry (as core.entryOf)
//
// Events: {type: 'waveStart'|'spawn'|'split'|'fire'|'empty'|'burst'|'kill'|'land'|'card'|'right'|
//          'wrong'|'bigReady'|'waveClear'|'end', ...}

import { MODES, TOWN_X, makeRng, playSet, shuffle } from './core.js';

export const RULES = Object.freeze({
  waves: 6,
  sizes: [8, 10, 12, 14, 16, 18],
  maxOn: [2, 3, 3, 4, 4, 5],
  fall0: 11.0, fallStep: 0.8, fallMin: 7.0,     // 11 s in wave 1 down to 7 s in wave 6
  splitFrom: 4, splitEvery: 5, splitAt: 0.5,     // from wave 4, one meteor in five splits half way down
  firstSpawn: 0.6, spawnGap: 1.5, banner: 1.5,
  ammo0: 6, ammoMax: 9, reload: 3, bigAfter: 3,
  lock: 1.5, backIn: 2,                          // a wrong card comes back two cards later
  // Not in section 14 (which says: no rockets + 1.5 s lock). Simulated players showed a blind answerer
  // still won with that, so a wrong answer also takes back one rocket and each further wrong answer in
  // a row locks the card 2.5 s longer (1.5, 4, 6.5 s ...). A right answer resets the row.
  wrongCost: 1, lockGrow: 2.5,
  rocketTime: 0.7,                               // seconds for the full field height
  burst: 0.09, bigBurst: 0.18, chainBurst: 0.06, // radii in field widths
  burstLife: 0.6, meteorR: 0.025,
  baseX: 0.5,
  towns: 4, townHp: 2,
  kill: 100, chain: 150, ammoLeft: 25, waveBonus: 200,
  easeStep: 0.7, easeMax: 8, easeOn: 3,
  repair: 1,                                     // a wave with no landing repairs the most damaged town
  choices: 3, maxSet: 12,
});

export const fallTime = (wave, R = RULES) => Math.max(R.fallMin, R.fall0 - R.fallStep * (wave - 1));
export const fallNow = state => fallTime(state.wave, state.R) + state.R.easeStep * (state.ease || 0);
export const maxOnNow = state => {
  const base = state.R.maxOn[state.wave - 1];
  return Math.max(Math.min(2, base), base - Math.floor((state.ease || 0) / state.R.easeOn));
};

// ---- the run --------------------------------------------------------------------------------------

/** `tune`: optional overrides of RULES for this run only (tuning with simulated players). */
export function createArcade({ letters = [], words = [], mode = 'l2s', seed = 1, relaxed = false, aspect = 1, tune = null } = {}) {
  if (!MODES[mode]) throw new Error(`game: unknown mode ${mode}`);
  const R = Object.freeze({ ...RULES, ...(tune || {}) });
  const rand = makeRng(seed);
  const set = playSet({ letters, words, mode, rand, max: R.maxSet });
  if (set.length < R.choices) throw new Error('game: needs at least 3 items');
  const state = {
    game: 'arcade', R, mode, seed, relaxed: !!relaxed, rand, set, byId: new Map(set.map(e => [e.id, e])),
    aspect: aspect > 0 ? aspect : 1,
    towns: Array(R.towns).fill(R.townHp),
    wave: 0, phase: 'play', timer: 0, time: 0,
    queue: [], spawnIn: 0, spawned: 0,
    meteors: [], rockets: [], bursts: [], nextId: 1,
    ammo: R.ammo0, bigReady: false,
    deck: [], card: null, cards: 0, lock: 0, reveal: null,
    score: 0, streak: 0, bestStreak: 0,
    kills: 0, chains: 0, shots: 0, rights: 0, wrong: 0, landings: 0,
    missed: [], wrongIds: new Set(), grades: {},
    wavesCleared: 0, waveLandings: 0, ease: 0, wrongRow: 0,
  };
  startWave(state, 1, []);
  nextCard(state, []);
  return state;
}

export function entryOf(state, id) { return state.byId.get(id) || null; }

function startWave(state, w, events) {
  state.wave = w;
  state.phase = 'play';
  state.queue = Array(state.R.sizes[w - 1]).fill(0);
  state.spawned = 0;
  state.spawnIn = state.R.firstSpawn;
  state.waveLandings = 0;
  events.push({ type: 'waveStart', wave: w, fall: fallTime(w, state.R), size: state.R.sizes[w - 1] });
}

const alive = (state, t) => state.relaxed || state.towns[t] > 0;
const dead = state => !state.relaxed && state.towns.every(h => h <= 0);

function pickTown(state, not = []) {
  const all = [0, 1, 2, 3].filter(t => !not.includes(t));
  let open = all.filter(t => alive(state, t));
  if (!open.length) open = all;
  const free = open.filter(t => !state.meteors.some(m => m.town === t));
  const from = free.length ? free : open;
  return from[Math.floor(state.rand() * from.length)];
}

function placeOn(m) {
  const k = m.sy >= 1 ? 1 : (m.y - m.sy) / (1 - m.sy);
  m.x = m.sx + (m.x1 - m.sx) * k;
}

function spawn(state, events) {
  state.queue.pop();
  const town = pickTown(state);
  const sx = 0.05 + state.rand() * 0.9;
  const split = state.wave >= state.R.splitFrom && state.spawned % state.R.splitEvery === 2;
  state.spawned += 1;
  const m = { mid: state.nextId++, town, sx, sy: 0, x1: TOWN_X[town], x: sx, y: 0, fall: fallNow(state), split, kid: false };
  state.meteors.push(m);
  events.push({ type: 'spawn', mid: m.mid, x: m.x, y: 0, town, split });
}

function splitMeteor(state, m, events) {
  state.meteors = state.meteors.filter(o => o !== m);
  const a = pickTown(state);
  const b = pickTown(state, [a]);
  const kids = [a, b].map(town => ({ mid: state.nextId++, town, sx: m.x, sy: m.y, x1: TOWN_X[town], x: m.x, y: m.y,
    fall: m.fall, split: false, kid: true }));
  state.meteors.push(...kids);
  events.push({ type: 'split', mid: m.mid, x: m.x, y: m.y, kids: kids.map(k => ({ mid: k.mid, town: k.town })) });
}

/** Where meteor m will be after t seconds (straight on; a meteor that will split is not followed). */
export function meteorAt(m, t) {
  const y = Math.min(1, m.y + Math.max(0, t) / m.fall);
  const k = m.sy >= 1 ? 1 : (y - m.sy) / (1 - m.sy);
  return { x: m.sx + (m.x1 - m.sx) * k, y };
}

/** Seconds a rocket needs from the base (baseX, 1) to (x, y). */
export function flightTime(state, x, y) {
  const dx = (x - state.R.baseX) / state.aspect, dy = 1 - y;
  return Math.hypot(dx, dy) * state.R.rocketTime;
}

/** Distance in field widths between two field points. */
const reach = (state, ax, ay, bx, by) => Math.hypot(ax - bx, (ay - by) * state.aspect);

function burstAt(state, x, y, kind, events) {
  const r = kind === 'big' ? state.R.bigBurst : kind === 'chain' ? state.R.chainBurst : state.R.burst;
  const b = { bid: state.nextId++, x, y, r, kind, t: 0 };
  state.bursts.push(b);
  events.push({ type: 'burst', bid: b.bid, x, y, r, kind });
  return b;
}

// Every live burst destroys the meteors it touches; each of those bursts too (chain), and so on.
function collide(state, events) {
  for (let i = 0; i < state.bursts.length; i++) {
    const b = state.bursts[i];
    if (b.t >= state.R.burstLife) continue;
    const hit = state.meteors.filter(m => reach(state, m.x, m.y, b.x, b.y) <= b.r + state.R.meteorR);
    if (!hit.length) continue;
    state.meteors = state.meteors.filter(m => !hit.includes(m));
    for (const m of hit) {
      const chain = b.kind === 'chain';
      const points = chain ? state.R.chain : state.R.kill;
      state.score += points;
      state.kills += 1;
      if (chain) state.chains += 1;
      events.push({ type: 'kill', mid: m.mid, x: m.x, y: m.y, chain, points, by: b.bid });
      burstAt(state, m.x, m.y, 'chain', events);
    }
  }
}

function land(state, m, events) {
  state.meteors = state.meteors.filter(o => o !== m);
  if (!state.relaxed && state.towns[m.town] > 0) state.towns[m.town] -= 1;
  state.waveLandings += 1;
  state.landings += 1;
  state.ease = Math.min(state.R.easeMax, state.ease + 1);
  events.push({ type: 'land', mid: m.mid, town: m.town, hp: state.towns[m.town], x: m.x });
}

function endRun(state, events) {
  state.phase = 'end';
  state.meteors = [];
  state.rockets = [];
  state.lock = 0;
  events.push({ type: 'end', score: state.score, wavesCleared: state.wavesCleared, bestStreak: state.bestStreak,
    missed: state.missed.slice(), towns: state.towns.slice(), survived: !dead(state), grades: { ...state.grades } });
}

export function step(state, dt) {
  const events = [];
  if (state.phase === 'end') return events;
  dt = Math.max(0, Math.min(Number(dt) || 0, 0.25));
  state.time += dt;

  // the reload card's lock after a wrong answer
  if (state.lock > 0) {
    state.lock = Math.max(0, state.lock - dt);
    if (state.lock === 0) { state.reveal = null; nextCard(state, events); }
  }
  // bursts fade; rockets fly and burst where they were sent
  for (const b of state.bursts) b.t += dt;
  state.bursts = state.bursts.filter(b => b.t < state.R.burstLife);
  for (const r of state.rockets) r.t += dt;
  for (const r of state.rockets.filter(x => x.t >= x.dur)) burstAt(state, r.x, r.y, r.big ? 'big' : 'rocket', events);
  state.rockets = state.rockets.filter(x => x.t < x.dur);

  if (state.phase === 'banner') {
    state.timer -= dt;
    if (state.timer > 0) return events;
    if (state.wave >= state.R.waves) endRun(state, events);
    else startWave(state, state.wave + 1, events);
    return events;
  }

  // play: meteors fall, split, meet bursts, land
  for (const m of state.meteors) { m.y = Math.min(1, m.y + dt / m.fall); placeOn(m); }
  for (const m of state.meteors.filter(x => x.split && x.y >= state.R.splitAt)) splitMeteor(state, m, events);
  collide(state, events);
  for (const m of state.meteors.filter(x => x.y >= 1)) land(state, m, events);
  if (dead(state)) { endRun(state, events); return events; }

  const onTop = state.meteors.filter(m => !m.kid).length;
  if (state.queue.length && onTop < maxOnNow(state)) {
    state.spawnIn -= dt;
    if (state.spawnIn <= 0) { spawn(state, events); state.spawnIn = state.R.spawnGap; }
  } else if (state.queue.length) {
    state.spawnIn = Math.max(state.spawnIn, state.R.spawnGap);
  }

  if (!state.queue.length && !state.meteors.length) {
    const perfect = state.waveLandings === 0;
    let repaired = null;
    if (perfect) {
      state.ease = Math.max(0, state.ease - 1);
      if (state.R.repair && !state.relaxed) {
        let lo = state.R.townHp, at = -1;
        state.towns.forEach((h, i) => { if (h < lo) { lo = h; at = i; } });
        if (at >= 0) { state.towns[at] += 1; repaired = at; }
      }
    }
    const ammoBonus = state.ammo * state.R.ammoLeft;
    state.score += state.R.waveBonus + ammoBonus;
    state.wavesCleared = state.wave;
    state.phase = 'banner';
    state.timer = state.R.banner;
    state.rockets = [];
    events.push({ type: 'waveClear', wave: state.wave, perfect, repaired, ammoBonus, bonus: state.R.waveBonus });
  }
  return events;
}

/** Fire a rocket at (x, y) in field units. Costs 1; the big rocket (after 3 right answers) goes first. */
export function fire(state, x, y) {
  if (state.phase !== 'play') return [];
  if (state.ammo < 1) return [{ type: 'empty' }];
  x = Math.max(0, Math.min(1, Number(x) || 0));
  y = Math.max(0, Math.min(1, Number(y) || 0));
  state.ammo -= 1;
  state.shots += 1;
  const big = state.bigReady;
  state.bigReady = false;
  const r = { rid: state.nextId++, x, y, t: 0, dur: flightTime(state, x, y), big };
  state.rockets.push(r);
  return [{ type: 'fire', rid: r.rid, x, y, dur: r.dur, big, ammo: state.ammo }];
}

// ---- the reload card -------------------------------------------------------------------------------

function refill(state) {
  const ids = state.set.map(e => e.id);
  const batch = shuffle(ids, state.rand);
  const last = state.card && state.card.id;
  if (batch.length > 1 && batch[0] === last) batch.push(batch.shift());
  state.deck.push(...batch);
}

/** Three answers: the right one, then the confusable partner(s) in the run, then random others. */
function choicesFor(state, e) {
  const want = [e.ans.text];
  const add = s => { if (s != null && !want.includes(s) && want.length < state.R.choices) want.push(s); };
  for (const cid of e.conf || []) { const c = state.byId.get(cid); if (c) add(c.ans.text); }
  for (const o of shuffle(state.set, state.rand)) add(o.ans.text);
  return shuffle(want, state.rand);
}

function nextCard(state, events) {
  if (!state.deck.length) refill(state);
  const id = state.deck.shift();
  const e = state.byId.get(id);
  const choices = choicesFor(state, e);
  state.cards += 1;
  state.card = { n: state.cards, id, choices, right: choices.indexOf(e.ans.text), back: state.wrongIds.has(id) };
  events.push({ type: 'card', n: state.cards, id, back: state.card.back });
}

export function answer(state, i) {
  if (state.phase === 'end' || !state.card || state.lock > 0) return [];
  const c = state.card;
  if (!(i >= 0 && i < c.choices.length)) return [];
  const events = [];
  if (i === c.right) {
    const before = state.ammo;
    state.ammo = Math.min(state.R.ammoMax, state.ammo + state.R.reload);
    state.rights += 1;
    state.streak += 1;
    state.wrongRow = 0;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    // Review grade per item (GAME-PLAN section 5): right with no wrong answer this run = good; right
    // again after a wrong answer = hard; wrong and not answered right since = again.
    state.grades[c.id] = state.wrongIds.has(c.id) ? 'hard' : 'good';
    events.push({ type: 'right', id: c.id, choice: i, gained: state.ammo - before, ammo: state.ammo });
    if (state.streak % state.R.bigAfter === 0 && !state.bigReady) {
      state.bigReady = true;
      events.push({ type: 'bigReady' });
    }
    nextCard(state, events);
    return events;
  }
  state.wrong += 1;
  state.streak = 0;
  state.wrongRow += 1;
  state.lock = state.R.lock + state.R.lockGrow * (state.wrongRow - 1);
  const lost = Math.min(state.ammo, state.R.wrongCost);
  state.ammo -= lost;
  state.reveal = { id: c.id, right: c.right, choice: i };
  if (!state.missed.includes(c.id)) state.missed.push(c.id);
  state.wrongIds.add(c.id);
  state.grades[c.id] = 'again';
  // back two cards later: after the next card
  state.deck = state.deck.filter(x => x !== c.id);
  while (state.deck.length < state.R.backIn - 1) refill(state);
  state.deck = state.deck.filter((x, k) => !(k < state.R.backIn - 1 && x === c.id));
  state.deck.splice(state.R.backIn - 1, 0, c.id);
  events.push({ type: 'wrong', id: c.id, choice: i, right: c.right, lost, ammo: state.ammo });
  return events;
}
