import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const PAD_TOP = 32;
export const PAD_BOTTOM = 32;
export const SLOT_MAX_GAP = 58;

const stageEl = document.getElementById('slot-stage');
const frameEl = document.getElementById('stage-frame');
let canvas = document.getElementById('slot-canvas');
const articleEl = document.getElementById('slot-article');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('slot-hud');
const editableLine = document.getElementById('editable-line');
const pinBtn = document.getElementById('pin-slot');
const modeSelect = document.getElementById('mode-select');
const routeSelect = document.getElementById('route-select');
const closeSlotBtn = document.getElementById('btn-close-slot');
const reducedToggle = document.getElementById('reduced-toggle');
const anchorChips = Array.from(document.querySelectorAll('.anchor-chip'));
const noticeEl = document.getElementById('slot-notice');
const statusEl = document.getElementById('slot-status');
const testsBody = document.getElementById('tests');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
const fineHoverQuery = typeof matchMedia === 'function'
  ? matchMedia('(hover: hover) and (pointer: fine)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region line-measure
export function measureArticleAnchors(root) {
  const base = root.getBoundingClientRect();
  const w = root.offsetWidth || base.width || 1;
  const h = root.offsetHeight || base.height || 1;
  const kx = base.width ? w / base.width : 1;
  const ky = base.height ? h / base.height : 1;
  const toLocal = (r) => ({
    x: (r.left - base.left) * kx,
    y: (r.top - base.top) * ky,
    w: r.width * kx,
    h: r.height * ky,
  });

  const blocks = new Map();
  const anchors = new Map();

  for (const el of root.querySelectorAll('.anchor-word')) {
    const id = el.dataset.slot;
    if (!id) continue;
    const rects = el.getClientRects();
    const rawAnchor = rects[0] || el.getBoundingClientRect();
    if (!rawAnchor || rawAnchor.width < 0.5) continue;
    const anchorBox = toLocal(rawAnchor);
    const anchorMidY = anchorBox.y + anchorBox.h * 0.5;

    const block = el.closest('p, footer, li, div') || root;
    let blockRects = blocks.get(block);
    if (!blockRects) {
      const range = document.createRange();
      range.selectNodeContents(block);
      blockRects = Array.from(range.getClientRects(), toLocal).filter((b) => b.w > 0.5 && b.h > 0.5);
      blocks.set(block, blockRects);
    }

    // Union every inline box sharing this visual baseline band so ascenders and descenders stay intact.
    let lineTop = anchorBox.y;
    let lineBot = anchorBox.y + anchorBox.h;
    for (const r of blockRects) {
      const rMidY = r.y + r.h * 0.5;
      if (Math.abs(rMidY - anchorMidY) <= Math.max(anchorBox.h, r.h) * 0.65) {
        lineTop = Math.min(lineTop, r.y);
        lineBot = Math.max(lineBot, r.y + r.h);
      }
    }
    lineTop = Math.max(0, lineTop - 1.5);
    lineBot = Math.min(h, lineBot + 1.5);

    anchors.set(id, {
      id,
      el,
      kind: el.localName,
      anchorBox,
      lineTop,
      lineBot,
      lineMidY: (lineTop + lineBot) * 0.5,
    });
  }

  const pinEl = root.querySelector('#pin-slot');
  const editEl = root.querySelector('#editable-line');
  let editBoxes = [];
  if (editEl) {
    const r = document.createRange();
    r.selectNodeContents(editEl);
    editBoxes = Array.from(r.getClientRects(), toLocal).filter((b) => b.w > 0.5 && b.h > 0.5);
  }

  return {
    w,
    h,
    anchors,
    pinBox: pinEl ? toLocal(pinEl.getBoundingClientRect()) : null,
    editBoxes,
  };
}
// #endregion line-measure

// #region slot-shader
export const SLOT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform float uPadTop;
uniform float uGap;
uniform float uMaxGap;
uniform vec2 uLineBand;
uniform vec4 uAnchorRect;
uniform int uMode;
uniform float uReduced;
uniform vec2 uPointer;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec3 sampleArticle(vec2 uv) {
  vec4 s = texture(uTex, clamp(uv, vec2(0.0005), vec2(0.9995)));
  return s.a > 0.002 ? clamp(s.rgb / s.a, 0.0, 1.0) : vec3(0.98, 0.97, 0.95);
}

vec3 backdropPattern(vec2 pCanvas) {
  vec3 base = vec3(0.067, 0.075, 0.094);
  vec2 grid = abs(fract(pCanvas / 24.0 - 0.5) - 0.5) * 24.0;
  float lineMask = 1.0 - smoothstep(0.0, 1.0, min(grid.x, grid.y));
  return mix(base, vec3(0.11, 0.125, 0.16), lineMask * 0.45);
}

vec3 slotPixelBlocks(float artX, float artY, float splitTop, float splitBot, float lineMid, float axMid, float openT) {
  vec2 blockCoord = vec2(artX, artY - lineMid) / 8.0;
  vec2 cell = floor(blockCoord);
  vec2 cellUv = fract(blockCoord);

  float cellBox = step(0.10, cellUv.x) * step(0.10, cellUv.y) * step(cellUv.x, 0.94) * step(cellUv.y, 0.94);
  float tick = uReduced > 0.5 ? 1.0 : floor(uTime * 8.5);
  float staticHash = hash21(cell);
  float animHash = hash21(cell + vec2(mod(tick, 47.0) * 0.37, mod(tick, 31.0) * 0.73));
  float prox = exp(-abs(artX - axMid) / 145.0);
  float wave = 0.5 + 0.5 * sin(cell.x * 0.42 - (uReduced > 0.5 ? 0.0 : uTime * 3.4) + staticHash * 4.0);
  float energy = mix(staticHash, animHash, 0.55) * (0.35 + 0.65 * prox) + wave * 0.18 * prox;

  vec3 blockCol = vec3(0.095, 0.11, 0.155);
  if (energy > 0.79) {
    blockCol = mix(vec3(0.84, 0.29, 0.12), vec3(0.96, 0.74, 0.32), step(0.89, energy));
  } else if (energy > 0.61) {
    blockCol = mix(vec3(0.16, 0.45, 0.68), vec3(0.24, 0.76, 0.96), (energy - 0.61) * 5.0);
  } else if (energy > 0.40) {
    blockCol = vec3(0.16, 0.19, 0.25);
  }

  vec3 col = mix(vec3(0.055, 0.062, 0.085), blockCol, cellBox * (0.25 + 0.75 * openT));

  // Scan telemetry ticks along left and right edges of the slot
  float slotV = (artY - splitTop) / max(1.0, splitBot - splitTop);
  float railX = step(artX, 6.0) + step(uSize.x - 6.0, artX);
  float tickMark = step(0.45, fract(artY * 0.25)) * railX;
  col = mix(col, vec3(0.95, 0.48, 0.28), tickMark * 0.55 * openT * (1.0 - abs(slotV - 0.5) * 1.4));

  float topShadow = smoothstep(0.0, 9.0, artY - splitTop);
  float botShadow = smoothstep(0.0, 9.0, splitBot - artY);
  return col * mix(0.38, 1.0, topShadow * botShadow);
}

vec3 inlineOpticalRibbon(float artX, float artY, float splitTop, float splitBot, float lineMid, float axMid, float texW, float openT) {
  float t = uReduced > 0.5 ? 0.4 : uTime;
  float hSpan = max(1.0, splitBot - splitTop);
  vec2 sv = vec2(artX / texW, (artY - splitTop) / hSpan);

  float warp = sin(sv.x * 7.5 + t * 1.15) * 0.45 + cos(sv.y * 5.2 - t * 0.9) * 0.35;
  float wave = sin(sv.x * 13.0 + warp * 2.4 - t * 1.65) + 0.55 * cos(sv.y * 9.0 + sv.x * 6.0 + t * 1.1);
  float phase = 0.22 * wave + sv.x * 0.65 + (uPointer.x / texW - 0.5) * 0.25;

  vec3 irid = 0.52 + 0.48 * cos(6.28318 * (phase + vec3(0.00, 0.22, 0.54)));
  float caustic = pow(clamp(1.0 - abs(sv.y - 0.5 + 0.16 * sin(sv.x * 9.0 - t * 1.4)) * 2.4, 0.0, 1.0), 2.2);
  float focusLens = exp(-length(vec2((artX - axMid) * 0.45, artY - lineMid)) / 56.0);

  vec3 base = vec3(0.06, 0.075, 0.13);
  vec3 col = mix(base, irid * (0.48 + 0.52 * caustic), 0.72 * openT);
  col += vec3(0.28, 0.82, 0.96) * focusLens * 0.38 * openT;

  float scan = 0.92 + 0.08 * sin(artY * 1.6);
  float topShadow = smoothstep(0.0, 10.0, artY - splitTop);
  float botShadow = smoothstep(0.0, 10.0, splitBot - artY);
  return col * scan * mix(0.42, 1.0, topShadow * botShadow);
}

void main() {
  vec2 pCanvas = vUv * uCanvasSize;
  float artX = pCanvas.x;
  float artY = pCanvas.y - uPadTop;
  float texW = max(uSize.x, 1.0);
  float texH = max(uSize.y, 1.0);
  float shift = uGap * 0.5;
  float openT = clamp(uGap / max(uMaxGap, 1.0), 0.0, 1.0);

  vec3 col = backdropPattern(pCanvas);

  if (openT <= 0.002) {
    if (artY >= 0.0 && artY <= texH && artX >= 0.0 && artX <= texW) {
      col = sampleArticle(vec2(artX / texW, artY / texH));
    }
    outColor = vec4(col, 1.0);
    return;
  }

  float lineTop = uLineBand.x;
  float lineBot = uLineBand.y;
  float lineMid = 0.5 * (lineTop + lineBot);
  float splitTop = lineTop - shift;
  float splitBot = lineBot + shift;
  float axMid = 0.5 * (uAnchorRect.x + uAnchorRect.z);

  if (artY < splitTop) {
    float srcY = artY + shift;
    if (srcY >= 0.0 && srcY <= lineTop && artX >= 0.0 && artX <= texW) {
      float clampedY = clamp(srcY, 0.5, max(0.5, lineTop - 0.35));
      col = sampleArticle(vec2(artX / texW, clampedY / texH));
      float cutRim = 1.0 - smoothstep(0.0, 1.4, splitTop - artY);
      col = mix(col, vec3(0.84, 0.80, 0.73), cutRim * 0.6 * openT);
    }
  } else if (artY > splitBot) {
    float srcY = artY - shift;
    if (srcY >= lineBot && srcY <= texH && artX >= 0.0 && artX <= texW) {
      float clampedY = clamp(srcY, min(texH - 0.5, lineBot + 0.35), texH - 0.5);
      col = sampleArticle(vec2(artX / texW, clampedY / texH));
      float cutRim = 1.0 - smoothstep(0.0, 1.4, artY - splitBot);
      col = mix(col, vec3(0.84, 0.80, 0.73), cutRim * 0.6 * openT);
    }
  } else {
    col = uMode == 0
      ? slotPixelBlocks(artX, artY, splitTop, splitBot, lineMid, axMid, openT)
      : inlineOpticalRibbon(artX, artY, splitTop, splitBot, lineMid, axMid, texW, openT);

    // Anchor line sits unshifted at [lineTop, lineBot] inside the opened cavity
    if (artY >= lineTop && artY <= lineBot && artX >= 0.0 && artX <= texW) {
      vec3 texCol = sampleArticle(vec2(artX / texW, artY / texH));
      vec2 aCenter = 0.5 * (uAnchorRect.xy + uAnchorRect.zw);
      vec2 aHalf = 0.5 * (uAnchorRect.zw - uAnchorRect.xy) + vec2(5.0, 1.5);
      float pillSd = sdRoundBox(vec2(artX, artY) - aCenter, aHalf, 5.0);
      float pillMask = 1.0 - smoothstep(-0.75, 0.75, pillSd);
      float rimMask = (1.0 - smoothstep(0.0, 1.7, abs(pillSd))) * openT;

      float lum = dot(texCol, vec3(0.299, 0.587, 0.114));
      float ink = clamp((0.91 - lum) / 0.62, 0.0, 1.0);
      float sat = max(texCol.r, max(texCol.g, texCol.b)) - min(texCol.r, min(texCol.g, texCol.b));
      float selMask = clamp((sat - 0.22) * 3.0, 0.0, 1.0);

      vec3 ghostCol = mix(col, vec3(0.94, 0.92, 0.88), ink * 0.44);
      ghostCol = mix(ghostCol, texCol, selMask * 0.82);
      vec3 lineOutside = mix(texCol, ghostCol, openT);

      vec3 rimCol = uMode == 0 ? vec3(1.0, 0.48, 0.30) : vec3(0.22, 0.84, 0.98);
      col = mix(lineOutside, texCol, pillMask);
      col = mix(col, rimCol, rimMask * 0.92);
    }
  }

  outColor = vec4(col, 1.0);
}`;
// #endregion slot-shader

// #region hit-map
export function mapCanvasYToArticleY(canvasY, padTop, lineTop, lineBottom, gap) {
  const artY = canvasY - padTop;
  const shift = gap * 0.5;
  if (shift <= 0.01) return { artY, region: 'rest' };
  const splitTop = lineTop - shift;
  const splitBot = lineBottom + shift;
  if (artY < splitTop) return { artY: artY + shift, region: 'above' };
  if (artY > splitBot) return { artY: artY - shift, region: 'below' };
  if (artY >= lineTop && artY <= lineBottom) return { artY, region: 'anchorLine' };
  return { artY: null, region: 'gap' };
}
// #endregion hit-map

export function stepSpringState(st, dt, targetGap, { reduced = false, stiffness = 360, damping = 28 } = {}) {
  if (reduced) {
    st.gap = targetGap;
    st.vel = 0;
    return false;
  }
  const clampedDt = Math.min(0.05, Math.max(0.001, dt));
  const subDt = clampedDt * 0.5;
  for (let i = 0; i < 2; i++) {
    const force = (targetGap - st.gap) * stiffness - st.vel * damping;
    st.vel += force * subDt;
    st.gap += st.vel * subDt;
  }
  if (targetGap === 0 && st.gap < 0.08 && Math.abs(st.vel) < 0.8) {
    st.gap = 0;
    st.vel = 0;
    return false;
  }
  if (Math.abs(targetGap - st.gap) < 0.08 && Math.abs(st.vel) < 0.6) {
    st.gap = targetGap;
    st.vel = 0;
    return false;
  }
  return true;
}

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  effect: 'blocks', // 'blocks' | 'ribbon'
  hoveredAnchorId: null,
  lockedAnchorId: null,
  selectedAnchorId: null,
  pinned: false,
  lastAnchorId: 'compositor',
  gap: 0,
  vel: 0,
  targetGap: 0,
  geoShift: 0,
  pointer: { x: 180, y: 120 },
  reducedOverride: reducedToggle.checked,
  onScreen: true,
  tabHidden: document.hidden,
  hasPainted: false,
  uploads: 0,
  paints: 0,
  measure: null,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  lastCanvasCssH: 0,
  lastTime: 0,
  rafId: 0,
};

let stage = null;
let ctx2d = null;
let articleTex = null;

function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function activeAnchorId() {
  if (state.lockedAnchorId) return state.lockedAnchorId;
  if (state.selectedAnchorId) return state.selectedAnchorId;
  if (state.hoveredAnchorId) return state.hoveredAnchorId;
  if (state.pinned) return state.lastAnchorId;
  return null;
}

function getCanvasSize() {
  const cw = Math.max(1, canvas.clientWidth || frameEl.clientWidth || 340);
  const artH = Math.max(120, state.measure?.h || articleEl.offsetHeight || 340);
  const ch = Math.max(1, Math.ceil(artH + PAD_TOP + PAD_BOTTOM));
  return { cw, ch, artH };
}

function syncCanvasCssHeight() {
  if (state.mode === 'plain') return;
  const artH = articleEl.offsetHeight;
  if (!artH) return;
  const targetH = Math.ceil(artH + PAD_TOP + PAD_BOTTOM);
  if (Math.abs(targetH - state.lastCanvasCssH) > 0.6) {
    state.lastCanvasCssH = targetH;
    canvas.style.height = `${targetH}px`;
  }
}

function refreshMeasurements() {
  syncCanvasCssHeight();
  state.measure = measureArticleAnchors(articleEl);
  syncCanvasCssHeight();
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function syncAnchorAria() {
  const id = activeAnchorId();
  for (const el of articleEl.querySelectorAll('.anchor-word')) {
    const want = String(el.dataset.slot === id);
    if (el.getAttribute('aria-expanded') !== want) el.setAttribute('aria-expanded', want);
  }
  for (const chip of anchorChips) {
    const want = String(chip.dataset.chip === state.lockedAnchorId);
    if (chip.getAttribute('aria-pressed') !== want) chip.setAttribute('aria-pressed', want);
  }
  const pinWant = String(state.pinned);
  if (pinBtn.getAttribute('aria-pressed') !== pinWant) pinBtn.setAttribute('aria-pressed', pinWant);
  if (id) state.lastAnchorId = id;
  // Keep HUD inside the drawable article stable across spring frames so updating text never triggers paint loops.
  const nextHud = id ? `slot · ${id}${state.pinned ? ' (pinned)' : ''}` : 'rest · click or hover';
  if (hudEl.textContent !== nextHud) hudEl.textContent = nextHud;
}

function updateStatus() {
  const id = activeAnchorId() ?? state.lastAnchorId;
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D 9-arg drawElementImage()'
      : 'Plain HTML';
  const effectLabel = state.effect === 'blocks' ? 'pixel blocks' : 'GLSL ribbon';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const stateLabel = state.gap > 0.5 ? `slot(${id}) ${state.gap.toFixed(0)} px` : 'rest';
  statusEl.textContent =
    `${routeLabel} · ${effectLabel} · ${stateLabel} · ${canvas.width}x${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

function cachedUnit(cw) {
  const zoom = articleEl.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${cw}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, articleEl, cw);
    state.unitCache.key = key;
    state.lastGeoKey = '';
  }
  return state.unitCache.unit;
}

