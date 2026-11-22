// markup.js: show HTML text as numbered, coloured lines, and change only the lines that differ when the text changes.
//
//   const view = new CodeView(container);
//   const { first, changed } = view.set(text, { marks, flash });
//
// `marks` is a Map of line index to a short label shown at the right of that line (the stream view marks where
// each chunk starts). With `flash`, lines that are new since the last call get the class "new" for one animation.

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const LONGEST = 2000;

// #region tokens
/**
 * Split HTML text into [class, text] pairs: 'c' comment, 'd' doctype, 't' tag name and brackets, 'a' attribute
 * name, 'v' attribute value, 'r' script or style content, '' text. It never throws: text that stops half way
 * through a tag (a stream that has not finished) is coloured as far as it goes.
 */
export function tokens(text) {
  const out = [];
  const n = text.length;
  const tagStart = /<\/?[a-zA-Z][^\s/>]*/y;
  const attr = /(\s+)|([^\s=/>]+)|(=)\s*("[^"]*"?|'[^']*'?|[^\s>]+)?|(\/?>)|(\/)/y;
  let i = 0;
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const stop = end < 0 ? n : end + 3;
      out.push(['c', text.slice(i, stop)]);
      i = stop;
      continue;
    }
    if (text.startsWith('<!', i)) {
      const end = text.indexOf('>', i);
      const stop = end < 0 ? n : end + 1;
      out.push(['d', text.slice(i, stop)]);
      i = stop;
      continue;
    }
    tagStart.lastIndex = i;
    const open = tagStart.exec(text);
    if (!open) {
      // Text up to the next thing that could be a tag.
      let next = text.indexOf('<', i + 1);
      if (next < 0) next = n;
      out.push(['', text.slice(i, next)]);
      i = next;
      continue;
    }
    out.push(['t', open[0]]);
    i = tagStart.lastIndex;
    const name = open[0].replace(/^<\/?/, '').toLowerCase();
    let closed = false;
    while (i < n && !closed) {
      attr.lastIndex = i;
      const m = attr.exec(text);
      if (!m) break;
      i = attr.lastIndex;
      if (m[1]) out.push(['', m[1]]);
      else if (m[2]) out.push(['a', m[2]]);
      else if (m[3]) { out.push(['', '=']); if (m[4]) out.push(['v', m[4]]); }
      else if (m[5]) { out.push(['t', m[5]]); closed = true; }
      else out.push(['', m[6]]);
    }
    // The content of a script or style element is not markup: take it whole, up to its end tag.
    if (closed && open[0][1] !== '/' && (name === 'script' || name === 'style')) {
      const close = new RegExp(`</${name}`, 'gi');
      close.lastIndex = i;
      const end = close.exec(text);
      const stop = end ? end.index : n;
      if (stop > i) out.push(['r', text.slice(i, stop)]);
      i = stop;
    }
  }
  return out;
}
// #endregion tokens

/** The text as one string of HTML per line. */
export function markupLines(text) {
  const lines = [];
  let line = '', length = 0, cut = 0;
  const flush = () => {
    lines.push(cut ? `${line}<span class="more"> … ${cut.toLocaleString('en')} more characters on this line</span>` : line);
    line = '';
    length = 0;
    cut = 0;
  };
  for (const [cls, value] of tokens(text)) {
    const parts = value.split('\n');
    parts.forEach((part, index) => {
      if (index) flush();
      if (!part) return;
      // One very long line (a menu built by script, a minified file) is cut, and the cut is counted.
      const room = LONGEST - length;
      const shown = room <= 0 ? '' : part.length > room ? part.slice(0, room) : part;
      cut += part.length - shown.length;
      length += shown.length;
      if (shown) line += cls ? `<span class="${cls}">${esc(shown)}</span>` : esc(shown);
    });
  }
  flush();
  return lines;
}

// #region patch
export class CodeView {
  #lines = [];
  constructor(container) {
    this.container = container;
    container.classList.add('code');
  }

  get length() { return this.#lines.length; }

  /**
   * Show `text`. Lines that are the same at the start and at the end of the old and the new text keep their
   * elements. Only the lines between are replaced. Returns the index of the first replaced line and how many.
   */
  set(text, { marks = null, flash = false } = {}) {
    const next = markupLines(text);
    const old = this.#lines;
    let head = 0;
    while (head < old.length && head < next.length && old[head] === next[head]) head++;
    let tail = 0;
    while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
    const rows = this.container.children;
    for (let i = old.length - tail - 1; i >= head; i--) rows[i].remove();
    const added = next.length - tail - head;
    if (added > 0) {
      const html = next.slice(head, head + added).map((line) => `<div class="l${flash ? ' new' : ''}">${line}</div>`).join('');
      if (head < rows.length) rows[head].insertAdjacentHTML('beforebegin', html);
      else this.container.insertAdjacentHTML('beforeend', html);
    }
    this.#lines = next;
    if (flash && added > 0) {
      const fresh = [...rows].slice(head, head + added);
      setTimeout(() => { for (const row of fresh) row.classList.remove('new'); }, 1700);
    }
    for (const row of this.container.querySelectorAll('[data-mark]')) row.removeAttribute('data-mark');
    if (marks) for (const [index, label] of marks) rows[index]?.setAttribute('data-mark', label);
    return { first: head, changed: Math.max(added, old.length - tail - head), lines: next.length };
  }

  /** The element of a line. */
  row(index) { return this.container.children[index] ?? null; }
}
// #endregion patch

/** The styles a CodeView needs, for the document or shadow root that holds it. */
export const CODE_CSS = `
.code { counter-reset: line; font: 12px/1.55 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; tab-size: 2; color: #c9d1e0; padding: 8px 0 40vh; }
.code .l { counter-increment: line; position: relative; min-height: 1.55em; padding: 0 10px 0 4.2em; white-space: pre-wrap; overflow-wrap: anywhere; }
.code .l::before { content: counter(line); position: absolute; left: 0; width: 3.4em; text-align: right; color: #5d6679; user-select: none; }
.code .l[data-mark] { box-shadow: inset 0 1px 0 #3d4a66; }
.code .l[data-mark]::after { content: attr(data-mark); position: absolute; right: 6px; top: 0; padding: 0 6px; border-radius: 0 0 6px 6px; background: #3d4a66; color: #e8ecf5; font-size: 10.5px; }
.code .l.new { animation: code-new 1.6s ease-out; }
@keyframes code-new { from { background: #7a5b12; } to { background: transparent; } }
.code .t { color: #7fb4ff; } .code .a { color: #f0c060; } .code .v { color: #8fd6a0; }
.code .c { color: #7b8496; font-style: italic; } .code .d { color: #c792ea; } .code .r { color: #a9b3c6; }
.code .more { color: #ff9d7a; font-style: italic; }
@media (prefers-reduced-motion: reduce) { .code .l.new { animation: none; box-shadow: inset 3px 0 0 #f0c060; } }
`;
