import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const canvas = document.getElementById('wm-canvas');
const stageViewport = document.getElementById('wm-viewport');
const sourceCard = document.getElementById('source-card');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('wm-hud');
const routeNoteEl = document.getElementById('route-note');
const noticeEl = document.getElementById('wm-notice');
const checksBody = document.getElementById('checks-body');

// Controls inside the live drawable card
const cardWordInput = document.getElementById('card-word');
const cardWaveBtn = document.getElementById('card-wave');
const cardInvertBtn = document.getElementById('card-invert');
const cardPulseBtn = document.getElementById('card-pulse');
const cardCountEl = document.getElementById('card-count');
const cardContrastInput = document.getElementById('card-contrast');
const cardContrastOut = document.getElementById('card-contrast-out');

// Toolbar controls outside the canvas
const matButtons = Array.from(document.querySelectorAll('button[data-mat]'));
const gridButtons = Array.from(document.querySelectorAll('button[data-grid]'));
const srcButtons = Array.from(document.querySelectorAll('button[data-src]'));
const interactButtons = Array.from(document.querySelectorAll('button[data-interact]'));
const peekSlider = document.getElementById('ctl-peek');
const peekOut = document.getElementById('out-peek');

const CARD_SIZE = 360;
const MIRROR_FRAC = 0.86;
const CAM_Z = 5.2;
const OCT_CUT = 1.60;
const MAX_WAVES = 4;
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

// ---------------- Math Helpers ----------------

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

function buildMirrorVP(cw, ch) {
  const side = Math.min(cw, ch) * MIRROR_FRAC;
  const x0 = (cw - side) * 0.5;
  const y0 = (ch - side) * 0.5;
  const aspect = cw / Math.max(ch, 1);
  // Perspective projection chosen so z = 0 maps [-1, 1] x [-1, 1] to (x0, y0, side, side) exactly.
  const tanHalfFovY = ch / (CAM_Z * Math.max(side, 1));
  const f = 1 / tanHalfFovY;
  const near = 1.0;
  const far = 14.0;
  const nf = 1 / (near - far);
  const proj = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
  // Camera at (0, 0, CAM_Z) looking along -Z
  const view = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -CAM_Z, 1,
  ]);
  return {
    vp: mat4Mul(proj, view),
    side,
    x0,
    y0,
    halfNdcX: side / Math.max(cw, 1),
    halfNdcY: side / Math.max(ch, 1),
  };
}

function countActiveOctagonTiles(grid) {
  let count = 0;
  for (let row = 0; row < grid; row++) {
    const ny = ((row + 0.5) / grid) * 2 - 1;
    for (let col = 0; col < grid; col++) {
      const nx = ((col + 0.5) / grid) * 2 - 1;
      if (Math.abs(nx) + Math.abs(ny) <= OCT_CUT) count++;
    }
  }
  return count;
}

// ---------------- 3D Bevelled Tile Geometry ----------------

function buildTileMesh() {
  // Each tile lies in [-0.45, +0.45] x [-0.45, +0.45] x [-0.10, +0.10] in cell units.
  // Separate vertices per face give crisp flat normals and an explicit front-vs-edge ID.
  const h = 0.445;
  const d = 0.11;
  // [px, py, pz, nx, ny, nz, u, v, faceId]
  const verts = [];
  const indices = [];

  function pushFace(p0, p1, p2, p3, n, faceId) {
    const base = verts.length / 9;
    const uvs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const pts = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      verts.push(pts[i][0], pts[i][1], pts[i][2], n[0], n[1], n[2], uvs[i][0], uvs[i][1], faceId);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Front face (+Z, faceId = 0)
  pushFace([-h, -h, d], [h, -h, d], [h, h, d], [-h, h, d], [0, 0, 1], 0);
  // Top edge (+Y, faceId = 1)
  pushFace([-h, h, d], [h, h, d], [h, h, -d], [-h, h, -d], [0, 1, 0], 1);
  // Bottom edge (-Y, faceId = 2)
  pushFace([-h, -h, -d], [h, -h, -d], [h, -h, d], [-h, -h, d], [0, -1, 0], 2);
  // Left edge (-X, faceId = 3)
  pushFace([-h, -h, -d], [-h, -h, d], [-h, h, d], [-h, h, -d], [-1, 0, 0], 3);
  // Right edge (+X, faceId = 4)
  pushFace([h, -h, d], [h, -h, -d], [h, h, -d], [h, h, d], [1, 0, 0], 4);

  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(indices),
    indexCount: indices.length,
  };
}

const TILE_MESH = buildTileMesh();

// ---------------- WebGL 2 Shaders ----------------

const DUMMY_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = vec4(0.0); }`;

// #region tile-state-shader
const STATE_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const STATE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uSourceTex;
uniform sampler2D uPrevState;
uniform float uGrid;
uniform int uSourceMode;
uniform float uVideoAspect;
uniform float uContrast;
uniform float uInvert;
uniform float uDt;
uniform float uSnap;
uniform vec4 uWaves[4];
uniform vec4 uPointer;

in vec2 vUv;
out vec4 outColor;

vec2 mapSourceUv(vec2 gUv) {
  // UNPACK_FLIP_Y_WEBGL is false, so row 0 is the element's top.
  vec2 uv = vec2(gUv.x, 1.0 - gUv.y);
  if (uSourceMode == 1) {
    // Mirror horizontally in webcam mode and centre-crop to a square.
    uv.x = 1.0 - uv.x;
    if (uVideoAspect > 1.0) {
      uv.x = (uv.x - 0.5) / uVideoAspect + 0.5;
    } else if (uVideoAspect > 0.0) {
      uv.y = (uv.y - 0.5) * uVideoAspect + 0.5;
    }
  }
  return clamp(uv, vec2(0.002), vec2(0.998));
}

void main() {
  vec2 cellOrigin = floor(vUv * uGrid) / uGrid;
  float cellStep = 1.0 / uGrid;

  // Box-average 4x4 stratified samples per tile cell so thin borders and strokes do not alias.
  vec3 sumRgb = vec3(0.0);
  for (int iy = 0; iy < 4; iy++) {
    for (int ix = 0; ix < 4; ix++) {
      vec2 sub = (vec2(float(ix) + 0.5, float(iy) + 0.5) * 0.25) * cellStep;
      vec2 sUv = mapSourceUv(cellOrigin + sub);
      vec4 tex = texture(uSourceTex, sUv);
      sumRgb += tex.rgb;
    }
  }
  vec3 avgRgb = sumRgb / 16.0;
  float lum = dot(avgRgb, vec3(0.2126, 0.7152, 0.0722));
  if (uInvert > 0.5) lum = 1.0 - lum;
  lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);

  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.w > 0.001) {
      float d = length(vUv - w.xy);
      float ring = sin(d * 28.0 - w.z * 14.0) * exp(-d * 3.4) * exp(-w.z * 2.2);
      wave += w.w * ring;
    }
  }
  if (uPointer.w > 0.5) {
    float pd = length(vUv - uPointer.xy);
    wave += uPointer.z * 0.45 * exp(-pd * pd * 44.0);
  }

  float target = clamp(lum + wave, 0.0, 1.0);
  float prev = texture(uPrevState, vUv).r;
  float alpha = uSnap > 0.5 ? 1.0 : (1.0 - exp(-uDt * 18.0));
  float nextAngle = mix(prev, target, alpha);
  float vel = clamp(abs(nextAngle - prev) * 7.0, 0.0, 1.0);
  float waveEnc = clamp(wave * 0.5 + 0.5, 0.0, 1.0);

  outColor = vec4(nextAngle, vel, waveEnc, lum);
}`;
// #endregion tile-state-shader

