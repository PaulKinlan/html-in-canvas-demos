import {
  banner,
  inkFraction,
  isBench,
  nextPaint,
  runTests,
  stillDrawn,
  supported as api2dSupported,
  testStage,
} from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const VEL_SCALE_PX_S = 720;
export const REST_SPEED_NORM = 0.01;
export const REST_SPEED_PX_S = VEL_SCALE_PX_S * REST_SPEED_NORM;
const STAGE_MARGIN_PX = 12;
const FLING_IMPULSES = [
  { vx: 1440, vy: -1060 },
  { vx: -1380, vy: -1120 },
  { vx: 1360, vy: 1080 },
  { vx: -1480, vy: 960 },
];

const THEME_META = {
  ember: { label: 'EMBER' },
  cobalt: { label: 'COBALT' },
  mint: { label: 'MINT' },
  plum: { label: 'PLUM' },
};

const routeParam = new URLSearchParams(location.search).get('route');

// DOM references
const stageEl = document.getElementById('ms-stage');
const viewportEl = document.getElementById('ms-viewport');
const canvas = document.getElementById('ms-canvas');
const cardEl = document.getElementById('ms-card');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('ms-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests');

// Toolbar controls
const btnFling = document.getElementById('btn-fling');
const btnOrbit = document.getElementById('btn-orbit');
const btnReset = document.getElementById('btn-reset');
const ctlStrength = document.getElementById('ctl-strength');
const outStrength = document.getElementById('out-strength');
const btnCompare = document.getElementById('btn-compare');
const ctlReduced = document.getElementById('ctl-reduced');

// Live card controls
const titleInput = document.getElementById('ms-title-input');
const pingBtn = document.getElementById('ms-ping-btn');
const pingBadge = document.getElementById('ms-ping-badge');
const themeBadge = document.getElementById('ms-theme-badge');
const cardNote = document.getElementById('ms-card-note');
const paletteBtns = Array.from(document.querySelectorAll('#ms-card button[data-theme]'));

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;
if (reducedQuery?.matches) ctlReduced.checked = true;

// #region smear-math
/**
 * Area-preserving squash and stretch along instantaneous velocity (vx, vy).
 * Stretch * squash === 1.0 when moving; returns exact 1:1 identity at rest or in compare mode.
 */
export function computeSquashStretch(vxPxS, vyPxS, compare = false) {
  const spdPx = Math.hypot(vxPxS, vyPxS);
  const speed = spdPx / VEL_SCALE_PX_S;
  if (compare || speed < REST_SPEED_NORM) {
    return { speed, stretch: 1, squash: 1, dirX: 1, dirY: 0 };
  }
  const dirX = vxPxS / spdPx;
  const dirY = vyPxS / spdPx;
  const stretch = 1 + 0.24 * Math.min(speed, 2.2);
  const squash = 1 / stretch;
  return { speed, stretch, squash, dirX, dirY };
}

