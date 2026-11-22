// under.js: the layer under the page on /view-source/ and /view-dom/. It holds source text and nothing else.
//
//   const sent = mountSent(section);                 the HTML as the server sends it
//   const result = await sent.load();                fetch it (again) and show it as it arrives
//
//   const live = mountLive(section, { roots, shown, ignore, onStats });   the DOM as it is now
//   live.refresh()                                   call when the layer comes into view
//
// The lines are built inside a shadow root on `section`. That is what keeps the live view from showing itself:
// a shadow root is not written by getHTML() unless it is asked for, and its changes do not reach a
// MutationObserver on the document.

import { CodeView, CODE_CSS } from './markup.js';
import { readSent, serialise, watch } from './sources.js';

const CSS = `
:host { display: block; }
.panel { height: 100%; overflow: auto; overscroll-behavior: contain; position: relative; box-sizing: border-box; }
.panel:focus-visible { outline: 2px solid #ff7a4d; outline-offset: -2px; }
/* A partly peeled page uncovers the right of this layer first. On a wide window the text keeps to a column there until the page is off. */
.panel.code { padding-left: max(0px, 100% - 512px); }
:host([data-state="away"]) .panel.code { padding-left: 0; }
`;

function build(section, label) {
  const root = section.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}${CODE_CSS}</style><div class="panel" tabindex="0" role="region"></div>`;
  const panel = root.firstElementChild.nextElementSibling;
  panel.setAttribute('aria-label', label);
  return { root, panel, view: new CodeView(panel) };
}

// #region sent
export function mountSent(section, { url = location.pathname } = {}) {
  const { root, panel, view } = build(section, 'The HTML of this page as the server sent it');
  const navigation = performance.getEntriesByType('navigation')[0];
  async function load() {
    try {
      // The text is shown after every chunk, so a slow response is seen arriving.
      const result = await readSent(url, ({ text }) => view.set(text));
      result.lines = view.set(result.text).lines;
      // The page the parser read came from another response. Its length is in the navigation timing entry.
      result.parsedBytes = navigation?.decodedBodySize || 0;
      return result;
    } catch (err) {
      view.set(`<!-- The page could not be fetched again: ${err.message} -->`);
      return null;
    }
  }
  return { root, panel, view, load };
}
// #endregion sent

// #region live
export function mountLive(section, { roots = () => [], shown = () => true, ignore = null, onStats = () => {} } = {}) {
  const { root, panel, view } = build(section, 'The DOM of this page as it is now');
  let dirty = true, timer = 0, written = false, handsOff = 0;
  const stats = { counts: null, last: '', characters: 0, lines: 0 };
  const watcher = watch(document, (change) => {
    stats.last = change.last;
    dirty = true;
    onStats(stats);
    schedule();
  }, { ignore });
  stats.counts = watcher.counts;
  // Writing the whole document out costs a few milliseconds, so it is done at most four times a second,
  // and only while the layer can be seen. Changes made meanwhile are still counted.
  function schedule() {
    if (timer || !shown()) return;
    timer = setTimeout(() => { timer = 0; write(); }, written ? 250 : 0);
  }
  function write() {
    if (!dirty || !shown()) return;
    dirty = false;
    const text = serialise(document, roots());
    const { first, changed, lines } = view.set(text, { flash: written });
    stats.characters = text.length;
    stats.lines = lines;
    onStats(stats);
    // Bring the first changed line near the top, where a partly peeled page leaves room to see it.
    // Not while the reader is scrolling the text, or for five seconds after.
    if (written && changed && performance.now() > handsOff) {
      const row = view.row(first);
      if (row) panel.scrollTop = Math.max(0, row.offsetTop - 64);
    }
    written = true;
  }
  for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) panel.addEventListener(type, () => { handsOff = performance.now() + 5000; }, { passive: true });
  return { root, panel, view, stats, refresh: schedule, text: () => serialise(document, roots()) };
}
// #endregion live
