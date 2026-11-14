// ex/common.js: pieces shared by the exercise screens (task E6; SPECS S4, S10; DESIGN 7).
//
// Every exercise module exports
//   render(exercise, el, onAnswer, ctx) -> controller {showResult(result), destroy()}
// `onAnswer(answer)` gets the learner's answer in the shape grade.check takes (S4/S6);
// the caller (session, E7) grades it and hands the result back through showResult, which
// marks the exercise's own controls (tiles, cards) and shows a state row.
// ctx (all optional):
//   item(id) -> compiled item or null   (audio, listen prompts, answers after a miss)
//   settings                            (default: store settings)
//   taught: Set | array of letter ids   (default: progress.letters with `seen`; all with reads)
//   onContinue()                        shows a "Continue" button after the result
//   verdict: false                      leaves out the state row (when the caller shows a sheet)
//
// Telugu goes into the page only through teNode (DESIGN 3).

import { teNode } from '../ui/te.js';
import * as store from '../store.js';
import * as audio from '../audio.js';
import { mulberry32 } from '../exgen.js';

// ---- styles (one stylesheet for the exercise screens, loaded once) ---------------------------

let styled = false;
export function ensureStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/ex.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

// ---- DOM -----------------------------------------------------------------------------------

export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
  return n;
}

// ---- icons (24 px grid, 2 px round strokes, currentColor; DESIGN 6) ----------------------------

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  play: `<path d="M8 5.5v13l10.5-6.5z" ${S}/>`,
  slow: `<path d="M4 6.5v11l8.5-5.5z" ${S}/><path d="M15 17.5c0-2.5 1.6-4 3.5-4s2.5 1.2 2.5 2.5-1 2-2.5 2H14.5M17 13.5l-.5-2.5" ${S}/>`,
  noaudio: `<path d="M8 5.5v13l10.5-6.5z" ${S}/><path d="M4 4l16 16" ${S}/>`,
  bars: `<path class="bar b1" d="M7 9v6" ${S}/><path class="bar b2" d="M12 6v12" ${S}/><path class="bar b3" d="M17 9v6" ${S}/>`,
  tick: `<path d="M5 12.5l4.5 4.5L19 7.5" ${S}/>`,
  cross: `<path d="M6 6l12 12M18 6L6 18" ${S}/>`,
  almost: `<circle cx="12" cy="12" r="9" ${S}/><path d="M8 10.5c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0M8 14.5c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0" ${S}/>`,
  info: `<circle cx="12" cy="12" r="9" ${S}/><path d="M12 11v6M12 7.5v.5" ${S}/>`,
  keyboard: `<rect x="3" y="6" width="18" height="12" rx="2" ${S}/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" ${S}/>`,
  shield: `<path d="M12 3l7 3v5.5c0 4.2-3 7.7-7 9-4-1.3-7-4.8-7-9V6z" ${S}/><path d="M8.8 12.2l2.3 2.3 4.3-4.6" ${S}/>`,
  book: `<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" ${S}/><path d="M12 6v13" ${S}/>`,
  bubbles: `<path d="M4 5h11v8H9l-3 3v-3H4z" ${S}/><path d="M17 9h3v8h-2v3l-3-3h-4v-2" ${S}/>`,
  cpu: `<rect x="6" y="6" width="12" height="12" rx="2" ${S}/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" ${S}/><path d="M9.5 12l1.8 1.8 3.2-3.4" ${S}/>`,
  question: `<path d="M12 3.5L21.5 20h-19z" ${S}/><path d="M10 10.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M12 16.8v.2" ${S}/>`,
  polite: `<circle cx="8" cy="8" r="2.5" ${S}/><circle cx="16" cy="8" r="2.5" ${S}/><path d="M3.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5M11.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5" ${S}/>`,
  familiar: `<circle cx="12" cy="8" r="3" ${S}/><path d="M6 20c0-3.5 2.7-6 6-6s6 2.5 6 6" ${S}/>`,
  back: `<path d="M15 5l-7 7 7 7" ${S}/>`,
  'space-bar': `<path d="M4 10v4h16v-4" ${S}/>`,
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---- context ------------------------------------------------------------------------------

