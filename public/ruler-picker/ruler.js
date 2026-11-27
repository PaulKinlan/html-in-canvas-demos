import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const UNITS = {
  cm: { label: 'cm', min: 0, max: 100, defaultStep: 0.5, fineStep: 0.1, majorEvery: 10, labelEvery: 20, medEvery: 5, minorEvery: 1, initial: 42 },
  kg: { label: 'kg', min: 0, max: 200, defaultStep: 0.5, fineStep: 0.1, majorEvery: 20, labelEvery: 40, medEvery: 10, minorEvery: 2, initial: 84 },
  C:  { label: '°C', min: -20, max: 80, defaultStep: 0.5, fineStep: 0.1, majorEvery: 10, labelEvery: 20, medEvery: 5, minorEvery: 1, initial: 22 },
  dB: { label: 'dB', min: 0, max: 120, defaultStep: 1, fineStep: 0.1, majorEvery: 20, labelEvery: 20, medEvery: 10, minorEvery: 2, initial: 50 },
};

const THUMB_WIDTH_PX = 18;
const TRACK_MARGIN_PX = 8;
const TRACK_INSET_PX = TRACK_MARGIN_PX + THUMB_WIDTH_PX * 0.5;
const ODO_ROW_H = 44;
const ODO_ZERO_INDEX = 2; // reel is [8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]
const LENS_RADIUS_PX = 74;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod10 = (v) => ((v % 10) + 10) % 10;

export function snapToStep(value, step, min, max) {
  const s = step > 0 ? step : 0.1;
  const snapped = min + Math.round((value - min) / s) * s;
  return Number(clamp(snapped, min, max).toFixed(1));
}

export function lensSampleOffset(normDx, zoom) {
  const s = Math.min(1, Math.abs(normDx));
  if (zoom <= 1.001) return normDx;
  const invZ = 1 / zoom;
  const g = invZ * s + (1 - invZ) * Math.pow(s, 3.6);
  return normDx < 0 ? -g : g;
}

// #region spring-odometer
function decomposeDigits(value) {
  const tenthsTotal = Math.round(Math.abs(value) * 10);
  const tenths = tenthsTotal % 10;
  const intPart = Math.floor(tenthsTotal / 10);
  const ones = intPart % 10;
  const tens = Math.floor(intPart / 10) % 10;
  const hundreds = Math.floor(intPart / 100) % 10;
  const sign = value < -0.05 ? 1 : 0;
  return { sign, hundreds, tens, ones, tenths };
}

function stepDampedSpring(cur, vel, target, dt, stiffness, damping) {
  const stepSize = 1 / 120;
  let x = cur;
  let v = vel;
  for (let rem = dt; rem > 1e-6; rem -= stepSize) {
    const h = Math.min(rem, stepSize);
    const acc = -stiffness * (x - target) - damping * v;
    v += acc * h;
    x += v * h;
  }
  return [x, v];
}

