import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

// #region sdf-shader
// Evaluates a C2 cubic smooth-union (smin) obsidian metaball capsule and OLED rim
// first, then samples live DOM textures at 1:1 CSS pixels inside the SDF mask so
// typography, inputs and range sliders never blur.
export const ISLAND_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uPrevTex;
uniform sampler2D uOrbTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec4 uMainGeom;    // cx1, cy1, w1, h1 (CSS px)
uniform float uMainRadius; // r1 (CSS px)
uniform vec2 uMainLayout;  // active panel CSS layout size
uniform vec4 uPrevGeom;    // prevW, prevH, prevAlpha, mainAlpha
uniform vec4 uOrbGeom;     // cx2, cy2, r2, orbBlend (CSS px)
uniform vec2 uOrbLayout;   // orb panel CSS layout size
uniform float uK;          // smooth-union radius k (CSS px)
uniform float uShowSdf;    // 0 or 1
uniform float uShowStatusBar;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  float rr = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + vec2(rr);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}

// Cubic C2 smooth union: returns (signedDistance, neckBridgeStrength).
vec2 sminCubic(float a, float b, float k) {
  if (k <= 0.001) return vec2(min(a, b), 0.0);
  float h = max(k - abs(a - b), 0.0) / k;
  float m = h * h * h * (k / 6.0);
  return vec2(min(a, b) - m, m);
}

vec2 evalSdf(vec2 p, out float d1, out float d2) {
  d1 = sdRoundBox(p - uMainGeom.xy, uMainGeom.zw * 0.5, uMainRadius);
  if (uOrbGeom.w <= 0.001) {
    d2 = 1e4;
    return vec2(d1, 0.0);
  }
  d2 = length(p - uOrbGeom.xy) - max(uOrbGeom.z, 0.001);
  d2 += (1.0 - uOrbGeom.w) * (uK + 44.0);
  return sminCubic(d1, d2, uK);
}

