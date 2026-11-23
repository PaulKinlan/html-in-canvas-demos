// theme-sweep.js: show a change of theme as a front of light that crosses the element.
// Used by /theme-sweep/. The page keeps two pictures of the element in one plain canvas (the "atlas"):
// the old look in the top half and the new look in the bottom half. Nothing here draws an element.
//
//   const front = sweepFront(t, width, height);          t from 0 to 1
//   sweep2d(ctx, atlas, width, height, front);            2D: the new look, the old look outside a circle, a glow
//   SWEEP_SHADER                                          GLSL for shade() in glass-gl.js: the same front, with the
//                                                         picture bent at the rim and split into colours
//   sweepUniforms(front, width, height)                   the values that shader needs

// #region front
// A circle centred below the element. It grows until it covers the element, so its edge rises like a dome.
// Inside the circle is the new look.
export function sweepFront(t, w, h) {
  const band = Math.max(28, h * 0.11), x = w / 2, y = h * 1.3;
  const near = y - h - band, far = Math.hypot(x, y) + band;
  return { x, y, reach: near + (far - near) * t, band };
}
// #endregion front

// #region two-d
export function sweep2d(ctx, atlas, w, h, front) {
  const cw = atlas.width, ch = atlas.height / 2;
  ctx.drawImage(atlas, 0, ch, cw, ch, 0, 0, w, h);                       // the new look, everywhere
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(front.x, front.y, Math.max(0, front.reach), 0, Math.PI * 2);
  ctx.clip('evenodd');                                                   // everything outside the circle
  ctx.drawImage(atlas, 0, 0, cw, ch, 0, 0, w, h);                        // the old look
  ctx.restore();
  // Light on the edge: a ring that is brightest on the circle and fades to nothing on each side.
  const a = Math.max(0, front.reach - front.band), b = front.reach + front.band;
  const glow = ctx.createRadialGradient(front.x, front.y, a, front.x, front.y, b);
  glow.addColorStop(0, 'rgba(255, 214, 150, 0)');
  glow.addColorStop(0.5, 'rgba(255, 232, 190, 0.85)');
  glow.addColorStop(1, 'rgba(255, 214, 150, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
// #endregion two-d

// #region shader
// For shade() in glass-gl.js, which gives: uSize (the panel in CSS px), back(p) (the atlas at p, where p is in
// CSS px from the centre of the panel, y down) and expects vec4 shade(vec2 p).
// The old look is at back(p). The new look is one panel height lower in the atlas.
export const SWEEP_SHADER = `
vec4 look(vec2 p, float m) {
  p = clamp(p, -uSize * 0.5 + 0.5, uSize * 0.5 - 0.5);                   // stay inside one half of the atlas
  return mix(back(p), back(p + vec2(0.0, uSize.y)), m);
}
vec4 shade(vec2 p) {
  vec2 q = p - uOrigin;
  float d = length(q), e = (d - uReach) / uBand;                         // 0 on the front, negative behind it
  vec2 dir = q / max(d, 1.0);
  float rim = exp(-e * e * 2.5);                                         // 1 on the front, 0 away from it
  float m = smoothstep(0.25, -0.25, e);                                  // 1 where the new look has arrived
  // Near the front the picture is pushed outwards, by a different amount for red, green and blue.
  float push = rim * uBend;
  float r = look(p - dir * (push + uSplit * rim), m).r;
  vec4 g = look(p - dir * push, m);
  float b = look(p - dir * (push - uSplit * rim), m).b;
  vec3 col = vec3(r, g.g, b) + vec3(1.0, 0.88, 0.68) * rim * rim * uGlow;
  return vec4(col, g.a);
}`;

export function sweepUniforms(front, w, h, { bend = 16, split = 7, glow = 0.55 } = {}) {
  return { uOrigin: [front.x - w / 2, front.y - h / 2], uReach: front.reach, uBand: front.band, uBend: bend, uSplit: split, uGlow: glow };
}
// #endregion shader
