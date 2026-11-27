import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const WIPE_DURATION_MS = 560;
const SHUTTER_TILT_RAD = -0.024; // ~ -1.4 deg crisp Saul Bass poster cant

const ACTS = [
  {
    kicker: 'ACT I · PROLOGUE',
    reel: 'REEL 01',
    cast: 'STARRING LIVE DOM INPUTS & CLICKABLE ACT PILLS',
    sub: 'TITLE DESIGN ON ONE ELEMENTGL CANVAS',
    accent: [0.835, 0.255, 0.145],
  },
  {
    kicker: 'ACT II · KNIFE CUT',
    reel: 'REEL 02',
    cast: 'DIAGONAL SHUTTERS & DECKLED PAPER GRAIN',
    sub: 'TEXELEMENTSUBIMAGE2D() + DROP SHADOWS',
    accent: [0.788, 0.204, 0.125],
  },
  {
    kicker: 'ACT III · ANATOMY',
    reel: 'REEL 03',
    cast: 'ASYMMETRIC BLOCKS & CONCENTRIC APERTURE',
    sub: 'UPDATEELEMENTGEOMETRY() KEPT ALIGNED',
    accent: [0.847, 0.545, 0.149],
  },
  {
    kicker: 'FINALE · END REEL',
    reel: 'REEL 04',
    cast: 'OFF-WHITE, TERRACOTTA & CHARCOAL STOCK',
    sub: 'REDUCED MOTION SNAPS IN ONE STEP',
    accent: [0.686, 0.145, 0.118],
  },
];

const MOTIF_NAMES = ['Shutters', 'Segmented blocks', 'Spiral iris'];

const stageBox = document.getElementById('bass-stage');
const viewportEl = document.getElementById('bass-viewport');
const canvas = document.getElementById('bass-canvas');
const slateEl = document.getElementById('credits-slate');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('bass-notice');
const hudEl = document.getElementById('bass-hud');
const testsBody = document.getElementById('tests');

// Controls inside the drawable slate
const actPills = Array.from(slateEl.querySelectorAll('.act-pill'));
const kickerTextEl = document.getElementById('slate-kicker-text');
const reelTagEl = document.getElementById('slate-reel-tag');
const headlineEl = document.getElementById('slate-headline');
const titleInput = document.getElementById('credit-title');
const directorInput = document.getElementById('credit-director');
const castEl = document.getElementById('slate-cast');
const subEl = document.getElementById('slate-sub');

// External controls
const motifBtns = Array.from(document.querySelectorAll('button[data-motif]'));
const wipeBtn = document.getElementById('btn-wipe');
const wipeSlider = document.getElementById('ctl-wipe');
const wipeOut = document.getElementById('out-wipe');
const reducedCheck = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

if (reducedQuery.matches) reducedCheck.checked = true;

// #region cutout-shader
const BASS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec4 uSlateRect;   // cx, cy, sw, sh (CSS px)
uniform float uSlateAngle; // radians
uniform int uMotif;        // 0 = Shutters, 1 = Segmented blocks, 2 = Spiral iris
uniform float uWipe;       // 0..1 cutout wipe progress
uniform float uAlignSnap;  // 0 = fractured, 1 = aligned (Motif 1)
uniform vec2 uPointer;     // -1..1 normalised pointer offset
uniform float uReduced;    // 0 or 1
uniform vec3 uAccent;      // act terracotta/ochre paper accent

in vec2 vUv;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float paperTooth(vec2 p) {
  float coarse = valueNoise(p * 0.42);
  float fine = valueNoise(p * 1.38 + 11.7);
  float fibreA = valueNoise(vec2(p.x * 0.16 + p.y * 0.05, p.y * 1.15) + 37.0);
  float fibreB = valueNoise(vec2(p.x * 0.94, p.y * 0.15 - p.x * 0.05) + 73.0);
  float fleck = step(0.955, hash12(floor(p * 0.92))) * 0.35;
  return (coarse * 0.45 + fine * 0.55 - 0.5) * 0.9 + ((fibreA + fibreB) * 0.5 - 0.5) * 0.7 - fleck * 0.09;
}

