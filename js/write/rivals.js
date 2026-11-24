// write/rivals.js: look-alike letters for the shape grader's rival check (SPECS S17 "Grader").
//   rivalIds(id, letters) -> [id]   letters sharing a `confusable` group, plus the hand list below.

export const LOOK = [['na', 'sa'], ['ma', 'ya'], ['ra', 'ttha'], ['pa', 'va'], ['pa', 'ssa'], ['pa', 'pha'], ['va', 'ssa'],
  ['ba', 'bha'], ['ba', 'ja'], ['tha', 'dha'], ['cha', 'chha'], ['da', 'dda'], ['dda', 'ddha'], ['a', 'aa'], ['i', 'ii'],
  ['u', 'uu'], ['e', 'ee'], ['o', 'oo'], ['ka', 'pha'], ['ga', 'gha'], ['ta', 'tta'], ['tta', 'ttha'], ['la', 'lla'],
  ['ha', 'ma'], ['nga', 'ya'], ['sha', 'ssa'], ['ja', 'jha'], ['nya', 'ma'], ['sign-i', 'sign-ii'], ['sign-u', 'sign-uu'],
  ['sign-e', 'sign-ee'], ['sign-o', 'sign-oo'], ['sa', 'ha'], ['va', 'na'], ['ra', 'na'], ['a', 'ma']];

/** Look-alikes of a written syllable (a word's akshara): the same text with its first letter, or one of its
 *  vowel signs, swapped for a look-alike (rivalIds). letters: letters.json letters. -> [text] */
export function syllableRivals(text, letters = []) {
  const cps = [...String(text || '')];
  if (!cps.length || !letters.length) return [];
  const byGlyph = new Map(letters.filter(l => l.glyph && [...l.glyph].length === 1).map(l => [l.glyph, l]));
  const glyphOf = new Map(letters.map(l => [l.id, l.glyph]));
  const out = new Set();
  cps.forEach((ch, i) => {
    const l = byGlyph.get(ch);
    if (!l || (i > 0 && l.type !== 'sign') || (i === 0 && l.type === 'sign')) return;
    // the first letter only (a conjunct's second letter is written small, below); signs anywhere
    if (i > 0 && cps[i - 1] === '్') return;
    for (const r of rivalIds(l.id, letters)) {
      const g = glyphOf.get(r);
      if (g && [...g].length === 1) out.add(cps.map((c, j) => (j === i ? g : c)).join(''));
    }
  });
  out.delete(text);
  return [...out];
}

export function rivalIds(id, letters = []) {
  const out = new Set();
  for (const [a, b] of LOOK) { if (a === id) out.add(b); if (b === id) out.add(a); }
  const me = letters.find(l => l.id === id);
  if (me && me.confusable) for (const l of letters) if (l.id !== id && l.confusable === me.confusable) out.add(l.id);
  return [...out].filter(x => letters.length === 0 || letters.some(l => l.id === x));
}
