// write/rivals.js: look-alike letters for the shape grader's rival check (SPECS S17 "Grader").
//   rivalIds(id, letters) -> [id]   letters sharing a `confusable` group, plus the hand list below.

export const LOOK = [['na', 'sa'], ['ma', 'ya'], ['ra', 'ttha'], ['pa', 'va'], ['pa', 'ssa'], ['pa', 'pha'], ['va', 'ssa'],
  ['ba', 'bha'], ['ba', 'ja'], ['tha', 'dha'], ['cha', 'chha'], ['da', 'dda'], ['dda', 'ddha'], ['a', 'aa'], ['i', 'ii'],
  ['u', 'uu'], ['e', 'ee'], ['o', 'oo'], ['ka', 'pha'], ['ga', 'gha'], ['ta', 'tta'], ['tta', 'ttha'], ['la', 'lla'],
  ['ha', 'ma'], ['nga', 'ya'], ['sha', 'ssa'], ['ja', 'jha'], ['nya', 'ma'], ['sign-i', 'sign-ii'], ['sign-u', 'sign-uu'],
  ['sign-e', 'sign-ee'], ['sign-o', 'sign-oo'], ['sa', 'ha'], ['va', 'na'], ['ra', 'na'], ['a', 'ma']];

export function rivalIds(id, letters = []) {
  const out = new Set();
  for (const [a, b] of LOOK) { if (a === id) out.add(b); if (b === id) out.add(a); }
  const me = letters.find(l => l.id === id);
  if (me && me.confusable) for (const l of letters) if (l.id !== id && l.confusable === me.confusable) out.add(l.id);
  return [...out].filter(x => letters.length === 0 || letters.some(l => l.id === x));
}