export function createRulerState({ initialUnit = 'cm', initialValue = 42, isReduced = () => false } = {}) {
  const unit = UNITS[initialUnit] ?? UNITS.cm;
  const initDigits = decomposeDigits(initialValue);
  const s = {
    unitKey: initialUnit,
    fineStep: false,
    lensMode: '2.4',
    targetValue: initialValue,
    thumbNorm: clamp((initialValue - unit.min) / (unit.max - unit.min), 0, 1),
    lensNorm: clamp((initialValue - unit.min) / (unit.max - unit.min), 0, 1),
    lensVel: 0,
    hoverNorm: null,
    dragging: false,
    boostUntil: 0,
    lensZoom: 2.15,
    lensZoomVel: 0,
    odo: {
      sign:     { pos: initDigits.sign, vel: 0, target: initDigits.sign },
      hundreds: { pos: initDigits.hundreds, vel: 0, target: initDigits.hundreds },
      tens:     { pos: initDigits.tens, vel: 0, target: initDigits.tens },
      ones:     { pos: initDigits.ones, vel: 0, target: initDigits.ones },
      tenths:   { pos: initDigits.tenths, vel: 0, target: initDigits.tenths },
    },
  };

  function targetZoom(now = performance.now()) {
    if (s.lensMode === 'flat') return 1.0;
    const active = s.dragging || s.hoverNorm !== null || now < s.boostUntil;
    if (s.lensMode === '1.8') return active ? 1.8 : 1.65;
    return active ? 2.4 : 2.15;
  }

  function setTargetValue(nextVal, { boost = false, snap = false, now = performance.now() } = {}) {
    const u = UNITS[s.unitKey] ?? UNITS.cm;
    const prevVal = s.targetValue;
    const dir = Math.sign(nextVal - prevVal);
    s.targetValue = nextVal;
    s.thumbNorm = clamp((nextVal - u.min) / (u.max - u.min), 0, 1);
    if (boost) s.boostUntil = now + 280;

    const d = decomposeDigits(nextVal);
    s.odo.sign.target = d.sign;

    const keys = ['hundreds', 'tens', 'ones', 'tenths'];
    for (const key of keys) {
      const slot = s.odo[key];
      const newD = d[key];
      if (snap || isReduced()) {
        slot.pos = newD;
        slot.vel = 0;
        slot.target = newD;
        continue;
      }
      const curMod = mod10(slot.pos);
      slot.pos = curMod;
      if (dir > 0 && newD < curMod - 0.45) {
        slot.target = newD + 10;
      } else if (dir < 0 && newD > curMod + 0.45) {
        slot.pos = curMod + 10;
        slot.target = newD;
      } else {
        slot.target = newD;
      }
    }

    if (snap || isReduced()) {
      s.odo.sign.pos = d.sign;
      s.odo.sign.vel = 0;
      s.lensNorm = s.hoverNorm ?? s.thumbNorm;
      s.lensVel = 0;
      s.lensZoom = targetZoom();
      s.lensZoomVel = 0;
    }
  }

  function step(dt, now = performance.now()) {
    const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
    const goalNorm = s.hoverNorm !== null && !s.dragging ? s.hoverNorm : s.thumbNorm;
    const goalZoom = targetZoom(now);

    if (isReduced()) {
      s.lensNorm = goalNorm;
      s.lensVel = 0;
      s.lensZoom = goalZoom;
      s.lensZoomVel = 0;
      for (const key of Object.keys(s.odo)) {
        const slot = s.odo[key];
        slot.pos = key === 'sign' ? slot.target : mod10(slot.target);
        slot.vel = 0;
        slot.target = slot.pos;
      }
      return false;
    }

    let moving = false;

    // Lens X spring
    if (Math.abs(s.lensNorm - goalNorm) > 0.0005 || Math.abs(s.lensVel) > 0.002) {
      const [nx, nv] = stepDampedSpring(s.lensNorm, s.lensVel, goalNorm, clampedDt, 260, 26);
      s.lensNorm = nx;
      s.lensVel = nv;
      if (Math.abs(s.lensNorm - goalNorm) < 0.0005 && Math.abs(s.lensVel) < 0.002) {
        s.lensNorm = goalNorm;
        s.lensVel = 0;
      } else {
        moving = true;
      }
    } else {
      s.lensNorm = goalNorm;
      s.lensVel = 0;
    }

    // Lens zoom spring
    if (Math.abs(s.lensZoom - goalZoom) > 0.002 || Math.abs(s.lensZoomVel) > 0.01) {
      const [zx, zv] = stepDampedSpring(s.lensZoom, s.lensZoomVel, goalZoom, clampedDt, 220, 24);
      s.lensZoom = zx;
      s.lensZoomVel = zv;
      if (Math.abs(s.lensZoom - goalZoom) < 0.002 && Math.abs(s.lensZoomVel) < 0.01) {
        s.lensZoom = goalZoom;
        s.lensZoomVel = 0;
      } else {
        moving = true;
      }
    } else {
      s.lensZoom = goalZoom;
      s.lensZoomVel = 0;
    }

    // Keep animating briefly while boost timer is active so lens settles gracefully back.
    if (now < s.boostUntil) moving = true;

    // Odometer drum springs
    for (const key of ['sign', 'hundreds', 'tens', 'ones', 'tenths']) {
      const slot = s.odo[key];
      const stiffness = key === 'tenths' ? 280 : 210;
      const damping = key === 'tenths' ? 26 : 24;
      if (Math.abs(slot.pos - slot.target) > 0.004 || Math.abs(slot.vel) > 0.015) {
        const [px, pv] = stepDampedSpring(slot.pos, slot.vel, slot.target, clampedDt, stiffness, damping);
        slot.pos = px;
        slot.vel = pv;
        if (key !== 'sign') {
          if (slot.pos >= 10) {
            slot.pos -= 10;
            slot.target -= 10;
          } else if (slot.pos < 0) {
            slot.pos += 10;
            slot.target += 10;
          }
        }
        if (Math.abs(slot.pos - slot.target) < 0.004 && Math.abs(slot.vel) < 0.015) {
          slot.pos = key === 'sign' ? slot.target : mod10(slot.target);
          slot.target = slot.pos;
          slot.vel = 0;
        } else {
          moving = true;
        }
      } else {
        slot.pos = key === 'sign' ? slot.target : mod10(slot.target);
        slot.target = slot.pos;
        slot.vel = 0;
      }
    }

    return moving;
  }

  return { s, setTargetValue, step, targetZoom };
}
// #endregion spring-odometer

// #region ruler-shader
export const RULER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec4 uRulerRect;
uniform vec4 uOdoRect;
uniform float uLensX;
uniform float uLensRadiusU;
uniform float uLensZoom;
uniform float uLensActive;
uniform float uDragIntensity;

in vec2 vUv;
out vec4 outColor;

float lensProfile(float s, float zoom) {
  float invZ = 1.0 / max(zoom, 1.0);
  return invZ * s + (1.0 - invZ) * pow(s, 3.6);
}

