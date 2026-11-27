import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const stageBox = document.getElementById('vg-stage');
const viewportEl = document.getElementById('vg-viewport');
const canvas = document.getElementById('vg-canvas');
const panelEl = document.getElementById('vg-panel');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests-body');

// Live controls inside the drawable panel
const panelEnvBadge = document.getElementById('vg-panel-env');
const artEl = document.getElementById('vg-art');
const trackTitleEl = document.getElementById('vg-track-title');
const trackSubEl = document.getElementById('vg-track-sub');
const trackTimeEl = document.getElementById('vg-track-time');
const prevBtn = document.getElementById('vg-prev');
const playBtn = document.getElementById('vg-play');
const nextBtn = document.getElementById('vg-next');
const chipFocusBtn = document.getElementById('vg-chip-focus');
const chipSpatialBtn = document.getElementById('vg-chip-spatial');
const chipDimBtn = document.getElementById('vg-chip-dim');
const scrubInput = document.getElementById('vg-scrub');
const noteInput = document.getElementById('vg-note');
const gazeSlotEls = Array.from(panelEl.querySelectorAll('[data-gaze-slot]'));

// External page controls
const tiltBtns = Array.from(document.querySelectorAll('button[data-tilt-mode]'));
const envBtns = Array.from(document.querySelectorAll('button[data-env-preset]'));
const ctlReduced = document.getElementById('ctl-reduced');
const ctlFrost = document.getElementById('ctl-frost');
const outFrost = document.getElementById('out-frost');
const ctlRefract = document.getElementById('ctl-refract');
const outRefract = document.getElementById('out-refract');

let reducedQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

const TRACKS = [
  { title: 'Alpine Dawn', sub: 'Spatial mix · 48 kHz', tag: 'SG', cls: '', dur: 196, pos: 84 },
  { title: 'Rain on Timber', sub: 'Binaural · Lossless', tag: 'RN', cls: 't1', dur: 224, pos: 52 },
  { title: 'Atrium Noon', sub: 'Head-tracked · 24-bit', tag: 'AT', cls: 't2', dur: 178, pos: 112 },
];

const BORDER_RADIUS_PX = 26;
const PERSPECTIVE_DEPTH_PX = 880;
const MAX_TILT_X_DEG = 14;
const MAX_TILT_Y_DEG = 18;

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  tiltMode: 'pointer', // 'pointer' | 'locked' | 'flat'
  env: 'dawn', // 'dawn' | 'loft'
  frost: 0.72,
  refract: 0.75,
  dimGlass: false,
  acoustics: 'focus', // 'focus' | 'spatial'
  playing: true,
  trackIdx: 0,
  trackSec: TRACKS[0].pos,
  reducedOverride: reducedQuery.matches,
  hasPainted: false,
  domDirty: true,
  onScreen: true,
  uploads: 0,
  paints: 0,
  texW: 0,
  texH: 0,
  rafId: 0,
  lastTickMs: 0,
  lastTimerStepMs: 0,
  lastHudAt: 0,
  pointerOver: false,
  activeTouchId: null,
  targetLightX: -0.68,
  targetLightY: -0.73,
  lightX: -0.68,
  lightY: -0.73,
  targetRotX: 4.5,
  targetRotY: -6.5,
  rotX: 4.5,
  rotY: -6.5,
  targetGazeX: 0,
  targetGazeY: 0,
  gazeX: 0,
  gazeY: 0,
  gazeActive: 0,
  targetGazeActive: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoVals: null,
  btnRects: new Float32Array(24),
  btnRadii: new Float32Array(6),
  btnCount: 0,
};

ctlReduced.checked = state.reducedOverride;
const isReduced = () => state.reducedOverride || reducedQuery.matches;

// #region spatial-math
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

/** Invert a column-major 3x3 matrix. */
function inv3x3(m) {
  const a00 = m[0], a01 = m[3], a02 = m[6];
  const a10 = m[1], a11 = m[4], a12 = m[7];
  const a20 = m[2], a21 = m[5], a22 = m[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-8) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  det = 1 / det;

  return new Float32Array([
    b01 * det,
    (-a22 * a01 + a02 * a21) * det,
    (a12 * a01 - a02 * a11) * det,
    b11 * det,
    (a22 * a00 - a02 * a20) * det,
    (-a12 * a00 + a02 * a10) * det,
    b21 * det,
    (-a21 * a00 + a01 * a20) * det,
    (a11 * a00 - a01 * a10) * det,
  ]);
}

/**
 * Build the 3D perspective transforms for #vg-panel centred inside (cw x ch) CSS px:
 * - uMvp maps unit UV (0..1, 0..1) into WebGL clip space with Z_ndc = 0.
 * - cssMatrix maps element CSS px (0..elemW, 0..elemH) into canvas CSS px for updateElementGeometry().
 * - invHomography maps canvas CSS px back onto panel CSS px (0..elemW, 0..elemH) on z=0.
 */
