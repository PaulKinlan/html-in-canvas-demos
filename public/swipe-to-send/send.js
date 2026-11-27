import { banner, supported as hicSupported, runTests, nextPaint, testStage, inkFraction, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const COMMIT_THRESHOLD = 92;
export const WAVE_DURATION = 1.15;
export const SENT_FLASH_DURATION = 0.95;

const CURRENCIES = [
  { code: 'GBP', symbol: '£' },
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;

// #region swipe-physics
/** Shared slider charge, 92% commit threshold, spring snapback and distortion wave controller. */
export function createPaymentState({
  onCommit = () => {},
  onReset = () => {},
  onCharge = () => {},
  isReduced = () => false,
} = {}) {
  const s = {
    charge: 0,
    chargeVel: 0,
    dragging: false,
    snapping: false,
    status: 'draft', // 'draft' | 'charging' | 'armed' | 'sent'
    waveActive: false,
    waveAge: -1,
    waveOriginMode: 'slider', // 'slider' | 'button'
    sentFlash: 0,
    commitCount: 0,
    autoSeq: null,
  };

  function syncDraftStatus() {
    if (s.status === 'sent') return;
    const pct = Math.round(s.charge * 100);
    if (pct >= COMMIT_THRESHOLD) s.status = 'armed';
    else if (pct > 0) s.status = 'charging';
    else s.status = 'draft';
  }

  function setSliderPct(pct) {
    if (s.status === 'sent') return;
    s.snapping = false;
    s.chargeVel = 0;
    s.charge = clamp(pct / 100, 0, 1);
    syncDraftStatus();
    onCharge(s.charge, s.status);
  }

  function beginDrag() {
    if (s.status === 'sent') return;
    s.dragging = true;
    s.snapping = false;
    s.chargeVel = 0;
    s.autoSeq = null;
  }

  function commit(originMode = 'button') {
    s.dragging = false;
    s.snapping = false;
    s.autoSeq = null;
    s.charge = 1;
    s.chargeVel = 0;
    s.status = 'sent';
    s.commitCount += 1;
    s.waveOriginMode = originMode;
    s.waveActive = true;
    s.waveAge = 0;
    s.sentFlash = 1;
    onCommit(s.commitCount, originMode);
  }

  function replayWave(originMode = 'button') {
    s.waveOriginMode = originMode;
    s.waveActive = true;
    s.waveAge = 0;
    s.sentFlash = 1;
  }

  function releaseDrag() {
    s.dragging = false;
    if (s.status === 'sent') return false;
    if (s.charge * 100 >= COMMIT_THRESHOLD) {
      commit('slider');
      return true;
    }
    if (s.charge > 0.002) {
      if (isReduced()) {
        s.charge = 0;
        s.chargeVel = 0;
        s.snapping = false;
        s.status = 'draft';
      } else {
        s.snapping = true;
      }
      onCharge(s.charge, s.status);
    } else {
      s.charge = 0;
      s.chargeVel = 0;
      s.snapping = false;
      s.status = 'draft';
      onCharge(0, 'draft');
    }
    return false;
  }

  function reset() {
    s.dragging = false;
    s.snapping = false;
    s.autoSeq = null;
    s.charge = 0;
    s.chargeVel = 0;
    s.status = 'draft';
    s.waveActive = false;
    s.waveAge = -1;
    s.sentFlash = 0;
    onReset();
  }

  function startAuto(kind) {
    if (s.status === 'sent') reset();
    s.autoSeq = { kind, t: 0 };
    s.dragging = false;
    s.snapping = false;
    s.chargeVel = 0;
  }

  function step(dt) {
    let moving = false;
    const clampedDt = Math.min(Math.max(dt, 0), 0.05);

    if (s.autoSeq) {
      const seq = s.autoSeq;
      seq.t += clampedDt;
      if (seq.kind === 'commit') {
        if (isReduced()) {
          s.autoSeq = null;
          commit('slider');
          moving = true;
        } else if (seq.t < 0.44) {
          const p = seq.t / 0.44;
          const ease = 1 - Math.pow(1 - p, 2);
          s.dragging = true;
          s.charge = ease * 0.96;
          syncDraftStatus();
          onCharge(s.charge, s.status);
          moving = true;
        } else {
          s.autoSeq = null;
          releaseDrag();
          moving = true;
        }
      } else if (seq.kind === 'snapback') {
        if (isReduced()) {
          if (seq.t < 0.28) {
            s.dragging = true;
            s.charge = 0.65;
            syncDraftStatus();
            onCharge(s.charge, s.status);
            moving = true;
          } else {
            s.autoSeq = null;
            releaseDrag();
          }
        } else if (seq.t < 0.34) {
          const p = seq.t / 0.34;
          const ease = 1 - Math.pow(1 - p, 2);
          s.dragging = true;
          s.charge = ease * 0.65;
          syncDraftStatus();
          onCharge(s.charge, s.status);
          moving = true;
        } else {
          s.autoSeq = null;
          releaseDrag();
          moving = true;
        }
      }
    }

    if (s.snapping && s.status !== 'sent') {
      if (isReduced()) {
        s.charge = 0;
        s.chargeVel = 0;
        s.snapping = false;
        s.status = 'draft';
        onCharge(0, 'draft');
      } else {
        // Sub-step critically damped spring at 240 Hz so slow frames stay smooth.
        const stepSize = 1 / 240;
        for (let rem = clampedDt; rem > 1e-6; rem -= stepSize) {
          const h = Math.min(rem, stepSize);
          const acc = -280 * s.charge - 26 * s.chargeVel;
          s.chargeVel += acc * h;
          s.charge += s.chargeVel * h;
        }
        if (s.charge <= 0.003 && Math.abs(s.chargeVel) < 0.04) {
          s.charge = 0;
          s.chargeVel = 0;
          s.snapping = false;
          s.status = 'draft';
        } else {
          s.charge = clamp(s.charge, 0, 1);
          syncDraftStatus();
          moving = true;
        }
        onCharge(s.charge, s.status);
      }
    }

    if (s.waveActive) {
      const dur = isReduced() ? 0.35 : WAVE_DURATION;
      s.waveAge += clampedDt;
      if (s.waveAge >= dur) {
        s.waveActive = false;
        s.waveAge = -1;
      } else {
        moving = true;
      }
    }

    if (s.sentFlash > 0) {
      s.sentFlash = Math.max(0, s.sentFlash - clampedDt / SENT_FLASH_DURATION);
      if (s.sentFlash > 0.002) moving = true;
      else s.sentFlash = 0;
    }

    return moving || s.dragging;
  }

  return { s, setSliderPct, beginDrag, releaseDrag, commit, replayWave, reset, startAuto, step };
}
// #endregion swipe-physics

// #region charge-wave-shader
const SEND_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec4 uCardRect;
uniform vec2 uThumbCss;
uniform vec2 uWaveOriginCss;
uniform vec4 uBadgeRect;
uniform float uCharge;
uniform float uArmed;
uniform float uWaveAge;
uniform float uWaveMaxRadius;
uniform float uSentFlash;
uniform float uSentState;
uniform float uReducedMotion;

in vec2 vUv;
out vec4 outColor;

vec4 sampleCard(vec2 uv, vec2 cardSize) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec2 pxDist = min(uv, 1.0 - uv) * cardSize;
  float edgeAa = smoothstep(0.0, 1.0, min(pxDist.x, pxDist.y));
  return texture(uTex, uv) * edgeAa;
}

vec4 overPremul(vec4 dst, vec3 srcRgb, float srcA) {
  float a = clamp(srcA, 0.0, 1.0);
  return vec4(srcRgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

void main() {
  vec2 pCss = vUv * uCanvasSize;
  vec2 cardSize = max(uCardRect.zw, vec2(1.0));
  float motionScale = 1.0 - step(0.5, uReducedMotion);

  // 1. Pre-commit energy gather beneath the vertical thumb (Swipe to Send).
  vec2 dThumb = pCss - uThumbCss;
  float rThumb = length(dThumb);
  vec2 thumbDir = rThumb > 0.5 ? dThumb / rThumb : vec2(0.0, -1.0);
  float chargeActive = smoothstep(0.008, 0.06, uCharge);
  // Keep UV pull zero directly under the thumb so pointer dragging stays aligned.
  float ringMask = smoothstep(18.0, 44.0, rThumb) * exp(-rThumb / 108.0);
  vec2 chargeWarpPx = -thumbDir * (5.2 * uCharge * uCharge * ringMask) * motionScale;

  // 2. Radial confirmation shockwave with RGB chromatic fringes (Distortion Waves).
  vec2 dispWavePx = vec2(0.0);
  vec2 waveDir = vec2(0.0, -1.0);
  float chromaPx = 0.0;
  float crestAmp = 0.0;
  float dr = 999.0;
  float wp = 0.0;

  if (uWaveAge >= 0.0 && uWaveAge < 1.15) {
    wp = clamp(uWaveAge / 1.15, 0.0, 1.0);
    float easeOut = 1.0 - pow(1.0 - wp, 2.2);
    float waveR = mix(10.0, uWaveMaxRadius * 1.15, easeOut);
    vec2 dWave = pCss - uWaveOriginCss;
    float rWave = length(dWave);
    waveDir = rWave > 0.5 ? dWave / rWave : vec2(0.0, -1.0);
    dr = rWave - waveR;

    float sigma = mix(22.0, 36.0, wp);
    float gauss = exp(-(dr * dr) / (sigma * sigma));
    float radialSin = sin(dr * 0.17);
    float waveFade = smoothstep(0.0, 0.03, wp) * (1.0 - smoothstep(0.56, 1.0, wp));
    crestAmp = gauss * waveFade;

    float dr2 = rWave - (waveR - 38.0);
    float gauss2 = exp(-(dr2 * dr2) / (26.0 * 26.0)) * smoothstep(0.06, 0.18, wp) * (1.0 - smoothstep(0.64, 1.0, wp));

    dispWavePx = waveDir * ((radialSin * gauss * 10.5 - (dr / sigma) * gauss * 5.0) * waveFade + sin(dr2 * 0.22) * gauss2 * 3.6) * motionScale;
    chromaPx = (3.4 * crestAmp + 1.4 * gauss2) * motionScale;
  }

  vec2 totalWarpPx = chargeWarpPx + dispWavePx;
  vec2 baseUv = (pCss + totalWarpPx - uCardRect.xy) / cardSize;
  vec2 chromaUv = (waveDir * chromaPx) / cardSize;

  vec4 cR = sampleCard(baseUv + chromaUv, cardSize);
  vec4 cG = sampleCard(baseUv, cardSize);
  vec4 cB = sampleCard(baseUv - chromaUv, cardSize);

  float alpha = max(cG.a, max(cR.a, cB.a) * 0.85);
  vec3 rgb = min(vec3(cR.r, cG.g, cB.b), vec3(alpha));
  vec4 outCol = vec4(rgb, alpha);

  // Rounded-box SDF for bleed glow and card perimeter warming.
  vec2 cardHalf = cardSize * 0.5;
  vec2 q = abs(pCss - (uCardRect.xy + cardHalf)) - (cardHalf - vec2(16.0));
  float cardSdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 16.0;
  float bleedMask = 1.0 - smoothstep(0.0, 12.0, cardSdf);
  float borderRim = exp(-abs(cardSdf) / 5.5);

  // Warm coral -> electric mint/cyan energy color transition.
  vec3 warmGlow = vec3(1.0, 0.48, 0.26);
  vec3 readyGlow = vec3(0.20, 0.90, 0.68);
  vec3 energyRgb = mix(warmGlow, readyGlow, uArmed);

  if (chargeActive > 0.002 && uSentState < 0.5) {
    float colGlow = exp(-abs(pCss.x - uThumbCss.x) / 28.0) * smoothstep(uCardRect.y + cardSize.y, uThumbCss.y - 24.0, pCss.y);
    float thumbHalo = exp(-rThumb / (26.0 + 36.0 * uCharge));
    float caustic = exp(-pow((rThumb - (20.0 + 10.0 * uCharge)) / 7.5, 2.0)) * (0.78 + 0.22 * sin(uTime * 6.0 * motionScale - rThumb * 0.14));
    float energyInt = (thumbHalo * 0.26 + caustic * 0.34 + colGlow * 0.14) * uCharge * chargeActive * bleedMask;
    outCol = overPremul(outCol, energyRgb, energyInt);

    float edgeWarm = borderRim * (0.18 + 0.45 * uArmed) * uCharge * chargeActive * bleedMask;
    outCol = overPremul(outCol, energyRgb, edgeWarm);
  }

  // Shockwave luminous crest + subtle mint/gold confirmation shimmer.
  if (crestAmp > 0.002) {
    vec3 crestRgb = mix(vec3(0.22, 0.92, 0.72), vec3(0.98, 0.78, 0.26), smoothstep(-10.0, 14.0, dr));
    float crestAlpha = crestAmp * mix(0.42, 0.34, outCol.a) * bleedMask * (0.35 + 0.65 * motionScale);
    outCol = overPremul(outCol, crestRgb, crestAlpha);
  }

  if (uSentState > 0.5 || uSentFlash > 0.002) {
    vec2 bCenter = uBadgeRect.xy + uBadgeRect.zw * 0.5;
    vec2 bHalf = max(uBadgeRect.zw * 0.5, vec2(1.0));
    vec2 bDist = max(abs(pCss - bCenter) - bHalf, vec2(0.0));
    float badgeHalo = exp(-length(bDist) / 14.0);
    float sweepPos = mix(-0.3, 1.3, 1.0 - uSentFlash);
    float diag = ((pCss.x - uCardRect.x) / cardSize.x) * 0.65 + ((pCss.y - uCardRect.y) / cardSize.y) * 0.35;
    float shimmerBand = exp(-pow((diag - sweepPos) / 0.14, 2.0)) * uSentFlash * outCol.a;
    vec3 shimmerRgb = mix(vec3(0.22, 0.92, 0.66), vec3(0.98, 0.80, 0.30), 0.42);
    outCol = overPremul(outCol, shimmerRgb, shimmerBand * 0.30 + badgeHalo * uSentFlash * 0.28);

    float settledRim = borderRim * (0.14 + 0.34 * uSentFlash) * bleedMask;
    outCol = overPremul(outCol, vec3(0.20, 0.88, 0.62), settledRim);
  }

  outColor = outCol;
}`;
// #endregion charge-wave-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('send-stage');
const cardViewport = document.getElementById('card-viewport');
const canvas = document.getElementById('send-canvas');
const cardEl = document.getElementById('pay-card');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('stage-notice');
const hudEl = document.getElementById('stage-hud');
const testsBody = document.getElementById('tests');

const recipientInput = document.getElementById('recipient-input');
const amountInput = document.getElementById('amount-input');
const currencyPrefixEl = document.getElementById('currency-prefix');
const currencyChipBtn = document.getElementById('currency-chip');
const subtotalEl = document.getElementById('rcpt-subtotal');
const feeEl = document.getElementById('rcpt-fee');
const settlementEl = document.getElementById('rcpt-settlement');
const totalEl = document.getElementById('rcpt-total');
const statusBadgeEl = document.getElementById('status-badge');
const confirmBtn = document.getElementById('confirm-btn');
const resetBtn = document.getElementById('reset-btn');
const sliderLaneEl = document.getElementById('slider-lane');
const sliderTargetEl = document.getElementById('slider-target');
const paySlider = document.getElementById('pay-slider');
const sliderPctEl = document.getElementById('slider-pct');

const demoSwipeBtn = document.getElementById('btn-demo-swipe');
const partialDemoBtn = document.getElementById('btn-partial-demo');
const reducedCheck = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

// ---------------------------------------------------------------- Receipt & DOM state
let currencyIndex = 0;
let stage = null;
let ctx2d = null;
let backend = 'none';
let hasPainted = false;
let textureDirty = true;
let rafId = 0;
let lastFrameTime = 0;
let isVisible = true;
let lostTimer = 0;
let lastGeoSig = '';
let pointerDragging = false;
let lastUiSig = '';

function currentCurrency() {
  return CURRENCIES[currencyIndex % CURRENCIES.length];
}

function parsedAmount() {
  const raw = Number.parseFloat(amountInput.value);
  if (!Number.isFinite(raw) || raw <= 0) return 48.0;
  return clamp(raw, 1, 9999);
}

function formatMoney(val) {
  return `${currentCurrency().symbol}${val.toFixed(2)}`;
}

function updateReceiptDom() {
  const cur = currentCurrency();
  const amt = parsedAmount();
  const fee = Math.max(0.25, Math.round(amt * 0.01 * 100) / 100);
  const total = amt + fee;

  currencyPrefixEl.textContent = cur.symbol;
  currencyChipBtn.textContent = cur.code;
  currencyChipBtn.setAttribute('aria-label', `Currency ${cur.code}, tap to switch`);

  subtotalEl.textContent = `${cur.symbol}${amt.toFixed(2)}`;
  feeEl.textContent = `${cur.symbol}${fee.toFixed(2)}`;
  totalEl.textContent = `${cur.symbol}${total.toFixed(2)}`;

  if (state.status === 'sent') {
    settlementEl.textContent = 'Settled';
    confirmBtn.textContent = 'Replay wave';
    confirmBtn.dataset.sent = 'true';
  } else {
    settlementEl.textContent = '~1.2 s';
    confirmBtn.textContent = `Confirm ${cur.symbol}${total.toFixed(2)}`;
    confirmBtn.dataset.sent = 'false';
  }
}

function syncCardUi() {
  const pct = Math.round(state.charge * 100);
  const sig = `${pct}:${state.status}`;
  if (!pointerDragging && Number(paySlider.value) !== pct) {
    paySlider.value = String(pct);
  }
  if (sig === lastUiSig) return;
  lastUiSig = sig;
  sliderLaneEl.style.setProperty('--charge', state.charge.toFixed(3));
  sliderLaneEl.style.setProperty('--armed', state.status === 'armed' || state.status === 'sent' ? '1' : '0');
  sliderLaneEl.dataset.armed = String(state.status === 'armed');
  sliderLaneEl.dataset.sent = String(state.status === 'sent');
  sliderPctEl.textContent = `${pct}%`;
  sliderTargetEl.textContent = state.status === 'sent' ? 'SENT ✓' : state.status === 'armed' ? 'RELEASE' : 'SEND ↑';

  let label = 'Draft';
  if (state.status === 'charging') label = `Charging ${pct}%`;
  else if (state.status === 'armed') label = 'Release to send';
  else if (state.status === 'sent') label = 'Sent';

  statusBadgeEl.textContent = label;
  statusBadgeEl.dataset.state = state.status;
  paySlider.disabled = state.status === 'sent';
  updateReceiptDom();
  textureDirty = true;
  canvas.requestPaint?.();
}

const payCtrl = createPaymentState({
  isReduced,
  onCharge: () => {
    syncCardUi();
  },
  onCommit: () => {
    syncCardUi();
  },
  onReset: () => {
    syncCardUi();
  },
});
const state = payCtrl.s;

function markTextureDirty() {
  textureDirty = true;
  canvas.requestPaint?.();
  scheduleLoop();
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
  showNotice('');
  markTextureDirty();
}

function localBoxInCard(el) {
  let x = 0;
  let y = 0;
  let cur = el;
  while (cur && cur !== cardEl) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function currentMetrics(cw, ch) {
  const cardW = cardEl.offsetWidth || Math.max(1, cw - 24);
  const cardH = cardEl.offsetHeight || Math.max(1, ch - 24);
  const padX = Math.round((cw - cardW) * 0.5);
  const padY = Math.round((ch - cardH) * 0.5);

  const sliderBox = localBoxInCard(paySlider);
  const thumbRadius = 19;
  const travel = Math.max(1, sliderBox.h - thumbRadius * 2);
  const thumbX = padX + sliderBox.x + sliderBox.w * 0.5;
  const thumbY = padY + sliderBox.y + (sliderBox.h - thumbRadius) - state.charge * travel;

  const btnBox = localBoxInCard(confirmBtn);
  const badgeBox = localBoxInCard(statusBadgeEl);

  const origin = state.waveOriginMode === 'button'
    ? { x: padX + btnBox.x + btnBox.w * 0.5, y: padY + btnBox.y + btnBox.h * 0.5 }
    : { x: thumbX, y: padY + sliderBox.y + thumbRadius };

  const corners = [
    [padX, padY],
    [padX + cardW, padY],
    [padX, padY + cardH],
    [padX + cardW, padY + cardH],
  ];
  let maxR = 200;
  for (const [cx, cy] of corners) {
    maxR = Math.max(maxR, Math.hypot(cx - origin.x, cy - origin.y));
  }

  return {
    padX,
    padY,
    cardW,
    cardH,
    thumbX,
    thumbY,
    origin,
    maxR,
    badgeRect: [padX + badgeBox.x, padY + badgeBox.y, badgeBox.w, badgeBox.h],
  };
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend !== 'webgl' || !hasPainted) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const cardW = cardEl.offsetWidth;
  const cardH = cardEl.offsetHeight;
  if (!cw || !ch || !cardW || !cardH) return;

  const padX = Math.round((cw - cardW) * 0.5);
  const padY = Math.round((ch - cardH) * 0.5);
  const unit = geometryUnit(canvas, cardEl, cardW);
  const sig = `${unit.toFixed(4)}:${padX}:${padY}:${cw}:${ch}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const cssMat = new DOMMatrix().translate(padX, padY);
  const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
  canvas.updateElementGeometry?.(cardEl, { canvasTransform: scaled });
  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function updateHud() {
  const routeName = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  const pct = Math.round(state.charge * 100);
  const waveText = state.waveActive
    ? `${Math.round((state.waveAge / (isReduced() ? 0.35 : WAVE_DURATION)) * 100)}%`
    : 'idle';
  hudEl.textContent =
    `Route: ${routeName} · Status: ${state.status} · Charge: ${pct}% (commit >= ${COMMIT_THRESHOLD}%) · ` +
    `Wave: ${waveText} · Sent: ${state.commitCount}`;
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
  ctx2d.clearRect(0, 0, cw, ch);

  const m = currentMetrics(cw, ch);

  if (state.charge > 0.01 && state.status !== 'sent') {
    const grad = ctx2d.createRadialGradient(m.thumbX, m.thumbY, 4, m.thumbX, m.thumbY, 96);
    const tone = state.status === 'armed' ? '45, 212, 191' : '255, 122, 77';
    grad.addColorStop(0, `rgba(${tone}, ${0.5 * state.charge})`);
    grad.addColorStop(1, `rgba(${tone}, 0)`);
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, cw, ch);
  }

  ctx2d.drawElementImage(cardEl, m.padX, m.padY, m.cardW, m.cardH);

  if (state.waveActive && state.waveAge >= 0) {
    const dur = isReduced() ? 0.35 : WAVE_DURATION;
    const wp = clamp(state.waveAge / dur, 0, 1);
    const radius = mix(10, m.maxR * 1.1, 1 - Math.pow(1 - wp, 2.2));
    const fade = Math.max(0, 1 - wp);
    ctx2d.save();
    ctx2d.lineWidth = 3;
    ctx2d.strokeStyle = `rgba(34, 211, 238, ${fade * 0.55})`;
    ctx2d.beginPath();
    ctx2d.arc(m.origin.x, m.origin.y, radius + 3, 0, Math.PI * 2);
    ctx2d.stroke();

    ctx2d.strokeStyle = `rgba(255, 122, 77, ${fade * 0.45})`;
    ctx2d.beginPath();
    ctx2d.arc(m.origin.x, m.origin.y, Math.max(1, radius - 3), 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.restore();
  }
}
// #endregion fallback-2d

function drawFrame() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch || !hasPainted) return;

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (textureDirty || !stage.has(cardEl)) {
        stage.upload(cardEl);
        textureDirty = false;
      }
      const m = currentMetrics(cw, ch);
      stage.quad(cardEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.uniform2f(loc('uCanvasSize'), cw, ch);
        gl.uniform4f(loc('uCardRect'), m.padX, m.padY, m.cardW, m.cardH);
        gl.uniform2f(loc('uThumbCss'), m.thumbX, m.thumbY);
        gl.uniform2f(loc('uWaveOriginCss'), m.origin.x, m.origin.y);
        gl.uniform4f(loc('uBadgeRect'), m.badgeRect[0], m.badgeRect[1], m.badgeRect[2], m.badgeRect[3]);
        gl.uniform1f(loc('uCharge'), state.charge);
        gl.uniform1f(loc('uArmed'), state.status === 'armed' ? 1 : 0);
        gl.uniform1f(loc('uWaveAge'), state.waveActive ? state.waveAge : -1);
        gl.uniform1f(loc('uWaveMaxRadius'), m.maxR);
        gl.uniform1f(loc('uSentFlash'), state.sentFlash);
        gl.uniform1f(loc('uSentState'), state.status === 'sent' ? 1 : 0);
        gl.uniform1f(loc('uReducedMotion'), isReduced() ? 1 : 0);
      });
      syncGeometry();
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

  const stillAnimating = payCtrl.step(dt);
  drawFrame();

  if (stillAnimating) {
    rafId = requestAnimationFrame(tick);
  } else {
    lastFrameTime = 0;
  }
}