vec3 wallpaper(vec2 pCss, vec2 uv) {
  float phase = uReduced > 0.5 ? 0.0 : uTime * 0.25;
  vec3 base = mix(vec3(0.11, 0.16, 0.28), vec3(0.06, 0.09, 0.17), uv.y);

  // Luminous cobalt and warm coral aurora behind the upper island drag zone so the
  // pitch-black obsidian liquid neck reads clearly while stretching and pinching.
  vec2 a1 = vec2(0.30 + 0.03 * sin(phase), 0.28);
  vec2 a2 = vec2(0.70 + 0.03 * cos(phase * 0.8), 0.36);
  vec2 a3 = vec2(0.50, 0.56);
  float g1 = exp(-dot(uv - a1, uv - a1) * 7.5);
  float g2 = exp(-dot(uv - a2, uv - a2) * 8.2);
  float g3 = exp(-dot(uv - a3, uv - a3) * 6.5);

  vec3 col = base
    + vec3(0.14, 0.36, 0.68) * g1 * 0.92
    + vec3(0.64, 0.24, 0.40) * g2 * 0.72
    + vec3(0.10, 0.44, 0.52) * g3 * 0.46;

  // Faint lockscreen card hints low in the frame, well below the island.
  vec2 cardP = pCss - vec2(uCanvasSize.x * 0.5, uCanvasSize.y - 76.0);
  float cardD = sdRoundBox(cardP, vec2(min(158.0, uCanvasSize.x * 0.41), 24.0), 14.0);
  float cardBand = (1.0 - smoothstep(-1.0, 1.0, cardD)) * 0.08;
  float cardRim = exp(-abs(cardD) * 0.9) * 0.10;
  col = mix(col, vec3(0.85, 0.92, 1.0), cardBand + cardRim);

  // Subtle mobile status bar icons flanking the Dynamic Island.
  if (uShowStatusBar > 0.02) {
    float sb = 0.0;
    float topY = 23.0;
    // Left signal strength bars (4 ascending pills)
    for (int i = 0; i < 4; i++) {
      float bx = 24.0 + float(i) * 5.0;
      float bh = 2.0 + float(i) * 1.1;
      float bd = sdRoundBox(pCss - vec2(bx, topY + (5.0 - bh) * 0.5), vec2(1.4, bh), 1.0);
      sb = max(sb, 1.0 - smoothstep(-0.6, 0.6, bd));
    }
    // Right battery outline + charge fill
    vec2 batC = vec2(uCanvasSize.x - 32.0, topY);
    float batBox = sdRoundBox(pCss - batC, vec2(10.0, 5.2), 2.4);
    float batOutline = exp(-abs(batBox) * 1.9);
    float batFill = 1.0 - smoothstep(-0.6, 0.6, sdRoundBox(pCss - (batC - vec2(1.4, 0.0)), vec2(6.4, 3.0), 1.2));
    float batTip = 1.0 - smoothstep(-0.5, 0.5, sdRoundBox(pCss - (batC + vec2(11.6, 0.0)), vec2(0.9, 2.0), 0.7));
    sb = max(sb, max(batOutline * 0.78, max(batFill * 0.72, batTip * 0.65)));
    col = mix(col, vec3(0.90, 0.94, 0.99), sb * 0.58 * uShowStatusBar);
  }

  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 pCss = vUv * uCanvasSize;
  vec2 uv = pCss / max(uCanvasSize, vec2(1.0));

  float d1 = 0.0;
  float d2 = 0.0;
  vec2 res = evalSdf(pCss, d1, d2);
  float d = res.x;
  float bridge = res.y;

  // Finite-difference SDF normal for smooth OLED rim specular lighting.
  float e = 0.75;
  float tmpA = 0.0;
  float tmpB = 0.0;
  float dx = evalSdf(pCss + vec2(e, 0.0), tmpA, tmpB).x - evalSdf(pCss - vec2(e, 0.0), tmpA, tmpB).x;
  float dy = evalSdf(pCss + vec2(0.0, e), tmpA, tmpB).x - evalSdf(pCss - vec2(0.0, e), tmpA, tmpB).x;
  vec2 grad = normalize(vec2(dx, dy) + vec2(1e-5));

  vec3 bgCol = wallpaper(pCss, uv);

  // Soft ambient shadow cast onto the wallpaper around the obsidian capsule.
  float outer = max(d, 0.0);
  float dropShadow = exp(-outer * 0.065) * 0.58 + exp(-outer * 0.25) * 0.34;
  vec3 outCol = bgCol * (1.0 - dropShadow);

  // Optional SDF field and smooth-union neck diagnostic overlay.
  if (uShowSdf > 0.5) {
    float iso = smoothstep(0.86, 0.98, abs(cos(outer * 3.14159265 / 11.0)));
    float fieldFade = exp(-outer * 0.018);
    vec3 fieldCol = mix(vec3(0.22, 0.80, 0.98), vec3(0.98, 0.52, 0.24), clamp(outer / 85.0, 0.0, 1.0));
    outCol = mix(outCol, fieldCol, (0.14 + 0.34 * iso) * fieldFade);
    float bridgeGlow = clamp(bridge / 7.5, 0.0, 1.0);
    outCol += vec3(1.0, 0.68, 0.20) * bridgeGlow * 0.42;
  }

  // Glossy obsidian body + directional OLED specular rim.
  float rimBand = exp(-pow((d + 0.95) / 1.15, 2.0));
  float lightBias = 0.38 + 0.62 * clamp(dot(grad, normalize(vec2(-0.34, -0.94))), 0.0, 1.0);
  vec3 rimCol = mix(vec3(0.26, 0.34, 0.48), vec3(0.76, 0.86, 1.0), lightBias);
  float topSheen = exp(-max(-d, 0.0) * 0.13) * max(0.0, -grad.y * 0.65 + 0.25);

  vec3 capsuleCol = vec3(0.016, 0.018, 0.025)
    + rimCol * rimBand * 0.36
    + vec3(0.18, 0.24, 0.34) * topSheen * 0.16;

  // Extra caustic rim glint along the stretching mercury neck.
  capsuleCol += vec3(0.28, 0.44, 0.68) * clamp(bridge / 10.0, 0.0, 1.0) * rimBand * 0.42;

  if (uShowSdf > 0.5) {
    float ring1 = exp(-abs(d1) * 1.8) * 0.45;
    float ring2 = uOrbGeom.w > 0.01 ? exp(-abs(d2) * 1.8) * 0.45 : 0.0;
    capsuleCol += vec3(0.22, 0.80, 0.98) * ring1 + vec3(1.0, 0.68, 0.22) * ring2;
    capsuleCol += vec3(1.0, 0.62, 0.16) * clamp(bridge / 9.0, 0.0, 1.0) * 0.22;
  }

  // Pass 2: sample live premultiplied DOM UI at 1:1 CSS pixels inside the SDF mask.
  vec3 insideCol = capsuleCol;
  if (d < 2.0) {
    vec2 mainOrigin = uMainGeom.xy - uMainLayout * 0.5;
    vec2 mainLocal = pCss - mainOrigin;
    if (mainLocal.x >= 0.0 && mainLocal.x <= uMainLayout.x && mainLocal.y >= 0.0 && mainLocal.y <= uMainLayout.y) {
      vec2 uvMain = mainLocal / max(uMainLayout, vec2(1.0));
      vec4 domMain = texture(uTex, uvMain);
      float aMain = uPrevGeom.w;
      insideCol = domMain.rgb * aMain + insideCol * (1.0 - domMain.a * aMain);
    }

    if (uPrevGeom.z > 0.005) {
      vec2 prevOrigin = uMainGeom.xy - uPrevGeom.xy * 0.5;
      vec2 prevLocal = pCss - prevOrigin;
      if (prevLocal.x >= 0.0 && prevLocal.x <= uPrevGeom.x && prevLocal.y >= 0.0 && prevLocal.y <= uPrevGeom.y) {
        vec2 uvPrev = prevLocal / max(uPrevGeom.xy, vec2(1.0));
        vec4 domPrev = texture(uPrevTex, uvPrev);
        float aPrev = uPrevGeom.z;
        insideCol = domPrev.rgb * aPrev + insideCol * (1.0 - domPrev.a * aPrev);
      }
    }

    if (uOrbGeom.w > 0.01) {
      vec2 orbOrigin = uOrbGeom.xy - uOrbLayout * 0.5;
      vec2 orbLocal = pCss - orbOrigin;
      if (orbLocal.x >= 0.0 && orbLocal.x <= uOrbLayout.x && orbLocal.y >= 0.0 && orbLocal.y <= uOrbLayout.y) {
        vec2 uvOrb = orbLocal / max(uOrbLayout, vec2(1.0));
        vec4 domOrb = texture(uOrbTex, uvOrb);
        float sep = sdRoundBox(uOrbGeom.xy - uMainGeom.xy, uMainGeom.zw * 0.5, uMainRadius);
        float orbVis = uOrbGeom.w * smoothstep(-12.0, 4.0, sep);
        insideCol = domOrb.rgb * orbVis + insideCol * (1.0 - domOrb.a * orbVis);
      }
    }
  }

  float capsuleMask = 1.0 - smoothstep(-0.85, 0.85, d);
  vec3 finalCol = mix(outCol, insideCol, capsuleMask);
  outColor = vec4(clamp(finalCol, 0.0, 1.0), 1.0);
}`;
// #endregion sdf-shader

// #region physics
// Critically/lightly underdamped spring integrator for capsule morphs and orb snap-back.
export function stepSpring(spring, target, stiffness, damping, dt) {
  const accel = stiffness * (target - spring.x) - damping * spring.v;
  spring.v += accel * dt;
  spring.x += spring.v * dt;
  return Math.abs(target - spring.x) > 0.05 || Math.abs(spring.v) > 0.08;
}

export function evalNeckState(cx1, cy1, w1, h1, r1, cx2, cy2, r2, k) {
  const halfW = w1 * 0.5;
  const halfH = h1 * 0.5;
  const rr = Math.min(r1, halfW, halfH);
  const sdBox = (px, py) => {
    const qx = Math.abs(px - cx1) - halfW + rr;
    const qy = Math.abs(py - cy1) - halfH + rr;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  };
  const dCenter = sdBox(cx2, cy2);
  const edgeGap = dCenter - r2;

  let minSdf = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const px = cx1 + (cx2 - cx1) * t;
    const py = cy1 + (cy2 - cy1) * t;
    const d1 = sdBox(px, py);
    const d2 = Math.hypot(px - cx2, py - cy2) - r2;
    const h = k > 0.001 ? Math.max(k - Math.abs(d1 - d2), 0) / k : 0;
    const d = Math.min(d1, d2) - (h * h * h * k) / 6;
    if (d < minSdf) minSdf = d;
  }
  return {
    gap: Math.max(0, edgeGap),
    bridged: minSdf <= 0,
  };
}
// #endregion physics

function formatClock(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatSec(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatTimer(sec) {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

function createPlain2dRenderer(ctx, cw, ch, state, anim, panels, showSdf) {
  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#131d33');
  bg.addColorStop(1, '#090d18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  const g1 = ctx.createRadialGradient(cw * 0.3, ch * 0.28, 6, cw * 0.3, ch * 0.28, cw * 0.45);
  g1.addColorStop(0, 'rgba(37, 99, 235, 0.38)');
  g1.addColorStop(1, 'rgba(37, 99, 235, 0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, cw, ch);

  const g2 = ctx.createRadialGradient(cw * 0.72, ch * 0.36, 6, cw * 0.72, ch * 0.36, cw * 0.4);
  g2.addColorStop(0, 'rgba(219, 39, 119, 0.28)');
  g2.addColorStop(1, 'rgba(219, 39, 119, 0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, cw, ch);

  const w1 = anim.w1.x;
  const h1 = anim.h1.x;
  const r1 = Math.min(anim.r1.x, w1 * 0.5, h1 * 0.5);
  const x1 = anim.cx1.x - w1 * 0.5;
  const y1 = anim.cy1.x - h1 * 0.5;

  // Draw optional liquid neck bridge in 2D when twin capsules are bridged.
  if (anim.orbBlend.x > 0.05) {
    const neck = evalNeckState(anim.cx1.x, anim.cy1.x, w1, h1, r1, anim.cx2.x, anim.cy2.x, anim.r2.x, state.k);
    if (neck.bridged) {
      const dx = anim.cx2.x - anim.cx1.x;
      const dy = anim.cy2.x - anim.cy1.x;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const thick = Math.max(4, Math.min(14, (state.k - neck.gap * 2.2) * 0.35));
      ctx.fillStyle = '#05060a';
      ctx.beginPath();
      ctx.moveTo(anim.cx1.x + nx * thick, anim.cy1.x + ny * thick);
      ctx.lineTo(anim.cx2.x + nx * thick * 0.75, anim.cy2.x + ny * thick * 0.75);
      ctx.lineTo(anim.cx2.x - nx * thick * 0.75, anim.cy2.x - ny * thick * 0.75);
      ctx.lineTo(anim.cx1.x - nx * thick, anim.cy1.x - ny * thick);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.fillStyle = '#05060a';
  ctx.strokeStyle = showSdf ? 'rgba(56, 189, 248, 0.7)' : 'rgba(203, 213, 225, 0.3)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.roundRect(x1, y1, w1, h1, r1);
  ctx.fill();
  ctx.stroke();

  if (anim.orbBlend.x > 0.05) {
    ctx.beginPath();
    ctx.arc(anim.cx2.x, anim.cy2.x, anim.r2.x, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const activeEl = panels[state.active];
  const mw = activeEl.offsetWidth || w1;
  const mh = activeEl.offsetHeight || h1;
  const mx = Math.round(anim.cx1.x - mw * 0.5);
  const my = Math.round(anim.cy1.x - mh * 0.5);
  ctx.drawElementImage(activeEl, mx, my, mw, mh);

  if (state.active === 'split') {
    const orbEl = panels.orb;
    const ow = orbEl.offsetWidth || 46;
    const oh = orbEl.offsetHeight || 46;
    const ox = Math.round(anim.cx2.x - ow * 0.5);
    const oy = Math.round(anim.cy2.x - oh * 0.5);
    ctx.drawElementImage(orbEl, ox, oy, ow, oh);
  }
}

export function mountDynamicIsland() {
  banner();

  const stageEl = document.getElementById('island-stage');
  const canvas = document.getElementById('island-canvas');
  const plainHost = document.getElementById('plain-host');
  const noticeEl = document.getElementById('island-notice');

  const hudStateEl = document.getElementById('hud-state');
  const hudNeckEl = document.getElementById('hud-neck');
  const hudRouteEl = document.getElementById('hud-route');

  const stateBtns = Array.from(document.querySelectorAll('button[data-state-btn]'));
  const kInput = document.getElementById('ctl-k');
  const kOut = document.getElementById('out-k');
  const sdfCheck = document.getElementById('ctl-sdf');
  const reducedCheck = document.getElementById('ctl-reduced');
  const snapBtn = document.getElementById('ctl-snap');

  const panels = {
    compact: document.getElementById('panel-compact'),
    split: document.getElementById('panel-split'),
    orb: document.getElementById('panel-orb'),
    media: document.getElementById('panel-media'),
    timer: document.getElementById('panel-timer'),
  };

  // Interactive widgets inside the panels
  const compactTrigger = document.getElementById('compact-trigger');
  const compactClock = document.getElementById('compact-clock');
  const splitExpandBtn = document.getElementById('split-expand-btn');
  const splitEqBars = Array.from(document.querySelectorAll('#panel-split .isl-eq i'));
  const orbTrigger = document.getElementById('orb-trigger');
  const orbRing = document.getElementById('orb-ring');

  const mediaAlbum = document.getElementById('media-album');
  const mediaTrackInput = document.getElementById('media-track');
  const mediaArtist = document.getElementById('media-artist');
  const mediaCycleBtn = document.getElementById('media-cycle');
  const mediaElapsed = document.getElementById('media-elapsed');
  const mediaScrub = document.getElementById('media-scrub');
  const mediaDuration = document.getElementById('media-duration');
  const mediaPrevBtn = document.getElementById('media-prev');
  const mediaPlayBtn = document.getElementById('media-play');
  const mediaNextBtn = document.getElementById('media-next');

  const callStatus = document.getElementById('call-status');
  const callDeclineBtn = document.getElementById('call-decline');
  const callAcceptBtn = document.getElementById('call-accept');
  const timerReadout = document.getElementById('timer-readout');
  const timerToggleBtn = document.getElementById('timer-toggle');
  const timerAddBtn = document.getElementById('timer-add');
  const timerResetBtn = document.getElementById('timer-reset');

  const reducedMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (reducedMQ?.matches) reducedCheck.checked = true;

  const TRACKS = [
    { title: 'Midnight Mercury', artist: 'ElementGL · 48 kHz', duration: 220, tag: 'FM', cls: '' },
    { title: 'Cubic Smooth Min', artist: 'WebGL SDF · Stereo', duration: 195, tag: 'GL', cls: 't1' },
    { title: 'Obsidian Capsule', artist: 'Spatial Audio · Lossless', duration: 246, tag: 'HI', cls: 't2' },
  ];
  const ORB_MODES = ['REC', 'LIVE', 'SYNC'];

  const state = {
    active: 'split',
    prev: null,
    morphT: 1,
    k: Number(kInput.value),
    showSdf: sdfCheck.checked,
    reduced: reducedCheck.checked,
    orbDrag: null, // { pointerId, offsetX, offsetY, startX, startY, moved }
    orbOffsetX: 0,
    orbOffsetY: 0,
    orbModeIdx: 0,
    trackIdx: 0,
    playing: true,
    mediaPos: 78,
    timerSec: 45,
    timerRunning: true,
    callState: 'incoming', // 'incoming' | 'connected' | 'declined'
    callSec: 0,
    paints: 0,
    uploads: 0,
    lastClockText: '',
  };

  const anim = {
    cx1: { x: 180, v: 0 },
    cy1: { x: 58, v: 0 },
    w1: { x: 204, v: 0 },
    h1: { x: 42, v: 0 },
    r1: { x: 21, v: 0 },
    cx2: { x: 310, v: 0 },
    cy2: { x: 58, v: 0 },
    r2: { x: 23, v: 0 },
    orbBlend: { x: 1, v: 0 },
  };

  let route = 'plain';
  let stage = null;
  let ctx2d = null;
  let onScreen = true;
  let rafId = 0;
  let lastFrameAt = 0;
  let lastHudAt = 0;
  let lastEqAt = 0;
  let lastTimerText = '';

  const dirtyPanels = new Set(Object.values(panels));
  const panelTextures = new Map();
  const geoKeys = new Map();
  let unitCacheKey = '';
  let cachedUnit = 1;

  const say = (msg) => {
    noticeEl.hidden = false;
    noticeEl.textContent = msg;
  };

  const markDirty = (panel) => {
    if (panel) dirtyPanels.add(panel);
    if (route === 'webgl' || route === '2d') canvas.requestPaint?.();
  };

  function getTargets(cw, ch) {
    const topY = 38;
    const panelEl = panels[state.active];
    const pw = panelEl.offsetWidth || (state.active === 'compact' ? 176 : state.active === 'split' ? 204 : 344);
    const ph = panelEl.offsetHeight || (state.active === 'compact' ? 40 : state.active === 'split' ? 42 : 186);

    if (state.active === 'split') {
      const orbSize = panels.orb.offsetWidth || 46;
      const orbR = orbSize * 0.5;
      const restGap = 8;
      const totalSpan = pw + restGap + orbSize;
      const leftEdge = Math.round(cw * 0.5 - totalSpan * 0.5);
      const cx1 = leftEdge + pw * 0.5;
      const cy1 = topY + ph * 0.5;
      const restCx2 = leftEdge + pw + restGap + orbR;
      const restCy2 = cy1;
      const cx2 = clamp(restCx2 + state.orbOffsetX, orbR + 12, Math.max(orbR + 12, cw - orbR - 12));
      const cy2 = clamp(restCy2 + state.orbOffsetY, orbR + 12, Math.max(orbR + 12, ch - orbR - 58));
      return { cx1, cy1, w1: pw, h1: ph, r1: 21, cx2, cy2, r2: orbR, orbBlend: 1 };
    }

    const leftEdge = Math.round(cw * 0.5 - pw * 0.5);
    const cx1 = leftEdge + pw * 0.5;
    const cy1 = topY + ph * 0.5;
    const r1 = state.active === 'compact' ? 20 : 30;
    return { cx1, cy1, w1: pw, h1: ph, r1, cx2: cx1 + pw * 0.25, cy2: cy1, r2: 14, orbBlend: 0 };
  }

  function snapSpringsToTarget(cw, ch) {
    const t = getTargets(cw, ch);
    anim.cx1.x = t.cx1; anim.cx1.v = 0;
    anim.cy1.x = t.cy1; anim.cy1.v = 0;
    anim.w1.x = t.w1; anim.w1.v = 0;
    anim.h1.x = t.h1; anim.h1.v = 0;
    anim.r1.x = t.r1; anim.r1.v = 0;
    anim.cx2.x = t.cx2; anim.cx2.v = 0;
    anim.cy2.x = t.cy2; anim.cy2.v = 0;
    anim.r2.x = t.r2; anim.r2.v = 0;
    anim.orbBlend.x = t.orbBlend; anim.orbBlend.v = 0;
    state.morphT = 1;
    state.prev = null;
  }

  function updateHud(force = false) {
    const now = performance.now();
    if (!force && now - lastHudAt < 120) return;
    lastHudAt = now;
    hudStateEl.textContent = state.active;
    if (state.active === 'split' || anim.orbBlend.x > 0.25) {
      const neck = evalNeckState(anim.cx1.x, anim.cy1.x, anim.w1.x, anim.h1.x, anim.r1.x, anim.cx2.x, anim.cy2.x, anim.r2.x, state.k);
      hudNeckEl.textContent = `${neck.bridged ? 'bridged' : 'pinched off'} (${Math.round(neck.gap)} px)`;
    } else {
      hudNeckEl.textContent = 'merged';
    }
    const label = route === 'webgl' ? 'WebGL 2 (ElementGL)' : route === '2d' ? '2D fallback' : 'Plain HTML';
    hudRouteEl.textContent = `${label} · ${state.uploads} uploads`;
  }

  function syncInertFlags(fromActiveInside) {
    const keepOrb = state.active === 'split';
    for (const [key, el] of Object.entries(panels)) {
      const active = key === state.active || (keepOrb && key === 'orb');
      el.inert = !active;
    }
    if (fromActiveInside) {
      const targetFocus =
        state.active === 'compact' ? compactTrigger :
        state.active === 'split' ? splitExpandBtn :
        state.active === 'media' ? mediaPlayBtn :
        timerToggleBtn;
      targetFocus?.focus({ preventScroll: true });
    }
  }

  function setState(next) {
    if (!panels[next] || next === state.active) return;
    const prevPanel = panels[state.active];
    const focusWasInside = prevPanel.contains(document.activeElement) || (state.active === 'split' && panels.orb.contains(document.activeElement));

    state.prev = state.active;
    state.active = next;
    if (next !== 'split') {
      state.orbOffsetX = 0;
      state.orbOffsetY = 0;
      state.orbDrag = null;
    }
    state.morphT = state.reduced ? 1 : 0;

    if (next === 'compact') {
      const nowText = formatClock(new Date());
      if (nowText !== state.lastClockText) {
        state.lastClockText = nowText;
        compactClock.textContent = nowText;
      }
    }

    for (const btn of stateBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.stateBtn === next));
    }

    syncInertFlags(focusWasInside);
    dirtyPanels.add(panels[next]);
    if (next === 'split') dirtyPanels.add(panels.orb);
    geoKeys.clear();

    const cw = canvas.clientWidth || stageEl.clientWidth || 360;
    const ch = canvas.clientHeight || 372;
    if (state.reduced) snapSpringsToTarget(cw, ch);

    updateHud(true);
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
  }

  // #region fallbacks
  function enterPlainFallback(reason, { keepForRestore = false } = {}) {
    route = 'plain';
    stageEl.classList.add('is-plain');
    for (const key of ['compact', 'split', 'orb', 'media', 'timer']) {
      plainHost.append(panels[key]);
    }
    syncInertFlags(false);
    say(reason);
    updateHud(true);
    if (!keepForRestore) stopLoop();
  }

  function restoreFromPlain() {
    if (route === 'webgl') return;
    stageEl.classList.remove('is-plain');
    for (const key of ['compact', 'split', 'orb', 'media', 'timer']) {
      canvas.append(panels[key]);
      dirtyPanels.add(panels[key]);
    }
    route = 'webgl';
    noticeEl.hidden = true;
    geoKeys.clear();
    syncInertFlags(false);
    updateHud(true);
    canvas.requestPaint?.();
    startLoop();
  }
  // #endregion fallbacks

  if (supported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: ISLAND_FRAG,
        onLost: () => {
          panelTextures.clear();
          enterPlainFallback('The WebGL context was lost, so the controls moved to plain HTML. It will restore automatically if the browser returns the context.', { keepForRestore: true });
        },
        onRestored: () => {
          panelTextures.clear();
          unitCacheKey = '';
          restoreFromPlain();
        },
      });
      route = 'webgl';
    } catch (err) {
      say(`WebGL could not start (${err.message}).`);
    }
  }

  if (route === 'plain' && supported) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        route = '2d';
        say('WebGL texElementSubImage2D() is not available here, so the island uses the 5-argument 2D drawElementImage() fallback.');
      }
    } catch {}
  }

  if (route === 'plain' && !stage) {
    enterPlainFallback('HTML-in-canvas is not available here, so the Dynamic Island widgets are shown as plain HTML.');
  }

  // #region paint-geo
  function syncGeometry(cw, ch) {
    const activeEl = panels[state.active];
    const aw = activeEl.offsetWidth || 1;
    const ah = activeEl.offsetHeight || 1;
    const curUnitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}`;
    if (curUnitKey !== unitCacheKey && canvas.width > 0 && cw > 0) {
      cachedUnit = geometryUnit(canvas, activeEl, aw);
      unitCacheKey = curUnitKey;
      geoKeys.clear();
    }
    const unit = cachedUnit;

    const place = (el, active, cx, cy, w, h) => {
      const rx = Math.round(cx - w * 0.5);
      const ry = Math.round(cy - h * 0.5);
      const key = active ? `1:${rx}:${ry}:${unit.toFixed(4)}` : '0';
      if (geoKeys.get(el) === key) return;
      geoKeys.set(el, key);
      canvas.updateElementGeometry(el, {
        canvasTransform: active ? new DOMMatrix().scale(unit).translate(rx, ry) : OFFSTAGE,
      });
      el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
    };

    for (const [key, el] of Object.entries(panels)) {
      if (key === state.active) {
        place(el, true, anim.cx1.x, anim.cy1.x, aw, ah);
      } else if (key === 'orb' && state.active === 'split') {
        const ow = el.offsetWidth || 46;
        const oh = el.offsetHeight || 46;
        place(el, true, anim.cx2.x, anim.cy2.x, ow, oh);
      } else {
        place(el, false, 0, 0, 0, 0);
      }
    }
  }

  canvas.addEventListener('paint', (e) => {
    if (route === 'plain') return;
    const cw = canvas.clientWidth || 1;
    const ch = canvas.clientHeight || 1;
    state.paints++;

    if (route === 'webgl' && stage && !stage.lost) {
      if (e.changedElements) {
        for (const changed of e.changedElements) {
          for (const p of Object.values(panels)) {
            if (p === changed || p.contains(changed)) dirtyPanels.add(p);
          }
        }
      }

      const activeEl = panels[state.active];
      const prevEl = state.prev ? panels[state.prev] : null;
      const orbNeeded = state.active === 'split' || anim.orbBlend.x > 0.01;

      const uploadIfNeeded = (el) => {
        if (!el) return null;
        if (dirtyPanels.has(el) || !panelTextures.has(el)) {
          const texInfo = stage.upload(el);
          if (texInfo) panelTextures.set(el, texInfo);
          dirtyPanels.delete(el);
          state.uploads++;
        }
        return panelTextures.get(el) || null;
      };

      const mainTexInfo = uploadIfNeeded(activeEl);
      const prevTexInfo = prevEl && state.morphT < 0.995 ? uploadIfNeeded(prevEl) : mainTexInfo;
      const orbTexInfo = orbNeeded ? uploadIfNeeded(panels.orb) : mainTexInfo;
      if (!mainTexInfo) return;

      const prevAlpha = prevEl && state.morphT < 0.55 ? 1 - clamp(state.morphT / 0.45, 0, 1) : 0;
      const mainAlpha = prevEl && state.morphT < 1 ? clamp((state.morphT - 0.18) / 0.55, 0, 1) : 1;
      const statusVis = 1 - clamp((anim.w1.x - 220) / 80, 0, 1);

      if (!stage.begin([0.04, 0.06, 0.11, 1])) return;
      stage.quad(activeEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, (prevTexInfo || mainTexInfo).tex);
        gl.uniform1i(u('uPrevTex'), 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, (orbTexInfo || mainTexInfo).tex);
        gl.uniform1i(u('uOrbTex'), 2);

        gl.activeTexture(gl.TEXTURE0);
        gl.uniform2f(u('uCanvasSize'), cw, ch);
        gl.uniform4f(u('uMainGeom'), anim.cx1.x, anim.cy1.x, anim.w1.x, anim.h1.x);
        gl.uniform1f(u('uMainRadius'), anim.r1.x);
        gl.uniform2f(u('uMainLayout'), activeEl.offsetWidth || anim.w1.x, activeEl.offsetHeight || anim.h1.x);
        gl.uniform4f(
          u('uPrevGeom'),
          prevEl ? prevEl.offsetWidth || 1 : 1,
          prevEl ? prevEl.offsetHeight || 1 : 1,
          prevAlpha,
          mainAlpha
        );
        gl.uniform4f(u('uOrbGeom'), anim.cx2.x, anim.cy2.x, anim.r2.x, anim.orbBlend.x);
        gl.uniform2f(u('uOrbLayout'), panels.orb.offsetWidth || 46, panels.orb.offsetHeight || 46);
        gl.uniform1f(u('uK'), state.k);
        gl.uniform1f(u('uShowSdf'), state.showSdf ? 1 : 0);
        gl.uniform1f(u('uShowStatusBar'), statusVis);
        gl.uniform1f(u('uReduced'), state.reduced ? 1 : 0);
      });

      syncGeometry(cw, ch);
      updateHud();
      return;
    }

    if (route === '2d' && ctx2d) {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx2d.reset();
      ctx2d.scale(dpr, dpr);
      createPlain2dRenderer(ctx2d, cw, ch, state, anim, panels, state.showSdf);
      syncGeometry(cw, ch);
      updateHud();
    }
  });
  // #endregion paint-geo

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastFrameAt = 0;
  }

  function startLoop() {
    if (rafId || !onScreen || document.hidden || route === 'plain') return;
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    rafId = 0;
    if (!onScreen || document.hidden || route === 'plain') return;
    const rawDt = Math.min((now - lastFrameAt) / 1000, 0.04);
    lastFrameAt = now;

    const cw = canvas.clientWidth || stageEl.clientWidth || 360;
    const ch = canvas.clientHeight || 372;
    const target = getTargets(cw, ch);

    let moving = false;
    if (state.reduced) {
      snapSpringsToTarget(cw, ch);
    } else {
      const substeps = rawDt > 0.016 ? 2 : 1;
      const dt = rawDt / substeps;
      for (let s = 0; s < substeps; s++) {
        moving = stepSpring(anim.cx1, target.cx1, 310, 26, dt) || moving;
        moving = stepSpring(anim.cy1, target.cy1, 310, 26, dt) || moving;
        moving = stepSpring(anim.w1, target.w1, 300, 25, dt) || moving;
        moving = stepSpring(anim.h1, target.h1, 300, 25, dt) || moving;
        moving = stepSpring(anim.r1, target.r1, 300, 25, dt) || moving;
        if (state.orbDrag) {
          anim.cx2.x = target.cx2;
          anim.cx2.v = 0;
          anim.cy2.x = target.cy2;
          anim.cy2.v = 0;
          moving = true;
        } else {
          moving = stepSpring(anim.cx2, target.cx2, 290, 22, dt) || moving;
          moving = stepSpring(anim.cy2, target.cy2, 290, 22, dt) || moving;
        }
        moving = stepSpring(anim.r2, target.r2, 310, 26, dt) || moving;
        moving = stepSpring(anim.orbBlend, target.orbBlend, 280, 26, dt) || moving;
      }
      if (state.morphT < 1) {
        state.morphT = Math.min(1, state.morphT + rawDt / 0.34);
        moving = true;
      } else {
        state.prev = null;
      }
    }

    // Gentle live widget updates only for whichever panel is currently shown.
    if (state.active === 'split' && !state.reduced && now - lastEqAt > 190) {
      lastEqAt = now;
      const t = now * 0.006;
      splitEqBars.forEach((bar, idx) => {
        const h = 4 + Math.round((0.5 + 0.5 * Math.sin(t + idx * 1.6)) * 8);
        bar.style.height = `${h}px`;
      });
      dirtyPanels.add(panels.split);
    }

    canvas.requestPaint?.();
    if (moving || state.orbDrag) {
      rafId = requestAnimationFrame(tick);
    }
  }

  // Background 100 ms / 1 s ticker for live clock, EQ bars, media playback & timer.
  const clockInterval = setInterval(() => {
    if (document.hidden || !onScreen) return;
    if (state.active === 'compact') {
      const nextText = formatClock(new Date());
      if (nextText !== state.lastClockText) {
        state.lastClockText = nextText;
        compactClock.textContent = nextText;
        markDirty(panels.compact);
      }
    }
    if (state.active === 'split' && !state.reduced && !rafId) {
      const now = performance.now();
      if (now - lastEqAt > 190) {
        lastEqAt = now;
        const t = now * 0.006;
        splitEqBars.forEach((bar, idx) => {
          const h = 4 + Math.round((0.5 + 0.5 * Math.sin(t + idx * 1.6)) * 8);
          bar.style.height = `${h}px`;
        });
        markDirty(panels.split);
      }
    }
    if (state.active === 'media' && state.playing) {
      const dur = TRACKS[state.trackIdx].duration;
      state.mediaPos = (state.mediaPos + 0.25) % dur;
      const whole = Math.floor(state.mediaPos);
      if (Number(mediaScrub.value) !== whole) {
        mediaScrub.value = String(whole);
        mediaElapsed.textContent = formatSec(whole);
        markDirty(panels.media);
      }
    }
    if (state.active === 'timer') {
      let changed = false;
      if (state.timerRunning && state.timerSec > 0) {
        state.timerSec = Math.max(0, state.timerSec - 0.1);
        const text = formatTimer(state.timerSec);
        if (text !== lastTimerText) {
          lastTimerText = text;
          timerReadout.textContent = text;
          changed = true;
        }
        if (state.timerSec === 0) {
          state.timerRunning = false;
          timerToggleBtn.textContent = 'Start';
          changed = true;
        }
      }
      if (state.callState === 'connected') {
        const prevSec = Math.floor(state.callSec);
        state.callSec += 0.1;
        const nextSec = Math.floor(state.callSec);
        if (nextSec !== prevSec) {
          callStatus.textContent = `Connected · ${formatSec(nextSec)}`;
          changed = true;
        }
      }
      if (changed) markDirty(panels.timer);
    }
  }, 100);

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        if (onScreen) {
          startLoop();
          if (route !== 'plain') canvas.requestPaint?.();
        } else {
          stopLoop();
        }
      },
      { rootMargin: '80px 0px' }
    ).observe(stageEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else {
      startLoop();
      if (route !== 'plain') canvas.requestPaint?.();
    }
  });

  function cycleOrbMode() {
    state.orbModeIdx = (state.orbModeIdx + 1) % ORB_MODES.length;
    const mode = ORB_MODES[state.orbModeIdx];
    orbRing.textContent = mode;
    orbRing.classList.toggle('is-amber', mode !== 'REC');
    markDirty(panels.orb);
  }

  // Drag-to-pinch interaction on the detached satellite orb.
  function beginOrbDrag(e) {
    if (state.active !== 'split' || state.orbDrag) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return false;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dist = Math.hypot(px - anim.cx2.x, py - anim.cy2.x);
    if (e.currentTarget !== orbTrigger && dist > anim.r2.x + 18) return false;
    e.preventDefault();
    e.stopPropagation();
    state.orbDrag = {
      pointerId: e.pointerId,
      owner: e.currentTarget,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffX: state.orbOffsetX,
      startOffY: state.orbOffsetY,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startLoop();
    return true;
  }

  function moveOrbDrag(e) {
    const d = state.orbDrag;
    if (!d || e.pointerId !== d.pointerId || e.currentTarget !== d.owner) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (Math.hypot(dx, dy) > 5) d.moved = true;
    state.orbOffsetX = d.startOffX + dx;
    state.orbOffsetY = d.startOffY + dy;
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
    updateHud(true);
  }

  function endOrbDrag(e) {
    const d = state.orbDrag;
    if (!d || e.pointerId !== d.pointerId || e.currentTarget !== d.owner) return;
    const wasTap = !d.moved;
    state.orbDrag = null;
    state.orbOffsetX = 0;
    state.orbOffsetY = 0;
    if (wasTap) cycleOrbMode();
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
    updateHud(true);
  }

  orbTrigger.addEventListener('pointerdown', beginOrbDrag);
  orbTrigger.addEventListener('pointermove', moveOrbDrag);
  orbTrigger.addEventListener('pointerup', endOrbDrag);
  orbTrigger.addEventListener('pointercancel', endOrbDrag);
  orbTrigger.addEventListener('click', (e) => {
    if (e.detail === 0) cycleOrbMode();
  });

  canvas.addEventListener('pointerdown', beginOrbDrag);
  canvas.addEventListener('pointermove', moveOrbDrag);
  canvas.addEventListener('pointerup', endOrbDrag);
  canvas.addEventListener('pointercancel', endOrbDrag);

  orbTrigger.addEventListener('keydown', (e) => {
    if (state.active !== 'split') return;
    const step = 18;
    if (e.key === 'ArrowRight') { e.preventDefault(); state.orbOffsetX += step; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); state.orbOffsetX -= step; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); state.orbOffsetY += step; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.orbOffsetY -= step; }
    else if (e.key === 'Escape') { state.orbOffsetX = 0; state.orbOffsetY = 0; }
    else return;
    canvas.requestPaint?.();
    startLoop();
    updateHud(true);
  });

  // Page toolbar & island buttons
  for (const btn of stateBtns) {
    btn.addEventListener('click', () => setState(btn.dataset.stateBtn));
  }
  compactTrigger.addEventListener('click', () => setState('split'));
  splitExpandBtn.addEventListener('click', () => setState('media'));
  mediaCycleBtn.addEventListener('click', () => setState('timer'));

  kInput.addEventListener('input', () => {
    state.k = Number(kInput.value);
    kOut.textContent = `${state.k} px`;
    updateHud(true);
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
  });

  sdfCheck.addEventListener('change', () => {
    state.showSdf = sdfCheck.checked;
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
  });

  reducedCheck.addEventListener('change', () => {
    state.reduced = reducedCheck.checked;
    if (state.reduced) {
      const cw = canvas.clientWidth || stageEl.clientWidth || 360;
      const ch = canvas.clientHeight || 372;
      snapSpringsToTarget(cw, ch);
    }
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
  });

  snapBtn.addEventListener('click', () => {
    const wasAtRest = state.active === 'split' && Math.hypot(state.orbOffsetX, state.orbOffsetY) < 4;
    setState('split');
    const cw = canvas.clientWidth || stageEl.clientWidth || 360;
    const ch = canvas.clientHeight || 372;
    if (state.reduced) {
      state.orbOffsetX = 0;
      state.orbOffsetY = 0;
      snapSpringsToTarget(cw, ch);
    } else if (wasAtRest) {
      state.orbOffsetX = 96;
      state.orbOffsetY = 32;
      const t = getTargets(cw, ch);
      anim.cx2.x = t.cx2;
      anim.cy2.x = t.cy2;
      state.orbOffsetX = 0;
      state.orbOffsetY = 0;
    } else {
      state.orbOffsetX = 0;
      state.orbOffsetY = 0;
    }
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
    updateHud(true);
  });

  // Media Player interactions
  function applyTrack(idx) {
    state.trackIdx = (idx + TRACKS.length) % TRACKS.length;
    const t = TRACKS[state.trackIdx];
    mediaTrackInput.value = t.title;
    mediaArtist.textContent = t.artist;
    mediaAlbum.textContent = t.tag;
    mediaAlbum.className = `isl-album ${t.cls}`.trim();
    mediaScrub.max = String(t.duration);
    state.mediaPos = Math.min(state.mediaPos, Math.max(12, t.duration - 10));
    mediaScrub.value = String(Math.floor(state.mediaPos));
    mediaElapsed.textContent = formatSec(state.mediaPos);
    mediaDuration.textContent = formatSec(t.duration);
    markDirty(panels.media);
  }

  mediaTrackInput.addEventListener('input', () => markDirty(panels.media));
  mediaScrub.addEventListener('input', () => {
    state.mediaPos = Number(mediaScrub.value);
    mediaElapsed.textContent = formatSec(state.mediaPos);
    markDirty(panels.media);
  });
  mediaPlayBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    mediaPlayBtn.textContent = state.playing ? 'Pause' : 'Play';
    mediaPlayBtn.setAttribute('aria-pressed', String(state.playing));
    markDirty(panels.media);
  });
  mediaPrevBtn.addEventListener('click', () => applyTrack(state.trackIdx - 1));
  mediaNextBtn.addEventListener('click', () => applyTrack(state.trackIdx + 1));
  panels.media.addEventListener('submit', (e) => {
    e.preventDefault();
    markDirty(panels.media);
  });

  // Timer & Incoming Call interactions
  callDeclineBtn.addEventListener('click', () => {
    state.callState = 'declined';
    state.callSec = 0;
    callStatus.textContent = 'Call declined · Tap Accept to redial';
    callAcceptBtn.textContent = 'Redial';
    markDirty(panels.timer);
  });
  callAcceptBtn.addEventListener('click', () => {
    state.callState = 'connected';
    state.callSec = 0;
    callStatus.textContent = 'Connected · 0:00';
    callAcceptBtn.textContent = 'Active';
    markDirty(panels.timer);
  });
  timerToggleBtn.addEventListener('click', () => {
    if (state.timerSec <= 0) state.timerSec = 45;
    state.timerRunning = !state.timerRunning;
    timerToggleBtn.textContent = state.timerRunning ? 'Pause' : 'Start';
    timerReadout.textContent = formatTimer(state.timerSec);
    markDirty(panels.timer);
  });
  timerAddBtn.addEventListener('click', () => {
    state.timerSec += 10;
    timerReadout.textContent = formatTimer(state.timerSec);
    markDirty(panels.timer);
  });
  timerResetBtn.addEventListener('click', () => {
    state.timerSec = 45;
    state.timerRunning = true;
    timerToggleBtn.textContent = 'Pause';
    timerReadout.textContent = formatTimer(state.timerSec);
    markDirty(panels.timer);
  });

  for (const p of Object.values(panels)) {
    p.addEventListener('focusin', () => markDirty(p));
    p.addEventListener('focusout', () => markDirty(p));
  }

  new ResizeObserver(() => {
    const cw = canvas.clientWidth || stageEl.clientWidth || 360;
    const ch = canvas.clientHeight || 372;
    unitCacheKey = '';
    geoKeys.clear();
    snapSpringsToTarget(cw, ch);
    for (const p of Object.values(panels)) dirtyPanels.add(p);
    if (route !== 'plain') canvas.requestPaint?.();
  }).observe(stageEl);

  // Initial state setup before first paint
  compactClock.textContent = formatClock(new Date());
  syncInertFlags(false);
  snapSpringsToTarget(canvas.clientWidth || stageEl.clientWidth || 360, canvas.clientHeight || 372);
  updateHud(true);
  if (route !== 'plain') {
    canvas.requestPaint?.();
    startLoop();
  }

  // ------------------------------------------------------------ live checks on isolated fixtures
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

  function readCssPx(glStage, cv, cssX, cssY) {
    const gl = glStage.gl;
    const sx = cv.width / (cv.clientWidth || 1);
    const sy = cv.height / (cv.clientHeight || 1);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  function makeFixtureCanvas(w, h, innerHtml) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    cv.innerHTML = innerHtml;
    testStage().append(cv);
    return cv;
  }

  function drawFixtureIsland(g, cv, panelEl, cx1, cy1, w1, h1, r1, cx2, cy2, r2, orbBlend, k) {
    const cw = cv.clientWidth || 240;
    const ch = cv.clientHeight || 120;
    const texInfo = g.upload(panelEl);
    if (!g.begin([0.04, 0.06, 0.11, 1])) return;
    g.quad(panelEl, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texInfo.tex);
      gl.uniform1i(u('uPrevTex'), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, texInfo.tex);
      gl.uniform1i(u('uOrbTex'), 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u('uCanvasSize'), cw, ch);
      gl.uniform4f(u('uMainGeom'), cx1, cy1, w1, h1);
      gl.uniform1f(u('uMainRadius'), r1);
      gl.uniform2f(u('uMainLayout'), panelEl.offsetWidth || w1, panelEl.offsetHeight || h1);
      gl.uniform4f(u('uPrevGeom'), 1, 1, 0, 1);
      gl.uniform4f(u('uOrbGeom'), cx2, cy2, r2, orbBlend);
      gl.uniform2f(u('uOrbLayout'), panelEl.offsetWidth || 46, panelEl.offsetHeight || 46);
      gl.uniform1f(u('uK'), k);
      gl.uniform1f(u('uShowSdf'), 0);
      gl.uniform1f(u('uShowStatusBar'), 0);
      gl.uniform1f(u('uReduced'), 1);
    });
  }

  const tests = [
    {
      name: 'ElementGL + texElementSubImage2D() renders the smin metaball capsule with crisp HTML overlay',
      expect: 'pass',
      why: 'Uploads a drawable HTML swatch via texElementSubImage2D(), renders the obsidian capsule with smin, confirms gl.getError() === 0, and verifies bright DOM overlay pixels inside the dark capsule against the lit wallpaper.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          240,
          120,
          '<div id="fx-card" drawable style="position:absolute;left:0;top:0;width:140px;height:48px;display:flex;align-items:center;justify-content:center;background:transparent"><span style="display:block;width:36px;height:22px;background:#ff4d2e;border-radius:6px"></span></div>'
        );
        const card = cv.querySelector('#fx-card');
        let g = null;
        try {
          g = new ElementGL(cv, { fragment: ISLAND_FRAG, attributes: { preserveDrawingBuffer: true } });
          await nextPaint(cv);
          drawFixtureIsland(g, cv, card, 120, 60, 140, 48, 24, 120, 60, 14, 0, 44);
          const glErr = g.gl.getError();
          const badgePx = readCssPx(g, cv, 120, 60);
          const capsulePx = readCssPx(g, cv, 66, 60);
          const bgPx = readCssPx(g, cv, 20, 60);
          return need(
            glErr === 0 &&
              badgePx[0] > 180 && badgePx[1] < 120 &&
              capsulePx[0] < 32 && capsulePx[1] < 32 && capsulePx[2] < 40 &&
              bgPx[2] > capsulePx[2] + 18,
            `gl.getError()=${glErr}; DOM swatch rgb(${badgePx[0]},${badgePx[1]},${badgePx[2]}); obsidian shell rgb(${capsulePx[0]},${capsulePx[1]},${capsulePx[2]}); wallpaper rgb(${bgPx[0]},${bgPx[1]},${bgPx[2]}).`
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
      name: 'Increasing separation splits one connected SDF neck into two isolated black shapes',
      expect: 'pass',
      why: 'Draws twin shapes with k=46 px first at a 4 px gap (bridged neck) and then at a 56 px gap (pinched off), reading the midpoint pixel to verify obsidian ink gives way to lit backdrop.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          260,
          120,
          '<div id="fx-neck" drawable style="position:absolute;left:0;top:0;width:92px;height:36px;background:transparent"></div>'
        );
        const card = cv.querySelector('#fx-neck');
        let g = null;
        try {
          g = new ElementGL(cv, { fragment: ISLAND_FRAG, attributes: { preserveDrawingBuffer: true } });
          await nextPaint(cv);
          // Bridged: c1=(90,60) right edge 136, c2=(156,60) left edge 140 -> gap 4 px, midpoint x=138
          drawFixtureIsland(g, cv, card, 90, 60, 92, 36, 18, 156, 60, 16, 1, 46);
          const bridgedMid = readCssPx(g, cv, 138, 60);

          // Pinched off: c2=(208,60) left edge 192 -> gap 56 px, midpoint x=164
          drawFixtureIsland(g, cv, card, 90, 60, 92, 36, 18, 208, 60, 16, 1, 46);
          const splitMid = readCssPx(g, cv, 164, 60);
          const orbCore = readCssPx(g, cv, 208, 60);
          const neckDark = bridgedMid[0] < 32 && bridgedMid[1] < 32 && bridgedMid[2] < 40;
          const gapLit = splitMid[2] > bridgedMid[2] + 18 && Math.max(splitMid[0], splitMid[1], splitMid[2]) > 42;
          const orbDark = orbCore[0] < 30 && orbCore[2] < 38;
          return need(
            neckDark && gapLit && orbDark,
            `Bridged neck rgb(${bridgedMid[0]},${bridgedMid[1]},${bridgedMid[2]}); pinched gap rgb(${splitMid[0]},${splitMid[1]},${splitMid[2]}); detached orb rgb(${orbCore[0]},${orbCore[1]},${orbCore[2]}).`
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
      name: 'Switching state updates inert flags and keeps live buttons clickable',
      expect: 'pass',
      why: 'Positions panel A and panel B inside a drawable canvas via geometryUnit() + updateElementGeometry(), switches inert from B to A, and confirms elementsFromPoint() hits only the active button.',
      run: async () => {
        if (!supported) throw new Error('HTML-in-canvas is not available in this browser.');
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          260,
          140,
          '<div id="fx-a" drawable style="position:absolute;left:0;top:0;width:120px;height:44px"><button type="button" id="fx-btn-a" style="width:120px;height:44px">Panel A</button></div>' +
          '<div id="fx-b" drawable inert style="position:absolute;left:0;top:0;width:120px;height:44px"><button type="button" id="fx-btn-b" style="width:120px;height:44px">Panel B</button></div>'
        );
        const panelA = cv.querySelector('#fx-a');
        const panelB = cv.querySelector('#fx-b');
        const btnA = cv.querySelector('#fx-btn-a');
        const btnB = cv.querySelector('#fx-btn-b');
        let g = null;
        let activeEl = panelA;
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: ISLAND_FRAG });
            cv.addEventListener('paint', () => {
              if (!g || g.lost) return;
              drawFixtureIsland(g, cv, activeEl, 90, 52, 120, 44, 22, 90, 52, 12, 0, 44);
            });
          } else {
            const ctx = cv.getContext('2d');
            cv.width = 260;
            cv.height = 140;
            cv.addEventListener('paint', () => {
              ctx.reset();
              ctx.drawElementImage(activeEl, 30, 30, 120, 44);
            });
          }
          await nextPaint(cv);
          const unit = geometryUnit(cv, panelA, 120);
          const syncFixture = (showB) => {
            panelA.inert = showB;
            panelB.inert = !showB;
            activeEl = showB ? panelB : panelA;
            cv.updateElementGeometry(panelA, { canvasTransform: showB ? OFFSTAGE : new DOMMatrix().scale(unit).translate(30, 30) });
            cv.updateElementGeometry(panelB, { canvasTransform: showB ? new DOMMatrix().scale(unit).translate(30, 30) : OFFSTAGE });
            panelA.dataset.hitTick = panelA.dataset.hitTick === '1' ? '0' : '1';
            panelB.dataset.hitTick = panelB.dataset.hitTick === '1' ? '0' : '1';
          };

          syncFixture(false);
          const rect = cv.getBoundingClientRect();
          const hit1 = document.elementsFromPoint(rect.left + 90, rect.top + 52);
          const aHit = hit1.includes(btnA) && !hit1.includes(btnB) && panelB.inert;

          let bClicks = 0;
          btnB.addEventListener('click', () => { bClicks++; });
          syncFixture(true);
          await nextPaint(cv);
          const hit2 = document.elementsFromPoint(rect.left + 90, rect.top + 52);
          const bHit = hit2.includes(btnB) && !hit2.includes(btnA) && panelA.inert;
          if (bHit) btnB.click();

          return need(
            aHit && bHit && bClicks === 1,
            `Initial A hit=${aHit}; after switch B hit=${bHit}, clicks=${bClicks}, A.inert=${panelA.inert}.`
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
      name: 'Context loss falls back cleanly to plain HTML without calling loseContext()',
      expect: 'pass',
      why: 'Dispatches a cancelable synthetic webglcontextlost event on an ElementGL fixture and verifies the widget exits the canvas into plain HTML with zero loseContext() calls.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
        const baseActive = window.__gfx?.active() ?? 0;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:220px;height:110px;';
        const cv = document.createElement('canvas');
        cv.setAttribute('content', 'drawable');
        cv.setAttribute('layoutsubtree', '');
        cv.style.cssText = 'display:block;width:220px;height:110px;';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('drawable', '');
        btn.textContent = 'Recovered widget';
        btn.style.cssText = 'position:absolute;left:0;top:0;width:140px;height:40px;';
        cv.append(btn);
        const host = document.createElement('div');
        wrap.append(cv, host);
        testStage().append(wrap);

        let g = null;
        let fellBack = false;
        try {
          g = new ElementGL(cv, {
            fragment: ISLAND_FRAG,
            onLost: () => {
              fellBack = true;
              wrap.classList.add('is-plain');
              host.append(btn);
            },
          });
          await nextPaint(cv);
          drawFixtureIsland(g, cv, btn, 110, 55, 140, 40, 20, 110, 55, 12, 0, 44);

          const ev = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(ev);

          return need(
            ev.defaultPrevented && g.lost && fellBack && host.contains(btn) && !cv.contains(btn),
            `preventDefault=${ev.defaultPrevented}, stage.lost=${g.lost}, fellBack=${fellBack}, movedToPlain=${host.contains(btn)}.`
          );
        } finally {
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
  ];

  runTests(document.getElementById('tests'), tests);
  return () => clearInterval(clockInterval);
}

if (typeof document !== 'undefined' && document.getElementById('island-canvas')) {
  mountDynamicIsland();
}
