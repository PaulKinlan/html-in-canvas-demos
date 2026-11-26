import { banner, nextPaint, runTests, supported as api2dSupported, testStage } from '/shared/support.js';
import { ElementGL, supported as elGlSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const canvas = document.getElementById('portal-canvas');
const plainHost = document.getElementById('plain-host');
const hud = document.getElementById('stage-hud');
const routeNote = document.getElementById('route-note');

const sourceBtns = Array.from(document.querySelectorAll('[data-source]'));
const arSynthBtn = document.getElementById('ar-synth-btn');
const recenterBtn = document.getElementById('recenter-btn');

const cardFg = document.getElementById('card-fg');
const cardMid = document.getElementById('card-mid');
const cardDeep = document.getElementById('card-deep');
const cardAr = document.getElementById('card-ar');

const fgPingBtn = document.getElementById('fg-ping');
const fgPingsOut = document.getElementById('fg-pings');
const fgTiltBtn = document.getElementById('fg-tilt');

const midLabelEl = document.getElementById('mid-label');
const midPaletteEl = document.getElementById('mid-palette');
const midDepthEl = document.getElementById('mid-depth');
const midDepthVal = document.getElementById('mid-depth-val');
const midPulseBtn = document.getElementById('mid-pulse');
const midStatusEl = document.getElementById('mid-status');

const deepTitleEl = document.getElementById('deep-title');
const deepEyeEl = document.getElementById('deep-eye');
const deepFrustumEl = document.getElementById('deep-frustum');
const deepSourceEl = document.getElementById('deep-source');
const deepHitEl = document.getElementById('deep-hit');
const deepResetBtn = document.getElementById('deep-reset');

const arFormatEl = document.getElementById('ar-format');
const arValueEl = document.getElementById('ar-value');
const arNoteEl = document.getElementById('ar-note');
const arStampBtn = document.getElementById('ar-stamp');
const arTapsOut = document.getElementById('ar-taps');

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const NEAR = 0.1;
const FAR = 20.0;
const DEFAULT_EYE = [0.0, 0.0, 2.6];

const PALETTES = {
  cyan:  { grid: [0.16, 0.78, 0.96], wall: [0.05, 0.09, 0.14], glow: [0.22, 0.88, 1.0] },
  amber: { grid: [0.96, 0.62, 0.18], wall: [0.11, 0.08, 0.05], glow: [1.0, 0.72, 0.28] },
  mono:  { grid: [0.76, 0.82, 0.90], wall: [0.08, 0.09, 0.11], glow: [0.92, 0.95, 1.0] },
};

// ---------------- Minimal 4x4 Column-Major Matrix & Off-Axis Frustum Math ----------------

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function mat4MulVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8]  * z + m[12] * w,
    m[1] * x + m[5] * y + m[9]  * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

// #region off-axis-frustum
/**
 * Build an asymmetric off-axis perspective view-projection matrix for a screen
 * glass plane at z = 0 spanning [-halfW, +halfW] x [-halfH, +halfH].
 * The four corners of z = 0 stay pinned to the canvas border for any eye pose.
 */
function buildOffAxisVP(eye, halfW, halfH, near = NEAR, far = FAR) {
  const ex = eye[0], ey = eye[1], ez = Math.max(0.8, eye[2]);
  const s = near / ez;
  const left   = (-halfW - ex) * s;
  const right  = ( halfW - ex) * s;
  const bottom = (-halfH - ey) * s;
  const top    = ( halfH - ey) * s;

  const rl = right - left;
  const tb = top - bottom;
  const fn = far - near;

  const proj = new Float32Array([
    (2 * near) / rl,     0,                    0,                     0,
    0,                   (2 * near) / tb,      0,                     0,
    (right + left) / rl, (top + bottom) / tb, -(far + near) / fn,    -1,
    0,                   0,                   -(2 * far * near) / fn, 0,
  ]);

  const view = new Float32Array([
    1,   0,   0,  0,
    0,   1,   0,  0,
    0,   0,   1,  0,
   -ex, -ey, -ez, 1,
  ]);

  return {
    vp: mat4Mul(proj, view),
    proj,
    view,
    bounds: { left, right, bottom, top },
  };
}
// #endregion off-axis-frustum

function screenHalfExtents(cw, ch) {
  const aspect = (cw || 1) / (ch || 1);
  if (aspect >= 1) return { halfW: aspect, halfH: 1.0, aspect };
  return { halfW: 1.0, halfH: 1.0 / aspect, aspect };
}

function buildCardFrame(cx, cy, cz, worldW, worldH, rx = 0, ry = 0) {
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  // Local +X right, local +Y down, local +Z out of card (R = Ry * Rx).
  const right = [cosY, 0, -sinY];
  const up    = [sinY * sinX, cosX, cosY * sinX];
  const norm  = [sinY * cosX, -sinX, cosY * cosX];
  const vx = [right[0] * worldW, right[1] * worldW, right[2] * worldW];
  const vy = [-up[0] * worldH, -up[1] * worldH, -up[2] * worldH];
  const origin = [
    cx - vx[0] * 0.5 - vy[0] * 0.5,
    cy - vx[1] * 0.5 - vy[1] * 0.5,
    cz - vx[2] * 0.5 - vy[2] * 0.5,
  ];
  return { o: origin, x: vx, y: vy, n: norm };
}

// #region projective-geometry
/**
 * Closed-form projective homography mapping unit square (0,0)-(1,1) to four
 * arbitrary canvas CSS corners p0 (TL), p1 (TR), p2 (BR), p3 (BL).
 */
function quadHomographyUnitToCss(p0, p1, p2, p3) {
  const dx1 = p1[0] - p2[0], dy1 = p1[1] - p2[1];
  const dx2 = p3[0] - p2[0], dy2 = p3[1] - p2[1];
  const sx = p0[0] - p1[0] + p2[0] - p3[0];
  const sy = p0[1] - p1[1] + p2[1] - p3[1];
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;
  const g = (sx * dy2 - sy * dx2) / det;
  const h = (dx1 * sy - dy1 * sx) / det;
  const a = p1[0] - p0[0] + g * p1[0];
  const b = p3[0] - p0[0] + h * p3[0];
  const c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1];
  const e = p3[1] - p0[1] + h * p3[1];
  const f = p0[1];
  return new Float32Array([
    a, d, 0, g,
    b, e, 0, h,
    0, 0, 1, 0,
    c, f, 0, 1,
  ]);
}

function buildCardMatrices(frame, vp, elW, elH, cw, ch) {
  const w = elW || 1, h = elH || 1;
  // Unit square [0..1]x[0..1] -> world -> clip space (for ElementGL.quad).
  const unitToWorld = new Float32Array([
    frame.x[0], frame.x[1], frame.x[2], 0,
    frame.y[0], frame.y[1], frame.y[2], 0,
    frame.n[0], frame.n[1], frame.n[2], 0,
    frame.o[0], frame.o[1], frame.o[2], 1,
  ]);
  const clipMat = mat4Mul(vp, unitToWorld);

  // Element CSS pixels [0..w]x[0..h] -> world -> clip -> canvas CSS pixels.
  const elemToWorld = new Float32Array([
    frame.x[0] / w, frame.x[1] / w, frame.x[2] / w, 0,
    frame.y[0] / h, frame.y[1] / h, frame.y[2] / h, 0,
    frame.n[0],     frame.n[1],     frame.n[2],     0,
    frame.o[0],     frame.o[1],     frame.o[2],     1,
  ]);
  const elemClip = mat4Mul(vp, elemToWorld);
  const ndcToCss = new Float32Array([
    cw / 2,  0,       0, 0,
    0,      -ch / 2,  0, 0,
    0,       0,       1, 0,
    cw / 2,  ch / 2,  0, 1,
  ]);
  const raw = mat4Mul(ndcToCss, elemClip);
  const wCenter = raw[3] * (w * 0.5) + raw[7] * (h * 0.5) + raw[15];
  if (wCenter <= 1e-4) return null;
  const invW = 1 / wCenter;
  const norm = new Float32Array(16);
  for (let i = 0; i < 16; i++) norm[i] = raw[i] * invW;
  return { clipMat, cssMatrix: new DOMMatrix(Array.from(norm)) };
}