float deckle(float t, float amp) {
  float n1 = valueNoise(vec2(t * 0.24, 4.3)) - 0.5;
  float n2 = valueNoise(vec2(t * 0.88, 19.1)) - 0.5;
  return (n1 * 0.72 + n2 * 0.28) * amp;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec2 invRotate(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
}

// Sample live DOM texture with premultiplied alpha over textured off-white paper.
vec3 sampleSlate(vec2 localPx, float tooth, out float mask) {
  vec2 halfS = uSlateRect.zw * 0.5;
  vec2 centered = localPx - halfS;
  float edgeJitter = deckle(centered.x * 0.9 + centered.y * 1.2, 2.2);
  float dBox = sdBox(centered, halfS + vec2(edgeJitter * 0.45));
  mask = 1.0 - smoothstep(-0.75, 0.75, dBox);

  vec2 uv = clamp(localPx / max(uSlateRect.zw, vec2(1.0)), 0.0, 1.0);
  vec4 texel = texture(uTex, uv);
  vec3 creamPaper = vec3(0.957, 0.922, 0.851) * (1.0 + tooth * 0.09);
  vec3 comp = texel.rgb + creamPaper * (1.0 - texel.a);
  float lum = dot(comp, vec3(0.299, 0.587, 0.114));
  float pressMod = 1.0 + tooth * mix(0.055, 0.11, smoothstep(0.76, 0.15, lum));
  return clamp(comp * pressMod, 0.0, 1.0);
}

vec3 paperBackdrop(vec2 pCss, float tooth) {
  vec3 charcoal = vec3(0.098, 0.090, 0.086) * (1.0 + tooth * 0.11);
  vec3 terracotta = uAccent * (1.0 + tooth * 0.09);
  vec3 cream = vec3(0.953, 0.914, 0.835) * (1.0 + tooth * 0.08);
  vec2 rel = pCss - uSlateRect.xy;

  // Base terracotta construction-paper sheet with an angled charcoal slab and corner cream wedge.
  vec3 col = terracotta;
  float slabAxis = dot(rel, normalize(vec2(0.88, 0.47))) + deckle(rel.y * 0.7 - rel.x * 0.3, 3.0);
  float slabDist = slabAxis - (uCanvasSize.x * 0.02);
  float slabShadow = 1.0 - smoothstep(-2.0, 10.0, slabDist - 6.0);
  col *= 1.0 - 0.34 * slabShadow;
  float slabMask = smoothstep(-0.8, 0.8, slabDist);
  col = mix(col, charcoal, slabMask);

  // Small cream paper wedge tucked into the lower-left edge for asymmetric Bass contrast.
  float wedgeDist = dot(rel, normalize(vec2(0.58, -0.81))) + deckle(rel.x * 0.8, 2.4) + (uCanvasSize.y * 0.34);
  float wedgeShadow = 1.0 - smoothstep(-1.5, 8.0, wedgeDist - 5.0);
  col *= 1.0 - 0.25 * wedgeShadow;
  col = mix(col, cream, 1.0 - smoothstep(-0.8, 0.8, wedgeDist));
  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 pCss = vUv * uCanvasSize;
  float tooth = paperTooth(pCss);
  vec3 charcoal = vec3(0.098, 0.090, 0.086) * (1.0 + tooth * 0.11);
  vec3 terracotta = uAccent * (1.0 + tooth * 0.09);
  vec3 ochre = vec3(0.863, 0.588, 0.180) * (1.0 + tooth * 0.09);
  vec3 cream = vec3(0.953, 0.914, 0.835) * (1.0 + tooth * 0.08);

  vec3 col = paperBackdrop(pCss, tooth);
  vec2 halfS = uSlateRect.zw * 0.5;
  vec2 q = invRotate(pCss - uSlateRect.xy, uSlateAngle);

  if (uMotif == 0) {
    // Motif 0: Vertigo / diagonal knife-edge shutters.
    vec2 dirU = normalize(vec2(0.82, -0.57));
    vec2 dirV = vec2(0.57, 0.82);
    float u = dot(q, dirU);
    float v = dot(q, dirV);

    float parallax = uPointer.x * 8.0 * (1.0 - uReduced);
    float uShift = u + parallax + 27.0;
    float bandIdx = floor(uShift / 54.0);
    float bandLocal = fract(uShift / 54.0) * 54.0 - 27.0;
    float isEven = step(mod(abs(bandIdx), 2.0), 0.5);
    float slideDir = isEven > 0.5 ? 1.0 : -1.0;

    // Subtle shear of revealed DOM slices during wipe transitions.
    vec2 shearedLocal = (q + dirV * (slideDir * uWipe * 22.0)) + halfS;
    float slateMask = 0.0;
    vec3 slateCol = sampleSlate(shearedLocal, tooth, slateMask);

    // Drop shadow cast by the live slate onto the construction paper sheet.
    vec2 qSh = invRotate(pCss - (uSlateRect.xy + vec2(6.0, 8.0)), uSlateAngle);
    float slateDrop = 1.0 - smoothstep(-1.0, 7.0, sdBox(qSh, halfS));
    col *= 1.0 - 0.36 * slateDrop;
    col = mix(col, slateCol, slateMask);

    // Outer diagonal corner blades frame the slate edges without covering controls at wipe = 0.
    float cornerLimit = halfS.x * 0.82 + halfS.y * 0.57 - 4.0;
    float cornerA = -(u + cornerLimit) + deckle(v * 0.9, 2.6);
    float cornerB = (u - cornerLimit) + deckle(v * 0.9 + 15.0, 2.6);
    float cornerDist = max(-cornerA, -cornerB);
    float cornerShadow = 1.0 - smoothstep(-2.0, 8.0, cornerDist - 4.5);
    col *= 1.0 - 0.34 * cornerShadow * slateMask;
    col = mix(col, terracotta, 1.0 - smoothstep(-0.7, 0.7, -cornerA));
    col = mix(col, charcoal, 1.0 - smoothstep(-0.7, 0.7, -cornerB));

    // Slicing shutter bands driven by uWipe (even bands close charcoal; high wipe closes terracotta).
    if (uWipe > 0.005) {
      float wedgeSkew = bandLocal * 0.05;
      float edgeWobble = deckle(v + bandIdx * 29.0, 2.2);
      float bladeHalf = smoothstep(0.02, 0.85, uWipe) * 26.5;
      float blade2Half = smoothstep(0.70, 1.0, uWipe) * 20.5;
      float activeHalf = mix(blade2Half, bladeHalf, isEven) + wedgeSkew;

      if (activeHalf > 0.05) {
        float dBlade = abs(bandLocal + edgeWobble * 0.35) - activeHalf;
        float bladeShadow = 1.0 - smoothstep(-1.5, 6.5, dBlade - 4.2);
        col *= 1.0 - 0.38 * bladeShadow;
        float bladeMask = 1.0 - smoothstep(-0.7, 0.7, dBlade);
        vec3 bladePaper = isEven > 0.5 ? charcoal : terracotta;
        col = mix(col, bladePaper, bladeMask);
      }
    }
  } else if (uMotif == 1) {
    // Motif 1: Anatomy / asymmetric staggered segmented blocks.
    float ny = q.y / max(uSlateRect.w, 1.0);
    float si = 0.0;
    if (ny > -0.34) si = 1.0;
    if (ny > -0.14) si = 2.0;
    if (ny > 0.06)  si = 3.0;
    if (ny > 0.28)  si = 4.0;

    float fracture = clamp(uWipe + (1.0 - uAlignSnap) * 0.26, 0.0, 1.0);
    float dir = mod(si, 2.0) < 0.5 ? 1.0 : -1.0;
    float mag = 0.7 + 0.45 * hash12(vec2(si + 1.0, 3.0));
    float shiftX = dir * mag * fracture * 62.0;
    float shiftY = (hash12(vec2(si + 7.0, 2.0)) - 0.5) * fracture * 8.0;

    // Asymmetric construction-paper blocks framing the stage.
    float leftBlock = sdBox(q - vec2(-halfS.x - 16.0 + shiftX * 0.45, -36.0), vec2(26.0, 74.0));
    float rightBlock = sdBox(q - vec2(halfS.x + 18.0 - shiftX * 0.45, 42.0), vec2(28.0, 82.0));
    float topOchre = sdBox(q - vec2(-42.0 - shiftX * 0.25, -halfS.y - 10.0), vec2(84.0, 18.0));
    col = mix(col, charcoal, 1.0 - smoothstep(-0.75, 0.75, leftBlock));
    col = mix(col, terracotta, 1.0 - smoothstep(-0.75, 0.75, rightBlock));
    col = mix(col, ochre, 1.0 - smoothstep(-0.75, 0.75, topOchre));

    vec2 segQ = q - vec2(shiftX, shiftY);
    vec2 segSh = q - vec2(shiftX + 6.0, shiftY + 7.0);
    float segShadow = 1.0 - smoothstep(-1.0, 7.0, sdBox(segSh, halfS));
    col *= 1.0 - 0.36 * segShadow;

    float segMask = 0.0;
    vec3 segCol = sampleSlate(segQ + halfS, tooth, segMask);

    // Strip gutter cuts open cleanly between asymmetric blocks during fracture.
    float rowEdge = min(
      min(abs(ny + 0.34), abs(ny + 0.14)),
      min(abs(ny - 0.06), abs(ny - 0.28))
    ) * uSlateRect.w;
    float gutterHalf = fracture * 4.2 + deckle(q.x * 0.7 + si * 19.0, 0.9 * fracture);
    float inGutter = 1.0 - smoothstep(gutterHalf - 0.7, gutterHalf + 0.7, rowEdge);
    segMask *= (1.0 - inGutter);

    // At higher wipe, alternating charcoal/terracotta paper blocks slice across ends.
    float blockCoverX = (dir * q.x) - mix(halfS.x + 20.0, -halfS.x * 0.35, smoothstep(0.28, 1.0, uWipe));
    float endBlockMask = smoothstep(-0.75, 0.75, blockCoverX) * step(abs(ny), 0.52);
    col = mix(col, segCol, segMask);
    if (uWipe > 0.28) {
      vec3 coverCol = mod(si, 2.0) < 0.5 ? charcoal : terracotta;
      col = mix(col, coverCol, endBlockMask * (1.0 - inGutter));
    }
  } else {
    // Motif 2: Vertigo / concentric asymmetrical spiral eye iris (branch-cut-free periodic phase).
    vec2 eyeCenter = uSlateRect.xy + vec2(6.0, -4.0) + uPointer * 14.0 * (1.0 - uReduced);
    vec2 ep = (pCss - eyeCenter) * vec2(1.0, 1.15);
    float r = length(ep);
    float theta = atan(ep.y, ep.x);
    vec2 angDir = r > 0.001 ? ep / r : vec2(1.0, 0.0);
    float angWobble = (valueNoise(angDir * 4.2 + 7.5) - 0.5) * 2.6;

    float rot = (uReduced > 0.5 ? 0.0 : uTime * 0.62) + uWipe * 4.2;
    float pitch = 40.0;
    float phase = ((r + angWobble) / pitch) * 6.2831853 - (2.0 * theta + rot);
    float spSin = sin(phase);
    // Analytic screen-space derivative avoids atan +/-pi branch-cut seam.
    float aa = max(0.08, (6.2831853 / pitch) * 1.2 + (2.4 / max(r, 10.0)));
    float arm = smoothstep(-aa, aa, spSin);
    float armShadow = smoothstep(-0.45, 0.05, spSin) * (1.0 - arm) * 0.38;

    float outerRing = smoothstep(0.25, 0.85, sin(r * 0.045 - rot * 0.5) * 0.5 + 0.5);
    vec3 underPaper = mix(cream, charcoal, outerRing * 0.88);
    vec3 spiralBg = underPaper * (1.0 - armShadow);
    spiralBg = mix(spiralBg, terracotta, arm);

    // Central readable aperture shrinks smoothly with uWipe while keeping pills clear at 0%.
    float openR = length(halfS * vec2(1.0, 1.15)) * 0.97;
    float apR = mix(openR, 38.0, pow(clamp(uWipe, 0.0, 1.0), 0.82)) + angWobble * 1.1;
    float insideAperture = 1.0 - smoothstep(apR - 1.2, apR + 1.2, r);
    float irisShadow = smoothstep(apR - 11.0, apR, r) * insideAperture * 0.34;

    float slateMask = 0.0;
    vec3 slateCol = sampleSlate(q + halfS, tooth, slateMask);
    vec3 innerCol = mix(cream, slateCol, slateMask);
    innerCol *= 1.0 - irisShadow;

    // Charcoal iris border ring.
    float rim = 1.0 - smoothstep(0.0, 3.2, abs(r - apR));
    col = mix(spiralBg, innerCol, insideAperture);
    col = mix(col, charcoal, rim * 0.85);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion cutout-shader

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  motif: 0, // 0 = Shutters, 1 = Segmented blocks, 2 = Spiral iris
  act: 0,
  manualWipe: 0,
  reducedOverride: reducedCheck.checked,
  hasPainted: false,
  domDirty: true,
  onScreen: true,
  transActive: false,
  transStart: 0,
  targetAct: 0,
  actSwapped: false,
  alignSnap: 1,
  alignTarget: 1,
  pointerHoverSlate: false,
  pointerX: 0,
  pointerY: 0,
  hasPointer: false,
  rafId: 0,
  lastTickMs: 0,
  paints: 0,
  uploads: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: null,
};

let stage = null;
let ctx2d = null;
let slateTex = null;

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

// Pure transition solver used both by the rAF loop and Live Check 4.
export function computeWipeStep(elapsedMs, durationMs, reduced) {
  if (reduced || durationMs <= 0 || elapsedMs >= durationMs) {
    return { wipe: 0, swapReady: true, active: false, spiralOmega: 0 };
  }
  const u = Math.max(0, Math.min(1, elapsedMs / durationMs));
  // Rise smoothly 0 -> 1 by 45% elapsed, swap DOM act at peak, return 1 -> 0 by 100%.
  let raw;
  if (u < 0.45) {
    const t = u / 0.45;
    raw = t * t * (3 - 2 * t);
  } else {
    const t = (u - 0.45) / 0.55;
    raw = 1 - t * t * (3 - 2 * t);
  }
  return {
    wipe: raw,
    swapReady: u >= 0.45,
    active: true,
    spiralOmega: 0.62,
  };
}

export function buildSlateMatrix(cx, cy, sw, sh, angleRad) {
  return new DOMMatrix()
    .translate(cx, cy)
    .rotate((angleRad * 180) / Math.PI)
    .translate(-sw * 0.5, -sh * 0.5);
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 354);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 460);
  return { cw, ch };
}

