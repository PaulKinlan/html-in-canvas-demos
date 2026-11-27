import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const canvas = document.getElementById('crawl-canvas');
const articleEl = document.getElementById('crawl-article');
const stageBox = document.getElementById('crawl-stage');
const viewportEl = document.getElementById('crawl-viewport');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests-body');

// Live DOM controls inside <canvas>.
const episodeInput = document.getElementById('crawl-episode');
const textareaEl = document.getElementById('crawl-textarea');
const btnJumpAct1 = document.getElementById('btn-jump-act1');
const btnJumpAct2 = document.getElementById('btn-jump-act2');
const btnPauseInline = document.getElementById('btn-pause-inline');
const btnRestartInline = document.getElementById('btn-restart-inline');
const chapterBadge = document.getElementById('crawl-chapter-badge');

// External controls outside <canvas>.
const btnPlay = document.getElementById('btn-play');
const btnFlat = document.getElementById('btn-flat');
const btnCrawlAngle = document.getElementById('btn-crawl-angle');
const ctlReduced = document.getElementById('ctl-reduced');
const ctlTilt = document.getElementById('ctl-tilt');
const outTilt = document.getElementById('out-tilt');
const ctlSpeed = document.getElementById('ctl-speed');
const outSpeed = document.getElementById('out-speed');
const ctlProgress = document.getElementById('ctl-progress');
const outProgress = document.getElementById('out-progress');

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const DEFAULT_TILT = 55;
const DEFAULT_PROGRESS = 0.22;
const WORLD_WIDTH = 2.45;
const BASE_CRAWL_RATE = 0.022; // ~45 s full crawl at 1.0x speed

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  playing: !reducedQuery.matches,
  reducedOverride: reducedQuery.matches,
  tiltDeg: DEFAULT_TILT,
  speed: 1.0,
  progress: DEFAULT_PROGRESS,
  targetProgress: null,
  hasPainted: false,
  domDirty: true,
  onScreen: true,
  uploads: 0,
  paints: 0,
  texW: 0,
  texH: 0,
  lastTickMs: 0,
  rafId: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoVals: null,
  lastBadgeKey: '',
  lastControlProgress: -1,
};

ctlReduced.checked = state.reducedOverride;

// ---------------- Vector & 4x4 Column-Major Matrix Math ----------------

const v3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3Cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const v3Norm = (a) => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
};

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, target, up) {
  const z = v3Norm(v3Sub(eye, target));
  const x = v3Norm(v3Cross(up, z));
  const y = v3Cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -v3Dot(x, eye), -v3Dot(y, eye), -v3Dot(z, eye), 1,
  ]);
}

function mat4MulVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

// #region crawl-matrix
/**
 * Build the 3D camera VP matrix, the unit-UV-to-clip matrix (uMvp for ElementGL),
 * and the element-px-to-canvas-CSS-px projective matrix (for updateElementGeometry).
 */
export function buildCrawlMatrices(cw, ch, elemW, elemH, tiltDeg, progress) {
  const aspect = Math.max(0.4, cw / Math.max(1, ch));
  const worldW = WORLD_WIDTH;
  const worldH = worldW * (Math.max(1, elemH) / Math.max(1, elemW));
  const theta = (Math.max(0, Math.min(72, tiltDeg)) * Math.PI) / 180;
  const sTilt = Math.sin(theta);
  const cTilt = Math.cos(theta);

  // Camera lifts smoothly as the crawl tilts back so the vanishing horizon sits high in frame.
  const camZ = 4.9;
  const camY = 1.05 * sTilt;
  const lookY = 0.05 * sTilt;
  const baseHalfW = 1.44;
  const baseFov = (33 * Math.PI) / 180;
  const fBase = 1 / Math.tan(baseFov * 0.5);
  const fNeeded = (camZ * aspect) / baseHalfW;
  const fovY = 2 * Math.atan(1 / Math.min(fBase, fNeeded));

  const vp = mat4Mul(
    mat4Perspective(fovY, aspect, 0.2, 40.0),
    mat4LookAt([0, camY, camZ], [0, lookY, 0], [0, 1, 0])
  );

  const halfH0 = camZ * Math.tan(fovY * 0.5);
  const sStart = (halfH0 * 0.90) * (1 - sTilt) + 0.85 * sTilt;
  const sEnd = Math.max(sStart + 0.1, worldH - halfH0 * 0.90) * (1 - sTilt) + (worldH + 2.65) * sTilt;
  const sTop = sStart + Math.max(0, Math.min(1, progress)) * (sEnd - sStart);
  const pivY = -0.32 * sTilt;

  // Map unit UV (u in 0..1, v in 0..1, z=0) onto the tilted 3D crawl plane.
  const uvToWorld = new Float32Array([
    worldW, 0, 0, 0,
    0, -worldH * cTilt, worldH * sTilt, 0,
    0, sTilt, cTilt, 0,
    -worldW * 0.5, pivY + sTop * cTilt, -sTop * sTilt, 1,
  ]);

  const uMvp = mat4Mul(vp, uvToWorld);

  const pxToUv = new Float32Array([
    1 / Math.max(1, elemW), 0, 0, 0,
    0, 1 / Math.max(1, elemH), 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const ndcToCss = new Float32Array([
    cw * 0.5, 0, 0, 0,
    0, -ch * 0.5, 0, 0,
    0, 0, 1, 0,
    cw * 0.5, ch * 0.5, 0, 1,
  ]);
  const cssRaw = mat4Mul(ndcToCss, mat4Mul(uMvp, pxToUv));
  const wCenter = cssRaw[3] * (elemW * 0.5) + cssRaw[7] * (elemH * 0.5) + cssRaw[15];
  const invW = wCenter > 1e-4 ? 1 / wCenter : 1;
  const cssArr = new Array(16);
  for (let i = 0; i < 16; i++) cssArr[i] = cssRaw[i] * invW;

  const cssMatrix = typeof DOMMatrix !== 'undefined' ? new DOMMatrix(cssArr) : null;
  const tiltMix = Math.min(1, tiltDeg / 36);

  return { uMvp, uvToWorld, vp, cssMatrix, cssArr, tiltMix, worldW, worldH, sTop };
}
// #endregion crawl-matrix

// ---------------- WebGL 2 Fragment Shader (Starfield + Anti-Shimmer Crawl) ----------------

// #region crawl-shader
const CRAWL_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uPass;
uniform vec2 uResolution;
uniform vec2 uTexSize;
uniform float uProgress;
uniform float uTiltMix;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n * 19.37));
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

