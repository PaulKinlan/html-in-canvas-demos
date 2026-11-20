// <glyph-field>: text that can fly apart into glyph particles and come back,
// while staying ordinary text.
//
//   <glyph-field pointer="repel">
//     <h1>Any markup at all</h1>
//     <p>Links, <em>emphasis</em>, even contenteditable.</p>
//   </glyph-field>
//
//   field.explode({ x, y, power })   field.rain()   field.vortex()
//   field.scatter()                  field.assemble()
//   field.highlight('markup')        // matching glyphs lift off; returns the count
//
// The children are never split into spans. They are slotted, as they are,
// into a canvas. The element measures a rectangle for every grapheme with
// Range.getClientRects() and draws each one as a piece cut from one picture of
// the whole block. So the text keeps its shaping, selection, find-in-page,
// links and accessibility tree, and a selection highlight travels with the
// glyphs it covers.
//
// Three renderers, chosen with the engine attribute before the element connects:
//   engine="2d" (default)  the block is drawn into the 2D canvas, copied to an
//                          ImageBitmap atlas, and glyphs are drawImage() calls.
//   engine="webgl"         the block is a texture (texElementSubImage2D) and
//                          glyphs are instanced quads.
//   engine="webgpu"        the block is a GPUTexture (drawElementImageToTexture)
//                          and glyphs are instanced quads in WGSL.
//   engine="auto"          WebGPU when /shared/backend.js says it is usable,
//                          otherwise 2D (the WebGL renderer came out as a solid
//                          block on one Android phone, so it has to be asked for).
// .engine says which one is drawing and .gpuNote why WebGPU is not.
//
// When every particle is home the whole element is drawn in one call and the
// animation loop stops. If the canvas context is lost the element shows its
// children as plain HTML until the context comes back, and fires
// "glyphfallback" with the reason.

const SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype &&
  'updateElementGeometry' in HTMLCanvasElement.prototype;
const WEBGL_OK = typeof WebGL2RenderingContext !== 'undefined' && 'texElementSubImage2D' in WebGL2RenderingContext.prototype;

// The same instanced quad as the GLSL below: one instance per glyph.
const WGSL = `
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var<uniform> view: vec4f;   // xy: canvas size in CSS px
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) box: vec4f, @location(1) src: vec4f, @location(2) rot: vec2f) -> V {
  var corners = array<vec2f, 4>(vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5), vec2f(0.5, 0.5));
  let corner = corners[vi];
  var p = corner * box.zw;
  p = vec2f(p.x * rot.x - p.y * rot.y, p.x * rot.y + p.y * rot.x) + box.xy;
  let c = p / view.xy * 2.0 - 1.0;
  var o: V;
  o.pos = vec4f(c.x, -c.y, 0.0, 1.0);
  o.uv = src.xy + (corner + 0.5) * src.zw;
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f { return textureSample(tex, samp, i.uv); }`;

const VS = `#version 300 es
layout(location = 0) in vec2 aCorner;   // unit quad, -0.5..0.5
layout(location = 1) in vec4 aBox;      // centre x, y and size w, h in CSS px
layout(location = 2) in vec4 aSrc;      // u, v, width, height in texture space
layout(location = 3) in vec2 aRot;      // cos * scale, sin * scale
uniform vec2 uView;
out vec2 vUV;
void main() {
  vec2 p = aCorner * aBox.zw;
  p = vec2(p.x * aRot.x - p.y * aRot.y, p.x * aRot.y + p.y * aRot.x) + aBox.xy;
  vec2 c = p / uView * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vUV = aSrc.xy + (aCorner + 0.5) * aSrc.zw;
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 o;
void main() { o = texture(uTex, vUV); }`;

import { supportedGPU, GPUCanvas, GPUElementTexture, BLEND_OVER, watchFrame } from './gpu-util.js';
import { webgpu } from '../shared/backend.js';