function buildQuadCardMatrices(corners, elW, elH, cw, ch) {
  const unitToCss = quadHomographyUnitToCss(corners[0], corners[1], corners[2], corners[3]);
  if (!unitToCss) return null;
  const cssToNdc = new Float32Array([
    2 / cw,  0,       0, 0,
    0,      -2 / ch,  0, 0,
    0,       0,       1, 0,
   -1,       1,       0, 1,
  ]);
  const clipMat = mat4Mul(cssToNdc, unitToCss);
  const w = elW || 1, h = elH || 1;
  const elemToCss = new Float32Array([
    unitToCss[0] / w, unitToCss[1] / w, 0, unitToCss[3] / w,
    unitToCss[4] / h, unitToCss[5] / h, 0, unitToCss[7] / h,
    0,                0,                1, 0,
    unitToCss[12],    unitToCss[13],    0, unitToCss[15],
  ]);
  return { clipMat, cssMatrix: new DOMMatrix(Array.from(elemToCss)) };
}

function placeCardGeometry(cv, el, cssMatrix, unit, geoCache) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  el.inert = !cssMatrix;
  const target = cssMatrix
    ? new DOMMatrix().scale(unit, unit, 1).multiply(cssMatrix)
    : OFFSTAGE;
  if (!target) return;
  const vals = target.toFloat32Array();
  const prev = geoCache.get(el);
  if (prev && vals.every((v, i) => Math.abs(v - prev[i]) < 1e-4)) return;
  geoCache.set(el, vals);
  cv.updateElementGeometry(el, { canvasTransform: target });
  // Clear Chromium's hit-test cache after moving the projected quad.
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion projective-geometry

// ---------------- App State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  source: 'pointer', // 'pointer' | 'sweep' | 'tilt' | 'face' | 'ar'
  arSynthetic: false,
  eye: [...DEFAULT_EYE],
  targetEye: [...DEFAULT_EYE],
  depthGain: 1.0,
  tiltCards: false,
  palette: 'cyan',
  pulseStart: -10,
  pings: 0,
  pulses: 0,
  arTaps: 0,
  totalHits: 0,
  lastHit: 'none',
  // Pointer drag state
  dragging: false,
  dragId: null,
  dragLastX: 0,
  dragLastY: 0,
  // Tilt baseline
  tiltBase: null,
  // Camera & Shape Detection state
  stream: null,
  video: null,
  videoReady: false,
  faceDetector: null,
  barcodeDetector: null,
  detectBusy: false,
  lastDetectAt: 0,
  faceBox: null, // normalized [x0, y0, x1, y1] in video UV
  faceSeenAt: 0,
  arCorners: null, // 4 corners in canvas CSS px
  arSeenAt: 0,
  arValue: 'https://html-in-canvas.page/vision-portal/',
  arFormat: 'synthetic qr',
  // Render loop & caches
  onScreen: true,
  needsDraw: true,
  dirtyEls: new Set([cardFg, cardMid, cardDeep, cardAr]),
  geoCache: new WeakMap(),
  unitCache: { key: '', unit: 1 },
  lastTelemetryAt: 0,
  lastTelemetryKey: '',
  rafId: 0,
  statusMsg: '',
};

const ALL_CARDS = [cardFg, cardMid, cardDeep, cardAr];

function cachedGeometryUnit(el) {
  const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
  const key = `${canvas.width}x${canvas.height}/${cw}x${ch}`;
  if (state.unitCache.key === key) return state.unitCache.unit;
  const u = geometryUnit(canvas, el, el.offsetWidth || 1);
  state.unitCache = { key, unit: u };
  return u;
}

function getPortalCardSpecs(halfW, halfH, aspect) {
  const g = state.depthGain;
  const tiltY = state.tiltCards ? 0.24 : 0;
  const tiltX = state.tiltCards ? -0.10 : 0;

  const fgAspect = (cardFg.offsetHeight || 74) / (cardFg.offsetWidth || 340);
  const midAspect = (cardMid.offsetHeight || 204) / (cardMid.offsetWidth || 304);
  const deepAspect = (cardDeep.offsetHeight || 152) / (cardDeep.offsetWidth || 304);

  if (aspect >= 1.05) {
    const fgW = Math.min(1.36, halfW * 0.92);
    const midW = Math.min(1.34, halfW * 0.88);
    const deepW = Math.min(1.52, halfW * 1.02);
    return [
      {
        el: cardDeep, z: -0.85 * g, depthTint: 0.22, rim: [0.96, 0.68, 0.20],
        frame: buildCardFrame(halfW * 0.52, -0.22, -0.85 * g, deepW, deepW * deepAspect, 0, -tiltY),
      },
      {
        el: cardMid, z: -0.35 * g, depthTint: 0.08, rim: [0.22, 0.78, 0.96],
        frame: buildCardFrame(-halfW * 0.38, -0.18, -0.35 * g, midW, midW * midAspect, 0, tiltY),
      },
      {
        el: cardFg, z: 0.15 * g, depthTint: 0.0, rim: [0.35, 0.86, 1.0],
        frame: buildCardFrame(0.0, 0.62, 0.15 * g, fgW, fgW * fgAspect, tiltX, 0),
      },
    ];
  }

  // Portrait layout for 412 px phones: three distinct vertical bands, zero overlap.
  const fgW = 1.44;
  const midW = 1.54;
  const deepW = 1.66;
  return [
    {
      el: cardDeep, z: -0.85 * g, depthTint: 0.22, rim: [0.96, 0.68, 0.20],
      frame: buildCardFrame(0.0, -halfH * 0.72, -0.85 * g, deepW, deepW * deepAspect, 0, -tiltY * 0.8),
    },
    {
      el: cardMid, z: -0.35 * g, depthTint: 0.08, rim: [0.22, 0.78, 0.96],
      frame: buildCardFrame(0.0, halfH * 0.06, -0.35 * g, midW, midW * midAspect, 0, tiltY * 0.8),
    },
    {
      el: cardFg, z: 0.15 * g, depthTint: 0.0, rim: [0.35, 0.86, 1.0],
      frame: buildCardFrame(0.0, halfH * 0.69, 0.15 * g, fgW, fgW * fgAspect, tiltX, 0),
    },
  ];
}

// ---------------- Synthetic Tilted QR Target (for AR without camera/flag) ----------------

function computeSyntheticQrQuad(timeSec, cw, ch) {
  const { halfW, halfH } = screenHalfExtents(cw, ch);
  const { vp } = buildOffAxisVP([0, 0, 2.5], halfW, halfH);
  const yaw = Math.sin(timeSec * 0.72) * 0.42;
  const pitch = Math.cos(timeSec * 0.53) * 0.26;
  const tx = Math.sin(timeSec * 0.44) * (halfW * 0.24);
  const ty = Math.cos(timeSec * 0.61) * (halfH * 0.16);
  const tz = -0.35 + Math.sin(timeSec * 0.37) * 0.16;

  const side = Math.min(halfW, halfH) * 1.15;
  const qrFrame = buildCardFrame(tx, ty, tz, side, side, pitch, yaw);

  const projectPoint = (u, v) => {
    const wx = qrFrame.o[0] + qrFrame.x[0] * u + qrFrame.y[0] * v;
    const wy = qrFrame.o[1] + qrFrame.x[1] * u + qrFrame.y[1] * v;
    const wz = qrFrame.o[2] + qrFrame.x[2] * u + qrFrame.y[2] * v;
    const c = mat4MulVec4(vp, wx, wy, wz, 1);
    const nx = c[0] / c[3], ny = c[1] / c[3];
    return [(nx * 0.5 + 0.5) * cw, (0.5 - ny * 0.5) * ch];
  };

  // Outer QR board corners (for drawing the procedural QR fiducial in WebGL).
  const qrCorners = [
    projectPoint(0, 0),
    projectPoint(1, 0),
    projectPoint(1, 1),
    projectPoint(0, 1),
  ];

  // Inner pinned HTML card quad inset slightly so the QR finder squares stay visible around it.
  const arAspect = (cardAr.offsetHeight || 156) / (cardAr.offsetWidth || 248);
  const u0 = 0.04, u1 = 0.96;
  const vHalf = ((u1 - u0) * arAspect) * 0.5;
  const v0 = 0.5 - vHalf, v1 = 0.5 + vHalf;
  const cardCorners = [
    projectPoint(u0, v0),
    projectPoint(u1, v0),
    projectPoint(u1, v1),
    projectPoint(u0, v1),
  ];

  return { qrCorners, cardCorners, qrClipMat: buildQuadCardMatrices(qrCorners, 1, 1, cw, ch)?.clipMat };
}

