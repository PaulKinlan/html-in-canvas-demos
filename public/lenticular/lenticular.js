import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);

const canvas = $('lenticular-canvas');
const plainHost = $('plain-host');
const hudEl = $('stage-hud');
const routeNoteEl = $('route-note');
const checksBody = $('checks-body');

const cardA = $('card-a');
const cardB = $('card-b');
const cardC = $('card-c');
const CARDS = [cardA, cardB, cardC];
const LAYER_NAMES = ['Layer A (Day)', 'Layer B (Night)', 'Layer C (Alt)'];

// Toolbar controls outside <canvas>.
const modeBtns = Array.from(document.querySelectorAll('button[data-mode]'));
const angleBtns = Array.from(document.querySelectorAll('button[data-angle]'));
const angleLabel = $('angle-label');
const angleSlider = $('angle-slider');
const angleOut = $('angle-out');
const pitchSlider = $('pitch-slider');
const pitchOut = $('pitch-out');
const tiltBtn = $('tilt-btn');
const sweepBtn = $('sweep-btn');
const loupeBtn = $('loupe-btn');

// Optical weight meter elements.
const meterCells = [$('meter-a'), $('meter-b'), $('meter-c')];
const meterPcts = [$('pct-a'), $('pct-b'), $('pct-c')];
const meterFills = [$('fill-a'), $('fill-b'), $('fill-c')];

// Interactive controls inside the three live drawable cards.
const aPill = $('a-pill');
const aNote = $('a-note');
const aCountBtn = $('a-count-btn');
const aStatusBtn = $('a-status-btn');
const aCountEl = $('a-count');

const bGain = $('b-gain');
const bGainOut = $('b-gain-out');
const bMeterFill = $('b-meter-fill');
const bGridSw = $('b-grid-sw');
const bContrastSw = $('b-contrast-sw');
const bAccentBtns = Array.from(cardB.querySelectorAll('.b-accent-btn'));
const bAccentReadout = $('b-accent-readout');

const cKickerText = $('c-kicker-text');
const cLangCode = $('c-lang-code');
const cTitle = $('c-title');
const cSub = $('c-sub');
const cLangBtn = $('c-lang-btn');
const cTagLabel = $('c-tag-label');
const cTag = $('c-tag');
const cTagPreview = $('c-tag-preview');
const cFootLeft = $('c-foot-left');
const cFootRight = $('c-foot-right');
const cChipBtns = Array.from(cardC.querySelectorAll('.c-chip'));

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

// #region optical-shader
const LENTICULAR_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uTexB;
uniform sampler2D uTexC;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec4 uCardRect;
uniform float uAngleDeg;
uniform float uScaleX;
uniform float uPitchPx;
uniform float uBarrierPx;
uniform float uDpr;
uniform int uMode;
uniform int uLoupeOn;
uniform vec2 uLoupePos;
uniform float uLoupeRadius;
uniform float uLoupeZoom;
uniform float uDarkTheme;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec3 lenticularWeights(float p) {
  float pc = clamp(p, 0.0, 2.0);
  if (pc <= 1.0) {
    float t = smoothstep(0.12, 0.88, pc);
    return vec3(1.0 - t, t, 0.0);
  }
  float t = smoothstep(0.12, 0.88, pc - 1.0);
  return vec3(0.0, 1.0 - t, t);
}

float stripMask(float u, float centre, float halfW, float aa) {
  float d = abs(fract(u - centre + 0.5) - 0.5);
  return 1.0 - smoothstep(halfW - aa, halfW + aa, d);
}

vec3 sampleChannel(vec2 cardUv, float pitch, float phase, float trans, float s, float dispSign, float inLoupe) {
  float refrPx = s * pitch * (0.08 + 0.06 * trans) + dispSign * 0.24 * (0.35 + 0.65 * abs(s));
  vec2 uv = clamp(vec2(cardUv.x + refrPx / max(uCardRect.z, 1.0), cardUv.y), vec2(0.001), vec2(0.999));
  float edgeSweep = s * ((inLoupe > 0.5 ? 0.11 : 0.04) + 0.36 * trans);
  float dispPhase = dispSign * (0.025 + 0.055 * trans) * (0.35 + 0.65 * abs(s));
  vec3 w = lenticularWeights(phase + edgeSweep + dispPhase);
  vec3 ca = texture(uTex, uv).rgb;
  vec3 cb = texture(uTexB, uv).rgb;
  vec3 cc = texture(uTexC, uv).rgb;
  return w.x * ca + w.y * cb + w.z * cc;
}

vec3 evalWorkbench(vec2 cssPx) {
  vec3 baseLight = mix(vec3(0.93, 0.91, 0.87), vec3(0.88, 0.86, 0.81), clamp(cssPx.y / max(uCanvasSize.y, 1.0), 0.0, 1.0));
  vec3 baseDark = mix(vec3(0.11, 0.105, 0.10), vec3(0.08, 0.078, 0.075), clamp(cssPx.y / max(uCanvasSize.y, 1.0), 0.0, 1.0));
  vec3 bg = mix(baseLight, baseDark, uDarkTheme);

  // Subtle cutting-mat dot grid.
  vec2 grid = abs(fract(cssPx / 20.0 + 0.5) - 0.5) * 20.0;
  float dotMask = 1.0 - smoothstep(0.7, 1.4, length(grid));
  vec3 dotCol = mix(vec3(0.75, 0.72, 0.67), vec3(0.24, 0.23, 0.21), uDarkTheme);
  return mix(bg, dotCol, dotMask * 0.45);
}