const BG_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const BG_FRAG = `#version 300 es
precision highp float;

uniform vec2 uHalfNdc;
uniform float uGrid;
uniform float uOctCut;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float octDist(vec2 p, float halfExtent, float chamferCut) {
  vec2 q = abs(p);
  float dBox = max(q.x, q.y) - halfExtent;
  float dDiag = (q.x + q.y - chamferCut) * 0.70710678;
  return max(dBox, dDiag);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 p = ndc / max(uHalfNdc, vec2(0.001));

  float dInner = octDist(p, 1.01, uOctCut + 0.01);
  float frameW = 0.145;
  float dOuter = octDist(p, 1.01 + frameW, uOctCut + 0.01 + frameW * 1.4142);

  // Subtle museum wall backdrop
  float wallGrad = 0.5 + 0.5 * vUv.y;
  vec3 wallCol = mix(vec3(0.145, 0.132, 0.118), vec3(0.195, 0.178, 0.160), wallGrad);
  float wallGrain = (noise2(vUv * 180.0) - 0.5) * 0.016;
  wallCol += wallGrain;

  // Cast drop shadow from the octagonal frame onto the gallery wall
  vec2 shadowP = p - vec2(0.032, -0.048);
  float dShadow = octDist(shadowP, 1.01 + frameW, uOctCut + 0.01 + frameW * 1.4142);
  float wallShadow = 1.0 - 0.58 * exp(-max(dShadow, 0.0) * 14.0);
  wallCol *= wallShadow;

  if (dInner < 0.0) {
    // Dark recessed shadow-box backing cavity behind the tilting wooden tiles
    vec2 cellUv = fract((p * 0.5 + 0.5) * uGrid) - 0.5;
    float pocket = smoothstep(0.10, 0.24, length(cellUv));
    float edgeShade = smoothstep(0.0, 0.08, -dInner);
    vec3 cavity = mix(vec3(0.028, 0.022, 0.017), vec3(0.062, 0.050, 0.040), pocket);
    cavity *= mix(0.55, 1.0, edgeShade);
    outColor = vec4(cavity, 1.0);
    return;
  }

  if (dOuter <= 0.0) {
    // Bevelled walnut/oak octagonal gallery frame
    float t = clamp(dInner / frameW, 0.0, 1.0);
    float bevel = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.84, 1.0, t));
    // Approximate outward edge direction for frame rail lighting and woodgrain orientation
    vec2 q = abs(p);
    float onDiag = step(max(q.x, q.y) - 1.01, (q.x + q.y - (uOctCut + 0.01)) * 0.70710678);
    vec2 railDir = onDiag > 0.5
      ? normalize(vec2(sign(p.x), sign(p.y)))
      : (q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y)));
    vec2 tangent = vec2(-railDir.y, railDir.x);

    float along = dot(p, tangent);
    float across = dot(p, railDir);
    float grain = sin(across * 95.0 + noise2(vec2(along * 8.0, across * 28.0)) * 5.0) * 0.5 + 0.5;
    vec3 walnut = mix(vec3(0.20, 0.13, 0.08), vec3(0.34, 0.22, 0.13), grain);

    // Mitered corner seam lines
    float miterDiag = abs(abs(p.x) - abs(p.y));
    float miterOct = min(abs(abs(p.x) - (uOctCut + 0.01 - 1.01)), abs(abs(p.y) - (uOctCut + 0.01 - 1.01)));
    float seam = smoothstep(0.003, 0.011, miterDiag) * smoothstep(0.002, 0.009, miterOct);
    walnut *= mix(0.45, 1.0, seam);

    vec3 nFrame = normalize(vec3(railDir * mix(-0.48, 0.42, smoothstep(0.12, 0.88, t)), 0.88));
    vec3 L = normalize(vec3(0.18, 0.82, 0.54));
    float diff = max(dot(nFrame, L), 0.0);
    float innerRim = (1.0 - smoothstep(0.0, 0.14, t)) * 0.12;
    vec3 frameCol = walnut * (0.36 + 0.78 * diff) + vec3(0.09, 0.06, 0.03) * bevel + vec3(innerRim);
    outColor = vec4(frameCol, 1.0);
    return;
  }

  float outerEdge = smoothstep(0.0, 0.007, dOuter);
  outColor = vec4(mix(vec3(0.07, 0.05, 0.03), wallCol, outerEdge), 1.0);
}`;

// #region tile-mesh-shader
const TILE_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aFaceId;

uniform mat4 uVP;
uniform sampler2D uStateTex;
uniform int uGrid;
uniform float uOctCut;

out vec3 vWorld;
out vec3 vNorm;
out vec2 vLocalUv;
out float vFaceId;
out vec2 vTileId;
out vec4 vState;

