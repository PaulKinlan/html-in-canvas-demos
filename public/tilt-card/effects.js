// The effects of /tilt-card/: foil, hologram and lenticular. Each one leans the
// card in perspective and changes its surface with the same two numbers:
//
//   u_xy       --fx-x, --fx-y   the lean, -1..1 each way (from the phone's tilt or the pointer)
//   u_amount   --fx-amount      how far the card leans, in units of 14 degrees
//
// Every effect has GLSL for WebGL and WGSL for WebGPU.

import { defineEffect, tiltMatrix } from '/lib/effects.js';

// #region lean
// Where the card is drawn. The fx library gives the shader the inverse of this
// matrix as unproject(), and gives the browser the matrix itself, so the card's
// buttons are pressed where they are drawn.
const lean = ({ width, height, x, y, amount }) => (x || y ? tiltMatrix(width, height, -y * 14 * amount, x * 14 * amount, 700) : null);
// #endregion lean

// #region common
const GLSL = `
const vec3 W = vec3(0.3, 0.6, 0.1);
// The card at a point of its own surface, with a smooth outer edge.
vec4 card(vec2 s) {
  float e = min(min(s.x, s.y), min(u_size.x - s.x, u_size.y - s.y));
  float cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
  return tex(clamp(s, vec2(0.5), u_size - 0.5)) * cover;
}
vec3 rainbow(float t) { return 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }
// 1 where the picture is magenta. CSS paints the hologram patch in that colour to mark it.
float keyed(vec4 c) {
  vec3 k = c.rgb / max(c.a, 1e-3) - vec3(1.0, 0.0, 1.0);
  return (1.0 - smoothstep(0.25, 0.55, length(k))) * c.a;
}
// Glitter: 3 px facets, each bright when the lean matches the facet's own direction.
float glint(vec2 s) {
  vec2 cell = floor(s / 3.0);
  vec2 facet = vec2(hash(cell), hash(cell + 17.0)) * 2.0 - 1.0;
  return pow(max(0.0, 1.0 - length(facet - u_xy) * 1.8), 5.0) * step(0.55, hash(cell + 31.0));
}`;
const WGSL = `
const W = vec3f(0.3, 0.6, 0.1);
fn card(s: vec2f) -> vec4f {
  let e = min(min(s.x, s.y), min(u.size.x - s.x, u.size.y - s.y));
  let cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
  return tex(clamp(s, vec2f(0.5), u.size - 0.5)) * cover;
}
fn rainbow(t: f32) -> vec3f { return 0.5 + 0.5 * cos(6.2832 * (t + vec3f(0.0, 0.33, 0.67))); }
fn keyed(c: vec4f) -> f32 {
  let k = c.rgb / max(c.a, 1e-3) - vec3f(1.0, 0.0, 1.0);
  return (1.0 - smoothstep(0.25, 0.55, length(k))) * c.a;
}
fn glint(s: vec2f) -> f32 {
  let cell = floor(s / 3.0);
  let facet = vec2f(hash(cell), hash(cell + 17.0)) * 2.0 - 1.0;
  return pow(max(0.0, 1.0 - length(facet - u.xy) * 1.8), 5.0) * step(0.55, hash(cell + 31.0));
}`;
// #endregion common

// #region foil
// foil: colour bands that slide over a crinkled surface as the card leans, a
// bright band that crosses it, and glitter. The magenta patch becomes rings of
// full colour.
defineEffect('foil', {
  bleed: 30,
  geometry: lean,
  glsl: GLSL + `
vec4 fx(vec2 p) {
  vec2 s = unproject(p);
  vec4 col = card(s);
  vec2 uv = s / u_size.x;
  float t = dot(uv, vec2(0.9, 0.5)) * 2.2 + fbm(uv * 7.0) * 0.9 + dot(u_xy, vec2(1.1, 0.8)) * 1.6;
  float dark = 1.0 - dot(col.rgb, W);
  float band = exp(-pow((dot(uv, vec2(0.8, 0.6)) - 0.55 - u_xy.x * 0.7 - u_xy.y * 0.4) / 0.13, 2.0));
  float g = glint(s);
  vec3 foil = col.rgb + col.a * (rainbow(t) * 0.24 * dark + band * 0.26 + g * 0.5 * dark);
  vec2 ring = fract(s / 26.0) - 0.5;
  vec3 holo = rainbow(length(ring) * 3.0 + t * 1.5) * (0.75 + 0.25 * band) + g;
  return vec4(mix(foil, holo * col.a, keyed(col)), col.a);
}`,
  wgsl: WGSL + `
fn fx(p: vec2f) -> vec4f {
  let s = unproject(p);
  let col = card(s);
  let uv = s / u.size.x;
  let t = dot(uv, vec2f(0.9, 0.5)) * 2.2 + fbm(uv * 7.0) * 0.9 + dot(u.xy, vec2f(1.1, 0.8)) * 1.6;
  let dark = 1.0 - dot(col.rgb, W);
  let band = exp(-pow((dot(uv, vec2f(0.8, 0.6)) - 0.55 - u.xy.x * 0.7 - u.xy.y * 0.4) / 0.13, 2.0));
  let g = glint(s);
  let foil = col.rgb + col.a * (rainbow(t) * 0.24 * dark + band * 0.26 + g * 0.5 * dark);
  let ring = fract(s / 26.0) - 0.5;
  let holo = rainbow(length(ring) * 3.0 + t * 1.5) * (0.75 + 0.25 * band) + g;
  return vec4f(mix(foil, holo * col.a, keyed(col)), col.a);
}`,
});
// #endregion foil

