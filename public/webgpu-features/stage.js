// The renderer behind /webgpu-features/.
//
// One canvas holds two drawable elements, a small form ("card") and a block
// of text ("words"). They are uploaded as textures and drawn in five tiles.
// Each tile uses one newer WebGPU feature when the device has it and draws
// the same picture another way when it does not:
//
//   mask    texture-component-swizzle   else the shader reads .a
//   copies  immediates                  else a uniform buffer with a dynamic offset
//   trails  float32-blendable           else rgba16float, else rgba8unorm
//   shards  primitive-index             else a flat varying from the vertex shader
//   text    dual-source-blending        else one coverage value for all three channels
//
// scene() describes a frame as a list of draws. GPUStage (WebGPU) and GLStage
// (WebGL 2) both run that list, so the two routes draw the same thing.

import { GPUElementTexture, GPUCanvas, watchFrame } from '/lib/gpu-util.js';
import { ElementTexture } from '/lib/surface.js';

export const TILES = ['mask', 'copies', 'trails', 'shards', 'text'];
const SHARDS_X = 8;
const SHARDS_Y = 5;
const SHARD_VERTICES = SHARDS_X * SHARDS_Y * 6;

/** Where the five tiles sit, in canvas pixels. Three columns when wide, two on a phone. The text tile is two cells wide. */
export function layout(width, height, cols) {
  const rows = cols === 3 ? 2 : 3;
  const cw = width / cols;
  const ch = height / rows;
  const gap = Math.round(Math.min(cw, ch) * 0.03);
  const cell = (c, r, span = 1) => ({ x: Math.round(c * cw) + gap, y: Math.round(r * ch) + gap, w: Math.round(cw * span) - 2 * gap, h: Math.round(ch) - 2 * gap });
  const tiles = cols === 3
    ? { mask: cell(0, 0), copies: cell(1, 0), trails: cell(2, 0), shards: cell(0, 1), text: cell(1, 1, 2) }
    : { mask: cell(0, 0), copies: cell(1, 0), trails: cell(0, 1), shards: cell(1, 1), text: cell(0, 2, 2) };
  return { width, height, cols, rows, tiles };
}

