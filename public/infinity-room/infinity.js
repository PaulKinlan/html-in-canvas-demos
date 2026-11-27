import { banner, nextPaint, runTests, stillDrawn, supported as api2dSupported, testStage } from '/shared/support.js';
import { ElementGL, supported as elGlSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const canvas = document.getElementById('room-canvas');
const viewportEl = document.getElementById('stage-viewport');
const plaqueEl = document.getElementById('plaque');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests');

// Live controls inside the drawable plaque.
const plaqueInput = document.getElementById('plaque-input');
const plaqueEcho = document.getElementById('plaque-echo');
const plaqueRippleBtn = document.getElementById('plaque-ripple');
const paletteBtns = Array.from(plaqueEl.querySelectorAll('.pal-btn'));

// Stage toolbar controls.
const btnCentre = document.getElementById('btn-centre');
const btnCorner = document.getElementById('btn-corner');
const btnDrift = document.getElementById('btn-drift');
const ctlBounces = document.getElementById('ctl-bounces');
const outBounces = document.getElementById('out-bounces');
const ctlTint = document.getElementById('ctl-tint');
const outTint = document.getElementById('out-tint');
const ctlLanterns = document.getElementById('ctl-lanterns');

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const PALETTES = {
  amber:  { css: '#ffb347', glow: 'rgb(255 179 71 / 0.48)',  rgb: [1.00, 0.70, 0.28] },
  cyan:   { css: '#38e8ff', glow: 'rgb(56 232 255 / 0.48)',  rgb: [0.22, 0.91, 1.00] },
  red:    { css: '#ff3b5c', glow: 'rgb(255 59 92 / 0.48)',   rgb: [1.00, 0.23, 0.36] },
  violet: { css: '#c084ff', glow: 'rgb(192 132 255 / 0.48)', rgb: [0.75, 0.52, 1.00] },
};

const CAM_PRESETS = {
  centre: { yaw: 0.24, pitch: 0.13, dist: 0.90 },
  corner: { yaw: 0.78, pitch: 0.44, dist: 0.94 },
};

const PLAQUE_HALF_W = 0.39;
const PLAQUE_DEFAULT_W = 316;
const PLAQUE_DEFAULT_H = 224;

// ---------------- 6-Wall Mirrored Cube Raytracer (GLSL ES 3.00) ----------------

// #region mirror-raytracer
const ROOM_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uPlaqueHalf;
uniform int uMaxBounces;
uniform vec3 uMirrorTint;
uniform vec3 uLedColor;
uniform float uShowLanterns;
uniform float uRippleAge;
uniform float uTexReady;

in vec2 vUv;
out vec4 outColor;

vec3 lanternPos(int i) {
  if (i == 0) return vec3(-0.66,  0.48,  0.34);
  if (i == 1) return vec3( 0.66,  0.48,  0.34);
  if (i == 2) return vec3(-0.66, -0.48,  0.34);
  if (i == 3) return vec3( 0.66, -0.48,  0.34);
  if (i == 4) return vec3(-0.62,  0.52, -0.38);
  if (i == 5) return vec3( 0.62,  0.52, -0.38);
  if (i == 6) return vec3(-0.62, -0.52, -0.38);
  if (i == 7) return vec3( 0.62, -0.52, -0.38);
  if (i == 8) return vec3( 0.00,  0.68, -0.54);
  return vec3(0.00, -0.68, 0.52);
}

vec3 lanternColor(int i, vec3 led) {
  if (i == 0 || i == 3 || i == 5 || i == 6 || i == 8) return led;
  return mix(vec3(1.0, 0.80, 0.44), led, 0.32);
}

void addLanternHalos(vec3 ro, vec3 rd, float tStart, float tEnd, float totalDist, float rippleAmp, vec3 led, vec3 throughput, inout vec3 accum) {
  if (uShowLanterns < 0.5 || tEnd <= tStart) return;
  for (int i = 0; i < 10; i++) {
    vec3 c = lanternPos(i);
    vec3 oc = ro - c;
    float proj = -dot(oc, rd);
    if (proj < tStart - 0.12 || proj > tEnd + 0.12) continue;
    float tc = clamp(proj, tStart, tEnd);
    vec3 dv = oc + rd * tc;
    float d2 = dot(dv, dv);
    if (d2 < 0.016) {
      float dist = totalDist + tc;
      float wave = rippleAmp > 0.0 ? exp(-pow((dist - uRippleAge * 6.0) * 0.75, 2.0)) * rippleAmp : 0.0;
      vec3 col = lanternColor(i, led) * (0.42 + 0.75 * wave);
      accum += throughput * col * exp(-d2 * 420.0);
    }
  }
}

void main() {
  // vUv has (0,0) at the top-left of the canvas and (1,1) at bottom-right.
  vec2 ndc = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0);
  vec3 rawRd = uCamFwd + ndc.x * uAspect * uTanHalfFov * uCamRight + ndc.y * uTanHalfFov * uCamUp;
  float rdLen = length(rawRd);
  vec3 rd = rawRd / rdLen;
  vec3 ro = uCamPos;

  // Reflected pixel ray differentials so textureGrad() keeps sharp mipmaps across bounces.
  float pxStep = (2.0 * uTanHalfFov) / max(uCanvasSize.y, 1.0);
  vec3 dRawX = uCamRight * pxStep;
  vec3 dRawY = -uCamUp * pxStep;
  vec3 rayDx = (dRawX - rd * dot(rd, dRawX)) / rdLen;
  vec3 rayDy = (dRawY - rd * dot(rd, dRawY)) / rdLen;

  float rippleAmp = (uRippleAge >= 0.0 && uRippleAge < 1.6) ? max(0.0, 1.0 - uRippleAge / 1.6) : 0.0;

  vec3 accum = vec3(0.0);
  vec3 throughput = vec3(1.0);
  float totalDist = 0.0;

  for (int b = 0; b <= 14; b++) {
    if (b > uMaxBounces) break;

    // Intersect the axis-aligned [-1, +1]^3 mirror cube walls.
    float tx = abs(rd.x) > 1e-6 ? ((rd.x > 0.0 ? 1.0 : -1.0) - ro.x) / rd.x : 1e9;
    float ty = abs(rd.y) > 1e-6 ? ((rd.y > 0.0 ? 1.0 : -1.0) - ro.y) / rd.y : 1e9;
    float tz = abs(rd.z) > 1e-6 ? ((rd.z > 0.0 ? 1.0 : -1.0) - ro.z) / rd.z : 1e9;
    tx = max(tx, 0.0);
    ty = max(ty, 0.0);
    tz = max(tz, 0.0);
    float tWall = tx;
    int wallAxis = 0;
    if (ty < tWall) { tWall = ty; wallAxis = 1; }
    if (tz < tWall) { tWall = tz; wallAxis = 2; }

    // Find closest solid micro-lantern core inside (0, tWall).
    float tLantern = tWall;
    int hitLanternIdx = -1;
    if (uShowLanterns > 0.5) {
      for (int i = 0; i < 10; i++) {
        vec3 oc = ro - lanternPos(i);
        float bDot = dot(oc, rd);
        if (bDot > 0.0) continue;
        float disc = bDot * bDot - (dot(oc, oc) - 0.00042);
        if (disc > 0.0) {
          float th = -bDot - sqrt(disc);
          if (th > 1e-4 && th < tLantern) {
            tLantern = th;
            hitLanternIdx = i;
          }
        }
      }
    }

    // Intersect central double-sided HTML plaque plane (z = 0).
    float tSegStart = 0.0;
    if (abs(rd.z) > 1e-5) {
      float tPlaque = -ro.z / rd.z;
      if (tPlaque > 1e-4 && tPlaque < tLantern) {
        float hx = ro.x + rd.x * tPlaque;
        float hy = ro.y + rd.y * tPlaque;
        float rectDist = max(abs(hx) - uPlaqueHalf.x, abs(hy) - uPlaqueHalf.y);
        if (rectDist < 0.05) {
          addLanternHalos(ro, rd, 0.0, tPlaque, totalDist, rippleAmp, uLedColor, throughput, accum);
          tSegStart = tPlaque;

          float dist = totalDist + tPlaque;
          float rippleWave = rippleAmp > 0.0 ? exp(-pow((dist - uRippleAge * 6.0) * 0.8, 2.0)) * rippleAmp : 0.0;

          if (rectDist <= 0.0) {
            bool fromFront = rd.z < 0.0;
            float signX = fromFront ? 1.0 : -1.0;
            float u = 0.5 + signX * hx / (2.0 * uPlaqueHalf.x);
            float v = 0.5 - hy / (2.0 * uPlaqueHalf.y);
            vec3 dpdx = dist * (rayDx - rd * (rayDx.z / rd.z));
            vec3 dpdy = dist * (rayDy - rd * (rayDy.z / rd.z));
            vec2 dUVdx = vec2(signX * dpdx.x / (2.0 * uPlaqueHalf.x), -dpdx.y / (2.0 * uPlaqueHalf.y));
            vec2 dUVdy = vec2(signX * dpdy.x / (2.0 * uPlaqueHalf.x), -dpdy.y / (2.0 * uPlaqueHalf.y));
            float lx = length(dUVdx); if (lx > 0.18) dUVdx *= 0.18 / lx;
            float ly = length(dUVdy); if (ly > 0.18) dUVdy *= 0.18 / ly;

            vec4 tex = uTexReady > 0.5 ? textureGrad(uTex, vec2(u, v), dUVdx, dUVdy) : vec4(0.0);
            if (tex.a > 0.004) {
              vec3 plaqueCol = tex.rgb + tex.rgb * uLedColor * (0.14 + 0.42 * rippleWave);
              accum += throughput * plaqueCol;
              throughput *= (1.0 - tex.a);
              if (max(throughput.r, max(throughput.g, throughput.b)) < 0.004) break;
            }
          } else {
            // Luminous acrylic perimeter halo outside the plaque edge.
            float aura = exp(-rectDist * 70.0) * (0.26 + 0.42 * rippleWave);
            accum += throughput * uLedColor * aura;
          }
        }
      }
    }

    // If a micro-lantern core blocks the ray before the wall, composite it and stop.
    if (hitLanternIdx >= 0) {
      addLanternHalos(ro, rd, tSegStart, tLantern, totalDist, rippleAmp, uLedColor, throughput, accum);
      float wave = rippleAmp > 0.0 ? exp(-pow((totalDist + tLantern - uRippleAge * 6.0) * 0.75, 2.0)) * rippleAmp : 0.0;
      vec3 coreCol = mix(lanternColor(hitLanternIdx, uLedColor), vec3(1.0), 0.55 + 0.25 * wave);
      accum += throughput * coreCol * (1.25 + 0.65 * wave);
      break;
    }

    // Accumulate halos up to the mirror wall.
    addLanternHalos(ro, rd, tSegStart, tWall, totalDist, rippleAmp, uLedColor, throughput, accum);

    vec3 wallHit = ro + rd * tWall;
    vec2 wallUV = (wallAxis == 0) ? wallHit.yz : (wallAxis == 1) ? wallHit.xz : wallHit.xy;
    float edgeDist = min(1.0 - abs(wallUV.x), 1.0 - abs(wallUV.y));
    float seamDark = smoothstep(0.0, 0.009, edgeDist);
    float bevel = smoothstep(0.036, 0.011, edgeDist) * smoothstep(0.003, 0.013, edgeDist);
    float wallWave = rippleAmp > 0.0 ? exp(-pow((totalDist + tWall - uRippleAge * 6.0) * 0.75, 2.0)) * rippleAmp : 0.0;
    vec3 seamGlow = (uLedColor * (0.10 + 0.34 * wallWave) + vec3(0.04, 0.09, 0.07)) * bevel;
    accum += throughput * seamGlow;
    throughput *= mix(0.64, 1.0, seamDark);

    if (b >= uMaxBounces) {
      accum += throughput * vec3(0.014, 0.026, 0.022);
      break;
    }

    if (wallAxis == 0) { rd.x = -rd.x; rayDx.x = -rayDx.x; rayDy.x = -rayDy.x; }
    else if (wallAxis == 1) { rd.y = -rd.y; rayDx.y = -rayDx.y; rayDy.y = -rayDy.y; }
    else { rd.z = -rd.z; rayDx.z = -rayDx.z; rayDy.z = -rayDy.z; }

    ro = clamp(wallHit, vec3(-0.9998), vec3(0.9998));
    totalDist += tWall;
    throughput *= uMirrorTint;
    if (max(throughput.r, max(throughput.g, throughput.b)) < 0.004) break;
  }

  // Soft highlight compression only above 1.0 so depth-0 plaque text stays true.
  vec3 mapped = min(accum, vec3(1.0)) + max(accum - vec3(1.0), vec3(0.0)) * 0.22;
  outColor = vec4(clamp(mapped, 0.0, 1.0), 1.0);
}`;
// #endregion mirror-raytracer

// ---------------- 3D Vector & 4x4 Column-Major Matrix Math ----------------

function v3Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function v3Norm(a) {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1 / Math.tan(fovRad * 0.5);
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

function getCameraState(cw, ch, camPose) {
  const aspect = Math.max(0.4, cw / Math.max(ch, 1));
  const fovRad = (aspect < 1.1 ? 66 : 60) * Math.PI / 180;
  const tanHalf = Math.tan(fovRad * 0.5);
  const cp = Math.cos(camPose.pitch), sp = Math.sin(camPose.pitch);
  const cy = Math.cos(camPose.yaw), sy = Math.sin(camPose.yaw);
  const eye = [
    Math.max(-0.92, Math.min(0.92, camPose.dist * cp * sy)),
    Math.max(-0.92, Math.min(0.92, camPose.dist * sp)),
    Math.max(-0.92, Math.min(0.92, camPose.dist * cp * cy)),
  ];
  const target = [0, 0, 0];
  const fwd = v3Norm(v3Sub(target, eye));
  const right = v3Norm(v3Cross(fwd, [0, 1, 0]));
  const up = v3Cross(right, fwd);
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  const proj = mat4Perspective(fovRad, aspect, 0.06, 20.0);
  const vp = mat4Mul(proj, view);
  return { eye, fwd, right, up, aspect, fovRad, tanHalf, vp };
}

function computeMirrorTint(pct) {
  const t = Math.max(0, Math.min(1.5, pct / 100));
  const soda = [0.86, 0.94, 0.90];
  if (t <= 1.0) {
    const silver = [0.96, 0.965, 0.96];
    return [
      silver[0] + (soda[0] - silver[0]) * t,
      silver[1] + (soda[1] - silver[1]) * t,
      silver[2] + (soda[2] - silver[2]) * t,
    ];
  }
  return [Math.pow(soda[0], t), Math.pow(soda[1], t), Math.pow(soda[2], t)];
}

function getPlaqueHalfSize(el = plaqueEl) {
  const w = el.offsetWidth || PLAQUE_DEFAULT_W;
  const h = el.offsetHeight || PLAQUE_DEFAULT_H;
  return [PLAQUE_HALF_W, PLAQUE_HALF_W * (h / Math.max(w, 1))];
}

// ---------------- State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  palette: 'amber',
  maxBounces: 12,
  tintPct: 100,
  showLanterns: true,
  autoDrift: false,
  ripples: 0,
  rippleStartMs: -1,
  yaw: CAM_PRESETS.centre.yaw,
  pitch: CAM_PRESETS.centre.pitch,
  dist: CAM_PRESETS.centre.dist,
  camAnim: null, // { from, to, startMs, durMs }
  dragging: false,
  dragId: null,
  dragLastX: 0,
  dragLastY: 0,
  onScreen: true,
  needsDraw: true,
  dirtyTex: true,
  texUploaded: false,
  texW: 0,
  texH: 0,
  uploads: 0,
  paints: 0,
  lastGeoVals: null,
  unitCache: { key: '', unit: 1 },
};

let stage = null;
let anisoExt = null;
let maxAniso = 1;
let ctx2d = null;
let rafId = 0;
let lastTickMs = performance.now();

// ---------------- Projective updateElementGeometry() ----------------

// #region projective-hit
function cachedGeometryUnit(targetCanvas = canvas, targetEl = plaqueEl) {
  const w = targetEl.offsetWidth || PLAQUE_DEFAULT_W;
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${w}`;
  if (state.unitCache.key !== key || targetCanvas !== canvas) {
    const unit = geometryUnit(targetCanvas, targetEl, w);
    if (targetCanvas !== canvas) return unit;
    state.unitCache = { key, unit };
    state.lastGeoVals = null;
  }
  return state.unitCache.unit;
}