void main() {
  vec4 col = texture(uTex, vUv);

  // Cylindrical glass magnifier lens across the scale track
  if (vUv.x >= uRulerRect.x && vUv.x <= uRulerRect.z &&
      vUv.y >= uRulerRect.y && vUv.y <= uRulerRect.w) {
    float dx = (vUv.x - uLensX) / max(uLensRadiusU, 0.001);
    float s = abs(dx);
    if (uLensActive > 0.01 && uLensZoom > 1.005 && s < 1.0) {
      float signDx = dx < 0.0 ? -1.0 : 1.0;
      float cylH = sqrt(max(0.0, 1.0 - s * s));
      float strength = clamp((uLensZoom - 1.0) / 1.4, 0.0, 1.0);

      // Vertical barrel arch around scale midline
      float midY = 0.5 * (uRulerRect.y + uRulerRect.w);
      float barrel = 0.22 * strength;
      float vy = clamp(midY + (vUv.y - midY) / (1.0 + barrel * cylH * cylH),
                       uRulerRect.y + 0.001, uRulerRect.w - 0.001);

      // Chromatic RGB fringe peaking at steep Snell edges
      float disp = 0.026 * s * s * strength;
      float uR = clamp(uLensX + signDx * lensProfile(clamp(s + disp, 0.0, 1.0), uLensZoom) * uLensRadiusU,
                       uRulerRect.x + 0.001, uRulerRect.z - 0.001);
      float uG = clamp(uLensX + signDx * lensProfile(s, uLensZoom) * uLensRadiusU,
                       uRulerRect.x + 0.001, uRulerRect.z - 0.001);
      float uB = clamp(uLensX + signDx * lensProfile(clamp(s - disp, 0.0, 1.0), uLensZoom) * uLensRadiusU,
                       uRulerRect.x + 0.001, uRulerRect.z - 0.001);

      vec4 cR = texture(uTex, vec2(uR, vy));
      vec4 cG = texture(uTex, vec2(uG, vy));
      vec4 cB = texture(uTex, vec2(uB, vy));
      col = vec4(cR.r, cG.g, cB.b, cG.a);

      // Snell rim shadow, darkened glass reflection bar, and crisp rim highlight
      float ry = clamp((vUv.y - uRulerRect.y) / max(uRulerRect.w - uRulerRect.y, 0.001), 0.0, 1.0);
      float rimShade = smoothstep(0.74, 0.96, s) * (1.0 - smoothstep(0.96, 1.0, s));
      float rimHighlight = exp(-pow((s - 0.94) / 0.032, 2.0)) * (0.16 + 0.09 * uDragIntensity);
      float topBar = exp(-pow((ry - 0.16) / 0.055, 2.0)) * (0.13 + 0.08 * uDragIntensity) * (0.5 + 0.5 * cylH);
      float darkBar = exp(-pow((ry - 0.30) / 0.085, 2.0)) * 0.24 * (0.55 + 0.45 * cylH);

      col.rgb *= mix(1.0, 0.56, rimShade * uLensActive);
      col.rgb *= (1.0 - darkBar * uLensActive);
      col.rgb += vec3(0.16, 0.24, 0.36) * (0.18 * cylH) * col.a * uLensActive;
      col.rgb += vec3(0.88, 0.94, 1.0) * (topBar + rimHighlight) * col.a * uLensActive;
    }
  }

  // Mechanical cylinder shading and top/bottom bezel vignette over the rolling <output>
  if (vUv.x >= uOdoRect.x && vUv.x <= uOdoRect.z &&
      vUv.y >= uOdoRect.y && vUv.y <= uOdoRect.w) {
    float oy = clamp((vUv.y - uOdoRect.y) / max(uOdoRect.w - uOdoRect.y, 0.001), 0.0, 1.0);
    float cyl = sin(oy * 3.14159265);
    float drumShade = mix(0.36, 1.08, pow(max(cyl, 0.0), 0.52));
    float topVig = exp(-oy * 8.5) * 0.40;
    float botVig = exp(-(1.0 - oy) * 8.5) * 0.46;
    float glint = exp(-pow((oy - 0.22) / 0.055, 2.0)) * 0.085;
    col.rgb = col.rgb * drumShade * (1.0 - topVig - botVig) + vec3(0.86, 0.91, 1.0) * glint * col.a;
  }

  outColor = col;
}`;
// #endregion ruler-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('ruler-stage');
const viewportEl = document.getElementById('ruler-viewport');
const canvas = document.getElementById('ruler-canvas');
const cardEl = document.getElementById('ruler-card');
const rangeInput = document.getElementById('ruler-range');
const datalistEl = document.getElementById('ruler-ticks');
const tickStripEl = document.getElementById('tick-strip');
const scaleWrapEl = document.getElementById('scale-wrap');
const odoWindowEl = document.getElementById('odo-window');
const odoUnitEl = document.getElementById('odo-unit');
const outSrEl = document.getElementById('ruler-out-sr');
const spanLabelEl = document.getElementById('range-span-label');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('stage-notice');
const hudEl = document.getElementById('stage-hud');
const checksBody = document.getElementById('checks-body');

const unitBtns = Array.from(document.querySelectorAll('.unit-btn[data-unit]'));
const presetBtns = Array.from(document.querySelectorAll('.preset-btn[data-preset]'));
const fineBtn = document.getElementById('btn-fine');
const lensBtns = Array.from(document.querySelectorAll('button[data-lens]'));
const reducedCheck = document.getElementById('ctl-reduced');

const slotEls = {
  sign: cardEl.querySelector('.odo-slot[data-slot="sign"]'),
  hundreds: cardEl.querySelector('.odo-slot[data-slot="hundreds"]'),
  tens: cardEl.querySelector('.odo-slot[data-slot="tens"]'),
  ones: cardEl.querySelector('.odo-slot[data-slot="ones"]'),
  tenths: cardEl.querySelector('.odo-slot[data-slot="tenths"]'),
};
const reelEls = {
  sign: slotEls.sign?.querySelector('.odo-reel'),
  hundreds: slotEls.hundreds?.querySelector('.odo-reel'),
  tens: slotEls.tens?.querySelector('.odo-reel'),
  ones: slotEls.ones?.querySelector('.odo-reel'),
  tenths: slotEls.tenths?.querySelector('.odo-reel'),
};

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

// ---------------------------------------------------------------- State & backend
const ctrl = createRulerState({ initialUnit: 'cm', initialValue: 42, isReduced });
const state = ctrl.s;

let stage = null;
let ctx2d = null;
let plainBuffer = null;
let plainBufferCtx = null;
let backend = 'none';
let hasPainted = false;
let textureDirty = true;
let rectsDirty = true;
let rafId = 0;
let lastFrameTime = 0;
let isVisible = true;
let lostTimer = 0;
let lastGeoSig = '';
let cachedRulerRect = [0.03, 0.48, 0.97, 0.74];
let cachedOdoRect = [0.22, 0.20, 0.78, 0.40];

function boxInCard(el, card) {
  let x = 0;
  let y = 0;
  let cur = el;
  while (cur && cur !== card) {
    x += cur.offsetLeft || 0;
    y += cur.offsetTop || 0;
    cur = cur.offsetParent;
  }
  const cw = card.offsetWidth || 1;
  const ch = card.offsetHeight || 1;
  return [x / cw, y / ch, (x + el.offsetWidth) / cw, (y + el.offsetHeight) / ch];
}

function refreshRects() {
  if (!rectsDirty) return;
  cachedRulerRect = boxInCard(scaleWrapEl, cardEl);
  cachedOdoRect = boxInCard(odoWindowEl, cardEl);
  rectsDirty = false;
}

function buildScaleMarks(unitKey) {
  const u = UNITS[unitKey] ?? UNITS.cm;
  const span = u.max - u.min;

  // Populate semantic <datalist> options
  const dlFrag = document.createDocumentFragment();
  for (let v = u.min; v <= u.max + 1e-6; v += u.majorEvery) {
    const opt = document.createElement('option');
    opt.value = String(Number(v.toFixed(1)));
    dlFrag.append(opt);
  }
  datalistEl.replaceChildren(dlFrag);

  // Populate visual graduated ticks aligned with the thumb travel [9px .. W-9px]
  const tickFrag = document.createDocumentFragment();
  const base = document.createElement('div');
  base.className = 'scale-baseline';
  tickFrag.append(base);

  const count = Math.round(span / u.minorEvery);
  for (let i = 0; i <= count; i++) {
    const val = Number((u.min + i * u.minorEvery).toFixed(2));
    const p = clamp((val - u.min) / span, 0, 1);
    const isMajor = Math.abs(Math.round((val - u.min) / u.majorEvery) * u.majorEvery - (val - u.min)) < 0.01;
    const isMed = !isMajor && Math.abs(Math.round((val - u.min) / u.medEvery) * u.medEvery - (val - u.min)) < 0.01;
    const tick = document.createElement('div');
    tick.className = `tick-mark${isMajor ? ' is-major' : isMed ? ' is-med' : ''}`;
    tick.style.setProperty('--p', p.toFixed(5));
    tickFrag.append(tick);

    const isLabel = Math.abs(Math.round((val - u.min) / u.labelEvery) * u.labelEvery - (val - u.min)) < 0.01;
    if (isLabel) {
      const lbl = document.createElement('span');
      lbl.className = 'tick-label';
      lbl.style.setProperty('--p', p.toFixed(5));
      lbl.textContent = String(Math.round(val));
      tickFrag.append(lbl);
    }
  }
  tickStripEl.replaceChildren(tickFrag);
}

function applyOdoDom() {
  const u = UNITS[state.unitKey] ?? UNITS.cm;
  const val = state.targetValue;
  const formatted = val.toFixed(1);
  outSrEl.textContent = `${formatted} ${u.label}`;

  const absVal = Math.abs(val);
  const isNeg = val < -0.05;
  slotEls.sign?.classList.toggle('is-empty', !isNeg && state.odo.sign.pos < 0.05);
  slotEls.hundreds?.classList.toggle('is-hidden', isNeg && absVal < 99.95);
  slotEls.hundreds?.classList.toggle('is-dim', !isNeg && absVal < 99.95);
  slotEls.tens?.classList.toggle('is-dim', absVal < 9.95);

  if (reelEls.sign) {
    const sy = -state.odo.sign.pos * ODO_ROW_H;
    reelEls.sign.style.transform = `translateY(${sy.toFixed(2)}px)`;
  }
  for (const key of ['hundreds', 'tens', 'ones', 'tenths']) {
    const reel = reelEls[key];
    if (!reel) continue;
    const py = -(ODO_ZERO_INDEX + state.odo[key].pos) * ODO_ROW_H;
    reel.style.transform = `translateY(${py.toFixed(2)}px)`;
  }
}

function markDirty() {
  textureDirty = true;
  canvas.requestPaint?.();
  scheduleLoop();
}

function applyRangeValue(nextVal, { boost = false, snap = false } = {}) {
  const u = UNITS[state.unitKey] ?? UNITS.cm;
  const step = state.fineStep ? u.fineStep : u.defaultStep;
  const clamped = snapToStep(nextVal, step, u.min, u.max);
  rangeInput.value = String(clamped);
  ctrl.setTargetValue(clamped, { boost, snap });
  applyOdoDom();
  markDirty();
}

function switchUnit(nextKey) {
  const prevU = UNITS[state.unitKey] ?? UNITS.cm;
  const nextU = UNITS[nextKey] ?? UNITS.cm;
  const norm = clamp((state.targetValue - prevU.min) / (prevU.max - prevU.min), 0, 1);

  state.unitKey = nextKey;
  const step = state.fineStep ? nextU.fineStep : nextU.defaultStep;
  const rescaled = snapToStep(nextU.min + norm * (nextU.max - nextU.min), step, nextU.min, nextU.max);

  rangeInput.min = String(nextU.min);
  rangeInput.max = String(nextU.max);
  rangeInput.step = String(step);
  rangeInput.value = String(rescaled);
  rangeInput.setAttribute('aria-label', `Ruler value in ${nextU.label}`);

  odoUnitEl.textContent = nextU.label;
  spanLabelEl.textContent = `${nextU.min} to ${nextU.max} ${nextU.label} · step ${step}`;
  for (const btn of unitBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.unit === nextKey));
  }

  buildScaleMarks(nextKey);
  rectsDirty = true;
  ctrl.setTargetValue(rescaled, { boost: true });
  applyOdoDom();
  markDirty();
}

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  }
}

function switchToPlain(reason) {
  backend = 'plain';
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.add('plain');
  if (cardEl.parentElement !== plainHost) {
    plainHost.append(cardEl);
  }
  showNotice(reason);
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('plain');
  if (cardEl.parentElement !== canvas) {
    canvas.append(cardEl);
  }
  rectsDirty = true;
  showNotice('');
  markDirty();
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend !== 'webgl' || !hasPainted) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const fw = cardEl.offsetWidth;
  const fh = cardEl.offsetHeight;
  if (!cw || !ch || !fw || !fh) return;

  const unit = geometryUnit(canvas, cardEl, fw);
  const sig = `${unit.toFixed(4)}:${cw}x${ch}:${fw}x${fh}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const scaled = new DOMMatrix().scale(unit, unit, 1);
  canvas.updateElementGeometry?.(cardEl, { canvasTransform: scaled });
  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function lensCenterU(cw) {
  const sw = scaleWrapEl.offsetWidth || cw;
  const sx = cachedRulerRect[0] * cw;
  const travel = Math.max(1, sw - TRACK_INSET_PX * 2);
  const px = sx + TRACK_INSET_PX + state.lensNorm * travel;
  return px / Math.max(cw, 1);
}

