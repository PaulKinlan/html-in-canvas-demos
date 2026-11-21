// The effects of /scroll-fx/. Each one is a function of the element's picture
// and two numbers that CSS sets:
//
//   u_progress   --fx-progress   0 → 1, from a scroll-driven or scroll-triggered animation
//   u_amount     --fx-amount     the scroll speed, about -1 → 1 (see "speed" in index.html)
//
// Every effect has GLSL for WebGL and WGSL for WebGPU.

import { defineEffect } from '/lib/effects.js';

// #region smear
// Shared by the effects: average the picture along y over a distance that
// grows with the scroll speed. The hash() jitter turns six copies into a blur.
const SMEAR_GLSL = `
vec4 smear(vec2 p) {
  float v = clamp(u_amount, -1.5, 1.5);
  if (abs(v) < 0.02) return tex(p);
  vec4 c = vec4(0.0);
  for (int i = 0; i < 6; i++) c += tex(p + vec2(0.0, v * 54.0 * (float(i) + hash(p + float(i))) / 6.0));
  return c / 6.0;
}`;
const SMEAR_WGSL = `
fn smear(p: vec2f) -> vec4f {
  let v = clamp(u.amount, -1.5, 1.5);
  if (abs(v) < 0.02) { return tex(p); }
  var c = vec4f(0.0);
  for (var i = 0; i < 6; i++) { c += tex(p + vec2f(0.0, v * 54.0 * (f32(i) + hash(p + f32(i))) / 6.0)); }
  return c / 6.0;
}`;
// #endregion smear

// #region burn
// burn-in: a noise field is compared with the progress. Where the noise is
// above it the element is missing, and the boundary glows.
defineEffect('burn-in', {
  glsl: SMEAR_GLSL + `
vec4 fx(vec2 p) {
  float q = 1.0 - u_progress;
  float n = fbm(p * 0.02) * 0.8 + 0.2 * (1.0 - p.y / u_size.y);
  float d = n - (q * 1.3 - 0.15);
  if (d < 0.0) return vec4(0.0);
  vec4 col = smear(p);
  float edge = (1.0 - smoothstep(0.0, 0.07, d)) * step(0.001, q);
  vec3 ember = mix(vec3(1.0, 0.9, 0.4), vec3(0.95, 0.25, 0.05), smoothstep(0.0, 0.06, d));
  col.rgb = mix(col.rgb, ember * col.a, edge);
  return col;
}`,
  wgsl: SMEAR_WGSL + `
fn fx(p: vec2f) -> vec4f {
  let q = 1.0 - u.progress;
  let n = fbm(p * 0.02) * 0.8 + 0.2 * (1.0 - p.y / u.size.y);
  let d = n - (q * 1.3 - 0.15);
  let col = smear(p);
  if (d < 0.0) { return vec4f(0.0); }
  let edge = (1.0 - smoothstep(0.0, 0.07, d)) * step(0.001, q);
  let ember = mix(vec3f(1.0, 0.9, 0.4), vec3f(0.95, 0.25, 0.05), smoothstep(0.0, 0.06, d));
  return vec4f(mix(col.rgb, ember * col.a, edge), col.a);
}`,
});
// #endregion burn

// mosaic-in: the picture is sampled at the centre of square cells that shrink
// from 40 px to 1 px, with red and blue pulled apart sideways.
defineEffect('mosaic-in', {
  glsl: SMEAR_GLSL + `
vec4 fx(vec2 p) {
  float q = 1.0 - u_progress;
  if (q < 0.004) return smear(p);
  float cell = 1.0 + floor(q * q * 40.0);
  vec2 s = cell > 1.5 ? (floor(p / cell) + 0.5) * cell : p;
  float split = q * 16.0;
  vec4 col = tex(s);
  col.r = tex(s + vec2(split, 0.0)).r;
  col.b = tex(s - vec2(split, 0.0)).b;
  return col * smoothstep(0.0, 0.3, u_progress);
}`,
  wgsl: SMEAR_WGSL + `
fn fx(p: vec2f) -> vec4f {
  let q = 1.0 - u.progress;
  if (q < 0.004) { return smear(p); }
  let cell = 1.0 + floor(q * q * 40.0);
  var s = p;
  if (cell > 1.5) { s = (floor(p / cell) + 0.5) * cell; }
  let split = q * 16.0;
  var col = tex(s);
  col.r = tex(s + vec2f(split, 0.0)).r;
  col.b = tex(s - vec2f(split, 0.0)).b;
  return col * smoothstep(0.0, 0.3, u.progress);
}`,
});

