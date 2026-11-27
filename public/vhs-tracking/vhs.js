import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const MODE_INT = {
  play: 0,
  ff: 1,
  rew: 2,
  pause: 3,
  clean: 4,
};

const CHANNEL_INFO = {
  'CH 03': {
    badge: 'CH 03 · UHF TEST',
    sub: '479.25 MHz · RF MODULATOR · COLOUR-UNDER 629 kHz',
  },
  'AV 1': {
    badge: 'AV 1 · LINE IN',
    sub: 'COMPOSITE CVBS · HI-FI STEREO · LINE SYNC',
  },
  CAM: {
    badge: 'CAM · VHS-C 1994',
    sub: 'HANDHELD CCD · AUTO TRACKING · TAPE MONITOR',
  },
};

const OSD_LABELS = {
  play: 'PLAY ▶',
  ff: 'FF ▶▶',
  rew: 'REW ◀◀',
  pause: 'PAUSE ❚❚',
  clean: 'CLEAN 1:1',
};

// DOM references
const stageEl = document.getElementById('vhs-stage');
const viewportEl = document.getElementById('vhs-viewport');
let canvas = document.getElementById('vhs-canvas');
const deckEl = document.getElementById('vhs-deck');
const plainHost = document.getElementById('vhs-plain-host');
const noticeEl = document.getElementById('vhs-notice');
const statusEl = document.getElementById('vhs-status');
const testsBody = document.getElementById('tests');

// Live DOM controls inside the drawable deck
const osdStateEl = document.getElementById('vhs-osd-state');
const osdModeTextEl = document.getElementById('vhs-osd-mode-text');
const counterEl = document.getElementById('vhs-counter');
const chBadgeEl = document.getElementById('vhs-ch-badge');
const trkPillEl = document.getElementById('vhs-trk-pill');
const osdTitleEl = document.getElementById('vhs-osd-title');
const chSubEl = document.getElementById('vhs-ch-sub');
const labelInput = document.getElementById('vhs-label');
const chButtons = Array.from(document.querySelectorAll('#vhs-ch-group button[data-channel]'));
const trButtons = Array.from(document.querySelectorAll('#vhs-tr-group button[data-mode]'));

