// The WebGPU route for <dom-lens>: the same lenses as lens-gl.js, in WGSL.
//
// It has the same shape as the WebGL renderer (can / upload / draw), so
// dom-lens.js does not care which one it is talking to:
//
//   upload()  queue.copyExternalImageToTexture() copies the magnified patch
//             out of the element's 2D canvas (origin and size select the
//             sub-rectangle), then a small blit pipeline builds the mip chain
//             for lenses that blur or minify;
//   draw()    one render pass with the lens's pipeline into a shared WebGPU
//             canvas, which the element copies back with drawImage().
//
// queue.drawElementImageToTexture() is not used here on purpose: it draws the
// element at its own size, and a lens needs the patch re-rasterized at the
// lens's zoom to stay sharp, which only the 2D context's transform gives.
//
// Each entry of WGSL defines `fn lens(p: vec2f) -> vec4f`. The helpers mirror
// the GLSL ones: src(q), srcLod(q, lod), ring(), disc(), inside(), u.zoom,
// u.time, u.px, u.css, u.k, u.look.

import { webgpu } from '../shared/backend.js';
import { GLASS_N, LENSES } from './lens-gl.js';

const PRELUDE = /* wgsl */ `
diagnostic(off, derivative_uniformity);
struct U { k: vec4f, m0: vec4f, m1: vec4f, m2: vec4f, look: vec2f, zoom: f32, time: f32, reach: f32, px: f32, css: f32, box: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
const PI = 3.14159265;
const DARK = vec3f(0.08);
var<private> fragCoord: vec2f;
fn src(q: vec2f) -> vec4f { return textureSample(tex, smp, q / u.reach * 0.5 + 0.5); }
fn srcLod(q: vec2f, lod: f32) -> vec4f { return textureSampleLevel(tex, smp, q / u.reach * 0.5 + 0.5, lod); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn hash(p0: vec2f) -> f32 { var p = fract(p0 * vec2f(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
fn inside(p: vec2f) -> f32 { return (1.0 - length(p)) * u.px / u.css; }
fn disc(p: vec2f, grow: f32) -> f32 { let w = 1.0 / u.css; return smoothstep(-grow - w, -grow, inside(p)); }
fn ring(c: vec3f, p: vec2f, edge: vec3f) -> vec4f {
  let r = length(p); let d = inside(p); let w = 1.0 / u.css;
  var col = c + 0.16 * smoothstep(0.5, 0.1, length(p - vec2f(-0.35, -0.4)));
  col *= 1.0 - 0.22 * smoothstep(0.85, 1.0, r);
  col = mix(col, vec3f(1.0), 0.7 * (1.0 - smoothstep(0.5, 0.5 + w, abs(d - 2.5))));
  col = mix(col, edge, 1.0 - smoothstep(1.5, 1.5 + w, abs(d)));
  return vec4f(col, disc(p, 1.5));
}
fn withShadow(col: vec3f, a: f32, sh: f32) -> vec4f { let aa = max(a, sh * (1.0 - a)); return vec4f(col * a / max(aa, 1e-4), aa); }
fn vnoise(x: vec2f) -> f32 {
  let i = floor(x); var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), f.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn fbm(x0: vec2f) -> f32 {
  var a = 0.5; var s = 0.0; var x = x0;
  for (var i = 0; i < 4; i++) { s += a * vnoise(x); x = x * 2.03 + 17.0; a *= 0.5; }
  return s;
}
fn fire(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  return vec3f(smoothstep(0.0, 0.4, t), smoothstep(0.22, 0.8, t) * 0.88, smoothstep(0.68, 1.0, t) * 0.75);
}
`;

const MAIN = /* wgsl */ `
struct VO { @builtin(position) pos: vec4f, @location(0) p: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var c = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  var o: VO;
  o.pos = vec4f(c[i], 0.0, 1.0);
  o.p = vec2f(c[i].x, -c[i].y) * u.box;
  return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  fragCoord = v.pos.xy;
  let c = lens(v.p);
  return vec4f(clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}`;

