import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const SLICES = 64;
const MASK_W = 128;
const MASK_H = 128;
const MAX_RING_SIDE = 512;

const stageEl = document.getElementById('ss-stage');
const canvas = document.getElementById('ss-canvas');
const panelEl = document.getElementById('ss-panel');
const trackEl = document.getElementById('ss-track');
const clockEl = document.getElementById('ss-clock');
const typeInput = document.getElementById('ss-type');
const echoEl = document.getElementById('ss-echo');
const invertBtn = document.getElementById('ss-invert-btn');
const pulseBtn = document.getElementById('ss-pulse-btn');
const pulseFlashEl = document.getElementById('ss-pulse-flash');
const tapBtn = document.getElementById('ss-tap-btn');
const speedInput = document.getElementById('ss-speed');
const articleEl = document.getElementById('ss-article');

const modeBtns = [...document.querySelectorAll('.ss-modes button[data-mode]')];
const brushToolsEl = document.getElementById('ss-brush-tools');
const brushBtns = [...document.querySelectorAll('.ss-brush-tools button[data-brush]')];
const clearMaskBtn = document.getElementById('ss-clear-mask');
const brushSizeInput = document.getElementById('ss-brush-size');
const depthInput = document.getElementById('ss-depth');
const depthOut = document.getElementById('ss-depth-out');
const strideInput = document.getElementById('ss-stride');
const strideOut = document.getElementById('ss-stride-out');
const pauseBtn = document.getElementById('ss-pause-btn');
const timeMapInput = document.getElementById('ss-timemap');
const telemetryEl = document.getElementById('ss-telemetry');
const noticeEl = document.getElementById('ss-notice');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const say = (text) => {
  noticeEl.hidden = false;
  noticeEl.textContent = text;
};
const clearNotice = () => {
  noticeEl.hidden = true;
  noticeEl.textContent = '';
};

// #region shader
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2D uTex;
uniform sampler2DArray uRing;
uniform sampler2D uMask;
uniform vec2 uSize;
uniform float uTime;

uniform int uMode;
uniform int uHead;
uniform int uSlices;
uniform int uFilled;
uniform float uDepth;
uniform vec2 uCenter;
uniform float uAspect;
uniform int uShowMap;
uniform int uForcedSlice;

in vec2 vUv;
out vec4 outColor;

vec4 sampleAge(float ageSlices) {
  if (uFilled <= 1 || ageSlices <= 0.001) {
    return texture(uTex, vUv);
  }
  float maxAge = float(uFilled - 1);
  float age = clamp(ageSlices, 0.0, maxAge);
  float a0 = floor(age);
  float a1 = min(a0 + 1.0, maxAge);
  float frac = age - a0;

  int idx0 = (uHead - int(a0) + uSlices) % uSlices;
  int idx1 = (uHead - int(a1) + uSlices) % uSlices;

  vec4 c0 = (a0 < 0.5) ? texture(uTex, vUv) : texture(uRing, vec3(vUv, float(idx0)));
  vec4 c1 = (a1 < 0.5) ? texture(uTex, vUv) : texture(uRing, vec3(vUv, float(idx1)));
  return mix(c0, c1, frac);
}

