import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const CHOREO_MODES = [
  { id: 0, key: 'blur', label: 'Blur-scale rise', short: 'Blur-scale' },
  { id: 1, key: 'origami', label: '3D origami unfold', short: 'Origami 3D' },
  { id: 2, key: 'elastic', label: 'Elastic wave', short: 'Elastic wave' },
  { id: 3, key: 'smear', label: 'Directional smear', short: 'Smear' },
];

export const CARD_DUR_MS = 280;
export const DEFAULT_STAGGER_MS = 200;
export const QUAD_PAD_PX = 36;

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const FILTER_PRESETS = {
  all: {
    label: 'All regions',
    rps: 48.2,
    lat: 14,
    err: 0.04,
    bars: [44, 58, 51, 70, 64, 82],
  },
  edge: {
    label: 'Edge POPs',
    rps: 31.6,
    lat: 9,
    err: 0.02,
    bars: [36, 48, 62, 55, 74, 78],
  },
  gpu: {
    label: 'GPU workers',
    rps: 16.6,
    lat: 21,
    err: 0.07,
    bars: [28, 42, 66, 79, 71, 88],
  },
};

const BAR_LABELS = ['T-50m', 'T-40m', 'T-30m', 'T-20m', 'T-10m', 'Now'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// #region stagger-timing
/**
 * Total choreography timeline duration in milliseconds for 4 staggered cards.
 */
export function totalDurationMs(staggerMs = DEFAULT_STAGGER_MS) {
  const gap = Math.max(0, Number(staggerMs) || 0);
  return Math.max(CARD_DUR_MS, 3 * gap + CARD_DUR_MS);
}

/**
 * Normalized [0..1] progress for section `index` at explicit timestamp `tMs`.
 */
export function sectionLocalProgress(index, tMs, staggerMs = DEFAULT_STAGGER_MS) {
  const startMs = Math.max(0, index) * Math.max(0, staggerMs);
  return clamp((tMs - startMs) / CARD_DUR_MS, 0, 1);
}

/**
 * Deterministic 240 Hz symplectic spring evaluator over an explicit `elapsedMs`
 * window. Overshoots 1.0 near mid-entry and tapers smoothly to exact 1.0 at settle.
 */
export function evaluateSpringAtMs(elapsedMs, durationMs = CARD_DUR_MS) {
  const t = clamp(elapsedMs, 0, durationMs);
  if (t <= 0) return { value: 0, velocity: 0, settled: false };
  if (t >= durationMs) return { value: 1, velocity: 0, settled: true };

  const subDt = 1 / 240;
  const target = 1;
  const stiffness = 620;
  const damping = 17.8;
  const totalSec = t / 1000;
  const steps = Math.max(1, Math.ceil(totalSec / subDt));
  const h = totalSec / steps;

  let x = 0;
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const accel = (target - x) * stiffness - v * damping;
    v += accel * h;
    x += v * h;
  }

  const u = t / durationMs;
  const settleBlend = smoothstep(0.84, 1.0, u);
  const value = x * (1 - settleBlend) + settleBlend;
  const velocity = v * (1 - settleBlend);
  return { value, velocity, settled: false };
}

/**
 * Compute per-section choreography parameters at explicit `tMs` for a mode.
 */
export function evaluateSectionAtMs(index, tMs, staggerMs = DEFAULT_STAGGER_MS, modeId = 0) {
  const local = sectionLocalProgress(index, tMs, staggerMs);
  const settled = local >= 0.999;

  if (local <= 0.0005) {
    return {
      index,
      local: 0,
      curve: 0,
      blurPx: modeId === 0 ? 18 : 0,
      offsetY: modeId === 1 ? 10 : modeId === 3 ? 36 : 30,
      scale: modeId === 0 ? 0.84 : modeId === 2 ? 0.78 : modeId === 3 ? 0.94 : 1,
      opacity: 0,
      velocity: 0,
      angleRad: modeId === 1 ? (78 * Math.PI) / 180 : 0,
      settled: false,
    };
  }

  if (modeId === 1) {
    const ease = 1 - Math.pow(1 - local, 2.2);
    const tiltFactor = Math.pow(1 - local, 1.45);
    return {
      index,
      local,
      curve: ease,
      blurPx: 0,
      offsetY: settled ? 0 : 12 * (1 - ease),
      scale: 1,
      opacity: settled ? 1 : smoothstep(0, 0.24, local),
      velocity: settled ? 0 : 2.2 * Math.pow(1 - local, 1.35),
      angleRad: settled ? 0 : tiltFactor * ((80 * Math.PI) / 180),
      settled,
    };
  }

  if (modeId === 2) {
    const sp = evaluateSpringAtMs(local * CARD_DUR_MS, CARD_DUR_MS);
    return {
      index,
      local,
      curve: settled ? 1 : sp.value,
      blurPx: 0,
      offsetY: settled ? 0 : (1 - sp.value) * 32,
      scale: settled ? 1 : 0.78 + 0.22 * sp.value,
      opacity: settled ? 1 : smoothstep(0, 0.22, local),
      velocity: settled ? 0 : Math.min(1.5, Math.abs(sp.velocity) / 6),
      angleRad: 0,
      settled,
    };
  }

  if (modeId === 3) {
    const ease = 1 - Math.pow(1 - local, 2.4);
    return {
      index,
      local,
      curve: ease,
      blurPx: 0,
      offsetY: settled ? 0 : 38 * (1 - ease),
      scale: settled ? 1 : 0.93 + 0.07 * ease,
      opacity: settled ? 1 : smoothstep(0, 0.24, local),
      velocity: settled ? 0 : Math.pow(1 - local, 1.35),
      angleRad: 0,
      settled,
    };
  }

  // Mode 0: Blur-scale rise
  const ease = 1 - Math.pow(1 - local, 2.5);
  return {
    index,
    local,
    curve: ease,
    blurPx: settled ? 0 : 18 * Math.pow(1 - local, 1.45),
    offsetY: settled ? 0 : 32 * (1 - ease),
    scale: settled ? 1 : 0.84 + 0.16 * ease,
    opacity: settled ? 1 : smoothstep(0, 0.36, local),
    velocity: settled ? 0 : 2.5 * Math.pow(1 - local, 1.5),
    angleRad: 0,
    settled,
  };
}

/**
 * Evaluate all 4 modules at normalized timeline progress [0..1].
 */
export function evaluateAllAtProgress(progress, staggerMs = DEFAULT_STAGGER_MS, modeId = 0) {
  const total = totalDurationMs(staggerMs);
  const tMs = clamp(progress, 0, 1) * total;
  return {
    tMs,
    totalMs: total,
    sections: [0, 1, 2, 3].map((i) => evaluateSectionAtMs(i, tMs, staggerMs, modeId)),
  };
}
// #endregion stagger-timing