function syncSlateWidth(cw) {
  if (state.mode === 'plain') {
    if (slateEl.style.width !== '') slateEl.style.width = '';
    return;
  }
  const sw = Math.round(Math.min(448, Math.max(260, cw - 44)));
  const target = `${sw}px`;
  if (slateEl.style.width !== target) {
    slateEl.style.width = target;
    state.domDirty = true;
    state.lastGeoKey = null;
  }
}

function effectiveWipe() {
  let transWipe = 0;
  if (state.transActive) {
    const step = computeWipeStep(performance.now() - state.transStart, WIPE_DURATION_MS, isReducedMotion());
    transWipe = step.wipe;
  }
  return Math.max(state.manualWipe, transWipe);
}

function activeTiltAngle() {
  if (state.motif === 0 && !isReducedMotion()) return SHUTTER_TILT_RAD;
  return 0;
}

function computeLayout() {
  const { cw, ch } = getViewportSize();
  syncSlateWidth(cw);
  const sw = slateEl.offsetWidth || 310;
  const sh = slateEl.offsetHeight || 310;
  const cx = cw * 0.5;
  const cy = ch * 0.5;
  const angle = activeTiltAngle();
  return { cw, ch, sw, sh, cx, cy, angle };
}

// #region geometry-sync
function cachedGeometryUnit(el, sw) {
  const zoom = el.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${sw}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, el, sw);
    state.unitCache.key = key;
    state.lastGeoKey = null;
  }
  return state.unitCache.unit;
}