// #region fallback-2d
function draw2DFallback(cw, ch) {
  if (!ctx2d || !hasPainted) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.drawElementImage(cardEl, 0, 0, cw, ch);

  if (state.lensMode === 'flat' || state.lensZoom <= 1.01) return;

  refreshRects();
  if (!plainBuffer) {
    plainBuffer = document.createElement('canvas');
    plainBufferCtx = plainBuffer.getContext('2d');
  }
  if (plainBuffer.width !== bw || plainBuffer.height !== bh) {
    plainBuffer.width = bw;
    plainBuffer.height = bh;
  }
  plainBufferCtx.clearRect(0, 0, bw, bh);
  plainBufferCtx.drawImage(canvas, 0, 0);

  const rx0 = cachedRulerRect[0] * cw;
  const ry0 = cachedRulerRect[1] * ch;
  const rx1 = cachedRulerRect[2] * cw;
  const ry1 = cachedRulerRect[3] * ch;
  const rh = ry1 - ry0;
  const cx = lensCenterU(cw) * cw;
  const left = Math.max(rx0, cx - LENS_RADIUS_PX);
  const right = Math.min(rx1, cx + LENS_RADIUS_PX);
  if (right - left < 4 || rh < 4) return;

  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.roundRect(left, ry0 + 1, right - left, rh - 2, 8);
  ctx2d.clip();

  const strip = 2;
  for (let x = left; x < right; x += strip) {
    const w = Math.min(strip, right - x);
    const normDx = clamp((x + w * 0.5 - cx) / LENS_RADIUS_PX, -1, 1);
    const mappedX = clamp(cx + lensSampleOffset(normDx, state.lensZoom) * LENS_RADIUS_PX, rx0 + 1, rx1 - 2);
    const sx = mappedX * dpr;
    ctx2d.drawImage(plainBuffer, sx, ry0 * dpr, Math.max(1, strip * dpr), rh * dpr, x, ry0, w, rh);
  }

  const grad = ctx2d.createLinearGradient(0, ry0, 0, ry1);
  grad.addColorStop(0, 'rgb(220 235 255 / 0.14)');
  grad.addColorStop(0.24, 'rgb(10 14 22 / 0.18)');
  grad.addColorStop(1, 'rgb(200 220 255 / 0.04)');
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(left, ry0, right - left, rh);
  ctx2d.restore();

  // Keep 1:1 hit-testing aligned to the full card
  ctx2d.save();
  ctx2d.globalAlpha = 0;
  ctx2d.drawElementImage(cardEl, 0, 0, cw, ch);
  ctx2d.restore();
}
// #endregion fallback-2d

