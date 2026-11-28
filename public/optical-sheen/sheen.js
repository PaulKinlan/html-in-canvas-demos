import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

export const MATERIALS = [
  { id: 0, name: 'Hologram prism', short: 'Prism' },
  { id: 1, name: 'Brushed titanium', short: 'Titanium' },
  { id: 2, name: 'Gold leaf', short: 'Gold' },
];

export const TIERS = {
  founding: { label: 'Founding', serial: 'FND-057', price: '$240/YR', token: 'FND-8842-K9Q' },
  studio: { label: 'Studio', serial: 'STD-114', price: '$120/YR', token: 'STD-4419-M2V' },
  patron: { label: 'Patron', serial: 'PAT-009', price: '$480/YR', token: 'PAT-9021-X7R' },
};

// #region sheen-sim
export function createSheenSim() {
  return {
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    vyaw: 0,
    vpitch: 0,
    lightX: -0.45,
    lightY: -0.45,
    targetLightX: -0.45,
    targetLightY: -0.45,
    autoTilt: false,
    autoStartMs: 0,
    sweepActive: false,
    sweepStartMs: 0,
    sweepDurMs: 1100,
    lastMs: 0,
  };
}

export function triggerSheenSweep(sim, tMs, reduced = false) {
  if (reduced) {
    sim.sweepActive = false;
    sim.autoTilt = false;
    sim.targetLightX = sim.targetLightX > 0 ? -0.45 : 0.65;
    sim.targetLightY = -0.35;
    sim.lightX = sim.targetLightX;
    sim.lightY = sim.targetLightY;
    sim.yaw = sim.targetYaw;
    sim.pitch = sim.targetPitch;
    sim.vyaw = 0;
    sim.vpitch = 0;
    return false;
  }
  sim.sweepActive = true;
  sim.sweepStartMs = tMs;
  sim.lastMs = tMs;
  return true;
}

/**
 * Advance 3D card tilt and directional sheen at explicit timestamp `tMs`.
 * Returns true when another animation frame is needed.
 */
export function stepTiltAndSweep(sim, tMs, reduced = false) {
  const dt = sim.lastMs > 0 ? clamp((tMs - sim.lastMs) / 1000, 0.001, 0.05) : 1 / 60;
  sim.lastMs = tMs;

  if (reduced) {
    sim.autoTilt = false;
    sim.sweepActive = false;
    sim.yaw = sim.targetYaw;
    sim.pitch = sim.targetPitch;
    sim.vyaw = 0;
    sim.vpitch = 0;
    sim.lightX = sim.targetLightX;
    sim.lightY = sim.targetLightY;
    return false;
  }

  if (sim.autoTilt) {
    if (!sim.autoStartMs) sim.autoStartMs = tMs;
    const u = (tMs - sim.autoStartMs) / 1000;
    sim.targetYaw = Math.sin(u * 1.45) * 18;
    sim.targetPitch = Math.cos(u * 1.05) * 11;
    sim.targetLightX = Math.sin(u * 1.75) * 0.85;
    sim.targetLightY = -0.32 + Math.cos(u * 1.25) * 0.42;
  }

  if (sim.sweepActive) {
    const p = clamp((tMs - sim.sweepStartMs) / sim.sweepDurMs, 0, 1);
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
    sim.targetLightX = lerp(-0.95, 0.95, eased);
    sim.targetLightY = lerp(-0.55, 0.35, eased);
    if (!sim.autoTilt) {
      sim.targetYaw = Math.sin(Math.PI * p) * 14;
      sim.targetPitch = -Math.sin(Math.PI * p) * 6;
    }
    if (p >= 1) {
      sim.sweepActive = false;
      if (!sim.autoTilt) {
        sim.targetLightX = -0.45;
        sim.targetLightY = -0.45;
        sim.targetYaw = 0;
        sim.targetPitch = 0;
      }
    }
  }

  const k = 135;
  const damp = 15.5;
  const ax = (sim.targetYaw - sim.yaw) * k - sim.vyaw * damp;
  const ay = (sim.targetPitch - sim.pitch) * k - sim.vpitch * damp;
  sim.vyaw += ax * dt;
  sim.vpitch += ay * dt;
  sim.yaw += sim.vyaw * dt;
  sim.pitch += sim.vpitch * dt;

  const lightLerp = 1 - Math.exp(-10 * dt);
  sim.lightX = lerp(sim.lightX, sim.targetLightX, lightLerp);
  sim.lightY = lerp(sim.lightY, sim.targetLightY, lightLerp);

  const moving =
    sim.autoTilt ||
    sim.sweepActive ||
    Math.abs(sim.yaw - sim.targetYaw) > 0.04 ||
    Math.abs(sim.pitch - sim.targetPitch) > 0.04 ||
    Math.abs(sim.vyaw) > 0.08 ||
    Math.abs(sim.vpitch) > 0.08 ||
    Math.abs(sim.lightX - sim.targetLightX) > 0.004 ||
    Math.abs(sim.lightY - sim.targetLightY) > 0.004;

  if (!moving) {
    sim.yaw = sim.targetYaw;
    sim.pitch = sim.targetPitch;
    sim.vyaw = 0;
    sim.vpitch = 0;
    sim.lightX = sim.targetLightX;
    sim.lightY = sim.targetLightY;
  }
  return moving;
}
// #endregion sheen-sim

// #region foil-shader
export const FOIL_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uTexSize;
uniform float uTime;
uniform int uMaterial;     // 0 = Hologram prism, 1 = Brushed titanium, 2 = Gold leaf
uniform vec2 uTiltRad;     // (yawRad, pitchRad)
uniform vec2 uLightPos;    // normalized directional pointer light (-1..1, -1..1)
uniform float uSheen;      // sheen intensity multiplier
uniform float uRelief;     // Sobel relief slope multiplier

in vec2 vUv;
out vec4 outColor;

float sampleLuma(vec2 uv) {
  vec4 s = texture(uTex, clamp(uv, vec2(0.0), vec2(1.0)));
  vec3 rgb = s.a > 0.001 ? s.rgb / s.a : vec3(0.0);
  return dot(rgb, vec3(0.299, 0.587, 0.114)) * s.a;
}