function getBounds(s) {
  const margin = s.margin ?? STAGE_MARGIN_PX;
  const cw = Math.max(1, s.cw || 360);
  const ch = Math.max(1, s.ch || 360);
  const cardW = Math.max(1, s.cardW || 228);
  const cardH = Math.max(1, s.cardH || 188);
  const minX = Math.min(margin, Math.max(0, (cw - cardW) * 0.5));
  const maxX = Math.max(minX, cw - cardW - minX);
  const minY = Math.min(margin, Math.max(0, (ch - cardH) * 0.5));
  const maxY = Math.max(minY, ch - cardH - minY);
  return {
    cw,
    ch,
    cardW,
    cardH,
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function bounceWithinBounds(s, b, restitution = 0.76) {
  let bounced = false;
  if (b.maxX <= b.minX) {
    s.x = b.minX;
    s.vx = 0;
  } else if (s.x < b.minX) {
    s.x = Math.min(b.maxX, b.minX + (b.minX - s.x) * 0.22);
    if (s.vx < 0) {
      s.vx = -s.vx * restitution;
      bounced = true;
    }
  } else if (s.x > b.maxX) {
    s.x = Math.max(b.minX, b.maxX - (s.x - b.maxX) * 0.22);
    if (s.vx > 0) {
      s.vx = -s.vx * restitution;
      bounced = true;
    }
  }

  if (b.maxY <= b.minY) {
    s.y = b.minY;
    s.vy = 0;
  } else if (s.y < b.minY) {
    s.y = Math.min(b.maxY, b.minY + (b.minY - s.y) * 0.22);
    if (s.vy < 0) {
      s.vy = -s.vy * restitution;
      bounced = true;
    }
  } else if (s.y > b.maxY) {
    s.y = Math.max(b.minY, b.maxY - (s.y - b.maxY) * 0.22);
    if (s.vy > 0) {
      s.vy = -s.vy * restitution;
      bounced = true;
    }
  }
  return bounced;
}

/**
 * Deterministic 2D card physics stepped to explicit timestamp `tMs`.
 * Supports coasting momentum with soft wall bounces, spring-damper settle to target,
 * and figure-8 Lissajous orbit coupled through a spring-damper.
 */
export function stepCardMotion(s, tMs, reducedMotion = false) {
  const b = getBounds(s);
  if (s.lastTMs == null) s.lastTMs = tMs;
  const rawDt = Math.max(0, (tMs - s.lastTMs) / 1000);
  if (tMs > s.lastTMs) s.lastTMs = tMs;

  if (reducedMotion) {
    if (s.mode === 'spring') {
      s.x = clamp(s.targetX ?? b.centerX, b.minX, b.maxX);
      s.y = clamp(s.targetY ?? b.centerY, b.minY, b.maxY);
    } else {
      s.x = clamp(s.x, b.minX, b.maxX);
      s.y = clamp(s.y, b.minY, b.maxY);
    }
    s.x = Math.round(s.x);
    s.y = Math.round(s.y);
    s.vx = 0;
    s.vy = 0;
    if (s.mode !== 'drag') s.mode = 'idle';
    return { x: s.x, y: s.y, vx: 0, vy: 0, speed: 0, bounced: false, settled: true };
  }

  if (s.mode === 'idle' || s.mode === 'drag') {
    const spd = Math.hypot(s.vx, s.vy);
    return {
      x: s.x,
      y: s.y,
      vx: s.vx,
      vy: s.vy,
      speed: spd / VEL_SCALE_PX_S,
      bounced: false,
      settled: s.mode === 'idle' && spd < REST_SPEED_PX_S,
    };
  }

  let rem = Math.min(rawDt, 5.0);
  let anyBounce = false;
  const subStep = 1 / 120;

  while (rem > 1e-6) {
    const h = Math.min(rem, subStep);
    rem -= h;

    if (s.mode === 'orbit') {
      s.orbitClockMs = (s.orbitClockMs || 0) + h * 1000;
      const tSec = s.orbitClockMs / 1000;
      const w = 3.5;
      const rx = Math.max(20, (b.maxX - b.minX) * 0.45);
      const ry = Math.max(20, (b.maxY - b.minY) * 0.45);
      const tx = b.centerX + rx * Math.sin(w * tSec);
      const ty = b.centerY + ry * Math.sin(2 * w * tSec) * 0.94;
      const k = 185;
      const c = 17;
      const ax = k * (tx - s.x) - c * s.vx;
      const ay = k * (ty - s.y) - c * s.vy;
      s.vx += ax * h;
      s.vy += ay * h;
      s.x += s.vx * h;
      s.y += s.vy * h;
      if (bounceWithinBounds(s, b, 0.72)) anyBounce = true;
    } else if (s.mode === 'spring') {
      const tx = clamp(s.targetX ?? b.centerX, b.minX, b.maxX);
      const ty = clamp(s.targetY ?? b.centerY, b.minY, b.maxY);
      const k = 165;
      const c = 18;
      const ax = k * (tx - s.x) - c * s.vx;
      const ay = k * (ty - s.y) - c * s.vy;
      s.vx += ax * h;
      s.vy += ay * h;
      s.x += s.vx * h;
      s.y += s.vy * h;
      if (bounceWithinBounds(s, b, 0.74)) anyBounce = true;
      const dist = Math.hypot(tx - s.x, ty - s.y);
      const spd = Math.hypot(s.vx, s.vy);
      if (dist < 0.35 && spd < REST_SPEED_PX_S) {
        s.x = Math.round(tx);
        s.y = Math.round(ty);
        s.vx = 0;
        s.vy = 0;
        s.mode = 'idle';
        break;
      }
    } else if (s.mode === 'coast') {
      const damp = Math.exp(-3.0 * h);
      s.vx *= damp;
      s.vy *= damp;
      s.x += s.vx * h;
      s.y += s.vy * h;
      if (bounceWithinBounds(s, b, 0.76)) anyBounce = true;
      const spd = Math.hypot(s.vx, s.vy);
      if (spd < REST_SPEED_PX_S) {
        s.x = Math.round(clamp(s.x, b.minX, b.maxX));
        s.y = Math.round(clamp(s.y, b.minY, b.maxY));
        s.vx = 0;
        s.vy = 0;
        s.mode = 'idle';
        break;
      }
    }
  }

  const speed = Math.hypot(s.vx, s.vy) / VEL_SCALE_PX_S;
  return {
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    speed,
    bounced: anyBounce,
    settled: s.mode === 'idle',
  };
}

const unitCache = new WeakMap();

function cachedGeometryUnit(targetCanvas, refEl, cssWidth) {
  const zoom = refEl.currentCSSZoom || 1;
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${Math.round(cssWidth)}/${zoom}`;
  const prev = unitCache.get(targetCanvas);
  if (prev && prev.key === key) return prev.unit;
  const unit = geometryUnit(targetCanvas, refEl, cssWidth);
  unitCache.set(targetCanvas, { key, unit, lastGeoKey: '' });
  return unit;
}

/**
 * Build the DOMMatrix placing `el` at CSS `(x, y)` with optional area-preserving squash-stretch
 * around the card centre, scaled by `geometryUnit()`.
 */
export function buildCardHitMatrix(x, y, cardW, cardH, vxPxS, vyPxS, unit, compare = false) {
  const { stretch, squash, dirX, dirY } = computeSquashStretch(vxPxS, vyPxS, compare);
  if (stretch === 1 && squash === 1) {
    return new DOMMatrix().translate(x * unit, y * unit).scale(unit, unit, 1);
  }
  const cx = x + cardW * 0.5;
  const cy = y + cardH * 0.5;
  const deg = (Math.atan2(dirY, dirX) * 180) / Math.PI;
  return new DOMMatrix()
    .scale(unit, unit, 1)
    .translate(cx, cy)
    .rotate(deg)
    .scale(stretch, squash, 1)
    .rotate(-deg)
    .translate(-cardW * 0.5, -cardH * 0.5);
}

export function syncCardGeometry(targetCanvas, el, s, force = false) {
  if (typeof targetCanvas.updateElementGeometry !== 'function') return;
  const cardW = Math.max(1, el.offsetWidth || s.cardW || 228);
  const unit = cachedGeometryUnit(targetCanvas, el, cardW);
  const entry = unitCache.get(targetCanvas);
  const compare = Boolean(s.compare);
  const { stretch } = computeSquashStretch(s.vx, s.vy, compare);
  const geoKey = `${s.x.toFixed(2)},${s.y.toFixed(2)},${s.vx.toFixed(1)},${s.vy.toFixed(1)},${stretch.toFixed(3)},${compare ? 1 : 0},${unit.toFixed(4)}`;
  if (!force && entry && entry.lastGeoKey === geoKey) return;
  if (entry) entry.lastGeoKey = geoKey;

  const mat = buildCardHitMatrix(s.x, s.y, cardW, Math.max(1, el.offsetHeight || s.cardH || 188), s.vx, s.vy, unit, compare);
  targetCanvas.updateElementGeometry(el, { canvasTransform: mat });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion smear-math

// #region smear-shader
export const SMEAR_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;      // Card layout size in CSS px (from ElementGL)
uniform vec2 uQuadSize;  // Padded quad size in CSS px
uniform vec2 uVel;       // Normalized instantaneous velocity (vx, vy)
uniform float uStrength; // Smear strength multiplier (0.0 .. 2.0)
uniform float uCompare;  // 1.0 disables squash-stretch and smear for 1:1 comparison

in vec2 vUv;
out vec4 outColor;

vec4 sampleCard(vec2 uv, float feather) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4(0.0);
  }
  vec4 texel = texture(uTex, uv);
  if (feather <= 0.0) return texel;
  vec2 edgePx = min(uv, 1.0 - uv) * uSize;
  float mask = smoothstep(0.0, feather, min(edgePx.x, edgePx.y));
  return texel * mask;
}

void main() {
  vec2 safeSize = max(uSize, vec2(1.0));
  vec2 posPx = (vUv - 0.5) * uQuadSize;
  float speed = length(uVel);

  // Snap to zero blur and exact 1:1 crispness at rest (speed < 0.01) or compare mode.
  if (speed < 0.01 || uCompare > 0.5) {
    vec2 restUv = posPx / safeSize + 0.5;
    outColor = sampleCard(restUv, 0.0);
    return;
  }

  vec2 dir = uVel / speed;
  vec2 perp = vec2(-dir.y, dir.x);

  // 1. Area-preserving squash and stretch along instantaneous (vx, vy):
  //    stretch * squash == 1.0 keeps the card's area constant while elongating along velocity.
  float k = 0.24;
  float stretch = 1.0 + k * min(speed, 2.2);
  float squash = 1.0 / stretch;

  float smearPx = clamp(speed * 38.0 * uStrength, 0.0, 115.0);
  float fringePx = clamp(speed * 5.2 * uStrength, 0.0, 20.0);

  if (smearPx < 0.25) {
    float along = dot(posPx, dir);
    float across = dot(posPx, perp);
    vec2 warpedPx = dir * (along / stretch) + perp * (across / squash);
    vec2 cardUv = warpedPx / safeSize + 0.5;
    outColor = sampleCard(cardUv, 0.8);
    return;
  }

  // 2. 16-tap directional velocity smear + leading/trailing chromatic RGB trail.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;

  vec3 accRgb = vec3(0.0);
  float accA = 0.0;
  float wSum = 0.0;

  for (int i = 0; i < 16; i++) {
    float t = (float(i) + 0.5 + ign * 0.85) / 16.0;
    float d = mix(-0.12, 0.88, t) * smearPx;
    float w = exp(-2.35 * t);

    vec2 basePx = posPx + dir * d;
    vec2 pxR = basePx - dir * fringePx; // Leading warm red fringe
    vec2 pxG = basePx;
    vec2 pxB = basePx + dir * fringePx; // Trailing cool blue wake

    vec2 uvR = (dir * (dot(pxR, dir) / stretch) + perp * (dot(pxR, perp) / squash)) / safeSize + 0.5;
    vec2 uvG = (dir * (dot(pxG, dir) / stretch) + perp * (dot(pxG, perp) / squash)) / safeSize + 0.5;
    vec2 uvB = (dir * (dot(pxB, dir) / stretch) + perp * (dot(pxB, perp) / squash)) / safeSize + 0.5;

    vec4 sR = sampleCard(uvR, 0.8);
    vec4 sG = sampleCard(uvG, 0.8);
    vec4 sB = sampleCard(uvB, 0.8);

    float tapA = max(sR.a, max(sG.a, sB.a));
    accRgb += vec3(sR.r, sG.g, sB.b) * w;
    accA += tapA * w;
    wSum += w;
  }

  vec3 rgb = accRgb / max(wSum, 0.001);
  float alpha = clamp(accA / max(wSum, 0.001), 0.0, 1.0);
  rgb = min(rgb * (1.0 + 0.08 * clamp(speed * uStrength, 0.0, 1.5)), vec3(alpha));
  outColor = vec4(rgb, alpha);
}`;
// #endregion smear-shader

// ---------------- State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  cw: 360,
  ch: 368,
  cardW: 232,
  cardH: 186,
  margin: STAGE_MARGIN_PX,
  x: 64,
  y: 90,
  vx: 0,
  vy: 0,
  targetX: 64,
  targetY: 90,
  mode: 'idle', // 'idle' | 'drag' | 'coast' | 'spring' | 'orbit'
  orbit: false,
  orbitClockMs: 0,
  lastTMs: null,
  strength: Number(ctlStrength.value),
  compare: false,
  theme: 'ember',
  pings: 0,
  flingIndex: 0,
  drag: null,
  suppressClick: false,
  onScreen: true,
  hasPainted: false,
  dirtyCard: true,
  texUploaded: false,
  uploads: 0,
  paints: 0,
  needsDraw: true,
  needsGeoSync: true,
};

let stage = null;
let ctx2d = null;
let rafId = 0;

function elGlAvailable() {
  return glSupported && api2dSupported;
}

function isReducedMotion() {
  return Boolean(ctlReduced.checked || reducedQuery?.matches);
}

function measureAndLayout() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 358);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 368);
  const cardW = state.backend === 'plain'
    ? Math.min(320, cw)
    : cw < 460
      ? Math.min(234, Math.max(196, Math.round(cw * 0.65)))
      : Math.min(272, Math.round(cw * 0.44));

  if (state.backend !== 'plain') {
    const wStr = `${cardW}px`;
    if (cardEl.style.width !== wStr) cardEl.style.width = wStr;
  } else if (cardEl.style.width) {
    cardEl.style.width = '';
  }

  const cardH = Math.max(120, Math.round(cardEl.offsetHeight || 186));
  const wasUnplaced = state.uploads === 0 && state.mode === 'idle' && state.vx === 0 && state.vy === 0;
  state.cw = cw;
  state.ch = ch;
  state.cardW = cardW;
  state.cardH = cardH;
  const b = getBounds(state);
  state.targetX = b.centerX;
  state.targetY = b.centerY;

  if (wasUnplaced) {
    state.x = Math.round(b.centerX);
    state.y = Math.round(b.centerY);
  } else {
    state.x = clamp(state.x, b.minX, b.maxX);
    state.y = clamp(state.y, b.minY, b.maxY);
  }
}

