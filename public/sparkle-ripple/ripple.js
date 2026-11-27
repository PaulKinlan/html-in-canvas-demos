import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const MAX_RIPPLES = 4;
export const DEFAULT_DURATION_MS = 960;

export const PALETTES = [
  {
    name: 'Violet',
    key: 'violet',
    primary: [0.78, 0.62, 1.0],
    secondary: [0.42, 0.86, 1.0],
    highlight: [1.0, 0.74, 0.94],
    cssPrimary: '#d0bcff',
    cssSecondary: '#7dd3fc',
  },
  {
    name: 'Mint',
    key: 'mint',
    primary: [0.42, 0.94, 0.86],
    secondary: [0.56, 0.78, 1.0],
    highlight: [0.85, 1.0, 0.72],
    cssPrimary: '#7ee8dc',
    cssSecondary: '#93c5fd',
  },
  {
    name: 'Amber',
    key: 'amber',
    primary: [1.0, 0.72, 0.40],
    secondary: [1.0, 0.52, 0.76],
    highlight: [1.0, 0.92, 0.60],
    cssPrimary: '#ffb876',
    cssSecondary: '#f9a8d4',
  },
];

// DOM references
const stageBox = document.getElementById('sr-stage');
const viewportEl = document.getElementById('sr-viewport');
let canvas = document.getElementById('sr-canvas');
const surfaceEl = document.getElementById('sr-surface');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('sr-notice');
const statusEl = document.getElementById('sr-status');
const testsBody = document.getElementById('tests');

// Live DOM controls inside <canvas>
const statusInput = document.getElementById('sr-status-input');
const modeBadge = document.getElementById('sr-mode-badge');
const mediaMeta = document.getElementById('sr-media-meta');
const mediaCard = document.getElementById('sr-media-card');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnBoost = document.getElementById('btn-boost');
const paletteChips = Array.from(document.querySelectorAll('#sr-chips button[data-palette]'));
const swEdgeGlow = document.getElementById('sw-edge-glow');
const swShimmer = document.getElementById('sw-shimmer');

// External controls outside <canvas>
const modeButtons = Array.from(document.querySelectorAll('#sr-modes button[data-mode]'));
const ctlDensity = document.getElementById('ctl-density');
const outDensity = document.getElementById('out-density');
const ctlSpeed = document.getElementById('ctl-speed');
const outSpeed = document.getElementById('out-speed');
const btnBurst = document.getElementById('btn-burst');
const ctlReduced = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) ctlReduced.checked = true;

// #region ripple-pack
export function computeMaxRadius(x, y, cw, ch) {
  return Math.max(
    40,
    Math.hypot(x, y),
    Math.hypot(cw - x, y),
    Math.hypot(x, ch - y),
    Math.hypot(cw - x, ch - y)
  ) + 28;
}

export function createRippleState() {
  return { list: [], nextSeed: 1 };
}

export function launchRipple(rippleState, {
  x,
  y,
  cw,
  ch,
  tMs,
  speed = 1.0,
  durationBaseMs = DEFAULT_DURATION_MS,
  colorIdx = 0,
}) {
  const durationMs = Math.max(220, durationBaseMs / Math.max(0.25, speed));
  const maxRadius = computeMaxRadius(x, y, cw, ch);
  while (rippleState.list.length >= MAX_RIPPLES) {
    rippleState.list.shift();
  }
  const seed = (rippleState.nextSeed++ * 1.37) % 100;
  const entry = {
    x,
    y,
    startMs: tMs,
    durationMs,
    maxRadius,
    colorIdx,
    seed,
  };
  rippleState.list.push(entry);
  return entry;
}