void main() {
  int col = gl_InstanceID % uGrid;
  int row = gl_InstanceID / uGrid;
  float fGrid = float(uGrid);
  vec2 cellCenter = ((vec2(float(col), float(row)) + 0.5) / fGrid) * 2.0 - 1.0;

  if (abs(cellCenter.x) + abs(cellCenter.y) > uOctCut) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 st = texelFetch(uStateTex, ivec2(col, row), 0);
  // Bright pixels tilt upward (-56 deg) into the overhead spotlight; dark pixels tilt down (+54 deg).
  float angleX = mix(radians(54.0), radians(-56.0), st.r);
  float angleY = (st.b - 0.5) * radians(22.0);

  float cx = cos(angleX), sx = sin(angleX);
  float cy = cos(angleY), sy = sin(angleY);

  float cellHalf = 1.0 / fGrid;
  vec3 p = aPos * cellHalf;
  vec3 n = aNorm;

  // Rotate around Y (wave twist), then around X (servo tilt hinge)
  vec3 py = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec3 ny = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);

  vec3 px = vec3(py.x, py.y * cx - py.z * sx, py.y * sx + py.z * cx);
  vec3 nx = vec3(ny.x, ny.y * cx - ny.z * sx, ny.y * sx + ny.z * cx);

  vec3 world = vec3(cellCenter, 0.0) + px;
  vWorld = world;
  vNorm = normalize(nx);
  vLocalUv = aUv;
  vFaceId = aFaceId;
  vTileId = vec2(float(col), float(row));
  vState = st;
  gl_Position = uVP * vec4(world, 1.0);
}`;

const TILE_FRAG = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNorm;
in vec2 vLocalUv;
in float vFaceId;
in vec2 vTileId;
in vec4 vState;

uniform int uMaterial;
uniform vec3 uCamPos;

out vec4 outColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm2(vec2 p) {
  float v = 0.0;
  v += 0.60 * noise2(p);
  v += 0.40 * noise2(p * 2.13 + vec2(7.3, 13.1));
  return v;
}

vec3 trashPalette(float seed) {
  int idx = int(floor(seed * 8.0)) % 8;
  if (idx == 0) return vec3(0.91, 0.88, 0.82); // milk-jug HDPE
  if (idx == 1) return vec3(0.12, 0.36, 0.72); // cobalt bottle cap
  if (idx == 2) return vec3(0.79, 0.19, 0.16); // signal red cap
  if (idx == 3) return vec3(0.90, 0.63, 0.11); // safety amber
  if (idx == 4) return vec3(0.24, 0.64, 0.54); // seafoam scrap
  if (idx == 5) return vec3(0.18, 0.19, 0.21); // charcoal plastic
  if (idx == 6) return vec3(0.47, 0.62, 0.35); // olive detergent cap
  return vec3(0.78, 0.36, 0.20);               // terracotta tile
}

void main() {
  vec3 N = normalize(vNorm);
  vec3 V = normalize(uCamPos - vWorld);

  // Overhead warm gallery halogen spotlight + subtle cool floor bounce
  vec3 L1 = normalize(vec3(0.16, 0.80, 0.58));
  vec3 L2 = normalize(vec3(-0.30, -0.35, 0.88));
  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0);
  vec3 H1 = normalize(L1 + V);
  float nDotH = max(dot(N, H1), 0.0);

  float h1 = hash21(vTileId);
  float h2 = hash21(vTileId + vec2(19.7, 43.1));
  float h3 = hash21(vTileId + vec2(83.3, 11.9));

  vec3 albedo;
  float specPow = 28.0;
  float specAmt = 0.22;
  vec3 specTint = vec3(1.0, 0.96, 0.88);

  if (uMaterial == 0) {
    // Classic Rozin Oak & Pine: unique growth rings and grain direction per tile
    float rot = (h1 - 0.5) * 0.45 + (h2 > 0.55 ? 1.5708 : 0.0);
    float cr = cos(rot), sr = sin(rot);
    vec2 gPos = vec2(vLocalUv.x * cr - vLocalUv.y * sr, vLocalUv.x * sr + vLocalUv.y * cr);

    float warp = fbm2(gPos * 3.8 + vec2(h2 * 24.0, h3 * 19.0));
    float rings = sin((gPos.y * 15.0 + warp * 5.2) + h1 * 18.0) * 0.5 + 0.5;
    rings = smoothstep(0.12, 0.88, rings);
    float pores = noise2(vec2(gPos.x * 46.0 + h2 * 10.0, gPos.y * 7.0));

    vec3 palePine = vec3(0.89, 0.77, 0.58);
    vec3 warmOak = vec3(0.72, 0.51, 0.28);
    vec3 darkHeart = vec3(0.49, 0.31, 0.15);
    vec3 wood = mix(palePine, warmOak, 0.25 + 0.65 * h3);
    wood = mix(wood, darkHeart, rings * 0.44 + (1.0 - pores) * 0.14);

    if (vFaceId > 0.5) {
      // Dark saw-cut end-grain sides
      wood *= 0.48;
      specAmt = 0.08;
    }
    albedo = wood;
    specPow = 26.0;
    specAmt = vFaceId > 0.5 ? 0.06 : 0.24;
  } else if (uMaterial == 1) {
    // Brushed Brass pegs
    float brush = noise2(vec2(vLocalUv.x * 6.0 + h1 * 12.0, vLocalUv.y * 120.0 + h2 * 40.0));
    vec3 brass = mix(vec3(0.76, 0.56, 0.22), vec3(0.95, 0.78, 0.40), brush * 0.7 + h3 * 0.3);
    if (vFaceId > 0.5) brass *= 0.62;
    albedo = brass;
    specPow = 72.0;
    specAmt = vFaceId > 0.5 ? 0.32 : 0.88;
    specTint = vec3(1.0, 0.90, 0.62);
  } else {
    // Trash Mirror: mixed colourful glossy plastic scraps shaded by physical tilt
    vec3 plastic = trashPalette(h1);
    float scuff = noise2(vLocalUv * 12.0 + vec2(h2 * 15.0, h3 * 15.0));
    plastic *= 0.90 + 0.16 * scuff;
    if (vFaceId > 0.5) plastic *= 0.64;
    albedo = plastic;
    specPow = 54.0;
    specAmt = vFaceId > 0.5 ? 0.18 : 0.58;
    specTint = vec3(1.0);
  }

  // Subtle chamfered front bevel rim and cavity ambient occlusion
  float edgeMask = max(abs(vLocalUv.x), abs(vLocalUv.y));
  float bevelDark = 1.0 - 0.18 * smoothstep(0.41, 0.50, edgeMask);
  float cavityAO = mix(0.58, 1.0, smoothstep(-0.35, 0.85, N.z));
  float outerVignette = 1.0 - 0.08 * clamp(length(vWorld.xy) * 0.72, 0.0, 1.0);

  vec3 lightCol = vec3(1.08, 1.00, 0.89);
  vec3 fillCol = vec3(0.11, 0.12, 0.14);
  vec3 color = albedo * (0.09 * cavityAO + lightCol * diff1 * 1.15 + fillCol * diff2);
  color += specTint * (pow(nDotH, specPow) * specAmt * smoothstep(0.0, 0.25, diff1));
  color *= bevelDark * outerVignette;

  // Slight warm sheen when a servo is actively turning
  color += vec3(0.04, 0.03, 0.015) * vState.g * 0.4;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
// #endregion tile-mesh-shader

const PEEK_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uHalfNdc;
out vec2 vMirrorPos;
out vec2 vSrcUv;
void main() {
  vec2 mPos = aPos * 2.0 - 1.0;
  vMirrorPos = mPos;
  vSrcUv = vec2(aPos.x, 1.0 - aPos.y);
  gl_Position = vec4(mPos * uHalfNdc, 0.0, 1.0);
}`;

const PEEK_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uSourceTex;
uniform float uPeek;
uniform float uOctCut;
uniform int uSourceMode;
uniform float uVideoAspect;
in vec2 vMirrorPos;
in vec2 vSrcUv;
out vec4 outColor;

