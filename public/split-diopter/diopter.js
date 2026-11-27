import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

// DOM references
const stageBox = document.getElementById('diopter-stage');
const viewportEl = document.getElementById('diopter-viewport');
let canvas = document.getElementById('diopter-canvas');
const bgCard = document.getElementById('bg-card');
const fgCard = document.getElementById('fg-card');
const plainHost = document.getElementById('plain-host');
const topHandle = document.getElementById('seam-handle-top');
const bottomHandle = document.getElementById('seam-handle-bottom');
const noticeEl = document.getElementById('diopter-notice');
const statusEl = document.getElementById('diopter-status');
const testsBody = document.getElementById('tests');

// Foreground card widgets (#fg-card)
const fgCueInput = document.getElementById('fg-cue-input');
const fgTriggerBtn = document.getElementById('fg-trigger-btn');
const fgCueCount = document.getElementById('fg-cue-count');

// Background card widgets (#bg-card)
const bgCueEcho = document.getElementById('bg-cue-echo');
const bgTimecode = document.getElementById('bg-tc');
const bgPills = Array.from(document.querySelectorAll('#bg-card .bg-pill[data-pill]'));
const bgActionBtn = document.getElementById('bg-action-btn');
const bgMetaOut = document.getElementById('bg-meta-out');

// External inspection controls
const singleLensToggle = document.getElementById('single-lens-toggle');
const rackBtn = document.getElementById('rack-btn');
const posSlider = document.getElementById('pos-slider');
const posOut = document.getElementById('pos-out');
const angleSlider = document.getElementById('angle-slider');
const angleOut = document.getElementById('angle-out');
const softSlider = document.getElementById('soft-slider');
const softOut = document.getElementById('soft-out');
const resetSeamBtn = document.getElementById('reset-seam-btn');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region diopter-shader
export const DIOPTER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;     // #fg-card (Plane A, near 0.42 m)
uniform sampler2D uBgTex;   // #bg-card (Plane B, far 8.5 m)
uniform vec2 uCanvasSize;
uniform vec4 uFgRect;       // x, y, w, h in CSS px
uniform vec4 uBgRect;       // x, y, w, h in CSS px
uniform float uSplitPos;    // 0..1 across canvas width
uniform float uSplitAngle;  // seam tilt in radians
uniform float uSoftness;    // half-width of glass edge band in CSS px
uniform float uBlurRadius;  // max optical bokeh radius in CSS px
uniform int uLensMode;      // 0 = split-diopter, 1 = single lens FG sharp, 2 = single lens BG sharp
uniform float uReduced;     // 1.0 reduces specular shimmer on glass edge

in vec2 vUv;
out vec4 outColor;

vec4 sampleBoundedLod(sampler2D tex, vec2 uv, float lod) {
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) {
    return vec4(0.0);
  }
  vec2 fade = smoothstep(vec2(0.0), vec2(0.012), uv) * smoothstep(vec2(1.0), vec2(0.988), uv);
  float edge = fade.x * fade.y;
  return textureLod(tex, clamp(uv, vec2(0.002), vec2(0.998)), lod) * edge;
}

vec4 samplePlaneBokeh(sampler2D tex, vec2 pCss, vec4 rect, float blurPx) {
  vec2 invSize = 1.0 / max(rect.zw, vec2(1.0));
  vec2 uv = (pCss - rect.xy) * invSize;
  if (blurPx <= 0.25) {
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) {
      return vec4(0.0);
    }
    return texture(tex, uv);
  }
  if (
    pCss.x < rect.x - blurPx - 2.0 || pCss.x > rect.x + rect.z + blurPx + 2.0 ||
    pCss.y < rect.y - blurPx - 2.0 || pCss.y > rect.y + rect.w + blurPx + 2.0
  ) {
    return vec4(0.0);
  }

  const int TAPS = 24;
  const float GOLDEN = 2.39996323;
  float lod = clamp(log2(1.0 + blurPx * 0.42), 0.0, 3.0);
  float spin = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  vec4 acc = vec4(0.0);
  float totalW = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(TAPS)) * blurPx;
    float a = fi * GOLDEN + spin;
    vec2 off = vec2(cos(a), sin(a)) * r;
    vec4 s = sampleBoundedLod(tex, uv + off * invSize, lod);
    float luma = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
    // Boost optical highlight energy for bright lamps and badges
    float w = 1.0 + 1.65 * smoothstep(0.45, 0.95, luma);
    acc += s * w;
    totalW += w;
  }

  vec4 res = acc / max(totalW, 0.0001);
  float lum = dot(res.rgb, vec3(0.299, 0.587, 0.114));
  float bloom = max(0.0, lum - 0.52) * 0.24 * clamp(blurPx / 14.0, 0.0, 1.0);
  res.rgb = min(vec3(res.a), res.rgb + res.rgb * bloom);
  return res;
}

float bokehOrb(vec2 p, vec2 c, float radius) {
  float d = length(p - c);
  float rim = smoothstep(radius + 1.5, radius - 2.5, d);
  float ring = 0.75 + 0.35 * smoothstep(radius * 0.45, radius * 0.92, d);
  return rim * ring;
}

