import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const DEFAULT_SLAT_COUNT = 10;
export const MIN_SLAT_COUNT = 4;
export const MAX_SLAT_COUNT = 24;
export const DEFAULT_STAGGER = 0.55;
export const DEFAULT_DURATION_MS = 950;

export const AXIS_VECTORS = {
  horizontal: [0, 1],
  vertical: [1, 0],
  diagonal: [Math.SQRT1_2, Math.SQRT1_2],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

// #region wave-timing
export function slatLocalProgress(index, count, progress, stagger = DEFAULT_STAGGER) {
  const n = Math.max(1, count);
  const frac = n > 1 ? index / (n - 1) : 0;
  const clampedStagger = clamp(stagger, 0, 0.85);
  const span = Math.max(0.05, 1 - clampedStagger);
  const delay = frac * clampedStagger;
  const localP = clamp((progress - delay) / span, 0, 1);
  return localP * localP * (3 - 2 * localP);
}

export function slatAngleRad(index, count, progress, stagger = DEFAULT_STAGGER) {
  return Math.PI * slatLocalProgress(index, count, progress, stagger);
}

export function createBlindsWave({
  durationMs = DEFAULT_DURATION_MS,
  stagger = DEFAULT_STAGGER,
  isReduced = () => false,
} = {}) {
  const s = {
    progress: 0,
    target: 0,
    from: 0,
    startMs: 0,
    durationMs,
    stagger,
    animating: false,
  };

  function startFlip(toTarget, tMs = performance.now()) {
    const next = toTarget >= 0.5 ? 1 : 0;
    s.target = next;
    if (isReduced() || Math.abs(next - s.progress) < 0.001) {
      s.progress = next;
      s.from = next;
      s.startMs = tMs;
      s.animating = false;
      return false;
    }
    s.from = s.progress;
    s.startMs = tMs;
    // Scale duration proportionally if mid-scrub so returning feels even.
    s.durationMs = Math.max(180, Math.round(durationMs * Math.abs(next - s.from)));
    s.animating = true;
    return true;
  }

  function stepWave(tMs = performance.now()) {
    if (!s.animating) return false;
    if (isReduced()) {
      s.progress = s.target;
      s.from = s.target;
      s.animating = false;
      return false;
    }
    const elapsed = Math.max(0, tMs - s.startMs);
    const u = clamp(elapsed / Math.max(1, s.durationMs), 0, 1);
    const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    s.progress = s.from + (s.target - s.from) * eased;
    if (u >= 1) {
      s.progress = s.target;
      s.animating = false;
      return false;
    }
    return true;
  }

  function scrubTo(value) {
    s.animating = false;
    s.progress = clamp(value, 0, 1);
    s.from = s.progress;
    s.target = s.progress >= 0.5 ? 1 : 0;
  }

  function snapTo(value) {
    const p = clamp(value, 0, 1);
    s.animating = false;
    s.progress = p;
    s.from = p;
    s.target = p >= 0.5 ? 1 : 0;
  }

  return { s, startFlip, stepWave, scrubTo, snapTo };
}
// #endregion wave-timing

// #region blinds-shader
export const BLINDS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;   // Front Sheet A
uniform sampler2D uTexB;  // Reverse Sheet B
uniform vec2 uCanvasSize;
uniform float uProgress;
uniform int uCount;
uniform float uStagger;
uniform vec2 uAxis;

in vec2 vUv;
out vec4 outColor;

const float PI = 3.14159265359;

float slatAngle(int idx, int count, float progress, float stagger) {
  float frac = count > 1 ? float(idx) / float(count - 1) : 0.0;
  float span = max(0.05, 1.0 - clamp(stagger, 0.0, 0.85));
  float delay = frac * clamp(stagger, 0.0, 0.85);
  float localP = clamp((progress - delay) / span, 0.0, 1.0);
  float eased = localP * localP * (3.0 - 2.0 * localP);
  return PI * eased;
}

vec3 sampleSheet(sampler2D tex, vec2 uv) {
  vec2 cuv = clamp(uv, vec2(0.0005), vec2(0.9995));
  vec4 s = texture(tex, cuv);
  return s.a > 0.002 ? clamp(s.rgb / s.a, 0.0, 1.0) : vec3(0.0);
}

vec3 darkCavity(vec2 localXY, vec2 tanAxis) {
  float vig = 1.0 - 0.35 * clamp(length(localXY) / max(length(uCanvasSize) * 0.6, 1.0), 0.0, 1.0);
  vec3 base = vec3(0.032, 0.044, 0.072) * vig;
  float tanCoord = dot(localXY, tanAxis);
  float tanSpan = max(1.0, uCanvasSize.x * abs(tanAxis.x) + uCanvasSize.y * abs(tanAxis.y));
  float uTan = tanCoord / tanSpan + 0.5;
  float cordL = exp(-pow((uTan - 0.20) * tanSpan / 1.4, 2.0));
  float cordR = exp(-pow((uTan - 0.80) * tanSpan / 1.4, 2.0));
  base += vec3(0.07, 0.09, 0.13) * max(cordL, cordR);
  return base;
}

void main() {
  if (uProgress <= 0.0005) {
    outColor = vec4(sampleSheet(uTex, vUv), 1.0);
    return;
  }
  if (uProgress >= 0.9995) {
    outColor = vec4(sampleSheet(uTexB, vUv), 1.0);
    return;
  }

  vec2 C = uCanvasSize * 0.5;
  vec2 pCss = vUv * uCanvasSize;
  vec2 localXY = pCss - C;
  vec2 axis = normalize(uAxis);
  vec2 tanAxis = vec2(-axis.y, axis.x);

  float D = max(620.0, 1.65 * max(uCanvasSize.x, uCanvasSize.y));
  vec3 camPos = vec3(0.0, 0.0, D);
  vec3 rayDir = vec3(localXY, -D);

  float sHalf = 0.5 * (uCanvasSize.x * abs(axis.x) + uCanvasSize.y * abs(axis.y));
  int count = clamp(uCount, 1, 24);
  float pitch = (2.0 * sHalf) / float(count);

  vec3 cavity = darkCavity(localXY, tanAxis);
  float t1 = 1e9;
  vec3 col1 = cavity;
  float cov1 = 1.0;
  float t2 = 1e9;
  vec3 col2 = cavity;

  float sPixel = dot(localXY, axis);
  vec3 lightDir = normalize(vec3(0.16, -0.30, 0.94));
  vec3 halfVec = normalize(lightDir + vec3(0.0, 0.0, 1.0));

  for (int i = 0; i < 24; i++) {
    if (i >= count) break;
    float sCenter = -sHalf + (float(i) + 0.5) * pitch;
    float theta = slatAngle(i, count, uProgress, uStagger);
    float sn = sin(theta);
    float cs = cos(theta);

    if (sn < 0.012) {
      if (abs(sPixel - sCenter) <= 0.5 * pitch + 0.001) {
        float tFlat = 1.0;
        vec3 hitCol = cs >= 0.0 ? sampleSheet(uTex, vUv) : sampleSheet(uTexB, vUv);
        if (tFlat < t1) {
          t1 = tFlat;
          col1 = hitCol;
          cov1 = 1.0;
        } else if (tFlat < t2) {
          t2 = tFlat;
          col2 = hitCol;
        }
      }
      continue;
    }

    float gapTrim = 0.42 * smoothstep(0.012, 0.16, sn);
    float hU = max(1.0, 0.5 * pitch - gapTrim);
    float hW = mix(0.65, 2.6, smoothstep(0.012, 0.28, sn));

    vec3 Bu = vec3(cs * axis.x, cs * axis.y, sn);
    vec3 Bv = vec3(tanAxis.x, tanAxis.y, 0.0);
    vec3 Bw = vec3(-sn * axis.x, -sn * axis.y, cs);

    vec3 Orel = camPos - vec3(axis * sCenter, 0.0);
    float ou = dot(Orel, Bu);
    float ow = dot(Orel, Bw);
    float du = dot(rayDir, Bu);
    float dw = dot(rayDir, Bw);

    float tUmin = -1e9;
    float tUmax = 1e9;
    if (abs(du) > 1e-6) {
      float invDu = 1.0 / du;
      float ta = (-hU - ou) * invDu;
      float tb = ( hU - ou) * invDu;
      tUmin = min(ta, tb);
      tUmax = max(ta, tb);
    } else if (abs(ou) > hU) {
      continue;
    }

    float tWmin = -1e9;
    float tWmax = 1e9;
    if (abs(dw) > 1e-6) {
      float invDw = 1.0 / dw;
      float ta = (-hW - ow) * invDw;
      float tb = ( hW - ow) * invDw;
      tWmin = min(ta, tb);
      tWmax = max(ta, tb);
    } else if (abs(ow) > hW) {
      continue;
    }

    float tEnter = max(tUmin, tWmin);
    float tExit = min(tUmax, tWmax);
    if (tEnter > tExit || tExit <= 0.0) continue;

    vec3 P_rel = Orel + tEnter * rayDir;
    float uHit = clamp(dot(P_rel, Bu), -hU, hU);
    float vHit = dot(P_rel, Bv);

    vec3 hitCol = vec3(0.0);
    bool validHit = false;

    if (tWmin >= tUmin) {
      bool isFront = dw < 0.0;
      // Negate uHit on the back face so View B stays upright and unmirrored past 90 degrees.
      float sSheet = isFront ? (sCenter + uHit) : (sCenter - uHit);
      vec2 sheetPx = C + sSheet * axis + vHit * tanAxis;
      vec2 sheetUv = sheetPx / uCanvasSize;
      if (sheetUv.x >= 0.0 && sheetUv.x <= 1.0 && sheetUv.y >= 0.0 && sheetUv.y <= 1.0) {
        vec3 texCol = isFront ? sampleSheet(uTex, sheetUv) : sampleSheet(uTexB, sheetUv);
        vec3 N = isFront ? Bw : -Bw;
        float env = smoothstep(0.012, 0.14, sn);
        float ndotl = clamp(dot(N, lightDir) / lightDir.z, 0.0, 1.0);
        float cosDirect = abs(N.z);
        float shade = mix(1.0, 0.22 + 0.78 * mix(cosDirect, ndotl, 0.42), env);
        float edgeDist = hU - abs(uHit);
        float edgeRim = (1.0 - smoothstep(0.0, 1.35, edgeDist)) * env * 0.14;
        hitCol = clamp(texCol * shade + vec3(edgeRim), 0.0, 1.0);
        validHit = true;
      }
    } else {
      float sSheet = cs >= 0.0 ? (sCenter + uHit) : (sCenter - uHit);
      vec2 sheetPx = C + sSheet * axis + vHit * tanAxis;
      vec2 sheetUv = sheetPx / uCanvasSize;
      if (sheetUv.x >= -0.002 && sheetUv.x <= 1.002 && sheetUv.y >= -0.002 && sheetUv.y <= 1.002) {
        vec3 N_rim = du < 0.0 ? Bu : -Bu;
        float rimDiff = 0.30 + 0.70 * max(dot(N_rim, lightDir), 0.0);
        float rimSpec = pow(max(dot(N_rim, halfVec), 0.0), 18.0) * 0.50;
        vec3 faceEdge = cs >= 0.0 ? sampleSheet(uTex, clamp(sheetUv, 0.0, 1.0)) : sampleSheet(uTexB, clamp(sheetUv, 0.0, 1.0));
        vec3 rimBase = mix(vec3(0.76, 0.80, 0.86), faceEdge, 0.35);
        hitCol = clamp(rimBase * rimDiff + vec3(1.0, 0.98, 0.94) * rimSpec, 0.0, 1.0);
        validHit = true;
      }
    }

    if (!validHit) continue;

    float cov = clamp((tExit - tEnter) * D * 0.58, 0.0, 1.0);
    if (tEnter < t1) {
      if (cov < 0.999 && t1 < t2) {
        t2 = t1;
        col2 = col1;
      }
      t1 = tEnter;
      col1 = hitCol;
      cov1 = cov;
    } else if (tEnter < t2) {
      t2 = tEnter;
      col2 = hitCol;
    }
  }

  vec3 finalCol = mix(col2, col1, cov1);
  outColor = vec4(finalCol, 1.0);
}`;
// #endregion blinds-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('sb-stage');
const viewportEl = document.getElementById('sb-viewport');
const canvas = document.getElementById('sb-canvas');
const sceneA = document.getElementById('sb-scene-a');
const sceneB = document.getElementById('sb-scene-b');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('sb-notice');
const statusEl = document.getElementById('sb-status');
const testsBody = document.getElementById('tests');

// Scene A controls
const inputA = document.getElementById('sb-input-a');
const countBtnA = document.getElementById('sb-count-a');
const accentBtnA = document.getElementById('sb-accent-a');
const outA = document.getElementById('sb-out-a');
const tagA = document.getElementById('sb-tag-a');

// Scene B controls
const inputB = document.getElementById('sb-input-b');
const countBtnB = document.getElementById('sb-count-b');
const modeBtnB = document.getElementById('sb-mode-b');
const outB = document.getElementById('sb-out-b');
const tagB = document.getElementById('sb-tag-b');

// External controls
const flipBtn = document.getElementById('btn-flip');
const axisBtns = Array.from(document.querySelectorAll('[data-axis]'));
const scrubSlider = document.getElementById('rng-scrub');
const scrubOut = document.getElementById('out-scrub');
const slatsSlider = document.getElementById('rng-slats');
const slatsOut = document.getElementById('out-slats');
const reducedCheck = document.getElementById('chk-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

const PAPERS = [
  { id: 'ivory', label: 'Ivory' },
  { id: 'cream', label: 'Cream' },
  { id: 'newsprint', label: 'Newsprint' },
];
const GRIDS = [
  { id: 'cobalt', label: 'Cobalt' },
  { id: 'slate', label: 'Slate' },
  { id: 'emerald', label: 'Emerald' },
];

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  axis: 'horizontal',
  slats: DEFAULT_SLAT_COUNT,
  stagger: DEFAULT_STAGGER,
  countA: 0,
  paperIdx: 0,
  countB: 0,
  gridIdx: 0,
  onScreen: true,
  hasPainted: false,
  dirtyA: true,
  dirtyB: true,
  uploads: 0,
  paints: 0,
  lastGeoKey: '',
  unitCache: { aKey: '', aUnit: 1, bKey: '', bUnit: 1 },
};

const wave = createBlindsWave({
  durationMs: DEFAULT_DURATION_MS,
  stagger: DEFAULT_STAGGER,
  isReduced,
});

let stage = null;
let ctx2d = null;
let rafId = 0;
let lostTimer = 0;
let drag = null;
let suppressNextClick = false;

function showNotice(msg) {
  if (!msg) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = msg;
  }
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 360);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 412);
  return { cw, ch };
}

function syncSceneSizes(cw, ch) {
  if (state.backend === 'plain') {
    for (const el of [sceneA, sceneB]) {
      if (el.style.width) el.style.width = '';
      if (el.style.height) el.style.height = '';
    }
    return;
  }
  const w = `${cw}px`;
  const h = `${ch}px`;
  for (const el of [sceneA, sceneB]) {
    if (el.style.width !== w) el.style.width = w;
    if (el.style.height !== h) el.style.height = h;
  }
}

function syncScenesUI() {
  const paper = PAPERS[state.paperIdx];
  sceneA.dataset.paper = paper.id;
  tagA.textContent = `01 · Daylight · ${paper.label}`;
  countBtnA.textContent = `Bookmark +1 (${state.countA})`;
  accentBtnA.textContent = `Paper: ${paper.label}`;
  outA.textContent = `${state.countA} saved`;

  const grid = GRIDS[state.gridIdx];
  sceneB.dataset.grid = grid.id;
  tagB.textContent = `02 · Night · ${grid.label}`;
  countBtnB.textContent = `Pulse +1 (${state.countB})`;
  modeBtnB.textContent = `Grid: ${grid.label}`;
  outB.textContent = `${state.countB} ${state.countB === 1 ? 'pulse' : 'pulses'}`;
}

function syncUiFromProgress() {
  const pct = Math.round(wave.s.progress * 100);
  scrubSlider.value = String(pct);
  scrubOut.textContent = `${pct}%`;
  slatsSlider.value = String(state.slats);
  slatsOut.textContent = `${state.slats} slats`;
  const showingB = wave.s.progress >= 0.5;
  flipBtn.textContent = showingB ? 'Flip blinds → A' : 'Flip blinds → B';
  for (const b of axisBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.axis === state.axis));
  }
  if (state.backend === 'plain') {
    sceneA.dataset.active = String(!showingB);
    sceneB.dataset.active = String(showingB);
    sceneA.inert = showingB;
    sceneB.inert = !showingB;
    sceneA.style.pointerEvents = !showingB ? 'auto' : 'none';
    sceneB.style.pointerEvents = showingB ? 'auto' : 'none';
  }
  updateStatus();
}

function updateStatus() {
  const route = state.backend === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.backend === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const side = wave.s.progress <= 0.005
    ? 'Front Sheet A (0%)'
    : wave.s.progress >= 0.995
      ? 'Reverse Sheet B (100%)'
      : `Turning ${(wave.s.progress * 100).toFixed(0)}%`;
  const mp = state.backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${route} · ${side} · ${state.slats} ${state.axis} slats · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

// #region geometry-sync
function cachedUnit(el, cw, cacheKeyField, unitField) {
  const zoom = el.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${cw}/${zoom}`;
  if (state.unitCache[cacheKeyField] !== key) {
    state.unitCache[unitField] = geometryUnit(canvas, el, cw);
    state.unitCache[cacheKeyField] = key;
    state.lastGeoKey = '';
  }
  return state.unitCache[unitField] || 1;
}

