import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const STAGGER_DELAY_MS = 48;
export const QUAD_PAD_X = 48;
export const QUAD_PAD_Y = 36;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const ROW_METADATA = [
  { id: 'ks-row-0', badge: 'Active', title: 'Shader pass', note: 'Quad shear + R/B split', pinned: true, hits: 4 },
  { id: 'ks-row-1', badge: 'Active', title: 'Atlas sync', note: 'Dirty-only tex upload', pinned: false, hits: 2 },
  { id: 'ks-row-2', badge: 'Queued', title: 'Hit-test lock', note: 'geometryUnit() matrix', pinned: true, hits: 7 },
  { id: 'ks-row-3', badge: 'Active', title: 'Chroma trail', note: '16-tap velocity smear', pinned: false, hits: 1 },
  { id: 'ks-row-4', badge: 'Queued', title: 'Fallback 2D', note: '5-arg drawElementImage', pinned: false, hits: 3 },
];

export function computeLayout(cw, ch) {
  const safeW = Math.max(220, cw);
  const safeH = Math.max(220, ch);
  const narrow = safeW < 600;
  const padX = narrow ? 10 : 16;
  const padY = narrow ? 12 : 14;
  const gap = narrow ? 10 : 12;
  const rowH = narrow ? 70 : 72;
  const slotW = Math.max(180, safeW - padX * 2);
  const pitch = rowH + gap;
  return { cw: safeW, ch: safeH, padX, padY, gap, rowH, slotW, pitch };
}

export function maxScrollFor(visibleCount, layout) {
  if (visibleCount <= 0) return 0;
  const contentH = layout.padY * 2 + visibleCount * layout.rowH + Math.max(0, visibleCount - 1) * layout.gap;
  return Math.max(0, contentH - layout.ch);
}

// #region spring-wave
/**
 * Build initial settled spring state for a list of row descriptors.
 */
export function createRowStates(count, layout) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const y = layout.padY + i * layout.pitch;
    rows.push({
      index: i,
      visible: true,
      slotIndex: i,
      delayMs: i * STAGGER_DELAY_MS,
      waveStartMs: 0,
      waveLaunched: true,
      preApplied: true,
      pendingImpulseY: 0,
      pendingScaleVel: 0,
      posY: y,
      velY: 0,
      targetY: y,
      scale: 1,
      velScale: 0,
      targetScale: 1,
      alpha: 1,
      velAlpha: 0,
      targetAlpha: 1,
      skewX: 0,
      chromaPx: 0,
      blurPx: 0,
      velDir: 1,
      settled: true,
      lastMs: 0,
    });
  }
  return rows;
}

/**
 * Deterministic 240 Hz symplectic spring solver driven by explicit `tMs`.
 * Cascades each row by its `delayMs` (`rank * 48 ms`), holds light pre-launch
 * elastic coupling before `delayMs`, derives shear (`skewX`), directional blur
 * and R/B chroma split from `velY`, and snaps cleanly to `1:1` on settle.
 */
export function stepRowSprings(rows, tMs, opts = {}) {
  const {
    stiffness = 480,
    dampingRatio = 0.58,
    chromaScale = 1.0,
    reducedMotion = false,
    maxStepSec = 2.0,
  } = opts;

  if (reducedMotion) {
    for (const r of rows) {
      r.posY = r.targetY;
      r.velY = 0;
      r.scale = r.targetScale;
      r.velScale = 0;
      r.alpha = r.targetAlpha;
      r.velAlpha = 0;
      r.pendingImpulseY = 0;
      r.pendingScaleVel = 0;
      r.waveLaunched = true;
      r.preApplied = true;
      r.skewX = 0;
      r.chromaPx = 0;
      r.blurPx = 0;
      r.velDir = 1;
      r.settled = true;
      r.lastMs = tMs;
    }
    return false;
  }

  const k = clamp(Number(stiffness) || 480, 120, 900);
  const zeta = clamp(Number(dampingRatio) || 0.58, 0.35, 0.95);
  const c = 2 * zeta * Math.sqrt(k);
  const kSkewScale = clamp(Number(chromaScale) ?? 1.0, 0, 2.5);
  const subDt = 1 / 240;
  let anyActive = false;

  for (const r of rows) {
    if (r.lastMs == null) r.lastMs = tMs;
    const rawSec = Math.max(0, (tMs - r.lastMs) / 1000);
    const totalSec = Math.min(maxStepSec, rawSec);

    if (totalSec > 0) {
      const steps = Math.max(1, Math.ceil(totalSec / subDt));
      const h = totalSec / steps;
      const stepMs = (totalSec * 1000) / steps;

      for (let s = 0; s < steps; s++) {
        const curMs = r.lastMs + (s + 1) * stepMs;
        const sinceWave = curMs - (r.waveStartMs ?? 0);
        const delay = r.delayMs ?? 0;

        if (sinceWave >= delay) {
          if (!r.waveLaunched) {
            r.waveLaunched = true;
            r.velY += r.pendingImpulseY || 0;
            r.pendingImpulseY = 0;
            r.velScale += r.pendingScaleVel || 0;
            r.pendingScaleVel = 0;
          }
          const ay = (r.targetY - r.posY) * k - r.velY * c;
          r.velY += ay * h;
          r.posY += r.velY * h;

          const as = (r.targetScale - r.scale) * (k * 1.15) - r.velScale * (c * 1.05);
          r.velScale += as * h;
          r.scale = clamp(r.scale + r.velScale * h, 0.5, 1.35);

          const aa = (r.targetAlpha - r.alpha) * (k * 1.35) - r.velAlpha * (c * 1.25);
          r.velAlpha += aa * h;
          r.alpha = clamp(r.alpha + r.velAlpha * h, 0, 1);
        } else {
          if (!r.preApplied && r.pendingImpulseY) {
            r.preApplied = true;
            const preKick = r.pendingImpulseY * 0.14;
            r.velY += preKick;
            r.pendingImpulseY -= preKick;
          }
          // Pre-launch wave tension: lags behind leading rows while building elastic skew
          const kPre = k * 0.06;
          const cPre = c * 1.35;
          const ay = (r.targetY - r.posY) * kPre - r.velY * cPre;
          r.velY += ay * h;
          r.posY += r.velY * h;

          const as = (r.targetScale - r.scale) * (kPre * 1.2) - r.velScale * cPre;
          r.velScale += as * h;
          r.scale = clamp(r.scale + r.velScale * h, 0.5, 1.35);

          const aa = (r.targetAlpha - r.alpha) * (kPre * 1.4) - r.velAlpha * cPre;
          r.velAlpha += aa * h;
          r.alpha = clamp(r.alpha + r.velAlpha * h, 0, 1);
        }
      }
      r.lastMs = tMs;
    }

    const launched = (tMs - (r.waveStartMs ?? 0)) >= (r.delayMs ?? 0);
    const done = launched
      && Math.abs(r.targetY - r.posY) < 0.2
      && Math.abs(r.velY) < 2.5
      && Math.abs(r.targetScale - r.scale) < 0.0025
      && Math.abs(r.velScale) < 0.035
      && Math.abs(r.targetAlpha - r.alpha) < 0.004
      && Math.abs(r.velAlpha) < 0.05;

    if (done) {
      r.posY = r.targetY;
      r.velY = 0;
      r.scale = r.targetScale;
      r.velScale = 0;
      r.alpha = r.targetAlpha;
      r.velAlpha = 0;
      r.skewX = 0;
      r.chromaPx = 0;
      r.blurPx = 0;
      r.velDir = 1;
      r.settled = true;
    } else {
      const speed = Math.abs(r.velY);
      r.velDir = r.velY >= 0 ? 1 : -1;
      // Shear factor: skew = vel * k
      r.skewX = clamp((r.velY / 950) * (0.28 * (0.35 + 0.65 * kSkewScale)), -0.46, 0.46);
      r.chromaPx = clamp((speed / 55) * kSkewScale, 0, 18);
      r.blurPx = clamp(speed / 48, 0, 24);
      r.settled = false;
      anyActive = true;
    }
  }

  return anyActive;
}
// #endregion spring-wave