const REPLACED = 'img, svg, video, canvas, input, button, select, textarea, hr, [data-particle]';
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export class GlyphField extends HTMLElement {
  static supported = SUPPORTED;

  #gpu = null; #gpuTex = null; #gpuPipeline = null; #gpuView = null; #gpuInst = null; #gpuInstSize = 0; #gpuBind = null; #gpuChecked = false; #gpuNote = '';

  #canvas; #engine = '2d'; #ctx; #atlas = null; #atlasBusy = false; #plain = null; #gl; #uView; #inst; #tex; #tw = 0; #th = 0; #dirtyTex = true; #wrap; #sizer;
  #bleed = 80; #dpr = 1; #W = 0; #H = 0;
  #parts = [];
  #stale = true;
  #running = false;
  #last = 0;
  #pointer = null;
  #marks = [];           // Ranges from highlight()
  #lifted = false;
  #ro; #mo;
  #settleWaiters = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get supported() { return SUPPORTED; }
  get canvas() { return this.#canvas; }
  /** "2d", "webgl" or "webgpu": the renderer in use ("starting" while WebGPU is being asked for). */
  get engine() { return this.#engine; }
  /** Why WebGPU is not drawing this element ('' when it is, or was not asked for). */
  get gpuNote() { return this.#gpuNote; }
  /** Why the element is showing plain HTML instead of the canvas, or null. */
  get fallbackReason() { return this.#plain; }
  /** Particles as plain data: { text, x, y, w, h, dx, dy, rotate }. */
  get particles() {
    this.#map();
    return this.#parts.map((p) => ({ text: p.text, x: p.hx, y: p.hy, w: p.w, h: p.h, dx: p.x, dy: p.y, rotate: p.r, selected: p.sel, marked: p.mark }));
  }
  get settled() { return !this.#running; }
  /** Resolves when every particle is back home. */
  whenSettled() { return this.#running ? new Promise((r) => this.#settleWaiters.push(r)) : Promise.resolve(); }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length) return;
    if (!SUPPORTED) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><slot></slot>`;
      return;
    }
    const b = (this.#bleed = Number(this.getAttribute('bleed') ?? 80));
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; }
        .sizer { visibility: hidden; pointer-events: none; }
        canvas { position: absolute; left: -${b}px; top: -${b}px; width: calc(100% + ${2 * b}px); height: calc(100% + ${2 * b}px); pointer-events: none; }
        .wrap { position: absolute; left: ${b}px; top: ${b}px; width: calc(100% - ${2 * b}px); pointer-events: auto; }
        .wrap.plain { position: static; width: auto; }
        :host([plain]) canvas, :host([plain]) .sizer { display: none; }
      </style>
      <div class="sizer"></div>
      <canvas content="drawable" layoutsubtree><div class="wrap" drawable><slot></slot></div></canvas>`;
    this.#canvas = this.shadowRoot.querySelector('canvas');
    this.#wrap = this.shadowRoot.querySelector('.wrap');
    this.#sizer = this.shadowRoot.querySelector('.sizer');
    this.#wireCanvas();
    this.#startEngine();
    this.#ro = new ResizeObserver(() => this.#resize());
    this.#ro.observe(this.#wrap);
    this.#ro.observe(this);
    // Take the text's height now: waiting for the observer leaves one frame where the element is 0px tall and the page below it jumps.
    this.#resize();
    this.#mo = new MutationObserver(() => { this.#stale = true; this.#marks = []; });
    this.#mo.observe(this, { childList: true, subtree: true, characterData: true });
    document.fonts?.ready.then(() => { this.#stale = true; this.#canvas.requestPaint(); });
    document.addEventListener('selectionchange', this.#onSelection);
    addEventListener('webgpulost', this.#onGPULost);
    this.addEventListener('pointermove', (e) => {
      const r = this.getBoundingClientRect();
      this.#pointer = { x: e.clientX - r.x, y: e.clientY - r.y, down: e.buttons !== 0 };
      if (this.getAttribute('pointer') === 'repel' && !this.#pointer.down) this.#wake();
    });
    this.addEventListener('pointerleave', () => { this.#pointer = null; });
  }

  disconnectedCallback() {
    document.removeEventListener('selectionchange', this.#onSelection);
    removeEventListener('webgpulost', this.#onGPULost);
  }

  #onGPULost = () => { if (this.#engine === 'webgpu') this.#leaveGPU(webgpu.reason || 'the WebGPU device was lost'); };

  #wireCanvas() {
    const canvas = this.#canvas;
    canvas.addEventListener('paint', (e) => { if (canvas === this.#canvas) this.#paint(e); });
    // A lost context leaves a canvas that draws nothing (or garbage). Show the text as plain HTML until it is back.
    for (const type of ['webglcontextlost', 'contextlost']) {
      canvas.addEventListener(type, (e) => { if (canvas !== this.#canvas) return; e.preventDefault(); this.#goPlain('the canvas context was lost'); });
    }
    for (const type of ['webglcontextrestored', 'contextrestored']) {
      canvas.addEventListener(type, () => {
        if (canvas !== this.#canvas) return;
        try { if (this.#engine === 'webgl') this.#initGL(); } catch (err) { this.#goPlain(`could not restart: ${err.message}`); return; }
        this.#leavePlain();
      });
    }
  }

  // Pick the renderer. WebGPU has to be asked for (a device, and whether it really works here), so that route starts a moment later.
  #startEngine() {
    const want = this.getAttribute('engine');
    const startGL = () => {
      this.#engine = (want === 'webgl' || want === 'webgpu') && WEBGL_OK ? 'webgl' : '2d';
      try {
        if (this.#engine === 'webgl') this.#initGL(); else this.#ctx = this.#canvas.getContext('2d');
        if (!this.#gl && !this.#ctx) throw new Error('no canvas context');
      } catch (err) {
        this.#goPlain(`could not start the ${this.#engine} renderer: ${err.message}`);
      }
    };
    if (want !== 'webgpu' && want !== 'auto') return startGL();
    if (!supportedGPU) { this.#gpuNote = 'this browser cannot put an element into a WebGPU texture'; return startGL(); }
    this.#engine = 'starting';
    const canvas = this.#canvas;
    const offscreen = this.hasAttribute('offscreen');
    webgpu({ force: offscreen }).then((gpu) => {
      if (canvas !== this.#canvas || this.#engine !== 'starting') return;
      if (gpu && !gpu.lost) {
        try {
          this.#initGPU(gpu, !offscreen);
          this.#engine = 'webgpu';
          this.#gpuNote = '';
        } catch (err) {
          this.#gpuNote = err.message;
        }
      } else this.#gpuNote = webgpu.reason || 'WebGPU did not start';
      if (this.#engine !== 'webgpu') startGL();
      this.#dirtyTex = true;
      this.#canvas.requestPaint();
    });
  }

  // WebGPU stopped working (device lost, or it rejected the first frame): carry on with WebGL on a fresh canvas.
  #leaveGPU(reason) {
    if (this.#engine !== 'webgpu') return;
    this.#gpuNote = reason;
    this.#gpuTex?.destroy(); this.#gpu?.destroy();
    this.#gpu = this.#gpuTex = this.#gpuPipeline = this.#gpuBind = this.#gpuInst = null;
    const old = this.#canvas, canvas = old.cloneNode(false);
    canvas.append(...old.childNodes);
    old.replaceWith(canvas);
    this.#canvas = canvas;
    this.#wireCanvas();
    this.#engine = WEBGL_OK && this.getAttribute('engine') !== 'auto' ? 'webgl' : '2d';
    this.#tw = this.#th = 0; this.#dirtyTex = true;
    try {
      if (this.#engine === 'webgl') this.#initGL(); else this.#ctx = canvas.getContext('2d');
    } catch (err) {
      this.#goPlain(`could not start the ${this.#engine} renderer: ${err.message}`);
    }
    this.dispatchEvent(new CustomEvent('glyphengine', { detail: { engine: this.#engine, reason } }));
    canvas.requestPaint();
  }

  // ------------------------------------------------------------ public API

  /** Blow the glyphs away from a point (CSS px from the element's top left). They return after `hold` ms. */
  explode({ x = this.#W / 2, y = this.#H / 2, power = 1, hold = 900 } = {}) {
    if (!this.#begin()) return Promise.resolve();
    for (const p of this.#parts) {
      const dx = p.hx + p.w / 2 - x, dy = p.hy + p.h / 2 - y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (520 * power) / (1 + d / 140) * (0.6 + Math.random() * 0.8);
      p.vx += (dx / d) * f + (Math.random() - 0.5) * 120;
      p.vy += (dy / d) * f + (Math.random() - 0.5) * 120 - 60;
      p.vr += (Math.random() - 0.5) * 16;
      p.free = hold / 1000 + (d / 600) * 0.25;
      p.mode = 'drift';
    }
    return this.whenSettled();
  }

  /** Glyphs fall and pile up on the bottom edge, then climb back. */
  rain({ hold = 1800 } = {}) {
    if (!this.#begin()) return Promise.resolve();
    for (const p of this.#parts) {
      p.vx += (Math.random() - 0.5) * 80;
      p.vy += -Math.random() * 120;
      p.vr += (Math.random() - 0.5) * 8;
      p.free = hold / 1000 + (1 - p.hy / Math.max(1, this.#H)) * 0.4 + Math.random() * 0.3;
      p.mode = 'fall';
    }
    return this.whenSettled();
  }

  /** Glyphs orbit a point before returning. */
  vortex({ x = this.#W / 2, y = this.#H / 2, hold = 1600 } = {}) {
    if (!this.#begin()) return Promise.resolve();
    for (const p of this.#parts) { p.free = hold / 1000 + Math.random() * 0.4; p.mode = 'orbit'; p.cx = x; p.cy = y; }
    return this.whenSettled();
  }

  /** Put every glyph somewhere random at once; they then assemble into the text. */
  scatter({ spread = 1 } = {}) {
    if (!this.#begin()) return Promise.resolve();
    const W = this.#W, H = this.#H, b = this.#bleed * 0.8;
    for (const p of this.#parts) {
      p.x = (-b + Math.random() * (W + 2 * b) - p.hx) * spread;
      p.y = (-b + Math.random() * (H + 2 * b) - p.hy) * spread;
      p.r = (Math.random() - 0.5) * 6;
      p.s = 0.4 + Math.random() * 1.4;
      p.vx = p.vy = p.vr = 0;
      p.free = Math.random() * 0.35 + (p.hx / Math.max(1, W)) * 0.5;
      p.mode = 'hang';
    }
    return this.whenSettled();
  }

  /** Call everything home now. */
  assemble() {
    for (const p of this.#parts) p.free = 0;
    return this.whenSettled();
  }

  /** Lift every glyph of every match of `query`. Returns the number of matches. */
  highlight(query, { caseSensitive = false } = {}) {
    this.#marks = [];
    if (query) {
      const q = caseSensitive ? query : query.toLowerCase();
      const walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode()); ) {
        const text = caseSensitive ? node.data : node.data.toLowerCase();
        for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
          const r = document.createRange();
          r.setStart(node, i); r.setEnd(node, i + q.length);
          this.#marks.push(r);
        }
      }
    }
    this.#flag();
    return this.#marks.length;
  }

  /** Re-measure the glyphs (done automatically on resize, edits and font load). */
  refresh() { this.#stale = true; this.#canvas?.requestPaint(); }

  // ------------------------------------------------------------ internals

  #goPlain(reason) {
    if (this.#plain) return;
    this.#plain = reason;
    this.#running = false;
    for (const r of this.#settleWaiters.splice(0)) r();
    this.#wrap.classList.add('plain');
    this.shadowRoot.append(this.#wrap);
    this.setAttribute('plain', '');
    this.dispatchEvent(new CustomEvent('glyphfallback', { detail: { reason } }));
  }

  #leavePlain() {
    if (!this.#plain) return;
    this.#plain = null;
    this.#wrap.classList.remove('plain');
    this.#canvas.append(this.#wrap);
    this.removeAttribute('plain');
    this.#atlas?.close?.(); this.#atlas = null;
    this.#tw = this.#th = 0;
    this.#dirtyTex = this.#stale = true;
    this.dispatchEvent(new CustomEvent('glyphfallback', { detail: { reason: null } }));
    this.#canvas.requestPaint();
  }

  #begin() {
    if (this.#plain) return false;
    if (!SUPPORTED) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && !this.hasAttribute('force-motion')) return false;
    this.#map();
    this.#wake();
    return true;
  }

  #wake() {
    if (this.#running) return;
    this.#running = true;
    // Start each flight from a fresh picture of the text.
    this.#atlas?.close?.(); this.#atlas = null; this.#dirtyTex = true;
    this.#last = performance.now();
    const tick = () => {
      if (!this.#running) return;
      this.#canvas.requestPaint();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  #resize() {
    const dpr = devicePixelRatio || 1;
    if (this.#plain) return;
    const h = this.#wrap.offsetHeight;
    this.#sizer.style.height = `${h}px`;
    const W = this.#wrap.offsetWidth, b = this.#bleed;
    const cw = Math.round((W + 2 * b) * dpr), ch = Math.round((h + 2 * b) * dpr);
    if (cw !== this.#canvas.width || ch !== this.#canvas.height) { this.#canvas.width = cw; this.#canvas.height = ch; }
    this.#W = W; this.#H = h; this.#dpr = dpr;
    this.#stale = true; this.#dirtyTex = true;
    this.#canvas.requestPaint();
  }

  // #region home
  #home() {
    if (this.#plain) return;
    this.#canvas.updateElementGeometry(this.#wrap, { canvasTransform: new DOMMatrix().translate(this.#bleed, this.#bleed) });
  }
  // #endregion home

  // #region map
  /** One particle per grapheme (and per replaced element), from the live layout. */
  #map() {
    if (!this.#stale || !this.#wrap) return;
    this.#stale = false;
    // Rects are measured relative to the wrapper, so it has to be at its home position.
    const origin = this.#wrap.getBoundingClientRect();
    const sx = origin.width / (this.#wrap.offsetWidth || 1) || 1;
    const old = this.#parts;
    const parts = [];
    const add = (rect, text, node, start, end) => {
      if (rect.width < 0.5 || rect.height < 0.5) return;
      const prev = old[parts.length];
      parts.push({
        text, node, start, end,
        hx: (rect.x - origin.x) / sx, hy: (rect.y - origin.y) / sx, w: rect.width / sx, h: rect.height / sx,
        x: prev?.x ?? 0, y: prev?.y ?? 0, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0,
        r: prev?.r ?? 0, vr: prev?.vr ?? 0, s: prev?.s ?? 1, free: prev?.free ?? 0, mode: prev?.mode ?? 'spring',
        sel: false, mark: false, phase: Math.random() * 6.28,
      });
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(REPLACED) ? NodeFilter.FILTER_ACCEPT : n.nodeType === 3 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let node; (node = walker.nextNode()); ) {
      if (node.nodeType === 1) {
        add(node.getBoundingClientRect(), '', node, 0, 0);
        // Text inside a replaced element (a button's label) travels with it.
        walker.currentNode = lastLeaf(node);
        continue;
      }
      const data = node.data;
      const pieces = segmenter ? segmenter.segment(data) : Array.from(data, (segment, index) => ({ segment, index }));
      for (const { segment, index } of pieces) {
        // Spaces are particles too: they carry underlines and the selection highlight between words.
        range.setStart(node, index);
        range.setEnd(node, index + segment.length);
        const rects = range.getClientRects();
        if (rects.length) add(rects[0], segment, node, index, index + segment.length);
      }
    }
    this.#parts = parts;
    this.#flag(false);
  }
  // #endregion map

  #onSelection = () => this.#flag();

  /** Mark the particles covered by the selection or by highlight() ranges. */
  #flag(wake = true) {
    if (!SUPPORTED) return;
    this.#map();
    const sel = getSelection();
    const ranges = [];
    for (let i = 0; i < sel.rangeCount; i++) { const r = sel.getRangeAt(i); if (!r.collapsed && this.contains(r.commonAncestorContainer)) ranges.push(r); }
    let lifted = false;
    for (const p of this.#parts) {
      if (p.node.nodeType !== 3) { p.sel = p.mark = false; continue; }
      const inside = (r) => r.isPointInRange(p.node, p.start) && r.isPointInRange(p.node, p.end);
      p.sel = ranges.some(inside);
      p.mark = this.#marks.some(inside);
      lifted ||= p.sel || p.mark;
    }
    this.#lifted = lifted;
    if (wake && (lifted || this.#parts.some((p) => p.s !== 1 || p.y !== 0))) {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches || this.hasAttribute('force-motion')) this.#wake();
    }
    this.#canvas?.requestPaint();
  }

  #step(dt, now) {
    const parts = this.#parts, H = this.#H, W = this.#W;
    const ptr = this.getAttribute('pointer') === 'repel' && this.#pointer && !this.#pointer.down ? this.#pointer : null;
    const floor = H + this.#bleed * 0.75;
    let moving = false;
    for (const p of parts) {
      let ax = 0, ay = 0, tr = 0, ts = 1, tx = 0, ty = 0;
      const cx = p.hx + p.x + p.w / 2, cy = p.hy + p.y + p.h / 2;
      if (p.free > 0) {
        p.free -= dt;
        if (p.mode === 'fall') {
          ay += 1500;
          if (cy + p.h / 2 > floor && p.vy > 0) { p.y = floor - p.hy - p.h; p.vy *= -0.28; p.vx *= 0.6; p.vr *= 0.5; }
        } else if (p.mode === 'orbit') {
          const dx = cx - p.cx, dy = cy - p.cy, d = Math.hypot(dx, dy) || 1;
          const target = 60 + ((p.phase * 37) % 110);
          ax += (-dy / d) * 900 - (dx / d) * (d - target) * 14 - p.vx * 2.2;
          ay += (dx / d) * 900 - (dy / d) * (d - target) * 14 - p.vy * 2.2;
          p.vr += dt * 6;
        } else if (p.mode === 'drift') {
          ax += -p.vx * 1.6; ay += -p.vy * 1.6 + 220;
        } else if (p.mode === 'hang') {
          p.vx = p.vy = p.vr = 0;
        }
        p.vr *= 1 - Math.min(1, dt * 0.8);
        moving = true;
      } else {
        if (p.sel || p.mark) {
          ty = -4 + Math.sin(now / 160 + p.phase) * 2.5;
          ts = p.mark ? 1.35 : 1.15;
          tr = Math.sin(now / 210 + p.phase) * 0.12;
        }
        // Spring home (slightly under-damped so glyphs overshoot and settle).
        ax += -(p.x - tx) * 70 - p.vx * 11;
        ay += -(p.y - ty) * 70 - p.vy * 11;
        if (p.r > Math.PI || p.r < -Math.PI) p.r -= Math.round(p.r / (2 * Math.PI)) * 2 * Math.PI;
        p.vr += (-(p.r - tr) * 60 - p.vr * 10) * dt;
        p.s += (ts - p.s) * Math.min(1, dt * 9);
      }
      if (ptr) {
        const dx = cx - ptr.x, dy = cy - ptr.y, d = Math.hypot(dx, dy) || 1;
        if (d < 110) { const f = (1 - d / 110) ** 2 * 5200; ax += (dx / d) * f; ay += (dy / d) * f; p.vr += (dx / d) * f * 0.0006; moving = true; }
      }
      p.vx += ax * dt; p.vy += ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      if (!moving && (Math.abs(p.x - tx) > 0.05 || Math.abs(p.y - ty) > 0.05 || Math.abs(p.vx) + Math.abs(p.vy) > 0.5 || Math.abs(p.r - tr) > 0.003 || Math.abs(p.s - ts) > 0.003 || p.sel || p.mark)) moving = true;
    }
    void W;
    return moving;
  }

  #initGL() {
    // preserveDrawingBuffer is only for tests that read the canvas back; it is off otherwise.
    const gl = (this.#gl = this.#canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: this.hasAttribute('debug-readback') }));
    if (!gl) throw new Error('WebGL 2 is not available');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.#uView = gl.getUniformLocation(prog, 'uView');
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.#inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#inst);
    const stride = 10 * 4;
    for (const [loc, size, off] of [[1, 4, 0], [2, 4, 16], [3, 2, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    this.#tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  #initGPU(gpu, present) {
    const g = (this.#gpu = new GPUCanvas(this.#canvas, gpu, { present }));
    const { device } = g;
    const module = device.createShaderModule({ code: WGSL });
    this.#gpuPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module, entryPoint: 'vs',
        buffers: [{ arrayStride: 40, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x2' }] }],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format: g.format, blend: BLEND_OVER }] },
      primitive: { topology: 'triangle-strip' },
    });
    this.#gpuView = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.#gpuTex = new GPUElementTexture(device, this.#canvas, this.#wrap);
    this.#gpuChecked = false;
    this.#tw = this.#th = 0;
  }

  /** The last frame as ImageData. With the offscreen attribute on a WebGPU element this reads the GPU texture; otherwise it copies the canvas. */
  async readback() {
    if (this.#engine === 'webgpu' && !this.#gpu.present) return this.#gpu.read();
    const c = document.createElement('canvas');
    c.width = this.#canvas.width; c.height = this.#canvas.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.#canvas, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  #paint(event) {
    if (!this.#W || this.#plain || this.#engine === 'starting') return;
    if (this.#gl?.isContextLost?.()) { this.#goPlain('the canvas context was lost'); return; }
    this.#map();
    const now = performance.now();
    if (this.#running) {
      const dt = Math.min(0.033, Math.max(0, (now - this.#last) / 1000));
      this.#last = now;
      if (!this.#step(dt, now)) {
        this.#running = false;
        for (const p of this.#parts) { p.x = p.y = p.vx = p.vy = p.r = p.vr = 0; p.s = 1; p.mode = 'spring'; }
        for (const r of this.#settleWaiters.splice(0)) r();
        this.dispatchEvent(new CustomEvent('glyphsettle'));
      }
    }
    const changed = event?.changedElements;
    const repainted = this.#dirtyTex || !changed || [...changed].includes(this.#wrap);
    try {
      if (this.#engine === 'webgpu') this.#paintGPU(repainted); else if (this.#engine === 'webgl') this.#paintGL(repainted); else this.#paint2D(repainted);
    } catch (err) {
      this.lastError = err; // usually "not painted yet"; the next paint event tries again
      return;
    }
    // Say where the text lives: 2D draws leave the hit box on the last piece drawn, WebGL draws never move it.
    this.#home();
    this.dispatchEvent(new CustomEvent('glyphframe', { detail: { particles: this.#parts.length, moving: this.#running, ms: performance.now() - now, engine: this.#engine } }));
  }

  // #region paint2d
  #paint2D(repainted) {
    const ctx = this.#ctx, dpr = this.#dpr, b = this.#bleed, wrap = this.#wrap, W = this.#W, H = this.#H;
    if (this.#running && (repainted || !this.#atlas) && !this.#atlasBusy) {
      // Refresh the atlas: draw the block, copy those pixels, then draw the real frame over it.
      // createImageBitmap copies the canvas as it is now, and nothing reaches the screen until this handler returns.
      const size = this.#canvas.getElementImageDefaultSize(wrap);
      const tw = Math.max(1, Math.min(this.#canvas.width, Math.ceil(size.width))), th = Math.max(1, Math.min(this.#canvas.height, Math.ceil(size.height)));
      ctx.reset();
      ctx.drawElementImage(wrap, 0, 0);
      this.#atlasBusy = true;
      this.#dirtyTex = false;
      createImageBitmap(this.#canvas, 0, 0, tw, th).then((bmp) => {
        this.#atlas?.close?.();
        this.#atlas = bmp; this.#tw = tw; this.#th = th;
      }, (err) => { this.lastError = err; this.#dirtyTex = true; }).finally(() => { this.#atlasBusy = false; this.#canvas.requestPaint(); });
    }
    ctx.reset();
    if (!this.#running || !this.#atlas) {
      // Everything is home (or the atlas is not ready yet): one draw, the same as plain text.
      ctx.scale(dpr, dpr);
      ctx.drawElementImage(wrap, b, b, W, H);
      if (!this.#running) this.#dirtyTex = true;   // take a fresh atlas at the start of the next flight
      return;
    }
    const atlas = this.#atlas, kx = this.#tw / W, ky = this.#th / H;
    for (const p of this.#parts) {
      const s = p.s * dpr, cos = Math.cos(p.r) * s, sin = Math.sin(p.r) * s;
      ctx.setTransform(cos, sin, -sin, cos, (b + p.hx + p.x + p.w / 2) * dpr, (b + p.hy + p.y + p.h / 2) * dpr);
      ctx.drawImage(atlas, p.hx * kx, p.hy * ky, p.w * kx, p.h * ky, -p.w / 2, -p.h / 2, p.w, p.h);
    }
  }
  // #endregion paint2d

  #paintGL(repainted) {
    const gl = this.#gl, b = this.#bleed, wrap = this.#wrap, W = this.#W, H = this.#H;
    // The text is one texture. It only needs a new upload when the browser repainted it.
    if (repainted) {
      const size = this.#canvas.getElementImageDefaultSize(wrap);
      const tw = Math.max(1, Math.ceil(size.width)), th = Math.max(1, Math.ceil(size.height));
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (tw > max || th > max) { this.#goPlain(`the text needs a ${tw}×${th} texture and this GPU stops at ${max}`); return; }
      gl.bindTexture(gl.TEXTURE_2D, this.#tex);
      if (tw !== this.#tw || th !== this.#th) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.#tw = tw; this.#th = th;
      }
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, wrap);
      this.#dirtyTex = false;
    }
    const data = this.#instances();
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.#uView, W + 2 * b, H + 2 * b);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.length / 10);
  }

  /** Ten floats per quad: centre, size, source rectangle in the texture, rotation. Shared by the WebGL and WebGPU renderers. */
  #instances() {
    const b = this.#bleed, W = this.#W, H = this.#H;
    // Everything is home: one quad, texel for texel the same as plain text.
    if (!this.#running) return new Float32Array([b + W / 2, b + H / 2, W, H, 0, 0, 1, 1, 1, 0]);
    const parts = this.#parts;
    const data = new Float32Array(parts.length * 10);
    let i = 0;
    for (const p of parts) {
      data[i++] = b + p.hx + p.x + p.w / 2; data[i++] = b + p.hy + p.y + p.h / 2;
      data[i++] = p.w; data[i++] = p.h;
      data[i++] = p.hx / W; data[i++] = p.hy / H; data[i++] = p.w / W; data[i++] = p.h / H;
      data[i++] = Math.cos(p.r) * p.s; data[i++] = Math.sin(p.r) * p.s;
    }
    return data;
  }

  #paintGPU(repainted) {
    const g = this.#gpu, b = this.#bleed, W = this.#W, H = this.#H;
    if (!g || g.lost) return;
    const { device } = g;
    const frame = () => {
      // The text is one texture. It only needs a new upload when the browser repainted it.
      if (repainted || !this.#gpuTex.width) {
        const size = this.#canvas.getElementImageDefaultSize(this.#wrap);
        const max = device.limits.maxTextureDimension2D;
        if (size.width > max || size.height > max) { this.#goPlain(`the text needs a ${Math.ceil(size.width)}×${Math.ceil(size.height)} texture and this GPU stops at ${max}`); return; }
        this.#gpuTex.update();
        this.#dirtyTex = false;
      }
      const data = this.#instances();
      if (data.byteLength > this.#gpuInstSize) {
        this.#gpuInst?.destroy();
        this.#gpuInstSize = Math.max(4096, 2 ** Math.ceil(Math.log2(data.byteLength)));
        this.#gpuInst = device.createBuffer({ size: this.#gpuInstSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      device.queue.writeBuffer(this.#gpuInst, 0, data);
      device.queue.writeBuffer(this.#gpuView, 0, new Float32Array([W + 2 * b, H + 2 * b, 0, 0]));
      if (!this.#gpuBind || this.#gpuBind.view !== this.#gpuTex.view) {
        this.#gpuBind = {
          view: this.#gpuTex.view,
          group: device.createBindGroup({
            layout: this.#gpuPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.#gpuView } }, { binding: 1, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }, { binding: 2, resource: this.#gpuTex.view }],
          }),
        };
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: g.view(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(this.#gpuPipeline);
      pass.setBindGroup(0, this.#gpuBind.group);
      pass.setVertexBuffer(0, this.#gpuInst, 0, data.byteLength);
      pass.draw(4, data.length / 10);
      pass.end();
      device.queue.submit([encoder.finish()]);
      g.shown((why) => this.#gpu === g && this.#leaveGPU(why));
    };
    if (this.#gpuChecked) return frame();
    // The first frame is watched: a browser whose WebGPU rejects it goes to WebGL, with the reason.
    watchFrame(device, frame, (problem) => this.#gpu === g && this.#leaveGPU(`WebGPU rejected the first frame: ${problem}`));
    this.#gpuChecked = true;
  }
}

function lastLeaf(node) {
  while (node.lastChild) node = node.lastChild;
  return node;
}

if (!customElements.get('glyph-field')) customElements.define('glyph-field', GlyphField);
