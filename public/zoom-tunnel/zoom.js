import { banner, nextPaint, runTests, stillDrawn, supported as api2dSupported, testStage } from '/shared/support.js';
import { ElementGL, supported as elGlSupported } from '/lib/element-gl.js';
import { cssZoom, geometryUnit } from '/lib/surface.js';

banner();

const DEFAULT_FOCAL_X = 0.85;
const DEFAULT_FOCAL_Y = 0.16;
const TRANSITION_MS = 1050;
const LOOP_DWELL_MS = 850;
const LOOP_SWEEP_MS = 1350;

const canvas = document.getElementById('zt-canvas');
const viewportEl = document.getElementById('zt-viewport');
const plainHost = document.getElementById('plain-host');
const sceneA = document.getElementById('zt-scene-a');
const sceneB = document.getElementById('zt-scene-b');
const reticleBtn = document.getElementById('zt-reticle');
const reticleTag = document.getElementById('zt-reticle-tag');
const hudEl = document.getElementById('zt-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests');

// Live DOM controls inside Scene A & Scene B
const inputA = document.getElementById('zt-input-a');
const btnAGrade = document.getElementById('zt-btn-a-grade');
const btnAMark = document.getElementById('zt-btn-a-mark');
const btnAPunch = document.getElementById('zt-btn-a-punch');
const markCountEl = document.getElementById('zt-mark-count');

const inputB = document.getElementById('zt-input-b');
const btnBLut = document.getElementById('zt-btn-b-lut');
const btnBCue = document.getElementById('zt-btn-b-cue');
const btnBPull = document.getElementById('zt-btn-b-pull');
const cueCountEl = document.getElementById('zt-cue-count');

// External NLE toolbar controls
const btnPunch = document.getElementById('btn-punch');
const btnPull = document.getElementById('btn-pull');
const btnLoop = document.getElementById('btn-loop');
const btnDirIn = document.getElementById('btn-dir-in');
const btnDirOut = document.getElementById('btn-dir-out');
const ctlReduced = document.getElementById('ctl-reduced');
const ctlScrub = document.getElementById('ctl-scrub');
const outScrub = document.getElementById('out-scrub');
const ctlStrength = document.getElementById('ctl-strength');
const outStrength = document.getElementById('out-strength');

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------- Hyperbolic Tunnel Optics, Timestamp Helper & Hit Geometry ----------------

// #region tunnel-math
/**
 * Compute optical warp parameters for a given progress in [0, 1], strength,
 * direction ('in' | 'out'), and normalised focal anchor (focalX, focalY).
 */
export function computeZoomTunnelState({
  progress = 0,
  strength = 1.0,
  direction = 'in',
  focalX = DEFAULT_FOCAL_X,
  focalY = DEFAULT_FOCAL_Y,
}) {
  const p = clamp(progress, 0, 1);
  const s = clamp(strength, 0.2, 2.0);
  const dirSign = direction === 'out' ? -1 : 1;
  const fx = clamp(focalX, 0.08, 0.92);
  const fy = clamp(focalY, 0.08, 0.92);

  if (p <= 0.0005) {
    return {
      progress: 0,
      velocity: 0,
      scaleA: 1,
      scaleB: 1 + 1.35 + 1.25 * s,
      barrelA: 0,
      barrelB: 0.32 + 0.36 * s,
      blurSpread: 0,
      dispersion: 0,
      mixB: 0,
      focalX: fx,
      focalY: fy,
      direction: dirSign > 0 ? 'in' : 'out',
    };
  }
  if (p >= 0.9995) {
    return {
      progress: 1,
      velocity: 0,
      scaleA: dirSign > 0 ? 1 + (2.6 * s) / 0.18 : 1 / (1 + (2.8 * s) / 0.55),
      scaleB: 1,
      barrelA: dirSign > 0 ? 0.42 + 0.55 * s : -(0.28 + 0.36 * s),
      barrelB: 0,
      blurSpread: 0,
      dispersion: 0,
      mixB: 1,
      focalX: fx,
      focalY: fy,
      direction: dirSign > 0 ? 'in' : 'out',
    };
  }

  const velocity = Math.pow(Math.sin(Math.PI * p), 1.12);
  const smooth = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  let scaleA;
  let barrelA;
  if (dirSign > 0) {
    const pA = clamp(p * 1.15, 0, 0.92);
    scaleA = 1.0 + (2.6 * s * p * p) / Math.max(1.0 - pA * 0.82, 0.18);
    barrelA = (0.42 + 0.55 * s) * smooth(0, 0.65, p);
  } else {
    scaleA = 1.0 / (1.0 + (2.8 * s * Math.pow(p, 1.25)) / Math.max(1.0 - p * 0.45, 0.35));
    barrelA = -(0.28 + 0.36 * s) * smooth(0, 0.65, p);
  }

  const invP = 1.0 - p;
  const scaleB = 1.0 + (1.35 + 1.25 * s) * Math.pow(invP, 1.85);
  const barrelB = (0.32 + 0.36 * s) * smooth(1.0, 0.30, p);
  const mixB = smooth(0.24, 0.76, p);

  return {
    progress: p,
    velocity,
    scaleA,
    scaleB,
    barrelA,
    barrelB,
    blurSpread: velocity * s,
    dispersion: velocity * (0.015 + 0.028 * s),
    mixB,
    focalX: fx,
    focalY: fy,
    direction: dirSign > 0 ? 'in' : 'out',
  };
}

/**
 * Explicit timestamp helper for NLE transition stepping.
 * Clamps overshoot timestamps before startMs or past startMs + durMs cleanly to [from, to].
 */
export function stepZoomTransition(anim, tMs, reducedMotion = false) {
  if (!anim) return { progress: 0, settled: true };
  if (reducedMotion || anim.durMs <= 0) {
    return { progress: clamp(anim.to, 0, 1), settled: true };
  }
  const raw = (tMs - anim.startMs) / anim.durMs;
  const u = clamp(raw, 0, 1);
  const eased = u < 0.5
    ? 4 * u * u * u
    : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const progress = clamp(anim.from + (anim.to - anim.from) * eased, 0, 1);
  return { progress, settled: u >= 1 };
}

const unitCache = new WeakMap();

