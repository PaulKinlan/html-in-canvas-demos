import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const canvas = document.getElementById('stage-canvas');
const posterEl = document.getElementById('poster-card');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const checksBody = document.getElementById('checks-body');

// Live poster interactive controls inside <canvas>.
const titleInput = document.getElementById('poster-title');
const clicksBadge = document.getElementById('poster-clicks');
const invertBtn = document.getElementById('poster-invert');
const gridBtn = document.getElementById('poster-grid');
const scaleInput = document.getElementById('poster-scale');
const scaleOut = document.getElementById('poster-scale-out');
const posterMeta = document.getElementById('poster-meta');
const swatchBtns = Array.from(posterEl.querySelectorAll('.swatch'));

// Toolbar controls outside <canvas>.
const camBtns = Array.from(document.querySelectorAll('button[data-cam]'));
const hitBtns = Array.from(document.querySelectorAll('button[data-hit]'));
const autoOrbitBtn = document.getElementById('auto-orbit-btn');
const showHitboxChk = document.getElementById('show-hitbox');
const showRaysChk = document.getElementById('show-rays');

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- Vector & 4x4 Column-Major Matrix Math ----------------

const v3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3Add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3Scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const v3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3Cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const v3Len = (a) => Math.hypot(a[0], a[1], a[2]);
const v3Norm = (a) => {
  const l = v3Len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

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

function mat4Invert(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]);
}

// ---------------- Gallery Corner & 5-Step Staircase Geometry ----------------

const X_LEFT = -2.20;
const X_RIGHT = 3.80;
const Z_BACK = -2.20;
const Z_FRONT = 4.20;
const Y_CEIL = 3.60;

const STEPS = 5;
const STEP_H = 0.24;
const STEP_D = 0.38;
const STEP0_Z = 0.30;
const STAIR_X_MAX = 1.15;

// Fixed virtual cinema projector framing the stairs, left wall, back wall, side cheek and floor.
const POSTER_W = 360;
const POSTER_H = 256;
const PROJ_ASPECT = POSTER_W / POSTER_H;
const PROJ_FOV_Y = 34 * Math.PI / 180;
const PROJ_EYE = [1.55, 2.05, 2.75];
const PROJ_TARGET = [-0.45, 0.88, -0.62];

const PROJ_FWD = v3Norm(v3Sub(PROJ_TARGET, PROJ_EYE));
const PROJ_RIGHT = v3Norm(v3Cross(PROJ_FWD, [0, 1, 0]));
const PROJ_UP = v3Cross(PROJ_RIGHT, PROJ_FWD);
const PROJ_VIEW = mat4LookAt(PROJ_EYE, PROJ_TARGET, [0, 1, 0]);
const PROJ_MAT = mat4Perspective(PROJ_FOV_Y, PROJ_ASPECT, 0.2, 24.0);
const PROJ_VP = mat4Mul(PROJ_MAT, PROJ_VIEW);

// Sweet-spot spherical coordinates relative to PROJ_TARGET.
const _sweetOffset = v3Sub(PROJ_EYE, PROJ_TARGET);
const SWEET_DIST = v3Len(_sweetOffset);
const SWEET_PITCH = Math.asin(_sweetOffset[1] / SWEET_DIST);
const SWEET_YAW = Math.atan2(_sweetOffset[0], _sweetOffset[2]);

// Single best-fit diagonal plane along the 5 stair nosings (used in "Fixed plane" hit-box mode).
const FIXED_PLANE = (() => {
  const n = v3Norm([0, STEP_D, STEP_H]);
  const anchor = [-0.45, 0.84, -0.58];
  return { name: 'stair slope plane', n, d: v3Dot(n, anchor) };
})();

const CAMERA_PRESETS = {
  sweet: { yaw: SWEET_YAW, pitch: SWEET_PITCH, dist: SWEET_DIST },
  orbit: { yaw: SWEET_YAW - 0.64, pitch: 0.36, dist: 4.35 },
  side:  { yaw: SWEET_YAW + 0.88, pitch: 0.22, dist: 4.55 },
  top:   { yaw: SWEET_YAW - 0.42, pitch: 0.96, dist: 4.95 },
};

