import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);

const pressStage = $('press-stage');
const pressViewport = $('press-viewport');
const canvas = $('riso-canvas');
const posterCard = $('poster-card');
const plainHost = $('plain-host');
const stageHud = $('stage-hud');
const routeNoteEl = $('route-note');

// Poster DOM controls
const posterTitle = $('poster-title');
const posterEdition = $('poster-edition');
const posterRun = $('poster-run');
const posterRunOut = $('poster-run-out');
const posterStamp = $('poster-stamp');
const posterSpec = $('poster-spec');
const artRunBadge = $('art-run-badge');
const artLayers = {
  magenta: $('art-magenta'),
  cyan: $('art-cyan'),
  yellow: $('art-yellow'),
};
const spotBtns = [...document.querySelectorAll('.spot-toggle')];

// Press toolbar controls
const paletteBtns = [...document.querySelectorAll('[data-palette]')];
const drumChecks = [0, 1, 2].map((i) => $('drum-on-' + i));
const drumWraps = [0, 1, 2].map((i) => $('drum-wrap-' + i));
const drumDots = [0, 1, 2].map((i) => $('drum-dot-' + i));
const drumLabels = [0, 1, 2].map((i) => $('drum-label-' + i));
const dialA = $('dial-a');
const dialAOut = $('dial-a-out');
const dialB = $('dial-b');
const dialBOut = $('dial-b-out');
const btnJostle = $('btn-jostle');
const btnZero = $('btn-zero');
const ctlStreaks = $('ctl-streaks');

const CARD_W = 310;
const CARD_H = 410;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const PALETTES = {
  indie: {
    mode: 0,
    label: '3-Ink Indie Zine',
    drums: [
      { name: 'Fluo Pink', hex: '#ff48b0', rgb: [1.0, 0.282, 0.69] },
      { name: 'Med Blue', hex: '#0078bf', rgb: [0.0, 0.471, 0.749] },
      { name: 'Yellow', hex: '#ffb511', rgb: [1.0, 0.71, 0.067] },
    ],
  },
  classic: {
    mode: 1,
    label: '2-Ink Classic Zine',
    drums: [
      { name: 'Scarlet Red', hex: '#f15060', rgb: [0.945, 0.314, 0.376] },
      { name: 'Federal Blue', hex: '#3d5588', rgb: [0.239, 0.333, 0.533] },
      { name: 'No 3rd drum', hex: '#b8b2a6', rgb: [1.0, 1.0, 1.0], disabled: true },
    ],
  },
  acid: {
    mode: 2,
    label: 'Acid Zine',
    drums: [
      { name: 'Fluo Orange', hex: '#ff6c2f', rgb: [1.0, 0.424, 0.184] },
      { name: 'Mint', hex: '#82d8d5', rgb: [0.51, 0.847, 0.835] },
      { name: 'Violet', hex: '#765ba7', rgb: [0.463, 0.357, 0.655] },
    ],
  },
};

// #region riso-shader
const RISO_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform vec4 uPaperRect;
uniform vec4 uCardRect;
uniform vec3 uDrumColor[3];
uniform vec3 uDrumPos[3];
uniform float uDrumEnabled[3];
uniform int uPaletteMode;
uniform float uGrainAmount;
uniform float uRollerStreak;
uniform float uShowMarks;

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

float paperTooth(vec2 paperPx) {
  float coarse = valueNoise(paperPx * 0.42);
  float fine = valueNoise(paperPx * 1.45 + 17.3);
  float fibreA = valueNoise(vec2(paperPx.x * 0.16 + paperPx.y * 0.05, paperPx.y * 1.15) + 41.0);
  float fibreB = valueNoise(vec2(paperPx.x * 0.95, paperPx.y * 0.14 - paperPx.x * 0.05) + 89.0);
  float fibres = mix(fibreA, fibreB, 0.5) - 0.5;
  return (coarse * 0.45 + fine * 0.55 - 0.5) * 0.9 + fibres * 0.7;
}

float risoScreen(vec2 platePx, float angle, float seed) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 rp = vec2(platePx.x * c - platePx.y * s, platePx.x * s + platePx.y * c);
  vec2 cell = floor(rp * 0.92);
  vec2 f = fract(rp * 0.92) - 0.5;
  float rnd = hash12(cell + seed * 37.0);
  float ig = fract(52.9829189 * fract(dot(rp, vec2(0.06711056, 0.00583715))));
  float radial = 1.0 - clamp(length(f) * 1.4142, 0.0, 1.0);
  return clamp(mix(rnd, ig, 0.45) * 0.72 + radial * 0.28, 0.02, 0.98);
}

float plateSeparation(vec2 cardUv, int drumIdx, out float alpha) {
  if (cardUv.x < 0.0 || cardUv.x > 1.0 || cardUv.y < 0.0 || cardUv.y > 1.0) {
    alpha = 0.0;
    return 0.0;
  }
  vec4 texel = texture(uTex, cardUv);
  alpha = texel.a;
  if (alpha <= 0.004) return 0.0;
  vec3 dom = clamp(texel.rgb / alpha, 0.0, 1.0);
  vec3 cmy = 1.0 - dom;
  float k = min(cmy.r, min(cmy.g, cmy.b));
  vec3 chr = cmy - vec3(k);
  float cov = 0.0;
  if (uPaletteMode == 0) {
    if (drumIdx == 0) cov = chr.g + 0.80 * k;
    else if (drumIdx == 1) cov = chr.r + 0.86 * k;
    else cov = chr.b + 0.42 * k;
  } else if (uPaletteMode == 1) {
    if (drumIdx == 0) cov = max(chr.g, chr.b * 0.85) + 0.85 * k;
    else if (drumIdx == 1) cov = chr.r + 0.25 * chr.g + 0.92 * k;
    else cov = 0.0;
  } else {
    if (drumIdx == 0) cov = chr.b * 0.96 + 0.25 * chr.g + 0.45 * k;
    else if (drumIdx == 1) cov = chr.r * 0.96 + 0.35 * k;
    else cov = chr.g * 0.96 + 0.94 * k;
  }
  return clamp(cov, 0.0, 1.0) * alpha;
}