vec3 cinemaStageBackdrop(vec2 pCss, float fgBlur, float bgBlur) {
  vec2 uv = pCss / max(uCanvasSize, vec2(1.0));
  vec3 base = mix(vec3(0.055, 0.064, 0.088), vec3(0.082, 0.095, 0.128), uv.y);

  // Subtle distant studio architectural grid (sharp on far plane, softens when defocused)
  float gridAlpha = mix(0.085, 0.018, bgBlur);
  vec2 g = abs(fract(pCss / 36.0 - 0.5) - 0.5) / fwidth(pCss / 36.0);
  float line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  base += vec3(0.22, 0.38, 0.62) * line * gridAlpha;

  // Distant studio practical bokeh orbs that bloom with bgBlur
  float orbR1 = mix(5.0, 28.0, bgBlur);
  float orbR2 = mix(4.0, 22.0, bgBlur);
  float orb1 = bokehOrb(pCss, uCanvasSize * vec2(0.78, 0.12), orbR1) * mix(0.45, 0.22, bgBlur);
  float orb2 = bokehOrb(pCss, uCanvasSize * vec2(0.36, 0.15), orbR2) * mix(0.42, 0.20, bgBlur);
  float orb3 = bokehOrb(pCss, uCanvasSize * vec2(0.62, 0.88), orbR1 * 0.85) * mix(0.36, 0.18, bgBlur);
  base += vec3(0.22, 0.72, 0.98) * orb1;
  base += vec3(0.98, 0.72, 0.20) * orb2;
  base += vec3(0.96, 0.36, 0.22) * orb3;

  // Top & bottom 24 px cinema letterbox framing
  float barMask = step(pCss.y, 24.0) + step(uCanvasSize.y - 24.0, pCss.y);
  base = mix(base, vec3(0.036, 0.042, 0.056), clamp(barMask, 0.0, 1.0) * 0.88);

  // Gentle vignette
  vec2 d = (uv - 0.5) * vec2(1.15, 1.0);
  base *= 1.0 - 0.24 * dot(d, d);
  return base;
}

void main() {
  vec2 pCss = vUv * uCanvasSize;
  vec2 seamOrigin = vec2(uSplitPos * uCanvasSize.x, uCanvasSize.y * 0.5);
  vec2 normal = vec2(cos(uSplitAngle), sin(uSplitAngle));
  float signedDist = dot(pCss - seamOrigin, normal);

  float fgBlurAmt = 0.0;
  float bgBlurAmt = 0.0;
  float inBand = 0.0;
  float bandPeak = 0.0;

  if (uLensMode == 1) {
    fgBlurAmt = 0.0;
    bgBlurAmt = 1.0;
  } else if (uLensMode == 2) {
    fgBlurAmt = 1.0;
    bgBlurAmt = 0.0;
  } else {
    float halfB = smoothstep(-uSoftness, uSoftness, signedDist);
    inBand = smoothstep(uSoftness, 0.0, abs(signedDist));
    bandPeak = exp(-pow(signedDist / max(uSoftness * 0.42, 1.5), 2.0)) * inBand;
    fgBlurAmt = clamp(max(halfB, bandPeak * 0.55), 0.0, 1.0);
    bgBlurAmt = clamp(max(1.0 - halfB, bandPeak * 0.55), 0.0, 1.0);
  }

  vec3 col = cinemaStageBackdrop(pCss, fgBlurAmt, bgBlurAmt);

  // Subtle refractive glass displacement inside the half-diopter edge band
  vec2 bgPos = pCss + normal * (bandPeak * 3.4);
  vec2 fgPos = pCss - normal * (bandPeak * 3.4);

  vec4 bgCol = samplePlaneBokeh(uBgTex, bgPos, uBgRect, bgBlurAmt * uBlurRadius);
  col = col * (1.0 - bgCol.a) + bgCol.rgb;

  // Ambient shadow cast by near #fg-card onto #bg-card and stage behind it
  vec2 shCenter = uFgRect.xy + uFgRect.zw * 0.5 + vec2(6.0, 9.0);
  vec2 shQ = abs(pCss - shCenter) - uFgRect.zw * 0.5;
  float shDist = min(max(shQ.x, shQ.y), 0.0) + length(max(shQ, 0.0));
  float shMask = 1.0 - smoothstep(-2.0, mix(18.0, 30.0, fgBlurAmt), shDist);
  col *= 1.0 - 0.34 * shMask * (1.0 - 0.45 * fgBlurAmt);

  vec4 fgCol = samplePlaneBokeh(uTex, fgPos, uFgRect, fgBlurAmt * uBlurRadius);
  col = col * (1.0 - fgCol.a) + fgCol.rgb;

  // Translucent half-diopter glass bevel highlight along the optical boundary
  if (uLensMode == 0 && inBand > 0.001) {
    float bevel = exp(-pow(signedDist / max(uSoftness * 0.22, 1.2), 2.0)) * inBand;
    float edgeLine = exp(-pow((signedDist - 1.2) / 1.15, 2.0)) * inBand;
    float sheenScale = uReduced > 0.5 ? 0.55 : 1.0;
    col = mix(col, col * 1.05 + vec3(0.72, 0.85, 1.0) * 0.14, bevel * 0.65 * sheenScale);
    col += vec3(0.88, 0.94, 1.0) * edgeLine * 0.18 * sheenScale;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion diopter-shader

export function computePlaneRects(cw, ch) {
  const pad = Math.round(Math.max(8, cw * 0.022));
  const bar = 26;
  const innerH = Math.max(200, ch - bar * 2);

  const fgX = pad;
  const fgY = bar + Math.round(innerH * 0.02);
  const fgW = Math.round(cw * 0.435);
  const fgH = Math.round(innerH * 0.87);

  const bgX = Math.round(cw * 0.44);
  const bgY = bar + Math.round(innerH * 0.11);
  const bgW = Math.max(120, cw - bgX - pad);
  const bgH = Math.round(innerH * 0.87);

  return {
    fg: { x: fgX, y: fgY, w: fgW, h: fgH },
    bg: { x: bgX, y: bgY, w: bgW, h: bgH },
  };
}

export function splitSignedDistance(x, y, cw, ch, splitPos, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const ox = splitPos * cw;
  const oy = ch * 0.5;
  return (x - ox) * Math.cos(rad) + (y - oy) * Math.sin(rad);
}

const DEFAULTS = {
  splitPos: 0.495,
  splitAngleDeg: 4,
  softness: 14,
};

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  splitPos: DEFAULTS.splitPos,
  splitAngleDeg: DEFAULTS.splitAngleDeg,
  softness: DEFAULTS.softness,
  blurRadius: 15,
  lensMode: 0, // 0 = split-diopter, 1 = single FG, 2 = single BG
  lastSingleMode: 1,
  reducedOverride: reducedToggle.checked,
  onScreen: true,
  hasPainted: false,
  uploads: 0,
  paints: 0,
  cuesFired: 0,
  takes: 1,
  pills: { rain: true, neon: true, dolly: false },
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  anim: null,
  rafId: 0,
};

let stage = null;
let ctx2d = null;
const planeTextures = new Map();
const dirtyPlanes = new Set();
let drag = null;

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 356);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 470);
  return { cw, ch };
}