function syncControlsUI() {
  outStrength.textContent = `${state.strength.toFixed(2)}x`;
  btnOrbit.setAttribute('aria-pressed', String(state.orbit));
  btnCompare.setAttribute('aria-pressed', String(state.compare));

  const { speed, stretch, squash } = computeSquashStretch(state.vx, state.vy, state.compare);
  const routeLabel = state.backend === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.backend === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const stateLabel = state.compare && speed >= REST_SPEED_NORM
    ? '1:1 crisp compare'
    : speed < REST_SPEED_NORM
      ? '1:1 rest'
      : state.orbit
        ? 'Figure-8 orbit'
        : state.mode === 'drag'
          ? 'Dragging'
          : state.mode === 'spring'
            ? 'Springing home'
            : 'Flinging';
  const spdPx = Math.round(Math.hypot(state.vx, state.vy));
  hudEl.textContent = `${routeLabel} · ${stateLabel} · ${spdPx} px/s · ${stretch.toFixed(2)}x/${squash.toFixed(2)}x · uploads ${state.uploads}`;
}

// #region paint-upload
function uploadCard() {
  if (!stage || stage.lost || !state.hasPainted) return false;
  try {
    const tex = stage.upload(cardEl);
    if (!tex) return false;
    const gl = stage.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    state.uploads++;
    state.texUploaded = true;
    return true;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return false;
    }
    throw err;
  }
}

function renderWebGL() {
  if (!state.hasPainted || !stage || stage.lost) return;
  if (!stage.begin([0, 0, 0, 0])) return;

  if (state.dirtyCard || !stage.has(cardEl)) {
    if (uploadCard()) state.dirtyCard = false;
  }
  if (!stage.has(cardEl)) return;

  const cardW = Math.max(1, cardEl.offsetWidth || state.cardW);
  const cardH = Math.max(1, cardEl.offsetHeight || state.cardH);
  state.cardW = cardW;
  state.cardH = cardH;

  const velX = state.vx / VEL_SCALE_PX_S;
  const velY = state.vy / VEL_SCALE_PX_S;
  const speed = Math.hypot(velX, velY);
  const isAtRest = speed < REST_SPEED_NORM || state.compare;
  const pad = isAtRest
    ? 0
    : Math.ceil(Math.max(cardW, cardH) * 0.35 + Math.min(135, speed * 42 * state.strength + 20));
  const qx = isAtRest ? Math.round(state.x) : state.x - pad;
  const qy = isAtRest ? Math.round(state.y) : state.y - pad;
  const qw = cardW + pad * 2;
  const qh = cardH + pad * 2;

  stage.quad(cardEl, ElementGL.rect(canvas, qx, qy, qw, qh), (gl, u) => {
    gl.uniform2f(u('uQuadSize'), qw, qh);
    gl.uniform2f(u('uVel'), velX, velY);
    gl.uniform1f(u('uStrength'), state.strength);
    gl.uniform1f(u('uCompare'), state.compare ? 1.0 : 0.0);
  });

  if (state.needsGeoSync || !isAtRest) {
    syncCardGeometry(canvas, cardEl, state, state.needsGeoSync);
    state.needsGeoSync = false;
  }
  syncControlsUI();
}