float crosshairMark(vec2 p, vec2 centre) {
  vec2 d = abs(p - centre);
  float arm = step(max(d.x, d.y), 6.0) * step(min(d.x, d.y), 0.75);
  float ring = (1.0 - smoothstep(0.6, 1.4, abs(length(p - centre) - 3.6))) * 0.9;
  return max(arm, ring);
}

float marginMarks(vec2 platePaperPx, vec2 paperSize, vec2 cardRelOrigin, vec2 cardSize, int drumIdx) {
  if (uShowMarks < 0.5) return 0.0;
  float m = 0.0;
  // Four registration crosshairs in the paper corners (all drums print these so drift shows clearly)
  float inset = 11.0;
  m = max(m, crosshairMark(platePaperPx, vec2(inset, inset)));
  m = max(m, crosshairMark(platePaperPx, vec2(paperSize.x - inset, inset)));
  m = max(m, crosshairMark(platePaperPx, vec2(inset, paperSize.y - inset)));
  m = max(m, crosshairMark(platePaperPx, vec2(paperSize.x - inset, paperSize.y - inset)));

  // Calibration ink swatch (solid + 45% tint) per drum along top margin when space permits
  if (cardRelOrigin.y >= 18.0) {
    float sx = 28.0 + float(drumIdx) * 26.0;
    float sy = 5.0;
    if (platePaperPx.x >= sx && platePaperPx.x <= sx + 10.0 && platePaperPx.y >= sy && platePaperPx.y <= sy + 9.0) {
      m = max(m, 0.95);
    }
    if (platePaperPx.x >= sx + 11.0 && platePaperPx.x <= sx + 21.0 && platePaperPx.y >= sy && platePaperPx.y <= sy + 9.0) {
      m = max(m, 0.45);
    }
  }
  return m;
}

