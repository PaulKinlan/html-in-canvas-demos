import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const DETENTS = {
  peek: 0.18,
  half: 0.52,
  full: 0.90,
};

const DETENT_LIST = [
  { key: 'peek', frac: DETENTS.peek },
  { key: 'half', frac: DETENTS.half },
  { key: 'full', frac: DETENTS.full },
];

const PLACES = [
  { id: 'ferry-coffee', name: 'Ferry Coffee', cat: 'coffee', badge: 'C', walk: '3 min walk · 0.2 km', detail: '★ 4.8 · Roasted single-origin by Pier 3', hasPin: true },
  { id: 'civic-hall', name: 'Civic Green', cat: 'parks', badge: 'P', walk: '4 min walk · 0.3 km', detail: '★ 4.7 · Shaded plaza & fountain lawn', hasPin: true },
  { id: 'botanic-pier', name: 'Botanic Pier', cat: 'parks', badge: 'P', walk: '6 min walk · 0.5 km', detail: '★ 4.9 · Native coastal boardwalk', hasPin: true },
  { id: 'central-hub', name: 'Central Hub', cat: 'transit', badge: 'T', walk: '7 min walk · 0.6 km', detail: '★ 4.5 · Ferries, tram & bay rail', hasPin: true },
  { id: 'harbour-market', name: 'Harbour Market', cat: 'food', badge: 'F', walk: '9 min walk · 0.7 km', detail: '★ 4.8 · Dumplings, tacos & oyster bar', hasPin: true },
  { id: 'quay-roasters', name: 'Quay Roasters', cat: 'coffee', badge: 'C', walk: '5 min walk · 0.4 km', detail: '★ 4.6 · Pour-over bar & warm focaccia', hasPin: false },
  { id: 'pier-ramen', name: 'Pier 4 Ramen & Broth', cat: 'food', badge: 'F', walk: '8 min walk · 0.6 km', detail: '★ 4.7 · Yuzu shio bowls until 22:00', hasPin: false },
  { id: 'tidal-terrace', name: 'Tidal Terrace', cat: 'parks', badge: 'P', walk: '10 min walk · 0.8 km', detail: '★ 4.8 · Seawall benches & tide pools', hasPin: false },
  { id: 'embarcadero-tram', name: 'Embarcadero Stop F', cat: 'transit', badge: 'T', walk: '2 min walk · 0.1 km', detail: '★ 4.4 · Heritage streetcar every 6 min', hasPin: false },
  { id: 'lantern-espresso', name: 'Lantern Espresso', cat: 'coffee', badge: 'C', walk: '6 min walk · 0.5 km', detail: '★ 4.9 · Cardamom buns & oat flat white', hasPin: false },
  { id: 'beacon-dock', name: 'Beacon Ferry Dock', cat: 'transit', badge: 'T', walk: '11 min walk · 0.9 km', detail: '★ 4.6 · Catamaran departures at Gate B', hasPin: false },
  { id: 'seawall-kitchen', name: 'Seawall Smokehouse', cat: 'food', badge: 'F', walk: '12 min walk · 1.0 km', detail: '★ 4.5 · Sourdough & wood-fired fish', hasPin: false },
];

// #region sheet-shader
export const SHEET_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uBgTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec4 uBgRect;
uniform vec4 uSheetRect;
uniform float uDepth;
uniform float uCornerRadius;
uniform float uHeaderHeight;
uniform vec2 uPointer;
uniform float uPointerActive;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdTopSheet(vec2 localPx, vec2 size, float r) {
  vec2 extHalf = vec2(size.x * 0.5, (size.y + r) * 0.5);
  vec2 extCenter = vec2(size.x * 0.5, (size.y + r) * 0.5);
  return sdRoundBox(localPx - extCenter, extHalf, r);
}

vec2 sdTopGrad(vec2 localPx, vec2 size, float r) {
  float e = 0.75;
  vec2 g = vec2(
    sdTopSheet(localPx + vec2(e, 0.0), size, r) - sdTopSheet(localPx - vec2(e, 0.0), size, r),
    sdTopSheet(localPx + vec2(0.0, e), size, r) - sdTopSheet(localPx - vec2(0.0, e), size, r)
  );
  float len = length(g);
  return len > 1e-4 ? g / len : vec2(0.0, -1.0);
}

vec2 snellOffset(vec3 N, float ior, float thickness) {
  vec3 I = vec3(0.0, 0.0, -1.0);
  float eta = 1.0 / max(ior, 1.0001);
  vec3 T = refract(I, N, eta);
  if (length(T) < 1e-4) T = I;
  return (T.xy / max(-T.z, 0.25)) * thickness;
}

vec2 toBgUv(vec2 canvasPx) {
  return clamp((canvasPx - uBgRect.xy) / max(uBgRect.zw, vec2(1.0)), vec2(0.002), vec2(0.998));
}

vec3 sampleBlurredRefracted(vec2 canvasPx, vec2 offR, vec2 offG, vec2 offB, float blurPx) {
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int iy = -1; iy <= 1; iy++) {
    for (int ix = -1; ix <= 1; ix++) {
      vec2 tap = vec2(float(ix), float(iy)) * blurPx;
      float w = (ix == 0 && iy == 0) ? 0.25 : (ix == 0 || iy == 0) ? 0.125 : 0.0625;
      float r = texture(uBgTex, toBgUv(canvasPx + offR + tap)).r;
      float g = texture(uBgTex, toBgUv(canvasPx + offG + tap)).g;
      float b = texture(uBgTex, toBgUv(canvasPx + offB + tap)).b;
      acc += vec3(r, g, b) * w;
      wSum += w;
    }
  }
  return acc / max(wSum, 0.001);
}

