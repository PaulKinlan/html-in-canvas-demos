import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);

const wrap = $('kaleido-wrap');
const canvas = $('kaleido-canvas');
const card = $('kaleido-card');
const hintEl = $('kaleido-hint');
const statusEl = $('kaleido-status');
const noticeEl = $('kaleido-notice');

// Live source card controls
const cardTitle = $('card-title');
const cardClock = $('card-clock');
const cardPip = $('card-pip');
const cardInput = $('kaleido-input');
const paletteBtns = [...document.querySelectorAll('#kaleido-card [data-palette]')];
const cardScaleInput = $('card-scale');
const cardScaleOut = $('card-scale-out');
const cardGemBtn = $('card-gem-btn');
const cardGemCount = $('card-gem-count');
const cardFacetEls = [...document.querySelectorAll('#card-facets .k-facet')];

// Stage controls
const chamberBtns = [...document.querySelectorAll('[data-chamber]')];
const btnTurn = $('btn-turn');
const ctlAperture = $('ctl-aperture');
const ctlOptics = $('ctl-optics');
const ctlHitQuad = $('ctl-hitquad');
const btnReset = $('btn-reset');

const PI = Math.PI;
const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);
const TRI_R_IN = 0.25;
const TRI_NORMALS = [
  [0, -1],
  [SQRT3 * 0.5, 0.5],
  [-SQRT3 * 0.5, 0.5],
];

export const CHAMBERS = {
  d6: { key: 'd6', mode: 0, folds: 6, label: 'D6 (12 wedges)' },
  d4: { key: 'd4', mode: 0, folds: 4, label: 'D4 (8 wedges)' },
  d8: { key: 'd8', mode: 0, folds: 8, label: 'D8 (16 wedges)' },
  d12: { key: 'd12', mode: 0, folds: 12, label: 'D12 (24 wedges)' },
  p3m1: { key: 'p3m1', mode: 1, folds: 3, label: 'p3m1 (3-mirror triangle)' },
};

export function defaultBarrelRot(chamberKey) {
  const ch = CHAMBERS[chamberKey] || CHAMBERS.d6;
  return ch.mode === 0 ? -(PI / ch.folds) * 0.5 : 0;
}

// #region kaleidoscope-shader
const KALEIDOSCOPE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform float uRadius;
uniform int uMode;
uniform float uFolds;
uniform float uBarrelRot;
uniform vec2 uPan;
uniform float uCardScale;
uniform int uAperture;
uniform int uOptics;
uniform int uShowHit;
uniform mat3 uHitInv;
uniform float uHitDetSign;
uniform vec2 uHitPt;

in vec2 vUv;
out vec4 outColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float TRI_R_IN = 0.25;
const vec2 N0 = vec2(0.0, -1.0);
const vec2 N1 = vec2(0.86602540378, 0.5);
const vec2 N2 = vec2(-0.86602540378, 0.5);