function buildPlaqueCanvasMatrix(el, eye, vp, cw, ch, halfW, halfH) {
  const w = el.offsetWidth || PLAQUE_DEFAULT_W;
  const h = el.offsetHeight || PLAQUE_DEFAULT_H;
  const fromFront = eye[2] >= 0;
  // Flip local X basis when viewed from behind z = 0 so back text stays upright and area < 0.
  const origin = fromFront ? [-halfW, halfH, 0] : [halfW, halfH, 0];
  const axisX = fromFront ? [2 * halfW, 0, 0] : [-2 * halfW, 0, 0];
  const axisY = [0, -2 * halfH, 0];
  const normal = fromFront ? [0, 0, 1] : [0, 0, -1];

  const elemToWorld = new Float32Array([
    axisX[0] / w, axisX[1] / w, axisX[2] / w, 0,
    axisY[0] / h, axisY[1] / h, axisY[2] / h, 0,
    normal[0],    normal[1],    normal[2],    0,
    origin[0],    origin[1],    origin[2],    1,
  ]);

  const clip = mat4Mul(vp, elemToWorld);
  const corner = (ex, ey) => {
    const c = mat4MulVec4(clip, ex, ey, 0, 1);
    return [c[0] / c[3], c[1] / c[3], c[3]];
  };
  const p = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
  if (p.some((q) => q[2] <= 1e-4)) return null;
  const area = (p[1][0] - p[0][0]) * (p[3][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[3][0] - p[0][0]);
  if (area >= -0.002) return null;

  const ndcToCss = new Float32Array([
    cw / 2, 0,       0, 0,
    0,     -ch / 2,  0, 0,
    0,      0,       1, 0,
    cw / 2, ch / 2,  0, 1,
  ]);
  const raw = mat4Mul(ndcToCss, clip);
  const wCenter = raw[3] * (w * 0.5) + raw[7] * (h * 0.5) + raw[15];
  const invW = wCenter > 1e-4 ? 1 / wCenter : 1;
  const norm = new Float32Array(16);
  for (let i = 0; i < 16; i++) norm[i] = raw[i] * invW;
  return new DOMMatrix(Array.from(norm));
}

function syncPlaqueGeometry(cam, cw, ch) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !OFFSTAGE) return;
  const [halfW, halfH] = getPlaqueHalfSize(plaqueEl);
  const cssM = buildPlaqueCanvasMatrix(plaqueEl, cam.eye, cam.vp, cw, ch, halfW, halfH);
  const hasFocus = plaqueEl.contains(document.activeElement);
  plaqueEl.inert = !cssM && !hasFocus;
  const unit = cachedGeometryUnit(canvas, plaqueEl);
  const target = cssM ? new DOMMatrix().scale(unit, unit, 1).multiply(cssM) : OFFSTAGE;
  const vals = target.toFloat32Array();
  if (state.lastGeoVals && vals.every((v, i) => Math.abs(v - state.lastGeoVals[i]) < 1e-4)) return;
  state.lastGeoVals = vals;
  canvas.updateElementGeometry(plaqueEl, { canvasTransform: target });
  plaqueEl.dataset.hitTick = plaqueEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion projective-hit

