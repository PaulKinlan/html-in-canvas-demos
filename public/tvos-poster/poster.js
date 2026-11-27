import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const POSTER_W = 268;
export const POSTER_H = 376;

export const THEMES = {
  orbit: {
    id: 'orbit',
    label: 'Midnight Orbit',
    title: 'MIDNIGHT ORBIT',
    subtitle: 'Directed by Elena Vance · Sci-Fi',
    format: '4K DOLBY VISION',
    rating: 'PG-13',
    runtime: '2h 14m',
    kicker: 'ORIGINAL FEATURE',
    edition: 'SERIES 01',
    accent: [0.38, 0.65, 0.98],
    clear: [0.025, 0.035, 0.065, 1.0],
    bgPaths:
      '<path d="M0,256 L58,204 L106,232 L168,182 L222,226 L268,196 L268,376 L0,376 Z" fill="rgb(8 14 34 / 0.72)"></path>' +
      '<path d="M0,290 L76,246 L142,272 L204,234 L268,266 L268,376 L0,376 Z" fill="rgb(4 7 18 / 0.92)"></path>',
    emblemSvg:
      '<circle cx="60" cy="60" r="44" fill="none" stroke="#93c5fd" stroke-width="2" stroke-dasharray="6 4"></circle>' +
      '<ellipse cx="60" cy="60" rx="48" ry="18" transform="rotate(-24 60 60)" fill="none" stroke="#f8fafc" stroke-width="2.5"></ellipse>' +
      '<circle cx="60" cy="60" r="18" fill="#60a5fa"></circle>' +
      '<circle cx="96" cy="40" r="4.5" fill="#fef08a"></circle>',
  },
  dune: {
    id: 'dune',
    label: 'Solar Dune',
    title: 'SOLAR DUNE',
    subtitle: 'Directed by Kenji Sato · Drama',
    format: 'HDR10+ · ATMOS',
    rating: '15',
    runtime: '2h 28m',
    kicker: 'FESTIVAL SELECTION',
    edition: 'ARCHIVE 04',
    accent: [0.98, 0.72, 0.16],
    clear: [0.045, 0.022, 0.02, 1.0],
    bgPaths:
      '<path d="M0,224 Q72,190 144,228 T268,206 L268,376 L0,376 Z" fill="rgb(92 28 12 / 0.74)"></path>' +
      '<path d="M0,268 Q84,232 162,272 T268,248 L268,376 L0,376 Z" fill="rgb(24 9 7 / 0.92)"></path>',
    emblemSvg:
      '<circle cx="60" cy="60" r="42" fill="none" stroke="#fdba74" stroke-width="2"></circle>' +
      '<circle cx="60" cy="60" r="24" fill="#f59e0b"></circle>' +
      '<circle cx="68" cy="54" r="17" fill="#3b1209"></circle>' +
      '<line x1="12" y1="60" x2="108" y2="60" stroke="#fef3c7" stroke-width="1.8" stroke-dasharray="3 4"></line>',
  },
  noir: {
    id: 'noir',
    label: 'Emerald Noir',
    title: 'EMERALD NOIR',
    subtitle: 'Directed by Claire Moreau · Mystery',
    format: '4K MASTER',
    rating: '12A',
    runtime: '1h 56m',
    kicker: 'RESTORED EDITION',
    edition: 'REEL 09',
    accent: [0.2, 0.83, 0.6],
    clear: [0.02, 0.045, 0.04, 1.0],
    bgPaths:
      '<path d="M0,376 L0,234 L34,234 L34,194 L68,194 L68,246 L108,246 L108,166 L154,166 L154,238 L192,238 L192,188 L232,188 L232,226 L268,226 L268,376 Z" fill="rgb(6 26 24 / 0.78)"></path>' +
      '<path d="M0,376 L0,276 L54,276 L54,242 L114,242 L114,284 L176,284 L176,232 L226,232 L226,274 L268,274 L268,376 Z" fill="rgb(4 12 13 / 0.94)"></path>',
    emblemSvg:
      '<polygon points="60,14 98,60 60,106 22,60" fill="none" stroke="#6ee7b7" stroke-width="2.2"></polygon>' +
      '<polygon points="60,28 84,60 60,92 36,60" fill="#10b981" fill-opacity="0.86" stroke="#ecfdf5" stroke-width="1.6"></polygon>' +
      '<line x1="60" y1="14" x2="60" y2="106" stroke="#ecfdf5" stroke-width="1.2" opacity="0.7"></line>',
  },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------- Pure Tilt Spring & 3D Matrix Math ----------------

export function autoTiltTarget(tSec, reduced = false) {
  if (reduced) return { x: 0, y: 0 };
  return {
    x: Math.sin(tSec * 0.95) * 0.62,
    y: Math.cos(tSec * 0.72) * 0.48,
  };
}

export function stepTiltSpring(spring, targetX, targetY, dtSec, reduced = false) {
  if (reduced) {
    spring.x = targetX;
    spring.y = targetY;
    spring.vx = 0;
    spring.vy = 0;
    return false;
  }
  const dt = Math.min(0.05, Math.max(0.001, dtSec));
  const k = 150;
  const c = 21;
  const ax = k * (targetX - spring.x) - c * spring.vx;
  const ay = k * (targetY - spring.y) - c * spring.vy;
  spring.vx += ax * dt;
  spring.vy += ay * dt;
  spring.x += spring.vx * dt;
  spring.y += spring.vy * dt;
  const moving =
    Math.abs(targetX - spring.x) > 0.001 ||
    Math.abs(targetY - spring.y) > 0.001 ||
    Math.abs(spring.vx) > 0.002 ||
    Math.abs(spring.vy) > 0.002;
  if (!moving) {
    spring.x = targetX;
    spring.y = targetY;
    spring.vx = 0;
    spring.vy = 0;
  }
  return moving;
}

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

function mat4RotateX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotateY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

export function projectPointCss(cssMatrix, px, py) {
  const m = cssMatrix.toFloat32Array();
  const w = m[3] * px + m[7] * py + m[15];
  const inv = Math.abs(w) > 1e-5 ? 1 / w : 1;
  return {
    x: (m[0] * px + m[4] * py + m[12]) * inv,
    y: (m[1] * px + m[5] * py + m[13]) * inv,
  };
}

// #region poster-matrix
/**
 * Build per-layer 3D perspective uMvp matrices (depth 0 = bg, 1 = mid, 2 = fg)
 * and matching element-CSS-px -> canvas-CSS-px projective DOMMatrix instances.
 */
export function buildPosterMatrices(cw, ch, elemW, elemH, tiltX, tiltY, splitPx, maxTiltDeg = 14) {
  const safeW = Math.max(1, elemW);
  const safeH = Math.max(1, elemH);
  const safeCw = Math.max(1, cw);
  const safeCh = Math.max(1, ch);
  const aspect = Math.max(0.35, safeCw / safeCh);

  const worldW = 2.0;
  const worldH = worldW * (safeH / safeW);
  const pxToWorld = worldW / safeW;
  const splitWorld = clamp(splitPx, 0, 48) * pxToWorld;

  const fitScale = Math.min((safeCw - 48) / safeW, (safeCh - 56) / safeH, 1.02);
  const fovY = (34 * Math.PI) / 180;
  const tanHalf = Math.tan(fovY * 0.5);
  const camZ = Math.max(3.6, (worldH * safeCh) / (2 * tanHalf * Math.max(1, safeH * fitScale)));

  const vp = mat4Mul(
    mat4Perspective(fovY, aspect, 0.4, 40.0),
    mat4LookAt([0, 0, camZ], [0, 0, 0], [0, 1, 0])
  );

  const tx = clamp(tiltX, -1, 1);
  const ty = clamp(tiltY, -1, 1);
  const yawRad = (tx * clamp(maxTiltDeg, 0, 24) * Math.PI) / 180;
  const pitchRad = (ty * clamp(maxTiltDeg, 0, 24) * 0.88 * Math.PI) / 180;
  const rot = mat4Mul(mat4RotateY(yawRad), mat4RotateX(pitchRad));

  const pxToUv = new Float32Array([
    1 / safeW, 0, 0, 0,
    0, 1 / safeH, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const ndcToCss = new Float32Array([
    safeCw * 0.5, 0, 0, 0,
    0, -safeCh * 0.5, 0, 0,
    0, 0, 1, 0,
    safeCw * 0.5, safeCh * 0.5, 0, 1,
  ]);

  const layers = [0, 1, 2].map((depth) => {
    const zLayer = depth * splitWorld;
    const uvToLocal = new Float32Array([
      worldW, 0, 0, 0,
      0, -worldH, 0, 0,
      0, 0, 1, 0,
      -worldW * 0.5, worldH * 0.5, zLayer, 1,
    ]);
    const uMvp = mat4Mul(vp, mat4Mul(rot, uvToLocal));
    const cssRaw = mat4Mul(ndcToCss, mat4Mul(uMvp, pxToUv));
    const wCenter = cssRaw[3] * (safeW * 0.5) + cssRaw[7] * (safeH * 0.5) + cssRaw[15];
    const invW = wCenter > 1e-4 ? 1 / wCenter : 1;
    const cssArr = new Array(16);
    for (let i = 0; i < 16; i++) cssArr[i] = cssRaw[i] * invW;
    const cssMatrix = typeof DOMMatrix !== 'undefined' ? new DOMMatrix(cssArr) : null;
    const center = cssMatrix ? projectPointCss(cssMatrix, safeW * 0.5, safeH * 0.5) : { x: safeCw * 0.5, y: safeCh * 0.5 };
    return { depth, zLayer, uMvp, cssMatrix, cssArr, center };
  });

  const bgTop = layers[0].cssMatrix ? projectPointCss(layers[0].cssMatrix, safeW * 0.5, 0) : { x: safeCw * 0.5, y: (safeCh - safeH) * 0.5 };
  const bgRight = layers[0].cssMatrix ? projectPointCss(layers[0].cssMatrix, safeW, safeH * 0.5) : { x: (safeCw + safeW) * 0.5, y: safeCh * 0.5 };
  const cardHalf = {
    x: Math.hypot(bgRight.x - layers[0].center.x, bgRight.y - layers[0].center.y),
    y: Math.hypot(bgTop.x - layers[0].center.x, bgTop.y - layers[0].center.y),
  };

  return {
    layers,
    cardCenter: layers[0].center,
    cardHalf,
    tiltX: tx,
    tiltY: ty,
    yawRad,
    pitchRad,
    fitScale,
  };
}
// #endregion poster-matrix

// ---------------- WebGL 2 Fragment Shader ----------------

// #region poster-shader
export const POSTER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uShadowTex1;
uniform sampler2D uShadowTex2;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec2 uCardCenter;
uniform vec2 uCardHalf;
uniform vec2 uLight;
uniform float uSplitPx;
uniform float uSheen;
uniform vec3 uAccent;
uniform float uTrailer;
uniform float uReduced;
uniform vec2 uShadowOff1;
uniform vec2 uShadowOff2;
uniform float uShadowWeight1;
uniform float uShadowWeight2;

in vec2 vUv;
out vec4 outColor;

float sdSquircleBox(vec2 p, vec2 b, float r) {
  float rr = min(r, min(b.x, b.y));
  vec2 d = abs(p) - b + vec2(rr);
  vec2 pos = max(d, vec2(0.0));
  float corner = (pos.x > 1e-4 || pos.y > 1e-4)
    ? pow(pow(max(pos.x, 1e-5), 3.8) + pow(max(pos.y, 1e-5), 3.8), 1.0 / 3.8)
    : 0.0;
  return corner + min(max(d.x, d.y), 0.0) - rr;
}

float sampleAlpha(sampler2D tex, vec2 uv) {
  if (uv.x <= 0.002 || uv.x >= 0.998 || uv.y <= 0.002 || uv.y >= 0.998) return 0.0;
  return texture(tex, uv).a;
}

float sampleSoftShadow(sampler2D tex, vec2 baseUv, vec2 blurUv) {
  float acc = sampleAlpha(tex, baseUv) * 0.24;
  acc += sampleAlpha(tex, baseUv + vec2(blurUv.x, 0.0)) * 0.11;
  acc += sampleAlpha(tex, baseUv - vec2(blurUv.x, 0.0)) * 0.11;
  acc += sampleAlpha(tex, baseUv + vec2(0.0, blurUv.y)) * 0.11;
  acc += sampleAlpha(tex, baseUv - vec2(0.0, blurUv.y)) * 0.11;
  acc += sampleAlpha(tex, baseUv + blurUv * 0.78) * 0.08;
  acc += sampleAlpha(tex, baseUv + vec2(-blurUv.x, blurUv.y) * 0.78) * 0.08;
  acc += sampleAlpha(tex, baseUv + vec2(blurUv.x, -blurUv.y) * 0.78) * 0.08;
  acc += sampleAlpha(tex, baseUv - blurUv * 0.78) * 0.08;
  return clamp(acc, 0.0, 1.0);
}

void main() {
  if (uPass == 0) {
    vec2 pCss = vUv * uCanvasSize;
    vec2 uv = vUv;
    vec2 glowCenter = uCardCenter + uLight * 36.0 - vec2(0.0, 18.0);
    float distGlow = length((pCss - glowCenter) / max(uCardHalf * 1.6, vec2(40.0)));
    float halo = exp(-distGlow * distGlow * 1.45);
    float pulse = (uTrailer > 0.5 && uReduced < 0.5) ? (0.85 + 0.15 * sin(uTime * 2.4)) : 1.0;

    vec3 bg = mix(vec3(0.024, 0.032, 0.062), vec3(0.012, 0.016, 0.032), smoothstep(0.0, 1.0, uv.y));
    bg += uAccent * halo * (0.14 + 0.08 * uTrailer) * pulse;

    // Subtle sculpted theatre stage horizon sheen under the poster.
    float floorBand = smoothstep(0.62, 0.98, uv.y);
    float floorSpot = exp(-pow((uv.x - 0.5 - uLight.x * 0.12) / 0.36, 2.0));
    bg += mix(vec3(0.04, 0.05, 0.09), uAccent * 0.16, 0.4) * floorBand * floorSpot * 0.55;

    // Grounded soft poster shadow onto the theatre backdrop opposite the light.
    vec2 shadowCenter = uCardCenter + vec2(-uLight.x, -uLight.y) * (8.0 + uSplitPx * 0.26) + vec2(0.0, 12.0);
    float sd = sdSquircleBox(pCss - shadowCenter, max(uCardHalf * 0.98, vec2(12.0)), 24.0);
    float drop = exp(-max(sd, 0.0) * 0.042) * 0.78;
    bg *= (1.0 - drop);

    outColor = vec4(clamp(bg, 0.0, 1.0), 1.0);
    return;
  }

  vec2 safeSize = max(uSize, vec2(1.0));
  vec2 pLocal = (vUv - 0.5) * safeSize;
  float radius = min(26.0, min(safeSize.x, safeSize.y) * 0.18);
  float cardD = sdSquircleBox(pLocal, safeSize * 0.5 - vec2(0.5), radius);
  float aa = max(fwidth(cardD), 0.75);
  float cardMask = 1.0 - smoothstep(-aa, aa, cardD);
  if (cardMask <= 0.001) discard;

  vec4 col = texture(uTex, vUv);

  // Inter-layer parallax cast shadows opposite the pointer light.
  if (uPass == 1) {
    float s1 = 0.0;
    float s2 = 0.0;
    if (uShadowWeight1 > 0.001) {
      vec2 blur1 = vec2(3.4 + uSplitPx * 0.22) / safeSize;
      s1 = sampleSoftShadow(uShadowTex1, vUv - uShadowOff1, blur1);
    }
    if (uShadowWeight2 > 0.001) {
      vec2 blur2 = vec2(5.2 + uSplitPx * 0.36) / safeSize;
      s2 = sampleSoftShadow(uShadowTex2, vUv - uShadowOff2, blur2);
    }
    float shadowMask = clamp(s1 * uShadowWeight1 + s2 * uShadowWeight2 * 0.88, 0.0, 0.88);
    col.rgb *= (1.0 - shadowMask * 0.68);
  } else if (uPass == 2 && uShadowWeight1 > 0.001) {
    vec2 blurFg = vec2(2.8 + uSplitPx * 0.20) / safeSize;
    float sFg = sampleSoftShadow(uShadowTex1, vUv - uShadowOff1, blurFg);
    col.rgb *= (1.0 - sFg * uShadowWeight1 * 0.65);
  }

  // Diagonal glossy specular sheen sweeping across the rounded squircle poster face.
  vec2 centered = vUv - 0.5;
  vec2 diag = normalize(vec2(0.72, 0.69));
  float lightProj = dot(uLight, diag) * 0.42;
  float dDiag = dot(centered, diag) - lightProj;
  vec2 lightSpot = 0.5 + uLight * 0.34;
  vec2 spotDelta = (vUv - lightSpot) * vec2(1.0, 1.15);
  float cornerGlow = exp(-dot(spotDelta, spotDelta) * 5.2);
  float primaryStreak = exp(-pow(dDiag / 0.15, 2.0));
  float secondaryStreak = exp(-pow((dDiag + 0.26) / 0.06, 2.0)) * 0.38;
  float crossFade = smoothstep(0.95, 0.08, length(vUv - lightSpot));
  float sheenBand = primaryStreak * (0.45 + 0.55 * crossFade) + secondaryStreak * crossFade;

  vec3 specCol = mix(vec3(0.92, 0.96, 1.0), mix(vec3(1.0), uAccent, 0.28), 0.34);
  if (uPass == 1) {
    float specAmt = (cornerGlow * 0.28 + sheenBand * 0.24) * uSheen;
    col.rgb += specCol * specAmt * col.a;

    // Beveled squircle specular rim edge toward pointer light.
    float rim = exp(-pow((cardD + 1.1) / 1.35, 2.0));
    vec2 edgeNorm = normalize(pLocal + vec2(1e-4));
    float rimFacing = 0.24 + 0.76 * max(0.0, dot(edgeNorm, normalize(uLight + vec2(-0.08, -0.14))));
    col.rgb += mix(vec3(0.74, 0.84, 1.0), uAccent, 0.44) * rim * rimFacing * 0.44 * col.a;
  } else {
    float layerSheen = (cornerGlow * 0.08 + sheenBand * 0.07) * uSheen;
    col.rgb += specCol * layerSheen * col.a;
  }

  col *= cardMask;
  if (col.a <= 0.001) discard;
  outColor = col;
}`;
// #endregion poster-shader

// ---------------- Shared WebGL & 2D Drawing Helpers ----------------

export function computeShadowUniforms(elemW, elemH, tiltX, tiltY, splitPx) {
  const safeW = Math.max(1, elemW);
  const safeH = Math.max(1, elemH);
  const sepNorm = clamp(splitPx / 40, 0, 1);
  // Shift shadows opposite the pointer light, with a slight downward key-light bias.
  const dirX = -tiltX * 0.92;
  const dirY = -tiltY * 0.92 + 0.14;
  const shift1Px = 1.5 + splitPx * 0.42;
  const shift2Px = 2.5 + splitPx * 0.84;
  const weight1 = 0.16 + 0.78 * Math.min(1, splitPx / 8);
  const weight2 = 0.12 + 0.72 * Math.min(1, splitPx / 10);
  return {
    off1: [(dirX * shift1Px) / safeW, (dirY * shift1Px) / safeH],
    off2: [(dirX * shift2Px) / safeW, (dirY * shift2Px) / safeH],
    weight1: splitPx <= 0.5 ? 0.08 : weight1 * (0.75 + 0.25 * sepNorm),
    weight2: splitPx <= 0.5 ? 0.06 : weight2 * (0.75 + 0.25 * sepNorm),
  };
}

export function drawPosterWebGLScene(glStage, cv, layerEls, geom, opts) {
  const { bg, mid, fg } = layerEls;
  const {
    cw,
    ch,
    tiltX,
    tiltY,
    splitPx,
    sheen = 1.0,
    accent = [0.38, 0.65, 0.98],
    trailer = false,
    reduced = true,
    texMid,
    texFg,
    texBg,
  } = opts;
  const elemW = bg.offsetWidth || POSTER_W;
  const elemH = bg.offsetHeight || POSTER_H;
  const sh = computeShadowUniforms(elemW, elemH, tiltX, tiltY, splitPx);

  const setCommon = (gl, loc) => {
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform2f(loc('uCardCenter'), geom.cardCenter.x, geom.cardCenter.y);
    gl.uniform2f(loc('uCardHalf'), geom.cardHalf.x, geom.cardHalf.y);
    gl.uniform2f(loc('uLight'), tiltX, tiltY);
    gl.uniform1f(loc('uSplitPx'), splitPx);
    gl.uniform1f(loc('uSheen'), sheen);
    gl.uniform3f(loc('uAccent'), accent[0], accent[1], accent[2]);
    gl.uniform1f(loc('uTrailer'), trailer ? 1.0 : 0.0);
    gl.uniform1f(loc('uReduced'), reduced ? 1.0 : 0.0);
  };

  // Pass 0: sculpted theatre backdrop + grounded ambient shadow.
  glStage.quad(bg, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
    setCommon(gl, loc);
    gl.uniform1i(loc('uPass'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texMid.tex);
    gl.uniform1i(loc('uShadowTex1'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texFg.tex);
    gl.uniform1i(loc('uShadowTex2'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uShadowOff1'), 0, 0);
    gl.uniform2f(loc('uShadowOff2'), 0, 0);
    gl.uniform1f(loc('uShadowWeight1'), 0);
    gl.uniform1f(loc('uShadowWeight2'), 0);
  });

  // Pass 1: depth 0 background key-art catching shadows from mid & fg + squircle specular sheen.
  glStage.quad(bg, geom.layers[0].uMvp, (gl, loc) => {
    setCommon(gl, loc);
    gl.uniform1i(loc('uPass'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texMid.tex);
    gl.uniform1i(loc('uShadowTex1'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texFg.tex);
    gl.uniform1i(loc('uShadowTex2'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uShadowOff1'), sh.off1[0], sh.off1[1]);
    gl.uniform2f(loc('uShadowOff2'), sh.off2[0], sh.off2[1]);
    gl.uniform1f(loc('uShadowWeight1'), sh.weight1);
    gl.uniform1f(loc('uShadowWeight2'), sh.weight2);
  });

  // Pass 2: depth 1 midground pills/emblem catching foreground cast shadow.
  glStage.quad(mid, geom.layers[1].uMvp, (gl, loc) => {
    setCommon(gl, loc);
    gl.uniform1i(loc('uPass'), 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texFg.tex);
    gl.uniform1i(loc('uShadowTex1'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texBg.tex);
    gl.uniform1i(loc('uShadowTex2'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uShadowOff1'), sh.off1[0], sh.off1[1]);
    gl.uniform2f(loc('uShadowOff2'), 0, 0);
    gl.uniform1f(loc('uShadowWeight1'), sh.weight1);
    gl.uniform1f(loc('uShadowWeight2'), 0);
  });

  // Pass 3: depth 2 foreground editable title & live buttons floating highest.
  glStage.quad(fg, geom.layers[2].uMvp, (gl, loc) => {
    setCommon(gl, loc);
    gl.uniform1i(loc('uPass'), 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texBg.tex);
    gl.uniform1i(loc('uShadowTex1'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texMid.tex);
    gl.uniform1i(loc('uShadowTex2'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uShadowOff1'), 0, 0);
    gl.uniform2f(loc('uShadowOff2'), 0, 0);
    gl.uniform1f(loc('uShadowWeight1'), 0);
    gl.uniform1f(loc('uShadowWeight2'), 0);
  });
}

// #region fallback-2d
export function drawPoster2DScene(ctx, cv, cw, ch, layerList, geom, tiltX, tiltY, splitPx, accent = [0.38, 0.65, 0.98]) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grad = ctx.createRadialGradient(
    cw * 0.5 + tiltX * 26,
    ch * 0.42 + tiltY * 26,
    18,
    cw * 0.5,
    ch * 0.5,
    Math.max(cw, ch) * 0.72
  );
  grad.addColorStop(0, `rgba(${Math.round(accent[0] * 70)}, ${Math.round(accent[1] * 70)}, ${Math.round(accent[2] * 90)}, 1)`);
  grad.addColorStop(1, '#060912');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  const yawCos = Math.max(0.7, Math.cos(geom.yawRad));
  const pitchCos = Math.max(0.7, Math.cos(geom.pitchRad));
  const shadowDirX = -tiltX * 0.9 + 0;
  const shadowDirY = -tiltY * 0.9 + 0.14;

  for (let i = 0; i < layerList.length; i++) {
    const el = layerList[i];
    const lg = geom.layers[i];
    const ew = el.offsetWidth || POSTER_W;
    const eh = el.offsetHeight || POSTER_H;
    const tl = projectPointCss(lg.cssMatrix, 0, 0);
    const tr = projectPointCss(lg.cssMatrix, ew, 0);
    const bl = projectPointCss(lg.cssMatrix, 0, eh);
    const sx = (Math.hypot(tr.x - tl.x, tr.y - tl.y) / ew) * (i === 0 ? yawCos * 0.04 + 0.96 : 1);
    const sy = (Math.hypot(bl.x - tl.x, bl.y - tl.y) / eh) * (i === 0 ? pitchCos * 0.04 + 0.96 : 1);

    ctx.save();
    ctx.translate(lg.center.x, lg.center.y);
    ctx.scale(sx, sy);

    if (i === 0) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = 24 + splitPx * 0.4;
      ctx.shadowOffsetX = shadowDirX * (10 + splitPx * 0.25);
      ctx.shadowOffsetY = shadowDirY * (10 + splitPx * 0.25) + 10;
      ctx.fillStyle = '#090d1a';
      ctx.beginPath();
      ctx.roundRect(-ew * 0.5, -eh * 0.5, ew, eh, 26);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.roundRect(-ew * 0.5, -eh * 0.5, ew, eh, 26);
      ctx.clip();
    } else if (splitPx > 1) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.58)';
      ctx.shadowBlur = 8 + splitPx * 0.28;
      ctx.shadowOffsetX = shadowDirX * (2 + splitPx * 0.35);
      ctx.shadowOffsetY = shadowDirY * (2 + splitPx * 0.35);
    }

    try {
      ctx.drawElementImage(el, -ew * 0.5, -eh * 0.5, ew, eh);
    } catch {}

    if (i === 0) {
      const lx = (0.5 + tiltX * 0.35) * ew - ew * 0.5;
      const ly = (0.5 + tiltY * 0.35) * eh - eh * 0.5;
      const sheenGrad = ctx.createLinearGradient(lx - ew * 0.4, ly - eh * 0.4, lx + ew * 0.4, ly + eh * 0.4);
      sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      sheenGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.22)');
      sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sheenGrad;
      ctx.fillRect(-ew * 0.5, -eh * 0.5, ew, eh);
    }
    ctx.restore();
  }
}
// #endregion fallback-2d

// ---------------- Page Controller ----------------

const canvas = document.getElementById('tv-canvas');
const stageBox = document.getElementById('tv-stage');
const viewportEl = document.getElementById('tv-viewport');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests-body');

const bgLayer = document.getElementById('tv-layer-bg');
const midLayer = document.getElementById('tv-layer-mid');
const fgLayer = document.getElementById('tv-layer-fg');
const bgArtSvg = document.getElementById('bg-art');
const midFormat = document.getElementById('mid-format');
const midRating = document.getElementById('mid-rating');
const midRuntime = document.getElementById('mid-runtime');
const midEmblem = document.getElementById('mid-emblem');
const midKicker = document.getElementById('mid-kicker');
const midEdition = document.getElementById('mid-edition');
const fgStatusPill = document.getElementById('fg-status-pill');
const titleInput = document.getElementById('poster-title-input');
const subtitleEl = document.getElementById('poster-subtitle');
const btnTrailer = document.getElementById('btn-trailer');
const btnWatchlist = document.getElementById('btn-watchlist');

const themeBtns = Array.from(document.querySelectorAll('button[data-theme-btn]'));
const btnCentre = document.getElementById('btn-centre');
const ctlAuto = document.getElementById('ctl-auto');
const ctlReduced = document.getElementById('ctl-reduced');
const ctlSplit = document.getElementById('ctl-split');
const outSplit = document.getElementById('out-split');
const ctlTilt = document.getElementById('ctl-tilt');
const outTilt = document.getElementById('out-tilt');

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const LAYERS = [bgLayer, midLayer, fgLayer];

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  theme: 'orbit',
  splitPx: Number(ctlSplit.value),
  maxTiltDeg: Number(ctlTilt.value),
  autoTilt: ctlAuto.checked,
  reducedOverride: reducedQuery.matches,
  trailerPlaying: false,
  watchlisted: false,
  pointerActive: false,
  dragging: false,
  pointerId: null,
  targetTiltX: 0,
  targetTiltY: 0,
  spring: { x: 0, y: 0, vx: 0, vy: 0 },
  hasPainted: false,
  onScreen: true,
  uploads: 0,
  paints: 0,
  rafId: 0,
  lastTickMs: 0,
  autoSec: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoVals: new WeakMap(),
};

const dirtyLayers = new Set(LAYERS);
const layerTexInfo = new Map();
let stage = null;
let ctx2d = null;

ctlReduced.checked = state.reducedOverride;

const isReducedMotion = () => state.reducedOverride || reducedQuery.matches;
const shouldAutoTilt = () => state.autoTilt && !isReducedMotion() && !state.pointerActive && !state.dragging;

function canvasCssBox() {
  const cw = canvas.clientWidth || viewportEl.clientWidth || 0;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 0;
  return { cw, ch };
}

function updateHud() {
  const route =
    state.mode === 'webgl' ? 'WebGL 2 ElementGL'
      : state.mode === '2d' ? '2D 5-arg drawElementImage()'
        : 'Plain HTML';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const tx = state.spring.x.toFixed(2);
  const ty = state.spring.y.toFixed(2);
  const motionTag = isReducedMotion() ? 'reduced' : state.pointerActive ? 'pointer' : state.autoTilt ? 'auto' : 'still';
  hudEl.textContent =
    `${route} · ${THEMES[state.theme].label} · tilt (${tx}, ${ty}) · split ${state.splitPx} px · ${motionTag} · ${mp} MP · ${state.uploads} uploads`;
}

// #region gl-paint
function syncHitGeometry(geom, cw, ch, force = false) {
  if (state.mode === 'plain' || !('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  if (!(cw > 0 && ch > 0)) return;
  const elemW = fgLayer.offsetWidth || POSTER_W;
  const unitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${elemW}`;
  if (state.unitCache.key !== unitKey && canvas.width > 0) {
    state.unitCache.unit = geometryUnit(canvas, fgLayer, elemW);
    state.unitCache.key = unitKey;
    state.lastGeoVals = new WeakMap();
  }
  const unit = state.unitCache.unit || 1;

  for (let i = 0; i < LAYERS.length; i++) {
    const el = LAYERS[i];
    const cssMat = geom.layers[i].cssMatrix;
    const target = cssMat ? new DOMMatrix().scale(unit, unit, 1).multiply(cssMat) : OFFSTAGE;
    if (!target) continue;
    const vals = target.toFloat32Array();
    const prev = state.lastGeoVals.get(el);
    if (!force && prev && vals.every((v, k) => Math.abs(v - prev[k]) < 1e-4)) continue;
    state.lastGeoVals.set(el, vals);
    canvas.updateElementGeometry(el, { canvasTransform: target });
    el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
  }
}

function uploadDirtyLayers() {
  if (!state.hasPainted || !stage || stage.lost) return false;
  for (const el of LAYERS) {
    if (!dirtyLayers.has(el) && stage.has(el)) continue;
    try {
      const tex = stage.upload(el);
      if (!tex) return false;
      layerTexInfo.set(el, tex);
      dirtyLayers.delete(el);
      state.uploads++;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        canvas.requestPaint?.();
        return false;
      }
      throw err;
    }
  }
  return layerTexInfo.has(bgLayer) && layerTexInfo.has(midLayer) && layerTexInfo.has(fgLayer);
}

function drawWebGLPasses(forceGeo = false, allowUpload = false) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = canvasCssBox();
  if (!(cw > 0 && ch > 0)) return;
  const theme = THEMES[state.theme];
  if (!stage.begin(theme.clear)) return;

  if (allowUpload) {
    if (!uploadDirtyLayers()) return;
  } else if (!stage.has(bgLayer) || !stage.has(midLayer) || !stage.has(fgLayer)) {
    canvas.requestPaint?.();
    return;
  }

  const texBg = layerTexInfo.get(bgLayer);
  const texMid = layerTexInfo.get(midLayer);
  const texFg = layerTexInfo.get(fgLayer);
  if (!texBg || !texMid || !texFg) return;

  const elemW = bgLayer.offsetWidth || POSTER_W;
  const elemH = bgLayer.offsetHeight || POSTER_H;
  const geom = buildPosterMatrices(cw, ch, elemW, elemH, state.spring.x, state.spring.y, state.splitPx, state.maxTiltDeg);

  drawPosterWebGLScene(
    stage,
    canvas,
    { bg: bgLayer, mid: midLayer, fg: fgLayer },
    geom,
    {
      cw,
      ch,
      tiltX: state.spring.x,
      tiltY: state.spring.y,
      splitPx: state.splitPx,
      sheen: 1.0,
      accent: theme.accent,
      trailer: state.trailerPlaying,
      reduced: isReducedMotion(),
      texBg,
      texMid,
      texFg,
    }
  );

  syncHitGeometry(geom, cw, ch, forceGeo);
  updateHud();
}
// #endregion gl-paint

