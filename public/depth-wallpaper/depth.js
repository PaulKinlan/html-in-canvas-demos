import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const stageEl = document.getElementById('dw-stage');
const viewportEl = document.getElementById('dw-viewport');
const canvas = document.getElementById('dw-canvas');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('dw-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests-body');

const clockLayerEl = document.getElementById('dw-clock-layer');
const subjectLayerEl = document.getElementById('dw-subject-layer');
const dateTagInput = document.getElementById('dw-date-tag');
const widgetAlarmBtn = document.getElementById('dw-widget-alarm');
const widgetTimeBtn = document.getElementById('dw-widget-time');
const widgetDepthBtn = document.getElementById('dw-widget-depth');
const clockTimeOut = document.getElementById('dw-clock-time');
const fgElevationEl = document.getElementById('dw-fg-elevation');
const fgDotEl = subjectLayerEl.querySelector('.dw-fg-dot');

const modeButtons = Array.from(document.querySelectorAll('button[data-mode-btn]'));
const themeButtons = Array.from(document.querySelectorAll('button[data-theme-btn]'));
const ctlDrift = document.getElementById('ctl-drift');
const ctlReduced = document.getElementById('ctl-reduced');
const ctlParallaxX = document.getElementById('ctl-parallax-x');
const outParallaxX = document.getElementById('out-parallax-x');
const btnCenter = document.getElementById('btn-center');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const MAX_PARALLAX = 26;
const PARALLAX_SKY = 0.35;
const PARALLAX_CLOCK = 0.70;
const PARALLAX_SUBJECT = 1.35;

const THEMES = {
  sunset: {
    id: 0,
    label: 'Sunset',
    defaultTag: 'THU 27 NOV · SUNSET',
    elevation: 'PEAK 3,420 M',
    dot: '#ff7a4d',
    lit: ['#f7a06d', '#7c4260', '#19162d'],
    dark: ['#3d2747', '#1f1833', '#0b0c18'],
    mid: ['#2a1d3b', '#090b15'],
    rim: ['#ffd5b8', '#ff8e66'],
    sky2d: ['#16102d', '#6e264a', '#eb7c44'],
    farRidge: '#3b1e3c',
  },
  alpine: {
    id: 1,
    label: 'Alpine',
    defaultTag: 'THU 27 NOV · ALPINE',
    elevation: 'ALPS 3,890 M',
    dot: '#38bdf8',
    lit: ['#cbe5ff', '#3a6fa3', '#122540'],
    dark: ['#213f63', '#10223a', '#07101f'],
    mid: ['#16304f', '#070e1a'],
    rim: ['#eaf6ff', '#7cc4fa'],
    sky2d: ['#0b1c3b', '#246199', '#d7b296'],
    farRidge: '#1c4470',
  },
  nocturne: {
    id: 2,
    label: 'Nocturne',
    defaultTag: 'THU 27 NOV · NOCTURNE',
    elevation: 'RIDGE 4,110 M',
    dot: '#60a5fa',
    lit: ['#8ab4f8', '#294878', '#0c1528'],
    dark: ['#1a2946', '#0d1526', '#050811'],
    mid: ['#111e36', '#050810'],
    rim: ['#dbeafe', '#60a5fa'],
    sky2d: ['#060916', '#10244a', '#244875'],
    farRidge: '#142a52',
  },
};

const MODES = { depth: 0, flat: 1, mask: 2 };

const LAYER_SLOTS = [
  { key: 'clock', el: clockLayerEl, tex: null, dirty: true },
  { key: 'subject', el: subjectLayerEl, tex: null, dirty: true },
];
const ELEMENT_COUNT = LAYER_SLOTS.length;

const state = {
  backend: 'init', // 'webgl' | '2d' | 'plain'
  mode: 'depth',   // 'depth' | 'flat' | 'mask'
  theme: 'sunset', // 'sunset' | 'alpine' | 'nocturne'
  hasPainted: false,
  onScreen: true,
  autoDrift: !reducedQuery.matches,
  reducedOverride: reducedQuery.matches,
  liveClock: true,
  alarmOn: true,
  tagEdited: false,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0,
  pointerHover: false,
  pointerDrag: null,
  gyroBase: null,
  gyroActive: false,
  driftPhase: 0,
  lastTickMs: 0,
  rafId: 0,
  paints: 0,
  uploads: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  lastClockStr: '',
  lastLayerWidthKey: '',
};

ctlReduced.checked = state.reducedOverride;
ctlDrift.checked = state.autoDrift;

const isReducedMotion = () => state.reducedOverride || reducedQuery.matches;

function formatLiveTime(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function syncClockText(forcePaint = false) {
  const next = state.liveClock ? formatLiveTime() : '09:41';
  if (next !== state.lastClockStr) {
    state.lastClockStr = next;
    clockTimeOut.textContent = next;
    markSlotDirty(clockLayerEl);
    if (forcePaint && state.backend !== 'plain') canvas.requestPaint?.();
  }
}

function applyThemeToSvg(themeKey) {
  const t = THEMES[themeKey] || THEMES.sunset;
  const setStop = (id, col) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('stop-color', col);
  };
  setStop('dw-stop-lit-0', t.lit[0]);
  setStop('dw-stop-lit-1', t.lit[1]);
  setStop('dw-stop-lit-2', t.lit[2]);
  setStop('dw-stop-dark-0', t.dark[0]);
  setStop('dw-stop-dark-1', t.dark[1]);
  setStop('dw-stop-dark-2', t.dark[2]);
  setStop('dw-stop-mid-0', t.mid[0]);
  setStop('dw-stop-mid-1', t.mid[1]);
  setStop('dw-stop-rim-0', t.rim[0]);
  setStop('dw-stop-rim-1', t.rim[1]);
  if (fgElevationEl) fgElevationEl.textContent = t.elevation;
  if (fgDotEl) fgDotEl.style.background = t.dot;
  plainHost.dataset.theme = themeKey;
  if (!state.tagEdited) {
    dateTagInput.value = t.defaultTag;
    markSlotDirty(clockLayerEl);
  }
  markSlotDirty(subjectLayerEl);
}

function markSlotDirty(el) {
  for (let i = 0; i < ELEMENT_COUNT; i++) {
    if (LAYER_SLOTS[i].el === el) LAYER_SLOTS[i].dirty = true;
  }
}

function clearSlotTextures() {
  for (let i = 0; i < ELEMENT_COUNT; i++) {
    LAYER_SLOTS[i].tex = null;
    LAYER_SLOTS[i].dirty = true;
  }
}

// ---------------- Fragment Shader (3-Plane Twilight Sky + Premultiplied Depth Composite) ----------------

// #region depth-shader
export const DEPTH_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uSubjectTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec4 uClockRect;
uniform vec4 uSubjectRect;
uniform vec2 uOffset;
uniform int uMode;
uniform int uTheme;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float ridgeHeight(float x, float seed, float freq, float amp) {
  float h = sin(x * freq + seed) * 0.55
          + sin(x * freq * 2.17 + seed * 1.9) * 0.28
          + sin(x * freq * 4.41 + seed * 3.1) * 0.17;
  return h * amp;
}

