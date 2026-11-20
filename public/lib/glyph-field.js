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
// Two renderers, chosen with the engine attribute before the element connects:
//   engine="2d" (default)  the block is drawn into the 2D canvas, copied to an
//                          ImageBitmap atlas, and glyphs are drawImage() calls.
//   engine="webgl"         the block is a texture (texElementSubImage2D) and
//                          glyphs are instanced quads.
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

const REPLACED = 'img, svg, video, canvas, input, button, select, textarea, hr, [data-particle]';
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export class GlyphField extends HTMLElement {
  static supported = SUPPORTED;

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
  /** "2d" or "webgl": the renderer in use. */
  get engine() { return this.#engine; }
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
    this.#engine = this.getAttribute('engine') === 'webgl' && WEBGL_OK ? 'webgl' : '2d';
    try {
      if (this.#engine === 'webgl') this.#initGL(); else this.#ctx = this.#canvas.getContext('2d');
      if (!this.#gl && !this.#ctx) throw new Error('no canvas context');
    } catch (err) {
      this.#goPlain(`could not start the ${this.#engine} renderer: ${err.message}`);
    }
    // A lost context leaves a canvas that draws nothing (or garbage). Show the text as plain HTML until it is back.
    for (const type of ['webglcontextlost', 'contextlost']) {
      this.#canvas.addEventListener(type, (e) => { e.preventDefault(); this.#goPlain('the canvas context was lost'); });
    }
    for (const type of ['webglcontextrestored', 'contextrestored']) {
      this.#canvas.addEventListener(type, () => {
        try { if (this.#engine === 'webgl') this.#initGL(); } catch (err) { this.#goPlain(`could not restart: ${err.message}`); return; }
        this.#leavePlain();
      });
    }
    this.#ro = new ResizeObserver(() => this.#resize());
    this.#ro.observe(this.#wrap);
    this.#ro.observe(this);
    this.#mo = new MutationObserver(() => { this.#stale = true; this.#marks = []; });
    this.#mo.observe(this, { childList: true, subtree: true, characterData: true });
    document.fonts?.ready.then(() => { this.#stale = true; this.#canvas.requestPaint(); });
    this.#canvas.addEventListener('paint', (e) => this.#paint(e));
    document.addEventListener('selectionchange', this.#onSelection);
    this.addEventListener('pointermove', (e) => {
      const r = this.getBoundingClientRect();
      this.#pointer = { x: e.clientX - r.x, y: e.clientY - r.y, down: e.buttons !== 0 };
      if (this.getAttribute('pointer') === 'repel' && !this.#pointer.down) this.#wake();
    });
    this.addEventListener('pointerleave', () => { this.#pointer = null; });
  }

  disconnectedCallback() {
    document.removeEventListener('selectionchange', this.#onSelection);
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

  #home() {
    if (this.#plain) return;
    this.#canvas.updateElementGeometry(this.#wrap, { canvasTransform: new DOMMatrix().translate(this.#bleed, this.#bleed) });
  }

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

  #paint(event) {
    if (!this.#W || this.#plain) return;
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
      if (this.#engine === 'webgl') this.#paintGL(repainted); else this.#paint2D(repainted);
    } catch (err) {
      this.lastError = err; // usually "not painted yet"; the next paint event tries again
      return;
    }
    // Say where the text lives: 2D draws leave the hit box on the last piece drawn, WebGL draws never move it.
    this.#home();
    this.dispatchEvent(new CustomEvent('glyphframe', { detail: { particles: this.#parts.length, moving: this.#running, ms: performance.now() - now, engine: this.#engine } }));
  }

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
    let data;
    if (!this.#running) {
      // Everything is home: one quad, texel for texel the same as plain text.
      data = new Float32Array([b + W / 2, b + H / 2, W, H, 0, 0, 1, 1, 1, 0]);
    } else {
      const parts = this.#parts;
      data = new Float32Array(parts.length * 10);
      let i = 0;
      for (const p of parts) {
        data[i++] = b + p.hx + p.x + p.w / 2; data[i++] = b + p.hy + p.y + p.h / 2;
        data[i++] = p.w; data[i++] = p.h;
        data[i++] = p.hx / W; data[i++] = p.hy / H; data[i++] = p.w / W; data[i++] = p.h / H;
        data[i++] = Math.cos(p.r) * p.s; data[i++] = Math.sin(p.r) * p.s;
      }
    }
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.#uView, W + 2 * b, H + 2 * b);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.length / 10);
  }
}

function lastLeaf(node) {
  while (node.lastChild) node = node.lastChild;
  return node;
}

if (!customElements.get('glyph-field')) customElements.define('glyph-field', GlyphField);