void main() {
  vec2 q = abs(vMirrorPos);
  if (max(q.x, q.y) > 1.0 || (q.x + q.y) > uOctCut) discard;

  vec2 uv = vSrcUv;
  if (uSourceMode == 1) {
    uv.x = 1.0 - uv.x;
    if (uVideoAspect > 1.0) uv.x = (uv.x - 0.5) / uVideoAspect + 0.5;
    else if (uVideoAspect > 0.0) uv.y = (uv.y - 0.5) * uVideoAspect + 0.5;
  }
  vec4 tex = texture(uSourceTex, clamp(uv, 0.002, 0.998));

  // Crisp subtle border around the octagonal aperture so overlay bounds read clearly
  float edge = min(1.0 - max(q.x, q.y), (uOctCut - (q.x + q.y)) * 0.7071);
  float rim = (1.0 - smoothstep(0.0, 0.014, edge)) * 0.55;
  vec3 col = mix(tex.rgb, vec3(0.95, 0.66, 0.23), rim);
  float a = clamp(uPeek * tex.a, 0.0, 1.0);
  outColor = vec4(col * a, a);
}`;

// ---------------- Application State ----------------

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  sourceMode: 'html', // 'html' | 'webcam'
  interactMode: 'html', // 'html' | 'wave'
  material: 0, // 0 oak, 1 brass, 2 plastic
  grid: 30,
  contrast: 1.45,
  invertWebcam: false,
  peek: 0,
  pulseCount: 0,
  onScreen: true,
  dirtySource: true,
  dirtyRender: true,
  snapNext: true,
  activeUntil: 0,
  waves: Array.from({ length: MAX_WAVES }, () => ({ x: 0.5, y: 0.5, start: -10, amp: 0 })),
  waveCursor: 0,
  pointer: { x: 0.5, y: 0.5, strength: 0, active: false, lastX: 0.5, lastY: 0.5, lastTime: 0 },
  draggingWave: false,
  dragId: null,
  stream: null,
  video: null,
  videoReady: false,
  lastLayout: null,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: null,
  stats: { paints: 0, uploads: 0, texW: 0, texH: 0 },
};

let stage = null;
let glRes = null;
let ctx2d = null;
let rafId = 0;
let lastFrameTime = 0;

// ---------------- WebGL 2 Helpers ----------------

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'Shader compile error');
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
    throw new Error(log || 'Program link error');
  }
  return p;
}

function createStatePair(gl, grid) {
  const pair = { grid, fbos: [], texs: [], idx: 0 };
  for (let i = 0; i < 2; i++) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid, grid, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    pair.texs.push(tex);
    pair.fbos.push(fbo);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return pair;
}

function deleteStatePair(gl, pair) {
  if (!pair || gl.isContextLost()) return;
  for (const f of pair.fbos) gl.deleteFramebuffer(f);
  for (const t of pair.texs) gl.deleteTexture(t);
}

function buildGLResources(gl, grid) {
  const stateProg = linkProgram(gl, STATE_VERT, STATE_FRAG);
  const bgProg = linkProgram(gl, BG_VERT, BG_FRAG);
  const tileProg = linkProgram(gl, TILE_VERT, TILE_FRAG);
  const peekProg = linkProgram(gl, PEEK_VERT, PEEK_FRAG);

  // Fullscreen quad [0,1]^2 VAO
  const quadVao = gl.createVertexArray();
  const quadVbo = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // 3D bevelled tile mesh VAO
  const tileVao = gl.createVertexArray();
  const tileVbo = gl.createBuffer();
  const tileEbo = gl.createBuffer();
  gl.bindVertexArray(tileVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVbo);
  gl.bufferData(gl.ARRAY_BUFFER, TILE_MESH.vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tileEbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, TILE_MESH.indices, gl.STATIC_DRAW);
  const stride = 9 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 8 * 4);
  gl.bindVertexArray(null);

  const statePair = createStatePair(gl, grid);

  return {
    stateProg,
    bgProg,
    tileProg,
    peekProg,
    uState: {
      uSourceTex: gl.getUniformLocation(stateProg, 'uSourceTex'),
      uPrevState: gl.getUniformLocation(stateProg, 'uPrevState'),
      uGrid: gl.getUniformLocation(stateProg, 'uGrid'),
      uSourceMode: gl.getUniformLocation(stateProg, 'uSourceMode'),
      uVideoAspect: gl.getUniformLocation(stateProg, 'uVideoAspect'),
      uContrast: gl.getUniformLocation(stateProg, 'uContrast'),
      uInvert: gl.getUniformLocation(stateProg, 'uInvert'),
      uDt: gl.getUniformLocation(stateProg, 'uDt'),
      uSnap: gl.getUniformLocation(stateProg, 'uSnap'),
      uWaves: gl.getUniformLocation(stateProg, 'uWaves[0]'),
      uPointer: gl.getUniformLocation(stateProg, 'uPointer'),
    },
    uBg: {
      uHalfNdc: gl.getUniformLocation(bgProg, 'uHalfNdc'),
      uGrid: gl.getUniformLocation(bgProg, 'uGrid'),
      uOctCut: gl.getUniformLocation(bgProg, 'uOctCut'),
    },
    uTile: {
      uVP: gl.getUniformLocation(tileProg, 'uVP'),
      uStateTex: gl.getUniformLocation(tileProg, 'uStateTex'),
      uGrid: gl.getUniformLocation(tileProg, 'uGrid'),
      uOctCut: gl.getUniformLocation(tileProg, 'uOctCut'),
      uMaterial: gl.getUniformLocation(tileProg, 'uMaterial'),
      uCamPos: gl.getUniformLocation(tileProg, 'uCamPos'),
    },
    uPeek: {
      uSourceTex: gl.getUniformLocation(peekProg, 'uSourceTex'),
      uPeek: gl.getUniformLocation(peekProg, 'uPeek'),
      uHalfNdc: gl.getUniformLocation(peekProg, 'uHalfNdc'),
      uOctCut: gl.getUniformLocation(peekProg, 'uOctCut'),
      uSourceMode: gl.getUniformLocation(peekProg, 'uSourceMode'),
      uVideoAspect: gl.getUniformLocation(peekProg, 'uVideoAspect'),
    },
    quadVao,
    quadVbo,
    tileVao,
    tileVbo,
    tileEbo,
    statePair,
    sourceTex: null,
    texW: 0,
    texH: 0,
    videoTex: null,
  };
}

function disposeCustomGLResources(gl, res) {
  if (!res || !gl || gl.isContextLost()) return;
  deleteStatePair(gl, res.statePair);
  if (res.sourceTex) gl.deleteTexture(res.sourceTex);
  if (res.videoTex) gl.deleteTexture(res.videoTex);
  gl.deleteBuffer(res.quadVbo);
  gl.deleteVertexArray(res.quadVao);
  gl.deleteBuffer(res.tileVbo);
  gl.deleteBuffer(res.tileEbo);
  gl.deleteVertexArray(res.tileVao);
  gl.deleteProgram(res.stateProg);
  gl.deleteProgram(res.bgProg);
  gl.deleteProgram(res.tileProg);
  gl.deleteProgram(res.peekProg);
}

// #region gl-upload
function uploadSourceElement() {
  if (!stage || stage.lost || !glRes) return false;
  const gl = stage.gl;
  let size;
  try {
    size = canvas.getElementImageDefaultSize
      ? canvas.getElementImageDefaultSize(sourceCard)
      : { width: CARD_SIZE * (window.devicePixelRatio || 1), height: CARD_SIZE * (window.devicePixelRatio || 1) };
  } catch {
    return false;
  }
  const w = Math.max(1, Math.ceil(size.width));
  const h = Math.max(1, Math.ceil(size.height));
  if (!glRes.sourceTex || glRes.texW !== w || glRes.texH !== h) {
    if (glRes.sourceTex) gl.deleteTexture(glRes.sourceTex);
    glRes.sourceTex = gl.createTexture();
    glRes.texW = w;
    glRes.texH = h;
    gl.bindTexture(gl.TEXTURE_2D, glRes.sourceTex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, glRes.sourceTex);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sourceCard);
  gl.generateMipmap(gl.TEXTURE_2D);
  state.dirtySource = false;
  state.stats.uploads++;
  state.stats.texW = w;
  state.stats.texH = h;
  return true;
}

function uploadVideoFrame() {
  if (!stage || stage.lost || !glRes || !state.video || state.video.readyState < 2) return false;
  const gl = stage.gl;
  if (!glRes.videoTex) {
    glRes.videoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glRes.videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, glRes.videoTex);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.video);
  return true;
}
// #endregion gl-upload

// ---------------- Buffer Sizing & Hit-Box Sync ----------------

function sizeCanvasBuffer() {
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.75);
  let w = Math.max(1, Math.round(cw * dpr));
  let h = Math.max(1, Math.round(ch * dpr));
  const maxPixels = 3.5e6;
  if (w * h > maxPixels) {
    const k = Math.sqrt(maxPixels / (w * h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { cw, ch, w, h };
}

// #region hit-sync
function cachedGeometryUnit() {
  const w = sourceCard.offsetWidth || CARD_SIZE;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${w}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, sourceCard, w);
    state.unitCache.key = key;
    state.lastGeoKey = null;
  }
  return state.unitCache.unit;
}

function syncHitGeometry(layout) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || state.mode !== 'webgl') return;
  const useHtml = state.sourceMode === 'html' && state.interactMode === 'html';
  sourceCard.inert = !useHtml;
  sourceCard.style.pointerEvents = useHtml ? 'auto' : 'none';

  const unit = cachedGeometryUnit();
  const s = layout.side / CARD_SIZE;
  const target = useHtml
    ? new DOMMatrix().scale(unit, unit, 1).translate(layout.x0, layout.y0).scale(s, s, 1)
    : OFFSTAGE;
  if (!target) return;
  const vals = target.toFloat32Array();
  if (state.lastGeoKey && vals.every((v, i) => Math.abs(v - state.lastGeoKey[i]) < 1e-4)) return;
  state.lastGeoKey = vals;
  canvas.updateElementGeometry(sourceCard, { canvasTransform: target });
  sourceCard.dataset.hitTick = sourceCard.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion hit-sync

// ---------------- Render Pipeline ----------------

function packWaveArray(nowSec) {
  const arr = new Float32Array(MAX_WAVES * 4);
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = state.waves[i];
    const age = nowSec - w.start;
    if (age >= 0 && age < 2.2 && w.amp > 0.001) {
      arr[i * 4] = w.x;
      arr[i * 4 + 1] = w.y;
      arr[i * 4 + 2] = age;
      arr[i * 4 + 3] = w.amp;
    }
  }
  return arr;
}

function renderWebGL(nowMs, dt) {
  if (!stage || stage.lost || !glRes) return;
  const gl = stage.gl;
  const { cw, ch, w, h } = sizeCanvasBuffer();
  const layout = buildMirrorVP(cw, ch);
  state.lastLayout = layout;

  if (glRes.statePair.grid !== state.grid) {
    deleteStatePair(gl, glRes.statePair);
    glRes.statePair = createStatePair(gl, state.grid);
    state.snapNext = true;
  }

  let activeTex = null;
  let activeMode = 0;
  let videoAspect = 1.0;
  if (state.sourceMode === 'webcam' && state.video && state.video.readyState >= 2) {
    if (uploadVideoFrame()) {
      activeTex = glRes.videoTex;
      activeMode = 1;
      videoAspect = (state.video.videoWidth || 1) / Math.max(state.video.videoHeight || 1, 1);
    }
  }
  if (!activeTex) {
    if (state.dirtySource || !glRes.sourceTex) {
      uploadSourceElement();
    }
    activeTex = glRes.sourceTex;
    activeMode = 0;
  }
  if (!activeTex) return;

  // Pass 1: Update N x N tile tilt state FBO on the GPU (zero readback)
  const pair = glRes.statePair;
  const readIdx = pair.idx;
  const writeIdx = 1 - readIdx;

  gl.bindFramebuffer(gl.FRAMEBUFFER, pair.fbos[writeIdx]);
  gl.viewport(0, 0, state.grid, state.grid);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);

  gl.useProgram(glRes.stateProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, activeTex);
  gl.uniform1i(glRes.uState.uSourceTex, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, pair.texs[readIdx]);
  gl.uniform1i(glRes.uState.uPrevState, 1);

  gl.uniform1f(glRes.uState.uGrid, state.grid);
  gl.uniform1i(glRes.uState.uSourceMode, activeMode);
  gl.uniform1f(glRes.uState.uVideoAspect, videoAspect);
  gl.uniform1f(glRes.uState.uContrast, state.contrast);
  gl.uniform1f(glRes.uState.uInvert, activeMode === 1 && state.invertWebcam ? 1.0 : 0.0);
  gl.uniform1f(glRes.uState.uDt, dt);
  gl.uniform1f(glRes.uState.uSnap, state.snapNext ? 1.0 : 0.0);
  gl.uniform4fv(glRes.uState.uWaves, packWaveArray(nowMs / 1000));
  gl.uniform4f(
    glRes.uState.uPointer,
    state.pointer.x,
    state.pointer.y,
    state.pointer.strength,
    state.pointer.active ? 1.0 : 0.0
  );

  gl.bindVertexArray(glRes.quadVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  pair.idx = writeIdx;
  state.snapNext = false;

  // Pass 2: Gallery backdrop & octagonal bevelled frame
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.145, 0.132, 0.118, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);

  gl.useProgram(glRes.bgProg);
  gl.uniform2f(glRes.uBg.uHalfNdc, layout.halfNdcX, layout.halfNdcY);
  gl.uniform1f(glRes.uBg.uGrid, state.grid);
  gl.uniform1f(glRes.uBg.uOctCut, OCT_CUT);
  gl.bindVertexArray(glRes.quadVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 3: Instanced 3D bevelled wooden/brass/plastic tiles
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  gl.useProgram(glRes.tileProg);
  gl.uniformMatrix4fv(glRes.uTile.uVP, false, layout.vp);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pair.texs[writeIdx]);
  gl.uniform1i(glRes.uTile.uStateTex, 0);
  gl.uniform1i(glRes.uTile.uGrid, state.grid);
  gl.uniform1f(glRes.uTile.uOctCut, OCT_CUT);
  gl.uniform1i(glRes.uTile.uMaterial, state.material);
  gl.uniform3f(glRes.uTile.uCamPos, 0.0, 0.0, CAM_Z);

  gl.bindVertexArray(glRes.tileVao);
  gl.drawElementsInstanced(gl.TRIANGLES, TILE_MESH.indexCount, gl.UNSIGNED_SHORT, 0, state.grid * state.grid);
  gl.bindVertexArray(null);

  // Pass 4: Optional translucent live HTML peek overlay
  if (state.peek > 0.005) {
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(glRes.peekProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, activeTex);
    gl.uniform1i(glRes.uPeek.uSourceTex, 0);
    gl.uniform1f(glRes.uPeek.uPeek, state.peek);
    gl.uniform2f(glRes.uPeek.uHalfNdc, layout.halfNdcX, layout.halfNdcY);
    gl.uniform1f(glRes.uPeek.uOctCut, OCT_CUT);
    gl.uniform1i(glRes.uPeek.uSourceMode, activeMode);
    gl.uniform1f(glRes.uPeek.uVideoAspect, videoAspect);

    gl.bindVertexArray(glRes.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  // Sync HTML hit box after drawing
  syncHitGeometry(layout);

  // Update HUD readout
  const matName = ['oak', 'brass', 'plastic'][state.material] || 'oak';
  const tileCount = countActiveOctagonTiles(state.grid);
  const srcName = activeMode === 1 ? 'webcam' : `${glRes.texW}×${glRes.texH} tex`;
  hudEl.textContent = `${state.grid}×${state.grid} octagon (${tileCount} tiles) · ${matName} · ${srcName} · 0 CPU readback`;
}

function render2DFallback() {
  if (!ctx2d) return;
  const { cw, ch, w, h } = sizeCanvasBuffer();
  const dpr = w / cw;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#231f1b';
  ctx2d.fillRect(0, 0, cw, ch);

  const side = Math.min(cw, ch) * MIRROR_FRAC;
  const x0 = (cw - side) * 0.5;
  const y0 = (ch - side) * 0.5;

  // Draw the live source card with 5 explicit arguments so HiDPI scaling stays 1:1.
  try {
    ctx2d.drawElementImage(sourceCard, x0, y0, side, side);
  } catch {}

  // Overlay subtle warm oak slat grid lines over the 2D fallback without reading pixels back.
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'multiply';
  ctx2d.fillStyle = '#d7b483';
  ctx2d.fillRect(x0, y0, side, side);
  ctx2d.restore();

  const n = state.grid;
  const step = side / n;
  ctx2d.strokeStyle = 'rgba(22, 16, 10, 0.58)';
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  for (let i = 0; i <= n; i++) {
    const p = x0 + i * step;
    const q = y0 + i * step;
    ctx2d.moveTo(p, y0);
    ctx2d.lineTo(p, y0 + side);
    ctx2d.moveTo(x0, q);
    ctx2d.lineTo(x0 + side, q);
  }
  ctx2d.stroke();
  hudEl.textContent = `2D fallback (${n}×${n} oak grid, WebGL 2 texElementSubImage2D unavailable)`;
}

function fallbackToPlainHTML(reason) {
  stopWebcam();
  state.mode = 'plain';
  canvas.hidden = true;
  sourceCard.inert = false;
  sourceCard.style.pointerEvents = 'auto';
  if (sourceCard.parentElement !== plainHost) plainHost.append(sourceCard);
  hudEl.textContent = reason;
  routeNoteEl.textContent = `${reason}. Showing the live form as plain HTML.`;
}

// ---------------- Motion & On-Demand Animation Loop ----------------

function keepRunningFor(ms) {
  const target = performance.now() + (REDUCED_MOTION ? 60 : ms);
  if (target > state.activeUntil) state.activeUntil = target;
  requestRender();
}

function requestRender() {
  state.dirtyRender = true;
  if (!rafId && state.onScreen) {
    rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden) return;
  const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
  lastFrameTime = now;

  // Decay pointer wake smoothly
  if (state.pointer.active) {
    state.pointer.strength *= Math.exp(-dt * 7.5);
    if (now - state.pointer.lastTime > 260 && state.pointer.strength < 0.02) {
      state.pointer.strength = 0;
      state.pointer.active = false;
    }
  }

  const webcamActive = state.sourceMode === 'webcam' && state.video && state.video.readyState >= 2;
  const animating = webcamActive || now < state.activeUntil || state.pointer.active;

  if (state.dirtyRender || animating) {
    state.dirtyRender = false;
    if (state.mode === 'webgl') renderWebGL(now, dt);
    else if (state.mode === '2d') render2DFallback();
  }

  if (animating) {
    rafId = requestAnimationFrame(tick);
  }
}

function spawnWave(nx, ny, amp = 0.85) {
  if (REDUCED_MOTION) {
    state.snapNext = true;
    requestRender();
    return;
  }
  const slot = state.waves[state.waveCursor];
  state.waveCursor = (state.waveCursor + 1) % MAX_WAVES;
  slot.x = Math.max(0, Math.min(1, nx));
  slot.y = Math.max(0, Math.min(1, ny));
  slot.start = performance.now() / 1000;
  slot.amp = amp;
  keepRunningFor(1650);
}

// ---------------- Pointer & Form Interactions ----------------

function clientToMirrorUv(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const layout = state.lastLayout || buildMirrorVP(rect.width, rect.height);
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const u = (cx - layout.x0) / Math.max(layout.side, 1);
  // Flip Y because mirror tile state FBO has y = 0 at bottom and y = 1 at top.
  const v = 1.0 - (cy - layout.y0) / Math.max(layout.side, 1);
  return { u, v, inside: u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05 };
}

function notePointerWake(clientX, clientY, boost = 0.55) {
  const pt = clientToMirrorUv(clientX, clientY);
  if (!pt || !pt.inside) return;
  const now = performance.now();
  const move = Math.hypot(pt.u - state.pointer.lastX, pt.v - state.pointer.lastY);
  state.pointer.x = Math.max(0, Math.min(1, pt.u));
  state.pointer.y = Math.max(0, Math.min(1, pt.v));
  state.pointer.lastX = pt.u;
  state.pointer.lastY = pt.v;
  state.pointer.lastTime = now;
  state.pointer.active = true;
  state.pointer.strength = Math.min(1.1, Math.max(state.pointer.strength, boost * Math.min(1.4, 0.45 + move * 18)));
  keepRunningFor(420);
}

stageViewport.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'webgl') return;
  const pt = clientToMirrorUv(e.clientX, e.clientY);
  if (!pt || !pt.inside) return;

  const isWaveOnly = state.interactMode === 'wave' || state.sourceMode === 'webcam';
  const hitControl = e.target instanceof Element && sourceCard.contains(e.target) &&
    !!e.target.closest('input, button, label');

  if (isWaveOnly || !hitControl) {
    spawnWave(pt.u, pt.v, isWaveOnly ? 0.95 : 0.72);
  }
  if (isWaveOnly) {
    state.draggingWave = true;
    state.dragId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }
});

stageViewport.addEventListener('pointermove', (e) => {
  if (state.mode !== 'webgl') return;
  if (state.draggingWave && e.pointerId === state.dragId) {
    notePointerWake(e.clientX, e.clientY, 0.95);
    return;
  }
  if (e.pointerType === 'mouse') {
    notePointerWake(e.clientX, e.clientY, 0.42);
  }
});

function stopWaveDrag(e) {
  if (!state.draggingWave || e.pointerId !== state.dragId) return;
  state.draggingWave = false;
  state.dragId = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
stageViewport.addEventListener('pointerup', stopWaveDrag);
stageViewport.addEventListener('pointercancel', stopWaveDrag);

// Live source card controls
cardWordInput.addEventListener('input', () => {
  state.dirtySource = true;
  canvas.requestPaint?.();
  spawnWave(0.24 + Math.random() * 0.52, 0.72, 0.55);
  keepRunningFor(520);
});

cardWaveBtn.addEventListener('click', () => {
  spawnWave(0.5, 0.5, 1.1);
  canvas.requestPaint?.();
});

cardInvertBtn.addEventListener('click', () => {
  const on = sourceCard.classList.toggle('inverted');
  cardInvertBtn.setAttribute('aria-pressed', String(on));
  state.invertWebcam = on;
  state.dirtySource = true;
  canvas.requestPaint?.();
  spawnWave(0.5, 0.5, 0.85);
  keepRunningFor(580);
});

cardPulseBtn.addEventListener('click', () => {
  state.pulseCount = (state.pulseCount + 1) % 100;
  cardCountEl.textContent = String(state.pulseCount);
  state.dirtySource = true;
  canvas.requestPaint?.();
  spawnWave(0.78, 0.5, 0.95);
  keepRunningFor(620);
});

cardContrastInput.addEventListener('input', () => {
  const pct = Number(cardContrastInput.value) || 145;
  state.contrast = pct / 100;
  cardContrastOut.textContent = `${pct}%`;
  state.dirtySource = true;
  canvas.requestPaint?.();
  keepRunningFor(350);
});

// ---------------- Toolbar & Webcam Controls ----------------

for (const btn of matButtons) {
  btn.addEventListener('click', () => {
    state.material = Number(btn.dataset.mat) || 0;
    for (const b of matButtons) b.setAttribute('aria-pressed', String(b === btn));
    requestRender();
  });
}

for (const btn of gridButtons) {
  btn.addEventListener('click', () => {
    const nextGrid = Number(btn.dataset.grid) || 30;
    if (nextGrid === state.grid) return;
    state.grid = nextGrid;
    state.snapNext = true;
    for (const b of gridButtons) b.setAttribute('aria-pressed', String(b === btn));
    keepRunningFor(420);
  });
}

for (const btn of interactButtons) {
  btn.addEventListener('click', () => {
    state.interactMode = btn.dataset.interact === 'wave' ? 'wave' : 'html';
    for (const b of interactButtons) b.setAttribute('aria-pressed', String(b === btn));
    canvas.classList.toggle('wave-only', state.interactMode === 'wave' || state.sourceMode === 'webcam');
    state.lastGeoKey = null;
    requestRender();
  });
}

peekSlider.addEventListener('input', () => {
  const pct = Number(peekSlider.value) || 0;
  state.peek = pct / 100;
  peekOut.textContent = `${pct}%`;
  requestRender();
});

function setSourceButtonState(mode) {
  for (const b of srcButtons) b.setAttribute('aria-pressed', String(b.dataset.src === mode));
}

function stopWebcam() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      try { track.stop(); } catch {}
    }
    state.stream = null;
  }
  if (state.video) {
    state.video.srcObject = null;
    state.video.remove();
    state.video = null;
  }
  state.videoReady = false;
}

async function startWebcam() {
  noticeEl.hidden = true;
  if (state.mode !== 'webgl') {
    state.sourceMode = 'html';
    setSourceButtonState('html');
    noticeEl.textContent = 'Webcam tiling needs WebGL 2; staying on the live HTML form.';
    noticeEl.hidden = false;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    state.sourceMode = 'html';
    setSourceButtonState('html');
    noticeEl.textContent = 'Camera input is unavailable in this browser; staying on the live HTML form.';
    noticeEl.hidden = false;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    if (state.sourceMode !== 'webcam') {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    state.stream = stream;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    video.srcObject = stream;
    stageViewport.append(video);
    state.video = video;
    await video.play();
    state.videoReady = true;
    canvas.classList.add('wave-only');
    state.lastGeoKey = null;
    state.snapNext = true;
    requestRender();
  } catch (err) {
    stopWebcam();
    state.sourceMode = 'html';
    setSourceButtonState('html');
    canvas.classList.toggle('wave-only', state.interactMode === 'wave');
    noticeEl.textContent = `Webcam could not start (${err?.message || 'permission denied'}). Using the live HTML form.`;
    noticeEl.hidden = false;
    requestRender();
  }
}

for (const btn of srcButtons) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.src === 'webcam' ? 'webcam' : 'html';
    if (next === state.sourceMode) return;
    state.sourceMode = next;
    setSourceButtonState(next);
    state.lastGeoKey = null;
    if (next === 'webcam') {
      startWebcam();
    } else {
      stopWebcam();
      noticeEl.hidden = true;
      canvas.classList.toggle('wave-only', state.interactMode === 'wave');
      state.dirtySource = true;
      state.snapNext = true;
      canvas.requestPaint?.();
      requestRender();
    }
  });
}

window.addEventListener('pagehide', stopWebcam);

// ---------------- Boot & Observers ----------------

function initRenderer() {
  if (!hicSupported) {
    fallbackToPlainHTML('HTML-in-canvas is not enabled in this browser');
    return;
  }

  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: DUMMY_FRAG,
        attributes: { alpha: false, depth: true, antialias: true, powerPreference: 'low-power' },
        onLost: () => {
          glRes = null;
          fallbackToPlainHTML('WebGL 2 context lost');
        },
        onRestored: () => {
          if (sourceCard.parentElement !== canvas) canvas.append(sourceCard);
          canvas.hidden = false;
          glRes = buildGLResources(stage.gl, state.grid);
          state.mode = 'webgl';
          state.dirtySource = true;
          state.snapNext = true;
          state.lastGeoKey = null;
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context, texElementSubImage2D + updateElementGeometry).';
          canvas.requestPaint?.();
          requestRender();
        },
      });
      glRes = buildGLResources(stage.gl, state.grid);
      state.mode = 'webgl';
      routeNoteEl.textContent = 'Drawn with WebGL 2 on one ElementGL context using texElementSubImage2D() and updateElementGeometry().';
    } catch (err) {
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back to 2D.`;
    }
  }

  if (state.mode !== 'webgl') {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; drawn with 5-argument 2D drawElementImage().';
    } else {
      fallbackToPlainHTML('Canvas context unavailable');
      return;
    }
  }

  canvas.addEventListener('paint', () => {
    state.stats.paints++;
    state.dirtySource = true;
    if (state.mode === 'webgl') {
      uploadSourceElement();
      keepRunningFor(420);
    } else if (state.mode === '2d') {
      render2DFallback();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      state.lastGeoKey = null;
      requestRender();
    });
    ro.observe(canvas);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((entries) => {
      state.onScreen = entries.some((e) => e.isIntersecting);
      if (state.onScreen) requestRender();
    }, { rootMargin: '120px' });
    io.observe(canvas);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.onScreen) requestRender();
  });

  canvas.requestPaint?.();
  requestRender();
}

