import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const REDUCED_STATIC_TIME = 6.4;
export const PULSE_DURATION_SEC = 1.6;

// DOM references
const stageBox = document.getElementById('matrix-stage');
const viewportEl = document.getElementById('matrix-viewport');
let canvas = document.getElementById('matrix-canvas');
const termPanel = document.getElementById('term-panel');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('matrix-notice');
const statusEl = document.getElementById('matrix-status');
const testsBody = document.getElementById('tests');

// Terminal controls inside drawable HTML
const termCmdInput = document.getElementById('term-cmd');
const termBadgeEl = document.getElementById('term-badge');
const termOutputEl = document.getElementById('term-output');
const btnDecode = document.getElementById('btn-decode');
const btnTrace = document.getElementById('btn-trace');
const btnLock = document.getElementById('btn-lock');
const lineChannelEl = document.getElementById('line-channel');
const lineParityEl = document.getElementById('line-parity');
const lineRouteEl = document.getElementById('line-route');
const lineStreamEl = document.getElementById('line-stream');

// External controls
const modeButtons = Array.from(document.querySelectorAll('#rain-modes button[data-mode]'));
const speedSlider = document.getElementById('speed-slider');
const speedOut = document.getElementById('speed-out');
const densitySlider = document.getElementById('density-slider');
const densityOut = document.getElementById('density-out');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region rain-shader
export const RAIN_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uRainTime;
uniform float uSpeed;
uniform float uDensity;
uniform int uMode;          // 0 = Phosphor rain, 1 = Ink reveal, 2 = Decode trace
uniform float uReduced;     // 1.0 pauses drop fall & glyph flicker
uniform float uLocked;      // 1.0 pauses rain at current timestamp
uniform float uPulseAge;    // seconds since last quick-command trigger (< 0 inactive)
uniform vec2 uPulseOrigin;  // CSS px origin inside #term-panel

in vec2 vUv;
out vec4 outColor;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// 16 signed-safe 5x7 dot-matrix katakana/hex glyphs packed into 15-bit ints (<= 32008)
ivec3 glyphData(int idx) {
  if (idx == 0)  return ivec3(306,   4177,  24);
  if (idx == 1)  return ivec3(14367, 8324,  16);
  if (idx == 2)  return ivec3(31758, 4161,  8);
  if (idx == 3)  return ivec3(1087,  1057,  31);
  if (idx == 4)  return ivec3(31876, 9381,  18);
  if (idx == 5)  return ivec3(9700,  4177,  8);
  if (idx == 6)  return ivec3(17969, 2097,  4);
  if (idx == 7)  return ivec3(10303, 17732, 0);
  if (idx == 8)  return ivec3(17983, 17969, 31);
  if (idx == 9)  return ivec3(32008, 8521,  15);
  if (idx == 10) return ivec3(1329,  4162,  8);
  if (idx == 11) return ivec3(2111,  8452,  8);
  if (idx == 12) return ivec3(1086,  1070,  30);
  if (idx == 13) return ivec3(17966, 17966, 14);
  if (idx == 14) return ivec3(17966, 2095,  12);
  return ivec3(15012, 21983, 4);
}

float sampleGlyph(int idx, vec2 cellUv) {
  vec2 padUv = (cellUv - vec2(0.12, 0.10)) / vec2(0.76, 0.80);
  if (padUv.x < 0.0 || padUv.x >= 1.0 || padUv.y < 0.0 || padUv.y >= 1.0) return 0.0;
  int gx = int(floor(padUv.x * 5.0));
  int gy = int(floor(padUv.y * 7.0));
  ivec3 g = glyphData(idx);
  int rowBits = gy < 3 ? ((g.x >> (gy * 5)) & 31) : (gy < 6 ? ((g.y >> ((gy - 3) * 5)) & 31) : (g.z & 31));
  int bitOn = (rowBits >> (4 - gx)) & 1;
  if (bitOn == 0) return 0.0;
  vec2 dotUv = fract(vec2(padUv.x * 5.0, padUv.y * 7.0)) - 0.5;
  return 1.0 - smoothstep(0.24, 0.56, length(dotUv));
}

struct RainSample {
  float glyph;
  float head;
  float trail;
};

