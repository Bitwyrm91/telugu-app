// report.js: "something is wrong here" reports (task E7; SPECS S3 "Reports", S10 "Report button").
//
//   KINDS                                  the five kinds, in sheet order
//   add({itemId, exercise, answer, kind, text}) -> Promise<report>
//       saves the report with sent:false (answer as JSON text cut to 500 chars, text cut to 1000),
//       then tries every unsent report (this one included). Resolves once the posts are done.
//   retry() -> Promise<number of reports sent>
//       posts every report that is neither sent nor failed to `report` (relative to the app's
//       own address). 2xx -> sent:true; 400 / 413 / 507 -> failed:true (never tried again);
//       anything else (static host 404/501, network down) leaves it unsent for the next start.
//       Never throws and never shows anything: a failed post is silent.

import * as store from './store.js';

export const KINDS = ['wrong-telugu', 'wrong-english', 'my-answer-should-count', 'audio', 'other'];
const FINAL = new Set([400, 413, 507]);

function cut(s, n) {
  const a = Array.from(String(s ?? ''));
  return a.length > n ? a.slice(0, n).join('') : a.join('');
}

function answerText(answer) {
  if (answer === undefined) return '';
  if (answer === null) return null; // no answer (an intro step): JSON null, not the text "null"
  let t;
  try { t = typeof answer === 'string' ? JSON.stringify(answer) : JSON.stringify(answer ?? null); } catch { t = ''; }
  return cut(t ?? '', 500);
}

export async function add({ itemId = null, exercise = {}, answer, kind, text = '' } = {}) {
  const report = {
    id: store.newId(),
    at: new Date().toISOString(),
    itemId: itemId ?? null,
    exercise: {
      type: exercise && exercise.type != null ? exercise.type : null,
      lessonId: exercise && exercise.lessonId != null ? exercise.lessonId : null,
      step: exercise && exercise.step != null ? exercise.step : null,
      // Q3b minor 8: every item of the exercise (a match has several), not only the first.
      itemIds: exercise && Array.isArray(exercise.itemIds) ? exercise.itemIds.map(String) : (itemId != null ? [String(itemId)] : []),
    },
    answer: answerText(answer),
    kind: KINDS.includes(kind) ? kind : 'other',
    text: cut(text, 1000),
    sent: false,
    failed: false,
  };
  const all = store.get('reports') || [];
  all.push(report);
  store.set('reports', all);
  await retry();
  return (store.get('reports') || []).find(r => r.id === report.id) || report;
}

let running = null;

function endpoint() {
  try { return new URL('report', document.baseURI).href; } catch { return 'report'; }
}

async function postOne(r) {
  const body = JSON.stringify(r);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store',
    });
    if (res.ok) return 'sent';
    if (FINAL.has(res.status)) return 'failed';
    return 'later';
  } catch {
    return 'later';
  }
}

function mark(id, field) {
  const all = store.get('reports') || [];
  const r = all.find(x => x.id === id);
  if (!r) return;
  r[field] = true;
  store.set('reports', all);
}

export function retry() {
  if (running) return running.then(() => retry());
  running = (async () => {
    let sent = 0;
    try {
      const todo = (store.get('reports') || []).filter(r => r && !r.sent && !r.failed);
      for (const r of todo) {
        const out = await postOne(r);
        if (out === 'sent') { mark(r.id, 'sent'); sent += 1; }
        else if (out === 'failed') mark(r.id, 'failed');
      }
    } catch { /* never surfaces */ }
    return sent;
  })();
  const p = running;
  p.finally(() => { if (running === p) running = null; });
  return p;
}
