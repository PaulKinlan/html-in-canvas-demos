// Shader CSS: run any element through a fragment shader with one attribute.
//
//   <script type="module" src="/lib/shader-fx.js"></script>
//
//   <button fx="ripple">Still a button</button>
//   <article fx="dissolve" style="--fx-progress: 0.4">…</article>
//
// Built-in effects: tilt, ripple, glass, haze, crt, dissolve, curl (page-curl).
// The same names work as <canvas-slot effect="…">; the registry, the shader
// contract and the CSS properties live in effects.js and are shared.
//
// CSS drives the shader. Two registered custom properties become uniforms, so
// transitions, animations, :hover and media queries all work:
//
//   --fx-progress   0..1   u_progress  (dissolve, curl)
//   --fx-amount     number u_amount    (strength, default 1)
//   --fx-x, --fx-y  number u_xy        (tilt direction, -1..1)
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
// absent), u_hover (0..1, eased), u_progress, u_amount, u_xy, u_clicks[4] (x, y, age).
//
// fx can also point at a shader: fx="#script-id" or fx="url(/fx/wobble.frag)".
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

import { SurfaceElement, ElementTexture, supported, supportedGL } from './surface.js';
import { effects, defineEffect, onEffectChange, resolveEffect, readParams, reducedMotion, effectTime, inverseHomography, setupQuad, compileEffect, setEffectUniforms, sharedGL } from './effects.js';

export { effects, defineEffect };

const MAX_DIRECT = 8;
let liveDirect = 0;

const instances = new Set();
onEffectChange((name) => {
  for (const s of instances) if (s.rawEffect === name || s.effectName === name) s.effectChanged();
});

const shared = sharedGL;

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
  get rawEffect() {
    return (this.target.getAttribute('fx') || 'none').trim();
  }
  get effectName() {
    return resolveEffect(this.rawEffect, this.ownerDocument);
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
    const { progress, amount, x, y } = readParams(this.target);
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
    const time = effectTime();
    const p = this.#pointer ?? { x: -1e4, y: -1e4 };
    const signature = `${name}|${progress}|${amount}|${x},${y}|${p.x},${p.y}|${this.#hover}|${this.canvas.width}x${this.canvas.height}|${moving ? time : ''}`;
    // CSS can change --fx-progress at any time (a transition, :hover), and
    // there is no event for that, so keep sampling while on screen and only
    // draw when a uniform actually changed.
    if (signature === this.#signature && !this.contentDirty) return true;
    this.#signature = signature;

    // An effect that moves the element (tilt) says where, so hit testing follows.
    const matrix = def.geometry?.({ width: this.width, height: this.height, pointer: this.#pointer, hover: this.#hover, progress, amount, x, y }) ?? null;
    const uniforms = { progress, amount, time, pointer: p, clicks, x, y, inv: inverseHomography(matrix) };
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
    this.setGeometry(matrix ? this.restMatrix.multiply(matrix) : undefined);
    this.contentDirty = false;
    this.frames++;
    return true;
  }

  #setUniforms(gl, u, uniforms, texOrigin, texSize) {
    setEffectUniforms(gl, u, {
      ...uniforms,
      canvas: [this.canvas.width / this.scale, this.canvas.height / this.scale],
      origin: [this.bleed, this.bleed],
      texOrigin,
      texSize,
      size: [this.width, this.height],
      hover: this.#hover,
    });
  }

  // #region render
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
  // #endregion render

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
    shared.upload(this.canvas);
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
  const name = resolveEffect(el.getAttribute('fx'), el.ownerDocument);
  const bleed = el.getAttribute('fx-bleed') ?? effects.get(name)?.bleed ?? 0;
  // The host connects before the element is moved into it, so anything the
  // context choice depends on has to be on the host already.
  const attrs = { bleed };
  if (el.hasAttribute('fx-backend')) attrs['fx-backend'] = el.getAttribute('fx-backend');
  const host = FxSurface.adopt(el, attrs);
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

