// paper-mesh.js: a sheet of paper as a grid of triangles, for a 2D canvas. Used by /crumple/.
// The sheet's picture is a plain canvas (a copy of an element, made once). Each triangle is drawn with
// drawImage() under its own affine transform and clip, and shaded by the direction it faces.
// Nothing here draws an element.
//
//   const sheet = makeSheet(width, height, { cols, rows, radius, seed });
//   const pos = poseSheet(sheet, c, rx, rz);              c: 0 flat, 1 a ball. rx, rz: how the ball is turned
//   drawSheet(ctx, sheet, pos, x, y, image, scale, c);     x, y: where the middle of the sheet goes
//   addCreases(lines, count, random, width, height);       more fold lines
//   drawCreases(ctx, lines, width, height);                paint the fold lines as light and shade

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Smooth random numbers over the sheet: values on a coarse lattice, blended.
function lattice(gx, gy, rand) {
  const g = Float32Array.from({ length: (gx + 1) * (gy + 1) }, () => rand() * 2 - 1);
  return (u, v) => {
    const x = u * gx, y = v * gy, i = Math.min(gx - 1, Math.floor(x)), j = Math.min(gy - 1, Math.floor(y)), fx = x - i, fy = y - j;
    const a = g[j * (gx + 1) + i], b = g[j * (gx + 1) + i + 1], c = g[(j + 1) * (gx + 1) + i], d = g[(j + 1) * (gx + 1) + i + 1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}

// #region sheet
// Every point of the grid has two places: flat, and somewhere on a lumpy ball. The ball places wrap the
// sheet a little more than once round, with the radius and the angles pushed about by smooth noise.
export function makeSheet(W, H, { cols = 10, rows = 14, radius = 46, seed = 7 } = {}) {
  const rand = rng(seed), n = (cols + 1) * (rows + 1);
  const flat = new Float32Array(n * 3), ball = new Float32Array(n * 3), uv = new Float32Array(n * 2), kink = new Float32Array(n);
  const n1 = lattice(3, 4, rand), n2 = lattice(3, 4, rand), n3 = lattice(4, 5, rand);
  for (let j = 0, k = 0; j <= rows; j++) for (let i = 0; i <= cols; i++, k++) {
    const u = i / cols, v = j / rows;
    flat[k * 3] = (u - 0.5) * W; flat[k * 3 + 1] = (v - 0.5) * H;
    uv[k * 2] = u * W; uv[k * 2 + 1] = v * H;
    const a = (u - 0.5) * Math.PI * 2.2 + n1(u, v) * 1.3, b = (v - 0.5) * Math.PI * 1.1 + n2(u, v) * 0.9;
    const r = radius * (0.62 + 0.38 * (n3(u, v) * 0.5 + 0.5)) * (0.9 + 0.2 * rand());
    kink[k] = rand() * 2 - 1;                                           // how far this point is pushed out of the sheet half way through
    ball[k * 3] = r * Math.sin(a) * Math.cos(b); ball[k * 3 + 1] = r * Math.sin(b); ball[k * 3 + 2] = r * Math.cos(a) * Math.cos(b);
  }
  const tris = new Uint16Array(cols * rows * 6);
  for (let j = 0, t = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * (cols + 1) + i;
    tris[t++] = k; tris[t++] = k + 1; tris[t++] = k + cols + 1;
    tris[t++] = k + 1; tris[t++] = k + cols + 2; tris[t++] = k + cols + 1;
  }
  return { W, H, cols, rows, radius, flat, ball, uv, kink, tris, pos: new Float32Array(n * 3), order: Array.from({ length: cols * rows * 2 }, (_, i) => i), depth: new Float32Array(cols * rows * 2) };
}

export function poseSheet(sheet, c, rx = 0, rz = 0) {
  const { flat, ball, kink, pos } = sheet, e = c * c * (3 - 2 * c), mid = Math.sin(Math.PI * c), puff = 1 + mid * 0.35;
  const cx = Math.cos(rx * e), sx = Math.sin(rx * e), cz = Math.cos(rz * e), sz = Math.sin(rz * e);
  for (let k = 0; k < pos.length; k += 3) {
    const x = flat[k] + (ball[k] - flat[k]) * e, y0 = flat[k + 1] + (ball[k + 1] - flat[k + 1]) * e, z0 = ball[k + 2] * e * puff + kink[k / 3] * mid * 16;
    const y = y0 * cx - z0 * sx, z = y0 * sx + z0 * cx;                 // turn about the x axis, then about z
    pos[k] = x * cz - y * sz; pos[k + 1] = x * sz + y * cz; pos[k + 2] = z;
  }
  return pos;
}
// #endregion sheet

// #region triangle
// Draw the part of `image` inside the triangle (u0,v0) (u1,v1) (u2,v2) so that it lands on (x0,y0) (x1,y1) (x2,y2).
// Units are CSS pixels. `scale` is how many pixels of the image there are for each of them.
export function drawTriangle(ctx, image, scale, u0, v0, u1, v1, u2, v2, x0, y0, x1, y1, x2, y2) {
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (!det) return;
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
  // The piece of the image that is drawn: the triangle's box and 1 px more on each side. The path below is a
  // little larger than the triangle, and with no margin its rim would be left empty and show as a pale seam.
  const su = Math.min(u0, u1, u2) - 1, sv = Math.min(v0, v1, v2) - 1, sw = Math.max(u0, u1, u2) - su + 1, sh = Math.max(v0, v1, v2) - sv + 1;
  ctx.save();
  trace(ctx, x0, y0, x1, y1, x2, y2);
  ctx.clip();
  ctx.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
  ctx.drawImage(image, su * scale, sv * scale, sw * scale, sh * scale, su, sv, sw, sh);
  ctx.restore();
}
// The triangle as a path, grown by 0.6 px from its middle so that neighbours overlap and no seam shows.
function trace(ctx, x0, y0, x1, y1, x2, y2) {
  const mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3;
  const out = (x, y) => { const dx = x - mx, dy = y - my, l = Math.hypot(dx, dy) || 1; return [x + dx / l * 0.6, y + dy / l * 0.6]; };
  ctx.beginPath();
  ctx.moveTo(...out(x0, y0)); ctx.lineTo(...out(x1, y1)); ctx.lineTo(...out(x2, y2));
  ctx.closePath();
}
// #endregion triangle

// #region draw
const LIGHT = [-0.35, -0.5, 0.79];
export function drawSheet(ctx, sheet, pos, x, y, image, scale, c = 1, paper = '#f6f1e4') {
  const { tris, uv, order, depth, radius } = sheet;
  for (let t = 0; t < order.length; t++) depth[t] = pos[tris[t * 3] * 3 + 2] + pos[tris[t * 3 + 1] * 3 + 2] + pos[tris[t * 3 + 2] * 3 + 2];
  order.sort((p, q) => depth[p] - depth[q]);                            // the far triangles first
  for (const t of order) {
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const x0 = pos[i0 * 3], y0 = pos[i0 * 3 + 1], z0 = pos[i0 * 3 + 2], x1 = pos[i1 * 3], y1 = pos[i1 * 3 + 1], z1 = pos[i1 * 3 + 2], x2 = pos[i2 * 3], y2 = pos[i2 * 3 + 1], z2 = pos[i2 * 3 + 2];
    // The way the triangle faces, from the cross product of two of its sides.
    let nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0), ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0), nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) continue;
    const front = nz > 0, s = (front ? 1 : -1) / len;
    nx *= s; ny *= s; nz *= s;
    const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const deep = 1 - (depth[t] / 3 + radius) / (radius * 2);            // 0 at the front of the ball, 1 at the back
    if (front) drawTriangle(ctx, image, scale, uv[i0 * 2], uv[i0 * 2 + 1], uv[i1 * 2], uv[i1 * 2 + 1], uv[i2 * 2], uv[i2 * 2 + 1], x + x0, y + y0, x + x1, y + y1, x + x2, y + y2);
    trace(ctx, x + x0, y + y0, x + x1, y + y1, x + x2, y + y2);
    if (!front) { ctx.fillStyle = paper; ctx.fill(); }                  // the back of the paper is blank
    const dark = c * Math.min(0.7, (1 - lit) * 0.5 + Math.max(0, deep) * 0.3);
    ctx.fillStyle = `rgba(52, 40, 28, ${dark.toFixed(3)})`;
    ctx.fill();
  }
  return order.length;
}
// #endregion draw

// #region creases
// A crease is a straight line across the sheet. It is painted as a thin band: shade on one side of the line
// and light on the other, which is how a fold in flat paper catches the light.
export function addCreases(lines, count, rand, W, H) {
  for (let i = 0; i < count; i++) lines.push({ x: rand() * W, y: rand() * H, angle: rand() * Math.PI, length: (0.3 + rand() * 0.6) * Math.max(W, H), strength: 0.4 + rand() * 0.5, width: 3 + rand() * 4 });
  return lines;
}
export function drawCreases(ctx, lines) {
  for (const l of lines) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.angle);
    const g = ctx.createLinearGradient(0, -l.width, 0, l.width);
    g.addColorStop(0, 'rgba(40, 30, 20, 0)');
    g.addColorStop(0.47, `rgba(40, 30, 20, ${0.22 * l.strength})`);
    g.addColorStop(0.53, `rgba(255, 255, 255, ${0.45 * l.strength})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-l.length / 2, -l.width, l.length, l.width * 2);
    ctx.restore();
  }
}
// #endregion creases