// #region choreo-shader
export const CHOREO_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uMode;
uniform float uPad;
uniform float uLocal;
uniform float uCurve;
uniform float uBlurPx;
uniform float uOffsetY;
uniform float uScale;
uniform float uOpacity;
uniform float uVelocity;
uniform float uAngleRad;
uniform float uSeed;

in vec2 vUv;
out vec4 outColor;

vec4 sampleCard(vec2 uv, float lod) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec2 px = uv * uSize;
  float edge = clamp(min(px.x, uSize.x - px.x), 0.0, 1.0)
             * clamp(min(px.y, uSize.y - px.y), 0.0, 1.0);
  return textureLod(uTex, uv, lod) * edge;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 safeSize = max(uSize, vec2(1.0));
  vec2 quadSize = safeSize + vec2(uPad * 2.0);
  vec2 localPx = vUv * quadSize - vec2(uPad);
  vec2 cardUv = localPx / safeSize;

  if (uLocal <= 0.0005 || uOpacity <= 0.002) {
    discard;
  }

  // Exact 1:1 lock at settle
  if (uLocal >= 0.999 && abs(uCurve - 1.0) < 0.001 && uBlurPx < 0.05 && uVelocity < 0.005 && abs(uAngleRad) < 0.002) {
    if (cardUv.x < 0.0 || cardUv.x > 1.0 || cardUv.y < 0.0 || cardUv.y > 1.0) discard;
    outColor = texture(uTex, cardUv);
    return;
  }

  if (uMode == 1) {
    // 3D origami unfold around top edge hinge (y = 0)
    float liftY = uOffsetY;
    float sx = localPx.x - safeSize.x * 0.5;
    float sy = localPx.y - liftY;
    float D = max(460.0, safeSize.y * 3.4);
    float c = max(0.05, cos(uAngleRad));
    float s = sin(uAngleRad);

    // Cast hinge shadow underneath tilted paper flap
    float botY = liftY + (safeSize.y * c * D) / (D + safeSize.y * s);
    float horizMask = smoothstep(-10.0, 6.0, localPx.x)
                    * smoothstep(safeSize.x + 10.0, safeSize.x - 6.0, localPx.x);
    float vertMask = smoothstep(liftY - 4.0, liftY + 12.0, localPx.y)
                   * smoothstep(botY + 26.0, botY - 2.0, localPx.y);
    float shadowA = 0.56 * clamp(s * 1.15, 0.0, 1.0) * uOpacity * horizMask * vertMask;

    float denom = c * D - sy * s;
    vec4 cardCol = vec4(0.0);
    if (sy >= -1.0 && denom > 1.0) {
      float Y = (sy * D) / denom;
      float Z = Y * s;
      float X = sx * (D + Z) / D;
      vec2 origUv = vec2((X + safeSize.x * 0.5) / safeSize.x, Y / safeSize.y);
      vec2 edgePx = vec2(1.5) / safeSize;
      float mx = smoothstep(0.0, edgePx.x, origUv.x) * smoothstep(1.0, 1.0 - edgePx.x, origUv.x);
      float my = smoothstep(0.0, edgePx.y, origUv.y) * smoothstep(1.0, 1.0 - edgePx.y, origUv.y);
      float mask = mx * my;
      if (mask > 0.001) {
        vec4 texel = texture(uTex, clamp(origUv, 0.0, 1.0)) * mask;
        float faceShade = mix(0.38, 1.0, c);
        float hingeAO = mix(0.50 + 0.50 * smoothstep(0.0, 0.45, origUv.y), 1.0, c);
        texel.rgb *= faceShade * hingeAO;
        // Subtle specular crease highlight along the top fold
        texel.rgb += vec3(0.20, 0.28, 0.40) * exp(-origUv.y * 38.0) * s * texel.a;
        cardCol = texel * uOpacity;
      }
    }

    vec4 shadowCol = vec4(0.0, 0.0, 0.0, shadowA);
    outColor = cardCol + shadowCol * (1.0 - cardCol.a);
    return;
  }

  if (uMode == 2) {
    // Elastic wave with Poisson necking and per-row sinusoidal whip
    float overshoot = uCurve - 1.0;
    float waveAmp = uVelocity * 10.0 + max(0.0, overshoot) * 34.0 + max(0.0, 1.0 - uLocal) * 8.0;
    float ny = clamp(localPx.y / safeSize.y, 0.0, 1.0);
    float nx = (localPx.x / safeSize.x) - 0.5;
    float wave = sin(ny * 7.2 - uCurve * 7.5 + uSeed * 0.9);
    float sy = clamp(uScale, 0.35, 1.24);
    float sx = 1.0 + (1.0 - sy) * 0.38 + wave * (waveAmp / safeSize.x) * 0.52;
    float bowY = (0.5 - abs(nx)) * wave * waveAmp * 0.42;

    vec2 c = safeSize * 0.5;
    vec2 p = localPx - c - vec2(0.0, uOffsetY + bowY);
    p.x /= max(sx, 0.25);
    p.y /= max(sy, 0.25);
    p.x += wave * waveAmp * 0.30;
    vec2 uv = (p + c) / safeSize;

    vec4 col = sampleCard(uv, 0.0);
    float energy = clamp((1.0 - uLocal) * 0.5 + max(0.0, overshoot) * 2.2, 0.0, 1.0);
    col.rgb += vec3(0.06, 0.14, 0.22) * energy * abs(wave) * col.a;
    outColor = col * uOpacity;
    return;
  }

  if (uMode == 3) {
    // Directional velocity smear + RGB vertical chromatic fringe
    vec2 baseUv = (localPx - vec2(0.0, uOffsetY)) / safeSize;
    float smearPx = uVelocity * 34.0;
    float fringeUv = (uVelocity * 10.0) / safeSize.y;
    float jitter = hash12(gl_FragCoord.xy);
    float smearLod = clamp(uVelocity * 1.4, 0.0, 1.6);

    vec4 smearAcc = vec4(0.0);
    float wSum = 0.0;
    for (int i = 0; i < 20; i++) {
      float f = (float(i) + jitter) / 20.0;
      float w = exp(-2.2 * f);
      vec2 off = vec2(0.0, f * smearPx / safeSize.y);
      smearAcc += sampleCard(baseUv - off, smearLod * f) * w;
      wSum += w;
    }
    vec4 smeared = smearAcc / wSum;

    vec4 rSamp = sampleCard(baseUv + vec2(0.0, fringeUv), smearLod * 0.4);
    vec4 bSamp = sampleCard(baseUv - vec2(0.0, fringeUv), smearLod * 0.4);
    float mixAmt = clamp(uVelocity * 0.78, 0.0, 0.78);
    smeared.r = mix(smeared.r, rSamp.r, mixAmt);
    smeared.b = mix(smeared.b, bSamp.b, mixAmt);
    smeared.a = max(smeared.a, max(rSamp.a, bSamp.a) * 0.75 * uVelocity);
    smeared.rgb = min(smeared.rgb, vec3(smeared.a));
    outColor = smeared * uOpacity;
    return;
  }

  // Mode 0: Mipmapped Gaussian defocus blur + scale rise
  vec2 c = safeSize * 0.5;
  vec2 uv = ((localPx - c - vec2(0.0, uOffsetY)) / max(uScale, 0.2) + c) / safeSize;
  if (uBlurPx < 0.35) {
    outColor = sampleCard(uv, 0.0) * uOpacity;
    return;
  }

  float blurLod = clamp(log2(max(1.0, uBlurPx * 0.55)), 0.0, 3.2);
  float rot = hash12(gl_FragCoord.xy) * 6.2831853 + uSeed * 0.6;
  vec4 acc = sampleCard(uv, blurLod * 0.6) * 1.1;
  float wSum = 1.1;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float angle = fi * 2.3999632 + rot;
    float ring = sqrt((fi + 0.5) / 24.0);
    float r = ring * uBlurPx;
    float w = exp(-1.5 * ring * ring);
    vec2 off = vec2(cos(angle), sin(angle)) * (r / safeSize);
    acc += sampleCard(uv + off, blurLod) * w;
    wSum += w;
  }
  vec4 blurred = acc / wSum;
  blurred.rgb += vec3(0.05, 0.09, 0.14) * clamp(uBlurPx / 18.0, 0.0, 1.0) * blurred.a;
  outColor = blurred * uOpacity;
}`;
// #endregion choreo-shader

/**
 * Compute responsive settled card boxes for all 4 modules inside `(cw, ch)`.
 */
export function computeLayout(cw, ch) {
  const safeW = Math.max(240, cw);
  const safeH = Math.max(320, ch);
  const narrow = safeW < 600;

  if (narrow) {
    const pad = 10;
    const gap = 8;
    const w = safeW - pad * 2;
    const headerH = 102;
    const kpiH = 110;
    const actionsH = 100;
    const chartH = Math.max(120, safeH - pad * 2 - gap * 3 - headerH - kpiH - actionsH);
    const y0 = pad;
    const y1 = y0 + headerH + gap;
    const y2 = y1 + kpiH + gap;
    const y3 = y2 + chartH + gap;
    return [
      { id: 'ec-header', x: pad, y: y0, w, h: headerH },
      { id: 'ec-kpi', x: pad, y: y1, w, h: kpiH },
      { id: 'ec-chart', x: pad, y: y2, w, h: chartH },
      { id: 'ec-actions', x: pad, y: y3, w, h: actionsH },
    ];
  }

  const pad = 14;
  const gap = 12;
  const fullW = safeW - pad * 2;
  const headerH = 86;
  const actionsH = 104;
  const midH = Math.max(160, safeH - pad * 2 - gap * 2 - headerH - actionsH);
  const kpiW = Math.round((fullW - gap) * 0.44);
  const chartW = fullW - gap - kpiW;
  const y0 = pad;
  const y1 = y0 + headerH + gap;
  const y2 = y1 + midH + gap;

  return [
    { id: 'ec-header', x: pad, y: y0, w: fullW, h: headerH },
    { id: 'ec-kpi', x: pad, y: y1, w: kpiW, h: midH },
    { id: 'ec-chart', x: pad + kpiW + gap, y: y1, w: chartW, h: midH },
    { id: 'ec-actions', x: pad, y: y2, w: fullW, h: actionsH },
  ];
}

// DOM references
const stageBox = document.getElementById('ec-stage');
const viewportEl = document.getElementById('ec-viewport');
let canvas = document.getElementById('ec-canvas');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('ec-notice');
const statusEl = document.getElementById('ec-status');
const testsBody = document.getElementById('tests');

const headerEl = document.getElementById('ec-header');
const kpiEl = document.getElementById('ec-kpi');
const chartEl = document.getElementById('ec-chart');
const actionsEl = document.getElementById('ec-actions');
const moduleEls = [headerEl, kpiEl, chartEl, actionsEl];

const titleInput = document.getElementById('ec-title-input');
const filterPills = [...document.querySelectorAll('.ec-pill')];
const kpiIncBtn = document.getElementById('ec-kpi-inc');
const kpiRpsOut = document.getElementById('ec-kpi-rps');
const kpiLatOut = document.getElementById('ec-kpi-lat');
const kpiErrOut = document.getElementById('ec-kpi-err');
const chartFocusOut = document.getElementById('ec-chart-focus');
const barBtns = [...document.querySelectorAll('.ec-bar-btn')];
const actLogOut = document.getElementById('ec-act-log');
const actIncBtn = document.getElementById('ec-act-inc');
const actResetBtn = document.getElementById('ec-act-reset');

// External controls
const modeTabs = [...document.querySelectorAll('.ec-tab')];
const entryBtn = document.getElementById('btn-entry');
const exitBtn = document.getElementById('btn-exit');
const replayBtn = document.getElementById('btn-replay');
const scrubSlider = document.getElementById('scrub-slider');
const scrubOut = document.getElementById('scrub-out');
const staggerSlider = document.getElementById('stagger-slider');
const staggerOut = document.getElementById('stagger-out');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  choreoMode: 0,
  progress: 1,
  lastDirection: 'entry', // 'entry' | 'exit'
  staggerMs: Number(staggerSlider.value) || DEFAULT_STAGGER_MS,
  reducedOverride: reducedToggle.checked,
  onScreen: true,
  hasPainted: false,
  animating: false,
  animTarget: 1,
  animStartProgress: 0,
  animStartTime: 0,
  animDuration: 880,
  rafId: 0,
  uploads: 0,
  paints: 0,
  filterKey: 'all',
  rpsDelta: 0,
  spikes: 0,
  selectedBar: 5,
  unitCache: { key: '', unit: 1 },
  lastGeoKeys: ['', '', '', ''],
  layout: computeLayout(800, 472),
};

let stage = null;
let ctx2d = null;
const moduleTextures = new Map();
const dirtyModules = new Set(moduleEls);

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 352);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 472);
  return { cw, ch };
}

function syncCardSizes(layout) {
  if (state.mode === 'plain') {
    for (const el of moduleEls) {
      if (el.style.width) el.style.width = '';
      if (el.style.height) el.style.height = '';
    }
    return;
  }
  for (let i = 0; i < moduleEls.length; i++) {
    const el = moduleEls[i];
    const slot = layout[i];
    const w = `${slot.w}px`;
    const h = `${slot.h}px`;
    if (el.style.width !== w) el.style.width = w;
    if (el.style.height !== h) el.style.height = h;
  }
}

function updateDashboardDOM() {
  const preset = FILTER_PRESETS[state.filterKey] ?? FILTER_PRESETS.all;
  const rps = preset.rps + state.rpsDelta + state.spikes * 1.4;
  const lat = Math.max(4, preset.lat + Math.round(state.spikes * 1.5 - state.rpsDelta * 0.1));
  const err = Math.max(0.01, preset.err + state.spikes * 0.01);

  for (const pill of filterPills) {
    pill.setAttribute('aria-pressed', String(pill.dataset.filter === state.filterKey));
  }

  kpiRpsOut.textContent = `${rps.toFixed(1)}k/s`;
  kpiLatOut.textContent = `${lat} ms`;
  kpiErrOut.textContent = `${err.toFixed(2)}%`;

  const bars = preset.bars.map((v, idx) => {
    const extra = idx === 5 ? Math.round(state.rpsDelta * 2 + state.spikes * 6) : Math.round(state.rpsDelta * 0.8);
    return clamp(v + extra, 8, 100);
  });

  barBtns.forEach((btn, idx) => {
    const active = idx === state.selectedBar;
    btn.setAttribute('aria-pressed', String(active));
    const fill = btn.querySelector('.ec-bar-fill');
    if (fill) fill.style.height = `${bars[idx]}%`;
  });

  const selVal = bars[state.selectedBar] ?? bars[5];
  const selLbl = BAR_LABELS[state.selectedBar] ?? 'Now';
  chartFocusOut.textContent = `${selLbl} · ${selVal}%`;

  const spikeWord = state.spikes === 1 ? 'manual spike' : 'manual spikes';
  actLogOut.textContent = `${state.spikes} ${spikeWord} · ${preset.label}`;
}

function updateControlsUI() {
  for (const tab of modeTabs) {
    tab.setAttribute('aria-pressed', String(Number(tab.dataset.mode) === state.choreoMode));
  }
  const pct = Math.round(state.progress * 100);
  scrubSlider.value = String(pct);
  scrubOut.textContent = `${pct}%`;
  staggerSlider.value = String(Math.round(state.staggerMs));
  staggerOut.textContent = `${Math.round(state.staggerMs)} ms`;
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const modeLabel = CHOREO_MODES[state.choreoMode]?.short ?? 'Blur-scale';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const pct = Math.round(state.progress * 100);
  const phase = pct >= 100 ? 'Settled' : pct <= 0 ? 'Departed' : `${pct}%`;
  statusEl.textContent =
    `${routeLabel} · ${modeLabel} (${phase}) · ${canvas.width}x${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

// #region geometry-sync
function cachedUnit(targetCanvas, refEl, refW) {
  const zoom = refEl.currentCSSZoom || 1;
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${Math.round(refW)}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(targetCanvas, refEl, refW);
    state.unitCache.key = key;
    state.lastGeoKeys.fill('');
  }
  return state.unitCache.unit;
}