vec3 evalScene(vec2 cssPx, float zoomScale, float inLoupe) {
  vec3 bg = evalWorkbench(cssPx);
  vec2 cardOrigin = uCardRect.xy;
  vec2 cardSize = max(uCardRect.zw, vec2(1.0));
  vec2 cardCentre = cardOrigin + cardSize * 0.5;
  float halfW = cardSize.x * 0.5 * uScaleX;
  float halfH = cardSize.y * 0.5;

  float theta = radians(uAngleDeg);
  float tiltShift = (uMode == 0) ? sin(theta) * 9.0 : 0.0;

  // Soft cast shadow under the acrylic plate or print.
  vec2 shadowP = cssPx - (cardCentre + vec2(-tiltShift * 0.85, 7.0));
  float dShadow = sdRoundBox(shadowP, vec2(halfW + 1.0, halfH + 1.0), 12.0);
  float shadowAlpha = (1.0 - smoothstep(-2.0, 22.0, dShadow)) * mix(0.22, 0.46, uDarkTheme);
  vec3 col = mix(bg, vec3(0.03, 0.03, 0.04), shadowAlpha);

  // Acrylic side-edge thickness wall in lenticular mode when tilted.
  if (uMode == 0 && abs(tiltShift) > 0.35) {
    vec2 bevelCentre = cardCentre + vec2(tiltShift * 0.42, 1.5);
    float dBevel = sdRoundBox(cssPx - bevelCentre, vec2(halfW + abs(tiltShift) * 0.45, halfH + 1.0), 11.0);
    if (dBevel < 0.0) {
      float edgeGrad = clamp((cssPx.y - cardOrigin.y) / cardSize.y, 0.0, 1.0);
      vec3 acrylicEdge = mix(vec3(0.84, 0.89, 0.92), vec3(0.58, 0.66, 0.72), edgeGrad);
      acrylicEdge = mix(acrylicEdge, acrylicEdge * 0.65, uDarkTheme);
      col = mix(col, acrylicEdge, smoothstep(1.0, -0.5, dBevel));
    }
  }

  // Sliding acetate overhang frame in Scanimation mode.
  float pitch = max(uPitchPx, 3.0);
  float acetateShift = (uMode == 1) ? (uBarrierPx - pitch * 0.333333) : 0.0;
  float aa = clamp(0.75 / max(pitch * max(uDpr, 1.0) * zoomScale, 1.0), 0.002, 0.12);

  if (uMode == 1) {
    vec2 aceCentre = cardCentre + vec2(acetateShift * 1.4, 0.0);
    float dAce = sdRoundBox(cssPx - aceCentre, vec2(halfW + 12.0, halfH + 10.0), 13.0);
    if (dAce < 0.0) {
      float rim = 1.0 - smoothstep(0.0, 2.2, -dAce);
      float barU = fract((cssPx.x - cardOrigin.x - uBarrierPx) / pitch);
      float slit = stripMask(barU, 1.0 / 6.0, 1.0 / 6.0, aa);
      vec3 aceTint = mix(vec3(0.07, 0.075, 0.085), col + vec3(0.03), slit * 0.72);
      col = mix(col, aceTint, 0.55);
      col = mix(col, mix(vec3(0.25, 0.24, 0.22), vec3(0.62, 0.60, 0.56), uDarkTheme), rim * 0.75);
    }
  }

  // Exact inverse of the DOMMatrix used for updateElementGeometry().
  float localX = (cssPx.x - cardCentre.x) / max(uScaleX, 0.5) + cardSize.x * 0.5;
  float localY = cssPx.y - cardOrigin.y;
  float dCard = sdRoundBox(cssPx - cardCentre, vec2(halfW, halfH), 10.0);

  if (dCard < 1.0) {
    vec2 cardUv = clamp(vec2(localX / cardSize.x, localY / cardSize.y), vec2(0.0), vec2(1.0));
    vec3 sheetCol;

    if (uMode == 0) {
      // Cylindrical micro-prism lenticular sheet.
      float phase = clamp((uAngleDeg + 25.0) / 25.0, 0.0, 2.0);
      float trans = sin(fract(phase) * 3.14159265);
      float cellFrac = fract(localX / pitch);
      float s = cellFrac * 2.0 - 1.0;

      float nx = s * 0.78;
      float nz = sqrt(max(0.06, 1.0 - nx * nx));
      vec3 N = normalize(vec3(nx, 0.0, nz));
      vec3 V = normalize(vec3(sin(theta), 0.08, cos(theta)));

      // Separate RGB channel refraction for subtle rainbow micro-dispersion.
      float r = sampleChannel(cardUv, pitch, phase, trans, s, -1.0, inLoupe).r;
      float g = sampleChannel(cardUv, pitch, phase, trans, s,  0.0, inLoupe).g;
      float b = sampleChannel(cardUv, pitch, phase, trans, s,  1.0, inLoupe).b;
      vec3 refracted = vec3(r, g, b);

      // Fresnel specular ridges along every vertical acrylic lenticule.
      vec3 L1 = normalize(vec3(0.42, 0.45, 0.78));
      vec3 L2 = normalize(vec3(-0.52, 0.28, 0.80));
      vec3 H1 = normalize(L1 + V);
      vec3 H2 = normalize(L2 + V);
      float spec1 = pow(max(dot(N, H1), 0.0), 48.0);
      float spec2 = pow(max(dot(N, H2), 0.0), 30.0);
      float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      float groove = 1.0 - 0.16 * smoothstep(0.76, 1.0, abs(s));

      vec3 rainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + s * 3.8 + theta * 7.0);
      vec3 glare = vec3(1.0, 0.985, 0.96) * (spec1 * 0.19 + spec2 * 0.10)
                 + mix(vec3(1.0), rainbow, 0.45) * fresnel * 0.12;
      sheetCol = refracted * groove + glare;
    } else {
      // Scanimation: interlaced 3-card vertical strips under a sliding 1/3-slit black acetate grid.
      float stripU = fract(localX / pitch);
      float ia = stripMask(stripU, 1.0 / 6.0, 1.0 / 6.0, aa);
      float ib = stripMask(stripU, 3.0 / 6.0, 1.0 / 6.0, aa);
      float ic = stripMask(stripU, 5.0 / 6.0, 1.0 / 6.0, aa);
      float invSum = 1.0 / max(ia + ib + ic, 1e-4);

      vec3 ca = texture(uTex, cardUv).rgb;
      vec3 cb = texture(uTexB, cardUv).rgb;
      vec3 cc = texture(uTexC, cardUv).rgb;
      vec3 interlaced = (ia * ca + ib * cb + ic * cc) * invSum;

      float barU = fract((localX - uBarrierPx) / pitch);
      float slit = stripMask(barU, 1.0 / 6.0, 1.0 / 6.0, aa);

      float sheenBand = 1.0 - abs((cardUv.x - 0.35) * 1.4 + (cardUv.y - 0.25) * 0.9 - sin(theta) * 0.35);
      float aceSheen = 0.05 * pow(max(0.0, sheenBand), 4.0);
      vec3 barCol = vec3(0.055, 0.058, 0.068) + vec3(0.95, 0.97, 1.0) * aceSheen * 1.3;
      vec3 slitCol = min(vec3(1.0), interlaced * 1.08) + vec3(1.0) * aceSheen * 0.5;
      sheetCol = mix(barCol, slitCol, slit);
    }

    float cardMask = 1.0 - smoothstep(-0.75, 0.75, dCard);
    col = mix(col, sheetCol, cardMask);
  }

  return col;
}