// ---------------- Texture Upload & Rendering ----------------

// #region tex-upload
function uploadPlaqueTexture() {
  if (!stage || stage.lost) return false;
  try {
    const t = stage.upload(plaqueEl);
    if (!t) return false;
    const gl = stage.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (anisoExt) {
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    state.texUploaded = true;
    state.texW = t.w;
    state.texH = t.h;
    state.uploads++;
    state.dirtyTex = false;
    return true;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return false;
    }
    throw err;
  }
}
// #endregion tex-upload

function renderWebGL(now) {
  if (!stage || stage.lost) return;
  if (state.dirtyTex || !stage.has(plaqueEl)) {
    uploadPlaqueTexture();
  }
  if (!stage.has(plaqueEl)) return;

  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const cam = getCameraState(cw, ch, state);
  const [halfW, halfH] = getPlaqueHalfSize(plaqueEl);
  const tint = computeMirrorTint(state.tintPct);
  const pal = PALETTES[state.palette] || PALETTES.amber;
  const rippleAge = state.rippleStartMs >= 0 ? (now - state.rippleStartMs) / 1000 : -1;

  stage.begin([0.012, 0.028, 0.024, 1]);
  const rectMat = ElementGL.rect(canvas, 0, 0, cw, ch);
  stage.quad(plaqueEl, rectMat, (gl, u) => {
    gl.uniform2f(u('uCanvasSize'), cw, ch);
    gl.uniform3fv(u('uCamPos'), cam.eye);
    gl.uniform3fv(u('uCamFwd'), cam.fwd);
    gl.uniform3fv(u('uCamRight'), cam.right);
    gl.uniform3fv(u('uCamUp'), cam.up);
    gl.uniform1f(u('uTanHalfFov'), cam.tanHalf);
    gl.uniform1f(u('uAspect'), cam.aspect);
    gl.uniform2f(u('uPlaqueHalf'), halfW, halfH);
    gl.uniform1i(u('uMaxBounces'), state.maxBounces);
    gl.uniform3fv(u('uMirrorTint'), tint);
    gl.uniform3fv(u('uLedColor'), pal.rgb);
    gl.uniform1f(u('uShowLanterns'), state.showLanterns ? 1 : 0);
    gl.uniform1f(u('uRippleAge'), rippleAge);
    gl.uniform1f(u('uTexReady'), state.texUploaded ? 1 : 0);
  });

  syncPlaqueGeometry(cam, cw, ch);
  const facing = cam.eye[2] >= 0 ? 'front' : 'back';
  hudEl.textContent = `webgl2 · ${state.maxBounces} bounces · ${state.tintPct}% glass tint · ${facing} · ${state.texW}×${state.texH}`;
}

