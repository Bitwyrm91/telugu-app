// te.js: the one way screens write Telugu into the page (DESIGN 3).
//
// teNode(text, opts) -> element with class `te`, lang="te", holding the text as ONE unbroken
//   run (so shaping, kerning included, is whole). data-long is set when a word has more than
//   LONG_SYLLABLES syllables (one step down the scale).
// fitTe(root = document): a word still wider than its container's content box (the nearest
//   [data-card], else the parent) is re-rendered with a <wbr> between its syllables (cut with
//   aksharas.split; never inside a syllable, never at a space or punctuation) and the node gets
//   data-long; a broken word that would now fit unbroken is restored. Measure all, then write.
//   Idempotent: a second call with nothing changed writes nothing.
// teNode schedules a fit for its own node once attached (after document.fonts.ready, on the
// next animation frame); one debounced window resize listener refits everything.

import { split } from '../aksharas.js';

export const LONG_SYLLABLES = 9;

const TELUGU = /[ఀ-౿]/;
const BREAK_AFTER = /[ఀ-౿‌]/; // a syllable may end in ZWNJ (రాజ్‌|కు)
const WORD = /\S+/g;

const info = new WeakMap(); // node -> {text, long, broken: Set<word index>}

/** The pieces of one word that a <wbr> goes between (joined, they equal the word). */
export function syllablePieces(word) {
  const out = [];
  for (const u of split(word)) {
    const last = out.length ? out[out.length - 1] : null;
    if (last !== null && BREAK_AFTER.test(last.slice(-1)) && TELUGU.test(u[0])) out.push(u);
    else if (last !== null) out[out.length - 1] = last + u;
    else out.push(u);
  }
  return out;
}

function syllableCount(word) {
  return split(word).filter(u => TELUGU.test(u)).length;
}

function words(text) {
  return [...text.matchAll(WORD)].map(m => ({ w: m[0], start: m.index, end: m.index + m[0].length }));
}

export function teNode(text, opts = {}) {
  const n = document.createElement(opts.tag || 'span');
  n.className = opts.class ? `te ${opts.class}` : 'te';
  n.setAttribute('lang', 'te');
  n.setAttribute('data-te', '');
  text = String(text);
  const long = words(text).some(x => syllableCount(x.w) > LONG_SYLLABLES);
  if (long) n.setAttribute('data-long', '');
  n.textContent = text;
  info.set(n, { text, long, broken: new Set() });
  schedule(n);
  return n;
}

// ---- fitting ----------------------------------------------------------------------------------

function available(node) {
  const box = node.closest('[data-card]') || node.parentElement;
  if (!box) return Infinity;
  const cs = getComputedStyle(box);
  return box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

function render(node, st, broken) {
  if (!broken.size) {
    node.textContent = st.text;
  } else {
    const frag = document.createDocumentFragment();
    let at = 0;
    words(st.text).forEach((x, i) => {
      if (!broken.has(i)) return;
      frag.append(st.text.slice(at, x.start));
      syllablePieces(x.w).forEach((p, k) => {
        if (k) frag.append(document.createElement('wbr'));
        frag.append(p);
      });
      at = x.end;
    });
    frag.append(st.text.slice(at));
    node.replaceChildren(frag);
  }
  if (broken.size || st.long) node.setAttribute('data-long', '');
  else node.removeAttribute('data-long');
  st.broken = broken;
}

export function fitTe(root = document) {
  const nodes = [];
  if (root.nodeType === 1 && root.hasAttribute('data-te')) nodes.push(root);
  if (root.querySelectorAll) nodes.push(...root.querySelectorAll('[data-te]'));
  const jobs = [];
  const probes = [];
  // Build: broken nodes are measured unbroken through a hidden twin (no data-long unless its own).
  for (const node of nodes) {
    const st = info.get(node);
    if (!st || !node.isConnected) continue;
    const job = { node, st, ws: words(st.text), twin: null };
    if (st.broken.size) {
      const twin = node.cloneNode(false);
      twin.removeAttribute('data-te');
      if (!st.long) twin.removeAttribute('data-long');
      twin.textContent = st.text;
      twin.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:0;top:0;';
      node.after(twin);
      job.twin = twin;
      probes.push(twin);
    }
    jobs.push(job);
  }
  // Measure all.
  for (const job of jobs) {
    const src = job.twin || job.node;
    const tn = src.firstChild;
    const avail = available(job.node);
    job.want = new Set();
    if (!tn || tn.nodeType !== 3) continue;
    const r = document.createRange();
    job.ws.forEach((x, i) => {
      if (x.w.length < 2 || !TELUGU.test(x.w)) return;
      r.setStart(tn, x.start);
      r.setEnd(tn, x.end);
      if (r.getBoundingClientRect().width > avail + 0.5 && syllablePieces(x.w).length > 1) job.want.add(i);
    });
  }
  for (const p of probes) p.remove();
  // Write all (only what changed).
  for (const job of jobs) {
    const cur = job.st.broken;
    const same = cur.size === job.want.size && [...cur].every(i => job.want.has(i));
    if (!same) render(job.node, job.st, job.want);
  }
}

// ---- scheduling -------------------------------------------------------------------------------

let pending = new Set();
let queued = false;

function schedule(node) {
  pending.add(node);
  if (queued || typeof window === 'undefined') return;
  queued = true;
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => requestAnimationFrame(() => run(0)));
}

function run(tries) {
  const now = [...pending].filter(n => n.isConnected);
  const later = [...pending].filter(n => !n.isConnected);
  pending = new Set(tries < 10 ? later : []);
  for (const n of now) fitTe(n);
  if (pending.size) requestAnimationFrame(() => run(tries + 1));
  else queued = false;
}

let resizeTimer = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => fitTe(), 100);
  });
}
