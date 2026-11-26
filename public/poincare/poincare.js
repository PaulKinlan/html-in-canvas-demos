import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';
import { banner, runTests, testStage, nextPaint } from '/shared/support.js';

// Exact {7, 4} hyperbolic heptagon tiling constants on the Poincare disk.
// Seven heptagons surround the central heptagon at distance RING_R = 1 / CX.
const TILING_P = 7;
const TILING_Q = 4;
const SIN_P = Math.sin(Math.PI / TILING_P);
const COS_Q = Math.cos(Math.PI / TILING_Q);
const RC = SIN_P / Math.sqrt(COS_Q * COS_Q - SIN_P * SIN_P);
const CX = Math.sqrt(1 + RC * RC);
const RING_R = 1 / CX; // ~0.789614
const HALF_X = 0.405;

// #region mobius-math
// Complex arithmetic on { x, y } points representing x + iy in the unit disk |z| < 1.
const cadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const csub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cmul = (a, b) => ({ x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x });
const cconj = (a) => ({ x: a.x, y: -a.y });
const cabs2 = (a) => a.x * a.x + a.y * a.y;
const cabs = (a) => Math.hypot(a.x, a.y);

function cdiv(a, b) {
  const d = Math.max(cabs2(b), 1e-12);
  return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
}

function cunit(a) {
  const m = cabs(a);
  return m > 1e-12 ? { x: a.x / m, y: a.y / m } : { x: 1, y: 0 };
}

function clampDisk(z, maxR = 0.992) {
  const r = cabs(z);
  return r > maxR ? { x: (z.x * maxR) / r, y: (z.y * maxR) / r } : z;
}

/** Pure hyperbolic translation T_a(z) = (z - a) / (1 - conj(a) * z). */
export function mobiusTranslate(z, a) {
  const num = csub(z, a);
  const den = csub({ x: 1, y: 0 }, cmul(cconj(a), z));
  return cdiv(num, den);
}

/** General disk automorphism M(z) = u * (z - a) / (1 - conj(a) * z), |u| = 1, |a| < 1. */
export function applyMobius(z, u, a) {
  return cmul(u, mobiusTranslate(z, a));
}

/** Exact inverse M^{-1}(w) = (conj(u) * w + a) / (1 + conj(a) * conj(u) * w). */
export function invertMobius(w, u, a) {
  const uw = cmul(cconj(u), w);
  const num = cadd(uw, a);
  const den = cadd({ x: 1, y: 0 }, cmul(cconj(a), uw));
  return cdiv(num, den);
}

/** Compose view V(z) = u*(z - a)/(1 - conj(a)*z) with translation T_delta(w). */
export function composeViewWithTranslation(view, delta) {
  const d = clampDisk(delta, 0.98);
  const A = cadd(view.u, cmul(d, cconj(view.a)));
  const B = cadd({ x: 1, y: 0 }, cmul(cconj(d), cmul(view.u, view.a)));
  const nextU = cunit(cdiv(A, B));
  const nextA = clampDisk(cdiv(cadd(cmul(view.u, view.a), d), A), 0.992);
  return { u: nextU, a: nextA };
}

/** Compose drag mapping pointer start p0 to current pointer p1: T_{-p1} o T_{p0} o V0. */
export function composeDrag(startView, p0, p1) {
  const s0 = clampDisk(p0, 0.95);
  const s1 = clampDisk(p1, 0.95);
  const mid = composeViewWithTranslation(startView, s0);
  return composeViewWithTranslation(mid, { x: -s1.x, y: -s1.y });
}

/**
 * Combined Mobius map M_k(z) = V(H_k(z)) for a card anchored at home point c_k,
 * plus its centre w_k = M_k(0) and local complex derivative M_k'(0) = u_k * (1 - |w_k|^2).
 */
export function cardMobius(view, home) {
  const alpha = csub({ x: 1, y: 0 }, cmul(view.a, cconj(home)));
  const u = cunit(cmul(view.u, cdiv(alpha, cconj(alpha))));
  const a = clampDisk(cdiv(csub(view.a, home), alpha), 0.995);
  const center = { x: -(u.x * a.x - u.y * a.y), y: -(u.x * a.y + u.y * a.x) };
  const scale = Math.max(0.005, 1 - cabs2(center));
  const angle = Math.atan2(u.y, u.x);
  return { u, a, center, scale, angle };
}
// #endregion mobius-math

// #region card-shader
const CARD_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uQuadMin;
uniform vec2 uQuadMax;
uniform vec2 uMobU;
uniform vec2 uMobA;
uniform vec2 uHalfSize;
uniform float uDiskRadius;
uniform float uFocused;