const P = (rect, tint = [1, 1, 1, 1], misc = [0, 0, 0, 0]) => new Float32Array([rect.x, rect.y, rect.w, rect.h, ...tint, ...misc]);
function hue(h, lift = 0) {
  const f = (n) => { const k = (n + h / 60) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((v) => v + (1 - v) * lift);
}
const fit = (box, w, h, margin) => {
  const s = Math.min(1, (box.w - 2 * margin) / w, (box.h - 2 * margin) / h);
  return { x: Math.round(box.x + (box.w - w * s) / 2), y: Math.round(box.y + (box.h - h * s) / 2), w: w * s, h: h * s };
};

/**
 * One frame as lists of draws.
 *   t        seconds
 *   L        layout()
 *   size     { card: { w, h }, words: { w, h } }, the texture sizes
 *   px       canvas pixels per CSS pixel
 *   size.words.w / 3 is the width the text is shown at; the page lays the element out to fit half of the text tile
 *   pointer  { x, y } inside the trails tile (canvas pixels from its corner), or null
 *   fade     how much of the trail is kept this frame
 * `trail` is drawn into the accumulation target (the size of the trails tile),
 * `main` into the canvas. Each draw is { op, tex, clip, p } where p is twelve
 * floats: rect (x, y, w, h), tint (r, g, b, a), misc.
 */
export function scene({ t, L, size, px = 1, pointer = null, fade = 0.95, stamp = true }) {
  const { tiles } = L;
  const strip = Math.round(30 * px); // the page puts each tile's label over its bottom edge
  const inner = (box) => ({ ...box, h: box.h - strip });
  const main = [];
  const panel = [0.5, 0.5, 0.5, 0.12];
  for (const name of TILES) {
    const tint = name === 'trails' ? [0.05, 0.05, 0.07, 1] : name === 'text' ? [0.96, 0.95, 0.92, 1] : panel;
    main.push({ op: 'solid', tex: 'card', clip: tiles[name], p: P(tiles[name], tint, [0, 1, 0, 0]) });
  }

  // mask: a glow made from the card's alpha channel, then the card itself.
  const pad = Math.round(14 * px);
  const card = fit(inner(tiles.mask), size.card.w, size.card.h, pad + 2 * px);
  const glow = { x: card.x - pad, y: card.y - pad, w: card.w + 2 * pad, h: card.h + 2 * pad };
  main.push({ op: 'glow', tex: 'mask', clip: tiles.mask, p: P(glow, [...hue((t * 40) % 360, 0.15), 0.95], [0, 0, pad, 0]) });
  main.push({ op: 'sprite', tex: 'card', clip: tiles.mask, p: P(card) });

  // copies: twelve draws of the same texture, each with its own rectangle, turn and tint.
  {
    const box = inner(tiles.copies);
    const s = Math.min((box.w / 4 - 5 * px) / size.card.w, (box.h / 3 - 5 * px) / size.card.h);
    for (let i = 0; i < 12; i++) {
      const w = size.card.w * s;
      const h = size.card.h * s;
      const cx = box.x + (box.w * ((i % 4) + 0.5)) / 4;
      const cy = box.y + (box.h * (Math.floor(i / 4) + 0.5)) / 3;
      main.push({ op: 'sprite', tex: 'card', clip: box, p: P({ x: cx - w / 2, y: cy - h / 2, w, h }, [...hue((i * 30 + t * 20) % 360, 0.55), 1], [0.3 * Math.sin(t * 1.3 + i * 1.7), 0, 0, 0]) });
    }
  }

  // trails: the accumulation target, tone mapped.
  main.push({ op: 'trails', tex: 'accum', clip: tiles.trails, p: P(tiles.trails) });
  const trail = [{ op: 'fade', fade }];
  if (stamp) {
    const box = tiles.trails;
    const s = Math.min(0.42, (box.w * 0.45) / size.card.w);
    const w = size.card.w * s;
    const h = size.card.h * s;
    const cx = pointer ? pointer.x : box.w * (0.5 + 0.36 * Math.sin(t * 1.1));
    const cy = pointer ? pointer.y : box.h * (0.5 + 0.34 * Math.sin(t * 1.7 + 1));
    trail.push({ op: 'sprite', tex: 'card', add: true, p: P({ x: cx - w / 2, y: cy - h / 2, w, h }, [...hue((t * 70) % 360, 0.1), 0.35], [t * 0.8, 0, 0, 0]) });
  }

  // shards: the card as 80 triangles that fly apart and come back.
  const cycle = (t % 6) / 6;
  const apart = Math.max(0, Math.sin(cycle * Math.PI * 2 - 1)) ** 1.5;
  main.push({ op: 'shards', tex: 'card', clip: tiles.shards, p: P(fit(inner(tiles.shards), size.card.w, size.card.h, 16 * px), [1, 1, 1, 1], [apart, 0, 0, 0]) });

  // text: the words texture is three times the size it is shown at, so every
  // canvas pixel has 3 × 3 texels under it and each colour channel can take
  // the texels under its own third of the pixel.
  const box = inner(tiles.text);
  const m = Math.round(8 * px);
  const words = { x: box.x + m, y: box.y + m, w: Math.floor(size.words.w / 3), h: Math.floor(size.words.h / 3) };
  const ink = [0.08, 0.08, 0.1, 1];
  main.push({ op: 'text', tex: 'words', clip: box, p: P(words, ink, [0, 1, 0, 0]) });
  // The same pixels again in the other half of the tile, each drawn as a block, so the coloured edges can be seen.
  const zoom = Math.max(6, Math.round(3 * px));
  const half = Math.floor(box.w / 2);
  const inset = { x: box.x + half + m, y: box.y + m, w: Math.floor((box.w - half - 2 * m) / zoom) * zoom, h: Math.floor((box.h - 2 * m) / zoom) * zoom };
  main.push({ op: 'text', tex: 'words', clip: inset, p: P(inset, ink, [0, zoom, Math.round(2 * px), Math.round(4 * px)]) });
  return { trail, main, geometry: { card, words } };
}

// ---------------------------------------------------------------------------
// WebGPU
// ---------------------------------------------------------------------------

const head = (immediates) => /* wgsl */ `
struct G { size: vec2f, time: f32, unused: f32 };
struct P { rect: vec4f, tint: vec4f, misc: vec4f };
@group(0) @binding(0) var<uniform> g: G;
${immediates ? 'var<immediate> p: P;' : '@group(1) @binding(0) var<uniform> p: P;'}
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
fn corner(i: u32) -> vec2f { return vec2f(f32(i == 1u || i == 4u || i == 5u), f32(i == 2u || i == 3u || i == 5u)); }
fn toClip(px: vec2f) -> vec4f { return vec4f(px.x / g.size.x * 2.0 - 1.0, 1.0 - px.y / g.size.y * 2.0, 0.0, 1.0); }
fn turn(v: vec2f, a: f32) -> vec2f { return vec2f(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a)); }
fn hash(n: u32) -> vec2f {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return vec2f(f32(x & 0xffffu), f32(x >> 16u)) / 65535.0;
}
fn rainbow(h: f32) -> vec3f { return clamp(abs(fract(h + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0)); }
`;

const quad = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let uv = corner(i);
  let centre = p.rect.xy + p.rect.zw * 0.5;
  var v: V;
  v.pos = toClip(centre + turn((uv - 0.5) * p.rect.zw, p.misc.x));
  v.uv = uv;
  return v;
}`;

const WGSL = {
  // #region immediates
  // A textured or plain rectangle. `p` is this draw's rectangle, tint and turn.
  // With immediates it is `var<immediate> p: P;` and each draw is preceded by
  // pass.setImmediates(0, twelveFloats). Without, it is a uniform buffer.
  sprite: (o) => head(o.immediates) + quad + /* wgsl */ `
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@fragment fn fs(v: V) -> @location(0) vec4f {
  let c = textureSample(tex, samp, v.uv);
  let t = p.tint;
  if (p.misc.y > 0.5) { return vec4f(t.rgb * t.a, t.a); }
  return vec4f(c.rgb * t.rgb * t.a, c.a * t.a);
}`,
  // #endregion immediates

  // #region swizzle
  // A glow from a one-channel mask. The shader reads .r. With
  // texture-component-swizzle the element's RGBA texture is bound through a
  // view that puts its alpha in red: texture.createView({ swizzle: 'aaa1' }).
  // Without, this shader is compiled a second time with .a in place of .r.
  glow: (o) => head(o.immediates) + quad + /* wgsl */ `
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var mask: texture_2d<f32>;
@fragment fn fs(v: V) -> @location(0) vec4f {
  let pad = p.misc.z;
  let inner = p.rect.zw - 2.0 * pad;
  let uv = (v.uv * p.rect.zw - pad) / inner;
  var sum = 0.0;
  for (var i = 0; i < 16; i++) {
    let a = f32(i) * 0.3927;
    let r = select(0.45, 0.95, i % 2 == 1) * pad;
    let q = uv + vec2f(cos(a), sin(a)) * r / inner;
    let inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    sum += textureSampleLevel(mask, samp, q, 0.0).${o.swizzle ? 'r' : 'a'} * inside;
  }
  let k = clamp(sum / 16.0 * 1.8, 0.0, 1.0) * p.tint.a;
  return vec4f(p.tint.rgb * k, k);
}`,
  // #endregion swizzle

  // #region float
  // The trail target holds sums well above 1.0. Each frame it is multiplied
  // by the fade (a blend with the blend constant) and the card is added to
  // it (a one + one blend). Blending into rgba32float needs float32-blendable.
  // This shader shows the target: 1 - exp(-sum) brings any sum back under 1.
  fade: () => /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i) / 2) * 4.0 - 1.0, f32(i32(i) % 2) * 4.0 - 1.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.0); }`,
  trails: (o) => head(o.immediates) + quad + /* wgsl */ `
@group(0) @binding(2) var tex: texture_2d<f32>;
@fragment fn fs(v: V) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(tex));
  let sum = textureLoad(tex, clamp(vec2i(v.uv * vec2f(size)), vec2i(0), size - 1), 0).rgb;
  let c = 1.0 - exp(-sum * 1.5);
  return vec4f(c, max(c.r, max(c.g, c.b)));
}`,
  // #endregion float

  // #region primitive
  // The card as a grid of triangles with no vertex buffer: the vertex shader
  // works out each corner from vertex_index. The fragment shader tints and
  // fades each triangle by its number. With primitive-index that number is
  // @builtin(primitive_index). Without, the vertex shader passes
  // vertex_index / 3 down as a flat varying.
  shards: (o) => (o.primitive ? 'enable primitive_index;\n' : '') + head(o.immediates) + /* wgsl */ `
const N = vec2f(${SHARDS_X}.0, ${SHARDS_Y}.0);
struct S { @builtin(position) pos: vec4f, @location(0) uv: vec2f${o.primitive ? '' : ', @location(1) @interpolate(flat, either) id: u32'} };
@vertex fn vs(@builtin(vertex_index) i: u32) -> S {
  let tri = i / 3u;
  let cell = tri / 2u;
  let at = vec2f(f32(cell % ${SHARDS_X}u), f32(cell / ${SHARDS_X}u));
  let uv = (at + corner(i % 6u)) / N;
  let middle = (at + select(vec2f(1.0 / 3.0), vec2f(2.0 / 3.0), tri % 2u == 1u)) / N;
  let h = hash(tri);
  let apart = p.misc.x;
  let fly = ((middle - 0.5) * 1.2 + (h - 0.5) * 0.9) * apart * 0.7;
  let local = turn((uv - middle) * p.rect.zw, (h.x - 0.5) * 7.0 * apart) * (1.0 - 0.35 * apart);
  var v: S;
  v.pos = toClip(p.rect.xy + (middle + fly) * p.rect.zw + local);
  v.uv = uv;
  ${o.primitive ? '' : 'v.id = tri;'}
  return v;
}
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@fragment fn fs(v: S${o.primitive ? ', @builtin(primitive_index) id: u32' : ''}) -> @location(0) vec4f {
  let c = textureSample(tex, samp, v.uv);
  let h = hash(${o.primitive ? 'id' : 'v.id'});
  let apart = p.misc.x;
  let tint = mix(vec3f(1.0), rainbow(h.y) * 0.7 + 0.3, apart);
  return vec4f(c.rgb * tint, c.a) * (1.0 - apart * h.x * 0.7);
}`,
  // #endregion primitive

  // #region dual
  // Text with one coverage value per colour channel. The words texture has
  // 3 × 3 texels for each canvas pixel. Red, green and blue each take a
  // five-texel filter centred on their own third of the pixel.
  // With dual-source-blending the shader has two outputs for one target: the
  // ink colour and the three coverages. The blend is
  //   colour = ink × coverage + what is there × (1 − coverage), per channel.
  // Without, the three are averaged and blended as ordinary alpha.
  text: (o) => (o.dual ? 'enable dual_source_blending;\n' : '') + head(o.immediates) + quad + /* wgsl */ `
@group(0) @binding(2) var tex: texture_2d<f32>;
fn column(x: i32, y: i32, size: vec2i) -> f32 {
  var sum = 0.0;
  for (var dy = 0; dy < 3; dy++) {
    let at = vec2i(x, y + dy);
    if (at.x >= 0 && at.y >= 0 && at.x < size.x && at.y < size.y) { sum += textureLoad(tex, at, 0).a; }
  }
  return sum / 3.0;
}
fn coverage(pixel: vec2i) -> vec3f {
  let size = vec2i(textureDimensions(tex));
  var c: array<f32, 7>;
  for (var i = 0; i < 7; i++) { c[i] = column(pixel.x * 3 - 2 + i, pixel.y * 3, size); }
  return vec3f(
    c[0] + 2.0 * c[1] + 3.0 * c[2] + 2.0 * c[3] + c[4],
    c[1] + 2.0 * c[2] + 3.0 * c[3] + 2.0 * c[4] + c[5],
    c[2] + 2.0 * c[3] + 3.0 * c[4] + 2.0 * c[5] + c[6]) / 9.0;
}
${o.dual ? 'struct O { @location(0) @blend_src(0) ink: vec4f, @location(0) @blend_src(1) coverage: vec4f };' : ''}
@fragment fn fs(v: V) -> ${o.dual ? 'O' : '@location(0) vec4f'} {
  // misc.y is the zoom: 1 for the text itself, more for the enlarged copy.
  let pixel = vec2i(floor((v.pos.xy - p.rect.xy) / p.misc.y)) + vec2i(p.misc.zw);
  let c = coverage(pixel) * p.tint.a;
  let grey = (c.r + c.g + c.b) / 3.0;
  ${o.dual ? 'var o: O; o.ink = vec4f(p.tint.rgb, 1.0); o.coverage = vec4f(c, grey); return o;' : 'return vec4f(p.tint.rgb * grey, grey);'}
}`,
  // #endregion dual
};