export function syncHitGeometry(force = false) {
  if (state.backend === 'plain' || !state.hasPainted || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch } = getViewportSize();
  const activeA = wave.s.progress <= 0.005 && !wave.s.animating && !drag;
  const activeB = wave.s.progress >= 0.995 && !wave.s.animating && !drag;

  if (sceneA.inert !== !activeA) sceneA.inert = !activeA;
  if (sceneB.inert !== !activeB) sceneB.inert = !activeB;
  const peA = activeA ? 'auto' : 'none';
  const peB = activeB ? 'auto' : 'none';
  if (sceneA.style.pointerEvents !== peA) sceneA.style.pointerEvents = peA;
  if (sceneB.style.pointerEvents !== peB) sceneB.style.pointerEvents = peB;

  const key = `${state.backend}:${canvas.width}x${canvas.height}:${cw}x${ch}:${activeA ? 1 : 0}:${activeB ? 1 : 0}`;
  if (!force && key === state.lastGeoKey) return;
  state.lastGeoKey = key;

  const uA = cachedUnit(sceneA, cw, 'aKey', 'aUnit');
  const uB = cachedUnit(sceneB, cw, 'bKey', 'bUnit');

  if (activeA) {
    canvas.updateElementGeometry(sceneA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
    if (OFFSTAGE) canvas.updateElementGeometry(sceneB, { canvasTransform: OFFSTAGE });
  } else if (activeB) {
    if (OFFSTAGE) canvas.updateElementGeometry(sceneA, { canvasTransform: OFFSTAGE });
    canvas.updateElementGeometry(sceneB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
  } else if (OFFSTAGE) {
    canvas.updateElementGeometry(sceneA, { canvasTransform: OFFSTAGE });
    canvas.updateElementGeometry(sceneB, { canvasTransform: OFFSTAGE });
  }
  sceneA.dataset.hitTick = sceneA.dataset.hitTick === '1' ? '0' : '1';
  sceneB.dataset.hitTick = sceneB.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

// #region fallback-2d
function draw2DFallback(cw, ch, forceGeo = false) {
  if (!ctx2d || !state.hasPainted) return;
  syncSceneSizes(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const p = wave.s.progress;
  ctx2d.reset();
  ctx2d.scale(dpr, dpr);

  if (p <= 0.0005) {
    ctx2d.drawElementImage(sceneA, 0, 0, cw, ch);
    syncHitGeometry(forceGeo);
    state.paints++;
    updateStatus();
    return;
  }
  if (p >= 0.9995) {
    ctx2d.drawElementImage(sceneB, 0, 0, cw, ch);
    syncHitGeometry(forceGeo);
    state.paints++;
    updateStatus();
    return;
  }

  ctx2d.fillStyle = '#080b12';
  ctx2d.fillRect(0, 0, cw, ch);

  const n = state.slats;
  const [ax, ay] = AXIS_VECTORS[state.axis] || AXIS_VECTORS.horizontal;
  const sHalf = 0.5 * (cw * Math.abs(ax) + ch * Math.abs(ay));
  const pitch = (2 * sHalf) / n;
  const halfLen = Math.hypot(cw, ch) * 0.65;
  const cx0 = cw * 0.5;
  const cy0 = ch * 0.5;
  const axisAngle = Math.atan2(ay, ax);

  for (let i = 0; i < n; i++) {
    const theta = slatAngleRad(i, n, p, state.stagger);
    const cosT = Math.cos(theta);
    const absCos = Math.abs(cosT);
    const sCenter = -sHalf + (i + 0.5) * pitch;
    const el = cosT >= 0 ? sceneA : sceneB;

    if (absCos < 0.04) {
      ctx2d.save();
      ctx2d.translate(cx0 + sCenter * ax, cy0 + sCenter * ay);
      ctx2d.rotate(axisAngle);
      ctx2d.fillStyle = '#aab4c8';
      ctx2d.fillRect(-1.5, -halfLen, 3, 2 * halfLen);
      ctx2d.restore();
      continue;
    }

    const stripW = pitch * absCos;
    ctx2d.save();
    if (state.axis === 'horizontal') {
      const cy = cy0 + sCenter;
      ctx2d.beginPath();
      ctx2d.rect(0, cy - stripW * 0.5, cw, stripW);
      ctx2d.clip();
      ctx2d.drawElementImage(el, 0, cy * (1 - absCos), cw, ch * absCos);
      const shadeAlpha = (1 - absCos) * 0.62;
      if (shadeAlpha > 0.01) {
        ctx2d.fillStyle = `rgb(0 0 0 / ${shadeAlpha.toFixed(3)})`;
        ctx2d.fillRect(0, cy - stripW * 0.5, cw, stripW);
      }
      ctx2d.fillStyle = 'rgb(220 228 242 / 0.55)';
      ctx2d.fillRect(0, cy - stripW * 0.5, cw, 1.5);
    } else if (state.axis === 'vertical') {
      const cx = cx0 + sCenter;
      ctx2d.beginPath();
      ctx2d.rect(cx - stripW * 0.5, 0, stripW, ch);
      ctx2d.clip();
      ctx2d.drawElementImage(el, cx * (1 - absCos), 0, cw * absCos, ch);
      const shadeAlpha = (1 - absCos) * 0.62;
      if (shadeAlpha > 0.01) {
        ctx2d.fillStyle = `rgb(0 0 0 / ${shadeAlpha.toFixed(3)})`;
        ctx2d.fillRect(cx - stripW * 0.5, 0, stripW, ch);
      }
      ctx2d.fillStyle = 'rgb(220 228 242 / 0.55)';
      ctx2d.fillRect(cx - stripW * 0.5, 0, 1.5, ch);
    } else {
      const hx = cx0 + sCenter * ax;
      const hy = cy0 + sCenter * ay;
      ctx2d.translate(hx, hy);
      ctx2d.rotate(axisAngle);
      ctx2d.beginPath();
      ctx2d.rect(-stripW * 0.5, -halfLen, stripW, 2 * halfLen);
      ctx2d.clip();
      ctx2d.scale(absCos, 1);
      ctx2d.rotate(-axisAngle);
      ctx2d.translate(-hx, -hy);
      ctx2d.drawElementImage(el, 0, 0, cw, ch);
      ctx2d.restore();
      ctx2d.save();
      ctx2d.translate(hx, hy);
      ctx2d.rotate(axisAngle);
      const shadeAlpha = (1 - absCos) * 0.62;
      if (shadeAlpha > 0.01) {
        ctx2d.fillStyle = `rgb(0 0 0 / ${shadeAlpha.toFixed(3)})`;
        ctx2d.fillRect(-stripW * 0.5, -halfLen, stripW, 2 * halfLen);
      }
      ctx2d.fillStyle = 'rgb(220 228 242 / 0.55)';
      ctx2d.fillRect(-stripW * 0.5, -halfLen, 1.5, 2 * halfLen);
    }
    ctx2d.restore();
  }

  syncHitGeometry(forceGeo);
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  stopLoop();
  state.backend = 'plain';
  stageBox.classList.add('is-plain');
  for (const el of [sceneA, sceneB]) {
    if (el.parentElement !== plainHost) plainHost.append(el);
  }
  syncSceneSizes(0, 0);
  wave.snapTo(wave.s.progress >= 0.5 ? 1 : 0);
  syncUiFromProgress();
  showNotice(reason);
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const el of [sceneA, sceneB]) {
    delete el.dataset.active;
    if (el.parentElement !== canvas) canvas.append(el);
  }
  state.unitCache.aKey = '';
  state.unitCache.bKey = '';
  state.lastGeoKey = '';
  state.dirtyA = true;
  state.dirtyB = true;
  showNotice('');
}
// #endregion fallback-2d

// Keep a map of the texture objects returned by stage.upload() so we can bind Scene B to TEXTURE1.
const stageTextures = new Map();

function uploadBothOnStage(el) {
  if (!stage || stage.lost) return false;
  try {
    const t = stage.upload(el);
    if (t) {
      stageTextures.set(el, t);
      state.uploads++;
      return true;
    }
    return false;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return false;
    }
    throw err;
  }
}

function renderStageFrame(forceGeo = false) {
  if (!state.hasPainted || state.backend === 'plain' || state.backend === 'none') return;
  const { cw, ch } = getViewportSize();
  if (!cw || !ch) return;

  if (state.backend === 'webgl' && stage && !stage.lost) {
    syncSceneSizes(cw, ch);
    if (!stage.begin([0, 0, 0, 0])) return;

    if (state.dirtyA || !stageTextures.has(sceneA)) {
      if (uploadBothOnStage(sceneA)) state.dirtyA = false;
    }
    if (state.dirtyB || !stageTextures.has(sceneB)) {
      if (uploadBothOnStage(sceneB)) state.dirtyB = false;
    }
    const tb = stageTextures.get(sceneB);
    if (!stageTextures.has(sceneA) || !tb) return;

    const [ax, ay] = AXIS_VECTORS[state.axis] || AXIS_VECTORS.horizontal;
    stage.quad(sceneA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tb.tex);
      gl.uniform1i(loc('uTexB'), 1);
      gl.uniform2f(loc('uCanvasSize'), cw, ch);
      gl.uniform1f(loc('uProgress'), wave.s.progress);
      gl.uniform1i(loc('uCount'), state.slats);
      gl.uniform1f(loc('uStagger'), state.stagger);
      gl.uniform2f(loc('uAxis'), ax, ay);
    });

    syncHitGeometry(forceGeo);
    state.paints++;
    updateStatus();
  } else if (state.backend === '2d') {
    draw2DFallback(cw, ch, forceGeo);
  }
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function tick(tMs) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain' || state.backend === 'none') return;
  const moving = wave.stepWave(tMs);
  syncUiFromProgress();
  renderStageFrame(!moving);
  if (moving) {
    rafId = requestAnimationFrame(tick);
  } else {
    syncHitGeometry(true);
    renderStageFrame(true);
  }
}

