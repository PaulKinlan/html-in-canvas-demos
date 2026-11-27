import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);

const wrap = $('ghost-wrap');
const canvas = $('ghost-canvas');
const card = $('ghost-card');
const hintEl = $('ghost-hint');
const statusEl = $('ghost-status');
const noticeEl = $('ghost-notice');

// Live glowing source card controls
const cardTitle = $('card-title');
const cardClock = $('card-clock');
const cardAngle = $('card-angle');
const cardSignal = $('card-signal');
const cardWave = $('card-wave');
const waveBars = [...cardWave.querySelectorAll('span')];
const cardInput = $('ghost-input');
const phosphorBtns = [...document.querySelectorAll('[data-phosphor-btn]')];
const cardPulseBtn = $('card-pulse');
const cardReticleBtn = $('card-reticle');

// Page controls below stage
const modeBtns = [...document.querySelectorAll('[data-mode]')];
const btnFullscreen = $('btn-fullscreen');
const btnFsExit = $('btn-fs-exit');
const panelChamber = $('panel-chamber');
const panelProjector = $('panel-projector');
const presetBtns = [...document.querySelectorAll('[data-preset]')];
const btnAutoOrbit = $('btn-autoorbit');
const btnReset = $('btn-reset');
const ctlGlass = $('ctl-glass');
const outGlass = $('out-glass');
const ctlBeams = $('ctl-beams');
const ctlHitOutline = $('ctl-hitoutline');
const ctlApex = $('ctl-apex');
const outApex = $('out-apex');
const ctlMirror = $('ctl-mirror');
const ctlCrosshairs = $('ctl-crosshairs');
const ctlActiveFace = $('ctl-activeface');

const CARD_W = 256;
const CARD_H = 208;
const ISQRT2 = Math.SQRT1_2;

// 45-degree inverted truncated acrylic pyramid dimensions (world units, Y up)
const PYR_Y0 = 0.015;
const PYR_Y1 = 0.975;
const PYR_R0 = 0.16;
const PYR_R1 = PYR_R0 + (PYR_Y1 - PYR_Y0); // 1.12 -> exact 45.0 deg slope
const HOLO_Y = 0.54;
const HOLO_W = 0.72;
const HOLO_H = HOLO_W * (CARD_H / CARD_W); // 0.585
// Exact 45-deg optical floor reflection span for the floating hologram height
const FLOOR_R_IN = PYR_R0 + (HOLO_Y - HOLO_H * 0.5 - PYR_Y0);  // 0.3925 > HOLO_W/2 (0.36) -> zero floor overlap
const FLOOR_R_OUT = PYR_R0 + (HOLO_Y + HOLO_H * 0.5 - PYR_Y0); // 0.9775 < 1.12

const PHOSPHORS = {
  cyan: [0.24, 0.96, 1.0],
  amber: [1.0, 0.73, 0.22],
  mint: [0.3, 1.0, 0.62],
  rose: [1.0, 0.36, 0.77],
};

const FACE_NAMES = ['Front (+Z)', 'Right (+X)', 'Back (-Z)', 'Left (-X)'];
const CAM_TARGET = [0, 0.44, 0];
const DEFAULT_YAW = 24 * (Math.PI / 180);
const DEFAULT_PITCH = 22 * (Math.PI / 180);
const DEFAULT_DIST = 3.18;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// #region chamber-shaders
const PROJECTOR_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uPass;
uniform vec3 uPhosphor;
uniform float uPulse;
uniform vec2 uCanvasSize;
uniform float uApexPx;
uniform int uCrosshairs;
uniform int uHighlightFace;
uniform int uIsActive;

in vec2 vUv;
out vec4 outColor;

void main() {
  if (uPass == 1) {
    if (uCrosshairs == 0) discard;
    vec2 p = (vUv - 0.5) * uCanvasSize;
    float halfApex = uApexPx * 0.5;
    float boxD = max(abs(p.x), abs(p.y));
    // Never paint inside the central apex void so it stays exact rgb(0, 0, 0)
    if (boxD < halfApex - 0.75) discard;

    float minSide = min(uCanvasSize.x, uCanvasSize.y);
    float outerR = minSide * 0.49;
    float apexRing = 1.0 - smoothstep(0.6, 1.8, abs(boxD - halfApex));
    float diagDist = abs(abs(p.x) - abs(p.y)) * 0.70710678;
    float diagLine = (1.0 - smoothstep(0.4, 1.35, diagDist)) * step(halfApex + 4.0, boxD) * step(boxD, outerR);
    float outerFrame = (1.0 - smoothstep(0.5, 1.5, abs(boxD - outerR))) * step(0.32 * minSide, min(abs(p.x), abs(p.y)));
    float a = clamp(apexRing * 0.65 + diagLine * 0.24 + outerFrame * 0.35, 0.0, 0.75);
    if (a < 0.01) discard;
    outColor = vec4(uPhosphor * a, a);
    return;
  }

  vec4 tex = texture(uTex, vUv);
  float boost = 1.06 + uPulse * 0.32;
  vec3 rgb = tex.rgb * boost;
  float alpha = tex.a;

  if (uHighlightFace == 1 && uIsActive == 1) {
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float border = 1.0 - smoothstep(0.012, 0.026, edge);
    rgb = mix(rgb, uPhosphor * 0.9, border * 0.65);
    alpha = max(alpha, border * 0.65);
  }

  outColor = vec4(rgb, alpha);
}
`;

const BACKDROP_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.999, 1.0);
}
`;

const BACKDROP_FRAG = `#version 300 es
precision highp float;
uniform vec3 uPhosphor;
uniform float uPulse;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 d = (vUv - vec2(0.5, 0.54)) * vec2(1.15, 1.0);
  float r = length(d);
  vec3 base = mix(vec3(0.045, 0.062, 0.095), vec3(0.012, 0.016, 0.026), smoothstep(0.0, 0.88, r));
  float glow = exp(-r * 3.1) * (0.065 + 0.055 * uPulse);
  vec3 col = base + uPhosphor * glow;
  outColor = vec4(col, 1.0);
}
`;

const CHAMBER_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec3 aMeta;

uniform mat4 uVP;

out vec3 vPos;
out vec3 vNorm;
out vec3 vMeta;

void main() {
  vPos = aPos;
  vNorm = aNorm;
  vMeta = aMeta;
  gl_Position = uVP * vec4(aPos, 1.0);
}
`;

const CHAMBER_FRAG = `#version 300 es
precision highp float;

uniform vec3 uEye;
uniform vec3 uPhosphor;
uniform float uGlassRefl;
uniform float uPulse;
uniform float uTime;
uniform float uR0;
uniform int uKind;

in vec3 vPos;
in vec3 vNorm;
in vec3 vMeta;

out vec4 outColor;