/**
 * Synchronise hit boxes for all 4 modules via updateElementGeometry() scaled by
 * geometryUnit(), setting inert on hidden pre-entry cards and toggling data-hit-tick.
 */
export function syncChoreoGeometry(force = false, evalState = null) {
  if (state.mode !== 'webgl' || typeof canvas.updateElementGeometry !== 'function') return;
  if (canvas.width <= 0 || canvas.height <= 0) return;

  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);

  const refSlot = state.layout[0];
  const u = cachedUnit(canvas, headerEl, refSlot.w);
  const timeline = evalState ?? evaluateAllAtProgress(state.progress, state.staggerMs, state.choreoMode);

  for (let i = 0; i < moduleEls.length; i++) {
    const el = moduleEls[i];
    const slot = state.layout[i];
    const m = timeline.sections[i];
    const hidden = m.opacity < 0.15;

    if (el.inert !== hidden) el.inert = hidden;

    let mat;
    let key;
    if (hidden) {
      key = `${canvas.width}x${canvas.height}|off`;
      mat = new DOMMatrix().scale(u, u).multiply(OFFSTAGE);
    } else if (m.settled) {
      key = `${canvas.width}x${canvas.height}|${slot.x},${slot.y},${slot.w},${slot.h}|settled`;
      mat = new DOMMatrix().scale(u, u).translate(slot.x, slot.y);
    } else {
      const qy = Math.round((slot.y + m.offsetY) * 2) / 2;
      const qs = Math.round(m.scale * 100) / 100;
      const cx = slot.w * 0.5;
      const cy = slot.h * 0.5;
      key = `${canvas.width}x${canvas.height}|${slot.x},${qy},${qs}`;
      mat = new DOMMatrix()
        .scale(u, u)
        .translate(slot.x, slot.y + m.offsetY)
        .translate(cx, cy)
        .scale(m.scale, m.scale)
        .translate(-cx, -cy);
    }

    if (!force && key === state.lastGeoKeys[i]) continue;
    state.lastGeoKeys[i] = key;
    try {
      canvas.updateElementGeometry(el, { canvasTransform: mat });
    } catch {}
    el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion geometry-sync

function uploadWithMip(stageObj, el) {
  const gl = stageObj.gl;
  gl.activeTexture(gl.TEXTURE0);
  const tex = stageObj.upload(el);
  if (tex) {
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  return tex;
}

function tryUploadModule(el) {
  if (!stage || stage.lost || !state.hasPainted) return null;
  try {
    const tex = uploadWithMip(stage, el);
    if (tex) {
      moduleTextures.set(el, tex);
      dirtyModules.delete(el);
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      dirtyModules.add(el);
      canvas.requestPaint?.();
      return moduleTextures.get(el) ?? null;
    }
    throw err;
  }
}

function renderWebGL(allowUpload = false, changedSet = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);

  // Size backing store via stage.begin() BEFORE querying/uploading module textures
  if (!stage.begin([0, 0, 0, 0])) return;

  if (allowUpload) {
    for (const el of moduleEls) {
      const needs = !moduleTextures.has(el) || dirtyModules.has(el) || !changedSet || changedSet.has(el);
      if (needs) tryUploadModule(el);
    }
  }

  const timeline = evaluateAllAtProgress(state.progress, state.staggerMs, state.choreoMode);
  syncChoreoGeometry(false, timeline);

  for (let i = 0; i < moduleEls.length; i++) {
    const el = moduleEls[i];
    if (!moduleTextures.has(el)) continue;
    const slot = state.layout[i];
    const m = timeline.sections[i];
    if (m.opacity <= 0.002 || m.local <= 0.0005) continue;

    const quadMat = ElementGL.rect(
      canvas,
      slot.x - QUAD_PAD_PX,
      slot.y - QUAD_PAD_PX,
      slot.w + QUAD_PAD_PX * 2,
      slot.h + QUAD_PAD_PX * 2
    );

    stage.quad(el, quadMat, (gl, loc) => {
      gl.uniform1i(loc('uMode'), state.choreoMode);
      gl.uniform1f(loc('uPad'), QUAD_PAD_PX);
      gl.uniform1f(loc('uLocal'), m.local);
      gl.uniform1f(loc('uCurve'), m.curve);
      gl.uniform1f(loc('uBlurPx'), m.blurPx);
      gl.uniform1f(loc('uOffsetY'), m.offsetY);
      gl.uniform1f(loc('uScale'), m.scale);
      gl.uniform1f(loc('uOpacity'), m.opacity);
      gl.uniform1f(loc('uVelocity'), m.velocity);
      gl.uniform1f(loc('uAngleRad'), m.angleRad);
      gl.uniform1f(loc('uSeed'), i + 1);
    });
  }

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const timeline = evaluateAllAtProgress(state.progress, state.staggerMs, state.choreoMode);
  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);

  for (let i = 0; i < moduleEls.length; i++) {
    const el = moduleEls[i];
    const slot = state.layout[i];
    const m = timeline.sections[i];
    const hidden = m.opacity <= 0.02 || m.local <= 0.001;
    if (el.inert !== hidden) el.inert = hidden;
    if (hidden) continue;

    ctx2d.save();
    ctx2d.globalAlpha = m.opacity;
    if (m.blurPx > 0.4) {
      ctx2d.filter = `blur(${Math.min(14, m.blurPx).toFixed(1)}px)`;
    } else if (state.choreoMode === 3 && m.velocity > 0.05) {
      ctx2d.filter = `blur(${Math.min(8, m.velocity * 6).toFixed(1)}px)`;
    }
    const sx = m.scale;
    const sy = state.choreoMode === 1 ? Math.max(0.18, Math.cos(m.angleRad)) : m.scale;
    ctx2d.translate(slot.x + slot.w * 0.5, slot.y + m.offsetY + (state.choreoMode === 1 ? 0 : slot.h * 0.5));
    ctx2d.scale(sx, sy);
    ctx2d.translate(-slot.w * 0.5, state.choreoMode === 1 ? 0 : -slot.h * 0.5);
    try {
      ctx2d.drawElementImage(el, 0, 0, slot.w, slot.h);
      state.uploads++;
    } catch {}
    ctx2d.restore();
  }

  ctx2d.restore();
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  stopLoop();
  state.animating = false;
  state.progress = 1;
  stageBox.classList.add('is-plain');
  for (const el of moduleEls) {
    el.inert = false;
    if (el.parentElement !== plainHost) {
      if (typeof plainHost.moveBefore === 'function' && el.isConnected) {
        try { plainHost.moveBefore(el, null); } catch { plainHost.append(el); }
      } else {
        plainHost.append(el);
      }
    }
  }
  syncCardSizes(state.layout);
  showNotice(reason);
  updateControlsUI();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const el of moduleEls) {
    if (el.parentElement !== canvas) {
      if (typeof canvas.moveBefore === 'function' && el.isConnected) {
        try { canvas.moveBefore(el, null); } catch { canvas.append(el); }
      } else {
        canvas.append(el);
      }
    }
  }
  showNotice('');
}
// #endregion fallback-2d

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function drawCurrentFrame(forcePaint = false) {
  if (state.mode === 'plain') {
    enterPlainFallback(noticeEl.textContent || '');
    return;
  }
  if (!forcePaint && state.mode === 'webgl' && stage && !stage.lost && state.hasPainted && moduleTextures.size === moduleEls.length) {
    renderWebGL(false);
    return;
  }
  canvas.requestPaint?.();
}