function scheduleLoop() {
  if (!isVisible || backend === 'plain' || backend === 'none') return;
  const active = state.dragging || state.snapping || state.waveActive || state.sentFlash > 0 || state.autoSeq !== null;
  if (active && !rafId) {
    rafId = requestAnimationFrame(tick);
  } else if (!rafId && hasPainted) {
    drawFrame();
  }
}

// ---------------------------------------------------------------- Live DOM control wiring
recipientInput.addEventListener('input', () => {
  markTextureDirty();
});

amountInput.addEventListener('input', () => {
  updateReceiptDom();
  markTextureDirty();
});

currencyChipBtn.addEventListener('click', () => {
  currencyIndex = (currencyIndex + 1) % CURRENCIES.length;
  updateReceiptDom();
  markTextureDirty();
});

confirmBtn.addEventListener('click', () => {
  if (state.status === 'sent') {
    payCtrl.replayWave('button');
  } else {
    payCtrl.commit('button');
  }
  syncCardUi();
  scheduleLoop();
});

resetBtn.addEventListener('click', () => {
  payCtrl.reset();
});

paySlider.addEventListener('pointerdown', (e) => {
  if (state.status === 'sent') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointerDragging = true;
  payCtrl.beginDrag();
  scheduleLoop();
});

paySlider.addEventListener('touchstart', () => {
  if (state.status === 'sent') return;
  pointerDragging = true;
  payCtrl.beginDrag();
  scheduleLoop();
}, { passive: true });