// #region stagger-shader
export const STAGGER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uPad;
uniform float uScale;
uniform float uSkew;
uniform float uBlurPx;
uniform float uChromaPx;
uniform float uVelSign;
uniform float uOpacity;

in vec2 vUv;
out vec4 outColor;

vec4 sampleCard(vec2 uv, float lod) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec2 px = uv * uSize;
  float edge = clamp(min(px.x, uSize.x - px.x), 0.0, 1.0)
             * clamp(min(px.y, uSize.y - px.y), 0.0, 1.0);
  return textureLod(uTex, uv, lod) * edge;
}

float ign(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715)))) - 0.5;
}

void main() {
  vec2 safeSize = max(uSize, vec2(1.0));
  vec2 quadSize = safeSize + uPad * 2.0;
  vec2 localPx = vUv * quadSize - uPad;
  vec2 cardUv = localPx / safeSize;

  if (uOpacity <= 0.002) {
    discard;
  }

  // Razor-sharp 1:1 passthrough when settled at rest
  if (abs(uSkew) < 0.001 && uBlurPx < 0.12 && uChromaPx < 0.12 && abs(uScale - 1.0) < 0.001 && uOpacity >= 0.999) {
    if (cardUv.x < 0.0 || cardUv.x > 1.0 || cardUv.y < 0.0 || cardUv.y > 1.0) discard;
    outColor = texture(uTex, cardUv);
    return;
  }

  vec2 center = safeSize * 0.5;
  vec2 p = (localPx - center) / max(uScale, 0.2);
  p.x -= uSkew * p.y;
  vec2 baseUv = (p + center) / safeSize;

  if (uBlurPx < 0.15 && uChromaPx < 0.15) {
    outColor = sampleCard(baseUv, 0.0) * uOpacity;
    return;
  }

  float jitter = ign(gl_FragCoord.xy);
  float blurLod = clamp(uBlurPx * 0.045, 0.0, 1.4);
  vec2 blurSpanUv = vec2(uSkew * (uBlurPx * 0.30), uBlurPx) / safeSize;

  vec4 acc = vec4(0.0);
  float wSum = 0.0;
  for (int i = 0; i < 16; i++) {
    float s = (float(i) + 0.5 + jitter) / 16.0 - 0.5;
    float w = 1.0 - 0.45 * abs(s * 2.0);
    acc += sampleCard(baseUv - s * blurSpanUv, blurLod) * w;
    wSum += w;
  }
  vec4 smeared = acc / max(wSum, 0.001);

  if (uChromaPx < 0.15) {
    outColor = smeared * uOpacity;
    return;
  }

  float dir = uVelSign < 0.0 ? -1.0 : 1.0;
  vec2 fringeUv = dir * vec2(uSkew * (uChromaPx * 0.35), uChromaPx) / safeSize;
  vec4 rTap = sampleCard(baseUv + fringeUv, blurLod * 0.35);
  vec4 bTap = sampleCard(baseUv - fringeUv, blurLod * 0.35);
  float mixAmt = clamp(uChromaPx / 8.0, 0.0, 0.92);

  vec4 col = smeared;
  col.r = mix(smeared.r, rTap.r, mixAmt);
  col.b = mix(smeared.b, bTap.b, mixAmt);
  col.a = max(smeared.a, max(rTap.a, bTap.a) * mixAmt * 0.85);
  col.rgb = min(col.rgb, vec3(col.a));
  outColor = col * uOpacity;
}`;
// #endregion stagger-shader

// DOM references
const stageBox = document.getElementById('ks-stage');
const viewportEl = document.getElementById('ks-viewport');
let canvas = document.getElementById('ks-canvas');
const plainHost = document.getElementById('plain-host');
const emptyEl = document.getElementById('ks-empty');
const noticeEl = document.getElementById('ks-notice');
const statusEl = document.getElementById('ks-status');
const testsBody = document.getElementById('tests');

const filterBtns = [...document.querySelectorAll('.ks-filter-btn')];
const shuffleBtn = document.getElementById('btn-shuffle');
const waveBtn = document.getElementById('btn-wave');
const searchInput = document.getElementById('ks-filter-input');
const stiffnessSlider = document.getElementById('ctl-stiffness');
const stiffnessOut = document.getElementById('out-stiffness');
const chromaSlider = document.getElementById('ctl-chroma');
const chromaOut = document.getElementById('out-chroma');
const reducedToggle = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

const rowItems = ROW_METADATA.map((meta, idx) => {
  const el = document.getElementById(meta.id);
  return {
    ...meta,
    index: idx,
    el,
    pinBtn: el.querySelector('.ks-pin'),
    incBtn: el.querySelector('.ks-inc'),
    metaEl: el.querySelector('[data-meta]'),
  };
});
const rowEls = rowItems.map((r) => r.el);

const initialLayout = computeLayout(viewportEl.clientWidth || 340, viewportEl.clientHeight || 368);
const springs = createRowStates(rowItems.length, initialLayout);

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  filter: 'all', // 'all' | 'active' | 'pinned'
  query: '',
  order: [0, 1, 2, 3, 4],
  scrollY: 0,
  scrollTarget: 0,
  scrollVel: 0,
  stiffness: Number(stiffnessSlider.value) || 480,
  chromaScale: Number(chromaSlider.value) || 1.0,
  reducedOverride: reducedToggle.checked,
  onScreen: true,
  hasPainted: false,
  animating: false,
  rafId: 0,
  uploads: 0,
  paints: 0,
  layout: initialLayout,
  unitCache: { key: '', unit: 1 },
  lastGeoKeys: new Array(rowItems.length).fill(''),
  dragging: false,
  dragMoved: 0,
  suppressClick: false,
};

let stage = null;
let ctx2d = null;
const rowTextures = new Map();
const dirtyRows = new Set(rowEls);

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 338);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 368);
  return { cw, ch };
}

function rowMatchesFilter(item) {
  if (state.filter === 'active' && item.badge !== 'Active') return false;
  if (state.filter === 'pinned' && !item.pinned) return false;
  const q = state.query.trim().toLowerCase();
  if (q) {
    const hay = `${item.title} ${item.note} ${item.badge} ${item.pinned ? 'pinned' : 'unpinned'}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function getVisibleOrder() {
  return state.order.filter((idx) => rowMatchesFilter(rowItems[idx]));
}