function draw2DPass(forceGeo = false) {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = canvasCssBox();
  if (!(cw > 0 && ch > 0)) return;
  const elemW = bgLayer.offsetWidth || POSTER_W;
  const elemH = bgLayer.offsetHeight || POSTER_H;
  const geom = buildPosterMatrices(cw, ch, elemW, elemH, state.spring.x, state.spring.y, state.splitPx, state.maxTiltDeg);
  drawPoster2DScene(ctx2d, canvas, cw, ch, LAYERS, geom, state.spring.x, state.spring.y, state.splitPx, THEMES[state.theme].accent);
  syncHitGeometry(geom, cw, ch, forceGeo);
  updateHud();
}

function drawCurrentFrame(forceGeo = false, allowUpload = false) {
  if (state.mode === 'webgl') drawWebGLPasses(forceGeo, allowUpload);
  else if (state.mode === '2d') draw2DPass(forceGeo);
}

// ---------------- Fallbacks & Backend Init ----------------

function enterPlainFallback(reason, { keepForRestore = false } = {}) {
  state.mode = 'plain';
  stageBox.classList.add('is-plain');
  for (const el of LAYERS) {
    el.inert = false;
    if (el.parentElement !== plainHost) plainHost.append(el);
  }
  routeNoteEl.textContent = reason;
  updateHud();
  if (!keepForRestore) stopLoop();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const el of LAYERS) {
    if (el.parentElement !== canvas) canvas.append(el);
    dirtyLayers.add(el);
  }
  state.unitCache.key = '';
  state.lastGeoVals = new WeakMap();
}