function syncArticleGeometry(force = false) {
  if (state.mode === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;
  if (state.mode !== 'webgl') return;
  const { cw, ch } = getCanvasSize();
  const shift = state.geoShift;
  const geoKey = `${cw}x${ch}|${shift.toFixed(1)}`;
  if (!force && geoKey === state.lastGeoKey) return;
  state.lastGeoKey = geoKey;
  const u = cachedUnit(cw);
  canvas.updateElementGeometry(articleEl, {
    canvasTransform: new DOMMatrix().translate(0, (PAD_TOP + shift) * u).scale(u, u),
  });
  articleEl.dataset.hitTick = articleEl.dataset.hitTick === '1' ? '0' : '1';
}

function currentAnchorMetrics() {
  if (!state.measure) state.measure = measureArticleAnchors(articleEl);
  const id = activeAnchorId() ?? state.lastAnchorId;
  return state.measure.anchors.get(id) ?? state.measure.anchors.values().next().value ?? {
    lineTop: 60,
    lineBot: 90,
    lineMidY: 75,
    anchorBox: { x: 40, y: 62, w: 80, h: 24 },
  };
}

function uploadArticleTexture() {
  if (!stage || stage.lost || !state.hasPainted) return null;
  try {
    const tex = stage.upload(articleEl);
    if (tex) {
      articleTex = tex;
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      state.hasPainted = false;
      canvas.requestPaint?.();
      return articleTex;
    }
    throw err;
  }
}

function drawWebGLFrame() {
  if (!stage || stage.lost || !state.hasPainted || !articleTex) return;
  const { cw, ch } = getCanvasSize();
  if (!stage.begin([0.067, 0.075, 0.094, 1])) return;
  syncArticleGeometry(false);
  const m = currentAnchorMetrics();
  const ax0 = m.anchorBox.x;
  const ay0 = m.anchorBox.y;
  const ax1 = ax0 + m.anchorBox.w;
  const ay1 = ay0 + m.anchorBox.h;

  stage.quad(articleEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform1f(loc('uPadTop'), PAD_TOP);
    gl.uniform1f(loc('uGap'), state.gap);
    gl.uniform1f(loc('uMaxGap'), SLOT_MAX_GAP);
    gl.uniform2f(loc('uLineBand'), m.lineTop, m.lineBot);
    gl.uniform4f(loc('uAnchorRect'), ax0, ay0, ax1, ay1);
    gl.uniform1i(loc('uMode'), state.effect === 'blocks' ? 0 : 1);
    gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1 : 0);
    gl.uniform2f(loc('uPointer'), state.pointer.x, state.pointer.y);
  });

  state.paints++;
  syncAnchorAria();
  updateStatus();
}