function syncPlaneSizes(fgRect, bgRect) {
  if (!fgRect || !bgRect || state.mode === 'plain') {
    for (const el of [fgCard, bgCard]) {
      if (el.style.width) el.style.width = '';
      if (el.style.height) el.style.height = '';
    }
    return;
  }
  const apply = (el, r) => {
    const w = `${r.w}px`;
    const h = `${r.h}px`;
    if (el.style.width !== w) el.style.width = w;
    if (el.style.height !== h) el.style.height = h;
  };
  apply(bgCard, bgRect);
  apply(fgCard, fgRect);
}

function syncCardsUI() {
  fgCueCount.textContent = `${state.cuesFired} ${state.cuesFired === 1 ? 'cue' : 'cues'} fired`;
  let activeRigs = 0;
  for (const btn of bgPills) {
    const on = Boolean(state.pills[btn.dataset.pill]);
    if (on) activeRigs++;
    btn.setAttribute('aria-pressed', String(on));
  }
  bgActionBtn.textContent = `Mark slate (Take ${state.takes})`;
  bgMetaOut.textContent = `${activeRigs} ${activeRigs === 1 ? 'rig' : 'rigs'} on`;
}

function updateSeamHandles() {
  const showHandles = state.mode !== 'plain' && state.lensMode === 0;
  topHandle.hidden = !showHandles;
  bottomHandle.hidden = !showHandles;
  if (!showHandles) return;

  const { cw, ch } = getViewportSize();
  const rad = (state.splitAngleDeg * Math.PI) / 180;
  const tanA = Math.tan(rad);
  const clampX = (x) => Math.max(36, Math.min(cw - 36, x));
  const topX = clampX(state.splitPos * cw - tanA * (12 - ch * 0.5));
  const botX = clampX(state.splitPos * cw - tanA * (ch - 12 - ch * 0.5));
  topHandle.style.transform = `translateX(${topX.toFixed(1)}px)`;
  bottomHandle.style.transform = `translateX(${botX.toFixed(1)}px)`;
}

function updateControlsUI() {
  const singleOn = state.lensMode !== 0;
  singleLensToggle.checked = singleOn;
  rackBtn.textContent = state.lensMode === 2
    ? 'Focus plane: Far (8.5 m)'
    : 'Focus plane: Near (0.42 m)';
  posSlider.value = String(Math.round(state.splitPos * 100));
  posOut.textContent = `${Math.round(state.splitPos * 100)}%`;
  angleSlider.value = String(Math.round(state.splitAngleDeg));
  angleOut.textContent = `${state.splitAngleDeg > 0 ? '+' : ''}${Math.round(state.splitAngleDeg)}°`;
  softSlider.value = String(Math.round(state.softness));
  softOut.textContent = `${Math.round(state.softness)} px`;
  updateSeamHandles();
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const lensLabel = state.lensMode === 0
    ? `Split-diopter ${Math.round(state.splitPos * 100)}% (${state.splitAngleDeg > 0 ? '+' : ''}${Math.round(state.splitAngleDeg)}°)`
    : state.lensMode === 1
      ? 'Single lens (Near 0.42 m sharp)'
      : 'Single lens (Far 8.5 m sharp)';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${routeLabel} · ${lensLabel} · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

// #region geometry-sync
function cachedUnit(cw, refEl, refW) {
  const zoom = refEl.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${cw}/${refW}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, refEl, refW);
    state.unitCache.key = key;
    state.lastGeoKey = '';
  }
  return state.unitCache.unit;
}