void main() {
  vec2 cssPos = vUv * uCanvasSize;
  vec2 paperPx = cssPos - uPaperRect.xy;
  vec2 paperUv = paperPx / max(uPaperRect.zw, vec2(1.0));

  // Cutting-mat backdrop outside the paper sheet
  if (paperUv.x < 0.0 || paperUv.x > 1.0 || paperUv.y < 0.0 || paperUv.y > 1.0) {
    vec2 g = abs(fract(cssPos / 24.0 - 0.5) - 0.5) / max(fwidth(cssPos / 24.0), vec2(0.001));
    float grid = 1.0 - min(min(g.x, g.y), 1.0);
    vec3 matCol = vec3(0.145, 0.135, 0.125) + vec3(0.03) * grid;
    vec2 distOut = max(max(uPaperRect.xy - cssPos, cssPos - (uPaperRect.xy + uPaperRect.zw)), vec2(0.0));
    float shadow = exp(-length(distOut) * 0.14);
    matCol *= 1.0 - 0.35 * shadow;
    outColor = vec4(matCol, 1.0);
    return;
  }

  float tooth = paperTooth(paperPx);
  vec3 paperCol = vec3(0.961, 0.941, 0.882) * (1.0 + 0.048 * tooth);
  // Subtle deckle edge darken
  float edgeDist = min(min(paperPx.x, uPaperRect.z - paperPx.x), min(paperPx.y, uPaperRect.w - paperPx.y));
  paperCol *= mix(0.92, 1.0, smoothstep(0.0, 3.0, edgeDist));

  vec2 cardCenter = uCardRect.xy + uCardRect.zw * 0.5;
  vec2 cardRelOrigin = uCardRect.xy - uPaperRect.xy;
  vec3 result = paperCol;

  float angles[3];
  angles[0] = 0.261799; // 15 deg
  angles[1] = 1.308997; // 75 deg
  angles[2] = 0.785398; // 45 deg

  for (int i = 0; i < 3; i++) {
    if (uDrumEnabled[i] < 0.5) continue;

    vec2 shifted = cssPos - uDrumPos[i].xy;
    vec2 rel = shifted - cardCenter;
    float ca = cos(-uDrumPos[i].z);
    float sa = sin(-uDrumPos[i].z);
    vec2 rotRel = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
    vec2 plateCardPx = rotRel + uCardRect.zw * 0.5;
    vec2 plateUv = plateCardPx / max(uCardRect.zw, vec2(1.0));
    vec2 platePaperPx = rotRel + cardCenter - uPaperRect.xy;

    float alpha = 0.0;
    float cov = plateSeparation(plateUv, i, alpha);
    float markCov = marginMarks(platePaperPx, uPaperRect.zw, cardRelOrigin, uCardRect.zw, i);
    cov = max(cov, markCov);

    // Optional drum roller track smudge & feed-edge streak
    if (uRollerStreak > 0.5) {
      float laneA = exp(-pow((platePaperPx.x - uPaperRect.z * 0.22) / 8.5, 2.0));
      float laneB = exp(-pow((platePaperPx.x - uPaperRect.z * 0.78) / 8.5, 2.0));
      float treads = step(0.1, sin(platePaperPx.y * 1.45));
      float edgeBand = (1.0 - smoothstep(0.0, 18.0, platePaperPx.y)) + (1.0 - smoothstep(0.0, 18.0, uPaperRect.w - platePaperPx.y));
      float track = (laneA + laneB) * clamp(edgeBand, 0.0, 1.0) * treads * 0.42;
      float streakMod = (valueNoise(vec2(platePaperPx.x * 0.75 + float(i) * 19.0, 3.0)) - 0.5) * 0.18;
      cov = clamp(cov * (1.0 + streakMod) + track * (i == 0 ? 0.92 : 0.48), 0.0, 1.0);
    }

    if (cov > 0.004) {
      float grain = risoScreen(platePaperPx, angles[i], float(i + 1));
      float dotMask = smoothstep(grain - 0.13, grain + 0.13, cov * 1.05);
      float textured = mix(dotMask, cov, 0.30);
      float inkAmt = mix(cov, textured, uGrainAmount);
      // Keep crisp high-density text/rules saturated while midtones show full stipple
      inkAmt = mix(inkAmt, cov, smoothstep(0.86, 0.98, cov) * 0.78);
      float absorb = clamp(inkAmt * (0.94 + 0.07 * tooth), 0.0, 1.06);
      vec3 ink = max(uDrumColor[i], vec3(0.045));
      result *= pow(ink, vec3(absorb));
    }
  }

  outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;
// #endregion riso-shader

const state = {
  palette: 'indie',
  drumOn: [true, true, true],
  dialA: 1.0,
  dialB: -1.0,
  streaks: true,
  impressions: 1,
  runCount: 75,
  spotSolid: { magenta: true, cyan: true, yellow: true },
  mode: 'init',
  onScreen: true,
  lastGeoKey: '',
  hitTick: 0,
  domDirty: true,
  dragOffset: [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
  springPos: [
    { x: 0, y: 0, a: 0 },
    { x: 0, y: 0, a: 0 },
    { x: 0, y: 0, a: 0 },
  ],
  springVel: [
    { x: 0, y: 0, a: 0 },
    { x: 0, y: 0, a: 0 },
    { x: 0, y: 0, a: 0 },
  ],
};

let stage = null;
let ctx2d = null;
let lastTex = null;
let animRaf = 0;
let lastAnimTime = 0;

function activePalette() {
  return PALETTES[state.palette] ?? PALETTES.indie;
}

function targetDrumPos(i) {
  if (i === 0) {
    return {
      x: state.dialA + state.dragOffset[0].x,
      y: -state.dialA * 0.45 + state.dragOffset[0].y,
      a: state.dialA * 0.0012,
    };
  }
  if (i === 1) {
    return {
      x: state.dialB + state.dragOffset[1].x,
      y: -state.dialB * 0.65 + state.dragOffset[1].y,
      a: state.dialB * 0.0014,
    };
  }
  return {
    x: (state.dialA - state.dialB) * 0.35 + state.dragOffset[2].x,
    y: (state.dialA + state.dialB) * 0.45 + state.dragOffset[2].y,
    a: -(state.dialA + state.dialB) * 0.001,
  };
}

function currentDrumPos(i) {
  const t = targetDrumPos(i);
  const s = state.springPos[i];
  return {
    x: t.x + s.x,
    y: t.y + s.y,
    a: t.a + s.a,
  };
}

function computeLayout() {
  const cw = canvas.clientWidth || pressViewport.clientWidth || 380;
  const ch = canvas.clientHeight || pressViewport.clientHeight || 486;
  const paperW = cw <= 500 ? Math.max(240, cw - 12) : Math.min(cw - 48, 520);
  const paperH = Math.max(300, ch - 20);
  const paperX = Math.round((cw - paperW) * 0.5);
  const paperY = Math.round((ch - paperH) * 0.5);
  const cardScale = Math.min(1, (paperW - 22) / CARD_W, (paperH - 36) / CARD_H);
  const cardW = CARD_W * cardScale;
  const cardH = CARD_H * cardScale;
  const cardX = Math.round((cw - cardW) * 0.5);
  const cardY = Math.round((ch - cardH) * 0.5);
  return { cw, ch, paperX, paperY, paperW, paperH, cardX, cardY, cardW, cardH, cardScale };
}

function syncHitGeometry(layout, force = false) {
  if (state.mode !== 'webgl' || !('updateElementGeometry' in canvas)) return;
  const pal = activePalette();
  const enabledIndices = [0, 1, 2].filter((i) => !pal.drums[i].disabled && state.drumOn[i]);
  let ox = 0;
  let oy = 0;
  let ang = 0;
  if (enabledIndices.length === 1) {
    const p = currentDrumPos(enabledIndices[0]);
    ox = p.x;
    oy = p.y;
    ang = p.a;
  }
  const key = `${layout.cw}x${layout.ch}/${layout.cardX.toFixed(1)},${layout.cardY.toFixed(1)},${layout.cardScale.toFixed(3)}/${ox.toFixed(2)},${oy.toFixed(2)},${ang.toFixed(4)}`;
  if (!force && key === state.lastGeoKey) return;
  state.lastGeoKey = key;
  const unit = geometryUnit(canvas, posterCard, CARD_W);
  const cx = layout.cardW * 0.5;
  const cy = layout.cardH * 0.5;
  const local = new DOMMatrix()
    .translate(layout.cardX + ox + cx, layout.cardY + oy + cy)
    .rotate((ang * 180) / Math.PI)
    .translate(-cx, -cy)
    .scale(layout.cardScale, layout.cardScale);
  const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(local);
  canvas.updateElementGeometry(posterCard, { canvasTransform: scaled });
  posterCard.dataset.hitTick = String((++state.hitTick) & 1);
}

function updateHud() {
  if (state.mode === 'plain') {
    stageHud.textContent = 'plain HTML fallback';
    return;
  }
  const pal = activePalette();
  const activeCount = [0, 1, 2].filter((i) => !pal.drums[i].disabled && state.drumOn[i]).length;
  const d0 = currentDrumPos(0);
  const d1 = currentDrumPos(1);
  const route = state.mode === 'webgl' ? 'WebGL 2 ElementGL' : '2D fallback';
  const motion = reducedMotion.matches ? ' · reduced motion' : '';
  stageHud.textContent = `${route} · ${pal.label} (${activeCount} active) · A(${d0.x >= 0 ? '+' : ''}${d0.x.toFixed(1)},${d0.y >= 0 ? '+' : ''}${d0.y.toFixed(1)}) B(${d1.x >= 0 ? '+' : ''}${d1.x.toFixed(1)},${d1.y >= 0 ? '+' : ''}${d1.y.toFixed(1)})${motion}`;
}

// #region spring-physics
let kickCount = 0;

function springActive() {
  for (let i = 0; i < 3; i++) {
    const p = state.springPos[i];
    const v = state.springVel[i];
    if (
      Math.abs(p.x) > 0.04 || Math.abs(p.y) > 0.04 || Math.abs(p.a) > 0.0005 ||
      Math.abs(v.x) > 0.15 || Math.abs(v.y) > 0.15 || Math.abs(v.a) > 0.003
    ) {
      return true;
    }
  }
  return false;
}

function kickDrums(strength = 1.0) {
  if (reducedMotion.matches) {
    updateHud();
    requestDraw(false);
    return;
  }
  kickCount++;
  const flip = kickCount % 2 === 0 ? 1 : -1;
  const kicks = [
    { x: -5.6 * flip, y: -2.8, a: -0.011 * flip },
    { x: 6.4 * flip, y: 3.4, a: 0.013 * flip },
    { x: -2.2 * flip, y: -5.8 * flip, a: -0.009 * flip },
  ];
  for (let i = 0; i < 3; i++) {
    state.springPos[i].x += kicks[i].x * strength * 0.55;
    state.springPos[i].y += kicks[i].y * strength * 0.55;
    state.springPos[i].a += kicks[i].a * strength * 0.55;
    state.springVel[i].x += kicks[i].x * strength * 5.2;
    state.springVel[i].y += kicks[i].y * strength * 5.2;
    state.springVel[i].a += kicks[i].a * strength * 5.2;
  }
  scheduleSpring();
}

function scheduleSpring() {
  if (animRaf || reducedMotion.matches || !state.onScreen || document.hidden || state.mode === 'plain') return;
  if (!springActive()) return;
  lastAnimTime = performance.now();
  animRaf = requestAnimationFrame(stepSpring);
}

function stopSpring() {
  if (!animRaf) return;
  cancelAnimationFrame(animRaf);
  animRaf = 0;
}

function stepSpring(now) {
  animRaf = 0;
  if (!state.onScreen || document.hidden || state.mode === 'plain' || reducedMotion.matches) return;
  const dt = Math.min(0.033, Math.max(0.004, (now - lastAnimTime) / 1000));
  lastAnimTime = now;
  const k = 195.0;
  const c = 14.5;
  for (let i = 0; i < 3; i++) {
    const p = state.springPos[i];
    const v = state.springVel[i];
    for (const axis of ['x', 'y', 'a']) {
      const accel = -k * p[axis] - c * v[axis];
      v[axis] += accel * dt;
      p[axis] += v[axis] * dt;
    }
  }
  if (!springActive()) {
    for (let i = 0; i < 3; i++) {
      state.springPos[i] = { x: 0, y: 0, a: 0 };
      state.springVel[i] = { x: 0, y: 0, a: 0 };
    }
  }
  requestDraw(false);
  if (springActive()) {
    animRaf = requestAnimationFrame(stepSpring);
  }
}
// #endregion spring-physics

// #region gl-setup
function renderWebGL(e) {
  if (!stage || stage.lost || state.mode !== 'webgl') return;
  const layout = computeLayout();
  syncHitGeometry(layout);

  const changed = new Set(e?.changedElements ?? []);
  if (state.domDirty || changed.has(posterCard) || !stage.has(posterCard) || !lastTex) {
    lastTex = stage.upload(posterCard);
    state.domDirty = false;
  }
  if (!lastTex) return;
  if (!stage.begin([0.145, 0.135, 0.125, 1])) return;

  const pal = activePalette();
  const colors = new Float32Array(9);
  const positions = new Float32Array(9);
  const enabled = new Float32Array(3);
  for (let i = 0; i < 3; i++) {
    const d = pal.drums[i];
    const p = currentDrumPos(i);
    colors[i * 3] = d.rgb[0];
    colors[i * 3 + 1] = d.rgb[1];
    colors[i * 3 + 2] = d.rgb[2];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.a;
    enabled[i] = !d.disabled && state.drumOn[i] ? 1.0 : 0.0;
  }

  stage.quad(posterCard, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (gl, uniform) => {
    gl.uniform2f(uniform('uCanvasSize'), layout.cw, layout.ch);
    gl.uniform4f(uniform('uPaperRect'), layout.paperX, layout.paperY, layout.paperW, layout.paperH);
    gl.uniform4f(uniform('uCardRect'), layout.cardX, layout.cardY, layout.cardW, layout.cardH);
    gl.uniform3fv(uniform('uDrumColor[0]'), colors);
    gl.uniform3fv(uniform('uDrumPos[0]'), positions);
    gl.uniform1fv(uniform('uDrumEnabled[0]'), enabled);
    gl.uniform1i(uniform('uPaletteMode'), pal.mode);
    gl.uniform1f(uniform('uGrainAmount'), 1.0);
    gl.uniform1f(uniform('uRollerStreak'), state.streaks ? 1.0 : 0.0);
    gl.uniform1f(uniform('uShowMarks'), 1.0);
  });
  updateHud();
}

function render2DFallback() {
  if (!ctx2d || state.mode !== '2d') return;
  const layout = computeLayout();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#262320';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);
  ctx2d.fillStyle = '#f5f0e1';
  ctx2d.fillRect(layout.paperX, layout.paperY, layout.paperW, layout.paperH);

  const pal = activePalette();
  ctx2d.globalCompositeOperation = 'multiply';
  for (let i = 2; i >= 0; i--) {
    if (pal.drums[i].disabled || !state.drumOn[i]) continue;
    const p = currentDrumPos(i);
    ctx2d.save();
    ctx2d.globalAlpha = i === 0 ? 0.92 : 0.38;
    ctx2d.translate(layout.cardX + p.x + layout.cardW * 0.5, layout.cardY + p.y + layout.cardH * 0.5);
    ctx2d.rotate(p.a);
    ctx2d.drawElementImage(posterCard, -layout.cardW * 0.5, -layout.cardH * 0.5, layout.cardW, layout.cardH);
    ctx2d.restore();
  }
  ctx2d.globalCompositeOperation = 'source-over';
  ctx2d.globalAlpha = 0.25;
  ctx2d.drawElementImage(posterCard, layout.cardX, layout.cardY, layout.cardW, layout.cardH);
  ctx2d.restore();
  state.domDirty = false;
  updateHud();
}

function enterPlainFallback(reason) {
  stopSpring();
  state.mode = 'plain';
  canvas.hidden = true;
  if (posterCard.parentElement !== plainHost) plainHost.append(posterCard);
  routeNoteEl.textContent = reason;
  updateHud();
}

function restoreFromPlain() {
  canvas.hidden = false;
  if (posterCard.parentElement !== canvas) canvas.append(posterCard);
  state.domDirty = true;
  state.lastGeoKey = '';
  syncHitGeometry(computeLayout(), true);
  requestDraw(true);
}

function requestDraw(markDirty = true) {
  if (markDirty) state.domDirty = true;
  if (state.mode === 'plain') {
    updateHud();
    return;
  }
  canvas.requestPaint?.();
}

function initRenderer() {
  if (!supported) {
    enterPlainFallback('HTML-in-canvas is not enabled in this browser, so the flyer is shown as plain HTML.');
    return;
  }
  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: RISO_FRAG,
        attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          lastTex = null;
          enterPlainFallback('The WebGL 2 context was lost. Showing the flyer as plain HTML until restored.');
        },
        onRestored: () => {
          state.mode = 'webgl';
          lastTex = null;
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context, texElementSubImage2D + updateElementGeometry).';
          restoreFromPlain();
        },
      });
      state.mode = 'webgl';
      routeNoteEl.textContent = 'Drawn with WebGL 2 on one ElementGL context using texElementSubImage2D() and updateElementGeometry().';
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back to 2D.`;
    }
  }
  if (state.mode !== 'webgl') {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; using the 2D multiply fallback.';
    } else {
      enterPlainFallback('No 2D or WebGL 2 canvas context is available.');
      return;
    }
  }
  canvas.addEventListener('paint', (e) => {
    if (state.mode === 'webgl') renderWebGL(e);
    else if (state.mode === '2d') render2DFallback();
  });
  requestDraw(true);
}
// #endregion gl-setup

function syncToolbarLabels() {
  const pal = activePalette();
  for (const b of paletteBtns) b.setAttribute('aria-pressed', String(b.dataset.palette === state.palette));
  for (let i = 0; i < 3; i++) {
    const d = pal.drums[i];
    drumDots[i].style.background = d.hex;
    drumLabels[i].textContent = `${i + 1} · ${d.name}`;
    drumChecks[i].disabled = Boolean(d.disabled);
    drumWraps[i].classList.toggle('is-off', Boolean(d.disabled));
  }
  const activeDrums = [0, 1, 2].filter((i) => !pal.drums[i].disabled && state.drumOn[i]).length;
  posterSpec.textContent = `240 LPI · ${activeDrums} DRUM${activeDrums === 1 ? '' : 'S'}`;
  dialAOut.textContent = `${state.dialA >= 0 ? '+' : ''}${state.dialA.toFixed(1)}px`;
  dialBOut.textContent = `${state.dialB >= 0 ? '+' : ''}${state.dialB.toFixed(1)}px`;
}

// Poster DOM interactivity -> repaints DOM & kicks press spring
posterTitle.addEventListener('input', () => {
  requestDraw(true);
  kickDrums(0.75);
});

for (const btn of spotBtns) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.spot;
    state.spotSolid[key] = !state.spotSolid[key];
    btn.setAttribute('aria-pressed', String(state.spotSolid[key]));
    artLayers[key]?.classList.toggle('is-tint', !state.spotSolid[key]);
    requestDraw(true);
    kickDrums(0.85);
  });
}

posterRun.addEventListener('input', () => {
  state.runCount = Number(posterRun.value);
  posterRunOut.textContent = String(state.runCount);
  artRunBadge.textContent = `RUN ${String(state.runCount).padStart(3, '0')}`;
  requestDraw(true);
  kickDrums(0.45);
});

posterStamp.addEventListener('click', () => {
  state.impressions++;
  posterEdition.textContent = `PRINT #${String(state.impressions).padStart(3, '0')}`;
  requestDraw(true);
  kickDrums(1.15);
});