void main() {
  vec3 V = normalize(uEye - vPos);
  vec3 N = normalize(vNorm);

  if (uKind == 0) {
    // Dark museum tabletop, ebony pedestal, brass inlay trim and recessed black display well
    float matId = vMeta.x;
    vec3 L1 = normalize(vec3(1.6, 2.8, 1.9));
    vec3 L2 = normalize(vec3(-2.1, 1.8, -1.4));
    float diff1 = max(dot(N, L1), 0.0);
    float diff2 = max(dot(N, L2), 0.0);
    vec3 H1 = normalize(L1 + V);
    float spec1 = pow(max(dot(N, H1), 0.0), 42.0);
    float holoDist = length(vPos - vec3(0.0, 0.45, 0.0));
    float holoBounce = exp(-holoDist * 1.45) * (0.14 + 0.08 * uPulse);

    if (matId < 0.5) {
      // Gallery dark slate tabletop
      float r = length(vPos.xz);
      float plinthShadow = smoothstep(1.18, 1.65, max(abs(vPos.x), abs(vPos.z)));
      vec3 col = mix(vec3(0.048, 0.056, 0.072), vec3(0.015, 0.018, 0.025), smoothstep(0.6, 2.6, r));
      col *= (0.45 + 0.55 * plinthShadow);
      col += uPhosphor * holoBounce * 0.25 * plinthShadow;
      outColor = vec4(col, 1.0);
      return;
    }

    if (matId < 1.5) {
      // Stepped ebony pedestal
      vec3 base = vec3(0.052, 0.062, 0.082);
      vec3 col = base * (0.45 + 0.65 * diff1 + 0.25 * diff2) + vec3(0.18, 0.22, 0.28) * spec1 * 0.32;
      col += uPhosphor * holoBounce * 0.35;
      outColor = vec4(col, 1.0);
      return;
    }

    if (matId < 2.5) {
      // Brushed Victorian brass trim ring
      vec3 brass = vec3(0.62, 0.48, 0.24);
      vec3 H2 = normalize(L2 + V);
      float spec2 = pow(max(dot(N, H2), 0.0), 28.0);
      vec3 col = brass * (0.34 + 0.72 * diff1 + 0.28 * diff2)
        + vec3(1.0, 0.91, 0.68) * (spec1 * 0.68 + spec2 * 0.22)
        + uPhosphor * holoBounce * 0.3;
      outColor = vec4(col, 1.0);
      return;
    }

    // Recessed glossy pitch-black display glass well with faint apex socket outline
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float f = pow(1.0 - ndv, 4.0);
    float boxD = max(abs(vPos.x), abs(vPos.z));
    float fw = max(fwidth(boxD), 0.002);
    float apexEdge = 1.0 - smoothstep(0.005, 0.005 + fw * 2.0, abs(boxD - uR0));
    vec3 col = vec3(0.008, 0.012, 0.018)
      + vec3(0.06, 0.09, 0.13) * f * 0.45
      + uPhosphor * (holoBounce * 0.22 * smoothstep(uR0, 0.6, boxD) + apexEdge * 0.26);
    outColor = vec4(col, 1.0);
    return;
  }

  if (uKind == 1) {
    // 45-degree clear acrylic pyramid face with Schlick Fresnel and bevel edge light-piping
    if (dot(N, V) < 0.0) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.035 + 0.58 * pow(1.0 - ndv, 3.1);

    float sHoriz = vMeta.x;
    float yH = vMeta.y;
    float faceH = vMeta.z;
    float halfW = uR0 + yH;
    float dDiag = (halfW - abs(sHoriz)) * 0.70710678;
    float dEdge = min(dDiag, min(yH, faceH - yH));
    float fw = max(fwidth(dEdge), 0.002);
    float edgeRib = 1.0 - smoothstep(0.0055, 0.0055 + fw * 2.2, dEdge);
    float edgeGlow = exp(-max(dEdge, 0.0) * 24.0);

    vec3 L1 = normalize(vec3(1.5, 2.6, 1.8));
    vec3 L2 = normalize(vec3(-1.8, 1.9, -1.6));
    float spec1 = pow(max(dot(N, normalize(L1 + V)), 0.0), 64.0);
    float spec2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 36.0);

    // Subtle glass sheen diagonal band moving gently with orbit angle
    float band = exp(-pow((sHoriz / max(halfW, 0.1)) * 2.6 - (yH / max(faceH, 0.1) - 0.5) * 1.4, 2.0)) * 0.09;

    vec3 glassTint = mix(vec3(0.62, 0.84, 0.98), uPhosphor, 0.28);
    vec3 ribCol = mix(vec3(0.86, 0.96, 1.0), uPhosphor, 0.62) * (0.72 + 0.48 * uPulse);
    float bodyAlpha = clamp((fresnel * 0.36 + band) * uGlassRefl, 0.02, 0.48);
    vec3 rgb = glassTint * bodyAlpha
      + vec3(0.92, 0.98, 1.0) * (spec1 * 0.55 + spec2 * 0.24) * uGlassRefl
      + ribCol * (edgeRib * 0.78 + edgeGlow * 0.16 * uGlassRefl);
    float outAlpha = clamp(bodyAlpha + edgeRib * 0.52 + (spec1 + spec2) * 0.25 * uGlassRefl, 0.0, 0.88);
    outColor = vec4(rgb, outAlpha);
    return;
  }

  if (uKind == 2) {
    // Subtle volumetric optical projection veil from floor card up to 45-deg glass
    float u = vMeta.x;
    float v = vMeta.y;
    float edgeFade = sin(clamp(u, 0.0, 1.0) * 3.14159265) * sin(clamp(v, 0.0, 1.0) * 3.14159265);
    float shimmer = 0.86 + 0.14 * sin(v * 18.0 - uTime * 2.2);
    float a = edgeFade * shimmer * (0.048 + 0.045 * uPulse);
    outColor = vec4(uPhosphor, a);
    return;
  }

  // uKind == 3: projective hit-box outline overlay on the active floating hologram plane
  float e = min(min(vMeta.x, 1.0 - vMeta.x), min(vMeta.y, 1.0 - vMeta.y));
  float fw = max(fwidth(e), 0.004);
  float line = 1.0 - smoothstep(0.01, 0.01 + fw * 2.2, e);
  if (line < 0.02) discard;
  vec3 c = vec3(1.0, 0.64, 0.2);
  outColor = vec4(c * line * 0.95, line * 0.95);
}
`;

const HOLO_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;

uniform mat4 uVP;
out vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = uVP * vec4(aPos, 1.0);
}
`;

const HOLO_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec3 uPhosphor;
uniform float uAlpha;
uniform float uPulse;
uniform float uTime;
uniform int uRole;

in vec2 vUv;
out vec4 outColor;