RainSample evalRainLayer(vec2 p, float colW, float rowH, float rainTime, float speed, float density, float reduced, float seed) {
  RainSample outR;
  outR.glyph = 0.0;
  outR.head = 0.0;
  outR.trail = 0.0;

  vec2 grid = vec2(p.x / colW, p.y / rowH);
  float col = floor(grid.x);
  float row = floor(grid.y);
  vec2 cellUv = fract(grid);

  float colRand = hash11(col * 17.31 + seed * 19.7);
  float activeThresh = mix(0.72, 0.06, clamp(density, 0.0, 1.0));
  if (colRand < activeThresh) return outR;

  float colSpeed = (4.2 + 7.2 * hash11(col * 41.7 + seed * 7.3)) * speed;
  float trailLen = 8.0 + 15.0 * hash11(col * 73.1 + seed * 11.9);
  float period = trailLen + 9.0 + 16.0 * hash11(col * 29.3 + seed * 5.1);
  float headPos = rainTime * colSpeed + hash11(col * 113.3 + seed * 3.7) * period;

  float cellDist = mod(floor(headPos) - row, period);
  float smoothDist = mod(headPos - grid.y, period);
  float isHead = cellDist < 0.5 ? 1.0 : 0.0;
  float trailEnv = cellDist < trailLen ? exp(-cellDist / (trailLen * 0.38)) : 0.0;
  float dropRipple = exp(-pow(smoothDist / 1.35, 2.0));

  float mutFreq = isHead > 0.5 ? 8.5 : 2.1;
  float mutTick = reduced > 0.5 ? 0.0 : floor(rainTime * mutFreq + hash21(vec2(col, row + seed * 31.0)) * 24.0);
  float gHash = hash21(vec2(col * 13.7 + mutTick * 0.37, row * 7.9 + seed * 43.0));
  int gIdx = int(floor(gHash * 16.0)) & 15;

  outR.glyph = sampleGlyph(gIdx, cellUv);
  outR.head = max(isHead, dropRipple * 0.72);
  outR.trail = trailEnv;
  return outR;
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float sampleLum(vec2 uv) {
  vec4 t = texture(uTex, clamp(uv, vec2(0.0005), vec2(0.9995)));
  return luma(t.rgb);
}

float sparkField(vec2 p, float t) {
  vec2 cell = floor((p + vec2(sin(t * 2.1 + p.y * 0.05) * 4.0, -t * 48.0)) / 9.0);
  vec2 f = fract((p + vec2(sin(t * 2.1 + p.y * 0.05) * 4.0, -t * 48.0)) / 9.0);
  vec2 rnd = hash22(cell + vec2(3.1, 7.7));
  if (rnd.x < 0.76) return 0.0;
  float flicker = 0.5 + 0.5 * sin(t * 17.0 + rnd.y * 42.0);
  return smoothstep(0.32, 0.04, length(f - (0.25 + 0.5 * rnd))) * flicker;
}

void main() {
  vec4 texC = texture(uTex, clamp(vUv, vec2(0.0005), vec2(0.9995)));
  vec3 domRgb = texC.a > 0.002 ? clamp(texC.rgb / texC.a, 0.0, 1.0) : vec3(0.0);
  float domLum = luma(domRgb) * texC.a;

  ivec2 tSize = max(textureSize(uTex, 0), ivec2(1));
  vec2 texel = 1.0 / vec2(tSize);
  vec2 eStep = max(texel, 0.85 / max(uSize, vec2(1.0)));

  // 3x3 luminance stencil for Sobel gradient magnitude + local stroke contrast
  float tl = sampleLum(vUv + vec2(-eStep.x, -eStep.y));
  float tc = sampleLum(vUv + vec2(0.0,      -eStep.y));
  float tr = sampleLum(vUv + vec2(eStep.x,  -eStep.y));
  float ml = sampleLum(vUv + vec2(-eStep.x,  0.0));
  float mc = sampleLum(vUv);
  float mr = sampleLum(vUv + vec2(eStep.x,   0.0));
  float bl = sampleLum(vUv + vec2(-eStep.x,  eStep.y));
  float bc = sampleLum(vUv + vec2(0.0,       eStep.y));
  float br = sampleLum(vUv + vec2(eStep.x,   eStep.y));

  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float sobel = clamp(length(vec2(gx, gy)) * 1.15, 0.0, 1.0);
  float localMax = max(max(max(tl, tr), max(bl, br)), max(max(tc, bc), max(ml, mr)));
  float localMin = min(min(min(tl, tr), min(bl, br)), min(min(tc, bc), min(ml, mr)));
  float localContrast = clamp((localMax - localMin) * 1.65, 0.0, 1.0);
  float edgeMask = smoothstep(0.08, 0.44, max(sobel, localContrast * 0.85));

  vec2 p = vUv * uSize;
  RainSample r1 = evalRainLayer(p, 10.5, 14.0, uRainTime, uSpeed, uDensity, uReduced, 1.0);
  RainSample r2 = evalRainLayer(p + vec2(3.7, 5.1), 7.5, 10.0, uRainTime * 0.68, uSpeed, clamp(uDensity * 0.85, 0.2, 1.0), uReduced, 2.0);

  // Command / button pulse shockwave radiating from the clicked control centre
  float pulseRing = 0.0;
  float pulseFill = 0.0;
  if (uPulseAge >= 0.0 && uPulseAge < 1.6 && uReduced < 0.5) {
    float dist = length(p - uPulseOrigin);
    float rad = uPulseAge * 360.0;
    float fade = 1.0 - smoothstep(0.95, 1.6, uPulseAge);
    pulseRing = exp(-pow((dist - rad) / 22.0, 2.0)) * fade;
    pulseFill = smoothstep(rad + 14.0, rad - 26.0, dist) * fade * 0.55;
  }

  float streamForce = clamp(r1.head * 1.35 + r1.trail * 0.92 + r2.trail * 0.35 + pulseRing, 0.0, 1.0);
  float rainBody = clamp(r1.glyph * (r1.trail * 0.92 + r1.head * 0.35) + r2.glyph * r2.trail * 0.34, 0.0, 1.0);
  float rainHeadGlow = r1.glyph * r1.head + r1.head * 0.22;

  vec3 phosphorTail = vec3(0.08, 0.90, 0.38);
  vec3 phosphorDeep = vec3(0.02, 0.38, 0.16);
  vec3 phosphorHead = vec3(0.86, 1.00, 0.92);
  vec3 catchTint = mix(vec3(0.18, 0.98, 0.48), phosphorHead, clamp(r1.head * 0.85 + pulseRing * 0.7, 0.0, 1.0));

  float sparks = uReduced > 0.5 ? 0.0 : sparkField(p, uRainTime) * edgeMask * smoothstep(0.12, 0.85, streamForce);
  vec3 col = vec3(0.012, 0.028, 0.018);

  if (uMode == 1) {
    // Ink reveal: terminal glyphs emerge cleanly inside falling rain wakes and pulse sweeps
    float wake = clamp(r1.trail * 1.15 + r1.head * 1.50 + r2.trail * 0.42 + pulseFill + pulseRing, 0.0, 1.0);
    float revealMask = clamp(0.06 + 0.94 * pow(wake, 1.4) + 0.78 * uReduced, 0.0, 1.0);
    vec3 revealedDom = domRgb * revealMask + vec3(0.02, 0.16, 0.08) * edgeMask * 0.24;
    float edgeFlare = edgeMask * (0.08 + 1.05 * streamForce) * revealMask;
    float veilYield = mix(0.86, 0.24, smoothstep(0.24, 0.80, domLum) * revealMask);
    vec3 rainCol = mix(phosphorDeep, phosphorTail, r1.trail) * rainBody * veilYield + phosphorHead * rainHeadGlow * 0.78;
    col = revealedDom + rainCol + catchTint * edgeFlare * 0.78 + phosphorHead * sparks * 0.95;
  } else if (uMode == 2) {
    // Decode trace: horizontal neon scanner sweep illuminates DOM edges and cipher streams
    float scanY = uReduced > 0.5 ? uSize.y * 0.44 : mod(uRainTime * 96.0, uSize.y + 44.0) - 22.0;
    float scanBand = exp(-pow((p.y - scanY) / 14.0, 2.0));
    float decodedZone = smoothstep(scanY + 18.0, scanY - 22.0, p.y);
    float domReveal = clamp(0.42 + 0.58 * max(decodedZone, pulseFill) + 0.44 * uReduced, 0.0, 1.0);
    vec3 domLayer = domRgb * domReveal;
    float traceEdge = edgeMask * (0.45 + 1.10 * scanBand + 0.58 * streamForce);
    float rainYield = mix(0.95, 0.25, smoothstep(0.28, 0.82, domLum) * domReveal);
    vec3 rainCol = mix(phosphorDeep, phosphorTail, r1.trail) * rainBody * rainYield + phosphorHead * rainHeadGlow * 0.65;
    vec3 sweepBeam = vec3(0.20, 1.00, 0.56) * scanBand * 0.24;
    col = domLayer + rainCol + sweepBeam + catchTint * traceEdge * 0.70 + phosphorHead * sparks * 0.95;
  } else {
    // Phosphor rain (default): live terminal stays crisp while falling droplets catch and flare on edges
    vec3 domLayer = domRgb * (0.82 + 0.26 * edgeMask);
    float inkYield = mix(1.0, 0.36, smoothstep(0.28, 0.82, domLum));
    vec3 rainCol = mix(phosphorDeep, phosphorTail, r1.trail) * rainBody * inkYield + phosphorHead * rainHeadGlow * mix(0.88, 0.32, smoothstep(0.32, 0.85, domLum));
    float edgeFlare = edgeMask * (0.20 + 1.02 * streamForce);
    col = domLayer + rainCol + catchTint * edgeFlare * 0.66 + phosphorHead * sparks * 0.90;
    col += vec3(0.18, 0.98, 0.50) * pulseRing * (0.28 + 0.72 * edgeMask);
  }

  // Subtle CRT scanline texture and soft edge framing
  float scanline = uReduced > 0.5 ? 0.97 : (0.93 + 0.07 * sin(p.y * 3.14159));
  vec2 vigUv = vUv - 0.5;
  float vig = 1.0 - dot(vigUv, vigUv) * 0.24;
  col = clamp(col * scanline * vig, 0.0, 1.0);

  float outA = max(texC.a, 1.0);
  outColor = vec4(col * outA, outA);
}
`;
// #endregion rain-shader

export function stepRainState(sim, dtSec, reducedMotion = false) {
  const dt = Math.min(0.05, Math.max(0, dtSec));
  if (reducedMotion) {
    sim.rainTime = REDUCED_STATIC_TIME;
    sim.pulseAge = -1;
    return false;
  }
  let keepGoing = false;
  if (!sim.locked) {
    sim.rainTime += dt;
    keepGoing = true;
  }
  if (sim.pulseAge >= 0) {
    sim.pulseAge += dt;
    if (sim.pulseAge >= PULSE_DURATION_SEC) {
      sim.pulseAge = -1;
    } else {
      keepGoing = true;
    }
  }
  return keepGoing;
}

export function measureElementCenter(panelEl, childEl) {
  const pw = Math.max(1, panelEl.offsetWidth || panelEl.clientWidth || 354);
  const ph = Math.max(1, panelEl.offsetHeight || panelEl.clientHeight || 440);
  if (!childEl || childEl === panelEl) {
    return { x: pw * 0.5, y: ph * 0.5 };
  }
  let x = 0;
  let y = 0;
  let cur = childEl;
  while (cur && cur !== panelEl) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent;
  }
  if (cur === panelEl) {
    x += (panelEl.clientLeft || 0) + (childEl.offsetWidth || 0) * 0.5;
    y += (panelEl.clientTop || 0) + (childEl.offsetHeight || 0) * 0.5;
    return { x, y };
  }
  const pr = panelEl.getBoundingClientRect();
  const cr = childEl.getBoundingClientRect();
  const sx = pr.width > 0 ? pw / pr.width : 1;
  const sy = pr.height > 0 ? ph / pr.height : 1;
  return {
    x: (cr.left - pr.left + cr.width * 0.5) * sx,
    y: (cr.top - pr.top + cr.height * 0.5) * sy,
  };
}

// #region geometry-sync
export function syncPanelGeometry({
  canvasEl,
  panelEl,
  mode,
  cw,
  ch,
  unitCache,
  lastGeoKeyRef,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;

  const key = `${mode}|${canvasEl.width}x${canvasEl.height}|${cw}x${ch}`;
  if (!force && lastGeoKeyRef.value === key) return;
  lastGeoKeyRef.value = key;

  if (mode === '2d') {
    panelEl.dataset.hitTick = panelEl.dataset.hitTick === '1' ? '0' : '1';
    return;
  }

  if (mode !== 'webgl') return;

  const zoom = panelEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${cw}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, panelEl, cw);
    unitCache.key = uKey;
  }
  const u = unitCache.unit;

  canvasEl.updateElementGeometry(panelEl, {
    canvasTransform: new DOMMatrix().scale(u, u),
  });
  panelEl.dataset.hitTick = panelEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

const DECODE_PACKETS = [
  'SIG//48.19 kHz :: PARITY OK :: NODE ZION-04',
  'SIG//92.04 kHz :: PHOSPHOR SYNC :: 0 BIT LOSS',
  'SIG//14.77 kHz :: CIPHER KEY 0x7F3A :: DECODED',
  'SIG//64.31 kHz :: EDGE LOCK :: LIVE DOM INTACT',
];

const TRACE_ROUTES = [
  '10.42.0.1 -> 172.16.88.4 -> ZION-CORE',
  '192.168.9.7 -> 10.99.4.12 -> RELAY-09',
  '172.20.3.8 -> 10.12.77.2 -> NEB-LINK',
];

const sim = {
  rainTime: REDUCED_STATIC_TIME,
  locked: false,
  pulseAge: -1,
  pulseOrigin: { x: 180, y: 140 },
};

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  blendMode: 0, // 0 = rain, 1 = mask, 2 = decode
  speed: 1.0,
  density: 0.85,
  reducedOverride: reducedToggle.checked,
  hasPainted: false,
  onScreen: true,
  uploads: 0,
  paints: 0,
  decodeIdx: 0,
  traceIdx: 0,
  lastTickMs: 0,
  rafId: 0,
  lastGeoKeyRef: { value: '' },
  unitCache: { key: '', unit: 1 },
};

let stage = null;
let ctx2d = null;
const viewTextures = new Map();

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 354);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 440);
  return { cw, ch };
}

function syncPanelSize(cw, ch) {
  if (state.mode === 'plain') {
    termPanel.style.width = '';
    termPanel.style.height = '';
    return;
  }
  const pw = `${cw}px`;
  const ph = `${ch}px`;
  if (termPanel.style.width !== pw) termPanel.style.width = pw;
  if (termPanel.style.height !== ph) termPanel.style.height = ph;
}

function updateExternalControls() {
  const modeNames = ['rain', 'mask', 'decode'];
  const activeName = modeNames[state.blendMode] || 'rain';
  for (const btn of modeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === activeName));
  }
  speedOut.textContent = `${state.speed.toFixed(1)}×`;
  densityOut.textContent = `${Math.round(state.density * 100)}%`;
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const modeLabel = state.blendMode === 1
    ? 'Ink reveal'
    : state.blendMode === 2
      ? 'Decode trace'
      : 'Phosphor rain';
  const motionLabel = isReducedMotion()
    ? 'Reduced motion'
    : sim.locked
      ? 'Rain locked'
      : 'Streaming';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${routeLabel} · ${modeLabel} · ${motionLabel} · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

function triggerPulse(sourceEl) {
  if (isReducedMotion()) return;
  sim.pulseOrigin = measureElementCenter(termPanel, sourceEl);
  sim.pulseAge = 0;
  startLoop();
}

function tryUploadElement(el) {
  if (!stage || stage.lost) return null;
  try {
    const tex = stage.upload(el);
    if (tex) {
      viewTextures.set(el, tex);
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return viewTextures.get(el) ?? null;
    }
    throw err;
  }
}

// #region gl-upload
function renderWebGL(changedSet = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  syncPanelSize(cw, ch);

  if (!stage.begin([0.012, 0.028, 0.018, 1.0])) return;
  if (changedSet) {
    if (changedSet.has(termPanel) || !viewTextures.has(termPanel)) {
      tryUploadElement(termPanel);
    }
  } else if (!viewTextures.has(termPanel)) {
    tryUploadElement(termPanel);
  }

  if (!viewTextures.has(termPanel)) return;

  const rainT = isReducedMotion() ? REDUCED_STATIC_TIME : sim.rainTime;
  stage.quad(termPanel, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.uniform1f(loc('uRainTime'), rainT);
    gl.uniform1f(loc('uSpeed'), state.speed);
    gl.uniform1f(loc('uDensity'), state.density);
    gl.uniform1i(loc('uMode'), state.blendMode);
    gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1.0 : 0.0);
    gl.uniform1f(loc('uLocked'), sim.locked ? 1.0 : 0.0);
    gl.uniform1f(loc('uPulseAge'), isReducedMotion() ? -1.0 : sim.pulseAge);
    gl.uniform2f(loc('uPulseOrigin'), sim.pulseOrigin.x, sim.pulseOrigin.y);
  });

  syncPanelGeometry({
    canvasEl: canvas,
    panelEl: termPanel,
    mode: state.mode,
    cw,
    ch,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
  });

  state.paints++;
  updateStatus();
}
// #endregion gl-upload

// #region fallback-2d
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  syncPanelSize(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#030906';
  ctx2d.fillRect(0, 0, cw, ch);
  ctx2d.drawElementImage(termPanel, 0, 0, cw, ch);

  if (state.blendMode === 1 && !isReducedMotion()) {
    ctx2d.fillStyle = 'rgba(3, 10, 6, 0.56)';
    ctx2d.fillRect(0, 0, cw, ch);
  }

  const colW = 14;
  const cols = Math.max(8, Math.floor(cw / colW));
  const rainT = isReducedMotion() ? REDUCED_STATIC_TIME : sim.rainTime;
  const glyphs = '01ABCDEF79*+:#';
  ctx2d.font = '700 11px ui-monospace, monospace';
  ctx2d.textBaseline = 'top';

  for (let c = 0; c < cols; c++) {
    const seed = Math.sin(c * 91.7 + 13.1) * 43758.5453;
    const frac = seed - Math.floor(seed);
    if (frac < 1 - state.density) continue;
    const speed = (65 + frac * 90) * state.speed;
    const span = ch + 140;
    const headY = ((rainT * speed + frac * span) % span) - 20;
    const x = c * colW + 2;

    for (let k = 0; k < 8; k++) {
      const y = headY - k * 14;
      if (y < -14 || y > ch) continue;
      const gChar = glyphs[(c * 5 + k + Math.floor(rainT * 4)) % glyphs.length];
      ctx2d.fillStyle = k === 0
        ? 'rgba(220, 255, 232, 0.92)'
        : `rgba(54, 240, 122, ${(0.55 * (1 - k / 8)).toFixed(2)})`;
      ctx2d.fillText(gChar, x, y);
    }
  }

  if (state.blendMode === 2) {
    const scanY = isReducedMotion() ? ch * 0.44 : (rainT * 96) % ch;
    ctx2d.fillStyle = 'rgba(84, 255, 148, 0.22)';
    ctx2d.fillRect(0, scanY - 6, cw, 12);
  }

  ctx2d.restore();
  syncPanelGeometry({
    canvasEl: canvas,
    panelEl: termPanel,
    mode: state.mode,
    cw,
    ch,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
  });

  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  stageBox.classList.add('is-plain');
  if (termPanel.parentElement !== plainHost) {
    plainHost.append(termPanel);
  }
  syncPanelSize(0, 0);
  showNotice(reason);
  updateExternalControls();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (termPanel.parentElement !== canvas) {
    canvas.append(termPanel);
  }
  showNotice('');
}
// #endregion fallback-2d

function drawCurrentFrame() {
  if (state.mode === 'plain') {
    updateStatus();
    return;
  }
  if (!state.hasPainted) {
    canvas.requestPaint?.();
    return;
  }
  if (state.mode === 'webgl' && stage && !stage.lost) {
    renderWebGL(null);
  } else if (state.mode === '2d' && ctx2d) {
    render2DFallback();
  }
}

function shouldAnimate() {
  return state.mode !== 'plain' &&
    state.onScreen &&
    !document.hidden &&
    !isReducedMotion() &&
    (!sim.locked || sim.pulseAge >= 0);
}

function startLoop() {
  if (state.rafId || !shouldAnimate()) return;
  state.lastTickMs = performance.now();
  state.rafId = requestAnimationFrame(tick);
}

function tick(now) {
  state.rafId = 0;
  if (!state.onScreen || document.hidden || state.mode === 'plain') return;
  const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTickMs) / 1000));
  state.lastTickMs = now;

  const keepGoing = stepRainState(sim, dt, isReducedMotion());
  drawCurrentFrame();

  if (keepGoing && shouldAnimate()) {
    state.rafId = requestAnimationFrame(tick);
  }
}

// Terminal quick commands & typed input inside drawable HTML
function runTerminalCommand(rawText, sourceEl = termCmdInput) {
  const cmd = rawText.trim().toLowerCase();
  if (!cmd) {
    termOutputEl.textContent = 'ERR :: EMPTY COMMAND :: TYPE DECODE, TRACE OR LOCK';
    triggerPulse(sourceEl);
    return;
  }
  if (cmd === 'decode' || cmd.startsWith('decode ')) {
    handleDecodeAction(sourceEl);
    return;
  }
  if (cmd === 'trace' || cmd.startsWith('trace ')) {
    handleTraceAction(sourceEl);
    return;
  }
  if (cmd === 'lock' || cmd === 'unlock') {
    handleLockToggle(sourceEl);
    return;
  }
  if (cmd === 'clear') {
    termCmdInput.value = '';
    termOutputEl.textContent = 'TTY-04 :: BUFFER CLEARED :: READY';
    lineParityEl.textContent = 'BUFFER FLUSHED (0 ERR)';
    triggerPulse(sourceEl);
    return;
  }
  const hex = Array.from(rawText.slice(0, 6))
    .map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
  termOutputEl.textContent = `EXEC // "${rawText.slice(0, 24)}" -> [${hex}]`;
  lineParityEl.textContent = `CRC OK :: ${rawText.length} CHARS INJECTED`;
  triggerPulse(sourceEl);
}

