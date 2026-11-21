// One shader that takes a video frame and two HTML cards as separate textures.
// Used by /gpu-video/ for the visible demo, its live checks and its measurement.
//
//   WebGPU   gpuVideoSource(device).get(video)      the frame: importExternalTexture(), else copyExternalImageToTexture()
//            GPUElementTexture (lib/gpu-util.js)     each card: drawElementImageToTexture()
//            gpuComposer(device, format).frame(...)  one render pass
//   WebGL 2  glComposer(gl)                          texImage2D(video), texElementSubImage2D(), one draw
//   2D       draw2d(ctx, ...)                        drawImage(video), drawElementImage()
//
// The same uniform block (uniforms()) drives the WGSL and the GLSL shader.

export const EFFECTS = { plain: -1, glass: 0, text: 1, ripple: 2 };

/** The 20 floats both shaders read. Rects are [x0, y0, x1, y1] as fractions of the canvas, y down. */
export function uniforms({ width, height, videoWidth = 16, videoHeight = 9, rects = [], effect = 0, time = 0, tap = [0.5, 0.5], age = 99, radius = 12 }) {
  const u = new Float32Array(20);
  const canvasAspect = width / height, videoAspect = (videoWidth || 16) / (videoHeight || 9);
  u[0] = width; u[1] = height;
  // object-fit: cover. The part of the frame that the canvas shows, as a scale about the centre.
  u[2] = canvasAspect < videoAspect ? canvasAspect / videoAspect : 1;
  u[3] = canvasAspect < videoAspect ? 1 : videoAspect / canvasAspect;
  u[4] = tap[0]; u[5] = tap[1]; u[6] = time; u[7] = age;
  u.set(rects[0] ?? [0, 0, 0, 0], 8);
  u.set(rects[1] ?? [0, 0, 0, 0], 12);
  u[16] = effect; u[17] = radius;
  return u;
}

// #region place
// A child of a layoutsubtree canvas is not moved by left and top: its box starts at the canvas origin
// until a draw call or updateElementGeometry() says where it is. So the page keeps each card's position itself.
const positions = new WeakMap();
/** Say where a card is drawn, in CSS pixels from the canvas's top left corner. */
export function moveTo(el, x, y) {
  positions.set(el, [x, y]);
}
/** Where a card is drawn, as [x0, y0, x1, y1] fractions of the canvas box. */
export function rectOf(canvas, el) {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  const [x, y] = positions.get(el) ?? [0, 0];
  return [x / w, y / h, (x + el.offsetWidth) / w, (y + el.offsetHeight) / h];
}
/**
 * A WebGL or WebGPU draw does not tell the browser where an element was drawn. This does.
 * canvasTransform starts at the canvas origin and is in CSS pixels.
 */
export function place(canvas, el) {
  const [x, y] = positions.get(el) ?? [0, 0];
  canvas.updateElementGeometry?.(el, { canvasTransform: new DOMMatrix().translate(x, y) });
  el.toggleAttribute('data-moved'); // Chromium 157 keeps old hit-test answers until an attribute changes
}
// #endregion place