// #region fallback-2d
function render2D() {
  if (!ctx2d || !state.hasPainted) return;
  const { cw, ch, artH } = getCanvasSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.fillStyle = '#111318';
  ctx2d.fillRect(0, 0, cw, ch);

  if (state.gap <= 0.5) {
    try {
      ctx2d.drawElementImage(articleEl, 0, PAD_TOP, cw, artH);
    } catch {
      canvas.requestPaint?.();
      return;
    }
    state.paints++;
    syncAnchorAria();
    updateStatus();
    return;
  }

  const m = currentAnchorMetrics();
  const shift = state.gap * 0.5;
  const splitTop = m.lineTop - shift;
  const splitBot = m.lineBot + shift;
  const slotH = splitBot - splitTop;

  // Draw the opened slot cavity (quantised 8 px blocks or gradient ribbon)
  if (state.effect === 'blocks') {
    const step = 8;
    const t = isReducedMotion() ? 0 : Math.floor(performance.now() / 120);
    for (let y = PAD_TOP + splitTop; y < PAD_TOP + splitBot; y += step) {
      for (let x = 0; x < cw; x += step) {
        const seed = Math.abs(Math.sin((x * 12.9898 + y * 78.233 + t * 3.17))) % 1;
        ctx2d.fillStyle = seed > 0.82 ? '#d2491f' : seed > 0.64 ? '#38bdf8' : seed > 0.42 ? '#293040' : '#181c26';
        ctx2d.fillRect(x + 1, y + 1, step - 2, Math.min(step - 2, PAD_TOP + splitBot - y));
      }
    }
  } else {
    const grad = ctx2d.createLinearGradient(0, PAD_TOP + splitTop, cw, PAD_TOP + splitBot);
    grad.addColorStop(0, '#131629');
    grad.addColorStop(0.32, '#22d3ee');
    grad.addColorStop(0.65, '#ff7a4d');
    grad.addColorStop(1, '#1c1836');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, PAD_TOP + splitTop, cw, slotH);
  }

  try {
    if (m.lineTop > 1) {
      ctx2d.drawElementImage(articleEl, 0, 0, cw, m.lineTop, 0, PAD_TOP - shift, cw, m.lineTop);
    }
    const belowH = artH - m.lineBot;
    if (belowH > 1) {
      ctx2d.drawElementImage(articleEl, 0, m.lineBot, cw, belowH, 0, PAD_TOP + m.lineBot + shift, cw, belowH);
    }
    const ax = Math.max(0, m.anchorBox.x - 4);
    const ay = Math.max(0, m.anchorBox.y - 1);
    const aw = Math.min(cw - ax, m.anchorBox.w + 8);
    const ah = Math.min(artH - ay, m.anchorBox.h + 2);
    if (aw > 1 && ah > 1) {
      ctx2d.drawElementImage(articleEl, ax, ay, aw, ah, ax, PAD_TOP + ay, aw, ah);
      ctx2d.strokeStyle = state.effect === 'blocks' ? '#ff7a4d' : '#38bdf8';
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeRect(ax, PAD_TOP + ay, aw, ah);
    }
    ctx2d.strokeStyle = '#d6d0c4';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, PAD_TOP + splitTop);
    ctx2d.lineTo(cw, PAD_TOP + splitTop);
    ctx2d.moveTo(0, PAD_TOP + splitBot);
    ctx2d.lineTo(cw, PAD_TOP + splitBot);
    ctx2d.stroke();
    // Restore the whole element's hit region with an empty-clip 5-arg draw.
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(0, 0, 0, 0);
    ctx2d.clip();
    ctx2d.drawElementImage(articleEl, 0, PAD_TOP, cw, artH);
    ctx2d.restore();
  } catch {
    canvas.requestPaint?.();
    return;
  }

  state.paints++;
  syncAnchorAria();
  updateStatus();
}
// #endregion fallback-2d