vec3 twilightBackdrop(vec2 pCss) {
  vec2 res = max(uCanvasSize, vec2(1.0));
  vec2 skyCss = pCss - uOffset * 0.35;
  vec2 uv = skyCss / res;

  vec3 zenith;
  vec3 mid;
  vec3 horizon;
  vec3 glowCol;
  vec3 ridgeColA;
  vec3 ridgeColB;
  vec2 orbPos;

  if (uTheme == 1) {
    zenith = vec3(0.039, 0.102, 0.235);
    mid = vec3(0.145, 0.420, 0.690);
    horizon = vec3(0.875, 0.675, 0.545);
    glowCol = vec3(0.980, 0.860, 0.720);
    ridgeColA = vec3(0.140, 0.280, 0.450);
    ridgeColB = vec3(0.095, 0.200, 0.340);
    orbPos = vec2(0.54, 0.54);
  } else if (uTheme == 2) {
    zenith = vec3(0.020, 0.031, 0.082);
    mid = vec3(0.059, 0.141, 0.310);
    horizon = vec3(0.173, 0.314, 0.510);
    glowCol = vec3(0.680, 0.820, 1.000);
    ridgeColA = vec3(0.085, 0.165, 0.320);
    ridgeColB = vec3(0.055, 0.105, 0.220);
    orbPos = vec2(0.32, 0.26);
  } else {
    zenith = vec3(0.075, 0.055, 0.176);
    mid = vec3(0.478, 0.165, 0.341);
    horizon = vec3(0.957, 0.490, 0.224);
    glowCol = vec3(1.000, 0.745, 0.420);
    ridgeColA = vec3(0.280, 0.130, 0.270);
    ridgeColB = vec3(0.180, 0.090, 0.210);
    orbPos = vec2(0.50, 0.55);
  }

  vec3 col = mix(zenith, mid, smoothstep(0.02, 0.48, uv.y));
  col = mix(col, horizon, smoothstep(0.42, 0.96, uv.y));

  float aspect = res.x / res.y;
  vec2 dOrb = vec2((uv.x - orbPos.x) * aspect, uv.y - orbPos.y);
  float dist = length(dOrb);
  float shimmer = uReduced > 0.5 ? 1.0 : (0.94 + 0.06 * sin(uTime * 0.7));
  col += glowCol * exp(-dist * 3.4) * 0.52 * shimmer;
  col += glowCol * smoothstep(0.085, 0.035, dist) * (uTheme == 2 ? 0.45 : 0.28);

  // Faint stars in upper sky (strongest in Nocturne, subtle in Sunset/Alpine)
  vec2 grid = floor(uv * vec2(78.0, 96.0));
  vec2 cell = fract(uv * vec2(78.0, 96.0)) - 0.5;
  float h = hash21(grid);
  float starMask = step(uTheme == 2 ? 0.94 : 0.978, h) * (1.0 - smoothstep(0.06, 0.48, uv.y));
  if (starMask > 0.0) {
    float twinkle = uReduced > 0.5 ? 0.85 : (0.65 + 0.35 * sin(uTime * (1.2 + h * 2.5) + h * 37.0));
    float dStar = length(cell - (vec2(fract(h * 13.7), fract(h * 29.3)) - 0.5) * 0.65);
    col += vec3(0.90, 0.94, 1.0) * smoothstep(0.26, 0.0, dStar) * starMask * twinkle;
  }

  // Two distant atmospheric mountain silhouettes behind the clock plane
  float r1 = 0.58 + ridgeHeight(uv.x, 1.2, 4.3, 0.055);
  float m1 = 1.0 - smoothstep(r1 - 0.004, r1 + 0.004, uv.y);
  col = mix(col, mix(ridgeColA, horizon, 0.32), (1.0 - m1) * 0.72);

  float r2 = 0.68 + ridgeHeight(uv.x, 3.8, 5.8, 0.048);
  float m2 = 1.0 - smoothstep(r2 - 0.004, r2 + 0.004, uv.y);
  col = mix(col, ridgeColB, (1.0 - m2) * 0.85);

  return clamp(col, 0.0, 1.0);
}

vec4 sampleLayer(sampler2D tex, vec4 rect, vec2 pCss) {
  vec2 local = pCss - rect.xy;
  if (local.x < 0.0 || local.x > rect.z || local.y < 0.0 || local.y > rect.w) {
    return vec4(0.0);
  }
  vec2 uv = local / max(rect.zw, vec2(1.0));
  if (uv.x < 0.001 || uv.x > 0.999 || uv.y < 0.001 || uv.y > 0.999) {
    return vec4(0.0);
  }
  return texture(tex, uv);
}