function render2DFallback() {
  if (!ctx2d) return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(cw * dpr));
  const h = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#030807';
  ctx2d.fillRect(0, 0, cw, ch);

  const pw = plaqueEl.offsetWidth || PLAQUE_DEFAULT_W;
  const ph = plaqueEl.offsetHeight || PLAQUE_DEFAULT_H;
  const baseScale = Math.min((cw - 48) / pw, (ch - 48) / ph, 1.0);
  const tint = computeMirrorTint(state.tintPct);
  const layers = Math.min(8, Math.max(1, state.maxBounces));

  for (let i = layers; i >= 1; i--) {
    const s = baseScale * Math.pow(0.84, i);
    const dw = pw * s;
    const dh = ph * s;
    const dx = (cw - dw) * 0.5 + Math.sin(state.yaw * 2 + i * 0.35) * i * 6;
    const dy = (ch - dh) * 0.5 + Math.sin(state.pitch * 2 + i * 0.3) * i * 4;
    ctx2d.save();
    ctx2d.globalAlpha = Math.pow(0.76, i);
    try {
      ctx2d.drawElementImage(plaqueEl, dx, dy, dw, dh);
    } catch {}
    ctx2d.fillStyle = `rgba(${Math.round((1 - tint[0]) * 40)}, ${Math.round(tint[1] * 70)}, ${Math.round(tint[2] * 45)}, ${Math.min(0.75, i * 0.08)})`;
    ctx2d.fillRect(dx, dy, dw, dh);
    ctx2d.restore();
  }

  const dw0 = pw * baseScale;
  const dh0 = ph * baseScale;
  const x0 = (cw - dw0) * 0.5;
  const y0 = (ch - dh0) * 0.5;
  try {
    ctx2d.drawElementImage(plaqueEl, x0, y0, dw0, dh0);
  } catch {}

  if ('updateElementGeometry' in HTMLCanvasElement.prototype) {
    const unit = cachedGeometryUnit(canvas, plaqueEl);
    const m = new DOMMatrix().scale(unit, unit, 1).multiply(new DOMMatrix([baseScale, 0, 0, baseScale, x0, y0]));
    canvas.updateElementGeometry(plaqueEl, { canvasTransform: m });
    plaqueEl.dataset.hitTick = plaqueEl.dataset.hitTick === '1' ? '0' : '1';
  }
  hudEl.textContent = `2d fallback · ${layers} layered mirror echoes`;
}

