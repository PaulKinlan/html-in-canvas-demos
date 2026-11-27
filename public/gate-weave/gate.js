import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const REEL_DURATION_SEC = 16.0;
export const SPLICE_DURATION_SEC = 0.48;
export const CUE_DURATION_SEC = 1.15;

// DOM references
const stageBox = document.getElementById('gate-stage');
const viewportEl = document.getElementById('gate-viewport');
let canvas = document.getElementById('gate-canvas');
const reelCard = document.getElementById('reel-card');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('gate-notice');
const statusEl = document.getElementById('gate-status');
const testsBody = document.getElementById('tests');

// Live drawable DOM elements inside #reel-card
const reelBadgeEl = document.getElementById('reel-badge');
const takeBadgeEl = document.getElementById('take-badge');
const stockBadgeEl = document.getElementById('stock-badge');
const frameCounterEl = document.getElementById('frame-counter');
const sceneHeadingInput = document.getElementById('scene-heading');
const sceneDialogueInput = document.getElementById('scene-dialogue');
const reelFillEl = document.getElementById('reel-fill');
const cueStatusEl = document.getElementById('cue-status');
const btnSlate = document.getElementById('btn-slate');
const btnSplice = document.getElementById('btn-splice');
const btnReel = document.getElementById('btn-reel');

// External controls
const cadenceButtons = Array.from(document.querySelectorAll('#cadence-group button[data-cadence]'));
const weaveSlider = document.getElementById('weave-slider');
const weaveOut = document.getElementById('weave-out');
const halationSlider = document.getElementById('halation-slider');
const halationOut = document.getElementById('halation-out');
const extSpliceBtn = document.getElementById('ext-splice-btn');
const extCueBtn = document.getElementById('ext-cue-btn');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region weave-math
export function fract(x) {
  return x - Math.floor(x);
}

export function hash11(p) {
  let x = fract(p * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

export function snoise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3.0 - 2.0 * f);
  return hash11(i) * (1.0 - u) + hash11(i + 1.0) * u;
}

export function computeGateMotion(projTime, cadence24, weaveAmount, spliceEnv, reduced) {
  if (reduced) {
    return { tSample: 0, dx: 0, dy: 0, angle: 0, splicePulse: 0 };
  }
  const tSample = cadence24 ? Math.floor(projTime * 24.0) / 24.0 : projTime;
  let dx = (Math.sin(tSample * 7.1) * 0.42 + (snoise1(tSample * 19.5 + 3.1) - 0.5) * 1.15) * 3.4 * weaveAmount;
  let dy = (Math.cos(tSample * 5.8 + 0.9) * 0.38 + (snoise1(tSample * 22.7 + 17.3) - 0.5) * 1.25) * 3.2 * weaveAmount;
  let angle = ((snoise1(tSample * 15.3 + 41.7) - 0.5) * 1.35 + Math.sin(tSample * 4.7) * 0.25) * 0.0085 * weaveAmount;

  let splicePulse = 0;
  if (spliceEnv > 0.001) {
    splicePulse = Math.sin(Math.min(1.0, spliceEnv * 1.35) * Math.PI);
    const jumpY = cadence24 ? Math.floor(splicePulse * 46.0 + 0.5) : splicePulse * 46.0;
    dy += jumpY;
    dx -= 3.0 * splicePulse;
    angle += 0.016 * splicePulse;
  }
  return { tSample, dx, dy, angle, splicePulse };
}

export function computeCueAlpha(reelElapsed, manualCueTimer, reduced) {
  if (reduced) {
    return manualCueTimer > 0 ? 1.0 : 0.0;
  }
  let alpha = 0;
  // Automatic 2-blink reel changeover cue near end of reel cycle
  if (reelElapsed >= REEL_DURATION_SEC - 2.4 && reelElapsed < REEL_DURATION_SEC - 1.9) {
    alpha = Math.max(alpha, 1.0);
  }
  if (reelElapsed >= REEL_DURATION_SEC - 0.95 && reelElapsed < REEL_DURATION_SEC - 0.4) {
    alpha = Math.max(alpha, 1.0);
  }
  // Manual "Changeover cue" double-blink envelope
  if (manualCueTimer > 0) {
    const p = manualCueTimer / CUE_DURATION_SEC;
    if ((p > 0.58 && p <= 0.98) || (p > 0.06 && p <= 0.44)) {
      alpha = 1.0;
    }
  }
  return alpha;
}
// #endregion weave-math

// #region gate-shader
export const GATE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uProjTime;
uniform float uCadence24;
uniform float uWeaveAmount;
uniform float uHalation;
uniform float uSplice;
uniform float uCueAlpha;
uniform float uSlateFlash;
uniform vec2 uGatePad;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;

