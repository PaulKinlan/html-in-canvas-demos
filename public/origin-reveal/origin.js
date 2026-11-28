import {
  banner,
  supported as hicSupported,
  runTests,
  nextPaint,
  testStage,
  stillDrawn,
  inkFraction,
} from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

export const THEMES = ['daylight', 'midnight', 'forest'];
export const THEME_META = {
  daylight: { id: 'daylight', label: 'Daylight Paper' },
  midnight: { id: 'midnight', label: 'Midnight Studio' },
  forest: { id: 'forest', label: 'Forest Ink' },
};

export function nextThemeAfter(id) {
  const i = THEMES.indexOf(id);
  return THEMES[(i + 1) % THEMES.length];
}

// #region origin-controller
export function maxCornerDist(oxPx, oyPx, cw, ch) {
  return Math.max(
    Math.hypot(oxPx, oyPx),
    Math.hypot(cw - oxPx, oyPx),
    Math.hypot(oxPx, ch - oyPx),
    Math.hypot(cw - oxPx, ch - oyPx)
  );
}

export function isPointInsideWavefront(px, py, oxNorm, oyNorm, progress, cw, ch) {
  const p = clamp(progress, 0, 1);
  if (p <= 0.0005) return false;
  if (p >= 0.9995) return true;
  const oxPx = clamp(oxNorm, 0, 1) * cw;
  const oyPx = clamp(oyNorm, 0, 1) * ch;
  const r = p * maxCornerDist(oxPx, oyPx, cw, ch);
  return Math.hypot(px - oxPx, py - oyPx) <= r;
}

export function createOriginController({
  initialProgress = 0,
  initialOx = 0.84,
  initialOy = 0.88,
  initialRingW = 18,
  isReduced = () => false,
} = {}) {
  const s = {
    progress: clamp(initialProgress, 0, 1),
    ox: clamp(initialOx, 0, 1),
    oy: clamp(initialOy, 0, 1),
    ringW: clamp(initialRingW, 0, 40),
    playing: false,
    from: clamp(initialProgress, 0, 1),
    to: 1,
    startMs: 0,
    durationMs: 680,
  };

  function setProgress(p) {
    s.playing = false;
    s.progress = clamp(p, 0, 1);
    return s.progress;
  }

  function setOrigin(ox, oy) {
    s.ox = clamp(ox, 0, 1);
    s.oy = clamp(oy, 0, 1);
    return [s.ox, s.oy];
  }

  function setRingW(w) {
    s.ringW = clamp(w, 0, 40);
    return s.ringW;
  }

  function pause() {
    s.playing = false;
  }

  function shiftStart(deltaMs) {
    if (s.playing) s.startMs += deltaMs;
  }

  function startReveal({
    ox = s.ox,
    oy = s.oy,
    from = s.progress,
    to = 1,
    durationMs = 680,
    tMs = performance.now(),
  } = {}) {
    s.ox = clamp(ox, 0, 1);
    s.oy = clamp(oy, 0, 1);
    s.from = clamp(from, 0, 1);
    s.to = clamp(to, 0, 1);
    if (isReduced()) {
      s.playing = false;
      s.progress = s.to;
      return false;
    }
    s.durationMs = Math.max(1, durationMs);
    s.startMs = tMs;
    s.progress = s.from;
    s.playing = true;
    return true;
  }

  function startCollapse({
    ox = s.ox,
    oy = s.oy,
    from = s.progress,
    durationMs = 580,
    tMs = performance.now(),
  } = {}) {
    return startReveal({ ox, oy, from, to: 0, durationMs, tMs });
  }

  function step(tMs = performance.now()) {
    if (!s.playing) return false;
    if (isReduced()) {
      s.progress = s.to;
      s.playing = false;
      return false;
    }
    const raw = clamp((tMs - s.startMs) / s.durationMs, 0, 1);
    const eased = raw < 0.5
      ? 4 * raw * raw * raw
      : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    s.progress = s.from + (s.to - s.from) * eased;
    if (raw >= 1) {
      s.progress = s.to;
      s.playing = false;
      return false;
    }
    return true;
  }

  return {
    s,
    setProgress,
    setOrigin,
    setRingW,
    pause,
    shiftStart,
    startReveal,
    startCollapse,
    step,
  };
}
// #endregion origin-controller

// #region origin-shader
export const ORIGIN_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;    // #or-surface-a (outside / source theme)
uniform sampler2D uTexB;   // #or-surface-b (inside / destination theme)
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;  // CSS px (cw, ch)
uniform vec2 uOrigin;      // normalised tap coordinate (0..1, y-down)
uniform float uProgress;   // 0..1 wavefront progress
uniform float uRingW;      // lens ring half-width in CSS px
uniform float uReduced;    // 0 or 1

in vec2 vUv;
out vec4 outColor;

const vec3 BACKDROP = vec3(0.05, 0.07, 0.11);

