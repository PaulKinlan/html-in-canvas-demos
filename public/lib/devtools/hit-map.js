// Hit region viewer: asks the browser which element it would hit at each point
// of a grid over the canvas, and compares the answer with where the canvas
// drew each element.
import { inQuad, quadPath, plate } from './stage.js';

// #region scan
/**
 * A grid over the canvas, `cell` CSS px per square. scan() fills `hit` for the
 * next `rows` rows with the index (in `elements`) of the canvas child that
 * document.elementFromPoint() returns at the centre of each square:
 *   -1  the canvas itself, so no element is hit there
 *   -2  not known: the point is outside the window or under another part of the page
 * `elements` holds each canvas child that was hit, in the order first seen.
 */
export function createHitMap(canvas, { cell = 8, elements = [] } = {}) {
  const map = { cell, cols: 0, rows: 0, hit: new Int16Array(0), elements, row: 0, sweeps: 0 };
  const fit = () => {
    const cols = Math.ceil(canvas.clientWidth / cell), rows = Math.ceil(canvas.clientHeight / cell);
    if (cols === map.cols && rows === map.rows) return;
    Object.assign(map, { cols, rows, hit: new Int16Array(cols * rows).fill(-2), row: 0 });
  };
  const ownerOf = (el) => {
    // The child of the canvas that holds the element the browser returned.
    while (el && el.parentElement !== canvas) el = el.parentElement;
    return el;
  };
  map.scan = (rows = map.rows) => {
    fit();
    // Chromium remembers the answers for the last two points asked, and a new
    // draw does not clear them. A scan asks every other square before it comes
    // back to a point, so its answers are not remembered ones.
    const box = canvas.getBoundingClientRect();
    for (let n = 0; n < rows; n++) {
      const row = map.row;
      for (let col = 0; col < map.cols; col++) {
        const x = box.left + canvas.clientLeft + (col + 0.5) * cell, y = box.top + canvas.clientTop + (row + 0.5) * cell;
        let value = -2;
        if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
          const found = document.elementFromPoint(x, y);
          if (found === canvas) value = -1;
          else if (found && canvas.contains(found)) {
            const owner = ownerOf(found);
            value = elements.indexOf(owner);
            if (value < 0) value = elements.push(owner) - 1;
          }
        }
        map.hit[row * map.cols + col] = value;
      }
      map.row = (row + 1) % map.rows;
      if (map.row === 0) map.sweeps++;
    }
    return map;
  };
  map.clear = () => { map.hit.fill(-2); map.row = 0; };
  fit();
  return map;
}
// #endregion scan

// #region compare
/**
 * The element whose picture is on top at a point, from the recorded draws
 * (see recordDraws() in stage.js). A later draw covers an earlier one. A draw
 * with globalAlpha 0 leaves no picture. A draw may carry `clip(x, y)`, set by
 * the page when it drew under a clip.
 */
export function pictureAt(draws, x, y) {
  for (let i = draws.length - 1; i >= 0; i--) {
    const d = draws[i];
    if (d.alpha === 0) continue;
    if (inQuad(d.quad, x, y) && (!d.clip || d.clip(x, y))) return d.element;
  }
  return null;
}

/** Count the squares where the hit test and the picture agree, and the two ways they can differ. */
export function compare(map, draws) {
  const out = { agree: 0, hitNoPicture: 0, pictureNoHit: 0, unknown: 0, empty: 0 };
  for (let row = 0; row < map.rows; row++) for (let col = 0; col < map.cols; col++) {
    const hit = map.hit[row * map.cols + col];
    if (hit === -2) { out.unknown++; continue; }
    const hitEl = hit >= 0 ? map.elements[hit] : null;
    const picture = pictureAt(draws, (col + 0.5) * map.cell, (row + 0.5) * map.cell);
    if (hitEl === picture) { if (hitEl) out.agree++; else out.empty++; continue; }
    if (hitEl) out.hitNoPicture++;
    if (picture) out.pictureNoHit++;
  }
  return out;
}
// #endregion compare

// #region draw-map
export const HIT_COLOURS = ['#2f6bff', '#12b76a', '#f59f1a', '#b25cff', '#00b8d9', '#e0457b'];

/**
 * Draw the map in CSS px of the canvas: each square tinted with the colour of
 * the element hit there, a red stroke where an element is hit but its picture
 * is not there, a yellow dot where a picture is but the hit goes elsewhere,
 * and the outline of every recorded draw.
 */
export function drawHitMap(ctx, map, draws, { colourOf, scanLine = true, labels = true } = {}) {
  const { cell, cols, rows } = map;
  ctx.save();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const hit = map.hit[row * cols + col];
    if (hit === -2) continue;
    const x = col * cell, y = row * cell;
    const hitEl = hit >= 0 ? map.elements[hit] : null;
    const picture = pictureAt(draws, x + cell / 2, y + cell / 2);
    if (hitEl) {
      ctx.fillStyle = colourOf(hitEl);
      ctx.globalAlpha = 0.38;
      ctx.fillRect(x, y, cell - 1, cell - 1);
      ctx.globalAlpha = 1;
      if (picture !== hitEl) { // hit, but this element's picture is not here
        ctx.strokeStyle = '#ff2d55';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + cell - 2);
        ctx.lineTo(x + cell - 2, y + 1);
        ctx.stroke();
      }
    }
    if (picture && picture !== hitEl) { // a picture, and a tap here goes to something else
      ctx.fillStyle = '#ffd60a';
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Where each element was drawn.
  const named = new Set();
  for (const d of draws) {
    ctx.strokeStyle = colourOf(d.element);
    ctx.lineWidth = 2;
    ctx.setLineDash(d.alpha === 0 || d.copy ? [5, 4] : []);
    quadPath(ctx, d.quad);
    ctx.stroke();
    if (labels && !named.has(d.element)) {
      named.add(d.element);
      const top = d.quad.reduce((a, b) => (b.y < a.y ? b : a));
      plate(ctx, d.element.id || d.element.localName, top.x, Math.max(2, top.y - 20), { fill: colourOf(d.element), maxX: cols * cell });
    }
  }
  ctx.setLineDash([]);
  if (scanLine) {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillRect(0, map.row * cell, cols * cell, 1.5);
  }
  ctx.restore();
}
// #endregion draw-map