function scheduleLoop() {
  if (!state.onScreen || document.hidden || state.backend === 'plain' || state.backend === 'none') return;
  if (!rafId && wave.s.animating) {
    rafId = requestAnimationFrame(tick);
  }
}

function triggerFlip(toTarget) {
  if (state.backend === 'plain') {
    wave.snapTo(toTarget);
    syncUiFromProgress();
    return;
  }
  const started = wave.startFlip(toTarget, performance.now());
  syncUiFromProgress();
  if (started) {
    syncHitGeometry(true);
    scheduleLoop();
  } else {
    syncHitGeometry(true);
    renderStageFrame(true);
  }
}

// ---------------------------------------------------------------- Interactions inside scenes A and B
inputA.addEventListener('input', () => {
  state.dirtyA = true;
  canvas.requestPaint?.();
});

countBtnA.addEventListener('click', () => {
  state.countA++;
  syncScenesUI();
  state.dirtyA = true;
  canvas.requestPaint?.();
});

accentBtnA.addEventListener('click', () => {
  state.paperIdx = (state.paperIdx + 1) % PAPERS.length;
  syncScenesUI();
  state.dirtyA = true;
  canvas.requestPaint?.();
});

inputB.addEventListener('input', () => {
  state.dirtyB = true;
  canvas.requestPaint?.();
});

