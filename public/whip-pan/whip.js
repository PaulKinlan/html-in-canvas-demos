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

export const DIRECTIONS = {
  left: { key: 'left', label: 'Left', x: -1, y: 0 },
  right: { key: 'right', label: 'Right', x: 1, y: 0 },
  up: { key: 'up', label: 'Up', x: 0, y: -1 },
  down: { key: 'down', label: 'Down', x: 0, y: 1 },
};

const SHOWCASE_STEPS = ['left', 'up', 'right', 'down'];
const CUT_DURATION_MS = 480;
const SHOWCASE_DWELL_MS = 2100;
const INITIAL_SHOWCASE_DELAY_MS = 3500;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const routeParam = new URLSearchParams(location.search).get('route');

// DOM references
const stageEl = document.getElementById('wp-stage');
const viewportEl = document.getElementById('wp-viewport');
const canvas = document.getElementById('wp-canvas');
const sceneA = document.getElementById('wp-scene-a');
const sceneB = document.getElementById('wp-scene-b');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('wp-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests');

// Toolbar controls
const dirBtns = Array.from(document.querySelectorAll('#wp-dir-group button[data-dir]'));
const btnAuto = document.getElementById('btn-auto');
const ctlScrub = document.getElementById('ctl-scrub');
const outScrub = document.getElementById('out-scrub');
const ctlBlur = document.getElementById('ctl-blur');
const outBlur = document.getElementById('out-blur');
const ctlReduced = document.getElementById('ctl-reduced');

// Scene A controls
const titleInputA = document.getElementById('wp-title-a');
const tcOutA = document.getElementById('wp-tc-a');
const noteA = document.getElementById('wp-note-a');
const beatBtns = Array.from(sceneA.querySelectorAll('.wp-beat-btn'));
const markBtnA = document.getElementById('wp-mark-a');
const cutToBBtn = document.getElementById('wp-cut-to-b');

// Scene B controls
const titleInputB = document.getElementById('wp-title-b');
const tcOutB = document.getElementById('wp-tc-b');
const noteB = document.getElementById('wp-note-b');
const trackBtns = Array.from(sceneB.querySelectorAll('.wp-track-btn'));
const markBtnB = document.getElementById('wp-mark-b');
const cutToABtn = document.getElementById('wp-cut-to-a');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;
if (reducedQuery?.matches) ctlReduced.checked = true;

// #region whip-math
/**
 * Bell-curve GPU velocity factor peaking at 1.0 near progress = 0.5 (50%)
 * and tapering smoothly to 0.0 when settled at 0% or 100%.
 */
export function whipBellVelocity(progress) {
  const p = clamp(progress, 0, 1);
  const bell = Math.pow(Math.sin(Math.PI * p), 1.35);
  const over = progress < 0
    ? Math.min(0.25, -progress * 4)
    : progress > 1
      ? Math.min(0.25, (progress - 1) * 4)
      : 0;
  return Math.max(bell, over);
}

/**
 * Fast whip-pan drive with a damped spring overshoot landing around u = 0.65..1.0.
 */
export function whipOvershootCurve(u) {
  const t = clamp(u, 0, 1);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const s = Math.min(1, t / 0.62);
  const base = s * s * s * (s * (s * 6 - 15) + 10);
  const post = Math.max(0, (t - 0.48) / 0.52);
  const fade = Math.pow(1 - post, 2);
  const wave = Math.sin(post * Math.PI * 1.85);
  return base + 0.18 * post * fade * wave;
}

/**
 * Evaluate whip-pan transition state at an explicit timestamp `tMs`.
 * Returns `{ progress, velocity, settled }` deterministically.
 */
export function stepWhipCut(anim, tMs, reducedMotion = false) {
  if (!anim) return { progress: 0, velocity: 0, settled: true };
  if (reducedMotion || anim.durMs <= 0) {
    return { progress: anim.to, velocity: 0, settled: true };
  }
  const u = clamp((tMs - anim.startMs) / anim.durMs, 0, 1);
  if (u >= 1) {
    return { progress: anim.to, velocity: 0, settled: true };
  }
  const e = whipOvershootCurve(u);
  const progress = anim.from + (anim.to - anim.from) * e;
  const velocity = whipBellVelocity(progress);
  return { progress, velocity, settled: false };
}

/**
 * Compute CSS pixel offsets for Scene A and Scene B given progress and whip vector.
 */
