import {
  banner,
  inkFraction,
  isBench,
  nextPaint,
  runTests,
  stillDrawn,
  supported as api2dSupported,
  testStage,
} from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const routeParam = new URLSearchParams(location.search).get('route');

// DOM references
const stageEl = document.getElementById('ti-stage');
const viewportEl = document.getElementById('ti-viewport');
const canvas = document.getElementById('ti-canvas');
const padEl = document.getElementById('ti-pad');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('ti-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests');

// Toolbar controls
const modeBtns = Array.from(document.querySelectorAll('#ti-mode-group button[data-mode]'));
const pulseBtn = document.getElementById('btn-pulse');
const ctlStiffness = document.getElementById('ctl-stiffness');
const outStiffness = document.getElementById('out-stiffness');
const ctlDamping = document.getElementById('ctl-damping');
const outDamping = document.getElementById('out-damping');
const ctlReduced = document.getElementById('ctl-reduced');

// Pad controls
const labelInput = document.getElementById('ti-label');
const totalOut = document.getElementById('ti-total');
const waveStatOut = document.getElementById('ti-wave-stat');
const tiles = Array.from(padEl.querySelectorAll('.ti-tile'));

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;
if (reducedQuery?.matches) ctlReduced.checked = true;

// #region wave-math
export const MAX_WAVES = 4;

/**
 * Derive physical wave parameters from Stiffness (1..10) and Damping (1..10).
 */
export function wavePhysics(stiffness = 5, damping = 4) {
  const sNorm = clamp((stiffness - 1) / 9, 0, 1);
  const dNorm = clamp((damping - 1) / 9, 0, 1);
  const k = 0.072 + sNorm * 0.058;           // rad per CSS px (wavelength ~50..87 px)
  const speed = 250 + sNorm * 270;           // CSS px per second
  const w = k * speed;                       // rad per second
  const rDecay = 0.0022 + dNorm * 0.0068;    // spatial damping per CSS px
  const tDecay = 0.85 + dNorm * 3.15;        // temporal damping per second
  const dentRadius = 92 - sNorm * 26;        // tighter dent at higher stiffness
  const dentStrength = 1.25 - sNorm * 0.35;  // deeper dent on softer pads
  const settleSec = Math.min(4.4, 5.6 / tDecay);
  return { k, speed, w, rDecay, tDecay, dentRadius, dentStrength, settleSec };
}

/**
 * Ramp concave dent depth smoothly across ~80 ms while pressed down.
 */
export function computeDentDepth(holdMs, dentStrength = 1.1) {
  const t = clamp(holdMs / 1000, 0, 2);
  return dentStrength * (1 - Math.exp(-t / 0.028));
}

/**
 * Insert a wave ring into the fixed 4-ring buffer, replacing the oldest if full.
 */
export function pushImpactWave(waves, x, y, startMs, energy = 1.0) {
  const next = waves.slice();
  const entry = { x, y, startMs, energy: clamp(energy, 0.1, 1.4) };
  if (next.length < MAX_WAVES) {
    next.push(entry);
    return next;
  }
  let oldestIdx = 0;
  for (let i = 1; i < next.length; i++) {
    if (next[i].startMs < next[oldestIdx].startMs) oldestIdx = i;
  }
  next[oldestIdx] = entry;
  return next;
}

/**
 * Evaluate active dent compression and up to 4 damped elastic rings at timestamp `tMs`.
 */
export function stepImpactWaves({
  press = null,
  releaseDecay = null,
  waves = [],
  stiffness = 5,
  damping = 4,
  mode = 'gpu',
  tMs = performance.now(),
  reducedMotion = false,
} = {}) {
  const physics = wavePhysics(stiffness, damping);
  if (reducedMotion || mode === 'flat') {
    return {
      dentDepth: 0,
      pressX: 0,
      pressY: 0,
      dentRadius: physics.dentRadius,
      activeWaves: [],
      activeCount: 0,
      peakSpeed: 0,
      maxEnv: 0,
      physics,
      settled: true,
    };
  }

  let dentDepth = 0;
  let pressX = 0;
  let pressY = 0;

  if (press && press.active) {
    dentDepth = computeDentDepth(Math.max(0, tMs - press.downMs), physics.dentStrength);
    pressX = press.x;
    pressY = press.y;
  } else if (releaseDecay) {
    const dtSec = Math.max(0, (tMs - releaseDecay.upMs) / 1000);
    const decayed = releaseDecay.depth * Math.exp(-dtSec / 0.032);
    if (decayed >= 0.004) {
      dentDepth = decayed;
      pressX = releaseDecay.x;
      pressY = releaseDecay.y;
    }
  }

  const activeWaves = [];
  let maxEnv = 0;
  for (let i = 0; i < waves.length && activeWaves.length < MAX_WAVES; i++) {
    const wv = waves[i];
    const rawAgeMs = tMs - wv.startMs;
    if (rawAgeMs < -50) continue;
    const ageSec = Math.max(0, rawAgeMs) / 1000;
    if (ageSec > physics.settleSec) continue;
    const env = wv.energy * Math.exp(-ageSec * physics.tDecay);
    if (env < 0.004) continue;
    if (env > maxEnv) maxEnv = env;
    activeWaves.push({ x: wv.x, y: wv.y, ageSec, energy: wv.energy, env });
  }

  const peakSpeed = maxEnv * physics.speed;
  const settled = dentDepth <= 0.004 && !(press && press.active) && activeWaves.length === 0;

  return {
    dentDepth,
    pressX,
    pressY,
    dentRadius: physics.dentRadius,
    activeWaves,
    activeCount: activeWaves.length,
    peakSpeed,
    maxEnv,
    physics,
    settled,
  };
}

const unitCache = new WeakMap();