function stepChoreo(now) {
  state.rafId = 0;
  if (!state.animating || !state.onScreen || document.hidden || state.mode === 'plain') return;

  const elapsed = Math.max(0, now - state.animStartTime);
  const raw = Math.min(1, elapsed / Math.max(1, state.animDuration));
  state.progress = state.animStartProgress + (state.animTarget - state.animStartProgress) * raw;
  updateControlsUI();
  drawCurrentFrame(false);

  if (raw < 1) {
    state.rafId = requestAnimationFrame(stepChoreo);
  } else {
    state.progress = state.animTarget;
    state.animating = false;
    updateControlsUI();
    drawCurrentFrame(false);
  }
}

function startChoreography(direction, resetStart = false) {
  stopLoop();
  state.lastDirection = direction;
  const target = direction === 'exit' ? 0 : 1;

  if (isReducedMotion() || state.mode === 'plain') {
    state.animating = false;
    state.progress = target;
    updateControlsUI();
    drawCurrentFrame(false);
    return;
  }

  let startP = state.progress;
  if (resetStart) {
    startP = direction === 'exit' ? 1 : 0;
  } else if (direction === 'entry' && state.progress >= 0.99) {
    startP = 0;
  } else if (direction === 'exit' && state.progress <= 0.01) {
    startP = 1;
  }

  const baseDuration = totalDurationMs(state.staggerMs) * (direction === 'exit' ? 0.85 : 1);
  const span = Math.max(0.15, Math.abs(target - startP));
  state.progress = startP;
  state.animStartProgress = startP;
  state.animTarget = target;
  state.animDuration = Math.max(180, baseDuration * span);
  state.animStartTime = performance.now();
  state.animating = true;

  updateControlsUI();
  drawCurrentFrame(false);
  if (state.onScreen && !document.hidden) {
    state.rafId = requestAnimationFrame(stepChoreo);
  }
}