function drawCurrentFrame() {
  if (state.mode === 'webgl') drawWebGLFrame();
  else if (state.mode === '2d') render2D();
}

function shouldKeepAnimating(moving) {
  if (!state.onScreen || state.tabHidden || state.mode === 'plain') return false;
  if (isReducedMotion()) return false;
  return moving || state.gap > 0.5;
}

function scheduleAnimation() {
  if (state.rafId || !state.onScreen || state.tabHidden || state.mode === 'plain') return;
  state.lastTime = performance.now();
  state.rafId = requestAnimationFrame(stepLoop);
}

function stepLoop(now) {
  state.rafId = 0;
  const dt = (now - (state.lastTime || now)) / 1000;
  state.lastTime = now;
  const moving = stepSpringState(state, dt, state.targetGap, { reduced: isReducedMotion() });
  drawCurrentFrame();
  if (shouldKeepAnimating(moving)) {
    state.rafId = requestAnimationFrame(stepLoop);
  }
}

function updateSlotTarget() {
  const id = activeAnchorId();
  state.targetGap = id ? SLOT_MAX_GAP : 0;
  if (!id && state.geoShift !== 0) {
    state.geoShift = 0;
    syncArticleGeometry(true);
  }
  syncAnchorAria();
  if (isReducedMotion()) {
    state.gap = state.targetGap;
    state.vel = 0;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    drawCurrentFrame();
  } else {
    scheduleAnimation();
  }
}