function wireCanvasListeners() {
  canvas.addEventListener('paint', (e) => {
    state.paints++;
    state.hasPainted = true;
    if (e.changedElements && e.changedElements.length) {
      for (const changed of e.changedElements) {
        for (const el of LAYERS) {
          if (el === changed || el.contains(changed)) dirtyLayers.add(el);
        }
      }
    } else {
      for (const el of LAYERS) {
        if (!stage?.has(el)) dirtyLayers.add(el);
      }
    }
    if (state.mode === 'webgl' && stage && !stage.lost) {
      drawWebGLPasses(true, true);
    } else if (state.mode === '2d' && ctx2d) {
      draw2DPass(true);
    }
    startLoop();
  });

  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost, so the poster moved to plain HTML.', { keepForRestore: true });
    }
  });

  canvas.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      routeNoteEl.textContent = '2D canvas context restored using 5-argument drawElementImage().';
      canvas.requestPaint?.();
      startLoop();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: POSTER_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          state.hasPainted = false;
          layerTexInfo.clear();
          for (const el of LAYERS) dirtyLayers.add(el);
          enterPlainFallback('The WebGL 2 context was lost, so the poster moved to plain HTML until restored.', { keepForRestore: true });
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          layerTexInfo.clear();
          exitPlainFallback();
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context with premultiplied texElementSubImage2D()).';
          canvas.requestPaint?.();
          startLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.mode = 'webgl';
      routeNoteEl.textContent = 'Drawn with one ElementGL WebGL 2 context compositing three drawable HTML layers.';
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
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; using 5-argument drawElementImage() 2D parallax.';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the poster layers sit in plain HTML.');
}