float starLayer(vec2 uv, float scale, float density, float timeVal) {
  vec2 gv = fract(uv * scale) - 0.5;
  vec2 id = floor(uv * scale);
  vec2 rnd = hash22(id);
  if (rnd.x < density) return 0.0;
  vec2 offset = (rnd - 0.5) * 0.68;
  float d = length(gv - offset);
  float size = mix(0.022, 0.075, fract(rnd.y * 17.3));
  float core = smoothstep(size, 0.0, d);
  float twinkle = 1.0;
  if (uReduced < 0.5) {
    twinkle = 0.74 + 0.26 * sin(timeVal * (1.2 + rnd.x * 2.4) + rnd.y * 41.0);
  }
  return core * core * twinkle;
}

void main() {
  vec2 res = max(uResolution, vec2(1.0));
  vec2 screenUv = gl_FragCoord.xy / res;

  if (uPass == 0) {
    float aspect = res.x / res.y;
    vec2 p = vec2((screenUv.x - 0.5) * aspect, screenUv.y - 0.5);

    // Deep velvet space gradient with subtle distant nebula haze.
    vec3 spaceCol = mix(vec3(0.016, 0.022, 0.048), vec3(0.005, 0.007, 0.018), smoothstep(0.05, 0.95, screenUv.y));
    vec2 nebUv = p * vec2(1.8, 2.3) + vec2(0.4, -uProgress * 0.05);
    float n1 = valueNoise(nebUv);
    float n2 = valueNoise(nebUv * 2.15 + 4.3);
    float nebula = smoothstep(0.32, 0.88, n1 * 0.65 + n2 * 0.35);
    float upperBand = exp(-pow((screenUv.y - 0.66) * 2.8, 2.0));
    spaceCol += vec3(0.036, 0.052, 0.135) * nebula * (0.45 + 0.55 * upperBand);
    spaceCol += vec3(0.075, 0.052, 0.016) * nebula * upperBand * 0.42;

    // Three layered parallax starfields.
    float tAnim = uTime * (1.0 - uReduced);
    vec2 drift1 = p + vec2(0.0, -uProgress * 0.025);
    vec2 drift2 = p + vec2(0.37, -uProgress * 0.055);
    vec2 drift3 = p + vec2(-0.21, -uProgress * 0.095);

    float s1 = starLayer(drift1, 46.0, 0.76, tAnim);
    float s2 = starLayer(drift2, 92.0, 0.81, tAnim * 1.1);
    float s3 = starLayer(drift3, 156.0, 0.85, tAnim * 0.8);

    vec3 starTint = mix(vec3(0.82, 0.89, 1.0), vec3(1.0, 0.93, 0.72), fract(s1 * 13.7));
    spaceCol += starTint * s1 * 0.85;
    spaceCol += vec3(0.76, 0.84, 0.98) * s2 * 0.58;
    spaceCol += vec3(0.62, 0.70, 0.88) * s3 * 0.38;

    outColor = vec4(spaceCol, 1.0);
    return;
  }

  // Pass 1: mipmapped, anisotropic DOM crawl texture with horizon fade.
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  vec4 tex = texture(uTex, vUv);

  // Subtle rotated 4-tap supersample when far lines compress more than 1.25 texels per pixel.
  float footprint = max(length(dx * uTexSize), length(dy * uTexSize));
  if (footprint > 1.25) {
    float blendAmt = clamp((footprint - 1.25) * 0.35, 0.0, 0.75);
    vec4 sA = texture(uTex, vUv + dx * 0.28 + dy * 0.14);
    vec4 sB = texture(uTex, vUv - dx * 0.28 - dy * 0.14);
    vec4 sC = texture(uTex, vUv - dx * 0.14 + dy * 0.28);
    vec4 sD = texture(uTex, vUv + dx * 0.14 - dy * 0.28);
    vec4 avg = (sA + sB + sC + sD) * 0.25;
    tex = mix(tex, avg, blendAmt);
  }

  // Smooth vanishing-horizon fade near the top of the tilted plane, keeping 0-deg flat view legible.
  float fadeStart = mix(0.95, 0.54, uTiltMix);
  float fadeEnd = mix(1.02, 0.87, uTiltMix);
  float horizonFade = 1.0 - smoothstep(fadeStart, fadeEnd, screenUv.y);
  float bottomFade = mix(1.0, smoothstep(0.0, 0.032, screenUv.y), uTiltMix);
  float uvEdge = smoothstep(0.0, 0.008, vUv.y) * (1.0 - smoothstep(0.992, 1.0, vUv.y));
  float mask = horizonFade * bottomFade * uvEdge;

  if (mask <= 0.001 || tex.a <= 0.001) discard;
  outColor = tex * mask;
}
`;
// #endregion crawl-shader

// ---------------- State Helpers & UI Sync ----------------

let stage = null;
let ctx2d = null;
let anisoExt = null;
let maxAniso = 1;
const configuredTex = new WeakSet();

const isReducedMotion = () => state.reducedOverride || reducedQuery.matches;

function currentChapterLabel() {
  const act = state.progress < 0.30 ? 'ACT I' : state.progress < 0.68 ? 'ACT II' : 'ACT III';
  const playLabel = state.playing && !isReducedMotion() ? 'PLAYING' : 'PAUSED';
  return `${act} · ${playLabel}`;
}

function syncChapterBadge() {
  const next = currentChapterLabel();
  if (next !== state.lastBadgeKey) {
    state.lastBadgeKey = next;
    chapterBadge.textContent = next;
    state.domDirty = true;
    canvas.requestPaint?.();
  }
}

function updateControlsUI(forceProgress = false) {
  const activePlay = state.playing && !isReducedMotion();
  btnPlay.setAttribute('aria-pressed', String(activePlay));
  btnPlay.textContent = activePlay ? 'Pause' : 'Play';
  btnPauseInline.setAttribute('aria-pressed', String(!activePlay));
  const nextInline = activePlay ? 'Pause crawl' : 'Resume crawl';
  if (btnPauseInline.textContent !== nextInline) {
    btnPauseInline.textContent = nextInline;
    state.domDirty = true;
    canvas.requestPaint?.();
  }

  btnFlat.setAttribute('aria-pressed', String(state.tiltDeg === 0));
  btnCrawlAngle.setAttribute('aria-pressed', String(state.tiltDeg === DEFAULT_TILT));

  ctlTilt.value = String(Math.round(state.tiltDeg));
  outTilt.textContent = `${Math.round(state.tiltDeg)}°`;
  ctlSpeed.value = state.speed.toFixed(1);
  outSpeed.textContent = `${state.speed.toFixed(1)}x`;

  const pct = Math.round(state.progress * 1000) / 10;
  if (forceProgress || Math.abs(pct - state.lastControlProgress) >= 0.4) {
    state.lastControlProgress = pct;
    ctlProgress.value = String(pct);
    outProgress.textContent = `${Math.round(pct)}%`;
  }
  syncChapterBadge();
}

function updateHud() {
  const route =
    state.mode === 'webgl' ? 'WebGL 2 ElementGL'
      : state.mode === '2d' ? '2D trapezoid strips'
        : 'Plain HTML';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const texInfo = state.texW ? `${state.texW}×${state.texH} tex` : 'pending tex';
  hudEl.textContent =
    `${route} · ${Math.round(state.tiltDeg)}° tilt · ${Math.round(state.progress * 100)}% · ${texInfo} · ${mp} MP · ${state.uploads} uploads`;
}

// #region hit-geometry
function syncHitGeometry(geom, cw, ch, force = false) {
  if (state.mode === 'plain' || !('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const elemW = articleEl.offsetWidth || 400;
  const elemH = articleEl.offsetHeight || 760;
  const unitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${elemW}`;
  if (state.unitCache.key !== unitKey && canvas.width > 0 && cw > 0) {
    state.unitCache.unit = geometryUnit(canvas, articleEl, elemW);
    state.unitCache.key = unitKey;
    state.lastGeoVals = null;
  }
  const unit = state.unitCache.unit || 1;
  const target = geom.cssMatrix
    ? new DOMMatrix().scale(unit, unit, 1).multiply(geom.cssMatrix)
    : OFFSTAGE;
  if (!target) return;
  const vals = target.toFloat32Array();
  if (!force && state.lastGeoVals && vals.every((v, i) => Math.abs(v - state.lastGeoVals[i]) < 1e-4)) return;
  state.lastGeoVals = vals;
  articleEl.inert = !geom.cssMatrix;
  canvas.updateElementGeometry(articleEl, { canvasTransform: target });
  articleEl.dataset.hitTick = articleEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion hit-geometry