// External page controls
const extModeButtons = Array.from(document.querySelectorAll('#vhs-ext-modes button[data-mode]'));
const trackingSlider = document.getElementById('vhs-tracking');
const trackingOut = document.getElementById('vhs-tracking-out');
const wearSlider = document.getElementById('vhs-wear');
const wearOut = document.getElementById('vhs-wear-out');
const centerTrackingBtn = document.getElementById('vhs-center-tracking');
const reducedToggle = document.getElementById('vhs-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region vhs-shader
export const VHS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;      // CSS px size of #vhs-deck
uniform float uTime;     // wrapped seconds
uniform float uTracking; // -1.0 .. +1.0 (near 0.0 clears the main tear bar)
uniform float uWear;     // 0.0 .. 1.0 (chroma smear, dropouts, head-switching jitter)
uniform int uMode;       // 0=play, 1=ff, 2=rew, 3=pause, 4=clean
uniform float uReduced;  // 1.0 freezes continuous jitter and snow into static calibration

in vec2 vUv;
out vec4 outColor;

// NTSC YIQ conversion (column-major mat3)
const mat3 RGB_TO_YIQ = mat3(
  0.299,  0.595716,  0.211456,
  0.587, -0.274453, -0.522591,
  0.114, -0.321263,  0.311135
);

const mat3 YIQ_TO_RGB = mat3(
  1.0,     1.0,     1.0,
  0.9563, -0.2721, -1.1070,
  0.6210, -0.6474,  1.7046
);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  if (uMode == 4) {
    outColor = texture(uTex, clamp(vUv, 0.0, 1.0));
    return;
  }

  float t = uReduced > 0.5 ? 1.35 : mod(uTime, 600.0);
  float frameTick = floor(t * 24.0);
  float lineCount = max(120.0, min(uSize.y, 480.0));
  float lineIdx = floor(vUv.y * lineCount);

  bool isFF = (uMode == 1 || uMode == 2);
  bool isPause = (uMode == 3);
  float scanDir = (uMode == 2) ? -1.0 : 1.0;

  // Vertical jitter in FF/REW or rhythmic frame-field tremble in Pause
  float dy = 0.0;
  float invH = 1.0 / max(uSize.y, 1.0);
  if (uReduced < 0.5) {
    if (isFF) {
      dy = (hash12(vec2(frameTick, 7.1)) - 0.5) * 4.2 * invH;
    } else if (isPause) {
      float fieldSign = mod(frameTick, 2.0) * 2.0 - 1.0;
      dy = fieldSign * 1.15 * invH;
    }
  }

  // 1. Vertical tracking misalignment: movable helical horizontal tear band
  float trkAbs = abs(uTracking);
  float trkActive = smoothstep(0.04, 0.20, trkAbs);
  float bandY = clamp(0.50 + uTracking * 0.38, 0.08, 0.87);
  float bandHalf = 0.028 + 0.020 * trkAbs;
  float bandEnv = exp(-pow((vUv.y - bandY) / max(bandHalf, 0.001), 2.0)) * trkActive;

  float lineRnd = hash12(vec2(lineIdx, frameTick * 0.73 + 3.1)) * 2.0 - 1.0;
  float lineWave = sin(vUv.y * 145.0 + t * 18.0 * (uTracking >= 0.0 ? 1.0 : -1.0));
  float trackShear = bandEnv * (0.044 * lineRnd + 0.024 * lineWave) * (0.65 + 0.65 * trkAbs);
  float ribbonBend = trkActive * 0.004 * sin(vUv.y * 14.0 + t * 2.4);

  // 2. Fast-forward / rewind scan bars and Pause still-frame noise bar
  float ffBar = 0.0;
  float ffShear = 0.0;
  if (isFF) {
    float scrollPhase = fract(vUv.y * 3.0 - scanDir * t * 1.35);
    ffBar = exp(-pow((scrollPhase - 0.5) / 0.14, 2.0));
    ffShear = ffBar * (hash12(vec2(lineIdx, frameTick + 19.0)) - 0.5) * 0.082;
  }

  float pauseBar = 0.0;
  float pauseShear = 0.0;
  if (isPause) {
    pauseBar = exp(-pow((vUv.y - 0.77) / 0.036, 2.0));
    pauseShear = pauseBar * (hash12(vec2(lineIdx, frameTick + 29.0)) - 0.5) * (0.028 + 0.042 * uWear);
  }

  // 3. Bottom ~7% head-switching noise band (vUv.y > 0.928)
  float headMask = smoothstep(0.925, 0.938, vUv.y);
  float headJitter = hash12(vec2(lineIdx, frameTick + 41.0)) * 2.0 - 0.35;
  float headShear = headMask * (0.020 + 0.052 * uWear) * (0.45 + 0.85 * headMask) * headJitter;

  float dx = trackShear + ribbonBend + ffShear + pauseShear + headShear;
  vec2 uvY = clamp(vUv + vec2(dx, dy), vec2(0.001), vec2(0.999));

  vec4 texY = texture(uTex, uvY);
  float alpha = texY.a;
  vec3 straightY = alpha > 0.002 ? clamp(texY.rgb / alpha, 0.0, 1.0) : vec3(0.0);
  float luma = (RGB_TO_YIQ * straightY).x;

  // 4. YIQ chroma subsampling: delay chroma leftward in UV so colour bleeds right
  float pxW = 1.0 / max(uSize.x, 1.0);
  float delayUv = (1.4 + 3.8 * uWear + (isFF ? 2.0 : 0.0)) * pxW;
  float smearUv = (3.0 + 7.4 * uWear) * pxW;

  vec2 iqSum = vec2(0.0);
  float wSum = 0.0;
  for (int i = -3; i <= 3; i++) {
    float fi = float(i);
    float w = exp(-0.22 * fi * fi);
    vec2 cUv = clamp(uvY + vec2(-delayUv + fi * (smearUv * 0.38), 0.0), vec2(0.001), vec2(0.999));
    vec4 cTex = texture(uTex, cUv);
    vec3 cRgb = cTex.a > 0.002 ? clamp(cTex.rgb / cTex.a, 0.0, 1.0) : vec3(0.0);
    vec3 cYiq = RGB_TO_YIQ * cRgb;
    iqSum += cYiq.yz * w * cTex.a;
    wSum += w * cTex.a;
  }
  vec2 iq = wSum > 0.001 ? iqSum / wSum : (RGB_TO_YIQ * straightY).yz;
  iq *= (1.06 + 0.16 * uWear);

  vec3 rgb = clamp(YIQ_TO_RGB * vec3(luma, iq), 0.0, 1.0);

  // Subtle CRT horizontal raster lines
  float scanline = 1.0 - 0.05 * (0.5 + 0.5 * sin(vUv.y * uSize.y * 3.14159265));
  rgb *= scanline;

  // 5. Tape dropout snow flecks and white-noise tear streaks
  float dropCols = max(uSize.x * 0.08, 24.0);
  float dropCellX = floor(vUv.x * dropCols);
  float dropRnd = hash12(vec2(dropCellX, lineIdx * 1.37 + frameTick * 3.7));
  float dropThresh = 0.9985 - 0.011 * uWear - (isFF ? 0.015 : 0.0);
  float dropLine = step(dropThresh, dropRnd);
  float cellFrac = fract(vUv.x * dropCols);
  float dropFade = smoothstep(0.0, 0.25, cellFrac) * smoothstep(1.0, 0.75, cellFrac);
  float dropout = dropLine * dropFade * (0.45 + 0.45 * uWear) * (0.65 + 0.35 * hash12(vec2(lineIdx, dropCellX)));

  float grainX = floor(vUv.x * max(uSize.x * 0.22, 60.0));
  float streak = hash12(vec2(grainX + floor(lineRnd * 6.0), lineIdx + frameTick * 5.0));
  float barNoise = 0.0;
  barNoise += bandEnv * smoothstep(0.28, 0.94, streak) * 0.88;
  barNoise += ffBar * smoothstep(0.32, 0.95, streak) * 0.82;
  barNoise += pauseBar * (0.35 + 0.65 * uWear) * smoothstep(0.35, 0.95, streak) * 0.80;
  barNoise += headMask * (0.35 + 0.65 * uWear) * smoothstep(0.55, 0.97, streak) * 0.92;

  float whiteSnow = clamp(max(dropout, barNoise), 0.0, 1.0);
  rgb = mix(rgb, vec3(0.92, 0.95, 1.0), whiteSnow * 0.86);

  outColor = vec4(clamp(rgb, 0.0, 1.0) * alpha, alpha);
}
`;
// #endregion vhs-shader

const state = {
  backend: 'init', // 'webgl' | '2d' | 'plain'
  mode: 'play',    // 'play' | 'ff' | 'rew' | 'pause' | 'clean'
  channel: 'CH 03',
  tracking: Number(trackingSlider.value),
  wear: Number(wearSlider.value) / 100,
  reducedOverride: reducedToggle.checked,
  hasPainted: false,
  forceUpload: true,
  onScreen: true,
  uploads: 0,
  paints: 0,
  rafId: 0,
  startMs: performance.now(),
  lastTickMs: performance.now(),
  lastCounterMs: 0,
  counterFrames: 14 * 60 * 25 + 22 * 25 + 8, // 00:14:22:08 @ 25 fps PAL
  lastCounterText: '00:14:22:08',
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
};

let stage = null;
let ctx2d = null;

function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function formatTimecode(totalFrames) {
  const fps = 25;
  const maxFrames = 24 * 3600 * fps;
  let f = Math.floor(((totalFrames % maxFrames) + maxFrames) % maxFrames);
  const frames = f % fps;
  f = Math.floor(f / fps);
  const secs = f % 60;
  f = Math.floor(f / 60);
  const mins = f % 60;
  const hrs = Math.floor(f / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 356);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 432);
  return { cw, ch };
}

function syncDeckSize(cw, ch) {
  if (state.backend === 'plain') {
    deckEl.style.width = '';
    deckEl.style.height = '';
    return;
  }
  const wStr = `${cw}px`;
  const hStr = `${ch}px`;
  if (deckEl.style.width !== wStr) deckEl.style.width = wStr;
  if (deckEl.style.height !== hStr) deckEl.style.height = hStr;
}

function syncUI() {
  const trkVal = state.tracking;
  const trkText = (trkVal >= 0 ? '+' : '') + trkVal.toFixed(2);
  const trkLocked = Math.abs(trkVal) <= 0.04;
  trackingSlider.value = String(trkVal);
  trackingOut.textContent = trkLocked ? `LOCK (${trkText})` : trkText;
  trkPillEl.textContent = trkLocked ? 'TRK LOCK' : `TRK ${trkText}`;
  trkPillEl.dataset.locked = String(trkLocked);

  const wearPct = Math.round(state.wear * 100);
  wearSlider.value = String(wearPct);
  wearOut.textContent = `${wearPct}%`;

  osdStateEl.dataset.mode = state.mode;
  osdModeTextEl.textContent = OSD_LABELS[state.mode];

  const info = CHANNEL_INFO[state.channel] ?? CHANNEL_INFO['CH 03'];
  deckEl.dataset.channel = state.channel;
  chBadgeEl.textContent = info.badge;
  chSubEl.textContent = info.sub;

  for (const btn of chButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.channel === state.channel));
  }
  for (const btn of trButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
  }
  for (const btn of extModeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
  }

  const typed = labelInput.value.trim();
  osdTitleEl.textContent = typed || 'NO TAPE LABEL';
}

function updateStatus() {
  const routeLabel = state.backend === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.backend === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const mp = state.backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const trkLabel = Math.abs(state.tracking) <= 0.04 ? 'locked' : state.tracking.toFixed(2);
  const calLabel = isReducedMotion() ? ' · calibration frozen' : '';
  statusEl.textContent =
    `${routeLabel} · ${state.mode.toUpperCase()} · ${state.channel} · tracking ${trkLabel} · wear ${Math.round(state.wear * 100)}% · ` +
    `${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads${calLabel}`;
}

// #region vhs-geometry
function syncDeckGeometry(cw, ch, force = false) {
  if (!canvas || state.backend === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;
  const dw = Math.max(1, deckEl.offsetWidth || cw);
  const dh = Math.max(1, deckEl.offsetHeight || ch);
  const zoom = deckEl.currentCSSZoom || 1;
  const uKey = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${dw}/${zoom}`;
  if (state.unitCache.key !== uKey) {
    state.unitCache.unit = geometryUnit(canvas, deckEl, dw);
    state.unitCache.key = uKey;
    state.lastGeoKey = '';
  }
  const u = state.unitCache.unit;
  const gKey = `${state.backend}|${cw}x${ch}|${dw}x${dh}|${u.toFixed(4)}`;
  if (!force && state.lastGeoKey === gKey) return;
  state.lastGeoKey = gKey;

  canvas.updateElementGeometry(deckEl, {
    canvasTransform: new DOMMatrix().scale(u, u),
  });
  deckEl.dataset.hitTick = deckEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion vhs-geometry

// #region vhs-paint
function renderWebGL(changedElements = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  syncDeckSize(cw, ch);

  if (!stage.begin([0.04, 0.05, 0.08, 1.0])) return;

  let domChanged = !stage.has(deckEl) || state.forceUpload;
  if (!domChanged && changedElements?.length) {
    for (const el of changedElements) {
      if (el === deckEl || deckEl.contains(el)) {
        domChanged = true;
        break;
      }
    }
  }

  if (domChanged) {
    try {
      stage.upload(deckEl);
      state.uploads++;
      state.forceUpload = false;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        canvas.requestPaint?.();
        return;
      }
      throw err;
    }
  }

  if (!stage.has(deckEl)) return;

  const elapsed = ((performance.now() - state.startMs) / 1000) % 600;
  stage.quad(deckEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, uniform) => {
    gl.uniform1f(uniform('uTime'), elapsed);
    gl.uniform1f(uniform('uTracking'), state.tracking);
    gl.uniform1f(uniform('uWear'), state.wear);
    gl.uniform1i(uniform('uMode'), MODE_INT[state.mode] ?? 0);
    gl.uniform1f(uniform('uReduced'), isReducedMotion() ? 1.0 : 0.0);
  });

  syncDeckGeometry(cw, ch);
  state.paints++;
  updateStatus();
}
// #endregion vhs-paint

