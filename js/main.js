// main.js: app shell (task E1). Starts the router and shows each route's screen in <main>.
//
// Screen modules live in js/ui/ (PLAN 4.1) and are written by later tasks. Each exports
//   render(el, route) -> cleanup function, or nothing (may be async)
// where `el` is the <main> element (emptied first) and `route` = {name, params, path}.
// A screen may fill the Home side panel (#side, shown from 1100 px) and must un-hide it itself.
// Until a screen's module exists, the shell shows a plain "not built yet" state for it.

import { start, setRedirect } from './router.js';
import './store.js'; // first-run steps; shows the "can't be saved" banner when storage throws
import { retry as retryReports } from './report.js'; // E7: unsent reports are posted at every start (S3)
import { get as getStored } from './store.js'; // E10: first-run check below

// route name -> [module in js/ui/, screen title, layout]
// layout 'nav': main navigation shown. 'focus': navigation hidden (lesson, letter lesson,
// onboarding; DESIGN 5 "Inside a lesson"), content column max 560 px.
const SCREENS = {
  home: ['home', 'Learn', 'nav'],
  onboard: ['onboard', 'Welcome', 'focus'],
  lesson: ['lesson', 'Lesson', 'focus'],
  letters: ['letters', 'Letters', 'nav'],
  letterLesson: ['lesson', 'Letter lesson', 'focus'],
  notes: ['notes', 'Grammar note', 'nav'],
  settings: ['settings', 'Settings', 'nav'],
  devType: ['devtype', 'Typography', 'nav'],
};

// Which main-navigation entry a route belongs to.
const NAV_OF = { home: 'home', notes: 'home', letters: 'letters', settings: 'settings' };

const APP_NAME = 'Telugu';

const shell = document.getElementById('shell');
const main = document.getElementById('main');
const side = document.getElementById('side');
let cleanup = null;
let ticket = 0;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

function setNav(name) {
  const active = NAV_OF[name] || null;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function loading() {
  return el('div', { class: 'state-loading', 'aria-busy': 'true', 'aria-label': 'Loading' },
    el('div', { class: 'skeleton skeleton-title' }),
    el('div', { class: 'skeleton skeleton-card' }),
    el('div', { class: 'skeleton skeleton-card' }));
}

function notBuilt(title, name) {
  const box = el('section', { class: 'state-empty' },
    el('h1', { class: 'screen-title' }, title),
    el('p', {}, 'This screen is not built yet.'));
  if (name !== 'home') box.append(el('a', { class: 'btn btn-quiet', href: '#/' }, 'Go to Learn'));
  return box;
}

function failed(title) {
  return el('section', { class: 'state-error', role: 'alert' },
    el('h1', { class: 'screen-title' }, title),
    el('p', {}, 'Something went wrong while opening this screen. Reload the page to try again.'),
    el('button', { class: 'btn btn-secondary', type: 'button' }, 'Reload'));
}

async function show(route) {
  const mine = ++ticket;
  const [mod, title, layout] = SCREENS[route.name];
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* old screen gone */ } }
  cleanup = null;

  shell.dataset.layout = layout;
  shell.dataset.route = route.name;
  setNav(route.name);
  document.title = `${title} · ${APP_NAME}`;
  side.replaceChildren();
  side.hidden = true;
  main.replaceChildren(loading());
  window.scrollTo(0, 0);

  let screen = null;
  try {
    screen = await import(`./ui/${mod}.js`);
  } catch {
    screen = null; // not written yet (a later task)
  }
  if (mine !== ticket) return;

  if (!screen || typeof screen.render !== 'function') {
    main.replaceChildren(notBuilt(title, route.name));
  } else {
    main.replaceChildren();
    try {
      const out = await screen.render(main, route);
      if (mine !== ticket) { if (typeof out === 'function') out(); return; }
      cleanup = out;
    } catch (e) {
      console.error(e);
      if (mine !== ticket) return;
      const box = failed(title);
      box.querySelector('button').addEventListener('click', () => location.reload());
      main.replaceChildren(box);
    }
  }
  main.dataset.ready = 'true';
  // Q3d m5: on arrival focus is never left on BODY: the screen's own focus wins, else its heading.
  const a = document.activeElement;
  if (!a || a === document.body || !a.isConnected) {
    const head = main.querySelector('h1');
    if (head) {
      if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
      try { head.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }
  document.dispatchEvent(new CustomEvent('screen', { detail: route }));
}

main.dataset.ready = 'false';
retryReports();
// E10 / Q3c minor 2: before onboarding is done, every route goes to onboarding first (S10), on
// load and on every later route change (one rule in the router). A route other than home (say
// #/lesson/u01.l1) is kept and opened when onboarding finishes. Settings stays reachable (import on
// a new device), and the typography page is a developer page.
const FIRST_RUN_OPEN = new Set(['onboard', 'settings', 'devType']);
setRedirect(next => {
  let onboarded = true;
  try { onboarded = !!getStored('settings').onboarded; } catch { /* storage blocked: don't trap the app */ }
  if (onboarded || FIRST_RUN_OPEN.has(next.name)) return null;
  if (next.name !== 'home') {
    try { sessionStorage.setItem('telugu.after-onboard', '#' + next.path); } catch { /* storage blocked */ }
  }
  return '/onboard';
});
start(route => {
  main.dataset.ready = 'false';
  show(route);
});
