// sources.js: the two things /view-source/ shows under the page.
//
//   readSent(url, onChunk)        the HTML as the server sends it, read from the response stream
//   serialise(document, roots)    the DOM as it is now, as text
//   watch(document, onChange)     count every change to the DOM and say when to serialise again

// #region stream
/**
 * Ask the server for `url` again and read the body as it arrives. `onChunk` is called after every chunk with
 * the text so far. Resolves with the whole text, the chunks ({ bytes, at, offset }) and the response headers.
 * `cache: 'no-store'` makes the browser go to the network, so the chunks are the ones the server sent now.
 */
export async function readSent(url, onChunk = () => {}) {
  const started = performance.now();
  const response = await fetch(url, { cache: 'no-store' });
  const firstByte = performance.now() - started;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let text = '', bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // `offset` is where this chunk's text starts. A chunk can end in the middle of a tag or of a UTF-8
    // character. The decoder keeps the unfinished bytes for the next call.
    chunks.push({ bytes: value.byteLength, at: performance.now() - started, offset: text.length });
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    onChunk({ text, chunks, bytes });
  }
  text += decoder.decode();
  return {
    text, chunks, bytes, firstByte,
    ms: performance.now() - started,
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    encoding: response.headers.get('content-encoding') ?? '',
  };
}
// #endregion stream

// #region serialise
/**
 * The document as text, the way outerHTML writes it, plus the shadow roots listed in `roots`.
 * outerHTML leaves every shadow root out. getHTML() writes the ones it is given as
 * <template shadowrootmode="open">, which is how the canvas that draws the page gets into the text.
 */
export function serialise(doc, roots = []) {
  const root = doc.documentElement;
  const inner = root.getHTML ? root.getHTML({ shadowRoots: roots }) : root.innerHTML;
  // The <html> tag itself, with its attributes as they are now.
  const tag = root.cloneNode(false).outerHTML.replace(/<\/html>$/i, '');
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '';
  return `${doctype}${tag}${inner}</html>`;
}
// #endregion serialise

// #region watch
/**
 * Watch every node of the document. Changes inside a shadow root are not reported to an observer on the
 * document, so a view that lives in a shadow root can show the document without seeing its own updates.
 */
export function watch(doc, onChange) {
  const counts = { attributes: 0, characterData: 0, childList: 0, total: 0 };
  const name = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return 'the document';
    return `<${el.localName}${el.id ? ` id="${el.id}"` : ''}>`;
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) { counts[r.type]++; counts.total++; }
    const r = records[records.length - 1];
    const what = r.type === 'attributes' ? `the ${r.attributeName} attribute of ${name(r.target)}` : r.type === 'characterData' ? `text in ${name(r.target)}` : `the children of ${name(r.target)}`;
    onChange({ counts, last: what });
  });
  observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
  return { counts, stop: () => observer.disconnect() };
}
// #endregion watch