export function makeCtx(ctx = {}) {
  const settings = { ...store.get('settings'), ...(ctx.settings || {}) };
  let taught = ctx.taught;
  if (!taught) {
    const prog = store.get('progress') || {};
    taught = Object.entries(prog.letters || {}).filter(([, v]) => v && v.seen).map(([k]) => k);
  }
  taught = taught instanceof Set ? taught : new Set(taught);
  const item = typeof ctx.item === 'function' ? ctx.item : () => null;
  return { ...ctx, settings, taught, item };
}

// ---- romanization (S10 "Romanization") -------------------------------------------------------

export function readable(w, cx) {
  if (cx.settings.reads) return true;
  const needs = (w && w.needs) || [];
  return needs.every(id => id !== '?' && cx.taught.has(id));
}

/** 'show' | 'tap' | 'none' for one W. */
export function romMode(w, cx) {
  const r = cx.settings.rom || 'auto';
  if (!w || !w.rom || !String(w.rom).trim()) return 'none';
  if (r === 'on') return 'show';
  if (r === 'off') return 'none';
  return readable(w, cx) ? 'tap' : 'show';
}

function romEl(w, mode, size) {
  if (mode === 'none') return null;
  const r = h('span', { class: `rom rom-${size}`, text: w.rom });
  if (mode === 'tap') r.hidden = true;
  return r;
}

/** Reveal hidden romanization inside `root` (the "on tap" half of the rule). */
export function revealRom(root) {
  for (const r of root.querySelectorAll('.rom[hidden]')) r.hidden = false;
  root.removeAttribute('data-rom');
}

const TRAIL = /[.,?!]+$/;

/**
 * Telugu words with romanization under each word (S10: the rule is per W).
 * src: T {te, tokens} | W {te, rom, needs} | item. size: xl | lg | md | sm.
 * In auto mode, a readable word's romanization is hidden until the line is tapped
 * (opts.tapReveal false: the caller reveals it, e.g. a tile that is tapped anyway).
 */
export function teWords(src, cx, size = 'md', opts = {}) {
  const text = String(src.te ?? '');
  let words = Array.isArray(src.tokens) && src.tokens.length ? src.tokens : [{ te: text, rom: src.rom, needs: src.needs }];
  const shown = text.trim().split(/\s+/).filter(Boolean);
  const box = h('span', { class: `tew tew-${size}` });
  if (words.length === shown.length) {
    words = words.map((w, i) => ({ ...w, show: shown[i] }));
  } else if (words.length && TRAIL.test(text.trim())) {
    const p = text.trim().match(TRAIL)[0];
    words = words.map((w, i) => ({ ...w, show: i === words.length - 1 ? w.te + p : w.te }));
  } else {
    words = words.map(w => ({ ...w, show: w.te }));
  }
  let tap = false;
  for (const w of words) {
    const mode = romMode(w, cx);
    if (mode === 'tap') tap = true;
    box.append(h('span', { class: 'tew-word' }, teNode(w.show, { class: `te-${size}` }), romEl(w, mode, size)));
  }
  if (tap) {
    box.setAttribute('data-rom', 'tap');
    if (opts.tapReveal !== false) {
      box.addEventListener('click', () => revealRom(box));
      box.title = 'Tap to show how it is said';
    }
  }
  return box;
}

// ---- audio buttons (DESIGN 7 "Audio button") ---------------------------------------------------

export const NO_AUDIO_HINT = 'No audio for this one yet';
export function hasAudio(it) {
  const a = it && it.audio;
  return !!(a && ((typeof a.f === 'string' && a.f) || (typeof a.m === 'string' && a.m)));
}

/**
 * The audio-failure line (SPECS S12 "Audio failure"): an empty polite live region that is put in
 * the page with the screen and only has its text set when a clip fails (never moved then, so
 * screen readers announce it). msg.fail(onSkip?) shows the message (and "Skip this one");
 * msg.ok() empties it.
 */