// #region vhs-fallbacks
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  syncDeckSize(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);
  ctx2d.drawElementImage(deckEl, 0, 0, cw, ch);

  if (state.mode !== 'clean') {
    // Light 2D tracking noise band and bottom 7% head-switching hint
    const trkAbs = Math.abs(state.tracking);
    if (trkAbs > 0.04) {
      const bandY = clamp(0.50 + state.tracking * 0.38, 0.08, 0.87) * ch;
      ctx2d.fillStyle = `rgba(235, 244, 255, ${(0.22 + 0.25 * trkAbs).toFixed(2)})`;
      ctx2d.fillRect(0, bandY - 9, cw, 18);
    }
    ctx2d.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx2d.fillRect(0, ch * 0.93, cw, ch * 0.07);
  }
  ctx2d.restore();

  syncDeckGeometry(cw, ch);
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.backend = 'plain';
  stopLoop();
  stageEl.classList.add('is-plain');
  if (deckEl.parentElement !== plainHost) plainHost.append(deckEl);
  syncDeckSize(0, 0);
  showNotice(reason);
  updateStatus();
}

function exitPlainFallback() {
  stageEl.classList.remove('is-plain');
  if (deckEl.parentElement !== canvas) canvas.append(deckEl);
  showNotice('');
}

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    if (state.backend === 'webgl' && stage && !stage.lost) {
      renderWebGL(e?.changedElements ?? null);
    } else if (state.backend === '2d' && ctx2d) {
      render2DFallback();
    }
  });
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.backend === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the VCR deck as plain HTML.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.backend === 'plain' && ctx2d) {
      state.backend = '2d';
      state.hasPainted = false;
      state.lastGeoKey = '';
      exitPlainFallback();
      const { cw, ch } = getViewportSize();
      syncDeckSize(cw, ch);
      cv.requestPaint?.();
      syncLoop();
    }
  });
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  syncDeckSize(cw, ch);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: VHS_FRAG,
        onLost: () => {
          enterPlainFallback('The WebGL 2 context was lost. Showing the VCR deck in plain HTML until restored.');
        },
        onRestored: () => {
          stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.backend = 'webgl';
          state.hasPainted = false;
          state.forceUpload = true;
          state.unitCache.key = '';
          state.lastGeoKey = '';
          exitPlainFallback();
          const size = getViewportSize();
          syncDeckSize(size.cw, size.ch);
          canvas.requestPaint?.();
          syncLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.backend = 'webgl';
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'vhs-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(deckEl);
      canvas.replaceWith(fresh);
      window.__gfx?.retire?.(canvas);
      canvas = fresh;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        state.backend = '2d';
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() fallback.');
        }
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      }
    } catch {}
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the VCR deck is shown as plain HTML.');
}
// #endregion vhs-fallbacks