// #region wgsl
// VIDEO_TYPE and VIDEO_SAMPLE are replaced: texture_external with textureSampleBaseClampToEdge(),
// or texture_2d<f32> with textureSampleLevel() when the frame was copied into an ordinary texture.
const WGSL = /* wgsl */ `
struct U { res: vec2f, fit: vec2f, tap: vec2f, time: f32, age: f32, rectA: vec4f, rectB: vec4f, effect: f32, radius: f32, pad: vec2f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var cardA: texture_2d<f32>;
@group(0) @binding(3) var cardB: texture_2d<f32>;
@group(0) @binding(4) var vid: VIDEO_TYPE;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}

fn frame(uv: vec2f) -> vec3f {
  let v = clamp((uv - 0.5) * u.fit + 0.5, vec2f(0), vec2f(1));
  return VIDEO_SAMPLE.rgb;
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
// Signed distance in pixels to a rounded box given as a rect in canvas fractions.
fn box(p: vec2f, r: vec4f) -> f32 {
  let lo = r.xy * u.res;
  let hi = r.zw * u.res;
  let q = abs(p - (lo + hi) * 0.5) - ((hi - lo) * 0.5 - u.radius);
  return length(max(q, vec2f(0))) + min(max(q.x, q.y), 0.0) - u.radius;
}
// One card over the picture so far. uv is the pixel, w is the pixel after the ripple moved it.
fn card(base: vec3f, uv: vec2f, w: vec2f, r: vec4f, tex: texture_2d<f32>) -> vec3f {
  let p = uv * u.res;
  let d = box(p, r);
  if (r.z <= r.x || d > 0.0) { return base; }
  let cuv = (w - r.xy) / (r.zw - r.xy);
  var c = textureSampleLevel(tex, smp, cuv, 0.0);
  c = vec4f(c.rgb * c.a, c.a); // the element texture has straight alpha (measured: rgb(200 100 50 / .5) is stored as 199, 100, 50)
  if (cuv.x < 0.0 || cuv.y < 0.0 || cuv.x > 1.0 || cuv.y > 1.0) { c = vec4f(0); }
  if (u.effect < 0.0) { return base * (1.0 - c.a) + c.rgb; } // plain: the card over the frame
  // Glass: the frame behind the card, magnified about the card's centre, bent outwards near the border and blurred.
  let g = normalize(vec2f(box(p + vec2f(1, 0), r) - box(p - vec2f(1, 0), r), box(p + vec2f(0, 1), r) - box(p - vec2f(0, 1), r)) + vec2f(1e-5));
  let side = (r.zw - r.xy) * u.res;
  let edge = smoothstep(-min(0.11 * u.res.y, 0.3 * min(side.x, side.y)), 0.0, d); // 0 in the middle of the card, 1 at its border
  let thin = vec2f(u.res.y / u.res.x, 1.0);
  let centre = (r.xy + r.zw) * 0.5;
  let bent = centre + (w - centre) * 0.86 - g * edge * edge * 0.05 * thin;
  var sum = frame(bent) * 2.0;
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 0.7854;
    sum += frame(bent + vec2f(cos(a), sin(a)) * thin * 0.018);
  }
  // The border is lit by the brightness of the frame under it.
  let glass = mix(sum / 10.0, vec3f(0.08, 0.12, 0.2), 0.28) + pow(edge, 5.0) * (0.25 + luma(frame(w))) * vec3f(0.9, 0.95, 1.0);
  if (u.effect == 1.0) {
    // The card's ink is a window: text and controls are filled with the frame, its channels rotated, on dark glass.
    let through = clamp(frame(centre + (w - centre) * 0.5).gbr * 1.5 + 0.2, vec3f(0), vec3f(1));
    return mix(glass * 0.3, through, c.a);
  }
  return glass * (1.0 - c.a) + c.rgb;
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.res;
  var w = uv;
  var wave = 0.0;
  if (u.effect == 2.0) {
    // A ring that leaves the tapped point and bends the frame and the cards.
    let wide = vec2f(u.res.x / u.res.y, 1.0);
    let dv = (uv - u.tap) * wide;
    let dist = length(dv);
    wave = sin(dist * 46.0 - u.age * 9.0) * exp(-dist * 2.5) * exp(-u.age * 0.9) * smoothstep(0.0, 0.1, u.age * 0.7 - dist + 0.1);
    w = uv + normalize(dv + vec2f(1e-5)) / wide * wave * 0.035;
  }
  var col = frame(w);
  col = card(col, uv, w, u.rectA, cardA);
  col = card(col, uv, w, u.rectB, cardB);
  return vec4f(col + wave * 0.35, 1.0);
}`;
// #endregion wgsl

const VARIANTS = {
  external: (code) => code.replace('VIDEO_TYPE', 'texture_external').replace('VIDEO_SAMPLE', 'textureSampleBaseClampToEdge(vid, smp, v)'),
  '2d': (code) => code.replace('VIDEO_TYPE', 'texture_2d<f32>').replace('VIDEO_SAMPLE', 'textureSampleLevel(vid, smp, v, 0.0)'),
};
export const wgsl = (variant) => VARIANTS[variant](WGSL);

