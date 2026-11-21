// gpu-player.js: the /player-fx/ shader in WebGPU. One <video controls> gives
// two textures: its controls (the element, with the frame moved out of its box,
// through drawElementImageToTexture()) and its frame (copyExternalImageToTexture()).
// One WGSL fragment shader joins them. The boxes of the play button and the
// timeline are measured the same way as in WebGL: flat colours for one paint,
// read back once.
//
//   const player = createGpuPlayer(canvas, gpu);          // gpu from webgpu() in /shared/backend.js
//   const player = createGpuPlayer(canvas, gpu, { present: false });   // draws to a texture; read() copies it out

import { GPUCanvas, GPUElementTexture, uploadElement } from '/lib/gpu-util.js';
import { gpuVideoSource, readTexture } from '/gpu-video/compose.js';

export const GPU_EFFECTS = ['none', 'meld', 'glass', 'ripple', 'outlines'];
const PARTS = ['play', 'timeline', 'mute', 'fullscreen'];

// #region wgsl
export const WGSL = /* wgsl */ `
struct U {
  res: vec2f,        // target size in pixels
  px: f32,           // target pixels per CSS pixel
  time: f32,
  pulse: f32,        // seconds since the last play or pause
  progress: f32,     // currentTime / duration
  paused: f32,
  hasFrame: f32,
  effect: f32,
  pad0: f32, pad1: f32, pad2: f32,
  parts: array<vec4f, 4>,   // x0, y0, x1, y1 of play, timeline, mute, fullscreen. x1 < x0: not found
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var controls: texture_2d<f32>;
@group(0) @binding(3) var vid: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}

// The element texture has straight alpha. C() returns it premultiplied.
fn C(p: vec2f) -> vec4f { let c = textureSampleLevel(controls, smp, p, 0.0); return vec4f(c.rgb * c.a, c.a); }
fn F(p: vec2f) -> vec3f {
  if (u.hasFrame < 0.5) { return vec3f(0.06, 0.07, 0.09); }
  return textureSampleLevel(vid, smp, clamp(p, vec2f(0), vec2f(1)), 0.0).rgb;
}
fn found(r: vec4f) -> bool { return r.z > r.x; }
fn aspect() -> vec2f { return vec2f(u.res.x / u.res.y, 1.0); }
fn over(under: vec3f, top: vec4f) -> vec3f { return under * (1.0 - top.a) + top.rgb; }
// Alpha of the controls, blurred over r CSS pixels: a height map of the controls.
fn soft(p: vec2f, r: f32) -> f32 {
  let s = r * u.px / u.res;
  var a = C(p).a * 2.0;
  for (var i = 0; i < 8; i++) {
    let t = f32(i) * 0.7854;
    let d = vec2f(cos(t), sin(t)) * s;
    a += C(p + d).a + C(p + d * 0.5).a;
  }
  return a / 18.0;
}
// Distance to a part's box in units of the target height. Negative inside.
fn box(p: vec2f, r: vec4f) -> f32 {
  let d = abs((p - (r.xy + r.zw) * 0.5) * aspect()) - (r.zw - r.xy) * 0.5 * aspect();
  return length(max(d, vec2f(0))) + min(max(d.x, d.y), 0.0);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.res;
  let c = C(uv);
  var col = F(uv);
  // 1 while paused, 0 while playing, eased over 0.6 s after each play or pause.
  let t = smoothstep(0.0, 0.6, u.pulse);
  let k = select(1.0 - t, t, u.paused > 0.5);

  if (u.effect == 1.0) {
    // Meld. The glyph of the play button is read from its measured box and drawn again, large,
    // as a lens in the middle of the frame. On play it shrinks back into the button.
    let r = u.parts[0];
    if (found(r)) {
      let home = (r.xy + r.zw) * 0.5;
      let small = (r.w - r.y) * 0.5;
      let centre = mix(home, vec2f(0.5, 0.46), k);
      let reach = mix(small * 0.3, 0.34, k);
      let d = (uv - centre) * aspect() / reach;
      let src = home + d * small * 0.3 / aspect();
      let inside = step(max(abs(d.x), abs(d.y)), 1.0);
      let g = smoothstep(0.35, 0.6, C(src).a) * inside * smoothstep(0.02, 0.2, k);
      let dist = length((uv - centre) * aspect());
      let ring = sin(dist * 40.0 - u.pulse * 14.0) * exp(-dist * 3.0) * max(0.0, 1.0 - u.pulse / 1.2);
      col = F(uv + normalize(uv - centre + vec2f(1e-5)) * ring * 0.02) * (1.0 - 0.45 * k);
      let lens = centre + (uv - centre) * 0.72;
      let inner = vec3f(F(lens + vec2f(0.006, 0.0)).r, F(lens).g, F(lens - vec2f(0.006, 0.0)).b) * 1.35 + 0.08;
      col = mix(col, inner, g) + g * (1.0 - g) * 4.0 * 0.55;
    }
    col = over(col, c);
  } else if (u.effect == 2.0) {
    // Glass. Each control is a lens: the frame is looked up along the slope of the blurred alpha of the controls.
    let e = 2.0 * u.px / u.res;
    let h = soft(uv, 7.0);
    let g = vec2f(soft(uv + vec2f(e.x, 0.0), 7.0) - soft(uv - vec2f(e.x, 0.0), 7.0), soft(uv + vec2f(0.0, e.y), 7.0) - soft(uv - vec2f(0.0, e.y), 7.0));
    let through = F(uv - g / aspect() * 0.22) * (1.0 + 0.5 * h);
    col = mix(col, through, smoothstep(0.02, 0.2, h));
    let n = normalize(vec3f(-g * 9.0, 1.0));
    col += pow(clamp(dot(n, normalize(vec3f(-0.4, -0.6, 0.7))), 0.0, 1.0), 24.0) * 0.9 * step(0.02, h);
    col = mix(col, vec3f(1.0), c.a * 0.3);
  } else if (u.effect == 3.0) {
    // Ripple. A wave leaves the centre of the play button when playback starts or stops.
    let r = u.parts[0];
    let centre = select(vec2f(0.06, 0.9), (r.xy + r.zw) * 0.5, found(r));
    let d = (uv - centre) * aspect();
    let dist = length(d);
    let front = u.pulse * 0.9;
    let w = sin((dist - front) * 36.0) * exp(-abs(dist - front) * 5.0) * max(0.0, 1.0 - u.pulse / 2.4);
    col = F(uv + normalize(d + vec2f(1e-5)) / aspect() * w * 0.06) * (1.0 + w * 0.8);
    col = over(col, c);
  } else if (u.effect == 4.0) {
    // The measured boxes, outlined.
    col = over(col * 0.35, c);
    for (var i = 0; i < 4; i++) {
      if (!found(u.parts[i])) { continue; }
      let line = 1.0 - smoothstep(0.0, 2.0, abs(box(uv, u.parts[i])) * u.res.y / u.px);
      let tint = 0.5 + 0.5 * cos(6.2832 * (f32(i) / 4.0 + vec3f(0.0, 0.33, 0.67)));
      col = mix(col, tint, line);
    }
  } else {
    col = over(col, c);
  }
  return vec4f(col, 1.0);
}`;
// #endregion wgsl