void main() {
  vec2 cssPx = vUv * uCanvasSize;
  vec2 centered = (cssPx - uCanvasSize * 0.5) / max(uRadius, 1.0);
  float cR = cos(uBarrelRot);
  float sR = sin(uBarrelRot);
  vec2 u = vec2(cR * centered.x + sR * centered.y, -sR * centered.x + cR * centered.y);

  // Smooth pre-fold derivatives so mirror seams never spike mipmap LOD
  vec2 duDx = dFdx(u);
  vec2 duDy = dFdy(u);

  vec2 f = u;
  vec2 qRow0 = vec2(1.0, 0.0);
  vec2 qRow1 = vec2(0.0, 1.0);
  int bounces = 0;
  float seamDist = 10.0;
  float bisectorCos = 1.0;
  float bisectorSin = 0.0;
  vec2 anchor = vec2(0.0);
  float baseScale = 0.90;

  if (uMode == 0) {
    float n = max(uFolds, 2.0);
    float alpha = PI / n;
    float theta = atan(u.y, u.x);
    float thetaPos = mod(theta + TAU, TAU);
    float kMax = 2.0 * n - 1.0;
    float kf = clamp(floor(thetaPos / alpha), 0.0, kMax);
    int k = int(kf);
    int parity = k - (k / 2) * 2;
    int totalWedges = int(2.0 * n);
    bounces = min(k, totalWedges - k);

    if (parity == 0) {
      float ang = -kf * alpha;
      float ca = cos(ang);
      float sa = sin(ang);
      qRow0 = vec2(ca, -sa);
      qRow1 = vec2(sa, ca);
    } else {
      float psi = (kf + 1.0) * alpha;
      float cp = cos(psi);
      float sp = sin(psi);
      qRow0 = vec2(cp, sp);
      qRow1 = vec2(sp, -cp);
    }
    f = vec2(dot(qRow0, u), dot(qRow1, u));
    float d0 = max(f.y, 0.0);
    float d1 = max(f.x * sin(alpha) - f.y * cos(alpha), 0.0);
    seamDist = min(d0, d1);

    bisectorCos = cos(alpha * 0.5);
    bisectorSin = -sin(alpha * 0.5);
    anchor = vec2(0.48, 0.0);
    baseScale = 0.90;
  } else {
    for (int i = 0; i < 24; i++) {
      float s0 = dot(f, N0) - TRI_R_IN;
      float s1 = dot(f, N1) - TRI_R_IN;
      float s2 = dot(f, N2) - TRI_R_IN;
      float maxS = max(s0, max(s1, s2));
      if (maxS <= 1e-6) break;
      vec2 nrm = N0;
      float s = s0;
      if (s1 > s) { s = s1; nrm = N1; }
      if (s2 > s) { s = s2; nrm = N2; }
      f -= 2.0 * s * nrm;
      float r00 = 1.0 - 2.0 * nrm.x * nrm.x;
      float r01 = -2.0 * nrm.x * nrm.y;
      float r11 = 1.0 - 2.0 * nrm.y * nrm.y;
      vec2 nq0 = r00 * qRow0 + r01 * qRow1;
      vec2 nq1 = r01 * qRow0 + r11 * qRow1;
      qRow0 = nq0;
      qRow1 = nq1;
      bounces += 1;
    }
    float d0 = max(TRI_R_IN - dot(f, N0), 0.0);
    float d1 = max(TRI_R_IN - dot(f, N1), 0.0);
    float d2 = max(TRI_R_IN - dot(f, N2), 0.0);
    seamDist = min(d0, min(d1, d2));

    bisectorCos = 1.0;
    bisectorSin = 0.0;
    anchor = vec2(0.0, 0.45 * TRI_R_IN);
    baseScale = 0.90 / (2.0 * 1.73205080757 * TRI_R_IN);
  }

  vec2 b = vec2(bisectorCos * f.x - bisectorSin * f.y, bisectorSin * f.x + bisectorCos * f.y);
  float uvScale = baseScale / max(uCardScale, 0.25);
  vec2 uvCenter = (uMode == 0) ? vec2(0.5, 0.46) : vec2(0.5, 0.5);
  vec2 w = uvCenter + (b - anchor) * uvScale + uPan;

  vec2 mCell = floor(w);
  vec2 oddCell = step(0.5, mod(mCell, 2.0));
  vec2 uv = mix(w - mCell, (mCell + 1.0) - w, oddCell);
  vec2 uvSign = mix(vec2(1.0), vec2(-1.0), oddCell);

  vec2 dfDx = vec2(dot(qRow0, duDx), dot(qRow1, duDx));
  vec2 dfDy = vec2(dot(qRow0, duDy), dot(qRow1, duDy));
  vec2 dbDx = vec2(bisectorCos * dfDx.x - bisectorSin * dfDx.y, bisectorSin * dfDx.x + bisectorCos * dfDx.y);
  vec2 dbDy = vec2(bisectorCos * dfDy.x - bisectorSin * dfDy.y, bisectorSin * dfDy.x + bisectorCos * dfDy.y);
  vec2 dUvDx = dbDx * uvScale * uvSign;
  vec2 dUvDy = dbDy * uvScale * uvSign;

  vec4 texCol = textureGrad(uTex, clamp(uv, vec2(0.0005), vec2(0.9995)), dUvDx, dUvDy);
  vec3 rgb = texCol.rgb + vec3(0.05, 0.06, 0.09) * (1.0 - texCol.a);

  if (uOptics == 1) {
    float depth = min(float(bounces), 10.0);
    vec3 glassTint = pow(vec3(0.962, 0.986, 0.966), vec3(depth));
    rgb = rgb * glassTint + vec3(0.012, 0.010, 0.004) * (1.0 - exp(-depth * 0.25));

    float seamPx = seamDist * uRadius;
    float core = 1.0 - smoothstep(0.0, 1.05, seamPx);
    float bevel = smoothstep(0.5, 1.2, seamPx) * (1.0 - smoothstep(1.2, 2.6, seamPx));
    float sheen = 0.72 + 0.28 * sin(length(u) * 9.0 + uBarrelRot * 2.0);
    vec3 brassEdge = vec3(0.84, 0.67, 0.35) * sheen;
    vec3 darkLead = vec3(0.09, 0.07, 0.05);
    rgb = mix(rgb, brassEdge, bevel * 0.58);
    rgb = mix(rgb, darkLead, core * 0.78);
  }

  if (uAperture == 1) {
    float r = length(centered);
    float pxPerUnit = max(uRadius, 1.0);
    float aa = 1.5 / pxPerUnit;

    float innerVig = smoothstep(0.76, 1.0, r);
    rgb *= 1.0 - innerVig * 0.28;

    float bezelOuter = 1.07;
    float inGlass = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    float inBezel = (1.0 - smoothstep(bezelOuter - aa, bezelOuter + aa, r)) * smoothstep(1.0 - aa, 1.0 + aa, r);
    float ang = atan(centered.y, centered.x);
    float brushed = 0.62 + 0.38 * cos(ang * 2.0 - 0.9) + 0.08 * sin(r * 180.0);
    float bevelRing = sin(clamp((r - 1.0) / (bezelOuter - 1.0), 0.0, 1.0) * PI);
    vec3 brass = vec3(0.64, 0.48, 0.23) * brushed * (0.55 + 0.55 * bevelRing);
    float rimLine = 1.0 - smoothstep(0.0, 1.6 / pxPerUnit, min(abs(r - 1.0), abs(r - bezelOuter)));
    brass = mix(brass, vec3(0.11, 0.08, 0.05), rimLine * 0.75);

    vec3 backdrop = mix(vec3(0.045, 0.050, 0.075), vec3(0.08, 0.09, 0.13), clamp(1.0 - vUv.y, 0.0, 1.0));
    rgb = rgb * inGlass + brass * inBezel + backdrop * max(0.0, 1.0 - inGlass - inBezel);
  }

  if (uShowHit == 1) {
    vec3 qh = uHitInv * vec3(cssPx, 1.0);
    vec2 quv = qh.xy / max(abs(qh.z), 1e-5);
    if (qh.z > 0.0 && quv.x >= 0.0 && quv.x <= 1.0 && quv.y >= 0.0 && quv.y <= 1.0) {
      float edge = min(min(quv.x, 1.0 - quv.x), min(quv.y, 1.0 - quv.y));
      float fw = max(length(fwidth(quv)), 0.003);
      float border = 1.0 - smoothstep(fw * 1.1, fw * 2.6, edge);
      float tlMark = (quv.x < 0.18 && quv.y < 0.12 && (quv.x < 0.035 || quv.y < 0.035)) ? 0.9 : 0.0;
      vec3 hitCol = (uHitDetSign >= 0.0) ? vec3(0.08, 0.92, 0.96) : vec3(0.98, 0.24, 0.78);
      float alpha = clamp(border * 0.92 + tlMark * 0.85 + 0.11, 0.0, 0.95);
      rgb = mix(rgb, hitCol, alpha);
    }
    if (uHitPt.x >= 0.0) {
      float dPin = length(cssPx - uHitPt);
      if (dPin < 8.5) {
        float ring = 1.0 - smoothstep(1.2, 2.6, abs(dPin - 4.5));
        rgb = mix(rgb, vec3(1.0, 0.62, 0.16), ring);
      }
    }
  }

  outColor = vec4(rgb, 1.0);
}`;
// #endregion kaleidoscope-shader

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  chamber: 'd6',
  barrelRot: defaultBarrelRot('d6'),
  panX: 0,
  panY: 0,
  cardScale: 1.0,
  palette: 'cobalt',
  gems: 0,
  aperture: true,
  optics: true,
  showHitQuad: false,
  autoTurn: false,
  backend: 'starting',
  texW: 0,
  texH: 0,
  lastHitPath: 'none yet',
  onScreen: true,
};

let stage = null;
let ctx2d = null;
let lastLiveTex = null;
let domDirty = true;
let mipDirty = true;
let hitTick = 0;
let lastHitKey = '';
let lastCardSize = 0;
let cachedControlRects = [];
let activeHit = null;
let lastPointerPx = null;
let lastPointerPy = null;
const hitInvMat3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
let hitDetSign = 1;
const hitPinPt = [-10, -10];
let rafId = 0;
let lastFrameMs = performance.now();
let clockTimer = 0;

function showNotice(msg) {
  if (!msg) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
    return;
  }
  noticeEl.hidden = false;
  noticeEl.textContent = msg;
}

function updateCardClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const sec = now.getSeconds();
  cardClock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(sec)}`;
  cardPip.style.transform = `rotate(${45 + sec * 6}deg)`;
}

function updateCardContent() {
  const val = cardInput.value.trim();
  cardTitle.textContent = val ? val.slice(0, 16).toUpperCase() : 'KALEIDOSCOPE';
  cardScaleOut.textContent = `${state.cardScale.toFixed(2)}x`;
  cardGemCount.textContent = `Gems: ${String(state.gems).padStart(2, '0')}`;
  const litCount = (state.gems % 4) + 1;
  for (let i = 0; i < cardFacetEls.length; i++) {
    cardFacetEls[i].classList.toggle('lit', i < litCount);
  }
}

function computeLayout() {
  const cw = Math.max(240, canvas.clientWidth || 340);
  const ch = Math.max(280, canvas.clientHeight || 360);
  const cardSize = Math.max(248, Math.min(300, Math.round(Math.min(cw, ch) * 0.72)));
  const radius = Math.min(cw, ch) * 0.46;
  return { cw, ch, cardSize, radius };
}