export function computeWhipOffsets(cw, ch, progress, panDirX, panDirY) {
  return {
    ax: progress * panDirX * cw,
    ay: progress * panDirY * ch,
    bx: (progress - 1) * panDirX * cw,
    by: (progress - 1) * panDirY * ch,
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

function setSceneBox(targetCanvas, el, active, unit) {
  if (typeof targetCanvas.updateElementGeometry !== 'function' || !OFFSTAGE) return;
  const mat = active ? new DOMMatrix().scale(unit, unit, 1) : OFFSTAGE;
  targetCanvas.updateElementGeometry(el, { canvasTransform: mat });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

export function syncSceneGeometry(force = false) {
  if (state.backend === 'plain') return;
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 358);
  const settledA = state.progress <= 0.005 && !state.anim && !state.drag;
  const settledB = state.progress >= 0.995 && !state.anim && !state.drag;

  if (sceneA.inert !== !settledA) sceneA.inert = !settledA;
  if (sceneB.inert !== !settledB) sceneB.inert = !settledB;
  const peA = settledA ? 'auto' : 'none';
  const peB = settledB ? 'auto' : 'none';
  if (sceneA.style.pointerEvents !== peA) sceneA.style.pointerEvents = peA;
  if (sceneB.style.pointerEvents !== peB) sceneB.style.pointerEvents = peB;

  const refEl = settledB ? sceneB : sceneA;
  const u = cachedGeometryUnit(canvas, refEl, cw);
  const entry = unitCache.get(canvas);
  const geoKey = `${cw}|${settledA ? 1 : 0}|${settledB ? 1 : 0}|${u.toFixed(4)}`;
  if (!force && entry && entry.lastGeoKey === geoKey) return;
  if (entry) entry.lastGeoKey = geoKey;

  setSceneBox(canvas, sceneA, settledA, u);
  setSceneBox(canvas, sceneB, settledB, u);
}
// #endregion whip-math

// #region whip-shader
export const WHIP_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;    // Scene A (#wp-scene-a)
uniform sampler2D uSceneB; // Scene B (#wp-scene-b)
uniform vec2 uCanvasSize;  // CSS px (cw, ch)
uniform float uProgress;   // 0..1 (plus damped spring overshoot)
uniform vec2 uPanDir;      // unit whip vector in CSS screen coords
uniform float uVelocity;   // 0..1 bell-curve velocity peaking near 50%
uniform float uBlurPx;     // 0..64 px directional smear span

in vec2 vUv;
out vec4 outColor;

const vec3 BACKDROP = vec3(0.027, 0.043, 0.078);

vec3 samplePair(vec2 uv) {
  vec2 uvA = uv - uProgress * uPanDir;
  vec2 uvB = uv - (uProgress - 1.0) * uPanDir;

  bool inA = uvA.x >= 0.0 && uvA.x <= 1.0 && uvA.y >= 0.0 && uvA.y <= 1.0;
  bool inB = uvB.x >= 0.0 && uvB.x <= 1.0 && uvB.y >= 0.0 && uvB.y <= 1.0;

  if (inA) {
    vec4 t = texture(uTex, clamp(uvA, 0.0, 1.0));
    return t.rgb + BACKDROP * (1.0 - t.a);
  }
  if (inB) {
    vec4 t = texture(uSceneB, clamp(uvB, 0.0, 1.0));
    return t.rgb + BACKDROP * (1.0 - t.a);
  }
  return BACKDROP;
}

void main() {
  float blurSpanPx = uVelocity * uBlurPx;

  if (blurSpanPx <= 0.15) {
    if (abs(uProgress) <= 0.0005) {
      vec4 t = texture(uTex, vUv);
      outColor = vec4(t.rgb + BACKDROP * (1.0 - t.a), 1.0);
      return;
    }
    if (abs(uProgress - 1.0) <= 0.0005) {
      vec4 t = texture(uSceneB, vUv);
      outColor = vec4(t.rgb + BACKDROP * (1.0 - t.a), 1.0);
      return;
    }
    outColor = vec4(samplePair(vUv), 1.0);
    return;
  }

  vec2 invSize = 1.0 / max(uCanvasSize, vec2(1.0));
  vec2 blurStepUv = uPanDir * blurSpanPx * invSize;
  // Subtle RGB velocity fringe offset proportional to bell velocity and blur px.
  vec2 fringeUv = uPanDir * (uVelocity * (0.75 + 0.065 * uBlurPx)) * invSize;
  // Interleaved gradient noise breaks 16-tap discrete comb echoes into smooth streaks.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;

  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int i = 0; i < 16; i++) {
    float s = (float(i) + 0.5 + ign) / 16.0 - 0.5;
    float w = 1.0 - 0.35 * abs(s * 2.0);
    vec2 tapUv = vUv - s * blurStepUv;
    float r = samplePair(tapUv + fringeUv).r;
    float g = samplePair(tapUv).g;
    float b = samplePair(tapUv - fringeUv).b;
    acc += vec3(r, g, b) * w;
    wSum += w;
  }

  vec3 col = acc / max(wSum, 0.001);
  float axisPos = dot(vUv - 0.5, uPanDir);
  float streakGain = 1.0 + 0.05 * uVelocity * (1.0 - abs(axisPos) * 2.0);
  outColor = vec4(clamp(col * streakGain, 0.0, 1.0), 1.0);
}`;
// #endregion whip-shader

// ---------------- State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  dir: 'left',
  panSign: 1,
  progress: 0,
  velocity: 0,
  blurPx: Number(ctlBlur.value),
  anim: null,
  drag: null,
  autoShowcase: !isReducedMotion() && !isBench && routeParam !== 'plain',
  showcaseStep: 0,
  suppressClick: false,
  onScreen: true,
  hasPainted: false,
  dirtyA: true,
  dirtyB: true,
  texUploaded: false,
  uploads: 0,
  paints: 0,
  takesA: 1,
  markersB: 1,
  activeBeat: '01A',
  tracks: { v2: true, v1: true, a1: true },
  needsDraw: true,
};

let stage = null;
let ctx2d = null;
let rafId = 0;
let idleTimer = 0;

function isReducedMotion() {
  return Boolean(ctlReduced.checked || reducedQuery?.matches);
}

function getEffectiveDir() {
  const d = DIRECTIONS[state.dir] || DIRECTIONS.left;
  return { x: d.x * state.panSign, y: d.y * state.panSign };
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 358);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 392);
  return { cw, ch };
}

function syncSceneSizes(cw, ch) {
  if (state.backend === 'plain') {
    for (const s of [sceneA, sceneB]) {
      if (s.style.width) s.style.width = '';
      if (s.style.height) s.style.height = '';
    }
    return;
  }
  const wStr = `${cw}px`;
  const hStr = `${ch}px`;
  for (const s of [sceneA, sceneB]) {
    if (s.style.width !== wStr) s.style.width = wStr;
    if (s.style.height !== hStr) s.style.height = hStr;
  }
}

function syncControlsUI() {
  const pct = Math.round(clamp(state.progress, 0, 1) * 100);
  if (Number(ctlScrub.value) !== pct) ctlScrub.value = String(pct);
  outScrub.textContent = `${pct}%`;
  outBlur.textContent = `${state.blurPx} px`;
  for (const b of dirBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.dir === state.dir));
  }
  btnAuto.setAttribute('aria-pressed', String(state.autoShowcase));

  const routeLabel = state.backend === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.backend === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const sceneLabel = state.progress <= 0.01
    ? 'View A settled'
    : state.progress >= 0.99
      ? 'View B settled'
      : `Whip ${pct}%`;
  const velPct = Math.round(state.velocity * 100);
  hudEl.textContent = `${routeLabel} · ${sceneLabel} · dir ${state.dir} · vel ${velPct}% · blur ${state.blurPx} px`;
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = 0;
  }
}

function stopShowcase() {
  state.autoShowcase = false;
  clearIdleTimer();
  syncControlsUI();
}

function scheduleShowcaseStep(delayMs = SHOWCASE_DWELL_MS) {
  clearIdleTimer();
  if (!state.autoShowcase || isReducedMotion() || !state.onScreen || document.hidden || state.backend === 'plain') {
    return;
  }
  idleTimer = setTimeout(() => {
    idleTimer = 0;
    if (!state.autoShowcase || isReducedMotion() || !state.onScreen || document.hidden || state.backend === 'plain') return;
    if (sceneA.contains(document.activeElement) || sceneB.contains(document.activeElement)) {
      stopShowcase();
      return;
    }
    if (state.anim || state.drag) {
      scheduleShowcaseStep(400);
      return;
    }
    const dirKey = SHOWCASE_STEPS[state.showcaseStep % SHOWCASE_STEPS.length];
    state.showcaseStep++;
    triggerWhipCut(dirKey, { fromAuto: true });
  }, delayMs);
}

// ---------------- Upload, Render & Fallbacks ----------------

// #region paint-upload
const sceneTexCache = new WeakMap();

function uploadScene(el) {
  if (!stage || stage.lost || !state.hasPainted) return false;
  try {
    const tex = stage.upload(el);
    if (!tex) return false;
    sceneTexCache.set(el, tex);
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

function renderWebGL() {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  syncSceneSizes(cw, ch);

  // Call stage.begin() before stage.upload() so the buffer size matches DPR first.
  if (!stage.begin([0.027, 0.043, 0.078, 1])) return;

  if (state.dirtyA || !sceneTexCache.has(sceneA)) {
    if (uploadScene(sceneA)) state.dirtyA = false;
  }
  if (state.dirtyB || !sceneTexCache.has(sceneB)) {
    if (uploadScene(sceneB)) state.dirtyB = false;
  }
  const bEntry = sceneTexCache.get(sceneB);
  if (!sceneTexCache.has(sceneA) || !bEntry) return;
  state.texUploaded = true;

  const eff = getEffectiveDir();
  stage.quad(sceneA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bEntry.tex);
    gl.uniform1i(u('uSceneB'), 1);
    gl.uniform2f(u('uCanvasSize'), cw, ch);
    gl.uniform1f(u('uProgress'), state.progress);
    gl.uniform2f(u('uPanDir'), eff.x, eff.y);
    gl.uniform1f(u('uVelocity'), state.velocity);
    gl.uniform1f(u('uBlurPx'), state.blurPx);
  });

  syncSceneGeometry(false);
  syncControlsUI();
}

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

  const eff = getEffectiveDir();
  const off = computeWhipOffsets(cw, ch, state.progress, eff.x, eff.y);
  const settledA = state.progress <= 0.005 && !state.anim && !state.drag;
  const settledB = state.progress >= 0.995 && !state.anim && !state.drag;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#070b14';
  ctx2d.fillRect(0, 0, cw, ch);

  const smear = state.velocity * state.blurPx;
  const steps = smear > 1 ? 5 : 1;

  if (settledA) {
    try { ctx2d.drawElementImage(sceneA, 0, 0, cw, ch); } catch {}
  } else if (settledB) {
    try { ctx2d.drawElementImage(sceneB, 0, 0, cw, ch); } catch {}
  } else {
    for (let i = 0; i < steps; i++) {
      const f = steps === 1 ? 0 : (i / (steps - 1) - 0.5) * smear;
      ctx2d.globalAlpha = steps === 1 ? 1 : (i === Math.floor(steps / 2) ? 0.55 : 0.22);
      try { ctx2d.drawElementImage(sceneA, off.ax - eff.x * f, off.ay - eff.y * f, cw, ch); } catch {}
      try { ctx2d.drawElementImage(sceneB, off.bx - eff.x * f, off.by - eff.y * f, cw, ch); } catch {}
    }
    ctx2d.globalAlpha = 1;
  }
  ctx2d.restore();

  state.texUploaded = true;
  syncSceneGeometry(true);
  syncControlsUI();
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
    onPlain?.('Canvas context lost; showing both scenes as plain HTML until restored.');
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
  stopShowcase();
  state.anim = null;
  state.velocity = 0;
  stageEl.classList.add('is-plain');
  for (const s of [sceneA, sceneB]) {
    s.inert = false;
    s.style.pointerEvents = 'auto';
    if (s.parentElement !== plainHost) plainHost.append(s);
  }
  syncSceneSizes(0, 0);
  plainHost.hidden = false;
  viewportEl.hidden = true;
  routeNoteEl.textContent = reason;
  syncControlsUI();
}

function exitPlainFallback() {
  stageEl.classList.remove('is-plain');
  for (const s of [sceneA, sceneB]) {
    if (s.parentElement !== canvas) canvas.append(s);
  }
  plainHost.hidden = true;
  viewportEl.hidden = false;
}
// #endregion paint-upload

// ---------------- Animation Loop & Whip Cut Triggers ----------------

function requestDraw() {
  state.needsDraw = true;
  if (state.backend === 'plain') {
    syncControlsUI();
    return;
  }
  if (!rafId && state.onScreen && !document.hidden) {
    rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  let keepGoing = false;
  const reduced = isReducedMotion();

  if (state.anim) {
    const stepped = stepWhipCut(state.anim, now, reduced);
    state.progress = stepped.progress;
    state.velocity = stepped.velocity;
    state.needsDraw = true;
    if (stepped.settled) {
      state.anim = null;
      state.velocity = 0;
      syncSceneGeometry(true);
      if (state.autoShowcase && !reduced) {
        scheduleShowcaseStep(SHOWCASE_DWELL_MS);
      }
    } else {
      keepGoing = true;
    }
  }

  if (state.needsDraw && state.hasPainted) {
    state.needsDraw = false;
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
  }

  if (keepGoing) {
    rafId = requestAnimationFrame(tick);
  }
}

function triggerWhipCut(dirKey, { fromAuto = false } = {}) {
  if (!fromAuto) stopShowcase();
  if (dirKey && DIRECTIONS[dirKey]) state.dir = dirKey;
  const currentlyB = state.progress >= 0.5;
  const target = currentlyB ? 0 : 1;
  state.panSign = target === 1 ? 1 : -1;

  if (state.backend === 'plain') {
    state.progress = target;
    state.velocity = 0;
    syncControlsUI();
    const targetEl = target === 1 ? sceneB : sceneA;
    targetEl.dataset.flash = '1';
    setTimeout(() => { delete targetEl.dataset.flash; }, 220);
    return;
  }

  if (isReducedMotion()) {
    state.anim = null;
    state.progress = target;
    state.velocity = 0;
    syncSceneGeometry(true);
    if (state.hasPainted) {
      if (state.backend === 'webgl') renderWebGL();
      else if (state.backend === '2d') render2DFallback();
    } else {
      canvas.requestPaint?.();
    }
    return;
  }

  state.anim = {
    from: state.progress,
    to: target,
    startMs: performance.now(),
    durMs: CUT_DURATION_MS,
  };
  syncSceneGeometry(true);
  requestDraw();
}

// ---------------- Backend Initialization ----------------

function initBackend() {
  attachContextLossController({
    targetCanvas: canvas,
    targetViewport: viewportEl,
    targetElements: [sceneA, sceneB],
    targetPlainHost: plainHost,
    onPlain: (msg) => {
      state.backend = 'plain';
      state.texUploaded = false;
      state.hasPainted = false;
      stopShowcase();
      stageEl.classList.add('is-plain');
      routeNoteEl.textContent = msg;
      syncControlsUI();
    },
    onRestore: () => {
      exitPlainFallback();
      if (stage && !stage.lost) {
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.backend = 'webgl';
        state.hasPainted = false;
        state.dirtyA = true;
        state.dirtyB = true;
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

  if (routeParam !== '2d' && elGlAvailable()) {
    try {
      stage = new ElementGL(canvas, {
        fragment: WHIP_FRAG,
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
          state.dirtyA = true;
          state.dirtyB = true;
          sceneTexCache.delete(sceneA);
          sceneTexCache.delete(sceneB);
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.hasPainted = false;
          state.dirtyA = true;
          state.dirtyB = true;
          sceneTexCache.delete(sceneA);
          sceneTexCache.delete(sceneB);
          unitCache.delete(canvas);
          canvas.requestPaint?.();
          requestDraw();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.backend = 'webgl';
      routeNoteEl.textContent = 'Running on WebGL 2 via one ElementGL context with 16-tap directional velocity blur and RGB fringe.';
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
        ? '2D 5-argument drawElementImage() fallback selected via ?route=2d.'
        : 'WebGL 2 texElementSubImage2D() is unavailable here; running the 2D 5-argument drawElementImage() fallback.';
    }
  }

  if (state.backend === 'none') {
    enterPlainFallback('HTML-in-canvas is unavailable here, so both scenes are shown as plain HTML.');
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
      const { cw, ch } = getViewportSize();
      syncSceneSizes(cw, ch);
      syncSceneGeometry(true);
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
        clearIdleTimer();
      } else {
        requestDraw();
        if (state.autoShowcase && !state.anim) scheduleShowcaseStep(900);
      }
    }, { rootMargin: '120px' }).observe(viewportEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      clearIdleTimer();
    } else if (state.onScreen) {
      requestDraw();
      if (state.autoShowcase && !state.anim) scheduleShowcaseStep(900);
    }
  });

  const { cw, ch } = getViewportSize();
  syncSceneSizes(cw, ch);
  syncSceneGeometry(true);
  canvas.requestPaint?.();
  requestDraw();

  if (state.autoShowcase) {
    scheduleShowcaseStep(INITIAL_SHOWCASE_DELAY_MS);
  }
}

function elGlAvailable() {
  return glSupported && api2dSupported;
}

// ---------------- Interactive Controls & Gestures ----------------

for (const b of dirBtns) {
  b.addEventListener('click', () => triggerWhipCut(b.dataset.dir));
}

btnAuto.addEventListener('click', () => {
  if (isReducedMotion()) {
    stopShowcase();
    routeNoteEl.textContent = 'Auto preview stays paused while Reduced motion is on. Use Scrub or tap a cut button.';
    return;
  }
  if (state.backend === 'plain') {
    stopShowcase();
    return;
  }
  state.autoShowcase = !state.autoShowcase;
  syncControlsUI();
  if (state.autoShowcase) {
    scheduleShowcaseStep(250);
  } else {
    clearIdleTimer();
  }
});

ctlScrub.addEventListener('input', () => {
  state.anim = null;
  if (state.backend === 'plain') {
    stopShowcase();
    return;
  }
  const p = clamp(Number(ctlScrub.value) / 100, 0, 1);
  state.progress = p;
  state.velocity = whipBellVelocity(p);
  stopShowcase();
  syncSceneGeometry(true);
  if (state.hasPainted) {
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
  } else {
    requestDraw();
  }
});

ctlBlur.addEventListener('input', () => {
  state.blurPx = clamp(Number(ctlBlur.value), 0, 64);
  stopShowcase();
  if (state.hasPainted) {
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
  } else {
    requestDraw();
  }
});

function handleReducedChange() {
  if (isReducedMotion()) {
    stopShowcase();
    if (state.anim) {
      state.progress = state.anim.to;
      state.anim = null;
    }
    state.velocity = 0;
  }
  syncSceneGeometry(true);
  requestDraw();
}

if (reducedQuery) {
  reducedQuery.addEventListener('change', () => {
    ctlReduced.checked = reducedQuery.matches;
    handleReducedChange();
  });
}
ctlReduced.addEventListener('change', handleReducedChange);

// Scene A live controls
for (const b of beatBtns) {
  b.addEventListener('click', () => {
    stopShowcase();
    state.activeBeat = b.dataset.beat || '01A';
    for (const other of beatBtns) {
      other.setAttribute('aria-pressed', String(other === b));
    }
    tcOutA.textContent = b.dataset.tc || '01:04:12:08';
    noteA.textContent = `Beat ${state.activeBeat} · ${b.dataset.lens || '35 mm'}`;
    state.dirtyA = true;
    canvas.requestPaint?.();
    requestDraw();
  });
}

markBtnA.addEventListener('click', () => {
  stopShowcase();
  state.takesA++;
  markBtnA.textContent = `Take #${state.takesA}`;
  state.dirtyA = true;
  canvas.requestPaint?.();
  requestDraw();
});

