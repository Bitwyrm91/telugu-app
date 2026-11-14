// ui/onboard.js: onboarding, four screens (task E10; SPECS S10 "Onboarding", S3 `settings`).
//
//   render(el, route) -> cleanup
// 1. What the app is and how sure each confidence label is (the labels' own help text).
// 2. "Can you already read Telugu?"  yes -> reads = true, rom = 'off'; no -> reads = false, rom = 'auto'.
// 3. How to read the romanization marks: one row per entry of content/onboard.json
//    [{mark, text, te, rom, audio}], each with its audio buttons.
// 4. Daily goal -> settings.goal (1, 2 or 3 lessons a day). "Start learning" sets
//    settings.onboarded = true and goes home.
// Each answer is stored the moment it is given. main.js sends a first run opened at the app's
// start address (no route in the address) here while settings.onboarded is false.
// Telugu goes in only through teNode; romanization only from the compiled content.

import * as store from '../store.js';
import * as content from '../content.js';
import * as audio from '../audio.js';
import * as router from '../router.js';
import { teNode } from './te.js';
import { h, ensureStyles, icon, audioButtons, confidenceLabel } from '../ex/common.js';

// The screen is drawn only once its stylesheets (ex.css for the shared pieces, onboard.css) have
// loaded, so no control is ever shown or measured unstyled (e.g. a 30 px bare back button).
function sheetReady(href) {
  let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => l.href === href);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }
  if (link.sheet) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(resolve, 5000); // a stylesheet that never answers must not block the screen
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
  });
}

function styles() {
  ensureStyles();
  return Promise.all([
    sheetReady(new URL('../../css/ex.css', import.meta.url).href),
    sheetReady(new URL('../../css/onboard.css', import.meta.url).href),
  ]);
}

const STEPS = 4;
const GOALS = [
  [1, 'Casual', '1 lesson a day'],
  [2, 'Regular', '2 lessons a day'],
  [3, 'Keen', '3 lessons a day'],
];

function save(patch) {
  store.set('settings', { ...store.get('settings'), ...patch });
}

function choice({ value, label, sub, selected, onPick }) {
  const btn = h('button', { type: 'button', class: 'ob-choice', 'data-value': String(value),
    'aria-pressed': selected ? 'true' : 'false' },
  h('span', { class: 'ob-radio', 'aria-hidden': 'true' }),
  h('span', { class: 'ob-choice-text' },
    h('span', { class: 'ob-choice-label', text: label }),
    sub ? h('span', { class: 'ob-choice-sub', text: sub }) : null),
  icon('tick', 'ob-choice-tick'));
  btn.addEventListener('click', () => onPick(value, btn));
  return btn;
}

function markChoices(list, btn) {
  for (const b of list.querySelectorAll('.ob-choice')) b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
}