void main() {
  vec2 cssPx = vUv * uCanvasSize;
  vec3 col = evalScene(cssPx, 1.0, 0.0);

  if (uLoupeOn == 1) {
    vec2 rel = cssPx - uLoupePos;
    float d = length(rel);
    float r = max(uLoupeRadius, 24.0);
    if (d < r + 10.0) {
      // Soft drop shadow around the loupe housing.
      float ringShadow = (1.0 - smoothstep(r + 2.0, r + 10.0, d)) * 0.34;
      col = mix(col, vec3(0.02, 0.02, 0.03), ringShadow * step(r, d));
    }
    if (d < r + 3.5) {
      float bezel = smoothstep(r - 0.8, r + 0.4, d) * (1.0 - smoothstep(r + 2.6, r + 3.5, d));
      vec3 bezelCol = mix(vec3(0.16, 0.16, 0.18), vec3(0.84, 0.82, 0.78), 0.5 + 0.5 * normalize(rel + vec2(1e-4)).y);
      col = mix(col, bezelCol, bezel);
    }
    if (d < r) {
      float rNorm = d / r;
      float mag = max(uLoupeZoom, 1.0) * (1.0 - 0.07 * rNorm * rNorm);
      vec2 magPx = uLoupePos + rel / mag;
      vec3 zoomed = evalScene(magPx, mag, 1.0);
      // Subtle glass rim reflection inside the loupe.
      float rimGlint = pow(rNorm, 5.0) * 0.22;
      zoomed += vec3(0.95, 0.98, 1.0) * rimGlint;
      float innerMask = 1.0 - smoothstep(r - 1.2, r, d);
      col = mix(col, zoomed, innerMask);
    }
  }

  outColor = vec4(col, 1.0);
}`;
// #endregion optical-shader

// ---------------- Shared Optical & Authority Math ----------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// #region authority-handoff
export function computeOpticalState(angleDeg, mode, pitchPx) {
  const clamped = clamp(angleDeg, -30, 30);
  const pitch = Math.max(3, pitchPx);
  let weights;
  let barrierPx = 0;
  let scaleX = 1;
  let phase;

  if (mode === 'scanimation') {
    barrierPx = ((clamped + 25) / 75) * pitch;
    const t = (((barrierPx / pitch) % 1) + 1) % 1;
    weights = [0, 1, 2].map((k) => {
      const dist = Math.abs((((t - k / 3) + 0.5) % 1 + 1) % 1 - 0.5);
      return Math.max(0, 1 - 3 * dist);
    });
    phase = t * 3;
    scaleX = 1;
  } else {
    phase = clamp((clamped + 25) / 25, 0, 2);
    if (phase <= 1) {
      const t = smoothstep(0.12, 0.88, phase);
      weights = [1 - t, t, 0];
    } else {
      const t = smoothstep(0.12, 0.88, phase - 1);
      weights = [0, 1 - t, t];
    }
    scaleX = Math.cos((clamped * Math.PI / 180) * 0.55);
  }

  let dominant = -1;
  let maxW = 0;
  for (let i = 0; i < 3; i++) {
    if (weights[i] > maxW) {
      maxW = weights[i];
      dominant = i;
    }
  }
  if (maxW <= 0.5001) dominant = -1;

  return { angleDeg: clamped, weights, maxWeight: maxW, dominant, barrierPx, scaleX, phase };
}

function cardTransformMatrix(rect, scaleX) {
  return new DOMMatrix()
    .translate(rect.x + rect.w * 0.5, rect.y)
    .scale(scaleX, 1)
    .translate(-rect.w * 0.5, 0);
}

function applyAuthority(targetCanvas, cards, rect, optical, unit, geoCache = null) {
  const canGeo = 'updateElementGeometry' in HTMLCanvasElement.prototype;
  const activeMat = canGeo ? new DOMMatrix().scale(unit, unit, 1).multiply(cardTransformMatrix(rect, optical.scaleX)) : null;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const isActive = i === optical.dominant;
    card.inert = !isActive;
    if (!canGeo) continue;
    const mat = isActive ? activeMat : OFFSTAGE;
    const vals = mat.toFloat32Array();
    if (geoCache && geoCache[i] && vals.every((v, idx) => Math.abs(v - geoCache[i][idx]) < 1e-4)) {
      continue;
    }
    if (geoCache) geoCache[i] = vals;
    targetCanvas.updateElementGeometry(card, { canvasTransform: mat });
    card.dataset.hitTick = card.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion authority-handoff

// ---------------- State ----------------

const state = {
  mode: 'lenticular', // 'lenticular' | 'scanimation'
  angleDeg: -25,
  pitchPx: 9,
  loupeOn: false,
  loupePos: null,
  loupeRadius: 72,
  loupeZoom: 4.5,
  sweepOn: false,
  sweepPhase: 0,
  sweepLastStep: 0,
  backend: 'init', // 'webgl' | '2d' | 'plain'
  onScreen: true,
  rect: { x: 28, y: 24, w: 520, h: 356 },
  dragging: null, // null | 'sheet' | 'loupe'
  dragId: null,
  dragLastX: 0,
  unitCache: { key: '', unit: 1 },
  geoCache: [null, null, null],
  stats: { paints: 0, uploads: 0, glErrors: 0 },
};

const tiltState = {
  active: false,
  permissionRequested: false,
  zeroGamma: null,
  gotReading: false,
  timeoutId: 0,
};

let stage = null;
let textures = [null, null, null];
let ctx2d = null;
let rafId = 0;
let lastFrameTime = 0;

// ---------------- Layout & Geometry Helpers ----------------

function layoutCards() {
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const padX = cw < 480 ? 12 : 28;
  const padY = cw < 480 ? 14 : 24;
  const cardW = Math.min(Math.max(240, Math.floor(cw - padX * 2)), 600);
  const cardH = Math.min(Math.max(280, Math.floor(ch - padY * 2)), 360);
  const cardX = Math.round((cw - cardW) * 0.5);
  const cardY = Math.round((ch - cardH) * 0.5);

  const sizeChanged = state.rect.w !== cardW || state.rect.h !== cardH;
  state.rect = { x: cardX, y: cardY, w: cardW, h: cardH };

  const compact = cardW < 420;
  for (const card of CARDS) {
    if (card.style.width !== `${cardW}px`) card.style.width = `${cardW}px`;
    if (card.style.height !== `${cardH}px`) card.style.height = `${cardH}px`;
    card.classList.toggle('compact', compact);
  }

  state.loupeRadius = cw < 480 ? 58 : 74;
  if (!state.loupePos) {
    state.loupePos = { x: cardX + cardW * 0.5, y: cardY + cardH * 0.5 };
  } else {
    state.loupePos.x = clamp(state.loupePos.x, 12, cw - 12);
    state.loupePos.y = clamp(state.loupePos.y, 12, ch - 12);
  }

  if (sizeChanged) {
    state.unitCache.key = '';
    state.geoCache = [null, null, null];
  }
  return { cw, ch, sizeChanged };
}

function getGeometryUnit() {
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${state.rect.w}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, cardA, state.rect.w);
    state.unitCache.key = key;
    state.geoCache = [null, null, null];
  }
  return state.unitCache.unit;
}

function updateMetersAndHUD(optical) {
  for (let i = 0; i < 3; i++) {
    const pct = Math.round(optical.weights[i] * 100);
    meterPcts[i].textContent = `${pct}%`;
    meterFills[i].style.width = `${pct}%`;
    meterCells[i].dataset.active = String(i === optical.dominant);
  }

  const lpi = Math.round(96 / state.pitchPx);
  pitchOut.textContent = `${state.pitchPx} px (${lpi} LPI)`;
  if (state.mode === 'scanimation') {
    angleLabel.textContent = 'Slide';
    angleOut.textContent = `${optical.barrierPx.toFixed(1)} px`;
  } else {
    angleLabel.textContent = 'Angle';
    angleOut.textContent = `${optical.angleDeg >= 0 ? '+' : ''}${optical.angleDeg.toFixed(1)}°`;
  }

  for (const btn of angleBtns) {
    const target = Number(btn.dataset.angle);
    btn.setAttribute('aria-pressed', String(Math.abs(optical.angleDeg - target) < 0.75));
  }

  const activeText = optical.dominant >= 0
    ? `${LAYER_NAMES[optical.dominant]} (${Math.round(optical.maxWeight * 100)}%)`
    : 'transition deadband (all inert)';
  const modeText = state.mode === 'scanimation'
    ? `Scanimation · shift ${optical.barrierPx.toFixed(1)}/${state.pitchPx} px`
    : `Lenticular · ${optical.angleDeg >= 0 ? '+' : ''}${optical.angleDeg.toFixed(1)}° · ${lpi} LPI`;
  const loupeHint = state.loupeOn ? ' · loupe 4.5x (drag ring)' : '';
  hudEl.textContent = `${modeText} · active: ${activeText}${loupeHint}`;
}

function syncAuthorityUI(optical) {
  updateMetersAndHUD(optical);
  if (state.backend === 'plain') {
    for (const card of CARDS) card.inert = false;
    return;
  }
  const unit = getGeometryUnit();
  applyAuthority(canvas, CARDS, state.rect, optical, unit, state.geoCache);
}

// ---------------- WebGL 2, 2D Fallback & Plain HTML Rescue ----------------

function fallbackToPlainHTML(reason) {
  state.backend = 'plain';
  state.sweepOn = false;
  sweepBtn.setAttribute('aria-pressed', 'false');
  canvas.hidden = true;
  for (const card of CARDS) {
    card.inert = false;
    if (card.parentElement !== plainHost) plainHost.append(card);
  }
  hudEl.textContent = `Plain HTML fallback (${reason})`;
  routeNoteEl.textContent = `Shown as plain HTML (${reason}). All three live cards stay editable below.`;
}

// #region gl-upload
function uploadCards(changedList = null) {
  if (!stage || stage.lost) return false;
  const gl = stage.gl;
  gl.activeTexture(gl.TEXTURE0);
  const allReady = textures[0] && textures[1] && textures[2];
  let targets = [0, 1, 2];
  if (allReady && changedList && changedList.length) {
    const dirty = CARDS.map((card, i) => (
      changedList.some((el) => el === card || card.contains(el)) ? i : -1
    )).filter((i) => i >= 0);
    if (dirty.length) targets = dirty;
  }

  for (const i of targets) {
    try {
      textures[i] = stage.upload(CARDS[i]);
      state.stats.uploads++;
    } catch {
      return false;
    }
  }
  return Boolean(textures[0] && textures[1] && textures[2]);
}

function renderWebGL() {
  if (!stage || stage.lost || state.backend !== 'webgl') return;
  if (!textures[0] || !textures[1] || !textures[2]) return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const dark = darkQuery?.matches ? 1 : 0;
  const clearCol = dark ? [0.09, 0.085, 0.08, 1] : [0.92, 0.90, 0.86, 1];
  if (!stage.begin(clearCol)) return;

  const optical = computeOpticalState(state.angleDeg, state.mode, state.pitchPx);
  syncAuthorityUI(optical);

  const dpr = canvas.width / Math.max(cw, 1);
  const fullMat = ElementGL.rect(canvas, 0, 0, cw, ch);
  stage.quad(cardA, fullMat, (gl, uniform) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[1].tex);
    gl.uniform1i(uniform('uTexB'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures[2].tex);
    gl.uniform1i(uniform('uTexC'), 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(uniform('uCanvasSize'), cw, ch);
    gl.uniform4f(uniform('uCardRect'), state.rect.x, state.rect.y, state.rect.w, state.rect.h);
    gl.uniform1f(uniform('uAngleDeg'), optical.angleDeg);
    gl.uniform1f(uniform('uScaleX'), optical.scaleX);
    gl.uniform1f(uniform('uPitchPx'), state.pitchPx);
    gl.uniform1f(uniform('uBarrierPx'), optical.barrierPx);
    gl.uniform1f(uniform('uDpr'), dpr);
    gl.uniform1i(uniform('uMode'), state.mode === 'scanimation' ? 1 : 0);
    gl.uniform1i(uniform('uLoupeOn'), state.loupeOn ? 1 : 0);
    gl.uniform2f(uniform('uLoupePos'), state.loupePos.x, state.loupePos.y);
    gl.uniform1f(uniform('uLoupeRadius'), state.loupeRadius);
    gl.uniform1f(uniform('uLoupeZoom'), state.loupeZoom);
    gl.uniform1f(uniform('uDarkTheme'), dark);
  });
}
// #endregion gl-upload

function render2DFallback() {
  if (!ctx2d || state.backend !== '2d') return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.75);
  let bw = Math.max(1, Math.round(cw * dpr));
  let bh = Math.max(1, Math.round(ch * dpr));
  const maxPx = 3.5e6;
  if (bw * bh > maxPx) {
    const k = Math.sqrt(maxPx / (bw * bh));
    bw = Math.max(1, Math.round(bw * k));
    bh = Math.max(1, Math.round(bh * k));
  }
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  const scale = bw / cw;
  const optical = computeOpticalState(state.angleDeg, state.mode, state.pitchPx);

  const dark = darkQuery?.matches;
  ctx2d.setTransform(scale, 0, 0, scale, 0, 0);
  ctx2d.fillStyle = dark ? '#181715' : '#ece7de';
  ctx2d.fillRect(0, 0, cw, ch);

  const { x, y, w, h } = state.rect;
  ctx2d.save();
  ctx2d.translate(x + w * 0.5, y);
  ctx2d.scale(optical.scaleX, 1);
  ctx2d.translate(-w * 0.5, 0);

  if (state.mode === 'lenticular') {
    for (let i = 0; i < 3; i++) {
      if (optical.weights[i] <= 0.01) continue;
      ctx2d.save();
      ctx2d.globalAlpha = optical.weights[i];
      ctx2d.drawElementImage(CARDS[i], 0, 0, w, h);
      ctx2d.restore();
    }
    // Vertical acrylic ridge lines.
    const pitch = state.pitchPx;
    ctx2d.fillStyle = 'rgba(255,255,255,0.14)';
    for (let rx = 0; rx < w; rx += pitch) {
      ctx2d.fillRect(rx + pitch * 0.35, 0, Math.max(1, pitch * 0.16), h);
    }
    ctx2d.fillStyle = 'rgba(0,0,0,0.12)';
    for (let rx = 0; rx < w; rx += pitch) {
      ctx2d.fillRect(rx, 0, 1, h);
    }
  } else {
    // 2D Scanimation fallback: clipped vertical strips + opaque black acetate bars.
    const pitch = state.pitchPx;
    const stripW = pitch / 3;
    for (let i = 0; i < 3; i++) {
      ctx2d.save();
      ctx2d.beginPath();
      for (let rx = i * stripW; rx < w; rx += pitch) {
        ctx2d.rect(rx, 0, stripW, h);
      }
      ctx2d.clip();
      ctx2d.drawElementImage(CARDS[i], 0, 0, w, h);
      ctx2d.restore();
    }
    ctx2d.fillStyle = '#0e0f12';
    const shift = ((optical.barrierPx % pitch) + pitch) % pitch;
    for (let rx = shift - pitch; rx < w + pitch; rx += pitch) {
      ctx2d.fillRect(rx + stripW, 0, pitch - stripW, h);
    }
  }
  ctx2d.restore();
  // Apply authority after drawElementImage() so hidden layers stay off-stage and inert.
  syncAuthorityUI(optical);
}

function drawNow() {
  if (state.backend === 'webgl') renderWebGL();
  else if (state.backend === '2d') render2DFallback();
}

function requestRender() {
  if (rafId || state.backend === 'plain') return;
  if (!state.onScreen || document.hidden) return;
  rafId = requestAnimationFrame(tick);
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  if (state.sweepOn) {
    if (reducedMotionQuery?.matches) {
      if (now - state.sweepLastStep >= 2200) {
        state.sweepLastStep = now;
        const stops = [-25, 0, 25];
        const nextIdx = (stops.findIndex((s) => Math.abs(state.angleDeg - s) < 4) + 1) % stops.length;
        setAngle(stops[nextIdx], false, false);
      }
    } else {
      const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
      state.sweepPhase += dt * 0.68;
      setAngle(Math.sin(state.sweepPhase) * 27, false, false);
    }
  }
  lastFrameTime = now;
  drawNow();

  if (state.sweepOn) requestRender();
}

function setAngle(deg, stopSweep = true, schedule = true) {
  const next = clamp(deg, -30, 30);
  state.angleDeg = next;
  angleSlider.value = String(Math.round(next * 2) / 2);
  if (stopSweep && state.sweepOn) {
    state.sweepOn = false;
    sweepBtn.setAttribute('aria-pressed', 'false');
  }
  if (schedule) requestRender();
}

// ---------------- Pointer Dragging (Sheet Tilt / Scanimation Slide / Loupe) ----------------

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function isLiveCardControl(target) {
  return target instanceof Element &&
    CARDS.some((c) => !c.inert && c.contains(target)) &&
    Boolean(target.closest('input, button, select, textarea, label'));
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain') return;
  const pt = canvasPoint(e);
  if (state.loupeOn && state.loupePos) {
    const dist = Math.hypot(pt.x - state.loupePos.x, pt.y - state.loupePos.y);
    if (dist <= state.loupeRadius + 8) {
      state.dragging = 'loupe';
      state.dragId = e.pointerId;
      canvas.classList.add('dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      return;
    }
  }

  if (isLiveCardControl(e.target)) return;

  if (tiltState.active) stopPhoneTilt('Switched to pointer drag.');
  state.dragging = 'sheet';
  state.dragId = e.pointerId;
  state.dragLastX = e.clientX;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  if (state.dragging === 'loupe') {
    const pt = canvasPoint(e);
    state.loupePos = {
      x: clamp(pt.x, 12, (canvas.clientWidth || 1) - 12),
      y: clamp(pt.y, 12, (canvas.clientHeight || 1) - 12),
    };
    requestRender();
    return;
  }

  const dx = e.clientX - state.dragLastX;
  state.dragLastX = e.clientX;
  // In Scanimation mode, a gentle drag translates directly into sub-period pixel shifts.
  const degPerPx = state.mode === 'scanimation' ? 0.32 : 0.24;
  setAngle(state.angleDeg + dx * degPerPx, true);
});

function stopDrag(e) {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  state.dragging = null;
  state.dragId = null;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
canvas.addEventListener('pointerup', stopDrag);
canvas.addEventListener('pointercancel', stopDrag);

// ---------------- Opt-in Phone Tilt (DeviceOrientationEvent) ----------------

// #region phone-tilt
function onDeviceOrientation(e) {
  if (typeof e.gamma !== 'number' || Number.isNaN(e.gamma)) return;
  if (!tiltState.gotReading) {
    tiltState.gotReading = true;
    clearTimeout(tiltState.timeoutId);
    tiltState.zeroGamma = e.gamma;
    routeNoteEl.textContent = `Phone tilt active (zeroed at gamma ${e.gamma.toFixed(1)}°). Tilt left for Layer A, level for Layer B, right for Layer C.`;
  }
  const rel = clamp((e.gamma - tiltState.zeroGamma) * 1.15, -30, 30);
  setAngle(rel, true);
}

function stopPhoneTilt(note = null) {
  clearTimeout(tiltState.timeoutId);
  window.removeEventListener('deviceorientation', onDeviceOrientation);
  tiltState.active = false;
  tiltState.zeroGamma = null;
  tiltState.gotReading = false;
  tiltBtn.setAttribute('aria-pressed', 'false');
  if (note) routeNoteEl.textContent = note;
}

async function togglePhoneTilt() {
  if (tiltState.active) {
    stopPhoneTilt('Phone tilt turned off.');
    return;
  }
  if (!('DeviceOrientationEvent' in window)) {
    routeNoteEl.textContent = 'DeviceOrientationEvent is not available in this browser; drag the sheet or use the angle slider.';
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    tiltState.permissionRequested = true;
    try {
      const verdict = await DeviceOrientationEvent.requestPermission();
      if (verdict !== 'granted') {
        routeNoteEl.textContent = `Orientation permission was ${verdict}; drag the sheet or use the angle slider.`;
        return;
      }
    } catch (err) {
      routeNoteEl.textContent = `Orientation permission failed (${err.message}).`;
      return;
    }
  }
  tiltState.active = true;
  tiltState.gotReading = false;
  tiltState.zeroGamma = null;
  tiltBtn.setAttribute('aria-pressed', 'true');
  window.addEventListener('deviceorientation', onDeviceOrientation);
  routeNoteEl.textContent = 'Listening for phone tilt (DeviceOrientationEvent gamma)...';

  tiltState.timeoutId = setTimeout(() => {
    if (tiltState.active && !tiltState.gotReading) {
      stopPhoneTilt('No orientation readings arrived on this device; drag the sheet or use the angle slider.');
    }
  }, 1500);
}
// #endregion phone-tilt

tiltBtn.addEventListener('click', togglePhoneTilt);

// ---------------- Toolbar Controls ----------------

for (const btn of modeBtns) {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b === btn));
    state.geoCache = [null, null, null];
    requestRender();
  });
}

for (const btn of angleBtns) {
  btn.addEventListener('click', () => {
    if (tiltState.active) stopPhoneTilt('Phone tilt paused after picking a preset.');
    setAngle(Number(btn.dataset.angle), true);
  });
}

angleSlider.addEventListener('input', () => {
  if (tiltState.active) stopPhoneTilt('Phone tilt paused after moving the slider.');
  setAngle(Number(angleSlider.value), true);
});

pitchSlider.addEventListener('input', () => {
  state.pitchPx = Number(pitchSlider.value);
  requestRender();
});

sweepBtn.addEventListener('click', () => {
  if (tiltState.active) stopPhoneTilt('Phone tilt paused for slow sweep.');
  state.sweepOn = !state.sweepOn;
  sweepBtn.setAttribute('aria-pressed', String(state.sweepOn));
  if (state.sweepOn) {
    state.sweepPhase = Math.asin(clamp(state.angleDeg / 27, -1, 1));
    state.sweepLastStep = performance.now();
    lastFrameTime = performance.now();
    if (reducedMotionQuery?.matches) {
      routeNoteEl.textContent = 'Reduced motion is active, so slow sweep steps between -25°, 0° and +25° every 2.2 s.';
    }
    requestRender();
  }
});

loupeBtn.addEventListener('click', () => {
  state.loupeOn = !state.loupeOn;
  loupeBtn.setAttribute('aria-pressed', String(state.loupeOn));
  if (state.loupeOn && !state.loupePos) {
    state.loupePos = {
      x: state.rect.x + state.rect.w * 0.5,
      y: state.rect.y + state.rect.h * 0.5,
    };
  }
  requestRender();
});

// ---------------- Live Card DOM Interactions ----------------

let aTapCount = 0;
const A_STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'checked', label: 'Checked' },
  { key: 'locked', label: 'Locked' },
];
let aStatusIdx = 0;

function pokeCanvas() {
  canvas.requestPaint?.();
}

aNote.addEventListener('input', pokeCanvas);

aCountBtn.addEventListener('click', () => {
  aTapCount++;
  aCountEl.textContent = `${aTapCount} ${aTapCount === 1 ? 'tap' : 'taps'}`;
  pokeCanvas();
});

aStatusBtn.addEventListener('click', () => {
  aStatusIdx = (aStatusIdx + 1) % A_STATUSES.length;
  const st = A_STATUSES[aStatusIdx];
  aPill.dataset.state = st.key;
  aPill.textContent = st.label;
  pokeCanvas();
});

bGain.addEventListener('input', () => {
  const val = `${bGain.value}%`;
  bGainOut.textContent = val;
  bMeterFill.style.width = val;
  pokeCanvas();
});

bGridSw.addEventListener('click', () => {
  const on = cardB.classList.toggle('dense-grid');
  bGridSw.setAttribute('aria-checked', String(on));
  pokeCanvas();
});

bContrastSw.addEventListener('click', () => {
  const on = cardB.classList.toggle('high-contrast');
  bContrastSw.setAttribute('aria-checked', String(on));
  pokeCanvas();
});

for (const btn of bAccentBtns) {
  btn.addEventListener('click', () => {
    for (const b of bAccentBtns) b.setAttribute('aria-pressed', String(b === btn));
    cardB.style.setProperty('--b-accent', btn.dataset.accent);
    bAccentReadout.textContent = `ACCENT: ${btn.dataset.label}`;
    pokeCanvas();
  });
}

let cJapanese = false;
function applyCardCLang() {
  if (cJapanese) {
    cKickerText.textContent = 'レイヤー C / 翻訳ポスター';
    cLangCode.textContent = '日本語';
    cTitle.textContent = '光学プリントポスター';
    cSub.textContent = '+25°に傾けた状態で言語切替やタグ編集ができます。';
    cLangBtn.textContent = 'English';
    cTagLabel.textContent = '編集タグ';
    cFootLeft.textContent = 'ピーク角 +25°';
    cFootRight.textContent = 'ライブ層 C';
  } else {
    cKickerText.textContent = 'Layer C / Translate alt';
    cLangCode.textContent = 'EN';
    cTitle.textContent = 'Optical print poster';
    cSub.textContent = 'Switch language or edit the print tag while tilted at +25°.';
    cLangBtn.textContent = '日本語';
    cTagLabel.textContent = 'Editable tag';
    cFootLeft.textContent = 'Angle peak +25°';
    cFootRight.textContent = 'LIVE LAYER C';
  }
  cLangBtn.setAttribute('aria-pressed', String(cJapanese));
  pokeCanvas();
}

cLangBtn.addEventListener('click', () => {
  cJapanese = !cJapanese;
  applyCardCLang();
});

cTag.addEventListener('input', () => {
  cTagPreview.textContent = (cTag.value.trim() || 'EMPTY').toUpperCase();
  pokeCanvas();
});

for (const chip of cChipBtns) {
  chip.addEventListener('click', () => {
    cTag.value = chip.dataset.tag;
    cTagPreview.textContent = chip.dataset.tag;
    pokeCanvas();
  });
}

// ---------------- Boot & Observers ----------------

function initRenderer() {
  if (!hicSupported) {
    fallbackToPlainHTML('HTML-in-canvas is not enabled in this browser');
    return;
  }

  layoutCards();
  updateMetersAndHUD(computeOpticalState(state.angleDeg, state.mode, state.pitchPx));

  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: LENTICULAR_FRAG,
        attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          textures = [null, null, null];
          fallbackToPlainHTML('WebGL 2 context lost');
        },
        onRestored: () => {
          for (const card of CARDS) {
            if (card.parentElement !== canvas) canvas.append(card);
          }
          canvas.hidden = false;
          state.backend = 'webgl';
          textures = [null, null, null];
          state.geoCache = [null, null, null];
          layoutCards();
          updateMetersAndHUD(computeOpticalState(state.angleDeg, state.mode, state.pitchPx));
          routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL context (texElementSubImage2D + updateElementGeometry).';
          canvas.requestPaint?.();
          requestRender();
        },
      });
      state.backend = 'webgl';
      routeNoteEl.textContent = 'Drawn with WebGL 2 on one ElementGL context using texElementSubImage2D() and updateElementGeometry().';
    } catch (err) {
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back to 2D.`;
    }
  }

  if (state.backend !== 'webgl') {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; drawn with 2D drawElementImage().';
    } else {
      fallbackToPlainHTML('Canvas context unavailable');
      return;
    }
  }

  canvas.addEventListener('paint', (e) => {
    state.stats.paints++;
    if (state.backend === 'webgl') {
      const changed = e.changedElements ? Array.from(e.changedElements) : null;
      if (uploadCards(changed)) renderWebGL();
    } else if (state.backend === '2d') {
      render2DFallback();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (state.backend === 'plain') return;
      const { sizeChanged } = layoutCards();
      state.geoCache = [null, null, null];
      if (sizeChanged) canvas.requestPaint?.();
      requestRender();
    });
    ro.observe(canvas);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((entries) => {
      state.onScreen = entries.some((entry) => entry.isIntersecting);
      if (state.onScreen) requestRender();
    }, { rootMargin: '120px' });
    io.observe(canvas);
  }

  darkQuery?.addEventListener?.('change', () => requestRender());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.onScreen) requestRender();
  });

  canvas.requestPaint?.();
  requestRender();
}