function canvasCssBox() {
  return {
    cw: Math.max(200, canvas.clientWidth || viewportEl.clientWidth || 360),
    ch: Math.max(200, canvas.clientHeight || viewportEl.clientHeight || 420),
  };
}

// ---------------- WebGL 2 Upload & Draw ----------------

// #region gl-init
function uploadArticleTexture() {
  if (!state.hasPainted || !stage || stage.lost) return null;
  try {
    const tex = stage.upload(articleEl);
    if (!tex) return null;
    const gl = stage.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    if (!configuredTex.has(tex.tex)) {
      configuredTex.add(tex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (anisoExt) {
        gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
      }
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    state.domDirty = false;
    state.uploads++;
    state.texW = tex.w;
    state.texH = tex.h;
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return null;
    }
    throw err;
  }
}

function drawWebGLPasses(forceGeo = false) {
  if (!state.hasPainted || !stage || stage.lost) return;
  if (!stage.begin([0.01, 0.015, 0.038, 1.0])) return;
  if (state.domDirty || !stage.has(articleEl)) {
    uploadArticleTexture();
  }
  if (!stage.has(articleEl)) return;

  const { cw, ch } = canvasCssBox();
  const elemW = articleEl.offsetWidth || 400;
  const elemH = articleEl.offsetHeight || 760;
  const geom = buildCrawlMatrices(cw, ch, elemW, elemH, state.tiltDeg, state.progress);
  const reducedVal = isReducedMotion() ? 1.0 : 0.0;

  // Pass 0: procedural deep velvet starfield + subtle nebula haze.
  stage.quad(articleEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.uniform1i(loc('uPass'), 0);
    gl.uniform2f(loc('uResolution'), canvas.width, canvas.height);
    gl.uniform2f(loc('uTexSize'), state.texW || elemW, state.texH || elemH);
    gl.uniform1f(loc('uProgress'), state.progress);
    gl.uniform1f(loc('uTiltMix'), geom.tiltMix);
    gl.uniform1f(loc('uReduced'), reducedVal);
  });

  // Pass 1: 3D perspective receding DOM article plane.
  stage.quad(articleEl, geom.uMvp, (gl, loc) => {
    gl.uniform1i(loc('uPass'), 1);
    gl.uniform2f(loc('uResolution'), canvas.width, canvas.height);
    gl.uniform2f(loc('uTexSize'), state.texW || elemW, state.texH || elemH);
    gl.uniform1f(loc('uProgress'), state.progress);
    gl.uniform1f(loc('uTiltMix'), geom.tiltMix);
    gl.uniform1f(loc('uReduced'), reducedVal);
  });

  syncHitGeometry(geom, cw, ch, forceGeo);
  updateHud();
}
// #endregion gl-init