initRenderer();

// ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------

function createMirrorCheckFixture(width, height, bgColor) {
  const fixCanvas = document.createElement('canvas');
  fixCanvas.setAttribute('content', 'drawable');
  fixCanvas.setAttribute('layoutsubtree', '');
  fixCanvas.style.cssText = `width:${width}px;height:${height}px;display:block;`;

  const card = document.createElement('div');
  card.setAttribute('drawable', '');
  card.style.cssText = `position:absolute;left:0;top:0;width:${CARD_SIZE}px;height:${CARD_SIZE}px;background:${bgColor};`;
  fixCanvas.append(card);
  testStage().append(fixCanvas);
  return { fixCanvas, card };
}

function renderFixtureMirror(fixGL, fixRes, fixCanvas, fixCard, { grid, material }) {
  const gl = fixGL.gl;
  if (fixRes.statePair.grid !== grid) {
    deleteStatePair(gl, fixRes.statePair);
    fixRes.statePair = createStatePair(gl, grid);
  }

  const size = fixCanvas.getElementImageDefaultSize(fixCard);
  const tw = Math.max(1, Math.ceil(size.width));
  const th = Math.max(1, Math.ceil(size.height));
  if (!fixRes.sourceTex || fixRes.texW !== tw || fixRes.texH !== th) {
    if (fixRes.sourceTex) gl.deleteTexture(fixRes.sourceTex);
    fixRes.sourceTex = gl.createTexture();
    fixRes.texW = tw;
    fixRes.texH = th;
    gl.bindTexture(gl.TEXTURE_2D, fixRes.sourceTex);
    const levels = Math.floor(Math.log2(Math.max(tw, th))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, tw, th);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, fixRes.sourceTex);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fixCard);
  gl.generateMipmap(gl.TEXTURE_2D);

  const cw = fixCanvas.clientWidth || 1;
  const ch = fixCanvas.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.75);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (fixCanvas.width !== bw) fixCanvas.width = bw;
  if (fixCanvas.height !== bh) fixCanvas.height = bh;

  const pair = fixRes.statePair;
  const readIdx = pair.idx;
  const writeIdx = 1 - readIdx;

  gl.bindFramebuffer(gl.FRAMEBUFFER, pair.fbos[writeIdx]);
  gl.viewport(0, 0, grid, grid);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.useProgram(fixRes.stateProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fixRes.sourceTex);
  gl.uniform1i(fixRes.uState.uSourceTex, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, pair.texs[readIdx]);
  gl.uniform1i(fixRes.uState.uPrevState, 1);
  gl.uniform1f(fixRes.uState.uGrid, grid);
  gl.uniform1i(fixRes.uState.uSourceMode, 0);
  gl.uniform1f(fixRes.uState.uVideoAspect, 1.0);
  gl.uniform1f(fixRes.uState.uContrast, 1.45);
  gl.uniform1f(fixRes.uState.uInvert, 0.0);
  gl.uniform1f(fixRes.uState.uDt, 0.016);
  gl.uniform1f(fixRes.uState.uSnap, 1.0);
  gl.uniform4fv(fixRes.uState.uWaves, new Float32Array(MAX_WAVES * 4));
  gl.uniform4f(fixRes.uState.uPointer, 0.5, 0.5, 0.0, 0.0);
  gl.bindVertexArray(fixRes.quadVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  pair.idx = writeIdx;

  const layout = buildMirrorVP(cw, ch);
  gl.viewport(0, 0, bw, bh);
  gl.clearColor(0.145, 0.132, 0.118, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.depthMask(false);
  gl.useProgram(fixRes.bgProg);
  gl.uniform2f(fixRes.uBg.uHalfNdc, layout.halfNdcX, layout.halfNdcY);
  gl.uniform1f(fixRes.uBg.uGrid, grid);
  gl.uniform1f(fixRes.uBg.uOctCut, OCT_CUT);
  gl.bindVertexArray(fixRes.quadVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.useProgram(fixRes.tileProg);
  gl.uniformMatrix4fv(fixRes.uTile.uVP, false, layout.vp);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pair.texs[writeIdx]);
  gl.uniform1i(fixRes.uTile.uStateTex, 0);
  gl.uniform1i(fixRes.uTile.uGrid, grid);
  gl.uniform1f(fixRes.uTile.uOctCut, OCT_CUT);
  gl.uniform1i(fixRes.uTile.uMaterial, material);
  gl.uniform3f(fixRes.uTile.uCamPos, 0.0, 0.0, CAM_Z);
  gl.bindVertexArray(fixRes.tileVao);
  gl.drawElementsInstanced(gl.TRIANGLES, TILE_MESH.indexCount, gl.UNSIGNED_SHORT, 0, grid * grid);
  gl.bindVertexArray(null);
}

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() drives tilted tile shading with gl.getError() === 0 and zero timed readbacks',
    why: 'Builds an isolated mirror fixture on testStage(), compiles both the tile-state FBO and instanced 3D louver shaders, uploads HTML via texElementSubImage2D() and checks for GL errors or unasked readbacks.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { fixCanvas, card } = createMirrorCheckFixture(220, 220, '#ffffff');
      const fixGL = new ElementGL(fixCanvas, {
        fragment: DUMMY_FRAG,
        attributes: { alpha: false, depth: true, preserveDrawingBuffer: true },
      });
      const fixRes = buildGLResources(fixGL.gl, 30);
      try {
        await nextPaint(fixCanvas);
        renderFixtureMirror(fixGL, fixRes, fixCanvas, card, { grid: 30, material: 0 });
        const glErr = fixGL.gl.getError();
        if (glErr !== fixGL.gl.NO_ERROR) throw new Error(`gl.getError() returned ${glErr}`);
        const unasked = window.__gfx?.reads?.unasked ?? 0;
        if (unasked > 0) throw new Error(`detected ${unasked} unasked readback(s)`);
        return `uploaded ${fixRes.texW}×${fixRes.texH} HTML texture, drew ${countActiveOctagonTiles(30)} oak tiles, gl.getError() === 0, unasked readbacks === 0`;
      } finally {
        disposeCustomGLResources(fixGL.gl, fixRes);
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Bright (#ffffff) vs dark (#000000) drawable HTML produces distinct reflected tile brightness',
    why: 'Renders the same isolated tile grid from a #ffffff card then a #000000 card and reads the centre tile pixels once per state inside the tap-gated check.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { fixCanvas, card } = createMirrorCheckFixture(220, 220, '#ffffff');
      const fixGL = new ElementGL(fixCanvas, {
        fragment: DUMMY_FRAG,
        attributes: { alpha: false, depth: true, preserveDrawingBuffer: true },
      });
      const fixRes = buildGLResources(fixGL.gl, 20);
      try {
        await nextPaint(fixCanvas);
        renderFixtureMirror(fixGL, fixRes, fixCanvas, card, { grid: 20, material: 0 });
        const tileFrac = 0.5 + (0.5 / 20) * MIRROR_FRAC;
        const cx = Math.floor(fixCanvas.width * tileFrac);
        const cy = Math.floor(fixCanvas.height * tileFrac);
        const brightPx = new Uint8Array(4);
        fixGL.gl.readPixels(cx, cy, 1, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, brightPx);

        card.style.background = '#000000';
        await nextPaint(fixCanvas);
        renderFixtureMirror(fixGL, fixRes, fixCanvas, card, { grid: 20, material: 0 });
        const darkPx = new Uint8Array(4);
        fixGL.gl.readPixels(cx, cy, 1, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, darkPx);

        const brightLum = 0.2126 * brightPx[0] + 0.7152 * brightPx[1] + 0.0722 * brightPx[2];
        const darkLum = 0.2126 * darkPx[0] + 0.7152 * darkPx[1] + 0.0722 * darkPx[2];
        if (brightLum - darkLum < 60) {
          throw new Error(`expected >60 luma contrast; bright=${brightLum.toFixed(1)} (${brightPx.slice(0, 3)}), dark=${darkLum.toFixed(1)} (${darkPx.slice(0, 3)})`);
        }
        return `bright rgb(${brightPx.slice(0, 3).join(',')}) luma ${brightLum.toFixed(0)} vs dark rgb(${darkPx.slice(0, 3).join(',')}) luma ${darkLum.toFixed(0)}`;
      } finally {
        disposeCustomGLResources(fixGL.gl, fixRes);
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Switching materials (oak, brass, plastic) and grid counts (20, 30, 42) renders with gl.getError() === 0',
    why: 'Resizes the ping-pong state FBO across 20×20, 30×30 and 42×42 and runs every material shader preset in an isolated fixture.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { fixCanvas, card } = createMirrorCheckFixture(220, 220, '#e8e8e8');
      const fixGL = new ElementGL(fixCanvas, {
        fragment: DUMMY_FRAG,
        attributes: { alpha: false, depth: true, preserveDrawingBuffer: true },
      });
      const fixRes = buildGLResources(fixGL.gl, 20);
      try {
        await nextPaint(fixCanvas);
        const combos = [
          [0, 20],
          [1, 30],
          [2, 42],
        ];
        const summaries = [];
        for (const [mat, grid] of combos) {
          renderFixtureMirror(fixGL, fixRes, fixCanvas, card, { grid, material: mat });
          const err = fixGL.gl.getError();
          if (err !== fixGL.gl.NO_ERROR) throw new Error(`mat=${mat}, grid=${grid} gave glError=${err}`);
          const tileFrac = 0.5 + (0.5 / grid) * MIRROR_FRAC;
          const px = new Uint8Array(4);
          fixGL.gl.readPixels(Math.floor(fixCanvas.width * tileFrac), Math.floor(fixCanvas.height * tileFrac), 1, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, px);
          if (px[0] + px[1] + px[2] < 40) throw new Error(`mat=${mat}, grid=${grid} rendered dim pixel rgb(${px.slice(0, 3)})`);
          summaries.push(`${grid}×${grid}:${['oak', 'brass', 'plastic'][mat]}`);
        }
        return `${summaries.join(', ')} all rendered with gl.getError() === 0`;
      } finally {
        disposeCustomGLResources(fixGL.gl, fixRes);
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps the embedded <input> and <button> clickable (elementsFromPoint)',
    why: 'Applies the geometryUnit()-scaled DOMMatrix for the mirror square to an isolated drawable card and verifies elementsFromPoint() hits both its <input> and <button>.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 260;
      const ch = 260;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;
      fixCanvas.width = Math.round(cw * (window.devicePixelRatio || 1));
      fixCanvas.height = Math.round(ch * (window.devicePixelRatio || 1));

      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `position:absolute;left:0;top:0;width:${CARD_SIZE}px;height:${CARD_SIZE}px;background:#0b0a09;`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = 'WOOD';
      inp.setAttribute('inputmode', 'none');
      inp.style.cssText = 'position:absolute;left:60px;top:40px;width:240px;height:72px;margin:0;border:0;';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Wave';
      btn.style.cssText = 'position:absolute;left:110px;top:160px;width:140px;height:68px;margin:0;border:0;';

      card.append(inp, btn);
      fixCanvas.append(card);
      testStage().append(fixCanvas);

      try {
        const layout = buildMirrorVP(cw, ch);
        const unit = geometryUnit(fixCanvas, card, CARD_SIZE);
        const s = layout.side / CARD_SIZE;
        const m = new DOMMatrix().scale(unit, unit, 1).translate(layout.x0, layout.y0).scale(s, s, 1);
        fixCanvas.updateElementGeometry(card, { canvasTransform: m });
        card.dataset.hitTick = '1';

        const rect = fixCanvas.getBoundingClientRect();
        const inpX = rect.left + layout.x0 + 180 * s;
        const inpY = rect.top + layout.y0 + 76 * s;
        const btnX = rect.left + layout.x0 + 180 * s;
        const btnY = rect.top + layout.y0 + 194 * s;

        const inpHits = document.elementsFromPoint(inpX, inpY);
        if (!inpHits.includes(inp)) {
          throw new Error(`missed <input> at (${inpX.toFixed(1)}, ${inpY.toFixed(1)}); top=${inpHits[0]?.tagName}`);
        }
        const btnHits = document.elementsFromPoint(btnX, btnY);
        if (!btnHits.includes(btn)) {
          throw new Error(`missed <button> at (${btnX.toFixed(1)}, ${btnY.toFixed(1)}); top=${btnHits[0]?.tagName}`);
        }
        return `hit <input> and <button> via elementsFromPoint() (geometryUnit=${unit.toFixed(2)}, scale=${s.toFixed(2)})`;
      } finally {
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'wooden mirror stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !glRes || !glRes.sourceTex) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.stats.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => fallbackToPlainHTML('Canvas drew blank after live checks'),
    },
  ]),
];

runTests(checksBody, tests);
