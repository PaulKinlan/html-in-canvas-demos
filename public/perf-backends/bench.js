// Upload and raster scaling benchmark for /perf-backends/.
// Compares four HTML-in-canvas routes across element count, tile CSS size
// and DOM mutation rate:
//   2d      CanvasRenderingContext2D.drawElementImage(el, x, y, w, h)
//   webgl   WebGL2 gl.texElementSubImage2D() via ElementGL (/lib/element-gl.js)
//   webgpu  GPUQueue.drawElementImageToTexture() via webgpu() (/shared/backend.js)
//   bridge  2D drawElementImage() -> shared ElementGL texSubImage2D() -> 2D drawImage()

import { banner, supported as supported2D, runTests, testStage, nextPaint, stillDrawn, inkFraction } from '/shared/support.js';
import { webgpu, webgl2, checkDevice } from '/shared/backend.js';
import { ElementGL, supported as supportedGL } from '/lib/element-gl.js';
import { supportedGPU, gpuMethod, GPUCanvas, GPUElementTexture, uploadElement, BLEND_OVER, checkWGSL, watchFrame } from '/lib/gpu-util.js';
import { geometryUnit } from '/lib/surface.js';
import { deviceTier, softwareGpu } from '/lib/device-tier.js';

export const BACKENDS = [
  { id: '2d', label: '2D drawElementImage', short: '2D', colour: '#d2491f' },
  { id: 'webgl', label: 'WebGL2 texElementSubImage2D', short: 'WebGL2', colour: '#1f7a3a' },
  { id: 'webgpu', label: 'WebGPU drawElementImageToTexture', short: 'WebGPU', colour: '#2563eb' },
  { id: 'bridge', label: 'Shared-GL copy bridge', short: 'Bridge', colour: '#8a6100' },
];
export const COUNTS = [1, 8, 32, 64, 128];
export const SIZES = [64, 128, 256];
export const MUTATIONS = [0, 10, 100];

const GL_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uPulse;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 wave = vec2(
    sin(vUv.y * 12.0 + uTime * 4.0) * 0.014,
    cos(vUv.x * 10.0 + uTime * 3.0) * 0.010
  );
  vec2 uv = clamp(vUv + wave, vec2(0.0), vec2(1.0));
  vec4 c = texture(uTex, uv);
  float pulse = uPulse * 0.30;
  vec3 tint = vec3(0.85, 0.32, 0.12) * c.a;
  outColor = vec4(mix(c.rgb, tint, pulse), c.a);
}`;

const WGSL_SHADER = `
struct Uniforms {
  matrix: mat4x4f,
  params: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(1) @binding(0) var tex: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var corners = array<vec2f, 4>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0)
  );
  let p = corners[vi];
  var out: VSOut;
  out.pos = u.matrix * vec4f(p, 0.0, 1.0);
  out.uv = p;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let wave = vec2f(
    sin(in.uv.y * 12.0 + u.params.x * 4.0) * 0.014,
    cos(in.uv.x * 10.0 + u.params.x * 3.0) * 0.010
  );
  let uv = clamp(in.uv + wave, vec2f(0.0), vec2f(1.0));
  var c = textureSample(tex, samp, uv);
  let pulse = u.params.y * 0.30;
  let tint = vec3f(0.85, 0.32, 0.12) * c.a;
  c = vec4f(mix(c.rgb, tint, pulse), c.a);
  return c;
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(r));

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function mean(arr) {
  if (!arr.length) return null;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function fmt(n, digits = 1) {
  return n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(digits);
}

// Compute the per-tile affine transform (translation, rotation, shear, wave scale)
// shared by all four backends so every route performs matching visual work.
function tilePose(i, count, timeSec, stageW, stageH, tileSize, out) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * (stageW / Math.max(1, stageH)))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const padX = Math.min(tileSize * 0.45, stageW * 0.12);
  const padY = Math.min(tileSize * 0.45, stageH * 0.15);
  const spanX = Math.max(1, stageW - padX * 2);
  const spanY = Math.max(1, stageH - padY * 2);
  const baseX = cols === 1 ? stageW * 0.5 : padX + (col / (cols - 1)) * spanX;
  const baseY = rows === 1 ? stageH * 0.5 : padY + (row / (rows - 1)) * spanY;
  const phase = timeSec * 2.2 + i * 0.42;
  const cx = baseX + Math.sin(phase) * Math.min(18, spanX * 0.08);
  const cy = baseY + Math.cos(phase * 0.85) * Math.min(12, spanY * 0.1);
  const angle = Math.sin(phase * 0.7) * 0.22;
  const shear = Math.cos(phase * 0.6) * 0.12;
  const fit = Math.min(1, (stageW * 0.88) / Math.max(tileSize, cols * tileSize * 0.72), (stageH * 0.86) / Math.max(tileSize, rows * tileSize * 0.72));
  const scale = Math.max(0.24, fit) * (0.94 + 0.08 * Math.sin(phase * 1.3));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const a = tileSize * cos * scale;
  const b = tileSize * sin * scale;
  const c = tileSize * (-sin + shear) * scale;
  const d = tileSize * cos * scale;
  const tx = cx - 0.5 * (a + c);
  const ty = cy - 0.5 * (b + d);
  out.a = a; out.b = b; out.c = c; out.d = d; out.tx = tx; out.ty = ty;
  return out;
}

function writeClipMatrix(pose, cw, ch, mat) {
  mat[0] = (2 * pose.a) / cw;
  mat[1] = (-2 * pose.b) / ch;
  mat[2] = 0;
  mat[3] = 0;
  mat[4] = (2 * pose.c) / cw;
  mat[5] = (-2 * pose.d) / ch;
  mat[6] = 0;
  mat[7] = 0;
  mat[8] = 0;
  mat[9] = 0;
  mat[10] = 1;
  mat[11] = 0;
  mat[12] = (2 * pose.tx) / cw - 1;
  mat[13] = 1 - (2 * pose.ty) / ch;
  mat[14] = 0;
  mat[15] = 1;
  return mat;
}

function makeTiles(count, tileSize) {
  const els = [];
  const palette = ['#d2491f', '#1f7a3a', '#2563eb', '#8a6100', '#7c3aed', '#0f766e'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.setAttribute('drawable', '');
    el.className = 'bench-tile';
    el.style.width = `${tileSize}px`;
    el.style.height = `${tileSize}px`;
    const accent = palette[i % palette.length];
    const compact = tileSize <= 64;
    const head = document.createElement('div');
    head.className = 'bt-head';
    head.style.background = accent;
    head.textContent = `#${String(i + 1).padStart(2, '0')}`;
    const body = document.createElement('div');
    body.className = 'bt-body';
    const val = document.createElement('div');
    val.className = 'bt-val';
    val.textContent = String((i * 17) % 100);
    const barWrap = document.createElement('div');
    barWrap.className = 'bt-track';
    const bar = document.createElement('div');
    bar.className = 'bt-fill';
    bar.style.background = accent;
    bar.style.width = `${20 + ((i * 23) % 75)}%`;
    barWrap.append(bar);
    body.append(val, barWrap);
    if (!compact) {
      const sub = document.createElement('div');
      sub.className = 'bt-sub';
      sub.textContent = tileSize >= 256 ? `${tileSize}×${tileSize} tile · DOM node` : `${tileSize}px`;
      body.append(sub);
    }
    el.append(head, body);
    el._val = val;
    el._bar = bar;
    els.push(el);
  }
  return els;
}

function mutateTiles(els, mutationPct, tick, dirtySet) {
  dirtySet.clear();
  if (mutationPct <= 0 || !els.length) return;
  const n = els.length;
  const count = mutationPct >= 100 ? n : Math.max(1, Math.round((n * mutationPct) / 100));
  const start = (tick * count) % n;
  for (let k = 0; k < count; k++) {
    const idx = (start + k) % n;
    const el = els[idx];
    const v = (tick * 7 + idx * 13) % 100;
    el._val.textContent = String(v);
    el._bar.style.width = `${12 + (v % 84)}%`;
    dirtySet.add(idx);
  }
}

// #region timers
// Long Animation Frames observer + optional WebGL/WebGPU GPU timing helpers.
function createLoafCollector() {
  const supported = typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame');
  const entries = [];
  let po = null;
  return {
    supported,
    start() {
      entries.length = 0;
      if (!supported) return;
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) entries.push(e);
      });
      try { po.observe({ type: 'long-animation-frame' }); } catch { po = null; }
    },
    stop() {
      po?.disconnect();
      po = null;
      if (!supported) return { supported: false, count: 0, scriptMs: null, styleLayoutMs: null, postMainMs: null };
      const scripts = [];
      const styleLayouts = [];
      const postMains = [];
      for (const e of entries) {
        const end = e.startTime + e.duration;
        const rStart = e.renderStart > 0 ? e.renderStart : e.startTime;
        const slStart = e.styleAndLayoutStart > 0 ? e.styleAndLayoutStart : end;
        scripts.push(Math.max(0, slStart - rStart));
        styleLayouts.push(Math.max(0, end - slStart));
        if (typeof e.presentationTime === 'number' && e.presentationTime > 0) {
          postMains.push(Math.max(0, e.presentationTime - end));
        }
      }
      return {
        supported: true,
        count: entries.length,
        scriptMs: mean(scripts),
        styleLayoutMs: mean(styleLayouts),
        postMainMs: mean(postMains),
      };
    },
  };
}

