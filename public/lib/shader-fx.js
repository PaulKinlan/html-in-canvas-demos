// Shader CSS: run any element through a fragment shader with one attribute.
//
//   <script type="module" src="/lib/shader-fx.js"></script>
//
//   <button fx="ripple">Still a button</button>
//   <article fx="dissolve" style="--fx-progress: 0.4">…</article>
//
// Built-in effects: ripple, glass, haze, crt, dissolve, curl.
//
// CSS drives the shader. Two registered custom properties become uniforms, so
// transitions, animations, :hover and media queries all work:
//
//   --fx-progress   0..1   u_progress  (dissolve, curl)
//   --fx-amount     number u_amount    (strength, default 1)
//
//   .card { transition: --fx-progress 600ms; }
//   .card:hover { --fx-progress: 1; }
//
// Your own effect is a GLSL function. `p` is in CSS pixels from the element's
// top-left, and tex(p) samples the element (premultiplied, clear outside):
//
//   import { defineEffect } from '/lib/shader-fx.js';
//   defineEffect('wobble', {
//     animated: true,
//     glsl: `vec4 fx(vec2 p) { return tex(p + vec2(sin(p.y * 0.1 + u_time * 4.0) * 4.0, 0.0)); }`,
//   });
//
// Uniforms: u_size (element size, px), u_time (s), u_pointer (px, far away when
// absent), u_hover (0..1, eased), u_progress, u_amount, u_clicks[4] (x, y, age).
//
// How: the element is wrapped in <fx-surface>, which slots it into a canvas
// (see surface.js). Two backends:
//   direct  the canvas is WebGL; texElementSubImage2D uploads the DOM straight
//           into a texture. Fastest, but a page only gets about 16 contexts.
//   shared  the canvas is 2D; the DOM is drawn with drawElementImage, copied
//           into ONE page-wide WebGL context, shaded, and drawn back. No limit.
// The first few surfaces go direct, the rest share. Force one with
// fx-backend="direct|shared" on the element.
//
// The element stays where layout put it for hit testing: effects are visual.

import { SurfaceElement, ElementTexture, program, supported, supportedGL } from './surface.js';

const MAX_DIRECT = 8;
let liveDirect = 0;

const effects = new Map();
const instances = new Set();

/** Register an effect. { glsl, animated?, bleed? } */
export function defineEffect(name, def) {
  effects.set(name, { animated: false, bleed: 0, ...def });
  for (const s of instances) if (s.effectName === name) s.effectChanged();
}

const VERT = `#version 300 es
layout(location = 0) in vec2 a;
uniform vec2 u_canvas; // canvas size in CSS px
uniform float u_bleed;
out vec2 v_p;
void main() {
  v_p = (a * 0.5 + 0.5) * u_canvas;
  v_p.y = u_canvas.y - v_p.y;
  v_p -= u_bleed;
  gl_Position = vec4(a, 0.0, 1.0);
}`;

const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_texOrigin; // element px -> texture px offset
uniform vec2 u_texSize;   // texture extent in element px
uniform vec2 u_size;
uniform float u_time, u_progress, u_amount, u_hover;
uniform vec2 u_pointer;
uniform vec4 u_clicks[4];
vec4 tex(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) return vec4(0.0);
  return texture(u_tex, (p + u_texOrigin) / u_texSize);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
const FRAG_TAIL = `
void main() { o = fx(v_p); }`;

defineEffect('none', { glsl: `vec4 fx(vec2 p) { return tex(p); }` });

defineEffect('ripple', {
  bleed: 0,
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
});

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
});

defineEffect('curl', {
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
});

// ---- the one shared WebGL context --------------------------------------

const shared = {
  canvas: null,
  gl: null,
  programs: new Map(),
  texture: null,
  ensure() {
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    this.programs = new Map();
    this.texture = null;
    if (this.gl) setupQuad(this.gl);
    return this.gl;
  },
};

function setupQuad(gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
}

function compileEffect(gl, cache, name) {
  let entry = cache.get(name);
  const def = effects.get(name);
  if (entry && entry.def === def) return entry;
  const p = program(gl, VERT, FRAG_HEAD + def.glsl + FRAG_TAIL);
  const u = {};
  for (const n of ['u_canvas', 'u_bleed', 'u_tex', 'u_texOrigin', 'u_texSize', 'u_size', 'u_time', 'u_progress', 'u_amount', 'u_hover', 'u_pointer', 'u_clicks']) u[n] = gl.getUniformLocation(p, n);
  entry = { program: p, u, def };
  cache.set(name, entry);
  return entry;
}

if (typeof CSS !== 'undefined' && CSS.registerProperty) {
  for (const [name, initialValue] of [['--fx-progress', '0'], ['--fx-amount', '1']]) {
    try {
      CSS.registerProperty({ name, syntax: '<number>', inherits: true, initialValue });
    } catch {}
  }
}

const reducedMotion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const t0 = performance.now();