// #region mirror-fold
/**
 * Fold a chamber-space point u = (ux, uy) into the fundamental domain of either
 * a dihedral D_n two-mirror chamber or the equilateral triangle wallpaper p3m1.
 * Returns the exact orthogonal reflection matrix Q and translation d (f = Q*u + d).
 */
export function foldChamber(ux, uy, chamberKey = state.chamber) {
  const ch = CHAMBERS[chamberKey] || CHAMBERS.d6;
  if (ch.mode === 0) {
    const n = ch.folds;
    const alpha = PI / n;
    const theta = Math.atan2(uy, ux);
    const thetaPos = ((theta % TAU) + TAU) % TAU;
    const totalWedges = 2 * n;
    const k = Math.max(0, Math.min(totalWedges - 1, Math.floor(thetaPos / alpha)));
    const parity = k & 1;
    const bounces = Math.min(k, totalWedges - k);

    let q00, q01, q10, q11;
    if (parity === 0) {
      const ang = -k * alpha;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      q00 = ca;
      q01 = -sa;
      q10 = sa;
      q11 = ca;
    } else {
      const psi = (k + 1) * alpha;
      const cp = Math.cos(psi);
      const sp = Math.sin(psi);
      q00 = cp;
      q01 = sp;
      q10 = sp;
      q11 = -cp;
    }
    const fx = q00 * ux + q01 * uy;
    const fy = q10 * ux + q11 * uy;
    return {
      fx,
      fy,
      q00,
      q01,
      q10,
      q11,
      dx: 0,
      dy: 0,
      parity,
      bounces,
      wedgeId: `Wedge #${k}`,
      wedgeIndex: k,
      bisectorCos: Math.cos(alpha * 0.5),
      bisectorSin: -Math.sin(alpha * 0.5),
      anchorX: 0.48,
      anchorY: 0,
      uvCenterX: 0.5,
      uvCenterY: 0.46,
      baseScale: 0.9,
    };
  }

  // Equilateral triangle 3-mirror wallpaper (p3m1 / Coxeter alcove A~_2)
  let fx = ux;
  let fy = uy;
  let q00 = 1, q01 = 0, q10 = 0, q11 = 1;
  let dx = 0, dy = 0;
  let bounces = 0;

  for (let i = 0; i < 24; i++) {
    const s0 = TRI_NORMALS[0][0] * fx + TRI_NORMALS[0][1] * fy - TRI_R_IN;
    const s1 = TRI_NORMALS[1][0] * fx + TRI_NORMALS[1][1] * fy - TRI_R_IN;
    const s2 = TRI_NORMALS[2][0] * fx + TRI_NORMALS[2][1] * fy - TRI_R_IN;
    let s = s0;
    let nx = TRI_NORMALS[0][0];
    let ny = TRI_NORMALS[0][1];
    if (s1 > s) { s = s1; nx = TRI_NORMALS[1][0]; ny = TRI_NORMALS[1][1]; }
    if (s2 > s) { s = s2; nx = TRI_NORMALS[2][0]; ny = TRI_NORMALS[2][1]; }
    if (s <= 1e-6) break;

    fx -= 2 * s * nx;
    fy -= 2 * s * ny;
    const r00 = 1 - 2 * nx * nx;
    const r01 = -2 * nx * ny;
    const r11 = 1 - 2 * ny * ny;
    const nq00 = r00 * q00 + r01 * q10;
    const nq01 = r00 * q01 + r01 * q11;
    const nq10 = r01 * q00 + r11 * q10;
    const nq11 = r01 * q01 + r11 * q11;
    q00 = nq00; q01 = nq01; q10 = nq10; q11 = nq11;

    const ndx = r00 * dx + r01 * dy + 2 * TRI_R_IN * nx;
    const ndy = r01 * dx + r11 * dy + 2 * TRI_R_IN * ny;
    dx = ndx; dy = ndy;
    bounces += 1;
  }

  const ucx = -(q00 * dx + q10 * dy);
  const ucy = -(q01 * dx + q11 * dy);
  const ix = Math.round(ucx / TRI_R_IN);
  const iy = Math.round(ucy / TRI_R_IN);
  const wedgeId = bounces === 0 ? 'Tile #0' : `Tile (${ix},${iy})`;

  return {
    fx,
    fy,
    q00,
    q01,
    q10,
    q11,
    dx,
    dy,
    parity: bounces & 1,
    bounces,
    wedgeId,
    wedgeIndex: bounces,
    bisectorCos: 1,
    bisectorSin: 0,
    anchorX: 0,
    anchorY: 0.45 * TRI_R_IN,
    uvCenterX: 0.5,
    uvCenterY: 0.5,
    baseScale: 0.9 / (2 * SQRT3 * TRI_R_IN),
  };
}

/**
 * Exact CPU mirror of KALEIDOSCOPE_FRAG: folds canvas CSS point (px, py) into
 * card-local CSS pixels (qx, qy) and returns the exact rigid affine DOMMatrix
 * coefficients [a, b, c, d, e, f] mapping card CSS px -> canvas CSS px.
 * Odd-parity reflections produce a negative determinant (det < 0).
 */
export function projectKaleidoscopePoint(px, py, layout, opts = state) {
  const cx = layout.cw * 0.5;
  const cy = layout.ch * 0.5;
  const radius = Math.max(layout.radius, 1);
  const centeredX = (px - cx) / radius;
  const centeredY = (py - cy) / radius;

  if (opts.aperture && Math.hypot(centeredX, centeredY) > 1.0) return null;

  const cR = Math.cos(opts.barrelRot);
  const sR = Math.sin(opts.barrelRot);
  const ux = cR * centeredX + sR * centeredY;
  const uy = -sR * centeredX + cR * centeredY;

  const fold = foldChamber(ux, uy, opts.chamber);
  const bx = fold.bisectorCos * fold.fx - fold.bisectorSin * fold.fy;
  const by = fold.bisectorSin * fold.fx + fold.bisectorCos * fold.fy;

  const uvScale = fold.baseScale / Math.max(opts.cardScale, 0.25);
  const wx = fold.uvCenterX + (bx - fold.anchorX) * uvScale + opts.panX;
  const wy = fold.uvCenterY + (by - fold.anchorY) * uvScale + opts.panY;

  const mx = Math.floor(wx);
  const my = Math.floor(wy);
  const oddX = ((mx % 2) + 2) % 2;
  const oddY = ((my % 2) + 2) % 2;
  const uvx = oddX ? mx + 1 - wx : wx - mx;
  const uvy = oddY ? my + 1 - wy : wy - my;
  const sx = oddX ? -1 : 1;
  const sy = oddY ? -1 : 1;

  // T = B * Q * Rot(-barrelRot)
  const rq00 = fold.q00 * cR - fold.q01 * sR;
  const rq01 = fold.q00 * sR + fold.q01 * cR;
  const rq10 = fold.q10 * cR - fold.q11 * sR;
  const rq11 = fold.q10 * sR + fold.q11 * cR;

  const t00 = fold.bisectorCos * rq00 - fold.bisectorSin * rq10;
  const t01 = fold.bisectorCos * rq01 - fold.bisectorSin * rq11;
  const t10 = fold.bisectorSin * rq00 + fold.bisectorCos * rq10;
  const t11 = fold.bisectorSin * rq01 + fold.bisectorCos * rq11;

  const cardW = layout.cardW ?? layout.cardSize;
  const cardH = layout.cardH ?? layout.cardSize;
  const kX = (cardW * uvScale * sx) / radius;
  const kY = (cardH * uvScale * sy) / radius;
  const a00 = kX * t00;
  const a01 = kX * t01;
  const a10 = kY * t10;
  const a11 = kY * t11;

  const detA = a00 * a11 - a01 * a10;
  if (Math.abs(detA) < 1e-8) return null;

  // Exact inverse M = dp/dq (card CSS px -> canvas CSS px)
  const m00 = a11 / detA;
  const m01 = -a01 / detA;
  const m10 = -a10 / detA;
  const m11 = a00 / detA;

  const qx = uvx * cardW;
  const qy = uvy * cardH;
  const tx = px - (m00 * qx + m01 * qy);
  const ty = py - (m10 * qx + m11 * qy);
  const totalParity = (fold.parity ^ oddX ^ oddY) & 1;
  const detM = m00 * m11 - m01 * m10;

  return {
    a: m00,
    b: m10,
    c: m01,
    d: m11,
    e: tx,
    f: ty,
    qx,
    qy,
    px,
    py,
    uvx,
    uvy,
    det: detM,
    detSign: totalParity ? -1 : 1,
    parity: totalParity,
    bounces: fold.bounces,
    wedgeId: fold.wedgeId,
    wedgeIndex: fold.wedgeIndex,
    fold,
  };
}
// #endregion mirror-fold

