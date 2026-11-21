// "Measure on this device" for /gpu-video/, and the fixture its live checks share.
//
// For each route the browser has, the same 320 by 180 CSS pixel picture is drawn N times,
// one draw per video frame, and three things are timed:
//   calls   CPU time inside the upload calls and the draw or submit
//   done    CPU time from the first upload until the GPU says the work is finished
//           (WebGPU: queue.onSubmittedWorkDone(); WebGL: a one pixel readPixels())
//   pass    GPU time of the render pass, from a 'timestamp-query' query set, when the adapter has the feature
// Nothing is presented: WebGPU and WebGL draw into textures, so a software adapter can run it too.

import { webgpu, webgl2 } from '/shared/backend.js';
import { supported } from '/shared/support.js';
import { GPUElementTexture, gpuMethod } from '/lib/gpu-util.js';
import { EFFECTS, uniforms, rectOf, moveTo, gpuComposer, gpuVideoSource, glComposer, draw2d } from './compose.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (err) => String(err?.message ?? err).replace(/^Failed to execute '\w+' on '\w+': /, '').split('\n')[0];

/**
 * A canvas of 320 by 180 CSS pixels with three drawable children:
 *   .whole  the clip with a magenta label over it (the video as a child of the drawn element)
 *   .card   a flat green card with a button, drawn at 200,100, 100 by 60
 *   .tag    a half transparent blue box, drawn at 10,60, 60 by 30
 * The caller appends it to something that is on screen and asks for a context.
 */
export function buildFixture(clipUrl) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = 320; canvas.height = 180;
  canvas.style.cssText = 'position:relative;width:320px;height:180px;flex:none';
  canvas.innerHTML = `<div class="whole" drawable style="position:absolute;left:0;top:0;width:320px;height:180px;overflow:hidden;background:#fff">
      <video muted playsinline loop preload="auto" style="display:block;width:320px;height:180px"></video>
      <div style="position:absolute;left:8px;top:140px;width:60px;height:30px;background:#ff00ff"></div>
    </div>
    <div class="card" drawable style="position:absolute;left:0;top:0;width:100px;height:60px;background:#00c853">
      <button type="button" style="position:absolute;left:10px;top:5px;width:80px;height:50px;font:16px system-ui">Vote</button>
    </div>
    <div class="tag" drawable style="position:absolute;left:0;top:0;width:60px;height:30px;background:rgb(0 0 255 / .5)"></div>`;
  const video = canvas.querySelector('video');
  video.src = clipUrl;
  const f = { canvas, video, whole: canvas.querySelector('.whole'), card: canvas.querySelector('.card'), tag: canvas.querySelector('.tag'), button: canvas.querySelector('button') };
  // left and top do not move a canvas child, so the positions are kept by compose.js and given to each draw.
  moveTo(f.card, 200, 100);
  moveTo(f.tag, 10, 60);
  return f;
}

/** Resolve inside the next `paint` of the canvas, after running fn there. Rejects with what fn threw. */
export function inPaint(canvas, fn = () => {}, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the canvas got no paint event')), ms);
    canvas.addEventListener('paint', () => {
      clearTimeout(timer);
      try { resolve(fn()); } catch (err) { reject(err); }
    }, { once: true });
    canvas.requestPaint();
  });
}

/** Resolve with the metadata of the next presented frame of a playing video. */
export function nextFrame(video, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(video.error ? `the video did not play: ${video.error.message}` : 'the video presented no frame')), ms);
    video.requestVideoFrameCallback((now, meta) => { clearTimeout(timer); resolve(meta); });
  });
}

export function releaseVideo(video) {
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN);
const ms = (n) => (Number.isFinite(n) ? `${n.toFixed(2)} ms` : 'no number');

