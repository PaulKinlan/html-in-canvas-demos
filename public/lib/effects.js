// The effect registry shared by the fx attribute (shader-fx.js) and
// <canvas-slot effect> (slot-effects.js). One list of names, one shader
// contract, one set of CSS custom properties.
//
//   import { defineEffect } from '/lib/effects.js';
//   defineEffect('wobble', {
//     glsl: `vec4 fx(vec2 p) { return tex(p + vec2(sin(p.y * 0.1 + u_time * 4.0) * 4.0, 0.0)); }`,
//   });
//
//   <button fx="wobble">…</button>
//   <canvas-slot effect="wobble">…</canvas-slot>
//
// An effect is a GLSL function. `p` is in CSS pixels from the element's
// top-left, and tex(p) samples the element (premultiplied, clear outside).
//
//   glsl       vec4 fx(vec2 p)                         required
//   wgsl       fn fx(p: vec2f) -> vec4f                optional, for backend="webgpu"
//   animated   redraw every frame (default: true when the source mentions u_time)
//   geometry   ({ width, height, pointer, hover, progress, amount, x, y }) => DOMMatrix
//              Where the element appears, so hit testing can follow it. The
//              shader gets the inverse as unproject(p).
//   bleed      extra canvas around the element, px (fx attribute only)
//
// Uniforms: u_size (element size, px), u_time (s), u_pointer (px, far away when
// absent), u_hover (0..1, eased), u_progress, u_amount, u_xy, u_clicks[4]
// (x, y, age in seconds).
//
// CSS drives them. These are registered custom properties, so transitions,
// animations, :hover and media queries all work:
//
//   --fx-progress  0..1    u_progress
//   --fx-amount    number  u_amount (strength, default 1)
//   --fx-x, --fx-y number  u_xy (tilt direction, -1..1)
//
// An effect can be declared in markup, with no script of your own. One
// <script> per language, with a type the browser will not run:
//
//   <script type="text/glsl" data-effect="wobble">vec4 fx(vec2 p) { … }</script>
//   <script type="text/wgsl" data-effect="wobble">fn fx(p: vec2f) -> vec4f { … }</script>
//   <button fx="wobble">…</button>
//
// The effect attribute can also point at a shader instead of naming one:
//
//   effect="#my-shader"          <script type="x-shader/x-fragment" id="my-shader">
//   effect="url(/fx/wobble.frag)" a file holding the fx() function

import { program } from './surface.js';

export const effects = new Map();
const listeners = new Set();

/** Register an effect. { glsl, wgsl?, animated?, bleed?, geometry? } */
export function defineEffect(name, def) {
  // WGSL only: WebGL draws the element unshaded instead of failing to compile nothing.
  if (!def.glsl && def.wgsl && effects.has('none')) def = { ...def, glsl: effects.get('none').glsl };
  const source = (def.glsl ?? '') + (def.wgsl ?? '');
  effects.set(name, { animated: /\bu_time\b|\bu\.time\b/.test(source), bleed: 0, ...def });
  for (const fn of listeners) fn(name);
}

/** Call fn(name) whenever an effect is defined or redefined. Returns an unsubscribe function. */
export function onEffectChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const loading = new Map();

/**
 * Turn an attribute value into a registered effect name. Names resolve to
 * themselves; "#id" reads a <script> element; "url(…)" (or anything that looks
 * like a path) is fetched, and resolves to 'none' until it arrives.
 */