void main() {
  if (uPass == 0) {
    vec2 pCss = vUv * uCanvasSize;
    vec2 bgCenter = uBgRect.xy + uBgRect.zw * 0.5;
    vec2 bgHalf = uBgRect.zw * 0.5;
    float bgR = mix(0.0, 14.0, smoothstep(0.02, 0.25, uDepth));
    float dBg = sdRoundBox(pCss - bgCenter, bgHalf, bgR);
    float bgMask = 1.0 - smoothstep(-0.85, 0.85, dBg);

    vec3 bezel = vec3(0.055, 0.065, 0.085);
    vec2 bgUv = (pCss - uBgRect.xy) / max(uBgRect.zw, vec2(1.0));
    vec4 bgSample = texture(uTex, clamp(bgUv, vec2(0.001), vec2(0.999)));
    vec3 bgRgb = bgSample.a > 0.002 ? clamp(bgSample.rgb / bgSample.a, 0.0, 1.0) : vec3(0.92, 0.90, 0.85);

    // Progressive backdrop dimming as the sheet rises toward Full.
    float dim = mix(1.0, 0.72, uDepth);
    bgRgb *= dim;

    // Ambient shadow cast upward onto the backdrop along the sheet's rounded top edge.
    float dSheet = sdTopSheet(pCss - uSheetRect.xy, max(uSheetRect.zw, vec2(1.0)), max(uCornerRadius, 2.0));
    if (dSheet > 0.0) {
      float shadow = exp(-dSheet / mix(11.0, 22.0, uDepth)) * mix(0.20, 0.36, uDepth);
      bgRgb *= (1.0 - shadow);
    }

    // Subtle light bevel on the receding map card edge.
    float cardRim = smoothstep(1.8, 0.0, abs(dBg)) * smoothstep(0.05, 0.35, uDepth);
    bgRgb += vec3(0.22, 0.24, 0.28) * cardRim;

    outColor = vec4(mix(bezel, bgRgb, bgMask), 1.0);
    return;
  }

  vec2 sheetSize = max(uSheetRect.zw, vec2(1.0));
  vec2 localPx = vUv * sheetSize;
  vec2 pCss = uSheetRect.xy + localPx;
  float r = clamp(uCornerRadius, 2.0, min(sheetSize.x, sheetSize.y) * 0.45);

  float d = sdTopSheet(localPx, sheetSize, r);
  float mask = 1.0 - smoothstep(-0.85, 0.85, d);
  if (mask <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  float distIn = max(-d, 0.0);
  float bevelW = 24.0;
  float bevelT = clamp(distIn / bevelW, 0.0, 1.0);
  float edgeFactor = 1.0 - bevelT;

  vec2 edgeDir = sdTopGrad(localPx, sheetSize, r);
  float lipWeight = exp(-localPx.y / 26.0);
  float slope = (edgeFactor * edgeFactor * 1.40 + edgeFactor * 0.55) * (0.42 + 0.58 * lipWeight);
  vec3 N = normalize(vec3(edgeDir * slope, 1.0));

  float headerFrac = clamp(localPx.y / max(uHeaderHeight, 1.0), 0.0, 1.0);
  float blurPx = mix(1.8, 8.2, uDepth) * mix(0.55, 1.15, headerFrac);
  float refractAmp = 0.65 + 0.35 * (1.0 - 0.30 * uDepth);

  vec2 offR = snellOffset(N, 1.44, 22.0 * refractAmp);
  vec2 offG = snellOffset(N, 1.49, 22.0 * refractAmp);
  vec2 offB = snellOffset(N, 1.54, 22.0 * refractAmp);

  vec3 refracted = sampleBlurredRefracted(pCss, offR, offG, offB, blurPx);
  float glassDim = mix(0.94, 0.76, uDepth);
  float frostMix = mix(0.42, 0.66, headerFrac) + 0.08 * uDepth;
  vec3 glassCol = mix(refracted * glassDim, vec3(0.955, 0.968, 0.988), clamp(frostMix, 0.0, 0.88));

  // Fresnel rim highlight along the curved glass lip and morphing corners.
  vec3 V = vec3(0.0, 0.0, 1.0);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  float rimLine = smoothstep(2.2, 0.0, distIn);
  float topEdge = clamp(-edgeDir.y, 0.0, 1.0) * smoothstep(4.0, 0.0, distIn);

  vec3 lightDir = uPointerActive > 0.5
    ? normalize(vec3((uPointer - (uSheetRect.xy + vec2(sheetSize.x * 0.5, 40.0))) / 140.0, 1.2))
    : normalize(vec3(-0.35, -0.82, 1.0));
  vec3 H = normalize(lightDir + V);
  float spec = pow(max(dot(N, H), 0.0), 28.0);

  glassCol += vec3(0.98, 0.99, 1.0) * (fresnel * 0.32 + rimLine * 0.30 + topEdge * 0.24 + spec * 0.28);

  vec4 domCol = texture(uTex, vUv);
  vec3 sheetRgb = domCol.rgb + glassCol * (1.0 - domCol.a);
  sheetRgb = mix(sheetRgb, vec3(1.0), rimLine * 0.26);

  outColor = vec4(clamp(sheetRgb, 0.0, 1.0) * mask, mask);
}`;
// #endregion sheet-shader

// #region spring-solver
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function applyRubberBand(rawFrac) {
  if (rawFrac > DETENTS.full) {
    const extra = rawFrac - DETENTS.full;
    return Math.min(0.94, DETENTS.full + extra * 0.24);
  }
  if (rawFrac < DETENTS.peek) {
    const extra = DETENTS.peek - rawFrac;
    return Math.max(0.11, DETENTS.peek - extra * 0.28);
  }
  return rawFrac;
}

/**
 * Velocity-aware multi-detent target selector.
 * `vFrac` is positive when moving upward toward Full (0.90), negative toward Peek (0.18).
 */
export function chooseDetent(frac, vFrac = 0) {
  if (Math.abs(vFrac) > 0.42) {
    if (vFrac > 1.75) return 'full';
    if (vFrac < -1.75) return 'peek';
    if (vFrac > 0) {
      for (const d of DETENT_LIST) {
        if (d.frac > frac - 0.04) return d.key;
      }
      return 'full';
    }
    for (let i = DETENT_LIST.length - 1; i >= 0; i--) {
      if (DETENT_LIST[i].frac < frac + 0.04) return DETENT_LIST[i].key;
    }
    return 'peek';
  }
  const projected = frac + vFrac * 0.14;
  let best = DETENT_LIST[0];
  let bestDist = Infinity;
  for (const d of DETENT_LIST) {
    const dist = Math.abs(projected - d.frac);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best.key;
}

/**
 * Sub-stepped damped harmonic spring step.
 * Snaps straight to target with zero overshoot when `reducedMotion` is true.
 */
export function stepSpring(spring, dtSec, reducedMotion = false) {
  if (reducedMotion) {
    spring.frac = spring.target;
    spring.vFrac = 0;
    spring.settled = true;
    return spring;
  }
  const k = 260;
  const c = 24;
  let rem = clamp(dtSec, 0, 0.05);
  while (rem > 0) {
    const step = Math.min(rem, 1 / 120);
    const accel = k * (spring.target - spring.frac) - c * spring.vFrac;
    spring.vFrac += accel * step;
    spring.frac += spring.vFrac * step;
    rem -= step;
  }
  if (Math.abs(spring.target - spring.frac) < 0.0008 && Math.abs(spring.vFrac) < 0.004) {
    spring.frac = spring.target;
    spring.vFrac = 0;
    spring.settled = true;
  } else {
    spring.settled = false;
  }
  return spring;
}
// #endregion spring-solver

// #region scroll-handoff
/**
 * Single-gesture nested-scroll handoff state machine.
 * Drags `#sheet-scroll` down to `scrollTop === 0`, then feeds leftover delta into sheet position.
 */
export function applyDragDelta({
  frac,
  scrollTop,
  maxScrollTop,
  stageH,
  deltaY,
  startedInScroll,
  owner = 'idle',
}) {
  const h = Math.max(1, stageH);
  let nextFrac = frac;
  let nextScroll = Math.max(0, Math.min(maxScrollTop, scrollTop));
  let nextOwner = owner;

  if (!startedInScroll) {
    nextOwner = 'sheet';
    nextFrac = applyRubberBand(nextFrac - deltaY / h);
    return { frac: nextFrac, scrollTop: nextScroll, owner: nextOwner };
  }

  let remaining = deltaY;
  let guard = 0;
  while (Math.abs(remaining) > 1e-4 && guard++ < 4) {
    const atFull = nextFrac >= DETENTS.full - 0.002;
    if (remaining < 0) {
      if (!atFull) {
        const distToFullPx = Math.max(0, (DETENTS.full - nextFrac) * h);
        const pullUp = Math.min(-remaining, distToFullPx);
        nextFrac = Math.min(DETENTS.full, nextFrac + pullUp / h);
        remaining += pullUp;
        if (nextFrac >= DETENTS.full - 0.002 && Math.abs(remaining) > 1e-4) {
          nextFrac = DETENTS.full;
          if (maxScrollTop > 0) {
            nextOwner = 'scroll-handoff';
          } else {
            nextFrac = applyRubberBand(nextFrac - remaining / h);
            nextOwner = 'sheet';
            remaining = 0;
          }
        } else if (nextOwner !== 'sheet-handoff') {
          nextOwner = 'sheet';
        }
      } else if (nextScroll < maxScrollTop) {
        const avail = maxScrollTop - nextScroll;
        const scrollBy = Math.min(-remaining, avail);
        nextScroll += scrollBy;
        remaining += scrollBy;
        if (nextOwner !== 'scroll-handoff') nextOwner = 'scroll';
      } else {
        if (nextOwner !== 'scroll-handoff') nextOwner = 'scroll';
        remaining = 0;
      }
    } else {
      if (atFull && nextFrac <= DETENTS.full + 0.002 && nextScroll > 0.5) {
        const consume = Math.min(remaining, nextScroll);
        nextScroll = Math.max(0, nextScroll - consume);
        remaining -= consume;
        if (nextOwner !== 'scroll-handoff') nextOwner = 'scroll';
        if (nextScroll <= 0.5 && remaining > 1e-4) {
          nextScroll = 0;
          nextOwner = 'sheet-handoff';
        }
      } else {
        if (nextScroll > 0 && nextScroll <= 0.5) nextScroll = 0;
        if (nextOwner === 'scroll' || nextOwner === 'scroll-handoff') {
          nextOwner = 'sheet-handoff';
        } else if (nextOwner === 'idle') {
          nextOwner = 'sheet';
        }
        nextFrac = applyRubberBand(nextFrac - remaining / h);
        remaining = 0;
      }
    }
  }
  return { frac: nextFrac, scrollTop: nextScroll, owner: nextOwner };
}
// #endregion scroll-handoff

export function computeLayout(cw, ch, sheetDomH, headerH, frac) {
  const safeCw = Math.max(1, cw);
  const safeCh = Math.max(1, ch);
  const sheetTop = (1 - frac) * safeCh;
  const depthT = clamp((frac - DETENTS.peek) / (DETENTS.full - DETENTS.peek), 0, 1);
  const fullMorphT = smoothstep(0.56, DETENTS.full, frac);
  const cornerRadius = 24 - 16 * fullMorphT; // 24 px -> 8 px at Full
  const bgScale = 1.0 - 0.055 * depthT;
  const bgW = safeCw * bgScale;
  const bgH = safeCh * bgScale;
  const bgX = (safeCw - bgW) * 0.5;
  const bgY = 4.0 * depthT;
  return {
    cw: safeCw,
    ch: safeCh,
    sheetDomH: Math.max(1, sheetDomH),
    headerH: Math.max(40, headerH),
    frac,
    sheetTop,
    depthT,
    cornerRadius,
    bgScale,
    bgX,
    bgY,
    bgW,
    bgH,
  };
}

// ---- DOM references ----
const stageBox = document.getElementById('sheet-stage');
const viewportEl = document.getElementById('sheet-viewport');
const canvas = document.getElementById('sheet-canvas');
const plainHost = document.getElementById('plain-host');
const backdropDom = document.getElementById('backdrop-dom');
const mapWorld = document.getElementById('map-world');
const mapStatusPill = document.getElementById('map-status-pill');
const btnTraffic = document.getElementById('btn-traffic');
const btnRecentre = document.getElementById('btn-recentre');
const sheetDom = document.getElementById('sheet-dom');
const sheetHeaderEl = document.getElementById('sheet-header');
const sheetGrab = document.getElementById('sheet-grab');
const searchInput = document.getElementById('sheet-search');
const searchClearBtn = document.getElementById('sheet-search-clear');
const telemetryEl = document.getElementById('gesture-telemetry');
const categoryBtns = Array.from(document.querySelectorAll('#category-pills .cat-pill'));
const sheetScroll = document.getElementById('sheet-scroll');
const sheetEmpty = document.getElementById('sheet-empty');
const resetFilterBtn = document.getElementById('btn-reset-filter');
const pinBtns = Array.from(document.querySelectorAll('#map-world .map-pin'));
const detentBtns = Array.from(document.querySelectorAll('.seg-detents button[data-detent]'));
const scrollDemoBtn = document.getElementById('ctl-scroll-demo');
const reducedCheck = document.getElementById('ctl-reduced');
const stageHud = document.getElementById('stage-hud');
const noticeEl = document.getElementById('sheet-notice');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

if (reducedQuery.matches) reducedCheck.checked = true;

// Populate 12 interactive place items inside #sheet-scroll
const cardById = new Map();
for (const place of PLACES) {
  const card = document.createElement('article');
  card.className = 'place-card';
  card.dataset.placeId = place.id;
  card.dataset.cat = place.cat;
  card.innerHTML = `
    <span class="place-badge cat-${place.cat}" aria-hidden="true">${place.badge}</span>
    <div class="place-info">
      <strong class="place-name"></strong>
      <span class="place-meta"></span>
    </div>
    <div class="place-actions">
      <button type="button" class="place-btn place-route-btn">Route</button>
      <button type="button" class="place-btn place-save-btn" aria-pressed="false">Save</button>
    </div>`;
  card.querySelector('.place-name').textContent = place.name;
  card.querySelector('.place-meta').textContent = `${place.walk} · ${place.detail}`;
  sheetScroll.insertBefore(card, sheetEmpty);
  cardById.set(place.id, card);
}

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  onScreen: true,
  detent: 'half',
  sheetFrac: DETENTS.half,
  targetFrac: DETENTS.half,
  vFrac: 0,
  springing: false,
  scrollVy: 0,
  coasting: false,
  gestureOwner: 'idle', // 'idle' | 'sheet' | 'scroll' | 'sheet-handoff' | 'scroll-handoff'
  trafficOn: false,
  selectedPlaceId: null,
  activeCat: 'all',
  query: '',
  reducedOverride: reducedCheck.checked,
  pointerX: 0,
  pointerY: 0,
  pointerActive: false,
  backdropDirty: true,
  sheetDirty: true,
  uploads: 0,
  paints: 0,
  lastAction: 'Ready',
  unitCache: { key: '', unit: 1 },
};

