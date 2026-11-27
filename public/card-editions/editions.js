import { banner, supported as supported2d, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);
const stageWrap = $('stage-wrap');
const canvas = $('card-canvas');
const plainHost = $('plain-host');
const cardEl = $('collector-card');
const stageHud = $('stage-hud');
const noticeEl = $('notice');
const statusEl = $('status-line');
const obraRow = $('obra-controls');

const titleInput = $('card-title');
const pipTop = $('pip-top');
const pipBot = $('pip-bot');
const editionBadge = $('edition-badge');
const sealBtn = $('btn-seal');
const chipsBtn = $('btn-chips');
const multBtn = $('btn-mult');
const suitBtn = $('btn-suit');
const scorePill = $('score-readout');
const serialEl = $('card-serial');
const svgSuitPath = $('svg-suit-path');

const holdChk = $('chk-hold');
const orbitBtn = $('btn-orbit');
const ditherRange = $('rng-dither');
const ditherOut = $('out-dither');

const CARD_W = 280;
const CARD_H = 400;
const PERSPECTIVE = 900;
const SPHERE_RADIUS = 560;

const EDITIONS = [
  { id: 0, name: 'Foil', badge: 'FOIL · +50 CHIPS' },
  { id: 1, name: 'Holographic', badge: 'HOLO · +10 MULT' },
  { id: 2, name: 'Polychrome', badge: 'POLY · x1.5 MULT' },
  { id: 3, name: 'Negative', badge: 'NEG · +1 SLOT' },
  { id: 4, name: 'Obra Dinn 1-bit', badge: '1-BIT · SPHERE' },
];

const SUITS = [
  {
    name: 'Spades',
    symbol: '\u2660',
    cls: 'suit-dark',
    fill: '#1d2538',
    path: 'M0 -24 C-14 -10 -22 2 -22 10 C-22 18 -14 22 -7 18 C-4 16 -2 14 -1 12 L-6 26 L6 26 L1 12 C2 14 4 16 7 18 C14 22 22 18 22 10 C22 2 14 -10 0 -24 Z',
  },
  {
    name: 'Hearts',
    symbol: '\u2665',
    cls: 'suit-red',
    fill: '#a61e22',
    path: 'M0 24 C-18 10 -24 -2 -24 -11 C-24 -20 -16 -26 -8 -26 C-3 -26 0 -22 0 -19 C0 -22 3 -26 8 -26 C16 -26 24 -20 24 -11 C24 -2 18 10 0 24 Z',
  },
  {
    name: 'Diamonds',
    symbol: '\u2666',
    cls: 'suit-red',
    fill: '#a61e22',
    path: 'M0 -26 L21 0 L0 26 L-21 0 Z',
  },
  {
    name: 'Clubs',
    symbol: '\u2663',
    cls: 'suit-dark',
    fill: '#1d2538',
    path: 'M0 -25 C-7 -25 -12 -19 -12 -12 C-12 -8 -9 -4 -6 -2 C-14 -4 -22 1 -22 9 C-22 16 -16 21 -9 21 C-5 21 -2 18 -1 15 L-6 27 L6 27 L1 15 C2 18 5 21 9 21 C16 21 22 16 22 9 C22 1 14 -4 6 -2 C9 -4 12 -8 12 -12 C12 -19 7 -25 0 -25 Z',
  },
];

const SEALS = [
  { label: 'GOLD', serial: 'GOLD SEAL', bg: '#b6862c', ink: '#ffffff' },
  { label: 'RED', serial: 'RED SEAL', bg: '#b82924', ink: '#ffffff' },
  { label: 'BLUE', serial: 'BLUE SEAL', bg: '#2059b5', ink: '#ffffff' },
  { label: 'PURP', serial: 'PURPLE SEAL', bg: '#6e329e', ink: '#ffffff' },
  { label: 'NONE', serial: 'STANDARD', bg: '#dcd4c0', ink: '#3b3324' },
];

const PALETTE_LABELS = [
  '#333319 / #e5ffff',
  '#241606 / #ffba42',
  '#e5ffff / #333319',
];

const state = {
  backend: 'init',
  edition: 0,
  ditherMode: 0, // 0 = sphere-locked, 1 = screen-space
  paletteMode: 0,
  ditherScale: 1.5,
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  vyaw: 0,
  vpitch: 0,
  pointerX: 0.5,
  pointerY: 0.5,
  autoOrbit: false,
  orbitStart: 0,
  onScreen: true,
  cardDirty: true,
  paints: 0,
  uploads: 0,
  unit: 1,
  unitKey: '',
  lastGeoKey: '',
  chips: 50,
  mult: 4,
  suitIdx: 0,
  sealIdx: 0,
};

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

// #region blue-noise
const BLUE_NOISE_SIZE = 32;