function createGLTimer(gl) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
  const pending = [];
  const samplesMs = [];
  let active = null;
  return {
    supported: !!ext,
    kind: ext ? 'ext-timer-query' : 'none',
    begin() {
      if (!ext || !gl || gl.isContextLost() || active) return;
      const q = gl.createQuery();
      if (!q) return;
      active = q;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    },
    end() {
      if (!ext || !gl || gl.isContextLost() || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      if (!ext || !gl || gl.isContextLost()) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length) {
        const q = pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!disjoint) {
          const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
          if (ns > 0) samplesMs.push(ns / 1e6);
        }
        gl.deleteQuery(q);
      }
    },
    reset() {
      samplesMs.length = 0;
    },
    result() {
      this.poll();
      return { kind: this.kind, ms: mean(samplesMs), samples: samplesMs.length };
    },
    dispose() {
      if (gl && !gl.isContextLost()) {
        if (active) { try { gl.endQuery(ext.TIME_ELAPSED_EXT); } catch {} gl.deleteQuery(active); }
        for (const q of pending) gl.deleteQuery(q);
      }
      active = null;
      pending.length = 0;
      samplesMs.length = 0;
    },
  };
}
// #endregion timers

function sizeCanvasToStage(canvas, stageEl) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = Math.max(1, stageEl.clientWidth || 360);
  const ch = Math.max(1, stageEl.clientHeight || 300);
  const w = Math.max(1, Math.round(cw * dpr));
  const h = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { cw, ch, dpr, w, h };
}

// ============================================================================
// Four backend runners. Each exposes:
//   mount(els, tileSize)
//   renderFrame(timeSec, dirtySet, isFirst, recordStats) -> { uploadMs, drawMs, geomMs }
//   settleGpuTiming() -> Promise<{ kind, ms }>
//   dispose()
// ============================================================================

// #region backend-2d
function create2DBackend(stageEl, onLost) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.className = 'stage-canvas';
  stageEl.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  let lost = false;
  canvas.addEventListener('contextlost', () => { lost = true; onLost?.('2D canvas context lost'); });
  canvas.addEventListener('contextrestored', () => { lost = false; });

  let els = [];
  let tileSize = 64;
  let lastPose = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  let pendingRender = null;

  canvas.addEventListener('paint', () => {
    if (!pendingRender || lost) return;
    const req = pendingRender;
    pendingRender = null;
    const { cw, ch, dpr } = sizeCanvasToStage(canvas, stageEl);
    const tDraw0 = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    let uploadMs = 0;
    for (let i = 0; i < els.length; i++) {
      tilePose(i, els.length, req.timeSec, cw, ch, tileSize, lastPose);
      ctx.save();
      ctx.transform(
        lastPose.a / tileSize,
        lastPose.b / tileSize,
        lastPose.c / tileSize,
        lastPose.d / tileSize,
        lastPose.tx,
        lastPose.ty,
      );
      const t0 = performance.now();
      try {
        ctx.drawElementImage(els[i], 0, 0, tileSize, tileSize);
      } catch {}
      uploadMs += performance.now() - t0;
      if (req.dirtySet.has(i)) {
        ctx.fillStyle = 'rgba(210, 73, 31, 0.22)';
        ctx.fillRect(0, 0, tileSize, tileSize);
      }
      ctx.restore();
    }
    const drawMs = performance.now() - tDraw0;
    req.resolve({ uploadMs, drawMs, geomMs: 0, lost });
  });

  return {
    id: '2d',
    canvas,
    get lost() { return lost; },
    mount(nextEls, nextTileSize) {
      els = nextEls;
      tileSize = nextTileSize;
      canvas.replaceChildren(...els);
      sizeCanvasToStage(canvas, stageEl);
    },
    renderFrame(timeSec, dirtySet) {
      return new Promise((resolve) => {
        pendingRender = { timeSec, dirtySet, resolve };
        canvas.requestPaint();
        setTimeout(() => {
          if (pendingRender && pendingRender.resolve === resolve) {
            pendingRender = null;
            resolve({ uploadMs: 0, drawMs: 0, geomMs: 0, lost });
          }
        }, 250);
      });
    },
    resetTimers() {},
    async settleGpuTiming() { return { kind: 'none', ms: null }; },
    dispose() {
      pendingRender = null;
      canvas.remove();
      window.__gfx?.retire(canvas);
    },
  };
}
// #endregion backend-2d

// #region backend-webgl
function createWebGLBackend(stageEl, onLost) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.className = 'stage-canvas';
  stageEl.replaceChildren(canvas);

  let lost = false;
  const stageGL = new ElementGL(canvas, {
    fragment: GL_FRAG,
    onLost: () => { lost = true; onLost?.('WebGL2 context lost'); },
    onRestored: () => { lost = false; uploaded.clear(); },
  });
  const timer = createGLTimer(stageGL.gl);

  let els = [];
  let tileSize = 64;
  const uploaded = new Set();
  const pose = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const mat = new Float32Array(16);
  let pendingPaint = null;

  function drawAll(timeSec, dirtySet, uploadMs) {
    if (lost || stageGL.lost) return { uploadMs, drawMs: 0, geomMs: 0, lost: true };
    const tDraw0 = performance.now();
    timer.poll();
    timer.begin();
    const ok = stageGL.begin();
    const cw = Math.max(1, canvas.clientWidth || stageEl.clientWidth || 360);
    const ch = Math.max(1, canvas.clientHeight || stageEl.clientHeight || 300);
    if (ok) {
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!stageGL.has(el)) continue;
        tilePose(i, els.length, timeSec, cw, ch, tileSize, pose);
        writeClipMatrix(pose, cw, ch, mat);
        const pulse = dirtySet.has(i) ? 1.0 : 0.0;
        stageGL.quad(el, mat, (gl, uniform) => {
          gl.uniform1f(uniform('uPulse'), pulse);
        });
      }
    }
    timer.end();
    const tGeom0 = performance.now();
    if (typeof canvas.updateElementGeometry === 'function' && els.length) {
      const unit = geometryUnit(canvas, els[0], tileSize);
      for (let i = 0; i < els.length; i++) {
        tilePose(i, els.length, timeSec, cw, ch, tileSize, pose);
        const m = new DOMMatrix([
          pose.a / tileSize,
          pose.b / tileSize,
          pose.c / tileSize,
          pose.d / tileSize,
          pose.tx,
          pose.ty,
        ]);
        try {
          canvas.updateElementGeometry(els[i], { canvasTransform: new DOMMatrix().scale(unit).multiply(m) });
        } catch {}
      }
    }
    const geomMs = performance.now() - tGeom0;
    const drawMs = uploadMs + (performance.now() - tDraw0);
    return { uploadMs, drawMs, geomMs, lost };
  }

  canvas.addEventListener('paint', () => {
    if (!pendingPaint) return;
    const req = pendingPaint;
    pendingPaint = null;
    let uploadMs = 0;
    if (!lost && !stageGL.lost) {
      const tUp0 = performance.now();
      for (let i = 0; i < els.length; i++) {
        if (!req.forceAll && uploaded.has(i) && !req.dirtySet.has(i)) continue;
        try {
          if (stageGL.upload(els[i])) uploaded.add(i);
        } catch {}
      }
      uploadMs = performance.now() - tUp0;
    }
    req.resolve(drawAll(req.timeSec, req.dirtySet, uploadMs));
  });

  return {
    id: 'webgl',
    canvas,
    timerKind: timer.kind,
    get lost() { return lost || stageGL.lost; },
    mount(nextEls, nextTileSize) {
      for (const oldEl of els) stageGL.forget(oldEl);
      uploaded.clear();
      els = nextEls;
      tileSize = nextTileSize;
      canvas.replaceChildren(...els);
    },
    renderFrame(timeSec, dirtySet, forceAll = false) {
      const needsUpload = forceAll || uploaded.size < els.length || dirtySet.size > 0;
      if (!needsUpload) {
        return Promise.resolve(drawAll(timeSec, dirtySet, 0));
      }
      return new Promise((resolve) => {
        pendingPaint = { timeSec, dirtySet, forceAll, resolve };
        canvas.requestPaint();
        setTimeout(() => {
          if (pendingPaint && pendingPaint.resolve === resolve) {
            pendingPaint = null;
            resolve(drawAll(timeSec, dirtySet, 0));
          }
        }, 250);
      });
    },
    resetTimers() { timer.reset(); },
    async settleGpuTiming() {
      await sleep(30);
      return timer.result();
    },
    dispose() {
      pendingPaint = null;
      timer.dispose();
      stageGL.dispose();
      canvas.remove();
      window.__gfx?.retire(canvas);
    },
  };
}
// #endregion backend-webgl

