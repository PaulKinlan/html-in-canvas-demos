// under.js: the layer under the page on /view-source/. Two tabs of source text and a bar of controls.
//
//   const under = mountUnder(section, { roots: () => [shadowRoots to write out], shown: () => true when the layer can be seen, onBack });
//   under.sent          a promise for what readSent() returned
//   under.refresh()     call when the layer comes into view
//
// Everything is built inside a shadow root on `section`. That is what keeps the live view from showing itself:
// a shadow root is not written by outerHTML, and its changes do not reach a MutationObserver on the document.

import { CodeView, CODE_CSS } from './markup.js';
import { readSent, serialise, watch } from './sources.js';

const CSS = `
:host { display: flex; flex-direction: column; color: #e8ecf5; font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
/* A partly peeled page uncovers the right of this layer first. On a wide window everything keeps to a column there until the page is off. */
header { flex: none; padding: 10px 12px 8px; padding-left: max(12px, 100% - 500px); background: #1b1f29; border-bottom: 1px solid #2e3545; display: grid; gap: 8px; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
button { font: inherit; min-height: 40px; padding: 6px 12px; border-radius: 6px; border: 1px solid #3a4358; background: #232936; color: inherit; cursor: pointer; }
button:focus-visible, .panel:focus-visible, input:focus-visible { outline: 2px solid #ff7a4d; outline-offset: 1px; }
button[role="tab"][aria-selected="true"] { background: #e8ecf5; color: #14161b; border-color: #e8ecf5; font-weight: 600; }
#status { margin: 0; min-height: 4.2em; color: #a9b3c6; font-size: 13px; overflow-wrap: anywhere; }
.tools { display: flex; gap: 6px 12px; flex-wrap: wrap; align-items: center; }
label { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
input[type="checkbox"] { width: 18px; height: 18px; }
.panel { flex: 1; min-height: 0; overflow: auto; position: relative; overscroll-behavior: contain; }
.panel.code { padding-left: max(0px, 100% - 512px); }
:host([data-state="away"]) header { padding-left: 12px; }
:host([data-state="away"]) .panel.code { padding-left: 0; }
[hidden] { display: none !important; }
`;

const n = (value) => Math.round(value).toLocaleString('en');

export function mountUnder(section, { url = location.pathname, roots = () => [], shown = () => true, onBack = () => {} } = {}) {
  const root = section.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}${CODE_CSS}</style>
<header>
  <div class="tabs" role="tablist" aria-label="Which source to show">
    <button type="button" role="tab" id="tab-sent" aria-controls="sent" aria-selected="true">Sent by the server</button>
    <button type="button" role="tab" id="tab-live" aria-controls="live" aria-selected="false" tabindex="-1">Live DOM</button>
  </div>
  <p id="status">Not asked for yet.</p>
  <div class="tools">
    <button type="button" id="again">Fetch again</button>
    <label id="follow-label" hidden><input type="checkbox" id="follow" checked> Follow changes</label>
    <button type="button" id="back">Put the page back</button>
  </div>