let stage = null;
let ctx2d = null;
let backdropTex = null;
let rafId = 0;
let lastFrameMs = 0;
let paintQueued = false;

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function ownerLabel(owner) {
  if (owner === 'scroll') return 'Inner list scroll';
  if (owner === 'scroll-handoff') return 'Inner scroll (handed off)';
  if (owner === 'sheet') return 'Sheet drag';
  if (owner === 'sheet-handoff') return 'Sheet drag (handed off)';
  return 'Idle';
}

function updateDetentButtons(activeKey) {
  for (const btn of detentBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.detent === activeKey));
  }
}

function updateTelemetryUI() {
  const pct = Math.round(state.sheetFrac * 100);
  const ch = (state.mode === 'plain' ? plainHost.clientHeight : canvas.clientHeight) || viewportEl.clientHeight || 560;
  const fullMorphT = smoothstep(0.56, DETENTS.full, state.sheetFrac);
  const cornerR = Math.round(24 - 16 * fullMorphT);
  const scrollVal = Math.round(sheetScroll.scrollTop);
  const nextText = `Gesture owner: ${ownerLabel(state.gestureOwner)} · ${pct}% · r ${cornerR} px`;
  if (telemetryEl.textContent !== nextText || telemetryEl.dataset.owner !== state.gestureOwner) {
    telemetryEl.textContent = nextText;
    telemetryEl.dataset.owner = state.gestureOwner;
    state.sheetDirty = true;
  }

  const routeName = state.mode === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML fallback';
  const rmText = isReducedMotion() ? ' · reduced motion' : '';
  stageHud.textContent =
    `${routeName} · ${state.detent} (${pct}%) · corner ${cornerR} px · scrollTop ${scrollVal} px · ` +
    `${state.paints} paints, ${state.uploads} uploads${rmText} · ${state.lastAction}`;

  if (scrollDemoBtn) {
    scrollDemoBtn.textContent = sheetScroll.scrollTop > 40 ? 'Reset list top' : 'Scroll list down';
  }
  void ch;
}