// rows-in: 14 px rows start off to the left and right by turns and slide home.
defineEffect('rows-in', {
  glsl: SMEAR_GLSL + `
vec4 fx(vec2 p) {
  float q = 1.0 - u_progress;
  if (q < 0.004) return smear(p);
  float row = floor(p.y / 14.0);
  float side = mod(row, 2.0) * 2.0 - 1.0;
  float off = side * q * q * u_size.x * (0.5 + hash(vec2(row, 3.0)));
  return tex(p + vec2(off, 0.0));
}`,
  wgsl: SMEAR_WGSL + `
fn fx(p: vec2f) -> vec4f {
  let q = 1.0 - u.progress;
  if (q < 0.004) { return smear(p); }
  let row = floor(p.y / 14.0);
  let side = (row - 2.0 * floor(row / 2.0)) * 2.0 - 1.0;
  let off = side * q * q * u.size.x * (0.5 + hash(vec2f(row, 3.0)));
  return tex(p + vec2f(off, 0.0));
}`,
});

// #region roll
// roll-in: the element is a sheet rolled up at its top edge. A cylinder of
// radius R rolls down as the progress grows and leaves the sheet flat behind it.
// `a` is the line where the cylinder touches the page.
defineEffect('roll-in', {
  bleed: 30,
  glsl: SMEAR_GLSL + `
vec4 fx(vec2 p) {
  const float PI = 3.14159265;
  if (u_progress > 0.996) return smear(p);
  float R = 24.0;
  float a = u_progress * (u_size.y + 2.0 * R) - R;
  float d = (p.y - a) / R;
  if (d > 1.0) return vec4(0.0);
  if (d < -1.0) {
    vec4 flat_ = tex(p);
    flat_.rgb *= 1.0 - 0.3 * exp(-(a - R - p.y) / 14.0);
    return flat_;
  }
  // On the cylinder: the arc from the touching line to this point gives the part of the sheet wound here.
  float arc = R * (PI - asin(d));
  vec4 wound = tex(vec2(p.x, clamp(a + arc, 0.5, u_size.y - 18.0)));
  float left = clamp((u_size.y - a) / (2.0 * R), 0.0, 1.0);
  float light = 0.6 + 0.4 * sqrt(1.0 - d * d) + 0.25 * exp(-pow((d + 0.35) / 0.18, 2.0));
  vec3 back = mix(wound.rgb, vec3(wound.a) * 0.9, 0.72) * min(light, 1.08);
  return vec4(back, wound.a) * left;
}`,
  wgsl: SMEAR_WGSL + `
fn fx(p: vec2f) -> vec4f {
  let PI = 3.14159265;
  if (u.progress > 0.996) { return smear(p); }
  let R = 24.0;
  let a = u.progress * (u.size.y + 2.0 * R) - R;
  let d = (p.y - a) / R;
  var flat_ = tex(p);
  let dd = clamp(d, -1.0, 1.0);
  let arc = R * (PI - asin(dd));
  let wound = tex(vec2f(p.x, clamp(a + arc, 0.5, u.size.y - 18.0)));
  if (d > 1.0) { return vec4f(0.0); }
  if (d < -1.0) {
    flat_ = vec4f(flat_.rgb * (1.0 - 0.3 * exp(-(a - R - p.y) / 14.0)), flat_.a);
    return flat_;
  }
  let left = clamp((u.size.y - a) / (2.0 * R), 0.0, 1.0);
  let light = 0.6 + 0.4 * sqrt(1.0 - dd * dd) + 0.25 * exp(-pow((dd + 0.35) / 0.18, 2.0));
  let back = mix(wound.rgb, vec3f(wound.a) * 0.9, 0.72) * min(light, 1.08);
  return vec4f(back, wound.a) * left;
}`,
});
// #endregion roll

// shock-in: a ring grows from the centre. The element appears behind the ring
// and the ring pushes the picture outwards as it passes.
defineEffect('shock-in', {
  bleed: 24,
  glsl: `
vec4 fx(vec2 p) {
  float q = u_progress;
  if (q > 0.996) return tex(p);
  vec2 v = p - u_size * 0.5;
  float r = length(v);
  float front = q * length(u_size) * 0.62;
  float w = exp(-pow((r - front) / 38.0, 2.0)) * (1.0 - q);
  vec4 col = tex(p - normalize(v + 1e-4) * w * 30.0);
  col.rgb += col.a * w * 0.7 * vec3(0.45, 0.8, 1.0);
  return col * (1.0 - smoothstep(front - 8.0, front + 26.0, r)) * step(0.001, q);
}`,
  wgsl: `
fn fx(p: vec2f) -> vec4f {
  let q = u.progress;
  if (q > 0.996) { return tex(p); }
  let v = p - u.size * 0.5;
  let r = length(v);
  let front = q * length(u.size) * 0.62;
  let w = exp(-pow((r - front) / 38.0, 2.0)) * (1.0 - q);
  var col = tex(p - normalize(v + 1e-4) * w * 30.0);
  col = vec4f(col.rgb + col.a * w * 0.7 * vec3f(0.45, 0.8, 1.0), col.a);
  return col * (1.0 - smoothstep(front - 8.0, front + 26.0, r)) * step(0.001, q);
}`,
});