export function buildSpatialMatrices(cw, ch, elemW, elemH, rotXDeg, rotYDeg, depthPx = PERSPECTIVE_DEPTH_PX) {
  const safeCw = Math.max(1, cw);
  const safeCh = Math.max(1, ch);
  const safeW = Math.max(1, elemW);
  const safeH = Math.max(1, elemH);
  const cx = safeCw * 0.5;
  const cy = safeCh * 0.5;
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const cX = Math.cos(rx), sX = Math.sin(rx);
  const cY = Math.cos(ry), sY = Math.sin(ry);

  // R = Rx * Ry in right-handed CSS screen space (x right, y down, z toward viewer).
  const r00 = cY, r01 = 0, r02 = sY;
  const r10 = sX * sY, r11 = cX, r12 = -sX * cY;
  const r20 = -cX * sY, r21 = sX, r22 = cX * cY;

  const rotMat = new Float32Array([
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    0, 0, 0, 1,
  ]);

  const toCenter = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -safeW * 0.5, -safeH * 0.5, 0, 1,
  ]);

  // Perspective with camera at (cx, cy, +depthPx) looking down -Z:
  // X_h = cx * (1 - z/D) + x, Y_h = cy * (1 - z/D) + y, Z_h = z, W_h = 1 - z/D.
  const invD = -1 / depthPx;
  const perspAndPlace = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    cx * invD, cy * invD, 1, invD,
    cx, cy, 0, 1,
  ]);

  const cssRaw = mat4Mul(perspAndPlace, mat4Mul(rotMat, toCenter));
  const cssMatrix = typeof DOMMatrix !== 'undefined' ? new DOMMatrix(Array.from(cssRaw)) : null;

  // Map canvas CSS (X_h, Y_h, Z_h, W_h) to WebGL clip space with Z_ndc = 0 to prevent near/far clipping.
  const cssToNdc = new Float32Array([
    2 / safeCw, 0, 0, 0,
    0, -2 / safeCh, 0, 0,
    0, 0, 0, 0,
    -1, 1, 0, 1,
  ]);
  const uvToPx = new Float32Array([
    safeW, 0, 0, 0,
    0, safeH, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const uMvp = mat4Mul(cssToNdc, mat4Mul(cssRaw, uvToPx));

  // Planar 3x3 homography from element CSS px (px, py, 1) -> canvas CSS homogeneous (X_h, Y_h, W_h).
  const hMat = new Float32Array([
    cssRaw[0], cssRaw[1], cssRaw[3],
    cssRaw[4], cssRaw[5], cssRaw[7],
    cssRaw[12], cssRaw[13], cssRaw[15],
  ]);
  const invHomography = inv3x3(hMat);

  return { uMvp, cssMatrix, invHomography, cx, cy, rx, ry };
}

export function canvasCssToPanelLocal(invH, sx, sy, elemW, elemH) {
  const px = invH[0] * sx + invH[3] * sy + invH[6];
  const py = invH[1] * sx + invH[4] * sy + invH[7];
  const pw = invH[2] * sx + invH[5] * sy + invH[8];
  if (Math.abs(pw) < 1e-4) return { lx: 0, ly: 0 };
  return { lx: px / pw - elemW * 0.5, ly: py / pw - elemH * 0.5 };
}
// #endregion spatial-math

// #region glass-shaders
const QUAD_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const ROOM_FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform int uEnv;
uniform float uDimRoom;
uniform vec2 uParallax;
uniform float uTime;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdArchWindow(vec2 p, vec2 halfSize) {
  // Rectangular base topped by a semicircular arch.
  vec2 rectP = p - vec2(0.0, -halfSize.y * 0.25);
  float rectD = sdRoundBox(rectP, vec2(halfSize.x, halfSize.y * 0.75), 0.01);
  float archD = length(p - vec2(0.0, halfSize.y * 0.45)) - halfSize.x;
  return min(rectD, archD);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) + uParallax * 0.035;
  float anim = uReduced > 0.5 ? 0.0 : sin(uTime * 0.35) * 0.012;

  vec3 col = vec3(0.0);

  if (uEnv == 0) {
    // Studio Dawn: sunlit plaster gallery, timber wall slats, oak bench and arched daylight window.
    vec3 wallGrad = mix(vec3(0.56, 0.51, 0.46), vec3(0.86, 0.80, 0.73), smoothstep(0.05, 0.92, uv.y));
    float slatPattern = sin((p.x + 0.6) * 68.0);
    float slatMask = smoothstep(0.02, 0.42, p.x);
    wallGrad *= 1.0 - 0.08 * smoothstep(0.55, 0.98, slatPattern) * slatMask;

    // Subtle dado rail & ceiling cornice lines for strong Snell refraction cues.
    float dado = exp(-abs(uv.y - 0.24) * 140.0);
    wallGrad = mix(wallGrad, vec3(0.36, 0.31, 0.27), dado * 0.55);

    // Warm oak credenza / floor plane at bottom.
    float floorMask = 1.0 - smoothstep(0.18, 0.21, uv.y);
    vec3 oakCol = mix(vec3(0.34, 0.23, 0.14), vec3(0.56, 0.39, 0.24), smoothstep(0.0, 0.21, uv.y));
    oakCol *= 0.92 + 0.08 * sin(uv.x * 42.0);
    col = mix(wallGrad, oakCol, floorMask);

    // Tall arched daylight window positioned to cross cleanly behind the spatial glass panel.
    vec2 winP = p - vec2(-0.18 * aspect, 0.10);
    float dWin = sdArchWindow(winP, vec2(0.30 * aspect, 0.36));
    float inWin = 1.0 - smoothstep(-0.008, 0.008, dWin);

    vec3 skyCol = mix(vec3(1.0, 0.87, 0.68), vec3(0.58, 0.80, 0.98), smoothstep(-0.22, 0.42, winP.y));
    float sunDisc = exp(-dot(winP - vec2(-0.06, 0.16 + anim), winP - vec2(-0.06, 0.16 + anim)) * 18.0);
    skyCol += vec3(1.0, 0.95, 0.82) * sunDisc * 0.55;

    // Crisp bronze window mullions & frame.
    float vMull = exp(-abs(winP.x) * 140.0) + exp(-abs(winP.x + 0.14 * aspect) * 140.0);
    float hMull = exp(-abs(winP.y - 0.02) * 140.0) + exp(-abs(winP.y - 0.22) * 140.0);
    float frameRim = exp(-abs(dWin) * 95.0);
    float mullion = clamp(vMull + hMull + frameRim, 0.0, 1.0);
    vec3 winInterior = mix(skyCol, vec3(0.19, 0.18, 0.17), mullion * 0.82);
    col = mix(col, winInterior, inWin);

    // Diagonal sunlit shaft across the plaster and slats.
    float shaft = exp(-pow((p.x - p.y * 0.65 - 0.04) * 2.5, 2.0)) * smoothstep(0.12, 0.85, uv.y);
    col += vec3(0.28, 0.22, 0.14) * shaft * (1.0 - inWin * 0.7);

    // Architectural studio pendant silhouette on upper right.
    vec2 lampP = p - vec2(0.34 * aspect, 0.25);
    float dLamp = length(lampP * vec2(1.0, 1.5)) - 0.085;
    float inLamp = 1.0 - smoothstep(-0.006, 0.006, dLamp);
    float cord = (1.0 - smoothstep(0.004, 0.009, abs(lampP.x))) * step(0.04, lampP.y);
    float lampGlow = exp(-dot(lampP - vec2(0.0, -0.06), lampP - vec2(0.0, -0.06)) * 14.0);
    col += vec3(0.32, 0.25, 0.16) * lampGlow * 0.55;
    col = mix(col, vec3(0.18, 0.19, 0.22), clamp(inLamp + cord * 0.85, 0.0, 1.0));
  } else {
    // Passthrough Loft: evening slate concrete studio, warm tungsten sconce and city twilight window.
    vec3 wall = mix(vec3(0.055, 0.072, 0.115), vec3(0.115, 0.148, 0.225), smoothstep(0.08, 0.92, uv.y));
    float seamX = exp(-abs(fract((p.x + 0.5) * 2.4) - 0.5) * 90.0);
    float seamY = exp(-abs(fract((uv.y) * 3.0) - 0.5) * 90.0);
    wall *= 1.0 - 0.22 * clamp(seamX + seamY * 0.6, 0.0, 1.0);
    col = wall;

    // Warm tungsten sconce glow on left wall.
    vec2 sconceP = p - vec2(-0.34 * aspect, 0.16);
    float warmPool = exp(-dot(sconceP, sconceP) * 5.2);
    col += vec3(0.76, 0.42, 0.15) * warmPool * 0.72;
    float bulb = exp(-dot(sconceP, sconceP) * 160.0);
    col += vec3(1.0, 0.88, 0.68) * bulb * 0.95;

    // Tall loft window on center-right with dusk gradient and city bokeh highlights.
    vec2 loftWin = p - vec2(0.14 * aspect, 0.04);
    float dLoft = sdRoundBox(loftWin, vec2(0.32 * aspect, 0.38), 0.02);
    float inLoft = 1.0 - smoothstep(-0.008, 0.008, dLoft);
    vec3 dusk = mix(vec3(0.06, 0.10, 0.22), vec3(0.18, 0.30, 0.54), smoothstep(-0.35, 0.35, loftWin.y));
    dusk += vec3(0.45, 0.24, 0.16) * exp(-pow((loftWin.y + 0.18) * 5.0, 2.0)) * 0.45;

    // City bokeh lights inside the loft window (crossing behind the spatial glass).
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 bPos = vec2(
        -0.20 * aspect + mod(fi * 0.17, 0.42) * aspect + anim * (mod(fi, 2.0) - 0.5),
        -0.22 + fract(fi * 0.37) * 0.34
      );
      float r = 0.025 + 0.014 * fract(fi * 0.61);
      float orb = smoothstep(r + 0.015, r * 0.2, length(loftWin - bPos));
      vec3 bTint = mod(fi, 2.0) < 0.5 ? vec3(1.0, 0.74, 0.38) : vec3(0.44, 0.84, 1.0);
      dusk += bTint * orb * 0.58;
    }

    float lMull = exp(-abs(loftWin.x) * 125.0) + exp(-abs(loftWin.y - 0.04) * 125.0) + exp(-abs(dLoft) * 90.0);
    vec3 loftInterior = mix(dusk, vec3(0.04, 0.05, 0.08), clamp(lMull, 0.0, 1.0));
    col = mix(col, loftInterior, inLoft);

    // Dark desk ledge at bottom.
    float deskMask = 1.0 - smoothstep(0.15, 0.18, uv.y);
    col = mix(col, vec3(0.045, 0.052, 0.072), deskMask);
  }

  col *= mix(1.0, 0.45, clamp(uDimRoom, 0.0, 1.0));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDir;

in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 stepUv = uDir * uTexel;
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float fi = float(i);
    float w = exp(-(fi * fi) / 18.0);
    vec2 uv = clamp(vUv + stepUv * fi, vec2(0.002), vec2(0.998));
    acc += texture(uSrc, uv).rgb * w;
    wSum += w;
  }
  outColor = vec4(acc / max(wSum, 0.001), 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uRoomTex;
uniform sampler2D uBlurTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uPass;
uniform vec2 uResolution;
uniform vec2 uCanvasSize;
uniform float uBorderR;
uniform float uFrost;
uniform float uRefract;
uniform float uRotX;
uniform float uRotY;
uniform vec2 uLight;
uniform vec2 uGazeLocal;
uniform float uGazeActive;
uniform int uEnv;
uniform float uDimGlass;
uniform mat3 uInvH;
uniform vec4 uBtnRects[6];
uniform float uBtnRadii[6];

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  float rr = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + vec2(rr);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}

float glassHeight(float d, float rimW) {
  float t = clamp(d / max(rimW, 0.5), 0.0, 1.0);
  return 16.0 * sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
}

vec3 rotateNormal(vec3 n, float rx, float ry) {
  float cY = cos(ry), sY = sin(ry);
  float cX = cos(rx), sX = sin(rx);
  vec3 n1 = vec3(n.x * cY + n.z * sY, n.y, -n.x * sY + n.z * cY);
  return normalize(vec3(n1.x, n1.y * cX - n1.z * sX, n1.y * sX + n1.z * cX));
}