// Press toolbar controls
for (const btn of paletteBtns) {
  btn.addEventListener('click', () => {
    state.palette = btn.dataset.palette;
    syncToolbarLabels();
    requestDraw(true);
    kickDrums(0.9);
  });
}

drumChecks.forEach((chk, i) => {
  chk.addEventListener('change', () => {
    state.drumOn[i] = chk.checked;
    syncToolbarLabels();
    requestDraw(true);
  });
});

dialA.addEventListener('input', () => {
  state.dialA = Number(dialA.value);
  state.dragOffset[0] = { x: 0, y: 0 };
  syncToolbarLabels();
  requestDraw(false);
});

dialB.addEventListener('input', () => {
  state.dialB = Number(dialB.value);
  state.dragOffset[1] = { x: 0, y: 0 };
  syncToolbarLabels();
  requestDraw(false);
});

btnJostle.addEventListener('click', () => {
  if (reducedMotion.matches) {
    state.dialA = Number(((Math.sin(kickCount + 1) * 5)).toFixed(1));
    state.dialB = Number(((Math.cos(kickCount + 2) * 5)).toFixed(1));
    dialA.value = String(state.dialA);
    dialB.value = String(state.dialB);
    kickCount++;
    syncToolbarLabels();
    requestDraw(false);
    return;
  }
  kickDrums(1.35);
});