export function stepRipples(rippleState, tMs) {
  const active = [];
  for (const r of rippleState.list) {
    const elapsed = tMs - r.startMs;
    if (elapsed < r.durationMs) {
      active.push(r);
    }
  }
  rippleState.list = active;
  return active.length;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function packRippleUniforms(rippleState, tMs, out = null) {
  const origins = out?.origins ?? new Float32Array(MAX_RIPPLES * 4);
  const meta = out?.meta ?? new Float32Array(MAX_RIPPLES * 4);
  origins.fill(0);
  meta.fill(0);

  let count = 0;
  for (let i = 0; i < rippleState.list.length && count < MAX_RIPPLES; i++) {
    const r = rippleState.list[i];
    const rawElapsed = tMs - r.startMs;
    if (rawElapsed >= r.durationMs) continue;
    const elapsed = Math.max(0, rawElapsed);
    const p = elapsed / r.durationMs;
    const fadeIn = smoothstep(0.0, 0.06, p);
    const fadeOut = 1.0 - smoothstep(0.36, 1.0, p);
    const fade = Math.max(0, Math.min(1, fadeIn * fadeOut));

    const off = count * 4;
    origins[off] = r.x;
    origins[off + 1] = r.y;
    origins[off + 2] = p;
    origins[off + 3] = r.maxRadius;

    meta[off] = elapsed / 1000;
    meta[off + 1] = r.seed;
    meta[off + 2] = r.colorIdx;
    meta[off + 3] = fade;
    count++;
  }
  return { count, origins, meta };
}
// #endregion ripple-pack

// #region ripple-shader
export const RIPPLE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uTexSize;
uniform float uTime;
uniform int uMode;          // 0 = Pixel sparkle, 1 = Noisy ink only, 2 = Flat circle CSS-like
uniform float uDensity;     // 0.0 .. 2.0
uniform float uReduced;     // 1.0 suppresses flicker, turbulence & chromatic shift
uniform float uEdgeGlow;    // 1.0 illuminates sampled DOM edges
uniform float uChromatic;   // 1.0 adds chromatic wave shimmer
uniform int uRippleCount;
uniform vec4 uRippleOrigins[4]; // xy = tap CSS px, z = progress 0..1, w = maxRadius CSS px
uniform vec4 uRippleMeta[4];    // x = ageSec, y = seed, z = colorIdx, w = fade 0..1

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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

float sampleLum(vec4 c) {
  return dot(c.rgb, vec3(0.299, 0.587, 0.114));
}

void paletteColors(float idx, out vec3 cA, out vec3 cB, out vec3 cWarm) {
  if (idx < 0.5) {
    cA = vec3(0.78, 0.62, 1.00);
    cB = vec3(0.42, 0.86, 1.00);
    cWarm = vec3(1.00, 0.74, 0.94);
  } else if (idx < 1.5) {
    cA = vec3(0.42, 0.94, 0.86);
    cB = vec3(0.56, 0.78, 1.00);
    cWarm = vec3(0.85, 1.00, 0.72);
  } else {
    cA = vec3(1.00, 0.72, 0.40);
    cB = vec3(1.00, 0.52, 0.76);
    cWarm = vec3(1.00, 0.92, 0.60);
  }
}

float sparkleGrid(vec2 pCss, float cellSize, float density, float ageSec, float seed, float starWeight) {
  vec2 g = pCss / cellSize;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 rnd = hash22(id + vec2(seed * 13.7, seed * 7.1));
  float thresh = clamp(1.0 - (starWeight > 0.5 ? 0.16 : 0.34) * density, 0.06, 0.99);
  if (rnd.x < thresh) return 0.0;

  vec2 center = 0.18 + 0.64 * fract(rnd * vec2(3.7, 5.3));
  vec2 dv = f - center;
  float dist = length(dv);
  float dotCore = smoothstep(starWeight > 0.5 ? 0.17 : 0.27, 0.02, dist);

  float star = 0.0;
  if (starWeight > 0.5) {
    float crossH = max(0.0, 1.0 - abs(dv.x) * 3.8) * max(0.0, 1.0 - abs(dv.y) * 14.0);
    float crossV = max(0.0, 1.0 - abs(dv.y) * 3.8) * max(0.0, 1.0 - abs(dv.x) * 14.0);
    star = (crossH + crossV) * 0.95;
  }

  float freq = 8.5 + rnd.y * 14.0;
  float twinkle = pow(0.5 + 0.5 * sin(ageSec * freq + rnd.x * 53.0), 2.1);
  return (dotCore + star) * (0.25 + 0.95 * twinkle);
}

void main() {
  vec4 base = texture(uTex, vUv);
  if (uRippleCount <= 0) {
    outColor = base;
    return;
  }

  vec2 pCss = vUv * uSize;
  vec2 texel = 1.25 / max(uTexSize, vec2(1.0));

  float edgeMag = 0.0;
  if (uEdgeGlow > 0.5 && uMode != 2) {
    vec4 nN = texture(uTex, clamp(vUv + vec2(0.0, -texel.y), vec2(0.0), vec2(1.0)));
    vec4 nS = texture(uTex, clamp(vUv + vec2(0.0, texel.y), vec2(0.0), vec2(1.0)));
    vec4 nE = texture(uTex, clamp(vUv + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0)));
    vec4 nW = texture(uTex, clamp(vUv + vec2(-texel.x, 0.0), vec2(0.0), vec2(1.0)));
    float dl = abs(sampleLum(nE) - sampleLum(nW)) + abs(sampleLum(nS) - sampleLum(nN));
    float da = abs(nE.a - nW.a) + abs(nS.a - nN.a);
    edgeMag = clamp(dl * 2.2 + da * 1.4, 0.0, 1.0);
  }

  vec3 inkLight = vec3(0.0);
  vec3 sparkleLight = vec3(0.0);
  vec3 edgeLight = vec3(0.0);
  vec2 crestDir = vec2(0.0);
  float totalWash = 0.0;
  float totalCrest = 0.0;
  float totalSpark = 0.0;

  for (int i = 0; i < 4; i++) {
    if (i >= uRippleCount) break;
    vec2 origin = uRippleOrigins[i].xy;
    float p = clamp(uRippleOrigins[i].z, 0.0, 1.0);
    float maxR = max(uRippleOrigins[i].w, 1.0);
    float ageSec = uRippleMeta[i].x;
    float seed = uRippleMeta[i].y;
    float colorIdx = uRippleMeta[i].z;
    float fade = clamp(uRippleMeta[i].w, 0.0, 1.0);
    if (fade <= 0.001) continue;

    float easeP = 1.0 - pow(1.0 - p, 2.25);
    float radius = maxR * easeP;
    vec2 dVec = pCss - origin;
    float dist = length(dVec);
    vec2 dir = dist > 0.001 ? dVec / dist : vec2(1.0, 0.0);

    float noisyDist = dist;
    if (uMode != 2 && uReduced < 0.5) {
      float n1 = valueNoise(pCss * 0.028 + dir * (-ageSec * 2.1) + vec2(seed * 3.1, seed * 7.3));
      float n2 = valueNoise(pCss * 0.068 + vec2(ageSec * 1.3, -ageSec * 1.8) + vec2(seed * 11.7, 2.9));
      float turb = (n1 * 0.65 + n2 * 0.35) - 0.5;
      float amp = 26.0 * smoothstep(0.0, 0.18, p) * (1.0 - 0.30 * p);
      noisyDist = dist + turb * amp;
    }

    float edgeSoft = (uMode == 2) ? 2.0 : 18.0;
    float discMask = 1.0 - smoothstep(radius - edgeSoft, radius + 2.5, noisyDist);
    float ringW = (uMode == 2) ? 3.5 : (14.0 + 16.0 * p);
    float crest = exp(-pow((noisyDist - radius * 0.93) / max(ringW, 1.0), 2.0));
    float innerRing = (uMode == 2 || uReduced > 0.5)
      ? 0.0
      : 0.42 * exp(-pow((noisyDist - radius * 0.64) / max(ringW * 0.85, 1.0), 2.0));

    vec3 cA, cB, cWarm;
    paletteColors(colorIdx, cA, cB, cWarm);

    vec3 tint = cA;
    if (uChromatic > 0.5 && uMode == 0 && uReduced < 0.5) {
      float prism = atan(dir.y, dir.x) * 2.0 + noisyDist * 0.032 - ageSec * 4.8;
      tint = mix(cA, cB, 0.5 + 0.5 * sin(prism));
      tint = mix(tint, cWarm, clamp(crest * 0.6, 0.0, 1.0));
    } else if (uMode != 2) {
      tint = mix(cA, cB, 0.28 * crest);
    }

    if (uMode == 2) {
      float flatFill = discMask * 0.24 * fade;
      float flatRim = crest * 0.14 * fade;
      totalWash = max(totalWash, flatFill + flatRim);
      inkLight += tint * (flatFill + flatRim * 1.1);
    } else if (uReduced > 0.5) {
      float calmFill = discMask * (0.14 + 0.28 * crest) * fade;
      totalWash = max(totalWash, calmFill);
      inkLight += tint * calmFill;
      edgeLight += mix(tint, vec3(1.0), 0.25) * edgeMag * crest * fade * 0.55;
    } else {
      float waveFill = discMask * (0.16 + 0.46 * crest + 0.22 * innerRing) * fade;
      totalWash = max(totalWash, waveFill);
      inkLight += tint * waveFill;
      totalCrest += crest * fade;
      crestDir += dir * (crest * fade);

      if (uEdgeGlow > 0.5 && edgeMag > 0.005) {
        vec3 edgeTint = mix(tint, vec3(1.0), 0.35);
        edgeLight += edgeTint * edgeMag * (crest * 1.10 + waveFill * 0.65) * fade;
      }

      if (uMode == 0 && uDensity > 0.01 && discMask > 0.02) {
        float sFine = sparkleGrid(pCss, 5.2, uDensity, ageSec, seed + 1.1, 0.0);
        float sStar = sparkleGrid(pCss + vec2(3.5, 6.2), 14.0, uDensity, ageSec, seed + 4.7, 1.0);
        float spZone = discMask * (0.34 + 1.15 * crest + 0.38 * innerRing) * fade;
        float sp = (sFine * 0.85 + sStar * 1.15) * spZone;
        totalSpark += sp;
        vec3 spCol = mix(tint, vec3(1.0), 0.58);
        sparkleLight += spCol * sp;
      }
    }
  }

  vec3 baseRgb = base.rgb;
  if (uChromatic > 0.5 && uMode == 0 && uReduced < 0.5 && totalCrest > 0.01) {
    vec2 disp = crestDir * (1.75 / max(uTexSize, vec2(1.0)));
    float rCh = texture(uTex, clamp(vUv + disp, vec2(0.0), vec2(1.0))).r;
    float bCh = texture(uTex, clamp(vUv - disp, vec2(0.0), vec2(1.0))).b;
    float chMix = clamp(totalCrest * 0.48, 0.0, 0.55);
    baseRgb.r = mix(baseRgb.r, rCh, chMix);
    baseRgb.b = mix(baseRgb.b, bCh, chMix);
  }

  float lum = dot(baseRgb, vec3(0.299, 0.587, 0.114));
  float brightDamp = 1.0 - smoothstep(0.45, 0.90, lum) * 0.72;
  float brightSoften = smoothstep(0.55, 0.98, lum) * clamp(totalWash, 0.0, 1.0) * 0.34;
  vec3 tintedBase = baseRgb * (1.0 - brightSoften);
  vec3 added = inkLight * (0.50 + 0.38 * base.a) * brightDamp + edgeLight * 0.90 + sparkleLight * (0.52 + 0.44 * brightDamp);
  float addAlpha = clamp(totalWash * 0.72 + totalSpark * 0.75 + length(edgeLight) * 0.4, 0.0, 1.0);
  float outA = clamp(base.a + addAlpha * (1.0 - base.a), 0.0, 1.0);
  vec3 outRgb = clamp(tintedBase + added, vec3(0.0), vec3(outA));

  outColor = vec4(outRgb, outA);
}
`;
// #endregion ripple-shader

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  rippleMode: 'sparkle', // 'sparkle' | 'ink' | 'flat'
  paletteIdx: 0,
  density: 1.0,
  speed: 1.0,
  playing: true,
  boosted: false,
  edgeGlow: true,
  chromatic: true,
  reducedOverride: ctlReduced.checked,
  hasPainted: false,
  domDirty: true,
  onScreen: true,
  uploads: 0,
  paints: 0,
  rafId: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoKeyRef: { value: '' },
};

const ripples = createRippleState();
const packedScratch = {
  origins: new Float32Array(MAX_RIPPLES * 4),
  meta: new Float32Array(MAX_RIPPLES * 4),
};

let stage = null;
let ctx2d = null;

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function getViewportSize() {
  const cw = Math.max(200, canvas.clientWidth || viewportEl.clientWidth || 356);
  const ch = Math.max(200, canvas.clientHeight || viewportEl.clientHeight || 400);
  return { cw, ch };
}

function syncSurfaceSize(cw, ch) {
  if (state.mode === 'plain') {
    surfaceEl.style.width = '';
    surfaceEl.style.height = '';
    return;
  }
  const w = `${cw}px`;
  const h = `${ch}px`;
  if (surfaceEl.style.width !== w) surfaceEl.style.width = w;
  if (surfaceEl.style.height !== h) surfaceEl.style.height = h;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function updateStatus(nowMs = performance.now()) {
  const route =
    state.mode === 'webgl' ? 'WebGL 2 ElementGL'
      : state.mode === '2d' ? '2D drawElementImage()'
        : 'Plain HTML';
  const modeName =
    state.rippleMode === 'sparkle' ? 'Pixel sparkle'
      : state.rippleMode === 'ink' ? 'Noisy ink'
        : 'Flat circle';
  const active = stepRipples(ripples, nowMs);
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${route} · ${modeName} · ${active}/${MAX_RIPPLES} ripples · ${canvas.width}x${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

function syncExternalControls() {
  for (const btn of modeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.rippleMode));
  }
  outDensity.textContent = `${Math.round(state.density * 100)}%`;
  outSpeed.textContent = `${state.speed.toFixed(1)}x`;
}

function syncMediaDOM() {
  const playLabel = state.playing ? 'Pause' : 'Play';
  if (btnPlayPause.textContent !== playLabel) btnPlayPause.textContent = playLabel;
  btnPlayPause.setAttribute('aria-pressed', String(state.playing));
  btnBoost.setAttribute('aria-pressed', String(state.boosted));
  mediaCard.dataset.playing = String(state.playing);
  mediaCard.dataset.boost = String(state.boosted);
  const nextMeta = `${state.playing ? 'Playing' : 'Paused'} · ${state.boosted ? 'Bass boost on' : '48 kHz spatial'}`;
  if (mediaMeta.textContent !== nextMeta) mediaMeta.textContent = nextMeta;
  const pal = PALETTES[state.paletteIdx];
  const nextBadge = `${pal.name.toUpperCase()} · ${state.playing ? 'LIVE' : 'PAUSED'}`;
  if (modeBadge.textContent !== nextBadge) modeBadge.textContent = nextBadge;
  surfaceEl.dataset.palette = pal.key;
  for (const chip of paletteChips) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.palette) === state.paletteIdx));
  }
  swEdgeGlow.setAttribute('aria-checked', String(state.edgeGlow));
  swShimmer.setAttribute('aria-checked', String(state.chromatic));
  state.domDirty = true;
  canvas.requestPaint?.();
}

// #region hit-geometry
export function syncSurfaceGeometry({
  canvasEl,
  targetEl,
  mode,
  cw,
  unitCache,
  lastGeoKeyRef,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;
  const elemW = Math.max(1, targetEl.offsetWidth || cw);
  const key = `${mode}|${cw}|${elemW}|${canvasEl.width}x${canvasEl.height}`;
  if (!force && lastGeoKeyRef.value === key) return;
  lastGeoKeyRef.value = key;

  const zoom = targetEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${elemW}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, targetEl, elemW);
    unitCache.key = uKey;
  }
  const u = unitCache.unit || 1;
  canvasEl.updateElementGeometry(targetEl, {
    canvasTransform: new DOMMatrix().scale(u, u),
  });
  targetEl.dataset.hitTick = targetEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion hit-geometry

// #region gl-upload
function tryUploadSurface() {
  if (!state.hasPainted || !stage || stage.lost) return null;
  try {
    const tex = stage.upload(surfaceEl);
    if (tex) {
      state.uploads++;
      state.domDirty = false;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return null;
    }
    throw err;
  }
}

function renderWebGL(tMs = performance.now(), forceGeo = false) {
  if (!state.hasPainted || !stage || stage.lost) return false;
  const { cw, ch } = getViewportSize();
  syncSurfaceSize(cw, ch);

  if (!stage.begin([0, 0, 0, 0])) return false;
  if (state.domDirty || !stage.has(surfaceEl)) {
    tryUploadSurface();
  }
  if (!stage.has(surfaceEl)) return false;

  stepRipples(ripples, tMs);
  const packed = packRippleUniforms(ripples, tMs, packedScratch);
  const modeCode = state.rippleMode === 'sparkle' ? 0 : state.rippleMode === 'ink' ? 1 : 2;
  const texW = surfaceEl.offsetWidth || cw;
  const texH = surfaceEl.offsetHeight || ch;

  stage.quad(surfaceEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.uniform2f(loc('uTexSize'), texW, texH);
    gl.uniform1i(loc('uMode'), modeCode);
    gl.uniform1f(loc('uDensity'), state.density);
    gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1.0 : 0.0);
    gl.uniform1f(loc('uEdgeGlow'), state.edgeGlow ? 1.0 : 0.0);
    gl.uniform1f(loc('uChromatic'), state.chromatic ? 1.0 : 0.0);
    gl.uniform1i(loc('uRippleCount'), packed.count);
    gl.uniform4fv(loc('uRippleOrigins[0]'), packed.origins);
    gl.uniform4fv(loc('uRippleMeta[0]'), packed.meta);
  });

  syncSurfaceGeometry({
    canvasEl: canvas,
    targetEl: surfaceEl,
    mode: state.mode,
    cw,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
    force: forceGeo,
  });

  state.paints++;
  updateStatus(tMs);
  return packed.count > 0;
}
// #endregion gl-upload

// #region fallback-2d
function hash2d(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function draw2DRipples(ctx, rippleState, tMs, { mode, density, reduced }) {
  const count = stepRipples(rippleState, tMs);
  if (count === 0) return false;

  for (const r of rippleState.list) {
    const elapsed = Math.max(0, tMs - r.startMs);
    const p = Math.max(0, Math.min(1, elapsed / r.durationMs));
    const easeP = 1 - Math.pow(1 - p, 2.25);
    const radius = r.maxRadius * easeP;
    const fade = smoothstep(0.0, 0.06, p) * (1 - smoothstep(0.36, 1.0, p));
    if (fade <= 0.001 || radius <= 1) continue;

    const pal = PALETTES[r.colorIdx] || PALETTES[0];
    const [pr, pg, pb] = pal.primary;
    const rgb = `${Math.round(pr * 255)}, ${Math.round(pg * 255)}, ${Math.round(pb * 255)}`;
    const grad = ctx.createRadialGradient(r.x, r.y, Math.max(0, radius * 0.25), r.x, r.y, radius);
    grad.addColorStop(0, `rgba(${rgb}, ${(0.12 * fade).toFixed(3)})`);
    grad.addColorStop(0.84, `rgba(${rgb}, ${(0.28 * fade).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (mode === 'sparkle' && !reduced && density > 0.01) {
      const specks = Math.round(36 * density);
      const age = (tMs - r.startMs) / 1000;
      for (let i = 0; i < specks; i++) {
        const a = hash2d(r.seed + i * 1.7) * Math.PI * 2;
        const distFrac = 0.25 + 0.72 * hash2d(r.seed * 3.1 + i * 2.9);
        const sx = r.x + Math.cos(a) * radius * distFrac;
        const sy = r.y + Math.sin(a) * radius * distFrac;
        const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(age * (8 + (i % 7) * 2) + i));
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.75 * fade * tw).toFixed(3)})`;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      }
    }
    ctx.restore();
  }
  return rippleState.list.length > 0;
}

function render2DFallback(tMs = performance.now(), forceGeo = false) {
  if (!state.hasPainted || !ctx2d) return false;
  const { cw, ch } = getViewportSize();
  syncSurfaceSize(cw, ch);

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
  ctx2d.drawElementImage(surfaceEl, 0, 0, cw, ch);
  const active = draw2DRipples(ctx2d, ripples, tMs, {
    mode: state.rippleMode,
    density: state.density,
    reduced: isReducedMotion(),
  });
  ctx2d.restore();

  syncSurfaceGeometry({
    canvasEl: canvas,
    targetEl: surfaceEl,
    mode: state.mode,
    cw,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
    force: forceGeo,
  });

  state.paints++;
  updateStatus(tMs);
  return active;
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  stopLoop();
  stageBox.classList.add('is-plain');
  surfaceEl.inert = false;
  if (surfaceEl.parentElement !== plainHost) plainHost.append(surfaceEl);
  syncSurfaceSize(0, 0);
  showNotice(reason);
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (surfaceEl.parentElement !== canvas) canvas.append(surfaceEl);
  state.unitCache.key = '';
  state.lastGeoKeyRef.value = '';
  showNotice('');
}
// #endregion fallback-2d

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function drawCurrentFrame(tMs = performance.now(), forceGeo = false) {
  if (state.mode === 'plain') {
    updateStatus(tMs);
    return false;
  }
  if (!state.hasPainted) {
    canvas.requestPaint?.();
    return false;
  }
  if (state.mode === 'webgl' && stage && !stage.lost) {
    return renderWebGL(tMs, forceGeo);
  }
  if (state.mode === '2d' && ctx2d) {
    return render2DFallback(tMs, forceGeo);
  }
  return false;
}

function startLoop() {
  if (state.rafId || !state.onScreen || document.hidden || state.mode === 'plain') return;
  if (!ripples.list.length) return;
  state.rafId = requestAnimationFrame(tick);
}

function tick(nowMs) {
  state.rafId = 0;
  if (!state.onScreen || document.hidden || state.mode === 'plain') return;
  const keepGoing = drawCurrentFrame(nowMs);
  if (keepGoing) {
    state.rafId = requestAnimationFrame(tick);
  }
}

function spawnAtClientPoint(clientX, clientY, tMs = performance.now()) {
  if (state.mode === 'plain') return;
  const { cw, ch } = getViewportSize();
  const rect = canvas.getBoundingClientRect();
  const tapX = rect.width > 0 ? ((clientX - rect.left) * cw) / rect.width : cw * 0.5;
  const tapY = rect.height > 0 ? ((clientY - rect.top) * ch) / rect.height : ch * 0.5;
  launchRipple(ripples, {
    x: tapX,
    y: tapY,
    cw,
    ch,
    tMs,
    speed: state.speed,
    colorIdx: state.paletteIdx,
  });
  if (state.hasPainted) drawCurrentFrame(tMs);
  startLoop();
}

// Interactive DOM controls inside #sr-surface
btnPlayPause.addEventListener('click', () => {
  state.playing = !state.playing;
  syncMediaDOM();
});

btnBoost.addEventListener('click', () => {
  state.boosted = !state.boosted;
  syncMediaDOM();
});

for (const chip of paletteChips) {
  chip.addEventListener('click', () => {
    const idx = Number(chip.dataset.palette);
    if (!Number.isNaN(idx) && PALETTES[idx]) {
      state.paletteIdx = idx;
      if (ripples.list.length > 0) {
        ripples.list[ripples.list.length - 1].colorIdx = idx;
      }
      syncMediaDOM();
    }
  });
}

swEdgeGlow.addEventListener('click', () => {
  state.edgeGlow = !state.edgeGlow;
  syncMediaDOM();
  if (state.hasPainted) drawCurrentFrame(performance.now());
});

swShimmer.addEventListener('click', () => {
  state.chromatic = !state.chromatic;
  syncMediaDOM();
  if (state.hasPainted) drawCurrentFrame(performance.now());
});

statusInput.addEventListener('input', () => {
  state.domDirty = true;
  canvas.requestPaint?.();
});

// External controls
for (const btn of modeButtons) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.mode;
    if (next === 'sparkle' || next === 'ink' || next === 'flat') {
      state.rippleMode = next;
      syncExternalControls();
      if (state.hasPainted) drawCurrentFrame(performance.now());
      else updateStatus();
    }
  });
}

ctlDensity.addEventListener('input', () => {
  state.density = Math.max(0, Math.min(2, Number(ctlDensity.value) / 100));
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame(performance.now());
});

ctlSpeed.addEventListener('input', () => {
  state.speed = Math.max(0.4, Math.min(2.5, Number(ctlSpeed.value) || 1.0));
  syncExternalControls();
});

btnBurst.addEventListener('click', () => {
  const rect = mediaCard.getBoundingClientRect();
  const cvRect = canvas.getBoundingClientRect();
  const cx = rect.width > 0 ? rect.left + rect.width * 0.5 : cvRect.left + cvRect.width * 0.5;
  const cy = rect.height > 0 ? rect.top + rect.height * 0.5 : cvRect.top + cvRect.height * 0.5;
  spawnAtClientPoint(cx, cy, performance.now());
});

ctlReduced.addEventListener('change', () => {
  state.reducedOverride = ctlReduced.checked;
  if (state.hasPainted) drawCurrentFrame(performance.now());
});

reducedQuery.addEventListener?.('change', () => {
  ctlReduced.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (state.hasPainted) drawCurrentFrame(performance.now());
});

function wireCanvasEvents(cv) {
  // Launch ripple on any tap inside the canvas without blocking DOM clicks or <input> focus.
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (state.mode !== 'plain' && state.hasPainted) {
      const { cw } = getViewportSize();
      syncSurfaceGeometry({
        canvasEl: cv,
        targetEl: surfaceEl,
        mode: state.mode,
        cw,
        unitCache: state.unitCache,
        lastGeoKeyRef: state.lastGeoKeyRef,
      });
    }
    spawnAtClientPoint(e.clientX, e.clientY, performance.now());
  }, true);

  cv.addEventListener('paint', () => {
    state.hasPainted = true;
    state.domDirty = true;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      const keepGoing = renderWebGL(performance.now(), true);
      if (keepGoing) startLoop();
    } else if (state.mode === '2d' && ctx2d) {
      const keepGoing = render2DFallback(performance.now(), true);
      if (keepGoing) startLoop();
    }
  });

  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the Material surface in plain HTML.');
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
  const { cw, ch } = getViewportSize();
  syncSurfaceSize(cw, ch);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: RIPPLE_FRAG,
        onLost: () => {
          state.hasPainted = false;
          state.domDirty = true;
          enterPlainFallback('The WebGL 2 context was lost. Showing the Material surface in plain HTML until restored.');
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          state.domDirty = true;
          exitPlainFallback();
          const size = getViewportSize();
          syncSurfaceSize(size.cw, size.ch);
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
      fresh.id = 'sr-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(surfaceEl);
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
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument drawElementImage() 2D fallback.');
      }
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the Material surface is shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) {
      stopLoop();
    } else if (state.mode !== 'plain' && state.hasPainted) {
      const active = drawCurrentFrame(performance.now());
      if (active) startLoop();
    }
  }, { rootMargin: '120px' }).observe(stageBox);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.mode === 'plain') return;
    state.unitCache.key = '';
    state.lastGeoKeyRef.value = '';
    const { cw, ch } = getViewportSize();
    syncSurfaceSize(cw, ch);
    if (state.hasPainted) drawCurrentFrame(performance.now(), true);
    else canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.mode !== 'plain' && state.hasPainted) {
    const active = drawCurrentFrame(performance.now());
    if (active) startLoop();
  }
});

syncExternalControls();
syncMediaDOM();
updateStatus();
initBackend();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function luma(px) {
  return 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
}

function makeFixtureSurface(w = 240, h = 180) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;user-select:none`;

  const surf = document.createElement('div');
  surf.setAttribute('drawable', '');
  surf.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:12px;box-sizing:border-box;` +
    'background:#121520;color:#ececf4;font:600 13px system-ui;display:flex;flex-direction:column;gap:10px';

  const card = document.createElement('div');
  card.style.cssText =
    'padding:10px;border-radius:12px;background:#1a1e2c;border:1.5px solid #524b70;' +
    'display:flex;align-items:center;justify-content:space-between;gap:8px';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = 'Pixel Buds';
  inp.setAttribute('inputmode', 'none');
  inp.setAttribute('aria-label', 'Fixture status');
  inp.style.cssText =
    'width:110px;height:32px;padding:4px 8px;border-radius:8px;border:1px solid #524b70;' +
    'background:#0f121b;color:#f3f0ff;font:600 12px system-ui;user-select:text';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Play';
  btn.style.cssText =
    'width:72px;height:36px;border:0;border-radius:99px;background:#d0bcff;color:#2b1256;font:700 12px system-ui';

  card.append(inp, btn);
  surf.append(card);
  cv.append(surf);
  return { cv, surf, card, inp, btn };
}

function drawFixtureFrame(g, cv, surf, w, h, rippleState, tMs, opts = {}) {
  const packed = packRippleUniforms(rippleState, tMs);
  g.begin([0, 0, 0, 0]);
  g.quad(surf, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
    gl.uniform2f(loc('uTexSize'), surf.offsetWidth || w, surf.offsetHeight || h);
    gl.uniform1i(loc('uMode'), opts.mode ?? 0);
    gl.uniform1f(loc('uDensity'), opts.density ?? 1.2);
    gl.uniform1f(loc('uReduced'), opts.reduced ?? 0.0);
    gl.uniform1f(loc('uEdgeGlow'), opts.edgeGlow ?? 1.0);
    gl.uniform1f(loc('uChromatic'), opts.chromatic ?? 1.0);
    gl.uniform1i(loc('uRippleCount'), packed.count);
    gl.uniform4fv(loc('uRippleOrigins[0]'), packed.origins);
    gl.uniform4fv(loc('uRippleMeta[0]'), packed.meta);
  });
  return packed;
}

runTests(testsBody, [
  {
    name: 'ElementGL upload and baseline draw with zero GL errors',
    expect: 'pass',
    why: 'Creates one ElementGL context on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), draws at uRippleCount = 0 and checks gl.getError() === 0.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 180;
      const { cv, surf } = makeFixtureSurface(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: RIPPLE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const tex = g.upload(surf);
        const rState = createRippleState();
        drawFixtureFrame(g, cv, surf, W, H, rState, 0);
        const err = g.gl.getError();
        const bgPx = readCssPixel(g.gl, cv, W, H, W * 0.5, H - 20);
        const btnPx = readCssPixel(g.gl, cv, W, H, W - 44, 38);
        return need(
          err === g.gl.NO_ERROR && tex?.w > 0 && tex?.h > 0 && bgPx[3] > 240 && bgPx[0] < 45 && btnPx[0] > 160 && btnPx[2] > 200,
          `tex=${tex?.w}x${tex?.h}, glErr=${err}, bg=[${Array.from(bgPx)}], btn=[${Array.from(btnPx)}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Launching a ripple at (x, y) brightens pixels around the expanding ring',
    expect: 'pass',
    why: 'Samples baseline luminance around a 54 px ring before launch, triggers launchRipple() at tMs = 0, renders at tMs = 240, and checks ring luminance rises cleanly vs t = 0.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 180;
      const { cv, surf } = makeFixtureSurface(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: RIPPLE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(surf);

        const cx = 120;
        const cy = 115;
        const ringPts = [];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ringPts.push([cx + Math.cos(a) * 72, cy + Math.sin(a) * 54]);
        }

        const rState = createRippleState();
        drawFixtureFrame(g, cv, surf, W, H, rState, 0);
        const before = ringPts.map(([x, y]) => luma(readCssPixel(g.gl, cv, W, H, x, y)));

        launchRipple(rState, { x: cx, y: cy, cw: W, ch: H, tMs: 0, speed: 1.0, colorIdx: 0 });
        stepRipples(rState, 190);
        drawFixtureFrame(g, cv, surf, W, H, rState, 190, { density: 1.4 });
        const err = g.gl.getError();
        const after = ringPts.map(([x, y]) => luma(readCssPixel(g.gl, cv, W, H, x, y)));

        const meanBefore = before.reduce((a, b) => a + b, 0) / before.length;
        const meanAfter = after.reduce((a, b) => a + b, 0) / after.length;
        let maxGain = 0;
        for (let i = 0; i < before.length; i++) maxGain = Math.max(maxGain, after[i] - before[i]);

        return need(
          err === g.gl.NO_ERROR && meanAfter > meanBefore + 14 && maxGain > 22,
          `meanLuma ${meanBefore.toFixed(1)} -> ${meanAfter.toFixed(1)}, maxRingGain=+${maxGain.toFixed(1)}, glErr=${err}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Concurrent ripples overlap up to 4 and return to 0 delta after completion',
    expect: 'pass',
    why: 'Launches 5 ripples to check the 4-slot cap, renders 4 concurrent waves across quadrants at tMs = 260, then steps to tMs = 1500 past completion and verifies 0 max pixel difference vs baseline.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 180;
      const { cv, surf } = makeFixtureSurface(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: RIPPLE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(surf);

        const samplePts = [
          [40, 96], [200, 96], [40, 152], [200, 152],
          [80, 118], [160, 118], [80, 146], [160, 146],
        ];
        const rState = createRippleState();
        drawFixtureFrame(g, cv, surf, W, H, rState, 0);
        const baseline = samplePts.map(([x, y]) => Array.from(readCssPixel(g.gl, cv, W, H, x, y)));

        // Launch 5 ripples: oldest drops, keeping MAX_RIPPLES = 4
        launchRipple(rState, { x: 10, y: 10, cw: W, ch: H, tMs: 0, colorIdx: 0 });
        launchRipple(rState, { x: 40, y: 100, cw: W, ch: H, tMs: 20, colorIdx: 0 });
        launchRipple(rState, { x: 200, y: 100, cw: W, ch: H, tMs: 40, colorIdx: 1 });
        launchRipple(rState, { x: 40, y: 150, cw: W, ch: H, tMs: 60, colorIdx: 2 });
        launchRipple(rState, { x: 200, y: 150, cw: W, ch: H, tMs: 80, colorIdx: 0 });
        const cappedCount = rState.list.length;

        stepRipples(rState, 260);
        const midPacked = drawFixtureFrame(g, cv, surf, W, H, rState, 260);
        let brightened = 0;
        for (let i = 0; i < samplePts.length; i++) {
          const px = readCssPixel(g.gl, cv, W, H, samplePts[i][0], samplePts[i][1]);
          if (luma(px) > luma(baseline[i]) + 8) brightened++;
        }

        const activeAfter = stepRipples(rState, 1500);
        drawFixtureFrame(g, cv, surf, W, H, rState, 1500);
        const err = g.gl.getError();
        let maxDiff = 0;
        for (let i = 0; i < samplePts.length; i++) {
          const px = readCssPixel(g.gl, cv, W, H, samplePts[i][0], samplePts[i][1]);
          for (let c = 0; c < 4; c++) maxDiff = Math.max(maxDiff, Math.abs(px[c] - baseline[i][c]));
        }

        return need(
          err === g.gl.NO_ERROR && cappedCount === MAX_RIPPLES && midPacked.count === MAX_RIPPLES && brightened >= 4 && activeAfter === 0 && maxDiff === 0,
          `capped=${cappedCount}, activeMid=${midPacked.count}, litPts=${brightened}/${samplePts.length}, activeAfter=${activeAfter}, maxPostDelta=${maxDiff}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'DOM tap hits live button and input without blocking clicks or ripples',
    expect: 'pass',
    why: 'Applies syncSurfaceGeometry() on a fixture canvas with capture-phase pointerdown ripple launch, tests elementsFromPoint() on <button> and <input>, and confirms click + input value updates fire alongside ripple launch.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 240;
      const H = 180;
      const { cv, surf, inp, btn } = makeFixtureSurface(W, H);
      testStage().append(cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: RIPPLE_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(surf);
          drawFixtureFrame(g, cv, surf, W, H, createRippleState(), 0);
        } else {
          const ctx = cv.getContext('2d');
          ctx.drawElementImage(surf, 0, 0, W, H);
        }

        const unitCache = { key: '', unit: 1 };
        const lastGeoKeyRef = { value: '' };
        syncSurfaceGeometry({
          canvasEl: cv,
          targetEl: surf,
          mode: g ? 'webgl' : '2d',
          cw: W,
          unitCache,
          lastGeoKeyRef,
          force: true,
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const fixRipples = createRippleState();
        let clicks = 0;
        let edits = 0;
        cv.addEventListener('pointerdown', (e) => {
          const r = cv.getBoundingClientRect();
          launchRipple(fixRipples, {
            x: e.clientX - r.left,
            y: e.clientY - r.top,
            cw: W,
            ch: H,
            tMs: 10,
          });
        }, true);
        btn.addEventListener('click', () => clicks++);
        inp.addEventListener('input', () => edits++);

        const br = btn.getBoundingClientRect();
        const ir = inp.getBoundingClientRect();
        const btnHits = document.elementsFromPoint(br.left + br.width * 0.5, br.top + br.height * 0.5);
        const inpHits = document.elementsFromPoint(ir.left + ir.width * 0.5, ir.top + ir.height * 0.5);

        btn.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: br.left + br.width * 0.5,
          clientY: br.top + br.height * 0.5,
        }));
        btn.click();
        inp.value = 'Edited live';
        inp.dispatchEvent(new Event('input', { bubbles: true }));

        return need(
          btnHits.includes(btn) && inpHits.includes(inp) && clicks === 1 && edits === 1 && fixRipples.list.length === 1 && surf.dataset.hitTick !== undefined,
          `btnHit=${btnHits.includes(btn)}, inpHit=${inpHits.includes(inp)}, clicks=${clicks}, edits=${edits}, ripples=${fixRipples.list.length}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'webglcontextlost plain fallback, restore, and 5-arg 2D fallback',
    expect: 'pass',
    why: 'Dispatches synthetic webglcontextlost and webglcontextrestored on an ElementGL fixture, then renders a 5-argument drawElementImage() 2D ripple fixture and verifies pixels via a plain drawImage() copy.',
    run: async () => {
      if (!hicSupported) throw new Error('HTML-in-canvas is not available');
      const W = 200;
      const H = 140;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, surf } = makeFixtureSurface(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      let cv2d = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, {
            fragment: RIPPLE_FRAG,
            attributes: { preserveDrawingBuffer: true },
            onLost: () => {
              lostOk = true;
              plain.hidden = false;
              plain.append(surf);
            },
            onRestored: () => {
              restoredOk = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              plain.hidden = true;
              cv.append(surf);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
          await nextPaint(cv);
          g.begin([0, 0, 0, 0]);
          g.upload(surf);

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          const whileLost = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(surf);

          cv.dispatchEvent(new Event('webglcontextrestored'));
          g.begin([0, 0, 0, 0]);
          await nextPaint(cv);
          g.begin([0, 0, 0, 0]);
          const texAfter = g.upload(surf);
          drawFixtureFrame(g, cv, surf, W, H, createRippleState(), 0);
          const err = g.gl.getError();
          if (!whileLost || !restoredOk || g.lost || !cv.contains(surf) || !texAfter?.w || err !== g.gl.NO_ERROR) {
            throw new Error(`GL restore check failed: whileLost=${whileLost}, restored=${restoredOk}, err=${err}`);
          }
        }

        // Verify 5-argument drawElementImage() 2D fallback on a clean drawable canvas
        const f2d = makeFixtureSurface(W, H);
        cv2d = f2d.cv;
        testStage().append(cv2d);
        const c2 = cv2d.getContext('2d');
        cv2d.width = W;
        cv2d.height = H;
        await nextPaint(cv2d);
        c2.clearRect(0, 0, W, H);
        c2.drawElementImage(f2d.surf, 0, 0, W, H);

        const copy = document.createElement('canvas');
        copy.width = W;
        copy.height = H;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2d, 0, 0);
        const basePx = cc.getImageData(152, 105, 1, 1).data;

        const r2d = createRippleState();
        launchRipple(r2d, { x: 100, y: 105, cw: W, ch: H, tMs: 0 });
        draw2DRipples(c2, r2d, 220, { mode: 'sparkle', density: 1.0, reduced: false });

        cc.clearRect(0, 0, W, H);
        cc.drawImage(cv2d, 0, 0);
        const px = cc.getImageData(152, 105, 1, 1).data;
        const lumBase = luma(basePx);
        const lumAfter = luma(px);
        return need(
          px[3] > 200 && lumAfter > lumBase + 8,
          `glRestore=${glSupported ? restoredOk : 'skipped'}, 2dLuma ${lumBase.toFixed(1)} -> ${lumAfter.toFixed(1)}.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        cv2d?.remove();
        window.__gfx?.retire?.(cv);
        if (cv2d) window.__gfx?.retire?.(cv2d);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'sparkle-ripple stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !stage.has(surfaceEl)) return 0;
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