vec3 sampleFrostedBackdrop(vec2 uv, float frostAmt, float mipBias) {
  vec2 cUv = clamp(uv, vec2(0.002), vec2(0.998));
  vec3 sharp = textureLod(uRoomTex, cUv, mipBias * 1.4).rgb;
  if (frostAmt <= 0.01) return sharp;

  // Multi-tap Vogel disc over the pre-blurred Gaussian FBO + mipmaps.
  vec3 blurAcc = textureLod(uBlurTex, cUv, frostAmt * 1.6).rgb;
  float rad = 0.012 * frostAmt;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = fi * 2.39996323;
    float r = rad * sqrt((fi + 0.5) / 6.0);
    vec2 o = vec2(cos(ang), sin(ang)) * r;
    blurAcc += textureLod(uBlurTex, clamp(cUv + o, vec2(0.002), vec2(0.998)), frostAmt * 1.4).rgb;
  }
  blurAcc /= 7.0;
  return mix(sharp, blurAcc, smoothstep(0.0, 0.85, frostAmt));
}

void main() {
  vec2 res = max(uResolution, vec2(1.0));
  vec2 screenUv = gl_FragCoord.xy / res;

  if (uPass == 0) {
    vec3 room = texture(uRoomTex, clamp(screenUv, vec2(0.002), vec2(0.998))).rgb;
    // Project screen CSS position onto the tilted glass plane for a perspective-matched drop shadow.
    vec2 cssPos = vec2(screenUv.x * uCanvasSize.x, (1.0 - screenUv.y) * uCanvasSize.y);
    vec3 pH = uInvH * vec3(cssPos, 1.0);
    if (pH.z > 0.01) {
      vec2 panelLocal = (pH.xy / pH.z) - uSize * 0.5;
      vec2 shadowShift = -uLight * 13.0 + vec2(0.0, 11.0);
      float dShad = sdRoundBox(panelLocal - shadowShift, uSize * 0.5 + vec2(2.0), uBorderR + 2.0);
      float outerD = max(dShad, 0.0);
      float shadow = exp(-outerD * 0.042) * 0.36 + exp(-outerD * 0.16) * 0.20;
      room *= (1.0 - shadow);
    }
    outColor = vec4(clamp(room, 0.0, 1.0), 1.0);
    return;
  }

  // Pass 1: 3D tilted spatial glass window + Snell rim dispersion + specular bevel + gaze glow + DOM.
  vec2 pLocal = (vUv - 0.5) * uSize;
  vec2 halfSize = max(uSize * 0.5, vec2(2.0));
  float r = min(uBorderR, min(halfSize.x, halfSize.y));
  float sd = sdRoundBox(pLocal, halfSize, r);

  float aa = max(0.75, length(fwidth(pLocal)));
  float glassAlpha = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, sd);
  if (glassAlpha <= 0.001) discard;

  float depthIn = max(0.0, -sd);
  float rimW = clamp(r * 0.68, 10.0, 20.0);
  float eps = 0.65;
  vec2 grad2 = vec2(
    sdRoundBox(pLocal + vec2(eps, 0.0), halfSize, r) - sdRoundBox(pLocal - vec2(eps, 0.0), halfSize, r),
    sdRoundBox(pLocal + vec2(0.0, eps), halfSize, r) - sdRoundBox(pLocal - vec2(0.0, eps), halfSize, r)
  );
  grad2 = grad2 / max(length(grad2), 1e-5);

  float slope = (glassHeight(depthIn + eps, rimW) - glassHeight(max(0.0, depthIn - eps), rimW)) / (2.0 * eps);
  float edgeMask = smoothstep(rimW, 0.0, depthIn);
  vec3 nLocal = normalize(vec3(grad2 * slope * (0.35 + 1.15 * uRefract), 1.0));
  vec3 nWorld = rotateNormal(nLocal, uRotX, uRotY);

  // Snell refraction + subtle RGB chromatic dispersion along the curved bevel rim.
  float ior = mix(1.02, 1.48, uRefract);
  float disp = 0.055 * uRefract * edgeMask;
  vec3 rR = refract(vec3(0.0, 0.0, -1.0), nWorld, 1.0 / max(1.01, ior - disp));
  vec3 rG = refract(vec3(0.0, 0.0, -1.0), nWorld, 1.0 / max(1.01, ior));
  vec3 rB = refract(vec3(0.0, 0.0, -1.0), nWorld, 1.0 / max(1.01, ior + disp));

  float refrScale = 0.032 * uRefract * (0.25 + 0.75 * edgeMask);
  vec2 uvR = screenUv + vec2(rR.x, -rR.y) / max(-rR.z, 0.25) * refrScale;
  vec2 uvG = screenUv + vec2(rG.x, -rG.y) / max(-rG.z, 0.25) * refrScale;
  vec2 uvB = screenUv + vec2(rB.x, -rB.y) / max(-rB.z, 0.25) * refrScale;

  // Keep outer bevel slightly crisper so Snell refraction and dispersion stay sharp.
  float localFrost = uFrost * mix(0.28, 1.0, smoothstep(0.0, 6.0, depthIn));
  float mipBias = localFrost * 1.4;
  float colR = sampleFrostedBackdrop(uvR, localFrost, mipBias).r;
  float colG = sampleFrostedBackdrop(uvG, localFrost, mipBias).g;
  float colB = sampleFrostedBackdrop(uvB, localFrost, mipBias).b;
  vec3 refractedBg = vec3(colR, colG, colB);

  // Balanced visionOS slate-frosted body tint keeps white controls readable over sunlit rooms.
  vec3 bodyBase = uEnv == 0 ? vec3(0.11, 0.13, 0.17) : vec3(0.08, 0.10, 0.15);
  float bodyMix = mix(0.28, 0.44, uFrost) + uDimGlass * 0.24;
  vec3 glassCol = mix(refractedBg, bodyBase + refractedBg * 0.28, bodyMix);

  // 3D perspective tilt Fresnel and directional surface sheen across the glass slab.
  float fresnel = 0.04 + 0.96 * pow(clamp(1.0 - max(nWorld.z, 0.0), 0.0, 1.0), 3.2);
  float tiltMag = clamp((abs(uRotX) + abs(uRotY)) * 2.2, 0.0, 1.0);
  float faceSheen = clamp(dot(pLocal / halfSize, uLight) * 0.5 + 0.5, 0.0, 1.0);
  glassCol += vec3(0.76, 0.86, 1.0) * fresnel * (0.05 + 0.48 * tiltMag);
  glassCol += vec3(0.95, 0.98, 1.0) * faceSheen * (0.03 + 0.16 * tiltMag);

  // Sharp 1-2 px directional specular bevel highlight tracked to uLight + chromatic edge tint.
  float bevelBand = exp(-pow((depthIn - 1.15) / 0.95, 2.0));
  float innerShoulder = exp(-depthIn * 0.30) * 0.10;
  float facing = dot(grad2, uLight);
  float specMain = pow(clamp(facing, 0.0, 1.0), 3.2);
  float specBounce = pow(clamp(-facing, 0.0, 1.0), 5.0) * 0.14;
  float crossLight = grad2.x * uLight.y - grad2.y * uLight.x;
  vec3 bevelDispTint = mix(
    vec3(1.0),
    vec3(1.0 + 0.24 * crossLight, 1.0, 1.0 - 0.24 * crossLight),
    clamp(uRefract, 0.0, 1.0)
  );
  glassCol += bevelDispTint * bevelBand * (0.05 + 0.78 * specMain + specBounce);
  glassCol += vec3(0.84, 0.91, 1.0) * innerShoulder * (0.20 + 0.80 * specMain);

  // Gaze / pointer proximity radial highlight behind live buttons inside #vg-panel.
  if (uGazeActive > 0.005) {
    float surfaceCursor = exp(-pow(length(uGazeLocal - pLocal) / 96.0, 2.0)) * uGazeActive;
    glassCol += vec3(0.78, 0.87, 1.0) * surfaceCursor * 0.08;

    for (int i = 0; i < 6; i++) {
      vec4 br = uBtnRects[i];
      if (br.z <= 0.5) continue;
      float dBtn = sdRoundBox(pLocal - br.xy, br.zw, uBtnRadii[i]);
      float inBtn = 1.0 - smoothstep(-1.5, 1.5, dBtn);
      float prox = exp(-pow(length(uGazeLocal - br.xy) / 76.0, 2.0)) * uGazeActive;
      float spot = exp(-pow(length(uGazeLocal - pLocal) / 38.0, 2.0));
      float rimGlow = exp(-abs(dBtn) * 0.85) * prox;
      glassCol += vec3(0.84, 0.93, 1.0) * (inBtn * (0.14 + 0.44 * spot) * prox + rimGlow * 0.30);
    }
  }

  // Composite crisp premultiplied DOM UI on top of the frosted spatial glass.
  vec4 dom = texture(uTex, vUv);
  vec3 comp = dom.rgb + glassCol * (1.0 - dom.a);
  outColor = vec4(clamp(comp, 0.0, 1.0) * glassAlpha, glassAlpha);
}`;
// #endregion glass-shaders

// #region fbo-pipeline
function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'Shader compile failed');
  }
  return s;
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(log || 'Program link failed');
  }
  return p;
}

function makeMipFbo(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export class GlassPipeline {
  constructor(gl) {
    this.rebuild(gl);
  }

  rebuild(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.roomProg = linkProgram(gl, QUAD_VERT, ROOM_FRAG);
    this.blurProg = linkProgram(gl, QUAD_VERT, BLUR_FRAG);
    this.uniforms = new WeakMap();
    this.roomFbo = null;
    this.blurFboA = null;
    this.blurFboB = null;
    this.ensureSize(384, 288);
  }

  invalidate() {
    this.vao = null;
    this.roomProg = null;
    this.blurProg = null;
    this.roomFbo = null;
    this.blurFboA = null;
    this.blurFboB = null;
  }

  ensureSize(cw, ch) {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    const rw = clamp(Math.round(cw * 0.72), 256, 560);
    const rh = clamp(Math.round(ch * 0.72), 192, 420);
    if (this.roomFbo && this.roomFbo.w === rw && this.roomFbo.h === rh) return;
    this.#freeFbos();
    const bw = Math.max(128, rw >> 1);
    const bh = Math.max(96, rh >> 1);
    this.roomFbo = makeMipFbo(gl, rw, rh);
    this.blurFboA = makeMipFbo(gl, bw, bh);
    this.blurFboB = makeMipFbo(gl, bw, bh);
  }

  #u(prog, name) {
    let m = this.uniforms.get(prog);
    if (!m) {
      m = new Map();
      this.uniforms.set(prog, m);
    }
    let loc = m.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(prog, name);
      m.set(name, loc);
    }
    return loc;
  }

  #freeFbos() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    for (const f of [this.roomFbo, this.blurFboA, this.blurFboB]) {
      if (!f) continue;
      gl.deleteFramebuffer(f.fbo);
      gl.deleteTexture(f.tex);
    }
    this.roomFbo = null;
    this.blurFboA = null;
    this.blurFboB = null;
  }

  renderBackdropAndBlur({ cw, ch, envId, dimRoom, parallaxX, parallaxY, timeSec, reduced }) {
    const gl = this.gl;
    if (!gl || gl.isContextLost() || !this.roomProg || !this.blurProg) return;
    this.ensureSize(cw, ch);

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    // 1. Render procedural architectural room into roomFbo and generate mipmaps.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.roomFbo.fbo);
    gl.viewport(0, 0, this.roomFbo.w, this.roomFbo.h);
    gl.useProgram(this.roomProg);
    gl.uniform2f(this.#u(this.roomProg, 'uResolution'), this.roomFbo.w, this.roomFbo.h);
    gl.uniform1i(this.#u(this.roomProg, 'uEnv'), envId);
    gl.uniform1f(this.#u(this.roomProg, 'uDimRoom'), dimRoom);
    gl.uniform2f(this.#u(this.roomProg, 'uParallax'), parallaxX, parallaxY);
    gl.uniform1f(this.#u(this.roomProg, 'uTime'), timeSec);
    gl.uniform1f(this.#u(this.roomProg, 'uReduced'), reduced ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindTexture(gl.TEXTURE_2D, this.roomFbo.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 2. Separable Gaussian blur passes for frosted window diffusion.
    const bw = this.blurFboA.w;
    const bh = this.blurFboA.h;
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.blurProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.#u(this.blurProg, 'uSrc'), 0);

    const blurStep = (srcTex, dstFbo, dx, dy) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo.fbo);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform2f(this.#u(this.blurProg, 'uTexel'), 1 / bw, 1 / bh);
      gl.uniform2f(this.#u(this.blurProg, 'uDir'), dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    blurStep(this.roomFbo.tex, this.blurFboA, 1.35, 0.0);
    blurStep(this.blurFboA.tex, this.blurFboB, 0.0, 1.35);
    blurStep(this.blurFboB.tex, this.blurFboA, 2.35, 0.0);
    blurStep(this.blurFboA.tex, this.blurFboB, 0.0, 2.35);

    gl.bindTexture(gl.TEXTURE_2D, this.blurFboB.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Always unbind custom FBOs and VAOs before drawing to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    this.#freeFbos();
    if (this.roomProg) gl.deleteProgram(this.roomProg);
    if (this.blurProg) gl.deleteProgram(this.blurProg);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.invalidate();
  }
}
// #endregion fbo-pipeline

// ---------------- UI & Layout Measurements ----------------

let stage = null;
let pipeline = null;
let ctx2d = null;

function formatSec(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function measureButtonSlots() {
  const pw = panelEl.offsetWidth || 340;
  const ph = panelEl.offsetHeight || 240;
  state.btnRects.fill(0);
  state.btnRadii.fill(16);
  let count = 0;

  for (const btn of gazeSlotEls) {
    if (count >= 6) break;
    let x = 0;
    let y = 0;
    let cur = btn;
    while (cur && cur !== panelEl) {
      x += cur.offsetLeft || 0;
      y += cur.offsetTop || 0;
      cur = cur.offsetParent;
    }
    const w = btn.offsetWidth || 0;
    const h = btn.offsetHeight || 0;
    if (w <= 0 || h <= 0) continue;
    const idx = count * 4;
    state.btnRects[idx] = x + w * 0.5 - pw * 0.5;
    state.btnRects[idx + 1] = y + h * 0.5 - ph * 0.5;
    state.btnRects[idx + 2] = w * 0.5;
    state.btnRects[idx + 3] = h * 0.5;
    state.btnRadii[count] = btn.classList.contains('vg-pill-btn') ? h * 0.5 : 11;
    count++;
  }
  state.btnCount = count;
}

function canvasCssBox() {
  return {
    cw: Math.max(200, canvas.clientWidth || viewportEl.clientWidth || 360),
    ch: Math.max(200, canvas.clientHeight || viewportEl.clientHeight || 368),
  };
}

function computeTargetPose() {
  if (state.tiltMode === 'flat') {
    state.targetRotX = 0;
    state.targetRotY = 0;
  } else if (state.tiltMode === 'locked') {
    state.targetRotX = 8;
    state.targetRotY = -12;
  }
}

function snapTargets() {
  computeTargetPose();
  state.rotX = state.targetRotX;
  state.rotY = state.targetRotY;
  state.lightX = state.targetLightX;
  state.lightY = state.targetLightY;
  state.gazeX = state.targetGazeX;
  state.gazeY = state.targetGazeY;
  state.gazeActive = state.targetGazeActive;
}

export function stepPose(dt, nowSec) {
  computeTargetPose();
  const safeDt = Math.min(0.05, Math.max(0.001, dt));
  if (isReduced()) {
    snapTargets();
    return false;
  }

  let idleOffX = 0;
  let idleOffY = 0;
  if (!state.pointerOver && state.activeTouchId === null) {
    idleOffX = Math.cos(nowSec * 0.7) * 0.14;
    idleOffY = Math.sin(nowSec * 0.5) * 0.10;
    if (state.tiltMode === 'pointer') {
      state.targetRotX = Math.sin(nowSec * 0.55) * 3.8 + 3.2;
      state.targetRotY = Math.cos(nowSec * 0.45) * 5.2 - 3.5;
      const len = Math.hypot(-0.68 + idleOffX, -0.73 + idleOffY) || 1;
      state.targetLightX = (-0.68 + idleOffX) / len;
      state.targetLightY = (-0.73 + idleOffY) / len;
    }
  }

  const k = 1 - Math.exp(-safeDt * 12);
  state.rotX = lerp(state.rotX, state.targetRotX, k);
  state.rotY = lerp(state.rotY, state.targetRotY, k);
  state.lightX = lerp(state.lightX, state.targetLightX, k);
  state.lightY = lerp(state.lightY, state.targetLightY, k);
  const lLen = Math.hypot(state.lightX, state.lightY) || 1;
  state.lightX /= lLen;
  state.lightY /= lLen;

  state.gazeX = lerp(state.gazeX, state.targetGazeX, k);
  state.gazeY = lerp(state.gazeY, state.targetGazeY, k);
  state.gazeActive = lerp(state.gazeActive, state.targetGazeActive, k);

  const moving =
    Math.abs(state.rotX - state.targetRotX) > 0.02 ||
    Math.abs(state.rotY - state.targetRotY) > 0.02 ||
    Math.abs(state.gazeActive - state.targetGazeActive) > 0.01 ||
    (!state.pointerOver && state.tiltMode === 'pointer');
  return moving;
}

function updateHud(force = false) {
  const now = performance.now();
  if (!force && now - state.lastHudAt < 100) return;
  state.lastHudAt = now;
  const route = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const envName = state.env === 'dawn' ? 'Studio Dawn' : 'Passthrough Loft';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  hudEl.textContent =
    `${route} · ${envName} · ${state.rotX.toFixed(1)}°/${state.rotY.toFixed(1)}° · frost ${Math.round(state.frost * 100)}% · refr ${Math.round(state.refract * 100)}% · ${mp} MP · ${state.uploads} uploads`;
}

function updateExternalControlsUI() {
  for (const btn of tiltBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tiltMode === state.tiltMode));
  }
  for (const btn of envBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.envPreset === state.env));
  }
  viewportEl.dataset.env = state.env;
  panelEnvBadge.textContent = state.env === 'dawn' ? 'Studio Dawn' : 'Passthrough Loft';
  outFrost.textContent = `${Math.round(state.frost * 100)}%`;
  outRefract.textContent = `${Math.round(state.refract * 100)}%`;
}

// ---------------- Hit Geometry & GL Stage ----------------

// #region gl-stage
function syncHitGeometry(geom, cw, ch, force = false) {
  if (state.mode === 'plain' || !('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const elemW = panelEl.offsetWidth || 340;
  const unitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${elemW}`;
  if (state.unitCache.key !== unitKey && canvas.width > 0 && cw > 0) {
    state.unitCache.unit = geometryUnit(canvas, panelEl, elemW);
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
  panelEl.inert = !geom.cssMatrix;
  canvas.updateElementGeometry(panelEl, { canvasTransform: target });
  panelEl.dataset.hitTick = panelEl.dataset.hitTick === '1' ? '0' : '1';
}