function buildBlueNoiseBytes(size = BLUE_NOISE_SIZE) {
  const n = size * size;
  const energy = new Float32Array(n);
  const grid = new Uint8Array(n);
  const sigma = 1.5;
  const rad = 4;
  const kernel = [];
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      kernel.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))]);
    }
  }
  const addEnergy = (idx, sgn) => {
    const x0 = idx % size;
    const y0 = (idx / size) | 0;
    for (let k = 0; k < kernel.length; k++) {
      const [dx, dy, w] = kernel[k];
      const x = (x0 + dx + size) % size;
      const y = (y0 + dy + size) % size;
      energy[y * size + x] += sgn * w;
    }
  };
  let seed = 0x1337beef;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const initCount = Math.floor(n * 0.1);
  let placed = 0;
  while (placed < initCount) {
    const idx = Math.floor(rng() * n);
    if (!grid[idx]) {
      grid[idx] = 1;
      addEnergy(idx, 1);
      placed++;
    }
  }
  // Swap tightest cluster into largest void to relax the initial seed.
  for (let step = 0; step < initCount * 2; step++) {
    let maxE = -1, maxI = 0, minE = 1e9, minI = 0;
    for (let i = 0; i < n; i++) {
      if (grid[i] && energy[i] > maxE) { maxE = energy[i]; maxI = i; }
    }
    grid[maxI] = 0;
    addEnergy(maxI, -1);
    for (let i = 0; i < n; i++) {
      if (!grid[i] && energy[i] < minE) { minE = energy[i]; minI = i; }
    }
    if (minI === maxI) {
      grid[maxI] = 1;
      addEnergy(maxI, 1);
      break;
    }
    grid[minI] = 1;
    addEnergy(minI, 1);
  }
  const rank = new Uint16Array(n);
  const savedGrid = new Uint8Array(grid);
  const savedEnergy = new Float32Array(energy);

  // Phase 1: rank initial ones from tightest cluster down to 0.
  for (let r = initCount - 1; r >= 0; r--) {
    let maxE = -1, maxI = 0;
    for (let i = 0; i < n; i++) if (grid[i] && energy[i] > maxE) { maxE = energy[i]; maxI = i; }
    grid[maxI] = 0;
    addEnergy(maxI, -1);
    rank[maxI] = r;
  }

  grid.set(savedGrid);
  energy.set(savedEnergy);

  // Phase 2: fill largest voids up to N/2.
  const half = n >> 1;
  for (let r = initCount; r < half; r++) {
    let minE = 1e9, minI = 0;
    for (let i = 0; i < n; i++) if (!grid[i] && energy[i] < minE) { minE = energy[i]; minI = i; }
    grid[minI] = 1;
    addEnergy(minI, 1);
    rank[minI] = r;
  }

  // Phase 3: invert remaining majority zeros and remove tightest clusters.
  for (let i = 0; i < n; i++) grid[i] = 1 - grid[i];
  energy.fill(0);
  for (let i = 0; i < n; i++) if (grid[i]) addEnergy(i, 1);
  for (let r = half; r < n; r++) {
    let maxE = -1, maxI = 0;
    for (let i = 0; i < n; i++) if (grid[i] && energy[i] > maxE) { maxE = energy[i]; maxI = i; }
    grid[maxI] = 0;
    addEnergy(maxI, -1);
    rank[maxI] = r;
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(((rank[i] + 0.5) / n) * 255);
  return out;
}

function createBlueNoiseTexture(gl, bytes, size = BLUE_NOISE_SIZE) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}
// #endregion blue-noise

const blueNoiseBytes = buildBlueNoiseBytes(BLUE_NOISE_SIZE);

// #region shader-editions
const CARD_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uBlueNoise;
uniform vec2 uSize;
uniform float uTime;
uniform int uEdition;
uniform vec2 uTilt;
uniform vec2 uPointer;
uniform int uDitherMode;
uniform int uPaletteMode;
uniform float uDitherScale;
uniform float uSphereRadius;
uniform float uDpr;
uniform int uExactFixture;

in vec2 vUv;
out vec4 outColor;

int modPos(int a, int n) {
  int r = a % n;
  return r < 0 ? r + n : r;
}

// #region sphere-dither
float bayer8(int x, int y) {
  int x0 = x ^ y;
  int v = ((x0 & 1) << 5) | ((y & 1) << 4)
        | (((x0 >> 1) & 1) << 3) | (((y >> 1) & 1) << 2)
        | (((x0 >> 2) & 1) << 1) | ((y >> 2) & 1);
  return (float(v) + 0.5) / 64.0;
}

ivec2 ditherCell(vec2 uv) {
  if (uDitherMode == 1) {
    // Screen-space: fixed to monitor pixels so tilting drags the card over the pattern.
    vec2 screenCss = gl_FragCoord.xy / max(uDpr, 0.5);
    return ivec2(floor(screenCss / max(uDitherScale, 0.5)));
  }
  // Sphere-locked: project onto a 3D view sphere and quantize equirectangular angles.
  vec2 localPx = vec2((uv.x - 0.5) * uSize.x, (0.5 - uv.y) * uSize.y);
  vec3 rayDir = normalize(vec3(localPx, -uSphereRadius));
  float theta = atan(rayDir.x, -rayDir.z);
  float phi = asin(clamp(rayDir.y, -1.0, 1.0));
  float angStep = max(uDitherScale, 0.5) / uSphereRadius;
  return ivec2(floor(vec2(theta, phi) / angStep));
}

vec3 obraDinnBit(vec3 base, vec2 uv) {
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  if (uExactFixture == 0) {
    float lightShift = (uTilt.x * (uv.x - 0.5) - uTilt.y * (uv.y - 0.5)) * 0.18;
    lum = smoothstep(0.05, 0.95, clamp(lum + lightShift, 0.0, 1.0));
  }
  ivec2 cell = ditherCell(uv);
  float b8 = bayer8(modPos(cell.x, 8), modPos(cell.y, 8));
  ivec2 bnCoord = ivec2(modPos(cell.x, 32), modPos(cell.y, 32));
  float bn = texelFetch(uBlueNoise, bnCoord, 0).r;
  float threshold = clamp(0.5 + (b8 - 0.5) * 0.68 + (bn - 0.5) * 0.34, 0.006, 0.994);

  vec3 darkCol = vec3(51.0, 51.0, 25.0) / 255.0;   // #333319
  vec3 lightCol = vec3(229.0, 255.0, 255.0) / 255.0; // #e5ffff
  if (uPaletteMode == 1) {
    darkCol = vec3(36.0, 22.0, 6.0) / 255.0;        // #241606
    lightCol = vec3(255.0, 186.0, 66.0) / 255.0;    // #ffba42
  } else if (uPaletteMode == 2) {
    vec3 tmp = darkCol; darkCol = lightCol; lightCol = tmp;
  }
  return lum >= threshold ? lightCol : darkCol;
}
// #endregion sphere-dither

float lumAt(vec2 uv) {
  vec4 t = texture(uTex, clamp(uv, vec2(0.0), vec2(1.0)));
  vec3 c = t.a > 0.001 ? t.rgb / t.a : vec3(0.0);
  return dot(c, vec3(0.299, 0.587, 0.114)) * t.a;
}

