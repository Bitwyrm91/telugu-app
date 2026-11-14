// devtype.js: typography stress page, #/dev/type (task G3; SPECS S8, DESIGN 2-3).
// Every consonant with every vowel sign (plus ం ః and a final ్), the 40 S8 clusters,
// long words, te-stacks and mixed Telugu / romanization / English lines, in every text style.
// Strings and romanization come from devtype.json (written by tests/g3/gen_data.py from
// tools/translit.py), never typed here.

import { teNode } from './te.js';

// Text styles (DESIGN 3). `words`: false = this style shows syllables and clusters only
// (te-hero is the single-glyph style of the letter card and look-alike card).
const STYLES = [
  { id: 'hero', name: 'te-hero', spec: '4.5 rem (6 rem from 820 px), line height 1.5, weight 400', rom: 'dt-rom-xl', words: false },
  { id: 'xl', name: 'te-xl', spec: '2.25 rem, line height 1.7, weight 600', rom: 'dt-rom-xl', words: true },
  { id: 'xl-400', name: 'te-xl, letter grid', spec: '2.25 rem, line height 1.7, weight 400', rom: 'dt-rom-xl', words: true },
  { id: 'lg', name: 'te-lg', spec: '1.75 rem, line height 1.7, weight 400', rom: 'dt-rom-lg', words: true },
  { id: 'md', name: 'te-md', spec: '1.375 rem, line height 1.7, weight 400', rom: '', words: true },
  { id: 'md-600', name: 'te-md, emphasised', spec: '1.375 rem, line height 1.7, weight 600', rom: '', words: true },
  { id: 'sm', name: 'te-sm', spec: '1.3125 rem, line height 1.65, weight 400', rom: '', words: true },
];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids);
  return n;
}

function te(text, style, tag = 'span') {
  return teNode(text, { tag, class: `dt-${style.id}` });
}

function rom(text, style, tag = 'span') {
  return el(tag, { class: `rom ${style.rom}`.trim() }, text);
}

function card(title, ...kids) {
  return el('div', { class: 'dt-card', 'data-card': true },
    el('h3', { class: 'dt-h3' }, title), ...kids);
}

function syllableCard(title, cells, style) {
  const grid = el('div', { class: 'dt-grid' });
  for (const c of cells) {
    grid.append(el('div', { class: 'dt-cell' }, te(c.te, style), rom(c.rom, style)));
  }
  return card(title, grid);
}

function stack(item, style) {
  return el('div', { class: 'dt-stack' },
    te(item.te, style, 'p'), rom(item.rom, style, 'p'), el('p', { class: 'en' }, item.en));
}

function inlineLine(segs, style) {
  const p = el('p', { class: 'dt-line' });
  for (const s of segs) {
    if (s.te !== undefined) {
      p.append(te(s.te, style));
      if (s.rom) p.append(' (', rom(s.rom, style), ')');
    } else {
      p.append(s.en);
    }
  }
  return p;
}

function section(style, data) {
  const sec = el('section', { class: `dt-section dt-cells-${style.id}`, 'data-style': style.id, 'aria-labelledby': `dt-${style.id}` },
    el('h2', { class: 'dt-h2', id: `dt-${style.id}` }, style.name),
    el('p', { class: 'dt-spec' }, style.spec));
  for (const row of data.grid) {
    sec.append(syllableCard(`${row.cells[0].rom}: every vowel sign, ṁ, ḥ, final virama`, row.cells, style));
  }
  sec.append(syllableCard('The 40 clusters (SPECS S8)', data.clusters, style));
  if (style.words) {
    sec.append(card('Long words', ...data.long.map(w => stack(w, style))));
    sec.append(card('Script, romanization, English', ...data.stacks.map(s => stack(s, style))));
    sec.append(card('Mixed lines', ...data.inline.map(l => inlineLine(l, style))));
  }
  return sec;
}

export async function render(main) {
  const res = await fetch(new URL('./devtype.json', import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`devtype.json: ${res.status}`);
  const data = await res.json();
  const page = el('div', { class: 'dt' },
    el('h1', { class: 'screen-title' }, 'Typography stress test'),
    el('p', { class: 'dt-intro' },
      'Every consonant with every vowel sign, the 40 test clusters, long words and mixed lines, ',
      'in each Telugu text style. For checking shaping and clipping; not part of the course.'));
  for (const style of STYLES) page.append(section(style, data));
  main.append(page);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
}