function buildGalleryGeometry() {
  const verts = []; // [px, py, pz, nx, ny, nz, ao, mat]
  const indices = [];
  const faces = [];

  function pushQuad(p0, p1, p2, p3, n, ao0, ao1, ao2, ao3, mat) {
    const base = verts.length / 8;
    const pts = [p0, p1, p2, p3];
    const aos = [ao0, ao1, ao2, ao3];
    for (let i = 0; i < 4; i++) {
      verts.push(pts[i][0], pts[i][1], pts[i][2], n[0], n[1], n[2], aos[i], mat);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Gallery floor (mat = 2), subdivided slightly for smooth corner AO.
  pushQuad(
    [X_LEFT, 0, Z_BACK], [X_LEFT, 0, Z_FRONT], [X_RIGHT, 0, Z_FRONT], [X_RIGHT, 0, Z_BACK],
    [0, 1, 0], 0.52, 0.88, 1.0, 0.86, 2
  );
  faces.push({
    name: 'floor', n: [0, 1, 0], d: 0, isStair: false,
    min: [X_LEFT, -0.01, Z_BACK], max: [X_RIGHT, 0.01, Z_FRONT],
  });

  // Back wall (z = Z_BACK, facing +Z, mat = 0).
  pushQuad(
    [X_LEFT, 0, Z_BACK], [X_RIGHT, 0, Z_BACK], [X_RIGHT, Y_CEIL, Z_BACK], [X_LEFT, Y_CEIL, Z_BACK],
    [0, 0, 1], 0.50, 0.72, 0.98, 0.74, 0
  );
  faces.push({
    name: 'back wall', n: [0, 0, 1], d: Z_BACK, isStair: false,
    min: [X_LEFT, 0, Z_BACK - 0.01], max: [X_RIGHT, Y_CEIL, Z_BACK + 0.01],
  });

  // Left wall (x = X_LEFT, facing +X, mat = 0).
  pushQuad(
    [X_LEFT, 0, Z_FRONT], [X_LEFT, 0, Z_BACK], [X_LEFT, Y_CEIL, Z_BACK], [X_LEFT, Y_CEIL, Z_FRONT],
    [1, 0, 0], 0.72, 0.50, 0.74, 0.98, 0
  );
  faces.push({
    name: 'left wall', n: [1, 0, 0], d: X_LEFT, isStair: false,
    min: [X_LEFT - 0.01, 0, Z_BACK], max: [X_LEFT + 0.01, Y_CEIL, Z_FRONT],
  });

  // 5 concrete steps (mat = 1): riser (+Z), tread (+Y), right side cheek (+X).
  for (let i = 0; i < STEPS; i++) {
    const y0 = i * STEP_H;
    const y1 = (i + 1) * STEP_H;
    const zFront = STEP0_Z - i * STEP_D;
    const zBack = i === STEPS - 1 ? Z_BACK : STEP0_Z - (i + 1) * STEP_D;

    // Riser facing +Z.
    pushQuad(
      [X_LEFT, y0, zFront], [STAIR_X_MAX, y0, zFront],
      [STAIR_X_MAX, y1, zFront], [X_LEFT, y1, zFront],
      [0, 0, 1], 0.50, 0.62, 0.98, 0.78, 1
    );
    faces.push({
      name: `riser ${i + 1}`, n: [0, 0, 1], d: zFront, isStair: true,
      min: [X_LEFT, y0, zFront - 0.01], max: [STAIR_X_MAX, y1, zFront + 0.01],
    });

    // Tread facing +Y.
    pushQuad(
      [X_LEFT, y1, zBack], [X_LEFT, y1, zFront],
      [STAIR_X_MAX, y1, zFront], [STAIR_X_MAX, y1, zBack],
      [0, 1, 0], 0.54, 0.80, 1.00, 0.66, 1
    );
    faces.push({
      name: i === STEPS - 1 ? 'top landing' : `tread ${i + 1}`, n: [0, 1, 0], d: y1, isStair: true,
      min: [X_LEFT, y1 - 0.01, zBack], max: [STAIR_X_MAX, y1 + 0.01, zFront],
    });

    // Right side cheek slice facing +X.
    pushQuad(
      [STAIR_X_MAX, 0, zFront], [STAIR_X_MAX, 0, zBack],
      [STAIR_X_MAX, y1, zBack], [STAIR_X_MAX, y1, zFront],
      [1, 0, 0], 0.62, 0.58, 0.94, 0.98, 1
    );
    faces.push({
      name: `side cheek ${i + 1}`, n: [1, 0, 0], d: STAIR_X_MAX, isStair: true,
      min: [STAIR_X_MAX - 0.01, 0, zBack], max: [STAIR_X_MAX + 0.01, y1, zFront],
    });
  }

  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(indices),
    faces,
  };
}

const GALLERY = buildGalleryGeometry();

// ---------------- Exact Raycasting & Plane Homography ----------------

// #region face-raycast
function raycastScene(origin, dir) {
  let best = null;
  for (const face of GALLERY.faces) {
    const denom = v3Dot(face.n, dir);
    if (denom >= -1e-6) continue; // front-facing only
    const t = (face.d - v3Dot(face.n, origin)) / denom;
    if (t <= 0.05 || (best && t >= best.t)) continue;
    const p = v3Add(origin, v3Scale(dir, t));
    if (
      p[0] >= face.min[0] - 1e-3 && p[0] <= face.max[0] + 1e-3 &&
      p[1] >= face.min[1] - 1e-3 && p[1] <= face.max[1] + 1e-3 &&
      p[2] >= face.min[2] - 1e-3 && p[2] <= face.max[2] + 1e-3
    ) {
      best = { face, t, point: p };
    }
  }
  return best;
}
// #endregion face-raycast

function projectorRayForUV(u, v) {
  const halfH = Math.tan(PROJ_FOV_Y * 0.5);
  const halfW = halfH * PROJ_ASPECT;
  const nx = 2 * u - 1;
  const ny = 1 - 2 * v;
  return v3Norm(v3Add(v3Add(PROJ_FWD, v3Scale(PROJ_RIGHT, nx * halfW)), v3Scale(PROJ_UP, ny * halfH)));
}

// #region plane-homography
/**
 * Build the exact 4x4 projective matrix mapping element CSS pixels (ex, ey, 0, 1)
 * onto plane `N . X = d` along rays from PROJ_EYE, then through `viewVP` into
 * canvas CSS pixels (0..cw, 0..ch).
 */
function buildPlaneHitMatrix(plane, viewVP, cw, ch, elemW, elemH) {
  const halfH = Math.tan(PROJ_FOV_Y * 0.5);
  const halfW = halfH * PROJ_ASPECT;
  const dx = v3Scale(PROJ_RIGHT, (2 * halfW) / elemW);
  const dy = v3Scale(PROJ_UP, (-2 * halfH) / elemH);
  const d0 = v3Add(v3Sub(PROJ_FWD, v3Scale(PROJ_RIGHT, halfW)), v3Scale(PROJ_UP, halfH));

  const n = plane.n;
  const k = plane.d - v3Dot(n, PROJ_EYE);
  if (Math.abs(k) < 1e-5) return null;

  const ax = v3Dot(n, dx);
  const ay = v3Dot(n, dy);
  const a0 = v3Dot(n, d0);

  // Homogeneous 3D point on the plane: X_hom(ex, ey) = (N.D)*PROJ_EYE + k*D, w = N.D.
  const elemToWorld = new Float32Array([
    ax * PROJ_EYE[0] + k * dx[0], ax * PROJ_EYE[1] + k * dx[1], ax * PROJ_EYE[2] + k * dx[2], ax,
    ay * PROJ_EYE[0] + k * dy[0], ay * PROJ_EYE[1] + k * dy[1], ay * PROJ_EYE[2] + k * dy[2], ay,
    n[0],                         n[1],                         n[2],                         0,
    a0 * PROJ_EYE[0] + k * d0[0], a0 * PROJ_EYE[1] + k * d0[1], a0 * PROJ_EYE[2] + k * d0[2], a0,
  ]);

  const clip = mat4Mul(viewVP, elemToWorld);
  const wCenter = clip[3] * (elemW * 0.5) + clip[7] * (elemH * 0.5) + clip[15];
  if (Math.abs(wCenter) < 1e-5) return null;

  const ndcToCss = new Float32Array([
    cw * 0.5,  0,        0, 0,
    0,        -ch * 0.5, 0, 0,
    0,         0,        1, 0,
    cw * 0.5,  ch * 0.5, 0, 1,
  ]);
  const raw = mat4Mul(ndcToCss, clip);
  // Keep homogeneous w > 0 at the card centre for Chromium's DOMMatrix hit test.
  const invW = 1 / wCenter;
  const norm = new Float32Array(16);
  for (let i = 0; i < 16; i++) norm[i] = raw[i] * invW;
  return new DOMMatrix(Array.from(norm));
}
// #endregion plane-homography

/** Project a world point to canvas CSS pixels (x, y) using `vp`. */
function worldToCss(vp, p, cw, ch) {
  const c = mat4MulVec4(vp, p[0], p[1], p[2], 1);
  if (c[3] <= 1e-5) return null;
  return [
    (c[0] / c[3] * 0.5 + 0.5) * cw,
    (0.5 - c[1] / c[3] * 0.5) * ch,
  ];
}

/** Intersect projector ray (u, v) with a single plane `N . X = d`. */
function intersectProjectorPlane(u, v, plane) {
  const dir = projectorRayForUV(u, v);
  const denom = v3Dot(plane.n, dir);
  if (Math.abs(denom) < 1e-6) return null;
  const t = (plane.d - v3Dot(plane.n, PROJ_EYE)) / denom;
  if (t <= 0.1 || t > 18) return null;
  return v3Add(PROJ_EYE, v3Scale(dir, t));
}

// Precompute 18 sample points across the poster UVs hitting risers, treads, left wall, back wall and floor.
const PROBE_SAMPLES = (() => {
  const out = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      const u = 0.1 + c * 0.2;
      const v = 0.12 + r * 0.25;
      const hit = raycastScene(PROJ_EYE, projectorRayForUV(u, v));
      if (hit) out.push({ u, v, point: hit.point, face: hit.face.name, depth: hit.t });
    }
  }
  return out;
})();