function syncRowDOM(item) {
  const el = item.el;
  el.dataset.pinned = String(item.pinned);
  item.pinBtn.setAttribute('aria-pressed', String(item.pinned));
  item.pinBtn.textContent = item.pinned ? 'Pinned' : 'Pin';
  const hitLabel = item.hits === 1 ? '1 hit' : `${item.hits} hits`;
  const pinLabel = item.pinned ? 'Pinned' : 'Unpinned';
  item.metaEl.textContent = `${hitLabel} · ${pinLabel} · ${item.note}`;
}

function syncCardSizes(layout) {
  if (state.mode === 'plain') {
    for (const el of rowEls) {
      if (el.style.width) el.style.width = '';
      if (el.style.height) el.style.height = '';
    }
    return;
  }
  const w = `${layout.slotW}px`;
  const h = `${layout.rowH}px`;
  for (const el of rowEls) {
    if (el.style.width !== w) el.style.width = w;
    if (el.style.height !== h) el.style.height = h;
  }
}

function updateTargetsFromOrder({ wave = false, impulsePx = 0, stagger = true } = {}) {
  const layout = state.layout;
  const visible = getVisibleOrder();
  const maxSc = maxScrollFor(visible.length, layout);
  state.scrollTarget = clamp(state.scrollTarget, 0, maxSc);
  if (!wave && !state.dragging && Math.abs(state.scrollVel) < 1) {
    state.scrollY = clamp(state.scrollY, 0, maxSc);
  }
  emptyEl.hidden = visible.length > 0;

  const now = performance.now();
  const visibleRank = new Map(visible.map((idx, rank) => [idx, rank]));

  for (let idx = 0; idx < rowItems.length; idx++) {
    const item = rowItems[idx];
    const sp = springs[idx];
    const rank = visibleRank.get(idx);
    const isVis = rank !== undefined;

    if (state.mode === 'plain') {
      item.el.hidden = !isVis;
      item.el.inert = !isVis;
    } else if (item.el.hidden) {
      item.el.hidden = false;
    }

    if (isVis) {
      const slotY = layout.padY + rank * layout.pitch - state.scrollY;
      const wasHidden = !sp.visible;
      sp.visible = true;
      sp.slotIndex = rank;
      sp.targetY = slotY;
      sp.targetScale = 1;
      sp.targetAlpha = 1;
      if (wasHidden && !isReducedMotion()) {
        sp.posY = slotY + 26;
        sp.scale = 0.88;
        sp.alpha = 0;
      }
      if (wave) {
        sp.waveStartMs = now;
        sp.delayMs = stagger ? rank * STAGGER_DELAY_MS : 0;
        sp.waveLaunched = sp.delayMs === 0;
        sp.preApplied = false;
        sp.pendingImpulseY = sp.delayMs === 0 ? 0 : impulsePx;
        if (sp.delayMs === 0) sp.velY += impulsePx;
        sp.pendingScaleVel = 0;
      }
    } else {
      const exitRank = sp.slotIndex >= 0 ? sp.slotIndex : idx;
      sp.visible = false;
      sp.targetY = sp.posY - 14;
      sp.targetScale = 0.86;
      sp.targetAlpha = 0;
      if (wave) {
        sp.waveStartMs = now;
        sp.delayMs = stagger ? exitRank * 24 : 0;
        sp.waveLaunched = sp.delayMs === 0;
        sp.preApplied = false;
        sp.pendingImpulseY = 0;
      }
    }
    sp.lastMs = now;
  }

  if (state.mode === 'plain') {
    for (const idx of state.order) {
      const el = rowItems[idx].el;
      if (el.parentElement === plainHost) plainHost.append(el);
    }
  }
}

