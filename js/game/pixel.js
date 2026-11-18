// game/pixel.js: small drawing helpers shared by sprites.js, fx.js and scenery.js. Off-screen
// canvases, soft additive glows (each colour's sprite is made once), colour mixing and a 5x7 pixel
// font for short English words and numbers on the canvas (never Telugu: that goes through teNode).
//
//   makeCanvas(w, h)                       an off-screen canvas (or null without a document)
//   drawGlow(c, x, y, r, colour, alpha)    a soft round light, added on top ('lighter')
//   mix(a, b, k)                           '#rrggbb' between a (k = 0) and b (k = 1)
//   textSprite(text, colours)              {cv, w, h} the text in pixels, outlined (cached)
//   drawText(c, text, x, y, scale, colours, alpha)   centred on (x, y)

export const snap = (v, p) => Math.round(v / p) * p;
export const hash = (a, b, s) => { let h = (a * 374761393 + b * 668265263 + s * 2147483647) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0); };

export function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return cv;
}

const rgb = hex => {
  const s = String(hex || '#000000').replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map(ch => ch + ch).join('') : s.slice(0, 6), 16) || 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
export function mix(a, b, k) {
  const A = rgb(a), B = rgb(b);
  const ch = i => Math.round(A[i] + (B[i] - A[i]) * k).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

const glows = new Map();
function glowSprite(colour) {
  let g = glows.get(colour);
  if (g !== undefined) return g;
  const S = 64;
  g = makeCanvas(S, S);
  if (g) {
    const x = g.getContext('2d');
    const [r, gg, b] = rgb(colour);
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    gr.addColorStop(0.22, `rgba(${r},${gg},${b},0.6)`);
    gr.addColorStop(0.55, `rgba(${r},${gg},${b},0.18)`);
    gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
  }
  glows.set(colour, g);
  return g;
}

export function drawGlow(c, x, y, r, colour, alpha) {
  if (!(alpha > 0.003) || !(r > 0)) return;
  const g = glowSprite(colour);
  if (!g) return;
  const op = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = Math.min(1, alpha);
  c.drawImage(g, x - r, y - r, r * 2, r * 2);
  c.globalAlpha = 1;
  c.globalCompositeOperation = op;
}

// ---- the pixel font (5 wide, 7 high) ----
const GLYPHS = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.', D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.', J: '..###...#....#....#....#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.', P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.', V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
  0: '.###.#...##..###.#.###..##...#.###.', 1: '..#...##....#....#....#....#...###.',
  2: '.###.#...#....#...#...#...#...#####', 3: '####.....#....#.###.....#....#####.',
  4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.',
  6: '.###.#....#....####.#...##...#.###.', 7: '#####....#...#...#...#....#....#...',
  8: '.###.#...##...#.###.#...##...#.###.', 9: '.###.#...##...#.####....#....#.###.',
  '!': '..#....#....#....#....#.........#..', '+': '.......#....#..#####..#....#.......',
  '-': '...............#####...............', x: '..........#...#.#.#...#...#.#.#...#',
  '.': '..............................##...', ' ': '...................................',
};

const texts = new Map();
/** colours: [top, middle, bottom, outline] */
export function textSprite(text, colours) {
  const key = text + '|' + colours.join(',');
  let s = texts.get(key);
  if (s) return s;
  const chars = [...String(text)];
  const w = chars.length * 6 + 1, h = 9;
  const cv = makeCanvas(w, h);
  s = { cv, w, h };
  if (cv) {
    const x = cv.getContext('2d');
    const [top, mid, bot, line] = colours;
    const on = [];
    chars.forEach((ch, i) => {
      const g = GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS[' '];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r * 5 + q] === '#') on.push([1 + i * 6 + q, 1 + r]);
    });
    x.fillStyle = line || '#1A1222';
    for (const [a, b] of on) x.fillRect(a - 1, b - 1, 3, 3);
    for (const [a, b] of on) {
      x.fillStyle = b <= 3 ? top : b <= 5 ? mid : bot;
      x.fillRect(a, b, 1, 1);
    }
  }
  if (texts.size > 60) texts.delete(texts.keys().next().value);
  texts.set(key, s);
  return s;
}

export function drawText(c, text, x, y, scale, colours, alpha = 1) {
  const s = textSprite(text, colours);
  if (!s.cv || !(alpha > 0.01)) return;
  const w = s.w * scale, h = s.h * scale;
  const sm = c.imageSmoothingEnabled;
  c.imageSmoothingEnabled = false;
  c.globalAlpha = Math.min(1, alpha);
  c.drawImage(s.cv, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h));
  c.globalAlpha = 1;
  c.imageSmoothingEnabled = sm;
}