void main() {
  if (uForcedSlice >= 0) {
    outColor = texture(uRing, vec3(vUv, float(uForcedSlice)));
    return;
  }

  float normDelay = 0.0;
  float brushEdge = 0.0;

  if (uMode == 0) {
    // Vertical slit-scan: top is now, bottom is uDepth slices in the past.
    normDelay = vUv.y;
  } else if (uMode == 1) {
    // Radial time ripple: centre is now, concentric rings delay outward.
    vec2 dVec = (vUv - uCenter) * vec2(max(uAspect, 0.5), 1.0);
    float dist = length(dVec);
    float ripple = 0.06 * sin(dist * 20.0 - uTime * 3.4) * smoothstep(0.02, 0.18, dist);
    normDelay = clamp(dist * 1.18 + ripple, 0.0, 1.0);
  } else if (uMode == 2) {
    // Diagonal shear ribbon sweeping across live controls.
    float diag = (vUv.x * 0.62 + vUv.y * 0.78) / 1.4;
    float wave = 0.11 * sin(vUv.y * 6.28318 + uTime * 1.8);
    normDelay = clamp(diag + wave, 0.0, 1.0);
  } else {
    // Mode 3: custom R8 delay mask painted directly on the canvas.
    normDelay = texture(uMask, vUv).r;
    float mx = texture(uMask, clamp(vUv + vec2(0.012, 0.0), 0.0, 1.0)).r - normDelay;
    float my = texture(uMask, clamp(vUv + vec2(0.0, 0.012), 0.0, 1.0)).r - normDelay;
    brushEdge = smoothstep(0.05, 0.24, length(vec2(mx, my)));
  }

  vec4 col = sampleAge(normDelay * uDepth);

  if (uMode == 3 && brushEdge > 0.01) {
    vec3 rim = vec3(0.88, 0.34, 0.15) * col.a;
    col.rgb = mix(col.rgb, rim, brushEdge * 0.45);
  }

  if (uShowMap == 1) {
    vec3 tint = mix(vec3(0.14, 0.48, 0.92), vec3(0.92, 0.32, 0.14), normDelay) * col.a;
    col.rgb = mix(col.rgb, tint, 0.28 + 0.14 * normDelay);
  }

  outColor = col;
}`;
// #endregion shader

const state = {
  mode: 0,
  brushTool: 'freeze', // 'freeze' | 'erase' | 'interact'
  brushRadius: Number(brushSizeInput.value),
  depth: Number(depthInput.value),
  stride: Number(strideInput.value),
  showMap: false,
  paused: false,
  centerX: 0.5,
  centerY: 0.5,
  taps: 0,
  frameCount: 0,
  fps: 0,
  fpsFrames: 0,
  fpsAt: performance.now(),
  clockStart: performance.now(),
  clockPausedElapsed: 0,
  isVisible: true,
  forceCapture: true,
  maskSeeded: false,
};

let route = 'plain';
let stage = null;
let ctx2d = null;
let rafId = 0;
let lastTelemetryAt = 0;

// #region ring-buffer
const ring = {
  tex: null,
  srcFbo: null,
  scratchTex: null,
  scratchFbo: null,
  w: 0,
  h: 0,
  head: 0,
  filled: 0,
  attachedTex: null,
  attachedW: 0,
  attachedH: 0,
  liveW: 0,
  liveH: 0,
};

function computeRingSize(srcW, srcH) {
  const maxBytes = (window.innerWidth < 700 ? 24 : 32) * 1024 * 1024;
  const maxPixels = Math.floor(maxBytes / (4 * SLICES));
  const area = Math.max(1, srcW * srcH);
  const scale = Math.min(1, MAX_RING_SIDE / srcW, MAX_RING_SIDE / srcH, Math.sqrt(maxPixels / area));
  let w = Math.max(16, Math.floor((srcW * scale) / 2) * 2);
  let h = Math.max(16, Math.floor((srcH * scale) / 2) * 2);
  while (w * h * 4 * SLICES > maxBytes && w > 16 && h > 16) {
    w = Math.max(16, w - 2);
    h = Math.max(16, h - 2);
  }
  return { w, h };
}

function disposeRing(gl) {
  if (gl && !gl.isContextLost()) {
    if (ring.tex) gl.deleteTexture(ring.tex);
    if (ring.scratchTex) gl.deleteTexture(ring.scratchTex);
    if (ring.srcFbo) gl.deleteFramebuffer(ring.srcFbo);
    if (ring.scratchFbo) gl.deleteFramebuffer(ring.scratchFbo);
  }
  ring.tex = null;
  ring.scratchTex = null;
  ring.srcFbo = null;
  ring.scratchFbo = null;
  ring.w = 0;
  ring.h = 0;
  ring.head = 0;
  ring.filled = 0;
  ring.attachedTex = null;
  ring.attachedW = 0;
  ring.attachedH = 0;
}

function ensureRing(gl, srcW, srcH) {
  const target = computeRingSize(srcW, srcH);
  if (ring.tex && ring.w === target.w && ring.h === target.h) return;

  disposeRing(gl);
  ring.w = target.w;
  ring.h = target.h;

  ring.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring.tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, ring.w, ring.h, SLICES);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

  ring.srcFbo = gl.createFramebuffer();

  ring.scratchTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ring.scratchTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ring.w, ring.h);
  gl.bindTexture(gl.TEXTURE_2D, null);

  ring.scratchFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, ring.scratchFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ring.scratchTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function pushRingSlice(gl, liveTex) {
  ring.liveW = liveTex.w;
  ring.liveH = liveTex.h;
  ensureRing(gl, liveTex.w, liveTex.h);

  if (ring.filled === 0) {
    ring.head = 0;
    ring.filled = 1;
  } else {
    ring.head = (ring.head + 1) % SLICES;
    ring.filled = Math.min(SLICES, ring.filled + 1);
  }

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ring.srcFbo);
  if (ring.attachedTex !== liveTex.tex || ring.attachedW !== liveTex.w || ring.attachedH !== liveTex.h) {
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, liveTex.tex, 0);
    ring.attachedTex = liveTex.tex;
    ring.attachedW = liveTex.w;
    ring.attachedH = liveTex.h;
  }

  let readFbo = ring.srcFbo;
  if (liveTex.w !== ring.w || liveTex.h !== ring.h) {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, ring.scratchFbo);
    gl.blitFramebuffer(0, 0, liveTex.w, liveTex.h, 0, 0, ring.w, ring.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    readFbo = ring.scratchFbo;
  }

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring.tex);
  gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, ring.head, 0, 0, ring.w, ring.h);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
}
// #endregion ring-buffer

// #region brush
const maskData = new Uint8Array(MASK_W * MASK_H);
let maskTex = null;
let maskDirty = true;

function ensureMask(gl) {
  if (maskTex) return;
  maskTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_W, MASK_H, 0, gl.RED, gl.UNSIGNED_BYTE, maskData);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.bindTexture(gl.TEXTURE_2D, null);
  maskDirty = false;
}

function uploadMaskIfDirty(gl) {
  ensureMask(gl);
  if (!maskDirty) return;
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MASK_W, MASK_H, gl.RED, gl.UNSIGNED_BYTE, maskData);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.activeTexture(gl.TEXTURE0);
  maskDirty = false;
}

function disposeMask(gl) {
  if (gl && maskTex && !gl.isContextLost()) gl.deleteTexture(maskTex);
  maskTex = null;
  maskDirty = true;
}

function stampMask(normX, normY, radiusPx, value) {
  const cx = clamp(normX, 0, 1) * (MASK_W - 1);
  const cy = clamp(normY, 0, 1) * (MASK_H - 1);
  const r = Math.max(2, radiusPx);
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(MASK_W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(MASK_H - 1, Math.ceil(cy + r));

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const row = y * MASK_W;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / r;
      const strength = falloff * falloff * (3 - 2 * falloff);
      const idx = row + x;
      const cur = maskData[idx];
      if (value > 0) {
        const next = Math.round(cur + (value - cur) * Math.min(1, strength * 0.85));
        if (next > cur) maskData[idx] = next;
      } else {
        const next = Math.round(cur * (1 - Math.min(1, strength * 0.9)));
        if (next < cur) maskData[idx] = next;
      }
    }
  }
  maskDirty = true;
}

function paintBrushStroke(x0, y0, x1, y1) {
  const value = state.brushTool === 'erase' ? 0 : 255;
  const steps = Math.max(1, Math.ceil(Math.hypot((x1 - x0) * MASK_W, (y1 - y0) * MASK_H) / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampMask(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, state.brushRadius, value);
  }
  state.maskSeeded = true;
  if (state.paused && route === 'webgl') canvas.requestPaint?.();
}

function seedStarterFreezePocket() {
  stampMask(0.68, 0.56, 28, 255);
  stampMask(0.58, 0.42, 20, 220);
  state.maskSeeded = true;
}

function clearBrushMask() {
  maskData.fill(0);
  maskDirty = true;
  state.maskSeeded = true;
  if (route === 'webgl') canvas.requestPaint?.();
}
// #endregion brush

function estimatedVramMB() {
  if (route !== 'webgl' || !ring.w || !ring.h) return 0;
  const ringBytes = ring.w * ring.h * 4 * SLICES;
  const scratchBytes = ring.w * ring.h * 4;
  const liveBytes = ring.liveW * ring.liveH * 4;
  const maskBytes = MASK_W * MASK_H;
  return (ringBytes + scratchBytes + liveBytes + maskBytes) / (1024 * 1024);
}

function updateTelemetry(force = false) {
  const now = performance.now();
  if (!force && now - lastTelemetryAt < 250) return;
  lastTelemetryAt = now;
  const openSnaps = window.__gfx?.snapshots?.open ?? 0;
  const routeLabel = route === 'webgl' ? 'WebGL 2 (ElementGL)' : route === '2d' ? '2D fallback' : 'Plain HTML fallback';
  if (route === 'webgl') {
    const vram = estimatedVramMB().toFixed(1);
    const dims = ring.w ? `${ring.w}x${ring.h}` : 'allocating';
    const pausedTag = state.paused ? ' · paused' : !state.isVisible ? ' · offscreen' : '';
    telemetryEl.textContent =
      `Route: ${routeLabel} · Ring slices: ${ring.filled}/${SLICES} (${dims}) · ` +
      `openSnapshots: ${openSnaps} · VRAM: ~${vram} MB · ${state.fps} fps · Head: #${ring.head}${pausedTag}`;
  } else {
    telemetryEl.textContent = `Route: ${routeLabel} · openSnapshots: ${openSnaps}`;
  }
}