cutToBBtn.addEventListener('click', () => {
  triggerWhipCut(state.dir);
});

titleInputA.addEventListener('input', () => {
  stopShowcase();
  state.dirtyA = true;
  canvas.requestPaint?.();
  requestDraw();
});

// Scene B live controls
for (const b of trackBtns) {
  b.addEventListener('click', () => {
    stopShowcase();
    const tr = b.dataset.track;
    if (!tr) return;
    state.tracks[tr] = !state.tracks[tr];
    b.setAttribute('aria-pressed', String(state.tracks[tr]));
    const row = b.closest('.wp-track-row');
    row?.classList.toggle('is-muted', !state.tracks[tr]);
    const activeCount = Object.values(state.tracks).filter(Boolean).length;
    noteB.textContent = `${activeCount} track${activeCount === 1 ? '' : 's'} live · 48 kHz`;
    state.dirtyB = true;
    canvas.requestPaint?.();
    requestDraw();
  });
}

markBtnB.addEventListener('click', () => {
  stopShowcase();
  state.markersB++;
  markBtnB.textContent = `Marker #${state.markersB}`;
  state.dirtyB = true;
  canvas.requestPaint?.();
  requestDraw();
});

cutToABtn.addEventListener('click', () => {
  triggerWhipCut(state.dir);
});