function cachedGeometryUnit(targetCanvas, refEl, cw) {
  const zoom = refEl.currentCSSZoom || 1;
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${cw}/${zoom}`;
  const prev = unitCache.get(targetCanvas);
  if (prev && prev.key === key) return prev.unit;
  const unit = geometryUnit(targetCanvas, refEl, cw);
  unitCache.set(targetCanvas, { key, unit, lastGeoKey: '' });
  return unit;
}

export function syncPadGeometry(force = false) {
  if (state.backend === 'plain') return;
  if (typeof canvas.updateElementGeometry !== 'function' || !OFFSTAGE) return;
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 344);
  const u = cachedGeometryUnit(canvas, padEl, cw);
  const entry = unitCache.get(canvas);
  const geoKey = `${cw}|${u.toFixed(4)}`;
  if (!force && entry && entry.lastGeoKey === geoKey) return;
  if (entry) entry.lastGeoKey = geoKey;

  padEl.inert = false;
  padEl.style.pointerEvents = 'auto';
  canvas.updateElementGeometry(padEl, { canvasTransform: new DOMMatrix().scale(u, u, 1) });
  padEl.dataset.hitTick = padEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion wave-math

// #region impact-shader
export const IMPACT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uCanvasSize;     // CSS px (cw, ch)
uniform vec2 uPressPos;       // press centre in CSS px
uniform float uDentDepth;     // 0..1.35 current concave depth
uniform float uDentRadius;    // CSS px radius of dent bowl
uniform vec4 uWaves[4];       // (x_px, y_px, age_sec, energy)
uniform vec4 uWaveParams;     // (k, w, rDecay, tDecay)
uniform vec2 uWaveSpeedDisp;  // (speedPxPerSec, dispPxScale)
uniform float uHasWaves;      // > 0.5 when any ring is active

in vec2 vUv;
out vec4 outColor;

const vec3 BACKDROP = vec3(0.043, 0.063, 0.098);

void evalField(vec2 p, out float outH, out vec2 outDisp, out float outDentBowl, out float outDentRim) {
  float h = 0.0;
  vec2 disp = vec2(0.0);
  float dentBowl = 0.0;
  float dentRim = 0.0;

  if (uDentDepth > 0.0005) {
    vec2 d = p - uPressPos;
    float r = length(d);
    vec2 dir = r > 0.001 ? d / r : vec2(0.0);
    float q = r / max(uDentRadius, 1.0);
    float bowl = exp(-q * q * 2.5);
    float rim = 0.28 * exp(-pow((q - 1.02) / 0.38, 2.0));
    dentBowl = uDentDepth * bowl;
    dentRim = uDentDepth * rim;
    h += (-dentBowl + dentRim) * 14.0;
    // Pull nearby pixels gently inward toward the fingertip
    float pull = uDentDepth * 15.5 * q * exp(-q * q * 1.7);
    disp += dir * pull;
  }

  if (uHasWaves > 0.5) {
    float k = uWaveParams.x;
    float w = uWaveParams.y;
    float rDecay = uWaveParams.z;
    float tDecay = uWaveParams.w;
    float speed = uWaveSpeedDisp.x;
    float dispScale = uWaveSpeedDisp.y;

    for (int i = 0; i < 4; i++) {
      vec4 wv = uWaves[i];
      if (wv.w <= 0.0005 || wv.z < 0.0) continue;
      vec2 d = p - wv.xy;
      float r = length(d);
      vec2 dir = r > 0.001 ? d / r : vec2(0.0);
      float t = wv.z;
      float front = speed * t;
      float causal = smoothstep(front + 26.0, front - 12.0, r);
      if (causal <= 0.0001) continue;

      float env = exp(-r * rDecay - t * tDecay) * wv.w * causal;
      if (env <= 0.0005) continue;

      // Damped elastic concentric wave: sin(r*k - w*t) * exp(-decay*r - timeDecay*t)
      float osc = -sin(r * k - w * t);
      float waveVal = osc * env;
      h += waveVal * 12.0;
      // Push neighbouring HTML tiles radially outward on crests
      disp -= dir * (waveVal * dispScale);
    }
  }

  outH = h;
  outDisp = disp;
  outDentBowl = dentBowl;
  outDentRim = dentRim;
}

void main() {
  vec2 size = max(uCanvasSize, vec2(1.0));
  vec2 p = vUv * size;

  if (uDentDepth <= 0.0005 && uHasWaves <= 0.5) {
    vec4 t = texture(uTex, vUv);
    outColor = vec4(t.rgb + BACKDROP * (1.0 - t.a), 1.0);
    return;
  }

  float h0, dentBowl, dentRim;
  vec2 disp;
  evalField(p, h0, disp, dentBowl, dentRim);

  vec2 sampleUv = clamp((p + disp) / size, vec2(0.0), vec2(1.0));
  vec4 texCol = texture(uTex, sampleUv);

  float eps = 2.0;
  float hR, hL, hD, hU, _b, _r;
  vec2 _d;
  evalField(p + vec2(eps, 0.0), hR, _d, _b, _r);
  evalField(p - vec2(eps, 0.0), hL, _d, _b, _r);
  evalField(p + vec2(0.0, eps), hD, _d, _b, _r);
  evalField(p - vec2(0.0, eps), hU, _d, _b, _r);

  vec2 grad = vec2(hR - hL, hD - hU) / (2.0 * eps);
  float slopeLen = length(grad);
  if (slopeLen > 0.002) {
    vec2 chromaOff = grad * (0.45 / size);
    float rCh = texture(uTex, clamp(sampleUv + chromaOff, vec2(0.0), vec2(1.0))).r;
    float bCh = texture(uTex, clamp(sampleUv - chromaOff, vec2(0.0), vec2(1.0))).b;
    texCol.r = mix(texCol.r, rCh, 0.45);
    texCol.b = mix(texCol.b, bCh, 0.45);
  }

  vec3 baseRgb = texCol.rgb + BACKDROP * (1.0 - texCol.a);
  vec3 n = normalize(vec3(-grad.x * 1.15, -grad.y * 1.15, 1.0));
  vec3 L = normalize(vec3(-0.42, -0.56, 0.71));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  float diffBase = L.z;
  float specBase = pow(max(H.z, 0.0), 34.0);
  float diffDelta = dot(n, L) - diffBase;
  float specDelta = max(0.0, pow(max(dot(n, H), 0.0), 34.0) - specBase);

  // Concave shadow inside press bowl + raised specular lip around depression rim
  float shade = 1.0 + diffDelta * 0.42 - dentBowl * 0.32 + dentRim * 0.32;
  vec3 lit = baseRgb * max(shade, 0.46);

  float waveCrest = max(0.0, h0 / 12.0) * smoothstep(0.02, 0.35, slopeLen);
  float specMask = specDelta * 0.56 + dentRim * 0.24 + waveCrest * 0.26;
  lit += vec3(0.90, 0.95, 1.0) * specMask;

  outColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
}`;
// #endregion impact-shader

// ---------------- State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  mode: 'gpu',     // 'gpu' | 'flat'
  stiffness: Number(ctlStiffness.value),
  damping: Number(ctlDamping.value),
  press: null,
  releaseDecay: null,
  waves: [],
  counts: [0, 0, 0, 0, 0, 0],
  switches: { 2: true, 5: false },
  totalHits: 0,
  lastPointerReleaseMs: -1e9,
  onScreen: true,
  hasPainted: false,
  dirty: true,
  texUploaded: false,
  uploads: 0,
  paints: 0,
  needsDraw: true,
  lastStep: null,
};