in vec2 vUv;
out vec4 outColor;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }
vec2 cdiv(vec2 a, vec2 b) { return cmul(a, cconj(b)) / max(dot(b, b), 1e-8); }

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 w = mix(uQuadMin, uQuadMax, vUv);
  float r2 = dot(w, w);
  if (r2 >= 0.998) discard;

  // Exact inverse Mobius transform z = M_k^{-1}(w) bends card edges into geodesic arcs.
  vec2 uw = cmul(cconj(uMobU), w);
  vec2 denom = vec2(1.0, 0.0) + cmul(cconj(uMobA), uw);
  vec2 z = cdiv(uw + uMobA, denom);

  vec2 uv = (z / uHalfSize) * 0.5 + 0.5;
  if (uv.x < -0.025 || uv.x > 1.025 || uv.y < -0.025 || uv.y > 1.025) discard;

  // Exact conformal local derivative |dz/dw| gives uniform 1 px anti-aliasing at any scale.
  float invDeriv = max(1.0 - dot(uMobA, uMobA), 1e-4) / max(dot(denom, denom), 1e-6);
  float cardPxPerScreenPx = invDeriv * (uSize.x / max(2.0 * uHalfSize.x, 1e-4)) / max(uDiskRadius, 1.0);

  vec2 cardP = (uv - 0.5) * uSize;
  float sd = sdRoundBox(cardP, uSize * 0.5, 11.0);
  float sdScreenPx = sd / max(cardPxPerScreenPx, 0.05);
  float mask = 1.0 - smoothstep(-0.75, 0.75, sdScreenPx);
  if (mask <= 0.002) discard;

  vec4 texCol;
  if (cardPxPerScreenPx > 1.35) {
    vec2 stepUv = (0.35 * cardPxPerScreenPx) / max(uSize, vec2(1.0));
    texCol = 0.25 * (
      texture(uTex, clamp(uv + vec2(-stepUv.x, -stepUv.y), 0.0, 1.0)) +
      texture(uTex, clamp(uv + vec2( stepUv.x, -stepUv.y), 0.0, 1.0)) +
      texture(uTex, clamp(uv + vec2(-stepUv.x,  stepUv.y), 0.0, 1.0)) +
      texture(uTex, clamp(uv + vec2( stepUv.x,  stepUv.y), 0.0, 1.0))
    );
  } else {
    texCol = texture(uTex, clamp(uv, 0.0, 1.0));
  }

  float rimFade = 1.0 - 0.16 * smoothstep(0.55, 0.98, sqrt(r2));
  vec3 rgb = texCol.rgb * rimFade;
  if (uFocused > 0.5) {
    float ring = smoothstep(-3.0, -1.2, sdScreenPx) * (1.0 - smoothstep(-0.4, 0.7, sdScreenPx));
    rgb = mix(rgb, vec3(1.0, 0.48, 0.30) * texCol.a, ring * 0.9);
  }

  outColor = vec4(rgb * mask, texCol.a * mask);
}`;
// #endregion card-shader

// Background Poincare disk and {7, 4} Escher geodesic tiling shader.
const BG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;

uniform vec2 uCanvasSize;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uViewU;
uniform vec2 uViewA;
uniform float uShowTiling;
uniform float uTilingGlow;
uniform float uShowArcs;
uniform float uShowRimGlow;
uniform float uDarkMode;

in vec2 vUv;
out vec4 outColor;

const float PI_P = 3.14159265359 / 7.0;
const float CX = ${CX.toFixed(8)};
const float RC = ${RC.toFixed(8)};
const float RC2 = ${(RC * RC).toFixed(8)};

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }
vec2 cdiv(vec2 a, vec2 b) { return cmul(a, cconj(b)) / max(dot(b, b), 1e-8); }

void main() {
  vec2 px = vUv * uCanvasSize;
  vec2 w = (px - uCenter) / max(uRadius, 1.0);
  float r2 = dot(w, w);
  float r = sqrt(r2);

  // Soft rim halo outside the unit circle.
  if (r >= 1.0) {
    float outPx = (r - 1.0) * uRadius;
    float rim = exp(-outPx * 0.16) * (0.28 + 0.34 * uShowRimGlow);
    float ring = (1.0 - smoothstep(0.0, 2.2, outPx)) * 0.85;
    vec3 rimCol = mix(vec3(0.24, 0.56, 0.72), vec3(0.45, 0.82, 0.94), uDarkMode);
    float a = clamp(rim * 0.45 + ring, 0.0, 1.0);
    outColor = vec4(rimCol * a, a);
    return;
  }

  // Inverse view Mobius transform z = V^{-1}(w) so the tiling moves in lockstep with cards.
  vec2 uw = cmul(cconj(uViewU), w);
  vec2 den = vec2(1.0, 0.0) + cmul(cconj(uViewA), uw);
  vec2 p = cdiv(uw + uViewA, den);
  float scale = max(1.0 - dot(uViewA, uViewA), 1e-4) / max(dot(den, den), 1e-6);

  vec2 n2 = vec2(-sin(PI_P), cos(PI_P));
  int tileFlips = 0;
  for (int i = 0; i < 20; i++) {
    bool moved = false;
    if (p.y < 0.0) {
      p.y = -p.y;
      moved = true;
    }
    float d2n = dot(p, n2);
    if (d2n > 0.0) {
      p -= 2.0 * d2n * n2;
      moved = true;
    }
    vec2 dp = p - vec2(CX, 0.0);
    float dp2 = dot(dp, dp);
    if (dp2 < RC2) {
      float inv = RC2 / max(dp2, 1e-8);
      p = vec2(CX, 0.0) + dp * inv;
      scale *= inv;
      tileFlips++;
      moved = true;
    }
    if (!moved) break;
  }

  // Deep radial backdrop inside the Poincare disk.
  vec3 bgCenter = vec3(0.075, 0.11, 0.175);
  vec3 bgEdge = vec3(0.025, 0.04, 0.075);
  vec3 col = mix(bgCenter, bgEdge, smoothstep(0.05, 0.98, r));

  if (uShowTiling > 0.5) {
    float parity = mod(float(tileFlips), 2.0);
    vec3 tileA = vec3(0.11, 0.175, 0.27);
    vec3 tileB = vec3(0.06, 0.095, 0.16);
    float horizonFade = 1.0 - smoothstep(0.84, 0.995, r);
    col = mix(col, mix(tileA, tileB, parity), 0.72 * horizonFade);

    // Constant screen-pixel width geodesic heptagon edges.
    float edgeDist = abs(length(p - vec2(CX, 0.0)) - RC);
    float edgePx = edgeDist * uRadius / max(scale, 1e-4);
    float edgeLine = 1.0 - smoothstep(0.45, 1.65, edgePx);

    // Subtle internal radial symmetry spokes inside each heptagon.
    float spokePx = p.y * uRadius / max(scale, 1e-4);
    float spokeLine = (1.0 - smoothstep(0.25, 1.15, spokePx)) * 0.22 * uShowArcs;

    vec3 arcCol = mix(vec3(0.32, 0.68, 0.84), vec3(0.55, 0.90, 0.98), uTilingGlow);
    float glowAmt = (0.35 + 0.65 * uTilingGlow) * (0.3 + 0.7 * uShowArcs);
    col += arcCol * (edgeLine * glowAmt * 0.75 + spokeLine * glowAmt * 0.45) * (0.25 + 0.75 * horizonFade);
  }

  // Inner luminous horizon border at |w| = 1.
  float inPx = (1.0 - r) * uRadius;
  float innerRim = (1.0 - smoothstep(0.0, 2.6, inPx)) * 0.92;
  float innerGlow = exp(-inPx * 0.07) * (0.14 + 0.26 * uShowRimGlow);
  vec3 rimTint = vec3(0.46, 0.82, 0.96);
  col = mix(col, rimTint, clamp(innerRim * 0.75 + innerGlow, 0.0, 0.92));

  outColor = vec4(col, 1.0);
}`;

// Screen-space wireframe overlay for linear Jacobian hit-box tangent approximations.
const WIRE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const WIRE_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

function compileProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
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
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
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
  return prog;
}

// #region hit-geometry
/**
 * Build the local-Jacobian conformal DOMMatrix mapping element-local CSS pixels
 * (0..elW, 0..elH) to canvas geometry units, tangent to the curved card at w_k = M_k(0).
 */