function schedulePaint() {
  updateTelemetryUI();
  if (state.mode === 'plain') {
    renderPlainFallback();
    return;
  }
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    canvas.requestPaint?.();
  });
}

function startAnimLoop() {
  if (rafId || !state.onScreen || document.hidden) return;
  if (!state.springing && !state.coasting) return;
  lastFrameMs = performance.now();
  const tick = (now) => {
    rafId = 0;
    if (!state.onScreen || document.hidden) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameMs) / 1000));
    lastFrameMs = now;
    let keepGoing = false;

    if (state.springing) {
      const sp = stepSpring(
        { frac: state.sheetFrac, target: state.targetFrac, vFrac: state.vFrac, settled: false },
        dt,
        isReducedMotion()
      );
      state.sheetFrac = sp.frac;
      state.vFrac = sp.vFrac;
      if (sp.settled) {
        state.springing = false;
        if (!dragState) state.gestureOwner = 'idle';
      } else {
        keepGoing = true;
      }
    }

    if (state.coasting) {
      if (isReducedMotion() || Math.abs(state.scrollVy) < 18) {
        state.scrollVy = 0;
        state.coasting = false;
        if (!dragState && !state.springing) state.gestureOwner = 'idle';
      } else {
        const maxScroll = Math.max(0, sheetScroll.scrollHeight - sheetScroll.clientHeight);
        const nextTop = clamp(sheetScroll.scrollTop + state.scrollVy * dt, 0, maxScroll);
        if (Math.abs(nextTop - sheetScroll.scrollTop) < 0.25) {
          state.scrollVy = 0;
          state.coasting = false;
          if (!dragState && !state.springing) state.gestureOwner = 'idle';
        } else {
          sheetScroll.scrollTop = nextTop;
          state.sheetDirty = true;
          state.scrollVy *= Math.exp(-5.2 * dt);
          keepGoing = true;
        }
      }
    }

    schedulePaint();
    if (keepGoing) {
      rafId = requestAnimationFrame(tick);
    }
  };
  rafId = requestAnimationFrame(tick);
}

export function goToDetent(key, initialVFrac = 0) {
  const target = DETENTS[key] ?? DETENTS.half;
  state.detent = key;
  state.targetFrac = target;
  state.coasting = false;
  state.scrollVy = 0;
  updateDetentButtons(key);

  if (isReducedMotion()) {
    state.sheetFrac = target;
    state.vFrac = 0;
    state.springing = false;
    state.gestureOwner = 'idle';
    cancelAnimationFrame(rafId);
    rafId = 0;
    schedulePaint();
    return;
  }

  state.vFrac = initialVFrac;
  state.springing = true;
  schedulePaint();
  startAnimLoop();
}

// #region geometry-sync
const lastGeo = new WeakMap();

function cachedUnit(el, cssW) {
  const zoom = el.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${Math.round(cssW)}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, el, cssW);
    state.unitCache.key = key;
  }
  return state.unitCache.unit;
}

function syncElementGeometry(el, matrix, geoKey) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || state.mode === 'plain') return;
  if (lastGeo.get(el) === geoKey) return;
  lastGeo.set(el, geoKey);
  canvas.updateElementGeometry(el, { canvasTransform: matrix });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

function syncBothGeometries(layout) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || state.mode === 'plain') return;
  const unit = cachedUnit(backdropDom, backdropDom.offsetWidth || layout.cw);

  const bgMat = new DOMMatrix()
    .scale(unit, unit, 1)
    .translate(layout.bgX, layout.bgY)
    .scale(layout.bgScale, layout.bgScale, 1);
  const bgKey = `${layout.bgX.toFixed(1)},${layout.bgY.toFixed(1)},${layout.bgScale.toFixed(4)},${layout.cw},${layout.ch},${unit.toFixed(3)}`;
  syncElementGeometry(backdropDom, bgMat, bgKey);

  const sheetMat = new DOMMatrix()
    .scale(unit, unit, 1)
    .translate(0, layout.sheetTop);
  const sheetKey = `0,${layout.sheetTop.toFixed(1)},${layout.cw},${layout.sheetDomH},${unit.toFixed(3)}`;
  syncElementGeometry(sheetDom, sheetMat, sheetKey);
}

function render2DFallback(layout) {
  if (!ctx2d) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.fillStyle = '#0e1015';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);

  // Explicit 5-argument drawElementImage() in CSS pixel units.
  ctx2d.drawElementImage(backdropDom, layout.bgX, layout.bgY, layout.bgW, layout.bgH);
  if (layout.depthT > 0.01) {
    ctx2d.fillStyle = `rgba(12, 16, 24, ${(0.28 * layout.depthT).toFixed(3)})`;
    ctx2d.fillRect(layout.bgX, layout.bgY, layout.bgW, layout.bgH);
  }

  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.roundRect(0, layout.sheetTop, layout.cw, layout.sheetDomH + layout.cornerRadius, layout.cornerRadius);
  ctx2d.clip();
  ctx2d.fillStyle = 'rgba(246, 247, 250, 0.88)';
  ctx2d.fillRect(0, layout.sheetTop, layout.cw, layout.sheetDomH);
  ctx2d.drawElementImage(sheetDom, 0, layout.sheetTop, sheetDom.offsetWidth || layout.cw, sheetDom.offsetHeight || layout.sheetDomH);
  ctx2d.restore();

  syncBothGeometries(layout);
  state.paints++;
  updateTelemetryUI();
}
// #endregion geometry-sync

function renderPlainFallback() {
  const cw = plainHost.clientWidth || viewportEl.clientWidth || 380;
  const ch = plainHost.clientHeight || viewportEl.clientHeight || 560;
  const layout = computeLayout(cw, ch, sheetDom.offsetHeight || Math.round(ch * 0.94), sheetHeaderEl.offsetHeight || 136, state.sheetFrac);
  backdropDom.style.transform = `translate(${layout.bgX.toFixed(1)}px, ${layout.bgY.toFixed(1)}px) scale(${layout.bgScale.toFixed(4)})`;
  backdropDom.style.borderRadius = `${Math.round(14 * layout.depthT)}px`;
  backdropDom.style.filter = `brightness(${(1 - 0.25 * layout.depthT).toFixed(2)})`;
  sheetDom.style.transform = `translateY(${layout.sheetTop.toFixed(1)}px)`;
  sheetDom.style.borderRadius = `${Math.round(layout.cornerRadius)}px ${Math.round(layout.cornerRadius)}px 0 0`;
  updateTelemetryUI();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  state.springing = false;
  state.coasting = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.remove('is-2d');
  stageBox.classList.add('is-plain');
  if (backdropDom.parentElement !== plainHost) plainHost.append(backdropDom);
  if (sheetDom.parentElement !== plainHost) plainHost.append(sheetDom);
  showNotice(reason);
  renderPlainFallback();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  backdropDom.style.transform = '';
  backdropDom.style.borderRadius = '';
  backdropDom.style.filter = '';
  sheetDom.style.transform = '';
  sheetDom.style.borderRadius = '';
  if (backdropDom.parentElement !== canvas) canvas.append(backdropDom);
  if (sheetDom.parentElement !== canvas) canvas.append(sheetDom);
  showNotice('');
}