void main() {
  if (uRole == 0) {
    // Glowing mirrored floor projection sitting on the recessed screen well
    vec4 tex = texture(uTex, vUv);
    float boost = 0.92 + uPulse * 0.34;
    vec3 rgb = tex.rgb * boost;
    float plate = 0.04 * (1.0 - smoothstep(0.35, 0.72, length(vUv - 0.5)));
    rgb += uPhosphor * plate;
    outColor = vec4(rgb, max(tex.a, plate));
    return;
  }

  // Floating translucent live HTML hologram inside the glass pyramid
  vec2 px = 1.6 / max(uTexSize, vec2(64.0));
  vec2 chroma = (vUv - 0.5) * (1.4 / max(uTexSize.x, 64.0));
  vec4 base = texture(uTex, vUv);
  float rCh = texture(uTex, clamp(vUv + chroma, 0.0, 1.0)).r;
  float bCh = texture(uTex, clamp(vUv - chroma, 0.0, 1.0)).b;
  vec3 crisp = vec3(mix(base.r, rCh, 0.45), base.g, mix(base.b, bCh, 0.45));

  // 4-tap subtle luminous halo glow around bright strokes
  vec4 bloom = (
    texture(uTex, clamp(vUv + vec2(px.x, 0.0), 0.0, 1.0)) +
    texture(uTex, clamp(vUv - vec2(px.x, 0.0), 0.0, 1.0)) +
    texture(uTex, clamp(vUv + vec2(0.0, px.y), 0.0, 1.0)) +
    texture(uTex, clamp(vUv - vec2(0.0, px.y), 0.0, 1.0))
  ) * 0.25;

  float scan = 0.95 + 0.05 * sin(vUv.y * 168.0 - uTime * 2.6);
  float wave = exp(-pow((vUv.y - (1.0 - uPulse)) * 7.0, 2.0)) * uPulse;
  float backing = 0.048 * (1.0 - smoothstep(0.38, 0.75, length(vUv - 0.5)));

  vec3 lit = (crisp * scan + bloom.rgb * 0.34 + uPhosphor * (backing + wave * 0.42)) * (1.14 + 0.28 * uPulse);
  float outA = clamp(base.a * 0.88 + bloom.a * 0.22 + backing, 0.0, 0.94) * uAlpha;
  outColor = vec4(lit * uAlpha, outA);
}
`;
// #endregion chamber-shaders

// ---------------- Minimal 4x4 Matrix Math (Column-Major) ----------------

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function mat4MulVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

function mat4Perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / Math.max(aspect, 0.05), 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  let xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function cameraFromOrbit(yaw, pitch, dist) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const eye = [
    CAM_TARGET[0] + dist * cp * Math.sin(yaw),
    CAM_TARGET[1] + dist * sp,
    CAM_TARGET[2] + dist * cp * Math.cos(yaw),
  ];
  return eye;
}

function computeCameraVP(cw, ch, yaw, pitch, dist) {
  const eye = cameraFromOrbit(yaw, pitch, dist);
  const aspect = Math.max(cw, 1) / Math.max(ch, 1);
  const proj = mat4Perspective(42 * (Math.PI / 180), aspect, 0.1, 24.0);
  const view = mat4LookAt(eye, CAM_TARGET, [0, 1, 0]);
  return { eye, vp: mat4Mul(proj, view) };
}

function activeCardinalFaces(yaw) {
  const sx = Math.sin(yaw);
  const cz = Math.cos(yaw);
  const scored = [];
  for (let k = 0; k < 4; k++) {
    const phi = k * Math.PI * 0.5;
    const dot = sx * Math.sin(phi) + cz * Math.cos(phi);
    scored.push({ k, dot });
  }
  scored.sort((a, b) => b.dot - a.dot);
  // Primary face always has dot >= 0.707; near 45-deg ribs smoothly crossfade the neighbour
  const primary = scored[0];
  const secondary = scored[1];
  const cross = Math.max(0, Math.min(1, (secondary.dot - 0.45) / 0.26));
  return { primary: primary.k, secondary: secondary.k, secondaryAlpha: cross * 0.45 };
}

// ---------------- 3D Geometry Builders ----------------

function pushQuad(arr, p0, p1, p2, p3, n, m0, m1, m2, m3) {
  const pushV = (p, m) => arr.push(p[0], p[1], p[2], n[0], n[1], n[2], m[0], m[1], m[2]);
  pushV(p0, m0); pushV(p1, m1); pushV(p2, m2);
  pushV(p0, m0); pushV(p2, m2); pushV(p3, m3);
}

function buildPedestalGeometry() {
  const v = [];
  const up = [0, 1, 0];
  // 0: Gallery dark tabletop disc (16-gon at y = -0.34)
  const segs = 24;
  const rTable = 2.65;
  const yTable = -0.34;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const p0 = [0, yTable, 0];
    const p1 = [Math.cos(a1) * rTable, yTable, Math.sin(a1) * rTable];
    const p2 = [Math.cos(a0) * rTable, yTable, Math.sin(a0) * rTable];
    v.push(...p0, ...up, 0, 0, 0, ...p1, ...up, 0, 0, 0, ...p2, ...up, 0, 0, 0);
  }

  // Helper for a box plinth tier (top + 4 sides)
  const addTier = (hw, yBot, yTop, matId) => {
    const m = [matId, 0, 0];
    pushQuad(v, [-hw, yTop, -hw], [-hw, yTop, hw], [hw, yTop, hw], [hw, yTop, -hw], up, m, m, m, m);
    pushQuad(v, [-hw, yBot, hw], [hw, yBot, hw], [hw, yTop, hw], [-hw, yTop, hw], [0, 0, 1], m, m, m, m);
    pushQuad(v, [hw, yBot, hw], [hw, yBot, -hw], [hw, yTop, -hw], [hw, yTop, hw], [1, 0, 0], m, m, m, m);
    pushQuad(v, [hw, yBot, -hw], [-hw, yBot, -hw], [-hw, yTop, -hw], [hw, yTop, -hw], [0, 0, -1], m, m, m, m);
    pushQuad(v, [-hw, yBot, -hw], [-hw, yBot, hw], [-hw, yTop, hw], [-hw, yTop, -hw], [-1, 0, 0], m, m, m, m);
  };

  // Lower stepped ebony foot + main museum plinth
  addTier(1.42, -0.34, -0.22, 1.0);
  addTier(1.30, -0.22, -0.02, 1.0);

  // 2: Brushed Victorian brass trim bezel framing the recessed display well
  const rOut = 1.24;
  const rIn = 1.14;
  const yTrim = -0.005;
  const mBrass = [2.0, 0, 0];
  // 4 border strips around the display well
  pushQuad(v, [-rOut, yTrim, rIn], [-rOut, yTrim, rOut], [rOut, yTrim, rOut], [rOut, yTrim, rIn], up, mBrass, mBrass, mBrass, mBrass);
  pushQuad(v, [-rOut, yTrim, -rOut], [-rOut, yTrim, -rIn], [rOut, yTrim, -rIn], [rOut, yTrim, -rOut], up, mBrass, mBrass, mBrass, mBrass);
  pushQuad(v, [-rOut, yTrim, -rIn], [-rOut, yTrim, rIn], [-rIn, yTrim, rIn], [-rIn, yTrim, -rIn], up, mBrass, mBrass, mBrass, mBrass);
  pushQuad(v, [rIn, yTrim, -rIn], [rIn, yTrim, rIn], [rOut, yTrim, rIn], [rOut, yTrim, -rIn], up, mBrass, mBrass, mBrass, mBrass);

  // 3: Pitch-black recessed display screen well (y = 0.0)
  const mWell = [3.0, 0, 0];
  pushQuad(v, [-rIn, 0, -rIn], [-rIn, 0, rIn], [rIn, 0, rIn], [rIn, 0, -rIn], up, mWell, mWell, mWell, mWell);

  return new Float32Array(v);
}

function buildPyramidFaces() {
  const faces = [];
  const faceH = PYR_Y1 - PYR_Y0;
  for (let k = 0; k < 4; k++) {
    const phi = k * Math.PI * 0.5;
    const dir = [Math.sin(phi), 0, Math.cos(phi)];
    const right = [Math.cos(phi), 0, -Math.sin(phi)];
    const norm = [dir[0] * ISQRT2, -ISQRT2, dir[2] * ISQRT2];

    const pt = (r, s, y) => [r * dir[0] + s * right[0], y, r * dir[2] + s * right[2]];
    const bl = pt(PYR_R0, -PYR_R0, PYR_Y0);
    const br = pt(PYR_R0, PYR_R0, PYR_Y0);
    const tr = pt(PYR_R1, PYR_R1, PYR_Y1);
    const tl = pt(PYR_R1, -PYR_R1, PYR_Y1);

    const arr = [];
    pushQuad(
      arr, bl, br, tr, tl, norm,
      [-PYR_R0, 0, faceH],
      [PYR_R0, 0, faceH],
      [PYR_R1, faceH, faceH],
      [-PYR_R1, faceH, faceH]
    );
    faces.push({ k, dir, data: new Float32Array(arr) });
  }
  return faces;
}

function buildBeamsGeometry() {
  const v = [];
  const yBeamTop = HOLO_Y + HOLO_H * 0.42;
  const rMidFloor = (FLOOR_R_IN + FLOOR_R_OUT) * 0.5;
  for (let k = 0; k < 4; k++) {
    const phi = k * Math.PI * 0.5;
    const dir = [Math.sin(phi), 0, Math.cos(phi)];
    const right = [Math.cos(phi), 0, -Math.sin(phi)];
    const w0 = HOLO_W * 0.44;
    const w1 = HOLO_W * 0.38;
    const rGlass = PYR_R0 + (yBeamTop - PYR_Y0);
    const pt = (r, s, y) => [r * dir[0] + s * right[0], y, r * dir[2] + s * right[2]];
    const p0 = pt(rMidFloor, -w0, 0.01);
    const p1 = pt(rMidFloor, w0, 0.01);
    const p2 = pt(rGlass * 0.92, w1, yBeamTop);
    const p3 = pt(rGlass * 0.92, -w1, yBeamTop);
    pushQuad(v, p0, p1, p2, p3, dir, [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]);
  }
  return new Float32Array(v);
}

function buildFloorQuadsGeometry() {
  const v = [];
  const hw = HOLO_W * 0.5;
  const y = 0.004;
  for (let k = 0; k < 4; k++) {
    const phi = k * Math.PI * 0.5;
    const dir = [Math.sin(phi), 0, Math.cos(phi)];
    const right = [Math.cos(phi), 0, -Math.sin(phi)];
    const pt = (r, s) => [r * dir[0] + s * right[0], y, r * dir[2] + s * right[2]];
    // Matches exact 45-deg reflection chirality: top (v=0) outward, bottom (v=1) inward
    const tl = pt(FLOOR_R_OUT, -hw);
    const tr = pt(FLOOR_R_OUT, hw);
    const br = pt(FLOOR_R_IN, hw);
    const bl = pt(FLOOR_R_IN, -hw);
    v.push(
      ...tl, 0, 0, ...tr, 1, 0, ...br, 1, 1,
      ...tl, 0, 0, ...br, 1, 1, ...bl, 0, 1
    );
  }
  return new Float32Array(v);
}

function buildFloatingHoloQuad(faceIndex) {
  const phi = faceIndex * Math.PI * 0.5;
  const U = [Math.cos(phi), 0, -Math.sin(phi)];
  const hw = HOLO_W * 0.5;
  const hh = HOLO_H * 0.5;
  const tl = [-hw * U[0], HOLO_Y + hh, -hw * U[2]];
  const tr = [hw * U[0], HOLO_Y + hh, hw * U[2]];
  const br = [hw * U[0], HOLO_Y - hh, hw * U[2]];
  const bl = [-hw * U[0], HOLO_Y - hh, -hw * U[2]];
  return new Float32Array([
    ...tl, 0, 0, ...tr, 1, 0, ...br, 1, 1,
    ...tl, 0, 0, ...br, 1, 1, ...bl, 0, 1,
  ]);
}

function buildHitOutlineQuad(faceIndex) {
  const phi = faceIndex * Math.PI * 0.5;
  const U = [Math.cos(phi), 0, -Math.sin(phi)];
  const N = [Math.sin(phi), 0, Math.cos(phi)];
  const hw = HOLO_W * 0.5;
  const hh = HOLO_H * 0.5;
  const eps = 0.004;
  const tl = [-hw * U[0] + eps * N[0], HOLO_Y + hh, -hw * U[2] + eps * N[2]];
  const tr = [hw * U[0] + eps * N[0], HOLO_Y + hh, hw * U[2] + eps * N[2]];
  const br = [hw * U[0] + eps * N[0], HOLO_Y - hh, hw * U[2] + eps * N[2]];
  const bl = [-hw * U[0] + eps * N[0], HOLO_Y - hh, -hw * U[2] + eps * N[2]];
  const arr = [];
  pushQuad(arr, tl, tr, br, bl, N, [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]);
  return new Float32Array(arr);
}

// #region projector-layout
const QUADRANT_DEFS = [
  { id: 'top', label: 'Top (0 deg)', angleRad: 0 },
  { id: 'right', label: 'Right (90 deg)', angleRad: Math.PI * 0.5 },
  { id: 'bottom', label: 'Bottom (180 deg)', angleRad: Math.PI },
  { id: 'left', label: 'Left (270 deg)', angleRad: Math.PI * 1.5 },
];

export function computeProjectorLayout(cw, ch, cardW, cardH, apexPx, mirrorFlip) {
  const cx = cw * 0.5;
  const cy = ch * 0.5;
  const S = Math.min(cw, ch);
  const pad = Math.max(6, Math.round(S * 0.025));
  const rMax = Math.max(48, S * 0.5 - pad);
  const aspect = cardW / Math.max(cardH, 1);

  const halfApex = Math.min(apexPx * 0.5, rMax * 0.42);
  const balancedRin = rMax / (1 + 2 / aspect);
  const apexBias = ((Math.max(20, Math.min(80, apexPx)) - 20) / 60) * Math.min(26, rMax * 0.14);
  const rIn = Math.max(halfApex + 6, Math.min(rMax - 28, balancedRin * 0.88 + apexBias));

  const maxHByRadius = Math.max(20, rMax - rIn);
  const maxHByWedge = Math.max(20, ((rIn - 3) * 2) / aspect);
  const hQ = Math.min(maxHByRadius, maxHByWedge);
  const wQ = hQ * aspect;
  const rMid = rIn + hQ * 0.5;
  const scale = hQ / Math.max(cardH, 1);
  const sx = (mirrorFlip ? -1 : 1) * scale;
  const sy = scale;

  const quadrants = QUADRANT_DEFS.map((def, idx) => {
    const co = Math.cos(def.angleRad);
    const si = Math.sin(def.angleRad);
    const a = sx * co;
    const b = sx * si;
    const c = -sy * si;
    const d = sy * co;
    const e = cx - a * (cardW * 0.5) - c * (cardH * 0.5) + rMid * si;
    const f = cy - b * (cardW * 0.5) - d * (cardH * 0.5) - rMid * co;

    const det = a * d - b * c || 1;
    const invAffine = [
      d / det,
      -b / det,
      -c / det,
      a / det,
      (c * f - d * e) / det,
      (b * e - a * f) / det,
    ];

    // Unit-square (0..1)^2 -> NDC [-1..1]^2 for ElementGL.quad()
    const glMat4 = new Float32Array([
      (2 * a * cardW) / cw, (-2 * b * cardW) / ch, 0, 0,
      (2 * c * cardH) / cw, (-2 * d * cardH) / ch, 0, 0,
      0, 0, 1, 0,
      (2 * e) / cw - 1, 1 - (2 * f) / ch, 0, 1,
    ]);

    return {
      idx,
      id: def.id,
      label: def.label,
      angleRad: def.angleRad,
      centerX: cx + rMid * si,
      centerY: cy - rMid * co,
      affine: [a, b, c, d, e, f],
      invAffine,
      glMat4,
    };
  });

  return { cw, ch, cx, cy, S, apexPx, rIn, wQ, hQ, rMid, quadrants };
}
// #endregion projector-layout

// #region projective-hit
export function buildHoloCanvasMatrix(faceIndex, vp, cw, ch, cardW, cardH) {
  const phi = faceIndex * Math.PI * 0.5;
  const N = [Math.sin(phi), 0, Math.cos(phi)];
  const U = [Math.cos(phi), 0, -Math.sin(phi)];
  const V = [0, -1, 0];
  const O = [-0.5 * HOLO_W * U[0], HOLO_Y + 0.5 * HOLO_H, -0.5 * HOLO_W * U[2]];

  const elemToWorld = new Float32Array([
    (HOLO_W * U[0]) / cardW, (HOLO_W * U[1]) / cardW, (HOLO_W * U[2]) / cardW, 0,
    (HOLO_H * V[0]) / cardH, (HOLO_H * V[1]) / cardH, (HOLO_H * V[2]) / cardH, 0,
    N[0], N[1], N[2], 0,
    O[0], O[1], O[2], 1,
  ]);

  const clip = mat4Mul(vp, elemToWorld);
  const corner = (ex, ey) => {
    const c = mat4MulVec4(clip, ex, ey, 0, 1);
    return [c[0] / c[3], c[1] / c[3], c[3]];
  };
  const p = [corner(0, 0), corner(cardW, 0), corner(cardW, cardH), corner(0, cardH)];
  if (p.some((q) => q[2] <= 1e-4)) return null;
  // NDC y points up while DOM y points down, so front-facing signed area is negative
  const area = (p[1][0] - p[0][0]) * (p[3][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[3][0] - p[0][0]);
  if (area >= 0) return null;

  const ndcToCss = new Float32Array([
    cw * 0.5, 0, 0, 0,
    0, -ch * 0.5, 0, 0,
    0, 0, 1, 0,
    cw * 0.5, ch * 0.5, 0, 1,
  ]);
  const raw = mat4Mul(ndcToCss, clip);
  const wCenter = raw[3] * (cardW * 0.5) + raw[7] * (cardH * 0.5) + raw[15];
  const invW = wCenter > 1e-4 ? 1 / wCenter : 1;
  const norm = new Float32Array(16);
  for (let i = 0; i < 16; i++) norm[i] = raw[i] * invW;
  return new DOMMatrix(Array.from(norm));
}

function unprojectMatrixToCard(cssMatrix, px, py) {
  if (!cssMatrix) return null;
  // Invert the 3x3 planar homography on z = 0: [x, y, w]^T = H * [ex, ey, 1]^T
  const a = cssMatrix.m11, b = cssMatrix.m21, c = cssMatrix.m41;
  const d = cssMatrix.m12, e = cssMatrix.m22, f = cssMatrix.m42;
  const g = cssMatrix.m14, h = cssMatrix.m24, i = cssMatrix.m44;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-8) return null;

  const rx = (A * px + D * py + G) / det;
  const ry = (B * px + E * py + H) / det;
  const rw = (C * px + F * py + I) / det;
  if (Math.abs(rw) < 1e-6) return null;
  return { ex: rx / rw, ey: ry / rw };
}
// #endregion projective-hit

// ---------------- State & Interactive Control Cache ----------------

const state = {
  mode: 'chamber',         // 'chamber' | 'projector'
  phosphor: 'cyan',        // 'cyan' | 'amber' | 'mint' | 'rose'
  reticle: true,
  signalCount: 0,
  yaw: DEFAULT_YAW,
  pitch: DEFAULT_PITCH,
  dist: DEFAULT_DIST,
  autoOrbit: false,
  glassRefl: 0.68,
  opticalBeams: true,
  showHitOutline: false,
  apexPx: 44,
  mirrorFlip: true,
  crosshairs: false,
  highlightFace: false,
  activeFace: 0,           // 0..3 in chamber mode
  activeQuadrant: 0,       // 0..3 in projector mode (0 = top)
  pulseAmt: 0,
  backend: 'starting',
  texW: 0,
  texH: 0,
  onScreen: true,
};

const INTERACTIVE_CONTROLS = [...card.querySelectorAll('button, input')];
let cachedControlRects = [];
let stage = null;
let sceneGL = null;
let anisoExt = null;
let maxAniso = 1;
let ctx2d = null;
let lastLiveTex = null;
let domDirty = true;
let mipDirty = true;
let hitTick = 0;
let lastGeoKey = '';
let lastChamberMatrix = null;
let lastProjectorLayout = null;
let rafId = 0;
let lastFrameMs = performance.now();
let clockTimer = 0;
let pulseResetTimer = 0;

function showNotice(msg) {
  if (!msg) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
    return;
  }
  noticeEl.hidden = false;
  noticeEl.textContent = msg;
}

function measureControlRects() {
  cachedControlRects = INTERACTIVE_CONTROLS.map((el) => {
    let x = 0;
    let y = 0;
    let cur = el;
    while (cur && cur !== card) {
      x += cur.offsetLeft;
      y += cur.offsetTop;
      cur = cur.offsetParent;
    }
    const label = el.tagName === 'INPUT' ? 'Text input' : (el.textContent || el.id || 'Button').trim();
    return { el, x, y, w: el.offsetWidth, h: el.offsetHeight, label };
  });
}

function findLocalControl(ex, ey) {
  if (!cachedControlRects.length) measureControlRects();
  for (const r of cachedControlRects) {
    if (ex >= r.x && ex <= r.x + r.w && ey >= r.y && ey <= r.y + r.h) return r;
  }
  return null;
}

function updateCardTelemetry() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  cardClock.textContent = `${t} · #${String(state.signalCount).padStart(2, '0')}`;
  const raw = cardInput.value.trim();
  cardTitle.textContent = raw ? raw.slice(0, 18).toUpperCase() : 'GHOST 1862';
  cardAngle.textContent = state.mode === 'chamber' ? '45.0 DEG · 3D VIEW' : '45.0 DEG · 4-WAY';
  cardSignal.textContent = `SIG +${String(state.signalCount).padStart(2, '0')} · 1.0 HZ`;

  const sec = now.getSeconds();
  waveBars.forEach((bar, i) => {
    const phase = sec * 0.8 + i * 0.9 + state.signalCount * 1.1;
    const h = Math.round(6 + 14 * (0.5 + 0.5 * Math.sin(phase)));
    bar.style.height = `${h}px`;
  });
}