export function buildJacobianMatrix(mob, cx, cy, R, halfX, elW, elH, unit) {
  const sigma = ((2 * R * halfX) / Math.max(elW, 1)) * mob.scale;
  const deg = (mob.angle * 180) / Math.PI;
  return new DOMMatrix()
    .scale(unit)
    .translate(cx + R * mob.center.x, cy + R * mob.center.y)
    .rotate(deg)
    .scale(sigma)
    .translate(-elW / 2, -elH / 2);
}

/**
 * Max distance (in CSS px) between the 4 curved Mobius corners M_k(+-hx, +-hy)
 * and the linear Jacobian hit-box corners w_k + M_k'(0)*(+-hx, +-hy).
 */
export function maxJacobianCornerError(mob, R, halfX, halfY) {
  let maxErr = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const z = { x: sx * halfX, y: sy * halfY };
      const exact = applyMobius(z, mob.u, mob.a);
      const deriv = { x: mob.u.x * mob.scale, y: mob.u.y * mob.scale };
      const approx = cadd(mob.center, cmul(deriv, z));
      const errPx = cabs(csub(exact, approx)) * R;
      if (errPx > maxErr) maxErr = errPx;
    }
  }
  return maxErr;
}
// #endregion hit-geometry

function cardQuadBounds(mob, halfX, halfY) {
  let minX = 1, minY = 1, maxX = -1, maxY = -1;
  const samples = 4;
  for (let i = 0; i <= samples; i++) {
    const t = -1 + (2 * i) / samples;
    const pts = [
      { x: t * halfX, y: -halfY },
      { x: t * halfX, y: halfY },
      { x: -halfX, y: t * halfY },
      { x: halfX, y: t * halfY },
    ];
    for (const z of pts) {
      const w = applyMobius(z, mob.u, mob.a);
      if (w.x < minX) minX = w.x;
      if (w.x > maxX) maxX = w.x;
      if (w.y < minY) minY = w.y;
      if (w.y > maxY) maxY = w.y;
    }
  }
  const pad = 0.035;
  minX = Math.max(-1, minX - pad);
  minY = Math.max(-1, minY - pad);
  maxX = Math.min(1, maxX + pad);
  maxY = Math.min(1, maxY + pad);
  return { minX, minY, maxX, maxY };
}

function pushWireSegment(verts, x0, y0, x1, y1, thickness, cw, ch, rgba) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const nx = (-dy / len) * (thickness * 0.5);
  const ny = (dx / len) * (thickness * 0.5);
  const toClipX = (x) => (2 * x) / cw - 1;
  const toClipY = (y) => 1 - (2 * y) / ch;
  const p0x = toClipX(x0 + nx), p0y = toClipY(y0 + ny);
  const p1x = toClipX(x0 - nx), p1y = toClipY(y0 - ny);
  const p2x = toClipX(x1 + nx), p2y = toClipY(y1 + ny);
  const p3x = toClipX(x1 - nx), p3y = toClipY(y1 - ny);
  const [r, g, b, a] = rgba;
  verts.push(
    p0x, p0y, r, g, b, a,
    p1x, p1y, r, g, b, a,
    p2x, p2y, r, g, b, a,
    p2x, p2y, r, g, b, a,
    p1x, p1y, r, g, b, a,
    p3x, p3y, r, g, b, a,
  );
}

/** Build the 8 hyperbolic home coordinates: 1 central + 7 surrounding {7, 4} heptagons. */
export function makeHomePositions(count = 8) {
  const homes = [{ x: 0, y: 0 }];
  for (let i = 1; i < count; i++) {
    const phi = (2 * Math.PI * (i - 1)) / TILING_P;
    homes.push({ x: RING_R * Math.cos(phi), y: RING_R * Math.sin(phi) });
  }
  return homes;
}

/** Geodesic Mobius glide step from startView to bring targetHome cleanly to z = 0 upright. */
// #region focus-glide
export function evaluateGlide(startView, targetHome, progress) {
  const t = Math.max(0, Math.min(1, progress));
  if (t >= 1) return { u: { x: 1, y: 0 }, a: { x: targetHome.x, y: targetHome.y } };
  const eased = 1 - Math.pow(1 - t, 3);
  const startMob = cardMobius(startView, targetHome);
  const w0 = startMob.center;
  const r0 = Math.min(cabs(w0), 0.992);
  let shifted = startView;
  if (r0 > 1e-5) {
    const d0 = Math.atanh(r0);
    const rt = Math.tanh(eased * d0);
    const pt = { x: (w0.x / r0) * rt, y: (w0.y / r0) * rt };
    shifted = composeViewWithTranslation(startView, pt);
  }
  const unwindAngle = -eased * startMob.angle;
  const rot = { x: Math.cos(unwindAngle), y: Math.sin(unwindAngle) };
  return { u: cunit(cmul(rot, shifted.u)), a: shifted.a };
}
// #endregion focus-glide

// --- Main page setup ---
banner();

const stageBox = document.getElementById('poincare-stage');
const canvas = document.getElementById('poincare-canvas');
const fallbackGrid = document.getElementById('fallback-grid');
const statusNote = document.getElementById('stage-status');
const telemetryEl = document.getElementById('poincare-telemetry');
const resetBtn = document.getElementById('btn-reset');
const nextBtn = document.getElementById('btn-next');
const hitboxCheck = document.getElementById('chk-hitbox');
const tilingCheck = document.getElementById('chk-tiling');

const cardEls = Array.from(canvas.querySelectorAll('.hcard'));
const homes = makeHomePositions(cardEls.length);
const cards = cardEls.map((el, index) => ({
  index,
  el,
  title: el.dataset.title || `Card ${index}`,
  home: homes[index],
  hitKey: '',
  hitTick: 0,
  lastMob: null,
}));

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia?.('(prefers-color-scheme: dark)');

const state = {
  view: { u: { x: 1, y: 0 }, a: { x: 0, y: 0 } },
  showHitbox: false,
  showTiling: true,
  tilingGlow: 0.64,
  showArcs: true,
  showRimGlow: true,
  focusedIndex: -1,
  centeredIndex: 0,
  inView: true,
  glide: null,
  rafId: 0,
  drag: null,
  lastTelemetry: '',
};