function markAllDirtyAndPaint() {
  for (const el of moduleEls) dirtyModules.add(el);
  drawCurrentFrame(true);
}

// Keep native text selection blocked on stage except inside editable inputs
viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

// Live interactive controls inside the 4 drawable dashboard modules
titleInput.addEventListener('input', () => {
  dirtyModules.add(headerEl);
  drawCurrentFrame(true);
});

for (const pill of filterPills) {
  pill.addEventListener('click', () => {
    state.filterKey = pill.dataset.filter || 'all';
    updateDashboardDOM();
    dirtyModules.add(headerEl);
    dirtyModules.add(kpiEl);
    dirtyModules.add(chartEl);
    dirtyModules.add(actionsEl);
    drawCurrentFrame(true);
  });
}

kpiIncBtn.addEventListener('click', () => {
  state.rpsDelta = Math.round((state.rpsDelta + 1) * 10) / 10;
  updateDashboardDOM();
  dirtyModules.add(kpiEl);
  dirtyModules.add(chartEl);
  drawCurrentFrame(true);
});

for (const btn of barBtns) {
  btn.addEventListener('click', () => {
    state.selectedBar = Number(btn.dataset.bar) || 0;
    updateDashboardDOM();
    dirtyModules.add(chartEl);
    drawCurrentFrame(true);
  });
}

actIncBtn.addEventListener('click', () => {
  state.spikes++;
  updateDashboardDOM();
  dirtyModules.add(kpiEl);
  dirtyModules.add(chartEl);
  dirtyModules.add(actionsEl);
  drawCurrentFrame(true);
});

actResetBtn.addEventListener('click', () => {
  state.rpsDelta = 0;
  state.spikes = 0;
  state.selectedBar = 5;
  updateDashboardDOM();
  markAllDirtyAndPaint();
});