function tryUpload(el) {
  if (!stage || stage.lost) return null;
  try {
    const tex = stage.upload(el);
    state.uploads++;
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return null;
    }
    throw err;
  }
}

function renderWebGL(e) {
  if (!stage || stage.lost) return;
  const cw = canvas.clientWidth || viewportEl.clientWidth || 380;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 560;
  const sheetDomH = sheetDom.offsetHeight || Math.round(ch * 0.94);
  const headerH = sheetHeaderEl.offsetHeight || 136;
  const layout = computeLayout(cw, ch, sheetDomH, headerH, state.sheetFrac);

  const changed = new Set(e?.changedElements ?? []);
  if (state.backdropDirty || changed.has(backdropDom) || !stage.has(backdropDom) || !backdropTex) {
    const uploaded = tryUpload(backdropDom);
    if (uploaded) {
      backdropTex = uploaded;
      state.backdropDirty = false;
    }
  }
  if (state.sheetDirty || changed.has(sheetDom) || !stage.has(sheetDom)) {
    const uploaded = tryUpload(sheetDom);
    if (uploaded) state.sheetDirty = false;
  }
  if (!backdropTex || !stage.has(sheetDom)) return;

  if (!stage.begin([0.055, 0.065, 0.085, 1])) return;

  // Pass 0: scaled, progressively dimmed backdrop map + upward sheet rim shadow.
  stage.quad(backdropDom, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (gl, loc) => {
    gl.uniform1i(loc('uPass'), 0);
    gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    gl.uniform4f(loc('uBgRect'), layout.bgX, layout.bgY, layout.bgW, layout.bgH);
    gl.uniform4f(loc('uSheetRect'), 0, layout.sheetTop, layout.cw, layout.sheetDomH);
    gl.uniform1f(loc('uDepth'), layout.depthT);
    gl.uniform1f(loc('uCornerRadius'), layout.cornerRadius);
  });

  // Pass 1: refractive glass bottom sheet header + composited scrollable DOM.
  stage.quad(sheetDom, ElementGL.rect(canvas, 0, layout.sheetTop, layout.cw, layout.sheetDomH), (gl, loc) => {
    gl.uniform1i(loc('uPass'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backdropTex.tex);
    gl.uniform1i(loc('uBgTex'), 1);
    gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    gl.uniform4f(loc('uBgRect'), layout.bgX, layout.bgY, layout.bgW, layout.bgH);
    gl.uniform4f(loc('uSheetRect'), 0, layout.sheetTop, layout.cw, layout.sheetDomH);
    gl.uniform1f(loc('uDepth'), layout.depthT);
    gl.uniform1f(loc('uCornerRadius'), layout.cornerRadius);
    gl.uniform1f(loc('uHeaderHeight'), layout.headerH);
    gl.uniform2f(loc('uPointer'), state.pointerX, state.pointerY);
    gl.uniform1f(loc('uPointerActive'), state.pointerActive ? 1 : 0);
  });

  syncBothGeometries(layout);
  state.paints++;
  updateTelemetryUI();
}

// ---- Initialise backend: WebGL 2 via ElementGL, then 2D fallback, else plain HTML ----
if (hicSupported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: SHEET_FRAG,
      onLost: () => {
        backdropTex = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the map and bottom sheet as plain HTML until restored.');
      },
      onRestored: () => {
        state.mode = 'webgl';
        state.backdropDirty = true;
        state.sheetDirty = true;
        exitPlainFallback();
        schedulePaint();
      },
    });
    state.mode = 'webgl';
  } catch (err) {
    stage = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
  }
}

if (!stage && hicSupported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.mode = '2d';
    stageBox.classList.add('is-2d');
    if (noticeEl.hidden) {
      showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
    }
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the map and bottom sheet are shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (state.mode === 'webgl') {
    renderWebGL(e);
  } else if (state.mode === '2d' && ctx2d) {
    const cw = canvas.clientWidth || viewportEl.clientWidth || 380;
    const ch = canvas.clientHeight || viewportEl.clientHeight || 560;
    const layout = computeLayout(cw, ch, sheetDom.offsetHeight || Math.round(ch * 0.94), sheetHeaderEl.offsetHeight || 136, state.sheetFrac);
    render2DFallback(layout);
  }
});

// ---- IntersectionObserver & ResizeObserver ----
new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else if (state.mode !== 'plain') {
    schedulePaint();
    startAnimLoop();
  }
}).observe(stageBox);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else if (state.onScreen) {
    startAnimLoop();
  }
});

new ResizeObserver(() => {
  state.unitCache.key = '';
  state.backdropDirty = true;
  state.sheetDirty = true;
  schedulePaint();
}).observe(viewportEl);

// ---- Unified Pointer Drag & Nested-Scroll Handoff ----
let dragState = null;
let suppressSheetClick = false;
const VELOCITY_WINDOW_MS = 95;

function computeVelocityFrac(samples, ch) {
  const now = performance.now();
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.008) return 0;
  // Positive vFrac means moving upward (clientY decreasing).
  return -(last.y - first.y) / dt / Math.max(1, ch);
}

sheetDom.addEventListener('pointerdown', (e) => {
  if (e.button && e.button !== 0) return;
  state.springing = false;
  state.coasting = false;
  state.scrollVy = 0;
  cancelAnimationFrame(rafId);
  rafId = 0;

  const startedInScroll = Boolean(e.target.closest('#sheet-scroll'));
  dragState = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastY: e.clientY,
    moved: false,
    startedInScroll,
    samples: [{ y: e.clientY, t: performance.now() }],
  };
});