let stage = null;
let ctx2d = null;
let rafId = 0;
const waveVecBuf = new Float32Array(16);

function isReducedMotion() {
  return Boolean(ctlReduced.checked || reducedQuery?.matches);
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 344);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 364);
  return { cw, ch };
}

function syncPadSize(cw, ch) {
  if (state.backend === 'plain') {
    if (padEl.style.width) padEl.style.width = '';
    if (padEl.style.height) padEl.style.height = '';
    return;
  }
  const wStr = `${cw}px`;
  const hStr = `${ch}px`;
  if (padEl.style.width !== wStr) padEl.style.width = wStr;
  if (padEl.style.height !== hStr) padEl.style.height = hStr;
}

function syncControlsUI(step = state.lastStep) {
  outStiffness.textContent = state.stiffness.toFixed(1);
  outDamping.textContent = state.damping.toFixed(1);
  for (const b of modeBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  }
  stageEl.classList.toggle('is-flat', state.mode === 'flat');

  const activeRings = step ? step.activeCount : 0;
  const dentPct = step ? Math.round(clamp(step.dentDepth, 0, 1.35) * 100) : 0;
  const speedPx = step ? Math.round(step.peakSpeed) : 0;

  waveStatOut.textContent = `${activeRings}/4 RINGS`;

  const routeLabel = state.backend === 'webgl'
    ? 'WebGL 2'
    : state.backend === '2d'
      ? '2D fallback'
      : 'Plain HTML';
  const modeLabel = isReducedMotion()
    ? 'reduced'
    : state.mode === 'flat'
      ? 'flat CSS'
      : 'GPU wave';
  hudEl.textContent = `${routeLabel} · ${modeLabel} · dent ${dentPct}% · ${activeRings}/4 rings · ${speedPx} px/s`;
}

// ---------------- Upload, Render & Fallbacks ----------------

// #region paint-upload
const padTexCache = new WeakMap();

function uploadPad(el) {
  if (!stage || stage.lost || !state.hasPainted) return false;
  try {
    const tex = stage.upload(el);
    if (!tex) return false;
    padTexCache.set(el, tex);
    const gl = stage.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    state.uploads++;
    return true;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return false;
    }
    throw err;
  }
}

export function packWaveUniforms(activeWaves, outBuf) {
  outBuf.fill(0);
  for (let i = 0; i < MAX_WAVES && i < activeWaves.length; i++) {
    const wv = activeWaves[i];
    const base = i * 4;
    outBuf[base] = wv.x;
    outBuf[base + 1] = wv.y;
    outBuf[base + 2] = wv.ageSec;
    outBuf[base + 3] = wv.energy;
  }
}

function renderWebGL(nowMs = performance.now()) {
  if (!state.hasPainted || !stage || stage.lost) return null;
  const { cw, ch } = getViewportSize();
  syncPadSize(cw, ch);

  // Call stage.begin() before stage.upload() so the backing buffer matches DPR first.
  if (!stage.begin([0.043, 0.063, 0.098, 1])) return null;

  if (state.dirty || !padTexCache.has(padEl)) {
    if (uploadPad(padEl)) state.dirty = false;
  }
  if (!padTexCache.has(padEl)) return null;
  state.texUploaded = true;

  const stepped = stepImpactWaves({
    press: state.press,
    releaseDecay: state.releaseDecay,
    waves: state.waves,
    stiffness: state.stiffness,
    damping: state.damping,
    mode: state.mode,
    tMs: nowMs,
    reducedMotion: isReducedMotion(),
  });
  state.lastStep = stepped;

  // Prune decayed waves from state cleanly once settled
  state.waves = state.waves.filter((wv) => {
    const ageSec = (nowMs - wv.startMs) / 1000;
    return ageSec >= 0 && ageSec <= stepped.physics.settleSec && wv.energy * Math.exp(-ageSec * stepped.physics.tDecay) >= 0.004;
  });
  if (state.releaseDecay && stepped.dentDepth <= 0.004 && !(state.press && state.press.active)) {
    state.releaseDecay = null;
  }

  packWaveUniforms(stepped.activeWaves, waveVecBuf);

  stage.quad(padEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
    gl.uniform2f(u('uCanvasSize'), cw, ch);
    gl.uniform2f(u('uPressPos'), stepped.pressX, stepped.pressY);
    gl.uniform1f(u('uDentDepth'), stepped.dentDepth);
    gl.uniform1f(u('uDentRadius'), stepped.dentRadius);
    const uWaves = u('uWaves[0]') ?? u('uWaves');
    if (uWaves) gl.uniform4fv(uWaves, waveVecBuf);
    gl.uniform4f(
      u('uWaveParams'),
      stepped.physics.k,
      stepped.physics.w,
      stepped.physics.rDecay,
      stepped.physics.tDecay
    );
    gl.uniform2f(u('uWaveSpeedDisp'), stepped.physics.speed, 12.0);
    gl.uniform1f(u('uHasWaves'), stepped.activeCount > 0 ? 1.0 : 0.0);
  });

  syncPadGeometry(false);
  syncControlsUI(stepped);
  return stepped;
}