function enterPlainFallback(reason) {
  route = 'plain';
  stageEl.classList.add('plain');
  stageEl.append(panelEl);
  say(reason);
  updateTelemetry(true);
}

if (supported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: FRAGMENT,
      onLost: () => {
        disposeRing(null);
        disposeMask(null);
        say('The WebGL context was lost. It will rebuild the 64-slice ring buffer when the browser restores it.');
      },
      onRestored: () => {
        clearNotice();
        state.forceCapture = true;
        canvas.requestPaint?.();
      },
    });
    route = 'webgl';
  } catch (err) {
    say(`WebGL could not start (${err.message}).`);
  }
}

if (route === 'plain' && supported) {
  try {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      route = '2d';
      say('WebGL texElementSubImage2D() is not available here, so the demo is using a 2D drawElementImage() fallback without the 64-slice ring buffer.');
    }
  } catch {}
}

if (route === 'plain') {
  enterPlainFallback('HTML-in-canvas is not available here, so the panel is shown as plain HTML without slit-scan time displacement.');
}

// #region paint
const lastGeo = new WeakMap();
function syncGeometry(el, x, y, unit) {
  const key = `${Math.round(x)},${Math.round(y)},${el.offsetWidth},${el.offsetHeight},${unit.toFixed(3)}`;
  if (lastGeo.get(el) === key) return;
  lastGeo.set(el, key);
  canvas.updateElementGeometry(el, {
    canvasTransform: new DOMMatrix().scale(unit).translate(x, y),
  });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

canvas.addEventListener('paint', () => {
  if (route === 'plain') return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;

  if (route === 'webgl' && stage && !stage.lost) {
    const gl = stage.gl;
    const shouldCapture = !state.paused || ring.filled === 0;
    let liveTex = null;

    if (shouldCapture) {
      liveTex = stage.upload(panelEl);
      if (liveTex && (state.forceCapture || state.frameCount % state.stride === 0 || ring.filled === 0)) {
        pushRingSlice(gl, liveTex);
        state.forceCapture = false;
      }
      state.frameCount++;
    } else if (!stage.has(panelEl)) {
      liveTex = stage.upload(panelEl);
      if (liveTex) pushRingSlice(gl, liveTex);
    }

    uploadMaskIfDirty(gl);
    if (!stage.begin([0.08, 0.09, 0.12, 1])) return;

    stage.quad(panelEl, ElementGL.rect(canvas, 0, 0, cw, ch), (g, uniform) => {
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D_ARRAY, ring.tex);
      g.uniform1i(uniform('uRing'), 1);

      g.activeTexture(g.TEXTURE2);
      g.bindTexture(g.TEXTURE_2D, maskTex);
      g.uniform1i(uniform('uMask'), 2);

      g.uniform1i(uniform('uMode'), state.mode);
      g.uniform1i(uniform('uHead'), ring.head);
      g.uniform1i(uniform('uSlices'), SLICES);
      g.uniform1i(uniform('uFilled'), ring.filled);
      g.uniform1f(uniform('uDepth'), state.depth);
      g.uniform2f(uniform('uCenter'), state.centerX, state.centerY);
      g.uniform1f(uniform('uAspect'), cw / ch);
      g.uniform1i(uniform('uShowMap'), state.showMap ? 1 : 0);
      g.uniform1i(uniform('uForcedSlice'), -1);
      g.activeTexture(g.TEXTURE0);
    });

    const unit = geometryUnit(canvas, panelEl, panelEl.offsetWidth || cw);
    syncGeometry(panelEl, 0, 0, unit);

    state.fpsFrames++;
    const now = performance.now();
    if (now - state.fpsAt >= 500) {
      state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsAt));
      state.fpsFrames = 0;
      state.fpsAt = now;
    }
    updateTelemetry();
    return;
  }

  if (route === '2d' && ctx2d) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx2d.reset();
    ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, cw, ch);
    ctx2d.drawElementImage(panelEl, 0, 0, panelEl.offsetWidth || cw, panelEl.offsetHeight || ch);
    const unit = geometryUnit(canvas, panelEl, panelEl.offsetWidth || cw);
    syncGeometry(panelEl, 0, 0, unit);
    updateTelemetry();
  }
});
// #endregion paint

