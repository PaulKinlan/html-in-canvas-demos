// freeze-log.js: find out when the browser stopped this page.
//
//   import { freezeLog, onThaw } from '/lib/freeze-log.js';
//   onThaw((gap) => status.textContent = `This tab was stopped for ${gap.seconds} s`);
//
// A hidden tab is first throttled, then frozen: no timers, no paint events,
// no messages handled. Chrome on Android freezes a hidden tab after about a
// minute, desktop Chrome under Energy Saver or memory pressure. A page that is
// the source of a stream goes silent at that moment and nothing tells the
// viewer. This module records it three ways:
//   'freeze' / 'resume'   the Page Lifecycle events, when the browser sends them
//   'hidden' / 'visible'  visibilitychange
//   'stalled'             a one-second timer that fired more than 5 s late,
//                         which catches stops that sent no event
// Entries are kept in sessionStorage so they survive the freeze itself.
const KEY = 'freeze-log';
const read = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
};
const listeners = new Set();
function add(type, extra = {}) {
  const entry = { type, at: Date.now(), page: location.pathname, ...extra };
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...read(), entry].slice(-40)));
  } catch {}
  return entry;
}

let frozenAt = 0;
let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
let tick = Date.now();

document.addEventListener('freeze', () => {
  frozenAt = Date.now();
  add('freeze', { hiddenFor: hiddenAt ? Math.round((frozenAt - hiddenAt) / 1000) : null });
});
document.addEventListener('resume', () => {
  const seconds = frozenAt ? Math.round((Date.now() - frozenAt) / 1000) : null;
  const entry = add('resume', { seconds, hiddenFor: hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : null });
  frozenAt = 0;
  tick = Date.now();
  for (const fn of listeners) fn({ ...entry, how: 'freeze event' });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  add(document.visibilityState, document.visibilityState === 'visible' && hiddenAt ? { hiddenFor: Math.round((Date.now() - hiddenAt) / 1000) } : {});
  if (document.visibilityState === 'visible') hiddenAt = 0;
});
setInterval(() => {
  const late = Date.now() - tick - 1000;
  tick = Date.now();
  // Hidden tabs are throttled to one timer a second, sometimes one a minute; only a longer gap is a stop.
  if (late > 5000 && !frozenAt) {
    const entry = add('stalled', { seconds: Math.round(late / 1000) });
    for (const fn of listeners) fn({ ...entry, how: 'timer gap' });
  }
}, 1000);

/** Every recorded entry for this tab, oldest first: { type, at, page, seconds?, hiddenFor? }. */
export const freezeLog = () => read();
/** Call fn({ seconds, hiddenFor, how }) each time the page runs again after being stopped. */
export function onThaw(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** One line per entry, for showing on a page. */
export function describeFreezeLog(entries = read()) {
  return entries.map((e) => {
    const t = new Date(e.at).toLocaleTimeString();
    if (e.type === 'freeze') return `${t} frozen by the browser${e.hiddenFor != null ? ` after ${e.hiddenFor} s hidden` : ''} (${e.page})`;
    if (e.type === 'resume') return `${t} resumed${e.seconds != null ? ` after ${e.seconds} s frozen` : ''} (${e.page})`;
    if (e.type === 'stalled') return `${t} timers had stopped for ${e.seconds} s with no freeze event (${e.page})`;
    return `${t} ${e.type}${e.hiddenFor != null ? ` after ${e.hiddenFor} s` : ''} (${e.page})`;
  });
}