// Precompute 4 projector frustum corner hits on the actual 3D gallery for the light-cone rays.
const FRUSTUM_CORNER_HITS = [
  [0, 0], [1, 0], [1, 1], [0, 1],
].map(([u, v]) => {
  const dir = projectorRayForUV(u, v);
  const hit = raycastScene(PROJ_EYE, dir);
  return hit ? hit.point : v3Add(PROJ_EYE, v3Scale(dir, 5.0));
});

function measureHitBoxDivergence(plane, viewVP, cw, ch) {
  const mat = buildPlaneHitMatrix(plane, viewVP, cw, ch, POSTER_W, POSTER_H);
  if (!mat) return { maxPx: 0, meanPx: 0, worstFace: 'none', count: 0 };
  const m = mat.toFloat32Array();
  let maxPx = 0, sumPx = 0, count = 0, worstFace = '';
  for (const s of PROBE_SAMPLES) {
    const actual = worldToCss(viewVP, s.point, cw, ch);
    if (!actual) continue;
    const ex = s.u * POSTER_W;
    const ey = s.v * POSTER_H;
    const hw = m[3] * ex + m[7] * ey + m[15];
    if (Math.abs(hw) < 1e-5) continue;
    const hx = (m[0] * ex + m[4] * ey + m[12]) / hw;
    const hy = (m[1] * ex + m[5] * ey + m[13]) / hw;
    const err = Math.hypot(actual[0] - hx, actual[1] - hy);
    sumPx += err;
    count++;
    if (err > maxPx) { maxPx = err; worstFace = s.face; }
  }
  return { maxPx, meanPx: count ? sumPx / count : 0, worstFace, count };
}

// ---------------- WebGL 2 Shaders ----------------