paySlider.addEventListener('input', () => {
  if (state.status === 'sent') return;
  const val = Number(paySlider.value);
  payCtrl.setSliderPct(val);
  // Keyboard users reach >= 92 without a pointerup event; commit cleanly on reaching 92+.
  if (!state.dragging && val >= COMMIT_THRESHOLD) {
    payCtrl.commit('slider');
    syncCardUi();
  }
  scheduleLoop();
});

function finishSliderGesture() {
  pointerDragging = false;
  if (!state.dragging) return;
  payCtrl.releaseDrag();
  syncCardUi();
  scheduleLoop();
}

window.addEventListener('pointerup', finishSliderGesture);
window.addEventListener('pointercancel', finishSliderGesture);
window.addEventListener('touchend', finishSliderGesture, { passive: true });
window.addEventListener('touchcancel', finishSliderGesture, { passive: true });

demoSwipeBtn.addEventListener('click', () => {
  if (backend === 'plain') {
    payCtrl.commit('slider');
    syncCardUi();
    return;
  }
  payCtrl.startAuto('commit');
  scheduleLoop();
});

partialDemoBtn.addEventListener('click', () => {
  if (backend === 'plain') {
    payCtrl.setSliderPct(65);
    payCtrl.releaseDrag();
    syncCardUi();
    return;
  }
  payCtrl.startAuto('snapback');
  scheduleLoop();
});