export function audioMsg() {
  const msg = h('span', { class: 'audio-msg', 'aria-live': 'polite' });
  msg.fail = onSkip => {
    // The download line only where the download feature exists (a service worker controls the page).
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      && !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    const kids = [h('span', { class: 'audio-msg-text', text: 'Audio could not play. Tap to try again.'
      + (offline ? " Download this unit's audio to use it offline." : '') })];
    if (typeof onSkip === 'function') {
      const skip = h('button', { type: 'button', class: 'btn btn-secondary audio-skip', text: 'Skip this one' });
      skip.addEventListener('click', e => { e.stopPropagation(); onSkip(); });
      kids.push(skip);
    }
    msg.replaceChildren(...kids);
  };
  msg.ok = () => msg.replaceChildren();
  return msg;
}

/** Play an item's clip; a failure shows on `msg` (an audioMsg), a success clears it. */
export function playWithMsg(it, cx, msg, opts = {}) {
  return audio.play(it, { voice: cx.settings.voice || 'f', slow: !!(opts.slow ?? cx.settings.slow) })
    .then(v => { msg.ok(); return v; })
    .catch(() => { msg.fail(); });
}

const ROW = '.ex-prompt-te, .stack-row, .intro-main';

/** Play and slow buttons for an item (or anything with `audio`). */
export function audioButtons(it, cx, opts = {}) {
  const wrap = h('span', { class: 'audio-pair' });
  if (!hasAudio(it)) {
    wrap.append(h('button', { type: 'button', class: 'audio-btn', disabled: true, 'aria-label': 'No audio yet' }, icon('noaudio')),
      h('span', { class: 'audio-none', text: opts.noneText || 'no audio yet' }));
    // Q3d m7: a listening step whose clip does not exist offers the same "Skip this one" as one
    // whose clip fails to play (no grade).
    if (typeof opts.onSkip === 'function') {
      const skip = h('button', { type: 'button', class: 'btn btn-secondary audio-skip', text: 'Skip this one' });
      skip.addEventListener('click', e => { e.stopPropagation(); if (!wrap.noSkip) opts.onSkip(); });
      wrap.setAttribute('data-noaudio', '');
      wrap.append(skip);
    }
    return wrap;
  }
  // B2: a failed play is shown in words (polite live region); a listen exercise also offers
  // "Skip this one" there (opts.onSkip), which advances without a grade.
  const msg = audioMsg();
  wrap.msg = msg;
  // Q3b B1 / Q3c minor 7: in a row (a Telugu prompt, a word with its buttons) the line sits on
  // its own full width under that row, so it never pushes the Telugu off a narrow screen. It is
  // put there as soon as the buttons are in their row (empty), not when a clip fails.
  let tries = 0;
  const place = () => {
    const row = wrap.closest(ROW);
    if (row) { if (msg.previousElementSibling !== row) row.after(msg); return; }
    if (!wrap.isConnected && ++tries < 30) requestAnimationFrame(place);
  };
  queueMicrotask(place);
  wrap.fail = () => {
    wrap.setAttribute('data-error', '');
    msg.fail(typeof opts.onSkip === 'function' && !wrap.noSkip ? opts.onSkip : undefined);
    if (typeof opts.onState === 'function') opts.onState('fail');
  };
  wrap.ok = () => {
    wrap.removeAttribute('data-error');
    for (const b of wrap.querySelectorAll('.audio-btn[data-error]')) b.removeAttribute('data-error');
    msg.ok();
    if (typeof opts.onState === 'function') opts.onState('ok');
  };
  const play = (slow, btn) => {
    for (const b of document.querySelectorAll('.audio-btn[data-playing]')) b.removeAttribute('data-playing');
    btn.setAttribute('data-playing', '');
    return audio.play(it, { voice: cx.settings.voice || 'f', slow })
      .then(v => { wrap.ok(); return v; })
      .catch(() => { btn.setAttribute('data-error', ''); wrap.fail(); })
      .finally(() => btn.removeAttribute('data-playing'));
  };
  const main = h('button', { type: 'button', class: 'audio-btn', 'aria-label': opts.label || 'Play' },
    icon('play', 'i-play'), icon('bars', 'i-bars'));
  main.addEventListener('click', e => { e.stopPropagation(); play(!!cx.settings.slow, main); });
  let timer = 0;
  main.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = -1; play(true, main); }, 550); });
  const clear = () => { if (timer > 0) clearTimeout(timer); };
  main.addEventListener('pointerup', clear);
  main.addEventListener('pointerleave', clear);
  const slow = h('button', { type: 'button', class: 'audio-btn audio-slow', 'aria-label': 'Play slowly' },
    icon('slow', 'i-play'), icon('bars', 'i-bars'));
  slow.addEventListener('click', e => { e.stopPropagation(); play(true, slow); });
  wrap.append(main, slow, msg);
  wrap.playNow = () => play(!!cx.settings.slow, main);
  wrap.__item = it;
  return wrap;
}