async function timed(frames, fixture, work, after, before) {
  const calls = [], done = [];
  for (let i = 0; i < frames; i++) {
    await nextFrame(fixture.video);
    let early = 0;
    if (before) { const t = performance.now(); await before(i); early = performance.now() - t; } // a step that cannot run inside the paint handler
    let t0 = 0;
    await inPaint(fixture.canvas, () => {
      t0 = performance.now();
      work(i);
      calls.push(performance.now() - t0 + early);
    });
    if (after) { await after(i); done.push(performance.now() - t0 + early); }
  }
  return { calls: mean(calls), done: mean(done) };
}

// #region measure-gpu
/** WebGPU: five ways to get the frame and the card into one pass. Every mode draws with the plain effect, so the passes cost the same. */
async function measureGPU(stage, clipUrl, frames, say) {
  const rows = [];
  let gpu = await webgpu();
  let label = 'WebGPU';
  if (!gpu && /software/.test(webgpu.reason)) {
    // Nothing here is presented, so the software adapter that the visible demo refuses can be measured.
    gpu = await webgpu({ force: true });
    label = 'WebGPU, software adapter';
  }
  if (!gpu) return [{ route: 'WebGPU', what: 'not run', result: webgpu.reason || 'no device' }];
  if (!gpuMethod) return [{ route: label, what: 'not run', result: 'GPUQueue has no drawElementImageToTexture()' }];

  // A second device for the timing, with timestamp queries when the adapter has them. The page's shared device is made without features.
  let device = gpu.device, own = null, stamps = false;
  try {
    const adapter = await navigator.gpu.requestAdapter(gpu.software ? {} : { powerPreference: 'high-performance' });
    if (adapter?.features.has('timestamp-query')) {
      own = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
      device = own;
      stamps = true;
    }
  } catch {}

  const f = buildFixture(clipUrl);
  f.canvas.width = 640; f.canvas.height = 360; // the same buffer on every route, so the element textures have the same size
  stage.append(f.canvas);
  const context = f.canvas.getContext('webgpu');
  context.configure({ device, format: gpu.format, alphaMode: 'premultiplied' });
  const composer = gpuComposer(device, 'rgba8unorm');
  const target = device.createTexture({ size: [640, 360], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const view = target.createView();
  const whole = new GPUElementTexture(device, f.canvas, f.whole), card = new GPUElementTexture(device, f.canvas, f.card);
  const querySet = stamps ? device.createQuerySet({ type: 'timestamp', count: frames * 2 }) : null;
  const resolveBuffer = stamps ? device.createBuffer({ size: frames * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const readBuffer = stamps ? device.createBuffer({ size: frames * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
  const u = (rects) => uniforms({ width: 640, height: 360, videoWidth: 640, videoHeight: 360, rects, effect: EFFECTS.plain, radius: 0 });
  try {
    await f.video.play();
    await nextFrame(f.video);
    await inPaint(f.canvas);
    const cardRect = rectOf(f.canvas, f.card);
    const modes = [
      { what: 'importExternalTexture(video) + card texture, both every frame', source: gpuVideoSource(device, { routes: ['external'] }), cardEvery: true },
      { what: 'importExternalTexture(video) every frame, card texture uploaded once', source: gpuVideoSource(device, { routes: ['external'] }), cardEvery: false },
      { what: 'video inside the element: one drawElementImageToTexture()', source: null },
      { what: 'copyExternalImageToTexture(video) + card texture, both every frame', source: gpuVideoSource(device, { routes: ['copy'] }), cardEvery: true },
      { what: 'createImageBitmap(video), copyExternalImageToTexture(bitmap) + card texture, both every frame', source: gpuVideoSource(device, { routes: ['bitmap'] }), cardEvery: true, bitmap: true },
    ];
    let bitmap = null;
    for (const mode of modes) {
      say(`${label}: ${mode.what}`);
      try {
        device.pushErrorScope('validation');
        if (mode.source && !mode.cardEvery) await inPaint(f.canvas, () => card.update());
        const t = await timed(frames, f, (i) => {
          const timestampWrites = stamps ? { querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } : undefined;
          if (mode.source) {
            const video = mode.source.get(mode.bitmap ? bitmap : f.video);
            bitmap?.close();
            bitmap = null;
            if (!video) throw new Error(Object.values(mode.source.errors)[0] ?? 'no frame');
            if (mode.cardEvery) card.update();
            composer.frame({ target: view, video, cards: [card.view], uniforms: u([cardRect]), timestampWrites });
          } else {
            whole.update();
            // The element's picture already holds the frame. It is drawn as a card that covers the canvas, with no effect.
            composer.frame({ target: view, video: null, cards: [whole.view], uniforms: uniforms({ width: 640, height: 360, rects: [[0, 0, 1, 1]], effect: EFFECTS.plain, radius: 0 }), timestampWrites });
          }
        }, () => device.queue.onSubmittedWorkDone(), mode.bitmap ? async () => { bitmap = await createImageBitmap(f.video); } : null);
        const error = await device.popErrorScope();
        if (error) throw new Error(error.message);
        let pass = NaN;
        if (stamps) {
          const encoder = device.createCommandEncoder();
          encoder.resolveQuerySet(querySet, 0, frames * 2, resolveBuffer, 0);
          encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, frames * 16);
          device.queue.submit([encoder.finish()]);
          await readBuffer.mapAsync(GPUMapMode.READ);
          const ns = new BigUint64Array(readBuffer.getMappedRange());
          const spans = [];
          for (let i = 0; i < frames; i++) if (ns[i * 2 + 1] >= ns[i * 2]) spans.push(Number(ns[i * 2 + 1] - ns[i * 2]) / 1e6);
          readBuffer.unmap();
          pass = mean(spans);
        }
        const size = mode.source ? `card ${card.width}×${card.height}, frame ${f.video.videoWidth}×${f.video.videoHeight}` : `element ${whole.width}×${whole.height}`;
        rows.push({ route: label, what: mode.what, result: `calls ${ms(t.calls)}, done ${ms(t.done)}, pass ${stamps ? ms(pass) + ' (GPU timestamps)' : 'not timed (no timestamp-query)'}`, note: size, calls: t.calls, done: t.done, pass });
      } catch (err) {
        await device.popErrorScope().catch(() => {});
        rows.push({ route: label, what: mode.what, result: `failed: ${short(err)}`, failed: true });
      }
      mode.source?.destroy();
    }
  } catch (err) {
    rows.push({ route: label, what: 'not run', result: short(err), failed: true });
  } finally {
    releaseVideo(f.video);
    whole.destroy(); card.destroy(); target.destroy(); composer.destroy();
    querySet?.destroy(); resolveBuffer?.destroy(); readBuffer?.destroy();
    try { context.unconfigure(); } catch {}
    f.canvas.remove();
    own?.destroy();
  }
  return rows;
}
// #endregion measure-gpu

/** WebGL 2: texImage2D(video) + texElementSubImage2D(card), against one texElementSubImage2D() of the element that holds the video. */
async function measureGL(stage, clipUrl, frames, say) {
  if (!webgl2()) return [{ route: 'WebGL 2', what: 'not run', result: 'no WebGL 2 context' }];
  const rows = [];
  const f = buildFixture(clipUrl);
  f.canvas.width = 640; f.canvas.height = 360;
  stage.append(f.canvas);
  try {
    const gl = f.canvas.getContext('webgl2', { alpha: false, antialias: false });
    const composer = glComposer(gl);
    const px = new Uint8Array(4);
    await f.video.play();
    await nextFrame(f.video);
    await inPaint(f.canvas);
    const cardRect = rectOf(f.canvas, f.card);
    let size = [0, 0];
    const modes = [
      { what: 'texImage2D(video) + texElementSubImage2D(card), both every frame', work: () => { composer.video(f.video); size = composer.element(0, f.canvas, f.card); composer.draw(uniforms({ width: 640, height: 360, videoWidth: 640, videoHeight: 360, rects: [cardRect], effect: EFFECTS.plain, radius: 0 })); }, note: () => `card ${size.join('×')}, frame ${f.video.videoWidth}×${f.video.videoHeight}` },
      { what: 'video inside the element: one texElementSubImage2D()', work: () => { size = composer.element(0, f.canvas, f.whole); composer.draw(uniforms({ width: 640, height: 360, rects: [[0, 0, 1, 1]], effect: EFFECTS.plain, radius: 0 })); }, note: () => `element ${size.join('×')}` },
    ];
    for (const mode of modes) {
      say(`WebGL 2: ${mode.what}`);
      try {
        const t = await timed(frames, f, mode.work, () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px));
        rows.push({ route: 'WebGL 2', what: mode.what, result: `calls ${ms(t.calls)}, done ${ms(t.done)}`, note: mode.note(), calls: t.calls, done: t.done });
      } catch (err) {
        rows.push({ route: 'WebGL 2', what: mode.what, result: `failed: ${short(err)}`, failed: true });
      }
    }
  } catch (err) {
    rows.push({ route: 'WebGL 2', what: 'not run', result: short(err), failed: true });
  } finally {
    releaseVideo(f.video);
    f.canvas.remove(); // the context is left to the garbage collector: loseContext() on a drawable canvas crashed Chromium 157
  }
  return rows;
}

/** 2D: drawImage(video) + drawElementImage(card), against one drawElementImage() of the element that holds the video. */
async function measure2D(stage, clipUrl, frames, say) {
  const rows = [];
  const f = buildFixture(clipUrl);
  f.canvas.width = 640; f.canvas.height = 360;
  stage.append(f.canvas);
  try {
    const ctx = f.canvas.getContext('2d');
    await f.video.play();
    await nextFrame(f.video);
    await inPaint(f.canvas);
    const cardRect = rectOf(f.canvas, f.card);
    const modes = [
      { what: 'drawImage(video) + drawElementImage(card)', work: () => draw2d(ctx, { video: f.video, cards: [{ el: f.card, rect: cardRect }], effect: EFFECTS.plain, fit: [1, 1] }) },
      { what: 'video inside the element: one drawElementImage()', work: () => { ctx.clearRect(0, 0, 640, 360); ctx.drawElementImage(f.whole, 0, 0, 640, 360); } },
    ];
    for (const mode of modes) {
      say(`2D canvas: ${mode.what}`);
      try {
        const t = await timed(frames, f, mode.work, null);
        rows.push({ route: '2D canvas', what: mode.what, result: `calls ${ms(t.calls)}`, note: 'The 2D calls only record the drawing. The time to rasterize it is not in this number.', calls: t.calls });
      } catch (err) {
        rows.push({ route: '2D canvas', what: mode.what, result: `failed: ${short(err)}`, failed: true });
      }
    }
  } catch (err) {
    rows.push({ route: '2D canvas', what: 'not run', result: short(err), failed: true });
  } finally {
    releaseVideo(f.video);
    f.canvas.remove();
  }
  return rows;
}

/**
 * Run every route and resolve with rows of { route, what, result, note }.
 * The fixtures sit in a fixed box in the corner of the window, so they paint wherever the page is scrolled to.
 */
export async function measure({ clipUrl, frames = 40, say = () => {} } = {}) {
  if (!supported) return [{ route: 'all', what: 'not run', result: 'HTML-in-canvas is not available in this browser' }];
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483600;opacity:.02;pointer-events:none;width:min(320px,calc(100vw - 16px));height:180px;overflow:hidden;display:flex;flex-direction:column;align-items:flex-start';
  document.body.append(stage);
  const rows = [];
  try {
    for (const run of [measureGPU, measureGL, measure2D]) {
      rows.push(...await run(stage, clipUrl, frames, say));
      await sleep(50);
    }
  } finally {
    stage.remove();
  }
  return rows;
}
