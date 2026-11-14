// router.js: hash router (SPECS S10 "Routes").
//   #/ home path · #/onboard · #/lesson/<lessonId> · #/letters · #/letters/<lessonId>
//   #/notes/<unitId> · #/settings · #/dev/type. Unknown route -> home.
// Phase 4 adds #/review and #/stats: add rows to ROUTES then.

const ROUTES = [
  { re: /^\/$/, name: 'home', keys: [] },
  { re: /^\/onboard$/, name: 'onboard', keys: [] },
  { re: /^\/lesson\/([^/]+)$/, name: 'lesson', keys: ['lessonId'] },
  { re: /^\/letters$/, name: 'letters', keys: [] },
  { re: /^\/letters\/([^/]+)$/, name: 'letterLesson', keys: ['lessonId'] },
  { re: /^\/notes\/([^/]+)$/, name: 'notes', keys: ['unitId'] },
  { re: /^\/settings$/, name: 'settings', keys: [] },
  { re: /^\/dev\/type$/, name: 'devType', keys: [] },
];

export const HOME = Object.freeze({ name: 'home', params: {}, path: '/' });

/** parse('#/lesson/u01.l1') -> {name: 'lesson', params: {lessonId: 'u01.l1'}, path: '/lesson/u01.l1'}.
 *  Returns null for an unknown route. '' and '#' are home. */
export function parse(hash) {
  let path = String(hash ?? '').replace(/^#/, '');
  if (path === '') path = '/';
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    try {
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    } catch {
      return null; // malformed escape
    }
    if (Object.values(params).some(v => v.trim() === '')) return null;
    return { name: r.name, params, path };
  }
  return null;
}

/** The hash for a route name and params: href('lesson', {lessonId: 'u01.l1'}) -> '#/lesson/u01.l1'. */
export function href(name, params = {}) {
  const r = ROUTES.find(x => x.name === name);
  if (!r) throw new Error(`unknown route ${name}`);
  let i = 0;
  const path = r.re.source
    .replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')
    .replace(/\(\[\^\/\]\+\)/g, () => encodeURIComponent(params[r.keys[i++]]));
  return '#' + path;
}

let current = null;
let guard = null;
let listener = null;
let onRoute = null;

/** The route now shown. */
export function currentRoute() { return current; }

/** Go to a hash such as '#/settings' (or a path '/settings'). */
export function go(hash) {
  const h = hash.startsWith('#') ? hash : '#' + hash;
  if (location.hash === h) return;
  location.hash = h;
}

/** guard(next, current) -> false keeps the current screen (e.g. "leave the lesson?").
 *  One guard at a time; setGuard(null) removes it. A screen sets it and clears it itself. */
export function setGuard(fn) { guard = typeof fn === 'function' ? fn : null; }

let redirect = null;

/** redirect(next) -> a path such as '/onboard' to show instead of `next` (the address is replaced,
 *  not added to history), or null. One for the whole app (main.js: first run -> onboarding). */
export function setRedirect(fn) { redirect = typeof fn === 'function' ? fn : null; }

function resolve() {
  let next = parse(location.hash);
  if (!next) {
    next = HOME;
    // Unknown route -> home, without leaving the bad hash in history.
    history.replaceState(history.state, '', location.pathname + location.search + '#/');
  }
  const to = redirect && redirect(next);
  if (to && to !== next.path && parse('#' + to)) {
    history.replaceState(history.state, '', location.pathname + location.search + '#' + to);
    next = parse('#' + to);
  }
  if (current && next.path === current.path) return;
  if (guard && current && guard(next, current) === false) {
    // S5: keep the current screen without losing a history entry. An entry seen before (browser
    // Back / Forward) gets the current screen pushed on top again, so Back asks again; a new entry
    // (a link or go()) is stepped back from.
    if (seen(history.state)) {
      history.pushState({ ...history.state, [MARK]: ++seq }, '', location.pathname + location.search + '#' + current.path);
    } else {
      history.back();
    }
    return;
  }
  if (!seen(history.state)) {
    try { history.replaceState({ ...(history.state || {}), [MARK]: ++seq }, ''); } catch { /* state not cloneable */ }
  }
  current = next;
  onRoute(next);
}

const MARK = '__route';
let seq = 0;
function seen(state) { return !!(state && typeof state === 'object' && typeof state[MARK] === 'number'); }

/** Start routing: calls handler(route) now and on every route change. */
export function start(handler) {
  onRoute = handler;
  if (listener) window.removeEventListener('hashchange', listener);
  listener = () => resolve();
  window.addEventListener('hashchange', listener);
  current = null;
  resolve();
}