// #region backend-webgpu
async function createWebGPUBackend(stageEl, gpu, onLost) {
  const { device, format } = gpu;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.className = 'stage-canvas';
  stageEl.replaceChildren(canvas);
  sizeCanvasToStage(canvas, stageEl);

  const gpuCanvas = new GPUCanvas(canvas, gpu, { present: true });
  const module = await checkWGSL(device, WGSL_SHADER, 'perf-backends');
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const bgl0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 80 } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const bgl1 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: BLEND_OVER }] },
    primitive: { topology: 'triangle-strip' },
  });

  const maxTiles = 128;
  const strideBytes = Math.max(256, device.limits.minUniformBufferOffsetAlignment || 256);
  const strideFloats = strideBytes / 4;
  const uniformData = new Float32Array(maxTiles * strideFloats);
  const uniformBuf = device.createBuffer({
    size: maxTiles * strideBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sharedBG = device.createBindGroup({
    layout: bgl0,
    entries: [
      { binding: 0, resource: { buffer: uniformBuf, offset: 0, size: 80 } },
      { binding: 1, resource: sampler },
    ],
  });

  const hasTimestamp = device.features.has('timestamp-query');
  const maxTimedFrames = 128;
  let querySet = null;
  let resolveBuf = null;
  let readBuf = null;
  let queryFrame = 0;
  if (hasTimestamp) {
    querySet = device.createQuerySet({ type: 'timestamp', count: maxTimedFrames * 2 });
    resolveBuf = device.createBuffer({ size: maxTimedFrames * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    readBuf = device.createBuffer({ size: maxTimedFrames * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }
  const queueDurations = [];

  let els = [];
  let tiles = [];
  let tileSize = 64;
  let lost = false;
  let checkedFirst = false;
  const pose = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const mat = new Float32Array(16);
  let pendingPaint = null;

  const onDeviceLost = () => { lost = true; onLost?.('WebGPU device lost'); };
  addEventListener('webgpulost', onDeviceLost);

  function clearTiles() {
    for (const t of tiles) t.tex.destroy();
    tiles = [];
  }

  function drawAll(timeSec, dirtySet, uploadMs, recordTimer) {
    if (lost || gpuCanvas.lost) return { uploadMs, drawMs: 0, geomMs: 0, lost: true };
    const tDraw0 = performance.now();
    const { cw, ch } = sizeCanvasToStage(canvas, stageEl);

    const drawList = [];
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (!tile.ready || !tile.bindGroup) continue;
      tilePose(i, els.length, timeSec, cw, ch, tileSize, pose);
      writeClipMatrix(pose, cw, ch, mat);
      const base = i * strideFloats;
      uniformData.set(mat, base);
      uniformData[base + 16] = timeSec;
      uniformData[base + 17] = dirtySet.has(i) ? 1.0 : 0.0;
      uniformData[base + 18] = tileSize;
      uniformData[base + 19] = tileSize;
      drawList.push(i);
    }

    const submitPass = () => {
      if (drawList.length) {
        device.queue.writeBuffer(uniformBuf, 0, uniformData, 0, els.length * strideFloats);
      }
      const enc = device.createCommandEncoder();
      const passDesc = {
        colorAttachments: [{
          view: gpuCanvas.view(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      };
      if (hasTimestamp && recordTimer && queryFrame < maxTimedFrames) {
        passDesc.timestampWrites = {
          querySet,
          beginningOfPassWriteIndex: queryFrame * 2,
          endOfPassWriteIndex: queryFrame * 2 + 1,
        };
        queryFrame++;
      }
      const pass = enc.beginRenderPass(passDesc);
      pass.setPipeline(pipeline);
      for (let k = 0; k < drawList.length; k++) {
        const i = drawList[k];
        pass.setBindGroup(0, sharedBG, [i * strideBytes]);
        pass.setBindGroup(1, tiles[i].bindGroup);
        pass.draw(4);
      }
      pass.end();
      const tSub = performance.now();
      device.queue.submit([enc.finish()]);
      if (!hasTimestamp && recordTimer && queueDurations.length < 64) {
        device.queue.onSubmittedWorkDone().then(() => {
          queueDurations.push(performance.now() - tSub);
        }, () => {});
      }
    };

    if (!checkedFirst) {
      checkedFirst = true;
      watchFrame(device, submitPass, (msg) => { lost = true; onLost?.(`WebGPU validation error: ${msg}`); });
    } else {
      submitPass();
    }

    const tGeom0 = performance.now();
    if (typeof canvas.updateElementGeometry === 'function' && els.length) {
      const unit = geometryUnit(canvas, els[0], tileSize);
      for (let i = 0; i < els.length; i++) {
        tilePose(i, els.length, timeSec, cw, ch, tileSize, pose);
        const m = new DOMMatrix([
          pose.a / tileSize,
          pose.b / tileSize,
          pose.c / tileSize,
          pose.d / tileSize,
          pose.tx,
          pose.ty,
        ]);
        try {
          canvas.updateElementGeometry(els[i], { canvasTransform: new DOMMatrix().scale(unit).multiply(m) });
        } catch {}
      }
    }
    const geomMs = performance.now() - tGeom0;
    const drawMs = uploadMs + (performance.now() - tDraw0);
    return { uploadMs, drawMs, geomMs, lost };
  }

  canvas.addEventListener('paint', () => {
    if (!pendingPaint) return;
    const req = pendingPaint;
    pendingPaint = null;
    let uploadMs = 0;
    if (!lost && !gpuCanvas.lost) {
      const tUp0 = performance.now();
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (!req.forceAll && tile.ready && !req.dirtySet.has(i)) continue;
        const prevTex = tile.tex.texture;
        try {
          tile.tex.update();
          if (tile.tex.texture !== prevTex || !tile.bindGroup) {
            tile.bindGroup = device.createBindGroup({
              layout: bgl1,
              entries: [{ binding: 0, resource: tile.tex.view }],
            });
          }
          tile.ready = true;
        } catch {}
      }
      uploadMs = performance.now() - tUp0;
    }
    req.resolve(drawAll(req.timeSec, req.dirtySet, uploadMs, req.recordTimer));
  });

  return {
    id: 'webgpu',
    canvas,
    timerKind: hasTimestamp ? 'timestamp-query' : 'queue-done',
    get lost() { return lost || gpuCanvas.lost; },
    mount(nextEls, nextTileSize) {
      clearTiles();
      els = nextEls;
      tileSize = nextTileSize;
      canvas.replaceChildren(...els);
      sizeCanvasToStage(canvas, stageEl);
      tiles = els.map((el) => ({ tex: new GPUElementTexture(device, canvas, el), bindGroup: null, ready: false }));
    },
    renderFrame(timeSec, dirtySet, forceAll = false, recordTimer = true) {
      const allReady = tiles.length === els.length && tiles.every((t) => t.ready);
      const needsUpload = forceAll || !allReady || dirtySet.size > 0;
      if (!needsUpload) {
        return Promise.resolve(drawAll(timeSec, dirtySet, 0, recordTimer));
      }
      return new Promise((resolve) => {
        pendingPaint = { timeSec, dirtySet, forceAll, recordTimer, resolve };
        canvas.requestPaint();
        setTimeout(() => {
          if (pendingPaint && pendingPaint.resolve === resolve) {
            pendingPaint = null;
            resolve(drawAll(timeSec, dirtySet, 0, recordTimer));
          }
        }, 250);
      });
    },
    resetTimers() {
      queryFrame = 0;
      queueDurations.length = 0;
    },
    async settleGpuTiming() {
      if (hasTimestamp && queryFrame > 0 && !lost && !gpuCanvas.lost) {
        const count = queryFrame;
        const byteCount = count * 16;
        const enc = device.createCommandEncoder();
        enc.resolveQuerySet(querySet, 0, count * 2, resolveBuf, 0);
        enc.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, byteCount);
        device.queue.submit([enc.finish()]);
        await readBuf.mapAsync(GPUMapMode.READ, 0, byteCount);
        const times = new BigUint64Array(readBuf.getMappedRange(0, byteCount));
        const diffs = [];
        for (let i = 0; i < count; i++) {
          const d = Number(times[i * 2 + 1] - times[i * 2]) / 1e6;
          if (d >= 0 && d < 1000) diffs.push(d);
        }
        readBuf.unmap();
        return { kind: 'timestamp-query', ms: mean(diffs), samples: diffs.length };
      }
      try { await device.queue.onSubmittedWorkDone(); } catch {}
      return { kind: 'queue-done', ms: mean(queueDurations), samples: queueDurations.length };
    },
    dispose() {
      pendingPaint = null;
      removeEventListener('webgpulost', onDeviceLost);
      clearTiles();
      uniformBuf.destroy();
      querySet?.destroy();
      resolveBuf?.destroy();
      readBuf?.destroy();
      gpuCanvas.destroy();
      canvas.remove();
      window.__gfx?.retire(canvas);
    },
  };
}
// #endregion backend-webgpu

// #region backend-bridge
// 2D-to-shared-WebGL-to-2D copy bridge:
//   1. Dirty tiles are drawn onto the drawable 2D canvas with drawElementImage(el, 0, 0, w, h).
//   2. That tile rectangle is uploaded into one shared ElementGL context via gl.texSubImage2D().
//   3. All N transformed quads are shaded in the shared WebGL canvas.
//   4. The shared WebGL canvas is composited back onto the visible 2D canvas with drawImage().
function createBridgeBackend(stageEl, onLost) {
  const glCanvas = document.createElement('canvas');
  glCanvas.setAttribute('aria-hidden', 'true');
  glCanvas.className = 'stage-canvas bridge-gl';

  const stageCanvas = document.createElement('canvas');
  stageCanvas.setAttribute('content', 'drawable');
  stageCanvas.setAttribute('layoutsubtree', '');
  stageCanvas.className = 'stage-canvas bridge-2d';

  stageEl.replaceChildren(glCanvas, stageCanvas);

  let lost = false;
  const stageCtx = stageCanvas.getContext('2d');
  stageCanvas.addEventListener('contextlost', () => { lost = true; onLost?.('2D bridge canvas lost'); });
  stageCanvas.addEventListener('contextrestored', () => { lost = false; });

  const bridgeGL = new ElementGL(glCanvas, {
    fragment: GL_FRAG,
    onLost: () => { lost = true; onLost?.('Shared WebGL2 bridge context lost'); },
    onRestored: () => { lost = false; textures.forEach((t) => { t.w = 0; t.h = 0; t.ready = false; }); },
  });
  const timer = createGLTimer(bridgeGL.gl);

  let els = [];
  let textures = [];
  let tileSize = 64;
  const pose = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const mat = new Float32Array(16);
  let pendingPaint = null;

  function clearTextures() {
    const gl = bridgeGL.gl;
    if (gl && !bridgeGL.lost && !gl.isContextLost()) {
      for (const t of textures) if (t.tex) gl.deleteTexture(t.tex);
    }
    textures = [];
  }

  function composite(timeSec, dirtySet, uploadMs) {
    if (lost || bridgeGL.lost) return { uploadMs, drawMs: 0, geomMs: 0, lost: true };
    const tDraw0 = performance.now();
    const { cw, ch, dpr } = sizeCanvasToStage(stageCanvas, stageEl);
    const gl = bridgeGL.gl;
    timer.poll();
    timer.begin();
    const ok = bridgeGL.begin();
    if (ok) {
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(bridgeGL.uniform('uTex'), 0);
      gl.uniform1f(bridgeGL.uniform('uTime'), timeSec);
      const uMat = bridgeGL.uniform('uMatrix');
      const uSize = bridgeGL.uniform('uSize');
      const uPulse = bridgeGL.uniform('uPulse');
      for (let i = 0; i < textures.length; i++) {
        const t = textures[i];
        if (!t.ready || !t.tex) continue;
        tilePose(i, els.length, timeSec, cw, ch, tileSize, pose);
        writeClipMatrix(pose, cw, ch, mat);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniformMatrix4fv(uMat, false, mat);
        gl.uniform2f(uSize, tileSize, tileSize);
        gl.uniform1f(uPulse, dirtySet.has(i) ? 1.0 : 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    timer.end();
    stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stageCtx.clearRect(0, 0, cw, ch);
    if (glCanvas.width > 0 && glCanvas.height > 0) {
      stageCtx.drawImage(glCanvas, 0, 0, cw, ch);
    }
    const drawMs = uploadMs + (performance.now() - tDraw0);
    return { uploadMs, drawMs, geomMs: 0, lost };
  }

  stageCanvas.addEventListener('paint', () => {
    if (!pendingPaint) return;
    const req = pendingPaint;
    pendingPaint = null;
    let uploadMs = 0;
    if (!lost && !bridgeGL.lost) {
      const { dpr, w: bufW, h: bufH } = sizeCanvasToStage(stageCanvas, stageEl);
      const upW = Math.min(Math.max(1, Math.round(tileSize * dpr)), bufW);
      const upH = Math.min(Math.max(1, Math.round(tileSize * dpr)), bufH);
      const gl = bridgeGL.gl;
      const tUp0 = performance.now();
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < els.length; i++) {
        const t = textures[i];
        if (!req.forceAll && t.ready && !req.dirtySet.has(i)) continue;
        stageCtx.clearRect(0, 0, tileSize + 2, tileSize + 2);
        let drew = false;
        try {
          stageCtx.drawElementImage(els[i], 0, 0, tileSize, tileSize);
          drew = true;
        } catch {}
        if (!drew) continue;
        if (!t.tex) {
          t.tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t.tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, t.tex);
        }
        if (t.w !== upW || t.h !== upH) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, upW, upH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          t.w = upW;
          t.h = upH;
        }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, upW, upH, gl.RGBA, gl.UNSIGNED_BYTE, stageCanvas);
        t.ready = true;
      }
      uploadMs = performance.now() - tUp0;
    }
    req.resolve(composite(req.timeSec, req.dirtySet, uploadMs));
  });

  return {
    id: 'bridge',
    canvas: stageCanvas,
    timerKind: timer.kind,
    get lost() { return lost || bridgeGL.lost; },
    mount(nextEls, nextTileSize) {
      clearTextures();
      els = nextEls;
      tileSize = nextTileSize;
      stageCanvas.replaceChildren(...els);
      sizeCanvasToStage(stageCanvas, stageEl);
      textures = els.map(() => ({ tex: null, w: 0, h: 0, ready: false }));
    },
    renderFrame(timeSec, dirtySet, forceAll = false) {
      const allReady = textures.length === els.length && textures.every((t) => t.ready);
      const needsUpload = forceAll || !allReady || dirtySet.size > 0;
      if (!needsUpload) {
        return Promise.resolve(composite(timeSec, dirtySet, 0));
      }
      return new Promise((resolve) => {
        pendingPaint = { timeSec, dirtySet, forceAll, resolve };
        stageCanvas.requestPaint();
        setTimeout(() => {
          if (pendingPaint && pendingPaint.resolve === resolve) {
            pendingPaint = null;
            resolve(composite(timeSec, dirtySet, 0));
          }
        }, 250);
      });
    },
    resetTimers() { timer.reset(); },
    async settleGpuTiming() {
      await sleep(30);
      return timer.result();
    },
    dispose() {
      pendingPaint = null;
      timer.dispose();
      clearTextures();
      bridgeGL.dispose();
      stageCanvas.remove();
      glCanvas.remove();
      window.__gfx?.retire(glCanvas);
      window.__gfx?.retire(stageCanvas);
    },
  };
}
// #endregion backend-bridge

// ============================================================================
// Page controller, benchmark runner, chart, export and live checks
// ============================================================================

const ui = {
  stage: document.getElementById('stage'),
  stageAlert: document.getElementById('stageAlert'),
  backendSel: document.getElementById('selBackend'),
  countSel: document.getElementById('selCount'),
  sizeSel: document.getElementById('selSize'),
  mutSel: document.getElementById('selMut'),
  btnPreview: document.getElementById('btnPreview'),
  btnRunOne: document.getElementById('btnRunOne'),
  btnSweep: document.getElementById('btnSweep'),
  btnMatrix: document.getElementById('btnMatrix'),
  btnStop: document.getElementById('btnStop'),
  btnSend: document.getElementById('btnSend'),
  btnCopyJson: document.getElementById('btnCopyJson'),
  btnCopyMd: document.getElementById('btnCopyMd'),
  status: document.getElementById('status'),
  deviceInfo: document.getElementById('deviceInfo'),
  chartMetric: document.getElementById('chartMetric'),
  chartSize: document.getElementById('chartSize'),
  chartMut: document.getElementById('chartMut'),
  chartSvg: document.getElementById('chartSvg'),
  chartNote: document.getElementById('chartNote'),
  resultsBody: document.getElementById('resultsBody'),
  checksBody: document.getElementById('checksBody'),
};

const state = {
  runner: null,
  runnerId: null,
  els: [],
  running: false,
  abort: false,
  previewing: false,
  previewRaf: 0,
  gpu: undefined, // undefined = not asked yet, null = unavailable, object = ready
  gpuChecked: false,
  results: new Map(), // key -> row
  capabilities: {
    d2d: supported2D,
    webgl2: false,
    glElement: supportedGL,
    webgpuApi: supportedGPU,
    webgpuMethod: gpuMethod,
    webgpuReady: false,
    webgpuReason: '',
    webgpuTimestamp: false,
    webgpuAdapterTimestamp: false,
    loaf: typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame'),
    dpr: window.devicePixelRatio || 1,
    tier: deviceTier(),
    gpuAdapterInfo: '',
  },
};

function rowKey(backend, count, size, mut) {
  return `${backend}|${count}|${size}|${mut}`;
}

function showStageAlert(msg) {
  if (!ui.stageAlert) return;
  if (!msg) {
    ui.stageAlert.hidden = true;
    ui.stageAlert.textContent = '';
  } else {
    ui.stageAlert.hidden = false;
    ui.stageAlert.textContent = msg;
  }
}

async function ensureGPU() {
  if (state.gpuChecked) return state.gpu;
  state.gpuChecked = true;
  if (!supportedGPU) {
    state.gpu = null;
    state.capabilities.webgpuReady = false;
    state.capabilities.webgpuReason = !navigator.gpu ? 'no navigator.gpu' : 'no GPUQueue.drawElementImageToTexture()';
    return null;
  }
  const gpu = await webgpu();
  state.gpu = gpu;
  state.capabilities.webgpuReady = !!gpu;
  state.capabilities.webgpuReason = gpu ? '' : (webgpu.reason || 'WebGPU unavailable');
  if (gpu) {
    state.capabilities.webgpuTimestamp = gpu.device.features.has('timestamp-query');
    state.capabilities.webgpuAdapterTimestamp = gpu.adapter.features.has('timestamp-query');
  }
  return gpu;
}

async function switchBackend(backendId) {
  if (state.runner && state.runnerId === backendId && !state.runner.lost) {
    return state.runner;
  }
  if (state.runner) {
    const prevWasGL = state.runnerId === 'webgl' || state.runnerId === 'bridge';
    state.runner.dispose();
    state.runner = null;
    state.runnerId = null;
    // Context-guard retires WebGL contexts 200 ms after removal; wait briefly
    // so peak active WebGL contexts stays at 1 across backend switches.
    if (prevWasGL) await sleep(260);
  }
  showStageAlert('');

  if (!supported2D) {
    showStageAlert('HTML-in-canvas is not enabled in this browser. Enable chrome://flags/#canvas-draw-element to run these benchmarks.');
    return null;
  }

  if (backendId === '2d') {
    state.runner = create2DBackend(ui.stage, (msg) => showStageAlert(msg));
    state.runnerId = '2d';
    return state.runner;
  }

  if (backendId === 'webgl') {
    if (!supportedGL || !webgl2()) {
      showStageAlert('WebGL2 texElementSubImage2D() is not available in this browser.');
      return null;
    }
    state.runner = createWebGLBackend(ui.stage, (msg) => showStageAlert(msg));
    state.runnerId = 'webgl';
    return state.runner;
  }

  if (backendId === 'webgpu') {
    const gpu = await ensureGPU();
    if (!gpu) {
      showStageAlert(`WebGPU is not used on screen here: ${state.capabilities.webgpuReason}.`);
      return null;
    }
    state.runner = await createWebGPUBackend(ui.stage, gpu, (msg) => showStageAlert(msg));
    state.runnerId = 'webgpu';
    return state.runner;
  }

  if (backendId === 'bridge') {
    if (!webgl2()) {
      showStageAlert('WebGL2 is not available here for the shared-GL copy bridge.');
      return null;
    }
    state.runner = createBridgeBackend(ui.stage, (msg) => showStageAlert(msg));
    state.runnerId = 'bridge';
    return state.runner;
  }

  return null;
}

async function mountScene(backendId, count, tileSize) {
  const runner = await switchBackend(backendId);
  if (!runner) return null;
  const els = makeTiles(count, tileSize);
  state.els = els;
  runner.mount(els, tileSize);
  // Wait one frame for layout so drawable children have valid boxes.
  await raf();
  const dirtyAll = new Set(els.map((_, i) => i));
  await runner.renderFrame(performance.now() / 1000, dirtyAll, true, false);
  return runner;
}

async function measureCell({ backend, count, size, mut, windowMs = 1100, warmupFrames = 8 }) {
  const key = rowKey(backend, count, size, mut);
  const runner = await switchBackend(backend);
  if (!runner) {
    const skipped = {
      backend, count, size, mut,
      skipped: true,
      reason: backend === 'webgpu' ? state.capabilities.webgpuReason : 'backend unavailable',
    };
    state.results.set(key, skipped);
    return skipped;
  }

  const els = makeTiles(count, size);
  state.els = els;
  runner.mount(els, size);
  await raf();

  const dirtySet = new Set();
  for (let i = 0; i < els.length; i++) dirtySet.add(i);

  // Frame 0: cold upload of all N tiles.
  const firstFrame = await runner.renderFrame(performance.now() / 1000, dirtySet, true, false);
  const firstUploadMs = firstFrame.uploadMs;

  // Warmup frames so pipelines, textures and layout settle.
  for (let w = 0; w < warmupFrames && !state.abort; w++) {
    await raf();
    mutateTiles(els, mut, w, dirtySet);
    await runner.renderFrame(performance.now() / 1000, dirtySet, false, false);
  }
  if (state.abort) return null;

  runner.resetTimers();
  const loaf = createLoafCollector();
  loaf.start();

  const frameDeltas = [];
  const uploadTimes = [];
  const drawTimes = [];
  const geomTimes = [];
  const tStart = performance.now();
  let lastT = tStart;
  let tick = warmupFrames;
  let frames = 0;
  let lostDuring = false;

  while (!state.abort) {
    const now = await raf();
    if (frames > 0) frameDeltas.push(now - lastT);
    lastT = now;
    mutateTiles(els, mut, tick++, dirtySet);
    const stats = await runner.renderFrame(now / 1000, dirtySet, false, true);
    uploadTimes.push(stats.uploadMs);
    drawTimes.push(stats.drawMs);
    geomTimes.push(stats.geomMs);
    if (stats.lost) lostDuring = true;
    frames++;
    const elapsed = performance.now() - tStart;
    if (elapsed >= windowMs && frames >= 12) break;
    if (elapsed >= Math.max(windowMs * 2, 2200)) break;
    if (lostDuring) break;
  }

  const totalElapsed = Math.max(1, performance.now() - tStart);
  const loafRes = loaf.stop();
  const gpuRes = await runner.settleGpuTiming();

  if (state.abort) return null;

  const sorted = frameDeltas.slice().sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const fps = frameDeltas.length ? (1000 / mean(frameDeltas)) : (frames * 1000) / totalElapsed;

  const row = {
    backend,
    count,
    size,
    mut,
    skipped: false,
    frames,
    fps,
    p50,
    p95,
    p99,
    uploadMs: mean(uploadTimes),
    drawMs: mean(drawTimes),
    geomMs: mean(geomTimes),
    firstUploadMs,
    gpuMs: gpuRes.ms,
    gpuTimerKind: gpuRes.kind,
    loafCount: loafRes.count,
    loafScriptMs: loafRes.scriptMs,
    loafStyleLayoutMs: loafRes.styleLayoutMs,
    loafPostMainMs: loafRes.postMainMs,
    contextLost: lostDuring,
  };
  state.results.set(key, row);
  return row;
}

function setBusy(busy) {
  state.running = busy;
  ui.btnRunOne.disabled = busy || !supported2D;
  ui.btnSweep.disabled = busy || !supported2D;
  ui.btnMatrix.disabled = busy || !supported2D;
  ui.btnPreview.disabled = busy || !supported2D;
  ui.btnStop.disabled = !busy;
}

function stopPreview() {
  state.previewing = false;
  if (state.previewRaf) cancelAnimationFrame(state.previewRaf);
  state.previewRaf = 0;
  if (ui.btnPreview) ui.btnPreview.textContent = 'Start live preview';
}

async function startPreview() {
  if (state.running) return;
  if (state.previewing) {
    stopPreview();
    ui.status.textContent = 'Live preview paused.';
    return;
  }
  const backend = ui.backendSel.value;
  const count = Number(ui.countSel.value);
  const size = Number(ui.sizeSel.value);
  const mut = Number(ui.mutSel.value);
  ui.status.textContent = `Starting ${backend} (${count} tiles, ${size} px, ${mut}% dirty)...`;
  const runner = await mountScene(backend, count, size);
  if (!runner) {
    ui.status.textContent = `Could not start ${backend}.`;
    return;
  }
  state.previewing = true;
  ui.btnPreview.textContent = 'Pause live preview';
  const dirtySet = new Set();
  let tick = 0;
  let lastFpsAt = performance.now();
  let fpsFrames = 0;
  let lastUpload = 0;
  let inFlight = false;

  const step = async (now) => {
    if (!state.previewing) return;
    state.previewRaf = requestAnimationFrame(step);
    if (inFlight) return;
    inFlight = true;
    try {
      mutateTiles(state.els, mut, tick++, dirtySet);
      const r = await runner.renderFrame(now / 1000, dirtySet, false, false);
      lastUpload = r.uploadMs;
      fpsFrames++;
      if (now - lastFpsAt >= 500) {
        const fps = (fpsFrames * 1000) / (now - lastFpsAt);
        ui.status.textContent = `Live preview: ${backend} | ${count} tiles @ ${size} px | ${mut}% dirty | ${fps.toFixed(1)} fps | upload ${lastUpload.toFixed(2)} ms`;
        fpsFrames = 0;
        lastFpsAt = now;
      }
      if (r.lost) stopPreview();
    } finally {
      inFlight = false;
    }
  };
  state.previewRaf = requestAnimationFrame(step);
}

function buildCompactReport(kind) {
  const rows = [...state.results.values()];
  const compact = rows.map((r) => (r.skipped
    ? [r.backend, r.count, r.size, r.mut, 'skip', r.reason]
    : [
      r.backend, r.count, r.size, r.mut,
      +r.fps.toFixed(1),
      +(r.p50 ?? 0).toFixed(2),
      +(r.p95 ?? 0).toFixed(2),
      +(r.p99 ?? 0).toFixed(2),
      +(r.uploadMs ?? 0).toFixed(2),
      r.gpuMs != null ? +r.gpuMs.toFixed(2) : null,
      r.gpuTimerKind,
      r.loafCount,
    ]));
  const ua = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent.slice(0, 60);
  const measured = rows.filter((r) => !r.skipped);
  const best128 = measured.filter((r) => r.count === 128).map((r) => `${r.backend}:${r.fps.toFixed(0)}fps`).join(' ');
  const msg = `${kind}: ${measured.length} cells (${ua}, dpr ${state.capabilities.dpr.toFixed(2)}, ${innerWidth}x${innerHeight})${best128 ? ` | 128-tile: ${best128}` : ''}`;
  return {
    message: msg.slice(0, 600),
    body: {
      kind,
      dpr: state.capabilities.dpr,
      viewport: [innerWidth, innerHeight],
      tier: state.capabilities.tier.tier,
      gpu: state.capabilities.gpuAdapterInfo,
      webgpuReason: state.capabilities.webgpuReason,
      cols: ['backend', 'count', 'size', 'mut', 'fps', 'p50', 'p95', 'p99', 'uploadMs', 'gpuMs', 'gpuKind', 'loafCount'],
      rows: compact,
    },
  };
}

function sendReport(kind = 'manual') {
  if (!state.results.size) {
    ui.status.textContent = 'Run at least one measurement before sending a report.';
    return;
  }
  const { message, body } = buildCompactReport(kind);
  if (window.__gfx?.report) {
    window.__gfx.report('perf-backends', message, body, true);
    ui.status.textContent = `Report queued (${state.results.size} rows). ${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '(Localhost does not upload beacons.)' : ''}`;
  } else {
    ui.status.textContent = 'Context guard reporter is not loaded on this page.';
  }
}

async function runPlan(plan, label, { windowMs = 1000, autoReport = false } = {}) {
  stopPreview();
  state.abort = false;
  setBusy(true);
  let done = 0;
  try {
    for (const step of plan) {
      if (state.abort) break;
      done++;
      ui.status.textContent = `${label} (${done}/${plan.length}): ${step.backend} | ${step.count} tiles | ${step.size} px | ${step.mut}% dirty...`;
      await measureCell({ ...step, windowMs });
      renderResultsTable();
      renderChart();
    }
    if (state.abort) {
      ui.status.textContent = `Stopped after ${done - 1} of ${plan.length} cells.`;
    } else {
      ui.status.textContent = `Finished ${plan.length} cell${plan.length === 1 ? '' : 's'}.`;
      if (autoReport) sendReport(label);
    }
  } finally {
    setBusy(false);
    // Leave the stage showing a clean 2D preview frame so it is never blank.
    if (!state.runner || state.runner.lost) {
      await mountScene('2d', Number(ui.countSel.value), Number(ui.sizeSel.value));
    }
  }
}

function renderResultsTable() {
  const rows = [...state.results.values()];
  if (!rows.length) {
    ui.resultsBody.innerHTML = '<tr><td colspan="10" class="note">No measurements yet. Press Run single config, Run backend sweep or Run full matrix.</td></tr>';
    return;
  }
  // Sort by size, mut, count, backend order for clean side-by-side comparison.
  const bOrder = new Map(BACKENDS.map((b, i) => [b.id, i]));
  rows.sort((a, b) => (a.size - b.size) || (a.mut - b.mut) || (a.count - b.count) || (bOrder.get(a.backend) - bOrder.get(b.backend)));

  const html = rows.map((r) => {
    const bLabel = BACKENDS.find((b) => b.id === r.backend)?.short ?? r.backend;
    if (r.skipped) {
      return `<tr>
        <td><b>${bLabel}</b></td>
        <td class="num">${r.count}</td>
        <td class="num">${r.size}px</td>
        <td class="num">${r.mut}%</td>
        <td colspan="6" class="note">skipped (${escapeHtml(r.reason)})</td>
      </tr>`;
    }
    const fpsCls = r.fps >= 54 ? 'good' : r.fps >= 28 ? 'mid' : 'bad';
    const gpuCell = r.gpuMs != null
      ? `${fmt(r.gpuMs, 2)} ms <span class="note">(${r.gpuTimerKind === 'queue-done' ? 'queue' : 'gpu'})</span>`
      : `<span class="note">not supported</span>`;
    const loafCell = !state.capabilities.loaf
      ? '<span class="note">n/a</span>'
      : r.loafCount === 0
        ? '0'
        : `${r.loafCount} (${fmt(r.loafScriptMs, 0)}/${fmt(r.loafStyleLayoutMs, 0)}/${fmt(r.loafPostMainMs, 0)} ms)`;
    return `<tr>
      <td><b>${bLabel}</b>${r.contextLost ? ' <span class="fail">(lost)</span>' : ''}</td>
      <td class="num">${r.count}</td>
      <td class="num">${r.size}px</td>
      <td class="num">${r.mut}%</td>
      <td class="num ${fpsCls}">${fmt(r.fps, 1)}</td>
      <td class="num">${fmt(r.p50, 1)} / ${fmt(r.p95, 1)} / ${fmt(r.p99, 1)}</td>
      <td class="num">${fmt(r.uploadMs, 2)}</td>
      <td class="num">${fmt(r.drawMs, 2)}</td>
      <td class="num">${gpuCell}</td>
      <td class="num">${loafCell}</td>
    </tr>`;
  }).join('');
  ui.resultsBody.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderChart() {
  const metric = ui.chartMetric.value; // 'p50' | 'fps' | 'uploadMs'
  const targetSize = Number(ui.chartSize.value);
  const targetMut = Number(ui.chartMut.value);
  const W = 680, H = 260;
  const padL = 56, padR = 20, padT = 24, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const series = BACKENDS.map((b) => {
    const pts = [];
    for (let i = 0; i < COUNTS.length; i++) {
      const c = COUNTS[i];
      const r = state.results.get(rowKey(b.id, c, targetSize, targetMut));
      if (r && !r.skipped && Number.isFinite(r[metric])) {
        pts.push({ idx: i, count: c, val: r[metric] });
      }
    }
    return { ...b, pts };
  });

  const allVals = series.flatMap((s) => s.pts.map((p) => p.val));
  const yMaxRaw = allVals.length ? Math.max(...allVals) : (metric === 'fps' ? 60 : 33);
  const yMax = metric === 'fps' ? Math.max(60, Math.ceil(yMaxRaw / 10) * 10) : Math.max(20, Math.ceil(yMaxRaw * 1.15));

  const xOf = (idx) => padL + (idx / (COUNTS.length - 1)) * plotW;
  const yOf = (val) => padT + plotH - (Math.min(val, yMax) / yMax) * plotH;

  const parts = [];
  // Gridlines
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = (yMax * t) / ticks;
    const y = yOf(v);
    parts.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-dasharray="${t === 0 ? '' : '3 3'}"/>`);
    parts.push(`<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="var(--mono)">${v.toFixed(v < 10 ? 1 : 0)}</text>`);
  }
  // 16.67 ms / 60 fps reference line
  if (metric === 'p50' && yMax >= 16.7) {
    const y16 = yOf(16.67);
    parts.push(`<line x1="${padL}" y1="${y16.toFixed(1)}" x2="${W - padR}" y2="${y16.toFixed(1)}" stroke="var(--accent)" stroke-dasharray="5 4" opacity="0.6"/>`);
    parts.push(`<text x="${W - padR}" y="${(y16 - 4).toFixed(1)}" text-anchor="end" fill="var(--accent)" font-size="10" font-family="var(--mono)">16.7 ms (60 fps)</text>`);
  } else if (metric === 'fps' && yMax >= 60) {
    const y60 = yOf(60);
    parts.push(`<line x1="${padL}" y1="${y60.toFixed(1)}" x2="${W - padR}" y2="${y60.toFixed(1)}" stroke="var(--ok)" stroke-dasharray="5 4" opacity="0.6"/>`);
    parts.push(`<text x="${W - padR}" y="${(y60 - 4).toFixed(1)}" text-anchor="end" fill="var(--ok)" font-size="10" font-family="var(--mono)">60 fps</text>`);
  }

  // X ticks
  for (let i = 0; i < COUNTS.length; i++) {
    const x = xOf(i);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${padT + plotH}" x2="${x.toFixed(1)}" y2="${padT + plotH + 5}" stroke="var(--line)"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${padT + plotH + 19}" text-anchor="middle" fill="var(--muted)" font-size="11" font-family="var(--mono)">${COUNTS[i]}</text>`);
  }
  parts.push(`<text x="${(padL + plotW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--muted)" font-size="11">Element count (${targetSize} px tiles, ${targetMut}% mutated)</text>`);

  // Series paths + points
  for (const s of series) {
    if (!s.pts.length) continue;
    const d = s.pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${xOf(p.idx).toFixed(1)},${yOf(p.val).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${s.colour}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of s.pts) {
      parts.push(`<circle cx="${xOf(p.idx).toFixed(1)}" cy="${yOf(p.val).toFixed(1)}" r="4" fill="${s.colour}"><title>${s.short} (${p.count}): ${p.val.toFixed(2)}</title></circle>`);
    }
  }

  // Legend
  let lx = padL;
  for (const s of series) {
    parts.push(`<rect x="${lx}" y="6" width="10" height="10" rx="2" fill="${s.colour}"/>`);
    parts.push(`<text x="${lx + 14}" y="15" fill="var(--fg)" font-size="11">${s.short}</text>`);
    lx += s.short.length * 7 + 34;
  }

  if (!allVals.length) {
    parts.push(`<text x="${(padL + plotW / 2).toFixed(1)}" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle" fill="var(--muted)" font-size="13">No data for ${targetSize} px, ${targetMut}% dirty yet</text>`);
  }

  ui.chartSvg.innerHTML = parts.join('');

  // Crossover summary note
  const crossovers = [];
  for (const c of COUNTS) {
    const valid = BACKENDS.map((b) => state.results.get(rowKey(b.id, c, targetSize, targetMut))).filter((r) => r && !r.skipped);
    if (valid.length >= 2) {
      valid.sort((a, b) => (metric === 'fps' ? b.fps - a.fps : a[metric] - b[metric]));
      const best = valid[0];
      crossovers.push(`${c}: ${best.backend} (${fmt(best[metric], metric === 'fps' ? 0 : 1)}${metric === 'fps' ? ' fps' : ' ms'})`);
    }
  }
  ui.chartNote.textContent = crossovers.length
    ? `Fastest per count (${targetSize} px, ${targetMut}% dirty): ${crossovers.join(' | ')}.`
    : 'Run a backend sweep to populate curves and compare crossover points.';
}

function toMarkdown() {
  const rows = [...state.results.values()];
  const header = [
    `Browser: ${navigator.userAgent}`,
    `DPR: ${state.capabilities.dpr} | Viewport: ${innerWidth}x${innerHeight} | Tier: ${state.capabilities.tier.tier} | GPU: ${state.capabilities.gpuAdapterInfo || 'unknown'}`,
    '',
    '| Backend | Count | Tile | Dirty | FPS | p50 / p95 / p99 (ms) | Upload (ms) | Draw (ms) | GPU timer | LoAFs (script/style/post) |',
    '|---|---:|---:|---:|---:|---|---:|---:|---|---|',
  ];
  for (const r of rows) {
    if (r.skipped) {
      header.push(`| ${r.backend} | ${r.count} | ${r.size}px | ${r.mut}% | skipped | ${r.reason} | | | | |`);
    } else {
      const gpu = r.gpuMs != null ? `${fmt(r.gpuMs, 2)} ms (${r.gpuTimerKind})` : 'not supported';
      const loaf = r.loafCount ? `${r.loafCount} (${fmt(r.loafScriptMs, 0)}/${fmt(r.loafStyleLayoutMs, 0)}/${fmt(r.loafPostMainMs, 0)} ms)` : '0';
      header.push(`| ${r.backend} | ${r.count} | ${r.size}px | ${r.mut}% | ${fmt(r.fps, 1)} | ${fmt(r.p50, 1)} / ${fmt(r.p95, 1)} / ${fmt(r.p99, 1)} | ${fmt(r.uploadMs, 2)} | ${fmt(r.drawMs, 2)} | ${gpu} | ${loaf} |`);
    }
  }
  return header.join('\n');
}

// ============================================================================
// Isolated live checks (wait for tap via <meta name="checks" content="tap">)
// ============================================================================

function copyAndMeasureInk(sourceCanvas) {
  const copy = document.createElement('canvas');
  copy.width = Math.max(1, sourceCanvas.width);
  copy.height = Math.max(1, sourceCanvas.height);
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(sourceCanvas, 0, 0);
  const frac = inkFraction(cc);
  window.__gfx?.retire(copy);
  return frac;
}

function buildChecks() {
  return [
    {
      name: '2D drawElementImage() draws a 64 px tile with 5 arguments',
      why: 'Confirms the 2D route renders non-transparent pixels on an isolated fixture without reading the drawable canvas directly.',
      run: async () => {
        if (!supported2D) throw new Error('drawElementImage() is not supported in this browser');
        const host = testStage();
        const c = document.createElement('canvas');
        c.setAttribute('content', 'drawable');
        c.setAttribute('layoutsubtree', '');
        c.width = 128; c.height = 128;
        c.style.cssText = 'width:128px;height:128px;display:block';
        const [tile] = makeTiles(1, 64);
        c.append(tile);
        host.append(c);
        const ctx = c.getContext('2d');
        await new Promise((resolve) => {
          c.addEventListener('paint', () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, 128, 128);
            ctx.drawElementImage(tile, 16, 16, 64, 64);
            resolve();
          }, { once: true });
          c.requestPaint();
        });
        const frac = copyAndMeasureInk(c);
        if (frac < 0.05) throw new Error(`expected ink >= 5%, measured ${(frac * 100).toFixed(1)}%`);
        return `drew 64x64 tile (${(frac * 100).toFixed(1)}% ink via plain 2D copy)`;
      },
    },
    {
      name: 'WebGL2 texElementSubImage2D() via ElementGL draws a textured quad',
      why: 'Verifies the WebGL2 route uploads an element through ElementGL and updates element geometry.',
      run: async () => {
        if (!supportedGL || !webgl2()) throw new Error('WebGL2 texElementSubImage2D() is not available');
        const host = testStage();
        const c = document.createElement('canvas');
        c.setAttribute('content', 'drawable');
        c.setAttribute('layoutsubtree', '');
        c.style.cssText = 'width:140px;height:140px;display:block';
        const [tile] = makeTiles(1, 64);
        c.append(tile);
        host.append(c);
        const glStage = new ElementGL(c, { fragment: GL_FRAG });
        try {
          await new Promise((resolve) => {
            c.addEventListener('paint', () => {
              glStage.upload(tile);
              glStage.begin();
              const m = ElementGL.rect(c, 20, 20, 64, 64);
              glStage.quad(tile, m, (gl, u) => gl.uniform1f(u('uPulse'), 0.5));
              if (typeof c.updateElementGeometry === 'function') {
                const unit = geometryUnit(c, tile, 64);
                c.updateElementGeometry(tile, { canvasTransform: new DOMMatrix().scale(unit).translate(20, 20) });
              }
              resolve();
            }, { once: true });
            c.requestPaint();
          });
          const frac = copyAndMeasureInk(c);
          if (frac < 0.05) throw new Error(`expected ink >= 5%, measured ${(frac * 100).toFixed(1)}%`);
          const ext = glStage.gl.getExtension('EXT_disjoint_timer_query_webgl2');
          return `drew quad (${(frac * 100).toFixed(1)}% ink); EXT_disjoint_timer_query_webgl2: ${ext ? 'available' : 'not supported'}`;
        } finally {
          glStage.dispose();
        }
      },
    },
    {
      name: 'WebGPU drawElementImageToTexture() compiles WGSL and renders off-screen',
      why: 'Uses checkDevice() and GPUCanvas({ present: false }) so WGSL and texture upload are verified even on software adapters.',
      timeout: 8000,
      run: async () => {
        if (!supportedGPU) throw new Error(`WebGPU element upload unavailable (${gpuMethod ?? 'no GPUQueue method'})`);
        const gpu = await checkDevice();
        if (!gpu) throw new Error(webgpu.reason || 'no WebGPU device available');
        const { device, format } = gpu;
        const mod = await checkWGSL(device, WGSL_SHADER, 'check');
        const host = testStage();
        const c = document.createElement('canvas');
        c.setAttribute('content', 'drawable');
        c.setAttribute('layoutsubtree', '');
        c.width = 128; c.height = 128;
        c.style.cssText = 'width:128px;height:128px;display:block';
        const [tile] = makeTiles(1, 64);
        c.append(tile);
        host.append(c);
        const gpuCanvas = new GPUCanvas(c, gpu, { present: false });
        const elemTex = new GPUElementTexture(device, c, tile);
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const uBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const bgl0 = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          ],
        });
        const bgl1 = device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }],
        });
        const pipe = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] }),
          vertex: { module: mod, entryPoint: 'vs' },
          fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend: BLEND_OVER }] },
          primitive: { topology: 'triangle-strip' },
        });
        try {
          await nextPaint(c);
          elemTex.update();
          const uData = new Float32Array(20);
          writeClipMatrix({ a: 64, b: 0, c: 0, d: 64, tx: 16, ty: 16 }, 128, 128, uData);
          uData[16] = 0.25; uData[17] = 0.5; uData[18] = 64; uData[19] = 64;
          device.queue.writeBuffer(uBuf, 0, uData);
          const bg0 = device.createBindGroup({
            layout: bgl0,
            entries: [{ binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: sampler }],
          });
          const bg1 = device.createBindGroup({
            layout: bgl1,
            entries: [{ binding: 0, resource: elemTex.view }],
          });
          const enc = device.createCommandEncoder();
          const pass = enc.beginRenderPass({
            colorAttachments: [{ view: gpuCanvas.view(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
          });
          pass.setPipeline(pipe);
          pass.setBindGroup(0, bg0);
          pass.setBindGroup(1, bg1);
          pass.draw(4);
          pass.end();
          device.queue.submit([enc.finish()]);
          if (typeof c.updateElementGeometry === 'function') {
            c.updateElementGeometry(tile, { canvasTransform: new DOMMatrix().translate(16, 16) });
          }
          const img = await gpuCanvas.read();
          const frac = inkFraction(img);
          if (frac < 0.05) throw new Error(`expected ink >= 5%, measured ${(frac * 100).toFixed(1)}%`);
          const tsNote = device.features.has('timestamp-query')
            ? 'timestamp-query enabled'
            : gpu.adapter.features.has('timestamp-query')
              ? 'adapter has timestamp-query (shared device uses onSubmittedWorkDone)'
              : 'timestamp-query not supported';
          return `${gpuMethod}() drew off-screen (${(frac * 100).toFixed(1)}% ink, ${gpu.software ? 'software adapter' : 'hardware adapter'}; ${tsNote})`;
        } finally {
          elemTex.destroy();
          uBuf.destroy();
          gpuCanvas.destroy();
        }
      },
    },
    {
      name: 'Shared-GL copy bridge transfers 2D -> ElementGL -> 2D',
      why: 'Confirms the copy bridge path renders pixels back to the visible 2D canvas using ElementGL.',
      run: async () => {
        if (!supported2D || !webgl2()) throw new Error('needs both 2D drawElementImage() and WebGL2');
        const host = testStage();
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:140px;height:140px';
        host.append(wrap);
        const bridge = createBridgeBackend(wrap);
        try {
          const [tile] = makeTiles(1, 64);
          bridge.mount([tile], 64);
          await raf();
          await bridge.renderFrame(0.5, new Set([0]), true);
          const frac = copyAndMeasureInk(bridge.canvas);
          if (frac < 0.05) throw new Error(`expected ink >= 5%, measured ${(frac * 100).toFixed(1)}%`);
          return `bridge composited back to 2D (${(frac * 100).toFixed(1)}% ink)`;
        } finally {
          bridge.dispose();
        }
      },
    },
    {
      name: 'Hit-test geometry moves after updateElementGeometry()',
      why: 'Checks that moving a tile and toggling an attribute updates its bounding box in WebGL2.',
      run: async () => {
        if (!supportedGL || !webgl2() || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('WebGL2 or updateElementGeometry() unavailable');
        }
        const host = testStage();
        const c = document.createElement('canvas');
        c.setAttribute('content', 'drawable');
        c.setAttribute('layoutsubtree', '');
        c.style.cssText = 'width:180px;height:140px;display:block';
        const [tile] = makeTiles(1, 64);
        c.append(tile);
        host.append(c);
        const glStage = new ElementGL(c, { fragment: GL_FRAG });
        try {
          await new Promise((resolve) => {
            c.addEventListener('paint', () => {
              glStage.upload(tile);
              glStage.begin();
              glStage.quad(tile, ElementGL.rect(c, 80, 40, 64, 64));
              const unit = geometryUnit(c, tile, 64);
              c.updateElementGeometry(tile, { canvasTransform: new DOMMatrix().scale(unit).translate(80, 40) });
              tile.toggleAttribute('data-hit-moved');
              resolve();
            }, { once: true });
            c.requestPaint();
          });
          const cr = c.getBoundingClientRect();
          const tr = tile.getBoundingClientRect();
          const dx = Math.round(tr.left - cr.left);
          const dy = Math.round(tr.top - cr.top);
          if (Math.abs(dx - 80) > 6 || Math.abs(dy - 40) > 6) {
            throw new Error(`expected offset near (80, 40), got (${dx}, ${dy})`);
          }
          return `bounding box moved to (${dx}, ${dy}) px inside canvas`;
        } finally {
          glStage.dispose();
        }
      },
    },
    {
      name: 'Timing APIs reported on this device',
      why: 'Reports Long Animation Frames support, device tier and GPU adapter status.',
      run: async () => {
        const gpuInfo = await softwareGpu();
        return `LoAF: ${state.capabilities.loaf ? 'yes' : 'no'}; tier: ${state.capabilities.tier.tier}; DPR: ${state.capabilities.dpr.toFixed(2)}; WebGPU adapter: ${gpuInfo.webgpu ? (gpuInfo.fallback ? 'software' : 'hardware') : 'none'} (${gpuInfo.detail || 'no info'})`;
      },
    },
    stillDrawn(() => [{
      name: 'Benchmark stage',
      ink: async () => {
        if (!state.runner?.canvas) return null;
        return copyAndMeasureInk(state.runner.canvas);
      },
      rescue: () => {
        showStageAlert('The benchmark canvas became blank after checks ran. Press Start live preview or Run to draw again.');
      },
    }]),
  ];
}