export function cachedGeometryUnit(targetCanvas, targetEl) {
  const ew = targetEl.offsetWidth || targetCanvas.clientWidth || 360;
  const zoom = cssZoom(targetEl);
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${ew}/${zoom}`;
  const prev = unitCache.get(targetCanvas);
  if (prev && prev.key === key) return prev.unit;
  const unit = geometryUnit(targetCanvas, targetEl, ew);
  unitCache.set(targetCanvas, { key, unit, geoVals: new WeakMap() });
  return unit;
}

function setElementGeometry(targetCanvas, el, active) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !OFFSTAGE) return;
  const unit = cachedGeometryUnit(targetCanvas, el);
  const target = active ? new DOMMatrix().scale(unit, unit, 1) : OFFSTAGE;
  const vals = target.toFloat32Array();
  const entry = unitCache.get(targetCanvas);
  const prevVals = entry?.geoVals?.get(el);
  if (prevVals && vals.every((v, i) => Math.abs(v - prevVals[i]) < 1e-4)) return;
  entry?.geoVals?.set(el, vals);
  targetCanvas.updateElementGeometry(el, { canvasTransform: target });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

export function syncSceneGeometry({
  targetCanvas = canvas,
  elA = sceneA,
  elB = sceneB,
  progress = 0,
  animating = false,
  dragging = false,
  mode = 'webgl',
} = {}) {
  const settledA = progress <= 0.005 && !animating && !dragging;
  const settledB = progress >= 0.995 && !animating && !dragging;

  elA.inert = !settledA;
  elB.inert = !settledB;
  if (settledA) elA.removeAttribute('aria-hidden');
  else elA.setAttribute('aria-hidden', 'true');
  if (settledB) elB.removeAttribute('aria-hidden');
  else elB.setAttribute('aria-hidden', 'true');

  const peA = settledA ? 'auto' : 'none';
  const peB = settledB ? 'auto' : 'none';
  if (elA.style.pointerEvents !== peA) elA.style.pointerEvents = peA;
  if (elB.style.pointerEvents !== peB) elB.style.pointerEvents = peB;

  if (mode === 'plain') return;
  setElementGeometry(targetCanvas, elA, settledA);
  setElementGeometry(targetCanvas, elB, settledB);
}
// #endregion tunnel-math

// ---------------- WebGL 2 Radial Zoom-Blur & Dispersion Shader ----------------

// #region tunnel-shader
export const ZOOM_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uTexB;
uniform vec2 uSize;
uniform vec2 uCanvasSize;
uniform float uTime;
uniform float uProgress;
uniform float uStrength;
uniform float uDirection;
uniform vec2 uFocal;
uniform float uReduced;
uniform float uShowReticle;

in vec2 vUv;
out vec4 outColor;

vec4 sampleScene(sampler2D tex, vec2 uv) {
  vec2 inBounds = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float inside = inBounds.x * inBounds.y;
  vec2 mUv = abs(mod(uv - 1.0, 2.0) - 1.0);
  vec4 s = texture(tex, clamp(mUv, vec2(0.001), vec2(0.999)));
  if (inside < 0.5) {
    vec2 over = max(vec2(0.0) - uv, uv - vec2(1.0));
    float fade = exp(-length(over) * 2.8) * 0.52;
    s.rgb *= fade;
  }
  return s;
}

vec2 warpUv(vec2 delta, float scale, float barrel, float r) {
  float bTerm = max(0.25, 1.0 + barrel * r * r);
  return uFocal + delta / (max(scale, 0.08) * bTerm);
}

vec4 sampleRadialTunnel(
  sampler2D tex,
  vec2 delta,
  vec2 aspect,
  float scale,
  float barrel,
  float r,
  float vel,
  float dirSign,
  float dispAmt,
  float strength
) {
  float blurGain = vel * strength * (0.04 + 0.34 * r);
  if (uReduced > 0.5) blurGain *= 0.25;

  vec4 accum = vec4(0.0);
  float wSum = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = float(i) / 15.0;
    float radialFactor = 1.0 - dirSign * (t - 0.18) * blurGain;
    vec2 tapDelta = delta * max(0.08, radialFactor);
    float tapR = length(tapDelta * aspect);
    vec2 uvBase = warpUv(tapDelta, scale, barrel, tapR);

    vec2 caVec = delta * dispAmt * (0.45 + 0.75 * t);
    vec4 sG = sampleScene(tex, uvBase);
    float sR = sampleScene(tex, uvBase + caVec).r;
    float sB = sampleScene(tex, uvBase - caVec).b;

    float w = 1.0 - 0.55 * t;
    vec3 rgb = clamp(vec3(sR, sG.g, sB), vec3(0.0), vec3(sG.a));
    accum += vec4(rgb, sG.a) * w;
    wSum += w;
  }
  return accum / max(wSum, 0.001);
}

vec3 applyReticle(vec3 col, vec2 uv) {
  if (uShowReticle < 0.5) return col;
  vec2 px = (uv - uFocal) * uCanvasSize;
  float dist = length(px);
  float tickA = smoothstep(1.2, 0.3, abs(px.y)) * step(24.0, abs(px.x)) * step(abs(px.x), 34.0);
  float tickB = smoothstep(1.2, 0.3, abs(px.x)) * step(24.0, abs(px.y)) * step(abs(px.y), 34.0);
  float centerDot = smoothstep(2.4, 0.8, dist);
  float ink = max(max(tickA, tickB) * 0.78, centerDot * 0.65);
  if (ink <= 0.001) return col;
  vec3 tint = mix(vec3(0.95, 0.45, 0.24), vec3(0.22, 0.74, 0.97), clamp(uProgress, 0.0, 1.0));
  return mix(col, tint, ink * 0.78);
}

void main() {
  float p = clamp(uProgress, 0.0, 1.0);
  vec2 uv = clamp(vUv, vec2(0.0), vec2(1.0));

  if (p <= 0.0005) {
    vec4 texA = texture(uTex, uv);
    outColor = vec4(applyReticle(texA.rgb, uv), texA.a);
    return;
  }
  if (p >= 0.9995) {
    vec4 texB = texture(uTexB, uv);
    outColor = vec4(applyReticle(texB.rgb, uv), texB.a);
    return;
  }

  float S = clamp(uStrength, 0.2, 2.0);
  float vel = pow(sin(3.14159265 * p), 1.12);
  vec2 aspect = vec2(uCanvasSize.x / max(uCanvasSize.y, 1.0), 1.0);
  vec2 delta = uv - uFocal;
  float r = length(delta * aspect);

  float scaleA;
  float barrelA;
  if (uDirection > 0.0) {
    float pA = clamp(p * 1.15, 0.0, 0.92);
    scaleA = 1.0 + (2.6 * S * p * p) / max(1.0 - pA * 0.82, 0.18);
    barrelA = (0.42 + 0.55 * S) * smoothstep(0.0, 0.65, p);
  } else {
    scaleA = 1.0 / (1.0 + (2.8 * S * pow(p, 1.25)) / max(1.0 - p * 0.45, 0.35));
    barrelA = -(0.28 + 0.36 * S) * smoothstep(0.0, 0.65, p);
  }

  float invP = 1.0 - p;
  float scaleB = 1.0 + (1.35 + 1.25 * S) * pow(invP, 1.85);
  float barrelB = (0.32 + 0.36 * S) * smoothstep(1.0, 0.30, p);
  float mixB = smoothstep(0.24, 0.76, p);
  float dispAmt = vel * (0.015 + 0.028 * S) * (uReduced > 0.5 ? 0.25 : 1.0);

  vec4 colA = mixB < 0.995
    ? sampleRadialTunnel(uTex, delta, aspect, scaleA, barrelA, r, vel, uDirection, dispAmt, S)
    : vec4(0.0);
  vec4 colB = mixB > 0.005
    ? sampleRadialTunnel(uTexB, delta, aspect, scaleB, barrelB, r, vel, -1.0, dispAmt * 0.85, S)
    : vec4(0.0);

  vec4 mixed = mix(colA, colB, mixB);
  float glowEnv = vel * S * (uReduced > 0.5 ? 0.22 : 1.0);
  float streakTint = smoothstep(0.10, 0.90, r) * glowEnv;
  vec3 warmCool = mix(vec3(1.0, 0.50, 0.20), vec3(0.22, 0.78, 1.0), mixB);
  vec3 finalRgb = mixed.rgb + warmCool * (streakTint * 0.11 * mixed.a);
  float vig = 1.0 - smoothstep(0.36, 1.25, r) * glowEnv * 0.32;
  finalRgb = clamp(finalRgb * clamp(vig, 0.58, 1.0), vec3(0.0), vec3(mixed.a));

  outColor = vec4(applyReticle(finalRgb, uv), mixed.a);
}`;
// #endregion tunnel-shader

// ---------------- State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  progress: 0,
  strength: Number(ctlStrength.value) || 1.0,
  direction: 'in', // 'in' | 'out'
  focalX: DEFAULT_FOCAL_X,
  focalY: DEFAULT_FOCAL_Y,
  autoLoop: false,
  loopClockMs: 0,
  anim: null,
  draggingReticle: false,
  dragPointerId: null,
  grade: 'warm',
  lut: 'tungsten',
  marks: 1,
  cues: 1,
  onScreen: true,
  hasPainted: false,
  dirtyA: true,
  dirtyB: true,
  texUploaded: false,
  uploads: 0,
  paints: 0,
  needsDraw: true,
  lastStageSizeKey: '',
};