reducedCheck.addEventListener('change', () => {
  if (isReduced() && state.snapping) {
    payCtrl.releaseDrag();
  }
  markTextureDirty();
});

// ---------------------------------------------------------------- Backend startup & visibility
function startBackend() {
  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available here, so the payment receipt card is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    hasPainted = true;
    textureDirty = true;
    if (!rafId && isVisible) drawFrame();
  });

  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: SEND_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so the payment card moved to plain HTML.');
            }
          }, 1200);
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
      switchToPlain('Canvas rendering is unavailable here, so the payment card is shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so the payment card moved to plain HTML.');
        }
      }, 1200);
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
      markTextureDirty();
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }, { threshold: 0.01 });
  io.observe(cardViewport);
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    lastGeoSig = '';
    textureDirty = true;
    scheduleLoop();
  });
  ro.observe(cardViewport);
}

syncCardUi();
startBackend();
updateHud();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, msg) => { if (!ok) throw new Error(msg); return msg; };

function buildFixtureCard(cw = 280, ch = 220, pad = 12) {
  const card = document.createElement('section');
  card.setAttribute('drawable', '');
  card.style.cssText =
    `position:absolute;left:${pad}px;top:${pad}px;width:${cw - pad * 2}px;height:${ch - pad * 2}px;` +
    'box-sizing:border-box;padding:12px;border-radius:14px;background:#0f172a;color:#f8fafc;' +
    'font:13px/1.3 system-ui,sans-serif;display:flex;flex-direction:column;justify-content:space-between;gap:8px;';

  const dl = document.createElement('dl');
  dl.style.cssText = 'margin:0;padding:8px;border-radius:8px;background:#1e293b;display:grid;grid-template-columns:1fr auto;gap:4px 12px;';
  const dt = document.createElement('dt');
  dt.textContent = 'Total';
  const dd = document.createElement('dd');
  dd.textContent = '£48.48';
  dd.style.cssText = 'margin:0;font:700 15px monospace;color:#ffffff;';
  dl.append(dt, dd);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.value = '48.00';
  amount.style.cssText = 'width:92px;height:38px;box-sizing:border-box;border:1px solid #334155;border-radius:6px;background:#090e1a;color:#fff;padding:4px 8px;';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '50';
  slider.style.cssText = 'writing-mode:vertical-lr;direction:rtl;width:36px;height:80px;margin:0;touch-action:none;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Confirm';
  btn.style.cssText = 'height:38px;padding:0 12px;border-radius:6px;border:0;background:#d2491f;color:#fff;font-weight:700;';
  row.append(amount, slider, btn);

  card.append(dl, row);
  return { card, dl, amount, slider, btn };
}