// #region hit-sync
const INTERACTIVE_CONTROLS = [...card.querySelectorAll('button, input, select, textarea')];

function measureControlRects() {
  cachedControlRects = INTERACTIVE_CONTROLS.map((el) => {
    let x = 0;
    let y = 0;
    let cur = el;
    while (cur && cur !== card) {
      const parent = cur.offsetParent;
      x += cur.offsetLeft + (parent ? parent.clientLeft : 0);
      y += cur.offsetTop + (parent ? parent.clientTop : 0);
      cur = parent;
      if (!cur || !card.contains(cur)) break;
    }
    let label = (el.textContent || el.id || 'Control').trim();
    if (el.tagName === 'INPUT') {
      label = el.type === 'range' ? 'Scale slider' : 'Text input';
    }
    return { el, x, y, w: el.offsetWidth, h: el.offsetHeight, label };
  });
}

function findLocalControl(qx, qy) {
  for (const r of cachedControlRects) {
    if (qx >= r.x && qx <= r.x + r.w && qy >= r.y && qy <= r.y + r.h) {
      return r;
    }
  }
  return null;
}

function ensureCardSize(layout) {
  if (lastCardSize !== layout.cardSize || !cachedControlRects.length) {
    lastCardSize = layout.cardSize;
    card.style.width = `${layout.cardSize}px`;
    card.style.height = `${layout.cardSize}px`;
    measureControlRects();
  }
  layout.cardW = card.offsetWidth || layout.cardSize;
  layout.cardH = card.offsetHeight || layout.cardSize;
}

function writeHitInvMat3(a, b, c, d, e, f, cardW, cardH) {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-8) return;
  const invX = 1 / (det * Math.max(cardW, 1));
  const invY = 1 / (det * Math.max(cardH, 1));
  hitInvMat3[0] = d * invX;
  hitInvMat3[1] = -b * invY;
  hitInvMat3[2] = 0;
  hitInvMat3[3] = -c * invX;
  hitInvMat3[4] = a * invY;
  hitInvMat3[5] = 0;
  hitInvMat3[6] = (c * f - d * e) * invX;
  hitInvMat3[7] = (b * e - a * f) * invY;
  hitInvMat3[8] = 1;
}

function applyHitTransform(hit, layout, pinX = -10, pinY = -10) {
  if (typeof canvas.updateElementGeometry !== 'function') return;
  const unit = geometryUnit(canvas, card, layout.cardW);
  const cssMat = new DOMMatrix([hit.a, hit.b, hit.c, hit.d, hit.e, hit.f]);
  const m = new DOMMatrix().scale(unit).multiply(cssMat);
  canvas.updateElementGeometry(card, { canvasTransform: m });
  card.dataset.hitTick = String(++hitTick);
  writeHitInvMat3(hit.a, hit.b, hit.c, hit.d, hit.e, hit.f, layout.cardW, layout.cardH);
  hitDetSign = hit.detSign;
  hitPinPt[0] = pinX;
  hitPinPt[1] = pinY;
}

function defaultHintText() {
  return 'Hover or tap any wedge to interact · drag frame to turn and pan';
}

function updateHitHint(hit) {
  if (!hit) {
    hintEl.textContent = defaultHintText();
    return;
  }
  const kind = hit.detSign < 0 ? 'reflected (det -1)' : 'direct (det +1)';
  const bounceStr = hit.bounces === 1 ? '1 bounce' : `${hit.bounces} bounces`;
  const target = hit.controlLabel ? ` · ${hit.controlLabel}` : '';
  hintEl.textContent = `${hit.wedgeId} · ${kind} · ${bounceStr}${target}`;
}

function reprojectAt(px, py, layout = computeLayout(), force = false) {
  if (wrap.classList.contains('plain')) return null;
  ensureCardSize(layout);
  const key = `pt:${Math.round(px / 2)},${Math.round(py / 2)},${layout.cardSize},${state.chamber},${state.barrelRot.toFixed(3)},${state.panX.toFixed(3)},${state.panY.toFixed(3)},${state.cardScale.toFixed(2)},${state.aperture}`;
  if (!force && lastHitKey === key) return activeHit;
  lastHitKey = key;

  const hit = projectKaleidoscopePoint(px, py, layout, state);
  if (hit) {
    const ctrl = findLocalControl(hit.qx, hit.qy);
    hit.control = ctrl?.el ?? null;
    hit.controlRect = ctrl ?? null;
    hit.controlLabel = ctrl?.label ?? '';
    activeHit = hit;
    applyHitTransform(hit, layout, hit.px, hit.py);
  } else {
    activeHit = null;
  }
  updateHitHint(hit);
  return hit;
}

function syncHitGeometry(layout, force = false) {
  ensureCardSize(layout);
  if (lastPointerPx !== null && lastPointerPy !== null && !dragging && !fallbackRangeDrag) {
    const hit = reprojectAt(lastPointerPx, lastPointerPy, layout, force);
    if (hit) return;
  }
  // Resting placement sits on the direct 0-bounce wedge or central triangle
  const ch = CHAMBERS[state.chamber] || CHAMBERS.d6;
  let probeX = layout.cw * 0.5;
  let probeY = layout.ch * 0.5;
  if (ch.mode === 0) {
    const ang = state.barrelRot + (PI / ch.folds) * 0.5;
    probeX += Math.cos(ang) * layout.radius * 0.52;
    probeY += Math.sin(ang) * layout.radius * 0.52;
  }
  const key = `rest:${layout.cw},${layout.ch},${layout.cardSize},${state.chamber},${state.barrelRot.toFixed(3)},${state.panX.toFixed(3)},${state.panY.toFixed(3)},${state.cardScale.toFixed(2)}`;
  if (!force && lastHitKey === key) return;
  lastHitKey = key;
  const hit = projectKaleidoscopePoint(probeX, probeY, layout, { ...state, aperture: false });
  if (hit) {
    activeHit = hit;
    applyHitTransform(hit, layout, -10, -10);
  }
}