export function syncPlaneGeometry(force = false) {
  if (state.mode === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch } = getViewportSize();
  const { fg, bg } = computePlaneRects(cw, ch);
  syncPlaneSizes(fg, bg);

  if (state.mode !== 'webgl' || canvas.width <= 0 || canvas.height <= 0) return;
  const geoKey = `${canvas.width}x${canvas.height}|${cw}x${ch}|${fg.x},${fg.y},${fg.w},${fg.h}|${bg.x},${bg.y},${bg.w},${bg.h}`;
  if (!force && geoKey === state.lastGeoKey) return;
  state.lastGeoKey = geoKey;

  const u = cachedUnit(cw, fgCard, fg.w);
  canvas.updateElementGeometry(bgCard, {
    canvasTransform: new DOMMatrix().scale(u, u).translate(bg.x, bg.y),
  });
  canvas.updateElementGeometry(fgCard, {
    canvasTransform: new DOMMatrix().scale(u, u).translate(fg.x, fg.y),
  });
  bgCard.dataset.hitTick = bgCard.dataset.hitTick === '1' ? '0' : '1';
  fgCard.dataset.hitTick = fgCard.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function uploadWithMip(stageObj, el) {
  const tex = stageObj.upload(el);
  if (tex) {
    const gl = stageObj.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  return tex;
}

function tryUploadPlane(el) {
  if (!stage || stage.lost) return null;
  try {
    const tex = uploadWithMip(stage, el);
    if (tex) {
      planeTextures.set(el, tex);
      dirtyPlanes.delete(el);
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      dirtyPlanes.add(el);
      canvas.requestPaint?.();
      return planeTextures.get(el) ?? null;
    }
    throw err;
  }
}

function drawWebGLQuad(cw, ch, fg, bg, bgTex) {
  const angleRad = (state.splitAngleDeg * Math.PI) / 180;
  stage.quad(fgCard, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bgTex.tex);
    gl.uniform1i(loc('uBgTex'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform4f(loc('uFgRect'), fg.x, fg.y, fg.w, fg.h);
    gl.uniform4f(loc('uBgRect'), bg.x, bg.y, bg.w, bg.h);
    gl.uniform1f(loc('uSplitPos'), state.splitPos);
    gl.uniform1f(loc('uSplitAngle'), angleRad);
    gl.uniform1f(loc('uSoftness'), state.softness);
    gl.uniform1f(loc('uBlurRadius'), state.blurRadius);
    gl.uniform1i(loc('uLensMode'), state.lensMode);
    gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1.0 : 0.0);
  });
}

function renderWebGL(allowUpload = false, changedSet = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  const { fg, bg } = computePlaneRects(cw, ch);
  syncPlaneSizes(fg, bg);

  // Begin frame before texture uploads so ElementGL sizes the backing buffer first
  if (!stage.begin([0.055, 0.064, 0.088, 1])) return;

  if (allowUpload) {
    for (const el of [bgCard, fgCard]) {
      const needs = !planeTextures.has(el) || dirtyPlanes.has(el) || !changedSet || changedSet.has(el);
      if (needs) tryUploadPlane(el);
    }
  }

  const fgTex = planeTextures.get(fgCard);
  const bgTex = planeTextures.get(bgCard);
  if (!fgTex || !bgTex) return;

  drawWebGLQuad(cw, ch, fg, bg, bgTex);
  syncPlaneGeometry(false);
  state.paints++;
  updateStatus();
}

// #region fallback-2d
function clipHalfPlane(ctx, cw, ch, splitPos, angleDeg, side) {
  const rad = (angleDeg * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  const ox = splitPos * cw;
  const oy = ch * 0.5;
  const tx = -ny;
  const ty = nx;
  const span = Math.hypot(cw, ch) * 2.2;
  const sx = side * nx * span;
  const sy = side * ny * span;

  ctx.beginPath();
  ctx.moveTo(ox - tx * span, oy - ty * span);
  ctx.lineTo(ox + tx * span, oy + ty * span);
  ctx.lineTo(ox + tx * span + sx, oy + ty * span + sy);
  ctx.lineTo(ox - tx * span + sx, oy - ty * span + sy);
  ctx.closePath();
  ctx.clip();
}

function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = getViewportSize();
  const { fg, bg } = computePlaneRects(cw, ch);
  syncPlaneSizes(fg, bg);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

  const grad = ctx2d.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#0e1016');
  grad.addColorStop(1, '#151821');
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, 0, cw, ch);

  if (state.lensMode === 1) {
    ctx2d.save();
    ctx2d.filter = 'blur(7px)';
    ctx2d.drawElementImage(bgCard, bg.x, bg.y, bg.w, bg.h);
    ctx2d.restore();
    ctx2d.drawElementImage(fgCard, fg.x, fg.y, fg.w, fg.h);
  } else if (state.lensMode === 2) {
    ctx2d.drawElementImage(bgCard, bg.x, bg.y, bg.w, bg.h);
    ctx2d.save();
    ctx2d.filter = 'blur(7px)';
    ctx2d.drawElementImage(fgCard, fg.x, fg.y, fg.w, fg.h);
    ctx2d.restore();
  } else {
    // Half A (left): BG blurred, FG sharp; Half B (right): BG sharp, FG blurred
    ctx2d.save();
    clipHalfPlane(ctx2d, cw, ch, state.splitPos, state.splitAngleDeg, -1);
    ctx2d.filter = 'blur(7px)';
    ctx2d.drawElementImage(bgCard, bg.x, bg.y, bg.w, bg.h);
    ctx2d.restore();

    ctx2d.save();
    clipHalfPlane(ctx2d, cw, ch, state.splitPos, state.splitAngleDeg, 1);
    ctx2d.drawElementImage(bgCard, bg.x, bg.y, bg.w, bg.h);
    ctx2d.restore();

    ctx2d.save();
    clipHalfPlane(ctx2d, cw, ch, state.splitPos, state.splitAngleDeg, 1);
    ctx2d.filter = 'blur(7px)';
    ctx2d.drawElementImage(fgCard, fg.x, fg.y, fg.w, fg.h);
    ctx2d.restore();

    ctx2d.save();
    clipHalfPlane(ctx2d, cw, ch, state.splitPos, state.splitAngleDeg, -1);
    ctx2d.drawElementImage(fgCard, fg.x, fg.y, fg.w, fg.h);
    ctx2d.restore();

    // Translucent glass boundary line
    const rad = (state.splitAngleDeg * Math.PI) / 180;
    const tx = -Math.sin(rad);
    const ty = Math.cos(rad);
    const ox = state.splitPos * cw;
    const oy = ch * 0.5;
    ctx2d.strokeStyle = 'rgb(205 228 255 / 0.45)';
    ctx2d.lineWidth = Math.max(2, state.softness * 0.25);
    ctx2d.beginPath();
    ctx2d.moveTo(ox - tx * ch, oy - ty * ch);
    ctx2d.lineTo(ox + tx * ch, oy + ty * ch);
    ctx2d.stroke();
  }

  ctx2d.restore();
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.anim = null;
  stageBox.classList.add('is-plain');
  for (const el of [fgCard, bgCard]) {
    if (el.parentElement !== plainHost) plainHost.append(el);
  }
  syncPlaneSizes(null, null);
  showNotice(reason);
  updateControlsUI();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const el of [bgCard, fgCard]) {
    if (el.parentElement !== canvas) canvas.append(el);
  }
  showNotice('');
}
// #endregion fallback-2d

