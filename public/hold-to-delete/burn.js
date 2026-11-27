import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const HOLD_DURATION_MS = 1400;
export const QUENCH_RATE = 1.65;
export const RESTORE_RATE = 2.4;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

// DOM references
const stageBox = document.getElementById('burn-stage');
const viewportEl = document.getElementById('burn-viewport');
let canvas = document.getElementById('burn-canvas');
const burnCard = document.getElementById('burn-card');
const deletedCard = document.getElementById('deleted-card');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('burn-notice');
const statusEl = document.getElementById('burn-status');
const testsBody = document.getElementById('tests');

// Card controls inside drawable HTML
const cardTitleInput = document.getElementById('card-title');
const cardNotesInput = document.getElementById('card-notes');
const cardStatusPill = document.getElementById('card-status-pill');
const chargeBadge = document.getElementById('charge-badge');
const chargeFill = document.getElementById('charge-fill');
const scopePills = Array.from(document.querySelectorAll('#scope-pills button[data-scope]'));
const btnArchive = document.getElementById('btn-archive');
const btnDelete = document.getElementById('btn-delete');
const btnRing = document.getElementById('btn-ring');

// Deleted card controls inside drawable HTML
const deletedNameEl = document.getElementById('deleted-name');
const deletedTelemetryEl = document.getElementById('deleted-telemetry');
const btnUndo = document.getElementById('btn-undo');

// External controls
const scrubSlider = document.getElementById('scrub-slider');
const scrubOut = document.getElementById('scrub-out');
const styleButtons = Array.from(document.querySelectorAll('#burn-styles button[data-style]'));
const resetBurnBtn = document.getElementById('btn-reset-burn');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region button-rect
export function rectSdf(px, py, rx, ry, rw, rh) {
  const cx = rx + rw * 0.5;
  const cy = ry + rh * 0.5;
  const hx = Math.max(rw * 0.5, 1);
  const hy = Math.max(rh * 0.5, 1);
  const r = Math.min(10, hx, hy);
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

export function computeMaxRectDist(cw, ch, rx, ry, rw, rh) {
  return Math.max(
    24,
    rectSdf(0, 0, rx, ry, rw, rh),
    rectSdf(cw, 0, rx, ry, rw, rh),
    rectSdf(0, ch, rx, ry, rw, rh),
    rectSdf(cw, ch, rx, ry, rw, rh)
  );
}

export function measureButtonRect(cardEl, btnEl) {
  const cw = Math.max(1, cardEl.offsetWidth || cardEl.clientWidth || 350);
  const ch = Math.max(1, cardEl.offsetHeight || cardEl.clientHeight || 440);
  let x = 0;
  let y = 0;
  let cur = btnEl;
  while (cur && cur !== cardEl) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent;
  }
  if (cur === cardEl) {
    x += cardEl.clientLeft || 0;
    y += cardEl.clientTop || 0;
  } else {
    const cr = cardEl.getBoundingClientRect();
    const br = btnEl.getBoundingClientRect();
    const sx = cr.width > 0 ? cw / cr.width : 1;
    const sy = cr.height > 0 ? ch / cr.height : 1;
    x = (br.left - cr.left) * sx;
    y = (br.top - cr.top) * sy;
  }
  const w = Math.max(1, btnEl.offsetWidth || 124);
  const h = Math.max(1, btnEl.offsetHeight || 44);
  return {
    x,
    y,
    w,
    h,
    cw,
    ch,
    maxDist: computeMaxRectDist(cw, ch, x, y, w, h),
  };
}
// #endregion button-rect

// #region burn-shader
export const BURN_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uPass;           // 0 = burn card, 1 = deleted card
uniform vec4 uOriginRect;    // x, y, w, h of #btn-delete in CSS px inside #burn-card
uniform float uCharge;       // 0..1
uniform float uMaxDist;      // max CSS-px SDF from button rect to card corners
uniform int uStyle;          // 0 = paper ash, 1 = plasma scorch
uniform float uReduced;      // 1.0 skips turbulence & sparks
uniform float uRevealAlpha;  // 0..1 opacity for uPass == 1

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = rot * p * 2.04 + vec2(11.3, 7.7);
    amp *= 0.5;
  }
  return sum;
}

float cellular(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md = 1.6;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + (0.18 + 0.64 * o) - f;
      md = min(md, dot(r, r));
    }
  }
  return clamp(sqrt(md), 0.0, 1.0);
}

float sparkField(vec2 pCss, float time, float seedOffset) {
  vec2 drift = vec2(sin(time * 2.3 + pCss.y * 0.025 + seedOffset) * 7.0, time * 74.0);
  vec2 grid = (pCss + drift) / 26.0;
  vec2 cell = floor(grid);
  vec2 f = fract(grid);
  vec2 rnd = hash22(cell + vec2(seedOffset, seedOffset * 1.7));
  if (rnd.x < 0.68) return 0.0;
  vec2 center = 0.2 + 0.6 * rnd;
  float dist = length(f - center);
  float flicker = 0.55 + 0.45 * sin(time * 13.0 + rnd.y * 40.0);
  return smoothstep(0.16, 0.01, dist) * flicker;
}