// ---------------- 2D Perspective Strip Fallback ----------------

const STARS_2D = Array.from({ length: 90 }, (_, i) => {
  const s1 = Math.sin(i * 12.9898 + 1.23) * 43758.5453;
  const s2 = Math.sin(i * 78.233 + 4.56) * 28471.137;
  const s3 = Math.sin(i * 39.425 + 7.89) * 19283.421;
  return {
    x: s1 - Math.floor(s1),
    y: s2 - Math.floor(s2),
    r: 0.7 + (s3 - Math.floor(s3)) * 1.1,
    a: 0.35 + ((s1 * 7) % 1) * 0.55,
  };
});

// #region fallback-2d
function draw2DFallback(forceGeo = false) {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = canvasCssBox();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx2d.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#040610');
  bg.addColorStop(1, '#0b1024');
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, cw, ch);

  ctx2d.fillStyle = '#e5ecff';
  for (const st of STARS_2D) {
    ctx2d.globalAlpha = st.a;
    ctx2d.beginPath();
    ctx2d.arc(st.x * cw, ((st.y + state.progress * 0.08) % 1) * ch, st.r, 0, Math.PI * 2);
    ctx2d.fill();
  }
  ctx2d.globalAlpha = 1;

  const elemW = articleEl.offsetWidth || 400;
  const elemH = articleEl.offsetHeight || 760;
  const geom = buildCrawlMatrices(cw, ch, elemW, elemH, state.tiltDeg, state.progress);
  const projectUv = (u, v) => {
    const c = mat4MulVec4(geom.uMvp, u, v, 0, 1);
    if (c[3] <= 1e-4) return null;
    return [
      ((c[0] / c[3]) * 0.5 + 0.5) * cw,
      (0.5 - (c[1] / c[3]) * 0.5) * ch,
    ];
  };

  const strips = 26;
  for (let i = 0; i < strips; i++) {
    const v0 = i / strips;
    const v1 = (i + 1) / strips;
    const tl = projectUv(0, v0);
    const tr = projectUv(1, v0);
    const bl = projectUv(0, v1);
    const br = projectUv(1, v1);
    if (!tl || !tr || !bl || !br) continue;
    const minY = Math.min(tl[1], tr[1]);
    const maxY = Math.max(bl[1], br[1]);
    if (maxY < 0 || minY > ch) continue;

    const yMid = (minY + maxY) * 0.5;
    const screenYNorm = 1 - yMid / ch;
    const fadeStart = 0.95 * (1 - geom.tiltMix) + 0.54 * geom.tiltMix;
    const fadeEnd = 1.02 * (1 - geom.tiltMix) + 0.87 * geom.tiltMix;
    const fade = 1 - Math.max(0, Math.min(1, (screenYNorm - fadeStart) / Math.max(0.01, fadeEnd - fadeStart)));
    if (fade <= 0.02) continue;

    const wTop = tr[0] - tl[0];
    const wBot = br[0] - bl[0];
    const dw = (wTop + wBot) * 0.5;
    const stripH = Math.max(1, ((bl[1] + br[1]) * 0.5) - ((tl[1] + tr[1]) * 0.5));
    const dh = stripH / (v1 - v0);
    const dx = (cw - dw) * 0.5;
    const dyTop = ((tl[1] + tr[1]) * 0.5) - v0 * dh;

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.moveTo(tl[0], tl[1]);
    ctx2d.lineTo(tr[0], tr[1]);
    ctx2d.lineTo(br[0], br[1] + 0.8);
    ctx2d.lineTo(bl[0], bl[1] + 0.8);
    ctx2d.closePath();
    ctx2d.clip();
    ctx2d.globalAlpha = fade;
    try {
      ctx2d.drawElementImage(articleEl, dx, dyTop, dw, dh);
    } catch {}
    ctx2d.restore();
  }
  ctx2d.globalAlpha = 1;
  syncHitGeometry(geom, cw, ch, forceGeo);
  updateHud();
}
// #endregion fallback-2d