void main() {
  float p = clamp(uProgress, 0.0, 1.0);
  if (p <= 0.0005) {
    vec4 t = texture(uTex, vUv);
    outColor = vec4(t.rgb + BACKDROP * (1.0 - t.a), 1.0);
    return;
  }
  if (p >= 0.9995) {
    vec4 t = texture(uTexB, vUv);
    outColor = vec4(t.rgb + BACKDROP * (1.0 - t.a), 1.0);
    return;
  }

  vec2 size = max(uCanvasSize, vec2(1.0));
  vec2 pCss = vUv * size;
  vec2 oCss = clamp(uOrigin, 0.0, 1.0) * size;

  float dTL = length(oCss);
  float dTR = length(vec2(size.x, 0.0) - oCss);
  float dBL = length(vec2(0.0, size.y) - oCss);
  float dBR = length(size - oCss);
  float maxR = max(max(dTL, dTR), max(dBL, dBR));

  float r = p * maxR;
  vec2 d = pCss - oCss;
  float dist = length(d);
  float sd = dist - r;

  float insideMask = 1.0 - smoothstep(-0.9, 0.9, sd);
  float edgeFade = smoothstep(0.0, 0.035, p) * (1.0 - smoothstep(0.95, 1.0, p));

  if (uRingW <= 0.5) {
    vec4 a = texture(uTex, vUv);
    vec4 b = texture(uTexB, vUv);
    vec3 colA = a.rgb + BACKDROP * (1.0 - a.a);
    vec3 colB = b.rgb + BACKDROP * (1.0 - b.a);
    outColor = vec4(mix(colA, colB, insideMask), 1.0);
    return;
  }

  float ringW = clamp(uRingW, 1.0, 48.0);
  float u = clamp(sd / ringW, -1.0, 1.0);
  float dome = sqrt(max(0.0, 1.0 - u * u));
  float ringMask = (1.0 - smoothstep(0.75, 1.0, abs(u))) * edgeFade;

  vec2 radDir = dist > 0.001 ? d / dist : vec2(1.0, 0.0);
  float strength = uReduced > 0.5 ? 0.40 : 1.0;

  // Radial lens magnification + convex bevel slope across the circumference.
  float bevelSlope = -u / max(0.32, dome);
  vec2 bendPx = radDir * (dome * 0.30 + bevelSlope * 0.24) * ringW * ringMask * strength;
  // RGB chromatic dispersion separated along the radial axis.
  float dispPx = (0.22 * ringW) * ringMask * dome * strength;

  vec2 pxToUv = 1.0 / size;
  vec2 uvR = clamp(vUv + (bendPx + radDir * dispPx) * pxToUv, 0.001, 0.999);
  vec2 uvG = clamp(vUv + bendPx * pxToUv, 0.001, 0.999);
  vec2 uvB = clamp(vUv + (bendPx - radDir * dispPx) * pxToUv, 0.001, 0.999);

  vec4 aR = texture(uTex, uvR);
  vec4 aG = texture(uTex, uvG);
  vec4 aB = texture(uTex, uvB);
  vec4 bR = texture(uTexB, uvR);
  vec4 bG = texture(uTexB, uvG);
  vec4 bB = texture(uTexB, uvB);

  vec3 colA = vec3(aR.r, aG.g, aB.b) + BACKDROP * (1.0 - aG.a);
  vec3 colB = vec3(bR.r, bG.g, bB.b) + BACKDROP * (1.0 - bG.a);
  vec3 col = mix(colA, colB, insideMask);

  // Subtle meniscus darkening on the outer edge for contrast against bright paper.
  float outerLip = exp(-pow((u - 0.65) / 0.28, 2.0)) * ringMask;
  col *= (1.0 - 0.24 * outerLip);

  // Spectral dispersion shoulders (cool cyan inner rim, warm amber outer rim).
  float shimmer = uReduced > 0.5 ? 0.48 : 1.0;
  float shoulder = exp(-pow((abs(u) - 0.42) / 0.36, 2.0)) * ringMask;
  vec3 prismCol = mix(vec3(0.18, 0.78, 1.0), vec3(1.0, 0.42, 0.18), smoothstep(-0.65, 0.65, u));
  col += prismCol * shoulder * 0.28 * shimmer;

  // Crisp specular glint along the circular optical circumference.
  float rimCore = exp(-pow(sd / max(1.4, ringW * 0.12), 2.0)) * edgeFade;
  float glintDir = 0.55 + 0.45 * pow(abs(dot(radDir, normalize(vec2(-0.65, -0.76)))), 2.0);
  float glowBand = exp(-pow(sd / max(3.5, ringW * 0.38), 2.0)) * edgeFade;
  col = mix(col, vec3(0.98, 0.99, 1.0), clamp(rimCore * (0.62 + 0.34 * glintDir) * shimmer, 0.0, 0.92));
  col += vec3(0.45, 0.85, 1.0) * glowBand * 0.18 * shimmer;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion origin-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('or-stage');
const viewportEl = document.getElementById('or-viewport');
const canvas = document.getElementById('or-canvas');
const surfaceA = document.getElementById('or-surface-a');
const surfaceB = document.getElementById('or-surface-b');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const noticeEl = document.getElementById('stage-notice');
const checksBody = document.getElementById('checks-body');

// Surface A elements
const aThemeTag = document.getElementById('a-theme-tag');
const aCounterVal = document.getElementById('a-counter-val');
const aBtnInc = document.getElementById('a-btn-inc');
const aBtnReset = document.getElementById('a-btn-reset');
const aFilterStatus = document.getElementById('a-filter-status');
const aFilterBtns = Array.from(surfaceA.querySelectorAll('.or-filter-btn'));
const aInput = document.getElementById('a-input');
const aEcho = document.getElementById('a-echo');
const aNextLabel = document.getElementById('a-next-label');
const aOriginEcho = document.getElementById('a-origin-echo');
const aPills = Array.from(surfaceA.querySelectorAll('.or-pill'));

// Surface B elements
const bThemeTag = document.getElementById('b-theme-tag');
const bCounterVal = document.getElementById('b-counter-val');
const bBtnInc = document.getElementById('b-btn-inc');
const bBtnReset = document.getElementById('b-btn-reset');
const bFilterStatus = document.getElementById('b-filter-status');
const bFilterBtns = Array.from(surfaceB.querySelectorAll('.or-filter-btn'));
const bInput = document.getElementById('b-input');
const bEcho = document.getElementById('b-echo');
const bNextLabel = document.getElementById('b-next-label');
const bOriginEcho = document.getElementById('b-origin-echo');
const bPills = Array.from(surfaceB.querySelectorAll('.or-pill'));

const surfaceAHits = Array.from(surfaceA.querySelectorAll('.or-hit'));
const surfaceBHits = Array.from(surfaceB.querySelectorAll('.or-hit'));

// Toolbar controls
const btnReveal = document.getElementById('btn-reveal');
const btnReverse = document.getElementById('btn-reverse');
const progressSlider = document.getElementById('ctl-progress');
const progressOut = document.getElementById('out-progress');
const ringSlider = document.getElementById('ctl-ring');
const ringOut = document.getElementById('out-ring');
const reducedCheck = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

const ctrl = createOriginController({
  initialProgress: 0,
  initialOx: 0.84,
  initialOy: 0.88,
  initialRingW: 18,
  isReduced,
});
const originState = ctrl.s;

const workState = {
  sourceTheme: 'daylight',
  destTheme: 'midnight',
  samples: 0,
  filter: 'all',
  note: aInput.value,
};

let stage = null;
let ctx2d = null;
let backend = 'none';
let hasPainted = false;
let dirtyA = true;
let dirtyB = true;
let texA = null;
let texB = null;
let rafId = 0;
let isVisible = true;
let pausedAtMs = 0;
let lostTimer = 0;
let drag = null;
let pendingReveal = null;
let lastGeoSig = '';
const unitCache = { keyA: '', unitA: 1, keyB: '', unitB: 1 };

function viewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 378);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 396);
  return { cw, ch };
}

function syncSurfaceSizes(cw, ch) {
  if (backend === 'plain') {
    for (const el of [surfaceA, surfaceB]) {
      if (el.style.width) el.style.width = '';
      if (el.style.height) el.style.height = '';
    }
    return;
  }
  const wStr = `${cw}px`;
  const hStr = `${ch}px`;
  for (const el of [surfaceA, surfaceB]) {
    if (el.style.width !== wStr) el.style.width = wStr;
    if (el.style.height !== hStr) el.style.height = hStr;
  }
}

function controlLocalCenter(el, rootEl) {
  let x = el.offsetLeft + el.offsetWidth * 0.5;
  let y = el.offsetTop + el.offsetHeight * 0.5;
  let p = el.offsetParent;
  while (p && p !== rootEl && rootEl.contains(p)) {
    x += p.offsetLeft;
    y += p.offsetTop;
    p = p.offsetParent;
  }
  return [x, y];
}

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  }
}