// ---------------- WebGL 2 Shaders on ElementGL's Single Context ----------------

const CARD_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uDepthTint;
uniform vec3 uRimColor;
uniform vec2 uHead;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUv);
  if (tex.a < 0.004) discard;
  vec3 rgb = tex.rgb / max(tex.a, 0.0001);
  // Subtle depth darkening so deeper planes visually sit further back.
  rgb = mix(rgb, rgb * 0.86 + vec3(0.02, 0.04, 0.07), uDepthTint);
  // Specular glass sheen shifting subtly with virtual head angle.
  vec2 sheenDir = normalize(vec2(0.7, 0.7) + uHead * 0.45);
  float sheen = smoothstep(0.65, 1.0, dot(vUv - 0.5, sheenDir) + 0.42) * 0.055;
  rgb += uRimColor * sheen;
  // Crisp thin rim highlight around the card perimeter.
  vec2 edge = min(vUv, 1.0 - vUv) * uSize;
  float border = 1.0 - smoothstep(0.6, 2.2, min(edge.x, edge.y));
  rgb = mix(rgb, uRimColor, border * 0.28);
  outColor = vec4(rgb * tex.a, tex.a);
}`;

const ROOM_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec2 aGrid;
uniform mat4 uVP;
uniform vec2 uHalf;
out vec3 vWorld;
out vec3 vNorm;
out vec2 vGrid;
void main() {
  vec3 w = vec3(aPos.x * uHalf.x, aPos.y * uHalf.y, aPos.z);
  vWorld = w;
  vNorm = aNorm;
  vGrid = aGrid * vec2(abs(aNorm.x) > 0.5 ? 1.0 : uHalf.x, abs(aNorm.y) > 0.5 ? 1.0 : uHalf.y);
  gl_Position = uVP * vec4(w, 1.0);
}`;

const ROOM_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNorm;
in vec2 vGrid;
uniform vec3 uGridCol;
uniform vec3 uWallCol;
uniform vec3 uGlowCol;
uniform float uPulseAge;
uniform float uDepthGain;
out vec4 outColor;

float gridLine(vec2 coord, float spacing, float width) {
  vec2 p = coord / spacing;
  vec2 fw = max(fwidth(p), vec2(0.0005));
  vec2 a = abs(fract(p - 0.5) - 0.5) / fw;
  float line = 1.0 - min(min(a.x, a.y), 1.0);
  return smoothstep(0.0, 1.0, line * width);
}

void main() {
  float depth = clamp(-vWorld.z / 1.55, 0.0, 1.0);
  vec2 gCoord = abs(vNorm.z) > 0.5 ? vWorld.xy : (abs(vNorm.x) > 0.5 ? vec2(vWorld.z, vWorld.y) : vec2(vWorld.x, vWorld.z));

  float major = gridLine(gCoord, 0.32, 1.15);
  float minor = gridLine(gCoord, 0.08, 0.45) * 0.28;
  float g = max(major, minor);

  // Depth plane rings marking z = -0.35 and z = -0.85 on the side walls and floor.
  float zMid = -0.35 * uDepthGain;
  float zDeep = -0.85 * uDepthGain;
  float ring = 0.0;
  if (abs(vNorm.z) < 0.5) {
    float fwz = max(fwidth(vWorld.z), 0.002);
    ring += (1.0 - smoothstep(0.0, fwz * 2.2, abs(vWorld.z - zMid))) * 0.65;
    ring += (1.0 - smoothstep(0.0, fwz * 2.2, abs(vWorld.z - zDeep))) * 0.55;
    // Glass opening rim at z = 0.
    ring += (1.0 - smoothstep(0.0, 0.04, -vWorld.z)) * 0.45;
  }

  // Animated pulse wave racing into the room when user clicks "Pulse depth grid".
  float pulseZ = -uPulseAge * 2.1;
  float pulse = exp(-pow((vWorld.z - pulseZ) * 6.5, 2.0)) * smoothstep(1.2, 0.0, uPulseAge);

  // Depth shading + subtle corner vignette.
  float shade = mix(1.0, 0.38, depth);
  vec3 col = uWallCol * shade;
  col += uGridCol * g * mix(0.85, 0.36, depth);
  col += uGlowCol * (ring * 0.6 + pulse * (0.45 + g * 0.9));

  outColor = vec4(col, 1.0);
}`;

const BACKDROP_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform mat4 uMatrix;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = uMatrix * vec4(aPos, 0.0, 1.0);
}`;

const BACKDROP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform int uMode; // 0 = video texture, 1 = procedural desk backdrop, 2 = procedural QR marker
uniform sampler2D uVideoTex;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
uniform float uMirror;
uniform float uTime;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float finderPattern(vec2 cell, vec2 origin) {
  vec2 d = abs(cell - origin);
  float m = max(d.x, d.y);
  if (m <= 1.5) return 1.0;
  if (m <= 2.5) return 0.0;
  if (m <= 3.5) return 1.0;
  return -1.0;
}

void main() {
  if (uMode == 0) {
    vec2 uv = vec2(uMirror > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
    uv = uv * uUvScale + uUvOffset;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      outColor = vec4(0.05, 0.07, 0.10, 1.0);
      return;
    }
    vec4 c = texture(uVideoTex, uv);
    outColor = vec4(c.rgb, 1.0);
    return;
  }

  if (uMode == 1) {
    // Subtle dark workbench grid behind the synthetic AR target.
    vec2 g = fract(vUv * vec2(14.0, 9.0));
    float line = step(0.96, g.x) + step(0.96, g.y);
    float vig = 1.0 - 0.45 * length(vUv - 0.5);
    vec3 col = vec3(0.07, 0.09, 0.12) * vig + vec3(0.04, 0.09, 0.12) * min(line, 1.0);
    outColor = vec4(col, 1.0);
    return;
  }

  // Procedural high-contrast 21x21 QR fiducial marker with white quiet zone.
  vec2 q = vUv * 25.0 - 2.0;
  if (q.x < 0.0 || q.x >= 21.0 || q.y < 0.0 || q.y >= 21.0) {
    outColor = vec4(0.95, 0.96, 0.94, 1.0);
    return;
  }
  vec2 cell = floor(q);
  float f = finderPattern(cell, vec2(3.0, 3.0));
  if (f < 0.0) f = finderPattern(cell, vec2(17.0, 3.0));
  if (f < 0.0) f = finderPattern(cell, vec2(3.0, 17.0));
  float dark = 0.0;
  if (f >= 0.0) {
    dark = f;
  } else if ((cell.x < 8.0 && cell.y < 8.0) || (cell.x > 12.0 && cell.y < 8.0) || (cell.x < 8.0 && cell.y > 12.0)) {
    dark = 0.0;
  } else if (cell.x == 6.0 || cell.y == 6.0) {
    dark = mod(cell.x + cell.y, 2.0) < 0.5 ? 1.0 : 0.0;
  } else {
    dark = hash21(cell) > 0.48 ? 1.0 : 0.0;
  }
  vec3 col = mix(vec3(0.96, 0.97, 0.95), vec3(0.07, 0.09, 0.11), dark);
  outColor = vec4(col, 1.0);
}`;

const LINE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aNdc;
void main() {
  gl_Position = vec4(aNdc, 0.0, 1.0);
}`;

const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

function compileProg(gl, vSrc, fSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'shader compile failed');
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
  }
  return p;
}