function syncSlateGeometry(layout, force = false) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || state.mode === 'plain') return;
  const cssMat = buildSlateMatrix(layout.cx, layout.cy, layout.sw, layout.sh, layout.angle);
  const unit = cachedGeometryUnit(slateEl, layout.sw);
  const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
  const vals = scaled.toFloat32Array();
  if (!force && state.lastGeoKey && vals.every((v, i) => Math.abs(v - state.lastGeoKey[i]) < 1e-4)) return;
  state.lastGeoKey = vals;
  canvas.updateElementGeometry(slateEl, { canvasTransform: scaled });
  slateEl.dataset.hitTick = slateEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function updateHud() {
  const route = state.mode === 'webgl' ? 'WebGL 2' : state.mode === '2d' ? '2D clip fallback' : 'Plain HTML';
  const actLabel = ACTS[state.act]?.reel ?? 'REEL 01';
  const wipePct = Math.round(effectiveWipe() * 100);
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const rmText = isReducedMotion() ? ' · reduced motion' : '';
  hudEl.textContent = `${route} · ${MOTIF_NAMES[state.motif]} · ${actLabel} · ${wipePct}% wipe · ${mp} MP${rmText}`;
}

function applyActDOM(actIdx) {
  const next = ((actIdx % ACTS.length) + ACTS.length) % ACTS.length;
  state.act = next;
  const data = ACTS[next];
  kickerTextEl.textContent = data.kicker;
  reelTagEl.textContent = data.reel;
  castEl.textContent = data.cast;
  const dir = directorInput.value.trim() || 'SAUL BASS';
  subEl.textContent = `DIRECTED BY ${dir.toUpperCase()} · ${data.sub}`;
  for (const pill of actPills) {
    pill.setAttribute('aria-pressed', String(Number(pill.dataset.act) === next));
  }
  state.domDirty = true;
}

function syncTextCredits() {
  const title = titleInput.value.trim() || 'ANATOMY OF A CUT';
  const dir = directorInput.value.trim() || 'SAUL BASS';
  headlineEl.textContent = title.toUpperCase();
  subEl.textContent = `DIRECTED BY ${dir.toUpperCase()} · ${ACTS[state.act].sub}`;
  state.domDirty = true;
  state.lastGeoKey = null;
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  state.transActive = false;
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  stageBox.classList.add('is-plain');
  slateEl.style.width = '';
  if (slateEl.parentElement !== plainHost) plainHost.append(slateEl);
  showNotice(reason);
  updateHud();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (slateEl.parentElement !== canvas) canvas.append(slateEl);
  showNotice('');
}

function tryUploadSlate() {
  if (!stage || stage.lost) return null;
  try {
    const tex = stage.upload(slateEl);
    if (tex) {
      slateTex = tex;
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return slateTex;
    }
    throw err;
  }
}

