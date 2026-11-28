import {
  banner,
  supported as hicSupported,
  runTests,
  testStage,
  nextPaint,
  stillDrawn,
  inkFraction,
} from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const CARDS = [
  {
    id: 0,
    theme: 'coral',
    tag: 'WAV',
    title: 'Coral Audio',
    sub: '24-bit Field Mix',
    desc: 'Stereo room stems recorded through matched ribbon pairs with soft headroom limiting.',
    specs: ['48 kHz', '24-bit WAV', '03:42'],
    accent: [0.824, 0.286, 0.122],
    count: 12,
    pinned: false,
    hq: true,
    note: 'Clean room decay on mic B',
  },
  {
    id: 1,
    theme: 'cobalt',
    tag: 'RAW',
    title: 'Cobalt Lens',
    sub: '35mm Prime Study',
    desc: 'Low-light street exposure series shot wide open with calibrated blue-hour white balance.',
    specs: ['f/1.4', '35 mm', 'ISO 640'],
    accent: [0.114, 0.306, 0.847],
    count: 8,
    pinned: false,
    hq: true,
    note: 'Keep shadow toe lifted +6%',
  },
  {
    id: 2,
    theme: 'emerald',
    tag: 'MIDI',
    title: 'Emerald Synth',
    sub: 'FM Poly Patch',
    desc: 'Eight-voice four-operator chord bank with velocity-routed modulator index and chorus.',
    specs: ['8 voices', '4-op FM', '118 BPM'],
    accent: [0.016, 0.471, 0.341],
    count: 19,
    pinned: false,
    hq: true,
    note: 'Mod index peaks on beat 3',
  },
  {
    id: 3,
    theme: 'amber',
    tag: 'PRO',
    title: 'Amber Reel',
    sub: '16mm Film Scan',
    desc: 'Overscanned tungsten daylight roll graded for warm midtones and tight highlight roll-off.',
    specs: ['24 fps', '4K Log', '01:54'],
    accent: [0.706, 0.325, 0.035],
    count: 5,
    pinned: false,
    hq: true,
    note: 'Trim two frames before splice',
  },
];

// #region sdf-shader
export function computeDetailRect(cw, ch) {
  const safeW = Math.max(220, cw || 356);
  const safeH = Math.max(240, ch || 432);
  const insetX = safeW < 520 ? 12 : 28;
  const insetY = safeW < 520 ? 12 : 20;
  const w = Math.max(200, safeW - insetX * 2);
  const h = Math.max(220, safeH - insetY * 2);
  return {
    x: (safeW - w) * 0.5,
    y: (safeH - h) * 0.5,
    w,
    h,
    cx: safeW * 0.5,
    cy: safeH * 0.5,
    r: 20,
  };
}

export function computeContainerBox(slot, detail, morph) {
  const t = clamp(morph, -0.08, 1.08);
  const slotCx = slot.x + slot.w * 0.5;
  const slotCy = slot.y + slot.h * 0.5;
  const cx = slotCx + (detail.cx - slotCx) * t;
  const cy = slotCy + (detail.cy - slotCy) * t;
  const w = Math.max(24, slot.w + (detail.w - slot.w) * t);
  const h = Math.max(24, slot.h + (detail.h - slot.h) * t);
  const slotR = slot.r ?? 14;
  const detailR = detail.r ?? 20;
  const r = Math.max(4, Math.min(w * 0.5, h * 0.5, slotR + (detailR - slotR) * t));
  return {
    cx,
    cy,
    w,
    h,
    x: cx - w * 0.5,
    y: cy - h * 0.5,
    r,
  };
}

// Single-pass WebGL 2 shader compositing #mc-grid and #mc-detail inside a
// continuous sdRoundBox SDF mask with expanding shadow, dim scrim and
// cross-blurred UV scaling between the originating slot and the detail sheet.
export const MORPH_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;       // #mc-grid
uniform sampler2D uDetailTex; // #mc-detail
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;     // cw, ch (CSS px)
uniform vec4 uSlotRect;       // slot.x, slot.y, slot.w, slot.h (CSS px)
uniform vec4 uBoxGeom;        // box.cx, box.cy, box.w, box.h (CSS px)
uniform float uBoxRadius;     // corner radius (CSS px)
uniform float uMorph;         // clamped 0..1 progress
uniform float uShowSdf;       // 0 or 1
uniform vec3 uAccentColor;    // selected slot accent colour
uniform vec3 uCardBg;         // opaque card base fill
uniform vec3 uDetailBg;       // opaque detail sheet base fill

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  float rr = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + vec2(rr);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}

vec3 sampleRegionBlur(sampler2D tex, vec2 uv, vec2 uvMin, vec2 uvMax, float blurPx, vec2 sizePx, vec3 bgFill) {
  vec2 cUv = clamp(uv, uvMin, uvMax);
  if (blurPx <= 0.2) {
    vec4 s = textureLod(tex, cUv, 0.0);
    return s.rgb + bgFill * (1.0 - s.a);
  }
  const int SAMPLES = 16;
  const float GOLDEN_ANGLE = 2.39996323;
  float lod = clamp(blurPx * 0.28, 0.0, 2.2);
  vec2 pxScale = vec2(blurPx) / max(sizePx, vec2(1.0));
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float rad = sqrt((fi + 0.5) / float(SAMPLES));
    float theta = fi * GOLDEN_ANGLE;
    vec2 off = vec2(cos(theta), sin(theta)) * rad * pxScale;
    vec2 sUv = clamp(cUv + off, uvMin, uvMax);
    vec4 s = textureLod(tex, sUv, lod);
    vec3 solid = s.rgb + bgFill * (1.0 - s.a);
    float w = exp(-2.2 * rad * rad);
    acc += solid * w;
    wSum += w;
  }
  return acc / max(wSum, 0.0001);
}

