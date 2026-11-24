// text-wake.js: a shape that reaches into a block of text from its left edge, and the CSS that makes the
// text flow round it. Used by /text-wake/.
// The shape is a row of discs along a curve. The text is moved by the browser: a left float as tall as the
// block has a shape-outside polygon, and the polygon is rewritten whenever the shape moves.
//
//   const discs = wormDiscs(anchorY, headX, headY);          discs from the left edge to the head
//   const edge = profile(discs, height, step, margin, base);  for every `step` pixels down: how far right the shape reaches
//   float.style.shapeOutside = polygonFrom(edge, step);       the browser lays the text out again
//   drawWorm(ctx, discs, look);                               draw the shape with canvas calls

// #region discs
// A quadratic curve from just outside the left edge to the head. Each disc is { x, y, r }.
export function wormDiscs(anchorY, headX, headY, count = 28) {
  const ax = -30, cx = headX * 0.45, cy = anchorY, discs = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1), u = 1 - t;
    discs.push({ x: u * u * ax + 2 * u * t * cx + t * t * headX, y: u * u * anchorY + 2 * u * t * cy + t * t * headY, r: 17 + 13 * t * t });
  }
  return discs;
}
// #endregion discs

// #region profile
// The right-hand edge of the shape, sampled every `step` pixels from the top. Rows the shape doesn't reach get `base`.
export function profile(discs, height, step = 6, margin = 10, base = 16) {
  const rows = Math.ceil(height / step) + 1, edge = new Float32Array(rows).fill(base);
  for (const d of discs) {
    const reach = d.r + margin, first = Math.max(0, Math.floor((d.y - reach) / step)), end = Math.min(rows - 1, Math.ceil((d.y + reach) / step));
    for (let j = first; j <= end; j++) {
      const dy = j * step - d.y, right = d.x + Math.sqrt(Math.max(0, reach * reach - dy * dy));
      if (right > edge[j]) edge[j] = right;
    }
  }
  return edge;
}
// The area to the left of that edge as a CSS polygon: down the edge, then back up the left side.
export function polygonFrom(edge, step = 6) {
  let points = '0 0';
  for (let j = 0; j < edge.length; j++) points += `,${edge[j].toFixed(1)}px ${j * step}px`;
  return `polygon(${points},0 ${(edge.length - 1) * step}px)`;
}
// #endregion profile

// #region draw
export function drawWorm(ctx, discs, { body = '#d2491f', dark = '#7c2a10', look = [1, 0] } = {}) {
  const disc = (d, grow, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(d.x, d.y, d.r + grow, 0, Math.PI * 2); ctx.fill(); };
  for (const d of discs) disc(d, 2.5, dark);                            // an outline: every disc a little larger, in the dark colour
  for (const d of discs) disc(d, 0, body);
  // Rings along the body, and a lighter back.
  ctx.lineCap = 'round';
  for (let i = 2; i < discs.length - 3; i += 3) {
    const d = discs[i], n = discs[i + 1], a = Math.atan2(n.y - d.y, n.x - d.x);
    ctx.strokeStyle = 'rgba(124, 42, 16, 0.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r - 1, a + Math.PI / 2 - 1.2, a + Math.PI / 2 + 1.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r - 6, a - Math.PI / 2 - 0.5, a - Math.PI / 2 + 0.5); ctx.stroke();
  }
  // Two eyes on the head. The pupils sit towards where the head is going.
  const h = discs.at(-1), len = Math.hypot(look[0], look[1]) || 1, lx = look[0] / len, ly = look[1] / len;
  for (const side of [-1, 1]) {
    const ex = h.x + lx * 8 - ly * side * 11, ey = h.y + ly * 8 + lx * side * 11;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d1b16'; ctx.beginPath(); ctx.arc(ex + lx * 3, ey + ly * 3, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}
// #endregion draw