void main() {
  vec2 pCss = vUv * uCanvasSize;
  vec3 sky = twilightBackdrop(pCss);
  vec4 clock = sampleLayer(uTex, uClockRect, pCss);
  vec4 fg = sampleLayer(uSubjectTex, uSubjectRect, pCss);

  vec3 col = sky;
  if (uMode == 0) {
    // Depth occlusion on: composite premultiplied clock over sky, then premultiplied cutout over clock
    col = clock.rgb + col * (1.0 - clock.a);
    col = fg.rgb + col * (1.0 - fg.a);
  } else if (uMode == 1) {
    // Flat overlay (clock in front): foreground cutout sits behind the clock
    col = fg.rgb + col * (1.0 - fg.a);
    col = clock.rgb + col * (1.0 - clock.a);
  } else {
    // Mask alpha debug: dim sky, keep clock crisp, tint foreground alpha mask and overlap zone cleanly
    vec3 dbg = mix(sky * 0.28, vec3(0.05, 0.08, 0.14), 0.35);
    dbg = clock.rgb + dbg * (1.0 - clock.a);
    float edgeBand = smoothstep(0.04, 0.42, fg.a) * (1.0 - smoothstep(0.58, 0.96, fg.a));
    float overlap = fg.a * clock.a;
    vec3 maskFill = mix(dbg, vec3(0.10, 0.38, 0.72), fg.a * 0.78);
    maskFill = mix(maskFill, vec3(0.98, 0.56, 0.22), overlap * 0.88);
    col = maskFill + vec3(1.00, 0.88, 0.44) * edgeBand * 0.95;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion depth-shader

// ---------------- Geometry, Layout & Hit Testing ----------------

function canvasCssBox() {
  return {
    cw: Math.max(200, canvas.clientWidth || viewportEl.clientWidth || 380),
    ch: Math.max(260, canvas.clientHeight || viewportEl.clientHeight || 454),
  };
}

function syncLayerSizes(cw) {
  if (state.backend === 'plain') {
    if (subjectLayerEl.style.width) subjectLayerEl.style.width = '';
    if (clockLayerEl.style.width) clockLayerEl.style.width = '';
    return;
  }
  const targetClockW = `${Math.min(344, Math.max(220, Math.round(cw - 16)))}px`;
  const targetFgW = `${Math.round(cw + 76)}px`;
  const key = `${targetClockW}/${targetFgW}`;
  if (state.lastLayerWidthKey !== key) {
    state.lastLayerWidthKey = key;
    if (clockLayerEl.style.width !== targetClockW) clockLayerEl.style.width = targetClockW;
    if (subjectLayerEl.style.width !== targetFgW) subjectLayerEl.style.width = targetFgW;
    markSlotDirty(clockLayerEl);
    markSlotDirty(subjectLayerEl);
    state.unitCache.key = '';
    state.lastGeoKey = '';
  }
}

export function computeSceneRects(cw, ch, clockW, clockH, digitTop, digitH, fgW, fgH, ox, oy) {
  const baseClockX = Math.round((cw - clockW) * 0.5);
  const baseClockY = Math.round(clamp(ch * 0.044, 14, 24));
  const baseFgX = Math.round((cw - fgW) * 0.5);
  const digitCenterY = baseClockY + digitTop + digitH * 0.43;
  const baseFgY = Math.round(digitCenterY - 6);

  return {
    clockX: baseClockX + ox * PARALLAX_CLOCK,
    clockY: baseClockY + oy * PARALLAX_CLOCK,
    clockW,
    clockH,
    fgX: baseFgX + ox * PARALLAX_SUBJECT,
    fgY: baseFgY + oy * PARALLAX_SUBJECT,
    fgW,
    fgH,
  };
}

// #region parallax-hit
function syncHitGeometry(rects, cw, force = false) {
  if (state.backend === 'plain' || !('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const elemW = rects.clockW || 320;
  const unitKey = `${canvas.width}x${canvas.height}/${cw}/${elemW}`;
  if (state.unitCache.key !== unitKey && canvas.width > 0 && cw > 0) {
    state.unitCache.unit = geometryUnit(canvas, clockLayerEl, elemW);
    state.unitCache.key = unitKey;
    state.lastGeoKey = '';
  }
  const unit = state.unitCache.unit || 1;
  const rx = Math.round(rects.clockX * 10) / 10;
  const ry = Math.round(rects.clockY * 10) / 10;
  const key = `${rx}:${ry}:${unit.toFixed(4)}`;
  if (!force && state.lastGeoKey === key) return;
  state.lastGeoKey = key;

  clockLayerEl.inert = false;
  subjectLayerEl.inert = true;
  canvas.updateElementGeometry(clockLayerEl, {
    canvasTransform: new DOMMatrix().scale(unit, unit, 1).translate(rx, ry),
  });
  if (OFFSTAGE) {
    canvas.updateElementGeometry(subjectLayerEl, { canvasTransform: OFFSTAGE });
  }
  clockLayerEl.dataset.hitTick = clockLayerEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion parallax-hit

function currentRects() {
  const { cw, ch } = canvasCssBox();
  syncLayerSizes(cw);
  const clockW = clockLayerEl.offsetWidth || 320;
  const clockH = clockLayerEl.offsetHeight || 200;
  const digitTop = clockTimeOut.offsetTop || 82;
  const digitH = clockTimeOut.offsetHeight || 90;
  const fgW = subjectLayerEl.offsetWidth || (cw + 76);
  const fgH = subjectLayerEl.offsetHeight || 360;
  return {
    cw,
    ch,
    ...computeSceneRects(cw, ch, clockW, clockH, digitTop, digitH, fgW, fgH, state.offsetX, state.offsetY),
  };
}

// ---------------- WebGL 2 Rendering (ElementGL) ----------------

let stage = null;
let ctx2d = null;

// #region gl-upload
function uploadDirtySlots(changedElements = null) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const caretActive = document.activeElement === dateTagInput;
  for (let i = 0; i < ELEMENT_COUNT; i++) {
    const slot = LAYER_SLOTS[i];
    const changed = caretActive && changedElements
      ? changedElements.some((node) => node === slot.el || slot.el.contains(node))
      : false;
    if (!slot.tex || slot.dirty || changed) {
      try {
        const tex = stage.upload(slot.el);
        if (tex) {
          slot.tex = tex;
          slot.dirty = false;
          state.uploads++;
        }
      } catch (err) {
        if (/paint record/i.test(err?.message ?? '')) {
          canvas.requestPaint?.();
        } else {
          throw err;
        }
      }
    }
  }
}

function drawWebGL(changedElements = null, forceGeo = false, allowUpload = false) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const rects = currentRects();
  if (rects.cw <= 0 || rects.ch <= 0) return;

  if (!stage.begin([0.02, 0.03, 0.07, 1.0])) return;
  if (allowUpload) {
    uploadDirtySlots(changedElements);
  }
  if (LAYER_SLOTS.some((s) => !s.tex)) return;

  const themeId = THEMES[state.theme]?.id ?? 0;
  const modeId = MODES[state.mode] ?? 0;
  const reducedVal = isReducedMotion() ? 1.0 : 0.0;

  stage.quad(LAYER_SLOTS[0].el, ElementGL.rect(canvas, 0, 0, rects.cw, rects.ch), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, LAYER_SLOTS[1].tex.tex);
    gl.uniform1i(loc('uSubjectTex'), 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform2f(loc('uCanvasSize'), rects.cw, rects.ch);
    gl.uniform4f(loc('uClockRect'), rects.clockX, rects.clockY, rects.clockW, rects.clockH);
    gl.uniform4f(loc('uSubjectRect'), rects.fgX, rects.fgY, rects.fgW, rects.fgH);
    gl.uniform2f(loc('uOffset'), state.offsetX, state.offsetY);
    gl.uniform1i(loc('uMode'), modeId);
    gl.uniform1i(loc('uTheme'), themeId);
    gl.uniform1f(loc('uReduced'), reducedVal);
  });

  syncHitGeometry(rects, rects.cw, forceGeo);
  updateHud();
}
// #endregion gl-upload

// ---------------- 5-Argument 2D & Plain HTML Fallbacks ----------------

// #region fallbacks
function draw2DFallback(forceGeo = false) {
  if (!state.hasPainted || !ctx2d) return;
  const rects = currentRects();
  const { cw, ch } = rects;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = THEMES[state.theme] || THEMES.sunset;
  const skyGrad = ctx2d.createLinearGradient(0, 0, 0, ch);
  skyGrad.addColorStop(0, t.sky2d[0]);
  skyGrad.addColorStop(0.48, t.sky2d[1]);
  skyGrad.addColorStop(1, t.sky2d[2]);
  ctx2d.fillStyle = skyGrad;
  ctx2d.fillRect(0, 0, cw, ch);

  const sx = state.offsetX * PARALLAX_SKY;
  const sy = state.offsetY * PARALLAX_SKY;
  ctx2d.fillStyle = t.farRidge;
  ctx2d.beginPath();
  ctx2d.moveTo(-20 + sx, ch);
  ctx2d.lineTo(-20 + sx, ch * 0.66 + sy);
  ctx2d.lineTo(cw * 0.25 + sx, ch * 0.56 + sy);
  ctx2d.lineTo(cw * 0.52 + sx, ch * 0.63 + sy);
  ctx2d.lineTo(cw * 0.80 + sx, ch * 0.53 + sy);
  ctx2d.lineTo(cw + 20 + sx, ch * 0.64 + sy);
  ctx2d.lineTo(cw + 20 + sx, ch);
  ctx2d.closePath();
  ctx2d.fill();

  const drawClock = () => {
    try {
      ctx2d.drawElementImage(clockLayerEl, rects.clockX, rects.clockY, rects.clockW, rects.clockH);
    } catch {}
  };
  const drawSubject = () => {
    try {
      ctx2d.drawElementImage(subjectLayerEl, rects.fgX, rects.fgY, rects.fgW, rects.fgH);
    } catch {}
  };

  if (state.mode === 'flat') {
    drawSubject();
    drawClock();
  } else if (state.mode === 'mask') {
    drawClock();
    ctx2d.save();
    ctx2d.globalAlpha = 0.65;
    drawSubject();
    ctx2d.strokeStyle = '#ff7a4d';
    ctx2d.lineWidth = 2;
    ctx2d.strokeRect(rects.fgX + 4, rects.fgY + 8, rects.fgW - 8, rects.fgH - 16);
    ctx2d.restore();
  } else {
    drawClock();
    drawSubject();
  }

  syncHitGeometry(rects, cw, forceGeo);
  updateHud();
}

function enterPlainFallback(reason, { keepForRestore = false } = {}) {
  state.backend = 'plain';
  stageEl.classList.add('is-plain');
  clockLayerEl.inert = false;
  subjectLayerEl.inert = true;
  if (clockLayerEl.parentElement !== plainHost) plainHost.append(clockLayerEl);
  if (subjectLayerEl.parentElement !== plainHost) plainHost.append(subjectLayerEl);
  syncPlainLayout();
  routeNoteEl.textContent = reason;
  updateHud();
  if (!keepForRestore) stopLoop();
}

function exitPlainFallback() {
  stageEl.classList.remove('is-plain');
  if (clockLayerEl.parentElement !== canvas) canvas.append(clockLayerEl);
  if (subjectLayerEl.parentElement !== canvas) canvas.append(subjectLayerEl);
  clockLayerEl.style.transform = '';
  subjectLayerEl.style.transform = '';
  clockLayerEl.style.zIndex = '';
  subjectLayerEl.style.zIndex = '';
  subjectLayerEl.style.opacity = '';
  state.lastGeoKey = '';
  state.unitCache.key = '';
  state.lastLayerWidthKey = '';
}
// #endregion fallbacks

function syncPlainLayout() {
  if (state.backend !== 'plain') return;
  const cw = plainHost.clientWidth || viewportEl.clientWidth || 360;
  const ch = plainHost.clientHeight || viewportEl.clientHeight || 454;
  const clockW = clockLayerEl.offsetWidth || Math.min(344, cw - 16);
  const digitTop = clockTimeOut.offsetTop || 82;
  const digitH = clockTimeOut.offsetHeight || 90;
  const fgW = subjectLayerEl.offsetWidth || 456;
  const r = computeSceneRects(cw, ch, clockW, 200, digitTop, digitH, fgW, 360, state.offsetX, state.offsetY);
  clockLayerEl.style.transform = `translate(${r.clockX.toFixed(1)}px, ${r.clockY.toFixed(1)}px)`;
  subjectLayerEl.style.transform = `translate(${r.fgX.toFixed(1)}px, ${r.fgY.toFixed(1)}px)`;
  if (state.mode === 'flat') {
    clockLayerEl.style.zIndex = '2';
    subjectLayerEl.style.zIndex = '1';
    subjectLayerEl.style.opacity = '1';
  } else if (state.mode === 'mask') {
    clockLayerEl.style.zIndex = '1';
    subjectLayerEl.style.zIndex = '2';
    subjectLayerEl.style.opacity = '0.62';
  } else {
    clockLayerEl.style.zIndex = '1';
    subjectLayerEl.style.zIndex = '2';
    subjectLayerEl.style.opacity = '1';
  }
}

// ---------------- UI Sync & Animation Loop ----------------

function updateUI() {
  for (const btn of modeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.modeBtn === state.mode));
  }
  for (const btn of themeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeBtn === state.theme));
  }
  const depthOn = state.mode === 'depth';
  widgetDepthBtn.setAttribute('aria-pressed', String(depthOn));
  widgetDepthBtn.textContent = depthOn ? 'Depth On' : state.mode === 'flat' ? 'Flat' : 'Mask';

  widgetAlarmBtn.setAttribute('aria-pressed', String(state.alarmOn));
  widgetAlarmBtn.textContent = state.alarmOn ? '07:30 Alarm' : 'Alarm Off';

  widgetTimeBtn.setAttribute('aria-pressed', String(!state.liveClock));
  widgetTimeBtn.textContent = state.liveClock ? 'Demo 09:41' : 'Live Time';

  const roundedX = Math.round(state.offsetX);
  if (!state.pointerDrag && !state.pointerHover) {
    ctlParallaxX.value = String(roundedX);
  }
  outParallaxX.textContent = `${roundedX} px`;
}