function render2DFallback(nowMs = performance.now()) {
  if (!state.hasPainted || !ctx2d) return null;
  const { cw, ch } = getViewportSize();
  syncPadSize(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const stepped = stepImpactWaves({
    press: state.press,
    releaseDecay: state.releaseDecay,
    waves: state.waves,
    stiffness: state.stiffness,
    damping: state.damping,
    mode: state.mode,
    tMs: nowMs,
    reducedMotion: isReducedMotion(),
  });
  state.lastStep = stepped;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#0b1019';
  ctx2d.fillRect(0, 0, cw, ch);

  try {
    ctx2d.drawElementImage(padEl, 0, 0, cw, ch);
  } catch {}

  if (stepped.dentDepth > 0.005) {
    const r = stepped.dentRadius;
    const g = ctx2d.createRadialGradient(stepped.pressX, stepped.pressY, 2, stepped.pressX, stepped.pressY, r * 1.15);
    g.addColorStop(0, `rgba(6, 10, 18, ${(0.38 * stepped.dentDepth).toFixed(3)})`);
    g.addColorStop(0.75, `rgba(6, 10, 18, ${(0.12 * stepped.dentDepth).toFixed(3)})`);
    g.addColorStop(0.95, `rgba(255, 255, 255, ${(0.28 * stepped.dentDepth).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx2d.fillStyle = g;
    ctx2d.beginPath();
    ctx2d.arc(stepped.pressX, stepped.pressY, r * 1.15, 0, Math.PI * 2);
    ctx2d.fill();
  }

  for (const wv of stepped.activeWaves) {
    const front = stepped.physics.speed * wv.ageSec;
    const alpha = clamp(wv.env * 0.68, 0, 0.72);
    ctx2d.strokeStyle = `rgba(186, 230, 253, ${alpha.toFixed(3)})`;
    ctx2d.lineWidth = 3;
    ctx2d.beginPath();
    ctx2d.arc(wv.x, wv.y, Math.max(2, front), 0, Math.PI * 2);
    ctx2d.stroke();

    if (front > 36) {
      ctx2d.strokeStyle = `rgba(15, 23, 42, ${(alpha * 0.5).toFixed(3)})`;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.arc(wv.x, wv.y, front - 24, 0, Math.PI * 2);
      ctx2d.stroke();
    }
  }
  ctx2d.restore();

  state.texUploaded = true;
  syncPadGeometry(true);
  syncControlsUI(stepped);
  return stepped;
}

export function attachContextLossController({ targetCanvas, targetViewport, targetElements, targetPlainHost, onPlain, onRestore }) {
  const onLost = (e) => {
    e.preventDefault();
    for (const el of targetElements) {
      el.inert = false;
      el.style.pointerEvents = 'auto';
      if (el.parentElement !== targetPlainHost) targetPlainHost.append(el);
    }
    targetPlainHost.hidden = false;
    if (targetViewport) targetViewport.hidden = true;
    onPlain?.('Canvas context lost; showing the 3x2 control pad as plain HTML until restored.');
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

function enterPlainFallback(reason) {
  state.backend = 'plain';
  state.press = null;
  state.releaseDecay = null;
  state.waves = [];
  stageEl.classList.add('is-plain');
  padEl.inert = false;
  padEl.style.pointerEvents = 'auto';
  if (padEl.parentElement !== plainHost) plainHost.append(padEl);
  syncPadSize(0, 0);
  plainHost.hidden = false;
  viewportEl.hidden = true;
  routeNoteEl.textContent = reason;
  syncControlsUI(null);
}

function exitPlainFallback() {
  stageEl.classList.remove('is-plain');
  if (padEl.parentElement !== canvas) canvas.append(padEl);
  plainHost.hidden = true;
  viewportEl.hidden = false;
}
// #endregion paint-upload

// ---------------- Animation Loop & Interaction ----------------

function requestDraw() {
  state.needsDraw = true;
  if (state.backend === 'plain') {
    syncControlsUI(null);
    return;
  }
  if (!rafId && state.onScreen && !document.hidden) {
    rafId = requestAnimationFrame(tick);
  }
}

function tick() {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  const nowMs = performance.now();
  let stepped = null;
  if (state.hasPainted) {
    state.needsDraw = false;
    if (state.backend === 'webgl') stepped = renderWebGL(nowMs);
    else if (state.backend === '2d') stepped = render2DFallback(nowMs);
  }

  if (stepped && !stepped.settled) {
    rafId = requestAnimationFrame(tick);
  } else if (state.press && state.press.active && !isReducedMotion() && state.mode === 'gpu') {
    rafId = requestAnimationFrame(tick);
  }
}

function pointerPosInCanvas(clientX, clientY) {
  const { cw, ch } = getViewportSize();
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp(((clientX - r.left) / Math.max(1, r.width)) * cw, 0, cw),
    y: clamp(((clientY - r.top) / Math.max(1, r.height)) * ch, 0, ch),
  };
}

function launchWaveAt(x, y, energy = 1.0, nowMs = performance.now()) {
  if (isReducedMotion() || state.mode === 'flat' || state.backend === 'plain') {
    syncControlsUI(null);
    return;
  }
  state.waves = pushImpactWave(state.waves, x, y, nowMs, energy);
  requestDraw();
}

function clearTilePressClasses() {
  for (const t of tiles) t.classList.remove('is-pressed');
}

function initBackend() {
  attachContextLossController({
    targetCanvas: canvas,
    targetViewport: viewportEl,
    targetElements: [padEl],
    targetPlainHost: plainHost,
    onPlain: (msg) => {
      state.backend = 'plain';
      state.texUploaded = false;
      state.hasPainted = false;
      stageEl.classList.add('is-plain');
      routeNoteEl.textContent = msg;
      syncControlsUI(null);
    },
    onRestore: () => {
      exitPlainFallback();
      if (stage && !stage.lost) {
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.backend = 'webgl';
        state.hasPainted = false;
        state.dirty = true;
        padTexCache.delete(padEl);
        unitCache.delete(canvas);
        routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL canvas.';
        canvas.requestPaint?.();
        requestDraw();
      } else if (ctx2d) {
        state.backend = '2d';
        state.hasPainted = false;
        unitCache.delete(canvas);
        routeNoteEl.textContent = '2D canvas context restored.';
        canvas.requestPaint?.();
        requestDraw();
      }
    },
  });

  if (routeParam === 'plain') {
    enterPlainFallback('Plain HTML fallback selected via ?route=plain.');
    return;
  }

  if (routeParam !== '2d' && glSupported && api2dSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: IMPACT_FRAG,
        attributes: {
          alpha: false,
          depth: false,
          antialias: false,
          preserveDrawingBuffer: true,
          powerPreference: 'low-power',
        },
        onLost: () => {
          state.texUploaded = false;
          state.hasPainted = false;
          state.dirty = true;
          padTexCache.delete(padEl);
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.hasPainted = false;
          state.dirty = true;
          padTexCache.delete(padEl);
          unitCache.delete(canvas);
          canvas.requestPaint?.();
          requestDraw();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.backend = 'webgl';
      routeNoteEl.textContent = 'Running on WebGL 2 via one ElementGL context with normal-mapped dent shading and 4-ring elastic shockwaves.';
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back.`;
    }
  }

  if (state.backend === 'none' && api2dSupported) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNoteEl.textContent = routeParam === '2d'
        ? '2D 5-argument drawElementImage() ring overlay fallback selected via ?route=2d.'
        : 'WebGL 2 texElementSubImage2D() is unavailable here; running the 2D 5-argument drawElementImage() ring overlay fallback.';
    }
  }

  if (state.backend === 'none') {
    enterPlainFallback('HTML-in-canvas is unavailable here, so the 3x2 pad is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    state.hasPainted = true;
    state.paints++;
    state.dirty = true;
    if (state.backend === 'webgl') renderWebGL(performance.now());
    else if (state.backend === '2d') render2DFallback(performance.now());
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      unitCache.delete(canvas);
      const { cw, ch } = getViewportSize();
      syncPadSize(cw, ch);
      syncPadGeometry(true);
      requestDraw();
    }).observe(viewportEl);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      state.onScreen = visible;
      if (!visible) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        requestDraw();
      }
    }, { rootMargin: '120px' }).observe(viewportEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    } else if (state.onScreen) {
      requestDraw();
    }
  });

  const { cw, ch } = getViewportSize();
  syncPadSize(cw, ch);
  syncPadGeometry(true);
  canvas.requestPaint?.();
  requestDraw();
}