float hash11(float p) {
  float x = fract(p * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float snoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}

vec4 sampleCard(vec2 uv, bool wrapY) {
  vec2 cuv = vec2(clamp(uv.x, 0.001, 0.999), wrapY ? fract(uv.y) : clamp(uv.y, 0.001, 0.999));
  return texture(uTex, cuv);
}

void main() {
  vec2 sz = max(uSize, vec2(1.0));
  vec2 p = vUv * sz;

  // Stationary matte projector gate aperture SDF
  vec2 gateHalf = max(sz * 0.5 - uGatePad, vec2(40.0));
  vec2 gateCenter = sz * 0.5;
  float cornerR = 12.0;
  vec2 gq = abs(p - gateCenter) - gateHalf + vec2(cornerR);
  float gateSd = min(max(gq.x, gq.y), 0.0) + length(max(gq, 0.0)) - cornerR;
  float gateMask = 1.0 - smoothstep(-1.0, 1.3, gateSd);

  // 24 fps stepped vs 60 fps continuous gate weave + splice jump around left sprocket pin
  float tSample = uReduced > 0.5
    ? 0.0
    : (uCadence24 > 0.5 ? floor(uProjTime * 24.0) / 24.0 : uProjTime);

  float wx = 0.0;
  float wy = 0.0;
  float ang = 0.0;
  float splicePulse = 0.0;
  if (uReduced < 0.5) {
    wx = (sin(tSample * 7.1) * 0.42 + (snoise1(tSample * 19.5 + 3.1) - 0.5) * 1.15) * 3.4 * uWeaveAmount;
    wy = (cos(tSample * 5.8 + 0.9) * 0.38 + (snoise1(tSample * 22.7 + 17.3) - 0.5) * 1.25) * 3.2 * uWeaveAmount;
    ang = ((snoise1(tSample * 15.3 + 41.7) - 0.5) * 1.35 + sin(tSample * 4.7) * 0.25) * 0.0085 * uWeaveAmount;
    if (uSplice > 0.001) {
      splicePulse = sin(min(1.0, uSplice * 1.35) * 3.14159265);
      float jumpY = uCadence24 > 0.5 ? floor(splicePulse * 46.0 + 0.5) : splicePulse * 46.0;
      wy += jumpY;
      wx -= 3.0 * splicePulse;
      ang += 0.016 * splicePulse;
    }
  }

  vec2 pivot = vec2(sz.x * 0.10, sz.y * 0.50);
  vec2 rel = p - pivot - vec2(wx, wy);
  float cs = cos(-ang);
  float sn = sin(-ang);
  vec2 cardCss = pivot + vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  vec2 weaveUv = cardCss / sz;
  bool splicing = splicePulse > 0.02;

  vec4 tex = sampleCard(weaveUv, splicing);
  vec3 col = tex.rgb;
  float centerLum = dot(col, vec3(0.299, 0.587, 0.114));

  // Kodak Vision3 red-orange emulsion halation (16-tap 2-ring + close edge scatter)
  if (uHalation > 0.001) {
    float halo = 0.0;
    float wSum = 0.0;
    vec2 pxStep = 1.0 / sz;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.04719755;
      vec2 dir = vec2(cos(a), sin(a));
      vec4 s0 = sampleCard(weaveUv + dir * 2.6 * pxStep, splicing);
      vec4 s1 = sampleCard(weaveUv + dir * 6.0 * pxStep, splicing);
      vec4 s2 = sampleCard(weaveUv + (vec2(-dir.y, dir.x) * 0.4 + dir * 0.9) * 12.0 * pxStep, splicing);
      float h0 = smoothstep(0.62, 0.94, dot(s0.rgb, vec3(0.299, 0.587, 0.114)));
      float h1 = smoothstep(0.62, 0.94, dot(s1.rgb, vec3(0.299, 0.587, 0.114)));
      float h2 = smoothstep(0.62, 0.94, dot(s2.rgb, vec3(0.299, 0.587, 0.114)));
      halo += h0 * 1.05 + h1 * 1.25 + h2 * 0.85;
      wSum += 3.15;
    }
    halo /= wSum;
    float shadowMask = 1.0 - smoothstep(0.50, 0.88, centerLum);
    vec3 halationCol = vec3(1.0, 0.24, 0.04) * halo * uHalation * (0.28 + 0.65 * shadowMask);
    vec3 highlightWarm = vec3(1.0, 0.44, 0.12) * halo * smoothstep(0.72, 1.0, centerLum) * uHalation * 0.08;
    col += halationCol + highlightWarm;
  }

  // 35mm film-splice frame line & translucent Mylar tape flash across seam
  if (splicing) {
    float seamY = abs(weaveUv.y) * sz.y;
    float seamBar = 1.0 - smoothstep(3.5, 6.0, seamY);
    col = mix(col, vec3(0.025, 0.02, 0.02), seamBar);
    float tapeMask = 1.0 - smoothstep(14.0, 19.0, seamY);
    float tapeSheen = (0.28 + 0.14 * sin((p.x + p.y * 0.6) * 0.25)) * tapeMask * splicePulse;
    col = mix(col, vec3(1.0, 0.95, 0.85), clamp(tapeSheen, 0.0, 0.52));
    float seamEdge = exp(-pow((seamY - 16.5) / 1.8, 2.0)) * splicePulse;
    col += vec3(0.9, 0.55, 0.25) * seamEdge * 0.35;
  }

  // Authentic top-right reel changeover cue mark ("cigarette burn")
  if (uCueAlpha > 0.001) {
    vec2 cueCenter = vec2(sz.x - uGatePad.x - 24.0, uGatePad.y + 22.0);
    vec2 dCue = (cardCss - cueCenter) / vec2(10.5, 13.5);
    float angCue = atan(dCue.y, dCue.x);
    float ragged = (hash11(floor(angCue * 7.0) + 5.0) - 0.5) * 0.08;
    float rCue = length(dCue) + ragged;
    float coreDark = 1.0 - smoothstep(0.56, 0.72, rCue);
    float burnRim = exp(-pow((rCue - 0.88) / 0.16, 2.0));
    float burnHalo = exp(-pow((rCue - 0.92) / 0.44, 2.0));
    vec3 cueCol = mix(col, vec3(0.04, 0.025, 0.02), coreDark * 0.94);
    cueCol += vec3(1.0, 0.76, 0.42) * burnRim * 0.92;
    cueCol += vec3(1.0, 0.26, 0.04) * burnHalo * (0.45 + 0.35 * uHalation);
    col = mix(col, cueCol, clamp(uCueAlpha, 0.0, 1.0));
  }

  // Silver-halide film grain, vertical tramline scratches & ephemeral dust hairs
  float grainFrame = uReduced > 0.5
    ? 1.0
    : (uCadence24 > 0.5 ? floor(uProjTime * 24.0) : floor(uProjTime * 60.0));
  float midWeight = 1.0 - abs(centerLum * 2.0 - 1.0) * 0.45;
  float grain = (hash21(floor(p * 0.85) + vec2(grainFrame * 17.3, grainFrame * 7.1)) - 0.5) * 0.068 * midWeight;
  col += vec3(grain * 1.05, grain * 0.98, grain * 0.88);

  if (uReduced < 0.5) {
    // Sparse vertical cellulose scratch that wanders between frames
    float scratchGate = step(0.54, hash11(floor(grainFrame * 0.25) + 11.7));
    float scratchX = sz.x * (0.14 + 0.72 * hash11(floor(grainFrame * 0.33) + 3.9));
    float scratchW = abs(p.x - scratchX + sin(p.y * 0.03 + grainFrame) * 1.4);
    float scratch = (1.0 - smoothstep(0.3, 1.25, scratchW)) * scratchGate * 0.19;
    col += vec3(0.95, 0.88, 0.78) * scratch;

    // Single-frame dust fleck / hair filament
    float dustSeed = floor(grainFrame);
    if (hash11(dustSeed * 1.91 + 7.2) > 0.58) {
      vec2 dustPos = vec2(
        uGatePad.x + 20.0 + (sz.x - 2.0 * uGatePad.x - 40.0) * hash11(dustSeed * 3.1),
        uGatePad.y + 20.0 + (sz.y - 2.0 * uGatePad.y - 40.0) * hash11(dustSeed * 5.7)
      );
      vec2 dd = p - dustPos;
      float hair = exp(-pow(abs(dd.y - sin(dd.x * 0.35) * 2.5) / 1.1, 2.0)) * step(abs(dd.x), 6.0);
      col = mix(col, vec3(0.06, 0.04, 0.03), hair * 0.55);
    }
  }

  // Warm tungsten projector bulb falloff + subtle 24 fps shutter breath
  vec2 vigUv = (p - gateCenter) / max(gateHalf, vec2(1.0));
  float vig = 1.03 - 0.23 * dot(vigUv * vec2(0.85, 0.95), vigUv * vec2(0.85, 0.95));
  float shutter = uReduced > 0.5 ? 1.0 : 1.0 + 0.020 * sin(grainFrame * 2.65);
  col *= vec3(1.04, 0.99, 0.91) * vig * shutter;

  // Slate clapper flash
  if (uSlateFlash > 0.001) {
    col = mix(col, vec3(1.0, 0.96, 0.88), uSlateFlash * 0.45);
  }

  // Stationary matte projector gate housing + subtle scrolling 35mm sprocket perforations
  vec3 gateBg = vec3(0.025, 0.021, 0.020);
  if (gateMask < 0.999) {
    float lip = exp(-pow(gateSd / 2.2, 2.0));
    gateBg += vec3(0.18, 0.09, 0.04) * lip * (0.35 + 0.4 * uHalation);

    bool inSprocketCol = abs(p.x - (uGatePad.x * 0.48)) < 3.4 || abs(p.x - (sz.x - uGatePad.x * 0.48)) < 3.4;
    if (inSprocketCol) {
      float scrollY = uReduced > 0.5 ? 0.0 : (tSample * 340.0);
      float perfY = mod(p.y + scrollY, 26.0);
      if (perfY > 5.0 && perfY < 16.0) {
        gateBg = vec3(0.09, 0.065, 0.045);
      }
    }
  }

  vec3 finalCol = mix(gateBg, clamp(col, 0.0, 1.0), gateMask);
  outColor = vec4(clamp(finalCol, 0.0, 1.0), 1.0);
}
`;
// #endregion gate-shader

// #region geometry-sync
export function syncCardGeometry({
  canvasEl,
  cardEl,
  mode,
  cw,
  ch,
  dx,
  dy,
  angle,
  unitCache,
  lastGeoKeyRef,
  lastTickPosRef,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;

  const zoom = cardEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${cw}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, cardEl, cw);
    unitCache.key = uKey;
    if (lastGeoKeyRef) lastGeoKeyRef.value = '';
  }
  const u = unitCache.unit;

  const qx = Math.round(dx * 2) / 2;
  const qy = Math.round(dy * 2) / 2;
  const qa = Math.round(angle * 2000) / 2000;
  const gKey = `${mode}|${cw}x${ch}|${u.toFixed(4)}|${qx}|${qy}|${qa}`;
  if (!force && lastGeoKeyRef && lastGeoKeyRef.value === gKey) return;
  if (lastGeoKeyRef) lastGeoKeyRef.value = gKey;

  const pivotX = cw * 0.10;
  const pivotY = ch * 0.50;
  const deg = (qa * 180) / Math.PI;
  const m = new DOMMatrix()
    .scale(u)
    .translate(pivotX + qx, pivotY + qy)
    .rotate(deg)
    .translate(-pivotX, -pivotY);

  try {
    canvasEl.updateElementGeometry(cardEl, { canvasTransform: m });
  } catch {}

  const movedEnough = !lastTickPosRef || Math.hypot(qx - lastTickPosRef.x, qy - lastTickPosRef.y) >= 1.0 || Math.abs(qa - lastTickPosRef.a) >= 0.004;
  if (force || movedEnough) {
    if (lastTickPosRef) {
      lastTickPosRef.x = qx;
      lastTickPosRef.y = qy;
      lastTickPosRef.a = qa;
    }
    cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion geometry-sync

const REEL_PRESETS = [
  { label: 'Reel 01', stock: '5219 500T' },
  { label: 'Reel 02', stock: '2383 PRINT' },
];

const sim = {
  projTime: 0,
  reelElapsed: 0,
  cadence24: true,
  weaveAmount: 0.65,
  halation: 0.85,
  spliceTimer: 0,
  manualCueTimer: 0,
  slateFlash: 0,
  take: 1,
  reelIndex: 0,
  cueCount: 0,
};

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  reducedOverride: reducedToggle.checked,
  hasPainted: false,
  onScreen: true,
  uploads: 0,
  paints: 0,
  rafId: 0,
  lastTickMs: 0,
  lastFrameText: '',
  lastMeterKey: '',
  dirtyTexture: true,
  unitCache: { key: '', unit: 1 },
  lastGeoKeyRef: { value: '' },
  lastTickPosRef: { x: 0, y: 0, a: 0 },
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
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 452);
  return { cw, ch };
}

function getGatePad(cw) {
  return cw < 440 ? [11, 13] : [18, 16];
}

function syncCardSizes(cw, ch) {
  if (state.mode === 'plain') {
    reelCard.style.width = '';
    reelCard.style.height = '';
    return;
  }
  const bw = `${cw}px`;
  const bh = `${ch}px`;
  if (reelCard.style.width !== bw) reelCard.style.width = bw;
  if (reelCard.style.height !== bh) reelCard.style.height = bh;
}

function formatTimecode(projTime) {
  const totalFrames = Math.max(1, Math.floor(projTime * 24) + 1);
  const ff = totalFrames % 24;
  const totalSec = Math.floor(totalFrames / 24);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const pad2 = (n) => String(n).padStart(2, '0');
  const pad4 = (n) => String(n).padStart(4, '0');
  return `F${pad4(totalFrames)} · ${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

function syncInCardDOM(force = false) {
  const text = formatTimecode(sim.projTime);
  if (force || state.lastFrameText !== text) {
    state.lastFrameText = text;
    frameCounterEl.textContent = text;
  }
  const rem = Math.max(0, REEL_DURATION_SEC - sim.reelElapsed);
  const stepSec = (Math.round(rem * 5) / 5).toFixed(1);
  const cueActive = computeCueAlpha(sim.reelElapsed, sim.manualCueTimer, isReducedMotion()) > 0.01;
  const meterKey = `${stepSec}|${cueActive ? 1 : 0}|${sim.reelIndex}|${sim.take}`;
  if (force || state.lastMeterKey !== meterKey) {
    state.lastMeterKey = meterKey;
    const pct = Math.min(100, Math.max(0, (sim.reelElapsed / REEL_DURATION_SEC) * 100));
    reelFillEl.style.width = `${pct.toFixed(1)}%`;
    cueStatusEl.textContent = cueActive ? 'CUE MARK' : `CUE IN ${stepSec}s`;
    const preset = REEL_PRESETS[sim.reelIndex];
    reelBadgeEl.textContent = preset.label;
    stockBadgeEl.textContent = preset.stock;
    takeBadgeEl.textContent = `Take ${String(sim.take).padStart(2, '0')}`;
  }
}

function updateExternalControls() {
  for (const btn of cadenceButtons) {
    const is24 = btn.dataset.cadence === '24';
    btn.setAttribute('aria-pressed', String(is24 === sim.cadence24));
  }
  weaveOut.textContent = `${Math.round(sim.weaveAmount * 100)}%`;
  halationOut.textContent = `${Math.round(sim.halation * 100)}%`;
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const cadenceLabel = isReducedMotion()
    ? 'Steady (reduced motion)'
    : sim.cadence24
      ? '24 fps telecine'
      : '60 fps continuous';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${routeLabel} · ${cadenceLabel} · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
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

function renderWebGL(changedSet = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  syncCardSizes(cw, ch);

  if (!stage.begin([0, 0, 0, 0])) return;

  if (changedSet?.has(reelCard) || state.dirtyTexture || !viewTextures.has(reelCard)) {
    tryUploadElement(reelCard);
    state.dirtyTexture = false;
  }
  if (!viewTextures.has(reelCard)) return;

  const reduced = isReducedMotion();
  const spliceEnv = sim.spliceTimer > 0 ? sim.spliceTimer / SPLICE_DURATION_SEC : 0;
  const cueAlpha = computeCueAlpha(sim.reelElapsed, sim.manualCueTimer, reduced);
  const [padX, padY] = getGatePad(cw);
  const motion = computeGateMotion(sim.projTime, sim.cadence24, sim.weaveAmount, spliceEnv, reduced);

  stage.quad(reelCard, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.uniform1f(loc('uProjTime'), sim.projTime);
    gl.uniform1f(loc('uCadence24'), sim.cadence24 ? 1.0 : 0.0);
    gl.uniform1f(loc('uWeaveAmount'), sim.weaveAmount);
    gl.uniform1f(loc('uHalation'), sim.halation);
    gl.uniform1f(loc('uSplice'), spliceEnv);
    gl.uniform1f(loc('uCueAlpha'), cueAlpha);
    gl.uniform1f(loc('uSlateFlash'), sim.slateFlash);
    gl.uniform2f(loc('uGatePad'), padX, padY);
    gl.uniform1f(loc('uReduced'), reduced ? 1.0 : 0.0);
  });

  syncCardGeometry({
    canvasEl: canvas,
    cardEl: reelCard,
    mode: state.mode,
    cw,
    ch,
    dx: motion.dx,
    dy: motion.dy,
    angle: motion.angle,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
    lastTickPosRef: state.lastTickPosRef,
  });

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  syncCardSizes(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const reduced = isReducedMotion();
  const spliceEnv = sim.spliceTimer > 0 ? sim.spliceTimer / SPLICE_DURATION_SEC : 0;
  const cueAlpha = computeCueAlpha(sim.reelElapsed, sim.manualCueTimer, reduced);
  const [padX, padY] = getGatePad(cw);
  const motion = computeGateMotion(sim.projTime, sim.cadence24, sim.weaveAmount, spliceEnv, reduced);
  const pivotX = cw * 0.10;
  const pivotY = ch * 0.50;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#080707';
  ctx2d.fillRect(0, 0, cw, ch);

  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.roundRect(padX, padY, cw - padX * 2, ch - padY * 2, 12);
  ctx2d.clip();

  ctx2d.save();
  ctx2d.translate(pivotX + motion.dx, pivotY + motion.dy);
  ctx2d.rotate(motion.angle);
  ctx2d.translate(-pivotX, -pivotY);
  ctx2d.drawElementImage(reelCard, 0, 0, cw, ch);

  if (sim.halation > 0.05) {
    ctx2d.fillStyle = `rgba(255, 72, 18, ${(0.08 * sim.halation).toFixed(3)})`;
    ctx2d.fillRect(0, 0, cw, ch);
  }
  if (cueAlpha > 0.01) {
    const cx = cw - padX - 24;
    const cy = padY + 22;
    ctx2d.strokeStyle = `rgba(255, 130, 48, ${(0.9 * cueAlpha).toFixed(3)})`;
    ctx2d.lineWidth = 3;
    ctx2d.fillStyle = `rgba(12, 8, 6, ${(0.92 * cueAlpha).toFixed(3)})`;
    ctx2d.beginPath();
    ctx2d.ellipse(cx, cy, 9.5, 12.5, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.stroke();
  }
  ctx2d.restore();
  ctx2d.restore();

  ctx2d.restore();
  syncCardGeometry({
    canvasEl: canvas,
    cardEl: reelCard,
    mode: state.mode,
    cw,
    ch,
    dx: motion.dx,
    dy: motion.dy,
    angle: motion.angle,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
    lastTickPosRef: state.lastTickPosRef,
  });

  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  stageBox.classList.add('is-plain');
  if (reelCard.parentElement !== plainHost) plainHost.append(reelCard);
  syncCardSizes(0, 0);
  showNotice(reason);
  syncInCardDOM(true);
  updateExternalControls();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (reelCard.parentElement !== canvas) canvas.append(reelCard);
  state.dirtyTexture = true;
  showNotice('');
}
// #endregion fallback-2d

function drawCurrentFrame() {
  if (state.mode === 'plain') {
    syncInCardDOM(true);
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

function canAnimateLoop() {
  return state.onScreen && !document.hidden && !isReducedMotion() && state.mode !== 'plain';
}

function startLoop() {
  if (state.rafId || !canAnimateLoop()) return;
  state.lastTickMs = performance.now();
  state.rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function tick(now) {
  state.rafId = 0;
  if (!canAnimateLoop()) return;

  const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTickMs) / 1000));
  state.lastTickMs = now;

  sim.projTime += dt;
  sim.reelElapsed += dt;
  if (sim.reelElapsed >= REEL_DURATION_SEC) {
    sim.reelElapsed = sim.reelElapsed % REEL_DURATION_SEC;
    sim.reelIndex = (sim.reelIndex + 1) % REEL_PRESETS.length;
  }
  if (sim.spliceTimer > 0) sim.spliceTimer = Math.max(0, sim.spliceTimer - dt);
  if (sim.manualCueTimer > 0) sim.manualCueTimer = Math.max(0, sim.manualCueTimer - dt);
  if (sim.slateFlash > 0) sim.slateFlash = Math.max(0, sim.slateFlash - dt * 5.2);

  syncInCardDOM(false);
  drawCurrentFrame();

  if (canAnimateLoop()) {
    state.rafId = requestAnimationFrame(tick);
  }
}

function triggerSlate() {
  sim.take++;
  sim.slateFlash = isReducedMotion() ? 0 : 1.0;
  state.dirtyTexture = true;
  syncInCardDOM(true);
  drawCurrentFrame();
}

function triggerSplice() {
  sim.spliceTimer = isReducedMotion() ? 0 : SPLICE_DURATION_SEC;
  drawCurrentFrame();
}

function triggerCue() {
  if (isReducedMotion()) {
    sim.manualCueTimer = sim.manualCueTimer > 0 ? 0 : CUE_DURATION_SEC;
  } else {
    sim.manualCueTimer = CUE_DURATION_SEC;
  }
  syncInCardDOM(true);
  drawCurrentFrame();
}

function switchReel() {
  sim.reelIndex = (sim.reelIndex + 1) % REEL_PRESETS.length;
  sim.reelElapsed = 0;
  sim.manualCueTimer = isReducedMotion() ? 0 : 0.65;
  sim.slateFlash = isReducedMotion() ? 0 : 0.6;
  state.dirtyTexture = true;
  syncInCardDOM(true);
  drawCurrentFrame();
}

// Card interactions inside #reel-card
btnSlate.addEventListener('click', triggerSlate);
btnSplice.addEventListener('click', triggerSplice);
btnReel.addEventListener('click', switchReel);
sceneHeadingInput.addEventListener('input', () => { state.dirtyTexture = true; });
sceneDialogueInput.addEventListener('input', () => { state.dirtyTexture = true; });

// External projector controls
for (const btn of cadenceButtons) {
  btn.addEventListener('click', () => {
    sim.cadence24 = btn.dataset.cadence === '24';
    updateExternalControls();
    drawCurrentFrame();
  });
}

weaveSlider.addEventListener('input', () => {
  sim.weaveAmount = Math.max(0, Math.min(2, Number(weaveSlider.value) / 100));
  updateExternalControls();
  drawCurrentFrame();
});

halationSlider.addEventListener('input', () => {
  sim.halation = Math.max(0, Math.min(1.5, Number(halationSlider.value) / 100));
  updateExternalControls();
  drawCurrentFrame();
});

extSpliceBtn.addEventListener('click', triggerSplice);
extCueBtn.addEventListener('click', triggerCue);

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion()) {
    stopLoop();
    sim.spliceTimer = 0;
    sim.slateFlash = 0;
  } else {
    startLoop();
  }
  syncInCardDOM(true);
  drawCurrentFrame();
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) stopLoop();
  else startLoop();
  syncInCardDOM(true);
  drawCurrentFrame();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (canAnimateLoop() && state.hasPainted) {
    startLoop();
  }
});

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    const firstPaint = !state.hasPainted;
    state.hasPainted = true;
    state.dirtyTexture = true;
    const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(changed);
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
    if (firstPaint && canAnimateLoop()) startLoop();
  });
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the screenplay card as plain HTML.');
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
  syncCardSizes(cw, ch);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: GATE_FRAG,
        onLost: () => {
          viewTextures.clear();
          enterPlainFallback('The WebGL 2 context was lost. Showing the screenplay card as plain HTML until restored.');
        },
        onRestored: () => {
          viewTextures.clear();
          state.mode = 'webgl';
          state.hasPainted = false;
          state.dirtyTexture = true;
          state.unitCache.key = '';
          state.lastGeoKeyRef.value = '';
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          exitPlainFallback();
          const size = getViewportSize();
          syncCardSizes(size.cw, size.ch);
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
      fresh.id = 'gate-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(reelCard);
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
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() fallback.');
      }
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the screenplay card is shown as plain HTML.');
}

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    stopLoop();
  } else if (state.mode !== 'plain' && state.hasPainted) {
    drawCurrentFrame();
    startLoop();
  }
}).observe(stageBox);

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKeyRef.value = '';
    state.dirtyTexture = true;
    const { cw, ch } = getViewportSize();
    syncCardSizes(cw, ch);
    if (state.hasPainted) drawCurrentFrame();
    else canvas.requestPaint?.();
  }
}).observe(viewportEl);

