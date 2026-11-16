// Exercise generation (SPECS S5; payloads in S4). Pure: no DOM, no storage.
// Every random choice comes from mulberry32(opts.seed), drawn in a fixed order,
// so the same input and seed always give the same exercises.
//
// forLesson(unit, lessonId, prior, opts)   opts = {seed, speak, typing, pool: [items]}
// forReview(items, pool, opts)             opts = {seed, typing, letters?, names?, loan?, bank_avoid?}
// forLetters(lesson, known, opts)          opts = {seed, built, letters?, strokes?}  (strokes: S16 letter_draw)
//
// Items are compiled items (PLAN 4.3). `prior` may hold item objects or ids
// (ids are looked up in the unit and the pool). Letters may be letter objects
// (letters.json `letters`) or ids, with or without the 'L:' prefix; ids are
// looked up in opts.letters (the letters.json list, in teaching order).

const CHOICE_ROT = ['choice_te_en', 'choice_en_te', 'listen_choice'];
const BANK_ROT = ['bank_te_en', 'bank_en_te', 'listen_bank'];
const ARTICLES = new Set(['a', 'an', 'the']);
const SPACE_OR_PUNCT = /^[\s.,?!\-‌]*$/;

// ---- random -------------------------------------------------------------------

export function mulberry32(seed) {
  let a = Number(seed) | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- small helpers ----------------------------------------------------------------

const nfc = s => String(s).normalize('NFC');
const low = s => nfc(s).trim().toLowerCase();

function enSet(it) {
  return new Set([it.en, ...(it.en_alt || [])].filter(x => x != null).map(low));
}
export function sharesEn(a, b) {
  const A = enSet(a);
  for (const x of enSet(b)) if (A.has(x)) return true;
  return false;
}
export function isSimilar(a, b) {
  return (a.similar || []).includes(b.id) || (b.similar || []).includes(a.id);
}
const tooClose = (a, b) => isSimilar(a, b) || sharesEn(a, b);

const W = t => ({ te: t.te, rom: t.rom, needs: (t.needs || []).slice() });

function tokensOf(it) {
  if (Array.isArray(it.tokens) && it.tokens.length) return it.tokens.map(W);
  return nfc(it.te).replace(/[.,?!]/g, '').split(/\s+/).filter(Boolean)
    .map(te => ({ te, rom: '', needs: [] }));
}
const T = it => ({ te: it.te, itemId: it.id, tokens: tokensOf(it) });
const tokenTexts = it => tokensOf(it).map(t => nfc(t.te));
const unitCount = it => (it.units || []).filter(u => !SPACE_OR_PUNCT.test(u.te)).length;

// English bank tiles: parentheses removed, `. , ! ?` stripped, split on spaces.
export function enTiles(en) {
  return String(en ?? '').replace(/\([^)]*\)/g, ' ').replace(/[.,!?]/g, '')
    .split(/\s+/).filter(Boolean);
}

function acceptOf(it) {
  return [{ te: it.te, rom: it.rom, units: (it.units || []).map(W) },
          ...(it.alts || []).map(a => ({ te: a.te, rom: a.rom, units: (a.units || []).map(W) }))];
}

function ordersOf(it) {
  return Array.isArray(it.orders) && it.orders.length
    ? it.orders.map(o => o.slice()) : [tokenTexts(it)];
}

// ---- match board (S5 "Match board"; tested against tests/fixtures/boards.json) -----

// block: new items in lesson order; prior: weakest first.
// -> {board: [{id, fill}] | null, skipped: [ids], items: [{item, fill}]}
export function boardFor(block, prior = []) {
  const on = [];
  const fits = it => !on.some(o => o.item.id === it.id || tooClose(o.item, it));
  for (const it of block) if (fits(it)) on.push({ item: it, fill: false });
  for (const p of prior) {
    if (on.length >= 3) break;
    if (p.kind === 'sentence') continue;
    if (fits(p)) on.push({ item: p, fill: true });
  }
  if (on.length < 3) return { board: null, skipped: block.map(i => i.id), items: [] };
  const ids = new Set(on.map(o => o.item.id));
  return { board: on.map(o => ({ id: o.item.id, fill: o.fill })),
           skipped: block.filter(i => !ids.has(i.id)).map(i => i.id), items: on };
}