function updateHud() {
  const u = UNITS[state.unitKey] ?? UNITS.cm;
  const step = state.fineStep ? u.fineStep : u.defaultStep;
  const routeName = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  const zoomText = state.lensMode === 'flat' ? '1.00× (flat)' : `${state.lensZoom.toFixed(2)}×`;
  hudEl.textContent =
    `Route: ${routeName} · Value: ${state.targetValue.toFixed(1)} ${u.label} (step ${step}) · ` +
    `Lens: ${zoomText} · Odo tenths pos: ${state.odo.tenths.pos.toFixed(2)}`;
}

function drawFrame(forceDraw = false) {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch || !hasPainted) return;

  refreshRects();

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (textureDirty || !stage.has(cardEl)) {
        stage.upload(cardEl);
        textureDirty = false;
      }
      const lx = lensCenterU(cw);
      const radiusU = LENS_RADIUS_PX / Math.max(cw, 1);
      const activeFlag = state.lensMode === 'flat' ? 0 : 1;
      const dragIntensity = state.dragging || state.hoverNorm !== null || performance.now() < state.boostUntil ? 1 : 0;

      stage.quad(cardEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.uniform4f(loc('uRulerRect'), cachedRulerRect[0], cachedRulerRect[1], cachedRulerRect[2], cachedRulerRect[3]);
        gl.uniform4f(loc('uOdoRect'), cachedOdoRect[0], cachedOdoRect[1], cachedOdoRect[2], cachedOdoRect[3]);
        gl.uniform1f(loc('uLensX'), lx);
        gl.uniform1f(loc('uLensRadiusU'), radiusU);
        gl.uniform1f(loc('uLensZoom'), state.lensZoom);
        gl.uniform1f(loc('uLensActive'), activeFlag);
        gl.uniform1f(loc('uDragIntensity'), dragIntensity);
      });
      syncGeometry(forceDraw);
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        textureDirty = true;
        canvas.requestPaint?.();
      } else {
        throw err;
      }
    }
  } else if (backend === '2d') {
    draw2DFallback(cw, ch);
  }
  updateHud();
}

function tick(now) {
  rafId = 0;
  if (!isVisible || backend === 'plain' || backend === 'none') return;
  const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1 / 60;
  lastFrameTime = now;

  const moving = ctrl.step(dt, now);
  applyOdoDom();
  if (moving) textureDirty = true;
  drawFrame();

  if (moving || state.dragging) {
    rafId = requestAnimationFrame(tick);
  } else {
    lastFrameTime = 0;
  }
}