countBtnB.addEventListener('click', () => {
  state.countB++;
  syncScenesUI();
  state.dirtyB = true;
  canvas.requestPaint?.();
});

modeBtnB.addEventListener('click', () => {
  state.gridIdx = (state.gridIdx + 1) % GRIDS.length;
  syncScenesUI();
  state.dirtyB = true;
  canvas.requestPaint?.();
});

// ---------------------------------------------------------------- External controls
flipBtn.addEventListener('click', () => {
  const next = wave.s.progress >= 0.5 ? 0 : 1;
  triggerFlip(next);
});

for (const btn of axisBtns) {
  btn.addEventListener('click', () => {
    state.axis = btn.dataset.axis;
    syncUiFromProgress();
    renderStageFrame(true);
  });
}

scrubSlider.addEventListener('input', () => {
  if (state.backend === 'plain') {
    wave.snapTo(Number(scrubSlider.value) >= 50 ? 1 : 0);
    syncUiFromProgress();
    return;
  }
  stopLoop();
  wave.scrubTo(Number(scrubSlider.value) / 100);
  syncUiFromProgress();
  syncHitGeometry(true);
  renderStageFrame(true);
});

slatsSlider.addEventListener('input', () => {
  state.slats = clamp(Math.round(Number(slatsSlider.value)), MIN_SLAT_COUNT, MAX_SLAT_COUNT);
  syncUiFromProgress();
  renderStageFrame(false);
});