// ---------------- Plain HTML Context-Loss & Fallback ----------------

function enterPlainFallback(reason, { keepForRestore = false } = {}) {
  state.mode = 'plain';
  stageBox.classList.add('is-plain');
  articleEl.inert = false;
  if (articleEl.parentElement !== plainHost) plainHost.append(articleEl);
  routeNoteEl.textContent = reason;
  updateHud();
  if (!keepForRestore) stopLoop();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (articleEl.parentElement !== canvas) canvas.append(articleEl);
  state.lastGeoVals = null;
  state.unitCache.key = '';
}

// ---------------- Animation Loop ----------------

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function shouldRunLoop() {
  if (state.mode === 'plain' || !state.onScreen || document.hidden) return false;
  if (state.targetProgress !== null) return true;
  if (isReducedMotion()) return false;
  return state.playing;
}

function startLoop() {
  if (!state.rafId && shouldRunLoop()) {
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }
}

function drawCurrentFrame(forceGeo = false) {
  if (state.mode === 'webgl') drawWebGLPasses(forceGeo);
  else if (state.mode === '2d') draw2DFallback(forceGeo);
}

function tick(now) {
  state.rafId = 0;
  if (!shouldRunLoop()) return;

  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;

  if (state.targetProgress !== null) {
    const diff = state.targetProgress - state.progress;
    if (isReducedMotion() || Math.abs(diff) < 0.002) {
      state.progress = state.targetProgress;
      state.targetProgress = null;
    } else {
      state.progress += diff * Math.min(1, dt * 8.5);
    }
  } else if (state.playing && !isReducedMotion()) {
    state.progress += dt * BASE_CRAWL_RATE * state.speed;
    if (state.progress >= 1.0) state.progress = 0.02;
  }

  updateControlsUI();
  if (state.hasPainted) drawCurrentFrame();
  if (shouldRunLoop()) state.rafId = requestAnimationFrame(tick);
}

// ---------------- Interactions ----------------

function setPlaying(next) {
  state.playing = Boolean(next);
  updateControlsUI();
  if (shouldRunLoop()) startLoop();
  else {
    stopLoop();
    if (state.hasPainted) drawCurrentFrame(true);
  }
}

function jumpToProgress(target) {
  const clamped = Math.max(0, Math.min(1, target));
  if (isReducedMotion()) {
    state.targetProgress = null;
    state.progress = clamped;
    updateControlsUI(true);
    if (state.hasPainted) drawCurrentFrame(true);
    return;
  }
  state.targetProgress = clamped;
  startLoop();
}

function setTilt(deg) {
  state.tiltDeg = Math.max(0, Math.min(68, Number(deg) || 0));
  state.lastGeoVals = null;
  updateControlsUI();
  if (state.hasPainted) drawCurrentFrame(true);
}

btnPlay.addEventListener('click', () => {
  if (isReducedMotion() && !state.playing) {
    ctlReduced.checked = false;
    state.reducedOverride = false;
  }
  setPlaying(!state.playing);
});

btnPauseInline.addEventListener('click', () => {
  setPlaying(!state.playing);
});