// ---------------- Animation Loop ----------------

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function springSettled() {
  return (
    Math.abs(state.targetTiltX - state.spring.x) <= 0.001 &&
    Math.abs(state.targetTiltY - state.spring.y) <= 0.001 &&
    Math.abs(state.spring.vx) <= 0.002 &&
    Math.abs(state.spring.vy) <= 0.002
  );
}

function shouldRunLoop() {
  if (state.mode === 'plain' || !state.onScreen || document.hidden) return false;
  if (shouldAutoTilt()) return true;
  if (state.trailerPlaying && !isReducedMotion()) return true;
  if (state.pointerActive || state.dragging) return !springSettled();
  return !isReducedMotion() && !springSettled();
}

function startLoop() {
  if (!state.rafId && shouldRunLoop()) {
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  state.rafId = 0;
  if (!shouldRunLoop()) return;
  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;

  if (shouldAutoTilt()) {
    state.autoSec += dt;
    const next = autoTiltTarget(state.autoSec, false);
    state.targetTiltX = next.x;
    state.targetTiltY = next.y;
  }

  stepTiltSpring(state.spring, state.targetTiltX, state.targetTiltY, dt, isReducedMotion());
  if (state.hasPainted) {
    if (dirtyLayers.size > 0) canvas.requestPaint?.();
    else drawCurrentFrame(false, false);
  }
  if (shouldRunLoop()) state.rafId = requestAnimationFrame(tick);
}

// ---------------- UI Interactions ----------------

function markDirty(layers) {
  for (const el of layers) dirtyLayers.add(el);
  if (state.mode !== 'plain') canvas.requestPaint?.();
}

function applyTheme(key) {
  const t = THEMES[key] || THEMES.orbit;
  state.theme = t.id;
  for (const el of LAYERS) el.dataset.theme = t.id;
  bgArtSvg.innerHTML = t.bgPaths;
  midFormat.textContent = t.format;
  midRating.textContent = t.rating;
  midRuntime.textContent = t.runtime;
  midEmblem.innerHTML = t.emblemSvg;
  midKicker.textContent = t.kicker;
  midEdition.textContent = t.edition;
  titleInput.value = t.title;
  subtitleEl.textContent = t.subtitle;
  for (const btn of themeBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeBtn === t.id));
  }
  markDirty(LAYERS);
  updateHud();
}