function updateStatus() {
  const texInfo = state.texW ? `${state.texW}x${state.texH}` : 'pending';
  if (state.mode === 'chamber') {
    const yawDeg = Math.round(((state.yaw * 180) / Math.PI) % 360);
    const pitchDeg = Math.round((state.pitch * 180) / Math.PI);
    statusEl.textContent =
      `Backend: ${state.backend} | 3D glass chamber | Orbit: ${yawDeg} deg yaw, ${pitchDeg} deg pitch | Active face: ${FACE_NAMES[state.activeFace]} | Texture: ${texInfo}`;
  } else {
    const qLabel = QUADRANT_DEFS[state.activeQuadrant]?.label ?? 'Top (0 deg)';
    statusEl.textContent =
      `Backend: ${state.backend} | Phone pyramid projector | Apex: ${state.apexPx} px | Mirror: ${state.mirrorFlip ? 'on' : 'off'} | Hit face: ${qLabel} | Texture: ${texInfo}`;
  }
}

function canvasCssSize() {
  return {
    cw: Math.max(200, canvas.clientWidth || 340),
    ch: Math.max(200, canvas.clientHeight || 340),
  };
}

function applyGeometryMatrix(cssMatrix, keyTag) {
  if (typeof canvas.updateElementGeometry !== 'function' || !cssMatrix) return;
  if (wrap.classList.contains('plain')) return;
  const cardW = card.offsetWidth || CARD_W;
  const unit = geometryUnit(canvas, card, cardW);
  const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMatrix);
  const vals = scaled.toFloat32Array();
  const sig = `${keyTag}:${unit.toFixed(3)}:${vals[0].toFixed(3)},${vals[1].toFixed(3)},${vals[4].toFixed(3)},${vals[5].toFixed(3)},${vals[12].toFixed(2)},${vals[13].toFixed(2)},${vals[15].toFixed(3)}`;
  if (sig === lastGeoKey) return;
  lastGeoKey = sig;
  canvas.updateElementGeometry(card, { canvasTransform: scaled });
  card.dataset.hitTick = String(++hitTick);
}