// #region hologram
// hologram: a fine diagonal grating whose colour depends on the lean. Inside the
// magenta patch there are two pictures: stars when the card leans one way and
// rings when it leans the other.
defineEffect('hologram', {
  bleed: 30,
  geometry: lean,
  glsl: GLSL + `
vec4 fx(vec2 p) {
  vec2 s = unproject(p);
  vec4 col = card(s);
  vec3 iris = rainbow(dot(s, vec2(0.7, 0.7)) * 0.05 + u_xy.x * 2.0 + u_xy.y * 1.2);
  vec2 tile = fract(s / 34.0) - 0.5;
  float star = 1.0 - smoothstep(0.03, 0.06, abs(length(tile) - 0.3 - 0.1 * cos(atan(tile.y, tile.x) * 5.0)));
  float rings = 0.5 + 0.5 * cos(length(tile) * 60.0);
  float right = smoothstep(-0.1, 0.5, u_xy.x);
  float left = 1.0 - smoothstep(-0.5, 0.1, u_xy.x);
  vec3 holo = iris * (0.3 + 0.7 * (star * right + rings * left)) + glint(s) * 0.6;
  float band = exp(-pow((s.x / u_size.x - 0.5 - u_xy.x * 0.8) / 0.12, 2.0));
  vec3 rest = col.rgb + col.a * (band * 0.2 + iris * 0.08);
  return vec4(mix(rest, holo * col.a, keyed(col)), col.a);
}`,
  wgsl: WGSL + `
fn fx(p: vec2f) -> vec4f {
  let s = unproject(p);
  let col = card(s);
  let iris = rainbow(dot(s, vec2f(0.7, 0.7)) * 0.05 + u.xy.x * 2.0 + u.xy.y * 1.2);
  let tile = fract(s / 34.0) - 0.5;
  let star = 1.0 - smoothstep(0.03, 0.06, abs(length(tile) - 0.3 - 0.1 * cos(atan2(tile.y, tile.x) * 5.0)));
  let rings = 0.5 + 0.5 * cos(length(tile) * 60.0);
  let right = smoothstep(-0.1, 0.5, u.xy.x);
  let left = 1.0 - smoothstep(-0.5, 0.1, u.xy.x);
  let holo = iris * (0.3 + 0.7 * (star * right + rings * left)) + glint(s) * 0.6;
  let band = exp(-pow((s.x / u.size.x - 0.5 - u.xy.x * 0.8) / 0.12, 2.0));
  let rest = col.rgb + col.a * (band * 0.2 + iris * 0.08);
  return vec4f(mix(rest, holo * col.a, keyed(col)), col.a);
}`,
});
// #endregion hologram

// #region lenticular
// lenticular: only the lenses. One ridge every 6 px bends the picture sideways
// and carries a highlight that moves with the lean. Which of the two faces each
// strip shows is decided in CSS (see "faces" in index.html), at the same 6 px pitch.
defineEffect('lenticular', {
  bleed: 30,
  geometry: lean,
  glsl: GLSL + `
vec4 fx(vec2 p) {
  vec2 s = unproject(p);
  float phase = s.x / 6.0 * 6.2832;
  vec4 col = card(s + vec2(sin(phase) * 0.9, 0.0));
  float rib = 0.5 + 0.5 * cos(phase - u_xy.x * 3.0);
  col.rgb = col.rgb * (0.86 + 0.18 * rib) + col.a * pow(rib, 8.0) * 0.12;
  return col;
}`,
  wgsl: WGSL + `
fn fx(p: vec2f) -> vec4f {
  let s = unproject(p);
  let phase = s.x / 6.0 * 6.2832;
  let col = card(s + vec2f(sin(phase) * 0.9, 0.0));
  let rib = 0.5 + 0.5 * cos(phase - u.xy.x * 3.0);
  return vec4f(col.rgb * (0.86 + 0.18 * rib) + col.a * pow(rib, 8.0) * 0.12, col.a);
}`,
});
// #endregion lenticular