// Toolbar events
for (const b of modeBtns) {
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode === 'flat' ? 'flat' : 'gpu';
    if (state.mode === 'flat') {
      state.press = null;
      state.releaseDecay = null;
      state.waves = [];
      routeNoteEl.textContent = 'Flat CSS press mode: only the pressed tile scales locally, with zero neighbour wave distortion.';
    } else {
      clearTilePressClasses();
      routeNoteEl.textContent = state.backend === 'webgl'
        ? 'GPU dent + wave mode: pointerdown dents the pad and release sends damped shockwaves across neighbours.'
        : '2D ring overlay fallback active.';
    }
    requestDraw();
  });
}

pulseBtn.addEventListener('click', () => {
  const { cw, ch } = getViewportSize();
  if (isReducedMotion()) {
    routeNoteEl.textContent = 'Reduced motion is on: shockwave propagation stays paused.';
    return;
  }
  if (state.mode === 'flat') {
    const centerTile = tiles[1];
    centerTile?.classList.add('is-pressed');
    setTimeout(() => centerTile?.classList.remove('is-pressed'), 140);
    routeNoteEl.textContent = 'Flat CSS press is active: Drop pulse flashed one local tile without rippling neighbours.';
    return;
  }
  const now = performance.now();
  state.releaseDecay = { x: cw * 0.5, y: ch * 0.54, upMs: now, depth: 0.9 };
  launchWaveAt(cw * 0.5, ch * 0.54, 1.25, now);
});

ctlStiffness.addEventListener('input', () => {
  state.stiffness = Number(ctlStiffness.value);
  requestDraw();
});

ctlDamping.addEventListener('input', () => {
  state.damping = Number(ctlDamping.value);
  requestDraw();
});

function handleReducedChange() {
  if (isReducedMotion()) {
    state.press = null;
    state.releaseDecay = null;
    state.waves = [];
    clearTilePressClasses();
  }
  requestDraw();
}

if (reducedQuery) {
  reducedQuery.addEventListener('change', () => {
    ctlReduced.checked = reducedQuery.matches;
    handleReducedChange();
  });
}
ctlReduced.addEventListener('change', handleReducedChange);

// Pad interactions
padEl.addEventListener('selectstart', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('input, textarea')) {
    e.preventDefault();
  }
});

padEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (e.target instanceof Element && e.target.closest('input, textarea')) return;

  const tile = e.target instanceof Element ? e.target.closest('.ti-tile') : null;
  if (tile && (state.mode === 'flat' || state.backend === 'plain' || isReducedMotion())) {
    tile.classList.add('is-pressed');
  }
  if (state.backend === 'plain' || state.mode === 'flat' || isReducedMotion()) return;

  const pos = pointerPosInCanvas(e.clientX, e.clientY);
  state.releaseDecay = null;
  state.press = {
    id: e.pointerId,
    x: pos.x,
    y: pos.y,
    downMs: performance.now(),
    target: e.target,
    active: true,
  };
  requestDraw();
});

window.addEventListener('pointermove', (e) => {
  const p = state.press;
  if (!p || !p.active || e.pointerId !== p.id) return;
  const pos = pointerPosInCanvas(e.clientX, e.clientY);
  p.x = pos.x;
  p.y = pos.y;
  requestDraw();
});

function finishPointerPress(e, cancelled = false) {
  clearTilePressClasses();
  const p = state.press;
  if (!p || e.pointerId !== p.id) return;
  const now = performance.now();
  const pos = pointerPosInCanvas(e.clientX, e.clientY);
  const physics = wavePhysics(state.stiffness, state.damping);
  const storedDent = computeDentDepth(Math.max(0, now - p.downMs), physics.dentStrength);
  state.press = null;
  state.lastPointerReleaseMs = now;

  if (!cancelled && state.mode === 'gpu' && !isReducedMotion() && state.backend !== 'plain') {
    state.releaseDecay = { x: pos.x, y: pos.y, upMs: now, depth: storedDent };
    const energy = clamp(Math.max(0.88, storedDent * 1.15), 0.1, 1.35);
    launchWaveAt(pos.x, pos.y, energy, now);
  } else {
    requestDraw();
  }
}

window.addEventListener('pointerup', (e) => finishPointerPress(e, false));
window.addEventListener('pointercancel', (e) => finishPointerPress(e, true));