reducedCheck.addEventListener('change', () => {
  if (isReduced() && wave.s.animating) {
    wave.snapTo(wave.s.target);
    stopLoop();
    syncUiFromProgress();
    syncHitGeometry(true);
    renderStageFrame(true);
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  if (isReduced() && wave.s.animating) {
    wave.snapTo(wave.s.target);
    stopLoop();
    syncUiFromProgress();
    syncHitGeometry(true);
    renderStageFrame(true);
  }
});

// ---------------------------------------------------------------- Swipe drag across blinds
viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.backend === 'plain') return;
  if (e.target instanceof Element && e.target.closest('button, input, textarea, select, label, a')) return;
  window.getSelection?.()?.removeAllRanges?.();
  stopLoop();
  wave.s.animating = false;

  drag = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastDelta: 0,
    lastT: performance.now(),
    vel: 0,
    startProgress: wave.s.progress,
    locked: false,
    dir: 'x',
  };
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;

  if (!drag.locked) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.locked = true;
    if (state.axis === 'horizontal') {
      drag.dir = Math.abs(dy) >= Math.abs(dx) * 0.65 ? 'y' : 'x';
    } else if (state.axis === 'vertical') {
      drag.dir = Math.abs(dx) >= Math.abs(dy) * 0.65 ? 'x' : 'y';
    } else {
      drag.dir = 'diag';
    }
    try { canvas.setPointerCapture(drag.id); } catch {}
    canvas.classList.add('dragging');
    syncHitGeometry(true);
  }

  const delta = drag.dir === 'y'
    ? dy
    : drag.dir === 'x'
      ? dx
      : (dx + dy) * Math.SQRT1_2;
  const { cw, ch } = getViewportSize();
  const span = Math.max(150, drag.dir === 'y' ? ch * 0.65 : cw * 0.68);
  const now = performance.now();
  const dt = Math.max(0.004, (now - drag.lastT) / 1000);
  const instVel = ((delta - drag.lastDelta) / span) / dt;
  drag.vel = drag.vel * 0.45 + instVel * 0.55;
  drag.lastDelta = delta;
  drag.lastT = now;

  wave.scrubTo(drag.startProgress + delta / span);
  syncUiFromProgress();
  renderStageFrame(false);
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (!d.locked) return;

  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);

  let target = wave.s.progress >= 0.5 ? 1 : 0;
  if (d.vel > 0.65 && wave.s.progress > 0.14) target = 1;
  else if (d.vel < -0.65 && wave.s.progress < 0.86) target = 0;
  triggerFlip(target);
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