/** Autoplay on show; when it fails, the item's audio buttons on screen say so (B2). */
export function autoplay(it, cx) {
  if (!hasAudio(it)) return;
  const pairs = () => [...document.querySelectorAll('.audio-pair')].filter(p => p.__item === it && p.fail);
  audio.play(it, { voice: cx.settings.voice || 'f', slow: !!cx.settings.slow })
    .then(v => { for (const p of pairs()) p.ok(); return v; })
    .catch(() => { const p = pairs()[0]; if (p) p.fail(); });
}

// ---- chips and labels -------------------------------------------------------------------------

/** Politeness chip (DESIGN 7): nothing for neutral. */
export function politenessChip(register) {
  if (register !== 'polite' && register !== 'familiar') return null;
  const polite = register === 'polite';
  return h('span', { class: `chip chip-${register}`, 'data-register': register },
    icon(polite ? 'polite' : 'familiar'),
    // design 1 #17: one run of text, so the chip's gap does not put spaces inside the brackets
    h('span', { class: 'chip-text' }, polite ? 'Polite (' : 'Familiar (',
      teNode(polite ? 'మీరు' : 'నువ్వు', { class: 'te-sm' }), ')'));
}

const CONF = {
  native: ['shield', 'Checked by a native speaker'],
  attested: ['book', 'From textbook'],
  checked: ['cpu', 'AI-checked'],
  low: ['question', 'Unverified'],
};
const CONF_HELP = {
  native: 'A native speaker in the family has checked this.',
  attested: 'This Telugu is a whole line from a published source; its English is AI-checked.',
  checked: 'Checked by AI tools only; a native speaker has not seen it yet.',
  low: 'Not checked yet. It may contain mistakes.',
};

/** Confidence label (DESIGN 7); `source` picks "From Tatoeba" for an attested Tatoeba line. */
export function confidenceLabel(conf, source = null, opts = {}) {
  if (!CONF[conf]) return null;
  let [ic, words] = CONF[conf];
  if (conf === 'attested' && source && source.kind === 'tatoeba') { ic = 'bubbles'; words = 'From Tatoeba'; }
  const short = opts.short && conf === 'native';
  const btn = h('button', { type: 'button', class: `conf conf-${conf}`, 'data-confidence': conf,
    'aria-label': words, 'aria-expanded': 'false' }, icon(ic), short ? null : h('span', { text: words }));
  const help = h('span', { class: 'conf-help', hidden: true, text: CONF_HELP[conf] });
  btn.addEventListener('click', e => {
    e.stopPropagation();
    help.hidden = !help.hidden;
    btn.setAttribute('aria-expanded', String(!help.hidden));
  });
  return h('span', { class: 'conf-wrap' }, btn, help);
}

// ---- prompts ----------------------------------------------------------------------------------

/** English prompt with its politeness chip above it. */
export function enPrompt(p) {
  return h('div', { class: 'ex-prompt ex-prompt-en' },
    politenessChip(p.register),
    h('p', { class: 'en en-prompt', text: p.en }));
}