btnZero.addEventListener('click', () => {
  state.dialA = 0;
  state.dialB = 0;
  state.dragOffset = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  dialA.value = '0';
  dialB.value = '0';
  syncToolbarLabels();
  requestDraw(false);
});

ctlStreaks.addEventListener('change', () => {
  state.streaks = ctlStreaks.checked;
  requestDraw(false);
});

// Direct sheet dragging to shift Drum A/B registration (without disturbing native inputs/buttons)
let dragging = false;
let dragX = 0;
let dragY = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode === 'plain') return;
  const ctrl = e.target instanceof Element ? e.target.closest('input, button, label') : null;
  if (ctrl) return;
  dragging = true;
  dragX = e.clientX;
  dragY = e.clientY;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
}, { capture: true });

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragX;
  const dy = e.clientY - dragY;
  dragX = e.clientX;
  dragY = e.clientY;
  state.dialA = Math.max(-14, Math.min(14, Math.round((state.dialA + dx * 0.25) * 2) / 2));
  state.dragOffset[0].y = Math.max(-14, Math.min(14, state.dragOffset[0].y + dy * 0.2));
  state.dialB = Math.max(-14, Math.min(14, Math.round((state.dialB - dx * 0.25) * 2) / 2));
  state.dragOffset[1].y = Math.max(-14, Math.min(14, state.dragOffset[1].y - dy * 0.2));
  dialA.value = String(state.dialA);
  dialB.value = String(state.dialB);
  syncToolbarLabels();
  requestDraw(false);
}, { capture: true });