function buildRoomGeometry() {
  const z0 = 0.0, z1 = -1.55;
  const verts = [];
  const pushQuad = (a, b, c, d, n) => {
    const tri = [a, b, c, a, c, d];
    for (const p of tri) {
      verts.push(p[0], p[1], p[2], n[0], n[1], n[2], p[0], p[1]);
    }
  };
  // Back wall (z = z1, normal +Z)
  pushQuad([-1, -1, z1], [1, -1, z1], [1, 1, z1], [-1, 1, z1], [0, 0, 1]);
  // Left wall (x = -1, normal +X)
  pushQuad([-1, -1, z0], [-1, -1, z1], [-1, 1, z1], [-1, 1, z0], [1, 0, 0]);
  // Right wall (x = +1, normal -X)
  pushQuad([1, -1, z1], [1, -1, z0], [1, 1, z0], [1, 1, z1], [-1, 0, 0]);
  // Floor (y = -1, normal +Y)
  pushQuad([-1, -1, z0], [1, -1, z0], [1, -1, z1], [-1, -1, z1], [0, 1, 0]);
  // Ceiling (y = +1, normal -Y)
  pushQuad([-1, 1, z1], [1, 1, z1], [1, 1, z0], [-1, 1, z0], [0, -1, 0]);
  return new Float32Array(verts);
}

let stage = null;
let glAux = null;

function initAuxGL(gl) {
  const roomProg = compileProg(gl, ROOM_VERT, ROOM_FRAG);
  const backdropProg = compileProg(gl, BACKDROP_VERT, BACKDROP_FRAG);
  const lineProg = compileProg(gl, LINE_VERT, LINE_FRAG);

  const roomVao = gl.createVertexArray();
  const roomVbo = gl.createBuffer();
  const roomData = buildRoomGeometry();
  gl.bindVertexArray(roomVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, roomVbo);
  gl.bufferData(gl.ARRAY_BUFFER, roomData, gl.STATIC_DRAW);
  const stride = 8 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);

  const quadVao = gl.createVertexArray();
  const quadVbo = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const lineVao = gl.createVertexArray();
  const lineVbo = gl.createBuffer();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 32 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const videoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([14, 18, 26, 255]));

  return {
    roomProg,
    roomVao,
    roomCount: roomData.length / 8,
    uR: {
      uVP: gl.getUniformLocation(roomProg, 'uVP'),
      uHalf: gl.getUniformLocation(roomProg, 'uHalf'),
      uGridCol: gl.getUniformLocation(roomProg, 'uGridCol'),
      uWallCol: gl.getUniformLocation(roomProg, 'uWallCol'),
      uGlowCol: gl.getUniformLocation(roomProg, 'uGlowCol'),
      uPulseAge: gl.getUniformLocation(roomProg, 'uPulseAge'),
      uDepthGain: gl.getUniformLocation(roomProg, 'uDepthGain'),
    },
    backdropProg,
    quadVao,
    uB: {
      uMatrix: gl.getUniformLocation(backdropProg, 'uMatrix'),
      uMode: gl.getUniformLocation(backdropProg, 'uMode'),
      uVideoTex: gl.getUniformLocation(backdropProg, 'uVideoTex'),
      uUvScale: gl.getUniformLocation(backdropProg, 'uUvScale'),
      uUvOffset: gl.getUniformLocation(backdropProg, 'uUvOffset'),
      uMirror: gl.getUniformLocation(backdropProg, 'uMirror'),
      uTime: gl.getUniformLocation(backdropProg, 'uTime'),
    },
    lineProg,
    lineVao,
    lineVbo,
    uL: {
      uColor: gl.getUniformLocation(lineProg, 'uColor'),
    },
    videoTex,
  };
}

// ---------------- Camera & Shape Detection APIs ----------------

// #region shape-detectors
function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  if (state.video) {
    state.video.pause();
    state.video.srcObject = null;
  }
  state.videoReady = false;
  state.detectBusy = false;
  state.faceBox = null;
}

async function openCamera(facingMode) {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('navigator.mediaDevices.getUserMedia() is not available');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  if (!state.video) {
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.autoplay = true;
    state.video = v;
  }
  state.stream = stream;
  state.video.srcObject = stream;
  await state.video.play();
  state.videoReady = true;
  return state.video;
}

function videoCoverTransform(vw, vh, cw, ch) {
  const s = Math.max(cw / (vw || 1), ch / (vh || 1));
  const ox = (cw - vw * s) * 0.5;
  const oy = (ch - vh * s) * 0.5;
  // UV scale & offset that map [0..1] canvas UV into [0..1] video UV matching object-fit: cover.
  const uvScale = [cw / (vw * s), ch / (vh * s)];
  const uvOffset = [-ox / (vw * s), -oy / (vh * s)];
  return { scale: s, ox, oy, uvScale, uvOffset };
}

function pollShapeDetectors(now, cw, ch) {
  if (!state.videoReady || !state.video || state.video.readyState < 2) return;
  if (state.detectBusy || now - state.lastDetectAt < 48) return;
  const vw = state.video.videoWidth, vh = state.video.videoHeight;
  if (!vw || !vh) return;

  if (state.source === 'face' && state.faceDetector) {
    state.detectBusy = true;
    state.lastDetectAt = now;
    state.faceDetector.detect(state.video).then((faces) => {
      state.detectBusy = false;
      if (state.source !== 'face' || !faces?.length) return;
      const box = faces[0].boundingBox;
      const cx = (box.x + box.width * 0.5) / vw;
      const cy = (box.y + box.height * 0.5) / vh;
      const fw = box.width / vw;
      state.faceBox = [box.x / vw, box.y / vh, (box.x + box.width) / vw, (box.y + box.height) / vh];
      state.faceSeenAt = performance.now();
      // Mirror horizontally so moving your head left shifts the virtual eye left.
      state.targetEye[0] = Math.max(-1.35, Math.min(1.35, -(cx - 0.5) * 2.4));
      state.targetEye[1] = Math.max(-0.95, Math.min(0.95, -(cy - 0.5) * 1.9));
      state.targetEye[2] = Math.max(1.5, Math.min(3.8, 3.2 - fw * 2.2));
      state.needsDraw = true;
    }).catch(() => {
      state.detectBusy = false;
    });
  } else if (state.source === 'ar' && !state.arSynthetic && state.barcodeDetector) {
    state.detectBusy = true;
    state.lastDetectAt = now;
    state.barcodeDetector.detect(state.video).then((codes) => {
      state.detectBusy = false;
      if (state.source !== 'ar' || state.arSynthetic || !codes?.length) return;
      const code = codes[0];
      const cov = videoCoverTransform(vw, vh, cw, ch);
      let pts = code.cornerPoints;
      if (!pts || pts.length < 4) {
        const b = code.boundingBox;
        pts = [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ];
      }
      const mapped = pts.slice(0, 4).map((p) => [p.x * cov.scale + cov.ox, p.y * cov.scale + cov.oy]);
      if (!state.arCorners) {
        state.arCorners = mapped;
      } else {
        for (let i = 0; i < 4; i++) {
          state.arCorners[i][0] += (mapped[i][0] - state.arCorners[i][0]) * 0.45;
          state.arCorners[i][1] += (mapped[i][1] - state.arCorners[i][1]) * 0.45;
        }
      }
      state.arSeenAt = performance.now();
      const val = code.rawValue || '(empty payload)';
      const fmt = code.format || 'barcode';
      if (val !== state.arValue || fmt !== state.arFormat) {
        state.arValue = val;
        state.arFormat = fmt;
        arValueEl.textContent = val;
        arFormatEl.textContent = fmt;
        state.dirtyEls.add(cardAr);
      }
      state.needsDraw = true;
    }).catch(() => {
      state.detectBusy = false;
    });
  }
}
// #endregion shape-detectors

// ---------------- Rendering (ElementGL WebGL 2 + 2D fallback + Plain HTML) ----------------

function switchToPlain(reason) {
  state.backend = 'plain';
  stopCamera();
  cancelAnimationFrame(state.rafId);
  canvas.hidden = true;
  plainHost.replaceChildren(...ALL_CARDS);
  for (const el of ALL_CARDS) el.inert = false;
  hud.textContent = 'plain HTML fallback';
  routeNote.textContent = reason;
}