// Blocks: ceil(n / 5), sizes as even as possible, earlier blocks larger.
export function blocksOf(items) {
  const n = items.length;
  if (!n) return [];
  const b = Math.ceil(n / 5), base = Math.floor(n / b), extra = n % b;
  const out = [];
  let k = 0;
  for (let i = 0; i < b; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(items.slice(k, k + size));
    k += size;
  }
  return out;
}

// ---- item exercises ------------------------------------------------------------------

// ctx: {rng, cands(): introduced candidate items, tileItems(): items for extra tiles,
//       names, loan, bankAvoid, known(): items for the bank synonym rule}

function pickDistractors(ctx, target, telugu) {
  const isSent = target.kind === 'sentence';
  const teBad = new Set([target.te, ...(target.te_alt || [])].map(s => nfc(s).trim()));
  const ok = ctx.cands().filter(c => c.id !== target.id
    && (isSent ? c.kind === 'sentence' : c.kind !== 'sentence')
    && !tooClose(target, c)
    && (!telugu || !teBad.has(nfc(c.te).trim())));
  const same = ok.filter(c => c.kind === target.kind), other = ok.filter(c => c.kind !== target.kind);
  const order = [...shuffle(same, ctx.rng), ...shuffle(other, ctx.rng)];
  const out = [], keys = new Set();
  for (const c of order) {
    if (out.length >= 3) break;
    const key = telugu ? nfc(c.te).trim() : low(c.en);
    if (keys.has(key)) continue;
    keys.add(key); out.push(c);
  }
  return out;
}

function choiceEx(ctx, it, type, teChoices, isNew) {
  const telugu = type === 'choice_en_te' || (type === 'listen_choice' && teChoices);
  const ds = pickDistractors(ctx, it, telugu);
  if (!ds.length) return typeEx(ctx, it, 'typein', 'tiles', isNew);
  const all = shuffle([it, ...ds], ctx.rng);
  const ex = { type, itemIds: [it.id], isNew };
  if (type === 'choice_te_en') ex.prompt = T(it);
  else if (type === 'choice_en_te') ex.prompt = { en: it.en, register: it.register || 'neutral' };
  else ex.audio = it.id;
  ex.choices = telugu ? all.map(T) : all.map(c => c.en);
  ex.answer = all.indexOf(it);
  return ex;
}

function tilesFor(ctx, it, accept) {
  const answer = (accept[0].units || []).filter(u => !SPACE_OR_PUNCT.test(u.te)).map(W);
  const tiles = answer.slice();
  if (/\s/.test(nfc(accept[0].te).trim())) tiles.push({ te: ' ', rom: ' ', needs: [] });
  const used = new Set(accept.flatMap(a => (a.units || []).map(u => nfc(u.te))));
  const extra = [];
  for (const o of ctx.tileItems()) {
    if (o.id === it.id) continue;
    for (const u of o.units || []) {
      const k = nfc(u.te);
      if (SPACE_OR_PUNCT.test(u.te) || used.has(k)) continue;
      used.add(k); extra.push(W(u));
    }
  }
  return shuffle([...tiles, ...shuffle(extra, ctx.rng).slice(0, 3)], ctx.rng);
}

function typeEx(ctx, it, type, mode, isNew) {
  let accept = acceptOf(it);
  if (type === 'listen_type') accept = accept.slice(0, 1);
  const ex = { type, itemIds: [it.id], isNew };
  if (type === 'typein') ex.prompt = { en: it.en, register: it.register || 'neutral' };
  else ex.audio = it.id;
  Object.assign(ex, { accept, names: { ...ctx.names }, loan: { ...ctx.loan }, mode,
                      tiles: tilesFor(ctx, it, accept) });
  return ex;
}