function updateControlsUI() {
  for (const btn of filterBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === state.filter));
  }
  stiffnessSlider.value = String(Math.round(state.stiffness));
  stiffnessOut.textContent = String(Math.round(state.stiffness));
  chromaSlider.value = state.chromaScale.toFixed(1);
  chromaOut.textContent = `${state.chromaScale.toFixed(1)}x`;
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const visCount = getVisibleOrder().length;
  const maxSkew = springs.reduce((m, s) => Math.max(m, Math.abs(s.skewX)), 0);
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const phase = state.animating || maxSkew > 0.005 ? `Wave skew ${maxSkew.toFixed(2)}` : 'Settled 1:1';
  statusEl.textContent =
    `${routeLabel} · ${visCount}/5 rows · ${phase} · ${canvas.width}x${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

// #region geometry-sync
function cachedUnit(targetCanvas, refEl, slotW) {
  const zoom = refEl.currentCSSZoom || 1;
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${Math.round(slotW)}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(targetCanvas, refEl, slotW);
    state.unitCache.key = key;
    state.lastGeoKeys.fill('');
  }
  return state.unitCache.unit;
}

/**
 * Synchronise hit boxes for all 5 rows via updateElementGeometry() scaled by
 * geometryUnit(), marking filtered-out or offscreen rows inert + offstage and
 * toggling data-hit-tick whenever a box moves.
 */
export function syncRowGeometry(force = false) {
  if (state.mode !== 'webgl' || typeof canvas.updateElementGeometry !== 'function') return;
  if (canvas.width <= 0 || canvas.height <= 0) return;

  const layout = state.layout;
  const firstVis = springs.find((s) => s.visible);
  const refEl = rowItems[firstVis ? firstVis.index : 0].el;
  const u = cachedUnit(canvas, refEl, layout.slotW);

  for (let i = 0; i < rowItems.length; i++) {
    const el = rowItems[i].el;
    const sp = springs[i];
    const onScreen = sp.posY + layout.rowH > 2 && sp.posY < layout.ch - 2;
    const interactive = sp.visible && sp.alpha >= 0.15 && onScreen;
    const hidden = !interactive;

    if (el.inert !== hidden) el.inert = hidden;
    const pe = hidden ? 'none' : 'auto';
    if (el.style.pointerEvents !== pe) el.style.pointerEvents = pe;

    let mat;
    let key;
    if (hidden) {
      key = `${canvas.width}x${canvas.height}|off`;
      mat = new DOMMatrix().scale(u, u).multiply(OFFSTAGE);
    } else if (sp.settled) {
      const qy = Math.round(sp.posY * 4) / 4;
      key = `${canvas.width}x${canvas.height}|${layout.padX},${qy}|settled`;
      mat = new DOMMatrix().scale(u, u).translate(layout.padX, sp.posY);
    } else {
      const qy = Math.round(sp.posY * 2) / 2;
      const qs = Math.round(sp.scale * 100) / 100;
      const qk = Math.round(sp.skewX * 100) / 100;
      const cx = layout.slotW * 0.5;
      const cy = layout.rowH * 0.5;
      const skewDeg = (Math.atan(sp.skewX) * 180) / Math.PI;
      key = `${canvas.width}x${canvas.height}|${layout.padX},${qy},${qs},${qk}`;
      mat = new DOMMatrix()
        .scale(u, u)
        .translate(layout.padX, sp.posY)
        .translate(cx, cy)
        .scale(sp.scale, sp.scale)
        .skewX(skewDeg)
        .translate(-cx, -cy);
    }

    if (!force && key === state.lastGeoKeys[i]) continue;
    state.lastGeoKeys[i] = key;
    try {
      canvas.updateElementGeometry(el, { canvasTransform: mat });
    } catch {}
    el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion geometry-sync

function uploadWithMip(stageObj, el) {
  const gl = stageObj.gl;
  gl.activeTexture(gl.TEXTURE0);
  const tex = stageObj.upload(el);
  if (tex) {
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  return tex;
}

function tryUploadRow(el) {
  if (!stage || stage.lost || !state.hasPainted) return null;
  try {
    const tex = uploadWithMip(stage, el);
    if (tex) {
      rowTextures.set(el, tex);
      dirtyRows.delete(el);
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      dirtyRows.add(el);
      canvas.requestPaint?.();
      return rowTextures.get(el) ?? null;
    }
    throw err;
  }
}

function renderWebGL(allowUpload = false, changedSet = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);

  // Size backing store via stage.begin() BEFORE uploading row textures
  if (!stage.begin([0, 0, 0, 0])) return;

  if (allowUpload) {
    for (const el of rowEls) {
      const needs = !rowTextures.has(el) || dirtyRows.has(el) || !changedSet || changedSet.has(el);
      if (needs) tryUploadRow(el);
    }
  }

  syncRowGeometry(false);

  const layout = state.layout;
  for (const idx of state.order) {
    const item = rowItems[idx];
    const sp = springs[idx];
    if (!rowTextures.has(item.el)) continue;
    if (sp.alpha <= 0.002) continue;
    if (sp.posY + layout.rowH + QUAD_PAD_Y < 0 || sp.posY - QUAD_PAD_Y > layout.ch) continue;

    const quadMat = ElementGL.rect(
      canvas,
      layout.padX - QUAD_PAD_X,
      sp.posY - QUAD_PAD_Y,
      layout.slotW + QUAD_PAD_X * 2,
      layout.rowH + QUAD_PAD_Y * 2
    );

    stage.quad(item.el, quadMat, (gl, loc) => {
      gl.uniform2f(loc('uPad'), QUAD_PAD_X, QUAD_PAD_Y);
      gl.uniform1f(loc('uScale'), sp.scale);
      gl.uniform1f(loc('uSkew'), sp.skewX);
      gl.uniform1f(loc('uBlurPx'), sp.blurPx);
      gl.uniform1f(loc('uChromaPx'), sp.chromaPx);
      gl.uniform1f(loc('uVelSign'), sp.velDir);
      gl.uniform1f(loc('uOpacity'), sp.alpha);
    });
  }

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const layout = state.layout;
  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);

  for (const idx of state.order) {
    const item = rowItems[idx];
    const sp = springs[idx];
    const onScreen = sp.posY + layout.rowH > 2 && sp.posY < layout.ch - 2;
    const hidden = !sp.visible || sp.alpha <= 0.02 || !onScreen;
    if (item.el.inert !== hidden) item.el.inert = hidden;
    if (!sp.visible && sp.alpha <= 0.02) continue;

    ctx2d.save();
    ctx2d.globalAlpha = sp.alpha;
    if (sp.blurPx > 0.6) {
      ctx2d.filter = `blur(${Math.min(10, sp.blurPx * 0.45).toFixed(1)}px)`;
    }
    ctx2d.translate(layout.padX + layout.slotW * 0.5, sp.posY + layout.rowH * 0.5);
    ctx2d.transform(1, 0, sp.skewX, 1, 0, 0);
    ctx2d.scale(sp.scale, sp.scale);
    try {
      ctx2d.drawElementImage(item.el, -layout.slotW * 0.5, -layout.rowH * 0.5, layout.slotW, layout.rowH);
      state.uploads++;
    } catch {}
    ctx2d.restore();
  }

  ctx2d.restore();
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  stopLoop();
  state.animating = false;
  stageBox.classList.add('is-plain');

  for (const idx of state.order) {
    const item = rowItems[idx];
    const isVis = rowMatchesFilter(item);
    item.el.hidden = !isVis;
    item.el.inert = !isVis;
    item.el.style.pointerEvents = 'auto';
    if (item.el.parentElement !== plainHost) {
      if (typeof plainHost.moveBefore === 'function' && item.el.isConnected) {
        try { plainHost.moveBefore(item.el, null); } catch { plainHost.append(item.el); }
      } else {
        plainHost.append(item.el);
      }
    } else {
      plainHost.append(item.el);
    }
  }

  syncCardSizes(state.layout);
  showNotice(reason);
  updateControlsUI();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const item of rowItems) {
    item.el.hidden = false;
    if (item.el.parentElement !== canvas) {
      if (typeof canvas.moveBefore === 'function' && item.el.isConnected) {
        try { canvas.moveBefore(item.el, null); } catch { canvas.append(item.el); }
      } else {
        canvas.append(item.el);
      }
    }
  }
  showNotice('');
}
// #endregion fallback-2d

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function drawCurrentFrame(forcePaint = false) {
  if (state.mode === 'plain') {
    updateTargetsFromOrder({ wave: false });
    return;
  }
  if (!forcePaint && state.mode === 'webgl' && stage && !stage.lost && state.hasPainted && rowTextures.size === rowEls.length) {
    renderWebGL(false);
    return;
  }
  canvas.requestPaint?.();
}

let lastRafMs = 0;
function tickWave(now) {
  state.rafId = 0;
  if (!state.animating || !state.onScreen || document.hidden || state.mode === 'plain') {
    lastRafMs = 0;
    return;
  }

  const dt = lastRafMs ? clamp((now - lastRafMs) / 1000, 0.001, 0.05) : 1 / 60;
  lastRafMs = now;

  // Flick coasting + elastic rubber-band scroll bounds
  const visible = getVisibleOrder();
  const maxSc = maxScrollFor(visible.length, state.layout);
  let scrollMoving = false;
  if (!state.dragging) {
    if (Math.abs(state.scrollVel) > 6) {
      state.scrollY += state.scrollVel * dt;
      state.scrollVel *= Math.exp(-dt * 4.8);
      scrollMoving = true;
    } else {
      state.scrollVel = 0;
    }

    if (state.scrollY < 0 || state.scrollY > maxSc) {
      const bound = state.scrollY < 0 ? 0 : maxSc;
      state.scrollY += (bound - state.scrollY) * Math.min(1, dt * 16);
      state.scrollVel *= Math.exp(-dt * 12);
      if (Math.abs(bound - state.scrollY) < 0.35 && Math.abs(state.scrollVel) < 8) {
        state.scrollY = bound;
        state.scrollVel = 0;
      } else {
        scrollMoving = true;
      }
    }
    state.scrollTarget = clamp(state.scrollY, 0, maxSc);
  }

  const rankMap = new Map(visible.map((idx, rank) => [idx, rank]));
  for (let idx = 0; idx < rowItems.length; idx++) {
    const sp = springs[idx];
    const rank = rankMap.get(idx);
    if (rank !== undefined) {
      sp.targetY = state.layout.padY + rank * state.layout.pitch - state.scrollY;
    }
  }

  const springsActive = stepRowSprings(springs, now, {
    stiffness: state.stiffness,
    chromaScale: state.chromaScale,
    reducedMotion: isReducedMotion(),
    maxStepSec: 0.05,
  });

  state.animating = springsActive || scrollMoving || state.dragging;
  drawCurrentFrame(false);

  if (state.animating && state.onScreen && !document.hidden) {
    state.rafId = requestAnimationFrame(tickWave);
  } else {
    state.animating = false;
    lastRafMs = 0;
    updateStatus();
  }
}

function kickAnimation({ wave = true, impulsePx = 560, stagger = true } = {}) {
  const now = performance.now();
  for (const sp of springs) sp.lastMs = now;
  updateTargetsFromOrder({ wave, impulsePx, stagger });

  if (isReducedMotion() || state.mode === 'plain') {
    stepRowSprings(springs, now, {
      stiffness: state.stiffness,
      chromaScale: state.chromaScale,
      reducedMotion: true,
    });
    state.animating = false;
    stopLoop();
    drawCurrentFrame(false);
    return;
  }

  state.animating = true;
  if (state.onScreen && !document.hidden && !state.rafId) {
    lastRafMs = now;
    state.rafId = requestAnimationFrame(tickWave);
  }
}

// Keep native text selection off the canvas rows while allowing the filter input
viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

// Internal live row buttons (Pin & +1)
for (const item of rowItems) {
  syncRowDOM(item);
  item.pinBtn.addEventListener('click', () => {
    if (state.suppressClick) return;
    item.pinned = !item.pinned;
    syncRowDOM(item);
    dirtyRows.add(item.el);
    if (state.filter === 'pinned') {
      kickAnimation({ wave: true, impulsePx: 420, stagger: true });
    } else if (!isReducedMotion() && state.mode !== 'plain') {
      const sp = springs[item.index];
      sp.velY += -240;
      sp.waveStartMs = performance.now();
      sp.delayMs = 0;
      sp.waveLaunched = true;
      sp.lastMs = sp.waveStartMs;
      state.animating = true;
      if (state.onScreen && !document.hidden && !state.rafId) {
        lastRafMs = performance.now();
        state.rafId = requestAnimationFrame(tickWave);
      }
    }
    drawCurrentFrame(true);
  });

  item.incBtn.addEventListener('click', () => {
    if (state.suppressClick) return;
    item.hits++;
    syncRowDOM(item);
    dirtyRows.add(item.el);
    if (!isReducedMotion() && state.mode !== 'plain') {
      const sp = springs[item.index];
      sp.velY += 210;
      sp.velScale += 0.45;
      sp.waveStartMs = performance.now();
      sp.delayMs = 0;
      sp.waveLaunched = true;
      sp.lastMs = sp.waveStartMs;
      state.animating = true;
      if (state.onScreen && !document.hidden && !state.rafId) {
        lastRafMs = performance.now();
        state.rafId = requestAnimationFrame(tickWave);
      }
    }
    drawCurrentFrame(true);
  });
}

// External filter, shuffle, wave, search and slider controls
for (const btn of filterBtns) {
  btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter || 'all';
    state.scrollY = 0;
    state.scrollTarget = 0;
    state.scrollVel = 0;
    updateControlsUI();
    kickAnimation({ wave: true, impulsePx: 520, stagger: true });
  });
}

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  state.scrollY = 0;
  state.scrollTarget = 0;
  state.scrollVel = 0;
  kickAnimation({ wave: true, impulsePx: 380, stagger: true });
});

shuffleBtn.addEventListener('click', () => {
  const prev = state.order.slice();
  const next = state.order.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  if (next.every((v, idx) => v === prev[idx])) {
    next.push(next.shift());
  }
  state.order = next;
  kickAnimation({ wave: true, impulsePx: 620, stagger: true });
});

waveBtn.addEventListener('click', () => {
  kickAnimation({ wave: true, impulsePx: 920, stagger: true });
});

stiffnessSlider.addEventListener('input', () => {
  state.stiffness = Number(stiffnessSlider.value);
  updateControlsUI();
});

chromaSlider.addEventListener('input', () => {
  state.chromaScale = Number(chromaSlider.value);
  updateControlsUI();
  if (state.animating) drawCurrentFrame(false);
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion()) {
    kickAnimation({ wave: false, impulsePx: 0, stagger: false });
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) {
    kickAnimation({ wave: false, impulsePx: 0, stagger: false });
  }
});

// Pointer drag / flick-scroll + wheel inside #ks-canvas
let activePointerId = null;
let dragLastY = 0;
let dragLastT = 0;
let dragVel = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button || state.mode === 'plain') return;
  activePointerId = e.pointerId;
  state.dragMoved = 0;
  state.dragging = false;
  state.suppressClick = false;
  dragLastY = e.clientY;
  dragLastT = e.timeStamp;
  dragVel = 0;
  state.scrollVel = 0;
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId || state.mode === 'plain') return;
  const dy = e.clientY - dragLastY;
  const dt = Math.max(0.004, (e.timeStamp - dragLastT) / 1000);
  state.dragMoved += Math.abs(dy);

  if (!state.dragging && state.dragMoved > 6) {
    state.dragging = true;
    state.suppressClick = true;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  if (state.dragging) {
    const visible = getVisibleOrder();
    const maxSc = maxScrollFor(visible.length, state.layout);
    const over = state.scrollY < 0 || state.scrollY > maxSc;
    const step = -dy * (over ? 0.36 : 1.0);
    state.scrollY = clamp(state.scrollY + step, -56, maxSc + 56);
    state.scrollTarget = clamp(state.scrollY, 0, maxSc);
    dragVel = dragVel * 0.65 + clamp(-dy / dt, -3400, 3400) * 0.35;

    const now = performance.now();
    const rankMap = new Map(visible.map((idx, rank) => [idx, rank]));
    for (let idx = 0; idx < rowItems.length; idx++) {
      const sp = springs[idx];
      const rank = rankMap.get(idx);
      if (rank !== undefined) {
        sp.targetY = state.layout.padY + rank * state.layout.pitch - state.scrollY;
        sp.waveStartMs = now;
        sp.delayMs = 0;
        sp.waveLaunched = true;
        if (isReducedMotion()) {
          sp.posY = sp.targetY;
          sp.velY = 0;
          sp.skewX = 0;
        }
      }
    }
    if (isReducedMotion()) {
      drawCurrentFrame(false);
    } else {
      state.animating = true;
      if (state.onScreen && !document.hidden && !state.rafId) {
        lastRafMs = now;
        state.rafId = requestAnimationFrame(tickWave);
      }
    }
  }

  dragLastY = e.clientY;
  dragLastT = e.timeStamp;
});

function endDrag(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  if (state.dragging) {
    state.dragging = false;
    const freshFlick = e.timeStamp - dragLastT < 90;
    const flick = freshFlick ? clamp(dragVel, -3200, 3200) : 0;
    state.scrollVel = isReducedMotion() ? 0 : flick;
    if (!isReducedMotion() && Math.abs(flick) > 120) {
      const now = performance.now();
      const visible = getVisibleOrder();
      visible.forEach((idx, rank) => {
        const sp = springs[idx];
        sp.waveStartMs = now;
        sp.delayMs = rank * 22;
        sp.waveLaunched = rank === 0;
        sp.preApplied = false;
        sp.pendingImpulseY = clamp(-flick * 0.25, -450, 450);
      });
    }
    state.animating = true;
    if (state.onScreen && !document.hidden && !state.rafId) {
      lastRafMs = performance.now();
      state.rafId = requestAnimationFrame(tickWave);
    }
    setTimeout(() => { state.suppressClick = false; }, 0);
  }
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('click', (e) => {
  if (state.suppressClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

canvas.addEventListener('wheel', (e) => {
  if (state.mode === 'plain') return;
  e.preventDefault();
  const visible = getVisibleOrder();
  const maxSc = maxScrollFor(visible.length, state.layout);
  state.scrollVel = clamp(state.scrollVel + e.deltaY * 4.5, -2400, 2400);
  state.scrollY = clamp(state.scrollY + e.deltaY * 0.45, -40, maxSc + 40);
  if (isReducedMotion()) {
    state.scrollY = clamp(state.scrollY, 0, maxSc);
    state.scrollVel = 0;
    updateTargetsFromOrder({ wave: false });
    stepRowSprings(springs, performance.now(), { reducedMotion: true });
    drawCurrentFrame(false);
    return;
  }
  const now = performance.now();
  visible.forEach((idx, rank) => {
    const sp = springs[idx];
    sp.targetY = state.layout.padY + rank * state.layout.pitch - state.scrollY;
    sp.waveStartMs = now;
    sp.delayMs = rank * 18;
    sp.waveLaunched = rank === 0;
    sp.preApplied = false;
    sp.pendingImpulseY = clamp(-e.deltaY * 1.6, -380, 380);
  });
  state.animating = true;
  if (state.onScreen && !document.hidden && !state.rafId) {
    lastRafMs = now;
    state.rafId = requestAnimationFrame(tickWave);
  }
}, { passive: false });

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    let changed = null;
    if (e?.changedElements?.length) {
      changed = new Set();
      for (const node of e.changedElements) {
        for (const el of rowEls) {
          if (el === node || el.contains(node)) {
            changed.add(el);
            dirtyRows.add(el);
          }
        }
      }
    }
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(true, changed);
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  });

  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the five list rows as plain HTML.');
    }
  });

  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      const { cw, ch } = getViewportSize();
      state.layout = computeLayout(cw, ch);
      syncCardSizes(state.layout);
      updateTargetsFromOrder({ wave: false });
      stepRowSprings(springs, performance.now(), { reducedMotion: true });
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  state.layout = computeLayout(cw, ch);
  syncCardSizes(state.layout);
  updateTargetsFromOrder({ wave: false });
  stepRowSprings(springs, performance.now(), { reducedMotion: true });

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: STAGGER_FRAG,
        onLost: () => {
          rowTextures.clear();
          for (const el of rowEls) dirtyRows.add(el);
          enterPlainFallback('The WebGL 2 context was lost. Showing the five list rows as plain HTML until restored.');
        },
        onRestored: () => {
          rowTextures.clear();
          for (const el of rowEls) dirtyRows.add(el);
          stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          state.unitCache.key = '';
          state.lastGeoKeys.fill('');
          exitPlainFallback();
          const s = getViewportSize();
          state.layout = computeLayout(s.cw, s.ch);
          syncCardSizes(state.layout);
          updateTargetsFromOrder({ wave: false });
          stepRowSprings(springs, performance.now(), { reducedMotion: true });
          syncRowGeometry(true);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.mode = 'webgl';
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'ks-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(...rowEls);
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
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() fallback.');
      }
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the five list rows are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) {
      stopLoop();
    } else if (state.mode !== 'plain') {
      if (state.animating && !state.rafId && !document.hidden) {
        lastRafMs = performance.now();
        state.rafId = requestAnimationFrame(tickWave);
      } else {
        drawCurrentFrame(false);
      }
    }
  }, { threshold: 0.01 }).observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.mode !== 'plain') {
    if (state.animating && !state.rafId) {
      lastRafMs = performance.now();
      state.rafId = requestAnimationFrame(tickWave);
    } else {
      drawCurrentFrame(false);
    }
  }
});

if (typeof ResizeObserver !== 'undefined') {
  let lastBoxKey = '';
  new ResizeObserver(() => {
    if (state.mode !== 'plain') {
      const { cw, ch } = getViewportSize();
      const boxKey = `${cw}x${ch}`;
      if (boxKey === lastBoxKey && state.hasPainted) return;
      lastBoxKey = boxKey;
      state.unitCache.key = '';
      state.lastGeoKeys.fill('');
      state.layout = computeLayout(cw, ch);
      syncCardSizes(state.layout);
      updateTargetsFromOrder({ wave: false });
      if (!state.animating) {
        stepRowSprings(springs, performance.now(), { reducedMotion: true });
      }
      syncRowGeometry(true);
      if (state.hasPainted) drawCurrentFrame(true);
      else canvas.requestPaint?.();
    }
  }).observe(viewportEl);
}

updateControlsUI();
initBackend();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function settleGfx(baseActive, extraMs = 0) {
  if (extraMs > 0) await new Promise((r) => setTimeout(r, extraMs));
  if (!window.__gfx?.active) return;
  const deadline = performance.now() + 800;
  while (window.__gfx.active() > baseActive && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeFixtureRow(w, h, bg, label, btnLabel = 'Pin') {
  const el = document.createElement('article');
  el.setAttribute('drawable', '');
  el.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;background:${bg};color:#fff;padding:6px 10px;display:flex;align-items:center;justify-content:space-between;font:600 12px system-ui;border-radius:6px;`;
  const span = document.createElement('span');
  span.textContent = label;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = btnLabel;
  btn.style.cssText = 'min-width:52px;min-height:26px;border:1px solid #fff;background:#0f172a;color:#fff;font:600 11px system-ui;border-radius:4px;';
  el.append(span, btn);
  return el;
}