let stage = null;
let ctx2d = null;
let anisoExt = null;
let maxAniso = 1;
let rafId = 0;
let lastTickMs = performance.now();

function isReducedMotion() {
  return Boolean(ctlReduced.checked || reducedQuery?.matches);
}

function viewportCssSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 360);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 420);
  return { cw, ch };
}

function syncSceneBoxSizes(cw, ch) {
  if (state.backend === 'plain') {
    if (sceneA.style.width) sceneA.style.width = '';
    if (sceneA.style.height) sceneA.style.height = '';
    if (sceneB.style.width) sceneB.style.width = '';
    if (sceneB.style.height) sceneB.style.height = '';
    return;
  }
  const key = `${cw}x${ch}`;
  if (key === state.lastStageSizeKey) return;
  state.lastStageSizeKey = key;
  const w = `${cw}px`;
  const h = `${ch}px`;
  if (sceneA.style.width !== w) sceneA.style.width = w;
  if (sceneA.style.height !== h) sceneA.style.height = h;
  if (sceneB.style.width !== w) sceneB.style.width = w;
  if (sceneB.style.height !== h) sceneB.style.height = h;
  state.dirtyA = true;
  state.dirtyB = true;
}

function syncControlsUI(metrics) {
  const pct = Math.round(state.progress * 100);
  if (Number(ctlScrub.value) !== pct) ctlScrub.value = String(pct);
  outScrub.textContent = `${pct}%`;
  outStrength.textContent = `${state.strength.toFixed(2)}x`;

  btnLoop.setAttribute('aria-pressed', String(state.autoLoop && !isReducedMotion()));
  btnDirIn.setAttribute('aria-pressed', String(state.direction === 'in'));
  btnDirOut.setAttribute('aria-pressed', String(state.direction === 'out'));

  const fxPct = Math.round(state.focalX * 100);
  const fyPct = Math.round(state.focalY * 100);
  reticleBtn.style.left = `${(state.focalX * 100).toFixed(2)}%`;
  reticleBtn.style.top = `${(state.focalY * 100).toFixed(2)}%`;
  reticleBtn.dataset.view = state.progress >= 0.5 ? 'b' : 'a';
  reticleTag.textContent = `${fxPct}%, ${fyPct}%`;

  const m = metrics || computeZoomTunnelState({
    progress: state.progress,
    strength: state.strength,
    direction: state.direction,
    focalX: state.focalX,
    focalY: state.focalY,
  });
  const mp = state.backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const dirLabel = state.direction === 'in' ? 'zoom in' : 'pull out';
  hudEl.textContent =
    `${state.backend} · ${pct}% (${dirLabel}) · focal ${fxPct}%,${fyPct}% · scaleA ${m.scaleA.toFixed(2)}x · scaleB ${m.scaleB.toFixed(2)}x · ${mp} MP`;
}

// ---------------- Upload, Render & Fallbacks ----------------

// #region paint-upload
function uploadScene(el) {
  if (!stage || stage.lost || !state.hasPainted) return null;
  try {
    const t = stage.upload(el);
    if (!t) return null;
    const gl = stage.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (anisoExt) {
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    state.uploads++;
    return t;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return null;
    }
    throw err;
  }
}

const sceneTextures = new Map();

function renderWebGL() {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = viewportCssSize();
  syncSceneBoxSizes(cw, ch);

  // Call stage.begin() before stage.upload() so the canvas backing store matches DPR first.
  if (!stage.begin([0.02, 0.03, 0.05, 1])) return;

  if (state.dirtyA || !stage.has(sceneA) || !sceneTextures.has(sceneA)) {
    const tA = uploadScene(sceneA);
    if (tA) {
      sceneTextures.set(sceneA, tA);
      state.dirtyA = false;
    }
  }
  if (state.dirtyB || !stage.has(sceneB) || !sceneTextures.has(sceneB)) {
    const tB = uploadScene(sceneB);
    if (tB) {
      sceneTextures.set(sceneB, tB);
      state.dirtyB = false;
    }
  }

  const tA = sceneTextures.get(sceneA);
  const tB = sceneTextures.get(sceneB);
  if (!tA || !tB) return;
  state.texUploaded = true;

  const metrics = computeZoomTunnelState({
    progress: state.progress,
    strength: state.strength,
    direction: state.direction,
    focalX: state.focalX,
    focalY: state.focalY,
  });

  stage.quad(sceneA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tB.tex);
    gl.uniform1i(u('uTexB'), 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform2f(u('uCanvasSize'), cw, ch);
    gl.uniform1f(u('uProgress'), metrics.progress);
    gl.uniform1f(u('uStrength'), state.strength);
    gl.uniform1f(u('uDirection'), state.direction === 'out' ? -1.0 : 1.0);
    gl.uniform2f(u('uFocal'), metrics.focalX, metrics.focalY);
    gl.uniform1f(u('uReduced'), isReducedMotion() ? 1.0 : 0.0);
    gl.uniform1f(u('uShowReticle'), 1.0);
  });

  syncSceneGeometry({
    targetCanvas: canvas,
    elA: sceneA,
    elB: sceneB,
    progress: state.progress,
    animating: Boolean(state.anim || (state.autoLoop && !isReducedMotion())),
    dragging: state.draggingReticle,
    mode: state.backend,
  });
  syncControlsUI(metrics);
}

