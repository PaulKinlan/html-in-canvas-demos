import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

export const BURN_DURATION_MS = 1150;

export const BURN_MODES = {
  warm: { id: 'warm', index: 0, label: 'Warm 35mm' },
  cyan: { id: 'cyan', index: 1, label: 'Prism cyan' },
  flash: { id: 'flash', index: 2, label: 'Flash cut' },
};

// #region burn-state
export function createBurnState(initialProgress = 0) {
  const p = clamp(initialProgress, 0, 1);
  return {
    progress: p,
    active: false,
    startMs: 0,
    durationMs: BURN_DURATION_MS,
    fromProgress: p,
    toProgress: p,
  };
}

export function triggerBurn(sim, tMs, targetProgress = null, durationMs = BURN_DURATION_MS) {
  const target = targetProgress === null
    ? (sim.progress < 0.5 ? 1 : 0)
    : clamp(targetProgress, 0, 1);
  const dist = Math.abs(target - sim.progress);
  sim.fromProgress = sim.progress;
  sim.toProgress = target;
  sim.startMs = tMs;
  sim.durationMs = Math.max(120, Math.round(durationMs * Math.max(0.28, dist)));
  sim.active = dist > 0.001;
  return sim.active;
}

export function setScrub(sim, progress) {
  const p = clamp(progress, 0, 1);
  sim.progress = p;
  sim.fromProgress = p;
  sim.toProgress = p;
  sim.active = false;
  return p;
}

export function stepBurn(sim, tMs, reduced = false) {
  if (!sim.active) return false;
  if (reduced) {
    sim.progress = sim.toProgress;
    sim.fromProgress = sim.toProgress;
    sim.active = false;
    return false;
  }
  const elapsed = Math.max(0, tMs - sim.startMs);
  const u = clamp(elapsed / Math.max(1, sim.durationMs), 0, 1);
  const eased = u < 0.5
    ? 4 * u * u * u
    : 1 - Math.pow(-2 * u + 2, 3) / 2;
  sim.progress = lerp(sim.fromProgress, sim.toProgress, eased);
  if (u >= 1) {
    sim.progress = sim.toProgress;
    sim.fromProgress = sim.toProgress;
    sim.active = false;
    return false;
  }
  return true;
}
// #endregion burn-state

// #region burn-shader
export const BURN_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;        // Scene A (Amber Film Slate UI), premultiplied
uniform sampler2D uTexB;       // Scene B (Cool Projection Deck UI), premultiplied
uniform vec2 uSize;            // CSS pixel dimensions
uniform float uTime;           // Seconds
uniform float uProgress;       // 0.0 (View A) .. 1.0 (View B)
uniform int uStyle;            // 0 = Warm 35mm, 1 = Prism cyan, 2 = Flash cut
uniform float uLeakIntensity;  // 0.0 .. 2.0
uniform vec2 uFlarePos;        // Normalized [0..1] pointer flare focal spot
uniform float uReduced;        // 1.0 freezes flicker and narrows dispersion

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = rot * p * 2.03 + vec2(13.7, 9.1);
    amp *= 0.5;
  }
  return sum;
}