export function resolveEffect(value, doc = document) {
  const raw = (value ?? '').trim();
  if (!raw) return 'none';
  if (effects.has(raw)) return raw;
  // #region declared
  // A name nobody registered: look for <script data-effect="name"> elements
  // holding the source. One per language, told apart by the type attribute.
  if (/^[\w-]+$/.test(raw)) {
    const def = {};
    for (const el of doc.querySelectorAll(`script[data-effect="${raw}"]`)) {
      def[/wgsl/i.test(el.type) ? 'wgsl' : 'glsl'] = el.textContent;
      if (el.dataset.bleed) def.bleed = Number(el.dataset.bleed) || 0;
    }
    if (def.glsl || def.wgsl) {
      // WGSL only: WebGL draws the element unshaded.
      def.glsl ??= effects.get('none').glsl;
      defineEffect(raw, def);
      return raw;
    }
  }
  // #endregion declared
  if (raw.startsWith('#')) {
    const el = doc.getElementById(raw.slice(1));
    if (!el) return 'none';
    const lang = /wgsl/i.test(el.type) ? 'wgsl' : 'glsl';
    defineEffect(raw, { [lang]: el.textContent, ...(lang === 'wgsl' ? { glsl: effects.get('none').glsl } : {}) });
    return raw;
  }
  const url = raw.match(/^url\(\s*['"]?(.*?)['"]?\s*\)$/)?.[1] ?? (/[/.]/.test(raw) ? raw : null);
  if (!url) return 'none';
  if (!loading.has(raw)) {
    loading.set(
      raw,
      fetch(new URL(url, doc.baseURI))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} for ${url}`))))
        .then((text) => defineEffect(raw, /\.wgsl$/i.test(url) ? { wgsl: text, glsl: effects.get('none').glsl } : { glsl: text }))
        .catch((err) => console.warn(`effect ${raw}: ${err.message}`)),
    );
  }
  return 'none';
}

if (typeof CSS !== 'undefined' && CSS.registerProperty) {
  for (const [name, initialValue] of [['--fx-progress', '0'], ['--fx-amount', '1'], ['--fx-x', '0'], ['--fx-y', '0']]) {
    try {
      CSS.registerProperty({ name, syntax: '<number>', inherits: true, initialValue });
    } catch {}
  }
}

/** Read the CSS-driven parameters off an element. */
export function readParams(el) {
  const cs = getComputedStyle(el);
  const num = (name, fallback) => {
    const v = cs.getPropertyValue(name);
    return v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
  };
  return { progress: num('--fx-progress', 0), amount: num('--fx-amount', 1), x: num('--fx-x', 0), y: num('--fx-y', 0) };
}

export const reducedMotion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
export const effectTime = () => (reducedMotion.matches ? 0 : (performance.now() - t0) / 1000);

const FAR_POINTER = { x: -1e4, y: -1e4 };

/** Pointer, hover and click state for one shaded element. */
export class Interaction {
  pointer = null;
  hover = 0;
  clicks = [];
  #clickBuf = new Float32Array(16);
  move(p) {
    this.pointer = p;
  }
  leave() {
    this.pointer = null;
  }
  down(p) {
    this.clicks.push({ x: p.x, y: p.y, t: performance.now() });
    if (this.clicks.length > 4) this.clicks.shift();
  }
  /** Advance one frame. Returns the uniform values and whether anything is still moving. */
  step() {
    const still = reducedMotion.matches;
    const target = this.pointer ? 1 : 0;
    this.hover += (target - this.hover) * (still ? 1 : 0.18);
    if (Math.abs(target - this.hover) < 0.004) this.hover = target;
    const now = performance.now();
    if (this.clicks.length) {
      let write = 0;
      for (let i = 0; i < this.clicks.length; i++) {
        if (now - this.clicks[i].t < 2600) this.clicks[write++] = this.clicks[i];
      }
      this.clicks.length = write;
    }
    const clicks = this.#clickBuf;
    clicks.fill(-1);
    for (let i = 0; i < this.clicks.length; i++) {
      const c = this.clicks[i], o = i * 4;
      clicks[o] = c.x;
      clicks[o + 1] = c.y;
      clicks[o + 2] = still ? -1 : (now - c.t) / 1000;
      clicks[o + 3] = 0;
    }
    return { hover: this.hover, pointer: this.pointer ?? FAR_POINTER, clicks, moving: (!still && this.clicks.length > 0) || this.hover !== target };
  }
}

/**
 * True when an element (or an ancestor animating a custom property) has a
 * running wall-clock CSS transition or animation. Scroll-driven animations
 * (ScrollTimeline / ViewTimeline) use a different timeline and only change on
 * scroll, so they do not keep an idle frame loop spinning.
 */
export function hasActiveCSSAnimation(el) {
  if (!el?.getAnimations) return false;
  const timeline = el.ownerDocument?.timeline;
  const check = (node, customOnly) => {
    const anims = node.getAnimations();
    for (let i = 0; i < anims.length; i++) {
      const a = anims[i];
      if (a.timeline !== timeline) continue;
      if (a.playState !== 'running' && a.playState !== 'pending') continue;
      if ('transitionProperty' in a) {
        if (a.transitionProperty.startsWith('--')) return true;
        continue;
      }
      if (!customOnly) return true;
      const frames = a.effect?.getKeyframes?.();
      if (frames) {
        for (let j = 0; j < frames.length; j++) {
          for (const k in frames[j]) if (k.startsWith('--')) return true;
        }
      }
    }
    return false;
  };
  if (check(el, false)) return true;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (check(p, true)) return true;
  }
  return false;
}

const docWatchers = new WeakMap();

/**
 * Share one set of document-level wake listeners (scroll, resize, ancestor
 * style/class changes, CSS transitions/animations, reduced-motion changes)
 * across all shaded hosts in the same document. Returns an unsubscribe fn.
 */
export function watchEnvironment(host, onWake) {
  const doc = host?.ownerDocument;
  if (!doc) return () => {};
  let state = docWatchers.get(doc);
  if (!state) {
    const win = doc.defaultView;
    const subs = new Map();
    const wakeAll = () => { for (const fn of subs.values()) fn(); };
    const wakeInside = (target) => {
      if (!target || target === doc || target === win || target === doc.documentElement || target === doc.body) return wakeAll();
      if (typeof target.contains !== 'function') return;
      for (const [h, fn] of subs) if (target.contains(h)) fn();
    };
    const wakeRelated = (target) => {
      if (!target || target === doc || target === win || target === doc.documentElement || target === doc.body) return wakeAll();
      if (typeof target.contains !== 'function') return;
      for (const [h, fn] of subs) if (target.contains(h) || h.contains(target)) fn();
    };
    const onScroll = (e) => wakeInside(e.target);
    const onResize = () => wakeAll();
    const onTransition = (e) => { if (!e.propertyName || e.propertyName.startsWith('--')) wakeRelated(e.target); };
    const onAnim = (e) => wakeRelated(e.target);
    const onMotion = () => wakeAll();
    const mo = new MutationObserver((records) => {
      let seen = null;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.type === 'attributes') {
          const t = r.target;
          if (t === doc.documentElement || t === doc.body) { wakeAll(); return; }
          if (records.length > 1) {
            seen ??= new Set();
            if (seen.has(t)) continue;
            seen.add(t);
          }
          wakeInside(t);
        } else {
          for (const n of r.addedNodes) {
            if (n.nodeType === 1 && (n.localName === 'style' || n.localName === 'link')) { wakeAll(); return; }
          }
          for (const n of r.removedNodes) {
            if (n.nodeType === 1 && (n.localName === 'style' || n.localName === 'link')) { wakeAll(); return; }
          }
        }
      }
    });
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    win?.addEventListener('resize', onResize, { passive: true });
    for (const ev of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) doc.addEventListener(ev, onTransition, { passive: true });
    for (const ev of ['animationstart', 'animationend', 'animationcancel']) doc.addEventListener(ev, onAnim, { passive: true });
    reducedMotion.addEventListener?.('change', onMotion);
    if (doc.documentElement) mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    state = {
      subs,
      destroy() {
        doc.removeEventListener('scroll', onScroll, true);
        win?.removeEventListener('resize', onResize);
        for (const ev of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) doc.removeEventListener(ev, onTransition);
        for (const ev of ['animationstart', 'animationend', 'animationcancel']) doc.removeEventListener(ev, onAnim);
        reducedMotion.removeEventListener?.('change', onMotion);
        mo.disconnect();
        docWatchers.delete(doc);
      },
    };
    docWatchers.set(doc, state);
  }
  state.subs.set(host, onWake);
  return () => {
    state.subs.delete(host);
    if (state.subs.size === 0) state.destroy();
  };
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * The inverse of a DOMMatrix restricted to the z = 0 plane, as a column-major
 * mat3: it takes a point on screen back to the point of the element shown there.
 */
export function inverseHomography(m) {
  if (!m || m.isIdentity) return IDENTITY3;
  // Forward: [x', y', w] = H · [x, y, 1]
  const a = m.m11, b = m.m21, c = m.m41;
  const d = m.m12, e = m.m22, f = m.m42;
  const g = m.m14, h = m.m24, i = m.m44;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return IDENTITY3;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  // inv is row-major; GL wants columns.
  return new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
}

// ---- GLSL ----------------------------------------------------------------

export const VERT = `#version 300 es
layout(location = 0) in vec2 a;
uniform vec2 u_canvas; // canvas size in CSS px
uniform vec2 u_origin; // where the element's top-left is on the canvas
out vec2 v_p;
void main() {
  v_p = (a * 0.5 + 0.5) * u_canvas;
  v_p.y = u_canvas.y - v_p.y;
  v_p -= u_origin;
  gl_Position = vec4(a, 0.0, 1.0);
}`;

export const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_texOrigin; // element px -> texture px offset
uniform vec2 u_texSize;   // texture extent in element px
uniform vec2 u_size;
uniform float u_time, u_progress, u_amount, u_hover;
uniform vec2 u_pointer, u_xy;
uniform vec4 u_clicks[4];
uniform mat3 u_inv;
vec4 tex(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) return vec4(0.0);
  return texture(u_tex, (p + u_texOrigin) / u_texSize);
}
// Screen position -> the point of the element drawn there (see "geometry").
vec2 unproject(vec2 p) { vec3 q = u_inv * vec3(p, 1.0); return q.xy / q.z; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
export const FRAG_TAIL = `
void main() { o = fx(v_p); }`;

const UNIFORMS = ['u_canvas', 'u_origin', 'u_tex', 'u_texOrigin', 'u_texSize', 'u_size', 'u_time', 'u_progress', 'u_amount', 'u_hover', 'u_pointer', 'u_xy', 'u_clicks', 'u_inv'];

export function setupQuad(gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
}

function createSharedTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * One page-wide WebGL context for surfaces that cannot have their own (a page
 * only gets about 16). Draw into it, then copy the result out.
 */
export const sharedGL = {
  canvas: null,
  gl: null,
  programs: new Map(),
  texture: null,
  texWidth: 0,
  texHeight: 0,
  textures: new Map(),
  ensure() {
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    this.programs = new Map();
    this.texture = null;
    this.texWidth = 0;
    this.texHeight = 0;
    this.textures = new Map();
    if (this.gl) setupQuad(this.gl);
    return this.gl;
  },
  /** True when a cached texture for `key` already exists on the live context at size w × h. */
  hasTexture(key, w, h) {
    if (!this.gl || this.gl.isContextLost()) return false;
    const entry = this.textures.get(key);
    return !!entry && w > 0 && h > 0 && entry.w === w && entry.h === h;
  },
  /** Bind the cached texture for `key` (or the default scratch texture) to unit 0. */
  bind(key = null) {
    const gl = this.gl;
    const tex = key == null ? this.texture : this.textures.get(key)?.tex;
    if (!gl || !tex) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    return true;
  },
  /** The scratch (or per-key) texture, bound to unit 0 and loaded from a canvas. */
  upload(source, key = null) {
    const gl = this.gl;
    const w = source.width, h = source.height;
    let tex, prevW, prevH, entry = null;
    if (key == null) {
      if (!this.texture) {
        this.texture = createSharedTexture(gl);
        this.texWidth = 0;
        this.texHeight = 0;
      }
      tex = this.texture;
      prevW = this.texWidth;
      prevH = this.texHeight;
    } else {
      entry = this.textures.get(key);
      if (!entry) {
        entry = { tex: createSharedTexture(gl), w: 0, h: 0 };
        this.textures.set(key, entry);
      }
      tex = entry.tex;
      prevW = entry.w;
      prevH = entry.h;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (w > 0 && h > 0 && w === prevW && h === prevH) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (entry) { entry.w = w; entry.h = h; }
      else { this.texWidth = w; this.texHeight = h; }
    }
  },
  /** Delete the cached texture for `key`, freeing its GPU memory. */
  release(key) {
    const entry = this.textures.get(key);
    if (!entry) return;
    this.textures.delete(key);
    if (this.gl && !this.gl.isContextLost()) this.gl.deleteTexture(entry.tex);
  },
};

/** Compile (and cache per context) the program for a named effect. Throws with the shader log. */
export function compileEffect(gl, cache, name) {
  // A lost context fails every compile with an empty log. That is not a
  // broken shader, so do not remember it as one.
  if (gl.isContextLost()) throw new Error('WebGL context lost');
  let entry = cache.get(name);
  const def = effects.get(name);
  if (entry && entry.def === def) {
    if (entry.error) throw entry.error;
    return entry;
  }
  try {
    const p = program(gl, VERT, FRAG_HEAD + def.glsl + FRAG_TAIL);
    const u = {};
    for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
    entry = { program: p, u, def };
  } catch (error) {
    if (/context lost/i.test(error.message)) throw error;
    // Remember the failure so a broken shader is not recompiled every frame.
    cache.set(name, { def, error });
    throw error;
  }
  cache.set(name, entry);
  return entry;
}

/** Set every uniform of the contract. All lengths are CSS px. */
export function setEffectUniforms(gl, u, v) {
  gl.uniform2f(u.u_canvas, v.canvas[0], v.canvas[1]);
  gl.uniform2f(u.u_origin, v.origin[0], v.origin[1]);
  gl.uniform1i(u.u_tex, 0);
  gl.uniform2f(u.u_texOrigin, v.texOrigin[0], v.texOrigin[1]);
  gl.uniform2f(u.u_texSize, v.texSize[0], v.texSize[1]);
  gl.uniform2f(u.u_size, v.size[0], v.size[1]);
  gl.uniform1f(u.u_time, v.time);
  gl.uniform1f(u.u_progress, v.progress);
  gl.uniform1f(u.u_amount, v.amount);
  gl.uniform1f(u.u_hover, v.hover);
  gl.uniform2f(u.u_pointer, v.pointer.x, v.pointer.y);
  gl.uniform2f(u.u_xy, v.x ?? 0, v.y ?? 0);
  gl.uniform4fv(u.u_clicks, v.clicks);
  gl.uniformMatrix3fv(u.u_inv, false, v.inv ?? IDENTITY3);
}

// ---- WGSL (backend="webgpu") ---------------------------------------------

export const WGSL_HEAD = `
struct U {
  canvas: vec2f, origin: vec2f, size: vec2f, texSize: vec2f, pointer: vec2f, xy: vec2f,
  time: f32, progress: f32, amount: f32, hover: f32, scale: f32,
  inv: mat3x3f,
  clicks: array<vec4f, 4>,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fx_sampler: sampler;
@group(0) @binding(2) var fx_texture: texture_2d<f32>;
fn tex(p: vec2f) -> vec4f {
  let c = textureSampleLevel(fx_texture, fx_sampler, p / u.texSize, 0.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x > u.size.x || p.y > u.size.y) { return vec4f(0.0); }
  return c;
}
fn unproject(p: vec2f) -> vec2f { let q = u.inv * vec3f(p, 1.0); return q.xy / q.z; }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), f.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn fbm(p0: vec2f) -> f32 { var v = 0.0; var a = 0.5; var p = p0; for (var i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
export const WGSL_TAIL = `
@vertex fn fx_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fx_fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return fx(pos.xy / u.scale - u.origin);
}`;
/** Byte size of the U struct above. */
export const WGSL_UNIFORM_SIZE = 192;
const wgslUniformScratch = new Float32Array(WGSL_UNIFORM_SIZE / 4);

/**
 * Pack the uniform values (same object as setEffectUniforms) into the U struct.
 * Reuses a module-level scratch buffer by default (callers copy synchronously
 * via queue.writeBuffer); pass `out` to write into a caller-owned Float32Array.
 */
export function packWGSLUniforms(v, scale, out = wgslUniformScratch) {
  out[0] = v.canvas[0];
  out[1] = v.canvas[1];
  out[2] = v.origin[0];
  out[3] = v.origin[1];
  out[4] = v.size[0];
  out[5] = v.size[1];
  out[6] = v.texSize[0];
  out[7] = v.texSize[1];
  out[8] = v.pointer.x;
  out[9] = v.pointer.y;
  out[10] = v.x ?? 0;
  out[11] = v.y ?? 0;
  out[12] = v.time;
  out[13] = v.progress;
  out[14] = v.amount;
  out[15] = v.hover;
  out[16] = scale;
  const m = v.inv ?? IDENTITY3;
  // offset 80 (float index 20): mat3x3f is three 16-byte-aligned vec3f columns
  out[20] = m[0]; out[21] = m[1]; out[22] = m[2]; out[23] = 0;
  out[24] = m[3]; out[25] = m[4]; out[26] = m[5]; out[27] = 0;
  out[28] = m[6]; out[29] = m[7]; out[30] = m[8]; out[31] = 0;
  out.set(v.clicks, 32); // offset 128
  return out;
}

/** True when a registered effect also has WGSL source, so WebGPU can draw it. */
export function hasWGSL(name) {
  return !!effects.get(name)?.wgsl;
}

const gpuPipelines = new WeakMap(); // GPUDevice -> Map("name|format" -> { def, pipeline, error })

/**
 * The render pipeline for a named effect on a device (cached per device).
 * Throws when the effect has no WGSL, or when an earlier compile of it failed.
 * Bind group 0: the U uniform buffer, a sampler, the element's texture.
 */
export function gpuEffect(device, format, name) {
  const def = effects.get(name);
  if (!def?.wgsl) throw new Error(`effect "${name}" has no WGSL source`);
  let cache = gpuPipelines.get(device);
  if (!cache) gpuPipelines.set(device, (cache = new Map()));
  const key = `${name}|${format}`;
  let entry = cache.get(key);
  if (entry && entry.def === def) {
    if (entry.error) throw entry.error;
    return entry.pipeline;
  }
  const module = device.createShaderModule({ code: WGSL_HEAD + def.wgsl + WGSL_TAIL });
  const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' };
  entry = {
    def,
    error: null,
    pipeline: device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'fx_vs' },
      fragment: { module, entryPoint: 'fx_fs', targets: [{ format, blend: { color: over, alpha: over } }] },
    }),
  };
  // Compile errors arrive later. Remember them, so the next frame shows the element unshaded instead of nothing.
  entry.checked = (module.getCompilationInfo?.() ?? Promise.resolve({ messages: [] })).then(
    (info) => {
      const text = wgslErrors(info);
      if (text) entry.error = new Error(`WGSL compile failed: ${text}`);
      return entry.error;
    },
    () => null,
  );
  cache.set(key, entry);
  return entry.pipeline;
}

const WGSL_HEAD_LINES = WGSL_HEAD.split('\n').length - 1;
// Compile errors, with line numbers counted in the effect's own source (the shared header comes first in the module).
function wgslErrors(info) {
  return info.messages.filter((m) => m.type === 'error').map((m) => `line ${Math.max(1, m.lineNum - WGSL_HEAD_LINES)}: ${m.message}`).join('\n');
}

/**
 * Resolves to the compile error of an effect's WGSL on this device, or null.
 * A surface asks this when WebGPU rejects a frame: a typing mistake in a
 * custom effect is the effect's fault, not a reason to give up on WebGPU.
 */
export function gpuEffectProblem(device, format, name) {
  return gpuPipelines.get(device)?.get(`${name}|${format}`)?.checked ?? Promise.resolve(null);
}

/** Compile an effect's WGSL (fn fx(p: vec2f) -> vec4f) without using it. Resolves to '' or the error text. */
export async function checkEffectWGSL(device, wgsl) {
  try {
    return wgslErrors(await device.createShaderModule({ code: WGSL_HEAD + wgsl + WGSL_TAIL }).getCompilationInfo());
  } catch (err) {
    return err.message;
  }
}

/** The sampler effects use, one per device. */
export function gpuSampler(device) {
  let cache = gpuPipelines.get(device);
  if (!cache) gpuPipelines.set(device, (cache = new Map()));
  if (!cache.sampler) cache.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  return cache.sampler;
}

// ---- built-in effects ------------------------------------------------------

defineEffect('none', {
  glsl: `vec4 fx(vec2 p) { return tex(p); }`,
  wgsl: `fn fx(p: vec2f) -> vec4f { return tex(p); }`,
});

/** perspective(d) rotateX rotateY about the element's centre, as a DOMMatrix. */
export function tiltMatrix(width, height, rx, ry, distance = 900, scale = 1) {
  const persp = new DOMMatrix();
  persp.m34 = -1 / distance;
  return new DOMMatrix()
    .translate(width / 2, height / 2)
    .multiply(persp)
    .rotate(rx, ry, 0)
    .scale(scale)
    .translate(-width / 2, -height / 2);
}

defineEffect('tilt', {
  bleed: 28,
  // The element leans toward the pointer in perspective, with a moving sheen.
  // --fx-x / --fx-y (-1..1) lean it from CSS; --fx-amount scales the angle.
  geometry({ width, height, pointer, hover, amount, x, y }) {
    const max = 16 * amount;
    const px = pointer ? (pointer.x / width - 0.5) * 2 : 0;
    const py = pointer ? (pointer.y / height - 0.5) * 2 : 0;
    const ry = Math.max(-1.5, Math.min(1.5, px * hover + x)) * max;
    const rx = -Math.max(-1.5, Math.min(1.5, py * hover + y)) * max;
    if (!rx && !ry) return null;
    return tiltMatrix(width, height, rx, ry);
  },
  glsl: `vec4 fx(vec2 p) {
    vec2 s = unproject(p);
    // Smooth the silhouette: the edge of a tilted quad is not on pixel rows.
    float e = min(min(s.x, s.y), min(u_size.x - s.x, u_size.y - s.y));
    float cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    vec4 col = tex(clamp(s, vec2(0.5), u_size - 0.5)) * cover;
    vec2 q = (s - u_pointer) / max(u_size.x, u_size.y);
    col.rgb += col.a * exp(-dot(q, q) * 9.0) * 0.14 * u_hover;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let s = unproject(p);
    let e = min(min(s.x, s.y), min(u.size.x - s.x, u.size.y - s.y));
    let cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    var col = tex(clamp(s, vec2f(0.5), u.size - 0.5)) * cover;
    let q = (s - u.pointer) / max(u.size.x, u.size.y);
    col = vec4f(col.rgb + col.a * exp(-dot(q, q) * 9.0) * 0.14 * u.hover, col.a);
    return col;
  }`,
});

// #region ripple
defineEffect('ripple', {
  // Rings spread from each click or tap and bend the element like water.
  glsl: `vec4 fx(vec2 p) {
    vec2 d = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 c = u_clicks[i];
      if (c.z < 0.0 || c.z > 2.4) continue;
      vec2 v = p - c.xy;
      float r = length(v), front = c.z * 380.0;
      float w = exp(-pow((r - front) / 34.0, 2.0)) * exp(-c.z * 1.7);
      d += normalize(v + 1e-4) * sin((r - front) * 0.2) * w * 13.0 * u_amount;
    }
    // A soft swell under the pointer.
    vec2 q = p - u_pointer;
    d += q * exp(-dot(q, q) / 2600.0) * 0.16 * u_hover * u_amount;
    vec4 col = tex(p - d);
    col.rgb += col.a * length(d) * 0.012;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    var d = vec2f(0.0);
    for (var i = 0; i < 4; i++) {
      let c = u.clicks[i];
      if (c.z < 0.0 || c.z > 2.4) { continue; }
      let v = p - c.xy;
      let r = length(v); let front = c.z * 380.0;
      let w = exp(-pow((r - front) / 34.0, 2.0)) * exp(-c.z * 1.7);
      d += normalize(v + 1e-4) * sin((r - front) * 0.2) * w * 13.0 * u.amount;
    }
    let q = p - u.pointer;
    d += q * exp(-dot(q, q) / 2600.0) * 0.16 * u.hover * u.amount;
    let col = tex(p - d);
    return vec4f(col.rgb + col.a * length(d) * 0.012, col.a);
  }`,
});
// #endregion ripple

defineEffect('glass', {
  // Liquid glass: the rim refracts what is inside it, with a little colour
  // fringing and a highlight, and a bead of magnification follows the pointer.
  glsl: `float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  vec4 fx(vec2 p) {
    vec2 c = u_size * 0.5;
    float rad = min(22.0, min(c.x, c.y));
    float d = -sdBox(p - c, c, rad);
    vec2 e = vec2(1.0, 0.0);
    vec2 n = normalize(vec2(sdBox(p - c + e.xy, c, rad) - sdBox(p - c - e.xy, c, rad), sdBox(p - c + e.yx, c, rad) - sdBox(p - c - e.yx, c, rad)) + 1e-5);
    float rim = 1.0 - smoothstep(0.0, min(26.0, min(c.x, c.y) * 0.8), d);
    float bend = rim * rim * 16.0 * u_amount;
    vec2 q = p - u_pointer;
    vec2 bead = -q * exp(-dot(q, q) / 3200.0) * 0.38 * u_hover * u_amount;
    vec2 s = p - n * bend + bead;
    vec4 col = tex(s);
    col.r = tex(s + n * bend * 0.18).r;
    col.b = tex(s - n * bend * 0.18).b;
    float light = dot(n, normalize(vec2(-0.5, -0.85)));
    col.rgb += col.a * pow(rim, 2.5) * (0.28 * max(light, 0.0) + 0.1 * max(-light, 0.0));
    col.rgb += col.a * exp(-dot(q, q) / 1500.0) * 0.07 * u_hover;
    return col;
  }`,
  wgsl: `fn sdBox(p: vec2f, b: vec2f, r: f32) -> f32 { let q = abs(p) - b + r; return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r; }
  fn fx(p: vec2f) -> vec4f {
    let c = u.size * 0.5;
    let rad = min(22.0, min(c.x, c.y));
    let d = -sdBox(p - c, c, rad);
    let e = vec2f(1.0, 0.0);
    let n = normalize(vec2f(sdBox(p - c + e.xy, c, rad) - sdBox(p - c - e.xy, c, rad), sdBox(p - c + e.yx, c, rad) - sdBox(p - c - e.yx, c, rad)) + 1e-5);
    let rim = 1.0 - smoothstep(0.0, min(26.0, min(c.x, c.y) * 0.8), d);
    let bend = rim * rim * 16.0 * u.amount;
    let q = p - u.pointer;
    let bead = -q * exp(-dot(q, q) / 3200.0) * 0.38 * u.hover * u.amount;
    let s = p - n * bend + bead;
    var col = tex(s);
    col.r = tex(s + n * bend * 0.18).r;
    col.b = tex(s - n * bend * 0.18).b;
    let light = dot(n, normalize(vec2f(-0.5, -0.85)));
    var rgb = col.rgb + col.a * pow(rim, 2.5) * (0.28 * max(light, 0.0) + 0.1 * max(-light, 0.0));
    rgb += col.a * exp(-dot(q, q) / 1500.0) * 0.07 * u.hover;
    return vec4f(rgb, col.a);
  }`,
});

defineEffect('haze', {
  animated: true,
  // Heat haze: rising noise bends the element, more at the top.
  glsl: `vec4 fx(vec2 p) {
    float t = u_time;
    vec2 q = p * 0.028 + vec2(0.0, t * 1.3);
    vec2 d = vec2(fbm(q) - 0.5, fbm(q + 31.7) - 0.5);
    float rise = mix(1.0, 0.45, clamp(p.y / u_size.y, 0.0, 1.0));
    vec4 col = tex(p + d * 9.0 * rise * u_amount);
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let q = p * 0.028 + vec2f(0.0, u.time * 1.3);
    let d = vec2f(fbm(q) - 0.5, fbm(q + 31.7) - 0.5);
    let rise = mix(1.0, 0.45, clamp(p.y / u.size.y, 0.0, 1.0));
    return tex(p + d * 9.0 * rise * u.amount);
  }`,
});

defineEffect('crt', {
  animated: true,
  // A tube: barrel curve, scanlines, an RGB mask, fringing, vignette, flicker.
  glsl: `vec4 fx(vec2 p) {
    vec2 uv = p / u_size * 2.0 - 1.0;
    float k = 0.06 * u_amount;
    vec2 w = uv * (1.0 + k * dot(uv.yx, uv.yx));
    vec2 s = (w * 0.5 + 0.5) * u_size;
    float split = 1.2 * u_amount;
    vec4 col = tex(s);
    col.r = tex(s + vec2(split, 0.0)).r;
    col.b = tex(s - vec2(split, 0.0)).b;
    float scan = 0.86 + 0.14 * sin(s.y * 3.14159 / 1.5);
    float mask = 0.94 + 0.06 * sin(s.x * 3.14159 / 1.0);
    float vig = smoothstep(1.7, 0.75, length(w));
    float flicker = 0.985 + 0.015 * sin(u_time * 50.0) + 0.02 * step(0.995, hash(vec2(floor(u_time * 30.0), 1.0)));
    float roll = 0.04 * smoothstep(0.0, 0.06, abs(fract(s.y / u_size.y - u_time * 0.12) - 0.5) - 0.44);
    col.rgb = col.rgb * 1.3 * scan * mask * vig * flicker + col.a * roll;
    col.rgb += col.a * vec3(0.0, 0.012, 0.004);
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let uv = p / u.size * 2.0 - 1.0;
    let k = 0.06 * u.amount;
    let w = uv * (1.0 + k * dot(uv.yx, uv.yx));
    let s = (w * 0.5 + 0.5) * u.size;
    let split = 1.2 * u.amount;
    var col = tex(s);
    col.r = tex(s + vec2f(split, 0.0)).r;
    col.b = tex(s - vec2f(split, 0.0)).b;
    let scan = 0.86 + 0.14 * sin(s.y * 3.14159 / 1.5);
    let mask = 0.94 + 0.06 * sin(s.x * 3.14159 / 1.0);
    let vig = 1.0 - smoothstep(0.75, 1.7, length(w));
    let flicker = 0.985 + 0.015 * sin(u.time * 50.0) + 0.02 * step(0.995, hash(vec2f(floor(u.time * 30.0), 1.0)));
    let roll = 0.04 * smoothstep(0.0, 0.06, abs(fract(s.y / u.size.y - u.time * 0.12) - 0.5) - 0.44);
    var rgb = col.rgb * 1.3 * scan * mask * vig * flicker + col.a * roll;
    rgb += col.a * vec3f(0.0, 0.012, 0.004);
    return vec4f(rgb, col.a);
  }`,
});

defineEffect('dissolve', {
  // Burns the element away as --fx-progress goes 0 → 1, with a glowing edge.
  glsl: `vec4 fx(vec2 p) {
    float n = fbm(p * 0.022) * 0.75 + 0.25 * (p.x / u_size.x);
    float cut = u_progress * 1.25 - 0.12;
    float d = n - cut;
    if (d < 0.0) return vec4(0.0);
    vec4 col = tex(p);
    float edge = 1.0 - smoothstep(0.0, 0.06, d);
    vec3 ember = mix(vec3(1.0, 0.85, 0.3), vec3(0.9, 0.2, 0.05), smoothstep(0.0, 0.05, d));
    col.rgb = mix(col.rgb, ember * col.a, edge * step(0.001, u_progress));
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let n = fbm(p * 0.022) * 0.75 + 0.25 * (p.x / u.size.x);
    let cut = u.progress * 1.25 - 0.12;
    let d = n - cut;
    let col = tex(p);
    if (d < 0.0) { return vec4f(0.0); }
    let edge = 1.0 - smoothstep(0.0, 0.06, d);
    let ember = mix(vec3f(1.0, 0.85, 0.3), vec3f(0.9, 0.2, 0.05), smoothstep(0.0, 0.05, d));
    return vec4f(mix(col.rgb, ember * col.a, edge * step(0.001, u.progress)), col.a);
  }`,
});

const CURL = {
  // Page curl from the bottom-right corner as --fx-progress goes 0 → 1.
  // The paper rolls round a cylinder and lies back over the page.
  glsl: `vec4 fx(vec2 p) {
    const float PI = 3.14159265;
    vec2 dir = normalize(vec2(-1.0, -0.62));
    float R = clamp(min(u_size.x, u_size.y) * 0.14, 12.0, 46.0);
    float L = dot(-u_size, dir);
    float D = u_progress * (L + PI * R + 4.0);
    float u = dot(p - u_size, dir);
    float d = u - D; // > 0: still flat. -R..0: under the roll. < -R: gone.
    if (u_progress <= 0.0) return tex(p);
    vec4 col = vec4(0.0);
    if (d >= 0.0) {
      col = tex(p);
      col.rgb *= 1.0 - 0.28 * exp(-d / (R * 0.9)); // shadow cast by the roll
      vec2 src = p + dir * ((D - PI * R - d) - u);  // paper lying back on top
      vec4 back = tex(src);
      if (back.a > 0.0) col = vec4(mix(back.rgb, vec3(back.a), 0.78) * 0.95, back.a);
    } else if (d > -R) {
      float s = -d / R;
      float a2 = R * (PI - asin(s));
      vec4 back = tex(p + dir * ((D - a2) - u));
      if (back.a > 0.0) {
        float shade = 0.72 + 0.28 * sqrt(1.0 - s * s);
        col = vec4(mix(back.rgb, vec3(back.a), 0.78) * shade, back.a);
      } else {
        vec4 front = tex(p + dir * ((D - R * asin(s)) - u));
        col = vec4(front.rgb * (1.0 - 0.45 * s), front.a);
      }
    }
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let PI = 3.14159265;
    let dir = normalize(vec2f(-1.0, -0.62));
    let R = clamp(min(u.size.x, u.size.y) * 0.14, 12.0, 46.0);
    let L = dot(-u.size, dir);
    let D = u.progress * (L + PI * R + 4.0);
    let along = dot(p - u.size, dir);
    let d = along - D;
    if (u.progress <= 0.0) { return tex(p); }
    var col = vec4f(0.0);
    if (d >= 0.0) {
      col = tex(p);
      col = vec4f(col.rgb * (1.0 - 0.28 * exp(-d / (R * 0.9))), col.a);
      let back = tex(p + dir * ((D - PI * R - d) - along));
      if (back.a > 0.0) { col = vec4f(mix(back.rgb, vec3f(back.a), 0.78) * 0.95, back.a); }
    } else if (d > -R) {
      let s = -d / R;
      let a2 = R * (PI - asin(s));
      let back = tex(p + dir * ((D - a2) - along));
      if (back.a > 0.0) {
        let shade = 0.72 + 0.28 * sqrt(1.0 - s * s);
        col = vec4f(mix(back.rgb, vec3f(back.a), 0.78) * shade, back.a);
      } else {
        let front = tex(p + dir * ((D - R * asin(s)) - along));
        col = vec4f(front.rgb * (1.0 - 0.45 * s), front.a);
      }
    }
    return col;
  }`,
};
defineEffect('curl', CURL);
defineEffect('page-curl', CURL);