function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 358);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 368);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const cardW = Math.max(1, cardEl.offsetWidth || state.cardW);
  const cardH = Math.max(1, cardEl.offsetHeight || state.cardH);
  state.cardW = cardW;
  state.cardH = cardH;

  const { speed, stretch, squash, dirX, dirY } = computeSquashStretch(state.vx, state.vy, state.compare);
  const isAtRest = speed < REST_SPEED_NORM || state.compare;
  const smearPx = isAtRest ? 0 : Math.min(90, speed * 34 * state.strength);
  const angle = Math.atan2(dirY, dirX);

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);

  if (smearPx > 1) {
    const echoes = 4;
    for (let i = echoes; i >= 1; i--) {
      const f = (i / echoes) * smearPx;
      const cx = state.x - dirX * f + cardW * 0.5;
      const cy = state.y - dirY * f + cardH * 0.5;
      ctx2d.save();
      ctx2d.globalAlpha = 0.14 + (1 - i / echoes) * 0.22;
      ctx2d.translate(cx, cy);
      ctx2d.rotate(angle);
      ctx2d.scale(stretch, squash);
      ctx2d.rotate(-angle);
      try { ctx2d.drawElementImage(cardEl, -cardW * 0.5, -cardH * 0.5, cardW, cardH); } catch {}
      ctx2d.restore();
    }
  }

  // Draw the live interactive card last so its hit box tracks the leading copy.
  const drawX = isAtRest ? Math.round(state.x) : state.x;
  const drawY = isAtRest ? Math.round(state.y) : state.y;
  ctx2d.save();
  ctx2d.globalAlpha = 1;
  if (isAtRest) {
    try { ctx2d.drawElementImage(cardEl, drawX, drawY, cardW, cardH); } catch {}
  } else {
    ctx2d.translate(drawX + cardW * 0.5, drawY + cardH * 0.5);
    ctx2d.rotate(angle);
    ctx2d.scale(stretch, squash);
    ctx2d.rotate(-angle);
    try { ctx2d.drawElementImage(cardEl, -cardW * 0.5, -cardH * 0.5, cardW, cardH); } catch {}
  }
  ctx2d.restore();
  ctx2d.restore();

  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
  state.texUploaded = true;
  state.needsGeoSync = false;
  syncControlsUI();
}

export function attachContextLossController({ targetCanvas, targetViewport, targetElement, targetPlainHost, onPlain, onRestore }) {
  const onLost = (e) => {
    e.preventDefault();
    targetElement.inert = false;
    targetElement.style.pointerEvents = 'auto';
    if (targetElement.parentElement !== targetPlainHost) targetPlainHost.append(targetElement);
    targetPlainHost.hidden = false;
    if (targetViewport) targetViewport.hidden = true;
    onPlain?.('Canvas context lost; showing the live studio card as plain HTML until restored.');
  };
  const onRestored = () => {
    if (targetElement.parentElement !== targetCanvas) targetCanvas.append(targetElement);
    targetPlainHost.hidden = true;
    if (targetViewport) targetViewport.hidden = false;
    onRestore?.();
  };
  targetCanvas.addEventListener('webglcontextlost', onLost);
  targetCanvas.addEventListener('contextlost', onLost);
  targetCanvas.addEventListener('webglcontextrestored', onRestored);
  targetCanvas.addEventListener('contextrestored', onRestored);
}

function enterPlainFallback(reason) {
  state.backend = 'plain';
  state.orbit = false;
  state.mode = 'idle';
  state.vx = 0;
  state.vy = 0;
  stageEl.classList.add('is-plain');
  cardEl.inert = false;
  cardEl.style.pointerEvents = 'auto';
  cardEl.style.width = '';
  if (cardEl.parentElement !== plainHost) plainHost.append(cardEl);
  plainHost.hidden = false;
  viewportEl.hidden = true;
  routeNoteEl.textContent = reason;
  syncControlsUI();
}

function exitPlainFallback() {
  stageEl.classList.remove('is-plain');
  if (cardEl.parentElement !== canvas) canvas.append(cardEl);
  plainHost.hidden = true;
  viewportEl.hidden = false;
}
// #endregion paint-upload

// ---------------- Animation Loop ----------------