</header>
<div class="panel" id="sent" role="tabpanel" aria-labelledby="tab-sent" tabindex="0"></div>
<div class="panel" id="live" role="tabpanel" aria-labelledby="tab-live" tabindex="0" hidden></div>`;
  const $ = (id) => root.getElementById(id);
  const sentView = new CodeView($('sent'));
  const liveView = new CodeView($('live'));
  let tab = 'sent';
  const status = { sent: 'Not asked for yet.', live: 'Not written out yet.' };
  const say = (which, text) => { status[which] = text; if (which === tab) $('status').textContent = text; };

  // ---- tab 1: the HTML the server sends ----
  // #region sent
  const navigation = performance.getEntriesByType('navigation')[0];
  async function loadSent() {
    say('sent', 'Asking the server for this page again.');
    let lineOf = 0, counted = 0;
    const marks = new Map();
    const result = await readSent(url, ({ text, chunks, bytes }) => {
      // Mark the line each chunk starts on. Count line breaks only in the text that is new.
      const last = chunks[chunks.length - 1];
      for (let i = text.indexOf('\n', counted); i >= 0 && i < last.offset; i = text.indexOf('\n', i + 1)) lineOf++;
      counted = last.offset;
      marks.set(lineOf, `chunk ${chunks.length} · ${n(last.bytes)} bytes · ${last.at.toFixed(0)} ms`);
      sentView.set(text, { marks });
      say('sent', `${n(bytes)} bytes so far, in ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'}.`);
    });
    const { lines } = sentView.set(result.text, { marks });
    result.lines = lines;
    // The page the parser read came from another response. Its length is in the navigation timing entry.
    result.parsedBytes = navigation?.decodedBodySize || 0;
    const same = !result.parsedBytes ? '' : result.parsedBytes === result.bytes
      ? ' The response this page was parsed from had the same number of bytes.'
      : ` The response this page was parsed from had ${n(result.parsedBytes)} bytes.`;
    say('sent', `${n(result.bytes)} bytes in ${result.chunks.length} ${result.chunks.length === 1 ? 'chunk' : 'chunks'}, ${n(lines)} lines, first byte after ${result.firstByte.toFixed(0)} ms. Status ${result.status}, ${result.type || 'no content type'}${result.encoding ? `, ${result.encoding}` : ''}.${same} This text does not change while the page runs.`);
    return result;
  }
  // #endregion sent
  const failed = (err) => { say('sent', `The page could not be fetched again: ${err.message}`); return null; };
  let sent = loadSent().catch(failed);
  $('again').onclick = () => { sent = loadSent().catch(failed); };

  // ---- tab 2: the DOM as it is now ----
  // #region live
  let dirty = true, timer = 0, written = false, last = '';
  const { counts } = watch(document, (change) => {
    last = change.last;
    dirty = true;
    schedule();
  });
  // Writing the whole document out costs a few milliseconds, so it is done at most four times a second, and
  // only while the layer can be seen with this tab open. Changes made meanwhile are still counted.
  function schedule() {
    if (timer || tab !== 'live' || !shown()) return;
    timer = setTimeout(() => { timer = 0; writeLive(); }, written ? 250 : 0);
  }
  function writeLive() {
    if (!dirty || tab !== 'live' || !shown()) return;
    dirty = false;
    const text = serialise(document, roots());
    const { first, changed, lines } = liveView.set(text, { flash: written });
    say('live', `${n(text.length)} characters, ${n(lines)} lines now. ${n(counts.total)} changes since the page loaded: ${n(counts.attributes)} to attributes, ${n(counts.characterData)} to text, ${n(counts.childList)} to lists of children.${last ? ` Last: ${last}.` : ''}`);
    // Bring the first changed line near the top, where a partly peeled page leaves room to see it.
    if (written && changed && $('follow').checked) {
      const row = liveView.row(first);
      if (row) $('live').scrollTop = Math.max(0, row.offsetTop - 64);
    }
    written = true;
  }
  // Scrolling by hand means the reader wants to stay where they are.
  for (const type of ['wheel', 'touchmove', 'keydown']) $('live').addEventListener(type, () => { $('follow').checked = false; }, { passive: true });
  // #endregion live

  function show(name) {
    tab = name;
    for (const which of ['sent', 'live']) {
      const on = which === name;
      $(`tab-${which}`).setAttribute('aria-selected', String(on));
      $(`tab-${which}`).tabIndex = on ? 0 : -1;
      $(which).hidden = !on;
    }
    $('again').hidden = name !== 'sent';
    $('follow-label').hidden = name !== 'live';
    $('status').textContent = status[name];
    schedule();
  }
  for (const which of ['sent', 'live']) {
    $(`tab-${which}`).onclick = () => show(which);
    $(`tab-${which}`).onkeydown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const other = which === 'sent' ? 'live' : 'sent';
      show(other);
      $(`tab-${other}`).focus();
    };
  }
  $('back').onclick = () => onBack();

  return {
    root,
    get sent() { return sent; },
    get tab() { return tab; },
    counts,
    show,
    refresh: schedule,
    /** The text of the live tab, written now. For live checks. */
    liveText: () => serialise(document, roots()),
  };
}