function uploadPanelTexture() {
  if (!state.hasPainted || !stage || stage.lost) return null;
  try {
    const tex = stage.upload(panelEl);
    if (!tex) return null;
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

function drawWebGLFrame(forceGeo = false) {
  if (!state.hasPainted || !stage || stage.lost || !pipeline) return;
  if (!stage.begin([0.05, 0.06, 0.09, 1.0])) return;
  if (state.domDirty || !stage.has(panelEl)) {
    uploadPanelTexture();
  }
  if (!stage.has(panelEl)) return;

  const { cw, ch } = canvasCssBox();
  const elemW = panelEl.offsetWidth || 340;
  const elemH = panelEl.offsetHeight || 240;
  if (state.btnCount === 0) measureButtonSlots();

  const geom = buildSpatialMatrices(cw, ch, elemW, elemH, state.rotX, state.rotY);
  const envId = state.env === 'dawn' ? 0 : 1;
  const dimRoom = state.dimGlass ? 0.65 : 0.0;
  const timeSec = performance.now() / 1000;

  // Offscreen FBO pass: render architectural room + mipmaps + separable Gaussian frost blur.
  pipeline.renderBackdropAndBlur({
    cw,
    ch,
    envId,
    dimRoom,
    parallaxX: state.rotY / MAX_TILT_Y_DEG,
    parallaxY: state.rotX / MAX_TILT_X_DEG,
    timeSec,
    reduced: isReduced(),
  });

  // Re-bind ElementGL default screen state after FBO/VAO unbind.
  if (!stage.begin([0.05, 0.06, 0.09, 1.0])) return;

  const setCommonUniforms = (gl, loc, passIdx) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pipeline.roomFbo.tex);
    gl.uniform1i(loc('uRoomTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, pipeline.blurFboB.tex);
    gl.uniform1i(loc('uBlurTex'), 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc('uPass'), passIdx);
    gl.uniform2f(loc('uResolution'), canvas.width, canvas.height);
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform1f(loc('uBorderR'), BORDER_RADIUS_PX);
    gl.uniform1f(loc('uFrost'), state.frost);
    gl.uniform1f(loc('uRefract'), state.refract);
    gl.uniform1f(loc('uRotX'), geom.rx);
    gl.uniform1f(loc('uRotY'), geom.ry);
    gl.uniform2f(loc('uLight'), state.lightX, state.lightY);
    gl.uniform2f(loc('uGazeLocal'), state.gazeX, state.gazeY);
    gl.uniform1f(loc('uGazeActive'), state.gazeActive);
    gl.uniform1i(loc('uEnv'), envId);
    gl.uniform1f(loc('uDimGlass'), state.dimGlass ? 1.0 : 0.0);
    gl.uniformMatrix3fv(loc('uInvH'), false, geom.invHomography);
    gl.uniform4fv(loc('uBtnRects[0]'), state.btnRects);
    gl.uniform1fv(loc('uBtnRadii[0]'), state.btnRadii);
  };

  // Pass 0: architectural room backdrop + perspective-projected drop shadow.
  stage.quad(panelEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => setCommonUniforms(gl, loc, 0));

  // Pass 1: 3D tilted spatial glass window with Snell dispersion, bevel highlight, gaze glow and DOM.
  stage.quad(panelEl, geom.uMvp, (gl, loc) => setCommonUniforms(gl, loc, 1));

  syncHitGeometry(geom, cw, ch, forceGeo);
  updateHud(forceGeo);
}
// #endregion gl-stage

// ---------------- 2D Fallback & Plain HTML Rescue ----------------

// #region fallback-2d
function draw2DFallback(forceGeo = false) {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = canvasCssBox();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);

  const bg = ctx2d.createLinearGradient(0, 0, cw, ch);
  if (state.env === 'dawn') {
    bg.addColorStop(0, state.dimGlass ? '#585147' : '#d6c8b6');
    bg.addColorStop(1, state.dimGlass ? '#242730' : '#4a5262');
  } else {
    bg.addColorStop(0, state.dimGlass ? '#0b0e18' : '#1b273d');
    bg.addColorStop(1, state.dimGlass ? '#06080f' : '#0b101b');
  }
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, cw, ch);

  const elemW = panelEl.offsetWidth || 340;
  const elemH = panelEl.offsetHeight || 240;
  const px = Math.round((cw - elemW) * 0.5);
  const py = Math.round((ch - elemH) * 0.5);

  ctx2d.save();
  ctx2d.fillStyle = 'rgba(22, 27, 38, 0.72)';
  ctx2d.beginPath();
  ctx2d.roundRect(px, py, elemW, elemH, BORDER_RADIUS_PX);
  ctx2d.fill();

  const rimGrad = ctx2d.createLinearGradient(
    px + elemW * (0.5 + state.lightX * 0.5),
    py + elemH * (0.5 + state.lightY * 0.5),
    px + elemW * (0.5 - state.lightX * 0.5),
    py + elemH * (0.5 - state.lightY * 0.5)
  );
  rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  rimGrad.addColorStop(0.5, 'rgba(200, 220, 255, 0.25)');
  rimGrad.addColorStop(1, 'rgba(255, 255, 255, 0.42)');
  ctx2d.strokeStyle = rimGrad;
  ctx2d.lineWidth = 2;
  ctx2d.stroke();
  ctx2d.restore();

  try {
    ctx2d.drawElementImage(panelEl, px, py, elemW, elemH);
  } catch {}

  const flatGeom = buildSpatialMatrices(cw, ch, elemW, elemH, 0, 0);
  syncHitGeometry(flatGeom, cw, ch, forceGeo);
  updateHud(forceGeo);
}