function scheduleLoop() {
  if (!isVisible || backend === 'plain' || backend === 'none') return;
  if (!rafId) {
    rafId = requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------- Event wiring
rangeInput.addEventListener('input', () => {
  applyRangeValue(Number(rangeInput.value), { boost: true });
});

rangeInput.addEventListener('pointerdown', () => {
  state.dragging = true;
  state.hoverNorm = null;
  scheduleLoop();
});

for (const evName of ['pointerup', 'pointercancel']) {
  window.addEventListener(evName, () => {
    if (state.dragging) {
      state.dragging = false;
      scheduleLoop();
    }
  });
}

scaleWrapEl.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || state.dragging) return;
  const r = scaleWrapEl.getBoundingClientRect();
  if (r.width <= TRACK_INSET_PX * 2) return;
  state.hoverNorm = clamp((e.clientX - r.left - TRACK_INSET_PX) / (r.width - TRACK_INSET_PX * 2), 0, 1);
  scheduleLoop();
});

scaleWrapEl.addEventListener('pointerleave', () => {
  if (state.hoverNorm !== null) {
    state.hoverNorm = null;
    scheduleLoop();
  }
});

rangeInput.addEventListener('keydown', () => {
  state.boostUntil = performance.now() + 280;
  scheduleLoop();
});

for (const btn of unitBtns) {
  btn.addEventListener('click', () => switchUnit(btn.dataset.unit));
}

for (const btn of presetBtns) {
  btn.addEventListener('click', () => {
    const u = UNITS[state.unitKey] ?? UNITS.cm;
    const p = btn.dataset.preset;
    const target = p === 'min' ? u.min : p === 'mid' ? (u.min + u.max) * 0.5 : clamp(75, u.min, u.max);
    applyRangeValue(target, { boost: true });
  });
}

fineBtn.addEventListener('click', () => {
  const u = UNITS[state.unitKey] ?? UNITS.cm;
  state.fineStep = !state.fineStep;
  const step = state.fineStep ? u.fineStep : u.defaultStep;
  rangeInput.step = String(step);
  fineBtn.setAttribute('aria-pressed', String(state.fineStep));
  spanLabelEl.textContent = `${u.min} to ${u.max} ${u.label} · step ${step}`;
  applyRangeValue(Number(rangeInput.value), { boost: true });
});

for (const btn of lensBtns) {
  btn.addEventListener('click', () => {
    state.lensMode = btn.dataset.lens;
    for (const b of lensBtns) b.setAttribute('aria-pressed', String(b === btn));
    if (isReduced()) {
      state.lensZoom = ctrl.targetZoom();
      state.lensZoomVel = 0;
    }
    scheduleLoop();
  });
}

reducedCheck.addEventListener('change', () => {
  if (isReduced()) {
    ctrl.setTargetValue(state.targetValue, { snap: true });
    applyOdoDom();
  }
  markDirty();
});

// ---------------------------------------------------------------- Backend startup & visibility
function startBackend() {
  buildScaleMarks('cm');
  applyOdoDom();

  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so the ruler instrument is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    hasPainted = true;
    textureDirty = true;
    if (!rafId && isVisible) drawFrame();
  });

  const forceRoute = new URLSearchParams(location.search).get('route');

  if (glSupported && forceRoute !== '2d') {
    try {
      stage = new ElementGL(canvas, {
        fragment: RULER_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so the ruler instrument moved to plain HTML.');
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          restoreFromPlain();
          backend = 'webgl';
          lastGeoSig = '';
          hasPainted = true;
          textureDirty = true;
          scheduleLoop();
        },
      });
      backend = 'webgl';
    } catch {
      stage = null;
    }
  }

  if (backend === 'none') {
    ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      switchToPlain('Canvas rendering is unavailable here, so the ruler instrument is shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so the ruler instrument moved to plain HTML.');
        }
      }, 900);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = true;
      textureDirty = true;
      scheduleLoop();
    });
  }

  canvas.requestPaint?.();
}

if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver((entries) => {
    const entry = entries[0];
    const nowVisible = Boolean(entry && entry.isIntersecting);
    if (nowVisible === isVisible) return;
    isVisible = nowVisible;
    if (isVisible) {
      markDirty();
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }, { threshold: 0.01 });
  io.observe(viewportEl);
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    rectsDirty = true;
    lastGeoSig = '';
    textureDirty = true;
    scheduleLoop();
  });
  ro.observe(viewportEl);
}