function drawCurrentFrame(forcePaint = false) {
  if (state.mode === 'plain') return;
  if (!forcePaint && state.mode === 'webgl' && state.hasPainted && stage && !stage.lost && planeTextures.size === 2) {
    renderWebGL(false);
    return;
  }
  canvas.requestPaint?.();
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function stepAnim(now) {
  state.rafId = 0;
  if (!state.anim || !state.onScreen || document.hidden || state.mode === 'plain') return;
  const elapsed = now - state.anim.startAt;
  const rawT = Math.min(1, elapsed / state.anim.durMs);
  const t = 1 - Math.pow(1 - rawT, 3);

  state.splitPos = state.anim.fromPos + (state.anim.toPos - state.anim.fromPos) * t;
  state.splitAngleDeg = state.anim.fromAngle + (state.anim.toAngle - state.anim.fromAngle) * t;
  state.softness = state.anim.fromSoft + (state.anim.toSoft - state.anim.fromSoft) * t;
  updateControlsUI();
  drawCurrentFrame();

  if (rawT < 1) {
    state.rafId = requestAnimationFrame(stepAnim);
  } else {
    state.anim = null;
  }
}

function animateSeamTo({ pos, angle, softness }) {
  stopLoop();
  if (isReducedMotion() || state.mode === 'plain' || !state.onScreen || document.hidden) {
    state.anim = null;
    state.splitPos = pos;
    state.splitAngleDeg = angle;
    state.softness = softness;
    updateControlsUI();
    drawCurrentFrame();
    return;
  }
  state.anim = {
    startAt: performance.now(),
    durMs: 280,
    fromPos: state.splitPos,
    fromAngle: state.splitAngleDeg,
    fromSoft: state.softness,
    toPos: pos,
    toAngle: angle,
    toSoft: softness,
  };
  state.rafId = requestAnimationFrame(stepAnim);
}

// #region seam-drag
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

function beginSeamDrag(e, fromHandle) {
  if (e.button !== 0 || state.mode === 'plain') return;
  if (!fromHandle && e.target.closest('button, input, textarea, select, label, a')) return;

  stopLoop();
  state.anim = null;

  if (state.lensMode !== 0) {
    state.lensMode = 0;
  }

  drag = {
    id: e.pointerId,
    owner: e.currentTarget,
    fromHandle,
    locked: fromHandle || e.pointerType === 'mouse',
    startX: e.clientX,
    startY: e.clientY,
    startPos: state.splitPos,
    startAngle: state.splitAngleDeg,
  };

  if (drag.locked) {
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    if (e.cancelable) e.preventDefault();
  }
  updateControlsUI();
  drawCurrentFrame();
}

function moveSeamDrag(e) {
  if (!drag || e.pointerId !== drag.id || e.currentTarget !== drag.owner) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;

  if (!drag.locked) {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      drag.locked = true;
      try { drag.owner.setPointerCapture?.(drag.id); } catch {}
    } else if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
      drag = null;
      return;
    } else {
      return;
    }
  }

  if (e.cancelable) e.preventDefault();
  const { cw, ch } = getViewportSize();
  state.splitPos = clamp(drag.startPos + dx / Math.max(120, cw), 0.15, 0.85);
  if (drag.fromHandle || e.pointerType === 'mouse' || Math.abs(dy) > 10) {
    state.splitAngleDeg = clamp(drag.startAngle + (dy / Math.max(180, ch)) * 52, -38, 38);
  }
  updateControlsUI();
  drawCurrentFrame();
}

function endSeamDrag(e) {
  if (!drag || e.pointerId !== drag.id || e.currentTarget !== drag.owner) return;
  drag = null;
}

for (const el of [topHandle, bottomHandle]) {
  el.addEventListener('pointerdown', (e) => beginSeamDrag(e, true));
  el.addEventListener('pointermove', moveSeamDrag);
  el.addEventListener('pointerup', endSeamDrag);
  el.addEventListener('pointercancel', endSeamDrag);
}

viewportEl.addEventListener('pointerdown', (e) => beginSeamDrag(e, false));
viewportEl.addEventListener('pointermove', moveSeamDrag);
viewportEl.addEventListener('pointerup', endSeamDrag);
viewportEl.addEventListener('pointercancel', endSeamDrag);
// #endregion seam-drag

// Live interactive controls inside both drawable planes
fgCueInput.addEventListener('input', () => {
  dirtyPlanes.add(fgCard);
  drawCurrentFrame(true);
});

fgTriggerBtn.addEventListener('click', () => {
  state.cuesFired++;
  const note = fgCueInput.value.trim() || 'Cue fired';
  bgCueEcho.textContent = `Cue #${state.cuesFired}: ${note}`;
  syncCardsUI();
  dirtyPlanes.add(fgCard);
  dirtyPlanes.add(bgCard);
  drawCurrentFrame(true);
});

for (const pill of bgPills) {
  pill.addEventListener('click', () => {
    const key = pill.dataset.pill;
    state.pills[key] = !state.pills[key];
    syncCardsUI();
    dirtyPlanes.add(bgCard);
    drawCurrentFrame(true);
  });
}

bgActionBtn.addEventListener('click', () => {
  state.takes++;
  bgTimecode.textContent = `01:14:${String(8 + state.takes).padStart(2, '0')}:12`;
  bgCueEcho.textContent = `Slate Take ${state.takes} marked`;
  syncCardsUI();
  dirtyPlanes.add(bgCard);
  drawCurrentFrame(true);
});