const firstLine = (err) => String(err?.message ?? err).replace(/^Failed to execute '\w+' on '\w+': /, '').split('\n')[0];

// #region gpu-video
/**
 * The current frame of a <video> for a WebGPU pass. The routes are tried in order and the first one that works is kept:
 *   'external'  device.importExternalTexture({ source: video }): no copy, sampled as texture_external, valid for this task only
 *   'copy'      queue.copyExternalImageToTexture({ source: video }, …): a copy into an rgba8unorm texture
 * get() returns { kind, external } or { kind, view }, or null when no route works (errors says why).
 * getAsync() adds a third route for checks: createImageBitmap(video), then copyExternalImageToTexture(bitmap).
 */
export function gpuVideoSource(device, { routes = ['external', 'copy'] } = {}) {
  let texture = null, kind = null;
  const errors = {};
  const sized = (w, h) => {
    if (!texture || texture.width !== w || texture.height !== h) {
      texture?.destroy();
      texture = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    }
    return texture;
  };
  const tryRoute = (route, source) => {
    if (route === 'external') return { kind: 'external', external: device.importExternalTexture({ source }) };
    const w = source.videoWidth ?? source.displayWidth ?? source.width, h = source.videoHeight ?? source.displayHeight ?? source.height;
    device.queue.copyExternalImageToTexture({ source }, { texture: sized(w, h) }, [w, h]);
    return { kind: route, view: texture.createView() };
  };
  const get = (video) => {
    for (const route of kind ? [kind] : routes) {
      try {
        const got = tryRoute(route, video);
        kind = route;
        return got;
      } catch (err) {
        errors[route] = firstLine(err);
      }
    }
    return null;
  };
  return {
    get, errors,
    get kind() { return kind; },
    async getAsync(video) {
      const got = get(video);
      if (got) return got;
      try {
        const bitmap = await createImageBitmap(video);
        const out = tryRoute('bitmap', bitmap);
        bitmap.close();
        return out;
      } catch (err) {
        errors.bitmap = firstLine(err);
        return null;
      }
    },
    destroy() { texture?.destroy(); texture = null; },
  };
}
// #endregion gpu-video

// #region gpu-frame
/** The render pass. One pipeline per kind of video binding, made when first used. */
export function gpuComposer(device, format) {
  const pipelines = {};
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const buffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const blank = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const blankView = blank.createView();
  const pipeline = (variant) => (pipelines[variant] ??= (() => {
    const module = device.createShaderModule({ code: wgsl(variant) });
    return device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format }] } });
  })());
  return {
    blankView,
    /**
     * Draw one frame into `target` (a GPUTextureView).
     * `video` is what gpuVideoSource().get() returned, `cards` are up to two GPUTextureViews of drawn elements.
     */
    frame({ target, video, cards = [], uniforms, timestampWrites }) {
      const pipe = pipeline(video?.kind === 'external' ? 'external' : '2d');
      device.queue.writeBuffer(buffer, 0, uniforms);
      // An external texture cannot be kept, so the bind group is made again for each frame.
      const group = device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: cards[0] ?? blankView },
          { binding: 3, resource: cards[1] ?? blankView },
          { binding: 4, resource: video ? (video.external ?? video.view) : blankView },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], ...(timestampWrites ? { timestampWrites } : {}) });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() { buffer.destroy(); blank.destroy(); },
  };
}
// #endregion gpu-frame

/** Copy an rgba8unorm or bgra8unorm texture out as ImageData (top row first, RGBA). */
export async function readTexture(device, texture) {
  const { width, height } = texture;
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const raw = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8ClampedArray(width * height * 4);
  const swap = texture.format === 'bgra8unorm';
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
    if (!swap) out.set(row, y * width * 4);
    else for (let x = 0, o = y * width * 4; x < width * 4; x += 4, o += 4) { out[o] = row[x + 2]; out[o + 1] = row[x + 1]; out[o + 2] = row[x]; out[o + 3] = row[x + 3]; }
  }
  buffer.unmap();
  buffer.destroy();
  return new ImageData(out, width, height);
}