// External stage controls
for (const tab of modeTabs) {
  tab.addEventListener('click', () => {
    state.choreoMode = Number(tab.dataset.mode) || 0;
    updateControlsUI();
    startChoreography('entry', true);
  });
}

entryBtn.addEventListener('click', () => startChoreography('entry', false));
exitBtn.addEventListener('click', () => startChoreography('exit', false));
replayBtn.addEventListener('click', () => startChoreography(state.lastDirection, true));

scrubSlider.addEventListener('input', () => {
  stopLoop();
  state.animating = false;
  state.progress = Number(scrubSlider.value) / 100;
  updateControlsUI();
  drawCurrentFrame(false);
});

staggerSlider.addEventListener('input', () => {
  state.staggerMs = Number(staggerSlider.value);
  updateControlsUI();
  drawCurrentFrame(false);
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion() && state.animating) {
    stopLoop();
    state.animating = false;
    state.progress = state.animTarget;
    updateControlsUI();
  }
  drawCurrentFrame(false);
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion() && state.animating) {
    stopLoop();
    state.animating = false;
    state.progress = state.animTarget;
    updateControlsUI();
  }
  drawCurrentFrame(false);
});

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    let changed = null;
    if (e?.changedElements?.length) {
      changed = new Set();
      for (const node of e.changedElements) {
        for (const mod of moduleEls) {
          if (mod === node || mod.contains(node)) {
            changed.add(mod);
            dirtyModules.add(mod);
          }
        }
      }
    }
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(true, changed);
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  });

  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing all four dashboard modules as plain HTML.');
    }
  });

  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      const { cw, ch } = getViewportSize();
      state.layout = computeLayout(cw, ch);
      syncCardSizes(state.layout);
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: CHOREO_FRAG,
        onLost: () => {
          moduleTextures.clear();
          for (const el of moduleEls) dirtyModules.add(el);
          enterPlainFallback('The WebGL 2 context was lost. Showing all four dashboard modules as plain HTML until restored.');
        },
        onRestored: () => {
          moduleTextures.clear();
          for (const el of moduleEls) dirtyModules.add(el);
          stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          state.unitCache.key = '';
          state.lastGeoKeys.fill('');
          exitPlainFallback();
          const s = getViewportSize();
          state.layout = computeLayout(s.cw, s.ch);
          syncCardSizes(state.layout);
          syncChoreoGeometry(true);
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
      fresh.id = 'ec-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(...moduleEls);
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

  enterPlainFallback('HTML-in-canvas is not available in this browser, so all four dashboard modules are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) {
      stopLoop();
    } else if (state.mode !== 'plain') {
      if (state.animating && !state.rafId && !document.hidden) {
        state.rafId = requestAnimationFrame(stepChoreo);
      } else {
        drawCurrentFrame(false);
      }
    }
  }, { threshold: 0.01 }).observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.mode !== 'plain') {
    if (state.animating && !state.rafId) {
      state.rafId = requestAnimationFrame(stepChoreo);
    } else {
      drawCurrentFrame(false);
    }
  }
});

if (typeof ResizeObserver !== 'undefined') {
  let lastBoxKey = '';
  new ResizeObserver(() => {
    if (state.mode !== 'plain') {
      const { cw, ch } = getViewportSize();
      const boxKey = `${cw}x${ch}`;
      if (boxKey === lastBoxKey && state.hasPainted) return;
      lastBoxKey = boxKey;
      state.unitCache.key = '';
      state.lastGeoKeys.fill('');
      state.layout = computeLayout(cw, ch);
      syncCardSizes(state.layout);
      syncChoreoGeometry(true);
      if (state.hasPainted) drawCurrentFrame(true);
      else canvas.requestPaint?.();
    }
  }).observe(viewportEl);
}

