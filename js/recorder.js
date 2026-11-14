// recorder.js: records the learner's voice for the speak exercise (task E9; PLAN 4.5).
//
//   supported()   -> bool            MediaRecorder and getUserMedia exist (false on plain http,
//                                    where getUserMedia is missing, and in old browsers)
//   hasMic()      -> Promise<bool>   false when the browser lists no audio input (or can't record)
//   start({maxMs, onLimit}) -> Promise  asks for the microphone and starts recording; rejects with an
//                                    Error whose `reason` is 'unsupported' | 'denied' | 'nomic' | 'busy';
//                                    onLimit(blob) gets the recording when maxMs ends it
//   stop()        -> Promise<Blob>   stops and returns the recording (an empty Blob if none ran)
//   cancel()                         stops without keeping anything
//   recording()   -> bool
//
// The microphone is released (tracks stopped) as soon as a recording ends, so the browser's
// "in use" indicator goes off. Recordings stay in memory only; nothing is stored or sent.
// A recording stops by itself after maxMs (default 15 s).

let rec = null;      // {mr, stream, chunks, done: Promise<Blob>, timer}

export function supported() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function'
    && !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

export async function hasMic() {
  if (!supported()) return false;
  const md = navigator.mediaDevices;
  if (typeof md.enumerateDevices !== 'function') return true; // can't tell; start() will find out
  try {
    const list = await md.enumerateDevices();
    return list.some(d => d.kind === 'audioinput');
  } catch {
    return true;
  }
}

export function recording() {
  return !!rec;
}

function fail(reason, cause) {
  const e = new Error(`recorder: ${reason}`);
  e.reason = reason;
  if (cause) e.cause = cause;
  return e;
}

function release(stream) {
  try { for (const t of stream.getTracks()) t.stop(); } catch { /* already gone */ }
}

function pickType() {
  const MR = window.MediaRecorder;
  if (typeof MR.isTypeSupported !== 'function') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    try { if (MR.isTypeSupported(t)) return t; } catch { /* ignore */ }
  }
  return '';
}

export async function start(opts = {}) {
  if (!supported()) throw fail('unsupported');
  if (rec) throw fail('busy');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const n = e && e.name;
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') throw fail('nomic', e);
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') throw fail('denied', e);
    throw fail('nomic', e);
  }
  if (rec) { release(stream); throw fail('busy'); }
  const type = pickType();
  let mr;
  try {
    mr = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
  } catch (e) {
    release(stream);
    throw fail('unsupported', e);
  }
  const chunks = [];
  const me = { mr, stream, chunks, timer: 0 };
  me.done = new Promise(resolve => {
    mr.addEventListener('dataavailable', ev => { if (ev.data && ev.data.size) chunks.push(ev.data); });
    mr.addEventListener('stop', () => {
      release(stream);
      resolve(new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' }));
    });
  });
  try {
    mr.start();
  } catch (e) {
    release(stream);
    throw fail('unsupported', e);
  }
  rec = me;
  const maxMs = Number(opts.maxMs) > 0 ? Number(opts.maxMs) : 15000;
  me.timer = setTimeout(() => { if (rec === me) { try { mr.stop(); } catch { /* stopped */ } } }, maxMs);
  // Stopped by the time limit (or the track ended): hand the recording to opts.onLimit.
  me.done.then(blob => {
    clearTimeout(me.timer);
    if (rec !== me) return;
    rec = null;
    if (typeof opts.onLimit === 'function') opts.onLimit(blob);
  });
  return true;
}

export async function stop() {
  const me = rec;
  if (!me) return new Blob([], { type: 'audio/webm' });
  rec = null;
  clearTimeout(me.timer);
  if (me.mr.state !== 'inactive') {
    try { me.mr.stop(); } catch { /* already stopped */ }
  }
  return me.done;
}

export function cancel() {
  const me = rec;
  rec = null;
  if (!me) return;
  clearTimeout(me.timer);
  try { if (me.mr.state !== 'inactive') me.mr.stop(); } catch { /* ignore */ }
  release(me.stream);
}