function drawQuadOutline(gl, aux, corners, cw, ch, color) {
  const toNdc = (p) => [(p[0] / cw) * 2 - 1, 1 - (p[1] / ch) * 2];
  const ndc = corners.map(toNdc);
  const verts = new Float32Array([
    ndc[0][0], ndc[0][1], ndc[1][0], ndc[1][1],
    ndc[1][0], ndc[1][1], ndc[2][0], ndc[2][1],
    ndc[2][0], ndc[2][1], ndc[3][0], ndc[3][1],
    ndc[3][0], ndc[3][1], ndc[0][0], ndc[0][1],
  ]);
  gl.useProgram(aux.lineProg);
  gl.bindVertexArray(aux.lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, aux.lineVbo);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
  gl.uniform4fv(aux.uL.uColor, color);
  gl.drawArrays(gl.LINES, 0, 8);
}

// #region gl-render
function renderWebGL(now) {
  if (!stage || stage.lost) return;
  const gl = stage.gl;
  const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
  const timeSec = now / 1000;

  if (!stage.begin([0.05, 0.07, 0.10, 1.0])) return;
  // Save ElementGL's active program & VAO so we can draw backdrop shaders and restore them before stage.quad().
  const elProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const elVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);

  if (state.source === 'ar') {
    // 1. Background: live camera video texture or synthetic desk + moving QR target.
    gl.useProgram(glAux.backdropProg);
    gl.bindVertexArray(glAux.quadVao);
    gl.uniform1f(glAux.uB.uTime, timeSec);

    const fullMat = ElementGL.rect(canvas, 0, 0, cw, ch);
    let activeCardCorners = null;
    let activeOutlineCorners = null;

    if (!state.arSynthetic && state.videoReady && state.video.readyState >= 2) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glAux.videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.video);
      const cov = videoCoverTransform(state.video.videoWidth, state.video.videoHeight, cw, ch);
      gl.uniformMatrix4fv(glAux.uB.uMatrix, false, fullMat);
      gl.uniform1i(glAux.uB.uMode, 0);
      gl.uniform1i(glAux.uB.uVideoTex, 0);
      gl.uniform2fv(glAux.uB.uUvScale, cov.uvScale);
      gl.uniform2fv(glAux.uB.uUvOffset, cov.uvOffset);
      gl.uniform1f(glAux.uB.uMirror, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (state.arCorners && now - state.arSeenAt < 1200) {
        activeCardCorners = state.arCorners;
        activeOutlineCorners = state.arCorners;
      }
    } else {
      // Synthetic desk + tilted moving procedural QR marker.
      gl.uniformMatrix4fv(glAux.uB.uMatrix, false, fullMat);
      gl.uniform1i(glAux.uB.uMode, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const synth = computeSyntheticQrQuad(timeSec, cw, ch);
      if (synth.qrClipMat) {
        gl.uniformMatrix4fv(glAux.uB.uMatrix, false, synth.qrClipMat);
        gl.uniform1i(glAux.uB.uMode, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        activeCardCorners = synth.cardCorners;
        activeOutlineCorners = synth.qrCorners;
      }
    }

    if (activeOutlineCorners) {
      drawQuadOutline(gl, glAux, activeOutlineCorners, cw, ch, [0.18, 0.94, 0.45, 1.0]);
    }

    // 2. Restore ElementGL and draw #card-ar onto the 4-corner marker homography.
    gl.useProgram(elProg);
    gl.bindVertexArray(elVao);
    const unit = cachedGeometryUnit(cardAr);
    placeCardGeometry(canvas, cardFg, null, unit, state.geoCache);
    placeCardGeometry(canvas, cardMid, null, unit, state.geoCache);
    placeCardGeometry(canvas, cardDeep, null, unit, state.geoCache);

    if (activeCardCorners && stage.has(cardAr)) {
      const m = buildQuadCardMatrices(activeCardCorners, cardAr.offsetWidth, cardAr.offsetHeight, cw, ch);
      if (m) {
        stage.quad(cardAr, m.clipMat, (g, uniform) => {
          g.uniform1f(uniform('uDepthTint'), 0.0);
          g.uniform3f(uniform('uRimColor'), 0.16, 0.88, 0.42);
          g.uniform2f(uniform('uHead'), 0, 0);
        });
        placeCardGeometry(canvas, cardAr, m.cssMatrix, unit, state.geoCache);
      }
    } else {
      placeCardGeometry(canvas, cardAr, null, unit, state.geoCache);
    }

    hud.textContent = state.arSynthetic
      ? `AR synthetic QR | homography 4-corner pin | taps ${state.arTaps}`
      : (activeCardCorners
        ? `BarcodeDetector (${state.arFormat}) locked | ${state.arValue.slice(0, 32)}`
        : 'BarcodeDetector scanning camera feed | aim at a QR code');
    return;
  }

  // Portal mode: 1. Draw recessed 3D grid room under the off-axis asymmetric frustum.
  const { halfW, halfH, aspect } = screenHalfExtents(cw, ch);
  const { vp, bounds } = buildOffAxisVP(state.eye, halfW, halfH);
  const pal = PALETTES[state.palette] || PALETTES.cyan;

  gl.useProgram(glAux.roomProg);
  gl.bindVertexArray(glAux.roomVao);
  gl.uniformMatrix4fv(glAux.uR.uVP, false, vp);
  gl.uniform2f(glAux.uR.uHalf, halfW, halfH);
  gl.uniform3fv(glAux.uR.uGridCol, pal.grid);
  gl.uniform3fv(glAux.uR.uWallCol, pal.wall);
  gl.uniform3fv(glAux.uR.uGlowCol, pal.glow);
  gl.uniform1f(glAux.uR.uPulseAge, Math.max(0, timeSec - state.pulseStart));
  gl.uniform1f(glAux.uR.uDepthGain, state.depthGain);
  gl.drawArrays(gl.TRIANGLES, 0, glAux.roomCount);

  // Optional corner selfie mirror PiP when FaceDetector camera mode is active.
  if (state.source === 'face' && state.videoReady && state.video.readyState >= 2) {
    gl.useProgram(glAux.backdropProg);
    gl.bindVertexArray(glAux.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glAux.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.video);
    const pipW = Math.min(120, Math.round(cw * 0.24));
    const pipH = Math.round(pipW * 0.75);
    const pipX = cw - pipW - 10, pipY = 10;
    gl.uniformMatrix4fv(glAux.uB.uMatrix, false, ElementGL.rect(canvas, pipX, pipY, pipW, pipH));
    gl.uniform1i(glAux.uB.uMode, 0);
    gl.uniform1i(glAux.uB.uVideoTex, 0);
    gl.uniform2f(glAux.uB.uUvScale, 1, 1);
    gl.uniform2f(glAux.uB.uUvOffset, 0, 0);
    gl.uniform1f(glAux.uB.uMirror, 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (state.faceBox && now - state.faceSeenAt < 1000) {
      const [fx0, fy0, fx1, fy1] = state.faceBox;
      // Mirror X inside PiP to match the mirrored video feed.
      const x0 = pipX + (1 - fx1) * pipW;
      const x1 = pipX + (1 - fx0) * pipW;
      const y0 = pipY + fy0 * pipH;
      const y1 = pipY + fy1 * pipH;
      drawQuadOutline(gl, glAux, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], cw, ch, [0.22, 0.96, 0.48, 1.0]);
    }
  }

  // 2. Restore ElementGL and draw the three depth-layered HTML cards back-to-front.
  gl.useProgram(elProg);
  gl.bindVertexArray(elVao);
  const unit = cachedGeometryUnit(cardMid);
  placeCardGeometry(canvas, cardAr, null, unit, state.geoCache);

  const specs = getPortalCardSpecs(halfW, halfH, aspect);
  for (const spec of specs) {
    const m = buildCardMatrices(spec.frame, vp, spec.el.offsetWidth, spec.el.offsetHeight, cw, ch);
    if (!m) {
      placeCardGeometry(canvas, spec.el, null, unit, state.geoCache);
      continue;
    }
    if (stage.has(spec.el)) {
      stage.quad(spec.el, m.clipMat, (g, uniform) => {
        g.uniform1f(uniform('uDepthTint'), spec.depthTint);
        g.uniform3fv(uniform('uRimColor'), spec.rim);
        g.uniform2f(uniform('uHead'), state.eye[0], state.eye[1]);
      });
    }
    placeCardGeometry(canvas, spec.el, m.cssMatrix, unit, state.geoCache);
  }

  // Throttle DOM updates inside #card-deep so telemetry stays live without forcing 60 Hz uploads.
  updateDeepTelemetry(now, bounds);

  hud.textContent =
    `eye (${state.eye[0].toFixed(2)}, ${state.eye[1].toFixed(2)}, ${state.eye[2].toFixed(2)}) | ` +
    `frustum L ${bounds.left.toFixed(3)} R ${bounds.right.toFixed(3)} | ${state.source}`;
}
// #endregion gl-render