// Wire live interactive controls inside the 8 HTML cards.
function wireCardControls() {
  // Card 0: counter button
  const clickBtn = document.getElementById('c0-clicks');
  let clicks = 0;
  clickBtn?.addEventListener('click', () => {
    clicks++;
    clickBtn.textContent = `Clicks: ${clicks}`;
    requestRepaint();
  });

  // Card 1: tiling brightness slider (drives the GLSL shader live)
  const glowRange = document.getElementById('c1-glow');
  const glowOut = document.getElementById('c1-glow-out');
  glowRange?.addEventListener('input', () => {
    const val = Number(glowRange.value);
    state.tilingGlow = val / 100;
    if (glowOut) glowOut.textContent = `${val}%`;
    requestRepaint();
  });

  // Card 2: checklist
  const c2Checks = Array.from(document.querySelectorAll('#card-2 input[type="checkbox"]'));
  const c2Out = document.getElementById('c2-count');
  const syncC2 = () => {
    const n = c2Checks.filter((c) => c.checked).length;
    if (c2Out) c2Out.textContent = `${n}/${c2Checks.length} ticked`;
    requestRepaint();
  };
  for (const c of c2Checks) c.addEventListener('change', syncC2);

  // Card 4: wave dial range + step button
  const dialRange = document.getElementById('c4-dial');
  const dialOut = document.getElementById('c4-dial-out');
  const dialStep = document.getElementById('c4-step');
  const syncDial = () => {
    if (dialOut && dialRange) dialOut.textContent = `Step ${dialRange.value}/10`;
    requestRepaint();
  };
  dialRange?.addEventListener('input', syncDial);
  dialStep?.addEventListener('click', () => {
    if (!dialRange) return;
    dialRange.value = String((Number(dialRange.value) + 1) % 11);
    syncDial();
  });

  // Card 5: toggle bank (drives arcs and rim glow in the GLSL shader live)
  const c5Arcs = document.getElementById('c5-arcs');
  const c5Rim = document.getElementById('c5-rim');
  const c5Pill = document.getElementById('c5-pill');
  const syncC5 = () => {
    state.showArcs = !!c5Arcs?.checked;
    state.showRimGlow = !!c5Rim?.checked;
    const on = (state.showArcs ? 1 : 0) + (state.showRimGlow ? 1 : 0);
    if (c5Pill) c5Pill.textContent = `${on}/2 on`;
    requestRepaint();
  };
  c5Arcs?.addEventListener('change', syncC5);
  c5Rim?.addEventListener('change', syncC5);

  // Card 6: signal +/- counter
  let signalVal = 7;
  const sigOut = document.getElementById('c6-val');
  document.getElementById('c6-dec')?.addEventListener('click', () => {
    signalVal = Math.max(0, signalVal - 1);
    if (sigOut) sigOut.textContent = String(signalVal).padStart(2, '0');
    requestRepaint();
  });
  document.getElementById('c6-inc')?.addEventListener('click', () => {
    signalVal = Math.min(99, signalVal + 1);
    if (sigOut) sigOut.textContent = String(signalVal).padStart(2, '0');
    requestRepaint();
  });

  // Card 7: field log stamp button
  const stamps = ['ready', 'centred', 'geodesic', 'verified'];
  let stampIdx = 0;
  const stampBtn = document.getElementById('c7-stamp');
  const stampOut = document.getElementById('c7-tag');
  stampBtn?.addEventListener('click', () => {
    stampIdx = (stampIdx + 1) % stamps.length;
    if (stampOut) stampOut.textContent = stamps[stampIdx];
    requestRepaint();
  });

  // Every card has a "Centre" button and focusin listener for Tab-driven glide.
  for (const card of cards) {
    card.el.querySelector('.centre-btn')?.addEventListener('click', () => {
      glideToCard(card.index);
    });
    card.el.addEventListener('focusin', () => {
      state.focusedIndex = card.index;
      const mob = cardMobius(state.view, card.home);
      if (cabs(mob.center) > 0.04) glideToCard(card.index);
      else requestRepaint();
    });
    card.el.addEventListener('focusout', () => {
      queueMicrotask(() => {
        if (!canvas.contains(document.activeElement)) {
          state.focusedIndex = -1;
          requestRepaint();
        }
      });
    });
    card.el.addEventListener('input', () => requestRepaint());
  }
}

wireCardControls();

// --- WebGL 2 renderer built on a single ElementGL context ---
let stage = null;
let bgProg = null;
let bgUniforms = null;
let bgVao = null;
let bgVbo = null;
let wireProg = null;
let wireVao = null;
let wireVbo = null;
let fallbackActive = false;

function clearHelpers() {
  bgProg = null;
  bgUniforms = null;
  bgVao = null;
  bgVbo = null;
  wireProg = null;
  wireVao = null;
  wireVbo = null;
}

