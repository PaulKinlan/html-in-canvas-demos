// The shader backend behind <canvas-slot effect="…">. canvas-slot.js loads
// this file only when the effect attribute is used.
//
//   <canvas-slot effect="tilt">
//     <article slot="card">…</article>
//     <form slot="form" effect="ripple">…</form>   a slot can pick its own
//   </canvas-slot>
//
// Every slot becomes a texture (texElementSubImage2D, or
// drawElementImageToTexture with backend="webgpu") and is drawn through the
// fragment shader its effect names. Effects come from effects.js, the same
// registry the fx attribute uses, and are driven by the same CSS custom
// properties (--fx-progress, --fx-amount, --fx-x, --fx-y), read from each
// slotted element.
//
// Nobody has to write a render loop: with no onrender the slots stack as they
// do without an effect, and the element repaints by itself while something
// is moving. onrender still works and gets the same draw(name, x, y).

import { ElementTexture, geometryUnit, cssZoom, supportedGL } from './surface.js';
import {
  effects, onEffectChange, resolveEffect, readParams, reducedMotion, effectTime, Interaction, inverseHomography,
  setupQuad, compileEffect, setEffectUniforms, sharedGL, WGSL_UNIFORM_SIZE, packWGSLUniforms, hasWGSL, gpuEffect, gpuSampler,
} from './effects.js';
import { blankWatch, supportedGPU, uploadElement, watchFrame } from './gpu-util.js';
import { webgpu } from '../shared/backend.js';

export { supportedGL, supportedGPU };

/**
 * Resolves true when WebGPU really works on this page (/shared/backend.js: a
 * real adapter that passes its self-test). <canvas-slot effect> waits for
 * this once, then uses WebGPU by default when it is true.
 */
export const gpuReady = supportedGPU ? webgpu().then((gpu) => !!gpu && !gpu.lost) : Promise.resolve(false);
/** The first effect in use on a <canvas-slot> (its own, or a slotted child's) that has no WGSL source, or null. */
export function missingWGSL(host) {
  const names = [host.getAttribute('effect'), ...[...host.children].map((el) => el.getAttribute('effect'))].filter(Boolean);
  for (const raw of names) {
    const name = resolveEffect(raw, host.ownerDocument);
    // An effect still being fetched resolves to 'none' for now; whether it has WGSL is not known yet.
    if (name === 'none' && raw.trim() !== 'none') return raw;
    if (!hasWGSL(name)) return raw;
  }
  return null;
}

/** Why WebGPU is not in use ('' when it is). */
export const gpuReason = () => (supportedGPU ? webgpu.reason : 'this browser cannot put an element into a WebGPU texture');

// A page only gets about 16 WebGL contexts, and the fx attribute may use eight
// of them, so only the first few <canvas-slot effect> elements get their own.
const MAX_DIRECT = 6;
let liveDirect = 0;

// ---- WebGL: the canvas has its own context ---------------------------------

class GLBackend {
  kind = 'webgl';
  ready = Promise.resolve();
  #programs = new Map();
  #textures = new WeakMap();

