// game/core.js: rules of the "Sky Shield" game (GAME-PLAN.md sections 2-4 and 11). Pure: no DOM,
// no Date.now, no Math.random. Positions are field units (0..1 both ways; y = 0 top, 1 = the towns).
//
//   letterPool(lettersDoc, progress)          -> {letters, fallback, met}
//   wordPool(units, progress)                 -> {words, sentences}   (met in completed lessons)
//   modeStatus(mode, pools)                   -> {ok, reason, count}
//   createRun({letters, words, sentences, mode, seed, relaxed}) -> state
//   step(state, dtSeconds)                    -> events
//   tap(state, launcherIndex)                 -> events
//   entryOf(state, id)                        -> {id, show, ans, te, rom, en, audio, conf, confidence}
//
// Events: {type: 'waveStart'|'spawn'|'hit'|'miss'|'land'|'wideReady'|'wide'|'crack'|'bossWrong'|
//          'waveClear'|'end', ...}

export const RULES = Object.freeze({
  waves: 6,
  sizes: [8, 9, 10, 10, 12, 12],
  maxOn: [2, 2, 2, 3, 3, 4],
  fall0: 10.0, fallStep: 0.7, fallMin: 6.0,
  firstSpawn: 0.6, spawnGap: 1.5,
  jam: 1.0, freeze: 1.5, banner: 1.5,
  streakWide: 5, wideRange: 0.25,
  towns: 4, townHp: 2,
  hit: 100, wideHit: 50, waveBonus: 200, crack: 100, bossBonus: 200,
  maxSet: 12, minMet: 6, fallbackN: 8, minWords: 8,
  bossBase: 10, bossPerWord: 4,
  easeStep: 0.7, easeMax: 8, easeOn: 3,
  tries: 2,
});

export const TOWN_X = Object.freeze([0.125, 0.375, 0.625, 0.875]);

export const MODES = Object.freeze({
  l2s: { kind: 'letters', title: 'Letter to sound', show: 'te', ans: 'rom' },
  s2l: { kind: 'letters', title: 'Sound to letter', show: 'audio', ans: 'te' },
  w2m: { kind: 'words', title: 'Word to meaning', show: 'te', ans: 'en' },
  m2w: { kind: 'words', title: 'Meaning to word', show: 'en', ans: 'te' },
  lw: { kind: 'words', title: 'Listen for the word', show: 'audio', ans: 'te' },
});

export const fallTime = wave => Math.max(RULES.fallMin, RULES.fall0 - RULES.fallStep * (wave - 1));
// Adaptive pace: every landing adds one ease step (slower falls for the rest of the run, and one
// fewer target on screen per `easeOn` steps); a wave with no miss takes one step back.
export const fallNow = state => fallTime(state.wave) + RULES.easeStep * (state.ease || 0);
export const maxOnNow = state => {
  const base = RULES.maxOn[state.wave - 1];
  return Math.max(Math.min(2, base), base - Math.floor((state.ease || 0) / RULES.easeOn));
};
export const launcherCount = wave => (wave <= 3 ? 3 : 4);

// ---- random -------------------------------------------------------------------------------------

export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const hasAudio = x => !!(x && x.audio && ((typeof x.audio.f === 'string' && x.audio.f) || (typeof x.audio.m === 'string' && x.audio.m)));

// ---- pools ------------------------------------------------------------------------------------

function lessonList(lessons) {
  if (!lessons) return [];
  return Array.isArray(lessons) ? lessons : Object.entries(lessons).map(([id, v]) => ({ id, ...v }));
}
const isDone = (progress, id) => !!(progress && progress.lessons && progress.lessons[id] && progress.lessons[id].done);

/** Letters for the letter modes: consonants and vowels with sound, met in completed letter lessons.
 *  Fewer than 6 met: the first 8 pool letters in letters.json order (fallback). */