// Continuous capture loop that pauses offscreen or when hidden.
function tickLoop(now) {
  rafId = 0;
  if (!state.isVisible || document.hidden || state.paused) return;

  const elapsed = (now - state.clockStart) / 1000;
  clockEl.textContent = `${(elapsed % 100).toFixed(2).padStart(5, '0')}s`;

  if (route !== 'plain') canvas.requestPaint?.();
  rafId = requestAnimationFrame(tickLoop);
}

function syncLoop() {
  const shouldRun = state.isVisible && !document.hidden && !state.paused;
  panelEl.classList.toggle('is-paused', !shouldRun);
  if (shouldRun && !rafId) {
    state.clockStart = performance.now() - state.clockPausedElapsed;
    rafId = requestAnimationFrame(tickLoop);
  } else if (!shouldRun && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
    state.clockPausedElapsed = performance.now() - state.clockStart;
  }
  updateTelemetry(true);
}

const visibilityObserver = new IntersectionObserver(
  ([entry]) => {
    state.isVisible = Boolean(entry?.isIntersecting);
    syncLoop();
  },
  { rootMargin: '80px' }
);
visibilityObserver.observe(stageEl);
document.addEventListener('visibilitychange', syncLoop);

// Keep pendulum track travel matched to actual rendered track width.
const trackObserver = new ResizeObserver(([entry]) => {
  const w = Math.max(80, Math.round(entry.contentRect.width));
  panelEl.style.setProperty('--ss-track-w', `${w}px`);
});
trackObserver.observe(trackEl);

