// WebGPU pieces shared by the elements in /lib/ that draw HTML through a
// shader. Which route a page uses (WebGPU, WebGL or 2D) is decided by
// /shared/backend.js; this file is what an element needs once the answer is
// WebGPU:
//
//   const gpu = await webgpu();                       // from /shared/backend.js
//   const surface = new GPUCanvas(canvas, gpu);       // the canvas, configured
//   const tex = new GPUElementTexture(gpu.device, canvas, element);
//   tex.update();                                     // element → GPUTexture
//   … one render pass into surface.view() …
//
// One device serves the whole page, so unlike WebGL (about 16 contexts a
// page) any number of elements can use it.

const Q = typeof GPUQueue !== 'undefined' ? GPUQueue.prototype : {};
/** The GPUQueue method this browser has for element → texture (the name has changed between Chromium versions). */
export const gpuMethod = 'drawElementImageToTexture' in Q ? 'drawElementImageToTexture' : 'copyElementImageToTexture' in Q ? 'copyElementImageToTexture' : null;

/** True when this browser can put an element straight into a GPUTexture. */
export const supportedGPU = typeof navigator !== 'undefined' && !!navigator.gpu && !!gpuMethod;

/** Put an element (or ElementImage) into a GPUTexture, whatever this build calls the method. */
export function uploadElement(device, source, texture) {
  if (gpuMethod === 'drawElementImageToTexture') device.queue.drawElementImageToTexture({ source }, { texture });
  else device.queue.copyElementImageToTexture({ source }, { destination: { texture } });
}

/** Premultiplied "over" blending for a colour target. */
export const BLEND_OVER = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };

/** A GPUTexture kept the size of a drawable element's picture. Row 0 is the element's top. */
export class GPUElementTexture {
  width = 0;
  height = 0;
  texture = null;
  view = null;
  constructor(device, canvas, element) {
    this.device = device;
    this.canvas = canvas;
    this.element = element;
  }
  /** Upload the element as it is drawn now. Throws "no cached paint record" until it has been painted once. */
  update() {
    const size = this.canvas.getElementImageDefaultSize(this.element);
    const w = Math.max(1, Math.ceil(size.width));
    const h = Math.max(1, Math.ceil(size.height));
    if (w !== this.width || h !== this.height) {
      this.texture?.destroy();
      this.texture = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.view = this.texture.createView();
      this.width = w;
      this.height = h;
    }
    uploadElement(this.device, this.element, this.texture);
  }
  destroy() {
    this.texture?.destroy();
    this.texture = this.view = null;
    this.width = this.height = 0;
  }
}

/**
 * A canvas drawn by the page's shared device. view() is where this frame
 * goes: the canvas, or with { present: false } a texture of the same size
 * that read() can copy out. Tests use that on machines whose WebGPU cannot
 * show a canvas (software adapters lose the device when they try).
 */
let probe = null;
/** True when a canvas has no visible pixel, read through a small copy (never getImageData() on the canvas itself). */
export function looksBlank(canvas) {
  probe ??= new OffscreenCanvas(24, 24).getContext('2d', { willReadFrequently: true });
  probe.clearRect(0, 0, 24, 24);
  probe.drawImage(canvas, 0, 0, 24, 24);
  const d = probe.getImageData(0, 0, 24, 24).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}

/**
 * A guard for the first frames a WebGPU canvas shows. Call the returned
 * function right after each frame's submit(): it looks at the first two
 * frames, and if both show nothing it calls onBlank(reason) once, so the
 * element can fall back to WebGL instead of leaving an empty box. A self-test
 * and an error scope cannot see a frame that validates and still shows nothing.
 */
export function blankWatch() {
  let frames = 0;
  let blank = 0;
  return (canvas, onBlank) => {
    if (frames >= 2) return;
    frames++;
    try {
      if (looksBlank(canvas)) blank++;
    } catch {
      frames = 2;
      return;
    }
    if (frames === 2 && blank === 2) queueMicrotask(() => onBlank('WebGPU showed an empty canvas'));
  };
}