void main() {
  if (uPass == 1) {
    vec4 d = texture(uTex, vUv);
    outColor = d * clamp(uRevealAlpha, 0.0, 1.0);
    return;
  }

  if (uCharge <= 0.001) {
    outColor = texture(uTex, vUv);
    return;
  }
  if (uCharge >= 0.999) {
    outColor = vec4(0.0);
    return;
  }

  vec2 p = vUv * uSize;
  vec2 rectCenter = uOriginRect.xy + uOriginRect.zw * 0.5;
  vec2 rectHalf = max(uOriginRect.zw * 0.5, vec2(1.0));
  float cornerR = min(10.0, min(rectHalf.x, rectHalf.y));
  vec2 q = abs(p - rectCenter) - rectHalf + vec2(cornerR);
  float boxSd = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - cornerR;
  float normDist = boxSd / max(uMaxDist, 1.0);

  vec3 emberMid = uStyle == 1 ? vec3(0.45, 0.34, 1.0) : vec3(1.0, 0.36, 0.04);
  vec3 emberHot = uStyle == 1 ? vec3(0.84, 0.98, 1.0) : vec3(1.0, 0.94, 0.72);
  vec3 coronaCol = uStyle == 1 ? vec3(1.0, 0.22, 0.64) : vec3(0.95, 0.24, 0.02);
  vec3 scorchCol = uStyle == 1 ? vec3(0.17, 0.13, 0.32) : vec3(0.30, 0.14, 0.06);
  vec3 charCol = uStyle == 1 ? vec3(0.04, 0.04, 0.10) : vec3(0.06, 0.035, 0.03);

  if (uReduced > 0.5) {
    vec4 tex = texture(uTex, vUv);
    vec3 baseRgb = tex.a > 0.002 ? clamp(tex.rgb / tex.a, 0.0, 1.0) : vec3(0.0);
    float front = mix(-0.14, 1.16, uCharge);
    float gap = normDist - front;
    float cardMask = tex.a * smoothstep(-0.018, 0.02, gap);
    float edgeBand = (1.0 - smoothstep(0.0, 0.055, abs(gap))) * tex.a;

    // Stepped circular progress halo around the button centre
    vec2 dBtn = p - rectCenter;
    float ang = atan(dBtn.y, dBtn.x);
    float angNorm = fract((ang + 1.5707963) / 6.2831853);
    float stepped = floor(uCharge * 12.0) / 12.0;
    float ringDist = abs(boxSd - 4.0);
    float ringHalo = (1.0 - smoothstep(1.5, 4.0, ringDist)) * step(angNorm, stepped) * tex.a;

    vec3 col = mix(baseRgb, emberMid, edgeBand * 0.72);
    col = mix(col, emberHot, ringHalo * 0.9);
    float outA = clamp(max(cardMask, max(edgeBand * 0.85, ringHalo * 0.85)), 0.0, 1.0);
    outColor = vec4(clamp(col, 0.0, 1.0) * outA, outA);
    return;
  }

  vec2 uvScaled = p / max(min(uSize.x, uSize.y), 1.0);
  float nFbm = fbm(uvScaled * 5.8 + vec2(0.0, uTime * 0.52));
  float nDetail = fbm(uvScaled * 15.5 + vec2(sin(uTime * 0.65) * 0.18, uTime * 1.18));
  float nDetailX = fbm((uvScaled + vec2(0.018, 0.0)) * 15.5 + vec2(sin(uTime * 0.65) * 0.18, uTime * 1.18));
  float nDetailY = fbm((uvScaled + vec2(0.0, 0.018)) * 15.5 + vec2(sin(uTime * 0.65) * 0.18, uTime * 1.18));
  float nCell = cellular(uvScaled * 12.0 + vec2(0.0, uTime * 0.42));

  float organic = nFbm * 0.56 + nDetail * 0.24 + nCell * 0.20;
  float updraft = 0.055 * clamp((rectCenter.y - p.y) / max(uSize.y, 1.0), 0.0, 1.0) * smoothstep(0.06, 0.45, uCharge);
  float field = normDist + (organic - 0.5) * 0.24 - updraft;
  float front = mix(-0.16, 1.24, pow(uCharge, 1.10));
  float burnGap = field - front;

  // Thermal distortion just ahead of the flame front
  float heatZone = smoothstep(0.15, 0.0, burnGap) * step(-0.025, burnGap);
  vec2 heatGrad = vec2(nDetailX - nDetail, nDetailY - nDetail);
  vec2 sampleUv = clamp(vUv + heatGrad * (0.042 * heatZone), vec2(0.001), vec2(0.999));

  vec4 tex = texture(uTex, sampleUv);
  vec3 baseRgb = tex.a > 0.002 ? clamp(tex.rgb / tex.a, 0.0, 1.0) : vec3(0.0);

  // Scorch + blistered charcoal + glowing cracks ahead of the flame front
  float preheat = smoothstep(0.14, 0.045, burnGap) * step(0.0, burnGap);
  float charZone = smoothstep(0.088, 0.008, burnGap) * step(-0.018, burnGap);
  float crack = smoothstep(0.36, 0.06, nCell) * smoothstep(0.055, 0.0, burnGap) * step(-0.018, burnGap);

  vec3 cardCol = mix(baseRgb, baseRgb * 0.72 + scorchCol * 0.28, preheat * 0.85);
  cardCol = mix(cardCol, charCol, charZone * 0.94);
  cardCol += emberMid * crack * 1.05;

  // Initial scorching corona tightly hugging #btn-delete border
  float borderGlow = exp(-abs(boxSd) / (4.5 + 16.0 * uCharge)) * smoothstep(0.0, 0.06, uCharge) * (1.0 - smoothstep(0.30, 0.58, uCharge));
  cardCol += coronaCol * borderGlow * 0.65;

  // Incandescent white-gold-orange (or plasma) flame rim right at burnGap = 0
  float flameCore = exp(-pow(burnGap / 0.014, 2.0));
  float flameOuter = exp(-pow((burnGap + 0.004) / 0.032, 2.0));
  vec3 flameCol = mix(coronaCol, emberMid, smoothstep(0.15, 0.65, flameOuter));
  flameCol = mix(flameCol, emberHot, smoothstep(0.25, 0.95, flameCore));

  // Rising glowing spark particles in the immediate wake behind the burn front
  float sparkZone = smoothstep(-0.20, -0.045, burnGap) * (1.0 - smoothstep(-0.008, 0.016, burnGap));
  float sp = sparkField(p, uTime, 1.0) + 0.75 * sparkField(p * 1.35 + vec2(40.0, 15.0), uTime * 1.25, 9.4);
  float sparkIntensity = clamp(sp * sparkZone * 1.15, 0.0, 1.0);
  vec3 sparkCol = mix(emberMid, emberHot, clamp(sp, 0.0, 1.0));

  float edgeConsume = smoothstep(-0.020, 0.007, burnGap);
  float cardMask = tex.a * edgeConsume;
  float fireMask = (flameOuter * 0.94 + borderGlow * 0.55) * tex.a;
  float outA = clamp(max(cardMask, max(fireMask, sparkIntensity * tex.a)), 0.0, 1.0);

  vec3 outRgb = mix(cardCol, flameCol, clamp(flameOuter * 0.92, 0.0, 1.0));
  outRgb += sparkCol * sparkIntensity;
  outRgb = clamp(outRgb, 0.0, 1.0);

  outColor = vec4(outRgb * outA, outA);
}
`;
// #endregion burn-shader

// #region hold-quench
export function stepBurnState(sim, dtSec, reducedMotion = false) {
  const dt = Math.min(0.05, Math.max(0, dtSec));

  if (sim.restoring) {
    if (reducedMotion) {
      sim.charge = 0;
      sim.deleted = false;
      sim.restoring = false;
      sim.holding = false;
      sim.scrubLocked = false;
      return false;
    }
    sim.deleted = false;
    sim.charge = Math.max(0, sim.charge - RESTORE_RATE * dt);
    if (sim.charge <= 0) {
      sim.charge = 0;
      sim.restoring = false;
      return false;
    }
    return true;
  }

  if (sim.deleted) {
    sim.charge = 1;
    sim.holding = false;
    return false;
  }

  if (sim.holding) {
    const rate = 1000 / HOLD_DURATION_MS;
    sim.charge = Math.min(1, sim.charge + rate * dt);
    if (sim.charge >= 1) {
      sim.charge = 1;
      sim.deleted = true;
      sim.holding = false;
      sim.scrubLocked = false;
      return false;
    }
    return true;
  }

  if (sim.scrubLocked) {
    return sim.charge > 0 && sim.charge < 1 && !reducedMotion;
  }

  if (sim.charge > 0) {
    if (reducedMotion) {
      sim.charge = 0;
      return false;
    }
    sim.charge = Math.max(0, sim.charge - QUENCH_RATE * dt);
    return sim.charge > 0;
  }

  return false;
}
// #endregion hold-quench

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// #region geometry-sync
export function syncCardGeometry({
  canvasEl,
  burnEl,
  deletedEl,
  deleted,
  mode,
  cw,
  ch,
  unitCache,
  lastGeoKeyRef,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;

  burnEl.inert = Boolean(deleted);
  deletedEl.inert = !deleted;
  burnEl.style.pointerEvents = deleted ? 'none' : 'auto';
  deletedEl.style.pointerEvents = deleted ? 'auto' : 'none';

  const dw = Math.max(1, deletedEl.offsetWidth || Math.min(312, cw - 28));
  const dh = Math.max(1, deletedEl.offsetHeight || 220);
  const ox = Math.round((cw - dw) * 0.5);
  const oy = Math.round((ch - dh) * 0.5);

  const key = `${mode}|${cw}x${ch}|${dw}x${dh}|${deleted ? 1 : 0}`;
  if (!force && lastGeoKeyRef.value === key) return;
  lastGeoKeyRef.value = key;

  if (mode === '2d') {
    if (OFFSTAGE) {
      canvasEl.updateElementGeometry(deleted ? burnEl : deletedEl, { canvasTransform: OFFSTAGE });
    }
    burnEl.dataset.hitTick = burnEl.dataset.hitTick === '1' ? '0' : '1';
    deletedEl.dataset.hitTick = deletedEl.dataset.hitTick === '1' ? '0' : '1';
    return;
  }

  if (mode !== 'webgl') return;

  const activeEl = deleted ? deletedEl : burnEl;
  const activeW = deleted ? dw : cw;
  const zoom = activeEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${activeW}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, activeEl, activeW);
    unitCache.key = uKey;
  }
  const u = unitCache.unit;

  if (deleted) {
    if (OFFSTAGE) canvasEl.updateElementGeometry(burnEl, { canvasTransform: OFFSTAGE });
    canvasEl.updateElementGeometry(deletedEl, {
      canvasTransform: new DOMMatrix().translate(ox * u, oy * u).scale(u, u),
    });
  } else {
    if (OFFSTAGE) canvasEl.updateElementGeometry(deletedEl, { canvasTransform: OFFSTAGE });
    canvasEl.updateElementGeometry(burnEl, {
      canvasTransform: new DOMMatrix().scale(u, u),
    });
  }
  burnEl.dataset.hitTick = burnEl.dataset.hitTick === '1' ? '0' : '1';
  deletedEl.dataset.hitTick = deletedEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

const sim = {
  charge: 0,
  holding: false,
  deleted: false,
  restoring: false,
  scrubLocked: false,
};

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  style: 'paper', // 'paper' | 'plasma'
  archived: false,
  reducedOverride: reducedToggle.checked,
  hasPainted: false,
  onScreen: true,
  uploads: 0,
  paints: 0,
  holdStartedAt: 0,
  holdElapsedMs: 0,
  holdFrames: 0,
  holdByKeyboard: false,
  activePointerId: null,
  lastTickMs: 0,
  rafId: 0,
  lastBadgeStep: -1,
  lastGeoKeyRef: { value: '' },
  unitCache: { key: '', unit: 1 },
};

let stage = null;
let ctx2d = null;
const viewTextures = new Map();

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 354);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 440);
  return { cw, ch };
}

function syncCardSizes(cw, ch) {
  if (state.mode === 'plain') {
    burnCard.style.width = '';
    burnCard.style.height = '';
    deletedCard.style.width = '';
    return;
  }
  const bw = `${cw}px`;
  const bh = `${ch}px`;
  if (burnCard.style.width !== bw) burnCard.style.width = bw;
  if (burnCard.style.height !== bh) burnCard.style.height = bh;
  const dw = `${Math.min(312, Math.max(220, cw - 28))}px`;
  if (deletedCard.style.width !== dw) deletedCard.style.width = dw;
}

function syncInCardProgressUI(force = false) {
  const reduced = isReducedMotion();
  const displayP = reduced ? Math.floor(sim.charge * 12) / 12 : sim.charge;
  const step = Math.round(displayP * 20);
  const modeKey = `${step}|${sim.holding ? 1 : 0}|${sim.deleted ? 1 : 0}|${sim.restoring ? 1 : 0}|${sim.scrubLocked ? 1 : 0}|${reduced ? 1 : 0}`;
  if (!force && state.lastBadgeStep === modeKey) return;
  state.lastBadgeStep = modeKey;

  const pct = Math.round(displayP * 100);
  chargeFill.style.width = `${pct}%`;
  btnRing.style.setProperty('--ring-p', `${(displayP * 360).toFixed(1)}deg`);

  if (sim.deleted) {
    chargeBadge.textContent = 'Deleted · 100%';
    chargeBadge.dataset.state = 'hot';
  } else if (sim.restoring) {
    chargeBadge.textContent = `Restoring ${pct}%`;
    chargeBadge.dataset.state = 'cool';
  } else if (sim.holding) {
    chargeBadge.textContent = `Igniting ${pct}%`;
    chargeBadge.dataset.state = 'hot';
  } else if (sim.scrubLocked && sim.charge > 0) {
    chargeBadge.textContent = `Held at ${pct}%`;
    chargeBadge.dataset.state = 'hot';
  } else if (sim.charge > 0) {
    chargeBadge.textContent = `Cooling ${pct}%`;
    chargeBadge.dataset.state = 'cool';
  } else {
    chargeBadge.textContent = 'Hold 1.4s to delete';
    chargeBadge.dataset.state = 'idle';
  }
}

function syncDeletedTelemetry() {
  const title = cardTitleInput.value.trim() || 'Untitled API key';
  deletedNameEl.textContent = title;
  const styleLabel = state.style === 'plasma' ? 'Plasma scorch' : 'Paper ash';
  const sec = (state.holdElapsedMs / 1000).toFixed(2);
  deletedTelemetryEl.textContent = state.holdElapsedMs > 0
    ? `Deleted after ${sec} s hold · ${state.holdFrames} frames · ${styleLabel}`
    : `Scrubbed to 100% · ${styleLabel}`;
}

function updateExternalControls() {
  const pct = Math.round(sim.charge * 100);
  scrubSlider.value = String(pct);
  scrubOut.textContent = `${pct}%`;
  resetBurnBtn.disabled = sim.charge <= 0.001 && !sim.deleted;
  for (const btn of styleButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.style === state.style));
  }
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const styleLabel = state.style === 'plasma' ? 'Plasma scorch' : 'Paper ash';
  const pct = Math.round(sim.charge * 100);
  const stateLabel = sim.deleted
    ? 'Deleted (Undo active)'
    : sim.holding
      ? `Burning ${pct}%`
      : sim.restoring
        ? `Restoring ${pct}%`
        : sim.charge > 0
          ? (sim.scrubLocked ? `Scrubbed ${pct}%` : `Cooling ${pct}%`)
          : 'Intact';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${routeLabel} · ${styleLabel} · ${stateLabel} · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

function tryUploadElement(el) {
  if (!stage || stage.lost) return null;
  try {
    const tex = stage.upload(el);
    if (tex) {
      viewTextures.set(el, tex);
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return viewTextures.get(el) ?? null;
    }
    throw err;
  }
}

function renderWebGL(changedSet = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  syncCardSizes(cw, ch);

  if (changedSet) {
    for (const el of [deletedCard, burnCard]) {
      if (changedSet.has(el) || !viewTextures.has(el)) tryUploadElement(el);
    }
  } else {
    if (!viewTextures.has(burnCard)) tryUploadElement(burnCard);
    if (!viewTextures.has(deletedCard)) tryUploadElement(deletedCard);
  }

  if (!viewTextures.has(burnCard)) return;
  if (!stage.begin([0, 0, 0, 0])) return;

  if ((sim.deleted || sim.charge > 0.02) && viewTextures.has(deletedCard)) {
    const dw = deletedCard.offsetWidth || Math.min(312, cw - 28);
    const dh = deletedCard.offsetHeight || 220;
    const ox = Math.round((cw - dw) * 0.5);
    const oy = Math.round((ch - dh) * 0.5);
    const reveal = sim.deleted ? 1.0 : smoothstep(0.32, 0.94, sim.charge);
    stage.quad(deletedCard, ElementGL.rect(canvas, ox, oy, dw, dh), (gl, loc) => {
      gl.uniform1i(loc('uPass'), 1);
      gl.uniform1f(loc('uRevealAlpha'), reveal);
    });
  }

  if (!sim.deleted && sim.charge < 0.999) {
    const rect = measureButtonRect(burnCard, btnDelete);
    stage.quad(burnCard, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
      gl.uniform1i(loc('uPass'), 0);
      gl.uniform4f(loc('uOriginRect'), rect.x, rect.y, rect.w, rect.h);
      gl.uniform1f(loc('uCharge'), sim.charge);
      gl.uniform1f(loc('uMaxDist'), rect.maxDist);
      gl.uniform1i(loc('uStyle'), state.style === 'plasma' ? 1 : 0);
      gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1.0 : 0.0);
    });
  }

  syncCardGeometry({
    canvasEl: canvas,
    burnEl: burnCard,
    deletedEl: deletedCard,
    deleted: sim.deleted,
    mode: state.mode,
    cw,
    ch,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
  });

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  syncCardSizes(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const dw = deletedCard.offsetWidth || Math.min(312, cw - 28);
  const dh = deletedCard.offsetHeight || 220;
  const ox = Math.round((cw - dw) * 0.5);
  const oy = Math.round((ch - dh) * 0.5);
  const rect = measureButtonRect(burnCard, btnDelete);
  const cx = rect.x + rect.w * 0.5;
  const cy = rect.y + rect.h * 0.5;
  const maxR = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(cw - cx, cy),
    Math.hypot(cx, ch - cy),
    Math.hypot(cw - cx, ch - cy)
  ) + 12;
  const holeR = sim.charge <= 0.001 ? 0 : Math.max(0, (sim.charge - 0.04) / 0.96) * maxR;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);

  if (sim.deleted || sim.charge > 0.25) {
    ctx2d.save();
    ctx2d.globalAlpha = sim.deleted ? 1 : smoothstep(0.25, 0.95, sim.charge);
    ctx2d.drawElementImage(deletedCard, ox, oy, dw, dh);
    ctx2d.restore();
  }

  if (!sim.deleted && sim.charge < 0.999) {
    if (holeR > 1) {
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.rect(0, 0, cw, ch);
      ctx2d.arc(cx, cy, holeR, 0, Math.PI * 2, true);
      ctx2d.clip('evenodd');
      ctx2d.drawElementImage(burnCard, 0, 0, cw, ch);
      ctx2d.restore();

      const rimW = 14;
      const g = ctx2d.createRadialGradient(cx, cy, Math.max(0, holeR - 4), cx, cy, holeR + rimW);
      if (state.style === 'plasma') {
        g.addColorStop(0, 'rgba(214, 250, 255, 0.95)');
        g.addColorStop(0.45, 'rgba(115, 86, 255, 0.72)');
        g.addColorStop(1, 'rgba(20, 14, 42, 0)');
      } else {
        g.addColorStop(0, 'rgba(255, 240, 184, 0.95)');
        g.addColorStop(0.45, 'rgba(255, 92, 10, 0.72)');
        g.addColorStop(1, 'rgba(24, 14, 10, 0)');
      }
      ctx2d.fillStyle = g;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, holeR + rimW, 0, Math.PI * 2);
      ctx2d.fill();
    } else {
      ctx2d.drawElementImage(burnCard, 0, 0, cw, ch);
      if (sim.charge > 0.001) {
        ctx2d.strokeStyle = state.style === 'plasma' ? '#8ae6ff' : '#ff6a1a';
        ctx2d.lineWidth = 3;
        ctx2d.strokeRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
      }
    }
  }

  ctx2d.restore();
  syncCardGeometry({
    canvasEl: canvas,
    burnEl: burnCard,
    deletedEl: deletedCard,
    deleted: sim.deleted,
    mode: state.mode,
    cw,
    ch,
    unitCache: state.unitCache,
    lastGeoKeyRef: state.lastGeoKeyRef,
  });
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  sim.holding = false;
  stageBox.classList.add('is-plain');
  for (const el of [burnCard, deletedCard]) {
    if (el.parentElement !== plainHost) plainHost.append(el);
  }
  syncCardSizes(0, 0);
  burnCard.dataset.active = String(!sim.deleted);
  deletedCard.dataset.active = String(sim.deleted);
  burnCard.inert = sim.deleted;
  deletedCard.inert = !sim.deleted;
  burnCard.style.pointerEvents = sim.deleted ? 'none' : 'auto';
  deletedCard.style.pointerEvents = sim.deleted ? 'auto' : 'none';
  showNotice(reason);
  syncInCardProgressUI(true);
  updateExternalControls();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const el of [deletedCard, burnCard]) {
    delete el.dataset.active;
    if (el.parentElement !== canvas) canvas.append(el);
  }
  showNotice('');
}
// #endregion fallback-2d

function drawCurrentFrame() {
  if (state.mode === 'plain') {
    burnCard.dataset.active = String(!sim.deleted);
    deletedCard.dataset.active = String(sim.deleted);
    burnCard.inert = sim.deleted;
    deletedCard.inert = !sim.deleted;
    burnCard.style.pointerEvents = sim.deleted ? 'none' : 'auto';
    deletedCard.style.pointerEvents = sim.deleted ? 'auto' : 'none';
    updateStatus();
    return;
  }
  if (!state.hasPainted) {
    canvas.requestPaint?.();
    return;
  }
  if (state.mode === 'webgl' && stage && !stage.lost) {
    renderWebGL(null);
  } else if (state.mode === '2d' && ctx2d) {
    render2DFallback();
  }
}

function startLoop() {
  if (state.rafId || !state.onScreen || state.mode === 'plain') return;
  state.lastTickMs = performance.now();
  state.rafId = requestAnimationFrame(tick);
}

function tick(now) {
  state.rafId = 0;
  if (!state.onScreen) return;
  const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTickMs) / 1000));
  state.lastTickMs = now;

  const wasDeleted = sim.deleted;
  if (sim.holding) state.holdFrames++;
  const keepGoing = stepBurnState(sim, dt, isReducedMotion());

  if (!wasDeleted && sim.deleted) {
    state.holdElapsedMs = state.holdStartedAt ? Math.max(HOLD_DURATION_MS, now - state.holdStartedAt) : HOLD_DURATION_MS;
    syncDeletedTelemetry();
    if (state.holdByKeyboard) {
      requestAnimationFrame(() => btnUndo.focus({ preventScroll: true }));
    }
    state.holdByKeyboard = false;
  }

  syncInCardProgressUI(false);
  updateExternalControls();
  drawCurrentFrame();

  if (keepGoing && state.mode !== 'plain') {
    state.rafId = requestAnimationFrame(tick);
  }
}

function beginHold(byKeyboard = false) {
  if (sim.deleted || sim.holding) return;
  sim.restoring = false;
  sim.scrubLocked = false;
  sim.holding = true;
  state.holdByKeyboard = byKeyboard;
  state.holdStartedAt = performance.now() - sim.charge * HOLD_DURATION_MS;
  state.holdFrames = 0;
  syncInCardProgressUI(true);
  updateExternalControls();
  if (state.mode === 'plain') {
    // Drive plain-HTML hold with rAF so hold confirmation works in plain mode too.
    const plainStep = (t) => {
      if (!sim.holding || state.mode !== 'plain') return;
      const dt = Math.min(0.05, Math.max(0.001, (t - state.lastTickMs) / 1000));
      state.lastTickMs = t;
      const wasDel = sim.deleted;
      stepBurnState(sim, dt, isReducedMotion());
      if (!wasDel && sim.deleted) {
        state.holdElapsedMs = performance.now() - state.holdStartedAt;
        syncDeletedTelemetry();
      }
      syncInCardProgressUI(false);
      updateExternalControls();
      drawCurrentFrame();
      if (sim.holding) state.rafId = requestAnimationFrame(plainStep);
    };
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(plainStep);
    return;
  }
  startLoop();
}

function releaseHold() {
  if (!sim.holding) return;
  sim.holding = false;
  state.activePointerId = null;
  state.holdByKeyboard = false;
  syncInCardProgressUI(true);
  if (state.mode === 'plain') {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    const coolStep = (t) => {
      if (sim.holding || sim.deleted || state.mode !== 'plain') return;
      const dt = Math.min(0.05, Math.max(0.001, (t - state.lastTickMs) / 1000));
      state.lastTickMs = t;
      const keep = stepBurnState(sim, dt, isReducedMotion());
      syncInCardProgressUI(false);
      updateExternalControls();
      drawCurrentFrame();
      if (keep) state.rafId = requestAnimationFrame(coolStep);
    };
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(coolStep);
    return;
  }
  startLoop();
}

function triggerUndo() {
  if (!sim.deleted && sim.charge <= 0) return;
  sim.holding = false;
  sim.scrubLocked = false;
  sim.restoring = true;
  sim.deleted = false;
  state.lastGeoKeyRef.value = '';
  syncInCardProgressUI(true);
  updateExternalControls();
  if (state.mode === 'plain' || isReducedMotion()) {
    sim.charge = 0;
    sim.restoring = false;
    syncInCardProgressUI(true);
    updateExternalControls();
    drawCurrentFrame();
    btnDelete.focus({ preventScroll: true });
    return;
  }
  drawCurrentFrame();
  startLoop();
}

// Button hold listeners (pointer + Space/Enter keyboard)
btnDelete.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (sim.deleted) return;
  state.activePointerId = e.pointerId;
  try { btnDelete.setPointerCapture?.(e.pointerId); } catch {}
  beginHold(false);
});

btnDelete.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

const onPointerEnd = (e) => {
  if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;
  releaseHold();
};
btnDelete.addEventListener('pointerup', onPointerEnd);
btnDelete.addEventListener('pointercancel', onPointerEnd);
addEventListener('pointerup', onPointerEnd);
addEventListener('pointercancel', onPointerEnd);

btnDelete.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!e.repeat) beginHold(true);
  }
});
btnDelete.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    releaseHold();
  }
});
btnDelete.addEventListener('blur', () => releaseHold());
addEventListener('blur', () => releaseHold());

// Card interactive controls inside drawable HTML
btnArchive.addEventListener('click', () => {
  state.archived = !state.archived;
  btnArchive.textContent = state.archived ? 'Unarchive' : 'Archive';
  btnArchive.setAttribute('aria-pressed', String(state.archived));
  cardStatusPill.textContent = state.archived ? 'Archived' : 'Active';
  cardStatusPill.dataset.archived = String(state.archived);
  burnCard.classList.toggle('is-archived', state.archived);
});

for (const pill of scopePills) {
  pill.addEventListener('click', () => {
    const next = pill.getAttribute('aria-pressed') !== 'true';
    pill.setAttribute('aria-pressed', String(next));
  });
}

cardTitleInput.addEventListener('input', () => {
  deletedNameEl.textContent = cardTitleInput.value.trim() || 'Untitled API key';
});

btnUndo.addEventListener('click', triggerUndo);

// External controls
scrubSlider.addEventListener('input', () => {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  sim.holding = false;
  sim.restoring = false;
  const v = Math.max(0, Math.min(1, Number(scrubSlider.value) / 100));
  sim.charge = v;
  sim.scrubLocked = v > 0 && v < 1;
  sim.deleted = v >= 1;
  if (sim.deleted) {
    state.holdElapsedMs = 0;
    syncDeletedTelemetry();
  }
  state.lastGeoKeyRef.value = '';
  syncInCardProgressUI(true);
  updateExternalControls();
  drawCurrentFrame();
  if (sim.scrubLocked && !isReducedMotion()) startLoop();
});

for (const btn of styleButtons) {
  btn.addEventListener('click', () => {
    state.style = btn.dataset.style === 'plasma' ? 'plasma' : 'paper';
    stageBox.dataset.burnStyle = state.style;
    if (sim.deleted) syncDeletedTelemetry();
    updateExternalControls();
    drawCurrentFrame();
  });
}

resetBurnBtn.addEventListener('click', () => {
  if (sim.deleted) {
    triggerUndo();
    return;
  }
  sim.scrubLocked = false;
  sim.holding = false;
  sim.restoring = false;
  if (isReducedMotion()) {
    sim.charge = 0;
    syncInCardProgressUI(true);
    updateExternalControls();
    drawCurrentFrame();
    return;
  }
  startLoop();
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  syncInCardProgressUI(true);
  if (isReducedMotion()) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    drawCurrentFrame();
  } else if (sim.scrubLocked && sim.charge > 0 && sim.charge < 1) {
    startLoop();
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  syncInCardProgressUI(true);
  drawCurrentFrame();
});

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(changed);
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  });
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the card in plain HTML.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  syncCardSizes(cw, ch);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: BURN_FRAG,
        onLost: () => {
          viewTextures.clear();
          enterPlainFallback('The WebGL 2 context was lost. Showing the card in plain HTML until restored.');
        },
        onRestored: () => {
          viewTextures.clear();
          state.mode = 'webgl';
          state.hasPainted = false;
          state.lastGeoKeyRef.value = '';
          exitPlainFallback();
          const size = getViewportSize();
          syncCardSizes(size.cw, size.ch);
          canvas.requestPaint?.();
        },
      });
      state.mode = 'webgl';
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'burn-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(deletedCard, burnCard);
      canvas.replaceWith(fresh);
      window.__gfx?.retire?.(canvas);
      canvas = fresh;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      if (noticeEl.hidden) {
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
      }
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the card is shown as plain HTML.');
}

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else if (state.mode !== 'plain' && state.hasPainted) {
    if (sim.holding || sim.restoring || (sim.scrubLocked && sim.charge > 0 && sim.charge < 1 && !isReducedMotion()) || (!sim.scrubLocked && sim.charge > 0 && !sim.deleted)) {
      startLoop();
    } else {
      drawCurrentFrame();
    }
  }
}).observe(stageBox);

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKeyRef.value = '';
    const { cw, ch } = getViewportSize();
    syncCardSizes(cw, ch);
    if (state.hasPainted) drawCurrentFrame();
    else canvas.requestPaint?.();
  }
}).observe(viewportEl);

syncInCardProgressUI(true);
syncDeletedTelemetry();
updateExternalControls();
initBackend();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeFixtureStage(w = 240, h = 180) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px`;

  const delFix = document.createElement('div');
  delFix.setAttribute('drawable', '');
  delFix.inert = true;
  delFix.style.cssText =
    'position:absolute;left:0;top:0;width:180px;padding:12px;box-sizing:border-box;border-radius:10px;' +
    'background:#221c1a;color:#f5efe6;font:700 13px system-ui;pointer-events:none';
  const undoFix = document.createElement('button');
  undoFix.type = 'button';
  undoFix.textContent = 'Undo delete';
  undoFix.style.cssText = 'display:block;width:130px;height:40px;background:#ff7a4d;color:#1a110e;border:0;border-radius:8px;font:700 13px system-ui';
  delFix.append(undoFix);

  const cardFix = document.createElement('article');
  cardFix.setAttribute('drawable', '');
  cardFix.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:12px;box-sizing:border-box;` +
    'background:#fcfaf5;color:#1a1816;font:600 13px system-ui;pointer-events:auto';
  const inputFix = document.createElement('input');
  inputFix.type = 'text';
  inputFix.value = 'prod-key-42';
  inputFix.setAttribute('inputmode', 'none');
  inputFix.setAttribute('aria-label', 'Fixture key');
  inputFix.style.cssText = 'display:block;width:180px;height:32px;box-sizing:border-box;background:#fff;color:#1a1816;border:1px solid #ccc';
  const delBtnFix = document.createElement('button');
  delBtnFix.type = 'button';
  delBtnFix.textContent = 'Hold to delete';
  delBtnFix.style.cssText =
    'position:absolute;right:14px;bottom:14px;width:96px;height:38px;border:0;border-radius:8px;' +
    'background:#b3261e;color:#ffffff;font:700 12px system-ui';
  cardFix.append(inputFix, delBtnFix);

  cv.append(delFix, cardFix);
  return { cv, cardFix, delFix, inputFix, delBtnFix, undoFix };
}

runTests(testsBody, [
  {
    name: 'ElementGL upload and BURN_FRAG draw at charge = 0 and charge = 0.55',
    expect: 'pass',
    why: 'Uploads a fixture card via texElementSubImage2D() on testStage(), checks gl.getError() === 0, verifies intact pixels at charge = 0, and verifies transparent void inside the button rect plus charred and glowing ember front at charge = 0.55.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 180;
      const { cv, cardFix, delBtnFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: BURN_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        const tex = g.upload(cardFix);
        const rect = measureButtonRect(cardFix, delBtnFix);

        const drawAt = (charge) => {
          g.begin([0, 0, 0, 0]);
          g.quad(cardFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1i(loc('uPass'), 0);
            gl.uniform4f(loc('uOriginRect'), rect.x, rect.y, rect.w, rect.h);
            gl.uniform1f(loc('uCharge'), charge);
            gl.uniform1f(loc('uMaxDist'), rect.maxDist);
            gl.uniform1i(loc('uStyle'), 0);
            gl.uniform1f(loc('uReduced'), 0.0);
          });
        };

        drawAt(0);
        const err0 = g.gl.getError();
        const bx = rect.x + rect.w * 0.5;
        const by = rect.y + rect.h * 0.5;
        const restCorner = readCssPixel(g.gl, cv, W, H, 12, 12);
        const restBtn = readCssPixel(g.gl, cv, W, H, bx, by);

        drawAt(0.55);
        const err55 = g.gl.getError();
        const voidBtn = readCssPixel(g.gl, cv, W, H, bx, by);
        const intactCorner = readCssPixel(g.gl, cv, W, H, 12, 12);

        let sawChar = false;
        let sawEmber = false;
        let bestEmber = null;
        for (let i = 1; i <= 48; i++) {
          const t = i / 48;
          const sx = bx + (12 - bx) * t;
          const sy = by + (12 - by) * t;
          const px = readCssPixel(g.gl, cv, W, H, sx, sy);
          const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
          if (px[3] > 160 && lum < 175 && px[0] < 160) sawChar = true;
          if (px[3] > 110 && px[0] > 170 && px[0] > px[2] + 55) {
            sawEmber = true;
            if (!bestEmber || px[0] > bestEmber[0]) bestEmber = Array.from(px);
          }
        }

        const ok0 = err0 === g.gl.NO_ERROR && restCorner[0] > 230 && restBtn[0] > 140 && restBtn[0] - restBtn[1] > 90;
        const ok55 = err55 === g.gl.NO_ERROR && voidBtn[3] <= 5 && intactCorner[0] > 220 && sawChar && sawEmber;
        return need(
          ok0 && ok55 && tex?.w > 0,
          `tex=${tex?.w}x${tex?.h}, restBtn=[${Array.from(restBtn)}], voidBtnAlpha=${voidBtn[3]}, char=${sawChar}, ember=${bestEmber ? `[${bestEmber}]` : 'none'}, corner=[${Array.from(intactCorner)}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Early-release quench returns charge to 0 without losing typed input',
    expect: 'pass',
    why: 'Advances stepBurnState() for 550 ms, releases early before 1.4 s, steps cooling frames until charge reaches 0, and verifies an editable fixture <input> keeps its text.',
    run: async () => {
      const { cv, inputFix } = makeFixtureStage(220, 140);
      testStage().append(cv);
      try {
        inputFix.value = 'typed-secret-token';
        const s = { charge: 0, holding: true, deleted: false, restoring: false, scrubLocked: false };
        for (let i = 0; i < 11; i++) stepBurnState(s, 0.05, false); // 550 ms hold
        const peak = s.charge;
        const deletedMid = s.deleted;
        s.holding = false; // early release
        let coolSteps = 0;
        while (stepBurnState(s, 0.04, false) && coolSteps < 60) coolSteps++;
        return need(
          peak > 0.3 && peak < 0.65 && !deletedMid && !s.deleted && s.charge === 0 && inputFix.value === 'typed-secret-token',
          `550 ms peak=${(peak * 100).toFixed(0)}%, quenched to 0% in ${coolSteps} steps, deleted=${s.deleted}, value="${inputFix.value}".`
        );
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Full 1.4 s hold commits deleted = true and swaps inert + updateElementGeometry() to Undo',
    expect: 'pass',
    why: 'Completes stepBurnState() past 1400 ms, applies syncCardGeometry() on an isolated testStage() canvas, and checks document.elementsFromPoint() hits #btn-undo while #btn-delete stays offstage.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 240;
      const H = 180;
      const { cv, cardFix, delFix, delBtnFix, undoFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        const s = { charge: 0, holding: true, deleted: false, restoring: false, scrubLocked: false };
        for (let i = 0; i < 32; i++) stepBurnState(s, 0.05, false); // 1600 ms > 1400 ms
        if (!s.deleted || s.charge !== 1) throw new Error(`expected deleted=true, got deleted=${s.deleted}, charge=${s.charge}`);

        if (glSupported) {
          g = new ElementGL(cv, { fragment: BURN_FRAG });
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        const unitCache = { key: '', unit: 1 };
        const lastGeoKeyRef = { value: '' };
        const mode = g ? 'webgl' : '2d';

        // Before deletion: Delete button is hit-testable
        syncCardGeometry({ canvasEl: cv, burnEl: cardFix, deletedEl: delFix, deleted: false, mode, cw: W, ch: H, unitCache, lastGeoKeyRef, force: true });
        if (g) {
          g.upload(cardFix);
          g.begin([0, 0, 0, 0]);
          g.quad(cardFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1i(loc('uPass'), 0);
            gl.uniform1f(loc('uCharge'), 0);
          });
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const dr = delBtnFix.getBoundingClientRect();
        const delHits = document.elementsFromPoint(dr.left + dr.width * 0.5, dr.top + dr.height * 0.5);

        // After deletion: Undo button becomes hit-testable, Delete button is inert + offstage
        syncCardGeometry({ canvasEl: cv, burnEl: cardFix, deletedEl: delFix, deleted: true, mode, cw: W, ch: H, unitCache, lastGeoKeyRef, force: true });
        if (g) {
          g.upload(delFix);
          const dw = delFix.offsetWidth;
          const dh = delFix.offsetHeight;
          const ox = Math.round((W - dw) * 0.5);
          const oy = Math.round((H - dh) * 0.5);
          g.begin([0, 0, 0, 0]);
          g.quad(delFix, ElementGL.rect(cv, ox, oy, dw, dh), (gl, loc) => {
            gl.uniform1i(loc('uPass'), 1);
            gl.uniform1f(loc('uRevealAlpha'), 1.0);
          });
        } else {
          const ctx = cv.getContext('2d');
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawElementImage(delFix, 30, 50, delFix.offsetWidth, delFix.offsetHeight);
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const ur = undoFix.getBoundingClientRect();
        const undoHits = document.elementsFromPoint(ur.left + ur.width * 0.5, ur.top + ur.height * 0.5);

        return need(
          delHits.includes(delBtnFix) && undoHits.includes(undoFix) && !undoHits.includes(delBtnFix) && cardFix.inert && !delFix.inert,
          `beforeHitDelete=${delHits.includes(delBtnFix)}, afterHitUndo=${undoHits.includes(undoFix)}, cardInert=${cardFix.inert}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'webglcontextlost enters plain fallback and webglcontextrestored recovers ElementGL',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated ElementGL fixture on testStage(), verifying fallback DOM move and clean WebGL restoration.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 200;
      const H = 140;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, cardFix, delFix } = makeFixtureStage(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: BURN_FRAG,
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            plain.append(cardFix, delFix);
          },
          onRestored: () => {
            restoredFired = true;
            plain.hidden = true;
            cv.append(delFix, cardFix);
          },
        });
        await nextPaint(cv);
        g.upload(cardFix);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(cardFix);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        const texAfter = g.upload(cardFix);
        g.begin([0, 0, 0, 0]);
        g.quad(cardFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.uniform1i(loc('uPass'), 0);
          gl.uniform1f(loc('uCharge'), 0);
        });
        const err = g.gl.getError();

        return need(
          inPlainWhileLost && restoredFired && !g.lost && cv.contains(cardFix) && texAfter?.w > 0 && err === g.gl.NO_ERROR,
          `defaultPrevented=${lostEv.defaultPrevented}, plainWhileLost=${inPlainWhileLost}, restored=${restoredFired}, err=${err}.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'hold-to-delete stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !viewTextures.has(burnCard)) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.paints > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
]);
