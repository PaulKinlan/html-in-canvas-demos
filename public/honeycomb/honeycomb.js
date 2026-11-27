import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';
import { banner, supported as canvas2dSupported, runTests, testStage, nextPaint } from '/shared/support.js';

// #region hex-projection
// 25-tile concentric hex rosette: centre (1) + Ring 1 (6) + Ring 2 (12) + Ring 3 (6 at d = sqrt(7)).
export const HEX_COORDS = [
  [0, 0],
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  [2, 0], [2, -1], [2, -2], [1, -2], [0, -2], [-1, -1],
  [-2, 0], [-2, 1], [-2, 2], [-1, 2], [0, 2], [1, 1],
  [3, -1], [1, 2], [-2, 3], [-3, 1], [-1, -2], [2, -3],
];

export const TILE_LAYOUT_PX = 104;
export const R_DOME = 2.90;
export const INERT_SCALE = 0.35;
const SQRT3_HALF = Math.sqrt(3) * 0.5;
const MAX_PAN_RADIUS = 2.75;

/** Convert integer axial hex coordinates (q, r) into isotropic lattice coordinates (hx, hy). */
export function axialToLattice(q, r) {
  return { hx: q + 0.5 * r, hy: SQRT3_HALF * r };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Project one hex tile onto the circular watch dome.
 * Returns canvas CSS coordinates, fisheye scale (0..1), total DOM-to-screen scale, and alpha.
 */
export function projectHexTile(hx, hy, panX, panY, metrics, strength = 1, spacing = 1) {
  const { cx, cy, bezelR, baseFit } = metrics;
  const dx = hx * spacing - panX;
  const dy = hy * spacing - panY;
  const d = Math.hypot(dx, dy);
  const t = Math.min(1, d / R_DOME);
  const theta = t * (Math.PI * 0.5);

  const rSphere = bezelR * Math.sin(theta);
  const rFlat = Math.min(bezelR * 1.15, (d / R_DOME) * (Math.PI * 0.5) * bezelR * 0.85);
  const rPx = rFlat + (rSphere - rFlat) * strength;

  const sphereScale = Math.cos(theta);
  const fisheyeScale = Math.max(0, 1 + (sphereScale - 1) * strength);

  const ux = d > 1e-6 ? dx / d : 0;
  const uy = d > 1e-6 ? dy / d : 0;
  const screenX = cx + ux * rPx;
  const screenY = cy + uy * rPx;

  const horizonT = strength >= 0.99 ? t : Math.max(t * 0.6, rPx / Math.max(bezelR, 1));
  const alpha = horizonT >= 1 ? 0 : 1 - smoothstep(0.87, 0.995, horizonT);
  const totalScale = baseFit * fisheyeScale;
  const visible = alpha > 0.02 && fisheyeScale > 0.02;

  return {
    d,
    screenX,
    screenY,
    dirX: ux * (rPx / Math.max(bezelR, 1)),
    dirY: uy * (rPx / Math.max(bezelR, 1)),
    fisheyeScale,
    totalScale,
    alpha,
    visible,
  };
}
// #endregion hex-projection

// #region tile-shader
const TILE_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform float uScale;
uniform float uAlpha;
uniform float uSquircle;
uniform float uGloss;
uniform float uShade;
uniform float uFocused;
uniform vec3 uAccent;
uniform vec2 uTileDir;
uniform vec2 uWatchCenter;
uniform float uBezelRadius;
uniform vec4 uQuadRect;
uniform float uScreenDiam;

in vec2 vUv;
out vec4 outColor;

float sdTileMask(vec2 p, float squircleMix) {
  float rCircle = length(p);
  vec2 ap = abs(p);
  float rSquircle = pow(pow(ap.x, 4.2) + pow(ap.y, 4.2), 1.0 / 4.2);
  return mix(rCircle, rSquircle, squircleMix) - 0.955;
}

void main() {
  vec2 canvasPx = uQuadRect.xy + vUv * uQuadRect.zw;
  float bezelDist = length(canvasPx - uWatchCenter);
  float bezelClip = 1.0 - smoothstep(uBezelRadius - 1.8, uBezelRadius + 0.5, bezelDist);
  if (bezelClip <= 0.002) discard;

  vec2 p = (vUv - 0.5) * 2.0;
  float sd = sdTileMask(p, uSquircle);
  float pxHalf = max(uScreenDiam * 0.5, 1.0);
  float sdPx = sd * pxHalf;
  float mask = 1.0 - smoothstep(-0.9, 0.9, sdPx);
  if (mask <= 0.002) discard;

  // 4-tap rotated-grid supersampling keeps shrunk ring tiles crisp without moire.
  vec4 texCol;
  float ratio = uSize.x / max(uScreenDiam, 1.0);
  if (ratio > 1.32) {
    vec2 stepUv = (0.36 * ratio) / max(uSize, vec2(1.0));
    texCol = 0.25 * (
      texture(uTex, clamp(vUv + vec2(-stepUv.x * 0.7, -stepUv.y * 0.3), 0.0, 1.0)) +
      texture(uTex, clamp(vUv + vec2( stepUv.x * 0.3, -stepUv.y * 0.7), 0.0, 1.0)) +
      texture(uTex, clamp(vUv + vec2(-stepUv.x * 0.3,  stepUv.y * 0.7), 0.0, 1.0)) +
      texture(uTex, clamp(vUv + vec2( stepUv.x * 0.7,  stepUv.y * 0.3), 0.0, 1.0))
    );
  } else {
    texCol = texture(uTex, clamp(vUv, 0.0, 1.0));
  }

  float domeFalloff = mix(1.0, 0.62 + 0.38 * uScale, uShade);
  vec3 rgb = texCol.rgb * domeFalloff;

  if (uGloss > 0.5) {
    // Subtle watch-crystal dome highlight and edge Fresnel rim.
    vec2 lightOff = p - vec2(-0.34, -0.38) + uTileDir * 0.28;
    float specSpot = exp(-dot(lightOff, lightOff) * 3.8) * 0.095 * (0.4 + 0.6 * uScale);
    float rimGlow = smoothstep(-4.2, -1.2, sdPx) * (1.0 - smoothstep(-0.8, 0.6, sdPx));
    float topGlint = clamp(-p.y * 0.65 - p.x * 0.35, 0.0, 1.0);
    rgb += vec3(1.0) * specSpot * texCol.a;
    rgb += mix(vec3(0.75, 0.84, 0.96), uAccent, 0.45 * uScale) * rimGlow * (0.14 + 0.24 * topGlint) * texCol.a;
  }

  if (uFocused > 0.5) {
    float ring = smoothstep(-4.5, -2.0, sdPx) * (1.0 - smoothstep(-1.0, 0.6, sdPx));
    rgb = mix(rgb, uAccent * texCol.a, ring * 0.95);
  }

  float outA = texCol.a * mask * uAlpha * bezelClip;
  outColor = vec4(rgb * mask * uAlpha * bezelClip, outA);
}`;
// #endregion tile-shader

// Backdrop watch dial + brushed bezel + spherical hex guide lattice.
const DIAL_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const DIAL_FS = `#version 300 es
precision highp float;

uniform vec2 uCanvasSize;
uniform vec2 uWatchCenter;
uniform float uBezelRadius;
uniform vec2 uPan;
uniform float uFisheye;
uniform float uSpacing;
uniform float uShowGrid;
uniform float uBezelGlow;
uniform float uRimSheen;
uniform float uGloss;
uniform vec3 uAccent;
uniform float uDarkMode;

in vec2 vUv;
out vec4 outColor;

const float R_DOME = 2.90;
const float PI_HALF = 1.5707963268;
const float INV_SQRT3 = 0.5773502692;

void main() {
  vec2 px = vUv * uCanvasSize;
  vec2 delta = px - uWatchCenter;
  float r = length(delta);
  float bezelBand = max(11.0, uBezelRadius * 0.068);

  if (r > uBezelRadius + bezelBand + 2.0) {
    float shadow = exp(-(r - uBezelRadius - bezelBand) * 0.14) * 0.16;
    outColor = vec4(0.0, 0.0, 0.0, shadow);
    return;
  }

  // Brushed watch bezel outside uBezelRadius.
  if (r >= uBezelRadius) {
    float t = clamp((r - uBezelRadius) / bezelBand, 0.0, 1.0);
    float ang = atan(delta.y, delta.x);
    float sheen = 0.5 + 0.5 * cos(ang * 2.0 + 0.9);
    float ridge = sin(t * 3.14159265);
    vec3 metal = mix(vec3(0.11, 0.13, 0.17), vec3(0.28, 0.32, 0.39), ridge * (0.45 + 0.55 * sheen * uRimSheen));
    metal += uAccent * (1.0 - smoothstep(0.0, 0.35, t)) * (0.14 + 0.32 * uBezelGlow);
    float edgeAlpha = 1.0 - smoothstep(bezelBand - 1.5, bezelBand + 1.0, r - uBezelRadius);
    outColor = vec4(metal * edgeAlpha, edgeAlpha);
    return;
  }

  // Deep OLED dial with subtle radial shading.
  float normR = r / max(uBezelRadius, 1.0);
  vec3 dial = mix(vec3(0.055, 0.072, 0.108), vec3(0.018, 0.022, 0.036), smoothstep(0.0, 1.0, normR));
  dial += uAccent * (0.04 + 0.05 * uBezelGlow) * (1.0 - smoothstep(0.0, 0.65, normR));

  // Spherical-inverse hex lattice dot guide that tracks panning in lockstep with tiles.
  if (uShowGrid > 0.5) {
    float rClamp = min(normR, 0.995);
    float theta = asin(rClamp);
    float dSphere = (theta / PI_HALF) * R_DOME;
    float dFlat = (normR * R_DOME) / (PI_HALF * 0.85);
    float dLat = mix(dFlat, dSphere, uFisheye);
    vec2 dir = r > 1e-4 ? delta / r : vec2(0.0);
    vec2 lat = (dir * dLat + uPan) / max(uSpacing, 0.4);

    // Nearest hex centre in axial coordinates.
    float qf = lat.x - INV_SQRT3 * lat.y;
    float rf = (2.0 * INV_SQRT3) * lat.y;
    float sf = -qf - rf;
    float rq = round(qf), rr = round(rf), rs = round(sf);
    float dq = abs(rq - qf), dr = abs(rr - rf), ds = abs(rs - sf);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;

    vec2 nearLat = vec2(rq + 0.5 * rr, 0.8660254038 * rr);
    float cellDist = length(lat - nearLat);
    float dotMask = 1.0 - smoothstep(0.04, 0.11, cellDist);
    float ringMask = (1.0 - smoothstep(0.015, 0.045, abs(cellDist - 0.48))) * 0.25;
    float horizon = 1.0 - smoothstep(0.82, 0.99, normR);
    dial += mix(vec3(0.28, 0.40, 0.55), uAccent, 0.45) * (dotMask * 0.22 + ringMask) * horizon;
  }

  // Watch-crystal top-left gloss arc and inner bezel rim glow.
  if (uGloss > 0.5) {
    vec2 gVec = (delta / max(uBezelRadius, 1.0)) - vec2(-0.36, -0.40);
    float domeArc = exp(-dot(gVec, gVec) * 2.6) * 0.055;
    dial += vec3(0.9, 0.95, 1.0) * domeArc;
  }
  float inPx = uBezelRadius - r;
  float innerRim = exp(-inPx * 0.14) * (0.12 + 0.28 * uBezelGlow);
  dial += uAccent * innerRim;
  dial = mix(dial, vec3(0.02), (1.0 - uDarkMode) * 0.0);

  outColor = vec4(dial, 1.0);
}`;

// Wireframe overlay for updateElementGeometry() hit boxes.
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

function hexToRgb01(hex) {
  const clean = String(hex || '#ff7a4d').replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  if (!Number.isFinite(n)) return [1, 0.48, 0.30];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function bindTileUniforms(gl, uniform, p) {
  gl.uniform1f(uniform('uScale'), p.scale);
  gl.uniform1f(uniform('uAlpha'), p.alpha);
  gl.uniform1f(uniform('uSquircle'), p.squircle);
  gl.uniform1f(uniform('uGloss'), p.gloss);
  gl.uniform1f(uniform('uShade'), p.shade);
  gl.uniform1f(uniform('uFocused'), p.focused);
  gl.uniform3f(uniform('uAccent'), p.accent[0], p.accent[1], p.accent[2]);
  gl.uniform2f(uniform('uTileDir'), p.dirX, p.dirY);
  gl.uniform2f(uniform('uWatchCenter'), p.cx, p.cy);
  gl.uniform1f(uniform('uBezelRadius'), p.bezelR);
  gl.uniform4f(uniform('uQuadRect'), p.qx, p.qy, p.qw, p.qh);
  gl.uniform1f(uniform('uScreenDiam'), p.qw);
}

// #region hit-sync
/**
 * Build the DOMMatrix mapping a tile's local layout box (0..tileW, 0..tileH)
 * to its projected position and scale on the canvas in updateElementGeometry() units.
 */
export function buildTileMatrix(screenX, screenY, totalScale, tileW, tileH, unit) {
  return new DOMMatrix()
    .scale(unit)
    .translate(screenX, screenY)
    .scale(totalScale)
    .translate(-tileW * 0.5, -tileH * 0.5);
}

/**
 * Sync inert gating and updateElementGeometry() for one tile, toggling
 * dataset.hitTick only when its quantized screen rectangle changes.
 */
export function syncTileGeometry(canvasEl, tile, geom, tileW, tileH, unit, cw, ch) {
  const shouldInert = !geom.visible || geom.fisheyeScale < INERT_SCALE;
  if (tile.el.inert !== shouldInert) {
    tile.el.inert = shouldInert;
  }

  const m = buildTileMatrix(geom.screenX, geom.screenY, geom.totalScale, tileW, tileH, unit);
  try {
    canvasEl.updateElementGeometry?.(tile.el, { canvasTransform: m });
  } catch {}

  const key = `${geom.screenX.toFixed(1)},${geom.screenY.toFixed(1)},${geom.totalScale.toFixed(3)},${shouldInert ? 1 : 0},${Math.round(cw)}x${Math.round(ch)}`;
  if (tile.hitKey !== key) {
    tile.hitKey = key;
    tile.hitTick = (tile.hitTick + 1) & 1;
    tile.el.dataset.hitTick = String(tile.hitTick);
  }
  return !shouldInert;
}
// #endregion hit-sync

function pushWireBox(verts, qx, qy, qw, qh, thickness, cw, ch, rgba) {
  const seg = (x0, y0, x1, y1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const nx = (-dy / len) * (thickness * 0.5);
    const ny = (dx / len) * (thickness * 0.5);
    const tx = (x) => (2 * x) / cw - 1;
    const ty = (y) => 1 - (2 * y) / ch;
    const [r, g, b, a] = rgba;
    const p0x = tx(x0 + nx), p0y = ty(y0 + ny);
    const p1x = tx(x0 - nx), p1y = ty(y0 - ny);
    const p2x = tx(x1 + nx), p2y = ty(y1 + ny);
    const p3x = tx(x1 - nx), p3y = ty(y1 - ny);
    verts.push(
      p0x, p0y, r, g, b, a,
      p1x, p1y, r, g, b, a,
      p2x, p2y, r, g, b, a,
      p2x, p2y, r, g, b, a,
      p1x, p1y, r, g, b, a,
      p3x, p3y, r, g, b, a,
    );
  };
  seg(qx, qy, qx + qw, qy);
  seg(qx + qw, qy, qx + qw, qy + qh);
  seg(qx + qw, qy + qh, qx, qy + qh);
  seg(qx, qy + qh, qx, qy);
}

// --- Main page setup ---
banner();

const stageBox = document.getElementById('hc-stage');
let canvas = document.getElementById('hc-canvas');
const fallbackGrid = document.getElementById('fallback-grid');
const statusNote = document.getElementById('stage-status');
const telemetryEl = document.getElementById('hc-telemetry');
const routePill = document.getElementById('route-pill');

const hubBtn = document.getElementById('btn-hub');
const tileSelect = document.getElementById('sel-tile');
const centreBtn = document.getElementById('btn-centre');
const nextBtn = document.getElementById('btn-next');
const hitboxCheck = document.getElementById('chk-hitbox');

const tileEls = Array.from(canvas.querySelectorAll('.hc-tile'));
const tiles = tileEls.map((el, index) => {
  const q = Number(el.dataset.q ?? HEX_COORDS[index]?.[0] ?? 0);
  const r = Number(el.dataset.r ?? HEX_COORDS[index]?.[1] ?? 0);
  const { hx, hy } = axialToLattice(q, r);
  return {
    index,
    q,
    r,
    hx,
    hy,
    el,
    title: el.dataset.title || `Tile ${index}`,
    uploaded: false,
    dirty: true,
    hitKey: '',
    hitTick: 0,
    lastGeom: null,
  };
});

if (tileSelect) {
  for (const t of tiles) {
    const opt = document.createElement('option');
    opt.value = String(t.index);
    opt.textContent = `${t.index}: ${t.title}`;
    tileSelect.append(opt);
  }
  tileSelect.value = '19';
}

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia?.('(prefers-color-scheme: dark)');

const state = {
  route: 'starting',
  panX: 0,
  panY: 0,
  velX: 0,
  velY: 0,
  targetX: 0,
  targetY: 0,
  springActive: false,
  rafId: 0,
  lastStepTime: 0,
  inView: true,
  focusedIndex: -1,
  nearestIndex: 0,
  activeCount: 19,
  inertCount: 6,
  uploads: 0,
  frames: 0,
  // Interactive tile parameters
  fisheyeStrength: 1.0,
  spacing: 1.0,
  showHitbox: false,
  showGrid: true,
  springSnap: true,
  gloss: true,
  squircle: 1.0,
  bezelGlow: 0.5,
  rimSheen: 0.6,
  domeShade: 0.5,
  accentHex: '#ff7a4d',
  accentRgb: hexToRgb01('#ff7a4d'),
  clock24h: true,
  drag: null,
  lastTap: { time: 0, x: 0, y: 0 },
  suppressClickUntil: 0,
  lastDblCenterAt: 0,
  lastTelemetry: '',
};

let stage = null;
let ctx2d = null;
let dialProg = null;
let dialUniforms = null;
let dialVao = null;
let dialVbo = null;
let wireProg = null;
let wireVao = null;
let wireVbo = null;
let fallbackActive = false;
let clockTimer = 0;

function clearHelpers() {
  dialProg = null;
  dialUniforms = null;
  dialVao = null;
  dialVbo = null;
  wireProg = null;
  wireVao = null;
  wireVbo = null;
}

function ensureHelpers(gl) {
  if (!dialProg) {
    dialProg = compileProgram(gl, DIAL_VS, DIAL_FS);
    dialUniforms = {
      uCanvasSize: gl.getUniformLocation(dialProg, 'uCanvasSize'),
      uWatchCenter: gl.getUniformLocation(dialProg, 'uWatchCenter'),
      uBezelRadius: gl.getUniformLocation(dialProg, 'uBezelRadius'),
      uPan: gl.getUniformLocation(dialProg, 'uPan'),
      uFisheye: gl.getUniformLocation(dialProg, 'uFisheye'),
      uSpacing: gl.getUniformLocation(dialProg, 'uSpacing'),
      uShowGrid: gl.getUniformLocation(dialProg, 'uShowGrid'),
      uBezelGlow: gl.getUniformLocation(dialProg, 'uBezelGlow'),
      uRimSheen: gl.getUniformLocation(dialProg, 'uRimSheen'),
      uGloss: gl.getUniformLocation(dialProg, 'uGloss'),
      uAccent: gl.getUniformLocation(dialProg, 'uAccent'),
      uDarkMode: gl.getUniformLocation(dialProg, 'uDarkMode'),
    };
    dialVao = gl.createVertexArray();
    dialVbo = gl.createBuffer();
    gl.bindVertexArray(dialVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dialVbo);
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

function watchMetrics() {
  const cw = canvas.clientWidth || 380;
  const ch = canvas.clientHeight || 380;
  const cx = cw * 0.5;
  const cy = ch * 0.5;
  const bezelR = Math.min(cw, ch) * 0.455;
  const tileW = tiles[0]?.el.offsetWidth || TILE_LAYOUT_PX;
  const tileH = tiles[0]?.el.offsetHeight || TILE_LAYOUT_PX;
  const centerDiam = bezelR * 0.488;
  const baseFit = centerDiam / Math.max(tileW, 1);
  return { cw, ch, cx, cy, bezelR, tileW, tileH, baseFit };
}

function markAllTilesDirty() {
  for (const t of tiles) t.dirty = true;
}

function requestRepaint() {
  if (fallbackActive) return;
  if (state.route === 'webgl' && (!stage || stage.lost)) return;
  canvas.requestPaint?.();
}

function setRouteLabel(text) {
  if (routePill) routePill.textContent = text;
}

function enterFallback(reason) {
  fallbackActive = true;
  state.route = 'plain';
  stopSpring();
  stageBox.classList.add('plain');
  canvas.hidden = true;
  fallbackGrid.hidden = false;
  for (const t of tiles) {
    t.el.inert = false;
    t.el.removeAttribute('drawable');
    fallbackGrid.append(t.el);
  }
  if (statusNote) {
    statusNote.hidden = false;
    statusNote.textContent = reason;
  }
  setRouteLabel('Plain HTML');
}

function leaveFallback() {
  fallbackActive = false;
  state.route = 'webgl';
  stageBox.classList.remove('plain');
  canvas.hidden = false;
  fallbackGrid.hidden = true;
  for (const t of tiles) {
    t.el.setAttribute('drawable', '');
    t.uploaded = false;
    t.dirty = true;
    t.hitKey = '';
    canvas.append(t.el);
  }
  if (statusNote) statusNote.hidden = true;
  setRouteLabel('WebGL 2 (ElementGL)');
}

function updateClockDisplay(markDirty = true) {
  const clockOut = document.getElementById('t1-time');
  const modeBtn = document.getElementById('t1-mode');
  if (!clockOut) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  let hh = now.getHours();
  if (!state.clock24h) hh = (hh % 12) || 12;
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const next = reducedMotion?.matches ? `${pad(hh)}:${mm}` : `${pad(hh)}:${mm}:${ss}`;
  if (clockOut.textContent !== next) {
    clockOut.textContent = next;
    if (markDirty && tiles[1]) {
      tiles[1].dirty = true;
      requestRepaint();
    }
  }
  if (modeBtn) modeBtn.textContent = state.clock24h ? '24h' : '12h';
}

function startClock() {
  if (clockTimer) return;
  if (!state.inView || document.hidden || reducedMotion?.matches) return;
  clockTimer = setInterval(() => {
    if (state.inView && !document.hidden) updateClockDisplay(true);
  }, 1000);
}

function stopClock() {
  if (!clockTimer) return;
  clearInterval(clockTimer);
  clockTimer = 0;
}

// --- Wire interactive controls inside the 25 tiles ---
function syncHitboxFlag(checked) {
  state.showHitbox = !!checked;
  if (hitboxCheck && hitboxCheck.checked !== state.showHitbox) hitboxCheck.checked = state.showHitbox;
  const tileChk = document.getElementById('t5-hit');
  const tileOut = document.getElementById('t5-out');
  if (tileChk && tileChk.checked !== state.showHitbox) tileChk.checked = state.showHitbox;
  if (tileOut) tileOut.textContent = state.showHitbox ? 'On' : 'Off';
  if (tiles[5]) tiles[5].dirty = true;
  requestRepaint();
}

function wireTileControls() {
  const mark = (idx) => {
    if (tiles[idx]) tiles[idx].dirty = true;
    requestRepaint();
  };

  // Tile 0 & Tile 23: editable text inputs
  const noteInput = document.getElementById('t0-note');
  const noteLen = document.getElementById('t0-len');
  noteInput?.addEventListener('input', () => {
    if (noteLen) noteLen.textContent = `${noteInput.value.length} ch`;
    mark(0);
  });

  const tagInput = document.getElementById('t23-tag');
  const tagLen = document.getElementById('t23-len');
  tagInput?.addEventListener('input', () => {
    if (tagLen) tagLen.textContent = `${tagInput.value.length} ch`;
    mark(23);
  });

  // Tile 1: clock 12h/24h toggle
  document.getElementById('t1-mode')?.addEventListener('click', () => {
    state.clock24h = !state.clock24h;
    updateClockDisplay(true);
  });

  // +1 counters (Tiles 2, 9, 15, 19, 24)
  const counters = [
    [2, 't2-btn', 't2-val'],
    [9, 't9-btn', 't9-val'],
    [15, 't15-btn', 't15-val'],
    [19, 't19-btn', 't19-val'],
    [24, 't24-btn', 't24-val'],
  ];
  for (const [idx, btnId, valId] of counters) {
    const btn = document.getElementById(btnId);
    const out = document.getElementById(valId);
    btn?.addEventListener('click', () => {
      if (out) out.textContent = String((Number(out.textContent) || 0) + 1);
      mark(idx);
    });
  }

  // Colour accent chips (Tiles 3, 7, 10, 13, 16, 22)
  const chips = Array.from(stageBox.querySelectorAll('.hc-chip'));
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const col = chip.dataset.accent || '#ff7a4d';
      state.accentHex = col;
      state.accentRgb = hexToRgb01(col);
      stageBox.style.setProperty('--cluster-accent', col);
      for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
      markAllTilesDirty();
      requestRepaint();
    });
  }

  // Tile 4: dome lens slider
  const lensRange = document.getElementById('t4-lens');
  const lensOut = document.getElementById('t4-out');
  lensRange?.addEventListener('input', () => {
    const v = Number(lensRange.value);
    state.fisheyeStrength = v / 100;
    if (lensOut) lensOut.textContent = `${v}%`;
    mark(4);
  });

  // Tile 5: hit-box overlay switch
  document.getElementById('t5-hit')?.addEventListener('change', (e) => {
    syncHitboxFlag(e.target.checked);
  });

  // Tile 8: hex grid switch
  const gridSwitch = document.getElementById('t8-grid');
  const gridOut = document.getElementById('t8-out');
  gridSwitch?.addEventListener('change', () => {
    state.showGrid = !!gridSwitch.checked;
    if (gridOut) gridOut.textContent = state.showGrid ? 'On' : 'Off';
    mark(8);
  });

  // Tile 12: spring snap switch
  const snapSwitch = document.getElementById('t12-snap');
  const snapOut = document.getElementById('t12-out');
  snapSwitch?.addEventListener('change', () => {
    state.springSnap = !!snapSwitch.checked;
    if (snapOut) snapOut.textContent = state.springSnap ? 'On' : 'Off';
    mark(12);
  });

  // Tile 14: cluster spacing slider
  const gapRange = document.getElementById('t14-gap');
  const gapOut = document.getElementById('t14-out');
  gapRange?.addEventListener('input', () => {
    const v = Number(gapRange.value) / 100;
    state.spacing = v;
    if (gapOut) gapOut.textContent = `${v.toFixed(2)}x`;
    mark(14);
  });

  // Tile 17: dome gloss switch
  const glossSwitch = document.getElementById('t17-gloss');
  const glossOut = document.getElementById('t17-out');
  glossSwitch?.addEventListener('change', () => {
    state.gloss = !!glossSwitch.checked;
    if (glossOut) glossOut.textContent = state.gloss ? 'On' : 'Off';
    mark(17);
  });

  // Tile 18: hub home button
  document.getElementById('t18-hub')?.addEventListener('click', () => {
    centreTile(0);
  });

  // Tile 20: squircle/circle mask switch
  const maskSwitch = document.getElementById('t20-squircle');
  const maskOut = document.getElementById('t20-out');
  maskSwitch?.addEventListener('change', () => {
    state.squircle = maskSwitch.checked ? 1.0 : 0.0;
    if (maskOut) maskOut.textContent = maskSwitch.checked ? 'Squircle' : 'Circle';
    mark(20);
  });

  // Steppers: Glow (Tile 6), Rim (Tile 11), Shade (Tile 21)
  const wireStepper = (idx, decId, incId, valId, apply) => {
    const out = document.getElementById(valId);
    const step = (delta) => {
      const cur = Number(out?.textContent) || 5;
      const next = Math.max(0, Math.min(10, cur + delta));
      if (out) out.textContent = String(next);
      apply(next / 10);
      mark(idx);
    };
    document.getElementById(decId)?.addEventListener('click', () => step(-1));
    document.getElementById(incId)?.addEventListener('click', () => step(1));
  };
  wireStepper(6, 't6-dec', 't6-inc', 't6-val', (v) => { state.bezelGlow = v; });
  wireStepper(11, 't11-dec', 't11-inc', 't11-val', (v) => { state.rimSheen = v; });
  wireStepper(21, 't21-dec', 't21-inc', 't21-val', (v) => { state.domeShade = v; });

  // Focusin centres active keyboard-navigated tiles without moving page focus.
  for (const t of tiles) {
    t.el.addEventListener('focusin', () => {
      state.focusedIndex = t.index;
      t.dirty = true;
      const tx = t.hx * state.spacing;
      const ty = t.hy * state.spacing;
      if (Math.hypot(tx - state.panX, ty - state.panY) > 0.08) {
        snapOrGlideTo(tx, ty);
      } else {
        requestRepaint();
      }
    });
    t.el.addEventListener('focusout', () => {
      t.dirty = true;
      queueMicrotask(() => {
        if (!canvas.contains(document.activeElement)) {
          state.focusedIndex = -1;
        }
        requestRepaint();
      });
    });
  }
}

wireTileControls();
updateClockDisplay(false);

// #region pan-spring
function stopSpring() {
  state.springActive = false;
  state.velX = 0;
  state.velY = 0;
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function tickSpring(now) {
  state.rafId = 0;
  if (!state.springActive || !state.inView || document.hidden) return;
  const dt = Math.min(0.033, Math.max(0.004, (now - state.lastStepTime) / 1000));
  state.lastStepTime = now;

  const stiffness = 190;
  const damping = 26;
  const ax = (state.targetX - state.panX) * stiffness - state.velX * damping;
  const ay = (state.targetY - state.panY) * stiffness - state.velY * damping;
  state.velX += ax * dt;
  state.velY += ay * dt;
  state.panX += state.velX * dt;
  state.panY += state.velY * dt;

  const err = Math.hypot(state.targetX - state.panX, state.targetY - state.panY);
  const spd = Math.hypot(state.velX, state.velY);
  if (err < 0.0015 && spd < 0.01) {
    state.panX = state.targetX;
    state.panY = state.targetY;
    stopSpring();
    requestRepaint();
    return;
  }
  requestRepaint();
  state.rafId = requestAnimationFrame(tickSpring);
}

/** Move (panX, panY) to target lattice offset, snapping when reduced motion is active. */
export function snapOrGlideTo(targetX, targetY, { instant = false } = {}) {
  const maxR = MAX_PAN_RADIUS * state.spacing;
  const r = Math.hypot(targetX, targetY);
  if (r > maxR) {
    targetX = (targetX / r) * maxR;
    targetY = (targetY / r) * maxR;
  }
  if (instant || reducedMotion?.matches) {
    stopSpring();
    state.panX = targetX;
    state.panY = targetY;
    state.targetX = targetX;
    state.targetY = targetY;
    requestRepaint();
    return;
  }
  state.targetX = targetX;
  state.targetY = targetY;
  state.springActive = true;
  state.lastStepTime = performance.now();
  if (!state.rafId) state.rafId = requestAnimationFrame(tickSpring);
}

function centreTile(index, { instant = false } = {}) {
  const t = tiles[index];
  if (!t) return;
  snapOrGlideTo(t.hx * state.spacing, t.hy * state.spacing, { instant });
}

function nearestTileTo(px, py) {
  let best = tiles[0];
  let bestD = Infinity;
  for (const t of tiles) {
    const d = Math.hypot(t.hx * state.spacing - px, t.hy * state.spacing - py);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function findTileAtClientPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestD = Infinity;
  for (const t of tiles) {
    const g = t.lastGeom;
    if (!g || !g.visible) continue;
    const hitR = Math.max((tiles[0]?.el.offsetWidth || TILE_LAYOUT_PX) * g.totalScale * 0.56, 22);
    const d = Math.hypot(x - g.screenX, y - g.screenY);
    if (d <= hitR && d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function isDirectControl(target) {
  return !!target?.closest?.('input[type="text"], input[type="range"], input[type="search"], textarea, select');
}

canvas.addEventListener('pointerdown', (e) => {
  if (fallbackActive || e.button > 0) return;
  if (isDirectControl(e.target)) return;
  stopSpring();
  state.drag = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    lastT: performance.now(),
    vx: 0,
    vy: 0,
    startPanX: state.panX,
    startPanY: state.panY,
    moved: false,
  };
}, true);

window.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
  if (!d.moved && dist >= 7) {
    d.moved = true;
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }
  if (!d.moved) return;

  const { bezelR } = watchMetrics();
  const pxPerUnit = Math.max(24, (bezelR * Math.PI * 0.5) / R_DOME);
  let nextX = d.startPanX - (e.clientX - d.startX) / pxPerUnit;
  let nextY = d.startPanY - (e.clientY - d.startY) / pxPerUnit;
  const maxR = MAX_PAN_RADIUS * state.spacing;
  const r = Math.hypot(nextX, nextY);
  if (r > maxR) {
    const soft = maxR + (r - maxR) * 0.28;
    nextX = (nextX / r) * soft;
    nextY = (nextY / r) * soft;
  }

  const now = performance.now();
  const dt = Math.max(0.008, (now - d.lastT) / 1000);
  const instVx = -(e.clientX - d.lastX) / pxPerUnit / dt;
  const instVy = -(e.clientY - d.lastY) / pxPerUnit / dt;
  d.vx = d.vx * 0.6 + instVx * 0.4;
  d.vy = d.vy * 0.6 + instVy * 0.4;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.lastT = now;

  state.panX = nextX;
  state.panY = nextY;
  requestRepaint();
});

function finishDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  state.drag = null;
  canvas.classList.remove('dragging');
  try {
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  } catch {}

  if (d.moved) {
    state.suppressClickUntil = performance.now() + 100;
    state.velX = Math.max(-12, Math.min(12, d.vx));
    state.velY = Math.max(-12, Math.min(12, d.vy));
    const projX = state.panX + (reducedMotion?.matches ? 0 : state.velX * 0.085);
    const projY = state.panY + (reducedMotion?.matches ? 0 : state.velY * 0.085);
    if (state.springSnap) {
      const target = nearestTileTo(projX, projY);
      centreTile(target.index);
    } else {
      snapOrGlideTo(projX, projY);
    }
    return;
  }

  // Double-tap detection on touch and mouse (works on inert rim tiles too).
  const now = performance.now();
  const sameSpot = Math.hypot(e.clientX - state.lastTap.x, e.clientY - state.lastTap.y) < 30;
  if (now - state.lastTap.time < 340 && sameSpot) {
    state.lastTap.time = 0;
    const hit = findTileAtClientPoint(e.clientX, e.clientY);
    if (hit) {
      const distFromCenter = Math.hypot(hit.hx * state.spacing - state.panX, hit.hy * state.spacing - state.panY);
      if (distFromCenter > 0.15) {
        state.lastDblCenterAt = now;
        centreTile(hit.index);
      }
    }
  } else {
    state.lastTap = { time: now, x: e.clientX, y: e.clientY };
  }
}

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);

window.addEventListener('click', (e) => {
  if (performance.now() < state.suppressClickUntil && canvas.contains(e.target)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

canvas.addEventListener('dblclick', (e) => {
  if (fallbackActive || isDirectControl(e.target)) return;
  if (performance.now() - state.lastDblCenterAt < 350) return;
  const hit = findTileAtClientPoint(e.clientX, e.clientY);
  if (hit) centreTile(hit.index);
});
// #endregion pan-spring

// --- Scene drawing (WebGL 2 ElementGL primary + 2D fallback) ---
function updateTelemetry(nearest, activeCount, inertCount) {
  if (nearest) state.nearestIndex = nearest.index;
  state.activeCount = activeCount;
  state.inertCount = inertCount;
  const scaleStr = nearest?.lastGeom ? nearest.lastGeom.fisheyeScale.toFixed(2) : '1.00';
  const text = `Centred: ${nearest?.title ?? 'Note'} (scale ${scaleStr}) | ${activeCount} active, ${inertCount} inert | pan (${state.panX.toFixed(2)}, ${state.panY.toFixed(2)}) | uploads ${state.uploads} / frames ${state.frames}`;
  if (telemetryEl && text !== state.lastTelemetry) {
    state.lastTelemetry = text;
    telemetryEl.textContent = text;
  }
}

function uploadChangedTiles(event) {
  let changedSet = null;
  if (Array.isArray(event?.changedElements)) {
    changedSet = new Set();
    for (const node of event.changedElements) {
      const host = node?.closest?.('.hc-tile');
      if (host) changedSet.add(host);
    }
  }
  let retry = false;
  for (const t of tiles) {
    if (!t.uploaded || t.dirty || !changedSet || changedSet.has(t.el)) {
      try {
        stage.upload(t.el);
        t.uploaded = true;
        t.dirty = false;
        state.uploads++;
      } catch {
        t.dirty = true;
        retry = true;
      }
    }
  }
  return retry;
}

function drawWebGLScene(event) {
  if (!stage || stage.lost || fallbackActive || !state.inView) return;
  const metrics = watchMetrics();
  const { cw, ch, cx, cy, bezelR, tileW, tileH } = metrics;
  if (cw < 4 || ch < 4) return;

  const needRetry = uploadChangedTiles(event);
  if (!stage.begin([0, 0, 0, 0])) return;
  state.frames++;

  const gl = stage.gl;
  const elglProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const elglVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  ensureHelpers(gl);

  // Pass 1: Watch dial, brushed bezel and spherical hex guide grid.
  gl.useProgram(dialProg);
  gl.bindVertexArray(dialVao);
  gl.uniform2f(dialUniforms.uCanvasSize, cw, ch);
  gl.uniform2f(dialUniforms.uWatchCenter, cx, cy);
  gl.uniform1f(dialUniforms.uBezelRadius, bezelR);
  gl.uniform2f(dialUniforms.uPan, state.panX, state.panY);
  gl.uniform1f(dialUniforms.uFisheye, state.fisheyeStrength);
  gl.uniform1f(dialUniforms.uSpacing, state.spacing);
  gl.uniform1f(dialUniforms.uShowGrid, state.showGrid ? 1 : 0);
  gl.uniform1f(dialUniforms.uBezelGlow, state.bezelGlow);
  gl.uniform1f(dialUniforms.uRimSheen, state.rimSheen);
  gl.uniform1f(dialUniforms.uGloss, state.gloss ? 1 : 0);
  gl.uniform3f(dialUniforms.uAccent, state.accentRgb[0], state.accentRgb[1], state.accentRgb[2]);
  gl.uniform1f(dialUniforms.uDarkMode, darkScheme?.matches ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Restore ElementGL program and VAO to draw the 25 projected tile textures.
  gl.useProgram(elglProgram);
  gl.bindVertexArray(elglVao);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const projected = tiles.map((tile) => {
    const geom = projectHexTile(tile.hx, tile.hy, state.panX, state.panY, metrics, state.fisheyeStrength, state.spacing);
    tile.lastGeom = geom;
    return { tile, geom };
  });
  // Draw outer rim tiles first so the magnified centre tile always sits on top.
  projected.sort((a, b) => b.geom.d - a.geom.d);

  const unit = geometryUnit(canvas, tiles[0].el, tileW);
  const quadMat = new Float32Array(16);
  const wireVerts = state.showHitbox ? [] : null;
  let activeCount = 0;
  let inertCount = 0;

  for (const { tile, geom } of projected) {
    const isActive = syncTileGeometry(canvas, tile, geom, tileW, tileH, unit, cw, ch);
    if (isActive) activeCount++;
    else inertCount++;

    if (!geom.visible || !tile.uploaded) continue;
    const qw = tileW * geom.totalScale;
    const qh = tileH * geom.totalScale;
    const qx = geom.screenX - qw * 0.5;
    const qy = geom.screenY - qh * 0.5;

    ElementGL.rect(canvas, qx, qy, qw, qh, quadMat);
    stage.quad(tile.el, quadMat, (g, uniform) => {
      bindTileUniforms(g, uniform, {
        scale: geom.fisheyeScale,
        alpha: geom.alpha,
        squircle: state.squircle,
        gloss: state.gloss ? 1 : 0,
        shade: state.domeShade,
        focused: state.focusedIndex === tile.index ? 1 : 0,
        accent: state.accentRgb,
        dirX: geom.dirX,
        dirY: geom.dirY,
        cx,
        cy,
        bezelR,
        qx,
        qy,
        qw,
        qh,
      });
    });

    if (wireVerts) {
      const col = !isActive
        ? [0.55, 0.60, 0.68, 0.45]
        : tile === projected[projected.length - 1].tile
          ? [state.accentRgb[0], state.accentRgb[1], state.accentRgb[2], 0.95]
          : [0.37, 0.88, 0.55, 0.85];
      pushWireBox(wireVerts, qx, qy, qw, qh, isActive ? 1.8 : 1.0, cw, ch, col);
    }
  }

  if (wireVerts && wireVerts.length > 0) {
    gl.useProgram(wireProg);
    gl.bindVertexArray(wireVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, wireVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wireVerts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, wireVerts.length / 6);
    gl.useProgram(elglProgram);
    gl.bindVertexArray(elglVao);
  }

  updateTelemetry(projected[projected.length - 1]?.tile, activeCount, inertCount);
  if (needRetry) requestAnimationFrame(() => requestRepaint());
}

function draw2DScene() {
  if (!ctx2d || fallbackActive || !state.inView) return;
  const metrics = watchMetrics();
  const { cw, ch, cx, cy, bezelR, tileW, tileH } = metrics;
  if (cw < 4 || ch < 4) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  state.frames++;
  ctx2d.reset();
  ctx2d.scale(dpr, dpr);

  ctx2d.beginPath();
  ctx2d.arc(cx, cy, bezelR + 10, 0, Math.PI * 2);
  ctx2d.fillStyle = '#242a36';
  ctx2d.fill();

  ctx2d.beginPath();
  ctx2d.arc(cx, cy, bezelR, 0, Math.PI * 2);
  ctx2d.fillStyle = '#090c12';
  ctx2d.fill();

  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, bezelR - 1, 0, Math.PI * 2);
  ctx2d.clip();

  const projected = tiles.map((tile) => {
    const geom = projectHexTile(tile.hx, tile.hy, state.panX, state.panY, metrics, state.fisheyeStrength, state.spacing);
    tile.lastGeom = geom;
    return { tile, geom };
  });
  projected.sort((a, b) => b.geom.d - a.geom.d);

  let activeCount = 0;
  let inertCount = 0;
  for (const { tile, geom } of projected) {
    const isActive = geom.visible && geom.fisheyeScale >= INERT_SCALE;
    if (tile.el.inert !== !isActive) tile.el.inert = !isActive;
    if (isActive) activeCount++;
    else inertCount++;

    if (!geom.visible) continue;
    const qw = tileW * geom.totalScale;
    const qh = tileH * geom.totalScale;
    const qx = geom.screenX - qw * 0.5;
    const qy = geom.screenY - qh * 0.5;

    ctx2d.save();
    ctx2d.globalAlpha = geom.alpha;
    ctx2d.beginPath();
    if (state.squircle > 0.5) ctx2d.roundRect(qx + 1, qy + 1, qw - 2, qh - 2, qw * 0.25);
    else ctx2d.arc(geom.screenX, geom.screenY, qw * 0.48, 0, Math.PI * 2);
    ctx2d.clip();
    try {
      ctx2d.drawElementImage(tile.el, qx, qy, qw, qh);
    } catch {}
    ctx2d.restore();

    if (state.showHitbox) {
      ctx2d.strokeStyle = isActive ? '#5fcf7f' : '#8a95a6';
      ctx2d.lineWidth = isActive ? 1.5 : 1;
      ctx2d.strokeRect(qx, qy, qw, qh);
    }
  }
  ctx2d.restore();
  updateTelemetry(projected[projected.length - 1]?.tile, activeCount, inertCount);
}

// --- External controls ---
hubBtn?.addEventListener('click', () => centreTile(0));
centreBtn?.addEventListener('click', () => {
  const idx = Number(tileSelect?.value ?? 0);
  centreTile(idx);
});
nextBtn?.addEventListener('click', () => {
  const next = (state.nearestIndex + 1) % tiles.length;
  if (tileSelect) tileSelect.value = String(next);
  centreTile(next);
});
hitboxCheck?.addEventListener('change', () => {
  syncHitboxFlag(hitboxCheck.checked);
});

// Pause offscreen via IntersectionObserver and visibilitychange.
if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(([entry]) => {
    state.inView = !!entry?.isIntersecting;
    if (state.inView) {
      startClock();
      if (state.springActive && !state.rafId) {
        state.lastStepTime = performance.now();
        state.rafId = requestAnimationFrame(tickSpring);
      }
      requestRepaint();
    } else {
      stopClock();
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
    }
  }, { rootMargin: '120px' });
  io.observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopClock();
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  } else if (state.inView) {
    updateClockDisplay(false);
    startClock();
    if (state.springActive && !state.rafId) {
      state.lastStepTime = performance.now();
      state.rafId = requestAnimationFrame(tickSpring);
    }
    requestRepaint();
  }
});

// Boot WebGL 2 ElementGL, falling back to 2D drawElementImage() or plain HTML.
function start2DFallback() {
  const fresh = canvas.cloneNode(false);
  fresh.append(...canvas.childNodes);
  canvas.replaceWith(fresh);
  window.__gfx?.retire(canvas);
  canvas = fresh;
  ctx2d = canvas.getContext('2d');
  if (!ctx2d) {
    enterFallback('2D canvas context is unavailable. Showing the 25 tiles as plain HTML.');
    return;
  }
  state.route = '2d';
  setRouteLabel('2D drawElementImage() fallback');
  canvas.addEventListener('paint', draw2DScene);
  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    enterFallback('The 2D canvas context was lost. Showing the 25 tiles as plain HTML.');
  });
  canvas.requestPaint?.();
}

if (glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: TILE_FRAGMENT,
      onLost() {
        stopSpring();
        stopClock();
        clearHelpers();
        for (const t of tiles) t.uploaded = false;
        enterFallback('The WebGL 2 context was lost. The 25 tiles moved to plain HTML so controls stay live.');
      },
      onRestored() {
        clearHelpers();
        leaveFallback();
        startClock();
        requestRepaint();
      },
    });
    state.route = 'webgl';
    setRouteLabel('WebGL 2 (ElementGL)');
    canvas.addEventListener('paint', drawWebGLScene);
    canvas.requestPaint?.();
    startClock();
  } catch (err) {
    if (canvas2dSupported) {
      start2DFallback();
      startClock();
    } else {
      enterFallback(`Could not start ElementGL (${err?.message ?? err}). Showing the 25 tiles as plain HTML.`);
    }
  }
} else if (canvas2dSupported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.route = '2d';
    setRouteLabel('2D drawElementImage() fallback');
    canvas.addEventListener('paint', draw2DScene);
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      enterFallback('The 2D canvas context was lost. Showing the 25 tiles as plain HTML.');
    });
    canvas.requestPaint?.();
    startClock();
  } else {
    enterFallback('HTML-in-canvas is unavailable here. Showing the 25 tiles as plain HTML.');
  }
} else {
  enterFallback('HTML-in-canvas is not available in this browser, so the 25 tiles are shown as plain HTML.');
}

// --- Live checks (tap-gated via <meta name="checks" content="tap">) ---
const tbody = document.getElementById('results');

function makeFixtureCanvas(size = 240) {
  const box = testStage();
  const c = document.createElement('canvas');
  c.setAttribute('content', 'drawable');
  c.setAttribute('layoutsubtree', '');
  c.style.cssText = `display:block;width:${size}px;height:${size}px;`;
  box.append(c);
  return c;
}

const checks = [
  {
    name: 'ElementGL uploads multiple hex-tile drawable children into texElementSubImage2D() textures (gl.getError() === 0)',
    why: 'Builds an isolated 220 x 220 canvas on testStage() with three distinct drawable tiles, uploads each with ElementGL.upload(), draws them, checks gl.getError() === 0, and verifies non-empty pixels.',
    run: async () => {
      if (!glSupported) throw new Error('texElementSubImage2D() is not supported in this browser');
      const c = makeFixtureCanvas(220);
      const defs = [
        ['#e0522b', 'Tile A', 60, 110],
        ['#2a9d8f', 'Tile B', 160, 72],
        ['#3a86ff', 'Tile C', 160, 148],
      ];
      const fixTiles = defs.map(([bg, text]) => {
        const d = document.createElement('div');
        d.setAttribute('drawable', '');
        d.style.cssText = `position:absolute;left:0;top:0;width:72px;height:72px;border-radius:18px;background:${bg};color:#fff;font:700 12px system-ui;display:grid;place-items:center;`;
        d.textContent = text;
        c.append(d);
        return d;
      });

      const fx = new ElementGL(c, {
        fragment: TILE_FRAGMENT,
        attributes: { preserveDrawingBuffer: true },
      });
      let glError = -1;
      try {
        const drawFixture = () => {
          for (const d of fixTiles) {
            try { fx.upload(d); } catch {}
          }
          if (!fx.begin([0, 0, 0, 0])) return;
          const gl = fx.gl;
          while (gl.getError() !== gl.NO_ERROR) {}
          defs.forEach(([, , sx, sy], idx) => {
            const qw = 68, qh = 68;
            const qx = sx - qw * 0.5;
            const qy = sy - qh * 0.5;
            const mat = ElementGL.rect(c, qx, qy, qw, qh);
            fx.quad(fixTiles[idx], mat, (g, uniform) => {
              bindTileUniforms(g, uniform, {
                scale: 1, alpha: 1, squircle: 1, gloss: 0, shade: 0, focused: 0,
                accent: [1, 0.48, 0.3], dirX: 0, dirY: 0, cx: 110, cy: 110, bezelR: 108,
                qx, qy, qw, qh,
              });
            });
          });
          glError = gl.getError();
        };
        c.addEventListener('paint', drawFixture);
        await nextPaint(c);
        await nextPaint(c);

        if (glError !== fx.gl.NO_ERROR) throw new Error(`gl.getError() returned ${glError}`);
        const gl = fx.gl;
        const sampled = defs.map(([, , sx, sy]) => {
          const px = new Uint8Array(4);
          const rx = Math.round(sx * (c.width / 220));
          const ry = Math.round((220 - sy) * (c.height / 220));
          gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return Array.from(px);
        });
        for (const [i, px] of sampled.entries()) {
          if (px[3] < 200) throw new Error(`tile ${i} rendered empty pixel rgba(${px.join(',')})`);
        }
        return `3 textures uploaded (gl.getError() === 0); pixels: ${sampled.map((p) => `rgba(${p.join(',')})`).join(', ')}`;
      } finally {
        fx.dispose();
      }
    },
  },
  {
    name: 'Spherical fisheye falloff magnifies centre tile (scale > 0.9) and shrinks outer-ring tiles (scale < 0.5) symmetrically',
    why: 'Evaluates projectHexTile() across all 25 lattice coordinates at pan (0, 0) and after panning onto an outer Ring 3 tile.',
    run: async () => {
      const metrics = { cx: 190, cy: 190, bezelR: 172, baseFit: 0.85 };
      const lattice = HEX_COORDS.map(([q, r]) => axialToLattice(q, r));
      const centre = projectHexTile(lattice[0].hx, lattice[0].hy, 0, 0, metrics, 1, 1);
      if (!(centre.fisheyeScale > 0.9)) throw new Error(`centre scale was ${centre.fisheyeScale}`);

      const ring1 = lattice.slice(1, 7).map((p) => projectHexTile(p.hx, p.hy, 0, 0, metrics, 1, 1));
      const ring1Scales = ring1.map((g) => g.fisheyeScale);
      if (Math.max(...ring1Scales) - Math.min(...ring1Scales) > 1e-6) {
        throw new Error(`Ring 1 scales differed: ${ring1Scales.join(', ')}`);
      }

      const ring3 = lattice.slice(19, 25).map((p) => projectHexTile(p.hx, p.hy, 0, 0, metrics, 1, 1));
      for (const [i, g] of ring3.entries()) {
        if (!(g.fisheyeScale < 0.5)) throw new Error(`Ring 3 tile ${i} scale ${g.fisheyeScale} >= 0.5`);
      }
      // Opposite pairs in Ring 3 must have matching scale and mirrored screen offsets.
      for (let i = 0; i < 3; i++) {
        const a = ring3[i], b = ring3[i + 3];
        if (Math.abs(a.fisheyeScale - b.fisheyeScale) > 1e-6) throw new Error('opposite outer tiles had asymmetric scale');
        const symErr = Math.hypot((a.screenX - 190) + (b.screenX - 190), (a.screenY - 190) + (b.screenY - 190));
        if (symErr > 1e-3) throw new Error(`opposite outer tile positions differed by ${symErr} px`);
      }

      const target = lattice[19];
      const pannedEdge = projectHexTile(target.hx, target.hy, target.hx, target.hy, metrics, 1, 1);
      const pannedOrigin = projectHexTile(0, 0, target.hx, target.hy, metrics, 1, 1);
      if (!(pannedEdge.fisheyeScale > 0.9 && pannedOrigin.fisheyeScale < 0.5)) {
        throw new Error(`panned scales unexpected: edge=${pannedEdge.fisheyeScale}, origin=${pannedOrigin.fisheyeScale}`);
      }
      return `centre scale ${centre.fisheyeScale.toFixed(3)}, Ring 1 ${ring1Scales[0].toFixed(3)}, Ring 3 ${ring3[0].fisheyeScale.toFixed(3)}; panned Ring 3 -> ${pannedEdge.fisheyeScale.toFixed(3)}`;
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() aligns elementsFromPoint() to a panned and scaled tile button',
    why: 'Creates an isolated ElementGL canvas on testStage(), moves and scales a tile containing a button to two off-centre positions, and checks document.elementsFromPoint().',
    run: async () => {
      if (!glSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('texElementSubImage2D() or updateElementGeometry() is not supported');
      }
      const c = makeFixtureCanvas(240);
      const tile = document.createElement('div');
      tile.setAttribute('drawable', '');
      tile.style.cssText = 'position:absolute;left:0;top:0;width:104px;height:104px;display:grid;place-items:center;background:#1a2232;border-radius:24px;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Hit';
      btn.style.cssText = 'width:72px;height:44px;border-radius:12px;';
      tile.append(btn);
      c.append(tile);

      const fx = new ElementGL(c, { fragment: TILE_FRAGMENT });
      let pos = { x: 168, y: 92, scale: 0.65 };
      const fixTile = { el: tile, hitKey: '', hitTick: 0 };

      const drawFixture = () => {
        try { fx.upload(tile); } catch {}
        if (!fx.begin([0, 0, 0, 0])) return;
        const tw = tile.offsetWidth || 104;
        const th = tile.offsetHeight || 104;
        const qw = tw * pos.scale;
        const qh = th * pos.scale;
        const qx = pos.x - qw * 0.5;
        const qy = pos.y - qh * 0.5;
        const mat = ElementGL.rect(c, qx, qy, qw, qh);
        fx.quad(tile, mat, (g, uniform) => {
          bindTileUniforms(g, uniform, {
            scale: pos.scale, alpha: 1, squircle: 1, gloss: 0, shade: 0, focused: 0,
            accent: [1, 0.48, 0.3], dirX: 0, dirY: 0, cx: 120, cy: 120, bezelR: 116,
            qx, qy, qw, qh,
          });
        });
        const unit = geometryUnit(c, tile, tw);
        syncTileGeometry(c, fixTile, {
          screenX: pos.x, screenY: pos.y, fisheyeScale: pos.scale, totalScale: pos.scale, visible: true,
        }, tw, th, unit, 240, 240);
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        const rect = c.getBoundingClientRect();
        const hit1 = document.elementsFromPoint(rect.left + 168, rect.top + 92);
        const oldCorner = document.elementsFromPoint(rect.left + 32, rect.top + 32);
        if (!hit1.includes(btn)) throw new Error(`panned hit missed at (168, 92): got ${hit1.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        if (oldCorner.includes(btn)) throw new Error('button still hit at unpanned layout origin (32, 32)');

        pos = { x: 76, y: 154, scale: 0.72 };
        await nextPaint(c);
        await nextPaint(c);
        const hit2 = document.elementsFromPoint(rect.left + 76, rect.top + 154);
        const prevSpot = document.elementsFromPoint(rect.left + 168, rect.top + 92);
        if (!hit2.includes(btn)) throw new Error(`second panned hit missed at (76, 154): got ${hit2.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        if (prevSpot.includes(btn)) throw new Error('stale hit cache stayed at (168, 92) after move');

        return `hit ${hit1[0]?.tagName} at (168, 92) scale 0.65, then ${hit2[0]?.tagName} at (76, 154) scale 0.72`;
      } finally {
        fx.dispose();
      }
    },
  },
  {
    name: 'Off-rim tiles marked inert stay excluded from hit-testing while active centre tiles respond to clicks',
    why: 'Places an active centre tile and an inert rim tile inside an ElementGL fixture on testStage(), tests elementsFromPoint() and click response, then swaps their positions.',
    run: async () => {
      if (!glSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('texElementSubImage2D() or updateElementGeometry() is not supported');
      }
      const c = makeFixtureCanvas(240);
      let clicksA = 0, clicksB = 0;
      const makeTile = (label, bg, onClick) => {
        const d = document.createElement('div');
        d.setAttribute('drawable', '');
        d.style.cssText = `position:absolute;left:0;top:0;width:104px;height:104px;display:grid;place-items:center;background:${bg};border-radius:24px;`;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'width:76px;height:46px;';
        b.addEventListener('click', onClick);
        d.append(b);
        c.append(d);
        return { el: d, btn: b, hitKey: '', hitTick: 0 };
      };
      const tileA = makeTile('A', '#225588', () => { clicksA++; });
      const tileB = makeTile('B', '#883344', () => { clicksB++; });

      let layout = [
        { tile: tileA, x: 120, y: 120, scale: 1.0 },
        { tile: tileB, x: 196, y: 120, scale: 0.22 },
      ];
      const fx = new ElementGL(c, { fragment: TILE_FRAGMENT });
      const drawFixture = () => {
        for (const item of layout) {
          try { fx.upload(item.tile.el); } catch {}
        }
        if (!fx.begin([0, 0, 0, 0])) return;
        const unit = geometryUnit(c, tileA.el, tileA.el.offsetWidth || 104);
        for (const item of layout) {
          const tw = item.tile.el.offsetWidth || 104;
          const th = item.tile.el.offsetHeight || 104;
          const qw = tw * item.scale;
          const qh = th * item.scale;
          const qx = item.x - qw * 0.5;
          const qy = item.y - qh * 0.5;
          const mat = ElementGL.rect(c, qx, qy, qw, qh);
          fx.quad(item.tile.el, mat, (g, uniform) => {
            bindTileUniforms(g, uniform, {
              scale: item.scale, alpha: 1, squircle: 1, gloss: 0, shade: 0, focused: 0,
              accent: [1, 0.48, 0.3], dirX: 0, dirY: 0, cx: 120, cy: 120, bezelR: 118,
              qx, qy, qw, qh,
            });
          });
          syncTileGeometry(c, item.tile, {
            screenX: item.x, screenY: item.y, fisheyeScale: item.scale, totalScale: item.scale, visible: true,
          }, tw, th, unit, 240, 240);
        }
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        const rect = c.getBoundingClientRect();
        const atCentre1 = document.elementsFromPoint(rect.left + 120, rect.top + 120);
        const atRim1 = document.elementsFromPoint(rect.left + 196, rect.top + 120);
        if (!atCentre1.includes(tileA.btn)) throw new Error('active centre button A was not hit-tested');
        if (!tileB.el.inert || atRim1.includes(tileB.btn) || atRim1.includes(tileB.el)) {
          throw new Error(`inert rim tile B appeared in hit test: ${atRim1.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }
        document.elementFromPoint(rect.left + 120, rect.top + 120)?.click();
        document.elementFromPoint(rect.left + 196, rect.top + 120)?.click();
        if (clicksA !== 1 || clicksB !== 0) throw new Error(`unexpected clicks before pan: A=${clicksA}, B=${clicksB}`);

        // Pan so B enters the centre (scale 1.0, active) and A shrinks onto the rim (scale 0.22, inert).
        layout = [
          { tile: tileA, x: 44, y: 120, scale: 0.22 },
          { tile: tileB, x: 120, y: 120, scale: 1.0 },
        ];
        await nextPaint(c);
        await nextPaint(c);
        const atCentre2 = document.elementsFromPoint(rect.left + 120, rect.top + 120);
        const atRim2 = document.elementsFromPoint(rect.left + 44, rect.top + 120);
        if (!atCentre2.includes(tileB.btn) || tileB.el.inert) throw new Error('promoted tile B did not become clickable at centre');
        if (!tileA.el.inert || atRim2.includes(tileA.btn) || atRim2.includes(tileA.el)) {
          throw new Error('demoted rim tile A stayed hit-testable');
        }
        document.elementFromPoint(rect.left + 120, rect.top + 120)?.click();
        document.elementFromPoint(rect.left + 44, rect.top + 120)?.click();
        if (clicksA !== 1 || clicksB !== 1) throw new Error(`unexpected clicks after pan: A=${clicksA}, B=${clicksB}`);

        return `A active/B inert -> clicks (${clicksA}, ${clicksB}); swapped B active/A inert -> clicks (${clicksA}, ${clicksB})`;
      } finally {
        fx.dispose();
      }
    },
  },
];

if (tbody) runTests(tbody, checks);