export function letterPool(doc, progress) {
  const all = ((doc && doc.letters) || []).filter(l => (l.type === 'consonant' || l.type === 'vowel') && l.sound);
  const metIds = new Set();
  for (const l of lessonList(doc && doc.lessons)) if (isDone(progress, l.id)) for (const x of l.letters || []) metIds.add(x);
  const met = all.filter(l => metIds.has(l.id));
  if (met.length < RULES.minMet) return { letters: all.slice(0, RULES.fallbackN), fallback: true, met: met.length };
  return { letters: met, fallback: false, met: met.length };
}

/** Words (kind word or phrase) and sentences (with a word-by-word breakdown) from completed lessons. */
export function wordPool(units, progress) {
  const words = [], sentences = [], seen = new Set();
  for (const u of units || []) {
    if (!u) continue;
    const byId = new Map((u.items || []).map(it => [it.id, it]));
    for (const l of u.lessons || []) {
      if (!isDone(progress, l.id)) continue;
      for (const id of [...(l.items || []), ...(l.practice || [])]) {
        const it = byId.get(id);
        if (!it || seen.has(id)) continue;
        seen.add(id);
        if (it.kind === 'word' || it.kind === 'phrase') words.push(it);
        else if (it.kind === 'sentence' && bossWords(it).length >= 2) sentences.push(it);
      }
    }
  }
  return { words, sentences };
}

/** The Telugu words of a sentence in order, from its `words` breakdown ("te=en"), as written. */
export function bossWords(it) {
  return (Array.isArray(it && it.words) ? it.words : [])
    .map(w => String(w).split('=')[0].trim()).filter(Boolean);
}

/** Can this mode be played with these pools? */
export function modeStatus(mode, pools) {
  const m = MODES[mode];
  if (!m) return { ok: false, reason: 'Unknown mode', count: 0 };
  if (m.kind === 'letters') {
    const ls = (pools.letters || []).filter(l => m.show !== 'audio' || hasAudio(l));
    if (ls.length < 4) return { ok: false, reason: 'Needs 4 letters with audio', count: ls.length };
    return { ok: true, reason: null, count: ls.length };
  }
  const ws = uniqueBy((pools.words || []).filter(w => m.show !== 'audio' || hasAudio(w)), w => (m.ans === 'en' ? w.en : w.te));
  if (ws.length < RULES.minWords) {
    return { ok: false, count: ws.length,
      reason: `Finish more lessons to unlock: ${ws.length} of ${RULES.minWords} words met${m.show === 'audio' ? ' (with audio)' : ''}` };
  }
  return { ok: true, reason: null, count: ws.length };
}