const DUMMY_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = vec4(0.0); }`;

// #region projector-shader
const SCENE_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in float aAO;
layout(location = 3) in float aMat;

uniform mat4 uVP;

out vec3 vWorld;
out vec3 vNorm;
out float vAO;
out float vMat;

void main() {
  vWorld = aPos;
  vNorm = aNorm;
  vAO = aAO;
  vMat = aMat;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const SCENE_FRAG = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNorm;
in float vAO;
in float vMat;

uniform mat4 uProjVP;
uniform vec3 uProjPos;
uniform sampler2D uPosterTex;
uniform float uHasTex;
uniform float uSweetness;

out vec4 outColor;

void main() {
  vec3 N = normalize(vNorm);
  vec3 L1 = normalize(vec3(0.55, 0.85, 0.48));
  vec3 L2 = normalize(vec3(-0.60, 0.35, 0.72));

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0);
  float hemi = 0.5 + 0.5 * N.y;

  // Sunlit museum plaster walls, poured concrete stairs, pale gallery floor.
  vec3 baseCol = vec3(0.89, 0.86, 0.81); // plaster walls
  if (vMat > 1.5) {
    baseCol = vec3(0.76, 0.73, 0.68); // gallery floor
  } else if (vMat > 0.5) {
    baseCol = vec3(0.82, 0.79, 0.74); // concrete stairs
  }

  // Subtle architectural formwork seams so walls and floor keep depth cues.
  vec2 seamCoord = abs(N.y) > 0.5 ? vWorld.xz : (abs(N.x) > 0.5 ? vWorld.zy : vWorld.xy);
  vec2 g = abs(fract(seamCoord * 0.9 + 0.5) - 0.5) / max(fwidth(seamCoord * 0.9), vec2(0.001));
  float seam = 1.0 - 0.045 * (1.0 - smoothstep(0.0, 1.5, min(g.x, g.y)));

  // Fine plaster/concrete grain.
  float grain = fract(sin(dot(floor(vWorld.xyz * 60.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  baseCol *= seam * (0.985 + 0.03 * grain);

  float lit = (0.34 + 0.16 * hemi + 0.52 * diff1 + 0.14 * diff2) * mix(0.45, 1.0, vAO);
  vec3 color = baseCol * lit;

  // Projective texture lookup from the fixed virtual cinema projector.
  vec4 projClip = uProjVP * vec4(vWorld, 1.0);
  if (uHasTex > 0.5 && projClip.w > 0.001) {
    vec2 pNdc = projClip.xy / projClip.w;
    vec2 uv = vec2(pNdc.x * 0.5 + 0.5, 0.5 - pNdc.y * 0.5);
    vec3 toProj = normalize(uProjPos - vWorld);
    float facing = dot(N, toProj);

    if (facing > 0.02 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      vec2 fw = max(fwidth(uv), vec2(0.0015));
      float edgeX = smoothstep(0.0, fw.x * 1.2, uv.x) * smoothstep(0.0, fw.x * 1.2, 1.0 - uv.x);
      float edgeY = smoothstep(0.0, fw.y * 1.2, uv.y) * smoothstep(0.0, fw.y * 1.2, 1.0 - uv.y);
      float mask = edgeX * edgeY * smoothstep(0.02, 0.12, facing);

      vec4 tex = texture(uPosterTex, uv);
      // Keep faint concrete step shading so the 3D geometry reads through the projection,
      // while snapping clean and vivid at the sweet spot.
      float projShade = mix(0.80 + 0.24 * lit, 0.94 + 0.07 * vAO, uSweetness);
      vec3 projected = tex.rgb * projShade;
      color = mix(color, projected, mask * tex.a);
    }
  }

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
// #endregion projector-shader

const LINE_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const LINE_FRAG = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

// ---------------- Application State ----------------

const state = {
  yaw: SWEET_YAW,
  pitch: SWEET_PITCH,
  dist: SWEET_DIST,
  animFrom: null,
  animTo: null,
  animStart: 0,
  animDur: 450,
  autoOrbit: false,
  autoPhase: 0,
  hitMode: 'fixed', // 'fixed' | 'track'
  activePlane: FIXED_PLANE,
  showHitbox: true,
  showRays: true,
  clicks: 0,
  onScreen: true,
  dirtyPoster: true,
  dirtyRender: true,
  dragging: false,
  dragId: null,
  dragLast: null,
  mode: 'init', // 'webgl' | '2d' | 'plain'
  lastVP: null,
  lastEye: PROJ_EYE,
  lastProj: null,
  lastCw: 1,
  lastCh: 1,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: null,
  stats: { paints: 0, uploads: 0, texW: 0, texH: 0 },
};

let stage = null;
let glRes = null;
let ctx2d = null;
let rafId = 0;
let lastFrameTime = 0;

// ---------------- WebGL 2 Resource Setup (Single ElementGL Context) ----------------

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

function buildGLResources(gl) {
  const sceneProg = linkProgram(gl, SCENE_VERT, SCENE_FRAG);
  const lineProg = linkProgram(gl, LINE_VERT, LINE_FRAG);

  // Gallery + staircase VAO.
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ebo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, GALLERY.vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, GALLERY.indices, gl.STATIC_DRAW);
  const stride = 8 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 7 * 4);
  gl.bindVertexArray(null);

  // Dynamic line buffer for hit-box wireframe, projector body and light rays.
  const lineVao = gl.createVertexArray();
  const lineVbo = gl.createBuffer();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 4096, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    sceneProg,
    lineProg,
    uScene: {
      uVP: gl.getUniformLocation(sceneProg, 'uVP'),
      uProjVP: gl.getUniformLocation(sceneProg, 'uProjVP'),
      uProjPos: gl.getUniformLocation(sceneProg, 'uProjPos'),
      uPosterTex: gl.getUniformLocation(sceneProg, 'uPosterTex'),
      uHasTex: gl.getUniformLocation(sceneProg, 'uHasTex'),
      uSweetness: gl.getUniformLocation(sceneProg, 'uSweetness'),
    },
    uLine: {
      uVP: gl.getUniformLocation(lineProg, 'uVP'),
      uColor: gl.getUniformLocation(lineProg, 'uColor'),
    },
    vao,
    vbo,
    ebo,
    indexCount: GALLERY.indices.length,
    lineVao,
    lineVbo,
    posterTex: null,
    texW: 0,
    texH: 0,
    aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
  };
}

// #region gl-upload
function uploadPosterTexture() {
  if (!stage || stage.lost || !glRes) return false;
  const gl = stage.gl;
  let size;
  try {
    size = canvas.getElementImageDefaultSize
      ? canvas.getElementImageDefaultSize(posterEl)
      : { width: posterEl.offsetWidth * (window.devicePixelRatio || 1), height: posterEl.offsetHeight * (window.devicePixelRatio || 1) };
  } catch {
    return false;
  }
  const w = Math.max(1, Math.ceil(size.width));
  const h = Math.max(1, Math.ceil(size.height));
  if (!glRes.posterTex || glRes.texW !== w || glRes.texH !== h) {
    if (glRes.posterTex) gl.deleteTexture(glRes.posterTex);
    glRes.posterTex = gl.createTexture();
    glRes.texW = w;
    glRes.texH = h;
    gl.bindTexture(gl.TEXTURE_2D, glRes.posterTex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (glRes.aniso) {
      const maxA = gl.getParameter(glRes.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, glRes.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxA));
    }
  } else {
    gl.bindTexture(gl.TEXTURE_2D, glRes.posterTex);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, posterEl);
  gl.generateMipmap(gl.TEXTURE_2D);
  state.dirtyPoster = false;
  state.stats.uploads++;
  state.stats.texW = w;
  state.stats.texH = h;
  return true;
}
// #endregion gl-upload

// ---------------- Camera, Buffer Sizing & Hit-Box Sync ----------------

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

function getViewerCamera(cw, ch) {
  const isSweet =
    Math.abs(state.yaw - SWEET_YAW) < 1e-5 &&
    Math.abs(state.pitch - SWEET_PITCH) < 1e-5 &&
    Math.abs(state.dist - SWEET_DIST) < 1e-5;
  const eye = isSweet
    ? PROJ_EYE
    : [
        PROJ_TARGET[0] + state.dist * Math.cos(state.pitch) * Math.sin(state.yaw),
        PROJ_TARGET[1] + state.dist * Math.sin(state.pitch),
        PROJ_TARGET[2] + state.dist * Math.cos(state.pitch) * Math.cos(state.yaw),
      ];
  // Fit the entire projector frustum comfortably inside both 16:10 desktop and 4:5 portrait phone viewports.
  const viewAspect = cw / ch;
  const fProj = 1 / Math.tan(PROJ_FOV_Y * 0.5);
  const fView = Math.min(0.84 * fProj, 0.84 * fProj * (viewAspect / PROJ_ASPECT));
  const viewFovY = 2 * Math.atan(1 / fView);
  const proj = mat4Perspective(viewFovY, viewAspect, 0.15, 28.0);
  const view = isSweet ? PROJ_VIEW : mat4LookAt(eye, PROJ_TARGET, [0, 1, 0]);
  const vp = mat4Mul(proj, view);

  const curDir = v3Norm(v3Sub(eye, PROJ_TARGET));
  const sweetDir = v3Norm(v3Sub(PROJ_EYE, PROJ_TARGET));
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, v3Dot(curDir, sweetDir)))) * 180 / Math.PI;
  return { eye, view, proj, vp, angleDeg, isSweet };
}

function cachedGeometryUnit() {
  const w = posterEl.offsetWidth || POSTER_W;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${w}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, posterEl, w);
    state.unitCache.key = key;
    state.lastGeoKey = null;
  }
  return state.unitCache.unit;
}

function syncHitGeometry(vp, cw, ch) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || state.mode !== 'webgl') return;
  const elemW = posterEl.offsetWidth || POSTER_W;
  const elemH = posterEl.offsetHeight || POSTER_H;
  const cssMat = buildPlaneHitMatrix(state.activePlane, vp, cw, ch, elemW, elemH);
  posterEl.inert = !cssMat;
  const unit = cachedGeometryUnit();
  const target = cssMat
    ? new DOMMatrix().scale(unit, unit, 1).multiply(cssMat)
    : OFFSTAGE;
  if (!target) return;
  const vals = target.toFloat32Array();
  if (state.lastGeoKey && vals.every((v, i) => Math.abs(v - state.lastGeoKey[i]) < 1e-4)) return;
  state.lastGeoKey = vals;
  canvas.updateElementGeometry(posterEl, { canvasTransform: target });
  posterEl.dataset.hitTick = posterEl.dataset.hitTick === '1' ? '0' : '1';
}

// ---------------- Overlay Line Helpers ----------------

function drawLineList(gl, vp, pointsFloat32, color) {
  if (!pointsFloat32.length) return;
  gl.useProgram(glRes.lineProg);
  gl.uniformMatrix4fv(glRes.uLine.uVP, false, vp);
  gl.uniform4fv(glRes.uLine.uColor, color);
  gl.bindVertexArray(glRes.lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, glRes.lineVbo);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, pointsFloat32);
  gl.drawArrays(gl.LINES, 0, pointsFloat32.length / 3);
  gl.bindVertexArray(null);
}

function buildPlaneWireframeSegments(plane) {
  // Sample the 4 outer edges + an internal 3x2 grid on the active hit-box plane.
  const segs = [];
  const pushEdge = (u0, v0, u1, v1) => {
    const a = intersectProjectorPlane(u0, v0, plane);
    const b = intersectProjectorPlane(u1, v1, plane);
    if (!a || !b) return;
    // Slight normal offset to prevent z-fighting with coincident gallery faces.
    const eps = 0.008;
    segs.push(
      a[0] + plane.n[0] * eps, a[1] + plane.n[1] * eps, a[2] + plane.n[2] * eps,
      b[0] + plane.n[0] * eps, b[1] + plane.n[1] * eps, b[2] + plane.n[2] * eps,
    );
  };
  // Outer border (subdivided for clean clipping).
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    pushEdge(t0, 0, t1, 0);
    pushEdge(t0, 1, t1, 1);
    pushEdge(0, t0, 0, t1);
    pushEdge(1, t0, 1, t1);
  }
  // Subtle interior crosshairs so the flat plane angle is unmistakable.
  pushEdge(0.5, 0, 0.5, 1);
  pushEdge(0, 0.5, 1, 0.5);
  return new Float32Array(segs);
}

function buildProjectorBoxSegments() {
  // Small wireframe cinema projector body sitting at PROJ_EYE looking along PROJ_FWD.
  const segs = [];
  const pt = (r, u, f) => [
    PROJ_EYE[0] + r * PROJ_RIGHT[0] + u * PROJ_UP[0] + f * PROJ_FWD[0],
    PROJ_EYE[1] + r * PROJ_RIGHT[1] + u * PROJ_UP[1] + f * PROJ_FWD[1],
    PROJ_EYE[2] + r * PROJ_RIGHT[2] + u * PROJ_UP[2] + f * PROJ_FWD[2],
  ];
  const w = 0.14, h = 0.09, back = -0.26, front = 0.0;
  const c = [
    pt(-w, -h, back), pt(w, -h, back), pt(w, h, back), pt(-w, h, back),
    pt(-w, -h, front), pt(w, -h, front), pt(w, h, front), pt(-w, h, front),
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [a, b] of edges) segs.push(...c[a], ...c[b]);
  // Lens cone extending slightly forward.
  const l0 = pt(-0.045, -0.035, 0.08), l1 = pt(0.045, -0.035, 0.08);
  const l2 = pt(0.045, 0.035, 0.08), l3 = pt(-0.045, 0.035, 0.08);
  const lens = [l0, l1, l2, l3];
  for (let i = 0; i < 4; i++) {
    segs.push(...lens[i], ...lens[(i + 1) % 4]);
    segs.push(...c[4 + i], ...lens[i]);
  }
  return new Float32Array(segs);
}

const PROJECTOR_BOX_SEGS = buildProjectorBoxSegments();

const FRUSTUM_RAY_SEGS = (() => {
  const segs = [];
  for (const p of FRUSTUM_CORNER_HITS) {
    segs.push(PROJ_EYE[0], PROJ_EYE[1], PROJ_EYE[2], p[0], p[1], p[2]);
  }
  return new Float32Array(segs);
})();

// ---------------- Render Passes ----------------

function renderWebGL() {
  if (!stage || stage.lost || !glRes) return;
  const gl = stage.gl;
  const { cw, ch, w, h } = sizeCanvasBuffer();
  state.lastCw = cw;
  state.lastCh = ch;

  if (state.dirtyPoster || !glRes.posterTex) {
    uploadPosterTexture();
  }

  const cam = getViewerCamera(cw, ch);
  state.lastVP = cam.vp;
  state.lastEye = cam.eye;
  state.lastProj = cam.proj;

  const sweetness = Math.max(0, 1 - cam.angleDeg / 8.0);

  gl.viewport(0, 0, w, h);
  gl.clearColor(0.86, 0.84, 0.80, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // 1. Gallery walls, floor and 5-step concrete staircase with live projective HTML texture.
  gl.useProgram(glRes.sceneProg);
  gl.uniformMatrix4fv(glRes.uScene.uVP, false, cam.vp);
  gl.uniformMatrix4fv(glRes.uScene.uProjVP, false, PROJ_VP);
  gl.uniform3fv(glRes.uScene.uProjPos, PROJ_EYE);
  gl.uniform1i(glRes.uScene.uPosterTex, 0);
  gl.uniform1f(glRes.uScene.uHasTex, glRes.posterTex ? 1.0 : 0.0);
  gl.uniform1f(glRes.uScene.uSweetness, sweetness);
  if (glRes.posterTex) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glRes.posterTex);
  }
  gl.bindVertexArray(glRes.vao);
  gl.drawElements(gl.TRIANGLES, glRes.indexCount, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);

  // 2. Projector body and frustum rays (visible when orbited away from the sweet spot).
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (state.showRays && cam.angleDeg > 2.5) {
    const fade = Math.min(1, (cam.angleDeg - 2.5) / 8.0);
    drawLineList(gl, cam.vp, FRUSTUM_RAY_SEGS, [0.85, 0.28, 0.12, 0.36 * fade]);
    drawLineList(gl, cam.vp, PROJECTOR_BOX_SEGS, [0.12, 0.12, 0.11, 0.90 * fade]);
  }

  // 3. Single updateElementGeometry() hit-box wireframe plane.
  if (state.showHitbox) {
    const wire = buildPlaneWireframeSegments(state.activePlane);
    gl.disable(gl.DEPTH_TEST);
    const wireCol = cam.angleDeg < 0.8
      ? [0.06, 0.62, 0.68, 0.82]
      : state.hitMode === 'track'
        ? [0.06, 0.65, 0.48, 0.92]
        : [0.92, 0.32, 0.08, 0.92];
    drawLineList(gl, cam.vp, wire, wireCol);
    gl.enable(gl.DEPTH_TEST);
  }

  // 4. Keep Chromium's hit box synced to the active plane.
  syncHitGeometry(cam.vp, cw, ch);

  // 5. Update HUD readout.
  const div = measureHitBoxDivergence(state.activePlane, cam.vp, cw, ch);
  if (cam.angleDeg < 0.25) {
    hudEl.textContent = `Sweet spot (0.0°) · Hit-box max divergence: ${div.maxPx.toFixed(1)} px · ${glRes.texW}×${glRes.texH} tex`;
  } else {
    hudEl.textContent = `Orbit ${cam.angleDeg.toFixed(1)}° · Hit box on ${state.activePlane.name} · max divergence: ${div.maxPx.toFixed(1)} px (${div.worstFace})`;
  }
}

function render2DFallback() {
  if (!ctx2d) return;
  const { cw, ch, w, h } = sizeCanvasBuffer();
  const dpr = w / cw;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#ddd7cd';
  ctx2d.fillRect(0, 0, cw, ch);

  const scale = Math.min((cw - 32) / POSTER_W, (ch - 32) / POSTER_H, 1.35);
  const dw = POSTER_W * scale;
  const dh = POSTER_H * scale;
  const x = (cw - dw) * 0.5;
  const y = (ch - dh) * 0.5;
  try {
    ctx2d.drawElementImage(posterEl, x, y, dw, dh);
  } catch {}
  hudEl.textContent = '2D fallback (WebGL 2 texElementSubImage2D unavailable)';
}

function fallbackToPlainHTML(reason) {
  state.mode = 'plain';
  canvas.hidden = true;
  posterEl.inert = false;
  if (posterEl.parentElement !== plainHost) plainHost.append(posterEl);
  hudEl.textContent = reason;
  routeNoteEl.textContent = `${reason}. Showing the live poster as plain HTML.`;
}

// ---------------- Animation Loop (On-Demand + Off-Screen Pause) ----------------

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

  let keepGoing = false;

  if (state.animTo) {
    const t = Math.min(1, (now - state.animStart) / state.animDur);
    const e = 1 - Math.pow(1 - t, 3);
    state.yaw = state.animFrom.yaw + (state.animTo.yaw - state.animFrom.yaw) * e;
    state.pitch = state.animFrom.pitch + (state.animTo.pitch - state.animFrom.pitch) * e;
    state.dist = state.animFrom.dist + (state.animTo.dist - state.animFrom.dist) * e;
    state.dirtyRender = true;
    if (t >= 1) {
      state.yaw = state.animTo.yaw;
      state.pitch = state.animTo.pitch;
      state.dist = state.animTo.dist;
      state.animTo = null;
      state.animFrom = null;
    } else {
      keepGoing = true;
    }
  } else if (state.autoOrbit && !state.dragging) {
    state.autoPhase += dt * 0.55;
    // Pause gently at the sweet spot each cycle so the flat snap is clear.
    const s = Math.sin(state.autoPhase);
    const hold = Math.abs(s) < 0.16 ? 0 : Math.sign(s) * ((Math.abs(s) - 0.16) / 0.84);
    state.yaw = SWEET_YAW - hold * 0.72;
    state.pitch = SWEET_PITCH + Math.abs(hold) * 0.24;
    state.dist = SWEET_DIST + Math.abs(hold) * 0.35;
    state.dirtyRender = true;
    keepGoing = true;
  }

  if (state.dirtyRender) {
    state.dirtyRender = false;
    if (state.mode === 'webgl') renderWebGL();
    else if (state.mode === '2d') render2DFallback();
  }

  if (keepGoing) {
    rafId = requestAnimationFrame(tick);
  }
}

// ---------------- Pointer Orbit & Per-Face Raycast Tracking ----------------

function rayFromClientPoint(clientX, clientY) {
  if (!state.lastVP) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
  const invVP = mat4Invert(state.lastVP);
  if (!invVP) return null;
  const near = mat4MulVec4(invVP, ndcX, ndcY, -1, 1);
  const far = mat4MulVec4(invVP, ndcX, ndcY, 1, 1);
  if (Math.abs(near[3]) < 1e-6 || Math.abs(far[3]) < 1e-6) return null;
  const pNear = [near[0] / near[3], near[1] / near[3], near[2] / near[3]];
  const pFar = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
  return { origin: pNear, dir: v3Norm(v3Sub(pFar, pNear)) };
}

function updateTrackedPlane(clientX, clientY) {
  if (state.hitMode !== 'track' || state.mode !== 'webgl') return;
  const ray = rayFromClientPoint(clientX, clientY);
  if (!ray) return;
  const hit = raycastScene(ray.origin, ray.dir);
  if (hit && hit.face !== state.activePlane) {
    state.activePlane = hit.face;
    syncHitGeometry(state.lastVP, state.lastCw, state.lastCh);
    requestRender();
  }
}

function isInteractivePosterControl(target) {
  return target instanceof Element && posterEl.contains(target) &&
    !!target.closest('input, button, select, textarea, label');
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'webgl') return;
  updateTrackedPlane(e.clientX, e.clientY);
  if (isInteractivePosterControl(e.target)) return;
  state.autoOrbit = false;
  autoOrbitBtn.setAttribute('aria-pressed', 'false');
  state.animTo = null;
  state.dragging = true;
  state.dragId = e.pointerId;
  state.dragLast = { x: e.clientX, y: e.clientY };
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  setCamPresetPressed(null);
});

canvas.addEventListener('pointermove', (e) => {
  if (state.mode !== 'webgl') return;
  if (state.dragging && e.pointerId === state.dragId) {
    const dx = e.clientX - state.dragLast.x;
    const dy = e.clientY - state.dragLast.y;
    state.dragLast = { x: e.clientX, y: e.clientY };
    state.yaw -= dx * 0.0075;
    state.pitch = Math.max(0.08, Math.min(1.22, state.pitch + dy * 0.0065));
    requestRender();
    return;
  }
  updateTrackedPlane(e.clientX, e.clientY);
});

function stopDrag(e) {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  state.dragging = false;
  state.dragId = null;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
canvas.addEventListener('pointerup', stopDrag);
canvas.addEventListener('pointercancel', stopDrag);

canvas.addEventListener('dblclick', (e) => {
  if (isInteractivePosterControl(e.target)) return;
  animateToPreset('sweet');
});

// ---------------- Poster DOM Interactions ----------------

function bumpClicks(label) {
  state.clicks++;
  clicksBadge.textContent = `${state.clicks} ${state.clicks === 1 ? 'click' : 'clicks'}`;
  posterMeta.textContent = label;
  canvas.requestPaint?.();
}

for (const btn of swatchBtns) {
  btn.addEventListener('click', () => {
    for (const b of swatchBtns) b.setAttribute('aria-pressed', String(b === btn));
    posterEl.style.setProperty('--poster-accent', btn.dataset.accent);
    posterEl.style.setProperty('--poster-accent-ink', btn.dataset.ink);
    bumpClicks(`accent: ${btn.getAttribute('aria-label')}`);
  });
}

invertBtn.addEventListener('click', () => {
  const on = posterEl.classList.toggle('inverted');
  invertBtn.setAttribute('aria-pressed', String(on));
  bumpClicks(on ? 'theme: dark ink' : 'theme: gallery paper');
});

gridBtn.addEventListener('click', () => {
  const on = posterEl.classList.toggle('with-grid');
  gridBtn.setAttribute('aria-pressed', String(on));
  bumpClicks(on ? 'grid: on' : 'grid: off');
});

scaleInput.addEventListener('input', () => {
  const px = `${scaleInput.value}px`;
  posterEl.style.setProperty('--headline-size', px);
  scaleOut.textContent = px;
  canvas.requestPaint?.();
});

titleInput.addEventListener('input', () => {
  canvas.requestPaint?.();
});

// ---------------- Toolbar Controls ----------------

function setCamPresetPressed(key) {
  for (const b of camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === key));
}

function animateToPreset(key) {
  const target = CAMERA_PRESETS[key];
  if (!target) return;
  state.autoOrbit = false;
  autoOrbitBtn.setAttribute('aria-pressed', 'false');
  setCamPresetPressed(key);
  if (REDUCED_MOTION) {
    state.yaw = target.yaw;
    state.pitch = target.pitch;
    state.dist = target.dist;
    state.animTo = null;
    requestRender();
    return;
  }
  state.animFrom = { yaw: state.yaw, pitch: state.pitch, dist: state.dist };
  state.animTo = { ...target };
  state.animStart = performance.now();
  requestRender();
}

for (const btn of camBtns) {
  btn.addEventListener('click', () => animateToPreset(btn.dataset.cam));
}

autoOrbitBtn.addEventListener('click', () => {
  state.autoOrbit = !state.autoOrbit;
  autoOrbitBtn.setAttribute('aria-pressed', String(state.autoOrbit));
  state.animTo = null;
  if (state.autoOrbit) {
    setCamPresetPressed(null);
    lastFrameTime = performance.now();
    requestRender();
  }
});

for (const btn of hitBtns) {
  btn.addEventListener('click', () => {
    state.hitMode = btn.dataset.hit;
    for (const b of hitBtns) b.setAttribute('aria-pressed', String(b === btn));
    if (state.hitMode === 'fixed') state.activePlane = FIXED_PLANE;
    state.lastGeoKey = null;
    requestRender();
  });
}

showHitboxChk.addEventListener('change', () => {
  state.showHitbox = showHitboxChk.checked;
  requestRender();
});

showRaysChk.addEventListener('change', () => {
  state.showRays = showRaysChk.checked;
  requestRender();
});

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
          if (posterEl.parentElement !== canvas) canvas.append(posterEl);
          canvas.hidden = false;
          glRes = buildGLResources(stage.gl);
          state.mode = 'webgl';
          state.dirtyPoster = true;
          state.lastGeoKey = null;
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context, texElementSubImage2D + updateElementGeometry).';
          canvas.requestPaint?.();
          requestRender();
        },
      });
      glRes = buildGLResources(stage.gl);
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
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; drawn with 2D drawElementImage().';
    } else {
      fallbackToPlainHTML('Canvas context unavailable');
      return;
    }
  }

  canvas.addEventListener('paint', () => {
    state.stats.paints++;
    state.dirtyPoster = true;
    if (state.mode === 'webgl') {
      uploadPosterTexture();
      renderWebGL();
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

const CHECK_PROJ_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

const tests = [
  {
    name: 'texElementSubImage2D() uploads live HTML into a projective texture',
    why: 'Builds an isolated drawable canvas fixture on one ElementGL context, uploads a #d2491f HTML swatch via texElementSubImage2D(), draws it and reads one centre pixel.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = 'width:120px;height:90px;display:block;';
      const swatch = document.createElement('div');
      swatch.setAttribute('drawable', '');
      swatch.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:90px;background:#d2491f;color:#fff;font:700 14px system-ui;';
      swatch.textContent = 'PROJ';
      fixCanvas.append(swatch);
      testStage().append(fixCanvas);

      const fixGL = new ElementGL(fixCanvas, {
        fragment: CHECK_PROJ_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      try {
        await nextPaint(fixCanvas);
        const tex = fixGL.upload(swatch);
        if (!tex || !tex.w || !tex.h) throw new Error('upload returned empty texture');
        fixGL.begin([0, 0, 0, 1]);
        const mat = ElementGL.rect(fixCanvas, 0, 0, 120, 90);
        fixGL.quad(swatch, mat);
        const px = new Uint8Array(4);
        const cx = Math.floor(fixCanvas.width * 0.5);
        const cy = Math.floor(fixCanvas.height * 0.5);
        fixGL.gl.readPixels(cx, cy, 1, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, px);
        if (px[0] < 160 || px[1] > 120 || px[2] > 80) {
          throw new Error(`unexpected centre pixel rgba(${px.join(',')})`);
        }
        return `uploaded ${tex.w}×${tex.h} texture; centre pixel rgba(${px.join(',')})`;
      } finally {
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Sweet-spot view cancels depth across all 5 stair treads, risers and walls',
    why: 'Projects 3D points across risers, treads, left wall, back wall and floor (depths 2.8 m to 5.6 m) and verifies every face snaps onto the same flat screen rectangle at the sweet spot.',
    run: async () => {
      const cw = 640, ch = 400;
      const aspect = cw / ch;
      const fProj = 1 / Math.tan(PROJ_FOV_Y * 0.5);
      const fView = Math.min(0.84 * fProj, 0.84 * fProj * (aspect / PROJ_ASPECT));
      const viewProj = mat4Perspective(2 * Math.atan(1 / fView), aspect, 0.15, 28.0);
      const sweetVP = mat4Mul(viewProj, PROJ_VIEW);
      const div = measureHitBoxDivergence(FIXED_PLANE, sweetVP, cw, ch);
      const depths = PROBE_SAMPLES.map((s) => s.depth);
      const faces = new Set(PROBE_SAMPLES.map((s) => s.face));
      if (div.count < 10) throw new Error(`too few probe hits (${div.count})`);
      if (div.maxPx > 1e-3) throw new Error(`max error ${div.maxPx.toFixed(4)} px exceeds 0.001 px`);
      return `max error ${div.maxPx.toExponential(2)} px across ${div.count} points on ${faces.size} distinct faces (depth ${Math.min(...depths).toFixed(2)} m to ${Math.max(...depths).toFixed(2)} m)`;
    },
  },
  {
    name: 'updateElementGeometry() aligns button hit testing at the sweet spot',
    why: 'Applies the sweet-spot DOMMatrix from buildPlaneHitMatrix() (scaled by geometryUnit()) to an isolated fixture canvas and verifies elementsFromPoint() hits the live button.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 260, ch = 180;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;
      fixCanvas.width = Math.round(cw * (window.devicePixelRatio || 1));
      fixCanvas.height = Math.round(ch * (window.devicePixelRatio || 1));

      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `position:absolute;left:0;top:0;width:${POSTER_W}px;height:${POSTER_H}px;background:#faf7f0;`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Target';
      btn.style.cssText = 'position:absolute;left:120px;top:90px;width:120px;height:76px;';
      card.append(btn);
      fixCanvas.append(card);
      testStage().append(fixCanvas);

      try {
        const aspect = cw / ch;
        const fProj = 1 / Math.tan(PROJ_FOV_Y * 0.5);
        const fView = Math.min(0.84 * fProj, 0.84 * fProj * (aspect / PROJ_ASPECT));
        const sweetVP = mat4Mul(mat4Perspective(2 * Math.atan(1 / fView), aspect, 0.15, 28.0), PROJ_VIEW);
        const cssMat = buildPlaneHitMatrix(FIXED_PLANE, sweetVP, cw, ch, POSTER_W, POSTER_H);
        if (!cssMat) throw new Error('buildPlaneHitMatrix() returned null');
        const unit = geometryUnit(fixCanvas, card, POSTER_W);
        const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
        fixCanvas.updateElementGeometry(card, { canvasTransform: scaled });
        card.dataset.hitTick = '1';

        // Project the button centre (180, 128) through cssMat into canvas CSS pixels.
        const m = cssMat.toFloat32Array();
        const bx = 180, by = 128;
        const bw = m[3] * bx + m[7] * by + m[15];
        const sx = (m[0] * bx + m[4] * by + m[12]) / bw;
        const sy = (m[1] * bx + m[5] * by + m[13]) / bw;
        const rect = fixCanvas.getBoundingClientRect();
        const hitList = document.elementsFromPoint(rect.left + sx, rect.top + sy);
        if (!hitList.includes(btn)) {
          throw new Error(`elementsFromPoint(${(rect.left + sx).toFixed(1)}, ${(rect.top + sy).toFixed(1)}) missed button; top=${hitList[0]?.tagName}`);
        }
        return `hit <button> at canvas (${sx.toFixed(1)}, ${sy.toFixed(1)}) CSS px (geometryUnit=${unit.toFixed(2)})`;
      } finally {
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Multi-plane divergence at 35° orbit (single-homography limit)',
    why: 'Measures how far the single fixed-plane updateElementGeometry() matrix drifts from the actual stair treads, risers and walls at 35° orbit, and verifies per-face plane tracking recovers 0.00 px at the raycast face.',
    run: async () => {
      const cw = 640, ch = 400;
      const preset = CAMERA_PRESETS.orbit;
      const eye = [
        PROJ_TARGET[0] + preset.dist * Math.cos(preset.pitch) * Math.sin(preset.yaw),
        PROJ_TARGET[1] + preset.dist * Math.sin(preset.pitch),
        PROJ_TARGET[2] + preset.dist * Math.cos(preset.pitch) * Math.cos(preset.yaw),
      ];
      const aspect = cw / ch;
      const fProj = 1 / Math.tan(PROJ_FOV_Y * 0.5);
      const fView = Math.min(0.84 * fProj, 0.84 * fProj * (aspect / PROJ_ASPECT));
      const orbitVP = mat4Mul(
        mat4Perspective(2 * Math.atan(1 / fView), aspect, 0.15, 28.0),
        mat4LookAt(eye, PROJ_TARGET, [0, 1, 0])
      );
      const div = measureHitBoxDivergence(FIXED_PLANE, orbitVP, cw, ch);
      if (div.maxPx < 10) {
        throw new Error(`expected >10 px single-plane divergence off-axis, measured ${div.maxPx.toFixed(1)} px`);
      }
      // Verify per-face homography on the worst-diverging face drops its own error to ~0 px.
      const worstSample = PROBE_SAMPLES.find((s) => s.face === div.worstFace);
      const worstFaceObj = GALLERY.faces.find((f) => f.name === div.worstFace);
      const faceMat = buildPlaneHitMatrix(worstFaceObj, orbitVP, cw, ch, POSTER_W, POSTER_H);
      const m = faceMat.toFloat32Array();
      const ex = worstSample.u * POSTER_W, ey = worstSample.v * POSTER_H;
      const hw = m[3] * ex + m[7] * ey + m[15];
      const hx = (m[0] * ex + m[4] * ey + m[12]) / hw;
      const hy = (m[1] * ex + m[5] * ey + m[13]) / hw;
      const actual = worldToCss(orbitVP, worstSample.point, cw, ch);
      const trackedErr = Math.hypot(actual[0] - hx, actual[1] - hy);
      if (trackedErr > 1e-3) {
        throw new Error(`per-face homography error ${trackedErr.toFixed(4)} px on ${div.worstFace}`);
      }
      return `fixed plane: max ${div.maxPx.toFixed(1)} px, mean ${div.meanPx.toFixed(1)} px (worst: ${div.worstFace}); tracked face error: ${trackedErr.toExponential(2)} px`;
    },
  },
  stillDrawn(() => [
    {
      name: 'anamorphic gallery',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !glRes || !glRes.posterTex) return 0;
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
