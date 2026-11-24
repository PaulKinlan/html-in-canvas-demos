// cloth-mesh.js: a sheet of cloth as a grid of points held together by fixed distances, for a 2D canvas.
// Used by /cloth/. The picture on the cloth is a plain canvas (a copy of an element, made once), drawn as
// triangles with drawTriangle() from paper-mesh.js. Nothing here draws an element.
//
//   const cloth = makeCloth(width, height, { cols, rows, pins });   pins: columns of the top row that are fixed
//   stepCloth(cloth, seconds, { home, wind });                   one small step of time
//   drawCloth(ctx, cloth, image, scale);                            draw it, with its top left corner at 0, 0
//   triangleAt(cloth, x, y);                                        the matrix of the triangle under a point, or null
//   offFlat(cloth);                                                 how far the furthest point is from its flat place
import { drawTriangle } from './paper-mesh.js';

// #region make
export function makeCloth(W, H, { cols = 9, rows = 12, pins = [0, 3, 6, 9] } = {}) {
  const n = (cols + 1) * (rows + 1);
  const flat = new Float32Array(n * 3), pinned = new Uint8Array(n), tris = [], links = [];
  for (let j = 0, k = 0; j <= rows; j++) for (let i = 0; i <= cols; i++, k++) {
    flat[k * 3] = i / cols * W; flat[k * 3 + 1] = j / rows * H;
    if (j === 0 && pins.includes(i)) pinned[k] = 1;
    const link = (m) => links.push(k, m, Math.hypot(flat[k * 3] - (m % (cols + 1)) / cols * W, flat[k * 3 + 1] - Math.floor(m / (cols + 1)) / rows * H));
    if (i < cols) link(k + 1);                                         // to the point on the right
    if (j < rows) link(k + cols + 1);                                  // to the point below
    if (i < cols && j < rows) { link(k + cols + 2); tris.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1); }
    if (i > 0 && j < rows) link(k + cols);                             // the two diagonals stop a square shearing flat
  }
  const count = tris.length / 3;
  return { W, H, cols, rows, n, flat, pos: flat.slice(), prev: flat.slice(), pinned, links: Float32Array.from(links), tris: Uint16Array.from(tris),
    order: Array.from({ length: count }, (_, i) => i), depth: new Float32Array(count) };
}
// #endregion make

// #region step
// Verlet integration: a point's speed is the distance it moved in the last step. Then every link is pulled
// back to its length, a few times over.
export function stepCloth(cloth, h, { gravity = 0, home = 60, damp = 0.975, wind = null, rounds = 4 } = {}) {
  const { pos, prev, flat, pinned, links, n } = cloth;
  for (let k = 0; k < n; k++) {
    if (pinned[k]) continue;
    const a = k * 3;
    for (let c = 0; c < 3; c++) {
      let force = (flat[a + c] - pos[a + c]) * home;                   // a pull back to the flat place stands in for the cloth's weight,
                                                                       // so that it comes to rest exactly flat
      if (c === 1) force += gravity;
      if (c === 2 && wind) force += wind(flat[a], flat[a + 1]);
      const now = pos[a + c];
      pos[a + c] = now + (now - prev[a + c]) * damp + force * h * h;
      prev[a + c] = now;
    }
  }
  for (let r = 0; r < rounds; r++) for (let l = 0; l < links.length; l += 3) {
    const a = links[l] * 3, b = links[l + 1] * 3, dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6, fa = pinned[links[l]], fb = pinned[links[l + 1]];
    if (fa && fb) continue;
    const pull = (d - links[l + 2]) / d * (fa || fb ? 1 : 0.5);
    if (!fa) { pos[a] += dx * pull; pos[a + 1] += dy * pull; pos[a + 2] += dz * pull; }
    if (!fb) { pos[b] -= dx * pull; pos[b + 1] -= dy * pull; pos[b + 2] -= dz * pull; }
  }
}
export function offFlat(cloth) {
  let most = 0;
  for (let a = 0; a < cloth.pos.length; a += 3) most = Math.max(most, Math.hypot(cloth.pos[a] - cloth.flat[a], cloth.pos[a + 1] - cloth.flat[a + 1], cloth.pos[a + 2]));
  return most;
}
export function speedOf(cloth) {
  let most = 0;
  for (let a = 0; a < cloth.pos.length; a += 3) most = Math.max(most, Math.hypot(cloth.pos[a] - cloth.prev[a], cloth.pos[a + 1] - cloth.prev[a + 1], cloth.pos[a + 2] - cloth.prev[a + 2]));
  return most;
}
// #endregion step