function updateHud() {
  const routeLabel = state.backend === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.backend === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const modeLabel = state.mode === 'depth'
    ? 'Depth on'
    : state.mode === 'flat'
      ? 'Flat overlay'
      : 'Mask alpha';
  const themeLabel = THEMES[state.theme]?.label ?? 'Sunset';
  const mp = state.backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  hudEl.textContent =
    `${routeLabel} · ${modeLabel} · ${themeLabel} · offset (${Math.round(state.offsetX)},${Math.round(state.offsetY)}) px · ${mp} MP · ${state.uploads} uploads`;
}

function drawCurrentFrame(changed = null, forceGeo = false, allowUpload = false) {
  if (state.backend === 'webgl') drawWebGL(changed, forceGeo, allowUpload);
  else if (state.backend === '2d') draw2DFallback(forceGeo);
  else syncPlainLayout();
}

function shouldRunLoop() {
  if (!state.onScreen || document.hidden) return false;
  if (state.pointerDrag || state.pointerHover || state.gyroActive) return true;
  if (isReducedMotion()) return false;
  if (state.autoDrift) return true;
  return Math.abs(state.targetX - state.offsetX) > 0.15 || Math.abs(state.targetY - state.offsetY) > 0.15;
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function startLoop() {
  if (!state.rafId && shouldRunLoop()) {
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  state.rafId = 0;
  if (!shouldRunLoop()) return;

  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;

  if (!state.pointerDrag && !state.pointerHover && !state.gyroActive && state.autoDrift && !isReducedMotion()) {
    state.driftPhase += dt;
    state.targetX = Math.sin(state.driftPhase * 0.72) * 18;
    state.targetY = Math.cos(state.driftPhase * 0.51) * 9;
  }

  if (isReducedMotion()) {
    state.offsetX = state.targetX;
    state.offsetY = state.targetY;
  } else {
    const ease = Math.min(1, dt * 10);
    state.offsetX += (state.targetX - state.offsetX) * ease;
    state.offsetY += (state.targetY - state.offsetY) * ease;
  }

  updateUI();
  if (state.hasPainted || state.backend === 'plain') drawCurrentFrame(null, false);
  if (shouldRunLoop()) state.rafId = requestAnimationFrame(tick);
}

// ---------------- Controls & Pointer / Gyro Interactions ----------------

function setMode(next) {
  if (!(next in MODES) || next === state.mode) return;
  state.mode = next;
  markSlotDirty(clockLayerEl);
  updateUI();
  updateHud();
  if (state.backend !== 'plain') canvas.requestPaint?.();
  if (state.hasPainted || state.backend === 'plain') drawCurrentFrame(null, true);
}

function setTheme(next) {
  if (!THEMES[next] || next === state.theme) return;
  state.theme = next;
  applyThemeToSvg(next);
  updateUI();
  updateHud();
  if (state.backend !== 'plain') canvas.requestPaint?.();
  else drawCurrentFrame(null, true);
}

for (const btn of modeButtons) {
  btn.addEventListener('click', () => setMode(btn.dataset.modeBtn));
}
for (const btn of themeButtons) {
  btn.addEventListener('click', () => setTheme(btn.dataset.themeBtn));
}

widgetDepthBtn.addEventListener('click', () => {
  setMode(state.mode === 'depth' ? 'flat' : 'depth');
});
widgetAlarmBtn.addEventListener('click', () => {
  state.alarmOn = !state.alarmOn;
  markSlotDirty(clockLayerEl);
  updateUI();
  if (state.backend !== 'plain') canvas.requestPaint?.();
});
widgetTimeBtn.addEventListener('click', () => {
  state.liveClock = !state.liveClock;
  syncClockText(true);
  updateUI();
});
dateTagInput.addEventListener('input', () => {
  state.tagEdited = true;
  markSlotDirty(clockLayerEl);
  if (state.backend !== 'plain') canvas.requestPaint?.();
});
clockLayerEl.addEventListener('focusin', () => {
  markSlotDirty(clockLayerEl);
  if (state.backend !== 'plain') canvas.requestPaint?.();
});
clockLayerEl.addEventListener('focusout', () => {
  markSlotDirty(clockLayerEl);
  if (state.backend !== 'plain') canvas.requestPaint?.();
});

ctlDrift.addEventListener('change', () => {
  state.autoDrift = ctlDrift.checked;
  if (state.autoDrift && isReducedMotion()) {
    ctlReduced.checked = false;
    state.reducedOverride = false;
  }
  if (!state.autoDrift) {
    state.targetX = state.offsetX;
    state.targetY = state.offsetY;
  }
  updateUI();
  startLoop();
});

ctlReduced.addEventListener('change', () => {
  state.reducedOverride = ctlReduced.checked;
  if (isReducedMotion()) {
    stopLoop();
  }
  updateUI();
  drawCurrentFrame(null, true);
  startLoop();
});

reducedQuery.addEventListener?.('change', () => {
  ctlReduced.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (reducedQuery.matches) {
    state.autoDrift = false;
    ctlDrift.checked = false;
    stopLoop();
  }
  updateUI();
  drawCurrentFrame(null, true);
});

ctlParallaxX.addEventListener('input', () => {
  state.autoDrift = false;
  ctlDrift.checked = false;
  state.gyroActive = false;
  const val = clamp(Number(ctlParallaxX.value) || 0, -MAX_PARALLAX, MAX_PARALLAX);
  state.targetX = val;
  state.offsetX = val;
  updateUI();
  drawCurrentFrame(null, true);
});

btnCenter.addEventListener('click', () => {
  state.autoDrift = false;
  ctlDrift.checked = false;
  state.gyroActive = false;
  state.targetX = 0;
  state.targetY = 0;
  state.offsetX = 0;
  state.offsetY = 0;
  ctlParallaxX.value = '0';
  updateUI();
  drawCurrentFrame(null, true);
});

function setTargetFromPointer(e) {
  const rect = viewportEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const nx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
  const ny = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  state.targetX = nx * MAX_PARALLAX;
  state.targetY = ny * (MAX_PARALLAX * 0.65);
}

viewportEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, input, a, label')) return;
  state.pointerDrag = { pointerId: e.pointerId };
  viewportEl.setPointerCapture?.(e.pointerId);
  setTargetFromPointer(e);
  if (isReducedMotion()) {
    state.offsetX = state.targetX;
    state.offsetY = state.targetY;
    updateUI();
    drawCurrentFrame(null, true);
  } else {
    startLoop();
  }
});