/** A Telugu prompt (T) with audio buttons. */
export function tePrompt(t, cx, opts = {}) {
  const it = cx.item(t.itemId);
  const size = opts.size || (String(t.te).trim().includes(' ') ? 'lg' : 'xl');
  return h('div', { class: 'ex-prompt ex-prompt-te', 'data-card': '' },
    audioButtons(it, cx), h('div', { class: 'stack' }, teWords(t, cx, size)));
}

/** The "listen" prompt: a big play button; the text stays hidden until answered. */
export function listenPrompt(itemId, cx, opts = {}) {
  const it = cx.item(itemId);
  const hidden = h('div', { class: 'listen-text', hidden: true });
  // Q3f minors 2-3: one message only. No clip: the line beside the button says "No audio for this
  // one yet" and there is no "Listen" hint; a clip that fails: the hint gives way to the failure line.
  const hint = hasAudio(it) ? h('p', { class: 'en listen-hint', text: 'Listen' }) : null;
  const pair = audioButtons(it, cx, { label: 'Play again', onSkip: opts.onSkip, noneText: NO_AUDIO_HINT,
    onState: s => { if (hint) hint.hidden = s === 'fail'; } });
  const box = h('div', { class: 'ex-prompt ex-prompt-listen', 'data-card': '' }, pair, hint, hidden);
  box.reveal = () => {
    pair.noSkip = true; // answered: nothing left to skip
    for (const b of (pair.msg || pair).querySelectorAll('.audio-skip')) b.remove();
    if (!it) return;
    hidden.replaceChildren(teWords(it, cx, String(it.te).trim().includes(' ') ? 'lg' : 'xl', { tapReveal: true }),
      h('p', { class: 'en', text: it.en }));
    hidden.hidden = false;
  };
  return box;
}

export function title(text) {
  return h('h2', { class: 'ex-title', text });
}

// ---- action bar and verdict ----------------------------------------------------------------------

/** The exercise's own action bar with a Check button (disabled while empty, S4). */
export function actionBar(label = 'Check') {
  const btn = h('button', { type: 'button', class: 'btn btn-main ex-check', disabled: true, text: label });
  const bar = h('div', { class: 'ex-actions' }, btn);
  return { bar, btn };
}

export function stateOf(result) {
  if (!result || result.skipped) return 'skipped';
  if (result.close) return 'close';
  return result.correct ? 'right' : 'wrong';
}

const WORD = { right: ['tick', 'Correct'], close: ['almost', 'Almost'], wrong: ['cross', 'Not quite'], skipped: ['info', 'Skipped'] };

/** State row + the bits under it; puts Continue in the bar when ctx.onContinue is given. */
export function showVerdict(root, bar, result, cx, extra = [], opts = {}) {
  const st = stateOf(result);
  root.dataset.state = st;
  bar.btn.hidden = true;
  if (cx.verdict !== false) {
    const [ic, word] = opts.word ? [opts.icon || 'info', opts.word] : WORD[st];
    const look = opts.look || st;
    const row = h('div', { class: `ex-verdict verdict-${look}`, role: 'status', tabindex: '-1' },
      icon(ic, 'verdict-icon'), h('span', { class: 'verdict-word', text: word }));
    const box = h('div', { class: 'ex-result', 'data-card': '' }, row, ...extra.filter(Boolean));
    root.insertBefore(box, bar.bar);
    try { row.focus({ preventScroll: true }); } catch { /* old browser */ }
  }
  if (typeof cx.onContinue === 'function') {
    const c = h('button', { type: 'button', class: `btn btn-main ex-continue cont-${opts.look || st}`, text: 'Continue' });
    c.addEventListener('click', () => cx.onContinue(result));
    bar.bar.append(c);
    c.focus({ preventScroll: true });
  }
}

