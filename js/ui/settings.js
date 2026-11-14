// ui/settings.js: the Settings screen, #/settings (task E14; SPECS S10 "Settings", S3).
//
//   render(el) -> cleanup
// Every control writes `settings` through store.set at once (no Save button); lessons read
// the stored settings when they start. Export downloads store.exportAll() as one JSON file
// (which sets meta.exported); import reads a file and merges it with store.importAll
// (settings from the file only when "Also use the settings in this file" is ticked).
// Phase 4 (F5) adds the theme and the save reminder here.
// No Telugu on this screen.

import * as store from '../store.js';
import { h, icon } from '../ex/common.js';

// The stylesheet is loaded once; the screen waits for it so it never shows unstyled.
let styled = null;
function styles() {
  if (styled) return styled;
  const href = new URL('../../css/settings.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return (styled = Promise.resolve());
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  styled = new Promise(res => { link.onload = res; link.onerror = res; });
  document.head.append(link);
  return styled;
}

// key -> [label, help, options [value, label, sub]]
const CHOICES = {
  rom: ['Romanization', 'English letters under Telugu words.', [
    ['on', 'On', 'Always shown'],
    ['auto', 'Auto', 'Shown until you know the letters'],
    ['off', 'Off', 'Never shown'],
  ]],
  voice: ['Voice', null, [
    ['f', 'Female', null],
    ['m', 'Male', null],
    ['alt', 'Alternate', 'Female and male in turn'],
  ]],
  typing: ['Typing', 'How you build Telugu answers.', [
    ['tiles', 'Word tiles', 'Tap the pieces'],
    ['keyboard', 'Keyboard', 'Type in Telugu or English letters'],
  ]],
  goal: ['Daily goal', 'Lessons a day.', [
    [1, '1 lesson', null],
    [2, '2 lessons', null],
    [3, '3 lessons', null],
  ]],
};

// key -> [label, help]
const SWITCHES = {
  reads: ['I can already read Telugu', 'Opens every letter lesson and treats every word as readable.'],
  slow: ['Play slowly by default', 'Audio plays at three-quarter speed. The slow button is always there too.'],
  strict: ['Strict spelling', 'A nearly-right typed answer counts as wrong.'],
  speak: ['Speaking exercises', 'Lessons ask you to say words aloud and listen back.'],
};

const GROUPS = [
  ['Reading', ['reads', 'rom']],
  ['Listening', ['voice', 'slow']],
  ['Answering', ['typing', 'strict', 'speak']],
  ['Goal', ['goal']],
];

const KEYS = ['meta', 'settings', 'progress', 'cards', 'streak', 'reports'];
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function save(key, value) {
  const s = store.get('settings');
  s[key] = value;
  store.set('settings', s);
}

function fmtDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let uid = 0;

function choiceGroup(key, value) {
  const [label, help, opts] = CHOICES[key];
  const name = `set-${key}-${++uid}`;
  const helpId = help ? `${name}-help` : null;
  const fs = h('fieldset', { class: 'set-row set-choice', 'data-setting': key, 'aria-describedby': helpId },
    h('legend', { class: 'set-label', text: label }),
    help ? h('p', { class: 'set-help', id: helpId, text: help }) : null);
  const list = h('div', { class: 'set-options' });
  for (const [v, text, sub] of opts) {
    const input = h('input', { type: 'radio', name, value: String(v), class: 'set-radio' });
    input.checked = v === value;
    input.addEventListener('change', () => { if (input.checked) save(key, v); });
    list.append(h('label', { class: 'set-option', 'data-value': String(v) },
      input,
      h('span', { class: 'set-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'set-option-text' },
        h('span', { class: 'set-option-label', text }),
        sub ? h('span', { class: 'set-option-sub', text: sub }) : null)));
  }
  fs.append(list);
  return fs;
}

function switchRow(key, value) {
  const [label, help] = SWITCHES[key];
  const id = `set-${key}-${++uid}`;
  const input = h('input', { type: 'checkbox', role: 'switch', id, class: 'set-switch-input',
    'aria-describedby': `${id}-help` });
  input.checked = !!value;
  const state = h('span', { class: 'set-switch-state', 'aria-hidden': 'true', text: value ? 'On' : 'Off' });
  input.addEventListener('change', () => {
    save(key, input.checked);
    state.textContent = input.checked ? 'On' : 'Off';
  });
  return h('div', { class: 'set-row set-switch', 'data-setting': key },
    h('label', { class: 'set-switch-label', for: id },
      h('span', { class: 'set-switch-text' },
        h('span', { class: 'set-label', text: label }),
        h('span', { class: 'set-help', id: `${id}-help`, text: help })),
      input,
      h('span', { class: 'set-track', 'aria-hidden': 'true' }, h('span', { class: 'set-thumb' })),
      state));
}

function statusRow(kind, text) {
  return h('p', { class: `set-status set-status-${kind}`, 'data-status': kind },
    icon(kind === 'error' ? 'info' : 'tick'), h('span', { text }));
}

// What the import changed, in plain words.
function counts() {
  const p = store.get('progress') || {};
  return {
    lessons: Object.values(p.lessons || {}).filter(l => l && l.done).length,
    cards: Object.keys(store.get('cards') || {}).length,
    letters: Object.keys(store.get('cards') || {}).filter(id => id.startsWith('L:')).length,
  };
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

export async function render(el) {
  await styles();
  draw(el);
  return () => {};
}

function draw(el) {
  const settings = store.get('settings');

  const page = h('section', { class: 'settings' },
    h('h1', { class: 'screen-title', text: 'Settings' }));

  for (const [title, keys] of GROUPS) {
    const card = h('section', { class: 'set-card', 'aria-labelledby': `set-g-${title.toLowerCase()}` },
      h('h2', { class: 'set-h2', id: `set-g-${title.toLowerCase()}`, text: title }));
    for (const k of keys) card.append(CHOICES[k] ? choiceGroup(k, settings[k]) : switchRow(k, settings[k]));
    page.append(card);
  }

  // ---- export and import ----
  const lastLine = h('p', { class: 'set-help set-last' });
  const showLast = () => {
    const meta = store.get('meta');
    const d = meta && fmtDate(meta.exported);
    lastLine.textContent = d ? `Last saved to a file: ${d}` : 'Not saved to a file yet.';
    lastLine.dataset.exported = meta && meta.exported ? meta.exported : '';
  };
  showLast();

  const exportBtn = h('button', { type: 'button', class: 'btn btn-main set-export', text: 'Save progress to a file' });
  const exportStatus = h('div', { class: 'set-status-slot', role: 'status' });
  exportBtn.addEventListener('click', () => {
    const data = store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `telugu-progress-${localDate()}.json`, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showLast();
    exportStatus.replaceChildren(statusRow('ok', 'Saved. Keep the file somewhere safe.'));
  });

  const fileId = `set-file-${++uid}`;
  const fileInput = h('input', { type: 'file', id: fileId, class: 'set-file', accept: '.json,application/json' });
  const fileLabel = h('label', { class: 'btn btn-secondary set-import', for: fileId, text: 'Add progress from a file' });
  const takeId = `set-take-${++uid}`;
  const take = h('input', { type: 'checkbox', id: takeId, class: 'set-take' });
  const importStatus = h('div', { class: 'set-status-slot', role: 'status' });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    let obj = null;
    try { obj = JSON.parse(await f.text()); } catch { obj = null; }
    if (!isObj(obj) || !KEYS.some(k => k in obj)) {
      importStatus.replaceChildren(statusRow('error', "That file couldn't be read. Choose a progress file saved from this app."));
      return;
    }
    const before = counts();
    try {
      store.importAll(obj, { settings: take.checked });
    } catch {
      importStatus.replaceChildren(statusRow('error', "That file couldn't be read. Choose a progress file saved from this app."));
      return;
    }
    const after = counts();
    const added = [];
    if (after.lessons > before.lessons) added.push(plural(after.lessons - before.lessons, 'lesson', 'lessons'));
    if (after.cards > before.cards) {
      // (e) letter cards are counted too: say so
      const withLetters = after.letters > before.letters;
      added.push(withLetters
        ? plural(after.cards - before.cards, 'word or letter', 'words and letters')
        : plural(after.cards - before.cards, 'word', 'words'));
    }
    const msg = added.length
      ? `Added ${added.join(' and ')}. Your own progress was kept.`
      : 'Merged. Nothing new to add; your own progress was kept.';
    // Re-draw so the controls show the settings now stored, then report the result.
    const took = take.checked;
    draw(el);
    const slot = el.querySelector('.set-import-status');
    if (slot) slot.replaceChildren(statusRow('ok', msg));
    const t = el.querySelector('.set-take');
    if (t) t.checked = took;
    const inp = el.querySelector('.set-file');
    if (inp) { try { inp.focus({ preventScroll: true }); } catch { /* ignore */ } }
  });
  importStatus.classList.add('set-import-status');

  page.append(h('section', { class: 'set-card set-data', 'aria-labelledby': 'set-g-data' },
    h('h2', { class: 'set-h2', id: 'set-g-data', text: 'Your progress' }),
    h('p', { class: 'set-help', text: 'Progress lives only in this browser. Save it to a file to keep it safe or to move it to another device.' }),
    h('div', { class: 'set-row set-actions' }, exportBtn, lastLine, exportStatus),
    h('div', { class: 'set-row set-actions' },
      fileInput, fileLabel,
      h('label', { class: 'set-take-row', for: takeId }, take,
        h('span', { class: 'set-check', 'aria-hidden': 'true' }, icon('tick')),
        h('span', { text: 'Also use the settings in this file' })),
      h('p', { class: 'set-help', text: 'Adding a file merges it with what is here: nothing you have done is lost.' }),
      importStatus)));

  el.replaceChildren(page);
}