void main() {
  vec4 tex = texture(uTex, vUv);
  vec3 base = tex.a > 0.001 ? tex.rgb / tex.a : vec3(0.0);
  float centerLum = dot(base, vec3(0.299, 0.587, 0.114));

  // Extract 3x3 Sobel luminance gradient at CSS-pixel spacing so bevel width stays
  // consistent between 1x desktop monitors and 2.625x high-DPI phones.
  vec2 stepUv = max(1.0 / max(uTexSize, vec2(1.0)), 1.15 / max(uSize, vec2(1.0)));
  float tl = sampleLuma(vUv + vec2(-stepUv.x, -stepUv.y));
  float tc = sampleLuma(vUv + vec2(      0.0, -stepUv.y));
  float tr = sampleLuma(vUv + vec2( stepUv.x, -stepUv.y));
  float ml = sampleLuma(vUv + vec2(-stepUv.x,       0.0));
  float mr = sampleLuma(vUv + vec2( stepUv.x,       0.0));
  float bl = sampleLuma(vUv + vec2(-stepUv.x,  stepUv.y));
  float bc = sampleLuma(vUv + vec2(      0.0,  stepUv.y));
  float br = sampleLuma(vUv + vec2( stepUv.x,  stepUv.y));

  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  vec2 slope = vec2(gx, gy) * 0.25;
  float gradMag = clamp(length(slope) * 1.45, 0.0, 1.0);
  float edgeMask = smoothstep(0.05, 0.38, gradMag);

  // Local embossed relief normal rotated by the 3D card pose (Rx * Ry).
  vec3 N_local = normalize(vec3(-slope.x * uRelief * 0.48, -slope.y * uRelief * 0.48, 1.0));
  float cY = cos(uTiltRad.x), sY = sin(uTiltRad.x);
  float cX = cos(uTiltRad.y), sX = sin(uTiltRad.y);
  vec3 T = vec3(cY, sX * sY, -cX * sY);
  vec3 B = vec3(0.0, cX, sX);
  vec3 N_card = vec3(sY, -sX * cY, cX * cY);
  vec3 N = normalize(T * N_local.x + B * N_local.y + N_card * N_local.z);

  vec2 aspectPos = (vUv - 0.5) * vec2(uSize.x / max(uSize.y, 1.0), 1.0);
  vec3 V = normalize(vec3(-aspectPos * 0.35, 1.0));
  vec3 L = normalize(vec3(uLightPos.x * 1.15 - aspectPos.x * 0.35, uLightPos.y * 1.15 - aspectPos.y * 0.35, 1.0));
  vec3 H = normalize(L + V);

  float sweepCoord = dot(aspectPos, vec2(0.82, 0.57)) - dot(uLightPos, vec2(0.75, 0.55)) - dot(uTiltRad, vec2(1.15, 0.85));
  float sweepBand = exp(-pow(sweepCoord * 3.1, 2.0));

  vec3 col = base;

  if (uMaterial == 0) {
    // Hologram prism: thin-film soap-bubble iridescence + rainbow diffraction grating lines
    float ndotv = clamp(dot(N, V), 0.08, 1.0);
    float ndoth = max(dot(N, H), 0.0);
    float tiltAngle = uTiltRad.x * 2.6 + uTiltRad.y * 1.9 + uLightPos.x * 1.25 - uLightPos.y * 0.85;
    float thickness = 1.45 + 0.45 * sin(vUv.x * 5.6 + vUv.y * 3.4 + tiltAngle * 0.85) + 0.35 * (slope.x - slope.y);
    float opd = 2.0 * 1.38 * thickness * ndotv + tiltAngle * 2.8 + (vUv.x * 2.8 - vUv.y * 1.5) * 2.4;
    vec3 film = 0.5 + 0.5 * cos(opd + vec3(0.0, 2.0944, 4.1888));

    float gratingPhase = (vUv.x * 0.90 + vUv.y * 0.43) * 185.0 + tiltAngle * 6.0;
    float grating = 0.55 + 0.45 * sin(gratingPhase);
    vec3 gratingTint = 0.5 + 0.5 * cos(opd * 1.35 + (vUv.x * 4.2 + vUv.y * 2.1) + vec3(0.0, 2.0944, 4.1888));

    float reliefSpec = pow(ndoth, 11.0) * (0.04 + 1.15 * edgeMask);
    float sharpGlint = pow(ndoth, 34.0) * (0.03 + 0.90 * edgeMask);
    float bodyWash = (0.04 + 0.22 * sweepBand) * (0.08 + 0.72 * smoothstep(0.08, 0.75, centerLum) + 0.65 * edgeMask);

    col = base * mix(vec3(1.0), 0.78 + film * 0.74, clamp(bodyWash * uSheen, 0.0, 0.85));
    col += (film * 0.60 + gratingTint * grating * 0.46) * (reliefSpec + bodyWash * 0.75) * uSheen;
    col += mix(film, vec3(1.0), 0.42) * sharpGlint * uSheen;
  } else if (uMaterial == 1) {
    // Brushed titanium: Ward + Kajiya-Kay anisotropic specular streaks perpendicular to brushed grooves
    vec3 T_aniso = normalize(T * 0.985 + B * 0.17);
    vec3 B_aniso = normalize(cross(N, T_aniso));
    float groove = 0.5 + 0.5 * sin(vUv.y * 460.0 + sin(vUv.x * 38.0) * 1.2);
    float microStreak = fract(sin(floor(vUv.y * 290.0) * 91.7 + floor(vUv.x * 32.0) * 213.3) * 43758.5453);
    float brushTex = mix(0.84, 1.16, 0.55 * groove + 0.45 * microStreak);

    float ndoth = max(dot(N, H), 0.001);
    float tdoth = dot(T_aniso, H);
    float bdoth = dot(B_aniso, H);
    float ax = 0.42;
    float ay = 0.072;
    float wardExp = -2.0 * ((tdoth * tdoth) / (ax * ax) + (bdoth * bdoth) / (ay * ay)) / max(1.0 + ndoth, 0.18);
    float anisoWard = exp(clamp(wardExp, -20.0, 0.0));
    float kajiya = pow(sqrt(max(0.0, 1.0 - tdoth * tdoth)), 16.0) * max(dot(N, L), 0.0);

    float edgeBoost = 0.05 + 1.20 * edgeMask + 0.42 * smoothstep(0.24, 0.90, centerLum);
    vec3 tiCool = vec3(0.84, 0.90, 0.98);
    vec3 tiSpec = vec3(0.93, 0.97, 1.00);
    col = base * mix(vec3(1.0), vec3(0.95, 0.98, 1.04), clamp(0.22 * uSheen, 0.0, 0.45));
    col += tiCool * anisoWard * brushTex * (0.18 + 0.52 * sweepBand) * edgeBoost * uSheen;
    col += tiSpec * kajiya * brushTex * (0.08 + 0.46 * edgeMask) * uSheen;
  } else {
    // Gold leaf: warm metallic amber-gold specular along embossed borders & typography
    float ndoth = max(dot(N, H), 0.0);
    float ndotv = clamp(dot(N, V), 0.05, 1.0);
    float flake = 0.88 + 0.12 * sin(vUv.x * 240.0 + sin(vUv.y * 170.0) * 2.1);
    float specBroad = pow(ndoth, 11.0);
    float specSharp = pow(ndoth, 36.0);
    float fresnel = pow(1.0 - ndotv, 2.8);

    vec3 amberGold = vec3(0.96, 0.64, 0.14);
    vec3 brightGold = vec3(1.00, 0.89, 0.48);
    vec3 goldTint = mix(amberGold, brightGold, clamp(specSharp * 1.4, 0.0, 1.0));
    float reliefMask = 0.04 + 1.24 * edgeMask + 0.44 * smoothstep(0.26, 0.92, centerLum);

    col = mix(base, base * vec3(1.14, 0.92, 0.62), clamp((0.20 + 0.52 * edgeMask) * uSheen, 0.0, 0.85));
    col += goldTint * flake * (specBroad * (0.26 + 0.58 * sweepBand) + specSharp * 0.76) * reliefMask * uSheen;
    col += amberGold * fresnel * (0.05 + 0.60 * edgeMask) * uSheen;
  }

  vec2 fw = max(fwidth(vUv), vec2(1e-5));
  vec2 edge = min(vUv, 1.0 - vUv);
  float aa = min(clamp(edge.x / fw.x, 0.0, 1.0), clamp(edge.y / fw.y, 0.0, 1.0));
  float a = tex.a * aa;
  outColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}`;
// #endregion foil-shader

// #region mvp-geometry
function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/**
 * Build matching 3D perspective transforms for #os-card inside (cw x ch) CSS px:
 * - uMvp maps unit UV (0..1, 0..1) into WebGL clip space with Z_ndc = 0.
 * - cssMatrix maps card CSS px (0..cardW, 0..cardH) into canvas CSS px for updateElementGeometry().
 */
export function buildCardMvp(cw, ch, cardW, cardH, yawDeg, pitchDeg, depthPx = 880) {
  const safeCw = Math.max(1, cw);
  const safeCh = Math.max(1, ch);
  const safeW = Math.max(1, cardW);
  const safeH = Math.max(1, cardH);
  const cx = safeCw * 0.5;
  const cy = safeCh * 0.5;
  const fit = clamp(Math.min(1, (safeCw - 24) / (safeW * 1.14), (safeCh - 24) / (safeH * 1.14)), 0.35, 1);

  const ry = (yawDeg * Math.PI) / 180;
  const rx = (pitchDeg * Math.PI) / 180;
  const cY = Math.cos(ry), sY = Math.sin(ry);
  const cX = Math.cos(rx), sX = Math.sin(rx);

  const rotMat = new Float32Array([
    cY, sX * sY, -cX * sY, 0,
    0, cX, sX, 0,
    sY, -sX * cY, cX * cY, 0,
    0, 0, 0, 1,
  ]);

  const toCenterScale = new Float32Array([
    fit, 0, 0, 0,
    0, fit, 0, 0,
    0, 0, fit, 0,
    -safeW * 0.5 * fit, -safeH * 0.5 * fit, 0, 1,
  ]);

  const invD = -1 / depthPx;
  const perspAndPlace = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    cx * invD, cy * invD, 1, invD,
    cx, cy, 0, 1,
  ]);

  const cssRaw = mat4Mul(perspAndPlace, mat4Mul(rotMat, toCenterScale));
  const cssMatrix = typeof DOMMatrix !== 'undefined' ? new DOMMatrix(Array.from(cssRaw)) : null;

  const cssToNdc = new Float32Array([
    2 / safeCw, 0, 0, 0,
    0, -2 / safeCh, 0, 0,
    0, 0, 0, 0,
    -1, 1, 0, 1,
  ]);
  const uvToPx = new Float32Array([
    safeW, 0, 0, 0,
    0, safeH, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const uMvp = mat4Mul(cssToNdc, mat4Mul(cssRaw, uvToPx));

  return { uMvp, cssMatrix, fit, yawRad: ry, pitchRad: rx };
}

export function syncCardGeometry({
  canvasEl,
  cardEl,
  cssMatrix,
  cw,
  ch,
  cardW,
  unitCache,
  lastGeoValsRef,
  force = false,
}) {
  if (typeof canvasEl.updateElementGeometry !== 'function') return;
  const unitKey = `${canvasEl.width}x${canvasEl.height}/${cw}x${ch}/${Math.round(cardW)}`;
  if (unitCache.key !== unitKey && canvasEl.width > 0 && cw > 0) {
    unitCache.unit = geometryUnit(canvasEl, cardEl, cardW);
    unitCache.key = unitKey;
    lastGeoValsRef.value = null;
  }
  const unit = unitCache.unit || 1;
  const target = cssMatrix ? new DOMMatrix().scale(unit, unit, 1).multiply(cssMatrix) : OFFSTAGE;
  if (!target) return;
  const vals = target.toFloat32Array();
  if (!force && lastGeoValsRef.value && vals.every((v, i) => Math.abs(v - lastGeoValsRef.value[i]) < 1e-4)) {
    return;
  }
  lastGeoValsRef.value = vals;
  cardEl.inert = !cssMatrix;
  canvasEl.updateElementGeometry(cardEl, { canvasTransform: target });
  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion mvp-geometry

function mountOpticalSheen() {
  banner();

  const stageBox = document.getElementById('os-stage');
  const viewportEl = document.getElementById('os-viewport');
  let canvas = document.getElementById('os-canvas');
  const cardEl = document.getElementById('os-card');
  const plainHost = document.getElementById('plain-host');
  const stageHud = document.getElementById('stage-hud');
  const noticeEl = document.getElementById('os-notice');
  const statusEl = document.getElementById('os-status');
  const testsBody = document.getElementById('tests');

  // Inside live card
  const serialEl = document.getElementById('os-serial');
  const priceEl = document.getElementById('os-price');
  const tokenEl = document.getElementById('os-token');
  const passBadge = document.getElementById('os-pass-badge');
  const memberInput = document.getElementById('os-member-input');
  const btnActivate = document.getElementById('btn-activate');
  const btnCopy = document.getElementById('btn-copy');
  const tierBtns = Array.from(cardEl.querySelectorAll('.os-tier[data-tier]'));

  // External controls
  const materialBtns = Array.from(document.querySelectorAll('[data-material]'));
  const tiltBtns = Array.from(document.querySelectorAll('[data-tilt]'));
  const autoTiltBtn = document.getElementById('btn-auto-tilt');
  const sweepBtn = document.getElementById('btn-sweep');
  const reducedChk = document.getElementById('ctl-reduced');
  const sheenInput = document.getElementById('ctl-sheen');
  const sheenOut = document.getElementById('out-sheen');
  const reliefInput = document.getElementById('ctl-relief');
  const reliefOut = document.getElementById('out-relief');

  const reducedMQ = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  const routeParam = new URLSearchParams(location.search).get('route');

  const state = {
    mode: 'init', // 'webgl' | '2d' | 'plain'
    material: 0,
    tier: 'founding',
    activated: false,
    copyTimer: 0,
    sheen: Number(sheenInput.value),
    relief: Number(reliefInput.value),
    reduced: reducedMQ.matches,
    hasPainted: false,
    cardDirty: true,
    onScreen: true,
    uploads: 0,
    paints: 0,
    texW: 0,
    texH: 0,
    rafId: 0,
    lastStatusMs: -1000,
    unitCache: { key: '', unit: 1 },
    lastGeoValsRef: { value: null },
    sim: createSheenSim(),
  };

  reducedChk.checked = state.reduced;
  const isReducedMotion = () => state.reduced || reducedMQ.matches;

  let stage = null;
  let ctx2d = null;
  let dragState = null;

  function showNotice(msg) {
    noticeEl.hidden = !msg;
    noticeEl.textContent = msg || '';
  }

  function syncCompactCard(cw) {
    cardEl.classList.toggle('is-compact', cw < 480);
  }

  function getCardDimensions(cw) {
    const compact = cw < 480;
    const cardW = cardEl.offsetWidth || (compact ? 304 : 356);
    const cardH = cardEl.offsetHeight || (compact ? 222 : 228);
    return { cardW, cardH };
  }

  function getCanvasCssBox() {
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 350);
    const ch = Math.max(120, canvas.clientHeight || viewportEl.clientHeight || 318);
    return { cw, ch };
  }

  function syncCardDom() {
    const t = TIERS[state.tier];
    cardEl.dataset.tier = state.tier;
    for (const b of tierBtns) {
      b.setAttribute('aria-pressed', String(b.dataset.tier === state.tier));
    }
    serialEl.textContent = t.serial;
    priceEl.textContent = t.price;
    tokenEl.textContent = t.token;
    passBadge.textContent = state.activated ? 'ACTIVE' : 'READY';
    passBadge.classList.toggle('is-active', state.activated);
    btnActivate.setAttribute('aria-pressed', String(state.activated));
    btnActivate.textContent = state.activated ? 'Pass active' : 'Activate pass';
    state.cardDirty = true;
  }

  function updateStatus(force = false) {
    const now = performance.now();
    if (!force && now - state.lastStatusMs < 110) return;
    state.lastStatusMs = now;
    const mat = MATERIALS[state.material];
    const routeLabel =
      state.mode === 'webgl'
        ? 'WebGL 2 ElementGL'
        : state.mode === '2d'
          ? '2D drawElementImage()'
          : 'Plain HTML';
    const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
    statusEl.textContent =
      `${routeLabel} · ${mat.name} · ${TIERS[state.tier].label} · yaw ${state.sim.yaw.toFixed(1)} deg, pitch ${state.sim.pitch.toFixed(1)} deg · ${mp} MP · ${state.uploads} uploads.`;
    stageHud.textContent =
      `${mat.name} · drag card to tilt in 3D · tap badges or edit name`;
  }

  // #region fallback-2d
  function enterPlainFallback(reason) {
    stopLoop();
    state.mode = 'plain';
    viewportEl.classList.add('is-plain');
    canvas.hidden = true;
    cardEl.inert = false;
    if (cardEl.parentElement !== plainHost) plainHost.append(cardEl);
    showNotice(reason);
    updateStatus(true);
  }

  function exitPlainFallback() {
    viewportEl.classList.remove('is-plain');
    canvas.hidden = false;
    if (cardEl.parentElement !== canvas) canvas.append(cardEl);
    showNotice('');
    state.lastGeoValsRef.value = null;
    state.cardDirty = true;
  }

  function draw2DFallback() {
    if (!state.hasPainted || !ctx2d || state.mode !== '2d') return;
    const { cw, ch } = getCanvasCssBox();
    syncCompactCard(cw);
    const { cardW, cardH } = getCardDimensions(cw);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    const geom = buildCardMvp(cw, ch, cardW, cardH, state.sim.yaw, state.sim.pitch);
    const yawRad = geom.yawRad;
    const pitchRad = geom.pitchRad;
    const sx = Math.max(0.55, Math.cos(yawRad));
    const sy = Math.max(0.55, Math.cos(pitchRad));
    const shearY = Math.sin(yawRad) * 0.14;
    const shearX = -Math.sin(pitchRad) * 0.10;

    ctx2d.reset();
    ctx2d.scale(dpr, dpr);
    ctx2d.fillStyle = '#0c1018';
    ctx2d.fillRect(0, 0, cw, ch);

    ctx2d.save();
    ctx2d.translate(cw * 0.5, ch * 0.5);
    ctx2d.scale(geom.fit, geom.fit);
    ctx2d.transform(sx, shearY, shearX, sy, 0, 0);
    ctx2d.translate(-cardW * 0.5, -cardH * 0.5);

    // 5-argument drawElementImage() uses CSS-pixel dimensions on scaled contexts.
    ctx2d.drawElementImage(cardEl, 0, 0, cardW, cardH);

    // Material-matched 2D foil gradient blend overlay when WebGL 2 is absent.
    const lx = state.sim.lightX * cardW * 0.45;
    const ly = state.sim.lightY * cardH * 0.45;
    const grad = ctx2d.createLinearGradient(lx, ly, cardW + lx, cardH + ly);
    const alpha = clamp(0.24 * state.sheen, 0, 0.55);
    if (state.material === 0) {
      grad.addColorStop(0.0, `rgba(96, 224, 255, ${(alpha * 0.35).toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(255, 130, 232, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.75, `rgba(125, 255, 198, ${(alpha * 0.9).toFixed(3)})`);
      grad.addColorStop(1.0, `rgba(96, 152, 255, ${(alpha * 0.35).toFixed(3)})`);
    } else if (state.material === 1) {
      grad.addColorStop(0.0, 'rgba(180, 200, 226, 0.04)');
      grad.addColorStop(0.5, `rgba(226, 238, 255, ${(alpha * 1.1).toFixed(3)})`);
      grad.addColorStop(1.0, 'rgba(160, 185, 215, 0.04)');
    } else {
      grad.addColorStop(0.0, 'rgba(220, 150, 40, 0.06)');
      grad.addColorStop(0.5, `rgba(255, 218, 110, ${(alpha * 1.15).toFixed(3)})`);
      grad.addColorStop(1.0, 'rgba(210, 140, 32, 0.06)');
    }
    ctx2d.globalCompositeOperation = 'screen';
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, cardW, cardH);
    ctx2d.restore();

    syncCardGeometry({
      canvasEl: canvas,
      cardEl,
      cssMatrix: geom.cssMatrix,
      cw,
      ch,
      cardW,
      unitCache: state.unitCache,
      lastGeoValsRef: state.lastGeoValsRef,
    });

    state.paints++;
    state.uploads++;
    updateStatus();
  }
  // #endregion fallback-2d

  // #region paint-upload
  function drawWebGLFrame(uploadAllowed = false, paintEvent = null) {
    if (!state.hasPainted || !stage || stage.lost) return;
    const { cw, ch } = getCanvasCssBox();
    syncCompactCard(cw);
    const { cardW, cardH } = getCardDimensions(cw);

    // Always call stage.begin() before stage.upload() so buffer sizing stays synced.
    if (!stage.begin([0.045, 0.055, 0.082, 1.0])) return;

    const changed = paintEvent?.changedElements ?? null;
    const shouldUpload =
      uploadAllowed &&
      (state.cardDirty || !stage.has(cardEl) || !changed || changed.includes(cardEl));
    if (shouldUpload) {
      try {
        const tex = stage.upload(cardEl);
        if (tex) {
          state.texW = tex.w;
          state.texH = tex.h;
          state.cardDirty = false;
          state.uploads++;
        }
      } catch (err) {
        if (/paint record/i.test(err?.message ?? '')) {
          canvas.requestPaint?.();
          return;
        }
        throw err;
      }
    }
    if (!stage.has(cardEl)) return;

    const geom = buildCardMvp(cw, ch, cardW, cardH, state.sim.yaw, state.sim.pitch);
    stage.quad(cardEl, geom.uMvp, (gl, u) => {
      gl.uniform2f(u('uTexSize'), state.texW || cardW, state.texH || cardH);
      gl.uniform1i(u('uMaterial'), state.material);
      gl.uniform2f(u('uTiltRad'), geom.yawRad, geom.pitchRad);
      gl.uniform2f(u('uLightPos'), state.sim.lightX, state.sim.lightY);
      gl.uniform1f(u('uSheen'), state.sheen);
      gl.uniform1f(u('uRelief'), state.relief);
    });

    syncCardGeometry({
      canvasEl: canvas,
      cardEl,
      cssMatrix: geom.cssMatrix,
      cw,
      ch,
      cardW,
      unitCache: state.unitCache,
      lastGeoValsRef: state.lastGeoValsRef,
    });

    state.paints++;
    updateStatus();
  }

  function drawCurrentFrame(uploadAllowed = false) {
    if (state.mode === 'plain') {
      updateStatus(true);
      return;
    }
    if (!state.hasPainted) {
      canvas.requestPaint?.();
      return;
    }
    if (state.mode === 'webgl') drawWebGLFrame(uploadAllowed);
    else if (state.mode === '2d') draw2DFallback();
  }

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.sim.lastMs = 0;
  }

  function tickMotion(now) {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.mode === 'plain') return;
    const more = stepTiltAndSweep(state.sim, now, isReducedMotion());
    drawCurrentFrame(false);
    if (more && !isReducedMotion()) {
      state.rafId = requestAnimationFrame(tickMotion);
    }
  }

  function wakeMotion() {
    if (!state.onScreen || document.hidden || state.mode === 'plain') return;
    if (isReducedMotion()) {
      stepTiltAndSweep(state.sim, performance.now(), true);
      drawCurrentFrame(false);
      return;
    }
    if (!state.rafId) {
      state.sim.lastMs = performance.now();
      state.rafId = requestAnimationFrame(tickMotion);
    }
  }

  function wireCanvasEvents(cv) {
    cv.addEventListener('paint', (e) => {
      state.hasPainted = true;
      if (state.mode === 'webgl') drawWebGLFrame(true, e);
      else if (state.mode === '2d') draw2DFallback();
    });

    cv.addEventListener('contextlost', (e) => {
      e.preventDefault();
      if (state.mode === '2d') {
        enterPlainFallback('The 2D canvas lost its context. Showing the membership card as plain HTML.');
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
    const { cw } = getCanvasCssBox();
    syncCompactCard(cw);
    syncCardDom();

    if (routeParam === 'plain') {
      enterPlainFallback('Plain HTML view active (?route=plain).');
      return;
    }

    if (routeParam !== '2d' && hicSupported && glSupported) {
      try {
        stage = new ElementGL(canvas, {
          fragment: FOIL_FRAG,
          attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
          onLost: () => {
            enterPlainFallback('The browser took the WebGL 2 context away. The membership card is shown as plain HTML until restored.');
          },
          onRestored: () => {
            stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            state.mode = 'webgl';
            state.hasPainted = false;
            state.cardDirty = true;
            state.unitCache.key = '';
            state.lastGeoValsRef.value = null;
            exitPlainFallback();
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
        fresh.id = 'os-canvas';
        fresh.setAttribute('content', 'drawable');
        fresh.setAttribute('layoutsubtree', '');
        fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
        fresh.append(cardEl);
        canvas.replaceWith(fresh);
        window.__gfx?.retire?.(canvas);
        canvas = fresh;
        showNotice(`WebGL 2 could not start (${err.message}). Using the 2D drawElementImage() fallback.`);
      }
    }

    if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        state.mode = '2d';
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument drawElementImage() 2D fallback.');
        }
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      }
    }

    enterPlainFallback('HTML-in-canvas is not available in this browser, so the membership card is shown as plain HTML.');
  }
  // #endregion paint-upload

  // ---- Interactive DOM controls inside #os-card ----
  for (const btn of tierBtns) {
    btn.addEventListener('click', () => {
      state.tier = btn.dataset.tier;
      syncCardDom();
      if (state.mode !== 'plain') canvas.requestPaint?.();
      else updateStatus(true);
    });
  }

  memberInput.addEventListener('input', () => {
    state.cardDirty = true;
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnActivate.addEventListener('click', () => {
    state.activated = !state.activated;
    syncCardDom();
    if (state.mode !== 'plain') canvas.requestPaint?.();
    else updateStatus(true);
  });

  btnCopy.addEventListener('click', () => {
    const token = tokenEl.textContent || '';
    const confirmCopy = () => {
      btnCopy.textContent = 'Token copied';
      state.cardDirty = true;
      if (state.mode !== 'plain') canvas.requestPaint?.();
      clearTimeout(state.copyTimer);
      state.copyTimer = setTimeout(() => {
        btnCopy.textContent = 'Copy token';
        state.cardDirty = true;
        if (state.mode !== 'plain') canvas.requestPaint?.();
      }, 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(token).then(confirmCopy, confirmCopy);
    } else {
      confirmCopy();
    }
  });

  // ---- External preset, tilt and slider controls ----
  for (const btn of materialBtns) {
    btn.addEventListener('click', () => {
      state.material = Number(btn.dataset.material);
      for (const b of materialBtns) b.setAttribute('aria-pressed', String(b === btn));
      drawCurrentFrame(false);
      updateStatus(true);
    });
  }

  function clearTiltButtons() {
    for (const b of tiltBtns) b.setAttribute('aria-pressed', 'false');
  }

  function setAutoTilt(enabled) {
    if (enabled && isReducedMotion()) {
      state.sim.autoTilt = false;
      autoTiltBtn.setAttribute('aria-pressed', 'false');
      showNotice('Auto tilt stays paused while reduced motion is on.');
      return;
    }
    state.sim.autoTilt = enabled;
    state.sim.autoStartMs = 0;
    autoTiltBtn.setAttribute('aria-pressed', String(enabled));
    if (enabled) {
      clearTiltButtons();
      wakeMotion();
    } else {
      state.sim.targetYaw = 0;
      state.sim.targetPitch = 0;
      state.sim.targetLightX = -0.45;
      state.sim.targetLightY = -0.45;
      document.querySelector('[data-tilt="flat"]')?.setAttribute('aria-pressed', 'true');
      wakeMotion();
    }
  }

  for (const btn of tiltBtns) {
    btn.addEventListener('click', () => {
      setAutoTilt(false);
      clearTiltButtons();
      btn.setAttribute('aria-pressed', 'true');
      if (btn.dataset.tilt === 'tilted') {
        state.sim.targetYaw = 18;
        state.sim.targetPitch = -10;
        state.sim.targetLightX = 0.55;
        state.sim.targetLightY = -0.35;
      } else {
        state.sim.targetYaw = 0;
        state.sim.targetPitch = 0;
        state.sim.targetLightX = -0.45;
        state.sim.targetLightY = -0.45;
      }
      wakeMotion();
    });
  }

  autoTiltBtn.addEventListener('click', () => setAutoTilt(!state.sim.autoTilt));

  sweepBtn.addEventListener('click', () => {
    setAutoTilt(false);
    triggerSheenSweep(state.sim, performance.now(), isReducedMotion());
    if (isReducedMotion()) {
      drawCurrentFrame(false);
    } else {
      wakeMotion();
    }
  });

  reducedChk.addEventListener('change', () => {
    state.reduced = reducedChk.checked;
    if (isReducedMotion()) {
      state.sim.autoTilt = false;
      autoTiltBtn.setAttribute('aria-pressed', 'false');
      stopLoop();
      stepTiltAndSweep(state.sim, performance.now(), true);
      drawCurrentFrame(false);
    }
  });

  reducedMQ.addEventListener?.('change', () => {
    state.reduced = reducedMQ.matches;
    reducedChk.checked = reducedMQ.matches;
    if (isReducedMotion()) {
      state.sim.autoTilt = false;
      autoTiltBtn.setAttribute('aria-pressed', 'false');
      stopLoop();
      stepTiltAndSweep(state.sim, performance.now(), true);
      drawCurrentFrame(false);
    }
  });

  sheenInput.addEventListener('input', () => {
    state.sheen = Number(sheenInput.value);
    sheenOut.textContent = `${state.sheen.toFixed(2)}×`;
    drawCurrentFrame(false);
  });

  reliefInput.addEventListener('input', () => {
    state.relief = Number(reliefInput.value);
    reliefOut.textContent = `${state.relief.toFixed(1)}×`;
    drawCurrentFrame(false);
  });

  // ---- Pointer drag tilt + selection guard outside <input> ----
  viewportEl.addEventListener('selectstart', (e) => {
    if (!e.target?.closest?.('input, textarea')) e.preventDefault();
  });

  function wirePointerEvents(cv) {
    cv.addEventListener('pointerdown', (e) => {
      if (state.mode === 'plain' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target?.closest?.('button, input, select, textarea, label, a')) return;
      setAutoTilt(false);
      clearTiltButtons();
      state.sim.sweepActive = false;
      dragState = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        yaw: state.sim.yaw,
        pitch: state.sim.pitch,
      };
      try { cv.setPointerCapture(e.pointerId); } catch {}
      cv.classList.add('is-dragging');
    });

    cv.addEventListener('pointermove', (e) => {
      if (state.mode === 'plain') return;
      const rect = cv.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const lx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        const ly = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
        if (dragState && e.pointerId === dragState.id) {
          const dx = e.clientX - dragState.x;
          const dy = e.clientY - dragState.y;
          const nextYaw = clamp(dragState.yaw + dx * 0.22, -26, 26);
          const nextPitch = clamp(dragState.pitch - dy * 0.18, -18, 18);
          state.sim.yaw = nextYaw;
          state.sim.pitch = nextPitch;
          state.sim.targetYaw = nextYaw;
          state.sim.targetPitch = nextPitch;
          state.sim.lightX = lx;
          state.sim.lightY = ly;
          state.sim.targetLightX = lx;
          state.sim.targetLightY = ly;
          drawCurrentFrame(false);
          return;
        }
        if (e.pointerType === 'mouse' && !dragState) {
          state.sim.targetLightX = lx;
          state.sim.targetLightY = ly;
          if (isReducedMotion()) {
            state.sim.lightX = lx;
            state.sim.lightY = ly;
            drawCurrentFrame(false);
          } else {
            state.sim.lightX = lerp(state.sim.lightX, lx, 0.35);
            state.sim.lightY = lerp(state.sim.lightY, ly, 0.35);
            drawCurrentFrame(false);
          }
        }
      }
    });

    const endDrag = (e) => {
      if (!dragState || e.pointerId !== dragState.id) return;
      dragState = null;
      cv.classList.remove('is-dragging');
      state.sim.targetYaw = 0;
      state.sim.targetPitch = 0;
      document.querySelector('[data-tilt="flat"]')?.setAttribute('aria-pressed', 'true');
      wakeMotion();
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
  }
  wirePointerEvents(canvas);

  // ---- Lifecycle pause observers ----
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(([entry]) => {
      state.onScreen = !!entry?.isIntersecting;
      if (!state.onScreen) {
        stopLoop();
      } else if (state.mode !== 'plain' && state.hasPainted) {
        drawCurrentFrame(false);
        if (state.sim.autoTilt || state.sim.sweepActive) wakeMotion();
      }
    }, { rootMargin: '120px 0px' }).observe(stageBox);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (state.onScreen && state.mode !== 'plain' && state.hasPainted) {
      drawCurrentFrame(false);
      if (state.sim.autoTilt || state.sim.sweepActive) wakeMotion();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (state.mode === 'plain') return;
      const { cw } = getCanvasCssBox();
      syncCompactCard(cw);
      state.unitCache.key = '';
      state.lastGeoValsRef.value = null;
      if (state.hasPainted) drawCurrentFrame(false);
      else canvas.requestPaint?.();
    }).observe(viewportEl);
  }

  initBackend();

  // ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------
  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  function readCssPx(gl, cv, cw, ch, cssX, cssY) {
    const sx = cv.width / Math.max(1, cw);
    const sy = cv.height / Math.max(1, ch);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  const lumaOf = (px) => 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];

  async function makeGlFixture(w, h, html) {
    if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
    const baseActive = window.__gfx?.active?.() ?? 0;
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    cv.innerHTML = html;
    testStage().append(cv);

    const g = new ElementGL(cv, {
      fragment: FOIL_FRAG,
      attributes: { alpha: false, preserveDrawingBuffer: true },
    });
    g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    const done = async () => {
      g.dispose();
      cv.remove();
      window.__gfx?.active?.();
      window.__gfx?.retire?.(cv);
      await sleep(230);
      window.__gfx?.release?.(cv);
      const deadline = performance.now() + 600;
      while ((window.__gfx?.active?.() ?? 0) > baseActive && performance.now() < deadline) {
        await sleep(80);
      }
    };
    return { cv, g, done };
  }

  async function paintAndUploadFixture(fx, card) {
    let hasPainted = false;
    let tex = null;
    fx.cv.addEventListener('paint', () => {
      hasPainted = true;
      if (!fx.g.begin([0.04, 0.05, 0.08, 1])) return;
      tex = fx.g.upload(card);
    }, { once: true });
    await nextPaint(fx.cv);
    if (!hasPainted || !tex) throw new Error('fixture paint event did not upload element');
    return tex;
  }

  function drawFixtureFoil(fx, card, tex, cw, ch, cardW, cardH, opts = {}) {
    const geom = buildCardMvp(cw, ch, cardW, cardH, opts.yaw ?? 0, opts.pitch ?? 0);
    fx.g.begin([0.04, 0.05, 0.08, 1]);
    fx.g.quad(card, geom.uMvp, (gl, u) => {
      gl.uniform2f(u('uTexSize'), tex.w, tex.h);
      gl.uniform1i(u('uMaterial'), opts.material ?? 0);
      gl.uniform2f(u('uTiltRad'), geom.yawRad, geom.pitchRad);
      gl.uniform2f(u('uLightPos'), opts.lightX ?? -0.45, opts.lightY ?? -0.45);
      gl.uniform1f(u('uSheen'), opts.sheen ?? 1.2);
      gl.uniform1f(u('uRelief'), opts.relief ?? 2.6);
    });
    return { err: fx.g.gl.getError(), geom };
  }

  runTests(testsBody, [
    {
      name: 'ElementGL + texElementSubImage2D() uploads live card with gl.getError() === 0',
      expect: 'pass',
      why: 'Creates an isolated ElementGL fixture with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, gates stage.upload() on hasPainted inside paint after stage.begin(), and checks gl.getError() === 0 plus opaque card pixels.',
      run: async () => {
        const W = 240, H = 160;
        const fx = await makeGlFixture(
          W,
          H,
          '<div id="fx-card" drawable style="position:absolute;left:0;top:0;width:200px;height:124px;border-radius:10px;border:2px solid #b8c5dc;background:#0c1018;color:#f3f7ff;padding:12px;box-sizing:border-box;font:700 15px system-ui;">MEMBER PASS</div>'
        );
        try {
          const card = fx.cv.querySelector('#fx-card');
          const tex = await paintAndUploadFixture(fx, card);
          const { err } = drawFixtureFoil(fx, card, tex, W, H, 200, 124, { material: 0 });
          const centerPx = readCssPx(fx.g.gl, fx.cv, W, H, W / 2, H / 2);
          return need(
            err === fx.g.gl.NO_ERROR && tex.w > 0 && tex.h > 0 && centerPx[3] > 230,
            `tex=${tex.w}×${tex.h}, glErr=${err}, center rgb(${centerPx[0]},${centerPx[1]},${centerPx[2]}), alpha=${centerPx[3]}.`
          );
        } finally {
          await fx.done();
        }
      },
    },
    {
      name: 'Sobel DOM relief selectively brightens embossed border and glyph edges under specular glare',
      expect: 'pass',
      why: 'Renders an embossed dark-body fixture card at uSheen = 0.0 (unlit baseline) and uSheen = 1.35 with overhead glare, comparing luminance gain along the embossed horizontal bezel edge against the flat dark interior.',
      run: async () => {
        const W = 240, H = 160, cardW = 200, cardH = 120;
        const fx = await makeGlFixture(
          W,
          H,
          `<div id="fx-relief" drawable style="position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#0c1018;">` +
          '<div style="position:absolute;left:20px;top:38px;width:160px;height:14px;background:#8c9bb5;border-radius:3px;"></div>' +
          '</div>'
        );
        try {
          const card = fx.cv.querySelector('#fx-relief');
          const tex = await paintAndUploadFixture(fx, card);
          const scanYs = [36, 37, 38, 39, 40];

          const { geom } = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 2,
            sheen: 0.0,
            relief: 2.8,
            lightX: 0.0,
            lightY: -0.45,
          });
          const toCanvas = (cx, cy) => {
            const p = geom.cssMatrix.transformPoint(new DOMPoint(cx, cy, 0, 1));
            return [p.x / p.w, p.y / p.w];
          };
          const baseBevels = scanYs.map((y) => {
            const [sx, sy] = toCanvas(100, y);
            return lumaOf(readCssPx(fx.g.gl, fx.cv, W, H, sx, sy));
          });
          const [fxFlat, fyFlat] = toCanvas(100, 92);
          const baseFlat = lumaOf(readCssPx(fx.g.gl, fx.cv, W, H, fxFlat, fyFlat));

          const { err } = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 2,
            sheen: 1.35,
            relief: 2.8,
            lightX: 0.0,
            lightY: -0.45,
          });
          const litBevels = scanYs.map((y) => {
            const [sx, sy] = toCanvas(100, y);
            return lumaOf(readCssPx(fx.g.gl, fx.cv, W, H, sx, sy));
          });
          const litFlat = lumaOf(readCssPx(fx.g.gl, fx.cv, W, H, fxFlat, fyFlat));

          let bestEdgeGain = -Infinity;
          for (let i = 0; i < scanYs.length; i++) {
            bestEdgeGain = Math.max(bestEdgeGain, litBevels[i] - baseBevels[i]);
          }
          const flatGain = litFlat - baseFlat;

          return need(
            err === fx.g.gl.NO_ERROR && bestEdgeGain > 32 && bestEdgeGain > flatGain + 22,
            `glErr=${err}, embossedEdgeGain=+${bestEdgeGain.toFixed(1)}, flatInteriorGain=+${flatGain.toFixed(1)} luma.`
          );
        } finally {
          await fx.done();
        }
      },
    },
    {
      name: 'Pointer tilt shifts Hologram prism hue phase across halves and differs from Gold leaf and Brushed titanium',
      expect: 'pass',
      why: 'Checks explicit tMs sweep progression (including reduced-motion instant snap), then renders left/right halves of a fixture under opposite tilt angles in Hologram prism and compares against Gold leaf and Brushed titanium.',
      run: async () => {
        const sim = createSheenSim();
        triggerSheenSweep(sim, 1000, false);
        stepTiltAndSweep(sim, 1300, false);
        const midX = sim.lightX;
        const midYaw = sim.yaw;
        for (let t = 1320; t <= 2200; t += 20) stepTiltAndSweep(sim, t, false);
        const settledAfter = !sim.sweepActive;

        const simReduced = createSheenSim();
        triggerSheenSweep(simReduced, 1000, true);
        const reducedMoved = simReduced.lightX !== -0.45 && !simReduced.sweepActive;

        const W = 240, H = 140, cardW = 196, cardH = 104;
        const fx = await makeGlFixture(
          W,
          H,
          `<div id="fx-hue" drawable style="position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#0e121b;display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;">` +
          '<div style="width:100%;height:38px;border:2px solid #dfe7f5;background:#95a1b8;border-radius:6px;"></div></div>'
        );
        try {
          const card = fx.cv.querySelector('#fx-hue');
          const tex = await paintAndUploadFixture(fx, card);

          const sampleAt = (geom, cx, cy) => {
            const p = geom.cssMatrix.transformPoint(new DOMPoint(cx, cy, 0, 1));
            return readCssPx(fx.g.gl, fx.cv, W, H, p.x / p.w, p.y / p.w);
          };

          // Tilt A: left lean
          const drawA = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 0,
            yaw: -20,
            pitch: 8,
            lightX: -0.75,
            lightY: -0.35,
            sheen: 1.25,
          });
          const leftA = sampleAt(drawA.geom, 48, cardH / 2);
          const rightA = sampleAt(drawA.geom, cardW - 48, cardH / 2);

          // Tilt B: right lean
          const drawB = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 0,
            yaw: 20,
            pitch: -8,
            lightX: 0.75,
            lightY: 0.35,
            sheen: 1.25,
          });
          const leftB = sampleAt(drawB.geom, 48, cardH / 2);
          const rightB = sampleAt(drawB.geom, cardW - 48, cardH / 2);

          // Gold leaf vs Hologram prism vs Brushed titanium on the bright silver bar
          const drawGold = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 2,
            yaw: 0,
            pitch: 0,
            lightX: 0.0,
            lightY: -0.25,
            sheen: 1.35,
          });
          const goldPx = sampleAt(drawGold.geom, cardW / 2, cardH / 2);

          const drawTi = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 1,
            yaw: 0,
            pitch: 0,
            lightX: 0.0,
            lightY: -0.25,
            sheen: 1.35,
          });
          const tiPx = sampleAt(drawTi.geom, cardW / 2, cardH / 2);

          const drawPrism = drawFixtureFoil(fx, card, tex, W, H, cardW, cardH, {
            material: 0,
            yaw: 0,
            pitch: 0,
            lightX: 0.0,
            lightY: -0.25,
            sheen: 1.35,
          });
          const prismPx = sampleAt(drawPrism.geom, cardW / 2, cardH / 2);
          const err = fx.g.gl.getError();

          const halfDiffA = Math.abs(leftA[0] - rightA[0]) + Math.abs(leftA[1] - rightA[1]) + Math.abs(leftA[2] - rightA[2]);
          const tiltShift =
            Math.abs(leftA[0] - leftB[0]) + Math.abs(leftA[1] - leftB[1]) + Math.abs(leftA[2] - leftB[2]) +
            Math.abs(rightA[0] - rightB[0]) + Math.abs(rightA[1] - rightB[1]) + Math.abs(rightA[2] - rightB[2]);
          const goldWarm = goldPx[0] - goldPx[2];
          const presetDelta = Math.abs(goldPx[0] - prismPx[0]) + Math.abs(goldPx[2] - prismPx[2]) + Math.abs(goldPx[2] - tiPx[2]);

          return need(
            err === fx.g.gl.NO_ERROR &&
              settledAfter &&
              reducedMoved &&
              midYaw > 0.5 &&
              halfDiffA > 25 &&
              tiltShift > 45 &&
              goldWarm > 24 &&
              presetDelta > 30,
            `tMs midLightX=${midX.toFixed(2)}, halfDiff=${halfDiffA}, tiltShift=${tiltShift}, goldR-B=${goldWarm}, gold=[${goldPx[0]},${goldPx[1]},${goldPx[2]}], ti=[${tiPx[0]},${tiPx[1]},${tiPx[2]}], prism=[${prismPx[0]},${prismPx[1]},${prismPx[2]}].`
          );
        } finally {
          await fx.done();
        }
      },
    },
    {
      name: 'Tilted card hit testing hits buttons and <input> via updateElementGeometry()',
      expect: 'pass',
      why: 'Applies buildCardMvp() scaled by geometryUnit() to updateElementGeometry() at 18 deg yaw / -10 deg pitch, checks elementsFromPoint() hits both a button and an <input>, and verifies click and input events fire.',
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available');
        }
        const W = 280, H = 200, cw = W, ch = H, cardW = 220, cardH = 148;
        const fx = await makeGlFixture(
          W,
          H,
          `<div id="fx-hit" drawable style="position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#111722;border:2px solid #c4d1e8;border-radius:10px;">` +
          '<input id="fx-inp" type="text" value="ALICE" style="position:absolute;left:16px;top:22px;width:186px;height:34px;border:1px solid #75849e;background:#080b11;color:#fff;font:700 12px monospace;">' +
          '<button id="fx-btn" type="button" style="position:absolute;left:112px;top:88px;width:92px;height:38px;border:1.5px solid #e7effd;background:#1f2b40;color:#fff;font:700 12px system-ui;">Activate</button></div>'
        );
        try {
          const card = fx.cv.querySelector('#fx-hit');
          const inp = fx.cv.querySelector('#fx-inp');
          const btn = fx.cv.querySelector('#fx-btn');
          const tex = await paintAndUploadFixture(fx, card);
          const { err, geom } = drawFixtureFoil(fx, card, tex, cw, ch, cardW, cardH, {
            yaw: 18,
            pitch: -10,
            material: 0,
          });
          if (err !== fx.g.gl.NO_ERROR) throw new Error(`GL error ${err}`);

          const unitCache = { key: '', unit: 1 };
          const lastGeoValsRef = { value: null };
          syncCardGeometry({
            canvasEl: fx.cv,
            cardEl: card,
            cssMatrix: geom.cssMatrix,
            cw,
            ch,
            cardW,
            unitCache,
            lastGeoValsRef,
            force: true,
          });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const cvRect = fx.cv.getBoundingClientRect();
          const pBtn = geom.cssMatrix.transformPoint(new DOMPoint(112 + 46, 88 + 19, 0, 1));
          const pInp = geom.cssMatrix.transformPoint(new DOMPoint(16 + 93, 22 + 17, 0, 1));
          const btnHits = document.elementsFromPoint(cvRect.left + pBtn.x / pBtn.w, cvRect.top + pBtn.y / pBtn.w);
          const inpHits = document.elementsFromPoint(cvRect.left + pInp.x / pInp.w, cvRect.top + pInp.y / pInp.w);

          let clicks = 0;
          let edits = 0;
          btn.addEventListener('click', () => clicks++);
          inp.addEventListener('input', () => edits++);
          btn.click();
          inp.value = 'FOUNDER 01';
          inp.dispatchEvent(new Event('input', { bubbles: true }));

          return need(
            btnHits.includes(btn) && inpHits.includes(inp) && clicks === 1 && edits === 1 && card.dataset.hitTick !== undefined,
            `btnHit=${btnHits.includes(btn)} at (${(pBtn.x / pBtn.w).toFixed(1)},${(pBtn.y / pBtn.w).toFixed(1)}), inpHit=${inpHits.includes(inp)} at (${(pInp.x / pInp.w).toFixed(1)},${(pInp.y / pInp.w).toFixed(1)}), unit=${unitCache.unit.toFixed(2)}.`
          );
        } finally {
          await fx.done();
        }
      },
    },
    {
      name: 'Synthetic webglcontextlost/restored recovery and 5-arg 2D foil gradient fallback',
      expect: 'pass',
      why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events without calling loseContext(), then draws a 5-argument drawElementImage() 2D foil blend and verifies pixels via a plain drawImage() copy.',
      run: async () => {
        if (!hicSupported) throw new Error('HTML-in-canvas is not available');
        const W = 220, H = 140;
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        plain.hidden = true;
        const cv = document.createElement('canvas');
        cv.setAttribute('content', 'drawable');
        cv.setAttribute('layoutsubtree', '');
        cv.style.cssText = `position:relative;display:block;width:${W}px;height:${H}px;`;
        const card = document.createElement('div');
        card.setAttribute('drawable', '');
        card.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#0e131e;color:#f4f8ff;padding:10px;box-sizing:border-box;`;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = 'PATRON 09';
        card.append(inp);
        cv.append(card);
        wrap.append(cv, plain);
        testStage().append(wrap);

        const baseActive = window.__gfx?.active?.() ?? 0;
        let g = null;
        let lostOk = false;
        let restoredOk = false;
        let cv2d = null;
        try {
          if (glSupported) {
            g = new ElementGL(cv, {
              fragment: FOIL_FRAG,
              attributes: { alpha: false, preserveDrawingBuffer: true },
              onLost: () => {
                lostOk = true;
                plain.hidden = false;
                plain.append(card);
              },
              onRestored: () => {
                restoredOk = true;
                g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                plain.hidden = true;
                cv.append(card);
              },
            });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            await nextPaint(cv);
            g.begin([0.04, 0.05, 0.08, 1]);
            g.upload(card);

            const lostEv = new Event('webglcontextlost', { cancelable: true });
            cv.dispatchEvent(lostEv);
            const inPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(card) && inp.value === 'PATRON 09';

            cv.dispatchEvent(new Event('webglcontextrestored'));
            let texAfter = null;
            cv.addEventListener('paint', () => {
              g.begin([0.04, 0.05, 0.08, 1]);
              texAfter = g.upload(card);
            }, { once: true });
            await nextPaint(cv);
            const err = g.gl.getError();
            if (!inPlain || !restoredOk || g.lost || !cv.contains(card) || !texAfter?.w || err !== g.gl.NO_ERROR) {
              throw new Error(`GL recovery failed: inPlain=${inPlain}, restored=${restoredOk}, err=${err}`);
            }
          }

          // Clean 5-arg drawElementImage() 2D foil gradient blend check
          cv2d = document.createElement('canvas');
          cv2d.setAttribute('content', 'drawable');
          cv2d.setAttribute('layoutsubtree', '');
          cv2d.style.cssText = `position:relative;display:block;width:${W}px;height:${H}px;`;
          const card2d = document.createElement('div');
          card2d.setAttribute('drawable', '');
          card2d.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#101522;border:2px solid #a8b7d4;box-sizing:border-box;`;
          cv2d.append(card2d);
          testStage().append(cv2d);

          const c2 = cv2d.getContext('2d');
          cv2d.width = W;
          cv2d.height = H;
          await nextPaint(cv2d);
          c2.reset();
          c2.drawElementImage(card2d, 0, 0, W, H);

          const copy = document.createElement('canvas');
          copy.width = W;
          copy.height = H;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0);
          const beforeLuma = lumaOf(cc.getImageData(110, 70, 1, 1).data);

          const grad = c2.createLinearGradient(0, 0, W, H);
          grad.addColorStop(0, 'rgba(96, 224, 255, 0.15)');
          grad.addColorStop(0.5, 'rgba(255, 160, 232, 0.45)');
          grad.addColorStop(1, 'rgba(125, 255, 198, 0.15)');
          c2.save();
          c2.globalCompositeOperation = 'screen';
          c2.fillStyle = grad;
          c2.fillRect(0, 0, W, H);
          c2.restore();

          cc.clearRect(0, 0, W, H);
          cc.drawImage(cv2d, 0, 0);
          const afterPx = cc.getImageData(110, 70, 1, 1).data;
          const afterLuma = lumaOf(afterPx);

          return need(
            afterPx[3] > 200 && afterLuma > beforeLuma + 20,
            `glRestore=${glSupported ? restoredOk : 'skipped'}, 2dFoilLuma ${beforeLuma.toFixed(1)} -> ${afterLuma.toFixed(1)}.`
          );
        } finally {
          g?.dispose();
          wrap.remove();
          cv2d?.remove();
          window.__gfx?.active?.();
          window.__gfx?.retire?.(cv);
          if (cv2d) window.__gfx?.retire?.(cv2d);
          await sleep(230);
          window.__gfx?.release?.(cv);
          const deadline = performance.now() + 600;
          while ((window.__gfx?.active?.() ?? 0) > baseActive && performance.now() < deadline) {
            await sleep(80);
          }
        }
      },
    },
    stillDrawn(() => [
      {
        name: 'optical-sheen card stage',
        ink: async () => {
          if (state.mode === 'plain') return null;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          if (state.mode === 'webgl') {
            if (!stage || stage.lost || !stage.has(cardEl)) return 0;
            return state.uploads > 0 && state.paints > 0 ? 1 : 0;
          }
          return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
        },
        rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
      },
    ]),
  ]);
}

if (typeof document !== 'undefined' && document.getElementById('os-canvas')) {
  mountOpticalSheen();
}