viewportEl.addEventListener('pointermove', (e) => {
  if (state.pointerDrag && e.pointerId === state.pointerDrag.pointerId) {
    setTargetFromPointer(e);
    if (isReducedMotion()) {
      state.offsetX = state.targetX;
      state.offsetY = state.targetY;
      updateUI();
      drawCurrentFrame(null, true);
    } else {
      startLoop();
    }
    return;
  }
  if (e.pointerType === 'mouse' && !e.target.closest('button, input')) {
    state.pointerHover = true;
    setTargetFromPointer(e);
    if (isReducedMotion()) {
      state.offsetX = state.targetX;
      state.offsetY = state.targetY;
      updateUI();
      drawCurrentFrame(null, true);
    } else {
      startLoop();
    }
  }
});

const releasePointer = (e) => {
  if (state.pointerDrag && e.pointerId === state.pointerDrag.pointerId) {
    state.pointerDrag = null;
  }
  if (e.type === 'pointerleave') {
    state.pointerHover = false;
  }
  if (!state.autoDrift && !state.pointerDrag && !state.pointerHover) {
    ctlParallaxX.value = String(Math.round(state.offsetX));
  }
};
viewportEl.addEventListener('pointerup', releasePointer);
viewportEl.addEventListener('pointercancel', releasePointer);
viewportEl.addEventListener('pointerleave', releasePointer);

// Refresh hit geometry right before pointer taps inside the canvas.
const refreshGeoBeforeInput = () => {
  if (state.backend === 'plain' || !state.hasPainted) return;
  const rects = currentRects();
  syncHitGeometry(rects, rects.cw, false);
};
canvas.addEventListener('pointerdown', refreshGeoBeforeInput, true);
canvas.addEventListener('focusin', refreshGeoBeforeInput);