function enBankEx(ctx, it, isNew) {
  const answer = enTiles(it.en);
  const bad = new Set([it.en, ...(it.en_alt || [])].flatMap(enTiles).map(w => w.toLowerCase()));
  const words = [], seen = new Set();
  for (const c of ctx.cands()) {
    if (c.id === it.id) continue;
    for (const w of enTiles(c.en)) {
      const k = w.toLowerCase();
      if (bad.has(k) || ARTICLES.has(k) || seen.has(k)) continue;
      seen.add(k); words.push(w);
    }
  }
  const ds = shuffle(words, ctx.rng).slice(0, 3);
  if (!ds.length && answer.length === 1) return choiceEx(ctx, it, 'choice_te_en', false, isNew);
  return { type: 'bank_te_en', itemIds: [it.id], isNew, prompt: T(it),
           bank: shuffle([...answer, ...ds], ctx.rng), accept: [it.en, ...(it.en_alt || [])] };
}

function teBankEx(ctx, it, type, isNew) {
  const answer = tokensOf(it);
  const accepted = type === 'listen_bank' ? [answer.map(t => t.te)] : ordersOf(it);
  const inAnswer = new Set(ordersOf(it).flat().map(nfc));
  for (const t of answer) inAnswer.add(nfc(t.te));
  const avoid = new Set((ctx.bankAvoid || []).map(nfc));
  const known = ctx.known();
  const anchors = known.filter(y => !y.practice && tokenTexts(y).some(t => inAnswer.has(t)));
  const banned = new Set();
  for (const x of known) {
    if (anchors.some(y => y.id !== x.id && tooClose(x, y))) for (const t of tokenTexts(x)) banned.add(t);
  }
  const toks = [], seen = new Set();
  for (const c of ctx.cands()) {
    if (c.id === it.id) continue;
    for (const t of tokensOf(c)) {
      const k = nfc(t.te);
      if (inAnswer.has(k) || avoid.has(k) || banned.has(k) || seen.has(k)) continue;
      seen.add(k); toks.push(t);
    }
  }
  const ds = shuffle(toks, ctx.rng).slice(0, 3);
  if (!ds.length && answer.length === 1) {
    return choiceEx(ctx, it, type === 'listen_bank' ? 'listen_choice' : 'choice_en_te', true, isNew);
  }
  const ex = { type, itemIds: [it.id], isNew };
  if (type === 'bank_en_te') ex.prompt = { en: it.en, register: it.register || 'neutral' };
  else ex.audio = it.id;
  ex.bank = shuffle([...answer, ...ds], ctx.rng);
  ex.accept = accepted;
  return ex;
}

function namesMap(unit) {
  const out = {};
  const toks = (unit.items || []).flatMap(it => [...(it.tokens || []), ...(it.units || [])]);
  for (const [te, en] of Object.entries(unit.names || {})) {
    const hit = toks.find(t => nfc(t.te) === nfc(te));
    out[String(en).toLowerCase()] = hit ? hit.rom : String(en).toLowerCase();
  }
  return out;
}

function numbered(list, prefix) {
  return list.map((ex, k) => ({ id: `${prefix}#${k}`, ...ex }));
}

const oddSeed = seed => ((Math.trunc(Number(seed) || 0) % 2) + 2) % 2 === 1;

// ---- forLesson ----------------------------------------------------------------------