function ensureHelpers(gl) {
  if (!bgProg) {
    bgProg = compileProgram(gl, BG_VS, BG_FS);
    bgUniforms = {
      uCanvasSize: gl.getUniformLocation(bgProg, 'uCanvasSize'),
      uCenter: gl.getUniformLocation(bgProg, 'uCenter'),
      uRadius: gl.getUniformLocation(bgProg, 'uRadius'),
      uViewU: gl.getUniformLocation(bgProg, 'uViewU'),
      uViewA: gl.getUniformLocation(bgProg, 'uViewA'),
      uShowTiling: gl.getUniformLocation(bgProg, 'uShowTiling'),
      uTilingGlow: gl.getUniformLocation(bgProg, 'uTilingGlow'),
      uShowArcs: gl.getUniformLocation(bgProg, 'uShowArcs'),
      uShowRimGlow: gl.getUniformLocation(bgProg, 'uShowRimGlow'),
      uDarkMode: gl.getUniformLocation(bgProg, 'uDarkMode'),
    };
    bgVao = gl.createVertexArray();
    bgVbo = gl.createBuffer();
    gl.bindVertexArray(bgVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  if (!wireProg) {
    wireProg = compileProgram(gl, WIRE_VS, WIRE_FS);
    wireVao = gl.createVertexArray();
    wireVbo = gl.createBuffer();
    gl.bindVertexArray(wireVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, wireVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
  }
}

function enterFallback(reason) {
  fallbackActive = true;
  stageBox.classList.add('fallback');
  canvas.hidden = true;
  fallbackGrid.hidden = false;
  for (const card of cards) {
    card.el.removeAttribute('drawable');
    fallbackGrid.append(card.el);
  }
  if (statusNote) {
    statusNote.hidden = false;
    statusNote.textContent = reason;
  }
}

function leaveFallback() {
  fallbackActive = false;
  stageBox.classList.remove('fallback');
  canvas.hidden = false;
  fallbackGrid.hidden = true;
  for (const card of cards) {
    card.el.setAttribute('drawable', '');
    canvas.append(card.el);
    card.hitKey = '';
  }
  if (statusNote) statusNote.hidden = true;
}

function requestRepaint() {
  if (!stage || stage.lost || fallbackActive) return;
  canvas.requestPaint?.();
}

function diskMetrics() {
  const cw = canvas.clientWidth || 380;
  const ch = canvas.clientHeight || 380;
  const cx = cw * 0.5;
  const cy = ch * 0.5;
  const R = Math.min(cw, ch) * 0.475;
  return { cw, ch, cx, cy, R };
}

function drawScene() {
  if (!stage || stage.lost || fallbackActive || !state.inView) return;
  const { cw, ch, cx, cy, R } = diskMetrics();
  if (cw < 4 || ch < 4) return;

  for (const card of cards) stage.upload(card.el);
  if (!stage.begin([0, 0, 0, 0])) return;

  const gl = stage.gl;
  const elglProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const elglVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  ensureHelpers(gl);

  // Pass 1: Poincare disk backdrop and {7, 4} geodesic tiling.
  gl.useProgram(bgProg);
  gl.bindVertexArray(bgVao);
  gl.uniform2f(bgUniforms.uCanvasSize, cw, ch);
  gl.uniform2f(bgUniforms.uCenter, cx, cy);
  gl.uniform1f(bgUniforms.uRadius, R);
  gl.uniform2f(bgUniforms.uViewU, state.view.u.x, state.view.u.y);
  gl.uniform2f(bgUniforms.uViewA, state.view.a.x, state.view.a.y);
  gl.uniform1f(bgUniforms.uShowTiling, state.showTiling ? 1 : 0);
  gl.uniform1f(bgUniforms.uTilingGlow, state.tilingGlow);
  gl.uniform1f(bgUniforms.uShowArcs, state.showArcs ? 1 : 0);
  gl.uniform1f(bgUniforms.uShowRimGlow, state.showRimGlow ? 1 : 0);
  gl.uniform1f(bgUniforms.uDarkMode, darkScheme?.matches ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Restore ElementGL's program and VAO to draw the 8 curved HTML cards.
  gl.useProgram(elglProgram);
  gl.bindVertexArray(elglVao);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const items = cards.map((card) => {
    const mob = cardMobius(state.view, card.home);
    card.lastMob = mob;
    return { card, mob, dist2: cabs2(mob.center) };
  });
  // Paint outer cards first so the central card always composites on top.
  items.sort((a, b) => b.dist2 - a.dist2);

  const firstEl = cards[0].el;
  const firstW = firstEl.offsetWidth || 216;
  const unit = geometryUnit(canvas, firstEl, firstW);
  const quadMat = new Float32Array(16);
  const wireVerts = state.showHitbox ? [] : null;

  let nearest = items[items.length - 1];
  let worstCornerErr = 0;

  for (const { card, mob } of items) {
    const elW = card.el.offsetWidth || 216;
    const elH = card.el.offsetHeight || 150;
    const halfY = HALF_X * (elH / Math.max(elW, 1));
    const bounds = cardQuadBounds(mob, HALF_X, halfY);

    const qx = cx + bounds.minX * R;
    const qy = cy + bounds.minY * R;
    const qw = (bounds.maxX - bounds.minX) * R;
    const qh = (bounds.maxY - bounds.minY) * R;

    if (qw > 1 && qh > 1) {
      ElementGL.rect(canvas, qx, qy, qw, qh, quadMat);
      stage.quad(card.el, quadMat, (g, uniform) => {
        g.uniform2f(uniform('uQuadMin'), bounds.minX, bounds.minY);
        g.uniform2f(uniform('uQuadMax'), bounds.maxX, bounds.maxY);
        g.uniform2f(uniform('uMobU'), mob.u.x, mob.u.y);
        g.uniform2f(uniform('uMobA'), mob.a.x, mob.a.y);
        g.uniform2f(uniform('uHalfSize'), HALF_X, halfY);
        g.uniform1f(uniform('uDiskRadius'), R);
        g.uniform1f(uniform('uFocused'), state.focusedIndex === card.index ? 1 : 0);
      });
    }

    // Sync local-Jacobian conformal hit box via updateElementGeometry().
    const hitMatrix = buildJacobianMatrix(mob, cx, cy, R, HALF_X, elW, elH, unit);
    try {
      canvas.updateElementGeometry?.(card.el, { canvasTransform: hitMatrix });
    } catch {}

    const key = `${mob.center.x.toFixed(4)},${mob.center.y.toFixed(4)},${mob.angle.toFixed(4)},${mob.scale.toFixed(4)},${Math.round(cw)}x${Math.round(ch)}`;
    if (card.hitKey !== key) {
      card.hitKey = key;
      card.hitTick = (card.hitTick + 1) & 1;
      card.el.dataset.hitTick = String(card.hitTick);
    }

    const errPx = maxJacobianCornerError(mob, R, HALF_X, halfY);
    if (errPx > worstCornerErr) worstCornerErr = errPx;

    if (wireVerts) {
      const sigma = ((2 * R * HALF_X) / Math.max(elW, 1)) * mob.scale;
      const cosA = mob.u.x;
      const sinA = mob.u.y;
      const ox = cx + R * mob.center.x;
      const oy = cy + R * mob.center.y;
      const hxPx = (elW * 0.5) * sigma;
      const hyPx = (elH * 0.5) * sigma;
      const corners = [
        [-hxPx, -hyPx],
        [ hxPx, -hyPx],
        [ hxPx,  hyPx],
        [-hxPx,  hyPx],
      ].map(([lx, ly]) => [
        ox + lx * cosA - ly * sinA,
        oy + lx * sinA + ly * cosA,
      ]);
      const isCenter = card === nearest && cabs(mob.center) < 0.12;
      const rgba = isCenter ? [0.37, 0.88, 0.55, 0.95] : [1.0, 0.50, 0.30, 0.90];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        pushWireSegment(wireVerts, a[0], a[1], b[0], b[1], isCenter ? 2.4 : 1.9, cw, ch, rgba);
      }
      // Small tangent-point crosshair at w_k.
      pushWireSegment(wireVerts, ox - 5, oy, ox + 5, oy, 1.6, cw, ch, rgba);
      pushWireSegment(wireVerts, ox, oy - 5, ox, oy + 5, 1.6, cw, ch, rgba);
      // Connecting error ticks from linear corners to exact curved Mobius corners.
      const exactCorners = [
        { x: -HALF_X, y: -halfY },
        { x:  HALF_X, y: -halfY },
        { x:  HALF_X, y:  halfY },
        { x: -HALF_X, y:  halfY },
      ].map((z) => {
        const w = applyMobius(z, mob.u, mob.a);
        return [cx + R * w.x, cy + R * w.y];
      });
      for (let i = 0; i < 4; i++) {
        pushWireSegment(wireVerts, corners[i][0], corners[i][1], exactCorners[i][0], exactCorners[i][1], 1.5, cw, ch, [1.0, 0.84, 0.35, 0.85]);
      }
    }
  }

  // Pass 3: Optional linear Jacobian tangent hit-box wireframe overlay.
  if (wireVerts && wireVerts.length > 0) {
    gl.useProgram(wireProg);
    gl.bindVertexArray(wireVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, wireVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wireVerts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, wireVerts.length / 6);
    gl.useProgram(elglProgram);
    gl.bindVertexArray(elglVao);
  }

  if (nearest) {
    state.centeredIndex = nearest.card.index;
    const centerErr = maxJacobianCornerError(nearest.mob, R, HALF_X, HALF_X * ((nearest.card.el.offsetHeight || 150) / (nearest.card.el.offsetWidth || 216)));
    const text = `Nearest centre: ${nearest.card.title} | |a| = ${cabs(state.view.a).toFixed(2)} | scale 1-|w|^2 = ${nearest.mob.scale.toFixed(2)} | corner error: ${centerErr.toFixed(1)} px (rim max ${worstCornerErr.toFixed(1)} px)`;
    if (telemetryEl && text !== state.lastTelemetry) {
      state.lastTelemetry = text;
      telemetryEl.textContent = text;
    }
  }
}

// --- Geodesic Mobius glide animation ---
function stopGlide() {
  state.glide = null;
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function tickGlide(now) {
  state.rafId = 0;
  if (!state.glide || !state.inView || document.hidden) return;
  const { startView, targetHome, startTime, duration } = state.glide;
  const p = duration <= 0 ? 1 : Math.min(1, (now - startTime) / duration);
  state.view = evaluateGlide(startView, targetHome, p);
  requestRepaint();
  if (p < 1) {
    state.rafId = requestAnimationFrame(tickGlide);
  } else {
    state.glide = null;
  }
}

export function glideToCard(index, { instant = false } = {}) {
  const card = cards[index];
  if (!card) return;
  stopGlide();
  const snap = instant || !!reducedMotion?.matches;
  if (snap) {
    state.view = evaluateGlide(state.view, card.home, 1);
    requestRepaint();
    return;
  }
  state.glide = {
    startView: { u: { ...state.view.u }, a: { ...state.view.a } },
    targetHome: card.home,
    startTime: performance.now(),
    duration: 460,
  };
  state.rafId = requestAnimationFrame(tickGlide);
}

// --- Pointer dragging (Mobius isometry) & tap-to-centre ---
function clientToDisk(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const { cx, cy, R } = diskMetrics();
  const x = ((clientX - rect.left) - cx) / Math.max(R, 1);
  const y = ((clientY - rect.top) - cy) / Math.max(R, 1);
  return { x, y };
}

function isInteractiveTarget(el) {
  return !!el?.closest?.('input, button, select, textarea, label, a');
}

canvas.addEventListener('pointerdown', (e) => {
  if (fallbackActive || e.button > 0) return;
  if (isInteractiveTarget(e.target)) return;
  const diskPt = clientToDisk(e.clientX, e.clientY);
  if (cabs2(diskPt) > 1.04) return;
  stopGlide();
  const hitCardEl = e.target?.closest?.('.hcard');
  const hitCard = hitCardEl ? cards.find((c) => c.el === hitCardEl) : null;
  state.drag = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    p0: clampDisk(diskPt, 0.94),
    startView: { u: { ...state.view.u }, a: { ...state.view.a } },
    moved: false,
    hitCard,
  };
  canvas.classList.add('dragging');
});

window.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
  if (!d.moved && dist >= 5) d.moved = true;
  if (!d.moved) return;
  const p1 = clampDisk(clientToDisk(e.clientX, e.clientY), 0.94);
  state.view = composeDrag(d.startView, d.p0, p1);
  requestRepaint();
});

function finishDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  state.drag = null;
  canvas.classList.remove('dragging');
  // A short tap on an off-centre card glides it smoothly to z = 0.
  if (!d.moved) {
    let target = d.hitCard;
    if (!target) {
      const p = clientToDisk(e.clientX, e.clientY);
      if (cabs2(p) < 1) {
        let best = null, bestDist = 0.32;
        for (const card of cards) {
          const mob = card.lastMob ?? cardMobius(state.view, card.home);
          const dist = cabs(csub(p, mob.center));
          if (dist < bestDist) { bestDist = dist; best = card; }
        }
        target = best;
      }
    }
    if (target) {
      const mob = cardMobius(state.view, target.home);
      if (cabs(mob.center) > 0.05) glideToCard(target.index);
    }
  }
}

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);