function setControlActive(el, active) {
  if (active) {
    el.inert = false;
    el.style.pointerEvents = 'auto';
  } else {
    if (document.activeElement === el) el.blur();
    el.inert = true;
    el.style.pointerEvents = 'none';
  }
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend === 'plain' || !hasPainted || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch } = viewportSize();
  syncSurfaceSizes(cw, ch);

  const aWidth = surfaceA.offsetWidth || cw;
  const bWidth = surfaceB.offsetWidth || cw;
  const keyA = `${canvas.width}x${canvas.height}/${cw}x${ch}/${aWidth}`;
  if (unitCache.keyA !== keyA) {
    unitCache.unitA = geometryUnit(canvas, surfaceA, aWidth);
    unitCache.keyA = keyA;
  }
  const keyB = `${canvas.width}x${canvas.height}/${cw}x${ch}/${bWidth}`;
  if (unitCache.keyB !== keyB) {
    unitCache.unitB = geometryUnit(canvas, surfaceB, bWidth);
    unitCache.keyB = keyB;
  }

  const uA = unitCache.unitA || 1;
  const uB = unitCache.unitB || 1;
  const modeEnd = originState.progress <= 0.005 ? 'A' : originState.progress >= 0.995 ? 'B' : 'MID';
  const sectorBits = modeEnd === 'MID'
    ? surfaceAHits.map((el) => {
        const [lx, ly] = controlLocalCenter(el, surfaceA);
        return isPointInsideWavefront(lx, ly, originState.ox, originState.oy, originState.progress, cw, ch) ? 'B' : 'A';
      }).join('')
    : modeEnd;

  const sig = `${backend}:${canvas.width}x${canvas.height}:${cw}x${ch}:${modeEnd}:${sectorBits}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  if (modeEnd === 'A') {
    surfaceA.inert = false;
    surfaceB.inert = true;
    for (const el of surfaceAHits) setControlActive(el, true);
    for (const el of surfaceBHits) setControlActive(el, false);
    canvas.updateElementGeometry(surfaceA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
    if (OFFSTAGE) canvas.updateElementGeometry(surfaceB, { canvasTransform: OFFSTAGE });
  } else if (modeEnd === 'B') {
    surfaceA.inert = true;
    surfaceB.inert = false;
    for (const el of surfaceAHits) setControlActive(el, false);
    for (const el of surfaceBHits) setControlActive(el, true);
    if (OFFSTAGE) canvas.updateElementGeometry(surfaceA, { canvasTransform: OFFSTAGE });
    canvas.updateElementGeometry(surfaceB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
  } else {
    surfaceA.inert = false;
    surfaceB.inert = false;
    for (const el of surfaceAHits) {
      const [lx, ly] = controlLocalCenter(el, surfaceA);
      const inB = isPointInsideWavefront(lx, ly, originState.ox, originState.oy, originState.progress, cw, ch);
      setControlActive(el, !inB);
    }
    for (const el of surfaceBHits) {
      const [lx, ly] = controlLocalCenter(el, surfaceB);
      const inB = isPointInsideWavefront(lx, ly, originState.ox, originState.oy, originState.progress, cw, ch);
      setControlActive(el, inB);
    }
    canvas.updateElementGeometry(surfaceA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
    canvas.updateElementGeometry(surfaceB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
  }

  surfaceA.dataset.hitTick = surfaceA.dataset.hitTick === '1' ? '0' : '1';
  surfaceB.dataset.hitTick = surfaceB.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function formatFilterName(id) {
  return id === 'optics' ? 'Optics' : id === 'input' ? 'Input' : 'All';
}

function syncScenesUI() {
  surfaceA.dataset.theme = workState.sourceTheme;
  surfaceB.dataset.theme = workState.destTheme;
  aThemeTag.textContent = THEME_META[workState.sourceTheme].label;
  bThemeTag.textContent = THEME_META[workState.destTheme].label;

  const nextB = nextThemeAfter(workState.destTheme);
  aNextLabel.textContent = `Next: ${THEME_META[workState.destTheme].label}`;
  bNextLabel.textContent = `Next: ${THEME_META[nextB].label}`;

  const originText = `Origin: (${originState.ox.toFixed(2)}, ${originState.oy.toFixed(2)})`;
  aOriginEcho.textContent = originText;
  bOriginEcho.textContent = originText;

  const sampleText = `Samples: ${workState.samples}`;
  aCounterVal.textContent = sampleText;
  bCounterVal.textContent = sampleText;

  const filterLabel = `Filter: ${formatFilterName(workState.filter)}`;
  aFilterStatus.textContent = filterLabel;
  bFilterStatus.textContent = filterLabel;
  for (const btn of [...aFilterBtns, ...bFilterBtns]) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === workState.filter));
  }

  if (document.activeElement !== aInput && aInput.value !== workState.note) aInput.value = workState.note;
  if (document.activeElement !== bInput && bInput.value !== workState.note) bInput.value = workState.note;
  const echoText = `Note: ${workState.note || '(empty)'}`;
  aEcho.textContent = echoText;
  bEcho.textContent = echoText;
}

function syncToolbarUI() {
  const pct = Math.round(originState.progress * 100);
  if (originState.playing) {
    btnReveal.textContent = 'Pause';
    btnReveal.setAttribute('aria-pressed', 'true');
  } else if (originState.progress >= 0.995) {
    btnReveal.textContent = 'Next theme';
    btnReveal.setAttribute('aria-pressed', 'false');
  } else {
    btnReveal.textContent = 'Expand';
    btnReveal.setAttribute('aria-pressed', 'false');
  }
  progressSlider.value = String(pct);
  progressOut.textContent = `${pct}%`;
  ringSlider.value = String(Math.round(originState.ringW));
  ringOut.textContent = `${Math.round(originState.ringW)} px`;
}

function updateHud() {
  const route = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  const mp = backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const srcName = THEME_META[workState.sourceTheme].label;
  const dstName = THEME_META[workState.destTheme].label;
  hudEl.textContent =
    `Route: ${route} · ${mp} MP · ${srcName} -> ${dstName} · ` +
    `Origin: (${originState.ox.toFixed(2)}, ${originState.oy.toFixed(2)}) · ` +
    `Progress: ${Math.round(originState.progress * 100)}% · Ring: ${Math.round(originState.ringW)} px · Samples: ${workState.samples}`;
}

function switchToPlain(reason) {
  backend = 'plain';
  pendingReveal = null;
  cancelAnimationFrame(rafId);
  rafId = 0;
  ctrl.pause();
  stageBox.classList.add('is-plain');
  surfaceA.inert = false;
  surfaceB.inert = false;
  for (const el of [...surfaceAHits, ...surfaceBHits]) {
    el.inert = false;
    el.style.pointerEvents = 'auto';
  }
  syncSurfaceSizes(0, 0);
  if (surfaceA.parentElement !== plainHost) plainHost.append(surfaceA);
  if (surfaceB.parentElement !== plainHost) plainHost.append(surfaceB);
  showNotice(reason);
  syncToolbarUI();
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('is-plain');
  if (surfaceA.parentElement !== canvas) canvas.append(surfaceA);
  if (surfaceB.parentElement !== canvas) canvas.append(surfaceB);
  unitCache.keyA = '';
  unitCache.keyB = '';
  lastGeoSig = '';
  dirtyA = true;
  dirtyB = true;
  texA = null;
  texB = null;
  showNotice('');
}

// #region fallback-2d
function draw2DFallback(cw, ch, forceGeo = false) {
  if (!ctx2d || !hasPainted) return;
  syncSurfaceSizes(cw, ch);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.drawElementImage(surfaceA, 0, 0, cw, ch);

  const progress = clamp(originState.progress, 0, 1);
  if (progress > 0.0005) {
    if (progress >= 0.9995) {
      ctx2d.drawElementImage(surfaceB, 0, 0, cw, ch);
    } else {
      const oxPx = originState.ox * cw;
      const oyPx = originState.oy * ch;
      const r = progress * maxCornerDist(oxPx, oyPx, cw, ch);

      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.arc(oxPx, oyPx, r, 0, Math.PI * 2);
      ctx2d.clip();
      ctx2d.drawElementImage(surfaceB, 0, 0, cw, ch);
      ctx2d.restore();

      if (originState.ringW > 0.5) {
        ctx2d.save();
        ctx2d.beginPath();
        ctx2d.arc(oxPx, oyPx, r, 0, Math.PI * 2);
        ctx2d.strokeStyle = 'rgb(56 189 248 / 0.42)';
        ctx2d.lineWidth = Math.max(3, originState.ringW * 0.72);
        ctx2d.stroke();

        ctx2d.beginPath();
        ctx2d.arc(oxPx, oyPx, r, 0, Math.PI * 2);
        ctx2d.strokeStyle = '#ffffff';
        ctx2d.lineWidth = 2;
        ctx2d.stroke();
        ctx2d.restore();
      }
    }
  }

  syncGeometry(forceGeo);
}
// #endregion fallback-2d

function drawFrame({ allowUpload = false, forceGeo = false } = {}) {
  const { cw, ch } = viewportSize();
  if (!cw || !ch || !hasPainted) return;
  syncSurfaceSizes(cw, ch);

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (allowUpload) {
        if (dirtyA || !texA) {
          texA = stage.upload(surfaceA);
          dirtyA = false;
        }
        if (dirtyB || !texB) {
          texB = stage.upload(surfaceB);
          dirtyB = false;
        }
      } else if (!texA || !texB || dirtyA || dirtyB) {
        canvas.requestPaint?.();
        if (!texA || !texB) return;
      }

      stage.quad(surfaceA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texB.tex);
        gl.uniform1i(loc('uTexB'), 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform2f(loc('uCanvasSize'), cw, ch);
        gl.uniform2f(loc('uOrigin'), originState.ox, originState.oy);
        gl.uniform1f(loc('uProgress'), originState.progress);
        gl.uniform1f(loc('uRingW'), originState.ringW);
        gl.uniform1f(loc('uReduced'), isReduced() ? 1.0 : 0.0);
      });

      syncGeometry(forceGeo);
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        dirtyA = true;
        dirtyB = true;
        canvas.requestPaint?.();
      } else {
        throw err;
      }
    }
  } else if (backend === '2d') {
    if (pendingReveal) return;
    draw2DFallback(cw, ch, forceGeo);
  }
  updateHud();
}

function tick(now) {
  rafId = 0;
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  const moving = ctrl.step(now);
  syncToolbarUI();
  drawFrame({ forceGeo: !moving });
  if (moving) {
    rafId = requestAnimationFrame(tick);
  }
}

function scheduleLoop() {
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  if (!rafId && originState.playing) {
    rafId = requestAnimationFrame(tick);
  }
}

function markScenesDirty() {
  dirtyA = true;
  dirtyB = true;
  if (backend === 'plain') {
    updateHud();
    return;
  }
  canvas.requestPaint?.();
}

function triggerWaveFrom(ox, oy) {
  const nx = clamp(ox, 0, 1);
  const ny = clamp(oy, 0, 1);

  if (backend === 'plain') {
    workState.sourceTheme = nextThemeAfter(workState.sourceTheme);
    workState.destTheme = nextThemeAfter(workState.sourceTheme);
    ctrl.setOrigin(nx, ny);
    syncScenesUI();
    updateHud();
    return;
  }

  if (originState.progress >= 0.995 && !originState.playing) {
    cancelAnimationFrame(rafId);
    rafId = 0;
    workState.sourceTheme = workState.destTheme;
    workState.destTheme = nextThemeAfter(workState.sourceTheme);
    ctrl.setOrigin(nx, ny);
    pendingReveal = { ox: nx, oy: ny };
    syncScenesUI();
    markScenesDirty();
    return;
  }

  pendingReveal = null;
  let to = 1;
  if (originState.playing) {
    to = originState.to >= 0.5 ? 0 : 1;
  }
  const distFrac = to === 1 ? 1 - originState.progress : originState.progress;
  const durationMs = Math.max(320, Math.round(distFrac * 680));
  const started = ctrl.startReveal({
    ox: nx,
    oy: ny,
    from: originState.progress,
    to,
    durationMs,
    tMs: performance.now(),
  });
  syncScenesUI();
  syncToolbarUI();
  drawFrame({ forceGeo: !started });
  if (started) scheduleLoop();
}

// ---------------------------------------------------------------- Surface A & B controls
function handleSampleInc() {
  workState.samples++;
  syncScenesUI();
  markScenesDirty();
}
function handleSampleReset() {
  workState.samples = 0;
  syncScenesUI();
  markScenesDirty();
}
aBtnInc.addEventListener('click', handleSampleInc);
bBtnInc.addEventListener('click', handleSampleInc);
aBtnReset.addEventListener('click', handleSampleReset);
bBtnReset.addEventListener('click', handleSampleReset);

for (const btn of [...aFilterBtns, ...bFilterBtns]) {
  btn.addEventListener('click', () => {
    workState.filter = btn.dataset.filter || 'all';
    syncScenesUI();
    markScenesDirty();
  });
}

function handleNoteInput(srcInput) {
  workState.note = srcInput.value;
  syncScenesUI();
  markScenesDirty();
}
aInput.addEventListener('input', () => handleNoteInput(aInput));
bInput.addEventListener('input', () => handleNoteInput(bInput));

for (const pill of [...aPills, ...bPills]) {
  pill.addEventListener('click', (e) => {
    const cRect = canvas.getBoundingClientRect();
    const pRect = pill.getBoundingClientRect();
    const cw = Math.max(1, cRect.width);
    const ch = Math.max(1, cRect.height);
    let px = (pRect.left + pRect.width * 0.5) - cRect.left;
    let py = (pRect.top + pRect.height * 0.5) - cRect.top;
    if (e.detail > 0 && (e.clientX || e.clientY)) {
      const candX = e.clientX - cRect.left;
      const candY = e.clientY - cRect.top;
      if (candX >= 0 && candX <= cw && candY >= 0 && candY <= ch) {
        px = candX;
        py = candY;
      }
    }
    triggerWaveFrom(px / cw, py / ch);
  });
}

// ---------------------------------------------------------------- Stage pointer tap/drag + selectstart guard
viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

function localCanvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top, Math.max(1, r.width), Math.max(1, r.height)];
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || backend === 'plain') return;
  if (e.target instanceof Element && e.target.closest('button, input, textarea, select, label, a')) return;

  const [px, py, cw, ch] = localCanvasPoint(e);
  drag = {
    id: e.pointerId,
    startX: px,
    startY: py,
    ox: clamp(px / cw, 0, 1),
    oy: clamp(py / ch, 0, 1),
    moved: false,
  };
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || backend === 'plain') return;
  const [px, py, cw, ch] = localCanvasPoint(e);
  if (!drag.moved && Math.hypot(px - drag.startX, py - drag.startY) < 8) return;

  if (!drag.moved) {
    drag.moved = true;
    pendingReveal = null;
    cancelAnimationFrame(rafId);
    rafId = 0;
    ctrl.pause();
    ctrl.setOrigin(drag.ox, drag.oy);
  }
  const oxPx = drag.ox * cw;
  const oyPx = drag.oy * ch;
  const maxR = Math.max(1, maxCornerDist(oxPx, oyPx, cw, ch));
  const p = clamp(Math.hypot(px - oxPx, py - oyPx) / maxR, 0, 1);
  ctrl.setProgress(p);
  syncScenesUI();
  syncToolbarUI();
  drawFrame();
});

function finishCanvasPointer(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (d.moved) {
    syncToolbarUI();
    drawFrame({ forceGeo: true });
  } else {
    triggerWaveFrom(d.ox, d.oy);
  }
}

canvas.addEventListener('pointerup', finishCanvasPointer);
canvas.addEventListener('pointercancel', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
});

// ---------------------------------------------------------------- Toolbar controls
btnReveal.addEventListener('click', () => {
  if (originState.playing) {
    ctrl.pause();
    cancelAnimationFrame(rafId);
    rafId = 0;
    syncToolbarUI();
    drawFrame({ forceGeo: true });
    return;
  }
  triggerWaveFrom(originState.ox, originState.oy);
});

btnReverse.addEventListener('click', () => {
  if (backend === 'plain') return;
  pendingReveal = null;
  cancelAnimationFrame(rafId);
  rafId = 0;
  const from = originState.progress <= 0.01 ? 1.0 : originState.progress;
  const durationMs = Math.max(320, Math.round(from * 580));
  const started = ctrl.startCollapse({
    ox: originState.ox,
    oy: originState.oy,
    from,
    durationMs,
    tMs: performance.now(),
  });
  syncToolbarUI();
  drawFrame({ forceGeo: !started });
  if (started) scheduleLoop();
});

progressSlider.addEventListener('input', () => {
  pendingReveal = null;
  cancelAnimationFrame(rafId);
  rafId = 0;
  ctrl.setProgress(Number(progressSlider.value) / 100);
  syncToolbarUI();
  drawFrame({ forceGeo: true });
});

ringSlider.addEventListener('input', () => {
  ctrl.setRingW(Number(ringSlider.value));
  syncToolbarUI();
  drawFrame();
});

reducedCheck.addEventListener('change', () => {
  if (isReduced() && originState.playing) {
    ctrl.step(performance.now());
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  syncToolbarUI();
  drawFrame({ forceGeo: true });
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  if (isReduced() && originState.playing) {
    ctrl.step(performance.now());
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  syncToolbarUI();
  drawFrame({ forceGeo: true });
});

// ---------------------------------------------------------------- Backend startup & visibility
function startBackend() {
  syncScenesUI();
  syncToolbarUI();
  const { cw, ch } = viewportSize();
  syncSurfaceSizes(cw, ch);

  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so both surfaces are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', (e) => {
    hasPainted = true;
    if (e?.changedElements?.length) {
      for (const el of e.changedElements) {
        if (el === surfaceA || surfaceA.contains(el)) dirtyA = true;
        if (el === surfaceB || surfaceB.contains(el)) dirtyB = true;
      }
    } else {
      dirtyA = true;
      dirtyB = true;
    }

    if (pendingReveal) {
      const { ox, oy } = pendingReveal;
      pendingReveal = null;
      const started = ctrl.startReveal({
        ox,
        oy,
        from: 0,
        to: 1,
        durationMs: 680,
        tMs: performance.now(),
      });
      syncScenesUI();
      syncToolbarUI();
      drawFrame({ allowUpload: true, forceGeo: true });
      if (started) scheduleLoop();
      return;
    }

    drawFrame({ allowUpload: true });
  });

  const forceRoute = new URLSearchParams(location.search).get('route');

  if (glSupported && forceRoute !== '2d') {
    try {
      stage = new ElementGL(canvas, {
        fragment: ORIGIN_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          texA = null;
          texB = null;
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so both surfaces moved to plain HTML.');
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          restoreFromPlain();
          backend = 'webgl';
          hasPainted = false;
          const s = viewportSize();
          syncSurfaceSizes(s.cw, s.ch);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      backend = 'webgl';
    } catch {
      stage = null;
    }
  }

  if (backend === 'none') {
    ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      switchToPlain('Canvas rendering is unavailable here, so both surfaces are shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so both surfaces moved to plain HTML.');
        }
      }, 900);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = false;
      const s = viewportSize();
      syncSurfaceSizes(s.cw, s.ch);
      canvas.requestPaint?.();
    });
  }

  canvas.requestPaint?.();
}

function pauseAnimation() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (originState.playing && !pausedAtMs) {
    pausedAtMs = performance.now();
  }
}

function resumeAnimation() {
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  if (pausedAtMs) {
    ctrl.shiftStart(performance.now() - pausedAtMs);
    pausedAtMs = 0;
  }
  if (hasPainted) drawFrame();
  if (originState.playing) scheduleLoop();
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    const nowVisible = Boolean(entry && entry.isIntersecting);
    if (nowVisible === isVisible) return;
    isVisible = nowVisible;
    if (isVisible) resumeAnimation();
    else pauseAnimation();
  }, { threshold: 0.01 }).observe(viewportEl);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (backend === 'plain') return;
    unitCache.keyA = '';
    unitCache.keyB = '';
    lastGeoSig = '';
    dirtyA = true;
    dirtyB = true;
    const { cw, ch } = viewportSize();
    syncSurfaceSizes(cw, ch);
    if (hasPainted) {
      syncGeometry(true);
      canvas.requestPaint?.();
    } else {
      canvas.requestPaint?.();
    }
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseAnimation();
  else resumeAnimation();
});

startBackend();
updateHud();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, msg) => { if (!ok) throw new Error(msg); return msg; };
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function retireFixture(g, rootEl, canvasEl, baseActive) {
  g?.dispose();
  rootEl?.remove();
  window.__gfx?.retire?.(canvasEl);
  for (let i = 0; i < 15; i++) {
    const active = window.__gfx?.active?.() ?? 0;
    const removed = window.__gfx?.memory?.().removed ?? 0;
    if (active <= baseActive && removed === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function makeOriginFixture(w = 280, h = 220, { stripes = false } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const makeBtn = (label, cssPos, bg, fg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      `position:absolute;${cssPos};width:88px;height:36px;border-radius:99px;` +
      `border:1px solid ${fg};background:${bg};color:${fg};font:700 11px system-ui;pointer-events:auto`;
    return b;
  };

  const makeInput = (value, label, cssPos, bg, fg, bd) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.setAttribute('inputmode', 'none');
    inp.setAttribute('aria-label', label);
    inp.style.cssText =
      `position:absolute;${cssPos};width:110px;height:36px;padding:4px 6px;box-sizing:border-box;` +
      `border-radius:7px;border:1.5px solid ${bd};background:${bg};color:${fg};font:600 11px system-ui;pointer-events:auto`;
    return inp;
  };

  const bgA = stripes
    ? 'repeating-linear-gradient(90deg, #faf6ee 0 18px, #252019 18px 22px)'
    : '#f5ede0';
  const bgB = stripes
    ? 'repeating-linear-gradient(90deg, #0b1222 0 18px, #38bdf8 18px 22px)'
    : '#091120';

  const fA = document.createElement('section');
  fA.setAttribute('drawable', '');
  fA.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:${bgA};color:#191815;box-sizing:border-box;pointer-events:none`;
  const aPillTL = makeBtn('A-TL', 'left:10px;top:10px', '#1d222b', '#fbf8f2');
  const aPillBR = makeBtn('A-BR', 'right:10px;bottom:10px', '#c84218', '#ffffff');
  const aInp = makeInput('Paper A', 'Fixture Surface A note', 'left:10px;bottom:10px', '#ffffff', '#1b1814', '#b5a287');
  fA.append(aPillTL, aPillBR, aInp);

  const fB = document.createElement('section');
  fB.setAttribute('drawable', '');
  fB.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:${bgB};color:#eef4ff;box-sizing:border-box;pointer-events:none`;
  const bPillTL = makeBtn('B-TL', 'left:10px;top:10px', '#0ea5e9', '#041524');
  const bPillBR = makeBtn('B-BR', 'right:10px;bottom:10px', '#34d399', '#042116');
  const bInp = makeInput('Studio B', 'Fixture Surface B note', 'right:10px;top:10px', '#061020', '#f8fafc', '#38bdf8');
  fB.append(bPillTL, bPillBR, bInp);

  cv.append(fA, fB);
  return { cv, fA, fB, aPillTL, aPillBR, aInp, bPillTL, bPillBR, bInp };
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const lum = (px) => 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];