function toggleLockAnchor(id) {
  state.lockedAnchorId = state.lockedAnchorId === id ? null : id;
  if (state.lockedAnchorId) state.lastAnchorId = state.lockedAnchorId;
  state.geoShift = 0;
  syncArticleGeometry(true);
  updateSlotTarget();
}

function findAnchorAtPoint(artX, artY) {
  if (!state.measure) return null;
  for (const m of state.measure.anchors.values()) {
    const b = m.anchorBox;
    if (artX >= b.x - 4 && artX <= b.x + b.w + 4 && artY >= b.y - 3 && artY <= b.y + b.h + 3) {
      return m;
    }
  }
  return null;
}

function pointInBoxes(x, y, boxes, pad = 3) {
  for (const b of boxes) {
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return true;
  }
  return false;
}

function canvasLocalPoint(event) {
  const r = canvas.getBoundingClientRect();
  return { x: event.clientX - r.left, y: event.clientY - r.top };
}

function handleCanvasPointerMove(event) {
  if (state.mode === 'plain') return;
  const pt = canvasLocalPoint(event);
  state.pointer.x = pt.x;
  state.pointer.y = pt.y - PAD_TOP;
  if (event.pointerType === 'mouse' && fineHoverQuery.matches && !state.lockedAnchorId && !state.pinned) {
    const m = currentAnchorMetrics();
    const mapped = mapCanvasYToArticleY(pt.y, PAD_TOP, m.lineTop, m.lineBot, state.gap);
    const hit = mapped.artY !== null ? findAnchorAtPoint(pt.x, mapped.artY) : null;
    const nextHover = hit ? hit.id : null;
    if (nextHover !== state.hoveredAnchorId) {
      state.hoveredAnchorId = nextHover;
      updateSlotTarget();
    }
  }
  if (state.effect === 'ribbon' && state.gap > 0.5 && isReducedMotion()) {
    drawCurrentFrame();
  }
}

function handleCanvasPointerLeave() {
  if (state.hoveredAnchorId !== null) {
    state.hoveredAnchorId = null;
    updateSlotTarget();
  }
}

function handleArticleClick(event) {
  if (state.mode === 'plain') {
    const anchor = event.target.closest?.('.anchor-word');
    if (anchor) {
      event.preventDefault();
      toggleLockAnchor(anchor.dataset.slot);
    }
    return;
  }

  const isPointer = event.detail > 0 || event.clientX !== 0 || event.clientY !== 0;
  if (isPointer) {
    const pt = canvasLocalPoint(event);
    const m = currentAnchorMetrics();
    const mapped = mapCanvasYToArticleY(pt.y, PAD_TOP, m.lineTop, m.lineBot, state.gap);

    if (mapped.artY !== null && state.measure) {
      const visualAnchor = findAnchorAtPoint(pt.x, mapped.artY);
      if (visualAnchor) {
        event.preventDefault();
        toggleLockAnchor(visualAnchor.id);
        return;
      }
      if (state.measure.pinBox && pointInBoxes(pt.x, mapped.artY, [state.measure.pinBox], 4)) {
        event.preventDefault();
        togglePinSlot();
        return;
      }
      if (state.measure.editBoxes.length && pointInBoxes(pt.x, mapped.artY, state.measure.editBoxes, 4)) {
        state.geoShift = mapped.region === 'below' ? state.gap * 0.5 : mapped.region === 'above' ? -state.gap * 0.5 : 0;
        syncArticleGeometry(true);
        if (document.activeElement !== editableLine) editableLine.focus({ preventScroll: true });
        return;
      }
    }
  }

  // Fallback for keyboard Enter/Space synthetic clicks (clientX === 0 && clientY === 0)
  const anchorEl = event.target.closest?.('.anchor-word');
  if (anchorEl) {
    event.preventDefault();
    toggleLockAnchor(anchorEl.dataset.slot);
  }
}

function togglePinSlot() {
  state.pinned = !state.pinned;
  if (state.pinned && !state.lockedAnchorId) {
    state.lockedAnchorId = state.hoveredAnchorId ?? state.selectedAnchorId ?? state.lastAnchorId;
  } else if (!state.pinned && state.lockedAnchorId) {
    state.lockedAnchorId = null;
  }
  state.geoShift = 0;
  syncArticleGeometry(true);
  updateSlotTarget();
}