let ctx2d = null;

function render2DFallback(now) {
  if (!ctx2d) return;
  const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.75);
  const bw = Math.max(1, Math.round(cw * dpr)), bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }

  ctx2d.resetTransform();
  ctx2d.scale(dpr, dpr);
  ctx2d.fillStyle = '#0e131b';
  ctx2d.fillRect(0, 0, cw, ch);

  const { halfW, halfH, aspect } = screenHalfExtents(cw, ch);
  const { vp, bounds } = buildOffAxisVP(state.eye, halfW, halfH);

  // Simple recessed wireframe rings in 2D.
  ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx2d.lineWidth = 1;
  for (const z of [-0.35, -0.85, -1.55]) {
    const pts = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]].map(([x, y]) => {
      const c = mat4MulVec4(vp, x, y, z, 1);
      return [(c[0] / c[3] * 0.5 + 0.5) * cw, (0.5 - c[1] / c[3] * 0.5) * ch];
    });
    ctx2d.beginPath();
    ctx2d.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i++) ctx2d.lineTo(pts[i][0], pts[i][1]);
    ctx2d.closePath();
    ctx2d.stroke();
  }

  const unit = cachedGeometryUnit(cardMid);
  placeCardGeometry(canvas, cardAr, null, unit, state.geoCache);
  for (const spec of getPortalCardSpecs(halfW, halfH, aspect)) {
    const el = spec.el;
    const w = el.offsetWidth || 1, h = el.offsetHeight || 1;
    const m = buildCardMatrices(spec.frame, vp, w, h, cw, ch);
    if (!m) continue;
    const tl = m.cssMatrix.transformPoint(new DOMPoint(0, 0, 0, 1));
    const br = m.cssMatrix.transformPoint(new DOMPoint(w, h, 0, 1));
    const dx = tl.x / tl.w, dy = tl.y / tl.w;
    const dw = br.x / br.w - dx, dh = br.y / br.w - dy;
    ctx2d.drawElementImage(el, dx, dy, dw, dh);
    placeCardGeometry(canvas, el, m.cssMatrix, unit, state.geoCache);
  }
  updateDeepTelemetry(now, bounds);
  hud.textContent = `2D fallback | eye (${state.eye[0].toFixed(2)}, ${state.eye[1].toFixed(2)}, ${state.eye[2].toFixed(2)})`;
}

function updateDeepTelemetry(now, bounds) {
  if (now - state.lastTelemetryAt < 140) return;
  const eyeStr = `(${state.eye[0].toFixed(2)}, ${state.eye[1].toFixed(2)}, ${state.eye[2].toFixed(2)})`;
  const frStr = `L ${bounds.left.toFixed(2)} R ${bounds.right.toFixed(2)} B ${bounds.bottom.toFixed(2)} T ${bounds.top.toFixed(2)}`;
  const hitStr = `${state.lastHit} (${state.totalHits} total)`;
  const key = `${eyeStr}|${frStr}|${state.source}|${hitStr}`;
  if (key === state.lastTelemetryKey) return;
  state.lastTelemetryAt = now;
  state.lastTelemetryKey = key;
  deepEyeEl.textContent = eyeStr;
  deepFrustumEl.textContent = frStr;
  deepSourceEl.textContent = state.source;
  deepHitEl.textContent = hitStr;
}

// ---------------- Frame Loop ----------------

function isContinuous() {
  if (state.source === 'sweep' || state.source === 'tilt') return true;
  if (state.source === 'face' && state.videoReady) return true;
  if (state.source === 'ar') return true;
  if (performance.now() / 1000 - state.pulseStart < 1.3) return true;
  const diff = Math.hypot(
    state.targetEye[0] - state.eye[0],
    state.targetEye[1] - state.eye[1],
    state.targetEye[2] - state.eye[2]
  );
  return diff > 0.002;
}

function scheduleDraw() {
  state.needsDraw = true;
  if (!state.rafId && state.backend !== 'plain') {
    state.rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  state.rafId = 0;
  if (state.backend === 'plain' || document.hidden || !state.onScreen) return;

  if (state.source === 'sweep') {
    const t = now / 1000;
    state.targetEye[0] = Math.sin(t * 0.85) * 0.92;
    state.targetEye[1] = Math.sin(t * 0.57) * 0.48;
    state.targetEye[2] = 2.55 + Math.cos(t * 0.42) * 0.25;
  }

  // Smooth virtual eye motion.
  for (let i = 0; i < 3; i++) {
    state.eye[i] += (state.targetEye[i] - state.eye[i]) * 0.16;
  }

  if (state.source === 'face' || state.source === 'ar') {
    pollShapeDetectors(now, canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  if (state.backend === 'webgl') renderWebGL(now);
  else if (state.backend === '2d') render2DFallback(now);
  state.needsDraw = false;

  if (isContinuous()) {
    state.rafId = requestAnimationFrame(tick);
  }
}

// ---------------- Tracking Source Switching ----------------

function onDeviceOrientation(e) {
  if (state.source !== 'tilt' || e.beta == null || e.gamma == null) return;
  if (!state.tiltBase) state.tiltBase = { beta: e.beta, gamma: e.gamma };
  const dg = Math.max(-35, Math.min(35, e.gamma - state.tiltBase.gamma));
  const db = Math.max(-35, Math.min(35, e.beta - state.tiltBase.beta));
  state.targetEye[0] = (dg / 35) * 1.15;
  state.targetEye[1] = (-db / 35) * 0.85;
  scheduleDraw();
}

function setActiveSourceButton(src) {
  for (const b of sourceBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.source === src));
  }
  arSynthBtn.hidden = src !== 'ar';
  arSynthBtn.setAttribute('aria-pressed', String(state.arSynthetic));
}

async function switchSource(next) {
  window.removeEventListener('deviceorientation', onDeviceOrientation);
  state.tiltBase = null;
  if (next !== 'face' && next !== 'ar') stopCamera();

  state.source = next;
  setActiveSourceButton(next);

  if (next === 'pointer') {
    routeNote.textContent = 'Pointer / drag mode active. Drag empty space in the box to shift the virtual eye.';
    scheduleDraw();
    return;
  }

  if (next === 'sweep') {
    routeNote.textContent = 'Auto sweep active. Watch the foreground strip at z = +0.15 move against the deep plane at z = -0.85.';
    scheduleDraw();
    return;
  }

  if (next === 'tilt') {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          routeNote.textContent = 'Motion sensor permission was declined. Drag the box instead.';
          return;
        }
      }
      if (!('DeviceOrientationEvent' in window)) {
        routeNote.textContent = 'DeviceOrientationEvent is not available in this browser. Drag the box instead.';
        return;
      }
      window.addEventListener('deviceorientation', onDeviceOrientation);
      routeNote.textContent = 'Device tilt active. Tilt the phone to shift the off-axis frustum (tap Centre eye to re-zero).';
    } catch (err) {
      routeNote.textContent = `Could not start device tilt (${err.message}).`;
    }
    scheduleDraw();
    return;
  }

  if (next === 'face') {
    const hasFace = 'FaceDetector' in window;
    try {
      await openCamera('user');
      if (hasFace) {
        state.faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        routeNote.textContent = 'Camera face mode active via FaceDetector. Move your head side to side to steer the portal.';
      } else {
        state.faceDetector = null;
        routeNote.textContent =
          'Camera is open, but FaceDetector is not exposed in this browser (try chrome://flags/#enable-experimental-web-platform-features). Drag the canvas or tap Auto sweep to shift the eye.';
      }
    } catch (err) {
      routeNote.textContent = `Camera face mode could not open the camera (${err.message}).${hasFace ? '' : ' FaceDetector is also unavailable here.'}`;
    }
    scheduleDraw();
    return;
  }

  if (next === 'ar') {
    if (state.backend !== 'webgl') {
      routeNote.textContent = 'AR barcode homography needs WebGL 2 texElementSubImage2D().';
      return;
    }
    const hasBarcode = 'BarcodeDetector' in window;
    if (!hasBarcode) {
      state.arSynthetic = true;
      setActiveSourceButton('ar');
      routeNote.textContent =
        'BarcodeDetector is not exposed in this browser, so synthetic QR target mode is active. Tap the pinned green HTML card as the tilted QR board moves.';
      scheduleDraw();
      return;
    }
    try {
      state.arSynthetic = false;
      setActiveSourceButton('ar');
      await openCamera('environment');
      state.barcodeDetector = new BarcodeDetector();
      routeNote.textContent = 'AR barcode mode active via BarcodeDetector. Aim the camera at a QR code or barcode, or tap "Use synthetic QR target".';
    } catch (err) {
      state.arSynthetic = true;
      setActiveSourceButton('ar');
      routeNote.textContent = `Camera could not open (${err.message}), switched to synthetic QR target mode.`;
    }
    scheduleDraw();
  }
}