function handleDecodeAction(sourceEl = btnDecode) {
  state.decodeIdx = (state.decodeIdx + 1) % DECODE_PACKETS.length;
  termOutputEl.textContent = DECODE_PACKETS[state.decodeIdx];
  lineChannelEl.textContent = `ZION-04 // PKT #${state.decodeIdx + 1}`;
  lineParityEl.textContent = 'CRC-32 VALID (EDGE CATCH)';
  triggerPulse(sourceEl);
}

function handleTraceAction(sourceEl = btnTrace) {
  state.traceIdx = (state.traceIdx + 1) % TRACE_ROUTES.length;
  const route = TRACE_ROUTES[state.traceIdx];
  lineRouteEl.textContent = route;
  termOutputEl.textContent = `TRACE HOP 0${state.traceIdx + 1} :: ${route}`;
  triggerPulse(sourceEl);
}

function handleLockToggle(sourceEl = btnLock) {
  sim.locked = !sim.locked;
  btnLock.setAttribute('aria-pressed', String(sim.locked));
  termBadgeEl.dataset.locked = String(sim.locked);
  termBadgeEl.textContent = sim.locked ? 'RX // LOCKED' : 'RX // STREAM';
  lineStreamEl.textContent = sim.locked
    ? `RAIN LOCKED @ ${sim.rainTime.toFixed(2)} s`
    : 'PHOSPHOR RAIN LIVE';
  termOutputEl.textContent = sim.locked
    ? `STREAM FROZEN AT ${sim.rainTime.toFixed(2)} s :: DOM REMAINS LIVE`
    : 'STREAM RESUMED :: PHOSPHOR COLUMNS ACTIVE';
  if (sim.locked) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    drawCurrentFrame();
  } else {
    triggerPulse(sourceEl);
    startLoop();
  }
}