padEl.addEventListener('click', (e) => {
  const tile = e.target instanceof Element ? e.target.closest('.ti-tile') : null;
  if (!tile) return;

  const idx = Number(tile.dataset.pad);
  const kind = tile.dataset.kind;
  state.counts[idx] = (state.counts[idx] || 0) + 1;
  state.totalHits++;
  totalOut.textContent = `${String(state.totalHits).padStart(3, '0')} HITS`;

  if (kind === 'switch') {
    state.switches[idx] = !state.switches[idx];
    const on = state.switches[idx];
    tile.setAttribute('aria-checked', String(on));
    const badge = tile.querySelector('[data-state]');
    if (badge) badge.textContent = `${on ? 'ON' : 'OFF'} · ${state.counts[idx]}`;
  } else {
    const countEl = tile.querySelector('[data-count]');
    if (countEl) countEl.textContent = String(state.counts[idx]);
    tile.classList.add('is-lit');
    setTimeout(() => {
      tile.classList.remove('is-lit');
      state.dirty = true;
      canvas.requestPaint?.();
      requestDraw();
    }, 180);
  }

  state.dirty = true;
  canvas.requestPaint?.();

  const now = performance.now();
  if (e.detail === 0 || now - state.lastPointerReleaseMs > 180) {
    const tr = tile.getBoundingClientRect();
    const pos = pointerPosInCanvas(tr.left + tr.width * 0.5, tr.top + tr.height * 0.5);
    launchWaveAt(pos.x, pos.y, 1.0, now);
  } else {
    requestDraw();
  }
});

labelInput.addEventListener('input', () => {
  state.dirty = true;
  canvas.requestPaint?.();
  requestDraw();
});