// ---------------- Context Loss & Plain Fallback ----------------

function attachContextLossController({ targetCanvas, targetViewport, targetPlaque, targetPlainHost, onPlain, onRestore }) {
  targetCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    targetPlaque.inert = false;
    if (targetPlaque.parentElement !== targetPlainHost) targetPlainHost.append(targetPlaque);
    targetPlainHost.hidden = false;
    if (targetViewport) targetViewport.hidden = true;
    onPlain?.('WebGL 2 context lost; showing the plaque as plain HTML while waiting for restore.');
  });

  targetCanvas.addEventListener('webglcontextrestored', () => {
    if (targetPlaque.parentElement !== targetCanvas) targetCanvas.append(targetPlaque);
    targetPlainHost.hidden = true;
    if (targetViewport) targetViewport.hidden = false;
    onRestore?.();
  });
}

function showPlainFallback(reason) {
  state.backend = 'plain';
  plaqueEl.inert = false;
  if (plaqueEl.parentElement !== plainHost) plainHost.append(plaqueEl);
  plainHost.hidden = false;
  viewportEl.hidden = true;
  hudEl.textContent = 'plain HTML fallback';
  routeNoteEl.textContent = reason;
}

function requestRender() {
  state.needsDraw = true;
  if (!rafId && state.onScreen && !document.hidden && state.backend !== 'plain') {
    lastTickMs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTickMs) / 1000));
  lastTickMs = now;

  let keepGoing = false;

  if (state.camAnim) {
    const t = Math.min(1, (now - state.camAnim.startMs) / state.camAnim.durMs);
    const e = 1 - Math.pow(1 - t, 3);
    state.yaw = state.camAnim.from.yaw + (state.camAnim.to.yaw - state.camAnim.from.yaw) * e;
    state.pitch = state.camAnim.from.pitch + (state.camAnim.to.pitch - state.camAnim.from.pitch) * e;
    state.dist = state.camAnim.from.dist + (state.camAnim.to.dist - state.camAnim.from.dist) * e;
    state.needsDraw = true;
    if (t >= 1) state.camAnim = null;
    else keepGoing = true;
  } else if (state.autoDrift && !state.dragging) {
    state.yaw += dt * 0.28;
    state.pitch = Math.max(-1.05, Math.min(1.05, Math.sin(now * 0.00035) * 0.34));
    state.needsDraw = true;
    keepGoing = true;
  }

  if (state.rippleStartMs >= 0) {
    const age = (now - state.rippleStartMs) / 1000;
    if (age < 1.65) {
      state.needsDraw = true;
      keepGoing = true;
    } else {
      state.rippleStartMs = -1;
      state.needsDraw = true;
    }
  }

  if (state.needsDraw) {
    state.needsDraw = false;
    if (state.backend === 'webgl') renderWebGL(now);
    else if (state.backend === '2d') render2DFallback();
  }

  if (keepGoing) rafId = requestAnimationFrame(tick);
}

// ---------------- Boot ----------------