function enterPlainFallback(reason, { keepForRestore = false } = {}) {
  state.mode = 'plain';
  stageBox.classList.add('is-plain');
  panelEl.inert = false;
  if (panelEl.parentElement !== plainHost) plainHost.append(panelEl);
  routeNoteEl.textContent = reason;
  updateHud(true);
  if (!keepForRestore) stopLoop();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (panelEl.parentElement !== canvas) canvas.append(panelEl);
  state.lastGeoVals = null;
  state.unitCache.key = '';
  measureButtonSlots();
}
// #endregion fallback-2d

// ---------------- Animation Loop & Interactions ----------------

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function shouldRunLoop() {
  if (state.mode === 'plain' || !state.onScreen || document.hidden) return false;
  if (isReduced()) return false;
  if (state.pointerOver || state.activeTouchId !== null) return true;
  if (state.tiltMode === 'pointer') return true;
  if (state.playing) return true;
  return (
    Math.abs(state.rotX - state.targetRotX) > 0.02 ||
    Math.abs(state.rotY - state.targetRotY) > 0.02 ||
    state.gazeActive > 0.01
  );
}

function startLoop() {
  if (!state.rafId && shouldRunLoop()) {
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }
}

function drawCurrentFrame(forceGeo = false) {
  if (state.mode === 'webgl') drawWebGLFrame(forceGeo);
  else if (state.mode === '2d') draw2DFallback(forceGeo);
}