// External optical controls
singleLensToggle.addEventListener('change', () => {
  state.lensMode = singleLensToggle.checked ? state.lastSingleMode : 0;
  updateControlsUI();
  drawCurrentFrame();
});

rackBtn.addEventListener('click', () => {
  if (state.lensMode === 0) {
    state.lensMode = state.lastSingleMode;
  } else {
    state.lensMode = state.lensMode === 1 ? 2 : 1;
    state.lastSingleMode = state.lensMode;
  }
  updateControlsUI();
  drawCurrentFrame();
});

posSlider.addEventListener('input', () => {
  stopLoop();
  state.anim = null;
  state.lensMode = 0;
  state.splitPos = Number(posSlider.value) / 100;
  updateControlsUI();
  drawCurrentFrame();
});

angleSlider.addEventListener('input', () => {
  stopLoop();
  state.anim = null;
  state.lensMode = 0;
  state.splitAngleDeg = Number(angleSlider.value);
  updateControlsUI();
  drawCurrentFrame();
});

softSlider.addEventListener('input', () => {
  stopLoop();
  state.anim = null;
  state.lensMode = 0;
  state.softness = Number(softSlider.value);
  updateControlsUI();
  drawCurrentFrame();
});

resetSeamBtn.addEventListener('click', () => {
  state.lensMode = 0;
  animateSeamTo({
    pos: DEFAULTS.splitPos,
    angle: DEFAULTS.splitAngleDeg,
    softness: DEFAULTS.softness,
  });
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion() && state.anim) {
    animateSeamTo({
      pos: state.anim.toPos,
      angle: state.anim.toAngle,
      softness: state.anim.toSoft,
    });
  } else {
    drawCurrentFrame();
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  drawCurrentFrame();
});

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    let changed = null;
    if (e?.changedElements?.length) {
      changed = new Set();
      for (const el of e.changedElements) {
        if (fgCard === el || fgCard.contains(el)) { changed.add(fgCard); dirtyPlanes.add(fgCard); }
        if (bgCard === el || bgCard.contains(el)) { changed.add(bgCard); dirtyPlanes.add(bgCard); }
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
      enterPlainFallback('The 2D canvas context was lost. Showing both cards in plain HTML.');
    }
  });

  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      const { cw, ch } = getViewportSize();
      const { fg, bg } = computePlaneRects(cw, ch);
      syncPlaneSizes(fg, bg);
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  const { fg, bg } = computePlaneRects(cw, ch);
  syncPlaneSizes(fg, bg);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: DIOPTER_FRAG,
        onLost: () => {
          planeTextures.clear();
          dirtyPlanes.add(fgCard);
          dirtyPlanes.add(bgCard);
          enterPlainFallback('The WebGL 2 context was lost. Showing both planes in plain HTML until restored.');
        },
        onRestored: () => {
          planeTextures.clear();
          dirtyPlanes.add(fgCard);
          dirtyPlanes.add(bgCard);
          stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          state.unitCache.key = '';
          state.lastGeoKey = '';
          exitPlainFallback();
          const s = getViewportSize();
          const r = computePlaneRects(s.cw, s.ch);
          syncPlaneSizes(r.fg, r.bg);
          syncPlaneGeometry(true);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.mode = 'webgl';
      dirtyPlanes.add(fgCard);
      dirtyPlanes.add(bgCard);
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'diopter-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(bgCard, fgCard);
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

  enterPlainFallback('HTML-in-canvas is not available in this browser, so both focal planes are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) {
      stopLoop();
    } else if (state.mode !== 'plain') {
      if (state.anim && !state.rafId && !document.hidden) {
        state.rafId = requestAnimationFrame(stepAnim);
      } else {
        drawCurrentFrame();
      }
    }
  }).observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.mode !== 'plain') {
    if (state.anim && !state.rafId) {
      state.rafId = requestAnimationFrame(stepAnim);
    } else {
      drawCurrentFrame();
    }
  }
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.mode !== 'plain') {
      state.unitCache.key = '';
      state.lastGeoKey = '';
      const { cw, ch } = getViewportSize();
      const { fg, bg } = computePlaneRects(cw, ch);
      syncPlaneSizes(fg, bg);
      syncPlaneGeometry(true);
      updateSeamHandles();
      if (state.hasPainted) drawCurrentFrame(true);
      else canvas.requestPaint?.();
    }
  }).observe(viewportEl);
}

syncCardsUI();
updateControlsUI();
initBackend();

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function settleGfx(baseActive) {
  if (!window.__gfx?.active) return;
  const deadline = performance.now() + 800;
  while (window.__gfx.active() > baseActive && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 120));
  }
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function scanContrast(gl, cv, w, h, xStart, xEnd, cssY) {
  let lo = 255;
  let hi = 0;
  const samples = 24;
  for (let i = 0; i <= samples; i++) {
    const x = xStart + ((xEnd - xStart) * i) / samples;
    const px = readCssPixel(gl, cv, w, h, x, cssY);
    const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
    if (lum < lo) lo = lum;
    if (lum > hi) hi = lum;
  }
  return hi - lo;
}