function syncFgStatus() {
  fgStatusPill.textContent = state.trailerPlaying
    ? 'TRAILER PLAYING'
    : state.watchlisted
      ? 'SAVED TO WATCHLIST'
      : 'READY TO STREAM';
  btnTrailer.setAttribute('aria-pressed', String(state.trailerPlaying));
  btnTrailer.textContent = state.trailerPlaying ? 'Stop trailer' : 'Play trailer';
  btnWatchlist.setAttribute('aria-pressed', String(state.watchlisted));
  btnWatchlist.textContent = state.watchlisted ? '✓ In Watchlist' : '+ Watchlist';
  markDirty([fgLayer]);
}

btnTrailer.addEventListener('click', () => {
  state.trailerPlaying = !state.trailerPlaying;
  syncFgStatus();
  startLoop();
});

btnWatchlist.addEventListener('click', () => {
  state.watchlisted = !state.watchlisted;
  syncFgStatus();
});

titleInput.addEventListener('input', () => {
  markDirty([fgLayer]);
});

for (const btn of themeBtns) {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeBtn));
}

btnCentre.addEventListener('click', () => {
  state.pointerActive = false;
  state.dragging = false;
  state.targetTiltX = 0;
  state.targetTiltY = 0;
  state.autoSec = 0;
  if (isReducedMotion()) {
    stepTiltSpring(state.spring, 0, 0, 0.016, true);
    drawCurrentFrame(true, false);
  } else {
    startLoop();
  }
  updateHud();
});

ctlAuto.addEventListener('change', () => {
  state.autoTilt = ctlAuto.checked;
  if (state.autoTilt && isReducedMotion()) {
    ctlReduced.checked = false;
    state.reducedOverride = false;
  }
  if (!state.autoTilt && !state.pointerActive && !state.dragging) {
    state.targetTiltX = 0;
    state.targetTiltY = 0;
  }
  startLoop();
  updateHud();
});