window.addEventListener('pointermove', (e) => {
  const rect = viewportEl.getBoundingClientRect();
  const lx = e.clientX - rect.left;
  const ly = e.clientY - rect.top;
  if (lx >= 0 && ly >= 0 && lx <= rect.width && ly <= rect.height) {
    state.pointerX = lx;
    state.pointerY = ly;
    state.pointerActive = true;
    if (state.mode === 'webgl' && !dragState) schedulePaint();
  }

  if (!dragState || e.pointerId !== dragState.id) return;
  const dx = e.clientX - dragState.startX;
  const dyTotal = e.clientY - dragState.startY;
  if (!dragState.moved) {
    if (Math.abs(dyTotal) > 6 && Math.abs(dyTotal) >= Math.abs(dx) * 0.65) {
      dragState.moved = true;
      sheetDom.setPointerCapture?.(dragState.id);
      dragState.lastY = e.clientY;
      dragState.samples = [{ y: e.clientY, t: performance.now() }];
    } else {
      return;
    }
  }

  const deltaY = e.clientY - dragState.lastY;
  dragState.lastY = e.clientY;
  const now = performance.now();
  dragState.samples.push({ y: e.clientY, t: now });
  if (dragState.samples.length > 10) dragState.samples.shift();

  const ch = (state.mode === 'plain' ? plainHost.clientHeight : canvas.clientHeight) || viewportEl.clientHeight || 560;
  const maxScrollTop = Math.max(0, sheetScroll.scrollHeight - sheetScroll.clientHeight);
  const prevScroll = sheetScroll.scrollTop;

  const next = applyDragDelta({
    frac: state.sheetFrac,
    scrollTop: prevScroll,
    maxScrollTop,
    stageH: ch,
    deltaY,
    startedInScroll: dragState.startedInScroll,
    owner: state.gestureOwner,
  });

  state.sheetFrac = next.frac;
  state.gestureOwner = next.owner;
  if (Math.abs(next.scrollTop - prevScroll) > 0.05) {
    sheetScroll.scrollTop = next.scrollTop;
    state.sheetDirty = true;
  }
  state.lastAction = ownerLabel(state.gestureOwner);
  schedulePaint();
});

function finishDrag(e) {
  if (e.pointerType === 'touch') {
    state.pointerActive = false;
    if (state.mode === 'webgl') schedulePaint();
  }
  if (!dragState || e.pointerId !== dragState.id) return;
  const wasMoved = dragState.moved;
  const ch = (state.mode === 'plain' ? plainHost.clientHeight : canvas.clientHeight) || viewportEl.clientHeight || 560;
  const vFrac = wasMoved ? computeVelocityFrac(dragState.samples, ch) : 0;

  if (wasMoved) {
    suppressSheetClick = true;
    setTimeout(() => { suppressSheetClick = false; }, 0);
    try { sheetDom.releasePointerCapture?.(dragState.id); } catch {}
  }
  dragState = null;

  if (!wasMoved) return;

  if (state.gestureOwner === 'scroll' || state.gestureOwner === 'scroll-handoff') {
    state.detent = 'full';
    state.targetFrac = DETENTS.full;
    state.sheetFrac = DETENTS.full;
    updateDetentButtons('full');
    if (!isReducedMotion() && Math.abs(vFrac) > 0.25) {
      // Convert upward sheet vFrac back to downward scrollTop velocity (px/s).
      state.scrollVy = clamp(vFrac * ch, -1800, 1800);
      state.coasting = true;
      startAnimLoop();
    } else {
      state.gestureOwner = 'idle';
      schedulePaint();
    }
    return;
  }

  const targetKey = chooseDetent(state.sheetFrac, vFrac);
  state.lastAction = `Flick -> ${targetKey}`;
  goToDetent(targetKey, vFrac);
}

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);
viewportEl.addEventListener('pointerleave', () => {
  state.pointerActive = false;
  if (state.mode === 'webgl') schedulePaint();
});

sheetDom.addEventListener('click', (e) => {
  if (suppressSheetClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// Native wheel / keyboard scrolling inside #sheet-scroll keeps textures synced.
sheetScroll.addEventListener('scroll', () => {
  state.sheetDirty = true;
  schedulePaint();
}, { passive: true });

// ---- Interactive controls inside #backdrop-dom and #sheet-dom ----
function selectPlace(placeId, { scrollCard = false, raiseFromPeek = false } = {}) {
  state.selectedPlaceId = placeId;
  const place = PLACES.find((p) => p.id === placeId) || null;
  for (const pin of pinBtns) {
    const active = pin.dataset.pin === placeId;
    pin.classList.toggle('is-selected', active);
    pin.setAttribute('aria-pressed', String(active));
  }
  for (const [id, card] of cardById) {
    card.classList.toggle('is-selected', id === placeId);
  }
  if (place) {
    mapStatusPill.textContent = `Route: ${place.name} · ${place.walk.split(' · ')[0]}`;
    state.lastAction = `Selected ${place.name}`;
    if (scrollCard) {
      const card = cardById.get(placeId);
      if (card && !card.hidden) {
        // Scroll only the inner #sheet-scroll box, never the outer page.
        sheetScroll.scrollTop = Math.max(0, card.offsetTop - 8);
      }
    }
    if (raiseFromPeek && state.sheetFrac < 0.40) {
      goToDetent('half');
    }
  } else {
    mapStatusPill.textContent = state.trafficOn ? 'Traffic: Live · 12 places' : 'Waterfront · 12 places';
  }
  state.backdropDirty = true;
  state.sheetDirty = true;
  schedulePaint();
}

function applyPlaceFilter() {
  const q = state.query.trim().toLowerCase();
  let visible = 0;
  for (const place of PLACES) {
    const card = cardById.get(place.id);
    if (!card) continue;
    const catOk = state.activeCat === 'all' || place.cat === state.activeCat;
    const qOk = !q || place.name.toLowerCase().includes(q) || place.detail.toLowerCase().includes(q) || place.cat.includes(q);
    const show = catOk && qOk;
    card.hidden = !show;
    if (show) visible++;
  }
  sheetEmpty.hidden = visible > 0;
  searchClearBtn.hidden = !state.query;
  state.sheetDirty = true;
  schedulePaint();
}

btnTraffic.addEventListener('click', () => {
  state.trafficOn = !state.trafficOn;
  btnTraffic.setAttribute('aria-pressed', String(state.trafficOn));
  backdropDom.classList.toggle('has-traffic', state.trafficOn);
  if (!state.selectedPlaceId) {
    mapStatusPill.textContent = state.trafficOn ? 'Traffic: Live · 12 places' : 'Waterfront · 12 places';
  }
  state.lastAction = state.trafficOn ? 'Traffic overlay on' : 'Traffic overlay off';
  state.backdropDirty = true;
  schedulePaint();
});

btnRecentre.addEventListener('click', () => {
  mapWorld.style.transform = '';
  selectPlace(null);
  state.lastAction = 'Map recentred';
  state.backdropDirty = true;
  schedulePaint();
});

for (const pin of pinBtns) {
  pin.addEventListener('click', () => {
    selectPlace(pin.dataset.pin, { scrollCard: true, raiseFromPeek: true });
  });
}

sheetGrab.addEventListener('click', () => {
  const order = ['peek', 'half', 'full'];
  const next = order[(order.indexOf(state.detent) + 1) % order.length];
  state.lastAction = `Grab tap -> ${next}`;
  goToDetent(next);
});

sheetGrab.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const next = state.detent === 'peek' ? 'half' : 'full';
    goToDetent(next);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = state.detent === 'full' ? 'half' : 'peek';
    goToDetent(next);
  }
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  applyPlaceFilter();
});

searchInput.addEventListener('pointerup', () => {
  if (!dragState?.moved && state.sheetFrac < 0.40) {
    goToDetent('half');
  }
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && searchInput.value) {
    e.preventDefault();
    searchInput.value = '';
    state.query = '';
    applyPlaceFilter();
  }
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  applyPlaceFilter();
  searchInput.focus({ preventScroll: true });
});

for (const pill of categoryBtns) {
  pill.addEventListener('click', () => {
    state.activeCat = pill.dataset.cat;
    for (const b of categoryBtns) b.setAttribute('aria-pressed', String(b === pill));
    state.lastAction = `Category: ${pill.textContent}`;
    applyPlaceFilter();
  });
}