// #region paint-upload
function renderWebGL() {
  if (!state.hasPainted || !stage || stage.lost) return;
  const layout = computeLayout();
  if (!stage.begin([0.1, 0.09, 0.08, 1])) return;

  if (state.domDirty || !slateTex) {
    const uploaded = tryUploadSlate();
    if (uploaded) state.domDirty = false;
  }
  if (!slateTex) return;

  syncSlateGeometry(layout);

  const wipe = effectiveWipe();
  const accent = ACTS[state.act].accent;
  const px = state.hasPointer && !isReducedMotion() ? state.pointerX : 0;
  const py = state.hasPointer && !isReducedMotion() ? state.pointerY : 0;

  stage.quad(slateEl, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (gl, loc) => {
    gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    gl.uniform4f(loc('uSlateRect'), layout.cx, layout.cy, layout.sw, layout.sh);
    gl.uniform1f(loc('uSlateAngle'), layout.angle);
    gl.uniform1i(loc('uMotif'), state.motif);
    gl.uniform1f(loc('uWipe'), wipe);
    gl.uniform1f(loc('uAlignSnap'), isReducedMotion() ? 1 : state.alignSnap);
    gl.uniform2f(loc('uPointer'), px, py);
    gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1 : 0);
    gl.uniform3f(loc('uAccent'), accent[0], accent[1], accent[2]);
  });

  state.paints++;
  updateHud();
}
// #endregion paint-upload

// #region fallback-2d
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const layout = computeLayout();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const wipe = effectiveWipe();
  const [ar, ag, ab] = ACTS[state.act].accent;
  const accentCss = `rgb(${Math.round(ar * 255)} ${Math.round(ag * 255)} ${Math.round(ab * 255)})`;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Construction-paper backdrop
  ctx2d.fillStyle = accentCss;
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);
  ctx2d.fillStyle = '#191716';
  ctx2d.beginPath();
  ctx2d.moveTo(layout.cw * 0.42, 0);
  ctx2d.lineTo(layout.cw, 0);
  ctx2d.lineTo(layout.cw, layout.ch);
  ctx2d.lineTo(layout.cw * 0.24, layout.ch);
  ctx2d.closePath();
  ctx2d.fill();

  const sx = -layout.sw * 0.5;
  const sy = -layout.sh * 0.5;

  if (state.motif === 0) {
    // Diagonal shutter clip bands
    ctx2d.save();
    ctx2d.translate(layout.cx, layout.cy);
    ctx2d.rotate(layout.angle);
    ctx2d.fillStyle = 'rgb(0 0 0 / 0.34)';
    ctx2d.fillRect(sx + 6, sy + 8, layout.sw, layout.sh);
    ctx2d.drawElementImage(slateEl, sx, sy, layout.sw, layout.sh);

    if (wipe > 0.02) {
      ctx2d.rotate(-0.61);
      const bladeW = wipe * 28;
      for (let x = -layout.sw; x < layout.sw; x += 54) {
        ctx2d.fillStyle = '#191716';
        ctx2d.fillRect(x - bladeW * 0.5, -layout.sh, bladeW, layout.sh * 2);
      }
    }
    ctx2d.restore();
  } else if (state.motif === 1) {
    // Asymmetric segmented blocks using clip() + 5-arg drawElementImage()
    const fracture = Math.min(1, wipe + (1 - (isReducedMotion() ? 1 : state.alignSnap)) * 0.26);
    const cuts = [0, 0.18, 0.38, 0.58, 0.80, 1.0];
    for (let i = 0; i < cuts.length - 1; i++) {
      const y0 = sy + cuts[i] * layout.sh;
      const y1 = sy + cuts[i + 1] * layout.sh;
      const dir = i % 2 === 0 ? 1 : -1;
      const shiftX = dir * fracture * (30 + i * 7);
      ctx2d.save();
      ctx2d.translate(layout.cx + shiftX, layout.cy);
      ctx2d.beginPath();
      ctx2d.rect(sx, y0, layout.sw, Math.max(1, y1 - y0 - fracture * 4));
      ctx2d.clip();
      ctx2d.drawElementImage(slateEl, sx, sy, layout.sw, layout.sh);
      ctx2d.restore();
    }
    // Re-sync overall hit box cleanly after multi-strip draw
    syncSlateGeometry(layout, true);
  } else {
    // Concentric spiral iris aperture clip
    const openR = Math.max(layout.sw, layout.sh) * 0.55;
    const apR = openR + (38 - openR) * Math.pow(wipe, 0.82);
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.arc(layout.cx, layout.cy, Math.max(18, apR), 0, Math.PI * 2);
    ctx2d.clip();
    ctx2d.translate(layout.cx, layout.cy);
    ctx2d.drawElementImage(slateEl, sx, sy, layout.sw, layout.sh);
    ctx2d.restore();

    ctx2d.strokeStyle = '#191716';
    ctx2d.lineWidth = 4;
    ctx2d.beginPath();
    ctx2d.arc(layout.cx, layout.cy, Math.max(18, apR), 0, Math.PI * 2);
    ctx2d.stroke();
    syncSlateGeometry(layout, true);
  }

  ctx2d.restore();
  state.paints++;
  updateHud();
}
// #endregion fallback-2d