function syncReducedState(nextReduced) {
  state.reducedOverride = Boolean(nextReduced);
  ctlReduced.checked = state.reducedOverride;
  if (isReducedMotion()) {
    stopLoop();
    state.targetTiltX = 0;
    state.targetTiltY = 0;
    stepTiltSpring(state.spring, 0, 0, 0.016, true);
    if (state.hasPainted) drawCurrentFrame(true, false);
  } else {
    startLoop();
  }
  updateHud();
}

ctlReduced.addEventListener('change', () => syncReducedState(ctlReduced.checked));
reducedQuery.addEventListener?.('change', () => syncReducedState(reducedQuery.matches));

ctlSplit.addEventListener('input', () => {
  state.splitPx = clamp(Number(ctlSplit.value) || 0, 0, 40);
  outSplit.textContent = `${state.splitPx} px`;
  if (state.hasPainted) drawCurrentFrame(true, false);
  updateHud();
});

ctlTilt.addEventListener('input', () => {
  state.maxTiltDeg = clamp(Number(ctlTilt.value) || 0, 0, 20);
  outTilt.textContent = `${state.maxTiltDeg}°`;
  if (state.hasPainted) drawCurrentFrame(true, false);
  updateHud();
});

// ---------------- Pointer Tilt & Hit-Test Refresh ----------------

function setTiltFromPointer(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const nx = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
  const ny = clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  state.targetTiltX = nx;
  state.targetTiltY = ny;
  if (isReducedMotion()) {
    stepTiltSpring(state.spring, nx, ny, 0.016, true);
    if (state.hasPainted) drawCurrentFrame(true, false);
  } else {
    startLoop();
  }
}

const isInteractiveControl = (target) =>
  target instanceof Element && Boolean(target.closest('button, input, a, label'));

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode === 'plain') return;
  refreshGeoNow();
  if (isInteractiveControl(e.target)) return;
  state.pointerActive = true;
  state.dragging = true;
  state.pointerId = e.pointerId;
  canvas.classList.add('is-dragging');
  canvas.setPointerCapture?.(e.pointerId);
  setTiltFromPointer(e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  if (state.mode === 'plain') return;
  refreshGeoNow();
  if (state.dragging && e.pointerId === state.pointerId) {
    setTiltFromPointer(e.clientX, e.clientY);
    return;
  }
  if (e.pointerType === 'mouse' && !state.dragging) {
    state.pointerActive = true;
    setTiltFromPointer(e.clientX, e.clientY);
  }
});

function releasePointer(e) {
  if (e.pointerId !== undefined && state.pointerId !== null && e.pointerId !== state.pointerId) return;
  state.dragging = false;
  state.pointerId = null;
  canvas.classList.remove('is-dragging');
  if (e.pointerType !== 'mouse' || e.type === 'pointerleave') {
    state.pointerActive = false;
    if (!shouldAutoTilt()) {
      state.targetTiltX = 0;
      state.targetTiltY = 0;
    }
    if (!isReducedMotion()) startLoop();
  }
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('pointerleave', releasePointer);

function refreshGeoNow() {
  if (state.mode === 'plain' || !state.hasPainted) return;
  const { cw, ch } = canvasCssBox();
  if (!(cw > 0 && ch > 0)) return;
  const elemW = bgLayer.offsetWidth || POSTER_W;
  const elemH = bgLayer.offsetHeight || POSTER_H;
  const geom = buildPosterMatrices(cw, ch, elemW, elemH, state.spring.x, state.spring.y, state.splitPx, state.maxTiltDeg);
  syncHitGeometry(geom, cw, ch);
}

canvas.addEventListener('pointerdown', refreshGeoNow, true);
canvas.addEventListener('pointermove', refreshGeoNow, true);
canvas.addEventListener('focusin', refreshGeoNow);

// ---------------- Observers & Boot ----------------

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) stopLoop();
    else if (state.hasPainted) {
      drawCurrentFrame(true, false);
      startLoop();
    }
  }, { rootMargin: '120px' }).observe(stageBox);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.mode === 'plain') return;
    const { cw, ch } = canvasCssBox();
    if (!(cw > 0 && ch > 0)) return;
    state.unitCache.key = '';
    state.lastGeoVals = new WeakMap();
    if (state.hasPainted) drawCurrentFrame(true, false);
    else canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (state.onScreen && state.hasPainted) {
    drawCurrentFrame(true, false);
    startLoop();
  }
});

updateHud();
initBackend();

// ---------------- Tap-Gated Live Checks (Isolated testStage Fixtures) ----------------

const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function settleGfx(baseActive) {
  if (!window.__gfx?.active) return;
  const deadline = performance.now() + 900;
  while (window.__gfx.active() > baseActive && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 120));
  }
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeFixturePoster(w = 240, h = 300, { mode = 'layers' } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;background:#070a12;`;

  const fw = 180;
  const fh = 240;
  const baseLayerStyle = `position:absolute;left:0;top:0;width:${fw}px;height:${fh}px;box-sizing:border-box;pointer-events:none;`;

  const bg = document.createElement('div');
  bg.setAttribute('drawable', '');
  bg.style.cssText = `${baseLayerStyle}background:#0c1426;`;

  const mid = document.createElement('div');
  mid.setAttribute('drawable', '');
  mid.style.cssText = `${baseLayerStyle}background:transparent;`;

  const fg = document.createElement('div');
  fg.setAttribute('drawable', '');
  fg.style.cssText = `${baseLayerStyle}background:transparent;`;

  if (mode === 'layers') {
    const midBand = document.createElement('div');
    midBand.style.cssText = 'position:absolute;left:36px;top:64px;width:108px;height:44px;background:#38bdf8;border-radius:8px;';
    mid.append(midBand);

    const fgBadge = document.createElement('div');
    fgBadge.style.cssText = 'position:absolute;left:42px;top:148px;width:96px;height:42px;background:#f59e0b;border-radius:8px;';
    fg.append(fgBadge);
  } else if (mode === 'parallax') {
    // Dark uniform background + crisp bright foreground center marker so shift & corner sheen both measure cleanly.
    const marker = document.createElement('div');
    marker.style.cssText = 'position:absolute;left:70px;top:100px;width:40px;height:40px;background:#facc15;border-radius:6px;';
    fg.append(marker);
  } else if (mode === 'buttons') {
    const btnTrailerFx = document.createElement('button');
    btnTrailerFx.type = 'button';
    btnTrailerFx.textContent = 'Play trailer';
    btnTrailerFx.style.cssText =
      'position:absolute;left:14px;top:172px;width:74px;height:42px;background:#60a5fa;color:#060913;' +
      'border:0;border-radius:8px;font:700 11px system-ui;pointer-events:auto;';

    const btnWatchFx = document.createElement('button');
    btnWatchFx.type = 'button';
    btnWatchFx.textContent = 'Watchlist';
    btnWatchFx.style.cssText =
      'position:absolute;left:94px;top:172px;width:72px;height:42px;background:#e2e8f0;color:#060913;' +
      'border:0;border-radius:8px;font:700 11px system-ui;pointer-events:auto;';
    fg.append(btnTrailerFx, btnWatchFx);
    cv.append(bg, mid, fg);
    return { cv, bg, mid, fg, fw, fh, btnTrailerFx, btnWatchFx };
  }

  cv.append(bg, mid, fg);
  return { cv, bg, mid, fg, fw, fh };
}

function uploadFixtureAll(g, layers) {
  const texBg = g.upload(layers.bg);
  const texMid = g.upload(layers.mid);
  const texFg = g.upload(layers.fg);
  return { texBg, texMid, texFg };
}

function renderFixture(g, cv, layers, textures, w, h, tiltX, tiltY, splitPx) {
  const geom = buildPosterMatrices(w, h, layers.fw, layers.fh, tiltX, tiltY, splitPx, 15);
  drawPosterWebGLScene(g, cv, layers, geom, {
    cw: w,
    ch: h,
    tiltX,
    tiltY,
    splitPx,
    sheen: 1.0,
    accent: [0.38, 0.65, 0.98],
    trailer: false,
    reduced: true,
    texBg: textures.texBg,
    texMid: textures.texMid,
    texFg: textures.texFg,
  });
  return geom;
}