viewportEl.addEventListener('click', (e) => {
  if (suppressNextClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// ---------------------------------------------------------------- Startup & visibility
function startBackend() {
  syncScenesUI();
  syncUiFromProgress();

  if (!hicSupported || !('requestPaint' in HTMLCanvasElement.prototype)) {
    enterPlainFallback('HTML-in-canvas is not available in this browser, so the sheets are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', (e) => {
    state.hasPainted = true;
    const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
    if (!changed) {
      state.dirtyA = true;
      state.dirtyB = true;
    } else {
      if (changed.has(sceneA)) state.dirtyA = true;
      if (changed.has(sceneB)) state.dirtyB = true;
    }
    if (!rafId && state.onScreen && !document.hidden) {
      renderStageFrame(false);
    }
  });

  const forceRoute = new URLSearchParams(location.search).get('route');

  if (glSupported && forceRoute !== '2d') {
    try {
      stage = new ElementGL(canvas, {
        fragment: BLINDS_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          stageTextures.clear();
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              enterPlainFallback('The WebGL 2 context was lost. Showing the sheets as plain HTML until restored.');
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          stageTextures.clear();
          state.backend = 'webgl';
          state.hasPainted = false;
          exitPlainFallback();
          syncHitGeometry(true);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.backend = 'webgl';
      const { cw, ch } = getViewportSize();
      syncSceneSizes(cw, ch);
      canvas.requestPaint?.();
      updateStatus();
      return;
    } catch (err) {
      stage = null;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
    }
  }

  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2d';
    if (noticeEl.hidden) {
      showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() strip fallback.');
    }
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          enterPlainFallback('The 2D canvas context was lost. Showing the sheets as plain HTML.');
        }
      }, 900);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      state.backend = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      syncHitGeometry(true);
      canvas.requestPaint?.();
    });
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);
    canvas.requestPaint?.();
    updateStatus();
    return;
  }

  enterPlainFallback('Canvas rendering is unavailable here, so the sheets are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    const nowOn = Boolean(entry && entry.isIntersecting);
    if (nowOn === state.onScreen) return;
    state.onScreen = nowOn;
    if (!state.onScreen) {
      stopLoop();
    } else if (state.backend !== 'plain') {
      if (wave.s.animating) scheduleLoop();
      else renderStageFrame(false);
    }
  }, { threshold: 0.01 }).observe(stageBox);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.backend === 'plain') return;
    state.unitCache.aKey = '';
    state.unitCache.bKey = '';
    state.lastGeoKey = '';
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);
    state.dirtyA = true;
    state.dirtyB = true;
    if (state.hasPainted) renderStageFrame(true);
    else canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.hasPainted && state.backend !== 'plain') {
    if (wave.s.animating) scheduleLoop();
    else renderStageFrame(false);
  }
});

startBackend();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, detail) => { if (!ok) throw new Error(detail); return detail; };
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

function makeFixture(w = 240, h = 240, {
  bgA = '#ef4444',
  bgB = '#0ea5e9',
  splitB = false,
  interactive = false,
} = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const fxA = document.createElement('section');
  fxA.setAttribute('drawable', '');
  fxA.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;padding:12px;` +
    `background:${bgA};color:#ffffff;font:700 14px system-ui`;

  const fxB = document.createElement('section');
  fxB.setAttribute('drawable', '');
  fxB.inert = true;
  fxB.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;padding:12px;pointer-events:none;` +
    `background:${bgB};color:#ffffff;font:700 14px system-ui`;

  if (splitB) {
    // Asymmetric 6-strip pattern (top/left lime #22c55e, bottom/right rose #e11d48 inside each strip)
    fxB.style.padding = '0';
    fxB.innerHTML =
      `<div style="width:100%;height:100%;background:repeating-linear-gradient(180deg,#22c55e 0px,#22c55e 20px,#e11d48 20px,#e11d48 40px)"></div>`;
  }

  let btnA = null;
  let inputA = null;
  let btnB = null;
  let inputB = null;
  if (interactive) {
    btnA = document.createElement('button');
    btnA.type = 'button';
    btnA.textContent = 'Action A';
    btnA.style.cssText = 'position:absolute;left:18px;top:24px;width:120px;height:42px';
    inputA = document.createElement('input');
    inputA.type = 'text';
    inputA.value = 'Front A';
    inputA.setAttribute('inputmode', 'none');
    inputA.setAttribute('aria-label', 'Fixture input A');
    inputA.style.cssText = 'position:absolute;left:18px;top:84px;width:160px;height:38px;box-sizing:border-box';
    fxA.append(btnA, inputA);

    btnB = document.createElement('button');
    btnB.type = 'button';
    btnB.textContent = 'Action B';
    btnB.style.cssText = 'position:absolute;left:18px;top:140px;width:120px;height:42px';
    inputB = document.createElement('input');
    inputB.type = 'text';
    inputB.value = 'Reverse B';
    inputB.setAttribute('inputmode', 'none');
    inputB.setAttribute('aria-label', 'Fixture input B');
    inputB.style.cssText = 'position:absolute;left:18px;top:194px;width:160px;height:38px;box-sizing:border-box';
    fxB.append(btnB, inputB);
  }

  cv.append(fxA, fxB);
  return { cv, fxA, fxB, btnA, inputA, btnB, inputB };
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function drawBlindsFixture(g, fxA, texB, w, h, { progress, count = 6, stagger = DEFAULT_STAGGER, axis = 'horizontal' }) {
  const [ax, ay] = AXIS_VECTORS[axis] || AXIS_VECTORS.horizontal;
  g.begin([0, 0, 0, 0]);
  g.quad(fxA, ElementGL.rect(g.canvas, 0, 0, w, h), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB.tex);
    gl.uniform1i(loc('uTexB'), 1);
    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform1f(loc('uProgress'), progress);
    gl.uniform1i(loc('uCount'), count);
    gl.uniform1f(loc('uStagger'), stagger);
    gl.uniform2f(loc('uAxis'), ax, ay);
  });
  return g.gl.getError();
}