const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag, { capture: true });
canvas.addEventListener('pointercancel', endDrag, { capture: true });

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver((entries) => {
    state.onScreen = entries.some((entry) => entry.isIntersecting);
    if (state.onScreen) {
      requestDraw(false);
      scheduleSpring();
    } else {
      stopSpring();
    }
  }, { rootMargin: '120px' }).observe(pressStage);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    state.lastGeoKey = '';
    requestDraw(false);
  }).observe(canvas);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSpring();
  else if (state.onScreen) {
    requestDraw(false);
    scheduleSpring();
  }
});

reducedMotion.addEventListener?.('change', () => {
  if (reducedMotion.matches) {
    stopSpring();
    for (let i = 0; i < 3; i++) {
      state.springPos[i] = { x: 0, y: 0, a: 0 };
      state.springVel[i] = { x: 0, y: 0, a: 0 };
    }
  }
  updateHud();
  requestDraw(false);
});

syncToolbarLabels();
initRenderer();

// ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------

function setRisoUniforms(gl, uniform, w, h, { paletteMode = 0, offsets = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], enabled = [1, 1, 1], grain = 0, streaks = 0, marks = 0 } = {}) {
  const pal = Object.values(PALETTES).find((p) => p.mode === paletteMode) ?? PALETTES.indie;
  const colors = new Float32Array(9);
  const pos = new Float32Array(9);
  const en = new Float32Array(enabled);
  for (let i = 0; i < 3; i++) {
    colors[i * 3] = pal.drums[i].rgb[0];
    colors[i * 3 + 1] = pal.drums[i].rgb[1];
    colors[i * 3 + 2] = pal.drums[i].rgb[2];
    pos[i * 3] = offsets[i][0];
    pos[i * 3 + 1] = offsets[i][1];
    pos[i * 3 + 2] = offsets[i][2];
  }
  gl.uniform2f(uniform('uCanvasSize'), w, h);
  gl.uniform4f(uniform('uPaperRect'), 0, 0, w, h);
  gl.uniform4f(uniform('uCardRect'), 0, 0, w, h);
  gl.uniform3fv(uniform('uDrumColor[0]'), colors);
  gl.uniform3fv(uniform('uDrumPos[0]'), pos);
  gl.uniform1fv(uniform('uDrumEnabled[0]'), en);
  gl.uniform1i(uniform('uPaletteMode'), paletteMode);
  gl.uniform1f(uniform('uGrainAmount'), grain);
  gl.uniform1f(uniform('uRollerStreak'), streaks);
  gl.uniform1f(uniform('uShowMarks'), marks);
}