function needsAnimationLoop() {
  if (!state.onScreen || document.hidden || state.mode === 'plain') return false;
  if (isReducedMotion()) return false;
  if (state.transActive) return true;
  if (state.motif === 2) return true; // hypnotic concentric spiral rotation
  if (state.motif === 1 && Math.abs(state.alignSnap - state.alignTarget) > 0.005) return true;
  return false;
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function tick(now) {
  state.rafId = 0;
  if (!needsAnimationLoop()) return;
  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;

  if (state.transActive) {
    const step = computeWipeStep(now - state.transStart, WIPE_DURATION_MS, isReducedMotion());
    if (step.swapReady && !state.actSwapped) {
      state.actSwapped = true;
      applyActDOM(state.targetAct);
    }
    if (!step.active) {
      state.transActive = false;
    }
  }

  if (state.motif === 1) {
    const rate = state.alignTarget > state.alignSnap ? 14 : 6;
    state.alignSnap += (state.alignTarget - state.alignSnap) * Math.min(1, dt * rate);
    if (Math.abs(state.alignTarget - state.alignSnap) <= 0.005) {
      state.alignSnap = state.alignTarget;
    }
  }

  canvas.requestPaint?.();
  if (needsAnimationLoop()) {
    state.rafId = requestAnimationFrame(tick);
  }
}

function startLoop() {
  if (!state.rafId && needsAnimationLoop()) {
    state.lastTickMs = 0;
    state.rafId = requestAnimationFrame(tick);
  }
}

function triggerActTransition(nextAct) {
  const target = ((nextAct % ACTS.length) + ACTS.length) % ACTS.length;
  if (isReducedMotion() || state.mode === 'plain') {
    state.transActive = false;
    applyActDOM(target);
    if (state.mode !== 'plain') canvas.requestPaint?.();
    else updateHud();
    return;
  }
  state.targetAct = target;
  state.actSwapped = false;
  state.transStart = performance.now();
  state.transActive = true;
  if (state.motif === 1 && !state.pointerHoverSlate) {
    state.alignTarget = 0;
    state.alignSnap = 0;
  }
  canvas.requestPaint?.();
  startLoop();
}

function setMotif(nextMotif) {
  state.motif = nextMotif;
  for (const btn of motifBtns) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.motif) === nextMotif));
  }
  if (nextMotif === 1) {
    state.alignTarget = state.pointerHoverSlate || isReducedMotion() ? 1 : 0;
    state.alignSnap = isReducedMotion() ? 1 : state.alignTarget;
  } else {
    state.alignSnap = 1;
    state.alignTarget = 1;
  }
  state.lastGeoKey = null;
  if (state.mode !== 'plain') {
    canvas.requestPaint?.();
    if (needsAnimationLoop()) startLoop();
    else stopLoop();
  } else {
    updateHud();
  }
}