function tick(now) {
  state.rafId = 0;
  if (!shouldRunLoop()) return;

  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;

  stepPose(dt, now / 1000);

  if (state.playing && !isReduced() && now - state.lastTimerStepMs >= 1000) {
    state.lastTimerStepMs = now;
    const tr = TRACKS[state.trackIdx];
    state.trackSec = (state.trackSec + 1) % tr.dur;
    trackTimeEl.textContent = formatSec(state.trackSec);
    scrubInput.value = String(Math.round((state.trackSec / tr.dur) * 100));
    state.domDirty = true;
    canvas.requestPaint?.();
  }

  if (state.hasPainted) drawCurrentFrame();
  if (shouldRunLoop()) state.rafId = requestAnimationFrame(tick);
}

function updatePointerTargets(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const nx = clamp((sx / rect.width) * 2 - 1, -1, 1);
  const ny = clamp((sy / rect.height) * 2 - 1, -1, 1);

  const lLen = Math.hypot(nx, ny);
  if (lLen > 0.05) {
    state.targetLightX = nx / lLen;
    state.targetLightY = ny / lLen;
  }

  if (state.tiltMode === 'pointer') {
    state.targetRotY = nx * MAX_TILT_Y_DEG;
    state.targetRotX = -ny * MAX_TILT_X_DEG;
  }

  const { cw, ch } = canvasCssBox();
  const elemW = panelEl.offsetWidth || 340;
  const elemH = panelEl.offsetHeight || 240;
  const geom = buildSpatialMatrices(cw, ch, elemW, elemH, state.rotX, state.rotY);
  const local = canvasCssToPanelLocal(geom.invHomography, sx, sy, elemW, elemH);
  state.targetGazeX = local.lx;
  state.targetGazeY = local.ly;
  state.targetGazeActive = 1.0;

  if (isReduced()) {
    snapTargets();
    if (state.hasPainted) drawCurrentFrame(true);
  } else {
    startLoop();
  }
}

viewportEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') state.activeTouchId = e.pointerId;
  state.pointerOver = true;
  updatePointerTargets(e.clientX, e.clientY);
});

viewportEl.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && state.activeTouchId !== e.pointerId) return;
  if (e.pointerType !== 'touch') state.pointerOver = true;
  updatePointerTargets(e.clientX, e.clientY);
});

const releaseTouch = (e) => {
  if (e.pointerType === 'touch' && state.activeTouchId === e.pointerId) {
    state.activeTouchId = null;
    state.pointerOver = false;
    state.targetGazeActive = 0;
    if (isReduced()) {
      snapTargets();
      if (state.hasPainted) drawCurrentFrame(true);
    } else {
      startLoop();
    }
  }
};
viewportEl.addEventListener('pointerup', releaseTouch);
viewportEl.addEventListener('pointercancel', releaseTouch);
viewportEl.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'touch') return;
  state.pointerOver = false;
  state.targetGazeActive = 0;
  if (isReduced()) {
    snapTargets();
    if (state.hasPainted) drawCurrentFrame(true);
  }
});

// Refresh hit geometry right before clicks/focus inside the canvas.
const refreshGeoNow = () => {
  if (state.mode === 'plain' || !state.hasPainted) return;
  const { cw, ch } = canvasCssBox();
  const elemW = panelEl.offsetWidth || 340;
  const elemH = panelEl.offsetHeight || 240;
  const geom = buildSpatialMatrices(cw, ch, elemW, elemH, state.rotX, state.rotY);
  syncHitGeometry(geom, cw, ch);
};
canvas.addEventListener('pointerdown', refreshGeoNow, true);
canvas.addEventListener('focusin', () => {
  refreshGeoNow();
  state.domDirty = true;
  canvas.requestPaint?.();
});
canvas.addEventListener('focusout', () => {
  state.domDirty = true;
  canvas.requestPaint?.();
});

// Live DOM controls inside #vg-panel
function applyTrack(idx) {
  state.trackIdx = (idx + TRACKS.length) % TRACKS.length;
  const tr = TRACKS[state.trackIdx];
  state.trackSec = tr.pos;
  artEl.textContent = tr.tag;
  artEl.className = `vg-art ${tr.cls}`.trim();
  trackTitleEl.textContent = tr.title;
  trackSubEl.textContent = tr.sub;
  trackTimeEl.textContent = formatSec(state.trackSec);
  scrubInput.value = String(Math.round((state.trackSec / tr.dur) * 100));
  state.domDirty = true;
  canvas.requestPaint?.();
}

prevBtn.addEventListener('click', () => applyTrack(state.trackIdx - 1));
nextBtn.addEventListener('click', () => applyTrack(state.trackIdx + 1));
playBtn.addEventListener('click', () => {
  state.playing = !state.playing;
  playBtn.textContent = state.playing ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-pressed', String(state.playing));
  state.domDirty = true;
  canvas.requestPaint?.();
  if (state.playing) startLoop();
});

chipFocusBtn.addEventListener('click', () => {
  state.acoustics = 'focus';
  chipFocusBtn.setAttribute('aria-pressed', 'true');
  chipSpatialBtn.setAttribute('aria-pressed', 'false');
  state.domDirty = true;
  canvas.requestPaint?.();
});

chipSpatialBtn.addEventListener('click', () => {
  state.acoustics = 'spatial';
  chipFocusBtn.setAttribute('aria-pressed', 'false');
  chipSpatialBtn.setAttribute('aria-pressed', 'true');
  state.domDirty = true;
  canvas.requestPaint?.();
});

chipDimBtn.addEventListener('click', () => {
  state.dimGlass = !state.dimGlass;
  chipDimBtn.setAttribute('aria-pressed', String(state.dimGlass));
  state.domDirty = true;
  canvas.requestPaint?.();
  if (state.hasPainted) drawCurrentFrame();
});

scrubInput.addEventListener('input', () => {
  const tr = TRACKS[state.trackIdx];
  state.trackSec = Math.round((Number(scrubInput.value) / 100) * tr.dur);
  trackTimeEl.textContent = formatSec(state.trackSec);
  state.domDirty = true;
  canvas.requestPaint?.();
});

noteInput.addEventListener('input', () => {
  state.domDirty = true;
  canvas.requestPaint?.();
});

// External page controls
for (const btn of tiltBtns) {
  btn.addEventListener('click', () => {
    state.tiltMode = btn.dataset.tiltMode;
    computeTargetPose();
    if (state.tiltMode === 'flat' || isReduced()) snapTargets();
    updateExternalControlsUI();
    if (state.hasPainted) drawCurrentFrame(true);
    startLoop();
  });
}

for (const btn of envBtns) {
  btn.addEventListener('click', () => {
    state.env = btn.dataset.envPreset;
    updateExternalControlsUI();
    state.domDirty = true;
    canvas.requestPaint?.();
    if (state.hasPainted) drawCurrentFrame();
  });
}

ctlFrost.addEventListener('input', () => {
  state.frost = Number(ctlFrost.value) / 100;
  updateExternalControlsUI();
  if (state.hasPainted) drawCurrentFrame(true);
});

ctlRefract.addEventListener('input', () => {
  state.refract = Number(ctlRefract.value) / 100;
  updateExternalControlsUI();
  if (state.hasPainted) drawCurrentFrame(true);
});

const syncReduced = () => {
  if (isReduced()) {
    stopLoop();
    snapTargets();
  }
  updateExternalControlsUI();
  if (state.hasPainted) drawCurrentFrame(true);
  startLoop();
};

ctlReduced.addEventListener('change', () => {
  state.reducedOverride = ctlReduced.checked;
  syncReduced();
});

function wireReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedQuery = mql;
  state.reducedMql = mql;
  state.reducedOverride = mql.matches;
  ctlReduced.checked = state.reducedOverride;
  mql.addEventListener?.('change', () => {
    state.reducedOverride = mql.matches;
    ctlReduced.checked = state.reducedOverride;
    syncReduced();
  });
}

// ---------------- Backend Boot & Observers ----------------