function readPatchRGB(gl, cssX, cssY, canvasW, canvasH, dpr) {
  const px = new Uint8Array(4);
  const gx = Math.max(0, Math.min(canvasW - 1, Math.round(cssX * dpr)));
  const gy = Math.max(0, Math.min(canvasH - 1, canvasH - 1 - Math.round(cssY * dpr)));
  gl.readPixels(gx, gy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const luminance = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() executes multi-plate subtractive separation cleanly',
    why: 'Uploads a multi-colour HTML card into RISO_FRAG on an isolated ElementGL fixture, draws 3 spot plates over Munken paper and verifies gl.getError() === 0.',
    timeout: 6000,
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const w = 150, h = 90;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${w}px;height:${h}px;display:block`;
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `width:${w}px;height:${h}px;display:grid;grid-template-columns:1fr 1fr 1fr;background:#ffffff`;
      card.innerHTML = '<div style="background:#ffffff"></div><div style="background:#ff00ff"></div><div style="background:#00ffff"></div>';
      cv.append(card);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: RISO_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
      try {
        await nextPaint(cv);
        const gl = g.gl;
        while (gl.getError() !== gl.NO_ERROR) {}
        const tex = g.upload(card);
        if (!tex || !tex.w || !tex.h) throw new Error('upload returned empty texture');
        g.begin([0, 0, 0, 1]);
        g.quad(card, ElementGL.rect(cv, 0, 0, w, h), (gctx, u) => setRisoUniforms(gctx, u, w, h, { grain: 1.0 }));
        const err = gl.getError();
        if (err !== gl.NO_ERROR) throw new Error(`gl.getError() returned ${err}`);
        const dpr = cv.width / w;
        const paperPx = readPatchRGB(gl, 25, 45, cv.width, cv.height, dpr);
        const pinkPx = readPatchRGB(gl, 75, 45, cv.width, cv.height, dpr);
        const bluePx = readPatchRGB(gl, 125, 45, cv.width, cv.height, dpr);
        if (paperPx[0] < 210 || pinkPx[0] < 180 || pinkPx[1] > 140 || bluePx[2] < 130 || bluePx[0] > 80) {
          throw new Error(`unexpected plate pixels: paper=(${paperPx.slice(0, 3)}) pink=(${pinkPx.slice(0, 3)}) blue=(${bluePx.slice(0, 3)})`);
        }
        return `gl.getError()=0; uploaded ${tex.w}x${tex.h}; paper rgb(${paperPx.slice(0, 3).join(',')}), pink rgb(${pinkPx.slice(0, 3).join(',')}), blue rgb(${bluePx.slice(0, 3).join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'Overprinting Fluorescent Pink + Medium Blue produces darker mixed RGB than either ink alone',
    why: 'Draws pure Magenta (#ff00ff -> Pink only), pure Cyan (#00ffff -> Blue only) and pure Blue (#0000ff -> Pink + Blue overprint) through RISO_FRAG and compares luminance.',
    timeout: 6000,
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const w = 150, h = 60;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${w}px;height:${h}px;display:block`;
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `width:${w}px;height:${h}px;display:grid;grid-template-columns:1fr 1fr 1fr`;
      card.innerHTML = '<div style="background:#ff00ff"></div><div style="background:#00ffff"></div><div style="background:#0000ff"></div>';
      cv.append(card);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: RISO_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
      try {
        await nextPaint(cv);
        const gl = g.gl;
        g.upload(card);
        g.begin([0, 0, 0, 1]);
        g.quad(card, ElementGL.rect(cv, 0, 0, w, h), (gctx, u) => setRisoUniforms(gctx, u, w, h, { enabled: [1, 1, 0], grain: 0 }));
        const err = gl.getError();
        if (err !== gl.NO_ERROR) throw new Error(`gl.getError()=${err}`);
        const dpr = cv.width / w;
        const pinkOnly = readPatchRGB(gl, 25, 30, cv.width, cv.height, dpr);
        const blueOnly = readPatchRGB(gl, 75, 30, cv.width, cv.height, dpr);
        const overprint = readPatchRGB(gl, 125, 30, cv.width, cv.height, dpr);
        const lPink = luminance(pinkOnly);
        const lBlue = luminance(blueOnly);
        const lMix = luminance(overprint);
        if (!(lMix < lPink - 20 && lMix < lBlue - 20)) {
          throw new Error(`overprint luminance ${lMix.toFixed(1)} is not darker than pink (${lPink.toFixed(1)}) and blue (${lBlue.toFixed(1)})`);
        }
        return `lum Pink=${lPink.toFixed(1)} rgb(${pinkOnly.slice(0, 3)}), Blue=${lBlue.toFixed(1)} rgb(${blueOnly.slice(0, 3)}), Overprint=${lMix.toFixed(1)} rgb(${overprint.slice(0, 3)})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'Drum offset uniform visibly shifts plate pixel position across a step edge',
    why: 'Draws a vertical white-to-magenta step edge at x=70, then sets Drum 1 horizontal offset to +12 px and checks pixels across the shifted boundary.',
    timeout: 6000,
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const w = 140, h = 70;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${w}px;height:${h}px;display:block`;
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `width:${w}px;height:${h}px;display:grid;grid-template-columns:70px 70px`;
      card.innerHTML = '<div style="background:#ffffff"></div><div style="background:#ff00ff"></div>';
      cv.append(card);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: RISO_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
      try {
        await nextPaint(cv);
        const gl = g.gl;
        g.upload(card);

        // Pass 1: zero offset -> x=75 is inked pink
        g.begin([0, 0, 0, 1]);
        const dpr = cv.width / w;
        g.quad(card, ElementGL.rect(cv, 0, 0, w, h), (gctx, u) => setRisoUniforms(gctx, u, w, h, { enabled: [1, 0, 0], offsets: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], grain: 0 }));
        const beforeAt75 = readPatchRGB(gl, 75, 35, cv.width, cv.height, dpr);

        // Pass 2: +12 px horizontal drum shift -> x=75 becomes cream paper, x=88 becomes pink
        g.begin([0, 0, 0, 1]);
        g.quad(card, ElementGL.rect(cv, 0, 0, w, h), (gctx, u) => setRisoUniforms(gctx, u, w, h, { enabled: [1, 0, 0], offsets: [[12, 0, 0], [0, 0, 0], [0, 0, 0]], grain: 0 }));
        const err = gl.getError();
        const afterAt75 = readPatchRGB(gl, 75, 35, cv.width, cv.height, dpr);
        const afterAt88 = readPatchRGB(gl, 88, 35, cv.width, cv.height, dpr);

        const lumBefore = luminance(beforeAt75);
        const lumAfter75 = luminance(afterAt75);
        const lumAfter88 = luminance(afterAt88);
        if (err !== gl.NO_ERROR || lumBefore > 165 || lumAfter75 < 205 || lumAfter88 > 165) {
          throw new Error(`shift check failed: err=${err}, before75=${lumBefore.toFixed(1)}, after75=${lumAfter75.toFixed(1)}, after88=${lumAfter88.toFixed(1)}`);
        }
        return `at x=75: before shift rgb(${beforeAt75.slice(0, 3)}) lum=${lumBefore.toFixed(0)} -> after +12px rgb(${afterAt75.slice(0, 3)}) lum=${lumAfter75.toFixed(0)}; x=88 pink lum=${lumAfter88.toFixed(0)}`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps live input and button clickable (elementsFromPoint)',
    why: 'Renders an isolated ElementGL fixture card translated to (28, 22), applies updateElementGeometry() scaled by geometryUnit() with hitTick and probes both control centres.',
    timeout: 6000,
    run: async () => {
      if (!supported || !glSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('ElementGL or updateElementGeometry() is not available');
      }
      const cw = 260, ch = 150, cardW = 200, cardH = 100;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block`;

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = `position:absolute;left:0;top:0;box-sizing:border-box;width:${cardW}px;height:${cardH}px;padding:8px;display:flex;flex-direction:column;gap:8px;background:#ffffff`;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'none';
      inp.value = 'ZINE NO. 04';
      inp.style.cssText = 'width:100%;height:36px;box-sizing:border-box';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '+1 Impression';
      btn.style.cssText = 'width:100%;height:36px;box-sizing:border-box';
      box.append(inp, btn);
      cv.append(box);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: RISO_FRAG, attributes: { alpha: false } });
      try {
        await nextPaint(cv);
        g.upload(box);
        g.begin([0, 0, 0, 1]);
        g.quad(box, ElementGL.rect(cv, 28, 22, cardW, cardH), (gctx, u) => setRisoUniforms(gctx, u, cw, ch, { grain: 0 }));

        const unit = geometryUnit(cv, box, cardW);
        const mat = new DOMMatrix().scale(unit, unit, 1).translate(28, 22);
        cv.updateElementGeometry(box, { canvasTransform: mat });
        box.dataset.hitTick = '1';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const r = cv.getBoundingClientRect();
        const hitInput = document.elementsFromPoint(r.left + 28 + 100, r.top + 22 + 26);
        const hitBtn = document.elementsFromPoint(r.left + 28 + 100, r.top + 22 + 70);
        const gotInput = hitInput.includes(inp);
        const gotBtn = hitBtn.includes(btn);
        if (!gotInput || !gotBtn) {
          throw new Error(`hit failed (unit=${unit.toFixed(2)}): input=${gotInput} (${hitInput[0]?.tagName}), button=${gotBtn} (${hitBtn[0]?.tagName})`);
        }
        return `hit <input> (${gotInput}) and <button> (${gotBtn}) at translated (28, 22) CSS px with geometryUnit=${unit.toFixed(2)}`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire(cv);
      }
    },
  },
];

runTests(document.getElementById('tests'), tests);