  constructor(canvas, onfail) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no WebGL2 context');
    this.gl = gl;
    liveDirect++;
    this.#setup();
    // A lost context can come back, but slots uploaded after a real GPU reset
    // were seen to stay blank, so do not wait: ask the host for a new canvas.
    canvas.addEventListener('webglcontextlost', () => {
      if (!this.destroyed) queueMicrotask(() => onfail('WebGL context lost'));
    });
  }

  #setup() {
    const gl = this.gl;
    setupQuad(gl);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied "over"
  }

  begin() {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  // #region texture
  /** Upload the element if needed. Returns the texture size in device px. */
  texture(el, dirty) {
    let t = this.#textures.get(el);
    if (!t) this.#textures.set(el, (t = new ElementTexture(this.gl, this.canvas, el)));
    const size = this.canvas.getElementImageDefaultSize(el);
    if (dirty || !t.width || Math.ceil(size.width) !== t.width || Math.ceil(size.height) !== t.height) t.update();
    return t;
  }
  // #endregion texture

  has(name) {
    return true;
  }

  draw(el, name, uniforms) {
    const gl = this.gl;
    const { program, u } = compileEffect(gl, this.#programs, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures.get(el).texture);
    gl.useProgram(program);
    setEffectUniforms(gl, u, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  end() {}

  /** RGBA of one canvas pixel (device px from the top-left). */
  async pixel(x, y) {
    const gl = this.gl;
    const out = new Uint8Array(4);
    gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return Array.from(out);
  }

  destroy() {
    this.destroyed = true;
    liveDirect = Math.max(0, liveDirect - 1);
    // Freed by /shared/context-guard.js once the canvas is out of the page.
    globalThis.__gfx?.retire(this.canvas);
  }
}

// ---- Shared: a 2D canvas borrowing the one page-wide WebGL context ----------
//
// Each slot is drawn into the 2D canvas with drawElementImage(), the canvas is
// copied into the shared context as a texture, and the shaded result builds up
// there. At the end the finished frame is copied back. Slower than a context
// of its own, but there is no limit on how many elements can do it.

class SharedBackend {
  kind = 'shared';
  ready = Promise.resolve();

  constructor(canvas, onfail) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('no 2D context');
    // Large 2D canvases live on the GPU too and can be lost with it.
    canvas.addEventListener('contextlost', () => {
      if (!this.destroyed) queueMicrotask(() => onfail('2D canvas context lost'));
    });
  }

  begin() {
    const gl = sharedGL.ensure();
    if (!gl) return false;
    const { width: cw, height: ch } = this.canvas;
    if (sharedGL.canvas.width < cw) sharedGL.canvas.width = cw;
    if (sharedGL.canvas.height < ch) sharedGL.canvas.height = ch;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  texture(el, _dirty, x, y, dpr) {
    const { ctx, canvas } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight);
    sharedGL.upload(canvas);
    return { width: canvas.width, height: canvas.height, origin: [x, y] };
  }

  has() {
    return true;
  }

  draw(_el, name, uniforms) {
    const gl = sharedGL.gl;
    const { program, u } = compileEffect(gl, sharedGL.programs, name);
    gl.useProgram(program);
    setEffectUniforms(gl, u, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  end() {
    const { ctx, canvas } = this;
    const { width: cw, height: ch } = canvas;
    sharedGL.gl.disable(sharedGL.gl.BLEND);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(sharedGL.canvas, 0, sharedGL.canvas.height - ch, cw, ch, 0, 0, cw, ch);
  }

  async pixel(x, y) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.canvas, -x, -y);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }

  destroy() {
    this.destroyed = true;
  }
}

// ---- WebGPU ----------------------------------------------------------------

class GPUBackend {
  kind = 'webgpu';
  #watch = blankWatch();
  #pipelines = new Map();
  #textures = new WeakMap();
  #draws = [];
  #pool = [];
  #last = null;

  /**
   * present: false renders to an off-screen texture only (for readback where a GPU canvas cannot be shown).
   * strict: the author asked for WebGPU by name, so an effect without WGSL is drawn unshaded instead of falling back.
   */
  constructor(canvas, onfail, { present = true, strict = false } = {}) {
    this.canvas = canvas;
    this.present = present;
    this.strict = strict;
    this.onfail = onfail;
    this.ready = this.#init();
  }

  async #init() {
    // The page's shared device. Off-screen use never shows a canvas, so a software adapter will do.
    const gpu = await webgpu({ force: !this.present });
    if (!gpu || gpu.lost) throw new Error(webgpu.reason || 'WebGPU did not start');
    const device = gpu.device;
    this.device = device;
    this.format = gpu.format;
    // The canvas needs a WebGPU context for drawElementImageToTexture even
    // when nothing is presented to it.
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('no WebGPU canvas context');
    this.context.configure({ device, format: this.format, alphaMode: 'premultiplied' });
    this.sampler = gpuSampler(device);
    device.lost.then((info) => {
      if (this.destroyed) return;
      this.dead = true;
      this.onfail(`WebGPU device lost: ${info.message || info.reason}`);
    });
  }

  begin() {
    this.#draws = [];
    return !!this.device && !this.dead;
  }

  texture(el, dirty) {
    const size = this.canvas.getElementImageDefaultSize(el);
    const w = Math.max(1, Math.ceil(size.width));
    const h = Math.max(1, Math.ceil(size.height));
    let t = this.#textures.get(el);
    if (!t || t.width !== w || t.height !== h) {
      t?.texture.destroy();
      // #region texture-gpu
      const texture = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      // #endregion texture-gpu
      t = { texture, view: texture.createView(), width: w, height: h, fresh: true };
      this.#textures.set(el, t);
    }
    if (dirty || t.fresh) {
      // #region texture-gpu
      // uploadElement() is device.queue.drawElementImageToTexture({ source: el }, { texture })
      const upload = () => uploadElement(this.device, el, t.texture);
      // #endregion texture-gpu
      // The first upload is watched: a browser whose WebGPU rejects it goes to WebGL, with the reason.
      if (this.#checked) upload();
      else {
        watchFrame(this.device, upload, (problem) => !this.destroyed && !this.dead && this.onfail(`WebGPU rejected the element: ${problem}`));
        this.#checked = true;
      }
      t.fresh = false;
    }
    return t;
  }
  #checked = false;

  has(name) {
    return hasWGSL(name);
  }

  #pipeline(name) {
    return gpuEffect(this.device, this.format, name);
  }

  draw(el, name, uniforms) {
    const buffer = this.#pool[this.#draws.length] ?? (this.#pool[this.#draws.length] = this.device.createBuffer({ size: WGSL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.device.queue.writeBuffer(buffer, 0, packWGSLUniforms(uniforms, this.canvas.width / uniforms.canvas[0]));
    const pipeline = this.#pipeline(name);
    const bind = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.#textures.get(el).view }],
    });
    this.#draws.push({ pipeline, bind });
  }

  #run(view, encoder) {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    for (const d of this.#draws) {
      pass.setPipeline(d.pipeline);
      pass.setBindGroup(0, d.bind);
      pass.draw(3);
    }
    pass.end();
  }

  end() {
    this.#last = this.#draws;
    if (!this.present) return;
    const encoder = this.device.createCommandEncoder();
    this.#run(this.context.getCurrentTexture().createView(), encoder);
    this.device.queue.submit([encoder.finish()]);
    // Only when something was drawn: a frame with no slots is meant to be empty.
    if (this.#draws.length) this.#watch(this.canvas, (why) => !this.destroyed && !this.dead && this.onfail(why));
  }

  /** Re-run the last frame into an off-screen texture and read one pixel back. */
  async pixel(x, y) {
    const { device } = this;
    const w = this.canvas.width, h = this.canvas.height;
    const target = device.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const encoder = device.createCommandEncoder();
    this.#draws = this.#last ?? [];
    this.#run(target.createView(), encoder);
    const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture: target, origin: [Math.min(w - 1, x), Math.min(h - 1, y)] }, { buffer, bytesPerRow: 256 }, [1, 1]);
    device.pushErrorScope('validation');
    device.queue.submit([encoder.finish()]);
    const err = await device.popErrorScope();
    if (err) throw new Error(err.message);
    await buffer.mapAsync(GPUMapMode.READ);
    let p = Array.from(new Uint8Array(buffer.getMappedRange()).slice(0, 4));
    if (this.format === 'bgra8unorm') p = [p[2], p[1], p[0], p[3]];
    buffer.unmap();
    target.destroy();
    return p;
  }

  destroy() {
    // The device belongs to the page, so only this element's textures go.
    this.destroyed = true;
    try {
      this.context?.unconfigure();
    } catch {}
  }
}

