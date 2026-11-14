// ex/speak.js: the speak exercise (task E9; SPECS S4 `speak`, S6 S1-S3; DESIGN 7).
//
//   render(exercise, el, onAnswer, ctx) -> controller {root, showResult(result), destroy()}
//
// The learner hears the item, records themselves (recorder.js), plays their recording, or
// both one after the other (the model clip, then theirs), and rates themselves:
//   onAnswer('good')   "Sounded right"
//   onAnswer('again')  "Not yet"
//   onAnswer('skip')   "Can't speak now" (always offered; the main action when there is no
//                      microphone, the browser can't record, or microphone access is refused)
// Nothing is graded by machine and nothing is stored or sent: the recording lives in memory
// until the exercise is left.
//
// For tests: root.dataset.mic = checking | ready | recording | recorded | none | denied;
// root.dataset.bytes = size of the last recording; root.dataset.played = a comma list of what
// has played ("model", "mine") in order.

import * as audio from '../audio.js';
import * as recorder from '../recorder.js';
import {
  h, ensureStyles, makeCtx, teWords, audioButtons, autoplay, politenessChip, showVerdict, revealRom,
} from './common.js';

let styled = false;
function speakStyles() {
  ensureStyles();
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const href = new URL('../../css/speak.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  mic: `<rect x="9" y="3" width="6" height="11" rx="3" ${S}/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" ${S}/>`,
  nomic: `<rect x="9" y="3" width="6" height="11" rx="3" ${S}/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7M4 4l16 16" ${S}/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="2" ${S}/>`,
  play: `<path d="M8 5.5v13l10.5-6.5z" ${S}/>`,
  both: `<path d="M4 6.5v11l7-5.5zM13 6.5v11l7-5.5z" ${S}/>`,
};
function sicon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name] || '';
  return s;
}

function hasModel(it) {
  const a = it && it.audio;
  return !!(a && ((typeof a.f === 'string' && a.f) || (typeof a.m === 'string' && a.m)));
}

export const SELF_AGAIN = 'You will practise this one again';

const NO_MIC = {
  none: 'No microphone found, so this one can be skipped. Saying it aloud still helps.',
  denied: 'The microphone is blocked for this app. Allow it in the browser to record, or skip this one.',
};