for (const evName of ['focus', 'focusin', 'focusout']) {
  padEl.addEventListener(evName, () => {
    state.dirty = true;
    canvas.requestPaint?.();
    requestDraw();
  }, evName === 'focus');
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

function sampleCssPixel(img, cssX, cssY, cw, ch) {
  const sx = img.width / cw;
  const sy = img.height / ch;
  const px = clamp(Math.round(cssX * sx), 0, img.width - 1);
  const py = clamp(Math.round(cssY * sy), 0, img.height - 1);
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const lumOf = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];

async function waitForRetiredGL() {
  for (let i = 0; i < 16; i++) {
    if ((window.__gfx?.active?.() ?? 0) <= 1) return;
    await new Promise((r) => setTimeout(r, 80));
  }
}

runTests(testsBody, [
  {
    name: 'ElementGL uploads live pad via texElementSubImage2D() with gl.getError() === 0',
    why: 'Allocates one isolated ElementGL fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), and checks uploaded pad pixels and GL error.',
    timeout: 6000,
    run: async () => {
      if (!glSupported || !api2dSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 160;
      const cv = makeFixtureCanvas(cw, ch);
      const fixPad = document.createElement('div');
      fixPad.setAttribute('drawable', '');
      fixPad.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#cfd6df;border:4px solid #16181d;box-sizing:border-box;`;
      cv.append(fixPad);

      const g = new ElementGL(cv, {
        fragment: IMPACT_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.04, 0.06, 0.1, 1])) throw new Error('ElementGL.begin() returned false');
        const tex = g.upload(fixPad);
        if (!tex) throw new Error('stage.upload() returned null');
        const emptyWaves = new Float32Array(16);
        g.quad(fixPad, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
          gl.uniform2f(u('uCanvasSize'), cw, ch);
          gl.uniform2f(u('uPressPos'), 0, 0);
          gl.uniform1f(u('uDentDepth'), 0);
          gl.uniform1f(u('uDentRadius'), 80);
          const uWaves = u('uWaves[0]') ?? u('uWaves');
          if (uWaves) gl.uniform4fv(uWaves, emptyWaves);
          gl.uniform4f(u('uWaveParams'), 0.1, 35, 0.004, 1.9);
          gl.uniform2f(u('uWaveSpeedDisp'), 370, 12);
          gl.uniform1f(u('uHasWaves'), 0);
        });
        const glErr = g.gl.getError();
        if (glErr !== 0) throw new Error(`gl.getError() returned 0x${glErr.toString(16)}`);
        const img = readPlainCopyImageData(cv);
        const px = sampleCssPixel(img, 120, 80, cw, ch);
        if (px[0] < 185 || px[1] < 190 || px[2] < 200) {
          throw new Error(`expected matte pad pixel ~#cfd6df, got rgba(${px.join(',')})`);
        }
        return `tex ${tex.w}x${tex.h}, glErr=0, centre rgba(${px.join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Press dent shading darkens centre and brightens rim lip vs rest',
    why: 'Renders a matte pad with a vertical reference stripe at x=150 under uDentDepth = 0 vs 1.15 around (120, 90), checking concave centre darkening, rim brightening and inward pixel pull.',
    timeout: 6000,
    run: async () => {
      if (!glSupported || !api2dSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      await waitForRetiredGL();
      const cw = 240, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);
      const fixPad = document.createElement('div');
      fixPad.setAttribute('drawable', '');
      fixPad.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#cfd4dc;position:relative;`;
      const stripe = document.createElement('div');
      stripe.style.cssText = 'position:absolute;left:150px;top:0;width:8px;height:180px;background:#16181d;';
      fixPad.append(stripe);
      cv.append(fixPad);

      const g = new ElementGL(cv, {
        fragment: IMPACT_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.04, 0.06, 0.1, 1])) throw new Error('ElementGL.begin() returned false');
        g.upload(fixPad);
        const emptyWaves = new Float32Array(16);

        const drawDent = (depth) => {
          g.begin([0.04, 0.06, 0.1, 1]);
          g.quad(fixPad, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
            gl.uniform2f(u('uCanvasSize'), cw, ch);
            gl.uniform2f(u('uPressPos'), 120, 90);
            gl.uniform1f(u('uDentDepth'), depth);
            gl.uniform1f(u('uDentRadius'), 58);
            const uWaves = u('uWaves[0]') ?? u('uWaves');
            if (uWaves) gl.uniform4fv(uWaves, emptyWaves);
            gl.uniform4f(u('uWaveParams'), 0.1, 35, 0.004, 1.9);
            gl.uniform2f(u('uWaveSpeedDisp'), 370, 12);
            gl.uniform1f(u('uHasWaves'), 0);
          });
          return readPlainCopyImageData(cv);
        };

        const restImg = drawDent(0);
        const dentImg = drawDent(1.15);

        const restCtr = lumOf(sampleCssPixel(restImg, 120, 90, cw, ch));
        const dentCtr = lumOf(sampleCssPixel(dentImg, 120, 90, cw, ch));

        // Top-left rim at r = 59 px (~42 px left & 42 px up from 120, 90 -> 78, 48)
        const restRim = lumOf(sampleCssPixel(restImg, 78, 48, cw, ch));
        const dentRim = lumOf(sampleCssPixel(dentImg, 78, 48, cw, ch));

        // Inward pull test: x=144 is 6 px left of dark stripe [150..158], pulled closer to 120 under dent
        const restNearStripe = lumOf(sampleCssPixel(restImg, 144, 90, cw, ch));
        const dentNearStripe = lumOf(sampleCssPixel(dentImg, 144, 90, cw, ch));

        if (dentCtr >= restCtr - 20 || dentRim <= restRim + 15 || dentNearStripe >= restNearStripe - 20) {
          throw new Error(
            `dent check failed: ctr ${restCtr.toFixed(0)}->${dentCtr.toFixed(0)}, rim ${restRim.toFixed(0)}->${dentRim.toFixed(0)}, pull144 ${restNearStripe.toFixed(0)}->${dentNearStripe.toFixed(0)}`
          );
        }
        return `centre lum ${restCtr.toFixed(0)}->${dentCtr.toFixed(0)}, rim lip ${restRim.toFixed(0)}->${dentRim.toFixed(0)}, pull x144 ${restNearStripe.toFixed(0)}->${dentNearStripe.toFixed(0)}`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Release shockwave crests ripple outward to neighbouring tile before decaying to 0 (tMs)',
    why: 'Verifies 4-ring deterministic stepImpactWaves(..., tMs) decay to 0, then checks radial border warp and specular crest highlights on a neighbouring tile at t = 260 ms returning identically to rest at t = 5000 ms.',
    timeout: 6000,
    run: async () => {
      if (!glSupported || !api2dSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      await waitForRetiredGL();

      // Verify deterministic 4-ring tMs solver
      let rings = [];
      rings = pushImpactWave(rings, 50, 80, 1000, 1.0);
      rings = pushImpactWave(rings, 110, 80, 1040, 1.1);
      rings = pushImpactWave(rings, 170, 80, 1080, 0.9);
      rings = pushImpactWave(rings, 50, 140, 1120, 1.0);
      const sActive = stepImpactWaves({ waves: rings, stiffness: 5, damping: 4, mode: 'gpu', tMs: 1280, reducedMotion: false });
      const sSettled = stepImpactWaves({ waves: rings, stiffness: 5, damping: 4, mode: 'gpu', tMs: 6500, reducedMotion: false });
      const sReduced = stepImpactWaves({ waves: rings, stiffness: 5, damping: 4, mode: 'gpu', tMs: 1280, reducedMotion: true });
      if (sActive.activeCount !== 4 || sActive.peakSpeed <= 50 || !sSettled.settled || sSettled.peakSpeed !== 0 || !sReduced.settled) {
        throw new Error(`wave solver failed: active=${sActive.activeCount}, speed=${sActive.peakSpeed.toFixed(1)}, settled=${sSettled.settled}`);
      }

      const cw = 240, ch = 160;
      const cv = makeFixtureCanvas(cw, ch);
      const fixPad = document.createElement('div');
      fixPad.setAttribute('drawable', '');
      fixPad.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#111622;position:relative;`;
      const tileR = document.createElement('div');
      tileR.style.cssText = 'position:absolute;left:134px;top:24px;width:86px;height:112px;background:#cfd6df;border-left:5px solid #d2491f;box-sizing:border-box;';
      fixPad.append(tileR);
      cv.append(fixPad);

      const g = new ElementGL(cv, {
        fragment: IMPACT_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.04, 0.06, 0.1, 1])) throw new Error('ElementGL.begin() returned false');
        g.upload(fixPad);
        const wBuf = new Float32Array(16);

        const renderAtMs = (tMs) => {
          const single = [{ x: 56, y: 80, startMs: 1000, energy: 1.25 }];
          const st = stepImpactWaves({ waves: single, stiffness: 5, damping: 4, mode: 'gpu', tMs, reducedMotion: false });
          packWaveUniforms(st.activeWaves, wBuf);
          g.begin([0.04, 0.06, 0.1, 1]);
          g.quad(fixPad, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
            gl.uniform2f(u('uCanvasSize'), cw, ch);
            gl.uniform2f(u('uPressPos'), 0, 0);
            gl.uniform1f(u('uDentDepth'), 0);
            gl.uniform1f(u('uDentRadius'), st.dentRadius);
            const uWaves = u('uWaves[0]') ?? u('uWaves');
            if (uWaves) gl.uniform4fv(uWaves, wBuf);
            gl.uniform4f(u('uWaveParams'), st.physics.k, st.physics.w, st.physics.rDecay, st.physics.tDecay);
            gl.uniform2f(u('uWaveSpeedDisp'), st.physics.speed, 12.0);
            gl.uniform1f(u('uHasWaves'), st.activeCount > 0 ? 1.0 : 0.0);
          });
          return { st, img: readPlainCopyImageData(cv) };
        };

        const rest = renderAtMs(6500);
        const mid = renderAtMs(1280);
        const settledAfter = renderAtMs(7000);

        let maxNeighbourDiff = 0;
        let maxRestoredDiff = 0;
        for (let sx = 132; sx <= 190; sx += 2) {
          const p0 = sampleCssPixel(rest.img, sx, 80, cw, ch);
          const p1 = sampleCssPixel(mid.img, sx, 80, cw, ch);
          const p2 = sampleCssPixel(settledAfter.img, sx, 80, cw, ch);
          const dMid = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]) + Math.abs(p1[2] - p0[2]);
          const dEnd = Math.abs(p2[0] - p0[0]) + Math.abs(p2[1] - p0[1]) + Math.abs(p2[2] - p0[2]);
          if (dMid > maxNeighbourDiff) maxNeighbourDiff = dMid;
          if (dEnd > maxRestoredDiff) maxRestoredDiff = dEnd;
        }

        if (maxNeighbourDiff < 25 || maxRestoredDiff > 0) {
          throw new Error(`wave neighbour check failed: maxDiff280ms=${maxNeighbourDiff}, settledDiff=${maxRestoredDiff}`);
        }
        return `4 rings OK; 280ms neighbour diff=${maxNeighbourDiff}, settled speed=${settledAfter.st.peakSpeed}, restDiff=${maxRestoredDiff}`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await waitForRetiredGL();
      }
    },
  },
  {
    name: 'updateElementGeometry() routes live clicks and <input> focus inside the 3x2 pad',
    why: 'Builds an isolated 3x2 pad fixture with buttons, a switch and an <input inputmode="none">, aligns updateElementGeometry() via geometryUnit() and data-hit-tick, and verifies elementsFromPoint(), clicks and focus.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !api2dSupported) {
        throw new Error('updateElementGeometry() or drawElementImage() is not available');
      }
      const cw = 260, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);
      const fixPad = document.createElement('div');
      fixPad.setAttribute('drawable', '');
      fixPad.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#161c28;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'none';
      inp.value = 'PAD LABEL';
      inp.setAttribute('aria-label', 'Fixture pad label');
      inp.style.cssText = 'width:100%;height:32px;box-sizing:border-box;';

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;flex:1;';
      let padHits = 0;
      let swState = false;
      const btns = [];
      for (let i = 0; i < 6; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = i === 2 ? 'SW' : `P${i + 1}`;
        if (i === 2) {
          b.setAttribute('role', 'switch');
          b.setAttribute('aria-checked', 'false');
        }
        b.addEventListener('click', () => {
          padHits++;
          if (i === 2) {
            swState = !swState;
            b.setAttribute('aria-checked', String(swState));
          }
        });
        btns.push(b);
        grid.append(b);
      }

      fixPad.append(inp, grid);
      cv.append(fixPad);

      try {
        const c2 = cv.getContext('2d');
        await nextPaint(cv);
        c2.drawElementImage(fixPad, 0, 0, cw, ch);
        const u = geometryUnit(cv, fixPad, cw);
        cv.updateElementGeometry(fixPad, { canvasTransform: new DOMMatrix().scale(u, u, 1) });
        fixPad.dataset.hitTick = fixPad.dataset.hitTick === '1' ? '0' : '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const hitTargets = [];
        for (const el of [btns[0], btns[2], btns[5], inp]) {
          const r = el.getBoundingClientRect();
          const hits = document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
          hitTargets.push(hits.includes(el));
        }
        btns[0].click();
        btns[2].click();
        btns[5].click();
        inp.focus({ preventScroll: true });
        const inpFocused = document.activeElement === inp;
        inp.blur();

        if (!hitTargets.every(Boolean) || padHits !== 3 || !swState || !inpFocused) {
          throw new Error(`hit check failed: hits=[${hitTargets.join(',')}], clicks=${padHits}, sw=${swState}, focus=${inpFocused}`);
        }
        return `4/4 hit points matched; clicks=${padHits}, switch=${swState}, input focused=${inpFocused}`;
      } finally {
        try { inp.blur(); } catch {}
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-arg 2D drawElementImage() ring fallback work',
    why: 'Dispatches cancelable webglcontextlost and webglcontextrestored without loseContext(), confirming #plain-host move and restore, then draws a DPR-scaled 2D fixture with 5-argument drawElementImage().',
    timeout: 6000,
    run: async () => {
      const box = document.createElement('div');
      box.style.cssText = 'position:relative;width:180px;height:120px;';
      const vp = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.width = 180;
      cv.height = 120;
      const fixPad = document.createElement('div');
      fixPad.setAttribute('drawable', '');
      fixPad.textContent = 'Pad fixture';
      const ph = document.createElement('div');
      ph.hidden = true;
      cv.append(fixPad);
      vp.append(cv);
      box.append(vp, ph);
      testStage().append(box);

      let restored = false;
      attachContextLossController({
        targetCanvas: cv,
        targetViewport: vp,
        targetElements: [fixPad],
        targetPlainHost: ph,
        onRestore: () => { restored = true; },
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const fellBack = lostEv.defaultPrevented && vp.hidden && !ph.hidden && ph.contains(fixPad) && !fixPad.inert;
      cv.dispatchEvent(new Event('webglcontextrestored'));
      const cameBack = restored && !vp.hidden && ph.hidden && cv.contains(fixPad);
      box.remove();
      window.__gfx?.retire?.(cv);
      if (!fellBack || !cameBack) {
        throw new Error(`context fallback/restore failed (fellBack=${fellBack}, cameBack=${cameBack})`);
      }

      if (!api2dSupported) throw new Error('2D drawElementImage() is not available');
      const cw = 200, ch = 140;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const c2 = makeFixtureCanvas(Math.round(cw * dpr), Math.round(ch * dpr));
      c2.style.width = `${cw}px`;
      c2.style.height = `${ch}px`;
      const dPad = document.createElement('div');
      dPad.setAttribute('drawable', '');
      dPad.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#eae5da;border:4px solid #16181d;box-sizing:border-box;`;
      c2.append(dPad);
      try {
        const ctx = c2.getContext('2d');
        await nextPaint(c2);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawElementImage(dPad, 0, 0, cw, ch);
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cw * 0.5, ch * 0.5, 42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const img = readPlainCopyImageData(c2);
        const frac = inkFraction(img);
        const noSize = window.__gfx?.draws?.noSize ?? 0;
        const wrong = window.__gfx?.draws?.wrong ?? 0;
        if (frac < 0.9 || noSize > 0 || wrong > 0) {
          throw new Error(`2D fallback failed: ink=${(frac * 100).toFixed(1)}%, noSize=${noSize}, wrong=${wrong}`);
        }
        return `loss->plain->restored OK; 5-arg 2D ink=${(frac * 100).toFixed(0)}%, wrongDraws=${wrong}`;
      } finally {
        c2.remove();
        window.__gfx?.retire?.(c2);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'tactile-impact stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (!state.hasPainted || !canvas.width || !canvas.height) return 0;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !state.texUploaded) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          renderWebGL(performance.now());
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