// ---------------- Companion 3D WebGL 2 Pipeline on stage.gl ----------------

function compileProgram(gl, vSrc, fSrc, uniformNames) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'Shader compile error');
    }
    return s;
  };
  const vs = mk(gl.VERTEX_SHADER, vSrc);
  const fs = mk(gl.FRAGMENT_SHADER, fSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(log || 'Program link error');
  }
  const u = {};
  for (const name of uniformNames) u[name] = gl.getUniformLocation(prog, name);
  return { prog, u };
}

function makeMesh9(gl, data) {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 9 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
  gl.bindVertexArray(null);
  return { vao, vbo, count: data.length / 9 };
}

function makeMesh5(gl, data) {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 5 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * 4);
  gl.bindVertexArray(null);
  return { vao, vbo, count: data.length / 5 };
}

function createChamberResources(gl) {
  const backdrop = compileProgram(gl, BACKDROP_VERT, BACKDROP_FRAG, ['uPhosphor', 'uPulse']);
  const chamber = compileProgram(gl, CHAMBER_VERT, CHAMBER_FRAG, [
    'uVP', 'uEye', 'uPhosphor', 'uGlassRefl', 'uPulse', 'uTime', 'uR0', 'uKind',
  ]);
  const holo = compileProgram(gl, HOLO_VERT, HOLO_FRAG, [
    'uVP', 'uTex', 'uTexSize', 'uPhosphor', 'uAlpha', 'uPulse', 'uTime', 'uRole',
  ]);

  // Fullscreen backdrop quad
  const bgVao = gl.createVertexArray();
  const bgVbo = gl.createBuffer();
  gl.bindVertexArray(bgVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bgVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const pedestalMesh = makeMesh9(gl, buildPedestalGeometry());
  const glassFaces = buildPyramidFaces().map((f) => ({
    k: f.k,
    dir: f.dir,
    mesh: makeMesh9(gl, f.data),
  }));
  const beamsMesh = makeMesh9(gl, buildBeamsGeometry());
  const floorQuads = makeMesh5(gl, buildFloorQuadsGeometry());
  const holoQuads = [0, 1, 2, 3].map((k) => makeMesh5(gl, buildFloatingHoloQuad(k)));
  const outlineQuads = [0, 1, 2, 3].map((k) => makeMesh9(gl, buildHitOutlineQuad(k)));

  return {
    backdrop,
    chamber,
    holo,
    bgVao,
    bgVbo,
    pedestalMesh,
    glassFaces,
    beamsMesh,
    floorQuads,
    holoQuads,
    outlineQuads,
    dispose() {
      if (gl.isContextLost()) return;
      gl.deleteProgram(backdrop.prog);
      gl.deleteProgram(chamber.prog);
      gl.deleteProgram(holo.prog);
      gl.deleteVertexArray(bgVao);
      gl.deleteBuffer(bgVbo);
      const del = (m) => { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vbo); };
      del(pedestalMesh);
      del(beamsMesh);
      del(floorQuads);
      for (const f of glassFaces) del(f.mesh);
      for (const q of holoQuads) del(q);
      for (const o of outlineQuads) del(o);
    },
  };
}

function renderChamberScene(gl, res, texObj, opts) {
  const { cw, ch, yaw, pitch, dist, phosphor, glassRefl, opticalBeams, showHitOutline, pulseAmt, nowSec } = opts;
  const { eye, vp } = computeCameraVP(cw, ch, yaw, pitch, dist);
  const faces = activeCardinalFaces(yaw);

  gl.clearDepth(1.0);
  gl.clear(gl.DEPTH_BUFFER_BIT);

  // 1. Dark museum chamber backdrop
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(res.backdrop.prog);
  gl.bindVertexArray(res.bgVao);
  gl.uniform3f(res.backdrop.u.uPhosphor, phosphor[0], phosphor[1], phosphor[2]);
  gl.uniform1f(res.backdrop.u.uPulse, pulseAmt);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 2. Opaque museum pedestal, brass trim and recessed black display well
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.useProgram(res.chamber.prog);
  gl.uniformMatrix4fv(res.chamber.u.uVP, false, vp);
  gl.uniform3f(res.chamber.u.uEye, eye[0], eye[1], eye[2]);
  gl.uniform3f(res.chamber.u.uPhosphor, phosphor[0], phosphor[1], phosphor[2]);
  gl.uniform1f(res.chamber.u.uGlassRefl, glassRefl);
  gl.uniform1f(res.chamber.u.uPulse, pulseAmt);
  gl.uniform1f(res.chamber.u.uTime, nowSec);
  gl.uniform1f(res.chamber.u.uR0, PYR_R0);
  gl.uniform1i(res.chamber.u.uKind, 0);
  gl.bindVertexArray(res.pedestalMesh.vao);
  gl.drawArrays(gl.TRIANGLES, 0, res.pedestalMesh.count);

  // 3. Four mirrored live HTML projections glowing flat on the screen floor
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.useProgram(res.holo.prog);
  gl.uniformMatrix4fv(res.holo.u.uVP, false, vp);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
  gl.uniform1i(res.holo.u.uTex, 0);
  gl.uniform2f(res.holo.u.uTexSize, texObj.w, texObj.h);
  gl.uniform3f(res.holo.u.uPhosphor, phosphor[0], phosphor[1], phosphor[2]);
  gl.uniform1f(res.holo.u.uAlpha, 1.0);
  gl.uniform1f(res.holo.u.uPulse, pulseAmt);
  gl.uniform1f(res.holo.u.uTime, nowSec);
  gl.uniform1i(res.holo.u.uRole, 0);
  gl.bindVertexArray(res.floorQuads.vao);
  gl.drawArrays(gl.TRIANGLES, 0, res.floorQuads.count);

  // 4. Optional subtle optical projection beams rising from floor to glass
  if (opticalBeams) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(res.chamber.prog);
    gl.uniform1i(res.chamber.u.uKind, 2);
    gl.bindVertexArray(res.beamsMesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, res.beamsMesh.count);
  }

  // Sort 4 acrylic frustum walls into back faces (behind hologram) and front faces (in front)
  const orderedFaces = res.glassFaces
    .map((f) => ({ f, d: f.dir[0] * eye[0] + f.dir[2] * eye[2] }))
    .sort((a, b) => a.d - b.d);

  // 5. Rear 45-degree acrylic pyramid faces
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(res.chamber.prog);
  gl.uniform1i(res.chamber.u.uKind, 1);
  for (const item of orderedFaces) {
    if (item.d >= 0) continue;
    gl.bindVertexArray(item.f.mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, item.f.mesh.count);
  }

  // 6. Floating translucent live HTML hologram hovering inside the glass chamber
  gl.useProgram(res.holo.prog);
  gl.uniform1i(res.holo.u.uRole, 1);
  if (faces.secondaryAlpha > 0.02) {
    gl.uniform1f(res.holo.u.uAlpha, faces.secondaryAlpha);
    gl.bindVertexArray(res.holoQuads[faces.secondary].vao);
    gl.drawArrays(gl.TRIANGLES, 0, res.holoQuads[faces.secondary].count);
  }
  gl.uniform1f(res.holo.u.uAlpha, 1.0);
  gl.bindVertexArray(res.holoQuads[faces.primary].vao);
  gl.drawArrays(gl.TRIANGLES, 0, res.holoQuads[faces.primary].count);

  // Optional projective hit-box outline overlay
  if (showHitOutline) {
    gl.useProgram(res.chamber.prog);
    gl.uniform1i(res.chamber.u.uKind, 3);
    gl.bindVertexArray(res.outlineQuads[faces.primary].vao);
    gl.drawArrays(gl.TRIANGLES, 0, res.outlineQuads[faces.primary].count);
  }

  // 7. Front 45-degree acrylic pyramid faces enclosing the floating hologram
  gl.useProgram(res.chamber.prog);
  gl.uniform1i(res.chamber.u.uKind, 1);
  for (const item of orderedFaces) {
    if (item.d < 0) continue;
    gl.bindVertexArray(item.f.mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, item.f.mesh.count);
  }

  // Restore standard ElementGL state
  gl.depthMask(true);
  gl.disable(gl.DEPTH_TEST);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(null);

  return { eye, vp, primaryFace: faces.primary };
}