export const WGSL = {
  magnify: `fn lens(p: vec2f) -> vec4f { return ring(src(p / u.zoom).rgb, p, DARK); }`,

  glass: `
const N_RGB = vec3f(${GLASS_N.map((n) => n.toFixed(3)).join(', ')});
struct Hit { q: vec2f, ok: f32, n1: vec3f };
fn trace(p: vec2f, n: f32) -> Hit {
  let rc = u.k.y; let h = sqrt(rc * rc - 1.0);
  let P1 = vec3f(p, -h + sqrt(max(rc * rc - dot(p, p), 0.0)));
  let n1 = (P1 - vec3f(0.0, 0.0, -h)) / rc;
  let d1 = refract(vec3f(0.0, 0.0, -1.0), n1, 1.0 / n);
  let cB = vec3f(0.0, 0.0, h); let oc = P1 - cB;
  let b = dot(oc, d1); let t = -b + sqrt(max(0.0, b * b - dot(oc, oc) + rc * rc));
  let P2 = P1 + d1 * t;
  let d2 = refract(d1, (cB - P2) / rc, n);
  var hit: Hit;
  hit.n1 = n1;
  hit.ok = step(0.5, dot(d2, d2));
  hit.q = P2.xy + d2.xy / max(-d2.z, 1e-4) * (u.k.x + P2.z);
  return hit;
}
fn lens(p: vec2f) -> vec4f {
  let d = inside(p); let w = 1.0 / u.css;
  let rimW = 5.0;
  let g = 1.0 - rimW * u.css / u.px;
  let pg0 = p / g;
  let within = step(dot(pg0, pg0), 0.9999);
  let pg = pg0 * within;
  let hr = trace(pg, N_RGB.r); let hg = trace(pg, N_RGB.g); let hb = trace(pg, N_RGB.b);
  var col = vec3f(src(hr.q * g).r * hr.ok, src(hg.q * g).g * hg.ok, src(hb.q * g).b * hb.ok);
  let n1 = hb.n1;
  let f0 = 0.04; let fres = f0 + (1.0 - f0) * pow(1.0 - n1.z, 5.0);
  let L = normalize(vec3f(-0.45, -0.6, 0.66));
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n1, H), 0.0), 90.0) + 0.25 * pow(max(dot(n1, normalize(vec3f(0.5, 0.62, 0.6))), 0.0), 40.0);
  col = mix(col, vec3f(0.82, 0.88, 0.95), fres * 0.55) + spec * 0.9;
  col *= 1.0 - 0.25 * smoothstep(0.8, 1.0, length(pg));
  col *= within;
  let rim = smoothstep(rimW + w, rimW, d);
  let bevel = clamp(d / rimW, 0.0, 1.0);
  let lit = 0.5 + 0.5 * dot(normalize(p + 1e-5), normalize(vec2f(-0.45, -0.6))) * (bevel * 2.0 - 1.0);
  let metal = mix(vec3f(0.12, 0.11, 0.1), vec3f(0.93, 0.84, 0.62), lit * lit) * (0.75 + 0.25 * sin(bevel * PI));
  col = mix(col, metal, rim);
  let sh = 0.28 * smoothstep(7.0, 0.0, (length(p - vec2f(0.02, 0.035)) - 1.0) * u.px / u.css);
  return withShadow(col, disc(p, 0.0), sh);
}`,

  fisheye: `fn lens(p: vec2f) -> vec4f {
  let k = 1.0 / u.zoom;
  return ring(src(p * (k + (1.0 - k) * dot(p, p))).rgb, p, DARK);
}`,

  droplet: `fn lens(p: vec2f) -> vec4f {
  let r = length(p);
  let sag = clamp(0.18 + 0.11 * u.zoom, 0.2, 0.95);
  let rc = (1.0 + sag * sag) / (2.0 * sag);
  let hgt = sqrt(max(rc * rc - r * r, 0.0)) - (rc - sag);
  var n = normalize(vec3f(p, sqrt(max(rc * rc - r * r, 1e-4))));
  let wave = sin(r * 22.0 - u.time * 5.0) * 0.07 * smoothstep(0.0, 0.25, r) * (1.0 - r);
  n = normalize(n + vec3f(p / max(r, 1e-4) * wave, 0.0));
  let d = refract(vec3f(0.0, 0.0, -1.0), n, 1.0 / 1.333);
  let q = p + d.xy / -d.z * hgt * 1.6;
  var col = src(q).rgb;
  let H = normalize(vec3f(-0.45, -0.6, 0.66) + vec3f(0.0, 0.0, 1.0));
  col += pow(max(dot(n, H), 0.0), 60.0) * 0.9;
  col += 0.12 * smoothstep(0.75, 1.0, r) * smoothstep(-0.2, 0.9, dot(p, vec2f(0.6, 0.8)));
  col *= 1.0 - 0.35 * smoothstep(0.9, 1.0, r) * smoothstep(0.3, -0.8, dot(p, vec2f(0.6, 0.8)));
  return vec4f(col, disc(p, 0.0));
}`,

  frosted: `fn lens(p: vec2f) -> vec4f {
  let q = p / u.zoom;
  var col = vec3f(0.0);
  let seed = hash(fragCoord);
  for (var i = 0; i < 10; i++) {
    let a = (f32(i) + seed) * 2.39996; let rr = sqrt((f32(i) + 0.5) / 10.0) * 0.075;
    col += srcLod(q + vec2f(cos(a), sin(a)) * rr, 2.5).rgb;
  }
  col = col / 10.0;
  col = mix(col, vec3f(1.0), 0.12) + (hash(fragCoord * 1.7) - 0.5) * 0.05;
  return ring(col, p, vec3f(0.45, 0.5, 0.55));
}`,

  night: `fn lens(p: vec2f) -> vec4f {
  var l = luma(src(p / u.zoom).rgb);
  l = pow(l, 0.75) * 1.15;
  let grain = hash(fragCoord + floor(u.time * 24.0) * 17.0) - 0.5;
  let scan = 0.92 + 0.08 * sin(fragCoord.y * PI / max(1.0, floor(u.css * 1.5)));
  var col = vec3f(0.08, 1.0, 0.22) * (l + grain * 0.22) * scan;
  col += vec3f(0.5, 0.6, 0.5) * smoothstep(0.85, 1.2, l);
  col *= 1.0 - 0.75 * smoothstep(0.55, 1.0, length(p));
  return ring(col, p, vec3f(0.02, 0.05, 0.02));
}`,

  thermal: `fn iron(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  var c = mix(vec3f(0.02, 0.01, 0.18), vec3f(0.45, 0.02, 0.55), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3f(0.9, 0.12, 0.2), smoothstep(0.25, 0.5, t));
  c = mix(c, vec3f(1.0, 0.6, 0.05), smoothstep(0.5, 0.75, t));
  return mix(c, vec3f(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, t));
}
fn lens(p: vec2f) -> vec4f {
  let c = srcLod(p / u.zoom, 1.5).rgb;
  let sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  let heat = (1.0 - luma(c)) * 0.85 + sat * 0.5 + 0.08;
  return ring(iron(heat), p, DARK);
}`,

  xray: `fn lens(p: vec2f) -> vec4f { return ring(src(p / u.zoom).rgb, p, vec3f(0.37, 0.82, 1.0)); }`,

  halftone: `fn lens(p: vec2f) -> vec4f {
  let cell = 3.5 * u.css / u.px;
  // GLSL's mat2(0.7071, -0.7071, 0.7071, 0.7071) times p, written out.
  let g = vec2f(0.7071 * p.x + 0.7071 * p.y, -0.7071 * p.x + 0.7071 * p.y) / cell;
  let id = floor(g) + 0.5;
  let ic = id * cell;
  let centre = vec2f(0.7071 * ic.x - 0.7071 * ic.y, 0.7071 * ic.x + 0.7071 * ic.y);
  let c = srcLod(centre / u.zoom, log2(max(1.0, 3.5 * u.css))).rgb;
  let tone = 1.0 - luma(c);
  let dotR = sqrt(tone) * 0.72;
  let edge = 0.5 / (3.5 * u.css);
  let ink = 1.0 - smoothstep(dotR - edge, dotR + edge, length(g - id));
  let paper = vec3f(0.97, 0.95, 0.9);
  let inkCol = mix(vec3f(0.07), c * 0.55, 0.6);
  return ring(mix(paper, inkCol, ink), p, DARK);
}`,

  pixel: `fn lens(p: vec2f) -> vec4f {
  let cell = 8.0 * u.css / u.px;
  let id = (floor(p / cell) + 0.5) * cell;
  var c = srcLod(id / u.zoom, log2(max(1.0, 8.0 * u.css))).rgb;
  let f = abs(fract(p / cell) - 0.5);
  c *= 1.0 - 0.18 * smoothstep(0.42, 0.5, max(f.x, f.y));
  return ring(c, p, DARK);
}`,

  cvd: `fn lens(p: vec2f) -> vec4f {
  var c = pow(src(p / u.zoom).rgb, vec3f(2.2));
  c = vec3f(dot(c, u.m0.xyz), dot(c, u.m1.xyz), dot(c, u.m2.xyz));
  c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  return ring(c, p, DARK);
}`,

  blackhole: `fn lens(p: vec2f) -> vec4f {
  let th = max(length(p), 1e-4);
  let te = clamp(0.2 + 0.06 * u.zoom, 0.22, 0.6);
  let fade = smoothstep(1.0, 0.72, th);
  let beta = th - te * te / th * fade;
  var col = src(p / th * beta).rgb;
  let shadow = te * 0.52;
  let a = atan2(p.y, p.x);
  let swirl = 0.6 + 0.4 * sin(a * 3.0 - u.time * 1.6 + 6.0 / (th + 0.2));
  let ringGlow = exp(-pow((th - shadow * 1.18) / (shadow * 0.16), 2.0)) * (0.7 + 0.3 * sin(a - u.time * 0.8));
  let halo = exp(-(th - shadow) / (te * 0.55)) * step(shadow, th) * swirl * 0.5;
  col = mix(col, vec3f(0.0), smoothstep(shadow * 1.06, shadow * 0.94, th));
  col += vec3f(1.0, 0.62, 0.25) * (ringGlow + halo * fade);
  return vec4f(col, disc(p, 0.0));
}`,

  kaleidoscope: `fn lens(p: vec2f) -> vec4f {
  let r = length(p); let seg = PI / 6.0;
  var a = atan2(p.y, p.x) + u.time * 0.12;
  a = a - 2.0 * seg * floor(a / (2.0 * seg));
  a = abs(a - seg);
  let col = src(vec2f(cos(a - seg * 0.5), sin(a - seg * 0.5)) * r / u.zoom).rgb;
  return ring(col, p, vec3f(0.35, 0.2, 0.5));
}`,

  eye: `
fn inkAt(q: vec2f, lod: f32) -> f32 { return clamp(1.0 - luma(srcLod(q, lod).rgb) * 1.04, 0.0, 1.0); }
fn pull(r: f32) -> f32 { return r / u.zoom * (1.0 - 0.27 * r * r); }
fn eyeball(p: vec2f, t: f32) -> vec4f {
  let r = length(p);
  let dir = p / max(r, 1e-4);
  let e = p * vec2f(0.8, 1.25);
  let er = length(e); let R0 = 0.52;
  let c = u.look * vec2f(0.22, 0.1);
  let f = fbm(e * 3.6 - dir * t * 1.6);
  let streak = fbm(normalize(p - c + 1e-5) * 5.0 + vec2f(er * 2.0 - t * 0.5, t * 0.2));
  let iris = (0.3 + 1.2 * streak * streak) * (1.25 - er * 1.1);
  let flames = clamp(f * 2.2 - (er - R0) * 2.1, 0.0, 1.0) * (0.45 + f);
  var heat = mix(iris, flames, smoothstep(R0 - 0.1, R0 + 0.06, er));
  heat *= 1.0 - 0.45 * exp(-pow((er - R0 + 0.04) * 14.0, 2.0));
  var q = (p - c) / vec2f(0.17 + 0.025 * sin(t * 1.7), 0.56);
  q.x /= 1.0 - 0.75 * q.y * q.y;
  let pd = length(q);
  heat += exp(-pow((pd - 1.0) * 3.0, 2.0)) * 0.35 * step(1.0, pd);
  var col = fire(heat);
  col = mix(col, vec3f(0.03, 0.0, 0.0), smoothstep(1.05, 0.9, pd));
  let cover = max(clamp(heat * 1.8, 0.0, 1.0), smoothstep(1.05, 0.9, pd)) * smoothstep(1.25, 0.95, r);
  return vec4f(col, cover);
}
fn lens(p: vec2f) -> vec4f {
  let r = length(p); let t = u.time;
  let dir = p / max(r, 1e-4);
  let n1 = fbm(p * 3.0 + vec2f(0.0, -t * 0.4));
  let edgeR = min(0.985, 0.87 + 0.24 * (fbm(dir * 2.2 + vec2f(t * 0.22, -t * 0.17)) - 0.5));
  let d = edgeR - r;
  let wob = (vec2f(fbm(p * 5.0 + vec2f(0.0, -t * 1.4)), fbm(p * 5.0 + vec2f(7.0, -t * 1.1))) - 0.5) * 0.06 * r / u.zoom;
  let q = dir * pull(r) + wob;
  let page = src(q).rgb;
  let ink = clamp(1.0 - luma(page) * 1.04, 0.0, 1.0);
  let halo = inkAt(q, 3.0);
  var trail = 0.0;
  for (var i = 1; i <= 6; i++) {
    let fi = f32(i); let rr = max(r - fi * 0.028, 0.0);
    let lick = (vec2f(vnoise(p * 13.0 + fi + t * 2.3), vnoise(p * 13.0 - fi - t * 2.0)) - 0.5) * 0.012 * fi / u.zoom;
    trail += inkAt(dir * pull(rr) + wob + lick, 1.5) * (1.0 - fi / 7.0);
  }
  let burn = clamp(smoothstep(0.25, edgeR, r) + (n1 - 0.5) * 0.5, 0.0, 1.0);
  trail *= 0.5 * (0.35 + fbm(p * 9.0 - dir * t * 2.6)) * (0.35 + burn);
  var col = mix(vec3f(1.0), page, 0.25) * mix(vec3f(0.98, 0.86, 0.66), vec3f(0.3, 0.13, 0.05), pow(burn, 1.3));
  let crumble = smoothstep(burn * 1.2 - 0.3, burn * 1.2, 0.3 + vnoise(p * 42.0 + t * 0.6));
  let ember = fire(0.3 + burn * 0.8 + 0.12 * sin(t * 4.0 + n1 * 30.0));
  col = mix(col, vec3f(0.07, 0.03, 0.02), ink * (1.0 - burn) * 0.9);
  col = mix(col, ember, ink * smoothstep(0.1, 0.6, burn) * crumble);
  col += vec3f(1.0, 0.42, 0.08) * max(halo * 1.6 - ink, 0.0) * (0.25 + burn) * 1.3;
  col += fire(0.35 + trail * 1.2) * trail * 1.5;
  col *= 1.0 - 0.9 * smoothstep(0.15, 0.02, d);
  col += fire(0.72 + 0.28 * sin(t * 3.0 + n1 * 25.0)) * exp(-pow(d / 0.022, 2.0)) * 1.5;
  let sp = clamp(pow(vnoise(p * 60.0 - dir * t * 3.2 + 3.0), 34.0) * 6000.0, 0.0, 1.0) * smoothstep(0.5, 0.9, r) * (0.5 + 0.5 * sin(t * 9.0 + n1 * 40.0));
  col += vec3f(1.0, 0.72, 0.3) * sp;
  let eye = eyeball(p / 0.4, t);
  col = mix(col, eye.rgb, eye.a);
  let a = smoothstep(0.0, 0.012, d);
  let scorch = 0.7 * smoothstep(-0.07, 0.0, d) + sp;
  let outside = mix(vec3f(0.16, 0.06, 0.02), vec3f(1.0, 0.6, 0.15), max(sp, exp(-pow(d / 0.022, 2.0))));
  let alpha = max(a, clamp(scorch, 0.0, 1.0) * (1.0 - a));
  return vec4f(mix(outside, col, a), alpha * disc(p, 0.0));
}`,

  reading: `fn lens(p: vec2f) -> vec4f {
  let hs = vec2f(1.0, 0.46);
  let rad = 0.12;
  let dd = abs(p) - hs + rad;
  let sd = (length(max(dd, vec2f(0.0))) + min(max(dd.x, dd.y), 0.0) - rad) * u.px / u.css;
  let w = 1.0 / u.css;
  var c = src(p / u.zoom).rgb;
  let l = luma(c);
  c = mix(vec3f(l), c, 0.85);
  c = clamp((c - 0.5) * 1.5 + 0.5, vec3f(0.0), vec3f(1.0));
  c *= vec3f(1.0, 0.965, 0.84);
  let band = smoothstep(0.2, 0.14, abs(p.y));
  c *= mix(0.9, 1.0, band);
  c = mix(c, vec3f(0.1), 1.0 - smoothstep(1.5, 1.5 + w, abs(sd)));
  let a = smoothstep(1.5 + w, 1.5, sd);
  let sh = 0.25 * smoothstep(8.0, 0.0, sd - 1.0) * step(0.0, p.y + 0.3);
  return withShadow(c, a, sh);
}`,
};

