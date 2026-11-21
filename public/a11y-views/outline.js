// A heading outline drawn by the canvas beside the article it draws. The list of headings
// comes from the DOM. Each row of the outline is a piece of the article's own picture: the
// pixels of that heading, drawn a second time at a smaller size. The rows are real links
// (children of the canvas, drawn with no ink) so that a tap, the Tab key and a screen
// reader reach them.
import { plate } from '/lib/devtools/stage.js';
import { clamp } from '/lib/stage-2d.js';

const INK = { rail: '#171b2b', row: '#232a40', here: '#2f6bff', line: '#56607f', bad: '#e5484d', text: '#c9d1e8' };

// #region collect
/**
 * The headings under `root` in tree order: h1 to h6 and role="heading". The level is
 * aria-level when it is set, the number in the tag name otherwise, and 2 for a
 * role="heading" with no aria-level. `skipped` marks a heading more than one level below
 * the heading before it.
 */
export function collectHeadings(root) {
  let before = null;
  return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
    .filter((el) => {
      const role = el.getAttribute('role');
      if (role && role !== 'heading') return false;                 // <h2 role="presentation"> is not a heading
      if (!el.checkVisibility({ visibilityProperty: true })) return false;
      for (let a = el; a && a !== root; a = a.parentElement) if (a.getAttribute('aria-hidden') === 'true' || a.inert) return false;
      return true;
    })
    .map((el) => {
      const aria = parseInt(el.getAttribute('aria-level'), 10);
      const level = aria >= 1 ? aria : /^h[1-6]$/.test(el.localName) ? Number(el.localName[1]) : 2;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      const item = { el, level, text, skipped: before !== null && level > before + 1, after: before, empty: !text };
      before = level;
      return item;
    });
}
// #endregion collect

// #region measure
/**
 * Where each heading is inside the article, in CSS pixels of the article. Both rectangles
 * are reported where the article was last drawn, so their difference does not depend on
 * where that was. `src` is the box of the heading's words, the piece the outline draws.
 */
export function measureHeadings(article, items) {
  const a = article.getBoundingClientRect(), range = document.createRange();
  for (const item of items) {
    const h = item.el.getBoundingClientRect();
    range.selectNodeContents(item.el);
    const t = item.empty ? h : range.getBoundingClientRect();
    item.top = h.top - a.top;
    item.bottom = h.bottom - a.top;
    const x = clamp(t.left - a.left - 4, 0, a.width), y = clamp(t.top - a.top - 2, 0, a.height);
    item.src = { x, y, width: Math.min(t.width + 8, a.width - x), height: Math.min(t.height + 4, a.height - y) };
  }
  return items;
}
// #endregion measure

// #region draw-outline
/**
 * Draw the rail. `rows[i]` is the box of the link for items[i], in CSS pixels of the canvas.
 * `view` is the part of the article on screen, { top, bottom } in article pixels.
 * `piece(sx, sy, sw, sh, dx, dy, dw, dh)` draws a rectangle of the article's picture.
 */
export function drawOutline(ctx, items, rows, { rail, view, current, piece }) {
  ctx.save();
  ctx.fillStyle = INK.rail;
  ctx.fillRect(rail.x, rail.y, rail.width, rail.height);
  if (!items.length) {
    ctx.fillStyle = INK.text;
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('No headings', rail.x + 10, rail.y + 24);
    ctx.restore();
    return { inView: 0, skipped: 0 };
  }
  const least = Math.min(...items.map((i) => i.level));
  const STEP = 9, x0 = rail.x + 8;
  const indent = (item) => Math.min(4, item.level - least) * STEP;
  const cy = (i) => rows[i].y + rows[i].height / 2;

  // The part of the article on screen, as a bar down the left edge of the rail.
  const seen = items.map((item, i) => item.top < view.bottom && (items[i + 1]?.top ?? Infinity) > view.top);
  const first = seen.indexOf(true), last = seen.lastIndexOf(true);
  if (first >= 0) {
    ctx.fillStyle = INK.here;
    ctx.beginPath();
    ctx.roundRect(rail.x + 1.5, rows[first].y + 3, 3, rows[last].y + rows[last].height - rows[first].y - 6, 1.5);
    ctx.fill();
  }

  // Tree lines: from each heading's parent (the nearest heading above it with a lower level).
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 1.25;
  items.forEach((item, i) => {
    if (item.level === least) return;
    let p = i - 1;
    while (p >= 0 && items[p].level >= item.level) p--;
    if (p < 0) return;
    const px = x0 + indent(items[p]) + 5;
    ctx.beginPath();
    ctx.moveTo(px, cy(p) + 9);
    ctx.lineTo(px, cy(i));
    ctx.lineTo(x0 + indent(item) + 1, cy(i));
    ctx.stroke();
  });

  items.forEach((item, i) => {
    const r = rows[i], left = x0 + indent(item) + 3, right = r.x + r.width - 30;   // 26 px on the right hold the level
    const here = i === current;
    // The heading's own pixels, scaled to fit the row.
    const s = item.src, room = { width: right - left, height: r.height - 10 };
    const k = Math.min(0.8, room.width / s.width, room.height / s.height);
    const w = s.width * k, h = s.height * k, y = cy(i) - h / 2;
    ctx.save();
    ctx.globalAlpha = seen[i] ? 1 : 0.72;
    ctx.beginPath();
    ctx.roundRect(left, y, w, h, 3);
    ctx.clip();
    ctx.fillStyle = INK.row;
    ctx.fillRect(left, y, w, h);
    if (!item.empty) piece(s.x, s.y, s.width, s.height, left, y, w, h);
    ctx.restore();
    const wrong = item.skipped || item.empty;
    if (wrong || here) {
      ctx.strokeStyle = wrong ? INK.bad : INK.here;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(left - 1, y - 1, w + 2, h + 2, 4);
      ctx.stroke();
    }
    // The level, and the level before it where one was skipped.
    const tag = item.empty ? 'empty' : item.skipped ? `${item.after}→${item.level}` : String(item.level);
    plate(ctx, tag, r.x + r.width, cy(i) - 8, { fill: wrong ? INK.bad : here ? INK.here : '#0d101b', color: wrong || here ? '#fff' : INK.text, maxX: r.x + r.width - 4, height: 16, pad: 4, font: '600 10px ui-monospace, Menlo, Consolas, monospace' });
  });
  ctx.restore();
  return { inView: seen.filter(Boolean).length, skipped: items.filter((i) => i.skipped).length };
}
// #endregion draw-outline

// #region links
/**
 * Keep one link per heading in `list` (an <ol> inside the nav that is a child of the canvas).
 * The links are never seen: the nav is drawn with globalAlpha 0, which gives each link a hit
 * box at its row. Their text is what a screen reader says.
 */
export function syncLinks(list, items) {
  const sign = items.map((i) => `${i.el.id}|${i.level}|${i.text}|${i.skipped}`).join('\n');
  if (list.dataset.sign === sign) return false;
  list.dataset.sign = sign;
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = '#' + item.el.id;
    a.textContent = `${item.text || 'Empty heading'}, level ${item.level}${item.skipped ? `, skips from level ${item.after}` : ''}`;
    li.append(a);
    return li;
  }));
  return true;
}
// #endregion links