btnJumpAct1.addEventListener('click', () => jumpToProgress(0.18));
btnJumpAct2.addEventListener('click', () => jumpToProgress(0.44));
btnRestartInline.addEventListener('click', () => jumpToProgress(0.12));

btnFlat.addEventListener('click', () => setTilt(0));
btnCrawlAngle.addEventListener('click', () => setTilt(DEFAULT_TILT));

ctlTilt.addEventListener('input', () => setTilt(ctlTilt.value));

ctlSpeed.addEventListener('input', () => {
  state.speed = Math.max(0.2, Math.min(3.0, Number(ctlSpeed.value) || 1.0));
  updateControlsUI();
});

ctlProgress.addEventListener('input', () => {
  state.targetProgress = null;
  state.progress = Math.max(0, Math.min(1, Number(ctlProgress.value) / 100));
  updateControlsUI(true);
  if (state.hasPainted) drawCurrentFrame(true);
});

ctlReduced.addEventListener('change', () => {
  state.reducedOverride = ctlReduced.checked;
  if (isReducedMotion()) {
    stopLoop();
  }
  updateControlsUI(true);
  if (state.hasPainted) drawCurrentFrame(true);
  startLoop();
});

reducedQuery.addEventListener?.('change', () => {
  ctlReduced.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) stopLoop();
  updateControlsUI(true);
  if (state.hasPainted) drawCurrentFrame(true);
  startLoop();
});

for (const el of [episodeInput, textareaEl]) {
  el.addEventListener('input', () => {
    state.domDirty = true;
    canvas.requestPaint?.();
  });
}

// Refresh hit geometry right before pointer taps or keyboard focus inside the canvas.
const refreshGeoNow = () => {
  if (state.mode === 'plain' || !state.hasPainted) return;
  const { cw, ch } = canvasCssBox();
  const elemW = articleEl.offsetWidth || 400;
  const elemH = articleEl.offsetHeight || 760;
  const geom = buildCrawlMatrices(cw, ch, elemW, elemH, state.tiltDeg, state.progress);
  syncHitGeometry(geom, cw, ch);
};
canvas.addEventListener('pointerdown', refreshGeoNow, true);
canvas.addEventListener('pointermove', refreshGeoNow, true);
canvas.addEventListener('focusin', refreshGeoNow);

// ---------------- Boot & Observers ----------------

function wireCanvasListeners() {
  canvas.addEventListener('paint', () => {
    state.paints++;
    state.hasPainted = true;
    state.domDirty = true;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      drawWebGLPasses(true);
    } else if (state.mode === '2d' && ctx2d) {
      draw2DFallback(true);
    }
    startLoop();
  });

  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost, so the article moved to plain HTML.', { keepForRestore: true });
    }
  });

  canvas.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      routeNoteEl.textContent = '2D canvas context restored (drawn with 5-argument drawElementImage() strips).';
      canvas.requestPaint?.();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: CRAWL_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          state.hasPainted = false;
          state.domDirty = true;
          enterPlainFallback('The WebGL 2 context was lost, so the crawl moved to plain HTML until restored.', { keepForRestore: true });
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          anisoExt = stage.gl.getExtension('EXT_texture_filter_anisotropic');
          maxAniso = anisoExt ? stage.gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
          state.mode = 'webgl';
          state.hasPainted = false;
          state.domDirty = true;
          exitPlainFallback();
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context with mipmapped texElementSubImage2D()).';
          canvas.requestPaint?.();
          startLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      anisoExt = stage.gl.getExtension('EXT_texture_filter_anisotropic');
      maxAniso = anisoExt ? stage.gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
      state.mode = 'webgl';
      routeNoteEl.textContent = 'Drawn with one ElementGL WebGL 2 context using mipmapped texElementSubImage2D() and projective updateElementGeometry().';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 could not start (${err.message}); falling back to 2D.`;
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; using 5-argument drawElementImage() trapezoid strips.';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the opening crawl is shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) stopLoop();
    else if (state.hasPainted) {
      drawCurrentFrame();
      startLoop();
    }
  }, { rootMargin: '120px' }).observe(stageBox);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.mode === 'plain') return;
    state.unitCache.key = '';
    state.lastGeoVals = null;
    if (state.hasPainted) drawCurrentFrame(true);
    else canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (state.onScreen && state.hasPainted) {
    drawCurrentFrame();
    startLoop();
  }
});

updateControlsUI(true);
updateHud();
initBackend();

// ---------------- Live Checks (Tap-Gated, Isolated testStage Fixtures) ----------------

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

function makeFixtureCrawl(w = 260, h = 200, { mode = 'solid' } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;background:#04060e`;

  const art = document.createElement('article');
  art.setAttribute('drawable', '');
  art.style.cssText =
    'position:absolute;left:0;top:0;width:320px;height:620px;padding:18px;box-sizing:border-box;' +
    'background:transparent;color:#facc15;font:700 16px/1.35 system-ui';

  if (mode === 'solid') {
    const band = document.createElement('div');
    band.style.cssText = 'width:100%;height:100%;background:rgba(250,204,21,0.92);border-radius:6px;';
    art.append(band);
  } else if (mode === 'stripe') {
    const stripe = document.createElement('div');
    stripe.style.cssText = 'position:absolute;left:18px;right:18px;top:260px;height:76px;background:#facc15;border-radius:4px;';
    art.append(stripe);
  } else {
    const head = document.createElement('div');
    head.textContent = 'EPISODE IX';
    head.style.cssText = 'text-align:center;font:800 18px system-ui;color:#facc15;margin-bottom:16px;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Jump to Act II';
    btn.style.cssText =
      'position:absolute;left:90px;top:240px;width:140px;height:48px;background:#facc15;color:#090d1a;' +
      'border:0;border-radius:6px;font:700 14px system-ui;';
    art.append(head, btn);
    cv.append(art);
    return { cv, art, btn };
  }

  cv.append(art);
  return { cv, art, btn: null };
}