termCmdInput.addEventListener('input', () => {
  const val = termCmdInput.value.trim();
  lineParityEl.textContent = val
    ? `LIVE INPUT (${val.length} CHARS) :: UPLOADING`
    : 'BUFFER EMPTY :: AWAITING INPUT';
});

termCmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runTerminalCommand(termCmdInput.value, termCmdInput);
  }
});

btnDecode.addEventListener('click', () => handleDecodeAction(btnDecode));
btnTrace.addEventListener('click', () => handleTraceAction(btnTrace));
btnLock.addEventListener('click', () => handleLockToggle(btnLock));

// External controls
const MODE_MAP = { rain: 0, mask: 1, decode: 2 };
for (const btn of modeButtons) {
  btn.addEventListener('click', () => {
    state.blendMode = MODE_MAP[btn.dataset.mode] ?? 0;
    updateExternalControls();
    drawCurrentFrame();
  });
}

speedSlider.addEventListener('input', () => {
  state.speed = Number(speedSlider.value) / 100;
  updateExternalControls();
  drawCurrentFrame();
});

densitySlider.addEventListener('input', () => {
  state.density = Number(densitySlider.value) / 100;
  updateExternalControls();
  drawCurrentFrame();
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion()) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    sim.pulseAge = -1;
    drawCurrentFrame();
  } else {
    drawCurrentFrame();
    startLoop();
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    sim.pulseAge = -1;
  }
  drawCurrentFrame();
  startLoop();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else {
    drawCurrentFrame();
    startLoop();
  }
});

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(changed);
      startLoop();
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
      startLoop();
    }
  });
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the terminal in plain HTML.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  syncPanelSize(cw, ch);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: RAIN_FRAG,
        onLost: () => {
          viewTextures.clear();
          enterPlainFallback('The WebGL 2 context was lost. Showing the terminal in plain HTML until restored.');
        },
        onRestored: () => {
          viewTextures.clear();
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          state.lastGeoKeyRef.value = '';
          exitPlainFallback();
          const size = getViewportSize();
          syncPanelSize(size.cw, size.ch);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.mode = 'webgl';
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'matrix-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(termPanel);
      canvas.replaceWith(fresh);
      window.__gfx?.retire?.(canvas);
      canvas = fresh;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      if (noticeEl.hidden) {
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
      }
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the terminal is shown as plain HTML.');
}

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else if (state.mode !== 'plain' && state.hasPainted) {
    drawCurrentFrame();
    startLoop();
  }
}).observe(stageBox);

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKeyRef.value = '';
    const { cw, ch } = getViewportSize();
    syncPanelSize(cw, ch);
    if (state.hasPainted) drawCurrentFrame();
    else canvas.requestPaint?.();
  }
}).observe(viewportEl);