window.addEventListener('deviceorientation', (e) => {
  if (e.gamma == null || e.beta == null || isReducedMotion() || state.pointerDrag) return;
  if (!state.gyroBase) {
    state.gyroBase = { gamma: e.gamma, beta: e.beta };
  }
  const dg = e.gamma - state.gyroBase.gamma;
  const db = e.beta - state.gyroBase.beta;
  if (Math.hypot(dg, db) > 1.2) {
    state.gyroActive = true;
    state.targetX = clamp(dg / 22, -1, 1) * MAX_PARALLAX;
    state.targetY = clamp(db / 22, -1, 1) * (MAX_PARALLAX * 0.65);
    startLoop();
  }
}, { passive: true });

// ---------------- Backend Init & Lifecycle Observers ----------------

function wireCanvasEvents() {
  canvas.addEventListener('paint', (e) => {
    state.paints++;
    state.hasPainted = true;
    const changed = e.changedElements ? Array.from(e.changedElements) : null;
    if (state.backend === 'webgl' && stage && !stage.lost) {
      drawWebGL(changed, true, true);
    } else if (state.backend === '2d' && ctx2d) {
      draw2DFallback(true);
    }
    startLoop();
  });

  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.backend === '2d') {
      state.hasPainted = false;
      enterPlainFallback('The 2D canvas context was lost, so the lock-screen layers moved to plain HTML.', { keepForRestore: true });
    }
  });

  canvas.addEventListener('contextrestored', () => {
    if (state.backend === 'plain' && ctx2d) {
      state.backend = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      routeNoteEl.textContent = '2D canvas context restored (5-argument drawElementImage()).';
      canvas.requestPaint?.();
      startLoop();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: DEPTH_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          clearSlotTextures();
          state.hasPainted = false;
          enterPlainFallback('The WebGL 2 context was lost, so the clock and foreground cutout moved to plain HTML until restored.', { keepForRestore: true });
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          clearSlotTextures();
          state.backend = 'webgl';
          state.hasPainted = false;
          exitPlainFallback();
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context with premultiplied texElementSubImage2D()).';
          canvas.requestPaint?.();
          startLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.backend = 'webgl';
      routeNoteEl.textContent = 'Drawn with one ElementGL WebGL 2 context compositing two drawable layers over a procedural twilight sky shader.';
      wireCanvasEvents();
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 could not start (${err.message}); trying 2D fallback.`;
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument drawElementImage() 2D fallback.';
      wireCanvasEvents();
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the clock and foreground cutout are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) stopLoop();
    else {
      if (state.hasPainted) drawCurrentFrame(null, false);
      startLoop();
    }
  }, { rootMargin: '120px' }).observe(stageEl);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.backend === 'plain') {
      syncPlainLayout();
      return;
    }
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    state.unitCache.key = '';
    state.lastGeoKey = '';
    syncLayerSizes(cw);
    if (state.hasPainted) canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else {
    syncClockText(true);
    if (state.onScreen && state.hasPainted) drawCurrentFrame(null, false);
    startLoop();
  }
});

setInterval(() => {
  if (!document.hidden && state.onScreen && state.liveClock) {
    syncClockText(true);
  }
}, 5000);

applyThemeToSvg(state.theme);
syncClockText(false);
syncLayerSizes(canvasCssBox().cw);
updateUI();
updateHud();
initBackend();

// ---------------- Live Checks (Tap-Gated, Isolated testStage Fixtures) ----------------

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
  const rx = clamp(Math.round(cssX * (cv.width / w)), 0, Math.max(0, cv.width - 1));
  const ry = clamp(Math.round((h - cssY) * (cv.height / h)), 0, Math.max(0, cv.height - 1));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeFixtureLayers(w, h, { mode = 'occlusion' } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;background:#0a0f1f`;

  const clockEl = document.createElement('div');
  clockEl.setAttribute('drawable', '');
  clockEl.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:transparent;box-sizing:border-box;`;

  const fgEl = document.createElement('div');
  fgEl.setAttribute('drawable', '');
  fgEl.setAttribute('inert', '');
  fgEl.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:transparent;pointer-events:none;box-sizing:border-box;`;

  let btn = null;
  let inp = null;

  if (mode === 'premul') {
    const pill = document.createElement('div');
    pill.style.cssText = 'position:absolute;left:132px;top:20px;width:88px;height:34px;background:rgba(255,255,255,0.20);border-radius:10px;';
    clockEl.append(pill);

    const cutout = document.createElement('div');
    cutout.style.cssText = 'position:absolute;left:130px;top:76px;width:86px;height:64px;background:#1a365d;border-radius:8px;';
    fgEl.append(cutout);
  } else if (mode === 'occlusion') {
    const digitBlock = document.createElement('div');
    digitBlock.style.cssText = `position:absolute;left:${Math.round(w * 0.25)}px;top:28px;width:${Math.round(w * 0.50)}px;height:${Math.round(h * 0.65)}px;background:#ffffff;`;
    clockEl.append(digitBlock);

    const peakBlock = document.createElement('div');
    peakBlock.style.cssText = `position:absolute;left:${Math.round(w * 0.20)}px;top:${Math.round(h * 0.45)}px;width:${Math.round(w * 0.60)}px;height:${Math.round(h * 0.50)}px;background:#1d3557;`;
    fgEl.append(peakBlock);
  } else if (mode === 'parallax') {
    const stripeClock = document.createElement('div');
    stripeClock.style.cssText = 'position:absolute;left:112px;top:22px;width:28px;height:38px;background:#ffffff;';
    clockEl.append(stripeClock);

    const stripeFg = document.createElement('div');
    stripeFg.style.cssText = 'position:absolute;left:112px;top:92px;width:28px;height:44px;background:#ff7a4d;';
    fgEl.append(stripeFg);
  } else if (mode === 'hit') {
    clockEl.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:130px;background:transparent;';
    inp = document.createElement('input');
    inp.type = 'text';
    inp.value = 'NOV 27';
    inp.style.cssText = 'position:absolute;left:24px;top:12px;width:152px;height:34px;border:1px solid #fff;background:rgba(255,255,255,0.2);color:#fff;';
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Depth';
    btn.style.cssText = 'position:absolute;left:50px;top:60px;width:100px;height:38px;background:#ff7a4d;color:#111;border:0;border-radius:8px;font:700 13px system-ui;';
    clockEl.append(inp, btn);

    const fgCut = document.createElement('div');
    fgCut.style.cssText = 'position:absolute;left:0;top:96px;width:240px;height:80px;background:#162238;';
    fgEl.append(fgCut);
  }

  cv.append(clockEl, fgEl);
  return { cv, clockEl, fgEl, btn, inp };
}

function drawFixtureScene(g, cv, clockEl, fgEl, w, h, ox, oy, modeId = 0) {
  const slots = [clockEl, fgEl];
  const uploaded = slots.map((el) => g.upload(el));
  if (uploaded.some((t) => !t)) return;
  g.quad(clockEl, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, uploaded[1].tex);
    gl.uniform1i(loc('uSubjectTex'), 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform4f(loc('uClockRect'), ox * PARALLAX_CLOCK, oy * PARALLAX_CLOCK, clockEl.offsetWidth || w, clockEl.offsetHeight || h);
    gl.uniform4f(loc('uSubjectRect'), ox * PARALLAX_SUBJECT, oy * PARALLAX_SUBJECT, fgEl.offsetWidth || w, fgEl.offsetHeight || h);
    gl.uniform2f(loc('uOffset'), ox, oy);
    gl.uniform1i(loc('uMode'), modeId);
    gl.uniform1i(loc('uTheme'), 2); // Nocturne dark backdrop for sharp contrast checks
    gl.uniform1f(loc('uReduced'), 1.0);
  });
}