// #region draw
// The cloth is seen from straight in front, so a point's place on the canvas is its x and y. Its z only
// changes how its triangles are lit, and which is drawn over which.
const LIGHT = [-0.3, -0.4, 0.866];
export function drawCloth(ctx, cloth, image, scale) {
  const { pos, flat, tris, order, depth } = cloth;
  for (let t = 0; t < order.length; t++) depth[t] = pos[tris[t * 3] * 3 + 2] + pos[tris[t * 3 + 1] * 3 + 2] + pos[tris[t * 3 + 2] * 3 + 2];
  order.sort((p, q) => depth[p] - depth[q]);                           // the far triangles first
  for (const t of order) {
    const i0 = tris[t * 3] * 3, i1 = tris[t * 3 + 1] * 3, i2 = tris[t * 3 + 2] * 3;
    const x0 = pos[i0], y0 = pos[i0 + 1], z0 = pos[i0 + 2], x1 = pos[i1], y1 = pos[i1 + 1], z1 = pos[i1 + 2], x2 = pos[i2], y2 = pos[i2 + 1], z2 = pos[i2 + 2];
    const nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0), ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0), nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) continue;
    const side = nz < 0 ? -1 : 1, lit = side * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len - LIGHT[2];   // 0 when it lies flat
    drawTriangle(ctx, image, scale, flat[i0], flat[i0 + 1], flat[i1], flat[i1 + 1], flat[i2], flat[i2 + 1], x0, y0, x1, y1, x2, y2);
    const shade = side < 0 ? 0.35 : lit < -0.015 ? Math.min(0.6, (-lit - 0.015) * 1.1) : 0;
    const shine = side > 0 && lit > 0.008 ? Math.min(0.5, (lit - 0.008) * 3.5) : 0;
    if (shade < 0.01 && shine < 0.01) continue;
    ctx.fillStyle = shade ? `rgba(30, 24, 18, ${shade.toFixed(3)})` : `rgba(255, 255, 255, ${shine.toFixed(3)})`;
    // The shaded area is the triangle grown by a third of a pixel, so that two neighbours leave no pale line between them.
    const mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3, out = (x, y) => { const l = Math.hypot(x - mx, y - my) || 1; return [x + (x - mx) / l * 0.35, y + (y - my) / l * 0.35]; };
    ctx.beginPath(); ctx.moveTo(...out(x0, y0)); ctx.lineTo(...out(x1, y1)); ctx.lineTo(...out(x2, y2)); ctx.closePath(); ctx.fill();
  }
}
// #endregion draw

// #region triangle-at
// The nearest triangle to the viewer that covers the point x, y. Returns the six numbers of the matrix that
// takes a place on the flat cloth to where that triangle shows it: [a, b, c, d, e, f] as for ctx.transform().
export function triangleAt(cloth, x, y) {
  const { pos, flat, tris, order } = cloth;
  for (let o = order.length - 1; o >= 0; o--) {
    const t = order[o], i0 = tris[t * 3] * 3, i1 = tris[t * 3 + 1] * 3, i2 = tris[t * 3 + 2] * 3;
    const x0 = pos[i0], y0 = pos[i0 + 1], x1 = pos[i1], y1 = pos[i1 + 1], x2 = pos[i2], y2 = pos[i2 + 1];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-6) continue;
    const s = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / area, r = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / area;
    if (s < 0 || r < 0 || s + r > 1) continue;
    return matrixOf(flat[i0], flat[i0 + 1], flat[i1], flat[i1 + 1], flat[i2], flat[i2 + 1], x0, y0, x1, y1, x2, y2);
  }
  return null;
}
export function matrixOf(u0, v0, u1, v1, u2, v2, x0, y0, x1, y1, x2, y2) {
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
  return [a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0];
}
// #endregion triangle-at