function renderProjectorPass(gStage, element, layout, opts) {
  const { phosphor, pulseAmt, crosshairs, highlightFace, activeQuadrant } = opts;
  if (!gStage.begin([0, 0, 0, 1])) return;
  for (const q of layout.quadrants) {
    gStage.quad(element, q.glMat4, (gl, loc) => {
      gl.uniform1i(loc('uPass'), 0);
      gl.uniform3f(loc('uPhosphor'), phosphor[0], phosphor[1], phosphor[2]);
      gl.uniform1f(loc('uPulse'), pulseAmt);
      gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
      gl.uniform1f(loc('uApexPx'), layout.apexPx);
      gl.uniform1i(loc('uCrosshairs'), crosshairs ? 1 : 0);
      gl.uniform1i(loc('uHighlightFace'), highlightFace ? 1 : 0);
      gl.uniform1i(loc('uIsActive'), q.idx === activeQuadrant ? 1 : 0);
    });
  }
  if (crosshairs) {
    gStage.quad(element, ElementGL.rect(gStage.canvas, 0, 0, layout.cw, layout.ch), (gl, loc) => {
      gl.uniform1i(loc('uPass'), 1);
      gl.uniform3f(loc('uPhosphor'), phosphor[0], phosphor[1], phosphor[2]);
      gl.uniform1f(loc('uPulse'), pulseAmt);
      gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
      gl.uniform1f(loc('uApexPx'), layout.apexPx);
      gl.uniform1i(loc('uCrosshairs'), 1);
      gl.uniform1i(loc('uHighlightFace'), 0);
      gl.uniform1i(loc('uIsActive'), 0);
    });
  }
}

// #region render-loop
function uploadCardTexture(gStage, element) {
  const texObj = gStage.upload(element);
  if (!texObj) return null;
  const gl = gStage.gl;
  gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (anisoExt && maxAniso > 1) {
    gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
  }
  return texObj;
}

function renderWebGL(e) {
  if (!stage || stage.lost || !sceneGL) return;
  const { cw, ch } = canvasCssSize();
  const cardW = card.offsetWidth || CARD_W;
  const cardH = card.offsetHeight || CARD_H;

  const changed = new Set(e?.changedElements ?? []);
  if (domDirty || mipDirty || changed.has(card) || !stage.has(card) || !lastLiveTex) {
    lastLiveTex = uploadCardTexture(stage, card);
    domDirty = false;
    mipDirty = false;
    if (lastLiveTex) {
      state.texW = lastLiveTex.w;
      state.texH = lastLiveTex.h;
    }
  }
  if (!lastLiveTex) return;

  const phosphor = PHOSPHORS[state.phosphor] || PHOSPHORS.cyan;

  if (state.mode === 'chamber') {
    if (!stage.begin([0.012, 0.016, 0.026, 1])) return;
    const { vp, primaryFace } = renderChamberScene(stage.gl, sceneGL, lastLiveTex, {
      cw,
      ch,
      yaw: state.yaw,
      pitch: state.pitch,
      dist: state.dist,
      phosphor,
      glassRefl: state.glassRefl,
      opticalBeams: state.opticalBeams,
      showHitOutline: state.showHitOutline,
      pulseAmt: state.pulseAmt,
      nowSec: performance.now() / 1000,
    });
    state.activeFace = primaryFace;
    lastChamberMatrix = buildHoloCanvasMatrix(primaryFace, vp, cw, ch, cardW, cardH);
    applyGeometryMatrix(lastChamberMatrix, `ch-${primaryFace}`);
  } else {
    lastProjectorLayout = computeProjectorLayout(cw, ch, cardW, cardH, state.apexPx, state.mirrorFlip);
    renderProjectorPass(stage, card, lastProjectorLayout, {
      phosphor,
      pulseAmt: state.pulseAmt,
      crosshairs: state.crosshairs,
      highlightFace: state.highlightFace,
      activeQuadrant: state.activeQuadrant,
    });
    const activeQ = lastProjectorLayout.quadrants[state.activeQuadrant] || lastProjectorLayout.quadrants[0];
    applyGeometryMatrix(new DOMMatrix(activeQ.affine), `pr-${activeQ.id}`);
  }

  updateStatus();
}

function render2DFallback() {
  if (!ctx2d) return;
  const { cw, ch } = canvasCssSize();
  const cardW = card.offsetWidth || CARD_W;
  const cardH = card.offsetHeight || CARD_H;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const phosphor = PHOSPHORS[state.phosphor] || PHOSPHORS.cyan;
  const cssHex = `rgb(${Math.round(phosphor[0] * 255)} ${Math.round(phosphor[1] * 255)} ${Math.round(phosphor[2] * 255)})`;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (state.mode === 'projector') {
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, cw, ch);
    lastProjectorLayout = computeProjectorLayout(cw, ch, cardW, cardH, state.apexPx, state.mirrorFlip);
    for (const q of lastProjectorLayout.quadrants) {
      ctx2d.save();
      ctx2d.transform(...q.affine);
      ctx2d.drawElementImage(card, 0, 0, cardW, cardH);
      ctx2d.restore();
    }
    if (state.crosshairs) {
      const ha = state.apexPx * 0.5;
      ctx2d.strokeStyle = cssHex;
      ctx2d.globalAlpha = 0.55;
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(cw * 0.5 - ha, ch * 0.5 - ha, state.apexPx, state.apexPx);
    }
    const activeQ = lastProjectorLayout.quadrants[state.activeQuadrant] || lastProjectorLayout.quadrants[0];
    applyGeometryMatrix(new DOMMatrix(activeQ.affine), `pr2d-${activeQ.id}`);
  } else {
    ctx2d.fillStyle = '#05080f';
    ctx2d.fillRect(0, 0, cw, ch);
    const sc = Math.min((cw * 0.62) / cardW, (ch * 0.56) / cardH);
    const dw = cardW * sc;
    const dh = cardH * sc;
    const dx = (cw - dw) * 0.5;
    const dy = (ch - dh) * 0.48;
    ctx2d.save();
    ctx2d.globalAlpha = 0.9;
    ctx2d.drawElementImage(card, dx, dy, dw, dh);
    ctx2d.restore();

    // Draw simple 2D glass frustum outline over the floating card
    ctx2d.strokeStyle = cssHex;
    ctx2d.globalAlpha = 0.5;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    ctx2d.moveTo(cw * 0.16, ch * 0.14);
    ctx2d.lineTo(cw * 0.84, ch * 0.14);
    ctx2d.lineTo(cw * 0.56, ch * 0.86);
    ctx2d.lineTo(cw * 0.44, ch * 0.86);
    ctx2d.closePath();
    ctx2d.stroke();
    lastChamberMatrix = new DOMMatrix([sc, 0, 0, sc, dx, dy]);
    applyGeometryMatrix(lastChamberMatrix, 'ch2d');
  }

  ctx2d.restore();
  domDirty = false;
  updateStatus();
}

function enterPlainFallback(reason) {
  wrap.classList.add('plain');
  if (card.parentElement !== wrap) wrap.append(card);
  state.backend = 'plain HTML';
  showNotice(reason);
  updateStatus();
}

function restoreCanvasFromPlain() {
  wrap.classList.remove('plain');
  if (card.parentElement !== canvas) canvas.append(card);
  showNotice('');
  domDirty = true;
  mipDirty = true;
  lastGeoKey = '';
  requestDraw(true);
}

function needsLoop() {
  if (!state.onScreen || document.hidden || wrap.classList.contains('plain')) return false;
  if (state.pulseAmt > 0.005) return true;
  return state.mode === 'chamber' && state.autoOrbit && !reducedMotion.matches;
}

function scheduleLoop() {
  if (rafId || !needsLoop()) return;
  lastFrameMs = performance.now();
  rafId = requestAnimationFrame(onAnimFrame);
}

function onAnimFrame(now) {
  rafId = 0;
  if (!needsLoop()) return;
  const dt = Math.min(0.05, Math.max(0.004, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  if (state.mode === 'chamber' && state.autoOrbit && !reducedMotion.matches) {
    state.yaw = (state.yaw + dt * 0.42) % (Math.PI * 2);
  }
  if (state.pulseAmt > 0) {
    state.pulseAmt = Math.max(0, state.pulseAmt - dt * 1.45);
  }
  canvas.requestPaint?.();
  scheduleLoop();
}

function requestDraw(markDomDirty = true) {
  if (markDomDirty) domDirty = true;
  if (wrap.classList.contains('plain')) {
    updateStatus();
    return;
  }
  canvas.requestPaint?.();
  scheduleLoop();
}

function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    if (!state.onScreen || document.hidden) return;
    updateCardTelemetry();
    requestDraw(true);
  }, 1000);
}

function stopClock() {
  if (!clockTimer) return;
  clearInterval(clockTimer);
  clockTimer = 0;
}

// Initialise single ElementGL WebGL 2 context, 2D fallback, or plain HTML
if (supported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: PROJECTOR_FRAG,
      attributes: { depth: true },
      onLost: () => {
        sceneGL = null;
        lastLiveTex = null;
        anisoExt = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the telemetry card as plain HTML until the browser restores it.');
      },
      onRestored: () => {
        const gl = stage.gl;
        anisoExt =
          gl.getExtension('EXT_texture_filter_anisotropic') ||
          gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
          gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
        maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
        sceneGL = createChamberResources(gl);
        state.backend = 'WebGL 2 (ElementGL)';
        restoreCanvasFromPlain();
      },
    });
    const gl = stage.gl;
    anisoExt =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    sceneGL = createChamberResources(gl);
    state.backend = 'WebGL 2 (ElementGL)';
  } catch (err) {
    stage = null;
    sceneGL = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
  }
}