const stageObserver = new ResizeObserver(() => {
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
});
stageObserver.observe(stageEl);

// Interactive controls inside the live DOM panel.
let kickTimer = 0;
typeInput.addEventListener('input', () => {
  echoEl.textContent = typeInput.value || ' ';
  echoEl.classList.add('is-kicked');
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => echoEl.classList.remove('is-kicked'), 140);
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
});

invertBtn.addEventListener('click', () => {
  panelEl.classList.toggle('is-dark');
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
});

pulseBtn.addEventListener('click', () => {
  pulseFlashEl.classList.remove('is-running');
  void pulseFlashEl.offsetWidth;
  pulseFlashEl.classList.add('is-running');
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
});

tapBtn.addEventListener('click', () => {
  state.taps++;
  tapBtn.textContent = `Tap count: ${state.taps}`;
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
});

speedInput.addEventListener('input', () => {
  panelEl.style.setProperty('--ss-period', `${Number(speedInput.value).toFixed(1)}s`);
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
});

articleEl.addEventListener('scroll', () => {
  state.forceCapture = true;
  if (route !== 'plain') canvas.requestPaint?.();
}, { passive: true });

// External mode and brush controls.
function syncBrushClass() {
  const painting = state.mode === 3 && state.brushTool !== 'interact';
  stageEl.classList.toggle('brush-painting', painting);
}