function wireCanvasListeners() {
  canvas.addEventListener('paint', () => {
    state.paints++;
    state.hasPainted = true;
    state.domDirty = true;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      drawWebGLFrame(true);
    } else if (state.mode === '2d' && ctx2d) {
      draw2DFallback(true);
    }
    startLoop();
  });

  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost, so the spatial panel moved to plain HTML.', { keepForRestore: true });
    }
  });

  canvas.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      routeNoteEl.textContent = '2D canvas context restored (drawn with 5-argument drawElementImage()).';
      canvas.requestPaint?.();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: COMPOSITE_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          state.hasPainted = false;
          state.domDirty = true;
          pipeline?.invalidate();
          enterPlainFallback('The WebGL 2 context was lost, so the spatial panel moved to plain HTML until restored.', { keepForRestore: true });
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pipeline.rebuild(stage.gl);
          state.mode = 'webgl';
          state.hasPainted = false;
          state.domDirty = true;
          exitPlainFallback();
          routeNoteEl.textContent = 'WebGL 2 context restored (ElementGL + room/blur FBOs rebuilt).';
          canvas.requestPaint?.();
          startLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      pipeline = new GlassPipeline(stage.gl);
      state.mode = 'webgl';
      routeNoteEl.textContent = 'Drawn with one ElementGL WebGL 2 context, mipmapped room and blur FBOs, Snell rim dispersion and projective updateElementGeometry().';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    } catch (err) {
      pipeline?.dispose();
      pipeline = null;
      stage = null;
      routeNoteEl.textContent = `WebGL 2 could not start (${err.message}); falling back to 2D.`;
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; using 5-argument drawElementImage() 2D glass fallback.';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the spatial panel is shown as plain HTML.');
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
    measureButtonSlots();
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

measureButtonSlots();
wireReducedMotion();
if (isReduced()) snapTargets();
updateExternalControlsUI();
updateHud(true);
initBackend();

// ---------------- Live Checks (Tap-Gated, Isolated testStage Fixtures) ----------------

const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

const luma = (px) => px[0] * 0.2126 + px[1] * 0.7152 + px[2] * 0.0722;

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = clamp(Math.round(cssX * (cv.width / w)), 0, Math.max(0, cv.width - 1));
  const ry = clamp(Math.round((h - cssY) * (cv.height / h)), 0, Math.max(0, cv.height - 1));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function readMaxBoxLuma(gl, cv, w, h, cssX, cssY, r = 2) {
  let best = 0;
  let bestPx = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = readCssPixel(gl, cv, w, h, cssX + dx, cssY + dy);
      const l = luma(px);
      if (l >= best) {
        best = l;
        bestPx = px;
      }
    }
  }
  return { luma: best, px: bestPx };
}

function makeFixtureGlass(w = 260, h = 190, { mode = 'solid' } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;background:#141822`;

  const panel = document.createElement('section');
  panel.setAttribute('drawable', '');
  panel.style.cssText =
    'position:absolute;left:0;top:0;width:200px;height:130px;padding:12px;box-sizing:border-box;' +
    'background:transparent;color:#ffffff;font:700 13px system-ui';

  let btn = null;
  if (mode === 'swatch') {
    const swatch = document.createElement('div');
    swatch.style.cssText = 'position:absolute;left:72px;top:44px;width:56px;height:42px;border-radius:10px;background:rgba(255,112,67,0.94);';
    panel.append(swatch);
  } else if (mode === 'button') {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Spatial Hit';
    btn.style.cssText =
      'position:absolute;left:40px;top:42px;width:120px;height:44px;border-radius:22px;' +
      'border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.14);color:#ffffff;font:700 13px system-ui;';
    panel.append(btn);
  } else if (mode === 'offcenter-button') {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Tilted Target';
    btn.style.cssText =
      'position:absolute;left:76px;top:16px;width:108px;height:40px;border-radius:20px;' +
      'border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.14);color:#ffffff;font:700 12.5px system-ui;';
    panel.append(btn);
  }

  cv.append(panel);
  return { cv, panel, btn };
}

function renderFixtureGlass(g, p, cv, panel, w, h, opts = {}) {
  const {
    rotX = 0,
    rotY = 0,
    lightX = -0.707,
    lightY = -0.707,
    frost = 0.72,
    refract = 0.85,
    envId = 0,
    dimGlass = 0.0,
    gazeX = 0,
    gazeY = 0,
    gazeActive = 0,
    btnRects = new Float32Array(24),
    btnRadii = new Float32Array(6),
    borderR = 24,
  } = opts;

  const elemW = panel.offsetWidth || 200;
  const elemH = panel.offsetHeight || 130;
  const geom = buildSpatialMatrices(w, h, elemW, elemH, rotX, rotY);

  g.begin([0.05, 0.06, 0.09, 1.0]);
  if (!g.has(panel)) g.upload(panel);

  p.renderBackdropAndBlur({
    cw: w,
    ch: h,
    envId,
    dimRoom: 0.0,
    parallaxX: 0,
    parallaxY: 0,
    timeSec: 0,
    reduced: true,
  });

  g.begin([0.05, 0.06, 0.09, 1.0]);

  const setU = (gl, loc, passIdx) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, p.roomFbo.tex);
    gl.uniform1i(loc('uRoomTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, p.blurFboB.tex);
    gl.uniform1i(loc('uBlurTex'), 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc('uPass'), passIdx);
    gl.uniform2f(loc('uResolution'), cv.width, cv.height);
    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform1f(loc('uBorderR'), borderR);
    gl.uniform1f(loc('uFrost'), frost);
    gl.uniform1f(loc('uRefract'), refract);
    gl.uniform1f(loc('uRotX'), geom.rx);
    gl.uniform1f(loc('uRotY'), geom.ry);
    gl.uniform2f(loc('uLight'), lightX, lightY);
    gl.uniform2f(loc('uGazeLocal'), gazeX, gazeY);
    gl.uniform1f(loc('uGazeActive'), gazeActive);
    gl.uniform1i(loc('uEnv'), envId);
    gl.uniform1f(loc('uDimGlass'), dimGlass);
    gl.uniformMatrix3fv(loc('uInvH'), false, geom.invHomography);
    gl.uniform4fv(loc('uBtnRects[0]'), btnRects);
    gl.uniform1fv(loc('uBtnRadii[0]'), btnRadii);
  };

  g.quad(panel, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => setU(gl, loc, 0));
  g.quad(panel, geom.uMvp, (gl, loc) => setU(gl, loc, 1));
  return geom;
}