void main() {
  vec2 pCss = vUv * uCanvasSize;

  // Crisp studio stage backdrop
  vec2 bgCentered = (vUv - vec2(0.5, 0.44)) * vec2(1.0, 1.15);
  vec3 stageBg = mix(vec3(0.102, 0.125, 0.184), vec3(0.048, 0.058, 0.092), clamp(length(bgCentered) * 1.12, 0.0, 1.0));

  vec4 gridTex = texture(uTex, vUv);
  vec3 outCol = stageBg * (1.0 - gridTex.a) + gridTex.rgb;

  if (uMorph <= 0.001 && uShowSdf < 0.5) {
    outColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
    return;
  }

  // Hollow out the originating slot gently and dim the background grid
  if (uMorph > 0.001) {
    vec2 slotCenter = uSlotRect.xy + uSlotRect.zw * 0.5;
    float dSlot = sdRoundBox(pCss - slotCenter, uSlotRect.zw * 0.5, 14.0);
    float inSlot = 1.0 - smoothstep(-0.85, 0.85, dSlot);
    vec3 slotRecess = mix(stageBg * 0.72, uAccentColor * 0.25 + vec3(0.06), 0.24);
    outCol = mix(outCol, slotRecess, inSlot * smoothstep(0.0, 0.22, uMorph));

    float scrim = 0.64 * smoothstep(0.0, 0.85, uMorph);
    outCol = mix(outCol, vec3(0.032, 0.040, 0.066), scrim);
  }

  vec2 boxCenter = uBoxGeom.xy;
  vec2 boxHalf = max(uBoxGeom.zw * 0.5, vec2(4.0));
  float dBox = sdRoundBox(pCss - boxCenter, boxHalf, uBoxRadius);

  // Expanding soft ambient elevation shadow beneath the container
  if (uMorph > 0.001) {
    vec2 shadowOffset = vec2(0.0, 3.0 + 14.0 * uMorph);
    float dShadow = sdRoundBox(pCss - (boxCenter + shadowOffset), max(vec2(4.0), boxHalf - vec2(1.0)), uBoxRadius);
    float shadowSpread = 9.0 + 28.0 * uMorph;
    float shadowFalloff = 1.0 - smoothstep(-2.0, shadowSpread, dShadow);
    float ambient = shadowFalloff * shadowFalloff * (0.28 + 0.34 * uMorph);
    float contact = exp(-max(dBox, 0.0) * mix(0.24, 0.09, uMorph)) * 0.34 * uMorph;
    outCol *= 1.0 - clamp(ambient + contact, 0.0, 0.82);
  }

  // Optional SDF iso-contour overlay
  if (uShowSdf > 0.5) {
    float outer = max(dBox, 0.0);
    float iso = smoothstep(0.84, 0.98, abs(cos(outer * 3.14159265 / 12.0)));
    float fade = exp(-outer * 0.018);
    outCol = mix(outCol, mix(uAccentColor, vec3(0.35, 0.82, 0.98), 0.45), (0.16 + 0.42 * iso) * fade);
  }

  if (dBox < 2.0 && uMorph > 0.001) {
    vec2 boxTopLeft = boxCenter - boxHalf;
    vec2 boxUv = clamp((pCss - boxTopLeft) / max(uBoxGeom.zw, vec2(1.0)), vec2(0.0), vec2(1.0));

    // Map container UV back into the exact clicked slot sub-rectangle of uTex
    vec2 slotUvMin = uSlotRect.xy / max(uCanvasSize, vec2(1.0));
    vec2 slotUvMax = (uSlotRect.xy + uSlotRect.zw) / max(uCanvasSize, vec2(1.0));
    vec2 gridHalfPx = vec2(0.75) / max(uCanvasSize, vec2(1.0));
    vec2 srcMin = slotUvMin + gridHalfPx;
    vec2 srcMax = max(srcMin + vec2(0.001), slotUvMax - gridHalfPx);
    vec2 srcUv = mix(srcMin, srcMax, boxUv);

    // Map container UV onto #mc-detail texture
    vec2 dstHalfPx = vec2(0.75) / max(uBoxGeom.zw, vec2(1.0));
    vec2 dstMin = dstHalfPx;
    vec2 dstMax = vec2(1.0) - dstHalfPx;
    vec2 dstUv = clamp(boxUv, dstMin, dstMax);

    float srcWeight = 1.0 - smoothstep(0.10, 0.66, uMorph);
    float dstWeight = smoothstep(0.20, 0.78, uMorph);
    float mixFactor = dstWeight / max(srcWeight + dstWeight, 0.0001);

    float srcBlur = 7.5 * smoothstep(0.0, 0.65, uMorph);
    float dstBlur = 7.5 * (1.0 - smoothstep(0.32, 1.0, uMorph));

    vec3 srcCol = mixFactor < 0.999
      ? sampleRegionBlur(uTex, srcUv, srcMin, srcMax, srcBlur, uCanvasSize, uCardBg)
      : uDetailBg;
    vec3 dstCol = mixFactor > 0.001
      ? sampleRegionBlur(uDetailTex, dstUv, dstMin, dstMax, dstBlur, uBoxGeom.zw, uDetailBg)
      : uCardBg;

    vec3 containerCol = mix(srcCol, dstCol, mixFactor);

    // Subtle frosted accent melt veil at mid-morph, zero at endpoints
    float melt = sin(3.14159265 * clamp(uMorph, 0.0, 1.0));
    containerCol = mix(containerCol, mix(uDetailBg, uAccentColor, 0.14), melt * 0.14);

    // Specular SDF edge highlight
    float rim = exp(-abs(dBox) * 1.4) * (0.24 * uMorph);
    containerCol += mix(vec3(1.0), uAccentColor, 0.25) * rim;

    float containerMask = 1.0 - smoothstep(-0.85, 0.85, dBox);
    outCol = mix(outCol, containerCol, containerMask);
  }

  if (uShowSdf > 0.5) {
    float contour = exp(-abs(dBox) * 1.15) * 0.75;
    outCol = mix(outCol, uAccentColor, contour);
  }

  outColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}`;
// #endregion sdf-shader

// #region spring-morph
export function createMorphSpring(initial = 0) {
  return {
    value: initial,
    velocity: 0,
    target: initial,
    tMs: 0,
    settled: true,
  };
}

export function stepMorphSpring(sp, dtMs, { speed = 1, reduced = false } = {}) {
  const rawDtMs = Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
  sp.tMs += rawDtMs;

  if (reduced) {
    sp.value = sp.target;
    sp.velocity = 0;
    sp.settled = true;
    return sp;
  }

  if (rawDtMs <= 0) return sp;

  const effDt = Math.min(0.05, (rawDtMs / 1000) * speed);
  const stiffness = 230;
  const damping = 22;
  const substeps = effDt > 0.012 ? 3 : 2;
  const h = effDt / substeps;

  for (let i = 0; i < substeps; i++) {
    const accel = stiffness * (sp.target - sp.value) - damping * sp.velocity;
    sp.velocity += accel * h;
    sp.value += sp.velocity * h;
  }

  if (Math.abs(sp.target - sp.value) < 0.0012 && Math.abs(sp.velocity) < 0.006) {
    sp.value = sp.target;
    sp.velocity = 0;
    sp.settled = true;
  } else {
    sp.settled = false;
  }
  return sp;
}
// #endregion spring-morph

export function mountMorphContainer() {
  banner();

  const stageEl = document.getElementById('mc-stage');
  const viewportEl = document.getElementById('mc-viewport');
  const canvas = document.getElementById('mc-canvas');
  const gridEl = document.getElementById('mc-grid');
  const detailEl = document.getElementById('mc-detail');
  const plainHost = document.getElementById('plain-host');
  const noticeEl = document.getElementById('mc-notice');

  const hudSlotEl = document.getElementById('hud-slot');
  const hudMorphEl = document.getElementById('hud-morph');
  const hudRouteEl = document.getElementById('hud-route');

  const morphRange = document.getElementById('ctl-morph');
  const morphOut = document.getElementById('out-morph');
  const slowChk = document.getElementById('ctl-slow');
  const sdfChk = document.getElementById('ctl-sdf');
  const reducedChk = document.getElementById('ctl-reduced');
  const toggleBtn = document.getElementById('btn-toggle');

  const detailSlotEl = document.getElementById('mc-detail-slot');
  const detailTitleEl = document.getElementById('mc-detail-title');
  const detailSubEl = document.getElementById('mc-detail-sub');
  const detailDescEl = document.getElementById('mc-detail-desc');
  const detailSpecsEl = document.getElementById('mc-detail-specs');
  const detailCloseBtn = document.getElementById('mc-close-btn');
  const pillBumpBtn = document.getElementById('mc-pill-bump');
  const pillPinBtn = document.getElementById('mc-pill-pin');
  const pillHqBtn = document.getElementById('mc-pill-hq');
  const noteInput = document.getElementById('mc-note-input');

  const cardEls = Array.from(gridEl.querySelectorAll('.mc-card'));
  const chipBtns = Array.from(gridEl.querySelectorAll('.mc-chip-btn'));
  const openBtns = Array.from(gridEl.querySelectorAll('.mc-open-btn'));
  const pinBadges = Array.from(gridEl.querySelectorAll('.mc-pin-dot'));

  const reducedMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (reducedMQ?.matches) reducedChk.checked = true;

  const isReduced = () => Boolean(reducedChk.checked || reducedMQ?.matches);

  const state = {
    route: 'plain', // 'webgl' | '2d' | 'plain'
    selectedIdx: 0,
    spring: createMorphSpring(0),
    slow: slowChk.checked,
    showSdf: sdfChk.checked,
    hasPainted: false,
    dirtyGrid: true,
    dirtyDetail: true,
    pendingFocusTarget: null,
    onScreen: true,
    rafId: 0,
    lastFrameMs: 0,
    lastHudMs: 0,
    uploads: 0,
    paints: 0,
    slots: [],
    detailRect: computeDetailRect(356, 432),
  };

  let stage = null;
  let ctx2d = null;
  let gridTex = null;
  let detailTex = null;
  let unitCacheKey = '';
  let cachedUnit = 1;
  let lastGridGeoKey = '';
  let lastDetailGeoKey = '';

  const showNotice = (msg) => {
    if (!msg) {
      noticeEl.hidden = true;
      noticeEl.textContent = '';
    } else {
      noticeEl.hidden = false;
      noticeEl.textContent = msg;
    }
  };

  const getViewportSize = () => ({
    cw: canvas.clientWidth || viewportEl.clientWidth || 356,
    ch: canvas.clientHeight || viewportEl.clientHeight || 432,
  });

  function syncStageSizes() {
    if (state.route === 'plain') {
      gridEl.style.width = '';
      gridEl.style.height = '';
      detailEl.style.width = '';
      detailEl.style.height = '';
      return getViewportSize();
    }
    const { cw, ch } = getViewportSize();
    const detailRect = computeDetailRect(cw, ch);
    state.detailRect = detailRect;

    const gridW = `${Math.round(cw)}px`;
    const gridH = `${Math.round(ch)}px`;
    if (gridEl.style.width !== gridW || gridEl.style.height !== gridH) {
      gridEl.style.width = gridW;
      gridEl.style.height = gridH;
    }

    const detW = `${Math.round(detailRect.w)}px`;
    const detH = `${Math.round(detailRect.h)}px`;
    if (detailEl.style.width !== detW || detailEl.style.height !== detH) {
      detailEl.style.width = detW;
      detailEl.style.height = detH;
    }

    measureSlots(cw, ch);
    return { cw, ch };
  }

  function measureSlots(cw, ch) {
    const slots = [];
    for (let i = 0; i < cardEls.length; i++) {
      const card = cardEls[i];
      const w = card.offsetWidth || Math.max(120, (cw - 30) * 0.5);
      const h = card.offsetHeight || Math.max(120, (ch - 30) * 0.5);
      const x = card.offsetLeft;
      const y = card.offsetTop;
      slots.push({
        index: i,
        x,
        y,
        w,
        h,
        cx: x + w * 0.5,
        cy: y + h * 0.5,
        r: 14,
      });
    }
    state.slots = slots;
  }

  function syncCardMarkup(idx) {
    const data = CARDS[idx];
    if (!data) return;
    const chip = chipBtns[idx];
    const badge = pinBadges[idx];
    if (chip) {
      chip.textContent = `★ ${data.count}`;
      chip.setAttribute('aria-label', `Increment ${data.title} counter (${data.count})`);
    }
    if (badge) {
      badge.hidden = !data.pinned;
    }
  }

  function populateDetail(idx) {
    const data = CARDS[idx];
    if (!data) return;
    detailEl.dataset.theme = data.theme;
    detailSlotEl.textContent = `SLOT ${idx + 1} / ${CARDS.length} · ${data.tag}`;
    detailTitleEl.textContent = data.title;
    detailSubEl.textContent = data.sub;
    detailDescEl.textContent = data.desc;

    const specs = detailSpecsEl.querySelectorAll('.mc-spec');
    data.specs.forEach((s, i) => {
      if (specs[i]) specs[i].textContent = s;
    });

    pillBumpBtn.textContent = `+1 Take (${data.count})`;
    pillPinBtn.textContent = data.pinned ? 'Pinned' : 'Pin card';
    pillPinBtn.setAttribute('aria-pressed', String(data.pinned));
    pillHqBtn.textContent = data.hq ? 'HQ master' : 'Draft mode';
    pillHqBtn.setAttribute('aria-pressed', String(data.hq));

    if (noteInput.value !== data.note) {
      noteInput.value = data.note;
    }
    state.dirtyDetail = true;
  }

  function updateControlsUI() {
    const pct = Math.round(clamp(state.spring.value, 0, 1) * 100);
    if (Number(morphRange.value) !== pct) morphRange.value = String(pct);
    morphOut.textContent = `${pct}%`;
    toggleBtn.textContent = state.spring.target >= 0.5 ? 'Collapse slot' : 'Expand slot';
  }

  function updateHud(force = false) {
    const now = performance.now();
    if (!force && now - state.lastHudMs < 90) return;
    state.lastHudMs = now;
    const data = CARDS[state.selectedIdx];
    const pct = Math.round(clamp(state.spring.value, 0, 1) * 100);
    hudSlotEl.textContent = data.title;
    hudMorphEl.textContent = `${pct}%`;
    const routeName =
      state.route === 'webgl'
        ? 'WebGL 2 (ElementGL)'
        : state.route === '2d'
          ? '2D drawElementImage()'
          : 'Plain HTML';
    const mp = state.route === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
    hudRouteEl.textContent = `${routeName} · ${mp} MP · ${state.uploads} uploads`;
  }

  // #region paint-geo
  function syncGeometry(force = false) {
    if (state.route === 'plain') {
      const collapsed = state.spring.value < 0.5 && state.spring.target < 0.5;
      gridEl.inert = false;
      detailEl.dataset.collapsed = collapsed ? 'true' : 'false';
      detailEl.inert = collapsed;
      return;
    }
    if (typeof canvas.updateElementGeometry !== 'function') return;

    const { cw, ch } = getViewportSize();
    const curUnitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${gridEl.currentCSSZoom || 1}`;
    if (curUnitKey !== unitCacheKey && canvas.width > 0 && cw > 0) {
      cachedUnit = geometryUnit(canvas, gridEl, gridEl.offsetWidth || cw);
      unitCacheKey = curUnitKey;
      lastGridGeoKey = '';
      lastDetailGeoKey = '';
    }
    const unit = cachedUnit;
    const showDetail = state.spring.value >= 0.5;

    if (showDetail) {
      if (gridEl.contains(document.activeElement)) {
        document.activeElement.blur?.();
      }
      gridEl.inert = true;
      detailEl.inert = false;
    } else {
      if (detailEl.contains(document.activeElement)) {
        document.activeElement.blur?.();
      }
      gridEl.inert = false;
      detailEl.inert = true;
    }

    const gridKey = showDetail ? 'off' : `on:${unit.toFixed(4)}`;
    if (force || gridKey !== lastGridGeoKey) {
      lastGridGeoKey = gridKey;
      canvas.updateElementGeometry(gridEl, {
        canvasTransform: showDetail ? OFFSTAGE : new DOMMatrix().scale(unit, unit),
      });
      gridEl.dataset.hitTick = gridEl.dataset.hitTick === '1' ? '0' : '1';
    }

    const slot = state.slots[state.selectedIdx] || state.slots[0];
    const box = slot
      ? computeContainerBox(slot, state.detailRect, state.spring.value)
      : state.detailRect;
    const sx = box.w / Math.max(1, state.detailRect.w);
    const sy = box.h / Math.max(1, state.detailRect.h);

    const detKey = !showDetail
      ? 'off'
      : `on:${box.x.toFixed(1)}:${box.y.toFixed(1)}:${sx.toFixed(3)}:${sy.toFixed(3)}:${unit.toFixed(4)}`;
    if (force || detKey !== lastDetailGeoKey) {
      lastDetailGeoKey = detKey;
      canvas.updateElementGeometry(detailEl, {
        canvasTransform: showDetail
          ? new DOMMatrix().scale(unit, unit).translate(box.x, box.y).scale(sx, sy)
          : OFFSTAGE,
      });
      detailEl.dataset.hitTick = detailEl.dataset.hitTick === '1' ? '0' : '1';
    }

    if (showDetail && state.pendingFocusTarget === 'detail') {
      state.pendingFocusTarget = null;
      detailCloseBtn.focus({ preventScroll: true });
    } else if (!showDetail && state.pendingFocusTarget === 'grid') {
      state.pendingFocusTarget = null;
      openBtns[state.selectedIdx]?.focus({ preventScroll: true });
    }
  }

  function drawWebGLPass() {
    if (!stage || stage.lost || !gridTex || !detailTex) return;
    const { cw, ch } = getViewportSize();
    const slot = state.slots[state.selectedIdx] || { x: 12, y: 12, w: cw * 0.45, h: ch * 0.45, r: 14 };
    const box = computeContainerBox(slot, state.detailRect, state.spring.value);
    const fadeT = clamp(state.spring.value, 0, 1);
    const card = CARDS[state.selectedIdx];

    stage.quad(gridEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, detailTex.tex);
      gl.uniform1i(u('uDetailTex'), 1);
      gl.activeTexture(gl.TEXTURE0);

      gl.uniform2f(u('uCanvasSize'), cw, ch);
      gl.uniform4f(u('uSlotRect'), slot.x, slot.y, slot.w, slot.h);
      gl.uniform4f(u('uBoxGeom'), box.cx, box.cy, box.w, box.h);
      gl.uniform1f(u('uBoxRadius'), box.r);
      gl.uniform1f(u('uMorph'), fadeT);
      gl.uniform1f(u('uShowSdf'), state.showSdf ? 1 : 0);
      gl.uniform3f(u('uAccentColor'), card.accent[0], card.accent[1], card.accent[2]);
      gl.uniform3f(u('uCardBg'), 1, 1, 1);
      gl.uniform3f(u('uDetailBg'), 1, 1, 1);
    });
    syncGeometry(false);
    updateHud();
  }

  function renderWebGL(paintEvent, inPaint) {
    if (!stage || stage.lost || !state.hasPainted) return;
    syncStageSizes();
    if (!stage.begin([0.04, 0.05, 0.08, 1])) return;

    if (inPaint) {
      if (paintEvent?.changedElements) {
        for (const changed of paintEvent.changedElements) {
          if (changed === gridEl || gridEl.contains(changed)) state.dirtyGrid = true;
          if (changed === detailEl || detailEl.contains(changed)) state.dirtyDetail = true;
        }
      }
      // Upload only after hasPainted = true inside 'paint' and after stage.begin()
      if (state.dirtyGrid || !gridTex) {
        const tex = stage.upload(gridEl);
        if (tex) {
          stage.gl.bindTexture(stage.gl.TEXTURE_2D, tex.tex);
          stage.gl.texParameteri(stage.gl.TEXTURE_2D, stage.gl.TEXTURE_MIN_FILTER, stage.gl.LINEAR_MIPMAP_LINEAR);
          stage.gl.generateMipmap(stage.gl.TEXTURE_2D);
          gridTex = tex;
          state.dirtyGrid = false;
          state.uploads++;
        }
      }
      if (state.dirtyDetail || !detailTex) {
        const tex = stage.upload(detailEl);
        if (tex) {
          stage.gl.bindTexture(stage.gl.TEXTURE_2D, tex.tex);
          stage.gl.texParameteri(stage.gl.TEXTURE_2D, stage.gl.TEXTURE_MIN_FILTER, stage.gl.LINEAR_MIPMAP_LINEAR);
          stage.gl.generateMipmap(stage.gl.TEXTURE_2D);
          detailTex = tex;
          state.dirtyDetail = false;
          state.uploads++;
        }
      }
    }

    if (!gridTex || !detailTex) return;
    drawWebGLPass();
  }

  canvas.addEventListener('paint', (e) => {
    if (state.route === 'plain') return;
    state.hasPainted = true;
    state.paints++;
    if (state.route === 'webgl' && stage && !stage.lost) {
      renderWebGL(e, true);
      return;
    }
    if (state.route === '2d' && ctx2d) {
      render2DFallback();
    }
  });
  // #endregion paint-geo

  // #region fallbacks
  function render2DFallback() {
    if (!ctx2d || !state.hasPainted) return;
    const { cw, ch } = syncStageSizes();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    ctx2d.reset();
    ctx2d.scale(dpr, dpr);

    ctx2d.fillStyle = '#0d121c';
    ctx2d.fillRect(0, 0, cw, ch);

    try {
      ctx2d.drawElementImage(gridEl, 0, 0, cw, ch);
      state.uploads++;
    } catch {}

    const fadeT = clamp(state.spring.value, 0, 1);
    if (fadeT > 0.001) {
      ctx2d.fillStyle = `rgba(8, 10, 16, ${(0.64 * fadeT).toFixed(3)})`;
      ctx2d.fillRect(0, 0, cw, ch);

      const slot = state.slots[state.selectedIdx] || { x: 12, y: 12, w: cw * 0.45, h: ch * 0.45, r: 14 };
      const box = computeContainerBox(slot, state.detailRect, state.spring.value);

      // Expanding soft ambient drop shadow under the morphing container
      ctx2d.save();
      ctx2d.shadowColor = `rgba(0, 0, 0, ${(0.45 * fadeT).toFixed(3)})`;
      ctx2d.shadowBlur = 10 + 26 * fadeT;
      ctx2d.shadowOffsetY = 3 + 12 * fadeT;
      ctx2d.fillStyle = '#ffffff';
      ctx2d.beginPath();
      ctx2d.roundRect(box.x, box.y, box.w, box.h, box.r);
      ctx2d.fill();
      ctx2d.restore();

      // Clipped 5-arg 2D drawElementImage() cross-fade from slot rect to detail sheet
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.roundRect(box.x, box.y, box.w, box.h, box.r);
      ctx2d.clip();

      const srcAlpha = 1 - clamp((fadeT - 0.1) / 0.56, 0, 1);
      const dstAlpha = clamp((fadeT - 0.2) / 0.58, 0, 1);
      const mixFactor = dstAlpha / Math.max(srcAlpha + dstAlpha, 0.001);

      if (mixFactor < 0.995) {
        const sx = box.w / Math.max(1, slot.w);
        const sy = box.h / Math.max(1, slot.h);
        const gx = box.x - slot.x * sx;
        const gy = box.y - slot.y * sy;
        ctx2d.globalAlpha = 1 - mixFactor;
        try {
          ctx2d.drawElementImage(gridEl, gx, gy, cw * sx, ch * sy);
        } catch {}
      }
      if (mixFactor > 0.005) {
        ctx2d.globalAlpha = mixFactor;
        try {
          ctx2d.drawElementImage(detailEl, box.x, box.y, box.w, box.h);
        } catch {}
      }
      ctx2d.restore();
    }

    syncGeometry(false);
    updateHud();
  }

  function moveChild(parent, child) {
    if (child.parentElement === parent) return;
    if (typeof parent.moveBefore === 'function' && child.isConnected) {
      try {
        parent.moveBefore(child, null);
        return;
      } catch {}
    }
    parent.append(child);
  }

  function enterPlainFallback(reason, { keepForRestore = false } = {}) {
    state.route = 'plain';
    if (!keepForRestore) stopLoop();
    stageEl.classList.add('is-plain');
    moveChild(plainHost, gridEl);
    moveChild(plainHost, detailEl);
    syncStageSizes();
    syncGeometry(true);
    showNotice(reason);
    updateControlsUI();
    updateHud(true);
  }

  function restoreFromPlain() {
    if (state.route === 'webgl') return;
    stageEl.classList.remove('is-plain');
    moveChild(canvas, gridEl);
    moveChild(canvas, detailEl);
    state.route = 'webgl';
    state.hasPainted = false;
    state.dirtyGrid = true;
    state.dirtyDetail = true;
    lastGridGeoKey = '';
    lastDetailGeoKey = '';
    showNotice('');
    syncStageSizes();
    syncGeometry(true);
    updateControlsUI();
    updateHud(true);
    canvas.requestPaint?.();
    if (!state.spring.settled) startLoop();
  }
  // #endregion fallbacks

  function initBackend() {
    const requested = new URLSearchParams(location.search).get('route') || '';

    if (requested === 'plain') {
      enterPlainFallback('Plain HTML route requested (?route=plain).');
      return;
    }

    if (requested !== '2d' && hicSupported && glSupported) {
      try {
        stage = new ElementGL(canvas, {
          fragment: MORPH_FRAG,
          onLost: () => {
            gridTex = null;
            detailTex = null;
            enterPlainFallback(
              'The WebGL 2 context was lost. Showing the cards and detail sheet as plain HTML until restored.',
              { keepForRestore: true }
            );
          },
          onRestored: () => {
            gridTex = null;
            detailTex = null;
            unitCacheKey = '';
            lastGridGeoKey = '';
            lastDetailGeoKey = '';
            stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            restoreFromPlain();
          },
        });
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.route = 'webgl';
        return;
      } catch (err) {
        showNotice(`WebGL 2 could not start (${err.message}). Falling back.`);
      }
    }

    if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
      try {
        ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          state.route = '2d';
          showNotice(
            requested === '2d'
              ? 'Running the 5-argument drawElementImage() 2D clip-morph fallback (?route=2d).'
              : 'WebGL texElementSubImage2D() is unavailable here, so the morph uses the 5-argument drawElementImage() 2D fallback.'
          );
          canvas.addEventListener('contextlost', (e) => {
            e.preventDefault();
            enterPlainFallback('The 2D canvas context was lost. Showing the cards and detail sheet as plain HTML.');
          });
          canvas.addEventListener('contextrestored', () => {
            if (state.route === 'plain' && ctx2d) {
              stageEl.classList.remove('is-plain');
              moveChild(canvas, gridEl);
              moveChild(canvas, detailEl);
              state.route = '2d';
              state.hasPainted = false;
              showNotice('');
              syncStageSizes();
              canvas.requestPaint?.();
            }
          });
          return;
        }
      } catch {}
    }

    enterPlainFallback('HTML-in-canvas is not available here, so the cards and detail sheet are shown as plain HTML.');
  }

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.lastFrameMs = 0;
  }

  function startLoop() {
    if (state.rafId || !state.onScreen || document.hidden || state.route === 'plain') return;
    state.lastFrameMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }

  function requestDraw() {
    if (state.route === 'plain') {
      syncGeometry(false);
      updateControlsUI();
      updateHud(true);
      return;
    }
    if (state.route === 'webgl' && stage && !stage.lost && state.hasPainted && !state.dirtyGrid && !state.dirtyDetail && gridTex && detailTex) {
      renderWebGL(null, false);
    } else {
      canvas.requestPaint?.();
    }
  }

  function tick(now) {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.route === 'plain') return;
    const dtMs = state.lastFrameMs > 0 ? Math.min(50, Math.max(0, now - state.lastFrameMs)) : 16.667;
    state.lastFrameMs = now;

    stepMorphSpring(state.spring, dtMs, {
      speed: state.slow ? 0.25 : 1,
      reduced: isReduced(),
    });
    updateControlsUI();

    if (state.route === 'webgl' && stage && !stage.lost) {
      if (state.dirtyGrid || state.dirtyDetail || !gridTex || !detailTex) {
        canvas.requestPaint?.();
      } else {
        renderWebGL(null, false);
      }
    } else if (state.route === '2d') {
      canvas.requestPaint?.();
    }

    if (!state.spring.settled) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function openCard(idx, { moveFocus = false } = {}) {
    if (idx < 0 || idx >= CARDS.length) return;
    state.selectedIdx = idx;
    populateDetail(idx);
    state.spring.target = 1;
    state.pendingFocusTarget = moveFocus ? 'detail' : null;

    if (isReduced() || state.route === 'plain') {
      stepMorphSpring(state.spring, 16.667, { reduced: true });
    } else {
      state.spring.settled = false;
    }

    syncGeometry(true);
    updateControlsUI();
    updateHud(true);

    if (state.route !== 'plain') {
      canvas.requestPaint?.();
      if (!state.spring.settled) startLoop();
    }
  }

  function collapseCard({ moveFocus = false } = {}) {
    state.spring.target = 0;
    state.pendingFocusTarget = moveFocus ? 'grid' : null;
    if (isReduced() || state.route === 'plain') {
      stepMorphSpring(state.spring, 16.667, { reduced: true });
    } else {
      state.spring.settled = false;
    }

    syncGeometry(true);
    updateControlsUI();
    updateHud(true);

    if (state.route !== 'plain') {
      canvas.requestPaint?.();
      if (!state.spring.settled) startLoop();
    }
  }

  function bumpCounter(idx) {
    const data = CARDS[idx];
    if (!data) return;
    data.count += 1;
    syncCardMarkup(idx);
    state.dirtyGrid = true;
    if (idx === state.selectedIdx) {
      populateDetail(idx);
    }
    requestDraw();
  }

  // Stage text-selection guard (keep editable <input> text selectable)
  viewportEl.addEventListener('selectstart', (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && target.matches('input, textarea')) return;
    e.preventDefault();
  });

  // Grid interactions
  gridEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.mc-chip-btn');
    if (chip) {
      e.stopPropagation();
      bumpCounter(Number(chip.dataset.bump));
      return;
    }
    const openBtn = e.target.closest('.mc-open-btn');
    if (openBtn) {
      e.stopPropagation();
      openCard(Number(openBtn.dataset.open), { moveFocus: true });
      return;
    }
    const card = e.target.closest('.mc-card');
    if (card) {
      openCard(Number(card.dataset.card), { moveFocus: true });
    }
  });

  // Detail sheet interactions
  detailCloseBtn.addEventListener('click', () => collapseCard({ moveFocus: true }));

  pillBumpBtn.addEventListener('click', () => bumpCounter(state.selectedIdx));

  pillPinBtn.addEventListener('click', () => {
    const data = CARDS[state.selectedIdx];
    data.pinned = !data.pinned;
    syncCardMarkup(state.selectedIdx);
    state.dirtyGrid = true;
    populateDetail(state.selectedIdx);
    requestDraw();
  });

  pillHqBtn.addEventListener('click', () => {
    const data = CARDS[state.selectedIdx];
    data.hq = !data.hq;
    populateDetail(state.selectedIdx);
    requestDraw();
  });

  noteInput.addEventListener('input', () => {
    CARDS[state.selectedIdx].note = noteInput.value;
    state.dirtyDetail = true;
    requestDraw();
  });

  for (const el of [gridEl, detailEl]) {
    el.addEventListener('focusin', () => {
      if (el === gridEl) state.dirtyGrid = true;
      else state.dirtyDetail = true;
      if (state.route !== 'plain') canvas.requestPaint?.();
    });
    el.addEventListener('focusout', () => {
      if (el === gridEl) state.dirtyGrid = true;
      else state.dirtyDetail = true;
      if (state.route !== 'plain') canvas.requestPaint?.();
    });
  }

  // Clicking darkened backdrop scrim around #mc-detail collapses it
  canvas.addEventListener('click', (e) => {
    if (e.target === canvas && state.spring.target >= 0.5 && state.spring.value > 0.7) {
      collapseCard({ moveFocus: false });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.spring.target >= 0.5) {
      collapseCard({ moveFocus: detailEl.contains(document.activeElement) });
    }
  });

  // External controls
  morphRange.addEventListener('input', () => {
    stopLoop();
    const v = clamp(Number(morphRange.value) / 100, 0, 1);
    state.spring.value = v;
    state.spring.target = v >= 0.5 ? 1 : 0;
    state.spring.velocity = 0;
    state.spring.settled = true;
    state.pendingFocusTarget = null;
    syncGeometry(false);
    updateControlsUI();
    updateHud(true);
    requestDraw();
  });

  slowChk.addEventListener('change', () => {
    state.slow = slowChk.checked;
  });

  sdfChk.addEventListener('change', () => {
    state.showSdf = sdfChk.checked;
    requestDraw();
  });

  reducedChk.addEventListener('change', () => {
    if (isReduced() && !state.spring.settled) {
      stepMorphSpring(state.spring, 16.667, { reduced: true });
      stopLoop();
      syncGeometry(true);
      updateControlsUI();
      requestDraw();
    }
  });

  reducedMQ?.addEventListener?.('change', () => {
    reducedChk.checked = reducedMQ.matches;
    if (isReduced() && !state.spring.settled) {
      stepMorphSpring(state.spring, 16.667, { reduced: true });
      stopLoop();
      syncGeometry(true);
      updateControlsUI();
      requestDraw();
    }
  });

  toggleBtn.addEventListener('click', () => {
    if (state.spring.target >= 0.5) collapseCard();
    else openCard(state.selectedIdx);
  });

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(
      (entries) => {
        state.onScreen = entries.some((entry) => entry.isIntersecting);
        if (!state.onScreen) {
          stopLoop();
        } else if (state.route !== 'plain') {
          if (!state.spring.settled) startLoop();
          canvas.requestPaint?.();
        }
      },
      { rootMargin: '80px 0px' }
    ).observe(stageEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (state.onScreen && state.route !== 'plain') {
      if (!state.spring.settled) startLoop();
      canvas.requestPaint?.();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (state.route === 'plain') return;
      unitCacheKey = '';
      lastGridGeoKey = '';
      lastDetailGeoKey = '';
      syncStageSizes();
      state.dirtyGrid = true;
      state.dirtyDetail = true;
      syncGeometry(true);
      canvas.requestPaint?.();
    }).observe(viewportEl);
  }

  // Initial setup
  for (let i = 0; i < CARDS.length; i++) syncCardMarkup(i);
  populateDetail(0);
  syncStageSizes();
  initBackend();
  syncGeometry(true);
  updateControlsUI();
  updateHud(true);
  if (state.route !== 'plain') {
    canvas.requestPaint?.();
  }

  // ---------------------------------------------------------------- Live checks (isolated fixtures)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  async function settleGfx(baseActive) {
    if (!window.__gfx?.active) return;
    const deadline = performance.now() + 850;
    while (window.__gfx.active() > baseActive && performance.now() < deadline) {
      await sleep(120);
    }
  }

  function readCssPx(gl, cv, cssX, cssY) {
    const sx = cv.width / Math.max(1, cv.clientWidth);
    const sy = cv.height / Math.max(1, cv.clientHeight);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  function makeDualLayerFixture(w = 280, h = 220) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;

    const grid = document.createElement('div');
    grid.setAttribute('drawable', '');
    grid.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:10px;box-sizing:border-box;display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:10px;background:transparent;`;
    const swatches = ['#ef4444', '#2563eb', '#64748b', '#10b981'];
    grid.innerHTML = swatches.map((bg, i) =>
      `<div data-fx-card="${i}" style="border-radius:12px;background:${bg};color:#fff;padding:8px;display:flex;align-items:flex-end;">` +
      `<button type="button" id="fx-card-btn-${i}" style="min-height:32px;padding:4px 8px;">Card ${i}</button></div>`
    ).join('');

    const detRect = computeDetailRect(w, h);
    const detail = document.createElement('section');
    detail.setAttribute('drawable', '');
    detail.inert = true;
    detail.style.cssText = `position:absolute;left:0;top:0;width:${Math.round(detRect.w)}px;height:${Math.round(detRect.h)}px;border-radius:16px;background:#ffffff;color:#111827;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;`;
    detail.innerHTML =
      '<button type="button" id="fx-detail-close" style="align-self:flex-end;width:96px;height:36px;">Collapse</button>' +
      '<input id="fx-detail-input" type="text" inputmode="none" value="Fixture detail note" style="width:180px;height:36px;">';

    cv.append(grid, detail);
    testStage().append(cv);
    return { cv, grid, detail, detRect };
  }

  function drawFixtureMorph(g, cv, grid, detail, slot, detRect, morphVal, accent) {
    const cw = cv.clientWidth || 280;
    const ch = cv.clientHeight || 220;
    const box = computeContainerBox(slot, detRect, morphVal);
    if (!g.begin([0.04, 0.05, 0.08, 1])) return;
    const tGrid = g.upload(grid);
    g.gl.bindTexture(g.gl.TEXTURE_2D, tGrid.tex);
    g.gl.texParameteri(g.gl.TEXTURE_2D, g.gl.TEXTURE_MIN_FILTER, g.gl.LINEAR_MIPMAP_LINEAR);
    g.gl.generateMipmap(g.gl.TEXTURE_2D);
    const tDetail = g.upload(detail);
    g.gl.bindTexture(g.gl.TEXTURE_2D, tDetail.tex);
    g.gl.texParameteri(g.gl.TEXTURE_2D, g.gl.TEXTURE_MIN_FILTER, g.gl.LINEAR_MIPMAP_LINEAR);
    g.gl.generateMipmap(g.gl.TEXTURE_2D);
    g.quad(grid, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tDetail.tex);
      gl.uniform1i(u('uDetailTex'), 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u('uCanvasSize'), cw, ch);
      gl.uniform4f(u('uSlotRect'), slot.x, slot.y, slot.w, slot.h);
      gl.uniform4f(u('uBoxGeom'), box.cx, box.cy, box.w, box.h);
      gl.uniform1f(u('uBoxRadius'), box.r);
      gl.uniform1f(u('uMorph'), clamp(morphVal, 0, 1));
      gl.uniform1f(u('uShowSdf'), 0);
      gl.uniform3f(u('uAccentColor'), accent[0], accent[1], accent[2]);
      gl.uniform3f(u('uCardBg'), 1, 1, 1);
      gl.uniform3f(u('uDetailBg'), 1, 1, 1);
    });
  }

  const tests = [
    {
      name: 'Dual-layer ElementGL upload (#mc-grid + #mc-detail) renders cleanly with gl.getError() === 0',
      expect: 'pass',
      why: 'Creates an isolated ElementGL canvas with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, gates upload on hasPainted after stage.begin(), and verifies grid card pixels at 0% and expanded detail pixels over dimmed backdrop at 100%.',
      timeout: 6000,
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const { cv, grid, detail, detRect } = makeDualLayerFixture(280, 220);
        let g = null;
        let fxPainted = false;
        let mode = 0;
        try {
          g = new ElementGL(cv, { fragment: MORPH_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          const cards = Array.from(grid.querySelectorAll('[data-fx-card]'));
          const slot0 = { x: cards[0].offsetLeft, y: cards[0].offsetTop, w: cards[0].offsetWidth, h: cards[0].offsetHeight, r: 14 };
          cv.addEventListener('paint', () => {
            fxPainted = true;
            if (!fxPainted || !g || g.lost) return;
            drawFixtureMorph(g, cv, grid, detail, slot0, detRect, mode, [0.85, 0.3, 0.2]);
          });

          await nextPaint(cv);
          const err0 = g.gl.getError();
          const card0Px = readCssPx(g.gl, cv, slot0.x + 18, slot0.y + 18);

          mode = 1;
          await nextPaint(cv);
          const err1 = g.gl.getError();
          const detailCenterPx = readCssPx(g.gl, cv, detRect.cx, detRect.cy);
          const rimScrimPx = readCssPx(g.gl, cv, 4, 4);

          return need(
            fxPainted &&
              err0 === 0 &&
              err1 === 0 &&
              card0Px[0] > 180 &&
              card0Px[1] < 100 &&
              detailCenterPx[0] > 210 &&
              detailCenterPx[1] > 210 &&
              detailCenterPx[2] > 210 &&
              rimScrimPx[0] < 70,
            `glErr=(${err0},${err1}), card0rgb=(${card0Px.slice(0, 3).join(',')}), detailCenter=(${detailCenterPx.slice(0, 3).join(',')}), scrimEdge=(${rimScrimPx.slice(0, 3).join(',')}).`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Source slot morph origin differs for card #0 (top-left) vs card #3 (bottom-right) at t = 0.25',
      expect: 'pass',
      why: 'Renders the same ElementGL fixture at morph t = 0.25 from card #0 (red, top-left) and card #3 (green, bottom-right), verifying container bounds and readPixels() follow each clicked slot.',
      timeout: 6000,
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const { cv, grid, detail, detRect } = makeDualLayerFixture(280, 220);
        let g = null;
        let activeSlot = null;
        let activeAccent = [0.85, 0.3, 0.2];
        try {
          g = new ElementGL(cv, { fragment: MORPH_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          const cards = Array.from(grid.querySelectorAll('[data-fx-card]'));
          const slot0 = { x: cards[0].offsetLeft, y: cards[0].offsetTop, w: cards[0].offsetWidth, h: cards[0].offsetHeight, r: 14 };
          const slot3 = { x: cards[3].offsetLeft, y: cards[3].offsetTop, w: cards[3].offsetWidth, h: cards[3].offsetHeight, r: 14 };
          const box0 = computeContainerBox(slot0, detRect, 0.25);
          const box3 = computeContainerBox(slot3, detRect, 0.25);

          activeSlot = slot0;
          cv.addEventListener('paint', () => {
            if (!g || g.lost || !activeSlot) return;
            drawFixtureMorph(g, cv, grid, detail, activeSlot, detRect, 0.25, activeAccent);
          });

          await nextPaint(cv);
          const px0AtBox0 = readCssPx(g.gl, cv, box0.cx, box0.cy);
          const px0AtBox3 = readCssPx(g.gl, cv, box3.cx, box3.cy);

          activeSlot = slot3;
          activeAccent = [0.06, 0.62, 0.45];
          await nextPaint(cv);
          const px3AtBox0 = readCssPx(g.gl, cv, box0.cx, box0.cy);
          const px3AtBox3 = readCssPx(g.gl, cv, box3.cx, box3.cy);

          const quadOk = box0.cx < 140 && box0.cy < 110 && box3.cx > 140 && box3.cy > 110;
          const slot0Hot = px0AtBox0[0] > px0AtBox0[1] + 50 && px0AtBox3[0] < 90;
          const slot3Hot = px3AtBox3[1] > px3AtBox3[0] + 40 && px3AtBox0[1] < 90;

          return need(
            quadOk && slot0Hot && slot3Hot,
            `box0=(${box0.cx.toFixed(0)},${box0.cy.toFixed(0)}) rgb=(${px0AtBox0.slice(0, 3).join(',')}), box3=(${box3.cx.toFixed(0)},${box3.cy.toFixed(0)}) rgb=(${px3AtBox3.slice(0, 3).join(',')}).`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: '0% -> 100% -> 0% SDF morph bounds and deterministic spring settle (tMs)',
      expect: 'pass',
      why: 'Steps stepMorphSpring() with explicit dtMs across 0% -> 100% -> 0%, Slow 0.25x and reduced-motion snaps, and checks computeContainerBox() bounds and radius interpolation.',
      run: async () => {
        const det = computeDetailRect(356, 432);
        const slot = { x: 183, y: 221, w: 163, h: 201, r: 14 };
        const b0 = computeContainerBox(slot, det, 0);
        const bMid = computeContainerBox(slot, det, 0.5);
        const b1 = computeContainerBox(slot, det, 1);
        const boundsOk =
          Math.abs(b0.w - slot.w) < 0.01 &&
          b0.r === 14 &&
          Math.abs(bMid.r - 17) < 0.01 &&
          Math.abs(b1.w - det.w) < 0.01 &&
          b1.r === 20;

        const sp = createMorphSpring(0);
        sp.target = 1;
        sp.settled = false;
        let peak = 0;
        let expandSteps = 0;
        while (!sp.settled && expandSteps < 200) {
          stepMorphSpring(sp, 16.667, { speed: 1, reduced: false });
          if (sp.value > peak) peak = sp.value;
          expandSteps++;
        }
        const tExpandMs = sp.tMs;

        sp.target = 0;
        sp.settled = false;
        let collapseSteps = 0;
        while (!sp.settled && collapseSteps < 200) {
          stepMorphSpring(sp, 16.667, { speed: 1, reduced: false });
          collapseSteps++;
        }

        const slowSp = createMorphSpring(0);
        slowSp.target = 1;
        slowSp.settled = false;
        for (let i = 0; i < 18; i++) stepMorphSpring(slowSp, 16.667, { speed: 0.25, reduced: false });

        const fastSp = createMorphSpring(0);
        fastSp.target = 1;
        fastSp.settled = false;
        for (let i = 0; i < 18; i++) stepMorphSpring(fastSp, 16.667, { speed: 1, reduced: false });

        const redSp = createMorphSpring(0);
        redSp.target = 1;
        stepMorphSpring(redSp, 16.667, { reduced: true });

        return need(
          boundsOk &&
            peak > 1.005 &&
            expandSteps < 150 &&
            collapseSteps < 150 &&
            sp.value === 0 &&
            slowSp.value < fastSp.value &&
            redSp.value === 1 &&
            redSp.settled,
          `expand=${expandSteps} frames (${tExpandMs.toFixed(0)} ms, peak=${peak.toFixed(3)}), collapse=${collapseSteps} frames, 300ms slow=${slowSp.value.toFixed(2)} < 1x=${fastSp.value.toFixed(2)}, reduced=1 step.`
        );
      },
    },
    {
      name: 'Interactive clicks hit grid cards at 0% and expanded #mc-detail button and input at 100%',
      expect: 'pass',
      why: 'Positions #fx-grid and #fx-detail on an isolated fixture via updateElementGeometry() + geometryUnit() + data-hit-tick, verifying elementsFromPoint() hits card #3 button at 0% and #mc-detail button + <input> at 100%.',
      timeout: 6000,
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available.');
        }
        const baseActive = window.__gfx?.active() ?? 0;
        const { cv, grid, detail, detRect } = makeDualLayerFixture(300, 240);
        let g = null;
        let showDetail = false;
        const cards = Array.from(grid.querySelectorAll('[data-fx-card]'));
        const slot3 = { x: cards[3].offsetLeft, y: cards[3].offsetTop, w: cards[3].offsetWidth, h: cards[3].offsetHeight, r: 14 };
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: MORPH_FRAG });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.addEventListener('paint', () => {
              if (!g || g.lost) return;
              drawFixtureMorph(g, cv, grid, detail, slot3, detRect, showDetail ? 1 : 0, [0.7, 0.35, 0.1]);
            });
          } else {
            const c2 = cv.getContext('2d');
            cv.width = 300;
            cv.height = 240;
            cv.addEventListener('paint', () => {
              c2.reset();
              c2.drawElementImage(showDetail ? detail : grid, showDetail ? detRect.x : 0, showDetail ? detRect.y : 0, showDetail ? detRect.w : 300, showDetail ? detRect.h : 240);
            });
          }

          await nextPaint(cv);
          const unit = geometryUnit(cv, grid, 300);
          const syncFx = (expanded) => {
            showDetail = expanded;
            grid.inert = expanded;
            detail.inert = !expanded;
            cv.updateElementGeometry(grid, { canvasTransform: expanded ? OFFSTAGE : new DOMMatrix().scale(unit, unit) });
            cv.updateElementGeometry(detail, { canvasTransform: expanded ? new DOMMatrix().scale(unit, unit).translate(detRect.x, detRect.y) : OFFSTAGE });
            grid.dataset.hitTick = grid.dataset.hitTick === '1' ? '0' : '1';
            detail.dataset.hitTick = detail.dataset.hitTick === '1' ? '0' : '1';
          };

          const btn3 = grid.querySelector('#fx-card-btn-3');
          let gridClicks = 0;
          btn3.addEventListener('click', () => { gridClicks++; });

          syncFx(false);
          await nextPaint(cv);
          const r3 = btn3.getBoundingClientRect();
          const hitGrid = document.elementsFromPoint(r3.left + r3.width * 0.5, r3.top + r3.height * 0.5);
          const gridOk = hitGrid.includes(btn3);
          if (gridOk) btn3.click();

          const closeBtn = detail.querySelector('#fx-detail-close');
          const inp = detail.querySelector('#fx-detail-input');
          let closeClicks = 0;
          closeBtn.addEventListener('click', () => { closeClicks++; });

          syncFx(true);
          await nextPaint(cv);
          const rc = closeBtn.getBoundingClientRect();
          const ri = inp.getBoundingClientRect();
          const hitClose = document.elementsFromPoint(rc.left + rc.width * 0.5, rc.top + rc.height * 0.5);
          const hitInp = document.elementsFromPoint(ri.left + ri.width * 0.5, ri.top + ri.height * 0.5);
          const detOk = hitClose.includes(closeBtn) && hitInp.includes(inp) && !hitClose.includes(btn3) && grid.inert;
          if (detOk) closeBtn.click();

          return need(
            gridOk && detOk && gridClicks === 1 && closeClicks === 1,
            `0% card3Hit=${gridOk} (clicks=${gridClicks}); 100% closeHit=${hitClose.includes(closeBtn)}, inputHit=${hitInp.includes(inp)} (closeClicks=${closeClicks}).`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Synthetic webglcontextlost/restored and 5-arg 2D drawElementImage() fallback recover cleanly',
      expect: 'pass',
      why: 'Dispatches cancelable webglcontextlost and webglcontextrestored on an ElementGL fixture without calling loseContext(), and checks a 240x180 5-arg 2D clip-morph fallback passes with zero draw-size warnings.',
      timeout: 6000,
      run: async () => {
        if (!hicSupported) throw new Error('HTML-in-canvas is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const wrongBefore = window.__gfx?.draws?.wrong ?? 0;

        // Part A: synthetic context loss + restore
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        const cvGl = document.createElement('canvas');
        cvGl.setAttribute('content', 'drawable');
        cvGl.setAttribute('layoutsubtree', '');
        cvGl.style.cssText = 'position:relative;display:block;width:200px;height:140px;';
        const fxGrid = document.createElement('div');
        fxGrid.setAttribute('drawable', '');
        fxGrid.textContent = 'Grid';
        const fxDet = document.createElement('div');
        fxDet.setAttribute('drawable', '');
        const fxInp = document.createElement('input');
        fxInp.type = 'text';
        fxInp.setAttribute('inputmode', 'none');
        fxInp.value = 'Survived context loss';
        fxDet.append(fxInp);
        cvGl.append(fxGrid, fxDet);
        wrap.append(cvGl, plain);
        testStage().append(wrap);

        let g = null;
        let cv2d = null;
        let copy = null;
        let lostHandled = false;
        let restoredHandled = false;
        try {
          if (glSupported) {
            g = new ElementGL(cvGl, {
              fragment: MORPH_FRAG,
              onLost: () => {
                lostHandled = true;
                plain.append(fxGrid, fxDet);
              },
              onRestored: () => {
                restoredHandled = true;
                g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                cvGl.append(fxGrid, fxDet);
              },
            });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            await nextPaint(cvGl);
          } else {
            cvGl.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lostHandled = true; plain.append(fxGrid, fxDet); });
            cvGl.addEventListener('webglcontextrestored', () => { restoredHandled = true; cvGl.append(fxGrid, fxDet); });
          }

          const evLost = new Event('webglcontextlost', { cancelable: true });
          cvGl.dispatchEvent(evLost);
          const whileLostOk = evLost.defaultPrevented && lostHandled && plain.contains(fxDet) && fxInp.value === 'Survived context loss';
          cvGl.dispatchEvent(new Event('webglcontextrestored'));
          const restoredOk = restoredHandled && cvGl.contains(fxDet) && fxInp.value === 'Survived context loss';

          // Part B: 5-arg 2D clip-morph fallback
          cv2d = document.createElement('canvas');
          cv2d.setAttribute('content', 'drawable');
          cv2d.setAttribute('layoutsubtree', '');
          cv2d.style.cssText = 'position:relative;display:block;width:240px;height:180px;';
          const el2d = document.createElement('div');
          el2d.setAttribute('drawable', '');
          el2d.style.cssText = 'width:240px;height:180px;background:#2563eb;color:#fff;padding:12px;box-sizing:border-box;font:700 14px system-ui;';
          el2d.textContent = '2D Clip Morph';
          cv2d.append(el2d);
          testStage().append(cv2d);

          const c2 = cv2d.getContext('2d');
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2d.width = Math.round(240 * dpr);
          cv2d.height = Math.round(180 * dpr);
          cv2d.addEventListener('paint', () => {
            c2.reset();
            c2.scale(dpr, dpr);
            c2.save();
            c2.beginPath();
            c2.roundRect(24, 20, 192, 140, 18);
            c2.clip();
            c2.drawElementImage(el2d, 0, 0, 240, 180);
            c2.restore();
          });
          await nextPaint(cv2d);

          copy = document.createElement('canvas');
          copy.width = cv2d.width;
          copy.height = cv2d.height;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0);
          const frac2d = inkFraction(cc);

          const wrongDelta = (window.__gfx?.draws?.wrong ?? 0) - wrongBefore;
          return need(
            whileLostOk && restoredOk && frac2d > 0.3 && wrongDelta === 0,
            `lostOk=${whileLostOk}, restoredOk=${restoredOk}, 2dInk=${(frac2d * 100).toFixed(1)}%, wrongDrawSize=${wrongDelta}.`
          );
        } finally {
          if (copy) {
            copy.width = 0;
            copy.height = 0;
            copy.remove();
            window.__gfx?.retire?.(copy);
          }
          if (cv2d) {
            cv2d.width = 0;
            cv2d.height = 0;
            cv2d.remove();
            window.__gfx?.retire(cv2d);
          }
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire(cvGl);
          await settleGfx(baseActive);
        }
      },
    },
    stillDrawn(() => [
      {
        name: 'morph-container stage',
        ink: async () => {
          if (state.route === 'plain') return null;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          if (state.route === 'webgl') {
            if (!stage || stage.lost || !gridTex || !detailTex) return 0;
            return state.uploads >= 2 && state.paints > 0 ? 1 : 0;
          }
          const copy = document.createElement('canvas');
          copy.width = Math.min(240, canvas.width || 1);
          copy.height = Math.min(240, canvas.height || 1);
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(canvas, 0, 0, copy.width, copy.height);
          const f = inkFraction(cc);
          copy.width = 0;
          copy.height = 0;
          copy.remove();
          window.__gfx?.retire?.(copy);
          return f;
        },
        rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
      },
    ]),
  ];

  runTests(document.getElementById('tests'), tests);
}

if (typeof document !== 'undefined' && document.getElementById('mc-canvas')) {
  mountMorphContainer();
}