function setMode(mode) {
  state.mode = mode;
  for (const btn of modeBtns) btn.setAttribute('aria-pressed', String(Number(btn.dataset.mode) === mode));
  brushToolsEl.hidden = mode !== 3;
  if (mode === 3 && !state.maskSeeded) seedStarterFreezePocket();
  syncBrushClass();
  if (route === 'webgl') canvas.requestPaint?.();
}

for (const btn of modeBtns) {
  btn.addEventListener('click', () => setMode(Number(btn.dataset.mode)));
}

for (const btn of brushBtns) {
  btn.addEventListener('click', () => {
    state.brushTool = btn.dataset.brush;
    for (const other of brushBtns) other.setAttribute('aria-pressed', String(other === btn));
    syncBrushClass();
  });
}

clearMaskBtn.addEventListener('click', clearBrushMask);
brushSizeInput.addEventListener('input', () => {
  state.brushRadius = Number(brushSizeInput.value);
});

depthInput.addEventListener('input', () => {
  state.depth = Number(depthInput.value);
  depthOut.textContent = `${state.depth} slices`;
  if (route === 'webgl') canvas.requestPaint?.();
});

strideInput.addEventListener('input', () => {
  state.stride = Number(strideInput.value);
  strideOut.textContent = state.stride === 1 ? 'every frame' : `every ${state.stride} frames`;
});

pauseBtn.addEventListener('click', () => {
  state.paused = !state.paused;
  pauseBtn.setAttribute('aria-pressed', String(state.paused));
  pauseBtn.textContent = state.paused ? 'Resume capture' : 'Pause capture';
  syncLoop();
});

timeMapInput.addEventListener('change', () => {
  state.showMap = timeMapInput.checked;
  if (route === 'webgl') canvas.requestPaint?.();
});

// Pointer interaction: paint R8 brush in mode 3, or reposition ripple origin in mode 1.
let brushDrag = null;

function normStagePoint(e) {
  const r = stageEl.getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1),
    y: clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1),
  };
}

stageEl.addEventListener('pointerdown', (e) => {
  const pt = normStagePoint(e);
  if (state.mode === 1) {
    state.centerX = pt.x;
    state.centerY = pt.y;
    if (route === 'webgl') canvas.requestPaint?.();
  }
  if (state.mode !== 3 || state.brushTool === 'interact') return;
  brushDrag = { id: e.pointerId, x: pt.x, y: pt.y };
  stageEl.setPointerCapture?.(e.pointerId);
  paintBrushStroke(pt.x, pt.y, pt.x, pt.y);
});

stageEl.addEventListener('pointermove', (e) => {
  if (!brushDrag || e.pointerId !== brushDrag.id) return;
  const pt = normStagePoint(e);
  paintBrushStroke(brushDrag.x, brushDrag.y, pt.x, pt.y);
  brushDrag.x = pt.x;
  brushDrag.y = pt.y;
});

function endBrushDrag(e) {
  if (!brushDrag || e.pointerId !== brushDrag.id) return;
  stageEl.releasePointerCapture?.(brushDrag.id);
  brushDrag = null;
}
stageEl.addEventListener('pointerup', endBrushDrag);
stageEl.addEventListener('pointercancel', endBrushDrag);

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(rafId);
  rafId = 0;
  visibilityObserver.disconnect();
  trackObserver.disconnect();
  stageObserver.disconnect();
  if (stage) {
    disposeRing(stage.gl);
    disposeMask(stage.gl);
    stage.dispose();
    stage = null;
  }
});

syncLoop();
updateTelemetry(true);