export class FxSurface extends SurfaceElement {
  static instances = instances;
  static defaultBleed = 0;
  static get supported() {
    return supported;
  }
  static get directContexts() {
    return liveDirect;
  }

  backend = null; // 'direct' | 'shared'
  #programs = new Map();
  #texture = null;
  #pointer = null;
  #hover = 0;
  #clicks = [];
  #visible = true;
  #io = null;
  #mo = null;
  #signature = '';
  #error = null;
  frames = 0;

  /** The element carrying the fx attribute (the surface itself if you wrote <fx-surface fx>). */
  get target() {
    return this.querySelector(':scope > [fx]') ?? this;
  }
  get effectName() {
    const name = (this.target.getAttribute('fx') || 'none').trim();
    return effects.has(name) ? name : 'none';
  }
  get error() {
    return this.#error;
  }

  createContext(canvas) {
    const want = this.target.getAttribute('fx-backend') ?? this.getAttribute('fx-backend');
    const direct = want ? want === 'direct' : supportedGL && liveDirect < MAX_DIRECT;
    if (direct && supportedGL) {
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
      if (gl) {
        this.backend = 'direct';
        liveDirect++;
        setupQuad(gl);
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          this.#programs = new Map();
          this.#texture = null;
          this.#lost = setTimeout(() => this.fallBackToPlain('WebGL context lost'), 1500);
        });
        canvas.addEventListener('webglcontextrestored', () => {
          clearTimeout(this.#lost);
          setupQuad(gl);
          this.contentDirty = true;
          this.invalidate();
        });
        return gl;
      }
    }
    this.backend = 'shared';
    return canvas.getContext('2d');
  }
  #lost = 0;
  #forced = false;

  connected() {
    FxSurface.instances.add(this);
    this.addEventListener('pointermove', this.#onMove);
    this.addEventListener('pointerleave', this.#onLeave);
    this.addEventListener('pointerdown', this.#onDown);
    this.#io = new IntersectionObserver(([entry]) => {
      this.#visible = entry.isIntersecting;
      if (this.#visible) this.invalidate();
    }, { rootMargin: '100px' });
    this.#io.observe(this);
    // If the author takes the fx attribute off, hand the element back.
    this.#mo = new MutationObserver(() => {
      if (this.adopted && !this.querySelector(':scope > [fx]')) FxSurface.release(this);
      else this.effectChanged();
    });
    this.#mo.observe(this, { attributes: true, subtree: true, attributeFilter: ['fx', 'style', 'class'] });
  }

  disconnected() {
    FxSurface.instances.delete(this);
    this.#io?.disconnect();
    this.#mo?.disconnect();
    if (this.backend === 'direct' && this.ctx) {
      liveDirect = Math.max(0, liveDirect - 1);
      this.ctx.getExtension('WEBGL_lose_context')?.loseContext();
      this.ctx = null;
      this.backend = null;
    }
  }

  effectChanged() {
    this.#signature = '';
    this.#error = null;
    this.invalidate();
  }

  #onMove = (e) => {
    this.#pointer = this.localPoint(e);
    this.invalidate();
  };
  #onLeave = () => {
    this.#pointer = null;
    this.invalidate();
  };
  #onDown = (e) => {
    const p = this.localPoint(e);
    this.#clicks.push({ x: p.x, y: p.y, t: performance.now() });
    if (this.#clicks.length > 4) this.#clicks.shift();
    this.#pointer = p;
    this.invalidate();
  };

  /** Render now and return the canvas pixels (the WebGL buffer is not kept between frames). */
  snapshot() {
    this.#signature = '';
    this.contentDirty = true;
    this.#forced = true;
    try {
      this.render(performance.now());
    } finally {
      this.#forced = false;
    }
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.canvas, 0, 0);
    return ctx;
  }

  /** Start a ripple from script (element px). */
  poke(x, y) {
    this.#clicks.push({ x, y, t: performance.now() });
    if (this.#clicks.length > 4) this.#clicks.shift();
    this.invalidate();
  }

  render(now) {
    if (!this.#visible && !this.#forced) return false;
    const name = this.effectName;
    const def = effects.get(name);
    const cs = getComputedStyle(this.target);
    const progress = Number(cs.getPropertyValue('--fx-progress')) || 0;
    const amountRaw = cs.getPropertyValue('--fx-amount');
    const amount = amountRaw === '' ? 1 : Number(amountRaw);
    const still = reducedMotion.matches;

    // Ease hover; age clicks.
    const hoverTarget = this.#pointer ? 1 : 0;
    this.#hover += (hoverTarget - this.#hover) * (still ? 1 : 0.18);
    if (Math.abs(hoverTarget - this.#hover) < 0.004) this.#hover = hoverTarget;
    const t = performance.now();
    this.#clicks = this.#clicks.filter((c) => t - c.t < 2600);
    const clicks = new Float32Array(16).fill(-1);
    this.#clicks.forEach((c, i) => clicks.set([c.x, c.y, still ? -1 : (t - c.t) / 1000, 0], i * 4));

    const moving = (def.animated && !still) || this.#clicks.length > 0 || this.#hover !== hoverTarget;
    const time = still ? 0 : (t - t0) / 1000;
    const p = this.#pointer ?? { x: -1e4, y: -1e4 };
    const signature = `${name}|${progress}|${amount}|${p.x},${p.y}|${this.#hover}|${this.canvas.width}x${this.canvas.height}|${moving ? time : ''}`;
    // CSS can change --fx-progress at any time (a transition, :hover), and
    // there is no event for that, so keep sampling while on screen and only
    // draw when a uniform actually changed.
    if (signature === this.#signature && !this.contentDirty) return true;
    this.#signature = signature;

    const uniforms = { progress, amount, time, pointer: p, clicks };
    try {
      if (this.backend === 'direct') this.#renderDirect(name, uniforms);
      else this.#renderShared(name, uniforms);
      this.#error = null;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) throw err;
      // A broken custom shader should not hide the element: show it unshaded.
      if (!this.#error) console.warn(`fx="${name}": ${err.message}`);
      this.#error = err;
      if (name !== 'none') {
        try {
          if (this.backend === 'direct') this.#renderDirect('none', uniforms);
          else this.#renderShared('none', uniforms);
        } catch {}
      }
    }
    this.setGeometry();
    this.contentDirty = false;
    this.frames++;
    return true;
  }

  #setUniforms(gl, u, uniforms, texOrigin, texSize) {
    const cw = this.canvas.width / this.scale;
    const ch = this.canvas.height / this.scale;
    gl.uniform2f(u.u_canvas, cw, ch);
    gl.uniform1f(u.u_bleed, this.bleed);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform2f(u.u_texOrigin, texOrigin[0], texOrigin[1]);
    gl.uniform2f(u.u_texSize, texSize[0], texSize[1]);
    gl.uniform2f(u.u_size, this.width, this.height);
    gl.uniform1f(u.u_time, uniforms.time);
    gl.uniform1f(u.u_progress, uniforms.progress);
    gl.uniform1f(u.u_amount, uniforms.amount);
    gl.uniform1f(u.u_hover, this.#hover);
    gl.uniform2f(u.u_pointer, uniforms.pointer.x, uniforms.pointer.y);
    gl.uniform4fv(u.u_clicks, uniforms.clicks);
  }

  // DOM → texture on this canvas's own WebGL context.
  #renderDirect(name, uniforms) {
    const gl = this.ctx;
    if (gl.isContextLost()) return;
    const { program: prog, u } = compileEffect(gl, this.#programs, name);
    this.#texture ??= new ElementTexture(gl, this.canvas, this.content);
    gl.activeTexture(gl.TEXTURE0);
    if (this.contentDirty || !this.#texture.width) this.#texture.update();
    else gl.bindTexture(gl.TEXTURE_2D, this.#texture.texture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog);
    this.#setUniforms(gl, u, uniforms, [0, 0], [this.#texture.width / this.scale, this.#texture.height / this.scale]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // DOM → this 2D canvas → the shared WebGL context → back to this canvas.
  #renderShared(name, uniforms) {
    const ctx = this.ctx;
    const { width: cw, height: ch } = this.canvas;
    const s = this.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, cw / s, ch / s);
    ctx.drawElementImage(this.content, this.bleed, this.bleed, this.width, this.height);
    const gl = shared.ensure();
    if (!gl) return; // no WebGL at all: the plain drawing stays
    if (shared.canvas.width < cw) shared.canvas.width = cw;
    if (shared.canvas.height < ch) shared.canvas.height = ch;
    const { program: prog, u } = compileEffect(gl, shared.programs, name);
    if (!shared.texture) {
      shared.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, shared.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shared.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(prog);
    this.#setUniforms(gl, u, uniforms, [this.bleed, this.bleed], [cw / s, ch / s]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(shared.canvas, 0, shared.canvas.height - ch, cw, ch, 0, 0, cw, ch);
  }
}

if (!customElements.get('fx-surface')) customElements.define('fx-surface', FxSurface);

// ---- the attribute: wrap anything that says fx="…" ----------------------

function adopt(el) {
  if (!(el instanceof HTMLElement) || el instanceof FxSurface) return;
  if (el.parentElement instanceof FxSurface) return;
  if (!supported) return; // plain HTML: leave the page alone
  const name = (el.getAttribute('fx') || '').trim();
  const bleed = el.getAttribute('fx-bleed') ?? effects.get(name)?.bleed ?? 0;
  const host = FxSurface.adopt(el, { bleed });
  host.adopted = true;
}

function scan(root) {
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1 && root.hasAttribute('fx')) adopt(root);
  for (const el of root.querySelectorAll('[fx]')) adopt(el);
}

if (typeof document !== 'undefined') {
  const start = () => {
    scan(document);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          if (r.target.hasAttribute('fx')) adopt(r.target);
        } else for (const n of r.addedNodes) scan(n);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['fx'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export { effects };