function uploadFixtureMipmapped(g, art) {
  const tex = g.upload(art);
  if (tex) {
    const gl = g.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  return tex;
}

function drawFixtureScene(g, cv, art, w, h, tiltDeg, progress) {
  const geom = buildCrawlMatrices(w, h, art.offsetWidth, art.offsetHeight, tiltDeg, progress);
  g.quad(art, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
    gl.uniform1i(loc('uPass'), 0);
    gl.uniform2f(loc('uResolution'), cv.width, cv.height);
    gl.uniform2f(loc('uTexSize'), art.offsetWidth, art.offsetHeight);
    gl.uniform1f(loc('uProgress'), progress);
    gl.uniform1f(loc('uTiltMix'), geom.tiltMix);
    gl.uniform1f(loc('uReduced'), 1.0);
  });
  g.quad(art, geom.uMvp, (gl, loc) => {
    gl.uniform1i(loc('uPass'), 1);
    gl.uniform2f(loc('uResolution'), cv.width, cv.height);
    gl.uniform2f(loc('uTexSize'), art.offsetWidth, art.offsetHeight);
    gl.uniform1f(loc('uProgress'), progress);
    gl.uniform1f(loc('uTiltMix'), geom.tiltMix);
    gl.uniform1f(loc('uReduced'), 1.0);
  });
  return geom;
}