resetFilterBtn.addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  state.activeCat = 'all';
  for (const b of categoryBtns) b.setAttribute('aria-pressed', String(b.dataset.cat === 'all'));
  applyPlaceFilter();
});

sheetScroll.addEventListener('click', (e) => {
  const card = e.target.closest('.place-card');
  if (!card) return;
  const id = card.dataset.placeId;
  if (e.target.closest('.place-route-btn')) {
    selectPlace(id, { scrollCard: false, raiseFromPeek: false });
    return;
  }
  const saveBtn = e.target.closest('.place-save-btn');
  if (saveBtn) {
    const nextSaved = saveBtn.getAttribute('aria-pressed') !== 'true';
    saveBtn.setAttribute('aria-pressed', String(nextSaved));
    saveBtn.textContent = nextSaved ? 'Saved' : 'Save';
    state.lastAction = `${nextSaved ? 'Saved' : 'Unsaved'} ${card.querySelector('.place-name')?.textContent ?? id}`;
    state.sheetDirty = true;
    schedulePaint();
  }
});

// Outer toolbar controls
for (const btn of detentBtns) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.detent;
    state.lastAction = `Detent button -> ${key}`;
    goToDetent(key);
  });
}

scrollDemoBtn.addEventListener('click', () => {
  if (sheetScroll.scrollTop > 40) {
    sheetScroll.scrollTop = 0;
    state.lastAction = 'List reset to scrollTop = 0';
    state.sheetDirty = true;
    schedulePaint();
  } else {
    goToDetent('full');
    sheetScroll.scrollTop = 220;
    state.lastAction = 'Full detent at scrollTop = 220';
    state.sheetDirty = true;
    schedulePaint();
  }
});

reducedCheck.addEventListener('change', () => {
  state.reducedOverride = reducedCheck.checked;
  if (isReducedMotion()) {
    state.scrollVy = 0;
    state.coasting = false;
    if (state.springing) {
      state.sheetFrac = state.targetFrac;
      state.vFrac = 0;
      state.springing = false;
      state.gestureOwner = 'idle';
    }
  }
  schedulePaint();
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  schedulePaint();
});

// Initial draw
updateDetentButtons(state.detent);
schedulePaint();

// ---------------------------------------------------------------- Live checks on isolated fixtures
const need = (ok, detail) => { if (!ok) throw new Error(detail); return detail; };