function shouldAnimate() {
  if (!state.onScreen || document.hidden || isReducedMotion()) return false;
  if (state.backend === 'plain') return false;
  return state.mode !== 'clean';
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function requestRedraw(markDirty = false) {
  if (markDirty) state.forceUpload = true;
  if (state.backend !== 'plain') canvas.requestPaint?.();
  else updateStatus();
}

function tick(now) {
  state.rafId = 0;
  if (!shouldAnimate()) return;

  const dt = Math.min(0.1, Math.max(0, (now - state.lastTickMs) / 1000));
  state.lastTickMs = now;

  // Advance tape counter in play / ff / rew
  const rate = state.mode === 'play' ? 25 : state.mode === 'ff' ? 75 : state.mode === 'rew' ? -75 : 0;
  if (rate !== 0) {
    state.counterFrames += rate * dt;
    if (now - state.lastCounterMs >= 120) {
      state.lastCounterMs = now;
      const nextCounter = formatTimecode(state.counterFrames);
      if (nextCounter !== state.lastCounterText) {
        state.lastCounterText = nextCounter;
        counterEl.textContent = nextCounter;
        state.forceUpload = true;
      }
    }
  }

  canvas.requestPaint?.();
  state.rafId = requestAnimationFrame(tick);
}

function syncLoop() {
  if (shouldAnimate()) {
    if (!state.rafId) {
      state.lastTickMs = performance.now();
      state.rafId = requestAnimationFrame(tick);
    }
  } else {
    stopLoop();
  }
  updateStatus();
}

// Mode and channel setters
function setMode(nextMode) {
  if (!(nextMode in MODE_INT)) return;
  state.mode = nextMode;
  syncUI();
  requestRedraw(true);
  syncLoop();
}

function setChannel(nextChannel) {
  if (!(nextChannel in CHANNEL_INFO)) return;
  state.channel = nextChannel;
  syncUI();
  requestRedraw(true);
}

// Deck internal control listeners
labelInput.addEventListener('input', () => {
  syncUI();
  requestRedraw(true);
});

deckEl.addEventListener('focusin', () => requestRedraw(true));
deckEl.addEventListener('focusout', () => requestRedraw(true));

for (const btn of chButtons) {
  btn.addEventListener('click', () => setChannel(btn.dataset.channel));
}

for (const btn of trButtons) {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
}

// External control listeners
for (const btn of extModeButtons) {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
}

trackingSlider.addEventListener('input', () => {
  state.tracking = clamp(Number(trackingSlider.value), -1, 1);
  syncUI();
  requestRedraw(true);
});

wearSlider.addEventListener('input', () => {
  state.wear = clamp(Number(wearSlider.value) / 100, 0, 1);
  syncUI();
  requestRedraw(false);
});

centerTrackingBtn.addEventListener('click', () => {
  state.tracking = 0;
  syncUI();
  requestRedraw(true);
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  requestRedraw(false);
  syncLoop();
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  requestRedraw(false);
  syncLoop();
});

const visibilityObserver = new IntersectionObserver(
  ([entry]) => {
    state.onScreen = Boolean(entry?.isIntersecting);
    syncLoop();
    if (state.onScreen && state.hasPainted && !shouldAnimate()) {
      requestRedraw(false);
    }
  },
  { rootMargin: '80px' }
);
visibilityObserver.observe(stageEl);
document.addEventListener('visibilitychange', syncLoop);

const resizeObserver = new ResizeObserver(() => {
  if (state.backend !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKey = '';
    const { cw, ch } = getViewportSize();
    syncDeckSize(cw, ch);
    requestRedraw(true);
  }
});
resizeObserver.observe(viewportEl);

window.addEventListener('pagehide', () => {
  stopLoop();
  visibilityObserver.disconnect();
  resizeObserver.disconnect();
  if (stage) {
    stage.dispose();
    stage = null;
  }
});

syncUI();
initBackend();
syncLoop();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeFixture(w = 240, h = 160, html = '') {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;`;
  const child = document.createElement('div');
  child.setAttribute('drawable', '');
  child.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;` +
    'background:#080a10;color:#ffffff;font:700 12px system-ui;box-sizing:border-box;';
  child.innerHTML = html;
  cv.append(child);
  testStage().append(cv);
  return { cv, child };
}

function drawFixture(g, cv, child, w, h, { mode = 0, tracking = 0, wear = 0.42, reduced = 1, time = 1.35 } = {}) {
  if (!g.begin([0, 0, 0, 1])) return;
  g.upload(child);
  g.quad(child, ElementGL.rect(cv, 0, 0, w, h), (gl, u) => {
    gl.uniform1f(u('uTime'), time);
    gl.uniform1f(u('uTracking'), tracking);
    gl.uniform1f(u('uWear'), wear);
    gl.uniform1i(u('uMode'), mode);
    gl.uniform1f(u('uReduced'), reduced);
  });
}

runTests(testsBody, [
  {
    name: 'ElementGL upload and VHS_FRAG render succeed with gl.getError() === 0',
    expect: 'pass',
    why: 'Creates an isolated ElementGL fixture with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, runs begin() before upload(), and checks red and dark pixel output.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 240;
      const H = 160;
      const { cv, child } = makeFixture(
        W,
        H,
        '<div style="width:120px;height:100%;background:#ef2b2d"></div>'
      );
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: VHS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        drawFixture(g, cv, child, W, H, { mode: 0, tracking: 0.0, wear: 0.25, reduced: 1 });
        const err = g.gl.getError();
        const leftRed = readCssPixel(g.gl, cv, W, H, 60, 48);
        const rightDark = readCssPixel(g.gl, cv, W, H, 200, 48);
        return need(
          err === g.gl.NO_ERROR && leftRed[0] > 180 && leftRed[0] > leftRed[2] + 100 && rightDark[0] < 35,
          `gl.getError() === ${err}, leftRed=[${Array.from(leftRed)}], rightDark=[${Array.from(rightDark)}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'YIQ chroma delay and horizontal smear bleed red across a sharp edge',
    expect: 'pass',
    why: 'Compares pixels 4 CSS px right of a sharp red/black edge in Clean signal vs Play VHS mode via readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 240;
      const H = 160;
      const { cv, child } = makeFixture(
        W,
        H,
        '<div style="position:absolute;left:0;top:16px;width:120px;height:68px;background:#ff0000"></div>'
      );
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: VHS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);

        drawFixture(g, cv, child, W, H, { mode: 4, tracking: 0.0, wear: 0.85, reduced: 1 });
        const cleanEdge = readCssPixel(g.gl, cv, W, H, 124, 50);

        drawFixture(g, cv, child, W, H, { mode: 0, tracking: 0.0, wear: 0.85, reduced: 1 });
        const vhsEdge = readCssPixel(g.gl, cv, W, H, 124, 50);

        return need(
          cleanEdge[0] < 25 && vhsEdge[0] > cleanEdge[0] + 60 && vhsEdge[0] > vhsEdge[2] + 50,
          `4 px right of edge: Clean=[${Array.from(cleanEdge)}], VHS=[${Array.from(vhsEdge)}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Tracking off-centre introduces helical scanline tear that clears near 0.0',
    expect: 'pass',
    why: 'Sweeps the tracking band (y = 58..66%) across a vertical white bar at uTracking = 0.0 vs uTracking = 0.32 and compares against Clean signal.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 240;
      const H = 160;
      const { cv, child } = makeFixture(
        W,
        H,
        '<div style="position:absolute;left:110px;top:8px;width:20px;height:140px;background:#ffffff"></div>'
      );
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: VHS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);

        const countDiffInBand = (cleanArr, testArr) => {
          let changed = 0;
          for (let i = 0; i < cleanArr.length; i++) {
            const c = cleanArr[i];
            const t = testArr[i];
            const d = Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2]);
            if (d > 65) changed++;
          }
          return changed;
        };

        const sampleBand = () => {
          const out = [];
          for (let y = 92; y <= 108; y += 2) {
            for (let x = 88; x <= 152; x += 4) {
              out.push(readCssPixel(g.gl, cv, W, H, x, y));
            }
          }
          return out;
        };

        drawFixture(g, cv, child, W, H, { mode: 4, tracking: 0.0, wear: 0.0, reduced: 1 });
        const cleanBand = sampleBand();

        drawFixture(g, cv, child, W, H, { mode: 0, tracking: 0.0, wear: 0.0, reduced: 1 });
        const centeredBand = sampleBand();

        drawFixture(g, cv, child, W, H, { mode: 0, tracking: 0.32, wear: 0.0, reduced: 1 });
        const offCenterBand = sampleBand();

        const diffCentered = countDiffInBand(cleanBand, centeredBand);
        const diffOff = countDiffInBand(cleanBand, offCenterBand);

        return need(
          diffCentered <= 4 && diffOff >= 20,
          `Band pixels differing (>65 sum): centered=${diffCentered}, tracking=0.32=${diffOff} of ${cleanBand.length}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps PLAY button, channel button and input hit-testable',
    expect: 'pass',
    why: 'Places live interactive controls inside an isolated deck fixture, syncs geometryUnit() + hitTick, and checks elementsFromPoint() plus a PLAY click.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available.');
      }
      const W = 240;
      const H = 160;
      const { cv, child } = makeFixture(
        W,
        H,
        '<div style="padding:10px;display:flex;flex-direction:column;gap:8px">' +
          '<input id="fx-vhs-in" type="text" inputmode="none" value="TAPE 04" style="width:210px;height:34px;border:1px solid #48b9f5;background:#080b12;color:#fff">' +
          '<div style="display:flex;gap:8px">' +
            '<button id="fx-vhs-ch" type="button" style="width:88px;height:38px;background:#182032;color:#fff">AV 1</button>' +
            '<button id="fx-vhs-play" type="button" style="width:100px;height:38px;background:#1fb85a;color:#06140c">PLAY</button>' +
          '</div>' +
        '</div>'
      );
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: VHS_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          await nextPaint(cv);
          drawFixture(g, cv, child, W, H, { mode: 0, tracking: 0.25, wear: 0.4, reduced: 1 });
        } else {
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext('2d');
          cv.addEventListener('paint', () => {
            ctx.reset();
            ctx.drawElementImage(child, 0, 0, W, H);
          });
          await nextPaint(cv);
        }

        const unit = geometryUnit(cv, child, W);
        cv.updateElementGeometry(child, { canvasTransform: new DOMMatrix().scale(unit, unit) });
        child.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const inEl = child.querySelector('#fx-vhs-in');
        const chEl = child.querySelector('#fx-vhs-ch');
        const playEl = child.querySelector('#fx-vhs-play');
        let playClicks = 0;
        playEl.addEventListener('click', () => { playClicks++; });

        const hitCenter = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };
        const hitIn = hitCenter(inEl).includes(inEl);
        const hitCh = hitCenter(chEl).includes(chEl);
        const hitPlay = hitCenter(playEl).includes(playEl);
        playEl.click();

        return need(
          hitIn && hitCh && hitPlay && playClicks === 1,
          `inputHit=${hitIn}, channelHit=${hitCh}, playHit=${hitPlay}, playClicks=${playClicks}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'webglcontextlost enters plain-HTML fallback and webglcontextrestored recovers',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated ElementGL fixture on testStage().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 200;
      const H = 120;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px;`;
      const deckFix = document.createElement('div');
      deckFix.setAttribute('drawable', '');
      deckFix.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;background:#131926;color:#fff;`;
      deckFix.innerHTML = '<button type="button" style="margin:12px;width:90px;height:36px">PLAY</button>';
      cv.append(deckFix);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: VHS_FRAG,
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            plain.append(deckFix);
          },
          onRestored: () => {
            restoredFired = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            cv.append(deckFix);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        drawFixture(g, cv, deckFix, W, H, { mode: 0, tracking: 0.0, wear: 0.4, reduced: 1 });

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const movedToPlain = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(deckFix);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        drawFixture(g, cv, deckFix, W, H, { mode: 0, tracking: 0.0, wear: 0.4, reduced: 1 });
        const err = g.gl.getError();

        return need(
          movedToPlain && restoredFired && !g.lost && cv.contains(deckFix) && err === g.gl.NO_ERROR,
          `defaultPrevented=${lostEv.defaultPrevented}, plainWhileLost=${movedToPlain}, restored=${restoredFired}, glErr=${err}.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'vhs-tracking stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !stage.has(deckEl)) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.paints > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