function makeFixtureStage(w = 240, h = 160, { striped = false } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px`;

  const bgFix = document.createElement('section');
  bgFix.setAttribute('drawable', '');
  bgFix.style.cssText =
    'position:absolute;left:0;top:0;width:102px;height:132px;padding:10px;box-sizing:border-box;' +
    'background:#0c1626;color:#f8fafc;font:700 12px system-ui;pointer-events:auto';

  const fgFix = document.createElement('section');
  fgFix.setAttribute('drawable', '');
  fgFix.style.cssText =
    'position:absolute;left:0;top:0;width:102px;height:132px;padding:10px;box-sizing:border-box;' +
    'background:#fffaf2;color:#191614;font:700 12px system-ui;pointer-events:auto';

  let fgInput = null;
  let fgBtn = null;
  let bgBtn = null;

  if (striped) {
    const fgGrid = document.createElement('div');
    fgGrid.style.cssText =
      'width:82px;height:68px;background:repeating-linear-gradient(90deg,#000000 0 4px,#ffffff 4px 8px)';
    fgFix.append(fgGrid);

    const bgGrid = document.createElement('div');
    bgGrid.style.cssText =
      'width:82px;height:68px;background:repeating-linear-gradient(90deg,#000000 0 4px,#ffffff 4px 8px)';
    bgFix.append(bgGrid);
  } else {
    const fgBadge = document.createElement('div');
    fgBadge.style.cssText = 'width:82px;height:20px;background:#d2491f;margin-bottom:8px';
    fgInput = document.createElement('input');
    fgInput.type = 'text';
    fgInput.value = 'Take 14 cue';
    fgInput.setAttribute('inputmode', 'none');
    fgInput.setAttribute('aria-label', 'Fixture cue note');
    fgInput.style.cssText = 'display:block;width:82px;height:30px;margin-bottom:8px;box-sizing:border-box';
    fgBtn = document.createElement('button');
    fgBtn.type = 'button';
    fgBtn.textContent = 'Trigger cue';
    fgBtn.style.cssText = 'display:block;width:82px;height:36px;background:#d2491f;color:#fff;border:0';
    fgFix.append(fgBadge, fgInput, fgBtn);

    const bgBadge = document.createElement('div');
    bgBadge.style.cssText = 'width:82px;height:24px;background:#0ea5e9;margin-bottom:14px';
    bgBtn = document.createElement('button');
    bgBtn.type = 'button';
    bgBtn.textContent = 'Mark slate';
    bgBtn.style.cssText = 'display:block;width:82px;height:40px;background:#e0f2fe;color:#072033;border:0';
    bgFix.append(bgBadge, bgBtn);
  }

  cv.append(bgFix, fgFix);
  return { cv, fgFix, bgFix, fgInput, fgBtn, bgBtn };
}

runTests(testsBody, [
  {
    name: 'ElementGL uploads both #fg-card and #bg-card via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL, calls begin() before upload(), draws both planes and checks gl.getError().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 240;
      const H = 160;
      const { cv, fgFix, bgFix } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: DIOPTER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        if (!g.begin([0, 0, 0, 1])) throw new Error('ElementGL.begin() returned false');
        const tBg = uploadWithMip(g, bgFix);
        const tFg = uploadWithMip(g, fgFix);
        g.quad(fgFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tBg.tex);
          gl.uniform1i(loc('uBgTex'), 1);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform2f(loc('uCanvasSize'), W, H);
          gl.uniform4f(loc('uFgRect'), 10, 14, 102, 132);
          gl.uniform4f(loc('uBgRect'), 128, 14, 102, 132);
          gl.uniform1f(loc('uSplitPos'), 0.5);
          gl.uniform1f(loc('uSplitAngle'), 0);
          gl.uniform1f(loc('uSoftness'), 10);
          gl.uniform1f(loc('uBlurRadius'), 14);
          gl.uniform1i(loc('uLensMode'), 0);
          gl.uniform1f(loc('uReduced'), 1);
        });
        const err = g.gl.getError();
        const leftBadge = readCssPixel(g.gl, cv, W, H, 50, 32);
        const rightBadge = readCssPixel(g.gl, cv, W, H, 175, 32);
        return need(
          err === g.gl.NO_ERROR && tFg?.w > 0 && tBg?.w > 0 && leftBadge[0] > 170 && rightBadge[2] > 170,
          `gl.getError()=${err}, fg=${tFg?.w}x${tFg?.h} rgb(${leftBadge.slice(0, 3)}), bg=${tBg?.w}x${tBg?.h} rgb(${rightBadge.slice(0, 3)}).`
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
    name: 'Single-lens mode blurs the right plane while split-diopter mode keeps both planes sharp',
    expect: 'pass',
    why: 'Renders 4 px vertical black/white stripes in both planes on testStage(), checking left sharp vs right blurred in single-lens mode, both sharp in diopter mode, and half-blur when the seam crosses one card.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 240;
      const H = 160;
      const { cv, fgFix, bgFix } = makeFixtureStage(W, H, { striped: true });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: DIOPTER_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        if (!g.begin([0, 0, 0, 1])) throw new Error('ElementGL.begin() returned false');
        const tBg = uploadWithMip(g, bgFix);
        const tFg = uploadWithMip(g, fgFix);

        const drawMode = (mode, pos) => {
          g.begin([0, 0, 0, 1]);
          g.quad(fgFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tBg.tex);
            gl.uniform1i(loc('uBgTex'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform4f(loc('uFgRect'), 10, 14, 102, 132);
            gl.uniform4f(loc('uBgRect'), 128, 14, 102, 132);
            gl.uniform1f(loc('uSplitPos'), pos);
            gl.uniform1f(loc('uSplitAngle'), 0);
            gl.uniform1f(loc('uSoftness'), 8);
            gl.uniform1f(loc('uBlurRadius'), 14);
            gl.uniform1i(loc('uLensMode'), mode);
            gl.uniform1f(loc('uReduced'), 1);
          });
        };

        drawMode(1, 0.5);
        const singleLeft = scanContrast(g.gl, cv, W, H, 26, 94, 52);
        const singleRight = scanContrast(g.gl, cv, W, H, 144, 212, 52);

        drawMode(0, 0.5);
        const diopterLeft = scanContrast(g.gl, cv, W, H, 26, 94, 52);
        const diopterRight = scanContrast(g.gl, cv, W, H, 144, 212, 52);

        drawMode(0, 0.25); // seam at x = 60 cuts across #fg-card (x = 20..102)
        const seamSharpHalf = scanContrast(g.gl, cv, W, H, 24, 48, 52);
        const seamBlurHalf = scanContrast(g.gl, cv, W, H, 72, 98, 52);

        return need(
          singleLeft > 150 && singleRight < 85 &&
          diopterLeft > 150 && diopterRight > 150 &&
          seamSharpHalf > 150 && seamBlurHalf < 85,
          `single-lens L=${singleLeft.toFixed(0)} R=${singleRight.toFixed(0)}; diopter L=${diopterLeft.toFixed(0)} R=${diopterRight.toFixed(0)}; split-card L=${seamSharpHalf.toFixed(0)} R=${seamBlurHalf.toFixed(0)}.`
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
    name: 'updateElementGeometry() keeps buttons and inputs clickable in both focal planes',
    expect: 'pass',
    why: 'Positions #fg-card and #bg-card with geometryUnit()-scaled updateElementGeometry() and dataset.hitTick, checks elementsFromPoint() on controls in both planes, and dispatches clicks to both buttons.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 240;
      const H = 160;
      const { cv, fgFix, bgFix, fgInput, fgBtn, bgBtn } = makeFixtureStage(W, H);
      testStage().append(cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: DIOPTER_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          await nextPaint(cv);
          g.begin([0, 0, 0, 1]);
          const tBg = uploadWithMip(g, bgFix);
          uploadWithMip(g, fgFix);
          g.quad(fgFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tBg.tex);
            gl.uniform1i(loc('uBgTex'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform4f(loc('uFgRect'), 10, 14, 102, 132);
            gl.uniform4f(loc('uBgRect'), 128, 14, 102, 132);
            gl.uniform1f(loc('uSplitPos'), 0.5);
            gl.uniform1f(loc('uSplitAngle'), 0);
            gl.uniform1f(loc('uSoftness'), 10);
            gl.uniform1f(loc('uBlurRadius'), 14);
            gl.uniform1i(loc('uLensMode'), 0);
            gl.uniform1f(loc('uReduced'), 1);
          });
        } else {
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext('2d');
          await nextPaint(cv);
          ctx.drawElementImage(bgFix, 128, 14, 102, 132);
          ctx.drawElementImage(fgFix, 10, 14, 102, 132);
        }

        const u = geometryUnit(cv, fgFix, 102);
        cv.updateElementGeometry(bgFix, { canvasTransform: new DOMMatrix().scale(u, u).translate(128, 14) });
        cv.updateElementGeometry(fgFix, { canvasTransform: new DOMMatrix().scale(u, u).translate(10, 14) });
        bgFix.dataset.hitTick = '1';
        fgFix.dataset.hitTick = '1';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const hitCenter = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };

        let fgClicks = 0;
        let bgClicks = 0;
        fgBtn.addEventListener('click', () => { fgClicks++; });
        bgBtn.addEventListener('click', () => { bgClicks++; });

        const inputHits = hitCenter(fgInput);
        const fgHits = hitCenter(fgBtn);
        const bgHits = hitCenter(bgBtn);
        if (fgHits.includes(fgBtn)) fgBtn.click();
        if (bgHits.includes(bgBtn)) bgBtn.click();

        return need(
          inputHits.includes(fgInput) && fgHits.includes(fgBtn) && bgHits.includes(bgBtn) && fgClicks === 1 && bgClicks === 1,
          `fgInput=${inputHits.includes(fgInput)}, fgBtn=${fgHits.includes(fgBtn)} (${fgClicks}), bgBtn=${bgHits.includes(bgBtn)} (${bgClicks}).`
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
    name: 'webglcontextlost moves both planes into plain fallback and webglcontextrestored recovers ElementGL',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an ElementGL fixture on testStage() without calling loseContext(), checking typed input survival and restoration.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 240;
      const H = 160;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, fgFix, bgFix, fgInput } = makeFixtureStage(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostFired = false;
      let restoredFired = false;
      try {
        g = new ElementGL(cv, {
          fragment: DIOPTER_FRAG,
          onLost: () => {
            lostFired = true;
            plain.hidden = false;
            plain.append(fgFix, bgFix);
          },
          onRestored: () => {
            restoredFired = true;
            g?.gl?.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            cv.append(bgFix, fgFix);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        uploadWithMip(g, bgFix);
        uploadWithMip(g, fgFix);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const plainOk = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(fgFix) && plain.contains(bgFix) && fgInput.value === 'Take 14 cue';

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tBg = uploadWithMip(g, bgFix);
        const tFg = uploadWithMip(g, fgFix);
        g.quad(fgFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tBg.tex);
          gl.uniform1i(loc('uBgTex'), 1);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform2f(loc('uCanvasSize'), W, H);
          gl.uniform4f(loc('uFgRect'), 10, 14, 102, 132);
          gl.uniform4f(loc('uBgRect'), 128, 14, 102, 132);
          gl.uniform1f(loc('uSplitPos'), 0.5);
          gl.uniform1f(loc('uSplitAngle'), 0);
          gl.uniform1f(loc('uSoftness'), 10);
          gl.uniform1f(loc('uBlurRadius'), 14);
          gl.uniform1i(loc('uLensMode'), 0);
          gl.uniform1f(loc('uReduced'), 1);
        });
        const err = g.gl.getError();

        return need(
          plainOk && restoredFired && !g.lost && cv.contains(fgFix) && cv.contains(bgFix) && tFg?.w > 0 && tBg?.w > 0 && err === g.gl.NO_ERROR,
          `preventDefault=${lostEv.defaultPrevented}, plainWhileLost=${plainOk}, restored=${restoredFired}, err=${err}.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
        await settleGfx(baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'split-diopter stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !planeTextures.has(fgCard) || !planeTextures.has(bgCard)) return 0;
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