runTests(testsBody, [
  {
    name: 'Panel upload, mipmapped room and Gaussian frost FBO pass (glErr === 0)',
    expect: 'pass',
    why: 'Builds an isolated fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), runs GlassPipeline FBOs, unbinds FBO/VAO and checks pixels.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 260, H = 190;
      const { cv, panel } = makeFixtureGlass(W, H, { mode: 'swatch' });
      testStage().append(cv);
      let g = null, p = null;
      try {
        g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlassPipeline(g.gl);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        await nextPaint(cv);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        const tex = g.upload(panel);
        renderFixtureGlass(g, p, cv, panel, W, H, { envId: 0, frost: 0.72 });
        const err = g.gl.getError();
        const swatchPx = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.5);
        const glassPx = readCssPixel(g.gl, cv, W, H, W * 0.5 - 70, H * 0.5);
        const roomPx = readCssPixel(g.gl, cv, W, H, 14, 24);
        return need(
          err === g.gl.NO_ERROR && tex?.w > 0 && swatchPx[0] > 180 && swatchPx[2] < 130 && luma(glassPx) > 15 && luma(roomPx) > 25,
          `tex=${tex?.w}×${tex?.h}, glErr=${err}, swatch=[${Array.from(swatchPx)}], glass=[${Array.from(glassPx)}], room=[${Array.from(roomPx)}]`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Moving light direction from top-left to bottom-right shifts the specular bevel rim',
    expect: 'pass',
    why: 'Renders the glass slab with light=(-0.71,-0.71) then light=(+0.71,+0.71) and samples the 1 to 2 px rounded corners with readPixels() to confirm the bright specular rim swaps across the perimeter.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 260, H = 190, R = 24;
      const { cv, panel } = makeFixtureGlass(W, H, { mode: 'solid' });
      testStage().append(cv);
      let g = null, p = null;
      try {
        g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlassPipeline(g.gl);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        await nextPaint(cv);

        const off = (R - 1.2) * Math.SQRT1_2;
        const tlX = W * 0.5 - 100 + R - off;
        const tlY = H * 0.5 - 65 + R - off;
        const brX = W * 0.5 + 100 - R + off;
        const brY = H * 0.5 + 65 - R + off;

        renderFixtureGlass(g, p, cv, panel, W, H, { lightX: -0.707, lightY: -0.707, refract: 1.0, envId: 1, borderR: R });
        const tlA = readMaxBoxLuma(g.gl, cv, W, H, tlX, tlY, 2);
        const brA = readMaxBoxLuma(g.gl, cv, W, H, brX, brY, 2);

        renderFixtureGlass(g, p, cv, panel, W, H, { lightX: 0.707, lightY: 0.707, refract: 1.0, envId: 1, borderR: R });
        const tlB = readMaxBoxLuma(g.gl, cv, W, H, tlX, tlY, 2);
        const brB = readMaxBoxLuma(g.gl, cv, W, H, brX, brY, 2);
        const err = g.gl.getError();

        return need(
          err === g.gl.NO_ERROR && tlA.luma > brA.luma + 30 && brB.luma > tlB.luma + 30 && brB.luma > brA.luma + 30,
          `TL light: TL=${tlA.luma.toFixed(1)} vs BR=${brA.luma.toFixed(1)}; BR light: TL=${tlB.luma.toFixed(1)} vs BR=${brB.luma.toFixed(1)}`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: '3D perspective tilt shifts corner luminance and gaze proximity brightens buttons',
    expect: 'pass',
    why: 'Compares flat 0° vs tilted (14°, 22°) corner Fresnel luminance and measures a translucent button slot before and after moving gaze coordinates onto its centre.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 260, H = 190;
      const { cv, panel } = makeFixtureGlass(W, H, { mode: 'button' });
      testStage().append(cv);
      let g = null, p = null;
      try {
        g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlassPipeline(g.gl);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        await nextPaint(cv);

        const btnRects = new Float32Array(24);
        btnRects[0] = 0; btnRects[1] = 0; btnRects[2] = 60; btnRects[3] = 22;
        const btnRadii = new Float32Array(6);
        btnRadii[0] = 22;

        // 1. Flat vs tilted corner Fresnel & perspective shift (right top interior corner)
        renderFixtureGlass(g, p, cv, panel, W, H, { rotX: 0, rotY: 0, lightX: 0.707, lightY: -0.707, envId: 1 });
        const cornerFlat = readCssPixel(g.gl, cv, W, H, W * 0.5 + 84, H * 0.5 - 48);

        renderFixtureGlass(g, p, cv, panel, W, H, { rotX: 14, rotY: 22, lightX: 0.707, lightY: -0.707, envId: 1 });
        const cornerTilt = readCssPixel(g.gl, cv, W, H, W * 0.5 + 84, H * 0.5 - 48);

        // 2. Gaze proximity glow over the centred button slot
        renderFixtureGlass(g, p, cv, panel, W, H, {
          rotX: 0, rotY: 0, envId: 1, gazeX: 90, gazeY: 55, gazeActive: 0, btnRects, btnRadii,
        });
        const btnOff = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.5);

        renderFixtureGlass(g, p, cv, panel, W, H, {
          rotX: 0, rotY: 0, envId: 1, gazeX: 0, gazeY: 0, gazeActive: 1, btnRects, btnRadii,
        });
        const btnLit = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.5);
        const err = g.gl.getError();

        const tiltDelta = Math.abs(luma(cornerTilt) - luma(cornerFlat));
        const gazeBoost = luma(btnLit) - luma(btnOff);
        return need(
          err === g.gl.NO_ERROR && tiltDelta >= 6 && gazeBoost >= 18,
          `cornerFlat=${luma(cornerFlat).toFixed(1)} vs cornerTilt=${luma(cornerTilt).toFixed(1)} (Δ=${tiltDelta.toFixed(1)}); gazeOff=${luma(btnOff).toFixed(1)} -> gazeOn=${luma(btnLit).toFixed(1)} (+${gazeBoost.toFixed(1)})`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Projective updateElementGeometry() aligns button hit-testing under 3D tilt',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled 3D perspective DOMMatrix + dataset.hitTick toggle to a fixture button at 0° flat and (14°, -18°) tilt, verifying document.elementsFromPoint() hits and click dispatch.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 280, H = 200;
      const { cv, panel, btn } = makeFixtureGlass(W, H, { mode: 'offcenter-button' });
      testStage().append(cv);
      let g = null, p = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          p = new GlassPipeline(g.gl);
          g.begin([0.05, 0.06, 0.09, 1.0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);

        const elemW = panel.offsetWidth;
        const elemH = panel.offsetHeight;
        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });

        const checkPose = async (rx, ry) => {
          const geom = g
            ? renderFixtureGlass(g, p, cv, panel, W, H, { rotX: rx, rotY: ry })
            : buildSpatialMatrices(W, H, elemW, elemH, rx, ry);
          const unit = geometryUnit(cv, panel, elemW);
          const target = new DOMMatrix().scale(unit, unit, 1).multiply(geom.cssMatrix);
          cv.updateElementGeometry(panel, { canvasTransform: target });
          panel.dataset.hitTick = panel.dataset.hitTick === '1' ? '0' : '1';
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const bx = 130;
          const by = 36;
          const m = geom.cssMatrix.toFloat32Array();
          const bw = m[3] * bx + m[7] * by + m[15];
          const sx = (m[0] * bx + m[4] * by + m[12]) / bw;
          const sy = (m[1] * bx + m[5] * by + m[13]) / bw;
          const rect = cv.getBoundingClientRect();
          const hits = document.elementsFromPoint(rect.left + sx, rect.top + sy);
          return { ok: hits.includes(btn), sx, sy, top: hits[0]?.tagName };
        };

        const flatHit = await checkPose(0, 0);
        const tiltHit = await checkPose(16, -24);
        const shiftPx = Math.hypot(tiltHit.sx - flatHit.sx, tiltHit.sy - flatHit.sy);
        if (tiltHit.ok) btn.click();
        return need(
          flatHit.ok && tiltHit.ok && shiftPx > 2.5 && clicks === 1,
          `0° (${flatHit.sx.toFixed(1)},${flatHit.sy.toFixed(1)})=${flatHit.ok} [${flatHit.top}]; 16°/-24° (${tiltHit.sx.toFixed(1)},${tiltHit.sy.toFixed(1)})=${tiltHit.ok} [${tiltHit.top}], shift=${shiftPx.toFixed(1)}px, clicks=${clicks}`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'webglcontextlost rescues to plain HTML, webglcontextrestored recovers and 5-arg 2D fallback draws',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an ElementGL + GlassPipeline fixture, then checks a 5-argument drawElementImage() 2D fixture.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220, H = 160;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, panel } = makeFixtureGlass(W, H, { mode: 'swatch' });
      wrap.append(cv, plain);
      testStage().append(wrap);
      let g = null, p = null;
      let lostFired = false, restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: COMPOSITE_FRAG,
          attributes: { alpha: false, preserveDrawingBuffer: true },
          onLost: () => {
            lostFired = true;
            p?.invalidate();
            plain.hidden = false;
            panel.inert = false;
            plain.append(panel);
          },
          onRestored: () => {
            restoredFired = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            p?.rebuild(g.gl);
            plain.hidden = true;
            cv.append(panel);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlassPipeline(g.gl);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        await nextPaint(cv);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        g.upload(panel);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(panel);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        g.begin([0.05, 0.06, 0.09, 1.0]);
        await nextPaint(cv);
        g.begin([0.05, 0.06, 0.09, 1.0]);
        const texAfter = g.upload(panel);
        renderFixtureGlass(g, p, cv, panel, W, H, { rotX: 8, rotY: -10 });
        const err = g.gl.getError();

        // Also test 5-arg drawElementImage() 2D fallback on a separate plain 2D fixture
        const cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = 'display:block;position:relative;width:160px;height:100px;';
        const el2d = document.createElement('div');
        el2d.setAttribute('drawable', '');
        el2d.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:60px;background:#ff7043;border-radius:12px;';
        cv2d.append(el2d);
        wrap.append(cv2d);
        const c2 = cv2d.getContext('2d');
        cv2d.width = 160;
        cv2d.height = 100;
        await nextPaint(cv2d);
        c2.reset();
        c2.drawElementImage(el2d, 20, 20, 120, 60);
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = 100;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2d, 0, 0);
        const px2d = cc.getImageData(80, 50, 1, 1).data;
        window.__gfx?.retire?.(cv2d);

        return need(
          inPlainWhileLost && restoredFired && !g.lost && cv.contains(panel) && texAfter?.w > 0 && err === g.gl.NO_ERROR && px2d[0] > 180,
          `plainWhileLost=${inPlainWhileLost}, restored=${restoredFired}, texAfter=${texAfter?.w}×${texAfter?.h}, glErr=${err}, 2dFallback=[${Array.from(px2d)}]`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'vision-glass stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !stage.has(panelEl)) return 0;
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
