// A share card: an HTML figure that a canvas draws at the size of the picture
// to save. The figure is a `drawable` child of the canvas, so CSS lays it out
// and styles it, and canvas.toBlob() turns the result into a PNG.

export const FORMATS = {
  wide: { name: 'Link preview, 1200 × 630', width: 1200, height: 630, scale: 2 },
  square: { name: 'Square, 1080 × 1080', width: 1080, height: 1080, scale: 2 },
  tall: { name: 'Story, 1080 × 1920', width: 1080, height: 1920, scale: 3 },
};
export const THEMES = ['paper', 'ink', 'dawn'];

// #region quote
// The selected text with its emphasis. Only a few inline elements are kept,
// everything else is flattened to text, so no link, script or style comes along.
const KEEP = new Set(['EM', 'I', 'STRONG', 'B', 'CODE']);
export function quoteFrom(range, max = 420) {
  const out = document.createElement('span');
  let left = max;
  (function copy(from, to) {
    for (const node of from.childNodes) {
      if (left <= 0) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.data.replace(/\s+/g, ' ');
        to.append(text.length > left ? text.slice(0, left).trimEnd() + '…' : text);
        left -= text.length;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (/^(P|H[1-6]|LI|DIV|BLOCKQUOTE)$/.test(node.tagName) && to.textContent && !/\s$/.test(to.textContent)) to.append(' ');
        if (KEEP.has(node.tagName)) { const el = document.createElement(node.tagName); to.append(el); copy(node, el); }
        else copy(node, to);
      }
    }
  })(range.cloneContents(), out);
  return out;
}
// #endregion quote

/** Wire a canvas and its figure. Returns the card's controls. */
export function createCard(canvas, face) {
  const ctx = canvas.getContext('2d');
  const quote = face.querySelector('blockquote');
  let format = FORMATS.wide;
  let fontSize = 0;

  // #region draw
  // The figure is laid out at width/scale CSS pixels and drawn at the full
  // size of the picture. The browser draws it again at that size from its
  // paint record, so the text is as sharp as text laid out at full size.
  function draw() {
    ctx.reset();
    ctx.drawElementImage(face, 0, 0, canvas.width, canvas.height);
  }
  canvas.addEventListener('paint', draw);
  // #endregion draw

  // #region fit
  // The largest font size at which the quote fits the card.
  function fit() {
    let low = 11, high = Math.round(format.height / format.scale / 4.5);
    while (high - low > 0.5) {
      const mid = (low + high) / 2;
      quote.style.fontSize = mid + 'px';
      if (face.scrollHeight <= face.clientHeight && face.scrollWidth <= face.clientWidth) low = mid; else high = mid;
    }
    fontSize = Math.floor(low * 2) / 2;
    quote.style.fontSize = fontSize + 'px';
    if (face.scrollHeight > face.clientHeight) { fontSize -= 1; quote.style.fontSize = fontSize + 'px'; }
    canvas.requestPaint?.();
  }
  // #endregion fit

  function setFormat(key) {
    format = FORMATS[key] ?? FORMATS.wide;
    face.style.setProperty('--w', format.width / format.scale + 'px');
    face.style.setProperty('--h', format.height / format.scale + 'px');
    canvas.style.aspectRatio = `${format.width} / ${format.height}`;
    if (canvas.width !== format.width) canvas.width = format.width;
    if (canvas.height !== format.height) canvas.height = format.height;
    fit();
  }

  return {
    get format() { return format; },
    get fontSize() { return fontSize; },
    draw, fit, setFormat,
    setTheme(name) { for (const t of THEMES) face.classList.toggle(t, t === name); fit(); },
    setQuote(content) { quote.replaceChildren(content); fit(); },
    // #region export
    /** The card as a PNG blob. Draws first, so the blob is the current card. */
    blob() {
      draw();
      return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob() gave nothing'))), 'image/png'));
    },
    // #endregion export
  };
}