export async function render(el) {
  await styles();
  let step = 1;
  let rows = null;      // onboard.json, once loaded
  let rowsError = false;
  let alive = true;

  const root = h('section', { class: 'ob', 'aria-labelledby': 'ob-title' });
  el.replaceChildren(root);
  el.__onboard = { step: () => step };

  const loadRows = content.loadOnboard().then(r => { rows = Array.isArray(r) ? r : []; },
    () => { rowsError = true; });

  function frame(title, body, actions, sub = null) {
    const dots = h('div', { class: 'ob-dots', 'aria-hidden': 'true' },
      ...Array.from({ length: STEPS }, (_, i) => h('span', { class: 'ob-dot', 'data-on': i < step ? 'true' : 'false' })));
    const top = h('div', { class: 'ob-top' },
      step > 1
        ? h('button', { type: 'button', class: 'ob-back', 'aria-label': 'Back', onclick: () => show(step - 1) }, icon('back'))
        : h('span', { class: 'ob-back-space' }),
      dots,
      h('span', { class: 'ob-count', text: `${step} of ${STEPS}` }));
    root.replaceChildren(...[top,
      h('h1', { class: 'screen-title ob-title', id: 'ob-title', tabindex: '-1', text: title }),
      sub ? h('p', { class: 'ob-lead', text: sub }) : null,
      body,
      h('div', { class: 'ob-actions' }, ...actions)].filter(Boolean));
    root.dataset.step = String(step);
    // After a step change, focus the new title so a screen reader starts there.
    // Q3d m5: step 1 too (on arrival focus was left on BODY); the screen may not be attached yet.
    const t = root.querySelector('.ob-title');
    const focusTitle = () => { try { t.focus({ preventScroll: true }); } catch { /* old browser */ } };
    if (moved) focusTitle();
    else setTimeout(() => {
      const a = document.activeElement;
      if (t.isConnected && (!a || a === document.body)) focusTitle();
    }, 0);
    window.scrollTo(0, 0);
  }

  function next(label = 'Continue', disabled = false) {
    const b = h('button', { type: 'button', class: 'btn btn-main ob-next', text: label });
    if (disabled) b.disabled = true;
    b.addEventListener('click', () => show(step + 1));
    return b;
  }

  // ---- 1: what the app is ----
  function screen1() {
    const labels = h('ul', { class: 'ob-labels' });
    for (const conf of ['native', 'attested', 'checked', 'low']) {
      const lab = confidenceLabel(conf);
      const help = lab.querySelector('.conf-help');
      const text = help ? help.textContent : '';
      if (help) help.remove();
      const btn = lab.querySelector('.conf');
      if (btn) { btn.disabled = true; btn.removeAttribute('aria-expanded'); btn.classList.add('ob-conf'); }
      labels.append(h('li', { class: 'ob-label-row', 'data-confidence': conf },
        h('span', { class: 'ob-label-pill' }, lab), h('p', { class: 'ob-label-help', text })));
    }
    const body = h('div', { class: 'ob-body' },
      h('div', { class: 'ob-card', 'data-card': '' },
        h('p', { class: 'ob-p', text: 'Short daily lessons in spoken Telugu: hear each word, read it, say it, and build sentences from it. Letters come a few at a time, beside the words.' }),
        h('p', { class: 'ob-p', text: 'Every word and sentence carries a label that says how sure we are of it:' }),
        labels,
        h('p', { class: 'ob-p ob-quiet', text: 'You can report anything that looks wrong from the flag in every lesson.' })));
    frame('Learn to speak Telugu', body, [next()]);
  }

  // ---- 2: can you read? ----
  function screen2() {
    const s = store.get('settings');
    const answered = s.onboarded || step2Answered;
    const list = h('div', { class: 'ob-choices', role: 'group', 'aria-labelledby': 'ob-title' });
    const go = next('Continue', !answered);
    const pick = (yes, btn) => {
      step2Answered = true;
      save(yes ? { reads: true, rom: 'off' } : { reads: false, rom: 'auto' });
      markChoices(list, btn);
      go.disabled = false;
    };
    list.append(
      choice({ value: 'yes', label: 'Yes, I can read it', sub: 'Lessons show the Telugu script only. Letter lessons stay open on the Letters screen.',
        selected: answered && s.reads, onPick: () => pick(true, list.children[0]) }),
      choice({ value: 'no', label: 'No, not yet', sub: 'You will learn the letters as you go, with the sounds written in English letters until you know them.',
        selected: answered && !s.reads, onPick: () => pick(false, list.children[1]) }));
    frame('Can you already read Telugu?', h('div', { class: 'ob-body' }, list), [go]);
  }
  let step2Answered = false;

  // ---- 3: the romanization marks ----
  function screen3() {
    const body = h('div', { class: 'ob-body ob-marks' });
    const cx = { settings: store.get('settings') };
    const fill = () => {
      if (rowsError) {
        body.replaceChildren(h('div', { class: 'state-error', role: 'alert' },
          h('p', { text: 'The examples could not be loaded. You can carry on and find them again later.' })));
        return;
      }
      if (rows === null) {
        body.replaceChildren(h('div', { class: 'state-loading', 'aria-busy': 'true', 'aria-label': 'Loading' },
          h('div', { class: 'skeleton skeleton-card' }), h('div', { class: 'skeleton skeleton-card' })));
        return;
      }
      if (!rows.length) {
        body.replaceChildren(h('p', { class: 'ob-p', text: 'No examples yet.' }));
        return;
      }
      const list = h('ul', { class: 'ob-mark-list' });
      rows.forEach((r, i) => {
        list.append(h('li', { class: 'ob-mark-row', 'data-card': '', 'data-row': String(i) },
          h('p', { class: 'ob-mark rom', text: r.mark }),
          h('p', { class: 'ob-mark-text', text: r.text }),
          h('div', { class: 'ob-example' },
            audioButtons(r, cx, { label: 'Play example' }),
            h('div', { class: 'ob-stack' },
              teNode(r.te, { class: 'ob-te' }),
              r.rom ? h('span', { class: 'rom ob-rom', text: r.rom }) : null))));
      });
      body.replaceChildren(list);
    };
    fill();
    if (rows === null && !rowsError) loadRows.then(() => { if (alive && step === 3) fill(); });
    frame('How to read the sounds', body, [next()],
      'Where the app writes Telugu sounds in English letters, a few marks matter. Tap play to hear each example.');
  }

  // ---- 4: daily goal ----
  function screen4() {
    const s = store.get('settings');
    let chosen = s.onboarded || goalAnswered ? s.goal : null;
    const finish = h('button', { type: 'button', class: 'btn btn-main ob-finish', text: 'Start learning' });
    finish.disabled = chosen === null;
    const list = h('div', { class: 'ob-choices', role: 'group', 'aria-labelledby': 'ob-title' });
    for (const [n, label, sub] of GOALS) {
      list.append(choice({ value: n, label, sub, selected: chosen === n, onPick: (v, btn) => {
        goalAnswered = true;
        chosen = v;
        save({ goal: v });
        markChoices(list, btn);
        finish.disabled = false;
      } }));
    }
    finish.addEventListener('click', () => {
      if (chosen === null) return;
      save({ goal: chosen, onboarded: true });
      // A deep link opened on a first run (main.js) goes on to where it pointed.
      let after = null;
      try { after = sessionStorage.getItem('telugu.after-onboard'); sessionStorage.removeItem('telugu.after-onboard'); } catch { /* storage blocked */ }
      router.go(after && router.parse(after) ? after : '#/');
    });
    frame('Set a daily goal', h('div', { class: 'ob-body' }, list), [finish], 'You can change this any time in Settings.');
  }
  let goalAnswered = false;

  let moved = false;
  function show(n) {
    moved = n !== step || moved;
    audio.stop();
    step = Math.max(1, Math.min(STEPS, n));
    [screen1, screen2, screen3, screen4][step - 1]();
  }

  show(1);
  return () => { alive = false; audio.stop(); delete el.__onboard; };
}