vec3 applyFoil(vec3 base, vec2 uv, vec2 tilt) {
  vec2 centered = uv - 0.5;
  vec2 rot = vec2(centered.x * 0.84 - centered.y * 0.54, centered.x * 0.54 + centered.y * 0.84);
  float brush = 0.86 + 0.14 * sin(rot.x * 320.0 + sin(rot.y * 42.0) * 1.4);
  float angleCoord = dot(centered, vec2(0.84, 0.54)) - dot(tilt, vec2(1.15, 0.82));
  float lobe1 = exp(-pow(angleCoord * 3.8, 2.0));
  float lobe2 = exp(-pow((angleCoord - 0.24) * 11.5, 2.0));
  float sheen = lobe1 * 0.88 + lobe2 * 0.68;

  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec2 px = 1.0 / max(uSize, vec2(1.0));
  float ridge = clamp(abs(lumAt(uv + vec2(px.x, 0.0)) - lumAt(uv - vec2(px.x, 0.0))) * 3.0 +
                      abs(lumAt(uv + vec2(0.0, px.y)) - lumAt(uv - vec2(0.0, px.y))) * 3.0, 0.0, 1.0);

  vec3 metalTint = mix(vec3(0.91, 0.94, 0.99), vec3(1.18, 1.24, 1.32), sheen * 0.65);
  vec3 specCol = mix(vec3(0.74, 0.86, 1.0), vec3(1.0, 0.96, 0.88), lobe2);
  float highlightMask = 0.22 + 0.52 * smoothstep(0.32, 0.95, lum) + 0.30 * ridge;
  return base * metalTint + specCol * (sheen * brush * highlightMask * 0.72);
}

vec3 applyHolo(vec3 base, vec2 uv, vec2 tilt) {
  vec2 centered = uv - 0.5;
  float tiltPhase = tilt.x * 7.2 + tilt.y * 4.5;
  float bars = 0.5 + 0.5 * sin(uv.x * 165.0 + tiltPhase * 2.8);
  float micro = 0.5 + 0.5 * sin((uv.x * 0.85 + uv.y * 0.35) * 96.0 - tiltPhase * 2.0);
  float grating = mix(bars, bars * micro, 0.45);

  float specPhase = (uv.x * 2.3 - uv.y * 0.85) * 3.14159 + tiltPhase;
  vec3 spectrum = 0.5 + 0.5 * cos(specPhase + vec3(0.0, 2.0944, 4.1888));
  float spot = exp(-pow((dot(centered, vec2(0.92, -0.38)) - tilt.x * 0.9) * 3.1, 2.0));

  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float holoWeight = (0.24 + 0.58 * spot) * (0.28 + 0.60 * smoothstep(0.18, 0.92, lum));
  vec3 tinted = mix(base, base * (0.72 + spectrum * 0.88), holoWeight);
  return tinted + spectrum * grating * (0.14 + 0.42 * spot) * (0.35 + 0.65 * lum);
}

vec3 applyPolychrome(vec3 base, vec2 uv, vec2 tilt) {
  vec2 p = uv * 3.1;
  float w1 = sin(p.x * 2.1 + cos(p.y * 1.8 + tilt.y * 2.4) + tilt.x * 1.9);
  float w2 = cos(p.y * 2.4 - sin(p.x * 1.9 - tilt.x * 2.1) + tilt.y * 1.7);
  float film = 0.5 + 0.28 * w1 + 0.22 * w2;

  float nz = sqrt(max(0.08, 1.0 - dot(tilt, tilt)));
  vec3 normal = normalize(vec3(tilt.x, -tilt.y, nz));
  vec3 viewDir = normalize(vec3((0.5 - uv.x) * 0.48, (uv.y - 0.5) * 0.64, 1.0));
  float cosTheta = clamp(abs(dot(normal, viewDir)), 0.15, 1.0);
  float fresnel = pow(1.0 - cosTheta, 2.1);

  float opd = film * 5.4 + (1.0 - cosTheta) * 7.2 + tilt.x * 2.6 - tilt.y * 1.9;
  vec3 irid = 0.52 + 0.48 * cos(opd + vec3(0.0, 2.0944, 4.1888));
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 mixed = base * mix(vec3(1.0), irid * 1.32, 0.46 + 0.20 * fresnel);
  return mixed + irid * (0.11 + 0.44 * fresnel) * (0.35 + 0.65 * lum);
}

vec3 applyNegative(vec3 base, vec2 uv, vec2 tilt) {
  vec3 inv = 1.0 - base;
  inv = pow(clamp(inv, 0.0, 1.0), vec3(1.16));
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float solar = 0.5 + 0.5 * sin(lum * 6.28318 + 0.4);

  vec2 px = 1.0 / max(uSize, vec2(1.0));
  float gx = lumAt(uv + vec2(px.x, 0.0)) - lumAt(uv - vec2(px.x, 0.0));
  float gy = lumAt(uv + vec2(0.0, px.y)) - lumAt(uv - vec2(0.0, px.y));
  float edge = smoothstep(0.07, 0.52, length(vec2(gx, gy)));

  vec3 emerald = vec3(0.14, 0.96, 0.68);
  vec3 magenta = vec3(1.0, 0.26, 0.72);
  float phase = 0.5 + 0.5 * sin((uv.x * 3.2 - uv.y * 2.4) + tilt.x * 3.8 + tilt.y * 2.2);
  vec3 edgeGlow = mix(emerald, magenta, phase);

  vec3 plate = inv * vec3(0.92, 0.98, 1.06) + vec3(0.02, 0.03, 0.06);
  plate += edgeGlow * (edge * 0.78 + solar * 0.10);
  return plate;
}