export function forLesson(unit, lessonId, prior = [], opts = {}) {
  const rng = mulberry32(opts.seed ?? 0);
  const pool = (opts.pool || []).filter(Boolean);
  const byId = new Map();
  for (const it of [...pool, ...(unit.items || [])]) byId.set(it.id, it);
  const get = x => (typeof x === 'string' ? byId.get(x) : x);

  const lessons = unit.lessons || [];
  const at = lessons.findIndex(l => l.id === lessonId);
  if (at < 0) throw new Error(`exgen: no lesson ${lessonId} in ${unit.id}`);
  const lesson = lessons[at];
  const unitItem = new Map((unit.items || []).map(it => [it.id, it]));
  const news = (lesson.items || []).map(id => unitItem.get(id)).filter(Boolean);
  const practice = (lesson.practice || []).map(id => unitItem.get(id)).filter(Boolean);
  const priorItems = (prior || []).map(get).filter(Boolean);

  // Distractor candidates (S5): this unit's earlier lessons, this lesson's items
  // once introduced, and opts.pool.
  const introduced = new Map();
  for (const l of lessons.slice(0, at)) {
    for (const id of [...(l.items || []), ...(l.practice || [])]) {
      if (unitItem.has(id)) introduced.set(id, unitItem.get(id));
    }
  }
  for (const it of pool) if (!introduced.has(it.id)) introduced.set(it.id, it);
  const ctx = {
    rng,
    cands: () => [...introduced.values()],
    tileItems: () => [...introduced.values()].filter(it => unitItem.has(it.id)),
    known: () => [...introduced.values(), ...news, ...priorItems],
    names: namesMap(unit),
    loan: unit.loan || {},
    bankAvoid: unit.bank_avoid || [],
  };

  const out = [];
  const last = new Map();
  const index = new Map(news.map((it, i) => [it.id, i]));

  // 1. Blocks.
  for (const block of blocksOf(news)) {
    for (const it of block) {
      out.push({ type: 'intro', itemIds: [it.id], isNew: true, item: it });
      introduced.set(it.id, it);
    }
    const walk = boardFor(block, priorItems);
    if (walk.board) {
      out.push({ type: 'match', itemIds: walk.items.map(o => o.item.id), isNew: true,
                 pairs: walk.items.map(o => ({ t: T(o.item), en: o.item.en, fill: o.fill })) });
    }
    for (const it of block) {
      const t = index.get(it.id) % 3;
      out.push(choiceEx(ctx, it, CHOICE_ROT[t], false, true));
      last.set(it.id, t);
    }
    for (const it of block) {
      if (!walk.skipped.includes(it.id)) continue;
      const t = (last.get(it.id) + 1) % 3;
      out.push(choiceEx(ctx, it, CHOICE_ROT[t], false, true));
      last.set(it.id, t);
    }
  }

  // 2. Practice sentences.
  practice.forEach((s, k) => {
    const type = BANK_ROT[k % 3];
    out.push(type === 'bank_te_en' ? enBankEx(ctx, s, true) : teBankEx(ctx, s, type, true));
  });

  // 3. With p <= 1, one more choice per new item (listen_choice with Telugu choices).
  if (practice.length <= 1) {
    for (const it of news) {
      const t = (last.get(it.id) + 1) % 3;
      out.push(choiceEx(ctx, it, CHOICE_ROT[t], true, true));
      last.set(it.id, t);
    }
  }

  // 4. The weakest prior items.
  priorItems.slice(0, 2).forEach((it, k) => {
    const sent = it.kind === 'sentence';
    if (k === 0) out.push(sent ? enBankEx(ctx, it, false) : choiceEx(ctx, it, 'choice_en_te', true, false));
    else out.push(sent ? teBankEx(ctx, it, 'listen_bank', false) : choiceEx(ctx, it, 'listen_choice', true, false));
  });

  // 5. Typing.
  if (news.length) {
    const words = news.filter(it => it.kind === 'word');
    const target = words.length
      ? words[Math.floor(rng() * words.length)]
      : news.reduce((b, it) => (unitCount(it) < unitCount(b) ? it : b));
    const mode = opts.typing === 'keyboard' ? 'keyboard' : 'tiles';
    out.push(typeEx(ctx, target, oddSeed(opts.seed) ? 'listen_type' : 'typein', mode, true));
  }

  // 6. Speaking.
  if (opts.speak && news.length) {
    const phrases = news.filter(it => it.kind === 'phrase');
    const target = phrases.length
      ? phrases[Math.floor(rng() * phrases.length)]
      : news.reduce((b, it) => (unitCount(it) > unitCount(b) ? it : b));
    out.push({ type: 'speak', itemIds: [target.id], isNew: true, item: target });
  }

  return numbered(out, lessonId);
}