updateDashboardDOM();
updateControlsUI();
initBackend();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function settleGfx(baseActive, extraMs = 0) {
  if (extraMs > 0) {
    await new Promise((r) => setTimeout(r, extraMs));
  }
  if (!window.__gfx?.active) return;
  const deadline = performance.now() + 800;
  while (window.__gfx.active() > baseActive && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeSolidModule(w, h, bg, label, buttonLabel = '') {
  const el = document.createElement('section');
  el.setAttribute('drawable', '');
  el.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;background:${bg};color:#fff;padding:8px;display:flex;align-items:center;justify-content:space-between;font:600 12px system-ui;`;
  const span = document.createElement('span');
  span.textContent = label;
  el.append(span);
  if (buttonLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = buttonLabel;
    btn.style.cssText = 'min-width:64px;min-height:28px;border:1px solid #fff;background:#0f172a;color:#fff;font:600 11px system-ui;';
    el.append(btn);
  }
  return el;
}

function drawFixtureSlots(g, cv, slots, states, pad = QUAD_PAD_PX) {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const m = states[i];
    if (m.opacity <= 0.002 || m.local <= 0.0005) continue;
    const mat = ElementGL.rect(cv, s.x - pad, s.y - pad, s.w + pad * 2, s.h + pad * 2);
    g.quad(s.el, mat, (gl, loc) => {
      gl.uniform1i(loc('uMode'), s.mode ?? 0);
      gl.uniform1f(loc('uPad'), pad);
      gl.uniform1f(loc('uLocal'), m.local);
      gl.uniform1f(loc('uCurve'), m.curve);
      gl.uniform1f(loc('uBlurPx'), m.blurPx);
      gl.uniform1f(loc('uOffsetY'), m.offsetY);
      gl.uniform1f(loc('uScale'), m.scale);
      gl.uniform1f(loc('uOpacity'), m.opacity);
      gl.uniform1f(loc('uVelocity'), m.velocity);
      gl.uniform1f(loc('uAngleRad'), m.angleRad);
      gl.uniform1f(loc('uSeed'), i + 1);
    });
  }
}

runTests(testsBody, [
  {
    name: 'All 4 dashboard module textures upload cleanly via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Creates an isolated ElementGL canvas with 4 distinct drawable modules, waits for paint, calls begin() before upload(), draws all 4 settled quads and verifies texture sizes, readPixels() colours and gl.getError() === 0.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240, H = 180;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const specs = [
        { x: 8, y: 8, w: 106, h: 78, bg: '#ef4444', label: 'Header' },
        { x: 126, y: 8, w: 106, h: 78, bg: '#22c55e', label: 'KPI' },
        { x: 8, y: 94, w: 106, h: 78, bg: '#2563eb', label: 'Chart' },
        { x: 126, y: 94, w: 106, h: 78, bg: '#eab308', label: 'Actions' },
      ];
      const slots = specs.map((s) => ({ ...s, el: makeSolidModule(s.w, s.h, s.bg, s.label), mode: 0 }));
      cv.append(...slots.map((s) => s.el));
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CHOREO_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const textures = slots.map((s) => uploadWithMip(g, s.el));
        const settled = [0, 1, 2, 3].map((i) => evaluateSectionAtMs(i, 1000, 200, 0));
        drawFixtureSlots(g, cv, slots, settled);

        const err = g.gl.getError();
        const p0 = readCssPixel(g.gl, cv, W, H, 60, 45);
        const p1 = readCssPixel(g.gl, cv, W, H, 180, 45);
        const p2 = readCssPixel(g.gl, cv, W, H, 60, 130);
        const p3 = readCssPixel(g.gl, cv, W, H, 180, 130);

        const texOk = textures.every((t) => t && t.w > 0 && t.h > 0);
        const colorsOk = p0[0] > 180 && p0[1] < 90
          && p1[1] > 160 && p1[0] < 90
          && p2[2] > 180 && p2[0] < 90
          && p3[0] > 180 && p3[1] > 150 && p3[2] < 80;

        return need(
          err === g.gl.NO_ERROR && texOk && colorsOk,
          `gl.getError()=${err}, tex=[${textures.map((t) => `${t?.w}x${t?.h}`).join(', ')}], rgb=[${p0.slice(0, 3)}|${p1.slice(0, 3)}|${p2.slice(0, 3)}|${p3.slice(0, 3)}].`
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
    name: 'Stagger ordering at Progress 35% settles #ec-header while #ec-actions stays unrevealed/blurred',
    expect: 'pass',
    why: 'Verifies explicit tMs stagger timing (plus Elastic wave spring overshoot and settle), then renders 4 modules at 35% on an ElementGL fixture and checks header vs actions pixels.',
    timeout: 6000,
    run: async () => {
      const t35 = 0.35 * totalDurationMs(200);
      const header35 = evaluateSectionAtMs(0, t35, 200, 0);
      const kpi35 = evaluateSectionAtMs(1, t35, 200, 0);
      const actions35 = evaluateSectionAtMs(3, t35, 200, 0);
      const springMid = evaluateSectionAtMs(0, 130, 200, 2);
      const springEnd = evaluateSectionAtMs(0, 280, 200, 2);

      const mathOk = header35.settled && header35.blurPx === 0 && header35.offsetY === 0 && header35.opacity === 1
        && kpi35.local > 0.2 && kpi35.local < 0.6
        && !actions35.settled && actions35.local === 0 && actions35.blurPx >= 17 && actions35.offsetY >= 29 && actions35.opacity === 0
        && springMid.curve > 1.05
        && springEnd.settled && springEnd.curve === 1 && springEnd.offsetY === 0;

      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240, H = 180;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const slots = [
        { x: 10, y: 10, w: 220, h: 36, el: makeSolidModule(220, 36, '#38bdf8', 'Header'), mode: 0 },
        { x: 10, y: 54, w: 220, h: 36, el: makeSolidModule(220, 36, '#22c55e', 'KPI'), mode: 0 },
        { x: 10, y: 98, w: 220, h: 36, el: makeSolidModule(220, 36, '#a855f7', 'Chart'), mode: 0 },
        { x: 10, y: 138, w: 220, h: 34, el: makeSolidModule(220, 34, '#f97316', 'Actions'), mode: 0 },
      ];
      cv.append(...slots.map((s) => s.el));
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CHOREO_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        for (const s of slots) {
          uploadWithMip(g, s.el);
        }
        const eval35 = evaluateAllAtProgress(0.35, 200, 0);
        drawFixtureSlots(g, cv, slots, eval35.sections);

        const err = g.gl.getError();
        const pxHead = readCssPixel(g.gl, cv, W, H, 120, 28);
        const pxAct = readCssPixel(g.gl, cv, W, H, 120, 155);

        return need(
          mathOk && err === g.gl.NO_ERROR && pxHead[3] > 230 && pxHead[2] > 180 && pxAct[3] === 0,
          `t35=${t35.toFixed(0)}ms, springMid=${springMid.curve.toFixed(2)}, headerA=${pxHead[3]}, actionsA=${pxAct[3]}.`
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
    name: 'All 4 choreography modes render distinct mid-entry GPU signatures without quad clipping',
    expect: 'pass',
    why: 'Renders a striped high-contrast card mid-entry across Blur-scale, 3D origami, Elastic wave and Directional smear inside a 36 px padded quad, verifying distinct pixel grids, non-clipped bleed, hinge shadow and RGB fringe.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 220, H = 180;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = 'position:absolute;left:0;top:0;width:136px;height:96px;box-sizing:border-box;background:#0f172a;border:3px solid #f8fafc;display:flex;flex-direction:column;justify-content:space-evenly;padding:8px';
      for (const c of ['#f8fafc', '#38bdf8', '#fbbf24']) {
        const bar = document.createElement('div');
        bar.style.cssText = `height:12px;background:${c};border-radius:3px`;
        card.append(bar);
      }
      cv.append(card);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CHOREO_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        uploadWithMip(g, card);

        const grids = [];
        let bleedBlur = false;
        let origamiShadow = false;
        let smearFringe = false;

        for (let mode = 0; mode < 4; mode++) {
          const m = evaluateSectionAtMs(0, 0.45 * CARD_DUR_MS, 200, mode);
          g.begin([0, 0, 0, 0]);
          drawFixtureSlots(g, cv, [{ x: 42, y: 42, w: 136, h: 96, el: card, mode }], [m]);
          if (g.gl.getError() !== g.gl.NO_ERROR) throw new Error(`gl error in mode ${mode}`);

          const grid = [];
          for (let gx = 48; gx <= 172; gx += 16) {
            for (let gy = 48; gy <= 148; gy += 16) {
              const p = readCssPixel(g.gl, cv, W, H, gx, gy);
              grid.push(p[0], p[1], p[2], p[3]);
            }
          }
          grids.push(grid);

          if (mode === 0) {
            // Check Gaussian blur halo bleeding cleanly past the card's bottom edge
            let maxBleedA = 0;
            for (let by = 140; by <= 152; by += 2) {
              const pBleed = readCssPixel(g.gl, cv, W, H, 110, by);
              maxBleedA = Math.max(maxBleedA, pBleed[3]);
            }
            bleedBlur = maxBleedA > 4;
          } else if (mode === 1) {
            // Origami perspective casts dark hinge shadow (low RGB, positive alpha) below folded edge
            let maxShadowA = 0;
            for (let sy = 104; sy <= 148; sy += 4) {
              const p = readCssPixel(g.gl, cv, W, H, 110, sy);
              if (p[3] > 20 && p[0] < 30 && p[1] < 30 && p[2] < 30) {
                maxShadowA = Math.max(maxShadowA, p[3]);
              }
            }
            origamiShadow = maxShadowA > 20;
          } else if (mode === 3) {
            // Directional smear creates vertical RGB chromatic fringe difference around bright bars
            let maxRB = 0;
            for (let sy = 40; sy <= 156; sy += 2) {
              const p = readCssPixel(g.gl, cv, W, H, 110, sy);
              maxRB = Math.max(maxRB, Math.abs(p[0] - p[2]));
            }
            smearFringe = maxRB >= 14;
          }
        }

        let minPairDiff = Infinity;
        for (let a = 0; a < 4; a++) {
          for (let b = a + 1; b < 4; b++) {
            let sum = 0;
            for (let k = 0; k < grids[a].length; k++) sum += Math.abs(grids[a][k] - grids[b][k]);
            minPairDiff = Math.min(minPairDiff, sum / grids[a].length);
          }
        }

        return need(
          minPairDiff > 4 && bleedBlur && origamiShadow && smearFringe,
          `minModeDiff=${minPairDiff.toFixed(1)}, blurBleed=${bleedBlur}, origamiShadow=${origamiShadow}, smearFringe=${smearFringe}.`
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
    name: 'updateElementGeometry() at Progress 100% hits buttons across all 4 settled cards via elementsFromPoint()',
    expect: 'pass',
    why: 'Synchronises 4 drawable fixture cards with updateElementGeometry() scaled by geometryUnit() and data-hit-tick, then checks elementsFromPoint() and click() across all 4 cards plus the header <input>.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 300, H = 220;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const specs = [
        { x: 8, y: 8, w: 284, h: 46, bg: '#1e293b', btn: 'Pill' },
        { x: 8, y: 62, w: 138, h: 74, bg: '#14532d', btn: '+1k' },
        { x: 154, y: 62, w: 138, h: 74, bg: '#1e3a8a', btn: 'Bar' },
        { x: 8, y: 144, w: 284, h: 68, bg: '#7c2d12', btn: '+1 Spike' },
      ];

      const clicks = [0, 0, 0, 0];
      const slots = specs.map((s, idx) => {
        const el = makeSolidModule(s.w, s.h, s.bg, `M${idx}`, s.btn);
        if (idx === 0) {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = 'Ops';
          inp.setAttribute('aria-label', 'Fixture title');
          inp.style.cssText = 'width:84px;height:26px;background:#090d16;color:#fff;border:1px solid #64748b;';
          el.insertBefore(inp, el.querySelector('button'));
        }
        el.querySelector('button').addEventListener('click', () => { clicks[idx]++; });
        return { ...s, el, mode: 0 };
      });

      cv.append(...slots.map((s) => s.el));
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CHOREO_FRAG });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        for (const s of slots) {
          uploadWithMip(g, s.el);
        }
        const settled = [0, 1, 2, 3].map((i) => evaluateSectionAtMs(i, 1000, 200, 0));
        drawFixtureSlots(g, cv, slots, settled);

        const u = geometryUnit(cv, slots[0].el, slots[0].w);
        for (const s of slots) {
          cv.updateElementGeometry(s.el, {
            canvasTransform: new DOMMatrix().scale(u, u).translate(s.x, s.y),
          });
          s.el.dataset.hitTick = s.el.dataset.hitTick === '1' ? '0' : '1';
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const hitChecks = [];
        for (let i = 0; i < slots.length; i++) {
          const btn = slots[i].el.querySelector('button');
          const r = btn.getBoundingClientRect();
          const hits = document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
          hitChecks.push(hits.includes(btn));
          btn.click();
        }
        const inp = slots[0].el.querySelector('input');
        const ir = inp.getBoundingClientRect();
        const inpHit = document.elementsFromPoint(ir.left + ir.width * 0.5, ir.top + ir.height * 0.5).includes(inp);

        return need(
          hitChecks.every(Boolean) && inpHit && clicks.every((c) => c === 1),
          `buttonHits=[${hitChecks.join(', ')}], inputHit=${inpHit}, clicks=[${clicks.join(', ')}].`
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
    name: 'Synthetic webglcontextlost/restored recovers ElementGL and 5-arg 2D drawElementImage() renders',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored on an ElementGL fixture without calling loseContext(), plus verifies 5-argument drawElementImage() on a DPR-scaled 2D canvas copy.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('HTML-in-canvas or WebGL 2 is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 200, H = 120;
      const host = document.createElement('div');
      const plain = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;
      const mod = makeSolidModule(180, 96, '#0284c7', 'Recovery');
      cv.append(mod);
      host.append(cv, plain);
      testStage().append(host);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      let cv2 = null;

      try {
        g = new ElementGL(cv, {
          fragment: CHOREO_FRAG,
          onLost: () => {
            lostFired = true;
            plain.append(mod);
          },
          onRestored: () => {
            restoredFired = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.append(mod);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(mod);

        const evLost = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(evLost);
        const plainWhileLost = mod.parentElement === plain;
        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const texAfter = g.upload(mod);
        const errAfter = g.gl.getError();

        // 5-argument 2D drawElementImage() fallback verification
        cv2 = document.createElement('canvas');
        cv2.setAttribute('content', 'drawable');
        cv2.setAttribute('layoutsubtree', '');
        cv2.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;
        const card2 = makeSolidModule(160, 80, '#d2491f', '2D fallback');
        cv2.append(card2);
        testStage().append(cv2);

        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        cv2.width = Math.round(W * dpr);
        cv2.height = Math.round(H * dpr);
        const ctx = cv2.getContext('2d');
        await new Promise((resolve) => {
          cv2.addEventListener('paint', () => {
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.drawElementImage(card2, 16, 16, 160, 80);
            ctx.restore();
            resolve();
          }, { once: true });
          cv2.requestPaint();
        });

        const copy = document.createElement('canvas');
        copy.width = cv2.width;
        copy.height = cv2.height;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2, 0, 0);
        const data = cc.getImageData(0, 0, copy.width, copy.height).data;
        copy.width = 0;
        copy.height = 0;
        window.__gfx?.retire?.(copy);
        let nonEmpty = 0;
        for (let i = 3; i < data.length; i += 16) if (data[i] > 10) nonEmpty++;
        const frac = nonEmpty / Math.max(1, data.length / 16);

        return need(
          evLost.defaultPrevented && lostFired && plainWhileLost && restoredFired && mod.parentElement === cv
            && texAfter?.w > 0 && errAfter === g.gl.NO_ERROR && frac > 0.25,
          `preventDefault=${evLost.defaultPrevented}, plainWhileLost=${plainWhileLost}, restored=${restoredFired}, err=${errAfter}, 2dFill=${(frac * 100).toFixed(1)}%.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        cv2?.remove();
        host.remove();
        window.__gfx?.retire?.(cv);
        if (cv2) window.__gfx?.retire?.(cv2);
        await settleGfx(baseActive, 250);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'entry-choreo stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !state.hasPainted || moduleTextures.size < moduleEls.length) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.uploads >= moduleEls.length ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
]);