void main() {
  vec4 tex = texture(uTex, vUv);
  vec3 base = tex.a > 0.001 ? tex.rgb / tex.a : vec3(0.0);

  if (uEdition == 4) {
    if (uExactFixture == 0 && tex.a < 0.5) discard;
    outColor = vec4(obraDinnBit(base, vUv), 1.0);
    return;
  }

  vec2 tilt = uTilt + (uPointer - 0.5) * 0.48;
  vec3 col = base;
  if (uEdition == 0) col = applyFoil(base, vUv, tilt);
  else if (uEdition == 1) col = applyHolo(base, vUv, tilt);
  else if (uEdition == 2) col = applyPolychrome(base, vUv, tilt);
  else if (uEdition == 3) col = applyNegative(base, vUv, tilt);

  vec2 fw = max(fwidth(vUv), vec2(1e-5));
  vec2 edge = min(vUv, 1.0 - vUv);
  float aa = min(clamp(edge.x / fw.x, 0.0, 1.0), clamp(edge.y / fw.y, 0.0, 1.0));
  float a = tex.a * aa;
  outColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}`;
// #endregion shader-editions

// #region tilt-hit
function buildCardMatrix(cw, ch, yawDeg, pitchDeg, cardW = CARD_W, cardH = CARD_H) {
  const persp = new DOMMatrix();
  persp.m34 = -1 / PERSPECTIVE;
  const fit = Math.min(1, (cw - 32) / (cardW * 1.18), (ch - 32) / (cardH * 1.15));
  return new DOMMatrix()
    .translate(cw / 2, ch / 2)
    .multiply(persp)
    .scale(fit, fit, fit)
    .rotate(pitchDeg, 0, 0)
    .rotate(0, yawDeg, 0)
    .translate(-cardW / 2, -cardH / 2, 0);
}

function toClip(mat, w, h, cw, ch) {
  const c = new DOMMatrix()
    .translate(-1, 1)
    .scale(2 / cw, -2 / ch)
    .multiply(mat)
    .scale(w, h);
  c.m13 = 0; c.m23 = 0; c.m33 = 0; c.m43 = 0;
  return c.toFloat32Array();
}

function syncHitGeometry(cardMat, cw, ch, cardW, cardH) {
  if (typeof canvas.updateElementGeometry !== 'function') return;
  const key = `${state.yaw.toFixed(2)},${state.pitch.toFixed(2)},${cw},${ch},${cardW},${cardH},${canvas.width}x${canvas.height}`;
  if (key === state.lastGeoKey) return;
  state.lastGeoKey = key;

  const unitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${cardW}`;
  if (state.unitKey !== unitKey) {
    state.unit = geometryUnit(canvas, cardEl, cardW);
    state.unitKey = unitKey;
  }
  const scaled = new DOMMatrix().scale(state.unit).multiply(cardMat);
  canvas.updateElementGeometry(cardEl, { canvasTransform: scaled });
  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
}

let loopRaf = 0;
let lastLoopTime = 0;

function stopLoop() {
  if (loopRaf) {
    cancelAnimationFrame(loopRaf);
    loopRaf = 0;
  }
  lastLoopTime = 0;
}

function stepMotion(now) {
  loopRaf = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  if (state.autoOrbit && !reducedMotion?.matches) {
    if (!state.orbitStart) state.orbitStart = now;
    const t = (now - state.orbitStart) / 1000;
    state.targetYaw = Math.sin(t * 1.45) * 26;
    state.targetPitch = Math.cos(t * 1.05) * 16;
  }

  const dt = lastLoopTime ? Math.min(0.05, (now - lastLoopTime) / 1000) : 1 / 60;
  lastLoopTime = now;

  if (reducedMotion?.matches || dragState) {
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
    state.vyaw = 0;
    state.vpitch = 0;
  } else {
    const k = 135;
    const damp = 15.5;
    const ax = (state.targetYaw - state.yaw) * k - state.vyaw * damp;
    const ay = (state.targetPitch - state.pitch) * k - state.vpitch * damp;
    state.vyaw += ax * dt;
    state.vpitch += ay * dt;
    state.yaw += state.vyaw * dt;
    state.pitch += state.vpitch * dt;
  }

  requestRedraw();

  const settled =
    !state.autoOrbit &&
    Math.abs(state.yaw - state.targetYaw) < 0.04 &&
    Math.abs(state.pitch - state.targetPitch) < 0.04 &&
    Math.abs(state.vyaw) < 0.08 &&
    Math.abs(state.vpitch) < 0.08;

  if (settled) {
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
    state.vyaw = 0;
    state.vpitch = 0;
    lastLoopTime = 0;
    requestRedraw();
  } else if (state.autoOrbit || !reducedMotion?.matches) {
    loopRaf = requestAnimationFrame(stepMotion);
  }
}

function wakeMotion() {
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;
  if (reducedMotion?.matches) {
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
    state.vyaw = 0;
    state.vpitch = 0;
    requestRedraw();
    return;
  }
  if (!loopRaf) {
    lastLoopTime = performance.now();
    loopRaf = requestAnimationFrame(stepMotion);
  }
}
// #endregion tilt-hit

let stage = null;
let blueNoiseTex = null;
let ctx2d = null;
let paint2dRaf = 0;

function showNotice(msg) {
  noticeEl.hidden = !msg;
  noticeEl.textContent = msg || '';
}

function updateCardDom() {
  const suit = SUITS[state.suitIdx];
  const seal = SEALS[state.sealIdx];
  const ed = EDITIONS[state.edition];

  cardEl.classList.toggle('suit-red', suit.cls === 'suit-red');
  cardEl.classList.toggle('suit-dark', suit.cls === 'suit-dark');
  pipTop.innerHTML = `<b>A</b><i>${suit.symbol}</i>`;
  pipBot.innerHTML = `<b>A</b><i>${suit.symbol}</i>`;
  svgSuitPath.setAttribute('d', suit.path);
  svgSuitPath.setAttribute('fill', suit.fill);

  sealBtn.textContent = seal.label;
  cardEl.style.setProperty('--card-seal', seal.bg);
  cardEl.style.setProperty('--card-seal-ink', seal.ink);
  serialEl.textContent = `NO. 057 · ${seal.serial}`;

  editionBadge.textContent = state.edition === 4
    ? `1-BIT · ${state.ditherMode === 0 ? 'SPHERE' : 'SCREEN'}`
    : ed.badge;

  $('chips-val').textContent = String(state.chips);
  $('mult-val').textContent = String(state.mult);
  suitBtn.textContent = `Suit: ${suit.symbol} ${suit.name}`;

  const bonusChips = state.edition === 0 ? 50 : 0;
  const bonusMult = state.edition === 1 ? 10 : 0;
  const multX = state.edition === 2 ? 1.5 : 1;
  const total = Math.round((state.chips + bonusChips) * ((state.mult + bonusMult) * multX));
  scorePill.textContent = `${total} pts`;

  state.cardDirty = true;
  requestRedraw();
}