startBackend();
updateHud();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, msg) => { if (!ok) throw new Error(msg); return msg; };
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function retireFixture(g, rootEl, canvasEl, baseActive) {
  g?.dispose();
  rootEl?.remove();
  window.__gfx?.retire?.(canvasEl);
  for (let i = 0; i < 15; i++) {
    const active = window.__gfx?.active?.() ?? 0;
    const removed = window.__gfx?.memory?.().removed ?? 0;
    if (active <= baseActive && removed === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function findBrightColumns(buf, rowWidth) {
  const cols = [];
  let inRun = false;
  let start = 0;
  for (let x = 0; x < rowWidth; x++) {
    const i = x * 4;
    const lum = buf[i] + buf[i + 1] + buf[i + 2];
    const bright = lum > 300;
    if (bright && !inRun) {
      inRun = true;
      start = x;
    } else if (!bright && inRun) {
      inRun = false;
      cols.push((start + x - 1) * 0.5);
    }
  }
  if (inRun) cols.push((start + rowWidth - 1) * 0.5);
  return cols;
}

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() renders the ruler card cleanly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), paints and uploads a ruler card child via texElementSubImage2D(), draws with RULER_FRAG, and checks gl.getError() === 0 plus rendered pixel ink.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 260;
      const ch = 150;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block`;

      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = `width:${cw}px;height:${ch}px;background:#141820;color:#f3efe6;padding:12px;box-sizing:border-box;font:700 18px system-ui`;
      child.innerHTML = '<div>42.0 cm</div><div style="height:28px;margin-top:16px;background:repeating-linear-gradient(90deg,#f0ece3 0 2px,#0b0e14 2px 12px)"></div>';
      cv.append(child);
      testStage().append(cv);

      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: RULER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        const uploaded = g.upload(child);

        g.begin([0, 0, 0, 0]);
        g.quad(child, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
          gl.uniform4f(loc('uRulerRect'), 0.04, 0.35, 0.96, 0.85);
          gl.uniform4f(loc('uOdoRect'), 0.1, 0.05, 0.9, 0.28);
          gl.uniform1f(loc('uLensX'), 0.5);
          gl.uniform1f(loc('uLensRadiusU'), 0.28);
          gl.uniform1f(loc('uLensZoom'), 2.15);
          gl.uniform1f(loc('uLensActive'), 1);
          gl.uniform1f(loc('uDragIntensity'), 0);
        });
        const err = g.gl.getError();
        const px = new Uint8Array(4 * cv.width);
        g.gl.readPixels(0, Math.floor(cv.height * 0.5), cv.width, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, px);
        let nonZero = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 128) nonZero++;

        return need(
          err === g.gl.NO_ERROR && uploaded && nonZero > cv.width * 0.8,
          `gl.getError()=${err}, uploaded ${uploaded?.w}x${uploaded?.h}, opaque pixels on centre row ${nonZero}/${cv.width}.`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Cylindrical lens shader magnifies and refracts ruler ticks around thumb X',
    expect: 'pass',
    why: 'Draws a striped tick fixture through RULER_FRAG once flat (1.0x) and once with a 2.4x cylindrical lens at x = 0.5, then measures the tick peak spacing near the lens centre in WebGL pixels.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 300;
      const ch = 120;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block`;

      const scaleBox = document.createElement('div');
      scaleBox.setAttribute('drawable', '');
      scaleBox.style.cssText = `width:${cw}px;height:${ch}px;background:repeating-linear-gradient(90deg,#f5f2ea 0 2px,#0b0e14 2px 12px)`;
      cv.append(scaleBox);
      testStage().append(cv);

      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: RULER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.upload(scaleBox);

        const renderAndScan = (active, zoom) => {
          g.begin([0, 0, 0, 0]);
          g.quad(scaleBox, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform4f(loc('uRulerRect'), 0, 0, 1, 1);
            gl.uniform4f(loc('uOdoRect'), 0, 0, 0, 0);
            gl.uniform1f(loc('uLensX'), 0.5);
            gl.uniform1f(loc('uLensRadiusU'), 0.28);
            gl.uniform1f(loc('uLensZoom'), zoom);
            gl.uniform1f(loc('uLensActive'), active);
            gl.uniform1f(loc('uDragIntensity'), 1);
          });
          const row = new Uint8Array(4 * cv.width);
          g.gl.readPixels(0, Math.floor(cv.height * 0.55), cv.width, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, row);
          return row;
        };

        const flatRow = renderAndScan(0, 1.0);
        const lensRow = renderAndScan(1, 2.4);
        const flatCols = findBrightColumns(flatRow, cv.width);
        const lensCols = findBrightColumns(lensRow, cv.width);

        const mid = cv.width * 0.5;
        const nearestGap = (cols) => {
          const sorted = [...cols].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
          if (sorted.length < 3) return 0;
          const pair = [sorted[0], sorted[1]].sort((a, b) => a - b);
          return pair[1] - pair[0];
        };
        const flatGap = nearestGap(flatCols);
        const lensGap = nearestGap(lensCols);
        const ratio = flatGap > 0 ? lensGap / flatGap : 0;

        // Also check chromatic dispersion (R - B difference near rim x ≈ 0.5 + 0.22)
        const rimIdx = Math.floor(cv.width * 0.72) * 4;
        let maxRgbSplit = 0;
        for (let x = Math.floor(cv.width * 0.65); x < Math.floor(cv.width * 0.78); x++) {
          const i = x * 4;
          maxRgbSplit = Math.max(maxRgbSplit, Math.abs(lensRow[i] - lensRow[i + 2]));
        }

        return need(
          flatGap > 0 && ratio > 1.75 && maxRgbSplit > 10 && rimIdx > 0,
          `centre tick spacing ${flatGap.toFixed(1)} px -> ${lensGap.toFixed(1)} px (${ratio.toFixed(2)}x), rim R-B chroma split ${maxRgbSplit}.`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Range input and preset button stay clickable via elementsFromPoint() and update value',
    expect: 'pass',
    why: 'Mounts an isolated ElementGL ruler fixture with a real <input type="range">, <output> and Snap 75 button on testStage(), syncs updateElementGeometry() with geometryUnit(), probes elementsFromPoint(), and fires click and input events.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 300;
      const ch = 150;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block;position:relative`;

      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = `width:${cw}px;height:${ch}px;padding:10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;background:#141820;color:#fff`;

      const out = document.createElement('output');
      out.textContent = '42.0 cm';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '0.5';
      slider.value = '42';
      slider.style.cssText = 'width:100%;height:40px;margin:0';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Snap 75';
      btn.style.cssText = 'height:38px;width:120px;border-radius:6px;background:#ff6a33;color:#141820;border:0;font:600 13px monospace';

      btn.addEventListener('click', () => {
        slider.value = '75';
        out.textContent = '75.0 cm';
      });
      slider.addEventListener('input', () => {
        out.textContent = `${Number(slider.value).toFixed(1)} cm`;
      });

      card.append(out, slider, btn);
      cv.append(card);
      testStage().append(cv);

      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: RULER_FRAG });
          g.begin([0, 0, 0, 0]);
        }
        await nextPaint(cv);
        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(card);
          g.quad(card, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform4f(loc('uRulerRect'), 0, 0.3, 1, 0.65);
            gl.uniform4f(loc('uOdoRect'), 0, 0, 1, 0.25);
            gl.uniform1f(loc('uLensX'), 0.42);
            gl.uniform1f(loc('uLensRadiusU'), 0.25);
            gl.uniform1f(loc('uLensZoom'), 2.15);
            gl.uniform1f(loc('uLensActive'), 1);
            gl.uniform1f(loc('uDragIntensity'), 0);
          });
        }

        const unit = geometryUnit(cv, card, cw);
        cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit, unit, 1) });
        card.dataset.hitTick = '1';
        await raf2();

        const bRect = btn.getBoundingClientRect();
        const sRect = slider.getBoundingClientRect();
        const btnHits = document.elementsFromPoint(bRect.left + bRect.width * 0.5, bRect.top + bRect.height * 0.5);
        const sliderHits = document.elementsFromPoint(sRect.left + sRect.width * 0.5, sRect.top + sRect.height * 0.5);

        btn.click();
        const afterClick = slider.value;
        slider.value = '63.5';
        slider.dispatchEvent(new Event('input', { bubbles: true }));

        return need(
          btnHits.includes(btn) && sliderHits.includes(slider) && afterClick === '75' && out.textContent === '63.5 cm',
          `elementsFromPoint hit <button> & <input type=range> (geometryUnit=${unit.toFixed(3)}), button->${afterClick}, input->${out.textContent}.`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Lens spring and rolling odometer settle cleanly, and snap under reduced motion',
    expect: 'pass',
    why: 'Steps createRulerState() from 42.0 to 75.0 under normal motion until settled (verifying loop termination), then tests reduced motion for single-step immediate snap.',
    run: async () => {
      let reduced = false;
      const ctrlFx = createRulerState({ initialUnit: 'cm', initialValue: 42, isReduced: () => reduced });
      let t = 1000;
      ctrlFx.setTargetValue(75, { boost: true, now: t });

      let steps = 0;
      let stillMoving = true;
      while (stillMoving && steps < 240) {
        t += 16.67;
        stillMoving = ctrlFx.step(1 / 60, t);
        steps++;
      }
      const settled = !stillMoving
        && Math.abs(ctrlFx.s.lensNorm - 0.75) < 0.001
        && Math.abs(ctrlFx.s.odo.tens.pos - 7) < 0.01
        && Math.abs(ctrlFx.s.odo.ones.pos - 5) < 0.01;

      reduced = true;
      ctrlFx.setTargetValue(18.5);
      const reducedMoving = ctrlFx.step(1 / 60, t + 16.67);
      const snapped = !reducedMoving
        && Math.abs(ctrlFx.s.lensNorm - 0.185) < 0.001
        && ctrlFx.s.odo.tens.pos === 1
        && ctrlFx.s.odo.ones.pos === 8
        && ctrlFx.s.odo.tenths.pos === 5;

      return need(
        settled && snapped,
        `normal settled in ${steps} frames (tens=${ctrlFx.s.odo.tens.pos}, lensNorm=${ctrlFx.s.lensNorm.toFixed(3)}); reduced motion snapped immediately (${ctrlFx.s.odo.tens.pos}${ctrlFx.s.odo.ones.pos}.${ctrlFx.s.odo.tenths.pos}).`
      );
    },
  },
  {
    name: 'webglcontextlost switches the instrument to plain HTML and keeps controls usable',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture with a plainHost sibling on testStage(), dispatches synthetic webglcontextlost, verifies ElementGL sets lost=true, moves the card into plainHost, and preserves range interaction.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:260px;height:140px;position:relative';
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:260px;height:140px;display:block';
      const plain = document.createElement('div');
      plain.hidden = true;
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = 'width:260px;height:140px;padding:10px;box-sizing:border-box;background:#141820;color:#fff';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = '42';
      const out = document.createElement('output');
      out.textContent = '42';
      slider.addEventListener('input', () => { out.textContent = slider.value; });
      card.append(out, slider);
      cv.append(card);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, {
          fragment: RULER_FRAG,
          onLost: () => {
            lostFired = true;
            cv.style.display = 'none';
            plain.hidden = false;
            plain.append(card);
          },
        });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.upload(card);
        g.quad(card, ElementGL.rect(cv, 0, 0, 260, 140));

        cv.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        await raf2();

        slider.value = '88';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const sRect = slider.getBoundingClientRect();
        const hits = document.elementsFromPoint(sRect.left + sRect.width * 0.5, sRect.top + sRect.height * 0.5);

        return need(
          lostFired && g.lost && card.parentElement === plain && !plain.hidden && out.textContent === '88' && hits.includes(slider),
          `lost=${g.lost}, card parent=${card.parentElement === plain ? 'plainHost' : 'canvas'}, plain input hit=${hits.includes(slider)}, output=${out.textContent}.`
        );
      } finally {
        await retireFixture(g, wrap, cv, baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'ruler canvas',
      note: 'plain HTML',
      ink: async () => {
        if (backend === 'plain') return null;
        if (!hasPainted || !canvas.width || !canvas.height) return 0;
        if (backend === 'webgl') {
          if (!stage || stage.lost) return 0;
          drawFrame(true);
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => switchToPlain('The ruler canvas came back blank, so the instrument moved to plain HTML.'),
    },
  ]),
];

runTests(checksBody, tests);