function enterPlainFallback(reason) {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.mode = 'plain';
  frameEl.classList.add('is-plain');
  plainHost.hidden = false;
  if (articleEl.parentElement !== plainHost) plainHost.append(articleEl);
  articleEl.inert = false;
  articleEl.style.pointerEvents = 'auto';
  showNotice(reason);
  syncAnchorAria();
  updateStatus();
}

function exitPlainFallback(targetCanvas) {
  frameEl.classList.remove('is-plain');
  plainHost.hidden = true;
  if (articleEl.parentElement !== targetCanvas) targetCanvas.append(articleEl);
  showNotice('');
  refreshMeasurements();
}

function swapToFreshCanvas() {
  const old = canvas;
  const fresh = document.createElement('canvas');
  fresh.id = 'slot-canvas';
  fresh.setAttribute('content', 'drawable');
  fresh.setAttribute('layoutsubtree', '');
  fresh.setAttribute('aria-label', old.getAttribute('aria-label') || '');
  fresh.append(articleEl);
  old.replaceWith(fresh);
  window.__gfx?.retire?.(old);
  canvas = fresh;
  state.hasPainted = false;
  state.lastGeoKey = '';
  state.unitCache.key = '';
  state.lastCanvasCssH = 0;
  wireCanvasEvents(canvas);
  refreshMeasurements();
  return fresh;
}

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', () => {
    if (cv !== canvas) return;
    state.hasPainted = true;
    if (!state.measure) refreshMeasurements();
    if (state.mode === 'webgl' && stage && !stage.lost) {
      uploadArticleTexture();
      drawWebGLFrame();
    } else if (state.mode === '2d' && ctx2d) {
      render2D();
    }
  });
  cv.addEventListener('pointermove', handleCanvasPointerMove);
  cv.addEventListener('pointerleave', handleCanvasPointerLeave);
  cv.addEventListener('click', handleArticleClick);
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the essay as plain HTML.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      exitPlainFallback(canvas);
      canvas.requestPaint?.();
    }
  });
}