// ---- letters --------------------------------------------------------------------------

function letterResolver(opts) {
  const map = new Map();
  const src = opts.letters;
  if (Array.isArray(src)) src.forEach(l => map.set(l.id, l));
  else if (src && typeof src === 'object') for (const [k, l] of Object.entries(src)) map.set(k, l);
  return x => {
    if (x && typeof x === 'object') return x;
    if (typeof x !== 'string') return null;
    return map.get(x.startsWith('L:') ? x.slice(2) : x) || null;
  };
}

const isLetterObj = x => !!x && typeof x === 'object' && 'glyph' in x && !('kind' in x);
const letterClass = l => (l.type === 'vowel' || l.type === 'consonant' ? 'a'
  : l.type === 'cluster' ? 'c' : 'b');

function pickLetters(target, cands, rng) {
  const out = [], roms = new Set([nfc(target.rom)]);
  for (const c of cands) {
    if (out.length >= 3) break;
    const r = nfc(c.rom);
    if (c.id === target.id || roms.has(r)) continue;
    roms.add(r); out.push(c);
  }
  return out;
}

// One letter_sound / letter_name, or null when there is no possible distractor.
function letterChoice(target, type, taught, rng, isNew, confusable = false) {
  let cands;
  if (confusable) {
    if (!target.confusable) return null;
    cands = shuffle(taught.filter(l => l.id !== target.id && l.confusable === target.confusable), rng);
  } else {
    const cls = letterClass(target);
    cands = shuffle(taught.filter(l => l.id !== target.id && letterClass(l) === cls), rng);
    if (cls !== 'a' && cands.length < 3) {
      const ids = new Set(cands.map(l => l.id));
      cands = cands.concat(shuffle(taught.filter(l => l.type === 'consonant' && !ids.has(l.id)), rng));
    }
  }
  const ds = pickLetters(target, cands, rng);
  if (!ds.length) return null;
  const all = shuffle([target, ...ds], rng);
  const ex = { type, itemIds: ['L:' + target.id], isNew };
  if (type === 'letter_sound') {
    Object.assign(ex, { audio: target.id, choices: all.map(l => l.say), answer: all.indexOf(target), confusable });
  } else {
    Object.assign(ex, { say: target.say, choices: all.map(l => l.rom), answer: all.indexOf(target) });
  }
  return ex;
}