// --- External controls ---
resetBtn?.addEventListener('click', () => glideToCard(0));
nextBtn?.addEventListener('click', () => glideToCard((state.centeredIndex + 1) % cards.length));
hitboxCheck?.addEventListener('change', () => {
  state.showHitbox = !!hitboxCheck.checked;
  requestRepaint();
});
tilingCheck?.addEventListener('change', () => {
  state.showTiling = !!tilingCheck.checked;
  requestRepaint();
});

// Pause offscreen via IntersectionObserver and visibilitychange.
if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(([entry]) => {
    state.inView = !!entry?.isIntersecting;
    if (state.inView) {
      if (state.glide && !state.rafId) state.rafId = requestAnimationFrame(tickGlide);
      requestRepaint();
    } else if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }, { rootMargin: '120px' });
  io.observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.inView) {
    if (state.glide && !state.rafId) state.rafId = requestAnimationFrame(tickGlide);
    requestRepaint();
  }
});

// Boot the single ElementGL context (or plain HTML fallback).
if (!glSupported) {
  enterFallback('HTML-in-canvas WebGL 2 (texElementSubImage2D) is not available in this browser, so the eight cards are shown as plain HTML.');
} else {
  try {
    stage = new ElementGL(canvas, {
      fragment: CARD_FRAGMENT,
      onLost() {
        stopGlide();
        clearHelpers();
        enterFallback('The WebGL 2 context was lost. The eight cards moved to plain HTML so your input stays accessible.');
      },
      onRestored() {
        clearHelpers();
        leaveFallback();
        requestRepaint();
      },
    });
    canvas.addEventListener('paint', drawScene);
    canvas.requestPaint?.();
  } catch (err) {
    enterFallback(`Could not start ElementGL (${err?.message ?? err}). Showing the eight cards as plain HTML.`);
  }
}