export class GPUCanvas {
  #target = null;
  #watch = blankWatch();
  /** Call after a frame's submit(). See blankWatch(). Does nothing for { present: false }. */
  shown(onBlank) {
    if (this.present) this.#watch(this.canvas, onBlank);
  }
  constructor(canvas, gpu, { present = true } = {}) {
    this.canvas = canvas;
    this.gpu = gpu;
    this.device = gpu.device;
    this.format = gpu.format;
    this.present = present;
    // The canvas needs a WebGPU context for its children to be uploaded, even when nothing is shown on it.
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new Error('the canvas gave no WebGPU context');
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
  }
  get lost() {
    return !!this.gpu.lost;
  }
  view() {
    if (this.present) return this.context.getCurrentTexture().createView();
    const { width, height } = this.canvas;
    if (!this.#target || this.#target.width !== width || this.#target.height !== height) {
      this.#target?.destroy();
      this.#target = this.device.createTexture({ size: [width, height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    }
    return this.#target.createView();
  }
  /** The last frame as ImageData (premultiplied RGBA, top row first). Only with { present: false }. */
  async read() {
    const t = this.#target;
    if (!t) throw new Error('read() needs { present: false } and one drawn frame');
    const { device } = this;
    const { width, height } = t;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: t }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8ClampedArray(width * height * 4);
    const swap = this.format === 'bgra8unorm';
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
      if (!swap) out.set(row, y * width * 4);
      else for (let x = 0, o = y * width * 4; x < width * 4; x += 4, o += 4) { out[o] = row[x + 2]; out[o + 1] = row[x + 1]; out[o + 2] = row[x]; out[o + 3] = row[x + 3]; }
    }
    buffer.unmap();
    buffer.destroy();
    return new ImageData(out, width, height);
  }
  destroy() {
    this.#target?.destroy();
    this.#target = null;
    try {
      this.context.unconfigure();
    } catch {}
  }
}

/**
 * Run fn() (one frame's worth of WebGPU calls) now, and call onProblem with
 * the first validation error's first line if there was one. Elements wrap
 * their first frame in this, so a browser whose WebGPU rejects the element
 * upload falls back to WebGL with a reason instead of showing an empty box.
 * Anything fn() throws is thrown from here as usual.
 */
export function watchFrame(device, fn, onProblem) {
  device.pushErrorScope('validation');
  try {
    return fn();
  } finally {
    device.popErrorScope().then(
      (error) => error?.message && onProblem(error.message.split('\n')[0]),
      () => {},
    );
  }
}

/** Compile WGSL and throw the errors with their lines, the way a GLSL compile does. */
export async function checkWGSL(device, code, label = 'shader') {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(`${label} (WGSL): ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  return module;
}

/**
 * How far apart two pictures of the same thing are, for "WebGPU draws what
 * WebGL draws" checks. `straight` is ImageData read from a 2D canvas (straight
 * alpha), `premultiplied` is GPUCanvas.read(). Returns the mean and largest
 * difference per channel out of 255, and how much of the picture has ink.
 */
export function pictureDifference(straight, premultiplied) {
  if (straight.width !== premultiplied.width || straight.height !== premultiplied.height) {
    throw new Error(`the pictures differ in size: ${straight.width}×${straight.height} against ${premultiplied.width}×${premultiplied.height}`);
  }
  const a = straight.data;
  const b = premultiplied.data;
  let sum = 0;
  let max = 0;
  let ink = 0;
  for (let i = 0; i < a.length; i += 4) {
    const alpha = a[i + 3] / 255;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((c < 3 ? Math.round(a[i + c] * alpha) : a[i + 3]) - b[i + c]);
      sum += d;
      if (d > max) max = d;
    }
    if (b[i + 3] > 0) ink++;
  }
  return { mean: sum / a.length, max, ink: ink / (a.length / 4) };
}