// ---- the renderer ----------------------------------------------------------

/**
 * Attach the shader renderer to a <canvas-slot>.
 *   kind      'webgl' | 'shared' | 'webgpu'. 'webgl' becomes 'shared' once
 *             MAX_DIRECT elements already have a context of their own.
 *   onfail    called with a reason when the backend cannot go on; the host
 *             then falls back (webgpu → webgl → shared → plain 2D)
 */
export function attach(host, canvas, kind, onfail, options = {}) {
  return new SlotEffects(host, canvas, kind, onfail, options);
}

class SlotEffects {
  frames = 0;
  error = null;
  #host;
  #canvas;
  #backend;
  #state = new WeakMap(); // element -> { interaction, x, y, w, h, signature }
  #drawn = [];
  #raf = 0;
  #visible = true;
  #io;
  #off;
  #ready = false;
  #signature = '';
  #pointer = null;
  #onfail;
  #left = false;

  constructor(host, canvas, kind, onfail, options) {
    this.#host = host;
    this.#canvas = canvas;
    this.#onfail = onfail;
    if (kind === 'webgpu') this.#backend = new GPUBackend(canvas, onfail, options);
    else if (kind === 'webgl' && (options.force || liveDirect < MAX_DIRECT)) this.#backend = new GLBackend(canvas, onfail);
    else this.#backend = new SharedBackend(canvas, onfail);
    this.#backend.ready.then(
      () => {
        this.#ready = true;
        canvas.requestPaint();
      },
      (err) => onfail(err.message),
    );
    host.addEventListener('pointermove', this.#onMove);
    host.addEventListener('pointerdown', this.#onDown);
    host.addEventListener('pointerleave', this.#onLeave);
    this.#off = onEffectChange(() => this.changed());
    this.#io = new IntersectionObserver(([entry]) => {
      this.#visible = entry.isIntersecting;
      if (this.#visible) this.#watch();
    }, { rootMargin: '100px' });
    this.#io.observe(host);
    this.#watch();
  }

  get kind() {
    return this.#backend.kind;
  }
  get ready() {
    return this.#backend.ready;
  }

  /** The effect a slotted element resolves to: its own effect attribute, else the host's. */
  effectFor(el) {
    return resolveEffect(el.getAttribute('effect') ?? this.#host.getAttribute('effect'), this.#host.ownerDocument);
  }

  changed() {
    this.#signature = '';
    this.#canvas.requestPaint();
  }

  // Pointer position in each drawn slot's own (unshaded) coordinates.
  #local(e, s) {
    const r = this.#canvas.getBoundingClientRect();
    const z = cssZoom(this.#canvas);
    return { x: (e.clientX - r.left) / z - s.x, y: (e.clientY - r.top) / z - s.y };
  }
  #inside(p, s) {
    return p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h;
  }
  #onMove = (e) => {
    this.#pointer = e;
    for (const el of this.#drawn) {
      const s = this.#state.get(el);
      const p = this.#local(e, s);
      if (this.#inside(p, s)) s.interaction.move(p);
      else s.interaction.leave();
    }
    this.#watch();
  };
  #onLeave = () => {
    this.#pointer = null;
    for (const el of this.#drawn) this.#state.get(el).interaction.leave();
    this.#watch();
  };
  #onDown = (e) => {
    this.#onMove(e);
    for (const el of this.#drawn) {
      const s = this.#state.get(el);
      const p = this.#local(e, s);
      if (this.#inside(p, s)) s.interaction.down(p);
    }
    this.#canvas.requestPaint();
  };

  /** Start a ripple from script, in the slot element's own px. */
  poke(el, x, y) {
    this.#state.get(el)?.interaction.down({ x, y });
    this.#canvas.requestPaint();
    this.#watch();
  }

  // CSS can change --fx-progress at any time (a transition, :hover) and there
  // is no event for that, so while on screen, sample the parameters every
  // frame and ask for a paint only when one of them changed.
  #watch() {
    if (this.#raf || !this.#visible || !this.#host.isConnected) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      let signature = '';
      let moving = false;
      for (const el of this.#drawn) {
        if (!el.isConnected) continue;
        const s = this.#state.get(el);
        const p = readParams(el);
        const def = effects.get(this.effectFor(el));
        const i = s.interaction;
        if ((def?.animated && !reducedMotion.matches) || i.clicks.length || i.hover !== (i.pointer ? 1 : 0)) moving = true;
        signature += `${this.effectFor(el)}|${p.progress}|${p.amount}|${p.x},${p.y}|${i.pointer?.x},${i.pointer?.y};`;
      }
      if (moving || signature !== this.#signature) this.#canvas.requestPaint();
      this.#signature = signature;
      this.#watch();
    });
  }