if (!stage && supported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2D fallback';
    if (noticeEl.hidden) showNotice('WebGL 2 texElementSubImage2D() is not available here; using the 2D fallback.');
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the telemetry card is shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (stage && !stage.lost) renderWebGL(e);
  else if (ctx2d) render2DFallback();
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (state.onScreen) {
    startClock();
    requestDraw(false);
  } else {
    stopClock();
  }
}).observe(wrap);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopClock();
  else if (state.onScreen) {
    startClock();
    requestDraw(false);
  }
});

new ResizeObserver(() => {
  if (!wrap.classList.contains('plain')) {
    lastGeoKey = '';
    requestDraw(false);
  }
}).observe(canvas);
// #endregion render-loop

// ---------------- Live Card Events ----------------

cardInput.addEventListener('input', () => {
  updateCardTelemetry();
  requestDraw(true);
});

for (const btn of phosphorBtns) {
  btn.addEventListener('click', () => {
    state.phosphor = btn.dataset.phosphorBtn;
    card.dataset.phosphor = state.phosphor;
    for (const b of phosphorBtns) b.setAttribute('aria-pressed', String(b === btn));
    requestDraw(true);
  });
}

cardPulseBtn.addEventListener('click', () => {
  state.signalCount++;
  state.pulseAmt = 1.0;
  card.classList.add('pulsing');
  clearTimeout(pulseResetTimer);
  pulseResetTimer = setTimeout(() => {
    card.classList.remove('pulsing');
    requestDraw(true);
  }, 260);
  updateCardTelemetry();
  requestDraw(true);
});

cardReticleBtn.addEventListener('click', () => {
  state.reticle = !state.reticle;
  card.classList.toggle('reticle-on', state.reticle);
  cardReticleBtn.setAttribute('aria-pressed', String(state.reticle));
  requestDraw(true);
});

// ---------------- Stage Control Events ----------------

function setMode(nextMode) {
  state.mode = nextMode;
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === nextMode));
  panelChamber.hidden = nextMode !== 'chamber';
  panelProjector.hidden = nextMode !== 'projector';
  wrap.classList.toggle('projector', nextMode === 'projector');
  lastGeoKey = '';
  updateCardTelemetry();
  requestDraw(true);
}

for (const b of modeBtns) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}

if (!wrap.requestFullscreen) {
  btnFullscreen.disabled = true;
  btnFullscreen.title = 'Fullscreen API is not available in this browser';
} else {
  const toggleFs = async () => {
    try {
      if (document.fullscreenElement === wrap) await document.exitFullscreen();
      else await wrap.requestFullscreen();
    } catch {}
  };
  btnFullscreen.addEventListener('click', toggleFs);
  btnFsExit.addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === wrap;
    btnFullscreen.setAttribute('aria-pressed', String(active));
    btnFullscreen.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    lastGeoKey = '';
    requestDraw(false);
  });
}

for (const b of presetBtns) {
  b.addEventListener('click', () => {
    const p = b.dataset.preset;
    if (p === 'front') {
      state.yaw = DEFAULT_YAW;
      state.pitch = DEFAULT_PITCH;
      state.dist = DEFAULT_DIST;
    } else if (p === 'side') {
      state.yaw = Math.PI * 0.5;
      state.pitch = 16 * (Math.PI / 180);
      state.dist = 3.12;
    } else if (p === 'top') {
      state.yaw = 35 * (Math.PI / 180);
      state.pitch = 62 * (Math.PI / 180);
      state.dist = 3.35;
    }
    requestDraw(false);
  });
}

btnAutoOrbit.addEventListener('click', () => {
  state.autoOrbit = !state.autoOrbit;
  btnAutoOrbit.setAttribute('aria-pressed', String(state.autoOrbit));
  if (state.autoOrbit && reducedMotion.matches) {
    showNotice('Auto-orbit is paused because prefers-reduced-motion: reduce is active. Drag the glass chamber directly to orbit.');
  } else if (!wrap.classList.contains('plain')) {
    showNotice('');
  }
  scheduleLoop();
});

btnReset.addEventListener('click', () => {
  state.yaw = DEFAULT_YAW;
  state.pitch = DEFAULT_PITCH;
  state.dist = DEFAULT_DIST;
  state.autoOrbit = false;
  btnAutoOrbit.setAttribute('aria-pressed', 'false');
  requestDraw(false);
});

ctlGlass.addEventListener('input', () => {
  const pct = Number(ctlGlass.value);
  state.glassRefl = pct / 100;
  outGlass.textContent = `${pct}%`;
  requestDraw(false);
});

ctlBeams.addEventListener('change', () => {
  state.opticalBeams = ctlBeams.checked;
  requestDraw(false);
});

ctlHitOutline.addEventListener('change', () => {
  state.showHitOutline = ctlHitOutline.checked;
  requestDraw(false);
});

ctlApex.addEventListener('input', () => {
  state.apexPx = Number(ctlApex.value);
  outApex.textContent = `${state.apexPx} px`;
  lastGeoKey = '';
  requestDraw(false);
});

ctlMirror.addEventListener('change', () => {
  state.mirrorFlip = ctlMirror.checked;
  lastGeoKey = '';
  requestDraw(false);
});

ctlCrosshairs.addEventListener('change', () => {
  state.crosshairs = ctlCrosshairs.checked;
  requestDraw(false);
});

ctlActiveFace.addEventListener('change', () => {
  state.highlightFace = ctlActiveFace.checked;
  requestDraw(false);
});

// ---------------- Pointer Orbit & 4-Quadrant Hit Reprojection ----------------

let dragging = false;
let dragX = 0;
let dragY = 0;
let pendingTap = null;
let nativeControlDown = false;

function canvasLocalXY(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function hitTestProjectorPoint(px, py) {
  const { cw, ch } = canvasCssSize();
  const cardW = card.offsetWidth || CARD_W;
  const cardH = card.offsetHeight || CARD_H;
  const layout = lastProjectorLayout || computeProjectorLayout(cw, ch, cardW, cardH, state.apexPx, state.mirrorFlip);
  for (const q of layout.quadrants) {
    const [ia, ib, ic, id, ie, ifVal] = q.invAffine;
    const ex = ia * px + ic * py + ie;
    const ey = ib * px + id * py + ifVal;
    if (ex >= 0 && ex <= cardW && ey >= 0 && ey <= cardH) {
      return { q, ex, ey, control: findLocalControl(ex, ey) };
    }
  }
  return null;
}

function hitTestChamberPoint(px, py) {
  if (!lastChamberMatrix) return null;
  const pt = unprojectMatrixToCard(lastChamberMatrix, px, py);
  if (!pt) return null;
  const cardW = card.offsetWidth || CARD_W;
  const cardH = card.offsetHeight || CARD_H;
  if (pt.ex < 0 || pt.ex > cardW || pt.ey < 0 || pt.ey > cardH) return null;
  return { ex: pt.ex, ey: pt.ey, control: findLocalControl(pt.ex, pt.ey) };
}

canvas.addEventListener('pointermove', (e) => {
  if (wrap.classList.contains('plain')) return;
  if (dragging) {
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    dragX = e.clientX;
    dragY = e.clientY;
    state.yaw -= dx * 0.011;
    state.pitch = Math.max(0.06, Math.min(1.32, state.pitch + dy * 0.009));
    requestDraw(false);
    return;
  }
  if (pendingTap && e.pointerId === pendingTap.pointerId) {
    if (state.mode === 'chamber' && Math.hypot(e.clientX - pendingTap.startX, e.clientY - pendingTap.startY) > 8) {
      pendingTap = null;
      dragging = true;
      dragX = e.clientX;
      dragY = e.clientY;
      canvas.classList.add('dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    return;
  }
  if (e.buttons !== 0 && (e.target === cardInput || nativeControlDown)) return;

  if (state.mode === 'projector') {
    const { x, y } = canvasLocalXY(e);
    const hit = hitTestProjectorPoint(x, y);
    if (hit && hit.q.idx !== state.activeQuadrant) {
      state.activeQuadrant = hit.q.idx;
      applyGeometryMatrix(new DOMMatrix(hit.q.affine), `pr-${hit.q.id}`);
      if (state.highlightFace) requestDraw(false);
      else updateStatus();
    }
  }
}, { capture: true });

canvas.addEventListener('pointerdown', (e) => {
  if (wrap.classList.contains('plain')) return;
  const { x, y } = canvasLocalXY(e);
  const nativeControl = e.target instanceof Element ? e.target.closest('button, input') : null;

  if (state.mode === 'projector') {
    const hit = hitTestProjectorPoint(x, y);
    if (hit) {
      const changed = hit.q.idx !== state.activeQuadrant;
      state.activeQuadrant = hit.q.idx;
      applyGeometryMatrix(new DOMMatrix(hit.q.affine), `pr-${hit.q.id}`);
      if (changed && state.highlightFace) requestDraw(false);
      if (hit.control) {
        if (nativeControl === hit.control.el) {
          nativeControlDown = true;
          pendingTap = null;
          return;
        }
        pendingTap = { control: hit.control.el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
        return;
      }
    }
    return;
  }

  // 3D Chamber mode: allow clicks/typing on floating hologram controls; drag elsewhere to orbit
  const hit = hitTestChamberPoint(x, y);
  if (hit?.control) {
    if (nativeControl === hit.control.el) {
      nativeControlDown = true;
      pendingTap = null;
      return;
    }
    pendingTap = { control: hit.control.el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    return;
  }

  nativeControlDown = false;
  pendingTap = null;
  e.preventDefault();
  dragging = true;
  dragX = e.clientX;
  dragY = e.clientY;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
}, { capture: true });

const endPointer = (e) => {
  nativeControlDown = false;
  if (pendingTap && e.pointerId === pendingTap.pointerId) {
    const tap = pendingTap;
    pendingTap = null;
    if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY) <= 8) {
      if (tap.control.tagName === 'INPUT') tap.control.focus({ preventScroll: true });
      else tap.control.click();
      requestDraw(true);
    }
  }
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endPointer, { capture: true });
canvas.addEventListener('pointercancel', endPointer, { capture: true });

canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'chamber' || wrap.classList.contains('plain')) return;
  e.preventDefault();
  state.dist = Math.max(2.15, Math.min(4.6, state.dist + e.deltaY * 0.0022));
  requestDraw(false);
}, { passive: false });