export function createGpuPlayer(canvas, gpu, { present = true, onParts = () => {}, onProblem = () => {} } = {}) {
  const { device } = gpu;
  const layer = canvas.querySelector('.controls-layer'), video = layer.querySelector('video');
  const surface = new GPUCanvas(canvas, gpu, { present });
  const controls = new GPUElementTexture(device, canvas, layer);
  let probe = null; // the probe picture's own texture: it is copied out, so it needs COPY_SRC
  const frames = gpuVideoSource(device, { routes: ['copy'] });
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format: gpu.format }] } });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const blank = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const data = new Float32Array(28);
  for (let i = 0; i < 4; i++) data[12 + i * 4] = 1; // x1 < x0: not found

  const state = { effect: 1, parts: {}, toggledAt: -1e9, probing: false, probeWanted: true, frame: null, bitmapBusy: false, route: '', paints: 0, placed: '' };

  // #region gpu-upload
  function frameView() {
    if (video.readyState < 2) return state.frame;
    // The frame, from the same element. A copy into a texture; where that fails (the software adapter
    // of the test browser), createImageBitmap(video) and a copy of the bitmap.
    const got = frames.get(video);
    if (got) { state.route = 'copyExternalImageToTexture(video)'; state.frame = got.view; return got.view; }
    if (!state.bitmapBusy) {
      state.bitmapBusy = true;
      frames.getAsync(video).then((r) => {
        state.bitmapBusy = false;
        if (r) { state.frame = r.view; state.route = 'createImageBitmap(video), then copyExternalImageToTexture(bitmap)'; } else onProblem(`No route gave the video frame: ${JSON.stringify(frames.errors)}`);
      });
    }
    return state.frame;
  }
  // #endregion gpu-upload

  // #region gpu-measure
  // The probe picture has a flat colour on each part. It is copied out of its texture once.
  async function measure() {
    const img = await readTexture(device, probe);
    const { data: px, width: w, height: h } = img;
    const boxes = PARTS.map(() => [w, h, -1, -1, 0]);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
      if (px[i + 3] < 250) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if ((r > 12 && r < 243) || (g > 12 && g < 243) || (b > 12 && b < 243)) continue;
      const at = [-1, 0, 2, -1, 3, 1, -1, -1][(r > 128 ? 4 : 0) | (g > 128 ? 2 : 0) | (b > 128 ? 1 : 0)]; // blue: play, magenta: timeline, green: mute, red: fullscreen
      if (at < 0) continue;
      const bx = boxes[at];
      if (x < bx[0]) bx[0] = x;
      if (y < bx[1]) bx[1] = y;
      if (x > bx[2]) bx[2] = x;
      if (y > bx[3]) bx[3] = y;
      bx[4]++;
    }
    boxes.forEach((bx, i) => {
      if (bx[4] < 12) return;
      const r = [bx[0] / w, bx[1] / h, (bx[2] + 1) / w, (bx[3] + 1) / h];
      state.parts[PARTS[i]] = r;
      data.set(r, 12 + i * 4);
    });
    onParts(state.parts);
  }
  // #endregion gpu-measure

  // #region gpu-paint
  function paint() {
    if (gpu.lost) return;
    state.paints++;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; state.probeWanted = true; }
    const key = `${canvas.clientWidth}x${canvas.clientHeight}`;
    if (state.placed !== key) {
      // A WebGPU draw does not tell the browser where the element is. This does.
      state.placed = key;
      canvas.updateElementGeometry?.(layer, { canvasTransform: new DOMMatrix() });
      layer.toggleAttribute('data-placed');
    }
    if (state.probing) {
      state.probing = false;
      // This paint has the probe colours. They go into a texture that is read once and never drawn.
      const size = canvas.getElementImageDefaultSize(layer), pw = Math.max(1, Math.ceil(size.width)), ph = Math.max(1, Math.ceil(size.height));
      if (!probe || probe.width !== pw || probe.height !== ph) {
        probe?.destroy();
        probe = device.createTexture({ size: [pw, ph], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      }
      uploadElement(device, layer, probe);
      layer.classList.remove('probe');
      measure().catch((err) => onProblem(`The parts could not be measured: ${err.message}`));
    } else {
      controls.update();                   // drawElementImageToTexture(): the controls on a clear background
    }
    if (!controls.view) return;
    const frame = frameView();
    const now = performance.now();
    data.set([w, h, w / Math.max(1, canvas.clientWidth), (now / 1000) % 1000, Math.min(100, (now - state.toggledAt) / 1000),
      video.duration ? video.currentTime / video.duration : 0, video.paused ? 1 : 0, frame ? 1 : 0, state.effect], 0);
    device.queue.writeBuffer(uniforms, 0, data);
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: sampler }, { binding: 2, resource: controls.view }, { binding: 3, resource: frame ?? blank.createView() }],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.view(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    surface.shown((reason) => onProblem(`The WebGPU canvas shows nothing: ${reason}`));
  }
  // #endregion gpu-paint
  canvas.addEventListener('paint', paint);

  let onScreen = false, raf = 0;
  const tick = () => {
    raf = 0;
    if (!onScreen || gpu.lost) return;
    if (state.probeWanted && video.readyState >= 1 && !state.probing) { state.probeWanted = false; state.probing = true; layer.classList.add('probe'); }
    canvas.requestPaint();
    raf = requestAnimationFrame(tick);
  };
  const toggled = () => { state.toggledAt = performance.now(); setTimeout(() => (state.probeWanted = true), 350); };
  video.addEventListener('play', toggled);
  video.addEventListener('pause', toggled);
  for (const type of ['loadeddata', 'pointerdown', 'pointerenter']) video.addEventListener(type, () => setTimeout(() => (state.probeWanted = true), 350));

  return {
    video, layer, state, surface,
    start() { onScreen = true; if (!video.src && video.dataset.src) video.src = video.dataset.src; if (!raf) raf = requestAnimationFrame(tick); },
    idle() { onScreen = false; if (!video.paused) video.pause(); },
    /** The next frame as ImageData. Only with { present: false }. */
    async read() { await new Promise((r) => { canvas.addEventListener('paint', () => r(), { once: true }); canvas.requestPaint(); }); return surface.read(); },
    destroy() { onScreen = false; cancelAnimationFrame(raf); canvas.removeEventListener('paint', paint); controls.destroy(); probe?.destroy(); frames.destroy(); uniforms.destroy(); blank.destroy(); surface.destroy(); },
  };
}