// Q3c-d S1: the parts of the answer come first (from the letters file when the learner has no
// card for them, e.g. a reader who opened a later letter lesson first), so the form list always
// holds the answer. Distractors come from taught letters (cards + this lesson), topped up from
// earlier letter lessons when there are too few.
function buildEx(syl, taught, extra, findGlyph, rank, built, rng) {
  const isMark = l => l.type === 'sign' || l.type === 'mark';
  const parts = syl.parts || {};
  const byGlyph = (list, g, ok) => list.find(l => ok(l) && nfc(l.glyph) === nfc(g));
  const ansC = parts.c ? (byGlyph(taught, parts.c, l => l.type === 'consonant')
    || byGlyph(extra, parts.c, l => l.type === 'consonant') || findGlyph(parts.c, l => l.type === 'consonant')) : null;
  const ansS = parts.s ? (byGlyph(taught, parts.s, isMark) || byGlyph(extra, parts.s, isMark)
    || findGlyph(parts.s, isMark)) : null;
  // SPECS S5: not generated until a sign or mark has been taught (this lesson, a card, or an earlier lesson).
  if (!ansC || !(taught.some(isMark) || extra.some(isMark))) return null;
  const newestFirst = list => list.slice().sort((x, y) => rank(y) - rank(x));
  const taughtMarks = newestFirst(taught.filter(isMark)).filter(m => m !== ansS);
  const extraMarks = newestFirst(extra.filter(isMark)).filter(m => m !== ansS && !taughtMarks.includes(m));
  const otherMarks = [...taughtMarks, ...extraMarks].slice(0, ansS ? 2 : 3);
  const marks = [...(ansS ? [ansS] : []), ...otherMarks].sort((x, y) => rank(x) - rank(y));
  if (!marks.length) return null;
  const tCons = shuffle(taught.filter(l => l.type === 'consonant' && l !== ansC), rng);
  const xCons = shuffle(extra.filter(l => l.type === 'consonant' && l !== ansC && !tCons.includes(l)), rng);
  const others = [...tCons, ...xCons].slice(0, 3);
  const chosenCons = [ansC, ...others];
  const forms = {};
  for (const c of chosenCons) {
    forms[c.glyph] = [{ te: c.say ?? c.glyph, rom: c.rom },
      ...marks.map(s => built && built[c.id] && built[c.id][s.id]).filter(Boolean)
        .map(b => ({ te: b.te, rom: b.rom }))];
  }
  const own = forms[ansC.glyph];
  if (!own.some(f => nfc(f.te) === nfc(syl.te))) own.push({ te: syl.te, rom: syl.rom });
  return { type: 'letter_build', itemIds: ['L:' + ansC.id, ...(ansS ? ['L:' + ansS.id] : [])], isNew: true,
           prompt: { audio: syl.te }, consonants: shuffle(chosenCons, rng).map(c => c.glyph),
           forms, answer: syl.te,
           syllable: { te: syl.te, rom: syl.rom, confidence: syl.confidence ?? null } };
}

/** S16 R3: a strokes.json entry is usable only when strokes is a non-empty list of polylines of at
 *  least 2 [number, number] points, and every ghost item passes the same test. */
const okPoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const okLine = l => Array.isArray(l) && l.length >= 2 && l.every(okPoint);
export function strokeEntryOk(e) {
  if (!e || typeof e !== 'object' || !Array.isArray(e.strokes) || !e.strokes.length || !e.strokes.every(okLine)) return false;
  if (e.ghost !== undefined && e.ghost !== null && !(Array.isArray(e.ghost) && e.ghost.every(okLine))) return false;
  return true;
}

function strokeTest(strokes) {
  if (!strokes) return () => false;
  if (strokes instanceof Set) return id => strokes.has(id);
  if (Array.isArray(strokes)) return id => strokes.includes(id);
  if (typeof strokes === 'object') {
    return id => {
      const e = Object.prototype.hasOwnProperty.call(strokes, id) ? strokes[id] : null;
      return strokeEntryOk(e);
    };
  }
  return () => false;
}