syncInCardDOM(true);
updateExternalControls();
initBackend();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function settleGfx(baseActive) {
  if (!window.__gfx?.active) return;
  const deadline = performance.now() + 800;
  while (window.__gfx.active() > baseActive && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 120));
  }
}

function readCssPx(gl, cv, w, h, cssX, cssY) {
  const sx = cv.width / Math.max(1, w);
  const sy = cv.height / Math.max(1, h);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.floor(cssX * sx)));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.floor(cv.height - 1 - cssY * sy)));
  const px = new Uint8Array(4);
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeFixtureCanvas(w, h, innerHtml) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;`;
  cv.innerHTML = innerHtml;
  testStage().append(cv);
  return cv;
}

runTests(testsBody, [
  {
    name: 'ElementGL uploads live card via texElementSubImage2D() with 24 fps stepped weave and gl.getError() === 0',
    expect: 'pass',
    why: 'Mounts an isolated drawable card on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL, calls begin() before upload(), verifies identical pixels within frame 24 (t=1.005 vs 1.035) and shifted edge pixels in frame 30 (t=1.255).',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240;
      const H = 160;
      const cv = makeFixtureCanvas(
        W,
        H,
        `<div id="fx-weave" drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#100e0d;box-sizing:border-box">` +
        '<div style="position:absolute;left:72px;top:40px;width:44px;height:60px;background:#ffffff"></div></div>'
      );
      const card = cv.querySelector('#fx-weave');
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: GATE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        const tex = g.upload(card);

        const drawAt = (projTime) => {
          g.begin([0, 0, 0, 0]);
          g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1f(loc('uProjTime'), projTime);
            gl.uniform1f(loc('uCadence24'), 1.0);
            gl.uniform1f(loc('uWeaveAmount'), 1.8);
            gl.uniform1f(loc('uHalation'), 0.0);
            gl.uniform1f(loc('uSplice'), 0.0);
            gl.uniform1f(loc('uCueAlpha'), 0.0);
            gl.uniform1f(loc('uSlateFlash'), 0.0);
            gl.uniform2f(loc('uGatePad'), 10, 10);
            gl.uniform1f(loc('uReduced'), 0.0);
          });
        };

        const sampleRow = () => {
          const out = [];
          for (let x = 66; x <= 78; x += 2) {
            out.push(readCssPx(g.gl, cv, W, H, x, 70)[0]);
          }
          return out;
        };

        drawAt(1.005);
        const err1 = g.gl.getError();
        const rowA = sampleRow();

        drawAt(1.035);
        const rowB = sampleRow();

        drawAt(1.255);
        const err2 = g.gl.getError();
        const rowC = sampleRow();

        const sameWithinFrame = rowA.every((v, i) => v === rowB[i]);
        const shiftedAcrossFrames = rowA.some((v, i) => Math.abs(v - rowC[i]) > 25);
        return need(
          err1 === g.gl.NO_ERROR && err2 === g.gl.NO_ERROR && tex?.w > 0 && sameWithinFrame && shiftedAcrossFrames,
          `gl.getError()=${err1}/${err2}; tex=${tex?.w}x${tex?.h}; row@1.005=[${rowA}] === row@1.035=[${rowB}]; row@1.255=[${rowC}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Red-orange emulsion halation scatters warm halo around bright white DOM box',
    expect: 'pass',
    why: 'Renders a #ffffff DOM box on #100e0d dark surround at uHalation=0 vs uHalation=1.2 and samples 5 px outside the white box via gl.readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 200;
      const H = 140;
      const cv = makeFixtureCanvas(
        W,
        H,
        `<div id="fx-halo" drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#100e0d;display:flex;align-items:center;justify-content:center">` +
        '<div style="width:60px;height:40px;background:#ffffff"></div></div>'
      );
      const card = cv.querySelector('#fx-halo');
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: GATE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.upload(card);

        const drawHalo = (amount) => {
          g.begin([0, 0, 0, 0]);
          g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1f(loc('uProjTime'), 0.0);
            gl.uniform1f(loc('uCadence24'), 1.0);
            gl.uniform1f(loc('uWeaveAmount'), 0.0);
            gl.uniform1f(loc('uHalation'), amount);
            gl.uniform1f(loc('uSplice'), 0.0);
            gl.uniform1f(loc('uCueAlpha'), 0.0);
            gl.uniform1f(loc('uSlateFlash'), 0.0);
            gl.uniform2f(loc('uGatePad'), 8, 8);
            gl.uniform1f(loc('uReduced'), 1.0);
          });
        };

        // White box spans x=[70..130], y=[50..90]; sample 5 px outside left edge at (65, 70)
        drawHalo(0.0);
        const offPx = readCssPx(g.gl, cv, W, H, 65, 70);
        drawHalo(1.2);
        const onPx = readCssPx(g.gl, cv, W, H, 65, 70);

        const warmHalo = onPx[0] > offPx[0] + 35 && onPx[0] > onPx[1] + 25 && onPx[1] >= onPx[2] + 6;
        return need(
          warmHalo,
          `off rgb(${offPx[0]},${offPx[1]},${offPx[2]}) -> halation rgb(${onPx[0]},${onPx[1]},${onPx[2]}) at 5 px outside white box.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Reel changeover cue oval renders in top-right corner when triggered',
    expect: 'pass',
    why: 'Compares top-right cue pixels at uCueAlpha=0 vs uCueAlpha=1, verifying dark carbon center and bright amber-orange burn rim.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240;
      const H = 160;
      const cv = makeFixtureCanvas(
        W,
        H,
        `<div id="fx-cue" drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#161311"></div>`
      );
      const card = cv.querySelector('#fx-cue');
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: GATE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.upload(card);

        const drawCue = (alpha) => {
          g.begin([0, 0, 0, 0]);
          g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1f(loc('uProjTime'), 0.0);
            gl.uniform1f(loc('uCadence24'), 1.0);
            gl.uniform1f(loc('uWeaveAmount'), 0.0);
            gl.uniform1f(loc('uHalation'), 0.8);
            gl.uniform1f(loc('uSplice'), 0.0);
            gl.uniform1f(loc('uCueAlpha'), alpha);
            gl.uniform1f(loc('uSlateFlash'), 0.0);
            gl.uniform2f(loc('uGatePad'), 12, 12);
            gl.uniform1f(loc('uReduced'), 1.0);
          });
        };

        const cueX = W - 12 - 24;
        const cueY = 12 + 22;
        drawCue(0.0);
        const offRim = readCssPx(g.gl, cv, W, H, cueX + 9, cueY);
        drawCue(1.0);
        const onRim = readCssPx(g.gl, cv, W, H, cueX + 9, cueY);
        const onCore = readCssPx(g.gl, cv, W, H, cueX, cueY);

        return need(
          onRim[0] > offRim[0] + 80 && onRim[0] > onCore[0] + 80 && onCore[0] < 65,
          `offRim rgb(${offRim[0]},${offRim[1]},${offRim[2]}), onCore rgb(${onCore[0]},${onCore[1]},${onCore[2]}), onRim rgb(${onRim[0]},${onRim[1]},${onRim[2]}).`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'updateElementGeometry() + dataset.hitTick keeps live card button clickable under weave offset',
    expect: 'pass',
    why: 'Applies a shifted canvasTransform scaled by geometryUnit() plus dataset.hitTick toggle on a fixture card, then checks document.elementsFromPoint() and clicks the button.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240;
      const H = 160;
      const cv = makeFixtureCanvas(
        W,
        H,
        `<div id="fx-hit" drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#171412">` +
        '<button type="button" id="fx-btn" style="position:absolute;left:40px;top:40px;width:96px;height:40px">Mark slate</button></div>'
      );
      const card = cv.querySelector('#fx-hit');
      const btn = cv.querySelector('#fx-btn');
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: GATE_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        if (g) {
          g.upload(card);
          g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1f(loc('uReduced'), 1.0);
            gl.uniform2f(loc('uGatePad'), 8, 8);
          });
        } else {
          cv.getContext('2d').drawElementImage(card, 0, 0, W, H);
        }

        const unitCache = { key: '', unit: 1 };
        const lastGeoKeyRef = { value: '' };
        const lastTickPosRef = { x: 0, y: 0, a: 0 };
        syncCardGeometry({
          canvasEl: cv,
          cardEl: card,
          mode: g ? 'webgl' : '2d',
          cw: W,
          ch: H,
          dx: 18,
          dy: 12,
          angle: 0,
          unitCache,
          lastGeoKeyRef,
          lastTickPosRef,
          force: true,
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });

        const cr = cv.getBoundingClientRect();
        // Shifted button center: (40 + 18 + 48, 40 + 12 + 20) = (106, 72)
        const hitShifted = document.elementsFromPoint(cr.left + 106, cr.top + 72);
        // Unshifted top-left sliver (46, 46) is now outside the shifted button (starts at x=58, y=52)
        const hitOldCorner = document.elementsFromPoint(cr.left + 46, cr.top + 46);
        if (hitShifted.includes(btn)) btn.click();

        return need(
          hitShifted.includes(btn) && !hitOldCorner.includes(btn) && clicks === 1,
          `shiftedHit=${hitShifted.includes(btn)}, oldCornerHit=${hitOldCorner.includes(btn)}, clicks=${clicks}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'webglcontextlost moves card to plain HTML and webglcontextrestored recovers ElementGL',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated ElementGL fixture on testStage(), verifying plain-HTML fallback and clean WebGL restoration.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 200;
      const H = 140;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px;`;
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `width:${W}px;height:${H}px;background:#171412;color:#fff`;
      card.textContent = 'REEL 01';
      cv.append(card);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: GATE_FRAG,
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            plain.append(card);
          },
          onRestored: () => {
            restoredFired = true;
            plain.hidden = true;
            cv.append(card);
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.upload(card);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(card);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const texAfter = g.upload(card);
        g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.uniform1f(loc('uReduced'), 1.0);
          gl.uniform2f(loc('uGatePad'), 8, 8);
        });
        const err = g.gl.getError();

        return need(
          inPlainWhileLost && restoredFired && !g.lost && cv.contains(card) && texAfter?.w > 0 && err === g.gl.NO_ERROR,
          `defaultPrevented=${lostEv.defaultPrevented}, plainWhileLost=${inPlainWhileLost}, restored=${restoredFired}, err=${err}.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'gate-weave stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !viewTextures.has(reelCard)) return 0;
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