// ---------------- Event Wiring ----------------

function recordHit(label) {
  state.totalHits += 1;
  state.lastHit = label;
  scheduleDraw();
}

for (const btn of sourceBtns) {
  btn.addEventListener('click', () => switchSource(btn.dataset.source));
}

arSynthBtn.addEventListener('click', async () => {
  if (state.source !== 'ar') return;
  state.arSynthetic = !state.arSynthetic;
  setActiveSourceButton('ar');
  if (state.arSynthetic) {
    stopCamera();
    arFormatEl.textContent = 'synthetic qr';
    arValueEl.textContent = 'https://html-in-canvas.page/vision-portal/';
    routeNote.textContent = 'Synthetic QR target active. Click or type in the pinned HTML card while the 3D marker tilts.';
  } else {
    await switchSource('ar');
  }
  scheduleDraw();
});

recenterBtn.addEventListener('click', () => {
  state.targetEye = [...DEFAULT_EYE];
  state.tiltBase = null;
  scheduleDraw();
});

fgPingBtn.addEventListener('click', () => {
  state.pings += 1;
  fgPingsOut.textContent = String(state.pings);
  recordHit('z+0.15 ping');
});

fgTiltBtn.addEventListener('click', () => {
  state.tiltCards = !state.tiltCards;
  fgTiltBtn.setAttribute('aria-pressed', String(state.tiltCards));
  recordHit(state.tiltCards ? 'z+0.15 tilt on' : 'z+0.15 tilt off');
});

midLabelEl.addEventListener('input', () => {
  deepTitleEl.textContent = midLabelEl.value.trim() || 'Window A';
  recordHit('z-0.35 input');
});

midPaletteEl.addEventListener('change', () => {
  state.palette = midPaletteEl.value;
  recordHit(`z-0.35 ${state.palette}`);
});

midDepthEl.addEventListener('input', () => {
  state.depthGain = parseFloat(midDepthEl.value) || 1.0;
  midDepthVal.textContent = `${state.depthGain.toFixed(2)}x`;
  scheduleDraw();
});

midPulseBtn.addEventListener('click', () => {
  state.pulses += 1;
  state.pulseStart = performance.now() / 1000;
  midStatusEl.textContent = `${state.pulses} ${state.pulses === 1 ? 'pulse' : 'pulses'}`;
  recordHit('z-0.35 pulse');
});

deepResetBtn.addEventListener('click', () => {
  state.pings = 0;
  state.pulses = 0;
  state.totalHits = 0;
  state.lastHit = 'reset';
  fgPingsOut.textContent = '0';
  midStatusEl.textContent = '0 pulses';
  recordHit('z-0.85 reset');
});

arStampBtn.addEventListener('click', () => {
  state.arTaps += 1;
  arTapsOut.textContent = String(state.arTaps);
  scheduleDraw();
});

arNoteEl.addEventListener('input', () => scheduleDraw());

// Drag empty space in the canvas to shift the virtual eye (works by mouse and touch).
canvas.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || state.source === 'ar') return;
  if (state.source === 'sweep') {
    state.source = 'pointer';
    setActiveSourceButton('pointer');
  }
  state.dragging = true;
  state.dragId = e.pointerId;
  state.dragLastX = e.clientX;
  state.dragLastY = e.clientY;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
  const dx = (e.clientX - state.dragLastX) / cw;
  const dy = (e.clientY - state.dragLastY) / ch;
  state.dragLastX = e.clientX;
  state.dragLastY = e.clientY;
  state.targetEye[0] = Math.max(-1.45, Math.min(1.45, state.targetEye[0] + dx * 2.4));
  state.targetEye[1] = Math.max(-1.05, Math.min(1.05, state.targetEye[1] - dy * 1.9));
  scheduleDraw();
});

function endDrag(e) {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  state.dragging = false;
  state.dragId = null;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else {
    scheduleDraw();
  }
});

if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (state.onScreen) scheduleDraw();
  }, { rootMargin: '120px' });
  io.observe(canvas);
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    state.unitCache.key = '';
    scheduleDraw();
  });
  ro.observe(canvas);
}

// ---------------- Startup ----------------

function startDemo() {
  if (elGlSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: CARD_FRAG,
        attributes: { antialias: false, alpha: true, premultipliedAlpha: true, depth: false },
        onLost: () => {
          routeNote.textContent = 'WebGL 2 context lost. Waiting for restore; cards remain in DOM.';
          hud.textContent = 'context lost';
        },
        onRestored: () => {
          glAux = initAuxGL(stage.gl);
          for (const el of ALL_CARDS) state.dirtyEls.add(el);
          routeNote.textContent = 'WebGL 2 context restored.';
          canvas.requestPaint?.();
        },
      });
      glAux = initAuxGL(stage.gl);
      state.backend = 'webgl';
      routeNote.textContent =
        `Drawing with ElementGL (WebGL 2). FaceDetector: ${'FaceDetector' in window ? 'yes' : 'no'}, BarcodeDetector: ${'BarcodeDetector' in window ? 'yes' : 'no'}.`;

      canvas.addEventListener('paint', (e) => {
        if (!stage || stage.lost) return;
        const list = e.changedElements?.length ? e.changedElements : ALL_CARDS;
        for (const el of list) {
          if (ALL_CARDS.includes(el)) stage.upload(el);
        }
        // Ensure any card that has not uploaded yet gets its texture on first paint.
        for (const el of ALL_CARDS) {
          if (!stage.has(el)) stage.upload(el);
        }
        renderWebGL(performance.now());
      });
      canvas.requestPaint?.();
      return;
    } catch (err) {
      routeNote.textContent = `WebGL 2 failed to start (${err.message}); trying 2D fallback.`;
    }
  }

  if (api2dSupported) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNote.textContent = 'Drawing with 2D drawElementImage() fallback (WebGL 2 texElementSubImage2D() is unavailable).';
      canvas.addEventListener('paint', () => render2DFallback(performance.now()));
      canvas.requestPaint?.();
      return;
    }
  }

  switchToPlain('HTML-in-canvas is not available in this browser, so the four cards are shown as plain HTML below.');
}

startDemo();

// ---------------- Live Checks (Isolated Fixtures, Wait for Tap) ----------------

function makeFixtureCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = `display:block;width:${w}px;height:${h}px;position:relative`;
  testStage().append(cv);
  return cv;
}