function updateStatus() {
  const ed = EDITIONS[state.edition];
  const routeLabel =
    state.backend === 'webgl2' ? 'WebGL 2 (ElementGL)' :
    state.backend === '2d' ? '2D drawElementImage() fallback' :
    'Plain HTML';
  const ditherNote = state.edition === 4
    ? ` · ${state.ditherMode === 0 ? 'Sphere-locked (theta, phi)' : 'Screen-space (gl_FragCoord)'} · ${PALETTE_LABELS[state.paletteMode]}`
    : '';
  statusEl.textContent = `${routeLabel} · ${ed.name}${ditherNote} · yaw ${state.yaw.toFixed(1)} deg, pitch ${state.pitch.toFixed(1)} deg · ${state.paints} paints, ${state.uploads} uploads.`;
  stageHud.textContent = state.edition === 4
    ? `Obra Dinn: ${state.ditherMode === 0 ? 'Sphere-locked (zero swimming)' : 'Screen-space (watch gradients swim)'} · drag to tilt`
    : `${ed.name} · drag card to tilt in 3D · tap buttons or edit title`;
}

// #region fallback-2d
function enterPlainFallback(reason) {
  stopLoop();
  state.backend = 'plain';
  stageWrap.classList.add('is-plain');
  canvas.hidden = true;
  if (cardEl.parentElement !== plainHost) plainHost.append(cardEl);
  cardEl.inert = false;
  showNotice(reason);
  updateStatus();
}

function restoreFromPlain() {
  if (!stageWrap.classList.contains('is-plain')) return;
  stageWrap.classList.remove('is-plain');
  canvas.hidden = false;
  if (cardEl.parentElement !== canvas) canvas.append(cardEl);
  showNotice('');
  state.lastGeoKey = '';
  state.cardDirty = true;
}

function draw2DFallback() {
  paint2dRaf = 0;
  if (!ctx2d || state.backend !== '2d') return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const cardW = cardEl.offsetWidth || CARD_W;
  const cardH = cardEl.offsetHeight || CARD_H;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.fillStyle = '#141720';
  ctx2d.fillRect(0, 0, cw, ch);

  const yawRad = (state.yaw * Math.PI) / 180;
  const pitchRad = (state.pitch * Math.PI) / 180;
  const sx = Math.max(0.45, Math.cos(yawRad));
  const sy = Math.max(0.45, Math.cos(pitchRad));
  const shearY = Math.sin(yawRad) * 0.16;
  const shearX = -Math.sin(pitchRad) * 0.12;
  const fit = Math.min(1, (cw - 32) / cardW, (ch - 32) / cardH);

  ctx2d.save();
  ctx2d.translate(cw / 2, ch / 2);
  ctx2d.scale(fit, fit);
  ctx2d.transform(sx, shearY, shearX, sy, 0, 0);
  ctx2d.translate(-cardW / 2, -cardH / 2);
  ctx2d.drawElementImage(cardEl, 0, 0, cardW, cardH);

  // Subtle 2D sheen overlay matching the chosen edition when WebGL 2 is absent.
  const grad = ctx2d.createLinearGradient(0, 0, cardW, cardH);
  if (state.edition === 0) {
    grad.addColorStop(0, 'rgba(210, 230, 255, 0.08)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.28)');
    grad.addColorStop(1, 'rgba(180, 210, 255, 0.08)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, cardW, cardH);
  } else if (state.edition === 1 || state.edition === 2) {
    grad.addColorStop(0, 'rgba(255, 90, 170, 0.16)');
    grad.addColorStop(0.5, 'rgba(80, 240, 200, 0.18)');
    grad.addColorStop(1, 'rgba(110, 140, 255, 0.18)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, cardW, cardH);
  } else if (state.edition === 3) {
    ctx2d.strokeStyle = 'rgba(40, 240, 168, 0.85)';
    ctx2d.lineWidth = 4;
    ctx2d.strokeRect(2, 2, cardW - 4, cardH - 4);
  } else {
    ctx2d.strokeStyle = '#e5ffff';
    ctx2d.lineWidth = 3;
    ctx2d.strokeRect(1.5, 1.5, cardW - 3, cardH - 3);
  }
  ctx2d.restore();

  state.paints++;
  updateStatus();
}
// #endregion fallback-2d

function drawWebGLFrame(e) {
  if (!stage || stage.lost) return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const cardW = cardEl.offsetWidth || CARD_W;
  const cardH = cardEl.offsetHeight || CARD_H;
  state.paints++;

  const changed = e?.changedElements ?? null;
  if (state.cardDirty || !stage.has(cardEl) || !changed || changed.includes(cardEl)) {
    try {
      stage.upload(cardEl);
      state.cardDirty = false;
      state.uploads++;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        canvas.requestPaint?.();
        return;
      }
      throw err;
    }
  }

  if (!stage.begin([0.075, 0.082, 0.114, 1.0])) return;
  const cardMat = buildCardMatrix(cw, ch, state.yaw, state.pitch, cardW, cardH);
  const clipMat = toClip(cardMat, cardW, cardH, cw, ch);
  const dpr = canvas.width / Math.max(1, cw);
  const sinYaw = Math.sin((state.yaw * Math.PI) / 180);
  const sinPitch = Math.sin((state.pitch * Math.PI) / 180);

  stage.quad(cardEl, clipMat, (gl, u) => {
    if (blueNoiseTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blueNoiseTex);
      gl.uniform1i(u('uBlueNoise'), 1);
    }
    gl.uniform1i(u('uEdition'), state.edition);
    gl.uniform2f(u('uTilt'), sinYaw, sinPitch);
    gl.uniform2f(u('uPointer'), state.pointerX, state.pointerY);
    gl.uniform1i(u('uDitherMode'), state.ditherMode);
    gl.uniform1i(u('uPaletteMode'), state.paletteMode);
    gl.uniform1f(u('uDitherScale'), state.ditherScale);
    gl.uniform1f(u('uSphereRadius'), SPHERE_RADIUS);
    gl.uniform1f(u('uDpr'), dpr);
    gl.uniform1i(u('uExactFixture'), 0);
  });

  syncHitGeometry(cardMat, cw, ch, cardW, cardH);
  updateStatus();
}