function findYellowMarkerCentroid(gl, cv, w, h) {
  let sumX = 0;
  let sumY = 0;
  let hits = 0;
  for (let y = 24; y < h - 24; y += 3) {
    for (let x = 24; x < w - 24; x += 3) {
      const px = readCssPixel(gl, cv, w, h, x, y);
      if (px[0] > 185 && px[1] > 150 && px[2] < 110) {
        sumX += x;
        sumY += y;
        hits++;
      }
    }
  }
  return {
    hits,
    x: hits ? sumX / hits : -1,
    y: hits ? sumY / hits : -1,
  };
}

runTests(testsBody, [
  {
    name: 'All 3 drawable layer textures upload cleanly via texElementSubImage2D() with glErr === 0',
    expect: 'pass',
    why: 'Builds a 3-layer fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload() on each layer, renders and reads back background, midground and foreground pixels.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 220;
      const H = 280;
      const layers = makeFixturePoster(W, H, { mode: 'layers' });
      testStage().append(layers.cv);
      let g = null;
      try {
        g = new ElementGL(layers.cv, { fragment: POSTER_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.02, 0.03, 0.06, 1.0]);
        await nextPaint(layers.cv);
        g.begin([0.02, 0.03, 0.06, 1.0]);
        const textures = uploadFixtureAll(g, layers);
        const geom = renderFixture(g, layers.cv, layers, textures, W, H, 0, 0, 24);
        const err = g.gl.getError();

        const midPt = projectPointCss(geom.layers[1].cssMatrix, 90, 86);
        const fgPt = projectPointCss(geom.layers[2].cssMatrix, 90, 169);
        const bgPt = projectPointCss(geom.layers[0].cssMatrix, 90, 32);

        const bgPx = readCssPixel(g.gl, layers.cv, W, H, bgPt.x, bgPt.y);
        const midPx = readCssPixel(g.gl, layers.cv, W, H, midPt.x, midPt.y);
        const fgPx = readCssPixel(g.gl, layers.cv, W, H, fgPt.x, fgPt.y);

        return need(
          err === 0 &&
            textures.texBg?.w > 0 &&
            textures.texMid?.w > 0 &&
            textures.texFg?.w > 0 &&
            midPx[2] > 160 &&
            fgPx[0] > 180 &&
            fgPx[1] > 110 &&
            bgPx[2] > bgPx[0],
          `glErr=${err}, bg=${textures.texBg.w}×${textures.texBg.h}, mid=${textures.texMid.w}×${textures.texMid.h}, fg=${textures.texFg.w}×${textures.texFg.h}, midPx=[${Array.from(midPx)}], fgPx=[${Array.from(fgPx)}]`
        );
      } finally {
        g?.dispose();
        layers.cv.remove();
        window.__gfx?.retire?.(layers.cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Pointer tilt (-1,-1) vs (+1,+1) shifts foreground relative to background and sweeps specular corner sheen',
    expect: 'pass',
    why: 'Steps the tilt spring with explicit timestamps t, then renders at (-1,-1) vs (+1,+1) with 28 px layer split to measure foreground centroid travel and diagonal corner specular highlight shift.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const sp = { x: 0, y: 0, vx: 0, vy: 0 };
      const tgt = autoTiltTarget(1.25, false);
      for (let t = 0; t < 0.8; t += 0.016) stepTiltSpring(sp, tgt.x, tgt.y, 0.016, false);

      const W = 240;
      const H = 300;
      const layers = makeFixturePoster(W, H, { mode: 'parallax' });
      testStage().append(layers.cv);
      let g = null;
      try {
        g = new ElementGL(layers.cv, { fragment: POSTER_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.02, 0.03, 0.06, 1.0]);
        await nextPaint(layers.cv);
        g.begin([0.02, 0.03, 0.06, 1.0]);
        const textures = uploadFixtureAll(g, layers);

        const gA = renderFixture(g, layers.cv, layers, textures, W, H, -1, -1, 28);
        const fgA = findYellowMarkerCentroid(g.gl, layers.cv, W, H);
        const tlA = projectPointCss(gA.layers[0].cssMatrix, 34, 44);
        const brA = projectPointCss(gA.layers[0].cssMatrix, layers.fw - 34, layers.fh - 44);
        const lum = (p) => p[0] * 0.25 + p[1] * 0.5 + p[2] * 0.25;
        const tlLumA = lum(readCssPixel(g.gl, layers.cv, W, H, tlA.x, tlA.y));
        const brLumA = lum(readCssPixel(g.gl, layers.cv, W, H, brA.x, brA.y));

        g.begin([0.02, 0.03, 0.06, 1.0]);
        const gB = renderFixture(g, layers.cv, layers, textures, W, H, 1, 1, 28);
        const fgB = findYellowMarkerCentroid(g.gl, layers.cv, W, H);
        const tlB = projectPointCss(gB.layers[0].cssMatrix, 34, 44);
        const brB = projectPointCss(gB.layers[0].cssMatrix, layers.fw - 34, layers.fh - 44);
        const tlLumB = lum(readCssPixel(g.gl, layers.cv, W, H, tlB.x, tlB.y));
        const brLumB = lum(readCssPixel(g.gl, layers.cv, W, H, brB.x, brB.y));

        const dx = fgB.x - fgA.x;
        const dy = fgB.y - fgA.y;
        const sheenSwapped = tlLumA > brLumA + 25 && brLumB > tlLumB + 25;

        return need(
          sp.x !== 0 && fgA.hits >= 8 && fgB.hits >= 8 && dx > 12 && dy > 10 && sheenSwapped,
          `spring=(${sp.x.toFixed(2)},${sp.y.toFixed(2)}), fgShift=(${dx.toFixed(1)}, ${dy.toFixed(1)}) px, (-1,-1) TL/BR=${tlLumA.toFixed(0)}/${brLumA.toFixed(0)}, (+1,+1) TL/BR=${tlLumB.toFixed(0)}/${brLumB.toFixed(0)}`
        );
      } finally {
        g?.dispose();
        layers.cv.remove();
        window.__gfx?.retire?.(layers.cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Raising Split layers Z-separation (0 -> 36 px) increases inter-layer parallax shift',
    expect: 'pass',
    why: 'Tilts the poster rightward (+1, 0) first with 0 px Z-separation (flush) and then with 36 px Z-separation, measuring how far the foreground marker shifts relative to the background centre and verifying cast shadow darkening opposite light.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240;
      const H = 300;
      const layers = makeFixturePoster(W, H, { mode: 'parallax' });
      testStage().append(layers.cv);
      let g = null;
      try {
        g = new ElementGL(layers.cv, { fragment: POSTER_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.02, 0.03, 0.06, 1.0]);
        await nextPaint(layers.cv);
        g.begin([0.02, 0.03, 0.06, 1.0]);
        const textures = uploadFixtureAll(g, layers);

        const g0 = renderFixture(g, layers.cv, layers, textures, W, H, 1, 0, 0);
        const fg0 = findYellowMarkerCentroid(g.gl, layers.cv, W, H);
        const offset0 = fg0.x - g0.cardCenter.x;

        g.begin([0.02, 0.03, 0.06, 1.0]);
        const g36 = renderFixture(g, layers.cv, layers, textures, W, H, 1, 0, 36);
        const fg36 = findYellowMarkerCentroid(g.gl, layers.cv, W, H);
        const offset36 = fg36.x - g36.cardCenter.x;

        // Shadow from centred marker at (+1, 0) tilt shifts opposite light (toward u < 0.5).
        const shPt = projectPointCss(g36.layers[0].cssMatrix, 60, 125);
        const litPt = projectPointCss(g36.layers[0].cssMatrix, 146, 125);
        const shPx = readCssPixel(g.gl, layers.cv, W, H, shPt.x, shPt.y);
        const litPx = readCssPixel(g.gl, layers.cv, W, H, litPt.x, litPt.y);
        const shLum = shPx[0] + shPx[1] + shPx[2];
        const litLum = litPx[0] + litPx[1] + litPx[2];

        return need(
          fg0.hits >= 8 && fg36.hits >= 8 && Math.abs(offset0) < 3.0 && offset36 - offset0 > 10.0 && litLum > shLum + 15,
          `split=0 px offset=${offset0.toFixed(1)} px -> split=36 px offset=${offset36.toFixed(1)} px (+${(offset36 - offset0).toFixed(1)} px), shadowSide=${shLum} vs litSide=${litLum}`
        );
      } finally {
        g?.dispose();
        layers.cv.remove();
        window.__gfx?.retire?.(layers.cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Projective updateElementGeometry() keeps tilted foreground buttons clickable',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled projective DOMMatrix transforms to all 3 layers at tilt (0.85, -0.75) and 32 px split, tests elementsFromPoint() at both tilted button centres and clicks Play trailer.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 260;
      const H = 310;
      const layers = makeFixturePoster(W, H, { mode: 'buttons' });
      testStage().append(layers.cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(layers.cv, { fragment: POSTER_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0.02, 0.03, 0.06, 1.0]);
        } else {
          layers.cv.width = W;
          layers.cv.height = H;
          layers.cv.getContext('2d');
        }
        await nextPaint(layers.cv);
        const geom = buildPosterMatrices(W, H, layers.fw, layers.fh, 0.85, -0.75, 32, 15);
        if (g) {
          g.begin([0.02, 0.03, 0.06, 1.0]);
          const textures = uploadFixtureAll(g, layers);
          renderFixture(g, layers.cv, layers, textures, W, H, 0.85, -0.75, 32);
        }

        const unit = geometryUnit(layers.cv, layers.fg, layers.fw);
        const layerEls = [layers.bg, layers.mid, layers.fg];
        for (let i = 0; i < layerEls.length; i++) {
          const target = new DOMMatrix().scale(unit, unit, 1).multiply(geom.layers[i].cssMatrix);
          layers.cv.updateElementGeometry(layerEls[i], { canvasTransform: target });
          layerEls[i].dataset.hitTick = layerEls[i].dataset.hitTick === '1' ? '0' : '1';
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        let clicks = 0;
        layers.btnTrailerFx.addEventListener('click', () => { clicks++; });
        const rect = layers.cv.getBoundingClientRect();
        const ptTrailer = projectPointCss(geom.layers[2].cssMatrix, 51, 193);
        const ptWatch = projectPointCss(geom.layers[2].cssMatrix, 130, 193);

        const hitsTrailer = document.elementsFromPoint(rect.left + ptTrailer.x, rect.top + ptTrailer.y);
        const hitsWatch = document.elementsFromPoint(rect.left + ptWatch.x, rect.top + ptWatch.y);
        const okTrailer = hitsTrailer.includes(layers.btnTrailerFx);
        const okWatch = hitsWatch.includes(layers.btnWatchFx);
        if (okTrailer) layers.btnTrailerFx.click();

        return need(
          okTrailer && okWatch && clicks === 1,
          `trailer (${ptTrailer.x.toFixed(1)},${ptTrailer.y.toFixed(1)})=${okTrailer} [${hitsTrailer[0]?.tagName}], watchlist (${ptWatch.x.toFixed(1)},${ptWatch.y.toFixed(1)})=${okWatch} [${hitsWatch[0]?.tagName}], clicks=${clicks}`
        );
      } finally {
        g?.dispose();
        layers.cv.remove();
        window.__gfx?.retire?.(layers.cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'webglcontextlost/restored rescues layers and 5-arg 2D drawElementImage() fallback renders',
    expect: 'pass',
    why: 'Tests cancelable webglcontextlost and webglcontextrestored on an ElementGL fixture (or contextlost on 2D when WebGL 2 is absent), then renders the 3 layers via 5-argument drawElementImage() and reads back via a plain drawImage() copy.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported) throw new Error('HTML-in-canvas drawElementImage() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 220;
      const H = 280;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const layers = makeFixturePoster(W, H, { mode: 'layers' });
      wrap.append(layers.cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      let rescuedToPlain = false;
      let err = 0;
      let fallback2dOk = false;
      let plainCopy = null;

      try {
        if (glSupported) {
          g = new ElementGL(layers.cv, {
            fragment: POSTER_FRAG,
            attributes: { alpha: false, preserveDrawingBuffer: true },
            onLost: () => {
              lostOk = true;
              plain.hidden = false;
              plain.append(layers.bg, layers.mid, layers.fg);
            },
            onRestored: () => {
              restoredOk = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              plain.hidden = true;
              layers.cv.append(layers.bg, layers.mid, layers.fg);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0.02, 0.03, 0.06, 1.0]);
          await nextPaint(layers.cv);
          g.begin([0.02, 0.03, 0.06, 1.0]);
          uploadFixtureAll(g, layers);

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          layers.cv.dispatchEvent(lostEv);
          rescuedToPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(layers.fg);

          layers.cv.dispatchEvent(new Event('webglcontextrestored'));
          g.begin([0.02, 0.03, 0.06, 1.0]);
          await nextPaint(layers.cv);
          g.begin([0.02, 0.03, 0.06, 1.0]);
          const texAfter = uploadFixtureAll(g, layers);
          renderFixture(g, layers.cv, layers, texAfter, W, H, 0.5, -0.4, 24);
          err = g.gl.getError();
        } else {
          const c = layers.cv.getContext('2d');
          layers.cv.addEventListener('contextlost', (e) => {
            e.preventDefault();
            lostOk = true;
            plain.hidden = false;
            plain.append(layers.bg, layers.mid, layers.fg);
          });
          layers.cv.addEventListener('contextrestored', () => {
            restoredOk = true;
            plain.hidden = true;
            layers.cv.append(layers.bg, layers.mid, layers.fg);
          });
          await nextPaint(layers.cv);
          const geomInit = buildPosterMatrices(W, H, layers.fw, layers.fh, 0, 0, 24, 14);
          drawPoster2DScene(c, layers.cv, W, H, [layers.bg, layers.mid, layers.fg], geomInit, 0, 0, 24);
          const lostEv = new Event('contextlost', { cancelable: true });
          layers.cv.dispatchEvent(lostEv);
          rescuedToPlain = lostEv.defaultPrevented && lostOk && plain.contains(layers.fg);
          layers.cv.dispatchEvent(new Event('contextrestored'));
        }

        // Separate 5-argument 2D fallback fixture, read via a plain willReadFrequently copy.
        const fx2d = makeFixturePoster(W, H, { mode: 'layers' });
        wrap.append(fx2d.cv);
        const c2d = fx2d.cv.getContext('2d');
        await nextPaint(fx2d.cv);
        const geom2d = buildPosterMatrices(W, H, fx2d.fw, fx2d.fh, 0.7, -0.5, 24, 14);
        drawPoster2DScene(c2d, fx2d.cv, W, H, [fx2d.bg, fx2d.mid, fx2d.fg], geom2d, 0.7, -0.5, 24);

        plainCopy = document.createElement('canvas');
        plainCopy.width = fx2d.cv.width;
        plainCopy.height = fx2d.cv.height;
        const copyCtx = plainCopy.getContext('2d', { willReadFrequently: true });
        copyCtx.drawImage(fx2d.cv, 0, 0);
        const data = copyCtx.getImageData(0, 0, plainCopy.width, plainCopy.height).data;
        let brightAmber = 0;
        let brightCyan = 0;
        for (let i = 0; i < data.length; i += 16) {
          if (data[i] > 170 && data[i + 1] > 100 && data[i + 2] < 80) brightAmber++;
          if (data[i] < 120 && data[i + 1] > 140 && data[i + 2] > 180) brightCyan++;
        }
        fallback2dOk = brightAmber > 15 && brightCyan > 15 && (window.__gfx?.draws?.wrong ?? 0) === 0;
        fx2d.cv.remove();
        window.__gfx?.retire?.(fx2d.cv);

        return need(
          rescuedToPlain && restoredOk && (!g || !g.lost) && layers.cv.contains(layers.fg) && err === 0 && fallback2dOk,
          `rescuedToPlain=${rescuedToPlain}, restored=${restoredOk}, glErr=${err}, 2dFallback=${fallback2dOk} (cyan=${brightCyan}, amber=${brightAmber}, wrongDraws=${window.__gfx?.draws?.wrong ?? 0})`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        plainCopy = null;
        window.__gfx?.retire?.(layers.cv);
        await settleGfx(baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'tvos-poster stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !stage.has(bgLayer) || !stage.has(midLayer) || !stage.has(fgLayer)) return 0;
          return state.uploads >= 3 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