function initBackend() {
  attachContextLossController({
    targetCanvas: canvas,
    targetViewport: viewportEl,
    targetPlaque: plaqueEl,
    targetPlainHost: plainHost,
    onPlain: (msg) => {
      state.backend = 'plain';
      routeNoteEl.textContent = msg;
    },
    onRestore: () => {
      if (stage && !stage.lost) {
        state.backend = 'webgl';
        state.dirtyTex = true;
        state.lastGeoVals = null;
        routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL canvas.';
        canvas.requestPaint?.();
        requestRender();
      }
    },
  });

  if (elGlSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: ROOM_FRAGMENT,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          state.texUploaded = false;
          state.dirtyTex = true;
        },
        onRestored: () => {
          const gl = stage.gl;
          anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
          maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
          state.dirtyTex = true;
          state.lastGeoVals = null;
          canvas.requestPaint?.();
          requestRender();
        },
      });
      const gl = stage.gl;
      anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
      maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
      state.backend = 'webgl';
      routeNoteEl.textContent = `Running on WebGL 2 via one ElementGL context (${anisoExt ? `${maxAniso}x anisotropic mipmaps` : 'trilinear mipmaps'}).`;
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back.`;
    }
  }

  if (state.backend === 'none' && api2dSupported) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; running the 2D 5-argument drawElementImage() fallback.';
    }
  }

  if (state.backend === 'none') {
    showPlainFallback('HTML-in-canvas is not available in this browser, so the floating plaque is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    state.paints++;
    state.dirtyTex = true;
    if (state.backend === 'webgl') renderWebGL(performance.now());
    else if (state.backend === '2d') render2DFallback();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      state.lastGeoVals = null;
      requestRender();
    }).observe(canvas);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      state.onScreen = entries.some((e) => e.isIntersecting);
      if (state.onScreen) requestRender();
    }, { rootMargin: '120px' }).observe(viewportEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.onScreen) requestRender();
  });

  canvas.requestPaint?.();
  requestRender();
}

// ---------------- Plaque & Room Interactions ----------------

function setCamPresetButtons(activeKey) {
  btnCentre.setAttribute('aria-pressed', String(activeKey === 'centre'));
  btnCorner.setAttribute('aria-pressed', String(activeKey === 'corner'));
}

function goToPreset(key) {
  const target = CAM_PRESETS[key];
  if (!target) return;
  state.autoDrift = false;
  btnDrift.setAttribute('aria-pressed', 'false');
  setCamPresetButtons(key);
  if (REDUCED_MOTION) {
    state.yaw = target.yaw;
    state.pitch = target.pitch;
    state.dist = target.dist;
    state.camAnim = null;
    requestRender();
    return;
  }
  state.camAnim = {
    from: { yaw: state.yaw, pitch: state.pitch, dist: state.dist },
    to: { ...target },
    startMs: performance.now(),
    durMs: 420,
  };
  requestRender();
}

btnCentre.addEventListener('click', () => goToPreset('centre'));
btnCorner.addEventListener('click', () => goToPreset('corner'));

btnDrift.addEventListener('click', () => {
  state.autoDrift = !state.autoDrift;
  btnDrift.setAttribute('aria-pressed', String(state.autoDrift));
  state.camAnim = null;
  if (state.autoDrift) setCamPresetButtons(null);
  requestRender();
});

ctlBounces.addEventListener('input', () => {
  state.maxBounces = Number(ctlBounces.value);
  outBounces.textContent = String(state.maxBounces);
  requestRender();
});

ctlTint.addEventListener('input', () => {
  state.tintPct = Number(ctlTint.value);
  outTint.textContent = `${state.tintPct}%`;
  requestRender();
});

ctlLanterns.addEventListener('change', () => {
  state.showLanterns = ctlLanterns.checked;
  requestRender();
});

for (const btn of paletteBtns) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.palette;
    const pal = PALETTES[key];
    if (!pal) return;
    state.palette = key;
    for (const b of paletteBtns) b.setAttribute('aria-pressed', String(b === btn));
    plaqueEl.style.setProperty('--led', pal.css);
    plaqueEl.style.setProperty('--led-glow', pal.glow);
    canvas.requestPaint?.();
    requestRender();
  });
}

plaqueInput.addEventListener('input', () => {
  canvas.requestPaint?.();
  requestRender();
});

plaqueEl.addEventListener('focusin', () => {
  state.lastGeoVals = null;
  canvas.requestPaint?.();
  requestRender();
});

plaqueRippleBtn.addEventListener('click', () => {
  state.ripples++;
  plaqueEcho.textContent = `RIPPLE ${state.ripples}`;
  state.rippleStartMs = REDUCED_MOTION ? -1 : performance.now();
  canvas.requestPaint?.();
  requestRender();
});

function isPlaqueControl(target) {
  return target instanceof Element && plaqueEl.contains(target) && !!target.closest('input, button');
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain' || isPlaqueControl(e.target)) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  state.autoDrift = false;
  btnDrift.setAttribute('aria-pressed', 'false');
  state.camAnim = null;
  setCamPresetButtons(null);
  state.dragging = true;
  state.dragId = e.pointerId;
  state.dragLastX = e.clientX;
  state.dragLastY = e.clientY;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  const dx = e.clientX - state.dragLastX;
  const dy = e.clientY - state.dragLastY;
  state.dragLastX = e.clientX;
  state.dragLastY = e.clientY;
  state.yaw -= dx * 0.008;
  state.pitch = Math.max(-1.24, Math.min(1.24, state.pitch + dy * 0.007));
  requestRender();
});

function endOrbitDrag(e) {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  state.dragging = false;
  state.dragId = null;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
canvas.addEventListener('pointerup', endOrbitDrag);
canvas.addEventListener('pointercancel', endOrbitDrag);

canvas.addEventListener('wheel', (e) => {
  if (state.backend === 'plain') return;
  e.preventDefault();
  state.camAnim = null;
  state.dist = Math.max(0.58, Math.min(0.94, state.dist + e.deltaY * 0.0008));
  requestRender();
}, { passive: false });

initBackend();

// ---------------- Isolated Live Checks (Tap-Gated) ----------------

function makeFixtureCanvas(w = 160, h = 120) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = `display:block;width:${w}px;height:${h}px;position:relative`;
  testStage().append(cv);
  return cv;
}

function readPlainCopyImageData(srcCanvas) {
  const copy = document.createElement('canvas');
  copy.width = srcCanvas.width;
  copy.height = srcCanvas.height;
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(srcCanvas, 0, 0);
  return cc.getImageData(0, 0, copy.width, copy.height);
}

function renderFixtureRoom(g, el, { cw, ch, cam, maxBounces, tint, ledRgb, showLanterns = 0 }) {
  g.begin([0.012, 0.028, 0.024, 1]);
  g.quad(el, ElementGL.rect(g.canvas, 0, 0, cw, ch), (gl, u) => {
    gl.uniform2f(u('uCanvasSize'), cw, ch);
    gl.uniform3fv(u('uCamPos'), cam.eye);
    gl.uniform3fv(u('uCamFwd'), cam.fwd);
    gl.uniform3fv(u('uCamRight'), cam.right);
    gl.uniform3fv(u('uCamUp'), cam.up);
    gl.uniform1f(u('uTanHalfFov'), cam.tanHalf);
    gl.uniform1f(u('uAspect'), cam.aspect);
    gl.uniform2f(u('uPlaqueHalf'), 0.36, 0.25);
    gl.uniform1i(u('uMaxBounces'), maxBounces);
    gl.uniform3fv(u('uMirrorTint'), tint);
    gl.uniform3fv(u('uLedColor'), ledRgb);
    gl.uniform1f(u('uShowLanterns'), showLanterns);
    gl.uniform1f(u('uRippleAge'), -1);
    gl.uniform1f(u('uTexReady'), 1);
  });
}

runTests(testsBody, [
  {
    name: 'ElementGL + texElementSubImage2D() renders the 6-wall mirror chamber with gl.getError() === 0',
    why: 'Builds an isolated ElementGL fixture canvas, uploads a drawable plaque with texElementSubImage2D() and mipmaps, renders 12 reflections and checks WebGL error state and drawn pixels.',
    timeout: 6000,
    run: async () => {
      if (!elGlSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = makeFixtureCanvas(160, 120);
      const swatch = document.createElement('div');
      swatch.setAttribute('drawable', '');
      swatch.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:84px;background:#ffb347;border:4px solid #ffffff;';
      cv.append(swatch);
      const g = new ElementGL(cv, { fragment: ROOM_FRAGMENT, attributes: { alpha: false, preserveDrawingBuffer: true } });
      try {
        await nextPaint(cv);
        const t = g.upload(swatch);
        g.gl.bindTexture(g.gl.TEXTURE_2D, t.tex);
        g.gl.texParameteri(g.gl.TEXTURE_2D, g.gl.TEXTURE_MIN_FILTER, g.gl.LINEAR_MIPMAP_LINEAR);
        g.gl.generateMipmap(g.gl.TEXTURE_2D);
        g.gl.bindTexture(g.gl.TEXTURE_2D, null);
        const cam = getCameraState(160, 120, CAM_PRESETS.centre);
        renderFixtureRoom(g, swatch, {
          cw: 160, ch: 120, cam, maxBounces: 12,
          tint: [0.86, 0.94, 0.90], ledRgb: PALETTES.amber.rgb, showLanterns: 1,
        });
        const glErr = g.gl.getError();
        if (glErr !== 0) throw new Error(`gl.getError() returned 0x${glErr.toString(16)}`);
        const img = readPlainCopyImageData(cv);
        const cx = Math.floor(img.width * 0.5);
        const cy = Math.floor(img.height * 0.5);
        const idx = (cy * img.width + cx) * 4;
        const px = [img.data[idx], img.data[idx + 1], img.data[idx + 2], img.data[idx + 3]];
        if (px[0] < 160 || px[1] < 110) throw new Error(`expected warm amber plaque centre pixel, got rgba(${px})`);
        return `uploaded ${t.w}×${t.h}, gl.getError()=0, centre rgba(${px.join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: '12 bounces vs 0 bounces shows off-axis reflected plaques with green glass absorption',
    why: 'Renders the same off-axis view at 0 bounces and 12 bounces without micro-lanterns, then scans outside the depth-0 plaque for brighter, green-shifted mirror reflections.',
    timeout: 6000,
    run: async () => {
      if (!elGlSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = makeFixtureCanvas(160, 120);
      const swatch = document.createElement('div');
      swatch.setAttribute('drawable', '');
      swatch.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:84px;background:#ffffff;';
      cv.append(swatch);
      const g = new ElementGL(cv, { fragment: ROOM_FRAGMENT, attributes: { alpha: false, preserveDrawingBuffer: true } });
      try {
        await nextPaint(cv);
        const t = g.upload(swatch);
        g.gl.bindTexture(g.gl.TEXTURE_2D, t.tex);
        g.gl.texParameteri(g.gl.TEXTURE_2D, g.gl.TEXTURE_MIN_FILTER, g.gl.LINEAR_MIPMAP_LINEAR);
        g.gl.generateMipmap(g.gl.TEXTURE_2D);
        g.gl.bindTexture(g.gl.TEXTURE_2D, null);

        const cam = getCameraState(160, 120, { yaw: 0.50, pitch: 0.28, dist: 0.90 });
        const tint = [0.86, 0.94, 0.90];
        renderFixtureRoom(g, swatch, { cw: 160, ch: 120, cam, maxBounces: 0, tint, ledRgb: [1, 1, 1], showLanterns: 0 });
        const img0 = readPlainCopyImageData(cv);

        renderFixtureRoom(g, swatch, { cw: 160, ch: 120, cam, maxBounces: 12, tint, ledRgb: [1, 1, 1], showLanterns: 0 });
        const img12 = readPlainCopyImageData(cv);

        // Scan outer 20% left/right strips where depth-0 plaque is absent.
        let bestGain = -1;
        let best0 = null;
        let best12 = null;
        const w = img12.width, h = img12.height;
        for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y += 2) {
          for (let x = 2; x < w - 2; x += 2) {
            if (x > Math.floor(w * 0.22) && x < Math.floor(w * 0.78)) continue;
            const i = (y * w + x) * 4;
            const r0 = img0.data[i], g0 = img0.data[i + 1], b0 = img0.data[i + 2];
            const r12 = img12.data[i], g12 = img12.data[i + 1], b12 = img12.data[i + 2];
            const gain = (r12 + g12 + b12) - (r0 + g0 + b0);
            if (gain > bestGain && g12 > r12 + 4) {
              bestGain = gain;
              best0 = [r0, g0, b0];
              best12 = [r12, g12, b12];
            }
          }
        }
        if (!best12 || bestGain < 45) {
          throw new Error(`no clear green-tinted off-axis reflection found (bestGain=${bestGain})`);
        }
        return `off-axis rgb(${best0.join(',')}) at 0 bounces -> rgb(${best12.join(',')}) at 12 bounces (G > R by ${best12[1] - best12[0]})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Projective updateElementGeometry() + geometryUnit() hits plaque <input> and button',
    why: 'Projects an isolated 240×160 drawable plaque with an <input> and <button> through buildPlaqueCanvasMatrix(), scales by geometryUnit() and verifies document.elementsFromPoint() hits both.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('canvas.updateElementGeometry() is not available');
      }
      if (!api2dSupported) throw new Error('HTML-in-canvas is not available');
      const cw = 280, ch = 200, pw = 240, ph = 160;
      const cv = makeFixtureCanvas(cw, ch);
      const fixPlaque = document.createElement('div');
      fixPlaque.setAttribute('drawable', '');
      fixPlaque.style.cssText = `position:absolute;left:0;top:0;width:${pw}px;height:${ph}px;background:#0a1213;`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'none';
      inp.value = 'TEST';
      inp.setAttribute('aria-label', 'Fixture plaque headline');
      inp.style.cssText = 'position:absolute;left:20px;top:18px;width:200px;height:44px;margin:0;border:0;';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Ripple';
      btn.style.cssText = 'position:absolute;left:60px;top:92px;width:120px;height:44px;margin:0;border:0;';

      fixPlaque.append(inp, btn);
      cv.append(fixPlaque);

      try {
        const c2 = cv.getContext('2d');
        await nextPaint(cv);
        c2.drawElementImage(fixPlaque, 0, 0, pw, ph);

        const cam = getCameraState(cw, ch, CAM_PRESETS.centre);
        const [halfW, halfH] = [0.44, 0.44 * (ph / pw)];
        const cssM = buildPlaqueCanvasMatrix(fixPlaque, cam.eye, cam.vp, cw, ch, halfW, halfH);
        if (!cssM) throw new Error('buildPlaqueCanvasMatrix() returned null');
        const unit = geometryUnit(cv, fixPlaque, pw);
        cv.updateElementGeometry(fixPlaque, { canvasTransform: new DOMMatrix().scale(unit, unit, 1).multiply(cssM) });
        fixPlaque.dataset.hitTick = '1';

        const rect = cv.getBoundingClientRect();
        const probe = (lx, ly) => {
          const pt = cssM.transformPoint(new DOMPoint(lx, ly, 0, 1));
          const sx = pt.x / pt.w, sy = pt.y / pt.w;
          return { sx, sy, hits: document.elementsFromPoint(rect.left + sx, rect.top + sy) };
        };

        const inHit = probe(120, 40);
        const btnHit = probe(120, 114);
        const outHit = document.elementsFromPoint(rect.left + 4, rect.top + 4);
        if (!inHit.hits.includes(inp)) throw new Error(`expected <input> at (${inHit.sx.toFixed(1)}, ${inHit.sy.toFixed(1)}), got ${inHit.hits[0]?.tagName}`);
        if (!btnHit.hits.includes(btn)) throw new Error(`expected <button> at (${btnHit.sx.toFixed(1)}, ${btnHit.sy.toFixed(1)}), got ${btnHit.hits[0]?.tagName}`);
        if (outHit.includes(fixPlaque)) throw new Error('corner outside projected plaque quad still hit the plaque');
        return `unit=${unit.toFixed(2)}; hit <input> (${inHit.sx.toFixed(0)},${inHit.sy.toFixed(0)}) and <button> (${btnHit.sx.toFixed(0)},${btnHit.sy.toFixed(0)})`;
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Context loss falls back to plain HTML and restores cleanly without loseContext()',
    why: 'Dispatches synthetic webglcontextlost and webglcontextrestored events on an isolated fixture canvas wired to attachContextLossController() and checks DOM recovery.',
    run: async () => {
      const box = document.createElement('div');
      box.style.cssText = 'position:relative;width:160px;height:100px;';
      const vp = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.width = 160;
      cv.height = 100;
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.textContent = 'Plaque';
      const ph = document.createElement('div');
      ph.hidden = true;
      cv.append(child);
      vp.append(cv);
      box.append(vp, ph);
      testStage().append(box);

      let note = '';
      let restored = false;
      attachContextLossController({
        targetCanvas: cv,
        targetViewport: vp,
        targetPlaque: child,
        targetPlainHost: ph,
        onPlain: (msg) => { note = msg; },
        onRestore: () => { restored = true; },
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const fellBack = lostEv.defaultPrevented && vp.hidden && !ph.hidden && ph.contains(child);
      if (!fellBack) throw new Error(`fallback incomplete (prevented=${lostEv.defaultPrevented}, inPlain=${ph.contains(child)})`);

      cv.dispatchEvent(new Event('webglcontextrestored'));
      const cameBack = restored && !vp.hidden && ph.hidden && cv.contains(child);
      box.remove();
      window.__gfx?.retire?.(cv);
      if (!cameBack) throw new Error('webglcontextrestored did not move child back into canvas');
      return `synthetic webglcontextlost moved child to plain host ("${note.slice(0, 36)}…"), webglcontextrestored returned it`;
    },
  },
  stillDrawn(() => [
    {
      name: 'infinity mirror room',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !state.texUploaded) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return 1;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => showPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