runTests(testsBody, [
  {
    name: 'ElementGL upload via texElementSubImage2D(), mipmap build and zero GL errors',
    expect: 'pass',
    why: 'Builds an isolated fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), generates mipmaps, renders both passes and reads a centre pixel.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 180;
      const { cv, art } = makeFixtureCrawl(W, H, { mode: 'solid' });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CRAWL_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        await nextPaint(cv);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        const tex = uploadFixtureMipmapped(g, art);
        drawFixtureScene(g, cv, art, W, H, 0, 0.4);
        const err = g.gl.getError();
        const centre = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.5);
        const bgEdge = readCssPixel(g.gl, cv, W, H, 6, H * 0.5);
        return need(
          err === g.gl.NO_ERROR && tex?.w > 0 && centre[0] > 190 && centre[1] > 150 && centre[2] < 90 && bgEdge[0] < 60,
          `tex=${tex?.w}×${tex?.h}, glErr=${err}, centre=[${Array.from(centre)}], space=[${Array.from(bgEdge)}]`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: '3D perspective trapezoid narrows upward and fades at the top horizon',
    expect: 'pass',
    why: 'Tilts a solid cinema-yellow fixture to 58 deg, scans lower foreground vs upper receding rows with readPixels() to confirm perspective narrowing, and verifies top horizon fade into space.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 260;
      const H = 200;
      const { cv, art } = makeFixtureCrawl(W, H, { mode: 'solid' });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CRAWL_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        await nextPaint(cv);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        uploadFixtureMipmapped(g, art);
        drawFixtureScene(g, cv, art, W, H, 58, 0.45);
        const err = g.gl.getError();

        const spanAtY = (cssY) => {
          let count = 0;
          let maxR = 0;
          for (let x = 2; x < W - 2; x += 2) {
            const px = readCssPixel(g.gl, cv, W, H, x, cssY);
            if (px[0] > maxR) maxR = px[0];
            if (px[0] > 120 && px[1] > 95 && px[2] < 80) count += 2;
          }
          return { count, maxR };
        };

        const lower = spanAtY(H * 0.78); // closer to camera (near bottom)
        const upper = spanAtY(H * 0.36); // receding toward top horizon
        const topSky = spanAtY(H * 0.08); // past vanishing horizon fade
        return need(
          err === g.gl.NO_ERROR && upper.count > 16 && lower.count > upper.count * 1.25 && topSky.maxR < lower.maxR * 0.55,
          `lowerWidth=${lower.count}px (maxR=${lower.maxR}), upperWidth=${upper.count}px (maxR=${upper.maxR}), horizonMaxR=${topSky.maxR}`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Progress advance shifts DOM text upward into distance',
    expect: 'pass',
    why: 'Draws a single yellow horizontal stripe inside the fixture article at progress = 0.16 vs progress = 0.36 (55 deg tilt) without re-uploading, and verifies its screen centroid rises.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 260;
      const H = 200;
      const { cv, art } = makeFixtureCrawl(W, H, { mode: 'stripe' });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CRAWL_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        await nextPaint(cv);

        const stripeCenterCssY = (prog) => {
          g.begin([0.01, 0.015, 0.038, 1.0]);
          if (!g.has(art)) uploadFixtureMipmapped(g, art);
          drawFixtureScene(g, cv, art, W, H, 55, prog);
          let sumY = 0;
          let hits = 0;
          for (let y = 6; y < H - 6; y += 2) {
            const px = readCssPixel(g.gl, cv, W, H, W * 0.5, y);
            if (px[0] > 140 && px[1] > 110 && px[2] < 80) {
              sumY += y;
              hits++;
            }
          }
          return { meanY: hits ? sumY / hits : -1, hits };
        };

        const early = stripeCenterCssY(0.16);
        const later = stripeCenterCssY(0.36);
        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR && early.hits >= 3 && later.hits >= 2 && later.meanY < early.meanY - 20,
          `prog=16% y=${early.meanY.toFixed(1)}px (${early.hits} samples) -> prog=36% y=${later.meanY.toFixed(1)}px (${later.hits} samples)`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Projective updateElementGeometry() aligns button hit testing at 0° and 50° tilt',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled projective DOMMatrix to an isolated fixture button at both flat 0° edit view and 50° receding tilt, and tests document.elementsFromPoint().',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 280;
      const H = 220;
      const { cv, art, btn } = makeFixtureCrawl(W, H, { mode: 'button' });
      testStage().append(cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: CRAWL_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0.01, 0.015, 0.038, 1.0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        if (g) {
          g.begin([0.01, 0.015, 0.038, 1.0]);
          uploadFixtureMipmapped(g, art);
        }

        const testAtAngle = async (tiltDeg, prog) => {
          const elemW = art.offsetWidth;
          const elemH = art.offsetHeight;
          const geom = buildCrawlMatrices(W, H, elemW, elemH, tiltDeg, prog);
          if (g) drawFixtureScene(g, cv, art, W, H, tiltDeg, prog);
          const unit = geometryUnit(cv, art, elemW);
          const target = new DOMMatrix().scale(unit, unit, 1).multiply(geom.cssMatrix);
          cv.updateElementGeometry(art, { canvasTransform: target });
          art.dataset.hitTick = art.dataset.hitTick === '1' ? '0' : '1';
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const bx = 160;
          const by = 264;
          const m = geom.cssMatrix.toFloat32Array();
          const bw = m[3] * bx + m[7] * by + m[15];
          const sx = (m[0] * bx + m[4] * by + m[12]) / bw;
          const sy = (m[1] * bx + m[5] * by + m[13]) / bw;
          const rect = cv.getBoundingClientRect();
          const hits = document.elementsFromPoint(rect.left + sx, rect.top + sy);
          return { ok: hits.includes(btn), sx, sy, top: hits[0]?.tagName };
        };

        const flatHit = await testAtAngle(0, 0.35);
        const tiltHit = await testAtAngle(50, 0.42);
        return need(
          flatHit.ok && tiltHit.ok,
          `0° (${flatHit.sx.toFixed(1)},${flatHit.sy.toFixed(1)})=${flatHit.ok} [${flatHit.top}]; 50° (${tiltHit.sx.toFixed(1)},${tiltHit.sy.toFixed(1)})=${tiltHit.ok} [${tiltHit.top}]`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'webglcontextlost moves crawl to plain HTML and webglcontextrestored recovers ElementGL',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated ElementGL fixture on testStage(), verifying plain-HTML rescue and mipmapped WebGL recovery.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220;
      const H = 160;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, art } = makeFixtureCrawl(W, H, { mode: 'solid' });
      wrap.append(cv, plain);
      testStage().append(wrap);
      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: CRAWL_FRAG,
          attributes: { alpha: false, preserveDrawingBuffer: true },
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            art.inert = false;
            plain.append(art);
          },
          onRestored: () => {
            restoredFired = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            cv.append(art);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        await nextPaint(cv);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        uploadFixtureMipmapped(g, art);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(art);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        g.begin([0.01, 0.015, 0.038, 1.0]);
        await nextPaint(cv);
        g.begin([0.01, 0.015, 0.038, 1.0]);
        const texAfter = uploadFixtureMipmapped(g, art);
        drawFixtureScene(g, cv, art, W, H, 55, 0.35);
        const err = g.gl.getError();

        return need(
          inPlainWhileLost && restoredFired && !g.lost && cv.contains(art) && texAfter?.w > 0 && err === g.gl.NO_ERROR,
          `plainWhileLost=${inPlainWhileLost}, restored=${restoredFired}, texAfter=${texAfter?.w}×${texAfter?.h}, glErr=${err}`
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
      name: 'title-crawl stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !stage.has(articleEl)) return 0;
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