  /** Called by <canvas-slot> from the canvas's paint event. */
  paint({ elements, renderer, event, dpr }) {
    if (!this.#ready) return;
    const backend = this.#backend;
    const canvas = this.#canvas;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    if (!backend.begin()) return;
    const changed = new Set(event?.changedElements ?? []);
    const time = effectTime();
    const drawn = [];
    let unit = 0; // measured once per frame, from the first slot drawn

    const draw = (name, x = 0, y = 0) => {
      const el = typeof name === 'string' ? elements.get(name) : name;
      if (!el) return;
      let s = this.#state.get(el);
      if (!s) this.#state.set(el, (s = { interaction: new Interaction(), first: true }));
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      Object.assign(s, { x, y, w, h });
      let t;
      try {
        t = backend.texture(el, s.first || changed.has(el), x, y, dpr);
        s.first = false;
      } catch (err) {
        // "No cached paint record": not painted yet; another paint is coming.
        if (/paint record/i.test(err?.message ?? '')) return canvas.requestPaint();
        throw err;
      }
      const params = readParams(el);
      const live = s.interaction.step();
      let effect = this.effectFor(el);
      if (!backend.has(effect)) {
        // WebGPU was chosen for the element, not asked for: use the GLSL on WebGL instead.
        if (!backend.strict) {
          if (!this.#left) queueMicrotask(() => this.#onfail(`the effect "${effect}" has no WGSL source`));
          this.#left = true;
          return;
        }
        this.error ??= new Error(`effect "${effect}" has no WGSL source for backend="webgpu"`);
        effect = 'none';
      }
      const def = effects.get(effect);
      const matrix = def.geometry?.({ width: w, height: h, pointer: s.interaction.pointer, hover: live.hover, ...params }) ?? null;
      const uniforms = {
        ...params,
        time,
        hover: live.hover,
        pointer: live.pointer,
        clicks: live.clicks,
        inv: inverseHomography(matrix),
        canvas: [width, height],
        origin: [x, y],
        texOrigin: t.origin ?? [0, 0],
        texSize: [t.width / dpr, t.height / dpr],
        size: [w, h],
      };
      try {
        backend.draw(el, effect, uniforms);
      } catch (err) {
        // The context went away mid-frame: the lost handler starts over on a fresh canvas.
        // Ask again shortly in case nothing else would repaint a still slot.
        if (/context lost/i.test(err.message)) return void setTimeout(() => canvas.isConnected && canvas.requestPaint(), 120);
        // A broken shader should not hide the slot: show it unshaded.
        if (this.error?.message !== err.message) console.warn(`effect "${effect}": ${err.message}`);
        this.error = err;
        backend.draw(el, 'none', uniforms);
      }
      // #region geometry
      // Tell the browser where the slot is now, so clicks, focus rings and
      // getBoundingClientRect() follow what was drawn.
      unit ||= geometryUnit(canvas, el, w);
      const place = new DOMMatrix().scale(unit).translate(x, y);
      canvas.updateElementGeometry(el, { canvasTransform: matrix ? place.multiply(matrix) : place });
      // #endregion geometry
      drawn.push(el);
    };

    renderer({ gl: backend.gl ?? null, device: backend.device ?? null, ctx: null, canvas, width, height, dpr, elements, draw, time: performance.now(), event });
    backend.end();
    this.#drawn = drawn;
    this.frames++;
    this.#watch();
  }

  /** RGBA of the pixel at (x, y) CSS px on the canvas, after the current frame. */
  pixel(x, y, dpr = this.#canvas.width / Math.max(1, this.#canvas.clientWidth)) {
    return this.#backend.pixel(Math.round(x * dpr), Math.round(y * dpr));
  }

  destroy() {
    cancelAnimationFrame(this.#raf);
    this.#raf = -1;
    this.#io.disconnect();
    this.#off();
    const host = this.#host;
    host.removeEventListener('pointermove', this.#onMove);
    host.removeEventListener('pointerdown', this.#onDown);
    host.removeEventListener('pointerleave', this.#onLeave);
    this.#backend.destroy();
  }
}