export function render(exercise, el, onAnswer, ctx = {}) {
  speakStyles();
  const cx = makeCtx(ctx);
  const it = exercise.item || cx.item(exercise.itemIds && exercise.itemIds[0]);
  const root = h('section', { class: 'ex ex-speak', 'data-type': 'speak', 'data-mic': 'checking', 'data-played': '' });
  let alive = true;
  let answered = false;
  let blob = null;
  let url = null;
  let mine = null;      // <audio> for the learner's recording
  let playRun = 0;      // bumps to cancel a "play both" in progress
  let starting = false; // the mic is starting (button stays focusable)

  // ---- prompt ----
  const size = it && String(it.te).trim().includes(' ') ? 'lg' : 'xl';
  const pair = it ? audioButtons(it, cx) : null;
  const prompt = it
    ? h('div', { class: 'ex-prompt speak-prompt', 'data-card': '' },
        politenessChip(it.register),
        h('div', { class: 'stack-row' }, pair,
          h('div', { class: 'stack' }, teWords(it, cx, size), h('p', { class: 'en', text: it.en }))))
    : null;

  // ---- recorder controls ----
  const status = h('p', { class: 'speak-status', role: 'status', 'aria-live': 'polite' });
  const recBtn = h('button', { type: 'button', class: 'speak-rec', 'aria-label': 'Record yourself' },
    sicon('mic', 'i-mic'), sicon('stop', 'i-stop'));
  const recLabel = h('span', { class: 'speak-rec-label', text: 'Record' });
  const mineBtn = h('button', { type: 'button', class: 'btn btn-secondary speak-mine', hidden: true },
    sicon('play'), h('span', { text: 'Play mine' }));
  const bothBtn = h('button', { type: 'button', class: 'btn btn-secondary speak-both', hidden: true },
    sicon('both'), h('span', { text: 'Play both' }));
  const noMic = h('div', { class: 'speak-nomic', hidden: true });
  const recRow = h('div', { class: 'speak-rec-row' }, recBtn, recLabel);
  const panel = h('div', { class: 'speak-panel' }, recRow, status, h('div', { class: 'speak-plays' }, mineBtn, bothBtn), noMic);

  // ---- action bar: skip, then the self-rating ----
  const skipBtn = h('button', { type: 'button', class: 'btn btn-quiet speak-skip', text: "Can't speak now" });
  const againBtn = h('button', { type: 'button', class: 'btn btn-secondary speak-again', hidden: true, text: 'Not yet' });
  const goodBtn = h('button', { type: 'button', class: 'btn btn-main speak-good', hidden: true, text: 'Sounded right' });
  const rateQ = h('p', { class: 'speak-rate-q', text: 'How did it sound next to the recording?' });
  // design 4 #3/#7: the question sits right above its two answers, in the bar, with the word and its
  // model audio beside it (the prompt card may have scrolled away on a phone)
  const rate = h('div', { class: 'speak-rate', hidden: true }, rateQ,
    it ? h('div', { class: 'speak-rate-word' }, audioButtons(it, cx), teWords(it, cx, 'md')) : null);
  const bar = h('div', { class: 'ex-actions speak-actions' }, rate, skipBtn, againBtn, goodBtn);
  // showVerdict hides bar.btn and appends Continue to bar.bar.
  const barCtl = { bar, btn: h('span', { hidden: true }) };

  root.append(h('h2', { class: 'ex-title', text: 'Say it aloud' }), prompt, panel, bar);
  el.replaceChildren(root);
  autoplay(it, cx);

  // ---- state ----
  function setMic(state) {
    root.dataset.mic = state;
    const off = state === 'none' || state === 'denied';
    recRow.hidden = off;
    noMic.hidden = !off;
    if (off) {
      noMic.replaceChildren(h('p', { class: 'ex-info speak-nomic-row' }, sicon('nomic'), h('span', { text: NO_MIC[state] })));
      skipBtn.className = 'btn btn-main speak-skip';
      skipBtn.textContent = 'Skip';
      status.textContent = '';
    }
    recBtn.setAttribute('aria-pressed', String(state === 'recording'));
    recBtn.setAttribute('aria-label', state === 'recording' ? 'Stop recording' : 'Record yourself');
    recLabel.textContent = state === 'recording' ? 'Stop' : state === 'recorded' ? 'Record again' : 'Record';
    const done = state === 'recorded';
    mineBtn.hidden = !done;
    bothBtn.hidden = !done || !hasModel(it);
    againBtn.hidden = !done;
    goodBtn.hidden = !done;
    rate.hidden = !done;
    recBtn.disabled = answered;
  }

  if (!recorder.supported()) setMic('none');
  else {
    setMic('ready');
    recorder.hasMic().then(ok => { if (alive && !ok && root.dataset.mic === 'ready') setMic('none'); });
  }

  function stopMine() {
    playRun += 1;
    if (mine) { try { mine.pause(); } catch { /* ignore */ } }
    for (const b of [mineBtn, bothBtn]) b.removeAttribute('data-playing');
  }

  function played(what) {
    root.dataset.played = root.dataset.played ? `${root.dataset.played},${what}` : what;
  }

  function playMine() {
    return new Promise(resolve => {
      if (!url) { resolve(false); return; }
      if (!mine) mine = h('audio', { class: 'speak-audio', hidden: true });
      if (!mine.isConnected) root.append(mine);
      const end = ok => { mine.removeEventListener('ended', onEnd); mine.removeEventListener('error', onErr); resolve(ok); };
      const onEnd = () => end(true);
      const onErr = () => end(false);
      mine.addEventListener('ended', onEnd);
      mine.addEventListener('error', onErr);
      mine.src = url;
      played('mine');
      const p = mine.play();
      if (p && typeof p.catch === 'function') p.catch(() => end(false));
    });
  }

  async function onRecord() {
    if (answered) return;
    if (starting) return;
    if (recorder.recording()) { finish(await recorder.stop()); return; }
    stopMine();
    audio.stop();
    // Not disabled while the mic starts: disabling drops keyboard focus to BODY (Q3d m1).
    starting = true;
    recBtn.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try {
      await recorder.start({ maxMs: 15000, onLimit: b => finish(b) });
    } catch (e) {
      starting = false;
      recBtn.removeAttribute('aria-busy');
      if (!alive) return;
      if (e && e.reason === 'denied') setMic('denied');
      else if (e && e.reason === 'busy') return;
      else setMic('none');
      return;
    }
    starting = false;
    recBtn.removeAttribute('aria-busy');
    if (!alive) { recorder.cancel(); return; }
    setMic('recording');
    status.textContent = 'Recording. Tap stop when you have finished.';
  }

  function finish(b) {
    if (!alive) return;
    if (url) URL.revokeObjectURL(url);
    blob = b && b.size ? b : null;
    url = blob ? URL.createObjectURL(blob) : null;
    root.dataset.bytes = String(blob ? blob.size : 0);
    if (!blob) {
      setMic('ready');
      status.textContent = 'Nothing was recorded. Try again, or skip this one.';
      return;
    }
    setMic('recorded');
    status.textContent = 'Recorded. Listen, then rate yourself.';
    showAboveBar(panel.querySelector('.speak-plays'));
  }

  // design 3 E1: the play buttons that appear are scrolled fully clear of the action bar and its fade
  function showAboveBar(node) {
    if (!node.isConnected || node.hidden) return;
    const r = node.getBoundingClientRect();
    const limit = bar.getBoundingClientRect().top - 20;   // the bar's 16 px fade, and a little air
    if (r.bottom > limit) window.scrollBy({ top: r.bottom - limit, behavior: 'instant' });
    // design 3 #2: nothing left half under the sticky header: a block it cuts goes fully out of sight
    const head = document.querySelector('.lesson-top');
    if (!head) return;
    const hb = head.getBoundingClientRect().bottom;
    const blocks = [...root.querySelectorAll('.ex-title, .speak-prompt, .speak-rec-row, .speak-status, .speak-plays')]
      .filter(b => b.offsetParent !== null && b.getBoundingClientRect().height > 0);
    for (const b of blocks) {
      const br = b.getBoundingClientRect();
      if (br.top < hb - 0.5 && br.bottom > hb + 0.5) {
        const d = br.bottom - hb;
        if (node.getBoundingClientRect().top - d >= hb) {
          // room to scroll that far: space above the sticky bar (inside the step, so the bar stays put)
          const lack = window.scrollY + d - (document.scrollingElement.scrollHeight - window.innerHeight);
          if (lack > 0) bar.style.marginTop = `${(parseFloat(getComputedStyle(bar).marginTop) || 0) + Math.ceil(lack)}px`;
          window.scrollBy({ top: d, behavior: 'instant' });
        }
        break;
      }
    }
  }

  recBtn.addEventListener('click', onRecord);
  recLabel.addEventListener('click', () => recBtn.click());

  mineBtn.addEventListener('click', async () => {
    stopMine();
    audio.stop();
    const run = playRun;
    mineBtn.setAttribute('data-playing', '');
    const ok = await playMine();
    if (run === playRun) mineBtn.removeAttribute('data-playing');
    if (!ok && url && alive) status.textContent = 'Your recording could not play. Tap to try again.';
  });

  bothBtn.addEventListener('click', async () => {
    stopMine();
    const run = playRun;
    bothBtn.setAttribute('data-playing', '');
    played('model');
    try {
      await audio.play(it, { voice: cx.settings.voice || 'f', slow: !!cx.settings.slow });
      if (pair && pair.ok) pair.ok();
    } catch {
      if (pair && pair.fail) pair.fail(); // Q3c S2: the model clip's failure is said under the prompt
    }
    if (run !== playRun || !alive) return;
    await new Promise(r => setTimeout(r, 300));
    if (run !== playRun || !alive) return;
    const ok = await playMine();
    if (run === playRun) bothBtn.removeAttribute('data-playing');
    if (!ok && url && alive) status.textContent = 'Your recording could not play. Tap to try again.';
  });

  function answer(value) {
    if (answered) return;
    answered = true;
    if (recorder.recording()) recorder.cancel();
    stopMine();
    for (const b of [recBtn, mineBtn, bothBtn, skipBtn, againBtn, goodBtn]) b.disabled = true;
    root.dataset.answer = value;
    onAnswer(value);
  }
  skipBtn.addEventListener('click', () => answer('skip'));
  againBtn.addEventListener('click', () => answer('again'));
  goodBtn.addEventListener('click', () => answer('good'));

  return {
    root,
    showResult(result) {
      revealRom(root);
      for (const b of [skipBtn, againBtn, goodBtn, rate]) b.hidden = true;
      // Recordings can still be played back after rating.
      mineBtn.disabled = false;
      bothBtn.disabled = false;
      // Q3d m4: "Not yet" is the learner's own rating, not the app's judgement: neutral wording.
      const self = result && !result.correct && !result.skipped && !result.close;
      showVerdict(root, barCtl, result, cx, [],
        self ? { word: SELF_AGAIN, icon: 'info', look: 'skipped' } : {});
    },
    destroy() {
      alive = false;
      recorder.cancel();
      stopMine();
      if (mine) { mine.removeAttribute('src'); mine.remove(); }
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}
