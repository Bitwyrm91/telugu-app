// Grading (SPECS S6). Pure: no DOM, no storage.
// check(exercise, answer, settings) -> {correct, close, skipped, expected, diff, perItem, message, typed}
// orders(item) -> accepted token lists for a Telugu bank (S6 "Word order").

import { diff as unitDiff } from './aksharas.js';

const TELUGU = /[ఀ-౿]/;
const ZWNJ = '‌';

function base() {
  return { correct: false, close: false, skipped: false, expected: null, diff: null,
           perItem: null, message: null, typed: null };
}

// ---- English ----------------------------------------------------------------

const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "he's": 'he is', "she's": 'she is', "it's": 'it is',
  "we're": 'we are', "they're": 'they are', "don't": 'do not', "doesn't": 'does not',
  "didn't": 'did not', "isn't": 'is not', "aren't": 'are not', "can't": 'can not',
  'cannot': 'can not', "won't": 'will not', "what's": 'what is', "that's": 'that is',
  "there's": 'there is', "i'll": 'i will',
};
const ARTICLES = new Set(['a', 'an', 'the']);

export function normEnglish(s) {
  let t = String(s).toLowerCase().replace(/’/g, "'");
  t = t.replace(/\([^)]*\)/g, ' ');
  t = t.replace(/[.,!?"]/g, '').replace(/-/g, ' ');
  const toks = [];
  for (const w of t.split(/\s+/).filter(Boolean)) {
    for (const x of (CONTRACTIONS[w] || w).split(' ')) toks.push(x);
  }
  return toks.map(w => w.replace(/'/g, '')).filter(w => w && !ARTICLES.has(w)).join(' ');
}

function checkEnglish(accept, text) {
  const r = base();
  const given = normEnglish(text);
  r.expected = accept[0] ?? null;
  r.correct = accept.some(a => normEnglish(a) === given);
  return r;
}

// ---- Telugu script ----------------------------------------------------------

export function treatTelugu(s) {
  return String(s).normalize('NFC')
    .split(ZWNJ).join('')
    .replace(/[.,?!\-]/g, '')
    .replace(/\s+/g, ' ').trim()
    .split('ళ్ల').join('ళ్ళ')
    .split('ఱ').join('ర')
    .replace(/ండీ(?= |$)/g, 'ండి');
}

function diffCost(d) {
  let total = 0, gaps = 0;
  for (const x of d) {
    if (x.status !== 'ok') total++;
    if (x.status === 'missing' || x.status === 'extra') gaps++;
  }
  return [total, gaps];
}

// accept: [{te, value}] where value is what `expected` reports.
function checkTelugu(accept, text) {
  const r = base();
  const given = treatTelugu(text);
  if (accept.some(a => treatTelugu(a.te) === given)) {
    r.correct = true;
    r.expected = accept[0].value;
    return r;
  }
  // Wrong: the learner is shown the item's main form, and the diff is against it (never an alternate).
  if (accept.length) { r.expected = accept[0].value; r.diff = unitDiff(treatTelugu(accept[0].te), given); }
  return r;
}

// ---- Latin input ------------------------------------------------------------

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const LONG = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };
const CAPS = { T: 'ṭ', D: 'ḍ', N: 'ṇ', L: 'ḷ', S: 'ṣ', R: 'ṛ', M: 'ṁ', H: 'ḥ' };
const STOP_NASAL = { k: 'ṅ', g: 'ṅ', c: 'ñ', j: 'ñ', 'ṭ': 'ṇ', 'ḍ': 'ṇ', t: 'n', d: 'n', p: 'm', b: 'm' };
const NASALS = new Set(['ṅ', 'ñ', 'ṇ', 'n', 'm', 'ṁ']);

// Step 0 (without names and loans).
function clean(s) {
  return String(s).normalize('NFC').replace(/[.,?!\-'"]/g, '').replace(/\s+/g, ' ').trim();
}

// Step 1: one word. `habit` = the English-habit reading of step 5.
function readWord(w, habit) {
  const ch = Array.from(w);
  let out = '';
  for (let i = 0; i < ch.length;) {
    const c = ch[i], nx = ch[i + 1];
    if (c === 'ṃ') { out += 'ṁ'; i++; }
    else if (LONG[c] && nx === c) {
      out += habit && c === 'e' ? 'ī' : habit && c === 'o' ? 'ū' : LONG[c];
      i += 2;
    }
    else if ((c === 'T' || c === 'D') && nx === 'h') { out += CAPS[c] + 'h'; i += 2; }
    else if (c === 's' && nx === 'h') { out += 'ś'; i += 2; }
    else if (c === 'j' && nx === 'n') { out += 'jñ'; i += 2; }
    else if (CAPS[c]) { out += CAPS[c]; i++; }
    else if (c === 'w') { out += 'v'; i++; }
    else if (c === 'f') { out += 'ph'; i++; }
    else if (c === 'z') { out += 'j'; i++; }
    else if (c === 'c' && nx !== 'h') { out += 'ch'; i++; }
    else if (c === 'h' && VOWELS.has(ch[i - 1]) && (nx === 'k' || nx === 'p')) { out += 'ḥ'; i++; }
    else { out += c.toLowerCase(); i++; }
  }
  return out;
}

// words: [{text, rom: bool}]; substituted names and loans are already romanization.
function read(words, habit) {
  return words.map(w => (w.rom ? w.text : readWord(w.text, habit))).join(' ');
}

// Step 2.
export function canonical(s) {
  const a = Array.from(s.replace(/ṣ/g, 'ś').replace(/ṟ/g, 'r'));
  for (let i = 0; i < a.length - 1; i++) {
    if (NASALS.has(a[i]) && STOP_NASAL[a[i + 1]]) a[i] = STOP_NASAL[a[i + 1]];
  }
  return a.join('').replace(/ṁ/g, 'm');
}

export function fold(s) {
  return s.replace(/[āīūēō]/g, m => ({ ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' })[m])
    .replace(/ṭ/g, 't').replace(/ḍ/g, 'd').replace(/ḷ/g, 'l')
    .replace(/[ṇñṅ]/g, 'n').replace(/ś/g, 's').replace(/ḥ/g, '')
    .replace(/chh/g, 'ch')
    .replace(/([kgjtdpb])h/g, '$1')
    .replace(/m(?=[kgcjtdpb])/g, 'n');
}

// ṛ may also be ri or ru; jñ may also be gn or gy (step 4).
function variants(s) {
  let out = [s];
  const swap = (from, tos) => {
    const next = [];
    for (const v of out) {
      const parts = v.split(from);
      let acc = [parts[0]];
      for (let k = 1; k < parts.length; k++) {
        const grown = [];
        for (const pre of acc) for (const to of tos) grown.push(pre + to + parts[k]);
        acc = grown;
      }
      next.push(...acc);
    }
    out = next;
  };
  swap('ṛ', ['ṛ', 'ri', 'ru']);
  swap('jñ', ['jñ', 'gn', 'gy']);
  return out;
}

const nospace = s => s.replace(/ /g, '');

// Step 3-5 for one reading against one accepted answer: 2 correct, 1 close, 0 wrong.
function gradeReading(reading, habitReading, acc) {
  const inCan = canonical(reading);
  if (inCan === acc.can) return { grade: 2, message: null };
  if (nospace(inCan) === nospace(acc.can)) return { grade: 1, message: 'spaces' };
  if (acc.folds.has(fold(nospace(inCan)))) return { grade: 1, message: null };
  const hCan = nospace(canonical(habitReading));
  if (hCan === nospace(acc.can) || acc.folds.has(fold(hCan))) return { grade: 1, message: null };
  return { grade: 0, message: null };
}

const isSpaceOrPunct = te => /^[\s.,?!\-‌]*$/.test(te);
const nasalToN = s => {
  const a = Array.from(s);
  for (let i = 0; i < a.length - 1; i++) if (NASALS.has(a[i]) && STOP_NASAL[a[i + 1]]) a[i] = 'n';
  return a;
};

// Character alignment by the S2 method; returns ops [{op, i, j}].
function align(E, G) {
  const m = E.length, n = G.length;
  const cost = Array.from({ length: m + 1 }, () => new Array(n + 1));
  const add = (c, t, g) => [c[0] + t, c[1] + g];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  for (let i = m; i >= 0; i--) {
    for (let j = n; j >= 0; j--) {
      if (i === m && j === n) { cost[i][j] = [0, 0]; continue; }
      let best = null;
      const take = c => { if (best === null || less(c, best)) best = c; };
      if (i < m && j < n) take(add(cost[i + 1][j + 1], E[i] === G[j] ? 0 : 1, 0));
      if (i < m) take(add(cost[i + 1][j], 1, 1));
      if (j < n) take(add(cost[i][j + 1], 1, 1));
      cost[i][j] = best;
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    const here = cost[i][j];
    if (i < m && j < n && same(add(cost[i + 1][j + 1], E[i] === G[j] ? 0 : 1, 0), here)) {
      ops.push({ op: E[i] === G[j] ? 'ok' : 'wrong', i, j }); i++; j++;
    } else if (i < m && same(add(cost[i + 1][j], 1, 1), here)) {
      ops.push({ op: 'missing', i, j }); i++;
    } else {
      ops.push({ op: 'extra', i, j }); j++;
    }
  }
  return { ops, cost: cost[0][0] };
}

// Step 8.
function latinDiff(acc, reading) {
  const units = (acc.units || []).filter(u => !isSpaceOrPunct(u.te));
  const owner = [];
  let joined = '';
  units.forEach((u, k) => {
    const r = Array.from(String(u.rom).normalize('NFC'));
    for (let c = 0; c < r.length; c++) owner.push(k);
    joined += r.join('');
  });
  const E = nasalToN(canonical(joined));
  const G = nasalToN(nospace(canonical(reading)));
  const { ops, cost } = align(E, G);
  const marked = units.map(() => false);
  for (const o of ops) {
    if (o.op === 'ok') continue;
    if (!units.length) break;
    const k = o.op === 'extra' ? (o.i < E.length ? owner[o.i] : units.length - 1) : owner[o.i];
    marked[k] = true;
  }
  return { diff: units.map((u, k) => ({ unit: u, marked: marked[k] })), cost,
           marks: marked.filter(Boolean).length };
}

function checkLatin(ex, text, settings) {
  const r = base();
  const accept = (ex.accept || []).map(a => {
    const can = canonical(clean(a.rom));
    const folds = new Set(variants(nospace(can)).map(fold));
    return { a, can, folds, units: a.units };
  });
  const names = lowerKeys(ex.names), loan = lowerKeys(ex.loan);
  const cleaned = clean(text);

  // Step 6 versions of the cleaned input.
  const words = cleaned ? cleaned.split(' ') : [];
  const lowFirst = w => (w ? w[0].toLowerCase() + w.slice(1) : w);
  const versions = [
    words,
    words.map(lowFirst),
    words.map((w, k) => (k === 0 ? lowFirst(w) : w)),
  ];
  if (!/\p{Ll}/u.test(cleaned)) versions.push(words.map(w => w.toLowerCase()));

  let loanUsed = false;
  const substitute = ws => ws.map(w => {
    const key = w.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(names, key)) return { text: String(names[key]).normalize('NFC'), rom: true };
    if (Object.prototype.hasOwnProperty.call(loan, key)) { loanUsed = true; return { text: String(loan[key]).normalize('NFC'), rom: true }; }
    return { text: w, rom: false };
  });

  let best = null;
  versions.forEach((v, vi) => {
    const ws = substitute(v);
    const reading = read(ws, false), habit = read(ws, true);
    accept.forEach((acc, ai) => {
      const g = gradeReading(reading, habit, acc);
      const cand = { g, acc, ai, vi, reading };
      if (g.grade < 2) Object.assign(cand, latinDiff(acc, reading));
      else Object.assign(cand, { marks: 0, cost: [0, 0] });
      if (!best || better(cand, best)) best = cand;
    });
  });
  if (!best) return r;

  let grade = best.g.grade;
  let message = best.g.message;
  let d = best.diff || null;
  if (grade === 2 && loanUsed) {
    grade = 1; message = 'respell';
    d = latinDiff(best.acc, best.reading).diff.map(x => ({ unit: x.unit, marked: false }));
  }
  // Q3c minor 4: Strict turns a near miss wrong and says why; the diff is against the main form,
  // read from what was typed (a loan word is not swapped for its romanization here).
  let strictMiss = false;
  if (grade === 1 && settings && settings.strict) {
    grade = 0; strictMiss = true; message = 'strict';
    if (loanUsed) best = { ...best, ai: -1, reading: read(versions[best.vi].map(w => ({ text: w, rom: false })), false) };
  }
  const unmarked = message === 'spaces' || message === 'respell';
  if (unmarked) d = d && d.map(x => ({ unit: x.unit, marked: false }));
  if (grade === 0 && message === 'spaces') message = null;
  if (strictMiss) best.ai = -1; // always diff against accept[0] below

  r.correct = grade >= 1;
  r.close = grade === 1;
  r.message = message;
  if (grade === 2) { r.expected = ex.accept[0]; r.diff = null; }
  else if (grade === 1) { r.expected = best.acc.a; r.diff = d; } // close: the nearest accepted form
  else {
    // Wrong: the item's main form, with the diff against it (never the nearest alternate).
    r.expected = ex.accept[0];
    if (best.ai !== 0) d = latinDiff(accept[0], best.reading).diff;
    r.diff = d;
  }
  return r;
}

function better(a, b) {
  if (a.g.grade !== b.g.grade) return a.g.grade > b.g.grade;
  // Close: when the main form (accept[0]) is itself close, it is the one shown (Q3b S4).
  if (a.g.grade === 1 && (a.ai === 0) !== (b.ai === 0)) return a.ai === 0;
  if (a.marks !== b.marks) return a.marks < b.marks;
  if (a.cost[0] !== b.cost[0]) return a.cost[0] < b.cost[0];
  if (a.cost[1] !== b.cost[1]) return a.cost[1] < b.cost[1];
  return false; // ties: the earlier version, then the earlier accepted answer
}

function lowerKeys(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) out[k.toLowerCase()] = v;
  return out;
}

// ---- Word order (banks) -------------------------------------------------------

export function tokens(te) {
  return String(te).normalize('NFC').replace(/[.,?!]/g, '').split(/\s+/).filter(Boolean);
}

function permutations(list) {
  if (list.length <= 1) return [list.slice()];
  const out = [];
  list.forEach((x, k) => {
    for (const rest of permutations(list.filter((_, q) => q !== k))) out.push([x, ...rest]);
  });
  return out;
}

// Accepted orders of a bank item, as token lists: te, each te_alt, and (unless
// order is 'fixed') every order of the chunks keeping the last chunk last, minus order_deny.
export function orders(item) {
  const seen = new Set();
  const out = [];
  const push = te => {
    const t = tokens(te);
    const key = t.join(' ');
    if (!t.length || seen.has(key)) return;
    seen.add(key); out.push(t);
  };
  push(item.te);
  for (const alt of item.te_alt || []) push(alt);
  const chunks = item.chunks || [];
  if (item.order !== 'fixed' && chunks.length >= 2) {
    const deny = new Set((item.order_deny || []).map(d => tokens(d).join(' ')));
    const last = chunks[chunks.length - 1];
    for (const p of permutations(chunks.slice(0, -1))) {
      const te = [...p, last].join(' ');
      if (!deny.has(tokens(te).join(' '))) push(te);
    }
  }
  return out;
}

// ---- check ------------------------------------------------------------------------

const CHOICE = new Set(['choice_te_en', 'choice_en_te', 'listen_choice', 'letter_sound', 'letter_name']);

function isSkip(ex, answer) {
  if (answer && typeof answer === 'object' && answer.skip === true) return true;
  return ex.type === 'speak' && answer === 'skip';
}

function asText(answer) {
  return Array.isArray(answer) ? answer.join(' ') : String(answer ?? '');
}

export function check(exercise, answer, settings = {}) {
  const ex = exercise || {};
  if (isSkip(ex, answer)) { const r = base(); r.skipped = true; return r; }
  const type = ex.type;

  if (CHOICE.has(type)) {
    const r = base();
    r.expected = ex.answer;
    r.correct = answer === ex.answer;
    return r;
  }
  if (type === 'letter_build') {
    const r = base();
    r.expected = ex.answer;
    const syl = answer && answer.syllable;
    r.correct = typeof syl === 'string' && syl.normalize('NFC') === String(ex.answer).normalize('NFC');
    return r;
  }
  if (type === 'match') {
    const r = base();
    const misses = (answer && answer.misses) || {};
    const missed = new Set(Object.keys(misses).filter(k => misses[k] > 0));
    r.correct = missed.size === 0;
    r.perItem = {};
    for (const p of ex.pairs || []) {
      const id = p.t && p.t.itemId;
      if (id) r.perItem[id] = missed.has(id) ? 'wrong' : 'correct';
    }
    for (const id of missed) r.perItem[id] = 'wrong';
    return r;
  }
  if (type === 'speak') {
    const r = base();
    r.correct = answer === 'good';
    return r;
  }
  if (type === 'bank_te_en') return checkEnglish(ex.accept || [], asText(answer));
  if (type === 'bank_en_te' || type === 'listen_bank') {
    const accept = (ex.accept || []).map(t => ({ te: Array.isArray(t) ? t.join(' ') : String(t), value: t }));
    return checkTelugu(accept, asText(answer));
  }
  if (type === 'typein' || type === 'listen_type') {
    const text = String(answer ?? '');
    const r = TELUGU.test(text)
      ? checkTelugu((ex.accept || []).map(a => ({ te: a.te, value: a })), text)
      : checkLatin(ex, text, settings);
    r.typed = text.trim();
    return r;
  }
  // intro, letter_intro: not graded.
  const r = base();
  r.correct = true;
  return r;
}