// #region melt
// melt: the lower two thirds of the element are stretched downwards, by a
// different length in each column, so the bottom edge runs into drips.
defineEffect('melt', {
  bleed: 90,
  glsl: `
vec4 fx(vec2 p) {
  float q = u_progress;
  if (q < 0.002) return tex(p);
  float n = noise(vec2(p.x * 0.035, 1.7)) * 0.75 + noise(vec2(p.x * 0.11, 9.2)) * 0.25;
  float len = q * 88.0 * n * n * 1.6;
  float y0 = u_size.y * 0.3;
  if (p.y < y0) return tex(p);
  float src = y0 + (p.y - y0) * (u_size.y - y0) / (u_size.y - y0 + len);
  vec4 col = tex(vec2(p.x + sin(p.y * 0.05 + n * 6.0) * 2.0 * q * q, src));
  col.rgb *= 1.0 - 0.25 * q * smoothstep(y0, u_size.y + len, p.y);
  return col;
}`,
  wgsl: `
fn fx(p: vec2f) -> vec4f {
  let q = u.progress;
  let plain = tex(p);
  if (q < 0.002) { return plain; }
  let n = noise(vec2f(p.x * 0.035, 1.7)) * 0.75 + noise(vec2f(p.x * 0.11, 9.2)) * 0.25;
  let len = q * 88.0 * n * n * 1.6;
  let y0 = u.size.y * 0.3;
  if (p.y < y0) { return plain; }
  let src = y0 + (p.y - y0) * (u.size.y - y0) / (u.size.y - y0 + len);
  let col = tex(vec2f(p.x + sin(p.y * 0.05 + n * 6.0) * 2.0 * q * q, src));
  return vec4f(col.rgb * (1.0 - 0.25 * q * smoothstep(y0, u.size.y + len, p.y)), col.a);
}`,
});
// #endregion melt

// #region stuck
// stuck: for the sticky bar. u_amount goes 0 → 1 when the bar sticks, and its
// lower edge grows a moving wave. u_progress is how far the page has scrolled,
// drawn as a bright line along that edge.
defineEffect('stuck', {
  bleed: 18,
  animated: true,
  glsl: `
vec4 fx(vec2 p) {
  float s = clamp(u_amount, 0.0, 1.0);
  float wave = (sin(p.x * 0.045 + u_time * 2.2) + sin(p.x * 0.019 - u_time * 1.4)) * 3.2 + 8.0;
  float edge = u_size.y + wave * s;
  vec4 col = p.y <= u_size.y - 1.0 ? tex(p) : tex(vec2(p.x, u_size.y - 1.5)) * (1.0 - smoothstep(edge - 1.0, edge + 0.5, p.y));
  float sheen = exp(-pow((p.x - fract(u_time * 0.25) * (u_size.x + 240.0) + 120.0 + p.y) / 30.0, 2.0)) * 0.16 * s;
  col.rgb += col.a * sheen;
  float line = (1.0 - smoothstep(1.2, 2.6, abs(p.y - edge + 1.5))) * step(p.x, u_progress * u_size.x) * step(0.0, p.x);
  return mix(col, vec4(1.0, 0.82, 0.35, 1.0), line);
}`,
  wgsl: `
fn fx(p: vec2f) -> vec4f {
  let s = clamp(u.amount, 0.0, 1.0);
  let wave = (sin(p.x * 0.045 + u.time * 2.2) + sin(p.x * 0.019 - u.time * 1.4)) * 3.2 + 8.0;
  let edge = u.size.y + wave * s;
  var col = tex(p);
  if (p.y > u.size.y - 1.0) { col = tex(vec2f(p.x, u.size.y - 1.5)) * (1.0 - smoothstep(edge - 1.0, edge + 0.5, p.y)); }
  let sheen = exp(-pow((p.x - fract(u.time * 0.25) * (u.size.x + 240.0) + 120.0 + p.y) / 30.0, 2.0)) * 0.16 * s;
  col = vec4f(col.rgb + col.a * sheen, col.a);
  let line = (1.0 - smoothstep(1.2, 2.6, abs(p.y - edge + 1.5))) * step(p.x, u.progress * u.size.x) * step(0.0, p.x);
  return mix(col, vec4f(1.0, 0.82, 0.35, 1.0), line);
}`,
});
// #endregion stuck