function uniqueBy(list, key) {
  const seen = new Set(), out = [];
  for (const x of list) { const k = key(x); if (k == null || seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}

// ---- entries ------------------------------------------------------------------------------------

function letterEntry(l, mode, all) {
  const m = MODES[mode];
  let conf = null;
  if (l.confusable) {
    const p = all.find(x => x.id !== l.id && x.confusable === l.confusable);
    if (p) conf = p.id;
  }
  const label = { te: { kind: 'te', text: l.glyph }, rom: { kind: 'rom', text: l.rom }, audio: { kind: 'audio', text: null } };
  return { id: l.id, kind: 'letter', te: l.glyph, rom: l.rom, en: null, audio: l.audio || null, conf: conf ? [conf] : [],
    confidence: l.confidence || null, show: label[m.show], ans: label[m.ans] };
}

function wordEntry(w, mode) {
  const m = MODES[mode];
  const label = { te: { kind: 'te', text: w.te }, en: { kind: 'en', text: w.en }, audio: { kind: 'audio', text: null } };
  return { id: w.id, kind: 'word', te: w.te, rom: w.rom || null, en: w.en, audio: w.audio || null,
    conf: Array.isArray(w.similar) ? w.similar.slice() : [], confidence: w.confidence || null,
    show: label[m.show], ans: label[m.ans] };
}

/** The items a run plays (shared with game/arcade.js): the mode's entries, unique answers, shuffled
 *  with `rand`, at most RULES.maxSet. Same steps as createRun below (which is left as it was). */
export function playSet({ letters = [], words = [], mode = 'l2s', rand, max = RULES.maxSet }) {
  const m = MODES[mode];
  if (!m) throw new Error(`game: unknown mode ${mode}`);
  let src = m.kind === 'letters' ? letters : words;
  if (m.show === 'audio') src = src.filter(hasAudio);
  let entries = m.kind === 'letters' ? src.map(l => letterEntry(l, mode, src)) : src.map(w => wordEntry(w, mode));
  entries = uniqueBy(entries, e => e.ans.text);
  return shuffle(entries, rand).slice(0, max);
}
export { shuffle, hasAudio };

// ---- the run ----------------------------------------------------------------------------------

export function createRun({ letters = [], words = [], sentences = [], mode = 'l2s', seed = 1, relaxed = false } = {}) {
  const m = MODES[mode];
  if (!m) throw new Error(`game: unknown mode ${mode}`);
  const rand = makeRng(seed);
  let src = m.kind === 'letters' ? letters : words;
  if (m.show === 'audio') src = src.filter(hasAudio);
  let entries = m.kind === 'letters' ? src.map(l => letterEntry(l, mode, src)) : src.map(w => wordEntry(w, mode));
  entries = uniqueBy(entries, e => e.ans.text);
  const set = shuffle(entries, rand).slice(0, RULES.maxSet);
  if (!set.length) throw new Error('game: nothing to play');
  const byId = new Map(set.map(e => [e.id, e]));
  // Boss (word modes): one met sentence with a word breakdown, picked now.
  let bossItem = null;
  if (m.kind === 'words' && sentences.length) {
    const s = sentences[Math.floor(rand() * sentences.length)];
    const ws = bossWords(s);
    if (ws.length >= 2) {
      bossItem = { id: s.id, te: s.te, en: s.en, rom: s.rom || null, audio: s.audio || null, confidence: s.confidence || null, words: ws };
    }
  }
  // Extra Telugu words for the boss launchers: other sentences' words and the met words.
  const bossFill = [];
  if (bossItem) {
    for (const s of sentences) for (const w of bossWords(s)) if (!bossItem.words.includes(w)) bossFill.push(w);
    for (const w of words) if (!bossItem.words.includes(w.te)) bossFill.push(w.te);
  }
  const state = {
    mode, seed, relaxed: !!relaxed, rand, set, byId,
    towns: Array(RULES.towns).fill(RULES.townHp),
    wave: 0, phase: 'play', timer: 0, time: 0,
    queue: [], targets: [], nextTid: 1,
    launchers: [], jam: [0, 0, 0, 0],
    score: 0, streak: 0, bestStreak: 0, wideReady: false,
    missed: [], wavesCleared: 0,
    waveMisses: 0, waveLandings: 0, requeued: new Set(), spawnIn: 0,
    reveal: null, boss: bossItem, bossFill: [...new Set(bossFill)], bossDone: !bossItem, bossTarget: null,
    hits: 0, wrong: 0, landings: 0, ease: 0, aim: null,
  };
  startWave(state, 1, []);
  return state;
}

export function entryOf(state, id) {
  if (state.boss && state.boss.id === id) return { ...state.boss, kind: 'sentence', show: { kind: 'en', text: state.boss.en }, ans: { kind: 'te', text: state.boss.te }, conf: [] };
  return state.byId.get(id) || null;
}

function buildQueue(state, n) {
  const ids = state.set.map(e => e.id);
  const q = [];
  while (q.length < n) {
    let batch = shuffle(ids, state.rand);
    if (q.length && batch.length > 1 && batch[0] === q[q.length - 1]) batch.push(batch.shift());
    q.push(...batch);
  }
  return q.slice(0, n);
}

function startWave(state, w, events) {
  state.wave = w;
  state.phase = 'play';
  state.queue = buildQueue(state, RULES.sizes[w - 1]);
  state.requeued = new Set();
  state.waveMisses = 0;
  state.waveLandings = 0;
  state.spawnIn = RULES.firstSpawn;
  state.jam = [0, 0, 0, 0];
  state.launchers = [];
  relabel(state);
  events.push({ type: 'waveStart', wave: w, fall: fallTime(w), launchers: launcherCount(w) });
}

const alive = (state, t) => state.relaxed || state.towns[t] > 0;
const lowestFirst = list => list.slice().sort((a, b) => b.y - a.y);

/** The target the launchers fire at: the one the player picked (aimAt), else the lowest. */
export function aimed(state) {
  if (state.bossTarget) return state.bossTarget;
  return state.targets.find(t => t.tid === state.aim) || lowestFirst(state.targets)[0] || null;
}
/** Pick a target on screen to fire at. Returns true when it is there. */
export function aimAt(state, tid) {
  const t = state.targets.find(x => x.tid === tid && !x.boss);
  if (!t) return false;
  state.aim = tid;
  relabel(state);
  return true;
}
const ansOf = (state, t) => (t.boss ? null : state.byId.get(t.id).ans.text);

function pickTown(state, prefer = null) {
  const all = [0, 1, 2, 3].filter(t => (prefer ? prefer.includes(t) : true));
  let open = all.filter(t => alive(state, t));
  if (!open.length) open = all;
  const free = open.filter(t => !state.targets.some(x => x.town === t));
  const from = free.length ? free : open;
  return from[Math.floor(state.rand() * from.length)];
}

function spawn(state, events) {
  const onIds = new Set(state.targets.map(t => t.id));
  const k = state.queue.findIndex(id => !onIds.has(id));
  if (k < 0) return false;
  const [id] = state.queue.splice(k, 1);
  const town = pickTown(state);
  const x1 = TOWN_X[town];
  const x0 = Math.min(0.92, Math.max(0.08, x1 + (state.rand() - 0.5) * 0.16));
  const t = { tid: state.nextTid++, id, town, x0, x1, x: x0, y: 0, fall: fallNow(state), boss: false, wrong: 0 };
  state.targets.push(t);
  relabel(state);
  events.push({ type: 'spawn', tid: t.tid, id, town, x: t.x, y: 0 });
  return true;
}

function spawnBoss(state, events) {
  const b = state.boss;
  const town = pickTown(state, [1, 2]);
  const x1 = TOWN_X[town];
  const t = { tid: state.nextTid++, id: b.id, town, x0: 0.5, x1, x: 0.5, y: 0, boss: true, next: 0,
    fall: RULES.bossBase + RULES.bossPerWord * b.words.length, words: b.words.slice() };
  state.targets.push(t);
  state.bossTarget = t;
  state.bossDone = true;
  state.launchers = [];
  relabel(state);
  events.push({ type: 'spawn', tid: t.tid, id: b.id, town, x: t.x, y: 0, boss: true });
}

function markMissed(state, id) {
  if (id != null && !state.missed.includes(id)) state.missed.push(id);
}

function removeTarget(state, t) {
  const full = state.targets.length >= maxOnNow(state);
  state.targets = state.targets.filter(x => x !== t);
  if (t.boss) state.bossTarget = null;
  if (full && state.spawnIn <= 0) state.spawnIn = RULES.spawnGap;
  else if (full) state.spawnIn = Math.max(state.spawnIn, RULES.spawnGap);
}

const dead = state => !state.relaxed && state.towns.every(h => h <= 0);

function endRun(state, events) {
  state.phase = 'end';
  state.targets = [];
  events.push({ type: 'end', score: state.score, bestStreak: state.bestStreak, wavesCleared: state.wavesCleared,
    missed: state.missed.slice(), towns: state.towns.slice(), survived: !dead(state) });
}

/** Launcher labels. Right answer for the lowest target first, then answers for the other targets on
 *  screen, then wrong ones (the confusable partner, the labels already shown, then random). Labels
 *  that stay keep their place; new ones fill the free places in random order. */
function relabel(state) {
  const n = launcherCount(state.wave);
  const want = [];
  const add = s => { if (s != null && !want.includes(s) && want.length < n) want.push(s); };
  const boss = state.bossTarget;
  const aimT = boss ? null : aimed(state);
  const on = aimT ? [aimT, ...lowestFirst(state.targets).filter(t => t !== aimT)] : [];
  if (boss) {
    for (const w of boss.words.slice(boss.next)) add(w);
    for (const w of shuffle(state.bossFill, state.rand)) add(w);
  } else {
    for (const t of on) add(ansOf(state, t));
    if (on.length) {
      for (const cid of state.byId.get(on[0].id).conf) { const c = state.byId.get(cid); if (c) add(c.ans.text); }
    }
    const answers = new Set(state.set.map(e => e.ans.text));
    for (const s of state.launchers) if (answers.has(s)) add(s);
    for (const e of shuffle(state.set, state.rand)) add(e.ans.text);
  }
  const old = state.launchers;
  const same = old.length === want.length && want.every(s => old.includes(s));
  if (same) return;
  const out = Array(want.length).fill(null);
  const rest = [];
  for (const s of want) {
    const i = old.indexOf(s);
    if (i >= 0 && i < out.length && out[i] === null) out[i] = s; else rest.push(s);
  }
  const free = shuffle(out.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0), state.rand);
  rest.forEach((s, k) => { out[free[k]] = s; });
  state.launchers = out;
}

function land(state, t, events) {
  removeTarget(state, t);
  if (state.aim === t.tid) state.aim = null;
  let hp = state.towns[t.town];
  if (!state.relaxed && hp > 0) { hp -= 1; state.towns[t.town] = hp; }
  state.streak = 0;
  state.wideReady = false;
  state.waveLandings += 1;
  state.waveMisses += 1;
  state.landings += 1;
  state.ease = Math.min(RULES.easeMax, state.ease + 1);
  markMissed(state, t.id);
  if (!t.boss && !state.requeued.has(t.id)) {
    state.requeued.add(t.id);
    state.queue.push(t.id);
  }
  state.phase = 'freeze';
  state.timer = RULES.freeze;
  state.reveal = { id: t.id, boss: !!t.boss };
  relabel(state);
  events.push({ type: 'land', tid: t.tid, id: t.id, town: t.town, hp: state.towns[t.town], x: t.x, boss: !!t.boss });
}

export function step(state, dt) {
  const events = [];
  if (state.phase === 'end') return events;
  dt = Math.max(0, Math.min(Number(dt) || 0, 0.25));
  state.time += dt;
  state.jam = state.jam.map(j => Math.max(0, j - dt));

  if (state.phase === 'freeze') {
    state.timer -= dt;
    if (state.timer > 0) return events;
    state.reveal = null;
    if (dead(state)) { endRun(state, events); return events; }
    state.phase = 'play';
    return events;
  }
  if (state.phase === 'banner') {
    state.timer -= dt;
    if (state.timer > 0) return events;
    if (state.wave >= RULES.waves) endRun(state, events);
    else startWave(state, state.wave + 1, events);
    return events;
  }

  // play
  for (const t of state.targets) {
    t.y = Math.min(1, t.y + dt / t.fall);
    t.x = t.x0 + (t.x1 - t.x0) * t.y;
  }
  const down = lowestFirst(state.targets).find(t => t.y >= 1);
  if (down) { land(state, down, events); return events; }

  const room = state.targets.length < maxOnNow(state);
  if (state.queue.length && room) {
    state.spawnIn -= dt;
    if (state.spawnIn <= 0) {
      if (spawn(state, events)) state.spawnIn = RULES.spawnGap;
    }
  }

  if (!state.queue.length && !state.targets.length) {
    if (state.wave === RULES.waves && !state.bossDone) { spawnBoss(state, events); return events; }
    const perfect = state.waveMisses === 0 && state.waveLandings === 0;
    let repaired = null;
    if (perfect) {
      state.ease = Math.max(0, state.ease - 1);
      let lo = RULES.townHp, at = -1;
      state.towns.forEach((h, i) => { if (h < lo) { lo = h; at = i; } });
      if (at >= 0) { state.towns[at] += 1; repaired = at; }
    }
    state.score += RULES.waveBonus;
    state.wavesCleared = state.wave;
    state.phase = 'banner';
    state.timer = RULES.banner;
    events.push({ type: 'waveClear', wave: state.wave, perfect, repaired });
  }
  return events;
}

export function tap(state, i) {
  const events = [];
  if (state.phase !== 'play') return events;
  if (!(i >= 0 && i < state.launchers.length)) return events;
  if (state.jam[i] > 0) return events;
  if (!state.targets.length) return events;
  const label = state.launchers[i];

  const boss = state.bossTarget;
  if (boss) {
    if (label === boss.words[boss.next]) {
      boss.next += 1;
      state.score += RULES.crack;
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      state.hits += 1;
      if (boss.next >= boss.words.length) {
        removeTarget(state, boss);
        state.score += RULES.bossBonus;
        state.launchers = [];
        relabel(state);
        events.push({ type: 'hit', tid: boss.tid, id: boss.id, x: boss.x, y: boss.y, launcher: i, boss: true, wide: [] });
      } else {
        relabel(state);
        events.push({ type: 'crack', tid: boss.tid, id: boss.id, x: boss.x, y: boss.y, launcher: i, word: label, left: boss.words.length - boss.next });
      }
    } else {
      // a wrong word costs 1 second: the boss drops one second's worth
      boss.y = Math.min(0.999, boss.y + 1 / boss.fall);
      boss.x = boss.x0 + (boss.x1 - boss.x0) * boss.y;
      state.jam[i] = RULES.jam;
      state.streak = 0;
      state.wideReady = false;
      state.waveMisses += 1;
      state.wrong += 1;
      markMissed(state, boss.id);
      events.push({ type: 'bossWrong', tid: boss.tid, id: boss.id, launcher: i });
    }
    return events;
  }

  // Only the aimed target can be shot: an answer for another target on screen is a wrong answer.
  const t = aimed(state);
  if (ansOf(state, t) === label) {
    removeTarget(state, t);
    state.aim = null;
    state.score += RULES.hit;
    state.hits += 1;
    const hit = { type: 'hit', tid: t.tid, id: t.id, x: t.x, y: t.y, launcher: i, wide: [] };
    events.push(hit);
    if (state.wideReady) {
      const near = state.targets.filter(o => !o.boss && Math.abs(o.x - t.x) <= RULES.wideRange);
      for (const o of near) {
        removeTarget(state, o);
        state.score += RULES.wideHit;
        hit.wide.push({ tid: o.tid, id: o.id, x: o.x, y: o.y });
      }
      state.wideReady = false;
      state.streak = 0;
      events.push({ type: 'wide', tids: hit.wide.map(o => o.tid), x: t.x, y: t.y });
    } else {
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      if (state.streak >= RULES.streakWide) {
        state.wideReady = true;
        events.push({ type: 'wideReady' });
      }
    }
    relabel(state);
    return events;
  }

  // Wrong: every launcher jams, and the second wrong answer on one target lets it through.
  state.jam = state.jam.map(() => RULES.jam);
  state.streak = 0;
  state.wideReady = false;
  state.waveMisses += 1;
  state.wrong += 1;
  t.wrong = (t.wrong || 0) + 1;
  markMissed(state, t.id);
  events.push({ type: 'miss', launcher: i, id: t.id, tid: t.tid, left: RULES.tries - t.wrong });
  if (t.wrong >= RULES.tries) { state.aim = null; land(state, t, events); }
  return events;
}

/** The launcher index holding the right answer for the lowest target (or the boss's next word), or -1. */
export function rightLauncher(state) {
  if (state.bossTarget) return state.launchers.indexOf(state.bossTarget.words[state.bossTarget.next]);
  const t = aimed(state);
  return t ? state.launchers.indexOf(ansOf(state, t)) : -1;
}