initRenderer();

// ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------

const tests = [
  {
    name: 'ElementGL uploads 3 drawable children into 3 textures and composites through one shader',
    why: 'Builds an isolated drawable canvas fixture with three solid-colour cards (red, green, blue), uploads all three via ElementGL.upload(), renders both lenticular and Scanimation passes, reads centre pixels and verifies gl.getError() === 0.',
    timeout: 7000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 180, ch = 120;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;

      const colours = ['#e03020', '#1e9e4a', '#1d5fe0'];
      const cards = colours.map((bg, i) => {
        const el = document.createElement('div');
        el.setAttribute('drawable', '');
        el.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:${bg};`;
        el.textContent = `L${i}`;
        fixCanvas.append(el);
        return el;
      });
      testStage().append(fixCanvas);

      const fixGL = new ElementGL(fixCanvas, {
        fragment: LENTICULAR_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      try {
        await nextPaint(fixCanvas);
        const gl = fixGL.gl;
        gl.activeTexture(gl.TEXTURE0);
        const texs = cards.map((c) => fixGL.upload(c));
        if (texs.some((t) => !t || !t.w || !t.h)) throw new Error('one or more textures failed to upload');

        const drawPass = (angleDeg, mode, pitch = 9) => {
          const opt = computeOpticalState(angleDeg, mode, pitch);
          fixGL.begin([0, 0, 0, 1]);
          const mat = ElementGL.rect(fixCanvas, 0, 0, cw, ch);
          const dpr = fixCanvas.width / cw;
          fixGL.quad(cards[0], mat, (g, u) => {
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, texs[1].tex);
            g.uniform1i(u('uTexB'), 1);
            g.activeTexture(g.TEXTURE2);
            g.bindTexture(g.TEXTURE_2D, texs[2].tex);
            g.uniform1i(u('uTexC'), 2);
            g.activeTexture(g.TEXTURE0);
            g.uniform2f(u('uCanvasSize'), cw, ch);
            g.uniform4f(u('uCardRect'), 0, 0, cw, ch);
            g.uniform1f(u('uAngleDeg'), opt.angleDeg);
            g.uniform1f(u('uScaleX'), opt.scaleX);
            g.uniform1f(u('uPitchPx'), pitch);
            g.uniform1f(u('uBarrierPx'), opt.barrierPx);
            g.uniform1f(u('uDpr'), dpr);
            g.uniform1i(u('uMode'), mode === 'scanimation' ? 1 : 0);
            g.uniform1i(u('uLoupeOn'), 0);
            g.uniform2f(u('uLoupePos'), cw * 0.5, ch * 0.5);
            g.uniform1f(u('uLoupeRadius'), 40);
            g.uniform1f(u('uLoupeZoom'), 4.5);
            g.uniform1f(u('uDarkTheme'), 0);
          });
          const err = gl.getError();
          if (err !== 0) throw new Error(`gl.getError() returned 0x${err.toString(16)}`);
          return dpr;
        };

        const readCentre = (dpr) => {
          const px = new Uint8Array(4);
          // Sample at CSS x = 94.5 (middle of a 9 px lenticule cell, s = 0).
          const sx = Math.min(fixCanvas.width - 1, Math.floor(94.5 * dpr));
          const sy = Math.floor(fixCanvas.height * 0.5);
          gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return Array.from(px);
        };

        const dprA = drawPass(-25, 'lenticular', 9);
        const pxA = readCentre(dprA);
        const dprB = drawPass(0, 'lenticular', 9);
        const pxB = readCentre(dprB);
        const dprC = drawPass(25, 'lenticular', 9);
        const pxC = readCentre(dprC);
        if (!(pxA[0] > pxA[1] + 60 && pxA[0] > pxA[2] + 60)) throw new Error(`-25° expected red, got rgba(${pxA.join(',')})`);
        if (!(pxB[1] > pxB[0] + 40 && pxB[1] > pxB[2] + 30)) throw new Error(`0° expected green, got rgba(${pxB.join(',')})`);
        if (!(pxC[2] > pxC[0] + 60 && pxC[2] > pxC[1] + 30)) throw new Error(`+25° expected blue, got rgba(${pxC.join(',')})`);

        // Also scan one 9 px period in Scanimation mode at 0° (Layer B green slits + opaque bars).
        const dprS = drawPass(0, 'scanimation', 9);
        const span = Math.max(9, Math.ceil(9 * dprS));
        const row = new Uint8Array(span * 4);
        const sx0 = Math.floor(90 * dprS);
        const sy0 = Math.floor(fixCanvas.height * 0.5);
        gl.readPixels(sx0, sy0, span, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
        let greenSlits = 0, darkBars = 0;
        for (let i = 0; i < span; i++) {
          const r = row[i * 4], g = row[i * 4 + 1], b = row[i * 4 + 2];
          if (g > r + 40 && g > b + 30) greenSlits++;
          if (r < 45 && g < 45 && b < 50) darkBars++;
        }
        if (greenSlits === 0 || darkBars === 0) {
          throw new Error(`Scanimation 0° scan expected green slits and black bars, saw ${greenSlits} green / ${darkBars} dark across ${span} px`);
        }
        return `3 textures (${texs[0].w}x${texs[0].h}); lenticular rgb A(${pxA.slice(0, 3).join(',')}) B(${pxB.slice(0, 3).join(',')}) C(${pxC.slice(0, 3).join(',')}); scanimation ${greenSlits} slit / ${darkBars} bar px; gl.getError() === 0`;
      } finally {
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Viewing angle -25° to 0° to +25° flips dominant layer A -> B -> C and inert state',
    why: 'Steps an isolated 3-card fixture across -25°, -12.5°, 0°, +12.5° and +25° in both lenticular and Scanimation modes, verifying dominant weights and inert transitions.',
    run: async () => {
      const box = document.createElement('div');
      const cards = [0, 1, 2].map(() => {
        const el = document.createElement('div');
        box.append(el);
        return el;
      });
      testStage().append(box);

      try {
        for (const mode of ['lenticular', 'scanimation']) {
          const checkStop = (deg, expectDom) => {
            const opt = computeOpticalState(deg, mode, 9);
            for (let i = 0; i < 3; i++) cards[i].inert = i !== opt.dominant;
            if (opt.dominant !== expectDom) {
              throw new Error(`${mode} at ${deg}° gave dominant ${opt.dominant}, expected ${expectDom}`);
            }
            const activeCount = cards.filter((c) => !c.inert).length;
            const wantCount = expectDom === -1 ? 0 : 1;
            if (activeCount !== wantCount) {
              throw new Error(`${mode} at ${deg}° left ${activeCount} non-inert cards, expected ${wantCount}`);
            }
            if (expectDom >= 0 && cards[expectDom].inert) {
              throw new Error(`${mode} at ${deg}° left dominant card ${expectDom} inert`);
            }
          };

          checkStop(-25, 0);
          checkStop(-12.5, -1);
          checkStop(0, 1);
          checkStop(12.5, -1);
          checkStop(25, 2);
        }
        return 'lenticular & scanimation: -25° -> Layer A, -12.5° -> deadband (all inert), 0° -> Layer B, +12.5° -> deadband, +25° -> Layer C';
      } finally {
        box.remove();
      }
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() aligns elementsFromPoint() to the active button',
    why: 'Builds an isolated drawable canvas fixture with three stacked cards sharing the same button coordinates, then verifies elementsFromPoint() switches from Button A to Button B to Button C as the angle changes.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 260, ch = 180;
      const rect = { x: 20, y: 16, w: 220, h: 148 };
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;
      const dpr = window.devicePixelRatio || 1;
      fixCanvas.width = Math.round(cw * dpr);
      fixCanvas.height = Math.round(ch * dpr);

      const cards = [];
      const btns = [];
      for (let i = 0; i < 3; i++) {
        const card = document.createElement('div');
        card.setAttribute('drawable', '');
        card.style.cssText = `position:absolute;left:0;top:0;width:${rect.w}px;height:${rect.h}px;background:#fff;`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = `Btn ${i}`;
        btn.style.cssText = 'position:absolute;left:60px;top:48px;width:100px;height:52px;';
        card.append(btn);
        fixCanvas.append(card);
        cards.push(card);
        btns.push(btn);
      }
      testStage().append(fixCanvas);

      try {
        const unit = geometryUnit(fixCanvas, cards[0], rect.w);
        const canvasRect = fixCanvas.getBoundingClientRect();
        const hits = [];

        for (const [deg, idx] of [[-25, 0], [0, 1], [25, 2]]) {
          const opt = computeOpticalState(deg, 'lenticular', 9);
          applyAuthority(fixCanvas, cards, rect, opt, unit);
          const m = cardTransformMatrix(rect, opt.scaleX).toFloat32Array();
          const bx = 110, by = 74;
          const sx = m[0] * bx + m[4] * by + m[12];
          const sy = m[1] * bx + m[5] * by + m[13];
          const hitList = document.elementsFromPoint(canvasRect.left + sx, canvasRect.top + sy);
          if (!hitList.includes(btns[idx])) {
            throw new Error(`at ${deg}° expected Btn ${idx}, top was ${hitList[0]?.tagName} (${hitList[0]?.textContent?.slice(0, 16) ?? ''})`);
          }
          for (let j = 0; j < 3; j++) {
            if (j !== idx && hitList.includes(btns[j])) {
              throw new Error(`at ${deg}° hidden Btn ${j} also matched elementsFromPoint()`);
            }
          }
          hits.push(`${deg}° -> Btn ${idx}`);
        }
        return `${hits.join(', ')} (geometryUnit=${unit.toFixed(2)})`;
      } finally {
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'DeviceOrientationEvent availability (no permission requested on load)',
    why: 'Reports whether orientation events exist and whether iOS-style requestPermission() is present, while confirming the page requested nothing before a tap.',
    run: async () => {
      const hasApi = 'DeviceOrientationEvent' in window;
      const needsPerm = hasApi && typeof DeviceOrientationEvent.requestPermission === 'function';
      if (tiltState.permissionRequested) {
        throw new Error('DeviceOrientationEvent.requestPermission() was called without a tap');
      }
      return `DeviceOrientationEvent: ${hasApi ? 'present' : 'absent'}; requestPermission(): ${needsPerm ? 'required on tap' : 'not required'}; prompted on load: no`;
    },
  },
  stillDrawn(() => [
    {
      name: 'lenticular sheet',
      ink: async () => {
        if (state.backend === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !textures[0] || !textures[1] || !textures[2]) return 0;
          return state.stats.uploads >= 3 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => fallbackToPlainHTML('Canvas drew blank after live checks'),
    },
  ]),
];

runTests(checksBody, tests);