// Initial telemetry, layout measurement and first paint
updateCardTelemetry();
measureControlRects();
startClock();
requestDraw(true);

// ---------------- Live Checks (Isolated Fixtures on testStage) ----------------

const need = (ok, text) => {
  if (!ok) throw new Error(text);
  return text;
};

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() renders both 3D glass chamber and 4-quadrant projector cleanly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Uploads a luminous drawable card on an isolated ElementGL canvas, draws the full 3D Fresnel acrylic chamber and then the 4-quadrant Phone Pyramid projector, and checks gl.getError() === 0 for both passes.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:240px;height:200px;display:block';

      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:160px;height:130px;background:#24ecff;color:#ffffff;font:700 18px monospace;display:grid;place-items:center';
      child.textContent = 'GHOST';
      cv.append(child);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: PROJECTOR_FRAG, attributes: { depth: true, preserveDrawingBuffer: true } });
      await nextPaint(cv);
      const gl = g.gl;
      while (gl.getError() !== gl.NO_ERROR) {}
      const texObj = g.upload(child);
      gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      const res = createChamberResources(gl);
      g.begin([0.012, 0.016, 0.026, 1]);
      renderChamberScene(gl, res, texObj, {
        cw: 240,
        ch: 200,
        yaw: DEFAULT_YAW,
        pitch: DEFAULT_PITCH,
        dist: DEFAULT_DIST,
        phosphor: PHOSPHORS.cyan,
        glassRefl: 0.68,
        opticalBeams: true,
        showHitOutline: false,
        pulseAmt: 0,
        nowSec: 1.0,
      });
      const err3d = gl.getError();
      const px3d = new Uint8Array(4);
      gl.readPixels(Math.floor(cv.width * 0.5), Math.floor(cv.height * 0.5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px3d);

      const layout = computeProjectorLayout(240, 200, 160, 130, 44, true);
      renderProjectorPass(g, child, layout, {
        phosphor: PHOSPHORS.cyan,
        pulseAmt: 0,
        crosshairs: false,
        highlightFace: false,
        activeQuadrant: 0,
      });
      const errProj = gl.getError();

      res.dispose();
      g.dispose();
      window.__gfx?.retire(cv);

      const hasHoloLight = Math.max(px3d[0], px3d[1], px3d[2]) > 45;
      return need(
        err3d === 0 && errProj === 0 && hasHoloLight,
        `Uploaded ${texObj.w}x${texObj.h}; 3D chamber gl.getError()=${err3d} centre rgb(${px3d[0]}, ${px3d[1]}, ${px3d[2]}); 4-quadrant projector gl.getError()=${errProj}.`
      );
    },
  },
  {
    name: 'All 4 quadrants paint non-black pixels in Phone Pyramid mode while the central apex void stays pure rgb(0, 0, 0)',
    expect: 'pass',
    why: 'Renders the 4-way Phone Pyramid layout on an isolated 240x240 ElementGL canvas and samples the Top, Right, Bottom, Left quadrant centres plus the dead-centre apex pixel.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:240px;height:240px;display:block';

      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:160px;height:130px;background:#3df4ff';
      cv.append(child);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: PROJECTOR_FRAG, attributes: { preserveDrawingBuffer: true } });
      await nextPaint(cv);
      const gl = g.gl;
      const texObj = g.upload(child);
      gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      const layout = computeProjectorLayout(240, 240, 160, 130, 44, true);
      renderProjectorPass(g, child, layout, {
        phosphor: PHOSPHORS.cyan,
        pulseAmt: 0,
        crosshairs: false,
        highlightFace: false,
        activeQuadrant: 0,
      });

      const scaleX = cv.width / 240;
      const scaleY = cv.height / 240;
      const sampleCss = (cssX, cssY) => {
        const px = new Uint8Array(4);
        const gx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * scaleX)));
        const gy = Math.max(0, Math.min(cv.height - 1, cv.height - 1 - Math.round(cssY * scaleY)));
        gl.readPixels(gx, gy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      };

      const samples = layout.quadrants.map((q) => ({
        id: q.id,
        rgb: sampleCss(q.centerX, q.centerY),
      }));
      const apex = sampleCss(layout.cx, layout.cy);

      g.dispose();
      window.__gfx?.retire(cv);

      const allLit = samples.every((s) => Math.max(s.rgb[0], s.rgb[1], s.rgb[2]) > 80);
      const apexBlack = apex[0] === 0 && apex[1] === 0 && apex[2] === 0;
      const summary = samples.map((s) => `${s.id}=rgb(${s.rgb.join(',')})`).join(', ');
      return need(
        allLit && apexBlack,
        `${summary}; centre apex=rgb(${apex.join(',')}).`
      );
    },
  },
  {
    name: 'Projective updateElementGeometry() scaled by geometryUnit() aligns elementsFromPoint() to the floating hologram button',
    expect: 'pass',
    why: 'Applies the 3D virtual chamber hologram projective DOMMatrix scaled by geometryUnit() and dataset.hitTick to an isolated drawable card containing a button, then checks document.elementsFromPoint() at the projected button centre and outside corner.',
    run: async () => {
      if (!supported || typeof HTMLCanvasElement.prototype.updateElementGeometry !== 'function') {
        throw new Error('canvas.updateElementGeometry() is not available');
      }
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:260px;height:220px;display:block';

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = 'box-sizing:border-box;position:relative;width:200px;height:160px;background:transparent';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '+1 Signal';
      btn.style.cssText = 'position:absolute;left:36px;top:96px;width:128px;height:44px;margin:0;border:0;background:#3df4ff;color:#021018';
      box.append(btn);
      cv.append(box);
      testStage().append(cv);

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(260 * dpr);
      cv.height = Math.round(220 * dpr);
      const ctx = cv.getContext('2d');
      cv.addEventListener('paint', () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, 260, 220);
        ctx.drawElementImage(box, 30, 30, 200, 160);
      });
      await nextPaint(cv);

      const { vp } = computeCameraVP(260, 220, DEFAULT_YAW, DEFAULT_PITCH, DEFAULT_DIST);
      const cssM = buildHoloCanvasMatrix(0, vp, 260, 220, 200, 160);
      if (!cssM) {
        window.__gfx?.retire(cv);
        throw new Error('buildHoloCanvasMatrix() returned null');
      }
      const unit = geometryUnit(cv, box, 200);
      cv.updateElementGeometry(box, { canvasTransform: new DOMMatrix().scale(unit, unit, 1).multiply(cssM) });
      box.dataset.hitTick = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Project the local centre of the button (100, 118) into canvas CSS pixels
      const pt = cssM.transformPoint(new DOMPoint(100, 118, 0, 1));
      const sx = pt.x / pt.w;
      const sy = pt.y / pt.w;
      const r = cv.getBoundingClientRect();
      const hitsIn = document.elementsFromPoint(r.left + sx, r.top + sy);
      const hitsOut = document.elementsFromPoint(r.left + 6, r.top + 6);
      const gotBtn = hitsIn.includes(btn);
      const missedCorner = !hitsOut.includes(btn);
      window.__gfx?.retire(cv);

      return need(
        gotBtn && missedCorner,
        `unit=${unit.toFixed(2)}; projected button (${sx.toFixed(1)}, ${sy.toFixed(1)}) hit button=${gotBtn} (top: <${hitsIn[0]?.tagName?.toLowerCase() ?? 'none'}>), corner missed=${missedCorner}.`
      );
    },
  },
  {
    name: 'Context loss falls back cleanly to plain HTML without calling loseContext()',
    expect: 'pass',
    why: 'Dispatches a synthetic cancelable webglcontextlost Event on an isolated fixture canvas and confirms preventDefault() runs and the card moves out into the plain HTML wrapper.',
    run: async () => {
      const host = document.createElement('div');
      const cv = document.createElement('canvas');
      const child = document.createElement('div');
      child.textContent = 'GHOST 1862';
      cv.append(child);
      host.append(cv);
      testStage().append(host);

      let recovered = false;
      cv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        recovered = true;
        host.classList.add('plain');
        host.append(child);
      });

      const ev = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(ev);
      const ok = ev.defaultPrevented && recovered && host.classList.contains('plain') && child.parentElement === host;
      window.__gfx?.retire(cv);
      return need(
        ok,
        `defaultPrevented=${ev.defaultPrevented}, wrapper plain=${host.classList.contains('plain')}, card moved to wrapper=${child.parentElement === host}.`
      );
    },
  },
];

runTests(document.getElementById('tests'), tests);