function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = viewportCssSize();
  syncSceneBoxSizes(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const m = computeZoomTunnelState({
    progress: state.progress,
    strength: state.strength,
    direction: state.direction,
    focalX: state.focalX,
    focalY: state.focalY,
  });

  const fxPx = m.focalX * cw;
  const fyPx = m.focalY * ch;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#070b13';
  ctx2d.fillRect(0, 0, cw, ch);

  if (m.mixB < 0.995) {
    ctx2d.save();
    ctx2d.globalAlpha = 1 - m.mixB;
    const wA = cw * m.scaleA;
    const hA = ch * m.scaleA;
    const xA = fxPx - m.focalX * wA;
    const yA = fyPx - m.focalY * hA;
    try {
      ctx2d.drawElementImage(sceneA, xA, yA, wA, hA);
    } catch {}
    ctx2d.restore();
  }

  if (m.mixB > 0.005) {
    ctx2d.save();
    ctx2d.globalAlpha = m.mixB;
    const wB = cw * m.scaleB;
    const hB = ch * m.scaleB;
    const xB = fxPx - m.focalX * wB;
    const yB = fyPx - m.focalY * hB;
    try {
      ctx2d.drawElementImage(sceneB, xB, yB, wB, hB);
    } catch {}
    ctx2d.restore();
  }

  if (m.velocity > 0.02) {
    ctx2d.save();
    ctx2d.strokeStyle = `rgba(255, 140, 66, ${(m.velocity * 0.35).toFixed(3)})`;
    ctx2d.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r0 = 26;
      const r1 = Math.max(cw, ch) * 0.8;
      ctx2d.beginPath();
      ctx2d.moveTo(fxPx + Math.cos(a) * r0, fyPx + Math.sin(a) * r0);
      ctx2d.lineTo(fxPx + Math.cos(a) * r1, fyPx + Math.sin(a) * r1);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  ctx2d.restore();

  syncSceneGeometry({
    targetCanvas: canvas,
    elA: sceneA,
    elB: sceneB,
    progress: state.progress,
    animating: Boolean(state.anim || (state.autoLoop && !isReducedMotion())),
    dragging: state.draggingReticle,
    mode: state.backend,
  });
  syncControlsUI(m);
  state.texUploaded = true;
}

export function attachContextLossController({
  targetCanvas,
  targetViewport,
  targetElements,
  targetPlainHost,
  onPlain,
  onRestore,
}) {
  const onLost = (e) => {
    e.preventDefault();
    for (const el of targetElements) {
      el.inert = false;
      el.removeAttribute('aria-hidden');
      el.style.pointerEvents = 'auto';
      if (el.parentElement !== targetPlainHost) targetPlainHost.append(el);
    }
    targetPlainHost.hidden = false;
    if (targetViewport) targetViewport.hidden = true;
    onPlain?.('Context lost; showing Editorial Shot A and Night Deck Shot B as plain HTML until restored.');
  };
  const onRestored = () => {
    for (const el of targetElements) {
      if (el.parentElement !== targetCanvas) targetCanvas.append(el);
    }
    targetPlainHost.hidden = true;
    if (targetViewport) targetViewport.hidden = false;
    onRestore?.();
  };
  targetCanvas.addEventListener('webglcontextlost', onLost);
  targetCanvas.addEventListener('contextlost', onLost);
  targetCanvas.addEventListener('webglcontextrestored', onRestored);
  targetCanvas.addEventListener('contextrestored', onRestored);
}

function showPlainFallback(reason) {
  state.backend = 'plain';
  state.autoLoop = false;
  state.anim = null;
  for (const el of [sceneA, sceneB]) {
    el.inert = false;
    el.removeAttribute('aria-hidden');
    el.style.pointerEvents = 'auto';
    if (el.parentElement !== plainHost) plainHost.append(el);
  }
  syncSceneBoxSizes(0, 0);
  plainHost.hidden = false;
  viewportEl.hidden = true;
  routeNoteEl.textContent = reason;
  syncControlsUI();
}
// #endregion paint-upload

// ---------------- Loop & Lifecycle ----------------

function requestRender() {
  state.needsDraw = true;
  if (state.backend === 'plain') {
    syncControlsUI();
    return;
  }
  if (!rafId && state.onScreen && !document.hidden) {
    lastTickMs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function loopProgressAt(clockMs) {
  const seg1 = LOOP_DWELL_MS;
  const seg2 = seg1 + LOOP_SWEEP_MS;
  const seg3 = seg2 + LOOP_DWELL_MS;
  const cycle = seg3 + LOOP_SWEEP_MS;
  const t = ((clockMs % cycle) + cycle) % cycle;
  if (t < seg1) return 0;
  if (t < seg2) {
    const u = (t - seg1) / LOOP_SWEEP_MS;
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  if (t < seg3) return 1;
  const u = (t - seg3) / LOOP_SWEEP_MS;
  const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  return 1 - e;
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;
  const dtMs = Math.min(50, Math.max(1, now - lastTickMs));
  lastTickMs = now;

  let keepGoing = false;
  const reduced = isReducedMotion();

  if (state.anim) {
    const stepped = stepZoomTransition(state.anim, now, reduced);
    state.progress = stepped.progress;
    state.needsDraw = true;
    if (stepped.settled) state.anim = null;
    else keepGoing = true;
  } else if (state.autoLoop && !state.draggingReticle && !reduced) {
    state.loopClockMs += dtMs;
    state.progress = loopProgressAt(state.loopClockMs);
    state.needsDraw = true;
    keepGoing = true;
  }

  if (state.needsDraw && state.hasPainted) {
    state.needsDraw = false;
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
  }

  if (keepGoing) rafId = requestAnimationFrame(tick);
}

function initBackend() {
  attachContextLossController({
    targetCanvas: canvas,
    targetViewport: viewportEl,
    targetElements: [sceneA, sceneB],
    targetPlainHost: plainHost,
    onPlain: (msg) => {
      state.backend = 'plain';
      state.autoLoop = false;
      state.anim = null;
      state.texUploaded = false;
      sceneTextures.clear();
      syncSceneBoxSizes(0, 0);
      routeNoteEl.textContent = msg;
      syncControlsUI();
    },
    onRestore: () => {
      if (stage && !stage.lost) {
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.backend = 'webgl';
        state.hasPainted = false;
        state.dirtyA = true;
        state.dirtyB = true;
        sceneTextures.clear();
        unitCache.delete(canvas);
        state.lastStageSizeKey = '';
        routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL canvas.';
        canvas.requestPaint?.();
        requestRender();
      } else if (ctx2d) {
        state.backend = '2d';
        state.hasPainted = false;
        unitCache.delete(canvas);
        state.lastStageSizeKey = '';
        canvas.requestPaint?.();
        requestRender();
      }
    },
  });

  if (elGlSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: ZOOM_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' },
        onLost: () => {
          state.texUploaded = false;
          state.hasPainted = false;
          state.dirtyA = true;
          state.dirtyB = true;
          sceneTextures.clear();
        },
        onRestored: () => {
          const gl = stage.gl;
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
          maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
          state.hasPainted = false;
          state.dirtyA = true;
          state.dirtyB = true;
          sceneTextures.clear();
          unitCache.delete(canvas);
          canvas.requestPaint?.();
          requestRender();
        },
      });
      const gl = stage.gl;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
      maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
      state.backend = 'webgl';
      routeNoteEl.textContent = `Running on WebGL 2 via one ElementGL context (${anisoExt ? `${maxAniso}x anisotropic mipmaps` : 'trilinear mipmaps'}, premultiplied alpha).`;
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back.`;
    }
  }

  if (state.backend === 'none' && api2dSupported) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; running the 2D five-argument drawElementImage() fallback.';
    }
  }

  if (state.backend === 'none') {
    showPlainFallback('HTML-in-canvas is not available in this browser, so both scenes are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', (e) => {
    state.hasPainted = true;
    state.paints++;
    const changed = e?.changedElements;
    if (!changed || !changed.length) {
      state.dirtyA = true;
      state.dirtyB = true;
    } else {
      for (const el of changed) {
        if (el === sceneA || sceneA.contains(el)) state.dirtyA = true;
        if (el === sceneB || sceneB.contains(el)) state.dirtyB = true;
      }
    }
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      unitCache.delete(canvas);
      state.lastStageSizeKey = '';
      requestRender();
    }).observe(canvas);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      state.onScreen = entries.some((e) => e.isIntersecting);
      if (state.onScreen) requestRender();
    }, { rootMargin: '120px' }).observe(viewportEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.onScreen) requestRender();
  });

  const { cw, ch } = viewportCssSize();
  syncSceneBoxSizes(cw, ch);
  canvas.requestPaint?.();
  requestRender();
}

// ---------------- Interactive Controls ----------------

function triggerTransition(targetProgress) {
  state.autoLoop = false;
  let from = state.progress;
  if (targetProgress >= 0.99 && from >= 0.98) from = 0;
  if (targetProgress <= 0.01 && from <= 0.02) from = 1;

  if (isReducedMotion() || state.backend === 'plain') {
    state.anim = null;
    state.progress = targetProgress;
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
    else syncControlsUI();
    return;
  }
  state.anim = {
    from,
    to: targetProgress,
    startMs: performance.now(),
    durMs: TRANSITION_MS,
  };
  requestRender();
}

btnPunch.addEventListener('click', () => triggerTransition(1));
btnPull.addEventListener('click', () => triggerTransition(0));
btnAPunch.addEventListener('click', () => triggerTransition(1));
btnBPull.addEventListener('click', () => triggerTransition(0));

btnLoop.addEventListener('click', () => {
  if (isReducedMotion()) {
    state.autoLoop = false;
    routeNoteEl.textContent = 'Auto loop stays paused while Reduced motion is on. Drag the focal anchor or scrub Transition.';
    syncControlsUI();
    return;
  }
  state.anim = null;
  state.autoLoop = !state.autoLoop;
  if (state.autoLoop) {
    state.loopClockMs = state.progress > 0.5 ? LOOP_DWELL_MS + LOOP_SWEEP_MS : LOOP_DWELL_MS;
  }
  requestRender();
});

function setDirection(dir) {
  state.direction = dir === 'out' ? 'out' : 'in';
  requestRender();
}

btnDirIn.addEventListener('click', () => setDirection('in'));
btnDirOut.addEventListener('click', () => setDirection('out'));

ctlScrub.addEventListener('input', () => {
  state.autoLoop = false;
  state.anim = null;
  state.progress = clamp(Number(ctlScrub.value) / 100, 0, 1);
  requestRender();
});

ctlStrength.addEventListener('input', () => {
  state.strength = clamp(Number(ctlStrength.value), 0.3, 1.6);
  requestRender();
});

function applyReducedMotionState() {
  if (isReducedMotion()) {
    state.autoLoop = false;
    if (state.anim) {
      state.progress = state.anim.to;
      state.anim = null;
    }
  }
  requestRender();
}

if (reducedQuery) {
  ctlReduced.checked = reducedQuery.matches;
  reducedQuery.addEventListener('change', () => {
    ctlReduced.checked = reducedQuery.matches;
    applyReducedMotionState();
  });
}
ctlReduced.addEventListener('change', applyReducedMotionState);

// Prevent accidental desktop text selection while dragging the reticle or stage
viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

function updateFocalFromClientPoint(clientX, clientY) {
  const rect = viewportEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  state.focalX = clamp((clientX - rect.left) / rect.width, 0.08, 0.92);
  state.focalY = clamp((clientY - rect.top) / rect.height, 0.08, 0.92);
  requestRender();
}

function beginFocalDrag(e) {
  if (state.backend === 'plain') return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const fromReticle = e.target === reticleBtn || reticleBtn.contains(e.target);
  if (!fromReticle && e.target instanceof Element && e.target.closest('button, input, textarea, select, a, label')) {
    return;
  }
  state.autoLoop = false;
  state.anim = null;
  state.draggingReticle = true;
  state.dragPointerId = e.pointerId;
  reticleBtn.classList.add('is-dragging');
  try { viewportEl.setPointerCapture(e.pointerId); } catch {}
  updateFocalFromClientPoint(e.clientX, e.clientY);
}

reticleBtn.addEventListener('pointerdown', beginFocalDrag);
canvas.addEventListener('pointerdown', beginFocalDrag);

viewportEl.addEventListener('pointermove', (e) => {
  if (!state.draggingReticle || e.pointerId !== state.dragPointerId) return;
  updateFocalFromClientPoint(e.clientX, e.clientY);
});

function endFocalDrag(e) {
  if (!state.draggingReticle || e.pointerId !== state.dragPointerId) return;
  state.draggingReticle = false;
  state.dragPointerId = null;
  reticleBtn.classList.remove('is-dragging');
  try { viewportEl.releasePointerCapture(e.pointerId); } catch {}
  requestRender();
}
viewportEl.addEventListener('pointerup', endFocalDrag);
viewportEl.addEventListener('pointercancel', endFocalDrag);

reticleBtn.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.08 : 0.04;
  let moved = true;
  if (e.key === 'ArrowLeft') state.focalX = clamp(state.focalX - step, 0.08, 0.92);
  else if (e.key === 'ArrowRight') state.focalX = clamp(state.focalX + step, 0.08, 0.92);
  else if (e.key === 'ArrowUp') state.focalY = clamp(state.focalY - step, 0.08, 0.92);
  else if (e.key === 'ArrowDown') state.focalY = clamp(state.focalY + step, 0.08, 0.92);
  else moved = false;
  if (!moved) return;
  e.preventDefault();
  state.autoLoop = false;
  requestRender();
});

// Scene A internal interactive controls
btnAGrade.addEventListener('click', () => {
  state.autoLoop = false;
  state.grade = state.grade === 'warm' ? 'noir' : 'warm';
  sceneA.dataset.grade = state.grade;
  btnAGrade.textContent = state.grade === 'warm' ? 'Grade: Warm' : 'Grade: Noir';
  state.dirtyA = true;
  canvas.requestPaint?.();
  requestRender();
});

btnAMark.addEventListener('click', () => {
  state.autoLoop = false;
  state.marks++;
  btnAMark.textContent = `Log marker #${state.marks}`;
  markCountEl.textContent = `${String(state.marks).padStart(2, '0')} LOG`;
  state.dirtyA = true;
  canvas.requestPaint?.();
  requestRender();
});

// Scene B internal interactive controls
btnBLut.addEventListener('click', () => {
  state.autoLoop = false;
  state.lut = state.lut === 'tungsten' ? 'cobalt' : 'tungsten';
  sceneB.dataset.lut = state.lut;
  btnBLut.textContent = state.lut === 'tungsten' ? 'LUT: Tungsten' : 'LUT: Cobalt';
  state.dirtyB = true;
  canvas.requestPaint?.();
  requestRender();
});

btnBCue.addEventListener('click', () => {
  state.autoLoop = false;
  state.cues++;
  btnBCue.textContent = `Cue clip #${state.cues}`;
  cueCountEl.textContent = `${String(state.cues).padStart(2, '0')} CUED`;
  state.dirtyB = true;
  canvas.requestPaint?.();
  requestRender();
});

for (const inp of [inputA, inputB]) {
  inp.addEventListener('input', () => {
    state.autoLoop = false;
    if (inp === inputA) state.dirtyA = true;
    else state.dirtyB = true;
    canvas.requestPaint?.();
    requestRender();
  });
}

for (const [sceneEl, flag] of [[sceneA, 'dirtyA'], [sceneB, 'dirtyB']]) {
  sceneEl.addEventListener('focusin', () => {
    state[flag] = true;
    canvas.requestPaint?.();
    requestRender();
  });
  sceneEl.addEventListener('focusout', () => {
    state[flag] = true;
    canvas.requestPaint?.();
    requestRender();
  });
}

initBackend();

// ---------------- Isolated Live Checks (Tap-Gated) ----------------

function makeFixtureCanvas(w = 240, h = 180) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = `display:block;width:${w}px;height:${h}px;position:relative;overflow:hidden`;
  testStage().append(cv);
  return cv;
}

function readPlainCopyImageData(srcCanvas) {
  const copy = document.createElement('canvas');
  copy.width = srcCanvas.width;
  copy.height = srcCanvas.height;
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(srcCanvas, 0, 0);
  return cc.getImageData(0, 0, copy.width, copy.height);
}

function patchContrast(img, x0, y0, pw, ph) {
  const { width, height, data } = img;
  const sx = Math.max(0, Math.floor(x0));
  const sy = Math.max(0, Math.floor(y0));
  const ex = Math.min(width - 2, sx + Math.floor(pw));
  const ey = Math.min(height - 2, sy + Math.floor(ph));
  let sum = 0;
  let count = 0;
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const i = (y * width + x) * 4;
      const ir = (y * width + (x + 2)) * 4;
      const id = ((y + 2) * width + x) * 4;
      const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      const lumR = data[ir] * 0.3 + data[ir + 1] * 0.59 + data[ir + 2] * 0.11;
      const lumD = data[id] * 0.3 + data[id + 1] * 0.59 + data[id + 2] * 0.11;
      sum += Math.abs(lum - lumR) + Math.abs(lum - lumD);
      count++;
    }
  }
  return count ? sum / count : 0;
}