// --- Live checks (tap-gated via <meta name="checks" content="tap">) ---
const tbody = document.getElementById('results');

const checks = [
  {
    name: 'ElementGL + texElementSubImage2D() renders the hyperbolic disk cards',
    why: 'Builds an isolated drawable canvas on testStage(), uploads a live card via ElementGL.upload(), draws it at z = 0 and at c = (0.65, 0), and reads pixels back once.',
    run: async () => {
      if (!glSupported) throw new Error('texElementSubImage2D is not supported in this browser');
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:200px;height:200px;';
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:84px;background:#e0522b;color:#fff;font:700 14px system-ui;padding:8px;border-radius:10px;';
      card.textContent = 'Poincare';
      c.append(card);
      box.append(c);

      const fx = new ElementGL(c, {
        fragment: CARD_FRAGMENT,
        attributes: { preserveDrawingBuffer: true },
      });
      try {
        const mobCenter = cardMobius({ u: { x: 1, y: 0 }, a: { x: 0, y: 0 } }, { x: 0, y: 0 });
        const mobEdge = cardMobius({ u: { x: 1, y: 0 }, a: { x: 0, y: 0 } }, { x: 0.65, y: 0 });
        const drawFixture = () => {
          fx.upload(card);
          if (!fx.begin([0, 0, 0, 0])) return;
          const R = 95, cx = 100, cy = 100;
          const halfY = 0.38 * (84 / 120);
          for (const mob of [mobCenter, mobEdge]) {
            const b = cardQuadBounds(mob, 0.38, halfY);
            const mat = ElementGL.rect(c, cx + b.minX * R, cy + b.minY * R, (b.maxX - b.minX) * R, (b.maxY - b.minY) * R);
            fx.quad(card, mat, (g, uniform) => {
              g.uniform2f(uniform('uQuadMin'), b.minX, b.minY);
              g.uniform2f(uniform('uQuadMax'), b.maxX, b.maxY);
              g.uniform2f(uniform('uMobU'), mob.u.x, mob.u.y);
              g.uniform2f(uniform('uMobA'), mob.a.x, mob.a.y);
              g.uniform2f(uniform('uHalfSize'), 0.38, halfY);
              g.uniform1f(uniform('uDiskRadius'), R);
              g.uniform1f(uniform('uFocused'), 0);
            });
          }
        };
        c.addEventListener('paint', drawFixture);
        await nextPaint(c);
        await nextPaint(c);

        const gl = fx.gl;
        const sample = (fxX, fxY) => {
          const px = new Uint8Array(4);
          const x = Math.round(fxX * (c.width / 200));
          const y = Math.round((200 - fxY) * (c.height / 200));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return Array.from(px);
        };
        const centerPx = sample(100, 100);
        const edgePx = sample(100 + 0.65 * 95, 100);
        const outsidePx = sample(4, 4);
        if (centerPx[3] < 200) throw new Error(`centre card pixel was empty: rgba(${centerPx.join(',')})`);
        if (edgePx[3] < 200) throw new Error(`curved edge card pixel was empty: rgba(${edgePx.join(',')})`);
        if (outsidePx[3] > 5) throw new Error(`pixel outside disk was not clear: rgba(${outsidePx.join(',')})`);
        return `centre rgba(${centerPx.join(',')}), rim rgba(${edgePx.join(',')}), outside rgba(${outsidePx.join(',')})`;
      } finally {
        fx.dispose();
      }
    },
  },
  {
    name: 'Complex Mobius transform preserves the unit disk and is invertible',
    why: 'Verifies |T_a(z)| < 1, T_{-a}(T_a(z)) === z, combined card inverse M_k^{-1}(M_k(z)) === z, and local derivative |M_k\'(0)| = 1 - |w_k|^2 across 144 interior pairs.',
    run: async () => {
      const radii = [0.0, 0.35, 0.72, 0.94];
      const angles = [0, 1.1, 2.5, 4.2, 5.7];
      const pts = [];
      for (const r of radii) {
        if (r === 0) { pts.push({ x: 0, y: 0 }); continue; }
        for (const th of angles) pts.push({ x: r * Math.cos(th), y: r * Math.sin(th) });
      }
      let pairs = 0;
      let maxNorm = 0;
      let maxInvErr = 0;
      let maxJacErr = 0;

      for (const a of pts) {
        for (const z of pts) {
          pairs++;
          const w = mobiusTranslate(z, a);
          const norm = cabs(w);
          if (!(norm < 1)) throw new Error(`|T_a(z)| = ${norm} escaped unit disk`);
          if (norm > maxNorm) maxNorm = norm;
          const back = mobiusTranslate(w, { x: -a.x, y: -a.y });
          const err = cabs(csub(back, z));
          if (err > maxInvErr) maxInvErr = err;
          if (err > 1e-10) throw new Error(`inverse error ${err} exceeded 1e-10`);
        }
      }

      const view = { u: { x: Math.cos(0.7), y: Math.sin(0.7) }, a: { x: 0.42, y: -0.31 } };
      const eps = 1e-6;
      for (const home of homes) {
        const mob = cardMobius(view, home);
        const sample = { x: 0.25, y: -0.18 };
        const fwd = applyMobius(sample, mob.u, mob.a);
        const inv = invertMobius(fwd, mob.u, mob.a);
        const invErr = cabs(csub(inv, sample));
        if (invErr > 1e-10) throw new Error(`M_k inverse error ${invErr}`);

        const w0 = applyMobius({ x: 0, y: 0 }, mob.u, mob.a);
        const wEps = applyMobius({ x: eps, y: 0 }, mob.u, mob.a);
        const numDeriv = { x: (wEps.x - w0.x) / eps, y: (wEps.y - w0.y) / eps };
        const analytic = { x: mob.u.x * mob.scale, y: mob.u.y * mob.scale };
        const jErr = cabs(csub(numDeriv, analytic));
        if (jErr > maxJacErr) maxJacErr = jErr;
        if (jErr > 1e-4) throw new Error(`Jacobian mismatch ${jErr}`);
      }

      return `${pairs} pairs tested; max |T_a(z)| = ${maxNorm.toFixed(5)} < 1; max inverse err = ${maxInvErr.toExponential(1)}; Jacobian err = ${maxJacErr.toExponential(1)}`;
    },
  },
  {
    name: 'updateElementGeometry() local-Jacobian matrix aligns hit-test at the centre card',
    why: 'Places a live card with a button inside an isolated ElementGL canvas on testStage(), applies the local-Jacobian DOMMatrix, and checks document.elementsFromPoint() at the centre and after a Mobius shift.',
    run: async () => {
      if (!glSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('ElementGL or updateElementGeometry() is not supported');
      }
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:240px;height:240px;';
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:84px;display:flex;align-items:center;justify-content:center;background:#1d2b3a;border-radius:8px;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Hit';
      btn.style.cssText = 'width:80px;height:44px;';
      card.append(btn);
      c.append(card);
      box.append(c);

      const fx = new ElementGL(c, { fragment: CARD_FRAGMENT });
      let curView = { u: { x: 1, y: 0 }, a: { x: 0, y: 0 } };
      let tick = 0;
      let lastKey = '';
      const R = 112, cx = 120, cy = 120, hx = 0.42;
      const drawFixture = () => {
        fx.upload(card);
        if (!fx.begin([0, 0, 0, 0])) return;
        const mob = cardMobius(curView, { x: 0, y: 0 });
        const elW = card.offsetWidth || 120;
        const elH = card.offsetHeight || 84;
        const hy = hx * (elH / elW);
        const b = cardQuadBounds(mob, hx, hy);
        const mat = ElementGL.rect(c, cx + b.minX * R, cy + b.minY * R, (b.maxX - b.minX) * R, (b.maxY - b.minY) * R);
        fx.quad(card, mat, (g, uniform) => {
          g.uniform2f(uniform('uQuadMin'), b.minX, b.minY);
          g.uniform2f(uniform('uQuadMax'), b.maxX, b.maxY);
          g.uniform2f(uniform('uMobU'), mob.u.x, mob.u.y);
          g.uniform2f(uniform('uMobA'), mob.a.x, mob.a.y);
          g.uniform2f(uniform('uHalfSize'), hx, hy);
          g.uniform1f(uniform('uDiskRadius'), R);
          g.uniform1f(uniform('uFocused'), 0);
        });
        const unit = geometryUnit(c, card, elW);
        const jm = buildJacobianMatrix(mob, cx, cy, R, hx, elW, elH, unit);
        c.updateElementGeometry(card, { canvasTransform: jm });
        const key = `${mob.center.x.toFixed(3)},${mob.center.y.toFixed(3)}`;
        if (key !== lastKey) {
          lastKey = key;
          card.dataset.hitTick = String((tick++) & 1);
        }
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        const rect = c.getBoundingClientRect();
        const atOrigin = document.elementsFromPoint(rect.left + cx, rect.top + cy);
        const hitOrigin = atOrigin.includes(btn) || atOrigin.includes(card);
        if (!hitOrigin) throw new Error(`centre hit missed: got ${atOrigin.slice(0, 3).map((e) => e.tagName).join(', ')}`);

        // Apply a Mobius shift so the card moves to (-0.42, 0.20) in disk coordinates.
        curView = { u: { x: 1, y: 0 }, a: { x: 0.42, y: -0.20 } };
        await nextPaint(c);
        await nextPaint(c);
        const shiftedMob = cardMobius(curView, { x: 0, y: 0 });
        const sx = rect.left + cx + R * shiftedMob.center.x;
        const sy = rect.top + cy + R * shiftedMob.center.y;
        const atShifted = document.elementsFromPoint(sx, sy);
        const hitShifted = atShifted.includes(btn) || atShifted.includes(card);
        if (!hitShifted) throw new Error(`shifted hit missed at (${Math.round(sx)},${Math.round(sy)}): got ${atShifted.slice(0, 3).map((e) => e.tagName).join(', ')}`);

        return `origin hit ${atOrigin[0]?.tagName}; shifted hit ${atShifted[0]?.tagName} at w=(${shiftedMob.center.x.toFixed(2)}, ${shiftedMob.center.y.toFixed(2)})`;
      } finally {
        fx.dispose();
      }
    },
  },
  {
    name: 'Focusing an off-centre card glides it cleanly to z = 0 without breaking DOM input state',
    why: 'Runs a geodesic glide on an isolated 2-card fixture in testStage() with a live text input and checkbox, confirming the off-centre card arrives upright at z = 0 and keeps its DOM values.',
    run: async () => {
      const box = testStage();
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:200px;height:120px;';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'geodesic-7';
      input.setAttribute('aria-label', 'Fixture note');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = true;
      chk.setAttribute('aria-label', 'Fixture check');
      wrap.append(input, chk);
      box.append(wrap);

      const targetHome = homes[3]; // Off-centre ring card at r = 0.790
      let view = { u: { x: Math.cos(0.4), y: Math.sin(0.4) }, a: { x: -0.25, y: 0.18 } };
      const startMob = cardMobius(view, targetHome);
      const startDist = cabs(startMob.center);
      let glided = false;

      wrap.addEventListener('focusin', () => {
        const startView = { u: { ...view.u }, a: { ...view.a } };
        for (let step = 1; step <= 8; step++) {
          view = evaluateGlide(startView, targetHome, step / 8);
        }
        glided = true;
      });

      // Synthetic focusin tests the handler without stealing document focus from the reader.
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      if (!glided) throw new Error('focusin listener did not trigger the geodesic glide');

      const endMob = cardMobius(view, targetHome);
      const endOrigin = cardMobius(view, homes[0]);
      const endDist = cabs(endMob.center);
      if (endDist > 1e-4) throw new Error(`target card stopped at |w| = ${endDist}`);
      if (endMob.scale < 0.999) throw new Error(`target card scale was ${endMob.scale}`);
      if (Math.abs(endMob.angle) > 1e-4) throw new Error(`target card rotation remained ${endMob.angle}`);
      if (input.value !== 'geodesic-7' || !chk.checked || !input.isConnected) {
        throw new Error('DOM input state changed during glide');
      }
      return `glided |w| ${startDist.toFixed(3)} -> ${endDist.toFixed(5)} (scale ${endMob.scale.toFixed(3)}); old origin moved to |w|=${cabs(endOrigin.center).toFixed(3)}; input="${input.value}", checked=${chk.checked}`;
    },
  },
];

if (tbody) runTests(tbody, checks);
