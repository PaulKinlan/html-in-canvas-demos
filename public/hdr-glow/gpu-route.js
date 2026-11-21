// gpu-route.js: the WebGPU route of /hdr-glow/.
//
// drawElementImageToTexture() stores at most 1.0 for a CSS colour above 1.0, so on this route the
// element is uploaded as an ordinary 8-bit picture and the shader raises chosen boxes of it. The
// target is an rgba16float canvas with extended tone mapping, which is where the values above 1.0 go.
//
//   const hdr = new HdrGpu(device);                       // target format rgba16float
//   const context = configureHdr(canvas, device);         // rgba16float, display-p3, extended
//   hdr.upload(canvas, element);                          // in a paint handler
//   hdr.draw(context.getCurrentTexture().createView(), { size, headroom, view, sweep, items });
//
// An item is { x, y, w, h, radius, r, g, b, gain, kind, halo } in CSS pixels of the element.
// kind 0 multiplies every pixel in the rounded box by gain. kind 1 multiplies only the pixels that
// are at full white, which is how the word in the white strip is raised.

export const MAX_ITEMS = 8;

// #region shader
export const WGSL = /* wgsl */ `
struct Item { box: vec4f, tint: vec4f, misc: vec4f }
struct U { size: vec2f, headroom: f32, view: f32, sweep: vec4f, items: array<Item, ${MAX_ITEMS}> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return V(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

// Distance to a rounded box, negative inside.
fn sd(p: vec2f, box: vec4f, r: f32) -> f32 {
  let half = box.zw * 0.5;
  let q = abs(p - (box.xy + half)) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment fn fs(in: V) -> @location(0) vec4f {
  var c = textureSample(tex, smp, in.uv);          // the element, at most 1.0, premultiplied
  let p = in.uv * u.size;
  let white = smoothstep(0.985, 1.0, min(c.r, min(c.g, c.b)));
  var halo = vec3f(0.0);
  for (var i = 0; i < i32(u.sweep.z); i++) {
    let it = u.items[i];
    let gain = it.tint.a;
    let d = sd(p, it.box, it.misc.x);
    if (d <= 0.0) {
      // Inside the box: multiply, so the result passes 1.0.
      let k = select(gain, mix(1.0, gain, white), it.misc.y > 0.5);
      c = vec4f(c.rgb * k, c.a);
    } else {
      halo += it.tint.rgb * gain * min(0.85, 0.25 * gain) * it.misc.z * exp(-d / (3.0 + 1.5 * gain)) * smoothstep(34.0, 6.0, d);
    }
  }
  c = vec4f(c.rgb + halo, min(1.0, c.a + max(halo.r, max(halo.g, halo.b))));
  // The band of light after a deploy: x position and peak gain.
  let band = (p.x - p.y * 0.35 - u.sweep.x) / 60.0;
  c = vec4f(c.rgb * (1.0 + (u.sweep.y - 1.0) * exp(-band * band)), c.a);

  if (u.view > 0.5 && u.view < 1.5) {              // exposed down: the headroom value lands on 1.0
    c = vec4f(c.rgb / max(u.headroom, 1.0), c.a);
  } else if (u.view > 1.5) {                       // map: colour by how far above 1.0, with no readback
    let v = max(c.r, max(c.g, c.b));
    if (v <= 1.004) {
      c = vec4f(vec3f(0.43 * dot(c.rgb, vec3f(0.25, 0.6, 0.15))), 1.0);
    } else {
      let t = min(1.0, (v - 1.0) / max(u.headroom - 1.0, 0.01));
      c = vec4f(1.0, select(0.235 - 0.47 * (t - 0.5), 0.863 - 1.255 * t, t < 0.5), select(1.57 * (t - 0.5), 0.0, t < 0.5), 1.0);
    }
  }
  return c;
}`;
// #endregion shader

// #region gpu-configure
/** Configure a canvas as an HDR target. Returns the context; getConfiguration() says what the browser kept. */
export function configureHdr(canvas, device) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('the canvas gave no WebGPU context');
  const base = { device, format: 'rgba16float', colorSpace: 'display-p3', alphaMode: 'premultiplied' };
  try { context.configure({ ...base, toneMapping: { mode: 'extended' } }); }
  catch { context.configure(base); }
  return context;
}
// #endregion gpu-configure

export class HdrGpu {
  #texture = null; #bind = null; #w = 0; #h = 0;
  constructor(device, format = 'rgba16float') {
    this.device = device;
    const module = device.createShaderModule({ code: WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.data = new Float32Array(8 + MAX_ITEMS * 12);
    this.buffer = device.createBuffer({ size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  // #region gpu-draw
  /** Copy the element's picture into an 8-bit texture. Throws until the element has been painted once. */
  upload(canvas, element) {
    const size = canvas.getElementImageDefaultSize(element);
    const w = Math.max(1, Math.ceil(size.width)), h = Math.max(1, Math.ceil(size.height));
    if (w !== this.#w || h !== this.#h) {
      this.#texture?.destroy();
      this.#texture = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.#bind = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.buffer } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.#texture.createView() }] });
      this.#w = w; this.#h = h;
    }
    this.device.queue.drawElementImageToTexture({ source: element }, { texture: this.#texture });
  }
  /** One pass into `target` (a view of an rgba16float texture). `view` is 0 as stored, 1 exposed down, 2 map. */
  draw(target, { size, headroom, view = 0, sweep = [-1e4, 1], items = [] }) {
    const d = this.data, n = Math.min(items.length, MAX_ITEMS);
    d.fill(0);
    d.set([size[0], size[1], headroom, view, sweep[0], sweep[1], n, 0]);
    items.slice(0, n).forEach((it, i) => d.set([it.x, it.y, it.w, it.h, it.r, it.g, it.b, it.gain, Math.min(it.radius, it.h / 2), it.kind ?? 0, it.halo ?? 0, 0], 8 + i * 12));
    this.device.queue.writeBuffer(this.buffer, 0, d);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.#bind); pass.draw(3); pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
  // #endregion gpu-draw
  destroy() { this.#texture?.destroy(); this.buffer.destroy(); this.#texture = this.#bind = null; }
}