function startRoute(wantRoute) {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  articleTex = null;

  if (!hicSupported) {
    routeSelect.disabled = true;
    enterPlainFallback('HTML-in-canvas is not available in this browser, so the essay is shown as plain HTML.');
    return;
  }

  if (wantRoute === 'webgl' && glSupported) {
    if (ctx2d) {
      ctx2d = null;
      swapToFreshCanvas();
    }
    try {
      stage = new ElementGL(canvas, {
        fragment: SLOT_FRAG,
        onLost: () => {
          articleTex = null;
          enterPlainFallback('The WebGL 2 context was lost. Showing the essay as plain HTML until restored.');
        },
        onRestored: () => {
          articleTex = null;
          state.mode = 'webgl';
          exitPlainFallback(canvas);
          state.lastGeoKey = '';
          syncArticleGeometry(true);
          canvas.requestPaint?.();
        },
      });
      state.mode = 'webgl';
      routeSelect.value = 'webgl';
      showNotice('');
      refreshMeasurements();
      syncArticleGeometry(true);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      swapToFreshCanvas();
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D 9-arg fallback.`);
    }
  } else if (stage) {
    stage.dispose();
    stage = null;
    swapToFreshCanvas();
  }

  if ('requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      routeSelect.value = '2d';
      if (!glSupported) {
        routeSelect.querySelector('option[value="webgl"]').disabled = true;
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using 9-argument drawElementImage().');
        }
      } else {
        showNotice('');
      }
      refreshMeasurements();
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('Canvas drawing is unavailable here, so the essay is shown as plain HTML.');
}

// Wire DOM events
editableLine.addEventListener('input', () => {
  refreshMeasurements();
  canvas.requestPaint?.();
});

editableLine.addEventListener('focusin', () => {
  if (state.gap > 0.5) {
    state.geoShift = state.gap * 0.5;
    syncArticleGeometry(true);
  }
});

editableLine.addEventListener('focusout', () => {
  if (state.geoShift !== 0) {
    state.geoShift = 0;
    syncArticleGeometry(true);
  }
});

articleEl.addEventListener('focusin', (e) => {
  const anchor = e.target.closest?.('.anchor-word');
  if (anchor && state.geoShift !== 0) {
    state.geoShift = 0;
    syncArticleGeometry(true);
  }
});

pinBtn.addEventListener('click', (e) => {
  if (state.mode === 'plain' || (e.clientX === 0 && e.clientY === 0)) {
    togglePinSlot();
  }
});

document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    if (state.selectedAnchorId !== null) {
      state.selectedAnchorId = null;
      updateSlotTarget();
    }
    return;
  }
  const range = sel.getRangeAt(0);
  if (!articleEl.contains(range.commonAncestorContainer)) return;
  let found = null;
  for (const el of articleEl.querySelectorAll('.anchor-word')) {
    try {
      if (range.intersectsNode(el)) {
        found = el.dataset.slot;
        break;
      }
    } catch {}
  }
  if (found !== state.selectedAnchorId) {
    state.selectedAnchorId = found;
    updateSlotTarget();
  }
});

modeSelect.addEventListener('change', () => {
  state.effect = modeSelect.value;
  if (!activeAnchorId()) {
    state.lockedAnchorId = state.lastAnchorId;
    updateSlotTarget();
  } else {
    drawCurrentFrame();
  }
});

routeSelect.addEventListener('change', () => {
  startRoute(routeSelect.value);
});

closeSlotBtn.addEventListener('click', () => {
  state.hoveredAnchorId = null;
  state.lockedAnchorId = null;
  state.selectedAnchorId = null;
  state.pinned = false;
  updateSlotTarget();
});

for (const chip of anchorChips) {
  chip.addEventListener('click', () => {
    toggleLockAnchor(chip.dataset.chip);
  });
}

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion()) {
    state.gap = state.targetGap;
    state.vel = 0;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    drawCurrentFrame();
  } else if (state.gap > 0.5) {
    scheduleAnimation();
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) {
    state.gap = state.targetGap;
    state.vel = 0;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    drawCurrentFrame();
  }
});

document.addEventListener('visibilitychange', () => {
  state.tabHidden = document.hidden;
  if (state.tabHidden) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else if (shouldKeepAnimating(false)) {
    scheduleAnimation();
  }
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else if (state.mode !== 'plain') {
    if (shouldKeepAnimating(false)) scheduleAnimation();
    else if (state.hasPainted) drawCurrentFrame();
  }
}).observe(stageEl);

new ResizeObserver(() => {
  if (state.mode === 'plain') return;
  state.unitCache.key = '';
  state.lastGeoKey = '';
  refreshMeasurements();
  syncArticleGeometry(true);
  canvas.requestPaint?.();
}).observe(frameEl);

// Boot
refreshMeasurements();
document.fonts?.ready?.then(() => {
  if (state.mode !== 'plain') {
    refreshMeasurements();
    syncArticleGeometry(true);
    drawCurrentFrame();
  }
});
wireCanvasEvents(canvas);
const requestedRoute = new URLSearchParams(location.search).get('route');
startRoute(requestedRoute === '2d' ? '2d' : 'webgl');
syncAnchorAria();
updateStatus();

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function retireAndWait(cv) {
  cv.remove();
  window.__gfx?.retire?.(cv);
  const t0 = performance.now();
  while (window.__gfx?.active?.() > 1 && performance.now() - t0 < 800) {
    await new Promise((r) => setTimeout(r, 80));
  }
}

function makeFixture(w = 280, h = 220) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const art = document.createElement('article');
  art.setAttribute('drawable', '');
  art.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;box-sizing:border-box;padding:12px 14px;` +
    'background:#faf8f3;color:#1c1b18;font:14px/1.85 Georgia,serif';

  const p1 = document.createElement('p');
  p1.style.cssText = 'margin:0 0 8px';
  p1.textContent = 'First line sits in the upper strip above the slot.';

  const p2 = document.createElement('p');
  p2.style.cssText = 'margin:0 0 8px';
  const beforeTxt = document.createTextNode('Middle ');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'anchor-word';
  btn.dataset.slot = 'compositor';
  btn.textContent = 'compositor';
  btn.style.cssText =
    'display:inline;font:inherit;line-height:inherit;color:#b43912;background:#f2e8df;' +
    'border:0;border-bottom:1.5px solid #d2491f;border-radius:3px;padding:0 4px';
  const afterTxt = document.createTextNode(' anchor holds steady.');
  p2.append(beforeTxt, btn, afterTxt);

  const p3 = document.createElement('p');
  p3.style.cssText = 'margin:0';
  p3.textContent = 'Bottom line slides downward when the slot opens.';

  art.append(p1, p2, p3);
  cv.append(art);
  return { cv, art, btn };
}

runTests(testsBody, [
  {
    name: 'ElementGL slices and renders the 3-strip slot shader via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), waits for paint, measures Range line bounds, uploads once and draws the 3-strip split shader.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280, H = 220;
      const { cv, art } = makeFixture(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SLOT_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const meas = measureArticleAnchors(art);
        const m = meas.anchors.get('compositor');
        const tex = g.upload(art);
        g.begin([0.067, 0.075, 0.094, 1]);
        g.quad(art, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.uniform2f(loc('uCanvasSize'), W, H);
          gl.uniform1f(loc('uPadTop'), PAD_TOP);
          gl.uniform1f(loc('uGap'), 48);
          gl.uniform1f(loc('uMaxGap'), SLOT_MAX_GAP);
          gl.uniform2f(loc('uLineBand'), m.lineTop, m.lineBot);
          gl.uniform4f(loc('uAnchorRect'), m.anchorBox.x, m.anchorBox.y, m.anchorBox.x + m.anchorBox.w, m.anchorBox.y + m.anchorBox.h);
          gl.uniform1i(loc('uMode'), 0);
          gl.uniform1f(loc('uReduced'), 1);
          gl.uniform2f(loc('uPointer'), W * 0.5, m.lineMidY);
        });
        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR && tex?.w > 0 && m.lineBot > m.lineTop,
          `gl.getError()=${err}, texture=${tex?.w}x${tex?.h}, anchor band=[${m.lineTop.toFixed(1)}, ${m.lineBot.toFixed(1)}] px.`
        );
      } finally {
        g?.dispose();
        await retireAndWait(cv);
      }
    },
  },
  {
    name: 'Pixel readback proves a dark patterned slot gap opens above and below the unshifted anchor word',
    expect: 'pass',
    why: 'Samples gl.readPixels() at rest (gap=0) vs open (gap=48) above lineTop, below lineBot and on the anchor word itself.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280, H = 220;
      const { cv, art } = makeFixture(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SLOT_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const meas = measureArticleAnchors(art);
        const m = meas.anchors.get('compositor');
        g.upload(art);

        const drawAtGap = (gap) => {
          g.begin([0.067, 0.075, 0.094, 1]);
          g.quad(art, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform1f(loc('uPadTop'), PAD_TOP);
            gl.uniform1f(loc('uGap'), gap);
            gl.uniform1f(loc('uMaxGap'), SLOT_MAX_GAP);
            gl.uniform2f(loc('uLineBand'), m.lineTop, m.lineBot);
            gl.uniform4f(loc('uAnchorRect'), m.anchorBox.x, m.anchorBox.y, m.anchorBox.x + m.anchorBox.w, m.anchorBox.y + m.anchorBox.h);
            gl.uniform1i(loc('uMode'), 0);
            gl.uniform1f(loc('uReduced'), 1);
            gl.uniform2f(loc('uPointer'), W * 0.5, m.lineMidY);
          });
        };

        const sampleCss = (cssX, cssY) => {
          const px = new Uint8Array(4);
          const rx = Math.max(0, Math.min(cv.width - 1, Math.round((cssX / W) * cv.width)));
          const ry = Math.max(0, Math.min(cv.height - 1, Math.round((1 - cssY / H) * cv.height)));
          g.gl.readPixels(rx, ry, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, px);
          return px;
        };
        const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

        const probeX = W - 26;
        const aboveGapY = PAD_TOP + m.lineTop - 10;
        const belowGapY = PAD_TOP + m.lineBot + 10;
        const anchorMidX = m.anchorBox.x + m.anchorBox.w * 0.5;
        const anchorMidY = PAD_TOP + m.anchorBox.y + m.anchorBox.h * 0.5;

        drawAtGap(0);
        const restAbove = lum(sampleCss(probeX, aboveGapY));
        const restBelow = lum(sampleCss(probeX, belowGapY));

        drawAtGap(48);
        const openAbove = lum(sampleCss(probeX, aboveGapY));
        const openBelow = lum(sampleCss(probeX, belowGapY));
        const anchorPx = sampleCss(anchorMidX, anchorMidY);

        // Probe multiple pixels inside the anchor pill to confirm warm pill / text stays unshifted
        let warmOrDark = 0;
        for (let dx = -10; dx <= 10; dx += 4) {
          const p = sampleCss(anchorMidX + dx, anchorMidY);
          if (p[0] > 140 || lum(p) < 160) warmOrDark++;
        }

        const paperAtRest = restAbove > 210 && restBelow > 210;
        const darkSlotOpened = openAbove < 145 && openBelow < 145;
        return need(
          paperAtRest && darkSlotOpened && warmOrDark >= 3 && anchorPx[3] > 200,
          `rest lum=[${restAbove.toFixed(0)}, ${restBelow.toFixed(0)}], open gap lum=[${openAbove.toFixed(0)}, ${openBelow.toFixed(0)}], anchor pill samples=${warmOrDark}/6.`
        );
      } finally {
        g?.dispose();
        await retireAndWait(cv);
      }
    },
  },
  {
    name: 'Anchor <button> stays hit-testable via document.elementsFromPoint() while the slot is open',
    expect: 'pass',
    why: 'Keeps updateElementGeometry() at PAD_TOP (dy=0 on anchorLine) scaled by geometryUnit() while gap=48 is drawn, then verifies elementsFromPoint() hits the anchor button and mapCanvasYToArticleY() inverts outer strip offsets.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 280, H = 220;
      const { cv, art, btn } = makeFixture(W, H);
      testStage().append(cv);
      let g = null;
      let ctx = null;
      try {
        if (glSupported) g = new ElementGL(cv, { fragment: SLOT_FRAG });
        else ctx = cv.getContext('2d');
        await nextPaint(cv);
        const meas = measureArticleAnchors(art);
        const m = meas.anchors.get('compositor');
        if (g) {
          g.upload(art);
          g.begin([0.067, 0.075, 0.094, 1]);
          g.quad(art, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform1f(loc('uPadTop'), PAD_TOP);
            gl.uniform1f(loc('uGap'), 48);
            gl.uniform1f(loc('uMaxGap'), SLOT_MAX_GAP);
            gl.uniform2f(loc('uLineBand'), m.lineTop, m.lineBot);
            gl.uniform4f(loc('uAnchorRect'), m.anchorBox.x, m.anchorBox.y, m.anchorBox.x + m.anchorBox.w, m.anchorBox.y + m.anchorBox.h);
            gl.uniform1i(loc('uMode'), 0);
            gl.uniform1f(loc('uReduced'), 1);
            gl.uniform2f(loc('uPointer'), W * 0.5, m.lineMidY);
          });
          const u = geometryUnit(cv, art, W);
          cv.updateElementGeometry(art, {
            canvasTransform: new DOMMatrix().translate(0, PAD_TOP * u).scale(u, u),
          });
          art.dataset.hitTick = '1';
        } else if (ctx) {
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawElementImage(art, 0, PAD_TOP, W, art.offsetHeight);
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const br = btn.getBoundingClientRect();
        const hits = document.elementsFromPoint(br.left + br.width * 0.5, br.top + br.height * 0.5);
        const aboveMap = mapCanvasYToArticleY(PAD_TOP + m.lineTop - 30, PAD_TOP, m.lineTop, m.lineBot, 48);
        const anchorMap = mapCanvasYToArticleY(PAD_TOP + m.lineMidY, PAD_TOP, m.lineTop, m.lineBot, 48);
        const invOk = aboveMap.region === 'above' && Math.abs(aboveMap.artY - (m.lineTop - 6)) < 0.2 && anchorMap.region === 'anchorLine';
        return need(
          hits.includes(btn) && invOk,
          `elementsFromPoint includes <button.anchor-word>=${hits.includes(btn)}; inverse map above=${aboveMap.artY?.toFixed(1)} (${aboveMap.region}), anchor=${anchorMap.region}.`
        );
      } finally {
        g?.dispose();
        await retireAndWait(cv);
      }
    },
  },
  {
    name: 'Damped spring settles cleanly and prefers-reduced-motion snaps in one step',
    expect: 'pass',
    why: 'Steps stepSpringState() from 0 to 58 px at 60 Hz until settled, then verifies reduced=true snaps directly to 58 px with zero velocity.',
    run: async () => {
      const s = { gap: 0, vel: 0 };
      let steps = 0;
      let peak = 0;
      while (steps < 240) {
        const moving = stepSpringState(s, 1 / 60, SLOT_MAX_GAP, { reduced: false });
        steps++;
        if (s.gap > peak) peak = s.gap;
        if (!moving) break;
      }
      const rm = { gap: 0, vel: 95 };
      const rmMoving = stepSpringState(rm, 1 / 60, SLOT_MAX_GAP, { reduced: true });
      return need(
        s.gap === SLOT_MAX_GAP && steps > 5 && steps < 90 && !rmMoving && rm.gap === SLOT_MAX_GAP && rm.vel === 0,
        `spring settled to ${s.gap} px (peak ${peak.toFixed(1)} px) in ${steps} frames; reduced snapped to ${rm.gap} px in 1 step.`
      );
    },
  },
  stillDrawn(() => [
    {
      name: 'slot-field stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (!state.hasPainted || !canvas.width || !canvas.height) return 0;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !articleTex) return 0;
          drawWebGLFrame();
        } else if (state.mode === '2d') {
          render2D();
        }
        const copy = document.createElement('canvas');
        copy.width = 96;
        copy.height = 96;
        const cctx = copy.getContext('2d', { willReadFrequently: true });
        cctx.drawImage(canvas, 0, 0, 96, 96);
        return inkFraction(cctx);
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