updateExternalControls();
initBackend();

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

async function retireFixture(g, rootEl, cv) {
  g?.dispose();
  rootEl.remove();
  window.__gfx?.retire?.(cv);
  // Wait for context-guard's 250 ms prune + 500 ms retire tick so active WebGL contexts stay <= 2
  const deadline = performance.now() + 900;
  while ((window.__gfx?.active?.() ?? 0) > 1 && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 80));
  }
}

function makeFixtureStage(w = 240, h = 160) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px`;

  const panelFix = document.createElement('section');
  panelFix.setAttribute('drawable', '');
  panelFix.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:12px;box-sizing:border-box;` +
    'background:#050c08;color:#ebfff3;font:700 13px ui-monospace,monospace;pointer-events:auto';

  const barFix = document.createElement('div');
  barFix.textContent = 'TTY-04 EDGE BAR';
  barFix.style.cssText =
    'padding:5px 8px;margin-bottom:8px;border:2px solid #80ffb4;border-radius:6px;background:#0b2416;color:#f2fff7';

  const inputFix = document.createElement('input');
  inputFix.type = 'text';
  inputFix.value = 'signal-alpha';
  inputFix.setAttribute('inputmode', 'none');
  inputFix.setAttribute('aria-label', 'Fixture command');
  inputFix.style.cssText =
    'display:block;width:190px;height:32px;margin-bottom:8px;padding:4px 8px;box-sizing:border-box;' +
    'background:#020604;color:#f2fff7;border:2px solid #48d182;border-radius:6px;font:700 13px ui-monospace,monospace';

  const btnFix = document.createElement('button');
  btnFix.type = 'button';
  btnFix.textContent = 'Decode signal';
  btnFix.style.cssText =
    'display:inline-block;width:128px;height:36px;border:2px solid #5cff9d;border-radius:6px;' +
    'background:#0d2919;color:#ebfff3;font:700 12px ui-monospace,monospace';

  panelFix.append(barFix, inputFix, btnFix);
  cv.append(panelFix);
  return { cv, panelFix, barFix, inputFix, btnFix };
}