runTests(document.getElementById('tests'), [
  {
    name: 'FaceDetector and BarcodeDetector availability',
    why: 'Checks whether Chrome exposes the Shape Detection API constructors in this browser and queries supported barcode formats.',
    run: async () => {
      const hasFace = 'FaceDetector' in window;
      const hasBarcode = 'BarcodeDetector' in window;
      let formats = '';
      if (hasBarcode && typeof BarcodeDetector.getSupportedFormats === 'function') {
        try {
          const list = await BarcodeDetector.getSupportedFormats();
          formats = ` (${list.slice(0, 6).join(', ')}${list.length > 6 ? ', ...' : ''})`;
        } catch {}
      }
      if (!hasFace && !hasBarcode) {
        throw new Error('FaceDetector: no, BarcodeDetector: no (enable chrome://flags/#enable-experimental-web-platform-features)');
      }
      return `FaceDetector: ${hasFace ? 'yes' : 'no'}, BarcodeDetector: ${hasBarcode ? 'yes' : 'no'}${formats}`;
    },
  },
  {
    name: 'Off-axis asymmetric frustum shifts depth planes at eyeX = -0.3 vs +0.3',
    why: 'Verifies that z = 0 stays pinned to the canvas border while z = -0.85 and z = +0.15 project to opposite sides between eyeX = -0.3 and +0.3.',
    run: async () => {
      const leftPose = buildOffAxisVP([-0.3, 0, 2.6], 1.6, 1.0);
      const rightPose = buildOffAxisVP([0.3, 0, 2.6], 1.6, 1.0);

      const projX = (vp, x, y, z) => {
        const c = mat4MulVec4(vp, x, y, z, 1);
        return c[0] / c[3];
      };
      // Glass corner at z = 0 must remain pinned at NDC +1.0 for both eye positions.
      const glassL = projX(leftPose.vp, 1.6, 0, 0);
      const glassR = projX(rightPose.vp, 1.6, 0, 0);
      if (Math.abs(glassL - 1) > 1e-5 || Math.abs(glassR - 1) > 1e-5) {
        throw new Error(`glass plane drifted: left=${glassL.toFixed(5)}, right=${glassR.toFixed(5)}`);
      }
      // Deep card (z = -0.85) shifts with the eye (+NDC); foreground card (z = +0.15) shifts opposite (-NDC).
      const deepL = projX(leftPose.vp, 0, 0, -0.85);
      const deepR = projX(rightPose.vp, 0, 0, -0.85);
      const fgL = projX(leftPose.vp, 0, 0, 0.15);
      const fgR = projX(rightPose.vp, 0, 0, 0.15);
      const deepShift = deepR - deepL;
      const fgShift = fgR - fgL;
      if (!(deepShift > 0.05 && fgShift < -0.01)) {
        throw new Error(`unexpected parallax shifts: deep=${deepShift.toFixed(4)}, fg=${fgShift.toFixed(4)}`);
      }
      return `z=0 pinned (err < 1e-5); deep shift +${deepShift.toFixed(3)} NDC, fg pop-out shift ${fgShift.toFixed(3)} NDC`;
    },
  },
  {
    name: 'updateElementGeometry() accepts an off-axis 4x4 perspective DOMMatrix',
    why: 'Builds a tilted off-axis 4x4 perspective matrix with non-zero projective terms (m14, m24) and passes it to canvas.updateElementGeometry() on a fixture canvas.',
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('canvas.updateElementGeometry() is not available');
      }
      const cv = makeFixtureCanvas(280, 180);
      const card = document.createElement('button');
      card.type = 'button';
      card.setAttribute('drawable', '');
      card.textContent = 'Layer';
      card.style.cssText = 'position:absolute;left:0;top:0;width:110px;height:60px;margin:0;border:0;background:#0284c7;color:#fff';
      cv.append(card);

      const c2 = cv.getContext('2d');
      await nextPaint(cv);
      c2.drawElementImage(card, 0, 0, 110, 60);

      const { halfW, halfH } = screenHalfExtents(280, 180);
      const { vp } = buildOffAxisVP([0.4, -0.2, 2.4], halfW, halfH);
      const frame = buildCardFrame(0, 0, -0.45, 1.3, 0.71, 0.12, 0.28);
      const mats = buildCardMatrices(frame, vp, 110, 60, 280, 180);
      if (!mats) throw new Error('buildCardMatrices returned null');
      const unit = geometryUnit(cv, card, 110);
      const transform = new DOMMatrix().scale(unit, unit, 1).multiply(mats.cssMatrix);
      cv.updateElementGeometry(card, { canvasTransform: transform });
      card.dataset.hitTick = '1';
      window.__gfx?.retire(cv);

      return `accepted 4x4 DOMMatrix (m14=${mats.cssMatrix.m14.toExponential(1)}, unit=${unit.toFixed(2)})`;
    },
  },
  {
    name: 'elementsFromPoint() tracks the depth-shifted card after moving the eye',
    why: 'Moves the virtual eye from x = -0.65 to +0.65 on an isolated fixture, updates updateElementGeometry() and toggles dataset.hitTick, then checks document.elementsFromPoint().',
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('canvas.updateElementGeometry() is not available');
      }
      const cv = makeFixtureCanvas(280, 180);
      const card = document.createElement('button');
      card.type = 'button';
      card.setAttribute('drawable', '');
      card.textContent = 'Deep';
      card.style.cssText = 'position:absolute;left:0;top:0;width:96px;height:54px;margin:0;border:0;background:#d2491f;color:#fff';
      cv.append(card);

      const c2 = cv.getContext('2d');
      await nextPaint(cv);
      c2.drawElementImage(card, 0, 0, 96, 54);

      const { halfW, halfH } = screenHalfExtents(280, 180);
      const frame = buildCardFrame(0, 0, -0.85, 0.96, 0.54, 0, 0);
      const unit = geometryUnit(cv, card, 96);
      const rect = cv.getBoundingClientRect();

      const applyAndSample = (eyeX, tickVal) => {
        const { vp } = buildOffAxisVP([eyeX, 0, 2.2], halfW, halfH);
        const mats = buildCardMatrices(frame, vp, 96, 54, 280, 180);
        const target = new DOMMatrix().scale(unit, unit, 1).multiply(mats.cssMatrix);
        cv.updateElementGeometry(card, { canvasTransform: target });
        card.dataset.hitTick = tickVal;
        const p = mats.cssMatrix.transformPoint(new DOMPoint(48, 27, 0, 1));
        return { cx: p.x / p.w, cy: p.y / p.w };
      };

      const p1 = applyAndSample(-0.65, '1');
      const hits1 = document.elementsFromPoint(rect.left + p1.cx, rect.top + p1.cy);
      if (!hits1.includes(card)) {
        window.__gfx?.retire(cv);
        throw new Error(`first pose (${p1.cx.toFixed(1)}, ${p1.cy.toFixed(1)}) missed card`);
      }

      const p2 = applyAndSample(0.65, '0');
      const hits2 = document.elementsFromPoint(rect.left + p2.cx, rect.top + p2.cy);
      window.__gfx?.retire(cv);
      if (Math.abs(p2.cx - p1.cx) < 10) {
        throw new Error(`expected horizontal shift > 10 px, got ${(p2.cx - p1.cx).toFixed(1)} px`);
      }
      if (!hits2.includes(card)) {
        throw new Error(`shifted pose (${p2.cx.toFixed(1)}, ${p2.cy.toFixed(1)}) missed card`);
      }
      return `hit card at x=${p1.cx.toFixed(1)} px, then after eye shift at x=${p2.cx.toFixed(1)} px (delta ${(p2.cx - p1.cx).toFixed(1)} px)`;
    },
  },
  {
    name: 'AR barcode 4-corner homography maps unit corners to a tilted quad',
    why: 'Fits quadHomographyUnitToCss() to an asymmetric trapezoid simulating a tilted QR code and checks corner projection error.',
    run: async () => {
      const quad = [[84, 46], [242, 68], [268, 206], [62, 184]];
      const h = quadHomographyUnitToCss(quad[0], quad[1], quad[2], quad[3]);
      if (!h) throw new Error('homography returned null');
      const unitPts = [[0, 0], [1, 0], [1, 1], [0, 1]];
      let maxErr = 0;
      for (let i = 0; i < 4; i++) {
        const c = mat4MulVec4(h, unitPts[i][0], unitPts[i][1], 0, 1);
        const px = c[0] / c[3], py = c[1] / c[3];
        maxErr = Math.max(maxErr, Math.hypot(px - quad[i][0], py - quad[i][1]));
      }
      if (maxErr > 1e-3) throw new Error(`max corner error ${maxErr.toFixed(4)} px`);
      return `4 tilted corners matched within ${maxErr.toExponential(1)} px (g=${h[3].toFixed(3)}, h=${h[7].toFixed(3)})`;
    },
  },
]);