const OVER = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const FADE = { color: { srcFactor: 'zero', dstFactor: 'constant' }, alpha: { srcFactor: 'zero', dstFactor: 'constant' } };
const DUAL = { color: { srcFactor: 'src1', dstFactor: 'one-minus-src1' }, alpha: { srcFactor: 'src1-alpha', dstFactor: 'one-minus-src1-alpha' } };
const SLOT = 256; // bytes between draws in the uniform buffer (minUniformBufferOffsetAlignment)
const MAX_DRAWS = 64;

// #region features
/**
 * What this device can do for each tile. `use` can switch a feature off
 * ({ swizzle: false }) so a check can draw both ways and compare.
 */
export function deviceFeatures(gpu, use = {}) {
  const has = (name) => gpu.device.features.has(name);
  const language = navigator.gpu.wgslLanguageFeatures;
  const want = (key, ok, missing) => (use[key] === false ? { on: false, why: 'switched off' } : ok ? { on: true, why: '' } : { on: false, why: missing });
  return {
    level: gpu.level ?? (has('core-features-and-limits') ? 'core' : 'compatibility'),
    swizzle: want('swizzle', has('texture-component-swizzle'), 'the device has no texture-component-swizzle'),
    immediates: want('immediates', language?.has('immediate_address_space') && 'setImmediates' in GPURenderPassEncoder.prototype && gpu.device.limits.maxImmediateSize >= 48,
      'this browser has no immediates (immediate_address_space, setImmediates())'),
    float32: want('float32', has('float32-blendable'), 'the device has no float32-blendable'),
    float16: want('float16', true, ''),
    primitive: want('primitive', has('primitive-index'), 'the device has no primitive-index'),
    dual: want('dual', has('dual-source-blending'), 'the device has no dual-source-blending'),
  };
}
// #endregion features