async function init() {
  banner();
  state.capabilities.webgl2 = webgl2();
  const tier = state.capabilities.tier;

  const renderDeviceInfo = (gpuLabel) => {
    ui.deviceInfo.textContent = [
      `Tier: ${tier.tier} (${tier.source})`,
      `DPR: ${state.capabilities.dpr.toFixed(2)}`,
      `Viewport: ${innerWidth}×${innerHeight}`,
      `LoAF: ${state.capabilities.loaf ? 'supported' : 'not supported'}`,
      `WebGL2 upload: ${supportedGL && state.capabilities.webgl2 ? 'supported' : 'no'}`,
      `WebGPU upload: ${supportedGPU ? `${gpuMethod}() (${gpuLabel})` : 'no'}`,
    ].join(' · ');
  };
  renderDeviceInfo('probing adapter…');

  // Start on the lightest route immediately: 2D, 8 tiles, 64 px, one crisp initial frame (no heavy loop on load).
  if (supported2D) {
    await mountScene('2d', Number(ui.countSel.value), Number(ui.sizeSel.value));
    ui.status.textContent = 'Ready on 2D (8 tiles, 64 px). Press Run backend sweep to compare all four routes.';
  } else {
    showStageAlert('HTML-in-canvas is not available in this browser. Turn on chrome://flags/#canvas-draw-element to run the benchmark.');
    ui.status.textContent = 'API unavailable in this browser.';
    setBusy(false);
  }

  softwareGpu().then((gpuProbe) => {
    state.capabilities.gpuAdapterInfo = gpuProbe.detail || (gpuProbe.webgpu ? (gpuProbe.fallback ? 'software' : 'hardware') : 'none');
    renderDeviceInfo(gpuProbe.fallback ? 'software adapter, off-screen checks only' : (gpuProbe.detail || 'adapter present'));
  }).catch(() => {
    state.capabilities.gpuAdapterInfo = 'none';
    renderDeviceInfo('probe failed');
  });

  renderResultsTable();
  renderChart();

  ui.btnPreview.addEventListener('click', startPreview);

  ui.btnRunOne.addEventListener('click', () => {
    const step = {
      backend: ui.backendSel.value,
      count: Number(ui.countSel.value),
      size: Number(ui.sizeSel.value),
      mut: Number(ui.mutSel.value),
    };
    ui.chartSize.value = String(step.size);
    ui.chartMut.value = String(step.mut);
    runPlan([step], 'Single config', { windowMs: 1200, autoReport: false });
  });

  ui.btnSweep.addEventListener('click', () => {
    const size = Number(ui.sizeSel.value);
    const mut = Number(ui.mutSel.value);
    ui.chartSize.value = String(size);
    ui.chartMut.value = String(mut);
    // Grouped by backend so each GPU context is opened once for the sweep.
    const plan = [];
    for (const b of BACKENDS) {
      for (const count of COUNTS) {
        plan.push({ backend: b.id, count, size, mut });
      }
    }
    runPlan(plan, `Backend sweep (${size}px, ${mut}% dirty)`, { windowMs: 900, autoReport: true });
  });

  ui.btnMatrix.addEventListener('click', () => {
    const plan = [];
    for (const b of BACKENDS) {
      for (const size of SIZES) {
        for (const mut of MUTATIONS) {
          for (const count of COUNTS) {
            plan.push({ backend: b.id, count, size, mut });
          }
        }
      }
    }
    runPlan(plan, 'Full matrix', { windowMs: 700, autoReport: true });
  });

  ui.btnStop.addEventListener('click', () => { state.abort = true; });
  ui.btnSend.addEventListener('click', () => sendReport('manual'));

  ui.btnCopyJson.addEventListener('click', async () => {
    const payload = {
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      capabilities: state.capabilities,
      results: [...state.results.values()],
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      ui.status.textContent = 'Copied JSON results to clipboard.';
    } catch {
      ui.status.textContent = 'Could not copy to clipboard.';
    }
  });

  ui.btnCopyMd.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown());
      ui.status.textContent = 'Copied Markdown table to clipboard.';
    } catch {
      ui.status.textContent = 'Could not copy to clipboard.';
    }
  });

  for (const sel of [ui.backendSel, ui.countSel, ui.sizeSel, ui.mutSel]) {
    sel.addEventListener('change', async () => {
      if (state.running) return;
      if (state.previewing) {
        stopPreview();
        await startPreview();
      } else if (supported2D) {
        await mountScene(ui.backendSel.value, Number(ui.countSel.value), Number(ui.sizeSel.value));
      }
    });
  }

  for (const sel of [ui.chartMetric, ui.chartSize, ui.chartMut]) {
    sel.addEventListener('change', renderChart);
  }

  runTests(ui.checksBody, buildChecks());
}

init();