// ---------------------------------------------------------------- live checks on isolated fixtures
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function makeFixture(w, h, html) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
  const child = document.createElement('div');
  child.setAttribute('drawable', '');
  child.style.cssText = `position:absolute;inset:0;width:${w}px;height:${h}px;overflow:hidden;`;
  child.innerHTML = html;
  cv.append(child);
  testStage().append(cv);
  return { cv, child };
}

function readCentrePixel(g, cv) {
  const gl = g.gl;
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const tests = [
  {
    name: 'TEXTURE_2D_ARRAY + copyTexSubImage3D() from a texElementSubImage2D() framebuffer succeeds with gl.getError() === 0',
    expect: 'pass',
    why: 'Uploads a live drawable child with ElementGL.upload(), binds it to READ_FRAMEBUFFER and copies into slice 0 of a 4-layer TEXTURE_2D_ARRAY.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
      const { cv, child } = makeFixture(160, 96, '<div style="width:100%;height:100%;background:#d2491f"></div>');
      let g = null;
      let arrTex = null;
      let fbo = null;
      try {
        g = new ElementGL(cv, { fragment: FRAGMENT, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const gl = g.gl;
        while (gl.getError() !== gl.NO_ERROR) {}
        const uploaded = g.upload(child);
        arrTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, uploaded.w, uploaded.h, 4);

        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, uploaded.tex, 0);
        const fbStatus = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
        gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 0, 0, uploaded.w, uploaded.h);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        const err = gl.getError();
        return need(
          fbStatus === gl.FRAMEBUFFER_COMPLETE && err === gl.NO_ERROR,
          `Uploaded ${uploaded.w}x${uploaded.h}, READ_FRAMEBUFFER status 0x${fbStatus.toString(16)}, gl.getError() === ${err}.`
        );
      } finally {
        if (g && !g.lost) {
          if (arrTex) g.gl.deleteTexture(arrTex);
          if (fbo) g.gl.deleteFramebuffer(fbo);
          g.dispose();
        }
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'Ring buffer advances through multiple slices while keeping openSnapshots at 0',
    expect: 'pass',
    why: 'Steps head = (head + 1) % 6 across 8 GPU copies without calling captureElementImage().',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
      const madeBefore = window.__gfx?.snapshots?.made ?? 0;
      const { cv, child } = makeFixture(128, 64, '<div style="width:100%;height:100%;background:#1d5fa8"></div>');
      let g = null;
      let arrTex = null;
      let fbo = null;
      try {
        g = new ElementGL(cv, { fragment: FRAGMENT });
        await nextPaint(cv);
        const gl = g.gl;
        const slices = 6;
        let head = 0;
        const first = g.upload(child);

        arrTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, first.w, first.h, slices);

        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, first.tex, 0);

        for (let step = 0; step < 8; step++) {
          g.upload(child);
          gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, head, 0, 0, first.w, first.h);
          head = (head + 1) % slices;
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        const err = gl.getError();
        const openNow = window.__gfx?.snapshots?.open ?? 0;
        const madeNow = window.__gfx?.snapshots?.made ?? 0;
        return need(
          err === gl.NO_ERROR && head === 2 && openNow === 0 && madeNow === madeBefore,
          `8 copies across ${slices} slices wrapped head to ${head}, gl.getError() === ${err}, openSnapshots === ${openNow} (${madeNow - madeBefore} new).`
        );
      } finally {
        if (g && !g.lost) {
          if (arrTex) g.gl.deleteTexture(arrTex);
          if (fbo) g.gl.deleteFramebuffer(fbo);
          g.dispose();
        }
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'Distinct time slices hold distinct frame data after a DOM mutation',
    expect: 'pass',
    why: 'Captures a red box into slice 0, mutates the DOM to green and captures slice 1, then draws and compares both slices.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
      const { cv, child } = makeFixture(160, 80, '<div id="fx-box" style="width:100%;height:100%;background:#dc2626"></div>');
      let g = null;
      let arrTex = null;
      let dummyMask = null;
      let fbo = null;
      try {
        g = new ElementGL(cv, { fragment: FRAGMENT, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const gl = g.gl;
        const t0 = g.upload(child);

        arrTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, t0.w, t0.h, 4);

        dummyMask = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, dummyMask);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));

        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0.tex, 0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 0, 0, t0.w, t0.h);

        child.querySelector('#fx-box').style.background = '#16a34a';
        await nextPaint(cv);
        gl.activeTexture(gl.TEXTURE0);
        const t1 = g.upload(child);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1.tex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 1, 0, 0, t1.w, t1.h);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);

        const drawSlice = (sliceIdx) => {
          g.begin([0, 0, 0, 1]);
          g.quad(child, ElementGL.rect(cv, 0, 0, 160, 80), (ctx, u) => {
            ctx.activeTexture(ctx.TEXTURE1);
            ctx.bindTexture(ctx.TEXTURE_2D_ARRAY, arrTex);
            ctx.uniform1i(u('uRing'), 1);
            ctx.activeTexture(ctx.TEXTURE2);
            ctx.bindTexture(ctx.TEXTURE_2D, dummyMask);
            ctx.uniform1i(u('uMask'), 2);
            ctx.uniform1i(u('uForcedSlice'), sliceIdx);
            ctx.activeTexture(ctx.TEXTURE0);
          });
          return readCentrePixel(g, cv);
        };

        const p0 = drawSlice(0);
        const p1 = drawSlice(1);
        return need(
          p0[0] > p0[1] + 60 && p1[1] > p1[0] + 60,
          `Slice 0 rgb(${p0[0]},${p0[1]},${p0[2]}); slice 1 rgb(${p1[0]},${p1[1]},${p1[2]}).`
        );
      } finally {
        if (g && !g.lost) {
          if (arrTex) g.gl.deleteTexture(arrTex);
          if (dummyMask) g.gl.deleteTexture(dummyMask);
          if (fbo) g.gl.deleteFramebuffer(fbo);
          g.dispose();
        }
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps live input and button controls reachable',
    expect: 'pass',
    why: 'Places an input and a button inside a drawable panel, syncs geometry, and verifies elementFromPoint() hits both and the button click fires.',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is not available in this browser.');
      const { cv, child } = makeFixture(
        240,
        110,
        '<div style="padding:10px;display:flex;flex-direction:column;gap:8px">' +
          '<input id="fx-ss-in" type="text" value="hi" style="width:200px;height:36px">' +
          '<button id="fx-ss-btn" type="button" style="width:120px;height:36px">Hit me</button>' +
        '</div>'
      );
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: FRAGMENT });
          await nextPaint(cv);
          g.upload(child);
          g.begin([0, 0, 0, 0]);
          g.quad(child, ElementGL.rect(cv, 0, 0, 240, 110), (gl, u) => {
            gl.uniform1i(u('uRing'), 1);
            gl.uniform1i(u('uMask'), 2);
            gl.uniform1i(u('uFilled'), 1);
            gl.uniform1i(u('uForcedSlice'), -1);
          });
        } else {
          const ctx = cv.getContext('2d');
          cv.width = 240;
          cv.height = 110;
          cv.addEventListener('paint', () => {
            ctx.reset();
            ctx.drawElementImage(child, 0, 0, 240, 110);
          });
          await nextPaint(cv);
        }

        const unit = geometryUnit(cv, child, 240);
        cv.updateElementGeometry(child, { canvasTransform: new DOMMatrix().scale(unit) });
        child.dataset.hitTick = '1';

        const btn = child.querySelector('#fx-ss-btn');
        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });

        const rect = cv.getBoundingClientRect();
        const hitInput = document.elementFromPoint(rect.left + 80, rect.top + 28);
        const hitBtn = document.elementFromPoint(rect.left + 60, rect.top + 72);
        hitBtn?.click();

        return need(
          hitInput?.id === 'fx-ss-in' && hitBtn?.id === 'fx-ss-btn' && clicks === 1,
          `Input hit ${hitInput?.id || hitInput?.tagName}; button hit ${hitBtn?.id || hitBtn?.tagName}; clicks ${clicks}.`
        );
      } finally {
        if (g && !g.lost) g.dispose();
        window.__gfx?.retire(cv);
      }
    },
  },
];

runTests(document.getElementById('tests'), tests);