// #region glsl
const VERT = `#version 300 es
void main() { vec2 p = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.))[gl_VertexID]; gl_Position = vec4(p, 0., 1.); }`;
// The same picture as the WGSL above. Both textures have their top row first, so uv has y down.
const FRAG = `#version 300 es
precision highp float;
uniform vec2 res, fit, tap;
uniform float time, age, effect, radius;
uniform vec4 rectA, rectB;
uniform sampler2D vid, cardA, cardB;
out vec4 outColor;

vec3 frame(vec2 uv) { return texture(vid, clamp((uv - 0.5) * fit + 0.5, 0., 1.)).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float box(vec2 p, vec4 r) {
  vec2 lo = r.xy * res, hi = r.zw * res;
  vec2 q = abs(p - (lo + hi) * 0.5) - ((hi - lo) * 0.5 - radius);
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - radius;
}
vec3 card(vec3 base, vec2 uv, vec2 w, vec4 r, sampler2D tex) {
  vec2 p = uv * res;
  float d = box(p, r);
  if (r.z <= r.x || d > 0.) return base;
  vec2 cuv = (w - r.xy) / (r.zw - r.xy);
  vec4 c = textureLod(tex, cuv, 0.);
  c.rgb *= c.a; // straight alpha in the texture
  if (cuv.x < 0. || cuv.y < 0. || cuv.x > 1. || cuv.y > 1.) c = vec4(0.);
  if (effect < 0.) return base * (1. - c.a) + c.rgb;
  vec2 g = normalize(vec2(box(p + vec2(1., 0.), r) - box(p - vec2(1., 0.), r), box(p + vec2(0., 1.), r) - box(p - vec2(0., 1.), r)) + 1e-5);
  vec2 side = (r.zw - r.xy) * res;
  float edge = smoothstep(-min(0.11 * res.y, 0.3 * min(side.x, side.y)), 0., d);
  vec2 thin = vec2(res.y / res.x, 1.);
  vec2 centre = (r.xy + r.zw) * 0.5;
  vec2 bent = centre + (w - centre) * 0.86 - g * edge * edge * 0.05 * thin;
  vec3 sum = frame(bent) * 2.;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7854;
    sum += frame(bent + vec2(cos(a), sin(a)) * thin * 0.018);
  }
  vec3 glass = mix(sum / 10., vec3(0.08, 0.12, 0.2), 0.28) + pow(edge, 5.) * (0.25 + luma(frame(w))) * vec3(0.9, 0.95, 1.);
  if (effect == 1.) {
    vec3 through = clamp(frame(centre + (w - centre) * 0.5).gbr * 1.5 + 0.2, 0., 1.);
    return mix(glass * 0.3, through, c.a);
  }
  return glass * (1. - c.a) + c.rgb;
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / res;
  vec2 w = uv;
  float wave = 0.;
  if (effect == 2.) {
    vec2 wide = vec2(res.x / res.y, 1.);
    vec2 dv = (uv - tap) * wide;
    float dist = length(dv);
    wave = sin(dist * 46. - age * 9.) * exp(-dist * 2.5) * exp(-age * 0.9) * smoothstep(0., 0.1, age * 0.7 - dist + 0.1);
    w = uv + normalize(dv + 1e-5) / wide * wave * 0.035;
  }
  vec3 col = frame(w);
  col = card(col, uv, w, rectA, cardA);
  col = card(col, uv, w, rectB, cardB);
  outColor = vec4(col + wave * 0.35, 1.);
}`;
// #endregion glsl