function drawFixtureRow(g, cv, el, x, y, w, h, params = {}) {
  const mat = ElementGL.rect(cv, x - QUAD_PAD_X, y - QUAD_PAD_Y, w + QUAD_PAD_X * 2, h + QUAD_PAD_Y * 2);
  g.quad(el, mat, (gl, loc) => {
    gl.uniform2f(loc('uPad'), QUAD_PAD_X, QUAD_PAD_Y);
    gl.uniform1f(loc('uScale'), params.scale ?? 1);
    gl.uniform1f(loc('uSkew'), params.skewX ?? 0);
    gl.uniform1f(loc('uBlurPx'), params.blurPx ?? 0);
    gl.uniform1f(loc('uChromaPx'), params.chromaPx ?? 0);
    gl.uniform1f(loc('uVelSign'), params.velDir ?? 1);
    gl.uniform1f(loc('uOpacity'), params.alpha ?? 1);
  });
}

runTests(testsBody, [
  {
    name: 'All 5 row textures upload cleanly via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture with 5 distinct drawable rows, awaits paint, calls begin() before upload(), draws all 5 settled rows and checks gl.getError() === 0 plus centre readPixels() RGBA.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240, H = 220;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const specs = [
        { y: 6, bg: '#ef4444', label: 'Row 0' },
        { y: 48, bg: '#22c55e', label: 'Row 1' },
        { y: 90, bg: '#2563eb', label: 'Row 2' },
        { y: 132, bg: '#eab308', label: 'Row 3' },
        { y: 174, bg: '#a855f7', label: 'Row 4' },
      ];
      const rows = specs.map((s) => ({ ...s, el: makeFixtureRow(220, 36, s.bg, s.label) }));
      cv.append(...rows.map((r) => r.el));
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: STAGGER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const textures = rows.map((r) => uploadWithMip(g, r.el));
        for (const r of rows) drawFixtureRow(g, cv, r.el, 10, r.y, 220, 36);

        const err = g.gl.getError();
        const px = rows.map((r) => readCssPixel(g.gl, cv, W, H, 100, r.y + 18));
        const texOk = textures.every((t) => t && t.w > 0 && t.h > 0);
        const colorsOk = px[0][0] > 180 && px[0][1] < 90
          && px[1][1] > 160 && px[1][0] < 90
          && px[2][2] > 180 && px[2][0] < 90
          && px[3][0] > 180 && px[3][1] > 150 && px[3][2] < 80
          && px[4][0] > 120 && px[4][2] > 180 && px[4][1] < 110;

        return need(
          err === g.gl.NO_ERROR && texOk && colorsOk,
          `glErr=${err}, tex=[${textures.map((t) => `${t?.w}x${t?.h}`).join(', ')}], alpha=[${px.map((p) => p[3]).join(',')}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Staggered wave propagation at t = 120 ms shows row 0 settled ahead of row 4 lagging/skewing',
    expect: 'pass',
    why: 'Steps stepRowSprings(rows, tMs) with 48 ms per-row stagger across t = 120 ms, t = 230 ms and t = 1200 ms, then renders the t = 120 ms frame on an ElementGL fixture and checks row positions.',
    timeout: 6000,
    run: async () => {
      const fixLayout = computeLayout(260, 220);
      const rows = createRowStates(5, fixLayout);
      for (let i = 0; i < 5; i++) {
        rows[i].posY = 10 + i * 36;
        rows[i].targetY = 66 + i * 36;
        rows[i].delayMs = i * STAGGER_DELAY_MS;
        rows[i].waveStartMs = 0;
        rows[i].waveLaunched = i === 0;
        rows[i].preApplied = false;
        rows[i].pendingImpulseY = i === 0 ? 0 : 120;
        rows[i].lastMs = 0;
        rows[i].settled = false;
      }

      stepRowSprings(rows, 120, { stiffness: 480, chromaScale: 1.0 });
      const rem0At120 = Math.abs(rows[0].targetY - rows[0].posY);
      const rem4At120 = Math.abs(rows[4].targetY - rows[4].posY);
      const skew4At120 = rows[4].skewX;

      stepRowSprings(rows, 230, { stiffness: 480, chromaScale: 1.0 });
      const rem0At230 = Math.abs(rows[0].targetY - rows[0].posY);
      const skew0At230 = Math.abs(rows[0].skewX);
      const skew4At230 = Math.abs(rows[4].skewX);
      const chroma4At230 = rows[4].chromaPx;

      stepRowSprings(rows, 500, { stiffness: 480, chromaScale: 1.0 });
      const row0SettledAt500 = rows[0].settled;

      stepRowSprings(rows, 1200, { stiffness: 480, chromaScale: 1.0 });
      const allSettled = rows.every((r) => r.settled && r.skewX === 0 && r.chromaPx === 0);

      const mathOk = rem0At120 < 4 && rem4At120 > 30 && Math.abs(skew4At120) > 0.005
        && rem0At230 < 4 && skew4At230 > skew0At230 * 4 && skew4At230 > 0.04 && chroma4At230 > 3
        && row0SettledAt500 && allSettled;

      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240, H = 220;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const row0 = makeFixtureRow(200, 26, '#38bdf8', 'Row 0');
      const row4 = makeFixtureRow(200, 26, '#f97316', 'Row 4');
      cv.append(row0, row4);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: STAGGER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        uploadWithMip(g, row0);
        uploadWithMip(g, row4);

        const sim = createRowStates(5, { padY: 10, pitch: 38, rowH: 26 });
        for (let i = 0; i < 5; i++) {
          sim[i].posY = i === 0 ? 12 : 120;
          sim[i].targetY = i === 0 ? 68 : 176;
          sim[i].delayMs = i * STAGGER_DELAY_MS;
          sim[i].waveStartMs = 0;
          sim[i].waveLaunched = i === 0;
          sim[i].preApplied = false;
          sim[i].pendingImpulseY = i === 0 ? 0 : 120;
          sim[i].lastMs = 0;
          sim[i].settled = false;
        }
        stepRowSprings(sim, 120, { stiffness: 480, chromaScale: 1.0 });

        drawFixtureRow(g, cv, row0, 20, sim[0].posY, 200, 26, sim[0]);
        drawFixtureRow(g, cv, row4, 20, sim[4].posY, 200, 26, sim[4]);
        const err = g.gl.getError();

        // Row 0 moved near target (y=68..94), leaving start (y=12) clear; Row 4 still near start (y~132)
        const px0AtTarget = readCssPixel(g.gl, cv, W, H, 100, 81);
        const px4StillLagging = readCssPixel(g.gl, cv, W, H, 100, 142);
        const px4NotAtTarget = readCssPixel(g.gl, cv, W, H, 100, 190);

        return need(
          mathOk && err === 0 && px0AtTarget[3] > 200 && px4StillLagging[3] > 180 && px4NotAtTarget[3] < 40,
          `t120 rem0=${rem0At120.toFixed(1)}px rem4=${rem4At120.toFixed(1)}px skew4=${skew4At120.toFixed(3)}, t230 skew4=${skew4At230.toFixed(3)} chroma4=${chroma4At230.toFixed(1)}px, err=${err}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Velocity skew and R/B chroma split differ measurably from settled 1:1 rest',
    expect: 'pass',
    why: 'Renders a bright high-contrast horizontal row card at rest vs active velocity (skewX = 0.30, blurPx = 14, chromaPx = 10), confirming off-column shear bleed and R/B chromatic channel separation.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 240, H = 160;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = 'position:absolute;left:0;top:0;width:140px;height:68px;box-sizing:border-box;background:#0f172a;border:4px solid #ffffff;display:flex;align-items:center;justify-content:center;';
      const stripe = document.createElement('div');
      stripe.style.cssText = 'width:100px;height:18px;background:#ffffff;';
      card.append(stripe);
      cv.append(card);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: STAGGER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        uploadWithMip(g, card);

        const sampleGrid = () => {
          const out = [];
          for (let gx = 40; gx <= 200; gx += 16) {
            for (let gy = 36; gy <= 124; gy += 12) {
              const p = readCssPixel(g.gl, cv, W, H, gx, gy);
              out.push(p[0], p[1], p[2], p[3]);
            }
          }
          return out;
        };

        // 1. Settled rest: x=50..190, y=46..114
        g.begin([0, 0, 0, 0]);
        drawFixtureRow(g, cv, card, 50, 46, 140, 68, { skewX: 0, blurPx: 0, chromaPx: 0, scale: 1, alpha: 1 });
        const restGrid = sampleGrid();
        const restOutsideRight = readCssPixel(g.gl, cv, W, H, 195, 52);

        // 2. Active wave skew + R/B chroma split
        g.begin([0, 0, 0, 0]);
        drawFixtureRow(g, cv, card, 50, 46, 140, 68, { skewX: 0.30, blurPx: 14, chromaPx: 10, velDir: 1, scale: 1, alpha: 1 });
        const waveGrid = sampleGrid();
        // Top-right corner shears right past x=190 (skew=0.30 * halfH(-28) -> -8.4 or +8.4)
        const waveOutsideRight = readCssPixel(g.gl, cv, W, H, 195, 108);
        const waveOutsideLeft = readCssPixel(g.gl, cv, W, H, 45, 52);

        let sumDiff = 0;
        for (let i = 0; i < restGrid.length; i++) sumDiff += Math.abs(restGrid[i] - waveGrid[i]);
        const meanDiff = sumDiff / restGrid.length;

        let maxRB = 0;
        for (let sy = 40; sy <= 120; sy += 2) {
          const p = readCssPixel(g.gl, cv, W, H, 120, sy);
          maxRB = Math.max(maxRB, Math.abs(p[0] - p[2]));
        }

        const shearDetected = Math.max(waveOutsideRight[3], waveOutsideLeft[3]) > 20 && restOutsideRight[3] === 0;
        return need(
          g.gl.getError() === 0 && shearDetected && maxRB >= 24 && meanDiff > 6,
          `meanDiff=${meanDiff.toFixed(1)}, maxRB=${maxRB}, shearA=${Math.max(waveOutsideRight[3], waveOutsideLeft[3])}, restOutA=${restOutsideRight[3]}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Filtering and shuffling updateElementGeometry() keeps moved button hits accurate and filtered rows inert',
    expect: 'pass',
    why: 'Filters out one row (inert + OFFSTAGE) and shuffles the remaining 3 rows on an isolated fixture, confirming elementsFromPoint() and real clicks land on the moved buttons while skipping the inert row.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype) || !glSupported) {
        throw new Error('updateElementGeometry() or WebGL 2 is not available');
      }
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 260, H = 220;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;

      const counts = [0, 0, 0, 0];
      const rows = [0, 1, 2, 3].map((i) => {
        const el = makeFixtureRow(240, 44, '#1e293b', `Item ${i}`, `Tap ${i}`);
        el.querySelector('button').addEventListener('click', () => { counts[i]++; });
        return el;
      });
      cv.append(...rows);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: STAGGER_FRAG });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        for (const el of rows) uploadWithMip(g, el);

        const u = geometryUnit(cv, rows[0], 240);
        const slotY = (slot) => 10 + slot * 52;

        // Initial order: [0, 1, 2, 3]
        for (let i = 0; i < 4; i++) {
          drawFixtureRow(g, cv, rows[i], 10, slotY(i), 240, 44);
          cv.updateElementGeometry(rows[i], { canvasTransform: new DOMMatrix().scale(u, u).translate(10, slotY(i)) });
          rows[i].dataset.hitTick = '1';
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        // Now filter out Row 1 (inert + OFFSTAGE) and shuffle remaining to [Row 3, Row 2, Row 0]
        rows[1].inert = true;
        rows[1].style.pointerEvents = 'none';
        cv.updateElementGeometry(rows[1], { canvasTransform: new DOMMatrix().scale(u, u).multiply(OFFSTAGE) });
        rows[1].dataset.hitTick = '0';

        const movedOrder = [3, 2, 0];
        g.begin([0, 0, 0, 0]);
        movedOrder.forEach((rowIdx, slot) => {
          const el = rows[rowIdx];
          el.inert = false;
          el.style.pointerEvents = 'auto';
          drawFixtureRow(g, cv, el, 10, slotY(slot), 240, 44);
          cv.updateElementGeometry(el, { canvasTransform: new DOMMatrix().scale(u, u).translate(10, slotY(slot)) });
          el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const btn3 = rows[3].querySelector('button');
        const btn0 = rows[0].querySelector('button');
        const btn1 = rows[1].querySelector('button');
        const r3 = btn3.getBoundingClientRect();
        const r0 = btn0.getBoundingClientRect();
        const hitsSlot0 = document.elementsFromPoint(r3.left + r3.width * 0.5, r3.top + r3.height * 0.5);
        const hitsSlot2 = document.elementsFromPoint(r0.left + r0.width * 0.5, r0.top + r0.height * 0.5);

        btn3.click();
        btn0.click();

        const ok = hitsSlot0.includes(btn3) && !hitsSlot0.includes(btn0) && !hitsSlot0.includes(btn1)
          && hitsSlot2.includes(btn0) && !hitsSlot2.includes(btn1)
          && counts[3] === 1 && counts[0] === 1 && counts[1] === 0;

        return need(
          ok,
          `slot0HitBtn3=${hitsSlot0.includes(btn3)}, slot2HitBtn0=${hitsSlot2.includes(btn0)}, filteredRow1Inert=${rows[1].inert}, clicks=[${counts.join(',')}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-arg 2D drawElementImage() fallback recover cleanly',
    expect: 'pass',
    why: 'Dispatches cancelable webglcontextlost and webglcontextrestored without loseContext(), then draws a skewed row via 5-argument drawElementImage() on a DPR-scaled 2D canvas and retires its readback copy.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('HTML-in-canvas or WebGL 2 is not available');
      const baseActive = window.__gfx?.active?.() ?? 0;
      const W = 220, H = 110;
      const host = document.createElement('div');
      const plain = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;
      const row = makeFixtureRow(200, 64, '#0284c7', 'Recovery');
      cv.append(row);
      host.append(cv, plain);
      testStage().append(host);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      let cv2 = null;

      try {
        g = new ElementGL(cv, {
          fragment: STAGGER_FRAG,
          onLost: () => {
            lostFired = true;
            plain.append(row);
          },
          onRestored: () => {
            restoredFired = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.append(row);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(row);

        const evLost = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(evLost);
        const plainWhileLost = row.parentElement === plain;
        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const texAfter = g.upload(row);
        const errAfter = g.gl.getError();

        // 5-argument 2D drawElementImage() fallback
        cv2 = document.createElement('canvas');
        cv2.setAttribute('content', 'drawable');
        cv2.setAttribute('layoutsubtree', '');
        cv2.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;
        const row2 = makeFixtureRow(180, 56, '#d2491f', '2D fallback');
        cv2.append(row2);
        testStage().append(cv2);

        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        cv2.width = Math.round(W * dpr);
        cv2.height = Math.round(H * dpr);
        const ctx = cv2.getContext('2d');
        await new Promise((resolve) => {
          cv2.addEventListener('paint', () => {
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.translate(110, 55);
            ctx.transform(1, 0, 0.22, 1, 0, 0);
            ctx.drawElementImage(row2, -90, -28, 180, 56);
            ctx.restore();
            resolve();
          }, { once: true });
          cv2.requestPaint();
        });

        const copy = document.createElement('canvas');
        copy.width = cv2.width;
        copy.height = cv2.height;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2, 0, 0);
        const data = cc.getImageData(0, 0, copy.width, copy.height).data;
        copy.width = 0;
        copy.height = 0;
        window.__gfx?.retire?.(copy);

        let nonEmpty = 0;
        for (let i = 3; i < data.length; i += 16) if (data[i] > 10) nonEmpty++;
        const frac = nonEmpty / Math.max(1, data.length / 16);

        return need(
          evLost.defaultPrevented && lostFired && plainWhileLost && restoredFired && row.parentElement === cv
            && texAfter?.w > 0 && errAfter === g.gl.NO_ERROR && frac > 0.20,
          `preventDefault=${evLost.defaultPrevented}, plainWhileLost=${plainWhileLost}, restored=${restoredFired}, err=${errAfter}, 2dFill=${(frac * 100).toFixed(1)}%.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        if (cv2) {
          cv2.width = 0;
          cv2.height = 0;
          cv2.remove();
          window.__gfx?.retire?.(cv2);
        }
        host.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive, 250);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'kinetic-stagger stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !state.hasPainted || rowTextures.size < rowEls.length) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.uploads >= rowEls.length ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