export class GPUStage {
  route = 'webgpu';
  #pipelines = {};
  #groups = new WeakMap();
  #accum = null;
  #accumView = null;
  #fresh = true;
  #maskView = null;
  #maskOf = null;

  /** Build every pipeline. A feature whose shader or pipeline is rejected is switched off with the reason, and the other way is built. */
  static async create(canvas, gpu, elements, { present = true, use = {} } = {}) {
    const stage = new GPUStage();
    stage.canvas = canvas;
    stage.gpu = gpu;
    stage.device = gpu.device;
    stage.surface = new GPUCanvas(canvas, gpu, { present });
    stage.card = new GPUElementTexture(gpu.device, canvas, elements.card);
    stage.words = new GPUElementTexture(gpu.device, canvas, elements.words);
    stage.features = deviceFeatures(gpu, use);
    await stage.#build();
    return stage;
  }

  async #build() {
    const { device } = this;
    const f = this.features;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.gMain = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.gTrail = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    // Two layouts for group 0: a texture that is sampled, and one that is only read with textureLoad() (a float32 texture cannot be filtered).
    this.layouts = {
      sampled: device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }] }),
      loaded: device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] }),
      draw: device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: { hasDynamicOffset: true, minBindingSize: 48 } }] }),
    };

    // Immediates first, because every shader depends on the answer.
    if (f.immediates.on) {
      const problem = await this.#make('sprite', { immediates: true }, 'sampled', this.surface.format, OVER, true);
      if (problem) f.immediates = { on: false, why: problem };
    }
    const o = { immediates: f.immediates.on };
    if (!o.immediates) {
      this.drawBuffer = device.createBuffer({ size: SLOT * MAX_DRAWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.drawData = new Float32Array((SLOT * MAX_DRAWS) / 4);
      this.drawGroup = device.createBindGroup({ layout: this.layouts.draw, entries: [{ binding: 0, resource: { buffer: this.drawBuffer, size: 48 } }] });
    }
    const must = async (...args) => {
      const problem = await this.#make(...args);
      if (problem) throw new Error(problem);
    };
    await must('sprite', o, 'sampled', this.surface.format, OVER, o.immediates);
    await must('glow', { ...o, swizzle: f.swizzle.on }, 'sampled', this.surface.format, OVER, o.immediates);
    await must('trails', o, 'loaded', this.surface.format, OVER, o.immediates);

    // The trail target: the best format that this device will blend into.
    this.accumFormat = '';
    for (const [key, format] of [['float32', 'rgba32float'], ['float16', 'rgba16float'], ['', 'rgba8unorm']]) {
      if (key && !f[key].on) continue;
      const problem = (await this.#make('stamp', o, 'sampled', format, ADD, o.immediates, 'sprite')) || (await this.#make('fade', {}, null, format, FADE, false));
      if (!problem) {
        this.accumFormat = format;
        break;
      }
      if (key) f[key] = { on: false, why: problem };
    }
    if (!this.accumFormat) throw new Error('no format for the trail target');

    for (const [key, name, blend] of [['primitive', 'shards', OVER], ['dual', 'text', DUAL]]) {
      if (f[key].on) {
        const problem = await this.#make(name, { ...o, [key]: true }, name === 'text' ? 'loaded' : 'sampled', this.surface.format, blend, o.immediates);
        if (problem) f[key] = { on: false, why: problem };
      }
      if (!f[key].on) await must(name, { ...o, [key]: false }, name === 'text' ? 'loaded' : 'sampled', this.surface.format, OVER, o.immediates);
    }
  }

  // Compile one shader and make its pipeline. Returns '' or the first line of what went wrong.
  async #make(name, options, group, format, blend, immediates, source = name) {
    const { device } = this;
    device.pushErrorScope('validation');
    let thrown = '';
    try {
      const module = device.createShaderModule({ code: WGSL[source](options) });
      const info = await module.getCompilationInfo();
      const bad = info.messages.find((m) => m.type === 'error');
      if (bad) thrown = `${name} shader, line ${bad.lineNum}: ${bad.message}`;
      else {
        // #region immediates
        const groups = group ? [this.layouts[group], ...(immediates ? [] : [this.layouts.draw])] : [];
        const layout = device.createPipelineLayout(immediates ? { bindGroupLayouts: groups, immediateSize: 48 } : { bindGroupLayouts: groups });
        // #endregion immediates
        this.#pipelines[name] = await device.createRenderPipelineAsync({ layout, vertex: { module }, fragment: { module, targets: [{ format, blend }] } });
      }
    } catch (err) {
      thrown = `${name}: ${err.message.split('\n')[0]}`;
    }
    const error = await device.popErrorScope();
    return thrown || (error ? `${name}: ${error.message.split('\n')[0]}` : '');
  }

  get sizes() {
    return { card: { w: this.card.width, h: this.card.height }, words: { w: this.words.width, h: this.words.height } };
  }

  /** Upload both elements. Throws until each has been painted once. */
  upload() {
    this.card.update();
    this.words.update();
  }

  #view(name) {
    if (name === 'accum') return this.#accumView;
    if (name === 'words') return this.words.view;
    if (name === 'mask' && this.features.swizzle.on) {
      // #region swizzle
      // One texture, two views. The second gives the shader alpha where it reads red.
      if (this.#maskOf !== this.card.texture) {
        this.#maskOf = this.card.texture;
        this.#maskView = this.card.texture.createView({ swizzle: 'aaa1', usage: GPUTextureUsage.TEXTURE_BINDING });
      }
      return this.#maskView;
      // #endregion swizzle
    }
    return this.card.view;
  }

  #group(kind, buffer, view) {
    let perView = this.#groups.get(view);
    if (!perView) this.#groups.set(view, (perView = new Map()));
    const key = kind + (buffer === this.gMain ? 'm' : 't');
    let group = perView.get(key);
    if (!group) {
      const entries = [{ binding: 0, resource: { buffer } }, { binding: 2, resource: view }];
      if (kind === 'sampled') entries.push({ binding: 1, resource: this.sampler });
      perView.set(key, (group = this.device.createBindGroup({ layout: this.layouts[kind], entries })));
    }
    return group;
  }

  #run(pass, list, buffer, target, slot) {
    const immediates = this.features.immediates.on;
    for (const d of list) {
      if (d.op === 'fade') {
        pass.setPipeline(this.#pipelines.fade);
        pass.setBlendConstant([d.fade, d.fade, d.fade, d.fade]);
        pass.draw(3);
        continue;
      }
      const c = d.clip ?? { x: 0, y: 0, w: target.w, h: target.h };
      const x = Math.max(0, Math.min(target.w, Math.floor(c.x)));
      const y = Math.max(0, Math.min(target.h, Math.floor(c.y)));
      pass.setScissorRect(x, y, Math.max(0, Math.min(target.w - x, Math.ceil(c.w))), Math.max(0, Math.min(target.h - y, Math.ceil(c.h))));
      const name = d.add ? 'stamp' : d.op === 'solid' ? 'sprite' : d.op;
      pass.setPipeline(this.#pipelines[name]);
      pass.setBindGroup(0, this.#group(d.op === 'trails' || d.op === 'text' ? 'loaded' : 'sampled', buffer, this.#view(d.tex)));
      // #region immediates
      if (immediates) pass.setImmediates(0, d.p);
      else {
        // The same twelve floats, copied into the next 256-byte slot of one buffer and picked with a dynamic offset.
        this.drawData.set(d.p, (slot.n * SLOT) / 4);
        pass.setBindGroup(1, this.drawGroup, [slot.n++ * SLOT]);
      }
      // #endregion immediates
      pass.draw(d.op === 'shards' ? SHARD_VERTICES : 6);
    }
  }

  /** Draw scene(). `clearTrail` empties the accumulation target first. */
  draw(S, L, { clearTrail = false } = {}) {
    const { device } = this;
    const box = L.tiles.trails;
    if (!this.#accum || this.#accum.width !== box.w || this.#accum.height !== box.h) {
      this.#accum?.destroy();
      // #region float
      this.#accum = device.createTexture({ size: [box.w, box.h], format: this.accumFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      // #endregion float
      this.#accumView = this.#accum.createView();
      this.#fresh = true;
    }
    device.queue.writeBuffer(this.gMain, 0, new Float32Array([L.width, L.height, 0, 0]));
    device.queue.writeBuffer(this.gTrail, 0, new Float32Array([box.w, box.h, 0, 0]));
    const slot = { n: 0 };
    const encoder = device.createCommandEncoder();
    const trail = encoder.beginRenderPass({ colorAttachments: [{ view: this.#accumView, loadOp: this.#fresh || clearTrail ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    this.#run(trail, S.trail, this.gTrail, { w: box.w, h: box.h }, slot);
    trail.end();
    this.#fresh = false;
    const main = encoder.beginRenderPass({ colorAttachments: [{ view: this.surface.view(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    this.#run(main, S.main, this.gMain, { w: L.width, h: L.height }, slot);
    main.end();
    if (slot.n) device.queue.writeBuffer(this.drawBuffer, 0, this.drawData, 0, (slot.n * SLOT) / 4);
    device.queue.submit([encoder.finish()]);
  }

  /** The last frame, premultiplied. Only with { present: false }. */
  read() {
    return this.surface.read();
  }

  destroy() {
    this.#accum?.destroy();
    this.card.destroy();
    this.words.destroy();
    this.surface.destroy();
  }
}

export { watchFrame };

// ---------------------------------------------------------------------------
// WebGL 2: the same draws, for browsers and devices without WebGPU
// ---------------------------------------------------------------------------

const GL_HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
uniform vec4 uRect, uTint, uMisc;
vec2 corner(int i) { return vec2(float(i == 1 || i == 4 || i == 5), float(i == 2 || i == 3 || i == 5)); }
vec4 toClip(vec2 px) { return vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0); }
vec2 turn(vec2 v, float a) { return vec2(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a)); }
vec2 hash(uint n) {
  uint x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return vec2(float(x & 0xffffu), float(x >> 16u)) / 65535.0;
}
vec3 rainbow(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
`;
const GL_QUAD = GL_HEAD + `
out vec2 vUv;
void main() {
  vec2 uv = corner(gl_VertexID);
  gl_Position = toClip(uRect.xy + uRect.zw * 0.5 + turn((uv - 0.5) * uRect.zw, uMisc.x));
  vUv = uv;
}`;
const GLSL = {
  sprite: [GL_QUAD, GL_HEAD + `
uniform sampler2D uTex; in vec2 vUv; out vec4 o;
void main() {
  vec4 c = texture(uTex, vUv);
  o = uMisc.y > 0.5 ? vec4(uTint.rgb * uTint.a, uTint.a) : vec4(c.rgb * uTint.rgb * uTint.a, c.a * uTint.a);
}`],
  glow: [GL_QUAD, GL_HEAD + `
uniform sampler2D uTex; in vec2 vUv; out vec4 o;
void main() {
  float pad = uMisc.z;
  vec2 inner = uRect.zw - 2.0 * pad;
  vec2 uv = (vUv * uRect.zw - pad) / inner;
  float sum = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3927;
    float r = (i % 2 == 1 ? 0.95 : 0.45) * pad;
    vec2 q = uv + vec2(cos(a), sin(a)) * r / inner;
    float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    sum += textureLod(uTex, q, 0.0).a * inside;
  }
  float k = clamp(sum / 16.0 * 1.8, 0.0, 1.0) * uTint.a;
  o = vec4(uTint.rgb * k, k);
}`],
  fade: [`#version 300 es
void main() { gl_Position = vec4(float(gl_VertexID / 2) * 4.0 - 1.0, float(gl_VertexID % 2) * 4.0 - 1.0, 0.0, 1.0); }`, `#version 300 es
precision highp float; out vec4 o; void main() { o = vec4(0.0); }`],
  // The framebuffer's first row is its bottom one, so the trail texture is read upside down.
  trails: [GL_QUAD, GL_HEAD + `
uniform sampler2D uTex; in vec2 vUv; out vec4 o;
void main() {
  ivec2 size = textureSize(uTex, 0);
  ivec2 at = clamp(ivec2(vUv * vec2(size)), ivec2(0), size - 1);
  vec3 c = 1.0 - exp(-texelFetch(uTex, ivec2(at.x, size.y - 1 - at.y), 0).rgb * 1.5);
  o = vec4(c, max(c.r, max(c.g, c.b)));
}`],
  shards: [GL_HEAD + `
const vec2 N = vec2(${SHARDS_X}.0, ${SHARDS_Y}.0);
out vec2 vUv; flat out uint vId;
void main() {
  uint i = uint(gl_VertexID);
  uint tri = i / 3u;
  uint cell = tri / 2u;
  vec2 at = vec2(float(cell % ${SHARDS_X}u), float(cell / ${SHARDS_X}u));
  vec2 uv = (at + corner(int(i % 6u))) / N;
  vec2 middle = (at + (tri % 2u == 1u ? vec2(2.0 / 3.0) : vec2(1.0 / 3.0))) / N;
  vec2 h = hash(tri);
  float apart = uMisc.x;
  vec2 fly = ((middle - 0.5) * 1.2 + (h - 0.5) * 0.9) * apart * 0.7;
  vec2 local = turn((uv - middle) * uRect.zw, (h.x - 0.5) * 7.0 * apart) * (1.0 - 0.35 * apart);
  gl_Position = toClip(uRect.xy + (middle + fly) * uRect.zw + local);
  vUv = uv;
  vId = tri;
}`, GL_HEAD + `
uniform sampler2D uTex; in vec2 vUv; flat in uint vId; out vec4 o;
void main() {
  vec4 c = texture(uTex, vUv);
  vec2 h = hash(vId);
  float apart = uMisc.x;
  vec3 tint = mix(vec3(1.0), rainbow(h.y) * 0.7 + 0.3, apart);
  o = vec4(c.rgb * tint, c.a) * (1.0 - apart * h.x * 0.7);
}`],
  text: [GL_QUAD, GL_HEAD + `
uniform sampler2D uTex; uniform float uHeight; out vec4 o;
float column(int x, int y, ivec2 size) {
  float sum = 0.0;
  for (int dy = 0; dy < 3; dy++) {
    ivec2 at = ivec2(x, y + dy);
    if (at.x >= 0 && at.y >= 0 && at.x < size.x && at.y < size.y) sum += texelFetch(uTex, at, 0).a;
  }
  return sum / 3.0;
}
void main() {
  ivec2 size = textureSize(uTex, 0);
  vec2 frag = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  ivec2 pixel = ivec2(floor((frag - uRect.xy) / uMisc.y)) + ivec2(uMisc.zw);
  float c[7];
  for (int i = 0; i < 7; i++) c[i] = column(pixel.x * 3 - 2 + i, pixel.y * 3, size);
  vec3 cov = vec3(
    c[0] + 2.0 * c[1] + 3.0 * c[2] + 2.0 * c[3] + c[4],
    c[1] + 2.0 * c[2] + 3.0 * c[3] + 2.0 * c[4] + c[5],
    c[2] + 2.0 * c[3] + 3.0 * c[4] + 2.0 * c[5] + c[6]) / 9.0 * uTint.a;
  float grey = (cov.r + cov.g + cov.b) / 3.0;
  o = vec4(uTint.rgb * grey, grey);
}`],
};

export class GLStage {
  route = 'webgl';
  #programs = {};
  #fbo = null;
  #accum = null;
  #accumSize = '';
  #fresh = true;

  static async create(canvas, elements) {
    const stage = new GLStage();
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('the canvas gave no WebGL 2 context');
    stage.canvas = canvas;
    stage.gl = gl;
    stage.card = new ElementTexture(gl, canvas, elements.card);
    stage.words = new ElementTexture(gl, canvas, elements.words);
    // A float target needs EXT_color_buffer_float. Without it the trails use 8 bits.
    stage.accumFormat = gl.getExtension('EXT_color_buffer_float') ? 'rgba16float' : 'rgba8unorm';
    for (const [name, [vs, fs]] of Object.entries(GLSL)) stage.#programs[name] = program(gl, name, vs, fs);
    stage.vao = gl.createVertexArray();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    return stage;
  }

  get sizes() {
    return { card: { w: this.card.width, h: this.card.height }, words: { w: this.words.width, h: this.words.height } };
  }

  upload() {
    this.card.update();
    this.words.update();
  }

  #run(list, target) {
    const { gl } = this;
    gl.viewport(0, 0, target.w, target.h);
    for (const d of list) {
      if (d.op === 'fade') {
        gl.disable(gl.SCISSOR_TEST);
        gl.useProgram(this.#programs.fade.program);
        gl.blendColor(d.fade, d.fade, d.fade, d.fade);
        gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        continue;
      }
      const c = d.clip ?? { x: 0, y: 0, w: target.w, h: target.h };
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor(c.x), target.h - Math.floor(c.y) - Math.ceil(c.h), Math.ceil(c.w), Math.ceil(c.h));
      const p = this.#programs[d.op === 'solid' ? 'sprite' : d.op];
      gl.useProgram(p.program);
      gl.blendFunc(gl.ONE, d.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(p.uSize, target.w, target.h);
      gl.uniform4fv(p.uRect, d.p.subarray(0, 4));
      gl.uniform4fv(p.uTint, d.p.subarray(4, 8));
      gl.uniform4fv(p.uMisc, d.p.subarray(8, 12));
      if (p.uHeight) gl.uniform1f(p.uHeight, target.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.tex === 'accum' ? this.#accum : d.tex === 'words' ? this.words.texture : this.card.texture);
      gl.uniform1i(p.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, d.op === 'shards' ? SHARD_VERTICES : 6);
    }
  }

  draw(S, L, { clearTrail = false } = {}) {
    const { gl } = this;
    const box = L.tiles.trails;
    if (this.#accumSize !== `${box.w}x${box.h}`) {
      this.#accumSize = `${box.w}x${box.h}`;
      if (this.#accum) gl.deleteTexture(this.#accum);
      this.#accum = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.#accum);
      const float = this.accumFormat === 'rgba16float';
      gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, box.w, box.h, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.#fbo ??= gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#accum, 0);
      this.#fresh = true;
    }
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    if (this.#fresh || clearTrail) {
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.#fresh = false;
    }
    this.#run(S.trail, { w: box.w, h: box.h });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.#run(S.main, { w: L.width, h: L.height });
  }

  /** The frame just drawn, premultiplied, top row first. Call straight after draw(). */
  async read() {
    const { gl } = this;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return new ImageData(out, w, h);
  }

  destroy() {}
}

function program(gl, name, vs, fs) {
  const make = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`${name} shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`${name} program: ${gl.getProgramInfoLog(p)}`);
  const out = { program: p };
  for (const u of ['uSize', 'uRect', 'uTint', 'uMisc', 'uTex', 'uHeight']) out[u] = gl.getUniformLocation(p, u);
  return out;
}