const tests = [
  {
    name: 'ElementGL uploads both #backdrop-dom and #sheet-dom via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Mounts an isolated two-layer ElementGL canvas on testStage(), uploads both drawable children, runs SHEET_FRAG and samples backdrop and sheet pixels.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 200;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `position:relative;display:block;width:${cw}px;height:${ch}px;`;

      const bg = document.createElement('div');
      bg.setAttribute('drawable', '');
      bg.style.cssText = `position:absolute;inset:0;width:${cw}px;height:${ch}px;background:linear-gradient(180deg,#d2491f 0 50%,#1778ff 50% 100%);`;

      const sh = document.createElement('div');
      sh.setAttribute('drawable', '');
      sh.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:180px;background:transparent;display:flex;flex-direction:column;`;
      sh.innerHTML = '<div style="height:46px;background:rgba(255,255,255,0.2)"></div><div style="flex:1;background:rgba(246,247,250,0.92);color:#14171f;padding:8px;font:700 12px system-ui">Places</div>';
      cv.append(bg, sh);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SHEET_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const bgT = g.upload(bg);
        const shT = g.upload(sh);
        const layout = computeLayout(cw, ch, 180, 46, DETENTS.half);

        g.begin([0.055, 0.065, 0.085, 1]);
        g.quad(bg, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
          gl.uniform1i(loc('uPass'), 0);
          gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
          gl.uniform4f(loc('uBgRect'), layout.bgX, layout.bgY, layout.bgW, layout.bgH);
          gl.uniform4f(loc('uSheetRect'), 0, layout.sheetTop, layout.cw, layout.sheetDomH);
          gl.uniform1f(loc('uDepth'), layout.depthT);
          gl.uniform1f(loc('uCornerRadius'), layout.cornerRadius);
        });
        g.quad(sh, ElementGL.rect(cv, 0, layout.sheetTop, cw, 180), (gl, loc) => {
          gl.uniform1i(loc('uPass'), 1);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, bgT.tex);
          gl.uniform1i(loc('uBgTex'), 1);
          gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
          gl.uniform4f(loc('uBgRect'), layout.bgX, layout.bgY, layout.bgW, layout.bgH);
          gl.uniform4f(loc('uSheetRect'), 0, layout.sheetTop, layout.cw, layout.sheetDomH);
          gl.uniform1f(loc('uDepth'), layout.depthT);
          gl.uniform1f(loc('uCornerRadius'), layout.cornerRadius);
          gl.uniform1f(loc('uHeaderHeight'), 46);
          gl.uniform2f(loc('uPointer'), 0, 0);
          gl.uniform1f(loc('uPointerActive'), 0);
        });

        const err = g.gl.getError();
        const scaleX = cv.width / cw;
        const scaleY = cv.height / ch;
        const readAt = (xCss, yCss) => {
          const buf = new Uint8Array(4);
          const rx = clamp(Math.floor(xCss * scaleX), 0, Math.max(0, cv.width - 1));
          const ry = clamp(Math.floor(cv.height - 1 - yCss * scaleY), 0, Math.max(0, cv.height - 1));
          g.gl.readPixels(rx, ry, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, buf);
          return buf;
        };
        const topPx = readAt(120, 30);
        const sheetPx = readAt(120, 160);
        return need(
          err === g.gl.NO_ERROR && bgT && shT && topPx[0] > topPx[2] + 60 && sheetPx[0] > 180 && sheetPx[2] > 180,
          `gl.getError()=${err}, bg ${bgT?.w}x${bgT?.h}, sheet ${shT?.w}x${shT?.h}, top rgb(${topPx[0]},${topPx[1]},${topPx[2]}), sheet rgb(${sheetPx[0]},${sheetPx[1]},${sheetPx[2]}).`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Velocity-aware spring detent selector commits upward vs downward flicks cleanly and settles at target detent',
    expect: 'pass',
    why: 'Verifies chooseDetent() across slow releases, medium flicks and fast flings, then integrates stepSpring() until settled under normal and reduced motion.',
    run: async () => {
      const slow = chooseDetent(0.23, 0.05);
      const upMed = chooseDetent(0.23, 0.95);
      const upFast = chooseDetent(0.23, 2.2);
      const downMed = chooseDetent(0.85, -0.95);
      const downFast = chooseDetent(0.85, -2.2);

      const sp = { frac: 0.23, target: DETENTS.half, vFrac: 1.4, settled: false };
      let peak = sp.frac;
      let steps = 0;
      while (!sp.settled && steps < 180) {
        stepSpring(sp, 1 / 60, false);
        if (sp.frac > peak) peak = sp.frac;
        steps++;
      }

      const rm = { frac: 0.23, target: DETENTS.full, vFrac: 1.4, settled: false };
      stepSpring(rm, 1 / 60, true);

      return need(
        slow === 'peek' && upMed === 'half' && upFast === 'full' && downMed === 'half' && downFast === 'peek' &&
        sp.settled && Math.abs(sp.frac - DETENTS.half) < 0.001 && peak > DETENTS.half &&
        rm.settled && rm.frac === DETENTS.full && rm.vFrac === 0,
        `Detents: slow=${slow}, up=${upMed}/${upFast}, down=${downMed}/${downFast}; spring peak=${peak.toFixed(3)} settled in ${steps} frames; reduced-motion snapped to ${rm.frac}.`
      );
    },
  },
  {
    name: 'Scroll handoff state machine switches from inner scroll to outer sheet drag at scrollTop === 0 without dropping gesture continuity',
    expect: 'pass',
    why: 'Drags an isolated scrollable list fixture up, then down across scrollTop === 0 into sheet drag, then back up into scroll within one continuous gesture.',
    run: async () => {
      const box = document.createElement('div');
      box.style.cssText = 'width:220px;height:120px;overflow-y:auto;background:#fff;color:#111;';
      const inner = document.createElement('div');
      inner.style.cssText = 'height:360px;';
      box.append(inner);
      testStage().append(box);
      try {
        box.scrollTop = 60;
        const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
        const stageH = 500;

        const stateM = { frac: DETENTS.full, scrollTop: box.scrollTop, owner: 'idle' };
        const step1 = applyDragDelta({ ...stateM, maxScrollTop: maxScroll, stageH, deltaY: -40, startedInScroll: true });
        box.scrollTop = step1.scrollTop;
        const step2 = applyDragDelta({ ...step1, maxScrollTop: maxScroll, stageH, deltaY: 60, startedInScroll: true });
        box.scrollTop = step2.scrollTop;
        const step3 = applyDragDelta({ ...step2, maxScrollTop: maxScroll, stageH, deltaY: 90, startedInScroll: true });
        box.scrollTop = step3.scrollTop;
        const step4 = applyDragDelta({ ...step3, maxScrollTop: maxScroll, stageH, deltaY: -80, startedInScroll: true });
        box.scrollTop = step4.scrollTop;

        return need(
          step1.owner === 'scroll' && step1.scrollTop === 100 &&
          step2.owner === 'scroll' && step2.scrollTop === 40 &&
          step3.owner === 'sheet-handoff' && step3.scrollTop === 0 && Math.abs(step3.frac - 0.80) < 1e-4 &&
          step4.owner === 'scroll-handoff' && Math.abs(step4.frac - DETENTS.full) < 1e-4 && Math.abs(step4.scrollTop - 30) < 0.5,
          `scroll 60->${step1.scrollTop}->${step2.scrollTop}->${step3.scrollTop} (${step3.owner}, frac ${step3.frac.toFixed(2)}) -> reverse (${step4.owner}, scrollTop ${Math.round(step4.scrollTop)}).`
        );
      } finally {
        box.remove();
      }
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() keeps both uncovered backdrop buttons and sheet buttons clickable (elementsFromPoint())',
    expect: 'pass',
    why: 'Positions a scaled backdrop layer and a translated sheet layer on an isolated canvas fixture and verifies elementsFromPoint() hits and clicks buttons on both.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 240, ch = 220, bgScale = 0.94, bgX = 7, bgY = 6, sheetTop = 104;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `position:relative;display:block;width:${cw}px;height:${ch}px;overflow:hidden;`;

      const bg = document.createElement('div');
      bg.setAttribute('drawable', '');
      bg.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#ede8dc;`;
      const bgBtn = document.createElement('button');
      bgBtn.type = 'button';
      bgBtn.textContent = 'Recentre';
      bgBtn.style.cssText = 'position:absolute;left:16px;top:10px;width:90px;height:34px;';
      bg.append(bgBtn);

      const sh = document.createElement('div');
      sh.setAttribute('drawable', '');
      sh.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:180px;background:#f7f8fb;`;
      const shBtn = document.createElement('button');
      shBtn.type = 'button';
      shBtn.textContent = 'Route';
      shBtn.style.cssText = 'position:absolute;left:20px;top:14px;width:100px;height:36px;';
      sh.append(shBtn);

      cv.append(bg, sh);
      testStage().append(cv);

      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: SHEET_FRAG });
        } else {
          const ctx = cv.getContext('2d');
          cv.width = cw;
          cv.height = ch;
          cv.addEventListener('paint', () => {
            ctx.reset();
            ctx.drawElementImage(bg, bgX, bgY, cw * bgScale, ch * bgScale);
            ctx.drawElementImage(sh, 0, sheetTop, cw, 180);
          });
        }
        await nextPaint(cv);
        if (g) {
          const bgT = g.upload(bg);
          g.upload(sh);
          g.begin([0.055, 0.065, 0.085, 1]);
          g.quad(bg, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform1i(loc('uPass'), 0);
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform4f(loc('uBgRect'), bgX, bgY, cw * bgScale, ch * bgScale);
            gl.uniform4f(loc('uSheetRect'), 0, sheetTop, cw, 180);
            gl.uniform1f(loc('uDepth'), 0.5);
            gl.uniform1f(loc('uCornerRadius'), 24);
          });
          g.quad(sh, ElementGL.rect(cv, 0, sheetTop, cw, 180), (gl, loc) => {
            gl.uniform1i(loc('uPass'), 1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, bgT.tex);
            gl.uniform1i(loc('uBgTex'), 1);
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform4f(loc('uBgRect'), bgX, bgY, cw * bgScale, ch * bgScale);
            gl.uniform4f(loc('uSheetRect'), 0, sheetTop, cw, 180);
            gl.uniform1f(loc('uDepth'), 0.5);
            gl.uniform1f(loc('uCornerRadius'), 24);
            gl.uniform1f(loc('uHeaderHeight'), 60);
            gl.uniform2f(loc('uPointer'), 0, 0);
            gl.uniform1f(loc('uPointerActive'), 0);
          });
        }

        const unit = geometryUnit(cv, bg, cw);
        cv.updateElementGeometry(bg, {
          canvasTransform: new DOMMatrix().scale(unit, unit, 1).translate(bgX, bgY).scale(bgScale, bgScale, 1),
        });
        bg.dataset.hitTick = '1';
        cv.updateElementGeometry(sh, {
          canvasTransform: new DOMMatrix().scale(unit, unit, 1).translate(0, sheetTop),
        });
        sh.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        let bgClicks = 0, shClicks = 0;
        bgBtn.addEventListener('click', () => { bgClicks++; });
        shBtn.addEventListener('click', () => { shClicks++; });

        const rect = cv.getBoundingClientRect();
        const bgCenterX = rect.left + bgX + (16 + 45) * bgScale;
        const bgCenterY = rect.top + bgY + (10 + 17) * bgScale;
        const shCenterX = rect.left + 20 + 50;
        const shCenterY = rect.top + sheetTop + 14 + 18;

        const bgHits = document.elementsFromPoint(bgCenterX, bgCenterY);
        const shHits = document.elementsFromPoint(shCenterX, shCenterY);
        bgHits.find((el) => el === bgBtn)?.click();
        shHits.find((el) => el === shBtn)?.click();

        return need(
          bgHits.includes(bgBtn) && shHits.includes(shBtn) && bgClicks === 1 && shClicks === 1,
          `geometryUnit=${unit.toFixed(2)}; backdrop button hit=${bgHits.includes(bgBtn)} (${bgClicks} click); sheet button hit=${shHits.includes(shBtn)} (${shClicks} click).`
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
      name: 'bottom sheet stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !stage.has(backdropDom) || !stage.has(sheetDom)) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
];

runTests(document.getElementById('tests'), tests);