function requestDraw() {
  state.needsDraw = true;
  if (state.backend === 'plain') {
    syncControlsUI();
    return;
  }
  if (!rafId && state.onScreen && !document.hidden) {
    rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  const reduced = isReducedMotion();
  if (state.mode === 'drag' && state.drag) {
    // Decay held drag velocity cleanly when the pointer stops moving.
    if (now - state.drag.lastT > 42) {
      state.vx *= 0.72;
      state.vy *= 0.72;
      if (Math.hypot(state.vx, state.vy) < REST_SPEED_PX_S) {
        state.vx = 0;
        state.vy = 0;
      }
      state.needsDraw = true;
    }
  } else if (state.mode === 'coast' || state.mode === 'spring' || state.mode === 'orbit') {
    if (state.lastTMs == null || now < state.lastTMs) {
      state.lastTMs = now - 16;
    } else if (now - state.lastTMs > 80) {
      state.lastTMs = now - 80;
    }
    const stepped = stepCardMotion(state, now, reduced);
    state.needsDraw = true;
    if (stepped.settled) {
      state.orbit = false;
      state.needsGeoSync = true;
    }
  }

  if (state.needsDraw) {
    if (state.hasPainted) {
      state.needsDraw = false;
      if (state.backend === 'webgl') renderWebGL();
      else if (state.backend === '2d') render2DFallback();
    } else {
      canvas.requestPaint?.();
      syncControlsUI();
    }
  }

  const activeLoop = state.mode === 'coast' || state.mode === 'spring' || state.mode === 'orbit' || (state.mode === 'drag' && Math.hypot(state.vx, state.vy) >= REST_SPEED_PX_S);
  if (activeLoop) {
    rafId = requestAnimationFrame(tick);
  }
}

// ---------------- Backend Setup ----------------

function initBackend() {
  attachContextLossController({
    targetCanvas: canvas,
    targetViewport: viewportEl,
    targetElement: cardEl,
    targetPlainHost: plainHost,
    onPlain: (msg) => {
      state.backend = 'plain';
      state.texUploaded = false;
      state.hasPainted = false;
      state.orbit = false;
      state.mode = 'idle';
      state.vx = 0;
      state.vy = 0;
      stageEl.classList.add('is-plain');
      cardEl.style.width = '';
      routeNoteEl.textContent = msg;
      syncControlsUI();
    },
    onRestore: () => {
      exitPlainFallback();
      if (stage && !stage.lost) {
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.backend = 'webgl';
        state.hasPainted = false;
        state.dirtyCard = true;
        unitCache.delete(canvas);
        measureAndLayout();
        state.needsGeoSync = true;
        routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL canvas.';
        canvas.requestPaint?.();
        requestDraw();
      } else if (ctx2d) {
        state.backend = '2d';
        state.hasPainted = false;
        unitCache.delete(canvas);
        measureAndLayout();
        state.needsGeoSync = true;
        routeNoteEl.textContent = '2D canvas context restored.';
        canvas.requestPaint?.();
        requestDraw();
      }
    },
  });

  if (routeParam === 'plain') {
    enterPlainFallback('Plain HTML fallback selected via ?route=plain.');
    return;
  }

  if (routeParam !== '2d' && elGlAvailable()) {
    try {
      stage = new ElementGL(canvas, {
        fragment: SMEAR_FRAG,
        attributes: {
          alpha: true,
          premultipliedAlpha: true,
          depth: false,
          antialias: false,
          preserveDrawingBuffer: true,
          powerPreference: 'low-power',
        },
        onLost: () => {
          state.texUploaded = false;
          state.hasPainted = false;
          state.dirtyCard = true;
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.hasPainted = false;
          state.dirtyCard = true;
          unitCache.delete(canvas);
          measureAndLayout();
          state.needsGeoSync = true;
          canvas.requestPaint?.();
          requestDraw();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.backend = 'webgl';
      routeNoteEl.textContent = 'Running on WebGL 2 via one ElementGL context with area-preserving squash-stretch and 16-tap velocity smear.';
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back.`;
    }
  }

  if (state.backend === 'none' && api2dSupported) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 358);
      const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 368);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      routeNoteEl.textContent = routeParam === '2d'
        ? '2D 5-argument drawElementImage() fallback selected via ?route=2d.'
        : 'WebGL 2 texElementSubImage2D() is unavailable here; running the 2D 5-argument drawElementImage() fallback.';
    }
  }

  if (state.backend === 'none') {
    enterPlainFallback('HTML-in-canvas is unavailable here, so the studio card is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', (e) => {
    state.hasPainted = true;
    state.paints++;
    const changed = e?.changedElements;
    if (!changed || !changed.length || changed.some((el) => el === cardEl || cardEl.contains(el))) {
      state.dirtyCard = true;
    }
    if (state.backend === 'webgl') renderWebGL();
    else if (state.backend === '2d') render2DFallback();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      unitCache.delete(canvas);
      measureAndLayout();
      state.needsGeoSync = true;
      requestDraw();
    }).observe(viewportEl);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      state.onScreen = visible;
      if (!visible) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        requestDraw();
      }
    }, { rootMargin: '120px' }).observe(viewportEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    } else if (state.onScreen) {
      state.lastTMs = performance.now() - 16;
      requestDraw();
    }
  });

  measureAndLayout();
  state.needsGeoSync = true;
  if (state.backend === 'webgl') syncCardGeometry(canvas, cardEl, state, true);
  syncControlsUI();
  canvas.requestPaint?.();
  requestDraw();
}

// ---------------- Interactive Controls & Gestures ----------------

btnFling.addEventListener('click', () => {
  state.orbit = false;
  if (state.backend === 'plain') {
    syncControlsUI();
    return;
  }
  measureAndLayout();
  const b = getBounds(state);
  if (isReducedMotion()) {
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    const next = corners[state.flingIndex % corners.length];
    state.flingIndex++;
    state.mode = 'idle';
    state.x = Math.round(next.x);
    state.y = Math.round(next.y);
    state.vx = 0;
    state.vy = 0;
    state.needsGeoSync = true;
    routeNoteEl.textContent = 'Reduced motion is on: Fling card stepped cleanly with zero smear.';
    requestDraw();
    return;
  }
  const imp = FLING_IMPULSES[state.flingIndex % FLING_IMPULSES.length];
  state.flingIndex++;
  state.mode = 'coast';
  state.vx = imp.vx;
  state.vy = imp.vy;
  state.lastTMs = null;
  syncControlsUI();
  requestDraw();
});

btnOrbit.addEventListener('click', () => {
  if (state.backend === 'plain') {
    state.orbit = false;
    syncControlsUI();
    return;
  }
  if (isReducedMotion()) {
    state.orbit = false;
    state.mode = 'idle';
    state.vx = 0;
    state.vy = 0;
    syncControlsUI();
    routeNoteEl.textContent = 'Figure-8 orbit stays paused while Reduced motion is on. Drag or tap Reset centre.';
    requestDraw();
    return;
  }
  state.orbit = !state.orbit;
  if (state.orbit) {
    measureAndLayout();
    state.mode = 'orbit';
    state.lastTMs = null;
  } else {
    state.mode = Math.hypot(state.vx, state.vy) >= REST_SPEED_PX_S ? 'coast' : 'idle';
    state.lastTMs = null;
  }
  syncControlsUI();
  requestDraw();
});

btnReset.addEventListener('click', () => {
  state.orbit = false;
  measureAndLayout();
  const b = getBounds(state);
  state.targetX = b.centerX;
  state.targetY = b.centerY;
  if (state.backend === 'plain' || isReducedMotion()) {
    state.mode = 'idle';
    state.x = Math.round(b.centerX);
    state.y = Math.round(b.centerY);
    state.vx = 0;
    state.vy = 0;
    state.needsGeoSync = true;
    requestDraw();
    return;
  }
  state.mode = 'spring';
  state.lastTMs = null;
  syncControlsUI();
  requestDraw();
});

ctlStrength.addEventListener('input', () => {
  state.strength = clamp(Number(ctlStrength.value), 0, 2.0);
  syncControlsUI();
  requestDraw();
});

btnCompare.addEventListener('click', () => {
  state.compare = !state.compare;
  state.needsGeoSync = true;
  syncControlsUI();
  requestDraw();
});

function handleReducedChange() {
  if (isReducedMotion()) {
    state.orbit = false;
    state.mode = 'idle';
    state.vx = 0;
    state.vy = 0;
    const b = getBounds(state);
    state.x = Math.round(clamp(state.x, b.minX, b.maxX));
    state.y = Math.round(clamp(state.y, b.minY, b.maxY));
    state.needsGeoSync = true;
  }
  syncControlsUI();
  requestDraw();
}

if (reducedQuery) {
  reducedQuery.addEventListener('change', () => {
    ctlReduced.checked = reducedQuery.matches;
    handleReducedChange();
  });
}
ctlReduced.addEventListener('change', handleReducedChange);

// Live card controls
for (const btn of paletteBtns) {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme || 'ember';
    state.theme = theme;
    cardEl.dataset.theme = theme;
    for (const other of paletteBtns) {
      other.setAttribute('aria-pressed', String(other === btn));
    }
    themeBadge.textContent = THEME_META[theme]?.label || theme.toUpperCase();
    state.dirtyCard = true;
    canvas.requestPaint?.();
    requestDraw();
  });
}

pingBtn.addEventListener('click', () => {
  state.pings++;
  pingBadge.textContent = `${state.pings} ping${state.pings === 1 ? '' : 's'}`;
  cardNote.textContent = `Pinged #${state.pings} at (${Math.round(state.x)}, ${Math.round(state.y)})`;
  state.dirtyCard = true;
  canvas.requestPaint?.();
  requestDraw();
});

titleInput.addEventListener('input', () => {
  state.dirtyCard = true;
  canvas.requestPaint?.();
  requestDraw();
});

for (const ev of ['focus', 'focusin', 'focusout']) {
  cardEl.addEventListener(ev, () => {
    state.dirtyCard = true;
    canvas.requestPaint?.();
    requestDraw();
  }, { capture: ev === 'focus' });
}

// Guard native browser text selection while dragging across the stage, keeping inputs selectable.
viewportEl.addEventListener('selectstart', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('input, textarea')) {
    e.preventDefault();
  }
});

function isCardControl(target) {
  return target instanceof Element && cardEl.contains(target) && Boolean(target.closest('button, input, label'));
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain') return;
  if (isCardControl(e.target)) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  state.orbit = false;
  state.mode = 'drag';
  state.vx = 0;
  state.vy = 0;
  state.drag = {
    id: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: state.x,
    startY: state.y,
    lastClientX: e.clientX,
    lastClientY: e.clientY,
    lastT: performance.now(),
    moved: false,
  };
  syncControlsUI();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  const dxTotal = e.clientX - d.startClientX;
  const dyTotal = e.clientY - d.startClientY;
  if (!d.moved && Math.hypot(dxTotal, dyTotal) >= 4) {
    d.moved = true;
    if (!document.activeElement?.closest('input')) {
      try { window.getSelection()?.removeAllRanges?.(); } catch {}
    }
  }

  const now = performance.now();
  const dt = Math.max(0.004, (now - d.lastT) / 1000);
  const instVx = (e.clientX - d.lastClientX) / dt;
  const instVy = (e.clientY - d.lastClientY) / dt;
  d.lastClientX = e.clientX;
  d.lastClientY = e.clientY;
  d.lastT = now;

  const b = getBounds(state);
  state.x = clamp(d.startX + dxTotal, b.minX, b.maxX);
  state.y = clamp(d.startY + dyTotal, b.minY, b.maxY);

  if (isReducedMotion()) {
    state.vx = 0;
    state.vy = 0;
  } else {
    state.vx = clamp(state.vx * 0.4 + instVx * 0.6, -2400, 2400);
    state.vy = clamp(state.vy * 0.4 + instVy * 0.6, -2400, 2400);
  }
  state.needsGeoSync = true;
  requestDraw();
});

function endCardDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  state.drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}

  if (d.moved) {
    state.suppressClick = true;
    setTimeout(() => { state.suppressClick = false; }, 0);
  }

  if (isReducedMotion()) {
    state.mode = 'idle';
    state.vx = 0;
    state.vy = 0;
    state.x = Math.round(state.x);
    state.y = Math.round(state.y);
    state.needsGeoSync = true;
    requestDraw();
    return;
  }

  const now = performance.now();
  // If the pointer lingered at rest before lifting, zero tiny residual jitter.
  if (now - d.lastT > 70 || Math.hypot(state.vx, state.vy) < 45) {
    state.vx = 0;
    state.vy = 0;
    state.x = Math.round(state.x);
    state.y = Math.round(state.y);
    state.mode = 'idle';
  } else {
    state.mode = 'coast';
  }
  state.lastTMs = now;
  state.needsGeoSync = true;
  requestDraw();
}