export function forLetters(lesson, known = [], opts = {}) {
  const rng = mulberry32(opts.seed ?? 0);
  const resolve = letterResolver(opts);
  const L = (lesson.letters || []).map(resolve).filter(Boolean);
  const lessonIds = new Set(L.map(l => l.id));
  const K = (known || []).map(resolve).filter(l => l && !lessonIds.has(l.id));
  const taught = [...K, ...L];
  const order = new Map();
  if (Array.isArray(opts.letters)) opts.letters.forEach((l, i) => order.set(l.id, i));
  else taught.forEach((l, i) => order.set(l.id, i));
  const rank = l => (order.has(l.id) ? order.get(l.id) : 1e9);

  const out = [];
  // S16: a `letter_draw` right after each new letter's intro, only for letters with stroke data
  // (opts.strokes: the `letters` map of strokes.json, or a Set / list of letter ids).
  const hasStrokes = strokeTest(opts.strokes);
  for (const l of L) {
    out.push({ type: 'letter_intro', itemIds: ['L:' + l.id], isNew: true, letter: l });
    if (hasStrokes(l.id)) out.push({ type: 'letter_draw', itemIds: ['L:' + l.id], isNew: true, letterId: l.id });
  }

  const drills = [];
  for (const l of L) {
    for (const type of ['letter_sound', 'letter_name']) {
      const ex = letterChoice(l, type, taught, rng, true);
      if (ex) drills.push(ex);
    }
  }
  out.push(...shuffle(drills, rng));

  // Earlier letter lessons (opts.lessons, the letters file's list): top-up distractors for a build.
  const lessons = Array.isArray(opts.lessons) ? opts.lessons : [];
  const at = lessons.findIndex(x => x.id === lesson.id);
  const taughtIds = new Set(taught.map(l => l.id));
  const extra = [];
  for (const ls of (at > 0 ? lessons.slice(0, at) : [])) {
    for (const l of (ls.letters || []).map(resolve)) if (l && !taughtIds.has(l.id)) { taughtIds.add(l.id); extra.push(l); }
  }
  const all = Array.isArray(opts.letters) ? opts.letters : Object.values(opts.letters || {});
  const findGlyph = (g, ok) => all.find(l => l && ok(l) && nfc(l.glyph) === nfc(g)) || null;
  for (const syl of (lesson.syllables || []).slice(0, 3)) {
    const ex = buildEx(syl, taught, extra, findGlyph, rank, opts.built, rng);
    if (ex) out.push(ex);
  }

  K.slice(0, 2).forEach((l, k) => {
    const ex = letterChoice(l, k === 0 ? 'letter_sound' : 'letter_name', taught, rng, false);
    if (ex) out.push(ex);
  });

  for (const l of L) {
    const ex = letterChoice(l, 'letter_sound', taught, rng, true, true);
    if (ex) out.push(ex);
  }
  return numbered(out, lesson.id);
}

// ---- forReview ----------------------------------------------------------------------------

export function forReview(items, pool = [], opts = {}) {
  const rng = mulberry32(opts.seed ?? 0);
  const resolve = letterResolver(opts);
  const entries = (items || []).map(x => (typeof x === 'string' && x.startsWith('L:') ? resolve(x) : x))
    .filter(Boolean);
  const all = [...(pool || []), ...entries].filter(Boolean)
    .map(x => (typeof x === 'string' && x.startsWith('L:') ? resolve(x) : x)).filter(x => x && typeof x === 'object');
  const itemMap = new Map(), letterMap = new Map();
  for (const x of all) (isLetterObj(x) ? letterMap : itemMap).set(x.id, x);
  const ctx = {
    rng,
    cands: () => [...itemMap.values()],
    tileItems: () => [...itemMap.values()],
    known: () => [...itemMap.values()],
    names: opts.names || {},
    loan: opts.loan || {},
    bankAvoid: opts.bank_avoid || [],
  };
  const letters = [...letterMap.values()];
  const mode = opts.typing === 'keyboard' ? 'keyboard' : 'tiles';
  const out = [];
  let w = 0, s = 0, l = 0;
  for (const it of entries) {
    if (typeof it !== 'object') continue;
    if (isLetterObj(it)) {
      const ex = letterChoice(it, l++ % 2 === 0 ? 'letter_sound' : 'letter_name', letters, rng, false);
      if (ex) out.push(ex);
    } else if (it.kind === 'sentence') {
      const k = s++ % 4;
      if (k === 0) out.push(enBankEx(ctx, it, false));
      else if (k === 3) out.push(typeEx(ctx, it, 'listen_type', mode, false));
      else out.push(teBankEx(ctx, it, BANK_ROT[k], false));
    } else {
      const k = w++ % 4;
      out.push(k === 3 ? typeEx(ctx, it, 'typein', mode, false) : choiceEx(ctx, it, CHOICE_ROT[k], true, false));
    }
  }
  return numbered(shuffle(out, rng), 'review');
}