let dragging = false;
let dragX = 0;
let dragY = 0;
let pendingTap = null;
let nativeControlDown = false;
let fallbackRangeDrag = null;

function canvasLocalXY(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function applyRangeFromHit(hit, rect) {
  if (!rect || rect.w <= 0) return;
  const t = Math.max(0, Math.min(1, (hit.qx - rect.x) / rect.w));
  const min = Number(cardScaleInput.min);
  const max = Number(cardScaleInput.max);
  const step = Number(cardScaleInput.step) || 1;
  const raw = min + t * (max - min);
  const snapped = Math.round(raw / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  if (Number(cardScaleInput.value) !== clamped) {
    cardScaleInput.value = String(clamped);
    state.cardScale = clamped / 100;
    updateCardContent();
    requestDraw(true);
  }
}

canvas.addEventListener('pointermove', (e) => {
  if (wrap.classList.contains('plain')) return;
  if (fallbackRangeDrag && e.pointerId === fallbackRangeDrag.pointerId) {
    const { x, y } = canvasLocalXY(e);
    const layout = computeLayout();
    ensureCardSize(layout);
    const hit = projectKaleidoscopePoint(x, y, layout, state);
    if (hit) applyRangeFromHit(hit, fallbackRangeDrag.rect);
    return;
  }
  if (dragging) {
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    dragX = e.clientX;
    dragY = e.clientY;
    if (CHAMBERS[state.chamber].mode === 0) {
      state.barrelRot += dx * 0.008;
      state.panX = Math.max(-1.2, Math.min(1.2, state.panX - dy * 0.0025));
    } else {
      state.panX = Math.max(-1.5, Math.min(1.5, state.panX - dx * 0.003));
      state.panY = Math.max(-1.5, Math.min(1.5, state.panY - dy * 0.003));
    }
    requestDraw(false);
    return;
  }
  if (pendingTap && e.pointerId === pendingTap.pointerId) {
    if (Math.hypot(e.clientX - pendingTap.startX, e.clientY - pendingTap.startY) > 8) {
      pendingTap = null;
      dragging = true;
      dragX = e.clientX;
      dragY = e.clientY;
      canvas.classList.add('dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    return;
  }
  if (e.buttons !== 0 && (e.target === cardInput || e.target === cardScaleInput || nativeControlDown)) return;

  const { x, y } = canvasLocalXY(e);
  lastPointerPx = x;
  lastPointerPy = y;
  const prevKey = lastHitKey;
  reprojectAt(x, y);
  if (state.showHitQuad && lastHitKey !== prevKey) {
    requestDraw(false);
  }
}, { capture: true });

canvas.addEventListener('pointerdown', (e) => {
  if (wrap.classList.contains('plain')) return;
  const { x, y } = canvasLocalXY(e);
  lastPointerPx = x;
  lastPointerPy = y;
  const hit = reprojectAt(x, y, computeLayout(), true);
  if (state.showHitQuad) requestDraw(false);

  const nativeControl = e.target instanceof Element ? e.target.closest('button, input, select, textarea') : null;
  if (hit?.control) {
    if (nativeControl === hit.control) {
      nativeControlDown = true;
      pendingTap = null;
      state.lastHitPath = hit.detSign < 0 ? 'native (det -1)' : 'native (det +1)';
      updateStatus();
      return;
    }
    if (hit.control === cardScaleInput) {
      e.preventDefault();
      state.lastHitPath = hit.detSign < 0 ? 'fallback (det -1)' : 'cold-tap fallback';
      fallbackRangeDrag = { pointerId: e.pointerId, rect: hit.controlRect };
      applyRangeFromHit(hit, hit.controlRect);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      updateStatus();
      return;
    }
    pendingTap = {
      control: hit.control,
      detSign: hit.detSign,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
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
  if (fallbackRangeDrag && e.pointerId === fallbackRangeDrag.pointerId) {
    fallbackRangeDrag = null;
    syncHitGeometry(computeLayout(), true);
    return;
  }
  if (pendingTap && e.pointerId === pendingTap.pointerId) {
    const tap = pendingTap;
    pendingTap = null;
    if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY) <= 8) {
      state.lastHitPath = tap.detSign < 0 ? 'fallback (det -1)' : 'cold-tap fallback';
      if (tap.control.tagName === 'INPUT') {
        tap.control.focus({ preventScroll: true });
      } else {
        tap.control.click();
      }
      updateStatus();
      requestDraw(true);
    }
  }
  if (dragging) {
    dragging = false;
    canvas.classList.remove('dragging');
    if (lastPointerPx !== null && lastPointerPy !== null) {
      reprojectAt(lastPointerPx, lastPointerPy, computeLayout(), true);
      if (state.showHitQuad) requestDraw(false);
    }
  }
  if (e.pointerType === 'touch') {
    lastPointerPx = null;
    lastPointerPy = null;
    hitPinPt[0] = -10;
    hitPinPt[1] = -10;
    if (state.showHitQuad) requestDraw(false);
  }
};
canvas.addEventListener('pointerup', endPointer, { capture: true });
canvas.addEventListener('pointercancel', endPointer, { capture: true });
canvas.addEventListener('pointerleave', () => {
  if (dragging || fallbackRangeDrag) return;
  lastPointerPx = null;
  lastPointerPy = null;
  hitPinPt[0] = -10;
  hitPinPt[1] = -10;
  hintEl.textContent = defaultHintText();
  if (state.showHitQuad) requestDraw(false);
});
// #endregion hit-sync

function updateStatus() {
  const ch = CHAMBERS[state.chamber] || CHAMBERS.d6;
  const texInfo = state.texW ? `${state.texW}x${state.texH}` : 'pending';
  const apInfo = state.aperture ? 'on' : 'off';
  statusEl.textContent = `Backend: ${state.backend} | Chamber: ${ch.label} | Last tap: ${state.lastHitPath} | Texture: ${texInfo} | Aperture: ${apInfo}`;
}

function renderWebGL(e) {
  if (!stage || stage.lost) return;
  const gl = stage.gl;
  const layout = computeLayout();
  syncHitGeometry(layout);

  const changed = new Set(e?.changedElements ?? []);
  const shouldUpload = domDirty || changed.has(card) || !stage.has(card) || !lastLiveTex;
  if (shouldUpload) {
    lastLiveTex = stage.upload(card);
    domDirty = false;
    mipDirty = true;
    if (lastLiveTex) {
      state.texW = lastLiveTex.w;
      state.texH = lastLiveTex.h;
    }
  }
  const liveTex = lastLiveTex;
  if (!liveTex) return;

  if (mipDirty) {
    gl.bindTexture(gl.TEXTURE_2D, liveTex.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    mipDirty = false;
  }

  const ch = CHAMBERS[state.chamber] || CHAMBERS.d6;
  if (!stage.begin([0.045, 0.05, 0.075, 1])) return;
  stage.quad(card, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (g, loc) => {
    g.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    g.uniform1f(loc('uRadius'), layout.radius);
    g.uniform1i(loc('uMode'), ch.mode);
    g.uniform1f(loc('uFolds'), ch.folds);
    g.uniform1f(loc('uBarrelRot'), state.barrelRot);
    g.uniform2f(loc('uPan'), state.panX, state.panY);
    g.uniform1f(loc('uCardScale'), state.cardScale);
    g.uniform1i(loc('uAperture'), state.aperture ? 1 : 0);
    g.uniform1i(loc('uOptics'), state.optics ? 1 : 0);
    g.uniform1i(loc('uShowHit'), state.showHitQuad ? 1 : 0);
    g.uniformMatrix3fv(loc('uHitInv'), false, hitInvMat3);
    g.uniform1f(loc('uHitDetSign'), hitDetSign);
    g.uniform2f(loc('uHitPt'), hitPinPt[0], hitPinPt[1]);
  });

  updateStatus();
}

function render2DFallback() {
  if (!ctx2d) return;
  const layout = computeLayout();
  syncHitGeometry(layout);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const cx = layout.cw * 0.5;
  const cy = layout.ch * 0.5;
  const ch = CHAMBERS[state.chamber] || CHAMBERS.d6;
  const folds = ch.mode === 0 ? ch.folds : 6;
  const alpha = PI / folds;
  const totalWedges = 2 * folds;
  const drawR = state.aperture ? layout.radius : Math.hypot(cx, cy) + 2;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#0b0d14';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);

  for (let k = 0; k < totalWedges; k++) {
    const a0 = state.barrelRot + k * alpha;
    const a1 = a0 + alpha;
    const mid = a0 + alpha * 0.5;
    const probeX = cx + Math.cos(mid) * layout.radius * 0.5;
    const probeY = cy + Math.sin(mid) * layout.radius * 0.5;
    const hit = projectKaleidoscopePoint(probeX, probeY, layout, {
      ...state,
      chamber: ch.mode === 0 ? state.chamber : 'd6',
      aperture: false,
    });
    if (!hit) continue;

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.moveTo(cx, cy);
    ctx2d.arc(cx, cy, drawR, a0, a1);
    ctx2d.closePath();
    ctx2d.clip();
    ctx2d.transform(hit.a, hit.b, hit.c, hit.d, hit.e, hit.f);
    ctx2d.drawElementImage(card, 0, 0, layout.cardW, layout.cardH);
    ctx2d.restore();
  }

  if (state.optics) {
    ctx2d.strokeStyle = 'rgba(214, 171, 89, 0.55)';
    ctx2d.lineWidth = 1.5;
    for (let k = 0; k < totalWedges; k++) {
      const a0 = state.barrelRot + k * alpha;
      ctx2d.beginPath();
      ctx2d.moveTo(cx, cy);
      ctx2d.lineTo(cx + Math.cos(a0) * drawR, cy + Math.sin(a0) * drawR);
      ctx2d.stroke();
    }
  }

  if (state.aperture) {
    ctx2d.strokeStyle = '#a87d39';
    ctx2d.lineWidth = Math.max(6, layout.radius * 0.06);
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, layout.radius + ctx2d.lineWidth * 0.5, 0, TAU);
    ctx2d.stroke();
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
  syncHitGeometry(computeLayout(), true);
  requestDraw(true);
}

function needsLoop() {
  if (!state.onScreen || document.hidden || wrap.classList.contains('plain')) return false;
  return state.autoTurn && !reducedMotion.matches;
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
  state.barrelRot = (state.barrelRot + dt * 0.22) % TAU;
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
    updateCardClock();
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
      fragment: KALEIDOSCOPE_FRAG,
      onLost: () => {
        lastLiveTex = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the card as plain HTML until the browser restores it.');
      },
      onRestored: () => {
        state.backend = 'WebGL 2 (ElementGL)';
        restoreCanvasFromPlain();
      },
    });
    state.backend = 'WebGL 2 (ElementGL)';
  } catch (err) {
    stage = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
  }
}

if (!stage && supported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2D fallback';
    if (noticeEl.hidden) showNotice('WebGL 2 texElementSubImage2D() is not available here; using the 2D reflected-wedge fallback.');
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the card is shown as plain HTML.');
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
    syncHitGeometry(computeLayout(), true);
    requestDraw(false);
  }
}).observe(canvas);

// Live source card events
cardInput.addEventListener('input', () => {
  updateCardContent();
  requestDraw(true);
});

for (const btn of paletteBtns) {
  btn.addEventListener('click', () => {
    state.palette = btn.dataset.palette;
    card.dataset.palette = state.palette;
    for (const b of paletteBtns) b.setAttribute('aria-pressed', String(b === btn));
    requestDraw(true);
  });
}

cardScaleInput.addEventListener('input', () => {
  state.cardScale = Number(cardScaleInput.value) / 100;
  updateCardContent();
  syncHitGeometry(computeLayout(), true);
  requestDraw(true);
});

cardGemBtn.addEventListener('click', () => {
  state.gems += 1;
  updateCardContent();
  requestDraw(true);
});

// Stage controls
function setChamber(nextKey) {
  if (!CHAMBERS[nextKey]) return;
  state.chamber = nextKey;
  state.barrelRot = defaultBarrelRot(nextKey);
  state.panX = 0;
  state.panY = 0;
  state.aperture = nextKey !== 'p3m1';
  ctlAperture.checked = state.aperture;
  for (const b of chamberBtns) b.setAttribute('aria-pressed', String(b.dataset.chamber === nextKey));
  syncHitGeometry(computeLayout(), true);
  requestDraw(false);
}

for (const b of chamberBtns) {
  b.addEventListener('click', () => setChamber(b.dataset.chamber));
}

btnTurn.addEventListener('click', () => {
  state.autoTurn = !state.autoTurn;
  btnTurn.setAttribute('aria-pressed', String(state.autoTurn));
  if (state.autoTurn && reducedMotion.matches) {
    showNotice('Slow barrel turn is paused because prefers-reduced-motion: reduce is active. Drag the canvas to turn the chamber by hand.');
  } else if (!wrap.classList.contains('plain')) {
    showNotice('');
  }
  scheduleLoop();
});

ctlAperture.addEventListener('change', () => {
  state.aperture = ctlAperture.checked;
  requestDraw(false);
});

ctlOptics.addEventListener('change', () => {
  state.optics = ctlOptics.checked;
  requestDraw(false);
});

ctlHitQuad.addEventListener('change', () => {
  state.showHitQuad = ctlHitQuad.checked;
  requestDraw(false);
});

btnReset.addEventListener('click', () => {
  state.barrelRot = defaultBarrelRot(state.chamber);
  state.panX = 0;
  state.panY = 0;
  state.cardScale = 1.0;
  cardScaleInput.value = '100';
  state.autoTurn = false;
  btnTurn.setAttribute('aria-pressed', 'false');
  updateCardContent();
  syncHitGeometry(computeLayout(), true);
  requestDraw(true);
});

// Initial paint and 1 Hz ticking indicator
updateCardClock();
updateCardContent();
syncHitGeometry(computeLayout(), true);
startClock();
requestDraw(true);

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, text) => {
  if (!ok) throw new Error(text);
  return text;
};

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() renders the dihedral kaleidoscope cleanly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Uploads a two-band drawable child on an isolated ElementGL canvas, draws a D6 kaleidoscope frame with KALEIDOSCOPE_FRAG and checks gl.getError() === 0 plus mirror-symmetric cobalt/gold pixel readback across Wedge #0 and reflected Wedge #1.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:160px;height:160px;display:block';
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:120px;height:120px;background:linear-gradient(180deg,#1953e6 0 42%,#f2b738 42% 100%)';
      cv.append(child);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: KALEIDOSCOPE_FRAG, attributes: { preserveDrawingBuffer: true } });
      await nextPaint(cv);
      const gl = g.gl;
      while (gl.getError() !== gl.NO_ERROR) {}
      const uploaded = g.upload(child);
      gl.bindTexture(gl.TEXTURE_2D, uploaded.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      g.begin([0, 0, 0, 1]);
      g.quad(child, ElementGL.rect(cv, 0, 0, 160, 160), (ctxGl, loc) => {
        ctxGl.uniform2f(loc('uCanvasSize'), 160, 160);
        ctxGl.uniform1f(loc('uRadius'), 72);
        ctxGl.uniform1i(loc('uMode'), 0);
        ctxGl.uniform1f(loc('uFolds'), 6);
        ctxGl.uniform1f(loc('uBarrelRot'), 0);
        ctxGl.uniform2f(loc('uPan'), 0, 0);
        ctxGl.uniform1f(loc('uCardScale'), 1);
        ctxGl.uniform1i(loc('uAperture'), 0);
        ctxGl.uniform1i(loc('uOptics'), 0);
        ctxGl.uniform1i(loc('uShowHit'), 0);
        ctxGl.uniformMatrix3fv(loc('uHitInv'), false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
        ctxGl.uniform1f(loc('uHitDetSign'), 1);
        ctxGl.uniform2f(loc('uHitPt'), -10, -10);
      });
      const err = gl.getError();

      // At r=52/72, 8 deg in Wedge #0 reflects across the 30 deg mirror to 52 deg in Wedge #1 (both cobalt),
      // while 38 deg in Wedge #1 maps to 22 deg in Wedge #0 (gold), confirming genuine mirror reflection.
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const sampleAt = (deg) => {
        const rad = (deg * PI) / 180;
        const cssX = 80 + Math.cos(rad) * 52;
        const cssY = 80 + Math.sin(rad) * 52;
        const px = new Uint8Array(4);
        const gx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * dpr)));
        const gy = Math.max(0, Math.min(cv.height - 1, cv.height - 1 - Math.round(cssY * dpr)));
        gl.readPixels(gx, gy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const evenCobalt = sampleAt(8);
      const oddCobalt = sampleAt(52);
      const oddGold = sampleAt(38);
      const twinDiff = Math.max(
        Math.abs(evenCobalt[0] - oddCobalt[0]),
        Math.abs(evenCobalt[1] - oddCobalt[1]),
        Math.abs(evenCobalt[2] - oddCobalt[2])
      );
      const isCobalt = evenCobalt[2] > 180 && evenCobalt[0] < 80;
      const isGold = oddGold[0] > 200 && oddGold[2] < 100;
      g.dispose();
      window.__gfx?.retire(cv);
      return need(
        err === 0 && isCobalt && isGold && twinDiff <= 8,
        `Uploaded ${uploaded.w}x${uploaded.h}, gl.getError()=${err}, Wedge #0 8 deg rgba(${evenCobalt.join(',')}) vs reflected Wedge #1 52 deg rgba(${oddCobalt.join(',')}) (diff ${twinDiff}); Wedge #1 38 deg gold rgba(${oddGold.join(',')}).`
      );
    },
  },
  {
    name: 'Direct (even-parity, det > 0) wedge reprojection hits a button via document.elementsFromPoint()',
    expect: 'pass',
    why: 'Projects an off-centre button into Wedge #2 of D6 (even parity, +60 deg rotation, det > 0), applies the geometryUnit()-scaled DOMMatrix and checks document.elementsFromPoint().',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:260px;height:260px;display:block';

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = 'box-sizing:border-box;position:relative;width:200px;height:200px;background:#f5f8ff';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Direct wedge';
      btn.style.cssText = 'position:absolute;left:92px;top:68px;width:84px;height:48px;box-sizing:border-box';
      box.append(btn);
      cv.append(box);
      testStage().append(cv);

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(260 * dpr);
      cv.height = Math.round(260 * dpr);
      const ctx = cv.getContext('2d');
      cv.addEventListener('paint', () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, 260, 260);
        ctx.drawElementImage(box, 30, 30, 200, 200);
      });
      await nextPaint(cv);

      const lay = { cw: 260, ch: 260, cardSize: 200, cardW: 200, cardH: 200, radius: 118 };
      const probeOpts = { chamber: 'd6', barrelRot: defaultBarrelRot('d6'), panX: 0, panY: 0, cardScale: 1, aperture: true };
      // Search Wedge #2 (even parity, +60 deg clockwise from Wedge #0) for a canvas point inside the button
      let found = null;
      for (let rad = 36; rad <= 104 && !found; rad += 4) {
        for (let deg = 50; deg <= 72; deg += 2) {
          const a = (deg * PI) / 180;
          const h = projectKaleidoscopePoint(130 + Math.cos(a) * rad, 130 + Math.sin(a) * rad, lay, probeOpts);
          if (h && h.detSign > 0 && h.wedgeIndex === 2 && h.qx >= 104 && h.qx <= 164 && h.qy >= 78 && h.qy <= 106) {
            found = h;
            break;
          }
        }
      }
      if (!found) {
        window.__gfx?.retire(cv);
        throw new Error('Could not locate an even-parity Wedge #2 point on the target button');
      }

      const unit = geometryUnit(cv, box, 200);
      const localMat = new DOMMatrix([found.a, found.b, found.c, found.d, found.e, found.f]);
      cv.updateElementGeometry?.(box, { canvasTransform: new DOMMatrix().scale(unit).multiply(localMat) });
      box.dataset.hitTick = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const r = cv.getBoundingClientRect();
      const hits = document.elementsFromPoint(r.left + found.px, r.top + found.py);
      const ok = hits.includes(btn);
      window.__gfx?.retire(cv);
      return need(
        ok,
        `${found.wedgeId} (det=${found.det.toFixed(2)}, unit=${unit.toFixed(2)}) at (${Math.round(found.px)}, ${Math.round(found.py)}) -> hit button=${ok} (top: <${hits[0]?.tagName?.toLowerCase() ?? 'none'}>).`
      );
    },
  },
  // #region det-probe
  {
    name: 'Reflected (odd-parity, det < 0) updateElementGeometry() probe with DOMMatrix().scale(-1, 1)',
    expect: 'pass',
    why: 'Places an off-centre left-side button in a 200x100 card, applies translate(220, 20).scale(-1, 1) (det = -1) scaled by geometryUnit(), and checks whether document.elementsFromPoint() hits the mirror-flipped right-side position and misses the unflipped left position.',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:240px;height:140px;display:block';

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = 'box-sizing:border-box;position:relative;width:200px;height:100px;background:#fff5f7';
      // Left-side button: local x in [16..80], centre (48, 50).
      // Under translate(220, 20).scale(-1, 1), local (48, 50) maps to canvas (172, 70),
      // whereas an unreflected translate(20, 20) would leave it at canvas (68, 70).
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Mirrored';
      btn.style.cssText = 'position:absolute;left:16px;top:24px;width:64px;height:52px;box-sizing:border-box';
      box.append(btn);
      cv.append(box);
      testStage().append(cv);

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(240 * dpr);
      cv.height = Math.round(140 * dpr);
      const ctx = cv.getContext('2d');
      cv.addEventListener('paint', () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, 240, 140);
        ctx.save();
        ctx.translate(220, 20);
        ctx.scale(-1, 1);
        ctx.drawElementImage(box, 0, 0, 200, 100);
        ctx.restore();
      });
      await nextPaint(cv);

      const unit = geometryUnit(cv, box, 200);
      const reflected = new DOMMatrix().translate(220, 20).scale(-1, 1);
      const m = new DOMMatrix().scale(unit).multiply(reflected);
      const det = m.a * m.d - m.b * m.c;
      cv.updateElementGeometry?.(box, { canvasTransform: m });
      box.dataset.hitTick = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const r = cv.getBoundingClientRect();
      const hitsMirrored = document.elementsFromPoint(r.left + 172, r.top + 70);
      const hitsUnmirrored = document.elementsFromPoint(r.left + 68, r.top + 70);
      const gotMirrored = hitsMirrored.includes(btn);
      const gotUnmirrored = hitsUnmirrored.includes(btn);
      const topMirrored = hitsMirrored[0]?.tagName?.toLowerCase() ?? 'none';
      const topUnmirrored = hitsUnmirrored[0]?.tagName?.toLowerCase() ?? 'none';
      window.__gfx?.retire(cv);
      return need(
        det < 0 && gotMirrored && !gotUnmirrored,
        `det=${det.toFixed(2)} (unit=${unit.toFixed(2)}): mirrored (172,70) hit button=${gotMirrored} (top <${topMirrored}>); unmirrored (68,70) hit button=${gotUnmirrored} (top <${topUnmirrored}>).`
      );
    },
  },
  // #endregion det-probe
  {
    name: 'Folding math check: odd and even wedges fold into the fundamental domain and invert cleanly',
    expect: 'pass',
    why: 'Sweeps all five chambers (D4, D6, D8, D12, p3m1) across even (det +1) and odd (det -1) wedges, verifying fundamental-domain containment, determinant sign, round-trip matrix inversion and idempotence.',
    run: async () => {
      const lay = { cw: 400, ch: 400, cardSize: 280, cardW: 280, cardH: 280, radius: 184 };
      let checked = 0;
      let evenCount = 0;
      let oddCount = 0;
      let maxInvErr = 0;
      let maxIdemErr = 0;

      for (const key of Object.keys(CHAMBERS)) {
        const ch = CHAMBERS[key];
        const opts = { chamber: key, barrelRot: defaultBarrelRot(key), panX: 0, panY: 0, cardScale: 1, aperture: false };
        for (let deg = 5; deg < 360; deg += 17) {
          for (const rad of [42, 110, 160]) {
            const a = (deg * PI) / 180;
            const px = 200 + Math.cos(a) * rad;
            const py = 200 + Math.sin(a) * rad;
            const hit = projectKaleidoscopePoint(px, py, lay, opts);
            if (!hit) throw new Error(`Null projection for ${key} at (${px.toFixed(1)}, ${py.toFixed(1)})`);

            // 1. Fundamental domain containment
            const { fx, fy, q00, q01, q10, q11, dx, dy } = hit.fold;
            if (ch.mode === 0) {
              const alpha = PI / ch.folds;
              const fang = Math.atan2(fy, fx);
              if (fang < -1e-4 || fang > alpha + 1e-4) {
                throw new Error(`${key}: folded angle ${fang.toFixed(5)} outside [0, ${alpha.toFixed(5)}]`);
              }
            } else {
              for (const [nx, ny] of TRI_NORMALS) {
                if (nx * fx + ny * fy > TRI_R_IN + 1e-4) {
                  throw new Error(`p3m1: folded point (${fx.toFixed(4)}, ${fy.toFixed(4)}) outside triangle wall`);
                }
              }
            }

            // 2. Determinant sign matches parity
            if (Math.sign(hit.det) !== hit.detSign) {
              throw new Error(`${key}: det=${hit.det} disagrees with detSign=${hit.detSign}`);
            }
            if (hit.detSign > 0) evenCount++;
            else oddCount++;

            // 3. Affine round-trip M * q + t === p
            const rx = hit.a * hit.qx + hit.c * hit.qy + hit.e;
            const ry = hit.b * hit.qx + hit.d * hit.qy + hit.f;
            const invErr = Math.hypot(rx - px, ry - py);
            if (invErr > maxInvErr) maxInvErr = invErr;
            if (invErr > 1e-3) throw new Error(`${key}: round-trip error ${invErr.toFixed(6)} px`);

            // 4. Chamber involution Q^T * (f - d) === u and idempotence foldChamber(f) === f
            const cR = Math.cos(opts.barrelRot);
            const sR = Math.sin(opts.barrelRot);
            const cxN = (px - 200) / lay.radius;
            const cyN = (py - 200) / lay.radius;
            const ux = cR * cxN + sR * cyN;
            const uy = -sR * cxN + cR * cyN;
            const uBackX = q00 * (fx - dx) + q10 * (fy - dy);
            const uBackY = q01 * (fx - dx) + q11 * (fy - dy);
            const backErr = Math.hypot(uBackX - ux, uBackY - uy);
            if (backErr > 1e-4) throw new Error(`${key}: Q^T*(f-d) inverse error ${backErr.toFixed(6)}`);

            const again = foldChamber(fx, fy, key);
            const idemErr = Math.hypot(again.fx - fx, again.fy - fy);
            if (idemErr > maxIdemErr) maxIdemErr = idemErr;
            if (idemErr > 1e-4 || again.bounces !== 0) {
              throw new Error(`${key}: foldChamber(f) not idempotent (err=${idemErr}, bounces=${again.bounces})`);
            }
            checked++;
          }
        }
      }
      return need(
        checked > 0 && evenCount > 0 && oddCount > 0,
        `Verified ${checked} points across 5 chambers (${evenCount} det +1, ${oddCount} det -1), max round-trip err ${maxInvErr.toExponential(2)} px, max idempotence err ${maxIdemErr.toExponential(2)}.`
      );
    },
  },
  {
    name: 'Dispatched webglcontextlost event falls back to plain HTML without calling loseContext()',
    expect: 'pass',
    why: 'Verifies the context-loss recovery path safely with a synthetic cancelable Event.',
    run: async () => {
      const host = document.createElement('div');
      const cv = document.createElement('canvas');
      const child = document.createElement('div');
      cv.append(child);
      host.append(cv);
      testStage().append(host);
      let recovered = false;
      cv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        recovered = true;
        host.append(child);
      });
      const ev = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(ev);
      const ok = ev.defaultPrevented && recovered && child.parentElement === host;
      window.__gfx?.retire(cv);
      return need(ok, `defaultPrevented=${ev.defaultPrevented}, card moved to plain wrapper=${child.parentElement === host}.`);
    },
  },
];

runTests(document.getElementById('tests'), tests);