/** "Correct answer" caption + an item as a te-stack (for close and wrong). */
export function correctAnswer(it, cx, expected = null) {
  let src = it;
  if (expected !== null && expected !== undefined) {
    const te = Array.isArray(expected) ? expected.join(' ') : typeof expected === 'object' ? expected.te : String(expected);
    if (te && (!it || te.normalize('NFC') !== String(it.te).normalize('NFC'))) {
      src = typeof expected === 'object' && !Array.isArray(expected) && expected.rom
        ? { te, rom: expected.rom, needs: (expected.units || []).flatMap(u => u.needs || []) }
        : { te, rom: '', needs: [] };
    }
  }
  if (!src) return null;
  return h('div', { class: 'ex-answer' },
    h('p', { class: 'caption', text: 'Correct answer' }),
    h('div', { class: 'stack-row' }, audioButtons(it, cx),
      h('div', { class: 'stack' }, teWords(src, cx, 'lg', { tapReveal: true }), it ? h('p', { class: 'en', text: it.en }) : null)));
}

export function infoRow(text) {
  return h('p', { class: 'ex-info' }, icon('info'), h('span', { text }));
}

// ---- keys and random ------------------------------------------------------------------------

const DIALOG = '.rp-backdrop, dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const CONTROL = 'button, a[href], input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"]';
const TEXT = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Q3e S1: the one guard for every page-level exercise shortcut (Enter, digits, Backspace) that
 * listens on `document`. It is false when the event was already handled, a modifier or IME is in
 * use, any dialog is open, or the key comes from a control that does its own job: for Enter any
 * button / link / text field (top-bar X and flag included); for other keys a text field anywhere,
 * or any control outside this exercise (`root`).
 */
export function shortcutOk(e, root, kind = 'enter') {
  // Q3f minor 1: a held key (auto-repeat) never acts again: one press, one action
  if (!e || e.repeat || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return false;
  if (typeof document !== 'undefined' && document.querySelector(DIALOG)) return false;
  if (root && !root.isConnected) return false;
  const t = e.target && e.target.nodeType === 1 ? e.target : null;
  if (!t || t === document.body || t === document.documentElement) return true;
  if (t.closest(DIALOG)) return false;
  // Q3g minor 2: an inert control (aria-disabled="true", e.g. the sent report flag) does nothing on
  // Enter, so it does not block the page shortcuts either.
  const ctl = t.closest(CONTROL);
  const live = ctl && ctl.getAttribute('aria-disabled') !== 'true' ? ctl : null;
  if (kind === 'enter') return !live;
  if (t.closest(TEXT)) return false;
  if (live && !(root && root.contains(t))) return false;
  return true;
}

/** Number keys 1-4 (DESIGN 7 choice tile); returns a remover. */
export function numberKeys(handler, root = null) {
  const fn = e => {
    if (!/^[1-9]$/.test(e.key)) return;
    if (!shortcutOk(e, root, 'digit')) return;
    handler(Number(e.key) - 1, e);
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

/**
 * ARIA radio-group keys for choice tiles: one tile in the Tab order (roving tabindex), arrow
 * keys move focus and select, Home/End go to the ends, and Enter on a tile checks once a choice
 * is made (it never re-selects the focused tile). Returns mark(i) to call from select(i).
 */
export function radioKeys(tiles, select, submit, isDone) {
  const mark = i => tiles.forEach((t, k) => { t.tabIndex = k === (i < 0 ? 0 : i) ? 0 : -1; });
  mark(-1);
  tiles.forEach((t, i) => t.addEventListener('keydown', e => {
    if (isDone()) return;
    const n = tiles.length;
    let j = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === 'Enter') {
      if (e.repeat) { e.preventDefault(); return; } // Q3f minor 1: held Enter does nothing more
      if (t.getAttribute('aria-checked') === 'true' || tiles.some(x => x.getAttribute('aria-checked') === 'true')) {
        e.preventDefault();
        submit();
      }
      return;
    }
    if (j < 0) return;
    e.preventDefault();
    select(j);
    tiles[j].focus();
  }));
  return mark;
}

/** Same exercise -> same order (seeded by its id). */
export function seededShuffle(list, key) {
  let s = 0;
  for (const ch of String(key ?? '')) s = (Math.imul(s, 31) + ch.codePointAt(0)) | 0;
  const rng = mulberry32(s);
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const hasTelugu = s => /[ఀ-౿]/.test(String(s ?? ''));
