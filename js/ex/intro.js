// ex/intro.js: the intro card (S4 `intro`, DESIGN 7 "Intro card"). Not graded; audio plays on show.
// The card lists the item's forms, its literary form ("Written / formal: …") and its hyd form
// ("In Hyderabad you'll also hear: …") with their notes when it has them.

import { teNode } from '../ui/te.js';
import { h, ensureStyles, makeCtx, teWords, audioButtons, autoplay, confidenceLabel, politenessChip, revealRom, shortcutOk } from './common.js';

function noteText(note) {
  if (!note) return '';
  if (typeof note === 'string') return note;
  if (Array.isArray(note)) {
    return note.map(b => (b.spans || []).map(s => s.s ?? s.b ?? s.i ?? '').join('')).join(' ');
  }
  return String(note.text ?? '');
}

function variant(label, v, cls, it, cx) {
  if (!v || !v.te) return null;
  const hydAudio = cls === 'hyd' && it && it.audio_hyd && (it.audio_hyd.f || it.audio_hyd.m)
    ? { ...it, audio: it.audio_hyd } : null;
  return h('div', { class: `intro-variant intro-${cls}`, 'data-variant': cls },
    h('p', { class: 'en intro-variant-label', text: label }),
    h('div', { class: 'stack-row' },
      hydAudio ? audioButtons(hydAudio, cx) : null,
      h('div', { class: 'stack' },
        teNode(v.te, { class: 'te-md' }),
        v.rom ? h('span', { class: 'rom', text: v.rom }) : null,
        v.note ? h('p', { class: 'intro-variant-note', text: noteText(v.note) }) : null)));
}

export function render(exercise, el, onAnswer, ctx = {}) {
  ensureStyles();
  const cx = makeCtx(ctx);
  const it = exercise.item || cx.item(exercise.itemIds && exercise.itemIds[0]);
  const root = h('section', { class: 'ex ex-intro', 'data-type': 'intro' });
  if (!it) { el.replaceChildren(root); return { showResult() {}, destroy() {} }; }

  const size = String(it.te).trim().includes(' ') ? 'lg' : 'xl';
  const words = teWords(it, cx, size);
  const hints = (it.tokens || []).filter(t => t.hint);
  const hintRow = hints.length && (it.tokens || []).length > 1
    ? h('div', { class: 'intro-hints' }, (it.tokens || []).map(t =>
        h('span', { class: 'intro-hint' }, teNode(t.te, { class: 'te-sm' }), h('span', { class: 'en', text: t.hint || '' }))))
    : null;

  const forms = (it.forms || []).length
    ? h('ul', { class: 'intro-forms' }, it.forms.map(f =>
        h('li', { class: 'intro-form' },
          audioButtons({ ...f, id: f.id || it.id }, cx),
          h('div', { class: 'stack' }, teWords(f, cx, 'md'), h('p', { class: 'en', text: f.en })))))
    : null;

  const note = noteText(it.note);
  const card = h('div', { class: 'intro-card', 'data-card': '' },
    politenessChip(it.register),
    h('div', { class: 'intro-main' },
      audioButtons(it, cx),
      h('div', { class: 'stack' }, words, h('p', { class: 'en en-lg', text: it.en }))),
    hintRow,
    h('div', { class: 'intro-meta' }, confidenceLabel(it.confidence, it.source)),
    note ? h('p', { class: 'intro-note', text: note }) : null,
    forms,
    variant('Written / formal:', it.literary, 'literary', it, cx),
    variant("In Hyderabad you'll also hear:", it.hyd, 'hyd', it, cx));

  const next = h('button', { type: 'button', class: 'btn btn-main ex-check ex-continue', text: 'Continue' });
  next.addEventListener('click', () => {
    next.disabled = true;
    onAnswer({ seen: true });
    if (typeof cx.onContinue === 'function') cx.onContinue({ correct: true });
  });
  const bar = h('div', { class: 'ex-actions' }, next);
  root.append(h('p', { class: 'ex-title-small', tabindex: '-1', text: 'New word' }), card, bar);
  el.replaceChildren(root);
  autoplay(it, cx);
  const onKey = e => { if (e.key === 'Enter' && !next.disabled && shortcutOk(e, root)) { e.preventDefault(); next.click(); } };
  document.addEventListener('keydown', onKey);

  return {
    root,
    showResult() { revealRom(root); },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}