function drawOriginFixture(g, cv, tA, tB, w, h, { ox = 0.5, oy = 0.5, progress = 0, ringW = 18, reduced = 0 }) {
  g.begin([0, 0, 0, 1]);
  g.quad(tA.el, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tB.tex);
    gl.uniform1i(loc('uTexB'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform2f(loc('uOrigin'), ox, oy);
    gl.uniform1f(loc('uProgress'), progress);
    gl.uniform1f(loc('uRingW'), ringW);
    gl.uniform1f(loc('uReduced'), reduced);
  });
}

const tests = [
  {
    name: 'ElementGL uploads both HTML surfaces via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture with two full-stage drawable surfaces on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), renders 0% and 100%, and checks gl.getError() === 0.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280;
      const H = 220;
      const { cv, fA, fB } = makeOriginFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: ORIGIN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        if (!g.begin([0, 0, 0, 1])) throw new Error('ElementGL.begin() returned false');
        const tA = g.upload(fA);
        const tB = g.upload(fB);

        drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { progress: 0 });
        const pxA = readCssPixel(g.gl, cv, W, H, 140, 110);

        drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { progress: 1 });
        const pxB = readCssPixel(g.gl, cv, W, H, 140, 110);

        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR && tA?.w > 0 && tB?.w > 0 && lum(pxA) > 205 && lum(pxB) < 55,
          `glErr=${err}, surfA=${tA?.w}x${tA?.h} rgb(${pxA.slice(0, 3)}), surfB=${tB?.w}x${tB?.h} rgb(${pxB.slice(0, 3)}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Corner-anchored expansion and tMs timing flip top-left vs bottom-right corners first',
    expect: 'pass',
    why: 'Steps createOriginController() with explicit tMs timestamps (0 -> 0.5 -> 1.0 expansion, reverse collapse 1.0 -> 0, and reduced-motion snap), then renders 42% from top-left (0.12, 0.14) vs bottom-right (0.88, 0.86) to confirm opposite corners reveal first.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      let reduced = false;
      const fx = createOriginController({ initialProgress: 0, isReduced: () => reduced });
      fx.startReveal({ ox: 0.12, oy: 0.14, from: 0, to: 1, durationMs: 1000, tMs: 2000 });
      const mStart = fx.step(2000);
      const p0 = fx.s.progress;
      const mMid = fx.step(2500);
      const pMid = fx.s.progress;
      const mEnd = fx.step(3000);
      const pEnd = fx.s.progress;

      fx.startCollapse({ ox: 0.88, oy: 0.86, from: 1, durationMs: 800, tMs: 4000 });
      const mRevMid = fx.step(4400);
      const pRevMid = fx.s.progress;
      const mRevEnd = fx.step(4800);
      const pRevEnd = fx.s.progress;

      reduced = true;
      const mSnap = fx.startReveal({ ox: 0.5, oy: 0.5, from: 0, to: 1, durationMs: 1000, tMs: 5000 });
      const pSnap = fx.s.progress;

      const timingOk = mStart && Math.abs(p0) < 0.01 &&
        mMid && Math.abs(pMid - 0.5) < 0.01 &&
        !mEnd && Math.abs(pEnd - 1) < 0.01 &&
        mRevMid && Math.abs(pRevMid - 0.5) < 0.01 &&
        !mRevEnd && Math.abs(pRevEnd) < 0.01 &&
        !mSnap && Math.abs(pSnap - 1) < 0.01;

      const W = 280;
      const H = 220;
      const { cv, fA, fB } = makeOriginFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: ORIGIN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tA = g.upload(fA);
        const tB = g.upload(fB);

        // Top-left origin at 42%: TL (68, 60) is inside circle (< 55), BR (210, 155) stays Surface A (> 205).
        drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, {
          ox: 0.12, oy: 0.14, progress: 0.42, ringW: 12,
        });
        const tl1 = lum(readCssPixel(g.gl, cv, W, H, 68, 60));
        const br1 = lum(readCssPixel(g.gl, cv, W, H, 210, 155));

        // Bottom-right origin at 42%: BR (210, 155) flips inside (< 55), TL (68, 60) flips back to Surface A (> 205).
        drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, {
          ox: 0.88, oy: 0.86, progress: 0.42, ringW: 12,
        });
        const tl2 = lum(readCssPixel(g.gl, cv, W, H, 68, 60));
        const br2 = lum(readCssPixel(g.gl, cv, W, H, 210, 155));

        const err = g.gl.getError();
        return need(
          timingOk && err === g.gl.NO_ERROR && tl1 < 55 && br1 > 205 && br2 < 55 && tl2 > 205,
          `tMs mid=${pMid.toFixed(2)} rev=${pRevMid.toFixed(2)}; TL-origin(TL=${tl1.toFixed(0)},BR=${br1.toFixed(0)}); BR-origin(TL=${tl2.toFixed(0)},BR=${br2.toFixed(0)}) glErr=${err}.`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Optical lens ring at 50% shows specular glint, RGB chromatic dispersion and radial UV refraction',
    expect: 'pass',
    why: 'Renders a striped dual-surface fixture at 50% from (0.25, 0.50) with ringW = 20 vs ringW = 0, scanning across the wavefront circumference for specular rim peak, inner/outer R-B dispersion flips, and radial UV displacement.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280;
      const H = 220;
      const { cv, fA, fB } = makeOriginFixture(W, H, { stripes: false });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: ORIGIN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tA = g.upload(fA);
        const tB = g.upload(fB);

        const ox = 0.25;
        const oy = 0.50;
        const r = 0.50 * maxCornerDist(ox * W, oy * H, W, H);
        const rimX = ox * W + r;

        drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, {
          ox, oy, progress: 0.50, ringW: 20,
        });

        const insideLum = lum(readCssPixel(g.gl, cv, W, H, Math.round(rimX - 42), 110));
        const outsideLum = lum(readCssPixel(g.gl, cv, W, H, Math.round(rimX + 42), 110));

        let peakLum = 0;
        let innerBlueMinusRed = -999;
        let outerRedMinusBlue = -999;
        for (let dx = -20; dx <= 20; dx++) {
          const px = readCssPixel(g.gl, cv, W, H, Math.round(rimX + dx), 110);
          peakLum = Math.max(peakLum, lum(px));
          if (dx <= -4 && dx >= -16) innerBlueMinusRed = Math.max(innerBlueMinusRed, px[2] - px[0]);
          if (dx >= 4 && dx <= 16) outerRedMinusBlue = Math.max(outerRedMinusBlue, px[0] - px[2]);
        }

        // Compare ringW = 20 vs sharp ringW = 0 across the inner ring band (dx = -10) to prove radial distortion.
        const pxLens = readCssPixel(g.gl, cv, W, H, Math.round(rimX - 10), 110);
        drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, {
          ox, oy, progress: 0.50, ringW: 0,
        });
        const pxSharp = readCssPixel(g.gl, cv, W, H, Math.round(rimX - 10), 110);
        const refractDelta = Math.abs(pxLens[0] - pxSharp[0]) + Math.abs(pxLens[1] - pxSharp[1]) + Math.abs(pxLens[2] - pxSharp[2]);

        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR &&
            insideLum < 55 &&
            outsideLum > 205 &&
            peakLum >= 210 &&
            innerBlueMinusRed >= 15 &&
            outerRedMinusBlue >= 10 &&
            refractDelta >= 20,
          `in=${insideLum.toFixed(0)}, out=${outsideLum.toFixed(0)}, peak=${peakLum.toFixed(0)}, inner(B-R)=${innerBlueMinusRed}, outer(R-B)=${outerRedMinusBlue}, refractDelta=${refractDelta} (glErr=${err}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'updateElementGeometry() hit-testing tracks active surface at 0%, 50% mid-reveal and 100%',
    expect: 'pass',
    why: 'Calibrates geometryUnit() with dataset.hitTick on testStage(), checking elementsFromPoint() and clicks on Surface A (0%), mixed inside/outside surfaces at 50% from top-left, and Surface B (100%).',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 280;
      const H = 220;
      const fix = makeOriginFixture(W, H);
      const { cv, fA, fB, aPillTL, aPillBR, aInp, bPillTL, bPillBR, bInp } = fix;
      const fAHits = [aPillTL, aPillBR, aInp];
      const fBHits = [bPillTL, bPillBR, bInp];

      let aClicks = 0;
      let bClicks = 0;
      aPillTL.addEventListener('click', () => { aClicks++; });
      aPillBR.addEventListener('click', () => { aClicks++; });
      bPillTL.addEventListener('click', () => { bClicks++; });
      bPillBR.addEventListener('click', () => { bClicks++; });

      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: ORIGIN_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 1]);
        } else {
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv.width = Math.round(W * dpr);
          cv.height = Math.round(H * dpr);
          cv.getContext('2d');
        }
        await nextPaint(cv);

        let tA = null;
        let tB = null;
        if (g) {
          g.begin([0, 0, 0, 1]);
          tA = g.upload(fA);
          tB = g.upload(fB);
        }

        const applyReveal = async (progress, ox = 0.12, oy = 0.14) => {
          if (g) {
            drawOriginFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { ox, oy, progress });
          } else {
            const ctx = cv.getContext('2d');
            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            ctx.reset();
            ctx.scale(dpr, dpr);
            ctx.drawElementImage(progress >= 0.5 ? fB : fA, 0, 0, W, H);
          }

          const uA = geometryUnit(cv, fA, W);
          const uB = geometryUnit(cv, fB, W);
          if (progress <= 0.005) {
            fA.inert = false;
            fB.inert = true;
            for (const el of fAHits) { el.inert = false; el.style.pointerEvents = 'auto'; }
            for (const el of fBHits) { el.inert = true; el.style.pointerEvents = 'none'; }
            cv.updateElementGeometry(fA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
            if (OFFSTAGE) cv.updateElementGeometry(fB, { canvasTransform: OFFSTAGE });
          } else if (progress >= 0.995) {
            fA.inert = true;
            fB.inert = false;
            for (const el of fAHits) { el.inert = true; el.style.pointerEvents = 'none'; }
            for (const el of fBHits) { el.inert = false; el.style.pointerEvents = 'auto'; }
            if (OFFSTAGE) cv.updateElementGeometry(fA, { canvasTransform: OFFSTAGE });
            cv.updateElementGeometry(fB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
          } else {
            fA.inert = false;
            fB.inert = false;
            for (const el of fAHits) {
              const [lx, ly] = controlLocalCenter(el, fA);
              const inB = isPointInsideWavefront(lx, ly, ox, oy, progress, W, H);
              el.inert = inB;
              el.style.pointerEvents = inB ? 'none' : 'auto';
            }
            for (const el of fBHits) {
              const [lx, ly] = controlLocalCenter(el, fB);
              const inB = isPointInsideWavefront(lx, ly, ox, oy, progress, W, H);
              el.inert = !inB;
              el.style.pointerEvents = inB ? 'auto' : 'none';
            }
            cv.updateElementGeometry(fA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
            cv.updateElementGeometry(fB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
          }
          fA.dataset.hitTick = fA.dataset.hitTick === '1' ? '0' : '1';
          fB.dataset.hitTick = fB.dataset.hitTick === '1' ? '0' : '1';
          await raf2();
        };

        const hit = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };

        await applyReveal(0);
        const h0TL = hit(aPillTL).includes(aPillTL);
        const h0InA = hit(aInp).includes(aInp);
        if (h0TL) aPillTL.click();

        await applyReveal(0.5, 0.12, 0.14);
        const h50B = hit(bPillTL).includes(bPillTL) && !hit(bPillTL).includes(aPillTL);
        const h50A = hit(aPillBR).includes(aPillBR) && !hit(aPillBR).includes(bPillBR);
        if (h50B) bPillTL.click();
        if (h50A) aPillBR.click();

        await applyReveal(1);
        const h100BR = hit(bPillBR).includes(bPillBR);
        const h100InB = hit(bInp).includes(bInp);
        if (h100BR) bPillBR.click();

        return need(
          h0TL && h0InA && h50B && h50A && h100BR && h100InB && aClicks === 2 && bClicks === 2,
          `0%(TL=${h0TL},InA=${h0InA}); 50%(B_TL=${h50B},A_BR=${h50A}); 100%(BR=${h100BR},InB=${h100InB}); clicks A=${aClicks} B=${bClicks}.`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-argument 2D radial clip fallback',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored without calling loseContext(), verifies plain-HTML survival and WebGL restore, then checks 5-argument 2D drawElementImage() radial clipping.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 150;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, fA, fB, aPillTL, bPillBR } = makeOriginFixture(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        // Part A of Check 5: hide cv while plain is shown (just like .is-plain #or-canvas { display: none; })
        // so both plain surfaces stay inside testStage()'s 340px viewport without clipping.
        g = new ElementGL(cv, {
          fragment: ORIGIN_FRAG,
          attributes: { preserveDrawingBuffer: true },
          onLost: () => {
            lostOk = true;
            cv.style.display = 'none';
            plain.hidden = false;
            plain.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;width:280px';
            plain.append(fA, fB);
            fA.style.position = 'relative';
            fA.style.width = '137px';
            fA.style.height = '130px';
            fB.style.position = 'relative';
            fB.style.width = '137px';
            fB.style.height = '130px';
          },
          onRestored: () => {
            restoredOk = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            plain.style.display = 'none';
            cv.style.display = 'block';
            fA.style.position = 'absolute';
            fA.style.width = `${W}px`;
            fA.style.height = `${H}px`;
            fB.style.position = 'absolute';
            fB.style.width = `${W}px`;
            fB.style.height = `${H}px`;
            cv.append(fA, fB);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        g.upload(fA);
        g.upload(fB);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(fA) && plain.contains(fB);
        const rA = aPillTL.getBoundingClientRect();
        const rB = bPillBR.getBoundingClientRect();
        const plainHitA = document.elementsFromPoint(rA.left + rA.width * 0.5, rA.top + rA.height * 0.5).includes(aPillTL);
        const plainHitB = document.elementsFromPoint(rB.left + rB.width * 0.5, rB.top + rB.height * 0.5).includes(bPillBR);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tAfterA = g.upload(fA);
        const tAfterB = g.upload(fB);
        const err = g.gl.getError();

        // Part B: 5-argument 2D radial clip fallback on a fresh drawable canvas
        const cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = `width:${W}px;height:${H}px;display:block`;
        const boxA = document.createElement('div');
        boxA.setAttribute('drawable', '');
        boxA.style.cssText = `width:${W}px;height:${H}px;background:#f5ede0`;
        const boxB = document.createElement('div');
        boxB.setAttribute('drawable', '');
        boxB.style.cssText = `width:${W}px;height:${H}px;background:#091120`;
        cv2d.append(boxA, boxB);
        testStage().append(cv2d);
        try {
          const ctx = cv2d.getContext('2d');
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2d.width = Math.round(W * dpr);
          cv2d.height = Math.round(H * dpr);
          await nextPaint(cv2d);

          ctx.reset();
          ctx.scale(dpr, dpr);
          ctx.drawElementImage(boxA, 0, 0, W, H);
          ctx.save();
          ctx.beginPath();
          ctx.arc(36, 36, 85, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawElementImage(boxB, 0, 0, W, H);
          ctx.restore();

          const copy = document.createElement('canvas');
          copy.width = W;
          copy.height = H;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0, W, H);
          const pxInside = cc.getImageData(40, 40, 1, 1).data;
          const pxOutside = cc.getImageData(210, 125, 1, 1).data;
          const drawsWrong = window.__gfx?.draws?.wrong ?? 0;
          const drawsNoSize = window.__gfx?.draws?.noSize ?? 0;

          return need(
            inPlain && plainHitA && plainHitB && restoredOk && !g.lost && tAfterA?.w > 0 && tAfterB?.w > 0 &&
              err === g.gl.NO_ERROR && lum(pxInside) < 55 && lum(pxOutside) > 205 && drawsWrong === 0 && drawsNoSize === 0,
            `plainLost=${inPlain}, plainHits=${plainHitA}/${plainHitB}, restored=${restoredOk}, glErr=${err}, 2dIn=${lum(pxInside).toFixed(0)}, 2dOut=${lum(pxOutside).toFixed(0)}, drawWrong=${drawsWrong}.`
          );
        } finally {
          cv2d.remove();
          window.__gfx?.retire?.(cv2d);
        }
      } finally {
        await retireFixture(g, wrap, cv, baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'origin-reveal canvas',
      note: 'plain HTML',
      ink: async () => {
        if (backend === 'plain') return null;
        if (!hasPainted || !canvas.width || !canvas.height) return 0;
        if (backend === 'webgl') {
          if (!stage || stage.lost || !texA || !texB) return 0;
          drawFrame({ forceGeo: true });
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => switchToPlain('The origin-reveal canvas came back blank, so both surfaces moved to plain HTML.'),
    },
  ]),
];

runTests(checksBody, tests);