runTests(testsBody, [
  {
    name: 'ElementGL uploads both #sb-scene-a and #sb-scene-b via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload() for both sheets, renders a frame and verifies gl.getError() === 0.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 240;
      const { cv, fxA, fxB } = makeFixture(W, H, { bgA: '#f59e0b', bgB: '#0ea5e9' });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: BLINDS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const tA = g.upload(fxA);
        const tB = g.upload(fxB);
        const err = drawBlindsFixture(g, fxA, tB, W, H, { progress: 0, count: 6 });
        const pxA = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.5);
        return need(
          err === g.gl.NO_ERROR && tA?.w > 0 && tB?.w > 0 && pxA[0] > 200 && pxA[2] < 60,
          `glErr=${err}, texA=${tA?.w}x${tA?.h}, texB=${tB?.w}x${tB?.h}, center=[${Array.from(pxA)}].`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Staggered phase wave at 50% shows View B on leading slat, dark gap in middle, and View A on trailing slat',
    expect: 'pass',
    why: 'Steps createBlindsWave() with explicit tMs timestamps (1000..1950 ms) and reduced-motion snap, then renders 6 horizontal slats at progress=0.50 (stagger=0.55) and probes readPixels() across leading, middle and trailing slats.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      let reduced = false;
      const wCtrl = createBlindsWave({ durationMs: 950, stagger: 0.55, isReduced: () => reduced });
      wCtrl.startFlip(1, 1000);
      const midActive = wCtrl.stepWave(1475);
      const midProg = wCtrl.s.progress;
      const endActive = wCtrl.stepWave(1950);
      const endProg = wCtrl.s.progress;
      reduced = true;
      const snappedActive = wCtrl.startFlip(0, 2000);
      const waveTimingOk = midActive && Math.abs(midProg - 0.5) < 0.01 && !endActive && endProg === 1 && !snappedActive && wCtrl.s.progress === 0;

      const W = 240;
      const H = 240;
      const { cv, fxA, fxB } = makeFixture(W, H, { bgA: '#ef4444', bgB: '#0ea5e9' });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: BLINDS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(fxA);
        const tB = g.upload(fxB);

        const err = drawBlindsFixture(g, fxA, tB, W, H, { progress: 0.5, count: 6, stagger: 0.55, axis: 'horizontal' });
        // Slat 0 (y=20) is at 180 deg -> View B (#0ea5e9: B > R); slat 5 (y=220) is at 0 deg -> View A (#ef4444: R > B)
        const leadPx = readCssPixel(g.gl, cv, W, H, W * 0.5, 20);
        const trailPx = readCssPixel(g.gl, cv, W, H, W * 0.5, 220);
        // Between middle slats (y=120) sits the open dark louver gap
        const gapPx = readCssPixel(g.gl, cv, W, H, W * 0.5, 120);
        const gapLum = 0.299 * gapPx[0] + 0.587 * gapPx[1] + 0.114 * gapPx[2];

        const leadIsB = leadPx[2] > leadPx[0] + 100;
        const trailIsA = trailPx[0] > trailPx[2] + 100;
        const gapIsDark = gapLum < 65;

        return need(
          err === g.gl.NO_ERROR && waveTimingOk && leadIsB && trailIsA && gapIsDark,
          `tMs(mid=${midProg.toFixed(2)}, end=${endProg}), leadB=[${leadPx.slice(0, 3)}], gapLum=${gapLum.toFixed(0)}, trailA=[${trailPx.slice(0, 3)}].`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Cosine diffuse shading darkens turning slats while keeping View B unmirrored across 90°',
    expect: 'pass',
    why: 'Compares flat 180° slat luminance against 118° turning luminance (stagger=0) and tests asymmetric lime-over-rose View B across horizontal (140° & 180°) and vertical (140° & 180°) axes via readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 240;
      const { cv, fxA, fxB } = makeFixture(W, H, { bgA: '#f59e0b', bgB: '#ffffff', splitB: true });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      try {
        g = new ElementGL(cv, { fragment: BLINDS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(fxA);
        const tB = g.upload(fxB);

        // Part A: Horizontal slats at progress=1.0 (180 deg) vs progress=0.61 (121 deg, back face visible & shaded)
        drawBlindsFixture(g, fxA, tB, W, H, { progress: 1.0, count: 6, stagger: 0, axis: 'horizontal' });
        const flatTop = readCssPixel(g.gl, cv, W, H, W * 0.5, 50); // slat 1 top half: lime #22c55e (G > R)
        const flatBot = readCssPixel(g.gl, cv, W, H, W * 0.5, 70); // slat 1 bot half: rose #e11d48 (R > G)

        drawBlindsFixture(g, fxA, tB, W, H, { progress: 0.61, count: 6, stagger: 0, axis: 'horizontal' });
        const turnTop = readCssPixel(g.gl, cv, W, H, W * 0.5, 55); // foreshortened upper half of slat 1
        const turnBot = readCssPixel(g.gl, cv, W, H, W * 0.5, 65); // foreshortened lower half of slat 1

        // Part B: Vertical slats with left-lime / right-rose pattern
        fxB.innerHTML = `<div style="width:100%;height:100%;background:repeating-linear-gradient(90deg,#22c55e 0px,#22c55e 20px,#e11d48 20px,#e11d48 40px)"></div>`;
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(fxB);
        drawBlindsFixture(g, fxA, tB, W, H, { progress: 0.72, count: 6, stagger: 0, axis: 'vertical' });
        const vTurnLeft = readCssPixel(g.gl, cv, W, H, 52, H * 0.5); // left half of slat 1 (lime)
        const vTurnRight = readCssPixel(g.gl, cv, W, H, 68, H * 0.5); // right half of slat 1 (rose)
        const err = g.gl.getError();

        const shadedOk = lum(turnTop) < lum(flatTop) - 25 && lum(turnBot) < lum(flatBot) - 20;
        const horizUnmirrored = flatTop[1] > flatTop[0] + 50 && flatBot[0] > flatBot[1] + 50
          && turnTop[1] > turnTop[0] + 20 && turnBot[0] > turnBot[1] + 20;
        const vertUnmirrored = vTurnLeft[1] > vTurnLeft[0] + 25 && vTurnRight[0] > vTurnRight[1] + 25;

        return need(
          err === g.gl.NO_ERROR && shadedOk && horizUnmirrored && vertUnmirrored,
          `glErr=${err}, lumFlat=${lum(flatTop).toFixed(0)}->turn=${lum(turnTop).toFixed(0)}, H(topG=${turnTop[1]},botR=${turnBot[0]}), V(leftG=${vTurnLeft[1]},rightR=${vTurnRight[0]}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'updateElementGeometry() + geometryUnit() routes clicks and input hits cleanly at 0% and 100%',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled updateElementGeometry(), inert and dataset.hitTick on an interactive two-sheet fixture at 0% (Scene A active) and 100% (Scene B active), verifying elementsFromPoint() and real clicks.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 240;
      const H = 260;
      const { cv, fxA, fxB, btnA, inputA, btnB, inputB } = makeFixture(W, H, {
        bgA: '#f7f3ea',
        bgB: '#0c1322',
        interactive: true,
      });
      let clicksA = 0;
      let clicksB = 0;
      btnA.addEventListener('click', () => { clicksA++; });
      btnB.addEventListener('click', () => { clicksB++; });
      testStage().append(cv);

      let g = null;
      let ctx = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        let tB = null;
        if (glSupported) {
          g = new ElementGL(cv, { fragment: BLINDS_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        } else {
          ctx = cv.getContext('2d');
        }
        await nextPaint(cv);

        const applyEndpoint = (showB) => {
          fxA.inert = showB;
          fxB.inert = !showB;
          fxA.style.pointerEvents = showB ? 'none' : 'auto';
          fxB.style.pointerEvents = showB ? 'auto' : 'none';
          if (g) {
            g.begin([0, 0, 0, 0]);
            g.upload(fxA);
            tB = g.upload(fxB);
            drawBlindsFixture(g, fxA, tB, W, H, { progress: showB ? 1 : 0, count: 6 });
            const uA = geometryUnit(cv, fxA, W);
            const uB = geometryUnit(cv, fxB, W);
            cv.updateElementGeometry(fxA, { canvasTransform: showB ? OFFSTAGE : new DOMMatrix().scale(uA, uA, 1) });
            cv.updateElementGeometry(fxB, { canvasTransform: showB ? new DOMMatrix().scale(uB, uB, 1) : OFFSTAGE });
            fxA.dataset.hitTick = fxA.dataset.hitTick === '1' ? '0' : '1';
            fxB.dataset.hitTick = fxB.dataset.hitTick === '1' ? '0' : '1';
          } else if (ctx) {
            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            cv.width = Math.round(W * dpr);
            cv.height = Math.round(H * dpr);
            ctx.reset();
            ctx.scale(dpr, dpr);
            ctx.drawElementImage(showB ? fxB : fxA, 0, 0, W, H);
          }
        };

        const hitsCenter = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };

        // At 0%: Scene A interactive
        applyEndpoint(false);
        await raf2();
        const aBtnHits = hitsCenter(btnA);
        const aInpHits = hitsCenter(inputA);
        btnA.click();

        // At 100%: Scene B interactive
        applyEndpoint(true);
        await raf2();
        const bBtnHits = hitsCenter(btnB);
        const bInpHits = hitsCenter(inputB);
        btnB.click();

        const ok0 = aBtnHits.includes(btnA) && aInpHits.includes(inputA) && !aBtnHits.includes(btnB) && clicksA === 1;
        const ok1 = bBtnHits.includes(btnB) && bInpHits.includes(inputB) && !bBtnHits.includes(btnA) && clicksB === 1;
        return need(
          ok0 && ok1,
          `0%(btnA=${aBtnHits.includes(btnA)}, inputA=${aInpHits.includes(inputA)}, clicks=${clicksA}), 100%(btnB=${bBtnHits.includes(btnB)}, inputB=${bInpHits.includes(inputB)}, clicks=${clicksB}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored recovery and 5-arg 2D drawElementImage() strip fallback work',
    expect: 'pass',
    why: 'Dispatches synthetic webglcontextlost and webglcontextrestored on an ElementGL fixture to confirm plain-HTML state preservation and WebGL restore, then renders a 5-argument 2D strip-scaled slat pass.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220;
      const H = 200;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, fxA, fxB, btnA, inputA } = makeFixture(W, H, {
        bgA: '#f7f3ea',
        bgB: '#0c1322',
        interactive: true,
      });
      inputA.value = 'BLINDS SAVED 99';
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, {
          fragment: BLINDS_FRAG,
          attributes: { preserveDrawingBuffer: true },
          onLost: () => {
            lostOk = true;
            fxA.inert = false;
            plain.hidden = false;
            plain.append(fxA, fxB);
          },
          onRestored: () => {
            restoredOk = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            cv.append(fxA, fxB);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(fxA);
        g.upload(fxB);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(fxA) && inputA.value === 'BLINDS SAVED 99';
        const r = btnA.getBoundingClientRect();
        const plainHits = document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const tAfterA = g.upload(fxA);
        const tAfterB = g.upload(fxB);
        const err = g.gl.getError();

        // Part B: 5-argument 2D drawElementImage() strip-scale fallback
        const cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = `width:${W}px;height:${H}px;display:block`;
        const boxA = document.createElement('div');
        boxA.setAttribute('drawable', '');
        boxA.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#f59e0b`;
        const boxB = document.createElement('div');
        boxB.setAttribute('drawable', '');
        boxB.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#0ea5e9`;
        cv2d.append(boxA, boxB);
        testStage().append(cv2d);
        try {
          const ctx = cv2d.getContext('2d');
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2d.width = Math.round(W * dpr);
          cv2d.height = Math.round(H * dpr);
          await nextPaint(cv2d);
          const beforeWrong = window.__gfx?.draws?.wrong ?? 0;
          ctx.reset();
          ctx.scale(dpr, dpr);
          ctx.fillStyle = '#080b12';
          ctx.fillRect(0, 0, W, H);
          const pitch = H / 4;
          for (let i = 0; i < 4; i++) {
            const absCos = i === 0 ? 0.8 : i === 3 ? 0.8 : 0.45;
            const cy = (i + 0.5) * pitch;
            const stripH = pitch * absCos;
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, cy - stripH * 0.5, W, stripH);
            ctx.clip();
            ctx.drawElementImage(i < 2 ? boxB : boxA, 0, cy * (1 - absCos), W, H * absCos);
            ctx.restore();
          }
          const copy = document.createElement('canvas');
          copy.width = 110;
          copy.height = 100;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0, 110, 100);
          const f2d = inkFraction(cc);
          const wrongAfter = window.__gfx?.draws?.wrong ?? 0;

          return need(
            inPlain && plainHits.includes(btnA) && restoredOk && !g.lost && tAfterA?.w > 0 && tAfterB?.w > 0 && err === g.gl.NO_ERROR && f2d > 0.5 && wrongAfter === beforeWrong,
            `plainDuringLoss=${inPlain}, plainHit=${plainHits.includes(btnA)}, restored=${restoredOk}, texAfter=${tAfterA?.w}x${tAfterA?.h}, glErr=${err}, 2dInk=${(f2d * 100).toFixed(0)}%, wrongDraws=${wrongAfter}.`
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
      name: 'shutter-blinds stage',
      note: 'plain HTML',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (!state.hasPainted || !canvas.width || !canvas.height) return 0;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost) return 0;
          renderStageFrame(true);
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => enterPlainFallback('The shutter-blinds canvas came back blank, so the sheets moved to plain HTML.'),
    },
  ]),
]);