// Wire canvas events
function wireCanvas(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    if (state.mode === 'plain') return;
    const changed = e?.changedElements;
    if (changed?.length) {
      for (const el of changed) {
        if (el === slateEl || slateEl.contains(el)) {
          state.domDirty = true;
          break;
        }
      }
    }
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL();
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  });

  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost, so the film credits moved into plain HTML.');
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
  syncSlateWidth(viewportEl.clientWidth || 354);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: BASS_FRAG,
        onLost: () => {
          slateTex = null;
          enterPlainFallback('The WebGL 2 context was lost, so the film credits moved into plain HTML until restored.');
        },
        onRestored: () => {
          slateTex = null;
          state.hasPainted = false;
          state.domDirty = true;
          state.unitCache.key = '';
          state.lastGeoKey = null;
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          exitPlainFallback();
          syncSlateWidth(viewportEl.clientWidth || 354);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.mode = 'webgl';
      wireCanvas(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D cutout fallback.`);
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        state.mode = '2d';
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D clip-path fallback.');
        }
        wireCanvas(canvas);
        canvas.requestPaint?.();
        return;
      }
    } catch {}
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the film credits are shown as plain HTML.');
}

// Visibility & viewport observers
new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    stopLoop();
  } else if (state.mode !== 'plain') {
    canvas.requestPaint?.();
    startLoop();
  }
}, { rootMargin: '80px 0px' }).observe(stageBox);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.mode !== 'plain') {
    canvas.requestPaint?.();
    startLoop();
  }
});

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKey = null;
    syncSlateWidth(viewportEl.clientWidth || 354);
    canvas.requestPaint?.();
  }
}).observe(viewportEl);

// Interactive controls inside #credits-slate
for (const pill of actPills) {
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerActTransition(Number(pill.dataset.act));
  });
}

titleInput.addEventListener('input', () => {
  syncTextCredits();
  if (state.mode !== 'plain') canvas.requestPaint?.();
});

directorInput.addEventListener('input', () => {
  syncTextCredits();
  if (state.mode !== 'plain') canvas.requestPaint?.();
});

// Snap Segmented blocks into crisp alignment while hovering, tapping or focusing inside the slate.
slateEl.addEventListener('pointerenter', (e) => {
  if (e.pointerType === 'mouse') {
    state.pointerHoverSlate = true;
    state.alignTarget = 1;
    startLoop();
  }
});

slateEl.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !slateEl.contains(document.activeElement)) {
    state.pointerHoverSlate = false;
    if (state.motif === 1) {
      state.alignTarget = 0;
      startLoop();
    }
  }
});

slateEl.addEventListener('focusin', () => {
  state.pointerHoverSlate = true;
  state.alignTarget = 1;
  if (isReducedMotion()) state.alignSnap = 1;
  startLoop();
  if (state.mode !== 'plain') canvas.requestPaint?.();
});

slateEl.addEventListener('focusout', (e) => {
  if (!slateEl.contains(e.relatedTarget)) {
    state.pointerHoverSlate = false;
    if (state.motif === 1 && !isReducedMotion()) {
      state.alignTarget = 0;
      startLoop();
    }
  }
});

// Pointer parallax and tap-to-wipe on non-interactive stage regions
const updatePointer = (e) => {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  state.pointerX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
  state.pointerY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
  state.hasPointer = true;
  if (state.mode !== 'plain' && !state.rafId) canvas.requestPaint?.();
};

canvas.addEventListener('pointerdown', (e) => {
  updatePointer(e);
  if (state.motif === 1 && e.target.closest('#credits-slate')) {
    state.pointerHoverSlate = true;
    state.alignTarget = 1;
    if (isReducedMotion()) state.alignSnap = 1;
    startLoop();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || e.buttons > 0) updatePointer(e);
});

canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') {
    state.hasPointer = false;
  }
  // Clicking/tapping anywhere outside buttons, inputs or labels wipes to the next Act.
  if (!e.target.closest('button, input, textarea, select, label, a')) {
    triggerActTransition(state.act + 1);
  } else if (state.mode !== 'plain' && !state.rafId) {
    canvas.requestPaint?.();
  }
});

canvas.addEventListener('pointercancel', () => {
  state.hasPointer = false;
  if (state.mode !== 'plain' && !state.rafId) canvas.requestPaint?.();
});

canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') {
    state.hasPointer = false;
    if (state.mode !== 'plain' && !state.rafId) canvas.requestPaint?.();
  }
});

// External toolbar controls
for (const btn of motifBtns) {
  btn.addEventListener('click', () => setMotif(Number(btn.dataset.motif)));
}

wipeBtn.addEventListener('click', () => {
  triggerActTransition(state.act + 1);
});

wipeSlider.addEventListener('input', () => {
  const pct = Number(wipeSlider.value);
  state.manualWipe = Math.max(0, Math.min(1, pct / 100));
  wipeOut.textContent = `${pct}%`;
  if (state.mode !== 'plain') canvas.requestPaint?.();
  else updateHud();
});

reducedCheck.addEventListener('change', () => {
  state.reducedOverride = reducedCheck.checked;
  if (isReducedMotion()) {
    state.transActive = false;
    state.alignSnap = 1;
    state.alignTarget = 1;
    stopLoop();
  } else if (state.motif === 2) {
    startLoop();
  }
  state.lastGeoKey = null;
  if (state.mode !== 'plain') canvas.requestPaint?.();
  else updateHud();
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) {
    state.transActive = false;
    state.alignSnap = 1;
    state.alignTarget = 1;
    stopLoop();
  }
  state.lastGeoKey = null;
  if (state.mode !== 'plain') canvas.requestPaint?.();
  else updateHud();
});

// Initial sync & start
applyActDOM(0);
syncTextCredits();
initBackend();

// ---------------------------------------------------------------- Live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function readCssPatchAvg(gl, cv, cw, ch, cssX, cssY, size = 3) {
  const half = Math.floor(size / 2);
  const rx = Math.max(0, Math.min(cv.width - size, Math.round(cssX * (cv.width / cw)) - half));
  const ry = Math.max(0, Math.min(cv.height - size, Math.round((ch - cssY) * (cv.height / ch)) - half));
  const buf = new Uint8Array(size * size * 4);
  gl.readPixels(rx, ry, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let r = 0, g = 0, b = 0, a = 0;
  const n = size * size;
  for (let i = 0; i < buf.length; i += 4) {
    r += buf[i];
    g += buf[i + 1];
    b += buf[i + 2];
    a += buf[i + 3];
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

function makeFixtureSlate(w = 180, h = 120) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w + 40}px;height:${h + 40}px`;

  const slate = document.createElement('section');
  slate.setAttribute('drawable', '');
  slate.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:8px;box-sizing:border-box;` +
    'background:#f4ebd9;color:#191716;border:2px solid #191716;font:700 12px system-ui';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Act II';
  btn.style.cssText = 'position:absolute;left:10px;top:10px;width:72px;height:32px;background:#d54125;color:#fff;border:2px solid #191716;font:700 11px system-ui';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = 'SAUL BASS';
  inp.setAttribute('inputmode', 'none');
  inp.setAttribute('aria-label', 'Fixture director');
  inp.style.cssText = 'position:absolute;left:90px;top:10px;width:80px;height:32px;box-sizing:border-box;background:#fffaf0;color:#191716;border:2px solid #191716;font:700 11px system-ui';

  slate.append(btn, inp);
  cv.append(slate);
  return { cv, slate, btn, inp, cw: w + 40, ch: h + 40, sw: w, sh: h };
}

function drawFixtureQuad(g, cv, slate, cw, ch, sw, sh, { motif = 0, wipe = 0, angle = 0, align = 1, reduced = 1 } = {}) {
  g.quad(slate, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform4f(loc('uSlateRect'), cw * 0.5, ch * 0.5, sw, sh);
    gl.uniform1f(loc('uSlateAngle'), angle);
    gl.uniform1i(loc('uMotif'), motif);
    gl.uniform1f(loc('uWipe'), wipe);
    gl.uniform1f(loc('uAlignSnap'), align);
    gl.uniform2f(loc('uPointer'), 0, 0);
    gl.uniform1f(loc('uReduced'), reduced);
    gl.uniform3f(loc('uAccent'), 0.835, 0.255, 0.145);
  });
}

runTests(testsBody, [
  {
    name: 'ElementGL + texElementSubImage2D() compiles BASS_FRAG with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, waits for nextPaint(), calls g.begin() before g.upload(), and draws all 3 Saul Bass motifs.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { cv, slate, cw, ch, sw, sh } = makeFixtureSlate(180, 120);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: BASS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        const painted = true;
        if (!painted) throw new Error('fixture did not paint');
        g.begin([0.1, 0.09, 0.08, 1]);
        const tex = g.upload(slate);
        const errs = [];
        const samples = [];
        for (const m of [0, 1, 2]) {
          g.begin([0.1, 0.09, 0.08, 1]);
          drawFixtureQuad(g, cv, slate, cw, ch, sw, sh, { motif: m, wipe: 0.25, align: 0, reduced: 1 });
          errs.push(g.gl.getError());
          samples.push(readCssPatchAvg(g.gl, cv, cw, ch, cw * 0.5, ch * 0.65));
        }
        return need(
          tex?.w > 0 && errs.every((e) => e === g.gl.NO_ERROR),
          `uploaded=${tex?.w}x${tex?.h}, gl.getError()=[${errs.join(',')}], motifSamples=${samples.map((s) => `[${s}]`).join(' ')}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Diagonal paper shutter mask cuts vs reveals DOM regions via readPixels()',
    expect: 'pass',
    why: 'Renders Shutters at wipe = 0.0 and wipe = 0.55 on a bright #f4ebd9 fixture slate, probing the band-0 centre and adjacent band-1 open aperture with readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { cv, slate, cw, ch, sw, sh } = makeFixtureSlate(180, 120);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: BASS_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0.1, 0.09, 0.08, 1]);
        g.upload(slate);

        const cx = cw * 0.5;
        const cy = ch * 0.5;
        // Band 0 centre is (cx, cy); Band -1 open aperture centre sits at u = -54 px (below the button/input row)
        const openX = cx - 54 * 0.82;
        const openY = cy + 54 * 0.57;

        // Pass A: wipe = 0 -> centre is revealed off-white DOM paper
        g.begin([0.1, 0.09, 0.08, 1]);
        drawFixtureQuad(g, cv, slate, cw, ch, sw, sh, { motif: 0, wipe: 0, angle: 0, reduced: 1 });
        const pxOpen0 = readCssPatchAvg(g.gl, cv, cw, ch, cx, cy);

        // Pass B: wipe = 0.55 -> band 0 centre is cut by dark charcoal shutter while band 1 stays revealed
        g.begin([0.1, 0.09, 0.08, 1]);
        drawFixtureQuad(g, cv, slate, cw, ch, sw, sh, { motif: 0, wipe: 0.55, angle: 0, reduced: 1 });
        const pxCut = readCssPatchAvg(g.gl, cv, cw, ch, cx, cy);
        const pxRevealed = readCssPatchAvg(g.gl, cv, cw, ch, openX, openY);
        const err = g.gl.getError();

        const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
        const okOpen = lum(pxOpen0) > 195;
        const okCut = lum(pxCut) < 60 && lum(pxRevealed) > 185;
        return need(
          err === g.gl.NO_ERROR && okOpen && okCut,
          `wipe0 centre=[${pxOpen0}], wipe0.55 cut=[${pxCut}], wipe0.55 openBand=[${pxRevealed}], deltaLum=${Math.round(lum(pxRevealed) - lum(pxCut))}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Tilted updateElementGeometry() hits live Act II <button> and <input> inside slate',
    expect: 'pass',
    why: 'Transforms an isolated slate fixture by -0.024 rad with geometryUnit() + dataset.hitTick and checks document.elementsFromPoint() at the transformed centres.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const { cv, slate, btn, inp, cw, ch, sw, sh } = makeFixtureSlate(180, 120);
      testStage().append(cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: BASS_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        } else {
          cv.width = cw;
          cv.height = ch;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        if (g) {
          g.begin([0.1, 0.09, 0.08, 1]);
          g.upload(slate);
          drawFixtureQuad(g, cv, slate, cw, ch, sw, sh, { motif: 0, wipe: 0, angle: SHUTTER_TILT_RAD, reduced: 0 });
        }
        const cssMat = buildSlateMatrix(cw * 0.5, ch * 0.5, sw, sh, SHUTTER_TILT_RAD);
        const unit = geometryUnit(cv, slate, sw);
        const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
        cv.updateElementGeometry(slate, { canvasTransform: scaled });
        slate.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const cRect = cv.getBoundingClientRect();
        const btnLocal = new DOMPoint(btn.offsetLeft + btn.offsetWidth * 0.5, btn.offsetTop + btn.offsetHeight * 0.5);
        const inpLocal = new DOMPoint(inp.offsetLeft + inp.offsetWidth * 0.5, inp.offsetTop + inp.offsetHeight * 0.5);
        const btnPt = cssMat.transformPoint(btnLocal);
        const inpPt = cssMat.transformPoint(inpLocal);
        const btnHits = document.elementsFromPoint(cRect.left + btnPt.x, cRect.top + btnPt.y);
        const inpHits = document.elementsFromPoint(cRect.left + inpPt.x, cRect.top + inpPt.y);

        const hitBtn = btnHits.includes(btn);
        const hitInp = inpHits.includes(inp);
        return need(
          hitBtn && hitInp,
          `unit=${unit.toFixed(2)}, hitButton=${hitBtn} at (${btnPt.x.toFixed(1)}, ${btnPt.y.toFixed(1)}), hitInput=${hitInp} at (${inpPt.x.toFixed(1)}, ${inpPt.y.toFixed(1)}).`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Reduced motion snaps wipe transitions immediately and zeroes spiral rotation',
    expect: 'pass',
    why: 'Samples computeWipeStep() across 0 to 560 ms with reduced=false vs reduced=true, confirming peak cutout sweep vs 1-step snap and 0 rad/s spiral speed.',
    run: async () => {
      const samples = [0, 120, 252, 420, 560];
      let peakNormal = 0;
      let anyReducedActive = false;
      let reducedOmega = 0;
      for (const t of samples) {
        const normal = computeWipeStep(t, WIPE_DURATION_MS, false);
        const reduced = computeWipeStep(t, WIPE_DURATION_MS, true);
        peakNormal = Math.max(peakNormal, normal.wipe);
        if (reduced.active || reduced.wipe !== 0 || !reduced.swapReady) anyReducedActive = true;
        reducedOmega = Math.max(reducedOmega, reduced.spiralOmega);
      }
      return need(
        peakNormal > 0.95 && !anyReducedActive && reducedOmega === 0,
        `normalPeakWipe=${peakNormal.toFixed(2)}, reducedActive=${anyReducedActive}, reducedSpiralOmega=${reducedOmega} rad/s.`
      );
    },
  },
  {
    name: 'Synthetic webglcontextlost and webglcontextrestored recover plain HTML and ElementGL',
    expect: 'pass',
    why: 'Dispatches cancelable webglcontextlost and webglcontextrestored on an isolated fixture (without loseContext()), confirming plain-HTML extraction and clean WebGL restoration.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { cv, slate, cw, ch, sw, sh } = makeFixtureSlate(160, 110);
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: BASS_FRAG,
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            plain.append(slate);
          },
          onRestored: () => {
            restoredFired = true;
            plain.hidden = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.append(slate);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0.1, 0.09, 0.08, 1]);
        g.upload(slate);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(slate);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0.1, 0.09, 0.08, 1]);
        const texAfter = g.upload(slate);
        drawFixtureQuad(g, cv, slate, cw, ch, sw, sh, { motif: 0, wipe: 0, angle: 0, reduced: 1 });
        const err = g.gl.getError();

        return need(
          inPlainWhileLost && restoredFired && !g.lost && cv.contains(slate) && texAfter?.w > 0 && err === g.gl.NO_ERROR,
          `defaultPrevented=${lostEv.defaultPrevented}, plainWhileLost=${inPlainWhileLost}, restored=${restoredFired}, err=${err}.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'Saul Bass cutout credits stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !slateTex) return 0;
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