titleInputB.addEventListener('input', () => {
  stopShowcase();
  state.dirtyB = true;
  canvas.requestPaint?.();
  requestDraw();
});

for (const sc of [sceneA, sceneB]) {
  sc.addEventListener('focus', () => {
    stopShowcase();
    if (sc === sceneA) state.dirtyA = true;
    else state.dirtyB = true;
    canvas.requestPaint?.();
    requestDraw();
  }, { capture: true });
  sc.addEventListener('focusin', () => {
    stopShowcase();
    if (sc === sceneA) state.dirtyA = true;
    else state.dirtyB = true;
    canvas.requestPaint?.();
    requestDraw();
  });
  sc.addEventListener('focusout', () => {
    if (sc === sceneA) state.dirtyA = true;
    else state.dirtyB = true;
    canvas.requestPaint?.();
    requestDraw();
  });
}

// Guard native browser text selection while dragging across the stage, keeping inputs selectable.
viewportEl.addEventListener('selectstart', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('input, textarea')) {
    e.preventDefault();
  }
});

function isSceneControl(target) {
  return target instanceof Element && (sceneA.contains(target) || sceneB.contains(target)) && Boolean(target.closest('button, input'));
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain') return;
  stopShowcase();
  if (isSceneControl(e.target)) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  state.anim = null;
  state.drag = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    lastT: performance.now(),
    startProgress: state.progress,
    lockedAxis: null, // 'x' | 'y'
    vx: 0,
    vy: 0,
  };
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;

  if (!d.lockedAxis) {
    if (Math.hypot(dx, dy) < 10) return;
    d.lockedAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (!document.activeElement?.closest('input')) {
      try { window.getSelection()?.removeAllRanges?.(); } catch {}
    }
    const fromB = d.startProgress >= 0.5;
    if (d.lockedAxis === 'x') {
      state.dir = dx < 0 ? 'left' : 'right';
    } else {
      state.dir = dy < 0 ? 'up' : 'down';
    }
    state.panSign = fromB ? -1 : 1;
    syncSceneGeometry(true);
  }

  const now = performance.now();
  const dt = Math.max(0.004, (now - d.lastT) / 1000);
  d.vx = d.vx * 0.45 + ((e.clientX - d.lastX) / dt) * 0.55;
  d.vy = d.vy * 0.45 + ((e.clientY - d.lastY) / dt) * 0.55;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.lastT = now;

  const { cw, ch } = getViewportSize();
  const span = d.lockedAxis === 'x' ? Math.max(180, cw * 0.85) : Math.max(180, ch * 0.85);
  const delta = d.lockedAxis === 'x' ? dx : dy;
  const dirComp = d.lockedAxis === 'x' ? DIRECTIONS[state.dir].x : DIRECTIONS[state.dir].y;
  const signedTravel = (delta * dirComp * state.panSign) / span;
  const nextP = clamp(d.startProgress + signedTravel, 0, 1);

  state.progress = nextP;
  state.velocity = whipBellVelocity(nextP);
  requestDraw();
});

function endSwipeDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  state.drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}

  if (!d.lockedAxis) {
    syncSceneGeometry(true);
    return;
  }

  state.suppressClick = true;
  setTimeout(() => { state.suppressClick = false; }, 0);

  const vAlong = d.lockedAxis === 'x'
    ? d.vx * DIRECTIONS[state.dir].x
    : d.vy * DIRECTIONS[state.dir].y;
  const fromB = d.startProgress >= 0.5;
  const movedFromStart = Math.abs(state.progress - d.startProgress);
  const commit = movedFromStart > 0.35 || (movedFromStart > 0.08 && vAlong > 340);
  const target = commit ? (fromB ? 0 : 1) : (fromB ? 1 : 0);

  if (isReducedMotion()) {
    state.progress = target;
    state.velocity = 0;
    syncSceneGeometry(true);
    requestDraw();
    return;
  }

  state.anim = {
    from: state.progress,
    to: target,
    startMs: performance.now(),
    durMs: 360,
  };
  syncSceneGeometry(true);
  requestDraw();
}

canvas.addEventListener('pointerup', endSwipeDrag);
canvas.addEventListener('pointercancel', endSwipeDrag);
viewportEl.addEventListener('click', (e) => {
  if (state.suppressClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

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

async function waitForRetiredGL() {
  for (let i = 0; i < 16; i++) {
    if ((window.__gfx?.active?.() ?? 0) <= 1) return;
    await new Promise((r) => setTimeout(r, 80));
  }
}

runTests(testsBody, [
  {
    name: 'Dual-scene ElementGL upload succeeds with gl.getError() === 0',
    why: 'Builds an isolated ElementGL fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload() for warm View A and dark indigo View B, and checks pixels and GL error.',
    timeout: 6000,
    run: async () => {
      if (!elGlAvailable()) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#fbf7ee;border:4px solid #d2491f;box-sizing:border-box;`;
      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.inert = true;
      fixB.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#0e1528;border:4px solid #38bdf8;box-sizing:border-box;`;
      cv.append(fixA, fixB);

      const g = new ElementGL(cv, {
        fragment: WHIP_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.03, 0.04, 0.08, 1])) throw new Error('ElementGL.begin() returned false');
        const tA = g.upload(fixA);
        const tB = g.upload(fixB);
        if (!tA || !tB) throw new Error('stage.upload() returned null');
        g.quad(fixA, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tB.tex);
          gl.uniform1i(u('uSceneB'), 1);
          gl.uniform2f(u('uCanvasSize'), cw, ch);
          gl.uniform1f(u('uProgress'), 0);
          gl.uniform2f(u('uPanDir'), -1, 0);
          gl.uniform1f(u('uVelocity'), 0);
          gl.uniform1f(u('uBlurPx'), 42);
        });
        const glErr = g.gl.getError();
        if (glErr !== 0) throw new Error(`gl.getError() returned 0x${glErr.toString(16)}`);
        const img = readPlainCopyImageData(cv);
        const px = sampleCssPixel(img, 120, 90, cw, ch);
        if (px[0] < 220 || px[1] < 215 || px[2] < 200) {
          throw new Error(`expected warm light View A centre pixel, got rgba(${px.join(',')})`);
        }
        return `fixA ${tA.w}x${tA.h}, fixB ${tB.w}x${tB.h}, glErr=0, centre rgba(${px.join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Peak 50% whip velocity smears directionally vs razor-sharp 0% rest and damped overshoot spring',
    why: 'Evaluates stepWhipCut(..., tMs) across start, midpoint, overshoot and settled states, and compares pixels 8 px right of a dark bar at 0% rest vs 50% peak Left whip blur.',
    timeout: 6000,
    run: async () => {
      if (!elGlAvailable()) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      await waitForRetiredGL();
      const anim = { from: 0, to: 1, startMs: 1000, durMs: 480 };
      const s0 = stepWhipCut(anim, 1000, false);
      const sMid = stepWhipCut(anim, 1150, false);
      const sOver = stepWhipCut(anim, 1300, false);
      const sEnd = stepWhipCut(anim, 1480, false);
      const sRed = stepWhipCut(anim, 1010, true);
      if (s0.velocity !== 0 || sMid.velocity <= 0.85 || sOver.progress <= 1.0 || !sEnd.settled || !sRed.settled || sRed.velocity !== 0) {
        throw new Error(`curve check failed: midVel=${sMid.velocity.toFixed(2)}, over=${sOver.progress.toFixed(3)}, red=${sRed.progress}`);
      }

      const cw = 240, ch = 160;
      const cv = makeFixtureCanvas(cw, ch);
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#ffffff;`;
      const stripe = document.createElement('div');
      stripe.style.cssText = 'position:absolute;left:156px;top:0;width:36px;height:160px;background:#111111;';
      fixA.append(stripe);

      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.inert = true;
      fixB.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#0e1528;`;
      cv.append(fixA, fixB);

      const g = new ElementGL(cv, {
        fragment: WHIP_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.03, 0.04, 0.08, 1])) throw new Error('ElementGL.begin() returned false');
        g.upload(fixA);
        const tB = g.upload(fixB);

        const drawAt = (progress, vel) => {
          g.begin([0.03, 0.04, 0.08, 1]);
          g.quad(fixA, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tB.tex);
            gl.uniform1i(u('uSceneB'), 1);
            gl.uniform2f(u('uCanvasSize'), cw, ch);
            gl.uniform1f(u('uProgress'), progress);
            gl.uniform2f(u('uPanDir'), -1, 0);
            gl.uniform1f(u('uVelocity'), vel);
            gl.uniform1f(u('uBlurPx'), 48);
          });
        };

        drawAt(0, 0);
        const restImg = readPlainCopyImageData(cv);
        const restNearEdge = sampleCssPixel(restImg, 148, 80, cw, ch); // 8 px left of dark stripe

        drawAt(0.5, whipBellVelocity(0.5));
        const midImg = readPlainCopyImageData(cv);
        // At p=0.5 Left (-1,0), fixA shifted by -120 px so stripe [156..192] moves to [36..72].
        // 8 px left of shifted stripe (x=28) is inside trailing smear + RGB fringe.
        const midNearEdge = sampleCssPixel(midImg, 28, 80, cw, ch);
        const midLum = (midNearEdge[0] + midNearEdge[1] + midNearEdge[2]) / 3;
        if (restNearEdge[0] < 235 || midLum > 225) {
          throw new Error(`expected sharp rest white (${restNearEdge[0]}) vs blurred mid trail (${midLum.toFixed(0)})`);
        }
        return `rest=${restNearEdge[0]}, mid50% trail lum=${midLum.toFixed(0)}, peakOver=${sOver.progress.toFixed(3)}, bell(0.5)=${whipBellVelocity(0.5).toFixed(2)}`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Direction reversal swaps blur smear axis between Left and Up',
    why: 'Renders a centred white square on dark ground at 50% velocity blur under Left (-1,0) vs Up (0,-1) and verifies horizontal smear exceeds vertical under Left while vertical exceeds horizontal under Up.',
    timeout: 6000,
    run: async () => {
      if (!elGlAvailable()) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      await waitForRetiredGL();
      const cw = 200, ch = 200;
      const cv = makeFixtureCanvas(cw, ch);
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#080c16;`;
      const sq = document.createElement('div');
      // Centred in top-left quadrant after 50% shift? Place box so at p=0.5 it sits cleanly inside visible frame.
      sq.style.cssText = 'position:absolute;left:130px;top:130px;width:44px;height:44px;background:#ffffff;';
      fixA.append(sq);

      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.inert = true;
      fixB.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#080c16;`;
      cv.append(fixA, fixB);

      const g = new ElementGL(cv, {
        fragment: WHIP_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.03, 0.04, 0.08, 1])) throw new Error('ElementGL.begin() returned false');
        g.upload(fixA);
        const tB = g.upload(fixB);

        const renderDir = (px, py) => {
          g.begin([0.03, 0.04, 0.08, 1]);
          g.quad(fixA, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tB.tex);
            gl.uniform1i(u('uSceneB'), 1);
            gl.uniform2f(u('uCanvasSize'), cw, ch);
            gl.uniform1f(u('uProgress'), 0.5);
            gl.uniform2f(u('uPanDir'), px, py);
            gl.uniform1f(u('uVelocity'), 1.0);
            gl.uniform1f(u('uBlurPx'), 52);
          });
          return readPlainCopyImageData(cv);
        };

        // Under Left (-1, 0) at p=0.5: box [130..174, 130..174] shifts to [30..74, 130..174]
        const leftImg = renderDir(-1, 0);
        const leftHorizBleed = sampleCssPixel(leftImg, 22, 152, cw, ch)[1]; // 8 px left of box
        const leftVertClean = sampleCssPixel(leftImg, 52, 122, cw, ch)[1];  // 8 px above box

        // Under Up (0, -1) at p=0.5: box shifts to [130..174, 30..74]
        const upImg = renderDir(0, -1);
        const upVertBleed = sampleCssPixel(upImg, 152, 22, cw, ch)[1];   // 8 px above box
        const upHorizClean = sampleCssPixel(upImg, 122, 52, cw, ch)[1];  // 8 px left of box

        if (leftHorizBleed <= leftVertClean + 40 || upVertBleed <= upHorizClean + 40) {
          throw new Error(`directional axis mismatch: Left(H=${leftHorizBleed},V=${leftVertClean}) Up(V=${upVertBleed},H=${upHorizClean})`);
        }
        return `Left(H=${leftHorizBleed} vs V=${leftVertClean}), Up(V=${upVertBleed} vs H=${upHorizClean})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() routes live clicks to View A at 0% and View B at 100%',
    why: 'Toggles inert, OFFSTAGE matrix, geometryUnit()-scaled updateElementGeometry() and data-hit-tick on a dual-scene fixture, confirming elementsFromPoint() and real clicks hit View A at 0% and View B at 100%.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !api2dSupported) {
        throw new Error('updateElementGeometry() or drawElementImage() is not available');
      }
      const cw = 240, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);

      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#fbf7ee;`;
      const btnA = document.createElement('button');
      btnA.type = 'button';
      btnA.textContent = 'Take A';
      btnA.style.cssText = 'position:absolute;left:40px;top:70px;width:160px;height:40px;';
      let clicksA = 0;
      btnA.addEventListener('click', () => { clicksA++; });
      fixA.append(btnA);

      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#0e1528;`;
      const inpB = document.createElement('input');
      inpB.type = 'text';
      inpB.inputMode = 'none';
      inpB.value = 'SEQ B';
      inpB.setAttribute('aria-label', 'Fixture View B title');
      inpB.style.cssText = 'position:absolute;left:40px;top:20px;width:160px;height:36px;margin:0;';
      const btnB = document.createElement('button');
      btnB.type = 'button';
      btnB.textContent = 'Marker B';
      btnB.style.cssText = 'position:absolute;left:40px;top:70px;width:160px;height:40px;';
      let clicksB = 0;
      btnB.addEventListener('click', () => { clicksB++; });
      fixB.append(inpB, btnB);

      cv.append(fixA, fixB);

      try {
        const c2 = cv.getContext('2d');
        await nextPaint(cv);
        c2.drawElementImage(fixB, 0, 0, cw, ch);
        c2.drawElementImage(fixA, 0, 0, cw, ch);

        const placeActive = (showB) => {
          fixA.inert = showB;
          fixB.inert = !showB;
          fixA.style.pointerEvents = showB ? 'none' : 'auto';
          fixB.style.pointerEvents = showB ? 'auto' : 'none';
          const u = geometryUnit(cv, showB ? fixB : fixA, cw);
          const onBox = new DOMMatrix().scale(u, u, 1);
          cv.updateElementGeometry(fixA, { canvasTransform: showB ? OFFSTAGE : onBox });
          cv.updateElementGeometry(fixB, { canvasTransform: showB ? onBox : OFFSTAGE });
          fixA.dataset.hitTick = fixA.dataset.hitTick === '1' ? '0' : '1';
          fixB.dataset.hitTick = fixB.dataset.hitTick === '1' ? '0' : '1';
        };

        const r = cv.getBoundingClientRect();
        const cx = r.left + 120;
        const cyBtn = r.top + 90;
        const cyInp = r.top + 38;

        placeActive(false);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const hitsA = document.elementsFromPoint(cx, cyBtn);
        if (!hitsA.includes(btnA) || hitsA.includes(btnB)) {
          throw new Error(`at 0% expected btnA hit, got ${hitsA.slice(0, 3).map((e) => e.tagName).join(',')}`);
        }
        btnA.click();

        placeActive(true);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const hitsBBtn = document.elementsFromPoint(cx, cyBtn);
        const hitsBInp = document.elementsFromPoint(cx, cyInp);
        if (!hitsBBtn.includes(btnB) || hitsBBtn.includes(btnA) || !hitsBInp.includes(inpB)) {
          throw new Error(`at 100% expected btnB & inpB hits, got ${hitsBBtn[0]?.tagName}`);
        }
        btnB.click();

        if (clicksA !== 1 || clicksB !== 1) throw new Error(`unexpected click counts A=${clicksA}, B=${clicksB}`);
        return `0% hit btnA (${clicksA} click); 100% hit btnB (${clicksB} click) + inpB`;
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-arg 2D drawElementImage() fallback recover cleanly',
    why: 'Dispatches cancelable webglcontextlost and webglcontextrestored on an isolated fixture without loseContext(), then draws both scenes at 50% via 5-argument drawElementImage() in a 2D fixture.',
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
      const fixA = document.createElement('div');
      fixA.setAttribute('drawable', '');
      fixA.textContent = 'Scene A';
      const fixB = document.createElement('div');
      fixB.setAttribute('drawable', '');
      fixB.inert = true;
      fixB.textContent = 'Scene B';
      const ph = document.createElement('div');
      ph.hidden = true;
      cv.append(fixA, fixB);
      vp.append(cv);
      box.append(vp, ph);
      testStage().append(box);

      let restored = false;
      attachContextLossController({
        targetCanvas: cv,
        targetViewport: vp,
        targetElements: [fixA, fixB],
        targetPlainHost: ph,
        onRestore: () => { restored = true; },
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const fellBack = lostEv.defaultPrevented && vp.hidden && !ph.hidden && ph.contains(fixA) && ph.contains(fixB) && !fixB.inert;
      cv.dispatchEvent(new Event('webglcontextrestored'));
      const cameBack = restored && !vp.hidden && ph.hidden && cv.contains(fixA) && cv.contains(fixB);
      box.remove();
      window.__gfx?.retire?.(cv);
      if (!fellBack || !cameBack) throw new Error(`context fallback/restore failed (fellBack=${fellBack}, cameBack=${cameBack})`);

      if (!api2dSupported) throw new Error('2D drawElementImage() is not available');
      const cw = 200, ch = 120;
      const c2 = makeFixtureCanvas(cw, ch);
      const dA = document.createElement('div');
      dA.setAttribute('drawable', '');
      dA.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px;background:#fbf7ee;';
      const dB = document.createElement('div');
      dB.setAttribute('drawable', '');
      dB.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px;background:#0e1528;';
      c2.append(dA, dB);
      try {
        const ctx = c2.getContext('2d');
        await nextPaint(c2);
        const off = computeWhipOffsets(cw, ch, 0.5, -1, 0);
        ctx.drawElementImage(dA, off.ax, off.ay, cw, ch);
        ctx.drawElementImage(dB, off.bx, off.by, cw, ch);
        const img = readPlainCopyImageData(c2);
        const frac = inkFraction(img);
        if (frac < 0.9) throw new Error(`2D fallback drew only ${(frac * 100).toFixed(1)}% ink`);
        return `loss->plain->restored OK; 5-arg 2D fallback ink=${(frac * 100).toFixed(0)}%`;
      } finally {
        c2.remove();
        window.__gfx?.retire?.(c2);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'whip-pan stage',
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
      rescue: () => enterPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