const BLIT = /* wgsl */ `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var c = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO;
  o.pos = vec4f(c[i], 0.0, 1.0);
  o.uv = vec2f(c[i].x, -c[i].y) * 0.5 + 0.5;
  return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(tex, smp, v.uv, 0.0); }`;

/** Mip levels kept for lenses that blur or minify. More would only cost passes. */
const MIP_LEVELS = 6;
const TEX_FORMAT = 'rgba8unorm';

export class LensRendererGPU {
  canvas = document.createElement('canvas');
  dead = false;
  owner = null;
  /** Set to an rgba8unorm format to render into a texture instead of the canvas (tests read it back). */
  offscreen = false;
  /** Lenses whose WGSL failed to compile, with the reason. */
  broken = new Map();
  #gpu;
  #device;
  #ctx = null;
  #pipelines = new Map();
  #sampler;
  #mipSampler;
  #blit = null;
  #texture = null;
  #texKey = '';
  #views = null;
  #ubo;
  #data = new Float32Array(24);
  #binds = new Map();
  #target = null;

  constructor(gpu) {
    this.#gpu = gpu;
    this.#device = gpu.device;
    this.canvas.width = this.canvas.height = 64;
    this.#sampler = this.#device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.#mipSampler = this.#device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.#ubo = this.#device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    gpu.device.lost.then(() => {
      this.dead = true;
      this.owner = null;
      dispatchEvent(new Event('lensrendererrestored'));
    });
  }

  get format() {
    return this.offscreen ? TEX_FORMAT : this.#gpu.format;
  }

  #pipeline(name) {
    const key = name + '/' + this.format;
    let p = this.#pipelines.get(key);
    if (p !== undefined) return p;
    const device = this.#device;
    p = null;
    if (WGSL[name] && !this.broken.has(name)) {
      device.pushErrorScope('validation');
      const module = device.createShaderModule({ code: PRELUDE + WGSL[name] + MAIN });
      p = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-strip' },
      });
      // Validation is asynchronous: a lens that fails is dropped from this
      // route a moment later and dom-lens falls back to WebGL for it.
      device.popErrorScope().then((err) => {
        if (!err) return;
        console.error(`lens "${name}" did not compile for WebGPU:\n${err.message}`);
        this.broken.set(name, err.message);
        this.#pipelines.set(key, null);
        dispatchEvent(new Event('lensrendererrestored'));
      });
    }
    this.#pipelines.set(key, p);
    return p;
  }

  can(name) {
    return !this.dead && !!LENSES[name] && !!this.#pipeline(name);
  }

  /** Same contract as the WebGL renderer's upload(). */
  upload(source, x, y, size, mip, owner) {
    const device = this.#device;
    const levels = mip ? Math.min(MIP_LEVELS, Math.floor(Math.log2(size)) + 1) : 1;
    const key = size + '/' + levels;
    if (key !== this.#texKey) {
      this.#texture?.destroy();
      this.#texture = device.createTexture({
        size: [size, size],
        format: TEX_FORMAT,
        mipLevelCount: levels,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.#texKey = key;
      this.#views = Array.from({ length: levels }, (_, i) => this.#texture.createView({ baseMipLevel: i, mipLevelCount: 1 }));
      this.#binds.clear();
    }
    // The 2D canvas is premultiplied and so is everything downstream: no conversion.
    device.queue.copyExternalImageToTexture({ source, origin: [x, y] }, { texture: this.#texture, premultipliedAlpha: true }, [size, size]);
    if (levels > 1) {
      const blit = (this.#blit ??= this.#makeBlit());
      const enc = device.createCommandEncoder();
      for (let i = 1; i < levels; i++) {
        let bind = this.#binds.get('mip' + i);
        if (!bind) {
          bind = device.createBindGroup({ layout: blit.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.#views[i - 1] }, { binding: 1, resource: this.#mipSampler }] });
          this.#binds.set('mip' + i, bind);
        }
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.#views[i], loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(blit);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
      }
      device.queue.submit([enc.finish()]);
    }
    this.owner = owner;
  }

  #makeBlit() {
    const module = this.#device.createShaderModule({ code: BLIT });
    return this.#device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: TEX_FORMAT }] } });
  }

  /** Same contract as the WebGL renderer's draw(). */
  draw(o) {
    const device = this.#device;
    const def = LENSES[o.name];
    const pipeline = this.#pipeline(o.name);
    const n = o.boxPx;
    const d = this.#data;
    d.set(def.params ? def.params(o.zoom, o.variant) : [0, 0, 0, 0], 0);
    const m = def.matrix ? def.matrix(o.variant) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    d.set(m.slice(0, 3), 4);
    d.set(m.slice(3, 6), 8);
    d.set(m.slice(6, 9), 12);
    d.set(o.look ?? [0, 0], 16);
    d[18] = o.zoom;
    d[19] = o.time;
    d[20] = o.reach;
    d[21] = o.radiusPx;
    d[22] = o.css;
    d[23] = n / 2 / o.radiusPx;
    device.queue.writeBuffer(this.#ubo, 0, d);

    let bind = this.#binds.get(o.name);
    if (!bind) {
      bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.#ubo } }, { binding: 1, resource: this.#texture.createView() }, { binding: 2, resource: this.#sampler }],
      });
      this.#binds.set(o.name, bind);
    }

    let view;
    if (this.offscreen) {
      if (!this.#target || this.#target.width < n) {
        this.#target?.destroy();
        this.#target = device.createTexture({ size: [n, n], format: TEX_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      }
      view = this.#target.createView();
    } else {
      if (this.canvas.width < n || this.canvas.height < n) this.canvas.width = this.canvas.height = Math.max(n, this.canvas.width);
      if (!this.#ctx) {
        this.#ctx = this.canvas.getContext('webgpu');
        this.#ctx.configure({ device, format: this.#gpu.format, alphaMode: 'premultiplied' });
      }
      view = this.#ctx.getCurrentTexture().createView();
    }
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setViewport(0, 0, n, n, 0, 1);
    pass.setScissorRect(0, 0, n, n);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(4);
    pass.end();
    device.queue.submit([enc.finish()]);
    // WebGPU's origin is the top-left, so the viewport is the top-left n x n of the canvas.
    return { x: 0, y: 0, size: n };
  }

  /** Offscreen mode only: the last draw as RGBA bytes, n x n, top row first. */
  async read(n) {
    const device = this.#device;
    const stride = Math.ceil((n * 4) / 256) * 256;
    const buffer = device.createBuffer({ size: stride * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.#target }, { buffer, bytesPerRow: stride }, [n, n]);
    device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8ClampedArray(n * n * 4);
    for (let y = 0; y < n; y++) out.set(raw.subarray(y * stride, y * stride + n * 4), y * n * 4);
    buffer.unmap();
    buffer.destroy();
    return out;
  }
}

let shared = null;
let started = false;
/** Why WebGPU is not in use, for the page to show. Empty when it is. */
export let gpuReason = 'not tried yet';

/**
 * The shared WebGPU lens renderer, or null while it is starting, when WebGPU
 * is not usable, or after the device is lost. The first call starts it; a
 * 'lensrendererrestored' event on window says when to ask again.
 */
export function lensRendererGPU({ force = false } = {}) {
  if (!started || (force && !shared && !lensRendererGPU.forced)) {
    started = true;
    lensRendererGPU.forced = force;
    gpuReason = 'starting';
    webgpu({ force }).then((gpu) => {
      if (gpu) {
        shared = new LensRendererGPU(gpu);
        gpuReason = '';
        gpu.device.lost.then(() => (gpuReason = webgpu.reason || 'the WebGPU device was lost'));
      } else gpuReason = webgpu.reason;
      dispatchEvent(new Event('lensrendererrestored'));
    });
  }
  return shared && !shared.dead ? shared : null;
}