const checks = [
  {
    name: 'ElementGL renders semantic <dl> receipt and radial shockwave pass with gl.getError() === 0',
    why: 'Mounts an isolated ElementGL canvas on testStage(), uploads a live <dl> receipt card via texElementSubImage2D(), draws at rest and mid-wave, and verifies gl.getError() === 0 plus pixel displacement.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 280;
      const ch = 220;
      const pad = 12;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `display:block;width:${cw}px;height:${ch}px;position:relative`;
      const { card } = buildFixtureCard(cw, ch, pad);
      cv.append(card);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SEND_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        const uploaded = g.upload(card);

        const drawSample = (waveAge) => {
          g.begin([0, 0, 0, 0]);
          g.quad(card, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform4f(loc('uCardRect'), pad, pad, cw - pad * 2, ch - pad * 2);
            gl.uniform2f(loc('uThumbCss'), cw - 40, ch * 0.5);
            gl.uniform2f(loc('uWaveOriginCss'), cw * 0.65, ch * 0.72);
            gl.uniform4f(loc('uBadgeRect'), cw - 70, 20, 48, 22);
            gl.uniform1f(loc('uCharge'), waveAge >= 0 ? 1 : 0);
            gl.uniform1f(loc('uArmed'), 0);
            gl.uniform1f(loc('uWaveAge'), waveAge);
            gl.uniform1f(loc('uWaveMaxRadius'), 240);
            gl.uniform1f(loc('uSentFlash'), waveAge >= 0 ? 0.8 : 0);
            gl.uniform1f(loc('uSentState'), waveAge >= 0 ? 1 : 0);
            gl.uniform1f(loc('uReducedMotion'), 0);
          });
          const err = g.gl.getError();
          const buf = new Uint8Array(cv.width * cv.height * 4);
          g.gl.readPixels(0, 0, cv.width, cv.height, g.gl.RGBA, g.gl.UNSIGNED_BYTE, buf);
          return { err, buf };
        };

        const rest = drawSample(-1);
        const wave = drawSample(0.22);
        let diffSum = 0;
        const pxCount = Math.min(rest.buf.length, wave.buf.length) / 4;
        for (let i = 0; i < pxCount * 4; i += 4) {
          diffSum += Math.abs(rest.buf[i] - wave.buf[i])
            + Math.abs(rest.buf[i + 1] - wave.buf[i + 1])
            + Math.abs(rest.buf[i + 2] - wave.buf[i + 2]);
        }
        const meanDiff = diffSum / Math.max(1, pxCount);
        return need(
          rest.err === g.gl.NO_ERROR && wave.err === g.gl.NO_ERROR && uploaded && meanDiff > 3,
          `gl.getError()=${wave.err}, uploaded ${uploaded?.w}x${uploaded?.h}, rest vs wave delta ${meanDiff.toFixed(1)}/px.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Shockwave ring produces measurable RGB chromatic edge separation (readPixels max |R - B|)',
    why: 'Renders a high-contrast dark card with crisp white text and stripes under the active shockwave crest, then reads back pixels to verify channel dispersion |R - B| increases on the wave crest compared with rest.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 260;
      const ch = 180;
      const pad = 10;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `display:block;width:${cw}px;height:${ch}px;position:relative`;

      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText =
        `position:absolute;left:${pad}px;top:${pad}px;width:${cw - pad * 2}px;height:${ch - pad * 2}px;` +
        'background:#0b111e;color:#ffffff;padding:14px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:12px;';
      for (let i = 0; i < 4; i++) {
        const stripe = document.createElement('div');
        stripe.textContent = '£48.48 · RECEIPT LINE';
        stripe.style.cssText = 'font:800 15px/1.1 monospace;color:#ffffff;background:#0b111e;border-top:2px solid #ffffff;padding-top:4px;';
        card.append(stripe);
      }
      cv.append(card);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SEND_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.upload(card);

        const sampleMaxRB = (waveAge) => {
          g.begin([0, 0, 0, 0]);
          g.quad(card, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform4f(loc('uCardRect'), pad, pad, cw - pad * 2, ch - pad * 2);
            gl.uniform2f(loc('uThumbCss'), cw - 30, ch * 0.5);
            gl.uniform2f(loc('uWaveOriginCss'), cw * 0.5, ch * 0.8);
            gl.uniform4f(loc('uBadgeRect'), 20, 20, 40, 20);
            gl.uniform1f(loc('uCharge'), 0);
            gl.uniform1f(loc('uArmed'), 0);
            gl.uniform1f(loc('uWaveAge'), waveAge);
            gl.uniform1f(loc('uWaveMaxRadius'), 210);
            gl.uniform1f(loc('uSentFlash'), 0);
            gl.uniform1f(loc('uSentState'), 0);
            gl.uniform1f(loc('uReducedMotion'), 0);
          });
          const buf = new Uint8Array(cv.width * cv.height * 4);
          g.gl.readPixels(0, 0, cv.width, cv.height, g.gl.RGBA, g.gl.UNSIGNED_BYTE, buf);
          let maxRB = 0;
          for (let i = 0; i < buf.length; i += 4) {
            if (buf[i + 3] < 200) continue;
            const d = Math.abs(buf[i] - buf[i + 2]);
            if (d > maxRB) maxRB = d;
          }
          return maxRB;
        };

        const restRB = sampleMaxRB(-1);
        const crestRB = sampleMaxRB(0.20);
        return need(
          crestRB > 40 && crestRB > restRB + 30,
          `rest max |R-B|=${restRB}, wave crest max |R-B|=${crestRB}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Slider snaps back via spring on partial release (< 92%) and commits + launches wave at >= 92%',
    why: 'Drives createPaymentState() to 65% and releases to verify spring return to Draft with no wave, then drags to 94% and releases to verify Sent status and full wave progression, plus instant settle under reduced motion.',
    run: async () => {
      let commits = 0;
      let reduced = false;
      const ctrl = createPaymentState({
        isReduced: () => reduced,
        onCommit: () => { commits += 1; },
      });

      // Partial drag: 65% -> release -> spring snapback to 0 without wave.
      ctrl.beginDrag();
      ctrl.setSliderPct(65);
      const committedPartial = ctrl.releaseDrag();
      const snappingStarted = ctrl.s.snapping && !ctrl.s.waveActive && ctrl.s.status === 'charging';
      for (let i = 0; i < 90; i++) ctrl.step(1 / 60);
      const settledDraft = ctrl.s.charge < 0.005 && ctrl.s.status === 'draft' && commits === 0;

      // Full drag: 94% (>= 92%) -> release -> commit + wave launch.
      ctrl.beginDrag();
      ctrl.setSliderPct(94);
      const committedFull = ctrl.releaseDrag();
      const waveLaunched = ctrl.s.status === 'sent' && ctrl.s.waveActive && ctrl.s.waveAge === 0;
      for (let i = 0; i < 90; i++) ctrl.step(1 / 60);
      const waveFinished = !ctrl.s.waveActive && ctrl.s.status === 'sent' && commits === 1;

      // Reduced motion partial release settles immediately with zero spring steps.
      ctrl.reset();
      reduced = true;
      ctrl.beginDrag();
      ctrl.setSliderPct(65);
      ctrl.releaseDrag();
      const reducedInstant = ctrl.s.charge === 0 && !ctrl.s.snapping && ctrl.s.status === 'draft';

      return need(
        !committedPartial && snappingStarted && settledDraft && committedFull && waveLaunched && waveFinished && reducedInstant,
        `65% release snapped to charge=${ctrl.s.charge.toFixed(3)} (draft); 94% committed (commits=${commits}, wave completed); reduced-motion instant settle=${reducedInstant}.`
      );
    },
  },
  {
    name: 'updateElementGeometry() lands document.elementsFromPoint() on live <input> and <button> inside canvas',
    why: 'Mounts a bleed-offset ElementGL fixture card on testStage(), syncs updateElementGeometry() scaled by geometryUnit(), and checks elementsFromPoint() hits the live number input, range slider and Confirm button.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 280;
      const ch = 220;
      const pad = 12;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `display:block;width:${cw}px;height:${ch}px;position:relative`;
      const { card, amount, slider, btn } = buildFixtureCard(cw, ch, pad);
      cv.append(card);
      testStage().append(cv);

      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: SEND_FRAG });
          g.begin([0, 0, 0, 0]);
        }
        await nextPaint(cv);
        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(card);
          g.quad(card, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform4f(loc('uCardRect'), pad, pad, cw - pad * 2, ch - pad * 2);
            gl.uniform2f(loc('uThumbCss'), cw - 40, ch * 0.5);
            gl.uniform2f(loc('uWaveOriginCss'), cw * 0.5, ch * 0.5);
            gl.uniform4f(loc('uBadgeRect'), 20, 20, 40, 20);
            gl.uniform1f(loc('uCharge'), 0);
            gl.uniform1f(loc('uArmed'), 0);
            gl.uniform1f(loc('uWaveAge'), -1);
            gl.uniform1f(loc('uWaveMaxRadius'), 240);
            gl.uniform1f(loc('uSentFlash'), 0);
            gl.uniform1f(loc('uSentState'), 0);
            gl.uniform1f(loc('uReducedMotion'), 1);
          });
        }

        const unit = geometryUnit(cv, card, card.offsetWidth);
        const scaled = new DOMMatrix().scale(unit, unit, 1).translate(pad, pad);
        cv.updateElementGeometry(card, { canvasTransform: scaled });
        card.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const hitCenter = (el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width * 0.5;
          const y = r.top + r.height * 0.5;
          return { x, y, hits: document.elementsFromPoint(x, y) };
        };

        const hitAmt = hitCenter(amount);
        const hitSlider = hitCenter(slider);
        const hitBtn = hitCenter(btn);
        const ok = hitAmt.hits.includes(amount) && hitSlider.hits.includes(slider) && hitBtn.hits.includes(btn);

        return need(
          ok,
          `elementsFromPoint() hit amount=${hitAmt.hits.includes(amount)}, range=${hitSlider.hits.includes(slider)}, button=${hitBtn.hits.includes(btn)} (geometryUnit=${unit.toFixed(3)}).`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'Payment receipt canvas',
      note: 'plain HTML',
      ink: async () => {
        if (backend === 'plain') return null;
        if (!canvas.width || !canvas.height) return 0;
        drawFrame();
        const probe = document.createElement('canvas');
        probe.width = Math.min(canvas.width, 220);
        probe.height = Math.min(canvas.height, 240);
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
        const frac = inkFraction(pctx);
        window.__gfx?.retire?.(probe);
        return frac;
      },
      rescue: () => switchToPlain('Canvas drew blank after live checks, so the card moved to plain HTML.'),
    },
  ]),
];

if (testsBody) runTests(testsBody, checks);