runTests(testsBody, [
  {
    name: 'Both layers upload into ELEMENT_COUNT slots with premultiplied alpha and gl.getError() === 0',
    expect: 'pass',
    why: 'Sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls stage.begin() before uploading #fx-clock and #fx-subject via texElementSubImage2D(), checks translucent pill alpha (no white washout) and solid foreground colour.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 240;
      const H = 160;
      const { cv, clockEl, fgEl } = makeFixtureLayers(W, H, { mode: 'premul' });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: DEPTH_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.02, 0.03, 0.08, 1.0]);
        await nextPaint(cv);
        g.begin([0.02, 0.03, 0.08, 1.0]);
        drawFixtureScene(g, cv, clockEl, fgEl, W, H, 0, 0, 0);
        const glErr = g.gl.getError();
        const pillPx = readCssPixel(g.gl, cv, W, H, 176, 37);
        const fgPx = readCssPixel(g.gl, cv, W, H, 172, 106);
        const skyPx = readCssPixel(g.gl, cv, W, H, 176, 8);
        return need(
          glErr === 0 &&
            pillPx[0] > skyPx[0] + 18 && pillPx[0] < 130 &&
            fgPx[2] > 65 && fgPx[0] < 50,
          `glErr=${glErr}; translucent pill rgb(${pillPx[0]},${pillPx[1]},${pillPx[2]}) over sky rgb(${skyPx[0]},${skyPx[1]},${skyPx[2]}); foreground rgb(${fgPx[0]},${fgPx[1]},${fgPx[2]}).`
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
    name: 'Depth occlusion on masks clock digits behind foreground cutout, Flat overlay reverses order',
    expect: 'pass',
    why: 'Samples the overlap pixel between a white clock bar and a dark navy foreground cutout under Depth occlusion on (mode 0) vs Flat overlay (mode 1).',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 240;
      const H = 160;
      const { cv, clockEl, fgEl } = makeFixtureLayers(W, H, { mode: 'occlusion' });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: DEPTH_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.02, 0.03, 0.08, 1.0]);
        await nextPaint(cv);

        g.begin([0.02, 0.03, 0.08, 1.0]);
        drawFixtureScene(g, cv, clockEl, fgEl, W, H, 0, 0, 0);
        const depthOverlap = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.58);
        const depthTop = readCssPixel(g.gl, cv, W, H, W * 0.5, 42);

        g.begin([0.02, 0.03, 0.08, 1.0]);
        drawFixtureScene(g, cv, clockEl, fgEl, W, H, 0, 0, 1);
        const flatOverlap = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.58);
        const glErr = g.gl.getError();

        return need(
          glErr === 0 &&
            depthTop[0] > 220 &&
            depthOverlap[0] < 60 && depthOverlap[2] > 65 &&
            flatOverlap[0] > 220 && flatOverlap[1] > 220 && flatOverlap[2] > 220,
          `topClock rgb(${depthTop.slice(0, 3)}); depthOverlap rgb(${depthOverlap.slice(0, 3)}) vs flatOverlap rgb(${flatOverlap.slice(0, 3)}).`
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
    name: 'Pointer parallax shifts foreground centroid (1.35x) faster than clock digits (0.70x)',
    expect: 'pass',
    why: 'Renders cached clock and foreground stripe textures at offsetX = -20 vs +20 without re-uploading, then measures horizontal centroid travel on both planes.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 260;
      const H = 160;
      const { cv, clockEl, fgEl } = makeFixtureLayers(W, H, { mode: 'parallax' });
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: DEPTH_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0.02, 0.03, 0.08, 1.0]);
        await nextPaint(cv);
        g.begin([0.02, 0.03, 0.08, 1.0]);
        const texClock = g.upload(clockEl);
        const texFg = g.upload(fgEl);

        const drawCached = (ox) => {
          g.begin([0.02, 0.03, 0.08, 1.0]);
          g.quad(clockEl, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, texFg.tex);
            gl.uniform1i(loc('uSubjectTex'), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform4f(loc('uClockRect'), ox * PARALLAX_CLOCK, 0, W, H);
            gl.uniform4f(loc('uSubjectRect'), ox * PARALLAX_SUBJECT, 0, W, H);
            gl.uniform2f(loc('uOffset'), ox, 0);
            gl.uniform1i(loc('uMode'), 0);
            gl.uniform1i(loc('uTheme'), 2);
            gl.uniform1f(loc('uReduced'), 1.0);
          });
        };

        const centroidX = (yCss, pred) => {
          let sum = 0;
          let count = 0;
          for (let x = 4; x < W - 4; x += 2) {
            const px = readCssPixel(g.gl, cv, W, H, x, yCss);
            if (pred(px)) { sum += x; count++; }
          }
          return count ? sum / count : -1;
        };

        drawCached(-20);
        const cLeft = centroidX(40, (px) => px[0] > 210 && px[1] > 210 && px[2] > 210);
        const fgLeft = centroidX(114, (px) => px[0] > 200 && px[2] < 130);

        drawCached(20);
        const cRight = centroidX(40, (px) => px[0] > 210 && px[1] > 210 && px[2] > 210);
        const fgRight = centroidX(114, (px) => px[0] > 200 && px[2] < 130);

        const dc = cRight - cLeft;
        const df = fgRight - fgLeft;
        const err = g.gl.getError();
        return need(
          err === 0 && texClock?.w > 0 && cLeft > 0 && fgLeft > 0 && dc > 20 && df > dc * 1.5,
          `clock shift=${dc.toFixed(1)} px (${cLeft.toFixed(1)}->${cRight.toFixed(1)}), subject shift=${df.toFixed(1)} px (${fgLeft.toFixed(1)}->${fgRight.toFixed(1)}).`
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
    name: 'updateElementGeometry() keeps input and widget button clickable inside #dw-clock-layer',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled DOMMatrix plus dataset.hitTick toggle to the clock layer across two parallax positions while #dw-subject-layer stays inert, and checks elementsFromPoint().',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available.');
      }
      const baseActive = window.__gfx?.active() ?? 0;
      const W = 260;
      const H = 180;
      const { cv, clockEl, fgEl, btn, inp } = makeFixtureLayers(W, H, { mode: 'hit' });
      testStage().append(cv);
      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: DEPTH_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0.02, 0.03, 0.08, 1.0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);

        const cw = clockEl.offsetWidth || 200;
        const unit = geometryUnit(cv, clockEl, cw);
        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });

        const testAt = async (ox) => {
          const tx = Math.round(30 + ox * PARALLAX_CLOCK);
          const ty = 12;
          if (g) {
            g.begin([0.02, 0.03, 0.08, 1.0]);
            const uploaded = [g.upload(clockEl), g.upload(fgEl)];
            g.quad(clockEl, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, uploaded[1].tex);
              gl.uniform1i(loc('uSubjectTex'), 1);
              gl.activeTexture(gl.TEXTURE0);
              gl.uniform2f(loc('uCanvasSize'), W, H);
              gl.uniform4f(loc('uClockRect'), tx, ty, cw, clockEl.offsetHeight || 130);
              gl.uniform4f(loc('uSubjectRect'), ox * PARALLAX_SUBJECT, 0, W, H);
              gl.uniform2f(loc('uOffset'), ox, 0);
              gl.uniform1i(loc('uMode'), 0);
              gl.uniform1i(loc('uTheme'), 2);
              gl.uniform1f(loc('uReduced'), 1.0);
            });
          }
          cv.updateElementGeometry(clockEl, {
            canvasTransform: new DOMMatrix().scale(unit, unit, 1).translate(tx, ty),
          });
          if (OFFSTAGE) cv.updateElementGeometry(fgEl, { canvasTransform: OFFSTAGE });
          clockEl.dataset.hitTick = clockEl.dataset.hitTick === '1' ? '0' : '1';
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const r = cv.getBoundingClientRect();
          const hitBtn = document.elementsFromPoint(r.left + tx + 100, r.top + ty + 79);
          const hitInp = document.elementsFromPoint(r.left + tx + 100, r.top + ty + 29);
          return { ok: hitBtn.includes(btn) && hitInp.includes(inp), btnTop: hitBtn[0]?.tagName, inpTop: hitInp[0]?.tagName };
        };

        const left = await testAt(-18);
        const right = await testAt(18);
        if (right.ok) btn.click();

        return need(
          left.ok && right.ok && clicks === 1,
          `left(${left.btnTop}/${left.inpTop})=${left.ok}, right(${right.btnTop}/${right.inpTop})=${right.ok}, clicks=${clicks}.`
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
    name: 'Context-loss rescue/restore and 5-argument 2D drawElementImage() occlusion fallback',
    expect: 'pass',
    why: 'Tests synthetic cancelable webglcontextlost and webglcontextrestored on an ElementGL fixture, plus a clean 5-argument drawElementImage() 2D fixture verified through a drawImage() copy.',
    timeout: 7000,
    run: async () => {
      if (!hicSupported) throw new Error('HTML-in-canvas is not available.');
      const baseActive = window.__gfx?.active() ?? 0;

      // Part A: WebGL context lost & restored
      let glOk = !glSupported;
      let glDetail = 'WebGL unavailable (2D-only check)';
      if (glSupported) {
        const W = 220;
        const H = 150;
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        plain.hidden = true;
        const { cv, clockEl, fgEl } = makeFixtureLayers(W, H, { mode: 'occlusion' });
        wrap.append(cv, plain);
        testStage().append(wrap);
        let g = null;
        let lostFired = false;
        let restoredFired = false;
        try {
          g = new ElementGL(cv, {
            fragment: DEPTH_FRAG,
            attributes: { alpha: false, preserveDrawingBuffer: true },
            onLost: () => {
              lostFired = true;
              plain.hidden = false;
              plain.append(clockEl, fgEl);
            },
            onRestored: () => {
              restoredFired = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              plain.hidden = true;
              cv.append(clockEl, fgEl);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0.02, 0.03, 0.08, 1.0]);
          await nextPaint(cv);
          g.begin([0.02, 0.03, 0.08, 1.0]);
          drawFixtureScene(g, cv, clockEl, fgEl, W, H, 0, 0, 0);

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          const inPlain = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(clockEl) && plain.contains(fgEl);

          cv.dispatchEvent(new Event('webglcontextrestored'));
          g.begin([0.02, 0.03, 0.08, 1.0]);
          await nextPaint(cv);
          g.begin([0.02, 0.03, 0.08, 1.0]);
          drawFixtureScene(g, cv, clockEl, fgEl, W, H, 0, 0, 0);
          const err = g.gl.getError();
          glOk = inPlain && restoredFired && !g.lost && cv.contains(clockEl) && cv.contains(fgEl) && err === g.gl.NO_ERROR;
          glDetail = `plain=${inPlain}, restored=${restoredFired}, glErr=${err}`;
        } finally {
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      }

      // Part B: 5-argument drawElementImage() 2D fallback occlusion check (read via plain copy canvas)
      const W2 = 220;
      const H2 = 150;
      const dpr2 = Math.min(window.devicePixelRatio || 1, 3);
      const { cv: cv2, clockEl: c2, fgEl: f2 } = makeFixtureLayers(W2, H2, { mode: 'occlusion' });
      testStage().append(cv2);
      const copy = document.createElement('canvas');
      copy.width = Math.round(W2 * dpr2);
      copy.height = Math.round(H2 * dpr2);
      let fb2dOk = false;
      let fbDetail = '';
      try {
        cv2.width = copy.width;
        cv2.height = copy.height;
        const c2d = cv2.getContext('2d');
        await nextPaint(cv2);
        c2d.setTransform(dpr2, 0, 0, dpr2, 0, 0);
        c2d.fillStyle = '#081024';
        c2d.fillRect(0, 0, W2, H2);
        c2d.drawElementImage(c2, 0, 0, W2, H2);
        c2d.drawElementImage(f2, 0, 0, W2, H2);

        const copyCtx = copy.getContext('2d', { willReadFrequently: true });
        copyCtx.drawImage(cv2, 0, 0);
        const topPx = copyCtx.getImageData(Math.round(W2 * 0.5 * dpr2), Math.round(40 * dpr2), 1, 1).data;
        const occPx = copyCtx.getImageData(Math.round(W2 * 0.5 * dpr2), Math.round(H2 * 0.58 * dpr2), 1, 1).data;
        fb2dOk = topPx[0] > 220 && occPx[0] < 60 && occPx[2] > 65;
        fbDetail = `2dTop=[${Array.from(topPx.slice(0, 3))}], 2dOccluded=[${Array.from(occPx.slice(0, 3))}]`;
      } finally {
        copy.width = 0;
        copy.height = 0;
        cv2.remove();
        window.__gfx?.retire(cv2);
        await settleGfx(baseActive);
      }

      return need(glOk && fb2dOk, `${glDetail}; ${fbDetail}`);
    },
  },
  stillDrawn(() => [
    {
      name: 'depth-wallpaper stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || LAYER_SLOTS.some((s) => !stage.has(s.el))) return 0;
          return state.uploads >= ELEMENT_COUNT ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