function drawFixtureFrame(g, cv, panelFix, W, H, { mode = 0, rainTime = 6.4, density = 0.90, reduced = 0.0 } = {}) {
  g.begin([0.012, 0.028, 0.018, 1.0]);
  g.quad(panelFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
    gl.uniform1f(loc('uRainTime'), rainTime);
    gl.uniform1f(loc('uSpeed'), 1.0);
    gl.uniform1f(loc('uDensity'), density);
    gl.uniform1i(loc('uMode'), mode);
    gl.uniform1f(loc('uReduced'), reduced);
    gl.uniform1f(loc('uLocked'), 0.0);
    gl.uniform1f(loc('uPulseAge'), -1.0);
    gl.uniform2f(loc('uPulseOrigin'), W * 0.5, H * 0.5);
  });
}

runTests(testsBody, [
  {
    name: 'ElementGL upload and RAIN_FRAG green phosphor columns + DOM edge flare',
    expect: 'pass',
    why: 'Creates one ElementGL context on testStage() with UNPACK_PREMULTIPLY_ALPHA_WEBGL enabled, waits for paint, calls begin() before upload(), draws all three modes and samples rain columns plus DOM edge flare via readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 160;
      const { cv, panelFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: RAIN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.012, 0.028, 0.018, 1.0]);
        await nextPaint(cv);
        const tex = g.upload(panelFix);

        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 0, rainTime: 6.4, density: 0.92, reduced: 0.0 });
        const err0 = g.gl.getError();

        let bestRain = null;
        for (let y = 114; y <= 148; y += 8) {
          for (let x = 18; x <= 222; x += 6) {
            const px = readCssPixel(g.gl, cv, W, H, x, y);
            if (px[1] > 42 && px[1] > px[0] + 15 && px[1] > px[2] + 12) {
              if (!bestRain || px[1] > bestRain[1]) bestRain = Array.from(px);
            }
          }
        }

        let bestEdge = null;
        for (let x = 24; x <= 200; x += 8) {
          const px = readCssPixel(g.gl, cv, W, H, x, 13);
          if (px[1] > 140 && px[1] >= px[0] && px[1] >= px[2]) {
            if (!bestEdge || px[1] > bestEdge[1]) bestEdge = Array.from(px);
          }
        }

        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 1, rainTime: 6.4, density: 0.92, reduced: 0.0 });
        const err1 = g.gl.getError();
        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 2, rainTime: 6.4, density: 0.92, reduced: 0.0 });
        const err2 = g.gl.getError();

        return need(
          tex?.w > 0 && err0 === g.gl.NO_ERROR && err1 === g.gl.NO_ERROR && err2 === g.gl.NO_ERROR && bestRain && bestEdge,
          `tex=${tex?.w}x${tex?.h}, rainPx=${bestRain ? `[${bestRain}]` : 'none'}, edgePx=${bestEdge ? `[${bestEdge}]` : 'none'}, errors=[${err0},${err1},${err2}].`
        );
      } finally {
        await retireFixture(g, cv, cv);
      }
    },
  },
  {
    name: 'Live input edits trigger paint and re-upload via texElementSubImage2D()',
    expect: 'pass',
    why: 'Mutates an isolated fixture <input> value, waits for nextPaint(), calls begin() before upload() and verifies pixels change inside the input box.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 160;
      const { cv, panelFix, inputFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: RAIN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.012, 0.028, 0.018, 1.0]);
        await nextPaint(cv);
        g.upload(panelFix);
        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 0, rainTime: 6.4, density: 0.35, reduced: 1.0 });
        const beforeSum = [];
        for (let x = 22; x <= 140; x += 6) beforeSum.push(readCssPixel(g.gl, cv, W, H, x, 64)[1]);

        inputFix.value = 'ZZZZZZZZZZZZZZ';
        inputFix.style.background = '#174d2e';
        await nextPaint(cv);
        g.begin([0.012, 0.028, 0.018, 1.0]);
        const tex2 = g.upload(panelFix);
        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 0, rainTime: 6.4, density: 0.35, reduced: 1.0 });
        const afterSum = [];
        for (let x = 22; x <= 140; x += 6) afterSum.push(readCssPixel(g.gl, cv, W, H, x, 64)[1]);

        let maxDelta = 0;
        for (let i = 0; i < beforeSum.length; i++) maxDelta = Math.max(maxDelta, Math.abs(afterSum[i] - beforeSum[i]));

        return need(
          tex2?.w > 0 && inputFix.value === 'ZZZZZZZZZZZZZZ' && maxDelta > 15 && g.gl.getError() === g.gl.NO_ERROR,
          `re-uploaded ${tex2?.w}x${tex2?.h}, inputDelta=${maxDelta}, value="${inputFix.value}".`
        );
      } finally {
        await retireFixture(g, cv, cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() hits terminal button and input',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled updateElementGeometry() plus dataset.hitTick on an isolated fixture on testStage() and checks document.elementsFromPoint() hits both the button and the input.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 240;
      const H = 160;
      const { cv, panelFix, inputFix, btnFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: RAIN_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0.012, 0.028, 0.018, 1.0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        const unitCache = { key: '', unit: 1 };
        const lastGeoKeyRef = { value: '' };
        const mode = g ? 'webgl' : '2d';
        syncPanelGeometry({ canvasEl: cv, panelEl: panelFix, mode, cw: W, ch: H, unitCache, lastGeoKeyRef, force: true });
        if (g) {
          g.upload(panelFix);
          drawFixtureFrame(g, cv, panelFix, W, H, { mode: 0, rainTime: 6.4 });
        } else {
          cv.getContext('2d').drawElementImage(panelFix, 0, 0, W, H);
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const br = btnFix.getBoundingClientRect();
        const ir = inputFix.getBoundingClientRect();
        const btnHits = document.elementsFromPoint(br.left + br.width * 0.5, br.top + br.height * 0.5);
        const inputHits = document.elementsFromPoint(ir.left + ir.width * 0.5, ir.top + ir.height * 0.5);

        return need(
          btnHits.includes(btnFix) && inputHits.includes(inputFix),
          `hitButton=${btnHits.includes(btnFix)}, hitInput=${inputHits.includes(inputFix)}, unit=${unitCache.unit.toFixed(3)}.`
        );
      } finally {
        await retireFixture(g, cv, cv);
      }
    },
  },
  {
    name: 'Reduced motion freezes rain timestamp and keeps Ink reveal terminal legible',
    expect: 'pass',
    why: 'Steps stepRainState() with reducedMotion = true verifying rainTime stays pinned at REDUCED_STATIC_TIME, and draws uMode = 1 with uReduced = 1.0 verifying visible DOM bar pixels.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const s = { rainTime: 12.3, locked: false, pulseAge: 0.4 };
      const keep = stepRainState(s, 0.05, true);
      const W = 240;
      const H = 160;
      const { cv, panelFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: RAIN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.012, 0.028, 0.018, 1.0]);
        await nextPaint(cv);
        g.upload(panelFix);
        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 1, rainTime: s.rainTime, density: 0.85, reduced: 1.0 });
        const err = g.gl.getError();
        let maxGreen = 0;
        for (let x = 20; x <= 200; x += 10) {
          const px = readCssPixel(g.gl, cv, W, H, x, 13);
          maxGreen = Math.max(maxGreen, px[1]);
        }
        return need(
          !keep && s.rainTime === REDUCED_STATIC_TIME && s.pulseAge === -1 && err === g.gl.NO_ERROR && maxGreen > 130,
          `keep=${keep}, rainTime=${s.rainTime}, pulseAge=${s.pulseAge}, inkRevealEdgeGreen=${maxGreen}.`
        );
      } finally {
        await retireFixture(g, cv, cv);
      }
    },
  },
  {
    name: 'webglcontextlost enters plain fallback and webglcontextrestored recovers ElementGL',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated ElementGL fixture on testStage(), verifying plain DOM recovery and UNPACK_PREMULTIPLY_ALPHA_WEBGL restore.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220;
      const H = 150;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, panelFix } = makeFixtureStage(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: RAIN_FRAG,
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            plain.append(panelFix);
          },
          onRestored: () => {
            restoredFired = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            cv.append(panelFix);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.012, 0.028, 0.018, 1.0]);
        await nextPaint(cv);
        g.upload(panelFix);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(panelFix);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        g.begin([0.012, 0.028, 0.018, 1.0]);
        await nextPaint(cv);
        const texAfter = g.upload(panelFix);
        drawFixtureFrame(g, cv, panelFix, W, H, { mode: 0, rainTime: 6.4 });
        const err = g.gl.getError();

        return need(
          inPlainWhileLost && restoredFired && !g.lost && cv.contains(panelFix) && texAfter?.w > 0 && err === g.gl.NO_ERROR,
          `defaultPrevented=${lostEv.defaultPrevented}, plainWhileLost=${inPlainWhileLost}, restored=${restoredFired}, err=${err}.`
        );
      } finally {
        await retireFixture(g, wrap, cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'matrix-rain terminal stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !viewTextures.has(termPanel)) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.paints > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
]);