// #region gl-frame
/** The WebGL 2 route: texImage2D(video) for the frame, texElementSubImage2D() for each card, one draw. */
export function glComposer(gl) {
  if (!('texElementSubImage2D' in gl)) throw new Error('this WebGL context has no texElementSubImage2D()');
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`the shader did not compile: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`the program did not link: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  const U = (name) => gl.getUniformLocation(program, name);
  const makeTexture = (unit, name) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.uniform1i(U(name), unit);
    return { t, unit, w: 1, h: 1 };
  };
  const vid = makeTexture(0, 'vid'), cards = [makeTexture(1, 'cardA'), makeTexture(2, 'cardB')];
  const loc = Object.fromEntries(['res', 'fit', 'tap', 'time', 'age', 'effect', 'radius', 'rectA', 'rectB'].map((n) => [n, U(n)]));
  return {
    /** The frame. Returns false until the video has one. */
    video(video) {
      if (video.readyState < 2) return false;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vid.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      return true;
    },
    /** Card 0 or 1. The texture has the size the browser paints the element at. */
    element(index, canvas, el) {
      const card = cards[index];
      const want = canvas.getElementImageDefaultSize(el);
      const w = Math.max(1, Math.ceil(want.width)), h = Math.max(1, Math.ceil(want.height));
      gl.activeTexture(gl.TEXTURE0 + card.unit);
      gl.bindTexture(gl.TEXTURE_2D, card.t);
      if (card.w !== w || card.h !== h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        card.w = w; card.h = h;
      }
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, el);
      return [w, h];
    },
    draw(u) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(loc.res, u[0], u[1]); gl.uniform2f(loc.fit, u[2], u[3]); gl.uniform2f(loc.tap, u[4], u[5]);
      gl.uniform1f(loc.time, u[6]); gl.uniform1f(loc.age, u[7]);
      gl.uniform4f(loc.rectA, u[8], u[9], u[10], u[11]); gl.uniform4f(loc.rectB, u[12], u[13], u[14], u[15]);
      gl.uniform1f(loc.effect, u[16]); gl.uniform1f(loc.radius, u[17]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
// #endregion gl-frame

// #region draw2d
/**
 * The 2D route. No shader, so glass is a clipped, magnified, blurred second drawImage(video),
 * and the text effect uses compositing: 'source-in' keeps the frame only where a card has ink.
 * The ripple has no 2D form and is drawn as glass.
 */
export function draw2d(ctx, { video, cards, effect, fit, radius = 12 }) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const frame = (zoom = 1, cx = W / 2, cy = H / 2) => {
    if (video.readyState < 2) return;
    const w = (W / fit[0]) * zoom, h = (H / fit[1]) * zoom; // the whole frame, larger than the canvas where it is cropped
    ctx.drawImage(video, cx - (cx - (W - W / fit[0]) / 2) * zoom, cy - (cy - (H - H / fit[1]) / 2) * zoom, w, h);
  };
  const boxes = cards.map(({ el, rect }) => ({ el, x: rect[0] * W, y: rect[1] * H, w: (rect[2] - rect[0]) * W, h: (rect[3] - rect[1]) * H }));
  const clip = (b) => { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, radius); ctx.clip(); };
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, W, H);
  if (effect === EFFECTS.text) {
    // Cards first, on a clear canvas. Then the frame only where they have ink, then dark glass and the frame behind.
    for (const b of boxes) ctx.drawElementImage(b.el, b.x, b.y, b.w, b.h);
    for (const b of boxes) {
      ctx.save(); clip(b);
      ctx.globalCompositeOperation = 'source-in';
      ctx.filter = 'hue-rotate(120deg) brightness(1.6)';
      frame(2, b.x + b.w / 2, b.y + b.h / 2);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.filter = 'blur(6px) brightness(0.3)';
      frame(1.16, b.x + b.w / 2, b.y + b.h / 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'destination-over';
    frame();
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  frame();
  for (const b of boxes) {
    if (effect !== EFFECTS.plain) {
      ctx.save(); clip(b);
      ctx.filter = 'blur(6px) brightness(0.8)';
      frame(1.16, b.x + b.w / 2, b.y + b.h / 2);
      ctx.filter = 'none';
      ctx.strokeStyle = 'rgb(255 255 255 / .55)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, radius); ctx.stroke();
      ctx.restore();
    }
    // With a destination size the element's hit-test region is set by this call.
    ctx.drawElementImage(b.el, b.x, b.y, b.w, b.h);
  }
}
// #endregion draw2d

/** The frame number in the clip's corner: 16 stripes across the right half of the top edge, lowest bit first. `data` is RGBA, `width` wide. */
export function frameNumber(data, width, y = Math.round(width / 80)) {
  const stripe = width / 32;
  let n = 0;
  for (let i = 0; i < 16; i++) if (data[(y * width + Math.floor(width / 2 + (i + 0.5) * stripe)) * 4] > 128) n |= 1 << i;
  return n;
}