function requestRedraw() {
  if (state.backend === 'webgl2') canvas.requestPaint?.();
  else if (state.backend === '2d' && !paint2dRaf) paint2dRaf = requestAnimationFrame(draw2DFallback);
}

// Start the single WebGL 2 ElementGL context, falling back cleanly to 2D or plain HTML.
if (glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: CARD_FRAG,
      onLost: () => {
        blueNoiseTex = null;
        enterPlainFallback('The browser took the WebGL 2 context away. The card is shown as plain HTML until it returns.');
      },
      onRestored: () => {
        blueNoiseTex = createBlueNoiseTexture(stage.gl, blueNoiseBytes, BLUE_NOISE_SIZE);
        state.backend = 'webgl2';
        restoreFromPlain();
        requestRedraw();
      },
    });
    blueNoiseTex = createBlueNoiseTexture(stage.gl, blueNoiseBytes, BLUE_NOISE_SIZE);
    state.backend = 'webgl2';
  } catch (err) {
    stage = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D drawElementImage() fallback.`);
  }
}

if (!stage && supported2d) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2d';
    if (noticeEl.hidden) {
      showNotice('WebGL 2 texElementSubImage2D() is not available here. Drawing with the 2D drawElementImage() fallback.');
    }
    canvas.addEventListener('contextlost', () => {
      enterPlainFallback('The 2D canvas lost its context. Showing the card as plain HTML.');
    });
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the card is shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (state.backend === 'webgl2') drawWebGLFrame(e);
  else if (state.backend === '2d') draw2DFallback();
});

// ---- Interactive controls inside the live card ----
titleInput.addEventListener('input', () => {
  state.cardDirty = true;
  requestRedraw();
});
chipsBtn.addEventListener('click', () => {
  state.chips += 10;
  updateCardDom();
});
multBtn.addEventListener('click', () => {
  state.mult += 1;
  updateCardDom();
});
suitBtn.addEventListener('click', () => {
  state.suitIdx = (state.suitIdx + 1) % SUITS.length;
  updateCardDom();
});
sealBtn.addEventListener('click', () => {
  state.sealIdx = (state.sealIdx + 1) % SEALS.length;
  updateCardDom();
});

// ---- Edition, tilt and Obra Dinn controls outside the canvas ----
function setEdition(next) {
  state.edition = next;
  for (const b of document.querySelectorAll('[data-edition]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.edition) === next));
  }
  obraRow.classList.toggle('is-muted', next !== 4);
  updateCardDom();
}

for (const b of document.querySelectorAll('[data-edition]')) {
  b.addEventListener('click', () => setEdition(Number(b.dataset.edition)));
}

const TILT_PRESETS = {
  flat: { yaw: 0, pitch: 0 },
  showcase: { yaw: 24, pitch: -14 },
  grazing: { yaw: -32, pitch: 18 },
};

function clearTiltPresets() {
  for (const b of document.querySelectorAll('[data-tilt]')) b.setAttribute('aria-pressed', 'false');
}

function setAutoOrbit(enabled) {
  if (enabled && reducedMotion?.matches) {
    state.autoOrbit = false;
    orbitBtn.setAttribute('aria-pressed', 'false');
    showNotice('Auto-orbit stays paused while reduced motion is on.');
    return;
  }
  state.autoOrbit = enabled;
  state.orbitStart = 0;
  orbitBtn.setAttribute('aria-pressed', String(enabled));
  if (enabled) {
    clearTiltPresets();
    wakeMotion();
  } else if (!holdChk.checked) {
    state.targetYaw = 0;
    state.targetPitch = 0;
    wakeMotion();
  }
}

for (const b of document.querySelectorAll('[data-tilt]')) {
  b.addEventListener('click', () => {
    setAutoOrbit(false);
    clearTiltPresets();
    b.setAttribute('aria-pressed', 'true');
    const p = TILT_PRESETS[b.dataset.tilt];
    state.targetYaw = p.yaw;
    state.targetPitch = p.pitch;
    wakeMotion();
  });
}

orbitBtn.addEventListener('click', () => setAutoOrbit(!state.autoOrbit));

for (const b of document.querySelectorAll('[data-dither]')) {
  b.addEventListener('click', () => {
    state.ditherMode = b.dataset.dither === 'screen' ? 1 : 0;
    for (const o of document.querySelectorAll('[data-dither]')) {
      o.setAttribute('aria-pressed', String(o === b));
    }
    if (state.edition !== 4) setEdition(4);
    else updateCardDom();
  });
}

for (const b of document.querySelectorAll('[data-palette]')) {
  b.addEventListener('click', () => {
    state.paletteMode = Number(b.dataset.palette);
    for (const o of document.querySelectorAll('[data-palette]')) {
      o.setAttribute('aria-pressed', String(o === b));
    }
    if (state.edition !== 4) setEdition(4);
    else requestRedraw();
  });
}

ditherRange.addEventListener('input', () => {
  state.ditherScale = Number(ditherRange.value);
  ditherOut.textContent = `${state.ditherScale.toFixed(2).replace(/\.00$/, '.0')}x`;
  if (state.edition !== 4) setEdition(4);
  else requestRedraw();
});

// ---- Pointer dragging for 3D tilt + hover reflections ----
let dragState = null;

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain' || e.button > 0) return;
  if (e.target?.closest?.('button, input, select, textarea, label, a')) return;
  setAutoOrbit(false);
  clearTiltPresets();
  dragState = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    yaw: state.yaw,
    pitch: state.pitch,
  };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    state.pointerX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.pointerY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  }
  if (dragState && e.pointerId === dragState.id) {
    const dx = e.clientX - dragState.x;
    const dy = e.clientY - dragState.y;
    const nextYaw = Math.max(-38, Math.min(38, dragState.yaw + dx * 0.28));
    const nextPitch = Math.max(-32, Math.min(32, dragState.pitch - dy * 0.28));
    state.yaw = nextYaw;
    state.pitch = nextPitch;
    state.targetYaw = nextYaw;
    state.targetPitch = nextPitch;
    requestRedraw();
    return;
  }
  if (e.pointerType === 'mouse' && state.backend === 'webgl2') {
    requestRedraw();
  }
});

const endDrag = (e) => {
  if (!dragState || e.pointerId !== dragState.id) return;
  dragState = null;
  canvas.classList.remove('dragging');
  if (holdChk.checked) {
    state.targetYaw = state.yaw;
    state.targetPitch = state.pitch;
  } else {
    state.targetYaw = 0;
    state.targetPitch = 0;
    document.querySelector('[data-tilt="flat"]')?.setAttribute('aria-pressed', 'true');
  }
  wakeMotion();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Pause offscreen or when tab hides, and snap motion under reduced motion.
if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = !!entry?.isIntersecting;
    if (state.onScreen) {
      if (state.autoOrbit) wakeMotion();
      else requestRedraw();
    } else {
      stopLoop();
    }
  }, { rootMargin: '120px 0px' }).observe(stageWrap);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (state.onScreen) {
    if (state.autoOrbit) wakeMotion();
    else requestRedraw();
  }
});

reducedMotion?.addEventListener?.('change', () => {
  if (reducedMotion.matches) {
    state.autoOrbit = false;
    orbitBtn.setAttribute('aria-pressed', 'false');
    stopLoop();
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
    requestRedraw();
  }
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => requestRedraw()).observe(canvas);
}

updateCardDom();

// ---- Live checks (isolated fixtures on testStage) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = (ok, detail) => { if (!ok) throw new Error(detail); return detail; };

async function glFixture(w, h, html) {
  if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `flex:none;display:block;width:${w}px;height:${h}px;`;
  cv.innerHTML = html;
  testStage().append(cv);
  const glStage = new ElementGL(cv, {
    fragment: CARD_FRAG,
    attributes: { preserveDrawingBuffer: true },
  });
  const bnTex = createBlueNoiseTexture(glStage.gl, blueNoiseBytes, BLUE_NOISE_SIZE);
  const done = async () => {
    if (!glStage.lost) glStage.gl.deleteTexture(bnTex);
    glStage.dispose();
    cv.remove();
    window.__gfx?.active?.();
    window.__gfx?.retire?.(cv);
    await sleep(230);
    window.__gfx?.release?.(cv);
  };
  return { cv, glStage, bnTex, done };
}

function drawFixtureQuad(glStage, bnTex, el, mat, w, h, cw, ch, opts = {}) {
  const gl = glStage.gl;
  glStage.begin([0, 0, 0, 0]);
  glStage.quad(el, toClip(mat, w, h, cw, ch), (g, u) => {
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, bnTex);
    g.uniform1i(u('uBlueNoise'), 1);
    g.uniform1i(u('uEdition'), opts.edition ?? 0);
    g.uniform2f(u('uTilt'), opts.tiltX ?? 0.25, opts.tiltY ?? -0.15);
    g.uniform2f(u('uPointer'), 0.5, 0.5);
    g.uniform1i(u('uDitherMode'), opts.ditherMode ?? 0);
    g.uniform1i(u('uPaletteMode'), opts.paletteMode ?? 0);
    g.uniform1f(u('uDitherScale'), opts.ditherScale ?? 1.5);
    g.uniform1f(u('uSphereRadius'), SPHERE_RADIUS);
    g.uniform1f(u('uDpr'), glStage.canvas.width / Math.max(1, cw));
    g.uniform1i(u('uExactFixture'), opts.exactFixture ?? 0);
  });
  return gl.getError();
}

runTests($('tests'), [
  {
    name: 'ElementGL + texElementSubImage2D() renders all 5 editions with gl.getError() === 0',
    expect: 'pass',
    why: 'Uploads one fixture card into ElementGL, switches uEdition from 0 to 4, checks gl.getError() === gl.NO_ERROR and confirms opaque rendered pixels on each.',
    run: async () => {
      const fx = await glFixture(
        160,
        160,
        '<div id="fx-card" drawable style="position:absolute;left:0;top:0;width:120px;height:120px;border-radius:10px;background:linear-gradient(135deg,#f8f3e4,#7d7465);border:3px solid #2b2419;color:#14120e;padding:12px;font:700 16px Georgia,serif">ACE</div>'
      );
      try {
        await nextPaint(fx.cv);
        const el = fx.cv.querySelector('#fx-card');
        const uploaded = fx.glStage.upload(el);
        const mat = new DOMMatrix().translate(20, 20);
        const samples = [];
        for (let ed = 0; ed < 5; ed++) {
          const err = drawFixtureQuad(fx.glStage, fx.bnTex, el, mat, 120, 120, 160, 160, { edition: ed });
          if (err !== fx.glStage.gl.NO_ERROR) throw new Error(`edition ${ed} reported GL error ${err}`);
          const px = new Uint8Array(4);
          fx.glStage.gl.readPixels(Math.floor(fx.cv.width / 2), Math.floor(fx.cv.height / 2), 1, 1, fx.glStage.gl.RGBA, fx.glStage.gl.UNSIGNED_BYTE, px);
          if (px[3] < 200) throw new Error(`edition ${ed} sampled transparent center alpha=${px[3]}`);
          samples.push(`${EDITIONS[ed].name.split(' ')[0]}:${px[0]},${px[1]},${px[2]}`);
        }
        return need(Boolean(uploaded), `Uploaded ${uploaded.w}x${uploaded.h}; 5 editions gl.getError()===0 (${samples.join(' | ')}).`);
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Obra Dinn 1-bit mode outputs strictly binary two-tone palette colors across shaded gradient fixtures',
    expect: 'pass',
    why: 'Renders a full tonal gradient in both Sphere-locked and Screen-space modes and checks every sampled pixel matches #333319 (51,51,25) or #e5ffff (229,255,255) with zero intermediate greys.',
    run: async () => {
      const fx = await glFixture(
        128,
        96,
        '<div id="fx-grad" drawable style="position:absolute;left:0;top:0;width:128px;height:96px;background:linear-gradient(135deg,#000000 0%,#4f4f4f 35%,#a6a6a6 70%,#ffffff 100%)"></div>'
      );
      try {
        await nextPaint(fx.cv);
        const el = fx.cv.querySelector('#fx-grad');
        fx.glStage.upload(el);
        const mat = new DOMMatrix();
        const stats = [];

        for (const ditherMode of [0, 1]) {
          const err = drawFixtureQuad(fx.glStage, fx.bnTex, el, mat, 128, 96, 128, 96, {
            edition: 4,
            ditherMode,
            paletteMode: 0,
            ditherScale: 1.5,
            exactFixture: 1,
          });
          if (err !== fx.glStage.gl.NO_ERROR) throw new Error(`GL error ${err} in ditherMode=${ditherMode}`);
          const w = fx.cv.width, h = fx.cv.height;
          const pixels = new Uint8Array(w * h * 4);
          fx.glStage.gl.readPixels(0, 0, w, h, fx.glStage.gl.RGBA, fx.glStage.gl.UNSIGNED_BYTE, pixels);

          let dark = 0, light = 0, other = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            if (r === 51 && g === 51 && b === 25) dark++;
            else if (r === 229 && g === 255 && b === 255) light++;
            else other++;
          }
          if (other > 0) throw new Error(`mode ${ditherMode} produced ${other} non-binary pixels`);
          if (dark === 0 || light === 0) throw new Error(`mode ${ditherMode} collapsed to single tone (dark=${dark}, light=${light})`);
          stats.push(`${ditherMode === 0 ? 'sphere' : 'screen'}=${dark}d/${light}l`);
        }
        return `Strictly binary #333319 / #e5ffff across ${fx.cv.width}x${fx.cv.height} gradient (${stats.join(', ')}, 0 intermediate pixels).`;
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Tilt perspective updateElementGeometry() scaled by geometryUnit() lands elementsFromPoint() on the live card button',
    expect: 'pass',
    why: 'Applies a 24 deg yaw / -14 deg pitch perspective DOMMatrix scaled by geometryUnit() to an isolated fixture card and verifies document.elementsFromPoint() reaches the tilted button.',
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 240, ch = 220, w = 160, h = 180;
      const fx = await glFixture(
        cw,
        ch,
        `<div id="fx-tilt" drawable style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#efe6cf;border:2px solid #6b5431;">` +
        '<button id="fx-btn" type="button" style="position:absolute;left:88px;top:112px;width:56px;height:44px;">Hit</button></div>'
      );
      try {
        await nextPaint(fx.cv);
        const card = fx.cv.querySelector('#fx-tilt');
        const btn = fx.cv.querySelector('#fx-btn');
        fx.glStage.upload(card);
        const mat = buildCardMatrix(cw, ch, 24, -14, w, h);
        const err = drawFixtureQuad(fx.glStage, fx.bnTex, card, mat, w, h, cw, ch, { edition: 0, tiltX: 0.4, tiltY: -0.24 });
        if (err !== fx.glStage.gl.NO_ERROR) throw new Error(`GL error ${err}`);

        const unit = geometryUnit(fx.cv, card, w);
        fx.cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit).multiply(mat) });
        card.dataset.hitTick = '1';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const pt = mat.transformPoint(new DOMPoint(116, 134, 0, 1));
        const sx = pt.x / pt.w;
        const sy = pt.y / pt.w;
        const r = fx.cv.getBoundingClientRect();
        const hits = document.elementsFromPoint(r.left + sx, r.top + sy);
        if (!hits.includes(btn)) {
          throw new Error(`elementsFromPoint(${(r.left + sx).toFixed(1)}, ${(r.top + sy).toFixed(1)}) missed button; top=<${hits[0]?.tagName?.toLowerCase() ?? 'none'}>`);
        }
        return `elementsFromPoint() hit <button#fx-btn> at (${sx.toFixed(1)}, ${sy.toFixed(1)}) CSS px (geometryUnit=${unit.toFixed(2)}).`;
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Context-loss fallback preserves DOM state safely without calling loseContext()',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated wrapper to confirm edited input text and counter text stay intact.',
    run: async () => {
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'FOIL TEST 77';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Chips: 80';
      card.append(input, btn);
      cv.append(card);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let lostHandled = false;
      let restoredHandled = false;
      cv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        lostHandled = true;
        plain.append(card);
      });
      cv.addEventListener('webglcontextrestored', () => {
        restoredHandled = true;
        cv.append(card);
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const plainOk = lostEv.defaultPrevented && lostHandled && card.parentElement === plain && input.value === 'FOIL TEST 77' && btn.textContent === 'Chips: 80';

      cv.dispatchEvent(new Event('webglcontextrestored'));
      const restoredOk = restoredHandled && card.parentElement === cv && input.value === 'FOIL TEST 77' && btn.textContent === 'Chips: 80';

      wrap.remove();
      window.__gfx?.retire?.(cv);
      return need(plainOk && restoredOk, `Preserved "${input.value}" and "${btn.textContent}" across webglcontextlost -> plain HTML -> webglcontextrestored.`);
    },
  },
]);