canvas.addEventListener('pointerup', endCardDrag);
canvas.addEventListener('pointercancel', endCardDrag);
viewportEl.addEventListener('click', (e) => {
  if (state.suppressClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

initBackend();

// ---------------- Isolated Live Checks (Tap-Gated) ----------------

function makeFixtureCanvas(w = 240, h = 180) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = `display:block;width:${w}px;height:${h}px;position:relative;overflow:hidden`;
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

function sampleCssPixel(img, cssX, cssY, cw, ch) {
  const sx = img.width / cw;
  const sy = img.height / ch;
  const px = clamp(Math.round(cssX * sx), 0, img.width - 1);
  const py = clamp(Math.round(cssY * sy), 0, img.height - 1);
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

async function waitForRetiredGL() {
  for (let i = 0; i < 16; i++) {
    if ((window.__gfx?.active?.() ?? 0) <= 1) return;
    await new Promise((r) => setTimeout(r, 80));
  }
}

runTests(testsBody, [
  {
    name: 'ElementGL card upload succeeds with premultiplied alpha and gl.getError() === 0',
    why: 'Builds an isolated ElementGL fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), and verifies centre colour and zero GL error.',
    timeout: 6000,
    run: async () => {
      if (!elGlAvailable()) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 220, ch = 180, cardW = 120, cardH = 90;
      const cv = makeFixtureCanvas(cw, ch);
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = `position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#fbf7ee;border:4px solid #d2491f;box-sizing:border-box;`;
      cv.append(fixCard);

      const g = new ElementGL(cv, {
        fragment: SMEAR_FRAG,
        attributes: { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.03, 0.04, 0.08, 1])) throw new Error('ElementGL.begin() returned false');
        const tex = g.upload(fixCard);
        if (!tex) throw new Error('stage.upload() returned null');
        g.quad(fixCard, ElementGL.rect(cv, 50, 45, cardW, cardH), (gl, u) => {
          gl.uniform2f(u('uQuadSize'), cardW, cardH);
          gl.uniform2f(u('uVel'), 0, 0);
          gl.uniform1f(u('uStrength'), 1.0);
          gl.uniform1f(u('uCompare'), 0.0);
        });
        const glErr = g.gl.getError();
        if (glErr !== 0) throw new Error(`gl.getError() returned 0x${glErr.toString(16)}`);
        const img = readPlainCopyImageData(cv);
        const px = sampleCssPixel(img, 110, 90, cw, ch);
        if (px[0] < 230 || px[1] < 225 || px[2] < 215) {
          throw new Error(`expected warm card centre pixel, got rgba(${px.join(',')})`);
        }
        return `card ${tex.w}x${tex.h}, glErr=0, centre rgba(${px.join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Stationary 1:1 sharpness vs high-velocity diagonal squash-stretch, smear and RGB trail',
    why: 'Verifies area-preserving stretch * squash === 1.0, crisp dark background outside rest bounds, diagonal trailing smear with blue wake vs leading red fringe under (+1.2, -0.9) velocity, and 1:1 snap under compare mode.',
    timeout: 6000,
    run: async () => {
      if (!elGlAvailable()) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      await waitForRetiredGL();

      const ss = computeSquashStretch(1080, -810, false);
      if (ss.stretch <= 1.25 || ss.squash >= 0.8 || Math.abs(ss.stretch * ss.squash - 1) > 1e-6) {
        throw new Error(`area-preservation check failed: stretch=${ss.stretch}, squash=${ss.squash}`);
      }

      const cw = 260, ch = 220, cardW = 80, cardH = 80, cardX = 90, cardY = 70;
      const cv = makeFixtureCanvas(cw, ch);
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = `position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#ffffff;`;
      cv.append(fixCard);

      const g = new ElementGL(cv, {
        fragment: SMEAR_FRAG,
        attributes: { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.03, 0.04, 0.08, 1])) throw new Error('ElementGL.begin() returned false');
        g.upload(fixCard);

        const drawFrame = (vxNorm, vyNorm, compareVal) => {
          g.begin([0.03, 0.04, 0.08, 1]);
          const spd = Math.hypot(vxNorm, vyNorm);
          const pad = spd < 0.01 || compareVal > 0.5 ? 0 : 80;
          const qw = cardW + pad * 2;
          const qh = cardH + pad * 2;
          g.quad(fixCard, ElementGL.rect(cv, cardX - pad, cardY - pad, qw, qh), (gl, u) => {
            gl.uniform2f(u('uQuadSize'), qw, qh);
            gl.uniform2f(u('uVel'), vxNorm, vyNorm);
            gl.uniform1f(u('uStrength'), 1.4);
            gl.uniform1f(u('uCompare'), compareVal);
          });
          return readPlainCopyImageData(cv);
        };

        // Rest: card sits cleanly inside [90..170] x [70..150].
        const restImg = drawFrame(0, 0, 0);
        const restTrailPx = sampleCssPixel(restImg, 70, 166, cw, ch);
        const restTrailLum = (restTrailPx[0] + restTrailPx[1] + restTrailPx[2]) / 3;

        // Moving UP-RIGHT (+1.2, -0.9): trailing wake is DOWN-LEFT around (70, 166);
        // leading fringe is UP-RIGHT around (182, 58); perpendicular outside squash is (174, 154).
        const fastImg = drawFrame(1.2, -0.9, 0);
        const trailPx = sampleCssPixel(fastImg, 70, 166, cw, ch);
        const trailLum = (trailPx[0] + trailPx[1] + trailPx[2]) / 3;
        const leadPx = sampleCssPixel(fastImg, 182, 58, cw, ch);
        const perpPx = sampleCssPixel(fastImg, 174, 154, cw, ch);
        const perpLum = (perpPx[0] + perpPx[1] + perpPx[2]) / 3;

        // Compare crisp 1:1 mode at same velocity must snap trail back to backdrop.
        const cmpImg = drawFrame(1.2, -0.9, 1);
        const cmpPx = sampleCssPixel(cmpImg, 70, 166, cw, ch);
        const cmpLum = (cmpPx[0] + cmpPx[1] + cmpPx[2]) / 3;

        if (restTrailLum > 25 || cmpLum > 25) {
          throw new Error(`expected dark rest/compare background outside card (rest=${restTrailLum.toFixed(0)}, cmp=${cmpLum.toFixed(0)})`);
        }
        if (trailLum <= restTrailLum + 25 || trailLum <= perpLum + 18) {
          throw new Error(`expected diagonal trailing streak over perp (trail=${trailLum.toFixed(0)}, perp=${perpLum.toFixed(0)})`);
        }
        if (trailPx[2] <= trailPx[0] + 6 || leadPx[0] <= leadPx[2] + 6) {
          throw new Error(`expected chromatic RGB split (trail rgb=${trailPx.slice(0, 3).join(',')}, lead rgb=${leadPx.slice(0, 3).join(',')})`);
        }
        return `stretch=${ss.stretch.toFixed(2)}x, squash=${ss.squash.toFixed(2)}x; restLum=${restTrailLum.toFixed(0)} vs trailLum=${trailLum.toFixed(0)} (perp=${perpLum.toFixed(0)}); trailRGB(${trailPx.slice(0, 3).join(',')}) leadRGB(${leadPx.slice(0, 3).join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Explicit tMs spring-damper physics bounces off stage bounds and settles to vel = 0',
    why: 'Steps stepCardMotion(state, tMs) deterministically across coast fling bounces, spring reset to centre, and reduced-motion snap.',
    timeout: 4000,
    run: async () => {
      const sim = {
        cw: 360,
        ch: 368,
        cardW: 228,
        cardH: 186,
        margin: 12,
        x: 66,
        y: 91,
        vx: 1440,
        vy: -1060,
        targetX: 66,
        targetY: 91,
        mode: 'coast',
        lastTMs: 1000,
      };
      let peakSpeed = 0;
      let bounces = 0;
      for (let t = 1016; t <= 4800; t += 16) {
        const res = stepCardMotion(sim, t, false);
        if (res.speed > peakSpeed) peakSpeed = res.speed;
        if (res.bounced) bounces++;
        if (res.x < 11 || res.x > 121 || res.y < 11 || res.y > 171) {
          throw new Error(`card escaped bounds: (${res.x.toFixed(1)}, ${res.y.toFixed(1)})`);
        }
        if (res.settled) break;
      }
      if (sim.mode !== 'idle' || sim.vx !== 0 || sim.vy !== 0 || bounces < 1 || peakSpeed < 1.5) {
        throw new Error(`coast failed to bounce and settle (mode=${sim.mode}, v=${sim.vx},${sim.vy}, bounces=${bounces})`);
      }

      // Spring-damper reset back to centre from displaced corner.
      sim.x = 12;
      sim.y = 12;
      sim.vx = 0;
      sim.vy = 0;
      sim.targetX = 66;
      sim.targetY = 91;
      sim.mode = 'spring';
      sim.lastTMs = 5000;
      for (let t = 5016; t <= 9000; t += 16) {
        const res = stepCardMotion(sim, t, false);
        if (res.settled) break;
      }
      if (sim.mode !== 'idle' || sim.x !== 66 || sim.y !== 91 || sim.vx !== 0 || sim.vy !== 0) {
        throw new Error(`spring settle failed (${sim.x}, ${sim.y}) v=(${sim.vx}, ${sim.vy})`);
      }

      // Reduced motion snaps straight to target in one step with zero velocity.
      sim.x = 12;
      sim.y = 160;
      sim.vx = 900;
      sim.vy = -500;
      sim.mode = 'spring';
      sim.lastTMs = 9000;
      const red = stepCardMotion(sim, 9016, true);
      if (!red.settled || red.speed !== 0 || red.x !== 66 || red.y !== 91) {
        throw new Error(`reduced-motion snap failed: (${red.x}, ${red.y}) speed=${red.speed}`);
      }
      return `bounces=${bounces}, peakSpeed=${peakSpeed.toFixed(2)} -> vel=0; spring -> (${sim.x},${sim.y}); reduced snap=0`;
    },
  },
  {
    name: 'Displaced updateElementGeometry() + geometryUnit() routes clicks and input hits accurately',
    why: 'Moves a fixture card inside an ElementGL canvas across two displaced positions and a mid-flight stretched state, confirming elementsFromPoint() and clicks follow the card.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !elGlAvailable()) {
        throw new Error('updateElementGeometry() or ElementGL is not available');
      }
      await waitForRetiredGL();
      const cw = 280, ch = 220, cardW = 140, cardH = 100;
      const cv = makeFixtureCanvas(cw, ch);
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = `position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#fffaf2;border:2px solid #d2491f;box-sizing:border-box;`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'none';
      inp.value = 'RIG';
      inp.setAttribute('aria-label', 'Fixture card label');
      inp.style.cssText = 'position:absolute;left:16px;top:12px;width:108px;height:32px;margin:0;box-sizing:border-box;';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '+1 Ping';
      btn.style.cssText = 'position:absolute;left:16px;top:52px;width:108px;height:36px;margin:0;box-sizing:border-box;';
      let clicks = 0;
      btn.addEventListener('click', () => { clicks++; });

      fixCard.append(inp, btn);
      cv.append(fixCard);

      const g = new ElementGL(cv, {
        fragment: SMEAR_FRAG,
        attributes: { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        g.begin([0.03, 0.04, 0.08, 1]);
        g.upload(fixCard);

        const placeAt = async (x, y, vx = 0, vy = 0) => {
          const pad = vx || vy ? 56 : 0;
          const qw = cardW + pad * 2;
          const qh = cardH + pad * 2;
          g.begin([0.03, 0.04, 0.08, 1]);
          g.quad(fixCard, ElementGL.rect(cv, x - pad, y - pad, qw, qh), (gl, u) => {
            gl.uniform2f(u('uQuadSize'), qw, qh);
            gl.uniform2f(u('uVel'), vx / VEL_SCALE_PX_S, vy / VEL_SCALE_PX_S);
            gl.uniform1f(u('uStrength'), 1.0);
            gl.uniform1f(u('uCompare'), 0.0);
          });
          syncCardGeometry(cv, fixCard, { x, y, vx, vy, cardW, cardH, compare: false }, true);
          await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        };

        const r = cv.getBoundingClientRect();

        await placeAt(16, 14, 0, 0);
        const hits1 = document.elementsFromPoint(r.left + 16 + 70, r.top + 14 + 70);
        if (!hits1.includes(btn)) throw new Error(`pos1 missed btn: ${hits1[0]?.tagName}`);
        btn.click();

        await placeAt(124, 98, 0, 0);
        const oldHits = document.elementsFromPoint(r.left + 16 + 70, r.top + 14 + 70);
        const hits2Btn = document.elementsFromPoint(r.left + 124 + 70, r.top + 98 + 70);
        const hits2Inp = document.elementsFromPoint(r.left + 124 + 70, r.top + 98 + 28);
        if (oldHits.includes(btn)) throw new Error('old hit box stayed active after displacement');
        if (!hits2Btn.includes(btn) || !hits2Inp.includes(inp)) {
          throw new Error(`pos2 missed controls: btn=${hits2Btn[0]?.tagName}, inp=${hits2Inp[0]?.tagName}`);
        }
        btn.click();

        // Mid-flight stretched hit matrix around card centre at (70, 56).
        await placeAt(70, 56, 900, 0);
        const midHits = document.elementsFromPoint(r.left + 70 + 70, r.top + 56 + 70);
        if (!midHits.includes(btn)) throw new Error(`mid-flight stretched hit missed btn: ${midHits[0]?.tagName}`);

        if (clicks !== 2) throw new Error(`expected 2 clicks, got ${clicks}`);
        return `pos1 (16,14) hit; pos2 (124,98) hit + old cleared (${clicks} clicks); mid-flight stretch hit OK`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-arg 2D drawElementImage() fallback recover cleanly',
    why: 'Dispatches cancelable webglcontextlost and webglcontextrestored on an isolated fixture without loseContext(), then renders a squashed-stretched trail in 2D via 5-argument drawElementImage().',
    timeout: 6000,
    run: async () => {
      const box = document.createElement('div');
      box.style.cssText = 'position:relative;width:180px;height:140px;';
      const vp = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.width = 180;
      cv.height = 140;
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.textContent = 'Card';
      const ph = document.createElement('div');
      ph.hidden = true;
      cv.append(fixCard);
      vp.append(cv);
      box.append(vp, ph);
      testStage().append(box);

      let restored = false;
      attachContextLossController({
        targetCanvas: cv,
        targetViewport: vp,
        targetElement: fixCard,
        targetPlainHost: ph,
        onRestore: () => { restored = true; },
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const fellBack = lostEv.defaultPrevented && vp.hidden && !ph.hidden && ph.contains(fixCard) && !fixCard.inert;
      cv.dispatchEvent(new Event('webglcontextrestored'));
      const cameBack = restored && !vp.hidden && ph.hidden && cv.contains(fixCard);
      box.remove();
      window.__gfx?.retire?.(cv);
      if (!fellBack || !cameBack) throw new Error(`context fallback/restore failed (fellBack=${fellBack}, cameBack=${cameBack})`);

      if (!api2dSupported) throw new Error('2D drawElementImage() is not available');
      const cw = 220, ch = 160, cardW = 110, cardH = 80;
      const c2 = makeFixtureCanvas(cw, ch);
      const dCard = document.createElement('div');
      dCard.setAttribute('drawable', '');
      dCard.style.cssText = `position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#fffaf2;border:3px solid #d2491f;box-sizing:border-box;`;
      c2.append(dCard);
      try {
        const ctx = c2.getContext('2d');
        await nextPaint(c2);
        const { stretch, squash } = computeSquashStretch(900, 0, false);
        for (let i = 3; i >= 0; i--) {
          ctx.save();
          ctx.globalAlpha = i === 0 ? 1 : 0.28;
          ctx.translate(120 - i * 16, 80);
          ctx.scale(stretch, squash);
          ctx.drawElementImage(dCard, -cardW * 0.5, -cardH * 0.5, cardW, cardH);
          ctx.restore();
        }
        const img = readPlainCopyImageData(c2);
        const frac = inkFraction(img);
        if (frac < 0.18) throw new Error(`2D fallback drew only ${(frac * 100).toFixed(1)}% ink`);
        return `loss->plain->restored OK; 5-arg 2D trail ink=${(frac * 100).toFixed(0)}%`;
      } finally {
        c2.remove();
        window.__gfx?.retire?.(c2);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'motion-smear stage',
      ink: async () => {
        await waitForRetiredGL();
        if (state.backend === 'plain') return null;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !state.texUploaded || !state.hasPainted) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return 1;
        }
        return state.hasPainted && canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
