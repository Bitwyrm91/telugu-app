// Syllable units and the unit diff (SPECS S2). `split` mirrors tools/aksharas.py.

const VIRAMA = '్';
const ZWNJ = '‌';
const MARKS = new Set(['ం', 'ః']); // ం ః

function isConsonant(ch) {
  const o = ch.codePointAt(0);
  return (o >= 0x0C15 && o <= 0x0C39) || (o >= 0x0C58 && o <= 0x0C5A) || o === 0x0C5D;
}

function isVowel(ch) {
  const o = ch.codePointAt(0);
  return (o >= 0x0C05 && o <= 0x0C14) || o === 0x0C60 || o === 0x0C61;
}

function isSign(ch) {
  const o = ch.codePointAt(0);
  return (o >= 0x0C3E && o <= 0x0C4C) || o === 0x0C55 || o === 0x0C56 || o === 0x0C62 || o === 0x0C63;
}

// Step 1: cut into pieces.
function pieces(te) {
  const s = Array.from(te);
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    let j = i + 1;
    if (isConsonant(ch)) {
      while (j + 1 < n && s[j] === VIRAMA && isConsonant(s[j + 1])) j += 2;
      if (j < n && (isSign(s[j]) || s[j] === VIRAMA)) j += 1;
      if (j < n && MARKS.has(s[j])) j += 1;
    } else if (isVowel(ch)) {
      if (j < n && MARKS.has(s[j])) j += 1;
    }
    out.push(s.slice(i, j).join(''));
    i = j;
  }
  return out;
}

// Step 2: join ZWNJ and virama-final pieces onto the unit before them.
export function split(te) {
  const units = [];
  for (const p of pieces(te)) {
    const last = units.length ? units[units.length - 1] : null;
    if (last !== null && p === ZWNJ) {
      units[units.length - 1] = last + p;
    } else if (last !== null && p.endsWith(VIRAMA) &&
               (isConsonant(last[0]) || isVowel(last[0]))) {
      units[units.length - 1] = last + p;
    } else {
      units.push(p);
    }
  }
  return units;
}

// Cut one unit (ZWNJ removed) into {consonants, vowel, mark, tail}.
function partsOf(unit) {
  const s = Array.from(unit.split(ZWNJ).join(''));
  const n = s.length;
  let i = 0;
  let consonants = '', vowel = '', mark = '';
  if (n && isConsonant(s[0])) {
    i = 1;
    while (i + 1 < n && s[i] === VIRAMA && isConsonant(s[i + 1])) i += 2;
    consonants = s.slice(0, i).join('');
    if (i < n && isSign(s[i])) vowel = s[i++];
  } else if (n && isVowel(s[0])) {
    vowel = s[i++];
  }
  if ((consonants || vowel) && i < n && MARKS.has(s[i])) mark = s[i++];
  return { consonants, vowel, mark, tail: s.slice(i).join('') };
}

function partFor(exp, got) {
  const a = partsOf(exp), b = partsOf(got);
  const differ = ['consonants', 'vowel', 'mark', 'tail'].filter(k => a[k] !== b[k]);
  if (differ.length === 1) {
    if (differ[0] === 'vowel') return 'vowel';
    if (differ[0] === 'consonants') return 'consonant';
    if (differ[0] === 'mark') return 'nasal';
  }
  return 'whole';
}

// Costs are pairs [total, missing + extra], compared in that order.
function add(c, total, gaps) { return [c[0] + total, c[1] + gaps]; }
function less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }
function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }

export function diff(expected, given) {
  const E = split(expected), G = split(given);
  const m = E.length, n = G.length;
  const cost = Array.from({ length: m + 1 }, () => new Array(n + 1));
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
  const out = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    const here = cost[i][j];
    if (i < m && j < n && same(add(cost[i + 1][j + 1], E[i] === G[j] ? 0 : 1, 0), here)) {
      if (E[i] === G[j]) out.push({ exp: E[i], got: G[j], status: 'ok', part: null });
      else out.push({ exp: E[i], got: G[j], status: 'wrong', part: partFor(E[i], G[j]) });
      i++; j++;
    } else if (i < m && same(add(cost[i + 1][j], 1, 1), here)) {
      out.push({ exp: E[i], got: null, status: 'missing', part: null });
      i++;
    } else {
      out.push({ exp: null, got: G[j], status: 'extra', part: null });
      j++;
    }
  }
  return out;
}