vec4 sampleUnpremul(sampler2D tex, vec2 uv) {
  vec4 t = texture(tex, clamp(uv, vec2(0.001), vec2(0.999)));
  vec3 rgb = t.a > 0.003 ? clamp(t.rgb / t.a, 0.0, 1.0) : vec3(0.0);
  return vec4(rgb, t.a);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Sample DOM highlights around vUv from both texElementSubImage2D() textures for film halation.
vec3 sampleHalation(vec2 uv, float mixB, vec2 pxStep) {
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  const float GOLDEN = 2.39996323;
  for (int k = 0; k < 10; k++) {
    float fk = float(k);
    float ang = fk * GOLDEN;
    float r = 4.0 + 13.0 * sqrt((fk + 0.5) / 10.0);
    vec2 off = vec2(cos(ang), sin(ang)) * r * pxStep;
    vec4 sA = sampleUnpremul(uTex, uv + off);
    vec4 sB = sampleUnpremul(uTexB, uv + off);
    vec3 domRgb = mix(sA.rgb * sA.a, sB.rgb * sB.a, mixB);
    float peak = max(luma(domRgb), max(domRgb.r, max(domRgb.g, domRgb.b)) * 0.92);
    float mask = smoothstep(0.42, 0.90, peak);
    float w = mix(1.15, 0.65, r / 17.0);
    acc += domRgb * mask * w;
    wSum += w;
  }
  return acc / max(wSum, 0.001);
}

void main() {
  // Settle cleanly to 1:1 View A or View B at endpoints.
  if (uProgress <= 0.001) {
    outColor = texture(uTex, vUv);
    return;
  }
  if (uProgress >= 0.999) {
    outColor = texture(uTexB, vUv);
    return;
  }

  vec2 sz = max(uSize, vec2(1.0));
  vec2 asp = vec2(sz.x / sz.y, 1.0);
  vec2 p = vUv * asp;
  vec2 flareP = clamp(uFlarePos, vec2(0.05), vec2(0.95)) * asp;

  float tAnim = uReduced > 0.5 ? 0.0 : uTime * (uStyle == 2 ? 1.15 : 0.62);
  float nCoarse = fbm(p * 2.8 + vec2(tAnim * 0.28, -tAnim * 0.19));
  float nFine = fbm(p * 7.6 + vec2(-tAnim * 0.34, tAnim * 0.41) + nCoarse * 1.35);
  float nStreak = fbm(vec2(p.x * 1.9 + nCoarse * 0.85, p.y * 5.8 - tAnim * 0.25));
  float organic = uReduced > 0.5
    ? (nCoarse - 0.5) * 0.20 + (nFine - 0.5) * 0.08
    : (nCoarse - 0.5) * 0.36 + (nFine - 0.5) * 0.18 + (nStreak - 0.5) * 0.18;

  vec2 axis = uStyle == 2 ? normalize(vec2(0.92, -0.39)) : normalize(vec2(0.84, -0.54));
  float diag = dot(vUv - 0.5, axis) * 0.58 + 0.50;
  float distFlare = length(p - flareP) / max(length(asp), 0.001);
  float flarePull = (0.36 - distFlare) * 0.30;
  float field = diag - flarePull + organic;

  float front = mix(-0.34, 1.34, uProgress);
  float gap = front - field;
  float mixB = smoothstep(-0.075, 0.075, gap);

  float envelope = smoothstep(0.0, 0.05, uProgress) * smoothstep(1.0, 0.95, uProgress);
  float leakAmp = clamp(uLeakIntensity, 0.0, 2.0) * envelope;
  float frontGlow = exp(-pow(gap / 0.13, 2.0));
  float wideFlare = exp(-pow((gap - 0.02) / 0.28, 2.0));
  float hotspot = exp(-distFlare * (uStyle == 2 ? 2.6 : 3.8)) * envelope;

  // Prism chroma offset splitting RGB channels along the leading flare front.
  vec2 awayFlare = p - flareP;
  vec2 dispDir = length(awayFlare) > 0.004 ? normalize(awayFlare) : vec2(0.86, -0.50);
  float chromaDist = (0.009 + 0.026 * leakAmp) * frontGlow * (uReduced > 0.5 ? 0.25 : 1.0);

  vec4 aR = sampleUnpremul(uTex, vUv + dispDir * chromaDist * 1.15);
  vec4 aG = sampleUnpremul(uTex, vUv);
  vec4 aB = sampleUnpremul(uTex, vUv - dispDir * chromaDist * 1.25);
  vec3 colA = vec3(aR.r, aG.g, aB.b);
  float alphaA = max(aG.a, max(aR.a, aB.a) * 0.5);

  vec4 bR = sampleUnpremul(uTexB, vUv - dispDir * chromaDist * 0.95);
  vec4 bG = sampleUnpremul(uTexB, vUv);
  vec4 bB = sampleUnpremul(uTexB, vUv + dispDir * chromaDist * 1.10);
  vec3 colB = vec3(bR.r, bG.g, bB.b);
  float alphaB = max(bG.a, max(bR.a, bB.a) * 0.5);

  vec3 baseCol = mix(colA, colB, mixB);
  float outA = clamp(mix(alphaA, alphaB, mixB), 0.0, 1.0);

  // Dark film-gate scorch contrast right beside the overexposed burn front.
  float scorchBand = exp(-pow((abs(gap) - 0.085) / 0.042, 2.0)) * clamp(uLeakIntensity, 0.20, 1.6) * envelope;
  vec3 darkEmulsion = uStyle == 1 ? vec3(0.015, 0.028, 0.064) : vec3(0.036, 0.016, 0.012);
  baseCol = mix(baseCol, darkEmulsion, scorchBand * 0.65);

  vec3 leakMid;
  vec3 leakEdge;
  vec3 leakCore;
  float flashBurst = 0.0;

  if (uStyle == 1) {
    leakMid = vec3(0.08, 0.78, 1.00);
    leakEdge = vec3(0.46, 0.20, 1.00);
    leakCore = vec3(0.76, 0.96, 1.00);
  } else if (uStyle == 2) {
    leakMid = vec3(1.00, 0.64, 0.24);
    leakEdge = vec3(0.86, 0.26, 0.70);
    leakCore = vec3(1.00, 0.98, 0.92);
    flashBurst = pow(max(0.0, sin(3.14159265 * uProgress)), 1.35) * 0.72 * leakAmp;
  } else {
    leakMid = vec3(1.00, 0.38, 0.06);
    leakEdge = vec3(0.94, 0.14, 0.05);
    leakCore = vec3(1.00, 0.88, 0.54);
  }

  vec2 pxStep = 1.0 / sz;
  vec3 halationSrc = sampleHalation(vUv, mixB, pxStep);
  float halStr = dot(halationSrc, vec3(0.30, 0.50, 0.20));
  vec3 halationTint = mix(leakEdge, leakMid, smoothstep(0.15, 0.85, halStr));
  vec3 domHalation = (halationSrc * 0.48 + halationTint * halStr * 1.25) * (0.28 + 0.92 * wideFlare) * leakAmp;

  float flicker = uReduced > 0.5 ? 1.0 : (0.94 + 0.06 * sin(uTime * 11.0 + nCoarse * 6.0));
  float leakMask = (frontGlow * 0.95 + wideFlare * 0.42 + hotspot * 0.58) * (0.55 + 0.75 * nFine) * leakAmp * flicker;
  float coreMask = pow(frontGlow, 2.2) * (0.65 + 0.55 * nCoarse) * leakAmp;

  vec3 edgeGlow = mix(leakEdge, leakMid, smoothstep(0.18, 0.78, frontGlow + hotspot * 0.4));
  vec3 flareCol = edgeGlow * leakMask + leakCore * coreMask * 0.68 + domHalation + leakCore * flashBurst;

  vec3 sumCol = baseCol + flareCol;
  vec3 paperMapped = 1.0 - exp(-sumCol * 1.35);
  float bloomBlend = clamp(max(flareCol.r, max(flareCol.g, flareCol.b)) * 0.75, 0.0, 0.88);
  vec3 finalCol = clamp(mix(sumCol, paperMapped, bloomBlend), 0.0, 1.0);

  outColor = vec4(finalCol * outA, outA);
}`;
// #endregion burn-shader

// #region geometry-sync
export function syncSceneGeometry({
  canvasEl,
  sceneAEl,
  sceneBEl,
  progress,
  mode,
  cw,
  ch,
  unitCache,
  lastGeoKeyRef,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;

  const activeB = progress >= 0.5;
  sceneAEl.inert = activeB;
  sceneBEl.inert = !activeB;
  sceneAEl.style.pointerEvents = activeB ? 'none' : 'auto';
  sceneBEl.style.pointerEvents = activeB ? 'auto' : 'none';

  const key = `${mode}|${canvasEl.width}x${canvasEl.height}|${cw}x${ch}|${activeB ? 1 : 0}`;
  if (!force && lastGeoKeyRef.value === key) return;
  lastGeoKeyRef.value = key;

  const activeEl = activeB ? sceneBEl : sceneAEl;
  const inactiveEl = activeB ? sceneAEl : sceneBEl;

  if (mode === '2d') {
    if (OFFSTAGE) {
      canvasEl.updateElementGeometry(inactiveEl, { canvasTransform: OFFSTAGE });
    }
    sceneAEl.dataset.hitTick = sceneAEl.dataset.hitTick === '1' ? '0' : '1';
    sceneBEl.dataset.hitTick = sceneBEl.dataset.hitTick === '1' ? '0' : '1';
    return;
  }

  if (mode !== 'webgl') return;

  const zoom = activeEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${cw}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, activeEl, cw);
    unitCache.key = uKey;
  }
  const u = unitCache.unit;

  if (OFFSTAGE) {
    canvasEl.updateElementGeometry(inactiveEl, { canvasTransform: OFFSTAGE });
  }
  canvasEl.updateElementGeometry(activeEl, {
    canvasTransform: new DOMMatrix().scale(u, u),
  });
  sceneAEl.dataset.hitTick = sceneAEl.dataset.hitTick === '1' ? '0' : '1';
  sceneBEl.dataset.hitTick = sceneBEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

// #region fallback-2d
export function draw2DComposite(ctx, {
  sceneAEl,
  sceneBEl,
  cw,
  ch,
  progress,
  burnMode = 'warm',
  leakIntensity = 1.2,
  flareX = 0.68,
  flareY = 0.42,
}) {
  const p = clamp(progress, 0, 1);
  if (p <= 0.001) {
    ctx.drawElementImage(sceneAEl, 0, 0, cw, ch);
    return;
  }
  if (p >= 0.999) {
    ctx.drawElementImage(sceneBEl, 0, 0, cw, ch);
    return;
  }

  const fx = clamp(flareX, 0.05, 0.95) * cw;
  const fy = clamp(flareY, 0.05, 0.95) * ch;
  const maxR = Math.max(
    Math.hypot(fx, fy),
    Math.hypot(cw - fx, fy),
    Math.hypot(fx, ch - fy),
    Math.hypot(cw - fx, ch - fy)
  ) + 24;
  const wipeR = p * maxR;
  const activeB = p >= 0.5;

  // Draw the inactive scene first and the active scene last so 2D hit-testing stays on the active view.
  if (!activeB) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(fx, fy, wipeR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawElementImage(sceneBEl, 0, 0, cw, ch);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.arc(fx, fy, wipeR, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
    ctx.drawElementImage(sceneAEl, 0, 0, cw, ch);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.arc(fx, fy, wipeR, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
    ctx.drawElementImage(sceneAEl, 0, 0, cw, ch);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(fx, fy, wipeR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawElementImage(sceneBEl, 0, 0, cw, ch);
    ctx.restore();
  }

  if (leakIntensity > 0.02) {
    const env = Math.sin(Math.PI * p);
    const alpha = clamp(0.45 * leakIntensity * env, 0, 0.88);
    const band = Math.max(18, 42 * clamp(leakIntensity, 0.3, 1.5));
    const g = ctx.createRadialGradient(fx, fy, Math.max(0, wipeR - band), fx, fy, wipeR + band);
    if (burnMode === 'cyan') {
      g.addColorStop(0, 'rgba(90, 50, 255, 0)');
      g.addColorStop(0.46, `rgba(40, 212, 255, ${alpha.toFixed(3)})`);
      g.addColorStop(0.54, `rgba(220, 252, 255, ${(alpha * 0.95).toFixed(3)})`);
      g.addColorStop(1, 'rgba(10, 40, 80, 0)');
    } else if (burnMode === 'flash') {
      g.addColorStop(0, 'rgba(255, 160, 70, 0)');
      g.addColorStop(0.45, `rgba(255, 224, 150, ${alpha.toFixed(3)})`);
      g.addColorStop(0.55, `rgba(255, 252, 240, ${Math.min(0.95, alpha * 1.1).toFixed(3)})`);
      g.addColorStop(1, 'rgba(200, 60, 140, 0)');
    } else {
      g.addColorStop(0, 'rgba(210, 32, 12, 0)');
      g.addColorStop(0.45, `rgba(255, 118, 28, ${alpha.toFixed(3)})`);
      g.addColorStop(0.54, `rgba(255, 232, 162, ${(alpha * 0.95).toFixed(3)})`);
      g.addColorStop(1, 'rgba(30, 14, 10, 0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }
}
// #endregion fallback-2d

export function mountPrismBurn() {
  banner();

  const stageBox = document.getElementById('pr-stage');
  const viewportEl = document.getElementById('pr-viewport');
  let canvas = document.getElementById('pr-canvas');
  const sceneA = document.getElementById('pr-scene-a');
  const sceneB = document.getElementById('pr-scene-b');
  const plainHost = document.getElementById('plain-host');
  const noticeEl = document.getElementById('pr-notice');
  const statusEl = document.getElementById('pr-status');
  const testsBody = document.getElementById('tests');

  // Interactive controls inside Scene A (Amber Film Slate UI)
  const slateInput = document.getElementById('slate-cue-input');
  const slateTakeReadout = document.getElementById('slate-take-readout');
  const slateLampPill = document.getElementById('slate-lamp-pill');
  const btnSlateMark = document.getElementById('btn-slate-mark');
  const btnSlateStrobe = document.getElementById('btn-slate-strobe');
  const btnToB = document.getElementById('btn-to-b');

  // Interactive controls inside Scene B (Cool Projection Deck UI)
  const deckInput = document.getElementById('deck-cue-input');
  const deckMarkReadout = document.getElementById('deck-mark-readout');
  const deckXenonPill = document.getElementById('deck-xenon-pill');
  const btnDeckMark = document.getElementById('btn-deck-mark');
  const btnDeckShutter = document.getElementById('btn-deck-shutter');
  const btnToA = document.getElementById('btn-to-a');

  // External controls
  const triggerBtn = document.getElementById('btn-trigger-burn');
  const modeButtons = Array.from(document.querySelectorAll('#burn-modes button[data-mode]'));
  const progressSlider = document.getElementById('ctl-progress');
  const progressOut = document.getElementById('out-progress');
  const intensitySlider = document.getElementById('ctl-intensity');
  const intensityOut = document.getElementById('out-intensity');
  const reducedToggle = document.getElementById('ctl-reduced');

  const reducedQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  if (reducedQuery.matches) reducedToggle.checked = true;

  const sim = createBurnState(0);
  const state = {
    mode: 'init', // 'webgl' | '2d' | 'plain'
    burnMode: 'warm',
    leakIntensity: Number(intensitySlider.value),
    flareX: 0.68,
    flareY: 0.42,
    slateTakes: 4,
    slateLamp: true,
    deckMarks: 1,
    deckXenon: true,
    reducedOverride: reducedToggle.checked,
    hasPainted: false,
    onScreen: true,
    uploads: 0,
    paints: 0,
    rafId: 0,
    lastStatusMs: -1000,
    flareDrag: null,
    focusTargetOnSettle: null,
    unitCache: { key: '', unit: 1 },
    lastGeoKeyRef: { value: '' },
  };

  let stage = null;
  let ctx2d = null;
  const viewTextures = new Map();

  const isReducedMotion = () => state.reducedOverride || reducedQuery.matches;

  function showNotice(msg) {
    noticeEl.hidden = !msg;
    noticeEl.textContent = msg || '';
  }

  function getViewportSize() {
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 356);
    const ch = Math.max(120, canvas.clientHeight || viewportEl.clientHeight || 356);
    return { cw, ch };
  }

  function syncSceneSizes(cw, ch) {
    if (state.mode === 'plain') {
      sceneA.style.width = '';
      sceneA.style.height = '';
      sceneB.style.width = '';
      sceneB.style.height = '';
      return;
    }
    const sw = `${cw}px`;
    const sh = `${ch}px`;
    for (const el of [sceneA, sceneB]) {
      if (el.style.width !== sw) el.style.width = sw;
      if (el.style.height !== sh) el.style.height = sh;
    }
  }

  function syncInSceneUI() {
    slateTakeReadout.textContent = `TAKE ${String(state.slateTakes).padStart(2, '0')}`;
    slateLampPill.textContent = state.slateLamp ? 'TUNGSTEN 3200K' : 'LAMP DIM';
    slateLampPill.classList.toggle('is-hot', state.slateLamp);
    btnSlateStrobe.setAttribute('aria-pressed', String(state.slateLamp));
    btnSlateStrobe.textContent = state.slateLamp ? 'Cue lamp: ON' : 'Cue lamp: OFF';

    deckMarkReadout.textContent = `MARKS ${String(state.deckMarks).padStart(2, '0')}`;
    deckXenonPill.textContent = state.deckXenon ? 'XENON 5600K' : 'DOUSER SHUT';
    deckXenonPill.classList.toggle('is-hot', state.deckXenon);
    btnDeckShutter.setAttribute('aria-pressed', String(state.deckXenon));
    btnDeckShutter.textContent = state.deckXenon ? 'Douser: OPEN' : 'Douser: SHUT';
  }

  function updateExternalUI() {
    const pct = Math.round(sim.progress * 100);
    if (Number(progressSlider.value) !== pct) progressSlider.value = String(pct);
    progressOut.textContent = `${pct}%`;
    intensityOut.textContent = `${state.leakIntensity.toFixed(2)}×`;
    triggerBtn.textContent = sim.progress < 0.5 ? 'Burn to View B' : 'Burn to View A';
    for (const btn of modeButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.burnMode));
    }
  }

  function updateStatus(force = false) {
    const now = performance.now();
    if (!force && now - state.lastStatusMs < 110) return;
    state.lastStatusMs = now;
    const routeLabel = state.mode === 'webgl'
      ? 'WebGL 2 ElementGL'
      : state.mode === '2d'
        ? '2D drawElementImage()'
        : 'Plain HTML';
    const modeLabel = BURN_MODES[state.burnMode].label;
    const pct = Math.round(sim.progress * 100);
    const sceneLabel = pct === 0 ? 'View A (1:1)' : pct === 100 ? 'View B (1:1)' : `${pct}% burn`;
    const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
    const fx = Math.round(state.flareX * 100);
    const fy = Math.round(state.flareY * 100);
    statusEl.textContent =
      `${routeLabel} · ${modeLabel} · ${sceneLabel} · flare (${fx}%, ${fy}%) · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
  }

  function tryUploadScene(el) {
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

  // #region paint-pipeline
  function renderWebGL(changedSet = null) {
    if (!state.hasPainted || !stage || stage.lost) return;
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);

    // Always call stage.begin() BEFORE stage.upload() so backing store sizing matches CSS box.
    if (!stage.begin([0.03, 0.025, 0.025, 1.0])) return;

    if (changedSet) {
      for (const el of [sceneA, sceneB]) {
        if (changedSet.has(el) || !viewTextures.has(el)) tryUploadScene(el);
      }
    } else {
      if (!viewTextures.has(sceneA)) tryUploadScene(sceneA);
      if (!viewTextures.has(sceneB)) tryUploadScene(sceneB);
    }

    const texA = viewTextures.get(sceneA);
    const texB = viewTextures.get(sceneB);
    if (!texA || !texB) return;

    const styleIdx = BURN_MODES[state.burnMode]?.index ?? 0;
    stage.quad(sceneA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB.tex);
      gl.uniform1i(loc('uTexB'), 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(loc('uProgress'), sim.progress);
      gl.uniform1i(loc('uStyle'), styleIdx);
      gl.uniform1f(loc('uLeakIntensity'), state.leakIntensity);
      gl.uniform2f(loc('uFlarePos'), state.flareX, state.flareY);
      gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1.0 : 0.0);
    });

    syncSceneGeometry({
      canvasEl: canvas,
      sceneAEl: sceneA,
      sceneBEl: sceneB,
      progress: sim.progress,
      mode: state.mode,
      cw,
      ch,
      unitCache: state.unitCache,
      lastGeoKeyRef: state.lastGeoKeyRef,
    });

    state.paints++;
    updateStatus(state.paints === 1);
  }
  // #endregion paint-pipeline

  function render2DFallback() {
    if (!state.hasPainted || !ctx2d) return;
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);

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

    draw2DComposite(ctx2d, {
      sceneAEl: sceneA,
      sceneBEl: sceneB,
      cw,
      ch,
      progress: sim.progress,
      burnMode: state.burnMode,
      leakIntensity: state.leakIntensity,
      flareX: state.flareX,
      flareY: state.flareY,
    });

    ctx2d.restore();
    syncSceneGeometry({
      canvasEl: canvas,
      sceneAEl: sceneA,
      sceneBEl: sceneB,
      progress: sim.progress,
      mode: state.mode,
      cw,
      ch,
      unitCache: state.unitCache,
      lastGeoKeyRef: state.lastGeoKeyRef,
    });

    state.paints++;
    updateStatus(state.paints === 1);
  }

  function enterPlainFallback(reason) {
    state.mode = 'plain';
    stopLoop();
    stageBox.classList.add('is-plain');
    for (const el of [sceneA, sceneB]) {
      if (el.parentElement !== plainHost) plainHost.append(el);
    }
    syncSceneSizes(0, 0);
    const activeB = sim.progress >= 0.5;
    sceneA.dataset.active = String(!activeB);
    sceneB.dataset.active = String(activeB);
    sceneA.inert = activeB;
    sceneB.inert = !activeB;
    sceneA.style.pointerEvents = activeB ? 'none' : 'auto';
    sceneB.style.pointerEvents = activeB ? 'auto' : 'none';
    showNotice(reason);
    updateExternalUI();
    updateStatus(true);
  }

  function exitPlainFallback() {
    stageBox.classList.remove('is-plain');
    for (const el of [sceneB, sceneA]) {
      delete el.dataset.active;
      if (el.parentElement !== canvas) canvas.append(el);
    }
    showNotice('');
  }

  function needsLoop() {
    if (!state.onScreen || document.hidden || state.mode === 'plain') return false;
    if (sim.active) return true;
    return !isReducedMotion() && state.mode === 'webgl' && sim.progress > 0.001 && sim.progress < 0.999 && state.leakIntensity > 0.01;
  }

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function startLoop() {
    if (state.rafId || !needsLoop()) return;
    state.rafId = requestAnimationFrame(tick);
  }

  function drawCurrentFrame() {
    if (state.mode === 'plain') {
      const activeB = sim.progress >= 0.5;
      sceneA.dataset.active = String(!activeB);
      sceneB.dataset.active = String(activeB);
      sceneA.inert = activeB;
      sceneB.inert = !activeB;
      sceneA.style.pointerEvents = activeB ? 'none' : 'auto';
      sceneB.style.pointerEvents = activeB ? 'auto' : 'none';
      updateStatus(true);
      return;
    }
    if (!state.hasPainted) {
      canvas.requestPaint?.();
      return;
    }
    if (state.mode === 'webgl') renderWebGL(null);
    else if (state.mode === '2d') render2DFallback();
  }

  function tick(now) {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.mode === 'plain') return;

    const wasActive = sim.active;
    stepBurn(sim, now, isReducedMotion());
    updateExternalUI();
    drawCurrentFrame();

    if (wasActive && !sim.active) {
      updateStatus(true);
      if (state.focusTargetOnSettle) {
        const targetBtn = state.focusTargetOnSettle;
        state.focusTargetOnSettle = null;
        requestAnimationFrame(() => targetBtn.focus({ preventScroll: true }));
      }
    }

    if (needsLoop()) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function launchBurn(targetProgress = null, focusTarget = null) {
    state.focusTargetOnSettle = focusTarget;
    if (isReducedMotion() || state.mode === 'plain') {
      const target = targetProgress === null
        ? (sim.progress < 0.5 ? 1 : 0)
        : clamp(targetProgress, 0, 1);
      setScrub(sim, target);
      stopLoop();
      updateExternalUI();
      drawCurrentFrame();
      updateStatus(true);
      if (state.focusTargetOnSettle) {
        const el = state.focusTargetOnSettle;
        state.focusTargetOnSettle = null;
        requestAnimationFrame(() => el.focus({ preventScroll: true }));
      }
      return;
    }
    triggerBurn(sim, performance.now(), targetProgress);
    updateExternalUI();
    drawCurrentFrame();
    startLoop();
  }

  function wireCanvasEvents(cv) {
    cv.addEventListener('paint', (e) => {
      state.hasPainted = true;
      const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
      if (state.mode === 'webgl' && stage && !stage.lost) {
        renderWebGL(changed);
      } else if (state.mode === '2d' && ctx2d) {
        render2DFallback();
      }
      startLoop();
    });
    cv.addEventListener('contextlost', (e) => {
      e.preventDefault();
      if (state.mode === '2d') {
        enterPlainFallback('The 2D canvas context was lost. Showing the active scene in plain HTML.');
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
    const routeParam = new URLSearchParams(location.search).get('route');
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);
    syncInSceneUI();
    updateExternalUI();

    if (routeParam === 'plain') {
      enterPlainFallback('Plain HTML route requested via ?route=plain.');
      return;
    }

    if (routeParam !== '2d' && hicSupported && glSupported) {
      try {
        stage = new ElementGL(canvas, {
          fragment: BURN_FRAG,
          attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
          onLost: () => {
            viewTextures.clear();
            stopLoop();
            enterPlainFallback('WebGL 2 context was lost. Moved the live scenes to plain HTML until restored.');
          },
          onRestored: () => {
            viewTextures.clear();
            stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            state.mode = 'webgl';
            state.hasPainted = false;
            state.unitCache.key = '';
            state.lastGeoKeyRef.value = '';
            exitPlainFallback();
            const size = getViewportSize();
            syncSceneSizes(size.cw, size.ch);
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
        fresh.id = 'pr-canvas';
        fresh.setAttribute('content', 'drawable');
        fresh.setAttribute('layoutsubtree', '');
        fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
        fresh.append(sceneB, sceneA);
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
          showNotice(
            routeParam === '2d'
              ? 'Using the 5-argument 2D drawElementImage() fallback via ?route=2d.'
              : 'WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() fallback.'
          );
        }
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      }
    }

    enterPlainFallback('HTML-in-canvas is not available in this browser, so the scenes are shown as plain HTML.');
  }

  // Selection guard on stage (inputs keep user-select: text)
  viewportEl.addEventListener('selectstart', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });

  // Pointer flare positioning across viewport
  function setFlareFromClient(clientX, clientY) {
    const r = viewportEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    state.flareX = clamp((clientX - r.left) / r.width, 0.06, 0.94);
    state.flareY = clamp((clientY - r.top) / r.height, 0.08, 0.92);
    drawCurrentFrame();
    updateStatus(true);
  }

  viewportEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, input, textarea, select, label, a')) return;
    window.getSelection?.()?.removeAllRanges?.();
    state.flareDrag = {
      id: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      locked: e.pointerType === 'mouse',
    };
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      try { viewportEl.setPointerCapture?.(e.pointerId); } catch {}
    }
    setFlareFromClient(e.clientX, e.clientY);
  });

  viewportEl.addEventListener('pointermove', (e) => {
    if (state.flareDrag && e.pointerId === state.flareDrag.id) {
      const dx = e.clientX - state.flareDrag.startX;
      const dy = e.clientY - state.flareDrag.startY;
      if (!state.flareDrag.locked) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          state.flareDrag = null;
          return;
        }
        if (Math.hypot(dx, dy) > 6) {
          state.flareDrag.locked = true;
          try { viewportEl.setPointerCapture?.(e.pointerId); } catch {}
        }
      }
      if (state.flareDrag.locked) {
        if (e.cancelable) e.preventDefault();
        setFlareFromClient(e.clientX, e.clientY);
      }
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons === 0 && sim.progress > 0.001 && sim.progress < 0.999) {
      if (!e.target.closest('button, input, textarea')) {
        setFlareFromClient(e.clientX, e.clientY);
      }
    }
  });

  const endFlareDrag = (e) => {
    if (!state.flareDrag || e.pointerId !== state.flareDrag.id) return;
    state.flareDrag = null;
    try { viewportEl.releasePointerCapture?.(e.pointerId); } catch {}
  };
  viewportEl.addEventListener('pointerup', endFlareDrag);
  viewportEl.addEventListener('pointercancel', endFlareDrag);

  // Scene A interactions
  slateInput.addEventListener('input', () => {
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnSlateMark.addEventListener('click', () => {
    state.slateTakes++;
    syncInSceneUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnSlateStrobe.addEventListener('click', () => {
    state.slateLamp = !state.slateLamp;
    syncInSceneUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnToB.addEventListener('click', (e) => {
    launchBurn(1, e.detail === 0 ? btnToA : null);
  });

  // Scene B interactions
  deckInput.addEventListener('input', () => {
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnDeckMark.addEventListener('click', () => {
    state.deckMarks++;
    syncInSceneUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnDeckShutter.addEventListener('click', () => {
    state.deckXenon = !state.deckXenon;
    syncInSceneUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnToA.addEventListener('click', (e) => {
    launchBurn(0, e.detail === 0 ? btnToB : null);
  });

  // External controls
  triggerBtn.addEventListener('click', () => {
    launchBurn(null, null);
  });

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      if (!BURN_MODES[m] || m === state.burnMode) return;
      state.burnMode = m;
      updateExternalUI();
      drawCurrentFrame();
      updateStatus(true);
    });
  }

  progressSlider.addEventListener('input', () => {
    stopLoop();
    setScrub(sim, Number(progressSlider.value) / 100);
    updateExternalUI();
    drawCurrentFrame();
    updateStatus(true);
    startLoop();
  });

  intensitySlider.addEventListener('input', () => {
    state.leakIntensity = Number(intensitySlider.value);
    updateExternalUI();
    drawCurrentFrame();
    updateStatus(true);
    startLoop();
  });

  reducedToggle.addEventListener('change', () => {
    state.reducedOverride = reducedToggle.checked;
    if (isReducedMotion()) {
      stopLoop();
      if (sim.active) {
        setScrub(sim, sim.toProgress);
        updateExternalUI();
      }
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
      stopLoop();
      if (sim.active) {
        setScrub(sim, sim.toProgress);
        updateExternalUI();
      }
    }
    drawCurrentFrame();
    startLoop();
  });

  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) {
      stopLoop();
    } else if (state.mode !== 'plain' && state.hasPainted) {
      drawCurrentFrame();
      startLoop();
    }
  }, { rootMargin: '80px 0px' }).observe(stageBox);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (state.onScreen && state.mode !== 'plain' && state.hasPainted) {
      drawCurrentFrame();
      startLoop();
    }
  });

  new ResizeObserver(() => {
    if (state.mode === 'plain') return;
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);
    state.unitCache.key = '';
    state.lastGeoKeyRef.value = '';
    if (state.hasPainted) canvas.requestPaint?.();
  }).observe(viewportEl);

  initBackend();

  // ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------

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
    const px = new Uint8Array(4);
    const rx = clamp(Math.floor(cssX * (cv.width / Math.max(1, w))), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * (cv.height / Math.max(1, h))), 0, Math.max(0, cv.height - 1));
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  function makeDualFixture(w, h, htmlA, htmlB) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    cv.innerHTML = htmlB + htmlA;
    testStage().append(cv);
    const fixB = cv.children[0];
    const fixA = cv.children[1];
    return { cv, fixA, fixB };
  }

  const tests = [
    {
      name: 'Dual-scene ElementGL upload via texElementSubImage2D() and explicit tMs progression (glErr === 0)',
      expect: 'pass',
      why: 'Uploads two isolated drawable scenes inside one paint-gated ElementGL fixture with stage.begin() before stage.upload() and UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, verifying gl.getError() === 0 and explicit tMs burn progression.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 240;
        const H = 160;
        const { cv, fixA, fixB } = makeDualFixture(
          W,
          H,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#26160b;color:#ffd98a;padding:12px;box-sizing:border-box;">SLATE A</div>`,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#091a2e;color:#8ff0ff;padding:12px;box-sizing:border-box;">DECK B</div>`
        );
        let g = null;
        let hasPainted = false;
        let texA = null;
        let texB = null;
        try {
          g = new ElementGL(cv, { fragment: BURN_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPainted = true;
            if (!g.begin([0, 0, 0, 1])) return;
            texA = g.upload(fixA);
            texB = g.upload(fixB);
          }, { once: true });
          await nextPaint(cv);
          if (!hasPainted || !texA || !texB) throw new Error('paint event did not upload both scenes');

          const simTest = createBurnState(0);
          triggerBurn(simTest, 1000, 1, 1000);
          stepBurn(simTest, 1000, false);
          const p0 = simTest.progress;
          stepBurn(simTest, 1480, false);
          const pMid = simTest.progress;
          stepBurn(simTest, 2050, false);
          const pEnd = simTest.progress;

          const simReduced = createBurnState(0);
          triggerBurn(simReduced, 1000, 1, 1000);
          const activeAfterReduced = stepBurn(simReduced, 1001, true);

          g.begin([0, 0, 0, 1]);
          g.quad(fixA, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, texB.tex);
            gl.uniform1i(loc('uTexB'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1f(loc('uProgress'), pMid);
            gl.uniform1i(loc('uStyle'), 0);
            gl.uniform1f(loc('uLeakIntensity'), 1.25);
            gl.uniform2f(loc('uFlarePos'), 0.55, 0.45);
            gl.uniform1f(loc('uReduced'), 0.0);
          });
          const glErr = g.gl.getError();

          return need(
            glErr === g.gl.NO_ERROR && texA.w > 0 && texB.w > 0 && p0 === 0 && pMid > 0.3 && pMid < 0.7 && pEnd === 1 && !activeAfterReduced && simReduced.progress === 1,
            `glErr=${glErr}, texA=${texA.w}×${texA.h}, texB=${texB.w}×${texB.h}, tMs(1000->1480->2050)=${p0.toFixed(2)}->${pMid.toFixed(2)}->${pEnd.toFixed(2)}, reducedSnap=${simReduced.progress}.`
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
      name: 'Mid-burn 48% overexposure bloom and Warm 35mm vs Prism cyan R/B ratio flip',
      expect: 'pass',
      why: 'Renders neutral dark scenes with a bright white highlight bar at 48% progress, measuring overexposure bloom above the intensity=0 baseline and checking that Warm 35mm emits R > B while Prism cyan flips to B > R.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 260;
        const H = 160;
        const neutralHtml = `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#121418;display:flex;align-items:center;justify-content:center;"><div style="width:90px;height:26px;background:#ffffff;border-radius:4px;"></div></div>`;
        const { cv, fixA, fixB } = makeDualFixture(W, H, neutralHtml, neutralHtml);
        let g = null;
        let hasPainted = false;
        let texA = null;
        let texB = null;
        try {
          g = new ElementGL(cv, { fragment: BURN_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPainted = true;
            if (!g.begin([0, 0, 0, 1])) return;
            texA = g.upload(fixA);
            texB = g.upload(fixB);
          }, { once: true });
          await nextPaint(cv);
          if (!hasPainted || !texA || !texB) throw new Error('fixture upload failed');

          const drawCase = (styleIdx, leakIntensity) => {
            g.begin([0, 0, 0, 1]);
            g.quad(fixA, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, texB.tex);
              gl.uniform1i(loc('uTexB'), 1);
              gl.activeTexture(gl.TEXTURE0);
              gl.uniform1f(loc('uProgress'), 0.48);
              gl.uniform1i(loc('uStyle'), styleIdx);
              gl.uniform1f(loc('uLeakIntensity'), leakIntensity);
              gl.uniform2f(loc('uFlarePos'), 0.5, 0.5);
              gl.uniform1f(loc('uReduced'), 1.0);
            });
          };

          const sampleBand = () => {
            let sumR = 0;
            let sumB = 0;
            let maxLum = 0;
            let n = 0;
            // Sample dark backdrop rows just above the white badge across the flare seam
            for (let i = 0; i < 20; i++) {
              const x = W * (0.20 + (0.60 * i) / 19);
              const px = readCssPx(g.gl, cv, W, H, x, 38);
              sumR += px[0];
              sumB += px[2];
              const lum = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
              if (lum > maxLum) maxLum = lum;
              n++;
            }
            return { meanR: sumR / n, meanB: sumB / n, maxLum };
          };

          drawCase(0, 0.0);
          const base = sampleBand();

          drawCase(0, 1.45);
          const warm = sampleBand();

          drawCase(1, 1.45);
          const cyan = sampleBand();
          const glErr = g.gl.getError();

          const warmBloom = warm.maxLum > base.maxLum + 60;
          const cyanBloom = cyan.maxLum > base.maxLum + 60;
          const warmDomR = warm.meanR > warm.meanB + 40;
          const cyanDomB = cyan.meanB > cyan.meanR + 40;

          return need(
            glErr === g.gl.NO_ERROR && warmBloom && cyanBloom && warmDomR && cyanDomB,
            `baseMaxLum=${base.maxLum.toFixed(0)}, Warm 35mm R=${warm.meanR.toFixed(0)}/B=${warm.meanB.toFixed(0)} (maxLum=${warm.maxLum.toFixed(0)}), Prism cyan R=${cyan.meanR.toFixed(0)}/B=${cyan.meanB.toFixed(0)} (maxLum=${cyan.maxLum.toFixed(0)}).`
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
      name: 'Endpoints settle cleanly to 1:1 View A (0%) and 1:1 View B (100%)',
      expect: 'pass',
      why: 'Samples centre pixels of solid warm Amber Scene A and cool Cyan Scene B at progress = 0.0 and progress = 1.0 with leakIntensity = 1.6, verifying zero residual flare or cross-scene bleed.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 220;
        const H = 140;
        const { cv, fixA, fixB } = makeDualFixture(
          W,
          H,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#d87818;"></div>`,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#1888d8;"></div>`
        );
        let g = null;
        let hasPainted = false;
        let texA = null;
        let texB = null;
        try {
          g = new ElementGL(cv, { fragment: BURN_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPainted = true;
            if (!g.begin([0, 0, 0, 1])) return;
            texA = g.upload(fixA);
            texB = g.upload(fixB);
          }, { once: true });
          await nextPaint(cv);
          if (!hasPainted || !texA || !texB) throw new Error('fixture upload failed');

          const renderAt = (prog) => {
            g.begin([0, 0, 0, 1]);
            g.quad(fixA, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, texB.tex);
              gl.uniform1i(loc('uTexB'), 1);
              gl.activeTexture(gl.TEXTURE0);
              gl.uniform1f(loc('uProgress'), prog);
              gl.uniform1i(loc('uStyle'), 0);
              gl.uniform1f(loc('uLeakIntensity'), 1.6);
              gl.uniform2f(loc('uFlarePos'), 0.5, 0.5);
              gl.uniform1f(loc('uReduced'), 0.0);
            });
            return readCssPx(g.gl, cv, W, H, W * 0.5, H * 0.5);
          };

          const pxA = renderAt(0.0);
          const pxB = renderAt(1.0);
          const glErr = g.gl.getError();

          const okA = pxA[0] > 190 && pxA[1] > 95 && pxA[1] < 145 && pxA[2] < 45;
          const okB = pxB[2] > 190 && pxB[1] > 110 && pxB[1] < 160 && pxB[0] < 45;
          return need(
            glErr === g.gl.NO_ERROR && okA && okB,
            `0% rgb(${pxA[0]},${pxA[1]},${pxA[2]}), 100% rgb(${pxB[0]},${pxB[1]},${pxB[2]}), glErr=${glErr}.`
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
      name: 'Hit-testing switches between View A and View B at 0% and 100% via updateElementGeometry()',
      expect: 'pass',
      why: 'Overlaps Scene A and Scene B buttons at the same viewport coordinates and runs syncSceneGeometry() at 0% and 100%, verifying elementsFromPoint() hits only the active button.',
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available.');
        }
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 260;
        const H = 160;
        const { cv, fixA, fixB } = makeDualFixture(
          W,
          H,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#26160b;">` +
          '<button type="button" id="fx-btn-a" style="position:absolute;left:60px;top:58px;width:140px;height:44px;background:#ffb03b;color:#1a1006;border:0;border-radius:8px;font:700 13px system-ui;">Cue A</button></div>',
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#091a2e;">` +
          '<button type="button" id="fx-btn-b" style="position:absolute;left:60px;top:58px;width:140px;height:44px;background:#38d6ff;color:#031726;border:0;border-radius:8px;font:700 13px system-ui;">Cue B</button></div>'
        );
        const btnA = fixA.querySelector('#fx-btn-a');
        const btnB = fixB.querySelector('#fx-btn-b');
        let g = null;
        let hasPainted = false;
        let texA = null;
        let texB = null;
        try {
          const modeType = glSupported ? 'webgl' : '2d';
          if (glSupported) {
            g = new ElementGL(cv, { fragment: BURN_FRAG });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.addEventListener('paint', () => {
              hasPainted = true;
              if (!g.begin([0, 0, 0, 1])) return;
              texA = g.upload(fixA);
              texB = g.upload(fixB);
            }, { once: true });
          } else {
            cv.width = W;
            cv.height = H;
            cv.getContext('2d');
          }
          await nextPaint(cv);
          if (g && (!hasPainted || !texA || !texB)) throw new Error('fixture upload failed');

          const unitCache = { key: '', unit: 1 };
          const lastGeoKeyRef = { value: '' };

          const drawAt = (prog) => {
            if (g) {
              g.begin([0, 0, 0, 1]);
              g.quad(fixA, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, texB.tex);
                gl.uniform1i(loc('uTexB'), 1);
                gl.activeTexture(gl.TEXTURE0);
                gl.uniform1f(loc('uProgress'), prog);
              });
            } else {
              const c2 = cv.getContext('2d');
              c2.reset();
              draw2DComposite(c2, { sceneAEl: fixA, sceneBEl: fixB, cw: W, ch: H, progress: prog });
            }
            syncSceneGeometry({
              canvasEl: cv,
              sceneAEl: fixA,
              sceneBEl: fixB,
              progress: prog,
              mode: modeType,
              cw: W,
              ch: H,
              unitCache,
              lastGeoKeyRef,
              force: true,
            });
          };

          drawAt(0.0);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const r0 = cv.getBoundingClientRect();
          const hit0 = document.elementsFromPoint(r0.left + 130, r0.top + 80);
          const inert0A = fixA.inert;
          const inert0B = fixB.inert;

          drawAt(1.0);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const r1 = cv.getBoundingClientRect();
          const hit1 = document.elementsFromPoint(r1.left + 130, r1.top + 80);
          const inert1A = fixA.inert;
          const inert1B = fixB.inert;

          const ok0 = hit0.includes(btnA) && !hit0.includes(btnB) && !inert0A && inert0B;
          const ok1 = hit1.includes(btnB) && !hit1.includes(btnA) && !inert1B && inert1A;
          return need(
            ok0 && ok1,
            `at 0%: hitA=${hit0.includes(btnA)}, hitB=${hit0.includes(btnB)}, inertA=${inert0A}, inertB=${inert0B}; at 100%: hitA=${hit1.includes(btnA)}, hitB=${hit1.includes(btnB)}, inertA=${inert1A}, inertB=${inert1B}.`
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
      name: 'Synthetic webglcontextlost recovery plus 5-argument 2D drawElementImage() fallback',
      expect: 'pass',
      why: 'Tests cancelable webglcontextlost and webglcontextrestored without loseContext(), then runs draw2DComposite() at 48% on a plain 2D drawable fixture (copied into a willReadFrequently off-DOM canvas to verify ink).',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 200;
        const H = 130;

        // Part A: synthetic webglcontextlost + webglcontextrestored
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        plain.hidden = true;
        const { cv, fixA, fixB } = makeDualFixture(
          W,
          H,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#d87818;">A</div>`,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#1888d8;">B</div>`
        );
        wrap.append(cv, plain);
        testStage().append(wrap);

        let g = null;
        let lostFired = false;
        let restoredFired = false;
        let hasPainted = false;
        let texA = null;
        let texB = null;
        let inPlain = false;
        let glErr = -1;
        try {
          g = new ElementGL(cv, {
            fragment: BURN_FRAG,
            onLost: () => {
              lostFired = true;
              plain.hidden = false;
              plain.append(fixA, fixB);
            },
            onRestored: () => {
              restoredFired = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              plain.hidden = true;
              cv.append(fixB, fixA);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          const onPaint = () => {
            hasPainted = true;
            if (!g.begin([0, 0, 0, 1])) return;
            texA = g.upload(fixA);
            texB = g.upload(fixB);
          };
          cv.addEventListener('paint', onPaint);
          await nextPaint(cv);
          if (!hasPainted || !texA || !texB) throw new Error('initial paint upload failed');

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          inPlain = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(fixA) && plain.contains(fixB);

          hasPainted = false;
          cv.dispatchEvent(new Event('webglcontextrestored'));
          await nextPaint(cv);
          g.begin([0, 0, 0, 1]);
          g.quad(fixA, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, texB.tex);
            gl.uniform1i(loc('uTexB'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1f(loc('uProgress'), 0.48);
          });
          glErr = g.gl.getError();
          cv.removeEventListener('paint', onPaint);
        } finally {
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }

        // Part B: 5-argument 2D drawElementImage() fallback verified through a plain copy canvas
        const { cv: cv2, fixA: f2A, fixB: f2B } = makeDualFixture(
          W,
          H,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#d87818;">A</div>`,
          `<div drawable style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#1888d8;">B</div>`
        );
        try {
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2.width = Math.round(W * dpr);
          cv2.height = Math.round(H * dpr);
          const ctx = cv2.getContext('2d');
          let painted2d = false;
          cv2.addEventListener('paint', () => {
            painted2d = true;
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw2DComposite(ctx, {
              sceneAEl: f2A,
              sceneBEl: f2B,
              cw: W,
              ch: H,
              progress: 0.48,
              burnMode: 'warm',
              leakIntensity: 1.2,
              flareX: 0.5,
              flareY: 0.5,
            });
            ctx.restore();
          }, { once: true });
          await nextPaint(cv2);

          const copy = document.createElement('canvas');
          copy.width = cv2.width;
          copy.height = cv2.height;
          const copyCtx = copy.getContext('2d', { willReadFrequently: true });
          copyCtx.drawImage(cv2, 0, 0);
          const leftPx = copyCtx.getImageData(Math.round(cv2.width * 0.12), Math.round(cv2.height * 0.5), 1, 1).data;
          const midPx = copyCtx.getImageData(Math.round(cv2.width * 0.5), Math.round(cv2.height * 0.5), 1, 1).data;

          return need(
            inPlain && restoredFired && glErr === 0 && painted2d && leftPx[3] > 200 && midPx[3] > 200,
            `inPlain=${inPlain}, restored=${restoredFired}, glErr=${glErr}, 2dLeft=[${Array.from(leftPx)}], 2dMid=[${Array.from(midPx)}].`
          );
        } finally {
          cv2.remove();
          window.__gfx?.retire?.(cv2);
          await settleGfx(baseActive);
        }
      },
    },
    stillDrawn(() => [
      {
        name: 'prism burn stage',
        ink: async () => {
          if (state.mode === 'plain') return null;
          if (state.mode === 'webgl') {
            if (!stage || stage.lost || !viewTextures.has(sceneA) || !viewTextures.has(sceneB)) return 0;
            const mp = (canvas.width * canvas.height) / 1e6;
            if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
            return state.paints > 0 ? 1 : 0;
          }
          return canvas.width > 0 && canvas.height > 0 && state.paints > 0 ? 1 : 0;
        },
        rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
      },
    ]),
  ];

  runTests(testsBody, tests);
}

if (typeof document !== 'undefined' && document.getElementById('pr-canvas')) {
  mountPrismBurn();
}