runTests(testsBody, [
  {
    name: 'ElementGL dual-scene upload renders View A (0%) and View B (100%) with gl.getError() === 0',
    why: 'Creates an isolated ElementGL fixture with two drawable scenes, sets UNPACK_PREMULTIPLY_ALPHA_WEBGL, calls begin() before upload() and checks drawn pixels at 0% and 100%.',
    timeout: 6000,
    run: async () => {
      if (!elGlSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#ef5a29;`;
      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#0ea5e9;`;
      cv.append(fixA, fixB);

      const g = new ElementGL(cv, {
        fragment: ZOOM_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.02, 0.03, 0.05, 1])) throw new Error('ElementGL.begin() returned false');
        const tA = g.upload(fixA);
        const tB = g.upload(fixB);
        if (!tA || !tB) throw new Error('stage.upload() returned null');

        const drawProgress = (p) => {
          if (!g.begin([0.02, 0.03, 0.05, 1])) throw new Error('begin() failed');
          g.quad(fixA, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tB.tex);
            gl.uniform1i(u('uTexB'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform2f(u('uCanvasSize'), cw, ch);
            gl.uniform1f(u('uProgress'), p);
            gl.uniform1f(u('uStrength'), 1.0);
            gl.uniform1f(u('uDirection'), 1.0);
            gl.uniform2f(u('uFocal'), 0.5, 0.5);
            gl.uniform1f(u('uReduced'), 0.0);
            gl.uniform1f(u('uShowReticle'), 0.0);
          });
        };

        drawProgress(0);
        const err0 = g.gl.getError();
        if (err0 !== 0) throw new Error(`gl.getError() at 0% returned 0x${err0.toString(16)}`);
        const imgA = readPlainCopyImageData(cv);
        const cIdx = (Math.floor(imgA.height * 0.5) * imgA.width + Math.floor(imgA.width * 0.5)) * 4;
        const pxA = [imgA.data[cIdx], imgA.data[cIdx + 1], imgA.data[cIdx + 2]];
        if (pxA[0] < 180 || pxA[0] <= pxA[2]) throw new Error(`expected warm Scene A at 0%, got rgb(${pxA.join(',')})`);

        drawProgress(1);
        const err1 = g.gl.getError();
        if (err1 !== 0) throw new Error(`gl.getError() at 100% returned 0x${err1.toString(16)}`);
        const imgB = readPlainCopyImageData(cv);
        const pxB = [imgB.data[cIdx], imgB.data[cIdx + 1], imgB.data[cIdx + 2]];
        if (pxB[2] < 180 || pxB[2] <= pxB[0]) throw new Error(`expected cool Scene B at 100%, got rgb(${pxB.join(',')})`);

        return `texA ${tA.w}×${tA.h} rgb(${pxA.join(',')}), texB ${tB.w}×${tB.h} rgb(${pxB.join(',')}), glErr=0`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Focal anchor relocation shifts radial blur asymmetry across quadrants',
    why: 'Renders uniform high-contrast striped scenes at 50% once anchored at (0.18, 0.22) and once at (0.82, 0.78), then measures local spatial contrast in top-left vs bottom-right quadrants via a plain copy canvas.',
    timeout: 6000,
    run: async () => {
      if (!elGlSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:repeating-linear-gradient(45deg,#ffffff 0 6px,#d2491f 6px 12px);`;
      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:repeating-linear-gradient(-45deg,#071022 0 6px,#38bdf8 6px 12px);`;
      cv.append(fixA, fixB);

      const g = new ElementGL(cv, {
        fragment: ZOOM_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.02, 0.03, 0.05, 1])) throw new Error('ElementGL.begin() returned false');
        const tA = g.upload(fixA);
        const tB = g.upload(fixB);
        if (!tA || !tB) throw new Error('stage.upload() returned null');

        const drawAtFocal = (fx, fy) => {
          g.begin([0.02, 0.03, 0.05, 1]);
          g.quad(fixA, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tB.tex);
            gl.uniform1i(u('uTexB'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform2f(u('uCanvasSize'), cw, ch);
            gl.uniform1f(u('uProgress'), 0.50);
            gl.uniform1f(u('uStrength'), 1.35);
            gl.uniform1f(u('uDirection'), 1.0);
            gl.uniform2f(u('uFocal'), fx, fy);
            gl.uniform1f(u('uReduced'), 0.0);
            gl.uniform1f(u('uShowReticle'), 0.0);
          });
          return readPlainCopyImageData(cv);
        };

        const imgTL = drawAtFocal(0.18, 0.22);
        const sharpTL1 = patchContrast(imgTL, imgTL.width * 0.08, imgTL.height * 0.10, imgTL.width * 0.24, imgTL.height * 0.26);
        const sharpBR1 = patchContrast(imgTL, imgTL.width * 0.68, imgTL.height * 0.64, imgTL.width * 0.24, imgTL.height * 0.26);

        const imgBR = drawAtFocal(0.82, 0.78);
        const sharpTL2 = patchContrast(imgBR, imgBR.width * 0.08, imgBR.height * 0.10, imgBR.width * 0.24, imgBR.height * 0.26);
        const sharpBR2 = patchContrast(imgBR, imgBR.width * 0.68, imgBR.height * 0.64, imgBR.width * 0.24, imgBR.height * 0.26);

        if (!(sharpTL1 > sharpBR1 * 1.15)) {
          throw new Error(`TL focal did not stay sharper than BR (TL=${sharpTL1.toFixed(1)}, BR=${sharpBR1.toFixed(1)})`);
        }
        if (!(sharpBR2 > sharpTL2 * 1.15)) {
          throw new Error(`BR focal did not stay sharper than TL (TL=${sharpTL2.toFixed(1)}, BR=${sharpBR2.toFixed(1)})`);
        }
        return `anchor TL: contrast TL ${sharpTL1.toFixed(1)} vs BR ${sharpBR1.toFixed(1)}; anchor BR: TL ${sharpTL2.toFixed(1)} vs BR ${sharpBR2.toFixed(1)}`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Tunnel warp, settle and tMs overshoot clamping across 0%, 50% and 100%',
    why: 'Verifies hyperbolic magnification/pull-out curves in computeZoomTunnelState(), tMs overshoot clamping and reduced-motion snaps in stepZoomTransition(), and mid-warp blending in WebGL.',
    timeout: 6000,
    run: async () => {
      const z0 = computeZoomTunnelState({ progress: 0, strength: 1.0, direction: 'in' });
      const z50In = computeZoomTunnelState({ progress: 0.5, strength: 1.0, direction: 'in' });
      const z50Out = computeZoomTunnelState({ progress: 0.5, strength: 1.0, direction: 'out' });
      const z100 = computeZoomTunnelState({ progress: 1, strength: 1.0, direction: 'in' });

      if (z0.scaleA !== 1 || z0.mixB !== 0 || z0.blurSpread !== 0) {
        throw new Error(`0% baseline mismatch: scaleA=${z0.scaleA}, mixB=${z0.mixB}`);
      }
      if (!(z50In.scaleA > 1.8 && z50Out.scaleA < 0.5 && Math.abs(z50In.mixB - 0.5) < 0.01 && z50In.velocity > 0.99)) {
        throw new Error(`50% peak mismatch: in=${z50In.scaleA.toFixed(2)}, out=${z50Out.scaleA.toFixed(2)}, mix=${z50In.mixB.toFixed(2)}`);
      }
      if (z100.scaleB !== 1 || z100.mixB !== 1 || z100.blurSpread !== 0) {
        throw new Error(`100% settle mismatch: scaleB=${z100.scaleB}, mixB=${z100.mixB}`);
      }

      const anim = { from: 0, to: 1, startMs: 1000, durMs: 800 };
      const pre = stepZoomTransition(anim, 900, false);
      const mid = stepZoomTransition(anim, 1400, false);
      const over = stepZoomTransition(anim, 2400, false);
      const snap = stepZoomTransition(anim, 1050, true);
      if (pre.progress !== 0 || pre.settled) throw new Error(`pre-start tMs failed: ${JSON.stringify(pre)}`);
      if (Math.abs(mid.progress - 0.5) > 0.01 || mid.settled) throw new Error(`mid tMs failed: ${JSON.stringify(mid)}`);
      if (over.progress !== 1 || !over.settled) throw new Error(`overshoot tMs clamped wrong: ${JSON.stringify(over)}`);
      if (snap.progress !== 1 || !snap.settled) throw new Error(`reduced-motion snap failed: ${JSON.stringify(snap)}`);

      return `0% 1.00x -> 50% (in ${z50In.scaleA.toFixed(2)}x / out ${z50Out.scaleA.toFixed(2)}x, vel ${z50In.velocity.toFixed(2)}) -> 100% 1.00x; tMs clamped [0..1]`;
    },
  },
  {
    name: 'Live DOM clicks and input hit-testing succeed on settled View A (0%) and View B (100%)',
    why: 'Builds an isolated fixture with two sibling drawable scenes holding buttons and inputs, runs syncSceneGeometry() at 0% and 100%, verifies elementsFromPoint() hits only the active view and clicks increment counters.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !api2dSupported) {
        throw new Error('updateElementGeometry() or drawElementImage() is not available');
      }
      const cw = 300, ch = 200;
      const cv = makeFixtureCanvas(cw, ch);

      const makeScene = (bg, label) => {
        const sec = document.createElement('section');
        sec.setAttribute('drawable', '');
        sec.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:${bg};`;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'none';
        inp.value = label;
        inp.setAttribute('aria-label', `${label} input`);
        inp.style.cssText = 'position:absolute;left:24px;top:24px;width:252px;height:40px;margin:0;border:0;';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.cssText = 'position:absolute;left:40px;top:110px;width:220px;height:44px;margin:0;border:0;';
        sec.append(inp, btn);
        return { sec, inp, btn };
      };

      const a = makeScene('#fbf7ef', 'Scene A');
      const b = makeScene('#0b1426', 'Scene B');
      let clicksA = 0;
      let clicksB = 0;
      a.btn.addEventListener('click', () => { clicksA++; });
      b.btn.addEventListener('click', () => { clicksB++; });
      cv.append(a.sec, b.sec);

      try {
        const c2 = cv.getContext('2d');
        await nextPaint(cv);
        c2.drawElementImage(a.sec, 0, 0, cw, ch);
        c2.drawElementImage(b.sec, 0, 0, cw, ch);

        const rect = cv.getBoundingClientRect();
        const btnPt = { x: rect.left + 150, y: rect.top + 132 };
        const inpPt = { x: rect.left + 150, y: rect.top + 44 };

        syncSceneGeometry({ targetCanvas: cv, elA: a.sec, elB: b.sec, progress: 0, mode: '2d' });
        const hitBtnA = document.elementsFromPoint(btnPt.x, btnPt.y);
        const hitInpA = document.elementsFromPoint(inpPt.x, inpPt.y);
        if (!hitBtnA.includes(a.btn) || hitBtnA.includes(b.sec)) {
          throw new Error(`at 0% View A button missed (top=${hitBtnA[0]?.tagName})`);
        }
        if (!hitInpA.includes(a.inp)) {
          throw new Error(`at 0% View A input missed (top=${hitInpA[0]?.tagName})`);
        }
        hitBtnA.find((el) => el === a.btn).click();

        syncSceneGeometry({ targetCanvas: cv, elA: a.sec, elB: b.sec, progress: 1, mode: '2d' });
        const hitBtnB = document.elementsFromPoint(btnPt.x, btnPt.y);
        const hitInpB = document.elementsFromPoint(inpPt.x, inpPt.y);
        if (!hitBtnB.includes(b.btn) || hitBtnB.includes(a.sec)) {
          throw new Error(`at 100% View B button missed (top=${hitBtnB[0]?.tagName})`);
        }
        if (!hitInpB.includes(b.inp)) {
          throw new Error(`at 100% View B input missed (top=${hitInpB[0]?.tagName})`);
        }
        hitBtnB.find((el) => el === b.btn).click();

        if (clicksA !== 1 || clicksB !== 1) {
          throw new Error(`expected 1 click on each view, got A=${clicksA}, B=${clicksB}`);
        }
        return `0% hit btnA & inpA (clicks=${clicksA}); 100% hit btnB & inpB (clicks=${clicksB})`;
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Synthetic context loss/restore and 5-arg drawElementImage() 2D fallback',
    why: 'Dispatches cancelable webglcontextlost and webglcontextrestored events without calling loseContext(), then verifies a 5-argument drawElementImage() 2D canvas draws View A and View B.',
    timeout: 6000,
    run: async () => {
      if (!api2dSupported) throw new Error('2D drawElementImage() is not available');
      const box = document.createElement('div');
      box.style.cssText = 'position:relative;width:180px;height:120px;';
      const vp = document.createElement('div');
      const cvLoss = document.createElement('canvas');
      cvLoss.setAttribute('content', 'drawable');
      cvLoss.setAttribute('layoutsubtree', '');
      cvLoss.width = 180;
      cvLoss.height = 120;
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = 'width:180px;height:120px;background:#ef5a29;';
      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.style.cssText = 'width:180px;height:120px;background:#0ea5e9;';
      const ph = document.createElement('div');
      ph.hidden = true;
      cvLoss.append(fixA, fixB);
      vp.append(cvLoss);
      box.append(vp, ph);
      testStage().append(box);

      let note = '';
      let restored = false;
      attachContextLossController({
        targetCanvas: cvLoss,
        targetViewport: vp,
        targetElements: [fixA, fixB],
        targetPlainHost: ph,
        onPlain: (m) => { note = m; },
        onRestore: () => { restored = true; },
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cvLoss.dispatchEvent(lostEv);
      const fellBack = lostEv.defaultPrevented && vp.hidden && !ph.hidden && ph.contains(fixA) && ph.contains(fixB);
      if (!fellBack) throw new Error(`plain HTML fallback failed (prevented=${lostEv.defaultPrevented})`);

      cvLoss.dispatchEvent(new Event('webglcontextrestored'));
      const cameBack = restored && !vp.hidden && ph.hidden && cvLoss.contains(fixA) && cvLoss.contains(fixB);
      box.remove();
      window.__gfx?.retire?.(cvLoss);
      if (!cameBack) throw new Error('webglcontextrestored did not move both views back to canvas');

      const cv2d = makeFixtureCanvas(180, 120);
      const s2A = document.createElement('div');
      s2A.setAttribute('drawable', '');
      s2A.style.cssText = 'position:absolute;left:0;top:0;width:180px;height:120px;background:#d2491f;';
      const s2B = document.createElement('div');
      s2B.setAttribute('drawable', '');
      s2B.style.cssText = 'position:absolute;left:0;top:0;width:180px;height:120px;background:#0ea5e9;';
      cv2d.append(s2A, s2B);
      try {
        const c2 = cv2d.getContext('2d');
        await nextPaint(cv2d);
        c2.drawElementImage(s2A, 0, 0, 180, 120);
        c2.globalAlpha = 0.5;
        c2.drawElementImage(s2B, 20, 15, 140, 90);
        c2.globalAlpha = 1;
        const img = readPlainCopyImageData(cv2d);
        const cIdx = (60 * img.width + 90) * 4;
        const px = [img.data[cIdx], img.data[cIdx + 1], img.data[cIdx + 2]];
        if (px[0] < 40 || px[2] < 40) throw new Error(`unexpected 2D fallback pixel rgb(${px.join(',')})`);
        return `synthetic loss ("${note.slice(0, 22)}…") restored; 5-arg 2D blend rgb(${px.join(',')})`;
      } finally {
        cv2d.remove();
        window.__gfx?.retire?.(cv2d);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'zoom-tunnel stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !state.texUploaded || !state.hasPainted) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return 1;
        }
        return state.hasPainted && canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => showPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
